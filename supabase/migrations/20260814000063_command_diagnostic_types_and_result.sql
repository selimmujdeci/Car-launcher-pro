-- ============================================================================
-- 063 — vehicle_commands: teşhis komut tipleri + sonuç taşıyıcısı
--
-- ÖLÇÜLEN KUSUR (2026-08-14, kod denetimi):
--   "Arabam Cebimde" PWA beş komut tipi gönderiyor: `read_dtc`, `clear_dtc`,
--   `read_voltage`, `set_speed_alert`, `layout_change`. Bunların HİÇBİRİ
--   `vehicle_commands_type_check` listesinde YOKTU (010'da donmuş 9 değer) →
--   INSERT `23514 check_violation` ile REDDEDİLİYORDU. Yani Teşhis sekmesi ve
--   Hız Uyarısı ürüne HİÇ ulaşmıyordu; kullanıcı "Kaydedildi ✓" görüyordu.
--
--   İkinci kusur: `/api/pwa/dtc-result` `select('id, status, result, created_at')`
--   yapıyor ama **`result` kolonu hiç oluşturulmamıştı** → PostgREST `42703`.
--   Komut çalışsa bile sonucu telefona taşıyacak bir yer yoktu.
--
-- BU MIGRATION VERİ YAZMAZ, POLİTİKA GEVŞETMEZ:
--   · CHECK listesi yalnız GENİŞLER (mevcut 9 tip aynen korunur).
--   · `result` NULLABLE jsonb — varsayılan YOK. "Sonuç okunmadı" ile "sonuç boş"
--     ayrımı korunur; sahte `{}` yazılmaz.
--   · RLS ve GRANT'lara DOKUNULMAZ (kolon tablo politikasını miras alır).
--
-- İdempotent: iki kez koşarsa aynı sonucu verir.
-- Fail-closed: tablo yoksa ya da CHECK adı beklenenden farklıysa DURUR.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicle_commands'
  ) THEN
    RAISE EXCEPTION '063 ÖN KOŞUL: public.vehicle_commands yok — 005/010 uygulanmamış.';
  END IF;
END $$;

-- ── 1. Sonuç taşıyıcısı ─────────────────────────────────────────────────────
-- Araç komutu yürüttükten sonra ÖLÇTÜĞÜ veriyi buraya yazar (DTC listesi,
-- voltaj, tarama bütünlüğü). Telefon bunu `/api/pwa/dtc-result` ile okur.
ALTER TABLE public.vehicle_commands
  ADD COLUMN IF NOT EXISTS result jsonb;

COMMENT ON COLUMN public.vehicle_commands.result IS
  'Araç tarafının ölçüm sonucu (jsonb). NULL = sonuç YAZILMADI (okunamadı ≠ boş). Sahte varsayılan yazılmaz.';

-- ── 2. Komut tipi listesi genişletmesi ──────────────────────────────────────
ALTER TABLE public.vehicle_commands
  DROP CONSTRAINT IF EXISTS vehicle_commands_type_check;

ALTER TABLE public.vehicle_commands
  ADD CONSTRAINT vehicle_commands_type_check
  CHECK (type IN (
    -- 010'dan devralınan dokuz tip — DEĞİŞTİRİLMEDİ
    'lock','unlock','horn','alarm_on','alarm_off',
    'lights_on','route_send','navigation_start','theme_change',
    -- 063 ile eklenen beş tip (ürün kodunda zaten gönderiliyorlardı)
    'layout_change','read_dtc','clear_dtc','read_voltage','set_speed_alert'
  ));

-- ── 3. Doğrulama — genişletme gerçekten uygulandı mı ────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'vehicle_commands'
      AND column_name  = 'result'
  ) THEN
    RAISE EXCEPTION '063 DOĞRULAMA: result kolonu oluşmadı.';
  END IF;

  -- CHECK metni beş yeni tipin tamamını içermeli (kısmi uygulama fail-closed).
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'layout_change','read_dtc','clear_dtc','read_voltage','set_speed_alert'
  ]) AS t
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'vehicle_commands'
      AND c.conname = 'vehicle_commands_type_check'
      AND pg_get_constraintdef(c.oid) LIKE '%''' || t || '''%'
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '063 DOĞRULAMA: CHECK listesinde eksik tip(ler): %', v_missing;
  END IF;
END $$;
