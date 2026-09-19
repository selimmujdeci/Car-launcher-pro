/**
 * fcmHttpV1AuthProd1A2.test.ts — FCM TAŞIMA KİMLİĞİ REPO ÇAPINDA KİLİTLİ.
 *
 * ── TEMEL İLKE ──────────────────────────────────────────────────────────────
 *   OAuth token alındı ≠ FCM kabul etti ≠ cihaz aldı ≠ araç uyandı
 *   ≠ komut alındı ≠ fiziksel işlem gerçekleşti.
 *
 * ── ÖLÇÜLEN KUSUR (PROD-1A, 2026-09-19) ────────────────────────────────────
 * `push-notify` FCM **HTTP v1** ucuna gidip `Bearer ${FCM_SERVER_KEY}`
 * gönderiyordu. v1 legacy server key KABUL ETMEZ → hiçbir secret
 * kombinasyonuyla çalışamazdı. Davranışsal kanıt Deno testlerindedir
 * (`googleAuth.test.ts` · `fcmDelivery.test.ts` · `wakeDispatch.test.ts`);
 * bu dosya, repo çapında geri dönüşü engelleyen KAYNAK kilitlerini tutar ve
 * her `npm test` turunda koşar.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../');
const FN   = (f: string) => resolve(ROOT, 'website/supabase/functions/push-notify', f);

const read = (p: string) => readFileSync(p, 'utf8');
/**
 * Yorumları söker — bir kuralı AÇIKLAYAN yorum ihlal sanılmasın.
 * `://` KORUNUR: naif bir `//` sökücüsü `https://fcm.googleapis.com/...`
 * URL'ini de siler ve ölçüm YANLIŞ DÜŞER (F5.2'de fiilen yaşandı).
 */
const codeOf = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const INDEX    = codeOf(FN('index.ts'));
const AUTH     = codeOf(FN('googleAuth.ts'));
const DELIVERY = codeOf(FN('fcmDelivery.ts'));
const DISPATCH = codeOf(FN('wakeDispatch.ts'));
const PUSHAUTH = codeOf(FN('pushAuth.ts'));

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · LEGACY SERVER KEY GERİ GELEMEZ
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A2 · legacy server key v1 bearer olarak kullanılamaz', () => {
  it('1. 🔒 fonksiyonun HİÇBİR dosyası `FCM_SERVER_KEY` OKUMAZ', () => {
    /* MUTASYON KAPISI: geri gelirse v1 ucu 401 döner ve Push-to-Wake yine
       hiçbir cihaza ulaşmaz — ölçülen kusurun aynısı. */
    for (const [ad, src] of Object.entries({ INDEX, AUTH, DELIVERY, DISPATCH })) {
      expect(src, `${ad} legacy server key okuyor`).not.toContain('FCM_SERVER_KEY');
    }
  });

  it('2. 🔒 Authorization YALNIZ kısa ömürlü access token ile kurulur', () => {
    expect(DISPATCH).toMatch(/'Authorization':\s*`Bearer \$\{deps\.accessToken\}`/);
    /* Gönderim başlığını kuran TEK yer burasıdır. */
    expect(INDEX).not.toMatch(/Authorization[^\n]*fcm/i);
  });

  it('3. 🔒 uç nokta HTTP v1 (legacy `/fcm/send` yok)', () => {
    expect(DELIVERY).toContain('https://fcm.googleapis.com/v1/projects/');
    expect(DELIVERY).toContain('/messages:send');
    for (const src of [INDEX, DELIVERY, DISPATCH]) {
      expect(src).not.toContain('/fcm/send');
      expect(src).not.toContain('googleapis.com/fcm');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · KİMLİK ZİNCİRİ VE TEK PROJECT-ID OTORİTESİ
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A2 · service account tek otoritedir', () => {
  it('4. 🔒 tek secret okunur: FCM_SERVICE_ACCOUNT_JSON', () => {
    expect(INDEX).toContain("Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')");
  });

  it('5. 🔒 gönderim project_id\'si SERVICE ACCOUNT\'tan gelir', () => {
    expect(INDEX).toContain('FCM_SEND_ENDPOINT(account.projectId)');
    /* Eski env gönderim adresini BELİRLEMEZ. */
    expect(INDEX).not.toMatch(/FCM_SEND_ENDPOINT\(\s*LEGACY_PROJECT_ID/);
  });

  it('6. 🔒 iki kaynak çelişirse FAIL-CLOSED (tahmin YOK)', () => {
    expect(INDEX).toMatch(/LEGACY_PROJECT_ID !== account\.projectId/);
    expect(INDEX).toContain('PROJECT_ID_MISMATCH');
    expect(INDEX).toMatch(/PROJECT_ID_MISMATCH';\s*account = null;/);
  });

  it('7. 🔒 OAuth kapsamı EN DAR (firebase.messaging)', () => {
    expect(AUTH).toContain("'https://www.googleapis.com/auth/firebase.messaging'");
    /* Geniş bulut kapsamı istenmez. */
    expect(AUTH).not.toContain('auth/cloud-platform');
  });

  it('8. 🔒 assertion YALNIZ Google\'a gönderilebilir', () => {
    expect(AUTH).toMatch(/hostname\.endsWith\('\.googleapis\.com'\)/);
    expect(AUTH).toMatch(/protocol !== 'https:'/);
  });

  it('9. 🔒 RS256 + standart Web Crypto (özel kripto YOK, ağır SDK YOK)', () => {
    expect(AUTH).toContain("alg: 'RS256'");
    expect(AUTH).toContain("'RSASSA-PKCS1-v1_5'");
    for (const bad of ['firebase-admin', 'google-auth-library', 'googleapis', 'jsonwebtoken']) {
      expect(AUTH, `ağır bağımlılık eklenmiş: ${bad}`).not.toContain(`npm:${bad}`);
    }
  });

  it('10. 🔒 OAuth başarısızsa FCM\'e HİÇ gidilmez, token SİLİNMEZ', () => {
    const i = INDEX.indexOf('if (!auth.ok)');
    const d = INDEX.indexOf('dispatchWake(');
    expect(i).toBeGreaterThan(-1);
    expect(d).toBeGreaterThan(i);          // gönderim auth kapısından SONRA
    expect(INDEX).toMatch(/if \(!auth\.ok\)[\s\S]{0,400}return json\(/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · TOKEN SİLME YETKİSİ DAR
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A2 · yalnız kalıcı geçersizlik token sildirir', () => {
  it('11. 🔒 silme kapısı TEK yerde ve DAR', () => {
    expect(DELIVERY).toMatch(/shouldDeleteToken[\s\S]{0,200}'PERMANENT_INVALID_TOKEN'/);
    expect(DELIVERY).toContain("code === 'UNREGISTERED'");
    /* Geçici sınıf silme kapısına BAĞLANMAZ. */
    expect(DELIVERY).not.toMatch(/kind === 'TRANSIENT'[\s\S]{0,60}delete/i);
  });

  it('12. 🔒 401/403/429/5xx GEÇİCİ sayılır', () => {
    expect(DELIVERY).toMatch(/status === 401 \|\| status === 403 \|\| status === 429 \|\| status >= 500/);
  });

  it('13. 🔒 silme YALNIZ (araç, token) satırına iner — toplu silme YOK', () => {
    expect(INDEX).toMatch(/\.delete\(\)[\s\S]{0,160}\.eq\('vehicle_id', vehicleId\)[\s\S]{0,120}\.eq\('fcm_token', fcmToken\)/);
    expect(INDEX).not.toMatch(/\btruncate\b/i);
    /* Aracın TÜM token'larını silen bir yol YOK. */
    expect(INDEX).not.toMatch(/\.delete\(\)\s*\n\s*\.eq\('vehicle_id', vehicleId\)\s*\n\s*;/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · TESLİMAT ANLAMBİLİMİ — fazlası İDDİA EDİLMEZ
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A2 · yanıt kabulden fazlasını iddia etmez', () => {
  it('14. 🔒 yanıt alanı `accepted` (delivered/woke/executed DEĞİL)', () => {
    expect(INDEX).toContain('accepted: summary.accepted');
    for (const yalan of ['delivered', 'woke', 'executed', 'verified', 'acknowledged']) {
      expect(INDEX.toLowerCase(), `yanıt "${yalan}" iddia ediyor`).not.toContain(`${yalan}:`);
    }
  });

  it('15. 🔒 kayıtlı cihaz yoksa güvenli no-op (başarısızlık DEĞİL)', () => {
    expect(INDEX).toMatch(/NO_REGISTERED_DEVICE[\s\S]{0,80}accepted: 0/);
  });

  it('16. 🔒 wake payload\'ı komut icra alanı TAŞIMAZ', () => {
    for (const k of ['cmd_type', 'cmd_id', 'e2e_payload', 'notification']) {
      expect(DELIVERY, `wake mesajı ${k} taşıyor`).not.toContain(`${k}:`);
    }
    expect(DELIVERY).toContain('direct_boot_ok');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · GİZLİLİK — sır loglanmaz
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A2 · sır sızıntısı kilidi', () => {
  it('17. 🔒 hiçbir console çağrısı sır DEĞERİ interpolate etmez', () => {
    const calls = [INDEX, AUTH, DELIVERY, DISPATCH]
      .flatMap((s) => s.match(/console\.\w+\([^)]*\)/g) ?? []);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      for (const sir of ['accessToken', 'access_token', 'privateKey', 'private_key',
                         'assertion', 'FCM_SERVICE_ACCOUNT_JSON', 'fcmToken', 'fcm_token',
                         'SERVICE_ROLE_KEY', 'ANON_KEY']) {
        expect(c, `log sır taşıyor: ${c}`).not.toContain(sir);
      }
    }
  });

  it('18. 🔒 yapılandırma hatası KATEGORİ döner, secret DEĞERİ değil', () => {
    expect(INDEX).toMatch(/detail: configReason/);
    expect(INDEX).not.toMatch(/detail:\s*FCM_SERVICE_ACCOUNT_JSON/);
  });

  it('19. 🔒 ağ/ayrıştırma istisnaları dışarı TAŞINMAZ', () => {
    /* İstisna metni istek gövdesini (assertion / access token) alıntılayabilir. */
    expect(AUTH).toMatch(/catch \{[\s\S]{0,200}'OAUTH_NETWORK_ERROR'/);
    expect(DISPATCH).toMatch(/catch \{[\s\S]{0,300}networkFailureOutcome\(\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · REGRESYON — dokunulmaması gerekenler
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PROD-1A2 · komşu otoriteler bozulmadı', () => {
  it('20. 🔒 pushAuth karar sırası AYNEN duruyor (IDOR)', () => {
    expect(PUSHAUTH).toMatch(/if \(!token\) return \{ ok: false, status: 401/);
    expect(PUSHAUTH).toMatch(/token === deps\.serviceRoleKey/);
    expect(PUSHAUTH).toMatch(/vehicleExists[\s\S]{0,120}status: 404/);
    expect(PUSHAUTH).toMatch(/userCanAccessVehicle[\s\S]{0,120}status: 403/);
    /* index.ts hâlâ bu kapıdan geçiyor ve kendi kararını ÜRETMİYOR. */
    expect(INDEX).toContain('authorizePushRequest(token, vehicleId');
    expect(INDEX).toMatch(/if \(!decision\.ok\)/);
  });

  it('21. 🔒 tüketici Web Push yolu bu turda DEĞİŞMEDİ', () => {
    const consumer = codeOf(resolve(ROOT, 'supabase/functions/consumer-push-notify/index.ts'));
    expect(consumer).toContain('push_subscriptions');
    /* Tüketici tarafı FCM/OAuth'a BULAŞMADI — iki sistem ayrı kalır. */
    expect(consumer).not.toContain('fcm.googleapis.com');
    expect(consumer).not.toContain('FCM_SERVICE_ACCOUNT_JSON');
    expect(consumer).not.toContain('vehicle_push_tokens');
  });

  it('22. 🔒 PROD-1A1 cihaz token kayıt otoritesi yerinde', () => {
    const vis = codeOf(resolve(ROOT, 'src/platform/vehicleIdentityService.ts'));
    expect(vis).toContain('register_vehicle_push_token');
    expect(vis).toContain('ensureDevicePushTokenRegistered');
    expect(existsSync(resolve(ROOT,
      'supabase/migrations/20260919000082_vehicle_push_token_device_auth.sql'))).toBe(true);
  });

  it('23. 🔒 yoklama yedeği sözleşmesi DEĞİŞMEDİ (push yalnız hızlandırıcı)', () => {
    const push = codeOf(resolve(ROOT, 'src/platform/pushService.ts'));
    /* Dinleyicinin ömrü EŞLEŞMEYE bağlıdır, push'ın durumuna değil (#647). */
    expect(push).toMatch(/startCommandListener\(\s*vehicleId\s*,\s*\{\s*permanent:\s*true\s*\}\s*\)/);
    expect(push).toContain('_ensureCommandListener');
  });

  it('24. 🔒 Deno dağıtım sözleşmesi dosyaları mevcut', () => {
    for (const f of ['deno.json', 'index.ts', 'googleAuth.ts', 'fcmDelivery.ts',
                     'wakeDispatch.ts', 'pushAuth.ts']) {
      expect(existsSync(FN(f)), `${f} eksik`).toBe(true);
    }
    /* Deno testleri fonksiyonun yanında durur (deploy öncesi koşulur). */
    for (const t of ['googleAuth.test.ts', 'fcmDelivery.test.ts', 'wakeDispatch.test.ts',
                     'pushAuth.test.ts']) {
      expect(existsSync(FN(t)), `${t} eksik`).toBe(true);
    }
  });
});
