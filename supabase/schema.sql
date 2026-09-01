-- ==============================================================================
-- TECNIHUB MONITORAMENTO - SCHEMA SUPABASE / POSTGRESQL (ETAPA 1)
-- ==============================================================================

-- Habilita extensão para geração de UUIDs (caso ainda não esteja habilitada)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. TABELA: sites
-- Armazena os domínios e configurações de monitoramento dos clientes TECNIHUB.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  hosting_provider TEXT NOT NULL DEFAULT 'Hostinger',
  is_wordpress BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  check_interval TEXT NOT NULL DEFAULT '5min',
  expected_content TEXT,
  expected_ga4_id TEXT,
  expected_gtm_id TEXT,
  expected_google_ads_id TEXT,
  expected_meta_pixel_id TEXT,
  uses_search_console BOOLEAN NOT NULL DEFAULT false,
  uses_rd_station BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 2. TABELA: checks
-- Registra o histórico individual de cada verificação HTTP/status realizada.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('online', 'warning', 'critical', 'offline')),
  http_status INTEGER,
  response_time NUMERIC(10, 2), -- tempo de resposta em milissegundos
  final_url TEXT,
  error_type TEXT,
  error_message TEXT
);

-- ==============================================================================
-- 3. TABELA: incidents
-- Registra ocorrências, anomalias e quedas associadas a cada site.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title TEXT NOT NULL,
  description TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- ÍNDICES PARA PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_sites_is_active ON public.sites(is_active);
CREATE INDEX IF NOT EXISTS idx_sites_client_name ON public.sites(client_name);
CREATE INDEX IF NOT EXISTS idx_checks_site_id_checked_at ON public.checks(site_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_site_id_status ON public.incidents(site_id, status);

-- ==============================================================================
-- TRIGGER PARA ATUALIZAR O CAMPO updated_at AUTOMATICAMENTE NA TABELA sites
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sites_updated_at ON public.sites;
CREATE TRIGGER trigger_sites_updated_at
  BEFORE UPDATE ON public.sites
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
-- O frontend não acessa estas tabelas diretamente. Toda operação administrativa
-- passa pelo backend autenticado com a service role.
-- ==============================================================================
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- Sem policies para anon/authenticated: RLS nega acesso direto por padrão.
REVOKE ALL ON TABLE public.sites FROM anon, authenticated;
REVOKE ALL ON TABLE public.checks FROM anon, authenticated;
REVOKE ALL ON TABLE public.incidents FROM anon, authenticated;

GRANT ALL ON TABLE public.sites TO service_role;
GRANT ALL ON TABLE public.checks TO service_role;
GRANT ALL ON TABLE public.incidents TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
