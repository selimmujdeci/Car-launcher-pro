-- 20260819000071_command_rpc_search_path_extensions.sql
-- ══════════════════════════════════════════════════════════════════════════
-- #649 — KOMUT RPC'LERİ İLK GÜNDEN BERİ ÖLÜYMÜŞ: `pgcrypto` search_path'te YOK.
--
-- SAHA ÖLÇÜMÜ (2026-08-19, gerçek cihaz + yeni APK, CDP ile araç webview'inden):
--   Araç 15 sn'de bir DOĞRU uca gidiyor —
--     .../rest/v1/rpc/fetch_pending_vehicle_commands
--   ama HER İSTEK **HTTP 404, 0 bayt**. Uca doğrudan yoklandığında gerçek hata:
--     {"code":"42883","message":"function digest(text, unknown) does not exist"}
--
-- KÖK: Supabase'de `pgcrypto` **`extensions`** şemasında kuruludur (ölçüldü:
--   pg_extension → `extensions`; `digest` YALNIZ orada var). Oysa hem 069'un
--   `fetch_pending_vehicle_commands`i hem de tabandan gelen
--   `update_command_status` `SET search_path = public` ile kilitli. SECURITY
--   DEFINER fonksiyon kendi search_path'i dışına ÇIKAMAZ → `digest(...)` adı
--   çözülemiyor ve fonksiyon daha api_key karşılaştırmasına VARMADAN 42883 ile
--   düşüyor. PostgREST bunu 404'e çeviriyor.
--
-- YANİ: #646'da eklenen okuma ucu **uygulandığı günden beri hiç çalışmadı** ve
--   #647'de "onarıldı" denen yazma ucu da AYNI sebeple hâlâ ölüydü. İki tur
--   boyunca görülmemesinin sebebi, RPC'lerin o turlarda **hiç çağrılmamış**
--   olmasıdır: doğrulama yalnız "fonksiyon var mı / imza tek mi / anon EXECUTE
--   var mı" diye baktı. **Nesnenin VARLIĞI, ÇALIŞTIĞININ kanıtı değildir.**
--
-- BU MIGRATION: iki fonksiyonun search_path'ine `extensions` EKLER. Gövdelere,
--   imzalara, yetkilere, RLS'e DOKUNMAZ. `public` başta kalır (nitelenmemiş
--   tablo adları yine `public`e çözülür; extension şeması yalnız EK'tir).
-- İdempotent: iki kez koşarsa aynı sonucu verir.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 0. Ön koşul: pgcrypto gerçekten `extensions`te mi? (fail-closed) ────────
DO $$
DECLARE v_sema text;
BEGIN
  SELECT n.nspname INTO v_sema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_sema IS NULL THEN
    RAISE EXCEPTION '071 ÖN KOŞUL: pgcrypto kurulu değil — komut RPC''leri çalışamaz.';
  END IF;
  IF v_sema <> 'extensions' THEN
    RAISE EXCEPTION '071 ÖN KOŞUL: pgcrypto beklenmedik şemada (%s) — search_path elle gözden geçirilmeli.', v_sema;
  END IF;
END $$;

-- ── 1. search_path'e extensions eklenir ─────────────────────────────────────
ALTER FUNCTION public.fetch_pending_vehicle_commands(text, integer, integer)
  SET search_path = public, extensions;

ALTER FUNCTION public.update_command_status(
  text, uuid, text, timestamptz, timestamptz, timestamptz, text, jsonb)
  SET search_path = public, extensions;

-- ── 2. DAVRANIŞSAL doğrulama — "var mı" değil, "ÇALIŞIYOR mu" ───────────────
-- Geçersiz bir anahtarla çağrılır: DOĞRU davranış `P0001 Geçersiz api_key`tir.
-- Hâlâ `42883` (undefined_function) geliyorsa search_path düzelmemiştir → DUR.
DO $$
DECLARE
  v_kod text;
  v_dummy record;
BEGIN
  -- (a) OKUMA ucu
  BEGIN
    SELECT * INTO v_dummy
    FROM public.fetch_pending_vehicle_commands('071-dogrulama-gecersiz-anahtar');
    RAISE EXCEPTION '071 DOĞRULAMA: geçersiz anahtar istisna ATMADI — kimlik kapısı açık olabilir.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_kod = RETURNED_SQLSTATE;
    IF v_kod = '42883' THEN
      RAISE EXCEPTION '071 DOĞRULAMA: fetch_pending_vehicle_commands hâlâ 42883 (digest bulunamıyor) — search_path uygulanmadı.';
    ELSIF v_kod <> 'P0001' THEN
      RAISE EXCEPTION '071 DOĞRULAMA: fetch_pending_vehicle_commands beklenmedik hata: %', v_kod;
    END IF;
  END;

  -- (b) YAZMA ucu
  BEGIN
    PERFORM public.update_command_status(
      '071-dogrulama-gecersiz-anahtar',
      '00000000-0000-0000-0000-000000000000'::uuid,
      'accepted');
    RAISE EXCEPTION '071 DOĞRULAMA: update_command_status geçersiz anahtarla istisna ATMADI.';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_kod = RETURNED_SQLSTATE;
    IF v_kod = '42883' THEN
      RAISE EXCEPTION '071 DOĞRULAMA: update_command_status hâlâ 42883 — search_path uygulanmadı.';
    ELSIF v_kod <> 'P0001' THEN
      RAISE EXCEPTION '071 DOĞRULAMA: update_command_status beklenmedik hata: %', v_kod;
    END IF;
  END;
END $$;
