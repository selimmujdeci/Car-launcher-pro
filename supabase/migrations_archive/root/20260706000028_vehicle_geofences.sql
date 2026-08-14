-- =====================================================================
-- Migration 028: vehicle_geofences — bulut geofence (güvenli bölge) senkronu
--
-- BAĞLAM (2026-07-06):
--   İki paralel geofence sistemi vardı:
--     1. src/platform/geofenceService.ts (YEREL) — SecuritySuite'e bağlı,
--        zone'ları sensitiveKeyStore'da yerelde saklar. Reinstall'da kaybolur.
--     2. src/platform/security/geofenceService.ts (SUPABASE) — vehicle_geofences
--        tablosunu okuyup worker'a iter. Tablo deploy EDİLMEMİŞTİ → boot'ta her
--        seferinde PGRST205; YAZMA YOLU HİÇ YOKTU.
--
-- KARAR: "Head unit yukarı senkronlar" — sürücü SecuritySuite'te bölge tanımlar
--   → api_key auth'lu RPC ile bu tabloya yazılır → head unit tekrar OKUR
--   → worker denetler. Reinstall'da kaybolmaz.
--
-- 🔒 MAHREMİYET (KRİTİK — konum verisi):
--   Ev/park konumu son derece hassastır. anon rolüne tabloya DOĞRUDAN erişim
--   VERİLMEZ ve USING(true) policy YAZILMAZ — aksi halde bir aracın api_key'i
--   olan biri TÜM araçların ev/park koordinatlarını okuyabilirdi. anon YALNIZ
--   SECURITY DEFINER RPC üzerinden erişir; RPC api_key'i vehicles.id'ye çözer ve
--   YALNIZ o aracın kendi bölgelerini döndürür → satır-bazlı mahremiyet RPC
--   içinde zorlanır (WHERE vehicle_id = <çözülen id>).
--
-- ŞEMA SAPMASI (bilinçli, mevcut hatla tutarlı):
--   public.vehicle_events.vehicle_id kolonu canlıda TEXT (elle kurulmuş şema;
--   migration 025/026). vehicle_geofences.vehicle_id de TEXT tutulur ve
--   vehicles.id (uuid) insert/okumada ::text cast edilir — push_vehicle_event
--   026 ile birebir aynı yaklaşım.
--
-- CLAUDE.md SUPABASE dörtlüsü: GRANT + RLS ENABLE + POLICY + verification.
-- İdempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--   DROP POLICY IF EXISTS. Bu dosya canlı DB ile senkron tutulabilir.
--
-- NOT: Bu dosya CANLIYA HENÜZ UYGULANMADI (kullanıcı Management API / db push
--   ile uygular). Dosya yalnız repoyu hedef şema ile senkron tutar.
-- =====================================================================

-- ── 1. Tablo ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_geofences (
  id          text        NOT NULL,                                   -- client-üretimli ('default' veya uuid)
  vehicle_id  text        NOT NULL,                                   -- TEXT: vehicle_events sapmasıyla tutarlı
  name        text,
  type        text        CHECK (type IN ('polygon', 'circle')),
  polygon     jsonb,                                                  -- [[lat,lng], ...]
  center      jsonb,                                                  -- [lat,lng] (client normalize eder)
  radius_m    numeric,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- id client-üretimli olduğundan global tekil DEĞİL; farklı araçlar aynı
  -- 'default' id'sini kullanabilir → composite PK (vehicle_id, id).
  PRIMARY KEY (vehicle_id, id)
);

-- Okuma sorgusu için kısmi indeks (yalnız aktif bölgeler, araç bazlı).
CREATE INDEX IF NOT EXISTS idx_vehicle_geofences_active
  ON public.vehicle_geofences (vehicle_id)
  WHERE is_active = true;

-- ── 2. GRANT ─────────────────────────────────────────────────────────
-- ⚠️ Supabase `public` şemada yeni tablolara ALTER DEFAULT PRIVILEGES ile
-- OTOMATİK anon+authenticated GRANT verir (PostgREST varsayılan kurulumu).
-- Mahremiyet için (ev/park konumu) bu otomatik erişimi ÖNCE geri al — aksi
-- halde anon tabloya doğrudan girip tüm araçların bölgelerini okuyabilir.
-- Cihaz erişimi YALNIZ SECURITY DEFINER RPC üzerindendir.
REVOKE ALL ON public.vehicle_geofences FROM anon, authenticated;
-- authenticated'a SADECE SELECT: superadmin filo görünürlüğü (RLS ile daraltılır).
-- anon'a TABLO GRANT'i BİLİNÇLİ olarak VERİLMEZ (yalnız RPC EXECUTE).
-- service_role: bakım/backend tam erişim.
GRANT SELECT ON public.vehicle_geofences TO authenticated;
GRANT ALL    ON public.vehicle_geofences TO service_role;

-- ── 3. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.vehicle_geofences ENABLE ROW LEVEL SECURITY;

-- Policy — YALNIZ super_admin doğrudan SELECT (vehicle_events 021 deseni:
-- JWT app_metadata.role; service_role atar, kullanıcı değiştiremez).
-- anon için policy YOK, USING(true) YOK → cihaz tabloya doğrudan giremez;
-- konum mahremiyeti korunur. Cihaz okuması get_geofence_zones RPC'sinden geçer.
DROP POLICY IF EXISTS "superadmin_select_vehicle_geofences" ON public.vehicle_geofences;
CREATE POLICY "superadmin_select_vehicle_geofences" ON public.vehicle_geofences
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin');

-- ── 4. RPC: push_geofence_zone (upsert, api_key auth) ────────────────
-- Sürücü SecuritySuite'te bölge ekler/günceller → bu RPC ile yukarı senkron.
CREATE OR REPLACE FUNCTION public.push_geofence_zone(p_api_key text, p_zone jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
  v_zone_id    text;
BEGIN
  -- api_key → araç (push_vehicle_event 026 ile birebir aynı auth)
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  -- zone.id yoksa üret (client 'default' verir; polygon çizimleri uuid alır)
  v_zone_id := coalesce(NULLIF(p_zone->>'id', ''), gen_random_uuid()::text);

  INSERT INTO public.vehicle_geofences AS g (
    id, vehicle_id, name, type, polygon, center, radius_m, is_active, updated_at
  )
  VALUES (
    v_zone_id,
    v_vehicle_id::text,                                              -- TEXT kolona açık cast
    p_zone->>'name',
    p_zone->>'type',
    CASE WHEN jsonb_typeof(p_zone->'polygon') = 'array' THEN p_zone->'polygon' ELSE NULL END,
    CASE WHEN jsonb_typeof(p_zone->'center')  IN ('array','object') THEN p_zone->'center' ELSE NULL END,
    NULLIF(p_zone->>'radius_m', '')::numeric,
    coalesce((p_zone->>'is_active')::boolean, true),
    now()
  )
  ON CONFLICT (vehicle_id, id) DO UPDATE SET
    name      = EXCLUDED.name,
    type      = EXCLUDED.type,
    polygon   = EXCLUDED.polygon,
    center    = EXCLUDED.center,
    radius_m  = EXCLUDED.radius_m,
    is_active = EXCLUDED.is_active,
    updated_at = now();

  RETURN v_zone_id;
END;
$function$;

-- ── 5. RPC: get_geofence_zones (okuma, api_key auth) ─────────────────
-- Cihaz okuma yolu. anon tabloya doğrudan giremez → bu RPC'den geçer.
-- YALNIZ çözülen aracın AKTİF bölgelerini döndürür (mahremiyet RPC'de zorlanır).
CREATE OR REPLACE FUNCTION public.get_geofence_zones(p_api_key text)
 RETURNS SETOF public.vehicle_geofences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
BEGIN
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT *
    FROM public.vehicle_geofences
    WHERE vehicle_id = v_vehicle_id::text
      AND is_active = true;
END;
$function$;

-- ── 6. RPC: delete_geofence_zone (soft delete, api_key auth) ─────────
-- Sürücü bölgeyi silince is_active=false → okuma yolu artık döndürmez.
CREATE OR REPLACE FUNCTION public.delete_geofence_zone(p_api_key text, p_zone_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
BEGIN
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.vehicle_geofences
  SET is_active = false, updated_at = now()
  WHERE vehicle_id = v_vehicle_id::text
    AND id = p_zone_id;
END;
$function$;

-- ── 7. Fonksiyon GRANT'ları ──────────────────────────────────────────
-- Supabase default privileges yeni fonksiyona PUBLIC EXECUTE ekler → önce
-- revoke, sonra yalnız anon/authenticated'a EXECUTE (remote_log_guards deseni).
REVOKE ALL     ON FUNCTION public.push_geofence_zone(text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.push_geofence_zone(text, jsonb) TO anon, authenticated;

REVOKE ALL     ON FUNCTION public.get_geofence_zones(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_geofence_zones(text) TO anon, authenticated;

REVOKE ALL     ON FUNCTION public.delete_geofence_zone(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.delete_geofence_zone(text, text) TO anon, authenticated;

-- ── 8. Verification (CLAUDE.md zorunlu) ──────────────────────────────
DO $$
DECLARE
  rls_ok      boolean;
  fn_count    integer;
  auth_grant  boolean;
  anon_leak   integer;
  push_grant  integer;
BEGIN
  -- Üç RPC de var mı
  SELECT count(*) INTO fn_count
  FROM pg_proc
  WHERE proname IN ('push_geofence_zone', 'get_geofence_zones', 'delete_geofence_zone');
  IF fn_count < 3 THEN
    RAISE EXCEPTION 'vehicle_geofences: RPC eksik (bulunan: %/3)', fn_count;
  END IF;

  -- RLS açık mı
  SELECT rowsecurity INTO rls_ok
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'vehicle_geofences';
  IF NOT coalesce(rls_ok, false) THEN
    RAISE EXCEPTION 'vehicle_geofences: RLS kapalı';
  END IF;

  -- anon'a TABLO GRANT'i SIZMAMALI (yalnız RPC EXECUTE ile erişir)
  SELECT count(*) INTO anon_leak
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'vehicle_geofences'
    AND grantee = 'anon';
  IF anon_leak > 0 THEN
    RAISE EXCEPTION 'vehicle_geofences: anon''a tablo GRANT sızdı (% adet) — mahremiyet ihlali', anon_leak;
  END IF;

  -- authenticated SELECT (superadmin görünürlüğü) var mı
  SELECT EXISTS(
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'vehicle_geofences'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'
  ) INTO auth_grant;
  IF NOT auth_grant THEN
    RAISE EXCEPTION 'vehicle_geofences: authenticated SELECT GRANT eksik';
  END IF;

  -- push_geofence_zone: anon + authenticated EXECUTE şart (cihaz yazma yolu)
  SELECT count(*) INTO push_grant
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name = 'push_geofence_zone'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type = 'EXECUTE';
  IF push_grant < 2 THEN
    RAISE EXCEPTION 'vehicle_geofences: push_geofence_zone EXECUTE GRANT eksik (bulunan: %)', push_grant;
  END IF;

  RAISE NOTICE 'vehicle_geofences: RPC=% RLS=OK anon-tablo-sızıntısı=0 authGRANT=OK pushGRANT=%', fn_count, push_grant;
END $$;
