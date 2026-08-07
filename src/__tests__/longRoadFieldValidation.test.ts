/**
 * longRoadFieldValidation.test.ts — OTOMATİK UZUN YOL SAHA DOĞRULAMA kilitleri.
 *
 * Görev §20'nin YEREL doğrulanabilir maddeleri. GERÇEK ARAÇ YOKSA SAHA PASS
 * VERİLMEZ — burada yalnız mantık, sınır, gizlilik ve dürüstlük kilitlenir.
 *
 * Kaynak-metin kilitleri Vite `?raw` ile alınır (runtime `readFileSync` build
 * çıktısını değil repoyu okur; `?raw` build-time'da gömülür → izole geçip
 * pakette düşen kilit tuzağı oluşmaz).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import recorderSrc from '../platform/fieldValidation/longRoadRecorder.ts?raw';
import sourcesSrc from '../platform/fieldValidation/longRoadSources.ts?raw';
import modelSrc from '../platform/fieldValidation/longRoadModel.ts?raw';
import detectSrc from '../platform/fieldValidation/longRoadDetect.ts?raw';
import blackBoxSrc from '../platform/fieldValidation/longRoadBlackBox.ts?raw';
import acceptanceSrc from '../platform/fieldValidation/longRoadAcceptance.ts?raw';
import reportSrc from '../platform/fieldValidation/longRoadReport.ts?raw';
import screenSrc from '../components/devtools/screens/LongRoadFieldValidationScreen.tsx?raw';
import badgeSrc from '../components/common/FieldTestBadge.tsx?raw';
import mainLayoutSrc from '../components/layout/MainLayout.tsx?raw';

import {
  LR_MAX_BLACKBOX_EVENTS, LR_MAX_EVENTS, LR_MAX_SNAPSHOTS, LR_SCHEMA_VERSION,
  SCENARIO_ORDER, SIGNAL_ORDER,
  advanceCounter, advanceOdometry, advanceSignal, applySnapshotDecision,
  applyStoragePressure, counterDelta, createSession, decideSnapshot, emptyCounter,
  emptySignalRow, emptySnapshotPolicy, findScenario, findSignal, isSignalPlausible,
  isSignalSupported, markScenario, maskVehicleRef, migrateSession, nextSessionState,
  odometerDistanceKm, odometerInvariantHolds, pushEvent, resumeSession,
  sanitizeForExport, signalAverage, signalCoverageRatio,
  type FieldEvent, type LongRoadSession, type SessionState,
} from '../platform/fieldValidation/longRoadModel';
import {
  BB_POST_MS, BB_PRE_MS, BB_RING_CAPACITY,
  blackBoxOpen, blackBoxTick, emptyBlackBoxState, emptyRing, frameFromSample,
  ringPush, windowMeta,
} from '../platform/fieldValidation/longRoadBlackBox';
import {
  detect, emptyDetectState, type LongRoadSample,
} from '../platform/fieldValidation/longRoadDetect';
import {
  LR_THRESHOLDS, buildAcceptanceMatrix, finalVerdict, summarizeMatrix, topFindings,
} from '../platform/fieldValidation/longRoadAcceptance';
import {
  auditPrivacy, buildLongRoadReport, judgePersistence, judgeRealVehicle,
} from '../platform/fieldValidation/longRoadReport';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function sample(over: Partial<LongRoadSample> = {}): LongRoadSample {
  return {
    wallMs: 1_000_000,
    monoMs: 0,
    obdTransportConnected: null,
    obdDataFresh: null,
    obdConnectionState: null,
    obdSource: null,
    obdLastPacketAgeMs: null,
    handshakeOutcome: null,
    protocolActive: null,
    protocolTried: null,
    vinPresent: null,
    supportedPidCount: null,
    reconnectRequested: null,
    resetRequested: null,
    disconnectCalled: null,
    transportReconnectAttempts: null,
    kwpStatus: null,
    kwpRecoveryCount: null,
    kwpSuppressedCount: null,
    kwpAtpcFailures: null,
    canRetryCount: null,
    halActiveSource: null,
    speed: null,
    rpm: null,
    engineTemp: null,
    throttle: null,
    intakeTemp: null,
    fuelLevel: null,
    batteryVoltage: null,
    locationState: null,
    locationProvider: null,
    locationAccuracyM: null,
    locationFixAgeMs: null,
    gpsSwitchCount: null,
    gpsFallbackCount: null,
    tripActive: null,
    tripTotalDistanceKm: null,
    tripTotalCount: null,
    online: null,
    telemetryReportPresent: null,
    offlineQueueSize: null,
    runtimeMode: null,
    thermalLevel: null,
    ramPressureRatio: null,
    uiFreezeCount: null,
    workerRestartTotal: null,
    memoryPressure: null,
    appVisible: null,
    batteryPercent: null,
    charging: null,
    ...over,
  };
}

/** Blok ve satır yorumlarını çıkarır — kaynak-metin kilitleri KODU tarasın. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function ev(over: Partial<FieldEvent> = {}): FieldEvent {
  return {
    id: 'EV-1', type: 'GPS_LOST', severity: 'INFO', detectedAt: 1, detail: 'x', ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Ürün davranışına dokunmama kilidi (görev §0 — EN KRİTİK)
 * ════════════════════════════════════════════════════════════════════════ */

describe('saha doğrulama · ürün davranışına dokunmaz', () => {
  const ALL = [
    ['recorder', recorderSrc], ['sources', sourcesSrc], ['model', modelSrc],
    ['detect', detectSrc], ['blackBox', blackBoxSrc], ['acceptance', acceptanceSrc],
    ['report', reportSrc], ['screen', screenSrc], ['badge', badgeSrc],
  ] as const;

  /** Bu modül HİÇBİR dosyasında ürün KONTROL yüzeyini çağırmamalı. */
  const FORBIDDEN: readonly RegExp[] = [
    /\bconnectOBD\s*\(/, /\bdisconnectOBD\s*\(/, /\breconnectOBD\s*\(/,
    /\bsendCommand\s*\(/, /\bsendRawCommand\s*\(/, /\bwriteObd\s*\(/,
    /\bstartPolling\s*\(/, /\bstopPolling\s*\(/, /\bsetPollInterval\s*\(/,
    /\bstartNavigation\s*\(/, /\bstartRoute\s*\(/,
    /\bplay\s*\(\s*\)/, /\bmediaService\./,
    /\bwindow\.alert\s*\(/, /\bconfirm\s*\(/,
    /\bspeak\s*\(/, /\bttsService\./,
    /\brefreshKwpRecoveryEvidence\s*\(/, /\brefreshExtendedPollEvidence\s*\(/,
    /\bgetLiveDiscoveryCoordinator\s*\(/,
    /\blocation\.reload\s*\(/, /\bprocess\.exit\s*\(/,
  ];

  for (const [name, src] of ALL) {
    it(`${name}: yasak ürün-kontrol çağrısı içermez`, () => {
      for (const re of FORBIDDEN) {
        expect(re.test(src), `${name} içinde yasak desen: ${re}`).toBe(false);
      }
    });
  }

  it('saf katmanlar zaman/rastgele/IO okumaz (test edilebilirlik sözleşmesi)', () => {
    /* YORUMLAR ÇIKARILIR: bu dosyalar kuralın KENDİSİNİ yorumda anlatıyor
       ("`Date.now()` yok") — yorum metni kilidi tetiklememeli. */
    for (const [name, src] of [
      ['model', modelSrc], ['detect', detectSrc],
      ['blackBox', blackBoxSrc], ['acceptance', acceptanceSrc], ['report', reportSrc],
    ] as const) {
      const code = stripComments(src);
      expect(/Date\.now\s*\(/.test(code), `${name} Date.now kullanıyor`).toBe(false);
      expect(/Math\.random\s*\(/.test(code), `${name} Math.random kullanıyor`).toBe(false);
      expect(/setInterval\s*\(/.test(code), `${name} setInterval kullanıyor`).toBe(false);
      expect(/setTimeout\s*\(/.test(code), `${name} setTimeout kullanıyor`).toBe(false);
      expect(/localStorage/.test(code), `${name} localStorage kullanıyor`).toBe(false);
      expect(/\bimport\s+.*from\s+'react'/.test(code), `${name} React import ediyor`).toBe(false);
    }
  });

  it('yalnız kaydedici zamanlayıcı sahibidir ve MUTLAKA temizler', () => {
    expect(recorderSrc).toContain('setInterval');
    expect(recorderSrc).toContain('clearInterval');
    /* Her dinleyici için sökme thunk'ı biriktirilmeli. */
    expect(recorderSrc).toContain('removeEventListener');
    expect(recorderSrc).toContain('_state.cleanups');
  });

  it('okuma katmanı yalnız senkron getter kullanır (tek async istisna belgelidir)', () => {
    /* `readAsyncAugment` DIŞINDA async fonksiyon olmamalı. */
    const asyncCount = (sourcesSrc.match(/\basync\s+function\b/g) ?? []).length;
    expect(asyncCount).toBe(1);
    expect(sourcesSrc).toContain('export async function readAsyncAugment');
  });

  it('gösterge sürüş sırasında popup/modal açmaz', () => {
    expect(/alert\s*\(/.test(badgeSrc)).toBe(false);
    expect(/showModal|openModal|Dialog/.test(badgeSrc)).toBe(false);
    /* Oturum aktif değilken hiçbir şey render edilmez. */
    expect(badgeSrc).toContain('if (!view.active) return null;');
  });

  it('LAB ekranı 1 Hz döngüye abone olmaz (render baskısı yasağı)', () => {
    expect(screenSrc.includes('subscribeLongRoad')).toBe(false);
    expect(screenSrc).toContain('açılışta TEK okuma; timer YOK');
  });

  /* ── MOUNT KİLİDİ ─────────────────────────────────────────────────────
     2026-08-02: gösterge mount'u bir kez SESSİZCE kayboldu (yanlışlıkla
     geri alınan dosyada) ve HİÇBİR test bunu yakalamadı — tüm suite yeşildi
     ama sürüş göstergesi ürüne bağlı değildi. Bu kilit o boşluğu kapatır. */
  it('gösterge ürün ağacına GERÇEKTEN mount edilmiş (sessiz kayıp kilidi)', () => {
    const code = stripComments(mainLayoutSrc);
    expect(code, 'MainLayout FieldTestBadge import etmiyor')
      .toMatch(/import\s+FieldTestBadge\s+from\s+'\.\.\/common\/FieldTestBadge'/);
    expect(code, 'MainLayout <FieldTestBadge /> render etmiyor')
      .toMatch(/<FieldTestBadge\s*\/>/);
  });

  it('sürüş kapısı MainLayout\'ta korunuyor (T13 — kurtarma sonrası)', () => {
    const code = stripComments(mainLayoutSrc);
    expect(code).toMatch(/import\s+\{\s*canShowTripSummary\s*\}\s+from\s+'\.\/tripSummaryGate'/);
    expect(code).toContain('canShowTripSummary(useUnifiedVehicleStore((s) => s.speed))');
    /* Banner koşulunda kapı MUTLAKA bulunmalı — yoksa sürüşte açılabilir. */
    expect(code).toMatch(/showTripSummary && lastCompletedTrip[^\n]*!tripSummaryBlocked/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1b · Katalog ↔ ekran eşlemesi (AVAILABLE yalan söyleyemez)
 * ════════════════════════════════════════════════════════════════════════ */

describe('CAROS LAB katalog ↔ ekran bütünlüğü', () => {
  it('AVAILABLE işaretli HER aracın gerçek bir ekran eşlemesi vardır', async () => {
    const { CAROS_LAB_TOOLS } = await import('../platform/devtools/carosLabCatalog');
    const { renderAvailableTool } = await import('../components/devtools/carosLabScreenMap');

    const missing: string[] = [];
    for (const tool of CAROS_LAB_TOOLS) {
      if (tool.status !== 'AVAILABLE') continue;
      if (renderAvailableTool(tool.id) === null) missing.push(tool.id);
    }
    expect(missing, `AVAILABLE ama ekranı yok: ${missing.join(', ')}`).toEqual([]);
  });

  it('AVAILABLE OLMAYAN araç ekran döndürmez (sahte "çalışıyor" yasağı)', async () => {
    const { CAROS_LAB_TOOLS } = await import('../platform/devtools/carosLabCatalog');
    const { renderAvailableTool } = await import('../components/devtools/carosLabScreenMap');

    for (const tool of CAROS_LAB_TOOLS) {
      if (tool.status === 'AVAILABLE') continue;
      expect(renderAvailableTool(tool.id), `${tool.id} ekran döndürüyor`).toBeNull();
    }
  });

  it('uzun yol aracı katalogda AVAILABLE ve ekranı bağlı', async () => {
    const { CAROS_LAB_TOOLS } = await import('../platform/devtools/carosLabCatalog');
    const { renderAvailableTool } = await import('../components/devtools/carosLabScreenMap');

    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'long-road-field-validation');
    expect(tool).toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('developer');
    expect(renderAvailableTool('long-road-field-validation')).not.toBeNull();
    /* Katalog notu, aracın ne YAPMADIĞINI açıkça yazmalı. */
    expect(tool!.note).toContain('PASİF GÖZLEM');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Oturum durum makinesi
 * ════════════════════════════════════════════════════════════════════════ */

describe('oturum durum makinesi', () => {
  it('geçerli yol: IDLE → STARTING → ACTIVE → COMPLETED', () => {
    let s: SessionState = 'IDLE';
    s = nextSessionState(s, 'START');    expect(s).toBe('STARTING');
    s = nextSessionState(s, 'ACTIVATE'); expect(s).toBe('ACTIVE');
    s = nextSessionState(s, 'STOP');     expect(s).toBe('COMPLETED');
  });

  it('geçersiz geçiş mevcut durumu KORUR (sessiz sıçrama yok)', () => {
    expect(nextSessionState('IDLE', 'ACTIVATE')).toBe('IDLE');
    expect(nextSessionState('IDLE', 'RESUME')).toBe('IDLE');
    expect(nextSessionState('STARTING', 'RESUME')).toBe('STARTING');
  });

  it('terminal durumlar yalnız START ile terk edilir', () => {
    for (const t of ['COMPLETED', 'FAILED', 'CORRUPT'] as const) {
      expect(nextSessionState(t, 'ACTIVATE')).toBe(t);
      expect(nextSessionState(t, 'RESUME')).toBe(t);
      expect(nextSessionState(t, 'STOP')).toBe(t);
      expect(nextSessionState(t, 'START')).toBe('STARTING');
    }
  });

  it('sistem duraklatması yalnız ACTIVE\'ten olur ve geri döner', () => {
    expect(nextSessionState('ACTIVE', 'SYSTEM_PAUSE')).toBe('PAUSED_BY_SYSTEM');
    expect(nextSessionState('PAUSED_BY_SYSTEM', 'RESUME')).toBe('ACTIVE');
    expect(nextSessionState('STARTING', 'SYSTEM_PAUSE')).toBe('STARTING');
  });

  it('MARK_CORRUPT her durumdan CORRUPT üretir', () => {
    for (const s of ['IDLE', 'ACTIVE', 'COMPLETED'] as const) {
      expect(nextSessionState(s, 'MARK_CORRUPT')).toBe('CORRUPT');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Restore / kalıcılık sürekliliği (görev §13)
 * ════════════════════════════════════════════════════════════════════════ */

describe('oturum sürekliliği', () => {
  it('restore AYNI sessionId\'yi korur, sürümü artırır ve nedeni yazar', () => {
    const s = { ...createSession('LR-X', 1000), state: 'ACTIVE' as SessionState };
    const r = resumeSession(s, 'PROCESS_DEATH', 5000);

    expect(r.sessionId).toBe('LR-X');
    expect(r.sessionVersion).toBe(2);
    expect(r.restoreCount).toBe(1);
    expect(r.lastRestoreReason).toBe('PROCESS_DEATH');
    expect(r.state).toBe('RECOVERING');
    expect(r.events.some((e) => e.type === 'RESTORE')).toBe(true);
  });

  it('ardışık restore\'lar yeni oturum GİBİ görünmez', () => {
    let s = { ...createSession('LR-Y', 0), state: 'ACTIVE' as SessionState };
    s = resumeSession(s, 'APP_RESTART', 1);
    s = { ...s, state: 'ACTIVE' as SessionState };
    s = resumeSession(s, 'DEVICE_REBOOT', 2);

    expect(s.sessionId).toBe('LR-Y');
    expect(s.sessionVersion).toBe(3);
    expect(s.restoreCount).toBe(2);
  });

  it('kalıcılık hükmü: restore yaşanmadıysa PASS DEĞİL (kanıtsız PASS yasağı)', () => {
    const never = { ...createSession('A', 0), lastCheckpointAt: 10 };
    expect(judgePersistence(never)).toBe('PARTIAL');

    const restored = resumeSession(
      { ...createSession('A', 0), state: 'ACTIVE' as SessionState, lastCheckpointAt: 10 },
      'APP_RESTART', 20,
    );
    expect(judgePersistence(restored)).toBe('PASS');

    expect(judgePersistence(createSession('A', 0))).toBe('FAILED');   // hiç yazılmamış
    expect(judgePersistence({ ...createSession('A', 0), state: 'CORRUPT' })).toBe('FAILED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Bozuk / geçersiz kayıt (fail-closed)
 * ════════════════════════════════════════════════════════════════════════ */

describe('şema göçü fail-closed', () => {
  it('boş/anlamsız gövde reddedilir', () => {
    expect(migrateSession(null)).toBeNull();
    expect(migrateSession('metin')).toBeNull();
    expect(migrateSession({})).toBeNull();
    expect(migrateSession({ sessionId: 'A' })).toBeNull();            // startedAt yok
    expect(migrateSession({ startedAt: 1 })).toBeNull();              // sessionId yok
  });

  it('GELECEK şema sürümü reddedilir (ileriye dönük uyum varsayılmaz)', () => {
    const body = { ...createSession('A', 1), schemaVersion: LR_SCHEMA_VERSION + 1 };
    expect(migrateSession(body)).toBeNull();
  });

  it('eksik defterler katalog boyuna TAMAMLANIR, bilinmeyen id ATILIR', () => {
    const body = {
      sessionId: 'A', startedAt: 1, schemaVersion: LR_SCHEMA_VERSION,
      scenarios: [{ id: 'GPS_LOST', hits: 3, firstAt: 5, lastAt: 9 }, { id: 'UYDURMA', hits: 99 }],
      signals: [{ id: 'speed', samples: 10, validSamples: 8 }],
    };
    const m = migrateSession(body);
    expect(m).not.toBeNull();
    expect(m!.scenarios.length).toBe(SCENARIO_ORDER.length);
    expect(m!.signals.length).toBe(SIGNAL_ORDER.length);
    expect(findScenario(m!, 'GPS_LOST').hits).toBe(3);
    expect(m!.scenarios.some((x) => (x.id as string) === 'UYDURMA')).toBe(false);
    expect(findSignal(m!, 'speed').validSamples).toBe(8);
    expect(findSignal(m!, 'rpm').samples).toBe(0);
  });

  it('bozuk sayısal alanlar sahte 0 ÜRETMEZ, null/0 sınırında kalır', () => {
    const m = migrateSession({
      sessionId: 'A', startedAt: 1,
      signals: [{ id: 'speed', min: 'abc', max: null, sum: 'x', firstSeenAt: 'y' }],
    });
    const row = findSignal(m!, 'speed');
    expect(row.min).toBeNull();
    expect(row.max).toBeNull();
    expect(row.firstSeenAt).toBeNull();
    expect(row.sum).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Bounded tamponlar + kritik kayıt korunması (görev §17)
 * ════════════════════════════════════════════════════════════════════════ */

describe('bounded olay tamponu', () => {
  it('sınır aşılınca EN ESKİ INFO düşer, sayaç artar', () => {
    let s = createSession('A', 0);
    for (let i = 0; i < LR_MAX_EVENTS; i += 1) {
      s = pushEvent(s, ev({ id: `E${i}`, severity: 'INFO' }));
    }
    expect(s.events.length).toBe(LR_MAX_EVENTS);
    expect(s.dropped.droppedEvents).toBe(0);

    s = pushEvent(s, ev({ id: 'YENI', severity: 'WARN' }));
    expect(s.events.length).toBe(LR_MAX_EVENTS);
    expect(s.dropped.droppedEvents).toBe(1);
    expect(s.events.some((e) => e.id === 'YENI')).toBe(true);
    expect(s.events.some((e) => e.id === 'E0')).toBe(false);
  });

  it('tampon tamamen KRİTİK ise yeni INFO REDDEDİLİR (kritik kanıt korunur)', () => {
    let s = createSession('A', 0);
    for (let i = 0; i < LR_MAX_EVENTS; i += 1) {
      s = pushEvent(s, ev({ id: `C${i}`, severity: 'CRITICAL' }));
    }
    s = pushEvent(s, ev({ id: 'INFO-YENI', severity: 'INFO' }));
    expect(s.events.every((e) => e.severity === 'CRITICAL')).toBe(true);
    expect(s.events.some((e) => e.id === 'INFO-YENI')).toBe(false);
    expect(s.dropped.droppedEvents).toBe(1);
  });

  it('kritik olay, dolu tamponda WARN kurban ederek YER BULUR', () => {
    let s = createSession('A', 0);
    for (let i = 0; i < LR_MAX_EVENTS; i += 1) {
      s = pushEvent(s, ev({ id: `W${i}`, severity: 'WARN' }));
    }
    s = pushEvent(s, ev({ id: 'KRITIK', severity: 'CRITICAL' }));
    expect(s.events.some((e) => e.id === 'KRITIK')).toBe(true);
  });
});

describe('depolama baskısı budaması', () => {
  it('KRİTİK baskıda INFO silinir, CRITICAL KORUNUR', () => {
    let s = createSession('A', 0);
    s = pushEvent(s, ev({ id: 'i1', severity: 'INFO' }));
    s = pushEvent(s, ev({ id: 'c1', severity: 'CRITICAL' }));
    s = pushEvent(s, ev({ id: 'w1', severity: 'WARN' }));

    const pruned = applyStoragePressure(s, 'CRITICAL', 9_999_999);
    expect(pruned.events.some((e) => e.id === 'c1')).toBe(true);
    expect(pruned.events.some((e) => e.id === 'w1')).toBe(true);
    expect(pruned.events.some((e) => e.id === 'i1')).toBe(false);
    expect(pruned.storage.prunedEvents).toBe(1);
    expect(pruned.storage.pressure).toBe('CRITICAL');
  });

  it('OK/WARN baskıda hiçbir kayıt silinmez', () => {
    let s = createSession('A', 0);
    s = pushEvent(s, ev({ id: 'i1', severity: 'INFO' }));
    const ok = applyStoragePressure(s, 'WARN', 100);
    expect(ok.events.length).toBe(1);
    expect(ok.storage.prunedEvents).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · Snapshot politikası: cooldown + dedupe + bütçe (görev §11)
 * ════════════════════════════════════════════════════════════════════════ */

describe('snapshot politikası', () => {
  it('tek atışlık tetik İKİNCİ kez izin vermez', () => {
    let p = emptySnapshotPolicy();
    expect(decideSnapshot(p, 'SESSION_START', 0)).toBe('ALLOW');
    p = applySnapshotDecision(p, 'SESSION_START', 'ALLOW', 0);
    expect(decideSnapshot(p, 'SESSION_START', 10_000_000)).toBe('SUPPRESSED_COOLDOWN');
  });

  it('olay fırtınası cooldown ile bastırılır', () => {
    let p = emptySnapshotPolicy();
    p = applySnapshotDecision(p, 'OBD_DATA_LOSS', 'ALLOW', 0);
    expect(decideSnapshot(p, 'OBD_DATA_LOSS', 1_000)).toBe('SUPPRESSED_COOLDOWN');
    expect(decideSnapshot(p, 'OBD_DATA_LOSS', 119_000)).toBe('SUPPRESSED_COOLDOWN');
    expect(decideSnapshot(p, 'OBD_DATA_LOSS', 121_000)).toBe('ALLOW');
  });

  it('farklı tetikler de global asgari aralığa uyar', () => {
    let p = emptySnapshotPolicy();
    p = applySnapshotDecision(p, 'OBD_DATA_LOSS', 'ALLOW', 0);
    expect(decideSnapshot(p, 'GPS_LOSS', 1_000)).toBe('SUPPRESSED_GLOBAL_GAP');
    expect(decideSnapshot(p, 'GPS_LOSS', 20_000)).toBe('ALLOW');
  });

  it('bütçe dolduğunda YENİ snapshot ÜRETİLMEZ', () => {
    let p = emptySnapshotPolicy();
    p = { ...p, count: LR_MAX_SNAPSHOTS };
    expect(decideSnapshot(p, 'TRIP_CLOSE', 999_999)).toBe('SUPPRESSED_BUDGET');
  });

  it('bastırılan snapshot SAYILIR (sessiz kayıp yok)', () => {
    let p = emptySnapshotPolicy();
    p = applySnapshotDecision(p, 'GPS_LOSS', 'SUPPRESSED_COOLDOWN', 0);
    expect(p.suppressedCount).toBe(1);
    expect(p.count).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · BlackBox halka tamponu ve pencere (görev §12)
 * ════════════════════════════════════════════════════════════════════════ */

describe('BlackBox', () => {
  it('halka kapasitesini AŞMAZ ve düşen kaydı SAYAR', () => {
    let r = emptyRing(3);
    for (let i = 0; i < 5; i += 1) r = ringPush(r, frameFromSample(sample({ monoMs: i })));
    expect(r.frames.length).toBe(3);
    expect(r.dropped).toBe(2);
    expect(r.frames[0].t).toBe(2);
  });

  it('yetersiz geçmişte preWindowComplete DÜRÜSTÇE false olur', () => {
    let st = emptyBlackBoxState();
    /* Yalnız 5 sn geçmiş var → 60 sn'lik ön pencere TAM DEĞİL. */
    for (let t = 0; t <= 5_000; t += 1_000) st = blackBoxTick(st, frameFromSample(sample({ monoMs: t })));
    st = blackBoxOpen(st, 'E1', 'OBD_DATA_LOST', 'CRITICAL', 100, 5_000, LR_MAX_BLACKBOX_EVENTS);
    expect(st.open[0].preWindowComplete).toBe(false);
  });

  it('yeterli geçmişte preWindowComplete true olur ve ön pencere 60 sn ile SINIRLI kalır', () => {
    let st = emptyBlackBoxState();
    for (let t = 0; t <= 120_000; t += 1_000) st = blackBoxTick(st, frameFromSample(sample({ monoMs: t })));
    st = blackBoxOpen(st, 'E1', 'GPS_LOST', 'WARN', 100, 120_000, LR_MAX_BLACKBOX_EVENTS);
    const w = st.open[0];
    expect(w.preWindowComplete).toBe(true);
    for (const f of w.preFrames) expect(f.t).toBeGreaterThanOrEqual(120_000 - BB_PRE_MS);
  });

  it('son pencere 120 sn dolunca KAPANIR ve yeni kare kabul etmez', () => {
    let st = emptyBlackBoxState();
    st = blackBoxTick(st, frameFromSample(sample({ monoMs: 0 })));
    st = blackBoxOpen(st, 'E1', 'INTERNET_LOST', 'WARN', 1, 0, LR_MAX_BLACKBOX_EVENTS);

    for (let t = 1_000; t <= BB_POST_MS; t += 1_000) {
      st = blackBoxTick(st, frameFromSample(sample({ monoMs: t })));
    }
    expect(st.open.length).toBe(1);

    st = blackBoxTick(st, frameFromSample(sample({ monoMs: BB_POST_MS + 1_000 })));
    expect(st.open.length).toBe(0);
    expect(st.closed.length).toBe(1);
    expect(st.closed[0].postWindowComplete).toBe(true);
  });

  it('aynı olay tipi için İKİNCİ pencere AÇILMAZ (fırtına dedupe)', () => {
    let st = emptyBlackBoxState();
    st = blackBoxTick(st, frameFromSample(sample({ monoMs: 0 })));
    st = blackBoxOpen(st, 'E1', 'OBD_DATA_LOST', 'CRITICAL', 1, 0, LR_MAX_BLACKBOX_EVENTS);
    st = blackBoxOpen(st, 'E2', 'OBD_DATA_LOST', 'CRITICAL', 2, 1_000, LR_MAX_BLACKBOX_EVENTS);
    expect(st.open.length).toBe(1);
    expect(st.open[0].eventId).toBe('E1');
  });

  it('pencere bütçesi dolunca AÇILAMAYAN pencere SAYILIR', () => {
    let st = emptyBlackBoxState();
    st = blackBoxTick(st, frameFromSample(sample({ monoMs: 0 })));
    st = blackBoxOpen(st, 'A', 'GPS_LOST', 'WARN', 1, 0, 0);
    expect(st.open.length).toBe(0);
    expect(st.refusedWindows).toBe(1);
  });

  it('kare PII taşımaz — yalnız sayısal/enum alan', () => {
    const f = frameFromSample(sample({ speed: 80, locationState: 'LIVE' }));
    const keys = Object.keys(f);
    for (const forbidden of ['latitude', 'longitude', 'lat', 'lng', 'vin', 'token']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(f.speed).toBe(80);
  });

  it('meta, kayıp kayıt sayısını ve kare adedini AÇIKÇA taşır', () => {
    let st = emptyBlackBoxState();
    st = blackBoxTick(st, frameFromSample(sample({ monoMs: 0 })));
    st = blackBoxOpen(st, 'E1', 'GPS_LOST', 'WARN', 1, 0, LR_MAX_BLACKBOX_EVENTS);
    const meta = windowMeta(st.open[0]);
    expect(meta.eventId).toBe('E1');
    expect(typeof meta.droppedRecords).toBe('number');
    expect(typeof meta.frameCount).toBe('number');
    expect(meta.postWindowComplete).toBe(false);
  });

  it('halka varsayılan kapasitesi ön+son pencereyi KAPSAR', () => {
    expect(BB_RING_CAPACITY * 1_000).toBeGreaterThanOrEqual(BB_PRE_MS + BB_POST_MS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · Senaryo algılama (görev §2)
 * ════════════════════════════════════════════════════════════════════════ */

describe('senaryo algılama', () => {
  it('ilk örnekte kenar hükmü VERİLMEZ', () => {
    const r = detect(emptyDetectState(), sample({ locationState: 'OFFLINE', online: false }));
    /* İlk örnekte "kayboldu" durumu KURULUR (ilk kez görüldüğü için hit üretir)
       ama önceki örnek olmadan "geri geldi" gibi hükümler ÜRETİLMEZ. */
    expect(r.hits.some((h) => h.scenario === 'GPS_RESTORED')).toBe(false);
    expect(r.hits.some((h) => h.scenario === 'INTERNET_RESTORED')).toBe(false);
    expect(r.hits.some((h) => h.scenario === 'ACCELERATION')).toBe(false);
  });

  it('null alan asla hüküm ÜRETMEZ ("okunamadı" ≠ "olmadı")', () => {
    let st = emptyDetectState();
    st = detect(st, sample({ monoMs: 0 })).state;
    const r = detect(st, sample({ monoMs: 1_000 }));
    expect(r.hits.length).toBe(0);
  });

  it('GPS kaybı → geri dönüş kenarları tek tek üretilir', () => {
    let st = emptyDetectState();
    st = detect(st, sample({ monoMs: 0, locationState: 'LIVE' })).state;

    const lost = detect(st, sample({ monoMs: 1_000, locationState: 'OFFLINE' }));
    expect(lost.hits.some((h) => h.scenario === 'GPS_LOST')).toBe(true);
    st = lost.state;

    /* Kayıp SÜRERKEN tekrar tekrar sayılmaz. */
    const still = detect(st, sample({ monoMs: 2_000, locationState: 'OFFLINE' }));
    expect(still.hits.some((h) => h.scenario === 'GPS_LOST')).toBe(false);
    st = still.state;

    const back = detect(st, sample({ monoMs: 3_000, locationState: 'LIVE' }));
    expect(back.hits.some((h) => h.scenario === 'GPS_RESTORED')).toBe(true);
  });

  it('tünel şüphesi: konum yok AMA araç hareket ediyor', () => {
    let st = emptyDetectState();
    st = detect(st, sample({ monoMs: 0, locationState: 'LIVE', speed: 90 })).state;
    st = detect(st, sample({ monoMs: 1_000, locationState: 'OFFLINE', speed: 90 })).state;
    const r = detect(st, sample({ monoMs: 20_000, locationState: 'OFFLINE', speed: 90 }));
    expect(r.hits.some((h) => h.scenario === 'TUNNEL_GNSS_LOSS')).toBe(true);
  });

  it('OBD tazelik kaybı KRİTİK olaydır ve snapshot ister', () => {
    let st = emptyDetectState();
    st = detect(st, sample({ monoMs: 0, obdTransportConnected: true, obdDataFresh: true })).state;
    const r = detect(st, sample({ monoMs: 1_000, obdTransportConnected: true, obdDataFresh: false }));
    const hit = r.hits.find((h) => h.scenario === 'OBD_DATA_LOST');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('CRITICAL');
    expect(hit!.snapshotTrigger).toBe('OBD_DATA_LOSS');
  });

  it('ilk handshake YALNIZ BİR KEZ sayılır', () => {
    let st = emptyDetectState();
    const first = detect(st, sample({ monoMs: 0, handshakeOutcome: 'ok' }));
    expect(first.hits.some((h) => h.scenario === 'FIRST_HANDSHAKE_OK')).toBe(true);
    st = first.state;
    const second = detect(st, sample({ monoMs: 1_000, handshakeOutcome: 'ok' }));
    expect(second.hits.some((h) => h.scenario === 'FIRST_HANDSHAKE_OK')).toBe(false);
  });

  it('termal otoritesi ürünün seviyesidir (0–3), mod düşüşü ikincildir', () => {
    let st = emptyDetectState();
    st = detect(st, sample({ monoMs: 0, thermalLevel: 0 })).state;
    const warn = detect(st, sample({ monoMs: 1_000, thermalLevel: 2 }));
    expect(warn.hits.some((h) => h.scenario === 'THERMAL_PRESSURE')).toBe(true);
    st = warn.state;
    const crit = detect(st, sample({ monoMs: 2_000, thermalLevel: 3 }));
    const hit = crit.hits.find((h) => h.scenario === 'THERMAL_PRESSURE');
    expect(hit!.severity).toBe('CRITICAL');
    expect(hit!.snapshotTrigger).toBe('THERMAL_CRIT');
  });

  it('aynı tick\'te birden fazla senaryo EŞZAMANLI algılanabilir', () => {
    let st = emptyDetectState();
    st = detect(st, sample({
      monoMs: 0, locationState: 'LIVE', online: true, speed: 50,
      obdTransportConnected: true, obdDataFresh: true, appVisible: true,
    })).state;

    const r = detect(st, sample({
      monoMs: 1_000, locationState: 'OFFLINE', online: false, speed: 20,
      obdTransportConnected: true, obdDataFresh: false, appVisible: false,
    }));
    const kinds = new Set(r.hits.map((h) => h.scenario));
    expect(kinds.has('GPS_LOST')).toBe(true);
    expect(kinds.has('INTERNET_LOST')).toBe(true);
    expect(kinds.has('OBD_DATA_LOST')).toBe(true);
    expect(kinds.has('APP_BACKGROUND')).toBe(true);
    expect(kinds.has('DECELERATION')).toBe(true);
  });

  it('kuyruk büyümesi ve replay ayrı senaryolardır', () => {
    let st = emptyDetectState();
    st = detect(st, sample({ monoMs: 0, offlineQueueSize: 2 })).state;
    const grow = detect(st, sample({ monoMs: 1_000, offlineQueueSize: 7 }));
    expect(grow.hits.some((h) => h.scenario === 'OFFLINE_QUEUE_GROWTH')).toBe(true);
    st = grow.state;
    const replay = detect(st, sample({ monoMs: 2_000, offlineQueueSize: 0 }));
    expect(replay.hits.some((h) => h.scenario === 'QUEUE_REPLAY')).toBe(true);
  });

  it('protokol değişimi yeniden kurulum sayılır', () => {
    let st = emptyDetectState();
    st = detect(st, sample({ monoMs: 0, protocolActive: 'ISO15765' })).state;
    const r = detect(st, sample({ monoMs: 1_000, protocolActive: 'KWP2000' }));
    expect(r.hits.some((h) => h.scenario === 'PROTOCOL_REESTABLISH')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · Sinyal defteri (görev §3)
 * ════════════════════════════════════════════════════════════════════════ */

describe('sinyal defteri', () => {
  it('-1 DESTEKLENMİYOR demektir, GEÇERSİZ değil', () => {
    expect(isSignalSupported(-1)).toBe(false);
    expect(isSignalSupported(undefined)).toBe(false);
    expect(isSignalSupported(0)).toBe(true);

    const row = advanceSignal(emptySignalRow('rpm'), -1, true, 'real', 1_000, 1_000);
    expect(row.invalidSamples).toBe(0);
    expect(row.validSamples).toBe(0);
    expect(row.samples).toBe(1);
  });

  it('fiziksel olarak imkânsız değer GEÇERSİZ sayılır ama SAYILIR (kör nokta yok)', () => {
    expect(isSignalPlausible('speed', 500)).toBe(false);
    const row = advanceSignal(emptySignalRow('speed'), 500, true, 'real', 1_000, 1_000);
    expect(row.invalidSamples).toBe(1);
    expect(row.validSamples).toBe(0);
    expect(row.coveredMs).toBe(0);
  });

  it('BAYAT örnek kapsamaya SAYILMAZ, ayrı sayaçta durur', () => {
    let row = advanceSignal(emptySignalRow('speed'), 60, true, 'real', 1_000, 1_000);
    row = advanceSignal(row, 60, false, 'real', 2_000, 1_000);
    expect(row.validSamples).toBe(1);
    expect(row.staleSamples).toBe(1);
    expect(row.coveredMs).toBe(1_000);
  });

  it('min/ort/max ve kapsama doğru hesaplanır', () => {
    let row = emptySignalRow('speed');
    for (const v of [40, 60, 80]) {
      row = advanceSignal(row, v, true, 'real', 1_000, 1_000);
    }
    expect(row.min).toBe(40);
    expect(row.max).toBe(80);
    expect(signalAverage(row)).toBe(60);
    expect(signalCoverageRatio(row, 6_000)).toBeCloseTo(0.5, 5);
  });

  it('kapsama oranı ölçüm süresi yoksa null (sahte %0 değil)', () => {
    expect(signalCoverageRatio(emptySignalRow('speed'), 0)).toBeNull();
  });

  it('boşluk süresi izlenir', () => {
    let row = advanceSignal(emptySignalRow('rpm'), 1_000, true, 'real', 1_000, 1_000);
    row = advanceSignal(row, 1_000, true, 'real', 31_000, 1_000);
    expect(row.longestGapMs).toBe(30_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · Yol defteri ve süre invaryantı (görev §5)
 * ════════════════════════════════════════════════════════════════════════ */

describe('yol defteri', () => {
  it('hareket + duruş + bilinmeyen === toplam ölçüm süresi', () => {
    let o = advanceOdometry(
      { distanceBaselineKm: null, distanceLatestKm: null, movingMs: 0, stoppedMs: 0, unknownMs: 0, recordedMs: 0, maxSpeedKmh: null },
      50, 10, 1_000,
    );
    o = advanceOdometry(o, 0, 10, 1_000);
    o = advanceOdometry(o, null, null, 1_000);

    expect(o.movingMs).toBe(1_000);
    expect(o.stoppedMs).toBe(1_000);
    expect(o.unknownMs).toBe(1_000);
    expect(o.recordedMs).toBe(3_000);
    expect(odometerInvariantHolds(o)).toBe(true);
  });

  it('mesafe otoritesi trip motorudur; otorite yoksa mesafe NULL kalır', () => {
    let o = advanceOdometry(
      { distanceBaselineKm: null, distanceLatestKm: null, movingMs: 0, stoppedMs: 0, unknownMs: 0, recordedMs: 0, maxSpeedKmh: null },
      50, null, 1_000,
    );
    expect(odometerDistanceKm(o)).toBeNull();

    o = advanceOdometry(o, 50, 120, 1_000);
    o = advanceOdometry(o, 50, 137.5, 1_000);
    expect(odometerDistanceKm(o)).toBeCloseTo(17.5, 5);
  });

  it('8 saatlik simüle sürüş defteri tutarlı kalır (uzun koşum)', () => {
    let o = {
      distanceBaselineKm: null as number | null, distanceLatestKm: null as number | null,
      movingMs: 0, stoppedMs: 0, unknownMs: 0, recordedMs: 0, maxSpeedKmh: null as number | null,
    };
    let km = 0;
    /* 8 saat @ 1 Hz = 28 800 örnek; 10 sn'lik adımlarla 2 880 iterasyon. */
    for (let i = 0; i < 2_880; i += 1) {
      const moving = i % 10 !== 0;
      const speed = moving ? 90 : 0;
      if (moving) km += (90 * 10) / 3_600;
      o = advanceOdometry(o, speed, km, 10_000);
    }
    expect(o.recordedMs).toBe(2_880 * 10_000);
    expect(odometerInvariantHolds(o)).toBe(true);
    expect(o.maxSpeedKmh).toBe(90);
    expect(odometerDistanceKm(o)).toBeGreaterThan(500);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11 · Sayaç deltaları
 * ════════════════════════════════════════════════════════════════════════ */

describe('oturum kapsamlı sayaç deltası', () => {
  it('taban okunmadıysa delta NULL\'dır (sahte 0 yok)', () => {
    expect(counterDelta(emptyCounter())).toBeNull();
  });

  it('ilk okuma taban olur, sonraki okumalar fark verir', () => {
    let c = advanceCounter(emptyCounter(), 12);
    expect(counterDelta(c)).toBe(0);
    c = advanceCounter(c, 15);
    expect(counterDelta(c)).toBe(3);
  });

  it('null okuma tabanı BOZMAZ', () => {
    let c = advanceCounter(emptyCounter(), 5);
    c = advanceCounter(c, null);
    expect(counterDelta(c)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12 · Gizlilik (görev §12 · §21)
 * ════════════════════════════════════════════════════════════════════════ */

describe('gizlilik', () => {
  it('VIN yalnız son 6 hane olarak taşınır', () => {
    expect(maskVehicleRef('VF1RFA00567891234')).toBe('…891234');
    expect(maskVehicleRef(null)).toBeNull();
    expect(maskVehicleRef('kisa')).toBeNull();
  });

  it('dışa aktarım ikinci kapıda TAM VIN\'i maskeler', () => {
    const s = createSession('A', 0);
    const dirty = { ...s, env: { ...s.env, vehicleRef: 'VF1RFA00567891234' } };
    const clean = sanitizeForExport(dirty);
    expect(clean.env.vehicleRef).toBe('…891234');
  });

  it('gizlilik denetimi gerçek sızıntı desenlerini YAKALAR', () => {
    expect(auditPrivacy('{"vin":"VF1RFA00567891234"}').verdict).toBe('FAILED');
    expect(auditPrivacy('{"latitude":41.0123456}').verdict).toBe('FAILED');
    expect(auditPrivacy('Authorization: Bearer abcdefghijklmno').verdict).toBe('FAILED');
    expect(auditPrivacy('{"api_key":"sk-abcdefghijk"}').verdict).toBe('FAILED');
    expect(auditPrivacy('{"mail":"a@b.com"}').verdict).toBe('FAILED');
  });

  it('denetim, bulduğu değeri RAPORA TAŞIMAZ (yalnız desen adı)', () => {
    const audit = auditPrivacy('{"latitude":41.0123456}');
    expect(audit.violations).toEqual(['KOORDINAT']);
    expect(JSON.stringify(audit)).not.toContain('41.01');
  });

  it('temiz gövde PASS verir', () => {
    expect(auditPrivacy('{"speed":80,"state":"LIVE","hits":3}').verdict).toBe('PASS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 13 · Kabul matrisi ve nihai karar (görev §15 · §16)
 * ════════════════════════════════════════════════════════════════════════ */

describe('kabul matrisi', () => {
  let base: LongRoadSession;

  beforeEach(() => {
    base = createSession('A', 0);
  });

  it('boş oturumda HİÇBİR madde PASS DEĞİLDİR', () => {
    const rows = buildAcceptanceMatrix(base, 1_000);
    const passing = rows.filter((r) => r.verdict === 'PASS');
    expect(passing.length).toBe(0);
  });

  it('her maddede eşik kaynağı BELİRTİLİR (keyfî eşik yasağı)', () => {
    const rows = buildAcceptanceMatrix(base, 1_000);
    for (const r of rows) {
      expect(r.thresholdSource.length).toBeGreaterThan(10);
      expect(r.requirement.length).toBeGreaterThan(10);
    }
  });

  it('backend yoksa FAIL DEĞİL, BLOCKED_BACKEND üretilir', () => {
    const rows = buildAcceptanceMatrix(base, 1_000);
    const fleet = rows.find((r) => r.id === 'FLEET_OFFLINE_REPLAY');
    expect(fleet!.verdict).toBe('BLOCKED_BACKEND');
  });

  it('gözlenmeyen senaryo NOT_OBSERVED\'dır, FAIL değil', () => {
    const rows = buildAcceptanceMatrix(base, 1_000);
    const tunnel = rows.find((r) => r.id === 'GPS_TUNNEL');
    expect(tunnel!.verdict).toBe('NOT_OBSERVED');
  });

  it('bağlantı varken handshake yoksa FAIL üretilir', () => {
    const s = markScenario(base, 'FIRST_VEHICLE_LINK', 100);
    const rows = buildAcceptanceMatrix(s, 1_000);
    expect(rows.find((r) => r.id === 'OBD_HANDSHAKE')!.verdict).toBe('FAIL');
  });

  it('süre invaryantı bozulursa FAIL', () => {
    const s: LongRoadSession = {
      ...base,
      odometry: { ...base.odometry, movingMs: 1_000, stoppedMs: 0, unknownMs: 0, recordedMs: 5_000 },
    };
    expect(buildAcceptanceMatrix(s, 1_000).find((r) => r.id === 'TRIP_TIME_INVARIANT')!.verdict).toBe('FAIL');
  });

  it('asgari süre dolmadan nihai karar KANIT YETERSİZ olur', () => {
    const rows = buildAcceptanceMatrix(base, 1_000);
    expect(finalVerdict(base, rows)).toBe('FIELD_VALIDATION_INSUFFICIENT_EVIDENCE');
  });

  it('tek FAIL bile nihai kararı FAILED yapar', () => {
    const s: LongRoadSession = {
      ...markScenario(base, 'FIRST_VEHICLE_LINK', 100),
      odometry: {
        ...base.odometry,
        recordedMs: LR_THRESHOLDS.minRecordedMs.value * 2,
        movingMs: LR_THRESHOLDS.minRecordedMs.value * 2,
      },
    };
    const rows = buildAcceptanceMatrix(s, 1_000);
    expect(rows.some((r) => r.verdict === 'FAIL')).toBe(true);
    expect(finalVerdict(s, rows)).toBe('FIELD_VALIDATION_FAILED');
  });

  it('özet sayımları toplam ile tutarlıdır', () => {
    const rows = buildAcceptanceMatrix(base, 1_000);
    const sum = summarizeMatrix(rows);
    expect(sum.pass + sum.fail + sum.degraded + sum.notObserved + sum.blocked + sum.insufficient)
      .toBe(sum.total);
  });

  it('bulgular öncelik sırasına göre gelir ve PASS içermez', () => {
    const s = markScenario(base, 'FIRST_VEHICLE_LINK', 100);
    const rows = buildAcceptanceMatrix(s, 1_000);
    const findings = topFindings(rows, 20);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.length).toBeLessThanOrEqual(20);
    expect(findings[0].priority).toBe('P0');
    for (const f of findings) expect(f.verdict).not.toBe('PASS');
  });

  it('gerçek araç kanıtı yoksa saha doğrulaması BLOCKED kalır', () => {
    expect(judgeRealVehicle(base)).toBe('BLOCKED_REAL_VEHICLE');

    const mock: LongRoadSession = { ...base, env: { ...base.env, obdAdapter: 'mock' } };
    expect(judgeRealVehicle(mock)).toBe('BLOCKED_REAL_VEHICLE');

    const real: LongRoadSession = {
      ...base,
      env: { ...base.env, obdAdapter: 'real' },
      signals: base.signals.map((r) => (r.id === 'speed' ? { ...r, validSamples: 10 } : r)),
    };
    expect(judgeRealVehicle(real)).toBe('VALIDATED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14 · Rapor üretimi (görev §16)
 * ════════════════════════════════════════════════════════════════════════ */

describe('rapor üretimi', () => {
  it('boş oturumda bile çökmeden rapor üretir', () => {
    const r = buildLongRoadReport({
      session: createSession('A', 0), blackBox: [], snapshotBodies: [], nowMs: 1_000,
    });
    expect(r.markdown).toContain('UZUN YOL SAHA DOĞRULAMA RAPORU');
    expect(r.markdown).toContain('FIELD_VALIDATION_INSUFFICIENT_EVIDENCE');
    expect(() => JSON.parse(r.json)).not.toThrow();
  });

  it('JSON gövdesi makine okunur ve karar alanlarını taşır', () => {
    const r = buildLongRoadReport({
      session: createSession('A', 0), blackBox: [], snapshotBodies: [], nowMs: 1_000,
    });
    const body = JSON.parse(r.json) as {
      schema: string;
      verdicts: Record<string, string>;
      specThresholds: unknown[];
    };
    expect(body.schema).toBe('caros.fieldvalidation.longroad.v1');
    expect(body.verdicts.productBehavior).toBe('UNCHANGED');
    expect(body.verdicts.driverDistraction).toBe('SAFE_PASSIVE');
    expect(body.verdicts.realVehicle).toBe('BLOCKED_REAL_VEHICLE');
    expect(Array.isArray(body.specThresholds)).toBe(true);
    expect(body.specThresholds.length).toBeGreaterThan(0);
  });

  it('bilinmeyen alanlar UNAVAILABLE yazılır (sahte 0 / sahte tarih yok)', () => {
    const started = Date.parse('2026-08-02T09:00:00.000Z');
    const s = createSession('A', started);
    const r = buildLongRoadReport({
      session: s, blackBox: [], snapshotBodies: [], nowMs: started + 60_000,
    });
    /* `endedAt`, APK SHA, git revizyonu, bölge okunmadı → hepsi UNAVAILABLE. */
    expect(r.markdown).toContain('| Bitiş | UNAVAILABLE |');
    expect(r.markdown).toContain('| APK SHA-256 | UNAVAILABLE |');
    expect(r.markdown).toContain('| Başlangıç bölgesi | UNAVAILABLE |');
    /* Bilinmeyen zaman ASLA epoch tarihine dönüşmez. */
    expect(r.markdown).not.toContain('1970-01-01');
    /* Bilinen zaman ise gerçek damgayla yazılır. */
    expect(r.markdown).toContain('2026-08-02T09:00:00.000Z');
  });

  it('gerçek araç kanıtı yokken raporda AÇIK uyarı bulunur', () => {
    const r = buildLongRoadReport({
      session: createSession('A', 0), blackBox: [], snapshotBodies: [], nowMs: 1_000,
    });
    expect(r.markdown).toContain('SAHA DOĞRULAMASI SAYILMAZ');
  });

  it('rapor kendi gizlilik denetiminden geçer', () => {
    const s = createSession('A', 0);
    const r = buildLongRoadReport({
      session: { ...s, env: { ...s.env, vehicleRef: '…891234' } },
      blackBox: [], snapshotBodies: [], nowMs: 1_000,
    });
    expect(r.privacy.verdict).toBe('PASS');
  });

  it('senaryo kapsaması raporda GÖZLENMEDİ olarak dürüstçe yazılır', () => {
    const r = buildLongRoadReport({
      session: createSession('A', 0), blackBox: [], snapshotBodies: [], nowMs: 1_000,
    });
    expect(r.markdown).toContain('NOT_OBSERVED');
    expect(r.markdown).toContain('gözlenmeyen senaryo BAŞARISIZLIK DEĞİLDİR');
  });
});
