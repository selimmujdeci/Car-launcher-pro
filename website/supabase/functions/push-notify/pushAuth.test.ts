/**
 * pushAuth.test.ts — push-notify yetkilendirme karar mantığı testleri (Deno).
 * Çalıştırma: `deno test website/supabase/functions/push-notify/pushAuth.test.ts`
 *
 * Not: bu repo'da lokal Deno kurulu olmayabilir; testler CI/deploy ortamında çalışır.
 */
import { assertEquals } from 'jsr:@std/assert@1';
import { authorizePushRequest, type PushAuthDeps } from './pushAuth.ts';

const SR_KEY = 'service-role-key';

/** Varsayılan: her şey geçerli (owner kullanıcı). Tek tek override edilerek senaryolar kurulur. */
function deps(over: Partial<PushAuthDeps> = {}): PushAuthDeps {
  return {
    serviceRoleKey: SR_KEY,
    verifyJwt: () => Promise.resolve('user-1'),
    vehicleExists: () => Promise.resolve(true),
    userCanAccessVehicle: () => Promise.resolve(true),
    ...over,
  };
}

Deno.test('owner kullanıcı → ok (mode=user)', async () => {
  const d = await authorizePushRequest('valid-jwt', 'veh-1', deps());
  assertEquals(d, { ok: true, mode: 'user' });
});

Deno.test('service_role path bozulmaz → ok (bypass, sorgu yapılmaz)', async () => {
  let touched = false;
  const d = await authorizePushRequest(SR_KEY, 'veh-1', deps({
    verifyJwt: () => { touched = true; return Promise.resolve(null); },
    vehicleExists: () => { touched = true; return Promise.resolve(false); },
  }));
  assertEquals(d, { ok: true, mode: 'service_role' });
  assertEquals(touched, false); // bypass: hiçbir DB sorgusu çağrılmamalı
});

Deno.test('sahte Bearer (geçersiz JWT) → 401', async () => {
  const d = await authorizePushRequest('fake', 'veh-1', deps({ verifyJwt: () => Promise.resolve(null) }));
  assertEquals(d, { ok: false, status: 401, reason: 'invalid jwt' });
});

Deno.test('boş token → 401', async () => {
  const d = await authorizePushRequest('', 'veh-1', deps());
  assertEquals(d, { ok: false, status: 401, reason: 'missing token' });
});

Deno.test('olmayan araç → 404 (erişim 403\'ten ayrık)', async () => {
  const d = await authorizePushRequest('valid-jwt', 'veh-x', deps({ vehicleExists: () => Promise.resolve(false) }));
  assertEquals(d, { ok: false, status: 404, reason: 'vehicle not found' });
});

Deno.test('eşleşmemiş/yetkisiz kullanıcı → 403', async () => {
  const d = await authorizePushRequest('valid-jwt', 'veh-1', deps({ userCanAccessVehicle: () => Promise.resolve(false) }));
  assertEquals(d, { ok: false, status: 403, reason: 'no vehicle access' });
});

Deno.test('araç var ama erişim yok → 404 değil 403 (sıra doğru)', async () => {
  const d = await authorizePushRequest('valid-jwt', 'veh-1', deps({
    vehicleExists: () => Promise.resolve(true),
    userCanAccessVehicle: () => Promise.resolve(false),
  }));
  assertEquals(d, { ok: false, status: 403, reason: 'no vehicle access' });
});
