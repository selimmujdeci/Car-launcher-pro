-- =====================================================================
-- 065-P7: `user_can_access_vehicle()` PROD'UN GERÇEK SAHİPLİK MODELİNİ TANIR
--
-- ── NEDEN (prod'dan SALT-OKUNUR ölçüldü) ─────────────────────────────
-- Migration 064 bakım/yakıt kayıtlarının RLS kapısını `user_can_access_vehicle()`
-- ile kurar ve o fonksiyon erişimi İKİ yoldan tanır:
--     (a) public.vehicle_users bağı      (b) profiles.company_id eşleşmesi
-- Ama **prod'da `vehicle_users` tablosu YOKTUR** (onu yaratan 003 canlıya hiç
-- uygulanmadı) ve prod'un kullanıcı↔araç bağı şudur:
--     · vehicles.owner_id = auth.uid()                (bireysel sahiplik)
--     · public.vehicle_pairings (user_id, vehicle_id) (eşleştirme)
-- Nitekim prod'un `vehicles` tablosundaki CANLI politikalar da tam olarak bu
-- üç yolu kullanır: `owner_id = auth.uid() OR company_id = auth_company_id()
-- OR is_paired(auth.uid(), id)`.
--
-- ── DÜZELTİLMEZSE NE OLUR (ölü özellik) ──────────────────────────────
-- 065-P6 `vehicle_users`'ı kurar ama tablo **BOŞTUR**. Kişisel aracı olan bir
-- kullanıcı (`company_id IS NULL`) için 064'ün iki yolu da FALSE döner →
-- **araç sahibi kendi yakıt/servis kaydını ne yazabilir ne okuyabilir.**
-- Ekran "Hesabınıza kayıtlı" demeye çalışır, her yazma `42501` ile düşer.
--
-- ── BU DOSYA NE YAPAR ────────────────────────────────────────────────
-- Fonksiyona prod'un GERÇEK iki yolunu EKLER. Mevcut iki yol KALDIRILMAZ
-- (064'ün sözleşmesi korunur) — bu bir GENİŞLETMEDİR, daraltma değil.
--
-- ── GÜVENLİK GEREKÇESİ (yeni otorite KURULMUYOR) ─────────────────────
-- Eklenen iki yol, prod'da `vehicles` tablosunun ZATEN kullandığı erişim
-- otoritesidir; yeni bir sahiplik kavramı icat edilmiyor. Fonksiyon
-- `SECURITY DEFINER` DEĞİLDİR (064'teki gibi kalır) → alt sorgular çağıranın
-- RLS'i altında koşar: `vehicles` ve `vehicle_pairings` politikaları ikinci bir
-- kapı olarak yürürlüktedir. Yani bu değişiklik, kullanıcının ZATEN görebildiği
-- araçların ötesine geçemez.
--
-- İDEMPOTENT (CREATE OR REPLACE) · veri yazmaz · politika/GRANT değiştirmez.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.user_can_access_vehicle(uuid)') IS NULL THEN
    RAISE EXCEPTION '065-P7 ÖN KOŞUL: user_can_access_vehicle(uuid) yok — 064 uygulanmamış';
  END IF;
  IF to_regclass('public.vehicle_pairings') IS NULL THEN
    RAISE EXCEPTION '065-P7 ÖN KOŞUL: public.vehicle_pairings yok — yanlış şema';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='vehicles' AND column_name='owner_id') THEN
    RAISE EXCEPTION '065-P7 ÖN KOŞUL: vehicles.owner_id yok — yanlış şema';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.user_can_access_vehicle(p_vehicle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- (a) cihaz eşleştirmesi — 064'ün özgün yolu
  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_users vu
     WHERE vu.vehicle_id = p_vehicle_id AND vu.user_id = auth.uid()
  )
  -- (b) şirket eşleşmesi — 064'ün özgün yolu
  OR EXISTS (
    SELECT 1 FROM public.vehicles v
     JOIN public.profiles p ON p.id = auth.uid()
     WHERE v.id = p_vehicle_id
       AND v.company_id IS NOT NULL
       AND v.company_id = p.company_id
  )
  -- (c) BİREYSEL SAHİPLİK — prod'un gerçek yolu (vehicles politikalarıyla aynı)
  OR EXISTS (
    SELECT 1 FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.owner_id = auth.uid()
  )
  -- (d) EŞLEŞTİRME — prod'un gerçek yolu (is_paired ile aynı kaynak)
  OR EXISTS (
    SELECT 1 FROM public.vehicle_pairings vp
     WHERE vp.vehicle_id = p_vehicle_id AND vp.user_id = auth.uid()
  );
$function$;

-- ── DOĞRULAMA (fail-closed) ──────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.user_can_access_vehicle(uuid)')) INTO v_def;

  IF v_def NOT LIKE '%vehicle_users%'  THEN RAISE EXCEPTION '065-P7 DOĞRULAMA: (a) cihaz eşleştirme yolu KAYBOLDU'; END IF;
  IF v_def NOT LIKE '%p.company_id%'   THEN RAISE EXCEPTION '065-P7 DOĞRULAMA: (b) şirket yolu KAYBOLDU'; END IF;
  IF v_def NOT LIKE '%owner_id%'       THEN RAISE EXCEPTION '065-P7 DOĞRULAMA: (c) sahiplik yolu eklenmedi'; END IF;
  IF v_def NOT LIKE '%vehicle_pairings%' THEN RAISE EXCEPTION '065-P7 DOĞRULAMA: (d) eşleştirme yolu eklenmedi'; END IF;
  IF v_def LIKE '%SECURITY DEFINER%'   THEN RAISE EXCEPTION '065-P7 DOĞRULAMA: DEFINER''a çevrilmiş — çağıranın RLS kapısı kalkardı'; END IF;
  IF v_def NOT LIKE '%search_path%'    THEN RAISE EXCEPTION '065-P7 DOĞRULAMA: search_path sabitlenmemiş'; END IF;

  -- 064'ün politikaları hâlâ bu fonksiyona bağlı mı (kapı yerinde mi)
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='vehicle_fuel_logs'
                    AND policyname='vfl_access' AND qual LIKE '%user_can_access_vehicle%') THEN
    RAISE EXCEPTION '065-P7 DOĞRULAMA: vfl_access politikası kapıyı kullanmıyor';
  END IF;

  RAISE NOTICE '065-P7 OK: erişim fonksiyonu dört yolu tanıyor (cihaz · şirket · sahiplik · eşleştirme)';
END $$;

COMMIT;
