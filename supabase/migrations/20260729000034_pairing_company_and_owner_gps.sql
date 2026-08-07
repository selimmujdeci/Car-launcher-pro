-- =====================================================================
-- Migration 034: PAIRING SONRASI company_id ATANMASI + BİREYSEL SAHİPLİK GPS
--
-- ── ONARILAN P1 KUSUR (bağımsız denetim) ─────────────────────────────
-- `/api/vehicle/link` aracı kullanıcıya bağlarken YALNIZ `owner_id` yazıyor,
-- `vehicles.company_id`'ye hiç dokunmuyordu. `push_vehicle_event` ise
-- `vehicle_locations` INSERT'ini `company_id IS NOT NULL` şartına bağlamıştı
-- (024c). Sonuç: araç `vehicle_events` + `vehicle_telemetry` yazabildiği için
-- ONLINE görünüyor ama HİÇBİR konum satırı oluşmuyor → haritada marker YOK.
--
-- ── BU MIGRATION İKİ ŞEYİ YAPAR ──────────────────────────────────────
-- 1. `pair_vehicle_to_user` — TEK TRANSACTION'da atomik eşleştirme:
--    kod doğrulama · TTL · tek kullanım · üyelik doğrulama (SUNUCU tarafında,
--    istemciden gelen company_id ASLA kabul edilmez) · sahiplik kapıları ·
--    bireysel 3 araç limiti · `owner_id` + `company_id` + `vehicle_pairings`
--    birlikte yazılır. Yarım pairing İMKÂNSIZDIR.
-- 2. `push_vehicle_event` — konum yazma şartı sahiplik modeline göre:
--       (company_id IS NOT NULL)  VEYA  (company_id IS NULL AND owner_id IS NOT NULL)
--    Cross-tenant/cross-owner erişim GEVŞETİLMEZ: RLS okuma politikaları
--    (`locations: erişim` → company/owner/paired) DEĞİŞTİRİLMEZ.
--
-- ── TENANT MODELİ (ölçüldü, varsayılmadı) ────────────────────────────
-- Canlı şemada üyelik `profiles.company_id`'dir (kullanıcı başına EN FAZLA BİR
-- şirket; `auth_company_id()` bunu okur). Kök şemadaki `memberships` tablosu
-- AYRI bir dağıtıma aittir ve bu akışta KULLANILMAZ. Bu yüzden "birden fazla
-- aktif şirket" durumu bu şemada oluşamaz; yine de politika fail-closed
-- yazılmıştır: üyelik BULUNAMAZSA şirket ataması YAPILMAZ (bireysel yol).
--
-- ⚠️ SAHİPLİK DEVRİ YOKTUR. Pairing yalnız ERİŞİM verir; `owner_id` dolu bir
-- araç sessizce başka kullanıcıya TAŞINMAZ. İkinci el / cihaz el değiştirme
-- için ayrı "Araç Devri (Vehicle Transfer)" akışı gerekir (bu migration'ın
-- kapsamı DIŞINDA — açık borç).
-- =====================================================================

-- ── 1. vehicle_pairings.company_id ────────────────────────────────────
-- Filo eşleşmesinde araçla AYNI şirket yazılır; bireysel eşleşmede NULL kalır.
ALTER TABLE public.vehicle_pairings
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vehicle_pairings_company_id_idx
  ON public.vehicle_pairings (company_id);

-- ── 2. RPC: pair_vehicle_to_user ──────────────────────────────────────
-- SECURITY DEFINER + service_role'a özel. `p_user_id` bir PARAMETRE olduğu
-- için bu fonksiyon anon/authenticated'a AÇILAMAZ (aksi hâlde bir kullanıcı
-- başkasının kimliğiyle araç bağlayabilirdi) — GRANT bölümüne bakınız.
CREATE OR REPLACE FUNCTION public.pair_vehicle_to_user(
  p_code    text,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  /* Bireysel (şirketsiz) kullanıcı için ÜRÜN LİMİTİ. İstemciye sorulmaz,
     istemciden gelen sayıya GÜVENİLMEZ — burada sayılır. */
  c_individual_max constant integer := 3;

  v_vehicle        public.vehicles%ROWTYPE;
  v_code           text;
  v_company        uuid;
  v_owned_count    integer;
  v_already_paired boolean;
  v_role           text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  v_code := upper(trim(coalesce(p_code, '')));
  IF v_code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;

  /* EŞZAMANLILIK: aynı kullanıcının FARKLI araçlar için paralel iki isteği
     satır kilidiyle serileşmez (kilitler farklı satırlarda olur). Kullanıcı
     bazlı advisory kilit, limit sayımı ile yazmayı tek transaction içinde
     ATOMİK yapar → 3 araç sınırı yarışla aşılamaz. */
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- 2.1 Kod → araç. Önce GEÇİCİ kod (TTL), sonra KALICI pairing_code.
  SELECT v.* INTO v_vehicle
  FROM public.vehicle_linking_codes vlc
  JOIN public.vehicles v ON v.id = vlc.vehicle_id
  WHERE vlc.code = v_code
    AND vlc.expires_at > now()
  FOR UPDATE OF v
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE upper(pairing_code) = v_code
    FOR UPDATE
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    -- Geçersiz · süresi dolmuş · zaten tüketilmiş (replay) — hepsi aynı cevap.
    RAISE EXCEPTION 'invalid_or_expired_code' USING ERRCODE = 'P0001';
  END IF;

  -- 2.2 ŞİRKET: yalnız SUNUCUDA doğrulanmış üyelikten. İstemci girdisi YOK.
  SELECT p.company_id INTO v_company
  FROM public.profiles p
  WHERE p.id = p_user_id;

  -- 2.3 SAHİPLİK KAPILARI — sessiz taşıma YASAK.
  IF v_vehicle.company_id IS NOT NULL
     AND (v_company IS NULL OR v_vehicle.company_id <> v_company) THEN
    -- Araç BAŞKA bir şirkete bağlı → cross-tenant claim reddedilir.
    RAISE EXCEPTION 'vehicle_belongs_to_another_company' USING ERRCODE = 'P0001';
  END IF;

  IF v_vehicle.owner_id IS NOT NULL AND v_vehicle.owner_id <> p_user_id THEN
    /* Araç başka bir kullanıcıya ait. TEK istisna: aynı DOĞRULANMIŞ şirket
       içindeki kullanıcı — bu durumda ERİŞİM verilir, SAHİPLİK DEĞİŞMEZ. */
    IF v_company IS NULL OR v_vehicle.company_id IS DISTINCT FROM v_company THEN
      RAISE EXCEPTION 'vehicle_owned_by_another_user' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 2.4 BİREYSEL LİMİT — yalnız şirket üyeliği OLMAYAN kullanıcıya uygulanır.
  v_already_paired := EXISTS (
    SELECT 1 FROM public.vehicle_pairings
    WHERE user_id = p_user_id AND vehicle_id = v_vehicle.id
  );

  IF v_company IS NULL AND NOT v_already_paired THEN
    /* Yalnız AKTİF bağlı bireysel araçlar sayılır: bağlantısı kaldırılan
       (owner_id temizlenen) veya silinen araç limite girmez. Aynı aracın
       tekrar eşleşmesi sayımı ARTIRMAZ (`id <> v_vehicle.id`). */
    SELECT count(*) INTO v_owned_count
    FROM public.vehicles
    WHERE owner_id = p_user_id
      AND company_id IS NULL
      AND id <> v_vehicle.id;

    IF v_owned_count >= c_individual_max THEN
      RAISE EXCEPTION 'individual_vehicle_limit_reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 2.5 ATOMİK YAZMALAR (aynı transaction — yarım pairing imkânsız)
  /* coalesce: mevcut sahip/şirket EZİLMEZ. Bireysel kullanıcıda `v_company`
     NULL'dur → `company_id` NULL KALIR (otomatik "kişisel şirket" üretilmez). */
  UPDATE public.vehicles
  SET owner_id   = coalesce(owner_id, p_user_id),
      company_id = coalesce(company_id, v_company)
  WHERE id = v_vehicle.id
  RETURNING * INTO v_vehicle;

  v_role := CASE
    WHEN v_vehicle.owner_id = p_user_id THEN 'owner'
    ELSE 'observer'   -- aynı şirket içi ERİŞİM eşleşmesi (sahiplik değil)
  END;

  INSERT INTO public.vehicle_pairings (user_id, vehicle_id, role, company_id)
  VALUES (p_user_id, v_vehicle.id, v_role, v_vehicle.company_id)
  ON CONFLICT (user_id, vehicle_id) DO UPDATE
    SET role       = EXCLUDED.role,
        company_id = EXCLUDED.company_id;

  -- 2.6 KODU TÜKET (tek kullanım — replay kapalı)
  DELETE FROM public.vehicle_linking_codes WHERE vehicle_id = v_vehicle.id;

  RETURN jsonb_build_object(
    'vehicle_id',  v_vehicle.id,
    'name',        coalesce(v_vehicle.name, v_vehicle.device_name, 'Araç'),
    'device_id',   v_vehicle.device_id,
    'created_at',  v_vehicle.created_at,
    'company_id',  v_vehicle.company_id,
    'owner_id',    v_vehicle.owner_id,
    'role',        v_role,
    'is_individual', (v_vehicle.company_id IS NULL)
  );
END;
$function$;

-- ── 3. RPC: push_vehicle_event — SAHİPLİK DUYARLI konum yazma ─────────
-- Gövde 027 ile BİREBİR aynıdır; TEK fark 024c konum kapısıdır:
--   ESKİ: company_id IS NOT NULL
--   YENİ: company_id IS NOT NULL  VEYA  (company_id IS NULL AND owner_id IS NOT NULL)
-- Sahipsiz VE şirketsiz araç (henüz eşleşmemiş cihaz) hâlâ konum YAZMAZ.
CREATE OR REPLACE FUNCTION public.push_vehicle_event(p_api_key text, p_type text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
BEGIN
  -- DÜZELTME 024a: api_key → coalesce(api_key_hash, api_key)
  -- DÜZELTME 034: owner_id de okunur (bireysel sahiplik kapısı için)
  SELECT id, company_id, owner_id INTO v_vehicle_id, v_company_id, v_owner_id
  FROM public.vehicles
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  v_payload := coalesce(p_payload, '{}'::jsonb);

  IF p_type = ANY (c_log_types) THEN
    SELECT count(*) INTO v_recent
    FROM public.vehicle_events
    WHERE vehicle_id = v_vehicle_id::text   -- DÜZELTME 026: TEXT kolon ↔ UUID değişken cast
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
  VALUES (v_vehicle_id::text, p_type, v_store)   -- DÜZELTME 026: TEXT kolona açık cast
  RETURNING id INTO v_event_id;

  -- DÜZELTME 034: filo VEYA bireysel sahiplik — sahipsiz araçta konum atlanır.
  v_lat := NULLIF(v_payload->>'lat', '')::double precision;
  v_lng := NULLIF(v_payload->>'lng', '')::double precision;
  IF v_lat IS NOT NULL AND v_lng IS NOT NULL
     AND (v_company_id IS NOT NULL OR (v_company_id IS NULL AND v_owner_id IS NOT NULL)) THEN
    INSERT INTO public.vehicle_locations (vehicle_id, company_id, lat, lng, heading_deg)
    VALUES (v_vehicle_id, v_company_id, v_lat, v_lng,
            NULLIF(v_payload->>'heading', '')::double precision);
  END IF;

  -- DÜZELTME 024d: NOT NULL kolonlar coalesce(0); is_online = true
  INSERT INTO public.vehicle_telemetry AS t (vehicle_id, lat, lng, speed, fuel, temp, rpm, is_online, updated_at)
  VALUES (
    v_vehicle_id,
    v_lat,
    v_lng,
    coalesce(NULLIF(v_payload->>'speed', '')::double precision, 0),
    coalesce(NULLIF(v_payload->>'fuel',  '')::double precision, 0),
    coalesce(NULLIF(v_payload->>'temp',  '')::double precision, 0),
    coalesce(NULLIF(v_payload->>'rpm',   '')::double precision, 0),
    true,
    now()
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    lat        = COALESCE(EXCLUDED.lat, t.lat),
    lng        = COALESCE(EXCLUDED.lng, t.lng),
    speed      = EXCLUDED.speed,
    fuel       = CASE WHEN NULLIF(v_payload->>'fuel', '') IS NULL THEN t.fuel ELSE EXCLUDED.fuel END,
    temp       = CASE WHEN NULLIF(v_payload->>'temp', '') IS NULL THEN t.temp ELSE EXCLUDED.temp END,
    rpm        = CASE WHEN NULLIF(v_payload->>'rpm',  '') IS NULL THEN t.rpm  ELSE EXCLUDED.rpm  END,
    is_online  = true,
    updated_at = now();

  RETURN v_event_id;
END;
$function$;

-- ── 4. GRANT / RLS ────────────────────────────────────────────────────
-- `pair_vehicle_to_user` p_user_id'yi PARAMETRE alır → istemci rollerine
-- AÇILMAZ; yalnız sunucu (service_role) çağırır. Aksi hâlde bir kullanıcı
-- başkasının kimliğiyle araç bağlayabilirdi.
REVOKE ALL ON FUNCTION public.pair_vehicle_to_user(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pair_vehicle_to_user(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pair_vehicle_to_user(text, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.pair_vehicle_to_user(text, uuid) TO service_role;

-- `vehicle_pairings` RLS'i ZATEN AÇIK (command_bus.sql) ve politikaları
-- değişmedi; yeni kolon mevcut tablo izinlerini devralır. Kolon bazlı yeni
-- GRANT gerekmez (tablo düzeyi GRANT'lar geçerlidir).
ALTER TABLE public.vehicle_pairings ENABLE ROW LEVEL SECURITY;

-- ── 5. DOĞRULAMA (CLAUDE.md §Migration Verification) ──────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pair_vehicle_to_user') THEN
    RAISE EXCEPTION '034: pair_vehicle_to_user oluşmadı';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_pairings' AND column_name = 'company_id'
  ) THEN
    RAISE EXCEPTION '034: vehicle_pairings.company_id oluşmadı';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public'
      AND tablename = 'vehicle_pairings' AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION '034: vehicle_pairings RLS kapalı';
  END IF;

  -- anon/authenticated bu fonksiyonu ÇAĞIRAMAMALI (kimlik taklidi kapısı)
  IF has_function_privilege('anon', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '034: pair_vehicle_to_user istemci rollerine AÇIK — güvenlik ihlali';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.pair_vehicle_to_user(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '034: service_role pair_vehicle_to_user çağıramıyor';
  END IF;

  SELECT string_agg(t, ', ') INTO v_missing
  FROM (
    SELECT unnest(ARRAY['vehicles','vehicle_pairings','vehicle_locations','profiles']) AS t
  ) x
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = x.t AND rowsecurity = true
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '034: RLS kapalı tablo(lar): %', v_missing;
  END IF;

  RAISE NOTICE '034: pairing company_id + bireysel sahiplik GPS kapısı uygulandı';
END $$;

-- Elle doğrulama sorguları (uygulama sonrası çalıştırılmalı):
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'vehicle_pairings';
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname = 'public' AND tablename IN ('vehicles','vehicle_pairings','vehicle_locations');
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'vehicle_locations';
