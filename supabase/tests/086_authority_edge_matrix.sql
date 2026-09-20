-- ═══════════════════════════════════════════════════════════════════════════
-- 086  YETKİ KENAR DURUM MATRİSİ  (MRI Wave 7)
--
--   node scripts/run-db-matrix.mjs supabase/tests/086_authority_edge_matrix.sql "3 HALKA DA GEÇTİ"
--
-- NEDEN VAR: 083/084/085 matrisleri gerçek PostgreSQL üzerinde 20 halka
-- kanıtlıyor. Wave 7 kapsam taraması bunların DIŞINDA kalan ÜÇ kenar durumu
-- buldu. Bu dosya YALNIZ o üçünü kapatır — mevcut halkaları TEKRARLAMAZ.
--
--   HALKA 1  KİLİT EŞİĞİ SINIRI: 083/4f yalnız "5 hata → pin_locked" kanıtlıyor.
--            Eşik 1'e ya da 2'ye kayarsa o test YİNE GEÇER; yani AŞIRI SIKI bir
--            kilit (meşru sahibi kendi aracından kilitleyen regression) görünmez
--            kalır. Burada sınırın ALT tarafı ölçülür: 4 hatadan sonra doğru PIN
--            HÂLÂ geçmelidir. Kilit bir güvenlik kapısıdır, ama fail-closed'ın
--            bedeli sahibi dışarıda bırakmak olamaz.
--
--   HALKA 2  KİMLİKSİZ ÇAĞRI (auth.uid() NULL): kullanıcıya açık SECURITY
--            DEFINER RPC'leri, JWT claim'i olmayan bir oturumda fail-closed
--            olmalıdır. `authenticated` rolüne sahip olmak KİMLİK DEĞİLDİR;
--            rol taşınabilir, kimlik taşınamaz. Hiçbir halka bunu ölçmüyordu.
--
--   HALKA 3  SECURITY DEFINER search_path ÇİVİSİ: tanımlayıcı yetkisiyle koşan
--            bir fonksiyonun search_path'i çivilenmemişse, çağıran kendi
--            şemasını öne alıp fonksiyonun çağırdığı adları ele geçirebilir
--            (klasik ayrıcalık yükseltme). Bugün public şemadaki SECURITY
--            DEFINER fonksiyonlarının TAMAMI çivili; bu halka o durumu KATALOG
--            üzerinden kilitler ki ileride çivisiz bir fonksiyon sessizce
--            eklenemesin.
--
-- GERÇEK DAVRANIŞ: rol değiştirir (SET LOCAL ROLE), JWT claim kurar/kaldırır,
-- RPC çağırır ve PostgreSQL'in SONUCUNU ölçer. Kaynak metni okunmaz.
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

/* Yardımcı: bir rol + kullanıcı kimliğiyle bir ifade koş.
   p_uid NULL → JWT claim HİÇ kurulmaz (auth.uid() NULL). */
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_role text, p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  BEGIN
    EXECUTE p_sql INTO r;
  EXCEPTION WHEN OTHERS THEN
    r := 'ERR:' || SQLSTATE || ':' || left(SQLERRM, 120);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN r;
END $h$;

CREATE TEMP TABLE ek (k text PRIMARY KEY, v text);

DO $setup$
DECLARE
  ua uuid := gen_random_uuid();
  va uuid;
  ka text := gen_random_uuid()::text;
  r  text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (ua, 'a086@test.local');
  INSERT INTO public.profiles (id, role) VALUES (ua, 'individual') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.vehicles (name, owner_id, api_key_hash, e2e_public_key)
    VALUES ('ARAC_086', ua, encode(sha256(convert_to(ka,'UTF8')),'hex'), 'PUBKEY_086')
    RETURNING id INTO va;
  INSERT INTO public.vehicle_pairings (user_id, vehicle_id, role) VALUES (ua, va, 'owner');

  /* PIN kur: imza (araç, YENİ pin, mevcut pin DEFAULT NULL) — kayıtsız araçta
     sahibi mevcut PIN kanıtı olmadan kurabilir. */
  r := pg_temp.as_user('authenticated', ua,
        format($q$SELECT public.set_vehicle_pin(%L, '1234')::text$q$, va));
  IF (r::jsonb->>'ok') <> 'true' THEN
    RAISE EXCEPTION 'KURULUM DÜŞTÜ: PIN kurulamadı: %', r;
  END IF;

  INSERT INTO ek VALUES ('ua', ua::text), ('va', va::text), ('ka', ka);
END
$setup$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — KİLİT EŞİĞİNİN ALT SINIRI: 4 HATA SAHİBİ DIŞARIDA BIRAKMAZ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE ua uuid; va uuid; r text; i int; j jsonb;
BEGIN
  ua := (SELECT v FROM ek WHERE k='ua')::uuid;
  va := (SELECT v FROM ek WHERE k='va')::uuid;

  /* Sayaç temiz başlasın (083/4f ile aynı kanal: critical_pin_failed olayı). */
  DELETE FROM public.vehicle_events WHERE vehicle_id = va::text AND type = 'critical_pin_failed';

  -- 1a. DÖRT yanlış deneme: her biri reddedilmeli ama kilit AÇILMAMALI.
  FOR i IN 1..4 LOOP
    r := pg_temp.as_user('authenticated', ua, format(
      $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '0001', %L, now() + interval '5 min')::text$q$,
      va, 'n-086-1a-' || i));
    j := r::jsonb;
    IF (j->>'ok') <> 'false' THEN
      RAISE EXCEPTION 'HALKA 1a DÜŞTÜ: yanlış PIN kabul edildi (deneme %): %', i, r;
    END IF;
    IF (j->>'error') = 'pin_locked' THEN
      RAISE EXCEPTION 'HALKA 1a DÜŞTÜ: kilit % hatada açıldı — eşik 5''in ALTINA kaymış, meşru sahip dışarıda kalır', i;
    END IF;
  END LOOP;

  -- 1b. Dört hatadan SONRA doğru PIN hâlâ geçmeli (kilit kapısı sahibi yemedi).
  r := pg_temp.as_user('authenticated', ua, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-086-1b', now() + interval '5 min')::text$q$, va));
  j := r::jsonb;
  IF (j->>'error') = 'pin_locked' THEN
    RAISE EXCEPTION 'HALKA 1b DÜŞTÜ: 4 hatada kilitlendi — aşırı sıkı kilit sahibi kendi aracından kilitliyor: %', r;
  END IF;
  IF (j->>'ok') <> 'true' THEN
    RAISE EXCEPTION 'HALKA 1b DÜŞTÜ: 4 hata sonrası DOĞRU PIN reddedildi: %', r;
  END IF;

  /* Yan kanıt: doğru PIN gerçekten bir komut satırı üretti (kapı açıldı, sessiz
     bir "ok" değil). */
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_commands WHERE vehicle_id = va AND nonce = 'n-086-1b') THEN
    RAISE EXCEPTION 'HALKA 1b DÜŞTÜ: ok=true ama komut satırı YOK';
  END IF;

  DELETE FROM public.vehicle_events WHERE vehicle_id = va::text AND type = 'critical_pin_failed';
  RAISE NOTICE 'HALKA 1 GEÇTİ — kilit eşiği 5''in altına kaymıyor; 4 hatadan sonra sahip hâlâ girebiliyor';
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — KİMLİKSİZ ÇAĞRI (auth.uid() NULL) FAIL-CLOSED
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE va uuid; r text; n_before bigint; n_after bigint;
BEGIN
  va := (SELECT v FROM ek WHERE k='va')::uuid;
  SELECT count(*) INTO n_before FROM public.vehicle_commands WHERE vehicle_id = va;

  -- 2a. `authenticated` ROLÜ var, KİMLİK yok → kritik komut AÇILMAMALI.
  --     (Rol taşınabilir; kimlik taşınamaz. Rol tek başına yetki değildir.)
  r := pg_temp.as_user('authenticated', NULL, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-086-2a', now() + interval '5 min')::text$q$, va));
  IF r LIKE 'ERR:%' THEN
    NULL;  -- istisnayla reddetmek de fail-closed'dır
  ELSIF (r::jsonb->>'ok') <> 'false' THEN
    RAISE EXCEPTION 'HALKA 2a DÜŞTÜ: kimliksiz oturum DOĞRU PIN ile kritik komut açtı: %', r;
  END IF;

  -- 2b. Kimliksiz oturum PIN DEĞİŞTİREMEZ (hesap devralma yolu).
  --     (araç, YENİ '9999', mevcut '1234' — mevcut PIN'i BİLİYOR olsa bile.)
  r := pg_temp.as_user('authenticated', NULL, format(
    $q$SELECT public.set_vehicle_pin(%L, '9999', '1234')::text$q$, va));
  IF r LIKE 'ERR:%' THEN
    NULL;
  ELSIF (r::jsonb->>'ok') <> 'false' THEN
    RAISE EXCEPTION 'HALKA 2b DÜŞTÜ: kimliksiz oturum PIN değiştirdi: %', r;
  END IF;

  -- 2c. anon rolü de aynı şekilde kapalı.
  r := pg_temp.as_user('anon', NULL, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-086-2c', now() + interval '5 min')::text$q$, va));
  IF r LIKE 'ERR:%' THEN
    NULL;
  ELSIF (r::jsonb->>'ok') <> 'false' THEN
    RAISE EXCEPTION 'HALKA 2c DÜŞTÜ: anon kritik komut açtı: %', r;
  END IF;

  -- 2d. YAN KANIT: hiçbir kimliksiz çağrı satır bırakmadı (sessiz yazma yok).
  SELECT count(*) INTO n_after FROM public.vehicle_commands WHERE vehicle_id = va;
  IF n_after <> n_before THEN
    RAISE EXCEPTION 'HALKA 2d DÜŞTÜ: kimliksiz çağrılar % komut satırı bıraktı', n_after - n_before;
  END IF;

  -- 2e. PIN gerçekten değişmemiş olmalı: eski PIN hâlâ çalışıyor.
  r := pg_temp.as_user('authenticated', (SELECT v FROM ek WHERE k='ua')::uuid, format(
    $q$SELECT public.verify_and_send_critical_command(%L, 'unlock', '{}'::jsonb, '1234', 'n-086-2e', now() + interval '5 min')::text$q$, va));
  IF (r::jsonb->>'ok') <> 'true' THEN
    RAISE EXCEPTION 'HALKA 2e DÜŞTÜ: kimliksiz çağrı sonrası meşru PIN bozuldu: %', r;
  END IF;

  RAISE NOTICE 'HALKA 2 GEÇTİ — rol kimlik değildir: auth.uid() NULL iken kritik RPC''ler fail-closed';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — SECURITY DEFINER search_path ÇİVİSİ (katalog değişmezi)
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE unpinned text[]; total int;
BEGIN
  SELECT count(*) INTO total
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef;

  /* Ölçüm gerçekten çalışıyor mu? Katalog sorgusu boş küme döndürürse bu halka
     hiçbir şey kanıtlamadan yeşil olurdu. */
  IF total < 50 THEN
    RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: yalnız % SECURITY DEFINER fonksiyonu görüldü — ölçüm bozuk', total;
  END IF;

  SELECT coalesce(array_agg(sig ORDER BY sig), '{}')
    INTO unpinned
  FROM (
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%'
      )
  ) s;

  IF array_length(unpinned, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'HALKA 3 DÜŞTÜ: search_path ÇİVİSİZ SECURITY DEFINER fonksiyon(lar)ı — çağıran kendi şemasını öne alıp adları ele geçirebilir: %',
      array_to_string(unpinned, ', ');
  END IF;

  RAISE NOTICE 'HALKA 3 GEÇTİ — % SECURITY DEFINER fonksiyonunun TAMAMI search_path çivili', total;
END
$ring3$;

\echo
\echo '  ✔ 086 YETKİ KENAR DURUM MATRİSİ: 3 HALKA DA GEÇTİ'
\echo

ROLLBACK;
