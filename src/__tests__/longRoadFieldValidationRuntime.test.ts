/**
 * longRoadFieldValidationRuntime.test.ts — GÖZLEMCİ RUNTIME kilitleri.
 *
 * Kaydedicinin gerçek yaşam döngüsünü sürer: başlat → tick → uygulama ölümü →
 * restore → durdur → sil. Okuma katmanı MOCK'lanır ki test gerçek OBD/GPS/ağ
 * servislerine DOKUNMASIN (ve testin kendisi de ürün davranışı değiştirmesin).
 *
 * Zamanlayıcı sahte saatle sürülür; `_driveTickForTest()` tick'i doğrudan
 * çağırır → 8 saatlik yolculuk milisaniyeler içinde simüle edilir (görev §20).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LongRoadSample } from '../platform/fieldValidation/longRoadDetect';
import type { PreflightRow, SessionEnv } from '../platform/fieldValidation/longRoadModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Mock'lar — hiçbir gerçek servis çağrılmaz
 * ════════════════════════════════════════════════════════════════════════ */

/** Testin sürdüğü ham örnek. Her test kendi senaryosunu buraya yazar. */
const scripted: { sample: LongRoadSample | null } = { sample: null };

function baseSample(over: Partial<LongRoadSample> = {}): LongRoadSample {
  return {
    wallMs: 0, monoMs: 0,
    obdTransportConnected: true, obdDataFresh: true, obdConnectionState: 'connected',
    obdSource: 'real', obdLastPacketAgeMs: 120, handshakeOutcome: 'ok',
    protocolActive: 'ISO15765', protocolTried: 'ISO15765', vinPresent: true,
    supportedPidCount: 24, reconnectRequested: 0, resetRequested: 0, disconnectCalled: 0,
    transportReconnectAttempts: 0, kwpStatus: 'idle', kwpRecoveryCount: 0,
    kwpSuppressedCount: 0, kwpAtpcFailures: 0, canRetryCount: 0, halActiveSource: 'obd',
    speed: 90, rpm: 2200, engineTemp: 88, throttle: 25, intakeTemp: 30,
    fuelLevel: 60, batteryVoltage: 14.1,
    locationState: 'LIVE', locationProvider: 'gps', locationAccuracyM: 6,
    locationFixAgeMs: 400, gpsSwitchCount: 0, gpsFallbackCount: 0,
    tripActive: true, tripTotalDistanceKm: 0, tripTotalCount: 1,
    online: true, telemetryReportPresent: false, offlineQueueSize: null,
    runtimeMode: 'BALANCED', thermalLevel: 0, ramPressureRatio: 0.3,
    uiFreezeCount: 0, workerRestartTotal: 0, memoryPressure: null,
    appVisible: true, batteryPercent: null, charging: null,
    ...over,
  };
}

const PREFLIGHT_OK: readonly PreflightRow[] = [
  { id: 'STORAGE', verdict: 'PASS', detail: 'ok' },
  { id: 'SESSION_PERSISTENCE', verdict: 'PASS', detail: 'ok' },
  { id: 'BLACKBOX_BUFFER', verdict: 'PASS', detail: 'ok' },
  { id: 'OBD_ACCESS', verdict: 'PASS', detail: 'ok' },
  { id: 'GPS_ACCESS', verdict: 'PASS', detail: 'ok' },
  { id: 'BACKEND_ACCESS', verdict: 'BLOCKED_BACKEND', detail: 'eşleştirme yok' },
  { id: 'AI_POLICY', verdict: 'BLOCKED_POLICY', detail: 'kapalı' },
  { id: 'SNAPSHOT_EXPORTER', verdict: 'PASS', detail: 'ok' },
];

const preflightOverride: { rows: readonly PreflightRow[] } = { rows: PREFLIGHT_OK };

vi.mock('../platform/fieldValidation/longRoadSources', () => ({
  emptyInjection: () => ({
    memoryPressure: null, appVisible: null, offlineQueueSize: null,
    batteryPercent: null, charging: null,
  }),
  readLongRoadSample: (wallMs: number, monoMs: number): LongRoadSample =>
    ({ ...(scripted.sample ?? baseSample()), wallMs, monoMs }),
  readSessionEnv: (): SessionEnv => ({
    appVersion: '9.9.9', buildType: 'test', apkSha256: null, gitRevision: null,
    deviceModel: 'TEST-HU', androidRelease: null, sdkInt: null,
    obdAdapter: 'real', transport: 'bt', protocolActive: 'ISO15765',
    vehicleRef: '…891234', startRegion: null,
  }),
  readPreflight: () => preflightOverride.rows,
  readAsyncAugment: async () => ({ offlineQueueSize: null, batteryPercent: null, charging: null }),
}));

vi.mock('../platform/devtools/sessionInspectorSources', () => ({
  readSessionRawSnapshot: () => ({ readAt: 1, obdStatus: null, obdData: null }),
}));

vi.mock('../platform/memoryWatchdog', () => ({
  onMemoryPressure: () => () => { /* abonelik sökme thunk'ı */ },
}));

import {
  LR_SESSION_KEY, isRecordingState,
} from '../platform/fieldValidation/longRoadModel';
import {
  LR_MAX_CHECKPOINT_LOSS_MS,
  _driveTickForTest, _resetForTest, clearLongRoadSession, getLongRoadGlance,
  getLongRoadSession, initLongRoadRecorder, startLongRoadSession, stopLongRoadSession,
  subscribeLongRoad,
} from '../platform/fieldValidation/longRoadRecorder';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

/** Belirtilen sayıda tick sürer; her tick'te sahte saati ilerletir. */
function drive(ticks: number, over: (i: number) => Partial<LongRoadSample> = () => ({})): void {
  for (let i = 0; i < ticks; i += 1) {
    scripted.sample = baseSample(over(i));
    vi.advanceTimersByTime(1_000);
    _driveTickForTest();
  }
}

/** Uygulamanın ölüp yeniden açılmasını taklit eder (disk KORUNUR). */
function simulateAppRestart(): void {
  _resetForTest();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T08:00:00.000Z'));
  preflightOverride.rows = PREFLIGHT_OK;
  scripted.sample = null;
  try { localStorage.clear(); } catch { /* jsdom yoksa yoksay */ }
  _resetForTest();
});

afterEach(() => {
  _resetForTest();
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Başlatma
 * ════════════════════════════════════════════════════════════════════════ */

describe('kaydedici · başlatma', () => {
  it('kullanıcı BAŞLAT demeden HİÇBİR ŞEY başlamaz', () => {
    expect(getLongRoadSession()).toBeNull();
    expect(getLongRoadGlance().active).toBe(false);
    /* Uygulama açılışı: kayıtlı oturum yoksa init hiçbir şey kurmaz. */
    expect(initLongRoadRecorder()).toBeNull();
    expect(getLongRoadSession()).toBeNull();
  });

  it('BAŞLAT: oturum ACTIVE olur, preflight ve ortam yazılır, diske kaydedilir', () => {
    const s = startLongRoadSession();
    expect(s.state).toBe('ACTIVE');
    expect(isRecordingState(s.state)).toBe(true);
    expect(s.preflight.length).toBe(PREFLIGHT_OK.length);
    expect(s.env.appVersion).toBe('9.9.9');
    expect(s.env.vehicleRef).toBe('…891234');
    expect(s.snapshots.length).toBe(1);
    expect(s.snapshots[0].trigger).toBe('SESSION_START');
    expect(localStorage.getItem(LR_SESSION_KEY)).not.toBeNull();
  });

  it('kalıcılık kapısı düşerse oturum BAŞLAMAZ (fail-closed)', () => {
    preflightOverride.rows = [
      { id: 'SESSION_PERSISTENCE', verdict: 'FAIL', detail: 'depolama yok' },
      { id: 'BLACKBOX_BUFFER', verdict: 'PASS', detail: 'ok' },
    ];
    const s = startLongRoadSession();
    expect(s.state).toBe('FAILED');
    expect(s.events.some((e) => e.type === 'PREFLIGHT' && e.severity === 'CRITICAL')).toBe(true);

    /* Döngü kurulmadığı için tick defteri ilerletmez. */
    drive(5);
    expect(getLongRoadSession()!.odometry.recordedMs).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Ölçüm
 * ════════════════════════════════════════════════════════════════════════ */

describe('kaydedici · ölçüm', () => {
  it('tick defteri ilerletir: süre · sinyal · mesafe', () => {
    startLongRoadSession();
    let km = 0;
    drive(60, () => { km += 0.025; return { tripTotalDistanceKm: km }; });

    const s = getLongRoadSession()!;
    expect(s.odometry.recordedMs).toBeGreaterThan(0);
    expect(s.odometry.movingMs).toBeGreaterThan(0);
    expect(s.odometry.maxSpeedKmh).toBe(90);

    const speed = s.signals.find((r) => r.id === 'speed')!;
    expect(speed.validSamples).toBeGreaterThan(50);
    expect(speed.min).toBe(90);
    expect(speed.max).toBe(90);
    expect(speed.confidence).toBe('OBSERVED');
  });

  it('süre invaryantı uzun koşumda korunur', () => {
    startLongRoadSession();
    drive(600, (i) => ({ speed: i % 5 === 0 ? 0 : 90 }));

    const o = getLongRoadSession()!.odometry;
    expect(o.movingMs + o.stoppedMs + o.unknownMs).toBe(o.recordedMs);
  });

  it('hız okunamayan örnek BİLİNMEYEN süreye yazılır (sahte duruş değil)', () => {
    startLongRoadSession();
    drive(10, () => ({ speed: null }));

    const o = getLongRoadSession()!.odometry;
    expect(o.unknownMs).toBeGreaterThan(0);
    expect(o.stoppedMs).toBe(0);
  });

  it('kritik olay defterde ve göstergede görünür', () => {
    startLongRoadSession();
    drive(3);
    drive(3, () => ({ obdDataFresh: false }));

    const s = getLongRoadSession()!;
    expect(s.counters.obdDataGapCount).toBe(1);
    expect(s.events.some((e) => e.type === 'OBD_DATA_LOST' && e.severity === 'CRITICAL')).toBe(true);
    expect(getLongRoadGlance().criticalCount).toBeGreaterThan(0);
  });

  it('kesinti SÜRERKEN en uzun kesinti güncellenir (uygulama ölse bile kayıtlı)', () => {
    startLongRoadSession();
    drive(2);
    drive(30, () => ({ obdDataFresh: false }));

    expect(getLongRoadSession()!.counters.longestObdGapMs).toBeGreaterThanOrEqual(25_000);
  });

  it('abone yalnız değişimde tetiklenir ve sökülebilir (Zero-Leak)', () => {
    const seen = vi.fn();
    const off = subscribeLongRoad(seen);
    startLongRoadSession();
    drive(3);
    expect(seen).toHaveBeenCalled();

    off();
    const before = seen.mock.calls.length;
    drive(3);
    expect(seen.mock.calls.length).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Kalıcılık ve restore (görev §13)
 * ════════════════════════════════════════════════════════════════════════ */

describe('kaydedici · oturum sürekliliği', () => {
  it('uygulama ölüp açılınca AYNI oturum devam eder, YENİ oturum açılmaz', () => {
    const first = startLongRoadSession();
    drive(40);
    const beforeMs = getLongRoadSession()!.odometry.recordedMs;

    simulateAppRestart();
    expect(getLongRoadSession()).toBeNull();          // bellek uçtu, disk duruyor

    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(restored.sessionId).toBe(first.sessionId);
    expect(restored.sessionVersion).toBe(2);
    expect(restored.restoreCount).toBe(1);
    expect(restored.lastRestoreReason).toBe('PROCESS_DEATH');
    expect(restored.state).toBe('RECOVERING');

    /* KİLİT: kayıp SIFIR değildir ama SINIRLIDIR. Son checkpoint'ten sonraki
       ölçüm penceresi kadar kaybolabilir — bu bilinçli bir eMMC bütçe takasıdır
       (bkz. LR_MAX_CHECKPOINT_LOSS_MS). Sınır büyürse bu kilit düşer. */
    expect(restored.odometry.recordedMs).toBeGreaterThan(0);
    expect(beforeMs - restored.odometry.recordedMs).toBeLessThanOrEqual(LR_MAX_CHECKPOINT_LOSS_MS);
  });

  it('restore sonrası ölçüm KALDIĞI YERDEN sürer ve PROCESS_RESTORE snapshot\'ı alınır', () => {
    startLongRoadSession();
    drive(20);

    simulateAppRestart();
    const restored = initLongRoadRecorder('APP_RESTART')!;
    const resumeBaseline = restored.odometry.recordedMs;
    drive(20);

    const s = getLongRoadSession()!;
    expect(s.odometry.recordedMs).toBeGreaterThan(resumeBaseline);
    expect(s.snapshots.some((r) => r.trigger === 'PROCESS_RESTORE')).toBe(true);
  });

  it('KRİTİK olay checkpoint aralığını BEKLEMEDEN diske yazılır', () => {
    startLongRoadSession();
    drive(2);
    /* Kritik olay üret: tazelik kaybı. */
    drive(1, () => ({ obdDataFresh: false }));

    simulateAppRestart();
    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(restored.events.some((e) => e.type === 'OBD_DATA_LOST')).toBe(true);
    expect(restored.counters.obdDataGapCount).toBe(1);
  });

  it('restore olayı defterde iz bırakır (sessiz devam yok)', () => {
    startLongRoadSession();
    drive(5);
    simulateAppRestart();
    const restored = initLongRoadRecorder('DEVICE_REBOOT')!;
    expect(restored.events.some((e) => e.type === 'RESTORE')).toBe(true);
  });

  it('BOZUK kayıt sessizce yeni oturuma dönüşmez → CORRUPT', () => {
    startLongRoadSession();
    drive(3);
    simulateAppRestart();
    localStorage.setItem(LR_SESSION_KEY, '{bu json değil');

    const s = initLongRoadRecorder()!;
    expect(s.state).toBe('CORRUPT');
    expect(isRecordingState(s.state)).toBe(false);
  });

  it('TAMAMLANMIŞ oturum restore\'da ölçüme DEVAM ETMEZ (yalnız rapor için yüklenir)', () => {
    startLongRoadSession();
    drive(5);
    stopLongRoadSession();

    simulateAppRestart();
    const s = initLongRoadRecorder()!;
    expect(s.state).toBe('COMPLETED');

    const before = s.odometry.recordedMs;
    drive(10);
    expect(getLongRoadSession()!.odometry.recordedMs).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Durdurma ve temizleme
 * ════════════════════════════════════════════════════════════════════════ */

describe('kaydedici · durdurma', () => {
  it('DURDUR: COMPLETED olur, bitiş damgası ve son snapshot yazılır', () => {
    startLongRoadSession();
    drive(30);
    const s = stopLongRoadSession()!;

    expect(s.state).toBe('COMPLETED');
    expect(s.endedAt).not.toBeNull();
    expect(s.snapshots.some((r) => r.trigger === 'SESSION_END')).toBe(true);
    expect(getLongRoadGlance().active).toBe(false);
  });

  it('durdurulmuş oturumda tick defteri İLERLETMEZ (zamanlayıcı sızıntısı yok)', () => {
    startLongRoadSession();
    drive(10);
    stopLongRoadSession();
    const frozen = getLongRoadSession()!.odometry.recordedMs;

    drive(20);
    expect(getLongRoadSession()!.odometry.recordedMs).toBe(frozen);
  });

  it('SİL: oturum ve kanıt diskten kalkar', () => {
    startLongRoadSession();
    drive(5);
    clearLongRoadSession();

    expect(getLongRoadSession()).toBeNull();
    expect(localStorage.getItem(LR_SESSION_KEY)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Snapshot politikası runtime'da
 * ════════════════════════════════════════════════════════════════════════ */

describe('kaydedici · snapshot politikası', () => {
  it('olay fırtınasında snapshot ÇOĞALMAZ', () => {
    startLongRoadSession();
    drive(2);

    /* Tazelik 20 kez gidip gelirse → 20 snapshot DEĞİL. */
    for (let i = 0; i < 20; i += 1) {
      drive(1, () => ({ obdDataFresh: false }));
      drive(1, () => ({ obdDataFresh: true }));
    }

    const s = getLongRoadSession()!;
    const lossSnaps = s.snapshots.filter((r) => r.trigger === 'OBD_DATA_LOSS');
    expect(lossSnaps.length).toBeLessThanOrEqual(1);
    expect(s.snapshotPolicy.suppressedCount).toBeGreaterThan(0);
  });

  it('mesafe eşiği geçilince periyodik snapshot alınır', () => {
    startLongRoadSession();
    let km = 0;
    drive(200, () => { km += 1; return { tripTotalDistanceKm: km }; });

    expect(getLongRoadSession()!.snapshots.some((r) => r.trigger === 'PERIODIC_DISTANCE')).toBe(true);
  });

  it('snapshot sayısı bütçeyi AŞMAZ', () => {
    startLongRoadSession();
    let km = 0;
    drive(3_000, () => { km += 1; return { tripTotalDistanceKm: km }; });

    const s = getLongRoadSession()!;
    expect(s.snapshots.length).toBeLessThanOrEqual(64);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · Gösterge sözleşmesi (görev §14)
 * ════════════════════════════════════════════════════════════════════════ */

describe('sürüş göstergesi', () => {
  it('hareket hâlinde özet AÇILAMAZ', () => {
    startLongRoadSession();
    drive(3, () => ({ speed: 90 }));
    expect(getLongRoadGlance().moving).toBe(true);
  });

  it('araç durunca özet açılabilir', () => {
    startLongRoadSession();
    drive(3, () => ({ speed: 0 }));
    expect(getLongRoadGlance().moving).toBe(false);
  });

  it('hız BİLİNMİYORSA hareket VARSAYILIR (fail-closed: dikkat dağıtma)', () => {
    startLongRoadSession();
    drive(3, () => ({ speed: null }));
    expect(getLongRoadGlance().moving).toBe(true);
  });
});
