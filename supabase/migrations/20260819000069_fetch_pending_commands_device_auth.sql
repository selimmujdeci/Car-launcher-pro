-- 20260819000069_fetch_pending_commands_device_auth.sql
-- ══════════════════════════════════════════════════════════════════════════
-- #646 — ARAÇ KENDİ KOMUTUNU GÖREMİYORDU: cihaz için OKUMA yolu hiç yoktu.
--
-- SAHA KANITI (2026-08-19, kullanıcı telefonu):
--   PWA → Tema Stüdyo → ARACA GÖNDER → "✓ ARACA GÖNDERİLDİ" ama araçta
--   HİÇBİR değişiklik olmuyor.
--   PROD ölçümü: üç `theme_change` komutu da `status='pending'`, TTL DOLMAMIŞ,
--   payload eksiksiz (theme · manifest · themeVars, 7 352 bayt).
--
-- KÖK: Araç uygulaması `vehicle_commands` tablosunu DOĞRUDAN sorguluyor
--      (`commandListener.processPendingCommands`) ve Supabase'e **anon anahtarla,
--      KULLANICI OTURUMU OLMADAN** bağlanıyor. SELECT politikaları ise:
--        · `commands: okuyabilir` → is_vehicle_owner() OR is_paired(auth.uid(),…)
--        · `Company Isolation`    → company_id = profiles.company_id(auth.uid())
--      Üçü de `auth.uid()`e dayanır; anonim istemcide `auth.uid()` NULL'dur →
--      **araç kendi bekleyen komutlarını 0 satır olarak görür.** GRANT vardı,
--      engel RLS'ti. Komut yazılıyor, kimse okumuyor, TTL doluyor.
--
-- NEDEN RPC (yeni politika DEĞİL): cihaz kimliği bu şemada zaten `api_key`
-- iledir ve UPDATE tarafında bunun ÇALIŞAN karşılığı var:
-- `update_command_status(p_api_key, …)` — SECURITY DEFINER + `api_key_hash`
-- doğrulaması + `anon` EXECUTE. Eksik olan yalnız simetrik OKUMA ucuydu.
-- Bu migration o boşluğu AYNI sözleşmeyle kapatır; RLS politikalarına
-- DOKUNULMAZ (kullanıcı/filo tarafının izolasyonu aynen kalır).
--
-- GİZLİLİK: fonksiyon YALNIZ api_key'in sahibi olduğu aracın komutlarını döner.
-- Geçersiz anahtar → istisna. Başka aracın satırı hiçbir koşulda dönmez.
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fetch_pending_vehicle_commands(
  p_api_key   text,
  p_max_retry integer DEFAULT 3,
  p_limit     integer DEFAULT 10
) RETURNS SETOF public.vehicle_commands
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_vehicle_id uuid;
BEGIN
  IF p_api_key IS NULL OR length(p_api_key) = 0 THEN
    RAISE EXCEPTION 'Geçersiz api_key' USING ERRCODE = 'P0001';
  END IF;

  /* `update_command_status` ile BİREBİR aynı doğrulama — ikinci bir kimlik
     kavramı üretilmez (dev fallback dâhil, aynı gerekçe). */
  SELECT id INTO v_vehicle_id
  FROM vehicles
  WHERE api_key_hash = encode(digest(p_api_key, 'sha256'), 'hex')
     OR api_key_hash = p_api_key
  LIMIT 1;

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Geçersiz api_key' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT c.*
  FROM vehicle_commands c
  WHERE c.vehicle_id = v_vehicle_id
    AND c.status     = 'pending'
    AND c.ttl        > now()
    AND coalesce(c.retry_count, 0) < greatest(p_max_retry, 1)
  ORDER BY c.created_at ASC          -- FIFO: istemcideki sıra korunur
  LIMIT least(greatest(p_limit, 1), 50);
END;
$function$;

-- Yetki: cihaz `anon` anahtarıyla bağlanır (update ucuyla AYNI model).
REVOKE ALL ON FUNCTION public.fetch_pending_vehicle_commands(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_pending_vehicle_commands(text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.fetch_pending_vehicle_commands(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_pending_vehicle_commands(text, integer, integer) TO service_role;
