-- ─────────────────────────────────────────────────────────────────────────────
-- Super Admin Policies + Company is_active column
-- ─────────────────────────────────────────────────────────────────────────────

-- ── companies: is_active ──────────────────────────────────────────────────────
alter table companies
  add column if not exists is_active boolean not null default true;

-- ── Helper: is the current user a super_admin in ANY company? ────────────────
create or replace function is_super_admin()
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from memberships
    where user_id = auth.uid() and role = 'super_admin'
  )
$$;

-- ── companies: super_admin bypass ─────────────────────────────────────────────
create policy "super_admin full access to companies"
  on companies for all
  using (is_super_admin())
  with check (is_super_admin());

-- ── users: super_admin can see all profiles ───────────────────────────────────
create policy "super_admin full access to users"
  on users for all
  using (is_super_admin())
  with check (is_super_admin());

-- ── memberships: super_admin can manage all ───────────────────────────────────
create policy "super_admin full access to memberships"
  on memberships for all
  using (is_super_admin())
  with check (is_super_admin());

-- ── vehicles: super_admin can see all ────────────────────────────────────────
create policy "super_admin full access to vehicles"
  on vehicles for all
  using (is_super_admin())
  with check (is_super_admin());

-- ── tasks: super_admin can see all ───────────────────────────────────────────
create policy "super_admin full access to tasks"
  on tasks for all
  using (is_super_admin())
  with check (is_super_admin());
