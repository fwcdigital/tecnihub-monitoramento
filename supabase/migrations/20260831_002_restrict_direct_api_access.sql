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

COMMIT;
