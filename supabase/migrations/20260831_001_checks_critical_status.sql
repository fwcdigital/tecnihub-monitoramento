-- FASE 1: permite distinguir erro HTTP 5xx (critical) de falha de conexão (offline).
-- Migration não destrutiva: não altera nem remove checks existentes.

BEGIN;

ALTER TABLE public.checks
  DROP CONSTRAINT IF EXISTS checks_status_check;

ALTER TABLE public.checks
  ADD CONSTRAINT checks_status_check
  CHECK (status IN ('online', 'warning', 'critical', 'offline'));

COMMIT;
