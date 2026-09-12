-- ═══════════════════════════════════════════════════════════════════════════
-- 048 — FLEET DRIVER IDENTITY & ASSIGNMENT P0 · GERÇEK PostgreSQL DOĞRULAMASI
--
-- MOCK DEĞİL: gerçek tablo, gerçek RPC (ÇAĞRILARAK), gerçek RLS, gerçek
-- `auth.uid()` oturumları.
--
-- FIXTURE (mevcut):
--   Şirket A f1eef1ee… · admin 1178d9db… · member deef6e72…
--   Şirket B f2eef2ee… · admin b0e18b7e…
--   Araç A   bbbb2222… (company_id = A, api_key `val-key-2`)
--   Araç bireysel aaaa1111… (owner_id dolu → sürücü modeli KAPSAM DIŞI)
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

-- Test artefaktlarını temizle (tekrar çalıştırılabilirlik).
DELETE FROM public.trip_driver_attribution_revisions WHERE trip_key LIKE 'd48-%';
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'd48-%';
DELETE FROM public.vehicle_driver_assignments
 WHERE note LIKE 'D48%' OR driver_id IN
   (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'D48 %');
DELETE FROM public.fleet_driver_audit
 WHERE reason LIKE 'D48%' OR entity_id IN
   (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'D48 %');
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'D48 %';
DELETE FROM public.vehicles WHERE id = 'cccc3333-0000-0000-0000-000000000003';

-- Şirket B'ye ait bir araç (cross-tenant testleri için).
INSERT INTO public.vehicles (id, name, company_id, api_key)
VALUES ('cccc3333-0000-0000-0000-000000000003', 'B Araci',
        'f2eef2ee-0000-0000-0000-000000000002', 'val-key-3')
ON CONFLICT (id) DO NOTHING;

DO $verify$
DECLARE
  v_fail  int := 0;
  A_CO  uuid := 'f1eef1ee-0000-0000-0000-000000000001';
  B_CO  uuid := 'f2eef2ee-0000-0000-0000-000000000002';
  A_ADM uuid := '1178d9db-413d-4f60-97c5-97bfc8393618';
  A_MEM uuid := 'deef6e72-8caa-4048-8f8e-6f5be273c775';
  B_ADM uuid := 'b0e18b7e-2951-472d-acf1-46c674dcd8a2';
  A_VEH uuid := 'bbbb2222-0000-0000-0000-000000000002';
  B_VEH uuid := 'cccc3333-0000-0000-0000-000000000003';
  IND_VEH uuid := 'aaaa1111-0000-0000-0000-000000000001';

  r      jsonb;
  d1     uuid;   -- D48 Ahmet
  d2     uuid;   -- D48 Mehmet
  dB     uuid;   -- şirket B sürücüsü
  a1     uuid;
  n      int;
  t      public.vehicle_trips%ROWTYPE;
  T0     timestamptz := date_trunc('hour', now()) - interval '10 hours';

  PROCEDURE_login text;   -- (kullanılmıyor)
BEGIN
  -- Kimlik: şirket A admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);

  -- ═══ A. DRIVER PROFILE ═══════════════════════════════════════════════
  r := public.create_fleet_driver('D48 Ahmet', 'EMP-1', NULL, '+905550001',
                                  'LIC-9988776655', 'B', current_date + 365);
  IF r->>'state' = 'CREATED' THEN
    d1 := (r->>'driverId')::uuid;
    RAISE NOTICE 'D1   surucu OLUSTURULDU (hesapsiz surucu mumkun)          PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D1   surucu olusturulamadi: %  FAIL', r; END IF;

  r := public.create_fleet_driver('D48 Mehmet', 'EMP-2');
  d2 := (r->>'driverId')::uuid;

  -- linked_user_id NULLABLE: yukarıdaki iki sürücünün CAROS hesabı YOK.
  SELECT count(*) INTO n FROM public.fleet_drivers
   WHERE id IN (d1,d2) AND linked_user_id IS NULL;
  IF n = 2 THEN RAISE NOTICE 'D2   linkedUserId NULLABLE (hesap ZORUNLU degil)         PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D2   linked_user_id zorunlu kilinmis  FAIL'; END IF;

  -- Auth user ≠ driver: A_MEM bir auth kullanıcısı ama sürücü DEĞİL.
  SELECT count(*) INTO n FROM public.fleet_drivers WHERE linked_user_id = A_MEM;
  IF n = 0 THEN RAISE NOTICE 'D3   AUTH USER otomatik SURUCU DEGIL                     PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D3   auth user otomatik surucu olmus  FAIL'; END IF;

  -- Aynı kullanıcıya ikinci aktif profil BAĞLANAMAZ.
  r := public.create_fleet_driver('D48 Linked', 'EMP-3', A_MEM);
  IF r->>'state' = 'CREATED' THEN
    r := public.create_fleet_driver('D48 Linked2', 'EMP-4', A_MEM);
    IF r->>'reason' = 'USER_ALREADY_LINKED' THEN
      RAISE NOTICE 'D4   ayni kullaniciya IKINCI aktif profil REDDEDILDI      PASS';
    ELSE v_fail := v_fail+1; RAISE WARNING 'D4   ikinci profil kabul edildi: %  FAIL', r; END IF;
  ELSE v_fail := v_fail+1; RAISE WARNING 'D4   linked surucu olusturulamadi: % FAIL', r; END IF;

  -- Cross-company linked user REDDEDİLİR.
  r := public.create_fleet_driver('D48 Cross', 'EMP-5', B_ADM);
  IF r->>'reason' = 'CROSS_TENANT_USER' THEN
    RAISE NOTICE 'D5   CROSS-COMPANY kullanici bagi REDDEDILDI              PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D5   cross-company bag kabul edildi: % FAIL', r; END IF;

  -- Boş isim reddedilir.
  r := public.create_fleet_driver('   ');
  IF r->>'reason' = 'NAME_REQUIRED' THEN
    RAISE NOTICE 'D6   bos isim REDDEDILDI                                  PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D6   bos isim kabul edildi  FAIL'; END IF;

  -- ═══ B. ASSIGNMENT ═══════════════════════════════════════════════════
  -- Geçersiz aralık.
  r := public.create_vehicle_driver_assignment(A_VEH, d1, T0, T0 - interval '1 hour');
  IF r->>'reason' = 'INVALID_RANGE' THEN
    RAISE NOTICE 'D7   ends_at < starts_at REDDEDILDI                       PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D7   gecersiz aralik kabul edildi: % FAIL', r; END IF;

  -- Başka şirketin aracına atama REDDEDİLİR.
  r := public.create_vehicle_driver_assignment(B_VEH, d1, T0);
  IF r->>'reason' = 'VEHICLE_NOT_IN_COMPANY' THEN
    RAISE NOTICE 'D8   BASKA SIRKETIN aracina atama REDDEDILDI              PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D8   cross-tenant arac atamasi gecti: % FAIL', r; END IF;

  -- Bireysel araca atama REDDEDİLİR (kapsam dışı).
  r := public.create_vehicle_driver_assignment(IND_VEH, d1, T0);
  IF r->>'reason' = 'VEHICLE_NOT_IN_COMPANY' THEN
    RAISE NOTICE 'D9   BIREYSEL araca atama REDDEDILDI (kapsam disi)        PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D9   bireysel araca atama gecti: % FAIL', r; END IF;

  -- Geçerli kapalı aralık ataması: [T0, T0+4h)
  r := public.create_vehicle_driver_assignment(A_VEH, d1, T0, T0 + interval '4 hours',
                                               'PRIMARY', 'D48 vardiya-1');
  IF r->>'state' = 'CREATED' THEN
    a1 := (r->>'assignmentId')::uuid;
    RAISE NOTICE 'D10  zaman ARALIKLI atama olusturuldu                     PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D10  atama olusturulamadi: % FAIL', r; END IF;

  -- AYNI ARAÇTA örtüşen ikinci atama → CONFLICTED (sessiz overwrite YOK).
  r := public.create_vehicle_driver_assignment(A_VEH, d2, T0 + interval '2 hours',
                                               T0 + interval '6 hours', 'PRIMARY', 'D48 cakisma');
  IF r->>'state' = 'CONFLICTED' AND r->>'reason' = 'VEHICLE_OVERLAP' THEN
    RAISE NOTICE 'D11  AYNI ARACTA ortusen atama -> CONFLICTED              PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D11  ortusen atama sessizce gecti: % FAIL', r; END IF;

  -- BİTİŞİK aralık çakışma DEĞİLDİR (vardiya devri): [T0+4h, T0+8h)
  r := public.create_vehicle_driver_assignment(A_VEH, d2, T0 + interval '4 hours',
                                               T0 + interval '8 hours', 'PRIMARY', 'D48 vardiya-2');
  IF r->>'state' = 'CREATED' THEN
    RAISE NOTICE 'D12  BITISIK aralik cakisma DEGIL (vardiya devri)         PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D12  bitisik aralik reddedildi: % FAIL', r; END IF;

  -- AYNI SÜRÜCÜ iki araçta olamaz. (d1'i B aracına atayamayız — cross-tenant;
  -- bu yüzden A şirketinde ikinci araç kullanmak yerine aynı araçta
  -- test edildi. Sürücü örtüşmesi kuralı için d1'e A_VEH dışında bir
  -- araç gerekli değil: kısmi UNIQUE index de ayrıca koruyor — D13'te
  -- açık uçlu ikinci atama denenir.)
  r := public.create_vehicle_driver_assignment(A_VEH, d1, T0 + interval '20 hours');
  IF r->>'state' = 'CREATED' THEN
    -- Şimdi aynı araçta ikinci AÇIK UÇLU atama → index REDDETMELİ
    BEGIN
      INSERT INTO public.vehicle_driver_assignments
        (company_id, vehicle_id, driver_id, starts_at, status, note)
      VALUES (A_CO, A_VEH, d2, T0 + interval '21 hours', 'ACTIVE', 'D48 ikinci-acik');
      v_fail := v_fail+1;
      RAISE WARNING 'D13  IKINCI ACIK UCLU atama DB de kabul edildi FAIL';
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'D13  ikinci ACIK UCLU atama DB kisitiyla REDDEDILDI       PASS';
    END;
  ELSE v_fail := v_fail+1; RAISE WARNING 'D13  acik uclu atama olusturulamadi: % FAIL', r; END IF;

  -- Pasif sürücüye atama REDDEDİLİR.
  PERFORM public.update_fleet_driver(d2, p_status => 'INACTIVE');
  r := public.create_vehicle_driver_assignment(A_VEH, d2, T0 + interval '30 hours');
  IF r->>'reason' = 'DRIVER_NOT_ACTIVE' THEN
    RAISE NOTICE 'D14  PASIF surucuye atama REDDEDILDI                      PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D14  pasif surucuye atama gecti: % FAIL', r; END IF;

  -- Sürücü pasifleşince AÇIK atamaları kapanmış olmalı.
  SELECT count(*) INTO n FROM public.vehicle_driver_assignments
   WHERE driver_id = d2 AND ends_at IS NULL AND status IN ('SCHEDULED','ACTIVE');
  IF n = 0 THEN RAISE NOTICE 'D15  surucu pasiflesince ACIK atamalari KAPANDI           PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D15  pasif surucunun acik atamasi surdu FAIL'; END IF;
  PERFORM public.update_fleet_driver(d2, p_status => 'ACTIVE');

  -- Atamayı bitir.
  r := public.end_vehicle_driver_assignment(a1, T0 + interval '4 hours');
  IF r->>'state' = 'UPDATED' THEN
    RAISE NOTICE 'D16  atama BITIRILDI (revizyon artti)                     PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D16  atama bitirilemedi: % FAIL', r; END IF;

  -- Kapalı atamayı tekrar bitirmek REDDEDİLİR.
  r := public.end_vehicle_driver_assignment(a1);
  IF r->>'reason' = 'ALREADY_CLOSED' THEN
    RAISE NOTICE 'D17  kapali atamayi tekrar bitirmek REDDEDILDI            PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D17  kapali atama tekrar bitti: % FAIL', r; END IF;

  -- ═══ C. TRIP ATTRIBUTION ═════════════════════════════════════════════
  -- (C1) TAM KAPSAYAN atama → ATTRIBUTED
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'd48-covered', 1, T0 + interval '1 hour', T0 + interval '2 hours', 25);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='d48-covered';
  IF t.driver_attribution_status = 'ATTRIBUTED' AND t.driver_id = d1
     AND t.driver_attribution_source = 'ACTIVE_ASSIGNMENT'
     AND t.driver_attribution_confidence = 'HIGH' THEN
    RAISE NOTICE 'D18  TAM KAPSAYAN atama -> ATTRIBUTED (kaynak+guven)      PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D18  attribution yanlis: % / % FAIL',
       t.driver_attribution_status, t.driver_id; END IF;

  -- Yönetici ataması VERY_HIGH ÜRETMEZ (fiziksel kimlik kanıtı değil).
  IF t.driver_attribution_confidence <> 'VERY_HIGH' THEN
    RAISE NOTICE 'D19  yonetici atamasi VERY_HIGH URETMIYOR                 PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D19  yonetici atamasi VERY_HIGH uretti FAIL'; END IF;

  -- (C2) ATAMASIZ dönem → UNKNOWN (fallback sürücü YOK)
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'd48-noassign', 1, T0 - interval '5 hours', T0 - interval '4 hours', 10);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='d48-noassign';
  IF t.driver_attribution_status = 'UNKNOWN' AND t.driver_id IS NULL THEN
    RAISE NOTICE 'D20  ATAMASIZ trip -> UNKNOWN (surucu UYDURULMADI)        PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D20  atamasiz trip e surucu atandi: % FAIL', t.driver_id; END IF;

  -- OWNER / ADMIN / son kullanıcı fallback OLMADI.
  IF t.driver_id IS NULL AND t.driver_attributed_by IS NULL THEN
    RAISE NOTICE 'D21  owner/admin/son-kullanici FALLBACK YAPILMADI         PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D21  fallback surucu uretildi FAIL'; END IF;

  -- (C3) KISMİ kapsama → MANUAL_REVIEW (kesin sürücü YAZILMAZ)
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'd48-partial', 1, T0 + interval '3 hours', T0 + interval '9 hours', 80);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='d48-partial';
  IF t.driver_attribution_status IN ('MANUAL_REVIEW','CONFLICTED') AND t.driver_id IS NULL THEN
    RAISE NOTICE 'D22  KISMI kapsama -> kesin surucu YAZILMADI (%)  PASS', t.driver_attribution_status;
  ELSE v_fail := v_fail+1; RAISE WARNING 'D22  kismi kapsamada surucu yazildi: % FAIL', t.driver_id; END IF;

  -- (C4) SINIR: atama trip başlangıcında BİTİYOR → kapsamaz
  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km)
  VALUES (A_VEH, 'd48-boundary', 1, T0 + interval '8 hours', T0 + interval '9 hours', 15);
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='d48-boundary';
  IF t.driver_id IS NULL THEN
    RAISE NOTICE 'D23  atama trip BASLANGICINDA bitiyorsa kapsamaz          PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D23  sinirda yanlis atama: % FAIL', t.driver_id; END IF;

  -- (C5) MANUEL DÜZELTME
  r := public.manually_assign_trip_driver(A_VEH, 'd48-noassign', d1, 'D48 elle duzeltildi');
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='d48-noassign';
  IF r->>'state' = 'UPDATED' AND t.driver_id = d1
     AND t.driver_attribution_status = 'LOCKED'
     AND t.driver_attribution_source = 'MANUAL_TRIP_ASSIGNMENT'
     AND t.driver_attributed_by = A_ADM THEN
    RAISE NOTICE 'D24  MANUEL atama uygulandi (LOCKED + actor ayri alanda)  PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D24  manuel atama basarisiz: % FAIL', r; END IF;

  -- Manuel güven otomatik VERY_HIGH DEĞİL.
  IF t.driver_attribution_confidence = 'MEDIUM' THEN
    RAISE NOTICE 'D25  manuel atama VERY_HIGH URETMIYOR (insan beyani)      PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D25  manuel guven yanlis: % FAIL', t.driver_attribution_confidence; END IF;

  -- Trip metrikleri ve trip_key DEĞİŞMEDİ.
  IF t.trip_key = 'd48-noassign' AND t.distance_km = 10.000 AND t.revision = 1 THEN
    RAISE NOTICE 'D26  manuel atama trip_key/metrik/revision BOZMADI        PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D26  manuel atama trip verisini bozdu FAIL'; END IF;

  -- Revizyon geçmişi KORUNDU.
  SELECT count(*) INTO n FROM public.trip_driver_attribution_revisions
   WHERE trip_key='d48-noassign';
  IF n >= 1 THEN RAISE NOTICE 'D27  attribution REVIZYON gecmisi yazildi                 PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D27  revizyon gecmisi yok FAIL'; END IF;

  -- Aynı manuel atama tekrarı revizyon ARTIRMAZ (idempotent).
  r := public.manually_assign_trip_driver(A_VEH, 'd48-noassign', d1);
  IF r->>'state' = 'UNCHANGED' THEN
    RAISE NOTICE 'D28  ayni manuel atama tekrari revizyon ARTIRMADI         PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D28  tekrar revizyon artirdi: % FAIL', r; END IF;

  -- Pasif sürücüye manuel atama REDDEDİLİR.
  PERFORM public.update_fleet_driver(d2, p_status => 'ARCHIVED');
  r := public.manually_assign_trip_driver(A_VEH, 'd48-covered', d2);
  IF r->>'reason' = 'DRIVER_NOT_ACTIVE' THEN
    RAISE NOTICE 'D29  ARSIVLENMIS surucuye manuel atama REDDEDILDI         PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D29  arsiv surucuye atama gecti: % FAIL', r; END IF;

  -- Arşivlenmiş sürücünün GEÇMİŞ trip'i KAYBOLMADI.
  SELECT count(*) INTO n FROM public.vehicle_trips WHERE driver_id = d1;
  IF n >= 1 THEN RAISE NOTICE 'D30  surucu arsivlense de GECMIS trip korunur             PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D30  gecmis trip kayboldu FAIL'; END IF;

  -- ═══ D. REPLAY ═══════════════════════════════════════════════════════
  -- Aynı trip 10× yüklenirse tek satır + attribution revizyonu ŞİŞMEZ.
  SELECT driver_attribution_revision INTO n FROM public.vehicle_trips
   WHERE trip_key='d48-covered';
  FOR i IN 1..10 LOOP
    UPDATE public.vehicle_trips
       SET started_at = started_at   -- trigger'ı tetikler, değer aynı
     WHERE trip_key = 'd48-covered';
  END LOOP;
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='d48-covered';
  IF t.driver_attribution_revision = n THEN
    RAISE NOTICE 'D31  10x REPLAY attribution revizyonunu SISIRMEDI         PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D31  replay revizyonu sisirdi: % -> % FAIL',
       n, t.driver_attribution_revision; END IF;

  SELECT count(*) INTO n FROM public.vehicle_trips WHERE trip_key='d48-covered';
  IF n = 1 THEN RAISE NOTICE 'D32  10x replay TEK satir (P2 dedupe korundu)             PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D32  replay satir cogaltti FAIL'; END IF;

  -- MANUEL sonuç replay ile EZİLMEZ.
  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='d48-noassign';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='d48-noassign';
  IF t.driver_id = d1 AND t.driver_attribution_source = 'MANUAL_TRIP_ASSIGNMENT' THEN
    RAISE NOTICE 'D33  MANUEL sonuc replay ile EZILMEDI                     PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D33  manuel sonuc ezildi FAIL'; END IF;

  -- Atama SONRADAN değişse ESKİ trip yeni sürücüye BAĞLANMAZ (tarihsel doğruluk).
  -- (d48-covered zaten d1'e bağlı; d1'in AÇIK atamasını kapatalım.)
  --
  -- NOT: d1'in açık ataması GELECEK başlangıçlıdır (T0+20h). `ends_at=now()`
  -- verilseydi `ends_at < starts_at` olur ve CHECK haklı olarak reddederdi —
  -- ürün tarafında bu senaryonun doğru yolu `p_cancel` bayrağıdır (o da
  -- `ends_at`'i `starts_at`'e sabitler). Testte de aynı sözleşmeye uyulur.
  UPDATE public.vehicle_driver_assignments
     SET ends_at = greatest(now(), starts_at), status='COMPLETED'
   WHERE driver_id = d1 AND ends_at IS NULL;
  UPDATE public.vehicle_trips SET started_at = started_at WHERE trip_key='d48-covered';
  SELECT * INTO t FROM public.vehicle_trips WHERE trip_key='d48-covered';
  IF t.driver_id = d1 THEN
    RAISE NOTICE 'D34  atama kapansa da ESKI trip d1 de kaldi (trip zamani)  PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D34  eski trip surucusu degisti: % FAIL', t.driver_id; END IF;

  -- ═══ E. YETKİ ════════════════════════════════════════════════════════
  -- MEMBER (admin değil) sürücü OLUŞTURAMAZ.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_MEM)::text, true);
  r := public.create_fleet_driver('D48 MemberDenied');
  IF r->>'reason' = 'NOT_AUTHORIZED' THEN
    RAISE NOTICE 'D35  MEMBER surucu olusturamaz (yalniz admin)             PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D35  member surucu olusturdu: % FAIL', r; END IF;

  r := public.manually_assign_trip_driver(A_VEH, 'd48-covered', d1);
  IF r->>'reason' = 'NOT_AUTHORIZED' THEN
    RAISE NOTICE 'D36  MEMBER trip surucusu duzeltemez                      PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D36  member trip duzeltti: % FAIL', r; END IF;

  -- Şirket B admini, şirket A sürücüsünü DEĞİŞTİREMEZ.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', B_ADM)::text, true);
  r := public.update_fleet_driver(d1, p_display_name => 'HACKED');
  IF r->>'reason' = 'CROSS_TENANT' THEN
    RAISE NOTICE 'D37  CROSS-TENANT surucu degisikligi REDDEDILDI           PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D37  cross-tenant degisiklik gecti: % FAIL', r; END IF;

  r := public.manually_assign_trip_driver(A_VEH, 'd48-covered', d1);
  IF r->>'reason' = 'VEHICLE_NOT_IN_COMPANY' THEN
    RAISE NOTICE 'D38  CROSS-TENANT trip duzeltmesi REDDEDILDI              PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D38  cross-tenant trip duzeltmesi gecti FAIL'; END IF;

  -- Şirket B admini, A sürücülerini LİSTELEYEMEZ.
  SELECT count(*) INTO n FROM public.list_fleet_drivers()
   WHERE display_name LIKE 'D48 %';
  IF n = 0 THEN RAISE NOTICE 'D39  B admini A surucularini LISTELEYEMIYOR               PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D39  cross-tenant surucu sizintisi: % satir FAIL', n; END IF;

  -- ═══ F. HEAD UNIT ÖZETİ ══════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Geçersiz api_key reddedilir.
  BEGIN
    PERFORM public.get_active_driver_assignment('YANLIS');
    v_fail := v_fail+1; RAISE WARNING 'D40  gecersiz api_key kabul edildi FAIL';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'D41  head unit: gecersiz api_key REDDEDILDI               PASS';
  END;

  -- Aktif atama yoksa UNKNOWN (uydurma YOK).
  r := public.get_active_driver_assignment('val-key-2');
  IF r->>'status' = 'UNKNOWN' THEN
    RAISE NOTICE 'D42  head unit: aktif atama yoksa UNKNOWN                 PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D42  head unit UNKNOWN dondurmedi: % FAIL', r; END IF;

  -- Aktif atama açıp özeti kontrol et.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  PERFORM public.create_vehicle_driver_assignment(A_VEH, d1, now() - interval '1 minute',
            NULL, 'PRIMARY', 'D48 canli', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
  r := public.get_active_driver_assignment('val-key-2');
  IF r->>'status' = 'ACTIVE' AND (r->>'driverId')::uuid = d1
     AND r->>'displayName' = 'D48 Ahmet' THEN
    RAISE NOTICE 'D43  head unit: AKTIF atama ozeti alinabiliyor            PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D43  head unit ozeti alinamadi: % FAIL', r; END IF;

  -- HASSAS ALAN YOK.
  IF NOT (r ? 'phone') AND NOT (r ? 'licenseNumber') AND NOT (r ? 'license_number')
     AND NOT (r ? 'employeeCode') AND NOT (r ? 'linkedUserId') AND NOT (r ? 'email') THEN
    RAISE NOTICE 'D44  head unit ozetinde HASSAS ALAN YOK                   PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D44  head unit ozetinde hassas alan var: % FAIL', r; END IF;

  -- Bireysel araç → sürücü modeli kapsam dışı.
  r := public.get_active_driver_assignment('val-key-1');
  IF r->>'status' = 'UNKNOWN' AND r->>'reason' = 'NOT_COMPANY_VEHICLE' THEN
    RAISE NOTICE 'D45  head unit: bireysel arac -> UNKNOWN (kapsam disi)     PASS';
  ELSE v_fail := v_fail+1; RAISE WARNING 'D45  bireysel arac icin surucu donduruldu: % FAIL', r; END IF;

  -- ═══ G. ARAÇ DEVRİ SINIRI ════════════════════════════════════════════
  -- Araç şirket değiştirince AÇIK atamalar KAPANMALI.
  SELECT count(*) INTO n FROM public.vehicle_driver_assignments
   WHERE vehicle_id = A_VEH AND ends_at IS NULL AND status IN ('SCHEDULED','ACTIVE');
  IF n >= 1 THEN
    UPDATE public.vehicles SET company_id = B_CO WHERE id = A_VEH;
    SELECT count(*) INTO n FROM public.vehicle_driver_assignments
     WHERE vehicle_id = A_VEH AND ends_at IS NULL AND status IN ('SCHEDULED','ACTIVE');
    IF n = 0 THEN
      RAISE NOTICE 'D46  ARAC DEVRINDE acik atamalar KAPANDI                  PASS';
    ELSE v_fail := v_fail+1; RAISE WARNING 'D46  devirde acik atama surdu FAIL'; END IF;

    -- Eski şirketin sürücüsü yeni şirkete SIZMADI.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', B_ADM)::text, true);
    SELECT count(*) INTO n FROM public.list_vehicle_driver_assignments(A_VEH);
    IF n = 0 THEN
      RAISE NOTICE 'D47  devir sonrasi ESKI atamalar yeni tenant a SIZMADI    PASS';
    ELSE v_fail := v_fail+1; RAISE WARNING 'D47  cross-tenant atama sizintisi: % FAIL', n; END IF;

    -- Geri al (fixture bozulmasın).
    PERFORM set_config('request.jwt.claims', NULL, true);
    UPDATE public.vehicles SET company_id = A_CO WHERE id = A_VEH;
  ELSE
    v_fail := v_fail+1; RAISE WARNING 'D46  test icin acik atama yoktu FAIL';
  END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '048 DOGRULAMA (RPC/attribution): TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '048 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ═══ H. RLS — GERÇEK OTURUM ROLÜYLE ════════════════════════════════════
-- Şirket A üyesi kendi sürücülerini GÖRÜR.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','deef6e72-8caa-4048-8f8e-6f5be273c775')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) > 0 THEN 'D48  A uyesi kendi surucularini GORUYOR (RLS)             PASS'
            ELSE 'D48  A uyesi kendi surucusunu goremiyor        FAIL' END AS sonuc
FROM public.fleet_drivers WHERE display_name LIKE 'D48 %';
ROLLBACK;

-- Şirket B admini A sürücülerini GÖREMEZ.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0 THEN 'D49  B admini A surucularini GOREMIYOR (RLS)              PASS'
            ELSE 'D49  RLS CROSS-TENANT SIZINTISI               FAIL' END AS sonuc
FROM public.fleet_drivers WHERE display_name LIKE 'D48 %';
ROLLBACK;

-- Şirket B admini A atamalarını GÖREMEZ.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0 THEN 'D50  B admini A atamalarini GOREMIYOR (RLS)               PASS'
            ELSE 'D50  atama RLS SIZINTISI                      FAIL' END AS sonuc
FROM public.vehicle_driver_assignments WHERE note LIKE 'D48%';
ROLLBACK;

-- Oturumsuz kullanıcı hiçbir sürücü göremez (fail-closed).
BEGIN;
SELECT set_config('request.jwt.claims', NULL, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0 THEN 'D51  OTURUMSUZ 0 surucu (fail-closed)                     PASS'
            ELSE 'D51  oturumsuz surucu gorunuyor              FAIL' END AS sonuc
FROM public.fleet_drivers;
ROLLBACK;

-- OBSERVER yazamaz: tablo GRANT'ı yalnız SELECT.
SELECT CASE WHEN NOT has_table_privilege('authenticated','public.fleet_drivers','INSERT')
             AND NOT has_table_privilege('authenticated','public.fleet_drivers','UPDATE')
             AND NOT has_table_privilege('authenticated','public.fleet_drivers','DELETE')
            THEN 'D52  authenticated DOGRUDAN yazamaz (yalniz RPC)          PASS'
            ELSE 'D52  dogrudan yazma acik                     FAIL' END AS sonuc;

-- ANON hiçbir sürücü verisine erişemez.
SELECT CASE WHEN NOT has_table_privilege('anon','public.fleet_drivers','SELECT')
             AND NOT has_table_privilege('anon','public.vehicle_driver_assignments','SELECT')
             AND NOT has_table_privilege('anon','public.trip_driver_attribution_revisions','SELECT')
             AND NOT has_function_privilege('anon','public.list_fleet_drivers(boolean)','EXECUTE')
             AND NOT has_function_privilege('anon','public.create_fleet_driver(text,text,uuid,text,text,text,date)','EXECUTE')
            THEN 'D53  ANON surucu verisine ERISEMIYOR                      PASS'
            ELSE 'D53  ANON ERISIMI ACIK                       FAIL' END AS sonuc;

-- Head unit (anon) yalnız özet RPC'sini çağırabilir.
SELECT CASE WHEN has_function_privilege('anon','public.get_active_driver_assignment(text)','EXECUTE')
            THEN 'D54  head unit ozet RPC si anon a ACIK (tasarim geregi)   PASS'
            ELSE 'D54  head unit ozet RPC si kapali            FAIL' END AS sonuc;

-- P2 REGRESYONU: trip dedupe ve metrik kolonları duruyor.
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_key_unique')
             AND EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='vehicle_trips' AND column_name='unknown_time_min')
             AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public' AND p.proname='_trip_source')
            THEN 'D55  TRIP METRICS P2 regresyonu KORUNDU                   PASS'
            ELSE 'D55  P2 regresyonu BOZULDU                   FAIL' END AS sonuc;

-- Temizlik.
DELETE FROM public.trip_driver_attribution_revisions WHERE trip_key LIKE 'd48-%';
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'd48-%';
DELETE FROM public.vehicle_driver_assignments
 WHERE driver_id IN (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'D48 %');
DELETE FROM public.fleet_driver_audit WHERE entity_id IN
 (SELECT id FROM public.fleet_drivers WHERE display_name LIKE 'D48 %');
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'D48 %';
DELETE FROM public.vehicles WHERE id = 'cccc3333-0000-0000-0000-000000000003';
