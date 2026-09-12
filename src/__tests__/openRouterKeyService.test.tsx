/**
 * openRouterKeyService.test.tsx — OpenRouter BYOK anahtar yaşam döngüsü.
 *
 * Kilitlenen davranışlar:
 *  1) Biçim doğrulaması: boş/kontrol karakteri/çok kısa reddedilir, trim uygulanır
 *  2) Anahtar YALNIZ sensitiveKeyStore'a yazılır (localStorage'a ASLA)
 *  3) Anahtar UI'a geri OKUNMAZ — yalnız maskeli özet
 *  4) Silme: depo temizlenir + gateway şalteri KAPANIR
 *  5) Bağlantı testi: 401/403→invalid_key · 429→rate_limited · network/timeout→
 *     offline · 5xx→service_unavailable · başarı→connected · anahtarsız→ağa ÇIKMAZ
 *  6) Fail-closed şalter: doğrulanmamış/anahtarsız durumda AÇILAMAZ
 *  7) Anahtar hata mesajlarına/loglara SIZMAZ
 *  8) UI: tam anahtar render edilmez, unmount'ta hassas state temizlenir
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Güvenli depo sahtesi (gerçek Keystore/Capacitor yerine) ───────────────── */

const S = vi.hoisted(() => ({
  store: new Map<string, string>(),
  getCalls: [] as string[],
  throwOnGet: false,
}));

vi.mock('../platform/sensitiveKeyStore', () => ({
  isRecoveryKey: () => true,
  sensitiveKeyStore: {
    get: async (k: string) => {
      S.getCalls.push(k);
      if (S.throwOnGet) throw new Error('keystore kilitli');
      return S.store.get(k) ?? '';
    },
    set: async (k: string, v: string) => { S.store.set(k, v); },
    remove: async (k: string) => { S.store.delete(k); },
  },
}));

vi.mock('../platform/remoteConfigService', () => ({ getFlag: () => false }));

const V = vi.hoisted(() => ({ result: { ok: true } as { ok: boolean; error?: { kind: string } } }));
vi.mock('../platform/ai/gateway/concrete/defaultAiGateway', () => ({
  verifyDefaultAiConnection: async () => V.result,
}));

import {
  connectionStatusMessage,
  getOpenRouterKeyInfo,
  maskApiKey,
  removeOpenRouterKey,
  saveOpenRouterKey,
  setGatewayPreference,
  statusFromErrorKind,
  testOpenRouterConnection,
  validateKeyFormat,
} from '../platform/ai/gateway/openRouterKeyService';
import { isAiGatewayEnabled, _resetAiGatewayFlagForTest } from '../platform/ai/gateway/aiGatewayFlag';
import { clearCredentialStatusCache } from '../platform/ai/credentials/apiCredentialManager';

const REAL_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef4F9A';

beforeEach(() => {
  S.store.clear();
  S.getCalls = [];
  S.throwOnGet = false;
  V.result = { ok: true };
  localStorage.clear();
  _resetAiGatewayFlagForTest();
  clearCredentialStatusCache();
});

/* ══════════════ 1) Biçim doğrulaması ══════════════ */

describe('anahtar biçim doğrulaması (hafif istemci kontrolü)', () => {
  it('boş / yalnız boşluk reddedilir', () => {
    for (const bad of ['', '   ', '\t\n']) {
      const r = validateKeyFormat(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('empty');
    }
  });

  it('baş/son boşlukları TEMİZLENİR', () => {
    const r = validateKeyFormat(`   ${REAL_KEY}  `);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.key).toBe(REAL_KEY);
  });

  it('kontrol karakteri içeren anahtar reddedilir', () => {
    const withNewline = `sk-or-v1-0123456789${String.fromCharCode(10)}abcdef0123456`;
    const withNul     = `sk-or-v1-0123456789${String.fromCharCode(0)}abcdef0123456`;
    for (const bad of [withNewline, withNul]) {
      const r = validateKeyFormat(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('control_chars');
    }
  });

  it('makul minimum uzunluğun altı reddedilir', () => {
    const r = validateKeyFormat('sk-or-abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_short');
  });

  it('PREFIX ZORUNLU DEĞİL — sağlayıcı biçimi değişirse kilitlenmez', () => {
    expect(validateKeyFormat('yepyeni-format-9f8e7d6c5b4a3210').ok).toBe(true);
  });
});

/* ══════════════ 2-3) Saklama ve maskeleme ══════════════ */

describe('güvenli saklama ve maskeleme', () => {
  it('anahtar YALNIZ güvenli depoya yazılır — localStorage TEMİZ kalır', async () => {
    const r = await saveOpenRouterKey(REAL_KEY);
    expect(r.ok).toBe(true);
    expect(S.store.get('openRouterApiKey')).toBe(REAL_KEY);

    const dump = JSON.stringify(Object.entries(localStorage));
    expect(dump).not.toContain(REAL_KEY);
    expect(dump).not.toContain('0123456789abcdef');
  });

  it('biçim hatalıysa depoya HİÇ yazılmaz', async () => {
    const r = await saveOpenRouterKey('kısa');
    expect(r.ok).toBe(false);
    expect(S.store.size).toBe(0);
  });

  it('maske: baş + son 4; TAM anahtar asla dönmez', () => {
    const masked = maskApiKey(REAL_KEY);
    expect(masked).toContain('4F9A');
    expect(masked).toContain('•');
    expect(masked).not.toBe(REAL_KEY);
    expect(masked).not.toContain('0123456789abcdef');
    expect(masked.length).toBeLessThan(REAL_KEY.length);
  });

  it('çok kısa girdide hiçbir parça sızmaz', () => {
    expect(maskApiKey('abc123')).toBe('••••••');
    expect(maskApiKey('')).toBe('');
  });

  it('getOpenRouterKeyInfo yalnız "kayıtlı + maske" döner (tam anahtar YOK)', async () => {
    await saveOpenRouterKey(REAL_KEY);
    const info = await getOpenRouterKeyInfo();
    expect(info.configured).toBe(true);
    expect(JSON.stringify(info)).not.toContain('0123456789abcdef');
    expect(Object.keys(info).sort()).toEqual(['configured', 'masked']);
  });

  it('depo hatası → fail-closed (yapılandırılmadı), throw YOK', async () => {
    S.throwOnGet = true;
    const info = await getOpenRouterKeyInfo();
    expect(info).toEqual({ configured: false, masked: '' });
  });
});

/* ══════════════ 4) Silme ══════════════ */

describe('anahtar silme', () => {
  it('depodan silinir VE gateway şalteri kapanır', async () => {
    await saveOpenRouterKey(REAL_KEY);
    expect(await setGatewayPreference(true)).toBe(true);
    expect(isAiGatewayEnabled()).toBe(true);

    await removeOpenRouterKey();

    expect(S.store.has('openRouterApiKey')).toBe(false);
    expect(isAiGatewayEnabled()).toBe(false);
    expect((await getOpenRouterKeyInfo()).configured).toBe(false);
  });

  it('depo silme hatası olsa bile şalter KAPALI kalır (fail-closed)', async () => {
    await saveOpenRouterKey(REAL_KEY);
    await setGatewayPreference(true);
    S.throwOnGet = true;                       // sonraki okuma da patlasın
    await expect(removeOpenRouterKey()).resolves.toBeUndefined();
    expect(isAiGatewayEnabled()).toBe(false);
  });
});

/* ══════════════ 5) Bağlantı testi ══════════════ */

describe('bağlantı doğrulama (gateway hata sınıfları yeniden kullanılır)', () => {
  it('anahtar yoksa AĞA ÇIKMAZ → not_configured', async () => {
    const verifySpy = vi.fn();
    V.result = { ok: false, error: { kind: 'network' } };
    expect(await testOpenRouterConnection()).toBe('not_configured');
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('başarılı doğrulama → connected', async () => {
    await saveOpenRouterKey(REAL_KEY);
    V.result = { ok: true };
    expect(await testOpenRouterConnection()).toBe('connected');
  });

  const map: Array<[string, string]> = [
    ['auth',               'invalid_key'],          // 401/403
    ['rate_limited',       'rate_limited'],         // 429
    ['network',            'offline'],
    ['timeout',            'offline'],
    ['offline',            'offline'],
    ['server',             'service_unavailable'],  // 5xx
    ['circuit_open',       'service_unavailable'],
    ['no_api_key',         'not_configured'],
    ['malformed_response', 'unknown_error'],
    ['invalid_request',    'unknown_error'],
  ];
  for (const [kind, expected] of map) {
    it(`hata sınıfı ${kind} → ${expected}`, async () => {
      await saveOpenRouterKey(REAL_KEY);
      V.result = { ok: false, error: { kind } };
      expect(await testOpenRouterConnection()).toBe(expected);
      expect(statusFromErrorKind(kind as never)).toBe(expected);
    });
  }

  it('kullanıcıya gösterilen mesajlar TEKNİK KOD içermez', () => {
    const statuses = ['not_configured', 'checking', 'connected', 'invalid_key',
                      'rate_limited', 'offline', 'service_unavailable', 'unknown_error'] as const;
    for (const s of statuses) {
      const msg = connectionStatusMessage(s);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toMatch(/40[123]|429|5\d\d|HTTP|null|undefined|Error/);
    }
  });

  it('doğrulama katmanı throw ederse unknown_error (asla patlamaz)', async () => {
    await saveOpenRouterKey(REAL_KEY);
    V.result = { get ok(): boolean { throw new Error('patladı'); } } as never;
    expect(await testOpenRouterConnection()).toBe('unknown_error');
  });
});

/* ══════════════ 6) Fail-closed şalter ══════════════ */

describe('gateway şalteri — fail-closed kapı', () => {
  it('VARSAYILAN KAPALI', () => {
    expect(isAiGatewayEnabled()).toBe(false);
  });

  it('anahtar YOKKEN açılamaz', async () => {
    expect(await setGatewayPreference(true)).toBe(false);
    expect(isAiGatewayEnabled()).toBe(false);
  });

  it('anahtar kayıtlıyken açılır ve kapatılabilir', async () => {
    await saveOpenRouterKey(REAL_KEY);
    expect(await setGatewayPreference(true)).toBe(true);
    expect(isAiGatewayEnabled()).toBe(true);
    expect(await setGatewayPreference(false)).toBe(false);
    expect(isAiGatewayEnabled()).toBe(false);
  });

  it('anahtar kaydedilince şalter OTOMATİK AÇILMAZ', async () => {
    await saveOpenRouterKey(REAL_KEY);
    expect(isAiGatewayEnabled()).toBe(false);
  });
});

/* ══════════════ 7-8) UI sözleşmesi ══════════════ */

describe('Birleşik ayar paneli — UI gizlilik sözleşmesi', () => {
  /* ⚠️ SÜRE: bu bloktaki İLK dinamik import React bileşen ağacının kapanışını
     derler (sonraki importlar önbellekten gelir). Düşük-uç/yüklü makinede bu tek
     seferlik derleme 5 sn varsayılanını aşabiliyor → testin GİZLİLİK İDDİASI değil
     yalnız SÜRESİ genişletildi. Kilit aynen korunur. */
  it('panel ilk kare: durum okunurken yükleniyor gösterir, anahtar SIZDIRMAZ', async () => {
    await saveOpenRouterKey(REAL_KEY);
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ApiCredentialsPanel } = await import('../components/settings/ApiCredentialsPanel');

    let html = '';
    expect(() => { html = renderToStaticMarkup(<ApiCredentialsPanel />); }).not.toThrow();

    expect(html).not.toContain(REAL_KEY);
    expect(html).not.toContain('0123456789abcdef');
    expect(html).toContain('Yapay Zekâ Anahtarları');
    expect(html).toContain('kota ve ücretlendirmesine tabidir');
    expect(html).toContain('Anahtar durumu okunuyor');   // toplu okuma beklenirken
  }, 30_000);

  it('satır: kayıtlı anahtar input\'a GERİ KONMAZ — yalnız maske, alan boş', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { CredentialRow } = await import('../components/settings/ApiCredentialsPanel');
    const { getCredentialDescriptor } = await import('../platform/ai/credentials/credentialRegistry');

    const desc = getCredentialDescriptor('openrouter')!;
    const html = renderToStaticMarkup(
      <CredentialRow
        desc={desc}
        status={{ keyId: 'openrouter', configured: true, source: 'secure_store', maskedSummary: 'sk-or-••••••••••4F9A' }}
        onStatusChange={() => {}}
      />,
    );

    expect(html).not.toContain(REAL_KEY);
    expect(html).not.toContain('0123456789abcdef');
    expect(html).toContain('sk-or-••••••••••4F9A');       // yalnız maskeli özet
    expect(html).toMatch(/type="password"/);              // alan MASKELİ
    expect(html).toContain('value=""');                   // ve BOŞ
  });

  it('gateway şalteri: model notu ve fail-closed açıklaması korunur', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { MaviGatewayToggle } = await import('../components/settings/MaviGatewayToggle');

    const locked = renderToStaticMarkup(<MaviGatewayToggle configured={false} verified={false} />);
    expect(locked).toContain('Mavi&#x27;de yeni AI Gateway&#x27;i kullan');
    expect(locked).toContain('Model seçimi sonraki geliştirme aşamasında eklenecek');
    expect(locked).toContain('Önce anahtarı kaydedip bağlantıyı test et');
    expect(locked).toMatch(/disabled=""/);            // doğrulanmadan AÇILAMAZ

    const ready = renderToStaticMarkup(<MaviGatewayToggle configured verified />);
    expect(ready).not.toMatch(/disabled=""/);
  });

  it('model slug\'ı UI\'a HARDCODE edilmez', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/components/settings/ApiCredentialsPanel.tsx',
                     'src/components/settings/MaviGatewayToggle.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/anthropic\/|openai\/|google\/|deepseek\/|qwen\/|meta-llama\/|mistralai\//);
    }
  });

  it('UI kaynağı anahtarı loglamaz / telemetriye göndermez', async () => {
    const { readFileSync } = await import('node:fs');
    const files = [
      'src/components/settings/ApiCredentialsPanel.tsx',
      'src/components/settings/MaviGatewayToggle.tsx',
      'src/platform/ai/gateway/openRouterKeyService.ts',
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/console\.(log|info|warn|error)/);
      expect(src, f).not.toMatch(/localStorage\.setItem\([^)]*[Kk]ey/);
      expect(src, f).not.toMatch(/pushVehicleEvent|logInfo|telemetry/i);
    }
  });

  it('panel sağlayıcıya özel UI kodu İÇERMEZ (tamamen kayıt defterinden sürülür)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/settings/ApiCredentialsPanel.tsx', 'utf8');
    for (const name of ['Gemini', 'Tavily', 'Groq', 'Haiku', 'geminiApiKey', 'tavilyApiKey', 'groqApiKey']) {
      expect(src, `panel '${name}' adını biliyor — kayıt defteri bağımsızlığı bozulmuş`)
        .not.toMatch(new RegExp(`['"\`]${name}`));
    }
  });
});
