-- =====================================================================
-- P0 · GERÇEK SUNUCU TARAFLI ARAÇ AYIRMA (unlink)
--
-- ── ÖLÇÜLEN SORUN (2026-09-17) ───────────────────────────────────────
-- Arabam Cebimde'deki "Araç bağlantısını kes" düğmesi
-- (`website/src/app/(pwa)/kumanda/page.tsx` → `handleUnpair`) YALNIZ yerel
-- durumu siliyordu: `clearLocalVehicle()` + `vehicleStore.removeVehicle(id)`.
-- Sunucuda `vehicles.owner_id` ve `vehicle_pairings` satırı AYNEN kalıyordu.
-- Sonuçları:
--   (a) Düğme, yapmadığı bir şeyi yapmış gibi görünüyordu.
--   (b) Bireysel 3 araç limiti (`pair_vehicle_to_user`) `owner_id` üzerinden
--       sayıldığı için bırakılan araç kotayı DOLDURMAYA devam ediyordu.
--   (c) Kullanıcı kimliğini kaybederse (PWA anonim oturum) araç
--       `vehicle_owned_by_another_user` ile KALICI erişilemez hâle geliyordu.
--
-- ── BU FONKSİYON `pair_vehicle_to_user`IN TAM TERSİDİR ───────────────
-- Eşleştirme şunları yazar (034 §2.5):
--     UPDATE vehicles SET owner_id = coalesce(owner_id, p_user_id), ...
--     INSERT INTO vehicle_pairings (user_id, vehicle_id, role, company_id)
-- Ayırma da TAM OLARAK bunları geri alır; başka hiçbir şeye dokunmaz.
--
-- ── SAHİPLİK MODELİ (körlemesine değiştirilmedi) ─────────────────────
--   · BİREYSEL araç (`company_id IS NULL`) + çağıran SAHİP →
--       `owner_id` NULL yapılır + çağıranın pairing satırı silinir.
--       Araç yeniden eşleşmeye AÇIK hâle gelir; bu güvenli çünkü eşleştirme
--       kodu head unit'te üretilir → FİZİKSEL erişim hâlâ şarttır.
--   · ŞİRKET aracı → `owner_id`/`company_id`e DOKUNULMAZ. Filo yapısını
--       yalnız `remove_vehicle_from_company` (admin) değiştirebilir.
--       Burada yalnız ÇAĞIRANIN KENDİ erişim satırı kaldırılır.
--   · Çağıranın ne sahipliği ne eşleşmesi varsa → `vehicle_not_paired`
--       (fail-closed; başkasının aracına dokunulamaz).
--   · BAŞKA kullanıcıların pairing satırlarına ASLA DOKUNULMAZ.
--
-- ── VERİ KAYBI YOK ───────────────────────────────────────────────────
-- `vehicle_fuel_logs`, `vehicle_service_records`, yolculuklar ve telemetri
-- SİLİNMEZ. Bunlar araca aittir; kullanıcı erişimi RLS üzerinden
-- (`user_can_access_vehicle`) doğal olarak kapanır. Araç yeniden eşleşirse
-- geçmiş OLDUĞU GİBİ geri gelir.
--
-- ── FAZ 1 (Google hesabı) UYUMU ──────────────────────────────────────
-- Hiçbir yeni kullanıcı-kimliği anahtarı ÜRETİLMEZ; mevcut `auth.users.id`
-- kullanılır. Supabase `linkIdentity` anonim kullanıcıyı AYNI `uid` ile
-- kalıcı kimliğe yükselttiği için bu fonksiyon FAZ 1'i ENGELLEMEZ.
--
-- ⚠️  BU MIGRATION BU TURDA PRODUCTION'A UYGULANMADI.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.unpair_vehicle_from_user(
  p_vehicle_id uuid,
  p_user_id    uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_vehicle      public.vehicles%ROWTYPE;
  v_was_owner    boolean;
  v_had_pairing  boolean;
  v_owner_cleared boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0001';
  END IF;

  /* Eşleştirmeyle AYNI kilit deseni: kullanıcı bazlı advisory kilit, aynı
     kullanıcının paralel pair/unpair isteklerini serileştirir → 3 araç
     sayımı yarışla bozulamaz. */
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT * INTO v_vehicle
    FROM public.vehicles
   WHERE id = p_vehicle_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_was_owner := (v_vehicle.owner_id IS NOT NULL AND v_vehicle.owner_id = p_user_id);

  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_pairings
     WHERE user_id = p_user_id AND vehicle_id = p_vehicle_id
  ) INTO v_had_pairing;

  /* ── YETKİ KAPISI ────────────────────────────────────────────────
     Çağıranın bu araçla GERÇEK bir bağı yoksa hiçbir şey yapılmaz.
     Bu, "başka kullanıcının aracını unlink edememe" invariantının
     tek ve yeterli kapısıdır. */
  IF NOT v_was_owner AND NOT v_had_pairing THEN
    RAISE EXCEPTION 'vehicle_not_paired' USING ERRCODE = 'P0001';
  END IF;

  /* ── 1. ÇAĞIRANIN KENDİ ERİŞİM SATIRI ───────────────────────────
     `user_id = p_user_id` koşulu ZORUNLUDUR: başkasının satırı silinemez. */
  DELETE FROM public.vehicle_pairings
   WHERE user_id = p_user_id AND vehicle_id = p_vehicle_id;

  /* ── 2. SAHİPLİK — YALNIZ BİREYSEL ARAÇTA ───────────────────────
     Şirket aracında sahiplik/filo yapısı BU fonksiyonun işi değildir. */
  IF v_was_owner AND v_vehicle.company_id IS NULL THEN
    UPDATE public.vehicles
       SET owner_id = NULL
     WHERE id = p_vehicle_id;
    v_owner_cleared := true;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id',     p_vehicle_id,
    'pairing_removed', v_had_pairing,
    'owner_cleared',   v_owner_cleared,
    'was_company_vehicle', (v_vehicle.company_id IS NOT NULL)
  );
END;
$function$;

-- ── YETKİ MODELİ ─────────────────────────────────────────────────────
-- `pair_vehicle_to_user` ile AYNI: `p_user_id` PARAMETRE olduğu için
-- istemci rolleri bu fonksiyonu ÇAĞIRAMAZ (aksi hâlde herkes başkasının
-- id'sini geçirebilirdi). Çağrı, JWT'yi `supabaseAdmin.auth.getUser` ile
-- DOĞRULAYAN Next.js rotasından service_role ile yapılır.
REVOKE ALL ON FUNCTION public.unpair_vehicle_from_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_vehicle_from_user(uuid, uuid) TO service_role;

-- ── DOĞRULAMA (fail-closed) ──────────────────────────────────────────
DO $verify$
BEGIN
  IF to_regprocedure('public.unpair_vehicle_from_user(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION '076 DOĞRULAMA: fonksiyon oluşmadı';
  END IF;

  IF has_function_privilege('anon', 'public.unpair_vehicle_from_user(uuid, uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.unpair_vehicle_from_user(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '076 DOĞRULAMA: istemci rolü unpair fonksiyonunu çağırabiliyor (p_user_id sahteciliği riski)';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.unpair_vehicle_from_user(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '076 DOĞRULAMA: service_role çağıramıyor — rota çalışamaz';
  END IF;

  RAISE NOTICE '076 OK: unpair_vehicle_from_user kuruldu; yalnız service_role çağırabilir';
END
$verify$;

COMMIT;

-- =====================================================================
-- ROLLBACK
--   BEGIN; DROP FUNCTION IF EXISTS public.unpair_vehicle_from_user(uuid, uuid); COMMIT;
-- =====================================================================
