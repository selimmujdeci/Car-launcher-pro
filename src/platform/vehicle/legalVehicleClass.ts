/**
 * legalVehicleClass.ts — YASAL araç sınıfı kanonik modeli (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · ağ YOK · React YOK · global durum YOK.
 * Saat DIŞARIDAN gelir → testler deterministiktir.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * CAROS bugüne kadar hız limitini YALNIZ yoldan okuyordu (`speedLimitTruthModel`).
 * Yol doğru olsa bile UYGULANABİLİR limit araca göre değişir: aynı otoyolda
 * otomobil (M1) 130 km/sa gidebilirken ruhsatta **kamyonet (N1)** yazan bir Fiat
 * Doblo 95 km/sa ile sınırlıdır. Yol limitini körlemesine göstermek sürücüyü
 * yasal olarak yanıltır.
 *
 * Bu dosya "araç hangi sınıfta?" sorusunun TEK kanonik cevabını üretir ve o
 * cevabın NE KADAR kanıtlı olduğunu taşır. Sınıf UYDURMAZ:
 *  · Marka/model adından sessizce sınıf TÜRETMEZ (Doblo hem M1 hem N1 satılır).
 *  · OBD'den okunan VIN tek başına RUHSAT sınıfı kanıtı SAYILMAZ.
 *  · Kanıt yoksa `UNKNOWN` döner — varsayılan olarak "otomobil" KABUL ETMEZ.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Kanonik sınıflar
 * ════════════════════════════════════════════════════════════════════════ */

/** AB tip onayı / Türkiye ruhsat yasal sınıfı. */
export type LegalVehicleCategory =
  | 'M1' | 'M1G'      // otomobil (G = arazi)
  | 'M2' | 'M3'       // minibüs / otobüs
  | 'N1' | 'N1G'      // hafif ticari (≤3,5 t) — kamyonet VEYA panelvan
  | 'N2' | 'N3'       // kamyon / çekici
  | 'UNKNOWN';

/**
 * Ruhsatta yazan GÖVDE cinsi.
 *
 * ⚠️ Türkiye'de hız sınırı açısından KRİTİK ayrım buradadır: `N1` kategorisi
 * içinde **kamyonet** (otoyol 95) ile **panelvan** (otoyol 110) FARKLI satırlara
 * tabidir (bkz. `turkeySpeedPolicy`). Yalnız kategoriyi bilmek yetmez.
 */
export type RegistrationBodyType =
  | 'AUTOMOBILE' | 'PANELVAN' | 'VAN' | 'PICKUP'
  | 'MINIBUS' | 'BUS' | 'TRUCK' | 'TRACTOR'
  | 'UNKNOWN';

/** Sınıf bilgisinin GELDİĞİ yer — güven sırası bu alandan türer. */
export type VehicleClassSource =
  /** Ruhsat belgesi doğrulandı (bu turda ÜRETİLMEZ — OCR kapsam dışı). */
  | 'REGISTRATION_CONFIRMED'
  /** Kullanıcı ruhsatına bakıp seçti. */
  | 'USER_CONFIRMED'
  /** Resmî VIN/tip onayı sorgusu (backend proxy). */
  | 'OFFICIAL_VIN_LOOKUP'
  /** Üretici/homologasyon verisi. */
  | 'MANUFACTURER_DATA'
  /** Güvenilir otomotiv veri tabanı. */
  | 'TRUSTED_DATABASE'
  /** Çıkarım — KANIT DEĞİL, yalnız aday üretir. */
  | 'INFERRED'
  | 'UNKNOWN';

/** Çözümlemenin bütünsel durumu. */
export type VehicleClassResolutionState =
  /** Tek, güvenilir, taze kanıt → uygulanabilir. */
  | 'VERIFIED'
  /** Kanıt var ama otorite/güven eşiğinin altında. */
  | 'PROBABLE'
  /** Birden fazla OLASI sınıf var, hangisi olduğu ayırt edilemiyor (Doblo M1/N1). */
  | 'AMBIGUOUS'
  /** Hiç kanıt yok. */
  | 'UNAVAILABLE'
  /** Kullanıcı beyanı ile dış kaynak ÇELİŞİYOR. */
  | 'CONFLICTED'
  /** Kanıt vardı ama geçerlilik süresi doldu. */
  | 'STALE';

export const VEHICLE_CLASS_STATE_LABEL: Readonly<Record<VehicleClassResolutionState, string>> = {
  VERIFIED:    'DOĞRULANDI',
  PROBABLE:    'OLASI',
  AMBIGUOUS:   'BELİRSİZ',
  UNAVAILABLE: 'KANIT YOK',
  CONFLICTED:  'ÇELİŞKİLİ',
  STALE:       'BAYAT',
} as const;

export const LEGAL_CATEGORY_LABEL: Readonly<Record<LegalVehicleCategory, string>> = {
  M1: 'M1 otomobil',  M1G: 'M1G otomobil (arazi)',
  M2: 'M2 minibüs',   M3:  'M3 otobüs',
  N1: 'N1 hafif ticari', N1G: 'N1G hafif ticari (arazi)',
  N2: 'N2 kamyon',    N3:  'N3 kamyon/çekici',
  UNKNOWN: 'bilinmiyor',
} as const;

export const BODY_TYPE_LABEL: Readonly<Record<RegistrationBodyType, string>> = {
  AUTOMOBILE: 'otomobil', PANELVAN: 'panelvan', VAN: 'van', PICKUP: 'kamyonet',
  MINIBUS: 'minibüs', BUS: 'otobüs', TRUCK: 'kamyon', TRACTOR: 'traktör',
  UNKNOWN: 'bilinmiyor',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt (claim) — her kaynak BİR aday üretir; çözümleyici hakem olur
 * ════════════════════════════════════════════════════════════════════════ */

/** Dış kaynağın izlenebilirlik künyesi. Ham sayfa içeriği TAŞINMAZ. */
export interface VehicleClassSourceRef {
  /** Kaynağın adresi (yalnız künye — içerik değil). */
  readonly url: string;
  /** İnsan-okur başlık/otorite adı. */
  readonly title: string;
  /** Bu künyenin alındığı an (Unix ms duvar saati). */
  readonly retrievedAt: number;
}

export interface VehicleClassClaim {
  readonly legalVehicleCategory: LegalVehicleCategory;
  readonly registrationBodyType: RegistrationBodyType;
  readonly source: VehicleClassSource;
  /** [0..1] — kaynağın kendi beyan ettiği güven. */
  readonly confidence: number;
  /** Kanıtın doğrulandığı an (Unix ms). `null` = damgasız → bayatlık hesaplanmaz. */
  readonly verifiedAt: number | null;
  /** Geçerlilik bitişi (Unix ms). `null` = süresiz. */
  readonly expiresAt: number | null;
  readonly sourceRefs: readonly VehicleClassSourceRef[];
}

/** Çözümlenmiş kanonik profil — ürünün TEK okuyacağı yapı. */
export interface VehicleClassProfile {
  readonly make: string | null;
  readonly model: string | null;
  readonly modelYear: number | null;
  /** Maskeli VIN — TAM VIN ASLA taşınmaz. */
  readonly vinMasked: string | null;
  readonly legalVehicleCategory: LegalVehicleCategory;
  readonly registrationBodyType: RegistrationBodyType;
  readonly source: VehicleClassSource;
  readonly confidence: number;
  readonly verifiedAt: number | null;
  readonly expiresAt: number | null;
  readonly sourceRefs: readonly VehicleClassSourceRef[];
  readonly resolutionState: VehicleClassResolutionState;
  /** `AMBIGUOUS` iken ayırt edilemeyen adaylar (LAB + muhafazakâr tavan için). */
  readonly candidates: readonly VehicleClassCandidate[];
  /** Neden bu duruma gelindi — LAB ve testler için insan-okur gerekçe. */
  readonly reason: string;
}

export interface VehicleClassCandidate {
  readonly legalVehicleCategory: LegalVehicleCategory;
  readonly registrationBodyType: RegistrationBodyType;
  readonly source: VehicleClassSource;
  readonly confidence: number;
}

/** Hiç kanıt yokken dönen değişmez profil. */
export const EMPTY_VEHICLE_CLASS_PROFILE: VehicleClassProfile = {
  make: null, model: null, modelYear: null, vinMasked: null,
  legalVehicleCategory: 'UNKNOWN', registrationBodyType: 'UNKNOWN',
  source: 'UNKNOWN', confidence: 0, verifiedAt: null, expiresAt: null,
  sourceRefs: [], resolutionState: 'UNAVAILABLE', candidates: [],
  reason: 'hiç kanıt yok',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * VIN — maskeleme ve araştırma öneki
 * ════════════════════════════════════════════════════════════════════════ */

const _VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Girdi geçerli ISO 3779 VIN mi (I/O/Q hariç 17 hane). */
export function isValidVin(vin: string | null | undefined): boolean {
  if (!vin) return false;
  return _VIN_RE.test(vin.trim().toUpperCase());
}

/**
 * LAB/log/export için maskeli VIN: `VF1…78`.
 *
 * GİZLİLİK: tam VIN bir aracı TEKİL olarak tanımlar; ekrana da loga da çıkmaz.
 * Maskede yalnız WMI (üretici) ve son iki hane kalır — kimliklendirme değeri
 * pratikte yoktur, tanı için "hangi araç" ayrımı yeterlidir.
 */
export function maskVin(vin: string | null | undefined): string | null {
  if (!isValidVin(vin)) return null;
  const v = (vin as string).trim().toUpperCase();
  return `${v.slice(0, 3)}…${v.slice(15)}`;
}

/**
 * Araştırma için gönderilecek VIN ÖNEKİ — ilk 9 hane (WMI + VDS).
 *
 * NEDEN 9: 10–17. haneler model yılı + **seri numarasıdır** ve aracı tekilleştirir.
 * Sınıf/tip onayı sorgusu için gereken bilgi ilk 9 hanededir. Böylece backend'e
 * bile tekilleştirici VIN GİTMEZ (görev §11).
 */
export function vinResearchPrefix(vin: string | null | undefined): string | null {
  if (!isValidVin(vin)) return null;
  return (vin as string).trim().toUpperCase().slice(0, 9);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kullanıcı seçimi → kanonik sınıf
 * ════════════════════════════════════════════════════════════════════════ */

/** Kullanıcıya sunulan seçenekler (görev §5) — daraltılmış ve ruhsat diliyle. */
export type VehicleClassUserChoice =
  | 'AUTOMOBILE_M1' | 'PICKUP_N1' | 'PANELVAN_N1' | 'MINIBUS_M2' | 'DONT_KNOW';

export const USER_CHOICE_LABEL: Readonly<Record<VehicleClassUserChoice, string>> = {
  AUTOMOBILE_M1: 'Otomobil (M1)',
  PICKUP_N1:     'Kamyonet (N1)',
  PANELVAN_N1:   'Panelvan (N1)',
  MINIBUS_M2:    'Minibüs (M2)',
  DONT_KNOW:     'Diğer / Bilmiyorum',
} as const;

/**
 * Kullanıcı seçimini kanıta çevirir. `DONT_KNOW` → `null` (UNKNOWN korunur;
 * "bilmiyorum" bir sınıf BEYANI DEĞİLDİR).
 */
export function claimFromUserChoice(
  choice: VehicleClassUserChoice,
  nowMs: number,
): VehicleClassClaim | null {
  if (choice === 'DONT_KNOW') return null;
  const map: Record<Exclude<VehicleClassUserChoice, 'DONT_KNOW'>,
    [LegalVehicleCategory, RegistrationBodyType]> = {
    AUTOMOBILE_M1: ['M1', 'AUTOMOBILE'],
    PICKUP_N1:     ['N1', 'PICKUP'],
    PANELVAN_N1:   ['N1', 'PANELVAN'],
    MINIBUS_M2:    ['M2', 'MINIBUS'],
  };
  const [legalVehicleCategory, registrationBodyType] = map[choice];
  return {
    legalVehicleCategory,
    registrationBodyType,
    source: 'USER_CONFIRMED',
    confidence: 0.95,
    verifiedAt: nowMs,
    // Kullanıcı beyanı süresizdir — araç değişene kadar geçerli (bkz. depo anahtarı).
    expiresAt: null,
    sourceRefs: [],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çözümleyici — kanıtlar arasında HAKEM
 * ════════════════════════════════════════════════════════════════════════ */

/** Bu kaynaklar "otoriter" sayılır → tek başlarına VERIFIED üretebilir. */
const _AUTHORITATIVE: ReadonlySet<VehicleClassSource> = new Set([
  'REGISTRATION_CONFIRMED', 'USER_CONFIRMED', 'OFFICIAL_VIN_LOOKUP',
]);

/** VERIFIED için gereken en küçük güven. */
export const VEHICLE_CLASS_VERIFY_CONFIDENCE = 0.8;

export interface ResolveVehicleClassInput {
  readonly claims: readonly VehicleClassClaim[];
  readonly nowMs: number;
  readonly make?: string | null;
  readonly model?: string | null;
  readonly modelYear?: number | null;
  readonly vin?: string | null;
}

function _key(c: { legalVehicleCategory: LegalVehicleCategory; registrationBodyType: RegistrationBodyType }): string {
  return `${c.legalVehicleCategory}/${c.registrationBodyType}`;
}

function _toCandidate(c: VehicleClassClaim): VehicleClassCandidate {
  return {
    legalVehicleCategory: c.legalVehicleCategory,
    registrationBodyType: c.registrationBodyType,
    source: c.source,
    confidence: c.confidence,
  };
}

function _identity(input: ResolveVehicleClassInput) {
  return {
    make: input.make ?? null,
    model: input.model ?? null,
    modelYear: (typeof input.modelYear === 'number' && Number.isFinite(input.modelYear))
      ? input.modelYear : null,
    vinMasked: maskVin(input.vin),
  };
}

/**
 * Kanıtları tek profile indirger.
 *
 * ── HAKEMLİK POLİTİKASI (AÇIKÇA TANIMLI — görev §5) ─────────────────────────
 *  1. Süresi dolmuş kanıtlar ELENİR. Hepsi dolduysa → `STALE` (sınıf UYGULANMAZ).
 *  2. **Kullanıcı beyanı önceliklidir**: kullanıcı ruhsatına bakar, internet
 *     bakmaz. Ama SESSİZCE ÜZERİNE YAZILMAZ — dış kaynak farklı sınıf diyorsa
 *     uygulanan değer kullanıcınınkidir ve durum `CONFLICTED` olarak İLAN EDİLİR.
 *  3. Kullanıcı yoksa: kalan kanıtlar aynı sınıfta birleşiyorsa tek aday;
 *     otoriter + güven eşiği geçerse `VERIFIED`, değilse `PROBABLE`.
 *  4. Kanıtlar FARKLI sınıflar gösteriyorsa `AMBIGUOUS` — hiçbiri seçilmez,
 *     adaylar taşınır (tavan hesabı muhafazakâr davranır).
 *  5. Hiç kanıt yoksa `UNAVAILABLE`.
 */
export function resolveVehicleClass(input: ResolveVehicleClassInput): VehicleClassProfile {
  const id = _identity(input);
  const base = { ...EMPTY_VEHICLE_CLASS_PROFILE, ...id };

  const valid = input.claims.filter(
    (c) => c.legalVehicleCategory !== 'UNKNOWN' || c.registrationBodyType !== 'UNKNOWN',
  );
  if (valid.length === 0) {
    return { ...base, resolutionState: 'UNAVAILABLE', reason: 'hiç kanıt yok' };
  }

  const fresh = valid.filter((c) => c.expiresAt === null || c.expiresAt > input.nowMs);
  if (fresh.length === 0) {
    return {
      ...base,
      resolutionState: 'STALE',
      candidates: valid.map(_toCandidate),
      reason: 'tüm kanıtların geçerlilik süresi doldu',
    };
  }

  const userClaim = fresh.find((c) => c.source === 'USER_CONFIRMED'
    || c.source === 'REGISTRATION_CONFIRMED') ?? null;

  if (userClaim) {
    const others = fresh.filter((c) => c !== userClaim);
    const disagreeing = others.filter((c) => _key(c) !== _key(userClaim));
    const conflicted = disagreeing.length > 0;
    return {
      ...base,
      legalVehicleCategory: userClaim.legalVehicleCategory,
      registrationBodyType: userClaim.registrationBodyType,
      source: userClaim.source,
      confidence: userClaim.confidence,
      verifiedAt: userClaim.verifiedAt,
      expiresAt: userClaim.expiresAt,
      sourceRefs: userClaim.sourceRefs,
      resolutionState: conflicted ? 'CONFLICTED' : 'VERIFIED',
      candidates: fresh.map(_toCandidate),
      reason: conflicted
        ? 'kullanıcı beyanı dış kaynakla çelişiyor — kullanıcı uygulandı, çelişki ilan edildi'
        : 'kullanıcı ruhsat beyanı',
    };
  }

  const keys = new Set(fresh.map(_key));
  if (keys.size > 1) {
    return {
      ...base,
      resolutionState: 'AMBIGUOUS',
      candidates: fresh.map(_toCandidate),
      sourceRefs: fresh.flatMap((c) => c.sourceRefs),
      reason: `kaynaklar ${keys.size} farklı sınıf gösteriyor — hiçbiri seçilmedi`,
    };
  }

  // Tek sınıfta birleşen kanıtlar — en yüksek güvenli olan temsilci.
  const best = fresh.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  const verified = _AUTHORITATIVE.has(best.source)
    && best.confidence >= VEHICLE_CLASS_VERIFY_CONFIDENCE;
  return {
    ...base,
    legalVehicleCategory: best.legalVehicleCategory,
    registrationBodyType: best.registrationBodyType,
    source: best.source,
    confidence: best.confidence,
    verifiedAt: best.verifiedAt,
    expiresAt: best.expiresAt,
    sourceRefs: fresh.flatMap((c) => c.sourceRefs),
    resolutionState: verified ? 'VERIFIED' : 'PROBABLE',
    candidates: fresh.map(_toCandidate),
    reason: verified
      ? 'otoriter kaynak, güven eşiği aşıldı'
      : 'kanıt var ama otorite/güven eşiği altında',
  };
}

/** Profil hız tavanı hesabında KULLANILABİLİR mi (kanıt yeterli mi). */
export function isVehicleClassApplicable(p: VehicleClassProfile): boolean {
  return (p.resolutionState === 'VERIFIED' || p.resolutionState === 'PROBABLE'
    || p.resolutionState === 'CONFLICTED')
    && p.legalVehicleCategory !== 'UNKNOWN';
}
