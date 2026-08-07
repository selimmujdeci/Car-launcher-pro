-- ═══════════════════════════════════════════════════════════════════════════
-- 044 — KİMLİK OKUMA RPC'SİNİN KAPSAM ÇÖZÜMÜNÜ ONAR
--
-- YALNIZ İLERİ MIGRATION. 033–043 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── ONARILAN GERÇEK KUSUR (ölçüldü, varsayım değil) ──────────────────────
-- 042 ve 043'te yazdığım `list_company_vehicle_identity()` şirket kapsamını
-- **var olmayan** `public.company_members` tablosundan çözmeye çalışıyordu:
--
--     SELECT company_id INTO v_co FROM public.company_members WHERE user_id = ...
--
-- Bu tablo bu şemada HİÇ YOK. Üyelik `public.profiles.company_id` +
-- `profiles.role` üzerinde tutulur (033'ten beri; `list_company_vehicles`
-- 036'dan beri doğru deseni kullanıyor). Sonuç: oturumlu HER kullanıcı için
-- fonksiyon `42P01 relation "public.company_members" does not exist` ile
-- düşüyordu → Fleet UI'da araç kimliği HİÇ görünemezdi.
--
-- NEDEN 042/043 DOĞRULAMASI BUNU YAKALAMADI: o turdaki kontroller
-- fonksiyonun GÖVDE METNİNİ inceliyordu (`pg_get_functiondef ... LIKE`) ve
-- oturumsuz çağrıyı sınıyordu. Oturumsuz çağrı `auth.uid() IS NULL` dalında
-- ERKEN DÖNÜYOR, yani hatalı satıra HİÇ ULAŞMIYORDU. Ders: fonksiyon
-- GERÇEK bir oturumla ÇALIŞTIRILMADAN "hazır" sayılamaz.
--
-- ── DEĞİŞMEYENLER ────────────────────────────────────────────────────────
--   · VIN yine MASKELİ döner (`•••` + son 6) · parmak izi ilk 12 karakter
--   · `anon` erişimi REVOKE · SECURITY DEFINER + sabit search_path
--   · Sahiplik otoritesi DEĞİŞMEZ: kapsam `owner_id` veya şirket eşleşmesi
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.list_company_vehicle_identity();

CREATE OR REPLACE FUNCTION public.list_company_vehicle_identity()
RETURNS TABLE (
  vehicle_id uuid, vin_masked text, vin_source text, vin_observed_at timestamptz,
  make text, model text, model_year smallint,
  fingerprint_hash_short text, fingerprint_version text,
  active_obd_protocol text, vehicle_generation text,
  identity_confidence numeric, identity_revision integer,
  identity_updated_at timestamptz, identity_conflict_count integer,
  last_conflict_reason text, protocol_change_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  -- Oturum yok → satır yok (fail-closed; istisna FIRLATILMAZ ki UI ham
  -- hata metni göstermek zorunda kalmasın).
  IF v_uid IS NULL THEN RETURN; END IF;

  -- ✅ DOĞRU KAPSAM KAYNAĞI: `profiles.company_id`
  -- (`list_company_vehicles` 036'dan beri bu deseni kullanıyor).
  -- Şirkete bağlı olmayan kullanıcı da KENDİ araçlarını görebilir → burada
  -- istisna FIRLATILMAZ, yalnız şirket dalı boş kalır.
  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;

  RETURN QUERY
  SELECT i.vehicle_id,
         -- HAM VIN DÖNMEZ: yalnız son 6 hane.
         CASE WHEN i.vin IS NULL THEN NULL ELSE '•••' || right(i.vin, 6) END,
         i.vin_source, i.vin_observed_at, i.make, i.model, i.model_year,
         -- Ham hash DÖNMEZ: yalnız ilk 12 karakter.
         CASE WHEN i.fingerprint_hash IS NULL THEN NULL
              ELSE left(i.fingerprint_hash, 12) END,
         i.fingerprint_version, i.active_obd_protocol, i.vehicle_generation,
         i.identity_confidence, i.identity_revision, i.identity_updated_at,
         i.identity_conflict_count, i.last_conflict_reason, i.protocol_change_count
    FROM public.vehicle_identity i
    JOIN public.vehicles v ON v.id = i.vehicle_id
   WHERE v.owner_id = v_uid
      OR (v_co IS NOT NULL AND v.company_id = v_co)
   ORDER BY i.identity_updated_at DESC
   LIMIT 200;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_company_vehicle_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_company_vehicle_identity()
  TO authenticated, service_role;

-- ── DOĞRULAMA (fail-closed) ─────────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='list_company_vehicle_identity' LIMIT 1;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '044 HATA: list_company_vehicle_identity yok';
  END IF;

  -- (a) Var olmayan tabloya referans KALMAMIŞ olmalı.
  IF v_def LIKE '%company_members%' THEN
    RAISE EXCEPTION '044 HATA: company_members referansi hala var (42P01 kusuru acik)';
  END IF;

  -- (b) Kapsam DOGRU kaynaktan cozulmeli.
  IF v_def NOT LIKE '%FROM public.profiles%' THEN
    RAISE EXCEPTION '044 HATA: kapsam profiles.company_id uzerinden cozulmuyor';
  END IF;

  -- (c) Maskeleme DURUYOR olmali.
  IF v_def NOT LIKE '%right(i.vin, 6)%' THEN
    RAISE EXCEPTION '044 HATA: ham VIN donuyor (maskeleme yok)';
  END IF;

  -- (d) DEFINER + sabit search_path.
  IF v_def NOT LIKE '%SECURITY DEFINER%' OR v_def NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION '044 HATA: DEFINER/search_path eksik';
  END IF;

  -- (e) anon CALISTIRAMAMALI.
  IF has_function_privilege('anon','public.list_company_vehicle_identity()','EXECUTE') THEN
    RAISE EXCEPTION '044 HATA: anon kimlik okuma yetkisi acik';
  END IF;

  -- (f) Referans verilen tablolar GERCEKTEN var olmali (42P01 bir daha olmasin).
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='profiles') THEN
    RAISE EXCEPTION '044 HATA: public.profiles yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='vehicle_identity') THEN
    RAISE EXCEPTION '044 HATA: public.vehicle_identity yok';
  END IF;

  RAISE NOTICE '044 OK: kapsam profiles.company_id uzerinden · maskeleme duruyor · anon kapali.';
END $$;

COMMIT;
