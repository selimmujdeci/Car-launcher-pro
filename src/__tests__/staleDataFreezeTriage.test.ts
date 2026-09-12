/**
 * staleDataFreezeTriage — "donma körlüğü" regresyon kilidi.
 *
 * SAHA BULGUSU (2026-07-15, Redmi tier:low): Tanı raporu "OBD %100 sağlıklı" +
 * "self-test fail" diyordu; oysa cihazda göstergeler ~5s'de bir güncelleniyor (donuk)
 * ve harita takılıyordu. Kök: rapor DONMAYI göremiyordu —
 *   (1) connectionQuality ~9s'ye kadar bayatlığa sıfır ceza (STALE_GRACE_FACTOR),
 *   (2) perfSeries düşük-tier'da FPS'i hiç ölçmüyor → render donması görünmez.
 *
 * Bu kilitler iki yeni triyaj kuralını korur:
 *   • OBD_DATA_STALE   — bağlı ama veri donuk (isStale / lastPacketAgeMs)
 *   • MAIN_THREAD_STALL — longtask ile ana-thread bloklaması (harita+gösterge takılması)
 * ve ObdHealthMonitor.isStale mutlak eşiğini.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTriageSnapshot, type TriageSections } from '../platform/diagnosticTriage';
import { obdHealthMonitor } from '../platform/obd/ObdHealthMonitor';

const connectedAdapter = { source: 'real', connectionState: 'connected', lastSeenMs: 1 };

describe('OBD_DATA_STALE — bağlı ama donuk veri', () => {
  it('bağlı + isStale=true → OBD_DATA_STALE bulgusu üretir', () => {
    const sections: TriageSections = {
      obdDeep: { adapter: connectedAdapter, health: { connectionQuality: 100, lastPacketAgeMs: 5302, isStale: true } },
    };
    const snap = buildTriageSnapshot(sections);
    expect(snap.findings.some((f) => f.code === 'OBD_DATA_STALE')).toBe(true);
  });

  it('isStale yoksa ham lastPacketAgeMs eşikten türetir (geriye-uyum)', () => {
    const sections: TriageSections = {
      obdDeep: { adapter: connectedAdapter, health: { connectionQuality: 100, lastPacketAgeMs: 6000 } },
    };
    const snap = buildTriageSnapshot(sections);
    expect(snap.findings.some((f) => f.code === 'OBD_DATA_STALE')).toBe(true);
  });

  it('taze veri (küçük yaş) → bulgu YOK (sahte alarm yasak)', () => {
    const sections: TriageSections = {
      obdDeep: { adapter: connectedAdapter, health: { connectionQuality: 100, lastPacketAgeMs: 800, isStale: false } },
    };
    const snap = buildTriageSnapshot(sections);
    expect(snap.findings.some((f) => f.code === 'OBD_DATA_STALE')).toBe(false);
  });

  it('bağlı DEĞİLKEN donma bulgusu üretmez (kopma başka kuralın işi)', () => {
    const sections: TriageSections = {
      obdDeep: {
        adapter: { source: 'none', connectionState: 'idle', lastSeenMs: 0 },
        health: { connectionQuality: -1, lastPacketAgeMs: 99999, isStale: true },
      },
    };
    const snap = buildTriageSnapshot(sections);
    expect(snap.findings.some((f) => f.code === 'OBD_DATA_STALE')).toBe(false);
  });
});

describe('MAIN_THREAD_STALL — longtask ile render donması', () => {
  it('uzun görev (>500ms) → MAIN_THREAD_STALL bulgusu (harita+gösterge takılması)', () => {
    const sections: TriageSections = {
      perfSeries: { installed: true, samples: [
        { ts: 1, tempC: 40, level: 0, memMb: 50, fps: -1, lagMs: 3, maxLongTaskMs: 40, longTaskCount: 1 },
        { ts: 2, tempC: 42, level: 0, memMb: 51, fps: -1, lagMs: 4, maxLongTaskMs: 1200, longTaskCount: 3 },
      ] },
    };
    const snap = buildTriageSnapshot(sections);
    expect(snap.findings.some((f) => f.code === 'MAIN_THREAD_STALL')).toBe(true);
  });

  it('longtask API yok (-1) → sessiz, sahte bulgu YOK', () => {
    const sections: TriageSections = {
      perfSeries: { installed: true, samples: [
        { ts: 1, tempC: 40, level: 0, memMb: 50, fps: -1, lagMs: 3, maxLongTaskMs: -1, longTaskCount: 0 },
      ] },
    };
    const snap = buildTriageSnapshot(sections);
    expect(snap.findings.some((f) => f.code === 'MAIN_THREAD_STALL')).toBe(false);
  });

  it('kısa görevler (≤500ms) → donma bulgusu YOK', () => {
    const sections: TriageSections = {
      perfSeries: { installed: true, samples: [
        { ts: 1, tempC: 40, level: 0, memMb: 50, fps: -1, lagMs: 3, maxLongTaskMs: 120, longTaskCount: 2 },
      ] },
    };
    const snap = buildTriageSnapshot(sections);
    expect(snap.findings.some((f) => f.code === 'MAIN_THREAD_STALL')).toBe(false);
  });
});

describe('ObdHealthMonitor.isStale — mutlak donma eşiği', () => {
  beforeEach(() => obdHealthMonitor.reset());

  it('paket >4s öncesindeyse isStale=true (kalite %100 olsa bile)', () => {
    obdHealthMonitor.noteConnected(0);
    obdHealthMonitor.setExpectedIntervalMs(3_000);   // grace 9s → kalite cezası YOK
    obdHealthMonitor.notePacketAccepted(0);
    const snap = obdHealthMonitor.snapshot(5_302);   // 5.3s sonra
    expect(snap.isStale).toBe(true);                 // donma yakalanır
    expect(snap.connectionQuality).toBe(100);        // kalite hâlâ 100 (ayrı kavram)
  });

  it('taze paket → isStale=false', () => {
    obdHealthMonitor.noteConnected(0);
    obdHealthMonitor.notePacketAccepted(0);
    expect(obdHealthMonitor.snapshot(800).isStale).toBe(false);
  });

  it('hiç paket gelmediyse isStale=false ("bekliyor", "donuk" değil)', () => {
    obdHealthMonitor.noteConnected(0);
    expect(obdHealthMonitor.snapshot(10_000).isStale).toBe(false);
  });
});
