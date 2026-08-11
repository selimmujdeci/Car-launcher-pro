/**
 * routeProjectionDeadReckoning.test.ts — DR projeksiyonu ROTA BOYUNCA (#451).
 *
 * ── KİLİTLENEN KUSUR ────────────────────────────────────────────────────────
 * GPS kaybolunca `navigationSessionRuntime._drTick` konum üretiyordu (bu kısım
 * çalışıyordu), ama `interpolation.projectDeadReckon` son heading doğrultusunda
 * **DÜZ ÇİZGİ** atıyor, rota geometrisini hiç kullanmıyordu.
 *
 * Yarıçapı R olan virajda, yol boyunca s metre gidildiğinde düz projeksiyonun
 * yanal sapması ≈ s²/(2R). Eşleştirme koridoru `CORRIDOR_BASE_M(55) +
 * min(doğruluk,40)` → 55–95 m. Yani DR, 60 sn'lik tavanına ULAŞAMADAN
 * koridordan çıkıyor → `OFF_NETWORK` → `STRAIGHT_LINE` → kalan mesafe artabiliyor.
 *
 * Aşağıdaki "R≈400 m" kilidi bunu SAYIYLA gösterir: aynı senaryoda heading
 * projeksiyonu koridoru aşar, rota-boyu projeksiyon geometriye bağlı kalır.
 *
 * ⚠️ Bu bir GEOMETRİ türetmesidir, saha ölçümü DEĞİLDİR.
 */

import { describe, it, expect } from 'vitest';
import { advanceAlongRoute } from '../platform/navigation/core/routeProjectionModel';
import { projectDeadReckon } from '../utils/interpolation';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const runtimeSrc = read('src/platform/navigation/navigationSessionRuntime.ts');
const modelSrc   = read('src/platform/navigation/core/routeProjectionModel.ts');

const M_PER_DEG = 111_320;
/** Eşleştirme koridorunun TABANI — `core/mapMatchModel.CORRIDOR_BASE_M`. */
const CORRIDOR_BASE_M = 55;

/** Metre → derece enlem (kısa mesafede yeterli). */
const mLat = (m: number) => m / M_PER_DEG;
/** Metre → derece boylam (verilen enlemde). */
const mLon = (m: number, atLat: number) =>
  m / (M_PER_DEG * Math.cos((atLat * Math.PI) / 180));

/** İki nokta arası mesafe (m) — modeldeki ile aynı düzlemsel yaklaşım. */
function distM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const cosLat = Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  const dLat = (bLat - aLat) * M_PER_DEG;
  const dLon = (bLon - aLon) * M_PER_DEG * cosLat;
  return Math.hypot(dLat, dLon);
}

/** Bir noktanın polyline'a en kısa (dik) mesafesi — yanal sapma ölçümü. */
function lateralToPolyline(
  lat: number, lon: number, geom: readonly (readonly [number, number])[],
): number {
  let best = Infinity;
  for (let i = 0; i < geom.length - 1; i++) {
    const [aLon, aLat] = geom[i];
    const [bLon, bLat] = geom[i + 1];
    const cosLat = Math.cos((aLat * Math.PI) / 180);
    const ax = 0, ay = 0;
    const bx = (bLon - aLon) * M_PER_DEG * cosLat, by = (bLat - aLat) * M_PER_DEG;
    const px = (lon - aLon) * M_PER_DEG * cosLat,  py = (lat - aLat) * M_PER_DEG;
    const len2 = bx * bx + by * by;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const d = Math.hypot(px - (ax + bx * t), py - (ay + by * t));
    if (d < best) best = d;
  }
  return best;
}

/** Kuzeye doğru düz rota, `stepM` aralıklı `count` nokta. */
function straightRoute(lat0: number, lon0: number, stepM: number, count: number) {
  const g: [number, number][] = [];
  for (let i = 0; i < count; i++) g.push([lon0, lat0 + mLat(stepM * i)]);
  return g;
}

/**
 * Yarıçapı R olan yay — başlangıçta KUZEYE bakar, sonra sağa kıvrılır.
 * `arcM` toplam yay uzunluğu, `stepM` nokta aralığı.
 */
function curvedRoute(lat0: number, lon0: number, R: number, arcM: number, stepM = 10) {
  const g: [number, number][] = [];
  for (let s = 0; s <= arcM; s += stepM) {
    const th = s / R;                       // yay açısı (rad)
    const north = R * Math.sin(th);         // ileri (kuzey) bileşen
    const east  = R * (1 - Math.cos(th));   // yana (doğu) kayma
    const lat = lat0 + mLat(north);
    g.push([lon0 + mLon(east, lat), lat]);
  }
  return g;
}

const LAT0 = 39.0, LON0 = 35.0;

describe('advanceAlongRoute — temel geometri', () => {
  it('DÜZ polyline: ilerletilen mesafe birebir', () => {
    const g = straightRoute(LAT0, LON0, 100, 5);      // 400 m düz
    const r = advanceAlongRoute(g, 0, LAT0, LON0, 250);
    expect(r).not.toBeNull();
    expect(r!.consumedM).toBeCloseTo(250, 0);
    expect(r!.exhausted).toBe(false);
    expect(distM(LAT0, LON0, r!.lat, r!.lon)).toBeCloseTo(250, 0);
  });

  it('SEGMENT SINIRINDA taşma: doğru segmente geçer', () => {
    const g = straightRoute(LAT0, LON0, 100, 5);
    const r = advanceAlongRoute(g, 0, LAT0, LON0, 150)!;
    expect(r.segIdx, 'segment sınırı geçilmemiş').toBe(1);
    expect(r.consumedM).toBeCloseTo(150, 0);
  });

  it('ÇOK SEGMENTLİ rota: her segment sırayla tüketilir', () => {
    const g = straightRoute(LAT0, LON0, 50, 21);      // 1000 m
    const r = advanceAlongRoute(g, 0, LAT0, LON0, 640)!;
    expect(r.consumedM).toBeCloseTo(640, 0);
    expect(r.segIdx).toBe(12);                        // 640 / 50 = 12.8
    expect(r.exhausted).toBe(false);
  });

  it('TEK VİRAJ: sonuç rota üzerinde KALIR (yanal sapma ≈ 0)', () => {
    const g = curvedRoute(LAT0, LON0, 400, 600);
    const r = advanceAlongRoute(g, 0, g[0][1], g[0][0], 500)!;
    expect(lateralToPolyline(r.lat, r.lon, g), 'rota-boyu projeksiyon rotadan sapmış')
      .toBeLessThan(1);
  });

  it('GEOMETRİ SONU: son noktada durur ve exhausted=true', () => {
    const g = straightRoute(LAT0, LON0, 100, 4);      // 300 m
    const r = advanceAlongRoute(g, 0, LAT0, LON0, 5_000)!;
    expect(r.exhausted, 'rota bittiği ilan edilmemiş').toBe(true);
    expect(r.consumedM, 'olmayan yol tüketilmiş sayılmış').toBeCloseTo(300, 0);
    expect(r.lat).toBeCloseTo(g[g.length - 1][1], 9);
    expect(r.lon).toBeCloseTo(g[g.length - 1][0], 9);
  });

  it('ROTA BİTTİKTEN SONRA daha da ilerlemez (idempotent duruş)', () => {
    const g = straightRoute(LAT0, LON0, 100, 4);
    const a = advanceAlongRoute(g, 0, LAT0, LON0, 5_000)!;
    const b = advanceAlongRoute(g, 0, LAT0, LON0, 50_000)!;
    expect(b.lat).toBeCloseTo(a.lat, 12);
    expect(b.lon).toBeCloseTo(a.lon, 12);
  });
});

describe('advanceAlongRoute — FAIL-CLOSED kapıları', () => {
  const g = straightRoute(LAT0, LON0, 100, 5);

  it('advanceM = 0 → çapa AYNEN korunur', () => {
    const r = advanceAlongRoute(g, 0, LAT0, LON0, 0)!;
    expect(r.lat).toBe(LAT0);
    expect(r.lon).toBe(LON0);
    expect(r.consumedM).toBe(0);
    expect(r.exhausted).toBe(false);
  });

  it('NEGATİF / bozuk mesafe → GERİYE ilerleme YOK', () => {
    for (const bad of [-1, -500, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = advanceAlongRoute(g, 0, LAT0, LON0, bad)!;
      expect(r, `${bad}: sonuç üretilmemiş`).not.toBeNull();
      expect(r.lat, `${bad}: geriye/ileriye kaymış`).toBe(LAT0);
      expect(r.consumedM).toBe(0);
    }
  });

  it('BOŞ / BOZUK geometri → null (çağıran heading fallback\'e düşer)', () => {
    expect(advanceAlongRoute(null, 0, LAT0, LON0, 100)).toBeNull();
    expect(advanceAlongRoute(undefined, 0, LAT0, LON0, 100)).toBeNull();
    expect(advanceAlongRoute([], 0, LAT0, LON0, 100)).toBeNull();
    expect(advanceAlongRoute([[LON0, LAT0]], 0, LAT0, LON0, 100)).toBeNull();
  });

  it('GEÇERSİZ çapa → null (rota UYDURULMAZ)', () => {
    expect(advanceAlongRoute(g, -1, LAT0, LON0, 100), 'negatif segment kabul edildi').toBeNull();
    expect(advanceAlongRoute(g, 99, LAT0, LON0, 100), 'aralık dışı segment kabul edildi').toBeNull();
    expect(advanceAlongRoute(g, g.length - 1, LAT0, LON0, 100), 'son nokta segment sayıldı').toBeNull();
    expect(advanceAlongRoute(g, Number.NaN, LAT0, LON0, 100)).toBeNull();
    expect(advanceAlongRoute(g, 0, Number.NaN, LON0, 100)).toBeNull();
    expect(advanceAlongRoute(g, 0, LAT0, Number.NaN, 100)).toBeNull();
  });

  it('GEOMETRİ ORTASINDA bozuk nokta → orada durur, ötesi uydurulmaz', () => {
    const broken = [
      [LON0, LAT0],
      [LON0, LAT0 + mLat(100)],
      [Number.NaN, Number.NaN],
      [LON0, LAT0 + mLat(300)],
    ] as unknown as [number, number][];
    const r = advanceAlongRoute(broken, 0, LAT0, LON0, 1_000)!;
    expect(r.exhausted).toBe(true);
    expect(r.consumedM).toBeCloseTo(100, 0);
  });

  it('TEKRARLANAN nokta (sıfır uzunlukta segment) sonsuz döngü YAPMAZ', () => {
    const dup: [number, number][] = [
      [LON0, LAT0], [LON0, LAT0], [LON0, LAT0],
      [LON0, LAT0 + mLat(100)],
    ];
    const r = advanceAlongRoute(dup, 0, LAT0, LON0, 60)!;
    expect(r.consumedM).toBeCloseTo(60, 0);
  });

  it('İLERLEME MONOTONDUR: daha büyük mesafe asla geri götürmez', () => {
    const curve = curvedRoute(LAT0, LON0, 400, 800);
    let prev = 0;
    for (const m of [0, 50, 120, 300, 500, 780]) {
      const r = advanceAlongRoute(curve, 0, curve[0][1], curve[0][0], m)!;
      expect(r.consumedM).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = r.consumedM;
    }
  });
});

describe('🔒 R≈400 m VİRAJ — heading projeksiyonu koridordan ÇIKAR, rota-boyu ÇIKMAZ', () => {
  const R = 400;
  const SPEED_KMH = 90;
  const g = curvedRoute(LAT0, LON0, R, 1_800);   // 60 sn × 25 m/s = 1500 m'yi kapsar

  /** Yayın başında rota KUZEYE bakar → heading = 0°. */
  const HEADING_DEG = 0;

  it('KUSUR KANITI: heading projeksiyonu 60 sn\'den ÇOK ÖNCE koridoru aşar', () => {
    const vMs = SPEED_KMH / 3.6;
    let firstBreachSec: number | null = null;
    for (let t = 1; t <= 60; t++) {
      const p = projectDeadReckon(
        { lat: g[0][1], lng: g[0][0], heading: HEADING_DEG, ts: 0 },
        SPEED_KMH, t * 1000,
      );
      if (lateralToPolyline(p.lat, p.lng, g) > CORRIDOR_BASE_M) { firstBreachSec = t; break; }
    }
    expect(firstBreachSec, 'kusur yokmuş gibi görünüyor — kilit anlamsız').not.toBeNull();
    // s²/(2R) = 55 → s ≈ 210 m → 90 km/h'de ≈ 8,4 sn.
    expect(firstBreachSec as number).toBeLessThan(15);
    expect((firstBreachSec as number) * vMs, 'çıkış yolu türetmeden uzak').toBeGreaterThan(150);
  });

  it('DÜZELTME: rota-boyu projeksiyon 60 sn boyunca koridorda KALIR', () => {
    for (let t = 1; t <= 60; t++) {
      const advanceM = (SPEED_KMH / 3.6) * t;
      const r = advanceAlongRoute(g, 0, g[0][1], g[0][0], advanceM);
      expect(r, `${t}. sn: projeksiyon üretilemedi`).not.toBeNull();
      expect(lateralToPolyline(r!.lat, r!.lon, g), `${t}. sn: rotadan sapma`)
        .toBeLessThan(1);
    }
  });

  it('60 sn TAVANI: ilerleme mevcut DR_MAX_DT_SEC bütçesini aşmaz', () => {
    // Runtime `min(ageSec, DR_MAX_DT_SEC)` uygular; model bütçeyi olduğu gibi tüketir.
    const maxAdvance = (SPEED_KMH / 3.6) * 60;      // 1500 m
    const r = advanceAlongRoute(g, 0, g[0][1], g[0][0], maxAdvance)!;
    expect(r.consumedM).toBeLessThanOrEqual(maxAdvance + 1);
    expect(r.exhausted, '1800 m\'lik rotada 1500 m sonra rota bitmiş sayılmış').toBe(false);
  });
});

describe('🔒 YAPISAL — çağıran sözleşmesi bozulmadı', () => {
  it('updateRouteProgress ÇAĞRI SAYISI değişmedi (tek çağrı, DR yolunda)', () => {
    const calls = runtimeSrc.match(/updateRouteProgress\(/g) ?? [];
    expect(calls.length, `updateRouteProgress çağrı sayısı: ${calls.length}`).toBe(2);
  });

  it('allowReroute:false KORUNDU', () => {
    expect(runtimeSrc).toContain('updateRouteProgress(lat, lng, { allowReroute: false })');
  });

  it('accuracyM:null ve matched:false KORUNDU (DR bir ÖLÇÜM değil)', () => {
    expect(runtimeSrc).toContain('accuracyM: null');
    expect(runtimeSrc).toContain('matched: false');
  });

  it('hız kanıtı kapısı KORUNDU (< 1 km/h → ilerleme yok)', () => {
    expect(runtimeSrc).toMatch(/if \(!\(speedKmh >= 1\)\) \{ _setDrState\('DR_EXPIRED'\); return; \}/);
  });

  it('60 sn tavanı KORUNDU', () => {
    expect(runtimeSrc).toContain('Math.min(ageSec, DR_MAX_DT_SEC)');
  });

  it('HEADING FALLBACK korundu — rota çapası yoksa eski davranış', () => {
    expect(runtimeSrc).toContain('projectDeadReckon(');
    expect(runtimeSrc).toContain("_drProjectionMode = 'HEADING_FALLBACK'");
  });

  it('İKİNCİ DR SAHİBİ doğmadı — timer tek yerde', () => {
    const timers = runtimeSrc.match(/setInterval\(/g) ?? [];
    expect(timers.length, 'ikinci DR zamanlayıcısı eklenmiş').toBe(1);
  });

  it('ODOMETREYE yazım YOK', () => {
    expect(runtimeSrc).not.toMatch(/odo|Odometer|odometer/);
    expect(modelSrc).not.toMatch(/odo|Odometer|odometer/);
  });

  it('SAF MODEL hiçbir şey import etmez (I/O · timer · harita yok)', () => {
    /* Kilit YORUMLARA değil KODA bakar: bu adların gerekçe metninde geçmesi
       normaldir ("`Date.now` YOK" cümlesi gibi). Metin araması yanlış alarm
       verir — bu tur içinde iki kez verdi. */
    const code = modelSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')   // blok yorumlar
      .replace(/\/\/.*$/gm, '');          // satır yorumları
    expect(code, 'saf model dışarıya bağımlı hâle gelmiş').not.toMatch(/^\s*import\s/m);
    expect(code, 'saf modele I/O · timer · saat girmiş')
      .not.toMatch(/addEventListener|setInterval|setTimeout|requestAnimationFrame|Date\.now\(|performance\.now\(/);
  });

  it('ÇAPA yalnız DR\'ye girerken alınır (çift mesafe uygulaması olmaz)', () => {
    // Her tick okunsaydı çapa kendi projeksiyonumuzla kayar, mesafe iki kez uygulanırdı.
    expect(runtimeSrc).toContain('if (_drAnchor === null) {');
    expect(runtimeSrc).toContain('_clearDrProjection();');
  });
});
