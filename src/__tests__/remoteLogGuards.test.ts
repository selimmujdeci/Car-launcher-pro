/**
 * remoteLogGuards.test.ts — Remote Log v1 / Commit 1: ingestion bekçileri
 *
 * Migration SQL'i lokalde koşulamadığında (Docker/linked proje yok) bile
 * şema ↔ kod sözleşmesini kilitler (otaSchema.test.ts deseni):
 *  - payload >16KB kırpılıyor (truncated/type/ctx/msg + errorCode varsa)
 *  - payload <=16KB aynen geçiyor (v_store := v_payload varsayılanı)
 *  - rate limit: 60 sn / 30 event, exception YOK → kontrollü RETURN NULL
 *  - log dışı eventler (system_health vb.) bekçilerden etkilenmiyor
 *  - 30 gün retention + pg_cron / fallback dokümantasyonu
 *  - migration 017 köprüsü (locations/telemetry) aynen korunuyor
 *  - GRANT/REVOKE + verification DO bloğu (CLAUDE.md dörtlüsü)
 *
 * NOT: Gerçek DB'de koşum (verification DO bloklarının PASS etmesi)
 * Supabase projesine push gerektirir — burada statik sözleşme test edilir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR  = join(process.cwd(), 'supabase', 'migrations');
const GUARD_FN = '20260610000020_remote_log_guards.sql';

const sql = readFileSync(join(MIG_DIR, GUARD_FN), 'utf-8');

// Rate limit + retention'a tabi log event sınıfı
const LOG_TYPES = ['critical_error', 'crash', 'log', 'obd_diag', 'support_snapshot', 'ota_event'];

describe('migration dosyası', () => {
  it('timestamp sırası: mevcut en yeni migration\'dan SONRA gelir', () => {
    const stamped = readdirSync(MIG_DIR)
      .filter((f) => /^\d{8}/.test(f) && f !== GUARD_FN)
      .sort();
    const newest = stamped[stamped.length - 1];
    expect(GUARD_FN > newest).toBe(true);
  });

  it('RPC imzası değişmedi: (p_api_key, p_type, p_payload jsonb DEFAULT) → uuid', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.push_vehicle_event\(\s*p_api_key text,\s*p_type\s+text,\s*p_payload jsonb DEFAULT '\{\}'\s*\) RETURNS uuid/);
    // İmza aynı olduğu için DROP FUNCTION gerekmez — mevcut GRANT'lar korunur
    expect(sql).not.toContain('DROP FUNCTION');
  });
});

describe('bekçi 1 — payload boyut limiti (16KB)', () => {
  it('octet_length tabanlı 16384 bayt eşiği var', () => {
    expect(sql).toContain('c_max_bytes   constant integer  := 16384');
    expect(sql).toMatch(/octet_length\(v_payload::text\) > c_max_bytes/);
  });

  it('>16KB → kırpılmış güvenli payload: truncated/type/ctx/msg', () => {
    expect(sql).toMatch(/'truncated', true/);
    expect(sql).toMatch(/'type',\s+p_type/);
    expect(sql).toMatch(/'ctx',\s+left\(v_payload->>'ctx',\s*256\)/);
    expect(sql).toMatch(/'msg',\s+left\(v_payload->>'msg',\s*2048\)/);
  });

  it('errorCode yalnız VARSA yazılır (jsonb_strip_nulls)', () => {
    expect(sql).toMatch(/jsonb_strip_nulls\(jsonb_build_object\(/);
    expect(sql).toMatch(/'errorCode', v_payload->>'errorCode'/);
  });

  it('<=16KB aynen geçer: kırpma IF\'inden önce v_store := v_payload', () => {
    const passthrough = sql.indexOf('v_store := v_payload;');
    const truncCheck  = sql.indexOf('octet_length(v_payload::text) > c_max_bytes');
    expect(passthrough).toBeGreaterThan(-1);
    expect(truncCheck).toBeGreaterThan(passthrough);
  });

  it('audit insert kırpılmış v_store yazar (orijinal p_payload DEĞİL)', () => {
    expect(sql).toMatch(/INSERT INTO public\.vehicle_events \(vehicle_id, type, metadata\)\s+VALUES \(v_vehicle_id, p_type, v_store\)/);
  });
});

describe('bekçi 2 — rate limit (60 sn / 30 log eventi)', () => {
  it('pencere 60 saniye, tavan 30', () => {
    expect(sql).toContain("interval '60 seconds'");
    expect(sql).toContain('c_rate_max    constant integer  := 30');
  });

  it('yalnız log tipleri rate limit\'e girer (p_type = ANY guard)', () => {
    expect(sql).toMatch(/IF p_type = ANY \(c_log_types\) THEN/);
    for (const t of LOG_TYPES) {
      expect(sql, `log tipi eksik: ${t}`).toContain(`'${t}'`);
    }
  });

  it('aşımda exception YOK — kontrollü no-op (RETURN NULL), insert patlamaz', () => {
    expect(sql).toMatch(/IF v_recent >= c_rate_max THEN\s+RETURN NULL;/);
    // Rate limit dalında RAISE yok; tek RAISE EXCEPTION RPC gövdesinde
    // invalid_api_key (017 davranışı korunur)
    const fnBody = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.push_vehicle_event'),
      sql.indexOf('-- ── 3. Retention'));
    const raises = fnBody.match(/RAISE EXCEPTION/g) ?? [];
    expect(raises).toHaveLength(1);
    expect(fnBody).toContain("'invalid_api_key'");
  });

  it('sayım sorgusu kısmi indeksle destekli (idx_vehicle_events_log_rate)', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_vehicle_events_log_rate\s+ON public\.vehicle_events \(vehicle_id, created_at DESC\)\s+WHERE type IN/);
  });
});

describe('bekçi 3 — retention (30 gün)', () => {
  it('cleanup fonksiyonu yalnız log tiplerini 30 gün sonra siler', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.cleanup_vehicle_log_events()');
    expect(sql).toContain("created_at < now() - interval '30 days'");
    // DELETE yalnız log tiplerine kısıtlı — diğer audit eventleri silinmez
    const del = sql.slice(sql.indexOf('DELETE FROM public.vehicle_events'));
    expect(del.slice(0, 300)).toMatch(/WHERE type IN \('critical_error','crash','log','obd_diag','support_snapshot','ota_event'\)/);
  });

  it('pg_cron varsa zamanlanır, yoksa fallback dokümante (NOTICE + seçenekler)', () => {
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\)/);
    expect(sql).toMatch(/cron\.schedule\(\s+'vehicle_log_retention'/);
    expect(sql).toContain('pg_cron YOK — fallback');
    expect(sql).toContain('Edge Function');
    expect(sql).toContain("rpc('cleanup_vehicle_log_events')");
  });

  it('cleanup yalnız service_role: PUBLIC revoke + anon/auth grant YOK', () => {
    expect(sql).toContain('REVOKE ALL     ON FUNCTION public.cleanup_vehicle_log_events() FROM PUBLIC');
    expect(sql).toContain('GRANT  EXECUTE ON FUNCTION public.cleanup_vehicle_log_events() TO service_role');
    expect(sql).not.toMatch(/cleanup_vehicle_log_events\(\) TO (anon|authenticated)/);
  });
});

describe('migration 017 köprüsü korunuyor (mevcut akış kırılmaz)', () => {
  it('api_key doğrulama + invalid_api_key exception aynı', () => {
    expect(sql).toMatch(/SELECT id INTO v_vehicle_id FROM public\.vehicles WHERE api_key = p_api_key/);
    expect(sql).toMatch(/RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001'/);
  });

  it('konum köprüsü ORİJİNAL payload\'dan okur (kırpma lat/lng akışını bozmaz)', () => {
    expect(sql).toMatch(/v_lat := NULLIF\(v_payload->>'lat', ''\)::double precision/);
    expect(sql).toMatch(/INSERT INTO public\.vehicle_locations \(vehicle_id, lat, lng\)/);
  });

  it('telemetri upsert aynen duruyor (system_health/telemetry etkilenmez)', () => {
    expect(sql).toMatch(/INSERT INTO public\.vehicle_telemetry AS t/);
    expect(sql).toMatch(/ON CONFLICT \(vehicle_id\) DO UPDATE SET/);
    expect(sql).toMatch(/NULLIF\(v_payload->>'speed', ''\)::integer/);
  });

  it('system_health log tipi DEĞİL → bekçilere girmez', () => {
    expect(LOG_TYPES).not.toContain('system_health');
    expect(sql).not.toMatch(/c_log_types[^;]*system_health/);
  });
});

describe('CLAUDE.md — GRANT + RLS + verification', () => {
  it('push_vehicle_event: PUBLIC revoke + anon/authenticated EXECUTE', () => {
    expect(sql).toContain('REVOKE ALL     ON FUNCTION public.push_vehicle_event(text, text, jsonb) FROM PUBLIC');
    expect(sql).toContain('GRANT  EXECUTE ON FUNCTION public.push_vehicle_event(text, text, jsonb) TO anon, authenticated');
  });

  it('verification DO bloğu: fonksiyon GRANT + RLS + policy + indeks, eksikte EXCEPTION', () => {
    expect(sql).toContain('information_schema.routine_privileges');
    expect(sql).toContain('pg_tables');
    expect(sql).toContain('pg_policies');
    expect(sql).toContain('pg_indexes');
    expect(sql).toMatch(/RAISE EXCEPTION 'remote log guards: push_vehicle_event GRANT eksik/);
    expect(sql).toMatch(/RAISE EXCEPTION 'remote log guards: cleanup fonksiyonu anon\/authenticated/);
    expect(sql).toMatch(/RAISE EXCEPTION 'remote log guards: vehicle_events RLS kapalı/);
    expect(sql).toMatch(/RAISE EXCEPTION 'remote log guards: vehicle_events policy eksik/);
    expect(sql).toMatch(/RAISE EXCEPTION 'remote log guards: idx_vehicle_events_log_rate indeksi yok/);
  });
});
