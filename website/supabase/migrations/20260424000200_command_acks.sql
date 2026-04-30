-- ═══════════════════════════════════════════════════════
-- 20260424000200_command_acks.sql — Araç eşleştirme fonksiyonu
-- Idempotent: defalarca çalıştırılabilir
-- ═══════════════════════════════════════════════════════

-- pair_vehicle: pairing_code ile sahibi olmayan aracı kullanıcıya bağla
create or replace function pair_vehicle(p_pairing_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vehicle_id uuid;
begin
  -- Kodu eşleşen ve henüz sahibi olmayan aracı bul
  select id into v_vehicle_id
  from vehicles
  where pairing_code = upper(p_pairing_code)
    and owner_id is null
  limit 1;

  if v_vehicle_id is null then
    -- Zaten eşleşmiş ama bu kullanıcıya mı ait?
    select id into v_vehicle_id
    from vehicles
    where pairing_code = upper(p_pairing_code)
      and owner_id = auth.uid()
    limit 1;

    if v_vehicle_id is not null then
      return jsonb_build_object('success', true, 'vehicle_id', v_vehicle_id, 'already_paired', true);
    end if;

    return jsonb_build_object('success', false, 'message', 'Geçersiz eşleşme kodu veya araç başka bir kullanıcıya bağlı.');
  end if;

  -- Sahibi ata
  update vehicles
  set owner_id = auth.uid(), updated_at = now()
  where id = v_vehicle_id;

  -- vehicle_pairings tablosuna da ekle
  insert into vehicle_pairings (user_id, vehicle_id, role)
  values (auth.uid(), v_vehicle_id, 'owner')
  on conflict (user_id, vehicle_id) do nothing;

  return jsonb_build_object('success', true, 'vehicle_id', v_vehicle_id);
end;
$$;
