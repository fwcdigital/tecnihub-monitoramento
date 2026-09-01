import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { AddressInfo } from 'node:net';
import { mapWithConcurrency } from './concurrency';
import { classifyHttpStatus, executeHttpCheck } from './httpChecker';
import { validateUrlForSSRF } from './ssrfProtection';
import { determineIncidentTransition, processSiteCheck } from './siteCheckService';
import { isSiteDue } from './monitoringScheduler';
import { mapDbSiteToSite } from '../../src/services/siteService';
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
    assert.equal(result.errorType, 'SSRF_BLOCKED');
    assert.match(result.resultMessage, /Bloqueado por segurança/);
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
  it('ignora URL adulterada quando um siteId foi informado', async () => {
    let checkedUrl = '';
    const officialSite = {
      id: 'site-1',
      url: 'https://official.example',
      name: 'Site oficial',
      is_active: true
    };

    const fakeSupabase = {
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
          return classifyHttpStatus(200, 5, url);
        },
        now: () => new Date('2026-08-31T12:00:00.000Z')
      }
    );

    assert.equal(checkedUrl, officialSite.url);
    assert.equal(response.siteId, officialSite.id);
    assert.equal(response.checkId, 'check-1');
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

  it('não executa frequência desconhecida', () => {
    assert.equal(isSiteDue('invalid', '2026-08-01T00:00:00.000Z', now), false);
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
    assert.equal(site.createdAt, 'Indisponível');
    assert.equal(site.lastCheck, 'Indisponível');
    assert.equal(site.checksHistory[0].timestamp, 'Indisponível');
    assert.equal(site.checksHistory[0].httpCode, 'Indisponível');
    assert.equal(site.checksHistory[0].result, 'Sem detalhe disponível');
  });
});
