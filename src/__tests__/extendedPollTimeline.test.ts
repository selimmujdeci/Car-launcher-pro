/**
 * extendedPollTimeline.test.ts — #512 · saha hipotezi 2 kilitleri.
 *
 * SINANAN İDDİA: "tazelenme, elemenin SONUCU olabilir." Round-robin tur başına
 * 1 PID okuduğu için bir PID'in güncellenme aralığı ≈ (izlenen − elenen) × tur
 * süresidir; liste kısaldıkça hayatta kalanlar tazeleşir.
 *
 * Bu testler ÖLÇÜM ARACINI kilitler — hipotezi DOĞRU varsaymaz. Hipotezin
 * çürüdüğü durum da (AYNI_YONDE) ayrıca kilitlenir; araç yalnız "beklediğimizi"
 * söyleyemez, aksini de söyleyebilmelidir.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordExtendedTimelineSample, readExtendedTimeline, resetExtendedTimeline,
  summarizeExtendedTimeline, TIMELINE_MAX_SAMPLES, TIMELINE_MIN_GAP_MS,
  TIMELINE_VERDICT_LABEL,
  type ExtendedTimelineSample,
} from '../platform/obd/extendedPollTimeline';

const T0 = 1_700_000_000_000;

/** Yaş listesi üretir — n PID, hepsi `age` yaşında. */
function ages(n: number, age: number): number[] {
  return Array.from({ length: n }, () => age);
}

beforeEach(() => resetExtendedTimeline());

describe('kaydedici — bounded ve yan etkisiz', () => {
  it('🔒 örnek ekler ve rotasyon uzunluğunu türetir (izlenen − elenen)', () => {
    recordExtendedTimelineSample({ atMs: T0, watched: 11, demoted: 4, valued: 7, ageMsList: ages(7, 8000) });
    const [s] = readExtendedTimeline();
    expect(s.pollable).toBe(7);
    expect(s.avgAgeMs).toBe(8000);
    expect(s.maxAgeMs).toBe(8000);
  });

  it('🔒 değer yokken yaş NULL — sahte 0 üretilmez', () => {
    recordExtendedTimelineSample({ atMs: T0, watched: 11, demoted: 11, valued: 0, ageMsList: [] });
    const [s] = readExtendedTimeline();
    expect(s.avgAgeMs, 'değersiz örnekte 0 yaş uydurulmuş').toBeNull();
    expect(s.maxAgeMs).toBeNull();
    expect(s.pollable).toBe(0);
  });

  it('🔒 throttle: aynı eleme seviyesinde 1 sn içinde ikinci örnek YAZILMAZ', () => {
    expect(recordExtendedTimelineSample({ atMs: T0, watched: 11, demoted: 0, valued: 1, ageMsList: [100] })).toBe(true);
    expect(recordExtendedTimelineSample({ atMs: T0 + 100, watched: 11, demoted: 0, valued: 1, ageMsList: [100] })).toBe(false);
    expect(recordExtendedTimelineSample({ atMs: T0 + TIMELINE_MIN_GAP_MS, watched: 11, demoted: 0, valued: 1, ageMsList: [100] })).toBe(true);
    expect(readExtendedTimeline()).toHaveLength(2);
  });

  it('🔒 ELEME değişimi throttle\'dan MUAF — geçiş anı asla yutulmaz', () => {
    recordExtendedTimelineSample({ atMs: T0, watched: 11, demoted: 0, valued: 1, ageMsList: [100] });
    const wrote = recordExtendedTimelineSample({
      atMs: T0 + 5, watched: 11, demoted: 1, valued: 1, ageMsList: [100],
    });
    expect(wrote, 'eleme anı throttle tarafından yutulmuş — en değerli örnek kayboldu').toBe(true);
  });

  it('🔒 halka tamponu tavanı aşmaz', () => {
    for (let i = 0; i < TIMELINE_MAX_SAMPLES + 50; i += 1) {
      recordExtendedTimelineSample({
        atMs: T0 + i * 2000, watched: 11, demoted: 0, valued: 1, ageMsList: [100],
      });
    }
    expect(readExtendedTimeline().length).toBe(TIMELINE_MAX_SAMPLES);
  });

  it('🔒 bozuk girdi ürünü DÜŞÜRMEZ (fail-soft)', () => {
    expect(recordExtendedTimelineSample({
      atMs: Number.NaN, watched: 1, demoted: 0, valued: 0, ageMsList: [],
    })).toBe(false);
    expect(readExtendedTimeline()).toHaveLength(0);
  });

  it('🔒 reset zaman eksenini temizler (yeni oturum yeni eksen)', () => {
    recordExtendedTimelineSample({ atMs: T0, watched: 11, demoted: 0, valued: 1, ageMsList: [100] });
    resetExtendedTimeline();
    expect(readExtendedTimeline()).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * HÜKÜM — hipotez her iki yönde de sınanabilmeli
 * ════════════════════════════════════════════════════════════════════════ */

function seq(rows: Array<[demoted: number, avgAge: number]>): ExtendedTimelineSample[] {
  resetExtendedTimeline();
  rows.forEach(([d, a], i) => {
    recordExtendedTimelineSample({
      atMs: T0 + i * 3000, watched: 11, demoted: d, valued: 11 - d,
      ageMsList: ages(Math.max(1, 11 - d), a),
    });
  });
  return readExtendedTimeline().slice();
}

describe('hüküm', () => {
  it('🔒 eleme ↑ · yaş ↓ → TERS_ORANTILI (hipotez DOĞRULANIR)', () => {
    const s = summarizeExtendedTimeline(seq([
      [0, 22000], [1, 20000], [2, 17000], [4, 12000], [6, 8000], [8, 5000], [9, 4000],
    ]));
    expect(s.verdict).toBe('TERS_ORANTILI');
    expect(s.opposingSteps).toBeGreaterThan(s.agreeingSteps);
    expect(s.firstDemoted).toBe(0);
    expect(s.lastDemoted).toBe(9);
  });

  it('🔒 eleme ↑ · yaş da ↑ → AYNI_YONDE (hipotez ÇÜRÜR)', () => {
    const s = summarizeExtendedTimeline(seq([
      [0, 3000], [1, 5000], [2, 8000], [3, 11000], [5, 15000], [7, 20000], [8, 26000],
    ]));
    expect(s.verdict, 'araç yalnız beklediğimizi söylüyor — aksini söyleyemiyor').toBe('AYNI_YONDE');
  });

  it('🔒 az örnekte hüküm VERİLMEZ', () => {
    const s = summarizeExtendedTimeline(seq([[0, 9000], [1, 5000]]));
    expect(s.verdict).toBe('YETERSIZ_ORNEK');
  });

  it('🔒 eleme HİÇ değişmediyse hüküm VERİLMEZ (tek seviye)', () => {
    const s = summarizeExtendedTimeline(seq([
      [3, 9000], [3, 8000], [3, 7000], [3, 6000], [3, 5000], [3, 4000], [3, 3000],
    ]));
    expect(s.demoteLevels).toBe(1);
    expect(s.verdict).toBe('YETERSIZ_ORNEK');
  });

  it('🔒 rotasyon sıfıra düştüğü işaretlenir (kanal tamamen sustu)', () => {
    resetExtendedTimeline();
    recordExtendedTimelineSample({ atMs: T0, watched: 11, demoted: 5, valued: 6, ageMsList: ages(6, 5000) });
    recordExtendedTimelineSample({ atMs: T0 + 4000, watched: 11, demoted: 11, valued: 6, ageMsList: ages(6, 9000) });
    const s = summarizeExtendedTimeline(readExtendedTimeline());
    expect(s.reachedZeroPollable, '11/11 elenmişken kanal sustu işareti yok').toBe(true);
  });

  it('🔒 her hükmün etiketi vardır (sessiz boşluk yok)', () => {
    for (const [k, v] of Object.entries(TIMELINE_VERDICT_LABEL)) {
      expect(v.length, `${k} etiketsiz`).toBeGreaterThan(0);
    }
  });

  it('🔒 özet SAF — aynı girdi aynı hüküm, girdi mutasyona uğramaz', () => {
    const rows = seq([[0, 20000], [2, 14000], [4, 9000], [6, 6000], [7, 5000], [9, 3000]]);
    const copy = JSON.stringify(rows);
    const a = summarizeExtendedTimeline(rows);
    const b = summarizeExtendedTimeline(rows);
    expect(JSON.stringify(rows)).toBe(copy);
    expect(a).toEqual(b);
  });
});
