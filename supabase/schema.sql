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
  sla_target_percent NUMERIC(6,3) NOT NULL DEFAULT 99.900 CHECK (sla_target_percent > 0 AND sla_target_percent <= 100),
  monitor_response_time BOOLEAN NOT NULL DEFAULT true,
  monitor_ssl BOOLEAN NOT NULL DEFAULT true,
  monitor_domain BOOLEAN NOT NULL DEFAULT true,
  expected_content TEXT,
  expected_ga4_id TEXT,
  expected_gtm_id TEXT,
  expected_google_ads_id TEXT,
  expected_meta_pixel_id TEXT,
  uses_search_console BOOLEAN NOT NULL DEFAULT false,
  uses_rd_station BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  consecutive_successes INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_successes >= 0),
  monitoring_state TEXT NOT NULL DEFAULT 'pending' CHECK (monitoring_state IN ('pending', 'online', 'warning', 'suspected_failure', 'down', 'recovering', 'security_blocked', 'paused')),
  monitoring_claimed_until TIMESTAMPTZ,
  monitoring_claimed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 2. TABELA: checks
-- Registra o histórico individual de cada verificação HTTP/status realizada.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('online', 'warning', 'critical', 'offline', 'security_blocked')),
  http_status INTEGER,
  response_time NUMERIC(10, 2), -- tempo de resposta em milissegundos
  final_url TEXT,
  error_type TEXT,
  error_message TEXT,
  observed_ip INET,
  dns_records JSONB,
  ssl JSONB,
  expected_content_found BOOLEAN,
  wordpress JSONB,
  domain_rdap JSONB,
  redirect_count INTEGER NOT NULL DEFAULT 0,
  result_message TEXT,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  incident_eligible BOOLEAN NOT NULL DEFAULT false
);

-- ==============================================================================
-- 3. TABELA: incidents
-- Registra ocorrências, anomalias e quedas associadas a cada site.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title TEXT NOT NULL,
  description TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds BIGINT,
  reason TEXT,
  failed_checks_count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.checks
  ADD COLUMN IF NOT EXISTS incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL;

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

CREATE TABLE IF NOT EXISTS public.alert_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Webhook principal',
  url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 1000 AND 15000),
  event_types TEXT[] NOT NULL DEFAULT ARRAY['incident_confirmed', 'recovery']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.monitoring_alert_events (
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

CREATE TABLE IF NOT EXISTS public.alert_email_configs (
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

CREATE TABLE IF NOT EXISTS public.alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'webhook' CHECK (channel IN ('webhook', 'email')),
  webhook_id UUID REFERENCES public.alert_webhooks(id) ON DELETE RESTRICT,
  email_config_id UUID REFERENCES public.alert_email_configs(id) ON DELETE RESTRICT,
  recipient TEXT,
  site_id UUID REFERENCES public.sites(id) ON DELETE RESTRICT,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  check_id UUID REFERENCES public.checks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('incident_confirmed', 'recovery', 'ssl_expiring', 'dns_changed', 'email_test')),
  event_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  response_status INTEGER,
  provider_message_id TEXT,
  last_error_code TEXT,
  error_message TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_until TIMESTAMPTZ,
  claimed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  CHECK (
    (channel = 'webhook' AND webhook_id IS NOT NULL AND email_config_id IS NULL AND recipient IS NULL)
    OR
    (channel = 'email' AND webhook_id IS NULL AND email_config_id IS NOT NULL AND recipient IS NOT NULL AND length(btrim(recipient)) > 0)
  ),
  CHECK (event_type = 'email_test' OR site_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.technical_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('WORDPRESS', 'HOSPEDAGEM', 'FTP', 'SFTP', 'OUTROS')),
  service_name TEXT,
  provider TEXT,
  url TEXT,
  username TEXT,
  protocol TEXT CHECK (protocol IS NULL OR protocol IN ('FTP', 'SFTP')),
  host TEXT,
  port INTEGER CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
  notes TEXT,
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_auth_tag TEXT NOT NULL,
  cipher_algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm' CHECK (cipher_algorithm = 'aes-256-gcm'),
  cipher_version INTEGER NOT NULL DEFAULT 1 CHECK (cipher_version = 1),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.credential_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID,
  site_id UUID REFERENCES public.sites(id) ON DELETE RESTRICT,
  admin_id UUID NOT NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'credential_created', 'credential_updated', 'password_copied', 'password_changed',
    'credential_removed', 'vault_authorized', 'vault_authorization_failed'
  )),
  success BOOLEAN NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- ÍNDICES PARA PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_sites_is_active ON public.sites(is_active);
CREATE INDEX IF NOT EXISTS idx_sites_client_name ON public.sites(client_name);
CREATE INDEX IF NOT EXISTS idx_checks_site_id_checked_at ON public.checks(site_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_site_id_status ON public.incidents(site_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_site_started_at ON public.incidents(site_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_incidents_one_active_per_site ON public.incidents(site_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sites_due_monitoring ON public.sites(next_check_at) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_checks_incident_id ON public.checks(incident_id);
CREATE INDEX IF NOT EXISTS idx_checks_status_checked_at ON public.checks(status, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitoring_runs_started_at ON public.monitoring_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduler_locks_locked_until ON public.monitoring_scheduler_locks(locked_until);
CREATE INDEX IF NOT EXISTS idx_monitoring_alert_events_pending ON public.monitoring_alert_events(created_at) WHERE dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_due ON public.alert_deliveries(next_attempt_at, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_expired_processing ON public.alert_deliveries(processing_until) WHERE status = 'processing';
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_deliveries_webhook_event ON public.alert_deliveries(webhook_id, event_key) WHERE channel = 'webhook';
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_deliveries_email_event_recipient ON public.alert_deliveries(email_config_id, event_key, lower(recipient)) WHERE channel = 'email';
CREATE INDEX IF NOT EXISTS idx_technical_credentials_site_id ON public.technical_credentials(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credential_audit_site_created_at ON public.credential_audit_log(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credential_audit_admin_created_at ON public.credential_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credential_audit_created_at ON public.credential_audit_log(created_at DESC);

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

DROP TRIGGER IF EXISTS trigger_technical_credentials_updated_at ON public.technical_credentials;
CREATE TRIGGER trigger_technical_credentials_updated_at
  BEFORE UPDATE ON public.technical_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_alert_email_configs_updated_at ON public.alert_email_configs;
CREATE TRIGGER trigger_alert_email_configs_updated_at
  BEFORE UPDATE ON public.alert_email_configs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
-- O frontend não acessa estas tabelas diretamente. Toda operação administrativa
-- passa pelo backend autenticado com a service role.
-- ==============================================================================
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_scheduler_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_rdap_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_email_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technical_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_audit_log ENABLE ROW LEVEL SECURITY;

-- Sem policies para anon/authenticated: RLS nega acesso direto por padrão.
REVOKE ALL ON TABLE public.sites FROM anon, authenticated;
REVOKE ALL ON TABLE public.checks FROM anon, authenticated;
REVOKE ALL ON TABLE public.incidents FROM anon, authenticated;
REVOKE ALL ON TABLE public.monitoring_scheduler_locks FROM anon, authenticated;
REVOKE ALL ON TABLE public.monitoring_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.domain_rdap_cache FROM anon, authenticated;
REVOKE ALL ON TABLE public.alert_webhooks FROM anon, authenticated;
REVOKE ALL ON TABLE public.monitoring_alert_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.alert_email_configs FROM anon, authenticated;
REVOKE ALL ON TABLE public.alert_deliveries FROM anon, authenticated;
REVOKE ALL ON TABLE public.technical_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE public.credential_audit_log FROM anon, authenticated;

GRANT ALL ON TABLE public.sites TO service_role;
GRANT ALL ON TABLE public.checks TO service_role;
GRANT ALL ON TABLE public.incidents TO service_role;
GRANT ALL ON TABLE public.monitoring_scheduler_locks TO service_role;
GRANT ALL ON TABLE public.monitoring_runs TO service_role;
GRANT ALL ON TABLE public.domain_rdap_cache TO service_role;
GRANT ALL ON TABLE public.alert_webhooks TO service_role;
GRANT ALL ON TABLE public.monitoring_alert_events TO service_role;
GRANT ALL ON TABLE public.alert_email_configs TO service_role;
GRANT ALL ON TABLE public.alert_deliveries TO service_role;
GRANT ALL ON TABLE public.technical_credentials TO service_role;
GRANT ALL ON TABLE public.credential_audit_log TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
