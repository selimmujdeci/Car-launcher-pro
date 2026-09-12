-- ═══════════════════════════════════════════════════════════════════════════
-- 064 — ARAÇ BAKIM KAYITLARI (yakıt + servis)
--
-- ÖLÇÜLEN KUSUR (2026-08-14): "Arabam Cebimde" → Kayıtlar sekmesi (Yakıt
-- Takibi · Servis Takibi) **tamamen `localStorage`**tı. Üç somut sonuç:
--   1. Kayıtlar hiçbir yere gitmiyordu — telefon değişince/tarayıcı verisi
--      temizlenince **tamamen kayboluyordu**.
--   2. Depo anahtarı SABİTTİ (`caros_fuel_log`) → araç bazlı DEĞİLDİ; iki
--      araç eşleştiren kullanıcıda kayıtlar **birbirine karışıyordu**.
--   3. Araç tarafındaki OBD kilometresi ve yakıt seviyesiyle hiçbir bağı
--      yoktu; bakım tahminleri bu veriden BESLENEMİYORDU.
--
-- BU MIGRATION YALNIZ DEPOYU KURAR. Bakım tahmini, hatırlatma, maliyet
-- analizi ve OBD ile eşleştirme bu pakette YOKTUR — kurulan tek şey
-- kalıcı, araç kapsamlı, tenant güvenli bir kayıt defteridir.
--
-- ── DÜRÜSTLÜK KARARLARI ──────────────────────────────────────────────────
--  · `odometer_km` NULLABLE'dır: kullanıcı kilometreyi bilmiyorsa **uydurma
--    0 yazılmaz**. Sorgu tarafı "bilinmiyor"u ayırt edebilmelidir.
--  · `source` kolonu kaydın NEREDEN geldiğini taşır (`MANUAL` = kullanıcı
--    girdi). İleride OBD türevi kayıt eklenirse ayırt edilebilsin diye
--    şimdiden ayrıldı — türetilmiş veri elle girilmiş gibi gösterilemez.
--  · `client_ref` idempotency anahtarıdır: çevrimdışı kuyruk aynı kaydı
--    iki kez gönderirse ikinci yazma **çakışır ve yok sayılır**.
--
-- ── GÜVENLİK ─────────────────────────────────────────────────────────────
--  · `anon` rolünden TÜM ayrıcalıklar geri alınır (Supabase varsayılanı
--    tehlikelidir — bkz. 037).
--  · RLS: kullanıcı yalnız KENDİ eşleştirdiği araçların kaydını görebilir
--    ve yazabilir (`vehicle_users` bağı) veya kendi şirketinin aracıysa.
--  · Head unit (`service_role`) tam erişimlidir — araç tarafı ileride
--    OBD türevi kayıt yazabilsin diye.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Ön koşul: bağlı olduğumuz tablolar var mı (fail-closed) ────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='vehicles') THEN
    RAISE EXCEPTION '064 ÖN KOŞUL: public.vehicles yok.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='vehicle_users') THEN
    RAISE EXCEPTION '064 ÖN KOŞUL: public.vehicle_users yok (003 uygulanmamış).';
  END IF;
END $$;

-- ── 1. YAKIT KAYITLARI ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_fuel_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  /* Kaydı GİREN kullanıcı. Araç devredilirse kayıt araçta kalır (tarih
     aracın geçmişidir), ama kimin girdiği izlenebilir olmalıdır. */
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  /* Dolum TARİHİ — kullanıcı geriye dönük kayıt girebilir, bu yüzden
     `created_at`ten AYRIDIR. */
  filled_on       date NOT NULL,

  /* Kilometre: bilinmiyorsa NULL. Sahte 0 YAZILMAZ. */
  odometer_km     integer CHECK (odometer_km IS NULL OR (odometer_km >= 0 AND odometer_km <= 3000000)),

  liters          numeric(8,2) NOT NULL CHECK (liters > 0 AND liters <= 500),
  price_per_liter numeric(10,2) CHECK (price_per_liter IS NULL OR price_per_liter >= 0),
  currency        text NOT NULL DEFAULT 'TRY' CHECK (char_length(currency) = 3),

  /* Kaydın kaynağı — elle girilen ile türetilen karıştırılmaz. */
  source          text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','OBD_DERIVED','IMPORTED')),

  /* Çevrimdışı kuyruk idempotency anahtarı. */
  client_ref      text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_fuel_logs_vehicle_idx
  ON public.vehicle_fuel_logs (vehicle_id, filled_on DESC);

-- Aynı istemci referansı araç başına BİR kez yazılabilir (çift gönderim koruması).
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_fuel_logs_client_ref_uidx
  ON public.vehicle_fuel_logs (vehicle_id, client_ref)
  WHERE client_ref IS NOT NULL;

-- ── 2. SERVİS KAYITLARI ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_service_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  /* Servis kalemi anahtarı (oil · tires · brakes · filter · ac · timing …).
     Serbest metin DEĞİL ama enum da değil: ürün listesi zamanla genişler,
     bilinmeyen anahtar veriyi düşürmez — yalnız uzunluk sınırlanır. */
  service_key   text NOT NULL CHECK (char_length(service_key) BETWEEN 2 AND 40),

  performed_on  date NOT NULL,
  odometer_km   integer CHECK (odometer_km IS NULL OR (odometer_km >= 0 AND odometer_km <= 3000000)),
  note          text CHECK (note IS NULL OR char_length(note) <= 500),

  source        text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','OBD_DERIVED','IMPORTED')),
  client_ref    text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_service_records_vehicle_idx
  ON public.vehicle_service_records (vehicle_id, performed_on DESC);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_service_records_client_ref_uidx
  ON public.vehicle_service_records (vehicle_id, client_ref)
  WHERE client_ref IS NOT NULL;

-- ── 3. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.vehicle_fuel_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_service_records ENABLE ROW LEVEL SECURITY;

-- ── 4. GRANT — anon KİLİTLİ ───────────────────────────────────────────────
REVOKE ALL ON TABLE public.vehicle_fuel_logs       FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.vehicle_service_records FROM anon, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_fuel_logs       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_service_records TO authenticated;

GRANT ALL ON TABLE public.vehicle_fuel_logs       TO service_role;
GRANT ALL ON TABLE public.vehicle_service_records TO service_role;

-- ── 5. POLICY — yalnız kullanıcının eşleştirdiği/şirketine ait araçlar ────
--
-- Erişim iki yoldan gelebilir: (a) cihaz eşleştirmesi (`vehicle_users`),
-- (b) şirket sahipliği (`vehicles.company_id` = kullanıcının şirketi).
-- İkisi de yoksa satır GÖRÜNMEZ (fail-closed, cross-tenant sızıntı yok).

CREATE OR REPLACE FUNCTION public.user_can_access_vehicle(p_vehicle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_users vu
     WHERE vu.vehicle_id = p_vehicle_id AND vu.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.vehicles v
     JOIN public.profiles p ON p.id = auth.uid()
     WHERE v.id = p_vehicle_id
       AND v.company_id IS NOT NULL
       AND v.company_id = p.company_id
  );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_vehicle(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_vehicle(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS vfl_access ON public.vehicle_fuel_logs;
CREATE POLICY vfl_access ON public.vehicle_fuel_logs
  FOR ALL TO authenticated
  USING      (public.user_can_access_vehicle(vehicle_id))
  WITH CHECK (public.user_can_access_vehicle(vehicle_id));

DROP POLICY IF EXISTS vsr_access ON public.vehicle_service_records;
CREATE POLICY vsr_access ON public.vehicle_service_records
  FOR ALL TO authenticated
  USING      (public.user_can_access_vehicle(vehicle_id))
  WITH CHECK (public.user_can_access_vehicle(vehicle_id));

COMMIT;

-- ── 6. DOĞRULAMA (fail-closed) ────────────────────────────────────────────
DO $$
DECLARE
  v_anon int;
  v_auth int;
BEGIN
  -- RLS gerçekten açık mı
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname='public'
      AND tablename IN ('vehicle_fuel_logs','vehicle_service_records')
      AND rowsecurity = false
  ) THEN
    RAISE EXCEPTION '064 DOĞRULAMA: RLS kapalı kalmış.';
  END IF;

  -- anon ayrıcalığı SIFIR olmalı
  SELECT count(*) INTO v_anon
  FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND table_name IN ('vehicle_fuel_logs','vehicle_service_records')
    AND grantee='anon';
  IF v_anon <> 0 THEN
    RAISE EXCEPTION '064 DOĞRULAMA: anon ayrıcalığı var (%). Veri anonim internete açık olurdu.', v_anon;
  END IF;

  -- authenticated dört ayrıcalığı da almalı (iki tablo × 4)
  SELECT count(*) INTO v_auth
  FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND table_name IN ('vehicle_fuel_logs','vehicle_service_records')
    AND grantee='authenticated'
    AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');
  IF v_auth <> 8 THEN
    RAISE EXCEPTION '064 DOĞRULAMA: authenticated ayrıcalıkları eksik (%/8).', v_auth;
  END IF;

  -- Politikalar var mı
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public'
        AND tablename IN ('vehicle_fuel_logs','vehicle_service_records')) < 2 THEN
    RAISE EXCEPTION '064 DOĞRULAMA: politika eksik.';
  END IF;

  RAISE NOTICE '064 DOĞRULAMA: RLS açık · anon 0 · authenticated 8/8 · politika var';
END $$;
