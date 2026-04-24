-- ─────────────────────────────────────────────────────────────────────────────
-- User Trial & Plan System
-- ─────────────────────────────────────────────────────────────────────────────
-- plan:          'free' | 'trial' | 'pro'
-- trial_ends_at: NULL ise trial aktif değil; değer varsa o tarihe kadar PRO
--
-- Kural: trial_ends_at > now() ise kullanıcı PRO gibi çalışır.
-- ─────────────────────────────────────────────────────────────────────────────

alter table users
  add column if not exists plan          text        not null default 'trial'
                                         check (plan in ('free', 'trial', 'pro')),
  add column if not exists trial_ends_at timestamptz,
  add column if not exists plan_updated_at timestamptz;

-- Mevcut kullanıcılara 30 günlük trial ver (henüz plan verilmemiş olanlar)
update users
set
  plan          = 'trial',
  trial_ends_at = now() + interval '30 days',
  plan_updated_at = now()
where trial_ends_at is null;

-- ── Yeni kayıt tetikleyici: her yeni kullanıcıya 30 günlük trial ─────────────

create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, full_name, avatar_url, plan, trial_ends_at, plan_updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    'trial',
    now() + interval '30 days',
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── Yardımcı RPC: kullanıcının plan durumunu getir ────────────────────────────

create or replace function get_my_plan()
returns json language plpgsql security definer as $$
declare
  v_plan          text;
  v_trial_ends_at timestamptz;
  v_effective     text;
begin
  select plan, trial_ends_at
  into   v_plan, v_trial_ends_at
  from   users
  where  id = auth.uid();

  -- Efektif plan hesabı:
  --   plan = 'pro'                            → 'pro'
  --   plan = 'trial' AND trial aktif          → 'pro'  (PRO gibi davran)
  --   plan = 'trial' AND trial bitti          → 'free'
  --   plan = 'free'                           → 'free'
  v_effective := case
    when v_plan = 'pro'                                            then 'pro'
    when v_plan = 'trial' and v_trial_ends_at > now()             then 'pro'
    else                                                                'free'
  end;

  return json_build_object(
    'plan',          v_plan,
    'trial_ends_at', v_trial_ends_at,
    'effective',     v_effective,
    'is_pro',        v_effective = 'pro',
    'days_left',     case
                       when v_plan = 'trial' and v_trial_ends_at > now()
                       then extract(day from (v_trial_ends_at - now()))::int
                       else 0
                     end
  );
end;
$$;

grant execute on function get_my_plan() to authenticated;

-- ── RLS: kullanıcı kendi plan bilgisini okuyabilir ────────────────────────────

drop policy if exists "users can read own plan" on users;
create policy "users can read own plan"
  on users for select
  using (id = auth.uid());
