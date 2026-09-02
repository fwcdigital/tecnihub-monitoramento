import http from 'node:http';
import https from 'node:https';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckExecutionResult } from './httpChecker';
import type { ProcessedSiteCheck, SiteRecordForCheck } from './siteCheckService';
import { normalizeHttpUrl, validateUrlForSSRF } from './ssrfProtection';

export type AlertEventType = 'incident_confirmed' | 'recovery' | 'ssl_expiring' | 'dns_changed';

async function previousObservedIp(supabase: SupabaseClient, siteId: string, checkId: string): Promise<string | null> {
  const { data } = await supabase
    .from('checks')
    .select('id, observed_ip')
    .eq('site_id', siteId)
    .not('observed_ip', 'is', null)
    .order('checked_at', { ascending: false })
    .limit(2);
  return data?.find((row: any) => row.id !== checkId)?.observed_ip || null;
}

export function buildEvents(
  site: SiteRecordForCheck,
  check: ProcessedSiteCheck,
  priorIp: string | null
): Array<{ type: AlertEventType; key: string; payload: Record<string, unknown> }> {
  const events: Array<{ type: AlertEventType; key: string; payload: Record<string, unknown> }> = [];
  const base = {
    eventVersion: 2,
    site: { clientName: site.client_name, name: site.name, domain: site.domain, url: site.url },
    checkedAt: check.checkedAt,
    status: check.result.status,
    httpStatus: check.result.httpStatus,
    responseTimeMs: check.result.responseTime
  };
  if (check.incidentId && check.incidentTransition === 'opened') {
    events.push({
      type: 'incident_confirmed',
      key: `incident:${check.incidentId}:confirmed`,
      payload: {
        ...base,
        event: 'incident_confirmed',
        incidentId: check.incidentId,
        confirmedAt: check.checkedAt,
        reason: {
          human: check.result.resultMessage,
          technicalCode: check.result.errorType,
          technicalMessage: check.result.errorMessage,
          httpStatus: check.result.httpStatus
        }
      }
    });
  }
  if (check.incidentId && check.incidentTransition === 'resolved') {
    events.push({
      type: 'recovery',
      key: `incident:${check.incidentId}:recovery`,
      payload: { ...base, event: 'recovery', incidentId: check.incidentId, recoveredAt: check.checkedAt }
    });
  }
  if (check.result.ssl?.applicable && ['warning', 'critical'].includes(check.result.ssl.severity)) {
    events.push({
      type: 'ssl_expiring',
      key: `ssl:${site.id}:${check.result.ssl.validTo || 'unknown'}:${check.result.ssl.severity}`,
      payload: { ...base, event: 'ssl_expiring', ssl: check.result.ssl }
    });
  }
  if (priorIp && check.result.observedIp && priorIp !== check.result.observedIp) {
    events.push({
      type: 'dns_changed',
      key: `dns:${site.id}:${priorIp}:${check.result.observedIp}`,
      payload: { ...base, event: 'dns_changed', previousIp: priorIp, observedIp: check.result.observedIp }
    });
  }
  return events;
}

export async function queueMonitoringAlerts(
  supabase: SupabaseClient,
  site: SiteRecordForCheck,
  check: ProcessedSiteCheck
): Promise<number> {
  if (!check.checkId) return 0;
  const priorIp = await previousObservedIp(supabase, site.id, check.checkId);
  const events = buildEvents(site, check, priorIp);
  if (!events.length) return 0;
  const rows = events.map((event) => ({
    event_key: event.key,
    site_id: site.id,
    incident_id: check.incidentId || null,
    check_id: check.checkId,
    event_type: event.type,
    payload: event.payload
  }));
  if (!rows.length) return 0;
  const { error: insertError } = await supabase
    .from('monitoring_alert_events')
    .upsert(rows, { onConflict: 'event_key', ignoreDuplicates: true });
  return insertError ? 0 : rows.length;
}

export async function postPinnedJson(urlString: string, payload: unknown, timeoutMs: number): Promise<number> {
  const normalized = normalizeHttpUrl(urlString);
  const validation = await validateUrlForSSRF(normalized);
  if (!validation.valid || !validation.resolvedAddresses?.length) {
    throw new Error(validation.errorType?.startsWith('SSRF_')
      ? 'Webhook bloqueado pela proteção SSRF.'
      : 'Webhook sem DNS público válido.');
  }
  return new Promise((resolve, reject) => {
    const url = new URL(normalized);
    const address = validation.resolvedAddresses[0];
    const body = JSON.stringify(payload);
    const transport = url.protocol === 'https:' ? https : http;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const request = transport.request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      servername: url.protocol === 'https:' ? hostname : undefined,
      rejectUnauthorized: true,
      headers: {
        Host: url.port ? `${hostname}:${url.port}` : hostname,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'TecnihubMonitoringWebhook/1.0',
        Connection: 'close'
      }
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode || 0));
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error('Webhook excedeu o tempo limite.') as Error & { code?: string };
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(body);
  });
}

export function alertSummaryFromResult(result: CheckExecutionResult): Record<string, unknown> {
  return {
    status: result.status,
    httpStatus: result.httpStatus,
    responseTimeMs: result.responseTime,
    errorType: result.errorType
  };
}
