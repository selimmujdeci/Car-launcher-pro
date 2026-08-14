-- =====================================================================
-- 065-P6: `public.vehicle_users` SÖZLEŞMESİ — migration 064'ün ÖN KOŞULU
--
-- ── NEDEN (prod'dan SALT-OKUNUR ölçüldü) ─────────────────────────────
-- `20260814000064_vehicle_maintenance_records.sql` fail-closed bir ön koşul
-- taşır:
--     RAISE EXCEPTION '064 ÖN KOŞUL: public.vehicle_users yok (003 uygulanmamış).'
-- Bu tabloyu eski kök zincirin `20260421000003_device_linking.sql`'i yaratırdı;
-- ama o migration **canlıya HİÇ uygulanmadı** (prod'un migration defterinde de
-- yok, tabloları da yok). Prod'un kullanıcı↔araç bağı `vehicles.owner_id` ve
-- `vehicle_pairings` üzerinden kuruludur.
--
-- ── KARAR ────────────────────────────────────────────────────────────
-- 064 DEĞİŞTİRİLMEZ (sözleşmesi korunur): tablo, 003'teki tanımıyla BİREBİR
-- kurulur. Prod'un GERÇEK sahiplik yolları ise 064'ten SONRA gelen
-- `20260814000065_vehicle_access_prod_ownership.sql` ile erişim fonksiyonuna
-- eklenir — yoksa boş bir `vehicle_users` yüzünden araç SAHİBİ kendi bakım
-- kaydını göremezdi (sessiz ölü özellik).
--
-- ── KAPSAM (bilinçli olarak DAR) ─────────────────────────────────────
-- 003'ün YALNIZ `vehicle_users` parçası alınır. 003'ün diğer nesneleri
-- (`events` tablosu · `vehicles` üzerindeki `user_select_linked_devices`
-- politikası · `is_super_admin()` bağımlı `super_admin_vehicle_users`
-- politikası) **kurulmaz** — prod'da yokturlar, `is_super_admin()` prod'da
-- tanımlı DEĞİLDİR ve `vehicles` politikalarını genişletmek bu turun konusu
-- değildir.
--
-- İDEMPOTENT · veri yazmaz · mevcut hiçbir nesneyi değiştirmez.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicle_users (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users (id)      ON DELETE CASCADE,
  vehicle_id  uuid        NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  role        text        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS vehicle_users_user_id_idx    ON public.vehicle_users (user_id);
CREATE INDEX IF NOT EXISTS vehicle_users_vehicle_id_idx ON public.vehicle_users (vehicle_id);

ALTER TABLE public.vehicle_users ENABLE ROW LEVEL SECURITY;

-- anon'un bu tabloda hiçbir meşru kullanımı yok (defense-in-depth; Supabase'in
-- varsayılan ayrıcalıkları aksi hâlde anon'a tam erişim verir).
REVOKE ALL ON TABLE public.vehicle_users FROM anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.vehicle_users TO authenticated;
GRANT ALL    ON TABLE public.vehicle_users TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='vehicle_users' AND policyname='user_select_own_links') THEN
    CREATE POLICY "user_select_own_links" ON public.vehicle_users
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='vehicle_users' AND policyname='user_insert_own_links') THEN
    CREATE POLICY "user_insert_own_links" ON public.vehicle_users
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='vehicle_users' AND policyname='user_delete_own_links') THEN
    CREATE POLICY "user_delete_own_links" ON public.vehicle_users
      FOR DELETE TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- ── DOĞRULAMA (fail-closed) ──────────────────────────────────────────
DO $$
DECLARE v_pol int;
BEGIN
  IF to_regclass('public.vehicle_users') IS NULL THEN
    RAISE EXCEPTION '065-P6 DOĞRULAMA: vehicle_users kurulamadı';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='vehicle_users' AND rowsecurity) THEN
    RAISE EXCEPTION '065-P6 DOĞRULAMA: RLS kapalı';
  END IF;
  IF has_table_privilege('anon','public.vehicle_users','SELECT') THEN
    RAISE EXCEPTION '065-P6 DOĞRULAMA: anon okuyabiliyor';
  END IF;
  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE schemaname='public' AND tablename='vehicle_users';
  IF v_pol < 3 THEN
    RAISE EXCEPTION '065-P6 DOĞRULAMA: politika eksik (%)', v_pol;
  END IF;
  RAISE NOTICE '065-P6 OK: vehicle_users sözleşmesi kuruldu (064 ön koşulu karşılandı)';
END $$;

COMMIT;
