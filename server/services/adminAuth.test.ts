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
const ALERT_CRON_SECRET = 'test-only-alert-cron-secret-with-more-than-32-bytes';
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
    assert.equal((await fetch(`${baseUrl}/api/sites/site-1`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ confirmation: 'portal.example' })
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

  it('não permite resolver incidente fora da regra automática de dois sucessos', async () => {
    const baseUrl = await startTestServer();
    const response = await fetchAsAdmin(baseUrl, '/api/incidents/incident-1/resolve', {
      method: 'PATCH', body: JSON.stringify({})
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'MANUAL_INCIDENT_RESOLUTION_DISABLED');
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
    assert.equal(inserted?.sla_target_percent, 99.9);
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
        check_interval: '30min', expected_content: 'Nova marca', sla_target_percent: 99.95
      })
    });
    assert.equal(response.status, 200);
    assert.equal(updated?.name, 'Portal atualizado');
    assert.equal(updated?.url, 'https://93.184.216.34/novo');
    assert.equal(updated?.check_interval, '30min');
    assert.equal(updated?.expected_content, 'Nova marca');
    assert.equal(updated?.sla_target_percent, 99.95);
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

  it('exige nome ou domínio digitado antes de chamar a exclusão transacional', async () => {
    let rpcCalled = false;
    const supabase = {
      from(table: string) {
        if (table === 'sites') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'site-1', name: 'Portal Principal', domain: 'portal.example' }, error: null }) }) })
        };
        throw new Error(`Tabela inesperada: ${table}`);
      },
      rpc: async () => { rpcCalled = true; return { data: null, error: null }; }
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const mismatch = await fetchAsAdmin(baseUrl, '/api/sites/site-1', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'qualquer coisa' })
    });
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).code, 'DELETE_CONFIRMATION_MISMATCH');
    assert.equal(rpcCalled, false);
  });

  it('exclui site com checks, incidente, alertas e credenciais usando uma única RPC', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      from(table: string) {
        assert.equal(table, 'sites');
        return {
          select: () => ({ eq: () => ({ single: async () => ({
            data: { id: 'site-1', name: 'Portal Principal', domain: 'portal.example' }, error: null
          }) }) })
        };
      },
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return {
          data: [{
            deleted_site_id: 'site-1', checks_deleted: 38, incidents_deleted: 1,
            alert_events_deleted: 2, alert_deliveries_deleted: 4,
            credentials_deleted: 3, credential_audit_deleted: 8
          }],
          error: null
        };
      }
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-1', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'Portal Principal' })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.deleted, {
      checks: 38, incidents: 1, alertEvents: 2, alertDeliveries: 4,
      credentials: 3, credentialAudit: 8
    });
    assert.deepEqual(calls, [{
      name: 'delete_site_permanently',
      args: { p_site_id: 'site-1', p_confirmation: 'Portal Principal' }
    }]);
  });

  it('permite exclusão definitiva de site sem histórico', async () => {
    const supabase = {
      from(table: string) {
        if (table === 'sites') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'site-empty', name: 'Site vazio', domain: 'vazio.example' }, error: null }) }) })
        };
        throw new Error(`Tabela inesperada: ${table}`);
      },
      rpc: async () => ({ data: [{
        deleted_site_id: 'site-empty', checks_deleted: 0, incidents_deleted: 0,
        alert_events_deleted: 0, alert_deliveries_deleted: 0,
        credentials_deleted: 0, credential_audit_deleted: 0
      }], error: null })
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-empty', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'vazio.example' })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
  });

  it('não informa sucesso quando a RPC falha e preserva atomicidade no banco', async () => {
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({
          data: { id: 'site-1', name: 'Portal', domain: 'portal.example' }, error: null
        }) }) })
      }),
      rpc: async () => ({ data: null, error: { code: '23503', message: 'falha controlada' } })
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-1', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'portal.example' })
    });
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.success, undefined);
    assert.equal(payload.code, 'SITE_DELETE_FAILED');
    assert.match(payload.error, /Nenhum dado foi removido/i);
  });

  it('retorna o impacto completo usado pela confirmação forte', async () => {
    const supabase = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, 'get_site_deletion_impact');
        assert.deepEqual(args, { p_site_id: 'site-1' });
        return { data: [{
          site_id: 'site-1', site_name: 'Portal', site_domain: 'portal.example',
          checks_count: 38, incidents_count: 1, alert_events_count: 2,
          alert_deliveries_count: 4, credentials_count: 3, credential_audit_count: 8
        }], error: null };
      }
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-1/deletion-impact');
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.impact, {
      siteId: 'site-1', siteName: 'Portal', siteDomain: 'portal.example',
      checks: 38, incidents: 1, alertEvents: 2, alertDeliveries: 4,
      credentials: 3, credentialAudit: 8
    });
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
        ALERT_CRON_SECRET,
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
      ALERT_CRON_SECRET,
      CREDENTIALS_ENCRYPTION_KEY: VAULT_KEY,
      CREDENTIALS_MASTER_PASSWORD_HASH: MASTER_PASSWORD_HASH,
      ALLOWED_ORIGINS: 'https://monitoramento.tecnihub.com.br',
      TRUST_PROXY: '1'
    }));
    assert.throws(
      () => assertSecureProductionConfiguration({
        NODE_ENV: 'production',
        ADMIN_SESSION_SECRET: SESSION_SECRET,
        MONITOR_CRON_SECRET: 'curto',
        ALERT_CRON_SECRET
      }),
      /MONITOR_CRON_SECRET/
    );
    assert.throws(
      () => assertSecureProductionConfiguration({
        NODE_ENV: 'production',
        ADMIN_SESSION_SECRET: SESSION_SECRET,
        MONITOR_CRON_SECRET: CRON_SECRET,
        ALERT_CRON_SECRET: 'curto'
      }),
      /ALERT_CRON_SECRET/
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
    const wrongSecret = await fetch(`${baseUrl}/api/internal/monitor/run`, {
      method: 'POST', headers: { Authorization: 'Bearer segredo-incorreto-com-mais-de-32-bytes' }
    });
    assert.equal(wrongSecret.status, 401);
    assert.equal((await wrongSecret.json()).code, 'UNAUTHORIZED');
    const accepted = await fetch(`${baseUrl}/api/internal/monitor/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` }
    });
    assert.equal(accepted.status, 200);
    const acceptedText = await accepted.text();
    assert.equal(acceptedText.includes(CRON_SECRET), false);
    assert.equal(JSON.parse(acceptedText).claimed, 0);
  });

  it('cron espera o lote persistido terminar e usa lote/concorrência padrão 5', async () => {
    let releaseCycle!: () => void;
    let notifyCycleStarted!: () => void;
    const cycleStarted = new Promise<void>((resolve) => { notifyCycleStarted = resolve; });
    const cycleGate = new Promise<void>((resolve) => { releaseCycle = resolve; });
    const receivedArguments: unknown[][] = [];
    let alertRuns = 0;
    const baseUrl = await startTestServer({
      monitorCronSecret: CRON_SECRET,
      getSupabase: () => ({} as any),
      runMonitoringCycle: async (...args: any[]) => {
        receivedArguments.push(args);
        notifyCycleStarted();
        await cycleGate;
        return {
          acquired: true, runId: 'run-sync', claimed: 5, checked: 5,
          skipped: 0, failed: 0, concurrency: 5
        };
      },
      processAlertCycle: async () => {
        alertRuns++;
        return {
          runId: 'alerts-run', eventsClaimed: 0, eventsDispatched: 0,
          deliveriesCreated: 0, claimed: 0, delivered: 0, retried: 0,
          failed: 0, skipped: 0, concurrency: 2, durationMs: 0
        };
      }
    });
    let responseSettled = false;
    const responsePromise = fetch(`${baseUrl}/api/internal/monitor/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` }
    }).then((response) => {
      responseSettled = true;
      return response;
    });
    await cycleStarted;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(responseSettled, false);
    releaseCycle();
    const response = await responsePromise;
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.runId, 'run-sync');
    assert.equal(payload.claimed, 5);
    assert.equal(payload.checked, 5);
    assert.equal(payload.batchSize, 5);
    assert.equal(payload.concurrency, 5);
    assert.equal(payload.alertsDeferred, true);
    assert.equal(receivedArguments[0][1], 5);
    assert.equal(receivedArguments[0][4], 5);
    assert.equal(alertRuns, 0);
  });

  it('protege o cron de alertas com segredo separado e não expõe o segredo', async () => {
    let runs = 0;
    const baseUrl = await startTestServer({
      alertCronSecret: ALERT_CRON_SECRET,
      getSupabase: () => ({} as any),
      processAlertCycle: async () => {
        runs++;
        return {
          runId: 'alerts-run', eventsClaimed: 1, eventsDispatched: 1,
          deliveriesCreated: 2, claimed: 2, delivered: 1, retried: 1,
          failed: 0, skipped: 0, concurrency: 2, durationMs: 12
        };
      }
    });
    assert.equal((await fetch(`${baseUrl}/api/internal/alerts/run`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/internal/alerts/run`, {
      method: 'POST', headers: { Authorization: 'Bearer segredo-incorreto-com-mais-de-32-bytes' }
    })).status, 401);
    const accepted = await fetch(`${baseUrl}/api/internal/alerts/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${ALERT_CRON_SECRET}` }
    });
    const text = await accepted.text();
    assert.equal(accepted.status, 200);
    assert.equal(text.includes(ALERT_CRON_SECRET), false);
    assert.equal(JSON.parse(text).retried, 1);
    assert.equal(runs, 1);
  });

  it('cron de monitoramento e cron de alertas podem executar simultaneamente', async () => {
    let monitorActive = false;
    let alertsObservedMonitor = false;
    const baseUrl = await startTestServer({
      monitorCronSecret: CRON_SECRET,
      alertCronSecret: ALERT_CRON_SECRET,
      getSupabase: () => ({
        from: () => ({ select: () => ({ eq: () => ({ lte: async () => ({ count: 0, error: null }) }) }) })
      } as any),
      runMonitoringCycle: async () => {
        monitorActive = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
        monitorActive = false;
        return { acquired: true, runId: 'monitor-run', claimed: 1, checked: 1, skipped: 0, failed: 0, concurrency: 5 };
      },
      processAlertCycle: async () => {
        alertsObservedMonitor = monitorActive;
        return {
          runId: 'alerts-run', eventsClaimed: 0, eventsDispatched: 0,
          deliveriesCreated: 0, claimed: 0, delivered: 0, retried: 0,
          failed: 0, skipped: 0, concurrency: 2, durationMs: 1
        };
      }
    });
    const monitorRequest = fetch(`${baseUrl}/api/internal/monitor/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` }
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const alertsRequest = fetch(`${baseUrl}/api/internal/alerts/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${ALERT_CRON_SECRET}` }
    });
    const [monitorResponse, alertsResponse] = await Promise.all([monitorRequest, alertsRequest]);
    assert.equal(monitorResponse.status, 200);
    assert.equal(alertsResponse.status, 200);
    assert.equal(alertsObservedMonitor, true);
  });

  it('e-mail de teste apenas cria deliveries pendentes, sem incidente, check ou chamada ao provedor', async () => {
    let insertedRows: Array<Record<string, unknown>> = [];
    let providerCalls = 0;
    const supabase = {
      from(table: string) {
        if (table === 'alert_email_configs') return {
          select: () => ({ limit: () => ({ maybeSingle: async () => ({
            data: { id: 'email-config', recipients: ['a@example.com', 'b@example.com'] }, error: null
          }) }) })
        };
        if (table === 'alert_deliveries') return {
          async insert(rows: Array<Record<string, unknown>>) { insertedRows = rows; return { error: null }; }
        };
        throw new Error(`Tabela inesperada: ${table}`);
      }
    } as any;
    const baseUrl = await startTestServer({
      getSupabase: () => supabase,
      emailProvider: {
        name: 'resend', ready: true,
        async send() { providerCalls++; return { providerMessageId: 'unexpected', responseStatus: 200 }; }
      }
    });
    const response = await fetchAsAdmin(baseUrl, '/api/alerts/email/test', { method: 'POST', body: '{}' });
    const payload = await response.json();
    assert.equal(response.status, 202);
    assert.equal(payload.queued, 2);
    assert.equal(providerCalls, 0);
    assert.equal(insertedRows.every((row) => row.event_type === 'email_test' && !('incident_id' in row) && !('check_id' in row)), true);
  });

  it('configura múltiplos destinatários sem expor credenciais do provedor', async () => {
    let savedPayload: Record<string, unknown> | null = null;
    const supabase = {
      from(table: string) {
        if (table === 'alert_email_configs') return {
          select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert(payload: Record<string, unknown>) {
            savedPayload = payload;
            return {
              select: () => ({ single: async () => ({
                data: { id: 'email-config', ...payload, created_at: '2026-09-02T12:00:00.000Z', updated_at: '2026-09-02T12:00:00.000Z' },
                error: null
              }) })
            };
          }
        };
        throw new Error(`Tabela inesperada: ${table}`);
      }
    } as any;
    const provider = {
      name: 'resend', ready: true, apiKey: 'resend-secret-that-must-not-leak',
      async send() { return { providerMessageId: 'unused', responseStatus: 200 }; }
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase, emailProvider: provider });
    const response = await fetchAsAdmin(baseUrl, '/api/alerts/email', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        recipients: [' Operacao@Example.com ', 'operacao@example.com', 'gestor@example.com'],
        eventTypes: ['incident_confirmed', 'recovery', 'dns_changed']
      })
    });
    const text = await response.text();
    const payload = JSON.parse(text);
    assert.equal(response.status, 200);
    assert.deepEqual(savedPayload?.recipients, ['operacao@example.com', 'gestor@example.com']);
    assert.deepEqual(savedPayload?.event_types, ['incident_confirmed', 'recovery']);
    assert.equal(payload.email.providerReady, true);
    assert.equal(text.includes('resend-secret-that-must-not-leak'), false);
    assert.equal('apiKey' in payload.email, false);
  });

  it('verificar todos somente persiste a fila e responde 202 sem executar checks', async () => {
    let queuedPayload: Record<string, unknown> | null = null;
    let queueFilter: [string, unknown] | null = null;
    let rpcCalls = 0;
    const supabase = {
      from(table: string) {
        assert.equal(table, 'sites');
        return {
          update(payload: Record<string, unknown>) {
            queuedPayload = payload;
            return {
              async eq(field: string, value: unknown) {
                queueFilter = [field, value];
                return { error: null };
              }
            };
          }
        };
      },
      async rpc() {
        rpcCalls++;
        throw new Error('check não deveria ser executado');
      }
    } as any;
    const baseUrl = await startTestServer({ getSupabase: () => supabase });
    const response = await fetchAsAdmin(baseUrl, '/api/check-all', {
      method: 'POST', body: JSON.stringify({})
    });
    const payload = await response.json();
    assert.equal(response.status, 202);
    assert.equal(payload.success, true);
    assert.equal(payload.queued, true);
    assert.equal(typeof queuedPayload?.next_check_at, 'string');
    assert.deepEqual(queueFilter, ['is_active', true]);
    assert.equal(rpcCalls, 0);
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

  it('calcula relatório de SLA no banco com período resolvido e paginação limitada', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const report = {
      site: { id: 'site-1', slaTargetPercent: 99.9 },
      period: { hasData: true, hasFullCoverage: true },
      summary: { availabilityPercent: 99.97, slaStatus: 'within_sla' },
      incidents: [], pagination: { total: 0, hasMore: false }, formulaVersion: 1
    };
    const baseUrl = await startTestServer({
      now: () => Date.parse('2026-09-15T15:30:00.000Z'),
      getSupabase: () => ({
        async rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, args });
          return { data: report, error: null };
        }
      } as any)
    });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-1/sla?period=24h&limit=500&offset=50');
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.report, report);
    assert.equal(payload.period.label, 'Últimas 24 horas');
    assert.deepEqual(calls, [{
      name: 'get_site_sla_report',
      args: {
        p_site_id: 'site-1',
        p_period_start: '2026-09-14T15:30:00.000Z',
        p_period_end: '2026-09-15T15:30:00.000Z',
        p_incident_limit: 100,
        p_incident_offset: 50
      }
    }]);
  });

  it('rejeita período de SLA inválido sem consultar o banco', async () => {
    let rpcCalled = false;
    const baseUrl = await startTestServer({
      getSupabase: () => ({ rpc: async () => { rpcCalled = true; return { data: null, error: null }; } } as any)
    });
    const response = await fetchAsAdmin(baseUrl, '/api/sites/site-1/sla?period=year');
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_SLA_PERIOD');
    assert.equal(rpcCalled, false);
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
