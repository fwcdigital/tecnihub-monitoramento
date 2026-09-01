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

export function isSupportedCheckInterval(checkInterval: unknown): checkInterval is keyof typeof INTERVAL_MS {
  return typeof checkInterval === 'string' && Object.hasOwn(INTERVAL_MS, checkInterval);
}

interface ScheduledSite extends SiteRecordForCheck {
  check_interval: string;
}

export function isSiteDue(
  checkInterval: string,
  latestCheckedAt: string | null,
  nowMs = Date.now()
): boolean {
  if (!isSupportedCheckInterval(checkInterval)) return false;
  const intervalMs = INTERVAL_MS[checkInterval];
  if (!latestCheckedAt) return true;
  const latestMs = new Date(latestCheckedAt).getTime();
  return Number.isFinite(latestMs) && nowMs - latestMs >= intervalMs;
}

export async function runMonitoringCycle(
  supabase: SupabaseClient,
  concurrency = 5,
  nowMs = Date.now()
): Promise<{ checked: number; skipped: number; failed: number }> {
  const { data, error } = await supabase
    .from('sites')
    .select('id, url, name, is_active, check_interval')
    .eq('is_active', true);
  if (error) throw new Error(`Falha ao carregar sites do agendador: ${error.message}`);

  const results = await mapWithConcurrency((data || []) as ScheduledSite[], concurrency, async (site) => {
    const latestResult = await supabase
      .from('checks')
      .select('checked_at')
      .eq('site_id', site.id)
      .order('checked_at', { ascending: false })
      .limit(1);
    if (latestResult.error) return 'failed' as const;
    if (!isSiteDue(site.check_interval, latestResult.data?.[0]?.checked_at || null, nowMs)) {
      return 'skipped' as const;
    }

    try {
      await processSiteCheck({ siteId: site.id, trustedSite: site }, { supabase });
      return 'checked' as const;
    } catch {
      return 'failed' as const;
    }
  });

  return {
    checked: results.filter((result) => result === 'checked').length,
    skipped: results.filter((result) => result === 'skipped').length,
    failed: results.filter((result) => result === 'failed').length
  };
}

export function startMonitoringScheduler(
  getSupabase: () => SupabaseClient | null,
  options: { enabled: boolean; concurrency?: number; pollIntervalMs?: number } = { enabled: false }
): () => void {
  if (!options.enabled) return () => undefined;

  let running = false;
  const run = async () => {
    if (running) return;
    const supabase = getSupabase();
    if (!supabase) return;
    running = true;
    try {
      const result = await runMonitoringCycle(supabase, options.concurrency || 5);
      console.log(`[Scheduler] ${result.checked} check(s), ${result.skipped} fora do prazo, ${result.failed} falha(s).`);
    } catch (error) {
      console.error('[Scheduler] Ciclo não executado:', error instanceof Error ? error.message : 'erro inesperado');
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), options.pollIntervalMs || 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
