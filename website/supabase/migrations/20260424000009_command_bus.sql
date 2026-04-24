-- ═══════════════════════════════════════════════════════════════════════════
-- Command Bus Migration — Uzak Komut ve Senkronizasyon Motoru
-- Automotive Grade: UUID/FK kısıtlamaları, RLS izolasyonu, TTL koruması
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── companies ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- ── profiles ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  full_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'driver'
               CHECK (role IN ('super_admin','admin','driver')),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── vehicles ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  vin          TEXT UNIQUE,
  plate        TEXT NOT NULL,
  name         TEXT,
  -- 6-char uppercase pairing code, regeneratable
  pairing_code TEXT UNIQUE NOT NULL
    DEFAULT upper(left(replace(gen_random_uuid()::text, '-', ''), 6)),
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- ── vehicle_pairings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_pairings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'owner'
               CHECK (role IN ('owner','driver','observer')),
  paired_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, vehicle_id)
);
ALTER TABLE vehicle_pairings ENABLE ROW LEVEL SECURITY;

-- ── vehicle_commands (Komut Veriyolu) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_commands (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  sender_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL
               CHECK (type IN (
                 'lock','unlock','horn','alarm',
                 'route_send','navigation_start','theme_change'
               )),
  payload    JSONB NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN (
                 'pending','accepted','executing',
                 'completed','failed','expired','rejected'
               )),
  -- Idempotency: Launcher, aynı nonce'u tekrar çalıştırmaz
  nonce      TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  -- TTL: 5 dakikadan eski komutlar expired sayılır
  ttl        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT nonce_vehicle_unique UNIQUE (vehicle_id, nonce)
);
ALTER TABLE vehicle_commands ENABLE ROW LEVEL SECURITY;

-- updated_at auto-trigger
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_commands_updated_at
  BEFORE UPDATE ON vehicle_commands
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── route_commands (Navigasyon özel tablo) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS route_commands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id      UUID REFERENCES vehicle_commands(id) ON DELETE CASCADE,
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  lat             DOUBLE PRECISION NOT NULL
                    CHECK (lat BETWEEN -90 AND 90),
  lng             DOUBLE PRECISION NOT NULL
                    CHECK (lng BETWEEN -180 AND 180),
  address_name    TEXT,
  provider_intent TEXT NOT NULL DEFAULT 'google_maps'
                    CHECK (provider_intent IN (
                      'google_maps','yandex','waze','apple_maps'
                    )),
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE route_commands ENABLE ROW LEVEL SECURITY;

-- ── vehicle_locations (GPS telemetri) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  lat        DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy   REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE vehicle_locations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_vehicle_loc_vid_ts
  ON vehicle_locations (vehicle_id, created_at DESC);

-- ── telemetry_events (OBD verileri) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telemetry_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  speed_kmh      REAL CHECK (speed_kmh IS NULL OR (speed_kmh >= 0 AND speed_kmh <= 300)),
  fuel_pct       REAL CHECK (fuel_pct IS NULL OR (fuel_pct >= 0 AND fuel_pct <= 100)),
  engine_temp_c  REAL CHECK (engine_temp_c IS NULL OR (engine_temp_c >= -40 AND engine_temp_c <= 150)),
  rpm            INTEGER CHECK (rpm IS NULL OR (rpm >= 0 AND rpm <= 10000)),
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_telemetry_vid_ts
  ON telemetry_events (vehicle_id, created_at DESC);

-- ── command_logs (Denetim izi) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS command_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID REFERENCES vehicle_commands(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  actor_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event      TEXT NOT NULL,  -- 'sent','accepted','executing','completed','failed','expired','rejected'
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE command_logs ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════
-- YARDIMCI FONKSİYONLAR
-- ═══════════════════════════════════════════════════════════════════════════

-- Kullanıcı, araçla eşleşmiş mi?
CREATE OR REPLACE FUNCTION is_paired(p_user UUID, p_vehicle UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM vehicle_pairings
    WHERE user_id = p_user AND vehicle_id = p_vehicle
  );
$$;

-- Pairing code ile araç bağla (araç uygulama ilk açılışında çağırır)
CREATE OR REPLACE FUNCTION pair_vehicle_by_code(p_code TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vehicle_id UUID;
BEGIN
  SELECT id INTO v_vehicle_id FROM vehicles WHERE pairing_code = upper(p_code);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Geçersiz eşleştirme kodu: %', p_code;
  END IF;

  INSERT INTO vehicle_pairings (user_id, vehicle_id)
  VALUES (auth.uid(), v_vehicle_id)
  ON CONFLICT (user_id, vehicle_id) DO NOTHING;

  RETURN v_vehicle_id;
END;
$$;

-- TTL süresi geçmiş komutları expired yap (pg_cron veya Edge Function çağırır)
CREATE OR REPLACE FUNCTION expire_stale_commands()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cnt INTEGER;
BEGIN
  UPDATE vehicle_commands
  SET status = 'expired', updated_at = now()
  WHERE status IN ('pending', 'accepted', 'executing')
    AND ttl < now();
  GET DIAGNOSTICS cnt = ROW_COUNT;

  -- Denetim izi
  INSERT INTO command_logs (command_id, event, details)
  SELECT id, 'expired', jsonb_build_object('ttl', ttl)
  FROM vehicle_commands
  WHERE status = 'expired' AND updated_at > now() - INTERVAL '1 minute';

  RETURN cnt;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS POLİTİKALARI
-- ═══════════════════════════════════════════════════════════════════════════

-- profiles
CREATE POLICY "profiles: kendi kaydını gör/güncelle" ON profiles
  FOR ALL USING (id = auth.uid());

-- vehicles: sadece eşleştirilmiş araçları gör
CREATE POLICY "vehicles: eşleşmiş kullanıcı okuyabilir" ON vehicles
  FOR SELECT USING (is_paired(auth.uid(), id));

-- vehicle_pairings
CREATE POLICY "pairings: kendi eşleşmelerini gör" ON vehicle_pairings
  FOR SELECT USING (user_id = auth.uid());

-- vehicle_commands: eşleşmiş kullanıcı INSERT yapabilir, TTL kontrolü
CREATE POLICY "commands: eşleşmiş kullanıcı gönderebilir" ON vehicle_commands
  FOR INSERT WITH CHECK (
    is_paired(auth.uid(), vehicle_id)
    AND ttl > now()
    AND sender_id = auth.uid()
  );

-- vehicle_commands: gönderen veya eşleşmiş kullanıcı okuyabilir
CREATE POLICY "commands: eşleşmiş kullanıcı okuyabilir" ON vehicle_commands
  FOR SELECT USING (is_paired(auth.uid(), vehicle_id));

-- vehicle_commands: Launcher (eşleşmiş cihaz) status güncelleyebilir
CREATE POLICY "commands: launcher durum güncelleyebilir" ON vehicle_commands
  FOR UPDATE USING (is_paired(auth.uid(), vehicle_id))
  WITH CHECK (
    is_paired(auth.uid(), vehicle_id)
    -- Launcher sadece kabul edilen statülere geçebilir
    AND status IN ('accepted','executing','completed','failed','rejected')
  );

-- route_commands
CREATE POLICY "route_commands: eşleşmiş kullanıcı" ON route_commands
  FOR ALL USING (is_paired(auth.uid(), vehicle_id));

-- vehicle_locations
CREATE POLICY "locations: eşleşmiş INSERT" ON vehicle_locations
  FOR INSERT WITH CHECK (is_paired(auth.uid(), vehicle_id));
CREATE POLICY "locations: eşleşmiş SELECT" ON vehicle_locations
  FOR SELECT USING (is_paired(auth.uid(), vehicle_id));

-- telemetry_events
CREATE POLICY "telemetry: eşleşmiş INSERT" ON telemetry_events
  FOR INSERT WITH CHECK (is_paired(auth.uid(), vehicle_id));
CREATE POLICY "telemetry: eşleşmiş SELECT" ON telemetry_events
  FOR SELECT USING (is_paired(auth.uid(), vehicle_id));

-- command_logs: sadece service role erişebilir (kullanıcı policy yok)

-- ═══════════════════════════════════════════════════════════════════════════
-- REALTIME YAYINI
-- ═══════════════════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE route_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE telemetry_events;
