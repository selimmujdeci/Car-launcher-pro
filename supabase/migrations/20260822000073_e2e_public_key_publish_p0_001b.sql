-- ═══════════════════════════════════════════════════════════════════════════
-- 073  P0-001B — E2E KOMUT ŞİFRELEMESİNİN EKSİK YARISI
--
-- ── ÖLÇÜLEN KUSUR (canlı Carospro, 2026-08-22) ────────────────────────────
--     select column_name from information_schema.columns
--      where table_name='vehicles' and column_name in ('e2e_public_key','e2e_key_alg');
--     → 0 satır. KOLONLAR HİÇ OLUŞTURULMAMIŞ.
--
-- Oysa protokolün İKİ ucu da yazılmış ve ürün yolunda bağlı:
--   · ARAÇ  : `commandListener.ts:726` her bağlantıda `vehicles` tablosuna
--             `e2e_public_key` + `e2e_key_alg` UPSERT etmeye çalışıyor.
--   · TELEFON: `e2eCommandCrypto.ts:162` aynı kolonu okuyup `ecdh_v1` zarfı
--             üretiyor; okuyamazsa komutu GÖNDERMİYOR (fail-closed).
--   · ARAÇ  : `commandListener.ts:312` E2E gerektiren komutlarda düz metni
--             KATEGORİK reddediyor.
--
-- Sonuç: `lock · unlock · horn · alarm_on · alarm_off · lights_on · clear_dtc`
-- komutları ÜRETİMDE HİÇ ÇALIŞMADI. Araçtaki UPSERT `catch` içinde yutulduğu
-- için kimse fark etmedi; telefon tarafı da dürüstçe "araç anahtarını henüz
-- yayınlamadı" diyordu — doğru mesaj, ama sebebi araç değil ŞEMAYDI.
--
-- ── İKİNCİ KUSUR: KOLONU EKLEMEK TEK BAŞINA YETMEZ ────────────────────────
-- Araç Supabase'e `anon` anahtarıyla, KULLANICI OTURUMU OLMADAN bağlanır.
-- `vehicles` UPDATE politikası (canlıdan ölçüldü):
--     "vehicles: owner update" → owner_id = auth.uid() OR company_id = auth_company_id()
-- Anonim istemcide `auth.uid()` NULL'dur → **UPSERT sessizce 0 satır etkiler**.
-- Yani kolonu ekleyip bırakmak, kusuru şemadan RLS'e taşımaktan ibaret olurdu.
--
-- Bu yüzden yayın, komut okuma ucuyla (069 · `fetch_pending_vehicle_commands`)
-- AYNI sözleşmeye taşınır: `api_key` ile doğrulayan SECURITY DEFINER RPC.
-- Böylece migration 037 Faz 2'nin ön koşulu olan "head unit'in doğrudan tablo
-- erişimini RPC'ye taşı" maddesi de bu yol için karşılanmış olur.
--
-- ── NEDEN PUBLIC KEY YAYINLAMAK GÜVENLİ ───────────────────────────────────
-- Yayınlanan değer ECDH **AÇIK** anahtarıdır; gizli değildir ve tek başına
-- hiçbir şeyin şifresini çözmez. Özel anahtar araçta Keystore'da kalır.
-- Yine de yazma yetkisi `api_key` ile SINIRLIDIR: bir araç yalnız KENDİ
-- satırını yazabilir — başka aracın anahtarını ezmek, o araca gidecek
-- komutları okunabilir hâle getirirdi (aktif MITM).
--
-- ── FAIL-CLOSED DOĞRULAMA ─────────────────────────────────────────────────
-- Biçimi bozuk anahtar KABUL EDİLMEZ. Çöp bir değer yazılırsa telefon onu
-- "yayınlanmış" sanıp şifrelemeye çalışır, `importKey` patlar ve komut
-- "şifrelenemedi" diye reddedilir — yani sessiz bir ölü uç doğardı.
-- Algoritma da beyaz listedir: tanınmayan bir değer, ileride sözleşme
-- değişikliğini fark etmeden kabul etmek anlamına gelirdi.
--
-- VERİ YAZILMAZ · MEVCUT KOLON DEĞİŞMEZ · KİMLİK/PAIRING MİMARİSİNE DOKUNULMAZ.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. KOLONLAR ───────────────────────────────────────────────────────────
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS e2e_public_key text,
  ADD COLUMN IF NOT EXISTS e2e_key_alg    text,
  /* Yayın ZAMANI olmadan "anahtar var" bilgisi yarım kalır: bayat bir anahtar
     ile taze bir anahtar ayırt edilemez. Gözlem yüzeyi bunu kullanır. */
  ADD COLUMN IF NOT EXISTS e2e_key_published_at timestamptz;

COMMENT ON COLUMN public.vehicles.e2e_public_key IS
  'ECDH P-256 AÇIK anahtarı (SPKI, base64). Gizli DEĞİLDİR; özel anahtar '
  'araçta Android Keystore''da kalır. Yalnız publish_device_public_key() yazar.';
COMMENT ON COLUMN public.vehicles.e2e_key_alg IS
  'Anahtar sözleşmesi. Bugün tek geçerli değer: ECDH-P256-AES-GCM-256.';

-- ── 2. YAYIN UCU (cihaz kimliğiyle, RLS'e takılmadan) ─────────────────────
CREATE OR REPLACE FUNCTION public.publish_device_public_key(
  p_api_key    text,
  p_public_key text,
  p_alg        text DEFAULT 'ECDH-P256-AES-GCM-256'
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_vehicle_id uuid;
  v_key        text := btrim(coalesce(p_public_key, ''));
  v_alg        text := btrim(coalesce(p_alg, ''));
  v_changed    boolean;
BEGIN
  IF p_api_key IS NULL OR length(p_api_key) = 0 THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  /* `fetch_pending_vehicle_commands` (069) ile BİREBİR aynı doğrulama —
     ikinci bir cihaz kimliği kavramı üretilmez. Çift okuma, anahtarın
     ileride gerçekten hash'lenmesine (P0-001H) hazır bekler. */
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE api_key_hash = encode(sha256(p_api_key::bytea), 'hex')
     OR coalesce(api_key_hash, api_key) = p_api_key
  LIMIT 1;

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  /* BİÇİM KAPISI — çöp değer "yayınlanmış" sayılmaz.
     P-256 SPKI base64'ü ~124 karakterdir; aralık geniş tutuldu ama
     sınırsız değil (kolonu şişirmek bir yazma yüzeyidir). */
  IF v_key !~ '^[A-Za-z0-9+/]+={0,2}$' OR length(v_key) < 80 OR length(v_key) > 512 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_KEY_FORMAT');
  END IF;

  IF v_alg <> 'ECDH-P256-AES-GCM-256' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'UNSUPPORTED_ALG');
  END IF;

  /* AYNI anahtar yeniden yayınlanırsa `published_at` İLERLETİLMEZ:
     her bağlantıda damgayı tazelemek, "anahtar bu an üretildi" izlenimi
     verir ve gözlem yüzeyini yalancı yapardı. Değişimi ölçmek istiyoruz. */
  SELECT (coalesce(e2e_public_key, '') IS DISTINCT FROM v_key)
    INTO v_changed
    FROM public.vehicles WHERE id = v_vehicle_id;

  UPDATE public.vehicles
  SET e2e_public_key       = v_key,
      e2e_key_alg          = v_alg,
      e2e_key_published_at = CASE WHEN v_changed THEN now()
                                  ELSE coalesce(e2e_key_published_at, now()) END
  WHERE id = v_vehicle_id;

  RETURN jsonb_build_object(
    'ok',        true,
    'vehicle_id', v_vehicle_id,
    'rotated',   v_changed
  );
END
$fn$;

COMMENT ON FUNCTION public.publish_device_public_key(text, text, text) IS
  'P0-001B: araç kendi E2E AÇIK anahtarını yayınlar. Cihaz `anon` ile '
  'bağlandığı için doğrudan UPDATE RLS''e takılıyordu; bu RPC api_key ile '
  'doğrular ve YALNIZ o aracın satırını yazar.';

-- ── 3. YETKİ — cihaz oturumsuz bağlanır (069 ile aynı model) ──────────────
REVOKE ALL ON FUNCTION public.publish_device_public_key(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_device_public_key(text, text, text)
  TO anon, authenticated, service_role;

-- ── 4. DOĞRULAMA (fail-closed) ────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vehicles'
       AND column_name IN ('e2e_public_key','e2e_key_alg','e2e_key_published_at')
     HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION '073 DOĞRULAMA DÜŞTÜ: üç E2E kolonunun hepsi yok';
  END IF;

  IF has_function_privilege('public', 'public.publish_device_public_key(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '073 DOĞRULAMA DÜŞTÜ: yayın ucu PUBLIC''e açık';
  END IF;

  IF NOT has_function_privilege('anon', 'public.publish_device_public_key(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      '073 DOĞRULAMA DÜŞTÜ: anon yayın yapamıyor — araç anahtarını YAYINLAYAMAZ';
  END IF;

  RAISE NOTICE '073 DOĞRULAMA: 3/3 GECTI';
END
$verify$;

COMMIT;
