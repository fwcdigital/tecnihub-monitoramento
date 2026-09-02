-- Exclusao definitiva e atomica de um site e de todos os dados que pertencem a ele.
-- Recursos globais ou compartilhados (webhooks, configuracao de e-mail, caches,
-- runs e locks do scheduler) nao sao removidos.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_site_deletion_impact(p_site_id UUID)
RETURNS TABLE(
  site_id UUID,
  site_name TEXT,
  site_domain TEXT,
  checks_count BIGINT,
  incidents_count BIGINT,
  alert_events_count BIGINT,
  alert_deliveries_count BIGINT,
  credentials_count BIGINT,
  credential_audit_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    site.id,
    site.name,
    site.domain,
    (SELECT count(*) FROM public.checks check_row WHERE check_row.site_id = site.id),
    (SELECT count(*) FROM public.incidents incident WHERE incident.site_id = site.id),
    (
      SELECT count(*)
      FROM public.monitoring_alert_events event
      WHERE event.site_id = site.id
         OR event.check_id IN (SELECT check_row.id FROM public.checks check_row WHERE check_row.site_id = site.id)
         OR event.incident_id IN (SELECT incident.id FROM public.incidents incident WHERE incident.site_id = site.id)
    ),
    (
      SELECT count(*)
      FROM public.alert_deliveries delivery
      WHERE delivery.site_id = site.id
         OR delivery.check_id IN (SELECT check_row.id FROM public.checks check_row WHERE check_row.site_id = site.id)
         OR delivery.incident_id IN (SELECT incident.id FROM public.incidents incident WHERE incident.site_id = site.id)
    ),
    (SELECT count(*) FROM public.technical_credentials credential WHERE credential.site_id = site.id),
    (
      SELECT count(*)
      FROM public.credential_audit_log audit
      WHERE audit.site_id = site.id
         OR audit.credential_id IN (
           SELECT credential.id
           FROM public.technical_credentials credential
           WHERE credential.site_id = site.id
         )
    )
  FROM public.sites site
  WHERE site.id = p_site_id;
$$;

CREATE OR REPLACE FUNCTION public.delete_site_permanently(
  p_site_id UUID,
  p_confirmation TEXT
)
RETURNS TABLE(
  deleted_site_id UUID,
  site_name TEXT,
  site_domain TEXT,
  checks_deleted BIGINT,
  incidents_deleted BIGINT,
  alert_events_deleted BIGINT,
  alert_deliveries_deleted BIGINT,
  credentials_deleted BIGINT,
  credential_audit_deleted BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_site_name TEXT;
  v_site_domain TEXT;
  v_checks BIGINT;
  v_incidents BIGINT;
  v_alert_events BIGINT;
  v_alert_deliveries BIGINT;
  v_credentials BIGINT;
  v_credential_audit BIGINT;
BEGIN
  SELECT site.name, site.domain
  INTO v_site_name, v_site_domain
  FROM public.sites site
  WHERE site.id = p_site_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Site nao encontrado.';
  END IF;

  IF lower(btrim(COALESCE(p_confirmation, ''))) NOT IN (
    lower(btrim(v_site_name)),
    lower(btrim(v_site_domain))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Confirmacao de exclusao invalida.';
  END IF;

  SELECT
    impact.checks_count,
    impact.incidents_count,
    impact.alert_events_count,
    impact.alert_deliveries_count,
    impact.credentials_count,
    impact.credential_audit_count
  INTO
    v_checks,
    v_incidents,
    v_alert_events,
    v_alert_deliveries,
    v_credentials,
    v_credential_audit
  FROM public.get_site_deletion_impact(p_site_id) impact;

  -- Auditoria pode apontar para a credencial mesmo quando site_id estiver nulo.
  DELETE FROM public.credential_audit_log audit
  WHERE audit.site_id = p_site_id
     OR audit.credential_id IN (
       SELECT credential.id
       FROM public.technical_credentials credential
       WHERE credential.site_id = p_site_id
     );

  DELETE FROM public.technical_credentials credential
  WHERE credential.site_id = p_site_id;

  -- Entregas e eventos podem referenciar site, check e incidente ao mesmo tempo.
  DELETE FROM public.alert_deliveries delivery
  WHERE delivery.site_id = p_site_id
     OR delivery.check_id IN (
       SELECT check_row.id FROM public.checks check_row WHERE check_row.site_id = p_site_id
     )
     OR delivery.incident_id IN (
       SELECT incident.id FROM public.incidents incident WHERE incident.site_id = p_site_id
     );

  DELETE FROM public.monitoring_alert_events event
  WHERE event.site_id = p_site_id
     OR event.check_id IN (
       SELECT check_row.id FROM public.checks check_row WHERE check_row.site_id = p_site_id
     )
     OR event.incident_id IN (
       SELECT incident.id FROM public.incidents incident WHERE incident.site_id = p_site_id
     );

  DELETE FROM public.checks check_row
  WHERE check_row.site_id = p_site_id;

  DELETE FROM public.incidents incident
  WHERE incident.site_id = p_site_id;

  DELETE FROM public.sites site
  WHERE site.id = p_site_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O site deixou de existir durante a exclusao.';
  END IF;

  RETURN QUERY SELECT
    p_site_id,
    v_site_name,
    v_site_domain,
    COALESCE(v_checks, 0),
    COALESCE(v_incidents, 0),
    COALESCE(v_alert_events, 0),
    COALESCE(v_alert_deliveries, 0),
    COALESCE(v_credentials, 0),
    COALESCE(v_credential_audit, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_site_deletion_impact(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_site_permanently(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_deletion_impact(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_site_permanently(UUID, TEXT) TO service_role;

COMMIT;
