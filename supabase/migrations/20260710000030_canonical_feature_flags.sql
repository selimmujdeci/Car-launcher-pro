-- =====================================================================
-- Car Launcher Pro — Kanonik: feature_flags  (PR-SQL-2)
-- Migration 030: canlı DB'de var olan `feature_flags` tablosunun kök
--   migration setinde KANONİK, FORWARD-ONLY, IDEMPOTENT karşılığı.
--
-- BAĞLAM: Bu tablo production'da website migration seti + out-of-band
--   uygulama sonucu OLUŞTU ama kök supabase/migrations'ta karşılığı yoktu
--   (bkz. docs/db/CANONICAL_SCHEMA_INVENTORY.md §2). Bu migration canlı
--   yapıyı BİREBİR temsil eder; DAVRANIŞ DEĞİŞTİRMEZ.
--
-- NON-DESTRUCTIVE: yalnızca CREATE/ADD IF NOT EXISTS + additive GRANT.
--   DROP/ALTER TYPE/REVOKE/backfill YOK → canlı veri ve şema bozulmaz.
--   (Canlıda uygulanırsa hepsi NO-OP: tablo/kolon/policy zaten var.)
--
-- ⚠️ KAPSAM SINIRLARI (bilinçli):
--   * anon `USING(true)` SELECT policy'si KORUNUR (davranış değişmez) —
--     scope daraltma PR-SQL-4 kapsamı.
--   * Legacy fazlalık anon GRANT'ları (DELETE/UPDATE/TRUNCATE) burada
--     REVOKE EDİLMEZ (REVOKE = canlı davranış değişikliği) → PR-SQL-4.
--     Bu migration yalnız "gerekli GRANT"ı (CLAUDE.md) additive ekler.
--
-- CLAUDE.md SUPABASE: GRANT + RLS + policy + verification burada.
-- =====================================================================

-- ── 1. Tablo (canlı kolon/tip/null'a birebir) ────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text        NOT NULL,
  name            text        NOT NULL,
  description     text        NOT NULL,
  enabled         boolean     NOT NULL,
  rollout_percent integer     NOT NULL,
  target_scope    text        NOT NULL,
  depends_on      text[]      NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

-- Drift güvencesi (tablo varsa eksik kolonu tamamla — hepsi IF NOT EXISTS).
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS key             text;
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS name            text;
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS description     text;
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS enabled         boolean;
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS rollout_percent integer;
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS target_scope    text;
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS depends_on      text[];
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS created_at      timestamptz;
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS updated_at      timestamptz;
ALTER TABLE public.feature_flags ADD COLUMN IF NOT EXISTS updated_by      uuid;

-- `key` benzersiz (flag anahtarı — uygulama key ile okur).
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_key_key ON public.feature_flags (key);

-- ── 2. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- ── 3. Policies (canlıya birebir — DAVRANIŞ DEĞİŞMEZ) ────────────────
-- anon: tüm flag'leri okur (USING(true)). ⚠️ scope daraltma PR-SQL-4.
DROP POLICY IF EXISTS "anon_read_flags" ON public.feature_flags;
CREATE POLICY "anon_read_flags" ON public.feature_flags
  FOR SELECT TO anon
  USING (true);

-- authenticated super_admin: tam yönetim (JWT app_metadata.role).
DROP POLICY IF EXISTS "superadmin_all_flags" ON public.feature_flags;
CREATE POLICY "superadmin_all_flags" ON public.feature_flags
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin');

-- ── 4. GRANT (gerekli — additive; REVOKE YOK) ───────────────────────
GRANT SELECT                         ON public.feature_flags TO anon;           -- anon_read_flags
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO authenticated;  -- superadmin_all_flags
GRANT ALL                            ON public.feature_flags TO service_role;

-- ── 5. Doğrulama (CLAUDE.md zorunlu — salt-okuma) ───────────────────
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='feature_flags' ORDER BY grantee;
-- SELECT rowsecurity FROM pg_tables WHERE tablename='feature_flags';           -- true beklenir
-- SELECT policyname, roles, cmd FROM pg_policies WHERE tablename='feature_flags';
-- SELECT to_regclass('public.feature_flags') IS NOT NULL AS exists;
