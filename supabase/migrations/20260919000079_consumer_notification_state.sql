-- ════════════════════════════════════════════════════════════════════
-- 079 — consumer_notification_state: BİLDİRİM DEDUPE DEFTERİ
-- ════════════════════════════════════════════════════════════════════
--
-- ⚠️ HAZIRLANDI, UYGULANMADI. F5.2B masa-başı turunda yazıldı; production'a
--    KOŞULMADI. 077 (push_subscriptions) ve 078 de UYGULANMADI.
--
-- ── NEDEN DAYANIKLI OLMAK ZORUNDA ───────────────────────────────────
-- Dedupe anahtarı SAF bir türevdir (`buildDedupeKey`), ama "bu durum daha
-- önce bildirildi mi?" sorusu DURUM ister. Tetikleyici sunucuda ve
-- STATELESS koşar (Edge Function / cron). Dolayısıyla:
--   · bellek içi Set        → süreç yeniden başlayınca dedupe KAYBOLUR
--   · modül singleton       → aynı sorun, ayrıca çok örnekte tutarsız
--   · tarayıcı localStorage → tarayıcı kapalıyken tetikleyici zaten koşmaz
-- Hiçbiri production dedupe otoritesi OLAMAZ. Bu yüzden tek küçük tablo.
--
-- ── BU BİR SAĞLIK GEÇMİŞİ DEĞİLDİR ──────────────────────────────────
-- Tablo YALNIZ bildirim teslim/dedupe muhasebesi tutar. Bilinçli olarak
-- YOKTUR: verdict kolonu, kanıt kolonu, ölçüm kolonu, zaman serisi, geçmiş
-- satırları. Sağlık hükmü F2.2'nindir ve KOPYALANMAZ; burada saklanan tek
-- şey "hangi olay için en son bildirim gittiğidir".
--
-- ── OLAY YAŞAM DÖNGÜSÜ ──────────────────────────────────────────────
--   open_incident_key NULL     → açık olay yok
--   NOTIFY  → anahtar yazılır, `last_notified_at` damgalanır
--   DEDUPED → hiçbir şey değişmez (olay AÇIK kalır)
--   uygun değil → anahtar NULL'lanır (olay KAPANIR)
-- Kapanış sonrası aynı arıza gerçek kanıtla tekrarlarsa YENİDEN bildirilir.
-- Zaman damgasının değişmesi tek başına yeni olay DEĞİLDİR.
--
-- ── ARAÇ KAPSAMLI, KULLANICI KAPSAMLI DEĞİL ─────────────────────────
-- Olay ARACIN durumudur; o araca bağlı tüm alıcılar aynı olaydan tek kez
-- haberdar olur. Kullanıcı kapsamlı olsaydı aynı arıza her alıcı için ayrı
-- "olay" sayılır ve dedupe kimliği anlamını kaybederdi.
--
-- ── ÖNKOŞULLAR ──────────────────────────────────────────────────────
--   1. 077 uygulanmış olmalı (bildirim gönderilecek bir abonelik deposu yoksa
--      bu defterin yazacağı bir şey de olmaz).
--   2. Önce staging'e uygulanıp doğrulanmalı.
--   3. §3 doğrulama bloğu hatasız geçmeli.
--
-- GERİ ALINABİLİRLİK: tablo yeni ve BOŞ doğar; `DROP TABLE` tam geri alır.
--   Mevcut hiçbir tabloya/politikaya DOKUNULMAZ.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tablo ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consumer_notification_state (
  -- Araç başına TEK satır: olay aracın durumudur (bkz. üst not).
  vehicle_id        uuid PRIMARY KEY
                    REFERENCES public.vehicles (id) ON DELETE CASCADE,

  -- AÇIK olayın OPAK kimliği. NULL = açık olay yok.
  -- ⚠️ Buraya HAM TEŞHİS VERİSİ (DTC kodu vb.) YAZILMAZ: çağıran, saf
  --    dedupe anahtarının ÖZETİNİ (digest) yazar. Eşitlik karşılaştırması
  --    için özet yeterlidir; defterin teşhis içeriği taşımasına gerek yoktur.
  open_incident_key text,

  -- Olayın AÇILDIĞI an (yeni bildirim gönderildiğinde damgalanır).
  opened_at         timestamptz,

  -- En son bildirim DENEMESİ. "Gönderildi" demektir, "görüldü" DEMEZ.
  last_notified_at  timestamptz,

  -- Son denemenin sonucu. `DELIVERED`/`SEEN` BİLİNÇLİ OLARAK YOKTUR:
  -- Web Push protokolü push servisinin mesajı KABUL ettiğini söyler,
  -- kullanıcının gördüğünü SÖYLEMEZ. Olmayan kanıt üretilmez.
  last_outcome      text,

  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT consumer_notification_state_outcome_check
    CHECK (last_outcome IS NULL OR last_outcome = ANY (ARRAY[
      'NOT_ELIGIBLE', 'DEDUPED', 'NO_RECIPIENT',
      'QUEUED', 'SENT', 'FAILED', 'EXPIRED_SUBSCRIPTION'
    ])),

  -- Açık olay varsa açılış anı da bilinmelidir (yarım kayıt üretilmez).
  CONSTRAINT consumer_notification_state_open_consistent
    CHECK ((open_incident_key IS NULL) = (opened_at IS NULL))
);

-- ── 2. RLS — TAM KAPALI (yalnız service_role) ───────────────────────
-- Bu defter SUNUCU muhasebesidir; tarayıcı ne okur ne yazar. RLS açık ve
-- HİÇBİR policy yok → `anon` ve `authenticated` için tam ret.
-- `service_role` RLS'i baypas eder; tetikleyici onunla yazar.
ALTER TABLE public.consumer_notification_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.consumer_notification_state FROM anon, authenticated;

-- ── 3. DOĞRULAMA ────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_rls      boolean;
  v_policies int;
  v_exposed  boolean;
BEGIN
  SELECT relrowsecurity INTO v_rls
  FROM pg_class WHERE oid = 'public.consumer_notification_state'::regclass;
  IF NOT coalesce(v_rls, false) THEN
    RAISE EXCEPTION '079 DÜŞTÜ: RLS kapalı';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'consumer_notification_state';
  IF v_policies <> 0 THEN
    RAISE EXCEPTION '079 DÜŞTÜ: bu defterde policy OLMAMALI (tarayıcıya kapalı), bulunan=%', v_policies;
  END IF;

  SELECT bool_or(has_table_privilege(r, 'public.consumer_notification_state', p))
    INTO v_exposed
  FROM unnest(ARRAY['anon','authenticated']) r,
       unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p;
  IF coalesce(v_exposed, false) THEN
    RAISE EXCEPTION '079 DÜŞTÜ: anon/authenticated ayrıcalığı VAR (fail-closed ihlali)';
  END IF;

  RAISE NOTICE '079 OK: dedupe defteri kuruldu, tarayıcıya tamamen kapalı';
END $verify$;
