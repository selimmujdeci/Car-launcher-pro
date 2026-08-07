-- =====================================================================
-- Migration 035: FİLO (COMPANY) ÜYELİK TEMELİ + PROFİL ÜRETİMİ
--
-- ── KÖK NEDEN (canlı production'da salt-okunur ÖLÇÜLDÜ, tahmin DEĞİL) ─
-- Production envanteri (2026-07-29):
--     auth.users = 2 · profiles = 0 · companies = 0
-- Yani hiçbir kullanıcı için profil satırı ÜRETİLMİYOR. `auth_company_id()`
-- ve 034'ün `SELECT p.company_id INTO v_company` okuması bu yüzden DAİMA
-- NULL döner → 034'ün şirket dalı production'da ULAŞILAMAZ ölü yoldur ve
-- her kullanıcı sonsuza dek "bireysel" (3 araç limitli) sayılır.
--
-- Filo sisteminin çalışmamasının sebebi eksik filo ekranı değil, EKSİK
-- PROFİL SATIRIDIR. Bu migration o tek kök nedeni giderir ve üyelik
-- yönetimini sunucu tarafında fail-closed olarak kurar.
--
-- ── KAPSAM: DÖRT ŞEY ─────────────────────────────────────────────────
--   1. `handle_new_user` tetikleyicisi — auth.users → profiles (idempotent)
--      + mevcut profilsiz kullanıcılar için idempotent backfill
--   2. `create_company`      — çağıran şirketi kurar ve admin olur
--   3. `add_company_member`  — YALNIZ o şirketin admini üye ekler
--   4. `pair_vehicle` GÜVENLİK KISITI — anon/authenticated EXECUTE geri alınır
--
-- ── BU MIGRATION BİLİNÇLİ OLARAK YAPMAZ ──────────────────────────────
--   · Mevcut araç sahipliğine dokunmaz (`vehicles` UPDATE YOK)
--   · Otomatik şirket üretmez (bireysel kullanıcı bireysel kalır)
--   · Mevcut RLS politikalarını yeniden yazmaz
--   · `pair_vehicle` GÖVDESİNİ değiştirmez (yalnız GRANT daraltır)
--   · 034'ün `pair_vehicle_to_user` sözleşmesine dokunmaz
--
-- ── SIRALAMA ZORUNLULUĞU ─────────────────────────────────────────────
-- 033 ÖNCE uygulanmalıdır: production'da `profiles.company_id` hâlâ
-- NOT NULL'dur (ölçüldü). O kısıt dururken bireysel profil satırı
-- (`company_id = NULL`) YAZILAMAZ. Bu migration fail-closed ön kontrolle
-- 033'ü şart koşar.
--
-- ── ÜÇ DEĞERLİ MANTIK NOTU ───────────────────────────────────────────
-- `company_id = auth_company_id()` biçimli politikalarda NULL = NULL → NULL
-- (TRUE DEĞİL). Bireysel profil eklemek hiçbir şirket politikasını
-- genişletmez; cross-tenant görünürlük AÇILMAZ.
--
-- İDEMPOTENT: tekrar çalıştırılabilir (IF NOT EXISTS / ON CONFLICT / OR REPLACE)
-- =====================================================================

-- ── 2.0 ATOMİKLİK KAPISI ──────────────────────────────────────────────
-- Migration'ın TEK transaction içinde çalıştığını KANITLAR (varsaymaz).
-- `ON COMMIT DROP` temp tablo, autocommit modunda ilk ifadeden sonra ölür;
-- ikinci ifade onu bulamazsa runner transaction AÇMAMIŞ demektir → DUR.
-- NEDEN: bu dosya DROP CONSTRAINT içerir; yarım uygulama şemayı ara durumda
-- bırakır. `psql --single-transaction` veya transaction açan bir runner ŞARTTIR.
CREATE TEMP TABLE _m035_txn_probe (x int) ON COMMIT DROP;

DO $$
BEGIN
  IF to_regclass('pg_temp._m035_txn_probe') IS NULL THEN
    RAISE EXCEPTION
      '035 DURDU [ATOMICITY]: migration TEK transaction içinde çalışmıyor. '
      'DROP CONSTRAINT içerdiği için yarım uygulama YASAK. '
      'Çözüm: psql --single-transaction (-1) kullanın veya transaction açan bir runner ile uygulayın.';
  END IF;
  RAISE NOTICE '035: atomiklik kapısı geçti (tek transaction doğrulandı)';
END $$;

-- ── 2.1 ROLE KOLON TİPİ KAPISI ────────────────────────────────────────
-- ENUM/DOMAIN otomatik DÖNÜŞTÜRÜLMEZ — veri kaybı ve kilit riski taşır.
-- Beklenmeyen tipte migration fail-closed durur; operatör bilinçli karar verir.
DO $$
DECLARE
  v_typtype "char";
  v_typname text;
BEGIN
  SELECT t.typtype, t.typname INTO v_typtype, v_typname
  FROM pg_attribute a
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE a.attrelid = 'public.profiles'::regclass
    AND a.attname  = 'role'
    AND a.attnum   > 0
    AND NOT a.attisdropped;

  IF v_typname IS NULL THEN
    RAISE EXCEPTION '035 DURDU [ROLE_TYPE_MISSING]: public.profiles.role kolonu YOK — yanlış şema';
  END IF;

  IF v_typtype = 'e' THEN
    RAISE EXCEPTION
      '035 DURDU [ROLE_TYPE_ENUM]: profiles.role bir ENUM (%). Otomatik dönüştürme YAPILMAZ. '
      'ENUM ''individual'' değerini içermiyorsa signup kırılır. Operatör kararı gerekir.', v_typname;
  END IF;

  IF v_typtype = 'd' THEN
    RAISE EXCEPTION
      '035 DURDU [ROLE_TYPE_DOMAIN]: profiles.role bir DOMAIN (%). Domain CHECK''i ''individual''ı '
      'reddedebilir ve bu migration domain''e DOKUNMAZ. Operatör kararı gerekir.', v_typname;
  END IF;

  IF v_typname NOT IN ('text', 'varchar', 'bpchar') THEN
    RAISE EXCEPTION
      '035 DURDU [ROLE_TYPE_UNEXPECTED]: profiles.role beklenmeyen tipte (%). Beklenen: text/varchar/bpchar', v_typname;
  END IF;

  RAISE NOTICE '035: role kolon tipi kapısı geçti (%)', v_typname;
END $$;

-- ── 1. ÖN DOĞRULAMA (fail-closed) ─────────────────────────────────────
DO $$
DECLARE
  v_prof_nullable text;
  v_bad_roles     text;
BEGIN
  SELECT is_nullable INTO v_prof_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'company_id';

  IF v_prof_nullable IS NULL THEN
    RAISE EXCEPTION '035 ÖN KONTROL: public.profiles.company_id kolonu YOK — yanlış şema';
  END IF;

  -- 033 uygulanmadan bireysel profil satırı yazılamaz → fail-closed DUR.
  IF v_prof_nullable <> 'YES' THEN
    RAISE EXCEPTION
      '035 ÖN KONTROL: profiles.company_id hâlâ NOT NULL — önce migration 033 uygulanmalı';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='companies') THEN
    RAISE EXCEPTION '035 ÖN KONTROL: public.companies tablosu YOK';
  END IF;

  -- Beklenmeyen rol değeri varsa CHECK kısıtı eklemek mevcut satırları kırar → DUR.
  SELECT string_agg(DISTINCT role::text, ', ') INTO v_bad_roles
  FROM public.profiles
  WHERE role IS NOT NULL
    AND role::text NOT IN ('individual', 'member', 'observer', 'admin', 'super_admin');
  IF v_bad_roles IS NOT NULL THEN
    RAISE EXCEPTION '035 ÖN KONTROL: bilinmeyen profiles.role değer(ler)i: % — fail-closed', v_bad_roles;
  END IF;
END $$;

-- ── 2. ROL SÖZLÜĞÜ (fail-closed kısıt) ────────────────────────────────
-- Rol kümesi SUNUCUDA kilitlenir; istemci serbest metin rol yazamaz.
--   individual  : şirketsiz bireysel kullanıcı (varsayılan)
--   member      : şirket üyesi — şirket araçlarını görür
--   observer    : şirket gözlemcisi — salt-okunur
--   admin       : şirket yöneticisi — üye ekler/çıkarır
--   super_admin : platform yöneticisi (mevcut claim deseni — DEĞİŞTİRİLMEZ)
-- ⚠️ BANT-DIŞI ŞEMA SÜRÜKLENMESİ (staging'de ÖLÇÜLDÜ, 2026-07-29):
-- `public.profiles` üzerinde depoda HİÇBİR migration dosyasında bulunmayan,
-- elle/dashboard üzerinden eklenmiş DAR bir kısıt vardı:
--     profiles_role_check  CHECK (role IN ('admin','member'))
-- Postgres tüm CHECK'leri AND'ler → yeni `profiles_role_allowed` eklense bile
-- `role='individual'` YAZILAMIYORDU. Sonuç: `handle_new_user` tetikleyicisi
-- her yeni kayıtta patlıyor → **auth signup TAMAMEN KIRILIYOR** ve aşağıdaki
-- backfill de abort ediyordu.
--
-- ── R2 SERTLEŞTİRMESİ (production preflight denetimi, 2026-07-29) ─────
-- ÖNCEKİ SÜRÜMÜN KUSURU: hedefleme metin alt dizgesiyle yapılıyordu
--     pg_get_constraintdef(oid) LIKE '%role%' AND NOT LIKE '%individual%'
-- Bu yüklem statik denetimde kanıtlanmış şekilde:
--   · `CHECK (role <> 'individual')` gibi GERÇEK engelleyicileri KAÇIRIR,
--   · adı/gövdesi 'individual' geçen ama yine reddeden varyantı KAÇIRIR,
--   · `role_description` gibi ALT DİZGE eşleşen ALAKASIZ kısıtı SİLER,
--   · ENUM/DOMAIN ve trigger engellerini HİÇ göremez,
--   · öz-test AYNI yüklemi kullandığı için kusuru doğrulayamaz.
--
-- YENİ MODEL — metin eşlemesi TAMAMEN KALDIRILDI:
--   1. Kolon tipi kapısı      (§2.1) — ENUM/DOMAIN fail-closed
--   2. Trigger envanteri      (§2.2) — bilinmeyen yazma trigger'ı fail-closed
--   3. Semantik sınıflandırma (§2.3) — `conkey`→`pg_attribute` ile GERÇEK kolon
--      bağımlılığı; blocker kararı `conbin` ifadesinin GERÇEKTEN DEĞERLENDİRİLMESİYLE
--   4. Yeni kısıt             (§2.4)
--   5. Yalnız KANITLANMIŞ blocker'ın DROP'u (§2.5) — tüm kapılardan SONRA
--   6. Anlamsal öz-test       (§2.6) — gerçek INSERT denemesi (probe tablo)
--
-- FAIL-CLOSED SIRALAMA: §2.5'e kadar hiçbir YIKICI ifade çalışmaz. Herhangi bir
-- kapı düşerse şema DEĞİŞMEMİŞ olur (transaction desteği olmasa bile).

-- ── 2.2 TRIGGER ENVANTERİ KAPISI ──────────────────────────────────────
-- `profiles` üzerindeki kullanıcı-tanımlı INSERT/UPDATE trigger'ları rol
-- yazımını reddedebilir; §2.6 probe tablosu trigger KOPYALAMAZ, bu yüzden
-- ayrı kapı gerekir. ALAKASIZ trigger SİLİNMEZ/DEĞİŞTİRİLMEZ — yalnız raporlanır.
--
-- KAÇIŞ KAPISI: operatör trigger'ları inceledikten sonra
--     SET LOCAL caros.m035_reviewed_triggers = 'trg_a,trg_b';
-- diyerek bilinçli onay verebilir. Onaysız hiçbir trigger sessizce geçmez.
DO $$
DECLARE
  v_unreviewed text;
  v_raw        text   := coalesce(current_setting('caros.m035_reviewed_triggers', true), '');
  v_reviewed   text[];
BEGIN
  -- Onay listesi: boşsa BOŞ DİZİ (hiçbir trigger onaylı değil) — NULL değil,
  -- çünkü `<> ALL (NULL)` NULL döner ve kapıyı sessizce açardı (fail-open).
  IF btrim(v_raw) = '' THEN
    v_reviewed := ARRAY[]::text[];
  ELSE
    SELECT array_agg(btrim(x)) INTO v_reviewed
    FROM unnest(string_to_array(v_raw, ',')) AS x
    WHERE btrim(x) <> '';
    v_reviewed := coalesce(v_reviewed, ARRAY[]::text[]);
  END IF;

  SELECT string_agg(tgname, ', ' ORDER BY tgname) INTO v_unreviewed
  FROM pg_trigger
  WHERE tgrelid = 'public.profiles'::regclass
    AND NOT tgisinternal
    -- tgtype bit 4 = INSERT, bit 16 = UPDATE (yalnız yazma yolunu etkileyenler)
    AND ((tgtype & 4) <> 0 OR (tgtype & 16) <> 0)
    AND NOT (tgname = ANY (v_reviewed));

  IF v_unreviewed IS NOT NULL THEN
    RAISE EXCEPTION
      '035 DURDU [UNREVIEWED_TRIGGER]: public.profiles üzerinde incelenmemiş INSERT/UPDATE trigger(lar)ı var: %. '
      'Bunlar role yazımını sessizce reddedebilir. İnceleyip onayladıktan sonra '
      'SET LOCAL caros.m035_reviewed_triggers = ''...''; ile tekrar çalıştırın.', v_unreviewed;
  END IF;

  RAISE NOTICE '035: trigger kapısı geçti (incelenmemiş yazma trigger''ı yok)';
END $$;

-- ── 2.2b BACKFILL ÖN KAPILARI (yıkıcı adımdan ÖNCE) ──────────────────
-- Backfill YIKICI değildir ama YARIM kalırsa kök neden kapanmamış olur.
-- Bu kapılar, INSERT'in kırılabileceği HER nedeni ÖNCEDEN eler.
DO $$
DECLARE
  v_missing_default text;
  v_no_pk           boolean;
  v_orphan_profiles bigint;
BEGIN
  -- (1) `id` dışında default'suz NOT NULL kolon → backfill INSERT'i kırılır.
  --     (§2.6 probe'u da yakalar; burada AÇIK ve okunur hata mesajı verilir.)
  SELECT string_agg(a.attname, ', ' ORDER BY a.attname) INTO v_missing_default
  FROM pg_attribute a
  WHERE a.attrelid = 'public.profiles'::regclass
    AND a.attnum   > 0
    AND NOT a.attisdropped
    AND a.attnotnull
    AND a.attname NOT IN ('id')
    AND NOT EXISTS (
      SELECT 1 FROM pg_attrdef d
      WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum
    );

  IF v_missing_default IS NOT NULL THEN
    RAISE EXCEPTION
      '035 DURDU [BACKFILL_NOT_NULL]: profiles''ta default''suz NOT NULL kolon(lar) var: %. '
      'Backfill bu kolonlara değer üretemez ve PII kopyalaması YASAK. Şema elle uzlaştırılmalı.',
      v_missing_default;
  END IF;

  -- (2) `ON CONFLICT (id)` yalnız `id` üzerinde PK/UNIQUE varsa çalışır.
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.profiles'::regclass
      AND c.contype IN ('p','u')
      AND c.conkey = ARRAY[(
        SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'id'
      )]::smallint[]
  ) INTO v_no_pk;

  IF v_no_pk THEN
    RAISE EXCEPTION
      '035 DURDU [BACKFILL_NO_PK]: profiles.id üzerinde PK/UNIQUE yok — ON CONFLICT (id) çalışamaz '
      've mükerrer profil üretilebilir.';
  END IF;

  -- (3) Orphan profil (auth.users''ta karşılığı olmayan) — FK varsa imkânsızdır,
  --     yoksa veri bütünlüğü zaten bozuktur; backfill bunu ÖRTMEMELİ.
  SELECT count(*) INTO v_orphan_profiles
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE u.id IS NULL;

  IF v_orphan_profiles > 0 THEN
    RAISE EXCEPTION
      '035 DURDU [ORPHAN_PROFILES]: auth.users''ta karşılığı olmayan % profil satırı var. '
      'Backfill bunu düzeltmez; veri bütünlüğü önce elle incelenmelidir.', v_orphan_profiles;
  END IF;

  RAISE NOTICE '035: backfill ön kapıları geçti';
END $$;

-- ── 2.3 + 2.4 + 2.5 SEMANTİK KISIT SINIFLANDIRMASI ────────────────────
-- Metin eşlemesi YOK. Her CHECK kısıtı için:
--   a) `conkey` → `pg_attribute` ile GERÇEKTEN hangi kolonlara bağlı olduğu bulunur
--   b) `role` bağımlılığı yoksa → ASLA DOKUNULMAZ (alakasız kısıt korunur)
--   c) role + BAŞKA kolon (çok sütunlu) → fail-closed DUR (otomatik DROP YOK)
--   d) yalnız `role` → ifade GERÇEKTEN DEĞERLENDİRİLİR:
--        role='individual' için sonuç FALSE ise → KANITLANMIŞ blocker
--        TRUE/NULL ise → zararsız, KORUNUR
--   e) ifade değerlendirilemezse → fail-closed DUR (sessiz geçiş YOK)
DO $$
DECLARE
  r            record;
  v_cols       text[];
  v_expr       text;
  v_accepts    boolean;
  v_blockers   text[] := ARRAY[]::text[];
  v_multi      text[] := ARRAY[]::text[];
  v_kept       text[] := ARRAY[]::text[];
  v_name       text;
BEGIN
  FOR r IN
    SELECT c.oid, c.conname, c.conkey, c.conbin, c.conrelid
    FROM pg_constraint c
    WHERE c.conrelid = 'public.profiles'::regclass
      AND c.contype  = 'c'
      AND c.conname <> 'profiles_role_allowed'   -- yeni otorite sınıflandırılmaz
    ORDER BY c.conname
  LOOP
    -- (a) kısıtın GERÇEK kolon bağımlılıkları
    SELECT array_agg(a.attname ORDER BY a.attname) INTO v_cols
    FROM pg_attribute a
    WHERE a.attrelid = 'public.profiles'::regclass
      AND a.attnum   = ANY (r.conkey);

    -- (b) role'e bağlı DEĞİLSE dokunulmaz
    IF v_cols IS NULL OR NOT ('role' = ANY (v_cols)) THEN
      v_kept := v_kept || r.conname;
      CONTINUE;
    END IF;

    -- (c) çok sütunlu → otomatik DROP YASAK
    IF array_length(v_cols, 1) > 1 THEN
      v_multi := v_multi || (r.conname || ' [' || array_to_string(v_cols, '+') || ']');
      CONTINUE;
    END IF;

    -- (d) yalnız role → ifadeyi GERÇEKTEN değerlendir
    v_expr := pg_get_expr(r.conbin, r.conrelid);
    BEGIN
      EXECUTE format(
        'SELECT coalesce((%s), true) FROM (SELECT %L::text AS role) AS t',
        v_expr, 'individual'
      ) INTO v_accepts;
    EXCEPTION WHEN others THEN
      -- (e) değerlendirilemedi → sessizce geçme
      RAISE EXCEPTION
        '035 DURDU [UNCLASSIFIABLE_CHECK]: "%" kısıtının ifadesi güvenle değerlendirilemedi (%). İfade: %',
        r.conname, SQLERRM, v_expr;
    END;

    IF v_accepts THEN
      v_kept := v_kept || r.conname;          -- individual'ı kabul ediyor → zararsız
    ELSE
      v_blockers := v_blockers || r.conname;  -- KANITLANMIŞ blocker
    END IF;
  END LOOP;

  -- Çok sütunlu blocker varsa insan kararı gerekir.
  IF array_length(v_multi, 1) > 0 THEN
    RAISE EXCEPTION
      '035 DURDU [MULTICOLUMN_ROLE_CHECK]: role''e bağlı ÇOK SÜTUNLU kısıt(lar) var ve otomatik '
      'kaldırılmaz: %. Bunlar iş kuralı taşıyor olabilir; elle incelenmelidir.',
      array_to_string(v_multi, ', ');
  END IF;

  -- (§2.4) Rol kümesini kilitleyen YENİ kısıt — tek otorite.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_role_allowed'
  ) THEN
    -- NULL bilinçli olarak KABUL edilir: uygulama sözleşmesi `isFleetRole(null)=false`
    -- → `apiAuth` fail-closed 'individual'a düşer, `can()` hiçbir yetki vermez.
    -- Yani NULL rol hiçbir yetki GENİŞLETMEZ ve mevcut NULL satırları kırmaz.
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_allowed
      CHECK (role IS NULL OR role IN ('individual','member','observer','admin','super_admin'));
    RAISE NOTICE '035: profiles_role_allowed kuruldu (tek rol otoritesi)';
  END IF;

  -- (§2.5) YIKICI ADIM — yalnız KANITLANMIŞ blocker'lar, tüm kapılardan SONRA.
  IF array_length(v_blockers, 1) > 0 THEN
    FOREACH v_name IN ARRAY v_blockers LOOP
      RAISE NOTICE '035: KANITLANMIŞ blocker kaldırılıyor: % (role=''individual'' için FALSE döndürdü)', v_name;
      EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_name);
    END LOOP;
  ELSE
    RAISE NOTICE '035: kaldırılacak blocker yok';
  END IF;

  IF array_length(v_kept, 1) > 0 THEN
    RAISE NOTICE '035: DOKUNULMAYAN kısıt(lar): %', array_to_string(v_kept, ', ');
  END IF;
END $$;

-- ── 2.6 ANLAMSAL ÖZ-TEST (gerçek INSERT denemesi) ─────────────────────
-- Metin yüklemi TEKRAR EDİLMEZ. `LIKE ... INCLUDING CONSTRAINTS` ile gerçek
-- tablonun CHECK'leri VE kolon tipleri kopyalanan geçici bir probe tabloya
-- role='individual' GERÇEKTEN yazılmayı dener.
--   · FK kopyalanmaz → auth.users satırı GEREKMEZ (sahte kullanıcı YOK)
--   · Temp tablo → kalıcı veri YOK, RLS etkisi YOK
--   · ENUM/DOMAIN reddi de burada yakalanır (tip kopyalanır)
--   · Trigger kopyalanmaz → §2.2 kapısı onu ayrıca kapatır
DO $$
DECLARE
  v_probe_id uuid := '00000000-0000-4000-8000-00000000f035';
  v_con      text;
BEGIN
  EXECUTE 'CREATE TEMP TABLE _m035_role_probe
             (LIKE public.profiles INCLUDING CONSTRAINTS INCLUDING DEFAULTS)';
  BEGIN
    EXECUTE format('INSERT INTO _m035_role_probe (id, role) VALUES (%L, %L)',
                   v_probe_id, 'individual');
  EXCEPTION
    WHEN check_violation THEN
      -- Reddeden kısıtın ADI doğrudan Postgres'ten alınır (tahmin YOK).
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      RAISE EXCEPTION
        '035 DURDU [SELFTEST_CHECK]: profiles şeması role=''individual'' değerini REDDEDİYOR → '
        'auth signup KIRILIR. Reddeden kısıt: % (%)', coalesce(v_con, '?'), SQLERRM;
    WHEN not_null_violation THEN
      RAISE EXCEPTION
        '035 DURDU [SELFTEST_NOT_NULL]: profiles''ta default''suz NOT NULL kolon var → backfill INSERT''i '
        'kırılır. Ayrıntı: %', SQLERRM;
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION
        '035 DURDU [SELFTEST_TYPE]: role kolonu ''individual'' değerini TİP düzeyinde reddetti '
        '(ENUM/DOMAIN?). Ayrıntı: %', SQLERRM;
    WHEN others THEN
      RAISE EXCEPTION
        '035 DURDU [SELFTEST_UNKNOWN]: probe INSERT beklenmeyen hata verdi (%): %', SQLSTATE, SQLERRM;
  END;

  EXECUTE 'DROP TABLE _m035_role_probe';   -- kalıcı iz bırakılmaz

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_role_allowed'
  ) THEN
    RAISE EXCEPTION '035 DURDU: profiles_role_allowed kısıtı kurulamadı (rol kümesi kilitlenmemiş)';
  END IF;

  RAISE NOTICE '035: ANLAMSAL öz-test geçti — role=''individual'' gerçekten YAZILABİLİYOR';
END $$;

-- ── 3. KÖK NEDEN ONARIMI: auth.users → profiles ───────────────────────
-- Bireysel varsayılan: company_id NULL, role 'individual'. Otomatik şirket
-- ÜRETİLMEZ (034'ün bireysel yolu korunur).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.profiles (id, company_id, role)
  VALUES (NEW.id, NULL, 'individual')
  ON CONFLICT (id) DO NOTHING;   -- idempotent: mevcut profili EZMEZ
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Mevcut profilsiz kullanıcılar (production'da 2 adet ölçüldü) — idempotent.
-- Mevcut profil satırlarına DOKUNULMAZ (ON CONFLICT DO NOTHING).
--
-- YARIŞ GÜVENLİĞİ: `on_auth_user_created` tetikleyicisi YUKARIDA kurulur; bu
-- INSERT ile eşzamanlı bir signup olsa bile ikisi de aynı `ON CONFLICT (id)
-- DO NOTHING` yolunu kullanır → mükerrer satır ÜRETİLEMEZ (PK yarışı kaybeden
-- taraf sessizce hiçbir şey yapmaz). PII KOPYALANMAZ: yalnız `id` taşınır.
INSERT INTO public.profiles (id, company_id, role)
SELECT u.id, NULL, 'individual'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ── 4. RPC: create_company ────────────────────────────────────────────
-- Çağıran kullanıcı şirketi kurar ve o şirketin admini olur.
-- Kimlik SUNUCUDAN (`auth.uid()`) alınır — istemciden user_id KABUL EDİLMEZ.
CREATE OR REPLACE FUNCTION public.create_company(p_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_name     text;
  v_existing uuid;
  v_company  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF length(v_name) < 2 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_company_name' USING ERRCODE = 'P0001';
  END IF;

  /* EŞZAMANLILIK: aynı kullanıcının paralel iki isteği iki şirket kuramaz.
     Kullanıcı bazlı advisory kilit, kontrol ile yazmayı ATOMİK yapar. */
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));

  -- Profil satırı yoksa (tetikleyici öncesi kullanıcı) fail-closed oluştur.
  INSERT INTO public.profiles (id, company_id, role)
  VALUES (v_uid, NULL, 'individual')
  ON CONFLICT (id) DO NOTHING;

  SELECT company_id INTO v_existing FROM public.profiles WHERE id = v_uid;

  -- Sessiz tenant DEĞİŞİMİ YASAK: zaten bir şirkete bağlıysa reddet.
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'already_member_of_company' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.companies (name) VALUES (v_name) RETURNING id INTO v_company;

  UPDATE public.profiles
  SET company_id = v_company,
      role       = 'admin'
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'company_id', v_company,
    'name',       v_name,
    'role',       'admin'
  );
END;
$function$;

-- ── 5. RPC: add_company_member ────────────────────────────────────────
-- YALNIZ ilgili şirketin admini çağırabilir. Hedef kullanıcı BAŞKA bir
-- şirkete bağlıysa sessizce TAŞINMAZ (cross-tenant devir yasak).
CREATE OR REPLACE FUNCTION public.add_company_member(
  p_user_id uuid,
  p_role    text DEFAULT 'member'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_admin_co     uuid;
  v_admin_role   text;
  v_target_co    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_target' USING ERRCODE = 'P0001';
  END IF;
  IF p_role NOT IN ('member', 'observer', 'admin') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  SELECT company_id, role INTO v_admin_co, v_admin_role
  FROM public.profiles WHERE id = v_uid;

  -- Yetki kapısı: şirketi olmayan veya admin olmayan çağıran REDDEDİLİR.
  IF v_admin_co IS NULL OR v_admin_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'not_company_admin' USING ERRCODE = 'P0001';
  END IF;

  -- Hedef gerçek bir auth kullanıcısı olmalı (hayalet üyelik yasak).
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'target_user_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.profiles (id, company_id, role)
  VALUES (p_user_id, NULL, 'individual')
  ON CONFLICT (id) DO NOTHING;

  SELECT company_id INTO v_target_co FROM public.profiles WHERE id = p_user_id;

  -- Zaten BAŞKA şirkete bağlıysa → cross-tenant taşıma reddedilir.
  IF v_target_co IS NOT NULL AND v_target_co <> v_admin_co THEN
    RAISE EXCEPTION 'user_belongs_to_another_company' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
  SET company_id = v_admin_co,
      role       = p_role
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id',    p_user_id,
    'company_id', v_admin_co,
    'role',       p_role
  );
END;
$function$;

-- ── 6. GRANT ──────────────────────────────────────────────────────────
-- Her iki RPC de kimliği `auth.uid()`'den alır → authenticated'a AÇILABİLİR.
-- anon ASLA çağıramaz (kimliksiz şirket kurma / üye ekleme yasak).
REVOKE ALL ON FUNCTION public.create_company(text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_company_member(uuid, text)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company(text)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_company_member(uuid, text) TO authenticated, service_role;

-- ── 7. GÜVENLİK KISITI: pair_vehicle anon'a KAPATILIR ─────────────────
-- ÖLÇÜLEN AÇIK (production, salt-okunur denetim):
--   `pair_vehicle(text)` SECURITY DEFINER · `auth.uid()` KULLANMIYOR ·
--   `api_key` DÖNDÜRÜYOR · anon:EXEC + authenticated:EXEC.
-- Yani kimliksiz bir çağıran, 6 karakterlik kodu bilirse/denerse aracın
-- `api_key`'ini alabiliyordu (araç kimliğini ele geçirme).
--
-- ⚠️ GÖVDE DEĞİŞTİRİLMEZ — yalnız yetki daraltılır. Tek meşru çağıran
-- `/api/pwa/pair` rotasıdır ve `supabaseAdmin` (service_role) kullanır;
-- head unit istemcisi bu RPC'yi HİÇ çağırmaz (register_vehicle /
-- refresh_linking_code / push_vehicle_event / update_command_status kullanır).
-- Bu yüzden daraltma hiçbir mevcut akışı kırmaz.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'pair_vehicle'
  ) THEN
    REVOKE ALL ON FUNCTION public.pair_vehicle(text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.pair_vehicle(text) TO service_role;
  END IF;
END $$;

-- ── 8. DOĞRULAMA (CLAUDE.md §Migration Verification) ──────────────────
DO $$
DECLARE
  v_orphan integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '035: on_auth_user_created tetikleyicisi oluşmadı';
  END IF;

  -- Kök neden gerçekten kapandı mı: profilsiz auth kullanıcısı KALMAMALI.
  SELECT count(*) INTO v_orphan
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL;
  IF v_orphan > 0 THEN
    RAISE EXCEPTION '035: % kullanıcı hâlâ profilsiz — backfill başarısız', v_orphan;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='create_company') THEN
    RAISE EXCEPTION '035: create_company oluşmadı';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='add_company_member') THEN
    RAISE EXCEPTION '035: add_company_member oluşmadı';
  END IF;

  -- anon HİÇBİR üyelik/eşleştirme fonksiyonunu çağıramamalı.
  IF has_function_privilege('anon', 'public.create_company(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.add_company_member(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '035: üyelik RPC''leri anon''a AÇIK — güvenlik ihlali';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='pair_vehicle')
     AND (has_function_privilege('anon', 'public.pair_vehicle(text)', 'EXECUTE')
          OR has_function_privilege('authenticated', 'public.pair_vehicle(text)', 'EXECUTE')) THEN
    RAISE EXCEPTION '035: pair_vehicle hâlâ istemci rollerine AÇIK — güvenlik ihlali';
  END IF;

  RAISE NOTICE '035: profil üretimi + filo üyeliği kuruldu, pair_vehicle anon''a kapatıldı';
END $$;

-- Elle doğrulama sorguları (uygulama sonrası çalıştırılmalı):
--   SELECT count(*) FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE p.id IS NULL;
--   SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--    WHERE routine_name IN ('create_company','add_company_member','pair_vehicle');
--   SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';
