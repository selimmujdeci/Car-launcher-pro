/**
 * hudPresentationModel — P0-NAV-04 · SÜRÜŞ HUD'UNUN SUNUM HÜKMÜ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ── BU MODÜLÜN YAPMADIĞI (pazarlıksız) ────────────────────────────────────
 * **Yeni navigasyon otoritesi DEĞİLDİR.** Mesafe, süre, hız, hız limiti, rota
 * hükmü, sapma kararı — hiçbirini HESAPLAMAZ. Yalnız mevcut otoritelerin
 * verdiği hükümleri alıp *"ekranda ne öne çıkacak"* sorusunu yanıtlar.
 *
 * Eşikler de İCAT EDİLMEZ: manevra yaklaşma bandı `cameraPolicyModel`in
 * `MANEUVER_BANDS`inden, kullanılabilir doğruluk sınırı `offRouteModel`in
 * `ACTIONABLE_ACCURACY_M`inden gelir. İkisi de zaten KARAR VEREN eşiklerdir;
 * HUD onlarla aynı gerçeği gösterir, kendi paralel eşiğini kurmaz.
 *
 * ── ÖLÇÜLEN KUSUR (gerçek cihaz kareleri, 2026-08-23) ─────────────────────
 * Sürüş ekranında bilgi hiyerarşisi YOKTU:
 *   · Manevra kartı ekranın üst ~%18'ini kaplıyor, içine `GPS ±2m` rozeti ve
 *     `27.3 KM` çipi BİNİYORDU (kod yorumunda 47×20 px örtüşme kaydı var).
 *   · Sağ üstte `AR` · `ONLINE` · `ANA EKRAN` üç kutu üst üste geliyordu.
 *   · Alt barda `YAKIT —` dekoratif boş alan olarak duruyordu.
 *   · Sağda zoom +/− sürüş boyunca sürekli görünüyordu (web haritası hissi).
 * Bu model o hiyerarşiyi tek yerde tanımlar.
 */

import { MANEUVER_BANDS } from './cameraPolicyModel';
import { ACTIONABLE_ACCURACY_M } from './offRouteModel';
import type { HonestyLevel } from './navigationHonestyModel';

export const HUD_PRESENTATION_VERSION = 'HUD-2026.08.23' as const;

/* ── Durumlar ─────────────────────────────────────────────────────────────── */

/**
 * HUD'un baskın durumu. **Tek bir durum kazanır** — iki uyarıyı aynı anda
 * bağırmak sürücüyü yavaşlatır; ikincil bilgiler `flags` ile taşınır.
 */
export type HudState =
  /** Rehberlik yok — sürüş yüzeyi çizilmez. */
  | 'OFF'
  /** Normal seyir. */
  | 'ACTIVE_NORMAL'
  /** Manevra yaklaşıyor — dönüş kartı büyür, çevre sakinleşir. */
  | 'MANEUVER_APPROACH'
  /** Hedefe varılıyor. */
  | 'ARRIVING'
  /** Yeniden rota hesaplanıyor. */
  | 'REROUTING'
  /** Konum güvenilmez — rehberlik iddiası zayıflar. */
  | 'GPS_DEGRADED'
  /** Rota doğrulamayı geçemedi / düz hat — sakin ama açık uyarı. */
  | 'ROUTE_DEGRADED'
  /** Hedefe VARILDI — yönlendirme biter, eski manevra EKRANDA KALMAZ. */
  | 'ARRIVED';

export const HUD_STATE_LABEL: Readonly<Record<HudState, string>> = {
  OFF:               'Rehberlik yok',
  ACTIVE_NORMAL:     'Seyir',
  MANEUVER_APPROACH: 'Manevra yaklaşıyor',
  ARRIVING:          'Varış yaklaşıyor',
  REROUTING:         'Rota yenileniyor',
  GPS_DEGRADED:      'Konum güvenilmez',
  ROUTE_DEGRADED:    'Rota kusurlu',
  ARRIVED:           'Varıldı',
};

/**
 * Durumun görsel tonu. **Alarm tonu yalnız gerçekten acil olanda** kullanılır;
 * dürüstlük uyarıları `NOTICE` tonundadır — görünür ama haritayı işgal etmez.
 */
export type HudTone = 'NEUTRAL' | 'FOCUS' | 'NOTICE' | 'ALERT';

export const HUD_TONE_OF: Readonly<Record<HudState, HudTone>> = {
  OFF:               'NEUTRAL',
  ACTIVE_NORMAL:     'NEUTRAL',
  MANEUVER_APPROACH: 'FOCUS',
  ARRIVING:          'FOCUS',
  REROUTING:         'NOTICE',
  GPS_DEGRADED:      'ALERT',
  ROUTE_DEGRADED:    'NOTICE',
  ARRIVED:           'NEUTRAL',
};

/* ── Yerleşim ─────────────────────────────────────────────────────────────── */

export type HudLayout =
  /** Tam ekran yatay — ana hedef. */
  | 'LANDSCAPE'
  /** Tam ekran dikey — yatayın sıkıştırılmışı DEĞİL, yeniden akış. */
  | 'PORTRAIT';

export interface HudPresentationInput {
  /** `NavStatus` — rehberlik yalnız `ACTIVE`/`REROUTING`te sürer. */
  readonly guidanceActive: boolean;
  readonly rerouting: boolean;
  /** Sonraki manevraya YOL-BOYU mesafe (m); `null` = bilinmiyor. */
  readonly distToTurnM: number | null;
  /** Mesafenin kaynağı — yol-boyu değilse manevra bandı UYGULANMAZ. */
  readonly maneuverDistanceSource: 'ALONG_ROUTE' | 'STRAIGHT_LINE' | 'UNKNOWN';
  /** Gösterilen manevra bir varış mı (`arrive`). */
  readonly arriveManeuver: boolean;
  /** GPS fix'i kullanılabilir mi (mevcut `gpsValid` kapısı). */
  readonly gpsUsable: boolean;
  /** Ölçülen yatay doğruluk (m); `null` = bildirilmedi. */
  readonly accuracyM: number | null;
  /** `navigationHonestyModel` hükmünün ağırlığı. */
  readonly honestyLevel: HonestyLevel;
  readonly layout: HudLayout;
  /** Gerçek şerit verisi var mı (`RouteStep.lanes`). */
  readonly hasLaneData: boolean;
  /** Gösterilecek bir SONRAKİ manevra var mı ("sonra …" ikincil satırı). */
  readonly hasNextManeuver: boolean;
  /* ── P0-NAV-17 · EKLENEN KAPILAR ─────────────────────────────────────────
   * ÖLÇÜLEN KUSUR: `showManeuver = state !== 'REROUTING'` idi — yani rehberlik
   * aktifken manevra kartı **gerçekten bir manevra OLUP OLMADIĞINA
   * BAKILMADAN** çiziliyordu. Modelin böyle bir girdisi bile YOKTU
   * (`hasNextManeuver` "sonra …" satırını yönetir, ŞU ANKİ manevrayı DEĞİL).
   * Adım listesi boşken (düz hat sentinel'i yazılmadan önce, 0 adımlı rota)
   * ekranda içeriksiz bir dönüş kartı kalabilirdi — NAV-17'nin
   * "rota yokken dönüş oku" maddesi tam olarak budur. */
  /** ŞU AN gösterilecek gerçek bir manevra var mı (talimatı dolu bir adım). */
  readonly hasManeuver: boolean;
  /**
   * Hedefe VARILDI mı. Varıştan sonra eski yönlendirme EKRANDA KALMAMALIDIR
   * (NAV-17: "arrival sonrası eski yönlendirme").
   */
  readonly arrived: boolean;
}

export interface HudPresentation {
  readonly version: string;
  readonly state: HudState;
  readonly tone: HudTone;
  readonly layout: HudLayout;

  /* ── Görünürlük sözleşmesi ── */
  /** Manevra kartı çizilsin mi. */
  readonly showManeuver: boolean;
  /** Manevra kartı BÜYÜK varyantta mı (yaklaşma/varış). */
  readonly maneuverEmphasis: boolean;
  /** İkincil "sonra …" satırı — dar alanda ve yaklaşmada GİZLENİR. */
  readonly showNextManeuver: boolean;
  /** Şerit rehberi — YALNIZ gerçek veri varsa ve yaklaşırken. */
  readonly showLaneGuidance: boolean;
  /** Hız kümesi. */
  readonly showSpeed: boolean;
  /** Yolculuk özeti (varış · kalan süre · kalan mesafe). */
  readonly showTrip: boolean;
  /** Durum şeridi (yeniden rota · konum · rota kusuru). `NEUTRAL`de çizilmez. */
  readonly showStatus: boolean;
  /** Sürüş kontrolleri — aktif rehberlikte zoom GİZLENİR. */
  readonly showZoomControls: boolean;

  /** Manevra kartının ekranı kaplama bütçesi (yükseklik oranı, gözlem/kilit). */
  readonly maneuverHeightBudget: number;
  /** Neden bu durum — LAB ve erişilebilirlik metni. */
  readonly reason: string;
}

/* ── Kurallar ─────────────────────────────────────────────────────────────── */

/**
 * Konum karar kalitesinde mi.
 *
 * Eşik İCAT EDİLMEZ: `ACTIONABLE_ACCURACY_M` sapma motorunun zaten "bu fix'le
 * karar verilir mi" sorusuna verdiği cevaptır. HUD aynı çizgiyi kullanır ki
 * ekran ile motor aynı gerçeği söylesin.
 */
export function isGpsDecisionGrade(gpsUsable: boolean, accuracyM: number | null): boolean {
  if (!gpsUsable) return false;
  if (accuracyM === null || !Number.isFinite(accuracyM)) return true;  // bildirilmedi → kapatma
  return accuracyM <= ACTIONABLE_ACCURACY_M;
}

/** Manevra bandı — `cameraPolicyModel` ile AYNI eşikler. */
function _approaching(distM: number | null, src: HudPresentationInput['maneuverDistanceSource']): boolean {
  if (src !== 'ALONG_ROUTE') return false;      // kuş uçuşu virajda kısa çıkar
  if (distM === null || !Number.isFinite(distM) || distM <= 0) return false;
  return distM <= MANEUVER_BANDS.APPROACH_M;
}

/**
 * HUD sunum hükmü.
 *
 * ── ÖNCELİK (tek durum kazanır) ───────────────────────────────────────────
 *   REROUTING > GPS_DEGRADED > ARRIVING > MANEUVER_APPROACH > ROUTE_DEGRADED
 *   > ACTIVE_NORMAL
 *
 * Gerekçe: yeniden rota sürerken gösterilen manevra ARTIK GEÇERSİZDİR — onu
 * vurgulamak yanlış yöne sürdürür. Konum güvenilmezken de manevra mesafesi
 * anlamını yitirir. Rota kusuru ise KALICI bir kalite hükmüdür; anlık bir
 * manevrayı bastırmaz, yalnız başka acil durum yokken görünür.
 */
export function resolveHudPresentation(input: HudPresentationInput): HudPresentation {
  const portrait = input.layout === 'PORTRAIT';

  if (!input.guidanceActive) {
    return {
      version: HUD_PRESENTATION_VERSION,
      state: 'OFF', tone: 'NEUTRAL', layout: input.layout,
      showManeuver: false, maneuverEmphasis: false, showNextManeuver: false,
      showLaneGuidance: false, showSpeed: false, showTrip: false,
      showStatus: false, showZoomControls: true,
      maneuverHeightBudget: 0,
      reason: 'rehberlik sürmüyor — sürüş yüzeyi çizilmez',
    };
  }

  const gpsOk = isGpsDecisionGrade(input.gpsUsable, input.accuracyM);
  const approaching = _approaching(input.distToTurnM, input.maneuverDistanceSource);
  const arriving = input.arriveManeuver && approaching;

  let state: HudState;
  let reason: string;
  /* VARIŞ her şeyin ÜSTÜNDEDİR: hedefe ulaşıldıysa eski manevra artık bir
     yönlendirme değil, ekranda unutulmuş bir kalıntıdır (NAV-17). */
  if (input.arrived) {
    state = 'ARRIVED';
    reason = 'hedefe varıldı — yönlendirme sona erdi';
  } else if (input.rerouting) {
    state = 'REROUTING';
    reason = 'yeni rota hesaplanıyor — gösterilen manevra artık geçersiz';
  } else if (!gpsOk) {
    state = 'GPS_DEGRADED';
    reason = input.gpsUsable
      ? `konum doğruluğu karar sınırının dışında (>${ACTIONABLE_ACCURACY_M} m)`
      : 'kullanılabilir konum yok';
  } else if (arriving) {
    state = 'ARRIVING';
    reason = 'hedefe varılıyor';
  } else if (approaching) {
    state = 'MANEUVER_APPROACH';
    reason = `manevraya ${MANEUVER_BANDS.APPROACH_M} m'den yakın`;
  } else if (input.honestyLevel === 'DEGRADED') {
    state = 'ROUTE_DEGRADED';
    reason = 'rota veya varış hükmü kusurlu — sakin uyarı';
  } else {
    state = 'ACTIVE_NORMAL';
    reason = 'seyir';
  }

  const emphasis = state === 'MANEUVER_APPROACH' || state === 'ARRIVING';

  /* Manevra kartı yeniden rota sırasında ÇİZİLMEZ: geçersiz bir dönüşü
     göstermek, hiç göstermemekten daha tehlikelidir.
     ── P0-NAV-17: VE gerçekten bir manevra YOKSA da çizilmez. Eskiden bu kapı
     YOKTU ve boş adım listesinde içeriksiz bir dönüş kartı kalabiliyordu.
     Varıştan sonra da çizilmez — yönlendirme bitmiştir. */
  const showManeuver = state !== 'REROUTING' && state !== 'ARRIVED' && input.hasManeuver;

  /* "Sonra …" satırı ikincildir: yaklaşırken ve dikeyde yer açmak için düşer. */
  const showNextManeuver = showManeuver && input.hasNextManeuver && !emphasis && !portrait;

  /* Şerit YALNIZ gerçek veri + yaklaşma. Manevra uzaktayken şerit göstermek
     erken ve gereksiz bilgidir; veri yokken göstermek UYDURMADIR. */
  const showLaneGuidance = showManeuver && input.hasLaneData && emphasis;

  return {
    version: HUD_PRESENTATION_VERSION,
    state,
    tone: HUD_TONE_OF[state],
    layout: input.layout,
    showManeuver,
    maneuverEmphasis: emphasis,
    showNextManeuver,
    showLaneGuidance,
    showSpeed: true,
    /* Varışta yolculuk özeti de düşer — "kalan 0 km" bir yönlendirme değildir. */
    showTrip: state !== 'ARRIVED',
    /* Durum şeridi yalnız söyleyecek bir şey varken. */
    showStatus: HUD_TONE_OF[state] !== 'NEUTRAL' && !emphasis,
    /* Aktif rehberlikte zoom kolonu GİZLENİR — kamera zaten hıza göre
       ölçekleniyor; sürekli görünen +/− web haritası hissidir. */
    showZoomControls: false,
    /* Kartın ekranı kaplama tavanı: yatayda dar, dikeyde biraz geniş. */
    maneuverHeightBudget: portrait ? (emphasis ? 0.20 : 0.16) : (emphasis ? 0.24 : 0.19),
    reason,
  };
}
