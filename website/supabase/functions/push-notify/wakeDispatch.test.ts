/**
 * wakeDispatch.test.ts — çok token'lı gönderim, izolasyon ve ölü token temizliği.
 *
 * ── EN KRİTİK KİLİTLER ───────────────────────────────────────────────────
 *   · Bir token'ın ölmesi KARDEŞ token'ı SİLDİRMEZ.
 *   · Geçici hata HİÇBİR token sildirmez.
 *   · Temizlik başarısızlığı kardeş gönderimleri DURDURMAZ ve gizlenmez.
 *   · `accepted` = FCM KABUL ETTİ; teslim/uyanma/icra İDDİASI DEĞİL.
 */
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { dispatchWake, type DispatchDeps } from './wakeDispatch.ts';

const ENDPOINT = 'https://fcm.googleapis.com/v1/projects/p/messages:send';

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ok      = () => jsonRes(200, { name: 'projects/p/messages/1' });
const gone    = () => jsonRes(404, { error: { code: 404, status: 'NOT_FOUND',
  details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } });
const transient = (s: number) => jsonRes(s, { error: { code: s, status: 'UNAVAILABLE' } });

/** Token başına yanıt üreten sahte taşıma + silinen satırların defteri. */
function harness(
  responder: (token: string) => Response | Promise<Response> | never,
  deleteImpl?: (token: string) => Promise<{ ok: boolean }>,
) {
  const sentTo: string[] = [];
  const deleted: string[] = [];
  const warnings: string[] = [];

  const deps: DispatchDeps = {
    accessToken: 'ya29.GIZLI-ACCESS-TOKEN',
    endpoint:    ENDPOINT,
    now:         () => 1_700_000_000_000,
    fetch: ((url: string | URL, init?: RequestInit) => {
      assertEquals(String(url), ENDPOINT);
      const body = JSON.parse(String(init?.body ?? '{}')) as { message: { token: string } };
      sentTo.push(body.message.token);
      return Promise.resolve(responder(body.message.token));
    }) as unknown as typeof fetch,
    deleteToken: deleteImpl ?? (async (t) => { deleted.push(t); return { ok: true }; }),
    warn: (m) => warnings.push(m),
  };
  return { deps, sentTo, deleted, warnings };
}

/* ── 1. Temel sayım ─────────────────────────────────────────────────────── */

Deno.test('1. hepsi kabul → accepted = token sayısı, silme YOK', async () => {
  const h = harness(() => ok());
  const s = await dispatchWake(['a', 'b', 'c'], 'new_command', 'veh-1', {}, h.deps);
  assertEquals(s, { accepted: 3, failed: 0, cleaned: 0, cleanupFailed: 0 });
  assertEquals(h.deleted, []);
});

Deno.test('2. 🔒 FCM hatası accepted ARTIRMAZ', async () => {
  const h = harness(() => transient(503));
  const s = await dispatchWake(['a', 'b'], 'new_command', 'veh-1', {}, h.deps);
  assertEquals(s.accepted, 0);
  assertEquals(s.failed, 2);
});

/* ── 2. Ölü token temizliği — DAR ve İZOLE ──────────────────────────────── */

Deno.test('3. 🔒 UNREGISTERED → YALNIZ o token silinir', async () => {
  const h = harness((t) => (t === 'olu' ? gone() : ok()));
  const s = await dispatchWake(['canli-1', 'olu', 'canli-2'], 'new_command', 'veh-1', {}, h.deps);

  assertEquals(h.deleted, ['olu'], 'yalnız ölü token silinmeli');
  assertEquals(s.cleaned, 1);
  assertEquals(s.accepted, 2, 'kardeş token\'lara gönderim SÜRMELİ');
  assertEquals(s.failed, 1);
});

Deno.test('4. 🔒 GEÇİCİ hatalarda HİÇBİR token silinmez', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const h = harness(() => transient(status));
    const s = await dispatchWake(['a', 'b'], 'new_command', 'veh-1', {}, h.deps);
    assertEquals(h.deleted, [], `status ${status} token sildirdi`);
    assertEquals(s.cleaned, 0);
  }
});

Deno.test('5. 🔒 ağ hatası token SİLDİRMEZ ve kardeşi durdurmaz', async () => {
  const h = harness((t) => { if (t === 'kopuk') throw new Error('ECONNRESET ya29.GIZLI'); return ok(); });
  const s = await dispatchWake(['kopuk', 'saglam'], 'new_command', 'veh-1', {}, h.deps);
  assertEquals(h.deleted, []);
  assertEquals(s.accepted, 1);
  assertEquals(s.failed, 1);
});

Deno.test('6. 🔒 400 INVALID_ARGUMENT token SİLDİRMEZ', async () => {
  const h = harness(() => jsonRes(400, { error: { code: 400, status: 'INVALID_ARGUMENT',
    details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' }] } }));
  const s = await dispatchWake(['a'], 'new_command', 'veh-1', {}, h.deps);
  assertEquals(h.deleted, []);
  assertEquals(s.failed, 1);
});

/* ── 3. Temizlik başarısızlığı ──────────────────────────────────────────── */

Deno.test('7. 🔒 temizlik başarısızlığı GİZLENMEZ ve kardeşi durdurmaz', async () => {
  const h = harness((t) => (t === 'olu' ? gone() : ok()),
    () => Promise.resolve({ ok: false }));
  const s = await dispatchWake(['olu', 'canli'], 'new_command', 'veh-1', {}, h.deps);

  assertEquals(s.cleanupFailed, 1);
  assertEquals(s.cleaned, 0, 'silinemeyen token "temizlendi" SAYILMAZ');
  assertEquals(s.accepted, 1, 'kardeş gönderim etkilenmemeli');
  assertEquals(h.warnings.length, 1);
});

Deno.test('8. temizlik ISTISNA atarsa da tur çökmez', async () => {
  const h = harness((t) => (t === 'olu' ? gone() : ok()),
    () => Promise.reject(new Error('db down')));
  const s = await dispatchWake(['olu', 'canli'], 'new_command', 'veh-1', {}, h.deps);
  assertEquals(s.cleanupFailed, 1);
  assertEquals(s.accepted, 1);
});

/* ── 4. İzolasyon ve gizlilik ───────────────────────────────────────────── */

Deno.test('9. 🔒 her token kendi isteğini alır (tek mesaj çok cihaz DEĞİL)', async () => {
  const h = harness(() => ok());
  await dispatchWake(['a', 'b', 'c'], 'new_command', 'veh-1', {}, h.deps);
  assertEquals(h.sentTo.sort(), ['a', 'b', 'c']);
});

Deno.test('10. 🔒 Authorization access token ile kurulur (legacy server key DEĞİL)', async () => {
  let authHeader = '';
  const deps: DispatchDeps = {
    accessToken: 'ya29.ACCESS',
    endpoint: ENDPOINT,
    now: () => 1,
    fetch: ((_u: string | URL, init?: RequestInit) => {
      authHeader = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      return Promise.resolve(ok());
    }) as unknown as typeof fetch,
    deleteToken: () => Promise.resolve({ ok: true }),
  };
  await dispatchWake(['a'], 'new_command', 'veh-1', {}, deps);
  assertEquals(authHeader, 'Bearer ya29.ACCESS');
});

Deno.test('11. 🔒 uyarı metni cihaz token\'ı veya access token TAŞIMAZ', async () => {
  const h = harness((t) => (t === 'CIHAZ-TOKEN-GIZLI' ? gone() : ok()),
    () => Promise.resolve({ ok: false }));
  await dispatchWake(['CIHAZ-TOKEN-GIZLI'], 'new_command', 'veh-1', {}, h.deps);
  const all = h.warnings.join(' ');
  assertEquals(all.includes('CIHAZ-TOKEN-GIZLI'), false);
  assertEquals(all.includes('ya29.GIZLI-ACCESS-TOKEN'), false);
  assert(all.length > 0, 'başarısızlık sessizce yutulmamalı');
});

Deno.test('12. token listesi BOŞ → güvenli no-op', async () => {
  const h = harness(() => ok());
  const s = await dispatchWake([], 'new_command', 'veh-1', {}, h.deps);
  assertEquals(s, { accepted: 0, failed: 0, cleaned: 0, cleanupFailed: 0 });
  assertEquals(h.sentTo, []);
});
