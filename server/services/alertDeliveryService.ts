import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapWithConcurrency } from './concurrency';
import {
  createEmailProviderFromEnv,
  EmailAlertEventType,
  EmailProvider,
  EmailProviderError,
  renderMonitoringEmail
} from './emailAlertService';
import { postPinnedJson } from './webhookAlertService';

export const DEFAULT_EMAIL_DELIVERY_BATCH_SIZE = 5;
export const MAX_EMAIL_DELIVERY_BATCH_SIZE = 20;
export const DEFAULT_EMAIL_DELIVERY_CONCURRENCY = 2;
export const MAX_EMAIL_DELIVERY_CONCURRENCY = 5;
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function resolveEmailDeliveryBatchSize(value: unknown): number {
  return boundedPositiveInteger(value, DEFAULT_EMAIL_DELIVERY_BATCH_SIZE, MAX_EMAIL_DELIVERY_BATCH_SIZE);
}

export function resolveEmailDeliveryConcurrency(value: unknown): number {
  return boundedPositiveInteger(value, DEFAULT_EMAIL_DELIVERY_CONCURRENCY, MAX_EMAIL_DELIVERY_CONCURRENCY);
}

interface AlertDeliveryRow {
  id: string;
  channel: 'webhook' | 'email';
  webhook_id?: string | null;
  email_config_id?: string | null;
  recipient?: string | null;
  event_type: EmailAlertEventType | 'ssl_expiring' | 'dns_changed';
  event_key: string;
  payload: Record<string, any>;
  attempt_count: number;
}

interface AlertEventRow {
  id: string;
}

type DeliveryOutcome = 'delivered' | 'retried' | 'failed' | 'skipped';

export interface AlertCycleResult {
  runId: string;
  eventsClaimed: number;
  eventsDispatched: number;
  deliveriesCreated: number;
  claimed: number;
  delivered: number;
  retried: number;
  failed: number;
  skipped: number;
  concurrency: number;
  durationMs: number;
}

export interface AlertCycleOptions {
  batchSize?: number;
  concurrency?: number;
  emailProvider?: EmailProvider;
  monitorPublicUrl?: string;
  now?: () => Date;
  runId?: string;
  postWebhook?: typeof postPinnedJson;
}

function retryableWebhookStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Falha inesperada na entrega.').slice(0, 1000);
}

async function persistOutcome(
  supabase: SupabaseClient,
  delivery: AlertDeliveryRow,
  runId: string,
  outcome: DeliveryOutcome,
  now: Date,
  details: { responseStatus?: number; providerMessageId?: string; errorCode?: string; errorMessage?: string } = {}
): Promise<DeliveryOutcome> {
  const retryable = outcome === 'retried' && delivery.attempt_count < MAX_DELIVERY_ATTEMPTS;
  const nextAttemptAt = retryable
    ? new Date(now.getTime() + RETRY_DELAYS_MS[Math.max(0, delivery.attempt_count - 1)]).toISOString()
    : now.toISOString();
  const finalOutcome = outcome === 'retried' && !retryable ? 'failed' : outcome;
  const { data, error } = await supabase
    .from('alert_deliveries')
    .update({
      status: finalOutcome === 'delivered' ? 'delivered' : finalOutcome === 'retried' ? 'pending' : 'failed',
      response_status: details.responseStatus ?? null,
      provider_message_id: details.providerMessageId ?? null,
      last_error_code: details.errorCode ?? null,
      error_message: finalOutcome === 'delivered' ? null : details.errorMessage || 'Falha na entrega.',
      next_attempt_at: nextAttemptAt,
      processing_until: null,
      claimed_by: null,
      delivered_at: finalOutcome === 'delivered' ? now.toISOString() : null
    })
    .eq('id', delivery.id)
    .eq('claimed_by', runId)
    .select('id')
    .maybeSingle();
  return error || !data ? 'skipped' : finalOutcome;
}

async function deliverEmail(
  supabase: SupabaseClient,
  delivery: AlertDeliveryRow,
  runId: string,
  provider: EmailProvider,
  monitorPublicUrl: string,
  now: Date
): Promise<DeliveryOutcome> {
  if (!delivery.recipient || !['incident_confirmed', 'recovery', 'email_test'].includes(delivery.event_type)) {
    return persistOutcome(supabase, delivery, runId, 'failed', now, {
      errorCode: 'INVALID_EMAIL_DELIVERY', errorMessage: 'Entrega de e-mail inválida.'
    });
  }
  try {
    const rendered = renderMonitoringEmail(
      delivery.event_type as EmailAlertEventType,
      delivery.payload,
      monitorPublicUrl
    );
    const result = await provider.send({
      ...rendered,
      to: delivery.recipient,
      idempotencyKey: `tecnihub-email/${delivery.id}`
    });
    return persistOutcome(supabase, delivery, runId, 'delivered', now, {
      responseStatus: result.responseStatus,
      providerMessageId: result.providerMessageId
    });
  } catch (error) {
    const providerError = error instanceof EmailProviderError ? error : null;
    return persistOutcome(supabase, delivery, runId, providerError?.retryable ? 'retried' : 'failed', now, {
      responseStatus: providerError?.responseStatus,
      errorCode: providerError?.code || 'EMAIL_DELIVERY_ERROR',
      errorMessage: safeErrorMessage(error)
    });
  }
}

async function deliverWebhook(
  supabase: SupabaseClient,
  delivery: AlertDeliveryRow,
  runId: string,
  postWebhook: typeof postPinnedJson,
  now: Date
): Promise<DeliveryOutcome> {
  if (!delivery.webhook_id) {
    return persistOutcome(supabase, delivery, runId, 'failed', now, {
      errorCode: 'INVALID_WEBHOOK_DELIVERY', errorMessage: 'Entrega de webhook inválida.'
    });
  }
  const { data: webhook, error } = await supabase
    .from('alert_webhooks')
    .select('url, timeout_ms')
    .eq('id', delivery.webhook_id)
    .maybeSingle();
  if (error || !webhook) {
    return persistOutcome(supabase, delivery, runId, 'failed', now, {
      errorCode: 'WEBHOOK_CONFIG_NOT_FOUND', errorMessage: 'Configuração de webhook não encontrada.'
    });
  }
  try {
    const responseStatus = await postWebhook(webhook.url, delivery.payload, webhook.timeout_ms);
    if (responseStatus >= 200 && responseStatus <= 299) {
      return persistOutcome(supabase, delivery, runId, 'delivered', now, { responseStatus });
    }
    return persistOutcome(
      supabase,
      delivery,
      runId,
      retryableWebhookStatus(responseStatus) ? 'retried' : 'failed',
      now,
      {
        responseStatus,
        errorCode: `WEBHOOK_HTTP_${responseStatus}`,
        errorMessage: `Webhook respondeu HTTP ${responseStatus}.`
      }
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    const permanent = /proteção SSRF|DNS público válido/i.test(message);
    return persistOutcome(supabase, delivery, runId, permanent ? 'failed' : 'retried', now, {
      errorCode: permanent ? 'WEBHOOK_SECURITY_BLOCKED' : 'WEBHOOK_NETWORK_ERROR',
      errorMessage: message
    });
  }
}

export async function processAlertCycle(
  supabase: SupabaseClient,
  options: AlertCycleOptions = {}
): Promise<AlertCycleResult> {
  const startedAt = Date.now();
  const runId = options.runId || randomUUID();
  const batchSize = boundedPositiveInteger(options.batchSize, DEFAULT_EMAIL_DELIVERY_BATCH_SIZE, MAX_EMAIL_DELIVERY_BATCH_SIZE);
  const concurrency = boundedPositiveInteger(options.concurrency, DEFAULT_EMAIL_DELIVERY_CONCURRENCY, MAX_EMAIL_DELIVERY_CONCURRENCY);
  const now = options.now || (() => new Date());
  const provider = options.emailProvider || createEmailProviderFromEnv();
  const monitorPublicUrl = options.monitorPublicUrl || process.env.MONITOR_PUBLIC_URL || 'https://monitoramento.tecnihub.com.br/';
  const postWebhook = options.postWebhook || postPinnedJson;

  const { data: claimedEvents, error: eventClaimError } = await supabase.rpc('claim_monitoring_alert_events', {
    p_claimed_by: runId,
    p_limit: batchSize,
    p_lease_seconds: 60
  });
  if (eventClaimError) throw new Error('Não foi possível reivindicar eventos de alerta.');
  let eventsDispatched = 0;
  let deliveriesCreated = 0;
  for (const event of (claimedEvents || []) as AlertEventRow[]) {
    const { data, error } = await supabase.rpc('fanout_monitoring_alert_event', {
      p_event_id: event.id,
      p_claimed_by: runId
    });
    if (!error) {
      eventsDispatched++;
      deliveriesCreated += Number(data || 0);
    }
  }

  const { data: claimedDeliveries, error: deliveryClaimError } = await supabase.rpc('claim_due_alert_deliveries', {
    p_claimed_by: runId,
    p_limit: batchSize,
    p_lease_seconds: 60
  });
  if (deliveryClaimError) throw new Error('Não foi possível reivindicar entregas de alerta.');
  const deliveries = (claimedDeliveries || []) as AlertDeliveryRow[];
  const emailDeliveries = deliveries.filter((delivery) => delivery.channel === 'email');
  const webhookDeliveries = deliveries.filter((delivery) => delivery.channel === 'webhook');
  const deliveryNow = now();
  const [emailOutcomes, webhookOutcomes] = await Promise.all([
    mapWithConcurrency(emailDeliveries, concurrency, (delivery) =>
      deliverEmail(supabase, delivery, runId, provider, monitorPublicUrl, deliveryNow)),
    mapWithConcurrency(webhookDeliveries, 5, (delivery) =>
      deliverWebhook(supabase, delivery, runId, postWebhook, deliveryNow))
  ]);
  const outcomes = [...emailOutcomes, ...webhookOutcomes];

  return {
    runId,
    eventsClaimed: (claimedEvents || []).length,
    eventsDispatched,
    deliveriesCreated,
    claimed: deliveries.length,
    delivered: outcomes.filter((outcome) => outcome === 'delivered').length,
    retried: outcomes.filter((outcome) => outcome === 'retried').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
    skipped: outcomes.filter((outcome) => outcome === 'skipped').length,
    concurrency,
    durationMs: Date.now() - startedAt
  };
}
