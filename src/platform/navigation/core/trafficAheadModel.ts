/**
 * trafficAheadModel — rotada ÖNDEKİ trafik olayının sesli uyarı kararı. **SAF.**
 *
 * Veri: sağlayıcının bildirdiği rota bölümleri (`RouteState.trafficSections`,
 * bugün TomTom). Bölüm yoksa uyarı YOK — "yol açık" da denmez.
 *
 * Kural (Google/OEM benzeri):
 *  · Araç bölüme belirli bir mesafe kala BİR KEZ uyarılır (oturum + rota
 *    revizyonu + bölüm başı anahtarıyla — reroute'ta yeni rota yeniden uyarır).
 *  · Uyarı mesafesi hıza bağlıdır: otoyolda 2 km, şehirde 1 km.
 *  · Gecikmesi 60 sn'den az sıkışıklık konuşulmaz (gürültü); kapalı yol ve yol
 *    çalışması gecikmeden bağımsız söylenir.
 *  · Aracın içinde bulunduğu/geçtiği bölüm konuşulmaz.
 */
import type { RouteTrafficSection } from '../../routing/tomtomRouting';

export const TRAFFIC_AHEAD_CITY_M = 1_000;
export const TRAFFIC_AHEAD_HIGHWAY_M = 2_000;
export const TRAFFIC_AHEAD_MIN_DELAY_S = 60;
const HIGHWAY_KMH = 80;

export interface TrafficAheadInput {
  readonly sections: readonly RouteTrafficSection[];
  /** Rota noktası i'den rota SONUNA kalan mesafe (m) — suffix toplamı. */
  readonly cumulativeDistances: ArrayLike<number> | null;
  /** Aracın rota sonuna kalan yol-boyu mesafesi (m); bilinmiyorsa null → karar YOK. */
  readonly vehicleAlongRemainingM: number | null;
  readonly speedKmh: number;
  /** Bu rotada daha önce uyarılmış bölüm başları. */
  readonly announcedStarts: ReadonlySet<number>;
}

export interface TrafficAheadDecision {
  readonly startIdx: number;
  readonly distanceM: number;
  readonly text: string;
}

function _distPhrase(m: number): string {
  if (m >= 950) {
    const km = Math.round(m / 100) / 10;
    return `${String(km).replace('.', ',')} kilometre`;
  }
  return `${Math.max(100, Math.round(m / 100) * 100)} metre`;
}

function _delayPhrase(s: number | null): string {
  if (s === null || s < 60) return '';
  const min = Math.round(s / 60);
  return `, yaklaşık ${min} dakika gecikme`;
}

/** Söylenecek bir şey yoksa `null`. */
export function decideTrafficAhead(i: TrafficAheadInput): TrafficAheadDecision | null {
  const cum = i.cumulativeDistances;
  const along = i.vehicleAlongRemainingM;
  if (!cum || along === null || !Number.isFinite(along)) return null;
  const window = Number.isFinite(i.speedKmh) && i.speedKmh >= HIGHWAY_KMH
    ? TRAFFIC_AHEAD_HIGHWAY_M : TRAFFIC_AHEAD_CITY_M;

  let best: TrafficAheadDecision | null = null;
  for (const s of i.sections) {
    if (i.announcedStarts.has(s.startIdx)) continue;
    if (s.startIdx < 0 || s.startIdx >= cum.length) continue;
    const distanceM = along - cum[s.startIdx]!;
    if (!(distanceM > 0) || distanceM > window) continue;       // geride / içinde / çok uzak
    const important = s.kind === 'ROAD_CLOSURE' || s.kind === 'ROAD_WORK';
    if (!important && (s.delayS === null || s.delayS < TRAFFIC_AHEAD_MIN_DELAY_S)) continue;
    if (best && best.distanceM <= distanceM) continue;          // en yakın olan
    const what = s.kind === 'ROAD_CLOSURE' ? 'yol kapalı'
      : s.kind === 'ROAD_WORK' ? 'yol çalışması'
        : 'trafik sıkışıklığı';
    best = {
      startIdx: s.startIdx, distanceM,
      text: `${_distPhrase(distanceM)} sonra ${what}${_delayPhrase(s.delayS)}`,
    };
  }
  return best;
}
