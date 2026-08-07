/**
 * AI Gateway + OpenRouter Provider — birim testleri.
 *
 * Kapsam:
 *  1) Gateway fail-closed kapıları (ağa ÇIKMADAN reddetme)
 *  2) Model çözümü · konuşma bütünlüğü · sonuç sözleşmesi
 *  3) Yeniden deneme (retryable ayrımı · deterministik backoff · tavan)
 *  4) Fallback zinciri (sağlayıcı sırası)
 *  5) ÇİFT TOKEN YASAĞI (token aktıysa tekrar/fallback YOK)
 *  6) Savunmacı sarmalayıcı (sağlayıcı throw/şekilsiz dönüş)
 *  7) OpenRouter taşıma: anahtar kapısı · başlıklar · HTTP sınıflandırma ·
 *     redaksiyon · JSON ayrıştırma · SSE streaming · eski-WebView fallback
 *  8) BYOK anahtar kaynağı (güvenli depo → env önceliği)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiGateway } from '../platform/ai/gateway/aiGateway';
import { createOpenRouterProvider, OPEN_ROUTER_PROVIDER_ID } from '../platform/ai/gateway/providers/openRouterProvider';
import { AI_MODELS, DEFAULT_AI_MODEL, resolveModelAlias } from '../platform/ai/gateway/models';
import type {
  AiGenerateResult,
  AiMessage,
  AiProvider,
  AiProviderRequest,
  AiProviderCallOptions,
} from '../platform/ai/gateway/types';

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

const MSGS: readonly AiMessage[] = [
  { role: 'system',    content: 'Sen Mavi adlı araç asistanısın.' },
  { role: 'user',      content: 'Motor sıcaklığı nedir?' },
  { role: 'assistant', content: '90 derece.' },
  { role: 'user',      content: 'Peki normal mi?' },
];

const okResult = (text: string, provider = 'p1'): AiGenerateResult => ({
  ok: true, text, model: 'm', provider, streamed: false,
});

/** Sıralı senaryo döndüren sahte sağlayıcı. */
function fakeProvider(
  id: string,
  script: Array<AiGenerateResult | 'throw'>,
  onCall?: (req: AiProviderRequest, opts?: AiProviderCallOptions) => void,
): AiProvider & { calls: AiProviderRequest[] } {
  const calls: AiProviderRequest[] = [];
  let i = 0;
  return {
    id,
    calls,
    async generate(req, opts) {
      calls.push(req);
      onCall?.(req, opts);
      const step = script[Math.min(i, script.length - 1)];
      i++;
      if (step === 'throw') throw new Error('sağlayıcı patladı');
      return step as AiGenerateResult;
    },
  };
}

const errResult = (kind: string, retryable: boolean, status?: number): AiGenerateResult => ({
  ok: false,
  error: { kind: kind as never, message: 'hata', retryable, ...(status !== undefined ? { status } : {}) },
});

/** Testte gerçek beklemeyi engelleyen sahte sleep — çağrılan süreleri kaydeder. */
function fakeSleep(): { fn: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return { fn: async (ms: number) => { delays.push(ms); }, delays };
}

/* ── Sahte fetch/Response kurguları (provider testleri) ────────────────────── */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok:     status >= 200 && status < 300,
    status,
    body:   null,
    json:   async () => body,
    text:   async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(text: string, status = 200): Response {
  return {
    ok:     status >= 200 && status < 300,
    status,
    body:   null,
    json:   async () => JSON.parse(text) as unknown,
    text:   async () => text,
  } as unknown as Response;
}

/** `Response.body.getReader()` destekleyen akış yanıtı (modern WebView). */
function streamResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok:     status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length
          ? { done: false, value: enc.encode(chunks[i++]) }
          : { done: true,  value: undefined }),
        releaseLock: () => {},
      }),
    },
    json: async () => ({}),
    text: async () => chunks.join(''),
  } as unknown as Response;
}

const keySource = (key: string) => ({ getApiKey: async () => key });

/* ══════════════════════════════════════════════════════════════════════════ */

describe('AI Gateway — fail-closed kapıları (ağa çıkmadan reddeder)', () => {
  it('boş mesaj listesi → invalid_request, sağlayıcı ÇAĞRILMAZ', async () => {
    const p = fakeProvider('p1', [okResult('x')]);
    const gw = createAiGateway({ providers: [p] });
    const r = await gw.generateResponse({ messages: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid_request');
    expect(p.calls).toHaveLength(0);
  });

  it('geçersiz rol / boş içerik → invalid_request', async () => {
    const p = fakeProvider('p1', [okResult('x')]);
    const gw = createAiGateway({ providers: [p] });
    const badRole = await gw.generateResponse({ messages: [{ role: 'tool' as never, content: 'a' }] });
    const empty   = await gw.generateResponse({ messages: [{ role: 'user', content: '' }] });
    expect(badRole.ok).toBe(false);
    expect(empty.ok).toBe(false);
    expect(p.calls).toHaveLength(0);
  });

  it('geçersiz temperature / maxTokens / timeoutMs / model → invalid_request', async () => {
    const p = fakeProvider('p1', [okResult('x')]);
    const gw = createAiGateway({ providers: [p] });
    for (const req of [
      { messages: MSGS, temperature: 5 },
      { messages: MSGS, temperature: Number.NaN },
      { messages: MSGS, maxTokens: 0 },
      { messages: MSGS, maxTokens: 1.5 },
      { messages: MSGS, timeoutMs: -1 },
      { messages: MSGS, model: '  ' },
    ]) {
      const r = await gw.generateResponse(req);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('invalid_request');
    }
    expect(p.calls).toHaveLength(0);
  });

  it('hiç sağlayıcı yok → no_provider', async () => {
    const gw = createAiGateway({ providers: [] });
    const r = await gw.generateResponse({ messages: MSGS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('no_provider');
  });

  it('çevrimdışı → offline, sağlayıcı ÇAĞRILMAZ', async () => {
    const p = fakeProvider('p1', [okResult('x')]);
    const gw = createAiGateway({ providers: [p], network: { isOnline: () => false } });
    const r = await gw.generateResponse({ messages: MSGS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('offline');
    expect(p.calls).toHaveLength(0);
  });

  it('devre kesici açık → circuit_open, sağlayıcı ÇAĞRILMAZ', async () => {
    const p = fakeProvider('p1', [okResult('x')]);
    const gw = createAiGateway({
      providers: [p],
      health: { isHealthy: () => false, recordSuccess: () => {}, recordFailure: () => {} },
    });
    const r = await gw.generateResponse({ messages: MSGS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('circuit_open');
    expect(p.calls).toHaveLength(0);
  });

  it('istek zaten iptal edilmişse → aborted', async () => {
    const p  = fakeProvider('p1', [okResult('x')]);
    const gw = createAiGateway({ providers: [p] });
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await gw.generateResponse({ messages: MSGS }, { signal: ctrl.signal });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('aborted');
    expect(p.calls).toHaveLength(0);
  });

  it('port throw ederse kapı YANLIŞ KAPANMAZ (fail-soft: çevrimiçi varsayılır)', async () => {
    const p = fakeProvider('p1', [okResult('cevap')]);
    const gw = createAiGateway({
      providers: [p],
      network: { isOnline: () => { throw new Error('port bozuk'); } },
    });
    const r = await gw.generateResponse({ messages: MSGS });
    expect(r.ok).toBe(true);
  });

  it('wiring hatası → factory throw (programlama hatası sessizce yutulmaz)', () => {
    expect(() => createAiGateway({ providers: undefined as never })).toThrow(RangeError);
    expect(() => createAiGateway({ providers: [{ id: '', generate: async () => okResult('x') }] })).toThrow(RangeError);
    expect(() => createAiGateway({ providers: [], defaultModel: '' })).toThrow(RangeError);
    expect(() => createAiGateway({ providers: [], retry: { maxAttempts: 0 } })).toThrow(RangeError);
    expect(() => createAiGateway({ providers: [], defaultTimeoutMs: -5 })).toThrow(RangeError);
  });
});

describe('AI Gateway — model çözümü ve konuşma bütünlüğü', () => {
  it('model verilmezse gateway varsayılanı, verilirse istek modeli kullanılır', async () => {
    const p  = fakeProvider('p1', [okResult('a'), okResult('b')]);
    const gw = createAiGateway({ providers: [p], defaultModel: AI_MODELS.claudeHaiku });
    await gw.generateResponse({ messages: MSGS });
    await gw.generateResponse({ messages: MSGS, model: AI_MODELS.deepseekChat });
    expect(p.calls[0]?.model).toBe(AI_MODELS.claudeHaiku);
    expect(p.calls[1]?.model).toBe(AI_MODELS.deepseekChat);
  });

  it('konuşma geçmişi SIRASIYLA ve rolleri korunarak geçer', async () => {
    const p  = fakeProvider('p1', [okResult('a')]);
    const gw = createAiGateway({ providers: [p] });
    await gw.generateResponse({ messages: MSGS });
    expect(p.calls[0]?.messages).toEqual(MSGS);
    expect(p.calls[0]?.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('onToken verilirse stream=true, verilmezse false', async () => {
    const p  = fakeProvider('p1', [okResult('a'), okResult('b')]);
    const gw = createAiGateway({ providers: [p] });
    await gw.generateResponse({ messages: MSGS });
    await gw.generateResponse({ messages: MSGS }, { onToken: () => {} });
    expect(p.calls[0]?.stream).toBe(false);
    expect(p.calls[1]?.stream).toBe(true);
  });

  it('timeout: istek değeri gateway varsayılanını ezer', async () => {
    const p  = fakeProvider('p1', [okResult('a'), okResult('b')]);
    const gw = createAiGateway({ providers: [p], defaultTimeoutMs: 9000 });
    await gw.generateResponse({ messages: MSGS });
    await gw.generateResponse({ messages: MSGS, timeoutMs: 1234 });
    expect(p.calls[0]?.timeoutMs).toBe(9000);
    expect(p.calls[1]?.timeoutMs).toBe(1234);
  });

  it('başarıda health.recordSuccess, ağ hatasında recordFailure çağrılır', async () => {
    const recordSuccess = vi.fn();
    const recordFailure = vi.fn();
    const health = { isHealthy: () => true, recordSuccess, recordFailure };
    const sleep = fakeSleep();

    const okGw = createAiGateway({ providers: [fakeProvider('p1', [okResult('a')])], health });
    await okGw.generateResponse({ messages: MSGS });
    expect(recordSuccess).toHaveBeenCalledTimes(1);

    const badGw = createAiGateway({
      providers: [fakeProvider('p1', [errResult('timeout', true)])],
      health, sleep: sleep.fn,
    });
    await badGw.generateResponse({ messages: MSGS });
    expect(recordFailure).toHaveBeenCalled();
  });

  it('kullanıcı hatası (auth) devre kesiciyi BESLEMEZ', async () => {
    const recordFailure = vi.fn();
    const gw = createAiGateway({
      providers: [fakeProvider('p1', [errResult('auth', false, 401)])],
      health: { isHealthy: () => true, recordSuccess: () => {}, recordFailure },
    });
    await gw.generateResponse({ messages: MSGS });
    expect(recordFailure).not.toHaveBeenCalled();
  });
});

describe('AI Gateway — yeniden deneme ve fallback', () => {
  it('retryable hata tekrar denenir, backoff DETERMİNİSTİK üsteldir', async () => {
    const p  = fakeProvider('p1', [errResult('server', true, 503)]);
    const s  = fakeSleep();
    const gw = createAiGateway({ providers: [p], retry: { maxAttempts: 3, baseDelayMs: 100 }, sleep: s.fn });
    const r  = await gw.generateResponse({ messages: MSGS });
    expect(p.calls).toHaveLength(3);
    expect(s.delays).toEqual([100, 200]);      // son denemeden sonra bekleme YOK
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.attempts).toHaveLength(3);
  });

  it('retryable OLMAYAN hata tekrar DENENMEZ', async () => {
    const p  = fakeProvider('p1', [errResult('auth', false, 401)]);
    const gw = createAiGateway({ providers: [p], retry: { maxAttempts: 3 }, sleep: fakeSleep().fn });
    await gw.generateResponse({ messages: MSGS });
    expect(p.calls).toHaveLength(1);
  });

  it('ilk denemede başarı → tekrar YOK', async () => {
    const p  = fakeProvider('p1', [okResult('cevap')]);
    const gw = createAiGateway({ providers: [p], retry: { maxAttempts: 3 } });
    const r  = await gw.generateResponse({ messages: MSGS });
    expect(p.calls).toHaveLength(1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('cevap');
  });

  it('FALLBACK: ilk sağlayıcı düşerse ikincisi denenir ve sonucu döner', async () => {
    const p1 = fakeProvider('p1', [errResult('server', true, 500)]);
    const p2 = fakeProvider('p2', [okResult('ikinciden cevap', 'p2')]);
    const gw = createAiGateway({ providers: [p1, p2], retry: { maxAttempts: 2 }, sleep: fakeSleep().fn });
    const r  = await gw.generateResponse({ messages: MSGS });
    expect(p1.calls).toHaveLength(2);           // önce kendi tekrarını tüketir
    expect(p2.calls).toHaveLength(1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe('p2');
  });

  it('auth hatası bile olsa SIRADAKİ sağlayıcı denenir (anahtarı olan devralır)', async () => {
    const p1 = fakeProvider('p1', [errResult('no_api_key', false)]);
    const p2 = fakeProvider('p2', [okResult('cevap', 'p2')]);
    const gw = createAiGateway({ providers: [p1, p2] });
    const r  = await gw.generateResponse({ messages: MSGS });
    expect(p1.calls).toHaveLength(1);
    expect(p2.calls).toHaveLength(1);
    expect(r.ok).toBe(true);
  });

  it('tüm sağlayıcılar düşerse son hata + tam attempts kaydı döner', async () => {
    const p1 = fakeProvider('p1', [errResult('server', true, 500)]);
    const p2 = fakeProvider('p2', [errResult('auth', false, 401)]);
    const gw = createAiGateway({ providers: [p1, p2], retry: { maxAttempts: 2 }, sleep: fakeSleep().fn });
    const r  = await gw.generateResponse({ messages: MSGS });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('auth');
      expect(r.attempts?.map((a) => a.provider)).toEqual(['p1', 'p1', 'p2']);
      expect(r.attempts?.[0]?.status).toBe(500);
    }
  });

  it('iptal (aborted) zinciri ANINDA durdurur — fallback denenmez', async () => {
    const p1 = fakeProvider('p1', [errResult('aborted', false)]);
    const p2 = fakeProvider('p2', [okResult('cevap', 'p2')]);
    const gw = createAiGateway({ providers: [p1, p2] });
    const r  = await gw.generateResponse({ messages: MSGS });
    expect(p2.calls).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('aborted');
  });
});

describe('AI Gateway — ÇİFT TOKEN YASAĞI (streaming)', () => {
  it('token aktıktan sonra hata gelirse TEKRAR DENENMEZ ve FALLBACK YAPILMAZ', async () => {
    const emitFirst = fakeProvider('p1', [errResult('network', true)], (_req, opts) => {
      opts?.onToken?.('Mer');
      opts?.onToken?.('haba');
    });
    const p2 = fakeProvider('p2', [okResult('tam cevap', 'p2')]);
    const seen: string[] = [];
    const gw = createAiGateway({ providers: [emitFirst, p2], retry: { maxAttempts: 3 }, sleep: fakeSleep().fn });

    const r = await gw.generateResponse({ messages: MSGS }, { onToken: (t) => seen.push(t) });

    expect(emitFirst.calls).toHaveLength(1);   // tekrar YOK
    expect(p2.calls).toHaveLength(0);          // fallback YOK
    expect(seen).toEqual(['Mer', 'haba']);     // kullanıcı cümle başını İKİ KEZ duymaz
    expect(r.ok).toBe(false);
  });

  it('hiç token akmadıysa streaming isteği normal şekilde tekrar denenir', async () => {
    const p  = fakeProvider('p1', [errResult('timeout', true), okResult('cevap')]);
    const gw = createAiGateway({ providers: [p], retry: { maxAttempts: 2 }, sleep: fakeSleep().fn });
    const r  = await gw.generateResponse({ messages: MSGS }, { onToken: () => {} });
    expect(p.calls).toHaveLength(2);
    expect(r.ok).toBe(true);
  });

  it('onToken dinleyicisi throw ederse istek DÜŞMEZ', async () => {
    const p = fakeProvider('p1', [okResult('cevap')], (_req, opts) => { opts?.onToken?.('x'); });
    const gw = createAiGateway({ providers: [p] });
    const r  = await gw.generateResponse({ messages: MSGS }, { onToken: () => { throw new Error('UI patladı'); } });
    expect(r.ok).toBe(true);
  });
});

describe('AI Gateway — savunmacı sarmalayıcı', () => {
  it('sağlayıcı THROW ederse gateway throw ETMEZ → tipli hata', async () => {
    const gw = createAiGateway({ providers: [fakeProvider('p1', ['throw'])], sleep: fakeSleep().fn });
    const r  = await gw.generateResponse({ messages: MSGS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.provider).toBe('p1');
  });

  it('sağlayıcı ŞEKİLSİZ sonuç dönerse → malformed_response', async () => {
    const bad: AiProvider = { id: 'p1', generate: async () => ({ nonsense: true } as never) };
    const gw = createAiGateway({ providers: [bad] });
    const r  = await gw.generateResponse({ messages: MSGS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('malformed_response');
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('OpenRouter Provider — anahtar kapısı ve istek biçimi', () => {
  it('anahtar yoksa AĞA ÇIKILMAZ → no_api_key', async () => {
    const fetchImpl = vi.fn();
    const p = createOpenRouterProvider({ keySource: keySource(''), fetchImpl: fetchImpl as never });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('no_api_key');
  });

  it('anahtar deposu throw ederse fail-closed → no_api_key (ağ YOK)', async () => {
    const fetchImpl = vi.fn();
    const p = createOpenRouterProvider({
      keySource: { getApiKey: async () => { throw new Error('keystore kilitli'); } },
      fetchImpl: fetchImpl as never,
    });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('no_api_key');
  });

  it('anahtar YALNIZ Authorization başlığında; gövdede/URL\'de YOK', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const p = createOpenRouterProvider({ keySource: keySource('sk-or-v1-gizli'), fetchImpl: fetchImpl as never, title: 'CarOS Pro' });
    await p.generate({ messages: MSGS, model: AI_MODELS.gpt4oMini, timeoutMs: 5000, stream: false, temperature: 0.4, maxTokens: 128 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(url).not.toContain('gizli');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-or-v1-gizli');
    expect(headers['X-Title']).toBe('CarOS Pro');
    expect(String(init.body)).not.toContain('gizli');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['model']).toBe(AI_MODELS.gpt4oMini);
    expect(body['stream']).toBe(false);
    expect(body['temperature']).toBe(0.4);
    expect(body['max_tokens']).toBe(128);
    expect(body['messages']).toEqual(MSGS.map((m) => ({ role: m.role, content: m.content })));
  });

  it('fetch enjekte edilmezse ve global fetch yoksa factory throw eder', () => {
    expect(() => createOpenRouterProvider({ keySource: keySource('k'), fetchImpl: undefined as never, baseUrl: 'x' }))
      .not.toThrow();  // global fetch jsdom'da var
    expect(() => createOpenRouterProvider({ keySource: undefined as never })).toThrow(RangeError);
  });
});

describe('OpenRouter Provider — HTTP sınıflandırma ve redaksiyon', () => {
  const cases: Array<[number, string, boolean]> = [
    [401, 'auth',            false],
    /* GÜNCELLENDİ (saha 2026-08-05 · #421) — ZAYIFLATILMADI: 402 artık `auth`
     * değil `insufficient_credit`. Sahada 15 dakikada 11 kez 402 alındı ve
     * kullanıcı "anahtar geçersiz" ile "kredi bitti"yi ayırt edemiyordu; ikisi
     * FARKLI eylem gerektirir (anahtar yenile ≠ bakiye yükle). retryable=false
     * değişmedi: ikisinde de tekrar denemek anlamsızdır. */
    [402, 'insufficient_credit', false],
    [403, 'auth',            false],
    [429, 'rate_limited',    true],
    [400, 'invalid_request', false],
    [404, 'invalid_request', false],
    [500, 'server',          true],
    [503, 'server',          true],
  ];

  for (const [status, kind, retryable] of cases) {
    it(`HTTP ${status} → ${kind} (retryable=${retryable})`, async () => {
      const p = createOpenRouterProvider({
        keySource: keySource('k'),
        fetchImpl: (async () => textResponse('{"error":"detay"}', status)) as never,
      });
      const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: false });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe(kind);
        expect(r.error.retryable).toBe(retryable);
        expect(r.error.status).toBe(status);
        expect(r.error.provider).toBe(OPEN_ROUTER_PROVIDER_ID);
      }
    });
  }

  it('hata gövdesindeki anahtar-benzeri dizi REDAKTE edilir', async () => {
    const p = createOpenRouterProvider({
      keySource: keySource('k'),
      fetchImpl: (async () => textResponse('invalid key sk-or-v1-abcdef123456 rejected', 401)) as never,
    });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toContain('abcdef123456');
      expect(r.error.message).toContain('***');
    }
  });

  it('ağ hatası → network (retryable), timeout → timeout, dış iptal → aborted', async () => {
    const netP = createOpenRouterProvider({
      keySource: keySource('k'),
      fetchImpl: (async () => { throw new Error('bağlantı yok'); }) as never,
    });
    const netR = await netP.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: false });
    expect(netR.ok).toBe(false);
    if (!netR.ok) { expect(netR.error.kind).toBe('network'); expect(netR.error.retryable).toBe(true); }

    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const toP = createOpenRouterProvider({
      keySource: keySource('k'),
      fetchImpl: (async () => { throw abortErr; }) as never,
    });
    const toR = await toP.generate({ messages: MSGS, model: 'm', timeoutMs: 1, stream: false });
    expect(toR.ok).toBe(false);
    if (!toR.ok) { expect(toR.error.kind).toBe('timeout'); expect(toR.error.retryable).toBe(true); }

    const ctrl = new AbortController();
    ctrl.abort();
    const abR = await toP.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: false }, { signal: ctrl.signal });
    expect(abR.ok).toBe(false);
    if (!abR.ok) { expect(abR.error.kind).toBe('aborted'); expect(abR.error.retryable).toBe(false); }
  });
});

describe('OpenRouter Provider — JSON (non-streaming) yanıt', () => {
  it('içerik + finish_reason + usage doğru okunur', async () => {
    const p = createOpenRouterProvider({
      keySource: keySource('k'),
      fetchImpl: (async () => jsonResponse({
        choices: [{ message: { content: 'Motor sıcaklığı normal.' }, finish_reason: 'stop' }],
        usage:   { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      })) as never,
    });
    const r = await p.generate({ messages: MSGS, model: AI_MODELS.claudeHaiku, timeoutMs: 1000, stream: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe('Motor sıcaklığı normal.');
      expect(r.streamed).toBe(false);
      expect(r.model).toBe(AI_MODELS.claudeHaiku);
      expect(r.finishReason).toBe('stop');
      expect(r.usage).toEqual({ promptTokens: 12, completionTokens: 5, totalTokens: 17 });
    }
  });

  it('boş/eksik içerik → malformed_response (uydurma metin YOK)', async () => {
    for (const body of [{}, { choices: [] }, { choices: [{ message: { content: '' } }] }, { choices: [{}] }]) {
      const p = createOpenRouterProvider({ keySource: keySource('k'), fetchImpl: (async () => jsonResponse(body)) as never });
      const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: false });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('malformed_response');
    }
  });

  it('gövde içi error alanı tipli hataya çevrilir', async () => {
    const p = createOpenRouterProvider({
      keySource: keySource('k'),
      fetchImpl: (async () => jsonResponse({ error: { code: 429, message: 'rate limit' } })) as never,
    });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: false });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.kind).toBe('rate_limited'); expect(r.error.retryable).toBe(true); }
  });
});

describe('OpenRouter Provider — SSE streaming', () => {
  it('token-token akıtır, [DONE] ile biter, tam metni birleştirir', async () => {
    const chunks = [
      ': OPENROUTER PROCESSING\n',
      'data: {"choices":[{"delta":{"content":"Motor "}}]}\n',
      'data: {"choices":[{"delta":{"content":"sıcaklığı "}}]}\n',
      'data: {"choices":[{"delta":{"content":"normal."},"finish_reason":"stop"}],"usage":{"total_tokens":9}}\n',
      'data: [DONE]\n',
    ];
    const seen: string[] = [];
    const p = createOpenRouterProvider({ keySource: keySource('k'), fetchImpl: (async () => streamResponse(chunks)) as never });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: true }, { onToken: (t) => seen.push(t) });

    expect(seen).toEqual(['Motor ', 'sıcaklığı ', 'normal.']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe('Motor sıcaklığı normal.');
      expect(r.streamed).toBe(true);
      expect(r.finishReason).toBe('stop');
      expect(r.usage?.totalTokens).toBe(9);
    }
  });

  it('parça sınırı satır ortasına düşse bile token BÖLÜNMEZ (buffer)', async () => {
    const chunks = ['data: {"choices":[{"delta":{"con', 'tent":"Merhaba"}}]}\n', 'data: [DONE]\n'];
    const seen: string[] = [];
    const p = createOpenRouterProvider({ keySource: keySource('k'), fetchImpl: (async () => streamResponse(chunks)) as never });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: true }, { onToken: (t) => seen.push(t) });
    expect(seen).toEqual(['Merhaba']);
    expect(r.ok).toBe(true);
  });

  it('bozuk JSON satırı akışı DÜŞÜRMEZ (atlanır)', async () => {
    const chunks = [
      'data: {bozuk\n',
      'data: {"choices":[{"delta":{"content":"iyi"}}]}\n',
      '\n',
      'data: [DONE]\n',
    ];
    const p = createOpenRouterProvider({ keySource: keySource('k'), fetchImpl: (async () => streamResponse(chunks)) as never });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: true }, { onToken: () => {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('iyi');
  });

  it('akış içi error → tipli hata (yarım metin BAŞARI sayılmaz)', async () => {
    const chunks = ['data: {"error":{"code":500,"message":"upstream"}}\n'];
    const p = createOpenRouterProvider({ keySource: keySource('k'), fetchImpl: (async () => streamResponse(chunks)) as never });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: true }, { onToken: () => {} });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.kind).toBe('server'); expect(r.error.retryable).toBe(true); }
  });

  it('hiç içerik akmazsa → malformed_response', async () => {
    const p = createOpenRouterProvider({ keySource: keySource('k'), fetchImpl: (async () => streamResponse(['data: [DONE]\n'])) as never });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: true }, { onToken: () => {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('malformed_response');
  });

  it('ESKİ WEBVIEW: response.body yoksa tam metin SSE olarak ayrıştırılır (fail-soft)', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"Eski "}}]}\ndata: {"choices":[{"delta":{"content":"WebView"}}]}\ndata: [DONE]\n';
    const seen: string[] = [];
    const p = createOpenRouterProvider({ keySource: keySource('k'), fetchImpl: (async () => textResponse(sse)) as never });
    const r = await p.generate({ messages: MSGS, model: 'm', timeoutMs: 1000, stream: true }, { onToken: (t) => seen.push(t) });
    expect(seen).toEqual(['Eski ', 'WebView']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('Eski WebView');
  });
});

describe('OpenRouter Provider — verifyKey (sıfır-token anahtar doğrulama)', () => {
  it('anahtar yoksa AĞA ÇIKMAZ → no_api_key', async () => {
    const fetchImpl = vi.fn();
    const p = createOpenRouterProvider({ keySource: keySource(''), fetchImpl: fetchImpl as never });
    const r = await p.verifyKey!();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('no_api_key');
  });

  it('TOKEN HARCAMAZ: GET /key çağrılır, gövde YOK, model/mesaj gönderilmez', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { label: 'test' } }));
    const p = createOpenRouterProvider({ keySource: keySource('sk-or-v1-gizli'), fetchImpl: fetchImpl as never });
    const r = await p.verifyKey!();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();                    // istek gövdesi YOK → 0 token
    expect(r.ok).toBe(true);
  });

  it('anahtar YALNIZ Authorization başlığında — URL query\'ye yazılmaz', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const p = createOpenRouterProvider({ keySource: keySource('sk-or-v1-gizli'), fetchImpl: fetchImpl as never });
    await p.verifyKey!();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('gizli');
    expect(url).not.toContain('?');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-or-v1-gizli');
  });

  it('HTTP durumları generate ile AYNI taksonomiye eşlenir', async () => {
    const cases: Array<[number, string]> = [
      [401, 'auth'], [403, 'auth'], [429, 'rate_limited'], [500, 'server'], [400, 'invalid_request'],
    ];
    for (const [status, kind] of cases) {
      const p = createOpenRouterProvider({
        keySource: keySource('k'),
        fetchImpl: (async () => textResponse('{"error":"x"}', status)) as never,
      });
      const r = await p.verifyKey!();
      expect(r.ok).toBe(false);
      expect(r.error?.kind).toBe(kind);
      expect(r.error?.status).toBe(status);
    }
  });

  it('ağ hatası → network; iptal → aborted; ASLA throw etmez', async () => {
    const netP = createOpenRouterProvider({
      keySource: keySource('k'),
      fetchImpl: (async () => { throw new Error('bağlantı yok'); }) as never,
    });
    const netR = await netP.verifyKey!();
    expect(netR.ok).toBe(false);
    expect(netR.error?.kind).toBe('network');

    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const abP = createOpenRouterProvider({
      keySource: keySource('k'),
      fetchImpl: (async () => { throw abortErr; }) as never,
    });
    const ctrl = new AbortController();
    ctrl.abort();
    const abR = await abP.verifyKey!({ signal: ctrl.signal });
    expect(abR.error?.kind).toBe('aborted');
  });

  it('hata gövdesindeki anahtar-benzeri dizi REDAKTE edilir', async () => {
    const p = createOpenRouterProvider({
      keySource: keySource('k'),
      fetchImpl: (async () => textResponse('bad key sk-or-v1-abcdef123456', 401)) as never,
    });
    const r = await p.verifyKey!();
    expect(r.error?.message).not.toContain('abcdef123456');
    expect(r.error?.message).toContain('***');
  });
});

describe('Model kataloğu', () => {
  it('varsayılan model katalogdan gelir ve takma adlar çözülür', () => {
    expect(DEFAULT_AI_MODEL).toBe(AI_MODELS.claudeHaiku);
    expect(resolveModelAlias('deepseekChat')).toBe(AI_MODELS.deepseekChat);
    expect(resolveModelAlias('yokBöyleModel')).toBeUndefined();
  });

  it('katalog çok sağlayıcılıdır (tek modele bağımlılık yok)', () => {
    const vendors = new Set(Object.values(AI_MODELS).map((m) => m.split('/')[0]));
    expect(vendors.size).toBeGreaterThanOrEqual(6);
  });
});

/* ── BYOK anahtar kaynağı (concrete binding) ───────────────────────────────── */

const storeMock = vi.hoisted(() => ({ get: vi.fn<(k: string) => Promise<string>>() }));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: storeMock }));

describe('OpenRouter BYOK anahtar kaynağı', () => {
  beforeEach(() => { storeMock.get.mockReset(); });

  it('güvenli depodaki anahtar önceliklidir', async () => {
    storeMock.get.mockResolvedValue('  sk-or-v1-depo  ');
    const { createOpenRouterKeySource } = await import('../platform/ai/gateway/concrete/openRouterKeySource');
    expect(await createOpenRouterKeySource().getApiKey()).toBe('sk-or-v1-depo');
    expect(storeMock.get).toHaveBeenCalledWith('openRouterApiKey');
  });

  it('depo boşsa env fallback (dev), depo throw ederse de fail-soft env', async () => {
    const { createOpenRouterKeySource } = await import('../platform/ai/gateway/concrete/openRouterKeySource');

    storeMock.get.mockResolvedValue('');
    expect(await createOpenRouterKeySource().getApiKey()).toBe('');   // env tanımsız → '' (fail-closed)

    storeMock.get.mockRejectedValue(new Error('keystore kilitli'));
    expect(await createOpenRouterKeySource().getApiKey()).toBe('');   // throw yutulur
  });
});
