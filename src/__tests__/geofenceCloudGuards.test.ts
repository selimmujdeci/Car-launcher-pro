/**
 * geofenceCloudGuards.test.ts — Bulut geofence (migration 028) güvenlik kilidi
 *
 * Migration SQL'i lokalde koşulamadığında bile şema ↔ kod sözleşmesini kilitler
 * (remoteLogGuards.test.ts deseni). En kritik kilit KONUM MAHREMİYETİ:
 *   - vehicle_geofences tablosuna anon'a DOĞRUDAN erişim YOK (tablo GRANT yok,
 *     USING(true) policy yok) → bir aracın api_key'i ile TÜM araçların ev/park
 *     konumu okunamaz.
 *   - Cihaz okuması get_geofence_zones SECURITY DEFINER RPC'sinden geçer; RPC
 *     api_key'i araca çözer ve yalnız o aracın bölgelerini döndürür.
 *   - Yazma push_geofence_zone / silme delete_geofence_zone da api_key auth'lu.
 *   - Client (security/geofenceService.ts) okuma yolu .from(TABLE) DEĞİL
 *     .rpc('get_geofence_zones') kullanır (regresyon kilidi).
 *
 * NOT: ?raw = transform-time sabit (readFileSync paralel-suite flake'inden
 * bağışık — regression.guards.test.ts dersi). Gerçek DB'de verification DO
 * bloklarının PASS etmesi Supabase'e push gerektirir; burada statik sözleşme.
 */
import { describe, it, expect } from 'vitest';
import migrationSql from '../../supabase/migrations/20260706000028_vehicle_geofences.sql?raw';
import geofenceSecSrc from '../platform/security/geofenceService.ts?raw';

// Negatif (mahremiyet) assertion'ları YALNIZ çalıştırılabilir SQL'i denetlemeli;
// `--` yorumları (bu dosyanın açıklama başlığı dahil "USING(true)"/"GRANT" gibi
// kelimeler taşır) soyulur → yorum metni testi tetiklemez.
const sqlExec = migrationSql.replace(/--[^\n]*/g, '');

describe('migration 028 — tablo şeması', () => {
  it('vehicle_geofences idempotent oluşturulur (IF NOT EXISTS)', () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.vehicle_geofences/);
  });

  it('vehicle_id TEXT (vehicle_events sapmasıyla tutarlı)', () => {
    expect(migrationSql).toMatch(/vehicle_id\s+text\s+NOT NULL/);
  });

  it('composite PK (vehicle_id, id) — id global tekil değil', () => {
    expect(migrationSql).toMatch(/PRIMARY KEY \(vehicle_id, id\)/);
  });

  it('type CHECK yalnız polygon|circle', () => {
    expect(migrationSql).toMatch(/CHECK \(type IN \('polygon', 'circle'\)\)/);
  });
});

describe('migration 028 — 🔒 KONUM MAHREMİYETİ (en kritik)', () => {
  it('anon\'a TABLO GRANT\'i YOK (yalnız RPC EXECUTE ile erişir)', () => {
    // Tablo GRANT satırlarında (yorumsuz SQL) anon geçmemeli
    const tableGrants = sqlExec.match(/GRANT[^;]*ON public\.vehicle_geofences[^;]*;/g) ?? [];
    expect(tableGrants.length).toBeGreaterThan(0);
    for (const g of tableGrants) {
      expect(g, `anon'a tablo GRANT sızmış: ${g}`).not.toMatch(/\banon\b/);
    }
  });

  it('USING(true) YASAK — hiçbir policy tüm satırları açmaz', () => {
    expect(sqlExec).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });

  it('anon için SELECT policy YOK (yalnız super_admin doğrudan okur)', () => {
    // CREATE POLICY ... TO anon geçmemeli (yorumsuz SQL)
    expect(sqlExec).not.toMatch(/CREATE POLICY[^;]*TO anon/i);
  });

  it('RLS açık + super_admin policy app_metadata role ile (021 deseni)', () => {
    expect(migrationSql).toMatch(/ALTER TABLE public\.vehicle_geofences ENABLE ROW LEVEL SECURITY/);
    expect(migrationSql).toMatch(/CREATE POLICY "superadmin_select_vehicle_geofences"/);
    expect(migrationSql).toMatch(/\(auth\.jwt\(\) -> 'app_metadata' ->> 'role'\) = 'super_admin'/);
  });
});

describe('migration 028 — RPC üçlüsü (SECURITY DEFINER, api_key auth)', () => {
  const RPCS = [
    { name: 'push_geofence_zone',   sig: 'p_api_key text, p_zone jsonb',    ret: 'text' },
    { name: 'get_geofence_zones',   sig: 'p_api_key text',                  ret: 'SETOF public.vehicle_geofences' },
    { name: 'delete_geofence_zone', sig: 'p_api_key text, p_zone_id text',  ret: 'void' },
  ];

  for (const rpc of RPCS) {
    it(`${rpc.name}: SECURITY DEFINER + search_path public + api_key çözümü`, () => {
      const fnStart = migrationSql.indexOf(`FUNCTION public.${rpc.name}(`);
      expect(fnStart, `${rpc.name} tanımı yok`).toBeGreaterThan(-1);
      const fnBody = migrationSql.slice(fnStart, fnStart + 1400);
      expect(fnBody).toContain('SECURITY DEFINER');
      expect(fnBody).toMatch(/SET search_path TO 'public'/);
      // push_vehicle_event 026 ile aynı auth: coalesce(api_key_hash, api_key)
      expect(fnBody).toMatch(/coalesce\(api_key_hash, api_key\) = p_api_key/);
      expect(fnBody).toMatch(/RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001'/);
    });
  }

  it('push_geofence_zone: composite PK üzerinden upsert (ON CONFLICT)', () => {
    expect(migrationSql).toMatch(/ON CONFLICT \(vehicle_id, id\) DO UPDATE SET/);
    expect(migrationSql).toMatch(/v_zone_id := coalesce\(NULLIF\(p_zone->>'id', ''\), gen_random_uuid\(\)::text\)/);
  });

  it('get_geofence_zones: yalnız çözülen aracın AKTİF bölgelerini döndürür', () => {
    expect(migrationSql).toMatch(/WHERE vehicle_id = v_vehicle_id::text\s+AND is_active = true/);
  });

  it('delete_geofence_zone: soft delete (is_active=false), api_key scoped', () => {
    expect(migrationSql).toMatch(/SET is_active = false, updated_at = now\(\)\s+WHERE vehicle_id = v_vehicle_id::text\s+AND id = p_zone_id/);
  });
});

describe('migration 028 — RPC GRANT/REVOKE (PUBLIC sızıntısı yok)', () => {
  const RPC_SIGS = [
    'push_geofence_zone(text, jsonb)',
    'get_geofence_zones(text)',
    'delete_geofence_zone(text, text)',
  ];
  for (const sig of RPC_SIGS) {
    it(`${sig}: PUBLIC revoke + anon/authenticated EXECUTE`, () => {
      expect(migrationSql).toContain(`REVOKE ALL     ON FUNCTION public.${sig} FROM PUBLIC`);
      expect(migrationSql).toContain(`GRANT  EXECUTE ON FUNCTION public.${sig} TO anon, authenticated`);
    });
  }
});

describe('migration 028 — verification DO bloğu (CLAUDE.md dörtlüsü)', () => {
  it('RPC sayısı, RLS, anon-tablo-sızıntısı, GRANT eksikte EXCEPTION', () => {
    expect(migrationSql).toContain('information_schema.role_table_grants');
    expect(migrationSql).toContain('information_schema.routine_privileges');
    expect(migrationSql).toContain('pg_tables');
    expect(migrationSql).toMatch(/RAISE EXCEPTION 'vehicle_geofences: RPC eksik/);
    expect(migrationSql).toMatch(/RAISE EXCEPTION 'vehicle_geofences: RLS kapalı/);
    expect(migrationSql).toMatch(/RAISE EXCEPTION 'vehicle_geofences: anon''a tablo GRANT sızdı/);
    expect(migrationSql).toMatch(/RAISE EXCEPTION 'vehicle_geofences: authenticated SELECT GRANT eksik/);
  });
});

describe('client — okuma yolu RPC\'den geçer (doğrudan tablo erişimi değil)', () => {
  it('security/geofenceService okuma get_geofence_zones RPC\'sini çağırır', () => {
    expect(geofenceSecSrc).toMatch(/\.rpc\(\s*'get_geofence_zones'/);
  });

  it('okuma yolu .from(TABLE).select KULLANMAZ (mahremiyet — doğrudan tablo yok)', () => {
    // Eski desen: supabase.from('vehicle_geofences').select(...).eq('vehicle_id',...)
    expect(geofenceSecSrc).not.toMatch(/\.from\(\s*['"]vehicle_geofences['"]\s*\)/);
    expect(geofenceSecSrc).not.toMatch(/\.from\(TABLE\)/);
  });

  it('yazma push_geofence_zone / silme delete_geofence_zone RPC endpoint\'ine gider', () => {
    expect(geofenceSecSrc).toContain('/push_geofence_zone');
    expect(geofenceSecSrc).toContain('/delete_geofence_zone');
  });
});
