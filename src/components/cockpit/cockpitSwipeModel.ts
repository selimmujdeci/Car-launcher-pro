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
 *  2. Jest EKRANIN HER YERİNDEN başlayabilir — hem HOME'da hem Cockpit'te.
 *     (Önceki sürümde HOME'da yalnız sağ kenar bandı kabul ediliyordu; gerçek
 *     cihazda kullanıcı ekranın herhangi bir yerinden kaydırmayı BEKLİYOR —
 *     kenar kısıtı kaldırıldı.) HOME'un İÇİNDE gerçekten yatay kaydırılabilen
 *     kartlar (dock/carousel, `touch-action:pan-x`) bu jestin kurbanı OLMASIN
 *     diye kendilerini `data-no-page-swipe` ile İŞARETLER — dışlama DOM
 *     katmanındadır (`CockpitPager.isBlockedByDom`), bu SAF modülde değil.
 *  3. YÖN DAYATILMAZ: yatay baskın her iki yön de sayfa jestidir. Sayfanın
 *     hangi kenardan geleceği jestin yönünden TÜRETİLİR — bkz.
 *     {@link classifyPageDrag} ve {@link entrySideForDrag}.
 *  4. Harita/çekmece/geri vites gibi tam ekran yüzeyler açıkken jest HİÇ
 *     başlamaz (`blocked`) — karar çağırana aittir, bu model onu yalnız uygular.
 *
 * SAF: I/O YOK · DOM YOK · timer YOK · React YOK · global durum YOK.
 */

export type CockpitPage = 'home' | 'cockpit';

/* ══════════════════════════════════════════════════════════════════════════
 * Eşikler
 * ════════════════════════════════════════════════════════════════════════ */

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
 * 1) Jest başlayabilir mi
 * ════════════════════════════════════════════════════════════════════════ */

export interface PageSwipeBeginInput {
  /**
   * Üstte tam ekran bir yüzey var mı (harita · çekmece · geri vites · tiyatro ·
   * uyku). `true` ise jest HİÇ başlamaz — fail-closed.
   */
  readonly blocked: boolean;
}

/**
 * Jest ekranın HER YERİNDEN başlayabilir — tek koşul üstte bloklayan bir yüzey
 * olmaması. Belirli bir DOM bölgesinden (harita, form elemanı, gerçekten yatay
 * kaydırılabilen kart) başlamasını engellemek bu SAF modülün işi DEĞİLDİR;
 * o karar `CockpitPager.isBlockedByDom`dadır (gerçek DOM/CSS okur, burası okumaz).
 */
export function canBeginPageSwipe(i: PageSwipeBeginInput): boolean {
  return !i.blocked;
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
 * YÖN KISITI YOKTUR — yatay baskın HER hareket sayfa jestidir.
 *
 * ── NEDEN (saha dersi, iki tur yanlış tahmin) ─────────────────────────────
 * Önce "HOME'da SOLA kaydır" seçildi, kullanıcı açamadı; sonra "SAĞA kaydır"a
 * çevrildi, yine açamadı. Kök sorun yönün KENDİSİ değil, ÜRÜNÜN KULLANICIYA
 * BİR YÖN DAYATMASIYDI: tek komşu sayfası olan bir kabukta "yanlış yön"
 * diye bir şey YOKTUR — kullanıcı yatay kaydırdıysa niyeti bellidir.
 *
 * Bu yüzden her iki yatay yön de `engaged` sayılır; sayfanın HANGİ KENARDAN
 * geleceği jestin yönünden TÜRETİLİR (`entrySideForDrag`), böylece parmak
 * hangi yöne giderse sayfa o yönde akar — ters/"lastik" his oluşmaz.
 * Dikey baskın hareket hâlâ REDDEDİLİR (ses jesti · scroll dokunulmaz).
 */
export function classifyPageDrag(i: PageDragInput): PageDragVerdict {
  const { dx, dy } = i;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'rejected';
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < ENGAGE_PX && ay < ENGAGE_PX) return 'pending';
  // Dikey baskınsa bu bir ses/scroll jestidir — sayfa jesti DEĞİL.
  if (ax < ay * HORIZONTAL_DOMINANCE) return 'rejected';
  return 'engaged';
}

/** Kokpitin ekrana gireceği kenar. */
export type CockpitEntrySide = 'right' | 'left';

/**
 * Parmak SOLA giderse sayfa SAĞDAN girer; SAĞA giderse SOLDAN girer.
 * Yani içerik her zaman parmağın gittiği yöne akar (doğal sayfa hissi).
 */
export function entrySideForDrag(dx: number): CockpitEntrySide {
  return dx < 0 ? 'right' : 'left';
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
