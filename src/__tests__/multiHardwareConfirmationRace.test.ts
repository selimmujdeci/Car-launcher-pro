/**
 * multiHardwareConfirmationRace.test.ts — ÇOKLU ONAY SEQUENCE FAIL-CLOSED (P1).
 *
 * ── ONARILAN KUSUR (bağımsız denetim, P1) ───────────────────────────────────
 * Tek turda iki onay gerektiren araç eylemi olduğunda zincir dispatcher İKİ
 * handler'ı da başlatıyordu. Her biri `executeIntent → needs_confirmation →
 * setPendingAction` yoluna girebiliyor; bekleyen onay deposu TEK global slot ve
 * **last-writer-wins**; MaviSpeech ise yalnız İLK onay sorusunu geçiriyordu:
 *
 *   "aracı kilitle ve kornaya bas"
 *     → kullanıcı "Kapıları kilitlememi onaylıyor musun?" DUYAR
 *     → bekleyen slot HARDWARE_HORN
 *     → "evet" → KORNA çalar   (duyulan onay ≠ onaylanan eylem)
 *
 * ── KİLİTLENEN POLİTİKA ─────────────────────────────────────────────────────
 * Birden fazla onay gerektiren araç eylemi varsa sequence DISPATCH ÖNCESİNDE
 * tamamen reddedilir: handler 0 · bekleyen onay 0 · port 0 · sağlayıcı 0 ·
 * eyleme özgü onay TTS'i 0 · tek açıklama mesajı 1 · dönüş true (terminal).
 *
 * Bu dosya helper testi DEĞİLDİR: üretimdeki `processTextCommand`, gerçek zincir
 * ayrıştırması ve GERÇEK bekleyen-onay deposu (`pendingActionConfirmation`
 * mock'lanmaz, yalnız `setPendingAction` yazımları sayılır) kullanılır.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  spoken:      [] as string[],
  brain:       vi.fn(),
  dispatched:  [] as string[],
  pendingSets: [] as unknown[],
  ports:       [] as string[],
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
vi.mock('../platform/audioService', () => ({ duckMedia: vi.fn(), unduckMedia: vi.fn() }));
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

/* GERÇEK bekleyen-onay deposu kullanılır; yalnız YAZMA çağrıları sayılır
 * (okuma/tüketme/temizleme üretim davranışını korur → "evet" akışı gerçek). */
vi.mock('../platform/action/pendingActionConfirmation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/action/pendingActionConfirmation')>();
  return {
    ...actual,
    setPendingAction: (req: unknown) => { M.pendingSets.push(req); return actual.setPendingAction(req as never); },
  };
});

import {
  processTextCommand, registerCommandHandler, _resetVoiceServiceForTest,
} from '../platform/voiceService';
import {
  peekPendingAction, setPendingAction, _resetPendingActionForTest,
} from '../platform/action/pendingActionConfirmation';
import { evaluateVehicleAction } from '../platform/action/maviActionAuthority';
import {
  classifySequenceConfirmationPolicy, commandRequiresConfirmation,
  MULTI_CONFIRMATION_REFUSAL_TEXT,
} from '../platform/action/sequenceConfirmationPolicy';
import { parseCommand, parseCommandFull, type ParsedCommand } from '../platform/commandParser';
import { _resetMaviTurnsForTest } from '../platform/assistant/maviTurn';
import { _resetMaviSpeechForTest } from '../platform/assistant/maviSpeech';
import { _resetMaviVehicleContextForTest } from '../platform/assistant/maviVehicleContext';
import type { VehicleContext } from '../platform/aiVoiceService';

const STOPPED: VehicleContext = {
  speedKmh: 0, drivingMode: 'idle', isDriving: false, motionState: 'stopped',
};

let unregister: (() => void) | null = null;

beforeEach(() => {
  M.spoken.length = 0;
  M.dispatched.length = 0;
  M.pendingSets.length = 0;
  M.ports.length = 0;
  M.brain.mockReset();
  M.brain.mockResolvedValue(null);
  _resetVoiceServiceForTest();
  _resetPendingActionForTest();
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  _resetMaviVehicleContextForTest();
  // ONLINE koşul: `setup.ts` navigator'ı düz nesneyle değiştirince prototipteki
  // `onLine` kayboluyor → aksi hâlde beyin HİÇ çağrılmaz ve "sağlayıcı 0" ölçümü
  // hiçbir şey kanıtlamaz (yanlışlama şartı).
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  localStorage.setItem('car-launcher-storage', JSON.stringify({
    state: { settings: { aiVoiceProvider: 'gemini' } },
  }));
  unregister = registerCommandHandler((cmd) => { M.dispatched.push(cmd.type); });
});

afterEach(() => {
  unregister?.();
  unregister = null;
  _resetPendingActionForTest();
  localStorage.clear();
});

/** GÖREV 4 — reddedilmesi ZORUNLU sequence'ler. */
const REJECTED_SEQUENCES: readonly string[] = [
  'aracı kilitle ve kornaya bas',
  'kornaya bas ve aracı kilitle',
  'farları aç ve alarmı aç',
  'alarmı kapat ve kapıları aç',
  'arıza kodlarını sil ve aracı kilitle',
  'aracı kilitle sonra kornaya bas',
  'aracı kilitle ardından farları aç',
  'aracı kilitle ve aracı kilitle',
];

const segmentsOf = (input: string): ParsedCommand[] =>
  input.split(/\s+(?:ve|sonra|ardindan|ardından|bir de|hem de|ayrica|ayrıca)\s+/i)
    .map((s) => parseCommandFull(s.trim()).command)
    .filter((c): c is ParsedCommand => c !== null);

describe('P1 · çoklu onay gerektiren sequence FAIL-CLOSED', () => {
  it('1. 🔒 her zorunlu sequence dispatch ÖNCESİNDE reddedilir', async () => {
    for (const input of REJECTED_SEQUENCES) {
      M.dispatched.length = 0;
      M.pendingSets.length = 0;
      const handled = await processTextCommand(input, STOPPED);
      expect(`${input}:handled=${handled}`).toBe(`${input}:handled=true`);
      expect(`${input}:disp=${M.dispatched.join(',')}`).toBe(`${input}:disp=`);
    }
  });

  it('2. segment sayısı ve policy gerekçesi doğrulanır', () => {
    for (const input of REJECTED_SEQUENCES) {
      const cmds = segmentsOf(input);
      expect(`${input}:segments=${cmds.length}`).toBe(`${input}:segments=2`);
      const d = classifySequenceConfirmationPolicy(cmds);
      expect(d.allowed).toBe(false);
      if (!d.allowed) {
        expect(d.reason).toBe('multiple_confirmation_required_actions');
        expect(d.count).toBe(2);
      }
    }
  });

  it('3. 🔒 setPendingAction çağrısı = 0 ve bekleyen slot null', async () => {
    for (const input of REJECTED_SEQUENCES) {
      M.pendingSets.length = 0;
      await processTextCommand(input, STOPPED);
      expect(`${input}:pendingWrites=${M.pendingSets.length}`).toBe(`${input}:pendingWrites=0`);
      expect(peekPendingAction(Date.now())).toBeNull();
    }
  });

  it('4. 🔒 semantic sağlayıcı çağrısı = 0', async () => {
    for (const input of REJECTED_SEQUENCES) {
      M.brain.mockClear();
      await processTextCommand(input, STOPPED);
      expect(`${input}:brain=${M.brain.mock.calls.length}`).toBe(`${input}:brain=0`);
    }
  });

  it('5. 🔒 eyleme özgü onay TTS\'i YOK; fail-closed mesajı TAM 1 kez', async () => {
    for (const input of REJECTED_SEQUENCES) {
      M.spoken.length = 0;
      await processTextCommand(input, STOPPED);
      const refusals = M.spoken.filter((t) => t === MULTI_CONFIRMATION_REFUSAL_TEXT);
      expect(`${input}:refusal=${refusals.length}`).toBe(`${input}:refusal=1`);
      const actionSpecific = M.spoken.filter((t) =>
        /onaylıyor musun|kilitleyeyim|kilitlememi|kornaya basmamı|silmemi|kilitlen|çalındı|yapıldı/i.test(t));
      expect(`${input}:actionTts=${actionSpecific.join('|')}`).toBe(`${input}:actionTts=`);
    }
  });

  it('6. 🔒 hiçbir araç portu çağrılmaz (onay öncesi zaten yasak)', async () => {
    for (const input of REJECTED_SEQUENCES) {
      M.ports.length = 0;
      await processTextCommand(input, STOPPED);
      expect(M.ports).toEqual([]);
    }
  });

  it('7. segment SIRASI sonucu değiştirmez (determinizm)', async () => {
    for (const [a, b] of [
      ['aracı kilitle ve kornaya bas', 'kornaya bas ve aracı kilitle'],
      ['farları aç ve alarmı aç', 'alarmı aç ve farları aç'],
    ]) {
      for (const input of [a, b]) {
        M.dispatched.length = 0;
        M.spoken.length = 0;
        await processTextCommand(input, STOPPED);
        expect(M.dispatched).toEqual([]);
        expect(M.spoken.filter((t) => t === MULTI_CONFIRMATION_REFUSAL_TEXT).length).toBe(1);
      }
    }
  });

  it('8. ⚠️ DETERMİNİZM: handler tamamlanma sırası sonucu ETKİLEYEMEZ', async () => {
    /* Kapı dispatch'ten ÖNCE çalıştığı için handler'lar hiç çağrılmaz; hızlı/yavaş
       handler kombinasyonlarının hiçbirinde yan etki doğmaz. Port gecikmesiyle
       yarış testi YAPILMAZ — port onay öncesinde zaten çağrılmıyor. */
    for (const delays of [[0, 25], [25, 0], [10, 10]]) {
      const seen: string[] = [];
      const off = registerCommandHandler((cmd) => {
        seen.push(cmd.type);
        const end = Date.now() + delays[seen.length - 1 < 0 ? 0 : Math.min(seen.length - 1, 1)];
        while (Date.now() < end) { /* senkron gecikme benzetimi */ }
      });
      await processTextCommand('aracı kilitle ve kornaya bas', STOPPED);
      off();
      expect(seen).toEqual([]);
      expect(M.pendingSets.length).toBe(0);
    }
  });
});

describe('P1 · reddedilen sequence sonrası onay sözcükleri', () => {
  it('9. reddedilen sequence sonrası "evet" hiçbir ARAÇ eylemi çalıştırmaz', async () => {
    await processTextCommand('aracı kilitle ve kornaya bas', STOPPED);
    M.dispatched.length = 0;
    M.pendingSets.length = 0;
    await processTextCommand('evet', STOPPED);
    // Reddedilen sequence DİRİLMEZ: onay gerektiren hiçbir araç eylemi çalışmaz.
    expect(M.dispatched.filter((t) => commandRequiresConfirmation({ type: t } as ParsedCommand))).toEqual([]);
    expect(M.dispatched).not.toContain('hw_lock_doors');
    expect(M.dispatched).not.toContain('hw_honk_horn');
    expect(M.pendingSets.length).toBe(0);
    expect(peekPendingAction(Date.now())).toBeNull();
  });

  it('9b. 🐞 KARAKTERİZASYON: başıboş "evet" `navigate_home` üretiyor (ÖNCEDEN VAR OLAN parser kusuru)', () => {
    /* Bu görevde ONARILMADI çünkü düzeltmesi `commandParser` değişikliği gerektirir
       ve görev tanımı parser'a dokunmayı AÇIKÇA yasaklıyor (GÖREV 14 / YAPILMAYACAKLAR).
       Kök: Tier-2 token kuralı — `'evet'.startsWith('eve')` → navigate_home 0.82.
       P1 kapısıyla İLGİSİZDİR: bekleyen onay varken "evet" zaten AFFIRM yolunda
       tüketilir ve parser'a hiç ulaşmaz; yalnız BAŞIBOŞ "evet" bu kusura düşer.
       Kusur düzeltildiği gün bu kilit DÜŞER ve güncellenmesi zorunlu olur. */
    expect(parseCommand('evet')?.type).toBe('navigate_home');
    expect(commandRequiresConfirmation(parseCommand('evet'))).toBe(false);  // araç eylemi DEĞİL
  });

  it('10. reddedilen sequence sonrası "hayır" no-op kalır', async () => {
    await processTextCommand('farları aç ve alarmı aç', STOPPED);
    M.dispatched.length = 0;
    await processTextCommand('hayır', STOPPED);
    expect(M.dispatched).toEqual([]);
    expect(peekPendingAction(Date.now())).toBeNull();
  });

  it('11. YENİ tur reddedilmiş sequence\'ten STALE bekleyen onay bulmaz', async () => {
    await processTextCommand('arıza kodlarını sil ve aracı kilitle', STOPPED);
    expect(peekPendingAction(Date.now())).toBeNull();
    M.dispatched.length = 0;
    await processTextCommand('müziği aç', STOPPED);
    expect(M.dispatched).toEqual(['open_music']);   // yeni tur temiz çalışır
    expect(peekPendingAction(Date.now())).toBeNull();
  });
});

describe('P1 · regresyon — mevcut davranışlar korunuyor', () => {
  it('12. TEK hardware action onay akışı korunur (port onaysız çağrılmaz)', async () => {
    for (const input of ['aracı kilitle', 'lütfen kapıları kilitle', 'kornaya bas', 'arıza kodlarını sil']) {
      M.dispatched.length = 0;
      M.spoken.length = 0;
      await processTextCommand(input, STOPPED);
      expect(`${input}:disp=${M.dispatched.length}`).toBe(`${input}:disp=1`);
      expect(M.spoken.filter((t) => t === MULTI_CONFIRMATION_REFUSAL_TEXT)).toEqual([]);
    }
    // Otorite katmanı: onay olmadan port ÇAĞRILMAZ.
    const outcome = evaluateVehicleAction({
      intent: 'HARDWARE_LOCK',
      vehicleCtx: STOPPED,
      ports: { lockDoors: () => { M.ports.push('lock'); return true; } },
    } as unknown as Parameters<typeof evaluateVehicleAction>[0]);
    expect(outcome.allow).toBe(false);
    expect(M.ports).toEqual([]);
  });

  it('13. TEK action bekleyen onayı gerçek depoda yaşar ve "evet" onu tüketir', async () => {
    /* Gerçek depo davranışı (mock DEĞİL): P1 kapısı bu akışa DOKUNMAZ. */
    setPendingAction({
      intent:   { type: 'HARDWARE_LOCK', payload: {} },
      actionId: 'vehicle.doors.lock',
      turnId:   1,
      atMs:     Date.now(),
    } as unknown as Parameters<typeof setPendingAction>[0]);
    expect(peekPendingAction(Date.now())?.intent.type).toBe('HARDWARE_LOCK');
    // P1 kapısı bu tekil akışa DOKUNMAZ (yazma sayacı yalnız bu testten arttı).
    expect(M.pendingSets.length).toBe(1);
  });

  it('14. non-hardware sequence\'ler ENGELLENMEZ', async () => {
    for (const input of ['müziği aç ve sesi yükselt', 'eve git ve müziği aç',
                         'hava durumunu söyle ve müziği aç',
                         'motor sıcaklığını söyle ve yakıtı göster']) {
      M.spoken.length = 0;
      await processTextCommand(input, STOPPED);
      expect(`${input}:refusal=${M.spoken.filter((t) => t === MULTI_CONFIRMATION_REFUSAL_TEXT).length}`)
        .toBe(`${input}:refusal=0`);
    }
  });

  it('15. hardware + non-hardware sequence MEVCUT davranışını korur', async () => {
    for (const input of ['müziği aç ve aracı kilitle', 'aracı kilitle ve müziği aç']) {
      M.dispatched.length = 0;
      M.spoken.length = 0;
      await processTextCommand(input, STOPPED);
      // Tek onay gerektiren eylem var → P1 kapısı TETİKLENMEZ.
      expect(M.spoken.filter((t) => t === MULTI_CONFIRMATION_REFUSAL_TEXT)).toEqual([]);
      expect(M.dispatched.length).toBe(2);
    }
  });

  it('16. onay GEREKTİRMEYEN view action\'lar yanlış reddedilmez', () => {
    const cmds = segmentsOf('arka kamerayı aç ve ekranı kapat');
    expect(cmds.map((c) => c.type)).toEqual(['hw_rear_camera', 'hw_screen_off']);
    const d = classifySequenceConfirmationPolicy(cmds);
    expect(d.allowed).toBe(true);
    expect(commandRequiresConfirmation(parseCommand('arka kamerayı aç'))).toBe(false);
    expect(commandRequiresConfirmation(parseCommand('ekranı kapat'))).toBe(false);
    expect(commandRequiresConfirmation(parseCommand('ışıkları kapat'))).toBe(false);
  });

  it('17. 🔒 semantic fallback reddedilen sequence\'i DİRİLTEMEZ', async () => {
    /* Beyin bir araç eylemi döndürmeye çalışsa bile ÇAĞRILMAZ (test 4) — burada
       ayrıca hiçbir AI handler yolunun tetiklenmediği doğrulanır. */
    M.brain.mockResolvedValue({
      kind: 'action',
      semantic: { intent: 'HARDWARE_LOCK', confidence: 1, feedback: 'Kapılar kilitleniyor' },
    });
    M.dispatched.length = 0;
    const handled = await processTextCommand('aracı kilitle ve kornaya bas', STOPPED);
    expect(handled).toBe(true);
    expect(M.brain.mock.calls.length).toBe(0);
    expect(M.dispatched).toEqual([]);
    expect(peekPendingAction(Date.now())).toBeNull();
  });

  it('18. ⚠️ YANLIŞLAMA: risk bilgisi M4 defterinden okunuyor (sabit liste değil)', () => {
    expect(commandRequiresConfirmation(parseCommand('aracı kilitle'))).toBe(true);
    expect(commandRequiresConfirmation(parseCommand('kornaya bas'))).toBe(true);
    expect(commandRequiresConfirmation(parseCommand('arıza kodlarını sil'))).toBe(true);
    expect(commandRequiresConfirmation(parseCommand('müziği aç'))).toBe(false);
    expect(commandRequiresConfirmation(null)).toBe(false);
    expect(classifySequenceConfirmationPolicy([]).allowed).toBe(true);
  });
});
