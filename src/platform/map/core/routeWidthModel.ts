/**
 * routeWidthModel.ts — rota çizgisi kalınlığının TEK KANONİK POLİTİKASI (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · harita API'si YOK · React YOK ·
 * global durum YOK. Ölçüler DIŞARIDAN gelir → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR: DÖRT AYRI KALINLIK OTORİTESİ ───────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Rota beş katmandan oluşur (alttan üste): SHADOW · GLOW · CASE · CORE · FLOW.
 * Bugün kalınlıklarını DÖRT bağımsız yer yazıyor ve hiçbiri diğerini bilmiyor:
 *
 *   1. KURULUM (`MapLayerManager.setRouteGeometry`) — z12/z18 ara değerli:
 *        shadow 8→22 · glow 10→24 · case 6→14 · core 4→10 · flow 4→14
 *   2. PERSPEKTİF DÜZELTMESİ (`MapInteractionManager.setDrivingView`) —
 *        YALNIZ core ve case'i, TAMAMEN BAŞKA sayılarla ezer:
 *        core 8→32 · case 14→38 (× perspektif ölçeği)
 *   3. NEFES ALAN GLOW (`MapLayerManager._applyBreathingGlow`) — glow'un
 *        zoom ifadesini bir SKALER ile değiştirir (10–34 px, zoom'dan kopar).
 *   4. SHADOW ve FLOW kalınlığını kurulumdan sonra HİÇBİR ŞEY güncellemez.
 *
 * ── SONUÇ 1: KATMAN SIRASI TERSİNE DÖNÜYOR ────────────────────────────────
 * Sürüş görünümü açılır açılmaz (2) devreye girer — `perspScale` kapısı 0.06
 * olduğu ve durağan pitch bile 20° olduğu için İLK karede tetiklenir. z18'de
 * ölçülen sonuç (pitch 40, perspektif 1.222):
 *        CASE 46 · CORE 39 · GLOW 24 · SHADOW 22 · FLOW 14
 * CASE, GLOW ve SHADOW'un ÜSTÜNE çizildiği için (katman sırası) ve onlardan
 * ~2× geniş olduğu için **neon halo ve derinlik gölgesi tamamen kaybolur**.
 * İki `line-blur` katmanı GPU'ya yük bindirip EKRANA HİÇBİR ŞEY çizmez.
 * `_applyBreathingGlow`in ürettiği güvenlik sinyali (risk arttıkça nefes alan
 * halo) de aynı nedenle **sürüş sırasında görünmez**.
 *
 * ── SONUÇ 2: NAVİGASYON BAŞLAYINCA ROTA 3,2× KALINLAŞIYOR ─────────────────
 * Önizlemede core z18 = 10 px (kurulum, "Google Maps tarzı — ince ve net"),
 * sürüş başlayınca 32 px. Aynı rota, aynı zoom, iki farklı görünüm.
 *
 * ── SONUÇ 3: EKRAN GENİŞLİĞİ HİÇ HESABA KATILMIYOR ────────────────────────
 * Kalınlıklar CSS pikselinde SABİTTİR. Aynı 39 px'lik çekirdek:
 *        360 px dikey telefon → viewport'un **%10,8'i**
 *        904 px yatay telefon → **%4,3**
 *      1024 px head unit      → **%3,8**
 *     1280 px tablet          → **%3,0**
 * Yani dar ekranda rota, tablete göre **3,6× daha ağır** duruyor.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── POLİTİKA ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *  · TEK geometrik kaynak: ÇEKİRDEK genişliği. Diğer dört katman ondan
 *    ORANLA türer → sıra tersine dönmesi YAPISAL olarak imkânsızdır.
 *  · Referans viewport, sahada ayarlanmış head unit'tir (1024×600 → vmin 600)
 *    ve orada çekirdek ile kılıf BUGÜNKÜ sürüş değerlerinde KALIR (32/38 @ z18)
 *    → birincil hedef donanımda sürücünün gördüğü iki katman DEĞİŞMEZ.
 *  · Ölçek `vmin` tabanlıdır — bu üründe zaten doğrulanmış desendir
 *    (`SpeedLimitCard` çapı `clamp(min, vmin, max)`).
 *  · Ölçüm HARİTA CANVAS'INDAN alınır, pencereden değil: mini harita ile tam
 *    ekran farklı yüzeylerdir ve rota ikisinde aynı görsel ağırlığa ancak
 *    böyle sahip olur. Ölçülemezse referans varsayılır (fail-soft — bugünkü
 *    görünüm), SAHTE değer üretilmez.
 */

/** Politika sürümü — herhangi bir sayı değişince yükselir, LAB'da görünür. */
export const ROUTE_WIDTH_POLICY_VERSION = 'RW-2026.08.13' as const;

/**
 * Referans viewport'un kısa kenarı (CSS px).
 *
 * 1024×600 head unit → `vmin = 600`. Seçim keyfî değildir: mevcut kalınlıklar
 * bu donanımda ayarlandı, dolayısıyla ölçeğin 1,0 olduğu nokta burasıdır ve
 * birincil hedefte görünüm değişmez.
 */
export const ROUTE_WIDTH_REF_VMIN = 600;

/**
 * Ölçek tabanı — dar ekranda rota GEREĞİNDEN FAZLA İNCELMEZ.
 *
 * 360 px dikey telefonda ham oran 360/600 = 0,60 olurdu; çekirdek 19 px'e
 * inerdi. Taban 0,72'de tutulur (çekirdek ≈ 23 px): altındaki değerler
 * kılıf/çekirdek ayrımını ve akış izini görsel olarak yok eder — çizgi tek
 * renkli bir tel hâline gelir ve yön okunmaz olur.
 */
export const ROUTE_WIDTH_SCALE_MIN = 0.72;

/**
 * Ölçek tavanı — büyük ekranda rota GEREKSİZ KALINLAŞMAZ.
 *
 * 1280×800 tablette ham oran 800/600 = 1,33 olurdu; çekirdek 43 px'e çıkar ve
 * kavşak geometrisini kapatırdı. Tavan 1,15 (çekirdek ≈ 37 px).
 */
export const ROUTE_WIDTH_SCALE_MAX = 1.15;

/** Perspektif ölçeği için güvenli bant — bozuk pitch girdisi kalınlığı patlatmasın. */
export const ROUTE_PERSPECTIVE_MIN = 1.0;
export const ROUTE_PERSPECTIVE_MAX = 1.5;

/**
 * ÇEKİRDEK genişliği (referans viewport · perspektif 1,0).
 *
 * ── 2026-08-13: AÇIK BORÇ KAPANDI — MUTLAK SEVİYE İNCELTİLDİ ───────────────
 * Bu dosya kurulduğunda (RW-2026.08.07) kalınlığın MUTLAK seviyesi bilerek
 * TARTIŞILMAMIŞTI: o tur yalnız dört ayrı otoriteyi teke indirdi ve
 * *"önizlemedeki 10 px mi, sürüşteki 32 px mi doğru?"* sorusunu **açık borç**
 * olarak bıraktı. Sahibi bu turda kararı verdi: **çizgi çok kalın, inceltilecek.**
 *
 * Ölçü (neden 32 → 22): kullanıcının kullandığı telefonda harita yüzeyi
 * ~415 px kısa kenardır → ölçek tabana oturur (0,72) ve sürüş perspektifiyle
 * (~1,22) çekirdek fiilen **~28 px**, yani kısa kenarın **%6,8'i** olur.
 * 22'de aynı yüzeyde **~19 px / %4,7**'ye iner — referans OEM navigasyonların
 * bandına (~%2–3) yaklaşır ama altına inmez.
 *
 * ── NEDEN DAHA FAZLA İNCELMEDİ (taban gerekçesi) ──────────────────────────
 * Kılıf çekirdekten `RATIO.casing` (1,19) kadar geniştir; okunur bir dış hat
 * için aradaki farkın EN DAR ekranda bile ~3 px kalması gerekir:
 *     (çekirdek × 0,72) × 0,19 ≥ 3  →  çekirdek ≥ ~22
 * Bunun altında kılıf/çekirdek ayrımı dar ekranda kaybolur ve çizgi tek renkli
 * bir tele döner (bu dosyanın `ROUTE_WIDTH_SCALE_MIN` gerekçesiyle aynı kaygı).
 * Yani 22 keyfî değil, **ayrımın korunduğu en ince değerdir**.
 *
 * ── z12 NEDEN İNCELMEDİ (kilit yakaladı, ölçüldü) ─────────────────────────
 * İlk denememde z12/z18 oranını koruyup z12'yi de 8 → 5,5 yapmıştım. Katman
 * sırası kilidi bunu ANINDA düşürdü: 360 px ekranda (ölçek 0,72) çekirdek
 * z12 = 4 px'e iner ve yarım-piksel yuvarlamada kılıf ile gölge ÇAKIŞIR
 * (ikisi de 5 px) → gölge kaybolur.
 *
 * Sebep, oranların en DAR aralığıdır: gölge − kılıf = çekirdek × 0,09.
 * Bunun 0,5 px'lik yuvarlama adımını aşması için en dar ekranda
 *     çekirdek_z12 × 0,72 × 0,09 ≥ 0,5  →  çekirdek_z12 ≥ ~7,7
 * gerekir. Yani **8 keyfî değil, z12 ucunun matematiksel tabanıdır** ve
 * dokunulmadı. Zaten şikâyet uzak zoom'da değil, SÜRÜŞ görünümündeydi (z18).
 * Sonuç: eğri 8 → 22 olur; uzakta bugünkü gibi, yakında belirgin daha ince.
 *
 * 🔴 Bu bir GÖRSEL tercih kararıdır; cihazda (özellikle K24 head unit'te ve
 * gündüz güneşinde) doğrulanması gerekir — kütükte 🔴 madde olarak duruyor.
 */
const CORE_Z12 = 8;
const CORE_Z18 = 22;

/**
 * Katman çarpanları — hepsi ÇEKİRDEĞE göre.
 *
 * Sıralama pazarlıksızdır: `glow > shadow > casing > core > flow`. Katman
 * yığını alttan üste SHADOW · GLOW · CASE · CORE · FLOW olduğu için, üstteki
 * bir katman alttakinden GENİŞ olursa alttaki tamamen kaybolur — bugünkü
 * kusurun kökü budur.
 *
 *  · `casing` 1.19 = 38/32 → head unit'te BUGÜNKÜ kılıf genişliği (değişmez).
 *  · `shadow` 1.28 → kılıfın 4-5 px dışına taşar; `line-offset` + `line-blur`
 *    ile derinlik hissi verir (bugün kılıfın ALTINDA kalıp kayboluyordu).
 *  · `glow`   1.42 → en dış katman; nefes alan güvenlik halosu ancak kılıfın
 *    dışına taştığında GÖRÜNÜR olur.
 *  · `flow`   0.44 = 14/32 → bugünkü göreli görünüm; akış izi çekirdeğin
 *    İÇİNDE ince bir ışık şerididir.
 */
const RATIO = {
  casing: 1.19,
  shadow: 1.28,
  glow:   1.42,
  flow:   0.44,
} as const;

/**
 * Nefes alan glow'un çarpan bandı.
 *
 * TABAN TÜRETİLMİŞTİR, seçilmiş değildir: halonun görünür kalması için nefesin
 * EN DAR anında bile kılıfın dışında olması gerekir, yani çarpan
 * `casing/glow = 1.19 / 1.42 = 0.838`'in ALTINA inemez. 0.88, bunun üstünde
 * ~%5'lik bir emniyet payı bırakır. (İlk uygulamamda taban 0.60'tı ve nefesin
 * dip noktasında halo yine kılıfın altına düşüyordu — kilit testi yakaladı.)
 */
export const BREATH_MIN_FACTOR = 0.88;
/** Tavan: dip ile simetriye yakın, ama halo kavşağı boğmasın. */
export const BREATH_MAX_FACTOR = 1.40;

/** Tek bir katmanın zoom uç değerleri (CSS px). */
export interface RouteLayerWidth {
  readonly z12: number;
  readonly z18: number;
}

export interface RouteWidths {
  /** Uygulanan viewport ölçeği — gözlem için (1,0 = referans head unit). */
  readonly scale: number;
  /** Ölçüm alınamadı mı — `true` ise referans varsayıldı (sahte değer YOK). */
  readonly measured: boolean;
  readonly core:   RouteLayerWidth;
  readonly casing: RouteLayerWidth;
  readonly shadow: RouteLayerWidth;
  readonly glow:   RouteLayerWidth;
  readonly flow:   RouteLayerWidth;
  readonly policyVersion: string;
}

export interface RouteWidthInput {
  /**
   * Harita CANVAS'ının kısa kenarı (CSS px) — pencere değil.
   * 0 / geçersiz → ölçüm yok sayılır ve referans kullanılır.
   */
  readonly canvasMinPx: number;
  /** Pitch'ten türeyen perspektif düzeltmesi; 1,0 = düz kamera. */
  readonly perspectiveScale?: number;
}

function _clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Yarım piksel adımına yuvarla — 1 px'lik kaba basamaklanma olmasın. */
function _round(v: number): number {
  return Math.round(v * 2) / 2;
}

/**
 * Viewport ölçeği — kısa kenardan, tabanlı ve tavanlı.
 *
 * Ölçülemeyen girdi 1,0 döndürür: bilinmeyen ekranı küçük saymak head unit'te
 * sebepsiz incelme demektir.
 */
export function resolveRouteWidthScale(canvasMinPx: number): number {
  if (!Number.isFinite(canvasMinPx) || canvasMinPx <= 0) return 1;
  return _clamp(
    canvasMinPx / ROUTE_WIDTH_REF_VMIN,
    ROUTE_WIDTH_SCALE_MIN,
    ROUTE_WIDTH_SCALE_MAX,
  );
}

/**
 * Beş katmanın kalınlığını TEK çekirdekten türet.
 *
 * Çağıran her karede çağırabilir; fonksiyon SAFtır ve durum tutmaz.
 */
export function computeRouteWidths(input: RouteWidthInput): RouteWidths {
  const measured = Number.isFinite(input.canvasMinPx) && input.canvasMinPx > 0;
  const scale = resolveRouteWidthScale(input.canvasMinPx);
  const persp = _clamp(
    Number.isFinite(input.perspectiveScale ?? NaN) ? (input.perspectiveScale as number) : 1,
    ROUTE_PERSPECTIVE_MIN,
    ROUTE_PERSPECTIVE_MAX,
  );

  const k = scale * persp;
  const core: RouteLayerWidth = { z12: _round(CORE_Z12 * k), z18: _round(CORE_Z18 * k) };
  const derive = (r: number): RouteLayerWidth => ({
    z12: _round(core.z12 * r),
    z18: _round(core.z18 * r),
  });

  return {
    scale: Number(scale.toFixed(3)),
    measured,
    core,
    casing: derive(RATIO.casing),
    shadow: derive(RATIO.shadow),
    glow:   derive(RATIO.glow),
    flow:   derive(RATIO.flow),
    policyVersion: ROUTE_WIDTH_POLICY_VERSION,
  };
}

/** MapLibre `line-width` ara değer ifadesi — tek yerde üretilir. */
export function routeWidthExpression(w: RouteLayerWidth):
  ['interpolate', ['linear'], ['zoom'], 12, number, 18, number] {
  return ['interpolate', ['linear'], ['zoom'], 12, w.z12, 18, w.z18];
}

/**
 * Nefes alan glow'un ANLIK genişliği (px).
 *
 * Eskiden sabit bir skalerdi (`max(10, 22 + nefes*12*risk)`) ve glow'un zoom
 * ara değerini SİLİYORDU; hem zoom'dan kopuyor hem de kılıfın altında kalıp
 * görünmez oluyordu. Artık politikanın ürettiği glow genişliği MODÜLE edilir:
 * taban korunur, nefes yalnız genlik ekler → halo her zaman kılıfın dışındadır.
 *
 * @param glowZ18   politikadan gelen glow genişliği (z18)
 * @param breath    −1..+1 arası nefes fazı
 * @param amplitude 0..~1,4 — risk ve bilişsel moddan gelen genlik çarpanı
 */
export function breathingGlowWidth(
  glowZ18: number, breath: number, amplitude: number,
): number {
  const base = Number.isFinite(glowZ18) && glowZ18 > 0 ? glowZ18 : 0;
  const b    = Number.isFinite(breath) ? _clamp(breath, -1, 1) : 0;
  const a    = Number.isFinite(amplitude) ? Math.max(0, amplitude) : 0;
  /* Genlik tabanın %26'sı: eskiden ±12 px SABİTTİ ve dar ekranda çizginin
     kendisinden büyük olabiliyordu. Oran hâline gelince her ekranda aynı
     görsel nefes derinliği elde edilir. */
  return base * _clamp(1 + b * 0.26 * a, BREATH_MIN_FACTOR, BREATH_MAX_FACTOR);
}
