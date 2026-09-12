/**
 * currentLocationCore — "Neredeyim?" cevabının SAF çekirdeği.
 *
 * AMAÇ: GPS fix'ini sınıflandırmak (geçerli / yok / bayat / geçersiz) ve buradan
 * DÜRÜST bir Türkçe cevap üretmek. Tamamen saf: IO · timer · store · fetch YOK,
 * zaman dışarıdan (`nowMs`) verilir → deterministik test.
 *
 * DÜRÜSTLÜK KURALLARI (CLAUDE.md · "8 Kapı" §1 doğruluk):
 *  - GPS yoksa TAHMİN YÜRÜTÜLMEZ ("herhalde evdesiniz" ASLA).
 *  - Bayat koordinat GÜNCELMİŞ GİBİ söylenmez — yaşı cevapta açıkça geçer.
 *  - Çok eski fix fail-closed `unavailable` olur (yanlış yerde olduğunu söylemektense
 *    "bilmiyorum" demek doğrudur).
 *  - Adres bulunamazsa koordinat dürüstçe okunur — uydurma yer adı ÜRETİLMEZ.
 *  - Null Island (0,0) ve aralık dışı değerler GEÇERSİZ sayılır (geocodingService ile
 *    aynı sanity kuralı).
 */

/** Fix'in kullanılabilirlik sınıfı — fail-closed karar girdisi. */
export type LocationFixClass =
  | 'usable'    // taze ve geçerli → doğrudan cevaplanır
  | 'aging'     // geçerli ama eskimiş → cevapta YAŞI belirtilerek kullanılır
  | 'expired'   // o kadar eski ki güncel sayılamaz → unavailable
  | 'no_fix'    // hiç koordinat yok
  | 'invalid';  // koordinat fiziksel olarak geçersiz

/** Taze sayılan üst sınır — bunun altındaki fix yaşı cevapta anılmaz. */
export const LOCATION_FRESH_MS = 60_000;
/** Bu yaşın üstündeki fix "güncel konum" olarak SUNULAMAZ (fail-closed). */
export const LOCATION_EXPIRY_MS = 5 * 60_000;
/**
 * Reverse geocoding için ayrılan toplam bütçe (ms). Burada durur ki saf çekirdek
 * `geocodingService`'i (ve onun ağır bağımlılık zincirini) IMPORT ETMEK ZORUNDA KALMASIN.
 */
export const LOCATION_GEOCODE_BUDGET_MS = 3_000;

/** Ham GPS fix'i — `GPSLocation`'ın bu modülün ihtiyaç duyduğu alt kümesi. */
export interface LocationFixInput {
  readonly latitude?: unknown;
  readonly longitude?: unknown;
  readonly timestamp?: unknown;
  readonly accuracy?: unknown;
}

/** Doğrulanmış fix — yalnız `classifyLocationFix` üretir. */
export interface ValidatedFix {
  readonly latitude: number;
  readonly longitude: number;
  /** Fix zaman damgası (ms). Damga yoksa/bozuksa null — yaş HESAPLANMAZ, uydurulmaz. */
  readonly timestampMs: number | null;
  /** Fix yaşı (ms); damga yoksa null. */
  readonly ageMs: number | null;
  readonly accuracyM: number | null;
}

export interface LocationClassification {
  readonly klass: LocationFixClass;
  /** Yalnız 'usable' | 'aging' sınıflarında dolu. */
  readonly fix?: ValidatedFix;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Fix'i sınıflandır. `nowMs` dışarıdan verilir (DI saat — `Date.now` gömülü DEĞİL).
 *
 * Zaman damgası YOKSA fix "yaşsız" kabul edilir ve `usable` sayılır: damganın olmaması
 * fix'in eski olduğunun KANITI değildir; uydurma yaş üretmemek için `ageMs` null kalır ve
 * cevapta yaş anılmaz.
 */
export function classifyLocationFix(
  loc: LocationFixInput | null | undefined,
  nowMs: number,
): LocationClassification {
  if (!loc) return { klass: 'no_fix' };

  const lat = finite(loc.latitude);
  const lng = finite(loc.longitude);
  if (lat === null || lng === null) return { klass: 'no_fix' };

  // Fiziksel sanity + Null Island (0,0 = "fix yok" sentinel'i, gerçek konum değil).
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { klass: 'invalid' };
  if (lat === 0 && lng === 0) return { klass: 'invalid' };

  const ts = finite(loc.timestamp);
  const validTs = ts !== null && ts > 0 ? ts : null;
  // Gelecek damgası (saat kayması) → yaş 0'a kenetlenir, negatif yaş ÜRETİLMEZ.
  const ageMs = validTs === null ? null : Math.max(0, nowMs - validTs);

  const fix: ValidatedFix = {
    latitude: lat,
    longitude: lng,
    timestampMs: validTs,
    ageMs,
    accuracyM: finite(loc.accuracy),
  };

  if (ageMs !== null && ageMs > LOCATION_EXPIRY_MS) return { klass: 'expired', fix };
  if (ageMs !== null && ageMs > LOCATION_FRESH_MS)   return { klass: 'aging', fix };
  return { klass: 'usable', fix };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Türkçe cevap üretimi (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

/** Koordinatı okunur biçime çevirir — 5 hane ≈ 1 m çözünürlük, yeterli ve bounded. */
export function formatCoordinate(value: number): string {
  return value.toFixed(5);
}

/** Fix yaşını Türkçe okunur ifadeye çevirir (yalnız 'aging' cevaplarında kullanılır). */
export function formatFixAge(ageMs: number): string {
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 1) return 'az önceki';
  return `${minutes} dakika önceki`;
}

export interface LocationAnswerInput {
  readonly classification: LocationClassification;
  /** Reverse geocoding sonucu; bulunamadıysa/timeout olduysa null. */
  readonly address: string | null;
}

export interface LocationAnswer {
  /** Cevap üretilebildi mi — false ise `message` dürüst bir "bilmiyorum"dur. */
  readonly ok: boolean;
  /** Kullanıcıya okunacak Türkçe cümle. */
  readonly text: string;
  /** Cevabın hangi kanıta dayandığı (tanı/telemetri — UI'da gösterilmesi şart değil). */
  readonly basis: 'address' | 'coordinates' | 'none';
}

/**
 * Sınıflandırma + (varsa) adresten Türkçe cevabı üretir.
 *
 * Adres varsa yer adıyla, yoksa koordinatla cevaplanır (geliştirme aşaması kararı:
 * koordinat göstermek uydurma yer adı üretmekten dürüsttür). 'aging' fix'te cümle
 * fix'in YAŞINI taşır — güncelmiş gibi sunulmaz.
 */
export function buildLocationAnswer(input: LocationAnswerInput): LocationAnswer {
  const { classification, address } = input;

  switch (classification.klass) {
    case 'no_fix':
      return {
        ok: false,
        text: 'Konum verisini şu anda alamıyorum. GPS sinyali yok.',
        basis: 'none',
      };
    case 'invalid':
      return {
        ok: false,
        text: 'Konum verisini şu anda alamıyorum. Gelen koordinat geçersiz.',
        basis: 'none',
      };
    case 'expired':
      return {
        ok: false,
        text: 'Güncel konumunuzu bilmiyorum. Elimdeki son konum verisi çok eski.',
        basis: 'none',
      };
    default:
      break;
  }

  const fix = classification.fix;
  if (!fix) {
    // Savunma: 'usable'/'aging' daima fix taşır. Buraya düşülürse uydurma YAPILMAZ.
    return { ok: false, text: 'Konum verisini şu anda alamıyorum.', basis: 'none' };
  }

  const agingPrefix =
    classification.klass === 'aging' && fix.ageMs !== null
      ? `${formatFixAge(fix.ageMs)} konum verisine göre `
      : '';

  if (address && address.trim().length > 0) {
    const head = agingPrefix.length > 0 ? agingPrefix : 'Şu anda ';
    return {
      ok: true,
      text: `${head}${address.trim()} civarındasınız.`,
      basis: 'address',
    };
  }

  const coords = `enlem ${formatCoordinate(fix.latitude)}, boylam ${formatCoordinate(fix.longitude)}`;
  const head = agingPrefix.length > 0 ? agingPrefix : 'Şu an ';
  return {
    ok: true,
    text: `${head}yaklaşık ${coords} konumundasınız. Adres bilgisini alamadım.`,
    basis: 'coordinates',
  };
}
