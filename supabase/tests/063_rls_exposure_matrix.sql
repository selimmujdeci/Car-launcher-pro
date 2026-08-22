-- ═══════════════════════════════════════════════════════════════════════════
-- 063  RLS MARUZİYET MATRİSİ — rol × tablo × işlem  (V-15)
--
--   MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres \
--     supabase_db_fleetval psql -U postgres -d postgres \
--     < supabase/tests/063_rls_exposure_matrix.sql
--
--   ya da:  npm run test:rls
--
-- ── NEDEN VAR ─────────────────────────────────────────────────────────────
-- Kütükte kayıtlı: migration 038 döneminde bir `member` KENDİNİ ADMIN
-- yapabiliyordu. Tek tek kapatıldı ama bu SINIFIN sistematik kapısı yoktu:
-- bir policy yanlışlıkla `USING (true)` ile gevşetilse hiçbir test DÜŞMEZDİ.
--
-- ── "SAHTE 0" TUZAĞI (bu dosyanın en önemli kararı) ────────────────────────
-- `anon` olarak `SELECT count(*)` çekip 0 görmek KORUNDUĞUNU KANITLAMAZ:
-- tablo BOŞ da olabilir. Ölçüm anında yerel veritabanında 47 tablonun 20 tanesi
-- boştu — naif bir matris "47/47 GEÇTİ" derdi ve bunun 20 tanesi YALAN olurdu.
-- Bu yüzden her tablo ÖNCE superuser olarak sayılır:
--    n_super = 0             → UNPROVEN  (kanıtlanamaz — GEÇTİ SAYILMAZ)
--    n_super > 0, n_role = 0 → DENIED    (kanıtlanmış koruma)
--    n_role  > 0             → EXPOSED   (izin listesinde değilse HATA)
--
-- ── OKUMA ÖLÇÜLÜR, YAZMA TÜRETİLİR ────────────────────────────────────────
-- SELECT gerçekten koşulur (OBSERVED). INSERT/UPDATE/DELETE için satır uydurup
-- tabloya yazmak yerine iki katman STATİK türetilir (DERIVED):
--    yazabilir  ⇔  GRANT var  ∧  o rolü kapsayan permissive policy var
-- RLS açık + o komut için policy YOK  ⇒  PostgreSQL her satırı reddeder.
-- Türetim "ölçüm" gibi sunulmaz; raporda AYRI bölümde gösterilir.
--
-- Ölçüm SALT-OKUNURDUR: dosya ROLLBACK ile biter, kalıcı değişiklik bırakmaz.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- İZİN LİSTESİ — kimliğe BAKMADAN okunabilmesine bilinçli izin verilen
-- tablolar, ROL BAZINDA. Buraya satır eklemek imza atmaktır: "bu tablonun
-- içeriği o rol için küresel olarak görülebilir".
-- Listede OLMAYAN bir tablo görünürse KAPI 1 / KAPI 4 düşer.
--
-- Bir satır eklemeden önce ŞU SORU cevaplanmalı: tabloda `company_id`,
-- `user_id`, `vehicle_id`, VIN, konum ya da başka kiracıya-özgü alan VAR MI?
-- Varsa `USING (true)` KİRACI SIZINTISIDIR ve listeye YAZILMAZ.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE read_allowlist (role_name text, t text, why text,
                                  PRIMARY KEY (role_name, t));
INSERT INTO read_allowlist VALUES
  ('anon', 'feature_flags',
   'Cihaz açılışta bayrakları okur — kimlik doğrulamasından ÖNCE.'),
  ('anon', 'runtime_policies',
   'Cihaz çalışma zamanı politikalarını açılışta okur.'),
  ('anon', 'ota_releases',
   'OTA istemcisi yalnız status=active sürümleri görür.'),

  -- authenticated, anon'un görebildiği her şeyi görebilir (rol devralması yok;
  -- policy'ler ayrı yazılmış olsa da kapsam mantıksal olarak üst kümedir).
  ('authenticated', 'feature_flags',    'anon ile aynı gerekçe.'),
  ('authenticated', 'runtime_policies', 'anon ile aynı gerekçe.'),
  ('authenticated', 'ota_releases',     'anon ile aynı gerekçe.'),

  -- KAPI 4 bunu ilk koşuşta yakaladı; policy `USING (true)`.
  -- İNCELENDİ ve MEŞRU bulundu: kolonlar yalnız
  --   source · last_event_at · last_result · last_error · *_count · updated_at
  -- Şirket/kullanıcı/araç kimliği YOK, PII YOK, ham içerik YOK; tablo
  -- `anon` ve `PUBLIC` rollerinden REVOKE edilmiş (migration ...p1.sql:719).
  -- Kiracıya-özgü bir kolon EKLENİRSE bu satır SİLİNMELİ.
  ('authenticated', 'ai_evidence_adapter_state',
   'Sirket-bagimsiz ADAPTOR SAYACI; kiraci alani ve PII yok, anon REVOKE.');

CREATE TEMP TABLE rls_matrix (
  tbl        text,
  role_name  text,
  n_super    bigint,
  n_role     bigint,
  select_v   text,     -- ÖLÇÜLDÜ:  EXPOSED | DENIED | UNPROVEN
  can_insert boolean,  -- TÜRETİLDİ
  can_update boolean,  -- TÜRETİLDİ
  can_delete boolean   -- TÜRETİLDİ
);

-- Bir rolün bir tabloda bir komut için yazma kapısı AÇIK mı (türetim).
CREATE FUNCTION pg_temp.write_open(p_role text, p_tbl text, p_cmd text)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT has_table_privilege(p_role, format('public.%I', p_tbl), p_cmd)
     AND EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename  = p_tbl
          AND p.permissive = 'PERMISSIVE'
          AND p.cmd IN (p_cmd, 'ALL')
          AND (p.roles @> ARRAY[p_role]::name[] OR p.roles @> ARRAY['public']::name[])
     );
$fn$;

DO $sweep$
DECLARE
  r record; rl text; ns bigint; nr bigint; v text;
BEGIN
  FOREACH rl IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR r IN SELECT c.relname AS t
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
              ORDER BY 1
    LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', r.t) INTO ns;

      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', rl);
        EXECUTE format('SELECT count(*) FROM public.%I', r.t) INTO nr;
      EXCEPTION WHEN insufficient_privilege THEN
        nr := -1;                                    -- GRANT düzeyinde kapalı
      END;
      RESET ROLE;

      v := CASE
             WHEN nr < 0 THEN 'DENIED'
             WHEN ns = 0 THEN 'UNPROVEN'             -- boş tablo → KANIT YOK
             WHEN nr = 0 THEN 'DENIED'
             ELSE 'EXPOSED'
           END;

      INSERT INTO rls_matrix VALUES (
        r.t, rl, ns, nr, v,
        pg_temp.write_open(rl, r.t, 'INSERT'),
        pg_temp.write_open(rl, r.t, 'UPDATE'),
        pg_temp.write_open(rl, r.t, 'DELETE')
      );
    END LOOP;
  END LOOP;
END
$sweep$;

-- ═════════════════════════════════════════════════════════════════════════
-- RAPOR
-- ═════════════════════════════════════════════════════════════════════════
\echo ''
\echo '-- ANON OKUMA: reddedilmeyen her tablo (ÖLÇÜLDÜ) ---------------------'
SELECT tbl, n_super AS satir, n_role AS anon_gordu, select_v AS hukum
  FROM rls_matrix WHERE role_name = 'anon' AND select_v <> 'DENIED'
 ORDER BY select_v DESC, tbl;

\echo ''
\echo '-- ANON YAZMA KAPISI ACIK OLANLAR (TURETILDI) ------------------------'
SELECT tbl, can_insert, can_update, can_delete
  FROM rls_matrix
 WHERE role_name = 'anon' AND (can_insert OR can_update OR can_delete)
 ORDER BY tbl;

\echo ''
\echo '-- OZET --------------------------------------------------------------'
SELECT role_name,
       count(*) FILTER (WHERE select_v = 'DENIED')   AS kanitli_red,
       count(*) FILTER (WHERE select_v = 'UNPROVEN') AS kanitlanamadi,
       count(*) FILTER (WHERE select_v = 'EXPOSED')  AS gorunur
  FROM rls_matrix GROUP BY role_name ORDER BY role_name;

-- ═════════════════════════════════════════════════════════════════════════
-- KAPILAR — biri düşerse dosya HATA ile biter (ON_ERROR_STOP on)
-- ═════════════════════════════════════════════════════════════════════════
DO $gates$
DECLARE bad text; n int;
BEGIN
  -- KAPI 1 — anon, izin listesi DIŞINDA hiçbir tabloyu okuyamaz.
  SELECT string_agg(m.tbl, ', '), count(*) INTO bad, n
    FROM rls_matrix m
   WHERE m.role_name = 'anon' AND m.select_v = 'EXPOSED'
     AND NOT EXISTS (SELECT 1 FROM read_allowlist a
                      WHERE a.role_name = 'anon' AND a.t = m.tbl);
  IF n > 0 THEN
    RAISE EXCEPTION 'RLS KAPI 1 DUSTU -- anon izinsiz % tabloyu OKUYOR: %', n, bad;
  END IF;

  -- KAPI 2 — anon HİÇBİR tabloya doğrudan yazamaz. Telemetri ve komut yazımı
  -- YALNIZ SECURITY DEFINER RPC üzerinden, api_key doğrulamasıyla olur.
  -- Doğrudan tablo yazması açılırsa sahte araç verisi enjekte edilebilir.
  SELECT string_agg(m.tbl, ', '), count(*) INTO bad, n
    FROM rls_matrix m
   WHERE m.role_name = 'anon' AND (m.can_insert OR m.can_update OR m.can_delete)
     AND m.tbl <> 'raw_community_events';   -- bilinçli: anonim topluluk olayı
  IF n > 0 THEN
    RAISE EXCEPTION 'RLS KAPI 2 DUSTU -- anon % tabloya YAZABILIYOR: %', n, bad;
  END IF;

  -- KAPI 3 — public şemadaki HER tabloda RLS açık olmalı.
  SELECT string_agg(c.relname, ', '), count(*) INTO bad, n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF n > 0 THEN
    RAISE EXCEPTION 'RLS KAPI 3 DUSTU -- RLS KAPALI % tablo: %', n, bad;
  END IF;

  -- KAPI 4 — 038 SINIFININ ASIL KAPISI.
  -- `authenticated` rolü JWT'siz koşulur: `auth.uid()` NULL'dur, yani hiçbir
  -- sahiplik/üyelik koşulu tutmaz. Bu rolde bir tablo GÖRÜNÜYORSA, o tablonun
  -- policy'si kimliğe DEĞİL sabite bağlıdır (`USING (true)`) — kütükteki
  -- "member kendini admin yapabiliyordu" kusurunun tam olarak sınıfı.
  SELECT string_agg(m.tbl, ', '), count(*) INTO bad, n
    FROM rls_matrix m
   WHERE m.role_name = 'authenticated' AND m.select_v = 'EXPOSED'
     AND NOT EXISTS (SELECT 1 FROM read_allowlist a
                      WHERE a.role_name = 'authenticated' AND a.t = m.tbl);
  IF n > 0 THEN
    RAISE EXCEPTION 'RLS KAPI 4 DUSTU -- kimliksiz authenticated % tabloyu OKUYOR (policy sabite bagli): %', n, bad;
  END IF;

  -- NOT (kapı değil) — RLS açık + policy YOK + GRANT VAR: erişim sessizce ÖLÜ.
  -- Güvenlik açığı değil ama "kod var, besleyen yok" sınıfı; görünür olmalı.
  -- `has_table_privilege` OID ile çağrılır: metin sürümü adı ÇÖZMEYE çalışır ve
  -- planlayıcı sırayı değiştirdiğinde var olmayan ad üzerinde patlar.
  SELECT string_agg(c.relname, ', '), count(*) INTO bad, n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = c.relname)
     AND has_table_privilege('authenticated', c.oid, 'SELECT');
  IF n > 0 THEN
    RAISE WARNING 'RLS NOTU -- policy YOK ama authenticated GRANT VAR (erisim olu, RPC bekleniyor): %', bad;
  END IF;

  RAISE NOTICE 'RLS MATRISI: 4 KAPI DA GECTI.';
END
$gates$;

ROLLBACK;
