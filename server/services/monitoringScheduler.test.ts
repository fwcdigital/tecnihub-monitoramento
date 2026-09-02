import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SiteRecordForCheck } from './siteCheckService';
import {
  MAX_MONITOR_CRON_BATCH_SIZE,
  MAX_MONITOR_CRON_CONCURRENCY,
  resolveMonitorCronBatchSize,
  resolveMonitorCronConcurrency,
  runMonitoringCycle
} from './monitoringScheduler';

interface PersistentSite extends SiteRecordForCheck {
  next_check_at: string | null;
  monitoring_claimed_by: string | null;
  monitoring_claimed_until: string | null;
}

class PersistentMonitoringDatabase {
  private runSequence = 0;
  private activeRun: { runId: string; ownerToken: string } | null = null;
  readonly claimBatches: string[][] = [];

  constructor(readonly sites: PersistentSite[]) {}

  async rpc(name: string, args: Record<string, any> = {}) {
    if (name === 'claim_monitoring_run') {
      if (this.activeRun) return { data: [], error: null };
      const runId = `run-${++this.runSequence}`;
      this.activeRun = { runId, ownerToken: `owner-${this.runSequence}` };
      return { data: [{ run_id: runId, owner_token: this.activeRun.ownerToken }], error: null };
    }

    if (name === 'claim_due_monitoring_sites') {
      if (!this.activeRun
        || args.p_run_id !== this.activeRun.runId
        || args.p_owner_token !== this.activeRun.ownerToken) {
        return { data: [], error: null };
      }
      const nowMs = Date.parse(args.p_now);
      const claimed = this.sites
        .filter((site) => site.is_active)
        .filter((site) => site.next_check_at === null || Date.parse(site.next_check_at) <= nowMs)
        .filter((site) => site.monitoring_claimed_until === null
          || Date.parse(site.monitoring_claimed_until) <= nowMs)
        .sort((left, right) => {
          const leftDue = left.next_check_at === null ? Number.NEGATIVE_INFINITY : Date.parse(left.next_check_at);
          const rightDue = right.next_check_at === null ? Number.NEGATIVE_INFINITY : Date.parse(right.next_check_at);
          return leftDue - rightDue || left.id.localeCompare(right.id);
        })
        .slice(0, args.p_limit);
      for (const site of claimed) {
        site.monitoring_claimed_by = this.activeRun.runId;
        site.monitoring_claimed_until = new Date(nowMs + 15 * 60_000).toISOString();
      }
      this.claimBatches.push(claimed.map((site) => site.id));
      return { data: claimed.map((site) => ({ ...site })), error: null };
    }

    if (name === 'renew_monitoring_run') {
      return { data: Boolean(this.activeRun), error: null };
    }

    if (name === 'finish_monitoring_run') {
      if (!this.activeRun
        || args.p_run_id !== this.activeRun.runId
        || args.p_owner_token !== this.activeRun.ownerToken) {
        return { data: false, error: null };
      }
      for (const site of this.sites) {
        if (site.monitoring_claimed_by === this.activeRun.runId) {
          site.monitoring_claimed_by = null;
          site.monitoring_claimed_until = null;
        }
      }
      this.activeRun = null;
      return { data: true, error: null };
    }

    throw new Error(`RPC inesperado: ${name}`);
  }
}

function makeSites(
  count: number,
  nextCheckAt = '2026-09-02T10:00:00.000Z'
): PersistentSite[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `site-${String(index + 1).padStart(3, '0')}`,
    name: `Site ${index + 1}`,
    url: `https://site-${index + 1}.example`,
    is_active: true,
    check_interval: '5min',
    next_check_at: nextCheckAt,
    monitoring_claimed_by: null,
    monitoring_claimed_until: null
  }));
}

function successfulProcessor(
  database: PersistentMonitoringDatabase,
  checkedIds: string[],
  checkedAt: Date,
  beforePersist?: () => Promise<void>
) {
  return async (input: { siteId?: string }) => {
    if (beforePersist) await beforePersist();
    const site = database.sites.find((candidate) => candidate.id === input.siteId);
    assert.ok(site);
    checkedIds.push(site.id);
    site.next_check_at = new Date(checkedAt.getTime() + 5 * 60_000).toISOString();
    site.monitoring_claimed_by = null;
    site.monitoring_claimed_until = null;
    return {} as any;
  };
}

describe('scheduler persistente em lotes', () => {
  const cycleNow = Date.parse('2026-09-02T12:00:00.000Z');

  it('limita configuração de lote e concorrência a valores seguros', () => {
    assert.equal(resolveMonitorCronBatchSize(undefined), 5);
    assert.equal(resolveMonitorCronConcurrency(undefined), 5);
    assert.equal(resolveMonitorCronBatchSize(1_000), MAX_MONITOR_CRON_BATCH_SIZE);
    assert.equal(resolveMonitorCronConcurrency(1_000), MAX_MONITOR_CRON_CONCURRENCY);
  });

  it('100 sites vencidos são drenados em 20 ciclos persistentes de no máximo 5', async () => {
    const database = new PersistentMonitoringDatabase(makeSites(100));
    const checkedIds: string[] = [];
    const processCheck = successfulProcessor(database, checkedIds, new Date(cycleNow));

    const first = await runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, { processCheck: processCheck as any });
    assert.equal(first.claimed, 5);
    assert.deepEqual(checkedIds, ['site-001', 'site-002', 'site-003', 'site-004', 'site-005']);

    const second = await runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, { processCheck: processCheck as any });
    assert.equal(second.claimed, 5);
    assert.deepEqual(checkedIds.slice(5), ['site-006', 'site-007', 'site-008', 'site-009', 'site-010']);

    for (let cycle = 2; cycle < 20; cycle++) {
      const result = await runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, { processCheck: processCheck as any });
      assert.equal(result.claimed, 5);
    }
    assert.equal(checkedIds.length, 100);
    assert.equal(new Set(checkedIds).size, 100);
    assert.equal(database.claimBatches.filter((batch) => batch.length > 0).length, 20);
  });

  it('ignora site ainda não vencido e site desativado', async () => {
    const sites = makeSites(3);
    sites[1].next_check_at = '2026-09-02T12:01:00.000Z';
    sites[2].is_active = false;
    const database = new PersistentMonitoringDatabase(sites);
    const checkedIds: string[] = [];
    const result = await runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, {
      processCheck: successfulProcessor(database, checkedIds, new Date(cycleNow)) as any
    });
    assert.equal(result.claimed, 1);
    assert.deepEqual(checkedIds, ['site-001']);
  });

  it('prioriza o site com next_check_at mais antigo', async () => {
    const sites = makeSites(3, '2026-09-02T11:30:00.000Z');
    sites[2].next_check_at = '2026-09-02T09:00:00.000Z';
    const database = new PersistentMonitoringDatabase(sites);
    const checkedIds: string[] = [];
    const result = await runMonitoringCycle(database as any, 1, cycleNow, 'cron', 1, {
      processCheck: successfulProcessor(database, checkedIds, new Date(cycleNow)) as any
    });
    assert.equal(result.claimed, 1);
    assert.deepEqual(checkedIds, ['site-003']);
  });

  it('dois crons simultâneos não processam o mesmo site', async () => {
    const database = new PersistentMonitoringDatabase(makeSites(5));
    const checkedIds: string[] = [];
    let releaseCheck!: () => void;
    let notifyStarted!: () => void;
    const checkStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const checkGate = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const processCheck = successfulProcessor(database, checkedIds, new Date(cycleNow), async () => {
      notifyStarted();
      await checkGate;
    });

    const firstPromise = runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, { processCheck: processCheck as any });
    await checkStarted;
    const second = await runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, { processCheck: processCheck as any });
    assert.equal(second.acquired, false);
    assert.equal(second.claimed, 0);
    releaseCheck();
    const first = await firstPromise;
    assert.equal(first.checked, 5);
    assert.equal(new Set(checkedIds).size, 5);
  });

  it('claim expirado é recuperado por uma execução futura', async () => {
    const sites = makeSites(1);
    sites[0].monitoring_claimed_by = 'run-interrompido';
    sites[0].monitoring_claimed_until = '2026-09-02T11:59:59.000Z';
    const database = new PersistentMonitoringDatabase(sites);
    const checkedIds: string[] = [];
    const result = await runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, {
      processCheck: successfulProcessor(database, checkedIds, new Date(cycleNow)) as any
    });
    assert.equal(result.checked, 1);
    assert.deepEqual(checkedIds, ['site-001']);
  });

  it('falha/reinício não perde site vencido e o ciclo seguinte tenta novamente', async () => {
    const database = new PersistentMonitoringDatabase(makeSites(1));
    const failed = await runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, {
      processCheck: (async () => { throw new Error('processo interrompido'); }) as any
    });
    assert.equal(failed.failed, 1);
    assert.equal(database.sites[0].next_check_at, '2026-09-02T10:00:00.000Z');
    assert.equal(database.sites[0].monitoring_claimed_until, null);

    const checkedIds: string[] = [];
    const recovered = await runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, {
      processCheck: successfulProcessor(database, checkedIds, new Date(cycleNow)) as any
    });
    assert.equal(recovered.checked, 1);
    assert.deepEqual(checkedIds, ['site-001']);
  });

  it('check persistido mantém next_check_at de acordo com o intervalo', async () => {
    const database = new PersistentMonitoringDatabase(makeSites(1));
    const checkedIds: string[] = [];
    await runMonitoringCycle(database as any, 5, cycleNow, 'cron', 5, {
      processCheck: successfulProcessor(database, checkedIds, new Date(cycleNow)) as any
    });
    assert.equal(database.sites[0].next_check_at, '2026-09-02T12:05:00.000Z');
  });
});
