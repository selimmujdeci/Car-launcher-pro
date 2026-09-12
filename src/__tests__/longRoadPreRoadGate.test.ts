/**
 * longRoadPreRoadGate.test.ts — YOL ÖNCESİ GÜVENLİK KAPISI (pre-road §3 · §4).
 *
 * Araç bağlanmadan ÖNCE yerelde koşan uçtan uca kapı. Amaç "yeşil görmek"
 * değil, uzun yolda kanıt kaybettirecek her yolu ÖNCEDEN kapatmak.
 *
 * §4 kuralı burada da kilitlidir: **eksik kapı testi TAMAMEN ENGELLEMEZ** —
 * yalnız ilgili alan BLOCKED yazılır, ölçüm devam eder. Tek istisna kanıtın
 * SAKLANAMAMASIDIR (kalıcılık / tampon), çünkü o hâlde ölçmenin anlamı yoktur.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LongRoadSample } from '../platform/fieldValidation/longRoadDetect';
import type { PreflightRow, SessionEnv } from '../platform/fieldValidation/longRoadModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Mock'lar — gerçek OBD/GPS/ağ servisine DOKUNULMAZ
 * ════════════════════════════════════════════════════════════════════════ */

const scripted: { sample: LongRoadSample | null } = { sample: null };
const preflight: { rows: readonly PreflightRow[] } = { rows: [] };

function baseSample(over: Partial<LongRoadSample> = {}): LongRoadSample {
  return {
    wallMs: 0, monoMs: 0,
    obdTransportConnected: true, obdDataFresh: true, obdConnectionState: 'connected',
    obdSource: 'real', obdLastPacketAgeMs: 110, handshakeOutcome: 'ok',
    protocolActive: 'ISO15765', protocolTried: 'ISO15765', vinPresent: true,
    supportedPidCount: 22, reconnectRequested: 0, resetRequested: 0, disconnectCalled: 0,
    transportReconnectAttempts: 0, kwpStatus: 'idle', kwpRecoveryCount: 0,
    kwpSuppressedCount: 0, kwpAtpcFailures: 0, canRetryCount: 0, halActiveSource: 'obd',
    speed: 88, rpm: 2100, engineTemp: 89, throttle: 22, intakeTemp: 28,
    fuelLevel: 55, batteryVoltage: 14.2,
    locationState: 'LIVE', locationProvider: 'gps', locationAccuracyM: 5,
    locationFixAgeMs: 300, gpsSwitchCount: 0, gpsFallbackCount: 0,
    tripActive: true, tripTotalDistanceKm: 0, tripTotalCount: 1,
    online: true, telemetryReportPresent: false, offlineQueueSize: null,
    runtimeMode: 'BALANCED', thermalLevel: 0, ramPressureRatio: 0.2,
    uiFreezeCount: 0, workerRestartTotal: 0, memoryPressure: null,
    appVisible: true, batteryPercent: null, charging: null,
    ...over,
  };
}

/** §4'teki ALTI başlangıç kapısı — hepsi geçerken. */
const GATES_OK: readonly PreflightRow[] = [
  { id: 'OBD_ACCESS', verdict: 'PASS', detail: 'OBD yüzeyi okunabiliyor' },
  { id: 'GPS_ACCESS', verdict: 'PASS', detail: 'Konum hakemi okunabiliyor' },
  { id: 'STORAGE', verdict: 'PASS', detail: 'yaz/oku/sil + bütçe payı var' },
  { id: 'SESSION_PERSISTENCE', verdict: 'PASS', detail: 'kalıcılık hazır' },
  { id: 'BLACKBOX_BUFFER', verdict: 'PASS', detail: 'halka hazır' },
  { id: 'SNAPSHOT_EXPORTER', verdict: 'PASS', detail: 'exporter hazır' },
];

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
  readPreflight: () => preflight.rows,
  readAsyncAugment: async () => ({ offlineQueueSize: null, batteryPercent: null, charging: null }),
}));

vi.mock('../platform/devtools/sessionInspectorSources', () => ({
  readSessionRawSnapshot: () => ({ readAt: 1, obdStatus: null, obdData: null }),
}));

vi.mock('../platform/memoryWatchdog', () => ({
  onMemoryPressure: () => () => { /* sökme thunk'ı */ },
}));

import {
  LR_MAX_TOTAL_BYTES, LR_SESSION_KEY, applyStoragePressure, migrateSession,
} from '../platform/fieldValidation/longRoadModel';
import {
  _driveTickForTest, _resetForTest, checkpointLongRoad, clearLongRoadSession,
  getLongRoadBlackBox, getLongRoadBodies, getLongRoadSession, initLongRoadRecorder,
  startLongRoadSession, stopLongRoadSession,
} from '../platform/fieldValidation/longRoadRecorder';
import { allWindows, blackBoxMetas } from '../platform/fieldValidation/longRoadBlackBox';
import { buildLongRoadReport } from '../platform/fieldValidation/longRoadReport';
import { classifyStoragePressure, loadSession } from '../platform/fieldValidation/longRoadStore';
import { validateSelf } from '../platform/fieldValidation/longRoadSelfValidator';

/* ── Sürücü ──────────────────────────────────────────────────────────────── */

function drive(ticks: number, over: (i: number) => Partial<LongRoadSample> = () => ({})): void {
  for (let i = 0; i < ticks; i += 1) {
    scripted.sample = baseSample(over(i));
    vi.advanceTimersByTime(1_000);
    _driveTickForTest();
  }
}

function simulateAppDeath(): void { _resetForTest(); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T06:00:00.000Z'));
  preflight.rows = GATES_OK;
  scripted.sample = null;
  try { localStorage.clear(); } catch { /* yoksay */ }
  _resetForTest();
});

afterEach(() => {
  _resetForTest();
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════════════
 * §4 · GERÇEK ARAÇ BAŞLANGIÇ KAPISI
 * ════════════════════════════════════════════════════════════════════════ */

describe('PRE-ROAD §4 · başlangıç kapısı', () => {
  it('altı kapının hepsi oturuma kaydedilir', () => {
    const s = startLongRoadSession();
    const ids = s.preflight.map((p) => p.id).sort();
    expect(ids).toEqual([
      'BLACKBOX_BUFFER', 'GPS_ACCESS', 'OBD_ACCESS',
      'SESSION_PERSISTENCE', 'SNAPSHOT_EXPORTER', 'STORAGE',
    ]);
  });

  it('OBD YOKKEN test ÇALIŞMAYA DEVAM EDER (yalnız o alan BLOCKED)', () => {
    preflight.rows = GATES_OK.map((r) =>
      (r.id === 'OBD_ACCESS' ? { ...r, verdict: 'BLOCKED_HARDWARE' as const, detail: 'OBD yok' } : r));

    const s = startLongRoadSession();
    expect(s.state).toBe('ACTIVE');

    drive(30);
    const after = getLongRoadSession()!;
    expect(after.odometry.recordedMs).toBeGreaterThan(0);
    expect(after.preflight.find((p) => p.id === 'OBD_ACCESS')!.verdict).toBe('BLOCKED_HARDWARE');
  });

  it('GPS İZNİ REDDEDİLMİŞKEN test ÇALIŞMAYA DEVAM EDER', () => {
    preflight.rows = GATES_OK.map((r) =>
      (r.id === 'GPS_ACCESS' ? { ...r, verdict: 'BLOCKED_POLICY' as const, detail: 'izin reddedildi' } : r));

    const s = startLongRoadSession();
    expect(s.state).toBe('ACTIVE');
    drive(20);
    expect(getLongRoadSession()!.odometry.recordedMs).toBeGreaterThan(0);
  });

  it('exporter DEGRADED iken bile ölçüm sürer', () => {
    preflight.rows = GATES_OK.map((r) =>
      (r.id === 'SNAPSHOT_EXPORTER' ? { ...r, verdict: 'DEGRADED' as const, detail: 'kaynak okunamadı' } : r));

    expect(startLongRoadSession().state).toBe('ACTIVE');
    drive(10);
    expect(getLongRoadSession()!.odometry.recordedMs).toBeGreaterThan(0);
  });

  it('KANIT SAKLANAMIYORSA oturum BAŞLAMAZ (tek meşru engel)', () => {
    for (const fatal of ['SESSION_PERSISTENCE', 'BLACKBOX_BUFFER'] as const) {
      _resetForTest();
      try { localStorage.clear(); } catch { /* yoksay */ }
      preflight.rows = GATES_OK.map((r) => (r.id === fatal ? { ...r, verdict: 'FAIL' as const, detail: 'yok' } : r));

      const s = startLongRoadSession();
      expect(s.state, `${fatal} düşerken oturum başlamamalı`).toBe('FAILED');
      drive(5);
      expect(getLongRoadSession()!.odometry.recordedMs).toBe(0);
    }
  });

  it('BLOCKED kapılar rapora AÇIKÇA yazılır (gizlenmez)', () => {
    preflight.rows = GATES_OK.map((r) =>
      (r.id === 'OBD_ACCESS' ? { ...r, verdict: 'BLOCKED_HARDWARE' as const, detail: 'OBD yok' } : r));
    startLongRoadSession();
    drive(5);

    const rep = buildLongRoadReport({
      session: getLongRoadSession()!, blackBox: [], snapshotBodies: [], nowMs: Date.now(),
    });
    expect(rep.markdown).toContain('OBD_ACCESS');
    expect(rep.markdown).toContain('BLOCKED_HARDWARE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 · PRE-ROAD PREFLIGHT — 11 madde
 * ════════════════════════════════════════════════════════════════════════ */

describe('PRE-ROAD §3 · yerel preflight', () => {
  it('1 · oturum başlat/durdur', () => {
    const started = startLongRoadSession();
    expect(started.state).toBe('ACTIVE');
    drive(20);
    const stopped = stopLongRoadSession()!;
    expect(stopped.state).toBe('COMPLETED');
    expect(stopped.endedAt).not.toBeNull();
  });

  it('2 · process restore — aynı oturum, sayaç sıçraması YOK', () => {
    const first = startLongRoadSession();
    drive(45);
    simulateAppDeath();

    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(restored.sessionId).toBe(first.sessionId);
    expect(restored.sessionVersion).toBe(2);

    drive(20);
    const s = getLongRoadSession()!;
    /* Öz-denetim sıçrama görmemeli. */
    const self = validateSelf(s, allWindows(getLongRoadBlackBox()), Date.now());
    const jump = self.rows.find((r) => r.id === 'RESTART_COUNTER_JUMP')!;
    expect(jump.result).toBe('VERIFIED');
  });

  it('3 · storage bütçesi — tavan ve baskı sınıflandırması dürüst', () => {
    expect(classifyStoragePressure(0)).toBe('OK');
    expect(classifyStoragePressure(LR_MAX_TOTAL_BYTES)).toBe('CRITICAL');
    /* ÖLÇÜLEMEYEN durum iyimser sayılmaz. */
    expect(classifyStoragePressure(null)).toBe('WARN');
  });

  it('4 · snapshot cooldown — fırtınada çoğalmaz', () => {
    startLongRoadSession();
    drive(2);
    for (let i = 0; i < 15; i += 1) {
      drive(1, () => ({ obdDataFresh: false }));
      drive(1, () => ({ obdDataFresh: true }));
    }
    const s = getLongRoadSession()!;
    expect(s.snapshots.filter((r) => r.trigger === 'OBD_DATA_LOSS').length).toBeLessThanOrEqual(1);
    expect(s.snapshotPolicy.suppressedCount).toBeGreaterThan(0);
  });

  it('5 · BlackBox kapanışı — 120 sn sonra pencere KAPANIR', () => {
    startLongRoadSession();
    drive(3);
    drive(1, () => ({ obdDataFresh: false }));          // kritik olay → pencere açılır
    expect(getLongRoadBlackBox().open.length).toBe(1);

    drive(125, () => ({ obdDataFresh: true }));         // post süresi dolsun
    const bb = getLongRoadBlackBox();
    expect(bb.open.length).toBe(0);
    expect(bb.closed.length).toBe(1);
    expect(bb.closed[0].postWindowComplete).toBe(true);
  });

  it('6 · kritik olay ANINDA kalıcı — checkpoint beklemez', () => {
    startLongRoadSession();
    drive(2);
    drive(1, () => ({ obdDataFresh: false }));
    simulateAppDeath();

    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(restored.events.some((e) => e.type === 'OBD_DATA_LOST' && e.severity === 'CRITICAL')).toBe(true);
    expect(restored.counters.obdDataGapCount).toBe(1);
  });

  it('7 · rapor üretimi — markdown + JSON + öz-denetim', () => {
    startLongRoadSession();
    drive(60);
    const bb = getLongRoadBlackBox();
    const rep = buildLongRoadReport({
      session: getLongRoadSession()!,
      blackBox: blackBoxMetas(bb),
      snapshotBodies: getLongRoadBodies() as unknown[],
      blackBoxWindows: allWindows(bb),
      nowMs: Date.now(),
    });
    expect(rep.markdown).toContain('UZUN YOL SAHA DOĞRULAMA RAPORU');
    expect(() => JSON.parse(rep.json)).not.toThrow();
    /* 8 özgün denetim + D1–D3 turunda eklenen 6 denetim = 14. */
    expect(rep.selfValidation.rows.length).toBe(14);
    expect(rep.selfValidation.affectsAcceptanceVerdict).toBe(false);
  });

  it('8 · maskelenmiş export — gizlilik taraması PASS', () => {
    startLongRoadSession();
    drive(30);
    const rep = buildLongRoadReport({
      session: getLongRoadSession()!, blackBox: [], snapshotBodies: getLongRoadBodies() as unknown[],
      nowMs: Date.now(),
    });
    expect(rep.privacy.verdict).toBe('PASS');
    expect(rep.privacy.violations).toEqual([]);
    /* Diskteki gövde de maskeli olmalı. */
    const raw = localStorage.getItem(LR_SESSION_KEY) ?? '';
    expect(raw).not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    expect(raw).not.toMatch(/"(latitude|longitude)"\s*:/);
  });

  it('9 · bozuk kayıt reddi — fail-closed, yeni oturum GİBİ görünmez', () => {
    startLongRoadSession();
    drive(5);
    simulateAppDeath();
    localStorage.setItem(LR_SESSION_KEY, '{bozuk');

    expect(loadSession().kind).toBe('CORRUPT');
    const s = initLongRoadRecorder()!;
    expect(s.state).toBe('CORRUPT');

    /* Bozuk oturumda öz-denetim de uydurma doğrulama YAPMAZ. */
    const self = validateSelf(s, [], Date.now());
    expect(self.verdict).toBe('CORRUPT');
    expect(self.verifiedCount).toBe(0);
  });

  it('10 · storage pressure — KRİTİK kayıt korunur, INFO budanır', () => {
    startLongRoadSession();
    drive(3);
    drive(1, () => ({ obdDataFresh: false }));          // CRITICAL olay
    drive(3, () => ({ obdDataFresh: true }));

    const before = getLongRoadSession()!;
    const criticalBefore = before.events.filter((e) => e.severity === 'CRITICAL').length;
    expect(criticalBefore).toBeGreaterThan(0);

    const pruned = applyStoragePressure(before, 'CRITICAL', LR_MAX_TOTAL_BYTES + 1);
    expect(pruned.events.filter((e) => e.severity === 'CRITICAL').length).toBe(criticalBefore);
    expect(pruned.events.some((e) => e.severity === 'INFO')).toBe(false);
  });

  it('11 · uzun süreli saat simülasyonu — 2 saat, defter tutarlı', () => {
    startLongRoadSession();
    let km = 0;
    /* 7200 tick = 2 saat @1 Hz. */
    drive(7_200, (i) => {
      const moving = i % 60 !== 0;
      if (moving) km += 90 / 3_600;
      return { speed: moving ? 90 : 0, tripTotalDistanceKm: km };
    });

    const s = getLongRoadSession()!;
    const o = s.odometry;
    expect(o.movingMs + o.stoppedMs + o.unknownMs).toBe(o.recordedMs);
    expect(o.recordedMs).toBeGreaterThan(7_100_000);
    expect(s.snapshots.length).toBeLessThanOrEqual(64);

    /* İki saatlik koşumun ÖLÇÜLEN öz-denetim sonucu — zayıf "hata yok" yerine
       gerçek tablo kilitlenir. Kritik olay ve restore YAŞANMADIĞI için ilgili
       denetimler dürüstçe NOT_CHECKED kalır; sessizce VERIFIED SAYILMAZ.
       D1–D3 turunda altı denetim eklendi (kilit KALDIRILMADI, GÜNCELLENDİ). */
    const self = validateSelf(s, allWindows(getLongRoadBlackBox()), Date.now());
    const table = Object.fromEntries(self.rows.map((r) => [r.id, r.result]));
    expect(table).toEqual({
      RAW_EVENT_PRESENT: 'VERIFIED',
      TIME_RANGE: 'VERIFIED',
      COUNTER_RECOMPUTE: 'VERIFIED',
      NULL_NOT_VERDICT: 'VERIFIED',
      DUPLICATE_EVENTS: 'VERIFIED',
      DROPPED_IMPACT: 'VERIFIED',
      CHECKPOINT_RING: 'NOT_CHECKED',      // kritik olay yaşanmadı → pencere yok
      RESTART_COUNTER_JUMP: 'NOT_CHECKED', // restore yaşanmadı
      EVENT_ID_INTEGRITY: 'VERIFIED',      // D1 — kimlikler benzersiz
      SEQUENCE_MONOTONICITY: 'VERIFIED',   // D1 — sekans artıyor
      FIRST_EVENT_UNIQUENESS: 'VERIFIED',  // D1 — "ilk" senaryolar birer kez
      BLACKBOX_INTEGRITY: 'NOT_CHECKED',   // D2 — pencere yok, ölçüm verilmedi
      SNAPSHOT_REFERENCE: 'NOT_CHECKED',   // D3 — gövde kimlikleri verilmedi
      SNAPSHOT_QUOTA: 'VERIFIED',          // D3 — sınıf sayaçları tutarlı
    });
    expect(self.verifiedCount).toBe(10);
    expect(self.problemCount).toBe(0);
    /* Genel hüküm EN KÖTÜ satırdır: 10 doğrulama "tam doğrulandı" demek DEĞİLDİR. */
    expect(self.verdict).toBe('NOT_CHECKED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Kapanış — temizlik ve elle checkpoint
 * ════════════════════════════════════════════════════════════════════════ */

describe('PRE-ROAD · kapanış', () => {
  it('elle checkpoint diske yazar, oturumu BİTİRMEZ', () => {
    startLongRoadSession();
    drive(5);
    checkpointLongRoad();

    const raw = localStorage.getItem(LR_SESSION_KEY);
    expect(raw).not.toBeNull();
    expect(migrateSession(JSON.parse(raw!))!.state).toBe('ACTIVE');
    expect(getLongRoadSession()!.state).toBe('ACTIVE');
  });

  it('SİL kanıtı tamamen kaldırır', () => {
    startLongRoadSession();
    drive(5);
    clearLongRoadSession();
    expect(getLongRoadSession()).toBeNull();
    expect(localStorage.getItem(LR_SESSION_KEY)).toBeNull();
  });
});
