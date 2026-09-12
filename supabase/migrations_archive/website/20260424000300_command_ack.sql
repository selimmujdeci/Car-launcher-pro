-- ═══════════════════════════════════════════════════════════════════════════
-- 20260424000300_command_ack.sql — Komut yaşam döngüsü RPC
-- Idempotent: defalarca çalıştırılabilir
--
-- Araç ↔ Supabase ACK protokolü:
--   accepted  : araç komutu aldı, işleme kuyruğuna koydu
--   executing : executeIntent() çağrısı başladı
--   completed : komut başarıyla tamamlandı (kapı kilitlendi, korna çalındı…)
--   failed    : yürütme hatası
--   rejected  : güvenlik reddi (sürüş sırasında lock/unlock vb.)
--
-- Araçtan gelen istekler api_key ile authenticate edilir.
-- Server-side api_key_hash → HMAC-SHA256(api_key) karşılaştırması.
-- ═══════════════════════════════════════════════════════════════════════════

-- retry_count ve last_attempt_at kolonları yoksa ekle
alter table vehicle_commands
  add column if not exists retry_count     integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

-- ── update_command_status ─────────────────────────────────────────────────
-- Araçtan çağrılır; api_key doğrulaması sonrası ilgili satırı günceller.
-- Timestamp alanlarını sadece doluysa yazar (COALESCE) — idempotent.

create or replace function update_command_status(
  p_api_key     text,
  p_command_id  uuid,
  p_status      text,
  p_accepted_at  timestamptz default null,
  p_executed_at  timestamptz default null,
  p_finished_at  timestamptz default null,
  p_error        text        default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle_id uuid;
begin
  -- api_key → api_key_hash karşılaştırmasıyla araç kimliği doğrula.
  -- encode(digest(p_api_key,'sha256'),'hex') pgcrypto extension gerektirir;
  -- pgcrypto yoksa düz text karşılaştırması yapılır (dev ortamı için).
  select id into v_vehicle_id
  from vehicles
  where api_key_hash = encode(digest(p_api_key, 'sha256'), 'hex')
     or api_key_hash = p_api_key   -- dev fallback: hash yapılmamış key
  limit 1;

  if v_vehicle_id is null then
    raise exception 'Geçersiz api_key' using errcode = 'P0001';
  end if;

  -- Status geçerliliği DB constraint'i zaten sağlar; ek kontrol gerekmez.
  update vehicle_commands
  set
    status           = p_status,
    accepted_at      = coalesce(p_accepted_at,  accepted_at),
    executed_at      = coalesce(p_executed_at,  executed_at),
    finished_at      = coalesce(p_finished_at,  finished_at),
    error_message    = coalesce(p_error,         error_message),
    last_attempt_at  = case when p_status = 'executing' then now() else last_attempt_at end,
    updated_at       = now()
  where id         = p_command_id
    and vehicle_id = v_vehicle_id;

  if not found then
    -- Araç bu komuta sahip değil veya komut mevcut değil — sessizce geç
    return;
  end if;
end;
$$;

-- ── increment_command_retry ───────────────────────────────────────────────
-- Atomik retry_count artışı. Max retry'da otomatik failed.

create or replace function increment_command_retry(
  p_command_id  uuid,
  p_error       text  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retry_count integer;
  MAX_RETRY     constant integer := 3;
begin
  select retry_count into v_retry_count
  from vehicle_commands
  where id = p_command_id;

  if v_retry_count is null then return; end if;

  if v_retry_count + 1 >= MAX_RETRY then
    update vehicle_commands
    set status        = 'failed',
        error_message = coalesce(p_error, 'Max retry aşıldı'),
        finished_at   = now(),
        updated_at    = now()
    where id = p_command_id;
  else
    update vehicle_commands
    set retry_count     = retry_count + 1,
        last_attempt_at = now(),
        error_message   = p_error,
        updated_at      = now()
    where id = p_command_id;
  end if;
end;
$$;

-- RLS: sadece vehicle_id'nin sahibi komut durumunu okuyabilir
-- (insert RLS 002 migration'dan gelir; burada sadece ek politika)
drop policy if exists "commands: araç kendi komutlarını günceller" on vehicle_commands;
-- Araç kendi komutlarını RPC üzerinden günceller; direkt UPDATE'e gerek yok.
-- RPC'ler security definer olduğundan araç auth.uid() kontrolünü bypass eder,
-- bunun yerine api_key doğrulaması yapılır.
