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
    // Değer atanırken yeni bir en-yakın-segment araması yapılmamalı.
    expect(navSrc).toMatch(/_lastSnappedSegBearing\s*=\s*bearingBetween\(aLat, aLon, bLat, bLon\)/);
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
