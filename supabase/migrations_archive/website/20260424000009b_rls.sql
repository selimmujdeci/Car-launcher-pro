-- ═══════════════════════════════════════
-- 20260424000009b — PART 2: RLS Politikaları
-- ═══════════════════════════════════════

-- route_commands'a vehicle_id ekle (eski migration'da yoktu)
alter table if exists route_commands
  add column if not exists vehicle_id uuid references vehicles(id) on delete cascade;

-- vehicle_commands'a eksik kolonları ekle
alter table if exists vehicle_commands
  add column if not exists sender_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- vehicle_pairings
drop policy if exists "pairings: kendi eslesmeleri" on vehicle_pairings;
create policy "pairings: kendi eslesmeleri" on vehicle_pairings
  for select using (user_id = auth.uid());

-- vehicle_telemetry
drop policy if exists "telemetry_snap: select" on vehicle_telemetry;
create policy "telemetry_snap: select" on vehicle_telemetry
  for select using (is_vehicle_owner(vehicle_id) or is_paired(auth.uid(), vehicle_id));

drop policy if exists "telemetry_snap: insert" on vehicle_telemetry;
create policy "telemetry_snap: insert" on vehicle_telemetry
  for insert with check (is_vehicle_owner(vehicle_id) or is_paired(auth.uid(), vehicle_id));

drop policy if exists "telemetry_snap: update" on vehicle_telemetry;
create policy "telemetry_snap: update" on vehicle_telemetry
  for update using (is_vehicle_owner(vehicle_id) or is_paired(auth.uid(), vehicle_id));

-- vehicle_commands
drop policy if exists "commands: gonderebilir" on vehicle_commands;
create policy "commands: gonderebilir" on vehicle_commands
  for insert with check (
    (is_vehicle_owner(vehicle_id) or is_paired(auth.uid(), vehicle_id))
    and ttl > now()
  );

drop policy if exists "commands: okuyabilir" on vehicle_commands;
create policy "commands: okuyabilir" on vehicle_commands
  for select using (is_vehicle_owner(vehicle_id) or is_paired(auth.uid(), vehicle_id));

drop policy if exists "commands: guncelleyebilir" on vehicle_commands;
create policy "commands: guncelleyebilir" on vehicle_commands
  for update using (is_vehicle_owner(vehicle_id) or is_paired(auth.uid(), vehicle_id))
  with check (
    (is_vehicle_owner(vehicle_id) or is_paired(auth.uid(), vehicle_id))
    and status in ('accepted','executing','completed','failed','rejected')
  );

-- route_commands
drop policy if exists "route_commands: eslesmis" on route_commands;
create policy "route_commands: eslesmis" on route_commands
  for all using (is_vehicle_owner(vehicle_id) or is_paired(auth.uid(), vehicle_id));
