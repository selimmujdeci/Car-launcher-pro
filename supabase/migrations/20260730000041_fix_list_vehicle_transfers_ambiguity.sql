-- =====================================================================
-- Migration 041: `list_vehicle_transfers()` — 42702 BELİRSİZ KOLON ONARIMI
--
-- ⚠️  BU MIGRATION PRODUCTION'A UYGULANMADI (033–040 ile aynı durumda).
--
-- ── NEDEN VAR (gerçek cihazda ölçüldü) ──────────────────────────────
-- Telefon doğrulama koşumunda (2026-07-30, oturum FPV-20260729-2A9EE0E3)
-- sahiplik devri BAŞLATILABİLİYOR ama HEDEF TARAF hiçbir zaman kabul
-- edemiyordu: `/dashboard/fleet/transfer` ekranında "Size gelen devir
-- istekleri" listesi DAİMA boş kalıyor ve "Kabul et" düğmesi hiç
-- render edilmiyordu.
--
-- Kök neden PostgREST üzerinden hedef kullanıcının kendi JWT'siyle
-- doğrudan çağırınca ortaya çıktı:
--
--   POST /rest/v1/rpc/list_vehicle_transfers
--   → 42702  "column reference \"id\" is ambiguous"
--      details: "It could refer to either a PL/pgSQL variable or a table column."
--
-- `RETURNS TABLE (id uuid, vehicle_id uuid, ...)` çıkış kolonları
-- PL/pgSQL'de aynı adlı DEĞİŞKENLER üretir; gövdedeki sorgu bu adlarla
-- çakışıyor ve fonksiyon her çağrıda istisna atıyor. Yani devir zincirinin
-- OKUMA ucu 039'dan beri hiç çalışmamış; hata sessizdi çünkü 039 hiçbir
-- ortama uygulanmamıştı ve birim testler RPC'yi mock'luyordu.
--
-- ── ÇÖZÜM ───────────────────────────────────────────────────────────
-- Gövdeye `#variable_conflict use_column` yönergesi eklenir: çakışmada
-- KOLON kazanır. İmza, yetki mantığı, `SECURITY DEFINER`, sabit
-- `search_path` ve `LIMIT 100` sınırı DEĞİŞMEZ — davranış aynı kalır,
-- yalnız fonksiyon artık gerçekten çalışır.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'list_vehicle_transfers'
  ) THEN
    RAISE EXCEPTION '041 DURDU: migration 039 uygulanmamış (list_vehicle_transfers YOK)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.list_vehicle_transfers()
RETURNS TABLE (
  id uuid, vehicle_id uuid, from_owner_type text, to_owner_type text,
  status text, created_at timestamptz, expires_at timestamptz, failure_code text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;

  RETURN QUERY
    SELECT t.id, t.vehicle_id, t.from_owner_type, t.to_owner_type,
           t.status, t.created_at, t.expires_at, t.failure_code
      FROM public.vehicle_ownership_transfers t
     WHERE t.requested_by = v_uid
        OR (t.to_owner_type='INDIVIDUAL' AND t.to_owner_id = v_uid)
        OR (t.to_owner_type='COMPANY'    AND v_co IS NOT NULL AND t.to_owner_id = v_co)
        OR (t.from_owner_type='COMPANY'  AND v_co IS NOT NULL AND t.from_owner_id = v_co)
     ORDER BY t.created_at DESC
     LIMIT 100;   -- BOUNDED
END;
$fn$;

-- GRANT'lar korunur (CREATE OR REPLACE yetkileri düşürmez, yine de teyit).
REVOKE ALL ON FUNCTION public.list_vehicle_transfers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vehicle_transfers() TO authenticated, service_role;

-- ── DOĞRULAMA (fail-closed) ──────────────────────────────────────────
DO $$
DECLARE
  v_anon boolean;
  v_auth boolean;
  v_path boolean;
  v_def  boolean;
BEGIN
  SELECT has_function_privilege('anon','public.list_vehicle_transfers()','EXECUTE') INTO v_anon;
  IF v_anon THEN RAISE EXCEPTION '041 DOĞRULAMA DÜŞTÜ: anon EXECUTE var'; END IF;

  SELECT has_function_privilege('authenticated','public.list_vehicle_transfers()','EXECUTE') INTO v_auth;
  IF NOT v_auth THEN RAISE EXCEPTION '041 DOĞRULAMA DÜŞTÜ: authenticated EXECUTE YOK'; END IF;

  SELECT p.prosecdef INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='list_vehicle_transfers';
  IF NOT v_def THEN RAISE EXCEPTION '041 DOĞRULAMA DÜŞTÜ: SECURITY DEFINER kayboldu'; END IF;

  SELECT (p.proconfig IS NOT NULL AND array_to_string(p.proconfig,',') ILIKE '%search_path%') INTO v_path
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='list_vehicle_transfers';
  IF NOT v_path THEN RAISE EXCEPTION '041 DOĞRULAMA DÜŞTÜ: sabit search_path kayboldu'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='list_vehicle_transfers'
      AND pg_get_functiondef(p.oid) ILIKE '%variable_conflict use_column%'
  ) THEN
    RAISE EXCEPTION '041 DOĞRULAMA DÜŞTÜ: variable_conflict yönergesi gövdede yok';
  END IF;

  RAISE NOTICE '041 OK: list_vehicle_transfers belirsizlik onarıldı · anon kapalı · definer+search_path korundu.';
END $$;

COMMIT;

-- =====================================================================
-- FORWARD-FIX NOTU: yalnız fonksiyon gövdesine derleyici yönergesi ekler;
-- imza, yetki ve sorgu mantığı aynıdır. Geri alınırsa sahiplik devrinin
-- KABUL ucu yeniden çalışmaz hâle gelir (kütük #189).
-- =====================================================================
