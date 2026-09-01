/**
 * navigationHonestyModel — P0-NAV-02 · SÜRÜŞ YÜZEYİNİN DÜRÜSTLÜK HÜKMÜ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 *
 * ── ÖLÇÜLEN KUSUR ─────────────────────────────────────────────────────────
 * Motor üç ayrı dürüstlük hükmü ÜRETİYOR ama sürüş ekranı hiçbirini
 * GÖSTERMİYORDU:
 *   · `NavigationState.distanceSource` — kütük #404: örneklerin **%38'i** kuş
 *     uçuşuydu ve kalan mesafe aynı yolculukta **69 kez ARTTI**; ekranda gerçek
 *     kalan mesafeyle aynı yazı tipi, aynı kesinlikle görünüyordu.
 *   · `EtaVerdict.state` — süre modeli yoksa ETA mesafe÷hız yedeğinden gelir.
 *   · `RouteValidationResult.verdict` — kütük #407: **399/399** örnekte
 *     `DEGRADED` ve kullanıcıya **HİÇ** gösterilmedi.
 * Ölçüm: bu alanları tüketen tek ürün yüzeyi `useNavSummary` (ev temaları) idi;
 * sürücünün gerçekten baktığı TAM EKRAN HUD hiçbirini almıyordu — ana ekran
 * widget'ı sürüş ekranından daha dürüsttü.
 *
 * ── BU MODÜLÜN YAPMADIĞI ──────────────────────────────────────────────────
 * **Yeni sayı ÜRETMEZ.** Mesafe, süre, hız veya eşik HESAPLAMAZ. Yalnız mevcut
 * otoritelerin ZATEN verdiği hükümleri gösterime çevirir. Yeni eşik icat
 * edilmedi; her dal doğrudan bir otorite değerine bağlıdır.
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * Bilinmeyen KESİN sayılmaz. `distanceSource` yoksa mesafe **yaklaşık**
 * işaretlenir; ETA hükmü `UNKNOWN` ise sayı **güvenilir sayılmaz**; rota
 * doğrulaması yoksa **doğrulanmadı** yazılır. Sessiz geçmek, kanıtsız kesinlik
 * iddia etmek olurdu.
 */

import type { EtaState } from './etaModel';
import type { RouteDurationSource } from './routeDurationModel';
import type { RouteVerdict } from './routeValidationModel';

/** Kalan mesafenin nasıl bulunduğu — `navigationService.NavigationState` ile aynı sözlük. */
export type HonestyDistanceSource = 'ALONG_ROUTE' | 'STRAIGHT_LINE';

/** Şeridin toplu ağırlığı. `CLEAN` → hiçbir şey çizilmez (ekran bütçesi). */
export type HonestyLevel = 'CLEAN' | 'CAUTION' | 'DEGRADED';

export type HonestyChipId = 'distance' | 'eta' | 'route';

export interface HonestyChip {
  readonly id: HonestyChipId;
  /** Kısa etiket — sürüşte bir saniyede okunmalı. */
  readonly label: string;
  /** Tek cümlelik gerekçe (erişilebilirlik metni / LAB). */
  readonly detail: string;
  readonly level: Exclude<HonestyLevel, 'CLEAN'>;
}

export interface NavigationHonestyInput {
  /**
   * Sayılar ekranda GÖSTERİLİYOR mu (rehberlik veya önizleme).
   * `false` → hüküm üretilmez; gösterilmeyen sayı için uyarı çizmek gürültüdür.
   */
  readonly numbersVisible: boolean;
  /** `NavigationState.distanceSource`; okunmadıysa `null`. */
  readonly distanceSource: HonestyDistanceSource | null;
  /** `EtaVerdict.state`. */
  readonly etaState: EtaState;
  /** `EtaVerdict.source` — düz hat, OSRM gibi sunulamaz. */
  readonly etaSource: RouteDurationSource;
  /** `RouteState.validation?.verdict`; doğrulama hiç yapılmadıysa `UNKNOWN`. */
  readonly routeVerdict: RouteVerdict;
}

export interface NavigationHonestyVerdict {
  readonly level: HonestyLevel;
  /** Kalan mesafe `~` ile sunulmalı mı. */
  readonly distanceApproximate: boolean;
  /** ETA `~` ile sunulmalı mı. */
  readonly etaApproximate: boolean;
  /**
   * ETA sayısı gösterilebilir mi. `false` → motor zaten sayı ÜRETMEZ
   * (`INSUFFICIENT_ROUTE_DATA` / `STALE` / `UNKNOWN`); yüzey de kesinlik
   * iddia etmemelidir.
   */
  readonly etaTrustworthy: boolean;
  readonly chips: readonly HonestyChip[];
  /** Şerit çizilsin mi — `chips.length > 0` ile eşdeğer, çağıran için hazır. */
  readonly visible: boolean;
}

/** Hiçbir iddia taşımayan hüküm — sayı gösterilmiyorken kullanılır. */
export const HONEST_SILENT: NavigationHonestyVerdict = {
  level: 'CLEAN',
  distanceApproximate: false,
  etaApproximate: false,
  etaTrustworthy: false,
  chips: [],
  visible: false,
};

/* ── Değerlendirme ────────────────────────────────────────────────────────── */

function _distanceChip(src: HonestyDistanceSource | null): HonestyChip | null {
  if (src === 'ALONG_ROUTE') return null;
  if (src === 'STRAIGHT_LINE') {
    return {
      id: 'distance',
      label: 'MESAFE KUŞ UÇUŞU',
      detail: 'Kalan mesafe rota boyu değil, hedefe düz çizgi. Yol dönerken ARTABİLİR.',
      level: 'DEGRADED',
    };
  }
  /* FAIL-CLOSED: kaynak bilinmiyorsa rota boyu VARSAYILMAZ. */
  return {
    id: 'distance',
    label: 'MESAFE DOĞRULANMADI',
    detail: 'Kalan mesafenin nasıl hesaplandığı bildirilmedi — kesin kabul edilmez.',
    level: 'CAUTION',
  };
}

function _etaChip(state: EtaState, source: RouteDurationSource): HonestyChip | null {
  switch (state) {
    case 'ROUTE_MODEL':
      return null;
    case 'DEGRADED_FALLBACK':
      return {
        id: 'eta',
        label: 'VARIŞ TAHMİNİ ZAYIF',
        detail: `Süre modeli kullanılamadı (${source}); varış mesafe bölü hız yedeğinden hesaplandı.`,
        level: 'DEGRADED',
      };
    case 'STALE':
      return {
        id: 'eta',
        label: 'VARIŞ BAYAT',
        detail: 'Süre verisi başka bir rota sürümüne ait — yeni hesap gelene kadar sayı üretilmez.',
        level: 'DEGRADED',
      };
    case 'INSUFFICIENT_ROUTE_DATA':
      return {
        id: 'eta',
        label: 'VARIŞ HESAPLANAMIYOR',
        detail: 'Ne süre ne kullanılabilir mesafe var — varış saati UYDURULMAZ.',
        level: 'DEGRADED',
      };
    case 'UNKNOWN':
    default:
      return {
        id: 'eta',
        label: 'VARIŞ DOĞRULANMADI',
        detail: 'Varış tahmini henüz değerlendirilmedi.',
        level: 'CAUTION',
      };
  }
}

function _routeChip(v: RouteVerdict): HonestyChip | null {
  switch (v) {
    case 'VALID':
      return null;
    case 'DEGRADED':
      return {
        id: 'route',
        label: 'ROTA KUSURLU',
        detail: 'Rota doğrulama kapısından uyarıyla geçti (uygulandı). Dönüşler beklenmedik olabilir.',
        level: 'DEGRADED',
      };
    case 'REJECTED':
      return {
        id: 'route',
        label: 'ROTA REDDEDİLDİ',
        detail: 'Bu rota doğrulama kapısını geçemedi — rehberlik güvenilmez.',
        level: 'DEGRADED',
      };
    case 'UNKNOWN':
    default:
      return {
        id: 'route',
        label: 'ROTA DOĞRULANMADI',
        detail: 'Rota doğrulama hükmü yok — geçerliliği ÖLÇÜLMEDİ.',
        level: 'CAUTION',
      };
  }
}

/** ETA sayısı hangi hâllerde gösterilebilir — motorun kendi sözleşmesiyle birebir. */
function _etaTrustworthy(state: EtaState): boolean {
  return state === 'ROUTE_MODEL' || state === 'DEGRADED_FALLBACK';
}

/**
 * Mevcut otorite hükümlerini tek gösterim hükmüne çevirir.
 *
 * Hiçbir yeni sayı/eşik üretmez; her dal bir otorite değerine birebir bağlıdır.
 */
export function evaluateNavigationHonesty(
  input: NavigationHonestyInput,
): NavigationHonestyVerdict {
  if (!input.numbersVisible) return HONEST_SILENT;

  const chips: HonestyChip[] = [];
  const d = _distanceChip(input.distanceSource);
  const e = _etaChip(input.etaState, input.etaSource);
  const r = _routeChip(input.routeVerdict);
  if (d !== null) chips.push(d);
  if (e !== null) chips.push(e);
  if (r !== null) chips.push(r);

  const level: HonestyLevel = chips.length === 0
    ? 'CLEAN'
    : chips.some((c) => c.level === 'DEGRADED') ? 'DEGRADED' : 'CAUTION';

  return {
    level,
    /* Yalnız `ALONG_ROUTE` kesindir; bilinmeyen de yaklaşıktır (fail-closed). */
    distanceApproximate: input.distanceSource !== 'ALONG_ROUTE',
    etaApproximate: input.etaState !== 'ROUTE_MODEL',
    etaTrustworthy: _etaTrustworthy(input.etaState),
    chips,
    visible: chips.length > 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   P0-NAV-14 · ETA GÖSTERİM KARARI — TEK KURAL, TÜM YÜZEYLER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ── NEDEN VAR (ölçüm 2026-08-24, koddan) ──────────────────────────────────
 * ETA **TEK yerde HESAPLANIYOR** (`etaModel` → `navigationService`) ve bu
 * doğruydu. Ama **DÖRT yüzeyde FARKLI güven kuralıyla GÖSTERİLİYORDU**:
 *
 *   · `TripSummary`     → `honesty.etaTrustworthy` KONTROL EDER ✔
 *   · `SplitScreen`     → `nav.etaSeconds ?? route.totalDurationSeconds` ✘
 *   · `MiniMapWidget`   → `formatEta(etaSeconds)` — kapı YOK ✘
 *   · `HorizonLayout`   → süre + varış saati — kapı YOK ✘
 *
 * Yani motor "bu ETA'ya GÜVENME" dediğinde (bayat süre revizyonu · düz hat ·
 * yetersiz rota verisi) üç yüzey yine de bir SAYI gösteriyordu; `SplitScreen`
 * ayrıca sağlayıcının ham toplam süresini ETA gibi sunuyordu. Bu, deponun
 * tekrar eden **"iki yüzey ayrışması"** kusurudur (#332 · #547 · P0-NAV-06/1).
 *
 * Bu fonksiyon o kuralı TEK yere alır. Yeni sayı ÜRETMEZ, eşik KOYMAZ —
 * yalnız "bu sayı gösterilebilir mi" sorusunu motorun kendi sözleşmesiyle
 * yanıtlar.
 */
export interface EtaDisplayDecision {
  /** Sayı gösterilebilir mi. `false` → yüzey `—` basmalıdır. */
  readonly showNumber: boolean;
  /** Gösterilecek saniye. `showNumber === false` iken `null`. */
  readonly seconds: number | null;
  /** Sayı gösteriliyor ama YAKLAŞIK mı (yüzey `~` işareti koyabilir). */
  readonly approximate: boolean;
  /** Kısa gerekçe — LAB ve teşhis için. */
  readonly reason: string;
}

const _ETA_SILENT = (reason: string): EtaDisplayDecision =>
  ({ showNumber: false, seconds: null, approximate: false, reason });

/**
 * ETA gösterim kararı. **SAF.**
 *
 * `etaSeconds` motorun ÜRETTİĞİ değerdir; `etaState` motorun HÜKMÜDÜR.
 * Sağlayıcının ham toplam süresi buraya GİRMEZ — o bir ETA değildir, bir
 * ROTA ÖZELLİĞİDİR ve yerine geçirmek sürücüye yalan söylemektir.
 */
export function decideEtaDisplay(
  etaSeconds: number | null | undefined,
  etaState: EtaState,
): EtaDisplayDecision {
  if (!_etaTrustworthy(etaState)) {
    return _ETA_SILENT(`ETA durumu ${etaState} — motor bu sayıya güvenmiyor`);
  }
  if (typeof etaSeconds !== 'number' || !Number.isFinite(etaSeconds) || etaSeconds <= 0) {
    /* Sıfır/negatif ETA bir varış iddiası DEĞİLDİR — ölçüm yokluğudur. */
    return _ETA_SILENT('ETA sayısı üretilmedi');
  }
  return {
    showNumber: true,
    seconds: etaSeconds,
    /* Yalnız `ROUTE_MODEL` kesindir; `DEGRADED_FALLBACK` gösterilebilir ama
       YAKLAŞIKTIR ve yüzey bunu belli etmelidir. */
    approximate: etaState !== 'ROUTE_MODEL',
    reason: etaState === 'ROUTE_MODEL' ? 'rota süre modeli' : 'yedek tahmin (yaklaşık)',
  };
}
