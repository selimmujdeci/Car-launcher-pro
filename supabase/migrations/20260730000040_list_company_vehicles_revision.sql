-- =====================================================================
-- Migration 040: `list_company_vehicles()` ARAÇ REVİZYONUNU DÖNDÜRÜR
--
-- ⚠️  BU MIGRATION PRODUCTION'A UYGULANMADI (033–039 ile aynı durumda).
--     Yerel/geçici PostgreSQL'de doğrulanmak üzere hazırlanmıştır.
--
-- ── NEDEN VAR (telefonda ölçülen kusur) ─────────────────────────────
-- Migration 039 sahiplik devrine **iyimser eşzamanlılık kapısı** koydu:
-- `start_vehicle_transfer(..., p_expected_revision)` ve
-- `accept_vehicle_transfer` araç arada değiştiyse FAIL-CLOSED reddeder.
-- Kapının girdisi `public.vehicles.revision`'dır.
--
-- Ancak filo araçlarının TEK okuma yüzeyi olan `list_company_vehicles()`
-- (migration 036) bu alanı DÖNDÜRMÜYORDU. Sonuç, gerçek cihazda ölçüldü
-- (2026-07-30, oturum FPV-20260729-2A9EE0E3, kütük #189):
--
--   · `/api/company/vehicles` → {vehicle_id, name, plate, owner_id, last_seen}
--   · Devir ekranı `readRevision()` ile `revision` arıyor → `null`
--   · `canStartTransfer` → `UNKNOWN_REVISION` → devir HİÇ BAŞLAMIYOR
--   · Sunucuda `vehicle_ownership_transfers` count = 0
--   · Kullanıcıya "Araç bilgisi güncel değil. Sayfayı yenileyip tekrar
--     deneyin." deniyordu — YENİLEMEK ASLA İŞE YARAMAZ, çünkü alan hiç
--     dönmüyordu. Yani sahiplik devri ürün olarak KULLANILAMAZ durumdaydı.
--
-- ── NEDEN İSTEMCİ TARAFI ÇÖZÜM SEÇİLMEDİ ────────────────────────────
-- Devir ekranının `vehicles` tablosunu doğrudan okuması da mümkündü, ama
-- bu filo araçları için İKİNCİ bir okuma yüzeyi (dolayısıyla ikinci
-- kapsam/otorite) yaratırdı. RPC hâlâ tek otorite olarak kalır ve alan
-- oraya eklenir.
--
-- ── SÖZLEŞME DEĞİŞİKLİĞİ ────────────────────────────────────────────
-- `RETURNS TABLE` imzası değiştiği için `CREATE OR REPLACE` YETMEZ →
-- fonksiyon DROP edilip yeniden yaratılır ve GRANT'ları YENİDEN verilir
-- (aksi hâlde `authenticated` EXECUTE yetkisi kaybolur ve filo araç
-- listesi 500 döner). Kolon SONA eklenir; mevcut alan sırası korunur.
--
-- GÜVENLİK: kapsam mantığı, `SECURITY DEFINER`, sabit `search_path`,
-- `unauthenticated`/`no_company` fail-closed davranışı ve anon yasağı
-- **birebir korunur**. Yeni alan yalnız bir tamsayı sayaçtır; PII değildir.
-- =====================================================================

BEGIN;

-- ── 0. ÖN KOŞULLAR (fail-closed) ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'list_company_vehicles'
  ) THEN
    RAISE EXCEPTION '040 DURDU: migration 036 uygulanmamış (list_company_vehicles YOK)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'revision'
  ) THEN
    RAISE EXCEPTION '040 DURDU: migration 039 uygulanmamış (vehicles.revision YOK)';
  END IF;
END $$;

-- ── 1. İMZA DEĞİŞİKLİĞİ ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.list_company_vehicles();

CREATE FUNCTION public.list_company_vehicles()
RETURNS TABLE (
  vehicle_id uuid,
  name       text,
  plate      text,
  owner_id   uuid,
  last_seen  timestamptz,
  -- YENİ: 039'un iyimser eşzamanlılık kapısının girdisi.
  revision   bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;
  IF v_co IS NULL THEN RAISE EXCEPTION 'no_company' USING ERRCODE='P0001'; END IF;

  RETURN QUERY
    SELECT v.id, v.name, v.plate, v.owner_id, v.last_seen, v.revision
    FROM public.vehicles v
    WHERE v.company_id = v_co
    ORDER BY v.created_at;
END;
$function$;

-- ── 2. GRANT'LAR YENİDEN (DROP hepsini sildi) ────────────────────────
REVOKE ALL ON FUNCTION public.list_company_vehicles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_company_vehicles() TO authenticated, service_role;

-- ── 3. DOĞRULAMA (fail-closed) ───────────────────────────────────────
DO $$
DECLARE
  v_has_rev  int;
  v_anon     boolean;
  v_auth     boolean;
  v_definer  boolean;
  v_path     boolean;
BEGIN
  -- Dönüş kümesi doğrudan katalogdan okunur (`information_schema.parameters`
  -- TABLE kolonlarını taşınabilir biçimde vermiyor — ölçüldü: 0 satır).
  SELECT count(*) INTO v_has_rev
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'list_company_vehicles'
    AND pg_get_function_result(p.oid) ILIKE '%revision bigint%';
  IF v_has_rev < 1 THEN
    RAISE EXCEPTION '040 DOĞRULAMA DÜŞTÜ: list_company_vehicles revision döndürmüyor';
  END IF;

  SELECT has_function_privilege('anon', 'public.list_company_vehicles()', 'EXECUTE')
    INTO v_anon;
  IF v_anon THEN
    RAISE EXCEPTION '040 DOĞRULAMA DÜŞTÜ: anon EXECUTE yetkisi var (R4 ihlali)';
  END IF;

  SELECT has_function_privilege('authenticated', 'public.list_company_vehicles()', 'EXECUTE')
    INTO v_auth;
  IF NOT v_auth THEN
    RAISE EXCEPTION '040 DOĞRULAMA DÜŞTÜ: authenticated EXECUTE yetkisi YOK (filo listesi kırılır)';
  END IF;

  SELECT p.prosecdef INTO v_definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'list_company_vehicles';
  IF NOT v_definer THEN
    RAISE EXCEPTION '040 DOĞRULAMA DÜŞTÜ: SECURITY DEFINER kayboldu';
  END IF;

  SELECT (p.proconfig IS NOT NULL
          AND array_to_string(p.proconfig, ',') ILIKE '%search_path%') INTO v_path
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'list_company_vehicles';
  IF NOT v_path THEN
    RAISE EXCEPTION '040 DOĞRULAMA DÜŞTÜ: sabit search_path kayboldu';
  END IF;

  RAISE NOTICE '040 OK: list_company_vehicles revision döndürüyor · anon kapalı · authenticated açık · definer+search_path korundu.';
END $$;

COMMIT;

-- =====================================================================
-- FORWARD-FIX NOTU (rollback yerine):
-- Bu migration yalnız bir OKUMA fonksiyonunun dönüş kümesine tamsayı bir
-- alan ekler; veri YAZMAZ, kolon/kısıt DEĞİŞTİRMEZ. Geri almak gerekirse
-- 036'daki imza aynı DROP + CREATE deseniyle geri yazılır — ama o zaman
-- sahiplik devri yeniden KULLANILAMAZ hâle gelir (kütük #189).
-- =====================================================================
