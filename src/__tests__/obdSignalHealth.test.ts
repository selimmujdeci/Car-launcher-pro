/**
 * obdSignalHealth.test — P0-OBD-06 · OBD HAT/SİNYAL SAĞLIĞI kilitleri.
 *
 * Görev şartı: donmuş ama bağlantısı açık veri · timeout · NO DATA · parse error ·
 * reconnect · yavaş PID'in yanlışlıkla stalled sayılmaması · sıcak PID stall ·
 * eski oturum verisinin karar üretmemesi — hepsi kilitlenir.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  classifyFieldHealth, classifyLinkHealth, stallThresholdMs, frozenThresholdMs,
  isDecisionGrade, FIELD_CLASS, HOT_STALL_CEILING_MS, SLOW_FACTOR,
  expectedFieldIntervalMs,
  type FieldHealth,
} from '../platform/obd/obdHealthModel';
import {
  obdHealthMonitor, HEALTH_FIELDS, type HealthField, type FieldTimingSnapshot,
} from '../platform/obd/ObdHealthMonitor';

/** Sabit monotonik taban — testler gerçek saate BAĞLI OLMAMALI. */
const T = 1_000_000;
/** Tipik hızlı poll periyodu. */
const IV = 1_000;

function timing(over: Partial<FieldTimingSnapshot> = {}): FieldTimingSnapshot {
  return {
    lastAcceptedAtMs: T, lastChangedAtMs: T, lastRejectedAtMs: null,
    lastNotOfferedAtMs: null, observedIntervalMs: IV,
    acceptedCount: 10, rejectedCount: 0, notOfferedCount: 0, ...over,
  };
}

function field(
  f: HealthField, nowMs: number, t: FieldTimingSnapshot | undefined,
  transportConnected = true, expectedIntervalMs = IV,
): FieldHealth {
  return classifyFieldHealth({ field: f, timing: t, nowMs, expectedIntervalMs, transportConnected });
}

/* ── 1. Sözleşme ve eşikler ───────────────────────────────────────────────── */

describe('P0-OBD-06 · sağlık sözleşmesi', () => {
  it('sıcak sinyal eşiği YAVAŞ sinyalinkinden KÜÇÜKTÜR', () => {
    expect(stallThresholdMs('speed', IV)).toBeLessThan(stallThresholdMs('fuelLevel', IV));
    expect(stallThresholdMs('rpm', IV)).toBeLessThan(stallThresholdMs('intakeTemp', IV));
  });

  it('sıcak eşik mutlak tavanı AŞMAZ (gösterge donması hızlı fark edilmeli)', () => {
    expect(stallThresholdMs('speed', IV)).toBeLessThanOrEqual(HOT_STALL_CEILING_MS * 2);
    expect(stallThresholdMs('speed', 250)).toBe(HOT_STALL_CEILING_MS);
  });

  it('POWER_SAVE gibi YAVAŞ kadansta sıcak eşik BÜYÜR — sahte stall üretilmez', () => {
    const fast = stallThresholdMs('speed', 250);
    const slow = stallThresholdMs('speed', 15_000);
    expect(slow).toBeGreaterThan(fast);
  });

  it('karar kapısı: yalnız HEALTHY ve DEGRADED karar üretebilir', () => {
    expect(isDecisionGrade('HEALTHY')).toBe(true);
    expect(isDecisionGrade('DEGRADED')).toBe(true);
    expect(isDecisionGrade('STALLED')).toBe(false);
    expect(isDecisionGrade('DISCONNECTED')).toBe(false);
  });

  it('her izlenen alanın bir tazelik sınıfı VARDIR', () => {
    for (const f of HEALTH_FIELDS) expect(FIELD_CLASS[f]).toBeTruthy();
  });
});

/* ── 2. SICAK PID STALL: bağlantı açık ama veri ölü ───────────────────────── */

describe('P0-OBD-06 · sıcak sinyal stall', () => {
  it('hız yenilenmiyorsa STALLED — taşıma AÇIK olsa bile', () => {
    const stall = stallThresholdMs('speed', IV);
    const f = field('speed', T + stall + 1, timing(), true);
    expect(f.state).toBe('STALLED');
    expect(f.cause).toBe('stalled');
  });

  it('eşiğin ALTINDA hâlâ HEALTHY (sahte alarm yok)', () => {
    const stall = stallThresholdMs('speed', IV);
    expect(field('speed', T + stall - 1, timing(), true).state).toBe('HEALTHY');
  });

  it('TEK sıcak sinyal durursa HAT hükmü STALLED olur', () => {
    const stall = stallThresholdMs('speed', IV);
    const now = T + stall + 1;
    const fields = [
      field('speed', now, timing()),                                  // durdu
      field('engineTemp', now, timing({ lastAcceptedAtMs: now - 100 })), // sağlıklı
    ];
    const link = classifyLinkHealth({ transportConnected: true, dataFresh: true, fields });
    expect(link.state).toBe('STALLED');
    expect(link.hotStalled).toBe(1);
    expect(link.reason).toContain('sıcak');
  });

  it('"Bluetooth bağlı" TEK BAŞINA sağlık ÜRETMEZ', () => {
    const stall = stallThresholdMs('speed', IV);
    const now = T + stall + 1;
    const link = classifyLinkHealth({
      transportConnected: true, dataFresh: true,
      fields: HEALTH_FIELDS.map((f) => field(f, now, timing())),
    });
    expect(link.state).not.toBe('HEALTHY');
  });

  it('"ELM cevap veriyor" (dataFresh) tek başına da yetmez', () => {
    const stall = stallThresholdMs('rpm', IV);
    const link = classifyLinkHealth({
      transportConnected: true, dataFresh: true,
      fields: [field('rpm', T + stall + 1, timing())],
    });
    expect(link.state).toBe('STALLED');
  });
});

/* ── 3. YAVAŞ PID yanlışlıkla stalled sayılmaz ────────────────────────────── */

describe('P0-OBD-06 · yavaş sinyal haksız yere durmuş sayılmaz', () => {
  it('yakıt seviyesi 30 sn güncellenmese bile SAĞLIKLI', () => {
    const f = field('fuelLevel', T + 30_000, timing({ observedIntervalMs: 20_000 }), true);
    expect(f.state).toBe('HEALTHY');
  });

  it('aynı yaşta SICAK sinyal DURMUŞ sayılır (sınıf farkı gerçekten çalışıyor)', () => {
    const now = T + 30_000;
    expect(field('fuelLevel', now, timing({ observedIntervalMs: 20_000 })).state).toBe('HEALTHY');
    expect(field('speed', now, timing()).state).toBe('STALLED');
  });

  it('yavaş sinyal KENDİ eşiğini aşarsa durmuş sayılır', () => {
    const stall = stallThresholdMs('fuelLevel', IV);
    expect(field('fuelLevel', T + stall + 1, timing()).state).toBe('STALLED');
  });
});

/* ── 4. FREEZE ≠ STALL ────────────────────────────────────────────────────── */

describe('P0-OBD-06 · donmuş değer tek başına arıza değildir', () => {
  it('ölçüm AKIYOR ama değer sabit → SAĞLIKLI + frozen GÖZLEMİ', () => {
    const stall = stallThresholdMs('rpm', IV);
    const now = T + 100;                                   // ölçüm taze
    const f = field('rpm', now, timing({
      lastAcceptedAtMs: now - 100,
      lastChangedAtMs: now - frozenThresholdMs(stall) - 1, // değer çok uzundur sabit
    }));
    expect(f.state).toBe('HEALTHY');       // park hâlinde devir 0 sabittir — ARIZA DEĞİL
    expect(f.frozen).toBe(true);           // ama GÖZLEM olarak bildirilir
    expect(f.unchangedMs).toBeGreaterThan(stall);
  });

  it('sabit değer HAT hükmünü DÜŞÜRMEZ', () => {
    const stall = stallThresholdMs('rpm', IV);
    const now = T + 100;
    const fields = HEALTH_FIELDS.map((f) => field(f, now, timing({
      lastAcceptedAtMs: now - 50,
      lastChangedAtMs: now - frozenThresholdMs(stall) - 1,
    })));
    expect(classifyLinkHealth({ transportConnected: true, dataFresh: true, fields }).state)
      .toBe('HEALTHY');
  });

  it('yenileme DURDUYSA frozen DEĞİL stall bildirilir (ikisi karışmaz)', () => {
    const stall = stallThresholdMs('speed', IV);
    const f = field('speed', T + stall + 1, timing({ lastChangedAtMs: T - 999_999 }));
    expect(f.state).toBe('STALLED');
    expect(f.frozen).toBe(false);
  });
});

/* ── 5. NEDENLER AYRI: NO DATA · parse error · timeout · kopma ────────────── */

describe('P0-OBD-06 · dört neden birleştirilmez', () => {
  it('taşıma yoksa DISCONNECTED — veri hakkında iddia YOK', () => {
    const f = field('speed', T + 60_000, timing(), false);
    expect(f.state).toBe('DISCONNECTED');
    expect(f.cause).toBe('disconnected');
    expect(f.ageMs).toBeNull();          // kopukken yaş iddiası ÜRETİLMEZ
  });

  it('ECU değer VERMİYORSA neden NO DATA (stalled değil)', () => {
    const stall = stallThresholdMs('speed', IV);
    const now = T + stall + 1;
    const f = field('speed', now, timing({ lastNotOfferedAtMs: now - 10, notOfferedCount: 5 }));
    expect(f.state).toBe('STALLED');
    expect(f.cause).toBe('no_data');
  });

  it('değer geliyor ama REDDEDİLİYORSA neden parse_error', () => {
    const stall = stallThresholdMs('speed', IV);
    const now = T + stall + 1;
    const f = field('speed', now, timing({ lastRejectedAtMs: now - 5, rejectedCount: 4 }));
    expect(f.state).toBe('STALLED');
    expect(f.cause).toBe('parse_error');
  });

  it('hiç ölçüm gelmediyse neden never_seen — "sağlıklı" DEĞİL', () => {
    const f = field('speed', T, timing({ lastAcceptedAtMs: null, lastChangedAtMs: null }));
    expect(f.state).toBe('STALLED');
    expect(f.cause).toBe('never_seen');
    expect(f.ageMs).toBeNull();
  });

  it('hiç ölçüm yok + NO DATA sayacı varsa neden NO DATA', () => {
    const f = field('speed', T, timing({
      lastAcceptedAtMs: null, lastChangedAtMs: null, notOfferedCount: 9,
    }));
    expect(f.cause).toBe('no_data');
  });

  it('zamanlama HİÇ yoksa (alan hiç gözlenmedi) yine STALLED', () => {
    const f = field('speed', T, undefined);
    expect(f.state).toBe('STALLED');
    expect(f.cause).toBe('never_seen');
  });

  it('gecikme ALANIN KENDİ beklentisinin çok üstündeyse DEGRADED/slow', () => {
    /* Beklenti alanın sınıfından türer (çekirdek fast periyodundan DEĞİL) —
       aksi hâlde yavaş bir PID sürekli haksız yere "yavaş" damgası yerdi. */
    const expected = expectedFieldIntervalMs('engineTemp', IV)!;
    const f = field('engineTemp', T + 100, timing({
      lastAcceptedAtMs: T + 50, observedIntervalMs: expected * SLOW_FACTOR + 1,
    }));
    expect(f.state).toBe('DEGRADED');
    expect(f.cause).toBe('slow');
  });

  it('yavaş sinyalin KENDİ kadansındaki gecikmesi "yavaş" SAYILMAZ', () => {
    // Yakıt seviyesi 20 sn'de bir gelir — native VERY_SLOW kademesi. NORMALDİR.
    const f = field('fuelLevel', T + 100, timing({
      lastAcceptedAtMs: T + 50, observedIntervalMs: 20_000,
    }));
    expect(f.state).toBe('HEALTHY');
  });

  it('red sayısı kabul kadar çoksa DEGRADED/parse_error', () => {
    const f = field('engineTemp', T + 100, timing({
      lastAcceptedAtMs: T + 50, acceptedCount: 3, rejectedCount: 3,
    }));
    expect(f.state).toBe('DEGRADED');
    expect(f.cause).toBe('parse_error');
  });
});

/* ── 6. HAT hükmü ─────────────────────────────────────────────────────────── */

describe('P0-OBD-06 · hat hükmü', () => {
  const fresh = (f: HealthField, now: number) => field(f, now, timing({ lastAcceptedAtMs: now - 50 }));

  it('her şey akıyorsa HEALTHY', () => {
    const now = T + 500;
    const link = classifyLinkHealth({
      transportConnected: true, dataFresh: true,
      fields: HEALTH_FIELDS.map((f) => fresh(f, now)),
    });
    expect(link.state).toBe('HEALTHY');
    expect(link.healthy).toBe(HEALTH_FIELDS.length);
  });

  it('dataFresh KAPALIYSA en iyi ihtimalle DEGRADED (mevcut otorite yok sayılmaz)', () => {
    const now = T + 500;
    const link = classifyLinkHealth({
      transportConnected: true, dataFresh: false,
      fields: HEALTH_FIELDS.map((f) => fresh(f, now)),
    });
    expect(link.state).toBe('DEGRADED');
    expect(link.reason).toContain('ECU sessiz');
  });

  it('taşıma yoksa DISCONNECTED ve sayaçlar sıfır', () => {
    const link = classifyLinkHealth({ transportConnected: false, dataFresh: true, fields: [] });
    expect(link.state).toBe('DISCONNECTED');
    expect(link.healthy).toBe(0);
  });

  it('hiçbir sinyal akmıyorsa STALLED', () => {
    const now = T + 600_000;
    const link = classifyLinkHealth({
      transportConnected: true, dataFresh: true,
      fields: HEALTH_FIELDS.map((f) => field(f, now, timing())),
    });
    expect(link.state).toBe('STALLED');
  });
});

/* ── 7. Monitör: örnekleme, reconnect, eski oturum ────────────────────────── */

describe('P0-OBD-06 · monitör alan zamanlaması', () => {
  beforeEach(() => obdHealthMonitor.reset());

  it('kabul edilen ölçüm damgalanır ve DEĞİŞİM ayrı izlenir', () => {
    obdHealthMonitor.noteFieldSample('speed', 'accepted', 50, T);
    obdHealthMonitor.noteFieldSample('speed', 'accepted', 50, T + 1_000);   // değişmedi
    obdHealthMonitor.noteFieldSample('speed', 'accepted', 60, T + 2_000);   // değişti
    const t = obdHealthMonitor.snapshot(T + 2_000).fieldTiming.speed!;
    expect(t.lastAcceptedAtMs).toBe(T + 2_000);
    expect(t.lastChangedAtMs).toBe(T + 2_000);
    expect(t.acceptedCount).toBe(3);
    expect(t.observedIntervalMs).toBeGreaterThan(0);
  });

  it('değer SABİT kalırsa lastChanged İLERLEMEZ (freeze ölçülebilir)', () => {
    obdHealthMonitor.noteFieldSample('rpm', 'accepted', 0, T);
    obdHealthMonitor.noteFieldSample('rpm', 'accepted', 0, T + 30_000);
    const t = obdHealthMonitor.snapshot(T + 30_000).fieldTiming.rpm!;
    expect(t.lastAcceptedAtMs).toBe(T + 30_000);
    expect(t.lastChangedAtMs).toBe(T);
  });

  it('NO DATA ve RED ayrı sayaçlara gider — kabul sayacı ŞİŞMEZ', () => {
    obdHealthMonitor.noteFieldSample('engineTemp', 'not_offered', null, T);
    obdHealthMonitor.noteFieldSample('engineTemp', 'rejected', null, T + 10);
    const t = obdHealthMonitor.snapshot(T + 20).fieldTiming.engineTemp!;
    expect(t.notOfferedCount).toBe(1);
    expect(t.rejectedCount).toBe(1);
    expect(t.acceptedCount).toBe(0);
    expect(t.lastAcceptedAtMs).toBeNull();     // sahte "taze" YOK
  });

  it('HİÇ gözlenmemiş alan haritada YER ALMAZ (boş kayıt "sağlıklı" okunmasın)', () => {
    obdHealthMonitor.noteFieldSample('speed', 'accepted', 10, T);
    const ft = obdHealthMonitor.snapshot(T).fieldTiming;
    expect(ft.speed).toBeDefined();
    expect(ft.rpm).toBeUndefined();
  });

  it('RECONNECT eski oturumun zamanlamasını DÜŞÜRÜR', () => {
    obdHealthMonitor.noteFieldSample('speed', 'accepted', 50, T);
    expect(obdHealthMonitor.snapshot(T).fieldTiming.speed!.lastAcceptedAtMs).toBe(T);

    obdHealthMonitor.noteReconnect(T + 1_000);
    const ft = obdHealthMonitor.snapshot(T + 1_000).fieldTiming;
    /* Damga düştü: yeni oturumda tek ölçüm gelmeden alan TAZE görünemez. */
    expect(ft.speed?.lastAcceptedAtMs ?? null).toBeNull();
  });

  it('YENİ BAĞLANTI da zamanlamayı sıfırlar (başka araç olabilir)', () => {
    obdHealthMonitor.noteFieldSample('speed', 'accepted', 50, T);
    obdHealthMonitor.noteConnected(T + 500);
    expect(obdHealthMonitor.snapshot(T + 500).fieldTiming.speed?.lastAcceptedAtMs ?? null)
      .toBeNull();
  });

  it('ESKİ OTURUM verisi karar ÜRETEMEZ (reconnect sonrası hüküm STALLED)', () => {
    obdHealthMonitor.noteFieldSample('speed', 'accepted', 50, T);
    obdHealthMonitor.noteReconnect(T + 100);
    const snap = obdHealthMonitor.snapshot(T + 200);
    const f = field('speed', T + 200, snap.fieldTiming.speed, true, snap.expectedIntervalMs);
    expect(f.state).toBe('STALLED');
    expect(isDecisionGrade(classifyLinkHealth({
      transportConnected: true, dataFresh: true, fields: [f],
    }).state)).toBe(false);
  });

  it('mevcut skor sözleşmesi BOZULMADI (noteField hâlâ çalışıyor)', () => {
    obdHealthMonitor.noteConnected(T);
    obdHealthMonitor.noteField('speed', true, T);
    obdHealthMonitor.noteField('speed', false, T + 10);
    const s = obdHealthMonitor.snapshot(T + 20);
    expect(s.sensorReliability.speed).toBe(50);
    expect(s.connectionQuality).toBeGreaterThanOrEqual(0);
  });
});
