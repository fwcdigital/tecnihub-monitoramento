import type { SupabaseClient } from '@supabase/supabase-js';

export interface DomainRdapDiagnostics {
  domain: string;
  status: 'available' | 'unavailable' | 'error';
  registrar?: string;
  createdAt?: string;
  expiresAt?: string;
  daysRemaining?: number;
  fetchedAt: string;
  cached: boolean;
  error?: string;
}

const RDAP_TIMEOUT_MS = 8000;
const RDAP_CACHE_MS = 24 * 60 * 60 * 1000;

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
    ? payload.entities.find((candidate: any) => Array.isArray(candidate?.roles) && candidate.roles.includes('registrar'))
    : undefined;
  const values = entity?.vcardArray?.[1];
  if (!Array.isArray(values)) return entity?.handle;
  const fn = values.find((entry: any) => Array.isArray(entry) && entry[0] === 'fn');
  return typeof fn?.[3] === 'string' ? fn[3] : entity?.handle;
}

function mapPayload(domain: string, payload: any, fetchedAt: Date): DomainRdapDiagnostics {
  const createdAt = eventDate(payload, ['registration']);
  const expiresAt = eventDate(payload, ['expiration', 'expiry']);
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  return {
    domain,
    status: 'available',
    registrar: registrarName(payload),
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
    status: row.status,
    registrar: row.registrar || undefined,
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
    raw_response: rawResponse || null,
    fetched_at: fetchedAt.toISOString(),
    refresh_after: new Date(fetchedAt.getTime() + RDAP_CACHE_MS).toISOString()
  }, { onConflict: 'domain' });
  if (error) throw new Error(`Falha ao persistir cache RDAP: ${error.message}`);
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
  if (!cacheError && cached && new Date(cached.refresh_after).getTime() > fetchedAt.getTime()) {
    return mapCached(cached);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);
  try {
    // rdap.org is a fixed public bootstrap service; the monitored domain is
    // percent-encoded only as a path segment and can never select an internal URL.
    const response = await fetchImpl(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: {
        Accept: 'application/rdap+json, application/json',
        'User-Agent': 'TecnihubMonitoring/2.0 (+https://tecnihub.com.br)'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (response.status === 404) {
      const unavailable: DomainRdapDiagnostics = {
        domain, status: 'unavailable', fetchedAt: fetchedAt.toISOString(), cached: false,
        error: 'O serviço RDAP não forneceu informações para este domínio.'
      };
      await persistCache(supabase, unavailable, null, fetchedAt);
      return unavailable;
    }
    if (!response.ok) throw new Error(`RDAP respondeu HTTP ${response.status}`);
    const payload = await response.json();
    const diagnostics = mapPayload(domain, payload, fetchedAt);
    await persistCache(supabase, diagnostics, payload, fetchedAt);
    return diagnostics;
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Consulta RDAP excedeu o tempo limite.'
      : error instanceof Error ? error.message : 'Falha inesperada na consulta RDAP.';
    const failed: DomainRdapDiagnostics = {
      domain, status: 'error', fetchedAt: fetchedAt.toISOString(), cached: false, error: message
    };
    try { await persistCache(supabase, failed, null, fetchedAt); } catch { /* check remains usable */ }
    return failed;
  } finally {
    clearTimeout(timer);
  }
}
