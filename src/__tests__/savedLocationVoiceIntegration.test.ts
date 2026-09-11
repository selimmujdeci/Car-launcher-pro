/**
 * savedLocationVoiceIntegration.test.ts — Mavi "Özel Konumlar" komutları UÇTAN UCA.
 *
 * `processTextCommand` GERÇEK çalışır (mock DEĞİL): commandParser →
 * `savedLocationCommandParser` → voiceService'in yerel bypass'ı (1b3) →
 * `dispatch()` → `registerCommandHandler` ile kayıtlı handler — TAM ÜRETİM
 * ZİNCİRİ. Handler burada `useVoiceCommandHandler.ts`nin kendi yaptığı GERÇEK
 * çağrıları taklit eder (savedLocationsService — TEK otorite, mock DEĞİL).
 *
 * Kapsam (görev §9):
 *  · Mavi "Burayı kaydet, adı Mavi Göl olsun" → gerçek konum authority'sinden
 *    (GPS) alınır, gerçek serviste kaydedilir.
 *  · Mavi "Mavi Göl'e git" → navigate_place içinde saved-location kısa yolu
 *    (bu dosyada navigate zincirinin TAMAMI değil, çözümleme kilitlenir —
 *    navigasyon başlatma `savedLocationsService`/`navigationService` ayrı
 *    testlerde kilitli).
 *  · Mavi "Mavi Göl'ü paylaş" → gerçek kayıt bulunur, paylaşım tetiklenir.
 *  · Mavi rename.
 *  · Mavi "Mavi Göl'ü sil" → AÇIK ONAY ZORUNLU (mevcut _pendingCmd/AFFIRM_RE
 *    mekanizması) — "evet" gelmeden SİLİNMEZ.
 *  · bilinmeyen isim → fail-closed (silinmez/paylaşılmaz, dürüst mesaj).
 *  · ambiguous isim → rastgele seçim YOK.
 *  · GPS yokken kayıt UYDURULMAZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  speak: vi.fn(),
  gps: { latitude: 36.9, longitude: 34.8 } as { latitude: number; longitude: number } | null,
  startNavCalls: [] as unknown[],
  shareCalls: [] as unknown[],
}));

vi.mock('../platform/bridge', () => ({ isNative: false, bridge: {} }));
vi.mock('../platform/headUnitCompat', () => ({ isLowEndDevice: () => false }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: () => ({ handled: false, response: '' }),
}));
vi.mock('../platform/performanceMode', () => ({ getConfig: () => ({ enableRecommendations: true }) }));
vi.mock('../platform/ttsService', () => ({
  speakFeedback: (...a: unknown[]) => M.speak(...a),
  speakAssistant: vi.fn(), speakAlert: vi.fn(), ttsCancel: vi.fn(),
  registerTtsEndListener: () => () => {},
  isTtsSpeaking: () => false,
}));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => ({ reason: 'MAVI', release: () => {} }),
}));
vi.mock('../platform/aiVoiceService', () => ({ askAI: async () => null, resolveApiKey: () => '' }));
vi.mock('../platform/ai/semanticAiService', () => ({
  classifySemantic: async () => ({ source: 'offline', confidence: 0, feedback: '' }),
  enrichBackground: vi.fn(),
}));
vi.mock('../platform/intentEngine', () => ({ fromSemanticResult: () => null }));
vi.mock('../platform/voiceInfoService', () => ({
  isInformationalCommand: () => false, answerInformational: vi.fn(),
}));
vi.mock('../platform/weatherService', () => ({ weatherQueryNamesCity: () => false }));
vi.mock('../platform/sensitiveKeyStore', () => ({ sensitiveKeyStore: { get: async () => '' } }));
vi.mock('../platform/voiceDiagService', () => ({ reportVoiceDiag: vi.fn(async () => true) }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
// `assistant/maviSpeech` GERÇEK sesin çıkış noktasıdır — ölçülen budur (spy).
vi.mock('../platform/assistant/maviSpeech', () => ({
  speakMaviAnswer: (text: string) => { M.speak(text); return true; },
  speakMaviAnswerChunk: (text: string) => { M.speak(text); return true; },
}));
/* GERÇEK `useStore.ts` tüm uygulamanın Zustand mağazasıdır (OBD/performans/vs.
 * dev grafını TAŞIR) — bu test yalnız `savedLocationsService`in ihtiyaç duyduğu
 * `settings.customLocations` + `updateSettings`/`resetSettings` dilimini test
 * eder; hafif bir bellek-içi yer tutucu YETERLİ ve İZOLE. `savedLocationsService`
 * kendisi de bu modülden okur — davranış GERÇEK (mock CRUD mantığı YOK). */
vi.mock('../store/useStore', () => {
  let customLocations: Array<{ id: string; lat: number; lng: number; name: string; timestamp: number }> = [];
  const api = {
    getState: () => ({
      settings: { customLocations },
      updateSettings: (partial: Record<string, unknown>) => {
        if ('customLocations' in partial) customLocations = partial.customLocations as typeof customLocations;
      },
      resetSettings: () => { customLocations = []; },
    }),
  };
  return { useStore: api };
});

import {
  processTextCommand, registerCommandHandler, _resetVoiceServiceForTest,
  setSavedLocationResolver,
} from '../platform/voiceService';
import { useStore } from '../store/useStore';
import {
  addSavedLocation, getSavedLocations, findSavedLocationByName, renameSavedLocation,
} from '../platform/savedLocations/savedLocationsService';
import type { ParsedCommand } from '../platform/commandParser';
import type { VehicleContext } from '../platform/aiVoiceService';

/** `useVoiceCommandHandler.ts`nin GERÇEK yaptığı şeyi taklit eder — servis GERÇEK. */
function registerSavedLocationHandler(): () => void {
  return registerCommandHandler((cmd: ParsedCommand, _ctx?: VehicleContext) => {
    if (cmd.type === 'save_location') {
      if (!M.gps) { M.speak('GPS sinyali yok, konumu kaydedemedim.'); return; }
      const rawName = cmd.extra?.name ?? '';
      const saved = addSavedLocation(M.gps.latitude, M.gps.longitude, rawName || null);
      M.speak(saved ? `${saved.name} olarak kaydettim.` : 'Konumu kaydedemedim.');
      return;
    }
    if (cmd.type === 'rename_location') {
      const { match, ambiguous } = findSavedLocationByName(cmd.extra?.name ?? '');
      if (ambiguous.length > 0) { M.speak('Birden fazla kayıt var, netleştirir misin?'); return; }
      if (!match) { M.speak('Kayıtlı bir konum bulamadım.'); return; }
      const newName = cmd.extra?.newName ?? '';
      const ok = renameSavedLocation(match.id, newName);
      M.speak(ok ? `${match.name} artık ${newName}.` : `${match.name} konumunun adını değiştiremedim.`);
      return;
    }
    if (cmd.type === 'share_location') {
      const { match, ambiguous } = findSavedLocationByName(cmd.extra?.name ?? '');
      if (ambiguous.length > 0) { M.speak('Birden fazla kayıt var, netleştirir misin?'); return; }
      if (!match) { M.speak('Kayıtlı bir konum bulamadım.'); return; }
      M.shareCalls.push(match);
      return;
    }
    if (cmd.type === 'delete_location') {
      const id = cmd.extra?.resolvedId;
      const name = cmd.extra?.name ?? 'Konum';
      const ok = id ? (() => { const before = getSavedLocations().length; useStore.getState().updateSettings({ customLocations: getSavedLocations().filter((l) => l.id !== id) }); return getSavedLocations().length < before; })() : false;
      M.speak(ok ? `${name} konumunu sildim.` : `${name} konumunu silemedim.`);
      return;
    }
    if (cmd.type === 'navigate_place' || cmd.type === 'navigate_address') {
      const dest = cmd.extra?.destination ?? cmd.raw;
      const { match } = findSavedLocationByName(dest);
      if (match) M.startNavCalls.push({ id: match.id, name: match.name, lat: match.lat, lng: match.lng });
    }
  });
}

let _unsub: (() => void) | null = null;

beforeEach(() => {
  useStore.getState().resetSettings();
  _resetVoiceServiceForTest();
  M.speak.mockClear();
  M.startNavCalls = [];
  M.shareCalls = [];
  M.gps = { latitude: 36.9, longitude: 34.8 };
  _unsub = registerSavedLocationHandler();
  // `useVoiceCommandHandler`in GERÇEK DI kaydı — bu testte manuel.
  setSavedLocationResolver((rawName) => {
    const { match, ambiguous } = findSavedLocationByName(rawName);
    return { match, ambiguous };
  });
});
afterEach(() => {
  if (_unsub) { _unsub(); _unsub = null; }
  setSavedLocationResolver(null);
  useStore.getState().resetSettings();
  _resetVoiceServiceForTest();
});

describe('Mavi · Özel Konumlar — KAYDET', () => {
  it('"Burayı kaydet, adı Mavi Göl olsun" → gerçek GPS ile, doğru adla kaydeder', async () => {
    await processTextCommand('Burayı kaydet, adı Mavi Göl olsun');
    const all = getSavedLocations();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Mavi Göl');
    expect(all[0].lat).toBe(36.9);
    expect(M.speak).toHaveBeenCalledWith(expect.stringContaining('Mavi Göl'));
  });

  it('GPS YOKKEN sahte kayıt OLUŞTURULMAZ (fail-closed)', async () => {
    M.gps = null;
    await processTextCommand('Burayı kaydet, adı Mavi Göl olsun');
    expect(getSavedLocations()).toHaveLength(0);
    expect(M.speak).toHaveBeenCalledWith(expect.stringContaining('GPS'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SAHA KUSURU (2026-09-11) — doğal Türkçe konum cümleleri YANLIŞ komuta düşüyordu
 *
 * Ölçülen (düzeltme ÖNCESİ, gerçek `parseCommand` çıktısı):
 *   "yerimi kaydet" · "bulunduğum yeri kaydet" → add_music_favorite (0.82)
 *   "buraya ev diye kaydet"                    → navigate_home      (0.82)
 * 0.82 ≥ AUTO_DISPATCH_MIN (0.7) → yanlış eylem ONAYSIZ yürütülüyordu
 * (müzik favorisi eklenir / eve navigasyon başlar). Bu blok UÇTAN UCA
 * gerçek zincirle (parser → dispatch → savedLocationsService) kilitler.
 * ════════════════════════════════════════════════════════════════════════ */
describe('Mavi · Özel Konumlar — doğal Türkçe varyantlar (SAHA 2026-09-11)', () => {
  it('"yerimi kaydet" → KONUM kaydeder (müzik favorisine DÜŞMEZ)', async () => {
    await processTextCommand('yerimi kaydet');
    const all = getSavedLocations();
    expect(all).toHaveLength(1);
    expect(all[0].lat).toBe(36.9);
  });

  it('"buraya ev diye kaydet" → "ev" adıyla kaydeder (eve NAVİGASYON başlatmaz)', async () => {
    await processTextCommand('buraya ev diye kaydet');
    const all = getSavedLocations();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('ev');
    expect(M.startNavCalls).toHaveLength(0);
  });

  it('"Şu an bulunduğum yeri annemler olarak kaydet" → ad "annemler"', async () => {
    await processTextCommand('Şu an bulunduğum yeri annemler olarak kaydet');
    const all = getSavedLocations();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('annemler');
  });

  it('"Bulunduğum konumu ev olarak kaydet" → ad "ev" (önek isme KARIŞMAZ)', async () => {
    await processTextCommand('Bulunduğum konumu ev olarak kaydet');
    expect(getSavedLocations()[0]?.name).toBe('ev');
  });

  it('"Burayı Mavi Göl adıyla kaydet" → ad "Mavi Göl" (isim KAYBOLMAZ)', async () => {
    await processTextCommand('Burayı Mavi Göl adıyla kaydet');
    expect(getSavedLocations()[0]?.name).toBe('Mavi Göl');
  });

  it('GPS yokken doğal varyant da fail-closed ("kaydettim" DEMEZ)', async () => {
    M.gps = null;
    await processTextCommand('yerimi kaydet');
    expect(getSavedLocations()).toHaveLength(0);
    expect(M.speak).not.toHaveBeenCalledWith(expect.stringContaining('kaydettim'));
  });
});

describe('Mavi · Özel Konumlar — GİT (saved-location kısa yolu)', () => {
  it('"Mavi Göl\'e git" → kayıtlı konum ÇÖZÜLÜR (geocoding ATLANIR)', async () => {
    addSavedLocation(36.9, 34.8, 'Mavi Göl');
    M.speak.mockClear();
    await processTextCommand("Mavi Göl'e git");
    expect(M.startNavCalls).toHaveLength(1);
    expect(M.startNavCalls[0]).toMatchObject({ name: 'Mavi Göl', lat: 36.9, lng: 34.8 });
  });
});

describe('Mavi · Özel Konumlar — PAYLAŞ', () => {
  it('"Mavi Göl\'ü paylaş" → DOĞRU kayıt paylaşılır', async () => {
    const loc = addSavedLocation(1, 2, 'Mavi Göl')!;
    await processTextCommand("Mavi Göl'ü paylaş");
    expect(M.shareCalls).toHaveLength(1);
    expect((M.shareCalls[0] as { id: string }).id).toBe(loc.id);
  });

  it('bilinmeyen isim paylaşımı → fail-closed, uydurma YOK', async () => {
    await processTextCommand("Olmayan Yer'i paylaş");
    expect(M.shareCalls).toHaveLength(0);
    expect(M.speak).toHaveBeenCalledWith(expect.stringContaining('bulamadım'));
  });
});

describe('Mavi · Özel Konumlar — YENİDEN ADLANDIR', () => {
  it('"Mavi Göl\'ün adını Piknik Alanı yap" → AYNI ID, yeni ad', async () => {
    const loc = addSavedLocation(1, 2, 'Mavi Göl')!;
    await processTextCommand("Mavi Göl'ün adını Piknik Alanı yap");
    const all = getSavedLocations();
    expect(all[0].id).toBe(loc.id);
    expect(all[0].name).toBe('Piknik Alanı');
  });
});

describe('Mavi · Özel Konumlar — SİL (açık onay ZORUNLU)', () => {
  it('"Mavi Göl\'ü sil" → ONAY SORULUR, HENÜZ SİLİNMEZ', async () => {
    addSavedLocation(1, 2, 'Mavi Göl');
    await processTextCommand("Mavi Göl'ü sil");
    expect(getSavedLocations()).toHaveLength(1);          // hâlâ duruyor
    expect(M.speak).toHaveBeenCalledWith(expect.stringContaining('emin misin'));
  });

  it('"evet" gelince GERÇEKTEN silinir', async () => {
    addSavedLocation(1, 2, 'Mavi Göl');
    await processTextCommand("Mavi Göl'ü sil");
    M.speak.mockClear();
    await processTextCommand('evet');
    expect(getSavedLocations()).toHaveLength(0);
    expect(M.speak).toHaveBeenCalledWith(expect.stringContaining('sildim'));
  });

  it('"hayır" gelince SİLİNMEZ', async () => {
    addSavedLocation(1, 2, 'Mavi Göl');
    await processTextCommand("Mavi Göl'ü sil");
    await processTextCommand('hayır');
    expect(getSavedLocations()).toHaveLength(1);
  });

  it('bilinmeyen isim silme → fail-closed, onay bile SORULMAZ', async () => {
    await processTextCommand("Olmayan Yer'i sil");
    expect(M.speak).toHaveBeenCalledWith(expect.stringContaining('bulamadım'));
    expect(M.speak).not.toHaveBeenCalledWith(expect.stringContaining('emin misin'));
  });

  it('AMBIGUOUS isim → rastgele SEÇİLMEZ, kullanıcıya sorulur, hiçbiri silinmez', async () => {
    addSavedLocation(1, 2, 'Mavi Göl');
    addSavedLocation(3, 4, 'Mavi Göl');
    await processTextCommand("Mavi Göl'ü sil");
    expect(getSavedLocations()).toHaveLength(2);           // ikisi de duruyor
    expect(M.speak).toHaveBeenCalledWith(expect.stringContaining('Birden fazla'));
  });
});
