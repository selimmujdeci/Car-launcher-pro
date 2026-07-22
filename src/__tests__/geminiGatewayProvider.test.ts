/**
 * geminiGatewayProvider.test.ts — Gemini'nin AI Gateway sağlayıcısı (Faz 3).
 *
 * Kilitlenen davranışlar:
 *  1) Anahtar YOKSA ağa çıkılmaz; anahtar YALNIZ `x-goog-api-key` header'ında
 *     (URL query'ye ASLA yazılmaz) ve hiçbir çıktıya sızmaz
 *  2) İstek dönüşümü: system_instruction · assistant→model rolü · model override
 *  3) Hata taksonomisi ortak gateway sınıflarına eşlenir (+429 retryAfter)
 *  4) Kayıt defteri iki gerçek sağlayıcı üretir, kimlikler çakışmaz
 *  5) GERÇEK çoklu-sağlayıcı fallback: A/B/C/D senaryoları
 *  6) Capability adapter konservatif kalır; streaming DÜRÜST bildirilir
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGeminiProvider, GEMINI_PROVIDER_ID } from '../platform/ai/gateway/providers/geminiProvider';
import { DEFAULT_GEMINI_MODEL } from '../platform/ai/gateway/models';
import { createAiGateway } from '../platform/ai/gateway/aiGateway';
import { executeOrchestratedRequest } from '../platform/ai/orchestrator/orchestratedExecutor';
import { adaptProviderCapabilities } from '../platform/ai/orchestrator/capabilityAdapter';
import type { AiProvider, AiProviderRequest } from '../platform/ai/gateway/types';
import type { AiProviderCapability, OrchestratorContext } from '../platform/ai/orchestrator/orchestratorTypes';

const KEY = 'AIzaTEST-gizli-anahtar-0123456789';
const keySource = (k: string) => ({ getApiKey: async () => k });

const REQ: AiProviderRequest = {
  messages:  [{ role: 'user', content: 'merhaba' }],
  model:     DEFAULT_GEMINI_MODEL,
  timeoutMs: 5_000,
  stream:    false,
};

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
function textRes(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}
const geminiOk = (text: string) => jsonRes({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
});

/* ══════════════ 1) Kimlik doğrulama güvenliği ══════════════ */

describe('Gemini provider — anahtar güvenliği', () => {
  it('anahtar YOKSA ağa ÇIKILMAZ → no_api_key', async () => {
    const fetchImpl = vi.fn();
    const p = createGeminiProvider({ keySource: keySource(''), fetchImpl: fetchImpl as never });
    const r = await p.generate(REQ);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('no_api_key');
  });

  it('anahtar YALNIZ x-goog-api-key HEADER\'ında; URL query\'de YOK', async () => {
    const fetchImpl = vi.fn(async () => geminiOk('cevap'));
    const p = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: fetchImpl as never });
    await p.generate(REQ);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(url).not.toContain(KEY);
    expect(url).not.toContain('key=');           // `?key=` deseni TEKRARLANMADI
    expect(url).not.toContain('?');
    expect(String(init.body)).not.toContain(KEY);
  });

  it('anahtar hata mesajına/sonuca SIZMAZ; sağlayıcı yankısı REDAKTE edilir', async () => {
    const p = createGeminiProvider({
      keySource: keySource(KEY),
      fetchImpl: (async () => textRes(`invalid key ${KEY} rejected`, 400)) as never,
    });
    const r = await p.generate(REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(JSON.stringify(r.error)).not.toContain(KEY);
      expect(r.error.message).toContain('***');
    }
  });

  it('anahtar deposu throw ederse fail-closed (ağ YOK)', async () => {
    const fetchImpl = vi.fn();
    const p = createGeminiProvider({
      keySource: { getApiKey: async () => { throw new Error('keystore kilitli'); } },
      fetchImpl: fetchImpl as never,
    });
    const r = await p.generate(REQ);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it('kaynak dosyada `?key=` deseni YOK (yapısal kilit)', () => {
    const src = readFileSync('src/platform/ai/gateway/providers/geminiProvider.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/[?&]key=/);
    expect(src).not.toMatch(/console\./);
  });
});

/* ══════════════ 2) İstek/yanıt dönüşümü ══════════════ */

describe('Gemini provider — istek dönüşümü ve normalize yanıt', () => {
  it('system mesajı system_instruction\'a, assistant rolü `model`e çevrilir', async () => {
    const fetchImpl = vi.fn(async () => geminiOk('ok'));
    const p = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: fetchImpl as never });
    await p.generate({
      ...REQ,
      messages: [
        { role: 'system',    content: 'SEN MAVİSİN' },
        { role: 'user',      content: 'ilk soru' },
        { role: 'assistant', content: 'ilk cevap' },
        { role: 'user',      content: 'ikinci soru' },
      ],
    });

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect((body['system_instruction'] as { parts: { text: string }[] }).parts[0]!.text).toBe('SEN MAVİSİN');
    expect(body['contents']).toEqual([
      { role: 'user',  parts: [{ text: 'ilk soru' }] },
      { role: 'model', parts: [{ text: 'ilk cevap' }] },   // assistant → model
      { role: 'user',  parts: [{ text: 'ikinci soru' }] },
    ]);
  });

  it('model override doğru Gemini modeline gider', async () => {
    const fetchImpl = vi.fn(async () => geminiOk('ok'));
    const p = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: fetchImpl as never });
    await p.generate({ ...REQ, model: 'gemini-özel-model' });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain('gemini-%C3%B6zel-model:generateContent');
  });

  it('başarılı yanıt ortak tipe normalize edilir (usage + finishReason)', async () => {
    const p = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: (async () => geminiOk('Motor normal.')) as never });
    const r = await p.generate(REQ);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe('Motor normal.');
      expect(r.provider).toBe(GEMINI_PROVIDER_ID);
      expect(r.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(r.streamed).toBe(false);                       // DÜRÜST beyan
      expect(r.finishReason).toBe('STOP');
      expect(r.usage).toEqual({ promptTokens: 5, completionTokens: 3, totalTokens: 8 });
    }
  });

  it('boş/bozuk yanıt → invalid_response (uydurma metin YOK)', async () => {
    for (const body of [{}, { candidates: [] }, { candidates: [{ content: { parts: [] } }] },
                        { candidates: [{ finishReason: 'MAX_TOKENS' }] }]) {
      const p = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: (async () => jsonRes(body)) as never });
      const r = await p.generate(REQ);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('malformed_response');
    }
  });

  it('streaming istense bile onToken ÇAĞRILMAZ (sahte akış yok)', async () => {
    const seen: string[] = [];
    const p = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: (async () => geminiOk('tam cevap')) as never });
    const r = await p.generate({ ...REQ, stream: true }, { onToken: (t) => seen.push(t) });
    expect(seen).toHaveLength(0);                           // token akmadı → fallback güvenli
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.streamed).toBe(false);
  });
});

/* ══════════════ 3) Hata taksonomisi ══════════════ */

describe('Gemini provider — hata sınıflandırma', () => {
  const cases: Array<[number, string, boolean]> = [
    [400, 'invalid_request', false],
    [401, 'auth',            false],
    [403, 'auth',            false],
    [408, 'timeout',         true],
    [429, 'rate_limited',    true],
    [500, 'server',          true],
    [503, 'server',          true],
  ];
  for (const [status, kind, retryable] of cases) {
    it(`HTTP ${status} → ${kind}`, async () => {
      const p = createGeminiProvider({
        keySource: keySource(KEY),
        fetchImpl: (async () => textRes('{"error":{"message":"x"}}', status)) as never,
      });
      const r = await p.generate(REQ);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe(kind);
        expect(r.error.retryable).toBe(retryable);
        expect(r.error.provider).toBe(GEMINI_PROVIDER_ID);
      }
    });
  }

  it('429 gövdesindeki retryDelay ORTAK hata nesnesine taşınır', async () => {
    const body = JSON.stringify({ error: { details: [{ retryDelay: '7s' }] } });
    const p = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: (async () => textRes(body, 429)) as never });
    const r = await p.generate(REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.retryAfterMs).toBe(7000);
  });

  it('pencere bilgisi yoksa TAHMİN üretilmez', async () => {
    const p = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: (async () => textRes('{}', 429)) as never });
    const r = await p.generate(REQ);
    if (!r.ok) expect(r.error.retryAfterMs).toBeUndefined();
  });

  it('ağ hatası → network; timeout → timeout; dış iptal → aborted', async () => {
    const netP = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: (async () => { throw new Error('kopma'); }) as never });
    const netR = await netP.generate(REQ);
    if (!netR.ok) expect(netR.error.kind).toBe('network');

    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const abP = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: (async () => { throw abortErr; }) as never });
    const toR = await abP.generate(REQ);
    if (!toR.ok) expect(toR.error.kind).toBe('timeout');    // dış sinyal yok → timeout

    const ctrl = new AbortController();
    ctrl.abort();
    const abR = await abP.generate(REQ, { signal: ctrl.signal });
    if (!abR.ok) expect(abR.error.kind).toBe('aborted');
  });

  it('verifyKey SIFIR token: GET /models, gövdesiz, header-only', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ models: [] }));
    const p = createGeminiProvider({ keySource: keySource(KEY), fetchImpl: fetchImpl as never });
    const r = await p.verifyKey!();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1beta\/models$/);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(url).not.toContain(KEY);
    expect(r.ok).toBe(true);
  });
});

/* ══════════════ 4) Gateway kayıt + override ══════════════ */

function stubProvider(id: string, script: () => ReturnType<AiProvider['generate']>): AiProvider {
  return { id, generate: async () => script() };
}

describe('gateway kayıt defteri ve provider override', () => {
  it('gerçek kayıt defteri OpenRouter ve Gemini\'yi BİRLİKTE içerir, kimlikler çakışmaz', () => {
    const src = readFileSync('src/platform/ai/gateway/concrete/defaultAiGateway.ts', 'utf8');
    expect(src).toMatch(/createOpenRouterProvider/);
    expect(src).toMatch(/createGeminiProvider/);
    expect(src, 'sağlayıcı sırası if/else zincirine gömülmüş').not.toMatch(/if\s*\(\s*providerId\s*===/);
    // Kimlik sabitleri farklı
    const orId = readFileSync('src/platform/ai/gateway/providers/openRouterProvider.ts', 'utf8')
      .match(/OPEN_ROUTER_PROVIDER_ID = '([^']+)'/)?.[1];
    const gmId = readFileSync('src/platform/ai/gateway/providers/geminiProvider.ts', 'utf8')
      .match(/GEMINI_PROVIDER_ID = '([^']+)'/)?.[1];
    expect(orId).toBeTruthy();
    expect(gmId).toBeTruthy();
    expect(orId).not.toBe(gmId);
  });

  it('providerId override YALNIZ o sağlayıcıyı çalıştırır', async () => {
    const calls: string[] = [];
    const gw = createAiGateway({
      providers: [
        stubProvider('openrouter', async () => { calls.push('openrouter'); return { ok: true, text: 'A', model: 'm', provider: 'openrouter', streamed: false }; }),
        stubProvider('gemini',     async () => { calls.push('gemini');     return { ok: true, text: 'B', model: 'm', provider: 'gemini',     streamed: false }; }),
      ],
    });

    const r = await gw.generateResponse({ messages: [{ role: 'user', content: 'x' }], providerId: 'gemini' });
    expect(calls).toEqual(['gemini']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('B');
  });

  it('override YOKSA mevcut gateway zinciri iki sağlayıcıyı da görür', async () => {
    const calls: string[] = [];
    const gw = createAiGateway({
      providers: [
        stubProvider('openrouter', async () => { calls.push('openrouter'); return { ok: false, error: { kind: 'auth', message: 'x', retryable: false } }; }),
        stubProvider('gemini',     async () => { calls.push('gemini');     return { ok: true, text: 'B', model: 'm', provider: 'gemini', streamed: false }; }),
      ],
    });
    const r = await gw.generateResponse({ messages: [{ role: 'user', content: 'x' }] });
    expect(calls).toEqual(['openrouter', 'gemini']);
    expect(r.ok).toBe(true);
  });

  it('bilinmeyen providerId → no_provider (davranış değişmedi)', async () => {
    const gw = createAiGateway({ providers: [stubProvider('openrouter', async () => ({ ok: true, text: 'A', model: 'm', provider: 'openrouter', streamed: false }))] });
    const r = await gw.generateResponse({ messages: [{ role: 'user', content: 'x' }], providerId: 'yok' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('no_provider');
  });
});

/* ══════════════ 5) GERÇEK çoklu-sağlayıcı fallback ══════════════ */

describe('gerçek iki-sağlayıcı fallback senaryoları', () => {
  const CAPS: AiProviderCapability[] = [
    { id: 'openrouter', defaultModel: 'or-1', latencyTier: 'low',    reliabilityTier: 'high' },
    { id: 'gemini',     defaultModel: 'gm-1', latencyTier: 'medium', reliabilityTier: 'medium' },
  ];
  const ctx = (): OrchestratorContext => ({
    online: true, availableProviderIds: ['openrouter', 'gemini'], nowMs: 1_000,
  });

  function scriptedGateway(script: Record<string, ReturnType<AiProvider['generate']> | (() => ReturnType<AiProvider['generate']>)>) {
    const calls: string[] = [];
    return {
      calls,
      gateway: {
        async generateResponse(request: { providerId?: string }) {
          calls.push(request.providerId ?? '');
          const step = script[request.providerId ?? ''];
          return typeof step === 'function' ? step() : await step!;
        },
      } as never,
    };
  }

  const run = (gateway: never, health?: unknown) => executeOrchestratedRequest({
    gateway,
    task: 'general_chat',
    context: ctx(),
    providers: CAPS,
    request: { messages: [{ role: 'user', content: 'x' }] },
    ...(health ? { health: health as never } : {}),
  });

  it('SENARYO A: OpenRouter timeout → Gemini başarılı', async () => {
    const { calls, gateway } = scriptedGateway({
      openrouter: Promise.resolve({ ok: false, error: { kind: 'timeout', message: 'x', retryable: true } }),
      gemini:     Promise.resolve({ ok: true, text: 'gemini cevabı', model: 'gm-1', provider: 'gemini', streamed: false }),
    });
    const r = await run(gateway);
    expect(calls).toEqual(['openrouter', 'gemini']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.providerId).toBe('gemini');
  });

  it('SENARYO B: Gemini rate-limit → OpenRouter başarılı (tercih Gemini)', async () => {
    const { calls, gateway } = scriptedGateway({
      gemini:     Promise.resolve({ ok: false, error: { kind: 'rate_limited', message: 'x', retryable: true, retryAfterMs: 7000 } }),
      openrouter: Promise.resolve({ ok: true, text: 'or cevabı', model: 'or-1', provider: 'openrouter', streamed: false }),
    });
    const rateCalls: Array<[string, number]> = [];
    const health = {
      recordSuccess: () => {},
      recordFailure: () => {},
      recordRateLimit: (id: string, ms: number) => { rateCalls.push([id, ms]); },
    };
    const r = await executeOrchestratedRequest({
      gateway,
      task: 'general_chat',
      context: { ...ctx(), preferredProviderId: 'gemini' },
      providers: CAPS,
      request: { messages: [{ role: 'user', content: 'x' }] },
      health: health as never,
    });
    expect(calls).toEqual(['gemini', 'openrouter']);
    expect(r.ok).toBe(true);
    expect(rateCalls).toEqual([['gemini', 7000]]);     // retryAfter sağlığa TAŞINDI
  });

  it('SENARYO C: auth hatası → o sağlayıcı atlanır, diğeri denenir', async () => {
    const { calls, gateway } = scriptedGateway({
      openrouter: Promise.resolve({ ok: false, error: { kind: 'auth', message: 'x', retryable: false } }),
      gemini:     Promise.resolve({ ok: true, text: 'gemini cevabı', model: 'gm-1', provider: 'gemini', streamed: false }),
    });
    const r = await run(gateway);
    expect(calls).toEqual(['openrouter', 'gemini']);
    expect(r.ok).toBe(true);
  });

  it('SENARYO D: iki sağlayıcı da düşerse tipli final hata (fail-soft)', async () => {
    const { calls, gateway } = scriptedGateway({
      openrouter: Promise.resolve({ ok: false, error: { kind: 'server', message: 'x', retryable: true } }),
      gemini:     Promise.resolve({ ok: false, error: { kind: 'network', message: 'x', retryable: true } }),
    });
    const r = await run(gateway);
    expect(calls).toEqual(['openrouter', 'gemini']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failureType).toBe('network');
      expect(r.telemetry.failureTypes).toEqual(['server_error', 'network']);
    }
  });

  it('başarı ve hata sağlık deposuna DOĞRU sağlayıcı kimliğiyle yazılır', async () => {
    const success: string[] = [];
    const failure: Array<[string, string]> = [];
    const { gateway } = scriptedGateway({
      openrouter: Promise.resolve({ ok: false, error: { kind: 'server', message: 'x', retryable: true } }),
      gemini:     Promise.resolve({ ok: true, text: 'ok', model: 'gm-1', provider: 'gemini', streamed: false }),
    });
    await run(gateway, {
      recordSuccess: (id: string) => success.push(id),
      recordFailure: (id: string, k: string) => failure.push([id, k]),
      recordRateLimit: () => {},
    });
    expect(failure).toEqual([['openrouter', 'server']]);
    expect(success).toEqual(['gemini']);
  });
});

/* ══════════════ 6) Capability adapter ══════════════ */

describe('capability adapter — iki gerçek sağlayıcı', () => {
  it('kayıtlı iki sağlayıcı için aday üretir; kimlikler ayrı', () => {
    const list = adaptProviderCapabilities({
      providers: [
        { id: 'openrouter', defaultModel: 'or-default' },
        { id: 'gemini',     defaultModel: 'gemini-flash-latest' },
      ],
      credentialConfiguredIds: ['openrouter', 'gemini'],
    });
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id).sort()).toEqual(['gemini', 'openrouter']);
    expect(new Set(list.map((p) => p.defaultModel)).size).toBe(2);
    expect(list.every((p) => p.available)).toBe(true);
  });

  it('yalnız bir anahtar varsa DİĞERİ aday olmaz', () => {
    const list = adaptProviderCapabilities({
      providers: [{ id: 'openrouter', defaultModel: 'a' }, { id: 'gemini', defaultModel: 'b' }],
      credentialConfiguredIds: ['gemini'],
    });
    expect(list.find((p) => p.id === 'gemini')!.available).toBe(true);
    expect(list.find((p) => p.id === 'openrouter')!.available).toBe(false);
  });

  it('Gemini yetenekleri KONSERVATİF ve streaming DÜRÜST bildirilir', () => {
    const [gm] = adaptProviderCapabilities({
      providers: [{ id: 'gemini', defaultModel: 'gemini-flash-latest' }],
      credentialConfiguredIds: ['gemini'],
    });
    expect(gm!.supportsStreaming).toBe(false);      // provider non-streaming
    expect(gm!.supportsReasoning).toBe(false);
    expect(gm!.supportsVision).toBe(false);
    expect(gm!.supportsTools).toBe(false);
    expect(gm!.supportsLongContext).toBe(false);
    expect(gm!.costTier).toBeUndefined();           // kademe İDDİA EDİLMEZ
    expect(gm!.latencyTier).toBeUndefined();
    expect(gm!.reliabilityTier).toBeUndefined();
  });

  it('ücretli erişim reddedilirse ücretli olduğu BİLİNEN aday seçilmez', async () => {
    const list = adaptProviderCapabilities({
      providers: [{ id: 'openrouter', defaultModel: 'a' }, { id: 'gemini', defaultModel: 'b' }],
      credentialConfiguredIds: ['openrouter', 'gemini'],
    });
    const { decideModel } = await import('../platform/ai/orchestrator/maviModelOrchestrator');
    const d = decideModel({
      task: 'general_chat',
      providers: list,
      context: { online: true, availableProviderIds: ['openrouter', 'gemini'], paidAccess: false, nowMs: 0 },
    });
    expect(d.ok).toBe(true);
    expect(d.providerId).toBe('gemini');            // OpenRouter freeTier:false → elendi
  });
});
