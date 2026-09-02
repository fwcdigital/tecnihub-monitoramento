import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabase } from './supabase';
import { AdminAuthProvider, AdminIdentity, createSupabaseAdminAuthProvider } from './services/adminAuth';
import {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  DEFAULT_SESSION_TTL_SECONDS,
  SessionCookieOptions,
  validateSessionSecret,
  verifyAdminSessionCookie
} from './services/adminSession';
import { LoginRateLimiter } from './services/loginRateLimiter';
import { normalizeHttpUrl, validateUrlForSSRF } from './services/ssrfProtection';
import { processSiteCheck, SiteCheckError } from './services/siteCheckService';
import {
  isSupportedCheckInterval,
  resolveMonitorCronBatchSize,
  resolveMonitorCronConcurrency,
  runMonitoringCycle
} from './services/monitoringScheduler';
import {
  processAlertCycle,
  resolveEmailDeliveryBatchSize,
  resolveEmailDeliveryConcurrency
} from './services/alertDeliveryService';
import { createEmailProviderFromEnv, EmailProvider } from './services/emailAlertService';
import {
  CredentialMetadata,
  CredentialRepository,
  CredentialType,
  sanitizeCredential,
  SupabaseCredentialRepository
} from './services/credentialRepository';
import {
  clearVaultSessionCookie,
  createVaultSessionCookie,
  decryptCredentialSecret,
  DEFAULT_VAULT_SESSION_TTL_SECONDS,
  encryptCredentialSecret,
  validateCredentialsEncryptionKey,
  validateMasterPasswordHashFormat,
  verifyMasterPassword,
  verifyVaultSessionCookie,
  VaultSessionCookieOptions
} from './services/credentialsVault';

dotenv.config();

export const MONITOR_CRON_BATCH_SIZE = resolveMonitorCronBatchSize(process.env.MONITOR_CRON_BATCH_SIZE);
export const MONITOR_CRON_CONCURRENCY = resolveMonitorCronConcurrency(process.env.MONITOR_CRON_CONCURRENCY);
export const EMAIL_DELIVERY_BATCH_SIZE = resolveEmailDeliveryBatchSize(process.env.EMAIL_DELIVERY_BATCH_SIZE);
export const EMAIL_DELIVERY_CONCURRENCY = resolveEmailDeliveryConcurrency(process.env.EMAIL_DELIVERY_CONCURRENCY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AuthenticatedRequest extends Request {
  admin?: AdminIdentity;
}

export interface CreateAppOptions {
  authProvider?: AdminAuthProvider | null;
  getSupabase?: () => SupabaseClient | null;
  loginRateLimiter?: LoginRateLimiter;
  publicStatusRateLimiter?: LoginRateLimiter;
  now?: () => number;
  isProduction?: boolean;
  allowedOrigins?: string[];
  trustProxy?: boolean;
  secureCookie?: boolean;
  sessionSecret?: string;
  monitorCronSecret?: string;
  alertCronSecret?: string;
  sessionTtlSeconds?: number;
  credentialsEncryptionKey?: string;
  masterPasswordHash?: string;
  vaultSessionTtlSeconds?: number;
  vaultAuthorizationRateLimiter?: LoginRateLimiter;
  vaultRevealRateLimiter?: LoginRateLimiter;
  getCredentialRepository?: () => CredentialRepository | null;
  runMonitoringCycle?: typeof runMonitoringCycle;
  processAlertCycle?: typeof processAlertCycle;
  emailProvider?: EmailProvider;
}

function getAllowedOrigins(isProduction: boolean): string[] {
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length) return configured;
  if (isProduction) return [];
  return ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];
}

function getRequestError(error: unknown, isProduction: boolean): { statusCode: number; code: string; message: string } {
  if (error instanceof SiteCheckError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: isProduction && error.statusCode >= 500 ? 'Erro interno da API.' : error.message
    };
  }
  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: isProduction ? 'Erro interno da API.' : error instanceof Error ? error.message : 'Erro interno inesperado.'
  };
}

function sendDatabaseUnavailable(res: Response, isProduction: boolean) {
  return res.status(503).json({
    error: isProduction
      ? 'Serviço temporariamente indisponível.'
      : 'Supabase não está configurado no backend com a service role.',
    code: 'DATABASE_UNAVAILABLE'
  });
}

async function countRemainingDueSites(supabase: SupabaseClient, nowIso: string): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .lte('next_check_at', nowIso)
      .or(`monitoring_claimed_until.is.null,monitoring_claimed_until.lte.${nowIso}`);
    return error ? null : count || 0;
  } catch {
    return null;
  }
}

function publicStatusForSite(site: any, latestCheck: any, activeIncident?: any): 'online' | 'warning' | 'critical' | 'offline' | 'unknown' {
  if (activeIncident && !latestCheck) return 'critical';
  if (!latestCheck) return 'unknown';
  if (activeIncident) {
    if (latestCheck.status === 'offline' || latestCheck.status === 'critical') return latestCheck.status;
    return 'warning';
  }
  if (site.monitoring_state === 'down') {
    return latestCheck.status === 'offline' ? 'offline' : 'critical';
  }
  if (['suspected_failure', 'recovering', 'security_blocked'].includes(site.monitoring_state)) return 'warning';
  if (latestCheck.status === 'security_blocked') return 'warning';
  return ['online', 'warning', 'critical', 'offline'].includes(latestCheck.status)
    ? latestCheck.status
    : 'unknown';
}

export function assertSecureProductionConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  if (!validateSessionSecret(env.ADMIN_SESSION_SECRET || '')) {
    throw new Error('ADMIN_SESSION_SECRET é obrigatório em produção e deve possuir ao menos 32 bytes aleatórios.');
  }

  if (!validateSessionSecret(env.MONITOR_CRON_SECRET || '')) {
    throw new Error('MONITOR_CRON_SECRET é obrigatório em produção e deve possuir ao menos 32 bytes aleatórios.');
  }

  if (!validateSessionSecret(env.ALERT_CRON_SECRET || '')) {
    throw new Error('ALERT_CRON_SECRET é obrigatório em produção e deve possuir ao menos 32 bytes aleatórios.');
  }

  if (!validateCredentialsEncryptionKey(env.CREDENTIALS_ENCRYPTION_KEY || '')) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY é obrigatória em produção e deve representar exatamente 32 bytes.');
  }

  if (!validateMasterPasswordHashFormat(env.CREDENTIALS_MASTER_PASSWORD_HASH || '')) {
    throw new Error('CREDENTIALS_MASTER_PASSWORD_HASH é obrigatório em produção e deve ser gerado pelo script administrativo.');
  }

  const origins = (env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  for (const origin of origins) {
    if (origin === '*') throw new Error('ALLOWED_ORIGINS não pode utilizar wildcard em produção.');
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('ALLOWED_ORIGINS contém uma origem inválida.');
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
      throw new Error('ALLOWED_ORIGINS deve conter apenas origins HTTPS exatas em produção.');
    }
  }

  if (env.TRUST_PROXY && !['0', '1'].includes(env.TRUST_PROXY)) {
    throw new Error('TRUST_PROXY deve ser 0 ou 1. Use 1 somente atrás de exatamente um proxy confiável.');
  }

}

function secretsMatch(provided: string, expected: string): boolean {
  if (!provided || !validateSessionSecret(expected)) return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

async function validateAdministrativeUrl(url: string): Promise<string> {
  const normalizedUrl = normalizeHttpUrl(url);
  const validation = await validateUrlForSSRF(normalizedUrl);
  if (!validation.valid) {
    throw new SiteCheckError(
      validation.error || 'URL inválida ou bloqueada pela proteção SSRF.',
      400,
      validation.errorType || 'INVALID_URL'
    );
  }
  return normalizedUrl;
}

function buildSitePayload(body: Record<string, any>) {
  return {
    client_name: String(body.client_name || '').trim(),
    name: String(body.name || '').trim(),
    url: String(body.url || '').trim(),
    domain: String(body.domain || '').trim().toLowerCase(),
    hosting_provider: String(body.hosting_provider || 'Hostinger').trim(),
    is_wordpress: Boolean(body.is_wordpress),
    is_active: body.is_active !== false,
    check_interval: String(body.check_interval || '5min').trim(),
    monitor_response_time: body.monitor_response_time !== false,
    monitor_ssl: body.monitor_ssl !== false,
    monitor_domain: body.monitor_domain !== false,
    expected_content: body.expected_content ? String(body.expected_content).trim() : null,
    expected_ga4_id: body.expected_ga4_id ? String(body.expected_ga4_id).trim() : null,
    expected_gtm_id: body.expected_gtm_id ? String(body.expected_gtm_id).trim() : null,
    expected_google_ads_id: body.expected_google_ads_id ? String(body.expected_google_ads_id).trim() : null,
    expected_meta_pixel_id: body.expected_meta_pixel_id ? String(body.expected_meta_pixel_id).trim() : null,
    uses_search_console: Boolean(body.uses_search_console),
    uses_rd_station: Boolean(body.uses_rd_station)
  };
}

const CREDENTIAL_TYPES = new Set<CredentialType>(['WORDPRESS', 'HOSPEDAGEM', 'FTP', 'SFTP', 'OUTROS']);

function nullableString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new SiteCheckError('Campo de acesso técnico excede o tamanho permitido.', 400, 'INVALID_CREDENTIAL_PAYLOAD');
  return normalized;
}

function normalizeCredentialUrl(value: unknown): string | null {
  const normalized = nullableString(value, 2048);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    return parsed.toString();
  } catch {
    throw new SiteCheckError('A URL do acesso deve ser HTTP ou HTTPS válida.', 400, 'INVALID_CREDENTIAL_URL');
  }
}

function buildCredentialMetadata(body: Record<string, unknown>): CredentialMetadata {
  const type = String(body.type || '').trim().toUpperCase() as CredentialType;
  if (!CREDENTIAL_TYPES.has(type)) {
    throw new SiteCheckError('Tipo de acesso técnico inválido.', 400, 'INVALID_CREDENTIAL_TYPE');
  }
  const portValue = body.port === null || body.port === undefined || body.port === '' ? null : Number(body.port);
  if (portValue !== null && (!Number.isInteger(portValue) || portValue < 1 || portValue > 65_535)) {
    throw new SiteCheckError('A porta deve ser um inteiro entre 1 e 65535.', 400, 'INVALID_CREDENTIAL_PORT');
  }
  const metadata: CredentialMetadata = {
    type,
    service_name: nullableString(body.serviceName, 160),
    provider: nullableString(body.provider, 160),
    url: normalizeCredentialUrl(body.url),
    username: nullableString(body.username, 320),
    protocol: type === 'FTP' || type === 'SFTP' ? type : null,
    host: nullableString(body.host, 255),
    port: portValue,
    notes: nullableString(body.notes, 2000)
  };
  const invalid =
    (type === 'WORDPRESS' && (!metadata.url || !metadata.username)) ||
    (type === 'HOSPEDAGEM' && (!metadata.provider || !metadata.url || !metadata.username)) ||
    ((type === 'FTP' || type === 'SFTP') && (!metadata.host || !metadata.port || !metadata.username)) ||
    (type === 'OUTROS' && !metadata.service_name);
  if (invalid) {
    throw new SiteCheckError('Preencha os campos obrigatórios do tipo de acesso selecionado.', 400, 'INVALID_CREDENTIAL_PAYLOAD');
  }
  return metadata;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const allowedOrigins = options.allowedOrigins ?? getAllowedOrigins(isProduction);
  const getSupabase = options.getSupabase || getServerSupabase;
  const authProvider = options.authProvider === undefined
    ? createSupabaseAdminAuthProvider()
    : options.authProvider;
  const sessionSecret = options.sessionSecret ?? process.env.ADMIN_SESSION_SECRET ?? '';
  const monitorCronSecret = options.monitorCronSecret ?? process.env.MONITOR_CRON_SECRET ?? '';
  const alertCronSecret = options.alertCronSecret ?? process.env.ALERT_CRON_SECRET ?? '';
  const credentialsEncryptionKey = options.credentialsEncryptionKey ?? process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
  const masterPasswordHash = options.masterPasswordHash ?? process.env.CREDENTIALS_MASTER_PASSWORD_HASH ?? '';
  const configuredTtl = Number(process.env.ADMIN_SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS);
  const sessionOptions: SessionCookieOptions = {
    secret: sessionSecret,
    secure: options.secureCookie ?? isProduction,
    ttlSeconds: options.sessionTtlSeconds ?? (
      Number.isInteger(configuredTtl) && configuredTtl >= 300 && configuredTtl <= 86400
        ? configuredTtl
        : DEFAULT_SESSION_TTL_SECONDS
    ),
    now: options.now
  };
  const loginRateLimiter = options.loginRateLimiter || new LoginRateLimiter();
  const publicStatusRateLimiter = options.publicStatusRateLimiter || new LoginRateLimiter(120, 60_000);
  const vaultAuthorizationRateLimiter = options.vaultAuthorizationRateLimiter || new LoginRateLimiter(5, 15 * 60_000);
  const vaultRevealRateLimiter = options.vaultRevealRateLimiter || new LoginRateLimiter(20, 60_000);
  const vaultSessionOptions: VaultSessionCookieOptions = {
    secret: sessionSecret,
    secure: options.secureCookie ?? isProduction,
    ttlSeconds: options.vaultSessionTtlSeconds ?? DEFAULT_VAULT_SESSION_TTL_SECONDS,
    now: options.now
  };
  const getCredentialRepository = options.getCredentialRepository || (() => {
    const supabase = getSupabase();
    return supabase ? new SupabaseCredentialRepository(supabase) : null;
  });
  const runMonitorCycle = options.runMonitoringCycle || runMonitoringCycle;
  const runAlertCycle = options.processAlertCycle || processAlertCycle;
  const emailProvider = options.emailProvider || createEmailProviderFromEnv();

  app.disable('x-powered-by');
  if (options.trustProxy ?? process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  const isTrustedOrigin = (req: Request, origin: string): boolean => {
    const sameOrigin = `${req.protocol}://${req.get('host')}`;
    return origin === sameOrigin || allowedOrigins.includes(origin);
  };

  app.use((req, res, next) => {
    return cors({
      origin(origin, callback) {
        if (!origin || isTrustedOrigin(req, origin)) return callback(null, true);
        const error = new Error('Origem não permitida pela política CORS.') as Error & { statusCode?: number };
        error.statusCode = 403;
        return callback(error);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    })(req, res, next);
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"]
      }
    },
    hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'no-referrer' }
  }));
  app.use(express.json({ limit: '100kb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    const requestPath = req.path;
    res.on('finish', () => {
      // Log only the path. Query strings may contain sensitive values in future integrations.
      console.log(`[${req.method}] ${requestPath} - ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  app.get('/api/health', (req, res) => {
    const rateLimitKey = req.ip || req.socket.remoteAddress || 'unknown';
    const limit = publicStatusRateLimiter.consume(rateLimitKey);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        error: 'Limite temporário de consultas atingido.',
        code: 'PUBLIC_STATUS_RATE_LIMITED'
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      service: 'tecnihub-monitor-backend',
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/public/status', async (req, res) => {
    const rateLimitKey = req.ip || req.socket.remoteAddress || 'unknown';
    const limit = publicStatusRateLimiter.consume(`public-status:${rateLimitKey}`);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ error: 'Limite temporário de consultas atingido.', code: 'PUBLIC_STATUS_RATE_LIMITED' });
    }
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Página de status temporariamente indisponível.', code: 'PUBLIC_STATUS_UNAVAILABLE' });
    const overview = await supabase.rpc('get_sites_overview');
    let rows = overview.data || [];
    if (overview.error) {
      // Compatibility path for the controlled interval before migration 003 is
      // applied. It remains bounded, read-only and exposes only the same public
      // projection. Historical metrics stay unavailable instead of being invented.
      const fallback = await supabase
        .from('sites')
        .select('id, name, domain, is_active, checks(status, checked_at, response_time)')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .order('checked_at', { referencedTable: 'checks', ascending: false })
        .limit(1, { referencedTable: 'checks' })
        .limit(1000);
      if (fallback.error) {
        return res.status(503).json({ error: 'Página de status temporariamente indisponível.', code: 'PUBLIC_STATUS_UNAVAILABLE' });
      }
      rows = (fallback.data || []).map((site: any) => ({
        site,
        latest_check: Array.isArray(site.checks) ? site.checks[0] || null : null,
        metrics: {}
      }));
    }
    const sites = rows
      .filter((entry: any) => entry.site?.is_active === true)
      .map((entry: any) => {
        const site = entry.site;
        const latest = entry.latest_check;
        const metric = entry.metrics?.['30d'];
        const responseTimeIsValid = latest
          && latest.response_time != null
          && latest.incident_eligible !== true
          && latest.status !== 'offline'
          && latest.status !== 'security_blocked'
          && (latest.http_status != null || latest.status === 'online' || latest.status === 'warning');
        return {
          name: site.name,
          domain: site.domain,
          status: publicStatusForSite(site, latest, entry.active_incident),
          lastCheckedAt: latest?.checked_at || site.last_checked_at || null,
          responseTimeMs: responseTimeIsValid ? latest.response_time : null,
          uptime30d: metric?.totalChecks > 0 ? {
            percentage: metric.uptimePercent,
            reliable: Boolean(metric.hasFullWindow),
            sampleSize: metric.totalChecks
          } : null
        };
      });
    return res.json({ generatedAt: new Date().toISOString(), sites });
  });

  app.post('/api/internal/monitor/run', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const authorization = req.get('authorization') || '';
    const providedSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!secretsMatch(providedSecret, monitorCronSecret)) {
      return res.status(401).json({ error: 'Não autorizado.', code: 'UNAUTHORIZED' });
    }
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);
    const startedAt = Date.now();
    try {
      const cycleStartedAt = Date.now();
      const cycle = await runMonitorCycle(
        supabase,
        MONITOR_CRON_CONCURRENCY,
        cycleStartedAt,
        'cron',
        MONITOR_CRON_BATCH_SIZE
      );
      const remainingDue = await countRemainingDueSites(supabase, new Date().toISOString());
      return res.status(200).json({
        success: true,
        overlappingRun: !cycle.acquired,
        runId: cycle.runId,
        claimed: cycle.claimed,
        checked: cycle.checked,
        failed: cycle.failed,
        remainingDue,
        batchSize: MONITOR_CRON_BATCH_SIZE,
        concurrency: cycle.concurrency,
        durationMs: Date.now() - startedAt,
        alertsDeferred: true
      });
    } catch (error) {
      console.error('[Internal Monitor Run]', error instanceof Error ? error.message : 'erro inesperado');
      return res.status(500).json({ error: 'Falha ao executar ciclo de monitoramento.', code: 'MONITOR_RUN_FAILED' });
    }
  });

  app.post('/api/internal/alerts/run', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const authorization = req.get('authorization') || '';
    const providedSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!secretsMatch(providedSecret, alertCronSecret)) {
      return res.status(401).json({ error: 'Não autorizado.', code: 'UNAUTHORIZED' });
    }
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);
    try {
      const result = await runAlertCycle(supabase, {
        batchSize: EMAIL_DELIVERY_BATCH_SIZE,
        concurrency: EMAIL_DELIVERY_CONCURRENCY,
        emailProvider,
        monitorPublicUrl: process.env.MONITOR_PUBLIC_URL
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      console.error('[Internal Alerts Run]', error instanceof Error ? error.message : 'erro inesperado');
      return res.status(500).json({ error: 'Falha ao executar ciclo de alertas.', code: 'ALERT_RUN_FAILED' });
    }
  });

  const requireTrustedWriteOrigin = (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin || !isTrustedOrigin(req, origin)) {
      return res.status(403).json({
        error: 'Origem da requisição não autorizada.',
        code: 'CSRF_ORIGIN_DENIED'
      });
    }
    return next();
  };

  const sendAuthUnavailable = (res: Response) => res.status(503).json({
    error: 'Autenticação administrativa indisponível.',
    code: 'AUTH_UNAVAILABLE'
  });

  app.post('/api/auth/login', requireTrustedWriteOrigin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!authProvider || !validateSessionSecret(sessionSecret)) return sendAuthUnavailable(res);

    const rateLimitKey = req.ip || req.socket.remoteAddress || 'unknown';
    const limit = loginRateLimiter.check(rateLimitKey);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
        code: 'LOGIN_RATE_LIMITED'
      });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || email.length > 254 || !password || password.length > 512) {
      loginRateLimiter.recordFailure(rateLimitKey);
      return res.status(401).json({ error: 'E-mail ou senha inválidos.', code: 'INVALID_CREDENTIALS' });
    }

    try {
      const identity = await authProvider.authenticate(email, password);
      if (!identity?.isAdmin || !identity.isActive) {
        loginRateLimiter.recordFailure(rateLimitKey);
        return res.status(401).json({ error: 'E-mail ou senha inválidos.', code: 'INVALID_CREDENTIALS' });
      }

      loginRateLimiter.reset(rateLimitKey);
      res.setHeader('Set-Cookie', createAdminSessionCookie(identity.id, sessionOptions));
      return res.json({ user: { id: identity.id, email: identity.email } });
    } catch {
      return sendAuthUnavailable(res);
    }
  });

  app.post('/api/auth/logout', requireTrustedWriteOrigin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', [clearAdminSessionCookie(sessionOptions), clearVaultSessionCookie(vaultSessionOptions)]);
    return res.status(204).end();
  });

  const requireAdminSession = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!authProvider || !validateSessionSecret(sessionSecret)) return sendAuthUnavailable(res);

    const session = verifyAdminSessionCookie(req.get('cookie'), sessionOptions);
    if (!session) {
      res.setHeader('Set-Cookie', clearAdminSessionCookie(sessionOptions));
      return res.status(401).json({ error: 'Sessão inválida ou expirada.', code: 'UNAUTHORIZED' });
    }

    try {
      const identity = await authProvider.getById(session.userId);
      if (!identity?.isAdmin || !identity.isActive) {
        res.setHeader('Set-Cookie', clearAdminSessionCookie(sessionOptions));
        return res.status(401).json({ error: 'Sessão inválida ou expirada.', code: 'UNAUTHORIZED' });
      }
      req.admin = identity;
      return next();
    } catch {
      return sendAuthUnavailable(res);
    }
  };

  app.get('/api/auth/session', requireAdminSession, (req: AuthenticatedRequest, res) => {
    return res.json({ user: { id: req.admin!.id, email: req.admin!.email } });
  });

  // Everything below /api is administrative. Future public endpoints must be
  // mounted explicitly before this middleware under a separate /api/public path.
  app.use('/api', requireAdminSession);
  app.use('/api', requireTrustedWriteOrigin);

  const recordVaultAudit = async (
    repository: CredentialRepository,
    req: AuthenticatedRequest,
    entry: Omit<Parameters<CredentialRepository['audit']>[0], 'admin_id' | 'admin_email'>
  ) => {
    try {
      await repository.audit({
        ...entry,
        admin_id: req.admin!.id,
        admin_email: req.admin!.email
      });
    } catch {
      // Do not include request bodies, database errors or secrets in application logs.
      console.error('[Vault Audit] Não foi possível registrar uma ação administrativa.');
    }
  };

  const requireVaultAuthorization = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authorization = verifyVaultSessionCookie(req.get('cookie'), req.admin!.id, vaultSessionOptions);
    if (authorization) return next();
    res.setHeader('Set-Cookie', clearVaultSessionCookie(vaultSessionOptions));
    const repository = getCredentialRepository();
    if (repository) {
      await recordVaultAudit(repository, req, {
        credential_id: req.params.credentialId || null,
        site_id: null,
        action: 'vault_authorization_failed',
        success: false,
        details: { reason: 'privileged_session_missing_or_expired' }
      });
    }
    return res.status(403).json({
      error: 'Autorize o cofre com a senha mestre para continuar.',
      code: 'VAULT_AUTHORIZATION_REQUIRED'
    });
  };

  app.get('/api/vault/session', (req: AuthenticatedRequest, res) => {
    const authorization = verifyVaultSessionCookie(req.get('cookie'), req.admin!.id, vaultSessionOptions);
    return res.json({ authorized: Boolean(authorization), expiresAt: authorization ? new Date(authorization.expiresAt * 1000).toISOString() : null });
  });

  app.post('/api/vault/authorize', async (req: AuthenticatedRequest, res) => {
    const repository = getCredentialRepository();
    if (!repository) return sendDatabaseUnavailable(res, isProduction);
    if (!validateMasterPasswordHashFormat(masterPasswordHash)) {
      return res.status(503).json({ error: 'Senha mestre do cofre ainda não configurada.', code: 'VAULT_NOT_CONFIGURED' });
    }
    const rateLimitKey = `${req.admin!.id}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const limit = vaultAuthorizationRateLimiter.check(rateLimitKey);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde para autorizar o cofre novamente.', code: 'VAULT_RATE_LIMITED' });
    }
    const password = typeof req.body?.masterPassword === 'string' ? req.body.masterPassword : '';
    let valid = false;
    try {
      valid = await verifyMasterPassword(password, masterPasswordHash);
    } catch {
      valid = false;
    }
    if (!valid) {
      vaultAuthorizationRateLimiter.recordFailure(rateLimitKey);
      await recordVaultAudit(repository, req, {
        action: 'vault_authorization_failed', success: false, details: { reason: 'invalid_master_password' }
      });
      return res.status(401).json({ error: 'Senha mestre inválida.', code: 'INVALID_MASTER_PASSWORD' });
    }
    vaultAuthorizationRateLimiter.reset(rateLimitKey);
    res.setHeader('Set-Cookie', createVaultSessionCookie(req.admin!.id, vaultSessionOptions));
    await recordVaultAudit(repository, req, { action: 'vault_authorized', success: true });
    const expiresAt = new Date((options.now?.() ?? Date.now()) + (vaultSessionOptions.ttlSeconds || DEFAULT_VAULT_SESSION_TTL_SECONDS) * 1000).toISOString();
    return res.json({ authorized: true, expiresAt });
  });

  app.delete('/api/vault/session', (_req, res) => {
    res.setHeader('Set-Cookie', clearVaultSessionCookie(vaultSessionOptions));
    return res.status(204).end();
  });

  app.get('/api/sites/:siteId/accesses', async (req, res) => {
    const repository = getCredentialRepository();
    if (!repository) return sendDatabaseUnavailable(res, isProduction);
    try {
      const credentials = await repository.list(req.params.siteId);
      return res.json({ accesses: credentials.map(sanitizeCredential) });
    } catch {
      return res.status(500).json({ error: 'Falha ao carregar os acessos técnicos.', code: 'CREDENTIALS_QUERY_FAILED' });
    }
  });

  app.post('/api/sites/:siteId/accesses', async (req: AuthenticatedRequest, res) => {
    const repository = getCredentialRepository();
    if (!repository) return sendDatabaseUnavailable(res, isProduction);
    if (!validateCredentialsEncryptionKey(credentialsEncryptionKey)) {
      return res.status(503).json({ error: 'Criptografia do cofre ainda não configurada.', code: 'VAULT_NOT_CONFIGURED' });
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password || password.length > 4096) {
      return res.status(400).json({ error: 'Informe uma senha válida para o acesso.', code: 'CREDENTIAL_PASSWORD_REQUIRED' });
    }
    try {
      if (!await repository.siteExists(req.params.siteId)) {
        return res.status(404).json({ error: 'Site não encontrado.', code: 'SITE_NOT_FOUND' });
      }
      const metadata = buildCredentialMetadata(req.body || {});
      const encrypted = encryptCredentialSecret(password, credentialsEncryptionKey);
      const credential = await repository.create({
        site_id: req.params.siteId,
        ...metadata,
        secret_ciphertext: encrypted.ciphertext,
        secret_iv: encrypted.iv,
        secret_auth_tag: encrypted.authTag,
        cipher_algorithm: encrypted.cipher,
        cipher_version: encrypted.version,
        created_by: req.admin!.id,
        updated_by: req.admin!.id
      });
      await recordVaultAudit(repository, req, {
        credential_id: credential.id, site_id: credential.site_id, action: 'credential_created', success: true,
        details: { type: credential.type }
      });
      return res.status(201).json({ access: sanitizeCredential(credential) });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.patch('/api/accesses/:credentialId', async (req: AuthenticatedRequest, res) => {
    const repository = getCredentialRepository();
    if (!repository) return sendDatabaseUnavailable(res, isProduction);
    if ('password' in (req.body || {}) || 'newPassword' in (req.body || {})) {
      return res.status(400).json({ error: 'Use a operação privilegiada para alterar a senha.', code: 'USE_PASSWORD_ENDPOINT' });
    }
    try {
      const metadata = buildCredentialMetadata(req.body || {});
      const credential = await repository.updateMetadata(req.params.credentialId, { ...metadata, updated_by: req.admin!.id });
      if (!credential) return res.status(404).json({ error: 'Acesso não encontrado.', code: 'CREDENTIAL_NOT_FOUND' });
      await recordVaultAudit(repository, req, {
        credential_id: credential.id, site_id: credential.site_id, action: 'credential_updated', success: true,
        details: { type: credential.type }
      });
      return res.json({ access: sanitizeCredential(credential) });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/accesses/:credentialId/copy-password', requireVaultAuthorization, async (req: AuthenticatedRequest, res) => {
    const repository = getCredentialRepository();
    if (!repository) return sendDatabaseUnavailable(res, isProduction);
    if (!validateCredentialsEncryptionKey(credentialsEncryptionKey)) {
      return res.status(503).json({ error: 'Criptografia do cofre indisponível.', code: 'VAULT_NOT_CONFIGURED' });
    }
    const rateLimitKey = `${req.admin!.id}:${req.params.credentialId}`;
    const limit = vaultRevealRateLimiter.consume(rateLimitKey);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ error: 'Limite de cópias temporariamente atingido.', code: 'VAULT_REVEAL_RATE_LIMITED' });
    }
    try {
      const credential = await repository.get(req.params.credentialId);
      if (!credential) return res.status(404).json({ error: 'Acesso não encontrado.', code: 'CREDENTIAL_NOT_FOUND' });
      const password = decryptCredentialSecret({
        ciphertext: credential.secret_ciphertext,
        iv: credential.secret_iv,
        authTag: credential.secret_auth_tag,
        cipher: credential.cipher_algorithm,
        version: credential.cipher_version as 1
      }, credentialsEncryptionKey);
      await recordVaultAudit(repository, req, {
        credential_id: credential.id, site_id: credential.site_id, action: 'password_copied', success: true
      });
      return res.json({ password });
    } catch {
      return res.status(500).json({ error: 'Não foi possível recuperar a senha.', code: 'CREDENTIAL_DECRYPT_FAILED' });
    }
  });

  app.put('/api/accesses/:credentialId/password', requireVaultAuthorization, async (req: AuthenticatedRequest, res) => {
    const repository = getCredentialRepository();
    if (!repository) return sendDatabaseUnavailable(res, isProduction);
    if (!validateCredentialsEncryptionKey(credentialsEncryptionKey)) {
      return res.status(503).json({ error: 'Criptografia do cofre indisponível.', code: 'VAULT_NOT_CONFIGURED' });
    }
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const confirmation = typeof req.body?.confirmation === 'string' ? req.body.confirmation : '';
    if (!newPassword || newPassword.length > 4096 || newPassword !== confirmation) {
      return res.status(400).json({ error: 'A nova senha e a confirmação devem coincidir.', code: 'INVALID_NEW_PASSWORD' });
    }
    try {
      const existing = await repository.get(req.params.credentialId);
      if (!existing) return res.status(404).json({ error: 'Acesso não encontrado.', code: 'CREDENTIAL_NOT_FOUND' });
      const encrypted = encryptCredentialSecret(newPassword, credentialsEncryptionKey);
      const credential = await repository.updatePassword(existing.id, {
        secret_ciphertext: encrypted.ciphertext,
        secret_iv: encrypted.iv,
        secret_auth_tag: encrypted.authTag,
        cipher_algorithm: encrypted.cipher,
        cipher_version: encrypted.version,
        updated_by: req.admin!.id
      });
      if (!credential) return res.status(404).json({ error: 'Acesso não encontrado.', code: 'CREDENTIAL_NOT_FOUND' });
      await recordVaultAudit(repository, req, {
        credential_id: credential.id, site_id: credential.site_id, action: 'password_changed', success: true
      });
      return res.json({ access: sanitizeCredential(credential) });
    } catch {
      return res.status(500).json({ error: 'Não foi possível alterar a senha.', code: 'CREDENTIAL_PASSWORD_UPDATE_FAILED' });
    }
  });

  app.delete('/api/accesses/:credentialId', async (req: AuthenticatedRequest, res) => {
    const repository = getCredentialRepository();
    if (!repository) return sendDatabaseUnavailable(res, isProduction);
    try {
      const credential = await repository.get(req.params.credentialId);
      if (!credential) return res.status(404).json({ error: 'Acesso não encontrado.', code: 'CREDENTIAL_NOT_FOUND' });
      if (!await repository.remove(credential.id)) {
        return res.status(404).json({ error: 'Acesso não encontrado.', code: 'CREDENTIAL_NOT_FOUND' });
      }
      await recordVaultAudit(repository, req, {
        credential_id: credential.id, site_id: credential.site_id, action: 'credential_removed', success: true,
        details: { type: credential.type }
      });
      return res.status(204).end();
    } catch {
      return res.status(500).json({ error: 'Não foi possível remover o acesso.', code: 'CREDENTIAL_DELETE_FAILED' });
    }
  });

  app.get('/api/sites', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);
    const { data, error } = await supabase.rpc('get_sites_overview');
    if (error) return res.status(500).json({ error: 'Falha ao carregar visão consolidada dos sites.', code: 'SITES_OVERVIEW_FAILED' });
    return res.json({
      sites: (data || []).map((entry: any) => ({
        site: entry.site,
        latestCheck: entry.latest_check,
        activeIncident: entry.active_incident,
        domainCache: entry.domain_cache,
        metrics: entry.metrics || {}
      }))
    });
  });

  app.get('/api/sites/:siteId/checks', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
    let query = supabase
      .from('checks')
      .select([
        'id', 'site_id', 'incident_id', 'incident_eligible', 'checked_at', 'status', 'http_status', 'response_time',
        'final_url', 'error_type', 'error_message', 'observed_ip', 'dns_records', 'ssl',
        'expected_content_found', 'wordpress', 'domain_rdap', 'redirect_count',
        'result_message', 'diagnostics'
      ].join(','))
      .eq('site_id', req.params.siteId)
      .order('checked_at', { ascending: false })
      .limit(limit + 1);
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isFinite(cursorDate.getTime())) {
        return res.status(400).json({ error: 'Cursor de histórico inválido.', code: 'INVALID_CURSOR' });
      }
      query = query.lt('checked_at', cursorDate.toISOString());
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Falha ao carregar histórico.', code: 'CHECK_HISTORY_FAILED' });
    const rows = (data || []) as unknown as any[];
    const hasMore = rows.length > limit;
    const checks = rows.slice(0, limit);
    return res.json({
      checks,
      pagination: { limit, hasMore, nextCursor: hasMore ? checks[checks.length - 1]?.checked_at : null }
    });
  });

  app.get('/api/sites/:siteId/metrics', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);
    const period = typeof req.query.period === 'string' && ['24h', '7d', '30d', '90d'].includes(req.query.period)
      ? req.query.period
      : '24h';
    const [metricsResult, seriesResult] = await Promise.all([
      supabase.rpc('calculate_site_metrics', { p_site_id: req.params.siteId }),
      supabase.rpc('get_site_monitoring_series', { p_site_id: req.params.siteId, p_period: period })
    ]);
    if (metricsResult.error || seriesResult.error) {
      return res.status(500).json({ error: 'Falha ao calcular métricas reais.', code: 'SITE_METRICS_FAILED' });
    }
    return res.json({ metrics: metricsResult.data || {}, period, series: seriesResult.data || [] });
  });

  app.get('/api/incidents', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 100));
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
    let query = supabase
      .from('incidents')
      .select('*, sites(client_name, name, url, domain)')
      .order('started_at', { ascending: false })
      .limit(limit + 1);
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isFinite(cursorDate.getTime())) {
        return res.status(400).json({ error: 'Cursor de incidentes inválido.', code: 'INVALID_CURSOR' });
      }
      query = query.lt('started_at', cursorDate.toISOString());
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Falha ao carregar incidentes.', code: 'INCIDENTS_QUERY_FAILED' });
    const rows = data || [];
    const hasMore = rows.length > limit;
    const incidents = rows.slice(0, limit);
    return res.json({
      incidents,
      pagination: { limit, hasMore, nextCursor: hasMore ? incidents[incidents.length - 1]?.started_at : null }
    });
  });

  app.patch('/api/incidents/:incidentId/resolve', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);

    const { data: active } = await supabase
      .from('incidents')
      .select('id, started_at')
      .eq('id', req.params.incidentId)
      .eq('status', 'active')
      .maybeSingle();
    if (!active) return res.status(404).json({ error: 'Incidente ativo não encontrado.', code: 'ACTIVE_INCIDENT_NOT_FOUND' });
    const resolvedDate = new Date();
    const resolvedAt = resolvedDate.toISOString();
    const durationSeconds = Math.max(0, Math.floor((resolvedDate.getTime() - new Date(active.started_at).getTime()) / 1000));
    const { data, error } = await supabase
      .from('incidents')
      .update({ status: 'resolved', resolved_at: resolvedAt, duration_seconds: durationSeconds })
      .eq('id', req.params.incidentId)
      .eq('status', 'active')
      .select('*')
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Incidente ativo não encontrado.', code: 'ACTIVE_INCIDENT_NOT_FOUND' });
    }
    return res.json({ incident: data });
  });

  app.get('/api/alerts/config', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);
    const [webhookResult, emailResult, deliveriesResult] = await Promise.all([
      supabase.from('alert_webhooks').select('*').order('created_at', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('alert_email_configs').select('id, enabled, recipients, event_types, created_at, updated_at').limit(1).maybeSingle(),
      supabase.from('alert_deliveries')
        .select('id, channel, recipient, event_type, status, attempt_count, response_status, provider_message_id, last_error_code, error_message, next_attempt_at, created_at, attempted_at, delivered_at')
        .order('created_at', { ascending: false })
        .limit(50)
    ]);
    if (webhookResult.error || emailResult.error || deliveriesResult.error) {
      return res.status(500).json({ error: 'Falha ao carregar configuração de alertas.', code: 'ALERT_CONFIG_FAILED' });
    }
    return res.json({
      webhook: webhookResult.data || null,
      email: {
        ...(emailResult.data || {
          enabled: false,
          recipients: [],
          event_types: ['incident_confirmed', 'recovery']
        }),
        configured: Boolean(emailResult.data),
        provider: emailProvider.name,
        providerReady: emailProvider.ready,
        label: emailProvider.ready
          ? emailResult.data?.enabled ? 'E-mail ativo' : 'Provedor pronto'
          : 'Provedor não configurado'
      },
      recentDeliveries: deliveriesResult.data || []
    });
  });

  app.put('/api/alerts/webhook', async (req, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return sendDatabaseUnavailable(res, isProduction);
      const allowedEvents = new Set(['incident_confirmed', 'recovery', 'ssl_expiring', 'dns_changed']);
      const eventTypes = Array.isArray(req.body?.eventTypes)
        ? req.body.eventTypes.filter((value: unknown) => typeof value === 'string' && allowedEvents.has(value))
        : ['incident_confirmed', 'recovery'];
      if (!eventTypes.length) {
        return res.status(400).json({ error: 'Selecione ao menos um evento de webhook.', code: 'INVALID_ALERT_EVENTS' });
      }
      const enabled = req.body?.enabled !== false;
      const urlInput = String(req.body?.url || '').trim();
      if (enabled && !urlInput) {
        return res.status(400).json({ error: 'URL do webhook é obrigatória quando o canal está ativo.', code: 'WEBHOOK_URL_REQUIRED' });
      }
      const url = urlInput ? await validateAdministrativeUrl(urlInput) : '';
      const timeoutMs = Math.max(1000, Math.min(15000, Number(req.body?.timeoutMs) || 5000));
      const { data: current, error: currentError } = await supabase
        .from('alert_webhooks').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (currentError) throw new SiteCheckError('Falha ao consultar webhook.', 500, 'WEBHOOK_QUERY_FAILED');
      const payload = {
        name: 'Webhook principal', url, enabled, timeout_ms: timeoutMs, event_types: eventTypes
      };
      const operation = current
        ? supabase.from('alert_webhooks').update(payload).eq('id', current.id).select('*').single()
        : supabase.from('alert_webhooks').insert(payload).select('*').single();
      const { data, error } = await operation;
      if (error || !data) throw new SiteCheckError('Falha ao salvar webhook.', 500, 'WEBHOOK_SAVE_FAILED');
      return res.json({ webhook: data });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.put('/api/alerts/email', async (req, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return sendDatabaseUnavailable(res, isProduction);
      const enabled = req.body?.enabled === true;
      const allowedEvents = new Set(['incident_confirmed', 'recovery']);
      const eventTypes = Array.isArray(req.body?.eventTypes)
        ? [...new Set(req.body.eventTypes.filter((value: unknown) => typeof value === 'string' && allowedEvents.has(value)))]
        : ['incident_confirmed', 'recovery'];
      if (!eventTypes.length) {
        return res.status(400).json({ error: 'Selecione ao menos um evento de e-mail.', code: 'INVALID_EMAIL_EVENTS' });
      }
      const rawRecipients: unknown[] = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
      const recipients: string[] = [...new Set(rawRecipients
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean))];
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (recipients.length > 50 || recipients.some((recipient) => recipient.length > 254 || !emailPattern.test(recipient))) {
        return res.status(400).json({ error: 'Informe até 50 destinatários de e-mail válidos.', code: 'INVALID_EMAIL_RECIPIENTS' });
      }
      if (enabled && !recipients.length) {
        return res.status(400).json({ error: 'Informe ao menos um destinatário para ativar o canal.', code: 'EMAIL_RECIPIENT_REQUIRED' });
      }
      if (enabled && !emailProvider.ready) {
        return res.status(409).json({ error: 'Configure o provedor de e-mail no servidor antes de ativar o canal.', code: 'EMAIL_PROVIDER_NOT_READY' });
      }
      const { data: current, error: currentError } = await supabase
        .from('alert_email_configs').select('id').limit(1).maybeSingle();
      if (currentError) throw new SiteCheckError('Falha ao consultar configuração de e-mail.', 500, 'EMAIL_CONFIG_QUERY_FAILED');
      const payload = { enabled, recipients, event_types: eventTypes };
      const operation = current
        ? supabase.from('alert_email_configs').update(payload).eq('id', current.id).select('id, enabled, recipients, event_types, created_at, updated_at').single()
        : supabase.from('alert_email_configs').insert(payload).select('id, enabled, recipients, event_types, created_at, updated_at').single();
      const { data, error } = await operation;
      if (error || !data) throw new SiteCheckError('Falha ao salvar configuração de e-mail.', 500, 'EMAIL_CONFIG_SAVE_FAILED');
      return res.json({
        email: { ...data, configured: true, provider: emailProvider.name, providerReady: emailProvider.ready }
      });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/alerts/email/test', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);
    if (!emailProvider.ready) {
      return res.status(409).json({ error: 'O provedor de e-mail não está configurado no servidor.', code: 'EMAIL_PROVIDER_NOT_READY' });
    }
    const { data: config, error: configError } = await supabase
      .from('alert_email_configs').select('id, recipients').limit(1).maybeSingle();
    if (configError) return res.status(500).json({ error: 'Falha ao consultar configuração de e-mail.', code: 'EMAIL_CONFIG_QUERY_FAILED' });
    if (!config?.recipients?.length) {
      return res.status(400).json({ error: 'Salve ao menos um destinatário antes de enviar o teste.', code: 'EMAIL_RECIPIENT_REQUIRED' });
    }
    const eventKey = `email-test:${randomUUID()}`;
    const testedAt = new Date().toISOString();
    const rows = config.recipients.map((recipient: string) => ({
      channel: 'email',
      email_config_id: config.id,
      recipient,
      event_type: 'email_test',
      event_key: eventKey,
      payload: { eventVersion: 2, event: 'email_test', testedAt },
      status: 'pending',
      next_attempt_at: testedAt
    }));
    const { error } = await supabase.from('alert_deliveries').insert(rows);
    if (error) return res.status(500).json({ error: 'Falha ao colocar o e-mail de teste na fila.', code: 'EMAIL_TEST_QUEUE_FAILED' });
    return res.status(202).json({
      success: true,
      queued: rows.length,
      message: 'E-mail de teste colocado na fila de entrega.'
    });
  });

  app.post('/api/sites', async (req, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return sendDatabaseUnavailable(res, isProduction);

      const payload = buildSitePayload(req.body || {});
      if (!payload.client_name || !payload.name || !payload.url || !payload.domain) {
        return res.status(400).json({
          error: 'Cliente, nome, URL e domínio são obrigatórios.',
          code: 'INVALID_SITE_PAYLOAD'
        });
      }
      if (!isSupportedCheckInterval(payload.check_interval)) {
        return res.status(400).json({
          error: 'Intervalo de verificação inválido.',
          code: 'INVALID_CHECK_INTERVAL'
        });
      }
      payload.url = await validateAdministrativeUrl(payload.url);

      const { data, error } = await supabase.from('sites').insert({
        ...payload,
        next_check_at: payload.is_active ? new Date().toISOString() : null,
        monitoring_state: payload.is_active ? 'pending' : 'paused'
      }).select('*').single();
      if (error || !data) {
        return res.status(500).json({ error: 'Falha ao cadastrar site.', code: 'SITE_CREATE_FAILED' });
      }
      return res.status(201).json({ site: data });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.patch('/api/sites/:siteId', async (req, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return sendDatabaseUnavailable(res, isProduction);

      const allowedFields = new Set([
        'client_name', 'name', 'url', 'domain', 'hosting_provider', 'is_wordpress',
        'check_interval', 'monitor_response_time', 'monitor_ssl', 'monitor_domain',
        'expected_content', 'expected_ga4_id', 'expected_gtm_id',
        'expected_google_ads_id', 'expected_meta_pixel_id', 'uses_search_console', 'uses_rd_station'
      ]);
      const updatePayload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(req.body || {})) {
        if (allowedFields.has(key)) updatePayload[key] = value;
      }

      if (typeof updatePayload.url === 'string') {
        updatePayload.url = await validateAdministrativeUrl(updatePayload.url);
      }
      if (typeof updatePayload.domain === 'string') {
        updatePayload.domain = updatePayload.domain.trim().toLowerCase();
      }
      if ('check_interval' in updatePayload && !isSupportedCheckInterval(updatePayload.check_interval)) {
        return res.status(400).json({
          error: 'Intervalo de verificação inválido.',
          code: 'INVALID_CHECK_INTERVAL'
        });
      }
      if ('check_interval' in updatePayload) updatePayload.next_check_at = new Date().toISOString();
      if (!Object.keys(updatePayload).length) {
        return res.status(400).json({ error: 'Nenhum campo válido foi enviado.', code: 'EMPTY_UPDATE' });
      }

      const { data, error } = await supabase
        .from('sites')
        .update(updatePayload)
        .eq('id', req.params.siteId)
        .select('*')
        .single();
      if (error || !data) {
        return res.status(404).json({ error: 'Site não encontrado ou não pôde ser atualizado.', code: 'SITE_UPDATE_FAILED' });
      }
      return res.json({ site: data });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.patch('/api/sites/:siteId/active', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive deve ser booleano.', code: 'INVALID_ACTIVE_STATE' });
    }

    const { data, error } = await supabase
      .from('sites')
      .update({
        is_active: req.body.isActive,
        monitoring_state: req.body.isActive ? 'pending' : 'paused',
        next_check_at: req.body.isActive ? new Date().toISOString() : null,
        monitoring_claimed_by: null,
        monitoring_claimed_until: null,
        consecutive_failures: 0,
        consecutive_successes: 0
      })
      .eq('id', req.params.siteId)
      .select('id, is_active')
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Site não encontrado ou não pôde ser atualizado.', code: 'SITE_ACTIVE_UPDATE_FAILED' });
    }
    return res.json({ site: data });
  });

  app.get('/api/sites/:siteId/deletion-impact', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);

    const { data, error } = await supabase.rpc('get_site_deletion_impact', {
      p_site_id: req.params.siteId
    });
    if (error) {
      return res.status(500).json({
        error: 'Falha ao avaliar os dados vinculados ao site.',
        code: 'SITE_DELETION_IMPACT_FAILED'
      });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return res.status(404).json({ error: 'Site não encontrado.', code: 'SITE_NOT_FOUND' });
    }

    return res.json({
      impact: {
        siteId: row.site_id,
        siteName: row.site_name,
        siteDomain: row.site_domain,
        checks: Number(row.checks_count || 0),
        incidents: Number(row.incidents_count || 0),
        alertEvents: Number(row.alert_events_count || 0),
        alertDeliveries: Number(row.alert_deliveries_count || 0),
        credentials: Number(row.credentials_count || 0),
        credentialAudit: Number(row.credential_audit_count || 0)
      }
    });
  });

  app.delete('/api/sites/:siteId', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);

    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, name, domain')
      .eq('id', req.params.siteId)
      .single();
    if (siteError || !site) {
      return res.status(404).json({ error: 'Site não encontrado.', code: 'SITE_NOT_FOUND' });
    }

    const confirmation = String(req.body?.confirmation || '').trim().toLowerCase();
    const expectedDomain = String(site.domain).trim().toLowerCase();
    const expectedName = String(site.name).trim().toLowerCase();
    if (confirmation !== expectedDomain && confirmation !== expectedName) {
      return res.status(400).json({
        error: `Digite exatamente "${site.domain}" ou "${site.name}" para confirmar a exclusão definitiva.`,
        code: 'DELETE_CONFIRMATION_MISMATCH'
      });
    }

    const { data: deletionData, error: deleteError } = await supabase.rpc('delete_site_permanently', {
      p_site_id: site.id,
      p_confirmation: String(req.body?.confirmation || '')
    });
    if (deleteError) {
      if (deleteError.code === 'P0002') {
        return res.status(404).json({ error: 'Site não encontrado.', code: 'SITE_NOT_FOUND' });
      }
      if (deleteError.code === 'P0001') {
        return res.status(400).json({
          error: `Digite exatamente "${site.domain}" ou "${site.name}" para confirmar a exclusão definitiva.`,
          code: 'DELETE_CONFIRMATION_MISMATCH'
        });
      }
      return res.status(500).json({
        error: 'Falha ao excluir o site. Nenhum dado foi removido.',
        code: 'SITE_DELETE_FAILED'
      });
    }

    const deleted = Array.isArray(deletionData) ? deletionData[0] : deletionData;
    if (!deleted?.deleted_site_id) {
      return res.status(500).json({
        error: 'A exclusão não foi confirmada pelo banco. Nenhum sucesso foi informado.',
        code: 'SITE_DELETE_NOT_CONFIRMED'
      });
    }

    return res.json({
      success: true,
      deletedSiteId: deleted.deleted_site_id,
      deleted: {
        checks: Number(deleted.checks_deleted || 0),
        incidents: Number(deleted.incidents_deleted || 0),
        alertEvents: Number(deleted.alert_events_deleted || 0),
        alertDeliveries: Number(deleted.alert_deliveries_deleted || 0),
        credentials: Number(deleted.credentials_deleted || 0),
        credentialAudit: Number(deleted.credential_audit_deleted || 0)
      }
    });
  });

  app.post('/api/check-site', async (req, res) => {
    try {
      const supabase = getSupabase();
      const result = await processSiteCheck(
        { siteId: req.body?.siteId, url: req.body?.siteId ? undefined : req.body?.url },
        { supabase }
      );
      return res.json({ ...result, alertsDeferred: true });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      console.error('[HTTP Check Error]', mapped.code, mapped.message);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/check-all', async (_req, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return sendDatabaseUnavailable(res, isProduction);

      const queuedAt = new Date().toISOString();
      const { error } = await supabase
        .from('sites')
        .update({ next_check_at: queuedAt })
        .eq('is_active', true);
      if (error) {
        return res.status(500).json({ error: 'Falha ao colocar sites ativos na fila.', code: 'ACTIVE_SITES_QUEUE_FAILED' });
      }

      return res.status(202).json({
        success: true,
        queued: true,
        queuedAt,
        message: 'Todos os sites foram colocados na fila de verificação.'
      });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      console.error('[Check All Error]', mapped.code, mapped.message);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });

  app.use((error: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: statusCode === 403 ? error.message : 'Erro interno da API.',
      code: statusCode === 403 ? 'CORS_ORIGIN_DENIED' : 'INTERNAL_ERROR'
    });
  });

  return app;
}

export function startServer() {
  assertSecureProductionConfiguration();
  const port = Number(process.env.PORT || 3001);
  const server = createApp().listen(port, () => {
    console.log('========================================================');
    console.log('  TECNIHUB MONITORAMENTO - BACKEND HTTP REAL');
    console.log(`  Servidor rodando na porta ${port}`);
    console.log(`  Anti-SSRF com DNS pinning | Cron: lote ${MONITOR_CRON_BATCH_SIZE}, concorrência ${MONITOR_CRON_CONCURRENCY}`);
    console.log(`  Alertas persistentes: lote ${EMAIL_DELIVERY_BATCH_SIZE}, concorrência de e-mail ${EMAIL_DELIVERY_CONCURRENCY}`);
    console.log('========================================================');
  });
  return server;
}
