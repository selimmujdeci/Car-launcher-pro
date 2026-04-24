-- Uzaktan Komut ve Rota Sistemi Migration
-- Dosya: website/supabase/migrations/002_remote_commands.sql

-- Komut Durumları Enum
DO $$ BEGIN
    CREATE TYPE command_status AS ENUM ('pending', 'accepted', 'executing', 'completed', 'failed', 'expired');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Araç Komutları Tablosu
CREATE TABLE IF NOT EXISTS vehicle_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    issuer_id UUID REFERENCES auth.users(id),
    type TEXT NOT NULL, -- 'lock', 'unlock', 'route_send', 'horn', etc.
    payload JSONB DEFAULT '{}'::jsonb,
    status command_status DEFAULT 'pending',
    nonce TEXT UNIQUE, -- Idempotency koruması
    ttl TIMESTAMPTZ NOT NULL, -- Komutun son kullanma tarihi
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Rota Komutları Detay Tablosu (Specialized for route_send)
CREATE TABLE IF NOT EXISTS route_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command_id UUID NOT NULL REFERENCES vehicle_commands(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    address_name TEXT,
    provider_intent TEXT, -- 'google_maps', 'yandex', etc.
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Politikaları
ALTER TABLE vehicle_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_commands ENABLE ROW LEVEL SECURITY;

-- Sadece kendi şirketinin komutlarını gör/yaz
CREATE POLICY "Company Isolation for Commands" ON vehicle_commands
    FOR ALL USING (company_id = (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company Isolation for Route Details" ON route_commands
    FOR ALL USING (command_id IN (SELECT id FROM vehicle_commands));

-- Indexler
CREATE INDEX IF NOT EXISTS idx_vcmd_vehicle_status ON vehicle_commands(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_vcmd_ttl ON vehicle_commands(ttl);
