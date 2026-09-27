/**
 * miniMapDrivingFollow — saha 2026-09-27 (kullanıcı: "mini haritada yolda
 * giderken konum geride kalıyor, görünmüyor"; ekranda hız "— KM/H").
 *
 * GPS hız bildirmeyen cihazda sürüş kararı yalnız yer değiştirmeden gelir.
 * Eski kural çapayı her fix'te sıfırladığı için kapının (doğruluk, taban 8 m)
 * altındaki her adım "0 km/h" sayılıyor, sürüş görünümü kapanıyordu.
 */
import { describe, it, expect } from 'vitest';
import { _haversineMeters } from '../platform/gps/gpsMath';
import { classifyMiniMapMotion, MINIMAP_STOP_CONFIRM_SEC } from '../components/map/miniMapDrivingModel';

const LAT0 = 36.9, LON0 = 34.86;
/** Kuzeye `kmh` hızla, `hz` fix/s, `sec` saniye sürüş; GPS hızı 0 bildirilir. */
function fixes(kmh: number, hz: number, sec: number, startSec = 0, startM = 0) {
  const out: Array<{ t: number; lat: number; lon: number }> = [];
  for (let i = 1; i <= sec * hz; i++) {
    const t = startSec + i / hz;
    const m = startM + (kmh / 3.6) * (i / hz);
    out.push({ t, lat: LAT0 + m / 111_320, lon: LON0 });
  }
  return out;
}

/** MiniMapWidget'in çapa/durum döngüsünü aynı kurallarla sürer. */
function drive(samples: Array<{ t: number; lat: number; lon: number }>, accuracyM: number, useNew = true) {
  let anchor = { t: 0, lat: LAT0, lon: LON0 };
  let wasDriving = true;       // araç zaten sürüşte
  let lastEff = 40;
  const states: boolean[] = [];
  for (const f of samples) {
    const movedM = _haversineMeters(anchor.lat, anchor.lon, f.lat, f.lon);
    const dtSec = f.t - anchor.t;
    if (useNew) {
      const r = classifyMiniMapMotion({ gpsSpeedKmh: 0, movedM, accuracyM, dtSec, wasDriving, lastEffKmh: lastEff });
      wasDriving = r.isDriving; lastEff = r.effKmh;
      if (r.isDriving && r.advanceAnchor) anchor = f;
    } else {
      // ESKİ kural (kusurlu): çapa her sürüş fix'inde sıfırlanır, "kanıt yok" = 0 km/h.
      const gate = Math.max(accuracyM, 8);
      const disp = dtSec > 0.15 && dtSec < 30 && movedM > gate ? (movedM / dtSec) * 3.6 : 0;
      wasDriving = disp > 5 ? true : disp < 3 ? false : wasDriving;
      if (wasDriving) anchor = f;
    }
    states.push(wasDriving);
  }
  return states;
}

describe('mini harita — GPS hız bildirmezken sürüş takibi', () => {
  it('KÖK NEDEN kanıtı: eski kural 5 Hz / 50 km/h sürüşte görünümü kapatıyordu', () => {
    const old = drive(fixes(50, 5, 10), 4, false);
    expect(old.filter((d) => !d).length).toBeGreaterThan(0);
  });

  it.each([
    ['5 Hz · 50 km/h · doğruluk 4 m', 50, 5, 4],
    ['1 Hz · 40 km/h · doğruluk 15 m', 40, 1, 15],
    ['1 Hz · 30 km/h · doğruluk 4 m', 30, 1, 4],
    ['2 Hz · 90 km/h · doğruluk 25 m', 90, 2, 25],
  ])('%s: sürüş görünümü HİÇ kapanmaz', (_n, kmh, hz, acc) => {
    const states = drive(fixes(kmh as number, hz as number, 20), acc as number);
    expect(states.every(Boolean)).toBe(true);
  });

  it('gerçekten durunca en geç STOP_CONFIRM_SEC içinde sürüş biter', () => {
    const go = fixes(40, 1, 10);
    const last = go[go.length - 1]!;
    const stopped = Array.from({ length: 10 }, (_, i) => ({ t: last.t + i + 1, lat: last.lat, lon: last.lon }));
    const states = drive([...go, ...stopped], 4);
    const firstStop = states.indexOf(false);
    expect(firstStop).toBeGreaterThan(go.length - 1);
    expect(firstStop - go.length + 1).toBeLessThanOrEqual(MINIMAP_STOP_CONFIRM_SEC + 1);
  });

  it('🔒 #618: DURAN araçta sürüklenme sürüş AÇMAZ (tutma yalnız zaten sürüşteyse)', () => {
    const r = classifyMiniMapMotion({ gpsSpeedKmh: 0, movedM: 4.7, accuracyM: 4.2, dtSec: 2, wasDriving: false, lastEffKmh: 0 });
    expect(r.isDriving).toBe(false);
    expect(r.effKmh).toBe(0);
  });

  it('tutulan sürüşte kameraya 0 km/h verilmez; son ölçülen hız taşınır', () => {
    const r = classifyMiniMapMotion({ gpsSpeedKmh: 0, movedM: 3, accuracyM: 4, dtSec: 0.4, wasDriving: true, lastEffKmh: 48 });
    expect(r.isDriving).toBe(true);
    expect(r.effKmh).toBe(48);
    expect(r.advanceAnchor).toBe(false);
  });
});
