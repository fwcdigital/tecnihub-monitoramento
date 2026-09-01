import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createApp } from '../index';
import { AdminAuthProvider, AdminIdentity } from './adminAuth';
import {
  CredentialAuditEntry,
  CredentialMetadata,
  CredentialRecord,
  CredentialRepository,
  sanitizeCredential
} from './credentialRepository';
import {
  createVaultSessionCookie,
  decryptCredentialSecret,
  encryptCredentialSecret,
  hashMasterPassword,
  verifyMasterPassword,
  verifyVaultSessionCookie
} from './credentialsVault';

const SESSION_SECRET = 'vault-test-admin-session-secret-with-at-least-32-bytes';
const ENCRYPTION_KEY = randomBytes(32).toString('base64url');
const ADMIN: AdminIdentity = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'cofre@tecnihub.com.br', isAdmin: true, isActive: true
};

class MemoryCredentialRepository implements CredentialRepository {
  records: CredentialRecord[] = [];
  audits: CredentialAuditEntry[] = [];

  async siteExists(siteId: string) { return siteId === 'site-1'; }
  async list(siteId: string) { return this.records.filter((record) => record.site_id === siteId); }
  async get(id: string) { return this.records.find((record) => record.id === id) || null; }
  async create(payload: Omit<CredentialRecord, 'id' | 'created_at' | 'updated_at'>) {
    const record = { ...payload, id: `credential-${this.records.length + 1}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as CredentialRecord;
    this.records.push(record); return record;
  }
  async updateMetadata(id: string, payload: CredentialMetadata & { updated_by: string }) {
    const record = await this.get(id); if (!record) return null;
    Object.assign(record, payload, { updated_at: new Date().toISOString() }); return record;
  }
  async updatePassword(id: string, payload: Pick<CredentialRecord, 'secret_ciphertext' | 'secret_iv' | 'secret_auth_tag' | 'cipher_algorithm' | 'cipher_version' | 'updated_by'>) {
    const record = await this.get(id); if (!record) return null;
    Object.assign(record, payload, { updated_at: new Date().toISOString() }); return record;
  }
  async remove(id: string) {
    const index = this.records.findIndex((record) => record.id === id);
    if (index < 0) return false; this.records.splice(index, 1); return true;
  }
  async audit(entry: CredentialAuditEntry) { this.audits.push(entry); }
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

function authProvider(): AdminAuthProvider {
  return {
    authenticate: async (email, password) => email === ADMIN.email && password === 'Admin-Password-123!' ? ADMIN : null,
    getById: async (id) => id === ADMIN.id ? ADMIN : null
  };
}

async function startServer(repository: MemoryCredentialRepository, masterPasswordHash: string, now?: () => number) {
  const app = createApp({
    authProvider: authProvider(), getSupabase: () => null, getCredentialRepository: () => repository,
    secureCookie: false, sessionSecret: SESSION_SECRET, credentialsEncryptionKey: ENCRYPTION_KEY,
    masterPasswordHash, now, sessionTtlSeconds: 3600, vaultSessionTtlSeconds: 300
  });
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function login(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ email: ADMIN.email, password: 'Admin-Password-123!' })
  });
  return (response.headers.get('set-cookie') || '').split(';')[0];
}

async function adminFetch(baseUrl: string, cookie: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: cookie, ...(init.headers || {}) }
  });
}

describe('criptografia e autorização do cofre', () => {
  it('criptografa/descriptografa, usa nonce diferente e rejeita ciphertext adulterado', () => {
    const secret = 'segredo-unico-que-nao-deve-vazar';
    const first = encryptCredentialSecret(secret, ENCRYPTION_KEY);
    const second = encryptCredentialSecret(secret, ENCRYPTION_KEY);
    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.equal(decryptCredentialSecret(first, ENCRYPTION_KEY), secret);

    const tampered = Buffer.from(first.ciphertext, 'base64');
    tampered[0] ^= 1;
    assert.throws(() => decryptCredentialSecret({ ...first, ciphertext: tampered.toString('base64') }, ENCRYPTION_KEY));
  });

  it('valida senha mestre correta e rejeita a incorreta', async () => {
    const hash = await hashMasterPassword('Senha-Mestre-Correta-123!');
    assert.equal(await verifyMasterPassword('Senha-Mestre-Correta-123!', hash), true);
    assert.equal(await verifyMasterPassword('senha-incorreta', hash), false);
    assert.equal(hash.includes('Senha-Mestre-Correta'), false);
  });

  it('expira a autorização privilegiada e a vincula ao administrador', () => {
    let now = Date.parse('2026-09-01T12:00:00.000Z');
    const options = { secret: SESSION_SECRET, secure: false, ttlSeconds: 300, now: () => now };
    const cookie = createVaultSessionCookie(ADMIN.id, options).split(';')[0];
    assert.ok(verifyVaultSessionCookie(cookie, ADMIN.id, options));
    assert.equal(verifyVaultSessionCookie(cookie, 'outro-admin', options), null);
    now += 301_000;
    assert.equal(verifyVaultSessionCookie(cookie, ADMIN.id, options), null);
  });

  it('sanitiza o GET normal sem retornar material criptográfico', () => {
    const encrypted = encryptCredentialSecret('nao-retornar', ENCRYPTION_KEY);
    const safe = sanitizeCredential({
      id: 'id', site_id: 'site', type: 'WORDPRESS', service_name: null, provider: null,
      url: 'https://example.com/wp-admin', username: 'admin', protocol: null, host: null, port: null, notes: null,
      secret_ciphertext: encrypted.ciphertext, secret_iv: encrypted.iv, secret_auth_tag: encrypted.authTag,
      cipher_algorithm: encrypted.cipher, cipher_version: 1, created_by: ADMIN.id, updated_by: ADMIN.id,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    const serialized = JSON.stringify(safe);
    assert.equal(serialized.includes(encrypted.ciphertext), false);
    assert.equal(serialized.includes(encrypted.iv), false);
    assert.equal(serialized.includes('secret_'), false);
    assert.equal(safe.password, '••••••••••••');
  });
});

describe('API administrativa do cofre', () => {
  it('nega acesso sem sessão e nega cópia sem autorização privilegiada', async () => {
    const repository = new MemoryCredentialRepository();
    const hash = await hashMasterPassword('Senha-Mestre-Correta-123!');
    const baseUrl = await startServer(repository, hash);
    assert.equal((await fetch(`${baseUrl}/api/sites/site-1/accesses`)).status, 401);
    const cookie = await login(baseUrl);
    const response = await adminFetch(baseUrl, cookie, '/api/accesses/inexistente/copy-password', { method: 'POST', body: '{}' });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'VAULT_AUTHORIZATION_REQUIRED');
  });

  it('cria, lista, edita e exclui sem expor senha e registra auditoria', async () => {
    const repository = new MemoryCredentialRepository();
    const hash = await hashMasterPassword('Senha-Mestre-Correta-123!');
    const baseUrl = await startServer(repository, hash);
    const cookie = await login(baseUrl);
    const secret = 'Senha-do-WordPress-123!';
    const created = await adminFetch(baseUrl, cookie, '/api/sites/site-1/accesses', {
      method: 'POST', body: JSON.stringify({ type: 'WORDPRESS', url: 'https://cliente.example/wp-admin', username: 'admin', password: secret })
    });
    assert.equal(created.status, 201);
    const createdText = await created.text();
    assert.equal(createdText.includes(secret), false);
    assert.equal(createdText.includes('secret_ciphertext'), false);

    const listed = await adminFetch(baseUrl, cookie, '/api/sites/site-1/accesses');
    const listText = await listed.text();
    assert.equal(listed.status, 200);
    assert.equal(listText.includes(secret), false);
    assert.equal(listText.includes(repository.records[0].secret_ciphertext), false);

    const edited = await adminFetch(baseUrl, cookie, '/api/accesses/credential-1', {
      method: 'PATCH', body: JSON.stringify({ type: 'WORDPRESS', url: 'https://cliente.example/novo-admin', username: 'novo-admin' })
    });
    assert.equal(edited.status, 200);
    const removed = await adminFetch(baseUrl, cookie, '/api/accesses/credential-1', { method: 'DELETE', body: '{}' });
    assert.equal(removed.status, 204);
    assert.deepEqual(repository.audits.filter((audit) => audit.success).map((audit) => audit.action), [
      'credential_created', 'credential_updated', 'credential_removed'
    ]);
  });

  it('rejeita senha mestre incorreta, aceita a correta, copia e altera senha', async () => {
    const repository = new MemoryCredentialRepository();
    const masterPassword = 'Senha-Mestre-Correta-123!';
    const baseUrl = await startServer(repository, await hashMasterPassword(masterPassword));
    const adminCookie = await login(baseUrl);
    await adminFetch(baseUrl, adminCookie, '/api/sites/site-1/accesses', {
      method: 'POST', body: JSON.stringify({ type: 'SFTP', host: 'sftp.example', port: 22, username: 'deploy', password: 'Senha-Antiga-123!' })
    });

    const wrong = await adminFetch(baseUrl, adminCookie, '/api/vault/authorize', {
      method: 'POST', body: JSON.stringify({ masterPassword: 'incorreta' })
    });
    assert.equal(wrong.status, 401);

    const authorized = await adminFetch(baseUrl, adminCookie, '/api/vault/authorize', {
      method: 'POST', body: JSON.stringify({ masterPassword })
    });
    assert.equal(authorized.status, 200);
    const vaultCookie = (authorized.headers.get('set-cookie') || '').split(';')[0];
    const cookies = `${adminCookie}; ${vaultCookie}`;

    const copied = await adminFetch(baseUrl, cookies, '/api/accesses/credential-1/copy-password', { method: 'POST', body: '{}' });
    assert.equal(copied.status, 200);
    assert.equal((await copied.json()).password, 'Senha-Antiga-123!');

    const changed = await adminFetch(baseUrl, cookies, '/api/accesses/credential-1/password', {
      method: 'PUT', body: JSON.stringify({ newPassword: 'Senha-Nova-456!', confirmation: 'Senha-Nova-456!' })
    });
    assert.equal(changed.status, 200);
    const copiedAgain = await adminFetch(baseUrl, cookies, '/api/accesses/credential-1/copy-password', { method: 'POST', body: '{}' });
    assert.equal((await copiedAgain.json()).password, 'Senha-Nova-456!');
    assert.ok(repository.audits.some((audit) => audit.action === 'vault_authorization_failed' && !audit.success));
    assert.ok(repository.audits.some((audit) => audit.action === 'password_copied'));
    assert.ok(repository.audits.some((audit) => audit.action === 'password_changed'));
  });

  it('recusa a operação sensível depois que a autorização de cinco minutos expira', async () => {
    let currentTime = Date.parse('2026-09-01T12:00:00.000Z');
    const repository = new MemoryCredentialRepository();
    const masterPassword = 'Senha-Mestre-Correta-123!';
    const baseUrl = await startServer(repository, await hashMasterPassword(masterPassword), () => currentTime);
    const adminCookie = await login(baseUrl);
    const authorized = await adminFetch(baseUrl, adminCookie, '/api/vault/authorize', {
      method: 'POST', body: JSON.stringify({ masterPassword })
    });
    const vaultCookie = (authorized.headers.get('set-cookie') || '').split(';')[0];
    currentTime += 301_000;
    const response = await adminFetch(baseUrl, `${adminCookie}; ${vaultCookie}`, '/api/accesses/credential-1/copy-password', { method: 'POST', body: '{}' });
    assert.equal(response.status, 403);
  });

  it('não inclui segredo nos logs de requisição ou auditoria', async () => {
    const repository = new MemoryCredentialRepository();
    const baseUrl = await startServer(repository, await hashMasterPassword('Senha-Mestre-Correta-123!'));
    const adminCookie = await login(baseUrl);
    const secret = 'SEGREDO-NAO-PODE-APARECER-987';
    const captured: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values: unknown[]) => { captured.push(values.join(' ')); };
    console.error = (...values: unknown[]) => { captured.push(values.join(' ')); };
    try {
      const response = await adminFetch(baseUrl, adminCookie, '/api/sites/site-1/accesses', {
        method: 'POST', body: JSON.stringify({ type: 'OUTROS', serviceName: 'Serviço', username: 'user', password: secret, notes: 'sem dados sensíveis' })
      });
      assert.equal(response.status, 201);
    } finally {
      console.log = originalLog; console.error = originalError;
    }
    assert.equal(captured.join('\n').includes(secret), false);
    assert.equal(JSON.stringify(repository.audits).includes(secret), false);
  });
});
