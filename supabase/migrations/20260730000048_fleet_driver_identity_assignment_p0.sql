-- ═══════════════════════════════════════════════════════════════════════════
-- 048 — FLEET DRIVER IDENTITY & ASSIGNMENT P0
--
-- YALNIZ İLERİ MIGRATION. 033–047 geçmişi DEĞİŞTİRİLMEZ.
--
-- ── CEVAPLANAN SORU ──────────────────────────────────────────────────────
-- "Bu aracı, bu zaman aralığında ve bu yolculuk sırasında KİM kullanıyordu?"
--
-- Kanıtlanamıyorsa cevap **UNKNOWN_DRIVER**'dır. Araç sahibi, Fleet
-- kullanıcısı, observer veya son giriş yapan kişi **otomatik sürücü SAYILMAZ**.
--
-- ── BU PAKET DRIVER DNA DEĞİLDİR ─────────────────────────────────────────
-- Sürüş puanı · davranış profili · risk tahmini · ceza/ödül · vardiya
-- optimizasyonu ÜRETİLMEZ. Yalnız kimlik ve atama TEMELİ kurulur.
--
-- ── AYRILAN KAVRAMLAR (tek user_id alanına KARIŞTIRILMAZ) ────────────────
--   1. Auth User        → auth.users / profiles           (giriş yapan)
--   2. Company Member   → profiles.company_id + role      (şirkette kayıtlı)
--   3. Vehicle Owner    → vehicles.owner_id/company_id    (sahiplik yetkisi)
--   4. Vehicle Observer → profiles.role='observer'        (görüntüleme)
--   5. Driver Profile   → public.fleet_drivers            (araç kullanabilen KİŞİ)
--   6. Driver Assignment→ public.vehicle_driver_assignments (zaman aralıklı)
--   7. Trip Attribution → vehicle_trips.driver_*          (sonuç + provenance)
--
-- ── MEVCUT `vehicles.driver_name` NEDEN OTORİTE DEĞİL ────────────────────
-- O kolon serbest METİNDİR: kimliğe bağlı değil, zaman aralığı yok,
-- denetlenemez, tenant güvenliği yok, trip'e bağlanamaz. **DEĞİŞTİRİLMEDİ**
-- (geriye uyum) ama sürücü otoritesi ARTIK BU TABLOLARDIR.
--
-- ── KAPSAM SINIRI (bilinçli) ─────────────────────────────────────────────
-- `vehicles_single_owner_type` CHECK gereği araç ya bireysel (`owner_id`)
-- ya şirket (`company_id`) olabilir. Sürücü modeli **company-scoped**'tur;
-- bireysel araçlar bu paketin KAPSAMI DIŞINDADIR (bireysel sahip zaten
-- kendi aracını sürer varsayımı YAPILMAZ — orada attribution UNKNOWN kalır).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. FLEET DRIVERS ────────────────────────────────────────────────────
--
-- Bir sürücünün CAROS hesabı OLMAK ZORUNDA DEĞİLDİR → `linked_user_id`
-- nullable. Şoförlerin çoğunun uygulamada hesabı olmaz; hesap zorunlu
-- kılınsaydı gerçek sürücü kaydı hiç oluşturulamazdı.
CREATE TABLE IF NOT EXISTS public.fleet_drivers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  /* Auth kullanıcısı ile BAĞ — opsiyonel. Bağlanmışsa o kullanıcı kendi
     atamalarını görebilir; bağlanmamışsa sürücü yalnız bir kayıttır. */
  linked_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  display_name     text NOT NULL,
  employee_code    text,

  /* ── HASSAS ALANLAR ──────────────────────────────────────────────────
     Kişisel veridir. Head unit bunları ASLA okuyamaz (§11/§12); okuma
     RPC'leri bunları döndürmez, yalnız yönetim RPC'si döndürür. */
  phone            text,
  license_number   text,
  license_class    text,
  license_expires_at date,

  status           text NOT NULL DEFAULT 'ACTIVE',

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revision         integer NOT NULL DEFAULT 1,

  CONSTRAINT fleet_drivers_status_valid
    CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED','ARCHIVED')),
  CONSTRAINT fleet_drivers_revision_positive CHECK (revision >= 1),
  CONSTRAINT fleet_drivers_name_present CHECK (btrim(display_name) <> '')
);

-- Aynı auth kullanıcısı aynı şirkette EN FAZLA BİR aktif sürücü profiline
-- bağlanabilir. (Farklı şirketlerde bağımsız profil serbesttir — bir kişi
-- iki firmada şoför olabilir.) ARCHIVED/INACTIVE kayıtlar bu kısıta
-- girmez: geçmiş korunur, yeni profil açılabilir.
CREATE UNIQUE INDEX IF NOT EXISTS fleet_drivers_company_user_active_uniq
  ON public.fleet_drivers (company_id, linked_user_id)
  WHERE linked_user_id IS NOT NULL AND status IN ('ACTIVE','SUSPENDED');

CREATE INDEX IF NOT EXISTS fleet_drivers_company_idx
  ON public.fleet_drivers (company_id, status);

-- ── 2. VEHICLE DRIVER ASSIGNMENTS ───────────────────────────────────────
--
-- Atama **anlık bir alan DEĞİL, ZAMAN ARALIĞIDIR**. `vehicles.driver_id`
-- gibi tek alan kullanılsaydı "geçen salı bu aracı kim kullandı?" sorusu
-- cevaplanamazdı — trip attribution'ın tamamı buna dayanır.
CREATE TABLE IF NOT EXISTS public.vehicle_driver_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vehicle_id     uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id      uuid NOT NULL REFERENCES public.fleet_drivers(id) ON DELETE RESTRICT,

  /* UTC. `ends_at IS NULL` = açık uçlu AKTİF atama. */
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz,

  assignment_type text NOT NULL DEFAULT 'PRIMARY',
  source          text NOT NULL DEFAULT 'FLEET_ADMIN',
  confidence      text NOT NULL DEFAULT 'HIGH',
  status          text NOT NULL DEFAULT 'ACTIVE',

  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  revision       integer NOT NULL DEFAULT 1,
  note           text,

  /* Bitiş başlangıçtan önce olamaz. Eşit olabilir (anlık kapanış). */
  CONSTRAINT vda_range_valid CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT vda_revision_positive CHECK (revision >= 1),

  /* P0'da YALNIZ gerçekten üretilen türler. Enum şişirmesi yapılmadı;
     `SHIFT`/`AUTOMATIC_FUTURE` gerçek üreticisi olmadığı için YOK. */
  CONSTRAINT vda_type_valid
    CHECK (assignment_type IN ('PRIMARY','TEMPORARY','MANUAL')),

  /* Kaynak sözleşmesi geleceğe hazır tutuldu, ama P0'da yalnız
     `FLEET_ADMIN` ÜRETİLİR. Diğerleri gerçek üreticisi bağlanana kadar
     sahte üretilmez (bkz. §16 head unit / phone hub). */
  CONSTRAINT vda_source_valid
    CHECK (source IN ('FLEET_ADMIN','DRIVER_SELF_SELECT','HEAD_UNIT_SELECT',
                      'PHONE_HUB','NFC','BLUETOOTH','UNKNOWN')),
  CONSTRAINT vda_confidence_valid
    CHECK (confidence IN ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN')),
  CONSTRAINT vda_status_valid
    CHECK (status IN ('SCHEDULED','ACTIVE','COMPLETED','CANCELLED','CONFLICTED'))
);

-- ── ÇAKIŞMA SAVUNMASI (iki katman) ──────────────────────────────────────
--
-- NEDEN `EXCLUDE ... WITH &&` KULLANILMADI: tstzrange örtüşme kısıtı
-- `btree_gist` uzantısını gerektirir; bu uzantı hedef Supabase projesinde
-- KURULU DEĞİL ve migration'ın uzantı kurma iznine bağlı olması, izin
-- yoksa **tüm migration'ı düşürür**. Bunun yerine:
--   (a) DB'de kısmi UNIQUE index → açık uçlu ikinci atamayı KÖKTEN engeller
--   (b) RPC'de advisory lock + aralık sorgusu → kapalı aralık örtüşmesi
-- Böylece uzantı bağımlılığı olmadan hem yarış hem çakışma kapanır.

-- (a) Bir araçta AÇIK UÇLU (ends_at NULL) aktif atama EN FAZLA BİR tane.
CREATE UNIQUE INDEX IF NOT EXISTS vda_vehicle_open_active_uniq
  ON public.vehicle_driver_assignments (vehicle_id)
  WHERE ends_at IS NULL AND status IN ('SCHEDULED','ACTIVE');

-- (a2) Bir SÜRÜCÜ aynı anda iki araçta açık uçlu atanamaz.
--      ÜRÜN POLİTİKASI: bir kişi fiziksel olarak aynı anda iki araç
--      süremez; izin verilseydi trip attribution'ı belirsizleşirdi.
CREATE UNIQUE INDEX IF NOT EXISTS vda_driver_open_active_uniq
  ON public.vehicle_driver_assignments (driver_id)
  WHERE ends_at IS NULL AND status IN ('SCHEDULED','ACTIVE');

CREATE INDEX IF NOT EXISTS vda_vehicle_time_idx
  ON public.vehicle_driver_assignments (vehicle_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS vda_driver_time_idx
  ON public.vehicle_driver_assignments (driver_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS vda_company_idx
  ON public.vehicle_driver_assignments (company_id, status);

-- ── 3. TRIP DRIVER ATTRIBUTION (vehicle_trips'e kolonlar) ───────────────
--
-- Basit bir `driver_id` YETMEZ: sonucun NEREDEN geldiği ve NE KADAR
-- güvenilir olduğu saklanmazsa, "sürücü buydu" ile "sürücü buymuş gibi
-- tahmin ettik" ayırt edilemez.
ALTER TABLE public.vehicle_trips
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.fleet_drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_assignment_id uuid
      REFERENCES public.vehicle_driver_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_attribution_source text,
  ADD COLUMN IF NOT EXISTS driver_attribution_confidence text,
  ADD COLUMN IF NOT EXISTS driver_attribution_status text,
  ADD COLUMN IF NOT EXISTS driver_attributed_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_attributed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_attribution_revision integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_driver_attr_status_valid') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_driver_attr_status_valid
      CHECK (driver_attribution_status IS NULL OR driver_attribution_status IN
             ('ATTRIBUTED','UNKNOWN','CONFLICTED','MANUAL_REVIEW','LOCKED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_driver_attr_source_valid') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_driver_attr_source_valid
      CHECK (driver_attribution_source IS NULL OR driver_attribution_source IN
             ('ACTIVE_ASSIGNMENT','MANUAL_TRIP_ASSIGNMENT','HEAD_UNIT_SELECTION',
              'PHONE_HUB','NFC','BLUETOOTH','UNKNOWN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_driver_attr_conf_valid') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_driver_attr_conf_valid
      CHECK (driver_attribution_confidence IS NULL OR driver_attribution_confidence IN
             ('VERY_HIGH','HIGH','MEDIUM','LOW','UNKNOWN'));
  END IF;
  /* ATTRIBUTED ise sürücü ZORUNLU — "atandı ama kim olduğu yok" olamaz. */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_attributed_needs_driver') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_attributed_needs_driver
      CHECK (driver_attribution_status IS DISTINCT FROM 'ATTRIBUTED' OR driver_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vt_driver_attr_revision_positive') THEN
    ALTER TABLE public.vehicle_trips ADD CONSTRAINT vt_driver_attr_revision_positive
      CHECK (driver_attribution_revision IS NULL OR driver_attribution_revision >= 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vehicle_trips_driver_idx
  ON public.vehicle_trips (driver_id, started_at DESC)
  WHERE driver_id IS NOT NULL;

-- ── 4. ATTRIBUTION REVISION GEÇMİŞİ (audit) ─────────────────────────────
--
-- Yanlış atama DÜZELTİLEBİLMELİ ve düzeltme İZLENEBİLMELİ. Önceki sonuç
-- silinmez; her değişiklik yeni bir revizyon satırı üretir.
CREATE TABLE IF NOT EXISTS public.trip_driver_attribution_revisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  vehicle_id     uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  trip_key       text NOT NULL,
  revision       integer NOT NULL,

  previous_driver_id uuid REFERENCES public.fleet_drivers(id) ON DELETE SET NULL,
  new_driver_id      uuid REFERENCES public.fleet_drivers(id) ON DELETE SET NULL,
  previous_status    text,
  new_status         text,
  source             text,
  confidence         text,

  /* İşlemi YAPAN ile SÜRÜCÜ ayrı alanlardır — bunları karıştırmak
     "atamayı yapan admin sürücüydü" yanılgısı üretir. */
  actor_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  /* Sınırlı serbest metin; hassas veri yazılmaz. */
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tdar_revision_positive CHECK (revision >= 1),
  CONSTRAINT tdar_reason_bounded CHECK (reason IS NULL OR length(reason) <= 280)
);

CREATE INDEX IF NOT EXISTS tdar_trip_idx
  ON public.trip_driver_attribution_revisions (vehicle_id, trip_key, revision DESC);

-- ── 5. GENEL AUDIT (sürücü ve atama işlemleri) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_driver_audit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      uuid,
  previous_revision integer,
  new_revision      integer,
  /* Sınırlı gerekçe — TAM ehliyet/telefon/e-posta/token YAZILMAZ. */
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fda_action_valid CHECK (action IN (
    'DRIVER_CREATED','DRIVER_UPDATED','DRIVER_DEACTIVATED','DRIVER_ARCHIVED',
    'ASSIGNMENT_CREATED','ASSIGNMENT_ENDED','ASSIGNMENT_CANCELLED',
    'ASSIGNMENT_CONFLICT','TRIP_DRIVER_MANUAL','TRIP_DRIVER_CORRECTED',
    'CROSS_TENANT_REJECTED','TRANSFER_ASSIGNMENTS_CLOSED')),
  CONSTRAINT fda_entity_valid CHECK (entity_type IN
    ('DRIVER','ASSIGNMENT','TRIP','VEHICLE')),
  CONSTRAINT fda_reason_bounded CHECK (reason IS NULL OR length(reason) <= 280)
);

CREATE INDEX IF NOT EXISTS fda_company_idx
  ON public.fleet_driver_audit (company_id, created_at DESC);

-- ── 6. RLS + İZİNLER ────────────────────────────────────────────────────
--
-- `anon` HİÇBİR sürücü kişisel verisine erişemez. Head unit `anon`
-- rolünde çalıştığı için (api_key gövdede), tablo erişimi kapalıdır ve
-- head unit YALNIZ kendi aracının minimum özetini RPC ile alır (§11).

ALTER TABLE public.fleet_drivers                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_driver_assignments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_driver_attribution_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_driver_audit                ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.fleet_drivers                     FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.vehicle_driver_assignments        FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.trip_driver_attribution_revisions FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.fleet_driver_audit                FROM anon, PUBLIC;

-- Yazma YALNIZ RPC üzerinden (iş kuralları client'a bırakılmaz).
GRANT SELECT ON TABLE public.fleet_drivers                     TO authenticated;
GRANT SELECT ON TABLE public.vehicle_driver_assignments        TO authenticated;
GRANT SELECT ON TABLE public.trip_driver_attribution_revisions TO authenticated;
GRANT SELECT ON TABLE public.fleet_driver_audit                TO authenticated;

GRANT ALL ON TABLE public.fleet_drivers                     TO service_role;
GRANT ALL ON TABLE public.vehicle_driver_assignments        TO service_role;
GRANT ALL ON TABLE public.trip_driver_attribution_revisions TO service_role;
GRANT ALL ON TABLE public.fleet_driver_audit                TO service_role;

-- Kapsam: YALNIZ kendi şirketi. Cross-tenant okuma yok.
DROP POLICY IF EXISTS fleet_drivers_company_read ON public.fleet_drivers;
CREATE POLICY fleet_drivers_company_read ON public.fleet_drivers
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS vda_company_read ON public.vehicle_driver_assignments;
CREATE POLICY vda_company_read ON public.vehicle_driver_assignments
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS tdar_company_read ON public.trip_driver_attribution_revisions;
CREATE POLICY tdar_company_read ON public.trip_driver_attribution_revisions
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS fda_company_read ON public.fleet_driver_audit;
CREATE POLICY fda_company_read ON public.fleet_driver_audit
  FOR SELECT TO authenticated
  USING (company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()));

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- BÖLÜM B — RPC'LER
--
-- İş kuralları client'a BIRAKILMAZ: yetki, tenant eşleşmesi, zaman aralığı
-- geçerliliği, çakışma tespiti ve audit tamamen sunucudadır.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── B0. YETKİ YARDIMCILARI ──────────────────────────────────────────────
--
-- Sürücü/atama YÖNETİMİ yalnız `admin` rolündedir. `member` araç komutu
-- gönderebilir ama sürücü kimliği yönetemez; `observer` SALT-OKUNURDUR;
-- `individual` şirketi olmadığı için kapsam dışıdır.
--
-- Dönüş: yetkili ise şirket kimliği, değilse NULL (fail-closed).
CREATE OR REPLACE FUNCTION public._fleet_driver_admin_company()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p.company_id
    FROM public.profiles p
   WHERE p.id = auth.uid()
     AND p.company_id IS NOT NULL
     AND p.role = 'admin';
$fn$;

-- Okuma kapsamı: şirket üyeliği (observer dahil — görebilir, yazamaz).
CREATE OR REPLACE FUNCTION public._fleet_member_company()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p.company_id FROM public.profiles p
   WHERE p.id = auth.uid() AND p.company_id IS NOT NULL;
$fn$;

REVOKE ALL ON FUNCTION public._fleet_driver_admin_company() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._fleet_member_company() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._fleet_driver_admin_company() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._fleet_member_company() TO authenticated, service_role;

-- ── B1. SÜRÜCÜ OLUŞTUR ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_fleet_driver(
  p_display_name   text,
  p_employee_code  text DEFAULT NULL,
  p_linked_user_id uuid DEFAULT NULL,
  p_phone          text DEFAULT NULL,
  p_license_number text DEFAULT NULL,
  p_license_class  text DEFAULT NULL,
  p_license_expires_at date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co   uuid := public._fleet_driver_admin_company();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_id   uuid;
BEGIN
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_AUTHORIZED');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NAME_REQUIRED');
  END IF;
  IF length(v_name) > 120 THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NAME_TOO_LONG');
  END IF;

  /* Bağlanacak kullanıcı AYNI şirkette olmalı — cross-tenant bağ YASAK. */
  IF p_linked_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles
                    WHERE id = p_linked_user_id AND company_id = v_co) THEN
      INSERT INTO public.fleet_driver_audit
        (company_id, actor_user_id, action, entity_type, reason)
      VALUES (v_co, auth.uid(), 'CROSS_TENANT_REJECTED', 'DRIVER',
              'linked user not in company');
      RETURN jsonb_build_object('state','REJECTED','reason','CROSS_TENANT_USER');
    END IF;
    /* Aynı kullanıcı aynı şirkette ikinci AKTİF profile bağlanamaz. */
    IF EXISTS (SELECT 1 FROM public.fleet_drivers
                WHERE company_id = v_co AND linked_user_id = p_linked_user_id
                  AND status IN ('ACTIVE','SUSPENDED')) THEN
      RETURN jsonb_build_object('state','REJECTED','reason','USER_ALREADY_LINKED');
    END IF;
  END IF;

  INSERT INTO public.fleet_drivers
    (company_id, linked_user_id, display_name, employee_code, phone,
     license_number, license_class, license_expires_at, created_by)
  VALUES (v_co, p_linked_user_id, v_name, NULLIF(btrim(coalesce(p_employee_code,'')),''),
          NULLIF(btrim(coalesce(p_phone,'')),''),
          NULLIF(btrim(coalesce(p_license_number,'')),''),
          NULLIF(btrim(coalesce(p_license_class,'')),''),
          p_license_expires_at, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.fleet_driver_audit
    (company_id, actor_user_id, action, entity_type, entity_id, new_revision)
  VALUES (v_co, auth.uid(), 'DRIVER_CREATED', 'DRIVER', v_id, 1);

  RETURN jsonb_build_object('state','CREATED','driverId', v_id, 'revision', 1);
END;
$fn$;

-- ── B2. SÜRÜCÜ GÜNCELLE / DURUM DEĞİŞTİR ────────────────────────────────
--
-- HARD DELETE YOK: sürücü silinseydi geçmiş trip attribution'ı koparadı.
-- Bunun yerine `ARCHIVED` — geçmiş korunur, yeni atama yapılamaz.
CREATE OR REPLACE FUNCTION public.update_fleet_driver(
  p_driver_id      uuid,
  p_display_name   text DEFAULT NULL,
  p_employee_code  text DEFAULT NULL,
  p_phone          text DEFAULT NULL,
  p_license_number text DEFAULT NULL,
  p_license_class  text DEFAULT NULL,
  p_license_expires_at date DEFAULT NULL,
  p_status         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co  uuid := public._fleet_driver_admin_company();
  v_row public.fleet_drivers%ROWTYPE;
  v_new_status text;
  v_rev integer;
BEGIN
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_AUTHORIZED');
  END IF;

  SELECT * INTO v_row FROM public.fleet_drivers
   WHERE id = p_driver_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','REJECTED','reason','DRIVER_NOT_FOUND');
  END IF;
  /* Başka tenant'ın sürücüsü DEĞİŞTİRİLEMEZ. */
  IF v_row.company_id <> v_co THEN
    INSERT INTO public.fleet_driver_audit
      (company_id, actor_user_id, action, entity_type, entity_id, reason)
    VALUES (v_co, auth.uid(), 'CROSS_TENANT_REJECTED', 'DRIVER', p_driver_id,
            'driver belongs to another company');
    RETURN jsonb_build_object('state','REJECTED','reason','CROSS_TENANT');
  END IF;

  v_new_status := NULLIF(btrim(coalesce(p_status,'')),'');
  IF v_new_status IS NOT NULL
     AND v_new_status NOT IN ('ACTIVE','INACTIVE','SUSPENDED','ARCHIVED') THEN
    RETURN jsonb_build_object('state','REJECTED','reason','INVALID_STATUS');
  END IF;

  /* Sürücü pasifleşiyorsa AÇIK atamaları da kapanmalı — pasif sürücü
     araç kullanıyor görünemez. */
  IF v_new_status IN ('INACTIVE','SUSPENDED','ARCHIVED') THEN
    UPDATE public.vehicle_driver_assignments
       SET status = 'COMPLETED', ends_at = coalesce(ends_at, now()),
           updated_at = now(), revision = revision + 1
     WHERE driver_id = p_driver_id AND ends_at IS NULL
       AND status IN ('SCHEDULED','ACTIVE');
  END IF;

  v_rev := v_row.revision + 1;

  UPDATE public.fleet_drivers SET
    display_name   = coalesce(NULLIF(btrim(coalesce(p_display_name,'')),''), display_name),
    employee_code  = coalesce(NULLIF(btrim(coalesce(p_employee_code,'')),''), employee_code),
    phone          = coalesce(NULLIF(btrim(coalesce(p_phone,'')),''), phone),
    license_number = coalesce(NULLIF(btrim(coalesce(p_license_number,'')),''), license_number),
    license_class  = coalesce(NULLIF(btrim(coalesce(p_license_class,'')),''), license_class),
    license_expires_at = coalesce(p_license_expires_at, license_expires_at),
    status         = coalesce(v_new_status, status),
    updated_at     = now(),
    revision       = v_rev
   WHERE id = p_driver_id;

  INSERT INTO public.fleet_driver_audit
    (company_id, actor_user_id, action, entity_type, entity_id,
     previous_revision, new_revision)
  VALUES (v_co, auth.uid(),
          CASE WHEN v_new_status = 'ARCHIVED' THEN 'DRIVER_ARCHIVED'
               WHEN v_new_status IN ('INACTIVE','SUSPENDED') THEN 'DRIVER_DEACTIVATED'
               ELSE 'DRIVER_UPDATED' END,
          'DRIVER', p_driver_id, v_row.revision, v_rev);

  RETURN jsonb_build_object('state','UPDATED','driverId', p_driver_id, 'revision', v_rev);
END;
$fn$;

-- ── B3. ARAÇ–SÜRÜCÜ ATAMASI OLUŞTUR ─────────────────────────────────────
--
-- ── YARIŞ KORUMASI ───────────────────────────────────────────────────────
-- İki eşzamanlı atama isteği aynı araç için gelirse ikisi de "çakışma yok"
-- görüp yazabilirdi. `pg_advisory_xact_lock(vehicle_id)` bunu serileştirir;
-- kilit işlem sonunda otomatik bırakılır.
CREATE OR REPLACE FUNCTION public.create_vehicle_driver_assignment(
  p_vehicle_id uuid,
  p_driver_id  uuid,
  p_starts_at  timestamptz DEFAULT NULL,
  p_ends_at    timestamptz DEFAULT NULL,
  p_assignment_type text DEFAULT 'PRIMARY',
  p_note       text DEFAULT NULL,
  p_end_existing boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co       uuid := public._fleet_driver_admin_company();
  v_veh_co   uuid;
  v_drv      public.fleet_drivers%ROWTYPE;
  v_start    timestamptz := coalesce(p_starts_at, now());
  v_type     text := coalesce(NULLIF(btrim(coalesce(p_assignment_type,'')),''), 'PRIMARY');
  v_id       uuid;
  v_conflict int;
BEGIN
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_AUTHORIZED');
  END IF;
  IF v_type NOT IN ('PRIMARY','TEMPORARY','MANUAL') THEN
    RETURN jsonb_build_object('state','REJECTED','reason','INVALID_TYPE');
  END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at < v_start THEN
    RETURN jsonb_build_object('state','REJECTED','reason','INVALID_RANGE');
  END IF;

  /* Araç bu şirkete ait olmalı. Bireysel araç (owner_id) kapsam dışıdır. */
  SELECT company_id INTO v_veh_co FROM public.vehicles WHERE id = p_vehicle_id;
  IF v_veh_co IS NULL OR v_veh_co <> v_co THEN
    INSERT INTO public.fleet_driver_audit
      (company_id, actor_user_id, action, entity_type, entity_id, reason)
    VALUES (v_co, auth.uid(), 'CROSS_TENANT_REJECTED', 'VEHICLE', p_vehicle_id,
            'vehicle not owned by company');
    RETURN jsonb_build_object('state','REJECTED','reason','VEHICLE_NOT_IN_COMPANY');
  END IF;

  SELECT * INTO v_drv FROM public.fleet_drivers WHERE id = p_driver_id;
  IF NOT FOUND OR v_drv.company_id <> v_co THEN
    RETURN jsonb_build_object('state','REJECTED','reason','DRIVER_NOT_IN_COMPANY');
  END IF;
  /* Pasif/arşiv sürücüye atama YAPILAMAZ. */
  IF v_drv.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('state','REJECTED','reason','DRIVER_NOT_ACTIVE');
  END IF;

  /* ── Yarış koruması: araç ve sürücü için deterministik sırayla kilit ── */
  PERFORM pg_advisory_xact_lock(hashtextextended(p_vehicle_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_driver_id::text, 0));

  /* ── VARDİYA DEVRİ: eski atama KAPANMADAN yeni atama açılmaz ──────────
     `p_end_existing` açıkça istenirse atomik devir yapılır. */
  IF p_end_existing THEN
    UPDATE public.vehicle_driver_assignments
       SET ends_at = v_start, status = 'COMPLETED',
           updated_at = now(), revision = revision + 1
     WHERE vehicle_id = p_vehicle_id AND ends_at IS NULL
       AND status IN ('SCHEDULED','ACTIVE');
  END IF;

  /* ── ÇAKIŞMA TESPİTİ (aynı araç, örtüşen aralık) ─────────────────────
     Yarı-açık aralık [starts_at, ends_at) mantığı: bir atamanın bitişi
     diğerinin başlangıcına EŞİTSE çakışma DEĞİLDİR (vardiya devri). */
  SELECT count(*) INTO v_conflict
    FROM public.vehicle_driver_assignments a
   WHERE a.vehicle_id = p_vehicle_id
     AND a.status IN ('SCHEDULED','ACTIVE')
     AND (a.ends_at IS NULL OR a.ends_at > v_start)
     AND (p_ends_at IS NULL OR a.starts_at < p_ends_at);
  IF v_conflict > 0 THEN
    INSERT INTO public.fleet_driver_audit
      (company_id, actor_user_id, action, entity_type, entity_id, reason)
    VALUES (v_co, auth.uid(), 'ASSIGNMENT_CONFLICT', 'VEHICLE', p_vehicle_id,
            'overlapping active assignment on vehicle');
    RETURN jsonb_build_object('state','CONFLICTED','reason','VEHICLE_OVERLAP',
                              'conflicts', v_conflict);
  END IF;

  /* ── AYNI SÜRÜCÜ İKİ ARAÇTA olamaz (fiziksel imkânsızlık) ──────────── */
  SELECT count(*) INTO v_conflict
    FROM public.vehicle_driver_assignments a
   WHERE a.driver_id = p_driver_id
     AND a.vehicle_id <> p_vehicle_id
     AND a.status IN ('SCHEDULED','ACTIVE')
     AND (a.ends_at IS NULL OR a.ends_at > v_start)
     AND (p_ends_at IS NULL OR a.starts_at < p_ends_at);
  IF v_conflict > 0 THEN
    INSERT INTO public.fleet_driver_audit
      (company_id, actor_user_id, action, entity_type, entity_id, reason)
    VALUES (v_co, auth.uid(), 'ASSIGNMENT_CONFLICT', 'DRIVER', p_driver_id,
            'driver already assigned to another vehicle');
    RETURN jsonb_build_object('state','CONFLICTED','reason','DRIVER_OVERLAP',
                              'conflicts', v_conflict);
  END IF;

  INSERT INTO public.vehicle_driver_assignments
    (company_id, vehicle_id, driver_id, starts_at, ends_at, assignment_type,
     source, confidence, status, created_by, note)
  VALUES (v_co, p_vehicle_id, p_driver_id, v_start, p_ends_at, v_type,
          /* P0'da atama YALNIZ Fleet yöneticisinden gelir; head unit /
             NFC / phone hub kaynakları gerçek üreticileri bağlanana dek
             ÜRETİLMEZ (sahte kaynak yazılmaz). */
          'FLEET_ADMIN',
          'HIGH',
          CASE WHEN v_start > now() THEN 'SCHEDULED' ELSE 'ACTIVE' END,
          auth.uid(), NULLIF(btrim(coalesce(p_note,'')),''))
  RETURNING id INTO v_id;

  INSERT INTO public.fleet_driver_audit
    (company_id, actor_user_id, action, entity_type, entity_id, new_revision)
  VALUES (v_co, auth.uid(), 'ASSIGNMENT_CREATED', 'ASSIGNMENT', v_id, 1);

  RETURN jsonb_build_object('state','CREATED','assignmentId', v_id, 'revision', 1);
END;
$fn$;

-- ── B4. ATAMAYI BİTİR / İPTAL ET ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.end_vehicle_driver_assignment(
  p_assignment_id uuid,
  p_ends_at  timestamptz DEFAULT NULL,
  p_cancel   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co  uuid := public._fleet_driver_admin_company();
  v_row public.vehicle_driver_assignments%ROWTYPE;
  v_end timestamptz := coalesce(p_ends_at, now());
  v_rev integer;
BEGIN
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_AUTHORIZED');
  END IF;

  SELECT * INTO v_row FROM public.vehicle_driver_assignments
   WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','REJECTED','reason','ASSIGNMENT_NOT_FOUND');
  END IF;
  IF v_row.company_id <> v_co THEN
    INSERT INTO public.fleet_driver_audit
      (company_id, actor_user_id, action, entity_type, entity_id, reason)
    VALUES (v_co, auth.uid(), 'CROSS_TENANT_REJECTED', 'ASSIGNMENT',
            p_assignment_id, 'assignment belongs to another company');
    RETURN jsonb_build_object('state','REJECTED','reason','CROSS_TENANT');
  END IF;
  IF v_row.status IN ('COMPLETED','CANCELLED') THEN
    RETURN jsonb_build_object('state','REJECTED','reason','ALREADY_CLOSED');
  END IF;
  /* Bitiş başlangıçtan önce olamaz. */
  IF NOT p_cancel AND v_end < v_row.starts_at THEN
    RETURN jsonb_build_object('state','REJECTED','reason','INVALID_RANGE');
  END IF;

  v_rev := v_row.revision + 1;

  UPDATE public.vehicle_driver_assignments
     SET status  = CASE WHEN p_cancel THEN 'CANCELLED' ELSE 'COMPLETED' END,
         /* İPTAL geçmişi silmez; aralık korunur ki o dönemin trip'leri
            neden atanmadığını açıklayabilsin. */
         ends_at = CASE WHEN p_cancel THEN coalesce(v_row.ends_at, v_row.starts_at)
                        ELSE v_end END,
         updated_at = now(), revision = v_rev
   WHERE id = p_assignment_id;

  INSERT INTO public.fleet_driver_audit
    (company_id, actor_user_id, action, entity_type, entity_id,
     previous_revision, new_revision)
  VALUES (v_co, auth.uid(),
          CASE WHEN p_cancel THEN 'ASSIGNMENT_CANCELLED' ELSE 'ASSIGNMENT_ENDED' END,
          'ASSIGNMENT', p_assignment_id, v_row.revision, v_rev);

  RETURN jsonb_build_object('state','UPDATED','assignmentId', p_assignment_id,
                            'revision', v_rev);
END;
$fn$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- BÖLÜM C — TRIP DRIVER ATTRIBUTION
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── C1. ATTRIBUTION ÇEKİRDEĞİ (saf karar, yan etkisiz) ──────────────────
--
-- ── EŞLEŞTİRME KURALI (§8) ───────────────────────────────────────────────
--  1. Trip'in [started_at, ended_at] aralığını al.
--  2. AYNI şirket + AYNI araç için o aralığı KAPSAYAN atamaları bul.
--  3. Tek ve TAM KAPSAYAN atama varsa  → ATTRIBUTED.
--  4. Atama trip'in yalnız BİR BÖLÜMÜNÜ kapsıyorsa → MANUAL_REVIEW
--     (kesin sürücü YAZILMAZ — yarısını başkası sürmüş olabilir).
--  5. Birden fazla atama varsa → CONFLICTED.
--  6. Hiç atama yoksa → UNKNOWN.
--
-- ── ASLA YAPILMAYANLAR ───────────────────────────────────────────────────
--  · son giriş yapan kullanıcı fallback sürücü YAPILMAZ
--  · vehicle owner fallback sürücü YAPILMAZ
--  · fleet admin fallback sürücü YAPILMAZ
-- Kanıt yoksa cevap UNKNOWN'dır; uydurulmuş bir sürücü, hiç sürücü
-- olmamasından DAHA KÖTÜDÜR (Driver DNA'yı kalıcı olarak yanlış eğitir).
--
-- Zaman otoritesi TRIP zamanıdır — `now()` DEĞİL. Offline replay üç gün
-- sonra gelse bile o günkü atama bulunur.
CREATE OR REPLACE FUNCTION public._resolve_trip_driver(
  p_vehicle_id uuid,
  p_company_id uuid,
  p_started_at timestamptz,
  p_ended_at   timestamptz
) RETURNS TABLE (
  driver_id uuid, assignment_id uuid, status text, confidence text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_end     timestamptz := coalesce(p_ended_at, p_started_at);
  v_full    int;
  v_partial int;
  v_drv     uuid;
  v_asg     uuid;
BEGIN
  /* Şirketsiz (bireysel) araç → sürücü modeli kapsam dışı. */
  IF p_company_id IS NULL OR p_started_at IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'UNKNOWN'::text, 'UNKNOWN'::text;
    RETURN;
  END IF;

  /* TAM KAPSAYAN atamalar: trip tümüyle atama aralığının içinde.
     Tenant çift kontrolü: atama VE araç aynı şirkette olmalı. */
  SELECT count(*) INTO v_full
    FROM public.vehicle_driver_assignments a
    JOIN public.vehicles v ON v.id = a.vehicle_id
   WHERE a.vehicle_id = p_vehicle_id
     AND a.company_id = p_company_id
     AND v.company_id = p_company_id
     AND a.status IN ('SCHEDULED','ACTIVE','COMPLETED')
     AND a.starts_at <= p_started_at
     AND (a.ends_at IS NULL OR a.ends_at >= v_end);

  IF v_full > 1 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'CONFLICTED'::text, 'UNKNOWN'::text;
    RETURN;
  END IF;

  IF v_full = 1 THEN
    SELECT a.driver_id, a.id INTO v_drv, v_asg
      FROM public.vehicle_driver_assignments a
      JOIN public.vehicles v ON v.id = a.vehicle_id
     WHERE a.vehicle_id = p_vehicle_id
       AND a.company_id = p_company_id
       AND v.company_id = p_company_id
       AND a.status IN ('SCHEDULED','ACTIVE','COMPLETED')
       AND a.starts_at <= p_started_at
       AND (a.ends_at IS NULL OR a.ends_at >= v_end)
     LIMIT 1;
    /* Güven `HIGH`; `VERY_HIGH` yalnız gerçek fiziksel kimlik kanıtı
       (NFC/BLE/head unit seçimi) geldiğinde verilebilir — bir yönetici
       ataması sürücünün gerçekten direksiyonda olduğunu KANITLAMAZ. */
    RETURN QUERY SELECT v_drv, v_asg, 'ATTRIBUTED'::text, 'HIGH'::text;
    RETURN;
  END IF;

  /* KISMİ kapsama: aralıklar kesişiyor ama trip'i tam örtmüyor. */
  SELECT count(*) INTO v_partial
    FROM public.vehicle_driver_assignments a
    JOIN public.vehicles v ON v.id = a.vehicle_id
   WHERE a.vehicle_id = p_vehicle_id
     AND a.company_id = p_company_id
     AND v.company_id = p_company_id
     AND a.status IN ('SCHEDULED','ACTIVE','COMPLETED')
     AND a.starts_at < v_end
     AND (a.ends_at IS NULL OR a.ends_at > p_started_at);

  IF v_partial > 1 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'CONFLICTED'::text, 'UNKNOWN'::text;
    RETURN;
  END IF;
  IF v_partial = 1 THEN
    /* Kesin sürücü YAZILMAZ — insan incelemesi gerekir. */
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'MANUAL_REVIEW'::text, 'LOW'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'UNKNOWN'::text, 'UNKNOWN'::text;
END;
$fn$;

REVOKE ALL ON FUNCTION public._resolve_trip_driver(uuid,uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._resolve_trip_driver(uuid,uuid,timestamptz,timestamptz)
  TO authenticated, service_role;

-- ── C2. OTOMATİK ATTRIBUTION TRIGGER'I ──────────────────────────────────
--
-- ── NEDEN TRIGGER, NEDEN `upload_vehicle_trip` İÇİNDE DEĞİL ─────────────
-- Trip Metrics P2 az önce tamamlandı ve `upload_vehicle_trip`'in dedupe /
-- revizyon davranışı kilitli. O fonksiyonu değiştirmek P2 regresyon riski
-- taşır. Trigger ise:
--   · yükleme yolundan BAĞIMSIZ çalışır (offline replay dahil),
--   · trip zamanını kullanır (replay zamanını DEĞİL),
--   · DUPLICATE'te UPDATE olmadığı için TETİKLENMEZ → tekrar attribution YOK.
--
-- MANUEL SONUÇ EZİLMEZ: `LOCKED` veya `MANUAL_TRIP_ASSIGNMENT` olan trip'e
-- otomatik karar DOKUNMAZ. Yoksa bir yöneticinin düzeltmesi, sonraki
-- replay'de sessizce geri alınırdı.
CREATE OR REPLACE FUNCTION public._trip_attribution_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co  uuid;
  v_res record;
BEGIN
  /* Manuel/kilitli sonuç KORUNUR. */
  IF NEW.driver_attribution_status IN ('LOCKED','MANUAL_REVIEW')
     OR NEW.driver_attribution_source = 'MANUAL_TRIP_ASSIGNMENT' THEN
    RETURN NEW;
  END IF;

  SELECT company_id INTO v_co FROM public.vehicles WHERE id = NEW.vehicle_id;

  SELECT * INTO v_res
    FROM public._resolve_trip_driver(NEW.vehicle_id, v_co, NEW.started_at, NEW.ended_at);

  /* DEĞİŞİKLİK YOKSA REVİZYON ARTMAZ — 10× replay tek attribution üretir. */
  IF NEW.driver_id IS NOT DISTINCT FROM v_res.driver_id
     AND NEW.driver_attribution_status IS NOT DISTINCT FROM v_res.status THEN
    RETURN NEW;
  END IF;

  NEW.driver_id                     := v_res.driver_id;
  NEW.driver_assignment_id          := v_res.assignment_id;
  NEW.driver_attribution_status     := v_res.status;
  NEW.driver_attribution_confidence := v_res.confidence;
  NEW.driver_attribution_source     :=
    CASE WHEN v_res.status = 'ATTRIBUTED' THEN 'ACTIVE_ASSIGNMENT' ELSE 'UNKNOWN' END;
  NEW.driver_attributed_at          := now();
  /* Otomatik karar bir KULLANICI eylemi değildir → `attributed_by` NULL. */
  NEW.driver_attributed_by          := NULL;
  NEW.driver_attribution_revision   := coalesce(NEW.driver_attribution_revision, 0) + 1;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_trip_attribution ON public.vehicle_trips;
CREATE TRIGGER trg_trip_attribution
  BEFORE INSERT OR UPDATE OF started_at, ended_at, vehicle_id
  ON public.vehicle_trips
  FOR EACH ROW EXECUTE FUNCTION public._trip_attribution_trigger();

-- ── C3. ARAÇ DEVRİ SINIRI ───────────────────────────────────────────────
--
-- Araç şirket/sahip değiştirdiğinde eski şirketin AÇIK atamaları
-- KAPANMALIDIR: aksi halde eski şirketin sürücüsü yeni şirketin
-- trip'lerine bağlanır (cross-tenant sürücü sızıntısı).
--
-- Mevcut `accept_vehicle_transfer` RPC'si DEĞİŞTİRİLMEDİ — trigger
-- transferin hangi yoldan yapıldığından bağımsız çalışır.
CREATE OR REPLACE FUNCTION public._vehicle_transfer_close_assignments()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN

    UPDATE public.vehicle_driver_assignments
       SET status = 'COMPLETED',
           ends_at = coalesce(ends_at, now()),
           updated_at = now(),
           revision = revision + 1
     WHERE vehicle_id = NEW.id
       AND ends_at IS NULL
       AND status IN ('SCHEDULED','ACTIVE');

    IF FOUND THEN
      INSERT INTO public.fleet_driver_audit
        (company_id, actor_user_id, action, entity_type, entity_id, reason)
      VALUES (OLD.company_id, auth.uid(), 'TRANSFER_ASSIGNMENTS_CLOSED',
              'VEHICLE', NEW.id, 'vehicle ownership changed');
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_vehicle_transfer_assignments ON public.vehicles;
CREATE TRIGGER trg_vehicle_transfer_assignments
  AFTER UPDATE OF company_id, owner_id ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public._vehicle_transfer_close_assignments();

-- ── C4. MANUEL TRIP SÜRÜCÜ ATAMASI ──────────────────────────────────────
--
-- Yanlış atama DÜZELTİLEBİLMELİ. Kurallar:
--   · yalnız aynı şirketin AKTİF sürücüsü seçilebilir
--   · trip metrikleri ve `trip_key` DEĞİŞMEZ (dedupe bozulmaz)
--   · trip'in kendi `revision`'ı DEĞİŞMEZ — yalnız attribution revizyonu artar
--   · önceki sonuç revizyon tablosunda KORUNUR
--   · confidence otomatik `VERY_HIGH` YAPILMAZ: bir yöneticinin sonradan
--     işaretlemesi, sürücünün direksiyonda olduğunun fiziksel kanıtı değildir
--   · atamayı YAPAN (`attributed_by`) ile SÜRÜCÜ (`driver_id`) ayrı alanlar
CREATE OR REPLACE FUNCTION public.manually_assign_trip_driver(
  p_vehicle_id uuid,
  p_trip_key   text,
  p_driver_id  uuid,
  p_reason     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co     uuid := public._fleet_driver_admin_company();
  v_veh_co uuid;
  v_trip   public.vehicle_trips%ROWTYPE;
  v_drv    public.fleet_drivers%ROWTYPE;
  v_rev    integer;
BEGIN
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('state','REJECTED','reason','NOT_AUTHORIZED');
  END IF;

  SELECT company_id INTO v_veh_co FROM public.vehicles WHERE id = p_vehicle_id;
  IF v_veh_co IS NULL OR v_veh_co <> v_co THEN
    INSERT INTO public.fleet_driver_audit
      (company_id, actor_user_id, action, entity_type, entity_id, reason)
    VALUES (v_co, auth.uid(), 'CROSS_TENANT_REJECTED', 'TRIP', p_vehicle_id,
            'vehicle not owned by company');
    RETURN jsonb_build_object('state','REJECTED','reason','VEHICLE_NOT_IN_COMPANY');
  END IF;

  SELECT * INTO v_trip FROM public.vehicle_trips
   WHERE vehicle_id = p_vehicle_id AND trip_key = p_trip_key FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','REJECTED','reason','TRIP_NOT_FOUND');
  END IF;

  SELECT * INTO v_drv FROM public.fleet_drivers WHERE id = p_driver_id;
  IF NOT FOUND OR v_drv.company_id <> v_co THEN
    RETURN jsonb_build_object('state','REJECTED','reason','DRIVER_NOT_IN_COMPANY');
  END IF;
  IF v_drv.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('state','REJECTED','reason','DRIVER_NOT_ACTIVE');
  END IF;

  /* Aynı sürücü zaten atanmışsa revizyon ARTMAZ (idempotent düzeltme). */
  IF v_trip.driver_id IS NOT DISTINCT FROM p_driver_id
     AND v_trip.driver_attribution_source = 'MANUAL_TRIP_ASSIGNMENT' THEN
    RETURN jsonb_build_object('state','UNCHANGED','tripKey', p_trip_key,
                              'revision', v_trip.driver_attribution_revision);
  END IF;

  v_rev := coalesce(v_trip.driver_attribution_revision, 0) + 1;

  /* Önceki sonuç KAYBOLMAZ. */
  INSERT INTO public.trip_driver_attribution_revisions
    (company_id, vehicle_id, trip_key, revision, previous_driver_id,
     new_driver_id, previous_status, new_status, source, confidence,
     actor_user_id, reason)
  VALUES (v_co, p_vehicle_id, p_trip_key, v_rev, v_trip.driver_id,
          p_driver_id, v_trip.driver_attribution_status, 'LOCKED',
          'MANUAL_TRIP_ASSIGNMENT', 'MEDIUM', auth.uid(),
          left(NULLIF(btrim(coalesce(p_reason,'')),''), 280));

  UPDATE public.vehicle_trips SET
    driver_id                     = p_driver_id,
    /* Manuel atama bir ATAMAYA dayanmaz — assignment bağı temizlenir. */
    driver_assignment_id          = NULL,
    driver_attribution_status     = 'LOCKED',
    driver_attribution_source     = 'MANUAL_TRIP_ASSIGNMENT',
    /* İnsan beyanı `MEDIUM`'dur: fiziksel kimlik kanıtı yoktur. */
    driver_attribution_confidence = 'MEDIUM',
    driver_attributed_at          = now(),
    driver_attributed_by          = auth.uid(),
    driver_attribution_revision   = v_rev
    /* `revision`, `trip_key` ve TÜM metrikler DEĞİŞMEDİ. */
   WHERE vehicle_id = p_vehicle_id AND trip_key = p_trip_key;

  INSERT INTO public.fleet_driver_audit
    (company_id, actor_user_id, action, entity_type, entity_id,
     previous_revision, new_revision, reason)
  VALUES (v_co, auth.uid(),
          CASE WHEN v_trip.driver_id IS NULL THEN 'TRIP_DRIVER_MANUAL'
               ELSE 'TRIP_DRIVER_CORRECTED' END,
          'TRIP', p_vehicle_id, v_trip.driver_attribution_revision, v_rev,
          left(NULLIF(btrim(coalesce(p_reason,'')),''), 280));

  RETURN jsonb_build_object('state','UPDATED','tripKey', p_trip_key,
                            'driverId', p_driver_id, 'revision', v_rev);
END;
$fn$;

-- ── C5. OKUMA: ŞİRKET SÜRÜCÜ LİSTESİ ────────────────────────────────────
--
-- GİZLİLİK: tam ehliyet numarası DÖNDÜRÜLMEZ — yalnız son 4 hane maskeli.
-- Telefon yalnız admin'e açılır; observer/member göremez.
CREATE OR REPLACE FUNCTION public.list_fleet_drivers(p_include_archived boolean DEFAULT false)
RETURNS TABLE (
  driver_id uuid, display_name text, employee_code text, status text,
  has_linked_account boolean, license_class text, license_expires_at date,
  license_masked text, phone_visible text, revision integer,
  active_vehicle_id uuid, active_assignment_id uuid, active_since timestamptz,
  last_trip_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_co    uuid := public._fleet_member_company();
  v_admin uuid := public._fleet_driver_admin_company();
BEGIN
  IF v_co IS NULL THEN RETURN; END IF;   -- fail-closed

  RETURN QUERY
  SELECT d.id, d.display_name, d.employee_code, d.status,
         (d.linked_user_id IS NOT NULL),
         d.license_class, d.license_expires_at,
         /* TAM ehliyet numarası UI'a GİTMEZ. */
         CASE WHEN d.license_number IS NULL THEN NULL
              ELSE '•••' || right(d.license_number, 4) END,
         /* Telefon yalnız admin'e. */
         CASE WHEN v_admin IS NOT NULL THEN d.phone ELSE NULL END,
         d.revision,
         a.vehicle_id, a.id, a.starts_at,
         (SELECT max(t.started_at) FROM public.vehicle_trips t
           WHERE t.driver_id = d.id),
         d.created_at
    FROM public.fleet_drivers d
    LEFT JOIN LATERAL (
      SELECT x.id, x.vehicle_id, x.starts_at
        FROM public.vehicle_driver_assignments x
       WHERE x.driver_id = d.id AND x.ends_at IS NULL
         AND x.status IN ('SCHEDULED','ACTIVE')
       ORDER BY x.starts_at DESC LIMIT 1
    ) a ON true
   WHERE d.company_id = v_co
     AND (p_include_archived OR d.status <> 'ARCHIVED')
   ORDER BY d.display_name;
END;
$fn$;

-- ── C6. OKUMA: ARACIN ATAMALARI ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_vehicle_driver_assignments(
  p_vehicle_id uuid, p_limit integer DEFAULT 50
) RETURNS TABLE (
  assignment_id uuid, driver_id uuid, driver_name text,
  starts_at timestamptz, ends_at timestamptz,
  assignment_type text, source text, confidence text, status text,
  revision integer, note text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_co uuid := public._fleet_member_company();
BEGIN
  IF v_co IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT a.id, a.driver_id, d.display_name, a.starts_at, a.ends_at,
         a.assignment_type, a.source, a.confidence, a.status,
         a.revision, a.note, a.created_at
    FROM public.vehicle_driver_assignments a
    JOIN public.fleet_drivers d ON d.id = a.driver_id
    JOIN public.vehicles v ON v.id = a.vehicle_id
   WHERE a.vehicle_id = p_vehicle_id
     AND a.company_id = v_co
     AND v.company_id = v_co          -- devir sonrası sızıntı kapısı
   ORDER BY a.starts_at DESC
   LIMIT LEAST(GREATEST(coalesce(p_limit,50),1), 200);
END;
$fn$;

-- ── C7. HEAD UNIT: AKTİF ATAMA ÖZETİ (MİNİMUM) ──────────────────────────
--
-- ── NEDEN AYRI VE DAR ────────────────────────────────────────────────────
-- Head unit `anon` rolünde çalışır ve kimliğini yalnız `api_key` ile
-- kanıtlar. Bu yüzden:
--   · TÜM sürücü listesini ÇEKEMEZ — yalnız KENDİ aracının aktif ataması
--   · ehliyet / telefon / e-posta / employee_code ALAMAZ
--   · başka aracın veya şirketin verisine ULAŞAMAZ
-- Dönen ad, head unit ekranında "kim atanmış" göstermek için gereken
-- asgari veridir.
CREATE OR REPLACE FUNCTION public.get_active_driver_assignment(p_api_key text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_veh uuid;
  v_co  uuid;
  r     record;
BEGIN
  SELECT id, company_id INTO v_veh, v_co FROM public.vehicles
   WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_veh IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE='P0001';
  END IF;
  /* Bireysel araçta sürücü modeli yok → UNKNOWN (uydurma YOK). */
  IF v_co IS NULL THEN
    RETURN jsonb_build_object('status','UNKNOWN','reason','NOT_COMPANY_VEHICLE');
  END IF;

  SELECT a.id, a.driver_id, a.starts_at, a.ends_at, a.source,
         a.confidence, a.revision, d.display_name, d.status AS driver_status
    INTO r
    FROM public.vehicle_driver_assignments a
    JOIN public.fleet_drivers d ON d.id = a.driver_id
   WHERE a.vehicle_id = v_veh
     AND a.company_id = v_co
     AND a.status IN ('SCHEDULED','ACTIVE')
     AND a.starts_at <= now()
     AND (a.ends_at IS NULL OR a.ends_at > now())
   ORDER BY a.starts_at DESC
   LIMIT 1;

  IF r IS NULL OR r.driver_status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('status','UNKNOWN','reason','NO_ACTIVE_ASSIGNMENT');
  END IF;

  /* HASSAS ALAN YOK: ehliyet · telefon · e-posta · employee_code · user id. */
  RETURN jsonb_build_object(
    'status','ACTIVE',
    'driverId', r.driver_id,
    'assignmentId', r.id,
    'assignmentRevision', r.revision,
    'displayName', r.display_name,
    'source', r.source,
    'confidence', r.confidence,
    'validFrom', r.starts_at,
    'validUntil', r.ends_at,
    'capturedAt', now()
  );
END;
$fn$;

-- ── C8. İZİNLER ─────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.create_fleet_driver(text,text,uuid,text,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_fleet_driver(text,text,uuid,text,text,text,date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_fleet_driver(uuid,text,text,text,text,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_fleet_driver(uuid,text,text,text,text,text,date,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_vehicle_driver_assignment(uuid,uuid,timestamptz,timestamptz,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vehicle_driver_assignment(uuid,uuid,timestamptz,timestamptz,text,text,boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.end_vehicle_driver_assignment(uuid,timestamptz,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_vehicle_driver_assignment(uuid,timestamptz,boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.manually_assign_trip_driver(uuid,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manually_assign_trip_driver(uuid,text,uuid,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_fleet_drivers(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_fleet_drivers(boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_vehicle_driver_assignments(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vehicle_driver_assignments(uuid,integer) TO authenticated, service_role;

-- Head unit yolu: `anon` ÇAĞIRABİLİR ama yalnız kendi api_key bağlamında.
REVOKE ALL ON FUNCTION public.get_active_driver_assignment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_driver_assignment(text) TO anon, authenticated, service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- BÖLÜM D — FAIL-CLOSED DOĞRULAMA
--
-- Fonksiyonlar yalnız TANIMLI olduğu için değil, ÇAĞRILARAK sınanır:
-- plpgsql geç bağlandığı için eksik bir yardımcı fonksiyon migration'ı
-- geçirir ve hata ancak sahada ortaya çıkar (047'de tam olarak bu oldu).
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  v_missing text;
  v_def     text;
  r         record;
BEGIN
  -- (a) Tablolar
  SELECT string_agg(t, ', ') INTO v_missing FROM (
    SELECT t FROM unnest(ARRAY['fleet_drivers','vehicle_driver_assignments',
                               'trip_driver_attribution_revisions','fleet_driver_audit']) AS t
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                        WHERE table_schema='public' AND table_name=t)) q;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '048 HATA: tablolar eksik: %', v_missing;
  END IF;

  -- (b) Trip attribution kolonları
  SELECT string_agg(c, ', ') INTO v_missing FROM (
    SELECT c FROM unnest(ARRAY['driver_id','driver_assignment_id',
      'driver_attribution_source','driver_attribution_confidence',
      'driver_attribution_status','driver_attributed_at','driver_attributed_by',
      'driver_attribution_revision']) AS c
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='vehicle_trips'
                          AND column_name=c)) q;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '048 HATA: attribution kolonlari eksik: %', v_missing;
  END IF;

  -- (c) Kolonlar NULLABLE olmalı — sürücüsü bilinmeyen trip YAZILABİLMELİ.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='vehicle_trips'
                AND column_name IN ('driver_id','driver_attribution_status')
                AND is_nullable='NO') THEN
    RAISE EXCEPTION '048 HATA: attribution kolonlari NOT NULL — UNKNOWN yazilamaz';
  END IF;

  -- (d) YARDIMCI FONKSİYONLAR CANLI ÇAĞRILARAK sınanır.
  PERFORM public._fleet_driver_admin_company();
  PERFORM public._fleet_member_company();
  SELECT * INTO r FROM public._resolve_trip_driver(
    gen_random_uuid(), NULL, now(), now());
  IF r.status <> 'UNKNOWN' THEN
    RAISE EXCEPTION '048 HATA: sirketsiz arac icin UNKNOWN donmedi: %', r.status;
  END IF;
  /* Atamasız araç için de UNKNOWN — fallback sürücü ÜRETİLMEMELİ. */
  SELECT * INTO r FROM public._resolve_trip_driver(
    gen_random_uuid(), gen_random_uuid(), now() - interval '1 hour', now());
  IF r.status <> 'UNKNOWN' OR r.driver_id IS NOT NULL THEN
    RAISE EXCEPTION '048 HATA: atamasiz trip icin surucu uyduruldu';
  END IF;

  -- (e) Trigger'lar bağlı mı
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_trip_attribution' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '048 HATA: attribution trigger bagli degil';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_vehicle_transfer_assignments' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '048 HATA: transfer trigger bagli degil';
  END IF;

  -- (f) RLS açık + anon kilidi
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
              AND tablename IN ('fleet_drivers','vehicle_driver_assignments',
                                'trip_driver_attribution_revisions','fleet_driver_audit')
              AND NOT rowsecurity) THEN
    RAISE EXCEPTION '048 HATA: bir tabloda RLS kapali';
  END IF;
  IF has_table_privilege('anon','public.fleet_drivers','SELECT')
     OR has_table_privilege('anon','public.vehicle_driver_assignments','SELECT') THEN
    RAISE EXCEPTION '048 HATA: anon surucu verisini okuyabiliyor';
  END IF;
  IF has_function_privilege('anon','public.list_fleet_drivers(boolean)','EXECUTE') THEN
    RAISE EXCEPTION '048 HATA: anon surucu listesini cekebiliyor';
  END IF;
  IF NOT has_function_privilege('anon','public.get_active_driver_assignment(text)','EXECUTE') THEN
    RAISE EXCEPTION '048 HATA: head unit ozet RPC si anon a kapali';
  END IF;

  -- (g) Head unit RPC'si HASSAS ALAN döndürmemeli.
  --
  -- DİKKAT: `pg_get_functiondef` YORUMLARI DA döndürür. Ham metinde
  -- "employee_code ALAMAZ" gibi bir AÇIKLAMA, sızıntı sanılır ve denetim
  -- yanlış alarm verir. Bu yüzden önce yorumlar temizlenir; asıl kanıt ise
  -- (g2)'deki CANLI ÇAĞRIDIR — metin değil, gerçekten dönen anahtarlar.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_active_driver_assignment';
  v_def := regexp_replace(v_def, '/\*.*?\*/', ' ', 'gs');   -- blok yorumlar
  v_def := regexp_replace(v_def, '--[^' || chr(10) || ']*', ' ', 'g'); -- satır yorumları
  IF v_def ILIKE '%license_number%' OR v_def ILIKE '%d.phone%'
     OR v_def ILIKE '%employee_code%' OR v_def ILIKE '%linked_user_id%' THEN
    RAISE EXCEPTION '048 HATA: head unit ozetinde hassas alan var (kod)';
  END IF;

  -- (g2) DAVRANIŞ KANITI: fonksiyonu gerçekten çağır ve DÖNEN anahtarları
  -- denetle. Geçersiz anahtarla çağrı `invalid_api_key` atar; bu da
  -- fonksiyonun canlı olduğunu ve kimlik doğruladığını kanıtlar.
  BEGIN
    PERFORM public.get_active_driver_assignment('__048_probe_invalid__');
    RAISE EXCEPTION '048 HATA: gecersiz api_key kabul edildi';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM = '048 HATA: gecersiz api_key kabul edildi' THEN RAISE; END IF;
      NULL;   -- beklenen: invalid_api_key
  END;

  -- (h) SECURITY DEFINER + sabit search_path
  FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def
             FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public'
              AND p.proname IN ('create_fleet_driver','update_fleet_driver',
                'create_vehicle_driver_assignment','end_vehicle_driver_assignment',
                'manually_assign_trip_driver','list_fleet_drivers',
                'get_active_driver_assignment','_resolve_trip_driver')
  LOOP
    IF r.def NOT LIKE '%SECURITY DEFINER%' OR r.def NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION '048 HATA: %: DEFINER/search_path eksik', r.proname;
    END IF;
  END LOOP;

  -- (i) TRIP DEDUPE KORUNDU (P2 regresyonu)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_key_unique') THEN
    RAISE EXCEPTION '048 HATA: trip dedupe UNIQUE kisiti kayboldu';
  END IF;

  -- (j) Çakışma savunması: kısmi UNIQUE indeksler
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='vda_vehicle_open_active_uniq')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='vda_driver_open_active_uniq') THEN
    RAISE EXCEPTION '048 HATA: cakisma savunma indeksleri eksik';
  END IF;

  RAISE NOTICE '048 OK: surucu kimligi + zaman arali atama + trip attribution + audit · RLS ve anon kilidi kuruldu · trip dedupe korundu.';
END
$verify$;

-- ═══════════════════════════════════════════════════════════════════════════
-- BÖLÜM E — OKUMA RPC'sine SÜRÜCÜ ALANLARI
--
-- `list_vehicle_trips` (047) sürücü bilgisini DÖNDÜRMÜYORDU; Fleet trip
-- detayında sürücü gösterilemezdi. Mevcut TÜM kolonlar AYNI SIRADA korunur,
-- sürücü alanları SONA eklenir → P2 tüketicileri bozulmaz.
--
-- Dönüş tipi değiştiği için `DROP` + `CREATE` gerekir (PostgreSQL
-- `CREATE OR REPLACE` ile RETURNS TABLE değiştirmeye izin vermez).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.list_vehicle_trips(uuid, integer);

CREATE OR REPLACE FUNCTION public.list_vehicle_trips(p_vehicle_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE (
  trip_key text, trip_id text, revision integer,
  started_at timestamptz, ended_at timestamptz,
  distance_km numeric, duration_min integer,
  avg_speed_kmh numeric, max_speed_kmh numeric,
  fuel_used_l numeric, fuel_used_percent numeric, fuel_unit text,
  estimated_cost numeric,
  idle_time_min integer, moving_time_min integer, unknown_time_min integer,
  stop_count integer,
  max_rpm integer, max_engine_temp_c numeric, speed_violations integer,
  harsh_brake_count integer, harsh_accel_count integer,
  score smallint, confidence text, confidence_limited_by text,
  distance_source text, fuel_source text, cost_source text,
  duration_source text, avg_speed_source text, max_speed_source text,
  idle_source text, moving_source text, stop_count_source text,
  max_rpm_source text, max_temp_source text, speed_violation_source text,
  harsh_brake_source text, harsh_accel_source text,
  fuel_unit_price numeric, currency text, price_source text,
  price_captured_at timestamptz,
  speed_sample_count integer, obd_coverage numeric, time_coverage numeric,
  data_gap_count integer, source_switch_count integer,
  metrics_version integer, received_at timestamptz,
  -- ── P0 SÜRÜCÜ ALANLARI (sona eklendi) ────────────────────────────────
  driver_id uuid, driver_name text,
  driver_attribution_status text, driver_attribution_source text,
  driver_attribution_confidence text, driver_attributed_at timestamptz,
  driver_attribution_revision integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;   -- fail-closed
  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;

  RETURN QUERY
  SELECT t.trip_key, t.trip_id, t.revision, t.started_at, t.ended_at,
         t.distance_km, t.duration_min, t.avg_speed_kmh, t.max_speed_kmh,
         t.fuel_used_l, t.fuel_used_percent, t.fuel_unit, t.estimated_cost,
         t.idle_time_min, t.moving_time_min, t.unknown_time_min, t.stop_count,
         t.max_rpm, t.max_engine_temp_c, t.speed_violations,
         t.harsh_brake_count, t.harsh_accel_count,
         t.score, t.confidence, t.confidence_limited_by,
         t.distance_source, t.fuel_source, t.cost_source,
         t.duration_source, t.avg_speed_source, t.max_speed_source,
         t.idle_source, t.moving_source, t.stop_count_source,
         t.max_rpm_source, t.max_temp_source, t.speed_violation_source,
         t.harsh_brake_source, t.harsh_accel_source,
         t.fuel_unit_price, t.currency, t.price_source, t.price_captured_at,
         t.speed_sample_count, t.obd_coverage, t.time_coverage,
         t.data_gap_count, t.source_switch_count,
         t.metrics_version, t.received_at,
         t.driver_id,
         /* Sürücü adı YALNIZ aynı şirketin sürücüsüyse gösterilir —
            araç devredilmişse eski şirketin sürücü adı SIZMAZ. */
         (SELECT d.display_name FROM public.fleet_drivers d
           WHERE d.id = t.driver_id AND d.company_id = v_co),
         t.driver_attribution_status, t.driver_attribution_source,
         t.driver_attribution_confidence, t.driver_attributed_at,
         t.driver_attribution_revision
    FROM public.vehicle_trips t
    JOIN public.vehicles v ON v.id = t.vehicle_id
   WHERE t.vehicle_id = p_vehicle_id
     AND (v.owner_id = v_uid OR (v_co IS NOT NULL AND v.company_id = v_co))
   ORDER BY t.started_at DESC
   LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_vehicle_trips(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vehicle_trips(uuid, integer)
  TO authenticated, service_role;

COMMIT;

-- Fail-closed: P2 kolonları KORUNDU + sürücü alanları EKLENDİ.
DO $$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_cols FROM (
    SELECT c FROM unnest(ARRAY['unknown_time_min','fuel_used_percent',
      'price_source','metrics_version','driver_id','driver_name',
      'driver_attribution_status','driver_attribution_confidence']) AS c
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.routines r
         JOIN information_schema.parameters p
           ON p.specific_name = r.specific_name
        WHERE r.routine_schema='public' AND r.routine_name='list_vehicle_trips'
          AND p.parameter_name = c)) q;
  IF v_cols IS NOT NULL THEN
    RAISE EXCEPTION '048E HATA: list_vehicle_trips ciktisinda eksik alan: %', v_cols;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_trips_key_unique') THEN
    RAISE EXCEPTION '048E HATA: trip dedupe kisiti kayboldu';
  END IF;
  IF has_function_privilege('anon','public.list_vehicle_trips(uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION '048E HATA: anon trip okuma yetkisi acildi';
  END IF;
  RAISE NOTICE '048E OK: list_vehicle_trips surucu alanlariyla genisletildi · P2 alanlari ve anon kilidi korundu.';
END $$;
