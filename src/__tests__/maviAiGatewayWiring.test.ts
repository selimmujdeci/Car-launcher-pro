/**
 * maviAiGatewayWiring.test.ts — Mavi → OpenRouter gateway fallback wiring.
 *
 * Kilitlenen davranışlar:
 *  1) Gateway feature flag fallback'i kapatamaz.
 *  2) Gemini REST önce, OpenRouter gateway sonra çalışır.
 *  3) Mevcut gateway/key authority korunur; providerId yalnız OpenRouter'a sabitler.
 *  4) Devre kesici semantiği korunur: yalnız network/timeout GERÇEK ağ ölümüdür.
 *  5) Konuşma bütünlüğü: system + geçmiş (rol sırası) + kullanıcı metni aynen taşınır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ══════════════════ Companion zinciri (wiring) ══════════════════
 * NOT: bayrağın GERÇEK davranışı `aiGatewayFlag.test.ts`te doğrulanır —
 * burada mock'landığı için o dosyada mock'suz test edilir. */

const C = vi.hoisted(() => ({
  flagEnabled:  false,
  gatewayCalls: [] as Array<Record<string, unknown>>,
  gatewayReply: null as unknown,
  orchestratorEnabled: false,
  orchestratedCalls: [] as Array<Record<string, unknown>>,
  orchestratedReply: null as unknown,
  geminiCalls:  0,
  geminiReply:  null as string | null,
  /* NİHAİ SIRA (2026-09-21): gateway (OpenRouter) adayı Gemini REST'in ARKASINDA.
     Gateway'in çağrılması için REST'in düşmesi gerekir → 503 ile simüle edilir. */
  geminiStatus: 200 as number,
}));

vi.mock('../platform/ai/gateway/aiGatewayFlag', () => ({
  isAiGatewayEnabled:        () => C.flagEnabled,
  isMaviOrchestratorEnabled: () => C.orchestratorEnabled,
}));
vi.mock('../platform/ai/orchestrator/concrete/maviOrchestratedChat', () => ({
  askOrchestratedChat: async (p: Record<string, unknown>) => {
    C.orchestratedCalls.push(p);
    return {
      outcome: C.orchestratedReply ?? { ok: false, netFailure: false, errorKind: 'server' },
      telemetry: { taskType: 'general_chat' },
    };
  },
}));
vi.mock('../platform/ai/gateway/concrete/defaultAiGateway', () => ({
  getDefaultAiGateway: () => ({ generateResponse: async () => ({ ok: true, text: '', model: 'm', provider: 'p', streamed: false }) }),
}));
vi.mock('../platform/ai/gateway/gatewayChatBridge', () => ({
  askGatewayChat: async (p: Record<string, unknown>) => {
    C.gatewayCalls.push(p);
    return C.gatewayReply ?? { ok: false, netFailure: false, errorKind: 'server' };
  },
}));

// Companion'ın ağır bağımlılıkları — davranışsal olarak nötr stub'lar.
vi.mock('../store/useStore', () => ({
  useStore: { getState: () => ({ settings: { companionEnabled: true, assistantName: 'Mavi', companionPersonality: 'samimi' } }) },
}));
vi.mock('../platform/obdService', () => ({ onOBDData: () => () => {} }));
vi.mock('../platform/dtcService', () => ({ onDTCState: () => () => {} }));
vi.mock('../platform/tripLogService', () => ({ getTripSnapshot: () => ({ current: null }) }));
vi.mock('../platform/navigationService', () => ({ getNavigationState: () => ({ isNavigating: false }) }));
vi.mock('../platform/companion/companionMemory', () => ({ buildMemoryPromptSection: () => '' }));
vi.mock('../platform/webSearchService', () => ({ tavilySearch: async () => null }));
vi.mock('../platform/weatherService', () => ({
  getWeatherNarrative: () => 'henüz alınamadı',
  refreshWeather: async () => {},
  onWeatherState: () => () => {},
  weatherQueryNamesCity: () => false,
}));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/assistant/assistantSafetyKernel', () => ({
  buildSafetyContext: () => ({}),
  evaluatePreGate:    () => ({ allowOnline: true }),
  verifyResponse:     (r: string) => ({ response: r, action: 'pass' }),
}));

describe('companionChatProvider — zorunlu OpenRouter gateway fallback', () => {
  beforeEach(async () => {
    C.flagEnabled  = false;
    C.gatewayCalls = [];
    C.gatewayReply = null;
    C.orchestratorEnabled = false;
    C.orchestratedCalls = [];
    C.orchestratedReply = null;
    C.geminiCalls  = 0;
    C.geminiReply  = null;
    C.geminiStatus = 200;
    const mod = await import('../platform/companion/companionChatProvider');
    mod._resetCompanionChatForTest();
    vi.restoreAllMocks();
    // Gemini/Groq/Haiku ağ katmanı: sayaçlı sahte fetch (gateway'den bağımsız).
    vi.stubGlobal('fetch', vi.fn(async () => {
      C.geminiCalls++;
      const text = C.geminiReply ?? JSON.stringify({ type: 'chat', say: 'gemini cevabı' });
      return {
        ok: C.geminiStatus === 200, status: C.geminiStatus,
        json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
        text: async () => text,
        clone() { return this; },
      } as unknown as Response;
    }));
  });

  it('Gemini REST başarılıysa OpenRouter çağrılmaz', async () => {
    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', {
      provider: 'gemini', apiKey: 'k', hasNet: true, isDriving: false,
    });
    expect(C.gatewayCalls).toHaveLength(0);   // gateway hattı dokunulmadı
    expect(C.geminiCalls).toBeGreaterThan(0); // eski yol çalıştı
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') expect(r.route).toBe('companion_gemini');
  });

  it('BAYRAK AÇIK + Gemini REST çalışıyor → gateway HİÇ çağrılmaz (REST önce — nihai sıra)', async () => {
    C.flagEnabled  = true;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'gateway cevabı' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', {
      provider: 'gemini', apiKey: 'k', hasNet: true, isDriving: false,
    });

    expect(C.gatewayCalls).toHaveLength(0);
    expect(C.geminiCalls).toBeGreaterThan(0);
    if (r?.kind === 'chat') expect(r.route).toBe('companion_gemini');
  });

  it('BAYRAK KAPALIYKEN de Gemini REST düşerse OpenRouter denenir', async () => {
    C.flagEnabled  = false;
    C.geminiStatus = 503;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'gateway cevabı' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', {
      provider: 'gemini', apiKey: 'k', hasNet: true, isDriving: false,
    });

    expect(C.gatewayCalls).toHaveLength(1);
    expect(C.geminiCalls).toBeGreaterThan(0);  // REST önce denendi, düştü
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') {
      expect(r.response).toBe('gateway cevabı');
      expect(r.route).toBe('companion_gateway');
    }
  });

  it('gateway düşerse zincir THROW etmeden devam eder (rollback güvencesi: bayrak eski davranışı bozmaz)', async () => {
    C.flagEnabled  = true;
    C.geminiStatus = 503;
    C.gatewayReply = { ok: false, netFailure: false, errorKind: 'server' };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', {
      provider: 'gemini', apiKey: 'k', hasNet: true, isDriving: false,
    });

    expect(C.gatewayCalls).toHaveLength(1);
    expect(C.geminiCalls).toBeGreaterThan(0);
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') expect(r.route).not.toBe('companion_gateway');
  });

  it('OpenRouter adayı key değerini taşımadan gateway key authority\'sine girer', async () => {
    C.flagEnabled  = true;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'anahtarsız cevap' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', {
      hasNet: true, isDriving: false, chain: [{ provider: 'openrouter', apiKey: '' }],
    });

    expect(C.gatewayCalls).toHaveLength(1);
    if (r?.kind === 'chat') expect(r.route).toBe('companion_gateway');
  });

  it('köprü OpenRouter providerId alır ama API key değeri taşımaz', async () => {
    C.flagEnabled  = true;
    C.geminiStatus = 503;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'ok' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    await tryCompanionBrain('merhaba', { provider: 'gemini', apiKey: 'gizli-anahtar', hasNet: true });

    const call = C.gatewayCalls[0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual(
      ['gateway', 'history', 'maxTokens', 'providerId', 'system', 'temperature', 'timeoutMs', 'user'].sort(),
    );
    expect(call['providerId']).toBe('openrouter');
    expect(JSON.stringify(call)).not.toContain('gizli-anahtar');
    expect(JSON.stringify(call)).not.toMatch(/api\.anthropic|googleapis/i);
    expect(typeof call['system']).toBe('string');
    expect(call['user']).toBe('merhaba');
  });

  it('gateway ACTION kararı da taşınır (komut yolu bozulmaz)', async () => {
    C.flagEnabled  = true;
    C.gatewayReply = {
      ok: true,
      text: JSON.stringify({ type: 'action', intent: 'PLAY_MUSIC_SEARCH', query: 'sezen aksu', feedback: 'Müzik açılıyor', confidence: 0.95 }),
    };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('sezen aksu çal', {
      hasNet: true, chain: [{ provider: 'openrouter', apiKey: '' }],
    });

    expect(r?.kind).toBe('action');
    if (r?.kind === 'action') expect(r.semantic.intent).toBe('PLAY_MUSIC_SEARCH');
  });

  it('Gateway flag açık/kapalı fark etmeksizin aynı bridge çalışır', async () => {
    C.flagEnabled = true;
    C.orchestratorEnabled = false;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'gateway cevabı' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', {
      hasNet: true, chain: [{ provider: 'openrouter', apiKey: '' }],
    });

    expect(C.gatewayCalls).toHaveLength(1);       // köprü yolu
    expect(C.orchestratedCalls).toHaveLength(0);  // orkestratör HİÇ çağrılmadı
    if (r?.kind === 'chat') expect(r.route).toBe('companion_gateway');
  });

  it('Orchestrator flag OpenRouter fallback authority\'sini değiştirmez', async () => {
    C.flagEnabled = true;
    C.orchestratorEnabled = true;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'gateway cevabı' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('motor sıcaklığı kaç', {
      hasNet: true, chain: [{ provider: 'openrouter', apiKey: '' }],
    });

    expect(C.orchestratedCalls).toHaveLength(0);
    expect(C.gatewayCalls).toHaveLength(1);
    expect(C.geminiCalls).toBe(0);
    if (r?.kind === 'chat') {
      expect(r.response).toBe('gateway cevabı');
      expect(r.route).toBe('companion_gateway');
    }
  });

  it('OpenRouter çağrısı anahtar değerini bridge parametrelerine sızdırmaz', async () => {
    C.flagEnabled = true;
    C.orchestratorEnabled = true;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'ok' }) };
    C.geminiStatus = 503;

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    await tryCompanionBrain('merhaba', { provider: 'gemini', apiKey: 'gizli-anahtar', hasNet: true });

    const call = C.gatewayCalls[0] as Record<string, unknown>;
    expect(call['user']).toBe('merhaba');
    expect(JSON.stringify(call)).not.toContain('gizli-anahtar');
  });

  it('OpenRouter düşerse zincir THROW etmeden offline/sonraki adaya devam eder', async () => {
    C.flagEnabled = true;
    C.orchestratorEnabled = true;
    C.geminiStatus = 503;
    C.gatewayReply = { ok: false, netFailure: false, errorKind: 'unknown' };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', { provider: 'gemini', apiKey: 'k', hasNet: true });

    expect(C.gatewayCalls).toHaveLength(1);
    expect(C.geminiCalls).toBeGreaterThan(0);     // REST önce denendi
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') expect(r.route).not.toBe('companion_gateway');
  });

  it('sohbet geçmişi gateway turunda da birikir (conversation korunur)', async () => {
    C.flagEnabled  = true;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'ilk cevap' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const onlyOpenRouter = { hasNet: true, chain: [{ provider: 'openrouter' as const, apiKey: '' }] };
    await tryCompanionBrain('ilk soru', onlyOpenRouter);
    await tryCompanionBrain('ikinci soru', onlyOpenRouter);

    const second = C.gatewayCalls[1] as { history: Array<{ role: string; content: string }> };
    expect(second.history).toEqual([
      { role: 'user',      content: 'ilk soru' },
      { role: 'assistant', content: 'ilk cevap' },
    ]);
  });
});
