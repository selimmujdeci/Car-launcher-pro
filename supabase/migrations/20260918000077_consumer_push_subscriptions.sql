-- ════════════════════════════════════════════════════════════════════
-- 077 — push_subscriptions: TÜKETİCİ (Arabam Cebimde) Web Push otoritesi
-- ════════════════════════════════════════════════════════════════════
--
-- ⚠️ HAZIRLANDI, UYGULANMADI. Bu dosya F5.1'de YAZILDI ama production'a
--    KOŞULMADI (kullanıcı kararı: "altyapıyı hazırla ama deploy etme").
--    Uygulanmadan önce §UYGULAMA ÖNKOŞULLARI eksiksiz karşılanmalıdır.
--
-- ── ÖLÇÜLEN GERÇEK (production, salt-okuma, 2026-09-18) ──────────────
--   GET https://vdpcdhrdmsacftrietzq.supabase.co/rest/v1/push_subscriptions
--     → HTTP 404  {"code":"PGRST205"}            ← TABLO YOK
--   GET .../rest/v1/vehicle_push_tokens  → HTTP 200 ← VAR
--   GET .../functions/v1/push-notify     → HTTP 405
--
-- ⚠️ DÜZELTME (PROD-1 · 2026-09-19): bu blokta ÖNCEDEN şu hüküm yazıyordu —
--   "`push-notify` slug'ında canlıda duran implementasyon FCM ARAÇ-UYANDIRMA
--   sürümüdür." BU YANLIŞTI ve neden yanlış olduğu önemlidir:
--
--   O ölçümde `curl -i` çıktısının DURUM SATIRI okunmuştu
--   (`HTTP/1.1 405 Method Not Allowed`) — bu, HTTP protokolünün STANDART
--   reason phrase'idir, fonksiyonun GÖVDESİ DEĞİLDİR. Gövde hiç görülmemişti.
--
--   Gövde okunduğunda iki bağımsız sinyal ÇIKTI:
--     · GET gövdesi → `Method not allowed`  (küçük harf; Web Push/VAPID sürümü)
--       FCM sürümü `Method Not Allowed` (büyük harf) döner.
--     · OPTIONS     → 200 + 0 bayt          (Web Push sürümü CORS döndürür)
--       FCM sürümü OPTIONS'a da 405 döner.
--
--   GERÇEK: `push-notify` slug'ında canlıda duran implementasyon
--   WEB PUSH / VAPID (tüketici) sürümüdür. ARAÇ PUSH-TO-WAKE production'a
--   HİÇ DEPLOY EDİLMEMİŞTİR.
--
--   Ders: bir HTTP durum satırı kimlik kanıtı DEĞİLDİR; kimlik ancak
--   uygulamanın KENDİ ürettiği gövde/başlık ile saptanır.
--
-- ── İKİ AYRI GERÇEK, TEK SLUG (kök neden) ───────────────────────────
--   Depoda `push-notify` adını İKİ implementasyon paylaşıyor:
--
--     A) supabase/functions/push-notify          (web-push · VAPID)
--        → `push_subscriptions` okur, İNSANA görünür bildirim gönderir,
--          tüketiciyi `/kumanda`ya yönlendirir.
--     B) website/supabase/functions/push-notify  (FCM · data-only)
--        → `vehicle_push_tokens` okur, ARACI uyandırır (Push-to-Wake),
--          görünür bildirim GÖNDERMEZ.
--
--   Bir slug'a yalnız BİRİ deploy edilebilir; B canlıda olduğu için A'nın
--   tüm yolu ÖLÜDÜR. Sonuç zinciri (hepsi ölçüldü):
--     · Tüketici push kaydı VAR OLMAYAN tabloya yazıyordu → sessiz düşüş.
--       (F5.1 · commit 772d67a7 bunu artık FAILED diye söylüyor.)
--     · `public/sw.js` push handler'ı ve /kumanda yönlendirmesi
--       production'da HİÇ tetiklenmedi.
--     · `vehicleStore.startWatchdog` `vehicle_offline` POST'unu
--       Authorization BAŞLIĞI OLMADAN atıyor → B'nin auth kapısı 401 verir.
--       Bu yol da ölüdür (bu migration onu DİRİLTMEZ — bildirim ÜRETME
--       politikası ayrı bir karardır, §7 domain sınırı).
--
--   BU MIGRATION İKİSİNİ BİRLEŞTİRMEZ. İki farklı truth'tur:
--     `push_subscriptions`  = İNSAN aboneliği, sahibi `auth.uid()`
--     `vehicle_push_tokens` = CİHAZ token'ı,   sahibi araç
--   Tek otorite kuralı (§6) bunların ayrı kalmasını GEREKTİRİR.
--
-- ── NEDEN KÖK 007 DEĞİL DE YENİ DOSYA ───────────────────────────────
--   `migrations_archive/root/20260422000007_push_subscriptions.sql` aynı
--   tabloyu tanımlıyor ama ARŞİVDE ve canlıya hiç uygulanmamış. Ayrıca
--   yorumunda "Anon upsert (araç bağlantısı olmadan da abonelik olabilir)"
--   YAZIYOR, oysa policy'si `user_id = auth.uid()` ile anon'u zaten
--   REDDEDİYOR — yorum ile davranış ÇELİŞİYOR. Burada çelişki kapatılır:
--   anonim abonelik YOKTUR, sahiplik ZORUNLUDUR (fail-closed, §12).
--
-- ── UYGULAMA ÖNKOŞULLARI (hepsi sağlanmadan KOŞMA) ──────────────────
--   1. VAPID anahtar çifti üretilir:  npx web-push generate-vapid-keys
--      · PUBLIC  → Vercel env `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (production)
--      · PRIVATE → Supabase Function secret `VAPID_PRIVATE_KEY`
--        ⚠️ PRIVATE anahtar depoya, log'a, dokümana YAZILMAZ.
--      Anahtar yoksa istemci `FAILED/NO_VAPID_KEY` der (F5.1) — sahte
--      "aktif" ÜRETMEZ, yani bu adım atlanırsa ürün YALAN SÖYLEMEZ.
--   2. Slug çakışması ÇÖZÜLDÜ (F5.2):
--        A (tüketici Web Push) → `supabase/functions/consumer-push-notify`
--        B (araç uyandırma)    → `website/supabase/functions/push-notify`
--      A taşındı, B YERİNDE BIRAKILDI.
--
--   ⚠️ DÜZELTME (PROD-1 · 2026-09-19): burada da "B production'da CANLI"
--      yazıyordu — YANLIŞTI (bkz. üstteki kimlik düzeltmesi). Doğru gerekçe
--      şudur: `push-notify` slug'ında canlıda duran ESKİ A KOPYASIDIR ve o
--      kopya çalışamaz (`push_subscriptions` prod'da YOK). B ise HİÇ deploy
--      edilmemiştir; dolayısıyla araç Push-to-Wake production'da ÇALIŞMIYOR
--      ve komutlar yalnız 15 sn'lik yoklamayla geliyor.
--      Dizin ayrımı yine de DOĞRUDUR: iki implementasyon artık ayrı
--      slug'larda ve deploy sırasında birbirini EZEMEZ.
--      Artık `supabase functions deploy <slug>` hangi dizinden koşulursa
--      koşulsun diğerini EZEMEZ. Regresyon kilidi:
--        src/__tests__/pushArchitectureSeparationF52.test.ts
--      KALAN İŞ (ayrı, koordineli tur): B'yi `vehicle-push-wake` gibi
--      anlamını söyleyen bir ada taşımak — önce fonksiyon yeni ada deploy
--      edilir ve doğrulanır, SONRA çağıranlar güncellenir.
--   3. Bu migration `supabase db push` ile ÖNCE staging'e
--      (azvmrbjaxiwzaweraozi) uygulanır ve orada doğrulanır.
--   4. Doğrulama: aşağıdaki §4 bloğu hatasız geçmeli.
--
-- GERİ ALINABİLİRLİK: tablo yeni ve BOŞ doğar; `DROP TABLE` ile tam geri
--   alınır. Mevcut hiçbir tabloya/politikaya DOKUNULMAZ.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tablo ────────────────────────────────────────────────────────
-- `user_id` NOT NULL: sahipsiz abonelik ANLAMSIZDIR. Gönderici satırı
-- kullanıcıya bağlayamazsa kime bildirim atacağını bilemez; sahipsiz satır
-- yalnız çöp ve sızıntı yüzeyidir. 007'deki nullable hâli bilinçli olarak
-- DARALTILDI.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Tarayıcının verdiği push endpoint'i. HASSAS kabul edilir: bunu bilen
  -- taraf (VAPID özel anahtarıyla birlikte) o tarayıcıya bildirim atabilir.
  -- Bu yüzden hiçbir yerde loglanmaz ve RLS dışına ÇIKARILMAZ.
  endpoint     text        NOT NULL UNIQUE,
  -- Tam PushSubscription JSON'u (keys.p256dh, keys.auth dahil).
  subscription jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subs_user_idx
  ON public.push_subscriptions (user_id);

-- ── F5.2 DENETİM NOTU · HESAP DEĞİŞİMİ ve endpoint SAHİPLİĞİ ────────
-- `endpoint` GLOBAL olarak UNIQUE'tir ve bu BİLİNÇLİDİR. Alternatif
-- (`UNIQUE(user_id, endpoint)`) aynı tarayıcı endpoint'ini İKİ kullanıcıya
-- birden bağlardı; gönderici o endpoint'e yazdığında B, A'nın aracına ait
-- bildirimi görürdü. Yani "kullanıcı başına unique" bir SIZINTI yoludur.
--
-- Sonuç (kabul edilen davranış): aynı tarayıcıda A çıkış yapmadan B giriş
-- yaparsa, B'nin upsert'i A'nın satırını RLS yüzünden GÖREMEZ ve kayıt
-- BAŞARISIZ olur. Bu FAIL-CLOSED'dur ve doğrudur:
--   · B, A'nın aboneliğini DEVRALMAZ (sızıntı yok),
--   · istemci bunu sessizce yutmaz — `FAILED/BACKEND_PERSIST_FAILED` der.
--
-- "endpoint'i talep eden herkes devralabilsin" TÜRÜ bir policy EKLENMEDİ:
-- endpoint'i bilen biri başkasının kaydını silebilir/ele geçirebilirdi.
-- Güvenli kurtarma yolu İSTEMCİDEDİR: `pushEngine.unsubscribe()` ile eski
-- abonelik iptal edilir, yeniden `subscribe()` YENİ bir endpoint üretir.
-- Kanonik çıkış temizliği (`DEVICE_AND_PUSH_REVOKE`) bunu zaten yapar.

-- ── 2. RLS — fail-closed, sahiplik ZORUNLU ──────────────────────────
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Kullanıcı YALNIZ kendi aboneliklerini görür/yazar/siler.
--   · USING      → okuma/güncelleme/silme kapısı (IDOR'u kapatır)
--   · WITH CHECK → yazılan satırın başkasına ATANAMAMASINI garanti eder
-- `FOR ALL` çıkış temizliğini (DELETE) de kapsar:
--   security/accountCleanup · DEVICE_AND_PUSH_REVOKE fazı buna dayanır.
DROP POLICY IF EXISTS "push_subs: owner manages own" ON public.push_subscriptions;
CREATE POLICY "push_subs: owner manages own"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ANON'A POLICY VERİLMEZ (bilinçli). RLS açık + policy yok = tam ret.
-- Oturumsuz abonelik sessizce "çalışıyor" görünemez; istemci bunu
-- `FAILED/NOT_AUTHENTICATED` diye SÖYLER (F5.1).
REVOKE ALL ON public.push_subscriptions FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

-- ── 3. updated_at tetikleyicisi ─────────────────────────────────────
-- `fn_set_updated_at` prod baseline'da MEVCUTTUR (00000000000000:785).
DROP TRIGGER IF EXISTS trg_push_subs_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subs_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ── 4. DOĞRULAMA — sessiz sapmaya karşı ölç ─────────────────────────
DO $$
DECLARE
  v_rls      boolean;
  v_policies int;
  v_anon     boolean;
  v_nullable text;
BEGIN
  SELECT relrowsecurity INTO v_rls
  FROM pg_class WHERE oid = 'public.push_subscriptions'::regclass;
  IF NOT coalesce(v_rls, false) THEN
    RAISE EXCEPTION '077 DÜŞTÜ: push_subscriptions üzerinde RLS KAPALI';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'push_subscriptions';
  IF v_policies = 0 THEN
    RAISE EXCEPTION '077 DÜŞTÜ: policy YOK (RLS açık + policy yok = tablo tamamen erişilemez)';
  END IF;

  -- anon HİÇBİR ayrıcalık taşımamalı: sahipsiz abonelik yolu KAPALI.
  SELECT bool_or(has_table_privilege('anon', 'public.push_subscriptions', p))
    INTO v_anon
  FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p;
  IF coalesce(v_anon, false) THEN
    RAISE EXCEPTION '077 DÜŞTÜ: anon rolünün push_subscriptions ayrıcalığı VAR (fail-closed ihlali)';
  END IF;

  -- Sahiplik kolonu nullable kalırsa sahipsiz satır doğabilir.
  SELECT is_nullable INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'push_subscriptions'
    AND column_name  = 'user_id';
  IF v_nullable <> 'NO' THEN
    RAISE EXCEPTION '077 DÜŞTÜ: user_id nullable — sahipsiz abonelik mümkün';
  END IF;

  RAISE NOTICE '077 OK: push_subscriptions kuruldu, RLS açık, anon kapalı, sahiplik zorunlu';
END $$;
