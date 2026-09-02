import type { SupabaseClient } from '@supabase/supabase-js';
import { getDomainRdapDiagnostics, DomainRdapDiagnostics } from './domainRdapService';
import {
  executeHttpCheck,
  CheckExecutionResult,
  HttpCheckOptions,
  DEFAULT_TIMEOUT_MS
} from './httpChecker';
import { processPendingWebhookDeliveries, queueMonitoringAlerts } from './webhookAlertService';

export interface SiteRecordForCheck {
  id: string;
  url: string;
  name: string;
  domain?: string;
  is_active: boolean;
  is_wordpress?: boolean;
  check_interval?: string;
  monitor_response_time?: boolean;
  monitor_ssl?: boolean;
  monitor_domain?: boolean;
  expected_content?: string | null;
  expected_ga4_id?: string | null;
  expected_gtm_id?: string | null;
  expected_google_ads_id?: string | null;
  expected_meta_pixel_id?: string | null;
  uses_rd_station?: boolean;
}

export interface ProcessSiteCheckInput {
  siteId?: string;
  url?: string;
  trustedSite?: SiteRecordForCheck;
  runId?: string;
}

export type IncidentTransition = 'opened' | 'resolved' | 'unchanged';

export interface ProcessedSiteCheck {
  success: true;
  siteId?: string;
  siteName?: string;
  url: string;
  checkedAt: string;
  checkId?: string;
  incidentId?: string;
  incidentTransition?: IncidentTransition;
  result: CheckExecutionResult;
  domain?: DomainRdapDiagnostics;
}

export interface SiteCheckDependencies {
  supabase: SupabaseClient | null;
  executeCheck?: (url: string, options?: HttpCheckOptions) => Promise<CheckExecutionResult>;
  now?: () => Date;
  getDomainDiagnostics?: (
    supabase: SupabaseClient,
    domain: string,
    now?: () => Date
  ) => Promise<DomainRdapDiagnostics>;
}

export class SiteCheckError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = 'SITE_CHECK_ERROR'
  ) {
    super(message);
  }
}

export const FAILURE_CHECKS_TO_OPEN_INCIDENT = 3;
export const SUCCESS_CHECKS_TO_RESOLVE_INCIDENT = 2;

export function determineIncidentTransition(
  recentStatuses: CheckExecutionResult['status'][],
  hasActiveIncident: boolean
): IncidentTransition {
  const hasConfirmedFailure = recentStatuses.length >= FAILURE_CHECKS_TO_OPEN_INCIDENT
    && recentStatuses.slice(0, FAILURE_CHECKS_TO_OPEN_INCIDENT)
      .every((status) => status === 'critical' || status === 'offline');
  if (!hasActiveIncident && hasConfirmedFailure) return 'opened';
  const hasConfirmedRecovery = recentStatuses.length >= SUCCESS_CHECKS_TO_RESOLVE_INCIDENT
    && recentStatuses.slice(0, SUCCESS_CHECKS_TO_RESOLVE_INCIDENT)
      .every((status) => status === 'online');
  if (hasActiveIncident && hasConfirmedRecovery) return 'resolved';
  return 'unchanged';
}

async function loadOfficialSite(siteId: string, supabase: SupabaseClient | null): Promise<SiteRecordForCheck> {
  if (!supabase) {
    throw new SiteCheckError(
      'Supabase não está configurado no backend para consultar o site.', 503, 'DATABASE_UNAVAILABLE'
    );
  }
  const { data, error } = await supabase
    .from('sites')
    .select([
      'id', 'url', 'name', 'domain', 'is_active', 'is_wordpress', 'check_interval',
      'monitor_response_time', 'monitor_ssl', 'monitor_domain',
      'expected_content', 'expected_ga4_id', 'expected_gtm_id',
      'expected_google_ads_id', 'expected_meta_pixel_id', 'uses_rd_station'
    ].join(','))
    .eq('id', siteId)
    .single();
  if (error || !data) throw new SiteCheckError('Site não encontrado no banco de dados.', 404, 'SITE_NOT_FOUND');
  return data as unknown as SiteRecordForCheck;
}

function checkOptionsForSite(site?: SiteRecordForCheck): HttpCheckOptions {
  return {
    expectedContent: site?.expected_content,
    evaluateSsl: site?.monitor_ssl !== false,
    trackingExpectations: {
      ga4: site?.expected_ga4_id,
      gtm: site?.expected_gtm_id,
      googleAds: site?.expected_google_ads_id,
      metaPixel: site?.expected_meta_pixel_id,
      rdStation: site?.uses_rd_station
    }
  };
}

function compactProbe(result: CheckExecutionResult) {
  return {
    status: result.status,
    httpStatus: result.httpStatus,
    responseTime: result.responseTime,
    finalUrl: result.finalUrl,
    errorType: result.errorType,
    errorMessage: result.errorMessage,
    available: result.httpStatus !== null && result.httpStatus >= 200 && result.httpStatus <= 499
  };
}

async function addWordPressDiagnostics(
  site: SiteRecordForCheck,
  result: CheckExecutionResult,
  executeCheck: (url: string, options?: HttpCheckOptions) => Promise<CheckExecutionResult>
): Promise<void> {
  const detected = Boolean(result.wordpress?.detected);
  if ((!site.is_wordpress && !detected) || result.httpStatus === null) return;
  let origin: string;
  try { origin = new URL(result.finalUrl).origin; } catch { return; }
  const [admin, login] = await Promise.all([
    executeCheck(new URL('/wp-admin/', origin).toString()),
    executeCheck(new URL('/wp-login.php', origin).toString())
  ]);
  result.wordpress = {
    ...result.wordpress,
    configured: Boolean(site.is_wordpress),
    detected,
    wpAdmin: compactProbe(admin),
    wpLogin: compactProbe(login),
    administrativeAvailable: compactProbe(admin).available || compactProbe(login).available,
    note: 'Diagnóstico não invasivo; nenhuma autenticação ou enumeração foi tentada.'
  };
}

async function persistStructuredResult(
  supabase: SupabaseClient,
  site: SiteRecordForCheck,
  checkedAt: string,
  result: CheckExecutionResult,
  domain: DomainRdapDiagnostics | undefined,
  runId?: string
): Promise<{ checkId: string; incidentTransition: IncidentTransition; incidentId?: string }> {
  const diagnostics = {
    tracking: result.tracking || null,
    expectedContent: result.expectedContent || null,
    transport: {
      finalUrl: result.finalUrl,
      redirectCount: result.redirectCount,
      observedIp: result.observedIp || null
    },
    classification: {
      incidentEligible: result.incidentEligible,
      httpStatus: result.httpStatus,
      status: result.status
    }
  };
  const { data, error } = await supabase.rpc('record_monitoring_result', {
    p_site_id: site.id,
    p_checked_at: checkedAt,
    p_status: result.status,
    p_http_status: result.httpStatus,
    p_response_time: result.httpStatus === null || result.incidentEligible
      ? null
      : result.responseTime,
    p_final_url: result.finalUrl,
    p_error_type: result.errorType || null,
    p_error_message: result.errorMessage || null,
    p_observed_ip: result.observedIp || null,
    p_dns_records: result.dns || null,
    p_ssl: result.ssl || null,
    p_expected_content_found: result.expectedContent?.found ?? null,
    p_wordpress: result.wordpress || null,
    p_domain_rdap: domain || null,
    p_redirect_count: result.redirectCount,
    p_result_message: result.resultMessage,
    p_diagnostics: diagnostics,
    p_incident_eligible: result.incidentEligible,
    p_run_id: runId || null
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.check_id) {
    throw new SiteCheckError(
      `A verificação foi executada, mas não foi possível persistir o resultado atômico: ${error?.message || 'migration pendente'}`,
      500,
      'CHECK_PERSISTENCE_FAILED'
    );
  }
  return {
    checkId: row.check_id,
    incidentTransition: (row.incident_transition || 'unchanged') as IncidentTransition,
    incidentId: row.related_incident_id || undefined
  };
}

export async function processSiteCheck(
  input: ProcessSiteCheckInput,
  dependencies: SiteCheckDependencies
): Promise<ProcessedSiteCheck> {
  const executeCheck = dependencies.executeCheck || ((url, options) => executeHttpCheck(url, DEFAULT_TIMEOUT_MS, {}, options));
  const now = dependencies.now || (() => new Date());
  let site: SiteRecordForCheck | undefined;
  if (input.siteId) {
    site = input.trustedSite?.id === input.siteId
      ? input.trustedSite
      : await loadOfficialSite(input.siteId, dependencies.supabase);
  }
  const targetUrl = site?.url || input.url;
  if (!targetUrl) throw new SiteCheckError('URL ou siteId é obrigatório para a verificação.', 400, 'TARGET_REQUIRED');

  const domainPromise = site?.domain && dependencies.supabase
    ? (dependencies.getDomainDiagnostics || getDomainRdapDiagnostics)(dependencies.supabase, site.domain, now)
    : Promise.resolve(undefined);
  const result = await executeCheck(targetUrl, checkOptionsForSite(site));
  if (site) await addWordPressDiagnostics(site, result, executeCheck);
  const domain = await domainPromise;
  const checkedAt = now().toISOString();
  let checkId: string | undefined;
  let incidentId: string | undefined;
  let incidentTransition: IncidentTransition | undefined;

  if (site) {
    if (!dependencies.supabase) {
      throw new SiteCheckError('Supabase não está disponível para persistir o check.', 503, 'DATABASE_UNAVAILABLE');
    }
    const persisted = await persistStructuredResult(
      dependencies.supabase, site, checkedAt, result, domain, input.runId
    );
    checkId = persisted.checkId;
    incidentId = persisted.incidentId;
    incidentTransition = persisted.incidentTransition;
  }

  const processed: ProcessedSiteCheck = {
    success: true,
    siteId: site?.id,
    siteName: site?.name,
    url: targetUrl,
    checkedAt,
    checkId,
    incidentId,
    incidentTransition,
    result,
    domain
  };
  if (site && dependencies.supabase) {
    await queueMonitoringAlerts(dependencies.supabase, site, processed).catch(() => 0);
    // Delivery happens after the durable check/queue write and never delays the
    // monitoring result. Pending rows are retried by subsequent cron runs.
    void processPendingWebhookDeliveries(dependencies.supabase).catch(() => undefined);
  }
  return processed;
}
