/**
 * laneGuidanceModel — şerit rehberinin SUNUM semantiği. **SAF.**
 *
 * ── BU DOSYA YENİ BİR OTORİTE DEĞİLDİR ─────────────────────────────────────
 * Şerit GERÇEĞİ tek kaynaktan gelir: OSRM `intersections[].lanes` →
 * `routingService.extractLanes` → `RouteStep.lanes`. Burada hiçbir şey
 * TÜRETİLMEZ, TAHMİN EDİLMEZ, manevra tipinden ÜRETİLMEZ. Bu model yalnız
 * "gelen gerçeği ekranda hangi vurguyla ve hangi ok açısıyla göstereceğiz"
 * sorusunu yanıtlar. I/O · timer · `Date.now` · global durum · React YOKTUR.
 *
 * ── ÖLÇÜLEN İKİ KUSUR (2026-09-07) ─────────────────────────────────────────
 *
 * **1. İKİ GERÇEK ALAN TEK BOOLEAN'A ÇÖKÜYORDU.** `RouteLane` OSRM'den iki
 * AYRI gerçek taşır: `valid` (bu şeritten manevra YAPILABİLİR) ve `active`
 * (OSRM bu şeridi ÖNERDİ). Bileşen bunları `ln.active && ln.valid` ile tek
 * boolean'a indiriyordu. Sonuç: *"dönebilirsin ama önerilen şerit değil"*
 * ile *"bu şeritten DÖNEMEZSİN"* ekranda BİRBİRİNİN AYNI görünüyordu —
 * `valid` bilgisi tamamen kayboluyordu. Sürücü için bu iki durum aynı değildir.
 *
 * **2. U DÖNÜŞÜ DÜZ OK OLARAK ÇİZİLİYORDU.** Eski `_laneDir` yalnız `left` /
 * `right` alt dizesini arıyordu; `'uturn'` ikisini de içermediği için
 * `'straight'`e düşüyordu. Ölçüldü: `['uturn'] → straight`. Yani ürünün
 * "kanıtsız bilgi üretme yasağı"na rağmen ekran YANLIŞ yön gösteriyordu.
 * Aynı sebeple `'slight left'` ile `'sharp left'` aynı 90° oka iniyordu.
 *
 * ── GÖSTERGE SEÇİMİ ────────────────────────────────────────────────────────
 * Bir şeridin `indications` listesi ÇOKLU olabilir (`['straight','right']` =
 * bu şeritten hem düz hem sağa gidilebilir) ama ekranda tek ok vardır.
 * Kural: **mutlak açısı en büyük olan** gösterge kazanır — dönüş bilgisi düz
 * bilgisinden daha kritiktir. Bu, eski davranışın (ilk `left`/`right`)
 * genelleştirilmiş hâlidir: `['straight','right'] → right` ve
 * `['left','straight'] → left` sonuçları DEĞİŞMEZ.
 *
 * Hiçbir gösterge tanınmıyorsa (`['none']`, boş liste) sonuç `UNKNOWN`'dır ve
 * UI düz ok UYDURMAZ — nötr bir işaret çizer.
 */

/** Şeridin sürücü için anlamı. Üçü de GERÇEK veriden ayırt edilir. */
export type LaneEmphasis =
  /** `valid && active` — OSRM bu şeridi rota için önerdi. */
  | 'ROUTE_SELECTED'
  /** `valid && !active` — bu şeritten manevra yapılabilir ama önerilen değil. */
  | 'ALLOWED'
  /** `!valid` — bu şeritten manevra YAPILAMAZ. */
  | 'NOT_ALLOWED';

/** Ok yönü — OSRM sözlüğünün birebir karşılığı. */
export type LaneArrowDir =
  | 'uturn' | 'sharp-left' | 'left' | 'slight-left'
  | 'straight'
  | 'slight-right' | 'right' | 'sharp-right'
  | 'unknown';

/** OSRM göstergesi → ok yönü + ekran açısı (derece, saat yönü pozitif). */
const INDICATION_MAP: ReadonlyArray<readonly [osrm: string, dir: LaneArrowDir, angleDeg: number]> = [
  ['uturn',        'uturn',        180],
  ['sharp left',   'sharp-left',  -135],
  ['sharp right',  'sharp-right',  135],
  ['slight left',  'slight-left',  -45],
  ['slight right', 'slight-right',  45],
  ['left',         'left',         -90],
  ['right',        'right',         90],
  ['straight',     'straight',       0],
];

/** Tek şeridin sunum hâli. */
export interface LanePresentation {
  readonly emphasis: LaneEmphasis;
  readonly dir: LaneArrowDir;
  /** Ok döndürme açısı (derece). `unknown` için 0. */
  readonly angleDeg: number;
}

/** OSRM'den gelen ham şerit girdisi (yalnız okunan alanlar). */
export interface LaneEvidence {
  readonly valid: boolean;
  readonly active: boolean;
  readonly indications: readonly string[];
}

/** Göstergeyi çözer — çoklu listede mutlak açısı EN BÜYÜK olan kazanır. */
export function resolveLaneDirection(indications: readonly string[]): {
  readonly dir: LaneArrowDir; readonly angleDeg: number;
} {
  let best: { dir: LaneArrowDir; angleDeg: number } | null = null;
  for (const raw of indications) {
    const key = String(raw).trim().toLowerCase();
    /* Uzun anahtar önce eşleşmeli: `'sharp left'` içinde `'left'` de geçer. */
    const hit = INDICATION_MAP.find(([osrm]) => osrm === key)
      ?? INDICATION_MAP.find(([osrm]) => key.includes(osrm));
    if (!hit) continue;
    const cand = { dir: hit[1], angleDeg: hit[2] };
    if (!best || Math.abs(cand.angleDeg) > Math.abs(best.angleDeg)) best = cand;
  }
  return best ?? { dir: 'unknown', angleDeg: 0 };
}

/** Tek şeridi sunum hâline çevirir. */
export function resolveLanePresentation(lane: LaneEvidence): LanePresentation {
  const { dir, angleDeg } = resolveLaneDirection(lane.indications);
  const emphasis: LaneEmphasis = !lane.valid
    ? 'NOT_ALLOWED'
    : lane.active ? 'ROUTE_SELECTED' : 'ALLOWED';
  return { emphasis, dir, angleDeg };
}

/**
 * Şerit dizisini çözer. **Kanıt yoksa `null`** — UI panel çizmez.
 * Boş dizi de kanıt sayılmaz.
 */
export function resolveLaneRow(
  lanes: readonly LaneEvidence[] | null | undefined,
): readonly LanePresentation[] | null {
  if (!lanes || lanes.length === 0) return null;
  return lanes.map(resolveLanePresentation);
}
