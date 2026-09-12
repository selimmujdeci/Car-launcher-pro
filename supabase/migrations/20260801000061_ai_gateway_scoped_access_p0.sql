-- ═══════════════════════════════════════════════════════════════════════════
-- 061 · AI GATEWAY — KAPSAMLI (SCOPED) ERİŞİM + DENETİM
--
-- ── NEDEN BU MIGRATION VAR ───────────────────────────────────────────────
-- AI Gateway bugün TEK bir global bayrağa bakıyor: `public.feature_flags`
-- (`mavi_ai_gateway`). O tablonun **şirket kapsamı YOKTUR** ve `anon` için
-- `USING(true)` ile okunur. Yani oradan açmak, AI zincirini **dünyadaki her
-- cihazda aynı anda** açar. Görev şartı bunu açıkça yasaklıyor:
-- "tenant veya cihaz kapsamı açık olmalı · yanlışlıkla global açılmamalı".
--
-- Bu migration global bayrağı KALDIRMAZ — onu **ana şalter** olarak bırakır ve
-- üstüne KAPSAM ekler:
--
--     ETKİN = global_kill_switch(mavi_ai_gateway)  VE  şirket/araç izni
--
-- İkisinden biri kapalıysa kapı KAPALIDIR (fail-closed). Global bayrak artık
-- "aç" değil, "izin verilenlere aç" anlamına gelir; tek başına kimseyi açmaz.
--
-- ── YENİ KARAR MOTORU YOK ────────────────────────────────────────────────
-- Bu tablo bir karar/kanıt/güven otoritesi DEĞİLDİR. Yalnız ERİŞİM İZNİDİR.
-- AI Evidence ve MAVI Reasoning tek otorite olarak KALIR.
--
-- ── "AÇIK" ≠ "HAZIR" ─────────────────────────────────────────────────────
-- Bu tablo yalnız İZNİ söyler. Sağlayıcı anahtarı (LLM key) olmadan sistem
-- HAZIR değildir; hazırlık istemci tarafında ayrı ölçülür ve bu iki durum
-- LAB'da AYRI gösterilir.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · ERİŞİM TABLOSU ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_gateway_access (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  /* NULL = şirketin TÜM araçları; dolu = YALNIZ o araç (kademeli açılış). */
  vehicle_id  uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,

  enabled     boolean NOT NULL DEFAULT false,

  /* Denetim — kim, ne zaman, neden. */
  granted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  reason      text,

  CONSTRAINT aga_reason_len CHECK (reason IS NULL OR length(reason) <= 200),
  /* Kapalı kayıt bir "iptal"dir; iptal edenin damgası olmalı. */
  CONSTRAINT aga_revoke_stamped CHECK (
    enabled = true OR revoked_at IS NOT NULL OR granted_at IS NOT NULL)
);

/* Aynı kapsam İKİ KEZ açılmaz (şirket geneli ve araç-özel ayrı satırlardır). */
CREATE UNIQUE INDEX IF NOT EXISTS aga_scope_unique
  ON public.ai_gateway_access (
    company_id,
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS aga_company_idx ON public.ai_gateway_access (company_id);

-- ── 2 · DENETİM KÜTÜĞÜ (append-only) ───────────────────────────────────
--
-- Erişim tablosu güncellenir; kütük ASLA güncellenmez. "Kim ne zaman açtı"
-- sorusunun cevabı sonradan değiştirilemez olmalıdır.
CREATE TABLE IF NOT EXISTS public.ai_gateway_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  vehicle_id  uuid,
  action      text NOT NULL,
  actor_id    uuid,
  actor_role  text,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aga_audit_action_valid CHECK (action IN ('GRANT','REVOKE','DENIED'))
);

CREATE INDEX IF NOT EXISTS aga_audit_company_idx
  ON public.ai_gateway_audit (company_id, created_at DESC);

-- ── 3 · RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.ai_gateway_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_gateway_audit  ENABLE ROW LEVEL SECURITY;

/* Doğrudan tablo erişimi YOKTUR — her şey SECURITY DEFINER RPC üzerinden.
   Politika yazılmaz; RLS açık + policy yok = fail-closed (kimse okuyamaz). */

-- ── 4 · İZİN OKUMA (etkin mi?) ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_ai_gateway_access();

/**
 * Oturum sahibinin şirketi için AI Gateway erişim durumu.
 *
 * `effective` = global ana şalter VE şirket/araç izni. Biri kapalıysa false.
 * Ana şalterin kendisi de AYRI döner ki LAB "neden kapalı" sorusunu
 * yanıtlayabilsin (izin mi yok, ana şalter mi kapalı).
 */
CREATE OR REPLACE FUNCTION public.get_ai_gateway_access()
RETURNS TABLE (
  company_id      uuid,
  kill_switch_on  boolean,
  company_granted boolean,
  vehicle_grant_count integer,
  effective       boolean,
  granted_at      timestamptz,
  reason          text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid; v_kill boolean; v_grant boolean;
        v_vcount integer; v_at timestamptz; v_reason text;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;                        -- fail-closed
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  /* Ana şalter — yoksa KAPALI (kayıt yokluğu "açık" demek DEĞİLDİR). */
  SELECT coalesce(f.enabled, false) INTO v_kill
    FROM public.feature_flags f WHERE f.key = 'mavi_ai_gateway';
  v_kill := coalesce(v_kill, false);

  SELECT a.enabled, a.granted_at, a.reason INTO v_grant, v_at, v_reason
    FROM public.ai_gateway_access a
   WHERE a.company_id = v_co AND a.vehicle_id IS NULL;
  v_grant := coalesce(v_grant, false);

  SELECT count(*)::int INTO v_vcount
    FROM public.ai_gateway_access a
   WHERE a.company_id = v_co AND a.vehicle_id IS NOT NULL AND a.enabled = true;

  RETURN QUERY SELECT
    v_co, v_kill, v_grant, coalesce(v_vcount, 0),
    (v_kill AND (v_grant OR coalesce(v_vcount, 0) > 0)),
    v_at, v_reason;
END;
$fn$;

-- ── 5 · İZİN YAZMA (YALNIZ YETKİLİ ADMIN) ──────────────────────────────
DROP FUNCTION IF EXISTS public.set_ai_gateway_access(boolean, uuid, text);

/**
 * AI Gateway iznini açar/kapatır.
 *
 * YETKİ: yalnız kendi şirketinin `owner`/`admin` rolü. Başka rol veya başka
 * şirket denerse `DENIED` döner ve bu deneme DENETİM KÜTÜĞÜNE yazılır
 * (sessiz ret YOK — reddedilen deneme de bir olaydır).
 *
 * Kapsam: `p_vehicle_id` NULL ise ŞİRKET GENELİ, dolu ise YALNIZ o araç.
 * Böylece kademeli açılış (önce tek araç) mümkündür.
 */
CREATE OR REPLACE FUNCTION public.set_ai_gateway_access(
  p_enabled boolean,
  p_vehicle_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_co uuid; v_role text;
BEGIN
  IF v_uid IS NULL THEN RETURN 'DENIED_NO_SESSION'; END IF;

  SELECT p.company_id, p.role INTO v_co, v_role
    FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN 'DENIED_NO_COMPANY'; END IF;

  /* Rol kapısı — fail-closed: tanınmayan rol REDDEDİLİR.
     ⚠️ `profiles.role` ALANI ÖLÇÜLDÜ (2026-08-01): yalnız
     `admin` · `member` · `individual` değerlerini alır — **`owner` YOKTUR**
     (bkz. migration 035 `profiles_role_check`). Bu yüzden burada 'owner'
     yazmak ÖLÜ BİR DAL olurdu; tek yetkili rol `admin`tir. */
  IF v_role IS NULL OR v_role <> 'admin' THEN
    INSERT INTO public.ai_gateway_audit (company_id, vehicle_id, action, actor_id, actor_role, reason)
    VALUES (v_co, p_vehicle_id, 'DENIED', v_uid, v_role, 'insufficient_role');
    RETURN 'DENIED_ROLE';
  END IF;

  /* Araç kapsamı istendiyse araç GERÇEKTEN bu şirkete ait olmalı. */
  IF p_vehicle_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.vehicles v
                      WHERE v.id = p_vehicle_id AND v.company_id = v_co) THEN
    INSERT INTO public.ai_gateway_audit (company_id, vehicle_id, action, actor_id, actor_role, reason)
    VALUES (v_co, p_vehicle_id, 'DENIED', v_uid, v_role, 'vehicle_not_in_company');
    RETURN 'DENIED_VEHICLE_SCOPE';
  END IF;

  INSERT INTO public.ai_gateway_access AS a
    (company_id, vehicle_id, enabled, granted_by, granted_at, reason)
  VALUES (v_co, p_vehicle_id, p_enabled, v_uid, now(), left(coalesce(p_reason,''), 200))
  ON CONFLICT (company_id, coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    enabled    = EXCLUDED.enabled,
    reason     = EXCLUDED.reason,
    granted_by = CASE WHEN EXCLUDED.enabled THEN EXCLUDED.granted_by ELSE a.granted_by END,
    granted_at = CASE WHEN EXCLUDED.enabled THEN now() ELSE a.granted_at END,
    revoked_by = CASE WHEN EXCLUDED.enabled THEN NULL ELSE EXCLUDED.granted_by END,
    revoked_at = CASE WHEN EXCLUDED.enabled THEN NULL ELSE now() END;

  INSERT INTO public.ai_gateway_audit (company_id, vehicle_id, action, actor_id, actor_role, reason)
  VALUES (v_co, p_vehicle_id, CASE WHEN p_enabled THEN 'GRANT' ELSE 'REVOKE' END,
          v_uid, v_role, left(coalesce(p_reason,''), 200));

  RETURN CASE WHEN p_enabled THEN 'GRANTED' ELSE 'REVOKED' END;
END;
$fn$;

-- ── 6 · DENETİM OKUMA ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_ai_gateway_audit(integer);

/** Son erişim olayları — şirket kapsamlı, salt-okunur. */
CREATE OR REPLACE FUNCTION public.get_ai_gateway_audit(p_limit integer DEFAULT 20)
RETURNS TABLE (
  action text, actor_role text, vehicle_id uuid,
  reason text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT p.company_id INTO v_co FROM public.profiles p WHERE p.id = v_uid;
  IF v_co IS NULL THEN RETURN; END IF;

  /* actor_id BİLİNÇLİ olarak DÖNDÜRÜLMEZ — rol yeterli, kimlik gizli. */
  RETURN QUERY
  SELECT g.action, g.actor_role, g.vehicle_id, g.reason, g.created_at
    FROM public.ai_gateway_audit g
   WHERE g.company_id = v_co
   ORDER BY g.created_at DESC
   LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
END;
$fn$;

-- ── 7 · İZİNLER ────────────────────────────────────────────────────────
--
-- `anon` HİÇBİR erişim ALMAZ: AI erişim izni oturum gerektirir. Head unit
-- anon anahtarla bu kapıyı AÇAMAZ ve OKUYAMAZ.
REVOKE ALL ON public.ai_gateway_access FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_gateway_audit  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_gateway_access TO service_role;
GRANT ALL ON public.ai_gateway_audit  TO service_role;

REVOKE ALL ON FUNCTION public.get_ai_gateway_access()                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ai_gateway_access(boolean, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ai_gateway_audit(integer)              FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_ai_gateway_access()                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_ai_gateway_access(boolean, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_gateway_audit(integer)              TO authenticated, service_role;

COMMENT ON TABLE public.ai_gateway_access IS
  'AI Gateway KAPSAMLI erişim izni. Karar/kanıt otoritesi DEĞİL — yalnız izin. Etkin = global kill-switch VE bu izin.';
COMMENT ON TABLE public.ai_gateway_audit IS
  'AI Gateway erişim denetimi (append-only). Reddedilen denemeler de yazılır.';
