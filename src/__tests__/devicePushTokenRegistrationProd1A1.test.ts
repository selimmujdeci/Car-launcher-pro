/**
 * devicePushTokenRegistrationProd1A1.test.ts — ARAÇ KENDİ TOKEN'INI KAYDEDER.
 *
 * ── TEMEL İLKE ──────────────────────────────────────────────────────────────
 *   Cihaz kimliği  ≠  kullanıcı kimliği  ≠  eşleştirme
 *   "RPC HTTP 200" ≠  "token kaydedildi"
 *
 * ── ÖLÇÜLEN KUSUR (PROD-1A, 2026-09-19) ────────────────────────────────────
 * Production'da `vehicle_push_tokens` = **0 satır**. Tek kayıt yolu
 * `register_push_token(p_vehicle_id, …)` idi ve o RPC `auth.uid()` ister;
 * head unit Supabase'e OTURUMSUZ bağlandığı için her çağrı
 * `{ok:false,'Yetkisiz.'}` dönüyordu. Çağrı istisna ATMADIĞI için istemci
 * hemen ardından "FCM token kaydedildi" loglamayı sürdürüyordu.
 *
 * Buradaki kilitler, (a) kaydı yeniden kullanıcı oturumuna bağlayan,
 * (b) aracı istemciye seçtiren, (c) kanıtsız başarı iddia eden her
 * değişiklikte DÜŞER.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── Ortak sahte depo (hoisted: vi.mock fabrikası içinde kullanılır) ─────── */

const M = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: {
    get:    vi.fn(async (k: string) => M.store.get(k) ?? null),
    set:    vi.fn(async (k: string, v: string) => { M.store.set(k, v); }),
    remove: vi.fn(async (k: string) => { M.store.delete(k); }),
  },
}));

vi.mock('../platform/connectivityService', () => ({
  connectivityService: { enqueue: vi.fn(async () => {}) },
}));

const API_KEY = 'gizli-arac-anahtari-1234';
const TOKEN   = 'fcm-token-AAAA-gizli-tanimlayici';

/** Çağrı defteri — her fetch'in url + ayrıştırılmış gövdesi. */
type Call = { url: string; body: Record<string, unknown> };

function mockFetch(responder: (call: Call, n: number) => { ok: boolean; json: unknown }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: { body?: string }) => {
    const call = { url: String(url), body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> };
    calls.push(call);
    const r = responder(call, calls.length);
    return { ok: r.ok, json: async () => r.json };
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const okResponse = { ok: true, json: { ok: true } };

beforeEach(() => {
  vi.resetModules();                 // taze modül state (_apiKey / _persistedPushToken)
  M.store = new Map([['veh_api_key', API_KEY], ['veh_vehicle_id', 'veh-123']]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · CİHAZ KİMLİĞİ — api_key ile kayıt
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A1 · cihaz kimliğiyle token kaydı', () => {
  it('1. 🔒 geçerli api_key → token KANIT ile kaydedilir', async () => {
    const calls = mockFetch(() => okResponse);
    const vis = await import('../platform/vehicleIdentityService');

    expect(await vis.registerDevicePushToken(TOKEN, 'android')).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/rpc/register_vehicle_push_token');
    expect(calls[0]!.body.p_api_key).toBe(API_KEY);
    expect(calls[0]!.body.p_fcm_token).toBe(TOKEN);
  });

  it('2. 🔒 İSTEMCİ ARAÇ SEÇEMEZ — gövdede `p_vehicle_id`/`vehicle_id` YOK', async () => {
    /* MUTASYON KAPISI: araç kimliği istemciden gelirse, bir aracın anahtarıyla
       BAŞKA aracın token'ı yazılabilir hâle gelir (cross-vehicle injection). */
    const calls = mockFetch(() => okResponse);
    const vis = await import('../platform/vehicleIdentityService');
    await vis.registerDevicePushToken(TOKEN, 'android');

    const keys = Object.keys(calls[0]!.body);
    expect(keys).not.toContain('p_vehicle_id');
    expect(keys).not.toContain('vehicle_id');
    expect(keys.sort()).toEqual(['p_api_key', 'p_fcm_token', 'p_platform']);
  });

  it('3. 🔒 api_key YOKSA fail-closed — ağa HİÇ çıkılmaz', async () => {
    M.store = new Map();               // eşlenmemiş cihaz
    const calls = mockFetch(() => okResponse);
    const vis = await import('../platform/vehicleIdentityService');

    expect(await vis.registerDevicePushToken(TOKEN, 'android'))
      .toEqual({ ok: false, reason: 'NO_API_KEY' });
    expect(calls).toHaveLength(0);
  });

  it('4. 🔒 GEÇERSİZ api_key (sunucu 4xx) → başarı DEĞİL', async () => {
    /* RPC geçersiz anahtarda istisna atar → PostgREST 4xx → taşıyıcı hatası. */
    const calls = mockFetch(() => ({ ok: false, json: { message: 'Geçersiz api_key' } }));
    const vis = await import('../platform/vehicleIdentityService');

    expect(await vis.registerDevicePushToken('yanlis-anahtar', 'android'))
      .toEqual({ ok: false, reason: 'RPC_FAILED' });
    expect(calls).toHaveLength(1);
  });

  it('5. 🔒 HTTP 200 + `{ok:false}` → REJECTED (SAHTE BAŞARI YOK)', async () => {
    /* Bu tam olarak eski kusurdur: taşıma başarılı, kalıcılık YOK. */
    mockFetch(() => ({ ok: true, json: { ok: false, error: 'invalid_platform' } }));
    const vis = await import('../platform/vehicleIdentityService');

    expect(await vis.registerDevicePushToken(TOKEN, 'web'))
      .toEqual({ ok: false, reason: 'REJECTED' });
  });

  it('6. 🔒 backend yapılandırılmamışsa bile "kaydedildi" DENMEZ', async () => {
    const vis = await import('../platform/vehicleIdentityService');
    /* Ön koşul: bu ortamda env GÖMÜLÜ (aksi hâlde kilit boş yere geçerdi). */
    expect(vis.getVehicleEventPipelineStatus().configured).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · IDEMPOTENCY · ROTASYON · KURTARMA
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A1 · idempotency, rotasyon, kurtarma', () => {
  it('7. 🔒 aynı token ikinci kez ağa ÇIKMAZ (çift servis israfı kesilir)', async () => {
    const calls = mockFetch(() => okResponse);
    const vis = await import('../platform/vehicleIdentityService');

    expect(await vis.ensureDevicePushTokenRegistered(TOKEN, 'android')).toEqual({ ok: true });
    expect(await vis.ensureDevicePushTokenRegistered(TOKEN, 'android')).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it('8. 🔒 TOKEN YENİLENİRSE yeni token KAYDEDİLİR', async () => {
    const calls = mockFetch(() => okResponse);
    const vis = await import('../platform/vehicleIdentityService');

    await vis.ensureDevicePushTokenRegistered(TOKEN, 'android');
    expect(await vis.ensureDevicePushTokenRegistered('fcm-token-BBBB', 'android'))
      .toEqual({ ok: true });

    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.p_fcm_token).toBe('fcm-token-BBBB');
  });

  it('9. 🔒 GEÇİCİ hata sonrası kurtarma: sınırlı tekrar denenir', async () => {
    /* Saha senaryosu: token boot'un çok erken anında gelir, ağ/anahtar henüz
       hazır değildir ve token BİR DAHA DEĞİŞMEZ. Tek deneme olsaydı cihaz o
       açılış boyunca kayıtsız kalırdı. */
    const calls = mockFetch((_c, n) => (n === 1 ? { ok: false, json: {} } : okResponse));
    const vis = await import('../platform/vehicleIdentityService');

    expect(await vis.ensureDevicePushTokenRegistered(TOKEN, 'android', { retryDelaysMs: [0] }))
      .toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('10. 🔒 KALICI ret tekrar denenmez (sunucu kararı korunur)', async () => {
    const calls = mockFetch(() => ({ ok: true, json: { ok: false, error: 'invalid_fcm_token' } }));
    const vis = await import('../platform/vehicleIdentityService');

    expect(await vis.ensureDevicePushTokenRegistered(TOKEN, 'android', { retryDelaysMs: [0, 0] }))
      .toEqual({ ok: false, reason: 'REJECTED' });
    expect(calls).toHaveLength(1);
  });

  it('11. 🔒 başarısız kayıt CACHE\'LENMEZ — sonraki deneme yeniden çıkar', async () => {
    let fail = true;
    const calls = mockFetch(() => (fail ? { ok: false, json: {} } : okResponse));
    const vis = await import('../platform/vehicleIdentityService');

    expect((await vis.ensureDevicePushTokenRegistered(TOKEN, 'android', { retryDelaysMs: [] })).ok)
      .toBe(false);
    fail = false;
    expect(await vis.ensureDevicePushTokenRegistered(TOKEN, 'android', { retryDelaysMs: [] }))
      .toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · GİZLİLİK — token ve api_key SIZMAZ
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A1 · gizlilik', () => {
  it('12. 🔒 hata yolunda token/api_key KONSOLA yazılmaz', async () => {
    const seen: string[] = [];
    for (const k of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { seen.push(a.map(String).join(' ')); });
    }
    mockFetch(() => { throw new Error(`ağ hatası: ${API_KEY}`); });
    const vis = await import('../platform/vehicleIdentityService');

    await vis.ensureDevicePushTokenRegistered(TOKEN, 'android', { retryDelaysMs: [] });

    const all = seen.join('\n');
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain(TOKEN);
  });

  it('13. 🔒 anahtar YALNIZ gövdede taşınır — URL/başlıkta DEĞİL', async () => {
    const calls = mockFetch(() => okResponse);
    const vis = await import('../platform/vehicleIdentityService');
    await vis.registerDevicePushToken(TOKEN, 'android');

    expect(calls[0]!.url).not.toContain(API_KEY);
    expect(calls[0]!.url).not.toContain(TOKEN);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · KAYNAK KİLİTLERİ — istemci bağlantısı ve TEK otorite
 * ══════════════════════════════════════════════════════════════════════════ */

const ROOT = resolve(__dirname, '../../');
/** Yorumları söker — kuralı AÇIKLAYAN yorum ihlal sanılmasın (`://` korunur). */
const codeOf = (rel: string) =>
  readFileSync(resolve(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

describe('PROD-1A1 · istemci TEK cihaz-kimlik otoritesini kullanır', () => {
  const PUSH = codeOf('src/platform/pushService.ts');
  const FCM  = codeOf('src/platform/fcmService.ts');

  it('14. 🔒 iki servis de KULLANICI-auth `register_push_token`\'ı ÇAĞIRMAZ', () => {
    /* MUTASYON KAPISI: geri dönerse `auth.uid()` NULL olur ve kayıt yine
       sessizce 'Yetkisiz.' ile düşer — ölçülen 0-satır durumuna geri dönülür. */
    expect(PUSH).not.toContain("rpc('register_push_token'");
    expect(FCM).not.toContain("rpc('register_push_token'");
    expect(PUSH).not.toContain('p_vehicle_id');
    expect(FCM).not.toContain('p_vehicle_id');
  });

  it('15. 🔒 ikisi de AYNI kayıt otoritesini kullanır (ikinci yol açılmaz)', () => {
    expect(PUSH).toContain('ensureDevicePushTokenRegistered');
    expect(FCM).toContain('ensureDevicePushTokenRegistered');
    /* Kendi Supabase istemcisiyle token yazmazlar. */
    expect(PUSH).not.toMatch(/vehicle_push_tokens/);
    expect(FCM).not.toMatch(/vehicle_push_tokens/);
  });

  it('16. 🔒 `active` durumu KANITA bağlıdır (token gelmesi yetmez)', () => {
    /* Eskiden `registration` dinleyicisinde koşulsuz `_status = 'active'`
       atanıyordu — token'ı ALMAK, onu KAYDETMİŞ olmak değildir. */
    expect(PUSH).toMatch(/if\s*\(result\.ok\)\s*\{[\s\S]{0,120}_status\s*=\s*'active'/);
    expect(PUSH).toContain("_status = 'unregistered'");
  });

  it('17. 🔒 başarı logu YALNIZ kanıtlı dalda (sahte başarı geri gelmez)', () => {
    const basari = PUSH.indexOf("logInfo('[PushService] FCM token kaydedildi");
    const kanit  = PUSH.indexOf('if (result.ok)');
    expect(kanit).toBeGreaterThan(-1);
    expect(basari).toBeGreaterThan(kanit);
    /* Log satırı token/anahtar DEĞERİ taşımaz. */
    expect(PUSH).not.toMatch(/logInfo\([^)]*\$\{token\}/);
    expect(FCM).not.toMatch(/logInfo\([^)]*\$\{token\}/);
  });

  it('18. 🔒 EŞLEŞTİRME cihaz token kaydının ön koşulu DEĞİL', () => {
    /* Cihaz kimliği (api_key) yeterlidir; kullanıcı eşleştirmesi ARANMAZ. */
    const VIS = codeOf('src/platform/vehicleIdentityService.ts');
    const fn = VIS.slice(VIS.indexOf('export async function registerDevicePushToken'));
    const gövde = fn.slice(0, fn.indexOf('\n}'));
    expect(gövde).toContain('SK_API_KEY');
    expect(gövde).not.toContain('isDevicePaired');
    expect(gövde).not.toContain('auth.uid');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · MIGRATION 082 — statik güvenlik denetimi
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A1 · migration 082 güvenlik sözleşmesi', () => {
  const REL = 'supabase/migrations/20260919000082_vehicle_push_token_device_auth.sql';
  const SQL = readFileSync(resolve(ROOT, REL), 'utf8');
  /** Yalnız ÇALIŞTIRILABİLİR SQL — kendi açıklama yorumuna takılmamak için. */
  const exec = SQL.replace(/--[^\n]*/g, '');

  it('19. 🔒 imzada `p_vehicle_id` YOK — araç sunucuda türetilir', () => {
    expect(exec).toContain('CREATE OR REPLACE FUNCTION public.register_vehicle_push_token');
    const imza = exec.slice(
      exec.indexOf('CREATE OR REPLACE FUNCTION public.register_vehicle_push_token'),
      exec.indexOf('RETURNS jsonb'),
    );
    expect(imza).not.toContain('p_vehicle_id');
    expect(imza).toContain('p_api_key');
  });

  it('20. 🔒 kimlik çözümü MEVCUT komut RPC deseninin AYNISI', () => {
    /* İkinci bir cihaz kimliği otoritesi ÜRETİLMEZ. */
    expect(exec).toMatch(
      /api_key_hash\s*=\s*encode\(digest\(p_api_key,\s*'sha256'\),\s*'hex'\)[\s\S]{0,80}OR\s+api_key_hash\s*=\s*p_api_key/,
    );
    expect(exec).not.toMatch(/auth\.uid\(\)/);
    expect(exec).not.toMatch(/is_paired\s*\(/);
  });

  it('21. 🔒 SECURITY DEFINER + search_path `extensions` içerir (071 dersi)', () => {
    /* `extensions` yoksa `digest()` çözülemez ve fonksiyon 42883 ile ölür —
       komut RPC'leri tam olarak bu yüzden uygulandıkları günden beri ölüydü. */
    expect(exec).toMatch(/SECURITY DEFINER SET search_path = public, extensions/);
  });

  it('22. 🔒 ÇAĞRILABİLİR ≠ YETKİLİ: PUBLIC revoke, anon grant', () => {
    expect(exec).toMatch(/REVOKE ALL ON FUNCTION public\.register_vehicle_push_token\(text, text, text\) FROM PUBLIC;/);
    expect(exec).toMatch(/GRANT EXECUTE ON FUNCTION public\.register_vehicle_push_token\(text, text, text\) TO anon;/);
  });

  it('23. 🔒 yetkisiz çağrı FAIL-CLOSED (istisna) ve doğrulama bunu ÖLÇER', () => {
    expect(exec).toMatch(/IF p_api_key IS NULL OR length\(btrim\(p_api_key\)\) = 0 THEN[\s\S]{0,120}RAISE EXCEPTION/);
    /* Doğrulama bloğu "istisna attı mı"nın yanında "satır yazdı mı"yı da ölçer. */
    expect(exec).toContain('yetkisiz çağrı satır YAZDI');
    expect(exec).toMatch(/IF v_kod = '42883' THEN/);
  });

  it('24. 🔒 başarı KANITLANIR — `RETURNING id` yoksa ok:true DENMEZ', () => {
    expect(exec).toMatch(/RETURNING id INTO v_row_id/);
    expect(exec).toMatch(/IF v_row_id IS NULL THEN[\s\S]{0,140}'persist_failed'/);
  });

  it('25. 🔒 hata mesajı api_key DEĞERİNİ taşımaz', () => {
    const raises = exec.match(/RAISE EXCEPTION[^;]*;/g) ?? [];
    expect(raises.length).toBeGreaterThan(0);
    for (const r of raises) expect(r).not.toContain('p_api_key');
  });

  it('26. 🔒 YIKICI DDL YOK — tablo/RLS/veri dokunulmaz', () => {
    expect(exec).not.toMatch(/\bDROP\b/);
    expect(exec).not.toMatch(/\bTRUNCATE\b/);
    expect(exec).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(exec).not.toMatch(/CREATE\s+TABLE/i);
    expect(exec).not.toMatch(/CREATE\s+POLICY|ALTER\s+TABLE/i);
    /* Eski kullanıcı-auth RPC'si bu turda KALDIRILMAZ. */
    expect(exec).not.toMatch(/DROP FUNCTION[^;]*register_push_token/);
  });

  it('27. 🔒 eski token\'lar SİLİNMEZ (çok cihazlı araç korunur)', () => {
    const gövde = exec.slice(exec.indexOf('AS $fn$'), exec.indexOf('$fn$;'));
    expect(gövde).not.toMatch(/\bDELETE\b/);
    expect(gövde).toMatch(/ON CONFLICT \(vehicle_id, fcm_token\) DO UPDATE/);
  });

  it('28. 🔒 077–081 kapsamına DOKUNULMAZ', () => {
    for (const ad of [
      'push_subscriptions', 'consumer_notification_state',
      'vehicle_diagnostic_scans', 'obd_group_stamp', 'vehicle_telemetry',
    ]) {
      expect(SQL, `082, ${ad} kapsamına girmiş`).not.toContain(ad);
    }
  });

  it('29. 🔒 ön koşullar fail-closed (tablo/kısıt/pgcrypto)', () => {
    expect(exec).toContain("to_regclass('public.vehicle_push_tokens') IS NULL");
    expect(exec).toContain('vehicle_push_tokens_vehicle_id_fcm_token_key');
    expect(exec).toMatch(/pg_extension[\s\S]{0,200}pgcrypto/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · MEVCUT OTORİTE KORUNDU
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A1 · mevcut otoriteler bozulmadı', () => {
  it('30. 🔒 kullanıcı-auth `register_push_token` hâlâ şemada DURUYOR', () => {
    const baseline = readFileSync(
      resolve(ROOT, 'supabase/migrations/00000000000000_prod_baseline.sql'), 'utf8');
    expect(baseline).toContain('CREATE OR REPLACE FUNCTION public.register_push_token(');
  });

  it('31. 🔒 kullanıcı UNPAIR\'i cihaz token\'ına DOKUNMAZ', () => {
    /* Token araç runtime'ına aittir, kullanıcı eşleştirmesine değil. */
    const unpair = readFileSync(
      resolve(ROOT, 'supabase/migrations/20260917000076_unpair_vehicle_from_user_p0.sql'), 'utf8')
      .replace(/--[^\n]*/g, '');
    expect(unpair).not.toContain('vehicle_push_tokens');
  });
});
