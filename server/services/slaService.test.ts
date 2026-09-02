import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessMonitoringCoverage, calculateSlaMetrics, resolveSlaPeriod } from './slaService';

const start = new Date('2026-09-01T00:00:00.000Z');
const end = new Date('2026-09-02T00:00:00.000Z');

describe('cálculo de disponibilidade e SLA', () => {
  it('período sem incidentes possui 100% de disponibilidade', () => {
    const result = calculateSlaMetrics(start, end, 99.9, []);
    assert.equal(result.availabilityPercent, 100);
    assert.equal(result.downtimeSeconds, 0);
    assert.equal(result.slaStatus, 'within_sla');
  });

  it('recorta incidente resolvido aos limites do período', () => {
    const result = calculateSlaMetrics(start, end, 99, [{
      startedAt: new Date('2026-09-01T06:00:00.000Z'),
      resolvedAt: new Date('2026-09-01T06:30:00.000Z')
    }]);
    assert.equal(result.downtimeSeconds, 1800);
    assert.equal(result.incidentCount, 1);
  });

  it('considera somente a parte do incidente que atravessa o início do período', () => {
    const result = calculateSlaMetrics(start, end, 99, [{
      startedAt: new Date('2026-08-31T23:00:00.000Z'),
      resolvedAt: new Date('2026-09-01T00:10:00.000Z')
    }]);
    assert.equal(result.downtimeSeconds, 600);
  });

  it('incidente ainda aberto conta até o fim do período', () => {
    const result = calculateSlaMetrics(start, end, 99, [{
      startedAt: new Date('2026-09-01T23:00:00.000Z'), resolvedAt: null
    }]);
    assert.equal(result.downtimeSeconds, 3600);
  });

  it('agrega vários incidentes, maior duração e média', () => {
    const result = calculateSlaMetrics(start, end, 99, [
      { startedAt: new Date('2026-09-01T01:00:00Z'), resolvedAt: new Date('2026-09-01T01:10:00Z') },
      { startedAt: new Date('2026-09-01T02:00:00Z'), resolvedAt: new Date('2026-09-01T02:20:00Z') }
    ]);
    assert.equal(result.downtimeSeconds, 1800);
    assert.equal(result.longestIncidentSeconds, 1200);
    assert.equal(result.averageIncidentSeconds, 900);
  });

  it('soma a união de incidentes sobrepostos sem alterar a contagem individual', () => {
    const result = calculateSlaMetrics(start, end, 99, [
      { startedAt: new Date('2026-09-01T10:00:00Z'), resolvedAt: new Date('2026-09-01T11:00:00Z') },
      { startedAt: new Date('2026-09-01T10:30:00Z'), resolvedAt: new Date('2026-09-01T11:30:00Z') }
    ]);
    assert.equal(result.downtimeSeconds, 5400);
    assert.equal(result.incidentCount, 2);
    assert.equal(result.longestIncidentSeconds, 3600);
    assert.equal(result.averageIncidentSeconds, 3600);
  });

  it('classifica dentro e fora da meta e calcula downtime permitido', () => {
    const within = calculateSlaMetrics(start, end, 99.9, [{
      startedAt: new Date('2026-09-01T01:00:00Z'), resolvedAt: new Date('2026-09-01T01:01:00Z')
    }]);
    assert.equal(Math.round(within.allowedDowntimeSeconds * 10) / 10, 86.4);
    assert.equal(within.slaStatus, 'within_sla');
    assert.ok(within.remainingOrExceededSeconds > 0);

    const below = calculateSlaMetrics(start, end, 99.9, [{
      startedAt: new Date('2026-09-01T01:00:00Z'), resolvedAt: new Date('2026-09-01T01:02:00Z')
    }]);
    assert.equal(below.slaStatus, 'below_sla');
    assert.ok(below.remainingOrExceededSeconds < 0);
  });

  it('marca cobertura parcial como dados insuficientes', () => {
    const result = calculateSlaMetrics(start, end, 99.9, [], false);
    assert.equal(result.availabilityPercent, 100);
    assert.equal(result.slaStatus, 'insufficient_data');
  });

  it('site sem dados não recebe disponibilidade fabricada', () => {
    const result = calculateSlaMetrics(start, end, 99.9, [], false, false);
    assert.equal(result.availabilityPercent, null);
    assert.equal(result.slaStatus, 'insufficient_data');
  });

  it('warnings 401/403/429 não criam downtime sem incidente confirmado', () => {
    const warningHttpStatuses = [401, 403, 429];
    const result = calculateSlaMetrics(start, end, 99.9, []);
    assert.deepEqual(warningHttpStatuses, [401, 403, 429]);
    assert.equal(result.downtimeSeconds, 0);
    assert.equal(result.availabilityPercent, 100);
  });
});

describe('cobertura observada do monitoramento', () => {
  const coverageStart = new Date('2026-09-01T00:00:00.000Z');
  const coverageEnd = new Date('2026-09-01T01:00:00.000Z');
  const check = (minutes: number) => new Date(coverageStart.getTime() + minutes * 60_000);

  it('detecta gap interno acima da tolerância do check_interval', () => {
    const coverage = assessMonitoringCoverage(
      coverageStart, coverageEnd, 300,
      [check(-5), check(0), check(5), check(40), check(45), check(50), check(55)]
    );
    assert.equal(coverage.startCovered, true);
    assert.equal(coverage.endCovered, true);
    assert.equal(coverage.hasContinuousCoverage, false);
    assert.equal(coverage.hasFullCoverage, false);
    assert.equal(coverage.abnormalGapCount, 1);
    assert.equal(coverage.largestGapSeconds, 2100);
  });

  it('encerra a observação no último check quando ele está muito antes do fim', () => {
    const coverage = assessMonitoringCoverage(
      coverageStart, coverageEnd, 300,
      [check(-5), check(0), check(5), check(10), check(15), check(20)]
    );
    assert.equal(coverage.endCovered, false);
    assert.equal(coverage.hasFullCoverage, false);
    assert.equal(coverage.observedEnd?.toISOString(), check(20).toISOString());
  });

  it('mantém cobertura histórica completa independentemente do estado ativo atual', () => {
    const siteIsActiveNow = false;
    const coverage = assessMonitoringCoverage(
      coverageStart, coverageEnd, 300,
      [check(-5), check(0), check(5), check(10), check(15), check(20), check(25), check(30), check(35), check(40), check(45), check(50), check(55)]
    );
    assert.equal(siteIsActiveNow, false);
    assert.equal(coverage.hasFullCoverage, true);
  });

  it('site reativado após lacuna permanece com dados insuficientes', () => {
    const coverage = assessMonitoringCoverage(
      coverageStart, coverageEnd, 300,
      [check(-5), check(0), check(5), check(10), check(45), check(50), check(55)]
    );
    assert.equal(coverage.hasData, true);
    assert.equal(coverage.hasContinuousCoverage, false);
    assert.equal(coverage.hasFullCoverage, false);
  });

  it('site iniciado no meio do período tem cobertura parcial informativa', () => {
    const coverage = assessMonitoringCoverage(
      coverageStart, coverageEnd, 300,
      [check(20), check(25), check(30), check(35), check(40), check(45), check(50), check(55)]
    );
    assert.equal(coverage.startCovered, false);
    assert.equal(coverage.endCovered, true);
    assert.equal(coverage.hasContinuousCoverage, true);
    assert.equal(coverage.hasFullCoverage, false);
    assert.equal(coverage.observedStart?.toISOString(), check(20).toISOString());
    assert.equal(coverage.observedEnd?.toISOString(), coverageEnd.toISOString());
  });
});

describe('períodos de SLA', () => {
  const now = new Date('2026-09-15T15:30:00.000Z');

  it('resolve 24h, 7d e 30d pela duração real', () => {
    assert.equal(resolveSlaPeriod('24h', now).end.getTime() - resolveSlaPeriod('24h', now).start.getTime(), 86400000);
    assert.equal(resolveSlaPeriod('7d', now).end.getTime() - resolveSlaPeriod('7d', now).start.getTime(), 7 * 86400000);
    assert.equal(resolveSlaPeriod('30d', now).end.getTime() - resolveSlaPeriod('30d', now).start.getTime(), 30 * 86400000);
  });

  it('resolve mês atual e anterior no fuso de São Paulo', () => {
    const current = resolveSlaPeriod('current_month', now);
    const previous = resolveSlaPeriod('previous_month', now);
    assert.equal(current.start.toISOString(), '2026-09-01T03:00:00.000Z');
    assert.equal(previous.start.toISOString(), '2026-08-01T03:00:00.000Z');
    assert.equal(previous.end.toISOString(), '2026-09-01T03:00:00.000Z');
  });

  it('rejeita período desconhecido', () => {
    assert.throws(() => resolveSlaPeriod('year'), /Período de SLA inválido/);
  });
});
