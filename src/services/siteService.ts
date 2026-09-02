import {
  Site,
  CheckRecord,
  DbSite,
  DbCheck,
  DbIncident,
  Incident,
  IncidentType,
  HostingProvider,
  MonitoringFrequency,
  SiteDeletionImpact,
  SiteDeletionResult,
  SiteMetrics,
  MonitoringSeriesPoint,
  TrackingToolResult
} from '../types';
import { diagnosticSummary, diagnosticTypeLabel, missingHttpLabel } from '../utils/diagnosticLabels';

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
    if (!Number.isFinite(date.getTime())) return 'Falha na verificação';
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
    if (!Number.isFinite(parsedTime)) return 'Falha na verificação';
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
  uptimeCounts?: { totalChecks: number; availableChecks: number },
  metrics: SiteMetrics = {},
  domainCache?: Record<string, any> | null
): Site {
  const latestCheck = checks[0] || null;
  const hasValidResponseTime = (check: DbCheck | null): check is DbCheck => Boolean(
    check
    && check.incident_eligible !== true
    && check.http_status !== null
    && check.response_time !== null
    && check.response_time !== undefined
    && Number(check.response_time) > 0
  );
  const latestResponseSeconds = hasValidResponseTime(latestCheck)
    ? +(latestCheck.response_time / 1000).toFixed(2)
    : null;
  const validResponseTimes = checks
    .filter((check) => hasValidResponseTime(check))
    .map((check) => Number(check.response_time) / 1000);
  const avgResponseSeconds = validResponseTimes.length
    ? +(validResponseTimes.reduce((sum, value) => sum + value, 0) / validResponseTimes.length).toFixed(2)
    : null;
  const uptime30dMetric = metrics['30d'];
  const metricTotalChecks = Number(uptime30dMetric?.totalChecks || 0);
  const metricUptime = uptime30dMetric?.uptimePercent;
  const fallbackTotalChecks = Number(uptimeCounts?.totalChecks || 0);
  const fallbackAvailableChecks = Number(uptimeCounts?.availableChecks || 0);
  const uptime = metricTotalChecks > 0 && metricUptime !== null && metricUptime !== undefined
    ? Number(metricUptime)
    : fallbackTotalChecks > 0
    ? +((fallbackAvailableChecks / fallbackTotalChecks) * 100).toFixed(2)
    : null;

  let currentStatus: Site['status'] = 'unknown';
  if (!dbSite.is_active) currentStatus = 'paused';
  else if (dbSite.monitoring_state === 'security_blocked') currentStatus = 'security_blocked';
  else if (activeIncident) {
    if (latestCheck?.status === 'offline' || latestCheck?.status === 'critical') currentStatus = latestCheck.status;
    else if (latestCheck) currentStatus = 'warning';
    else currentStatus = 'critical';
  }
  else if (dbSite.monitoring_state === 'suspected_failure' || dbSite.monitoring_state === 'recovering') currentStatus = 'warning';
  else if (dbSite.monitoring_state === 'down') currentStatus = latestCheck?.status === 'offline' ? 'offline' : 'critical';
  else if (latestCheck) currentStatus = latestCheck.status;

  const checksHistory: CheckRecord[] = checks.map((check) => ({
    id: check.id,
    timestamp: formatFullDate(check.checked_at),
    checkedAt: check.checked_at,
    status: check.status,
    httpCode: check.http_status ?? missingHttpLabel(check.status, check.error_type),
    responseTime: hasValidResponseTime(check) ? +(check.response_time / 1000).toFixed(2) : 0,
    result: diagnosticSummary(check),
    expectedContentFound: check.expected_content_found ?? undefined,
    errorType: check.error_type || undefined,
    errorMessage: check.error_message || undefined,
    incidentId: check.incident_id || undefined,
    observedIp: check.observed_ip || undefined,
    finalUrl: check.final_url || undefined,
    redirectCount: check.redirect_count ?? 0
  }));

  const trackingDiagnostics = latestCheck?.diagnostics?.tracking as Record<string, any> | undefined;
  const trackingResult = (key: string): TrackingToolResult | undefined => {
    const value = trackingDiagnostics?.[key];
    if (!value) return undefined;
    const expectedMismatch = value.expectedId && value.expectedIdFound === false;
    return {
      detected: Boolean(value.detected),
      foundId: Array.isArray(value.foundIds) ? value.foundIds[0] : undefined,
      expectedId: value.expectedId,
      status: expectedMismatch ? 'red' : value.detected ? 'green' : 'gray',
      statusLabel: expectedMismatch ? 'Tag esperada não detectada' : value.detected ? 'Tag detectada' : 'Não detectada',
      message: value.detected
        ? 'Evidência encontrada no HTML; funcionamento não confirmado.'
        : 'Nenhuma evidência encontrada no HTML analisado.',
      lastDetectedAt: latestCheck?.checked_at,
      detectionMethod: 'HTML estático'
    };
  };
  const ssl = latestCheck?.ssl || null;
  const domainInfo = latestCheck?.domain_rdap || domainCache || null;

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
    uptime30dReliable: uptime30dMetric ? Boolean(uptime30dMetric.hasFullWindow) : Boolean(uptimeCounts?.totalChecks),
    responseTime: latestResponseSeconds,
    avgResponseTime: metrics['24h']?.avgResponseMs !== null && metrics['24h']?.avgResponseMs !== undefined
      ? +(Number(metrics['24h']!.avgResponseMs) / 1000).toFixed(2)
      : avgResponseSeconds,
    sslValid: typeof ssl?.valid === 'boolean' ? ssl.valid : null,
    sslDaysRemaining: typeof ssl?.daysRemaining === 'number' ? ssl.daysRemaining : null,
    domainDaysRemaining: typeof domainInfo?.daysRemaining === 'number'
      ? domainInfo.daysRemaining
      : typeof domainInfo?.days_remaining === 'number' ? domainInfo.days_remaining : null,
    lastCheck: latestCheck ? formatRelativeTime(latestCheck.checked_at) : 'Ainda não verificado',
    httpStatus: latestCheck?.http_status ?? (latestCheck ? missingHttpLabel(latestCheck.status, latestCheck.error_type) : null),
    finalUrl: latestCheck?.final_url || undefined,
    redirectCount: latestCheck?.redirect_count ?? undefined,
    monitorAvailability: true,
    monitorResponseTime: dbSite.monitor_response_time !== false,
    monitorSsl: dbSite.monitor_ssl !== false,
    monitorDomain: dbSite.monitor_domain !== false,
    monitorRedirects: true,
    monitorContent: Boolean(dbSite.expected_content),
    expectedContentText: dbSite.expected_content || '',
    consecutiveFailures: dbSite.consecutive_failures ?? 0,
    createdAt: dbSite.created_at?.slice(0, 10) || 'Falha na verificação',
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
      lastCheckedAt: latestCheck?.checked_at,
      results: trackingDiagnostics ? {
        ga4: trackingResult('ga4')!,
        gtm: trackingResult('gtm')!,
        googleAds: trackingResult('googleAds')!,
        metaPixel: trackingResult('metaPixel')!,
        searchConsole: {
          detected: false, status: 'gray', statusLabel: 'Não aplicável',
          message: 'A propriedade não pode ser confirmada por HTML.'
        },
        rdStation: trackingResult('rdStation')!
      } : undefined
    },
    metrics,
    dns: latestCheck?.dns_records || undefined,
    ssl,
    domainInfo,
    wordpress: latestCheck?.wordpress || null
  };
}

export async function getSitesFromDatabase(): Promise<Site[]> {
  const response = await apiRequest<{
    sites: Array<{
      site: DbSite;
      latestCheck: DbCheck | null;
      activeIncident: DbIncident | null;
      domainCache: Record<string, any> | null;
      metrics: SiteMetrics;
    }>;
  }>('/api/sites');
  return response.sites.map((entry) =>
    mapDbSiteToSite(
      entry.site,
      entry.latestCheck ? [entry.latestCheck] : [],
      entry.activeIncident,
      undefined,
      entry.metrics,
      entry.domainCache
    )
  );
}

function formatIncidentDuration(startedAt: string, resolvedAt?: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'Falha na verificação';
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
  const rawType = String(dbIncident.type || '');
  const technicalType = /^[A-Z][A-Z0-9_]+$/.test(rawType) ? rawType : null;
  const technicalCode = dbIncident.reason || technicalType || undefined;
  const displayType = technicalType
    ? diagnosticTypeLabel(technicalType, 'offline', null)
    : rawType || 'Falha na verificação';
  const rawExplanation = dbIncident.description || dbIncident.title;
  const explanationContainsCode = /\b(?:E[A-Z0-9_]{2,}|ERR_[A-Z0-9_]+|UNKNOWN|CONNECTION_ERROR|TLS_ERROR|DNS_[A-Z_]+|SSRF_[A-Z_]+)\b/.test(rawExplanation || '');

  return {
    id: dbIncident.id,
    siteId: dbIncident.site_id,
    client: site?.client || dbIncident.sites?.client_name || 'Site não encontrado',
    siteName: site?.siteName || dbIncident.sites?.name || 'Cadastro indisponível',
    url: site?.url || dbIncident.sites?.url || '',
    type: displayType as IncidentType,
    severity: dbIncident.severity,
    status: dbIncident.status,
    startedAt: dbIncident.started_at,
    createdAt: formatFullDate(dbIncident.started_at),
    duration: dbIncident.duration_seconds !== null && dbIncident.duration_seconds !== undefined
      ? formatIncidentDuration(dbIncident.started_at, new Date(new Date(dbIncident.started_at).getTime() + dbIncident.duration_seconds * 1000).toISOString())
      : formatIncidentDuration(dbIncident.started_at, dbIncident.resolved_at),
    resolvedAt: dbIncident.resolved_at ? formatFullDate(dbIncident.resolved_at) : undefined,
    resolvedAtIso: dbIncident.resolved_at || undefined,
    httpReturned: incidentFailure?.httpCode ?? 'Sem dados suficientes',
    failedChecksCount: dbIncident.failed_checks_count || failureChecks.length || null,
    lastSuccessfulCheck: lastSuccess?.timestamp || 'Sem dados suficientes',
    firstErrorCheck: firstFailure?.timestamp || 'Sem dados suficientes',
    currentStatus: dbIncident.status === 'resolved'
      ? 'Resolvido'
      : latestCheck?.result || 'Incidente ativo; aguardando nova verificação',
    explanation: rawExplanation && !explanationContainsCode
      ? rawExplanation
      : diagnosticTypeLabel(technicalCode, 'offline', null),
    technicalCode
  };
}

export async function getIncidentsFromDatabase(sites: Site[]): Promise<Incident[]> {
  const incidents: DbIncident[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const response = await apiRequest<{
      incidents: DbIncident[];
      pagination: { hasMore: boolean; nextCursor: string | null };
    }>(`/api/incidents?${query}`);
    incidents.push(...response.incidents);
    cursor = response.pagination.hasMore ? response.pagination.nextCursor : null;
  } while (cursor);
  return incidents.map((incident) => mapDbIncidentToIncident(incident, sites));
}

export async function resolveIncidentInDatabase(incidentId: string): Promise<DbIncident> {
  const response = await apiRequest<{ incident: DbIncident }>(`/api/incidents/${encodeURIComponent(incidentId)}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify({})
  });
  return response.incident;
}

export async function getSiteChecksPage(
  siteId: string,
  limit = 50,
  cursor?: string | null
): Promise<{ checks: CheckRecord[]; hasMore: boolean; nextCursor: string | null }> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest<{
    checks: DbCheck[];
    pagination: { hasMore: boolean; nextCursor: string | null };
  }>(`/api/sites/${encodeURIComponent(siteId)}/checks?${query}`);
  const mapped = mapDbSiteToSite({
    id: siteId, client_name: '', name: '', url: '', domain: '', hosting_provider: 'Outro',
    is_wordpress: false, is_active: true, check_interval: '5min', uses_search_console: false,
    uses_rd_station: false, created_at: '', updated_at: ''
  }, response.checks).checksHistory;
  return { checks: mapped, hasMore: response.pagination.hasMore, nextCursor: response.pagination.nextCursor };
}

export async function getSiteMonitoringMetrics(
  siteId: string,
  period: '24h' | '7d' | '30d' | '90d'
): Promise<{ metrics: SiteMetrics; series: MonitoringSeriesPoint[] }> {
  const response = await apiRequest<{ metrics: SiteMetrics; series: MonitoringSeriesPoint[] }>(
    `/api/sites/${encodeURIComponent(siteId)}/metrics?period=${period}`
  );
  return { metrics: response.metrics, series: response.series };
}

export interface AlertWebhookConfig {
  id?: string;
  url: string;
  enabled: boolean;
  timeout_ms: number;
  event_types: Array<'incident_confirmed' | 'recovery' | 'ssl_expiring' | 'dns_changed'>;
}

export type EmailAlertEventType = 'incident_confirmed' | 'recovery';

export interface AlertEmailConfig {
  id?: string;
  enabled: boolean;
  recipients: string[];
  event_types: EmailAlertEventType[];
  configured: boolean;
  provider: string;
  providerReady: boolean;
  label: string;
}

export interface AlertDeliverySummary {
  id: string;
  channel: 'webhook' | 'email';
  recipient?: string | null;
  event_type: AlertWebhookConfig['event_types'][number] | 'email_test';
  status: 'pending' | 'processing' | 'delivered' | 'failed';
  attempt_count: number;
  response_status?: number | null;
  provider_message_id?: string | null;
  last_error_code?: string | null;
  error_message?: string | null;
  next_attempt_at?: string | null;
  created_at: string;
  attempted_at?: string | null;
  delivered_at?: string | null;
}

export async function getAlertConfiguration(): Promise<{
  webhook: AlertWebhookConfig | null;
  email: AlertEmailConfig;
  recentDeliveries: AlertDeliverySummary[];
}> {
  return apiRequest('/api/alerts/config');
}

export async function saveAlertEmail(config: {
  enabled: boolean;
  recipients: string[];
  eventTypes: EmailAlertEventType[];
}): Promise<AlertEmailConfig> {
  const response = await apiRequest<{ email: AlertEmailConfig }>('/api/alerts/email', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  return response.email;
}

export async function queueAlertEmailTest(): Promise<{ success: boolean; queued: number; message: string }> {
  return apiRequest('/api/alerts/email/test', { method: 'POST', body: JSON.stringify({}) });
}

export async function saveAlertWebhook(config: {
  url: string;
  enabled: boolean;
  timeoutMs: number;
  eventTypes: AlertWebhookConfig['event_types'];
}): Promise<AlertWebhookConfig> {
  const response = await apiRequest<{ webhook: AlertWebhookConfig }>('/api/alerts/webhook', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  return response.webhook;
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
    monitor_response_time: siteData.monitorResponseTime,
    monitor_ssl: siteData.monitorSsl,
    monitor_domain: siteData.monitorDomain,
    expected_content: siteData.expectedContentText || null,
    expected_ga4_id: siteData.tracking?.ga4?.expectedId || null,
    expected_gtm_id: siteData.tracking?.gtm?.expectedId || null,
    expected_google_ads_id: siteData.tracking?.googleAds?.expectedId || null,
    expected_meta_pixel_id: siteData.tracking?.metaPixel?.expectedId || null,
    uses_search_console: Boolean(siteData.tracking?.searchConsole?.enabled && siteData.tracking?.searchConsole?.searchConsoleConfigured),
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

export async function getSiteDeletionImpact(siteId: string): Promise<SiteDeletionImpact> {
  const response = await apiRequest<{ impact: SiteDeletionImpact }>(
    `/api/sites/${encodeURIComponent(siteId)}/deletion-impact`
  );
  return response.impact;
}

export async function deleteSiteFromDatabase(siteId: string, confirmation: string): Promise<SiteDeletionResult> {
  return apiRequest<SiteDeletionResult>(`/api/sites/${encodeURIComponent(siteId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmation })
  });
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
    status: 'online' | 'warning' | 'critical' | 'offline' | 'security_blocked';
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

export async function checkAllSitesNow(): Promise<{
  success: true;
  queued: true;
  queuedAt: string;
  message: string;
}> {
  return apiRequest('/api/check-all', {
    method: 'POST',
    body: JSON.stringify({})
  });
}
