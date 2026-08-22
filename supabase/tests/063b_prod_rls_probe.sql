-- ═══════════════════════════════════════════════════════════════════════════
-- 063b  PROD RLS PROBE — üretimde GERÇEK `anon` koşumu  (V-15)
--
--   npm run test:rls:prod
--
-- ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────────
-- 063 yerel PostgreSQL'e karşı koşar. YEREL YEŞİL, PROD YEŞİL DEMEK DEĞİLDİR:
-- kütükte kayıtlı ki fixture varsayılan ayrıcalıkları kurmuyordu ve yerelde
-- geçen bir kapı üretimde düşüyordu. Üretimin GRANT tablosu gerçekten farklı:
-- ölçümde prod'da 17 tabloda anon'a GRANT vardı, yerelde 12.
--
-- ── NEDEN `RAISE EXCEPTION` İLE BİTER ─────────────────────────────────────
-- İki nedenle:
--  1) `supabase db query` bir DO bloğunun NOTICE çıktısını göstermez; sonucu
--     dışarı taşımanın tek yolu hata mesajıdır. BAŞARI da `PROD_RLS_OK|...`
--     ile fırlatılır — mesajı OKU, çıkış kodu tek başına anlam taşımaz.
--  2) Fırlatma tüm işlemi GERİ ALIR: probe üretimde kalıcı hiçbir iz bırakamaz.
--
-- ── "SAHTE 0" TUZAĞI ──────────────────────────────────────────────────────
-- `anon` bir tabloda satır görmüyorsa bu KORUMA KANITI DEĞİLDİR — tablo boş da
-- olabilir. Bu yüzden önce satır VARLIĞI ölçülür; boş tablo `kanitlanamadi`
-- sayacına gider ve GEÇTİ SAYILMAZ.
--
-- ── SON KOŞUM (2026-08-22, Carospro / vdpcdhrdmsacftrietzq) ────────────────
--   PROD_RLS_OK | izinsiz maruziyet = 0 | kanitlanamadi = 9 (bos tablo)
--   Satiri olan ve KANITLANMIS sekilde kapali 8 tablo:
--     vehicles · vehicle_locations · vehicle_telemetry · vehicle_commands
--     vehicle_events · vehicle_pairings · vehicle_linking_codes · audit_logs
-- ═══════════════════════════════════════════════════════════════════════════

DO $probe$
DECLARE
  r record; seen boolean; ns boolean;
  allow text[] := ARRAY['feature_flags','runtime_policies','ota_releases'];
  exposed text := ''; unproven text := ''; nexp int := 0; nunp int := 0;
BEGIN
  FOR r IN SELECT c.relname AS t, c.oid
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
              AND has_table_privilege('anon', c.oid, 'SELECT')
            ORDER BY 1
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', r.t) INTO ns;
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', r.t) INTO seen;
    EXCEPTION WHEN insufficient_privilege THEN seen := false;
    END;
    RESET ROLE;

    IF seen AND NOT (r.t = ANY (allow)) THEN
      nexp := nexp + 1; exposed := exposed || r.t || ' ';
    ELSIF NOT ns THEN
      nunp := nunp + 1; unproven := unproven || r.t || ' ';
    END IF;
  END LOOP;

  IF nexp > 0 THEN
    RAISE EXCEPTION 'PROD RLS DUSTU -- anon izinsiz % tabloyu OKUYOR: %', nexp, exposed;
  END IF;
  RAISE EXCEPTION 'PROD_RLS_OK|kanitlanamadi=%|bos_tablolar=%', nunp, unproven;
END
$probe$;
