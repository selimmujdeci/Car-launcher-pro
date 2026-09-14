/**
 * cockpitSwipeModel — HOME ↔ Digital Cockpit yatay geçişinin SAF KARAR MODELİ.
 *
 * ── NEDEN AYRI VE SAF ─────────────────────────────────────────────────────
 * Jest eşiği bir GÜVENLİK parametresidir: sürüş sırasında yanlışlıkla sayfa
 * değiştiren bir kaydırma, sürücünün gösterge ekranını elinden alır. Karar bu
 * yüzden React/DOM'dan ayrı, tek yerde ve test edilebilir tutulur.
 *
 * ── MEVCUT JESTLERLE ÇAKIŞMAMA SÖZLEŞMESİ ────────────────────────────────
 *  1. `VolumeGestureLayer` (App.tsx, window capture) yalnız DİKEY baskın
 *     hareketi ses jesti sayar. Bu model ise YALNIZ YATAY baskın hareketi
 *     kabul eder (`HORIZONTAL_DOMINANCE`) → iki jest eksen olarak ayrıktır.
 *  2. HOME'da jest YALNIZ SAĞ KENAR BANDINDAN başlayabilir. Bu bilinçlidir:
 *     HOME'un ortasında yatay kaydırılabilir listeler (uygulama ızgarası,
 *     müzik kartı) vardır; sayfa jestini ekranın tamamına açmak onları bozardı.
 *     Kenar-başlangıcı, OEM head unit ve Android sistem jestlerinin desenidir.
 *  3. Cockpit sayfasında yatay kaydırılabilir içerik YOKTUR → geri dönüş jesti
 *     ekranın her yerinden başlayabilir.
 *  4. Harita/çekmece/geri vites gibi tam ekran yüzeyler açıkken jest HİÇ
 *     başlamaz (`blocked`) — karar çağırana aittir, bu model onu yalnız uygular.
 *
 * SAF: I/O YOK · DOM YOK · timer YOK · React YOK · global durum YOK.
 */

export type CockpitPage = 'home' | 'cockpit';

/* ══════════════════════════════════════════════════════════════════════════
 * Eşikler
 * ════════════════════════════════════════════════════════════════════════ */

/** HOME'da jestin başlayabileceği sağ kenar bandı — viewport genişliğinin oranı. */
export const EDGE_BAND_RATIO = 0.22;
export const EDGE_BAND_MIN_PX = 120;
export const EDGE_BAND_MAX_PX = 280;

/** Jestin "yatay" sayılması için gereken asgari hareket (px). */
export const ENGAGE_PX = 14;

/** |dx| bu katsayıdan fazla |dy| ise yataydır. Ses jesti (dikey) ile ayrık tutar. */
export const HORIZONTAL_DOMINANCE = 1.6;

/** Park hâlinde sayfa değişimi için gereken yol (viewport genişliğinin oranı). */
export const COMMIT_RATIO_PARKED = 0.16;
/**
 * SÜRÜŞTE eşik belirgin biçimde yükselir. Ölçü değil, karar: gösterge ekranının
 * yanlışlıkla değişmesi sürüş sırasında kabul edilemez; kullanıcı sayfayı
 * değiştirmek istiyorsa bilinçli ve uzun bir hareket yapmalıdır.
 */
export const COMMIT_RATIO_DRIVING = 0.30;

/** Hızlı fırlatma (fling) eşiği (px/ms) — kısa ama kararlı hareketi kabul eder. */
export const FLING_VELOCITY_PX_PER_MS = 0.9;
/** Fling ile bile aşılması gereken asgari yol (px) — dokunma titremesi geçmesin. */
export const FLING_MIN_DISTANCE_PX = 60;

/* ══════════════════════════════════════════════════════════════════════════
 * Kenar bandı
 * ════════════════════════════════════════════════════════════════════════ */

/** HOME sağ kenar bandının genişliği (px), sınırlar içinde kırpılmış. */
export function edgeBandPx(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return EDGE_BAND_MIN_PX;
  const raw = viewportWidth * EDGE_BAND_RATIO;
  return Math.max(EDGE_BAND_MIN_PX, Math.min(EDGE_BAND_MAX_PX, raw));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Jest başlayabilir mi
 * ════════════════════════════════════════════════════════════════════════ */

export interface PageSwipeBeginInput {
  readonly page: CockpitPage;
  /** Dokunmanın başladığı X (px, viewport koordinatı). */
  readonly startX: number;
  readonly viewportWidth: number;
  /**
   * Üstte tam ekran bir yüzey var mı (harita · çekmece · geri vites · tiyatro ·
   * uyku). `true` ise jest HİÇ başlamaz — fail-closed.
   */
  readonly blocked: boolean;
}

export function canBeginPageSwipe(i: PageSwipeBeginInput): boolean {
  if (i.blocked) return false;
  if (!Number.isFinite(i.startX) || !Number.isFinite(i.viewportWidth)) return false;
  if (i.viewportWidth <= 0) return false;
  // Cockpit'te geri dönüş jesti her yerden başlayabilir (yatay içerik yok).
  if (i.page === 'cockpit') return true;
  // HOME'da yalnız sağ kenar bandı — iç yatay listeleri bozmamak için.
  return i.startX >= i.viewportWidth - edgeBandPx(i.viewportWidth);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Hareket sınıflandırma
 * ════════════════════════════════════════════════════════════════════════ */

export type PageDragVerdict =
  /** Henüz karar verilecek kadar hareket yok — dokunuş normal UI'a ait. */
  | 'pending'
  /** Yatay baskın ve DOĞRU yönde — sayfa jesti devreye girdi. */
  | 'engaged'
  /** Dikey baskın ya da ters yön — bu dokunuş sayfa jesti DEĞİLDİR. */
  | 'rejected';

export interface PageDragInput {
  readonly page: CockpitPage;
  readonly dx: number;
  readonly dy: number;
}

/**
 * HOME'dan Cockpit'e geçiş SOLA kaydırmadır (dx < 0); Cockpit'ten HOME'a dönüş
 * SAĞA kaydırmadır (dx > 0). Ters yön `rejected`tır — HOME'un solunda bir sayfa
 * YOKTUR ve "lastik" hissi taklit edilmez.
 */
export function classifyPageDrag(i: PageDragInput): PageDragVerdict {
  const { dx, dy, page } = i;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'rejected';
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < ENGAGE_PX && ay < ENGAGE_PX) return 'pending';
  // Dikey baskınsa bu bir ses/scroll jestidir — sayfa jesti DEĞİL.
  if (ax < ay * HORIZONTAL_DOMINANCE) return 'rejected';
  const wantedSign = page === 'home' ? -1 : 1;
  return Math.sign(dx) === wantedSign ? 'engaged' : 'rejected';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Bırakma kararı
 * ════════════════════════════════════════════════════════════════════════ */

export interface PageSwipeCommitInput {
  readonly page: CockpitPage;
  readonly dx: number;
  readonly viewportWidth: number;
  /** Sürüş hâlinde eşik yükselir (güvenlik). Bilinmiyorsa `true` verilmelidir. */
  readonly isDriving: boolean;
  /** Ortalama hız (px/ms); ölçülemiyorsa 0. */
  readonly velocityPxPerMs?: number;
}

export interface PageSwipeCommitResult {
  readonly committed: boolean;
  readonly target: CockpitPage;
  /** Bu hareketin eşiğe göre ilerlemesi (0–1) — animasyon geri bildirimi için. */
  readonly progress: number;
}

/** Sayfa değişimi için gereken yol (px). */
export function commitDistancePx(viewportWidth: number, isDriving: boolean): number {
  const ratio = isDriving ? COMMIT_RATIO_DRIVING : COMMIT_RATIO_PARKED;
  return Math.max(1, viewportWidth * ratio);
}

export function resolvePageSwipe(i: PageSwipeCommitInput): PageSwipeCommitResult {
  const other: CockpitPage = i.page === 'home' ? 'cockpit' : 'home';
  const verdict = classifyPageDrag({ page: i.page, dx: i.dx, dy: 0 });
  const need = commitDistancePx(i.viewportWidth, i.isDriving);
  const travelled = Math.abs(i.dx);
  const progress = Math.max(0, Math.min(1, travelled / need));

  if (verdict !== 'engaged') return { committed: false, target: i.page, progress: 0 };

  const v = Math.abs(i.velocityPxPerMs ?? 0);
  const fling = v >= FLING_VELOCITY_PX_PER_MS && travelled >= FLING_MIN_DISTANCE_PX;
  const committed = travelled >= need || fling;
  return { committed, target: committed ? other : i.page, progress };
}
