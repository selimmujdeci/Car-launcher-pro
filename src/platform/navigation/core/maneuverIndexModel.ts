/**
 * maneuverIndexModel.ts — Manevra noktalarını rota geometrisine bağlayan SAF model.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ── ÇÖZDÜĞÜ ARIZA (denetim §7.1, kullanıcı birebir bildirdi) ────────────────
 * "Daha 50 metre var, sağa dön diyor." Bir sonraki manevraya mesafe KUŞ UÇUŞU
 * (`hav(araç, manevraNoktası)`) hesaplanıyordu. Virajlı yaklaşımda kuş uçuşu
 * gerçek yol mesafesinden KISA çıkar → HUD yanlış, sesli anons ERKEN.
 *
 * ── NEDEN UCUZ ──────────────────────────────────────────────────────────────
 * `cumulativeDistances` (suffix-sum) ZATEN vardı ve her tick O(1) okunuyordu.
 * Eksik olan tek şey manevra noktasının GEOMETRİ İNDEKSİydi. Bu modül onu bir
 * kez (rota kurulunca) çözer; sonra her tick tek çıkarma işlemidir.
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 * Bağlanamayan manevra `UNRESOLVED` işaretlenir ve mesafesi `null` döner.
 * `null` "0 m" DEĞİLDİR: çağıran kesin komut üretmemelidir.
 */

import { hav } from './geo';

export type AnchorMethod =
  /** OSRM adım geometrilerinin uç uca eklenmesiyle çözüldü (kesin). */
  | 'CONCATENATION'
  /** Uç uca ekleme tutmadı; geometride en yakın nokta arandı. */
  | 'NEAREST'
  /** Hiçbir yöntem kabul edilebilir hata payında bağlayamadı. */
  | 'UNRESOLVED';

export interface ManeuverAnchor {
  readonly stepIndex: number;
  /** Manevra noktasının rota geometrisindeki indeksi; çözülemezse -1. */
  readonly geometryIndex: number;
  /** Bu manevra noktasından rotanın SONUNA kalan yol-boyu mesafe (m). */
  readonly alongRemainingM: number | null;
  readonly method: AnchorMethod;
  /** Bağlanan geometri noktası ile adımın bildirdiği koordinat arası fark (m). */
  readonly residualM: number | null;
}

/** Uç uca ekleme bu hata payında tutarsa kesin sayılır. */
export const CONCAT_TOLERANCE_M = 25;
/** En yakın nokta araması bu hata payını aşarsa bağlama REDDEDİLİR. */
export const NEAREST_TOLERANCE_M = 60;

export interface ManeuverAnchorInput {
  /** Adımın manevra koordinatı [lon, lat]. */
  readonly coordinate: readonly [number, number];
  /**
   * Adımın kendi geometrisindeki nokta sayısı (OSRM `step.geometry.coordinates.length`).
   * Verilirse uç uca ekleme yöntemi denenir — bu KESİN yöntemdir.
   */
  readonly geometryPointCount?: number;
}

/**
 * Tüm manevra noktalarını rota geometrisine bağlar. Rota kurulunca BİR KEZ çağrılır.
 *
 * Uç uca ekleme mantığı: OSRM'de adım i'nin geometrisi, adım i+1'in geometrisiyle
 * bir noktayı PAYLAŞIR (bitiş = başlangıç). Bu yüzden indeks ilerlemesi
 * `len(adım i) - 1` kadardır.
 */
export function buildManeuverAnchors(
  geometry: readonly [number, number][] | null,
  cumulative: Float64Array | null,
  steps: readonly ManeuverAnchorInput[],
): readonly ManeuverAnchor[] {
  if (!geometry || geometry.length < 2 || steps.length === 0) {
    return steps.map((_, i) => ({
      stepIndex: i, geometryIndex: -1, alongRemainingM: null,
      method: 'UNRESOLVED' as AnchorMethod, residualM: null,
    }));
  }

  const cum = (cumulative && cumulative.length === geometry.length) ? cumulative : null;
  const out: ManeuverAnchor[] = [];
  let cursor = 0;
  let concatUsable = true;

  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const [sLon, sLat] = st.coordinate;

    let idx = -1;
    let method: AnchorMethod = 'UNRESOLVED';
    let residual: number | null = null;

    // ── 1) Uç uca ekleme (kesin yöntem) ─────────────────────────────────────
    if (concatUsable && cursor >= 0 && cursor < geometry.length) {
      const r = hav(sLat, sLon, geometry[cursor][1], geometry[cursor][0]);
      if (r <= CONCAT_TOLERANCE_M) {
        idx = cursor; method = 'CONCATENATION'; residual = r;
      } else {
        // Bir kez tutmazsa akış kaymıştır; kalan adımlarda da güvenilmez.
        concatUsable = false;
      }
    }

    // ── 2) En yakın nokta araması (yedek) ───────────────────────────────────
    if (idx < 0) {
      let bestIdx = -1;
      let bestD = Infinity;
      for (let k = 0; k < geometry.length; k++) {
        const d = hav(sLat, sLon, geometry[k][1], geometry[k][0]);
        if (d < bestD) { bestD = d; bestIdx = k; }
      }
      if (bestIdx >= 0 && bestD <= NEAREST_TOLERANCE_M) {
        idx = bestIdx; method = 'NEAREST'; residual = bestD;
      } else {
        residual = Number.isFinite(bestD) ? bestD : null;
      }
    }

    const alongRemaining = (idx >= 0)
      ? (cum ? cum[idx] : _suffixFrom(geometry, idx))
      : null;

    out.push({
      stepIndex: i,
      geometryIndex: idx,
      alongRemainingM: alongRemaining,
      method,
      residualM: residual,
    });

    // Bir sonraki adımın beklenen indeksi.
    if (concatUsable && typeof st.geometryPointCount === 'number' && st.geometryPointCount > 0) {
      cursor += Math.max(0, st.geometryPointCount - 1);
    } else if (concatUsable) {
      concatUsable = false; // sayaç yoksa uç uca ekleme sürdürülemez
    }
  }

  return out;
}

function _suffixFrom(geometry: readonly [number, number][], fromIdx: number): number {
  let sum = 0;
  for (let i = fromIdx; i < geometry.length - 1; i++) {
    sum += hav(geometry[i][1], geometry[i][0], geometry[i + 1][1], geometry[i + 1][0]);
  }
  return sum;
}

/**
 * Araçtan bir sonraki manevraya YOL-BOYU mesafe (m).
 *
 * `null` döner ve bu bir HATA DEĞİL bir CEVAPtır:
 *   · aracın rota üzerindeki konumu bilinmiyorsa (map match yok),
 *   · manevra geometriye bağlanamadıysa (`UNRESOLVED`).
 * Çağıran `null` gördüğünde kesin komut ÜRETMEMELİDİR.
 */
export function alongRouteDistanceToManeuver(
  vehicleAlongRemainingM: number | null,
  anchor: ManeuverAnchor | undefined | null,
): number | null {
  if (vehicleAlongRemainingM == null || !Number.isFinite(vehicleAlongRemainingM)) return null;
  if (!anchor || anchor.alongRemainingM == null) return null;
  const d = vehicleAlongRemainingM - anchor.alongRemainingM;
  // Manevra geçilmişse negatif çıkar → 0'a kırp (geriye sayma YOK).
  return d > 0 ? d : 0;
}

/**
 * Manevra GEÇİLDİ Mİ — yol-boyu ilerlemeye göre.
 * Kuş uçuşu eşiğiyle karıştırılmaz: araç manevra noktasının rota üzerinde
 * İLERİSİNDEyse geçilmiştir, yakınında olması yetmez.
 */
export function hasPassedManeuverAlongRoute(
  vehicleAlongRemainingM: number | null,
  anchor: ManeuverAnchor | undefined | null,
  slackM = 5,
): boolean {
  if (vehicleAlongRemainingM == null || !anchor || anchor.alongRemainingM == null) return false;
  return vehicleAlongRemainingM < anchor.alongRemainingM - slackM;
}

export const ANCHOR_METHOD_LABEL: Readonly<Record<AnchorMethod, string>> = {
  CONCATENATION: 'KESİN (uç uca)',
  NEAREST:       'YAKLAŞIK (en yakın nokta)',
  UNRESOLVED:    'BAĞLANAMADI',
} as const;
