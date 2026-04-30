-- ═══════════════════════════════════════════════════════
-- 20260424000100_individual_mode.sql — Owner bazlı RLS
-- Idempotent: defalarca çalıştırılabilir
-- ═══════════════════════════════════════════════════════

-- Eski company-based politikaları temizle (001'den geldiyse)
drop policy if exists "vehicles: şirket izolasyonu select" on vehicles;
drop policy if exists "vehicles: şirket izolasyonu mutate" on vehicles;
drop policy if exists "company_isolation_select_vehicles" on vehicles;
drop policy if exists "company_isolation_mutate_vehicles" on vehicles;
drop policy if exists "Owner Only Vehicles Select" on vehicles;
drop policy if exists "Owner Only Vehicles Insert" on vehicles;
drop policy if exists "Owner Only Vehicles Update" on vehicles;
drop policy if exists "Owner Only Vehicles Delete" on vehicles;

-- Yeni: owner + company erişimi
drop policy if exists "vehicles: owner veya şirket select" on vehicles;
create policy "vehicles: owner veya şirket select" on vehicles
  for select using (
    owner_id = auth.uid()
    or company_id = auth_company_id()
    or is_paired(auth.uid(), id)
  );

drop policy if exists "vehicles: owner insert" on vehicles;
create policy "vehicles: owner insert" on vehicles
  for insert with check (owner_id = auth.uid() or company_id = auth_company_id());

drop policy if exists "vehicles: owner update" on vehicles;
create policy "vehicles: owner update" on vehicles
  for update
  using (owner_id = auth.uid() or company_id = auth_company_id())
  with check (owner_id = auth.uid() or company_id = auth_company_id());

drop policy if exists "vehicles: owner delete" on vehicles;
create policy "vehicles: owner delete" on vehicles
  for delete using (owner_id = auth.uid() or company_id = auth_company_id());

-- vehicle_locations: owner erişimi ekle
drop policy if exists "locations: şirket izolasyonu select" on vehicle_locations;
drop policy if exists "locations: şirket izolasyonu mutate" on vehicle_locations;
drop policy if exists "locations: eşleşmiş INSERT" on vehicle_locations;
drop policy if exists "locations: eşleşmiş SELECT" on vehicle_locations;
drop policy if exists "locations: erişim" on vehicle_locations;
drop policy if exists "locations: yazma" on vehicle_locations;

create policy "locations: erişim" on vehicle_locations
  for select using (
    company_id = auth_company_id()
    or is_vehicle_owner(vehicle_id)
    or is_paired(auth.uid(), vehicle_id)
  );

create policy "locations: yazma" on vehicle_locations
  for insert with check (
    is_vehicle_owner(vehicle_id)
    or is_paired(auth.uid(), vehicle_id)
  );

-- profiles: kendi profilini gör/güncelle
drop policy if exists "profiles: şirket izolasyonu select" on profiles;
drop policy if exists "profiles: şirket izolasyonu mutate" on profiles;
drop policy if exists "profiles: kendi kaydını gör/güncelle" on profiles;
drop policy if exists "profiles: kendi kaydı" on profiles;
drop policy if exists "profiles: şirket üyelerini gör" on profiles;

create policy "profiles: kendi kaydı" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles: şirket üyelerini gör" on profiles
  for select using (company_id = auth_company_id());
