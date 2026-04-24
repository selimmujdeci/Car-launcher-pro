-- Komut Durum Zaman Damgaları ve İyileştirmeler
-- Dosya: website/supabase/migrations/20260424000200_command_acks.sql

-- vehicle_commands tablosuna detaylı zaman damgaları ekleme
ALTER TABLE vehicle_commands 
ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- Pairing (Eşleşme) için fonksiyon
CREATE OR REPLACE FUNCTION pair_vehicle(p_pairing_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_vehicle_id UUID;
    v_company_id UUID;
BEGIN
    -- Kodu eşleşen ve henüz sahibi olmayan aracı bul
    SELECT id, company_id INTO v_vehicle_id, v_company_id
    FROM vehicles
    WHERE pairing_code = p_pairing_code AND owner_id IS NULL
    LIMIT 1;

    IF v_vehicle_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Geçersiz eşleşme kodu veya araç zaten eşleşmiş.');
    END IF;

    -- Sahibi ata
    UPDATE vehicles 
    SET owner_id = auth.uid(), 
        updated_at = now()
    WHERE id = v_vehicle_id;

    -- Profille şirket bağını kur (varsa)
    UPDATE profiles
    SET company_id = v_company_id
    WHERE id = auth.uid();

    RETURN jsonb_build_object('success', true, 'vehicle_id', v_vehicle_id);
END;
$$;
