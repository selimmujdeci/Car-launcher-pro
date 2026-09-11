-- ═══════════════════════════════════════════════════════════════════════════
-- 074  SEYİR DEFTERİ BULUT ÖZETİ — KAPSAM · İDEMPOTENS · GİZLİLİK MATRİSİ
--
--   MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres \
--     supabase_db_fleetval psql -U postgres -d postgres \
--     < supabase/tests/074_trip_journal_matrix.sql
--
--   ya da:  node scripts/run-db-matrix.mjs \
--             supabase/tests/074_trip_journal_matrix.sql "7 HALKA DA GECTI"
--
-- ── NEDEN VAR ─────────────────────────────────────────────────────────────
-- "Arabam Cebimde" Seyir Defteri, kullanıcının GEÇMİŞ SÜRÜŞLERİNİ gösterir.
-- Bu, filo panelinden farklı bir maruziyet sınıfıdır: ekranı açan kişi bir
-- yönetici değil, telefonundaki sıradan bir kullanıcıdır ve istemciden
-- gelen `vehicle_id` KULLANICI KONTROLÜNDEDİR. Tek bir gevşek policy,
-- birinin başkasının nereye gittiğini okumasına yeter.
--
-- Bu dosya yedi halkayı AYRI AYRI ölçer ve hiçbirini türetmez:
--   1. Sahip KENDİ aracının yolculuklarını OKUR              (PASS kanıtı)
--   2. YABANCI kullanıcı aynı `vehicle_id` ile HİÇBİR ŞEY görmez (DENY)
--   3. Oturumsuz (anon) okuma DENY + RPC yetkisi KAPALI
--   4. Aynı `trip_key` + aynı/daha düşük revizyon → DUPLICATE, satır ARTMAZ
--   5. Daha yüksek revizyon → UPDATED, satır yine ARTMAZ (düzeltme)
--   6. Seyir alanları (alan adı · gerekçe · tamamlanma) GİDİP GERİ GELİR
--   7. Tabloda KOORDİNAT/ROTA kolonu YOKTUR (tam rota buluta gitmez)
--
-- ── "SAHTE PASS" TUZAĞI ───────────────────────────────────────────────────
-- Yabancı kullanıcı olarak 0 satır görmek TEK BAŞINA koruma kanıtı DEĞİLDİR:
-- tablo boş da olabilirdi. Bu yüzden her DENY ölçümünden ÖNCE sahibin AYNI
-- sorguyla satır GÖRDÜĞÜ kanıtlanır. Sahip 0 görüyorsa test "GEÇTİ" demez,
-- KANITLANAMADI diye DÜŞER.
--
-- ── ÜRETİME DOKUNMAZ ──────────────────────────────────────────────────────
-- Yalnız YEREL veritabanında koşar ve `ROLLBACK` ile biter.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

/* Oturum taklidi.
 *
 * İKİ ayar da yazılır: `auth.uid()`in iki yaygın gövdesi vardır — eski
 * sürümler `request.jwt.claim.sub`u, yeniler `request.jwt.claims`->>'sub'u
 * okur. Yalnız birini yazmak, ötekini kullanan bir ortamda `auth.uid()`i
 * NULL yapar; o zaman HER SORGU 0 satır döner ve matris **DENY testlerini
 * sahte biçimde GEÇİRİR**. Bu yüzden ikisi birlikte kurulur ve HALKA 1
 * (sahip GERÇEKTEN görüyor mu) bu tuzağın kapısıdır.
 */
CREATE FUNCTION pg_temp.login(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_uid::text)::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
END $$;

CREATE FUNCTION pg_temp.logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

CREATE TEMP TABLE tj_ids (k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE tj_key (k text PRIMARY KEY, v text);

-- ── Kurulum: İKİ ayrı birey + İKİ ayrı araç ─────────────────────────────
--
-- Araçlar BİREYSEL sahiplik ile kurulur (`owner_id`), şirket ile değil:
-- "Arabam Cebimde" bir filo yüzeyi DEĞİLDİR ve tam da bu yol denetlenmeli.
DO $setup$
DECLARE
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  va uuid; vb uuid;
  apia text; apib text;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
    (ua, 'tj-owner-a@caros.local', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated'),
    (ub, 'tj-owner-b@caros.local', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated');

  /* Bireysel kullanıcı: şirket YOK. `company_id` dolu olsaydı şirket kapısı
     testi sessizce geçirirdi ve sahiplik kapısı HİÇ ölçülmemiş olurdu. */
  UPDATE public.profiles SET company_id = NULL, role = 'individual',
         full_name = 'TJ_OWNER_A' WHERE id = ua;
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, company_id, role, full_name)
    VALUES (ua, NULL, 'individual', 'TJ_OWNER_A');
  END IF;

  UPDATE public.profiles SET company_id = NULL, role = 'individual',
         full_name = 'TJ_OWNER_B' WHERE id = ub;
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, company_id, role, full_name)
    VALUES (ub, NULL, 'individual', 'TJ_OWNER_B');
  END IF;

  apia := 'tj_api_a_' || replace(gen_random_uuid()::text, '-', '');
  apib := 'tj_api_b_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.vehicles (owner_id, name, api_key)
  VALUES (ua, 'TJ_VEHICLE_A', apia) RETURNING id INTO va;
  INSERT INTO public.vehicles (owner_id, name, api_key)
  VALUES (ub, 'TJ_VEHICLE_B', apib) RETURNING id INTO vb;

  INSERT INTO tj_ids VALUES ('user_a', ua), ('user_b', ub),
                            ('veh_a', va), ('veh_b', vb);
  INSERT INTO tj_key VALUES ('api_a', apia), ('api_b', apib);
END
$setup$;

-- ── Cihaz yazımı: A aracına bir yolculuk ────────────────────────────────
DO $seed$
DECLARE api text; res jsonb;
BEGIN
  SELECT v INTO api FROM tj_key WHERE k = 'api_a';
  PERFORM pg_temp.logout();   -- cihaz yolu oturum KULLANMAZ, api_key kullanır

  res := public.upload_vehicle_trip(
    p_api_key       => api,
    p_trip_key      => 't1757600000-1757605700-6430',
    p_trip_id       => 'trip-journal-a',
    p_revision      => 1,
    p_started_at_ms => (extract(epoch from now()) * 1000)::bigint - 7_200_000,
    p_ended_at_ms   => (extract(epoch from now()) * 1000)::bigint - 1_500_000,
    p_metrics       => jsonb_build_object(
                         'distanceKm', 64.3, 'durationMin', 95,
                         'averageSpeedKmh', 49, 'maximumSpeedKmh', 112,
                         'movingTimeMin', 78, 'idleTimeMin', 17),
    p_score         => 86,
    p_confidence    => 'HIGH',
    p_sources       => jsonb_build_object('distance','MEASURED'),
    p_journal       => jsonb_build_object(
                         'startArea','Tarsus', 'endArea','Mersin',
                         'endReason','IDLE_WINDOW',
                         'completedAtMs',
                           (extract(epoch from now()) * 1000)::bigint - 1_500_000,
                         'schemaVersion', 1)
  );

  IF res->>'state' <> 'CREATED' THEN
    RAISE EXCEPTION '074 KURULUM: ilk yazim CREATED degil: %', res;
  END IF;
END
$seed$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 1 — SAHİP KENDİ aracının yolculuklarını OKUR
-- ═════════════════════════════════════════════════════════════════════════
DO $ring1$
DECLARE ua uuid; va uuid; n_rpc integer; n_tbl integer;
BEGIN
  SELECT v INTO ua FROM tj_ids WHERE k = 'user_a';
  SELECT v INTO va FROM tj_ids WHERE k = 'veh_a';
  PERFORM pg_temp.login(ua);

  SELECT count(*) INTO n_rpc FROM public.list_vehicle_trips(va, 50);
  IF n_rpc < 1 THEN
    RAISE EXCEPTION '074 HALKA 1 DUSTU -- sahip KENDI aracinin yolculugunu GOREMIYOR (n=%)', n_rpc;
  END IF;

  /* RLS DE sahibi geçirmeli. Bu ölçüm `authenticated` ROLÜYLE yapılır:
     superuser RLS'i BYPASS eder ve süperuser'la ölçmek hiçbir şey kanıtlamaz.
     Ayrıca bu, HALKA 2'nin DENY ölçümünün "her şey kapalı" yüzünden değil
     KAPSAM yüzünden 0 döndüğünün kanıtıdır. */
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_tbl FROM public.vehicle_trips WHERE vehicle_id = va;
  RESET ROLE;

  IF n_tbl < 1 THEN
    RAISE EXCEPTION '074 HALKA 1 DUSTU -- RLS sahibi de engelliyor (tablo n=%)', n_tbl;
  END IF;

  RAISE NOTICE '074 HALKA 1 GECTI -- sahip okuma PASS (RPC % satir · RLS % satir)', n_rpc, n_tbl;
END
$ring1$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 2 — YABANCI kullanıcı aynı `vehicle_id` ile HİÇBİR ŞEY görmez
--
-- İstemci `vehicle_id`yi değiştirerek veri okuyamaz: araç kimliği yetkiyi
-- ÜRETMEZ, yalnız DARALTIR.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring2$
DECLARE ub uuid; va uuid; n_owner integer; n_other integer; n_tbl integer;
BEGIN
  SELECT v INTO ub FROM tj_ids WHERE k = 'user_b';
  SELECT v INTO va FROM tj_ids WHERE k = 'veh_a';

  /* SAHTE PASS KAPISI: önce satırın GERÇEKTEN var olduğu kanıtlanır. */
  SELECT count(*) INTO n_owner FROM public.vehicle_trips WHERE vehicle_id = va;
  IF n_owner < 1 THEN
    RAISE EXCEPTION '074 HALKA 2 KANITLANAMADI -- A aracinda hic yolculuk yok, DENY olculemez';
  END IF;

  PERFORM pg_temp.login(ub);

  SELECT count(*) INTO n_other FROM public.list_vehicle_trips(va, 50);
  IF n_other > 0 THEN
    RAISE EXCEPTION '074 HALKA 2 DUSTU -- YABANCI kullanici baskasinin yolculugunu OKUYOR (% satir)', n_other;
  END IF;

  /* RPC yolu kapalıysa doğrudan tablo yolu da kapalı OLMALI (RLS).
     Ölçüm `authenticated` ROLÜYLE yapılır — superuser RLS'i BYPASS eder ve
     onunla ölçmek bu halkayı anlamsız kılardı. */
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_tbl FROM public.vehicle_trips WHERE vehicle_id = va;
  RESET ROLE;

  IF n_tbl > 0 THEN
    RAISE EXCEPTION '074 HALKA 2 DUSTU -- RLS acik degil: yabanci tabloyu dogrudan OKUYOR (% satir)', n_tbl;
  END IF;

  RAISE NOTICE '074 HALKA 2 GECTI -- capraz arac okuma DENY (RPC + tablo)';
END
$ring2$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 3 — OTURUMSUZ okuma DENY + `anon` yetkisi KAPALI
-- ═════════════════════════════════════════════════════════════════════════
DO $ring3$
DECLARE va uuid; n integer;
BEGIN
  SELECT v INTO va FROM tj_ids WHERE k = 'veh_a';
  PERFORM pg_temp.logout();

  SELECT count(*) INTO n FROM public.list_vehicle_trips(va, 50);
  IF n > 0 THEN
    RAISE EXCEPTION '074 HALKA 3 DUSTU -- oturumsuz okuma satir DONDURDU (%)', n;
  END IF;

  IF has_function_privilege('anon','public.list_vehicle_trips(uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION '074 HALKA 3 DUSTU -- anon okuma RPC yetkisi ACIK';
  END IF;
  IF has_table_privilege('anon','public.vehicle_trips','SELECT') THEN
    RAISE EXCEPTION '074 HALKA 3 DUSTU -- anon tablo SELECT yetkisi ACIK';
  END IF;

  RAISE NOTICE '074 HALKA 3 GECTI -- oturumsuz okuma DENY, anon kapali';
END
$ring3$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 4 — AYNI trip_key + AYNI/DAHA DÜŞÜK revizyon → DUPLICATE
--
-- Çevrimdışı kuyruğun tekrar denemesi mesafeyi İKİYE KATLAMAMALI.
-- ═════════════════════════════════════════════════════════════════════════
DO $ring4$
DECLARE api text; va uuid; res jsonb; n_before integer; n_after integer; d numeric;
BEGIN
  SELECT v INTO api FROM tj_key WHERE k = 'api_a';
  SELECT v INTO va  FROM tj_ids WHERE k = 'veh_a';
  PERFORM pg_temp.logout();

  SELECT count(*) INTO n_before FROM public.vehicle_trips WHERE vehicle_id = va;

  res := public.upload_vehicle_trip(
    p_api_key  => api,
    p_trip_key => 't1757600000-1757605700-6430',
    p_revision => 1,
    p_metrics  => jsonb_build_object('distanceKm', 64.3)
  );
  IF res->>'state' <> 'DUPLICATE' THEN
    RAISE EXCEPTION '074 HALKA 4 DUSTU -- ayni revizyon DUPLICATE degil: %', res;
  END IF;

  SELECT count(*) INTO n_after FROM public.vehicle_trips WHERE vehicle_id = va;
  IF n_after <> n_before THEN
    RAISE EXCEPTION '074 HALKA 4 DUSTU -- tekrar gonderim satir URETTI (% -> %)', n_before, n_after;
  END IF;

  SELECT distance_km INTO d FROM public.vehicle_trips
   WHERE vehicle_id = va AND trip_key = 't1757600000-1757605700-6430';
  IF d <> 64.3 THEN
    RAISE EXCEPTION '074 HALKA 4 DUSTU -- mesafe degisti (beklenen 64.3, gelen %)', d;
  END IF;

  RAISE NOTICE '074 HALKA 4 GECTI -- tekrar yukleme idempotent (DUPLICATE, satir artmadi)';
END
$ring4$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 5 — DAHA YÜKSEK revizyon → UPDATED, satır yine ARTMAZ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring5$
DECLARE
  api text; va uuid; res jsonb; n_before integer; n_after integer; s smallint;
  started_before timestamptz; started_after timestamptz;
BEGIN
  SELECT v INTO api FROM tj_key WHERE k = 'api_a';
  SELECT v INTO va  FROM tj_ids WHERE k = 'veh_a';
  PERFORM pg_temp.logout();

  SELECT count(*) INTO n_before FROM public.vehicle_trips WHERE vehicle_id = va;
  SELECT started_at INTO started_before FROM public.vehicle_trips
   WHERE vehicle_id = va AND trip_key = 't1757600000-1757605700-6430';

  res := public.upload_vehicle_trip(
    p_api_key  => api,
    p_trip_key => 't1757600000-1757605700-6430',
    p_revision => 2,
    p_metrics  => jsonb_build_object('distanceKm', 64.3),
    p_score    => 91
  );
  IF res->>'state' <> 'UPDATED' THEN
    RAISE EXCEPTION '074 HALKA 5 DUSTU -- yuksek revizyon UPDATED degil: %', res;
  END IF;

  SELECT count(*) INTO n_after FROM public.vehicle_trips WHERE vehicle_id = va;
  IF n_after <> n_before THEN
    RAISE EXCEPTION '074 HALKA 5 DUSTU -- duzeltme satir URETTI (% -> %)', n_before, n_after;
  END IF;

  SELECT score INTO s FROM public.vehicle_trips
   WHERE vehicle_id = va AND trip_key = 't1757600000-1757605700-6430';
  IF s <> 91 THEN
    RAISE EXCEPTION '074 HALKA 5 DUSTU -- duzeltme uygulanmadi (skor %)', s;
  END IF;

  /* KİLİT: bu düzeltme başlangıç damgası GÖNDERMEDİ. Başlangıç saati
     DEĞİŞMEMELİDİR — eskiden `now()` yazılıyordu ve kullanıcı dün akşamki
     yolculuğu "bugün öğlen başladı" diye görüyordu. */
  SELECT started_at INTO started_after FROM public.vehicle_trips
   WHERE vehicle_id = va AND trip_key = 't1757600000-1757605700-6430';
  IF started_after <> started_before THEN
    RAISE EXCEPTION '074 HALKA 5 DUSTU -- duzeltme BASLANGIC saatini ezdi (% -> %)',
      started_before, started_after;
  END IF;

  RAISE NOTICE '074 HALKA 5 GECTI -- revizyon duzeltmesi UPDATED, satir artmadi, baslangic korundu';
END
$ring5$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 6 — SEYİR ALANLARI gidip GERİ gelir; bilinmeyen alan eskiyi EZMEZ
-- ═════════════════════════════════════════════════════════════════════════
DO $ring6$
DECLARE ua uuid; va uuid; r record;
BEGIN
  SELECT v INTO ua FROM tj_ids WHERE k = 'user_a';
  SELECT v INTO va FROM tj_ids WHERE k = 'veh_a';
  PERFORM pg_temp.login(ua);

  SELECT start_area, end_area, end_reason, completed_at, journal_schema_version
    INTO r FROM public.list_vehicle_trips(va, 50)
   WHERE trip_key = 't1757600000-1757605700-6430';

  IF r.start_area <> 'Tarsus' OR r.end_area <> 'Mersin' THEN
    RAISE EXCEPTION '074 HALKA 6 DUSTU -- alan adlari geri gelmedi (% -> %)', r.start_area, r.end_area;
  END IF;
  IF r.end_reason <> 'IDLE_WINDOW' THEN
    RAISE EXCEPTION '074 HALKA 6 DUSTU -- bitis gerekcesi kayip: %', r.end_reason;
  END IF;
  IF r.completed_at IS NULL THEN
    RAISE EXCEPTION '074 HALKA 6 DUSTU -- completed_at NULL (received_at ile karistirilir)';
  END IF;
  IF r.journal_schema_version <> 1 THEN
    RAISE EXCEPTION '074 HALKA 6 DUSTU -- sema surumu kayip: %', r.journal_schema_version;
  END IF;

  /* HALKA 5'teki düzeltme `p_journal` GÖNDERMEDİ — alan adları SİLİNMEMELİ.
     (Yukarıdaki kontroller bu düzeltmeden SONRA koşuyor; geçmeleri
     `coalesce` sözleşmesinin kanıtıdır.) */
  RAISE NOTICE '074 HALKA 6 GECTI -- seyir alanlari korundu, eksik alan eskiyi EZMEDI';
END
$ring6$;

-- ═════════════════════════════════════════════════════════════════════════
-- HALKA 7 — TAM ROTA BULUTA GELMEZ: koordinat/rota kolonu YOKTUR
-- ═════════════════════════════════════════════════════════════════════════
DO $ring7$
DECLARE bad text;
BEGIN
  SELECT string_agg(column_name, ', ') INTO bad
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicle_trips'
     AND (column_name IN ('lat','lng','latitude','longitude',
                          'start_lat','start_lng','end_lat','end_lng',
                          'route','polyline','route_trace','gps_trace')
          OR column_name ILIKE '%coord%'
          OR column_name ILIKE '%polyline%');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '074 HALKA 7 DUSTU -- vehicle_trips koordinat/rota kolonu tasiyor: %', bad;
  END IF;

  /* Alan adı METİN olmalı: sayısal olsaydı koordinat taşıyabilirdi. */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicle_trips'
       AND column_name IN ('start_area','end_area')
       AND data_type NOT IN ('text','character varying')
  ) THEN
    RAISE EXCEPTION '074 HALKA 7 DUSTU -- start_area/end_area metin DEGIL';
  END IF;

  RAISE NOTICE '074 HALKA 7 GECTI -- koordinat/rota kolonu YOK, alan adi METIN';
END
$ring7$;

DO $final$
BEGIN
  RAISE NOTICE 'SEYIR DEFTERI MATRISI: 7 HALKA DA GECTI.';
END
$final$;

ROLLBACK;
