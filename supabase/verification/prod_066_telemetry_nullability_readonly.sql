-- ═══════════════════════════════════════════════════════════════════════════
-- V-02 — 066'NIN PROD'DA UYGULANIP UYGULANMADIĞININ SALT-OKUMA DOĞRULAMASI
--
-- ⚠️ BU SCRIPT HİÇBİR ŞEY YAZMAZ. Ne DDL, ne DML, ne GRANT. Yalnız katalog
--    okur ve bir HÜKÜM basar. Production'da güvenle koşturulabilir.
--
-- NEDEN GEREKLİ (kütük V-02, denetim 2026-08-21):
--   `20260816000066_telemetry_honest_null_columns.sql` depoda YAZILI, ama
--   prod'a uygulandığı DEPODAN DOĞRULANAMAZ. Migration dosyasının varlığı
--   uygulandığının kanıtı DEĞİLDİR (bu depoda daha önce yaşandı: SQL PR
--   #32/#33/#34 yazıldı, uygulanmadı).
--
-- UYGULANMAMIŞSA NE OLUR (042'nin ölçülmüş sonucu, Xiaomi 23090RA98I, CDP izi):
--   POST /rest/v1/rpc/push_vehicle_event → HTTP 400, İSTİSNASIZ HER OLAYDA
--   {"code":"23502","message":"null value in column \"fuel\" ... violates
--    not-null constraint"} — 40 saniyede 9 başarısız çağrı ölçüldü.
--   RPC `INSERT ... ON CONFLICT DO UPDATE` kullanır; UPDATE dalı korunaklıdır
--   ama oraya ULAŞMAK için satır ZATEN olmalı. Satırı olmayan (yani OBD
--   dongle'ı takılı olmayan) araç ilk satırını ASLA oluşturamaz → `is_online`
--   hiç `true` olmaz → filo ekranında SONSUZA DEK ÇEVRİMDIŞI görünür.
--
-- NASIL KOŞULUR (üç yoldan biri, hepsi salt-okuma):
--   A) Supabase Dashboard → SQL Editor → bu dosyanın içeriğini yapıştır → Run
--      (kimlik bilgisi gerekmez, tarayıcı oturumu yeter — EN KOLAY YOL)
--   B) psql "$PROD_DB_URL" -f supabase/verification/prod_066_telemetry_nullability_readonly.sql
--   C) supabase login && supabase link --project-ref vdpcdhrdmsacftrietzq
--      ardından (B)
--
-- HÜKÜM NASIL OKUNUR:
--   verdict = 'UYGULANMIŞ'      → 066 canlıda, V-02'nin (a) yarısı KAPANDI
--   verdict = 'UYGULANMAMIŞ'    → 066'yı uygula, sonra bu script'i TEKRAR koş
--   verdict = 'TABLO YOK'       → daha derin bir sapma var; şema denetimi gerekir
-- ═══════════════════════════════════════════════════════════════════════════

-- NOT: bu dosyada bilinçli olarak `\pset`/`\set` gibi psql meta-komutu YOKTUR —
-- Supabase Dashboard SQL Editor backslash komutlarını anlamaz ve script'i
-- reddederdi. Böylece aynı dosya hem psql'de hem tarayıcıda aynen çalışır.

-- ── 1. KOLON DURUMU — dört telemetri kolonunun nullability + default'u ─────
-- Beklenen (066 sonrası): is_nullable='YES' VE column_default IS NULL.
-- `DROP DEFAULT` de şarttır: DEFAULT 0 kalırsa kolonu atlayan her yazıcı yine
-- "ölçülmüş 0" yalanı üretir (kanıtsız bilgi üretilmez kuralının ihlali).
SELECT
  column_name                                            AS kolon,
  is_nullable                                            AS nullable,
  coalesce(column_default, '(yok)')                      AS varsayilan,
  CASE
    WHEN is_nullable = 'YES' AND column_default IS NULL THEN 'OK'
    WHEN is_nullable = 'NO'                             THEN 'HATA: NOT NULL'
    ELSE                                                     'HATA: DEFAULT var'
  END                                                    AS durum
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'vehicle_telemetry'
  AND column_name IN ('speed', 'fuel', 'rpm', 'temp')
ORDER BY column_name;

-- ── 2. RPC GÖVDESİ — 042 (dürüst yazma) uygulanmış mı ──────────────────────
-- 066 tek başına yetmez: gövde hâlâ coalesce(...,0) sarmalındaysa sahte 0
-- yazılmaya devam eder ve nullable kolonlar kusuru GİZLER.
-- Skaler alt sorgu KULLANILIR: fonksiyon hiç yoksa da TEK satır döner (v_src = NULL).
-- `FROM pg_proc ... LIMIT 1` biçimi fonksiyon yokken SIFIR satır döndürür ve
-- "YOK" hükmü hiç basılmazdı — sessiz boşluk, tam da kaçınmak istediğimiz şey.
SELECT
  CASE
    WHEN s.v_src IS NULL                              THEN 'YOK — push_vehicle_event tanımlı değil'
    WHEN s.v_src LIKE '%NULLIF(v_payload->>''fuel''%' THEN 'OK — 042 dürüst yazma gövdesi canlıda'
    ELSE                                                   'HATA — gövde 042 öncesi (sahte 0 yazıyor olabilir)'
  END AS rpc_govdesi
FROM (
  SELECT (
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'push_vehicle_event'
    LIMIT 1
  ) AS v_src
) s;

-- ── 3. AYRICALIK — service_role INSERT edebiliyor mu ───────────────────────
-- ⚠️ `information_schema.role_table_grants` KULLANILMAZ: o görünüm yalnız
--    "grantor veya grantee ŞU AN etkin bir rol olan" satırları gösterir ve
--    salt-okunur bir oturumda ayrıcalık relacl'de MEVCUTken 0 satır döndürdüğü
--    ÖLÇÜLDÜ (2026-08-16, `supabase_read_only_user`). Yani o kapı çalışan role
--    göre YANLIŞ DÜŞER. `has_table_privilege` katalogdan okur, rolden bağımsızdır.
-- `has_table_privilege`in OID AŞIRI YÜKLEMESİ kullanılır: metin aşırı yüklemesi
-- (`'public.vehicle_telemetry'`) tablo YOKSA HATA FIRLATIR ve script orada ölür.
-- `to_regclass` yoksa NULL döner, OID aşırı yüklemesi de NULL girdide NULL döner
-- → script ölmez, hüküm "BİLİNMİYOR" olur. Fail-soft gözlem, fail-closed hüküm.
SELECT
  CASE has_table_privilege('service_role', to_regclass('public.vehicle_telemetry'), 'INSERT')
    WHEN true  THEN 'OK — service_role INSERT edebiliyor'
    WHEN false THEN 'HATA — service_role INSERT ayrıcalığı YOK'
    ELSE            'BİLİNMİYOR — vehicle_telemetry tablosu bulunamadı'
  END AS ayricalik;

-- ── 4. TEK SATIRLIK HÜKÜM ──────────────────────────────────────────────────
-- ⚠️ Bu sorgu SADECE KATALOĞA bakar, `vehicle_telemetry`ye HİÇ DOKUNMAZ.
--    Neden: `CASE` dalları koşullu ÇALIŞTIRILSA da alt sorgular PLANLANIR;
--    aynı ifadeye `SELECT count(*) FROM public.vehicle_telemetry` konsaydı,
--    tablo yokken 'TABLO YOK' dalı BASILMADAN sorgu hata verirdi — yani
--    teşhis, teşhis edeceği arızada ölürdü. Satır sayıları AYRI adımda (5).
SELECT
  CASE
    WHEN to_regclass('public.vehicle_telemetry') IS NULL THEN 'TABLO YOK'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'vehicle_telemetry'
        AND column_name IN ('speed', 'fuel', 'rpm', 'temp')
        AND (is_nullable = 'NO' OR column_default IS NOT NULL)
    ) THEN 'UYGULANMAMIŞ'
    WHEN (
      SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'vehicle_telemetry'
        AND column_name IN ('speed', 'fuel', 'rpm', 'temp')
    ) < 4 THEN 'ŞEMA SAPMASI — dört kolonun hepsi yok'
    ELSE 'UYGULANMIŞ'
  END AS verdict;

-- ── 5. SATIR SAYAÇLARI (yalnız tablo VARSA anlamlı) ────────────────────────
-- Yukarıdaki hüküm 'TABLO YOK' ise bu adımı ATLA (hata verir, bu beklenendir).
SELECT
  count(*)                                    AS mevcut_satir,
  count(*) FILTER (WHERE fuel IS NULL)        AS fuel_null_satir,
  count(*) FILTER (WHERE rpm  IS NULL)        AS rpm_null_satir,
  count(*) FILTER (WHERE temp IS NULL)        AS temp_null_satir
FROM public.vehicle_telemetry;

-- ── NOT — `fuel_null_satir = 0` TEK BAŞINA KUSUR KANITI DEĞİLDİR ───────────
-- 066 uygulanmış olsa bile, o andan sonra dongle'sız bir araçtan olay gelmediyse
-- NULL satır oluşmaz. Yani bu sayaç "yazma yolu canlı mı" sorusunu YANITLAMAZ;
-- yalnız kolon kısıtı sorusunu yanıtlar. Yazma yolunun gerçekten açıldığı,
-- V-02'nin (b) yarısında GERÇEK CİHAZLA kanıtlanır:
--   dongle TAKILI DEĞİLKEN heartbeat → HTTP 200 → bu tabloda satır +1.
