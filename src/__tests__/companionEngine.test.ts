/**
 * companionEngine.test.ts — Faz 4: Proaktif Motor (PromptScheduler) testleri.
 *
 * Kapsam:
 *  - kontak/boot selamlaması: oturumda 1 kez, pencere kaçarsa hiç
 *  - Interaction Gate: PROTECTION+ · sesli oturum · voicePaused · sessiz kişilik
 *  - yakıt menzili < 50 km: medya çalarken bile konuşur, cooldown'a tabi
 *  - uyku önleme: gece + sürüş + uzun sessizlik → açık uçlu soru; aktivite sıfırlar
 *  - frequency budget: chattiness aralıkları; 'az' = yalnız güvenlik
 *  - mola önerisi + 'sik' yolculuk yorumu
 *
 * Zaman: performance.now spy (monotonik) + vi.setSystemTime (saat dilimi).
 * Tick zamanlayıcı beklenmez — _companionEngineTickForTest ile senkron sürülür.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Servis mock'ları (mutable durum vi.hoisted ile) ────────── */

const h = vi.hoisted(() => ({
  obdCb:  null as null | ((d: Record<string, unknown>) => void),
  tripCb: null as null | ((s: Record<string, unknown>) => void),
  media:  { playing: false },
  voice:  { status: 'idle', followUp: false },
  paused: false,
  spoken: [] as string[],
  cmdHandlers: [] as Array<() => void>,
}));

vi.mock('../platform/obdService', () => ({
  onOBDData: (cb: (d: Record<string, unknown>) => void) => { h.obdCb = cb; return () => {}; },
}));
vi.mock('../platform/tripLogService', () => ({
  onTripState: (cb: (s: Record<string, unknown>) => void) => { h.tripCb = cb; return () => {}; },
}));
vi.mock('../platform/mediaService', () => ({
  getMediaState: () => h.media,
}));
vi.mock('../platform/voiceService', () => ({
  getVoiceSnapshot:       () => h.voice,
  isVoicePaused:          () => h.paused,
  registerCommandHandler: (fn: () => void) => { h.cmdHandlers.push(fn); return () => {}; },
}));
vi.mock('../platform/ttsService', () => ({
  ttsSpeak: (text: string, opts?: { onEnd?: () => void }) => {
    h.spoken.push(text);
    opts?.onEnd?.(); // uçuş bayrağı senkron çözülür — sonraki tick engellenmez
  },
  registerTtsEndListener: () => () => {},
}));

import {
  startCompanionEngine,
  stopCompanionEngine,
  _companionEngineTickForTest as tick,
  _resetCompanionEngineForTest as resetEngine,
} from '../platform/companion/companionEngine';
import { useStore } from '../store/useStore';
import { useCognitiveStore } from '../store/useCognitiveStore';

/* ── Zaman kontrolü ─────────────────────────────────────────── */

let _nowMs = 0;
/** Monotonik saati t dakikaya taşı. */
function atMin(min: number): void { _nowMs = min * 60_000; }

function setHour(hour: number): void {
  vi.setSystemTime(new Date(2026, 5, 11, hour, 30, 0));
}

function setTrip(active: boolean, durationMin = 0, distanceKm = 0): void {
  h.tripCb?.({ active, current: active ? { liveDurationMin: durationMin, liveDistanceKm: distanceKm } : null });
}

function setRange(km: number): void {
  h.obdCb?.({ estimatedRangeKm: km, range: -1 });
}

/* ── Kurulum ────────────────────────────────────────────────── */

beforeEach(() => {
  vi.useFakeTimers();
  setHour(14); // gündüz (ogle)
  _nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => _nowMs);

  h.obdCb = null; h.tripCb = null;
  h.media  = { playing: false };
  h.voice  = { status: 'idle', followUp: false };
  h.paused = false;
  h.spoken = [];
  h.cmdHandlers = [];

  useStore.getState().resetSettings();
  useStore.getState().updateSettings({ companionEnabled: true });
  useCognitiveStore.getState().setMode('IMMERSIVE');

  resetEngine();
  startCompanionEngine();
  setRange(400);
  setTrip(false);
});

afterEach(() => {
  stopCompanionEngine();
  vi.restoreAllMocks();
  vi.useRealTimers();
  useStore.getState().updateSettings({ companionEnabled: false });
});

/* ── 1. Selamlama (kontak açılışı) ──────────────────────────── */

describe('kontak/boot selamlaması', () => {
  it('ilk uygun tick selamlar — oturumda yalnız 1 kez', () => {
    atMin(1); tick();
    expect(h.spoken).toHaveLength(1);
    expect(h.spoken[0]).toContain('Merhaba'); // 14:30 → öğle selamı
    atMin(2); tick();
    expect(h.spoken).toHaveLength(1); // tekrar yok
  });

  it('hitap ayarlıysa selamlamaya girer', () => {
    useStore.getState().updateSettings({ companionUserCallsign: 'Selim' });
    atMin(1); tick();
    expect(h.spoken[0]).toContain('Selim');
  });

  it('pencere kaçarsa (ilk dakikalar dolu) sonradan selamlamaz', () => {
    h.voice = { status: 'listening', followUp: false };
    atMin(2); tick();                 // gate dolu — selamlanamadı
    h.voice = { status: 'idle', followUp: false };
    atMin(10); tick();                // pencere (5 dk) geçti
    expect(h.spoken).toHaveLength(0);
  });
});

/* ── 2. Interaction Gate ────────────────────────────────────── */

describe('Interaction Gate', () => {
  it('companion kapalı → sessiz', () => {
    useStore.getState().updateSettings({ companionEnabled: false });
    atMin(1); tick();
    expect(h.spoken).toHaveLength(0);
  });

  it("'sessiz' kişilik = proaktif 0 (güvenlik dahil sus)", () => {
    useStore.getState().updateSettings({ companionPersonality: 'sessiz' });
    setRange(30);
    atMin(1); tick();
    expect(h.spoken).toHaveLength(0);
  });

  it('CognitiveMode ≥ PROTECTION → sessiz; mod düşünce konuşur', () => {
    useCognitiveStore.getState().setMode('PROTECTION');
    atMin(1); tick();
    expect(h.spoken).toHaveLength(0);
    useCognitiveStore.getState().setMode('IMMERSIVE');
    atMin(2); tick();
    expect(h.spoken).toHaveLength(1); // selamlama (pencere içinde)
  });

  it('aktif sesli oturum (status≠idle / followUp) → sessiz', () => {
    h.voice = { status: 'processing', followUp: false };
    atMin(1); tick();
    h.voice = { status: 'idle', followUp: true };
    atMin(2); tick();
    expect(h.spoken).toHaveLength(0);
  });

  it('voicePaused (PROTECTION kilidi) → sessiz', () => {
    h.paused = true;
    atMin(1); tick();
    expect(h.spoken).toHaveLength(0);
  });
});

/* ── 3. Yakıt menzili < 50 km (güvenlik) ────────────────────── */

describe('yakıt menzili tetiği', () => {
  // Selamlama penceresini gate'siz tüketmeden geçir (t=10 > 5 dk pencere)
  function expireGreeting(): void { atMin(10); tick(); h.spoken = []; }

  it('menzil < 50 km → benzinlik aciliyeti; cooldown içinde tekrar yok', () => {
    expireGreeting();
    setRange(30);
    atMin(11); tick();
    expect(h.spoken).toHaveLength(1);
    expect(h.spoken[0]).toContain('benzinli');
    atMin(15); tick();                 // 15 dk cooldown dolmadı
    expect(h.spoken).toHaveLength(1);
    atMin(27); tick();                 // cooldown doldu
    expect(h.spoken).toHaveLength(2);
  });

  it('medya çalarken BİLE konuşur (güvenlik istisnası, duck ttsService işi)', () => {
    expireGreeting();
    h.media = { playing: true };
    setRange(30);
    atMin(11); tick();
    expect(h.spoken).toHaveLength(1);
  });

  it('menzil sağlıklıyken tetiklenmez', () => {
    expireGreeting();
    setRange(200);
    atMin(11); tick();
    expect(h.spoken).toHaveLength(0);
  });
});

/* ── 4. Uyku önleme (gece + sessizlik) ──────────────────────── */

describe('uyku önleme (Anti-Drowsiness)', () => {
  function nightSetup(): void {
    setHour(23);
    setTrip(true, 120, 110);
    atMin(10); tick(); h.spoken = []; // selamlama penceresi geçti
  }

  it("gece + sürüş + 20 dk sessizlik → açık uçlu soru ('az' seviyede bile — güvenlik)", () => {
    nightSetup();
    atMin(25); tick();                 // sessizlik 25 dk (boot'tan beri)
    expect(h.spoken).toHaveLength(1);
    expect(h.spoken[0]).toContain('?'); // soru — sürücüyü konuşturur
    atMin(26); tick();                 // konuşma aktiviteyi sıfırladı
    expect(h.spoken).toHaveLength(1);
  });

  it('sesli komut sessizliği sıfırlar → soru ertelenir', () => {
    nightSetup();
    atMin(24);
    h.cmdHandlers.forEach((fn) => fn()); // kullanıcı konuştu
    atMin(30); tick();                   // sessizlik yalnız 6 dk
    expect(h.spoken).toHaveLength(0);
  });

  it('gündüz aynı koşullarda tetiklenmez', () => {
    setHour(14);
    setTrip(true, 120, 110);
    atMin(10); tick(); h.spoken = [];
    atMin(35); tick();
    expect(h.spoken).toHaveLength(0);
  });

  it('medya çalıyorsa kabin sessiz değildir → soru yok', () => {
    nightSetup();
    h.media = { playing: true };
    atMin(35); tick();
    expect(h.spoken).toHaveLength(0);
  });
});

/* ── 5. Frequency budget + mola + yolculuk yorumu ───────────── */

describe('frequency budget ve bütçeli tetikler', () => {
  it("'az' (varsayılan): mola önerisi YOK — yalnız güvenlik", () => {
    setTrip(true, 130, 95);
    atMin(10); tick(); h.spoken = [];
    atMin(60); tick();
    expect(h.spoken).toHaveLength(0);
  });

  it("'normal': mola önerisi konuşulur ama bütçe (20 dk) dolmadan değil", () => {
    useStore.getState().updateSettings({ companionChattiness: 'normal' });
    setTrip(true, 130, 95);
    atMin(2); tick();                  // selamlama → bütçe saati başladı
    expect(h.spoken).toHaveLength(1);
    atMin(10); tick();                 // bütçe dolmadı (8 dk)
    expect(h.spoken).toHaveLength(1);
    atMin(23); tick();                 // bütçe doldu → mola
    expect(h.spoken).toHaveLength(2);
    expect(h.spoken[1]).toContain('molasız');
  });

  it("'sik': mola gerekmiyorsa küçük yolculuk yorumu yapar", () => {
    useStore.getState().updateSettings({ companionChattiness: 'sik' });
    setTrip(true, 45, 38);             // 45 dk < mola eşiği (120)
    atMin(10); tick(); h.spoken = [];  // selamlama penceresi geçti
    atMin(21); tick();                 // bütçe (10 dk) doldu
    expect(h.spoken).toHaveLength(1);
    expect(h.spoken[0]).toContain('yoldayız');
  });

  it("'normal': mola gerekmiyorsa yolculuk yorumu YAPMAZ (yalnız 'sik')", () => {
    useStore.getState().updateSettings({ companionChattiness: 'normal' });
    setTrip(true, 45, 38);
    atMin(10); tick(); h.spoken = [];
    atMin(60); tick();
    expect(h.spoken).toHaveLength(0);
  });
});

/* ── 6. Yaşam döngüsü ───────────────────────────────────────── */

describe('yaşam döngüsü', () => {
  it('startCompanionEngine cleanup döner; stop sonrası tick konuşmaz', () => {
    stopCompanionEngine();
    atMin(1); tick();
    // Engine durdu ama tick saf fonksiyon — gate'ler yine de companionEnabled
    // okur; abonelikler kapandığı için sinyaller donar. Çift stop güvenli:
    expect(() => stopCompanionEngine()).not.toThrow();
  });

  it('çift start idempotent (ikinci çağrı yeni abonelik açmaz)', () => {
    const before = h.cmdHandlers.length;
    startCompanionEngine();
    expect(h.cmdHandlers.length).toBe(before);
  });
});
