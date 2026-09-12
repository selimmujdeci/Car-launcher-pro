-- ═══════════════════════════════════════════════════════════════════════════
-- 045 — KONUM ARALIK MUHAFIZI (SUNUCU TARAFI)
--
-- YALNIZ İLERİ MIGRATION. 033–044 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── ONARILAN GERÇEK KUSUR (ölçüldü) ──────────────────────────────────────
-- `push_vehicle_event` koordinat ARALIĞINI DOĞRULAMIYORDU. Gerçek PostgreSQL
-- testi (`L8`) `lat = 999` gönderdi ve **veritabanına yazıldı**.
--
-- İstemci sözleşmesi (`telemetryContract` / `locationProvider`) bunu reddeder,
-- ama sunucu istemciye GÜVENEMEZ: bozuk bir head unit, eski bir APK veya
-- doğrudan RPC çağrısı (api_key ile) geçersiz koordinat yazabilir. Bir kez
-- yazıldığında Fleet haritası Gine Körfezi'nde/uzayda araç gösterir ve
-- "son bilinen konum" kalıcı olarak yanlış olur.
--
-- Bu, zero-trust telemetri ilkesinin doğrudan gereği: **istemci doğrulaması
-- sunucu doğrulamasının YERİNE GEÇMEZ.**
--
-- ── EK: `vehicle_locations.observed_at` indeksi ──────────────────────────
-- 042 `observed_at` kolonunu ekledi ve indeksi YALNIZ `vehicle_telemetry`'ye
-- kurdu. Konum geçmişi bu kolona göre sıralanacağı için `vehicle_locations`
-- tarafına da indeks gerekir.
--
-- ── DAVRANIŞ ─────────────────────────────────────────────────────────────
-- Geçersiz koordinat **SESSİZCE ATILIR** (istisna fırlatılmaz): telemetri
-- gönderimi at-least-once kuyruktan gelir; istisna kuyruğu poison'a düşürür
-- ve DİĞER geçerli alanların (rpm/temp/yakıt) da kaybına yol açar. Doğru
-- davranış: konumu YOK SAY, geri kalanı yaz — mevcut "bilinmeyen alan
-- yazılmaz" sözleşmesiyle birebir aynı.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Konum geçmişi indeksi ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS vehicle_locations_observed_at_idx
  ON public.vehicle_locations (vehicle_id, observed_at DESC);

-- ── 2a. MEVCUT BOZUK VERİYİ TEMİZLE (kısıt eklenebilsin) ────────────────
--
-- ⚠️ Kısıt eklemeden ÖNCE zorunlu: PostgreSQL, hâlihazırda ihlal eden satır
-- varsa `ALTER TABLE ... ADD CONSTRAINT`'i REDDEDER. Yerel doğrulamada tam
-- bu oldu (`lat = 999` içeren satır kısıtı engelledi) — üretimde de kaçınılmaz,
-- çünkü kusur zaten aylardır geçersiz koordinat yazıyordu.
--
-- Bozuk koordinat SİLİNMEZ, `NULL`'a çekilir: satırın diğer alanları
-- (rpm/temp/yakıt/sağlık) GEÇERLİ veridir ve kaybedilmemelidir. Koordinat
-- ise gerçek bir konum DEĞİLDİ — `NULL` = "bilinmiyor" doğru gösterimdir.
-- `(0,0)` Null Island da temizlenir: fix yokken bildirilen sahte konumdur.
UPDATE public.vehicle_telemetry
   SET lat = NULL, lng = NULL
 WHERE (lat IS NOT NULL AND (lat < -90  OR lat > 90))
    OR (lng IS NOT NULL AND (lng < -180 OR lng > 180))
    OR (lat = 0 AND lng = 0);

-- `vehicle_locations` geçmişinde geçersiz satırın konumu anlamsızdır ve
-- kolonlar NOT NULL olabilir → satır SİLİNİR (geçmiş kaydın tek içeriği
-- konumdur; yanlış konumu saklamak "son bilinen konum"u kalıcı yalan yapar).
DELETE FROM public.vehicle_locations
 WHERE (lat IS NOT NULL AND (lat < -90  OR lat > 90))
    OR (lng IS NOT NULL AND (lng < -180 OR lng > 180))
    OR (lat = 0 AND lng = 0);

-- ── 2. TABLO SEVİYESİ SON KAPI (fail-closed) ────────────────────────────
-- RPC atlanırsa (doğrudan yazma, gelecek bir kod yolu) yine de geçersiz
-- koordinat GİREMEZ. NULL izinlidir — "bilinmiyor" meşrudur.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='vehicle_telemetry_coords_range'
  ) THEN
    ALTER TABLE public.vehicle_telemetry
      ADD CONSTRAINT vehicle_telemetry_coords_range CHECK (
        (lat IS NULL OR (lat >= -90  AND lat <= 90)) AND
        (lng IS NULL OR (lng >= -180 AND lng <= 180))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='vehicle_locations_coords_range'
  ) THEN
    ALTER TABLE public.vehicle_locations
      ADD CONSTRAINT vehicle_locations_coords_range CHECK (
        (lat IS NULL OR (lat >= -90  AND lat <= 90)) AND
        (lng IS NULL OR (lng >= -180 AND lng <= 180))
      );
  END IF;
END $$;

-- ── 3. Aralık yardımcısı (saf, IMMUTABLE) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.location_in_range(p_lat double precision, p_lng double precision)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT p_lat IS NOT NULL AND p_lng IS NOT NULL
     AND p_lat >= -90  AND p_lat <= 90
     AND p_lng >= -180 AND p_lng <= 180
     -- (0,0) "Null Island": GPS modülleri fix yokken bunu bildirir; gerçek
     -- konum olarak KABUL EDİLMEZ (Gine Körfezi'nde hayalet araç yasağı).
     AND NOT (p_lat = 0 AND p_lng = 0);
$fn$;

REVOKE ALL ON FUNCTION public.location_in_range(double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.location_in_range(double precision, double precision)
  TO anon, authenticated, service_role;

-- ── 3b. RPC'yi kapıya BAĞLA (yoksa CHECK kısıtı payload'ı düşürür) ──────
--
-- ⚠️ KRİTİK: yalnız CHECK kısıtı eklemek YETMEZ — o durumda geçersiz
-- koordinatlı bir payload `check_violation` fırlatır ve **tüm telemetri
-- yazımı geri alınır** (rpm/temp/yakıt da kaybolur, at-least-once kuyruk
-- poison'a düşer). Doğru davranış: koordinatı ayrıştırma anında YOK SAY,
-- geri kalan alanları normal yaz. Bu, mevcut "bilinmeyen alan yazılmaz"
-- sözleşmesiyle birebir aynıdır.
--
-- Fonksiyon gövdesi 042/043'ten OLDUĞU GİBİ alınır ve YALNIZ iki satır
-- (`v_lat`/`v_lng` ayrıştırması) aralık kapısından geçirilir. Bu yüzden
-- burada tam yeniden tanım yerine hedefli bir metin yaması uygulanır —
-- böylece 042'nin doğrulanmış davranışı yeniden yazılmaz.
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='push_vehicle_event' LIMIT 1;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '045 HATA: push_vehicle_event bulunamadi';
  END IF;

  v_old := 'v_lat := NULLIF(v_payload->>''lat'', '''')::double precision;';
  v_new := 'v_lat := NULLIF(v_payload->>''lat'', '''')::double precision;'
        || E'\n  v_lng := NULLIF(v_payload->>''lng'', '''')::double precision;'
        -- ARALIK KAPISI: gecersiz koordinat SESSIZCE atilir (istisna YOK).
        || E'\n  IF NOT public.location_in_range(v_lat, v_lng) THEN'
        || E'\n    v_lat := NULL; v_lng := NULL;'
        || E'\n  END IF;';

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION '045 HATA: beklenen lat ayristirma satiri bulunamadi (govde degismis)';
  END IF;

  /* Eski `v_lng := ...` satırı yamada zaten yer aldığı için kaldırılır. */
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(
    v_def,
    E'  END IF;\n  v_lng := NULLIF(v_payload->>''lng'', '''')::double precision;',
    E'  END IF;');

  EXECUTE v_def;
END $patch$;

-- Yama sonrası izinler yeniden kurulur (CREATE OR REPLACE izinleri korur,
-- ama açıkça yazmak fail-closed disiplinidir).
REVOKE ALL ON FUNCTION public.push_vehicle_event(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_vehicle_event(text, text, jsonb)
  TO anon, authenticated, service_role;

-- ── 4. DOĞRULAMA (fail-closed) ──────────────────────────────────────────
DO $$
BEGIN
  -- (a) Kısıtlar var mı?
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_telemetry_coords_range') THEN
    RAISE EXCEPTION '045 HATA: vehicle_telemetry koordinat kisiti yok';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_locations_coords_range') THEN
    RAISE EXCEPTION '045 HATA: vehicle_locations koordinat kisiti yok';
  END IF;

  -- (b) İndeks var mı?
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND tablename='vehicle_locations' AND indexdef LIKE '%observed_at%'
  ) THEN
    RAISE EXCEPTION '045 HATA: vehicle_locations observed_at indeksi yok';
  END IF;

  -- (c) Aralık fonksiyonu DOĞRU karar veriyor mu (davranışsal kontrol)?
  IF public.location_in_range(999, 28.9) THEN
    RAISE EXCEPTION '045 HATA: aralik disi enlem kabul ediliyor';
  END IF;
  IF public.location_in_range(41.0, 181) THEN
    RAISE EXCEPTION '045 HATA: aralik disi boylam kabul ediliyor';
  END IF;
  IF public.location_in_range(0, 0) THEN
    RAISE EXCEPTION '045 HATA: Null Island (0,0) gercek konum sayiliyor';
  END IF;
  IF NOT public.location_in_range(41.015, 28.979) THEN
    RAISE EXCEPTION '045 HATA: gecerli koordinat reddediliyor';
  END IF;
  IF public.location_in_range(NULL, 28.9) THEN
    RAISE EXCEPTION '045 HATA: NULL koordinat gecerli sayiliyor';
  END IF;

  -- (d) RPC GERÇEKTEN kapıya bağlandı mı?
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='push_vehicle_event' LIMIT 1)
     NOT LIKE '%location_in_range%' THEN
    RAISE EXCEPTION '045 HATA: push_vehicle_event aralik kapisina baglanmadi';
  END IF;

  RAISE NOTICE '045 OK: koordinat aralik muhafizi + Null Island kapisi + konum indeksi + RPC bagli.';
END $$;

COMMIT;
