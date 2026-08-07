/**
 * longRoadSelfValidation.test.ts — SAHA TESTİNİN ÖZ-DENETİMİ (pre-road §2).
 *
 * En kritik kilit: **doğrulayıcı PASS/FAIL kararını DEĞİŞTİRMEZ.** Ölçen ile
 * ölçümü denetleyen ayrı otoritelerdir; biri diğerini yükseltip düşüremez.
 */

import { describe, it, expect } from 'vitest';

import validatorSrc from '../platform/fieldValidation/longRoadSelfValidator.ts?raw';

import {
  createSession, markScenario, pushEvent, resumeSession,
  type FieldEvent, type LongRoadSession, type SessionState,
} from '../platform/fieldValidation/longRoadModel';
import {
  SELF_CHECK_ORDER, validateSelf,
  type SelfCheckId, type SelfCheckResult,
} from '../platform/fieldValidation/longRoadSelfValidator';
import { buildLongRoadReport } from '../platform/fieldValidation/longRoadReport';
import { buildAcceptanceMatrix, finalVerdict } from '../platform/fieldValidation/longRoadAcceptance';
import { openWindow, emptyRing, ringPush, frameFromSample } from '../platform/fieldValidation/longRoadBlackBox';
import type { LongRoadSample } from '../platform/fieldValidation/longRoadDetect';

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

const T0 = 1_800_000_000_000;

function base(): LongRoadSession {
  return { ...createSession('LR-TEST', T0), state: 'ACTIVE' as SessionState };
}

function ev(over: Partial<FieldEvent> = {}): FieldEvent {
  return { id: `E${Math.random()}`, type: 'GPS_LOST', severity: 'WARN', detectedAt: T0 + 1000, detail: 'x', ...over };
}

function resultOf(rows: readonly { id: SelfCheckId; result: SelfCheckResult }[], id: SelfCheckId): SelfCheckResult {
  return rows.find((r) => r.id === id)!.result;
}

/** Ölçülmüş bir oturum: 3 GPS kaybı olayı + eşleşen sayaç + sinyal defteri. */
function measuredSession(): LongRoadSession {
  let s = base();
  for (let i = 0; i < 3; i += 1) {
    s = markScenario(s, 'GPS_LOST', T0 + 1000 * (i + 1));
    s = pushEvent(s, ev({ id: `EV-${i}`, type: 'GPS_LOST', detectedAt: T0 + 1000 * (i + 1) }));
  }
  return {
    ...s,
    counters: { ...s.counters, gpsLossCount: 3 },
    odometry: {
      ...s.odometry,
      recordedMs: 60_000, movingMs: 60_000, maxSpeedKmh: 80,
      distanceBaselineKm: 100, distanceLatestKm: 110,
    },
    signals: s.signals.map((r) => (r.id === 'speed'
      ? { ...r, validSamples: 60, samples: 60, coveredMs: 60_000, min: 60, max: 90, sum: 4500, confidence: 'OBSERVED' as const }
      : r)),
  };
}

function sample(over: Partial<LongRoadSample> = {}): LongRoadSample {
  return {
    wallMs: T0, monoMs: 0,
    obdTransportConnected: null, obdDataFresh: null, obdConnectionState: null, obdSource: null,
    obdLastPacketAgeMs: null, handshakeOutcome: null, protocolActive: null, protocolTried: null,
    vinPresent: null, supportedPidCount: null, reconnectRequested: null, resetRequested: null,
    disconnectCalled: null, transportReconnectAttempts: null, kwpStatus: null,
    kwpRecoveryCount: null, kwpSuppressedCount: null, kwpAtpcFailures: null, canRetryCount: null,
    halActiveSource: null, speed: null, rpm: null, engineTemp: null, throttle: null,
    intakeTemp: null, fuelLevel: null, batteryVoltage: null, locationState: null,
    locationProvider: null, locationAccuracyM: null, locationFixAgeMs: null,
    gpsSwitchCount: null, gpsFallbackCount: null, tripActive: null, tripTotalDistanceKm: null,
    tripTotalCount: null, online: null, telemetryReportPresent: null, offlineQueueSize: null,
    runtimeMode: null, thermalLevel: null, ramPressureRatio: null, uiFreezeCount: null,
    workerRestartTotal: null, memoryPressure: null, appVisible: null, batteryPercent: null,
    charging: null, ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · OTORİTE AYRIMI — en kritik kilit
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · otorite ayrımı', () => {
  it('doğrulayıcı yapısal olarak "kararı etkilemem" beyan eder', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(r.affectsAcceptanceVerdict).toBe(false);
  });

  it('BOZUK öz-denetim bile PASS/FAIL kararını DEĞİŞTİRMEZ', () => {
    /* Sayaç ham defterle çelişsin → MISMATCH garantili. */
    const broken: LongRoadSession = {
      ...measuredSession(),
      counters: { ...measuredSession().counters, gpsLossCount: 99 },
    };

    const matrixBefore = buildAcceptanceMatrix(broken, T0 + 60_000);
    const verdictBefore = finalVerdict(broken, matrixBefore);

    const self = validateSelf(broken, [], T0 + 60_000);
    expect(self.verdict).toBe('MISMATCH');

    /* Doğrulayıcı koştuktan SONRA da matris ve karar AYNI. */
    const matrixAfter = buildAcceptanceMatrix(broken, T0 + 60_000);
    expect(finalVerdict(broken, matrixAfter)).toBe(verdictBefore);
    expect(matrixAfter.map((x) => x.verdict)).toEqual(matrixBefore.map((x) => x.verdict));
  });

  it('rapor iki otoriteyi AYRI alanlarda taşır', () => {
    const s = measuredSession();
    const rep = buildLongRoadReport({ session: s, blackBox: [], snapshotBodies: [], nowMs: T0 + 60_000 });
    const body = JSON.parse(rep.json) as {
      verdicts: Record<string, unknown>;
      selfValidation: { verdict: string; affectsAcceptanceVerdict: boolean };
    };
    /* Öz-denetim `verdicts` bloğunun İÇİNDE OLMAMALI. */
    expect(body.verdicts.selfValidation).toBeUndefined();
    expect(body.selfValidation).toBeDefined();
    expect(body.selfValidation.affectsAcceptanceVerdict).toBe(false);
    expect(rep.markdown).toContain('kabul matrisinden AYRI otorite');
    expect(rep.markdown).toContain('PASS/FAIL kararını **DEĞİŞTİRMEZ**');
  });

  it('doğrulayıcı SAF: zaman/rastgele/IO okumaz, oturumu değiştirmez', () => {
    const code = validatorSrc
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(/Date\.now\s*\(/.test(code)).toBe(false);
    expect(/Math\.random\s*\(/.test(code)).toBe(false);
    expect(/localStorage/.test(code)).toBe(false);
    expect(/setInterval|setTimeout/.test(code)).toBe(false);
    /* Kabul matrisini İMPORT DAHİ ETMEZ → yükseltip düşüremez. */
    expect(code.includes('longRoadAcceptance')).toBe(false);
  });

  it('doğrulayıcı oturum nesnesini MUTASYONA UĞRATMAZ', () => {
    const s = measuredSession();
    const before = JSON.stringify(s);
    validateSelf(s, [], T0 + 60_000);
    expect(JSON.stringify(s)).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Ham olay varlığı
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · ham olay varlığı', () => {
  it('sayaç dolu ama ham olay yoksa MISMATCH', () => {
    const s = markScenario(base(), 'GPS_LOST', T0 + 1000);   // olay EKLENMEDİ
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'RAW_EVENT_PRESENT')).toBe('MISMATCH');
  });

  it('her iddianın ham olayı varsa VERIFIED', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'RAW_EVENT_PRESENT')).toBe('VERIFIED');
  });

  it('hiç iddia yoksa NOT_CHECKED (sessizce VERIFIED sayılmaz)', () => {
    const r = validateSelf(base(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'RAW_EVENT_PRESENT')).toBe('NOT_CHECKED');
  });

  it('defter budanmışsa suçlama YERİNE ham kanıt yetersizliği bildirilir', () => {
    const s: LongRoadSession = {
      ...markScenario(base(), 'GPS_LOST', T0 + 1000),
      dropped: { droppedSamples: 0, droppedEvents: 5, droppedBlackBoxRecords: 0 },
    };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'RAW_EVENT_PRESENT')).toBe('INSUFFICIENT_RAW_EVIDENCE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Zaman tutarlılığı
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · zaman', () => {
  it('pencere dışı damga MISMATCH üretir', () => {
    const s = pushEvent(base(), ev({ detectedAt: T0 - 10_000 }));   // oturumdan ÖNCE
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'TIME_RANGE')).toBe('MISMATCH');
  });

  it('bitiş < başlangıç → CORRUPT', () => {
    const s: LongRoadSession = { ...base(), endedAt: T0 - 1 };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'TIME_RANGE')).toBe('CORRUPT');
  });

  it('ölçüm süresi duvar saatini aşarsa MISMATCH (çift sayım)', () => {
    const s: LongRoadSession = {
      ...measuredSession(),
      odometry: { ...measuredSession().odometry, recordedMs: 10 * 60_000 },
    };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'TIME_RANGE')).toBe('MISMATCH');
  });

  it('isabet var ama damga yoksa CORRUPT', () => {
    const s = base();
    const broken: LongRoadSession = {
      ...s,
      scenarios: s.scenarios.map((x) => (x.id === 'GPS_LOST' ? { ...x, hits: 2, firstAt: null, lastAt: null } : x)),
    };
    const r = validateSelf(broken, [], T0 + 60_000);
    expect(resultOf(r.rows, 'TIME_RANGE')).toBe('CORRUPT');
  });

  it('tutarlı oturumda VERIFIED', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'TIME_RANGE')).toBe('VERIFIED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Sayaç yeniden hesabı
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · sayaç yeniden hesabı', () => {
  it('sayaç ham olay adediyle birebir ise VERIFIED', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'COUNTER_RECOMPUTE')).toBe('VERIFIED');
  });

  it('sayaç şişirilmişse MISMATCH', () => {
    const m = measuredSession();
    const s: LongRoadSession = { ...m, counters: { ...m.counters, gpsLossCount: 99 } };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'COUNTER_RECOMPUTE')).toBe('MISMATCH');
  });

  it('budama varsa fark MISMATCH DEĞİL, ham kanıt yetersizliğidir', () => {
    const m = measuredSession();
    const s: LongRoadSession = {
      ...m,
      counters: { ...m.counters, gpsLossCount: 99 },
      storage: { ...m.storage, prunedEvents: 40 },
    };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'COUNTER_RECOMPUTE')).toBe('INSUFFICIENT_RAW_EVIDENCE');
  });

  it('negatif sayaç CORRUPT', () => {
    const m = measuredSession();
    const s: LongRoadSession = { ...m, counters: { ...m.counters, gpsLossCount: -1 } };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'COUNTER_RECOMPUTE')).toBe('CORRUPT');
  });

  it('ham defter boşsa yeniden hesap YAPILAMAZ', () => {
    const r = validateSelf(base(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'COUNTER_RECOMPUTE')).toBe('INSUFFICIENT_RAW_EVIDENCE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Null → hüküm dönüşümü
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · null hükme dönüşmemeli', () => {
  it('geçerli örnek yokken min/max doluysa MISMATCH', () => {
    const m = measuredSession();
    const s: LongRoadSession = {
      ...m,
      signals: m.signals.map((r) => (r.id === 'rpm' ? { ...r, validSamples: 0, min: 0, max: 0 } : r)),
    };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'NULL_NOT_VERDICT')).toBe('MISMATCH');
  });

  it('mesafe otoritesi yokken km üretilmişse MISMATCH', () => {
    const m = measuredSession();
    const s: LongRoadSession = {
      ...m,
      odometry: { ...m.odometry, distanceBaselineKm: null },
    };
    /* Otorite yoksa `odometerDistanceKm` zaten null döner; burada YAPISAL
       çelişki kurulamaz — bu yüzden hareket/hız çelişkisiyle sınıyoruz. */
    const s2: LongRoadSession = { ...s, odometry: { ...s.odometry, maxSpeedKmh: null, movingMs: 5000 } };
    const r = validateSelf(s2, [], T0 + 60_000);
    expect(resultOf(r.rows, 'NULL_NOT_VERDICT')).toBe('MISMATCH');
  });

  it('geçerli örnek varken güven UNAVAILABLE ise MISMATCH', () => {
    const m = measuredSession();
    const s: LongRoadSession = {
      ...m,
      signals: m.signals.map((r) => (r.id === 'speed' ? { ...r, confidence: 'UNAVAILABLE' as const } : r)),
    };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'NULL_NOT_VERDICT')).toBe('MISMATCH');
  });

  it('temiz defterde VERIFIED', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'NULL_NOT_VERDICT')).toBe('VERIFIED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · Kopya olay
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · kopya olay', () => {
  it('aynı kimlik iki kez → CORRUPT', () => {
    let s = base();
    s = pushEvent(s, ev({ id: 'AYNI' }));
    s = pushEvent(s, ev({ id: 'AYNI', detectedAt: T0 + 2000 }));
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'DUPLICATE_EVENTS')).toBe('CORRUPT');
  });

  it('aynı tip aynı milisaniyede iki kez → MISMATCH', () => {
    let s = base();
    s = pushEvent(s, ev({ id: 'A', type: 'GPS_LOST', detectedAt: T0 + 5 }));
    s = pushEvent(s, ev({ id: 'B', type: 'GPS_LOST', detectedAt: T0 + 5 }));
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'DUPLICATE_EVENTS')).toBe('MISMATCH');
  });

  it('benzersiz defterde VERIFIED', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'DUPLICATE_EVENTS')).toBe('VERIFIED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · Düşen kaydın etkisi
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · düşen kayıt', () => {
  it('hiç kayıp yoksa VERIFIED', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'DROPPED_IMPACT')).toBe('VERIFIED');
  });

  it('kayıp varsa hüküm KESİN sayılmaz', () => {
    const m = measuredSession();
    const s: LongRoadSession = {
      ...m, dropped: { droppedSamples: 3, droppedEvents: 0, droppedBlackBoxRecords: 0 },
    };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'DROPPED_IMPACT')).toBe('INSUFFICIENT_RAW_EVIDENCE');
  });

  it('BASTIRILAN snapshot kayıp SAYILMAZ (politika davranışı)', () => {
    const m = measuredSession();
    const s: LongRoadSession = {
      ...m, snapshotPolicy: { ...m.snapshotPolicy, suppressedCount: 25 },
    };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'DROPPED_IMPACT')).toBe('VERIFIED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · Checkpoint ↔ halka çelişkisi
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · checkpoint ↔ halka', () => {
  it('pencere yoksa NOT_CHECKED', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'CHECKPOINT_RING')).toBe('NOT_CHECKED');
  });

  it('"ön pencere TAM" yalanı yakalanır', () => {
    const m = measuredSession();
    /* Yalnız 5 sn geçmişle açılmış ama TAM işaretlenmiş sahte pencere. */
    let ring = emptyRing();
    for (let t = 0; t <= 5_000; t += 1_000) ring = ringPush(ring, frameFromSample(sample({ monoMs: t })));
    const w = openWindow(ring, 'EV-0', 'GPS_LOST', 'WARN', T0 + 1000, 5_000);
    const lying = { ...w, preWindowComplete: true };

    const r = validateSelf(m, [lying], T0 + 60_000);
    expect(resultOf(r.rows, 'CHECKPOINT_RING')).toBe('MISMATCH');
  });

  it('gerçekten tam pencere VERIFIED', () => {
    const m = measuredSession();
    let ring = emptyRing();
    for (let t = 0; t <= 130_000; t += 1_000) ring = ringPush(ring, frameFromSample(sample({ monoMs: t })));
    const w = openWindow(ring, 'EV-0', 'GPS_LOST', 'WARN', T0 + 1000, 130_000);
    expect(w.preWindowComplete).toBe(true);

    const r = validateSelf(m, [w], T0 + 60_000);
    expect(resultOf(r.rows, 'CHECKPOINT_RING')).toBe('VERIFIED');
  });

  it('ham olaya bağlanamayan pencere MISMATCH', () => {
    const m = measuredSession();
    let ring = emptyRing();
    for (let t = 0; t <= 130_000; t += 1_000) ring = ringPush(ring, frameFromSample(sample({ monoMs: t })));
    const w = openWindow(ring, 'HAYALET', 'GPS_LOST', 'WARN', T0 + 1000, 130_000);

    const r = validateSelf(m, [w], T0 + 60_000);
    expect(resultOf(r.rows, 'CHECKPOINT_RING')).toBe('MISMATCH');
  });

  it('oturum penceresi dışındaki pencere CORRUPT', () => {
    const m = measuredSession();
    let ring = emptyRing();
    for (let t = 0; t <= 130_000; t += 1_000) ring = ringPush(ring, frameFromSample(sample({ monoMs: t })));
    const w = openWindow(ring, 'EV-0', 'GPS_LOST', 'WARN', T0 - 50_000, 130_000);

    const r = validateSelf(m, [w], T0 + 60_000);
    expect(resultOf(r.rows, 'CHECKPOINT_RING')).toBe('CORRUPT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · Restart sayaç sıçraması
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · restart', () => {
  it('restore yoksa NOT_CHECKED', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(resultOf(r.rows, 'RESTART_COUNTER_JUMP')).toBe('NOT_CHECKED');
  });

  it('sürüm ile restore sayısı uyuşmazsa MISMATCH (sessiz yeniden başlatma)', () => {
    const m = measuredSession();
    const s: LongRoadSession = { ...m, sessionVersion: 5, restoreCount: 1 };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'RESTART_COUNTER_JUMP')).toBe('MISMATCH');
  });

  it('restore edildiği hâlde defter sıfırsa MISMATCH', () => {
    const resumed = resumeSession(measuredSession(), 'PROCESS_DEATH', T0 + 5000);
    const s: LongRoadSession = { ...resumed, odometry: { ...resumed.odometry, recordedMs: 0 } };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(resultOf(r.rows, 'RESTART_COUNTER_JUMP')).toBe('MISMATCH');
  });

  it('sağlıklı restore VERIFIED', () => {
    const resumed = resumeSession(measuredSession(), 'APP_RESTART', T0 + 5000);
    const r = validateSelf(resumed, [], T0 + 60_000);
    expect(resultOf(r.rows, 'RESTART_COUNTER_JUMP')).toBe('VERIFIED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · Genel hüküm
 * ════════════════════════════════════════════════════════════════════════ */

describe('öz-denetim · genel hüküm', () => {
  it('sekiz denetimin hepsi raporlanır', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    expect(r.rows.map((x) => x.id)).toEqual([...SELF_CHECK_ORDER]);
  });

  it('genel hüküm EN KÖTÜ satırdır', () => {
    const m = measuredSession();
    const s: LongRoadSession = { ...m, counters: { ...m.counters, gpsLossCount: 99 } };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(r.verdict).toBe('MISMATCH');
    expect(r.rows.some((x) => x.result === 'VERIFIED')).toBe(true);   // bazıları iyi ama hüküm kötü
  });

  it('CORRUPT oturumda tüm denetimler CORRUPT (uydurma doğrulama yok)', () => {
    const s: LongRoadSession = { ...base(), state: 'CORRUPT' };
    const r = validateSelf(s, [], T0 + 60_000);
    expect(r.verdict).toBe('CORRUPT');
    expect(r.rows.every((x) => x.result === 'CORRUPT')).toBe(true);
    expect(r.verifiedCount).toBe(0);
  });

  it('her satır kanıt veya gerekçe taşır (boş hüküm yok)', () => {
    const r = validateSelf(measuredSession(), [], T0 + 60_000);
    for (const row of r.rows) {
      expect(row.detail.length).toBeGreaterThan(10);
      expect(row.title.length).toBeGreaterThan(3);
    }
  });
});
