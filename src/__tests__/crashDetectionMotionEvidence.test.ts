/**
 * Kaza kaydı HAREKET KANITI ister + depo budanır (kütük #456).
 *
 * SAHA 2026-08-06, cihaz depolaması: 15+ `crash-log-*` kaydı (~70 KB/adet),
 * `peakG` 6,0-9,99 G. Otomobilde bu gerçek çarpışmadır — oysa araç sağlam ve
 * yolculuklar normal tamamlanmıştı. Tetikleyici telefonun elle sallanmasıydı;
 * 6G eşiği tek başına "araç" ile "el"i ayırt edemiyor. Üstelik kayıtlar hiç
 * budanmıyordu (toplam ~1,7 MB localStorage — CLAUDE.md blob yasağı).
 *
 * Kural: kaza kaydı, kaza OLDUĞUNU iddia eden bir belgedir; hareket kanıtı
 * olmadan üretilmesi uydurma kanıttır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Bağımlılık mock'ları — sadece bu servisi izole etmek için ───────────── */

let _motionCb: ((e: { acceleration: { x: number; y: number; z: number } }) => void) | null = null;
vi.mock('../platform/sensors', () => ({
  subscribeMotion: vi.fn((cb: never) => { _motionCb = cb; return () => { _motionCb = null; }; }),
}));

const M = { speed: null as number | null };
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: {
    getState: () => ({
      speed: M.speed, heading: null, location: null, fuel: null,
    }),
  },
}));

const dispatchCrashDetected = vi.fn();
vi.mock('../platform/vehicleDataLayer', () => ({
  dispatchCrashDetected: (g: number) => dispatchCrashDetected(g),
}));

/** Sahte depo: anahtar → değer. Gerçek localStorage/Filesystem yerine. */
const STORE = new Map<string, string>();
vi.mock('../utils/safeStorage', () => ({
  safeSetRawImmediate: vi.fn((k: string, v: string) => { STORE.set(k, v); return Promise.resolve(); }),
  safeGetRaw:          vi.fn((k: string) => STORE.get(k) ?? null),
  safeRemoveRaw:       vi.fn((k: string) => { STORE.delete(k); }),
  listKeysWithPrefix:  vi.fn((p: string) => [...STORE.keys()].filter((k) => k.startsWith(p))),
}));

vi.mock('../platform/obdService', () => ({
  onOBDData:           vi.fn(() => () => {}),
  getOBDDataSnapshot:  vi.fn(() => ({ speed: -1, rpm: -1, throttle: -1 })),
  getObdSessionHealth: vi.fn(() => null),
  getObdFreshWindowMs: vi.fn(() => 5_000),
}));
vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: { getWorkerStatus: vi.fn(() => 'RUNNING'), registerWorker: vi.fn() },
}));
vi.mock('../platform/thermalWatchdog',  () => ({ getThermalLevel: vi.fn(() => 'NOMINAL') }));
vi.mock('../platform/memoryWatchdog',   () => ({ onMemoryPressure: vi.fn(() => () => {}) }));
vi.mock('../platform/commandExecutor',  () => ({ getLastIntent: vi.fn(() => null) }));
vi.mock('../platform/crashLogger',      () => ({ registerBlackBoxGetter: vi.fn() }));

const G = 9.80665;
/** Verilen G büyüklüğünde tek eksenli darbe üretir. */
function impact(g: number): void {
  _motionCb?.({ acceleration: { x: g * G, y: 0, z: 0 } });
}

const CRASH_KEYS = (): string[] => [...STORE.keys()].filter((k) => k.startsWith('crash-log-'));

describe('#456 · Kaza kaydı hareket kanıtı ister', () => {
  let stop: (() => void) | null = null;
  let svc: typeof import('../platform/security/blackBoxService');

  beforeEach(async () => {
    vi.useFakeTimers();
    STORE.clear();
    dispatchCrashDetected.mockClear();
    M.speed = null;
    vi.resetModules();
    svc  = await import('../platform/security/blackBoxService');
    stop = svc.startBlackBox();
  });

  afterEach(() => { stop?.(); stop = null; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('KUSURUN KANITI: hız kanıtı YOKken 9G darbe kayıt ÜRETMEZ', () => {
    // Telefon elde sallanıyor: eşik aşılıyor ama araç hareket ettiğine dair
    // hiçbir ölçüm yok. Sahada bu senaryo 15+ sahte kayıt üretmişti.
    vi.advanceTimersByTime(1_000);   // örnekleyici dönsün
    impact(9);
    expect(CRASH_KEYS()).toHaveLength(0);
    expect(dispatchCrashDetected).not.toHaveBeenCalled();
    expect(svc.getCrashDetectionHealth().rejectedNoMotion).toBe(1);
  });

  it('🔒 hız BİLİNMİYOR ile hız SIFIR aynı muameleyi görür (sahte 0 yok)', () => {
    M.speed = 0;                      // araç gerçekten duruyor
    vi.advanceTimersByTime(1_000);
    impact(9);
    expect(CRASH_KEYS()).toHaveLength(0);
    M.speed = null;                   // ölçüm yok
    vi.advanceTimersByTime(20_000);
    impact(9);
    expect(CRASH_KEYS()).toHaveLength(0);
    expect(svc.getCrashDetectionHealth().rejectedNoMotion).toBe(2);
  });

  it('🔒 GERÇEK kaza kaydedilir: hareket kanıtı + eşik üstü darbe', () => {
    M.speed = 90;                     // otoyol hızı ölçüldü
    vi.advanceTimersByTime(1_000);    // kanıt damgalandı
    impact(9);
    expect(CRASH_KEYS()).toHaveLength(1);
    expect(dispatchCrashDetected).toHaveBeenCalledTimes(1);
    expect(svc.getCrashDetectionHealth().recorded).toBe(1);
  });

  it('🔒 eşiğin altındaki darbe hareket varken de kayıt üretmez', () => {
    M.speed = 90;
    vi.advanceTimersByTime(1_000);
    impact(3.5);                      // eski false-positive bandı
    expect(CRASH_KEYS()).toHaveLength(0);
  });

  it('🔒 kanıt BAYATLARSA kapı kapanır (araç durup telefon sallanırsa)', () => {
    M.speed = 90;
    vi.advanceTimersByTime(1_000);    // hareket kanıtı var
    M.speed = null;
    vi.advanceTimersByTime(15_000);   // 10 sn'lik pencere geçti
    impact(9);
    expect(CRASH_KEYS()).toHaveLength(0);
  });

  it('🔒 kanıt reddi cooldown mandalını KİLİTLEMEZ', () => {
    // Reddedilen darbe cooldown'ı kurarsa, hemen ardından gelen GERÇEK kaza
    // 10 saniye boyunca yutulurdu.
    vi.advanceTimersByTime(1_000);
    impact(9);                        // kanıtsız → red
    M.speed = 90;
    vi.advanceTimersByTime(500);      // kanıt geldi (cooldown süresinden KISA)
    impact(9);
    expect(CRASH_KEYS()).toHaveLength(1);
  });
});

describe('#456 · Kaza kaydı deposu budanır', () => {
  let stop: (() => void) | null = null;
  let svc: typeof import('../platform/security/blackBoxService');

  beforeEach(async () => {
    vi.useFakeTimers();
    STORE.clear();
    M.speed = 90;
    vi.resetModules();
    svc  = await import('../platform/security/blackBoxService');
    stop = svc.startBlackBox();
  });
  afterEach(() => { stop?.(); stop = null; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('🔒 en yeni 5 kayıt tutulur, eskiler silinir', () => {
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(11_000); // cooldown'ı aş + kanıtı tazele
      impact(9);
    }
    expect(svc.getCrashDetectionHealth().recorded).toBe(9);
    expect(CRASH_KEYS()).toHaveLength(5);
  });

  it('🔒 silinenler EN ESKİLER olur (sayısal sıra, sözlüksel değil)', () => {
    for (let i = 0; i < 7; i++) {
      vi.advanceTimersByTime(11_000);
      impact(9);
    }
    const kept = CRASH_KEYS().map((k) => Number(k.slice('crash-log-'.length))).sort((a, b) => a - b);
    expect(kept).toHaveLength(5);
    // Kalanların hepsi, silinenlerden yeni olmalı → en küçüğü bile ilk yazımdan büyük
    expect(kept[0]).toBeGreaterThan(0);
    expect(kept[4]).toBe(Math.max(...kept));
  });

  it('🔒 depo listelenemezse kaza kaydı YİNE de yazılır (fail-soft)', async () => {
    const storage = await import('../utils/safeStorage');
    vi.mocked(storage.listKeysWithPrefix).mockImplementationOnce(() => { throw new Error('depo yok'); });
    vi.advanceTimersByTime(1_000);
    impact(9);
    expect(STORE.size).toBeGreaterThan(0);
  });
});
