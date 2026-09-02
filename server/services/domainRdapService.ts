import type { SupabaseClient } from '@supabase/supabase-js';

export interface DomainRdapDiagnostics {
  domain: string;
  registrationDomain?: string;
  status: 'available' | 'unavailable' | 'error';
  registrar?: string;
  registry?: string;
  createdAt?: string;
  expiresAt?: string;
  daysRemaining?: number;
  fetchedAt: string;
  cached: boolean;
  stale?: boolean;
  error?: string;
}

const RDAP_TIMEOUT_MS = 8000;
const RDAP_SUCCESS_CACHE_MS = 24 * 60 * 60 * 1000;
const RDAP_UNAVAILABLE_CACHE_MS = 6 * 60 * 60 * 1000;
const RDAP_ERROR_CACHE_MS = 30 * 60 * 1000;
const RDAP_RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

async function fetchRdapWithRetry(
  fetchImpl: typeof fetch,
  registrationDomain: string,
  signal: AbortSignal
): Promise<Response> {
  const url = `https://rdap.org/domain/${encodeURIComponent(registrationDomain)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/rdap+json, application/json',
        'User-Agent': 'TecnihubMonitoring/2.0 (+https://tecnihub.com.br)'
      },
      redirect: 'follow',
      signal
    });
    if (!RDAP_RETRYABLE_STATUSES.has(response.status) || attempt === 1) return response;
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(250, Math.min(1_500, retryAfterSeconds * 1_000))
      : 500;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
  throw new Error('Falha inesperada ao consultar RDAP.');
}

export function normalizeDomainForRdap(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return '';
  }
}

function eventDate(payload: any, actions: string[]): string | undefined {
  const event = Array.isArray(payload?.events)
    ? payload.events.find((candidate: any) => actions.includes(String(candidate?.eventAction || '').toLowerCase()))
    : undefined;
  const date = event?.eventDate ? new Date(event.eventDate) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function registrarName(payload: any): string | undefined {
  const entity = Array.isArray(payload?.entities)
    ? payload.entities.find((candidate: any) => Array.isArray(candidate?.roles)
      && candidate.roles.some((role: unknown) => String(role).toLowerCase() === 'registrar'))
    : undefined;
  const values = entity?.vcardArray?.[1];
  if (!Array.isArray(values)) return entity?.handle || entity?.publicIds?.[0]?.identifier;
  const name = values.find((entry: any) => Array.isArray(entry) && ['fn', 'org'].includes(entry[0]));
  return typeof name?.[3] === 'string' ? name[3] : entity?.handle || entity?.publicIds?.[0]?.identifier;
}

function registryName(payload: any): string | undefined {
  if (typeof payload?.port43 === 'string' && payload.port43.trim()) return payload.port43.trim();
  const selfLink = Array.isArray(payload?.links)
    ? payload.links.find((link: any) => link?.rel === 'self' && typeof link?.href === 'string')
    : undefined;
  try { return selfLink ? new URL(selfLink.href).hostname : undefined; } catch { return undefined; }
}

function mapPayload(domain: string, registrationDomain: string, payload: any, fetchedAt: Date): DomainRdapDiagnostics {
  const createdAt = eventDate(payload, ['registration']);
  const expiresAt = eventDate(payload, ['expiration', 'expiry']);
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  return {
    domain,
    registrationDomain: String(payload?.ldhName || registrationDomain).toLowerCase(),
    status: 'available',
    registrar: registrarName(payload),
    registry: registryName(payload),
    createdAt,
    expiresAt,
    daysRemaining: Number.isFinite(expiresMs)
      ? Math.ceil((expiresMs - fetchedAt.getTime()) / 86_400_000)
      : undefined,
    fetchedAt: fetchedAt.toISOString(),
    cached: false
  };
}

function mapCached(row: any): DomainRdapDiagnostics {
  return {
    domain: row.domain,
    registrationDomain: row.raw_response?.ldhName?.toLowerCase?.() || undefined,
    status: row.status,
    registrar: row.registrar || undefined,
    registry: registryName(row.raw_response),
    createdAt: row.created_at_registry || undefined,
    expiresAt: row.expires_at_registry || undefined,
    daysRemaining: row.days_remaining ?? undefined,
    fetchedAt: row.fetched_at,
    cached: true,
    error: row.error_message || undefined
  };
}

async function persistCache(
  supabase: SupabaseClient,
  diagnostics: DomainRdapDiagnostics,
  rawResponse: unknown,
  fetchedAt: Date
): Promise<void> {
  const { error } = await supabase.from('domain_rdap_cache').upsert({
    domain: diagnostics.domain,
    registrar: diagnostics.registrar || null,
    created_at_registry: diagnostics.createdAt || null,
    expires_at_registry: diagnostics.expiresAt || null,
    days_remaining: diagnostics.daysRemaining ?? null,
    status: diagnostics.status,
    error_message: diagnostics.error || null,
    raw_response: rawResponse ?? null,
    fetched_at: fetchedAt.toISOString(),
    refresh_after: new Date(fetchedAt.getTime() + (
      diagnostics.status === 'available' ? RDAP_SUCCESS_CACHE_MS
        : diagnostics.status === 'unavailable' ? RDAP_UNAVAILABLE_CACHE_MS
          : RDAP_ERROR_CACHE_MS
    )).toISOString()
  }, { onConflict: 'domain' });
  if (error) throw new Error(`Falha ao persistir cache RDAP: ${error.message}`);
}

function rdapCandidates(domain: string): string[] {
  const labels = domain.split('.').filter(Boolean);
  const secondLevel = labels.slice(-2).join('.');
  const commonSecondLevel = new Set([
    'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
    'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au',
    'co.nz', 'com.mx', 'com.ar', 'com.co', 'co.jp'
  ]);
  const minimumLabels = commonSecondLevel.has(secondLevel) ? 3 : 2;
  const candidates: string[] = [];
  for (let start = 0; labels.length - start >= minimumLabels; start++) {
    candidates.push(labels.slice(start).join('.'));
  }
  return candidates;
}

function cachedUntil(row: any): number {
  const fetchedAt = new Date(row?.fetched_at).getTime();
  if (!Number.isFinite(fetchedAt)) return 0;
  const maximumAge = row.status === 'available' ? RDAP_SUCCESS_CACHE_MS
    : row.status === 'unavailable' ? RDAP_UNAVAILABLE_CACHE_MS
      : RDAP_ERROR_CACHE_MS;
  const configuredRefresh = new Date(row?.refresh_after).getTime();
  return Math.min(
    Number.isFinite(configuredRefresh) ? configuredRefresh : Number.POSITIVE_INFINITY,
    fetchedAt + maximumAge
  );
}

async function deferCachedRetry(supabase: SupabaseClient, domain: string, fetchedAt: Date): Promise<void> {
  try {
    await supabase.from('domain_rdap_cache').update({
      refresh_after: new Date(fetchedAt.getTime() + RDAP_ERROR_CACHE_MS).toISOString()
    }).eq('domain', domain);
  } catch { /* stale successful data remains usable even if retry scheduling fails */ }
}

export async function getDomainRdapDiagnostics(
  supabase: SupabaseClient,
  domainValue: string,
  now: () => Date = () => new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<DomainRdapDiagnostics> {
  const domain = normalizeDomainForRdap(domainValue);
  const fetchedAt = now();
  if (!domain) {
    return {
      domain: domainValue,
      status: 'unavailable',
      fetchedAt: fetchedAt.toISOString(),
      cached: false,
      error: 'Domínio inválido para consulta RDAP.'
    };
  }

  const { data: cached, error: cacheError } = await supabase
    .from('domain_rdap_cache')
    .select('*')
    .eq('domain', domain)
    .maybeSingle();
  if (!cacheError && cached && cachedUntil(cached) > fetchedAt.getTime()) {
    return mapCached(cached);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);
  try {
    // rdap.org is a fixed public bootstrap service; the monitored domain is
    // percent-encoded only as a path segment and can never select an internal URL.
    for (const registrationDomain of rdapCandidates(domain)) {
      const response = await fetchRdapWithRetry(fetchImpl, registrationDomain, controller.signal);
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`RDAP respondeu HTTP ${response.status}`);
      const payload = await response.json();
      const diagnostics = mapPayload(domain, registrationDomain, payload, fetchedAt);
      await persistCache(supabase, diagnostics, payload, fetchedAt);
      return diagnostics;
    }
    const unavailable: DomainRdapDiagnostics = {
      domain, status: 'unavailable', fetchedAt: fetchedAt.toISOString(), cached: false,
      error: 'O serviço RDAP não forneceu informações para este domínio ou domínio registrável.'
    };
    await persistCache(supabase, unavailable, null, fetchedAt);
    return unavailable;
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Consulta RDAP excedeu o tempo limite.'
      : error instanceof Error ? error.message : 'Falha inesperada na consulta RDAP.';
    if (!cacheError && cached?.status === 'available') {
      await deferCachedRetry(supabase, domain, fetchedAt);
      return { ...mapCached(cached), cached: true, stale: true, error: message };
    }
    const failed: DomainRdapDiagnostics = {
      domain, status: 'error', fetchedAt: fetchedAt.toISOString(), cached: false, error: message
    };
    try { await persistCache(supabase, failed, null, fetchedAt); } catch { /* check remains usable */ }
    return failed;
  } finally {
    clearTimeout(timer);
  }
}
