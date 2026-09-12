-- ═══════════════════════════════════════════════════════════════════════════
-- 068  ATAMA LİSTESİ: FİLO GENELİ + `vehicle_id` DÖNÜŞÜ  (V-16/6 önkoşulu)
--
-- ── BULGU 1 — SESSİZ ÜRETİM KUSURU ────────────────────────────────────────
-- `list_vehicle_driver_assignments` gövdesi `WHERE a.vehicle_id = p_vehicle_id`
-- diyordu. SQL'de `x = NULL` **asla doğru olmaz**. Filo yönetim sayfası
-- (`dashboard/fleet/manage`) bu RPC'yi **araç kimliği VERMEDEN** çağırıyor:
--     fetchAssignments()  →  p_vehicle_id = NULL
-- Sonuç: atama listesi **HER ZAMAN BOŞ** ve bu **sessizce** oluyordu — hata
-- dönmüyor, yalnız hiç satır gelmiyordu. Yani "atama yok" ile "sorgu hiçbir
-- şeyle eşleşmiyor" ekranda AYNI görünüyordu.
--
-- DENEYLE KANITLANDI (yerel, gerçek atama eklenerek):
--     list_vehicle_driver_assignments(NULL, 50) → 0 satır
--     list_vehicle_driver_assignments(v,    50) → 1 satır
--
-- ── BULGU 2 — İSTEMCİ OLMAYAN ALANI OKUYORDU ──────────────────────────────
-- RPC `vehicle_id` DÖNDÜRMÜYORDU, ama `consoleSources.fetchAssignments`
-- `row.vehicle_id ?? ''` okuyordu → `vehicleId` her satırda BOŞ METİNDİ.
-- Bugün tüketicisi yok (bu yüzden görünmedi) ama vardiya görünümü aracı
-- bilmeden çakışma tespit EDEMEZ.
--
-- ── YAPILAN ───────────────────────────────────────────────────────────────
--   · `p_vehicle_id IS NULL` → şirketin TÜM araçları (filo geneli)
--   · dönüşe `vehicle_id` ve `vehicle_name` eklendi
--   · kapsam kapıları BİREBİR KORUNDU (`_fleet_member_company()` + çift
--     `company_id` kontrolü — devir sonrası sızıntı kapısı)
--
-- `CREATE OR REPLACE` YETMEZ: dönüş tablosu değişiyor → DROP + CREATE şart.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.list_vehicle_driver_assignments(uuid, integer);

CREATE FUNCTION public.list_vehicle_driver_assignments(
  p_vehicle_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50)
RETURNS TABLE (
  assignment_id   uuid,
  vehicle_id      uuid,
  vehicle_name    text,
  driver_id       uuid,
  driver_name     text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  assignment_type text,
  source          text,
  confidence      text,
  status          text,
  revision        integer,
  note            text,
  created_at      timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_co uuid := public._fleet_member_company();
BEGIN
  IF v_co IS NULL THEN RETURN; END IF;          -- fail-closed

  RETURN QUERY
  SELECT a.id, a.vehicle_id, v.name, a.driver_id, d.display_name,
         a.starts_at, a.ends_at,
         a.assignment_type, a.source, a.confidence, a.status,
         a.revision, a.note, a.created_at
    FROM public.vehicle_driver_assignments a
    JOIN public.fleet_drivers d ON d.id = a.driver_id
    JOIN public.vehicles v ON v.id = a.vehicle_id
   /* NULL = FİLO GENELİ. Eskiden `a.vehicle_id = NULL` yazılıydı ve bu
      koşul asla tutmadığı için liste her zaman boş dönüyordu. */
   WHERE (p_vehicle_id IS NULL OR a.vehicle_id = p_vehicle_id)
     AND a.company_id = v_co
     AND v.company_id = v_co                    -- devir sonrası sızıntı kapısı
   ORDER BY a.starts_at DESC
   LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.list_vehicle_driver_assignments(uuid, integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_vehicle_driver_assignments(uuid, integer) TO authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (fail-closed)
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE r text;
BEGIN
  SELECT pg_get_function_result(oid) INTO r
    FROM pg_proc WHERE proname = 'list_vehicle_driver_assignments';

  IF r IS NULL OR position('vehicle_id' in r) = 0 THEN
    RAISE EXCEPTION '068 DOGRULAMA: donuste vehicle_id YOK';
  END IF;

  IF has_function_privilege('anon', 'public.list_vehicle_driver_assignments(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '068 DOGRULAMA: anon atama listesini CAGIRABILIYOR';
  END IF;

  RAISE NOTICE '068 DOGRULAMA GECTI: filo geneli listeleme + vehicle_id donusu';
END
$verify$;
