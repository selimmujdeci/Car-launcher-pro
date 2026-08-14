-- ============================================================
-- Remote Log v1 — vehicle_events super_admin okuma policy'si
--
-- SORUN: migration 012'nin SELECT policy'si yalnız vehicle_users
-- bağlantılı kullanıcıya satır gösterir. Admin paneli (HealthCenter,
-- IncidentLog viewer, RolloutCenter circuit breaker) super_admin
-- JWT'siyle vehicle_events okur — bağlı olmadığı araçların
-- system_health / critical_error / obd_diag / support_snapshot /
-- ota_event satırları RLS tarafından GİZLENİR → ekranlar boş kalır,
-- getRolloutHealth her zaman "sağlıklı" döner (yanlış güven).
--
-- ÇÖZÜM: super_admin'e SELECT policy'si. Rol kaynağı JWT
-- app_metadata (migration 018 deseni — service_role atar, kullanıcı
-- değiştiremez; SuperAdminGuard.tsx ile aynı claim).
--
-- NOT: Realtime (subscribeToLiveEvents) da RLS'e tabidir — bu policy
-- super_admin'in canlı event akışını da açar (publication'a tablo
-- eklenmiş olmalı: Dashboard → Database → Replication).
--
-- CLAUDE.md SUPABASE kuralları: GRANT + RLS + POLICY + verification.
-- ============================================================

-- ── 1. GRANT (idempotent — eksikse tamamlar) ─────────────────
-- Cihazlar tabloyu doğrudan KULLANMAZ (SECURITY DEFINER RPC yazar);
-- anon'a tablo GRANT'ı bilinçli olarak verilmez.
GRANT SELECT ON public.vehicle_events TO authenticated;
GRANT ALL    ON public.vehicle_events TO service_role;

-- ── 2. RLS açık kalır (012'de açıldı — regresyon değil, teyit) ─
ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;

-- ── 3. Policy — super_admin tüm araç olaylarını okur ─────────
DROP POLICY IF EXISTS "superadmin_select_vehicle_events" ON public.vehicle_events;
CREATE POLICY "superadmin_select_vehicle_events" ON public.vehicle_events
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin');

-- ── 4. Verification (CLAUDE.md zorunlu) ──────────────────────
DO $$
DECLARE
  rls_ok        boolean;
  policy_ok     boolean;
  grant_ok      boolean;
BEGIN
  SELECT rowsecurity INTO rls_ok
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'vehicle_events';
  IF NOT coalesce(rls_ok, false) THEN
    RAISE EXCEPTION 'superadmin read: vehicle_events RLS kapalı';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vehicle_events'
      AND policyname = 'superadmin_select_vehicle_events'
  ) INTO policy_ok;
  IF NOT policy_ok THEN
    RAISE EXCEPTION 'superadmin read: policy oluşmadı';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'vehicle_events'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'
  ) INTO grant_ok;
  IF NOT grant_ok THEN
    RAISE EXCEPTION 'superadmin read: authenticated SELECT GRANT eksik';
  END IF;

  -- 012 policy'leri duruyor mu (kullanıcı akışı kırılmadı teyidi)
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicle_events') < 3 THEN
    RAISE EXCEPTION 'superadmin read: 012 policy''leri kayıp görünüyor';
  END IF;

  RAISE NOTICE 'vehicle_events superadmin read: GRANT=OK policy=OK RLS=OK';
END $$;
