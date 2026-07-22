/**
 * apiCredentialManager.test.ts — sağlayıcı-bağımsız API kimlik bilgisi yönetimi.
 *
 * Kilitlenen davranışlar:
 *  1) 4 sağlayıcının TAMAMI kayıt defterinde ve KURTARMA kapsamında
 *  2) Her anahtar ayrı ayrı: kaydedilir · maskeli okunur · doğrulanır · silinir
 *  3) Silinen anahtar GERİ GELMEZ (yedek katmanları senkronlanır)
 *  4) Doğrulama: anahtar YALNIZ header'da · streaming yok · gövde okunmaz ·
 *     timeout · fail-closed · anahtarsızken ağa çıkılmaz
 *  5) Anahtar loglara/telemetriye/URL query'ye/plain text'e YAZILMAZ
 *  6) Yeni sağlayıcı eklemek = kayıt defterine tek satır (yapısal kilit)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/* ── Güvenli depo sahtesi ──────────────────────────────────────────────────── */

const S = vi.hoisted(() => ({
  store:   new Map<string, string>(),
  removed: [] as string[],
  throwOnGet: false,
}));

vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: {
    get: async (k: string) => {
      if (S.throwOnGet) throw new Error('keystore kilitli');
      return S.store.get(k) ?? '';
    },
    set:    async (k: string, v: string) => { S.store.set(k, v); },
    remove: async (k: string) => { S.removed.push(k); S.store.delete(k); },
  },
}));

const G = vi.hoisted(() => ({ result: { ok: true } as { ok: boolean; error?: { kind: string } } }));
vi.mock('../platform/ai/gateway/concrete/defaultAiGateway', () => ({
  verifyDefaultAiConnection: async () => G.result,
}));

import {
  credentialStatusMessage,
  getAllCredentialInfo,
  getCredentialInfo,
  maskApiKey,
  removeCredential,
  saveCredential,
  validateKeyFormat,
  verifyCredential,
} from '../platform/ai/credentials/apiCredentialManager';
import { API_CREDENTIALS, getCredentialDescriptor, listCredentialIds } from '../platform/ai/credentials/credentialRegistry';
import { statusFromHttp, verifyGeminiKey, verifyGroqKey, verifyTavilyKey } from '../platform/ai/credentials/credentialVerifiers';
import type { ApiCredentialId } from '../platform/ai/credentials/credentialTypes';

const KEY = 'abcdefghijklmnop0123456789XYZ7F3A';
const ALL: ApiCredentialId[] = ['openrouter', 'gemini', 'groq', 'haiku', 'tavily'];

beforeEach(() => {
  S.store.clear();
  S.removed = [];
  S.throwOnGet = false;
  G.result = { ok: true };
});

/* ══════════════ 1) Kayıt defteri + kurtarma kapsamı ══════════════ */

describe('kayıt defteri — sağlayıcılar ve kurtarma kapsamı', () => {
  it('istenen sağlayıcıların TAMAMI kayıtlı (Haiku dahil — birleşik panelde kaybolmadı)', () => {
    expect([...listCredentialIds()].sort()).toEqual([...ALL].sort());
  });

  it('her tanımın zorunlu alanları eksiksiz', () => {
    for (const c of API_CREDENTIALS) {
      expect(c.storeKey.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.docsUrl).toMatch(/^https:\/\//);
      expect(c.minLength).toBeGreaterThanOrEqual(8);
      expect(typeof c.verify).toBe('function');
      expect(typeof c.verifyCostsQuota).toBe('boolean');
    }
  });

  it('KİLİT: her kayıtlı anahtar RECOVERY_KEYS içinde — reinstall kurtarması kapsar', () => {
    const src = readFileSync('src/platform/sensitiveKeyStore.ts', 'utf8');
    const line = src.match(/const RECOVERY_KEYS: SensitiveKey\[\] = \[([^\]]*)\]/);
    expect(line, 'RECOVERY_KEYS bulunamadı').toBeTruthy();
    const recovered = line![1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    for (const c of API_CREDENTIALS) {
      expect(recovered, `${c.id} kurtarma kapsamı DIŞINDA — reinstall'da kaybolur`).toContain(c.storeKey);
    }
  });

  it('KİLİT: silme yolunda cihaz blob senkronu BEKLENİR (silinen anahtar dirilmesin)', () => {
    const src = readFileSync('src/platform/sensitiveKeyStore.ts', 'utf8');
    const remove = src.match(/async remove\(key: SensitiveKey\)[\s\S]*?\n  \},/);
    expect(remove, 'remove() bulunamadı').toBeTruthy();
    expect(remove![0], 'remove() blob senkronunu beklemiyor → silinen anahtar geri gelebilir')
      .toMatch(/await _deviceBackupSync\(\)/);
    expect(remove![0], 'remove() recovery store\'u boşaltmıyor').toMatch(/_recoverySet\(key, ''\)/);
  });

  it('bilinmeyen sağlayıcı → undefined (uydurma YOK)', () => {
    expect(getCredentialDescriptor('yok' as ApiCredentialId)).toBeUndefined();
  });
});

/* ══════════════ 2) Yaşam döngüsü — her sağlayıcı için ══════════════ */

describe('yaşam döngüsü — her sağlayıcı ayrı ayrı', () => {
  for (const id of ALL) {
    it(`${id}: kaydedilir · maskeli okunur · silinir`, async () => {
      const desc = getCredentialDescriptor(id)!;

      expect((await getCredentialInfo(id)).configured).toBe(false);

      const saved = await saveCredential(id, `  ${KEY}  `);       // trim uygulanır
      expect(saved.ok).toBe(true);
      expect(S.store.get(desc.storeKey)).toBe(KEY);

      const info = await getCredentialInfo(id);
      expect(info.configured).toBe(true);
      expect(info.masked).toContain('7F3A');
      expect(info.masked).not.toBe(KEY);
      expect(JSON.stringify(info)).not.toContain('abcdefghijklmnop');

      await removeCredential(id);
      expect(S.removed).toContain(desc.storeKey);
      expect((await getCredentialInfo(id)).configured).toBe(false);
    });
  }

  it('bir anahtarın silinmesi DİĞERLERİNİ etkilemez', async () => {
    for (const id of ALL) await saveCredential(id, KEY);
    await removeCredential('gemini');
    expect((await getCredentialInfo('gemini')).configured).toBe(false);
    for (const id of ALL.filter((x) => x !== 'gemini')) {
      expect((await getCredentialInfo(id)).configured).toBe(true);
    }
  });

  it('getAllCredentialInfo tüm sağlayıcıları döner, tam anahtar İÇERMEZ', async () => {
    await saveCredential('groq', KEY);
    const all = await getAllCredentialInfo();
    expect(all).toHaveLength(ALL.length);
    expect(JSON.stringify(all)).not.toContain(KEY);
    expect(all.find((i) => i.id === 'groq')?.configured).toBe(true);
  });

  it('biçim hatasında depoya YAZILMAZ', async () => {
    expect((await saveCredential('gemini', '')).ok).toBe(false);
    expect((await saveCredential('gemini', 'kısa')).ok).toBe(false);
    expect((await saveCredential('gemini', `abc${String.fromCharCode(10)}def0123456789012`)).ok).toBe(false);
    expect(S.store.size).toBe(0);
  });

  it('depo hatası → fail-closed (yapılandırılmadı)', async () => {
    S.throwOnGet = true;
    expect((await getCredentialInfo('tavily')).configured).toBe(false);
  });

  it('maske: kısa anahtarda hiçbir parça sızmaz', () => {
    expect(maskApiKey('abc123')).toBe('••••••');
    expect(maskApiKey('')).toBe('');
    expect(validateKeyFormat('yepyeni-format-9f8e7d6c5b4a').ok).toBe(true); // prefix zorunlu DEĞİL
  });
});

/* ══════════════ 3) Doğrulama ══════════════ */

describe('doğrulama — en düşük maliyet, header-only, fail-closed', () => {
  it('anahtar YOKSA ağa ÇIKILMAZ → not_configured', async () => {
    const fetchImpl = vi.fn();
    for (const id of ALL) {
      expect(await verifyCredential(id, { fetchImpl: fetchImpl as never })).toBe('not_configured');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Gemini: GET /v1beta/models · anahtar HEADER\'da · URL query\'de YOK · gövde YOK', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200 }) as Response);
    const status = await verifyGeminiKey(KEY, { fetchImpl: fetchImpl as never });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(url).not.toContain(KEY);
    expect(url).not.toContain('key=');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(status).toBe('connected');
  });

  it('Groq: GET /openai/v1/models · Bearer header · gövde YOK', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200 }) as Response);
    await verifyGroqKey(KEY, { fetchImpl: fetchImpl as never });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect(url).not.toContain(KEY);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${KEY}`);
  });

  it('Tavily: EN KÜÇÜK arama (max_results:1, basic) · Bearer header · anahtar gövdede YOK', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200 }) as Response);
    await verifyTavilyKey(KEY, { fetchImpl: fetchImpl as never });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect(url).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);           // eski gövde-içi api_key biçimi YOK
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['max_results']).toBe(1);
    expect(body['search_depth']).toBe('basic');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${KEY}`);
  });

  it('Tavily kota maliyeti tanımda İŞARETLİ (UI kullanıcıyı uyarabilsin)', () => {
    expect(getCredentialDescriptor('tavily')!.verifyCostsQuota).toBe(true);
    for (const id of ['openrouter', 'gemini', 'groq'] as ApiCredentialId[]) {
      expect(getCredentialDescriptor(id)!.verifyCostsQuota).toBe(false);
    }
  });

  it('HTTP durum eşlemesi tüm sağlayıcılarda ORTAK', () => {
    expect(statusFromHttp(200)).toBe('connected');
    expect(statusFromHttp(204)).toBe('connected');
    expect(statusFromHttp(401)).toBe('invalid_key');
    expect(statusFromHttp(403)).toBe('invalid_key');
    expect(statusFromHttp(402)).toBe('rate_limited');
    expect(statusFromHttp(429)).toBe('rate_limited');
    expect(statusFromHttp(500)).toBe('service_unavailable');
    expect(statusFromHttp(503)).toBe('service_unavailable');
    expect(statusFromHttp(418)).toBe('unknown_error');
  });

  it('ağ hatası/timeout → offline; doğrulayıcı ASLA throw etmez', async () => {
    const boom = vi.fn(async () => { throw new Error('kopma'); });
    for (const verify of [verifyGeminiKey, verifyGroqKey, verifyTavilyKey]) {
      await expect(verify(KEY, { fetchImpl: boom as never })).resolves.toBe('offline');
    }
  });

  it('kayıtlı anahtarla doğrulama sağlayıcı tanımına yönlenir', async () => {
    await saveCredential('groq', KEY);
    const fetchImpl = vi.fn(async () => ({ status: 401 }) as Response);
    expect(await verifyCredential('groq', { fetchImpl: fetchImpl as never })).toBe('invalid_key');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('OpenRouter doğrulaması gateway yoluna devreder (kod tekrarı yok)', async () => {
    await saveCredential('openrouter', KEY);
    G.result = { ok: true };
    expect(await verifyCredential('openrouter')).toBe('connected');
    G.result = { ok: false, error: { kind: 'auth' } };
    expect(await verifyCredential('openrouter')).toBe('invalid_key');
    G.result = { ok: false, error: { kind: 'rate_limited' } };
    expect(await verifyCredential('openrouter')).toBe('rate_limited');
    G.result = { ok: false, error: { kind: 'timeout' } };
    expect(await verifyCredential('openrouter')).toBe('offline');
  });

  it('doğrulayıcı throw etse bile unknown_error (fail-closed)', async () => {
    await saveCredential('gemini', KEY);
    const desc = getCredentialDescriptor('gemini')!;
    const spy = vi.spyOn(desc, 'verify').mockRejectedValue(new Error('patladı'));
    expect(await verifyCredential('gemini')).toBe('unknown_error');
    spy.mockRestore();
  });

  it('kullanıcı mesajları TEKNİK KOD içermez', () => {
    for (const s of ['not_configured', 'checking', 'connected', 'invalid_key',
                     'rate_limited', 'offline', 'service_unavailable', 'unknown_error'] as const) {
      expect(credentialStatusMessage(s)).not.toMatch(/40[123]|429|5\d\d|HTTP|undefined|Error/);
    }
  });
});

/* ══════════════ 4) Güvenlik yapısal kilitleri ══════════════ */

describe('güvenlik — kaynak seviyesi kilitler', () => {
  const files = [
    'src/platform/ai/credentials/apiCredentialManager.ts',
    'src/platform/ai/credentials/credentialVerifiers.ts',
    'src/platform/ai/credentials/credentialRegistry.ts',
    'src/platform/ai/gateway/openRouterKeyService.ts',
  ];

  it('hiçbir kimlik modülü loglamıyor / telemetriye göndermiyor', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} console.* kullanıyor`).not.toMatch(/console\.(log|info|warn|error|debug)/);
      expect(src, `${f} telemetri çağırıyor`).not.toMatch(/pushVehicleEvent|logInfo|logError|telemetry/i);
    }
  });

  it('hiçbir kimlik modülü anahtarı localStorage/plain depoya yazmıyor', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} localStorage'a yazıyor`).not.toMatch(/localStorage\.setItem/);
      expect(src, `${f} sessionStorage'a yazıyor`).not.toMatch(/sessionStorage\.setItem/);
    }
  });

  it('doğrulayıcılar anahtarı URL\'ye interpolate ETMİYOR (yapısal)', () => {
    const src = readFileSync('src/platform/ai/credentials/credentialVerifiers.ts', 'utf8');
    // url alanları SABİT string olmalı — şablon interpolasyonu yalnız header'da.
    const urls = [...src.matchAll(/url:\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2]);
    expect(urls.length).toBeGreaterThanOrEqual(3);
    for (const u of urls) {
      expect(u, 'URL şablon değişkeni içeriyor — anahtar query\'ye sızabilir').not.toContain('${');
      expect(u).not.toContain('key=');
    }
  });

  it('yeni sağlayıcı eklemek = kayıt defterine tek tanım (yönetici sağlayıcı adı bilmez)', () => {
    const mgr = readFileSync('src/platform/ai/credentials/apiCredentialManager.ts', 'utf8');
    for (const name of ['openrouter', 'gemini', 'groq', 'tavily', 'OpenRouter', 'Gemini', 'Tavily']) {
      expect(mgr, `yönetici '${name}' adını biliyor — sağlayıcı-bağımsızlık bozulmuş`)
        .not.toMatch(new RegExp(`['"\`]${name}['"\`]`));
    }
  });
});
