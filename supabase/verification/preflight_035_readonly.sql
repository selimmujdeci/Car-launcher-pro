-- =====================================================================
-- preflight_035_readonly.sql — MIGRATION 035 ÖNCESİ SALT-OKUNUR ENVANTER
--
-- AMAÇ: 035 uygulanmadan ÖNCE, hedef veritabanının 035'in fail-closed
-- kapılarından geçip geçmeyeceğini KANITLAMAK. Hiçbir şey değiştirmez.
--
-- ⚠️ BU DOSYA SALT-OKUNURDUR: INSERT/UPDATE/DELETE/CREATE/ALTER/DROP YOKTUR.
--    Production'da güvenle çalıştırılabilir.
--
-- KULLANIM:
--    psql "<read-only-connection>" -f preflight_035_readonly.sql
--
-- ÇIKTI: her satır bir kapı. `KARAR` sütunu GEÇER/DURUR/İNCELE değerini alır.
--        Tek bir DURUR bile varsa 035 UYGULANMAMALIDIR.
-- =====================================================================

\echo '=== MIGRATION 035 PREFLIGHT (SALT-OKUNUR) ==='
\echo ''

-- ── 0. HEDEF KİMLİĞİ ──────────────────────────────────────────────────
SELECT
  current_database()                        AS veritabani,
  current_user                              AS kullanici,
  inet_server_addr()::text                  AS sunucu_adresi,
  version()                                 AS surum;

-- ── 1. MIGRATION GEÇMİŞİ ──────────────────────────────────────────────
\echo ''
\echo '--- 1. Migration geçmişi ---'
SELECT
  CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
       THEN 'YOK — history repair GEREKEBİLİR (Runbook B)'
       ELSE 'VAR' END AS schema_migrations;

-- Tablo yoksa sorgu HATA VERMEZ (bu bir rapor, akış kesilmemeli).
DO $$
DECLARE v_rows text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE '033-036 kayıtları: (geçmiş tablosu yok — sorgulanamadı)';
    RETURN;
  END IF;
  EXECUTE $q$
    SELECT coalesce(string_agg(version || ' ' || coalesce(name,''), E'\n  ' ORDER BY version), '(kayıt yok)')
    FROM supabase_migrations.schema_migrations
    WHERE version LIKE '202607290000%'
  $q$ INTO v_rows;
  RAISE NOTICE '033-036 kayıtları:%', E'\n  ' || v_rows;
END $$;

-- ── 2. ROLE KOLON TİPİ (035 §2.1 kapısı) ──────────────────────────────
\echo ''
\echo '--- 2. profiles.role kolon tipi ---'
SELECT
  t.typname                                        AS tip,
  CASE t.typtype WHEN 'b' THEN 'base' WHEN 'e' THEN 'ENUM'
                 WHEN 'd' THEN 'DOMAIN' ELSE t.typtype::text END AS tip_sinifi,
  CASE
    WHEN t.typtype = 'e' THEN 'DURUR [ROLE_TYPE_ENUM]'
    WHEN t.typtype = 'd' THEN 'DURUR [ROLE_TYPE_DOMAIN]'
    WHEN t.typname NOT IN ('text','varchar','bpchar') THEN 'DURUR [ROLE_TYPE_UNEXPECTED]'
    ELSE 'GEÇER'
  END                                              AS karar
FROM pg_attribute a
JOIN pg_type t ON t.oid = a.atttypid
WHERE a.attrelid = 'public.profiles'::regclass
  AND a.attname  = 'role' AND a.attnum > 0 AND NOT a.attisdropped;

-- ── 3. CHECK KISIT ENVANTERİ — conkey tabanlı (035 §2.3 kapısı) ───────
-- Kritik: her kısıtın GERÇEK kolon bağımlılığı ve 'individual'ı kabul edip
-- etmediği. Metin eşlemesi KULLANILMAZ.
\echo ''
\echo '--- 3. profiles CHECK kısıtları (semantik sınıflandırma) ---'
WITH cons AS (
  SELECT c.oid, c.conname, c.conkey, c.conbin, c.conrelid,
         (SELECT array_agg(a.attname ORDER BY a.attname)
            FROM pg_attribute a
           WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) AS kolonlar
  FROM pg_constraint c
  WHERE c.conrelid = 'public.profiles'::regclass AND c.contype = 'c'
)
SELECT
  conname                                 AS kisit,
  coalesce(array_to_string(kolonlar,'+'), '(yok)') AS kolonlar,
  pg_get_expr(conbin, conrelid)           AS ifade,
  CASE
    WHEN conname = 'profiles_role_allowed'                      THEN 'GEÇER (yeni otorite)'
    WHEN kolonlar IS NULL OR NOT ('role' = ANY (kolonlar))      THEN 'GEÇER (role ile ilgisiz — DOKUNULMAZ)'
    WHEN array_length(kolonlar,1) > 1                           THEN 'DURUR [MULTICOLUMN_ROLE_CHECK]'
    ELSE 'İNCELE (aşağıdaki değerlendirme sonucuna bak)'
  END                                     AS karar
FROM cons
ORDER BY conname;

-- Tek-sütunlu role kısıtları için GERÇEK değerlendirme.
\echo ''
\echo '--- 3b. Tek sütunlu role kısıtları: individual kabul ediliyor mu? ---'
DO $$
DECLARE
  r        record;
  v_ok     boolean;
  v_report text := '';
BEGIN
  FOR r IN
    SELECT c.conname, c.conbin, c.conrelid,
           (SELECT array_agg(a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) AS cols
    FROM pg_constraint c
    WHERE c.conrelid = 'public.profiles'::regclass
      AND c.contype = 'c' AND c.conname <> 'profiles_role_allowed'
    ORDER BY c.conname
  LOOP
    CONTINUE WHEN r.cols IS NULL OR NOT ('role' = ANY (r.cols)) OR array_length(r.cols,1) > 1;
    BEGIN
      EXECUTE format('SELECT coalesce((%s), true) FROM (SELECT %L::text AS role) t',
                     pg_get_expr(r.conbin, r.conrelid), 'individual') INTO v_ok;
      v_report := v_report || format(E'\n  %s -> %s', r.conname,
                    CASE WHEN v_ok THEN 'KABUL (korunur)' ELSE 'BLOCKER (035 kaldıracak)' END);
    EXCEPTION WHEN others THEN
      v_report := v_report || format(E'\n  %s -> DURUR [UNCLASSIFIABLE_CHECK]: %s', r.conname, SQLERRM);
    END;
  END LOOP;
  IF v_report = '' THEN v_report := E'\n  (tek sütunlu role kısıtı yok)'; END IF;
  RAISE NOTICE 'Değerlendirme:%', v_report;
END $$;

-- ── 4. TRIGGER ENVANTERİ (035 §2.2 kapısı) ────────────────────────────
\echo ''
\echo '--- 4. profiles üzerindeki kullanıcı trigger''ları ---'
SELECT
  tgname                                       AS trigger_adi,
  CASE WHEN (tgtype & 4)  <> 0 THEN 'INSERT ' ELSE '' END ||
  CASE WHEN (tgtype & 16) <> 0 THEN 'UPDATE ' ELSE '' END ||
  CASE WHEN (tgtype & 8)  <> 0 THEN 'DELETE ' ELSE '' END AS olaylar,
  CASE WHEN ((tgtype & 4) <> 0 OR (tgtype & 16) <> 0)
       THEN 'DURUR [UNREVIEWED_TRIGGER] — incele, sonra caros.m035_reviewed_triggers ile onayla'
       ELSE 'GEÇER (yazma yolunu etkilemiyor)' END      AS karar
FROM pg_trigger
WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- ── 5. BACKFILL KAPILARI (035 §2.2b) ──────────────────────────────────
\echo ''
\echo '--- 5. Backfill ön koşulları ---'
SELECT
  coalesce(string_agg(a.attname, ', ' ORDER BY a.attname), '(yok)') AS defaultsuz_not_null,
  CASE WHEN count(*) = 0 THEN 'GEÇER' ELSE 'DURUR [BACKFILL_NOT_NULL]' END AS karar
FROM pg_attribute a
WHERE a.attrelid = 'public.profiles'::regclass
  AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull
  AND a.attname <> 'id'
  AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum);

SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.profiles'::regclass AND c.contype IN ('p','u')
      AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                             WHERE attrelid='public.profiles'::regclass AND attname='id')]::smallint[]
  ) THEN 'GEÇER' ELSE 'DURUR [BACKFILL_NO_PK]' END AS id_pk_unique;

\echo ''
\echo '--- 5b. auth.users <-> profiles farkı (PII YOK, yalnız sayı) ---'
SELECT
  (SELECT count(*) FROM auth.users)                                   AS auth_kullanici,
  (SELECT count(*) FROM public.profiles)                              AS profil,
  (SELECT count(*) FROM auth.users u
     LEFT JOIN public.profiles p ON p.id=u.id WHERE p.id IS NULL)     AS profilsiz_kullanici,
  (SELECT count(*) FROM public.profiles p
     LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL)          AS orphan_profil;

\echo ''
\echo '--- 5c. Geçersiz rol değeri (035 §1 kapısı) ---'
SELECT coalesce(string_agg(DISTINCT role::text, ', '), '(yok)') AS gecersiz_roller,
       CASE WHEN count(*) = 0 THEN 'GEÇER' ELSE 'DURUR' END     AS karar
FROM public.profiles
WHERE role IS NOT NULL
  AND role::text NOT IN ('individual','member','observer','admin','super_admin');

-- ── 6. pair_vehicle YETKİLERİ ─────────────────────────────────────────
\echo ''
\echo '--- 6. pair_vehicle mevcut yetkileri ---'
SELECT
  p.oid::regprocedure::text                                  AS fonksiyon,
  pg_get_userbyid(p.proowner)                                AS sahip,
  p.prosecdef                                                AS security_definer,
  has_function_privilege('anon',          p.oid, 'EXECUTE')  AS anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS authenticated,
  has_function_privilege('service_role',  p.oid, 'EXECUTE')  AS service_role
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'pair_vehicle%'
ORDER BY 1;

\echo ''
\echo '=== PREFLIGHT BİTTİ — tek bir DURUR bile varsa 035 UYGULANMAMALIDIR ==='
