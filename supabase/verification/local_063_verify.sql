-- ============================================================================
-- local_063_verify.sql — Migration 063'ün GERÇEK PostgreSQL doğrulaması.
--
-- Sıra: local_063_fixture.sql  →  (KUSUR KANITI ölçülür)  →  063 migration
--       →  bu dosya.
--
-- Yedi kontrol. Herhangi biri düşerse EXCEPTION atar (fail-closed) — sessiz
-- "geçti" YOKTUR.
-- ============================================================================

DO $$
DECLARE
  v_ok      int := 0;
  v_sqlstate text;
  v_result  jsonb;
  v_id      uuid;
BEGIN
  -- ── 1. `result` kolonu oluştu mu ──────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_commands' AND column_name='result'
  ) THEN
    RAISE EXCEPTION '063-1 DÜŞTÜ: result kolonu yok.';
  END IF;
  v_ok := v_ok + 1;
  RAISE NOTICE '063-1 PASS: result kolonu var';

  -- ── 2. `result` NULLABLE ve varsayılanı YOK (sahte {} yazılmaz) ───────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vehicle_commands' AND column_name='result'
      AND (is_nullable <> 'YES' OR column_default IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '063-2 DÜŞTÜ: result NULLABLE değil ya da varsayılanı var (okunmadı ≠ boş ayrımı bozulur).';
  END IF;
  v_ok := v_ok + 1;
  RAISE NOTICE '063-2 PASS: result NULLABLE, varsayılan yok';

  -- ── 3. Beş yeni tip artık KABUL EDİLİYOR ──────────────────────────────────
  FOREACH v_sqlstate IN ARRAY ARRAY['layout_change','read_dtc','clear_dtc','read_voltage','set_speed_alert']
  LOOP
    INSERT INTO public.vehicle_commands (vehicle_id, type)
    VALUES (gen_random_uuid(), v_sqlstate);
  END LOOP;
  v_ok := v_ok + 1;
  RAISE NOTICE '063-3 PASS: bes yeni tip kabul edildi';

  -- ── 4. Eski dokuz tip HÂLÂ kabul ediliyor (genişletme, daraltma değil) ────
  FOREACH v_sqlstate IN ARRAY ARRAY[
    'lock','unlock','horn','alarm_on','alarm_off',
    'lights_on','route_send','navigation_start','theme_change'
  ]
  LOOP
    INSERT INTO public.vehicle_commands (vehicle_id, type)
    VALUES (gen_random_uuid(), v_sqlstate);
  END LOOP;
  v_ok := v_ok + 1;
  RAISE NOTICE '063-4 PASS: eski dokuz tip korundu';

  -- ── 5. Tanınmayan tip HÂLÂ reddediliyor (kısıt gevşetilmedi) ──────────────
  BEGIN
    INSERT INTO public.vehicle_commands (vehicle_id, type)
    VALUES (gen_random_uuid(), 'ecu_flash');
    RAISE EXCEPTION '063-5 DÜŞTÜ: bilinmeyen tip KABUL EDİLDİ — CHECK gevşemiş.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '063-5 PASS: bilinmeyen tip reddedildi (23514)';
  END;
  v_ok := v_ok + 1;

  -- ── 6. Yeni satırda `result` gerçekten NULL (sahte varsayılan yok) ────────
  SELECT id, result INTO v_id, v_result
  FROM public.vehicle_commands WHERE type='read_dtc' LIMIT 1;
  IF v_result IS NOT NULL THEN
    RAISE EXCEPTION '063-6 DÜŞTÜ: result varsayılan deger tasiyor: %', v_result;
  END IF;
  v_ok := v_ok + 1;
  RAISE NOTICE '063-6 PASS: result NULL (okunmadi)';

  -- ── 7. `result` jsonb olarak gerçekten yazılıp okunabiliyor ───────────────
  UPDATE public.vehicle_commands
     SET result = '{"dtcs":[{"code":"P0420"}],"partial":false}'::jsonb
   WHERE id = v_id;
  SELECT result INTO v_result FROM public.vehicle_commands WHERE id = v_id;
  IF v_result IS NULL OR v_result->>'partial' <> 'false' THEN
    RAISE EXCEPTION '063-7 DÜŞTÜ: result yazilip okunamadi.';
  END IF;
  v_ok := v_ok + 1;
  RAISE NOTICE '063-7 PASS: result jsonb yazildi/okundu (partial=%)', v_result->>'partial';

  RAISE NOTICE '=== 063 DOGRULAMA: %/7 PASS ===', v_ok;
  IF v_ok <> 7 THEN
    RAISE EXCEPTION '063 DÜŞTÜ: yalnız %/7', v_ok;
  END IF;
END $$;
