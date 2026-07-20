/**
 * tripRecommendationEngine — MAVI 4.0 · TRIP AI · ATOMİK GÖREV MAVI4-TRIP-3
 *
 * TRIP-2 koridor adaylarını alır → **değerlendirir, filtreler, sıralar, açıklar**.
 * Yalnız öneri motorudur. Bu modül:
 *   • Rota DEĞİŞTİRMEZ · ETA DEĞİŞTİRMEZ · Preview YOK · Navigation API çağrısı YOK.
 *   • Store / EventBus / yeni API / UI / voice / telemetry / diagnostic YOK.
 *   • Yan etkisiz **saf fonksiyon** — girdi mutasyona uğratılmaz, global durum okunmaz/yazılmaz.
 *
 * SKORLAMA — geleceğe hazır: FinalScore yalnız BUGÜN mevcut kaynakları kullanır.
 * Henüz beslenmeyen kaynaklar (hava, trafik, popülerlik, gün batımı, açık/kapalı…)
 * `NO_SOURCE` olarak işaretlenir ve skora HİÇ katılmaz (yokluğu cezalandırmaz).
 * Yeni bir kaynak eklendiğinde tek yapılacak: resolver'ı `ACTIVE`'e çevirmek.
 * **Sahte veri üretilmez; NO_SOURCE bir kaynak için açıklama uydurulmaz.**
 */

import type { CorridorCandidate } from './tripCorridorEngine';

/* ── Kategoriler ─────────────────────────────────────────────────────────── */

export type PoiCategory =
  | 'historical'   // tarihi
  | 'nature'       // doğa
  | 'camp'         // kamp
  | 'photo'        // fotoğraf
  | 'restaurant'   // restoran
  | 'museum'       // müze
  | 'scenic'       // manzara
  | 'fuel'         // yakıt
  | 'rest'         // mola
  | 'family'       // çocuk dostu
  | 'unknown';     // kaynak yok — NO_SOURCE

/** TRIP-3 girdisi: TRIP-2 çıktısı + opsiyonel kategori zenginleştirmesi.
 *  `category` yoksa 'unknown' (NO_SOURCE) kabul edilir — TRIP-2 çıktısı doğrudan verilebilir. */
export type TripCandidate = CorridorCandidate & { category?: PoiCategory };

/* ── Kullanıcı tercihleri & filtreler ────────────────────────────────────── */

/** Kullanıcı tercihleri — skorlamayı besler. (Kullanıcı PROFİLİ henüz bağlanmaz.) */
export interface TripPreferences {
  /** İlgi alanları — eşleşen kategori userInterest sinyalini yükseltir. */
  interests?: PoiCategory[];
}

/** Çıktıyı kısıtlayan sert filtreler. Hepsi opsiyonel — boş filtre → filtreleme yok. */
export interface TripFilters {
  categories?:             PoiCategory[]; // yalnız bu kategoriler
  minScore?:               number;        // finalScore ≥ bu değer
  maxCandidate?:           number;        // en fazla N öneri (>0)
  maxDetourMeters?:        number;        // estimatedDetour ≤ bu değer
  onRouteOnly?:            boolean;        // yalnız rota üzeri adaylar
  onRouteThresholdMeters?: number;        // onRouteOnly eşiği (varsayılan 50 m)
}

/* ── Sinyal mimarisi (geleceğe hazır) ────────────────────────────────────── */

export type SignalStatus = 'ACTIVE' | 'NO_SOURCE';

export interface SignalContribution {
  key:    string;
  status: SignalStatus;
  weight: number;          // skora katkı ağırlığı (0 = bilgi amaçlı, skora girmez)
  value:  number | null;   // 0..1 normalize; NO_SOURCE → null
}

/** Skorlamaya girebilecek tüm kaynaklar (bugün + gelecek). Sıra deterministiktir. */
const SIGNAL_DEFS: ReadonlyArray<{ key: string; weight: number }> = [
  { key: 'proximity',     weight: 1.0 },  // yakınlık — BUGÜN aktif
  { key: 'userInterest',  weight: 0.8 },  // kullanıcı ilgisi — tercih verilirse aktif
  { key: 'category',      weight: 0.0 },  // kategori bilinirliği — bilgi amaçlı (skora girmez)
  { key: 'weather',       weight: 0.4 },  // ── aşağısı bugün NO_SOURCE ──
  { key: 'traffic',       weight: 0.4 },
  { key: 'popularity',    weight: 0.5 },
  { key: 'childFriendly', weight: 0.5 },
  { key: 'sunset',        weight: 0.3 },
  { key: 'openStatus',    weight: 0.5 },
  { key: 'accessibility', weight: 0.3 },
  { key: 'fuelNeed',      weight: 0.6 },
];

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function resolveCategory(c: TripCandidate): PoiCategory {
  return c.category ?? 'unknown';
}

/** Tek sinyalin bugünkü durumunu üretir. Yalnız gerçek veriden; yoksa NO_SOURCE. */
function resolveSignal(
  key: string,
  candidate: TripCandidate,
  category: PoiCategory,
  prefs: TripPreferences | undefined,
): { status: SignalStatus; value: number | null } {
  switch (key) {
    case 'proximity':
      // TRIP-2 score = 1 − dist/koridor; her zaman mevcut.
      return { status: 'ACTIVE', value: clamp01(candidate.score) };

    case 'category':
      // Kategori biliniyor mu? Bilgi amaçlı (weight 0) — skoru etkilemez.
      return category !== 'unknown'
        ? { status: 'ACTIVE', value: 1 }
        : { status: 'NO_SOURCE', value: null };

    case 'userInterest': {
      // Yalnız tercih VE bilinen kategori varsa aktif; aksi halde NO_SOURCE.
      const interests = prefs?.interests;
      if (!interests || interests.length === 0 || category === 'unknown') {
        return { status: 'NO_SOURCE', value: null };
      }
      return { status: 'ACTIVE', value: interests.includes(category) ? 1 : 0 };
    }

    // Bugün beslenmeyen kaynaklar — sahte veri YOK.
    default:
      return { status: 'NO_SOURCE', value: null };
  }
}

/* ── Öneri çıktısı ───────────────────────────────────────────────────────── */

export type ReasonCode =
  | 'VERY_CLOSE_TO_ROUTE'
  | 'CLOSE_TO_ROUTE'
  | 'LOW_DETOUR'
  | 'EARLY_ON_ROUTE'
  | 'LATE_ON_ROUTE'
  | 'MATCHES_INTEREST'
  | 'KNOWN_CATEGORY';

export type RecommendationLevel = 'high' | 'medium' | 'low';

export interface Recommendation {
  poiId:               string;
  score:               number;               // finalScore 0..1
  reasonCodes:         ReasonCode[];          // yalnız gerçek veriden türetilen kodlar
  category:            PoiCategory;           // NO_SOURCE → 'unknown'
  distanceToRoute:     number;
  estimatedDetour:     number;
  routeProgress:       number;
  recommendationLevel: RecommendationLevel;
  summary:             string;                // kısa TR açıklama; NO_SOURCE → ''
  signals:             SignalContribution[];  // şeffaflık: ACTIVE/NO_SOURCE dökümü
}

// Eşikler (metre / oran) — sabit, veri-temelli reason kodları için.
const VERY_CLOSE_M = 150;
const CLOSE_M      = 500;
const LOW_DETOUR_M = 400;
const EARLY_PROG   = 0.25;
const LATE_PROG    = 0.75;
const ON_ROUTE_M   = 50;

const CATEGORY_SUMMARY_TR: Record<PoiCategory, string> = {
  historical: 'Tarihi yer.',
  nature:     'Doğa noktası.',
  camp:       'Kamp alanı.',
  photo:      'Fotoğraf noktası.',
  restaurant: 'Restoran.',
  museum:     'Müze.',
  scenic:     'Manzara noktası.',
  fuel:       'Yakıt için uygun.',
  rest:       'Kısa mola için uygun.',
  family:     'Aile için uygun.',
  unknown:    '',
};

function levelFromScore(score: number): RecommendationLevel {
  if (score >= 0.75) return 'high';
  if (score >= 0.5)  return 'medium';
  return 'low';
}

/** Kısa TR özet — yalnız ACTIVE reason kodlarından. Kaynak yoksa boş string. */
function buildSummary(reasons: ReasonCode[], category: PoiCategory): string {
  const known = category !== 'unknown';
  if (reasons.includes('MATCHES_INTEREST') && known) return CATEGORY_SUMMARY_TR[category];
  if (reasons.includes('VERY_CLOSE_TO_ROUTE'))       return 'Rotaya çok yakın.';
  if (known)                                         return CATEGORY_SUMMARY_TR[category];
  if (reasons.includes('CLOSE_TO_ROUTE'))            return 'Rotaya yakın.';
  return ''; // NO_SOURCE → boş bırak
}

/* ── Ana motor ───────────────────────────────────────────────────────────── */

/**
 * TRIP-2 koridor adaylarını değerlendirir → filtreler → sıralar → açıklar.
 *
 * @param candidates TRIP-2 çıktısı (opsiyonel `category` zenginleştirmesiyle).
 * @param prefs      Kullanıcı tercihleri (skorlamayı besler). Opsiyonel.
 * @param filters    Sert filtreler. Opsiyonel — boş → filtreleme yok.
 * @returns Deterministik sıralı `Recommendation[]` (skor↓ → routeProgress↑ → poiId↑).
 *
 * Saf: girdi mutasyona uğratılmaz; rota/ETA/preview/nav dokunulmaz.
 */
export function generateRecommendations(
  candidates: readonly TripCandidate[] | null | undefined,
  prefs?: TripPreferences,
  filters?: TripFilters,
): Recommendation[] {
  if (!candidates || candidates.length === 0) return [];

  const recs: Recommendation[] = [];

  for (const c of candidates) {
    if (!c || !c.location) continue;
    const category = resolveCategory(c);

    // 1) Sinyalleri çöz → finalScore (yalnız ACTIVE, weight>0, value!=null).
    const signals: SignalContribution[] = [];
    let num = 0;
    let den = 0;
    for (const def of SIGNAL_DEFS) {
      const { status, value } = resolveSignal(def.key, c, category, prefs);
      signals.push({ key: def.key, status, weight: def.weight, value });
      if (status === 'ACTIVE' && def.weight > 0 && value !== null) {
        num += def.weight * value;
        den += def.weight;
      }
    }
    const finalScore = den > 0 ? clamp01(num / den) : 0;

    // 2) Reason kodları — yalnız gerçek veriden.
    const reasonCodes: ReasonCode[] = [];
    if (c.distanceToRoute < VERY_CLOSE_M)      reasonCodes.push('VERY_CLOSE_TO_ROUTE');
    else if (c.distanceToRoute < CLOSE_M)      reasonCodes.push('CLOSE_TO_ROUTE');
    if (c.estimatedDetour < LOW_DETOUR_M)      reasonCodes.push('LOW_DETOUR');
    if (c.routeProgress < EARLY_PROG)          reasonCodes.push('EARLY_ON_ROUTE');
    else if (c.routeProgress > LATE_PROG)      reasonCodes.push('LATE_ON_ROUTE');
    const ui = signals.find(s => s.key === 'userInterest');
    if (ui?.status === 'ACTIVE' && ui.value === 1) reasonCodes.push('MATCHES_INTEREST');
    if (category !== 'unknown')                reasonCodes.push('KNOWN_CATEGORY');

    recs.push({
      poiId:               c.location.id,
      score:               finalScore,
      reasonCodes,
      category,
      distanceToRoute:     c.distanceToRoute,
      estimatedDetour:     c.estimatedDetour,
      routeProgress:       c.routeProgress,
      recommendationLevel: levelFromScore(finalScore),
      summary:             buildSummary(reasonCodes, category),
      signals,
    });
  }

  // 3) Filtreler (boş filtre → hepsi geçer).
  const filtered = filters ? recs.filter(r => passesFilters(r, filters)) : recs;

  // 4) Deterministik sıralama.
  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.routeProgress !== b.routeProgress) return a.routeProgress - b.routeProgress;
    return a.poiId < b.poiId ? -1 : a.poiId > b.poiId ? 1 : 0;
  });

  // 5) maxCandidate kısma.
  const max = filters?.maxCandidate;
  if (Number.isFinite(max) && (max as number) > 0 && filtered.length > (max as number)) {
    filtered.length = max as number;
  }

  return filtered;
}

function passesFilters(r: Recommendation, f: TripFilters): boolean {
  if (f.categories && f.categories.length > 0 && !f.categories.includes(r.category)) return false;
  if (Number.isFinite(f.minScore) && r.score < (f.minScore as number)) return false;
  if (Number.isFinite(f.maxDetourMeters) && r.estimatedDetour > (f.maxDetourMeters as number)) return false;
  if (f.onRouteOnly) {
    const thr = Number.isFinite(f.onRouteThresholdMeters) ? (f.onRouteThresholdMeters as number) : ON_ROUTE_M;
    if (r.distanceToRoute > thr) return false;
  }
  return true;
}

/* ── Karşılaştırma ───────────────────────────────────────────────────────── */

export interface RecommendationComparison {
  /** Daha küçük distanceToRoute; eşitse null. */
  closerPoiId:      string | null;
  /** Daha yüksek score; eşitse null. */
  higherScorePoiId: string | null;
  /** Rota boyunca daha önce gelen (küçük routeProgress); eşitse null. */
  earlierPoiId:     string | null;
  /** a'da olup b'de olmayan reason kodları. */
  onlyInA:          ReasonCode[];
  /** b'de olup a'da olmayan reason kodları. */
  onlyInB:          ReasonCode[];
}

/** İki öneriyi saf şekilde karşılaştırır — yan etki yok. */
export function compareRecommendations(a: Recommendation, b: Recommendation): RecommendationComparison {
  const aReasons = new Set(a.reasonCodes);
  const bReasons = new Set(b.reasonCodes);
  return {
    closerPoiId:
      a.distanceToRoute === b.distanceToRoute ? null : a.distanceToRoute < b.distanceToRoute ? a.poiId : b.poiId,
    higherScorePoiId:
      a.score === b.score ? null : a.score > b.score ? a.poiId : b.poiId,
    earlierPoiId:
      a.routeProgress === b.routeProgress ? null : a.routeProgress < b.routeProgress ? a.poiId : b.poiId,
    onlyInA: a.reasonCodes.filter(rc => !bReasons.has(rc)),
    onlyInB: b.reasonCodes.filter(rc => !aReasons.has(rc)),
  };
}
