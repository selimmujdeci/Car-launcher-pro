-- =====================================================================
-- Migration 039: ARAÇ SAHİPLİĞİ DEVRİ (TASLAK)
--
-- ⚠️  BU MIGRATION PRODUCTION'A UYGULANMADI. Yerel/geçici PostgreSQL'de
--     doğrulanmak üzere hazırlanmıştır.
--
-- ── SAHİPLİK SÖZLEŞMESİ (tek otorite) ───────────────────────────────
--   · Sahiplik TÜRÜ ikiden biridir: INDIVIDUAL (owner_id) | COMPANY (company_id).
--   · İKİSİ AYNI ANDA aktif olamaz — kısıt ile zorlanır.
--   · `vehicle_pairings` SAHİPLİK DEĞİLDİR (erişim ilişkisidir).
--   · `vehicles.api_key` / `e2e_public_key` CİHAZ kimliğidir, sahiplik değildir.
--   · Erişim rolü sahiplik değildir.
--
-- ── PAIRING POLİTİKASI: SEÇENEK A (açıkça seçildi) ──────────────────
-- Devir tamamlandığında **eski kullanıcı eşleştirmeleri İPTAL EDİLİR**.
-- Head-unit cihaz kimliği (`api_key`, `e2e_public_key`) KORUNUR: araçtaki
-- fiziksel kurulum bozulmaz, yalnız kimin erişebildiği değişir.
-- NEDEN: sessiz devralma en tehlikeli sonuçtur — eski sahibin telefonunda
-- aracın konumu ve komut yetkisi kalmamalıdır. Cihazı yeniden kurmak
-- kullanıcıya iş çıkarır ama erişimi taşımak GÜVENLİK AÇIĞIDIR.
--
-- ── YARIŞA DAYANIKLILIK ─────────────────────────────────────────────
--   · Aynı araç için AYNI ANDA tek PENDING transfer (partial unique index).
--   · `expected_vehicle_revision` ile optimistic concurrency: araç arada
--     değiştiyse kabul FAIL-CLOSED reddedilir.
--   · Kabul tek transaction: sahiplik + pairing + transfer durumu birlikte.
--   · `idempotency_key` ile tekrar gönderim aynı transferi üretir.
-- =====================================================================

BEGIN;

-- ── 0. ÖN KOŞULLAR ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='vehicles') THEN
    RAISE EXCEPTION '039 DURDU: public.vehicles YOK';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='profiles') THEN
    RAISE EXCEPTION '039 DURDU: public.profiles YOK';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_company'
  ) THEN
    RAISE EXCEPTION '039 ÖN KONTROL: migration 035 uygulanmamış';
  END IF;
END $$;

-- ── 1. ARAÇ REVİZYONU (optimistic concurrency için) ──────────────────
-- Yeni kolon + DEFAULT → mevcut satırlar bozulmaz, veri YAZILMAZ.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.bump_vehicle_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  -- Yalnız sahiplik/kimlik alanları değişince artar; telemetri (last_seen)
  -- her saniye revizyon şişirmesin.
  IF NEW.owner_id   IS DISTINCT FROM OLD.owner_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.name     IS DISTINCT FROM OLD.name
     OR NEW.plate    IS DISTINCT FROM OLD.plate
  THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS vehicles_revision_bump ON public.vehicles;
CREATE TRIGGER vehicles_revision_bump
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.bump_vehicle_revision();

-- ── 2. SAHİPLİK TEKİLLİĞİ ────────────────────────────────────────────
-- Bir araç AYNI ANDA hem bireysel hem şirket sahipli OLAMAZ.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.vehicles'::regclass AND conname='vehicles_single_owner_type'
  ) THEN
    -- Mevcut veri ihlal ediyorsa kısıt EKLENMEZ, uyarı verilir (fail-soft):
    -- veri düzeltmesi ayrı bir karardır, migration veri YAZMAZ.
    IF EXISTS (SELECT 1 FROM public.vehicles WHERE owner_id IS NOT NULL AND company_id IS NOT NULL) THEN
      RAISE NOTICE
        '039 UYARI: hem owner_id hem company_id dolu araçlar var — '
        'vehicles_single_owner_type kısıtı EKLENMEDİ. Önce veri uzlaştırması gerekir.';
    ELSE
      ALTER TABLE public.vehicles
        ADD CONSTRAINT vehicles_single_owner_type
        CHECK (NOT (owner_id IS NOT NULL AND company_id IS NOT NULL));
    END IF;
  END IF;
END $$;

-- ── 3. TRANSFER TABLOSU ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_ownership_transfers (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id                uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  from_owner_type           text NOT NULL CHECK (from_owner_type IN ('INDIVIDUAL','COMPANY')),
  from_owner_id             uuid,
  to_owner_type             text NOT NULL CHECK (to_owner_type   IN ('INDIVIDUAL','COMPANY')),
  to_owner_id               uuid NOT NULL,
  requested_by              uuid NOT NULL REFERENCES auth.users(id),
  status                    text NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING','ACCEPTED','REJECTED','CANCELLED','EXPIRED','COMPLETED','FAILED')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  expires_at                timestamptz NOT NULL,
  accepted_at               timestamptz,
  rejected_at               timestamptz,
  cancelled_at              timestamptz,
  completed_at              timestamptz,
  idempotency_key           text NOT NULL,
  expected_vehicle_revision bigint NOT NULL,
  failure_code              text
);

-- Aynı araç için AYNI ANDA tek aktif transfer (yarış koruması).
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_transfers_one_active
  ON public.vehicle_ownership_transfers (vehicle_id)
  WHERE status = 'PENDING';

-- Aynı istek iki kez gönderilirse aynı transfer (idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_transfers_idempotency
  ON public.vehicle_ownership_transfers (idempotency_key);

CREATE INDEX IF NOT EXISTS vehicle_transfers_to_owner
  ON public.vehicle_ownership_transfers (to_owner_type, to_owner_id, status);
CREATE INDEX IF NOT EXISTS vehicle_transfers_expiry
  ON public.vehicle_ownership_transfers (expires_at) WHERE status = 'PENDING';

ALTER TABLE public.vehicle_ownership_transfers ENABLE ROW LEVEL SECURITY;

-- İstemci DOĞRUDAN yazamaz; okuma yalnız taraflara açıktır.
REVOKE ALL ON public.vehicle_ownership_transfers FROM anon, PUBLIC;
GRANT SELECT ON public.vehicle_ownership_transfers TO authenticated;
GRANT ALL    ON public.vehicle_ownership_transfers TO service_role;

DROP POLICY IF EXISTS transfers_party_read ON public.vehicle_ownership_transfers;
CREATE POLICY transfers_party_read ON public.vehicle_ownership_transfers
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR (to_owner_type = 'INDIVIDUAL' AND to_owner_id = auth.uid())
    OR (to_owner_type = 'COMPANY'
        AND to_owner_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()))
    OR (from_owner_type = 'COMPANY'
        AND from_owner_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()))
  );

-- ── 4. YARDIMCI: çağıranın araç üzerindeki devir yetkisi ─────────────
CREATE OR REPLACE FUNCTION public.can_transfer_vehicle(p_vehicle_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_co    uuid;
  v_myco  uuid;
  v_myrole text;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT owner_id, company_id INTO v_owner, v_co FROM public.vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Bireysel sahip kendi aracını devredebilir.
  IF v_owner IS NOT NULL AND v_owner = v_uid THEN RETURN true; END IF;

  -- Şirket aracını YALNIZ o şirketin admini devredebilir.
  IF v_co IS NOT NULL THEN
    SELECT company_id, role INTO v_myco, v_myrole FROM public.profiles WHERE id = v_uid;
    RETURN v_myco IS NOT NULL AND v_myco = v_co AND v_myrole = 'admin';
  END IF;

  RETURN false;
END;
$fn$;

-- ── 5. DEVİR BAŞLAT ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_vehicle_transfer(
  p_vehicle_id        uuid,
  p_to_owner_type     text,
  p_to_owner_id       uuid,
  p_idempotency_key   text,
  p_expected_revision bigint,
  p_ttl_minutes       int DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_owner    uuid;
  v_co       uuid;
  v_revision bigint;
  v_from_type text;
  v_from_id   uuid;
  v_existing uuid;
  v_id       uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;

  IF p_to_owner_type NOT IN ('INDIVIDUAL','COMPANY') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='P0001';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='P0001';
  END IF;

  -- İDEMPOTENCY: aynı anahtar daha önce kullanıldıysa AYNI transfer döner.
  SELECT id INTO v_existing FROM public.vehicle_ownership_transfers
   WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_existing; END IF;

  IF NOT public.can_transfer_vehicle(p_vehicle_id) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0001';
  END IF;

  -- Süresi dolmuş PENDING kayıtları burada temizlenir. Bu transaction başarıyla
  -- COMMIT olacağı için işaretleme KALICIDIR (kabul yolundan farklı olarak).
  -- Aksi hâlde ölü bir PENDING kayıt aktif-transfer tekillik indeksini süresiz
  -- bloke eder ve araç bir daha DEVREDİLEMEZDİ.
  UPDATE public.vehicle_ownership_transfers
     SET status='EXPIRED', failure_code='TRANSFER_EXPIRED'
   WHERE vehicle_id = p_vehicle_id AND status='PENDING' AND expires_at <= now();

  SELECT owner_id, company_id, revision INTO v_owner, v_co, v_revision
    FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0001'; END IF;

  -- Optimistic concurrency: araç arada değiştiyse FAIL-CLOSED.
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_client_revision' USING ERRCODE='P0001';
  END IF;

  IF v_co IS NOT NULL THEN v_from_type := 'COMPANY'; v_from_id := v_co;
  ELSE                     v_from_type := 'INDIVIDUAL'; v_from_id := v_owner; END IF;

  -- Kendine devir anlamsızdır.
  IF v_from_type = p_to_owner_type AND v_from_id IS NOT DISTINCT FROM p_to_owner_id THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='P0001';
  END IF;

  -- Hedef GERÇEKTEN var olmalı.
  IF p_to_owner_type = 'INDIVIDUAL' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to_owner_id) THEN
      RAISE EXCEPTION 'target_user_not_found' USING ERRCODE='P0001';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_to_owner_id) THEN
      RAISE EXCEPTION 'target_user_not_found' USING ERRCODE='P0001';
    END IF;
  END IF;

  INSERT INTO public.vehicle_ownership_transfers (
    vehicle_id, from_owner_type, from_owner_id, to_owner_type, to_owner_id,
    requested_by, expires_at, idempotency_key, expected_vehicle_revision
  ) VALUES (
    p_vehicle_id, v_from_type, v_from_id, p_to_owner_type, p_to_owner_id,
    v_uid, now() + make_interval(mins => GREATEST(p_ttl_minutes, 1)),
    p_idempotency_key, p_expected_revision
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    -- Aynı araç için başka aktif transfer var (yarış).
    RAISE EXCEPTION 'duplicate_operation' USING ERRCODE='P0001';
END;
$fn$;

-- ── 6. DEVİR KABUL (tek transaction) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_vehicle_transfer(p_transfer_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_t   record;
  v_revision bigint;
  v_myco  uuid;
  v_myrole text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_t FROM public.vehicle_ownership_transfers
   WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0001'; END IF;

  -- İDEMPOTENT KABUL: zaten tamamlanmışsa tekrar uygulanmaz, hata da verilmez.
  IF v_t.status = 'COMPLETED' THEN RETURN true; END IF;
  IF v_t.status <> 'PENDING' THEN
    RAISE EXCEPTION 'duplicate_operation' USING ERRCODE='P0001';
  END IF;

  -- ⚠️ Burada durum GÜNCELLENMEZ: `RAISE EXCEPTION` bu transaction'ı geri alır,
  -- dolayısıyla aynı blokta yazılan `status='EXPIRED'` de geri alınırdı ve
  -- transfer PENDING kalırdı (ölçüldü: transfer matrisi C3). PENDING kalan
  -- süresi dolmuş kayıt, aktif-transfer tekillik indeksini bloke edip aracın
  -- YENİ devir açmasını engelliyordu. Temizlik iki yerde yapılır:
  --   · `start_vehicle_transfer` — yeni devir açılırken (aynı transaction, commit olur)
  --   · `expire_vehicle_transfers()` — periyodik bakım
  IF v_t.expires_at <= now() THEN
    RAISE EXCEPTION 'pairing_code_expired' USING ERRCODE='P0001';
  END IF;

  -- KABUL YETKİSİ: bireysel hedefte hedefin kendisi; şirket hedefinde admin.
  IF v_t.to_owner_type = 'INDIVIDUAL' THEN
    IF v_t.to_owner_id <> v_uid THEN
      RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0001';
    END IF;
  ELSE
    SELECT company_id, role INTO v_myco, v_myrole FROM public.profiles WHERE id = v_uid;
    IF v_myco IS DISTINCT FROM v_t.to_owner_id OR v_myrole <> 'admin' THEN
      RAISE EXCEPTION 'not_company_admin' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- Araç arada değiştiyse devir UYGULANMAZ (fail-closed).
  -- ⚠️ Bu dalların hiçbirinde durum YAZILMAZ. `RAISE EXCEPTION` aynı
  -- transaction'ı geri aldığı için yazılan `status='FAILED'` de geri alınır —
  -- yazmak sahte bir güven verir, kayıt yine PENDING kalır (ölçüldü: D3).
  --
  -- Ürün açısından da DOĞRUSU budur: araç arada değiştiyse devir KALICI olarak
  -- ölmemeli. Kayıt PENDING kalır; gönderen güncel revizyonla iptal edip
  -- yeniden başlatabilir ya da süre dolunca bakım fonksiyonu EXPIRED yapar.
  -- `FAILED` durumu yalnız sunucu tarafı bakım/servis yollarınca yazılır.
  SELECT revision INTO v_revision FROM public.vehicles WHERE id = v_t.vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0001';
  END IF;
  IF v_revision <> v_t.expected_vehicle_revision THEN
    RAISE EXCEPTION 'stale_client_revision' USING ERRCODE='P0001';
  END IF;

  -- ── SAHİPLİK DEVRİ ─────────────────────────────────────────────────
  IF v_t.to_owner_type = 'INDIVIDUAL' THEN
    UPDATE public.vehicles SET owner_id = v_t.to_owner_id, company_id = NULL
     WHERE id = v_t.vehicle_id;
  ELSE
    UPDATE public.vehicles SET company_id = v_t.to_owner_id, owner_id = NULL
     WHERE id = v_t.vehicle_id;
  END IF;

  -- ── ESKİ ERİŞİM İPTALİ (pairing politikası A) ──────────────────────
  -- Eski sahibin telefonunda konum/komut yetkisi KALMAZ.
  DELETE FROM public.vehicle_pairings WHERE vehicle_id = v_t.vehicle_id;

  -- Yeni bireysel sahibe eşleştirme kurulur (şirket hedefinde üyelik yeterli).
  IF v_t.to_owner_type = 'INDIVIDUAL' THEN
    INSERT INTO public.vehicle_pairings (vehicle_id, user_id, role)
    VALUES (v_t.vehicle_id, v_t.to_owner_id, 'owner')
    ON CONFLICT (vehicle_id, user_id) DO NOTHING;
  END IF;

  -- ── BEKLEYEN KOMUTLAR ──────────────────────────────────────────────
  -- Eski sahibin gönderdiği, henüz araca ulaşmamış komutlar İPTAL EDİLİR.
  UPDATE public.vehicle_commands
     SET status = 'expired'
   WHERE vehicle_id = v_t.vehicle_id AND status = 'pending';

  -- Kullanılmamış eşleştirme kodları geçersizleşir.
  UPDATE public.vehicle_linking_codes
     SET used_at = now()
   WHERE vehicle_id = v_t.vehicle_id AND used_at IS NULL;

  UPDATE public.vehicle_ownership_transfers
     SET status='COMPLETED', accepted_at=now(), completed_at=now(), failure_code=NULL
   WHERE id = p_transfer_id;

  RETURN true;
END;
$fn$;

-- ── 7. RET / İPTAL ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_vehicle_transfer(p_transfer_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_t   record;
  v_myco uuid;
  v_myrole text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_t FROM public.vehicle_ownership_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0001'; END IF;
  IF v_t.status <> 'PENDING' THEN RAISE EXCEPTION 'duplicate_operation' USING ERRCODE='P0001'; END IF;

  IF v_t.to_owner_type = 'INDIVIDUAL' THEN
    IF v_t.to_owner_id <> v_uid THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0001'; END IF;
  ELSE
    SELECT company_id, role INTO v_myco, v_myrole FROM public.profiles WHERE id=v_uid;
    IF v_myco IS DISTINCT FROM v_t.to_owner_id OR v_myrole <> 'admin' THEN
      RAISE EXCEPTION 'not_company_admin' USING ERRCODE='P0001';
    END IF;
  END IF;

  UPDATE public.vehicle_ownership_transfers
     SET status='REJECTED', rejected_at=now() WHERE id=p_transfer_id;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_vehicle_transfer(p_transfer_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_t   record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_t FROM public.vehicle_ownership_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0001'; END IF;
  IF v_t.status <> 'PENDING' THEN RAISE EXCEPTION 'duplicate_operation' USING ERRCODE='P0001'; END IF;

  -- İptal YALNIZ gönderen tarafın yetkisidir (hâlâ devretmeye yetkili olmalı).
  IF v_t.requested_by <> v_uid AND NOT public.can_transfer_vehicle(v_t.vehicle_id) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0001';
  END IF;

  UPDATE public.vehicle_ownership_transfers
     SET status='CANCELLED', cancelled_at=now() WHERE id=p_transfer_id;
  RETURN true;
END;
$fn$;

-- ── 8. OKUMA ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_vehicle_transfers()
RETURNS TABLE (
  id uuid, vehicle_id uuid, from_owner_type text, to_owner_type text,
  status text, created_at timestamptz, expires_at timestamptz, failure_code text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_co  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0001'; END IF;
  SELECT company_id INTO v_co FROM public.profiles WHERE id = v_uid;

  RETURN QUERY
    SELECT t.id, t.vehicle_id, t.from_owner_type, t.to_owner_type,
           t.status, t.created_at, t.expires_at, t.failure_code
      FROM public.vehicle_ownership_transfers t
     WHERE t.requested_by = v_uid
        OR (t.to_owner_type='INDIVIDUAL' AND t.to_owner_id = v_uid)
        OR (t.to_owner_type='COMPANY'    AND v_co IS NOT NULL AND t.to_owner_id = v_co)
        OR (t.from_owner_type='COMPANY'  AND v_co IS NOT NULL AND t.from_owner_id = v_co)
     ORDER BY t.created_at DESC
     LIMIT 100;   -- BOUNDED
END;
$fn$;

-- ── 9. SÜRESİ DOLANLARI İŞARETLE (bakım) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_vehicle_transfers()
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_count int;
BEGIN
  UPDATE public.vehicle_ownership_transfers
     SET status='EXPIRED', failure_code='TRANSFER_EXPIRED'
   WHERE status='PENDING' AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

-- ── 10. GRANT ────────────────────────────────────────────────────────
-- Hepsi kimliği `auth.uid()`'den alır → authenticated'a açılır; anon ASLA.
REVOKE ALL ON FUNCTION public.can_transfer_vehicle(uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_vehicle_transfer(uuid,text,uuid,text,bigint,int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_vehicle_transfer(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_vehicle_transfer(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_vehicle_transfer(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_vehicle_transfers()                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_vehicle_transfers()                       FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.can_transfer_vehicle(uuid)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_vehicle_transfer(uuid,text,uuid,text,bigint,int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_vehicle_transfer(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_vehicle_transfer(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_vehicle_transfer(uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_vehicle_transfers()                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_vehicle_transfers()                       TO service_role;

-- ── 11. DOĞRULAMA (fail-closed) ──────────────────────────────────────
DO $$
DECLARE
  v_leak int;
  v_idx  int;
BEGIN
  SELECT count(*) INTO v_leak
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('start_vehicle_transfer','accept_vehicle_transfer',
                      'reject_vehicle_transfer','cancel_vehicle_transfer',
                      'list_vehicle_transfers','expire_vehicle_transfers')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('public', p.oid, 'EXECUTE'));
  IF v_leak > 0 THEN
    RAISE EXCEPTION '039 DOĞRULAMA DÜŞTÜ: % transfer fonksiyonunda anon/PUBLIC EXECUTE var', v_leak;
  END IF;

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname='public' AND indexname='vehicle_transfers_one_active';
  IF v_idx <> 1 THEN
    RAISE EXCEPTION '039 DOĞRULAMA DÜŞTÜ: aktif-transfer tekillik indeksi YOK (yarış korumasız)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='accept_vehicle_transfer'
      AND p.proconfig IS NOT NULL
      AND array_to_string(p.proconfig,',') ILIKE '%search_path%'
  ) THEN
    RAISE EXCEPTION '039 DOĞRULAMA DÜŞTÜ: accept_vehicle_transfer sabit search_path taşımıyor';
  END IF;

  RAISE NOTICE '039 OK: sahiplik devri kuruldu (tek aktif transfer + revizyon kapısı + anon kapalı).';
END $$;

COMMIT;

-- =====================================================================
-- FORWARD-FIX NOTU (rollback yerine):
-- Bu migration YENİ tablo ve YENİ kolon ekler; mevcut veriyi DEĞİŞTİRMEZ.
-- Geri almak yerine ileri düzeltme tercih edilir:
--   · Transfer akışı kapatılacaksa: fonksiyonların EXECUTE yetkisini
--     `authenticated`'tan geri alın (tablo ve veri KORUNUR, denetim izi kalır).
--   · `vehicles.revision` kolonu bırakılır — düşürmek diğer optimistic
--     concurrency tüketicilerini kırar.
-- Tam geri alma gerekiyorsa (veri kaybı riski KABUL EDİLEREK):
--   DROP TABLE public.vehicle_ownership_transfers;  -- denetim izi SİLİNİR
-- =====================================================================
