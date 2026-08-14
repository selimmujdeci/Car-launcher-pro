-- ============================================================
-- CRM — Collective Road Memory: community events
-- Migration: 20260516000000
-- ============================================================
-- Gizlilik tasarımı:
--   • Kesin koordinat yok (geohash Level 6 ≈ 1.2km).
--   • user_id / device_id kolonu yok.
--   • session_token yalnızca metadata JSONB içinde saklı.
-- ============================================================


-- ── 1. Tablo ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.raw_community_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  geohash     TEXT        NOT NULL,          -- Level 6 (~1.2km), kesin konum yok
  type        TEXT        NOT NULL,          -- ROAD_WORK | ACCIDENT | POTHOLE | ...
  confidence  FLOAT       NOT NULL
                          CHECK (confidence >= 0.0 AND confidence <= 1.0),
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.raw_community_events IS
  'CRM: araç sensörleri ve kullanıcı bildirimleri — kişisel veri yok.';
COMMENT ON COLUMN public.raw_community_events.geohash   IS 'Geohash Level 6 — ~1.2km hassasiyet, kesin koordinat değil.';
COMMENT ON COLUMN public.raw_community_events.confidence IS '0.0–1.0: sensör güven skoru.';
COMMENT ON COLUMN public.raw_community_events.metadata  IS 'spdDeltaKmh, bumpAmplitude, source (manual), session_token vb.';


-- ── 2. İndeksler ──────────────────────────────────────────────────────────────

-- Harita bölge sorgusu: geohash prefix bazlı
CREATE INDEX IF NOT EXISTS idx_crm_geohash
  ON public.raw_community_events (geohash, created_at DESC);

-- Tip filtresi (yol çalışması, kaza vb. katman sorguları)
CREATE INDEX IF NOT EXISTS idx_crm_type_time
  ON public.raw_community_events (type, created_at DESC);

-- TTL temizlik sorgusu için
CREATE INDEX IF NOT EXISTS idx_crm_created_at
  ON public.raw_community_events (created_at);


-- ── 3. GRANT ─────────────────────────────────────────────────────────────────
-- CLAUDE.md §SUPABASE: GRANT olmadan migration göndermek yasak.

GRANT SELECT, INSERT ON public.raw_community_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_community_events TO authenticated;
GRANT ALL ON public.raw_community_events TO service_role;


-- ── 4. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.raw_community_events ENABLE ROW LEVEL SECURITY;

-- Herkes (anonim dahil) rapor gönderebilir — spam koruması metadata.session_token ile
CREATE POLICY "crm_anon_insert"
  ON public.raw_community_events
  FOR INSERT
  TO anon
  WITH CHECK (
    -- Güvenlik: NULL/boş geohash reddedilir; metadata zorunlu obje
    length(geohash) = 6
    AND metadata IS NOT NULL
  );

-- Yalnızca oturum açmış kullanıcılar okuyabilir
-- (ileride bölgesel kısıtlama eklenebilir)
CREATE POLICY "crm_authenticated_select"
  ON public.raw_community_events
  FOR SELECT
  TO authenticated
  USING (true);

-- Servis rolü tam erişim (Edge Function / admin)
CREATE POLICY "crm_service_full"
  ON public.raw_community_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ── 5. TTL — 24 saatlik otomatik silme ────────────────────────────────────────
--
-- SEÇENEK A: pg_cron (Supabase Pro plan veya self-hosted pg_cron etkin ise)
--   Dashboard → SQL Editor → pg_cron etkinleştirme:
--     CREATE EXTENSION IF NOT EXISTS pg_cron;
--     GRANT USAGE ON SCHEMA cron TO postgres;
--
-- Etkinleştirildikten sonra aşağıdaki satırı çalıştır:
/*
SELECT cron.schedule(
  'crm_ttl_cleanup',          -- job adı (idempotent)
  '0 * * * *',                -- her saat başı
  $$
    DELETE FROM public.raw_community_events
    WHERE created_at < now() - INTERVAL '24 hours';
  $$
);
*/
--
-- SEÇENEK B: Edge Function (pg_cron yoksa)
--   supabase/functions/crm_cleanup/index.ts içinde:
--     await supabase.from('raw_community_events')
--       .delete().lt('created_at', new Date(Date.now() - 86400000).toISOString());
--   Supabase Cron Jobs (Dashboard) üzerinden saatlik tetikle.
--
-- SEÇENEK C: Önerilmez — client-side cleanup. Yalnızca local kuyruk için.


-- ── 6. Doğrulama sorgusu ─────────────────────────────────────────────────────

SELECT
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'raw_community_events'
ORDER BY grantee, privilege_type;
