-- ============================================================================
-- CAROS PRO — Canonical Schema Verification (READ-ONLY)   [PR-SQL-1 tooling]
-- ============================================================================
-- AMAÇ: Bir DB'nin (shadow/local — ASLA production) kanonik şemaya uygunluğunu
-- SALT-OKUMA sorgularıyla doğrular. Hiçbir DDL/DML İÇERMEZ (yalnız SELECT).
--
-- KULLANIM:
--   psql "$SHADOW_DB_URL" -f supabase/verification/verify_canonical_schema.sql
--   (veya Supabase Studio SQL editöründe bir NON-PROD projede)
--
-- GÜVENLİK:
--   * Bu dosya SELECT dışında hiçbir ifade içermez → çalıştırmak veriyi değiştirmez.
--   * Production'a KOŞMAYIN; amaç migration'ları shadow DB'de doğrulamaktır.
-- ============================================================================

\echo '== 1. Beklenen tablolar var mı (public) =='
WITH expected(t) AS (
  VALUES ('audit_logs'),('command_logs'),('companies'),('feature_flags'),('key_beams'),
         ('notifications'),('ota_releases'),('profiles'),('rollout_plans'),('route_commands'),
         ('runtime_policies'),('telemetry_events'),('vehicle_commands'),('vehicle_events'),
         ('vehicle_geofences'),('vehicle_linking_codes'),('vehicle_locations'),
         ('vehicle_pairings'),('vehicle_push_tokens'),('vehicle_telemetry'),('vehicles')
)
SELECT e.t AS table_name,
       (to_regclass('public.'||e.t) IS NOT NULL) AS exists
FROM expected e
ORDER BY exists, e.t;

\echo '== 2. RLS açık mı (public tablolar) =='
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity, c.relname;

\echo '== 3. GRANT matrisi (anon / authenticated / service_role) =='
-- 🔴 anon üzerinde DELETE/UPDATE/TRUNCATE beklenmez; çıkanları hardening'e (PR-SQL-4) alın.
SELECT table_name, grantee,
       string_agg(DISTINCT left(privilege_type,1), '' ORDER BY left(privilege_type,1)) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated','service_role')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

\echo '== 3b. 🔴 anon YAZMA grant''ı olan tablolar (defense-in-depth ihlali) =='
SELECT DISTINCT table_name
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'anon'
  AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
ORDER BY table_name;

\echo '== 4. Policy envanteri (rol + komut + qual) =='
SELECT schemaname, tablename, policyname, roles, cmd,
       left(qual, 80)       AS using_qual,
       left(with_check, 80) AS with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

\echo '== 4b. anon USING(true) SELECT policy''leri (scope daraltma adayı) =='
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname='public' AND cmd='SELECT'
  AND 'anon' = ANY(roles) AND btrim(coalesce(qual,'')) = 'true'
ORDER BY tablename;

\echo '== 5. vehicle_id tip envanteri (UUID/TEXT) =='
SELECT table_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND column_name='vehicle_id'
ORDER BY data_type, table_name;

\echo '== 5b. FK-uyumsuz vehicle_id (vehicles.id ile tip farkı) =='
WITH veh AS (
  SELECT data_type AS id_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='vehicles' AND column_name='id'
)
SELECT c.table_name, c.data_type AS vehicle_id_type, veh.id_type AS vehicles_id_type
FROM information_schema.columns c CROSS JOIN veh
WHERE c.table_schema='public' AND c.column_name='vehicle_id'
  AND c.data_type <> veh.id_type
ORDER BY c.table_name;

\echo '== 6. Foreign key''ler (vehicle_* → vehicles) =='
SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_col,
       rc.delete_rule AS on_delete
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
ORDER BY tc.table_name, kcu.column_name;

\echo '== 7. Sorgulanan kolonlarda index var mı (vehicle_id + created_at) =='
SELECT t.relname AS table_name, i.relname AS index_name,
       array_to_string(array_agg(a.attname ORDER BY k.ord), ',') AS cols
FROM pg_index ix
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
WHERE n.nspname='public' AND t.relname LIKE 'vehicle_%'
GROUP BY t.relname, i.relname
ORDER BY t.relname, i.relname;

\echo '== 8. RPC signature envanteri (public fonksiyonlar) =='
SELECT p.proname AS routine,
       pg_get_function_identity_arguments(p.oid) AS args,
       t.typname AS returns,
       p.prosecdef AS security_definer,
       (SELECT string_agg(cfg,' ') FROM unnest(coalesce(p.proconfig,'{}')) cfg) AS config  -- search_path vb.
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_type t ON t.oid = p.prorettype
WHERE n.nspname='public'
ORDER BY p.proname;

\echo '== 8b. SECURITY DEFINER RPC''lerde search_path pinlenmiş mi (güvenlik) =='
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
  AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')
ORDER BY p.proname;

\echo '== 9. Kanonik RPC beklenenler var mı =='
WITH expected(fn) AS (
  VALUES ('push_vehicle_event'),('register_vehicle'),('register_push_token'),
         ('get_geofence_zones'),('get_recent_diagnostics'),('increment_command_retry'),
         ('submit_key_beam'),('consume_key_beam'),('pair_vehicle'),('get_my_plan'),
         ('update_command_status'),('refresh_linking_code'),('cleanup_old_telemetry')
)
SELECT e.fn AS routine,
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname=e.fn) AS exists
FROM expected e ORDER BY exists, e.fn;

\echo '== DONE (salt-okuma) =='
