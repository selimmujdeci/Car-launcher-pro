-- =====================================================================
-- 00000000000000_prod_baseline.sql — PROD BASELINE SQUASH
--
-- ÜRETİM YÖNTEMİ: canlı `Carospro` projesinin katalogları SALT-OKUNUR
-- okunup (Management API `read_only:true` → `supabase_read_only_user`)
-- bu dosya OTOMATİK üretildi. Elle yazılmadı, prod'dan TÜRETİLDİ.
--
-- NE İŞE YARAR:
--   · PROD'DA ÇALIŞTIRILMAZ — prod zaten bu durumdadır. Prod'un migration
--     defterine `applied` olarak İŞARETLENİR (baseline squash).
--   · YENİ/TEMİZ bir ortamda ise prod'un bugünkü halini SIFIRDAN kurar.
--
-- KAPSAM: public şeması (tablolar · kısıtlar · indeksler · fonksiyonlar ·
-- trigger'lar · RLS + politikalar · rol ayrıcalıkları · realtime yayını)
-- + auth.users üzerindeki ürün trigger'ı + zamanlanmış temizlik işi.
-- VERİ İÇERMEZ.
-- =====================================================================

-- ── Eklentiler ───────────────────────────────────────────────────────
-- platform eklentisi (Supabase kurar): pg_cron 1.6.4
-- platform eklentisi (Supabase kurar): pg_stat_statements 1.11
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- platform eklentisi (Supabase kurar): supabase_vault 0.3.1
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enum tipleri ─────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                  WHERE n.nspname='public' AND t.typname='command_status') THEN
    CREATE TYPE public."command_status" AS ENUM ('pending', 'accepted', 'executing', 'completed', 'failed', 'expired');
  END IF;
END $$;

-- ── Tablolar ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."audit_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid,
  "action" text NOT NULL,
  "target" text NOT NULL,
  "before_val" jsonb,
  "after_val" jsonb,
  "severity" text DEFAULT 'info'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."command_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "command_id" uuid,
  "vehicle_id" uuid,
  "actor_id" uuid,
  "event" text NOT NULL,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."companies" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."feature_flags" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT ''::text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "rollout_percent" integer DEFAULT 100 NOT NULL,
  "target_scope" text DEFAULT 'all'::text NOT NULL,
  "depends_on" text[] DEFAULT '{}'::text[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid
);
CREATE TABLE IF NOT EXISTS public."key_beams" (
  "code" text NOT NULL,
  "ciphertext" text NOT NULL,
  "iv" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public."notifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "vehicle_id" uuid,
  "profile_id" uuid,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "severity" text NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."ota_releases" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "version_code" integer NOT NULL,
  "version_name" text NOT NULL,
  "channel" text DEFAULT 'production'::text NOT NULL,
  "apk_path" text NOT NULL,
  "apk_size" bigint NOT NULL,
  "sha256" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "release_notes" text DEFAULT ''::text NOT NULL,
  "rollout_plan_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid
);
CREATE TABLE IF NOT EXISTS public."profiles" (
  "id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "full_name" text,
  "role" text DEFAULT 'member'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "avatar_url" text
);
CREATE TABLE IF NOT EXISTS public."rollout_plans" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "version" text NOT NULL,
  "description" text DEFAULT ''::text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rollback_to" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "approved_by" uuid,
  "approved_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public."route_commands" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "command_id" uuid NOT NULL,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "address_name" text,
  "provider_intent" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "vehicle_id" uuid
);
CREATE TABLE IF NOT EXISTS public."runtime_policies" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "value" numeric NOT NULL,
  "min_value" numeric NOT NULL,
  "max_value" numeric NOT NULL,
  "unit" text DEFAULT ''::text NOT NULL,
  "description" text DEFAULT ''::text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid
);
CREATE TABLE IF NOT EXISTS public."support_reader_secret" (
  "id" smallint DEFAULT 1 NOT NULL,
  "secret_hash" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."telemetry_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "speed_kmh" real DEFAULT 0 NOT NULL,
  "fuel_pct" real DEFAULT 0 NOT NULL,
  "engine_temp_c" real DEFAULT 0 NOT NULL,
  "rpm" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."vehicle_commands" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "issuer_id" uuid,
  "type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb,
  "status" text DEFAULT 'pending'::command_status,
  "nonce" text,
  "ttl" timestamp with time zone NOT NULL,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "sender_id" uuid,
  "created_by" uuid,
  "critical_auth_verified" boolean DEFAULT false NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public."vehicle_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "vehicle_id" text,
  "type" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."vehicle_geofences" (
  "id" text NOT NULL,
  "vehicle_id" text NOT NULL,
  "name" text,
  "type" text,
  "polygon" jsonb,
  "center" jsonb,
  "radius_m" numeric,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."vehicle_linking_codes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "code" text NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (now() + '00:05:00'::interval) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."vehicle_locations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "heading_deg" real,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."vehicle_pairings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "role" text DEFAULT 'owner'::text NOT NULL,
  "paired_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."vehicle_push_tokens" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "fcm_token" text NOT NULL,
  "platform" text DEFAULT 'android'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."vehicle_telemetry" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "lat" double precision,
  "lng" double precision,
  "speed" real DEFAULT 0 NOT NULL,
  "fuel" real DEFAULT 0 NOT NULL,
  "rpm" integer DEFAULT 0 NOT NULL,
  "temp" real DEFAULT 0 NOT NULL,
  "is_online" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."vehicles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "plate" text,
  "name" text NOT NULL,
  "driver_name" text,
  "odometer_km" integer DEFAULT 0 NOT NULL,
  "api_key_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "owner_id" uuid,
  "brand" text,
  "model" text,
  "year" integer,
  "fuel_type" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "current_km" integer DEFAULT 0 NOT NULL,
  "ins_expiry" text,
  "speed" real,
  "last_seen" timestamp with time zone,
  "device_name" text,
  "license_plate" text,
  "vin" text,
  "pairing_code" text DEFAULT upper("left"(replace((gen_random_uuid())::text, '-'::text, ''::text), 6)) NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "critical_pin_hash" text,
  "device_id" text,
  "api_key" text
);

-- ── Kısıtlar (PK → UNIQUE → CHECK → FK) ──────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_logs_pkey'
                  AND conrelid='public.audit_logs'::regclass) THEN
    ALTER TABLE public."audit_logs" ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='command_logs_pkey'
                  AND conrelid='public.command_logs'::regclass) THEN
    ALTER TABLE public."command_logs" ADD CONSTRAINT "command_logs_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='companies_pkey'
                  AND conrelid='public.companies'::regclass) THEN
    ALTER TABLE public."companies" ADD CONSTRAINT "companies_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='feature_flags_pkey'
                  AND conrelid='public.feature_flags'::regclass) THEN
    ALTER TABLE public."feature_flags" ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='key_beams_pkey'
                  AND conrelid='public.key_beams'::regclass) THEN
    ALTER TABLE public."key_beams" ADD CONSTRAINT "key_beams_pkey" PRIMARY KEY (code);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_pkey'
                  AND conrelid='public.notifications'::regclass) THEN
    ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_releases_pkey'
                  AND conrelid='public.ota_releases'::regclass) THEN
    ALTER TABLE public."ota_releases" ADD CONSTRAINT "ota_releases_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_pkey'
                  AND conrelid='public.profiles'::regclass) THEN
    ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rollout_plans_pkey'
                  AND conrelid='public.rollout_plans'::regclass) THEN
    ALTER TABLE public."rollout_plans" ADD CONSTRAINT "rollout_plans_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='route_commands_pkey'
                  AND conrelid='public.route_commands'::regclass) THEN
    ALTER TABLE public."route_commands" ADD CONSTRAINT "route_commands_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='runtime_policies_pkey'
                  AND conrelid='public.runtime_policies'::regclass) THEN
    ALTER TABLE public."runtime_policies" ADD CONSTRAINT "runtime_policies_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_reader_secret_pkey'
                  AND conrelid='public.support_reader_secret'::regclass) THEN
    ALTER TABLE public."support_reader_secret" ADD CONSTRAINT "support_reader_secret_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='telemetry_events_pkey'
                  AND conrelid='public.telemetry_events'::regclass) THEN
    ALTER TABLE public."telemetry_events" ADD CONSTRAINT "telemetry_events_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_commands_pkey'
                  AND conrelid='public.vehicle_commands'::regclass) THEN
    ALTER TABLE public."vehicle_commands" ADD CONSTRAINT "vehicle_commands_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_events_pkey'
                  AND conrelid='public.vehicle_events'::regclass) THEN
    ALTER TABLE public."vehicle_events" ADD CONSTRAINT "vehicle_events_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_geofences_pkey'
                  AND conrelid='public.vehicle_geofences'::regclass) THEN
    ALTER TABLE public."vehicle_geofences" ADD CONSTRAINT "vehicle_geofences_pkey" PRIMARY KEY (vehicle_id, id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_linking_codes_pkey'
                  AND conrelid='public.vehicle_linking_codes'::regclass) THEN
    ALTER TABLE public."vehicle_linking_codes" ADD CONSTRAINT "vehicle_linking_codes_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_locations_pkey'
                  AND conrelid='public.vehicle_locations'::regclass) THEN
    ALTER TABLE public."vehicle_locations" ADD CONSTRAINT "vehicle_locations_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_pairings_pkey'
                  AND conrelid='public.vehicle_pairings'::regclass) THEN
    ALTER TABLE public."vehicle_pairings" ADD CONSTRAINT "vehicle_pairings_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_push_tokens_pkey'
                  AND conrelid='public.vehicle_push_tokens'::regclass) THEN
    ALTER TABLE public."vehicle_push_tokens" ADD CONSTRAINT "vehicle_push_tokens_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_telemetry_pkey'
                  AND conrelid='public.vehicle_telemetry'::regclass) THEN
    ALTER TABLE public."vehicle_telemetry" ADD CONSTRAINT "vehicle_telemetry_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_pkey'
                  AND conrelid='public.vehicles'::regclass) THEN
    ALTER TABLE public."vehicles" ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='feature_flags_key_key'
                  AND conrelid='public.feature_flags'::regclass) THEN
    ALTER TABLE public."feature_flags" ADD CONSTRAINT "feature_flags_key_key" UNIQUE (key);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_releases_version_code_key'
                  AND conrelid='public.ota_releases'::regclass) THEN
    ALTER TABLE public."ota_releases" ADD CONSTRAINT "ota_releases_version_code_key" UNIQUE (version_code);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='runtime_policies_key_key'
                  AND conrelid='public.runtime_policies'::regclass) THEN
    ALTER TABLE public."runtime_policies" ADD CONSTRAINT "runtime_policies_key_key" UNIQUE (key);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_commands_nonce_key'
                  AND conrelid='public.vehicle_commands'::regclass) THEN
    ALTER TABLE public."vehicle_commands" ADD CONSTRAINT "vehicle_commands_nonce_key" UNIQUE (nonce);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_linking_codes_code_key'
                  AND conrelid='public.vehicle_linking_codes'::regclass) THEN
    ALTER TABLE public."vehicle_linking_codes" ADD CONSTRAINT "vehicle_linking_codes_code_key" UNIQUE (code);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_linking_codes_vehicle_id_key'
                  AND conrelid='public.vehicle_linking_codes'::regclass) THEN
    ALTER TABLE public."vehicle_linking_codes" ADD CONSTRAINT "vehicle_linking_codes_vehicle_id_key" UNIQUE (vehicle_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_pairings_user_id_vehicle_id_key'
                  AND conrelid='public.vehicle_pairings'::regclass) THEN
    ALTER TABLE public."vehicle_pairings" ADD CONSTRAINT "vehicle_pairings_user_id_vehicle_id_key" UNIQUE (user_id, vehicle_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_push_tokens_vehicle_id_fcm_token_key'
                  AND conrelid='public.vehicle_push_tokens'::regclass) THEN
    ALTER TABLE public."vehicle_push_tokens" ADD CONSTRAINT "vehicle_push_tokens_vehicle_id_fcm_token_key" UNIQUE (vehicle_id, fcm_token);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_telemetry_vehicle_id_key'
                  AND conrelid='public.vehicle_telemetry'::regclass) THEN
    ALTER TABLE public."vehicle_telemetry" ADD CONSTRAINT "vehicle_telemetry_vehicle_id_key" UNIQUE (vehicle_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_pairing_code_key'
                  AND conrelid='public.vehicles'::regclass) THEN
    ALTER TABLE public."vehicles" ADD CONSTRAINT "vehicles_pairing_code_key" UNIQUE (pairing_code);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='feature_flags_rollout_percent_check'
                  AND conrelid='public.feature_flags'::regclass) THEN
    ALTER TABLE public."feature_flags" ADD CONSTRAINT "feature_flags_rollout_percent_check" CHECK (((rollout_percent >= 0) AND (rollout_percent <= 100)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_severity_check'
                  AND conrelid='public.notifications'::regclass) THEN
    ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_severity_check" CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_releases_apk_size_check'
                  AND conrelid='public.ota_releases'::regclass) THEN
    ALTER TABLE public."ota_releases" ADD CONSTRAINT "ota_releases_apk_size_check" CHECK ((apk_size > 0));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_releases_channel_check'
                  AND conrelid='public.ota_releases'::regclass) THEN
    ALTER TABLE public."ota_releases" ADD CONSTRAINT "ota_releases_channel_check" CHECK ((channel = ANY (ARRAY['internal'::text, 'pilot'::text, 'production'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_releases_sha256_check'
                  AND conrelid='public.ota_releases'::regclass) THEN
    ALTER TABLE public."ota_releases" ADD CONSTRAINT "ota_releases_sha256_check" CHECK ((char_length(sha256) = 64));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_releases_status_check'
                  AND conrelid='public.ota_releases'::regclass) THEN
    ALTER TABLE public."ota_releases" ADD CONSTRAINT "ota_releases_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'revoked'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_releases_version_code_check'
                  AND conrelid='public.ota_releases'::regclass) THEN
    ALTER TABLE public."ota_releases" ADD CONSTRAINT "ota_releases_version_code_check" CHECK ((version_code > 0));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_role_check'
                  AND conrelid='public.profiles'::regclass) THEN
    ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='runtime_policies_category_check'
                  AND conrelid='public.runtime_policies'::regclass) THEN
    ALTER TABLE public."runtime_policies" ADD CONSTRAINT "runtime_policies_category_check" CHECK ((category = ANY (ARRAY['thermal'::text, 'sync'::text, 'watchdog'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_reader_secret_id_check'
                  AND conrelid='public.support_reader_secret'::regclass) THEN
    ALTER TABLE public."support_reader_secret" ADD CONSTRAINT "support_reader_secret_id_check" CHECK ((id = 1));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_geofences_type_check'
                  AND conrelid='public.vehicle_geofences'::regclass) THEN
    ALTER TABLE public."vehicle_geofences" ADD CONSTRAINT "vehicle_geofences_type_check" CHECK ((type = ANY (ARRAY['polygon'::text, 'circle'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_pairings_role_check'
                  AND conrelid='public.vehicle_pairings'::regclass) THEN
    ALTER TABLE public."vehicle_pairings" ADD CONSTRAINT "vehicle_pairings_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'driver'::text, 'observer'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_push_tokens_platform_check'
                  AND conrelid='public.vehicle_push_tokens'::regclass) THEN
    ALTER TABLE public."vehicle_push_tokens" ADD CONSTRAINT "vehicle_push_tokens_platform_check" CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text])));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_telemetry_fuel_check'
                  AND conrelid='public.vehicle_telemetry'::regclass) THEN
    ALTER TABLE public."vehicle_telemetry" ADD CONSTRAINT "vehicle_telemetry_fuel_check" CHECK (((fuel >= (0)::double precision) AND (fuel <= (100)::double precision)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_telemetry_rpm_check'
                  AND conrelid='public.vehicle_telemetry'::regclass) THEN
    ALTER TABLE public."vehicle_telemetry" ADD CONSTRAINT "vehicle_telemetry_rpm_check" CHECK (((rpm >= 0) AND (rpm <= 10000)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_telemetry_speed_check'
                  AND conrelid='public.vehicle_telemetry'::regclass) THEN
    ALTER TABLE public."vehicle_telemetry" ADD CONSTRAINT "vehicle_telemetry_speed_check" CHECK (((speed >= (0)::double precision) AND (speed <= (300)::double precision)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_telemetry_temp_check'
                  AND conrelid='public.vehicle_telemetry'::regclass) THEN
    ALTER TABLE public."vehicle_telemetry" ADD CONSTRAINT "vehicle_telemetry_temp_check" CHECK (((temp >= ('-40'::integer)::double precision) AND (temp <= (150)::double precision)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_logs_actor_id_fkey'
                  AND conrelid='public.audit_logs'::regclass) THEN
    ALTER TABLE public."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='command_logs_actor_id_fkey'
                  AND conrelid='public.command_logs'::regclass) THEN
    ALTER TABLE public."command_logs" ADD CONSTRAINT "command_logs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='command_logs_command_id_fkey'
                  AND conrelid='public.command_logs'::regclass) THEN
    ALTER TABLE public."command_logs" ADD CONSTRAINT "command_logs_command_id_fkey" FOREIGN KEY (command_id) REFERENCES vehicle_commands(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='command_logs_vehicle_id_fkey'
                  AND conrelid='public.command_logs'::regclass) THEN
    ALTER TABLE public."command_logs" ADD CONSTRAINT "command_logs_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='feature_flags_updated_by_fkey'
                  AND conrelid='public.feature_flags'::regclass) THEN
    ALTER TABLE public."feature_flags" ADD CONSTRAINT "feature_flags_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_company_id_fkey'
                  AND conrelid='public.notifications'::regclass) THEN
    ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_profile_id_fkey'
                  AND conrelid='public.notifications'::regclass) THEN
    ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_vehicle_id_fkey'
                  AND conrelid='public.notifications'::regclass) THEN
    ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_releases_rollout_plan_id_fkey'
                  AND conrelid='public.ota_releases'::regclass) THEN
    ALTER TABLE public."ota_releases" ADD CONSTRAINT "ota_releases_rollout_plan_id_fkey" FOREIGN KEY (rollout_plan_id) REFERENCES rollout_plans(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_company_id_fkey'
                  AND conrelid='public.profiles'::regclass) THEN
    ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_id_fkey'
                  AND conrelid='public.profiles'::regclass) THEN
    ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='route_commands_command_id_fkey'
                  AND conrelid='public.route_commands'::regclass) THEN
    ALTER TABLE public."route_commands" ADD CONSTRAINT "route_commands_command_id_fkey" FOREIGN KEY (command_id) REFERENCES vehicle_commands(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='route_commands_vehicle_id_fkey'
                  AND conrelid='public.route_commands'::regclass) THEN
    ALTER TABLE public."route_commands" ADD CONSTRAINT "route_commands_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='runtime_policies_updated_by_fkey'
                  AND conrelid='public.runtime_policies'::regclass) THEN
    ALTER TABLE public."runtime_policies" ADD CONSTRAINT "runtime_policies_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='telemetry_events_company_id_fkey'
                  AND conrelid='public.telemetry_events'::regclass) THEN
    ALTER TABLE public."telemetry_events" ADD CONSTRAINT "telemetry_events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='telemetry_events_vehicle_id_fkey'
                  AND conrelid='public.telemetry_events'::regclass) THEN
    ALTER TABLE public."telemetry_events" ADD CONSTRAINT "telemetry_events_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_commands_company_id_fkey'
                  AND conrelid='public.vehicle_commands'::regclass) THEN
    ALTER TABLE public."vehicle_commands" ADD CONSTRAINT "vehicle_commands_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_commands_created_by_fkey'
                  AND conrelid='public.vehicle_commands'::regclass) THEN
    ALTER TABLE public."vehicle_commands" ADD CONSTRAINT "vehicle_commands_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_commands_issuer_id_fkey'
                  AND conrelid='public.vehicle_commands'::regclass) THEN
    ALTER TABLE public."vehicle_commands" ADD CONSTRAINT "vehicle_commands_issuer_id_fkey" FOREIGN KEY (issuer_id) REFERENCES auth.users(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_commands_sender_id_fkey'
                  AND conrelid='public.vehicle_commands'::regclass) THEN
    ALTER TABLE public."vehicle_commands" ADD CONSTRAINT "vehicle_commands_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_commands_vehicle_id_fkey'
                  AND conrelid='public.vehicle_commands'::regclass) THEN
    ALTER TABLE public."vehicle_commands" ADD CONSTRAINT "vehicle_commands_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_linking_codes_vehicle_id_fkey'
                  AND conrelid='public.vehicle_linking_codes'::regclass) THEN
    ALTER TABLE public."vehicle_linking_codes" ADD CONSTRAINT "vehicle_linking_codes_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_locations_company_id_fkey'
                  AND conrelid='public.vehicle_locations'::regclass) THEN
    ALTER TABLE public."vehicle_locations" ADD CONSTRAINT "vehicle_locations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_locations_vehicle_id_fkey'
                  AND conrelid='public.vehicle_locations'::regclass) THEN
    ALTER TABLE public."vehicle_locations" ADD CONSTRAINT "vehicle_locations_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_pairings_user_id_fkey'
                  AND conrelid='public.vehicle_pairings'::regclass) THEN
    ALTER TABLE public."vehicle_pairings" ADD CONSTRAINT "vehicle_pairings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_pairings_vehicle_id_fkey'
                  AND conrelid='public.vehicle_pairings'::regclass) THEN
    ALTER TABLE public."vehicle_pairings" ADD CONSTRAINT "vehicle_pairings_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_push_tokens_vehicle_id_fkey'
                  AND conrelid='public.vehicle_push_tokens'::regclass) THEN
    ALTER TABLE public."vehicle_push_tokens" ADD CONSTRAINT "vehicle_push_tokens_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_telemetry_vehicle_id_fkey'
                  AND conrelid='public.vehicle_telemetry'::regclass) THEN
    ALTER TABLE public."vehicle_telemetry" ADD CONSTRAINT "vehicle_telemetry_vehicle_id_fkey" FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_company_id_fkey'
                  AND conrelid='public.vehicles'::regclass) THEN
    ALTER TABLE public."vehicles" ADD CONSTRAINT "vehicles_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_owner_id_fkey'
                  AND conrelid='public.vehicles'::regclass) THEN
    ALTER TABLE public."vehicles" ADD CONSTRAINT "vehicles_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── İndeksler (kısıt destekli olanlar hariç) ─────────────────────────
CREATE INDEX IF NOT EXISTS key_beams_expires_at_idx ON public.key_beams USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_company_created ON public.notifications USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_company_ts ON public.notifications USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ota_releases_device_query ON public.ota_releases USING btree (channel, status, version_code DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON public.profiles USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_company ON public.telemetry_events USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_company_id ON public.telemetry_events USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_vehicle_created ON public.telemetry_events USING btree (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_vid_ts ON public.telemetry_events USING btree (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vcmd_ttl ON public.vehicle_commands USING btree (ttl);
CREATE INDEX IF NOT EXISTS idx_vcmd_vehicle_status ON public.vehicle_commands USING btree (vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_log_rate ON public.vehicle_events USING btree (vehicle_id, created_at DESC) WHERE (type = ANY (ARRAY['critical_error'::text, 'crash'::text, 'log'::text, 'obd_diag'::text, 'support_snapshot'::text, 'ota_event'::text, 'voice_diag'::text]));
CREATE INDEX IF NOT EXISTS idx_vehicle_events_type ON public.vehicle_events USING btree (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_vehicle_id ON public.vehicle_events USING btree (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_geofences_active ON public.vehicle_geofences USING btree (vehicle_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_vehicle_loc_company ON public.vehicle_locations USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_loc_vid_ts ON public.vehicle_locations USING btree (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_company_id ON public.vehicle_locations USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_vehicle_created ON public.vehicle_locations USING btree (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_locations_vehicle_created_idx ON public.vehicle_locations USING btree (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_telemetry_ts ON public.vehicle_telemetry USING btree (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_company_id ON public.vehicles USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_owner_id ON public.vehicles USING btree (owner_id);

-- ── Fonksiyonlar (gövdeler prod'dan BİREBİR alındı) ──────────────────
CREATE OR REPLACE FUNCTION public.auth_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select company_id from profiles where id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_paired(p_user uuid, p_vehicle uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from vehicle_pairings where user_id=p_user and vehicle_id=p_vehicle);
$function$;

CREATE OR REPLACE FUNCTION public.is_vehicle_owner(p_vehicle uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from vehicles where id=p_vehicle and owner_id=auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.pair_vehicle_by_code(p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_vehicle_id uuid;
begin
  select id into v_vehicle_id from vehicles where pairing_code = upper(p_code);
  if v_vehicle_id is null then raise exception 'Geçersiz kod: %', p_code; end if;
  insert into vehicle_pairings (user_id, vehicle_id)
  values (auth.uid(), v_vehicle_id) on conflict (user_id, vehicle_id) do nothing;
  return v_vehicle_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pair_vehicle(p_pairing_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE v_vehicle_id uuid; v_api_key text; v_code text; BEGIN v_code := upper(trim(p_pairing_code)); SELECT vlc.vehicle_id, coalesce(v.api_key_hash, v.api_key) INTO v_vehicle_id, v_api_key FROM vehicle_linking_codes vlc JOIN vehicles v ON v.id = vlc.vehicle_id WHERE vlc.code = v_code AND vlc.expires_at > now() LIMIT 1; IF v_vehicle_id IS NULL THEN SELECT id, coalesce(api_key_hash, api_key) INTO v_vehicle_id, v_api_key FROM vehicles WHERE upper(pairing_code) = v_code LIMIT 1; END IF; IF v_vehicle_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Gecersiz eslestirme kodu veya sure dolmus.'); END IF; IF v_api_key IS NULL THEN v_api_key := encode(gen_random_bytes(32), 'hex'); UPDATE vehicles SET api_key_hash = v_api_key WHERE id = v_vehicle_id; END IF; DELETE FROM vehicle_linking_codes WHERE vehicle_id = v_vehicle_id; RETURN jsonb_build_object('success', true, 'vehicle_id', v_vehicle_id, 'api_key', v_api_key); END; $function$;

CREATE OR REPLACE FUNCTION public.refresh_linking_code(p_api_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE v_vehicle_id uuid; v_code text; v_expires_at timestamptz; BEGIN SELECT id
  INTO v_vehicle_id FROM vehicles WHERE api_key_hash = p_api_key OR api_key = p_api_key LIMIT 1; IF v_vehicle_id IS NULL
   THEN RAISE EXCEPTION 'Geçersiz API anahtarı'; END IF; LOOP v_code := lpad((floor(random() * 1000000))::int::text, 6,
  '0'); EXIT WHEN NOT EXISTS (SELECT 1 FROM vehicle_linking_codes WHERE code = v_code AND expires_at > now() AND
  vehicle_id != v_vehicle_id); END LOOP; v_expires_at := now() + interval '5 minutes'; INSERT INTO vehicle_linking_codes
   (vehicle_id, code, expires_at) VALUES (v_vehicle_id, v_code, v_expires_at) ON CONFLICT (vehicle_id) DO UPDATE SET
  code = excluded.code, expires_at = excluded.expires_at; RETURN jsonb_build_object('linking_code', v_code,
  'expires_at', v_expires_at); END; $function$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_linking_codes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cnt integer;
begin
  delete from vehicle_linking_codes where expires_at < now();
  get diagnostics cnt = row_count;
  return cnt;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_plan()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$                                                                                                                                   BEGIN
    RETURN jsonb_build_object(
      'plan',          'trial',
      'trial_ends_at', (now() + interval '30 days')::text,
      'effective',     'pro',
      'is_pro',        true,
      'days_left',     30
    );
  END;
  $function$;

CREATE OR REPLACE FUNCTION public.fn_enforce_critical_pin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pin_hash text;
BEGIN
  -- Sadece kritik komutlar kontrol edilir
  IF NEW.type NOT IN ('unlock', 'alarm_off') THEN
    RETURN NEW;
  END IF;

  -- critical_auth_verified zaten true ise geç (verify_and_send_critical_command'dan geldi)
  IF NEW.critical_auth_verified = true THEN
    RETURN NEW;
  END IF;

  -- Aracın PIN hash'i var mı?
  SELECT critical_pin_hash INTO v_pin_hash
  FROM vehicles WHERE id = NEW.vehicle_id;

  -- PIN tanımlıysa doğrulanmamış INSERT'i reddet
  IF v_pin_hash IS NOT NULL THEN
    RAISE EXCEPTION 'critical_pin_required: Bu komut PIN doğrulaması gerektirir.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_and_send_critical_command(p_vehicle_id uuid, p_type text, p_payload jsonb, p_pin_hash text, p_nonce text DEFAULT NULL::text, p_ttl timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stored_hash text;
  v_command_id  uuid;
  v_ttl         timestamptz;
  v_nonce       text;
BEGIN
  -- Araç sahibi veya eşleşmiş kullanıcı mı?
  IF NOT (is_vehicle_owner(p_vehicle_id) OR is_paired(auth.uid(), p_vehicle_id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Yetkisiz erişim.');
  END IF;

  -- PIN hash kontrolü
  SELECT critical_pin_hash INTO v_stored_hash
  FROM vehicles WHERE id = p_vehicle_id;

  IF v_stored_hash IS NOT NULL AND lower(v_stored_hash) != lower(p_pin_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Yanlış PIN.');
  END IF;

  -- Komut tipi kritik mi?
  IF p_type NOT IN ('unlock', 'alarm_off') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bu komut kritik değil.');
  END IF;

  v_ttl   := COALESCE(p_ttl, now() + interval '5 minutes');
  v_nonce := COALESCE(p_nonce, gen_random_uuid()::text);

  INSERT INTO vehicle_commands (
    vehicle_id, sender_id, type, payload,
    nonce, ttl, critical_auth_verified
  ) VALUES (
    p_vehicle_id, auth.uid(), p_type, p_payload,
    v_nonce, v_ttl, true
  )
  RETURNING id INTO v_command_id;

  RETURN jsonb_build_object('ok', true, 'command_id', v_command_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_vehicle_pin(p_vehicle_id uuid, p_pin_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_vehicle_owner(p_vehicle_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sadece araç sahibi PIN belirleyebilir.');
  END IF;

  -- Basit format kontrolü: 64 hex karakter
  IF p_pin_hash !~ '^[0-9a-fA-F]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Geçersiz PIN hash formatı.');
  END IF;

  UPDATE vehicles SET critical_pin_hash = lower(p_pin_hash)
  WHERE id = p_vehicle_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_push_token(p_vehicle_id uuid, p_fcm_token text, p_platform text DEFAULT 'android'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (is_vehicle_owner(p_vehicle_id) OR is_paired(auth.uid(), p_vehicle_id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Yetkisiz.');
  END IF;

  INSERT INTO vehicle_push_tokens (vehicle_id, fcm_token, platform)
  VALUES (p_vehicle_id, p_fcm_token, p_platform)
  ON CONFLICT (vehicle_id, fcm_token) DO UPDATE
    SET platform = excluded.platform, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_stale_commands()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cnt integer;
begin
  update vehicle_commands
  set status = 'expired', updated_at = now()
  where status in ('pending','accepted','executing') and ttl < now();
  get diagnostics cnt = row_count;
  return cnt;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_command_status(p_api_key text, p_command_id uuid, p_status text, p_accepted_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_executed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_finished_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.increment_command_retry(p_command_id uuid, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_old_telemetry()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_locations integer := 0;
  deleted_events    integer := 0;
  deleted_commands  integer := 0;
  deleted_logs      integer := 0;
BEGIN
  -- 1. Konum geçmişi: 7 günden eski (canlı telemetry snapshot'ı korunur)
  DELETE FROM vehicle_locations
  WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_locations = ROW_COUNT;

  -- 2. Telemetri event'leri: 30 günden eski
  DELETE FROM telemetry_events
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted_events = ROW_COUNT;

  -- 3. Komutlar: terminal durumda ve 14 günden eski
  --    pending/accepted/executing komutlar DOKUNULMAZ (aktif olabilir)
  DELETE FROM vehicle_commands
  WHERE status IN ('completed', 'failed', 'expired', 'rejected')
    AND updated_at < now() - interval '14 days';
  GET DIAGNOSTICS deleted_commands = ROW_COUNT;

  -- 4. Komut logları: 14 günden eski
  DELETE FROM command_logs
  WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS deleted_logs = ROW_COUNT;

  -- 5. Süresi dolmuş bağlama kodları: anında temizle
  DELETE FROM vehicle_linking_codes WHERE expires_at < now();

  RETURN jsonb_build_object(
    'deleted_locations', deleted_locations,
    'deleted_events',    deleted_events,
    'deleted_commands',  deleted_commands,
    'deleted_logs',      deleted_logs,
    'ran_at',            now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_vehicle(p_device_id text, p_name text DEFAULT 'Araç'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE v_vehicle_id uuid; v_api_key text; v_code text; v_expires_at timestamptz;
  BEGIN SELECT id, coalesce(api_key_hash, api_key) INTO v_vehicle_id, v_api_key FROM vehicles WHERE device_name =
  p_device_id LIMIT 1; IF v_vehicle_id IS NULL THEN v_api_key := gen_random_uuid()::text; INSERT INTO vehicles (name,
  device_name, api_key_hash) VALUES (p_name, p_device_id, v_api_key) RETURNING id INTO v_vehicle_id; END IF; LOOP v_code
   := lpad((floor(random() * 1000000))::int::text, 6, '0'); EXIT WHEN NOT EXISTS (SELECT 1 FROM vehicle_linking_codes
  WHERE code = v_code AND expires_at > now()); END LOOP; v_expires_at := now() + interval '5 minutes'; INSERT INTO
  vehicle_linking_codes (vehicle_id, code, expires_at) VALUES (v_vehicle_id, v_code, v_expires_at) ON CONFLICT
  (vehicle_id) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at; RETURN
  jsonb_build_object('vehicle_id', v_vehicle_id, 'api_key', v_api_key, 'linking_code', v_code, 'expires_at',
  v_expires_at); END; $function$;

CREATE OR REPLACE FUNCTION public.push_vehicle_event(p_api_key text, p_type text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_log_types   constant text[]   := ARRAY['critical_error','crash','log','obd_diag','support_snapshot','ota_event','voice_diag'];
  c_max_bytes   constant integer  := 65536;
  c_rate_window constant interval := interval '60 seconds';
  c_rate_max    constant integer  := 30;
  v_vehicle_id  uuid;
  v_company_id  uuid;
  v_event_id    uuid;
  v_payload     jsonb;
  v_store       jsonb;
  v_recent      integer;
  v_lat         double precision;
  v_lng         double precision;
BEGIN
  -- DÜZELTME 024a: api_key → coalesce(api_key_hash, api_key)
  SELECT id, company_id INTO v_vehicle_id, v_company_id
  FROM public.vehicles
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  v_payload := coalesce(p_payload, '{}'::jsonb);

  IF p_type = ANY (c_log_types) THEN
    SELECT count(*) INTO v_recent
    FROM public.vehicle_events
    WHERE vehicle_id = v_vehicle_id::text   -- DÜZELTME 026: TEXT kolon ↔ UUID değişken cast
      AND type = ANY (c_log_types)
      AND created_at > now() - c_rate_window;
    IF v_recent >= c_rate_max THEN
      RETURN NULL;
    END IF;
  END IF;

  v_store := v_payload;
  IF octet_length(v_payload::text) > c_max_bytes THEN
    v_store := jsonb_strip_nulls(jsonb_build_object(
      'truncated', true,
      'type',      p_type,
      'ctx',       left(v_payload->>'ctx',  256),
      'msg',       left(v_payload->>'msg', 2048),
      'errorCode', v_payload->>'errorCode'
    ));
  END IF;

  INSERT INTO public.vehicle_events (vehicle_id, type, metadata)
  VALUES (v_vehicle_id::text, p_type, v_store)   -- DÜZELTME 026: TEXT kolona açık cast
  RETURNING id INTO v_event_id;

  -- DÜZELTME 024c: company_id zorunlu — filoya eşlenmemiş araçta konum atlanır
  v_lat := NULLIF(v_payload->>'lat', '')::double precision;
  v_lng := NULLIF(v_payload->>'lng', '')::double precision;
  IF v_lat IS NOT NULL AND v_lng IS NOT NULL AND v_company_id IS NOT NULL THEN
    INSERT INTO public.vehicle_locations (vehicle_id, company_id, lat, lng, heading_deg)
    VALUES (v_vehicle_id, v_company_id, v_lat, v_lng,
            NULLIF(v_payload->>'heading', '')::double precision);
  END IF;

  -- DÜZELTME 024d: NOT NULL kolonlar coalesce(0); is_online = true
  INSERT INTO public.vehicle_telemetry AS t (vehicle_id, lat, lng, speed, fuel, temp, rpm, is_online, updated_at)
  VALUES (
    v_vehicle_id,
    v_lat,
    v_lng,
    coalesce(NULLIF(v_payload->>'speed', '')::double precision, 0),
    coalesce(NULLIF(v_payload->>'fuel',  '')::double precision, 0),
    coalesce(NULLIF(v_payload->>'temp',  '')::double precision, 0),
    coalesce(NULLIF(v_payload->>'rpm',   '')::double precision, 0),
    true,
    now()
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    lat        = COALESCE(EXCLUDED.lat, t.lat),
    lng        = COALESCE(EXCLUDED.lng, t.lng),
    speed      = EXCLUDED.speed,
    fuel       = CASE WHEN NULLIF(v_payload->>'fuel', '') IS NULL THEN t.fuel ELSE EXCLUDED.fuel END,
    temp       = CASE WHEN NULLIF(v_payload->>'temp', '') IS NULL THEN t.temp ELSE EXCLUDED.temp END,
    rpm        = CASE WHEN NULLIF(v_payload->>'rpm',  '') IS NULL THEN t.rpm  ELSE EXCLUDED.rpm  END,
    is_online  = true,
    updated_at = now();

  RETURN v_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_vehicle_log_events()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.vehicle_events
  WHERE type IN ('critical_error','crash','log','obd_diag','support_snapshot','ota_event','voice_diag')
    AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_key_beam(p_code text, p_ciphertext text, p_iv text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_code IS NULL OR p_code !~ '^[A-Z0-9]{6,10}$' THEN
    RAISE EXCEPTION 'Geçersiz kod formatı';
  END IF;
  IF p_ciphertext IS NULL OR length(p_ciphertext) = 0 OR length(p_ciphertext) > 4000 THEN
    RAISE EXCEPTION 'Geçersiz ciphertext';
  END IF;
  IF p_iv IS NULL OR length(p_iv) = 0 OR length(p_iv) > 100 THEN
    RAISE EXCEPTION 'Geçersiz iv';
  END IF;

  -- Opportunistic cleanup — süresi dolmuş satırları at (cron gerektirmez).
  DELETE FROM public.key_beams WHERE expires_at < now();

  INSERT INTO public.key_beams (code, ciphertext, iv, created_at, expires_at)
  VALUES (p_code, p_ciphertext, p_iv, now(), now() + interval '5 minutes')
  ON CONFLICT (code) DO UPDATE SET
    ciphertext = EXCLUDED.ciphertext,
    iv         = EXCLUDED.iv,
    created_at = now(),
    expires_at = now() + interval '5 minutes';

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_key_beam(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ciphertext text;
  v_iv         text;
BEGIN
  DELETE FROM public.key_beams
  WHERE code = p_code AND expires_at > now()
  RETURNING ciphertext, iv INTO v_ciphertext, v_iv;

  IF v_ciphertext IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object('found', true, 'ciphertext', v_ciphertext, 'iv', v_iv);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_recent_diagnostics(p_type text DEFAULT NULL::text, p_vehicle_id text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, vehicle_id text, type text, metadata jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Backend authz — yalnız super_admin. JWT app_metadata.role service_role tarafından
  -- atanır; kullanıcı forge edemez. Frontend SuperAdminGuard ile aynı claim.
  IF coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'super_admin' THEN
    RAISE EXCEPTION 'get_recent_diagnostics: yetkisiz erişim — yalnız super_admin'
      USING errcode = '42501';  -- insufficient_privilege
  END IF;

  RETURN QUERY
  SELECT e.id, e.vehicle_id::text, e.type, e.metadata, e.created_at
  FROM public.vehicle_events e
  WHERE e.type = ANY (ARRAY['support_snapshot','obd_diag','critical_error','voice_diag'])
    AND (p_type        IS NULL OR e.type = p_type)
    AND (p_vehicle_id  IS NULL OR e.vehicle_id::text = p_vehicle_id)
    AND (p_app_version IS NULL OR e.metadata->>'appVersion' = p_app_version)
    AND (p_since       IS NULL OR e.created_at >= p_since)
    AND (p_until       IS NULL OR e.created_at <= p_until)
  ORDER BY e.created_at DESC
  OFFSET GREATEST(coalesce(p_offset, 0), 0)
  LIMIT  LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END;
$function$;

CREATE OR REPLACE FUNCTION public.push_geofence_zone(p_api_key text, p_zone jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
  v_zone_id    text;
BEGIN
  -- api_key → araç (push_vehicle_event 026 ile birebir aynı auth)
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  -- zone.id yoksa üret (client 'default' verir; polygon çizimleri uuid alır)
  v_zone_id := coalesce(NULLIF(p_zone->>'id', ''), gen_random_uuid()::text);

  INSERT INTO public.vehicle_geofences AS g (
    id, vehicle_id, name, type, polygon, center, radius_m, is_active, updated_at
  )
  VALUES (
    v_zone_id,
    v_vehicle_id::text,                                              -- TEXT kolona açık cast
    p_zone->>'name',
    p_zone->>'type',
    CASE WHEN jsonb_typeof(p_zone->'polygon') = 'array' THEN p_zone->'polygon' ELSE NULL END,
    CASE WHEN jsonb_typeof(p_zone->'center')  IN ('array','object') THEN p_zone->'center' ELSE NULL END,
    NULLIF(p_zone->>'radius_m', '')::numeric,
    coalesce((p_zone->>'is_active')::boolean, true),
    now()
  )
  ON CONFLICT (vehicle_id, id) DO UPDATE SET
    name      = EXCLUDED.name,
    type      = EXCLUDED.type,
    polygon   = EXCLUDED.polygon,
    center    = EXCLUDED.center,
    radius_m  = EXCLUDED.radius_m,
    is_active = EXCLUDED.is_active,
    updated_at = now();

  RETURN v_zone_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_geofence_zones(p_api_key text)
 RETURNS SETOF vehicle_geofences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
BEGIN
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT *
    FROM public.vehicle_geofences
    WHERE vehicle_id = v_vehicle_id::text
      AND is_active = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_geofence_zone(p_api_key text, p_zone_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
BEGIN
  SELECT id INTO v_vehicle_id
  FROM public.vehicles
  WHERE coalesce(api_key_hash, api_key) = p_api_key;
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.vehicle_geofences
  SET is_active = false, updated_at = now()
  WHERE vehicle_id = v_vehicle_id::text
    AND id = p_zone_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_support_reports(p_secret text, p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, vehicle_id text, type text, metadata jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Token doğrulama (bcrypt). Hash yoksa veya eşleşmezse erişim yok.
  IF NOT EXISTS (
    SELECT 1 FROM public.support_reader_secret s
    WHERE s.id = 1 AND s.secret_hash = crypt(p_secret, s.secret_hash)
  ) THEN
    RAISE EXCEPTION 'get_support_reports: yetkisiz — geçersiz token'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT e.id, e.vehicle_id::text, e.type, e.metadata, e.created_at
  FROM public.vehicle_events e
  WHERE e.type = 'support_snapshot'          -- SADECE destek raporları (geniş açık değil)
  ORDER BY e.created_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 5), 1), 50);
END;
$function$;

-- ── Trigger'lar ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS "on_auth_user_created" ON auth."users";
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
DROP TRIGGER IF EXISTS "trg_commands_updated_at" ON public."vehicle_commands";
CREATE TRIGGER trg_commands_updated_at BEFORE UPDATE ON public.vehicle_commands FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
DROP TRIGGER IF EXISTS "trigger_enforce_critical_pin" ON public."vehicle_commands";
CREATE TRIGGER trigger_enforce_critical_pin BEFORE INSERT ON public.vehicle_commands FOR EACH ROW EXECUTE FUNCTION fn_enforce_critical_pin();
DROP TRIGGER IF EXISTS "trg_push_tokens_updated_at" ON public."vehicle_push_tokens";
CREATE TRIGGER trg_push_tokens_updated_at BEFORE UPDATE ON public.vehicle_push_tokens FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
DROP TRIGGER IF EXISTS "trg_vehicles_updated_at" ON public."vehicles";
CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."command_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."key_beams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ota_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."rollout_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."route_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."runtime_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."support_reader_secret" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."telemetry_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vehicle_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vehicle_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vehicle_geofences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vehicle_linking_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vehicle_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vehicle_pairings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vehicle_push_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vehicle_telemetry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."vehicles" ENABLE ROW LEVEL SECURITY;

-- ── RLS politikaları ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "superadmin_read_audit" ON public."audit_logs";
CREATE POLICY "superadmin_read_audit" ON public."audit_logs"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text));
DROP POLICY IF EXISTS "superadmin_write_audit" ON public."audit_logs";
CREATE POLICY "superadmin_write_audit" ON public."audit_logs"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text));
DROP POLICY IF EXISTS "companies: kendi şirketini gör" ON public."companies";
CREATE POLICY "companies: kendi şirketini gör" ON public."companies"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((id = auth_company_id()));
DROP POLICY IF EXISTS "company_isolation_select_companies" ON public."companies";
CREATE POLICY "company_isolation_select_companies" ON public."companies"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((id = auth_company_id()));
DROP POLICY IF EXISTS "anon_read_flags" ON public."feature_flags";
CREATE POLICY "anon_read_flags" ON public."feature_flags"
  AS PERMISSIVE
  FOR SELECT
  TO "anon"
  USING (true);
DROP POLICY IF EXISTS "superadmin_all_flags" ON public."feature_flags";
CREATE POLICY "superadmin_all_flags" ON public."feature_flags"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text));
DROP POLICY IF EXISTS "no_direct_access" ON public."key_beams";
CREATE POLICY "no_direct_access" ON public."key_beams"
  AS PERMISSIVE
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);
DROP POLICY IF EXISTS "company_isolation_mutate_notifications" ON public."notifications";
CREATE POLICY "company_isolation_mutate_notifications" ON public."notifications"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((company_id = auth_company_id()))
  WITH CHECK ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "company_isolation_select_notifications" ON public."notifications";
CREATE POLICY "company_isolation_select_notifications" ON public."notifications"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "notifications: şirket izolasyonu mutate" ON public."notifications";
CREATE POLICY "notifications: şirket izolasyonu mutate" ON public."notifications"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((company_id = auth_company_id()))
  WITH CHECK ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "notifications: şirket izolasyonu select" ON public."notifications";
CREATE POLICY "notifications: şirket izolasyonu select" ON public."notifications"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "ota_releases_auth_read_active" ON public."ota_releases";
CREATE POLICY "ota_releases_auth_read_active" ON public."ota_releases"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((status = 'active'::text));
DROP POLICY IF EXISTS "ota_releases_device_read" ON public."ota_releases";
CREATE POLICY "ota_releases_device_read" ON public."ota_releases"
  AS PERMISSIVE
  FOR SELECT
  TO "anon"
  USING ((status = 'active'::text));
DROP POLICY IF EXISTS "ota_releases_superadmin_all" ON public."ota_releases";
CREATE POLICY "ota_releases_superadmin_all" ON public."ota_releases"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text))
  WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text));
DROP POLICY IF EXISTS "company_isolation_mutate_profiles" ON public."profiles";
CREATE POLICY "company_isolation_mutate_profiles" ON public."profiles"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((company_id = auth_company_id()))
  WITH CHECK ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "company_isolation_select_profiles" ON public."profiles";
CREATE POLICY "company_isolation_select_profiles" ON public."profiles"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "profiles: kendi kaydı" ON public."profiles";
CREATE POLICY "profiles: kendi kaydı" ON public."profiles"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));
DROP POLICY IF EXISTS "profiles: şirket üyelerini gör" ON public."profiles";
CREATE POLICY "profiles: şirket üyelerini gör" ON public."profiles"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "superadmin_rollouts" ON public."rollout_plans";
CREATE POLICY "superadmin_rollouts" ON public."rollout_plans"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text))
  WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text));
DROP POLICY IF EXISTS "Company Isolation for Route Details" ON public."route_commands";
CREATE POLICY "Company Isolation for Route Details" ON public."route_commands"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((command_id IN ( SELECT vehicle_commands.id
   FROM vehicle_commands)));
DROP POLICY IF EXISTS "route_commands: eslesmis" ON public."route_commands";
CREATE POLICY "route_commands: eslesmis" ON public."route_commands"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)));
DROP POLICY IF EXISTS "anon_read_policies" ON public."runtime_policies";
CREATE POLICY "anon_read_policies" ON public."runtime_policies"
  AS PERMISSIVE
  FOR SELECT
  TO "anon"
  USING (true);
DROP POLICY IF EXISTS "superadmin_all_policies" ON public."runtime_policies";
CREATE POLICY "superadmin_all_policies" ON public."runtime_policies"
  AS PERMISSIVE
  FOR ALL
  TO "authenticated"
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text));
DROP POLICY IF EXISTS "company_isolation_mutate_telemetry_events" ON public."telemetry_events";
CREATE POLICY "company_isolation_mutate_telemetry_events" ON public."telemetry_events"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((company_id = auth_company_id()))
  WITH CHECK ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "company_isolation_select_telemetry_events" ON public."telemetry_events";
CREATE POLICY "company_isolation_select_telemetry_events" ON public."telemetry_events"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "telemetry: şirket izolasyonu mutate" ON public."telemetry_events";
CREATE POLICY "telemetry: şirket izolasyonu mutate" ON public."telemetry_events"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((company_id = auth_company_id()))
  WITH CHECK ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "telemetry: şirket izolasyonu select" ON public."telemetry_events";
CREATE POLICY "telemetry: şirket izolasyonu select" ON public."telemetry_events"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "Company Isolation for Commands" ON public."vehicle_commands";
CREATE POLICY "Company Isolation for Commands" ON public."vehicle_commands"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
DROP POLICY IF EXISTS "commands: gonderebilir" ON public."vehicle_commands";
CREATE POLICY "commands: gonderebilir" ON public."vehicle_commands"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)) AND (ttl > now())));
DROP POLICY IF EXISTS "commands: guncelleyebilir" ON public."vehicle_commands";
CREATE POLICY "commands: guncelleyebilir" ON public."vehicle_commands"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)))
  WITH CHECK (((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)) AND (status = ANY (ARRAY['accepted'::text, 'executing'::text, 'completed'::text, 'failed'::text, 'rejected'::text]))));
DROP POLICY IF EXISTS "commands: okuyabilir" ON public."vehicle_commands";
CREATE POLICY "commands: okuyabilir" ON public."vehicle_commands"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)));
DROP POLICY IF EXISTS "Kendi aracı için olay ekle" ON public."vehicle_events";
CREATE POLICY "Kendi aracı için olay ekle" ON public."vehicle_events"
  AS PERMISSIVE
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((vehicle_id IN ( SELECT (vehicles.id)::text AS id
   FROM vehicles
  WHERE (vehicles.owner_id = auth.uid()))));
DROP POLICY IF EXISTS "Kendi araç olaylarını oku" ON public."vehicle_events";
CREATE POLICY "Kendi araç olaylarını oku" ON public."vehicle_events"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((vehicle_id IN ( SELECT (vehicles.id)::text AS id
   FROM vehicles
  WHERE (vehicles.owner_id = auth.uid()))));
DROP POLICY IF EXISTS "Servis rolü tam erişim" ON public."vehicle_events";
CREATE POLICY "Servis rolü tam erişim" ON public."vehicle_events"
  AS PERMISSIVE
  FOR ALL
  TO "service_role"
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS "superadmin_select_vehicle_events" ON public."vehicle_events";
CREATE POLICY "superadmin_select_vehicle_events" ON public."vehicle_events"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text));
DROP POLICY IF EXISTS "superadmin_select_vehicle_geofences" ON public."vehicle_geofences";
CREATE POLICY "superadmin_select_vehicle_geofences" ON public."vehicle_geofences"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text));
DROP POLICY IF EXISTS "company_isolation_mutate_vehicle_locations" ON public."vehicle_locations";
CREATE POLICY "company_isolation_mutate_vehicle_locations" ON public."vehicle_locations"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((company_id = auth_company_id()))
  WITH CHECK ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "company_isolation_select_vehicle_locations" ON public."vehicle_locations";
CREATE POLICY "company_isolation_select_vehicle_locations" ON public."vehicle_locations"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((company_id = auth_company_id()));
DROP POLICY IF EXISTS "locations: erişim" ON public."vehicle_locations";
CREATE POLICY "locations: erişim" ON public."vehicle_locations"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((company_id = auth_company_id()) OR is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)));
DROP POLICY IF EXISTS "locations: yazma" ON public."vehicle_locations";
CREATE POLICY "locations: yazma" ON public."vehicle_locations"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)));
DROP POLICY IF EXISTS "user_select_vehicle_locations" ON public."vehicle_locations";
CREATE POLICY "user_select_vehicle_locations" ON public."vehicle_locations"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((vehicle_id IN ( SELECT vehicles.id
   FROM vehicles)));
DROP POLICY IF EXISTS "pairings: kendi eslesmeleri" ON public."vehicle_pairings";
CREATE POLICY "pairings: kendi eslesmeleri" ON public."vehicle_pairings"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS "push_tokens: owner upsert" ON public."vehicle_push_tokens";
CREATE POLICY "push_tokens: owner upsert" ON public."vehicle_push_tokens"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)))
  WITH CHECK ((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)));
DROP POLICY IF EXISTS "telemetry_snap: insert" ON public."vehicle_telemetry";
CREATE POLICY "telemetry_snap: insert" ON public."vehicle_telemetry"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)));
DROP POLICY IF EXISTS "telemetry_snap: select" ON public."vehicle_telemetry";
CREATE POLICY "telemetry_snap: select" ON public."vehicle_telemetry"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)));
DROP POLICY IF EXISTS "telemetry_snap: update" ON public."vehicle_telemetry";
CREATE POLICY "telemetry_snap: update" ON public."vehicle_telemetry"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((is_vehicle_owner(vehicle_id) OR is_paired(auth.uid(), vehicle_id)));
DROP POLICY IF EXISTS "user_select_vehicle_telemetry" ON public."vehicle_telemetry";
CREATE POLICY "user_select_vehicle_telemetry" ON public."vehicle_telemetry"
  AS PERMISSIVE
  FOR SELECT
  TO "authenticated"
  USING ((vehicle_id IN ( SELECT vehicles.id
   FROM vehicles)));
DROP POLICY IF EXISTS "vehicles: owner delete" ON public."vehicles";
CREATE POLICY "vehicles: owner delete" ON public."vehicles"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((owner_id = auth.uid()) OR (company_id = auth_company_id())));
DROP POLICY IF EXISTS "vehicles: owner insert" ON public."vehicles";
CREATE POLICY "vehicles: owner insert" ON public."vehicles"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((owner_id = auth.uid()) OR (company_id = auth_company_id())));
DROP POLICY IF EXISTS "vehicles: owner update" ON public."vehicles";
CREATE POLICY "vehicles: owner update" ON public."vehicles"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((owner_id = auth.uid()) OR (company_id = auth_company_id())))
  WITH CHECK (((owner_id = auth.uid()) OR (company_id = auth_company_id())));
DROP POLICY IF EXISTS "vehicles: owner veya şirket select" ON public."vehicles";
CREATE POLICY "vehicles: owner veya şirket select" ON public."vehicles"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((owner_id = auth.uid()) OR (company_id = auth_company_id()) OR is_paired(auth.uid(), id)));

-- ── Rol ayrıcalıkları (prod'daki ACL'lerin BİREBİR karşılığı) ────────
-- Önce sıfırla, sonra prod'daki kümeyi ver → hedef ortamın varsayılan
-- ayrıcalıklarından BAĞIMSIZ olarak prod ile aynı sonucu üretir.
REVOKE ALL ON TABLE public."audit_logs" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."audit_logs" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."audit_logs" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."audit_logs" TO service_role;
REVOKE ALL ON TABLE public."command_logs" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."command_logs" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."command_logs" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."command_logs" TO service_role;
REVOKE ALL ON TABLE public."companies" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."companies" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."companies" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."companies" TO service_role;
REVOKE ALL ON TABLE public."feature_flags" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."feature_flags" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."feature_flags" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."feature_flags" TO service_role;
REVOKE ALL ON TABLE public."key_beams" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."key_beams" TO service_role;
REVOKE ALL ON TABLE public."notifications" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."notifications" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."notifications" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."notifications" TO service_role;
REVOKE ALL ON TABLE public."ota_releases" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."ota_releases" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."ota_releases" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."ota_releases" TO service_role;
REVOKE ALL ON TABLE public."profiles" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."profiles" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."profiles" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."profiles" TO service_role;
REVOKE ALL ON TABLE public."rollout_plans" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."rollout_plans" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."rollout_plans" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."rollout_plans" TO service_role;
REVOKE ALL ON TABLE public."route_commands" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."route_commands" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."route_commands" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."route_commands" TO service_role;
REVOKE ALL ON TABLE public."runtime_policies" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."runtime_policies" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."runtime_policies" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."runtime_policies" TO service_role;
REVOKE ALL ON TABLE public."support_reader_secret" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."support_reader_secret" TO service_role;
REVOKE ALL ON TABLE public."telemetry_events" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."telemetry_events" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."telemetry_events" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."telemetry_events" TO service_role;
REVOKE ALL ON TABLE public."vehicle_commands" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_commands" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_commands" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_commands" TO service_role;
REVOKE ALL ON TABLE public."vehicle_events" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_events" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_events" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_events" TO service_role;
REVOKE ALL ON TABLE public."vehicle_geofences" FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public."vehicle_geofences" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_geofences" TO service_role;
REVOKE ALL ON TABLE public."vehicle_linking_codes" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_linking_codes" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_linking_codes" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_linking_codes" TO service_role;
REVOKE ALL ON TABLE public."vehicle_locations" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_locations" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_locations" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_locations" TO service_role;
REVOKE ALL ON TABLE public."vehicle_pairings" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_pairings" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_pairings" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_pairings" TO service_role;
REVOKE ALL ON TABLE public."vehicle_push_tokens" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_push_tokens" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_push_tokens" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_push_tokens" TO service_role;
REVOKE ALL ON TABLE public."vehicle_telemetry" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_telemetry" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_telemetry" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicle_telemetry" TO service_role;
REVOKE ALL ON TABLE public."vehicles" FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicles" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicles" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."vehicles" TO service_role;

-- ── Realtime yayını ──────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr
                   JOIN pg_publication pb ON pb.oid=pr.prpubid
                  WHERE pb.pubname='supabase_realtime'
                    AND pr.prrelid='public.route_commands'::regclass) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."route_commands";
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr
                   JOIN pg_publication pb ON pb.oid=pr.prpubid
                  WHERE pb.pubname='supabase_realtime'
                    AND pr.prrelid='public.vehicle_commands'::regclass) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."vehicle_commands";
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr
                   JOIN pg_publication pb ON pb.oid=pr.prpubid
                  WHERE pb.pubname='supabase_realtime'
                    AND pr.prrelid='public.vehicle_events'::regclass) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."vehicle_events";
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr
                   JOIN pg_publication pb ON pb.oid=pr.prpubid
                  WHERE pb.pubname='supabase_realtime'
                    AND pr.prrelid='public.vehicle_locations'::regclass) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."vehicle_locations";
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr
                   JOIN pg_publication pb ON pb.oid=pr.prpubid
                  WHERE pb.pubname='supabase_realtime'
                    AND pr.prrelid='public.vehicle_telemetry'::regclass) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."vehicle_telemetry";
  END IF;
END $$;

-- ── Zamanlanmış iş (prod'da canlı: günlük telemetri temizliği) ───────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE command='SELECT cleanup_old_telemetry()') THEN
    PERFORM cron.schedule('cleanup-old-telemetry', '0 3 * * *', 'SELECT cleanup_old_telemetry()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'baseline: cron işi kurulamadı (%), platformda pg_cron yok olabilir', SQLERRM;
END $$;

-- ── Storage: bucket'lar ve nesne politikaları (prod'dan okundu) ──────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sentry_clips', 'sentry_clips', false, 52428800, ARRAY['video/mp4'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "sentry_clips_delete" ON storage."objects";
CREATE POLICY "sentry_clips_delete" ON storage."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'sentry_clips'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
DROP POLICY IF EXISTS "sentry_clips_insert" ON storage."objects";
CREATE POLICY "sentry_clips_insert" ON storage."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'sentry_clips'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
DROP POLICY IF EXISTS "sentry_clips_select" ON storage."objects";
CREATE POLICY "sentry_clips_select" ON storage."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'sentry_clips'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
DROP POLICY IF EXISTS "sentry_clips_service_role" ON storage."objects";
CREATE POLICY "sentry_clips_service_role" ON storage."objects"
  FOR ALL
  TO "service_role"
  USING ((bucket_id = 'sentry_clips'::text))
  WITH CHECK ((bucket_id = 'sentry_clips'::text));
DROP POLICY IF EXISTS "sentry_clips_update" ON storage."objects";
CREATE POLICY "sentry_clips_update" ON storage."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'sentry_clips'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

