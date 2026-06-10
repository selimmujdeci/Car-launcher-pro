/**
 * pushNotifyAuth.test.ts — push-notify Edge Function yetkilendirme (E1 fix)
 *
 * Kapsam (saf auth kararı; Deno runtime gerektirmez):
 *  - Authorization yok → reddedilir (401)
 *  - Yanlış token → reddedilir (401)
 *  - "Bearer " öneki olmayan token → reddedilir
 *  - Doğru service_role token → kabul edilir (mevcut davranış sürer)
 *  - serviceRoleKey env tanımsız → fail-closed (reddedilir)
 *
 * NOT: Tam HTTP akışı (webpush gönderimi) Deno deploy ortamında çalışır —
 * "cihazda/deploy'da doğrulanmadı". Burada yalnız auth karar sözleşmesi test edilir.
 */
import { describe, it, expect } from 'vitest';
import { authorizePushRequest } from '../../supabase/functions/push-notify/auth';

const SERVICE_ROLE = 'sk_service_role_secret_123';

describe('push-notify auth — authorizePushRequest', () => {
  it('Authorization header yok → reddedilir', () => {
    expect(authorizePushRequest(null, SERVICE_ROLE)).toBe(false);
    expect(authorizePushRequest(undefined, SERVICE_ROLE)).toBe(false);
    expect(authorizePushRequest('', SERVICE_ROLE)).toBe(false);
  });

  it('yanlış token → reddedilir', () => {
    expect(authorizePushRequest('Bearer wrong-token', SERVICE_ROLE)).toBe(false);
    expect(authorizePushRequest('Bearer anon-key-xyz', SERVICE_ROLE)).toBe(false);
  });

  it('"Bearer " öneki olmayan token → reddedilir (eski E1 bypass kapalı)', () => {
    // Eski açık: herhangi 'Bearer X' veya raw token geçiyordu. Artık prefix + tam eşleşme.
    expect(authorizePushRequest(SERVICE_ROLE, SERVICE_ROLE)).toBe(false); // prefix yok
    expect(authorizePushRequest(`Basic ${SERVICE_ROLE}`, SERVICE_ROLE)).toBe(false);
    expect(authorizePushRequest('Bearer ', SERVICE_ROLE)).toBe(false); // boş token
  });

  it('doğru service_role token → kabul edilir (mevcut davranış sürer)', () => {
    expect(authorizePushRequest(`Bearer ${SERVICE_ROLE}`, SERVICE_ROLE)).toBe(true);
  });

  it('serviceRoleKey env tanımsız → fail-closed (reddedilir)', () => {
    expect(authorizePushRequest(`Bearer ${SERVICE_ROLE}`, undefined)).toBe(false);
    expect(authorizePushRequest(`Bearer ${SERVICE_ROLE}`, '')).toBe(false);
  });
});
