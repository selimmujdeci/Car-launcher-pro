-- =====================================================================
-- Car Launcher Pro — Kanonik: audit_logs  (PR-SQL-2)
-- Migration 032: canlı DB'deki `audit_logs` tablosunun kök migration
--   setinde KANONİK, FORWARD-ONLY, IDEMPOTENT karşılığı.
--
-- BAĞLAM/KURALLAR: bkz. 030 başlığı. BİREBİR temsil, DAVRANIŞ DEĞİŞMEZ,
--   NON-DESTRUCTIVE (no DROP/REVOKE/backfill).
--
-- GÜVENLİK: audit_logs adli kayıt (167 satır canlıda). anon için policy
--   YOK → RLS varsayılan DENY (anon erişemez). Bu migration anon'a HİÇBİR
--   GRANT vermez (gerekli değil). ⚠️ Canlıda legacy fazlalık anon GRANT'ı
--   VAR; onun REVOKE'u PR-SQL-4 (bu PR davranış değiştirmez).
-- =====================================================================

-- ── 1. Tablo (canlı kolon/tip/null'a birebir) ────────────────────────
-- NOT: canlıda `updated_at` YOK → eklenmez (birebir temsil).
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid,
  action     text        NOT NULL,
  target     text        NOT NULL,
  before_val jsonb,
  after_val  jsonb,
  severity   text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Drift güvencesi (IF NOT EXISTS).
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_id   uuid;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action     text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS target     text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS before_val jsonb;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS after_val  jsonb;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS severity   text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- Sorgu index'leri (zaman + aktör) — additive, IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx   ON public.audit_logs (actor_id);

-- ── 2. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ── 3. Policies (canlıya birebir — yalnız super_admin) ──────────────
DROP POLICY IF EXISTS "superadmin_read_audit" ON public.audit_logs;
CREATE POLICY "superadmin_read_audit" ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin');

DROP POLICY IF EXISTS "superadmin_write_audit" ON public.audit_logs;
CREATE POLICY "superadmin_write_audit" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin');

-- ── 4. GRANT (gerekli — additive; anon'a YOK; REVOKE YOK) ───────────
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;  -- read/write audit policy'leri
GRANT ALL            ON public.audit_logs TO service_role;
-- anon: policy yok → GRANT verilmez (canlıdaki legacy anon grant PR-SQL-4'te REVOKE).

-- ── 5. Doğrulama (salt-okuma) ───────────────────────────────────────
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='audit_logs' ORDER BY grantee;
-- SELECT rowsecurity FROM pg_tables WHERE tablename='audit_logs';
-- SELECT policyname, roles, cmd FROM pg_policies WHERE tablename='audit_logs';
