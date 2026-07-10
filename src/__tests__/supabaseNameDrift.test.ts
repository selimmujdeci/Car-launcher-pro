/**
 * supabaseNameDrift.test.ts — PR-SQL-3A: Supabase isim drift hizalaması kilidi.
 *
 * Eski tablo adları canlı/kanonik adlarla eşitlendi:
 *   system_configs → runtime_policies   (superAdminService)
 *   linking_codes  → vehicle_linking_codes (website vehicle/code API)
 * (push_subscriptions → vehicle_push_tokens KAPSAM DIŞI: kolon paritesi yok — Web Push ≠ FCM.)
 *
 * Bu test: (1) davranışsal — superAdminService .from() hedeflerini açıkça kilitler;
 * (2) kaynak-kilit — eski adların ilgili aktif kod yollarında kalmadığını doğrular (?raw).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Aktif kod yolu kaynakları (transform-time sabit — paralel flake'e bağışık).
import superAdminSrc from '../platform/superadmin/superAdminService.ts?raw';
import vehicleCodeRouteSrc from '../../website/src/app/api/vehicle/code/route.ts?raw';

/* ── Supabase admin client mock — .from() hedeflerini yakalar ─────────────── */
const fromCalls: string[] = [];
vi.mock('../platform/roleSystem/RoleStore', () => ({
  getAdminClient: () => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      order:  () => Promise.resolve({ data: [{ id: 'p1', key: 'max_speed', name: 'Max Hız', value: 120, unit: 'km/h', updated_at: '2026-01-01T00:00:00Z' }], error: null }),
      update: () => q,
      insert: () => Promise.resolve({ data: null, error: null }),
      eq:     () => Promise.resolve({ error: null }),
    });
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@x.co' } } }) },
      from: (t: string) => { fromCalls.push(t); return q; },
    };
  },
}));

import { getSystemPolicies, updatePolicy } from '../platform/superadmin/superAdminService';

beforeEach(() => { fromCalls.length = 0; });

/* ── Davranışsal: .from() hedefi kilidi ──────────────────────────────────── */
describe('superAdminService — runtime_policies hizalaması', () => {
  it('getSystemPolicies runtime_policies üzerinden OKUR (system_configs DEĞİL)', async () => {
    const res = await getSystemPolicies();
    expect(fromCalls).toContain('runtime_policies');
    expect(fromCalls).not.toContain('system_configs');
    expect(res[0]?.key).toBe('max_speed');
  });

  it('updatePolicy runtime_policies üzerinden YAZAR (system_configs DEĞİL) + audit', async () => {
    await updatePolicy('max_speed', 130);
    expect(fromCalls).toContain('runtime_policies');
    expect(fromCalls).not.toContain('system_configs');
    expect(fromCalls).toContain('audit_logs'); // logAdminAction akışı korundu
  });
});

/* ── Kaynak-kilit: eski adlar aktif kod yollarında kalmadı ───────────────── */
describe('isim drift — eski adlar aktif kod yolunda YOK', () => {
  it('superAdminService: from(\'system_configs\') kalmadı; runtime_policies var', () => {
    expect(superAdminSrc).not.toMatch(/from\(\s*['"]system_configs['"]/);
    expect(superAdminSrc).toMatch(/from\(\s*['"]runtime_policies['"]/);
  });

  it('website vehicle/code API: from(\'linking_codes\') kalmadı; vehicle_linking_codes var', () => {
    // 'vehicle_linking_codes' eşleşmesin diye tırnak-hemen-sonrası guard.
    expect(vehicleCodeRouteSrc).not.toMatch(/from\(\s*['"]linking_codes['"]/);
    expect(vehicleCodeRouteSrc).toMatch(/from\(\s*['"]vehicle_linking_codes['"]/);
  });
});
