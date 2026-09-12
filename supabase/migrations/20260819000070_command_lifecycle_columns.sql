-- 20260819000070_command_lifecycle_columns.sql
-- ══════════════════════════════════════════════════════════════════════════
-- #647 — KOMUT DURUM YAZMA YOLU DA ÖLÜYMÜŞ: yaşam döngüsü kolonları HİÇ YOKTU.
--
-- PROD ÖLÇÜMÜ (2026-08-19, salt-okunur `tools/prod-read-sql.ps1`):
--   `public.vehicle_commands` kolonları: id · vehicle_id · company_id · issuer_id
--   · type · payload · status · nonce · ttl · error_message · created_at
--   · updated_at · sender_id · created_by · critical_auth_verified · retry_count
--   · last_attempt_at · result
--   → `accepted_at` · `executed_at` · `finished_at` **YOK**.
--
-- BUNUN SONUCU (iki fonksiyon da sessizce ölü):
--   · `update_command_status(...)` gövdesi `accepted_at`/`executed_at`/`finished_at`
--     yazıyor → her çağrıda `42703 undefined_column`. #646'nın "UPDATE tarafında
--     ÇALIŞAN karşılığı var" varsayımı YANLIŞTI: o uç hiç çalışmamış.
--   · `increment_command_retry(...)` max-retry dalında `finished_at` yazıyor →
--     aynı hata. Yani başarısız komut "failed"e HİÇ geçemiyor.
--
-- Ayrıca araç istemcisi durum güncellemesini REST PATCH ile tabloya yazmaya
-- çalışıyordu; prod'da `anon` rolünün `vehicle_commands` üzerinde **HİÇBİR tablo
-- ayrıcalığı yok** (037 daralttı) → o yol da ölü. İstemci ucu aynı turda
-- `update_command_status` RPC'sine bağlanır (069'un OKUMA ucuyla simetrik).
--
-- BU MIGRATION NE YAPAR:
--   1. Üç yaşam döngüsü kolonunu EKLER (NULLABLE, varsayılansız — "yazılmadı"
--      ile "boş" ayrımı korunur; sahte tarih üretilmez).
--   2. `update_command_status`'a `p_result jsonb` ucu ekler — araç ölçüm sonucunu
--      (DTC listesi, voltaj) artık aynı kapıdan yazar. İKİNCİ yazma yolu
--      kurulmaz; eski imza DROP edilir ki PostgREST'te aşırı yükleme
--      belirsizliği (`could not choose the best candidate function`) OLUŞMASIN.
--
-- RLS ve tablo GRANT'larına DOKUNULMAZ. Kolonlar tablo politikasını miras alır.
-- İdempotent: iki kez koşarsa aynı sonucu verir.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 0. Ön koşul (fail-closed) ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicle_commands'
  ) THEN
    RAISE EXCEPTION '070 ÖN KOŞUL: public.vehicle_commands yok.';
  END IF;
END $$;

-- ── 1. Yaşam döngüsü kolonları ──────────────────────────────────────────────
ALTER TABLE public.vehicle_commands
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

COMMENT ON COLUMN public.vehicle_commands.accepted_at IS
  'Araç komutu KABUL ettiği an. NULL = kabul kaydı yazılmadı (sahte tarih üretilmez).';
COMMENT ON COLUMN public.vehicle_commands.executed_at IS
  'Yürütme BAŞLADIĞI an. NULL = yürütme başlamadı ya da kaydı yazılmadı.';
COMMENT ON COLUMN public.vehicle_commands.finished_at IS
  'Komut SONUÇLANDIĞI an (completed/failed/rejected). NULL = hâlâ sonuçlanmadı.';

-- ── 2. Durum yazma ucu: sonuç taşıyıcısı eklenir ────────────────────────────
-- Eski imza kaldırılır (aşırı yükleme belirsizliği önlenir). Çağıranlar ADLI
-- argüman kullanır (`p_api_key`, `p_command_id`, …) → sona eklenen varsayılanlı
-- parametre geriye dönük uyumludur.
DROP FUNCTION IF EXISTS public.update_command_status(
  text, uuid, text, timestamptz, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION public.update_command_status(
  p_api_key     text,
  p_command_id  uuid,
  p_status      text,
  p_accepted_at timestamptz DEFAULT NULL,
  p_executed_at timestamptz DEFAULT NULL,
  p_finished_at timestamptz DEFAULT NULL,
  p_error       text        DEFAULT NULL,
  p_result      jsonb       DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_vehicle_id uuid;
BEGIN
  /* Cihaz kimliği = api_key (069 ile BİREBİR aynı doğrulama; dev fallback dâhil). */
  SELECT id INTO v_vehicle_id
  FROM vehicles
  WHERE api_key_hash = encode(digest(p_api_key, 'sha256'), 'hex')
     OR api_key_hash = p_api_key
  LIMIT 1;

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Geçersiz api_key' USING ERRCODE = 'P0001';
  END IF;

  UPDATE vehicle_commands
  SET
    status          = p_status,
    accepted_at     = coalesce(p_accepted_at, accepted_at),
    executed_at     = coalesce(p_executed_at, executed_at),
    finished_at     = coalesce(p_finished_at, finished_at),
    error_message   = coalesce(p_error,       error_message),
    /* Sonuç YALNIZ gönderildiğinde yazılır; NULL geçilirse önceki ölçüm
       KORUNUR — "sonuç okunmadı" sahte `{}` ile ezilmez. */
    result          = coalesce(p_result,      result),
    last_attempt_at = CASE WHEN p_status = 'executing' THEN now() ELSE last_attempt_at END,
    updated_at      = now()
  WHERE id         = p_command_id
    AND vehicle_id = v_vehicle_id;

  /* Komut bu araca ait değilse sessizce geçilir: başka aracın satırı
     hiçbir koşulda güncellenmez ve varlığı da sızdırılmaz. */
END;
$function$;

REVOKE ALL ON FUNCTION public.update_command_status(
  text, uuid, text, timestamptz, timestamptz, timestamptz, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_command_status(
  text, uuid, text, timestamptz, timestamptz, timestamptz, text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.update_command_status(
  text, uuid, text, timestamptz, timestamptz, timestamptz, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_command_status(
  text, uuid, text, timestamptz, timestamptz, timestamptz, text, jsonb) TO service_role;

-- ── 3. Doğrulama (fail-closed) ──────────────────────────────────────────────
DO $$
DECLARE
  v_eksik text;
  v_imza  int;
BEGIN
  SELECT string_agg(k, ', ') INTO v_eksik
  FROM unnest(ARRAY['accepted_at','executed_at','finished_at']) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_commands' AND column_name=k
  );
  IF v_eksik IS NOT NULL THEN
    RAISE EXCEPTION '070 DOĞRULAMA: kolon(lar) oluşmadı: %', v_eksik;
  END IF;

  SELECT count(*) INTO v_imza
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='update_command_status';
  IF v_imza <> 1 THEN
    RAISE EXCEPTION '070 DOĞRULAMA: update_command_status imza sayısı % (1 olmalı) — PostgREST belirsizliği riski', v_imza;
  END IF;

  IF NOT has_function_privilege('anon',
        'public.update_command_status(text,uuid,text,timestamptz,timestamptz,timestamptz,text,jsonb)',
        'EXECUTE') THEN
    RAISE EXCEPTION '070 DOĞRULAMA: anon EXECUTE yok — cihaz durum yazamaz.';
  END IF;
END $$;
