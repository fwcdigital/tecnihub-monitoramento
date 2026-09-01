-- Alertas webhook persistidos. E-mail permanece explicitamente indisponivel
-- ate existir um provedor implementado e configurado no backend.

BEGIN;

CREATE TABLE IF NOT EXISTS public.alert_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Webhook principal',
  url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 1000 AND 15000),
  event_types TEXT[] NOT NULL DEFAULT ARRAY['incident_confirmed', 'recovery']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (event_types <@ ARRAY['incident_confirmed', 'recovery', 'ssl_expiring', 'dns_changed']::TEXT[])
);

CREATE TABLE IF NOT EXISTS public.alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES public.alert_webhooks(id) ON DELETE RESTRICT,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  check_id UUID REFERENCES public.checks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('incident_confirmed', 'recovery', 'ssl_expiring', 'dns_changed')),
  event_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  UNIQUE (webhook_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_pending
  ON public.alert_deliveries(status, created_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.alert_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alert_webhooks FROM anon, authenticated;
REVOKE ALL ON TABLE public.alert_deliveries FROM anon, authenticated;
GRANT ALL ON TABLE public.alert_webhooks TO service_role;
GRANT ALL ON TABLE public.alert_deliveries TO service_role;

DROP TRIGGER IF EXISTS trigger_alert_webhooks_updated_at ON public.alert_webhooks;
CREATE TRIGGER trigger_alert_webhooks_updated_at
  BEFORE UPDATE ON public.alert_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMIT;
