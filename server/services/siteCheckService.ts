import type { SupabaseClient } from '@supabase/supabase-js';
import { executeHttpCheck, CheckExecutionResult } from './httpChecker';

export interface SiteRecordForCheck {
  id: string;
  url: string;
  name: string;
  is_active: boolean;
}

export interface ProcessSiteCheckInput {
  siteId?: string;
  url?: string;
  trustedSite?: SiteRecordForCheck;
}

export interface ProcessedSiteCheck {
  success: true;
  siteId?: string;
  siteName?: string;
  checkedAt: string;
  checkId?: string;
  incidentTransition?: IncidentTransition;
  result: CheckExecutionResult;
}

export interface SiteCheckDependencies {
  supabase: SupabaseClient | null;
  executeCheck?: (url: string) => Promise<CheckExecutionResult>;
  now?: () => Date;
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

const siteCheckQueues = new Map<string, Promise<unknown>>();

export const FAILURE_CHECKS_TO_OPEN_INCIDENT = 3;
export const SUCCESS_CHECKS_TO_RESOLVE_INCIDENT = 2;

export type IncidentTransition = 'opened' | 'resolved' | 'unchanged';

export function determineIncidentTransition(
  recentStatuses: CheckExecutionResult['status'][],
  hasActiveIncident: boolean
): IncidentTransition {
  const hasConfirmedFailure = recentStatuses.length >= FAILURE_CHECKS_TO_OPEN_INCIDENT
    && recentStatuses
      .slice(0, FAILURE_CHECKS_TO_OPEN_INCIDENT)
      .every((status) => status === 'critical' || status === 'offline');
  if (!hasActiveIncident && hasConfirmedFailure) return 'opened';

  const hasConfirmedRecovery = recentStatuses.length >= SUCCESS_CHECKS_TO_RESOLVE_INCIDENT
    && recentStatuses
      .slice(0, SUCCESS_CHECKS_TO_RESOLVE_INCIDENT)
      .every((status) => status === 'online');
  if (hasActiveIncident && hasConfirmedRecovery) return 'resolved';

  return 'unchanged';
}

async function serializeSiteCheck<T>(siteId: string, operation: () => Promise<T>): Promise<T> {
  const previous = siteCheckQueues.get(siteId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  siteCheckQueues.set(siteId, current);

  try {
    return await current;
  } finally {
    if (siteCheckQueues.get(siteId) === current) siteCheckQueues.delete(siteId);
  }
}

async function loadOfficialSite(
  siteId: string,
  supabase: SupabaseClient | null
): Promise<SiteRecordForCheck> {
  if (!supabase) {
    throw new SiteCheckError(
      'Supabase não está configurado no backend para consultar o site.',
      503,
      'DATABASE_UNAVAILABLE'
    );
  }

  const { data, error } = await supabase
    .from('sites')
    .select('id, url, name, is_active')
    .eq('id', siteId)
    .single();

  if (error || !data) {
    throw new SiteCheckError('Site não encontrado no banco de dados.', 404, 'SITE_NOT_FOUND');
  }

  return data as SiteRecordForCheck;
}

async function persistCheckAndCurrentIncidentState(
  supabase: SupabaseClient,
  site: SiteRecordForCheck,
  checkedAt: string,
  result: CheckExecutionResult
): Promise<{ checkId: string; incidentTransition: IncidentTransition }> {
  const { data: insertedCheck, error: checkError } = await supabase
    .from('checks')
    .insert({
      site_id: site.id,
      checked_at: checkedAt,
      status: result.status,
      http_status: result.httpStatus,
      response_time: result.responseTime,
      final_url: result.finalUrl,
      error_type: result.errorType || null,
      error_message: result.errorMessage || null
    })
    .select('id')
    .single();

  if (checkError || !insertedCheck) {
    throw new SiteCheckError(
      `A verificação foi executada, mas não foi possível gravar o check: ${checkError?.message || 'erro desconhecido'}`,
      500,
      'CHECK_PERSISTENCE_FAILED'
    );
  }

  const [recentChecksResult, activeIncidentsResult] = await Promise.all([
    supabase
      .from('checks')
      .select('status, checked_at')
      .eq('site_id', site.id)
      .order('checked_at', { ascending: false })
      .limit(FAILURE_CHECKS_TO_OPEN_INCIDENT),
    supabase
      .from('incidents')
      .select('id')
      .eq('site_id', site.id)
      .eq('status', 'active')
      .limit(1)
  ]);

  if (recentChecksResult.error || activeIncidentsResult.error) {
    throw new SiteCheckError(
      `Check salvo, mas houve falha ao avaliar incidentes: ${recentChecksResult.error?.message || activeIncidentsResult.error?.message}`,
      500,
      'INCIDENT_QUERY_FAILED'
    );
  }

  const activeIncident = activeIncidentsResult.data?.[0];
  const incidentTransition = determineIncidentTransition(
    (recentChecksResult.data || []).map((check) => check.status as CheckExecutionResult['status']),
    Boolean(activeIncident)
  );

  if (incidentTransition === 'opened') {
    const confirmedFailureStartedAt = recentChecksResult.data?.[FAILURE_CHECKS_TO_OPEN_INCIDENT - 1]?.checked_at || checkedAt;
    const { error: incidentError } = await supabase.from('incidents').insert({
      site_id: site.id,
      type: result.httpStatus ? `HTTP ${result.httpStatus}` : result.errorType || 'Site fora do ar',
      severity: 'critical',
      title: `Instabilidade confirmada: ${result.resultMessage}`,
      description: `${FAILURE_CHECKS_TO_OPEN_INCIDENT} verificações consecutivas confirmaram ${result.status} para ${site.url}. ${result.errorMessage || result.resultMessage}`,
      started_at: confirmedFailureStartedAt,
      status: 'active'
    });

    if (incidentError) {
      throw new SiteCheckError(
        `Check salvo, mas não foi possível registrar o incidente: ${incidentError.message}`,
        500,
        'INCIDENT_PERSISTENCE_FAILED'
      );
    }
  } else if (incidentTransition === 'resolved' && activeIncident) {
    const { error: resolutionError } = await supabase
      .from('incidents')
      .update({ status: 'resolved', resolved_at: checkedAt })
      .eq('id', activeIncident.id)
      .eq('status', 'active');

    if (resolutionError) {
      throw new SiteCheckError(
        `Check salvo, mas não foi possível resolver o incidente ativo: ${resolutionError.message}`,
        500,
        'INCIDENT_RESOLUTION_FAILED'
      );
    }
  }

  return { checkId: insertedCheck.id, incidentTransition };
}

export async function processSiteCheck(
  input: ProcessSiteCheckInput,
  dependencies: SiteCheckDependencies
): Promise<ProcessedSiteCheck> {
  const executeCheck = dependencies.executeCheck || executeHttpCheck;
  const now = dependencies.now || (() => new Date());

  let site: SiteRecordForCheck | undefined;
  if (input.siteId) {
    // trustedSite is only supplied internally after /check-all loads active sites
    // from the database. Public requests never get to populate this object.
    site = input.trustedSite?.id === input.siteId
      ? input.trustedSite
      : await loadOfficialSite(input.siteId, dependencies.supabase);
  }

  const targetUrl = site?.url || input.url;
  if (!targetUrl) {
    throw new SiteCheckError('URL ou siteId é obrigatório para a verificação.', 400, 'TARGET_REQUIRED');
  }

  // When siteId exists, input.url is intentionally ignored. This guarantees
  // that an arbitrary URL cannot be persisted under another site's identity.
  const runCheck = async (): Promise<ProcessedSiteCheck> => {
    const result = await executeCheck(targetUrl);
    const checkedAt = now().toISOString();
    let checkId: string | undefined;
    let incidentTransition: IncidentTransition | undefined;

    if (site) {
      if (!dependencies.supabase) {
        throw new SiteCheckError('Supabase não está disponível para persistir o check.', 503, 'DATABASE_UNAVAILABLE');
      }
      const persisted = await persistCheckAndCurrentIncidentState(
        dependencies.supabase,
        site,
        checkedAt,
        result
      );
      checkId = persisted.checkId;
      incidentTransition = persisted.incidentTransition;
    }

    return {
      success: true,
      siteId: site?.id,
      siteName: site?.name,
      checkedAt,
      checkId,
      incidentTransition,
      result
    };
  };

  return site ? serializeSiteCheck(site.id, runCheck) : runCheck();
}
