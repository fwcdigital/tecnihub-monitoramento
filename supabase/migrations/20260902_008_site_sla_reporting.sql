-- Relatorio profissional de SLA baseado exclusivamente nos intervalos reais de
-- incidentes confirmados pela regra existente de 3 falhas / 2 recuperacoes.

BEGIN;

ALTER TABLE public.sites
  ADD COLUMN sla_target_percent NUMERIC(6,3) NOT NULL DEFAULT 99.900;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_sla_target_percent_check
  CHECK (sla_target_percent > 0 AND sla_target_percent <= 100);

CREATE INDEX idx_incidents_site_started_at
  ON public.incidents(site_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.get_site_sla_report(
  p_site_id UUID,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_incident_limit INTEGER DEFAULT 50,
  p_incident_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_site public.sites%ROWTYPE;
  v_check_before_start TIMESTAMPTZ;
  v_first_check_in_period TIMESTAMPTZ;
  v_last_check_in_period TIMESTAMPTZ;
  v_observed_start TIMESTAMPTZ;
  v_observed_end TIMESTAMPTZ;
  v_expected_interval INTERVAL;
  v_gap_tolerance INTERVAL;
  v_abnormal_gap_count BIGINT := 0;
  v_largest_gap_seconds NUMERIC := 0;
  v_period_seconds NUMERIC := 0;
  v_downtime_seconds NUMERIC := 0;
  v_allowed_seconds NUMERIC;
  v_margin_seconds NUMERIC;
  v_availability NUMERIC;
  v_incident_count BIGINT := 0;
  v_longest_seconds NUMERIC := 0;
  v_average_seconds NUMERIC := 0;
  v_mttr_seconds NUMERIC;
  v_open_count BIGINT := 0;
  v_history_total BIGINT := 0;
  v_history JSONB := '[]'::jsonb;
  v_has_data BOOLEAN := false;
  v_start_covered BOOLEAN := false;
  v_end_covered BOOLEAN := false;
  v_has_continuous_coverage BOOLEAN := false;
  v_has_full_coverage BOOLEAN := false;
  v_status TEXT := 'insufficient_data';
  v_limit INTEGER := greatest(1, least(COALESCE(p_incident_limit, 50), 100));
  v_offset INTEGER := greatest(0, COALESCE(p_incident_offset, 0));
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Periodo de SLA invalido.';
  END IF;

  IF p_period_end > now() + interval '1 minute' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'O periodo de SLA nao pode terminar no futuro.';
  END IF;

  IF p_period_end - p_period_start > interval '366 days' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'O periodo de SLA nao pode exceder 366 dias.';
  END IF;

  SELECT * INTO v_site
  FROM public.sites site
  WHERE site.id = p_site_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Site nao encontrado.';
  END IF;

  v_expected_interval := public.monitor_interval_value(v_site.check_interval);
  v_gap_tolerance := greatest(
    v_expected_interval * 2,
    v_expected_interval + interval '5 minutes'
  );

  -- Um warning HTTP (incluindo 401/403/429) comprova que o scheduler observou
  -- o site, mas nunca vira downtime. Bloqueio SSRF/security_blocked nao comprova
  -- cobertura. O estado ativo atual nao prova nem invalida cobertura historica.
  SELECT check_row.checked_at
  INTO v_check_before_start
  FROM public.checks check_row
  WHERE check_row.site_id = p_site_id
    AND check_row.status <> 'security_blocked'
    AND check_row.checked_at <= p_period_start
  ORDER BY check_row.checked_at DESC, check_row.id DESC
  LIMIT 1;

  SELECT min(check_row.checked_at), max(check_row.checked_at)
  INTO v_first_check_in_period, v_last_check_in_period
  FROM public.checks check_row
  WHERE check_row.site_id = p_site_id
    AND check_row.status <> 'security_blocked'
    AND check_row.checked_at >= p_period_start
    AND check_row.checked_at < p_period_end;

  v_start_covered := v_check_before_start IS NOT NULL
    AND p_period_start - v_check_before_start <= v_gap_tolerance;
  v_end_covered := v_last_check_in_period IS NOT NULL
    AND p_period_end - v_last_check_in_period <= v_gap_tolerance;

  v_observed_start := CASE
    WHEN v_start_covered THEN p_period_start
    ELSE v_first_check_in_period
  END;
  v_observed_end := CASE
    WHEN v_end_covered THEN p_period_end
    ELSE v_last_check_in_period
  END;
  v_has_data := v_observed_start IS NOT NULL
    AND v_observed_end IS NOT NULL
    AND v_observed_end > v_observed_start;

  IF v_has_data THEN
    WITH ordered_checks AS (
      SELECT
        check_row.checked_at,
        lag(check_row.checked_at) OVER (
          ORDER BY check_row.checked_at, check_row.id
        ) AS previous_checked_at
      FROM public.checks check_row
      WHERE check_row.site_id = p_site_id
        AND check_row.status <> 'security_blocked'
        AND check_row.checked_at >= CASE
          WHEN v_start_covered THEN v_check_before_start
          ELSE v_observed_start
        END
        AND check_row.checked_at <= v_observed_end
    ), gaps AS (
      SELECT extract(epoch FROM (checked_at - previous_checked_at)) AS gap_seconds
      FROM ordered_checks
      WHERE previous_checked_at IS NOT NULL
        AND checked_at - previous_checked_at > v_gap_tolerance
    )
    SELECT count(*), COALESCE(max(gap_seconds), 0)
    INTO v_abnormal_gap_count, v_largest_gap_seconds
    FROM gaps;

    v_has_continuous_coverage := v_abnormal_gap_count = 0;
    v_has_full_coverage := v_has_continuous_coverage
      AND v_start_covered
      AND v_end_covered;
    v_period_seconds := greatest(0, extract(epoch FROM (v_observed_end - v_observed_start)));
  END IF;

  IF v_period_seconds > 0 THEN
    WITH incident_overlaps AS (
      SELECT
        incident.id,
        greatest(incident.started_at, v_observed_start) AS overlap_start,
        least(COALESCE(incident.resolved_at, v_observed_end), v_observed_end) AS overlap_end
      FROM public.incidents incident
      WHERE incident.site_id = p_site_id
        AND incident.started_at < v_observed_end
        AND COALESCE(incident.resolved_at, v_observed_end) > v_observed_start
    ), valid_overlaps AS (
      SELECT
        id,
        overlap_start,
        overlap_end,
        extract(epoch FROM (overlap_end - overlap_start)) AS seconds
      FROM incident_overlaps
      WHERE overlap_end > overlap_start
    ), ordered_overlaps AS (
      SELECT
        valid_overlaps.*,
        max(overlap_end) OVER (
          ORDER BY overlap_start, overlap_end, id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS previous_max_end
      FROM valid_overlaps
    ), marked_overlaps AS (
      SELECT
        ordered_overlaps.*,
        CASE
          WHEN previous_max_end IS NULL OR overlap_start > previous_max_end THEN 1
          ELSE 0
        END AS starts_new_group
      FROM ordered_overlaps
    ), grouped_overlaps AS (
      SELECT
        marked_overlaps.*,
        sum(starts_new_group) OVER (
          ORDER BY overlap_start, overlap_end, id
          ROWS UNBOUNDED PRECEDING
        ) AS overlap_group
      FROM marked_overlaps
    ), merged_overlaps AS (
      SELECT min(overlap_start) AS overlap_start, max(overlap_end) AS overlap_end
      FROM grouped_overlaps
      GROUP BY overlap_group
    ), incident_stats AS (
      SELECT
        count(*) AS incident_count,
        COALESCE(max(seconds), 0) AS longest_seconds,
        COALESCE(avg(seconds), 0) AS average_seconds
      FROM valid_overlaps
    ), downtime_stats AS (
      SELECT COALESCE(sum(extract(epoch FROM (overlap_end - overlap_start))), 0) AS downtime_seconds
      FROM merged_overlaps
    )
    SELECT
      incident_stats.incident_count,
      downtime_stats.downtime_seconds,
      incident_stats.longest_seconds,
      incident_stats.average_seconds
    INTO v_incident_count, v_downtime_seconds, v_longest_seconds, v_average_seconds
    FROM incident_stats CROSS JOIN downtime_stats;

    -- A uniao dos intervalos evita dupla contagem de incidentes legados
    -- sobrepostos. O limite permanece apenas como defesa contra dados invalidos.
    v_downtime_seconds := least(v_downtime_seconds, v_period_seconds);

    -- Uma lacuna interna torna desconhecida parte do intervalo. Nesse caso nao
    -- se fabrica uptime nem mesmo parcial. Inicio/fim parciais, quando continuos,
    -- ainda podem produzir um valor informativo sem classificacao de SLA.
    IF v_has_continuous_coverage THEN
      v_availability := greatest(0, 100 * (v_period_seconds - v_downtime_seconds) / v_period_seconds);
      v_allowed_seconds := v_period_seconds * (100 - v_site.sla_target_percent) / 100;
      v_margin_seconds := v_allowed_seconds - v_downtime_seconds;

      IF v_has_full_coverage THEN
        v_status := CASE
          WHEN v_availability >= v_site.sla_target_percent THEN 'within_sla'
          ELSE 'below_sla'
        END;
      END IF;
    END IF;
  END IF;

  -- MTTR considera incidentes efetivamente recuperados dentro do periodo e usa
  -- a duracao real persistida pelo motor de monitoramento.
  SELECT avg(COALESCE(
    incident.duration_seconds,
    greatest(0, extract(epoch FROM (incident.resolved_at - incident.started_at)))
  ))
  INTO v_mttr_seconds
  FROM public.incidents incident
  WHERE incident.site_id = p_site_id
    AND incident.status = 'resolved'
    AND incident.resolved_at IS NOT NULL
    AND incident.resolved_at > COALESCE(v_observed_start, p_period_start)
    AND incident.resolved_at <= p_period_end;

  SELECT count(*) INTO v_open_count
  FROM public.incidents incident
  WHERE incident.site_id = p_site_id
    AND incident.status = 'active';

  SELECT count(*) INTO v_history_total
  FROM public.incidents incident
  WHERE incident.site_id = p_site_id
    AND incident.started_at < p_period_end
    AND COALESCE(incident.resolved_at, p_period_end) > COALESCE(v_observed_start, p_period_start);

  SELECT COALESCE(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', history.id,
      'status', history.status,
      'severity', history.severity,
      'humanCause', COALESCE(NULLIF(history.title, ''), 'Indisponibilidade confirmada'),
      'description', history.description,
      'technicalCode', history.reason,
      'startedAt', history.started_at,
      'resolvedAt', history.resolved_at,
      'durationSeconds', CASE
        WHEN history.status = 'active' THEN greatest(0, extract(epoch FROM (least(now(), p_period_end) - history.started_at)))
        ELSE COALESCE(history.duration_seconds, greatest(0, extract(epoch FROM (history.resolved_at - history.started_at))))
      END,
      'periodDowntimeSeconds', greatest(0, extract(epoch FROM (
        least(COALESCE(history.resolved_at, p_period_end), p_period_end)
        - greatest(history.started_at, COALESCE(v_observed_start, p_period_start))
      ))),
      'failedChecks', history.failed_checks_count
    )) ORDER BY history.started_at DESC
  ), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT incident.*
    FROM public.incidents incident
    WHERE incident.site_id = p_site_id
      AND incident.started_at < p_period_end
      AND COALESCE(incident.resolved_at, p_period_end) > COALESCE(v_observed_start, p_period_start)
    ORDER BY incident.started_at DESC, incident.id DESC
    LIMIT v_limit OFFSET v_offset
  ) history;

  RETURN jsonb_build_object(
    'site', jsonb_build_object(
      'id', v_site.id,
      'clientName', v_site.client_name,
      'name', v_site.name,
      'domain', v_site.domain,
      'slaTargetPercent', v_site.sla_target_percent
    ),
    'period', jsonb_build_object(
      'start', p_period_start,
      'end', p_period_end,
      'observedStart', v_observed_start,
      'observedEnd', v_observed_end,
      'seconds', v_period_seconds,
      'hasData', v_has_data,
      'hasContinuousCoverage', v_has_continuous_coverage,
      'hasFullCoverage', v_has_full_coverage,
      'startCovered', v_start_covered,
      'endCovered', v_end_covered,
      'expectedIntervalSeconds', extract(epoch FROM v_expected_interval),
      'gapToleranceSeconds', extract(epoch FROM v_gap_tolerance),
      'abnormalGapCount', v_abnormal_gap_count,
      'largestGapSeconds', round(v_largest_gap_seconds)
    ),
    'summary', jsonb_build_object(
      'availabilityPercent', CASE WHEN v_availability IS NULL THEN NULL ELSE round(v_availability, 5) END,
      'slaStatus', v_status,
      'incidentCount', v_incident_count,
      'openIncidents', v_open_count,
      'downtimeSeconds', round(v_downtime_seconds),
      'allowedDowntimeSeconds', CASE WHEN v_allowed_seconds IS NULL THEN NULL ELSE round(v_allowed_seconds) END,
      'remainingOrExceededSeconds', CASE WHEN v_margin_seconds IS NULL THEN NULL ELSE round(v_margin_seconds) END,
      'longestIncidentSeconds', round(v_longest_seconds),
      'averageIncidentSeconds', round(v_average_seconds),
      'mttrSeconds', CASE WHEN v_mttr_seconds IS NULL THEN NULL ELSE round(v_mttr_seconds) END
    ),
    'incidents', v_history,
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', v_history_total,
      'hasMore', v_offset + v_limit < v_history_total
    ),
    'formulaVersion', 2
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_site_sla_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_sla_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER)
  TO service_role;

COMMIT;
