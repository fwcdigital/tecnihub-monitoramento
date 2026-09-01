import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
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
import { mapWithConcurrency } from './services/concurrency';
import { LoginRateLimiter } from './services/loginRateLimiter';
import { normalizeHttpUrl, validateUrlForSSRF } from './services/ssrfProtection';
import { processSiteCheck, SiteCheckError, SiteRecordForCheck } from './services/siteCheckService';
import { isSupportedCheckInterval, startMonitoringScheduler } from './services/monitoringScheduler';

dotenv.config();

const configuredConcurrency = Number(process.env.CHECK_CONCURRENCY || 5);
export const MAX_BATCH_CONCURRENCY = 5;
export const BATCH_CONCURRENCY = Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
  ? Math.min(configuredConcurrency, MAX_BATCH_CONCURRENCY)
  : 5;

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
  sessionTtlSeconds?: number;
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

export function assertSecureProductionConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  if (!validateSessionSecret(env.ADMIN_SESSION_SECRET || '')) {
    throw new Error('ADMIN_SESSION_SECRET é obrigatório em produção e deve possuir ao menos 32 bytes aleatórios.');
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

  if (env.MONITORING_SCHEDULER_ENABLED && !['true', 'false'].includes(env.MONITORING_SCHEDULER_ENABLED)) {
    throw new Error('MONITORING_SCHEDULER_ENABLED deve ser true ou false.');
  }
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
    expected_content: body.expected_content ? String(body.expected_content).trim() : null,
    expected_ga4_id: body.expected_ga4_id ? String(body.expected_ga4_id).trim() : null,
    expected_gtm_id: body.expected_gtm_id ? String(body.expected_gtm_id).trim() : null,
    expected_google_ads_id: body.expected_google_ads_id ? String(body.expected_google_ads_id).trim() : null,
    expected_meta_pixel_id: body.expected_meta_pixel_id ? String(body.expected_meta_pixel_id).trim() : null,
    uses_search_console: Boolean(body.uses_search_console),
    uses_rd_station: Boolean(body.uses_rd_station)
  };
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
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type']
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
    res.setHeader('Set-Cookie', clearAdminSessionCookie(sessionOptions));
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

  app.get('/api/sites', async (_req, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return sendDatabaseUnavailable(res, isProduction);

      const { data: sites, error: sitesError } = await supabase
        .from('sites')
        .select('*')
        .order('created_at', { ascending: false });

      if (sitesError) {
        return res.status(500).json({ error: 'Falha ao carregar sites.', code: 'SITES_QUERY_FAILED' });
      }

      const uptimeWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const enrichedSites = await mapWithConcurrency(sites || [], BATCH_CONCURRENCY, async (site) => {
        const [checksResult, incidentResult, totalChecksResult, availableChecksResult] = await Promise.all([
          supabase
            .from('checks')
            .select('*')
            .eq('site_id', site.id)
            .order('checked_at', { ascending: false })
            .limit(500),
          supabase
            .from('incidents')
            .select('*')
            .eq('site_id', site.id)
            .eq('status', 'active')
            .limit(1),
          supabase
            .from('checks')
            .select('id', { count: 'exact', head: true })
            .eq('site_id', site.id)
            .gte('checked_at', uptimeWindowStart),
          supabase
            .from('checks')
            .select('id', { count: 'exact', head: true })
            .eq('site_id', site.id)
            .gte('checked_at', uptimeWindowStart)
            .in('status', ['online', 'warning'])
        ]);

        if (checksResult.error || incidentResult.error || totalChecksResult.error || availableChecksResult.error) {
          throw new SiteCheckError(
            checksResult.error?.message
              || incidentResult.error?.message
              || totalChecksResult.error?.message
              || availableChecksResult.error?.message
              || 'Falha ao carregar telemetria.',
            500,
            'SITE_TELEMETRY_QUERY_FAILED'
          );
        }

        return {
          site,
          checks: checksResult.data || [],
          activeIncident: incidentResult.data?.[0] || null,
          uptime30d: {
            totalChecks: totalChecksResult.count || 0,
            availableChecks: availableChecksResult.count || 0
          }
        };
      });

      return res.json({ sites: enrichedSites });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.get('/api/incidents', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);

    const incidents: unknown[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .order('started_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        return res.status(500).json({ error: 'Falha ao carregar incidentes.', code: 'INCIDENTS_QUERY_FAILED' });
      }
      incidents.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return res.json({ incidents });
  });

  app.patch('/api/incidents/:incidentId/resolve', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return sendDatabaseUnavailable(res, isProduction);

    const resolvedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('incidents')
      .update({ status: 'resolved', resolved_at: resolvedAt })
      .eq('id', req.params.incidentId)
      .eq('status', 'active')
      .select('*')
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Incidente ativo não encontrado.', code: 'ACTIVE_INCIDENT_NOT_FOUND' });
    }
    return res.json({ incident: data });
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

      const { data, error } = await supabase.from('sites').insert(payload).select('*').single();
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
        'check_interval', 'expected_content', 'expected_ga4_id', 'expected_gtm_id',
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
      .update({ is_active: req.body.isActive })
      .eq('id', req.params.siteId)
      .select('id, is_active')
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Site não encontrado ou não pôde ser atualizado.', code: 'SITE_ACTIVE_UPDATE_FAILED' });
    }
    return res.json({ site: data });
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
    if (confirmation !== site.domain.toLowerCase() && confirmation !== site.name.toLowerCase()) {
      return res.status(400).json({
        error: `Digite exatamente "${site.domain}" para confirmar a exclusão definitiva.`,
        code: 'DELETE_CONFIRMATION_MISMATCH'
      });
    }

    const [checksResult, incidentsResult] = await Promise.all([
      supabase.from('checks').select('id', { count: 'exact', head: true }).eq('site_id', site.id),
      supabase.from('incidents').select('id', { count: 'exact', head: true }).eq('site_id', site.id)
    ]);
    if (checksResult.error || incidentsResult.error) {
      return res.status(500).json({ error: 'Falha ao avaliar o histórico do site.', code: 'HISTORY_QUERY_FAILED' });
    }

    const checksCount = checksResult.count || 0;
    const incidentsCount = incidentsResult.count || 0;
    if (checksCount > 0 || incidentsCount > 0) {
      return res.status(409).json({
        error: `Exclusão bloqueada para preservar ${checksCount} check(s) e ${incidentsCount} incidente(s). Desative o monitoramento ou autorize uma estratégia de preservação histórica.`,
        code: 'SITE_HAS_HISTORY',
        history: { checks: checksCount, incidents: incidentsCount }
      });
    }

    const { error: deleteError } = await supabase.from('sites').delete().eq('id', site.id);
    if (deleteError) {
      return res.status(500).json({ error: 'Falha ao excluir site.', code: 'SITE_DELETE_FAILED' });
    }
    return res.json({ success: true, deletedSiteId: site.id });
  });

  app.post('/api/check-site', async (req, res) => {
    try {
      const result = await processSiteCheck(
        { siteId: req.body?.siteId, url: req.body?.siteId ? undefined : req.body?.url },
        { supabase: getSupabase() }
      );
      return res.json(result);
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

      const { data, error } = await supabase
        .from('sites')
        .select('id, url, name, is_active')
        .eq('is_active', true);
      if (error) {
        return res.status(500).json({ error: 'Falha ao carregar sites ativos.', code: 'ACTIVE_SITES_QUERY_FAILED' });
      }

      const activeSites = (data || []) as SiteRecordForCheck[];
      const results = await mapWithConcurrency(activeSites, BATCH_CONCURRENCY, async (site) => {
        try {
          return await processSiteCheck(
            { siteId: site.id, trustedSite: site },
            { supabase }
          );
        } catch (error) {
          const mapped = getRequestError(error, isProduction);
          return {
            success: false as const,
            siteId: site.id,
            siteName: site.name,
            error: mapped.message,
            code: mapped.code
          };
        }
      });

      return res.json({
        success: results.every((result) => result.success),
        totalChecked: results.filter((result) => result.success).length,
        totalFailed: results.filter((result) => !result.success).length,
        concurrency: BATCH_CONCURRENCY,
        results
      });
    } catch (error) {
      const mapped = getRequestError(error, isProduction);
      console.error('[Check All Error]', mapped.code, mapped.message);
      return res.status(mapped.statusCode).json({ error: mapped.message, code: mapped.code });
    }
  });

  const distPath = path.resolve(process.cwd(), 'dist');
  app.get('/', (_req, res) => res.redirect(302, '/admin'));
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
    console.log(`  Anti-SSRF com DNS pinning | Concorrência: ${BATCH_CONCURRENCY}`);
    console.log('========================================================');
  });
  const stopScheduler = startMonitoringScheduler(getServerSupabase, {
    enabled: process.env.MONITORING_SCHEDULER_ENABLED === 'true',
    concurrency: BATCH_CONCURRENCY
  });
  server.on('close', stopScheduler);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}
