-- ═══════════════════════════════════════════════════════════════════════════
-- 067  SAKLAMA POLİTİKASI — TEK OTORİTE  (V-16/3)
--
-- ── BULGU ─────────────────────────────────────────────────────────────────
-- Enterprise sayfası "Araç Geçmişi — 90 günlük rota ve sürüş geçmişi" vaat
-- ediyordu. Ölçüm (prod, 2026-08-22):
--   · `vehicle_locations`  → 7 gün sonra siliniyordu   (vaat 90)
--   · `telemetry_events`   → 30 gün
--   · `vehicle_trips`      → **HİÇ SİLİNMİYORDU** — yani "sürüş geçmişi" için
--     bir politika YOKTU ve tablo SONSUZ BÜYÜYORDU. Ne vaat tutuluyordu ne de
--     büyüme sınırlıydı.
-- Ayrıca süreler fonksiyon gövdesine GÖMÜLÜYDÜ: hangi verinin ne kadar
-- tutulduğunu görmenin tek yolu kaynak kodu okumaktı.
--
-- ── ÖLÇÜLEN MALİYET (prod, 1 araç · 4 gün) ────────────────────────────────
--   1.905 konum satırı · 1.080 kB  →  araç başına ≈ 476 satır/gün ≈ 0,27 MB/gün
-- Buradan:
--   ham konum 30 gün → araç başına ≈  8 MB   (100 araç ≈ 0,8 GB)
--   ham konum 90 gün → araç başına ≈ 24 MB   (100 araç ≈ 2,4 GB)
-- `vehicle_trips` ise yolculuk başına ≈ 4 kB — 90 gün İHMAL EDİLEBİLİR.
--
-- ── KARAR: KADEMELİ SAKLAMA (dürüst, ölçüye dayalı) ───────────────────────
--   · `vehicle_trips`     → **90 gün**  (vaadin "sürüş geçmişi" kısmı; ucuz)
--   · `vehicle_locations` → **30 gün**  (7'den yükseltildi; 90 gün ham nokta
--     100 araçta 2,4 GB'a çıkar — bu bir ÜRÜN/MALİYET kararıdır, sessizce
--     verilmez. Tabloyu değiştirmek yeterlidir, kod değişmez.)
--   · `telemetry_events`  → **90 gün**  (bugün 0 satır; ucuz)
--   · `vehicle_commands` / `command_logs` → 14 gün (DEĞİŞMEDİ)
--
-- **AÇIKÇA SÖYLENİR:** 90 günlük *ham rota noktası* BU SÜRÜMDE SUNULMAZ.
-- 90 gün geriye giden şey YOLCULUK ÖZETLERİDİR.
--
-- ── SİLME GÜVENLİ Mİ? ÖLÇÜLDÜ ─────────────────────────────────────────────
-- `vehicle_trips` üzerindeki DÖRT tetikleyicinin (`trg_driver_dna` ·
-- `trg_evidence_from_trip` · `trg_reasoning_trip` · `trg_trip_attribution`)
-- HEPSİ `AFTER INSERT OR UPDATE`tir; **hiçbiri DELETE'te tetiklenmez**.
-- Dolayısıyla eski yolculukların silinmesi Driver DNA'yı GERİ ALMAZ.
-- Bu doğrulanmadan saklama eklenseydi, DNA sessizce erirdi.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Politika tablosu — TEK OTORİTE ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.retention_policy (
  table_name  text PRIMARY KEY,
  retain_days integer NOT NULL CHECK (retain_days >= 1 AND retain_days <= 3650),
  rationale   text    NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.retention_policy IS
  'Saklama sürelerinin TEK OTORİTESİ. Süreler fonksiyon gövdesine gömülmez; '
  'buradan okunur ki hangi verinin ne kadar tutulduğu KOD OKUMADAN görülebilsin.';

-- ── Erişim: YALNIZ service_role ──────────────────────────────────────────
-- Fail-closed: RLS AÇIK ve POLICY YOK → `anon` da `authenticated` de HİÇBİR
-- satır göremez. Saklama süresi bir sistem yapılandırmasıdır; kiracıya ait
-- değildir. Gerekirse ileride SECURITY DEFINER bir RPC ile okutulur.
-- (Bu, `063_rls_exposure_matrix.sql` kapılarından geçer.)
REVOKE ALL ON TABLE public.retention_policy FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.retention_policy TO service_role;
ALTER TABLE public.retention_policy ENABLE ROW LEVEL SECURITY;

-- ── Ölçülmüş varsayılanlar ───────────────────────────────────────────────
INSERT INTO public.retention_policy (table_name, retain_days, rationale) VALUES
  ('vehicle_trips', 90,
   'Enterprise vaadi: 90 gunluk surus gecmisi. Yolculuk basina ~4 kB; ihmal edilebilir. '
   'DELETE tetikleyicisi YOK -> Driver DNA geri alinmaz (olculdu).'),
  ('vehicle_locations', 30,
   'Ham rota noktalari. Olculen maliyet: arac basina ~0,27 MB/gun. 30 gun ~8 MB/arac. '
   '90 gune cikarmak 100 aracta ~2,4 GB eder -> URUN/MALIYET karari, sessizce verilmez.'),
  ('telemetry_events', 90,
   'Olay gecmisi rapor penceresini besler; bugun 0 satir, maliyeti dusuk.'),
  ('vehicle_commands', 14,
   'Yalnizca TERMINAL durumdakiler silinir; pending/accepted/executing DOKUNULMAZ.'),
  ('command_logs', 14,
   'Komut gunlukleri teshis icindir; 14 gun sonrasi deger uretmez.')
ON CONFLICT (table_name) DO NOTHING;

-- ── Politikayı okuyan yardımcı ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._retention_days(p_table text, p_default integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  /* Kayıt yoksa ÇAĞIRANIN varsayılanı kullanılır — politika satırı silinse
     bile temizlik SONSUZ saklamaya düşmez (fail-safe). */
  SELECT COALESCE((SELECT retain_days FROM public.retention_policy WHERE table_name = p_table), p_default);
$$;

-- ── Var olmayan tabloyu SESSİZCE değil, GÖRÜNÜR şekilde atla ────────────
-- NEDEN: bu depoda İKİ migration zinciri var (prod'un tabanı website zinciri).
-- `telemetry_events`, `command_logs`, `notifications`, `route_commands` prod'da
-- VAR ama yerel şemada YOK. Tek bir `DELETE` bile fonksiyonun TAMAMINI
-- düşürür ve o günün temizliği HİÇ koşmaz.
-- Ama atlama SESSİZ OLMAZ: atlanan tablolar dönüşteki `skipped_missing`
-- listesinde raporlanır — yoksa "temizlik çalışıyor" sanılırken bir tablo
-- yıllarca büyüyebilirdi.
CREATE OR REPLACE FUNCTION public._retention_delete(
  p_table text, p_days integer, p_where text, p_cols text[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE n integer; c text;
BEGIN
  IF to_regclass('public.' || quote_ident(p_table)) IS NULL THEN
    RETURN -1;                       -- tablo YOK
  END IF;

  /* KOLON da doğrulanır ve TABLO EKSİKLİĞİNDEN AYRI raporlanır.
     Neden ayrı: eksik tablo bir dağıtım farkıdır (iki zincir), eksik kolon ise
     ŞEMA KAYMASIDIR — ya da basitçe bir YAZIM HATASI. İkisini aynı sepete
     koymak, yanlış yazılmış bir kolon adını sonsuza dek sessiz bırakırdı. */
  FOREACH c IN ARRAY p_cols LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = p_table
                      AND column_name = c) THEN
      RETURN -2;                     -- kolon YOK
    END IF;
  END LOOP;

  EXECUTE format('DELETE FROM public.%I WHERE %s', p_table,
                 replace(p_where, '$DAYS$', p_days::text));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

REVOKE ALL ON FUNCTION public._retention_delete(text, integer, text, text[]) FROM anon, authenticated, PUBLIC;

-- ── Temizlik: artık politikayı OKUR ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_old_telemetry()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d_loc integer; d_evt integer; d_cmd integer; d_log integer; d_trip integer; d_code integer;
  k_loc integer; k_evt integer; k_cmd integer; k_log integer; k_trip integer;
  missing text[] := ARRAY[]::text[];
  drift   text[] := ARRAY[]::text[];
BEGIN
  k_loc  := public._retention_days('vehicle_locations',  30);
  k_evt  := public._retention_days('telemetry_events',   90);
  k_cmd  := public._retention_days('vehicle_commands',   14);
  k_log  := public._retention_days('command_logs',       14);
  k_trip := public._retention_days('vehicle_trips',      90);

  d_loc := public._retention_delete(
    'vehicle_locations', k_loc, 'created_at < now() - make_interval(days => $DAYS$)',
    ARRAY['created_at']);

  d_evt := public._retention_delete(
    'telemetry_events', k_evt, 'created_at < now() - make_interval(days => $DAYS$)',
    ARRAY['created_at']);

  /* Komutlarda YALNIZ terminal durumlar silinir: pending/accepted/executing bir
     komut hâlâ yürütülüyor olabilir — silmek aracı sahipsiz bırakırdı. */
  d_cmd := public._retention_delete(
    'vehicle_commands', k_cmd,
    'status IN (''completed'',''failed'',''expired'',''rejected'') '
    'AND updated_at < now() - make_interval(days => $DAYS$)',
    ARRAY['status', 'updated_at']);

  d_log := public._retention_delete(
    'command_logs', k_log, 'created_at < now() - make_interval(days => $DAYS$)',
    ARRAY['created_at']);

  /* YENİ: yolculuk özetleri. Önceden HİÇ silinmiyordu (sonsuz büyüme).
     BİTMEMİŞ yolculuk (ended_at IS NULL) DOKUNULMAZ — süren bir yolculuğu
     yaşına bakıp silmek, aracın o anki seyahatini kaydırırdı. */
  d_trip := public._retention_delete(
    'vehicle_trips', k_trip,
    'ended_at IS NOT NULL AND ended_at < now() - make_interval(days => $DAYS$)',
    ARRAY['ended_at']);

  d_code := public._retention_delete('vehicle_linking_codes', 0, 'expires_at < now()',
    ARRAY['expires_at']);

  IF d_loc  = -1 THEN missing := array_append(missing, 'vehicle_locations');
  ELSIF d_loc  = -2 THEN drift := array_append(drift, 'vehicle_locations'); END IF;
  IF d_evt  = -1 THEN missing := array_append(missing, 'telemetry_events');
  ELSIF d_evt  = -2 THEN drift := array_append(drift, 'telemetry_events'); END IF;
  IF d_cmd  = -1 THEN missing := array_append(missing, 'vehicle_commands');
  ELSIF d_cmd  = -2 THEN drift := array_append(drift, 'vehicle_commands'); END IF;
  IF d_log  = -1 THEN missing := array_append(missing, 'command_logs');
  ELSIF d_log  = -2 THEN drift := array_append(drift, 'command_logs'); END IF;
  IF d_trip = -1 THEN missing := array_append(missing, 'vehicle_trips');
  ELSIF d_trip = -2 THEN drift := array_append(drift, 'vehicle_trips'); END IF;
  IF d_code = -1 THEN missing := array_append(missing, 'vehicle_linking_codes');
  ELSIF d_code = -2 THEN drift := array_append(drift, 'vehicle_linking_codes'); END IF;

  d_loc  := GREATEST(d_loc, 0);  d_evt  := GREATEST(d_evt, 0);
  d_cmd  := GREATEST(d_cmd, 0);  d_log  := GREATEST(d_log, 0);
  d_trip := GREATEST(d_trip, 0); d_code := GREATEST(d_code, 0);

  RETURN jsonb_build_object(
    'locations', d_loc, 'events', d_evt, 'commands', d_cmd,
    'logs', d_log, 'trips', d_trip, 'linking_codes', d_code,
    /* Atlanan tablo SESSİZ KALMAZ: burada görünür. */
    'skipped_missing', to_jsonb(missing),
    /* Kolon uyuşmazlığı AYRI: bu bir şema kayması ya da yazım hatasıdır. */
    'skipped_schema_mismatch', to_jsonb(drift),
    'policy', jsonb_build_object(
      'vehicle_locations', k_loc, 'telemetry_events', k_evt,
      'vehicle_commands', k_cmd, 'command_logs', k_log, 'vehicle_trips', k_trip)
  );
END
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_telemetry() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_telemetry() TO service_role;
REVOKE ALL ON FUNCTION public._retention_days(text, integer) FROM anon, authenticated, PUBLIC;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed) — GRANT ve RLS gerçekten sorulur.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'retention_policy' AND c.relrowsecurity;
  IF n <> 1 THEN RAISE EXCEPTION '067 DOGRULAMA: retention_policy uzerinde RLS KAPALI'; END IF;

  IF has_table_privilege('anon', 'public.retention_policy', 'SELECT')
     OR has_table_privilege('authenticated', 'public.retention_policy', 'SELECT') THEN
    RAISE EXCEPTION '067 DOGRULAMA: retention_policy anon/authenticated tarafindan OKUNABILIYOR';
  END IF;

  SELECT count(*) INTO n FROM public.retention_policy;
  IF n < 5 THEN RAISE EXCEPTION '067 DOGRULAMA: politika satirlari eksik (%)', n; END IF;

  RAISE NOTICE '067 DOGRULAMA GECTI: saklama politikasi kuruldu (% satir)', n;
END
$verify$;
