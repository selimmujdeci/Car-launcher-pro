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

/**
 * Güvenli depo sahtesi + ÇAĞRI SAYACI.
 * `reads` her `get()` çağrısını kaydeder → panel/manager'ın gerçekte kaç
 * güvenli-depo okuması yaptığı ölçülebilir. `gate` eşzamanlılık ölçümü içindir.
 */
const S = vi.hoisted(() => {
  const state = {
    store:       new Map<string, string>(),
    removed:     [] as string[],
    reads:       [] as string[],
    throwOnGet:  false,
    throwOnKey:  null as string | null,
    gate:        false,
    inFlight:    0,
    maxInFlight: 0,
    waiters:     [] as Array<() => void>,
    release(): void { for (const w of state.waiters.splice(0)) w(); state.gate = false; },
  };
  return state;
});

vi.mock('../platform/sensitiveKeyStore', () => ({
  isRecoveryKey: () => true,
  sensitiveKeyStore: {
    get: async (k: string) => {
      S.reads.push(k);
      S.inFlight++;
      S.maxInFlight = Math.max(S.maxInFlight, S.inFlight);
      try {
        if (S.gate) await new Promise<void>((resolve) => { S.waiters.push(resolve); });
        if (S.throwOnGet || S.throwOnKey === k) throw new Error('keystore kilitli');
        return S.store.get(k) ?? '';
      } finally {
        S.inFlight--;
      }
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
  clearCredentialStatusCache,
  credentialStatusMessage,
  getAllCredentialInfo,
  getCredentialInfo,
  getCredentialStatus,
  listCredentialStatuses,
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
  clearCredentialStatusCache();
  S.reads = [];
  S.throwOnKey = null;
  S.gate = false;
  S.inFlight = 0;
  S.maxInFlight = 0;
  S.waiters.length = 0;
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

/* ══════════════ 4) Toplu durum okuma (Keystore optimizasyonu) ══════════════ */

describe('listCredentialStatuses — tek toplu okuma', () => {
  it('TÜM registry kayıtları sonuçta yer alır ve her kayıt için TEK okuma yapılır', async () => {
    S.reads = [];
    const map = await listCredentialStatuses();

    expect(Object.keys(map).sort()).toEqual([...ALL].sort());
    // Sağlayıcı başına TAM 1 güvenli-depo okuması (satır başına ayrı okuma YOK)
    expect(S.reads).toHaveLength(API_CREDENTIALS.length);
    expect(new Set(S.reads).size).toBe(API_CREDENTIALS.length);
  });

  it('önbellek: ikinci çağrı HİÇ okuma yapmaz', async () => {
    await listCredentialStatuses();
    S.reads = [];
    await listCredentialStatuses();
    expect(S.reads).toHaveLength(0);
  });

  it('force: önbelleği atlar ve yeniden okur', async () => {
    await listCredentialStatuses();
    S.reads = [];
    await listCredentialStatuses({ force: true });
    expect(S.reads).toHaveLength(API_CREDENTIALS.length);
  });

  it('TEK sağlayıcının okuma hatası diğerlerini BOZMAZ (fail-closed kayıt)', async () => {
    await saveCredential('gemini', KEY);
    clearCredentialStatusCache();
    S.throwOnKey = 'groqApiKey';

    const map = await listCredentialStatuses();

    expect(Object.keys(map)).toHaveLength(API_CREDENTIALS.length);   // liste KIRILMADI
    expect(map['groq']?.configured).toBe(false);
    expect(map['groq']?.readError).toBe(true);
    expect(map['groq']?.source).toBe('none');
    expect(map['gemini']?.configured).toBe(true);                    // diğerleri sağlam
  });

  it('sonuç GERÇEK ANAHTAR İÇERMEZ ve hassas alan adı taşımaz', async () => {
    for (const id of ALL) await saveCredential(id, KEY);
    clearCredentialStatusCache();
    const map = await listCredentialStatuses();

    const dump = JSON.stringify(map);
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain('abcdefghijklmnop');
    for (const forbidden of ['rawKey', '"value"', 'secret', '"apiKey"', 'plaintext']) {
      expect(dump, `toplu sonuçta '${forbidden}' alanı var`).not.toContain(forbidden);
    }
    // Yalnız güvenli alanlar
    for (const s of Object.values(map)) {
      expect(Object.keys(s).sort()).toEqual(
        ['configured', 'keyId', 'maskedSummary', 'recoveryAvailable', 'source'].sort(),
      );
      expect(s.maskedSummary).toContain('•');
      expect(s.maskedSummary).not.toBe(KEY);
    }
  });

  it('kaynak ayrımı: depo → secure_store, yalnız env → environment, hiçbiri → none', async () => {
    await saveCredential('gemini', KEY);
    clearCredentialStatusCache();
    const map = await listCredentialStatuses();
    expect(map['gemini']?.source).toBe('secure_store');
    expect(map['groq']?.source).toBe('none');        // env stub'ı boş
    expect(map['groq']?.configured).toBe(false);
  });

  it('recoveryAvailable statik metadata olarak taşınır', async () => {
    const map = await listCredentialStatuses({ force: true });
    for (const id of ALL) expect(map[id]?.recoveryAvailable).toBe(true);
  });

  it('kaydetme ilgili kaydı GÜNCELLER, diğerlerini KORUR ve okuma YAPMAZ', async () => {
    await listCredentialStatuses();          // önbellek dolsun
    S.reads = [];

    const saved = await saveCredential('tavily', KEY);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(S.reads).toHaveLength(0);                       // ek native okuma YOK
    expect(saved.status.configured).toBe(true);
    expect(saved.status.source).toBe('secure_store');
    expect(saved.status.maskedSummary).toContain('7F3A');

    const map = await listCredentialStatuses();            // önbellekten
    expect(map['tavily']?.configured).toBe(true);
    expect(map['gemini']?.configured).toBe(false);         // diğerleri korunur
    expect(S.reads).toHaveLength(0);
  });

  it('silme ilgili kaydı TEMİZLER (maskedSummary düşer) ve okuma YAPMAZ', async () => {
    await saveCredential('haiku', KEY);
    await listCredentialStatuses();
    S.reads = [];

    const next = await removeCredential('haiku');

    expect(S.reads).toHaveLength(0);
    expect(next.configured).toBe(false);
    expect(next.source).toBe('none');
    expect(next.maskedSummary).toBeUndefined();
    expect(Object.keys(next)).not.toContain('maskedSummary');

    const map = await listCredentialStatuses();
    expect(map['haiku']?.configured).toBe(false);
  });

  it('getCredentialStatus tekil çağrıda önbelleği kullanır', async () => {
    await listCredentialStatuses();
    S.reads = [];
    const s = await getCredentialStatus('gemini');
    expect(s.keyId).toBe('gemini');
    expect(S.reads).toHaveLength(0);
    await getCredentialStatus('gemini', { force: true });
    expect(S.reads).toHaveLength(1);
  });

  it('eşzamanlılık SINIRLI (sınırsız Promise.all değil)', async () => {
    clearCredentialStatusCache();
    S.gate = true;
    const promise = listCredentialStatuses();
    await Promise.resolve();                                // mikro-görevler aksın
    await Promise.resolve();
    expect(S.maxInFlight).toBeLessThanOrEqual(3);
    S.release();
    await promise;
    expect(S.maxInFlight).toBeLessThanOrEqual(3);
    expect(S.maxInFlight).toBeGreaterThan(0);
  });

  it('registry\'ye yeni kayıt eklenirse toplu sonuçta OTOMATİK yer alır', async () => {
    // Yapısal: harita registry uzunluğuyla birebir — panel de bu haritayı map'ler.
    const map = await listCredentialStatuses({ force: true });
    expect(Object.keys(map)).toHaveLength(API_CREDENTIALS.length);
    for (const c of API_CREDENTIALS) expect(map[c.id]).toBeDefined();
  });
});

/* ══════════════ 5) Güvenlik yapısal kilitleri ══════════════ */

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
