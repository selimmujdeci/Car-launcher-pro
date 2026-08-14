-- ============================================================================
-- local_063_fixture.sql — Migration 063 doğrulaması için MİNİMAL şema.
--
-- Amaç: `vehicle_commands` tablosunu 063 ÖNCESİ haline (005 + 010) getirmek,
-- böylece 063'ün gerçekten ne değiştirdiği gerçek PostgreSQL'de ölçülebilsin.
--
-- Fixture yabancı anahtarları BİLEREK kurmaz (vehicles/auth.users zinciri bu
-- doğrulamanın konusu değildir) — ölçülen tek şey CHECK kısıtı ve kolon
-- varlığıdır. Yapı, ölçülen davranış açısından üretimle AYNIDIR.
-- ============================================================================

DROP TABLE IF EXISTS public.vehicle_commands CASCADE;

-- ── 005'in gövdesi (FK'lar hariç) ───────────────────────────────────────────
CREATE TABLE public.vehicle_commands (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid        NOT NULL,
  user_id     uuid,
  type        text        NOT NULL CHECK (type IN ('lock', 'unlock', 'navigate', 'honk', 'alarm')),
  payload     jsonb       NOT NULL DEFAULT '{}',
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

-- ── 008: set_style eklemesi ─────────────────────────────────────────────────
ALTER TABLE public.vehicle_commands DROP CONSTRAINT IF EXISTS vehicle_commands_type_check;
ALTER TABLE public.vehicle_commands
  ADD CONSTRAINT vehicle_commands_type_check
  CHECK (type IN ('lock', 'unlock', 'navigate', 'honk', 'alarm', 'set_style'));

-- ── 010: status 7 değer · type 9 değer · güvenilirlik kolonları ────────────
ALTER TABLE public.vehicle_commands DROP CONSTRAINT IF EXISTS vehicle_commands_status_check;
ALTER TABLE public.vehicle_commands
  ADD CONSTRAINT vehicle_commands_status_check
  CHECK (status IN ('pending','accepted','executing','completed','failed','expired','rejected'));

ALTER TABLE public.vehicle_commands DROP CONSTRAINT IF EXISTS vehicle_commands_type_check;
ALTER TABLE public.vehicle_commands
  ADD CONSTRAINT vehicle_commands_type_check
  CHECK (type IN (
    'lock','unlock','horn','alarm_on','alarm_off',
    'lights_on','route_send','navigation_start','theme_change'
  ));

ALTER TABLE public.vehicle_commands
  ADD COLUMN IF NOT EXISTS nonce            text,
  ADD COLUMN IF NOT EXISTS ttl              timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count      int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at  timestamptz,
  ADD COLUMN IF NOT EXISTS error_reason     text,
  ADD COLUMN IF NOT EXISTS accepted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at      timestamptz;
