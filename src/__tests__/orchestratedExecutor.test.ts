/**
 * orchestratedExecutor.test.ts — Faz 2: zincir yürütme · sağlık geri beslemesi.
 *
 * Kilitlenen davranışlar:
 *  1) Zincir SIRAYLA yürür; ilk başarı durdurur
 *  2) Hata taksonomisi: auth/rate_limit/timeout/network/server/invalid/aborted
 *  3) Fallback kuralları: abort ve istemci hataları zinciri DURDURUR
 *  4) Auth alan sağlayıcı bu istekte ATLANIR
 *  5) Aynı provider/model ikilisi İKİ KEZ çalışmaz · sonsuz döngü yok
 *  6) AKIŞ GÜVENLİĞİ: token aktıysa fallback YOK
 *  7) Global devre kesici açıkken executor ÇALIŞMAZ (sağlayıcı sağlığı ezemez)
 *  8) Aday yoksa AĞA ÇIKILMAZ
 *  9) Telemetri yalnız güvenli metadata
 * 10) Capability adapter KONSERVATİF; task classifier DETERMİNİSTİK
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  executeOrchestratedRequest,
  failureTypeFromErrorKind,
  type ExecutorHealthPort,
} from '../platform/ai/orchestrator/orchestratedExecutor';
import { adaptProviderCapabilities, availableProviderIdsOf } from '../platform/ai/orchestrator/capabilityAdapter';
import { classifyTask } from '../platform/ai/orchestrator/taskClassifier';
import type { AiProviderCapability, OrchestratorContext } from '../platform/ai/orchestrator/orchestratorTypes';
import type { AiErrorKind, AiGateway, AiGenerateRequest, AiGenerateResult } from '../platform/ai/gateway/types';

/* ── Sahte sağlayıcı yetenekleri (NÖTR adlar) ─────────────────────────────── */

const P1: AiProviderCapability = {
  id: 'alpha', defaultModel: 'alpha-1',
  latencyTier: 'low', costTier: 'low', reliabilityTier: 'high', freeTier: true,
};
const P2: AiProviderCapability = {
  id: 'beta', defaultModel: 'beta-1',
  latencyTier: 'medium', costTier: 'medium', reliabilityTier: 'medium', freeTier: true,
};
const P3: AiProviderCapability = {
  id: 'gamma', defaultModel: 'gamma-1',
  latencyTier: 'high', costTier: 'high', reliabilityTier: 'medium', freeTier: true,
};
const ALL = [P1, P2, P3];
const IDS = ALL.map((p) => p.id);

const ok = (text: string): AiGenerateResult => ({ ok: true, text, model: 'm', provider: 'p', streamed: false });
const err = (kind: AiErrorKind): AiGenerateResult =>
  ({ ok: false, error: { kind, message: 'hata', retryable: true } });

/** Sağlayıcı kimliğine göre senaryo döndüren sahte gateway. */
function fakeGateway(script: Record<string, AiGenerateResult | 'emit-then-fail'>): AiGateway & {
  calls: Array<{ providerId?: string; model?: string }>;
} {
  const calls: Array<{ providerId?: string; model?: string }> = [];
  return {
    calls,
    async generateResponse(request: AiGenerateRequest, options) {
      calls.push({ providerId: request.providerId, model: request.model });
      const step = script[request.providerId ?? ''] ?? err('unknown');
      if (step === 'emit-then-fail') {
        options?.onToken?.('Mer');
        options?.onToken?.('haba');
        return err('network');
      }
      return step;
    },
  };
}

function ctx(over: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return { online: true, availableProviderIds: IDS, nowMs: 1_000_000, ...over };
}

function healthSpy(): ExecutorHealthPort & {
  success: string[]; failure: Array<[string, string]>; rate: string[];
} {
  const state = {
    success: [] as string[],
    failure: [] as Array<[string, string]>,
    rate:    [] as string[],
    recordSuccess:   (id: string) => { state.success.push(id); },
    recordFailure:   (id: string, kind: string) => { state.failure.push([id, kind]); },
    recordRateLimit: (id: string) => { state.rate.push(id); },
  };
  return state as never;
}

const baseRequest: AiGenerateRequest = { messages: [{ role: 'user', content: 'x' }] };

const run = (
  gateway: AiGateway,
  over: Partial<Parameters<typeof executeOrchestratedRequest>[0]> = {},
) => executeOrchestratedRequest({
  gateway,
  task:      'general_chat',
  context:   ctx(),
  providers: ALL,
  request:   baseRequest,
  ...over,
});

/* ══════════════ 1) Zincir yürütme ══════════════ */

describe('zincir yürütme', () => {
  it('ilk aday başarılı → zincir durur, tek çağrı', async () => {
    const gw = fakeGateway({ alpha: ok('cevap') });
    const r = await run(gw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.providerId).toBe('alpha');
      expect(r.result.text).toBe('cevap');
      expect(r.telemetry.fallbackUsed).toBe(false);
    }
    expect(gw.calls).toHaveLength(1);
  });

  it('gateway\'e providerId + model AÇIKÇA iletilir', async () => {
    const gw = fakeGateway({ alpha: ok('c') });
    await run(gw);
    expect(gw.calls[0]).toEqual({ providerId: 'alpha', model: 'alpha-1' });
  });

  it('timeout → sıradaki aday başarılı (fallback)', async () => {
    const gw = fakeGateway({ alpha: err('timeout'), beta: ok('ikinciden') });
    const r = await run(gw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.providerId).toBe('beta');
      expect(r.telemetry.fallbackUsed).toBe(true);
      expect(r.telemetry.failureTypes).toEqual(['timeout']);
    }
  });

  it('rate limit → sıradaki aday başarılı', async () => {
    const gw = fakeGateway({ alpha: err('rate_limited'), beta: ok('ikinciden') });
    const r = await run(gw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.providerId).toBe('beta');
  });

  it('zincir SIRASI korunur (karar sırası neyse o)', async () => {
    const gw = fakeGateway({ alpha: err('server'), beta: err('server'), gamma: ok('üçüncüden') });
    const r = await run(gw);
    expect(gw.calls.map((c) => c.providerId)).toEqual(['alpha', 'beta', 'gamma']);
    expect(r.ok).toBe(true);
  });

  it('tüm adaylar başarısız → tipli final hata', async () => {
    const gw = fakeGateway({ alpha: err('server'), beta: err('server'), gamma: err('network') });
    const r = await run(gw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failureType).toBe('network');
      expect(r.telemetry.finalOutcome).toBe('failed');
      expect(r.attempts).toHaveLength(3);
    }
  });

  it('aynı provider/model ikilisi İKİ KEZ çalışmaz', async () => {
    const gw = fakeGateway({ alpha: err('server'), beta: err('server'), gamma: err('server') });
    await run(gw);
    const keys = gw.calls.map((c) => `${c.providerId}::${c.model}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tek sağlayıcıyla çalışır', async () => {
    const gw = fakeGateway({ alpha: ok('tek') });
    const r = await run(gw, { providers: [P1], context: ctx({ availableProviderIds: ['alpha'] }) });
    expect(r.ok).toBe(true);
    expect(gw.calls).toHaveLength(1);
  });
});

/* ══════════════ 2) Fallback kuralları ══════════════ */

describe('fallback kuralları', () => {
  it('KULLANICI İPTALİ zinciri durdurur — fallback YOK', async () => {
    const gw = fakeGateway({ alpha: err('aborted'), beta: ok('olmamalı') });
    const r = await run(gw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failureType).toBe('aborted');
    expect(gw.calls).toHaveLength(1);
  });

  it('önceden iptal edilmiş sinyalde hiç istek gönderilmez', async () => {
    const gw = fakeGateway({ alpha: ok('olmamalı') });
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await run(gw, { options: { signal: ctrl.signal } });
    expect(r.ok).toBe(false);
    expect(gw.calls).toHaveLength(0);
  });

  it('invalid_request → sağlayıcı değiştirmek çözmez, fallback YOK', async () => {
    const gw = fakeGateway({ alpha: err('invalid_request'), beta: ok('olmamalı') });
    const r = await run(gw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failureType).toBe('invalid_request');
    expect(gw.calls).toHaveLength(1);
  });

  it('malformed_response → fallback YOK (sözleşme hatası)', async () => {
    const gw = fakeGateway({ alpha: err('malformed_response'), beta: ok('olmamalı') });
    const r = await run(gw);
    expect(r.ok).toBe(false);
    expect(gw.calls).toHaveLength(1);
  });

  it('AUTH hatası: aynı sağlayıcı bu istekte ATLANIR, sıradakine geçilir', async () => {
    // Aynı sağlayıcı zincire iki modelle girse bile ikincisi denenmez.
    const twoModels: AiProviderCapability = { ...P1, modelsByTask: { general_chat: 'alpha-2' } };
    const gw = fakeGateway({ alpha: err('auth'), beta: ok('ikinciden') });
    const r = await run(gw, { providers: [twoModels, P2] });
    expect(r.ok).toBe(true);
    const alphaCalls = gw.calls.filter((c) => c.providerId === 'alpha');
    expect(alphaCalls).toHaveLength(1);          // auth sonrası aynı sağlayıcı YOK
  });

  it('hiç aday yoksa AĞA ÇIKILMAZ', async () => {
    const gw = fakeGateway({ alpha: ok('olmamalı') });
    const r = await run(gw, { context: ctx({ availableProviderIds: [] }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failureType).toBe('no_candidates');
    expect(gw.calls).toHaveLength(0);
  });

  it('GLOBAL devre kesici açıkken executor ÇALIŞMAZ', async () => {
    const gw = fakeGateway({ alpha: ok('olmamalı') });
    const r = await run(gw, { globalCircuit: { isHealthy: () => false } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failureType).toBe('circuit_open');
    expect(gw.calls).toHaveLength(0);
  });
});

/* ══════════════ 3) Akış güvenliği ══════════════ */

describe('streaming güvenliği', () => {
  it('token AKMADAN hata → fallback mümkün', async () => {
    const gw = fakeGateway({ alpha: err('network'), beta: ok('ikinciden') });
    const seen: string[] = [];
    const r = await run(gw, { options: { onToken: (t) => seen.push(t) } });
    expect(r.ok).toBe(true);
    expect(gw.calls).toHaveLength(2);
    expect(seen).toHaveLength(0);
  });

  it('token AKTIKTAN sonra hata → fallback YAPILMAZ (iki cevap karışmasın)', async () => {
    const gw = fakeGateway({ alpha: 'emit-then-fail', beta: ok('olmamalı') });
    const seen: string[] = [];
    const r = await run(gw, { options: { onToken: (t) => seen.push(t) } });

    expect(seen).toEqual(['Mer', 'haba']);
    expect(gw.calls).toHaveLength(1);                     // ikinci sağlayıcı DENENMEDİ
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failureType).toBe('stream_interrupted');
      expect(r.telemetry.finalOutcome).toBe('stream_interrupted');
    }
  });

  it('onToken dinleyicisi throw etse bile akış düşmez', async () => {
    const gw = fakeGateway({ alpha: 'emit-then-fail' });
    const r = await run(gw, { options: { onToken: () => { throw new Error('UI patladı'); } } });
    expect(r.ok).toBe(false);                             // hata yine tipli
  });
});

/* ══════════════ 4) Sağlık geri beslemesi ══════════════ */

describe('provider health feedback', () => {
  it('başarı health store\'a YAZILIR', async () => {
    const health = healthSpy();
    await run(fakeGateway({ alpha: ok('c') }), { health });
    expect(health.success).toEqual(['alpha']);
    expect(health.failure).toHaveLength(0);
  });

  it('hata DOĞRU SINIFTA yazılır', async () => {
    const health = healthSpy();
    await run(fakeGateway({ alpha: err('server'), beta: err('timeout'), gamma: err('auth') }), { health });
    expect(health.failure).toEqual([['alpha', 'server'], ['beta', 'timeout'], ['gamma', 'auth']]);
  });

  it('rate limit AYRI kanaldan (pencere bilgisi) yazılır', async () => {
    const health = healthSpy();
    await run(fakeGateway({ alpha: err('rate_limited'), beta: ok('c') }), { health });
    expect(health.rate).toEqual(['alpha']);
    expect(health.failure).toHaveLength(0);
  });

  it('kullanıcı iptali ve istemci hatası SAĞLAYICI sağlığına yazılmaz', async () => {
    const health = healthSpy();
    await run(fakeGateway({ alpha: err('aborted') }), { health });
    await run(fakeGateway({ alpha: err('invalid_request') }), { health });
    expect(health.failure).toHaveLength(0);
    expect(health.rate).toHaveLength(0);
  });

  it('hata taksonomisi gateway sınıflarından TÜRETİLİR', () => {
    const map: Array<[AiErrorKind, string]> = [
      ['auth', 'auth'], ['no_api_key', 'auth'], ['rate_limited', 'rate_limit'],
      ['timeout', 'timeout'], ['network', 'network'], ['offline', 'network'],
      ['no_provider', 'provider_unavailable'], ['circuit_open', 'provider_unavailable'],
      ['server', 'server_error'], ['malformed_response', 'invalid_response'],
      ['invalid_request', 'invalid_request'], ['aborted', 'aborted'], ['unknown', 'unknown'],
    ];
    for (const [kind, expected] of map) expect(failureTypeFromErrorKind(kind)).toBe(expected);
  });
});

/* ══════════════ 5) Telemetri ══════════════ */

describe('telemetri', () => {
  it('YALNIZ güvenli metadata; prompt/cevap TAŞIMAZ', async () => {
    const gw = fakeGateway({ alpha: err('timeout'), beta: ok('gizli cevap metni') });
    const r = await run(gw, {
      request: { messages: [{ role: 'user', content: 'GİZLİ KULLANICI METNİ' }] },
    });
    const t = r.telemetry;
    expect(Object.keys(t).sort()).toEqual([
      'attemptCount', 'candidateCount', 'failureTypes', 'fallbackUsed', 'finalOutcome',
      'selectedModelId', 'selectedProviderId', 'taskType', 'totalDecisionMs', 'totalExecutionMs',
    ].sort());
    const dump = JSON.stringify(t);
    expect(dump).not.toContain('GİZLİ KULLANICI METNİ');
    expect(dump).not.toContain('gizli cevap metni');
    expect(t.attemptCount).toBe(2);
    expect(t.fallbackUsed).toBe(true);
    expect(t.finalOutcome).toBe('success');
  });

  it('DI saat yoksa süreler 0 (uydurma ölçüm yok)', async () => {
    const r = await run(fakeGateway({ alpha: ok('c') }));
    expect(r.telemetry.totalDecisionMs).toBe(0);
    expect(r.telemetry.totalExecutionMs).toBe(0);
  });

  it('DI saatle süreler ölçülür', async () => {
    let t = 0;
    const r = await run(fakeGateway({ alpha: ok('c') }), { clock: { nowMs: () => { t += 5; return t; } } });
    expect(r.telemetry.totalDecisionMs).toBeGreaterThan(0);
  });
});

/* ══════════════ 6) Capability adapter ══════════════ */

describe('capability adapter — konservatif', () => {
  it('ipucu YOKSA hiçbir yetenek varsayılmaz', () => {
    const [p] = adaptProviderCapabilities({
      providers: [{ id: 'x', defaultModel: 'x-1' }],
      credentialConfiguredIds: ['x'],
      hints: {},
    });
    expect(p!.supportsReasoning).toBe(false);
    expect(p!.supportsVision).toBe(false);
    expect(p!.supportsTools).toBe(false);
    expect(p!.supportsLongContext).toBe(false);
    expect(p!.supportsOffline).toBe(false);
    expect(p!.freeTier).toBe(false);                 // ücretsiz erişim VARSAYILMAZ
    expect(p!.reliabilityTier).toBeUndefined();      // yüksek güvenilirlik VARSAYILMAZ
    expect(p!.costTier).toBeUndefined();
    expect(p!.latencyTier).toBeUndefined();
  });

  it('anahtarı olmayan sağlayıcı available:false', () => {
    const list = adaptProviderCapabilities({
      providers: [{ id: 'x', defaultModel: 'x-1' }, { id: 'y', defaultModel: 'y-1' }],
      credentialConfiguredIds: ['x'],
    });
    expect(list.find((p) => p.id === 'x')!.available).toBe(true);
    expect(list.find((p) => p.id === 'y')!.available).toBe(false);
    expect(availableProviderIdsOf(list)).toEqual(['x']);
  });

  it('bozuk kayıtlar atlanır, throw YOK', () => {
    const list = adaptProviderCapabilities({
      providers: [null, { id: '' }, { id: 'z' }, { id: 'ok', defaultModel: 'm' }] as never,
      credentialConfiguredIds: ['ok'],
    });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('ok');
  });

  it('gerçek kayıt tablosu yalnız KANITLI yetenek bildirir', () => {
    // Yorumlar HARİÇ: açıklamada "reliabilityTier BİLDİRİLMEZ" yazması meşrudur;
    // kilit yalnız GERÇEK KODU denetler.
    const src = readFileSync('src/platform/ai/orchestrator/capabilityAdapter.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const table = src.slice(src.indexOf('CAPABILITY_HINTS'), src.indexOf('ProviderRegistryEntry'));

    // Güvenilirlik/gecikme/maliyet kademesi seçilen modele göre GENİŞ değişir →
    // hiçbir sağlayıcı için kademe İDDİA EDİLEMEZ.
    expect(table, 'kanıtsız yüksek güvenilirlik iddiası').not.toMatch(/reliabilityTier:/);
    expect(table, 'kanıtsız gecikme kademesi iddiası').not.toMatch(/latencyTier:/);
    expect(table, 'kanıtsız maliyet kademesi iddiası').not.toMatch(/costTier:/);

    // `freeTier:true` YALNIZ ücretsiz katmanı repo içinde kanıtlanmış sağlayıcıda
    // olabilir. Kullanıcı hesabı ÜCRETLENDİRİLEN sağlayıcı asla ücretsiz sayılmaz.
    const openrouterBlock = table.slice(table.indexOf('openrouter:'), table.indexOf('gemini:'));
    expect(openrouterBlock, 'ücretli sağlayıcı freeTier:true bildirmiş').toMatch(/freeTier:\s*false/);
  });
});

/* ══════════════ 7) Task classifier ══════════════ */

describe('task classifier — deterministik ve yerel', () => {
  it('araç sorusu tanınır', () => {
    for (const text of ['motor sıcaklığı kaç', 'yakıt ne kadar kaldı', 'fren balatası ne zaman']) {
      expect(classifyTask(text)).toBe('vehicle_question');
    }
  });

  it('kod sorusu tanınır', () => {
    expect(classifyTask('bu javascript fonksiyonu neden hata veriyor')).toBe('code_analysis');
  });

  it('kısa istek → short_answer; boş/geçersiz → general_chat', () => {
    expect(classifyTask('selam')).toBe('short_answer');
    expect(classifyTask('')).toBe('general_chat');
    expect(classifyTask(null as never)).toBe('general_chat');
  });

  it('uzun istek → long_explanation', () => {
    expect(classifyTask('bir konu hakkında konuşalım '.repeat(20))).toBe('long_explanation');
  });

  it('DETERMİNİSTİK: aynı metin → aynı sınıf', () => {
    const text = 'motor sıcaklığı neden yükseldi';
    const first = classifyTask(text);
    for (let i = 0; i < 5; i++) expect(classifyTask(text)).toBe(first);
  });

  it('sınıflandırıcı kullanıcı metnini LOGLAMAZ', () => {
    const src = readFileSync('src/platform/ai/orchestrator/taskClassifier.ts', 'utf8');
    expect(src).not.toMatch(/console\.|logInfo|telemetry/i);
  });
});

/* ══════════════ 8) Yapısal kilitler ══════════════ */

describe('yapısal kilitler', () => {
  const strip = (p: string) => readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('executor çekirdeği hiçbir SAĞLAYICI ADI bilmez', () => {
    const src = strip('src/platform/ai/orchestrator/orchestratedExecutor.ts');
    for (const name of ['openrouter', 'OpenRouter', 'gemini', 'Gemini', 'groq', 'Groq', 'anthropic', 'openai']) {
      expect(src, `executor '${name}' adına bağımlı`).not.toMatch(new RegExp(`\\b${name}\\b`, 'i'));
    }
  });

  it('executor prompt/cevap içeriğine dokunmaz ve loglamaz', () => {
    const src = strip('src/platform/ai/orchestrator/orchestratedExecutor.ts');
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/\.content\b/);
  });

  it('executor KARAR ALGORİTMASI üretmez (yalnız decideModel\'i çağırır)', () => {
    const src = strip('src/platform/ai/orchestrator/orchestratedExecutor.ts');
    expect(src).toMatch(/decideModel\(/);
    expect(src, 'executor kendi puanlama/sıralama mantığını kurmuş').not.toMatch(/\.sort\(|score\s*[+\-*]/);
  });

  it('orchestrator çekirdeği yürütme yapmaz (gateway çağırmaz)', () => {
    const src = strip('src/platform/ai/orchestrator/maviModelOrchestrator.ts');
    expect(src).not.toMatch(/generateResponse|await |fetch\(/);
  });
});
