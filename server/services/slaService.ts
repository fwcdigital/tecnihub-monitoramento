export type SlaPeriodKey = '24h' | '7d' | '30d' | 'current_month' | 'previous_month';

export interface ResolvedSlaPeriod {
  key: SlaPeriodKey;
  label: string;
  start: Date;
  end: Date;
}

export interface SlaIncidentInterval {
  startedAt: Date;
  resolvedAt: Date | null;
}

export interface CalculatedSlaMetrics {
  availabilityPercent: number | null;
  downtimeSeconds: number;
  allowedDowntimeSeconds: number;
  remainingOrExceededSeconds: number;
  incidentCount: number;
  longestIncidentSeconds: number;
  averageIncidentSeconds: number;
  slaStatus: 'within_sla' | 'below_sla' | 'insufficient_data';
}

export interface MonitoringCoverageAssessment {
  observedStart: Date | null;
  observedEnd: Date | null;
  hasData: boolean;
  hasContinuousCoverage: boolean;
  hasFullCoverage: boolean;
  startCovered: boolean;
  endCovered: boolean;
  gapToleranceSeconds: number;
  abnormalGapCount: number;
  largestGapSeconds: number;
}

const REPORT_TIME_ZONE = 'America/Sao_Paulo';
const DAY_MS = 24 * 60 * 60 * 1000;

function zonedParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value('year'), month: value('month'), day: value('day'),
    hour: value('hour'), minute: value('minute'), second: value('second')
  };
}

function zonedDateTimeToUtc(year: number, month: number, day: number): Date {
  const targetWallClock = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = targetWallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(candidate));
    const representedWallClock = Date.UTC(
      parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second
    );
    const correction = targetWallClock - representedWallClock;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

function startOfZonedMonth(now: Date, monthOffset: number): Date {
  const current = zonedParts(now);
  const absoluteMonth = current.year * 12 + current.month - 1 + monthOffset;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth - year * 12 + 1;
  return zonedDateTimeToUtc(year, month, 1);
}

export function resolveSlaPeriod(period: string | undefined, now = new Date()): ResolvedSlaPeriod {
  const key = (period || '30d') as SlaPeriodKey;
  const fixedPeriods: Partial<Record<SlaPeriodKey, { days: number; label: string }>> = {
    '24h': { days: 1, label: 'Últimas 24 horas' },
    '7d': { days: 7, label: 'Últimos 7 dias' },
    '30d': { days: 30, label: 'Últimos 30 dias' }
  };
  const fixed = fixedPeriods[key];
  if (fixed) {
    return { key, label: fixed.label, start: new Date(now.getTime() - fixed.days * DAY_MS), end: new Date(now) };
  }
  if (key === 'current_month') {
    return { key, label: 'Mês atual', start: startOfZonedMonth(now, 0), end: new Date(now) };
  }
  if (key === 'previous_month') {
    return {
      key,
      label: 'Mês anterior',
      start: startOfZonedMonth(now, -1),
      end: startOfZonedMonth(now, 0)
    };
  }
  throw new Error('Período de SLA inválido.');
}

export function calculateSlaMetrics(
  periodStart: Date,
  periodEnd: Date,
  slaTargetPercent: number,
  incidents: SlaIncidentInterval[],
  hasFullCoverage = true,
  hasData = true
): CalculatedSlaMetrics {
  const periodSeconds = Math.max(0, (periodEnd.getTime() - periodStart.getTime()) / 1000);
  if (!periodSeconds || !hasData) {
    return {
      availabilityPercent: null,
      downtimeSeconds: 0,
      allowedDowntimeSeconds: 0,
      remainingOrExceededSeconds: 0,
      incidentCount: 0,
      longestIncidentSeconds: 0,
      averageIncidentSeconds: 0,
      slaStatus: 'insufficient_data'
    };
  }

  const overlaps = incidents
    .map((incident) => {
      const overlapStart = Math.max(periodStart.getTime(), incident.startedAt.getTime());
      const overlapEnd = Math.min(periodEnd.getTime(), (incident.resolvedAt || periodEnd).getTime());
      return { start: overlapStart, end: overlapEnd, seconds: Math.max(0, (overlapEnd - overlapStart) / 1000) };
    })
    .filter((overlap) => overlap.seconds > 0)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedOverlaps: Array<{ start: number; end: number }> = [];
  for (const overlap of overlaps) {
    const previous = mergedOverlaps[mergedOverlaps.length - 1];
    if (!previous || overlap.start > previous.end) {
      mergedOverlaps.push({ start: overlap.start, end: overlap.end });
    } else {
      previous.end = Math.max(previous.end, overlap.end);
    }
  }
  const individualDowntime = overlaps.reduce((sum, overlap) => sum + overlap.seconds, 0);
  const unionDowntime = mergedOverlaps.reduce((sum, overlap) => sum + (overlap.end - overlap.start) / 1000, 0);
  const downtimeSeconds = Math.min(periodSeconds, unionDowntime);
  const availabilityPercent = 100 * (periodSeconds - downtimeSeconds) / periodSeconds;
  const allowedDowntimeSeconds = periodSeconds * (100 - slaTargetPercent) / 100;

  return {
    availabilityPercent,
    downtimeSeconds,
    allowedDowntimeSeconds,
    remainingOrExceededSeconds: allowedDowntimeSeconds - downtimeSeconds,
    incidentCount: overlaps.length,
    longestIncidentSeconds: overlaps.length ? Math.max(...overlaps.map((overlap) => overlap.seconds)) : 0,
    averageIncidentSeconds: overlaps.length ? individualDowntime / overlaps.length : 0,
    slaStatus: !hasFullCoverage
      ? 'insufficient_data'
      : availabilityPercent >= slaTargetPercent ? 'within_sla' : 'below_sla'
  };
}

export function assessMonitoringCoverage(
  periodStart: Date,
  periodEnd: Date,
  expectedIntervalSeconds: number,
  checkTimes: Date[]
): MonitoringCoverageAssessment {
  const gapToleranceSeconds = Math.max(expectedIntervalSeconds * 2, expectedIntervalSeconds + 300);
  const toleranceMs = gapToleranceSeconds * 1000;
  const sortedChecks = checkTimes
    .map((check) => check.getTime())
    .filter((checkedAt) => Number.isFinite(checkedAt) && checkedAt < periodEnd.getTime())
    .sort((left, right) => left - right);
  const beforeStart = sortedChecks.filter((checkedAt) => checkedAt <= periodStart.getTime()).at(-1);
  const inPeriod = sortedChecks.filter((checkedAt) => checkedAt >= periodStart.getTime());
  const firstInPeriod = inPeriod[0];
  const lastInPeriod = inPeriod.at(-1);
  const startCovered = beforeStart !== undefined && periodStart.getTime() - beforeStart <= toleranceMs;
  const endCovered = lastInPeriod !== undefined && periodEnd.getTime() - lastInPeriod <= toleranceMs;
  const observedStartMs = startCovered ? periodStart.getTime() : firstInPeriod;
  const observedEndMs = endCovered ? periodEnd.getTime() : lastInPeriod;
  const hasData = observedStartMs !== undefined && observedEndMs !== undefined && observedEndMs > observedStartMs;

  let abnormalGapCount = 0;
  let largestGapSeconds = 0;
  if (hasData) {
    const sequenceStart = startCovered ? beforeStart! : observedStartMs!;
    const observedChecks = sortedChecks.filter(
      (checkedAt) => checkedAt >= sequenceStart && checkedAt <= observedEndMs!
    );
    for (let index = 1; index < observedChecks.length; index += 1) {
      const gapSeconds = (observedChecks[index] - observedChecks[index - 1]) / 1000;
      if (gapSeconds > gapToleranceSeconds) {
        abnormalGapCount += 1;
        largestGapSeconds = Math.max(largestGapSeconds, gapSeconds);
      }
    }
  }

  const hasContinuousCoverage = hasData && abnormalGapCount === 0;
  return {
    observedStart: hasData ? new Date(observedStartMs!) : null,
    observedEnd: hasData ? new Date(observedEndMs!) : null,
    hasData,
    hasContinuousCoverage,
    hasFullCoverage: hasContinuousCoverage && startCovered && endCovered,
    startCovered,
    endCovered,
    gapToleranceSeconds,
    abnormalGapCount,
    largestGapSeconds
  };
}
