import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual
} from 'node:crypto';

export const VAULT_SESSION_COOKIE = 'tecnihub_vault_session';
export const DEFAULT_VAULT_SESSION_TTL_SECONDS = 5 * 60;
export const CREDENTIAL_CIPHER = 'aes-256-gcm' as const;
const MASTER_HASH_PREFIX = 'scrypt-v1';
const SCRYPT_KEY_LENGTH = 32;
interface ScryptOptions { N: number; r: number; p: number; maxmem: number; }
const SCRYPT_OPTIONS: ScryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveScrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export interface EncryptedCredentialSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  cipher: typeof CREDENTIAL_CIPHER;
  version: 1;
}

export interface VaultSessionCookieOptions {
  secret: string;
  secure: boolean;
  ttlSeconds?: number;
  now?: () => number;
}

export interface VaultSessionPayload {
  userId: string;
  authorizedAt: number;
  expiresAt: number;
  nonce: string;
}

function decodeEncryptionKey(encodedKey: string): Buffer | null {
  const value = encodedKey.trim();
  if (/^[a-f\d]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  if (!/^[A-Za-z0-9_-]{43}$/.test(value) && !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, value.includes('+') || value.includes('/') || value.endsWith('=') ? 'base64' : 'base64url');
  return key.length === 32 ? key : null;
}

export function validateCredentialsEncryptionKey(encodedKey: string): boolean {
  return decodeEncryptionKey(encodedKey) !== null;
}

export function encryptCredentialSecret(plaintext: string, encodedKey: string): EncryptedCredentialSecret {
  if (!plaintext) throw new Error('O segredo da credencial não pode ser vazio.');
  const key = decodeEncryptionKey(encodedKey);
  if (!key) throw new Error('CREDENTIALS_ENCRYPTION_KEY deve conter exatamente 32 bytes em base64url, base64 ou hexadecimal.');
  const iv = randomBytes(12);
  const cipher = createCipheriv(CREDENTIAL_CIPHER, key, iv);
  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      cipher: CREDENTIAL_CIPHER,
      version: 1
    };
  } finally {
    key.fill(0);
  }
}

export function decryptCredentialSecret(secret: EncryptedCredentialSecret, encodedKey: string): string {
  if (secret.cipher !== CREDENTIAL_CIPHER || secret.version !== 1) {
    throw new Error('Formato de credencial criptografada não suportado.');
  }
  const key = decodeEncryptionKey(encodedKey);
  if (!key) throw new Error('CREDENTIALS_ENCRYPTION_KEY inválida.');
  try {
    const decipher = createDecipheriv(CREDENTIAL_CIPHER, key, Buffer.from(secret.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } finally {
    key.fill(0);
  }
}

export async function hashMasterPassword(password: string, salt = randomBytes(16)): Promise<string> {
  if (password.length < 12) throw new Error('A senha mestre deve possuir ao menos 12 caracteres.');
  const derived = await deriveScrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return [MASTER_HASH_PREFIX, SCRYPT_OPTIONS.N, SCRYPT_OPTIONS.r, SCRYPT_OPTIONS.p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

function normalizeMasterPasswordHash(storedHash: string): string {
  let normalized = storedHash.trim();
  const hasMatchingQuotes = (normalized.startsWith('"') && normalized.endsWith('"'))
    || (normalized.startsWith("'") && normalized.endsWith("'"));
  if (hasMatchingQuotes) normalized = normalized.slice(1, -1).trim();
  return normalized.replaceAll('\\$', '$');
}

export function validateMasterPasswordHashFormat(storedHash: string): boolean {
  const [prefix, n, r, p, salt, hash, extra] = normalizeMasterPasswordHash(storedHash).split('$');
  return !extra && prefix === MASTER_HASH_PREFIX && Number(n) === SCRYPT_OPTIONS.N && Number(r) === SCRYPT_OPTIONS.r &&
    Number(p) === SCRYPT_OPTIONS.p && /^[A-Za-z0-9_-]{22}$/.test(salt || '') && /^[A-Za-z0-9_-]{43}$/.test(hash || '');
}

export async function verifyMasterPassword(password: string, storedHash: string): Promise<boolean> {
  const normalizedHash = normalizeMasterPasswordHash(storedHash);
  if (!password || password.length > 512 || !validateMasterPasswordHashFormat(normalizedHash)) return false;
  const [, n, r, p, saltValue, hashValue] = normalizedHash.split('$');
  const expected = Buffer.from(hashValue, 'base64url');
  const actual = await deriveScrypt(password, Buffer.from(saltValue, 'base64url'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_OPTIONS.maxmem
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function deriveVaultSigningKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('tecnihub:vault-session:v1').digest();
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', deriveVaultSigningKey(secret)).update(payload).digest('base64url');
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [cookieName, ...value] = part.trim().split('=');
    if (cookieName === name) return value.join('=') || null;
  }
  return null;
}

function serializeCookie(value: string, options: VaultSessionCookieOptions, maxAge: number): string {
  const attributes = [
    `${VAULT_SESSION_COOKIE}=${value}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function createVaultSessionCookie(userId: string, options: VaultSessionCookieOptions): string {
  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_VAULT_SESSION_TTL_SECONDS;
  const payload: VaultSessionPayload = {
    userId,
    authorizedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
    nonce: randomBytes(18).toString('base64url')
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return serializeCookie(`${encoded}.${sign(encoded, options.secret)}`, options, ttlSeconds);
}

export function clearVaultSessionCookie(options: VaultSessionCookieOptions): string {
  return serializeCookie('', options, 0);
}

export function verifyVaultSessionCookie(
  cookieHeader: string | undefined,
  expectedUserId: string,
  options: VaultSessionCookieOptions
): VaultSessionPayload | null {
  const token = readCookie(cookieHeader, VAULT_SESSION_COOKIE);
  if (!token) return null;
  const [encoded, providedSignature, extra] = token.split('.');
  if (!encoded || !providedSignature || extra) return null;
  const expectedSignature = sign(encoded, options.secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<VaultSessionPayload>;
    const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
    if (payload.userId !== expectedUserId || typeof payload.authorizedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' || typeof payload.nonce !== 'string' ||
      payload.expiresAt <= nowSeconds || payload.authorizedAt > nowSeconds + 30) return null;
    return payload as VaultSessionPayload;
  } catch {
    return null;
  }
}
