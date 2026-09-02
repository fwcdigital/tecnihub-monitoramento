import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { Server } from 'node:http';
import { assertSecureProductionConfiguration, createApp, CreateAppOptions } from '../index';
import { AdminAuthProvider, AdminIdentity } from './adminAuth';
import { ADMIN_SESSION_COOKIE } from './adminSession';
import { LoginRateLimiter } from './loginRateLimiter';

const SESSION_SECRET = 'test-only-session-secret-with-more-than-32-bytes';
const CRON_SECRET = 'test-only-cron-secret-with-more-than-32-bytes';
const VAULT_KEY = Buffer.alloc(32, 7).toString('base64url');
const MASTER_PASSWORD_HASH = `scrypt-v1$16384$8$1$${'a'.repeat(22)}$${'b'.repeat(43)}`;
const activeAdmin: AdminIdentity = {
  id: 'admin-1',
  email: 'admin@tecnihub.com.br',
  isAdmin: true,
  isActive: true
};

const inactiveAdmin: AdminIdentity = {
  ...activeAdmin,
  id: 'admin-inactive',
  email: 'inativo@tecnihub.com.br',
  isActive: false
};

const nonAdminUser: AdminIdentity = {
  ...activeAdmin,
  id: 'user-without-admin-role',
  email: 'usuario@tecnihub.com.br',
  isAdmin: false
};

function createFakeAuthProvider(): AdminAuthProvider {
  return {
    async authenticate(email, password) {
      if (email === activeAdmin.email && password === 'Senha-Correta-123!') return activeAdmin;
      if (email === inactiveAdmin.email && password === 'Senha-Correta-123!') return inactiveAdmin;
      if (email === nonAdminUser.email && password === 'Senha-Correta-123!') return nonAdminUser;
      return null;
    },
    async getById(userId) {
      if (userId === activeAdmin.id) return activeAdmin;
      if (userId === inactiveAdmin.id) return inactiveAdmin;
      if (userId === nonAdminUser.id) return nonAdminUser;
      return null;
    }
  };
}

function createFakeSupabase() {
  return {
    from(table: string) {
      if (table !== 'sites') throw new Error(`Tabela inesperada no teste: ${table}`);
      return {
        update(payload: { is_active: boolean }) {
          return {
            eq(_field: string, siteId: string) {
              return {
                select() {
                  return {
                    single: async () => ({
                      data: { id: siteId, is_active: payload.is_active },
                      error: null
                    })
                  };
                }
              };
            }
          };
        }
      };
    }
  } as any;
}

const servers: Server[] = [];

async function startTestServer(overrides: Partial<CreateAppOptions> = {}) {
  const app = createApp({
    authProvider: createFakeAuthProvider(),
    getSupabase: () => createFakeSupabase(),
    secureCookie: false,
    sessionSecret: SESSION_SECRET,
    ...overrides
  });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

async function closeServers() {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
}

afterEach(closeServers);

async function login(baseUrl: string, email = activeAdmin.email, password = 'Senha-Correta-123!') {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ email, password })
  });
}

function getCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

async function fetchAsAdmin(baseUrl: string, path: string, init: RequestInit = {}) {
  const loginResponse = await login(baseUrl);
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: getCookie(loginResponse),
      ...(init.headers || {})
    }
  });
}

describe('autenticação administrativa', () => {
  it('aceita login correto e emite cookie HttpOnly sem expor senha ou token Auth', async () => {
    const baseUrl = await startTestServer({ secureCookie: true });
    const response = await login(baseUrl);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.user, { id: activeAdmin.id, email: activeAdmin.email });
    assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
    assert.match(response.headers.get('set-cookie') || '', /SameSite=Strict/);
    assert.match(response.headers.get('set-cookie') || '', /Secure/);
    assert.equal(JSON.stringify(payload).includes('Senha-Correta'), false);
    assert.equal('access_token' in payload, false);
  });

  it('retorna mensagem genérica para senha incorreta', async () => {
    const baseUrl = await startTestServer();
    const response = await login(baseUrl, activeAdmin.email, 'senha-incorreta');
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error, 'E-mail ou senha inválidos.');
  });

  it('retorna a mesma mensagem genérica para usuário inexistente', async () => {
    const baseUrl = await startTestServer();
    const response = await login(baseUrl, 'naoexiste@tecnihub.com.br', 'qualquer-senha');
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error, 'E-mail ou senha inválidos.');
  });

  it('não permite login de usuário inativo', async () => {
    const baseUrl = await startTestServer();
    const response = await login(baseUrl, inactiveAdmin.email, 'Senha-Correta-123!');
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error, 'E-mail ou senha inválidos.');
  });

  it('não permite login sem app_metadata.role admin', async () => {
    const baseUrl = await startTestServer();
    const response = await login(baseUrl, nonAdminUser.email, 'Senha-Correta-123!');
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'E-mail ou senha inválidos.');
  });

  it('revoga uma sessão já emitida quando o usuário é banido ou inativado', async () => {
    const provider: AdminAuthProvider = {
      authenticate: async () => activeAdmin,
      getById: async () => inactiveAdmin
    };
    const baseUrl = await startTestServer({ authProvider: provider });
    const loginResponse = await login(baseUrl);
    assert.equal(loginResponse.status, 200);
    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: getCookie(loginResponse) }
    });
    assert.equal(sessionResponse.status, 401);
    assert.match(sessionResponse.headers.get('set-cookie') || '', /Max-Age=0/);
  });

  it('nega acesso administrativo sem sessão', async () => {
    const baseUrl = await startTestServer();
    assert.equal((await fetch(`${baseUrl}/api/sites`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/incidents`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/incidents/incident-1/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({})
    })).status, 401);
  });

  it('aceita acesso administrativo com sessão válida', async () => {
    const baseUrl = await startTestServer();
    const loginResponse = await login(baseUrl);
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: getCookie(loginResponse) }
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.user.email, activeAdmin.email);
  });

  it('limpa a sessão no logout', async () => {
    const baseUrl = await startTestServer();
    const loginResponse = await login(baseUrl);
    const cookie = getCookie(loginResponse);
    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: baseUrl }
    });
    assert.equal(logoutResponse.status, 204);
    assert.match(logoutResponse.headers.get('set-cookie') || '', /Max-Age=0/);
  });

  it('recusa sessão expirada ou adulterada', async () => {
    let currentTime = Date.parse('2026-08-31T12:00:00.000Z');
    const baseUrl = await startTestServer({ now: () => currentTime, sessionTtlSeconds: 300 });
    const loginResponse = await login(baseUrl);
    const validCookie = getCookie(loginResponse);
    currentTime += 301_000;

    const expiredResponse = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: validCookie }
    });
    const invalidResponse = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: `${ADMIN_SESSION_COOKIE}=payload.assinatura-invalida` }
    });
    assert.equal(expiredResponse.status, 401);
    assert.equal(invalidResponse.status, 401);
  });

  it('aplica rate limit após tentativas repetidas', async () => {
    const limiter = new LoginRateLimiter(2, 60_000, () => Date.now());
    const baseUrl = await startTestServer({ loginRateLimiter: limiter });
    assert.equal((await login(baseUrl, activeAdmin.email, 'errada-1')).status, 401);
    assert.equal((await login(baseUrl, activeAdmin.email, 'errada-2')).status, 401);
    const blocked = await login(baseUrl, activeAdmin.email, 'errada-3');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  });

  it('nega endpoint de escrita sem sessão e permite com sessão e origem válidas', async () => {
    const baseUrl = await startTestServer();
    const endpoint = `${baseUrl}/api/sites/site-1/active`;
    const init = {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ isActive: false })
    };

    assert.equal((await fetch(endpoint, init)).status, 401);
    const loginResponse = await login(baseUrl);
    const authenticatedResponse = await fetch(endpoint, {
      ...init,
      headers: { ...init.headers, Cookie: getCookie(loginResponse) }
    });
    assert.equal(authenticatedResponse.status, 200);
  });
});

describe('CRUD administrativo de sites e preservação de histórico', () => {
  it('cadastra configurações operacionais somente após confirmação do banco', async () => {
    let inserted: Record<string, unknown> | null = null;
    const supabase = {
      from(table: string) {
        assert.equal(table, 'sites');
        return {
          insert(payload: Record<string, unknown>) {
            inserted = payload;
            return { select: () => ({ single: async () => ({ data: { id: 'site-new', ...payload }, error: null }) }) };
          }
        };
      }
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const response = await fetchAsAdmin(baseUrl, '/api/sites', {
      method: 'POST',
      body: JSON.stringify({
        client_name: 'Cliente', name: 'Portal', url: 'https://93.184.216.34', domain: 'portal.example',
        check_interval: '15min', expected_content: 'Conteúdo esperado'
      })
    });
    assert.equal(response.status, 201);
    assert.equal(inserted?.check_interval, '15min');
    assert.equal(inserted?.expected_content, 'Conteúdo esperado');
    assert.equal(inserted?.monitoring_state, 'pending');
    assert.equal(typeof inserted?.next_check_at, 'string');
  });

  it('não retorna sucesso quando cadastro ou edição falham no banco', async () => {
    const createFailure = {
      from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'falha' } }) }) }) })
    } as any;
    const createBaseUrl = await startTestServer({ getSupabase: () => createFailure });
    const createResponse = await fetchAsAdmin(createBaseUrl, '/api/sites', {
      method: 'POST',
      body: JSON.stringify({ client_name: 'Cliente', name: 'Portal', url: 'https://93.184.216.34', domain: 'portal.example' })
    });
    assert.equal(createResponse.status, 500);
    assert.equal((await createResponse.json()).code, 'SITE_CREATE_FAILED');

    const updateFailure = {
      from: () => ({
        update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'falha' } }) }) }) })
      })
    } as any;
    const updateBaseUrl = await startTestServer({ getSupabase: () => updateFailure });
    const updateResponse = await fetchAsAdmin(updateBaseUrl, '/api/sites/site-1', {
      method: 'PATCH', body: JSON.stringify({ name: 'Novo nome' })
    });
    assert.equal(updateResponse.status, 404);
    assert.equal((await updateResponse.json()).code, 'SITE_UPDATE_FAILED');
  });

  it('edita nome, URL, intervalo e conteúdo esperado e antecipa o próximo check', async () => {
    let updated: Record<string, unknown> | null = null;
    const supabase = {
      from: () => ({
        update(payload: Record<string, unknown>) {
          updated = payload;
          return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'site-1', ...payload }, error: null }) }) }) };
        }
      })
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-1', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Portal atualizado', url: 'https://93.184.216.34/novo',
        check_interval: '30min', expected_content: 'Nova marca'
      })
    });
    assert.equal(response.status, 200);
    assert.equal(updated?.name, 'Portal atualizado');
    assert.equal(updated?.url, 'https://93.184.216.34/novo');
    assert.equal(updated?.check_interval, '30min');
    assert.equal(updated?.expected_content, 'Nova marca');
    assert.equal(typeof updated?.next_check_at, 'string');
  });

  it('desativa e reativa sem consultar ou remover checks e incidentes', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const touchedTables: string[] = [];
    const supabase = {
      from(table: string) {
        touchedTables.push(table);
        assert.equal(table, 'sites');
        return {
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'site-1', is_active: payload.is_active }, error: null }) }) }) };
          }
        };
      }
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    assert.equal((await fetchAsAdmin(baseUrl, '/api/sites/site-1/active', {
      method: 'PATCH', body: JSON.stringify({ isActive: false })
    })).status, 200);
    assert.equal(updates[0].monitoring_state, 'paused');
    assert.equal(updates[0].next_check_at, null);

    assert.equal((await fetchAsAdmin(baseUrl, '/api/sites/site-1/active', {
      method: 'PATCH', body: JSON.stringify({ isActive: true })
    })).status, 200);
    assert.equal(updates[1].monitoring_state, 'pending');
    assert.equal(typeof updates[1].next_check_at, 'string');
    assert.deepEqual(touchedTables, ['sites', 'sites']);
  });

  it('não retorna sucesso quando a alteração de atividade falha no banco', async () => {
    const supabase = {
      from: () => ({
        update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'falha' } }) }) }) })
      })
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-1/active', {
      method: 'PATCH', body: JSON.stringify({ isActive: false })
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'SITE_ACTIVE_UPDATE_FAILED');
  });

  it('exige nome ou domínio digitado e bloqueia exclusão quando existe histórico', async () => {
    let deleteCalled = false;
    const supabase = {
      from(table: string) {
        if (table === 'sites') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'site-1', name: 'Portal Principal', domain: 'portal.example' }, error: null }) }) }),
          delete: () => ({ eq: async () => { deleteCalled = true; return { error: null }; } })
        };
        if (table === 'checks') return { select: () => ({ eq: async () => ({ count: 4, error: null }) }) };
        if (table === 'incidents') return { select: () => ({ eq: async () => ({ count: 1, error: null }) }) };
        throw new Error(`Tabela inesperada: ${table}`);
      }
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const mismatch = await fetchAsAdmin(baseUrl, '/api/sites/site-1', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'qualquer coisa' })
    });
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).code, 'DELETE_CONFIRMATION_MISMATCH');

    const blocked = await fetchAsAdmin(baseUrl, '/api/sites/site-1', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'Portal Principal' })
    });
    assert.equal(blocked.status, 409);
    const payload = await blocked.json();
    assert.equal(payload.code, 'SITE_HAS_HISTORY');
    assert.deepEqual(payload.history, { checks: 4, incidents: 1 });
    assert.equal(deleteCalled, false);
  });

  it('permite exclusão confirmada por domínio somente quando não existe histórico', async () => {
    let deleteCalled = false;
    const supabase = {
      from(table: string) {
        if (table === 'sites') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'site-empty', name: 'Site vazio', domain: 'vazio.example' }, error: null }) }) }),
          delete: () => ({ eq: async () => { deleteCalled = true; return { error: null }; } })
        };
        return { select: () => ({ eq: async () => ({ count: 0, error: null }) }) };
      }
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-empty', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'vazio.example' })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.equal(deleteCalled, true);
  });
});

describe('hardening HTTP e configuração de produção', () => {
  it('recusa startup de produção sem segredo, com segredo fraco ou origem aberta', () => {
    assert.throws(
      () => assertSecureProductionConfiguration({ NODE_ENV: 'production' }),
      /ADMIN_SESSION_SECRET/
    );
    assert.throws(
      () => assertSecureProductionConfiguration({
        NODE_ENV: 'production',
        ADMIN_SESSION_SECRET: 'curto'
      }),
      /ADMIN_SESSION_SECRET/
    );
    assert.throws(
      () => assertSecureProductionConfiguration({
        NODE_ENV: 'production',
        ADMIN_SESSION_SECRET: SESSION_SECRET,
        MONITOR_CRON_SECRET: CRON_SECRET,
        CREDENTIALS_ENCRYPTION_KEY: VAULT_KEY,
        CREDENTIALS_MASTER_PASSWORD_HASH: MASTER_PASSWORD_HASH,
        ALLOWED_ORIGINS: '*'
      }),
      /wildcard/
    );
    assert.doesNotThrow(() => assertSecureProductionConfiguration({
      NODE_ENV: 'production',
      ADMIN_SESSION_SECRET: SESSION_SECRET,
      MONITOR_CRON_SECRET: CRON_SECRET,
      CREDENTIALS_ENCRYPTION_KEY: VAULT_KEY,
      CREDENTIALS_MASTER_PASSWORD_HASH: MASTER_PASSWORD_HASH,
      ALLOWED_ORIGINS: 'https://monitoramento.tecnihub.com.br',
      TRUST_PROXY: '1'
    }));
    assert.throws(
      () => assertSecureProductionConfiguration({
        NODE_ENV: 'production',
        ADMIN_SESSION_SECRET: SESSION_SECRET,
        MONITOR_CRON_SECRET: 'curto'
      }),
      /MONITOR_CRON_SECRET/
    );
  });

  it('protege o cron interno com segredo backend e não o expõe na resposta', async () => {
    const baseUrl = await startTestServer({
      monitorCronSecret: CRON_SECRET,
      getSupabase: () => ({
        rpc: async (name: string) => name === 'claim_monitoring_run'
          ? { data: [], error: null }
          : { data: null, error: null }
      } as any)
    });
    const denied = await fetch(`${baseUrl}/api/internal/monitor/run`, { method: 'POST' });
    assert.equal(denied.status, 401);
    assert.equal((await denied.text()).includes(CRON_SECRET), false);
    const accepted = await fetch(`${baseUrl}/api/internal/monitor/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` }
    });
    assert.equal(accepted.status, 202);
    assert.equal((await accepted.text()).includes(CRON_SECRET), false);
  });

  it('aplica headers Helmet e mantém o status público estritamente sanitizado', async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/api/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.deepEqual(Object.keys(payload).sort(), ['service', 'status', 'timestamp']);
    assert.equal('sites' in payload, false);
  });

  it('expõe página pública somente com campos sanitizados e sites ativos', async () => {
    const baseUrl = await startTestServer({
      getSupabase: () => ({
        rpc: async () => ({
          data: [{
            site: {
              id: 'secret-id', name: 'Portal', domain: 'portal.example', is_active: true,
              monitoring_state: 'online', client_name: 'interno',
              technical_credentials: [{ username: 'nao-publicar', secret_ciphertext: 'cipher-nao-publicar' }]
            },
            latest_check: {
              status: 'online', checked_at: '2026-09-01T12:00:00.000Z', http_status: 200,
              response_time: 120, incident_eligible: false
            },
            active_incident: { id: 'incident-recovering' },
            metrics: { '30d': { totalChecks: 10, uptimePercent: 100, hasFullWindow: false } }
          }, {
            site: { id: 'inactive-secret-id', name: 'Inativo', domain: 'inactive.example', is_active: false, monitoring_state: 'paused' },
            latest_check: { status: 'online' }, metrics: {}
          }],
          error: null
        })
      } as any)
    });
    const response = await fetch(`${baseUrl}/api/public/status`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.sites.length, 1);
    assert.deepEqual(Object.keys(payload.sites[0]).sort(), ['domain', 'lastCheckedAt', 'name', 'responseTimeMs', 'status', 'uptime30d']);
    assert.equal(JSON.stringify(payload).includes('secret-id'), false);
    assert.equal(JSON.stringify(payload).includes('interno'), false);
    assert.equal(JSON.stringify(payload).includes('nao-publicar'), false);
    assert.equal(JSON.stringify(payload).includes('cipher-nao-publicar'), false);
    assert.equal(payload.sites[0].status, 'warning');
    assert.equal(payload.sites[0].responseTimeMs, 120);

    const writeAttempt = await fetch(`${baseUrl}/api/public/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: '{}'
    });
    assert.equal(writeAttempt.status, 401);
  });

  it('mantém a página pública real e limitada antes da aplicação da migration 003', async () => {
    let limitCalls = 0;
    const builder: any = {
      select() { return builder; },
      eq() { return builder; },
      order() { return builder; },
      limit() {
        limitCalls++;
        return limitCalls === 2
          ? Promise.resolve({
            data: [{
              id: 'site-1', name: 'Portal', domain: 'portal.example', is_active: true,
              checks: [{ status: 'online', checked_at: '2026-09-01T12:00:00.000Z', response_time: 95 }]
            }],
            error: null
          })
          : builder;
      }
    };
    const baseUrl = await startTestServer({
      getSupabase: () => ({
        rpc: async () => ({ data: null, error: { message: 'função ainda não aplicada' } }),
        from: (table: string) => { assert.equal(table, 'sites'); return builder; }
      } as any)
    });
    const response = await fetch(`${baseUrl}/api/public/status`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(limitCalls, 2);
    assert.equal(payload.sites[0].status, 'online');
    assert.equal(payload.sites[0].responseTimeMs, 95);
    assert.equal(payload.sites[0].uptime30d, null);
  });

  it('retorna métricas persistidas para todas as janelas sem agregar no navegador', async () => {
    const metrics = {
      '24h': { totalChecks: 2, uptimePercent: 100, avgResponseMs: 120 },
      '7d': { totalChecks: 10, uptimePercent: 90, avgResponseMs: 150 },
      '30d': { totalChecks: 40, uptimePercent: 95, avgResponseMs: 140 },
      '90d': { totalChecks: 0, uptimePercent: null, avgResponseMs: null }
    };
    const baseUrl = await startTestServer({
      getSupabase: () => ({
        rpc: async (name: string) => name === 'calculate_site_metrics'
          ? { data: metrics, error: null }
          : { data: [{ bucket: '2026-09-01T12:00:00.000Z', total_checks: 2, avg_response_ms: 120 }], error: null }
      } as any)
    });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-1/metrics?period=30d');
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.metrics, metrics);
    assert.equal(payload.period, '30d');
    assert.equal(payload.series.length, 1);
    assert.equal(payload.metrics['90d'].uptimePercent, null);
  });

  it('aplica rate limit razoável ao status público', async () => {
    const limiter = new LoginRateLimiter(2, 60_000, () => Date.now());
    const baseUrl = await startTestServer({ publicStatusRateLimiter: limiter });
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    const blocked = await fetch(`${baseUrl}/api/health`);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  });

  it('nega CORS desconhecido em produção e não aceita origem aberta no startup', async () => {
    const baseUrl = await startTestServer({
      isProduction: true,
      allowedOrigins: ['https://monitoramento.tecnihub.com.br']
    });
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://origem-maliciosa.example' }
    });
    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.code, 'CORS_ORIGIN_DENIED');
  });
});
