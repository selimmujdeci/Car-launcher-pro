-- ════════════════════════════════════════════════════════════════════
-- 080 — vehicle_diagnostic_scans: KALICI TEŞHİS GEÇMİŞİ
-- ════════════════════════════════════════════════════════════════════
--
-- ⚠️ HAZIRLANDI, UYGULANMADI. F5.3 masa-başı turunda yazıldı; production'a
--    KOŞULMADI. 077 · 078 · 079 da uygulanmadı ve bu dosya onlara DOKUNMAZ.
--
-- ── NEDEN YENİ TABLO (mevcut otorite ARANDI, YOK) ───────────────────
-- Production salt-okuma denetimi (şema dökümü):
--   · `diag|dtc|fault|scan` adında KALICI tablo YOK.
--   · `get_recent_diagnostics` yalnız **super_admin**'e açık DESTEK yüzeyi;
--     okuduğu türler `support_snapshot|obd_diag|critical_error|voice_diag`.
--     `obd_diag` BAĞLANTI teşhisidir (OBD_CONNECT_FAIL vb.), DTC TARAMASI DEĞİL.
--   · `vehicle_commands` KALICI DEĞİL: `_retention_days('vehicle_commands',14)`
--     → terminal satırlar 14 GÜN sonra siliniyor. Teşhis geçmişi olamaz.
--   · `vehicle_events` ÇARE DEĞİL — BELİRLEYİCİ GEREKÇE: RLS'i
--     `authenticated` kullanıcıya KENDİ ARACI İÇİN **INSERT** veriyor
--     ("Kendi aracı için olay ekle"). Yani TARAYICI teşhis geçmişi
--     UYDURABİLİR. Teşhis gerçeği kullanıcı tarafından yazılabilir olamaz.
--     Ayrıca `vehicle_id` `text` (FK yok) ve `metadata` sözleşmesiz JSONB.
--
-- ── BU TABLO NE DEĞİLDİR ────────────────────────────────────────────
--   · Yeni DTC tarayıcısı DEĞİL — tarama ARAÇTA yapılır (multiEcuScan).
--   · Yeni severity otoritesi DEĞİL — `severity` ARACIN verdiği değerdir.
--   · Yeni sağlık motoru DEĞİL — güncel sağlık F2.2'nindir ve bu tablo
--     TEK BAŞINA güncel hüküm ÜRETEMEZ (§8).
--   · Ham log/frame deposu DEĞİL — yalnız NORMALIZE ürün gerçeği (§14).
--
-- ── EN ÖNEMLİ SEMANTİK (§6 · §19) ───────────────────────────────────
--   RESULT      → tarama başarılı, EN AZ BİR kod bulundu
--   NO_DTC      → tarama başarılı, KAPSAMINDA kod bulunmadı
--   UNSUPPORTED → araç desteklemiyor   — "sağlıklı" DEĞİL
--   OFFLINE     → araca ulaşılamadı    — "kod yok" DEĞİL
--   TIMEOUT     → araç yanıt vermedi   — "kod yok" DEĞİL
--   FAILED      → tarama düştü         — "kod yok" DEĞİL
--   STALE       → sonuç bayat          — "kod yok" DEĞİL
--
--   KAYIT YOKLUĞU da "arıza yok" DEĞİLDİR — hiç ölçülmedi demektir.
--
-- ── GEÇMİŞ ≠ GÜNCEL (§7) ────────────────────────────────────────────
-- "12 Eylül'de P0300 görüldü" ≠ "bugün P0300 var".
-- "Bugünkü taramada görülmedi" ≠ "tamir edildi" (ECU silinmiş, arıza
-- aralıklı ya da kapsam farklı olabilir). Bu tablo GÖRÜLME KANITI saklar,
-- HÜKÜM saklamaz; bu yüzden `resolved`/`repaired` gibi bir kolon YOKTUR.
--
-- ── İDEMPOTENS (§9) ─────────────────────────────────────────────────
-- `source_command_id` UNIQUE'tir: aynı komut sonucu retry/realtime/reload
-- yüzünden iki kez işlenirse İKİNCİ KAYIT OLUŞMAZ. Ama İKİ AYRI gerçek
-- tarama aynı kodları verse bile AYRI komut kimliği taşıdığı için AYRI
-- kayıttır — DTC listesi tarama kimliği DEĞİLDİR.
--
-- ── RETENTION (§14) ─────────────────────────────────────────────────
-- Bu tablo ARAÇ HAFIZASIDIR; `vehicle_commands`ın 14 günlük TTL'sine
-- BAĞLANMAZ. Saklanan şey normalize ürün gerçeğidir (kod + kapsam +
-- zaman), ham kare/log DEĞİL — bu yüzden satır başına maliyet küçüktür.
-- Sonsuz da tutulmaz: uygulama sırasında mevcut `retention_policy`
-- mekanizmasına **730 gün** (2 yıl) kaydı önerilir. Bu migration
-- SİLME İŞİ KURMAZ — retention politikası ayrı ve açık bir karardır.
--
-- GERİ ALINABİLİRLİK: tablo yeni ve BOŞ doğar (`read_dtc` tamamlanmış
--   komut sayısı production'da 0 ölçüldü) → `DROP TABLE` tam geri alır.
--   Mevcut hiçbir tabloya/politikaya DOKUNULMAZ.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tablo ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_diagnostic_scans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  vehicle_id          uuid NOT NULL
                      REFERENCES public.vehicles (id) ON DELETE CASCADE,

  -- İdempotens anahtarı. `vehicle_commands` 14 günde silinse de bu kimlik
  -- KALIR (FK YOK — kaynak satır yok olduğunda geçmiş silinmemeli).
  source_command_id   uuid UNIQUE,

  status              text NOT NULL,

  -- ARACIN bildirdiği ÖLÇÜM anı. Araç yazmadıysa NULL — UYDURULMAZ.
  measured_at         timestamptz,
  -- Komutun sonlandığı an.
  completed_at        timestamptz,

  -- Tarama KISMİ mi? Kısmi tarama TAM tarama gibi sunulamaz (§10).
  partial             boolean NOT NULL DEFAULT false,

  -- Servis bazlı kapsam: {"stored":"ok","pending":"failed","permanent":"unsupported"}
  -- Bilinmiyorsa NULL. Kapsam KAYBOLMAMALIDIR.
  completeness        jsonb,

  -- Üç değerli: true/false/NULL(bilinmiyor).
  permanent_supported boolean,

  -- Normalize DTC listesi. ARACIN verdiği alanlar korunur; burada kod,
  -- severity veya açıklama ÜRETİLMEZ.
  dtcs                jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Başarısız taramanın sebebi (ürün diliyle). Başarılıda NULL.
  failure_reason      text,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_diagnostic_scans_status_check
    CHECK (status = ANY (ARRAY[
      'RESULT', 'NO_DTC', 'UNSUPPORTED', 'OFFLINE', 'TIMEOUT', 'FAILED', 'STALE'
    ])),

  CONSTRAINT vehicle_diagnostic_scans_dtcs_is_array
    CHECK (jsonb_typeof(dtcs) = 'array'),

  -- KOD YALNIZ `RESULT`TA BULUNUR. Başarısız bir tarama kod TAŞIYAMAZ;
  -- `NO_DTC` ise tanımı gereği BOŞTUR. Bu kısıt "timeout ama kod listesi
  -- dolu" gibi anlamsız satırları DB seviyesinde imkânsız kılar.
  CONSTRAINT vehicle_diagnostic_scans_codes_only_in_result
    CHECK ((jsonb_array_length(dtcs) > 0) = (status = 'RESULT')),

  -- Başarısız durumda sebep BEKLENİR; başarılıda sebep OLMAZ.
  CONSTRAINT vehicle_diagnostic_scans_reason_consistent
    CHECK (
      (status IN ('RESULT','NO_DTC') AND failure_reason IS NULL)
      OR (status NOT IN ('RESULT','NO_DTC'))
    )
);

-- ── 2. İndeksler ────────────────────────────────────────────────────
-- Tipik sorgu: "bu aracın en yeni taramaları". Ölçüm anı NULL olabildiği
-- için sıralama yedeği `completed_at`/`created_at`tır.
CREATE INDEX IF NOT EXISTS vehicle_diagnostic_scans_vehicle_time_idx
  ON public.vehicle_diagnostic_scans
     (vehicle_id, coalesce(measured_at, completed_at, created_at) DESC);

-- "Son BAŞARILI tarama" sorgusu (paylaşım raporu · Son Tarama yüzeyi).
CREATE INDEX IF NOT EXISTS vehicle_diagnostic_scans_success_idx
  ON public.vehicle_diagnostic_scans
     (vehicle_id, coalesce(measured_at, completed_at, created_at) DESC)
  WHERE status IN ('RESULT', 'NO_DTC');

-- ── 3. RLS — OKUMA sahibe/eşleşene, YAZMA yalnız sunucuya ───────────
ALTER TABLE public.vehicle_diagnostic_scans ENABLE ROW LEVEL SECURITY;

-- Okuma: aracın sahibi veya eşleşmiş kullanıcı. Kanonik kapılar kullanılır
-- (`is_vehicle_owner` · `is_paired`) — yeni yetki mantığı KURULMAZ.
DROP POLICY IF EXISTS "diag_scans: owner reads" ON public.vehicle_diagnostic_scans;
CREATE POLICY "diag_scans: owner reads"
  ON public.vehicle_diagnostic_scans
  FOR SELECT
  TO authenticated
  USING (public.is_vehicle_owner(vehicle_id)
         OR public.is_paired(auth.uid(), vehicle_id));

-- INSERT/UPDATE/DELETE için policy BİLİNÇLİ OLARAK YOKTUR.
-- Teşhis gerçeği KULLANICI TARAFINDAN YAZILAMAZ/DEĞİŞTİRİLEMEZ; yalnız
-- `service_role` (RLS baypas) yazar. `vehicle_events`i diskalifiye eden
-- kusur tam olarak buydu.
REVOKE ALL ON public.vehicle_diagnostic_scans FROM anon;
GRANT  SELECT ON public.vehicle_diagnostic_scans TO authenticated;

-- ── 4. DOĞRULAMA ────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_rls   boolean;
  v_write int;
  v_anon  boolean;
BEGIN
  SELECT relrowsecurity INTO v_rls
  FROM pg_class WHERE oid = 'public.vehicle_diagnostic_scans'::regclass;
  IF NOT coalesce(v_rls, false) THEN
    RAISE EXCEPTION '080 DÜŞTÜ: RLS kapalı';
  END IF;

  -- Tarayıcıya YAZMA policy'si SIZMAMALI.
  SELECT count(*) INTO v_write
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'vehicle_diagnostic_scans'
    AND cmd <> 'SELECT';
  IF v_write <> 0 THEN
    RAISE EXCEPTION '080 DÜŞTÜ: yazma policy''si VAR (tarayıcı teşhis uydurabilir), adet=%', v_write;
  END IF;

  SELECT bool_or(has_table_privilege('anon', 'public.vehicle_diagnostic_scans', p))
    INTO v_anon
  FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p;
  IF coalesce(v_anon, false) THEN
    RAISE EXCEPTION '080 DÜŞTÜ: anon ayrıcalığı VAR (fail-closed ihlali)';
  END IF;

  IF has_table_privilege('authenticated', 'public.vehicle_diagnostic_scans', 'INSERT')
     OR has_table_privilege('authenticated', 'public.vehicle_diagnostic_scans', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.vehicle_diagnostic_scans', 'DELETE') THEN
    RAISE EXCEPTION '080 DÜŞTÜ: authenticated rolü teşhis geçmişini DEĞİŞTİREBİLİYOR';
  END IF;

  RAISE NOTICE '080 OK: teşhis geçmişi kuruldu — okuma sahibe, yazma yalnız sunucuya';
END $verify$;
