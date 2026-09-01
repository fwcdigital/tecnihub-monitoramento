-- COFRE DE ACESSOS TÉCNICOS
-- Migration apenas preparada. Não é executada automaticamente pela aplicação.
-- Os segredos são criptografados no backend antes de chegar ao banco.

BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_technical_credentials_site_id
  ON public.technical_credentials(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credential_audit_site_created_at
  ON public.credential_audit_log(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credential_audit_admin_created_at
  ON public.credential_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credential_audit_created_at
  ON public.credential_audit_log(created_at DESC);

DROP TRIGGER IF EXISTS trigger_technical_credentials_updated_at ON public.technical_credentials;
CREATE TRIGGER trigger_technical_credentials_updated_at
  BEFORE UPDATE ON public.technical_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.technical_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.technical_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE public.credential_audit_log FROM anon, authenticated;
GRANT ALL ON TABLE public.technical_credentials TO service_role;
GRANT ALL ON TABLE public.credential_audit_log TO service_role;

COMMIT;
