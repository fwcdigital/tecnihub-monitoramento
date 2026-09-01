import type { SupabaseClient } from '@supabase/supabase-js';
import { mapWithConcurrency } from './concurrency';
import { processSiteCheck, SiteRecordForCheck } from './siteCheckService';

const INTERVAL_MS: Record<string, number> = {
  '5min': 5 * 60_000,
  '15min': 15 * 60_000,
  '30min': 30 * 60_000,
  '1hour': 60 * 60_000,
  daily: 24 * 60 * 60_000
};

export const MAX_SCHEDULER_CONCURRENCY = 5;
export const DEFAULT_SCHEDULER_CLAIM_LIMIT = 100;
const SCHEDULER_LOCK_KEY = 'tecnihub-primary-monitor';

export function isSupportedCheckInterval(checkInterval: unknown): checkInterval is keyof typeof INTERVAL_MS {
  return typeof checkInterval === 'string' && Object.hasOwn(INTERVAL_MS, checkInterval);
}

export function isSiteDue(checkInterval: string, latestCheckedAt: string | null, nowMs = Date.now()): boolean {
  if (!isSupportedCheckInterval(checkInterval)) return false;
  if (!latestCheckedAt) return true;
  const latestMs = new Date(latestCheckedAt).getTime();
  return Number.isFinite(latestMs) && nowMs - latestMs >= INTERVAL_MS[checkInterval];
}

export interface MonitoringCycleResult {
  acquired: boolean;
  runId?: string;
  claimed: number;
  checked: number;
  skipped: number;
  failed: number;
  concurrency: number;
}

export async function runMonitoringCycle(
  supabase: SupabaseClient,
  concurrency = MAX_SCHEDULER_CONCURRENCY,
  nowMs = Date.now(),
  triggerType: 'cron' | 'manual' | 'batch' = 'cron',
  claimLimit = DEFAULT_SCHEDULER_CLAIM_LIMIT
): Promise<MonitoringCycleResult> {
  const effectiveConcurrency = Math.max(1, Math.min(MAX_SCHEDULER_CONCURRENCY, Math.floor(concurrency) || 1));
  const { data: lockData, error: lockError } = await supabase.rpc('claim_monitoring_run', {
    p_lock_key: SCHEDULER_LOCK_KEY,
    p_trigger_type: triggerType,
    p_lease_seconds: 900
  });
  if (lockError) throw new Error(`Falha ao adquirir trava distribuída do scheduler: ${lockError.message}`);
  const lock = Array.isArray(lockData) ? lockData[0] : lockData;
  if (!lock?.run_id || !lock?.owner_token) {
    return { acquired: false, claimed: 0, checked: 0, skipped: 0, failed: 0, concurrency: effectiveConcurrency };
  }

  const runId = lock.run_id as string;
  const ownerToken = lock.owner_token as string;
  let claimed = 0;
  let checked = 0;
  let failed = 0;
  let fatalError: string | undefined;

  try {
    const { data: dueSites, error: dueError } = await supabase.rpc('claim_due_monitoring_sites', {
      p_run_id: runId,
      p_owner_token: ownerToken,
      p_limit: Math.max(1, Math.min(500, Math.floor(claimLimit) || DEFAULT_SCHEDULER_CLAIM_LIMIT)),
      p_now: new Date(nowMs).toISOString()
    });
    if (dueError) throw new Error(`Falha ao reservar sites vencidos: ${dueError.message}`);
    const sites = (dueSites || []) as SiteRecordForCheck[];
    claimed = sites.length;
    const results = await mapWithConcurrency(sites, effectiveConcurrency, async (site) => {
      try {
        await processSiteCheck({ siteId: site.id, trustedSite: site, runId }, { supabase });
        return true;
      } catch (error) {
        console.error(
          '[Scheduler Site Error]',
          site.id,
          error instanceof Error ? error.message : 'erro inesperado'
        );
        return false;
      } finally {
        const { error: renewError } = await supabase.rpc('renew_monitoring_run', {
          p_run_id: runId,
          p_owner_token: ownerToken,
          p_lease_seconds: 900
        });
        if (renewError) console.error('[Scheduler Lease Error]', renewError.message);
      }
    });
    checked = results.filter(Boolean).length;
    failed = results.length - checked;
  } catch (error) {
    fatalError = error instanceof Error ? error.message : 'Falha inesperada do scheduler.';
  } finally {
    const { data: finished, error: finishError } = await supabase.rpc('finish_monitoring_run', {
      p_run_id: runId,
      p_owner_token: ownerToken,
      p_status: fatalError ? 'failed' : 'completed',
      p_claimed_sites: claimed,
      p_checked_sites: checked,
      p_failed_sites: failed,
      p_skipped_sites: 0,
      p_error_message: fatalError || null
    });
    if (finishError && !fatalError) fatalError = `Falha ao finalizar execução: ${finishError.message}`;
    if (!finishError && finished !== true && !fatalError) {
      fatalError = 'A execução perdeu a posse da trava antes da finalização.';
    }
  }

  if (fatalError) throw new Error(fatalError);
  return {
    acquired: true,
    runId,
    claimed,
    checked,
    skipped: 0,
    failed,
    concurrency: effectiveConcurrency
  };
}
