/**
 * otaSchema.test.ts — OTA v1 / Commit 2: Supabase şema sözleşmesi
 *
 * Migration SQL'i lokalde koşulamadığında (Docker/linked proje yok) bile
 * şema ↔ kod sözleşmesini kilitler:
 *  - rollout_plans kolonları RolloutPlan tipi + createRolloutPlan insert'iyle senkron
 *  - status/channel enum'ları UI sabitleriyle senkron
 *  - CLAUDE.md GRANT+RLS+POLICY+verification dörtlüsü iki tabloda da eksiksiz
 *  - storage bucket private + yalnız okuma policy'si
 *  - elle-SQL JSDoc bağımlılığı kaldırıldı
 *
 * NOT: Gerçek DB'de koşum (verification DO bloklarının PASS etmesi)
 * "deploy'da doğrulanmadı" — Supabase projesine push gerektirir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR     = join(process.cwd(), 'supabase', 'migrations');
const REGISTRY_FN = '20260610000018_ota_release_registry.sql';
const STORAGE_FN  = '20260610000019_ota_storage_policies.sql';

const registry = readFileSync(join(MIG_DIR, REGISTRY_FN), 'utf-8');
const storage  = readFileSync(join(MIG_DIR, STORAGE_FN),  'utf-8');
const service  = readFileSync(
  join(process.cwd(), 'src', 'admin', 'services', 'superadmin.service.ts'), 'utf-8');

describe('OTA migration dosyaları', () => {
  it('timestamp sırası: yeni migration\'lar mevcut en yeniden SONRA gelir', () => {
    const stamped = readdirSync(MIG_DIR)
      .filter((f) => /^\d{8}/.test(f) && f !== REGISTRY_FN && f !== STORAGE_FN)
      .sort();
    const newest = stamped[stamped.length - 1];
    expect(REGISTRY_FN > newest).toBe(true);
    expect(STORAGE_FN > REGISTRY_FN).toBe(true); // bucket policy tablodan sonra
  });
});

describe('rollout_plans — ekran/servis sözleşmesi', () => {
  it('createRolloutPlan insert alanlarının TAMAMI migration kolonu', () => {
    // superadmin.service.ts createRolloutPlan plan objesi + id (PK)
    const cols = ['id', 'name', 'version', 'description', 'status', 'stages',
                  'rollback_to', 'created_at', 'created_by', 'approved_by', 'approved_at'];
    for (const col of cols) {
      expect(registry, `rollout_plans kolonu eksik: ${col}`).toMatch(
        new RegExp(`^\\s+${col}\\s`, 'm'));
    }
  });

  it('status CHECK değerleri RolloutCenter STATUS_COLOR anahtarlarıyla senkron', () => {
    // RolloutCenter.tsx:35-43 — draft/pending_review/approved/rolling/paused/complete/reverted
    for (const s of ['draft', 'pending_review', 'approved', 'rolling', 'paused', 'complete', 'reverted']) {
      expect(registry).toContain(`'${s}'`);
    }
  });

  it('elle-SQL JSDoc bağımlılığı kaldırıldı (servis migration\'a işaret ediyor)', () => {
    expect(service).not.toContain('CREATE TABLE IF NOT EXISTS public.rollout_plans');
    expect(service).toContain(REGISTRY_FN);
  });
});

describe('ota_releases — cihaz sorgu sözleşmesi', () => {
  it('cihaz sorgusunun gerektirdiği kolonlar mevcut', () => {
    for (const col of ['version_code', 'version_name', 'channel', 'apk_path',
                       'apk_size', 'sha256', 'status', 'release_notes', 'rollout_plan_id']) {
      expect(registry, `ota_releases kolonu eksik: ${col}`).toMatch(
        new RegExp(`^\\s+${col}\\s`, 'm'));
    }
  });

  it('status enum tam olarak {draft, active, paused, revoked}', () => {
    const m = registry.match(/status\s+text\s+NOT NULL\s+DEFAULT\s+'draft'\s+CHECK\s*\(status IN \(([^)]+)\)\)/g);
    expect(m, 'ota_releases status CHECK bulunamadı').toBeTruthy();
    const otaCheck = m!.find((s) => s.includes("'revoked'"));
    expect(otaCheck).toBeTruthy();
    for (const s of ['draft', 'active', 'paused', 'revoked']) {
      expect(otaCheck).toContain(`'${s}'`);
    }
  });

  it('channel enum {internal, pilot, production} (stage targeting v1)', () => {
    expect(registry).toMatch(/channel IN \('internal','pilot','production'\)/);
  });

  it('bütünlük kısıtları: version_code UNIQUE+pozitif, sha256 64 hex, FK rollout_plans', () => {
    expect(registry).toMatch(/version_code\s+integer NOT NULL UNIQUE CHECK \(version_code > 0\)/);
    expect(registry).toMatch(/char_length\(sha256\) = 64/);
    expect(registry).toMatch(/REFERENCES public\.rollout_plans\(id\) ON DELETE SET NULL/);
  });

  it('cihaz sorgu indeksi mevcut (channel, status, version_code DESC)', () => {
    expect(registry).toMatch(/idx_ota_releases_device_query/);
    expect(registry).toMatch(/\(channel, status, version_code DESC\)/);
  });
});

describe('CLAUDE.md dörtlüsü — GRANT + RLS + POLICY + verification', () => {
  for (const table of ['rollout_plans', 'ota_releases']) {
    it(`${table}: GRANT üç role de eksiksiz`, () => {
      expect(registry).toContain(`GRANT SELECT ON public.${table} TO anon`);
      expect(registry).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO authenticated`);
      expect(registry).toContain(`GRANT ALL ON public.${table} TO service_role`);
    });

    it(`${table}: RLS açık`, () => {
      expect(registry).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    });
  }

  it('policy seti: superadmin yazma + cihaz/auth active-okuma', () => {
    for (const p of ['superadmin_rollouts', 'ota_releases_device_read',
                     'ota_releases_auth_read_active', 'ota_releases_superadmin_all']) {
      expect(registry).toContain(`"${p}"`);
    }
    // Cihaz yalnız aktif release görür (pause = anında gizlenir)
    expect(registry).toMatch(/FOR SELECT TO anon\s+USING \(status = 'active'\)/);
  });

  it('verification DO bloğu: GRANT + RLS + policy sayımı, eksikte EXCEPTION', () => {
    expect(registry).toContain('information_schema.role_table_grants');
    expect(registry).toContain('pg_tables');
    expect(registry).toContain('pg_policies');
    expect(registry).toMatch(/RAISE EXCEPTION 'OTA migration: GRANT eksik/);
    expect(registry).toMatch(/RAISE EXCEPTION 'OTA migration: RLS kapalı/);
    expect(registry).toMatch(/RAISE EXCEPTION 'OTA migration: policy eksik/);
  });
});

describe('ota_apks storage bucket', () => {
  it('bucket private + APK mime whitelist', () => {
    expect(storage).toContain("'ota_apks'");
    expect(storage).toMatch(/false,\s*\n\s*209715200/); // public=false, 200MB
    expect(storage).toContain('application/vnd.android.package-archive');
  });

  it('yalnız OKUMA policy\'leri var — yazma policy\'si bilinçli yok (service_role bypass)', () => {
    expect(storage).toContain('"ota_apks_device_read"');
    expect(storage).toContain('"ota_apks_auth_read"');
    expect(storage).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
  });

  it('verification: bucket varlığı + private teyidi + policy sayımı', () => {
    expect(storage).toMatch(/RAISE EXCEPTION 'OTA storage: ota_apks PUBLIC olmamalı/);
    expect(storage).toMatch(/RAISE EXCEPTION 'OTA storage: okuma policy eksik/);
  });
});
