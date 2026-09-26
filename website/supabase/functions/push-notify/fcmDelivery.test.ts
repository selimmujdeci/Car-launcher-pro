/**
 * fcmDelivery.test.ts — FCM HTTP v1 yanıt sınıflandırması ve wake mesajı (Deno).
 *
 * ── EN KRİTİK KİLİT ──────────────────────────────────────────────────────
 * GEÇİCİ bir hata token SİLDİREMEZ. Tek bir kota aşımı ya da süresi dolmuş
 * access token, tüm filonun Push-to-Wake yeteneğini kalıcı olarak yok
 * edebilirdi. Silme yetkisi YALNIZ kayıt token'ına özgü kalıcı geçersizlik
 * kanıtındadır.
 */
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  classifyFcmResponse,
  networkFailureOutcome,
  shouldDeleteToken,
  buildWakeMessage,
  isWakeEvent,
  WAKE_DATA_KEYS,
  WAKE_EVENTS,
  FCM_SEND_ENDPOINT,
} from './fcmDelivery.ts';

/** FCM v1 hata gövdesi — gerçek biçim (`details[].errorCode`). */
const fcmError = (status: number, statusText: string, errorCode?: string) => ({
  error: {
    code: status,
    message: 'test',
    status: statusText,
    ...(errorCode
      ? { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] }
      : {}),
  },
});

/* ── 1. Başarı ──────────────────────────────────────────────────────────── */

Deno.test('1. 200 + mesaj adı → ACCEPTED', () => {
  const o = classifyFcmResponse(200, { name: 'projects/p/messages/1' });
  assertEquals(o.kind, 'ACCEPTED');
  assertEquals(shouldDeleteToken(o), false);
});

Deno.test('2. 🔒 200 ama mesaj adı YOK → kabul SAYILMAZ', () => {
  /* "Hata atmadı" kabul kanıtı değildir. */
  for (const body of [null, {}, { name: '' }, { name: 42 }]) {
    const o = classifyFcmResponse(200, body);
    assertEquals(o.kind, 'REJECTED', JSON.stringify(body));
    assertEquals(o.code, 'NO_MESSAGE_NAME');
    assertEquals(shouldDeleteToken(o), false);
  }
});

/* ── 2. Kalıcı token geçersizliği (DAR kapı) ─────────────────────────────── */

Deno.test('3. 🔒 UNREGISTERED → token KALICI geçersiz (silinebilir)', () => {
  const o = classifyFcmResponse(404, fcmError(404, 'NOT_FOUND', 'UNREGISTERED'));
  assertEquals(o.kind, 'PERMANENT_INVALID_TOKEN');
  assertEquals(o.code, 'UNREGISTERED');
  assertEquals(shouldDeleteToken(o), true);
});

Deno.test('4. 404 NOT_FOUND (errorCode\'suz) → kalıcı', () => {
  assertEquals(classifyFcmResponse(404, fcmError(404, 'NOT_FOUND')).kind, 'PERMANENT_INVALID_TOKEN');
  assertEquals(classifyFcmResponse(404, null).kind, 'PERMANENT_INVALID_TOKEN');
});

/* ── 3. GEÇİCİ hatalar token SİLDİRMEZ ───────────────────────────────────── */

Deno.test('5. 🔒 401 token SİLDİRMEZ (access token süresi dolmuş olabilir)', () => {
  const o = classifyFcmResponse(401, fcmError(401, 'UNAUTHENTICATED'));
  assertEquals(o.kind, 'TRANSIENT');
  assertEquals(shouldDeleteToken(o), false);
});

Deno.test('6. 🔒 403 token SİLDİRMEZ', () => {
  const o = classifyFcmResponse(403, fcmError(403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH'));
  assertEquals(o.kind, 'TRANSIENT');
  assertEquals(shouldDeleteToken(o), false);
});

Deno.test('7. 🔒 429 (kota) token SİLDİRMEZ', () => {
  const o = classifyFcmResponse(429, fcmError(429, 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'));
  assertEquals(o.kind, 'TRANSIENT');
  assertEquals(shouldDeleteToken(o), false);
});

Deno.test('8. 🔒 5xx token SİLDİRMEZ', () => {
  for (const s of [500, 502, 503, 504]) {
    const o = classifyFcmResponse(s, fcmError(s, 'UNAVAILABLE', 'UNAVAILABLE'));
    assertEquals(o.kind, 'TRANSIENT', `status ${s}`);
    assertEquals(shouldDeleteToken(o), false);
  }
});

Deno.test('9. 🔒 ağ hatası token SİLDİRMEZ (yanıt HİÇ alınmadı)', () => {
  const o = networkFailureOutcome();
  assertEquals(o.kind, 'TRANSIENT');
  assertEquals(o.status, 0);
  assertEquals(shouldDeleteToken(o), false);
});

Deno.test('10. 🔒 400 INVALID_ARGUMENT token SİLDİRMEZ (payload hatası da aynı kodu verir)', () => {
  /* MUTASYON KAPISI: burası silmeye açılırsa TEK bir gönderici hatası tüm
     araçların token'larını süpürürdü. */
  const o = classifyFcmResponse(400, fcmError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT'));
  assertEquals(o.kind, 'REJECTED');
  assertEquals(shouldDeleteToken(o), false);
});

Deno.test('11. sınıflandırma yanıt gövdesinin TAMAMINI taşımaz', () => {
  const o = classifyFcmResponse(400, { error: { code: 400, message: 'CIHAZ-TOKEN-ABC sızdı', status: 'INVALID_ARGUMENT' } });
  assertEquals(JSON.stringify(o).includes('CIHAZ-TOKEN-ABC'), false);
});

/* ── 4. Wake mesajı ─────────────────────────────────────────────────────── */

Deno.test('12. 🔒 data-only: görünür bildirim alanı YOK', () => {
  const m = buildWakeMessage('tok', 'new_command', 'veh-1', 1234).message as Record<string, unknown>;
  assertEquals('notification' in m, false);
  const data = m.data as Record<string, string>;
  assertEquals(Object.keys(data).sort(), ['event', 'ts', 'vehicle_id']);
  assertEquals(Object.keys(data).sort(), [...WAKE_DATA_KEYS].sort());
  assertEquals('title' in data, false);
  assertEquals('body' in data, false);
});

Deno.test('13. 🔒 wake HINT: cmd_type / cmd_id / e2e_payload TAŞIMAZ', () => {
  /* Bunlar olmadan Android tarafında şifreli komut dalına GİRİLEMEZ —
     push fiziksel komut otoritesi olamaz. */
  const s = JSON.stringify(buildWakeMessage('tok', 'new_command', 'veh-1', 1));
  for (const k of ['cmd_type', 'cmd_id', 'e2e_payload', 'command_id', 'payload']) {
    assertEquals(s.includes(k), false, `payload ${k} taşıyor`);
  }
});

/* ── MRI F-08: wake sözleşmesi çağıran verisine KAPALI ──────────────────── */

Deno.test('13b. 🔒 F-08: çağıran hangi gövdeyi verirse versin wake verisi yalnız {event, vehicle_id, ts}', () => {
  /* Eski imza `payload` alıyordu; artık parametre YOK. TypeScript dışında
     (JSON gövdesi) fazladan alan gelse bile fonksiyona ulaşamaz — index.ts
     yalnız event+vehicleId okur. Burada üretilen mesajın anahtar kümesi
     SABİTTİR; native CommandService'in aradığı cmd_id/e2e_payload/cmd_type
     bu üreticiden ASLA çıkamaz. */
  const m = buildWakeMessage('tok', 'command_pending', 'veh-9', 7).message as { data: Record<string, string> };
  assertEquals(Object.keys(m.data).sort(), ['event', 'ts', 'vehicle_id']);
  assertEquals(m.data.event, 'command_pending');
  assertEquals(m.data.vehicle_id, 'veh-9');
  assertEquals(m.data.ts, '7');
  for (const v of Object.values(m.data)) assertEquals(typeof v, 'string');   // FCM data: string map
});

Deno.test('13c. 🔒 F-08: insan bildirimi olayı wake üreticisinden GEÇMEZ', () => {
  for (const ev of ['vehicle_offline', 'command_completed', 'command_failed', 'health_alert', 'speed_alert', '', 'unlock']) {
    assertEquals(isWakeEvent(ev), false, `${ev} wake sayıldı`);
    let threw = false;
    try { buildWakeMessage('tok', ev as unknown as 'new_command', 'veh-1', 1); } catch (e) { threw = (e as Error).message === 'NOT_A_WAKE_EVENT'; }
    assertEquals(threw, true, `${ev} için NOT_A_WAKE_EVENT atılmadı`);
  }
  for (const ev of WAKE_EVENTS) assertEquals(isWakeEvent(ev), true);
});

Deno.test('14. 🔒 sır taşımaz (PIN / JWT / api_key / access token)', () => {
  const s = JSON.stringify(buildWakeMessage('tok', 'new_command', 'veh-1', 1));
  for (const k of ['pin', 'jwt', 'api_key', 'access_token', 'private_key', 'Authorization']) {
    assertEquals(s.toLowerCase().includes(k.toLowerCase()), false, `sır alanı: ${k}`);
  }
});

Deno.test('15. yüksek öncelik + direct boot korunur', () => {
  const m = buildWakeMessage('tok', 'new_command', 'veh-1', 1).message as Record<string, unknown>;
  assertEquals(m.android, { priority: 'high', direct_boot_ok: true });
});

Deno.test('16. uç nokta HTTP v1 ve project_id ile kurulur', () => {
  assertEquals(FCM_SEND_ENDPOINT('caros-test'),
    'https://fcm.googleapis.com/v1/projects/caros-test/messages:send');
  assert(!FCM_SEND_ENDPOINT('x').includes('/fcm/send'), 'legacy uç kullanılamaz');
});
