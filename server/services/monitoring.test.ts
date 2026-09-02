import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { AddressInfo } from 'node:net';
import { mapWithConcurrency } from './concurrency';
import { classifyHttpStatus, detectTrackingEvidence, executeHttpCheck } from './httpChecker';
import { validateUrlForSSRF } from './ssrfProtection';
import { determineIncidentTransition, processSiteCheck } from './siteCheckService';
import { isSiteDue, runMonitoringCycle } from './monitoringScheduler';
import { buildEvents, queueMonitoringAlerts } from './webhookAlertService';
import { mapDbIncidentToIncident, mapDbSiteToSite } from '../../src/services/siteService';
import { diagnosticTypeLabel } from '../../src/utils/diagnosticLabels';
import type { DbCheck, DbSite } from '../../src/types';

describe('classificação HTTP', () => {
  for (const statusCode of [200, 301, 302, 399]) {
    it(`classifica HTTP ${statusCode} como online`, () => {
      assert.equal(classifyHttpStatus(statusCode, 10, 'https://example.com').status, 'online');
    });
  }

  for (const statusCode of [401, 403, 429]) {
    it(`classifica HTTP ${statusCode} como warning`, () => {
      const result = classifyHttpStatus(statusCode, 10, 'https://example.com');
      assert.equal(result.status, 'warning');
      assert.match(result.resultMessage, new RegExp(String(statusCode)));
    });
  }

  it('classifica HTTP 500 como critical', () => {
    assert.equal(classifyHttpStatus(500, 10, 'https://example.com').status, 'critical');
  });
});

describe('proteção SSRF', () => {
  const blockedTargets = [
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://192.168.1.1',
    'http://[::1]',
    'http://169.254.169.254/latest/meta-data/'
  ];

  for (const target of blockedTargets) {
    it(`bloqueia ${target}`, async () => {
      const result = await validateUrlForSSRF(target);
      assert.equal(result.valid, false);
      assert.match(result.errorType || '', /^SSRF_/);
    });
  }

  it('rejeita protocolo não HTTP/HTTPS sem reinterpretá-lo como domínio', async () => {
    const result = await validateUrlForSSRF('ftp://example.com');
    assert.equal(result.valid, false);
    assert.equal(result.errorType, 'UNSUPPORTED_PROTOCOL');
  });

  it('diferencia DNS inválido de bloqueio SSRF', async () => {
    const result = await validateUrlForSSRF('https://does-not-exist.invalid', {
      dnsLookup: async () => {
        const error = new Error('not found') as Error & { code?: string };
        error.code = 'ENOTFOUND';
        throw error;
      }
    });
    assert.equal(result.valid, false);
    assert.equal(result.errorType, 'DNS_NOT_FOUND');
  });

  it('classifica DNS inválido como offline', async () => {
    const result = await executeHttpCheck('https://does-not-exist.invalid', 1000, {
      validateUrl: async () => ({
        valid: false,
        errorType: 'DNS_NOT_FOUND',
        error: 'Domínio não resolvido.'
      })
    });
    assert.equal(result.status, 'offline');
    assert.equal(result.errorType, 'DNS_NOT_FOUND');
    assert.match(result.resultMessage, /falha de DNS/);
  });

  it('bloqueia redirect de origem pública para rede privada', async () => {
    let requests = 0;
    const result = await executeHttpCheck('https://public.example', 1000, {
      validateUrl: async (url) => {
        if (new URL(url).hostname === 'public.example') {
          return { valid: true, resolvedAddresses: [{ address: '93.184.216.34', family: 4 }] };
        }
        return validateUrlForSSRF(url);
      },
      requestUrl: async () => {
        requests++;
        return { statusCode: 302, location: 'http://127.0.0.1/private' };
      }
    });

    assert.equal(requests, 1);
    assert.equal(result.status, 'security_blocked');
    assert.equal(result.errorType, 'SSRF_BLOCKED');
    assert.match(result.resultMessage, /Bloqueado por segurança/);
  });
});

describe('diagnósticos reais do HTML e TLS', () => {
  it('gera warning quando o conteúdo esperado não aparece em HTTP 200', async () => {
    const result = await executeHttpCheck('https://content.example', 1000, {
      validateUrl: async () => ({ valid: true, resolvedAddresses: [{ address: '93.184.216.34', family: 4 }] }),
      requestUrl: async () => ({ statusCode: 200, body: '<html>conteúdo real</html>' })
    }, { expectedContent: 'texto obrigatório' });
    assert.equal(result.status, 'warning');
    assert.equal(result.errorType, 'EXPECTED_CONTENT_MISSING');
    assert.equal(result.expectedContent?.found, false);
    assert.equal(result.incidentEligible, false);
  });

  it('detecta IDs de tags como evidência sem afirmar funcionamento', () => {
    const tracking = detectTrackingEvidence(`
      <script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>
      <script>gtag('config', 'G-ABCDEF123'); fbq('init', '1234567890');</script>
    `, { gtm: 'GTM-ABC123', ga4: 'G-ABCDEF123' });
    assert.equal(tracking.gtm.detected, true);
    assert.equal(tracking.gtm.expectedIdFound, true);
    assert.equal(tracking.gtm.confirmation, 'html_evidence_only');
    assert.equal(tracking.ga4.detected, true);
    assert.equal(tracking.metaPixel.detected, true);
  });

  it('detecta assinaturas HTML alternativas sem depender de plugin', () => {
    const tracking = detectTrackingEvidence(`
      <script src="https://www.google-analytics.com/analytics.js"></script>
      <script>ga('create', 'UA-123456-7'); fbq('init', 99887766);</script>
      <noscript><img src="https://www.facebook.com/tr?id=11223344&ev=PageView"></noscript>
      <script src="https://d335luupugsy2.cloudfront.net/js/loader-scripts/conta.js"></script>
    `);

    assert.deepEqual(tracking.ga4.foundIds, ['UA-123456-7']);
    assert.equal(tracking.ga4.detected, true);
    assert.deepEqual(tracking.metaPixel.foundIds, ['99887766', '11223344']);
    assert.equal(tracking.rdStation.detected, true);
    assert.equal(tracking.rdStation.confirmation, 'html_evidence_only');
  });

  it('classifica SSL a sete dias como crítico sem criar downtime por si só', async () => {
    const result = await executeHttpCheck('https://ssl.example', 1000, {
      validateUrl: async () => ({ valid: true, resolvedAddresses: [{ address: '93.184.216.34', family: 4 }] }),
      requestUrl: async () => ({
        statusCode: 200,
        body: '<html>ok</html>',
        observedIp: '93.184.216.34',
        ssl: { applicable: true, valid: true, hostnameValid: true, daysRemaining: 7, severity: 'critical' }
      })
    });
    assert.equal(result.status, 'critical');
    assert.equal(result.incidentEligible, false);
    assert.equal(result.observedIp, '93.184.216.34');
  });

  it('respeita a configuração persistida que desativa alertas preventivos de SSL', async () => {
    const result = await executeHttpCheck('https://ssl.example', 1000, {
      validateUrl: async () => ({ valid: true, resolvedAddresses: [{ address: '93.184.216.34', family: 4 }] }),
      requestUrl: async () => ({
        statusCode: 200,
        body: '<html>ok</html>',
        observedIp: '93.184.216.34',
        ssl: { applicable: true, valid: true, hostnameValid: true, daysRemaining: 2, severity: 'critical' }
      })
    }, { evaluateSsl: false });
    assert.equal(result.status, 'online');
    assert.equal(result.incidentEligible, false);
  });

  it('classifica falha de handshake TLS como crítica, não como falha DNS', async () => {
    const result = await executeHttpCheck('https://tls.example', 1000, {
      validateUrl: async () => ({ valid: true, resolvedAddresses: [{ address: '93.184.216.34', family: 4 }] }),
      requestUrl: async () => {
        const error = new Error('certificate has expired') as Error & { code?: string };
        error.code = 'CERT_HAS_EXPIRED';
        throw error;
      }
    });
    assert.equal(result.status, 'critical');
    assert.equal(result.errorType, 'TLS_ERROR');
    assert.equal(result.ssl?.expired, true);
  });
});

describe('requisição fixada ao IP validado', () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  let port = 0;

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('não faz nova resolução DNS durante a conexão (proteção contra rebinding)', async () => {
    const result = await executeHttpCheck(`http://rebinding.invalid:${port}`, 1000, {
      validateUrl: async () => ({
        valid: true,
        resolvedAddresses: [{ address: '127.0.0.1', family: 4 }]
      })
    });
    assert.equal(result.status, 'online');
    assert.equal(result.httpStatus, 200);
  });

  it('classifica timeout como offline', async () => {
    const result = await executeHttpCheck('https://timeout.example', 100, {
      validateUrl: async () => ({
        valid: true,
        resolvedAddresses: [{ address: '93.184.216.34', family: 4 }]
      }),
      requestUrl: async () => {
        const error = new Error('timeout') as Error & { code?: string };
        error.code = 'ETIMEDOUT';
        throw error;
      }
    });
    assert.equal(result.status, 'offline');
    assert.equal(result.errorType, 'TIMEOUT');
  });

  it('classifica conexão recusada como offline', async () => {
    const result = await executeHttpCheck('https://refused.example', 1000, {
      validateUrl: async () => ({
        valid: true,
        resolvedAddresses: [{ address: '93.184.216.34', family: 4 }]
      }),
      requestUrl: async () => {
        const error = new Error('connection refused') as Error & { code?: string };
        error.code = 'ECONNREFUSED';
        throw error;
      }
    });
    assert.equal(result.status, 'offline');
    assert.equal(result.errorType, 'CONNECTION_REFUSED');
    assert.equal(result.incidentEligible, true);
  });

  it('segue redirects válidos e classifica o destino final como online', async () => {
    let requestCount = 0;
    const result = await executeHttpCheck('https://redirect.example/start', 1000, {
      validateUrl: async () => ({
        valid: true,
        resolvedAddresses: [{ address: '93.184.216.34', family: 4 }]
      }),
      requestUrl: async () => {
        requestCount++;
        return requestCount === 1
          ? { statusCode: 302, location: 'https://redirect.example/final' }
          : { statusCode: 200 };
      }
    });
    assert.equal(requestCount, 2);
    assert.equal(result.status, 'online');
    assert.equal(result.finalUrl, 'https://redirect.example/final');
  });
});

describe('serviço central de checks', () => {
  it('ignora URL adulterada e não persiste latência de falha como resposta válida', async () => {
    let checkedUrl = '';
    let persistedResponseTime: number | null | undefined;
    const officialSite = {
      id: 'site-1',
      url: 'https://official.example',
      name: 'Site oficial',
      is_active: true
    };

    const fakeSupabase = {
      async rpc(name: string, args: Record<string, unknown>) {
        assert.equal(name, 'record_monitoring_result');
        persistedResponseTime = args.p_response_time as number | null;
        return {
          data: [{ check_id: 'check-1', incident_transition: 'unchanged', related_incident_id: null }],
          error: null
        };
      },
      from(table: string) {
        if (table === 'sites') {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: officialSite, error: null }) }) })
          };
        }
        if (table === 'checks') {
          return {
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'check-1' }, error: null }) }) }),
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [{ status: 'online', checked_at: '2026-08-31T12:00:00.000Z' }], error: null })
                })
              })
            })
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ limit: async () => ({ data: [], error: null }) })
            })
          }),
          insert: async () => ({ error: null }),
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) })
        };
      }
    } as any;

    const response = await processSiteCheck(
      { siteId: officialSite.id, url: 'https://attacker.example' },
      {
        supabase: fakeSupabase,
        executeCheck: async (url) => {
          checkedUrl = url;
          return classifyHttpStatus(500, 5, url);
        },
        now: () => new Date('2026-08-31T12:00:00.000Z')
      }
    );

    assert.equal(checkedUrl, officialSite.url);
    assert.equal(response.siteId, officialSite.id);
    assert.equal(response.checkId, 'check-1');
    assert.equal(persistedResponseTime, null);
  });

  it('persiste diagnósticos automáticos disponíveis independentemente de flags legadas', async () => {
    let persisted: Record<string, unknown> = {};
    let domainQueries = 0;
    const site = {
      id: 'site-automatico', url: 'https://automatico.example', name: 'Site automático',
      domain: 'automatico.example', is_active: true,
      monitor_response_time: false, monitor_ssl: false, monitor_domain: false
    };
    const fakeSupabase = {
      async rpc(_name: string, args: Record<string, unknown>) {
        persisted = args;
        return { data: [{ check_id: 'check-auto', incident_transition: 'unchanged' }], error: null };
      },
      from() {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () => ({ limit: async () => ({ data: [], error: null }) })
              })
            })
          })
        };
      }
    } as any;
    const result = classifyHttpStatus(200, 42, site.url);
    result.observedIp = '93.184.216.34';
    result.dns = { a: ['93.184.216.34'], aaaa: [], cname: [], observedIp: result.observedIp };
    result.ssl = {
      applicable: true, valid: true, hostnameValid: true, issuer: 'Emissor',
      validTo: '2027-09-01T00:00:00.000Z', daysRemaining: 365, severity: 'normal'
    };

    await processSiteCheck({ siteId: site.id, trustedSite: site }, {
      supabase: fakeSupabase,
      executeCheck: async () => result,
      getDomainDiagnostics: async () => {
        domainQueries++;
        return {
          domain: site.domain, status: 'available', registrar: 'Registrador',
          fetchedAt: '2026-09-01T12:00:00.000Z', cached: false
        };
      },
      now: () => new Date('2026-09-01T12:00:00.000Z')
    });

    assert.equal(domainQueries, 1);
    assert.equal(persisted.p_response_time, 42);
    assert.deepEqual(persisted.p_dns_records, result.dns);
    assert.deepEqual(persisted.p_ssl, result.ssl);
    assert.equal((persisted.p_domain_rdap as any).registrar, 'Registrador');
    assert.deepEqual(persisted.p_diagnostics, {
      tracking: null,
      expectedContent: null,
      transport: { finalUrl: site.url, redirectCount: 0, observedIp: '93.184.216.34' },
      classification: { incidentEligible: false, httpStatus: 200, status: 'online' }
    });
  });
});

describe('transições persistidas de incidentes', () => {
  it('não abre incidente na primeira ou segunda falha', () => {
    assert.equal(determineIncidentTransition(['offline'], false), 'unchanged');
    assert.equal(determineIncidentTransition(['critical', 'offline'], false), 'unchanged');
  });

  it('abre incidente após três falhas consecutivas', () => {
    assert.equal(determineIncidentTransition(['offline', 'critical', 'offline'], false), 'opened');
  });

  it('uma resposta de atenção interrompe a confirmação de falha', () => {
    assert.equal(determineIncidentTransition(['offline', 'warning', 'offline'], false), 'unchanged');
  });

  it('não resolve incidente com apenas um sucesso', () => {
    assert.equal(determineIncidentTransition(['online', 'offline'], true), 'unchanged');
  });

  it('resolve incidente após dois sucessos consecutivos', () => {
    assert.equal(determineIncidentTransition(['online', 'online'], true), 'resolved');
  });

  it('não duplica incidente na quarta falha quando já existe incidente ativo', () => {
    assert.equal(determineIncidentTransition(['offline', 'offline', 'offline', 'offline'], true), 'unchanged');
  });

  it('401, 403 e 429 interrompem a sequência e não abrem downtime', () => {
    for (const statusCode of [401, 403, 429]) {
      const warning = classifyHttpStatus(statusCode, 10, 'https://example.com').status;
      assert.equal(determineIncidentTransition(['offline', warning, 'offline'], false), 'unchanged');
    }
  });
});

describe('SSL, DNS e alertas controlados', () => {
  it('mantém online com SSL válido e distante do vencimento', async () => {
    const result = await executeHttpCheck('https://ssl-valid.example', 1000, {
      validateUrl: async () => ({ valid: true, resolvedAddresses: [{ address: '93.184.216.34', family: 4 }] }),
      requestUrl: async () => ({
        statusCode: 200,
        observedIp: '93.184.216.34',
        ssl: { applicable: true, valid: true, hostnameValid: true, daysRemaining: 120, severity: 'normal' }
      })
    });
    assert.equal(result.status, 'online');
    assert.equal(result.ssl?.valid, true);
  });

  it('classifica certificado expirado como crítico e elegível para incidente', async () => {
    const result = await executeHttpCheck('https://ssl-expired.example', 1000, {
      validateUrl: async () => ({ valid: true, resolvedAddresses: [{ address: '93.184.216.34', family: 4 }] }),
      requestUrl: async () => ({
        statusCode: 200,
        observedIp: '93.184.216.34',
        ssl: { applicable: true, valid: false, hostnameValid: true, daysRemaining: -1, expired: true, severity: 'critical' }
      })
    });
    assert.equal(result.status, 'critical');
    assert.equal(result.errorType, 'SSL_EXPIRED');
    assert.equal(result.incidentEligible, true);
  });

  it('registra DNS público válido e IP realmente observado', async () => {
    const result = await executeHttpCheck('https://dns-valid.example', 1000, {
      validateUrl: async () => ({
        valid: true,
        resolvedAddresses: [
          { address: '93.184.216.34', family: 4 },
          { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
        ]
      }),
      requestUrl: async () => ({ statusCode: 200, observedIp: '93.184.216.34' }),
      resolveCname: async () => ['edge.example.net']
    });
    assert.deepEqual(result.dns?.a, ['93.184.216.34']);
    assert.equal(result.dns?.aaaa?.length, 1);
    assert.deepEqual(result.dns?.cname, ['edge.example.net']);
    assert.equal(result.observedIp, '93.184.216.34');
  });

  it('enriquece A, AAAA e CNAME sem trocar o IP validado usado na conexão', async () => {
    let connectedAddress = '';
    const result = await executeHttpCheck('https://dns-completo.example', 1000, {
      validateUrl: async () => ({
        valid: true,
        resolvedAddresses: [{ address: '93.184.216.34', family: 4 }]
      }),
      resolveA: async () => ['93.184.216.34', '93.184.216.35'],
      resolveAaaa: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
      resolveCname: async () => ['edge.example.net.'],
      requestUrl: async (_url, address) => {
        connectedAddress = address.address;
        return { statusCode: 200, observedIp: address.address };
      }
    });

    assert.equal(connectedAddress, '93.184.216.34');
    assert.deepEqual(result.dns?.a, ['93.184.216.34', '93.184.216.35']);
    assert.deepEqual(result.dns?.aaaa, ['2606:2800:220:1:248:1893:25c8:1946']);
    assert.deepEqual(result.dns?.cname, ['edge.example.net']);
    assert.equal(result.observedIp, '93.184.216.34');
  });

  it('gera evento idempotente quando o IP observado muda', () => {
    const events = buildEvents(
      { id: 'site-1', name: 'Site', url: 'https://example.com', domain: 'example.com', is_active: true },
      {
        success: true,
        siteId: 'site-1',
        url: 'https://example.com',
        checkedAt: '2026-09-01T12:00:00.000Z',
        checkId: 'check-2',
        result: {
          status: 'online', httpStatus: 200, responseTime: 15, finalUrl: 'https://example.com',
          resultMessage: 'Online', redirectCount: 0, incidentEligible: false, observedIp: '93.184.216.35'
        }
      },
      '93.184.216.34'
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'dns_changed');
    assert.match(events[0].key, /93\.184\.216\.34:93\.184\.216\.35/);
  });

  it('mantém eventos duráveis na outbox sem fazer entrega externa no monitoramento', async () => {
    let queuedRows: Array<Record<string, unknown>> = [];
    const supabase = {
      from(table: string) {
        if (table === 'checks') return {
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () => ({ limit: async () => ({ data: [], error: null }) })
              })
            })
          })
        };
        if (table === 'monitoring_alert_events') return {
          async upsert(rows: Array<Record<string, unknown>>) {
            queuedRows = rows;
            return { error: null };
          }
        };
        throw new Error(`Tabela inesperada: ${table}`);
      }
    } as any;
    const queued = await queueMonitoringAlerts(
      supabase,
      { id: 'site-1', client_name: 'Cliente', name: 'Site', url: 'https://site.example', is_active: true },
      {
        success: true,
        siteId: 'site-1',
        url: 'https://site.example',
        checkedAt: '2026-09-02T12:00:00.000Z',
        checkId: 'check-3',
        incidentId: 'incident-1',
        incidentTransition: 'opened',
        result: {
          status: 'offline', httpStatus: null, responseTime: 10000,
          finalUrl: 'https://site.example', errorType: 'TIMEOUT',
          resultMessage: 'Offline', redirectCount: 0, incidentEligible: true
        }
      }
    );
    assert.equal(queued, 1);
    assert.equal(queuedRows.length, 1);
    assert.equal(queuedRows[0].event_type, 'incident_confirmed');
    assert.equal(queuedRows[0].event_key, 'incident:incident-1:confirmed');
  });
});

describe('concorrência do lote', () => {
  it('nunca executa mais de 5 verificações simultâneas e preserva falhas individuais', async () => {
    let active = 0;
    let maximumActive = 0;
    const items = Array.from({ length: 20 }, (_, index) => index);

    const results = await mapWithConcurrency(items, 5, async (item) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (item === 7) return { success: false, item };
      return { success: true, item };
    });

    assert.equal(maximumActive, 5);
    assert.equal(results.length, items.length);
    assert.deepEqual(results[7], { success: false, item: 7 });
  });
});

describe('agendamento por frequência', () => {
  const now = Date.parse('2026-09-01T12:00:00.000Z');

  it('considera site sem checks imediatamente elegível', () => {
    assert.equal(isSiteDue('5min', null, now), true);
  });

  it('respeita o intervalo configurado', () => {
    assert.equal(isSiteDue('15min', '2026-09-01T11:50:00.000Z', now), false);
    assert.equal(isSiteDue('15min', '2026-09-01T11:45:00.000Z', now), true);
  });

  it('distingue site vencido de site ainda não vencido pelo last_checked_at', () => {
    assert.equal(isSiteDue('5min', '2026-09-01T11:54:59.000Z', now), true);
    assert.equal(isSiteDue('5min', '2026-09-01T11:55:01.000Z', now), false);
  });

  it('não executa frequência desconhecida', () => {
    assert.equal(isSiteDue('invalid', '2026-08-01T00:00:00.000Z', now), false);
  });

  it('não sobrepõe execução quando o lease distribuído já está ocupado', async () => {
    const calls: string[] = [];
    const supabase = {
      async rpc(name: string) {
        calls.push(name);
        return { data: [], error: null };
      }
    } as any;
    const result = await runMonitoringCycle(supabase, 5, now);
    assert.equal(result.acquired, false);
    assert.deepEqual(calls, ['claim_monitoring_run']);
  });

  it('reserva somente sites vencidos usando o instante do ciclo', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const supabase = {
      async rpc(name: string, args?: Record<string, unknown>) {
        calls.push({ name, args });
        if (name === 'claim_monitoring_run') {
          return { data: [{ run_id: 'run-1', owner_token: 'owner-1' }], error: null };
        }
        if (name === 'claim_due_monitoring_sites') return { data: [], error: null };
        if (name === 'finish_monitoring_run') return { data: true, error: null };
        return { data: null, error: null };
      }
    } as any;

    const result = await runMonitoringCycle(supabase, 5, now);
    const claim = calls.find((call) => call.name === 'claim_due_monitoring_sites');
    assert.equal(result.acquired, true);
    assert.equal(result.claimed, 0);
    assert.equal(claim?.args?.p_now, new Date(now).toISOString());
    assert.equal(calls.at(-1)?.name, 'finish_monitoring_run');
  });
});

describe('mapeamento sem telemetria fabricada', () => {
  const dbSite: DbSite = {
    id: 'site-sem-check',
    client_name: 'Cliente real',
    name: 'Site real',
    url: 'https://example.com',
    domain: 'example.com',
    hosting_provider: 'Hostinger',
    is_wordpress: false,
    is_active: true,
    check_interval: '5min',
    expected_content: null,
    expected_ga4_id: null,
    expected_gtm_id: null,
    expected_google_ads_id: null,
    expected_meta_pixel_id: null,
    uses_search_console: false,
    uses_rd_station: false,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z'
  };

  it('usa estado desconhecido e null quando não há checks ou coletores', () => {
    const site = mapDbSiteToSite(dbSite);
    assert.equal(site.status, 'unknown');
    assert.equal(site.uptime30d, null);
    assert.equal(site.responseTime, null);
    assert.equal(site.sslValid, null);
    assert.equal(site.sslDaysRemaining, null);
    assert.equal(site.domainDaysRemaining, null);
    assert.equal(site.tracking?.results, undefined);
  });

  it('calcula uptime somente a partir das contagens persistidas', () => {
    const site = mapDbSiteToSite(dbSite, [], null, { totalChecks: 8, availableChecks: 6 });
    assert.equal(site.uptime30d, 75);
  });

  it('não inventa HTTP, detalhe ou datas ausentes', () => {
    const check: DbCheck = {
      id: 'check-sem-detalhe',
      site_id: dbSite.id,
      checked_at: 'data-inválida',
      status: 'online',
      http_status: null,
      response_time: null
    };
    const site = mapDbSiteToSite({ ...dbSite, created_at: '' }, [check]);
    assert.equal(site.createdAt, 'Falha na verificação');
    assert.equal(site.lastCheck, 'Falha na verificação');
    assert.equal(site.checksHistory[0].timestamp, 'Falha na verificação');
    assert.equal(site.checksHistory[0].httpCode, 'Falha na verificação');
    assert.equal(site.checksHistory[0].result, 'Falha na verificação');
  });

  it('usa o último check válido mesmo quando o estado persistido ainda está pending', () => {
    const check: DbCheck = {
      id: 'check-online', site_id: dbSite.id, checked_at: '2026-09-01T12:00:00.000Z',
      status: 'online', http_status: 200, response_time: 120, incident_eligible: false,
      final_url: 'https://www.example.com/final', redirect_count: 2
    };
    const site = mapDbSiteToSite({ ...dbSite, monitoring_state: 'pending' }, [check]);
    assert.equal(site.status, 'online');
    assert.equal(site.responseTime, 0.12);
    assert.equal(site.finalUrl, 'https://www.example.com/final');
    assert.equal(site.redirectCount, 2);
    assert.equal(site.checksHistory[0].redirectCount, 2);
  });

  it('mantém warning durante recuperação enquanto o incidente continua ativo', () => {
    const check: DbCheck = {
      id: 'check-recovery', site_id: dbSite.id, checked_at: '2026-09-01T12:00:00.000Z',
      status: 'online', http_status: 200, response_time: 90, incident_eligible: false
    };
    const site = mapDbSiteToSite(
      { ...dbSite, monitoring_state: 'recovering' },
      [check],
      { id: 'incident-1', site_id: dbSite.id, type: 'Site fora do ar', severity: 'critical', title: 'Falha', started_at: '2026-09-01T11:00:00.000Z', status: 'active', created_at: '2026-09-01T11:00:00.000Z' }
    );
    assert.equal(site.status, 'warning');
  });

  it('não exibe a duração de uma falha como tempo de resposta', () => {
    const check: DbCheck = {
      id: 'check-failure', site_id: dbSite.id, checked_at: '2026-09-01T12:00:00.000Z',
      status: 'critical', http_status: 503, response_time: 2400, incident_eligible: true
    };
    const site = mapDbSiteToSite({ ...dbSite, monitoring_state: 'down' }, [check]);
    assert.equal(site.status, 'critical');
    assert.equal(site.responseTime, null);
    assert.equal(site.avgResponseTime, null);
    assert.equal(site.checksHistory[0].responseTime, 0);
  });

  it('traduz códigos técnicos somente para a nomenclatura principal', () => {
    assert.equal(diagnosticTypeLabel('EPROTO', 'critical', null), 'Falha na conexão HTTPS/SSL');
    assert.equal(diagnosticTypeLabel('UNKNOWN', 'warning', null), 'Falha na verificação');
    assert.equal(diagnosticTypeLabel('ECONNREFUSED', 'offline', null), 'Conexão recusada pelo servidor');
  });

  it('mantém código legado do incidente apenas nos detalhes técnicos', () => {
    const incident = mapDbIncidentToIncident({
      id: 'incident-legacy', site_id: dbSite.id, type: 'EPROTO', severity: 'critical',
      title: 'Falha EPROTO', description: null, reason: 'EPROTO',
      started_at: '2026-09-01T11:00:00.000Z', status: 'active',
      created_at: '2026-09-01T11:00:00.000Z'
    }, []);
    assert.equal(incident.type, 'Falha na conexão HTTPS/SSL');
    assert.equal(incident.explanation, 'Falha na conexão HTTPS/SSL');
    assert.equal(incident.technicalCode, 'EPROTO');
  });
});
