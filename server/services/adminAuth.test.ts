import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { Server } from 'node:http';
import { assertSecureProductionConfiguration, createApp, CreateAppOptions } from '../index';
import { AdminAuthProvider, AdminIdentity } from './adminAuth';
import { ADMIN_SESSION_COOKIE } from './adminSession';
import { LoginRateLimiter } from './loginRateLimiter';

const SESSION_SECRET = 'test-only-session-secret-with-more-than-32-bytes';
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

function createFakeAuthProvider(): AdminAuthProvider {
  return {
    async authenticate(email, password) {
      if (email === activeAdmin.email && password === 'Senha-Correta-123!') return activeAdmin;
      if (email === inactiveAdmin.email && password === 'Senha-Correta-123!') return inactiveAdmin;
      return null;
    },
    async getById(userId) {
      if (userId === activeAdmin.id) return activeAdmin;
      if (userId === inactiveAdmin.id) return inactiveAdmin;
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
        ALLOWED_ORIGINS: '*'
      }),
      /wildcard/
    );
    assert.doesNotThrow(() => assertSecureProductionConfiguration({
      NODE_ENV: 'production',
      ADMIN_SESSION_SECRET: SESSION_SECRET,
      ALLOWED_ORIGINS: 'https://monitoramento.tecnihub.com.br',
      TRUST_PROXY: '1',
      MONITORING_SCHEDULER_ENABLED: 'true'
    }));
    assert.throws(
      () => assertSecureProductionConfiguration({
        NODE_ENV: 'production',
        ADMIN_SESSION_SECRET: SESSION_SECRET,
        MONITORING_SCHEDULER_ENABLED: 'sim'
      }),
      /MONITORING_SCHEDULER_ENABLED/
    );
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
