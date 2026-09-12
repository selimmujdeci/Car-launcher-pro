/**
 * speedLimitTruthModel.ts — hız limiti DÜRÜSTLÜK sınıflandırıcısı (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · ağ YOK.
 * Saat ve konum DIŞARIDAN gelir → testler deterministiktir.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `speedLimitService` bir DEĞER üretir ama o değerin **hâlâ geçerli olup
 * olmadığını** söylemez. Ölçülen iki somut tehlike:
 *
 *  1. **Bayat limit.** Hook yeni yola geçildiğinde `hasLimitRef`i sıfırlıyor
 *     ama `limit` state'ini TEMİZLEMİYOR → yeni yolun cevabı gelene kadar
 *     ÖNCEKİ YOLUN levhası ekranda kalmaya devam ediyordu. Sürücü 90'lık bir
 *     yoldan 50'lik sokağa girince ekranda hâlâ 90 görüyordu.
 *  2. **Çıkarım levha gibi görünüyor.** Servis `source: 'inferred'` (yol
 *     SINIFINDAN tahmin: `residential → 50`, `motorway → 120`) da üretebiliyor.
 *     Bu bir TAHMİNDİR, okunmuş levha değildir.
 *
 * Bu model ikisini de ayırt eder ve karar verme sorumluluğunu tek yere toplar.
 * Yeni veri kaynağı KURMAZ — yalnız var olanı sınıflandırır.
 */

/** Limitin gösterime uygunluk durumu. */
export type SpeedLimitState =
  /** Gerçek, taze ve aracın bulunduğu yola ait → GÖSTERİLEBİLİR. */
  | 'AVAILABLE'
  /** Değer var ama artık güvenilmez (yaşlı veya araç başka yola geçti) → GİZLE. */
  | 'STALE'
  /** Kaynak cevap verdi ama limit yok / çıkarım reddedildi → GİZLE. */
  | 'UNAVAILABLE'
  /** Aynı konum için çelişen değerler → GİZLE (yanlış sayı göstermektense hiç gösterme). */
  | 'CONFLICTED'
  /** Henüz hiç sorulmadı / kaynak bilinmiyor → GİZLE. */
  | 'UNKNOWN';

/** Sınıflandırıcıya verilen ham gözlem. */
export interface SpeedLimitObservation {
  /** km/h — kaynak hiç cevap vermediyse `null`. */
  readonly kmh: number | null;
  /** `'osm'` = yolun `maxspeed` etiketi (levha karşılığı) · `'inferred'` = yol sınıfından TAHMİN. */
  readonly source: 'osm' | 'inferred' | null;
  /** Değerin çözüldüğü an (monotonik ms) — `null` = hiç çözülmedi. */
  readonly resolvedAtMs: number | null;
  /** Değerin çözüldüğü konum — araç oradan uzaklaştıysa limit o yola ait DEĞİLDİR. */
  readonly resolvedAtLat: number | null;
  readonly resolvedAtLon: number | null;
  /** Aynı sorguda birden fazla FARKLI `maxspeed` görüldü mü. */
  readonly conflicting?: boolean;
  /** Limitin okunduğu yolun OSM `highway` sınıfı (ör. `motorway`). Geçerlilik
   *  yarıçapı bundan türer — bkz. {@link speedLimitMaxDistanceM}. Bilinmiyorsa
   *  `null` → muhafazakâr 200 m varsayılanı kullanılır. */
  readonly highway?: string | null;
}

/** Aracın (map-matched tercih edilir) mevcut konumu ve saat. */
export interface SpeedLimitContext {
  readonly lat: number | null;
  readonly lon: number | null;
  readonly nowMs: number;
  /** Bu tur için rota kimliği/geometri damgası — değişirse limit YENİDEN çözülmeli. */
  readonly routeEpoch?: string | null;
}

export interface SpeedLimitVerdict {
  readonly state: SpeedLimitState;
  /** YALNIZ `AVAILABLE` iken sayı taşır; diğer tüm durumlarda `null`. */
  readonly kmh: number | null;
  readonly source: 'osm' | 'inferred' | null;
  /** Değerin yaşı (ms) — `null` = damga yok. */
  readonly ageMs: number | null;
  /** Aracın, limitin çözüldüğü noktadan uzaklığı (m) — `null` = hesaplanamadı. */
  readonly distanceFromFixM: number | null;
  /** Kaba güven [0..1] — yaş ve mesafe ile azalır. Uydurma değil, TÜREVDİR. */
  readonly confidence: number;
  /** Neden gizlendi/kabul edildi — LAB ve testler için. */
  readonly reason: string;
}

/* ── Eşikler ────────────────────────────────────────────────────────────────
 * Bu üç sayı UYDURULMADI; mevcut servisin ölçülmüş davranışından türetilmiştir:
 *   • `_REQUERY_DIST_M = 200` — servis 200 m'de yeni yol varsayar. Levhanın
 *     "hâlâ o yola ait" sayılması bu mesafeyi AŞMAMALIDIR.
 *   • Overpass sorgu yarıçapı `around:30` — 30 m'lik bir yol eşleşmesi.
 *   • Backoff dizisi en fazla 120 sn — bu süre içinde cevap gelmezse elde
 *     tutulan değer bir sonraki yolu temsil etmeyebilir. */

/** Limitin çözüldüğü noktadan bu mesafeyi aşınca artık O YOLA ait sayılmaz.
 *  Yol sınıfı BİLİNMEDİĞİNDE kullanılan muhafazakâr varsayılan. */
export const SPEED_LIMIT_MAX_DISTANCE_M = 200;
/** Bu yaştan sonra değer bayat sayılır (kaynak bir daha doğrulayamadı). */
export const SPEED_LIMIT_MAX_AGE_MS = 180_000;

/* ── Yol sınıfına duyarlı geçerlilik yarıçapı ───────────────────────────────
 * SAHA ÖLÇÜMÜ 2026-08-04 (Ankara-Tarsus Otoyolu O-21, ortalama 89 km/h, 50 sn):
 * Overpass GERÇEK veriyi döndürdü (`maxspeed=130`, `highway=motorway`) ve levha
 * DOĞRU değeri gösterdi — ama ekranda kalma oranı **%36** idi; dizi şöyleydi:
 *   `...................130130130130130...130130130130130130..130130130130130130130........`
 * Yani levha sürekli yanıp söndü ve sürücü ona bakamadı.
 *
 * KÖK: sabit 200 m yarıçap. 89 km/h = 24,7 m/s → araç 200 m'yi **8 saniyede**
 * aşıyor; sorgu döngüsü (ölçülen ardışık sorgu aralığı ~9 sn, Overpass yanıtı
 * 0,5–13 sn) buna yetişemiyor → değer `STALE` sayılıp gizleniyor.
 *
 * DÜZELTME UYDURMA DEĞİL, KANITA DAYALI: "araç hâlâ aynı yolda mı?" sorusunun
 * cevabı yolun SINIFINDADIR ve o sınıf zaten aynı Overpass yanıtında geliyor
 * (`highway=motorway`). Otoyolda kavşaklar kilometrelerce arayla olduğu için
 * 200 m kesinlikle aynı yolun devamıdır; dar bir sokakta değildir.
 *
 * ŞEHİR İÇİ DAVRANIŞI DEĞİŞMEZ: `residential`/`service`/`living_street` ve
 * bilinmeyen sınıf 200 m'de kalır → mevcut (doğru) davranış korunur, regresyon yok.
 */
const _CLASS_DISTANCE_M: Readonly<Record<string, number>> = {
  motorway:       1500, motorway_link: 1500,
  trunk:          1500, trunk_link:    1500,
  primary:         800, primary_link:   800,
  secondary:       400, secondary_link: 400,
  tertiary:        400, tertiary_link:  400,
};

/**
 * Levhanın "hâlâ bu yola ait" sayılacağı yarıçap (m) — yol sınıfından türer.
 * Bilinmeyen/şehir içi sınıf → {@link SPEED_LIMIT_MAX_DISTANCE_M} (200 m).
 */
export function speedLimitMaxDistanceM(highway?: string | null): number {
  if (!highway) return SPEED_LIMIT_MAX_DISTANCE_M;
  return _CLASS_DISTANCE_M[highway] ?? SPEED_LIMIT_MAX_DISTANCE_M;
}

function _haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

const _HIDDEN = (state: SpeedLimitState, reason: string,
                 source: 'osm' | 'inferred' | null = null,
                 ageMs: number | null = null,
                 distanceFromFixM: number | null = null): SpeedLimitVerdict =>
  ({ state, kmh: null, source, ageMs, distanceFromFixM, confidence: 0, reason });

/**
 * Ham gözlemi hükme çevirir.
 *
 * **KURAL: `AVAILABLE` dışında HİÇBİR durumda sayı dönmez.** Çağıranın yanlışlıkla
 * bayat/tahmini bir değeri ekrana basması yapısal olarak imkânsızdır.
 *
 * @param allowInferred Yol sınıfından çıkarıma izin ver. Mini harita kartı için
 *   `false` verilir (görev kuralı: "Yol tipinden tahmin YASAK"). Tam ekran HUD
 *   kendi mevcut, kesikli-çerçeveli dürüst gösterimini sürdürebilsin diye
 *   parametre bırakıldı — varsayılan `false` (fail-closed).
 */
export function classifySpeedLimit(
  obs: SpeedLimitObservation,
  ctx: SpeedLimitContext,
  allowInferred = false,
): SpeedLimitVerdict {
  if (obs.kmh === null || obs.source === null) {
    return _HIDDEN('UNKNOWN', 'kaynak henüz cevap vermedi');
  }
  if (!Number.isFinite(obs.kmh) || obs.kmh <= 0 || obs.kmh > 300) {
    // Bilinmeyen veri ASLA 0 olarak gösterilmez — tamamen gizlenir.
    return _HIDDEN('UNAVAILABLE', 'geçersiz değer', obs.source);
  }
  if (obs.conflicting === true) {
    return _HIDDEN('CONFLICTED', 'aynı konumda çelişen limitler', obs.source);
  }
  if (obs.source === 'inferred' && !allowInferred) {
    // Yol SINIFINDAN tahmin — levha DEĞİL. Görev kuralı gereği gösterilmez.
    return _HIDDEN('UNAVAILABLE', 'yol sınıfından çıkarım — levha değil', 'inferred');
  }

  const ageMs = obs.resolvedAtMs !== null ? Math.max(0, ctx.nowMs - obs.resolvedAtMs) : null;

  let distanceFromFixM: number | null = null;
  if (obs.resolvedAtLat !== null && obs.resolvedAtLon !== null &&
      ctx.lat !== null && ctx.lon !== null &&
      Number.isFinite(ctx.lat) && Number.isFinite(ctx.lon)) {
    distanceFromFixM = _haversineM(ctx.lat, ctx.lon, obs.resolvedAtLat, obs.resolvedAtLon);
  }

  if (ageMs === null) {
    return _HIDDEN('UNKNOWN', 'zaman damgası yok', obs.source, null, distanceFromFixM);
  }
  if (ageMs > SPEED_LIMIT_MAX_AGE_MS) {
    return _HIDDEN('STALE', 'değer çok yaşlı', obs.source, ageMs, distanceFromFixM);
  }
  // Yarıçap yolun SINIFINDAN türer: otoyolda 200 m aynı yolun devamıdır, dar
  // sokakta değildir (saha 2026-08-04 — sabit 200 m levhayı %64 gizliyordu).
  const maxDistM = speedLimitMaxDistanceM(obs.highway);
  if (distanceFromFixM !== null && distanceFromFixM > maxDistM) {
    // Araç başka yola geçti → önceki yolun levhası GÖSTERİLMEZ.
    return _HIDDEN('STALE', 'araç limitin çözüldüğü yoldan uzaklaştı',
                   obs.source, ageMs, distanceFromFixM);
  }

  // Güven: yaş ve mesafe ile doğrusal azalır. Türetilmiş bir gösterge — sayının
  // kendisi her hâlükârda gerçek `maxspeed` etiketidir.
  const ageFactor  = 1 - ageMs / SPEED_LIMIT_MAX_AGE_MS;
  const distFactor = distanceFromFixM === null
    ? 0.8
    : 1 - distanceFromFixM / maxDistM;
  const confidence = Math.max(0, Math.min(1, Math.min(ageFactor, distFactor)));

  return {
    state: 'AVAILABLE',
    kmh: Math.round(obs.kmh),
    source: obs.source,
    ageMs,
    distanceFromFixM,
    confidence,
    reason: obs.source === 'osm' ? 'yolun maxspeed etiketi' : 'yol sınıfından çıkarım (izinli)',
  };
}

/** Hüküm gösterime uygun mu — UI tek satırda sorar. */
export function isSpeedLimitDisplayable(v: SpeedLimitVerdict): boolean {
  return v.state === 'AVAILABLE' && v.kmh !== null;
}

export const SPEED_LIMIT_STATE_LABEL: Readonly<Record<SpeedLimitState, string>> = {
  AVAILABLE:   'GERÇEK LEVHA',
  STALE:       'BAYAT — GİZLENDİ',
  UNAVAILABLE: 'KAYNAK YOK — GİZLENDİ',
  CONFLICTED:  'ÇELİŞKİLİ — GİZLENDİ',
  UNKNOWN:     'BİLİNMİYOR',
} as const;
