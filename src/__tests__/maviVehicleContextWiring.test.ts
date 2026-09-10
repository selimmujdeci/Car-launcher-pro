/**
 * maviVehicleContextWiring.test.ts — MAVI-M2 · ÇAĞRI ZİNCİRİ KİLİDİ.
 *
 * M1 bulgu #1: üretimdeki ÜÇ canlı giriş (native STT · Web Speech · UI metin/hızlı
 * komut) `processTextCommand`'a bağlam TAŞIMIYORDU. M2 çözümü bağlamı çağrı
 * yerlerine değil **tek komut otoritesinin İÇİNE** koydu: `processTextCommand`
 * bağlamı komut başında BİR KEZ çözer. Bu, üç girişi de kapsar ve YENİ bir çağıran
 * eklense bile "araç park halinde" varsayımına düşmeyi YAPISAL olarak imkânsız kılar.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Bağlam taşımayan çağrı (native STT/Web Speech/UI metin — hepsi `ctx` vermez)
 *     gerçek resolver bağlamını kullanır; aşağı akış (offline sohbet · beyin) o
 *     bağlamı görür.
 *  2. Kaynak yoksa `unknown` üretilir — "parked" DEĞİL.
 *  3. Hız bilinmiyorsa aşağı akışa SIFIR gönderilmez (alan taşınmaz).
 *  4. Bağlam komut başına TEK kez okunur ve tur boyunca DEĞİŞMEZ; komut sürerken
 *     store değişse bile o turun kararı kaymaz. Yeni komut YENİ snapshot alır.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  parseResult: { command: null, suggestions: [], needsSemantic: false } as {
    command: unknown; suggestions: unknown[]; needsSemantic: boolean;
  },
  offlineCalls: [] as Array<{ raw: string; isDriving: unknown; speedKmh: unknown }>,
}));

vi.mock('../platform/bridge', () => ({ isNative: false, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/commandParser', () => ({ parseCommandFull: () => M.parseResult, matchDeterministicWholeInput: () => null }));
vi.mock('../platform/offlineConversationEngine', () => ({
  // voiceService bu fonksiyona ctx.isDriving + ctx.speedKmh iletir → bağlamın
  // aşağı akışa GERÇEKTEN taşındığının doğrudan gözlem noktası.
  tryOfflineConversation: (raw: string, isDriving?: unknown, speedKmh?: unknown) => {
    M.offlineCalls.push({ raw, isDriving, speedKmh });
    return { handled: true, response: 'tamam' };
  },
}));
vi.mock('../platform/performanceMode', () => ({ getConfig: () => ({ enableRecommendations: true }) }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: vi.fn(),
  speakAssistant: vi.fn(),
  speakAlert: vi.fn(),
  ttsCancel: vi.fn(),
  registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: (): void => {} }),
}));
vi.mock('../platform/aiVoiceService', () => ({ askAI: async () => null, resolveApiKey: () => '' }));
vi.mock('../platform/ai/semanticAiService', () => ({
  classifySemantic: async () => ({ source: 'offline', confidence: 0, feedback: '' }),
  enrichBackground: vi.fn(),
}));
vi.mock('../platform/intentEngine', () => ({ fromSemanticResult: () => null }));
vi.mock('../platform/voiceInfoService', () => ({
  isInformationalCommand: () => false,
  answerInformational: vi.fn(),
}));
vi.mock('../platform/weatherService', () => ({ weatherQueryNamesCity: () => false }));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => '' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));

import { processTextCommand, _resetVoiceServiceForTest } from '../platform/voiceService';
import {
  setMaviVehicleSnapshotSource,
  _resetMaviVehicleContextForTest,
  type MaviVehicleSnapshot,
} from '../platform/assistant/maviVehicleContext';

function snap(over: Partial<MaviVehicleSnapshot> = {}): MaviVehicleSnapshot {
  return {
    obdSpeedFreshKmh: null,
    obdConnected:     true,
    obdLastSeenMs:    Date.now() - 200,
    obdFreshWindowMs: 3_000,
    gpsSpeedMps:      null,
    gpsAccuracyM:     null,
    gpsFixAtMs:       null,
    reverseSignal:    false,
    ignition:         'unknown',
    ...over,
  };
}

beforeEach(() => {
  _resetVoiceServiceForTest();
  _resetMaviVehicleContextForTest();
  M.parseResult = { command: null, suggestions: [], needsSemantic: false };
  M.offlineCalls = [];
  localStorage.removeItem('car-launcher-storage');
});

afterEach(() => {
  _resetMaviVehicleContextForTest();
  _resetVoiceServiceForTest();
});

describe('MAVI-M2 · üç canlı girişin bağlam zinciri', () => {
  it('10/11/12. bağlam TAŞIMAYAN çağrı (STT · Web Speech · UI metin) gerçek resolver bağlamını kullanır', async () => {
    setMaviVehicleSnapshotSource(() => snap({ obdSpeedFreshKmh: 75 }));
    // Üç üretim girişi de `processTextCommand(text)` biçiminde, ctx VERMEDEN çağırır.
    await processTextCommand('merhaba');
    expect(M.offlineCalls).toHaveLength(1);
    expect(M.offlineCalls[0].isDriving).toBe(true);     // eskiden DAİMA undefined/false idi
    expect(M.offlineCalls[0].speedKmh).toBe(75);
  });

  it('doğrulanmış park → isDriving=false + gerçek hız taşınır', async () => {
    setMaviVehicleSnapshotSource(() => snap({ obdSpeedFreshKmh: 0 }));
    await processTextCommand('merhaba');
    expect(M.offlineCalls[0].isDriving).toBe(false);
    expect(M.offlineCalls[0].speedKmh).toBe(0);
  });

  it('13. bağlam kaynağı YOKSA parked default ÜRETİLMEZ; hız SIFIR olarak taşınmaz', async () => {
    // Kaynak kayıtlı değil → unknown bağlam.
    await processTextCommand('merhaba');
    expect(M.offlineCalls).toHaveLength(1);
    expect(M.offlineCalls[0].isDriving).toBe(false);      // doğrulanmış hareket yok
    expect(M.offlineCalls[0].speedKmh).toBeUndefined();   // ⚠ 0 DEĞİL — "bilinmiyor"
  });

  it('kaynak THROW etse bile komut akışı KIRILMAZ (fail-soft) ve hız uydurulmaz', async () => {
    setMaviVehicleSnapshotSource(() => { throw new Error('OBD düştü'); });
    await expect(processTextCommand('merhaba')).resolves.toBe(true);
    expect(M.offlineCalls[0].speedKmh).toBeUndefined();
  });

  it('açık `ctx` (test fixture) enjeksiyonu resolver\'ı EZER — kaynak okunmaz', async () => {
    const source = vi.fn(() => snap({ obdSpeedFreshKmh: 90 }));
    setMaviVehicleSnapshotSource(source);
    await processTextCommand('merhaba', { speedKmh: 5, drivingMode: 'normal', isDriving: true });
    expect(source).not.toHaveBeenCalled();
    expect(M.offlineCalls[0].speedKmh).toBe(5);
  });
});

describe('MAVI-M2 · guard — üretim çağıranları elle bağlam UYDURAMAZ', () => {
  it('19b. hiçbir üretim çağıranı `processTextCommand`\'a elle yapılmış bağlam literali geçmez', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, relative, sep } = await import('node:path');
    const SRC = join(process.cwd(), 'src');

    const files: string[] = [];
    (function walk(dir: string): void {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) { if (e !== '__tests__') walk(full); }
        else if (/\.tsx?$/.test(e)) files.push(full);
      }
    })(SRC);

    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // `processTextCommand(x, { ... isDriving ... })` → elle kurulmuş bağlam = yasak.
      if (/processTextCommand\([^)]*\{[^}]*isDriving/.test(src)) {
        offenders.push(relative(SRC, f).split(sep).join('/'));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('MAVI-M2 · request boyunca değişmezlik', () => {
  it('bağlam komut başına TEK kez okunur (aynı turda ikinci snapshot alınmaz)', async () => {
    const source = vi.fn(() => snap({ obdSpeedFreshKmh: 30 }));
    setMaviVehicleSnapshotSource(source);
    await processTextCommand('merhaba');
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('komut SÜRERKEN store değişse bile o turun kararı KAYMAZ; yeni komut YENİ snapshot alır', async () => {
    let live = 0;
    const source = vi.fn(() => snap({ obdSpeedFreshKmh: live }));
    setMaviVehicleSnapshotSource(source);

    const first = processTextCommand('merhaba');
    live = 120;                       // tur sürerken araç hareket etti
    await first;
    expect(M.offlineCalls[0].isDriving).toBe(false);   // 1. turun kararı SABİT (park)
    expect(M.offlineCalls[0].speedKmh).toBe(0);

    await processTextCommand('selam');
    expect(source).toHaveBeenCalledTimes(2);
    expect(M.offlineCalls[1].isDriving).toBe(true);    // 2. tur TAZE snapshot aldı
    expect(M.offlineCalls[1].speedKmh).toBe(120);
  });
});
