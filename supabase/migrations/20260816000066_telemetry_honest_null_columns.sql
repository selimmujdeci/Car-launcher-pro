-- ════════════════════════════════════════════════════════════════════
-- 066 — vehicle_telemetry: DÜRÜST NULL kolonları (042'nin yarım kalan ucu)
-- ════════════════════════════════════════════════════════════════════
--
-- ÖLÇÜLEN KUSUR (2026-08-16, gerçek cihaz — Xiaomi 23090RA98I, CarOS Pro APK
-- 16.08 09:24 derlemesi, CDP ağ yakalaması):
--
--   POST /rest/v1/rpc/push_vehicle_event  → HTTP 400, İSTİSNASIZ HER OLAYDA
--   {"code":"23502",
--    "message":"null value in column \"fuel\" of relation \"vehicle_telemetry\"
--               violates not-null constraint"}
--
--   40 saniyede 9 başarısız çağrı ölçüldü (`heartbeat` ve `location_delta`
--   tiplerinin İKİSİ de). Araç bulut tarafında HİÇ görünmüyor.
--
-- KÖK NEDEN — 042 yarım uygulanmış:
--   Migration 042 ("DÜRÜST YAZMA") `push_vehicle_event` gövdesinden
--   `coalesce(...,0)` sarmalını KALDIRDI; bilinmeyen sinyal artık doğru
--   biçimde NULL yazıyor:
--
--     NULLIF(v_payload->>'fuel', '')::double precision,
--     NULLIF(v_payload->>'temp', '')::double precision,
--     NULLIF(v_payload->>'rpm',  '')::double precision,
--
--   AMA tablo kolonları prod baseline'dan beri `NOT NULL` kaldı:
--
--     "speed" real    DEFAULT 0 NOT NULL,
--     "fuel"  real    DEFAULT 0 NOT NULL,
--     "rpm"   integer DEFAULT 0 NOT NULL,
--     "temp"  real    DEFAULT 0 NOT NULL,
--
--   065'e kadar HİÇBİR migration bu kısıtlara dokunmadı (tarandı, 0 eşleşme).
--   Yani 042 sahte 0'ı kaldırırken INSERT yolunu KAPATTI.
--
-- NEDEN KALICI VE KENDİ KENDİNE ONARILMIYOR:
--   RPC `INSERT ... ON CONFLICT (vehicle_id) DO UPDATE` kullanıyor. UPDATE
--   dalı `COALESCE(EXCLUDED.fuel, t.fuel)` ile korunaklı — ama oraya
--   ULAŞMAK için tabloda o araca ait bir satır ZATEN olmalı. Satır yoksa
--   INSERT dalı çalışır ve NOT NULL'a takılır. Sonuç: OBD dongle'ı
--   takılı olmayan (yakıt/devir/sıcaklık bilinmeyen) bir araç ilk
--   telemetri satırını ASLA oluşturamaz → her sonraki olay da INSERT
--   dalına düşer → kalıcı 400 döngüsü. `is_online` hiç `true` olmaz,
--   filo ekranında araç SONSUZA DEK ÇEVRİMDIŞI görünür.
--
-- DÜZELTME: kolonları nullable yap ve sahte varsayılanı kaldır.
--   `DROP DEFAULT` şart — DEFAULT 0 kalırsa kolonu atlayan (RPC dışı) her
--   yazıcı yine "ölçülmüş 0" yalanını üretir; bu, projenin
--   "kanıtsız bilgi üretilmez, bilinmeyen UNKNOWN'dur" kuralının ihlali.
--   NULL = "ölçülmedi". 0 = "ölçüldü ve sıfır". İkisi AYNI ŞEY DEĞİLDİR.
--
-- MEVCUT VERİ: dokunulmaz. Geçmişte 0 yazılmış satırlar 0 kalır — geriye
--   dönük "aslında bilinmiyordu" ÇIKARIMI YAPILAMAZ (uydurma olurdu).
--   Ayrım yalnız bu migration'dan SONRAKİ satırlar için geçerlidir.
--
-- GERİ ALINABİLİRLİK: NULL üreten satırlar oluştuktan sonra `SET NOT NULL`
--   geri konamaz. Bu bilinçlidir — 042'nin dürüstlük sözleşmesi kalıcıdır.
-- ════════════════════════════════════════════════════════════════════

-- ── 0. ÖN KOŞUL: 042 uygulanmış olmalı (dürüst gövde yoksa bu migration
--    anlamsızdır — sahte 0 yazan gövdeyle nullable kolon kusuru gizler).
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'push_vehicle_event'
  LIMIT 1;

  IF v_src IS NULL THEN
    RAISE EXCEPTION '066 DURDU: push_vehicle_event YOK (042 uygulanmamış)';
  END IF;

  IF v_src NOT LIKE '%NULLIF(v_payload->>''fuel''%' THEN
    RAISE EXCEPTION
      '066 DURDU: push_vehicle_event gövdesi 042 sonrası dürüst yazma biçiminde değil';
  END IF;
END $$;

-- ── 1. NOT NULL kaldır + sahte DEFAULT 0'ı düşür ─────────────────────
-- İDEMPOTENT: zaten nullable/defaultsuz kolonda no-op'tur.
ALTER TABLE public.vehicle_telemetry ALTER COLUMN speed DROP NOT NULL;
ALTER TABLE public.vehicle_telemetry ALTER COLUMN speed DROP DEFAULT;
ALTER TABLE public.vehicle_telemetry ALTER COLUMN fuel  DROP NOT NULL;
ALTER TABLE public.vehicle_telemetry ALTER COLUMN fuel  DROP DEFAULT;
ALTER TABLE public.vehicle_telemetry ALTER COLUMN rpm   DROP NOT NULL;
ALTER TABLE public.vehicle_telemetry ALTER COLUMN rpm   DROP DEFAULT;
ALTER TABLE public.vehicle_telemetry ALTER COLUMN temp  DROP NOT NULL;
ALTER TABLE public.vehicle_telemetry ALTER COLUMN temp  DROP DEFAULT;

-- ── 2. DOĞRULAMA — dört kolon da nullable ve defaultsuz olmalı ───────
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(column_name || '(' ||
           CASE WHEN is_nullable = 'NO' THEN 'NOT NULL ' ELSE '' END ||
           CASE WHEN column_default IS NOT NULL THEN 'DEFAULT ' || column_default ELSE '' END ||
         ')', ', ')
    INTO v_bad
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'vehicle_telemetry'
    AND column_name IN ('speed','fuel','rpm','temp')
    AND (is_nullable = 'NO' OR column_default IS NOT NULL);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '066 DOĞRULAMA DÜŞTÜ: hâlâ kısıtlı kolonlar → %', v_bad;
  END IF;
END $$;

-- ── 3. DOĞRULAMA — 042 sonrası ayrıcalıklar korunmuş olmalı ─────────
-- (ALTER COLUMN GRANT'leri değiştirmez; yine de sessiz sapmaya karşı ölç.)
--
-- ⚠️ `information_schema.role_table_grants` KULLANILMAZ: o görünüm yalnız
--    "grantor veya grantee ŞU AN etkin bir rol olan" satırları gösterir.
--    Ölçüldü (2026-08-16, prod salt-okunur oturum `supabase_read_only_user`):
--    ayrıcalık relacl'de MEVCUTken görünüm 0 satır döndürdü. Yani bu kapı
--    çalışan role göre YANLIŞ DÜŞER. `has_table_privilege` katalogdan
--    okur ve rolden bağımsızdır — otorite budur.
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(x.role_needed, ', ')
    INTO v_missing
  FROM (VALUES ('service_role')) AS x(role_needed)
  WHERE NOT has_table_privilege(x.role_needed, 'public.vehicle_telemetry', 'INSERT');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '066 DOĞRULAMA DÜŞTÜ: vehicle_telemetry INSERT ayrıcalığı yok → %', v_missing;
  END IF;
END $$;
