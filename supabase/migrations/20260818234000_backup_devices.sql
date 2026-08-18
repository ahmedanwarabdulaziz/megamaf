-- Self-service backup devices and queued backup jobs.
-- These tables are deliberately isolated from all business and financial data.

CREATE TABLE public.backup_device_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  requested_name text NOT NULL CHECK (char_length(requested_name) BETWEEN 1 AND 80),
  created_by uuid NOT NULL REFERENCES public.employees(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.backup_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  agent_token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  is_primary boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES public.employees(id),
  paired_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  hostname text,
  platform text,
  agent_version text,
  backup_path text,
  free_disk_bytes bigint CHECK (free_disk_bytes IS NULL OR free_disk_bytes >= 0),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX backup_devices_one_primary_idx
  ON public.backup_devices (is_primary)
  WHERE is_primary = true AND status = 'active';

CREATE INDEX backup_devices_status_seen_idx
  ON public.backup_devices (status, last_seen_at DESC);

CREATE TABLE public.backup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.backup_devices(id),
  requested_by uuid NOT NULL REFERENCES public.employees(id),
  mode text NOT NULL CHECK (mode IN ('database', 'incremental', 'full')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  archive_name text,
  archive_path text,
  archive_bytes bigint CHECK (archive_bytes IS NULL OR archive_bytes >= 0),
  archive_sha256 text,
  source_commit text,
  error_message text,
  agent_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX backup_jobs_device_queue_idx
  ON public.backup_jobs (device_id, status, requested_at);

CREATE INDEX backup_jobs_recent_idx
  ON public.backup_jobs (requested_at DESC);

CREATE OR REPLACE FUNCTION public.backup_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER backup_devices_set_updated_at
  BEFORE UPDATE ON public.backup_devices
  FOR EACH ROW EXECUTE FUNCTION public.backup_set_updated_at();

CREATE TRIGGER backup_jobs_set_updated_at
  BEFORE UPDATE ON public.backup_jobs
  FOR EACH ROW EXECUTE FUNCTION public.backup_set_updated_at();

-- Atomically consume a pairing code and register a device. Only the server-side
-- service role may call this function; the raw code and token are never stored.
CREATE OR REPLACE FUNCTION public.register_backup_device(
  p_code_hash text,
  p_token_hash text,
  p_name text,
  p_hostname text,
  p_platform text,
  p_agent_version text,
  p_backup_path text,
  p_capabilities jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pairing public.backup_device_pairings%ROWTYPE;
  v_device_id uuid;
  v_make_primary boolean;
BEGIN
  SELECT * INTO v_pairing
  FROM public.backup_device_pairings
  WHERE code_hash = p_code_hash
  FOR UPDATE;

  IF NOT FOUND OR v_pairing.used_at IS NOT NULL OR v_pairing.expires_at <= now() THEN
    RAISE EXCEPTION 'invalid_or_expired_pairing';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.backup_devices
    WHERE status = 'active' AND is_primary = true
  ) INTO v_make_primary;

  INSERT INTO public.backup_devices (
    name,
    agent_token_hash,
    is_primary,
    created_by,
    hostname,
    platform,
    agent_version,
    backup_path,
    capabilities,
    last_seen_at
  ) VALUES (
    COALESCE(NULLIF(trim(p_name), ''), v_pairing.requested_name),
    p_token_hash,
    v_make_primary,
    v_pairing.created_by,
    left(NULLIF(p_hostname, ''), 255),
    left(NULLIF(p_platform, ''), 255),
    left(NULLIF(p_agent_version, ''), 80),
    left(NULLIF(p_backup_path, ''), 1000),
    COALESCE(p_capabilities, '{}'::jsonb),
    now()
  ) RETURNING id INTO v_device_id;

  UPDATE public.backup_device_pairings
  SET used_at = now()
  WHERE id = v_pairing.id;

  RETURN v_device_id;
END;
$$;

-- Claim at most one queued job while holding a row lock, preventing duplicate
-- execution if two agent polls overlap.
CREATE OR REPLACE FUNCTION public.claim_backup_job(p_device_id uuid)
RETURNS SETOF public.backup_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.backup_devices
    WHERE id = p_device_id AND status = 'active'
  ) THEN
    RETURN;
  END IF;

  SELECT id INTO v_job_id
  FROM public.backup_jobs
  WHERE device_id = p_device_id AND status = 'queued'
  ORDER BY requested_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.backup_jobs
  SET status = 'running', started_at = now(), error_message = NULL
  WHERE id = v_job_id AND status = 'queued'
  RETURNING *;
END;
$$;

ALTER TABLE public.backup_device_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_jobs ENABLE ROW LEVEL SECURITY;

-- Access is only through server routes after an application-admin or device-token
-- check. No browser role may read token hashes, pairing hashes, or local paths.
REVOKE ALL ON public.backup_device_pairings FROM anon, authenticated;
REVOKE ALL ON public.backup_devices FROM anon, authenticated;
REVOKE ALL ON public.backup_jobs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_device_pairings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_devices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_jobs TO service_role;
REVOKE ALL ON FUNCTION public.register_backup_device(text, text, text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_backup_job(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_backup_device(text, text, text, text, text, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_backup_job(uuid)
  TO service_role;
