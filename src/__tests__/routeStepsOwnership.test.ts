/**
 * routeStepsOwnership.test.ts — #639 KİLİDİ
 * "Rota adımlarının sahibi harita ÖRNEĞİDİR" sözleşmesi.
 *
 * ── NEDEN VAR (CİHAZDA ÖLÇÜLDÜ, 2026-08-18 ~22:05, Xiaomi 23090RA98I) ───────
 * #635/#638 ile eklenen rota sokak adı etiketleri (dolgu "pill") ilk açılışta
 * DOĞRU çiziliyordu (ekran görüntüsüyle kanıtlandı: "Mavi Bulvar" ve
 * "Gazipaşa Bulvarı" kapsülleri rota bandının üstünde). Ana ekrana dönüp
 * tema GÜNDÜZ↔GECE değiştirildikten sonra etiketler KAYBOLDU ve bir daha
 * GERİ GELMEDİ — ne uygulama yeniden başlatılınca ne de rota yeniden
 * hesaplanınca.
 *
 * KÖK: `M.cachedRoute` modül seviyesinde PAYLAŞILIR, ama harita örneği İKİ
 * tanedir (MiniMapWidget · FullMapView — sahiplik devreder). `MiniMapWidget`
 * rotayı adımları BİLMEDEN uygular (`setRouteGeometry(map, geom)`); eski kod
 * `steps` varsayılanını `[]` alıp önbelleğe KOŞULSUZ yazdığı için mini
 * haritanın her çağrısı TAM haritanın adımlarını siliyordu. Tam harita bir
 * sonraki `style.load`'da (tema geçişi / WebGL restore) rotayı bu boş
 * önbellekten geri kurunca etiketler SESSİZCE ölüyordu.
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *   1. `steps` VERİLMEYEN çağrı, AYNI rota için o haritanın adımlarını SİLMEZ.
 *   2. Adımlar harita ÖRNEĞİNE bağlıdır — bir harita diğerininkini görmez/ezmez.
 *   3. Rota DEĞİŞTİYSE ve adım verilmediyse adımlar TEMİZLENİR (yanlış sokak
 *      adı basmaktansa etiketsiz kalınır).
 *   4. Açıkça verilen `[]` gerçekten "adım yok" demektir (niyet korunur).
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setRouteGeometry, getRouteStepsFor } from '../platform/map/MapLayerManager';
import { M } from '../platform/map/_mapState';
import type { RouteStep } from '../platform/routingService';

/** Stili "yüklenmemiş" bildiren asgari sahte harita: `_applyRouteGeometry`
 *  erken döner, ölçmek istediğimiz ÖNBELLEK yazımı ise ondan ÖNCE olur. */
function fakeMap(): any {
  return {
    isStyleLoaded: () => false,
    getLayer:      () => undefined,
    getSource:     () => undefined,
    getStyle:      () => ({}),
  };
}

const ROUTE_A: [number, number][] = [[34.90, 36.91], [34.91, 36.92], [34.92, 36.93]];
const ROUTE_B: [number, number][] = [[35.10, 37.00], [35.11, 37.01], [35.12, 37.02]];

const STEPS: RouteStep[] = [
  { streetName: 'Mavi Bulvar',      coordinate: [34.905, 36.915], geometryPointCount: 2 } as unknown as RouteStep,
  { streetName: 'Gazipaşa Bulvarı', coordinate: [34.915, 36.925], geometryPointCount: 2 } as unknown as RouteStep,
];

describe('#639 — rota adımlarının sahibi harita örneğidir', () => {
  beforeEach(() => {
    M.cachedRoute          = null;
    M.pendingRouteGeometry = null;
    M.isStyleChanging      = false;
  });

  it('🔒 CİHAZDA ÖLÇÜLEN KUSUR: adımsız çağrı AYNI rotanın adımlarını SİLMEZ', () => {
    const full = fakeMap();
    setRouteGeometry(full, ROUTE_A, [], undefined, undefined, undefined, STEPS);
    expect(getRouteStepsFor(full)).toHaveLength(2);

    // Mini harita deseni: aynı rota, adım BİLGİSİ YOK (parametre verilmiyor).
    setRouteGeometry(full, ROUTE_A);
    expect(
      getRouteStepsFor(full),
      'adımsız çağrı adımları sildi — tema geçişinde etiketler ölür (cihazda ölçülen kusur)',
    ).toHaveLength(2);
    expect(M.cachedRoute?.steps).toHaveLength(2);
  });

  it('🔒 İKİ HARİTA BİRBİRİNİ EZMEZ: mini haritanın çağrısı tam haritanınkini bozmaz', () => {
    const full = fakeMap();
    const mini = fakeMap();

    setRouteGeometry(full, ROUTE_A, [], undefined, undefined, undefined, STEPS);
    setRouteGeometry(mini, ROUTE_A);   // mini: adım bilmiyor

    expect(getRouteStepsFor(full), 'tam haritanın adımları mini yüzünden gitti').toHaveLength(2);
    expect(getRouteStepsFor(mini), 'mini haritaya adım sızdı — #635 (f) kapsam kararı çiğnendi').toHaveLength(0);
  });

  it('🔒 ROTA DEĞİŞTİYSE adımsız çağrı adımları TEMİZLER (yanlış sokak adı basma)', () => {
    const full = fakeMap();
    setRouteGeometry(full, ROUTE_A, [], undefined, undefined, undefined, STEPS);
    setRouteGeometry(full, ROUTE_B); // yeni rota, adım bilgisi yok
    expect(
      getRouteStepsFor(full),
      'eski adımlar yeni geometriye iliştirildi — yanlış etiket etiketsizden KÖTÜDÜR',
    ).toHaveLength(0);
  });

  it('🔒 AÇIKÇA verilen boş dizi gerçekten "adım yok" demektir (niyet korunur)', () => {
    const full = fakeMap();
    setRouteGeometry(full, ROUTE_A, [], undefined, undefined, undefined, STEPS);
    setRouteGeometry(full, ROUTE_A, [], undefined, undefined, undefined, []);
    expect(getRouteStepsFor(full)).toHaveLength(0);
  });

  it('🔒 KAYNAK: MapCore ÜÇ geri-kurma yolunun HİÇBİRİ paylaşılan adımı kullanmaz', () => {
    const src = readMapCore();
    /* Üç yol vardır ve üçü de aynı kusuru üretebilir:
         1) `style.load` (ilk kurulum / stil yeniden yükleme)
         2) WebGL context restore (`healMap`)
         3) `switchMapStyle` replay'i (tema geçişi — CİHAZDA bu yol yakalandı;
            `pendingRouteGeometry`ye MİNİ harita da yazar). */
    expect(src, 'paylaşılan önbellekten adım okuyan bir geri-kurma yolu kalmış')
      .not.toMatch(/(cachedRoute|pendingRouteGeometry|_routeToReplay)\.steps/);
    const hits = src.match(/getRouteStepsFor\(map\)/g) ?? [];
    expect(hits.length, 'üç geri-kurma yolunun hepsi harita-başı adım okumuyor')
      .toBeGreaterThanOrEqual(3);
  });
});

function readMapCore(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path');
  return readFileSync(join(process.cwd(), 'src/platform/map/MapCore.ts'), 'utf8');
}
