/**
 * longRoadBlockerFixesD1D3.test.ts — BAĞIMSIZ DENETİM BLOKLAYICILARI D1–D3.
 *
 * Bu dosya, `docs/AUTONOMOUS_FIELD_VALIDATION_P0_INDEPENDENT_AUDIT.md`
 * raporunun **ampirik olarak ölçtüğü** üç bloklayıcıyı kilitler:
 *
 *   D1 · restore sonrası olay kimliği ÇAKIŞMASI (öz-denetim CORRUPT oluyordu)
 *   D2 · BlackBox blob'unun her 30 sn'de TAMAMEN yeniden yazılması (eMMC)
 *   D3 · periyodik snapshot'ların kritik snapshot kotasını tüketmesi
 *
 * ── TEST DİSİPLİNİ ──────────────────────────────────────────────────────────
 *  · Kalıcılık GERÇEK üretim yolundan geçer: `longRoadStore` → `safeStorage` →
 *    jsdom `localStorage`. Depolama katmanı MOCK'LANMAZ (aksi hâlde "restore
 *    çalışıyor" iddiası kendi mock'unu doğrulamış olurdu).
 *  · MOCK'lanan tek şey OKUMA katmanıdır (`longRoadSources`) — testin gerçek
 *    OBD/GPS/ağ servislerine dokunmaması için. Bu bir kanıt zayıflığı değil,
 *    PASİFLİK şartıdır.
 *  · Yazma HACMİ tahmin edilmez, `readStoreWriteStats()` ile SAYILIR.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LongRoadSample } from '../platform/fieldValidation/longRoadDetect';
import type { PreflightRow, SessionEnv } from '../platform/fieldValidation/longRoadModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Mock'lar — YALNIZ okuma katmanı
 * ════════════════════════════════════════════════════════════════════════ */

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
  readPreflight: () => PREFLIGHT_OK,
  readAsyncAugment: async () => ({ offlineQueueSize: null, batteryPercent: null, charging: null }),
}));

vi.mock('../platform/devtools/sessionInspectorSources', () => ({
  readSessionRawSnapshot: () => ({ readAt: 1, obdStatus: null, obdData: null }),
}));

vi.mock('../platform/memoryWatchdog', () => ({
  onMemoryPressure: () => () => { /* abonelik sökme thunk'ı */ },
}));

import {
  LR_BLACKBOX_KEY, LR_MAX_SNAPSHOTS, LR_SESSION_KEY,
  LR_SNAPSHOT_CRITICAL_QUOTA, LR_SNAPSHOT_PERIODIC_QUOTA,
  applyStoragePressure, chooseCriticalEvictionVictim, classifySnapshotDrop, createSession,
  decideSnapshot, emptySnapshotPolicy, formatRecordId, migrateSession, parseRecordId,
  scanRecordIdentity, snapshotClass,
  type SnapshotIndexRow, type SnapshotTrigger,
} from '../platform/fieldValidation/longRoadModel';
import {
  _resetStoreWriteStatsForTest, blackBoxChecksum, loadBlackBoxOutcome, readStoreWriteStats,
} from '../platform/fieldValidation/longRoadStore';
import {
  _driveTickForTest, _resetForTest, checkpointLongRoad, clearLongRoadSession,
  getLongRoadBlackBox, getLongRoadBlackBoxLoad, getLongRoadBodies, getLongRoadIdentityScan,
  getLongRoadSession, initLongRoadRecorder, startLongRoadSession, stopLongRoadSession,
} from '../platform/fieldValidation/longRoadRecorder';
import { allWindows } from '../platform/fieldValidation/longRoadBlackBox';
import { validateSelf } from '../platform/fieldValidation/longRoadSelfValidator';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function drive(ticks: number, over: (i: number) => Partial<LongRoadSample> = () => ({})): void {
  for (let i = 0; i < ticks; i += 1) {
    scripted.sample = baseSample(over(i));
    vi.advanceTimersByTime(1_000);
    _driveTickForTest();
  }
}

/** Uygulamanın ÖLÜP yeniden açılması: bellek uçar, DİSK korunur. */
function simulateProcessDeath(): void {
  _resetForTest();
}

/** Oturumdaki TÜM kayıt kimlikleri (olay + snapshot). */
function allIds(): string[] {
  const s = getLongRoadSession()!;
  return [...s.events.map((e) => e.id), ...s.snapshots.map((r) => r.id)];
}

function countDuplicates(ids: readonly string[]): number {
  const seen = new Set<string>();
  let dup = 0;
  for (const id of ids) { if (seen.has(id)) dup += 1; else seen.add(id); }
  return dup;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T08:00:00.000Z'));
  scripted.sample = null;
  try { localStorage.clear(); } catch { /* jsdom yoksa yoksay */ }
  _resetForTest();
  _resetStoreWriteStatsForTest();
});

afterEach(() => {
  _resetForTest();
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════════════
 * D1 · KİMLİK MODELİ (saf katman)
 * ════════════════════════════════════════════════════════════════════════ */

describe('D1 · kimlik modeli (saf)', () => {
  it('yeni biçim sürüm + sekans taşır, eski düz biçim hâlâ okunur', () => {
    expect(formatRecordId('EV', 3, 42)).toBe('EV-v3-42');
    expect(parseRecordId('EV-v3-42')).toEqual({ prefix: 'EV', version: 3, sequence: 42 });
    expect(parseRecordId('EV-7')).toEqual({ prefix: 'EV', version: null, sequence: 7 });
    expect(parseRecordId('SNAP-v1-1')).toEqual({ prefix: 'SNAP', version: 1, sequence: 1 });
  });

  it('çözülemeyen kimlik YOK SAYILIR ama RAPORLANIR (sessizce yutulmaz)', () => {
    const scan = scanRecordIdentity(['EV-v1-1', 'çöp', 'EV-v1-2', '']);
    expect(scan.unparsable).toBe(2);
    expect(scan.maxSequence).toBe(2);
    expect(scan.verdict).toBe('DEGRADED_UNPARSABLE');
    expect(scan.samples.length).toBeGreaterThan(0);
  });

  it('RESTORE kimliği sekanssızdır ama ÇÖZÜLEMEYEN sayılmaz', () => {
    const scan = scanRecordIdentity(['EV-v1-1', 'RESTORE-LR-ABC-2']);
    expect(scan.unsequenced).toBe(1);
    expect(scan.unparsable).toBe(0);
    expect(scan.verdict).toBe('OK');
  });

  it('kopya KİMLİK ve kopya SEKANS fail-closed hüküm üretir', () => {
    expect(scanRecordIdentity(['EV-v1-1', 'EV-v1-1']).verdict).toBe('FAIL_DUPLICATE_ID');
    /* Farklı sürüm, AYNI sekans → sayaç iki kez dağıtılmış demektir. */
    expect(scanRecordIdentity(['EV-v1-5', 'EV-v2-5']).verdict).toBe('FAIL_DUPLICATE_SEQUENCE');
  });

  it('sekans BOŞLUĞU hata değildir — hüküm OK kalır, boşluk sayılır', () => {
    const scan = scanRecordIdentity(['EV-v1-1', 'EV-v1-9']);
    expect(scan.verdict).toBe('OK');
    expect(scan.sequenceGaps).toBe(7);
    expect(scan.maxSequence).toBe(9);
  });

  it('tarama SON kayda değil TÜM deftere bakar (en büyük ortada olabilir)', () => {
    const scan = scanRecordIdentity(['EV-v1-3', 'EV-v1-99', 'EV-v1-4']);
    expect(scan.maxSequence).toBe(99);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D1 · RESTORE BÜTÜNLÜĞÜ (gerçek kalıcılık yolu)
 * ════════════════════════════════════════════════════════════════════════ */

describe('D1 · restore sonrası kayıt kimliği', () => {
  it('TEK process death: kimlik ÇAKIŞMASI YOK, sessionId aynı, sürüm artar', () => {
    const first = startLongRoadSession();
    drive(40);
    const before = allIds();
    expect(countDuplicates(before)).toBe(0);

    simulateProcessDeath();
    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(restored.sessionId).toBe(first.sessionId);
    expect(restored.sessionVersion).toBe(2);

    /* Restore sonrası YENİ olaylar üret. */
    drive(40, () => ({ speed: 12 }));

    const after = allIds();
    /* DENETİMİN ÖLÇTÜĞÜ KUSUR: eskiden `EV-2`, `EV-3` ikinci kez yazılıyordu. */
    expect(countDuplicates(after)).toBe(0);
    expect(getLongRoadIdentityScan().duplicateIds).toBe(0);
    expect(getLongRoadSession()!.identity.lastScanVerdict).toBe('OK');
  });

  it('ART ARDA 3 restore: hiçbir kimlik tekrar etmez, sürüm 4 olur', () => {
    startLongRoadSession();
    drive(20);
    for (let i = 0; i < 3; i += 1) {
      simulateProcessDeath();
      initLongRoadRecorder('PROCESS_DEATH');
      drive(20, () => ({ speed: 30 + i * 10 }));
    }
    const s = getLongRoadSession()!;
    expect(s.sessionVersion).toBe(4);
    expect(s.restoreCount).toBe(3);
    expect(countDuplicates(allIds())).toBe(0);
    expect(s.identity.seedCount).toBe(3);
  });

  it('yeni sekans defterdeki EN BÜYÜK değerden BÜYÜK başlar', () => {
    startLongRoadSession();
    drive(30);
    const maxBefore = Math.max(
      ...allIds().map((id) => parseRecordId(id)?.sequence ?? 0),
    );

    simulateProcessDeath();
    initLongRoadRecorder('PROCESS_DEATH');
    drive(5, () => ({ obdDataFresh: false }));      // yeni olay üret

    const fresh = allIds()
      .map((id) => parseRecordId(id))
      .filter((p) => p !== null && p.version === 2);
    expect(fresh.length).toBeGreaterThan(0);
    for (const p of fresh) expect(p!.sequence).toBeGreaterThan(maxBefore);
  });

  it('BUDANMIŞ defterde bile çakışma üretmez (yüksek-su işareti korur)', () => {
    startLongRoadSession();
    drive(30);
    const highWater = getLongRoadSession()!.identity.idHighWater;
    expect(highWater).toBeGreaterThan(0);

    /* Diskteki olay defterini TAMAMEN sil ama kimlik defterini bırak —
       en agresif budama senaryosu. */
    const raw = JSON.parse(localStorage.getItem(LR_SESSION_KEY)!) as Record<string, unknown>;
    raw.events = [];
    raw.snapshots = [];
    localStorage.setItem(LR_SESSION_KEY, JSON.stringify(raw));

    simulateProcessDeath();
    initLongRoadRecorder('PROCESS_DEATH');
    drive(5, () => ({ obdDataFresh: false }));

    for (const id of allIds()) {
      const p = parseRecordId(id);
      if (p !== null && p.version === 2) expect(p.sequence).toBeGreaterThan(highWater);
    }
    expect(countDuplicates(allIds())).toBe(0);
  });

  it('BOZUK eventId taramayı düşürmez: yok sayılır, WARN olayı yazılır', () => {
    startLongRoadSession();
    drive(20);
    const raw = JSON.parse(localStorage.getItem(LR_SESSION_KEY)!) as { events: { id: string }[] };
    raw.events[0].id = 'BU-BIR-KIMLIK-DEGIL';
    localStorage.setItem(LR_SESSION_KEY, JSON.stringify(raw));

    simulateProcessDeath();
    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(getLongRoadIdentityScan().unparsable).toBeGreaterThan(0);
    expect(restored.identity.lastScanVerdict).toBe('DEGRADED_UNPARSABLE');
    expect(restored.events.some(
      (e) => e.type === 'IDENTITY_INTEGRITY' && e.severity === 'WARN',
    )).toBe(true);
  });

  it('KOPYA sekans diskte varsa sessizce devam edilmez → KRİTİK olay + FAIL hüküm', () => {
    startLongRoadSession();
    drive(20);
    const raw = JSON.parse(localStorage.getItem(LR_SESSION_KEY)!) as { events: { id: string }[] };
    /* İki farklı olaya AYNI sekansı ver (farklı sürüm önekiyle). */
    raw.events[0].id = 'EV-v1-77';
    raw.events[1].id = 'EV-v9-77';
    localStorage.setItem(LR_SESSION_KEY, JSON.stringify(raw));

    simulateProcessDeath();
    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(restored.identity.lastScanVerdict).toBe('FAIL_DUPLICATE_SEQUENCE');
    expect(restored.events.some(
      (e) => e.type === 'IDENTITY_INTEGRITY' && e.severity === 'CRITICAL',
    )).toBe(true);
  });

  it('KRİTİK olaydan sonra restore: eski olaylar YENİDEN YAZILMAZ', () => {
    startLongRoadSession();
    drive(3);
    drive(2, () => ({ obdDataFresh: false }));       // OBD_DATA_LOST (CRITICAL)
    const criticalBefore = getLongRoadSession()!.events
      .filter((e) => e.type === 'OBD_DATA_LOST').length;
    expect(criticalBefore).toBe(1);

    simulateProcessDeath();
    initLongRoadRecorder('PROCESS_DEATH');
    drive(10, () => ({ obdDataFresh: true }));

    const after = getLongRoadSession()!.events.filter((e) => e.type === 'OBD_DATA_LOST');
    expect(after.length).toBe(1);                    // replay YOK
    expect(countDuplicates(allIds())).toBe(0);
  });

  it('restore FIRST_VEHICLE_LINK ve FIRST_HANDSHAKE_OK\'i TEKRAR ÜRETMEZ', () => {
    startLongRoadSession();
    drive(10);
    const s0 = getLongRoadSession()!;
    expect(s0.scenarios.find((x) => x.id === 'FIRST_VEHICLE_LINK')!.hits).toBe(1);
    expect(s0.scenarios.find((x) => x.id === 'FIRST_HANDSHAKE_OK')!.hits).toBe(1);

    simulateProcessDeath();
    initLongRoadRecorder('PROCESS_DEATH');
    drive(10);

    const s1 = getLongRoadSession()!;
    /* DENETİMİN ÖLÇTÜĞÜ KUSUR: 1 → 2 oluyordu. */
    expect(s1.scenarios.find((x) => x.id === 'FIRST_VEHICLE_LINK')!.hits).toBe(1);
    expect(s1.scenarios.find((x) => x.id === 'FIRST_HANDSHAKE_OK')!.hits).toBe(1);
    expect(s1.events.filter((e) => e.type === 'FIRST_VEHICLE_LINK').length).toBe(1);
    expect(s1.events.filter((e) => e.type === 'FIRST_HANDSHAKE_OK').length).toBe(1);
  });

  it('üç restore sonrası bile "ilk" senaryolar birer kez kalır', () => {
    startLongRoadSession();
    drive(10);
    for (let i = 0; i < 3; i += 1) {
      simulateProcessDeath();
      initLongRoadRecorder('APP_RESTART');
      drive(10);
    }
    const s = getLongRoadSession()!;
    expect(s.scenarios.find((x) => x.id === 'FIRST_VEHICLE_LINK')!.hits).toBe(1);
    expect(s.scenarios.find((x) => x.id === 'FIRST_HANDSHAKE_OK')!.hits).toBe(1);
  });

  it('ÖZ-DENETLEYİCİ restore sonrası artık CORRUPT vermez (asıl regresyon)', () => {
    startLongRoadSession();
    drive(30);
    simulateProcessDeath();
    initLongRoadRecorder('PROCESS_DEATH');
    drive(30, () => ({ speed: 40 }));

    const s = getLongRoadSession()!;
    const rep = validateSelf(s, allWindows(getLongRoadBlackBox()), Date.now(), {
      blackBoxLoad: getLongRoadBlackBoxLoad(),
      snapshotBodyIds: getLongRoadBodies().map((b) => b.id),
    });
    const table = Object.fromEntries(rep.rows.map((r) => [r.id, r.result]));

    expect(table.DUPLICATE_EVENTS).toBe('VERIFIED');
    expect(table.EVENT_ID_INTEGRITY).toBe('VERIFIED');
    expect(table.SEQUENCE_MONOTONICITY).toBe('VERIFIED');
    expect(table.FIRST_EVENT_UNIQUENESS).toBe('VERIFIED');
    expect(table.RESTART_COUNTER_JUMP).toBe('VERIFIED');
    expect(rep.verdict).not.toBe('CORRUPT');
    /* Öz-denetim OTORİTE AYRIMINI korur. */
    expect(rep.affectsAcceptanceVerdict).toBe(false);
  });

  it('migrateSession kimlik defterini KORUR (yeni alan sıfırlanmaz)', () => {
    startLongRoadSession();
    drive(20);
    simulateProcessDeath();
    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(restored.identity.idHighWater).toBeGreaterThan(0);

    /* Eski şema (identity alanı YOK) fail-closed varsayılana düşer. */
    const legacy = migrateSession({ sessionId: 'LR-X', startedAt: 1, schemaVersion: 1 })!;
    expect(legacy.identity.idHighWater).toBe(0);
    expect(legacy.identity.lastScanVerdict).toBe('NOT_SCANNED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D2 · YAZMA BÜYÜTMESİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('D2 · BlackBox yazma bütçesi', () => {
  it('KRİTİK OLAY YOKKEN BlackBox blob\'u HİÇ yazılmaz (8 saat)', () => {
    startLongRoadSession();
    _resetStoreWriteStatsForTest();
    drive(8 * 3_600);                                 // 8 saat @1 Hz

    const st = readStoreWriteStats();
    /* ESKİ DAVRANIŞ: 8 saatte 960 checkpoint × tam blob. YENİ: kenar yok → 0. */
    expect(st.blackBoxWrites).toBe(0);
    expect(st.blackBoxBytes).toBe(0);
    /* Oturum gövdesi checkpoint disiplinine göre yazılmaya devam eder. */
    expect(st.sessionWrites).toBeGreaterThan(0);
  });

  it('12 ve 24 saatte de kritik olay yoksa BlackBox yazımı SIFIR kalır', () => {
    startLongRoadSession();
    _resetStoreWriteStatsForTest();
    drive(12 * 3_600);
    expect(readStoreWriteStats().blackBoxWrites).toBe(0);
    drive(12 * 3_600);                                // toplam 24 saat
    expect(readStoreWriteStats().blackBoxWrites).toBe(0);
  });

  it('BlackBox yazımı KENAR başınadır: açılış + kapanış (olay başına ~2)', () => {
    startLongRoadSession();
    drive(70);                                        // halkayı doldur
    _resetStoreWriteStatsForTest();

    drive(1, () => ({ obdDataFresh: false }));        // AÇILIŞ kenarı
    const afterOpen = readStoreWriteStats().blackBoxWrites;
    expect(afterOpen).toBe(1);

    drive(60, () => ({ obdDataFresh: true }));        // pencere AÇIK — yazım YOK
    expect(readStoreWriteStats().blackBoxWrites).toBe(afterOpen);

    drive(70, () => ({ obdDataFresh: true }));        // post süresi dolar → KAPANIŞ
    expect(readStoreWriteStats().blackBoxWrites).toBe(afterOpen + 1);
  });

  it('OLAY FIRTINASI blob\'u çoğaltmaz (aynı tip için ikinci pencere açılmaz)', () => {
    startLongRoadSession();
    drive(70);
    _resetStoreWriteStatsForTest();

    for (let i = 0; i < 40; i += 1) {
      drive(1, () => ({ obdDataFresh: false }));
      drive(1, () => ({ obdDataFresh: true }));
    }
    /* 40 salınım → tek pencere açılışı + tek kapanış mertebesinde yazım. */
    expect(readStoreWriteStats().blackBoxWrites).toBeLessThanOrEqual(4);
  });

  it('5 kritik olaylı 8 saatlik yolda yazım hacmi ölçülür ve BOUNDED kalır', () => {
    startLongRoadSession();
    drive(70);
    _resetStoreWriteStatsForTest();

    /* Beş FARKLI kritik tip → beş ayrı pencere. */
    const kinds: Partial<LongRoadSample>[] = [
      { obdDataFresh: false },
      { locationState: 'OFFLINE' },
      { online: false },
      { memoryPressure: 'CRITICAL' },
      { thermalLevel: 3 },
    ];
    for (const k of kinds) {
      drive(2, () => k);
      drive(200, () => ({}));                          // pencere kapansın
    }
    drive(8 * 3_600 - 1_010);                          // 8 saati doldur

    const st = readStoreWriteStats();
    /* ESKİ: ~192 MB (denetimin hesabı). YENİ: kenar başına yazım. */
    expect(st.blackBoxWrites).toBeLessThanOrEqual(12);
    expect(st.blackBoxBytes).toBeLessThan(3 * 1024 * 1024);
  });

  it('finalizasyon bir KENAR\'dır — durdurunca son bounded kayıt yazılır', () => {
    startLongRoadSession();
    drive(70);
    drive(1, () => ({ obdDataFresh: false }));
    _resetStoreWriteStatsForTest();
    stopLongRoadSession();
    expect(readStoreWriteStats().blackBoxWrites).toBe(1);
  });

  it('elle checkpoint TEKRAR TEKRAR blob yazmaz (kenar yoksa disk temiz)', () => {
    startLongRoadSession();
    drive(70);
    drive(1, () => ({ obdDataFresh: false }));
    _resetStoreWriteStatsForTest();
    checkpointLongRoad();
    checkpointLongRoad();
    checkpointLongRoad();
    expect(readStoreWriteStats().blackBoxWrites).toBe(0);
  });
});

describe('D2 · format, checksum ve yarım yazım', () => {
  it('zarf SÜRÜMLÜ ve CHECKSUM\'lı yazılır', () => {
    startLongRoadSession();
    drive(70);
    drive(1, () => ({ obdDataFresh: false }));

    const env = JSON.parse(localStorage.getItem(LR_BLACKBOX_KEY)!) as Record<string, unknown>;
    expect(env.schemaVersion).toBe(2);
    expect(typeof env.checksum).toBe('string');
    expect(typeof env.frameCount).toBe('number');
    expect(env.checksum).toBe(blackBoxChecksum(JSON.stringify(env.windows)));
  });

  it('YARIM/BOZUK gövde FAIL-CLOSED reddedilir — kısmi veri KULLANILMAZ', () => {
    startLongRoadSession();
    drive(70);
    drive(1, () => ({ obdDataFresh: false }));
    const sessionId = getLongRoadSession()!.sessionId;

    /* Checksum'ı bozmadan içeriği değiştir → yarım yazımın taklidi. */
    const env = JSON.parse(localStorage.getItem(LR_BLACKBOX_KEY)!) as { windows: unknown[] };
    env.windows = [];
    localStorage.setItem(LR_BLACKBOX_KEY, JSON.stringify(env));

    const out = loadBlackBoxOutcome(sessionId);
    expect(out.kind).toBe('CORRUPT');
    expect(out.reason).toBe('CHECKSUM_MISMATCH');
    expect(out.checksumOk).toBe(false);
    expect(out.windows).toEqual([]);
  });

  it('kesilmiş JSON CORRUPT döner (sessizce boş liste DEĞİL)', () => {
    startLongRoadSession();
    drive(70);
    drive(1, () => ({ obdDataFresh: false }));
    const sessionId = getLongRoadSession()!.sessionId;

    const raw = localStorage.getItem(LR_BLACKBOX_KEY)!;
    localStorage.setItem(LR_BLACKBOX_KEY, raw.slice(0, Math.floor(raw.length / 2)));
    const out = loadBlackBoxOutcome(sessionId);
    expect(out.kind).toBe('CORRUPT');
    expect(out.reason).toBe('PARSE');
  });

  it('LEGACY v1 sessizce GÜVENİLİR sayılmaz — göç edilir ama işaretlenir', () => {
    const legacy = {
      schemaVersion: 1,
      sessionId: 'LR-LEGACY',
      windows: [{
        eventId: 'EV-1', eventType: 'OBD_DATA_LOST', severity: 'CRITICAL',
        detectedAt: 1, detectedMono: 1, preFrames: [], postFrames: [],
        preWindowComplete: false, postWindowComplete: false,
        droppedRecords: 0, evidenceRefs: [],
      }],
    };
    localStorage.setItem(LR_BLACKBOX_KEY, JSON.stringify(legacy));
    const out = loadBlackBoxOutcome('LR-LEGACY');
    expect(out.kind).toBe('LEGACY_MIGRATED');
    expect(out.formatVersion).toBe(1);
    expect(out.checksumOk).toBeNull();          // "doğrulandı" DENMEZ
    expect(out.windows.length).toBe(1);
  });

  it('GELECEK sürüm reddedilir (UNSUPPORTED_FORMAT)', () => {
    localStorage.setItem(LR_BLACKBOX_KEY, JSON.stringify({
      schemaVersion: 99, sessionId: 'LR-F', windows: [], checksum: 'x', frameCount: 0,
    }));
    const out = loadBlackBoxOutcome('LR-F');
    expect(out.kind).toBe('UNSUPPORTED_FORMAT');
    expect(out.windows).toEqual([]);
  });

  it('şekli bozuk pencere atılır ve SAYILIR (sessiz kayıp yok)', () => {
    const windows = [
      { eventId: 'EV-v1-1', eventType: 'GPS_LOST', severity: 'WARN', detectedAt: 1,
        detectedMono: 1, preFrames: [], postFrames: [], preWindowComplete: false,
        postWindowComplete: true, droppedRecords: 0, evidenceRefs: [] },
      { eventId: 42 },                              // ŞEKİL BOZUK
    ];
    localStorage.setItem(LR_BLACKBOX_KEY, JSON.stringify({
      schemaVersion: 2, sessionId: 'LR-S', frameCount: 0,
      checksum: blackBoxChecksum(JSON.stringify(windows)), windows,
    }));
    const out = loadBlackBoxOutcome('LR-S');
    expect(out.kind).toBe('OK');
    expect(out.rejectedWindows).toBe(1);
    expect(out.windows.length).toBe(1);
  });
});

describe('D2 · process death dürüstlüğü', () => {
  it('PRE-window sırasında ölüm: pencere AÇILIŞTA donmuş hâliyle kurtarılır', () => {
    startLongRoadSession();
    drive(70);                                   // halka dolsun
    drive(1, () => ({ obdDataFresh: false }));   // pencere açılır + yazılır

    simulateProcessDeath();
    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    const w = allWindows(getLongRoadBlackBox());
    expect(w.length).toBe(1);
    expect(w[0].preFrames.length).toBeGreaterThan(0);
    /* POST tamamlanmadı — DÜRÜSTÇE false. */
    expect(w[0].postWindowComplete).toBe(false);
    expect(restored.sessionVersion).toBe(2);
  });

  it('POST-window sırasında ölüm: postWindowComplete=false olarak raporlanır', () => {
    startLongRoadSession();
    drive(70);
    drive(1, () => ({ obdDataFresh: false }));
    drive(30, () => ({ obdDataFresh: true }));   // post yarıda

    simulateProcessDeath();
    initLongRoadRecorder('PROCESS_DEATH');
    const w = allWindows(getLongRoadBlackBox());
    expect(w[0].postWindowComplete).toBe(false);
    /* Eksik pencere TAM gibi SUNULMAZ — bu kural D2'nin dürüstlük ayağıdır. */
  });

  it('finalizasyon sırasında ölüm: kapatılmış pencere diskten okunur', () => {
    startLongRoadSession();
    drive(70);
    drive(1, () => ({ obdDataFresh: false }));
    drive(200, () => ({ obdDataFresh: true }));  // pencere kapansın
    stopLongRoadSession();

    simulateProcessDeath();
    const s = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(s.state).toBe('COMPLETED');
    const w = allWindows(getLongRoadBlackBox());
    expect(w.length).toBe(1);
    expect(w[0].postWindowComplete).toBe(true);
    expect(getLongRoadBlackBoxLoad()!.checksumOk).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D3 · SNAPSHOT KOTASI
 * ════════════════════════════════════════════════════════════════════════ */

describe('D3 · kota modeli (saf)', () => {
  const P: SnapshotTrigger[] = ['PERIODIC_TIME', 'PERIODIC_DISTANCE'];

  it('kotalar AYRIKTIR ve toplamları genel tavanı aşmaz', () => {
    expect(LR_SNAPSHOT_PERIODIC_QUOTA + LR_SNAPSHOT_CRITICAL_QUOTA).toBe(LR_MAX_SNAPSHOTS);
    for (const t of P) expect(snapshotClass(t)).toBe('PERIODIC');
    for (const t of ['OBD_DATA_LOSS', 'MEMORY_CRIT', 'SESSION_END'] as SnapshotTrigger[]) {
      expect(snapshotClass(t)).toBe('CRITICAL');
    }
  });

  it('PERİYODİK kota dolduğunda KRİTİK snapshot HÂLÂ alınabilir', () => {
    const policy = {
      ...emptySnapshotPolicy(),
      periodicCount: LR_SNAPSHOT_PERIODIC_QUOTA,
      count: LR_SNAPSHOT_PERIODIC_QUOTA,
    };
    expect(decideSnapshot(policy, 'PERIODIC_TIME', 10_000_000)).toBe('SUPPRESSED_BUDGET');
    /* ASIL KUSUR BUYDU: periyodikler kritik anı engelliyordu. */
    expect(decideSnapshot(policy, 'OBD_DATA_LOSS', 10_000_000)).toBe('ALLOW');
    expect(decideSnapshot(policy, 'MEMORY_CRIT', 10_000_000)).toBe('ALLOW');
  });

  it('periyodik düşüş PERİYODİK, kritik düşüş KRİTİK sayaca yazılır', () => {
    expect(classifySnapshotDrop('PERIODIC_TIME', 'SUPPRESSED_BUDGET')).toBe('PERIODIC');
    expect(classifySnapshotDrop('OBD_DATA_LOSS', 'SUPPRESSED_CRITICAL_BUDGET')).toBe('CRITICAL');
    /* Cooldown bir POLİTİKA kararıdır — kayıp DEĞİL. */
    expect(classifySnapshotDrop('OBD_DATA_LOSS', 'SUPPRESSED_COOLDOWN')).toBeNull();
    expect(classifySnapshotDrop('GPS_LOSS', 'SUPPRESSED_GLOBAL_GAP')).toBeNull();
  });

  it('kritik kota dolunca ÖNCELİK + ESKİLİK ile tahliye adayı seçilir', () => {
    const rows: SnapshotIndexRow[] = [
      { id: 'a', trigger: 'MEMORY_CRIT', takenAt: 10, bytes: 1, distanceKm: null },
      { id: 'b', trigger: 'TRIP_CLOSE', takenAt: 20, bytes: 1, distanceKm: null },
      { id: 'c', trigger: 'TRIP_CLOSE', takenAt: 5, bytes: 1, distanceKm: null },
      { id: 'd', trigger: 'GPS_LOSS', takenAt: 1, bytes: 1, distanceKm: null },
    ];
    /* Gelen MEMORY_CRIT (öncelik 5) → en zayıf (TRIP_CLOSE=1) ve EN ESKİ = 'c'. */
    expect(chooseCriticalEvictionVictim(rows, 5)!.id).toBe('c');
    /* Gelen TRIP_CLOSE (öncelik 1) → kendisinden zayıf yok → tahliye YOK. */
    expect(chooseCriticalEvictionVictim(rows, 1)).toBeNull();
  });

  it('kritik kota dolu ve gelen kayıt DAHA ZAYIFSA bastırılır (kanıt korunur)', () => {
    const retained: SnapshotIndexRow[] = Array.from(
      { length: LR_SNAPSHOT_CRITICAL_QUOTA },
      (_, i) => ({
        id: `k${i}`, trigger: 'MEMORY_CRIT' as SnapshotTrigger,
        takenAt: i, bytes: 1, distanceKm: null,
      }),
    );
    const policy = {
      ...emptySnapshotPolicy(),
      criticalCount: LR_SNAPSHOT_CRITICAL_QUOTA,
      count: LR_SNAPSHOT_CRITICAL_QUOTA,
    };
    expect(decideSnapshot(policy, 'TRIP_CLOSE', 10_000_000, retained))
      .toBe('SUPPRESSED_CRITICAL_BUDGET');
    expect(decideSnapshot(policy, 'OBD_DATA_LOSS', 10_000_000, retained))
      .toBe('SUPPRESSED_CRITICAL_BUDGET');            // eşit öncelik → tahliye YOK
  });

  it('genel tavan hâlâ korunur (eski kilit)', () => {
    const policy = { ...emptySnapshotPolicy(), count: LR_MAX_SNAPSHOTS };
    expect(decideSnapshot(policy, 'TRIP_CLOSE', 999_999)).toBe('SUPPRESSED_BUDGET');
  });
});

describe('D3 · kota runtime davranışı', () => {
  it('uzun yolda periyodikler KRİTİK kotayı tüketmez', () => {
    startLongRoadSession();
    let km = 0;
    /* Çok sayıda periyodik mesafe snapshot'ı üret. */
    drive(4_000, () => { km += 1; return { tripTotalDistanceKm: km }; });

    const s = getLongRoadSession()!;
    expect(s.snapshotPolicy.periodicCount).toBeLessThanOrEqual(LR_SNAPSHOT_PERIODIC_QUOTA);
    expect(s.snapshotPolicy.criticalCount).toBeLessThan(LR_SNAPSHOT_CRITICAL_QUOTA);

    /* Kota dolmuş olsa bile kritik olay HÂLÂ snapshot alabiliyor. */
    const before = s.snapshots.filter((r) => r.trigger === 'OBD_DATA_LOSS').length;
    drive(2, () => ({ obdDataFresh: false, tripTotalDistanceKm: km }));
    const after = getLongRoadSession()!.snapshots.filter((r) => r.trigger === 'OBD_DATA_LOSS').length;
    expect(after).toBe(before + 1);
  });

  it('düşen periyodik ve KRİTİK snapshot AYRI sayaçlara yazılır', () => {
    startLongRoadSession();
    let km = 0;
    drive(6_000, () => { km += 1; return { tripTotalDistanceKm: km }; });

    const d = getLongRoadSession()!.dropped;
    expect(d.droppedPeriodicSnapshots).toBeGreaterThan(0);
    expect(d.droppedCriticalSnapshots).toBe(0);       // kritik kanıt KAYBEDİLMEDİ
  });

  it('SARKAN REFERANS yok: her gövdenin indekste karşılığı var', () => {
    startLongRoadSession();
    let km = 0;
    drive(3_000, () => { km += 1; return { tripTotalDistanceKm: km }; });
    drive(2, () => ({ obdDataFresh: false }));

    const s = getLongRoadSession()!;
    const index = new Set(s.snapshots.map((r) => r.id));
    for (const b of getLongRoadBodies()) expect(index.has(b.id)).toBe(true);
    expect(new Set(s.snapshots.map((r) => r.id)).size).toBe(s.snapshots.length);
  });

  it('kota ve sayaçlar RESTORE sonrası korunur (sıfırlanmaz)', () => {
    startLongRoadSession();
    let km = 0;
    drive(1_500, () => { km += 1; return { tripTotalDistanceKm: km }; });
    const before = getLongRoadSession()!.snapshotPolicy;
    expect(before.periodicCount).toBeGreaterThan(0);

    simulateProcessDeath();
    const restored = initLongRoadRecorder('PROCESS_DEATH')!;
    expect(restored.snapshotPolicy.periodicCount).toBeGreaterThanOrEqual(before.periodicCount);
    expect(restored.snapshotPolicy.criticalCount).toBeGreaterThanOrEqual(before.criticalCount);
  });

  it('DEPOLAMA BASKISI önce periyodikleri budar, kritikleri KORUR', () => {
    startLongRoadSession();
    let km = 0;
    drive(1_500, () => { km += 1; return { tripTotalDistanceKm: km }; });
    drive(2, () => ({ obdDataFresh: false, tripTotalDistanceKm: km }));

    const before = getLongRoadSession()!;
    const criticalBefore = before.snapshots.filter(
      (r) => snapshotClass(r.trigger) === 'CRITICAL',
    ).length;
    expect(criticalBefore).toBeGreaterThan(0);

    const pruned = applyStoragePressure(before, 'CRITICAL', 99_999_999);
    const criticalAfter = pruned.snapshots.filter(
      (r) => snapshotClass(r.trigger) === 'CRITICAL',
    ).length;
    expect(criticalAfter).toBe(criticalBefore);
    /* Budama kotayı SERBEST bırakır — disk boşalıp kota dolu kalmaz. */
    expect(pruned.snapshotPolicy.periodicCount)
      .toBeLessThanOrEqual(before.snapshotPolicy.periodicCount);
  });

  it('öz-denetim kota defterini bağımsız yeniden hesaplar', () => {
    startLongRoadSession();
    let km = 0;
    drive(1_200, () => { km += 1; return { tripTotalDistanceKm: km }; });

    const s = getLongRoadSession()!;
    const rep = validateSelf(s, allWindows(getLongRoadBlackBox()), Date.now(), {
      blackBoxLoad: getLongRoadBlackBoxLoad(),
      snapshotBodyIds: getLongRoadBodies().map((b) => b.id),
    });
    const table = Object.fromEntries(rep.rows.map((r) => [r.id, r.result]));
    expect(table.SNAPSHOT_QUOTA).toBe('VERIFIED');
    expect(table.SNAPSHOT_REFERENCE).toBe('VERIFIED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PASİF GÖZLEMCİ REGRESYONU — D1–D3 yeni mutasyon EKLEMEDİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('pasif gözlemci regresyonu', () => {
  const SRC = (f: string): string =>
    readFileSync(join(process.cwd(), 'src/platform/fieldValidation', f), 'utf8');

  const RECORDER = SRC('longRoadRecorder.ts');
  const STORE = SRC('longRoadStore.ts');
  const MODEL = SRC('longRoadModel.ts');

  /** Ürün kontrol düzlemine ait çağrılar — hiçbiri gözlemcide BULUNMAMALI. */
  const FORBIDDEN: readonly [string, RegExp][] = [
    ['OBD komutu',        /\bsendCommand\s*\(|\bsendObdCommand\s*\(|\bwriteCommand\s*\(/],
    ['bağlantı kurma',    /\bconnectObd\s*\(|\bobdService\.connect\b|\bstartScan\s*\(|\bdisconnect\s*\(/],
    ['polling değişimi',  /\bsetPollInterval\s*\(|\bstartPolling\s*\(|\bstopPolling\s*\(/],
    ['GPS kontrolü',      /\bstartGps\s*\(|\bstopGps\s*\(|\bwatchPosition\s*\(|\brequestPermission/],
    ['navigasyon/medya',  /\bstartNavigation\s*\(|\bplay\s*\(\s*\)|\bmediaService\.|navigationService\./],
    ['Evidence/Reasoning',/\brecordEvidence\s*\(|\baiEvidenceEngine\b|\bmaviReasoning/],
    ['kullanıcı bildirimi', /\balert\s*\(|\btoast\s*\(|\bspeak\s*\(|\bconfirm\s*\(/],
    ['ekran yönlendirme', /screen\.orientation|\block\s*\(\s*['"]landscape/],
    ['ağ çağrısı',        /\bfetch\s*\(|XMLHttpRequest|supabase|axios/],
  ];

  it('kaydedici · store · model hiçbir ürün kontrol çağrısı İÇERMEZ', () => {
    for (const [label, re] of FORBIDDEN) {
      expect(re.test(RECORDER), `kaydedici: ${label}`).toBe(false);
      expect(re.test(STORE), `store: ${label}`).toBe(false);
      expect(re.test(MODEL), `model: ${label}`).toBe(false);
    }
  });

  it('D1–D3 turunda YENİ dış modül bağımlılığı eklenmedi', () => {
    const imports = [...RECORDER.matchAll(/^import[\s\S]*?from\s+'([^']+)';$/gm)]
      .map((m) => m[1]).sort();
    expect(imports).toEqual([
      '../devtools/sessionInspectorSources',
      '../memoryWatchdog',
      './longRoadBlackBox',
      './longRoadDetect',
      './longRoadModel',
      './longRoadSources',
      './longRoadStore',
    ]);
  });

  it('gözlemci yalnız KENDİ ad alanına yazar (caros.lab.*)', () => {
    const keys = [...MODEL.matchAll(/_KEY\s*=\s*'([^']+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith('caros.lab.')).toBe(true);
  });

  it('oturum silinince disk ve bellek TEMİZLENİR (sızıntı yok)', () => {
    startLongRoadSession();
    drive(70);
    drive(1, () => ({ obdDataFresh: false }));
    expect(localStorage.getItem(LR_BLACKBOX_KEY)).not.toBeNull();

    clearLongRoadSession();
    expect(localStorage.getItem(LR_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(LR_BLACKBOX_KEY)).toBeNull();
    expect(getLongRoadSession()).toBeNull();
    expect(getLongRoadIdentityScan().verdict).toBe('NOT_SCANNED');
  });

  it('oturum yokken hiçbir yazım yapılmaz', () => {
    _resetStoreWriteStatsForTest();
    initLongRoadRecorder('APP_RESTART');
    checkpointLongRoad();
    const st = readStoreWriteStats();
    expect(st.sessionWrites).toBe(0);
    expect(st.blackBoxWrites).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GERÇEK ARAÇ HÜKMÜ — testler yeşil diye saha doğrulaması VERİLMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('gerçek araç hükmü', () => {
  it('bu dosyadaki hiçbir koşum SAHA DOĞRULAMASI sayılmaz', () => {
    const s = createSession('LR-DOC', 1);
    /* Kaynak `real` olsa bile geçerli hız örneği yoksa doğrulama YOKTUR. */
    expect(s.env.obdAdapter).toBeNull();
    /* Bu kilit, "test yeşil = sahada çalışıyor" yanılgısına karşı bilinçlidir. */
    expect(true).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * #507 devamı · ESKİ VIN MASKESİ ARTIĞI — DİSKTEKİ KAYIT TEMİZLİĞİ
 *
 * Kod 2026-08-09'da düzeldi (tek otorite `platform/privacy/vinMask`), ama o
 * tarihten ÖNCE yazılmış oturum kayıtlarında `vehicleRef` hâlâ "…891234"
 * biçiminde — yani ISO 3779 SERİ NUMARASI açıkta. Bu testler temizliğin
 * OKUMA YOLUNDA çalıştığını ve DİSKİ gerçekten düzelttiğini kilitler.
 * ════════════════════════════════════════════════════════════════════════ */
describe('#507 · eski maske artığı temizliği', () => {
  const LEGACY_BODY = (ref: string): string => JSON.stringify({
    schemaVersion: 1,
    sessionId: 'LR-ESKI-1',
    startedAt: Date.now(),
    env: { vehicleRef: ref, startRegion: null },
    events: [{
      id: 'E1', type: 'NOTE', severity: 'INFO', detectedAt: Date.now(),
      detail: `araç ${ref} ile yola çıkıldı`,
    }],
  });

  it('🔒 eski maskeli kayıt okunduğunda alan DÜŞER, kayıt SİLİNMEZ', async () => {
    const { loadSession } = await import('../platform/fieldValidation/longRoadStore');
    localStorage.setItem('caros.lab.longRoadSession.v1', LEGACY_BODY('…891234'));

    const out = loadSession();
    expect(out.kind, 'kanıt kaydı bir etiket yüzünden imha edilmiş').toBe('OK');
    if (out.kind !== 'OK') return;
    expect(out.session.sessionId).toBe('LR-ESKI-1');           // kanıt duruyor
    expect(JSON.stringify(out.session)).not.toContain('891234'); // seri gitti
  });

  it('🔒 temizlik DİSKE yazılır — sızıntı dosyada kalmaz', async () => {
    const { loadSession } = await import('../platform/fieldValidation/longRoadStore');
    localStorage.setItem('caros.lab.longRoadSession.v1', LEGACY_BODY('…891234'));

    loadSession();
    const onDisk = localStorage.getItem('caros.lab.longRoadSession.v1') ?? '';
    expect(onDisk, 'temizlik yalnız bellekte kalmış — dosyada seri numarası duruyor')
      .not.toContain('891234');
  });

  it('🔒 temizlik SESSİZ DEĞİL — kayıt ve alan sayısı LAB için sayılır', async () => {
    const { loadSession } = await import('../platform/fieldValidation/longRoadStore');
    /* İki ayrı alanda artık var: env.vehicleRef + olay detayı. */
    localStorage.setItem('caros.lab.longRoadSession.v1', LEGACY_BODY('…891234'));

    loadSession();
    const st = readStoreWriteStats();
    expect(st.legacyMaskRecords).toBe(1);
    expect(st.legacyMaskFields, 'serbest metindeki artık atlanmış').toBeGreaterThanOrEqual(2);
  });

  it('🔒 temiz kayıtta GEREKSİZ yazma doğmaz (eMMC bütçesi)', async () => {
    const { loadSession } = await import('../platform/fieldValidation/longRoadStore');
    localStorage.setItem('caros.lab.longRoadSession.v1', LEGACY_BODY('VF1**************'));

    _resetStoreWriteStatsForTest();
    loadSession();
    const st = readStoreWriteStats();
    expect(st.legacyMaskRecords).toBe(0);
    expect(st.sessionWrites, 'temiz kayıt boşuna diske geri yazılmış').toBe(0);
  });
});
