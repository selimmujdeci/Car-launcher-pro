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
import vehicleLinkRouteSrc from '../../website/src/app/api/vehicle/link/route.ts?raw';

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

  /**
   * KİLİT GÜNCELLENDİ (FLEET-CONNECTIVITY-P0):
   * `/api/vehicle/code` artık KAPALI (410) — hiçbir tabloyu sorgulamıyor,
   * çünkü `vehicle_linking_codes`'a İKİNCİ bir yazma yolu açıyordu ve head
   * unit bu rotayı hiç çağırmıyordu (doğrudan `refresh_linking_code` RPC'si).
   * Drift riski ortadan kalktı; kilit kaldırılmadı, iki yönde GÜÇLENDİRİLDİ:
   *   (a) eski ad `linking_codes` bu yolda hâlâ YOK,
   *   (b) rota artık HİÇBİR tabloyu sorgulamıyor (ikinci otorite geri gelmesin),
   *   (c) kanonik eşleştirme otoritesi `pair_vehicle_to_user` RPC'sinde DURUYOR.
   */
  it('website vehicle/code API: KAPALI — ne eski ne yeni tablo adı sorgulanıyor', () => {
    // 'vehicle_linking_codes' eşleşmesin diye tırnak-hemen-sonrası guard.
    expect(vehicleCodeRouteSrc).not.toMatch(/from\(\s*['"]linking_codes['"]/);
    // Kapalı rota hiçbir tabloya dokunmaz → ikinci yazma yolu YOK.
    expect(vehicleCodeRouteSrc).not.toMatch(/\.from\(/);
    expect(vehicleCodeRouteSrc).not.toMatch(/\.rpc\(/);
    expect(vehicleCodeRouteSrc).toMatch(/status:\s*(410|ROUTE\.status)/);
  });

  it('kanonik eşleştirme otoritesi pair_vehicle_to_user RPC\'sinde duruyor', () => {
    expect(vehicleLinkRouteSrc).toMatch(/\.rpc\(\s*['"]pair_vehicle_to_user['"]/);
    // Kod doğrulaması istemcide tabloyu okuyarak YAPILMAZ (RLS atlanmasın).
    expect(vehicleLinkRouteSrc).not.toMatch(/from\(\s*['"]vehicle_linking_codes['"]/);
  });
});
