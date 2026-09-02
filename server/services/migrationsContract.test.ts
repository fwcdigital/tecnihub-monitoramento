import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const migrationsDirectory = path.resolve(process.cwd(), 'supabase', 'migrations');
const readMigration = (name: string) => readFileSync(path.join(migrationsDirectory, name), 'utf8');
const monitoringSql = readMigration('20260901_003_monitoring_engine.sql');
const webhookSql = readMigration('20260901_004_alert_webhooks.sql');
const vaultSql = readMigration('20260901_005_technical_credentials_vault.sql');
const alertsSql = readMigration('20260902_006_transactional_alert_outbox_email.sql');
const deleteSiteSql = readMigration('20260902_007_delete_site_permanently.sql');

describe('contratos das migrations finais', () => {
  it('mantém migrations numeradas e ordenáveis sem reaplicar schema.sql', () => {
    const files = readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort();
    assert.deepEqual(files, [
      '20260831_001_checks_critical_status.sql',
      '20260831_002_restrict_direct_api_access.sql',
      '20260901_003_monitoring_engine.sql',
      '20260901_004_alert_webhooks.sql',
      '20260901_005_technical_credentials_vault.sql',
      '20260902_006_transactional_alert_outbox_email.sql',
      '20260902_007_delete_site_permanently.sql'
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
      .filter((file) => file.endsWith('.sql') && file !== '20260902_007_delete_site_permanently.sql')
      .map(readMigration)
      .join('\n');
    assert.doesNotMatch(allSql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(allSql, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(allSql, /\bDELETE\s+FROM\s+public\.(sites|checks|incidents|technical_credentials|credential_audit_log)\b/i);
  });

  it('cria outbox transacional e configuração de e-mail sem alterar migrations aplicadas', () => {
    assert.match(alertsSql, /CREATE TABLE public\.monitoring_alert_events/i);
    assert.match(alertsSql, /event_key TEXT NOT NULL UNIQUE/i);
    assert.match(alertsSql, /CREATE TABLE public\.alert_email_configs/i);
    assert.match(alertsSql, /ALTER TABLE public\.alert_deliveries/i);
    assert.match(alertsSql, /ADD COLUMN channel TEXT NOT NULL DEFAULT 'webhook'/i);
    assert.match(alertsSql, /ALTER COLUMN webhook_id DROP NOT NULL/i);
    assert.doesNotMatch(alertsSql, /DROP TABLE/i);
    assert.doesNotMatch(alertsSql, /TRUNCATE/i);
  });

  it('persiste abertura e recuperação na outbox dentro de record_monitoring_result', () => {
    assert.match(alertsSql, /CREATE OR REPLACE FUNCTION public\.record_monitoring_result/i);
    assert.match(alertsSql, /IF v_transition IN \('opened', 'resolved'\)/i);
    assert.match(alertsSql, /INSERT INTO public\.monitoring_alert_events/i);
    assert.match(alertsSql, /'incident:' \|\| v_active_incident[\s\S]+':confirmed'[\s\S]+':recovery'/i);
    assert.match(alertsSql, /'incidentDurationSeconds', v_duration_seconds/i);
    assert.match(alertsSql, /'clientName', v_site\.client_name/i);
  });

  it('claims de eventos e entregas são atômicos, recuperáveis e idempotentes', () => {
    assert.match(alertsSql, /CREATE OR REPLACE FUNCTION public\.claim_monitoring_alert_events/i);
    assert.match(alertsSql, /CREATE OR REPLACE FUNCTION public\.claim_due_alert_deliveries/i);
    assert.match(alertsSql, /FOR UPDATE SKIP LOCKED/gi);
    assert.match(
      alertsSql,
      /delivery\.processing_until,[\s\S]+delivery\.attempted_at \+ interval '60 seconds'[\s\S]+\) <= now\(\)/i,
    );
    assert.match(alertsSql, /attempt_count = delivery\.attempt_count \+ 1/i);
    assert.match(webhookSql, /UNIQUE \(webhook_id, event_key\)/i);
    assert.doesNotMatch(alertsSql, /DROP CONSTRAINT IF EXISTS alert_deliveries_webhook_id_event_key_key/i);
    assert.doesNotMatch(alertsSql, /CREATE UNIQUE INDEX uq_alert_deliveries_webhook_event/i);
    assert.match(alertsSql, /uq_alert_deliveries_email_event_recipient/i);
    assert.match(alertsSql, /ON CONFLICT DO NOTHING/gi);
    assert.match(alertsSql, /attempted_at \+ interval '60 seconds'/i);
    assert.match(alertsSql, /SET search_path = pg_catalog, pg_temp/gi);
  });

  it('exclusão definitiva é uma RPC transacional restrita ao service role', () => {
    assert.match(deleteSiteSql, /\bBEGIN;/i);
    assert.match(deleteSiteSql, /CREATE OR REPLACE FUNCTION public\.delete_site_permanently\([\s\S]+p_confirmation TEXT/i);
    assert.match(deleteSiteSql, /FROM public\.sites site[\s\S]+WHERE site\.id = p_site_id[\s\S]+FOR UPDATE/i);
    assert.match(deleteSiteSql, /Confirmacao de exclusao invalida/i);
    assert.match(deleteSiteSql, /SECURITY DEFINER[\s\S]+SET search_path = pg_catalog, pg_temp/gi);
    assert.match(deleteSiteSql, /REVOKE ALL ON FUNCTION public\.delete_site_permanently\(UUID, TEXT\) FROM PUBLIC, anon, authenticated/i);
    assert.match(deleteSiteSql, /GRANT EXECUTE ON FUNCTION public\.delete_site_permanently\(UUID, TEXT\) TO service_role/i);
    assert.doesNotMatch(deleteSiteSql, /EXCEPTION\s+WHEN/i);
    assert.match(deleteSiteSql, /COMMIT;\s*$/i);
  });

  it('remove dependências na ordem correta e deixa o site por último', () => {
    const orderedDeletes = [
      'DELETE FROM public.credential_audit_log',
      'DELETE FROM public.technical_credentials',
      'DELETE FROM public.alert_deliveries',
      'DELETE FROM public.monitoring_alert_events',
      'DELETE FROM public.checks',
      'DELETE FROM public.incidents',
      'DELETE FROM public.sites'
    ];
    let previousIndex = -1;
    for (const statement of orderedDeletes) {
      const statementIndex = deleteSiteSql.indexOf(statement);
      assert.ok(statementIndex > previousIndex, `${statement} deve aparecer após a dependência anterior`);
      previousIndex = statementIndex;
    }
    assert.match(deleteSiteSql, /delivery\.site_id = p_site_id[\s\S]+delivery\.check_id IN[\s\S]+delivery\.incident_id IN/i);
    assert.match(deleteSiteSql, /event\.site_id = p_site_id[\s\S]+event\.check_id IN[\s\S]+event\.incident_id IN/i);
    assert.match(deleteSiteSql, /audit\.site_id = p_site_id[\s\S]+audit\.credential_id IN/i);
  });

  it('expõe impacto completo para confirmação sem excluir recursos globais', () => {
    assert.match(deleteSiteSql, /CREATE OR REPLACE FUNCTION public\.get_site_deletion_impact/i);
    for (const table of [
      'checks', 'incidents', 'monitoring_alert_events', 'alert_deliveries',
      'technical_credentials', 'credential_audit_log'
    ]) assert.match(deleteSiteSql, new RegExp(`public\\.${table}`, 'i'));
    assert.doesNotMatch(deleteSiteSql, /DELETE FROM public\.(alert_webhooks|alert_email_configs|domain_rdap_cache|monitoring_runs|monitoring_scheduler_locks)/i);
  });
});
