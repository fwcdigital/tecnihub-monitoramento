-- ETAPA 2: estado persistido, scheduler distribuido e diagnosticos reais.
-- Migration aditiva: nenhum check ou incidente historico e removido.

BEGIN;

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS monitor_response_time BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monitor_ssl BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monitor_domain BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_successes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monitoring_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS monitoring_claimed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monitoring_claimed_by UUID;

UPDATE public.sites
SET next_check_at = CASE WHEN is_active THEN COALESCE(last_checked_at, now()) ELSE NULL END
WHERE next_check_at IS NULL AND is_active;

ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_monitoring_state_check;
ALTER TABLE public.sites
  ADD CONSTRAINT sites_monitoring_state_check CHECK (
    monitoring_state IN (
      'pending', 'online', 'warning', 'suspected_failure', 'down',
      'recovering', 'security_blocked', 'paused'
    )
  );
ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_consecutive_failures_check;
ALTER TABLE public.sites
  ADD CONSTRAINT sites_consecutive_failures_check CHECK (consecutive_failures >= 0);
ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_consecutive_successes_check;
ALTER TABLE public.sites
  ADD CONSTRAINT sites_consecutive_successes_check CHECK (consecutive_successes >= 0);

ALTER TABLE public.checks
  DROP CONSTRAINT IF EXISTS checks_status_check;
ALTER TABLE public.checks
  ADD CONSTRAINT checks_status_check CHECK (
    status IN ('online', 'warning', 'critical', 'offline', 'security_blocked')
  );

ALTER TABLE public.checks
  ADD COLUMN IF NOT EXISTS observed_ip INET,
  ADD COLUMN IF NOT EXISTS dns_records JSONB,
  ADD COLUMN IF NOT EXISTS ssl JSONB,
  ADD COLUMN IF NOT EXISTS expected_content_found BOOLEAN,
  ADD COLUMN IF NOT EXISTS wordpress JSONB,
  ADD COLUMN IF NOT EXISTS domain_rdap JSONB,
  ADD COLUMN IF NOT EXISTS redirect_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result_message TEXT,
  ADD COLUMN IF NOT EXISTS diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS incident_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incident_id UUID;

-- Antes desta etapa, todo status critical representava HTTP 5xx e todo offline
-- representava falha de conexão. O backfill preserva essa semântica histórica.
UPDATE public.checks
SET incident_eligible = true
WHERE status IN ('critical', 'offline') AND incident_eligible = false;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS duration_seconds BIGINT,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS failed_checks_count INTEGER NOT NULL DEFAULT 0;

-- O backend já bloqueia a remoção de sites com histórico. As FKs tornam a
-- mesma garantia obrigatória no banco, sem remover ou reescrever registros.
ALTER TABLE public.checks DROP CONSTRAINT IF EXISTS checks_site_id_fkey;
ALTER TABLE public.checks
  ADD CONSTRAINT checks_site_id_fkey
  FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;
ALTER TABLE public.incidents DROP CONSTRAINT IF EXISTS incidents_site_id_fkey;
ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_site_id_fkey
  FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checks_incident_id_fkey' AND conrelid = 'public.checks'::regclass
  ) THEN
    ALTER TABLE public.checks
      ADD CONSTRAINT checks_incident_id_fkey
      FOREIGN KEY (incident_id) REFERENCES public.incidents(id) ON DELETE SET NULL;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.incidents
    WHERE status = 'active'
    GROUP BY site_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existem incidentes ativos duplicados. Resolva-os sem apagar historico antes de criar o indice unico.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_incidents_one_active_per_site
  ON public.incidents(site_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_sites_due_monitoring
  ON public.sites(next_check_at)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_checks_incident_id ON public.checks(incident_id);
CREATE INDEX IF NOT EXISTS idx_checks_site_period_status
  ON public.checks(site_id, checked_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_checks_status_checked_at
  ON public.checks(status, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_checks_site_observed_ip
  ON public.checks(site_id, observed_ip, checked_at DESC)
  WHERE observed_ip IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.monitoring_scheduler_locks (
  lock_key TEXT PRIMARY KEY,
  owner_token UUID NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.monitoring_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_key TEXT NOT NULL,
  owner_token UUID NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron', 'manual', 'batch')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  claimed_sites INTEGER NOT NULL DEFAULT 0,
  checked_sites INTEGER NOT NULL DEFAULT 0,
  failed_sites INTEGER NOT NULL DEFAULT 0,
  skipped_sites INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_monitoring_runs_started_at
  ON public.monitoring_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduler_locks_locked_until
  ON public.monitoring_scheduler_locks(locked_until);

CREATE TABLE IF NOT EXISTS public.domain_rdap_cache (
  domain TEXT PRIMARY KEY,
  registrar TEXT,
  created_at_registry TIMESTAMPTZ,
  expires_at_registry TIMESTAMPTZ,
  days_remaining INTEGER,
  status TEXT NOT NULL DEFAULT 'unavailable' CHECK (status IN ('available', 'unavailable', 'error')),
  error_message TEXT,
  raw_response JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_after TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.monitoring_scheduler_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_rdap_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.monitoring_scheduler_locks FROM anon, authenticated;
REVOKE ALL ON TABLE public.monitoring_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.domain_rdap_cache FROM anon, authenticated;
GRANT ALL ON TABLE public.monitoring_scheduler_locks TO service_role;
GRANT ALL ON TABLE public.monitoring_runs TO service_role;
GRANT ALL ON TABLE public.domain_rdap_cache TO service_role;

CREATE OR REPLACE FUNCTION public.monitor_interval_value(value TEXT)
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE value
    WHEN '5min' THEN interval '5 minutes'
    WHEN '15min' THEN interval '15 minutes'
    WHEN '30min' THEN interval '30 minutes'
    WHEN '1hour' THEN interval '1 hour'
    WHEN 'daily' THEN interval '1 day'
    ELSE interval '5 minutes'
  END;
$$;

CREATE OR REPLACE FUNCTION public.claim_monitoring_run(
  p_lock_key TEXT,
  p_trigger_type TEXT,
  p_lease_seconds INTEGER DEFAULT 900
)
RETURNS TABLE(run_id UUID, owner_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := gen_random_uuid();
  v_run UUID;
  v_locked BOOLEAN;
BEGIN
  -- The advisory transaction lock serializes lease acquisition. The persisted
  -- lease continues protecting the run after this short RPC transaction ends.
  v_locked := pg_try_advisory_xact_lock(hashtextextended(p_lock_key, 0));
  IF NOT v_locked THEN
    RETURN;
  END IF;

  INSERT INTO public.monitoring_scheduler_locks(lock_key, owner_token, locked_until, updated_at)
  VALUES (
    p_lock_key,
    v_owner,
    now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600))),
    now()
  )
  ON CONFLICT (lock_key) DO UPDATE
  SET owner_token = EXCLUDED.owner_token,
      locked_until = EXCLUDED.locked_until,
      updated_at = now()
  WHERE public.monitoring_scheduler_locks.locked_until <= now();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.monitoring_runs(lock_key, owner_token, trigger_type)
  VALUES (p_lock_key, v_owner, p_trigger_type)
  RETURNING id INTO v_run;

  RETURN QUERY SELECT v_run, v_owner;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_monitoring_sites(
  p_run_id UUID,
  p_owner_token UUID,
  p_limit INTEGER DEFAULT 100,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS SETOF public.sites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.monitoring_runs r
    JOIN public.monitoring_scheduler_locks l
      ON l.lock_key = r.lock_key AND l.owner_token = r.owner_token
    WHERE r.id = p_run_id
      AND r.owner_token = p_owner_token
      AND r.status = 'running'
      AND l.locked_until > now()
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT s.id
    FROM public.sites s
    WHERE s.is_active = true
      AND COALESCE(s.next_check_at, '-infinity'::timestamptz) <= p_now
      AND (s.monitoring_claimed_until IS NULL OR s.monitoring_claimed_until <= p_now)
    ORDER BY s.next_check_at NULLS FIRST, s.id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(p_limit, 500))
  ), claimed AS (
    UPDATE public.sites s
    SET monitoring_claimed_by = p_run_id,
        monitoring_claimed_until = p_now + interval '15 minutes'
    FROM due
    WHERE s.id = due.id
    RETURNING s.*
  )
  SELECT * FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_monitoring_run(
  p_run_id UUID,
  p_owner_token UUID,
  p_lease_seconds INTEGER DEFAULT 900
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_renewed BOOLEAN := false;
  v_until TIMESTAMPTZ := now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600)));
BEGIN
  UPDATE public.monitoring_scheduler_locks l
  SET locked_until = v_until,
      updated_at = now()
  FROM public.monitoring_runs r
  WHERE r.id = p_run_id
    AND r.owner_token = p_owner_token
    AND r.status = 'running'
    AND l.lock_key = r.lock_key
    AND l.owner_token = p_owner_token
    AND l.locked_until > now();
  v_renewed := FOUND;

  IF v_renewed THEN
    UPDATE public.sites
    SET monitoring_claimed_until = v_until
    WHERE monitoring_claimed_by = p_run_id;
  END IF;
  RETURN v_renewed;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_monitoring_result(
  p_site_id UUID,
  p_checked_at TIMESTAMPTZ,
  p_status TEXT,
  p_http_status INTEGER,
  p_response_time NUMERIC,
  p_final_url TEXT,
  p_error_type TEXT,
  p_error_message TEXT,
  p_observed_ip TEXT,
  p_dns_records JSONB,
  p_ssl JSONB,
  p_expected_content_found BOOLEAN,
  p_wordpress JSONB,
  p_domain_rdap JSONB,
  p_redirect_count INTEGER,
  p_result_message TEXT,
  p_diagnostics JSONB,
  p_incident_eligible BOOLEAN,
  p_run_id UUID DEFAULT NULL
)
RETURNS TABLE(check_id UUID, incident_transition TEXT, related_incident_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site public.sites%ROWTYPE;
  v_check_id UUID;
  v_active_incident UUID;
  v_transition TEXT := 'unchanged';
  v_failures INTEGER;
  v_successes INTEGER;
  v_recent_failures BOOLEAN;
  v_recent_successes BOOLEAN;
  v_incident_id UUID;
  v_started_at TIMESTAMPTZ;
  v_reason TEXT;
BEGIN
  SELECT * INTO v_site FROM public.sites WHERE id = p_site_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site nao encontrado: %', p_site_id;
  END IF;

  SELECT id INTO v_active_incident
  FROM public.incidents
  WHERE site_id = p_site_id AND status = 'active'
  ORDER BY started_at
  LIMIT 1
  FOR UPDATE;

  INSERT INTO public.checks(
    site_id, checked_at, status, http_status, response_time, final_url,
    error_type, error_message, observed_ip, dns_records, ssl,
    expected_content_found, wordpress, domain_rdap, redirect_count,
    result_message, diagnostics, incident_eligible, incident_id
  ) VALUES (
    p_site_id, p_checked_at, p_status, p_http_status, p_response_time, p_final_url,
    p_error_type, p_error_message, NULLIF(p_observed_ip, '')::inet,
    p_dns_records, p_ssl, p_expected_content_found, p_wordpress, p_domain_rdap,
    COALESCE(p_redirect_count, 0), p_result_message, COALESCE(p_diagnostics, '{}'::jsonb),
    COALESCE(p_incident_eligible, false), v_active_incident
  ) RETURNING id INTO v_check_id;

  IF v_active_incident IS NOT NULL AND p_incident_eligible AND p_status IN ('critical', 'offline') THEN
    UPDATE public.incidents
    SET failed_checks_count = failed_checks_count + 1
    WHERE id = v_active_incident AND status = 'active';
  END IF;

  IF p_incident_eligible AND p_status IN ('critical', 'offline') THEN
    v_failures := v_site.consecutive_failures + 1;
    v_successes := 0;
  ELSIF p_status = 'online' THEN
    v_failures := 0;
    v_successes := v_site.consecutive_successes + 1;
  ELSE
    v_failures := 0;
    v_successes := 0;
  END IF;

  SELECT count(*) = 3 AND bool_and(incident_eligible AND status IN ('critical', 'offline')),
         min(checked_at)
  INTO v_recent_failures, v_started_at
  FROM (
    SELECT status, incident_eligible, checked_at
    FROM public.checks
    WHERE site_id = p_site_id
    ORDER BY checked_at DESC, id DESC
    LIMIT 3
  ) recent;

  SELECT count(*) = 2 AND bool_and(status = 'online')
  INTO v_recent_successes
  FROM (
    SELECT status
    FROM public.checks
    WHERE site_id = p_site_id
    ORDER BY checked_at DESC, id DESC
    LIMIT 2
  ) recent;

  IF v_active_incident IS NULL AND v_recent_failures THEN
    v_reason := COALESCE(p_error_type, CASE WHEN p_http_status IS NOT NULL THEN 'HTTP_' || p_http_status ELSE 'AVAILABILITY_FAILURE' END);
    INSERT INTO public.incidents(
      site_id, type, severity, title, description, reason, started_at, status, failed_checks_count
    ) VALUES (
      p_site_id,
      CASE WHEN p_http_status IS NOT NULL THEN 'HTTP ' || p_http_status ELSE COALESCE(p_error_type, 'Site fora do ar') END,
      'critical',
      'Indisponibilidade confirmada: ' || COALESCE(p_result_message, v_reason),
      'Tres verificacoes consecutivas confirmaram uma falha de disponibilidade.',
      v_reason,
      COALESCE(v_started_at, p_checked_at),
      'active',
      3
    )
    ON CONFLICT (site_id) WHERE status = 'active' DO NOTHING
    RETURNING id INTO v_incident_id;

    IF v_incident_id IS NOT NULL THEN
      UPDATE public.checks
      SET incident_id = v_incident_id
      WHERE id IN (
        SELECT id FROM public.checks
        WHERE site_id = p_site_id
        ORDER BY checked_at DESC, id DESC
        LIMIT 3
      );
      v_active_incident := v_incident_id;
      v_transition := 'opened';
    END IF;
  ELSIF v_active_incident IS NOT NULL AND v_recent_successes THEN
    UPDATE public.incidents
    SET status = 'resolved',
        resolved_at = p_checked_at,
        duration_seconds = greatest(0, floor(extract(epoch FROM (p_checked_at - started_at)))::bigint)
    WHERE id = v_active_incident AND status = 'active';
    IF FOUND THEN
      v_transition := 'resolved';
    END IF;
  END IF;

  UPDATE public.sites
  SET last_checked_at = p_checked_at,
      next_check_at = CASE WHEN is_active THEN p_checked_at + public.monitor_interval_value(check_interval) ELSE NULL END,
      consecutive_failures = v_failures,
      consecutive_successes = v_successes,
      monitoring_state = CASE
        WHEN NOT is_active THEN 'paused'
        WHEN p_status = 'security_blocked' THEN 'security_blocked'
        WHEN p_incident_eligible AND p_status IN ('critical', 'offline') AND v_failures >= 3 THEN 'down'
        WHEN p_incident_eligible AND p_status IN ('critical', 'offline') THEN 'suspected_failure'
        WHEN p_status = 'online' AND v_active_incident IS NOT NULL AND NOT v_recent_successes THEN 'recovering'
        WHEN p_status = 'online' THEN 'online'
        ELSE 'warning'
      END,
      monitoring_claimed_by = CASE WHEN p_run_id IS NULL OR monitoring_claimed_by = p_run_id THEN NULL ELSE monitoring_claimed_by END,
      monitoring_claimed_until = CASE WHEN p_run_id IS NULL OR monitoring_claimed_by = p_run_id THEN NULL ELSE monitoring_claimed_until END
  WHERE id = p_site_id;

  RETURN QUERY SELECT v_check_id, v_transition, v_active_incident;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_monitoring_run(
  p_run_id UUID,
  p_owner_token UUID,
  p_status TEXT,
  p_claimed_sites INTEGER,
  p_checked_sites INTEGER,
  p_failed_sites INTEGER,
  p_skipped_sites INTEGER,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key TEXT;
BEGIN
  UPDATE public.monitoring_runs
  SET status = p_status,
      finished_at = now(),
      claimed_sites = greatest(0, p_claimed_sites),
      checked_sites = greatest(0, p_checked_sites),
      failed_sites = greatest(0, p_failed_sites),
      skipped_sites = greatest(0, p_skipped_sites),
      error_message = left(p_error_message, 1000)
  WHERE id = p_run_id AND owner_token = p_owner_token AND status = 'running'
  RETURNING lock_key INTO v_lock_key;

  IF v_lock_key IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.sites
  SET monitoring_claimed_by = NULL, monitoring_claimed_until = NULL
  WHERE monitoring_claimed_by = p_run_id;

  DELETE FROM public.monitoring_scheduler_locks
  WHERE lock_key = v_lock_key AND owner_token = p_owner_token;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_site_metrics(p_site_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(period_key, metric), '{}'::jsonb)
  FROM (
    SELECT period_key,
      jsonb_build_object(
        'totalChecks', count(c.id) FILTER (WHERE c.status <> 'security_blocked'),
        'availableChecks', count(c.id) FILTER (WHERE c.incident_eligible = false AND c.http_status IS NOT NULL),
        'uptimePercent', CASE
          WHEN count(c.id) FILTER (WHERE c.status <> 'security_blocked') = 0 THEN NULL
          ELSE round(
            100.0 * count(c.id) FILTER (WHERE c.incident_eligible = false AND c.http_status IS NOT NULL)
            / count(c.id) FILTER (WHERE c.status <> 'security_blocked'), 4
          )
        END,
        'avgResponseMs', round(avg(c.response_time) FILTER (WHERE c.response_time IS NOT NULL), 2),
        'responseSamples', count(c.id) FILTER (WHERE c.response_time IS NOT NULL),
        'minResponseMs', min(c.response_time),
        'maxResponseMs', max(c.response_time),
        'firstCheckAt', min(c.checked_at),
        'windowStart', now() - window_interval,
        'hasFullWindow', EXISTS (
          SELECT 1 FROM public.checks history
          WHERE history.site_id = p_site_id AND history.checked_at <= now() - window_interval
        )
      ) AS metric
    FROM (VALUES
      ('24h', interval '24 hours'),
      ('7d', interval '7 days'),
      ('30d', interval '30 days'),
      ('90d', interval '90 days')
    ) periods(period_key, window_interval)
    LEFT JOIN public.checks c
      ON c.site_id = p_site_id AND c.checked_at >= now() - window_interval
    GROUP BY period_key, window_interval
  ) metrics;
$$;

CREATE OR REPLACE FUNCTION public.get_sites_overview()
RETURNS TABLE(site JSONB, latest_check JSONB, active_incident JSONB, domain_cache JSONB, metrics JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    to_jsonb(s),
    CASE WHEN latest.id IS NULL THEN NULL ELSE to_jsonb(latest) END,
    CASE WHEN active.id IS NULL THEN NULL ELSE to_jsonb(active) END,
    CASE WHEN rdap.domain IS NULL THEN NULL ELSE to_jsonb(rdap) END,
    public.calculate_site_metrics(s.id)
  FROM public.sites s
  LEFT JOIN LATERAL (
    SELECT c.* FROM public.checks c
    WHERE c.site_id = s.id
    ORDER BY c.checked_at DESC, c.id DESC
    LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    SELECT i.* FROM public.incidents i
    WHERE i.site_id = s.id AND i.status = 'active'
    ORDER BY i.started_at
    LIMIT 1
  ) active ON true
  LEFT JOIN public.domain_rdap_cache rdap ON rdap.domain = lower(s.domain)
  ORDER BY s.created_at DESC
  LIMIT 1000;
$$;

CREATE OR REPLACE FUNCTION public.get_site_monitoring_series(
  p_site_id UUID,
  p_period TEXT DEFAULT '24h'
)
RETURNS TABLE(
  bucket TIMESTAMPTZ,
  total_checks BIGINT,
  available_checks BIGINT,
  avg_response_ms NUMERIC,
  min_response_ms NUMERIC,
  max_response_ms NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH parameters AS (
    SELECT
      CASE p_period
        WHEN '7d' THEN interval '7 days'
        WHEN '30d' THEN interval '30 days'
        WHEN '90d' THEN interval '90 days'
        ELSE interval '24 hours'
      END AS range_interval,
      CASE WHEN p_period IN ('30d', '90d') THEN 'day' ELSE 'hour' END AS bucket_unit
  )
  SELECT
    date_trunc(parameters.bucket_unit, c.checked_at) AS bucket,
    count(*) FILTER (WHERE c.status <> 'security_blocked') AS total_checks,
    count(*) FILTER (WHERE c.incident_eligible = false AND c.http_status IS NOT NULL) AS available_checks,
    round(avg(c.response_time) FILTER (WHERE c.response_time IS NOT NULL), 2) AS avg_response_ms,
    min(c.response_time) AS min_response_ms,
    max(c.response_time) AS max_response_ms
  FROM public.checks c
  CROSS JOIN parameters
  WHERE c.site_id = p_site_id
    AND c.checked_at >= now() - parameters.range_interval
  GROUP BY parameters.bucket_unit, date_trunc(parameters.bucket_unit, c.checked_at)
  ORDER BY bucket;
$$;

REVOKE ALL ON FUNCTION public.claim_monitoring_run(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_monitoring_sites(UUID, UUID, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_monitoring_run(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_monitoring_result(UUID, TIMESTAMPTZ, TEXT, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, JSONB, JSONB, INTEGER, TEXT, JSONB, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_monitoring_run(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_sites_overview() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_site_monitoring_series(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calculate_site_metrics(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_monitoring_run(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_monitoring_sites(UUID, UUID, INTEGER, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_monitoring_run(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_monitoring_result(UUID, TIMESTAMPTZ, TEXT, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, JSONB, JSONB, INTEGER, TEXT, JSONB, BOOLEAN, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_monitoring_run(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_sites_overview() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_site_monitoring_series(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_site_metrics(UUID) TO service_role;

COMMIT;
