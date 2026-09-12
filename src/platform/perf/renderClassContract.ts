/**
 * renderClassContract — ARCH-06/F3 · UI GÜNCELLEME SINIFLARI (SAF METADATA).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **ZAMANLAYICI DEĞİLDİR.** Hiçbir render'ı planlamaz, geciktirmez,
 *     iptal etmez. Global UI scheduler F0'da AÇIKÇA yasaklandı: MapLibre
 *     kendi render loop'unun, React kendi reconciliation'ının sahibidir;
 *     üçüncü bir zamanlayıcı ikisiyle de yarışırdı.
 * (2) **KARAR VERMEZ.** Bir bileşenin ne zaman render olacağını söylemez.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── O HÂLDE NEDEN VAR ─────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bir ETİKETTİR ve iki işe yarar:
 *
 *  (a) **KANIT** — LAB'da "bu yüzey hangi sınıfta" görünür; düşük-uçta neyin
 *      feda edilebileceği tartışması somut bir listeye dayanır.
 *  (b) **REGRESYON KİLİDİ** — `LIVE_TELEMETRY` ya da `FRAME_CRITICAL` bir
 *      yüzey, seçicisiz bir mağaza aboneliğine kayarsa statik kilit bunu
 *      yakalar. Repo'nun dar-selector disiplini bugün güçlüdür; bu sözleşme
 *      onun sessizce bozulmasını engeller.
 */

/** F0 §C.7 sınıfları — genişletilmez. */
export type RenderClass =
  /** Dokunma geri bildirimi, sürükleme, geri-vites overlay. ASLA kısılmaz. */
  | 'FRAME_CRITICAL'
  /** Menü/geçiş, harita pan-zoom. Düşük-uçta animasyon süresi kısalır. */
  | 'INTERACTIVE'
  /** Hız/RPM göstergesi, HUD mesafesi. Alan yayın kadansında. */
  | 'LIVE_TELEMETRY'
  /** Liste/geçmiş/ayar. Olay tabanlı. */
  | 'SECONDARY'
  /** LAB grafiği, ambient. Baskıda DURUR. */
  | 'BACKGROUND_VISUAL';

export interface RenderSurfaceDescriptor {
  readonly surfaceId: string;
  readonly file: string;
  readonly renderClass: RenderClass;
  /** Bu yüzeyi besleyen en yüksek frekanslı kaynak. */
  readonly cadenceSource: string;
  /**
   * Seçicisiz mağaza aboneliğine İZİN VAR mı. Yüksek frekanslı yüzeylerde
   * DAİMA `false`: tek bir geniş abonelik, alakasız her yazımda tüm ağacı
   * geçersiz kılar.
   */
  readonly wholeStoreSubscriptionAllowed: boolean;
  readonly notes: string;
}

const D = (d: RenderSurfaceDescriptor): RenderSurfaceDescriptor => Object.freeze(d);

/**
 * YÜKSEK FREKANSLI HARİTA/NAVİGASYON YÜZEYLERİ.
 *
 * KAPSAM BİLİNÇLİ OLARAK DARDIR: tüm repoya kör bir regex politikası
 * uygulamak (F3 §26) yanlış alarm üretir ve gerçek riski gizler. Burada
 * yalnız GPS/rota kadansıyla beslenen yüzeyler bildirilir.
 */
const SURFACES: readonly RenderSurfaceDescriptor[] = Object.freeze([
  D({
    surfaceId: 'FullMapView', file: 'src/components/map/FullMapView.tsx',
    renderClass: 'FRAME_CRITICAL',
    cadenceSource: 'GPS fix (≤5 Hz) + kendi idle-uykulu rAF döngüsü',
    wholeStoreSubscriptionAllowed: false,
    notes: 'rAF sahibi KENDİSİDİR ve boşta UYUR; kamera/marker dedup’ı içeride.',
  }),
  D({
    surfaceId: 'NavigationHUD', file: 'src/components/map/NavigationHUD.tsx',
    renderClass: 'LIVE_TELEMETRY',
    cadenceSource: 'rota ilerlemesi + konum',
    wholeStoreSubscriptionAllowed: false,
    notes: 'Konum aboneliği alt bileşende ve alan-bazlı; ayar aboneliği ayrı alanlarda.',
  }),
  D({
    surfaceId: 'MiniMapWidget', file: 'src/components/map/MiniMapWidget.tsx',
    renderClass: 'LIVE_TELEMETRY',
    cadenceSource: 'GPS fix',
    wholeStoreSubscriptionAllowed: false,
    notes: 'FullMapView açıkken MOUNT EDİLMEZ (NewHomeLayout koşulu).',
  }),
  D({
    surfaceId: 'TrafficMapMini', file: 'src/components/traffic/TrafficMapMini.tsx',
    renderClass: 'SECONDARY',
    cadenceSource: 'trafik verisi (seyrek)',
    wholeStoreSubscriptionAllowed: false,
    notes: 'Yalnız trafik çekmecesi AÇIKKEN mount edilir (DrawerPanel koşulu, 2026-06-14 ölçülmüş düzeltme).',
  }),
]);

export interface RenderClassSnapshot {
  readonly surfaces: readonly RenderSurfaceDescriptor[];
  readonly byClass: Readonly<Record<RenderClass, number>>;
  readonly notes: readonly string[];
}

const CLASSES: readonly RenderClass[] = Object.freeze([
  'FRAME_CRITICAL', 'INTERACTIVE', 'LIVE_TELEMETRY', 'SECONDARY', 'BACKGROUND_VISUAL',
]);

/** Salt-okunur projeksiyon. */
export function getRenderClassContract(): RenderClassSnapshot {
  const byClass = {} as Record<RenderClass, number>;
  for (const c of CLASSES) byClass[c] = 0;
  for (const s of SURFACES) byClass[s.renderClass] += 1;
  return Object.freeze({
    surfaces: SURFACES,
    byClass: Object.freeze(byClass),
    notes: Object.freeze([
      'Bu bir ETİKETTİR, bir zamanlayıcı DEĞİL: hiçbir render planlanmaz/geciktirilmez.',
      'MapLibre render loop’unun ve React reconciliation’ının sahipliği DEĞİŞMEDİ.',
      'Kapsam DAR: yalnız GPS/rota kadansıyla beslenen yüzeyler. Kör repo-geneli politika YOK.',
    ]),
  });
}

/** Statik kilit testleri için kapalı liste. */
export function renderSurfaces(): readonly RenderSurfaceDescriptor[] { return SURFACES; }
