-- ═══════════════════════════════════════════════════════════════════════════
-- 043 — FLEET VEHICLE IDENTITY P1
--
-- YALNIZ İLERİ MIGRATION. 033–042 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── NEDEN GEREKLİ ────────────────────────────────────────────────────────
-- 1) **042'DE GERÇEK BİR KUSUR VAR (ölçüldü):** `record_vehicle_identity`
--    `p_fingerprint_version int` bekliyor, ancak istemci parmak izi ŞEMA
--    sürümünü metin olarak üretiyor (`'fp1'`). Gerçek PostgreSQL'de sonuç:
--      `invalid input syntax for type integer: "v3" (22P02)`
--    → kimlik çağrısının TAMAMI düşüyor. P1'in kimlik boru hattını
--    bağlaması bu kusur kapatılmadan İMKANSIZ. Bu yüzden kolon ve parametre
--    `text`e taşınır.
-- 2) **Kimlik revizyonu:** protokol değişimi bir ÇAKIŞMA DEĞİLDİR (aynı araç
--    CAN'dan KWP'ye düşebilir, adaptör değişebilir) ama kimliği İLERLETİR.
--    042'de bunu taşıyacak alan yoktu → `identity_revision`.
-- 3) **`UNCHANGED` hükmü:** 042 her uyumlu çağrıda güveni +0.10 artırıyordu.
--    Aynı kimliğin tekrar bildirilmesi YENİ KANIT DEĞİLDİR; güven puanı
--    tekrarla şişirilemez. Sunucu artık `UNCHANGED` döner ve güveni SABİT
--    tutar (istemci dedupe'una ek İKİNCİ kapı — savunma katmanlı).
-- 4) **Araç nesli:** tanı profili seçimine ipucu (`vehicle_generation`).
--    KARAR DEĞİL, İPUCUDUR; kanıt yetersizse NULL.
--
-- ── OTORİTE SINIRLARI ────────────────────────────────────────────────────
--   · VIN **sahiplik otoritesi DEĞİLDİR** — sahiplik `owner_id` +
--     `pair_vehicle_to_user` zinciridir. Bu migration sahipliğe DOKUNMAZ.
--   · `device_id` araç kimliği DEĞİLDİR — kimlik tablosuna GİRMEZ.
--   · Ham parmak izi girdileri (ECU adresleri, PID bitmap, adaptör MAC)
--     saklanmaz; yalnız deterministik `fingerprint_hash`.
--   · Okuma RPC'si VIN'i MASKELİ döndürür; `anon` erişimi REVOKE.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. KOLONLAR (hepsi NULLABLE — geçmiş satırlar bozulmaz) ─────────────
ALTER TABLE public.vehicle_identity
  ADD COLUMN IF NOT EXISTS identity_revision   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS vehicle_generation  text,
  ADD COLUMN IF NOT EXISTS last_protocol_change_at timestamptz,
  ADD COLUMN IF NOT EXISTS protocol_change_count   integer NOT NULL DEFAULT 0;

-- `fingerprint_version`: smallint → text (istemci şema sürümü metindir).
-- Mevcut sayısal değerler metne çevrilir; veri KAYBI YOK.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicle_identity'
       AND column_name='fingerprint_version' AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.vehicle_identity
      ALTER COLUMN fingerprint_version TYPE text USING fingerprint_version::text;
  END IF;
END $$;

-- Revizyon geriye gitmez.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='vehicle_identity_revision_positive'
  ) THEN
    ALTER TABLE public.vehicle_identity
      ADD CONSTRAINT vehicle_identity_revision_positive CHECK (identity_revision >= 1);
  END IF;
END $$;

-- ── 2. ESKİ İMZAYI DÜŞÜR (int → text değişimi imzayı değiştirir) ────────
DROP FUNCTION IF EXISTS public.record_vehicle_identity(
  text, text, text, text, text, int, text, int, text);

-- ── 3. KİMLİK YAZMA RPC — düzeltilmiş sözleşme ──────────────────────────
CREATE OR REPLACE FUNCTION public.record_vehicle_identity(
  p_api_key             text,
  p_vin                 text DEFAULT NULL,
  p_vin_source          text DEFAULT NULL,
  p_make                text DEFAULT NULL,
  p_model               text DEFAULT NULL,
  p_model_year          int  DEFAULT NULL,
  p_fingerprint_hash    text DEFAULT NULL,
  p_fingerprint_version text DEFAULT NULL,   -- ⚠️ 042'de int idi → 22P02 kusuru
  p_active_obd_protocol text DEFAULT NULL,
  p_vehicle_generation  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_vehicle_id uuid;
  v_existing   public.vehicle_identity%ROWTYPE;
  v_vin        text := NULLIF(btrim(coalesce(p_vin, '')), '');
  v_src        text := NULLIF(btrim(coalesce(p_vin_source, '')), '');
  v_fp         text := NULLIF(btrim(coalesce(p_fingerprint_hash, '')), '');
  v_fpv        text := NULLIF(btrim(coalesce(p_fingerprint_version, '')), '');
  v_proto      text := NULLIF(btrim(coalesce(p_active_obd_protocol, '')), '');
  v_gen        text := NULLIF(btrim(coalesce(p_vehicle_generation, '')), '');
  v_make       text := NULLIF(btrim(coalesce(p_make, '')), '');
  v_model      text := NULLIF(btrim(coalesce(p_model, '')), '');
  v_conflict   boolean := false;
  v_reason     text := NULL;
  v_conf       numeric(3,2);
  v_rev        integer;
  v_proto_chg  boolean := false;
  v_changed    boolean := false;
BEGIN
  -- Kimlik doğrulama: api_key → araç. Sahiplik BURADA belirlenmez.
  SELECT id INTO v_vehicle_id FROM public.vehicles
   WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;

  -- Doğrulanmamış kaynak "verified" gibi işaretlenmez.
  IF v_src IS NOT NULL AND v_src NOT IN ('OBD_MODE09','MANUAL','UNVERIFIED') THEN
    v_src := 'UNVERIFIED';
  END IF;
  -- Biçimi tutmayan VIN KABUL EDİLMEZ (null = bilinmiyor; kısaltma/tamamlama YOK).
  IF v_vin IS NOT NULL AND length(v_vin) NOT BETWEEN 11 AND 17 THEN
    v_vin := NULL;
    v_src := NULL;
  END IF;
  -- Kaynaksız VIN veya VIN'siz kaynak taşınmaz.
  IF v_vin IS NULL THEN v_src := NULL; END IF;
  -- Parmak izi hash'i yoksa sürümü de anlamsızdır.
  IF v_fp IS NULL THEN v_fpv := NULL; END IF;

  SELECT * INTO v_existing FROM public.vehicle_identity
   WHERE vehicle_id = v_vehicle_id FOR UPDATE;

  -- ── İLK KAYIT ────────────────────────────────────────────────────────
  IF NOT FOUND THEN
    v_conf := CASE WHEN v_vin IS NOT NULL THEN 0.70 ELSE 0.50 END;
    INSERT INTO public.vehicle_identity (
      vehicle_id, vin, vin_source, vin_observed_at, make, model, model_year,
      fingerprint_hash, fingerprint_version, active_obd_protocol,
      vehicle_generation, identity_confidence, identity_revision, identity_updated_at
    ) VALUES (
      v_vehicle_id, v_vin, v_src,
      CASE WHEN v_vin IS NOT NULL THEN now() ELSE NULL END,
      v_make, v_model, p_model_year, v_fp, v_fpv, v_proto, v_gen,
      v_conf, 1, now()
    );
    RETURN jsonb_build_object(
      'state','CREATED','conflict',false,
      'identityConfidence',v_conf,'identityRevision',1);
  END IF;

  -- ── ÇAKIŞMA TESPİTİ — sessiz overwrite YASAK ─────────────────────────
  -- YALNIZ değer→BAŞKA değer çakışmadır; NULL→değer ÖĞRENMEDİR.
  IF v_vin IS NOT NULL AND v_existing.vin IS NOT NULL AND v_vin <> v_existing.vin THEN
    v_conflict := true; v_reason := 'VIN_MISMATCH';
  ELSIF v_fp IS NOT NULL AND v_existing.fingerprint_hash IS NOT NULL
        AND v_fp <> v_existing.fingerprint_hash THEN
    -- Parmak izi ŞEMA SÜRÜMÜ değiştiyse hash farkı ARAÇ DEĞİŞİMİ DEĞİLDİR
    -- (aynı araç, farklı hesaplama) → çakışma İLAN EDİLMEZ.
    IF v_fpv IS NOT NULL AND v_existing.fingerprint_version IS NOT NULL
       AND v_fpv <> v_existing.fingerprint_version THEN
      v_conflict := false;
    ELSE
      v_conflict := true; v_reason := 'FINGERPRINT_MISMATCH';
    END IF;
  END IF;

  IF v_conflict THEN
    -- ESKİ GÜVENİLİR KAYIT KORUNUR: vin/fingerprint DEĞİŞTİRİLMEZ.
    UPDATE public.vehicle_identity
       SET identity_conflict_count = identity_conflict_count + 1,
           last_conflict_at        = now(),
           last_conflict_reason    = v_reason,
           identity_confidence     = 0.30,
           identity_updated_at     = now()
     WHERE vehicle_id = v_vehicle_id
    RETURNING identity_confidence, identity_revision INTO v_conf, v_rev;

    RETURN jsonb_build_object(
      'state','IDENTITY_CONFLICT','conflict',true,'reason',v_reason,
      'identityConfidence',v_conf,'identityRevision',v_rev);
  END IF;

  -- ── PROTOKOL DEĞİŞİMİ → revision++ (çakışma DEĞİL) ───────────────────
  v_proto_chg := v_proto IS NOT NULL
             AND v_existing.active_obd_protocol IS NOT NULL
             AND v_proto <> v_existing.active_obd_protocol;

  -- ── GERÇEK DEĞİŞİM VAR MI (UNCHANGED kapısı) ─────────────────────────
  -- Aynı kimliğin tekrar bildirilmesi YENİ KANIT DEĞİLDİR → güven artmaz.
  v_changed := v_proto_chg
    OR (v_vin  IS NOT NULL AND v_existing.vin  IS NULL)
    OR (v_fp   IS NOT NULL AND v_existing.fingerprint_hash IS NULL)
    OR (v_proto IS NOT NULL AND v_existing.active_obd_protocol IS NULL)
    OR (v_make IS NOT NULL AND v_existing.make IS NULL)
    OR (v_model IS NOT NULL AND v_existing.model IS NULL)
    OR (p_model_year IS NOT NULL AND v_existing.model_year IS NULL)
    OR (v_gen  IS NOT NULL AND v_existing.vehicle_generation IS NULL)
    OR (v_fpv  IS NOT NULL AND v_existing.fingerprint_version IS DISTINCT FROM v_fpv);

  IF NOT v_changed THEN
    -- Güven SABİT kalır, revizyon ARTMAZ, yalnız görülme anı damgalanır.
    UPDATE public.vehicle_identity
       SET identity_updated_at = now()
     WHERE vehicle_id = v_vehicle_id
    RETURNING identity_confidence, identity_revision INTO v_conf, v_rev;

    RETURN jsonb_build_object(
      'state','UNCHANGED','conflict',false,
      'identityConfidence',v_conf,'identityRevision',v_rev);
  END IF;

  -- ── UYUMLU YENİ KANIT → bounded güven artışı (1.00 ASLA) ─────────────
  v_conf := LEAST(0.95, v_existing.identity_confidence + 0.10);

  UPDATE public.vehicle_identity
     SET vin                 = coalesce(v_vin, vin),
         vin_source          = coalesce(v_src, vin_source),
         vin_observed_at     = CASE WHEN v_vin IS NOT NULL THEN now() ELSE vin_observed_at END,
         make                = coalesce(v_make, make),
         model               = coalesce(v_model, model),
         model_year          = coalesce(p_model_year, model_year),
         -- Şema sürümü değiştiyse hash GÜNCELLENİR (aynı araç, yeni hesaplama).
         fingerprint_hash    = coalesce(v_fp, fingerprint_hash),
         fingerprint_version = coalesce(v_fpv, fingerprint_version),
         active_obd_protocol = coalesce(v_proto, active_obd_protocol),
         vehicle_generation  = coalesce(v_gen, vehicle_generation),
         identity_confidence = v_conf,
         identity_revision   = identity_revision + CASE WHEN v_proto_chg THEN 1 ELSE 0 END,
         protocol_change_count   = protocol_change_count + CASE WHEN v_proto_chg THEN 1 ELSE 0 END,
         last_protocol_change_at = CASE WHEN v_proto_chg THEN now() ELSE last_protocol_change_at END,
         identity_updated_at = now()
   WHERE vehicle_id = v_vehicle_id
  RETURNING identity_revision INTO v_rev;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_proto_chg THEN 'PROTOCOL_CHANGED' ELSE 'UPDATED' END,
    'conflict', false,
    'identityConfidence', v_conf,
    'identityRevision', v_rev);
END;
$fn$;

-- ── 4. FLEET OKUMA RPC — yeni alanlar + VIN MASKELİ ─────────────────────
DROP FUNCTION IF EXISTS public.list_company_vehicle_identity();

CREATE OR REPLACE FUNCTION public.list_company_vehicle_identity()
RETURNS TABLE (
  vehicle_id uuid, vin_masked text, vin_source text, vin_observed_at timestamptz,
  make text, model text, model_year smallint,
  fingerprint_hash_short text, fingerprint_version text,
  active_obd_protocol text, vehicle_generation text,
  identity_confidence numeric, identity_revision integer,
  identity_updated_at timestamptz, identity_conflict_count integer,
  last_conflict_reason text, protocol_change_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;   -- oturum yok → satır yok (fail-closed)

  SELECT company_id INTO v_co FROM public.company_members WHERE user_id = v_uid LIMIT 1;

  RETURN QUERY
  SELECT i.vehicle_id,
         -- HAM VIN DÖNMEZ: yalnız son 6 hane.
         CASE WHEN i.vin IS NULL THEN NULL ELSE '•••' || right(i.vin, 6) END,
         i.vin_source, i.vin_observed_at, i.make, i.model, i.model_year,
         -- Ham hash DÖNMEZ: yalnız ilk 12 karakter.
         CASE WHEN i.fingerprint_hash IS NULL THEN NULL
              ELSE left(i.fingerprint_hash, 12) END,
         i.fingerprint_version, i.active_obd_protocol, i.vehicle_generation,
         i.identity_confidence, i.identity_revision, i.identity_updated_at,
         i.identity_conflict_count, i.last_conflict_reason, i.protocol_change_count
    FROM public.vehicle_identity i
    JOIN public.vehicles v ON v.id = i.vehicle_id
   WHERE v.owner_id = v_uid
      OR (v_co IS NOT NULL AND v.company_id = v_co)
   ORDER BY i.identity_updated_at DESC
   LIMIT 200;
END;
$fn$;

-- ── 5. İZİNLER ──────────────────────────────────────────────────────────
-- Yazma: cihaz çağırır (api_key ile kimliklenir) → anon yolu gerekli.
REVOKE ALL ON FUNCTION public.record_vehicle_identity(
  text,text,text,text,text,int,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_vehicle_identity(
  text,text,text,text,text,int,text,text,text,text)
  TO anon, authenticated, service_role;

-- Okuma: YALNIZ oturumlu kullanıcı. anon KESİN REVOKE.
REVOKE ALL ON FUNCTION public.list_company_vehicle_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_company_vehicle_identity()
  TO authenticated, service_role;

-- ── 6. DOĞRULAMA (fail-closed — sağlanmazsa migration ROLLBACK) ─────────
DO $$
DECLARE
  v_missing text;
  v_def     text;
BEGIN
  -- (a) Yeni kolonlar var mı?
  SELECT string_agg(c, ', ') INTO v_missing FROM (
    SELECT c FROM unnest(ARRAY[
      'identity_revision','vehicle_generation',
      'protocol_change_count','last_protocol_change_at'
    ]) AS c
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='vehicle_identity' AND column_name=c)
  ) q;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '043 HATA: vehicle_identity kolonlari eksik: %', v_missing;
  END IF;

  -- (b) 22P02 KUSURU KAPANDI MI: fingerprint_version artik text olmali.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicle_identity'
       AND column_name='fingerprint_version' AND data_type='text'
  ) THEN
    RAISE EXCEPTION '043 HATA: fingerprint_version text degil (22P02 kusuru acik)';
  END IF;

  -- (c) Eski int imzasi GITMIS olmali (iki otorite kalmasin).
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='record_vehicle_identity'
       AND pg_get_function_identity_arguments(p.oid)
           = 'text, text, text, text, text, integer, text, integer, text'
  ) THEN
    RAISE EXCEPTION '043 HATA: eski int imzasi hala mevcut (ikinci otorite)';
  END IF;

  -- (d) Yazma fonksiyonu SECURITY DEFINER + sabit search_path olmali.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='record_vehicle_identity' LIMIT 1;
  IF v_def IS NULL OR v_def NOT LIKE '%SECURITY DEFINER%'
     OR v_def NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION '043 HATA: record_vehicle_identity DEFINER/search_path eksik';
  END IF;

  -- (e) UNCHANGED hukmu gercekten uygulanmis olmali (guven sisirme kapisi).
  IF v_def NOT LIKE '%UNCHANGED%' THEN
    RAISE EXCEPTION '043 HATA: UNCHANGED hukmu yok (guven tekrarla sisirilebilir)';
  END IF;

  -- (f) anon OKUMA RPC'sini CALISTIRAMAMALI.
  IF has_function_privilege('anon', 'public.list_company_vehicle_identity()', 'EXECUTE') THEN
    RAISE EXCEPTION '043 HATA: anon kimlik okuma RPC yetkisi acik';
  END IF;

  -- (g) VIN maskeleme okuma RPC'sinde DURUYOR olmali.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='list_company_vehicle_identity' LIMIT 1;
  IF v_def IS NULL OR v_def NOT LIKE '%right(i.vin, 6)%' THEN
    RAISE EXCEPTION '043 HATA: okuma RPC ham VIN donduruyor (maskeleme yok)';
  END IF;

  -- (h) RLS kimlik tablosunda ACIK kalmali.
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname='public' AND tablename='vehicle_identity' AND rowsecurity
  ) THEN
    RAISE EXCEPTION '043 HATA: vehicle_identity RLS kapali';
  END IF;

  RAISE NOTICE '043 OK: 22P02 kusuru kapandi · revizyon + nesil · UNCHANGED hukmu · anon kapali.';
END $$;

COMMIT;
