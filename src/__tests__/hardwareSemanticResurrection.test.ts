/**
 * hardwareSemanticResurrection.test.ts — UÇTAN UCA SEMANTIC BLOK KİLİDİ (P0-4B).
 *
 * ── ONARILAN KUSUR (bağımsız denetim bulgusu #2) ────────────────────────────
 * Parser bloklanan girdide `needsSemantic:false` üretiyordu ama `voiceService`
 * BU ALANI HİÇ OKUMUYORDU. Sonuç: yerelde engellenen metin ("yarın arıza
 * kodlarını sil") online beyne gidiyor ve sağlayıcı `CLEAR_DTC_CODES`
 * üretebiliyordu → yerel kapı ETKİSİZDİ.
 *
 * Bu dosya HELPER değil, GERÇEK zinciri koşturur:
 *   processTextCommand → yerel parse → (semantic yönlendirme) → handler →
 *   bekleyen onay → port/native
 * ve bloklanan girdide DÖRT sıfırı ölçer:
 *   sağlayıcı çağrısı 0 · setPendingAction 0 · komut dispatch 0 · onay/başarı TTS 0
 *
 * ⚠️ YANLIŞLAMA: aynı dosyada, BLOKLANMAYAN bilinmeyen bir cümlenin sağlayıcıyı
 * GERÇEKTEN çağırdığı kilitlenir — aksi hâlde "0 çağrı" ölçümü ölü mock olurdu.
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  spoken:     [] as string[],
  brain:      vi.fn(),
  pending:    vi.fn(),
  dispatched: [] as string[],
}));

vi.mock('../platform/bridge', () => ({ isNative: false, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/performanceMode', () => ({
  getConfig: () => ({ enableRecommendations: true }),
  onPerformanceModeChange: () => () => {},
}));
vi.mock('../platform/ttsService', () => ({
  speakFeedback:  (t: string) => { M.spoken.push(t); },
  speakAssistant: (t: string) => { M.spoken.push(t); },
  speakAlert:     vi.fn(),
  ttsCancel:      vi.fn(),
  registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: (): void => {} }),
}));
vi.mock('../platform/aiVoiceService', () => ({ askAI: async () => null, resolveApiKey: () => 'k-test' }));
vi.mock('../platform/aiHealth', () => ({
  isAiNetHealthy: () => true, recordAiNetFailure: vi.fn(), recordAiNetSuccess: vi.fn(),
}));
vi.mock('../platform/ai/semanticAiService', () => ({
  classifySemantic: async () => ({}), enrichBackground: vi.fn(),
}));
vi.mock('../platform/weatherService', () => ({
  weatherQueryNamesCity: () => false,
  getWeatherNarrative: () => 'Hava açık',
  refreshWeather: async () => {},
  onWeatherState: () => () => {},
}));
vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: { get: async (k: string) => (k === 'geminiApiKey' ? 'k-test' : '') },
}));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
vi.mock('../platform/companion/companionChatProvider', () => ({
  tryCompanionBrain: (...a: unknown[]) => M.brain(...(a as [])),
  // MAVI-F1: presence okuması (yalnız ÖLÇÜM alanı — akışı etkilemez).
  currentPresenceMode: () => 'assistant' as const,
  warmupGemini: async () => {},
}));
vi.mock('../platform/action/pendingActionConfirmation', () => ({
  setPendingAction:    (...a: unknown[]) => M.pending(...(a as [])),
  peekPendingAction:   () => null,
  consumePendingAction: () => null,
  clearPendingAction:  vi.fn(),
}));

import {
  processTextCommand, registerCommandHandler, _resetVoiceServiceForTest,
} from '../platform/voiceService';
import { _resetMaviTurnsForTest } from '../platform/assistant/maviTurn';
import { _resetMaviSpeechForTest } from '../platform/assistant/maviSpeech';
import { _resetMaviVehicleContextForTest } from '../platform/assistant/maviVehicleContext';
import { evaluateVehicleAction } from '../platform/action/maviActionAuthority';
import type { VehicleContext } from '../platform/aiVoiceService';

const STOPPED: VehicleContext = {
  speedKmh: 0, drivingMode: 'idle', isDriving: false, motionState: 'stopped',
};

let unregister: (() => void) | null = null;

beforeEach(() => {
  M.spoken.length = 0;
  M.dispatched.length = 0;
  M.brain.mockReset();
  M.pending.mockReset();
  M.brain.mockResolvedValue(null);   // beyin karar veremedi → yerel zincire düşülür
  _resetVoiceServiceForTest();
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  _resetMaviVehicleContextForTest();
  /* ONLINE koşulu ZORUNLU (yanlışlama şartı): `setup.ts` navigator'ı düz bir
   * nesneyle değiştirdiği için prototipteki `onLine` KAYBOLUYOR ve tüm testlerde
   * `hasNet=false` oluyor — yani beyin hiç çağrılmıyor. Böyle bir ortamda
   * "sağlayıcı çağrısı 0" ölçümü HİÇBİR ŞEY KANITLAMAZDI. Burada açıkça
   * çevrimiçi duruma geçilir: blok kararı ONLINE koşulda sınanır. */
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  // Zincirin GERÇEKTEN kurulabilmesi için sağlayıcı seçimi (yanlışlama şartı).
  localStorage.setItem('car-launcher-storage', JSON.stringify({
    state: { settings: { aiVoiceProvider: 'gemini' } },
  }));
  unregister = registerCommandHandler((cmd) => { M.dispatched.push(cmd.type); });
});

afterEach(() => {
  unregister?.();
  unregister = null;
  localStorage.clear();
});

/** Bloklanması ZORUNLU girdiler — her biri korunan bir eylemi ZİKREDER. */
const BLOCKED_INPUTS: readonly string[] = [
  'yarın arıza kodlarını sil',
  'aracı kilitle demiştim',
  "'aracı kilitle'",
  'araç durduğunda aracı kilitle',
  'aracı kilitle iptal',
  'kornaya bas yazısını göster',
  'kapıları kilitleyebilir misin',
];

describe('P0-4B · korunan eylem bloklandığında SEMANTIC DİRİLİŞ YOK', () => {
  it('1. 🔒 bloklanan girdide sağlayıcı çağrısı = 0', async () => {
    for (const input of BLOCKED_INPUTS) {
      M.brain.mockClear();
      await processTextCommand(input, STOPPED);
      expect(`${input}:${M.brain.mock.calls.length}`).toBe(`${input}:0`);
    }
  });

  it('2. 🔒 bloklanan girdide bekleyen onay = 0 ve dispatch = 0', async () => {
    for (const input of BLOCKED_INPUTS) {
      M.pending.mockClear();
      M.dispatched.length = 0;
      await processTextCommand(input, STOPPED);
      expect(M.pending.mock.calls.length).toBe(0);
      expect(M.dispatched).toEqual([]);
    }
  });

  it('3. 🔒 bloklanan girdide onay/başarı TTS\'i üretilmez', async () => {
    for (const input of BLOCKED_INPUTS) {
      M.spoken.length = 0;
      await processTextCommand(input, STOPPED);
      const bad = M.spoken.filter((t) => /kilitlen|kilitlend|siliniyor|silindi|çalınıyor|yapıldı|tamam|onayl/i.test(t));
      expect(`${input}:${bad.join('|')}`).toBe(`${input}:`);
    }
  });

  it('4. bloklanan girdi `false` döner (terminal, sessiz başarı YOK)', async () => {
    for (const input of BLOCKED_INPUTS) {
      await expect(processTextCommand(input, STOPPED)).resolves.toBe(false);
    }
  });

  it('5. ⚠️ YANLIŞLAMA: bloklanmayan bilinmeyen cümle sağlayıcıyı GERÇEKTEN çağırır', async () => {
    M.brain.mockClear();
    await processTextCommand('bana motor sıcaklığını açıkla', STOPPED);
    expect(M.brain.mock.calls.length).toBe(1);
  });

  /* MAVI-P0-LATENCY: bu maddenin sözleşmesi DEĞİŞTİ ve GÜÇLENDİ.
   * ÖNCE: "müziği aç" da Single Brain'e gidiyor, sağlayıcı `null` dönünce
   * yerel komut uygulanıyordu → kapalı biçimli bir komut sağlayıcı bütçesini
   * (park hâlinde 8 sn'ye kadar) ödüyordu.
   * ŞİMDİ: girdinin TAMAMI canonical bir ifadeyse deterministik hızlı yol
   * açılır ve sağlayıcı HİÇ çağrılmaz. Dispatch kilidi AYNEN korunur; üstüne
   * "sağlayıcı çağrılmadı" kilidi EKLENİR. Madde 5'in yanlışlama kilidi
   * (bloklanmayan BİLİNMEYEN cümle sağlayıcıyı gerçekten çağırır) yerinde
   * durduğu için mock ölü DEĞİLDİR. */
  it('6. kapalı biçimli komut dispatch edilir ve sağlayıcı ÇAĞRILMAZ', async () => {
    M.brain.mockClear();
    M.dispatched.length = 0;
    await processTextCommand('müziği aç', STOPPED);
    expect(M.dispatched).toContain('open_music');
    expect(M.brain.mock.calls.length).toBe(0);
  });

  it('6b. kapalı biçimli OLMAYAN komut cümlesi sağlayıcıya GİDER', async () => {
    M.brain.mockClear();
    M.dispatched.length = 0;
    // Alt-dizi eşleşmesi hızlı yolu açmaz → bugünkü Single Brain yolu korunur.
    await processTextCommand('müziği aç bakalım biraz', STOPPED);
    expect(M.brain.mock.calls.length).toBe(1);
  });
});

describe('P0-4B · POZİTİF korunan komut akışı korunuyor', () => {
  it('7. doğrudan komut doğru intent ile dispatch edilir', async () => {
    M.dispatched.length = 0;
    await processTextCommand('aracı kilitle', STOPPED);
    expect(M.dispatched).toEqual(['hw_lock_doors']);
  });

  it('8. nezaket önekli komut da çalışır', async () => {
    M.dispatched.length = 0;
    await processTextCommand('lütfen kapıları kilitle', STOPPED);
    expect(M.dispatched).toEqual(['hw_lock_doors']);
  });

  it('9. dispatch anında "yapıldı" DENMEZ (sonuç-temelli ACK korunuyor)', async () => {
    M.spoken.length = 0;
    await processTextCommand('aracı kilitle', STOPPED);
    expect(M.spoken.filter((t) => /kilitlen/i.test(t))).toEqual([]);
  });

  it('10. 🔒 otorite katmanı onay OLMADAN portu çağırmaz (needs_confirmation)', () => {
    const calls: string[] = [];
    const outcome = evaluateVehicleAction({
      intent: 'HARDWARE_LOCK',
      vehicleCtx: STOPPED,
      ports: { lockDoors: () => { calls.push('port'); return true; } },
    } as unknown as Parameters<typeof evaluateVehicleAction>[0]);
    expect(outcome.allow).toBe(false);
    expect(calls).toEqual([]);
  });
});
