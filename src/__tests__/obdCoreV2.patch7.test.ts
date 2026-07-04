/**
 * obdCoreV2.patch7.test.ts — Patch 7 (ObdHealthMonitor)
 *
 * Saf skor motoru kilitleri — monotonik saat enjekte edilir (performance.now yok):
 *  - connectionQuality: bağlantı yokken -1; sağlıklı akışta 100; reconnect cezası;
 *    cezanın yarı-ömürle sönmesi; poll periyoduna GÖRELİ bayatlık cezası.
 *  - sensorReliability: hiç veri görmemiş alan raporlanmaz; kabul/red oranı;
 *    eski hataların yarı-ömürle affedilmesi.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { obdHealthMonitor } from '../platform/obd/ObdHealthMonitor';

const T0 = 1_000_000; // monotonik başlangıç (değerin kendisi önemsiz)

beforeEach(() => obdHealthMonitor.reset());

describe('Patch 7 — connectionQuality', () => {
  it('bağlantı hiç kurulmadıysa -1', () => {
    expect(obdHealthMonitor.snapshot(T0).connectionQuality).toBe(-1);
  });

  it('taze veri akışında 100', () => {
    obdHealthMonitor.noteConnected(T0);
    obdHealthMonitor.notePacketAccepted(T0 + 1_000);
    expect(obdHealthMonitor.snapshot(T0 + 1_500).connectionQuality).toBe(100);
  });

  it('her reconnect kaliteyi düşürür, baskı yarı-ömürle söner', () => {
    obdHealthMonitor.noteConnected(T0);
    obdHealthMonitor.notePacketAccepted(T0);
    obdHealthMonitor.noteReconnect(T0);
    obdHealthMonitor.notePacketAccepted(T0 + 1_000); // yeniden bağlandı, veri taze
    const qFresh = obdHealthMonitor.snapshot(T0 + 1_000).connectionQuality;
    expect(qFresh).toBe(75); // 100 - 25×1

    // 2 dk (yarı-ömür) sonra baskı yarıya iner → 100 - 12.5 ≈ 88
    obdHealthMonitor.notePacketAccepted(T0 + 121_000);
    const qLater = obdHealthMonitor.snapshot(T0 + 121_000).connectionQuality;
    expect(qLater).toBeGreaterThan(qFresh);
    expect(qLater).toBe(Math.round(100 - 12.5));
  });

  it('bayatlık cezası AKTİF poll periyoduna görelidir', () => {
    obdHealthMonitor.noteConnected(T0);
    obdHealthMonitor.setExpectedIntervalMs(250); // hızlı profil (high tier)
    obdHealthMonitor.notePacketAccepted(T0);
    // 250ms profilde 3s sessizlik = 12× periyot → tavan ceza bandında
    expect(obdHealthMonitor.snapshot(T0 + 3_000).connectionQuality).toBe(50);

    obdHealthMonitor.reset();
    obdHealthMonitor.noteConnected(T0);
    obdHealthMonitor.setExpectedIntervalMs(15_000); // weak head unit modu
    obdHealthMonitor.notePacketAccepted(T0);
    // Aynı 3s sessizlik weak modda tamamen normal → ceza yok
    expect(obdHealthMonitor.snapshot(T0 + 3_000).connectionQuality).toBe(100);
  });

  it('grace bandı içinde (≤3× periyot) ceza yok', () => {
    obdHealthMonitor.noteConnected(T0);
    obdHealthMonitor.setExpectedIntervalMs(1_000);
    obdHealthMonitor.notePacketAccepted(T0);
    expect(obdHealthMonitor.snapshot(T0 + 3_000).connectionQuality).toBe(100);
    expect(obdHealthMonitor.snapshot(T0 + 6_500).connectionQuality).toBeLessThan(100);
  });
});

describe('Patch 7 — sensorReliability', () => {
  it('hiç veri görmemiş alan haritada yok', () => {
    obdHealthMonitor.noteConnected(T0);
    const snap = obdHealthMonitor.snapshot(T0);
    expect(snap.sensorReliability.rpm).toBeUndefined();
    expect(snap.sensorReliability.voltage).toBeUndefined();
  });

  it('kabul/red oranını yansıtır', () => {
    for (let i = 0; i < 8; i++) obdHealthMonitor.noteField('rpm', true, T0 + i);
    for (let i = 0; i < 2; i++) obdHealthMonitor.noteField('rpm', false, T0 + 10 + i);
    expect(obdHealthMonitor.snapshot(T0 + 20).sensorReliability.rpm).toBe(80);
  });

  it('tamamen sağlıklı alan 100, tamamen bozuk alan 0', () => {
    obdHealthMonitor.noteField('speed', true, T0);
    obdHealthMonitor.noteField('voltage', false, T0);
    const snap = obdHealthMonitor.snapshot(T0 + 1);
    expect(snap.sensorReliability.speed).toBe(100);
    expect(snap.sensorReliability.voltage).toBe(0);
  });

  it('eski redler yarı-ömürle affedilir (skor zamanla iyileşir)', () => {
    // Başta 5 red → skor 0
    for (let i = 0; i < 5; i++) obdHealthMonitor.noteField('engineTemp', false, T0 + i);
    expect(obdHealthMonitor.snapshot(T0 + 10).sensorReliability.engineTemp).toBe(0);
    // 5 dk sonra (redler yarı ağırlıkta) 5 yeni kabul → skor > %50
    for (let i = 0; i < 5; i++) obdHealthMonitor.noteField('engineTemp', true, T0 + 300_000 + i);
    const score = obdHealthMonitor.snapshot(T0 + 300_010).sensorReliability.engineTemp!;
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });
});

describe('Patch 7 — lastPacketAgeMs', () => {
  it('hiç paket yoksa -1, sonra yaşı doğru raporlar', () => {
    expect(obdHealthMonitor.snapshot(T0).lastPacketAgeMs).toBe(-1);
    obdHealthMonitor.notePacketAccepted(T0);
    expect(obdHealthMonitor.snapshot(T0 + 4_200).lastPacketAgeMs).toBe(4_200);
  });
});
