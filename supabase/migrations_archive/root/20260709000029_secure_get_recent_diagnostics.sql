-- ─────────────────────────────────────────────────────────────────────────────
-- PR-SEC-1 — get_recent_diagnostics çapraz-tenant okuma açığını kapat
--
-- SORUN (canlı DB'de doğrulandı):
--   get_recent_diagnostics SECURITY DEFINER + GRANT EXECUTE TO authenticated idi;
--   fonksiyon gövdesinde HİÇBİR authz yoktu ve p_vehicle_id opsiyoneldi (DEFAULT NULL).
--   → Herhangi bir authenticated kullanıcı p_vehicle_id=NULL ile TÜM araçların tanı
--     olaylarını (vehicle_events) okuyabiliyordu — ticari multi-tenant üründe
--     çapraz-müşteri veri sızıntısı.
--
-- ÇÖZÜM (en güvenli ilk adım):
--   Fonksiyon gövdesine backend authz eklenir: yalnız JWT app_metadata.role='super_admin'
--   çağırabilir; değilse exception. Rol kaynağı service_role tarafından atanır ve
--   kullanıcı değiştiremez (audit_logs + superadmin_select_vehicle_events ile AYNI
--   claim deseni). super_admin, p_vehicle_id=NULL ile tümünü okumaya devam eder.
--
-- KORUNANLAR (davranış/return DEĞİŞMEZ):
--   • İmza (7 parametre + default'lar) aynı
--   • RETURNS TABLE(id, vehicle_id, type, metadata, created_at) aynı
--   • WHERE/ORDER/OFFSET/LIMIT mantığı birebir aynı
--   • SECURITY DEFINER + SET search_path='public' aynı
--   • GRANT yapısı DEĞİŞMEZ (CREATE OR REPLACE mevcut yetkileri korur)
--   • Tek fark: guard için LANGUAGE sql → plpgsql (return kümesi aynı)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_recent_diagnostics(
  p_type        text        DEFAULT NULL,
  p_vehicle_id  text        DEFAULT NULL,
  p_app_version text        DEFAULT NULL,
  p_since       timestamptz DEFAULT NULL,
  p_until       timestamptz DEFAULT NULL,
  p_limit       integer     DEFAULT 50,
  p_offset      integer     DEFAULT 0
)
RETURNS TABLE (
  id         uuid,
  vehicle_id text,
  type       text,
  metadata   jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Backend authz — yalnız super_admin. JWT app_metadata.role service_role tarafından
  -- atanır; kullanıcı forge edemez. Frontend SuperAdminGuard ile aynı claim.
  IF coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'super_admin' THEN
    RAISE EXCEPTION 'get_recent_diagnostics: yetkisiz erişim — yalnız super_admin'
      USING errcode = '42501';  -- insufficient_privilege
  END IF;

  RETURN QUERY
  SELECT e.id, e.vehicle_id::text, e.type, e.metadata, e.created_at
  FROM public.vehicle_events e
  WHERE e.type = ANY (ARRAY['support_snapshot','obd_diag','critical_error','voice_diag'])
    AND (p_type        IS NULL OR e.type = p_type)
    AND (p_vehicle_id  IS NULL OR e.vehicle_id::text = p_vehicle_id)
    AND (p_app_version IS NULL OR e.metadata->>'appVersion' = p_app_version)
    AND (p_since       IS NULL OR e.created_at >= p_since)
    AND (p_until       IS NULL OR e.created_at <= p_until)
  ORDER BY e.created_at DESC
  OFFSET GREATEST(coalesce(p_offset, 0), 0)
  LIMIT  LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END;
$function$;

-- ── Doğrulama (salt-okuma; şema değiştirmez) ─────────────────────────────────
DO $verify$
BEGIN
  -- Fonksiyon hâlâ SECURITY DEFINER mı?
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_recent_diagnostics' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'PR-SEC-1 doğrulama: get_recent_diagnostics SECURITY DEFINER değil';
  END IF;

  -- super_admin guard fonksiyon tanımında var mı?
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_recent_diagnostics'
      AND pg_get_functiondef(p.oid) LIKE '%super_admin%'
  ) THEN
    RAISE EXCEPTION 'PR-SEC-1 doğrulama: super_admin guard eklenmemiş';
  END IF;

  RAISE NOTICE 'PR-SEC-1: get_recent_diagnostics super_admin guard OK, SECURITY DEFINER OK';
END;
$verify$;
