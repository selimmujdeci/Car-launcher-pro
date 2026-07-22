/**
 * maviModelOrchestrator.test.ts — Mavi model seçim çekirdeği (Faz 1).
 *
 * Kilitlenen davranışlar:
 *  1) Görev tipine göre strateji: sohbet/araç/kod/kısa/uzun/teknik
 *  2) Fail-closed eleme: anahtar yok · çevrimdışı · ücretli erişim · yetenek
 *  3) Sağlık/kota: engelli sağlayıcı seçilmez, art arda hata puan düşürür
 *  4) Fallback zinciri SONLU + TEKRARSIZ (sonsuz döngü imkânsız)
 *  5) Determinizm: aynı girdi → aynı çıktı; eşitlikte kararlı sıra
 *  6) SAĞLAYICI BAĞIMSIZLIĞI: çekirdek hiçbir sağlayıcı adını bilmez
 *  7) Telemetri yalnız güvenli metadata taşır
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_FALLBACK_CHAIN,
  buildDecisionTelemetry,
  createMaviModelOrchestrator,
  decideModel,
} from '../platform/ai/orchestrator/maviModelOrchestrator';
import { DEFAULT_TASK_STRATEGIES, resolveStrategy } from '../platform/ai/orchestrator/taskStrategies';
import {
  getProviderHealthMap,
  recordProviderFailure,
  recordProviderRateLimit,
  recordProviderSuccess,
  resetProviderHealth,
} from '../platform/ai/orchestrator/providerHealthStore';
import type {
  AiProviderCapability,
  MaviTaskType,
  OrchestratorContext,
} from '../platform/ai/orchestrator/orchestratorTypes';

/* ── Sahte sağlayıcılar: NÖTR adlar (gerçek marka adı YOK) ─────────────────── */

const FAST: AiProviderCapability = {
  id: 'alpha', defaultModel: 'alpha-fast',
  latencyTier: 'low', costTier: 'low', reliabilityTier: 'medium',
  supportsStreaming: true, freeTier: true,
};

const SMART: AiProviderCapability = {
  id: 'beta', defaultModel: 'beta-pro',
  modelsByTask: { code_analysis: 'beta-pro-code' },
  latencyTier: 'high', costTier: 'high', reliabilityTier: 'high',
  supportsReasoning: true, supportsLongContext: true, supportsStreaming: true,
};

const BALANCED: AiProviderCapability = {
  id: 'gamma', defaultModel: 'gamma-mid',
  latencyTier: 'medium', costTier: 'medium', reliabilityTier: 'high',
  supportsReasoning: true, supportsLongContext: true, freeTier: true,
};

const OFFLINE: AiProviderCapability = {
  id: 'delta', defaultModel: 'delta-local',
  latencyTier: 'medium', costTier: 'low', reliabilityTier: 'low',
  supportsOffline: true, freeTier: true,
};

const ALL = [FAST, SMART, BALANCED, OFFLINE];
const ALL_IDS = ALL.map((p) => p.id);

function ctx(over: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    online:               true,
    availableProviderIds: ALL_IDS,
    nowMs:                1_000_000,
    ...over,
  };
}

const decide = (task: MaviTaskType, over: Partial<OrchestratorContext> = {}, providers = ALL) =>
  decideModel({ task, providers, context: ctx(over) });

beforeEach(() => { resetProviderHealth(); });

/* ══════════════ 1) Görev tipine göre strateji ══════════════ */

describe('görev tipi stratejileri', () => {
  it('kısa cevap → EN HIZLI sağlayıcı (gecikme ağırlıklı)', () => {
    const d = decide('short_answer');
    expect(d.ok).toBe(true);
    expect(d.providerId).toBe(FAST.id);
  });

  it('genel sohbet → hız/maliyet dengesi hızlıyı seçer', () => {
    const d = decide('general_chat');
    expect(d.ok).toBe(true);
    expect(d.providerId).toBe(FAST.id);
  });

  it('araç sorusu → GÜVENİLİRLİK öne geçer (hızlı-ama-orta güvenilir seçilmez)', () => {
    const d = decide('vehicle_question');
    expect(d.ok).toBe(true);
    expect([SMART.id, BALANCED.id]).toContain(d.providerId);
  });

  it('kod analizi → uzun bağlam + akıl yürütme ZORUNLU; görev-özel model kullanılır', () => {
    const d = decide('code_analysis');
    expect(d.ok).toBe(true);
    expect([SMART.id, BALANCED.id]).toContain(d.providerId);
    if (d.providerId === SMART.id) expect(d.model).toBe('beta-pro-code');   // modelsByTask
    expect(d.rejected.some((r) => r.providerId === FAST.id && r.reason === 'capability_mismatch')).toBe(true);
  });

  it('teknik analiz → akıl yürütmesi olmayan aday ELENİR', () => {
    const d = decide('technical_analysis');
    expect(d.ok).toBe(true);
    expect(d.rejected.some((r) => r.providerId === FAST.id)).toBe(true);
  });

  it('uzun açıklama → uzun bağlam zorunlu', () => {
    const d = decide('long_explanation');
    expect(d.ok).toBe(true);
    expect([SMART.id, BALANCED.id]).toContain(d.providerId);
  });

  it('her görev tipinin varsayılan stratejisi tanımlı ve ağırlıkları geçerli', () => {
    const tasks: MaviTaskType[] = ['general_chat', 'vehicle_question', 'technical_analysis',
                                   'code_analysis', 'short_answer', 'long_explanation'];
    for (const t of tasks) {
      const s = resolveStrategy(t);
      expect(s).toBe(DEFAULT_TASK_STRATEGIES[t]);
      for (const w of [s.weightLatency, s.weightCost, s.weightReliability, s.weightReasoning, s.weightLongContext]) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it('politika ezmesi stratejiyi değiştirir (uzaktan yapılandırılabilir)', () => {
    const d = decideModel({
      task: 'short_answer',
      providers: ALL,
      context: ctx(),
      policy: {
        short_answer: {
          required: ['supportsReasoning'],       // artık akıl yürütme zorunlu
          weightLatency: 0.1, weightCost: 0.1, weightReliability: 0.8,
          weightReasoning: 0.5, weightLongContext: 0,
        },
      },
    });
    expect(d.ok).toBe(true);
    expect(d.providerId).not.toBe(FAST.id);      // hızlı ama akıl yürütmesiz → elendi
  });
});

/* ══════════════ 2) Fail-closed eleme ══════════════ */

describe('eleme kapıları — fail-closed', () => {
  it('hiç sağlayıcı yok → ok:false, no_providers', () => {
    const d = decideModel({ task: 'general_chat', providers: [], context: ctx() });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('no_providers');
    expect(d.providerId).toBe('');
    expect(d.fallbackChain).toHaveLength(0);
  });

  it('anahtarı olmayan sağlayıcı ELENİR; hiçbiri yoksa no_credentials', () => {
    const d = decide('general_chat', { availableProviderIds: [] });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('no_credentials');
    expect(d.rejected).toHaveLength(ALL.length);
  });

  it('yalnız anahtarı OLAN sağlayıcı aday olur', () => {
    const d = decide('general_chat', { availableProviderIds: [BALANCED.id] });
    expect(d.ok).toBe(true);
    expect(d.providerId).toBe(BALANCED.id);
    expect(d.reason).toBe('only_candidate');
  });

  it('çevrimdışı → yalnız supportsOffline aday kalır', () => {
    const d = decide('general_chat', { online: false });
    expect(d.ok).toBe(true);
    expect(d.providerId).toBe(OFFLINE.id);
    expect(d.reason).toBe('offline_capable');
  });

  it('çevrimdışı ve offline aday yoksa → dürüst hata', () => {
    const d = decide('general_chat', { online: false }, [FAST, SMART]);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('offline_no_offline_provider');
  });

  it('ücretli erişim yoksa → yalnız freeTier adaylar', () => {
    const d = decide('general_chat', { paidAccess: false });
    expect(d.ok).toBe(true);
    expect(d.providerId).not.toBe(SMART.id);           // SMART freeTier değil
    expect(d.rejected.some((r) => r.providerId === SMART.id && r.reason === 'paid_access_required')).toBe(true);
  });

  it('ücretli erişim yok + hiç ücretsiz aday yok → paid_access_required', () => {
    const d = decide('general_chat', { paidAccess: false }, [SMART]);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('paid_access_required');
  });

  it('yetenek uyuşmazlığı → capability_mismatch (uydurma sağlayıcı YOK)', () => {
    const d = decide('code_analysis', {}, [FAST]);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('capability_mismatch');
    expect(d.model).toBe('');
  });

  it('bozuk/eksik sağlayıcı tanımları sessizce atlanır, çekirdek THROW ETMEZ', () => {
    const junk = [null, undefined, {}, { id: '' }, { id: 'x' }] as unknown as AiProviderCapability[];
    expect(() => decideModel({ task: 'general_chat', providers: junk, context: ctx() })).not.toThrow();
    const d = decideModel({ task: 'general_chat', providers: [...junk, FAST], context: ctx() });
    expect(d.ok).toBe(true);
    expect(d.providerId).toBe(FAST.id);
  });

  it('geçersiz istek (context yok) → fail-closed, throw YOK', () => {
    const d = decideModel({ task: 'general_chat', providers: ALL } as never);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('no_providers');
  });
});

/* ══════════════ 3) Sağlık · kota · timeout ══════════════ */

describe('sağlık ve kota durumu', () => {
  it('rate limit penceresindeki sağlayıcı SEÇİLMEZ, sıradaki devralır', () => {
    const now = 1_000_000;
    recordProviderRateLimit(FAST.id, 60_000, now);
    const health = getProviderHealthMap(ALL_IDS, now);

    const d = decide('short_answer', { health, nowMs: now });
    expect(d.ok).toBe(true);
    expect(d.providerId).not.toBe(FAST.id);
    expect(d.rejected.some((r) => r.providerId === FAST.id && r.reason === 'all_blocked')).toBe(true);
  });

  it('kota penceresi DOLUNCA sağlayıcı geri gelir', () => {
    const now = 1_000_000;
    recordProviderRateLimit(FAST.id, 60_000, now);
    const later = now + 61_000;
    const health = getProviderHealthMap(ALL_IDS, later);

    const d = decide('short_answer', { health, nowMs: later });
    expect(d.providerId).toBe(FAST.id);
  });

  it('timeout geçmişi engel kurar ve kaydedilir', () => {
    const now = 1_000_000;
    recordProviderFailure(FAST.id, 'timeout', now);
    const health = getProviderHealthMap(ALL_IDS, now);

    expect(health[FAST.id]?.lastTimeoutAtMs).toBe(now);
    expect(health[FAST.id]?.blockReason).toBe('timeout');
    const d = decide('short_answer', { health, nowMs: now });
    expect(d.providerId).not.toBe(FAST.id);
  });

  it('art arda hatalar pencereyi UZATIR (tavanlı)', () => {
    const now = 1_000_000;
    recordProviderFailure(SMART.id, 'network', now);
    const first = getProviderHealthMap([SMART.id], now)[SMART.id]!.blockedUntilMs;
    recordProviderFailure(SMART.id, 'network', now);
    const second = getProviderHealthMap([SMART.id], now)[SMART.id]!.blockedUntilMs;
    expect(second).toBeGreaterThan(first);
    expect(second - now).toBeLessThanOrEqual(300_000);
  });

  it('başarı sayaçları ve engeli SIFIRLAR', () => {
    const now = 1_000_000;
    recordProviderFailure(FAST.id, 'server', now);
    recordProviderSuccess(FAST.id);
    const health = getProviderHealthMap(ALL_IDS, now);
    expect(health[FAST.id]?.consecutiveFailures).toBe(0);
    expect(health[FAST.id]?.blockedUntilMs).toBe(0);
    expect(decide('short_answer', { health, nowMs: now }).providerId).toBe(FAST.id);
  });

  it('engelli olmasa bile art arda hata PUAN DÜŞÜRÜR (sıra değişebilir)', () => {
    const now = 2_000_000;
    // Engel penceresi geçmiş ama sayaç duruyor
    recordProviderFailure(FAST.id, 'network', 1_000_000);
    const health = getProviderHealthMap(ALL_IDS, now);
    expect(health[FAST.id]?.blockedUntilMs).toBe(0);
    expect(health[FAST.id]?.consecutiveFailures).toBeGreaterThan(0);

    const withPenalty = decide('short_answer', { health, nowMs: now });
    const clean       = decide('short_answer', { nowMs: now });
    const penalized   = withPenalty.fallbackChain.find((c) => c.providerId === FAST.id);
    const original    = clean.fallbackChain.find((c) => c.providerId === FAST.id);
    expect(penalized!.score).toBeLessThan(original!.score);
  });

  it('TÜM sağlayıcılar engelliyse → dürüst hata (all_blocked)', () => {
    const now = 1_000_000;
    for (const id of ALL_IDS) recordProviderFailure(id, 'server', now);
    const health = getProviderHealthMap(ALL_IDS, now);
    const d = decide('general_chat', { health, nowMs: now });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('all_blocked');
    expect(d.fallbackChain).toHaveLength(0);
  });
});

/* ══════════════ 4) Fallback zinciri ══════════════ */

describe('fallback zinciri', () => {
  it('zincir SONLU ve TEKRARSIZ — sonsuz döngü imkânsız', () => {
    const d = decide('general_chat');
    expect(d.fallbackChain.length).toBeLessThanOrEqual(MAX_FALLBACK_CHAIN);
    const ids = d.fallbackChain.map((c) => c.providerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('zincirin BİRİNCİ elemanı seçilen adaydır', () => {
    const d = decide('general_chat');
    expect(d.fallbackChain[0]?.providerId).toBe(d.providerId);
    expect(d.fallbackChain[0]?.model).toBe(d.model);
  });

  it('zincir puana göre AZALAN sırada', () => {
    const d = decide('general_chat');
    for (let i = 1; i < d.fallbackChain.length; i++) {
      expect(d.fallbackChain[i - 1]!.score).toBeGreaterThanOrEqual(d.fallbackChain[i]!.score);
    }
  });

  it('tek sağlayıcıda zincir tek elemanlıdır', () => {
    const d = decide('general_chat', { availableProviderIds: [FAST.id] });
    expect(d.fallbackChain).toHaveLength(1);
  });

  it('her aday KENDİ modelini taşır (yanlış sağlayıcıya yabancı model gitmez)', () => {
    const d = decide('code_analysis');
    for (const c of d.fallbackChain) {
      const provider = ALL.find((p) => p.id === c.providerId)!;
      const expected = provider.modelsByTask?.code_analysis ?? provider.defaultModel;
      expect(c.model).toBe(expected);
    }
  });
});

/* ══════════════ 5) Kullanıcı tercihi ve determinizm ══════════════ */

describe('kullanıcı tercihi ve determinizm', () => {
  it('tercih edilen sağlayıcı puan avantajı alır ve gerekçe bunu söyler', () => {
    const d = decide('short_answer', { preferredProviderId: BALANCED.id });
    expect(d.providerId).toBe(BALANCED.id);
    expect(d.reason).toBe('preferred_by_user');
  });

  it('tercih GARANTİ DEĞİL: eleme kapılarını geçemeyen tercih uygulanmaz', () => {
    const d = decide('code_analysis', { preferredProviderId: FAST.id });   // FAST yetenek sağlamıyor
    expect(d.providerId).not.toBe(FAST.id);
    expect(d.ok).toBe(true);
  });

  it('tercih edilen model YALNIZ o sağlayıcı seçilince uygulanır', () => {
    const applied = decide('general_chat', { preferredProviderId: BALANCED.id, preferredModel: 'gamma-custom' });
    expect(applied.providerId).toBe(BALANCED.id);
    expect(applied.model).toBe('gamma-custom');

    const ignored = decide('general_chat', { preferredModel: 'gamma-custom' });   // sağlayıcı tercihi YOK
    expect(ignored.model).not.toBe('gamma-custom');
  });

  it('DETERMİNİSTİK: aynı girdi → aynı çıktı', () => {
    const a = decide('vehicle_question');
    const b = decide('vehicle_question');
    expect(a).toEqual(b);
  });

  it('eşit puanda sıra KARARLI (id\'ye göre), girdi sırası sonucu değiştirmez', () => {
    const twinA: AiProviderCapability = { id: 'zeta',  defaultModel: 'm', latencyTier: 'low', costTier: 'low', reliabilityTier: 'high' };
    const twinB: AiProviderCapability = { id: 'kappa', defaultModel: 'm', latencyTier: 'low', costTier: 'low', reliabilityTier: 'high' };
    const ids = [twinA.id, twinB.id];
    const forward  = decideModel({ task: 'short_answer', providers: [twinA, twinB], context: ctx({ availableProviderIds: ids }) });
    const backward = decideModel({ task: 'short_answer', providers: [twinB, twinA], context: ctx({ availableProviderIds: ids }) });
    expect(forward.providerId).toBe(backward.providerId);
    expect(forward.providerId).toBe('kappa');            // alfabetik kararlılık
  });

  it('girdi MUTASYONA UĞRAMAZ', () => {
    const providers = [FAST, SMART];
    const snapshot = JSON.stringify(providers);
    decideModel({ task: 'general_chat', providers, context: ctx() });
    expect(JSON.stringify(providers)).toBe(snapshot);
  });

  it('YETENEK DEĞİŞİMİ kararı değiştirir (aynı sağlayıcı, farklı tanım)', () => {
    const slow: AiProviderCapability = { ...FAST, latencyTier: 'high' };
    const fast = decideModel({ task: 'short_answer', providers: [FAST, BALANCED], context: ctx({ availableProviderIds: [FAST.id, BALANCED.id] }) });
    const slowed = decideModel({ task: 'short_answer', providers: [slow, BALANCED], context: ctx({ availableProviderIds: [FAST.id, BALANCED.id] }) });
    expect(fast.providerId).toBe(FAST.id);
    expect(slowed.providerId).toBe(BALANCED.id);          // yetenek düşünce sıra değişti
  });
});

/* ══════════════ 6) Telemetri ve bağımsızlık ══════════════ */

/**
 * Yapısal kilitler KODU denetler, açıklama yorumlarını değil: yorumlarda
 * "Date.now GÖMÜLÜ DEĞİLDİR" gibi ifadeler geçmesi meşrudur.
 */
function codeWithoutComments(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')     // blok yorumlar
    .replace(/(^|[^:])\/\/.*$/gm, '$1');   // satır yorumları (URL'lerdeki // hariç)
}

describe('telemetri ve sağlayıcı bağımsızlığı', () => {
  it('telemetri YALNIZ güvenli metadata taşır', () => {
    const d = decide('vehicle_question');
    const t = buildDecisionTelemetry(d, 7, 0);
    expect(Object.keys(t).sort()).toEqual(
      ['candidateCount', 'decisionMs', 'model', 'ok', 'providerId', 'taskType', 'usedFallback'].sort(),
    );
    expect(t.taskType).toBe('vehicle_question');
    expect(t.usedFallback).toBe(false);
    expect(buildDecisionTelemetry(d, 7, 1).usedFallback).toBe(true);
    const dump = JSON.stringify(t);
    for (const forbidden of ['prompt', 'message', 'content', 'apiKey', 'token', 'secret']) {
      expect(dump).not.toContain(forbidden);
    }
  });

  it('geçersiz süre telemetriye 0 olarak yazılır (uydurma ölçüm yok)', () => {
    const d = decide('general_chat');
    expect(buildDecisionTelemetry(d, Number.NaN).decisionMs).toBe(0);
    expect(buildDecisionTelemetry(d, -5).decisionMs).toBe(0);
  });

  it('sarmalayıcı DI saatle süre ölçer; saat yoksa 0 raporlar', () => {
    let t = 100;
    const withClock = createMaviModelOrchestrator({ clock: { nowMs: () => { t += 3; return t; } } });
    expect(withClock.decide({ task: 'general_chat', providers: ALL, context: ctx() }).telemetry.decisionMs).toBe(3);
    const noClock = createMaviModelOrchestrator();
    expect(noClock.decide({ task: 'general_chat', providers: ALL, context: ctx() }).telemetry.decisionMs).toBe(0);
  });

  it('YAPISAL: çekirdek hiçbir SAĞLAYICI ADI bilmez', () => {
    const files = [
      'src/platform/ai/orchestrator/maviModelOrchestrator.ts',
      'src/platform/ai/orchestrator/taskStrategies.ts',
      'src/platform/ai/orchestrator/orchestratorTypes.ts',
    ];
    for (const f of files) {
      const src = codeWithoutComments(f);
      for (const name of ['openrouter', 'OpenRouter', 'gemini', 'Gemini', 'groq', 'Groq',
                          'anthropic', 'Anthropic', 'claude', 'openai', 'OpenAI']) {
        expect(src, `${f} '${name}' adına bağımlı — sağlayıcı bağımsızlığı bozulmuş`)
          .not.toMatch(new RegExp(`['"\`]${name}|\\b${name}\\b`));
      }
    }
  });

  it('YAPISAL: çekirdek prompt/mesaj/kullanıcı verisine dokunmaz', () => {
    const src = codeWithoutComments('src/platform/ai/orchestrator/maviModelOrchestrator.ts');
    for (const forbidden of ['prompt', 'messages', 'transcript', 'userText', 'console.']) {
      expect(src, `çekirdek '${forbidden}' referansı içeriyor`).not.toContain(forbidden);
    }
  });

  it('YAPISAL: çekirdek Date.now/Math.random KULLANMAZ (determinizm)', () => {
    const src = codeWithoutComments('src/platform/ai/orchestrator/maviModelOrchestrator.ts');
    expect(src).not.toMatch(/Date\.now|Math\.random|new Date\(/);
  });
});
