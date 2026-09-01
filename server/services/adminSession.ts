import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'tecnihub_admin_session';
export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

interface SessionPayload {
  userId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface SessionCookieOptions {
  secret: string;
  secure: boolean;
  ttlSeconds?: number;
  now?: () => number;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [cookieName, ...valueParts] = part.trim().split('=');
    if (cookieName === name) return valueParts.join('=') || null;
  }
  return null;
}

function serializeCookie(value: string, options: SessionCookieOptions, maxAge: number): string {
  const attributes = [
    `${ADMIN_SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function createAdminSessionCookie(userId: string, options: SessionCookieOptions): string {
  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const payload: SessionPayload = {
    userId,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
    nonce: randomBytes(18).toString('base64url')
  };
  const encodedPayload = encode(JSON.stringify(payload));
  const token = `${encodedPayload}.${sign(encodedPayload, options.secret)}`;
  return serializeCookie(token, options, ttlSeconds);
}

export function clearAdminSessionCookie(options: SessionCookieOptions): string {
  return serializeCookie('', options, 0);
}

export function verifyAdminSessionCookie(
  cookieHeader: string | undefined,
  options: SessionCookieOptions
): SessionPayload | null {
  const token = readCookie(cookieHeader, ADMIN_SESSION_COOKIE);
  if (!token) return null;
  const [encodedPayload, providedSignature, extra] = token.split('.');
  if (!encodedPayload || !providedSignature || extra) return null;

  const expectedSignature = sign(encodedPayload, options.secret);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(decode(encodedPayload)) as Partial<SessionPayload>;
    const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
    if (
      typeof payload.userId !== 'string' ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' ||
      typeof payload.nonce !== 'string' ||
      payload.expiresAt <= nowSeconds ||
      payload.issuedAt > nowSeconds + 30
    ) {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export function validateSessionSecret(secret: string): boolean {
  const normalized = secret.trim();
  if (Buffer.byteLength(normalized, 'utf8') < 32) return false;
  if (/placeholder|substitua|change[-_ ]?me|your[-_ ]?secret/i.test(normalized)) return false;
  return true;
}
