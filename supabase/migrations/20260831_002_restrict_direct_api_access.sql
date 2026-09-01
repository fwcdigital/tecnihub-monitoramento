-- FASE 1: bloqueia acesso direto das chaves anon/authenticated às tabelas internas.
-- O backend continua acessando com SUPABASE_SERVICE_ROLE_KEY e a service role
-- continua sujeita às proteções e validações implementadas na API.

BEGIN;

DROP POLICY IF EXISTS "Permitir select total em sites" ON public.sites;
DROP POLICY IF EXISTS "Permitir insert em sites" ON public.sites;
DROP POLICY IF EXISTS "Permitir update em sites" ON public.sites;
DROP POLICY IF EXISTS "Permitir delete em sites" ON public.sites;

DROP POLICY IF EXISTS "Permitir select total em checks" ON public.checks;
DROP POLICY IF EXISTS "Permitir insert em checks" ON public.checks;
DROP POLICY IF EXISTS "Permitir update em checks" ON public.checks;
DROP POLICY IF EXISTS "Permitir delete em checks" ON public.checks;

DROP POLICY IF EXISTS "Permitir select total em incidents" ON public.incidents;
DROP POLICY IF EXISTS "Permitir insert em incidents" ON public.incidents;
DROP POLICY IF EXISTS "Permitir update em incidents" ON public.incidents;
DROP POLICY IF EXISTS "Permitir delete em incidents" ON public.incidents;

REVOKE ALL ON TABLE public.sites FROM anon, authenticated;
REVOKE ALL ON TABLE public.checks FROM anon, authenticated;
REVOKE ALL ON TABLE public.incidents FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

GRANT ALL ON TABLE public.sites TO service_role;
GRANT ALL ON TABLE public.checks TO service_role;
GRANT ALL ON TABLE public.incidents TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Revisão defensiva: contempla também as tabelas internas adicionadas pelas
-- migrations seguintes quando elas já existirem no ambiente. Cada migration
-- nova continua responsável por habilitar RLS e revogar acesso ao criar a tabela.
DO $$
DECLARE
  internal_table TEXT;
BEGIN
  FOREACH internal_table IN ARRAY ARRAY[
    'monitoring_scheduler_locks', 'monitoring_runs', 'domain_rdap_cache',
    'alert_webhooks', 'alert_deliveries', 'technical_credentials',
    'credential_audit_log'
  ] LOOP
    IF to_regclass('public.' || internal_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', internal_table);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', internal_table);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', internal_table);
    END IF;
  END LOOP;
END;
$$;

COMMIT;
