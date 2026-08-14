-- Migration 015: vehicle_commands — nonce column + replay attack prevention
--
-- Amaç: Aynı nonce'lu komutun farklı bir id ile tekrar DB'ye girilmesini
--       (re-insertion / replay) veritabanı seviyesinde engelle.
--
-- Tasarım kararları:
--   • nonce TEXT NULL: Eski satırlar veya E2E olmayan komutlar etkilenmez.
--   • Partial UNIQUE index (WHERE nonce IS NOT NULL): NULL değerler birden fazla
--     kez görünebilir (eski satırlar), ancak aynı nonce yalnızca bir kez girer.
--   • (vehicle_id, nonce) çifti: Farklı araçlarda aynı nonce çakışmaz.

ALTER TABLE public.vehicle_commands
  ADD COLUMN IF NOT EXISTS nonce text;

-- DB-level replay block: (vehicle_id, nonce) pair is globally unique
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_commands_vehicle_nonce_unique
  ON public.vehicle_commands (vehicle_id, nonce)
  WHERE nonce IS NOT NULL;

COMMENT ON COLUMN public.vehicle_commands.nonce IS
  'E2E şifreli payload içindeki _nonce değeri. Replay attack önlemek için (vehicle_id, nonce) tekil olmalıdır.';
