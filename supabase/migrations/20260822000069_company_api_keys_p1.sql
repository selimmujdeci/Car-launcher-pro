-- ═══════════════════════════════════════════════════════════════════════════
-- 069  DIŞ MÜŞTERİ REST API'Sİ — ŞİRKET ANAHTARLARI + HIZ SINIRI  (V-16/7)
--
-- ── BULGU ─────────────────────────────────────────────────────────────────
-- Enterprise sayfası *"REST API ile mevcut sistemlere entegrasyon"* vaat
-- ediyordu. Ölçüm: 20 Next.js rotası var ama **hepsi iç UI ucu** (çerez
-- oturumu). Müşteri anahtarı YOK · doküman YOK · hız sınırı YOK. Yani bir
-- müşterinin kendi sisteminden veri çekmesinin HİÇBİR yolu yoktu.
--
-- ── NEDEN ARAÇ ANAHTARI KULLANILMADI ──────────────────────────────────────
-- `vehicles.api_key_hash` **cihaz** anahtarıdır: tek bir aracı temsil eder ve
-- head unit'te durur. Müşteri entegrasyonuna vermek, bir müşteriye **cihazın
-- kimliğini** vermek olurdu — cihaz o anahtarla telemetri yazar. Okuma amaçlı
-- bir entegrasyona yazma kimliği vermek kabul edilemez. Bu yüzden **şirket
-- kapsamlı, salt-okunur, ayrı** bir anahtar sınıfı açıldı.
--
-- ── GÜVENLİK KARARLARI ────────────────────────────────────────────────────
--  · Anahtar **HAM SAKLANMAZ**; yalnız SHA-256 özeti tutulur. Ham değer
--    **yalnız oluşturma anında BİR KEZ** döner — kaybedilirse yenisi üretilir.
--  · Görüntüleme için ilk 8 karakter (`key_prefix`) ayrıca tutulur ki kullanıcı
--    hangi anahtarı iptal ettiğini bilsin; bu önek **tek başına işe yaramaz**.
--  · Kapsam (`scopes`) BEYAZ LİSTEDİR ve v1'de yalnız okuma vardır. Yazma
--    kapsamı BİLİNÇLİ OLARAK YOK: dış bir anahtarla araca komut yazmak, bu
--    turun kapsamının çok ötesinde bir güvenlik yüzeyidir.
--  · Tablo `anon`/`authenticated`a KAPALIDIR (RLS açık, policy yok). Yönetim
--    yalnız SECURITY DEFINER RPC'lerle ve **yalnız owner/admin** tarafından.
--  · Hız sınırı SABİT PENCERE sayacıdır ve **atomik UPSERT** ile artar; iki
--    eşzamanlı istek sayacı kaybetmez.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.company_api_keys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name                text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  /* SHA-256 özeti — ham anahtar ASLA saklanmaz.
     `sha256()` PostgreSQL YERLEŞİĞİDİR; `pgcrypto.digest()` KULLANILMADI çünkü
     o eklenti `extensions` şemasındadır ve `SET search_path = public, pg_temp`
     altında BULUNAMAZ — fonksiyon çalışma zamanında patlardı (matris yakaladı). */
  key_hash            text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  /* Yalnız TANIMA içindir; tek başına kimlik doğrulamaz. */
  key_prefix          text NOT NULL CHECK (length(key_prefix) = 8),
  scopes              text[] NOT NULL DEFAULT ARRAY['read:vehicles','read:trips'],
  rate_limit_per_min  integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_min BETWEEN 1 AND 6000),
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz,
  revoked_at          timestamptz
);

CREATE INDEX IF NOT EXISTS company_api_keys_company_idx ON public.company_api_keys (company_id);

/* Sabit pencere sayacı — pencere başına tek satır. */
CREATE TABLE IF NOT EXISTS public.company_api_usage (
  key_id        uuid NOT NULL REFERENCES public.company_api_keys(id) ON DELETE CASCADE,
  window_start  timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, window_start)
);

REVOKE ALL ON TABLE public.company_api_keys  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.company_api_usage FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.company_api_keys  TO service_role;
GRANT ALL ON TABLE public.company_api_usage TO service_role;
ALTER TABLE public.company_api_keys  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_api_usage ENABLE ROW LEVEL SECURITY;

/* ── Yönetici yetkisi ───────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public._api_key_admin_company()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  /* YALNIZ admin/super_admin anahtar yönetebilir. `member` bir anahtar
     üretebilseydi, şirketin tüm verisini dışarı taşıyabilirdi. */
  SELECT p.company_id FROM public.profiles p
   WHERE p.id = auth.uid()
     AND p.company_id IS NOT NULL
     AND p.role IN ('admin', 'super_admin');
$$;

/* ── Oluştur — ham anahtar YALNIZ BURADA, BİR KEZ döner ─────────────────── */
CREATE OR REPLACE FUNCTION public.create_company_api_key(
  p_name text,
  p_raw_key text,
  p_scopes text[] DEFAULT ARRAY['read:vehicles','read:trips'],
  p_rate_limit integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_co uuid := public._api_key_admin_company(); v_id uuid; s text;
BEGIN
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_AUTHORIZED');
  END IF;
  IF p_raw_key IS NULL OR p_raw_key !~ '^[0-9a-f]{64}$' THEN
    /* Anahtar SUNUCUDA üretilir; buraya zayıf bir değer gelirse REDDEDİLİR. */
    RETURN jsonb_build_object('state','REJECTED','reason','WEAK_KEY');
  END IF;

  /* Kapsam BEYAZ LİSTE: bilinmeyen kapsam sessizce yok sayılmaz, REDDEDİLİR. */
  FOREACH s IN ARRAY coalesce(p_scopes, ARRAY[]::text[]) LOOP
    IF s NOT IN ('read:vehicles','read:trips') THEN
      RETURN jsonb_build_object('state','REJECTED','reason','UNKNOWN_SCOPE','scope',s);
    END IF;
  END LOOP;

  INSERT INTO public.company_api_keys (company_id, name, key_hash, key_prefix,
                                       scopes, rate_limit_per_min, created_by)
  VALUES (v_co, btrim(p_name), encode(sha256(p_raw_key::bytea), 'hex'),
          left(p_raw_key, 8),
          coalesce(NULLIF(p_scopes, ARRAY[]::text[]), ARRAY['read:vehicles','read:trips']),
          greatest(least(coalesce(p_rate_limit, 60), 6000), 1), auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('state','CREATED','keyId',v_id,'prefix',left(p_raw_key, 8));
END
$$;

/* ── Listele — ham anahtar ASLA dönmez ──────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.list_company_api_keys()
RETURNS TABLE (
  key_id uuid, name text, key_prefix text, scopes text[],
  rate_limit_per_min integer, created_at timestamptz,
  last_used_at timestamptz, revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_co uuid := public._api_key_admin_company();
BEGIN
  IF v_co IS NULL THEN RETURN; END IF;      -- fail-closed
  RETURN QUERY
  SELECT k.id, k.name, k.key_prefix, k.scopes, k.rate_limit_per_min,
         k.created_at, k.last_used_at, k.revoked_at
    FROM public.company_api_keys k
   WHERE k.company_id = v_co
   ORDER BY k.created_at DESC;
END
$$;

/* ── İptal — silinmez, İZ BIRAKILIR ─────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.revoke_company_api_key(p_key_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_co uuid := public._api_key_admin_company(); n integer;
BEGIN
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_AUTHORIZED');
  END IF;
  /* Satır SİLİNMEZ: kimin ne zaman hangi anahtarı kullandığı denetlenebilsin.
     Silmek, bir sızıntı soruşturmasında izi yok etmek olurdu. */
  UPDATE public.company_api_keys
     SET revoked_at = now()
   WHERE id = p_key_id AND company_id = v_co AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_FOUND_OR_ALREADY_REVOKED');
  END IF;
  RETURN jsonb_build_object('state','REVOKED','keyId',p_key_id);
END
$$;

/* ── Doğrula + hız sınırı — API rotası YALNIZ bunu çağırır ──────────────── */
CREATE OR REPLACE FUNCTION public.authorize_api_key(p_key_hash text, p_scope text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k record; w timestamptz; c integer;
BEGIN
  /* Özet biçimi bile tutmuyorsa sorgu HİÇ yapılmaz. */
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('state','DENIED','reason','MALFORMED_KEY');
  END IF;

  SELECT * INTO k FROM public.company_api_keys WHERE key_hash = p_key_hash;

  /* Bilinmeyen ve iptal edilmiş anahtar AYNI cevabı alır: hangi anahtarın var
     olduğu dışarıya sızmasın (varlık oracle'ı kurulmaz). */
  IF k IS NULL OR k.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('state','DENIED','reason','INVALID_KEY');
  END IF;

  IF NOT (p_scope = ANY (k.scopes)) THEN
    RETURN jsonb_build_object('state','DENIED','reason','SCOPE_NOT_GRANTED');
  END IF;

  /* Sabit pencere: dakika başlangıcına yuvarla. ATOMİK artış — iki eşzamanlı
     istek sayacı kaybetmez (okuyup-yazma yarışı YOK). */
  w := date_trunc('minute', now());
  INSERT INTO public.company_api_usage (key_id, window_start, request_count)
  VALUES (k.id, w, 1)
  ON CONFLICT (key_id, window_start)
  DO UPDATE SET request_count = public.company_api_usage.request_count + 1
  RETURNING request_count INTO c;

  IF c > k.rate_limit_per_min THEN
    RETURN jsonb_build_object('state','RATE_LIMITED','limit',k.rate_limit_per_min,
                              'used',c,'resetAt',w + interval '1 minute');
  END IF;

  /* Son kullanım DAKİKADA EN FAZLA BİR KEZ yazılır: her istekte UPDATE etmek
     yüksek hacimde tabloyu gereksiz şişirir ve kilit üretir. */
  IF k.last_used_at IS NULL OR k.last_used_at < w THEN
    UPDATE public.company_api_keys SET last_used_at = now() WHERE id = k.id;
  END IF;

  RETURN jsonb_build_object('state','ALLOWED','companyId',k.company_id,
                            'keyId',k.id,'limit',k.rate_limit_per_min,'used',c);
END
$$;

REVOKE ALL ON FUNCTION public.create_company_api_key(text, text, text[], integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.list_company_api_keys()                              FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_company_api_key(uuid)                         FROM anon, PUBLIC;
/* `authorize_api_key` YALNIZ sunucu tarafından (service_role) çağrılır:
   tarayıcıya açılsaydı özet deneme-yanılma yüzeyi doğardı. */
REVOKE ALL ON FUNCTION public.authorize_api_key(text, text) FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_company_api_key(text, text, text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_company_api_keys()                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_company_api_key(uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_api_key(text, text)                        TO service_role;

/* Anahtar kullanım sayaçları saklama politikasına bağlanır (067). */
INSERT INTO public.retention_policy (table_name, retain_days, rationale)
VALUES ('company_api_usage', 30,
        'API hiz siniri sayaclari; 30 gun sonrasi teshis degeri uretmez.')
ON CONFLICT (table_name) DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed)
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname IN ('company_api_keys','company_api_usage')
     AND c.relrowsecurity;
  IF n <> 2 THEN RAISE EXCEPTION '069 DOGRULAMA: RLS eksik (% tablo)', n; END IF;

  IF has_table_privilege('anon','public.company_api_keys','SELECT')
     OR has_table_privilege('authenticated','public.company_api_keys','SELECT') THEN
    RAISE EXCEPTION '069 DOGRULAMA: anahtar tablosu okunabiliyor';
  END IF;

  IF has_function_privilege('authenticated','public.authorize_api_key(text,text)','EXECUTE') THEN
    RAISE EXCEPTION '069 DOGRULAMA: authorize_api_key tarayiciya acik (deneme-yanilma yuzeyi)';
  END IF;

  RAISE NOTICE '069 DOGRULAMA GECTI: sirket API anahtarlari + hiz siniri kuruldu';
END
$verify$;
