-- Migration 005: vehicle_commands — Remote command queue (phone → vehicle)
-- Commands arrive as 'pending', vehicle polls and sets 'executed' or 'failed'.

CREATE TABLE IF NOT EXISTS public.vehicle_commands (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid        NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users (id)       ON DELETE CASCADE,
  type        text        NOT NULL CHECK (type IN ('lock', 'unlock', 'navigate', 'honk', 'alarm')),
  payload     jsonb       NOT NULL DEFAULT '{}',
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

CREATE INDEX IF NOT EXISTS vehicle_commands_vehicle_idx ON public.vehicle_commands (vehicle_id, status, created_at DESC);

-- Realtime: vehicle polls for its own pending commands
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_commands;

ALTER TABLE public.vehicle_commands ENABLE ROW LEVEL SECURITY;

-- User can INSERT commands only for vehicles they're linked to
CREATE POLICY "user_insert_commands"
  ON public.vehicle_commands FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND vehicle_id IN (
      SELECT vehicle_id FROM public.vehicle_users WHERE user_id = auth.uid()
    )
  );

-- User can SELECT their own commands
CREATE POLICY "user_select_commands"
  ON public.vehicle_commands FOR SELECT
  USING (user_id = auth.uid());
