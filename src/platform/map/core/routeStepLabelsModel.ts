/**
 * routeStepLabelsModel.ts — rota bandı üzerinde segment-bazlı sokak adı
 * etiketleri için SAF model.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ── ÇÖZDÜĞÜ ARIZA (kök 1, harita bilgi yoğunluğu denetimi, 2026-08-18) ──────
 * Google Maps rota çizgisinin üstüne, geçilen her sokağın adını mavi bir
 * "pill" ile basar ("0451. Sk.", "Mavi Bulvar"). CarOS Pro'da rotaya bağlı
 * HİÇBİR etiket yoktu — yalnız genel `road-label` katmanı vardı ve o rota/
 * kavşak bağlamından bağımsızdı (harita genelinde MapLibre'nin uygun
 * bulduğu keyfi bir noktada duruyordu).
 *
 * ── NEDEN UCUZ ────────────────────────────────────────────────────────────
 * OSRM zaten her adımı (`RouteStep`) sokak adıyla (`streetName`) döner.
 * Adımın rota geometrisindeki BAŞLANGIÇ indeksini bulmak için ayrı bir
 * hesap YAZILMADI — `maneuverIndexModel.buildManeuverAnchors` bunu #485
 * (yola boyanmış manevra oku) için ZATEN çözüyordu (uç-uca-ekleme + en-yakın-
 * nokta yedek yöntemi, "İDDİA EDİLMEDEN" — çözülemezse -1). Bu modül onu
 * AYNI ANCHOR DİZİSİ üstünden ardışık adım çiftleri arasındaki geometri
 * dilimini keser.
 *
 * TEK GEOMETRİ KAYNAĞI: dilimler `_applyRouteGeometry`'nin ÇİZDİĞİ aynı
 * `coordinates` dizisinden alınır (OSRM'in ayrı `step.geometry` alanından
 * DEĞİL) — böylece etiket rota çizgisiyle piksel piksel hizalı kalır,
 * sağlayıcının adım-geometrisi ile birleştirilmiş-rota-geometrisi arasında
 * olası bir sadeleştirme farkına bağımlı olmaz.
 *
 * ── DÜRÜSTLÜK ────────────────────────────────────────────────────────────
 * Anchor çözülemezse (`geometryIndex < 0`) o adımın etiketi ATLANIR —
 * uydurma bir konuma etiket YAPIŞTIRILMAZ (painted-arrow ile aynı disiplin:
 * "dayanağı yoksa çizilmez").
 */

import { buildManeuverAnchors } from '../../navigation/core/maneuverIndexModel';

export interface RouteStepLabelInput {
  readonly streetName: string;
  readonly coordinate: readonly [number, number];
  readonly geometryPointCount: number;
}

export interface RouteStepLabelSegment {
  readonly stepIndex: number;
  readonly name: string;
  readonly coordinates: [number, number][];
}

/** Etiketin `symbol-placement: line-center` ile anlamlı yerleşebilmesi için gereken en az nokta sayısı. */
const MIN_SEGMENT_POINTS = 2;

export function buildRouteStepLabelSegments(
  geometry: readonly [number, number][] | null,
  steps: readonly RouteStepLabelInput[],
): readonly RouteStepLabelSegment[] {
  if (!geometry || geometry.length < 2 || steps.length === 0) return [];

  const anchors = buildManeuverAnchors(geometry, null, steps.map(s => ({
    coordinate: s.coordinate,
    geometryPointCount: s.geometryPointCount,
  })));

  const out: RouteStepLabelSegment[] = [];
  for (let i = 0; i < steps.length; i++) {
    const name = steps[i].streetName.trim();
    if (!name) continue; // OSRM adsız yol/kavşak bildirdi — gösterecek bir şey yok

    const startAnchor = anchors[i];
    if (!startAnchor || startAnchor.geometryIndex < 0) continue; // bağlanamadı — İDDİA EDİLMEZ

    const nextAnchor = anchors[i + 1];
    const endIdx = (nextAnchor && nextAnchor.geometryIndex >= 0)
      ? nextAnchor.geometryIndex
      : geometry.length - 1; // son adım — rotanın sonuna kadar

    if (endIdx <= startAnchor.geometryIndex) continue; // dejenere/sıfır-uzunluk dilim

    const slice = geometry.slice(startAnchor.geometryIndex, endIdx + 1) as [number, number][];
    if (slice.length < MIN_SEGMENT_POINTS) continue;

    out.push({ stepIndex: i, name, coordinates: slice });
  }
  return out;
}
