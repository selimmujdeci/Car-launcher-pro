/**
 * vinDecode — P0-OBD-09 · VIN'DEN GÜVENİLİR BİÇİMDE ÇIKARILABİLENLER (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 *
 * ── BU MODÜLÜN ASIL İDDİASI: NE ÇIKARILAMAZ ───────────────────────────────
 * VIN'den "marka/model/gövde" okunabildiği yaygın bir yanılgıdır. ISO 3779'a
 * göre 4–8. haneler (VDS) **tamamen üreticiye bırakılmıştır**; aynı hanenin
 * anlamı markadan markaya değişir. Bir eşleme tablosu olmadan model/gövde
 * çıkarmak UYDURMADIR ve bu modül onu YAPMAZ.
 *
 * GÜVENİLİR ÇIKARILABİLENLER (yalnız kamu standardından):
 *   · WMI (1–3)        → üretici KODU (marka ADI değil — tablo gerekir, yok)
 *   · Bölge (1. hane)  → ISO 3780 coğrafi bölge ataması
 *   · Model yılı (10)  → ISO 3779 kod tablosu (30 yıllık döngü — aşağıya bkz.)
 *   · Kontrol hanesi(9)→ YALNIZ Kuzey Amerika'da zorunlu; Avrupa'da doğrulamak
 *                        SAHTE BAŞARISIZLIK üretir.
 *
 * ── TİCARİ/BİNEK SINIFI VIN'DEN ÇIKARILAMAZ ───────────────────────────────
 * Aynı şasi hem M1 (binek) hem N1 (ticari) olarak tescillenebilir (kütükte
 * kayıtlı Doblo örneği). Bu modül sınıf ÜRETMEZ; sınıf otoritesi
 * `legalVehicleClass` / `vehicleClassRuntime`tedir ve emin olunmadıkça
 * `UNKNOWN` kalır.
 */

/** ISO 3779: I, O, Q kullanılmaz — karışıklık önlemi. */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Girdi geçerli ISO 3779 VIN mi (17 hane, I/O/Q yok). */
export function isVinShapeValid(vin: string | null | undefined): boolean {
  if (typeof vin !== 'string') return false;
  return VIN_RE.test(vin.trim().toUpperCase());
}

/** Normalize: kırp + büyük harfe çevir. Geçersizse `null` (kısmi VIN KABUL EDİLMEZ). */
export function normalizeVin(vin: string | null | undefined): string | null {
  if (typeof vin !== 'string') return null;
  const n = vin.trim().toUpperCase();
  return VIN_RE.test(n) ? n : null;
}

/* ── Bölge (ISO 3780, 1. hane) ────────────────────────────────────────────── */

export type VinRegion =
  | 'north_america' | 'oceania' | 'south_america' | 'asia'
  | 'europe' | 'africa' | 'unknown';

export const VIN_REGION_LABEL: Readonly<Record<VinRegion, string>> = {
  north_america: 'Kuzey Amerika',
  oceania:       'Okyanusya',
  south_america: 'Güney Amerika',
  asia:          'Asya',
  europe:        'Avrupa',
  africa:        'Afrika',
  unknown:       'Bilinmiyor',
};

/**
 * ISO 3780 coğrafi bölge — 1. haneden. Bu atama STANDARTTADIR, tahmin değildir.
 * Tanınmayan hane `unknown` döner (uydurma bölge YOK).
 */
export function vinRegion(vin: string): VinRegion {
  const c = vin.charAt(0);
  if (c >= '1' && c <= '5') return 'north_america';
  if (c === '6' || c === '7') return 'oceania';
  if (c === '8' || c === '9') return 'south_america';
  if (c >= 'A' && c <= 'H') return 'africa';
  if (c >= 'J' && c <= 'R') return 'asia';
  if (c >= 'S' && c <= 'Z') return 'europe';
  return 'unknown';
}

/* ── Model yılı (ISO 3779, 10. hane) ──────────────────────────────────────── */

/** ISO 3779 model yılı kod dizisi — 30 yıllık döngü (I/O/Q/U/Z ve 0 yok). */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

/**
 * Model yılı adayları — kod 30 yılda bir TEKRAR EDER (A = 1980 **ve** 2010).
 *
 * ── BELİRSİZLİK NASIL DARALTILIR ──────────────────────────────────────────
 * Aracı OBD-II üzerinden okuyoruz; OBD-II ABD'de 1996, AB'de 2001–2004'ten
 * itibaren zorunludur. Yani **1996 öncesi bir aday fiilen imkânsızdır**. Aynı
 * şekilde gelecekteki bir yıl da imkânsızdır. Bu iki kısıt uygulandıktan sonra
 * çoğu kodda TEK aday kalır.
 *
 * Tek aday kalmıyorsa yıl **BELİRSİZDİR** ve tek bir yıl UYDURULMAZ.
 *
 * @param currentYear Çağıranın verdiği yıl — bu modül saat OKUMAZ.
 */
export function vinModelYearCandidates(vin: string, currentYear: number): number[] {
  const code = vin.charAt(9);
  const idx = YEAR_CODES.indexOf(code);
  if (idx < 0) return [];
  const first = 1980 + idx;               // 1980–2009 döngüsü
  const second = first + 30;              // 2010–2039 döngüsü
  const maxYear = Number.isFinite(currentYear) ? currentYear + 1 : 2100;
  /* OBD-II tabanı: 1996 öncesi araç bu veriyi zaten veremezdi. */
  return [first, second].filter((y) => y >= 1996 && y <= maxYear);
}

/* ── Kontrol hanesi (9. hane) — YALNIZ Kuzey Amerika ──────────────────────── */

const TRANSLIT: Readonly<Record<string, number>> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export type VinCheckDigit = 'valid' | 'invalid' | 'not_applicable';

/**
 * ISO 3779 / 49 CFR 565 kontrol hanesi.
 *
 * **YALNIZ Kuzey Amerika'da ZORUNLUDUR.** Avrupa/Asya üreticilerinin çoğu 9.
 * haneyi kontrol hanesi olarak kullanmaz; orada doğrulamak SAHTE BAŞARISIZLIK
 * üretir ve geçerli bir VIN'i "bozuk" gösterirdi. Bu yüzden bölge Kuzey Amerika
 * değilse hüküm `not_applicable`tır — "geçerli" DE denmez.
 */
export function vinCheckDigit(vin: string): VinCheckDigit {
  if (vinRegion(vin) !== 'north_america') return 'not_applicable';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin.charAt(i);
    const v = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : TRANSLIT[ch];
    if (v === undefined) return 'invalid';
    sum += v * WEIGHTS[i]!;
  }
  const rem = sum % 11;
  const expected = rem === 10 ? 'X' : String(rem);
  return vin.charAt(8) === expected ? 'valid' : 'invalid';
}

/* ── Toplu çözümleme ──────────────────────────────────────────────────────── */

export interface VinFacts {
  /** Normalize VIN; girdi geçersizse `null` ve diğer alanlar da boş kalır. */
  readonly vin: string | null;
  /** Üretici KODU (1–3). Marka ADI DEĞİL — eşleme tablosu yok, uydurulmaz. */
  readonly wmi: string | null;
  readonly region: VinRegion;
  /**
   * Model yılı adayları. Tek eleman = kesin; iki eleman = BELİRSİZ; boş = kod
   * tanınmadı. Tek bir yıl asla UYDURULMAZ.
   */
  readonly modelYearCandidates: readonly number[];
  /** Belirsizlik giderilebildiyse yıl; aksi hâlde `null`. */
  readonly modelYear: number | null;
  readonly checkDigit: VinCheckDigit;
  /**
   * VIN'den ÇIKARILAMAYANLAR — ekranda açıkça yazılır ki kullanıcı eksikliği
   * "sistem beceremedi" değil "standart vermiyor" diye okusun.
   */
  readonly notDerivable: readonly string[];
}

const NOT_DERIVABLE: readonly string[] = [
  'Marka adı (WMI kodu var ama kod→marka tablosu YOK — uydurulmaz)',
  'Model / donanım (4–8. haneler tamamen üreticiye bırakılmıştır)',
  'Gövde tipi (aynı şasi farklı gövdelerle satılır)',
  'Ticari/binek sınıfı (aynı şasi hem M1 hem N1 tescillenebilir)',
  'Motor hacmi / yakıt türü (standart bir hane atanmamıştır)',
];

/** VIN'den yalnız STANDARDIN garanti ettiklerini çıkarır. */
export function decodeVin(vin: string | null | undefined, currentYear: number): VinFacts {
  const n = normalizeVin(vin);
  if (n === null) {
    return {
      vin: null, wmi: null, region: 'unknown',
      modelYearCandidates: [], modelYear: null,
      checkDigit: 'not_applicable', notDerivable: NOT_DERIVABLE,
    };
  }
  const candidates = vinModelYearCandidates(n, currentYear);
  return {
    vin: n,
    wmi: n.slice(0, 3),
    region: vinRegion(n),
    modelYearCandidates: candidates,
    modelYear: candidates.length === 1 ? candidates[0]! : null,
    checkDigit: vinCheckDigit(n),
    notDerivable: NOT_DERIVABLE,
  };
}
