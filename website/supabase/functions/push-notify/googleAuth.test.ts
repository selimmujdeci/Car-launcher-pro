/**
 * googleAuth.test.ts — FCM HTTP v1 kimlik zinciri (Deno).
 * Çalıştırma: `deno test website/supabase/functions/push-notify/`
 *
 * ── GERÇEK CREDENTIAL YOK ────────────────────────────────────────────────
 * İmza testleri EPHEMERAL bir RSA anahtar çiftiyle çalışır; anahtar test
 * içinde üretilir, diske yazılmaz, repo'ya girmez. Gerçek service-account
 * anahtarı ne istenir ne kullanılır.
 */
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import {
  parseServiceAccount,
  buildAssertionClaims,
  signAssertion,
  fetchAccessToken,
  createAccessTokenProvider,
  FCM_SCOPE,
  JWT_BEARER_GRANT,
  DEFAULT_TOKEN_URI,
  ASSERTION_LIFETIME_SEC,
  TOKEN_EXPIRY_SKEW_MS,
  type ServiceAccount,
} from './googleAuth.ts';

/* ── Ephemeral anahtar (gerçek credential DEĞİL) ─────────────────────────── */

async function ephemeralKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  let bin = '';
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const pem = `-----BEGIN PRIVATE KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: kp.publicKey };
}

const SA_BASE = {
  type: 'service_account',
  project_id: 'caros-test',
  client_email: 'push@caros-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n',
  token_uri: DEFAULT_TOKEN_URI,
};
const saJson = (over: Record<string, unknown> = {}) => JSON.stringify({ ...SA_BASE, ...over });

const account = (over: Partial<ServiceAccount> = {}): ServiceAccount => ({
  projectId: 'caros-test',
  clientEmail: SA_BASE.client_email,
  privateKeyPem: SA_BASE.private_key,
  tokenUri: DEFAULT_TOKEN_URI,
  ...over,
});

const okTokenResponse = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ access_token: 'ya29.TEST', token_type: 'Bearer', expires_in: 3599, ...over }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · SERVICE ACCOUNT — fail closed
 * ══════════════════════════════════════════════════════════════════════════ */

Deno.test('1. geçerli service account → ayrıştırılır', () => {
  const r = parseServiceAccount(saJson());
  assert(r.ok);
  assertEquals(r.account.projectId, 'caros-test');
  assertEquals(r.account.tokenUri, DEFAULT_TOKEN_URI);
});

Deno.test('2. secret YOK → MISSING_SECRET (fail closed)', () => {
  for (const v of [undefined, null, '', '   ']) {
    const r = parseServiceAccount(v as string | null | undefined);
    assertEquals(r.ok, false);
    assertEquals((r as { reason: string }).reason, 'MISSING_SECRET');
  }
});

Deno.test('3. bozuk JSON → INVALID_JSON (hata metni TAŞINMAZ)', () => {
  for (const v of ['{ bozuk', '"düz metin"', '[1,2]', 'null']) {
    const r = parseServiceAccount(v);
    assertEquals(r.ok, false);
    assertEquals((r as { reason: string }).reason, 'INVALID_JSON');
  }
});

Deno.test('4. private_key eksik/bozuk → MISSING_PRIVATE_KEY', () => {
  assertEquals((parseServiceAccount(saJson({ private_key: undefined })) as { reason: string }).reason,
    'MISSING_PRIVATE_KEY');
  assertEquals((parseServiceAccount(saJson({ private_key: 'PEM DEĞİL' })) as { reason: string }).reason,
    'MISSING_PRIVATE_KEY');
});

Deno.test('5. client_email eksik → MISSING_CLIENT_EMAIL', () => {
  assertEquals((parseServiceAccount(saJson({ client_email: '' })) as { reason: string }).reason,
    'MISSING_CLIENT_EMAIL');
});

Deno.test('6. project_id eksik → MISSING_PROJECT_ID', () => {
  assertEquals((parseServiceAccount(saJson({ project_id: '' })) as { reason: string }).reason,
    'MISSING_PROJECT_ID');
});

Deno.test('7. 🔒 token_uri Google DIŞINA yönlendirilemez (assertion sızıntısı)', () => {
  for (const uri of ['http://oauth2.googleapis.com/token', 'https://evil.example.com/token', 'değil-url']) {
    const r = parseServiceAccount(saJson({ token_uri: uri }));
    assertEquals(r.ok, false, `kabul edilmemeli: ${uri}`);
    assertEquals((r as { reason: string }).reason, 'INVALID_TOKEN_URI');
  }
});

Deno.test('8. env\'de kaçışlanmış \\n gerçek satır sonuna çevrilir', () => {
  const r = parseServiceAccount(saJson({
    private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
  }));
  assert(r.ok);
  assert(r.account.privateKeyPem.includes('\n'));
  assert(!r.account.privateKeyPem.includes('\\n'));
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · JWT ASSERTION
 * ══════════════════════════════════════════════════════════════════════════ */

Deno.test('9. claim\'ler doğru: iss / scope / aud / iat / exp', () => {
  const now = 1_700_000_000_000;
  const c = buildAssertionClaims(account(), now);
  assertEquals(c.iss, SA_BASE.client_email);
  assertEquals(c.scope, FCM_SCOPE);
  assertEquals(c.aud, DEFAULT_TOKEN_URI);
  assert(c.exp > c.iat, 'exp iat\'ten sonra olmalı');
  assertEquals(c.exp - c.iat, ASSERTION_LIFETIME_SEC);
  /* Saat sapması payı: iat şimdiden ileride OLMAMALI. */
  assert(c.iat <= Math.floor(now / 1000));
});

Deno.test('10. ömür üst sınırla kapalı (1 saat aşılamaz)', () => {
  const c = buildAssertionClaims(account(), 1_700_000_000_000, 99_999);
  assertEquals(c.exp - c.iat, ASSERTION_LIFETIME_SEC);
});

Deno.test('11. 🔒 imza GERÇEKTEN RS256 ve doğrulanabilir', async () => {
  const { pem, publicKey } = await ephemeralKeyPair();
  const claims = buildAssertionClaims(account(), Date.now());
  const jwt = await signAssertion(claims, pem);
  assert(jwt, 'imza üretilemedi');

  const [h, p, s] = jwt.split('.');
  assertEquals(JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/'))), { alg: 'RS256', typ: 'JWT' });
  assertEquals(JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))).scope, FCM_SCOPE);

  const sigB64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(sigB64);
  const sig = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) sig[i] = bin.charCodeAt(i);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
  assertEquals(valid, true, 'imza gerçek açık anahtarla doğrulanmalı');
});

Deno.test('12. bozuk PEM → null (istisna metni sızmaz)', async () => {
  assertEquals(await signAssertion(buildAssertionClaims(account(), Date.now()), 'PEM DEĞİL'), null);
  assertEquals(await signAssertion(buildAssertionClaims(account(), Date.now()),
    '-----BEGIN PRIVATE KEY-----\n!!!!\n-----END PRIVATE KEY-----'), null);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · OAUTH TOKEN EXCHANGE
 * ══════════════════════════════════════════════════════════════════════════ */

const deps = (fetchImpl: typeof fetch, now = 1_700_000_000_000) => ({
  now:   () => now,
  fetch: fetchImpl,
  sign:  () => Promise.resolve('imzali.jwt.assertion'),
});

Deno.test('13. başarılı takas → access token + bitiş anı', async () => {
  let seen: { url: string; body: string } | null = null;
  const f = ((url: string | URL, init?: RequestInit) => {
    seen = { url: String(url), body: String(init?.body ?? '') };
    return Promise.resolve(okTokenResponse());
  }) as unknown as typeof fetch;

  const r = await fetchAccessToken(account(), deps(f));
  assert(r.ok);
  assertEquals(r.accessToken, 'ya29.TEST');
  assertEquals(r.expiresAtMs, 1_700_000_000_000 + 3599_000);
  assertEquals(seen!.url, DEFAULT_TOKEN_URI);
  assert(seen!.body.includes(`grant_type=${encodeURIComponent(JWT_BEARER_GRANT)}`));
  assert(seen!.body.includes('assertion=imzali.jwt.assertion'));
});

Deno.test('14. imza üretilemezse OAuth\'a HİÇ gidilmez', async () => {
  let called = false;
  const f = (() => { called = true; return Promise.resolve(okTokenResponse()); }) as unknown as typeof fetch;
  const r = await fetchAccessToken(account(), { now: () => 0, fetch: f, sign: () => Promise.resolve(null) });
  assertEquals(r, { ok: false, reason: 'ASSERTION_FAILED' });
  assertEquals(called, false);
});

Deno.test('15. OAuth 2xx DEĞİL → OAUTH_HTTP_ERROR', async () => {
  const f = (() => Promise.resolve(new Response('nope', { status: 400 }))) as unknown as typeof fetch;
  const r = await fetchAccessToken(account(), deps(f));
  assertEquals(r, { ok: false, reason: 'OAUTH_HTTP_ERROR', status: 400 });
});

Deno.test('16. 🔒 HTTP 200 ama access_token YOK → BAŞARI DEĞİL', async () => {
  const f = (() => Promise.resolve(new Response(JSON.stringify({ token_type: 'Bearer', expires_in: 3599 }),
    { status: 200 }))) as unknown as typeof fetch;
  const r = await fetchAccessToken(account(), deps(f));
  assertEquals(r, { ok: false, reason: 'OAUTH_NO_ACCESS_TOKEN', status: 200 });
});

Deno.test('17. token_type Bearer değilse reddedilir', async () => {
  const f = (() => Promise.resolve(okTokenResponse({ token_type: 'mac' }))) as unknown as typeof fetch;
  const r = await fetchAccessToken(account(), deps(f));
  assertEquals((r as { reason: string }).reason, 'OAUTH_BAD_RESPONSE');
});

Deno.test('18. expires_in okunamazsa ömür UYDURULMAZ (önbelleğe alınamaz)', async () => {
  const f = (() => Promise.resolve(okTokenResponse({ expires_in: 'çok' }))) as unknown as typeof fetch;
  const r = await fetchAccessToken(account(), deps(f));
  assert(r.ok);
  assertEquals(r.expiresAtMs, 1_700_000_000_000);
});

Deno.test('19. ağ hatası → OAUTH_NETWORK_ERROR (istisna metni taşınmaz)', async () => {
  const f = (() => Promise.reject(new Error('assertion=imzali.jwt.assertion sızdı'))) as unknown as typeof fetch;
  const r = await fetchAccessToken(account(), deps(f));
  assertEquals(r, { ok: false, reason: 'OAUTH_NETWORK_ERROR' });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · ACCESS TOKEN ÖNBELLEĞİ
 * ══════════════════════════════════════════════════════════════════════════ */

Deno.test('20. 🔒 aynı invocation\'da TEK OAuth turu (çok cihaz token\'ı)', async () => {
  let n = 0;
  const f = (() => { n++; return Promise.resolve(okTokenResponse()); }) as unknown as typeof fetch;
  const p = createAccessTokenProvider(account(), deps(f));

  const [a, b, c] = await Promise.all([p.get(), p.get(), p.get()]);
  assert(a.ok && b.ok && c.ok);
  assertEquals(n, 1, 'her cihaz token\'ı için ayrı OAuth turu ATILMAMALI');
});

Deno.test('21. 🔒 SÜRESİ DOLMAKTA olan token yeniden kullanılmaz (güvenlik payı)', async () => {
  let n = 0;
  let now = 1_700_000_000_000;
  const f = (() => { n++; return Promise.resolve(okTokenResponse({ expires_in: 120 })); }) as unknown as typeof fetch;
  const p = createAccessTokenProvider(account(), { now: () => now, fetch: f, sign: () => Promise.resolve('a.b.c') });

  await p.get();
  assertEquals(n, 1);
  now += 30_000;                      // hâlâ pay içinde → yeniden kullanılır
  await p.get();
  assertEquals(n, 1);
  now += 120_000 - TOKEN_EXPIRY_SKEW_MS; // pay aşıldı → yenilenmeli
  await p.get();
  assertEquals(n, 2);
});

Deno.test('22. başarısız takas ÖNBELLEĞE ALINMAZ', async () => {
  let fail = true, n = 0;
  const f = (() => {
    n++;
    return Promise.resolve(fail ? new Response('x', { status: 500 }) : okTokenResponse());
  }) as unknown as typeof fetch;
  const p = createAccessTokenProvider(account(), deps(f));

  assertEquals((await p.get()).ok, false);
  fail = false;
  assertEquals((await p.get()).ok, true);
  assertEquals(n, 2);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · GİZLİLİK
 * ══════════════════════════════════════════════════════════════════════════ */

Deno.test('23. 🔒 hata sebepleri sır TAŞIMAZ (kategori, değer değil)', async () => {
  const SECRET = 'SUPER-GIZLI-PRIVATE-KEY-PARCASI';
  const cases: unknown[] = [
    parseServiceAccount(`{ bozuk ${SECRET}`),
    parseServiceAccount(saJson({ private_key: SECRET })),
    await fetchAccessToken(account({ privateKeyPem: SECRET }), {
      now: () => 0,
      fetch: (() => Promise.reject(new Error(SECRET))) as unknown as typeof fetch,
      sign: () => Promise.resolve(null),
    }),
  ];
  for (const c of cases) {
    const s = JSON.stringify(c);
    assertEquals(s.includes(SECRET), false, `sır sonuç nesnesine sızdı: ${s}`);
  }
});

Deno.test('24. başarı nesnesi access token DIŞINDA sır taşımaz', async () => {
  const f = (() => Promise.resolve(okTokenResponse())) as unknown as typeof fetch;
  const r = await fetchAccessToken(account({ privateKeyPem: 'GIZLI-PEM' }), deps(f));
  assert(r.ok);
  const s = JSON.stringify(r);
  assertEquals(s.includes('GIZLI-PEM'), false);
  assertNotEquals(s.includes('ya29.TEST'), false); // token çağırana lazım — ama LOGLANMAZ
});
