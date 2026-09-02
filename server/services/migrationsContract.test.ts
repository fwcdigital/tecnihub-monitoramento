import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const migrationsDirectory = path.resolve(process.cwd(), 'supabase', 'migrations');
const readMigration = (name: string) => readFileSync(path.join(migrationsDirectory, name), 'utf8');
const monitoringSql = readMigration('20260901_003_monitoring_engine.sql');
const vaultSql = readMigration('20260901_005_technical_credentials_vault.sql');

describe('contratos das migrations finais', () => {
  it('mantém migrations numeradas e ordenáveis sem reaplicar schema.sql', () => {
    const files = readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort();
    assert.deepEqual(files, [
      '20260831_001_checks_critical_status.sql',
      '20260831_002_restrict_direct_api_access.sql',
      '20260901_003_monitoring_engine.sql',
      '20260901_004_alert_webhooks.sql',
      '20260901_005_technical_credentials_vault.sql'
    ]);
    assert.equal(files.includes('schema.sql'), false);
  });

  it('prepara índices para checks, status, scheduler, credenciais e auditoria', () => {
    for (const expected of [
      'idx_sites_due_monitoring', 'idx_checks_site_period_status', 'idx_checks_status_checked_at',
      'uq_incidents_one_active_per_site', 'idx_monitoring_runs_started_at', 'idx_scheduler_locks_locked_until'
    ]) assert.match(monitoringSql, new RegExp(expected));
    for (const expected of [
      'idx_technical_credentials_site_id', 'idx_credential_audit_site_created_at',
      'idx_credential_audit_admin_created_at', 'idx_credential_audit_created_at'
    ]) assert.match(vaultSql, new RegExp(expected));
  });

  it('scheduler reserva somente sites ativos e vencidos, atualizando last/next_check_at', () => {
    assert.match(monitoringSql, /s\.is_active\s*=\s*true/i);
    assert.match(monitoringSql, /COALESCE\(s\.next_check_at[^\n]+<=\s*p_now/i);
    assert.match(monitoringSql, /FOR UPDATE SKIP LOCKED/i);
    assert.match(monitoringSql, /LIMIT greatest\(1, least\(p_limit, 500\)\)/i);
    assert.match(monitoringSql, /last_checked_at\s*=\s*p_checked_at/i);
    assert.match(monitoringSql, /next_check_at\s*=\s*CASE[\s\S]+p_checked_at\s*\+\s*public\.monitor_interval_value/i);
  });

  it('claim é atômico, prioriza atraso e permite recuperação após o lease expirar', () => {
    assert.match(monitoringSql, /ORDER BY s\.next_check_at NULLS FIRST, s\.id/i);
    assert.match(monitoringSql, /monitoring_claimed_until IS NULL OR s\.monitoring_claimed_until <= p_now/i);
    assert.match(monitoringSql, /SET monitoring_claimed_by = p_run_id,[\s\S]+monitoring_claimed_until = p_now \+ interval '15 minutes'/i);
    assert.match(monitoringSql, /FOR UPDATE SKIP LOCKED/i);
    assert.match(monitoringSql, /SET monitoring_claimed_by = NULL, monitoring_claimed_until = NULL[\s\S]+WHERE monitoring_claimed_by = p_run_id/i);
  });

  it('métricas cobrem uptime e response time em 24h, 7d, 30d e período sem dados', () => {
    for (const period of ["'24h'", "'7d'", "'30d'", "'90d'"]) assert.match(monitoringSql, new RegExp(period));
    assert.match(monitoringSql, /'uptimePercent'/);
    assert.match(monitoringSql, /'avgResponseMs'/);
    assert.match(monitoringSql, /'responseSamples'/);
    assert.match(monitoringSql, /WHEN count\(c\.id\)[\s\S]+?= 0 THEN NULL/);
    assert.match(monitoringSql, /count\(c\.id\) FILTER \(WHERE c\.status <> 'security_blocked'\)/);
  });

  it('não contém remoção destrutiva de dados operacionais ou do cofre', () => {
    const allSql = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .map(readMigration)
      .join('\n');
    assert.doesNotMatch(allSql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(allSql, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(allSql, /\bDELETE\s+FROM\s+public\.(sites|checks|incidents|technical_credentials|credential_audit_log)\b/i);
  });
});
