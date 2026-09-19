-- ════════════════════════════════════════════════════════════════════
-- 078 — push_vehicle_event: GRUP DAMGASI YALNIZ KENDİ YAZDIĞI ALANLARI ONAYLAR
-- ════════════════════════════════════════════════════════════════════
--
-- ⚠️ HAZIRLANDI, UYGULANMADI. F5.1B masa-başı turunda yazıldı; production'a
--    KOŞULMADI. Uygulanmadan önce §ÖNKOŞULLAR karşılanmalıdır.
--
-- ── MİMARİ INVARIANT ────────────────────────────────────────────────
--   ROW FRESHNESS ≠ FIELD FRESHNESS
--   Bir sensörün YENİ ölçümü, başka bir sensörün ESKİ değerini
--   "yeni ölçülmüş" YAPAMAZ.
--
-- ── ÖLÇÜLEN KUSUR (gerçek araç, Renault VF1FLBUBCBY406165, 2026-09-18) ──
--   CDP ile 90 sn / 35 OBD paketi yakalandı:
--     rpm        → 35/35 pakette geldi (~850)
--     engineTemp → 5 turda bir geldi (80 °C)
--     fuelLevel  → 35/35 pakette -1 (HİÇ ölçülmedi)
--   Buna rağmen production satırı şunu tutuyordu:
--     fuel = 16, obd_observed_at = <taze>
--   Yani 16 ESKİ bir okumaydı ama satır onu TAZE gözlemle damgalıyordu.
--
-- ── KÖK NEDEN (iki halka) ───────────────────────────────────────────
--   1. ÜRETİCİ: `telemetryContract` eski `_current.fuelLevel` değerini HER
--      heartbeat'te `obdObservedAt = lastSeenMs` ile gönderiyordu.
--      → Bu halka KOD TARAFINDA DÜZELTİLDİ (bu migration'ın ÖN KOŞULU):
--        alan yalnız KENDİ ölçümü tazeyse gönderilir ve `obdObservedAt`
--        gönderilen alanların EN ESKİSİDİR.
--   2. VERİTABANI (bu dosya): üretici alanı göndermeyi bıraksa bile
--      `fuel = COALESCE(EXCLUDED.fuel, t.fuel)` eski değeri DİRİLTİYOR ve
--      `obd_observed_at` başka bir OBD sinyaliyle TAZELENİYORDU. Sonuç
--      aynı yalan: eski değer + yeni damga.
--
-- ── BU MIGRATION NE YAPAR ───────────────────────────────────────────
--   Olay GERÇEK bir OBD gözlemi taşıyorsa (`obd_observed_at` NOT NULL), OBD
--   alan kümesi O GÖZLEME göre yeniden yazılır: gözlemde olmayan alan NULL
--   olur. NULL = BİLİNMİYOR'dur, 0 DEĞİLDİR (066 sözleşmesi korunur) ve
--   tüketici tarafı bunu zaten "Veri yok" diye gösterir.
--
--   Olay OBD gözlemi TAŞIMIYORSA (yalnız GPS heartbeat'i, log olayı,
--   system_health) OBD alanlarına ve damgasına DOKUNULMAZ — OBD kopmuşken
--   son bilinen değerler ESKİ damgalarıyla durur ve tüketici onları doğru
--   şekilde STALE/OFFLINE gösterir.
--
--   `speed` İSTİSNASI BİLİNÇLİDİR: hız OBD dışı (füzyonlanmış GPS) kaynaktan
--   da gelebilir. OBD gözlemi varsa o gözlemin hızı yazılır; yoksa eski
--   COALESCE davranışı korunur, böylece GPS hızı kaybolmaz.
--
-- ── NE YAPMAZ ───────────────────────────────────────────────────────
--   · Yeni kolon EKLEMEZ. Alan-bazlı `*_observed_at` kolonu GEREKMEZ: damga
--     ile değer artık AYNI gözlemde yazıldığı için tek grup damgası
--     satırdaki her OBD alanı için DOĞRUDUR.
--   · Geçmişe dönük hiçbir şey DEĞİŞTİRMEZ — backfill YOKTUR. Eski satırların
--     yakıtının gerçekten ne zaman ölçüldüğü BİLİNMİYOR; onu "bugün ölçüldü"
--     diye damgalamak uydurma olurdu (§10 fail-closed).
--   · İkinci bir telemetri otoritesi KURMAZ; aynı RPC, aynı tablo, aynı damga.
--
-- ── ÖNKOŞULLAR (hepsi sağlanmadan KOŞMA) ────────────────────────────
--   1. Üretici düzeltmesi (alan-bazlı ölçüm damgaları) İÇEREN APK sahada
--      DOĞRULANMIŞ olmalı. Bu migration TEK BAŞINA uygulanırsa, eski APK
--      yakıtı her heartbeat'te gönderdiği için davranış pratikte değişmez;
--      zararsızdır ama faydasını da vermez.
--   2. Önce staging'e (azvmrbjaxiwzaweraozi) uygulanıp doğrulanmalı.
--   3. Aşağıdaki §DOĞRULAMA bloğu hatasız geçmeli.
--
-- GERİ ALINABİLİRLİK: yalnız fonksiyon gövdesi değişir (CREATE OR REPLACE).
--   Önceki gövde `docs/db` dökümünden geri yüklenebilir. Veri DEĞİŞMEZ.
-- ════════════════════════════════════════════════════════════════════

-- ── 0. ÖN KOŞUL: değiştirdiğimiz gövde BEKLEDİĞİMİZ gövde mi? ────────
-- Fonksiyon başka bir migration tarafından değişmişse SESSİZCE ezmeyiz.
DO $precheck$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'push_vehicle_event'
  LIMIT 1;

  IF v_src IS NULL THEN
    RAISE EXCEPTION '078 DURDU: push_vehicle_event YOK';
  END IF;

  -- 042/066 dürüst-yazma gövdesi şart (sahte 0 yazan gövdede bu düzeltme anlamsız).
  IF v_src NOT LIKE '%NULLIF(v_payload->>''fuel''%' THEN
    RAISE EXCEPTION '078 DURDU: gövde 042 sonrası dürüst yazma biçiminde değil';
  END IF;

  -- Zaten uygulanmışsa tekrar uygulamak zararsızdır; yalnız bilgi ver.
  IF v_src LIKE '%EXCLUDED.obd_observed_at IS NOT NULL%' THEN
    RAISE NOTICE '078: zaten uygulanmış görünüyor — idempotent yeniden yazım';
  END IF;
END $precheck$;

-- ── 1. Fonksiyon gövdesi (production dökümünden BİREBİR; yalnız OBD alan
--       atama bloğu değişti) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."push_vehicle_event"("p_api_key" "text", "p_type" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  c_log_types   constant text[]   := ARRAY['critical_error','crash','log','obd_diag','support_snapshot','ota_event','voice_diag'];
  c_max_bytes   constant integer  := 65536;
  c_rate_window constant interval := interval '60 seconds';
  c_rate_max    constant integer  := 30;
  v_vehicle_id  uuid;
  v_company_id  uuid;
  v_owner_id    uuid;
  v_event_id    uuid;
  v_payload     jsonb;
  v_store       jsonb;
  v_recent      integer;
  v_lat         double precision;
  v_lng         double precision;
  v_acc         double precision;
  v_obs         timestamptz;
  v_gps_obs     timestamptz;
  v_obd_obs     timestamptz;
  v_src         text;
  v_loc_src     text;
BEGIN
  SELECT id, company_id, owner_id INTO v_vehicle_id, v_company_id, v_owner_id
  FROM public.vehicles
  WHERE (api_key_hash = encode(sha256(p_api_key::bytea), 'hex') OR coalesce(api_key_hash, api_key) = p_api_key);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;

  v_payload := coalesce(p_payload, '{}'::jsonb);

  IF p_type = ANY (c_log_types) THEN
    SELECT count(*) INTO v_recent
    FROM public.vehicle_events
    WHERE vehicle_id = v_vehicle_id::text
      AND type = ANY (c_log_types)
      AND created_at > now() - c_rate_window;
    IF v_recent >= c_rate_max THEN
      RETURN NULL;
    END IF;
  END IF;

  v_store := v_payload;
  IF octet_length(v_payload::text) > c_max_bytes THEN
    v_store := jsonb_strip_nulls(jsonb_build_object(
      'truncated', true,
      'type',      p_type,
      'ctx',       left(v_payload->>'ctx',  256),
      'msg',       left(v_payload->>'msg', 2048),
      'errorCode', v_payload->>'errorCode'
    ));
  END IF;

  INSERT INTO public.vehicle_events (vehicle_id, type, metadata)
  VALUES (v_vehicle_id::text, p_type, v_store)
  RETURNING id INTO v_event_id;

  v_lat := NULLIF(v_payload->>'lat', '')::double precision;
  v_lng := NULLIF(v_payload->>'lng', '')::double precision;
  IF NOT public.location_in_range(v_lat, v_lng) THEN
    v_lat := NULL; v_lng := NULL;
  END IF;
  v_acc := NULLIF(v_payload->>'accuracyM', '')::double precision;

  -- Gözlem damgaları: istemci epoch ms verir. İSTEMCİ SAATİ TEK OTORİTE DEĞİL —
  -- `received_at` daima sunucu `now()`'ıdır ve gelecekteki damga kırpılır.
  v_obs := LEAST(
    now(),
    coalesce(to_timestamp((NULLIF(v_payload->>'observedAt','')::bigint) / 1000.0), now())
  );
  v_gps_obs := LEAST(now(), to_timestamp((NULLIF(v_payload->>'gpsObservedAt','')::bigint) / 1000.0));
  v_obd_obs := LEAST(now(), to_timestamp((NULLIF(v_payload->>'obdObservedAt','')::bigint) / 1000.0));

  v_src := NULLIF(v_payload->>'source', '');
  IF v_src IS NOT NULL AND v_src NOT IN ('HEAD_UNIT_GPS','HEAD_UNIT_OBD','EXTERNAL_GPS','UNKNOWN') THEN
    v_src := 'UNKNOWN';   -- bilinmeyen kaynak adı UYDURULMAZ, UNKNOWN'a düşer
  END IF;
  v_loc_src := NULLIF(v_payload->>'locationSource', '');
  IF v_loc_src IS NOT NULL AND v_loc_src NOT IN ('HEAD_UNIT_GPS','EXTERNAL_GPS','UNKNOWN') THEN
    v_loc_src := 'UNKNOWN';
  END IF;

  IF v_lat IS NOT NULL AND v_lng IS NOT NULL
     AND (v_company_id IS NOT NULL OR (v_company_id IS NULL AND v_owner_id IS NOT NULL)) THEN
    INSERT INTO public.vehicle_locations
      (vehicle_id, company_id, lat, lng, heading_deg, accuracy_m, observed_at, location_source)
    VALUES (v_vehicle_id, v_company_id, v_lat, v_lng,
            NULLIF(v_payload->>'heading', '')::double precision,
            v_acc, coalesce(v_gps_obs, v_obs), v_loc_src);
  END IF;

  INSERT INTO public.vehicle_telemetry AS t
    (vehicle_id, lat, lng, speed, fuel, temp, rpm, is_online, updated_at,
     accuracy_m, observed_at, received_at, gps_observed_at, obd_observed_at,
     telemetry_source, location_source)
  VALUES (
    v_vehicle_id,
    v_lat,
    v_lng,
    -- DÜZELTME 042: coalesce(...,0) KALDIRILDI. Bilinmeyen hız artık NULL'dır.
    NULLIF(v_payload->>'speed', '')::double precision,
    NULLIF(v_payload->>'fuel',  '')::double precision,
    NULLIF(v_payload->>'temp',  '')::double precision,
    NULLIF(v_payload->>'rpm',   '')::double precision,
    true,
    now(),
    v_acc, v_obs, now(), v_gps_obs, v_obd_obs, v_src, v_loc_src
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    -- Bilinmeyen YENİ değer, bilinen ESKİ değeri ASLA ezmez.
    lat        = COALESCE(EXCLUDED.lat, t.lat),
    lng        = COALESCE(EXCLUDED.lng, t.lng),
    -- ── F5.1B · GRUP DAMGASI YALNIZ KENDİ YAZDIĞI ALANLARI ONAYLAR ────────
    -- Satırda TEK bir `obd_observed_at` vardır. Eski davranış (COALESCE ile
    -- eski değeri korumak) o tek damgayı, o gözlemde ÖLÇÜLMEMİŞ bir alana da
    -- vermiş oluyordu: yeni RPM geldiğinde eski yakıt "yeni ölçülmüş" görünürdü.
    -- Artık olay GERÇEK bir OBD gözlemi taşıyorsa (`obd_observed_at` var) OBD
    -- alan kümesi O GÖZLEME göre yeniden yazılır; gözlemde olmayan alan NULL
    -- olur (= BİLİNMİYOR, 0 DEĞİL). Olay OBD gözlemi taşımıyorsa (yalnız GPS /
    -- log olayı) OBD alanlarına ve damgasına DOKUNULMAZ.
    speed      = CASE WHEN EXCLUDED.obd_observed_at IS NOT NULL
                      THEN EXCLUDED.speed ELSE COALESCE(EXCLUDED.speed, t.speed) END,
    fuel       = CASE WHEN EXCLUDED.obd_observed_at IS NOT NULL
                      THEN EXCLUDED.fuel  ELSE t.fuel END,
    temp       = CASE WHEN EXCLUDED.obd_observed_at IS NOT NULL
                      THEN EXCLUDED.temp  ELSE t.temp END,
    rpm        = CASE WHEN EXCLUDED.obd_observed_at IS NOT NULL
                      THEN EXCLUDED.rpm   ELSE t.rpm  END,
    accuracy_m = COALESCE(EXCLUDED.accuracy_m, t.accuracy_m),
    is_online  = true,
    updated_at = now(),
    received_at = now(),
    observed_at        = GREATEST(COALESCE(EXCLUDED.observed_at, t.observed_at), COALESCE(t.observed_at, EXCLUDED.observed_at)),
    gps_observed_at    = GREATEST(COALESCE(EXCLUDED.gps_observed_at, t.gps_observed_at), COALESCE(t.gps_observed_at, EXCLUDED.gps_observed_at)),
    obd_observed_at    = GREATEST(COALESCE(EXCLUDED.obd_observed_at, t.obd_observed_at), COALESCE(t.obd_observed_at, EXCLUDED.obd_observed_at)),
    telemetry_source   = COALESCE(EXCLUDED.telemetry_source, t.telemetry_source),
    location_source    = COALESCE(EXCLUDED.location_source,  t.location_source);

  -- `system_health` olayı sağlık tazeliğini damgalar (ayrı sinyal).
  IF p_type = 'system_health' THEN
    UPDATE public.vehicle_telemetry
       SET health_observed_at = coalesce(v_obs, now())
     WHERE vehicle_id = v_vehicle_id;
  END IF;

  RETURN v_event_id;
END;
$$;


-- ── 2. DOĞRULAMA — değişiklik gerçekten yerinde mi ──────────────────
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'push_vehicle_event'
  LIMIT 1;

  IF v_src NOT LIKE '%EXCLUDED.obd_observed_at IS NOT NULL%' THEN
    RAISE EXCEPTION '078 DOĞRULAMA DÜŞTÜ: OBD gözlem kapısı gövdede yok';
  END IF;

  -- Yakıt artık KOŞULSUZ COALESCE ile dirilmemeli.
  IF v_src LIKE '%fuel       = COALESCE(EXCLUDED.fuel%' THEN
    RAISE EXCEPTION '078 DOĞRULAMA DÜŞTÜ: yakıt hâlâ koşulsuz korunuyor';
  END IF;

  -- 066 sözleşmesi: kolonlar nullable kalmalı (NULL = bilinmiyor).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_telemetry'
      AND column_name IN ('speed','fuel','rpm','temp')
      AND (is_nullable = 'NO' OR column_default IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '078 DOĞRULAMA DÜŞTÜ: 066 sözleşmesi bozulmuş (NOT NULL/DEFAULT geri gelmiş)';
  END IF;

  RAISE NOTICE '078 OK: grup damgası yalnız kendi yazdığı OBD alanlarını onaylıyor';
END $verify$;
