/**
 * maviMemoryWiring.test.ts — Memory Faz 2: mevcut depoların companion akışına
 * bağlanması.
 *
 * Kilitlenen davranışlar:
 *  1) YENİ DEPO YOK — canlı `VehicleMemoryStore` paylaşılır, ikincisi kurulmaz
 *  2) Fingerprint YALNIZ `supported` iken kullanılır; ham VIN taşınmaz
 *  3) Otorite eksikse (runtime kapalı / fingerprint yok) geçmiş BOŞ (fail-closed)
 *  4) Kısa dönem: yalnız AKSİYON sonucu yazılır, konuşma metni DEĞİL
 *  5) İzin/şalter kapalıyken kısa döneme HİÇ yazılmaz (kullanamayacağımızı toplamayız)
 *  6) Hafıza yazımı asistan akışını ETKİLEMEZ (fail-soft)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const W = vi.hoisted(() => ({
  liveStore:   null as null | { recall: (fp: string) => Array<{ statement: string; confidence: number; lastSeen: number }> },
  identity:    null as null | { supported: boolean; fingerprintHash?: string },
  recallCalls: [] as string[],
}));

vi.mock('../platform/system/platformCoreAiRuntimeWiring', () => ({
  getLiveVehicleMemoryStore: () => W.liveStore,
}));
vi.mock('../platform/vehicleHal', () => ({
  vehicleHal: { getVehicleIdentity: () => W.identity },
}));

import { createMaviMemorySources } from '../platform/ai/memory/concrete/maviMemorySources';
import { clearShortTermMemory, getShortTermMemory } from '../platform/ai/memory/shortTermMemory';

beforeEach(() => {
  W.liveStore = {
    recall: (fp: string) => {
      W.recallCalls.push(fp);
      return [{ statement: 'Mode09 desteklenmiyor', confidence: 0.8, lastSeen: 1 }];
    },
  };
  W.identity = { supported: true, fingerprintHash: 'fp-hash-123' };
  W.recallCalls = [];
  clearShortTermMemory();
});

/* ══════════════ 1) Canlı depo bağlaması ══════════════ */

describe('araç geçmişi — CANLI depo bağlaması', () => {
  it('canlı depo + fingerprint varsa geçmiş OKUNUR', () => {
    const sources = createMaviMemorySources();
    expect(sources.readVehicleHistory?.()).toEqual([
      { statement: 'Mode09 desteklenmiyor', confidence: 0.8, lastSeen: 1 },
    ]);
    expect(W.recallCalls).toEqual(['fp-hash-123']);
  });

  it('runtime KAPALIYSA (depo yok) → BOŞ, throw YOK', () => {
    W.liveStore = null;
    expect(createMaviMemorySources().readVehicleHistory?.()).toEqual([]);
  });

  it('fingerprint DESTEKLENMİYORSA kullanılmaz → BOŞ', () => {
    W.identity = { supported: false, fingerprintHash: 'fp-hash-123' };
    expect(createMaviMemorySources().readVehicleHistory?.()).toEqual([]);
    expect(W.recallCalls).toHaveLength(0);        // depo hiç sorgulanmadı
  });

  it('fingerprint boş/eksikse → BOŞ (uydurma yok)', () => {
    W.identity = { supported: true };
    expect(createMaviMemorySources().readVehicleHistory?.()).toEqual([]);
    W.identity = null;
    expect(createMaviMemorySources().readVehicleHistory?.()).toEqual([]);
  });

  it('HAL veya depo patlarsa fail-soft BOŞ döner', () => {
    W.liveStore = { recall: () => { throw new Error('depo bozuk'); } };
    expect(() => createMaviMemorySources().readVehicleHistory?.()).not.toThrow();
    expect(createMaviMemorySources().readVehicleHistory?.()).toEqual([]);
  });

  it('DI ile ezilebilir (test/izolasyon)', () => {
    const sources = createMaviMemorySources({
      vehicleFingerprint: () => 'özel-fp',
      vehicleHistory: { recall: () => [{ statement: 'özel bilgi', confidence: 0.9, lastSeen: 2 }] },
    });
    expect(sources.readVehicleHistory?.()[0]?.statement).toBe('özel bilgi');
    expect(W.recallCalls).toHaveLength(0);        // canlı depo KULLANILMADI
  });

  it('kullanıcı tercihleri mevcut otoriteden okunur', () => {
    expect(createMaviMemorySources().readUserPreferences?.()).toEqual(['Kahve severim']);
  });
});

/* ══════════════ 2) Yapısal kilitler ══════════════ */

describe('YENİ DEPO YOK — yapısal kilitler', () => {
  const code = (p: string): string => readFileSync(p, 'utf8')
    .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
    .replace(new RegExp('(^|[^:])//.*$', 'gm'), '$1');

  it('bağlama İKİNCİ bir VehicleMemoryStore KURMAZ', () => {
    const src = code('src/platform/ai/memory/concrete/maviMemorySources.ts');
    expect(src, 'yeni depo örneği oluşturulmuş').not.toMatch(/createVehicleMemoryStore/);
    expect(src).toMatch(/getLiveVehicleMemoryStore/);      // paylaşımlı referans
  });

  it('bağlama yazma yollarına DOKUNMAZ (salt-okunur)', () => {
    const src = code('src/platform/ai/memory/concrete/maviMemorySources.ts');
    for (const write of ['addFact', 'forgetFact', 'clearFacts', 'remember(', 'rememberShortTerm']) {
      expect(src, `bağlama '${write}' çağırıyor`).not.toContain(write);
    }
  });

  it('runtime wiring canlı referansı cleanup\'ta BIRAKMAZ (zero-leak)', () => {
    const src = code('src/platform/system/platformCoreAiRuntimeWiring.ts');
    expect(src).toMatch(/_liveVehicleMemory = memory/);
    expect(src).toMatch(/_liveVehicleMemory = null/);
  });

  it('ham VIN taşınmaz — yalnız fingerprint hash', () => {
    const src = code('src/platform/ai/memory/concrete/maviMemorySources.ts');
    expect(src).not.toMatch(/\bvin\b/i);
    expect(src).toMatch(/supported !== true/);             // desteklenmeyen kimlik kullanılmaz
  });
});

/* ══════════════ 3) Kısa dönem: companion aksiyon kancası ══════════════ */

const C = vi.hoisted(() => ({ memoryEnabled: false, consent: 'off' as string }));

vi.mock('../platform/ai/gateway/aiGatewayFlag', () => ({
  isAiGatewayEnabled:        () => false,
  isMaviOrchestratorEnabled: () => false,
  isMaviMemoryEnabled:       () => C.memoryEnabled,
  getMaviMemoryConsent:      () => C.consent,
}));
vi.mock('../store/useStore', () => ({
  useStore: { getState: () => ({ settings: { companionEnabled: true, assistantName: 'Mavi', companionPersonality: 'samimi' } }) },
}));
vi.mock('../platform/obdService', () => ({ onOBDData: () => () => {} }));
vi.mock('../platform/dtcService', () => ({ onDTCState: () => () => {} }));
vi.mock('../platform/tripLogService', () => ({ getTripSnapshot: () => ({ current: null }) }));
vi.mock('../platform/navigationService', () => ({ getNavigationState: () => ({ isNavigating: false }) }));
vi.mock('../platform/companion/companionMemory', () => ({
  buildMemoryPromptSection: () => '',
  getFacts: () => [{ id: 'a', text: 'Kahve severim' }],
}));
vi.mock('../platform/webSearchService', () => ({ tavilySearch: async () => null }));
vi.mock('../platform/weatherService', () => ({
  getWeatherNarrative: () => 'henüz alınamadı', refreshWeather: async () => {},
  onWeatherState: () => () => {}, weatherQueryNamesCity: () => false,
}));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/assistant/assistantSafetyKernel', () => ({
  buildSafetyContext: () => ({}), evaluatePreGate: () => ({ allowOnline: true }),
  verifyResponse: (r: string) => ({ response: r, action: 'pass' }),
}));

/** Beyin ACTION kararı döndüren sahte sağlayıcı yanıtı. */
function stubBrainFetch(payload: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    const text = JSON.stringify(payload);
    return {
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
      text: async () => text,
    } as unknown as Response;
  }));
}

describe('kısa dönem hafıza — companion aksiyon kancası', () => {
  beforeEach(async () => {
    C.memoryEnabled = false;
    C.consent = 'off';
    clearShortTermMemory();
    const mod = await import('../platform/companion/companionChatProvider');
    mod._resetCompanionChatForTest();
  });

  it('izin/şalter KAPALIYKEN kısa döneme HİÇ yazılmaz', async () => {
    stubBrainFetch({ type: 'action', intent: 'OPEN_MUSIC', feedback: 'Müzik açılıyor', confidence: 0.95 });
    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    await tryCompanionBrain('müziği aç', { provider: 'gemini', apiKey: 'k', hasNet: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(getShortTermMemory()).toHaveLength(0);
  });

  it('izin VARKEN yalnız AKSİYON sonucu yazılır', async () => {
    C.memoryEnabled = true;
    C.consent = 'memory';
    stubBrainFetch({ type: 'action', intent: 'OPEN_MUSIC', feedback: 'Müzik açılıyor', confidence: 0.95 });

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('müziği aç', { provider: 'gemini', apiKey: 'k', hasNet: true });
    await new Promise((res) => setTimeout(res, 0));

    expect(r?.kind).toBe('action');
    const list = getShortTermMemory();
    expect(list).toHaveLength(1);
    expect(list[0]!.text).toBe('Müzik açılıyor');
    expect(list[0]!.origin).toBe('session');
  });

  it('SOHBET cevabı kısa döneme YAZILMAZ (konuşma zaten history\'de)', async () => {
    C.memoryEnabled = true;
    C.consent = 'memory';
    stubBrainFetch({ type: 'chat', say: 'Bugün hava güzel' });

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('nasılsın', { provider: 'gemini', apiKey: 'k', hasNet: true });
    await new Promise((res) => setTimeout(res, 0));

    expect(r?.kind).toBe('chat');
    expect(getShortTermMemory()).toHaveLength(0);      // ÇOĞALTMA YOK
  });

  it('kullanıcı METNİ hafızaya girmez (yalnız Mavi\'nin yaptığı iş)', async () => {
    C.memoryEnabled = true;
    C.consent = 'memory';
    stubBrainFetch({ type: 'action', intent: 'OPEN_MUSIC', feedback: 'Müzik açılıyor', confidence: 0.95 });

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    await tryCompanionBrain('GİZLİ KULLANICI CÜMLESİ', { provider: 'gemini', apiKey: 'k', hasNet: true });
    await new Promise((res) => setTimeout(res, 0));

    expect(JSON.stringify(getShortTermMemory())).not.toContain('GİZLİ KULLANICI CÜMLESİ');
  });

  it('hafıza yazımı asistan akışını ETKİLEMEZ (fail-soft)', async () => {
    C.memoryEnabled = true;
    C.consent = 'memory';
    // Hassas feedback → kapı reddeder ama akış sürer
    stubBrainFetch({ type: 'action', intent: 'OPEN_PHONE', feedback: 'Numara 0532 111 22 33 aranıyor', confidence: 0.95 });

    const { tryCompanionBrain } = await import('../platform/companion/companionChatProvider');
    const r = await tryCompanionBrain('ara', { provider: 'gemini', apiKey: 'k', hasNet: true });
    await new Promise((res) => setTimeout(res, 0));

    expect(r?.kind).toBe('action');                    // asistan normal çalıştı
    expect(getShortTermMemory()).toHaveLength(0);      // hassas kayıt REDDEDİLDİ
  });
});
