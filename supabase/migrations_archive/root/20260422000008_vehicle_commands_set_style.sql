-- Migration 008: Add 'set_style' to vehicle_commands.type CHECK constraint
-- Depends on: 20260422000005_vehicle_commands.sql

-- Drop old constraint, add extended one including set_style
ALTER TABLE public.vehicle_commands
  DROP CONSTRAINT IF EXISTS vehicle_commands_type_check;

ALTER TABLE public.vehicle_commands
  ADD CONSTRAINT vehicle_commands_type_check
  CHECK (type IN ('lock', 'unlock', 'navigate', 'honk', 'alarm', 'set_style'));
