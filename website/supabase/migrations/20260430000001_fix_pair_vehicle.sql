-- ═══════════════════════════════════════════════════════
-- 20260430000001_fix_pair_vehicle.sql
-- pair_vehicle RPC düzeltmesi:
--   1. api_key_hash döndür (route bunu bekliyor)
--   2. auth.uid() kaldır — PWA eşleşmesi kullanıcı oturumu gerektirmez
--      (service role ile çağrılır → auth.uid() = NULL → vehicle_pairings INSERT'i başarısız oluyordu)
-- ═══════════════════════════════════════════════════════

create or replace function pair_vehicle(p_pairing_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vehicle_id uuid;
  v_api_key    text;
  v_code       text;
begin
  v_code := upper(trim(p_pairing_code));

  -- 1. Geçici bağlama kodunda ara (register_vehicle'dan üretilen 6 haneli kod)
  select vlc.vehicle_id, v.api_key_hash
  into   v_vehicle_id, v_api_key
  from   vehicle_linking_codes vlc
  join   vehicles v on v.id = vlc.vehicle_id
  where  vlc.code = v_code
    and  vlc.expires_at > now()
  limit 1;

  -- 2. Bulunamazsa kalıcı pairing_code'da ara (araç panelinde gösterilen sabit kod)
  if v_vehicle_id is null then
    select id, api_key_hash
    into   v_vehicle_id, v_api_key
    from   vehicles
    where  upper(pairing_code) = v_code
    limit 1;
  end if;

  -- Kod bulunamadı
  if v_vehicle_id is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Geçersiz eşleşme kodu veya süre dolmuş.'
    );
  end if;

  -- api_key_hash eksik (eski kayıt veya yapılandırma hatası)
  if v_api_key is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Araç yapılandırma hatası. Lütfen aracı yeniden kaydedin.'
    );
  end if;

  -- Kullanılan geçici kodu sil (tek kullanım garantisi)
  delete from vehicle_linking_codes
  where vehicle_id = v_vehicle_id;

  return jsonb_build_object(
    'success',    true,
    'vehicle_id', v_vehicle_id,
    'api_key',    v_api_key
  );
end;
$$;
