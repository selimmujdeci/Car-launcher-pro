/**
 * maviAiGatewayWiring.test.ts — Mavi → AI Gateway hattı (flag'li wiring).
 *
 * Kilitlenen davranışlar:
 *  1) BAYRAK KAPALI (VARSAYILAN) → gateway hattı HİÇ dokunmaz: bridge çağrılmaz,
 *     gateway modülü yüklenmez, zincir birebir eski sağlayıcı sırasıdır.
 *  2) BAYRAK AÇIK → gateway zincirin BAŞINDA denenir; başarısızsa eski adaylar
 *     (Gemini/Groq/Haiku) yedek olarak AYNEN çalışmaya devam eder (rollback).
 *  3) Sağlayıcı-bağımsızlık: köprü yalnız `AiGateway` soyutlamasını kullanır;
 *     OpenRouter/HTTP/anahtar detayı geçmez.
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

describe('companionChatProvider — gateway adayı (flag arkasında)', () => {
  beforeEach(async () => {
    C.flagEnabled  = false;
    C.gatewayCalls = [];
    C.gatewayReply = null;
    C.orchestratorEnabled = false;
    C.orchestratedCalls = [];
    C.orchestratedReply = null;
    C.geminiCalls  = 0;
    C.geminiReply  = null;
    const mod = await import('../platform/companion/companionChatProvider');
    mod._resetCompanionChatForTest();
    vi.restoreAllMocks();
    // Gemini/Groq/Haiku ağ katmanı: sayaçlı sahte fetch (gateway'den bağımsız).
    vi.stubGlobal('fetch', vi.fn(async () => {
      C.geminiCalls++;
      const text = C.geminiReply ?? JSON.stringify({ type: 'chat', say: 'gemini cevabı' });
      return {
        ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
        text: async () => text,
      } as unknown as Response;
    }));
  });

  it('BAYRAK KAPALI → gateway köprüsü HİÇ çağrılmaz, eski sağlayıcı çalışır', async () => {
    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', {
      provider: 'gemini', apiKey: 'k', hasNet: true, isDriving: false,
    });
    expect(C.gatewayCalls).toHaveLength(0);   // gateway hattı dokunulmadı
    expect(C.geminiCalls).toBeGreaterThan(0); // eski yol çalıştı
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') expect(r.route).toBe('companion_gemini');
  });

  it('BAYRAK AÇIK → gateway ÖNCE denenir ve cevabı companion_gateway rotasıyla döner', async () => {
    C.flagEnabled  = true;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'gateway cevabı' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', {
      provider: 'gemini', apiKey: 'k', hasNet: true, isDriving: false,
    });

    expect(C.gatewayCalls).toHaveLength(1);
    expect(C.geminiCalls).toBe(0);            // gateway kazandı → eski yol hiç denenmedi
    expect(r?.kind).toBe('chat');
    if (r?.kind === 'chat') {
      expect(r.response).toBe('gateway cevabı');
      expect(r.route).toBe('companion_gateway');
    }
  });

  it('gateway düşerse ESKİ ZİNCİR yedek olarak devam eder (rollback güvencesi)', async () => {
    C.flagEnabled  = true;
    C.gatewayReply = { ok: false, netFailure: false, errorKind: 'server' };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', {
      provider: 'gemini', apiKey: 'k', hasNet: true, isDriving: false,
    });

    expect(C.gatewayCalls).toHaveLength(1);
    expect(C.geminiCalls).toBeGreaterThan(0); // Gemini yedeği çalıştı
    if (r?.kind === 'chat') expect(r.route).toBe('companion_gemini');
  });

  it('anahtar YOKKEN bile gateway zincire girer (BYOK kendi içinde)', async () => {
    C.flagEnabled  = true;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'anahtarsız cevap' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', { hasNet: true, isDriving: false }); // provider/apiKey YOK

    expect(C.gatewayCalls).toHaveLength(1);
    if (r?.kind === 'chat') expect(r.route).toBe('companion_gateway');
  });

  it('köprüye SAĞLAYICI DETAYI geçmez — yalnız prompt/geçmiş/metin', async () => {
    C.flagEnabled  = true;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'ok' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    await tryCompanionBrain('merhaba', { provider: 'gemini', apiKey: 'gizli-anahtar', hasNet: true });

    const call = C.gatewayCalls[0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual(
      ['gateway', 'history', 'maxTokens', 'system', 'temperature', 'timeoutMs', 'user'].sort(),
    );
    expect(JSON.stringify(call)).not.toContain('gizli-anahtar');
    expect(JSON.stringify(call)).not.toMatch(/openrouter|api\.anthropic|googleapis/i);
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
    const r = await tryCompanionBrain('sezen aksu çal', { hasNet: true });

    expect(r?.kind).toBe('action');
    if (r?.kind === 'action') expect(r.semantic.intent).toBe('PLAY_MUSIC_SEARCH');
  });

  /* ── Faz 2: orchestrator ALT TERCİHİ ── */

  it('Gateway AÇIK · Orchestrator KAPALI → mevcut tek-sağlayıcı gateway davranışı', async () => {
    C.flagEnabled = true;
    C.orchestratorEnabled = false;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'gateway cevabı' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', { hasNet: true });

    expect(C.gatewayCalls).toHaveLength(1);       // köprü yolu
    expect(C.orchestratedCalls).toHaveLength(0);  // orkestratör HİÇ çağrılmadı
    if (r?.kind === 'chat') expect(r.route).toBe('companion_gateway');
  });

  it('Gateway AÇIK · Orchestrator AÇIK → orkestre edilmiş yürütücü kullanılır', async () => {
    C.flagEnabled = true;
    C.orchestratorEnabled = true;
    C.orchestratedReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'orkestre cevabı' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('motor sıcaklığı kaç', { hasNet: true });

    expect(C.orchestratedCalls).toHaveLength(1);
    expect(C.gatewayCalls).toHaveLength(0);       // köprü yolu ATLANDI
    expect(C.geminiCalls).toBe(0);
    if (r?.kind === 'chat') {
      expect(r.response).toBe('orkestre cevabı');
      expect(r.route).toBe('companion_gateway');  // rota DEĞİŞMEDİ (geriye uyum)
    }
  });

  it('orkestratöre sınıflandırma metni geçer ama SAĞLAYICI/ANAHTAR detayı geçmez', async () => {
    C.flagEnabled = true;
    C.orchestratorEnabled = true;
    C.orchestratedReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'ok' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    await tryCompanionBrain('merhaba', { provider: 'gemini', apiKey: 'gizli-anahtar', hasNet: true });

    const call = C.orchestratedCalls[0] as Record<string, unknown>;
    expect(call['classifyText']).toBe('merhaba');
    expect(JSON.stringify(call)).not.toContain('gizli-anahtar');
  });

  it('orkestratör düşerse ESKİ ZİNCİR yedek olarak devam eder', async () => {
    C.flagEnabled = true;
    C.orchestratorEnabled = true;
    C.orchestratedReply = { ok: false, netFailure: false, errorKind: 'unknown' };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('merhaba', { provider: 'gemini', apiKey: 'k', hasNet: true });

    expect(C.orchestratedCalls).toHaveLength(1);
    expect(C.geminiCalls).toBeGreaterThan(0);     // Gemini yedeği çalıştı
    if (r?.kind === 'chat') expect(r.route).toBe('companion_gemini');
  });

  it('sohbet geçmişi gateway turunda da birikir (conversation korunur)', async () => {
    C.flagEnabled  = true;
    C.gatewayReply = { ok: true, text: JSON.stringify({ type: 'chat', say: 'ilk cevap' }) };

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    await tryCompanionBrain('ilk soru', { hasNet: true });
    await tryCompanionBrain('ikinci soru', { hasNet: true });

    const second = C.gatewayCalls[1] as { history: Array<{ role: string; content: string }> };
    expect(second.history).toEqual([
      { role: 'user',      content: 'ilk soru' },
      { role: 'assistant', content: 'ilk cevap' },
    ]);
  });
});
