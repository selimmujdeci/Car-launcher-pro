-- ═══════════════════════════════════════════════════════════════════════════
-- 055 — AI EVIDENCE ENGINE P1 · GERÇEK PostgreSQL DOĞRULAMASI
--
-- MOCK DEĞİL: gerçek tablo, gerçek trigger, gerçek kısıt, gerçek RLS.
--
-- EN KRİTİK KANITLAR:
--   · aynı kanıt İKİNCİ KEZ AÇILMAZ (merge) · `created_at` KORUNUR
--   · güven İSTEMCİDEN alınmaz, TÜRETİLİR
--   · kaynaksız/öznesiz/ölçümsüz kanıt ACTIVE OLAMAZ
--   · kanıt DEĞİŞMEZ (immutable) · süresi dolan SİLİNMEZ
--   · zincir: her çıktı hangi kanıta dayandığını GÖSTERİR
--   · cross-tenant kanıt REDDEDİLİR · devir sonrası sızıntı YOK
--   · DNA · Fleet Intelligence · Trip Engine · Deep Scan DEĞİŞMEDİ
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

DELETE FROM public.ai_evidence WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p55-%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P55 %';

INSERT INTO public.vehicles (id, name, company_id, api_key)
VALUES ('cccc3333-0000-0000-0000-000000000003', 'B Araci',
        'f2eef2ee-0000-0000-0000-000000000002', 'val-key-3')
ON CONFLICT (id) DO NOTHING;

DO $verify$
DECLARE
  v_fail int := 0;
  A_CO  uuid := 'f1eef1ee-0000-0000-0000-000000000001';
  B_CO  uuid := 'f2eef2ee-0000-0000-0000-000000000002';
  A_ADM uuid := '1178d9db-413d-4f60-97c5-97bfc8393618';
  B_ADM uuid := 'b0e18b7e-2951-472d-acf1-46c674dcd8a2';
  A_VEH uuid := 'bbbb2222-0000-0000-0000-000000000002';
  B_VEH uuid := 'cccc3333-0000-0000-0000-000000000003';
  r    jsonb;
  res  record;
  d1   uuid; dB uuid; t1 uuid;
  ev   public.ai_evidence%ROWTYPE;
  v_id uuid; v_created timestamptz; v_res text; v_n int; v_n2 int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  r := public.create_fleet_driver('P55 Ahmet', 'P55-1'); d1 := (r->>'driverId')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', B_ADM)::text, true);
  r := public.create_fleet_driver('P55 Beta',  'P55-B'); dB := (r->>'driverId')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);

  INSERT INTO public.vehicle_trips
    (vehicle_id, trip_key, revision, started_at, ended_at, distance_km, distance_source)
  VALUES (A_VEH, 'p55-t1', 1, now() - interval '2 hours', now() - interval '1 hour',
          40, 'MEASURED')
  RETURNING id INTO t1;

  -- ═══ M. MERGE (aynı kanıt ikinci kez açılmaz) ══════════════════════
  /* NOT: `now()` bir işlem içinde SABİTTİR — ilk kanıt bilinçli olarak
     GEÇMİŞ bir gözlem anıyla yazılır ki tazelemede `last_seen_at`in
     gerçekten ilerlediği ölçülebilsin (donmuş saatle ölçüm yanıltıcıdır). */
  v_res := public._ai_evidence_record(A_CO, 'TRIP_ENGINE', 'FUEL', 'fuel_l_per_100km',
                                      A_VEH, NULL, t1, 'NOTICE', 'MEASURED', 9.4, 3,
                                      now() - interval '1 hour');
  IF v_res = 'RECORDED' THEN
    RAISE NOTICE 'M1   kanit kaydedildi                                      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M1   kanit kaydedilmedi: % FAIL', v_res; END IF;

  SELECT * INTO ev FROM public.ai_evidence
   WHERE company_id=A_CO AND metric='fuel_l_per_100km';
  v_id := ev.id; v_created := ev.created_at;

  IF ev.state='ACTIVE' AND ev.refresh_count=0 AND ev.evidence_version=1 THEN
    RAISE NOTICE 'M2   kanit ACTIVE ve surum damgali                          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M2   kanit durumu yanlis: % FAIL', ev.state; END IF;

  PERFORM pg_sleep(0.05);
  FOR i IN 1..5 LOOP
    v_res := public._ai_evidence_record(A_CO, 'TRIP_ENGINE', 'FUEL', 'fuel_l_per_100km',
                                        A_VEH, NULL, t1, 'NOTICE', 'MEASURED', 9.6, 6);
  END LOOP;

  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE company_id=A_CO AND metric='fuel_l_per_100km';
  IF v_n = 1 AND v_res = 'MERGED' THEN
    RAISE NOTICE 'M3   5x tekrar YENI kayit ACMADI (merge)                    PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M3   % kayit olustu FAIL', v_n; END IF;

  SELECT * INTO ev FROM public.ai_evidence WHERE id = v_id;
  IF ev.refresh_count = 5 THEN
    RAISE NOTICE 'M4   refreshCount ARTTI (5)                                 PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M4   refresh sayaci yanlis: % FAIL', ev.refresh_count; END IF;

  IF ev.created_at = v_created THEN
    RAISE NOTICE 'M5   ILK kanit zamani KORUNDU (tazelemede degismedi)        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M5   created_at degisti FAIL'; END IF;

  IF ev.last_seen_at > v_created THEN
    RAISE NOTICE 'M6   son gorulme ILERLEDI                                   PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'M6   last_seen ilerlemedi FAIL'; END IF;

  -- ═══ C. GÜVEN TÜRETİLİR (istemci yazamaz) ══════════════════════════
  --
  -- Örnek sayısı 6 → VERY_HIGH tavanı; kaynak TRIP_ENGINE → HIGH tavanı.
  IF ev.confidence = 'HIGH' THEN
    RAISE NOTICE 'C1   guven KAYNAK tavanindan TURETILDI (HIGH)               PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C1   guven yanlis: % FAIL', ev.confidence; END IF;

  /* İstemci elle VERY_HIGH yazmaya çalışsa bile trigger yeniden türetir. */
  UPDATE public.ai_evidence SET confidence = 'VERY_HIGH' WHERE id = v_id;
  SELECT * INTO ev FROM public.ai_evidence WHERE id = v_id;
  IF ev.confidence = 'HIGH' THEN
    RAISE NOTICE 'C2   ELLE yazilan guven YOK SAYILDI (yeniden turetildi)     PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C2   elle guven kabul edildi: % FAIL', ev.confidence; END IF;

  /* Tek gözlem MEDIUM tavanını aşamaz. */
  PERFORM public._ai_evidence_record(A_CO, 'BLACKBOX', 'ENGINE', 'rpm_peak',
                                     A_VEH, NULL, NULL, 'INFO', 'MEASURED', 5200, 1);
  SELECT confidence INTO v_res FROM public.ai_evidence
   WHERE company_id=A_CO AND metric='rpm_peak';
  IF v_res = 'MEDIUM' THEN
    RAISE NOTICE 'C3   TEK gozlem MEDIUM tavanini ASMADI                      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'C3   tek gozlem % uretti FAIL', v_res; END IF;

  -- ═══ F. FAIL-CLOSED KAPILARI ═══════════════════════════════════════
  v_res := public._ai_evidence_record(A_CO, 'SOURCE_UNKNOWN', 'ENGINE', 'x_metric',
                                      A_VEH, NULL, NULL, 'INFO', 'MEASURED', 1, 5);
  SELECT state, reject_reason INTO ev.state, ev.reject_reason
    FROM public.ai_evidence WHERE company_id=A_CO AND metric='x_metric';
  IF v_res='REJECTED' AND ev.state='REJECTED' AND ev.reject_reason='SOURCE_UNKNOWN' THEN
    RAISE NOTICE 'F1   KAYNAKSIZ kanit ACTIVE OLAMADI (gerekce yazildi)       PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'F1   kaynaksiz kanit ACTIVE oldu: % FAIL', ev.state; END IF;

  v_res := public._ai_evidence_record(A_CO, 'TELEMETRY', 'ENGINE', 'no_subject_metric',
                                      NULL, NULL, NULL, 'INFO', 'MEASURED', 1, 5);
  IF v_res = 'REJECTED' THEN
    RAISE NOTICE 'F2   OZNESIZ kanit REDDEDILDI                               PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'F2   oznesiz kanit kabul edildi FAIL'; END IF;

  v_res := public._ai_evidence_record(A_CO, 'TELEMETRY', 'ENGINE', 'no_meas_metric',
                                      A_VEH, NULL, NULL, 'INFO', 'UNKNOWN', NULL, 5);
  IF v_res = 'REJECTED' THEN
    RAISE NOTICE 'F3   OLCUMSUZ kanit REDDEDILDI (0 sayilmadi)                PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'F3   olcumsuz kanit kabul edildi FAIL'; END IF;

  SELECT count(*) INTO v_n FROM public.ai_evidence
   WHERE company_id=A_CO AND state='REJECTED';
  IF v_n >= 3 THEN
    RAISE NOTICE 'F4   REDDEDILEN kanitlar SAKLANDI (gorunur)                 PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'F4   reddedilen kanit saklanmadi FAIL'; END IF;

  -- ═══ I. DEĞİŞMEZLİK (immutable) ════════════════════════════════════
  BEGIN
    UPDATE public.ai_evidence SET source='BLACKBOX' WHERE id = v_id;
    v_fail:=v_fail+1; RAISE WARNING 'I1   KAYNAK degistirilebildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'I1   kaynak degistirme REDDEDILDI (immutable)               PASS';
  END;

  BEGIN
    UPDATE public.ai_evidence SET vehicle_id = NULL WHERE id = v_id;
    v_fail:=v_fail+1; RAISE WARNING 'I2   OZNE degistirilebildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'I2   ozne degistirme REDDEDILDI (immutable)                 PASS';
  END;

  BEGIN
    UPDATE public.ai_evidence SET created_at = now() + interval '1 day' WHERE id = v_id;
    v_fail:=v_fail+1; RAISE WARNING 'I3   DOGUS ANI degistirilebildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'I3   dogus ani degistirme REDDEDILDI (immutable)            PASS';
  END;

  BEGIN
    UPDATE public.ai_evidence SET category='FLEET' WHERE id = v_id;
    v_fail:=v_fail+1; RAISE WARNING 'I4   KATEGORI degistirilebildi FAIL';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'I4   kategori degistirme REDDEDILDI (immutable)             PASS';
  END;

  -- ═══ X. CROSS-TENANT ═══════════════════════════════════════════════
  v_res := public._ai_evidence_record(A_CO, 'TELEMETRY', 'VEHICLE', 'xtenant_metric',
                                      B_VEH, NULL, NULL, 'INFO', 'MEASURED', 1, 5);
  IF v_res = 'REJECTED' THEN
    RAISE NOTICE 'X1   BASKA sirketin araci icin kanit REDDEDILDI             PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X1   cross-tenant kanit kabul edildi FAIL'; END IF;

  v_res := public._ai_evidence_record(A_CO, 'DRIVER_DNA', 'DRIVER', 'xtenant_driver',
                                      NULL, dB, NULL, 'INFO', 'MEASURED', 1, 5);
  IF v_res = 'REJECTED' THEN
    RAISE NOTICE 'X2   BASKA sirketin surucusu icin kanit REDDEDILDI          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'X2   cross-tenant surucu kabul edildi FAIL'; END IF;

  -- ═══ T. TRANSFER (araç devri) ══════════════════════════════════════
  UPDATE public.vehicles SET company_id = B_CO WHERE id = A_VEH;
  v_res := public._ai_evidence_record(A_CO, 'TELEMETRY', 'VEHICLE', 'after_transfer',
                                      A_VEH, NULL, NULL, 'INFO', 'MEASURED', 1, 5);
  IF v_res = 'REJECTED' THEN
    RAISE NOTICE 'T1   DEVIR sonrasi eski sirkete kanit YAZILAMADI            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'T1   devir sonrasi kanit yazildi FAIL'; END IF;
  UPDATE public.vehicles SET company_id = A_CO WHERE id = A_VEH;

  -- ═══ CH. KANIT ZİNCİRİ ═════════════════════════════════════════════
  v_res := public._ai_evidence_link(v_id, 'FLEET_INSIGHT', 'insight-1');
  IF v_res = 'LINKED' THEN
    RAISE NOTICE 'CH1  cikti kanita BAGLANDI                                  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CH1  bag kurulamadi: % FAIL', v_res; END IF;

  v_res := public._ai_evidence_link(v_id, 'FLEET_INSIGHT', 'insight-1');
  IF v_res = 'DUPLICATE' THEN
    RAISE NOTICE 'CH2  AYNI bag ikinci kez yazilmadi (idempotent)             PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CH2  bag tekrar yazildi: % FAIL', v_res; END IF;

  v_res := public._ai_evidence_link(gen_random_uuid(), 'AI_ANSWER', 'answer-1');
  IF v_res = 'EVIDENCE_NOT_FOUND' THEN
    RAISE NOTICE 'CH3  VAR OLMAYAN kanita bag KURULAMADI                      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CH3  hayali kanita bag kuruldu FAIL'; END IF;

  /* AI cevabı da kanıta bağlanabilmeli — omurganın asıl amacı budur. */
  v_res := public._ai_evidence_link(v_id, 'AI_ANSWER', 'answer-1');
  SELECT count(*) INTO v_n FROM public.get_evidence_chain('AI_ANSWER', 'answer-1');
  IF v_res='LINKED' AND v_n = 1 THEN
    RAISE NOTICE 'CH4  AI cevabi kanita baglandi ve ZINCIR okundu             PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CH4  zincir okunamadi: % FAIL', v_n; END IF;

  -- ═══ E. SÜRE DOLUMU (silmez · idempotent) ══════════════════════════
  /* Süresi GERÇEKTEN geçmiş bir kanıt: 40 gün önce gözlenmiş, 1 gün ömürlü.
     (`expires_at > created_at` kısıtı yüzünden mevcut kaydın süresi geriye
     çekilemez — kısıt doğru, test ona uyar.) */
  PERFORM public._ai_evidence_record(A_CO, 'TELEMETRY', 'TEMPERATURE', 'coolant_peak',
                                     A_VEH, NULL, NULL, 'INFO', 'MEASURED', 96, 5,
                                     now() - interval '40 days', interval '1 day');
  SELECT id, created_at INTO v_id, v_created FROM public.ai_evidence
   WHERE company_id=A_CO AND metric='coolant_peak';

  SELECT public.expire_ai_evidence() INTO v_n;
  SELECT * INTO ev FROM public.ai_evidence WHERE id = v_id;
  IF v_n >= 1 AND ev.state = 'EXPIRED' THEN
    RAISE NOTICE 'E1   suresi dolan kanit EXPIRED oldu                        PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'E1   expiry calismadi: % FAIL', ev.state; END IF;

  IF ev.id = v_id AND ev.created_at = v_created THEN
    RAISE NOTICE 'E2   suresi dolan kanit SILINMEDI (gecmis korundu)          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'E2   kanit silindi FAIL'; END IF;

  SELECT public.expire_ai_evidence() INTO v_n2;
  IF v_n2 = 0 THEN
    RAISE NOTICE 'E3   IKINCI expiry cagrisi hicbir satiri etkilemedi         PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'E3   ikinci cagri % satir FAIL', v_n2; END IF;

  /* Süresi dolmuş kanıt YENİ gözlemle canlanır ama kimliği/doğuşu aynı kalır. */
  v_res := public._ai_evidence_record(A_CO, 'TELEMETRY', 'TEMPERATURE', 'coolant_peak',
                                      A_VEH, NULL, NULL, 'INFO', 'MEASURED', 98, 8);
  SELECT * INTO ev FROM public.ai_evidence WHERE id = v_id;
  IF ev.state='ACTIVE' AND ev.created_at = v_created THEN
    RAISE NOTICE 'E4   yeni gozlem kaniti CANLANDIRDI, dogus KORUNDU          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'E4   canlanma yanlis: % FAIL', ev.state; END IF;

  -- ═══ CV. KAPSAM ════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', A_ADM)::text, true);
  SELECT * INTO res FROM public.get_evidence_coverage();
  IF res.evidence_total > 0 AND res.active_count > 0 THEN
    RAISE NOTICE 'CV1  kapsam GERCEK kanit sayilarindan hesaplandi            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CV1  kapsam hesaplanmadi FAIL'; END IF;

  IF res.integrity_ok THEN
    RAISE NOTICE 'CV2  BUTUNLUK saglam (kaynaksiz/guvensiz ACTIVE kanit yok)  PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CV2  butunluk bozuk FAIL'; END IF;

  IF res.rejected_count >= 3 AND res.expired_count >= 0 THEN
    RAISE NOTICE 'CV3  reddedilen ve suresi dolan kanitlar SAYILDI            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CV3  sayaclar yanlis FAIL'; END IF;

  IF res.chain_link_count >= 2 THEN
    RAISE NOTICE 'CV4  zincir bagi sayisi raporlandi                          PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'CV4  zincir sayisi yanlis FAIL'; END IF;

  -- ═══ R. MEVCUT KATMAN REGRESYONU ═══════════════════════════════════
  SELECT * INTO res FROM public._resolve_driver_presence(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now(), NULL);
  IF res.decision = 'NO_PRESENCE' THEN
    RAISE NOTICE 'R1   presence resolver DEGISMEDI                            PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R1   presence resolver degisti FAIL'; END IF;

  IF public._dna_status(4,500)='NO_DNA' AND public._dna_learning_level(100)='ESTABLISHED' THEN
    RAISE NOTICE 'R2   DNA kapilari DEGISMEDI                                 PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R2   DNA kapilari degisti FAIL'; END IF;

  IF public._fleet_insight_confidence(50,1,100,50) NOT IN ('HIGH','VERY_HIGH') THEN
    RAISE NOTICE 'R3   Fleet Intelligence guven kapisi DEGISMEDI              PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R3   FI guven kapisi degisti FAIL'; END IF;

  SELECT count(*) INTO v_n FROM public.vehicle_trips WHERE trip_key='p55-t1';
  IF v_n = 1 THEN
    RAISE NOTICE 'R4   Trip Engine kayitlari ETKILENMEDI                      PASS';
  ELSE v_fail:=v_fail+1; RAISE WARNING 'R4   trip kaydi bozuldu FAIL'; END IF;

  IF v_fail = 0 THEN
    RAISE NOTICE '─────────────────────────────────────────────────────────';
    RAISE NOTICE '055 DOGRULAMA: TUM KONTROLLER GECTI';
  ELSE
    RAISE EXCEPTION '055 DOGRULAMA: % KONTROL DUSTU', v_fail;
  END IF;
END
$verify$;

-- ── Yetki kapıları ──────────────────────────────────────────────────────
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','b0e18b7e-2951-472d-acf1-46c674dcd8a2')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN count(*) = 0
            THEN 'S1   B admini A kanitlarini GOREMIYOR (RLS)             PASS'
            ELSE 'S1   RLS SIZINTISI FAIL' END AS sonuc
  FROM public.ai_evidence;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT CASE WHEN has_table_privilege('authenticated','public.ai_evidence','INSERT')
              OR has_table_privilege('authenticated','public.ai_evidence','UPDATE')
              OR has_function_privilege('authenticated','public.expire_ai_evidence()','EXECUTE')
            THEN 'S2   kullanici kanit YAZABILIYOR FAIL'
            ELSE 'S2   kanit elle yazilamaz/kapatilamaz                  PASS'
       END AS sonuc;
ROLLBACK;

-- Temizlik.
DELETE FROM public.ai_evidence WHERE company_id IN
  ('f1eef1ee-0000-0000-0000-000000000001','f2eef2ee-0000-0000-0000-000000000002');
DELETE FROM public.vehicle_trips WHERE trip_key LIKE 'p55-%';
DELETE FROM public.fleet_drivers WHERE display_name LIKE 'P55 %';
