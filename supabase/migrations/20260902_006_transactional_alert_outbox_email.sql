-- Durable transactional alert outbox, multi-channel deliveries and email config.
-- Existing webhook configurations and delivery history are preserved.

BEGIN;

CREATE TABLE public.monitoring_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  check_id UUID REFERENCES public.checks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('incident_confirmed', 'recovery', 'ssl_expiring', 'dns_changed')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_by UUID,
  claimed_until TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ
);

CREATE TABLE public.alert_email_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT false,
  recipients TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  event_types TEXT[] NOT NULL DEFAULT ARRAY['incident_confirmed', 'recovery']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (event_types <@ ARRAY['incident_confirmed', 'recovery']::TEXT[]),
  CHECK (cardinality(event_types) > 0),
  CHECK (cardinality(recipients) <= 50),
  CHECK (NOT enabled OR cardinality(recipients) > 0)
);

ALTER TABLE public.alert_deliveries
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'webhook',
  ADD COLUMN email_config_id UUID REFERENCES public.alert_email_configs(id) ON DELETE RESTRICT,
  ADD COLUMN recipient TEXT,
  ADD COLUMN provider_message_id TEXT,
  ADD COLUMN last_error_code TEXT,
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN processing_until TIMESTAMPTZ,
  ADD COLUMN claimed_by UUID;

ALTER TABLE public.alert_deliveries
  DROP CONSTRAINT IF EXISTS alert_deliveries_status_check,
  DROP CONSTRAINT IF EXISTS alert_deliveries_event_type_check,
  ALTER COLUMN webhook_id DROP NOT NULL,
  ALTER COLUMN site_id DROP NOT NULL;

ALTER TABLE public.alert_deliveries
  ADD CONSTRAINT alert_deliveries_channel_check
    CHECK (channel IN ('webhook', 'email')),
  ADD CONSTRAINT alert_deliveries_event_type_check
    CHECK (event_type IN ('incident_confirmed', 'recovery', 'ssl_expiring', 'dns_changed', 'email_test')),
  ADD CONSTRAINT alert_deliveries_status_check
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  ADD CONSTRAINT alert_deliveries_attempt_count_check
    CHECK (attempt_count >= 0),
  ADD CONSTRAINT alert_deliveries_channel_target_check
    CHECK (
      (channel = 'webhook' AND webhook_id IS NOT NULL AND email_config_id IS NULL AND recipient IS NULL)
      OR
      (channel = 'email' AND webhook_id IS NULL AND email_config_id IS NOT NULL AND recipient IS NOT NULL AND length(btrim(recipient)) > 0)
    ),
  ADD CONSTRAINT alert_deliveries_site_event_check
    CHECK (event_type = 'email_test' OR site_id IS NOT NULL);

-- A deployment may find a webhook delivery left in processing by the previous
-- application version. Give an active old request one minute to finish, while
-- still making abandoned rows recoverable by the new leased claim.
UPDATE public.alert_deliveries
SET processing_until = COALESCE(processing_until, attempted_at + interval '60 seconds', now() + interval '60 seconds')
WHERE status = 'processing';

CREATE UNIQUE INDEX uq_alert_deliveries_email_event_recipient
  ON public.alert_deliveries(email_config_id, event_key, lower(recipient))
  WHERE channel = 'email';

DROP INDEX IF EXISTS public.idx_alert_deliveries_pending;
CREATE INDEX idx_alert_deliveries_due
  ON public.alert_deliveries(next_attempt_at, created_at)
  WHERE status = 'pending';
CREATE INDEX idx_alert_deliveries_expired_processing
  ON public.alert_deliveries(processing_until)
  WHERE status = 'processing';
CREATE INDEX idx_monitoring_alert_events_pending
  ON public.monitoring_alert_events(created_at)
  WHERE dispatched_at IS NULL;

ALTER TABLE public.monitoring_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_email_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.monitoring_alert_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.alert_email_configs FROM anon, authenticated;
GRANT ALL ON TABLE public.monitoring_alert_events TO service_role;
GRANT ALL ON TABLE public.alert_email_configs TO service_role;

DROP TRIGGER IF EXISTS trigger_alert_email_configs_updated_at ON public.alert_email_configs;
CREATE TRIGGER trigger_alert_email_configs_updated_at
  BEFORE UPDATE ON public.alert_email_configs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.claim_monitoring_alert_events(
  p_claimed_by UUID,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF public.monitoring_alert_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT event.id
    FROM public.monitoring_alert_events event
    WHERE event.dispatched_at IS NULL
      AND (event.claimed_until IS NULL OR event.claimed_until <= now())
    ORDER BY event.created_at, event.id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(p_limit, 100))
  ), claimed AS (
    UPDATE public.monitoring_alert_events event
    SET claimed_by = p_claimed_by,
        claimed_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 300)))
    FROM due
    WHERE event.id = due.id
    RETURNING event.*
  )
  SELECT * FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.fanout_monitoring_alert_event(
  p_event_id UUID,
  p_claimed_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_event public.monitoring_alert_events%ROWTYPE;
  v_inserted INTEGER := 0;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_event
  FROM public.monitoring_alert_events
  WHERE id = p_event_id
    AND dispatched_at IS NULL
    AND claimed_by = p_claimed_by
    AND claimed_until > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  INSERT INTO public.alert_deliveries(
    channel, webhook_id, site_id, incident_id, check_id,
    event_type, event_key, payload, status, next_attempt_at
  )
  SELECT
    'webhook', webhook.id, v_event.site_id, v_event.incident_id, v_event.check_id,
    v_event.event_type, v_event.event_key, v_event.payload, 'pending', now()
  FROM public.alert_webhooks webhook
  WHERE webhook.enabled = true
    AND v_event.event_type = ANY(webhook.event_types)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  INSERT INTO public.alert_deliveries(
    channel, email_config_id, recipient, site_id, incident_id, check_id,
    event_type, event_key, payload, status, next_attempt_at
  )
  SELECT
    'email', config.id, lower(btrim(recipient_address)), v_event.site_id, v_event.incident_id, v_event.check_id,
    v_event.event_type, v_event.event_key, v_event.payload, 'pending', now()
  FROM public.alert_email_configs config
  CROSS JOIN LATERAL unnest(config.recipients) AS recipients(recipient_address)
  WHERE config.enabled = true
    AND v_event.event_type = ANY(config.event_types)
    AND length(btrim(recipient_address)) > 0
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  UPDATE public.monitoring_alert_events
  SET dispatched_at = now(), claimed_by = NULL, claimed_until = NULL
  WHERE id = v_event.id AND claimed_by = p_claimed_by;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_alert_deliveries(
  p_claimed_by UUID,
  p_limit INTEGER DEFAULT 5,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF public.alert_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT delivery.id
    FROM public.alert_deliveries delivery
    WHERE (
      delivery.status = 'pending'
      AND delivery.next_attempt_at <= now()
    ) OR (
      delivery.status = 'processing'
      AND COALESCE(
        delivery.processing_until,
        delivery.attempted_at + interval '60 seconds',
        delivery.created_at + interval '60 seconds'
      ) <= now()
    )
    ORDER BY COALESCE(delivery.next_attempt_at, delivery.created_at), delivery.created_at, delivery.id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(p_limit, 50))
  ), claimed AS (
    UPDATE public.alert_deliveries delivery
    SET status = 'processing',
        claimed_by = p_claimed_by,
        processing_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 300))),
        attempted_at = now(),
        next_attempt_at = now(),
        attempt_count = delivery.attempt_count + 1
    FROM due
    WHERE delivery.id = due.id
    RETURNING delivery.*
  )
  SELECT * FROM claimed;
END;
$$;

-- Replaces the already-applied function without changing its signature. The
-- incident transition and durable event are committed in the same transaction.
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
SET search_path = pg_catalog, pg_temp
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
  v_duration_seconds BIGINT;
  v_payload JSONB;
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
    WHERE id = v_active_incident AND status = 'active'
    RETURNING duration_seconds INTO v_duration_seconds;
    IF FOUND THEN
      v_transition := 'resolved';
    END IF;
  END IF;

  IF v_transition IN ('opened', 'resolved') AND v_active_incident IS NOT NULL THEN
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'eventVersion', 2,
      'event', CASE WHEN v_transition = 'opened' THEN 'incident_confirmed' ELSE 'recovery' END,
      'site', jsonb_build_object(
        'clientName', v_site.client_name,
        'name', v_site.name,
        'domain', v_site.domain,
        'url', v_site.url
      ),
      'checkedAt', p_checked_at,
      'confirmedAt', CASE WHEN v_transition = 'opened' THEN p_checked_at ELSE NULL END,
      'recoveredAt', CASE WHEN v_transition = 'resolved' THEN p_checked_at ELSE NULL END,
      'status', p_status,
      'httpStatus', p_http_status,
      'incidentId', v_active_incident,
      'incidentDurationSeconds', v_duration_seconds,
      'reason', CASE WHEN v_transition = 'opened' THEN jsonb_strip_nulls(jsonb_build_object(
        'human', COALESCE(NULLIF(p_result_message, ''), 'O site nao respondeu como esperado.'),
        'technicalCode', p_error_type,
        'technicalMessage', p_error_message,
        'httpStatus', p_http_status
      )) ELSE NULL END
    ));

    INSERT INTO public.monitoring_alert_events(
      event_key, site_id, incident_id, check_id, event_type, payload
    ) VALUES (
      'incident:' || v_active_incident || CASE WHEN v_transition = 'opened' THEN ':confirmed' ELSE ':recovery' END,
      p_site_id,
      v_active_incident,
      v_check_id,
      CASE WHEN v_transition = 'opened' THEN 'incident_confirmed' ELSE 'recovery' END,
      v_payload
    ) ON CONFLICT (event_key) DO NOTHING;
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

REVOKE ALL ON FUNCTION public.claim_monitoring_alert_events(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fanout_monitoring_alert_event(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_alert_deliveries(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_monitoring_alert_events(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fanout_monitoring_alert_event(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_alert_deliveries(UUID, INTEGER, INTEGER) TO service_role;

COMMIT;
