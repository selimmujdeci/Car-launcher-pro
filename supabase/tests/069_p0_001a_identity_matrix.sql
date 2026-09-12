-- ═══════════════════════════════════════════════════════════════════════════
-- 069  P0-001A KİMLİK SERTLEŞTİRME MATRİSİ
--
--   npm run test:identity
--
-- ── NE KANITLAR ───────────────────────────────────────────────────────────
-- Migration 072 üç bağımsız açığı kapatır. Bu matris her birini AYRI halkada
-- kanıtlar ve — daha önemlisi — kapatmanın ÜRÜNÜ KIRMADIĞINI gösterir:
-- ilk kayıt hâlâ anahtar üretir, kod üretimi HER İKİ dalda da sürer
-- ("Mobil Bağlantı" ekranı buna bağlıdır), eşleştirme çalışmaya devam eder.
--
--   HALKA 1  ilk kayıt: anahtar ÜRETİLİR ve BİR KEZ döner        (TEST-1)
--   HALKA 2  ikinci kayıt: ham anahtar DÖNMEZ, saklı anahtar DEĞİŞMEZ (TEST-2)
--   HALKA 3  geçerli kısa ömürlü kod ile eşleştirme ÇALIŞIR      (TEST-3)
--   HALKA 4  tüketilen kod TEKRAR KULLANILAMAZ                   (TEST-4)
--   HALKA 5  kalıcı `vehicles.pairing_code` ile eşleştirme YAPILAMAZ (TEST-5)
--   HALKA 6  yetki yüzeyi: PUBLIC kapalı · anon açık · pairing istemciye kapalı
--
-- ── ŞEMA UYARISI (ölçüldü, 2026-08-22) ────────────────────────────────────
-- Yerel doğrulama veritabanı prod ile AYNI DEĞİLDİR: `vehicles.pairing_code`
-- kolonu yerelde YOKTUR ve `vehicle_linking_codes` PK'sı prod'da `id`,
-- yerelde `code`'dur. HALKA 5'in kanıt üretebilmesi için kolon transaction
-- İÇİNDE eklenir ve ROLLBACK ile geri alınır — yani matris prod şemasını
-- SİMÜLE eder, varsaymaz. Kolon zaten varsa dokunulmaz.
--
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE ix (k text PRIMARY KEY, v text);

-- ── Kurulum ───────────────────────────────────────────────────────────────
DO $setup$
DECLARE
  v_uid  uuid := gen_random_uuid();
  v_dev  text := 'P0A_DEVICE_' || replace(gen_random_uuid()::text, '-', '');
  v_had  boolean;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES (v_uid, 'p0a-user@caros.local', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated');

  /* `handle_new_user` trigger'ı profiles satırını açmış olabilir; açmadıysa
     biz açarız. Bireysel kullanıcı → company_id NULL (filo yolu DEĞİL). */
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    INSERT INTO public.profiles (id, role, full_name)
    VALUES (v_uid, 'individual', 'P0A_TEST_USER');
  END IF;

  /* HALKA 5 için prod şemasını SİMÜLE et: kalıcı kod kolonu.
     Prod'da bu kolon NOT NULL'dur ve varsayılanı ÜRETİLİR. */
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicles' AND column_name='pairing_code'
  ) INTO v_had;

  IF NOT v_had THEN
    ALTER TABLE public.vehicles
      ADD COLUMN pairing_code text NOT NULL
      DEFAULT upper(left(replace(gen_random_uuid()::text, '-', ''), 6));
  END IF;

  INSERT INTO ix VALUES ('uid', v_uid::text), ('device', v_dev),
                        ('had_pairing_col', v_had::text);
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — İLK KAYIT: anahtar ÜRETİLİR, BİR KEZ döner, kod da döner
-- Bu halka düşerse yeni cihazlar HİÇ kurulamaz (ürün ölür).
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE res jsonb; v_dev text;
BEGIN
  SELECT v INTO v_dev FROM ix WHERE k='device';
  res := public.register_vehicle(v_dev, 'P0A_ARAC');

  IF res->>'vehicle_id' IS NULL THEN
    RAISE EXCEPTION 'HALKA 1 DUSTU: vehicle_id donmedi';
  END IF;
  IF NOT (res ? 'api_key') OR length(coalesce(res->>'api_key','')) = 0 THEN
    RAISE EXCEPTION 'HALKA 1 DUSTU: ilk kayitta ham anahtar DONMEDI — cihaz kurulamaz';
  END IF;
  IF coalesce((res->>'already_provisioned')::boolean, true) <> false THEN
    RAISE EXCEPTION 'HALKA 1 DUSTU: ilk kayit already_provisioned=false olmali';
  END IF;
  IF coalesce(res->>'linking_code','') !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'HALKA 1 DUSTU: 6 haneli kod uretilmedi';
  END IF;

  INSERT INTO ix VALUES ('vehicle', res->>'vehicle_id'),
                        ('key_first', res->>'api_key'),
                        ('code_first', res->>'linking_code');
  RAISE NOTICE 'HALKA 1 GECTI — ilk kayit anahtari + kodu uretti';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — İKİNCİ KAYIT: ham anahtar DÖNMEZ  (asıl güvenlik kapısı)
--
-- Eski gövde burada `coalesce(api_key_hash, api_key)` döndürüyordu: kayıtlı
-- bir `device_id` bilen HERKES aracın cihaz kimliğini alabiliyordu.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE
  res jsonb; v_dev text; v_veh uuid; v_key_first text; v_stored text; v_code text;
BEGIN
  SELECT v INTO v_dev       FROM ix WHERE k='device';
  SELECT v INTO v_key_first FROM ix WHERE k='key_first';
  SELECT v::uuid INTO v_veh FROM ix WHERE k='vehicle';
  SELECT v INTO v_code      FROM ix WHERE k='code_first';

  res := public.register_vehicle(v_dev, 'P0A_ARAC');

  -- (a) AYNI araç dönmeli — yeni araç AÇILMAMALI (837 sahipsiz araç dersi)
  IF (res->>'vehicle_id')::uuid <> v_veh THEN
    RAISE EXCEPTION 'HALKA 2 DUSTU: ayni device_id YENI arac acti (arac sismesi)';
  END IF;

  -- (b) ANAHTAR SIZMAMALI — alan HİÇ bulunmamalı (null bile değil)
  IF res ? 'api_key' THEN
    RAISE EXCEPTION 'HALKA 2 DUSTU: mevcut cihazin HAM ANAHTARI yanitta donuyor';
  END IF;

  -- (c) Deterministik sonuç
  IF coalesce((res->>'already_provisioned')::boolean, false) <> true THEN
    RAISE EXCEPTION 'HALKA 2 DUSTU: already_provisioned=true donmedi';
  END IF;

  -- (d) Saklı anahtar DEĞİŞMEMELİ — cihaz kilitlenmemeli
  SELECT coalesce(api_key_hash, api_key) INTO v_stored
    FROM public.vehicles WHERE id = v_veh;
  IF v_stored IS DISTINCT FROM v_key_first THEN
    RAISE EXCEPTION 'HALKA 2 DUSTU: sakli anahtar DEGISTI — sahadaki cihaz kilitlenirdi';
  END IF;

  -- (e) Kod üretimi SÜRMELİ ("Mobil Bağlantı" ekranı buna bağlı)
  IF coalesce(res->>'linking_code','') !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'HALKA 2 DUSTU: ikinci cagride kod uretilmedi — eslestirme ekrani olur';
  END IF;

  -- (f) Araç başına TEK aktif kod: eski kod geçersizleşmeli
  IF EXISTS (SELECT 1 FROM public.vehicle_linking_codes
              WHERE vehicle_id = v_veh AND code = v_code) THEN
    RAISE EXCEPTION 'HALKA 2 DUSTU: eski kod hala gecerli — arac basina tek kod bozuldu';
  END IF;

  INSERT INTO ix VALUES ('code_second', res->>'linking_code');
  RAISE NOTICE 'HALKA 2 GECTI — ham anahtar SIZMIYOR, sakli anahtar korunuyor, kod suruyor';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — GEÇERLİ KISA ÖMÜRLÜ KOD İLE EŞLEŞTİRME ÇALIŞIR
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE res jsonb; v_uid uuid; v_veh uuid; v_code text;
BEGIN
  SELECT v::uuid INTO v_uid  FROM ix WHERE k='uid';
  SELECT v::uuid INTO v_veh  FROM ix WHERE k='vehicle';
  SELECT v INTO v_code       FROM ix WHERE k='code_second';

  res := public.pair_vehicle_to_user(v_code, v_uid);

  IF (res->>'vehicle_id')::uuid <> v_veh THEN
    RAISE EXCEPTION 'HALKA 3 DUSTU: yanlis arac eslestirildi';
  END IF;
  IF res->>'role' <> 'owner' THEN
    RAISE EXCEPTION 'HALKA 3 DUSTU: bireysel kullanici owner olmali, gelen: %', res->>'role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_pairings
                  WHERE user_id = v_uid AND vehicle_id = v_veh) THEN
    RAISE EXCEPTION 'HALKA 3 DUSTU: vehicle_pairings satiri YAZILMADI';
  END IF;
  IF (SELECT owner_id FROM public.vehicles WHERE id = v_veh) IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'HALKA 3 DUSTU: owner_id yazilmadi';
  END IF;

  RAISE NOTICE 'HALKA 3 GECTI — kisa omurlu kod ile eslestirme calisiyor';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — TÜKETİLEN KOD TEKRAR KULLANILAMAZ (replay kapalı)
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE v_uid uuid; v_code text; v_ok boolean := false;
BEGIN
  SELECT v::uuid INTO v_uid FROM ix WHERE k='uid';
  SELECT v INTO v_code      FROM ix WHERE k='code_second';

  BEGIN
    PERFORM public.pair_vehicle_to_user(v_code, v_uid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%invalid_or_expired_code%' THEN v_ok := true; END IF;
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'HALKA 4 DUSTU: tuketilmis kod TEKRAR kabul edildi (replay acik)';
  END IF;

  IF EXISTS (SELECT 1 FROM public.vehicle_linking_codes WHERE code = v_code) THEN
    RAISE EXCEPTION 'HALKA 4 DUSTU: kod tuketildikten sonra SILINMEMIS';
  END IF;

  RAISE NOTICE 'HALKA 4 GECTI — kod tek kullanimlik, replay kapali';
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — KALICI `vehicles.pairing_code` İLE EŞLEŞTİRME YAPILAMAZ
--
-- 067'de bu dal VARDI. Kolon NOT NULL, hiç sona ermez, hiç tüketilmez →
-- kodu bir kez görmüş herkes SÜRESİZ eşleştirebiliyordu.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE
  v_uid uuid; v_veh uuid; v_perm text; v_ok boolean := false; v_dev2 text;
  res jsonb;
BEGIN
  SELECT v::uuid INTO v_uid FROM ix WHERE k='uid';

  /* TEMİZ ARAÇ: HALKA 3 zaten eşleştirdiği için aynı araçta "başarı" ile
     "arka kapı" ayırt edilemezdi. Yeni bir araç açılır. */
  v_dev2 := 'P0A_DEVICE2_' || replace(gen_random_uuid()::text, '-', '');
  res := public.register_vehicle(v_dev2, 'P0A_ARAC2');
  v_veh := (res->>'vehicle_id')::uuid;

  /* Kalıcı kodu TAMAMEN RAKAM yap: `pair_vehicle_to_user` `^[0-9]{6}$` şartı
     koşar. Harf içeren kod zaten format kapısında elenirdi ve bu halka
     "geçti" görünüp hiçbir şey kanıtlamazdı (sahte yeşil). */
  v_perm := '246813';
  UPDATE public.vehicles SET pairing_code = v_perm WHERE id = v_veh;

  /* Geçici kodu SİL: kalıcı kolon TEK aday kalsın. */
  DELETE FROM public.vehicle_linking_codes WHERE vehicle_id = v_veh;

  BEGIN
    PERFORM public.pair_vehicle_to_user(v_perm, v_uid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%invalid_or_expired_code%' THEN v_ok := true; END IF;
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION
      'HALKA 5 DUSTU: KALICI pairing_code ile eslestirme YAPILDI — suresiz arka kapi ACIK';
  END IF;

  IF EXISTS (SELECT 1 FROM public.vehicle_pairings
              WHERE user_id = v_uid AND vehicle_id = v_veh) THEN
    RAISE EXCEPTION 'HALKA 5 DUSTU: kalici kod ile pairing satiri yazilmis';
  END IF;

  RAISE NOTICE 'HALKA 5 GECTI — kalici pairing_code arka kapisi KAPALI';
END
$ring5$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 6 — YETKİ YÜZEYİ
--   · register_vehicle    : PUBLIC KAPALI · anon AÇIK (cihaz bootstrap'ı yaşar)
--   · pair_vehicle_to_user: anon/authenticated KAPALI · service_role AÇIK
--   · pair_vehicle_by_code: (varsa) her istemci rolüne KAPALI
-- ═════════════════════════════════════════════════════════════════════════
DO $ring6$
DECLARE r record;
BEGIN
  IF has_function_privilege('public', 'public.register_vehicle(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HALKA 6 DUSTU: register_vehicle hala PUBLIC''e acik';
  END IF;
  IF NOT has_function_privilege('anon', 'public.register_vehicle(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HALKA 6 DUSTU: anon register_vehicle cagiramiyor — cihaz bootstrap KIRILIR';
  END IF;

  IF has_function_privilege('anon', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HALKA 6 DUSTU: pair_vehicle_to_user istemciye acik (sahiplik kapilari atlanabilir)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HALKA 6 DUSTU: service_role eslestirme yapamiyor — /api/vehicle/link olur';
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('pair_vehicle_by_code','pair_vehicle')
  LOOP
    IF has_function_privilege('public', r.sig::text, 'EXECUTE')
       OR has_function_privilege('anon', r.sig::text, 'EXECUTE')
       OR has_function_privilege('authenticated', r.sig::text, 'EXECUTE') THEN
      RAISE EXCEPTION 'HALKA 6 DUSTU: ikinci eslestirme otoritesi hala cagrilabilir → %', r.sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'HALKA 6 GECTI — yetki yuzeyi daraltildi, cihaz bootstrap yasiyor';
END
$ring6$;

SELECT '6 HALKA DA GECTI' AS sonuc;

ROLLBACK;
