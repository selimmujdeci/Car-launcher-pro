-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010: Command Reliability — retry, backoff, full lifecycle
-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes:
--   1. status CHECK: 3 değer → 7 değer (kod ile eşleştirildi)
--   2. type   CHECK: 5 değer → 9 değer (kod ile eşleştirildi)
--   3. Yeni kolonlar: retry_count, last_attempt_at, error_reason,
--                     accepted_at, finished_at, nonce, ttl
--   4. RLS: araç kendi komutlarını UPDATE edebilir (status güncellemesi için)
--   5. Timeout fn: 15s içinde executing'e geçmemiş komutları 'failed' yapar
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Status constraint genişletme ──────────────────────────────────────────

ALTER TABLE public.vehicle_commands
  DROP CONSTRAINT IF EXISTS vehicle_commands_status_check;

ALTER TABLE public.vehicle_commands
  ADD CONSTRAINT vehicle_commands_status_check
  CHECK (status IN ('pending','accepted','executing','completed','failed','expired','rejected'));

-- ── 2. Type constraint genişletme ────────────────────────────────────────────

ALTER TABLE public.vehicle_commands
  DROP CONSTRAINT IF EXISTS vehicle_commands_type_check;

ALTER TABLE public.vehicle_commands
  ADD CONSTRAINT vehicle_commands_type_check
  CHECK (type IN (
    'lock','unlock','horn','alarm_on','alarm_off',
    'lights_on','route_send','navigation_start','theme_change'
  ));

-- ── 3. Yeni kolonlar ─────────────────────────────────────────────────────────

ALTER TABLE public.vehicle_commands
  ADD COLUMN IF NOT EXISTS nonce            text,
  ADD COLUMN IF NOT EXISTS ttl              timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count      int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at  timestamptz,
  ADD COLUMN IF NOT EXISTS error_reason     text,
  ADD COLUMN IF NOT EXISTS accepted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at      timestamptz;

-- ── 4. Retry index — araç reconnect'te sıradaki komutu hızlı çeker ───────────

CREATE INDEX IF NOT EXISTS vehicle_commands_retry_idx
  ON public.vehicle_commands (vehicle_id, retry_count, last_attempt_at)
  WHERE status = 'pending';

-- ── 5. RLS: araç kendi komutlarını UPDATE edebilir ───────────────────────────
-- Araç api_key ile Supabase'e service_role üzerinden bağlanır (RPC).
-- Burada araç kullanıcısının (vehicle_users) komutları güncellemesine izin ver.

DROP POLICY IF EXISTS "vehicle_update_own_commands" ON public.vehicle_commands;
CREATE POLICY "vehicle_update_own_commands"
  ON public.vehicle_commands FOR UPDATE
  USING (
    vehicle_id IN (
      SELECT vehicle_id FROM public.vehicle_users WHERE user_id = auth.uid()
    )
  );

-- ── 6. Timeout fonksiyonu — 15s içinde accepted geçmeyenleri fail et ─────────
-- Araç tarafından çağrılır veya bir cron job tetikler.

CREATE OR REPLACE FUNCTION public.expire_stale_commands()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  affected int;
BEGIN
  UPDATE public.vehicle_commands
  SET
    status        = 'failed',
    error_reason  = 'Timeout: araç 15 saniye içinde yanıt vermedi',
    finished_at   = now()
  WHERE
    status    = 'pending'
    AND ttl   IS NOT NULL
    AND ttl   < now()
    AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '15 seconds');

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- ── 7. RPC: araç retry increment ─────────────────────────────────────────────
-- Araç execute edemeyince çağırır — retry_count artar, pending kalır.

CREATE OR REPLACE FUNCTION public.increment_command_retry(
  p_command_id  uuid,
  p_error       text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.vehicle_commands
  SET
    retry_count     = retry_count + 1,
    last_attempt_at = now(),
    error_reason    = p_error,
    status          = CASE
                        WHEN retry_count + 1 >= 3
                        THEN 'failed'
                        ELSE 'pending'
                      END,
    finished_at     = CASE
                        WHEN retry_count + 1 >= 3
                        THEN now()
                        ELSE NULL
                      END
  WHERE id = p_command_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_command_retry(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_commands()              TO authenticated;
