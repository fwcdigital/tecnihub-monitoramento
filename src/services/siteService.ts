import {
  Site,
  CheckRecord,
  DbSite,
  DbCheck,
  DbIncident,
  Incident,
  IncidentType,
  HostingProvider,
  MonitoringFrequency
} from '../types';

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('tecnihub:session-expired'));
    }
    const error = new Error(payload.error || `Falha na API (HTTP ${response.status})`) as Error & {
      code?: string;
      details?: unknown;
    };
    error.code = payload.code;
    error.details = payload.history;
    throw error;
  }
  return payload as T;
}

function formatFullDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (!Number.isFinite(date.getTime())) return 'Indisponível';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    const secs = String(date.getSeconds()).padStart(2, '0');
    return `${day}/${month} ${hours}:${mins}:${secs}`;
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString: string): string {
  try {
    const parsedTime = new Date(isoString).getTime();
    if (!Number.isFinite(parsedTime)) return 'Indisponível';
    const mins = Math.floor((Date.now() - parsedTime) / 60000);
    if (mins < 1) return 'Há instantes';
    if (mins === 1) return 'Há 1 min';
    if (mins < 60) return `Há ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours === 1) return 'Há 1 hora';
    if (hours < 24) return `Há ${hours} horas`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'Há 1 dia' : `Há ${days} dias`;
  } catch {
    return 'Recente';
  }
}

export function mapDbSiteToSite(
  dbSite: DbSite,
  checks: DbCheck[] = [],
  activeIncident?: DbIncident | null,
  uptimeCounts?: { totalChecks: number; availableChecks: number }
): Site {
  const latestCheck = checks[0] || null;
  const latestResponseSeconds = latestCheck?.response_time !== null && latestCheck?.response_time !== undefined
    ? +(latestCheck.response_time / 1000).toFixed(2)
    : null;
  const validResponseTimes = checks
    .filter((check) => check.response_time && check.response_time > 0)
    .map((check) => Number(check.response_time) / 1000);
  const avgResponseSeconds = validResponseTimes.length
    ? +(validResponseTimes.reduce((sum, value) => sum + value, 0) / validResponseTimes.length).toFixed(2)
    : null;
  const uptime = uptimeCounts?.totalChecks
    ? +((uptimeCounts.availableChecks / uptimeCounts.totalChecks) * 100).toFixed(2)
    : null;

  let currentStatus: Site['status'] = 'unknown';
  if (!dbSite.is_active) currentStatus = 'paused';
  else if (latestCheck) currentStatus = latestCheck.status;

  const checksHistory: CheckRecord[] = checks.map((check) => ({
    id: check.id,
    timestamp: formatFullDate(check.checked_at),
    checkedAt: check.checked_at,
    status: check.status,
    httpCode: check.http_status ?? (check.status === 'offline' ? 'ERR' : 'Indisponível'),
    responseTime: check.response_time ? +(check.response_time / 1000).toFixed(2) : 0,
    result: check.error_message || (check.http_status !== null ? `HTTP ${check.http_status}` : 'Sem detalhe disponível')
  }));

  return {
    id: dbSite.id,
    client: dbSite.client_name,
    siteName: dbSite.name,
    url: dbSite.url,
    domain: dbSite.domain,
    hosting: (dbSite.hosting_provider as HostingProvider) || 'Hostinger',
    frequency: (dbSite.check_interval as MonitoringFrequency) || '5min',
    status: currentStatus,
    isWordPress: dbSite.is_wordpress,
    isActive: dbSite.is_active,
    uptime30d: uptime,
    responseTime: latestCheck && currentStatus !== 'offline' ? latestResponseSeconds : null,
    avgResponseTime: avgResponseSeconds,
    // These collectors do not exist in the MVP yet. Null is intentional: the UI
    // must never turn absent telemetry into an invented operational value.
    sslValid: null,
    sslDaysRemaining: null,
    domainDaysRemaining: null,
    lastCheck: latestCheck ? formatRelativeTime(latestCheck.checked_at) : 'Aguardando',
    httpStatus: latestCheck?.http_status ?? (latestCheck?.status === 'offline' ? 'ERR' : null),
    monitorAvailability: true,
    monitorResponseTime: true,
    monitorSsl: false,
    monitorDomain: false,
    monitorRedirects: true,
    monitorContent: Boolean(dbSite.expected_content),
    expectedContentText: dbSite.expected_content || '',
    consecutiveFailures: checks.findIndex((check) => check.status !== 'offline' && check.status !== 'critical') === -1
      ? checks.length
      : checks.findIndex((check) => check.status !== 'offline' && check.status !== 'critical'),
    createdAt: dbSite.created_at?.slice(0, 10) || 'Indisponível',
    updatedAt: dbSite.updated_at,
    activeIncidentId: activeIncident?.id,
    checksHistory,
    tracking: {
      ga4: { enabled: Boolean(dbSite.expected_ga4_id), expectedId: dbSite.expected_ga4_id || '' },
      gtm: { enabled: Boolean(dbSite.expected_gtm_id), expectedId: dbSite.expected_gtm_id || '' },
      googleAds: { enabled: Boolean(dbSite.expected_google_ads_id), expectedId: dbSite.expected_google_ads_id || '' },
      metaPixel: { enabled: Boolean(dbSite.expected_meta_pixel_id), expectedId: dbSite.expected_meta_pixel_id || '' },
      searchConsole: { enabled: dbSite.uses_search_console, searchConsoleConfigured: dbSite.uses_search_console },
      rdStation: { enabled: dbSite.uses_rd_station, expectedId: '' },
      lastCheckedAt: undefined
    }
  };
}

export async function getSitesFromDatabase(): Promise<Site[]> {
  const response = await apiRequest<{
    sites: Array<{
      site: DbSite;
      checks: DbCheck[];
      activeIncident: DbIncident | null;
      uptime30d: { totalChecks: number; availableChecks: number };
    }>;
  }>('/api/sites');
  return response.sites.map((entry) =>
    mapDbSiteToSite(entry.site, entry.checks, entry.activeIncident, entry.uptime30d)
  );
}

function formatIncidentDuration(startedAt: string, resolvedAt?: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'Indisponível';
  const minutes = Math.floor((end - start) / 60_000);
  if (minutes < 1) return 'Menos de 1 minuto';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function mapDbIncidentToIncident(dbIncident: DbIncident, sites: Site[]): Incident {
  const site = sites.find((candidate) => candidate.id === dbIncident.site_id);
  const relevantChecks = site?.checksHistory || [];
  const startedAtMs = new Date(dbIncident.started_at).getTime();
  const resolvedAtMs = dbIncident.resolved_at ? new Date(dbIncident.resolved_at).getTime() : Number.POSITIVE_INFINITY;
  const incidentChecks = relevantChecks.filter((check) => {
    const checkedAtMs = new Date(check.checkedAt).getTime();
    return checkedAtMs >= startedAtMs && checkedAtMs <= resolvedAtMs;
  });
  const failureChecks = incidentChecks.filter(
    (check) => check.status === 'offline' || check.status === 'critical'
  );
  const firstFailure = [...failureChecks]
    .reverse()
    .find(Boolean);
  const lastSuccess = incidentChecks.find((check) => check.status === 'online')
    || relevantChecks.find((check) => check.status === 'online');
  const latestCheck = relevantChecks[0];
  const incidentFailure = failureChecks[0];

  return {
    id: dbIncident.id,
    siteId: dbIncident.site_id,
    client: site?.client || 'Site não encontrado',
    siteName: site?.siteName || 'Cadastro indisponível',
    url: site?.url || '',
    type: dbIncident.type as IncidentType,
    severity: dbIncident.severity,
    status: dbIncident.status,
    startedAt: dbIncident.started_at,
    createdAt: formatFullDate(dbIncident.started_at),
    duration: formatIncidentDuration(dbIncident.started_at, dbIncident.resolved_at),
    resolvedAt: dbIncident.resolved_at ? formatFullDate(dbIncident.resolved_at) : undefined,
    resolvedAtIso: dbIncident.resolved_at || undefined,
    httpReturned: incidentFailure?.httpCode ?? 'Indisponível',
    failedChecksCount: failureChecks.length || null,
    lastSuccessfulCheck: lastSuccess?.timestamp || 'Sem registro disponível',
    firstErrorCheck: firstFailure?.timestamp || 'Sem registro disponível',
    currentStatus: dbIncident.status === 'resolved'
      ? 'Resolvido'
      : latestCheck?.result || 'Incidente ativo; aguardando nova verificação',
    explanation: dbIncident.description || dbIncident.title
  };
}

export async function getIncidentsFromDatabase(sites: Site[]): Promise<Incident[]> {
  const response = await apiRequest<{ incidents: DbIncident[] }>('/api/incidents');
  return response.incidents.map((incident) => mapDbIncidentToIncident(incident, sites));
}

export async function resolveIncidentInDatabase(incidentId: string): Promise<DbIncident> {
  const response = await apiRequest<{ incident: DbIncident }>(`/api/incidents/${encodeURIComponent(incidentId)}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify({})
  });
  return response.incident;
}

function mapSiteToPayload(siteData: Partial<Site>) {
  return {
    client_name: siteData.client,
    name: siteData.siteName,
    url: siteData.url,
    domain: siteData.domain,
    hosting_provider: siteData.hosting,
    is_wordpress: Boolean(siteData.isWordPress),
    check_interval: siteData.frequency,
    expected_content: siteData.expectedContentText || null,
    expected_ga4_id: siteData.tracking?.ga4?.expectedId || null,
    expected_gtm_id: siteData.tracking?.gtm?.expectedId || null,
    expected_google_ads_id: siteData.tracking?.googleAds?.expectedId || null,
    expected_meta_pixel_id: siteData.tracking?.metaPixel?.expectedId || null,
    uses_search_console: Boolean(siteData.tracking?.searchConsole?.searchConsoleConfigured),
    uses_rd_station: Boolean(siteData.tracking?.rdStation?.enabled)
  };
}

export async function createSiteInDatabase(siteData: Partial<Site>): Promise<Site | null> {
  const { site } = await apiRequest<{ site: DbSite }>('/api/sites', {
    method: 'POST',
    body: JSON.stringify(mapSiteToPayload(siteData))
  });

  try {
    await checkSiteNow(site.id);
  } catch (error) {
    // The site write succeeded. Keep that outcome unambiguous even if the
    // first monitoring attempt cannot be persisted yet.
    console.warn('[SiteService] Site criado, mas a verificação inicial falhou:', error);
  }
  try {
    const sites = await getSitesFromDatabase();
    return sites.find((candidate) => candidate.id === site.id) || mapDbSiteToSite(site);
  } catch (error) {
    console.warn('[SiteService] Site criado, mas a recarga da listagem falhou:', error);
    return mapDbSiteToSite(site);
  }
}

export async function updateSiteInDatabase(siteId: string, siteData: Partial<Site>): Promise<boolean> {
  await apiRequest(`/api/sites/${encodeURIComponent(siteId)}`, {
    method: 'PATCH',
    body: JSON.stringify(mapSiteToPayload(siteData))
  });
  return true;
}

export async function deleteSiteFromDatabase(siteId: string, confirmation: string): Promise<boolean> {
  await apiRequest(`/api/sites/${encodeURIComponent(siteId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmation })
  });
  return true;
}

export async function togglePauseSiteInDatabase(siteId: string, currentIsActive: boolean): Promise<boolean> {
  await apiRequest(`/api/sites/${encodeURIComponent(siteId)}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: !currentIsActive })
  });
  return true;
}

export async function checkSiteNow(siteId: string): Promise<{
  success: boolean;
  siteId?: string;
  checkId?: string;
  result: {
    status: 'online' | 'warning' | 'critical' | 'offline';
    httpStatus: number | null;
    responseTime: number;
    finalUrl: string;
    errorType?: string;
    errorMessage?: string;
    resultMessage: string;
  };
  checkedAt: string;
}> {
  return apiRequest('/api/check-site', {
    method: 'POST',
    body: JSON.stringify({ siteId })
  });
}

export async function checkAllSitesNow(): Promise<any> {
  return apiRequest('/api/check-all', {
    method: 'POST',
    body: JSON.stringify({})
  });
}
