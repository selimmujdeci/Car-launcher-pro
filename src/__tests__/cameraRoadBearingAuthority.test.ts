/**
 * KAMERA YÖN OTORİTESİ — yol geometrisi > ham GPS heading.
 *
 * SAHA KÖKÜ (2026-08-08, Siverek — 288 örnek, 1 Hz kayıt):
 *   |Δyön|/s  p50 2,5° · p90 **15,9°** · p99 38,6° · max 55,7°
 *   Araç DURURKEN (<3 km/s): p50 3,4° · p90 12,3° · **max 18,0°**
 *   Ardışık örneklerin **%5**'i işaret değiştiriyor → gerçek dönüş değil SALINIM.
 * Kullanıcı tarifi: *"bir dönüyor bir öyle dönüyor, geriye doğru gidecekmiş
 * hissi veriyor."* Kamera bu gürültüyü kovaladığı için harita duramıyordu.
 *
 * DÜZELTME: rotaya güvenle oturmuşken kamera yönü, aracın üzerinde olduğu ROTA
 * SEGMENTİNDEN alınır (geometri titremez). Oturtma güvenilmezse ham heading'e
 * düşülür — rota dışı davranış BİREBİR korunur.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { _snapForTest } from '../platform/navigationService';
import { segmentBearingDeg, angularDeltaDeg } from '../platform/navigation/core/geo';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
/** Yorumları soyar — kilitler YORUMU değil KODU denetlemeli. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '')
   .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/* Siverek Ofis Parkı rotasından türetilmiş sade geometri: önce TAM KUZEY
   (bearing 0°), sonra TAM DOĞU (bearing 90°) giden iki segment. */
const GEOM: [number, number][] = [
  [39.3265, 37.7600],   // A  [lon, lat]
  [39.3265, 37.7620],   // B  — A'dan kuzeye
  [39.3300, 37.7620],   // C  — B'den doğuya
];

describe('yol yönü — snap hesabından türer', () => {
  it('kuzeye giden segmentte yön ≈ 0°', () => {
    const r = _snapForTest(37.7610, 39.3265, GEOM);
    expect(r.roadBearing).not.toBeNull();
    expect(r.roadBearing as number).toBeCloseTo(0, 0);
  });

  it('doğuya giden segmentte yön ≈ 90°', () => {
    const r = _snapForTest(37.7620, 39.3280, GEOM);
    expect(r.roadBearing).not.toBeNull();
    expect(r.roadBearing as number).toBeCloseTo(90, 0);
  });

  it('GÜRÜLTÜ BAĞIŞIKLIĞI: araç aynı segmentte oynasa da yön DEĞİŞMEZ', () => {
    /* Ölçülen kusurun özü buydu: GPS heading'i ±16°/s zıplarken yol yönü
       sabit kalmalı. Aynı segment üzerinde üç farklı konum → tek yön. */
    const a = _snapForTest(37.7605, 39.32650, GEOM).roadBearing;
    const b = _snapForTest(37.7610, 39.32652, GEOM).roadBearing;  // ~2 m yanal gürültü
    const c = _snapForTest(37.7615, 39.32648, GEOM).roadBearing;
    expect(a).not.toBeNull();
    expect(b).toBeCloseTo(a as number, 5);
    expect(c).toBeCloseTo(a as number, 5);
  });

  it('segment değişince yön GERÇEKTEN döner (donmuş değer değil)', () => {
    const kuzey = _snapForTest(37.7610, 39.3265, GEOM).roadBearing as number;
    const dogu  = _snapForTest(37.7620, 39.3290, GEOM).roadBearing as number;
    expect(Math.abs(dogu - kuzey)).toBeGreaterThan(60);
  });

  it('rota dışına çıkınca sapma mesafesi büyür — güven kapısı bunu okur', () => {
    const yakin = _snapForTest(37.7610, 39.3265, GEOM).offRouteM;
    const uzak  = _snapForTest(37.7610, 39.3400, GEOM).offRouteM;
    expect(uzak).toBeGreaterThan(yakin);
    expect(uzak).toBeGreaterThan(100);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * İLERİ BAKIŞ PENCERESİ — 2026-08-13 saha ölçümünün DAVRANIŞ kilidi
 *
 * 2026-08-08 düzeltmesi GPS gürültüsünü kesti ama gürültüyü BİTİRMEDİ, yer
 * değiştirdi: rota geometrisinin kendi düğümleri kavşakta sıklaşıyor
 * (Siverek rotasında segmentlerin %23'ü <5 m) ve araç ilerledikçe en-yakın
 * segment indeksi bu kısa parçalar arasında atlıyor. Ölçülen en büyük TEK
 * darbe: şehir içi 91,5°, şehir dışı 118,7°.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('🔒 ileri bakış penceresi — kısa segment gürültüsü kameraya GEÇMEZ', () => {
  /** Doğuya giden DÜZ yol; düğümler 4 m aralıklı ve ±1,5 m yanal gürültülü.
   *  Ölçülen gerçek geometrinin (kavşak çevresi) sadeleştirilmiş eşdeğeri.
   *  Deterministik — `Math.random` YOK. */
  const NOISY: [number, number][] = (() => {
    const out: [number, number][] = [];
    const lat0 = 37.7600, lon0 = 39.3200;
    const mPerDegLat = 111_320;
    const mPerDegLon = 111_320 * Math.cos(lat0 * Math.PI / 180);
    for (let i = 0; i < 40; i++) {
      const along = i * 4;                       // 4 m aralık
      const lateral = (i % 2 === 0 ? 1.5 : -1.5); // ±1,5 m testere dişi
      out.push([lon0 + along / mPerDegLon, lat0 + lateral / mPerDegLat]);
    }
    return out;
  })();

  /** Araç rota boyunca ilerlerken kameranın gördüğü ardışık yön farkları.
   *  `stopBefore`: rotanın son N köşesi ölçüme alınmaz. */
  function jumps(geom: [number, number][], stopBefore = 0): number[] {
    const seen: number[] = [];
    for (let i = 0; i < geom.length - 1 - stopBefore; i++) {
      const [lo, la] = geom[i];
      const [lo2, la2] = geom[i + 1];
      const r = _snapForTest(la + (la2 - la) * 0.5, lo + (lo2 - lo) * 0.5, geom);
      if (r.roadBearing !== null) seen.push(r.roadBearing);
    }
    const d: number[] = [];
    for (let i = 0; i < seen.length - 1; i++) {
      const raw = Math.abs(((seen[i + 1] - seen[i]) % 360 + 360) % 360);
      d.push(raw > 180 ? 360 - raw : raw);
    }
    return d;
  }

  it('rota GÖVDESİNDE kamera yönü neredeyse hiç oynamaz (max darbe < 8°)', () => {
    /* Tek segmentin yönü alınsaydı bu geometride darbe ~74° olurdu
       (atan(3/4) × 2 — aşağıdaki KONTROL testi bunu ölçüyor).
       Son 40 m (10 köşe) hariç: orada pencere kısalır, ayrı kilit var. */
    const d = jumps(NOISY, 10);
    expect(d.length).toBeGreaterThan(10);
    expect(Math.max(...d)).toBeLessThan(8);
  });

  it('rota SONUNDA pencere kısalır — ama yine de tek segmentten ÇOK daha sakin', () => {
    /* DÜRÜSTLÜK: son 40 m'de ileriye bakacak yol kalmadığı için pencere
       daralır ve gürültü kısmen geri gelir (ölçülen ~23°). Bu kaçınılmazdır
       ve gizlenmiyor — ama tek segmentin ~74°'sinin hâlâ çok altındadır.
       Varışa 40 m kala kamera stabilitesi zaten en az kritik andır. */
    const d = jumps(NOISY);
    expect(Math.max(...d)).toBeLessThan(30);
  });

  it('KONTROL: aynı geometride TEK SEGMENT yönü gerçekten çok gürültülü', () => {
    /* Bu test, yukarıdaki kilidin kendini kandırmadığını kanıtlar: gürültü
       fikstürde GERÇEKTEN var. Yoksa "sakin" sonucu anlamsız olurdu. */
    const segBears: number[] = [];
    for (let i = 0; i < NOISY.length - 1; i++) {
      segBears.push(segmentBearingDeg(NOISY[i][1], NOISY[i][0], NOISY[i + 1][1], NOISY[i + 1][0]));
    }
    let worst = 0;
    for (let i = 0; i < segBears.length - 1; i++) {
      worst = Math.max(worst, angularDeltaDeg(segBears[i], segBears[i + 1]));
    }
    expect(worst).toBeGreaterThan(50);
  });

  it('DÜZ yolda pencere GECİKME EKLEMEZ — yön hâlâ doğru', () => {
    /* Ölçümde düz yolda medyan fark ~0,1° çıkmıştı; pencere yönü kaydırmamalı. */
    const clean: [number, number][] = [
      [39.3200, 37.7600], [39.3220, 37.7600], [39.3240, 37.7600], [39.3260, 37.7600],
    ];
    const r = _snapForTest(37.7600, 39.3210, clean);
    expect(r.roadBearing as number).toBeCloseTo(90, 0);
  });

  it('rota SONUNDA yön kaybolmaz (pencere taşsa da fallback var)', () => {
    const short: [number, number][] = [[39.3200, 37.7600], [39.3202, 37.7600]]; // ~18 m
    const r = _snapForTest(37.7600, 39.3201, short);
    expect(r.roadBearing).not.toBeNull();
    expect(r.roadBearing as number).toBeCloseTo(90, 0);
  });
});

describe('🔒 otorite sözleşmesi — ikinci sahip YOK', () => {
  const navSrc = code(read('src/platform/navigationService.ts'));

  it('🔒 yol yönü, işaretçi ile AYNI güven kapısını kullanır', () => {
    // İkisi de: ACTIVE/REROUTING + SNAP_VISUAL_THRESHOLD_M.
    // Ayrışırlarsa ürün yine "işaretçi burada ama kamera başka yöne" der.
    expect(navSrc).toMatch(
      /export function getSnappedRoadBearing[\s\S]{0,600}SNAP_VISUAL_THRESHOLD_M/,
    );
    expect(navSrc).toMatch(
      /export function getSnappedRoadBearing[\s\S]{0,600}NavStatus\.REROUTING/,
    );
  });

  it('🔒 yön, snap ile AYNI hesaptan doğar — ikinci tarama YOK', () => {
    /* Kilit KALDIRILMADI, yeni doğru davranışa GÜNCELLENDİ (2026-08-13):
       yön artık tek segmentin değil, 40 m ileriye bakan pencerenin yönüdür
       (ölçüm: tek segment max darbe 91,5° → pencere ~25°). Korunan invaryant
       AYNI: değer, snap'in ZATEN bulduğu `closestSegIdx` + `t` üzerinden
       doğar — yeni bir EN YAKIN SEGMENT ARAMASI yapılmaz. */
    expect(navSrc).toMatch(
      /_lastSnappedSegBearing\s*=\s*roadBearingAheadDeg\(geometry, closestSegIdx, t, CAMERA_ROAD_BEARING_LOOKAHEAD_M\)/,
    );
    // İkinci tarama yasağı: pencere hesabı yalnız ileri yürür.
    const geoSrc = code(read('src/platform/navigation/core/geo.ts'));
    expect(geoSrc).toMatch(/export function roadBearingAheadDeg/);
    expect(geoSrc).not.toMatch(/roadBearingAheadDeg[\s\S]{0,1400}pointToSegmentDist/);
  });

  it('🔒 pencere hesaplanamazsa TEK SEGMENT yönüne düşer (sessiz null YOK)', () => {
    // Rota sonu / dejenere geometride yön kaybolmamalı; eski davranış fallback.
    expect(navSrc).toMatch(
      /_lastSnappedSegBearing[\s\S]{0,240}\?\?\s*bearingBetween\(aLat, aLon, bLat, bLon\)/,
    );
  });

  it('🔒 rota temizlenince yön de temizlenir (bayat yön kalmaz)', () => {
    expect(navSrc).toMatch(/_lastSnappedSegBearing\s*=\s*null/);
  });
});

describe('🔒 kamera bu kaynağı GERÇEKTEN kullanır', () => {
  const viewSrc = code(read('src/components/map/FullMapView.tsx'));

  it('🔒 kamera çağrısı ham `bear` DEĞİL `_camBear` alır', () => {
    expect(viewSrc).toMatch(/setDrivingView\(mapRef\.current, displayLat, displayLng, _camBear,/);
  });

  it('🔒 fallback korunur: oturtma yoksa ham heading kullanılır', () => {
    expect(viewSrc).toContain('const _camBear  = _roadBear ?? bear;');
  });

  it('🔒 yön yalnız snap geçerliyken istenir (rota dışında sorulmaz)', () => {
    expect(viewSrc).toContain('const _roadBear = _snap ? getSnappedRoadBearing() : null;');
  });

  it('🔒 değişim tespiti de aynı yönü ölçer (yoksa kamera hiç güncellenmez)', () => {
    expect(viewSrc).toMatch(/bearDelta\(sentCamBear, _camBear\)/);
    expect(viewSrc).toContain('sentCamBear  = _camBear;');
  });
});
