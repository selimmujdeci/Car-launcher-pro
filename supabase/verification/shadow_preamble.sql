-- ============================================================================
-- Shadow/Local DB preamble — düz bir Postgres'i migration'ları barındıracak
-- hale getirir (Supabase'in sağladığı roller + auth şeması STUB'ları).
-- YALNIZ SHADOW/LOCAL test içindir; production'da ÇALIŞTIRILMAZ.
-- ============================================================================

-- Supabase rolleri (migration'lar bunlara GRANT verir).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon          NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role  NOLOGIN; END IF;
END $$;

-- auth şeması + jwt() STUB (policy'ler auth.jwt()'e başvuruyor).
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

-- gen_random_uuid() PG13+ yerleşiktir; eski sürümde pgcrypto gerekebilir.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
