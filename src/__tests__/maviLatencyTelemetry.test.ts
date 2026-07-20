/**
 * maviLatencyTelemetry.test.ts — Mavi Çekirdeği Faz-1 · Gecikme telemetrisi sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Dört segment monotonik farklardan doğru türetilir (wake→listening, speechEnd→plan,
 *     plan→firstAction, firstAction→complete) + total.
 *  2. Eksik marker → ilgili segment undefined (uydurma yok).
 *  3. Yavaş aşama eşiği aşılınca onSlowStage (yalnız ölçüm) tetiklenir.
 *  4. Aynı marker tekrarında ilk değer korunur; bozuk marker yok sayılır.
 *  5. Bounded ring; reset/endSession idempotent; sinceLastMark harici watchdog için.
 */
import { describe, it, expect, vi } from 'vitest';
import { createLatencyTracker, deriveSegments, type LatencyMarker } from '../platform/maviCore/latencyTelemetry';

describe('MaviLatencyTracker — segment türetme', () => {
  it('dört segment + total doğru hesaplanır', () => {
    let t = 0;
    const tr = createLatencyTracker({ now: () => t, stageThresholdMs: 100000 });
    tr.beginSession(1);
    t = 100; tr.mark('wake');
    t = 400; tr.mark('listening');    // wakeToListening = 300
    t = 1000; tr.mark('speechEnd');
    t = 1200; tr.mark('planStart');   // speechEndToPlan = 200
    t = 1250; tr.mark('firstAction'); // planToFirstAction = 50
    t = 1900; tr.mark('complete');    // firstActionToComplete = 650
    const s = tr.segments();
    expect(s.wakeToListening).toBe(300);
    expect(s.speechEndToPlan).toBe(200);
    expect(s.planToFirstAction).toBe(50);
    expect(s.firstActionToComplete).toBe(650);
    expect(s.total).toBe(1800); // complete - wake
  });

  it('eksik marker → segment undefined', () => {
    let t = 0;
    const tr = createLatencyTracker({ now: () => t, stageThresholdMs: 100000 });
    tr.beginSession(1);
    t = 10; tr.mark('wake');
    t = 50; tr.mark('listening');
    const s = tr.segments();
    expect(s.wakeToListening).toBe(40);
    expect(s.speechEndToPlan).toBeUndefined();
    expect(s.total).toBeUndefined();
  });

  it('negatif/sıra-dışı süre yok sayılır', () => {
    const marks = new Map<LatencyMarker, number>([['wake', 500], ['complete', 100]]);
    expect(deriveSegments(marks).total).toBeUndefined();
  });
});

describe('MaviLatencyTracker — yavaş aşama uyarısı', () => {
  it('eşiği aşan geçiş onSlowStage tetikler', () => {
    let t = 0;
    const slow = vi.fn();
    const tr = createLatencyTracker({ now: () => t, stageThresholdMs: 500, onSlowStage: slow });
    tr.beginSession(7);
    t = 0; tr.mark('wake');
    t = 900; tr.mark('listening'); // delta 900 > 500 → yavaş
    expect(slow).toHaveBeenCalledOnce();
    const ev = slow.mock.calls[0][0];
    expect(ev.fromMarker).toBe('wake');
    expect(ev.toMarker).toBe('listening');
    expect(ev.ms).toBe(900);
    expect(ev.sessionId).toBe(7);
  });

  it('eşik altı geçiş uyarı üretmez', () => {
    let t = 0;
    const slow = vi.fn();
    const tr = createLatencyTracker({ now: () => t, stageThresholdMs: 500, onSlowStage: slow });
    tr.beginSession(1);
    t = 0; tr.mark('wake');
    t = 200; tr.mark('listening');
    expect(slow).not.toHaveBeenCalled();
  });
});

describe('MaviLatencyTracker — sağlamlık', () => {
  it('aynı marker tekrarında ilk değer korunur', () => {
    let t = 0;
    const tr = createLatencyTracker({ now: () => t, stageThresholdMs: 100000 });
    tr.beginSession(1);
    t = 100; tr.mark('wake');
    t = 500; tr.mark('wake'); // yok sayılır
    t = 600; tr.mark('listening');
    expect(tr.segments().wakeToListening).toBe(500); // 600 - 100
  });

  it('bozuk marker yok sayılır', () => {
    const tr = createLatencyTracker();
    tr.beginSession(1);
    tr.mark('zıpla' as unknown as LatencyMarker);
    expect(tr.segments().wakeToListening).toBeUndefined();
  });

  it('sinceLastMark harici watchdog için geçen süreyi verir', () => {
    let t = 0;
    const tr = createLatencyTracker({ now: () => t });
    tr.beginSession(1);
    expect(tr.sinceLastMark()).toBe(-1); // hiç işaret yok
    t = 1000; tr.mark('wake');
    t = 1700;
    expect(tr.sinceLastMark()).toBe(700);
  });
});

describe('MaviLatencyTracker — bounded ring + lifecycle', () => {
  it('endSession segmentleri ring\'e yazar; tavan aşılınca en eski düşer', () => {
    let t = 0;
    const tr = createLatencyTracker({ now: () => t, maxSessions: 2, stageThresholdMs: 100000 });
    for (let i = 1; i <= 3; i++) {
      tr.beginSession(i);
      t += 10; tr.mark('wake');
      t += 10; tr.mark('complete');
      tr.endSession();
    }
    const recent = tr.recent();
    expect(recent.length).toBe(2);
    expect(recent.map((r) => r.sessionId)).toEqual([2, 3]);
  });

  it('reset tümünü temizler (idempotent)', () => {
    const tr = createLatencyTracker();
    tr.beginSession(1);
    tr.mark('wake');
    tr.endSession();
    tr.reset();
    tr.reset(); // idempotent
    expect(tr.recent().length).toBe(0);
    expect(tr.sinceLastMark()).toBe(-1);
  });
});
