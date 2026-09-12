/**
 * turkeySpeedPolicy.ts — Türkiye YASAL hız sınırı politikası (SAF, VERSİYONLU).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · ağ YOK · React YOK.
 *
 * ── KURAL: SAYILAR UI'A GÖMÜLMEZ ────────────────────────────────────────────
 * Hız sınırı bir MEVZUAT verisidir, bir bileşenin içine serpiştirilmiş sabit
 * değil. Bu dosya versiyonlu, kaynaklı ve tarihli tek tablodur; değiştiğinde
 * `POLICY_VERSION` yükselir ve CAROS LAB'da görünür.
 *
 * ── KAYNAKLAR (2026-08-04'te doğrulandı, İKİ BAĞIMSIZ kaynak) ───────────────
 *  [A] Karayolları Genel Müdürlüğü (KGM) — "Hız Sınırları" resmî sayfası.
 *      https://www.kgm.gov.tr/sayfalar/kgm/sitetr/trafik/hizsinirlari.aspx
 *  [B] Karayolları Trafik Yönetmeliği md. 100 tablosu (Değişik: RG-1/9/2010-27689).
 *      https://www.trafiksozluk.com/karayollari-trafik-yonetmeligi-100-madde/
 *  [C] Panelvan satırının kamyonetten AYRILMASI — Karayolları Trafik
 *      Yönetmeliğinde Değişiklik, RG 21/3/2012 (haber künyesi):
 *      https://www.dunya.com/gundem/panelvanlarin-hiz-limitleri-artti-haberi-168880
 *  [D] Otoyollarda otomobil (M1) sınırının yükseltilmesi — T.C. İçişleri
 *      Bakanlığı duyurusu, yürürlük 1/7/2022 (KGM otoyolları 130, YİD 140):
 *      https://www.icisleri.gov.tr/otoyollarda-otomobiller-icin-yeni-hiz-siniri-uygulamasi-1-temmuzda-basliyor
 *
 * ⚠️ KAYNAK ÇELİŞKİSİ KAYDI: [B]'nin 2010 metninde **panelvan satırı YOKTUR**
 * (panelvan kamyonetle aynı: 80/85/95). [A] ve [C] panelvanı AYRI satır olarak
 * gösterir (85/100/110). Daha GÜNCEL ve daha OTORİTER olan [A]+[C] esas
 * alınmıştır; çelişki burada ve raporda açıkça kayıtlıdır.
 */

import type {
  LegalVehicleCategory, RegistrationBodyType,
} from '../../vehicle/legalVehicleClass';

/* ══════════════════════════════════════════════════════════════════════════
 * Yol sınıfları
 * ════════════════════════════════════════════════════════════════════════ */

export type PolicyRoadClass =
  /** Yerleşim yeri içi. */
  | 'URBAN'
  /** Yerleşim yeri dışı, şehirlerarası ÇİFT YÖNLÜ (tek platform) karayolu. */
  | 'INTERURBAN_TWO_WAY'
  /** Bölünmüş yol (duble yol). */
  | 'DIVIDED_HIGHWAY'
  /** KGM işletmesindeki otoyol. */
  | 'MOTORWAY_KGM'
  /** Yap-İşlet-Devret (YİD) otoyolu. */
  | 'MOTORWAY_YID'
  /** Yerel levha daha düşük bir sınır dayatıyor. */
  | 'LOCAL_SIGN_OVERRIDE'
  /** Geçici levha (şantiye vb.). */
  | 'TEMPORARY_SIGN'
  | 'UNKNOWN';

export const ROAD_CLASS_LABEL: Readonly<Record<PolicyRoadClass, string>> = {
  URBAN:               'yerleşim yeri içi',
  INTERURBAN_TWO_WAY:  'şehirlerarası çift yönlü',
  DIVIDED_HIGHWAY:     'bölünmüş yol',
  MOTORWAY_KGM:        'otoyol (KGM)',
  MOTORWAY_YID:        'otoyol (YİD)',
  LOCAL_SIGN_OVERRIDE: 'yerel levha',
  TEMPORARY_SIGN:      'geçici levha',
  UNKNOWN:             'bilinmiyor',
} as const;

/** Politika tablosunda satırı olan yol sınıfları (levha sınıfları tabloda YOKTUR). */
export const POLICY_TABLE_ROAD_CLASSES: readonly PolicyRoadClass[] = [
  'URBAN', 'INTERURBAN_TWO_WAY', 'DIVIDED_HIGHWAY', 'MOTORWAY_KGM', 'MOTORWAY_YID',
] as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Politika satırı
 * ════════════════════════════════════════════════════════════════════════ */

export interface SpeedPolicyRow {
  readonly countryCode: 'TR';
  readonly policyVersion: string;
  /** ISO tarih — bu satırın yürürlüğe girdiği gün. */
  readonly effectiveFrom: string;
  /** ISO tarih veya `null` (hâlâ yürürlükte). */
  readonly effectiveTo: string | null;
  readonly sourceAuthority: string;
  readonly sourceRef: string;
  readonly legalVehicleCategory: LegalVehicleCategory;
  readonly registrationBodyType: RegistrationBodyType;
  readonly roadClass: PolicyRoadClass;
  /** km/sa · `null` = bu araç bu yola GİREMEZ. */
  readonly statutoryLimitKmh: number | null;
  readonly notes: string;
}

export const POLICY_COUNTRY = 'TR' as const;
/** Tablo sürümü — herhangi bir satır değişirse YÜKSELİR. */
export const POLICY_VERSION = 'TR-2022.07.01' as const;
/** Tablonun tamamının dayandığı en son yürürlük tarihi. */
export const POLICY_EFFECTIVE_FROM = '2022-07-01' as const;
export const POLICY_SOURCE_AUTHORITY =
  'Karayolları Genel Müdürlüğü · Karayolları Trafik Yönetmeliği md.100 · İçişleri Bakanlığı (1/7/2022)' as const;
export const POLICY_SOURCE_REFS: readonly string[] = [
  'https://www.kgm.gov.tr/sayfalar/kgm/sitetr/trafik/hizsinirlari.aspx',
  'https://www.trafiksozluk.com/karayollari-trafik-yonetmeligi-100-madde/',
  'https://www.icisleri.gov.tr/otoyollarda-otomobiller-icin-yeni-hiz-siniri-uygulamasi-1-temmuzda-basliyor',
] as const;

/** Satır üretici — tekrar eden künye alanlarını tek yerde tutar. */
function _row(
  legalVehicleCategory: LegalVehicleCategory,
  registrationBodyType: RegistrationBodyType,
  limits: Readonly<Record<'URBAN' | 'INTERURBAN_TWO_WAY' | 'DIVIDED_HIGHWAY'
    | 'MOTORWAY_KGM' | 'MOTORWAY_YID', number | null>>,
  notes: string,
  effectiveFrom: string,
  sourceRef: string,
): SpeedPolicyRow[] {
  return POLICY_TABLE_ROAD_CLASSES.map((roadClass) => ({
    countryCode: POLICY_COUNTRY,
    policyVersion: POLICY_VERSION,
    effectiveFrom,
    effectiveTo: null,
    sourceAuthority: POLICY_SOURCE_AUTHORITY,
    sourceRef,
    legalVehicleCategory,
    registrationBodyType,
    roadClass,
    statutoryLimitKmh: limits[roadClass as keyof typeof limits],
    notes,
  }));
}

const _KGM = POLICY_SOURCE_REFS[0];
const _YON = POLICY_SOURCE_REFS[1];
const _ICI = POLICY_SOURCE_REFS[2];

/**
 * TÜRKİYE TABLOSU.
 *
 * ⚠️ OTOYOL SATIRLARI HAKKINDA (M1): Yönetmeliğin 2010 metninde otomobil için
 * otoyol sınırı **120**'dir. İçişleri Bakanlığı'nın 1/7/2022 kararı ADI GEÇEN
 * otoyollarda bunu KGM işletmesinde **130**, YİD otoyollarında **140** yapmıştır.
 * Tabloya bu iki değer yazılır çünkü bu satırlar bir **ÜST SINIR** olarak
 * kullanılır (bkz. `vehicleAwareSpeedLimitAuthority`): tavan hiçbir zaman
 * levhayı YÜKSELTMEZ, yalnız gerekiyorsa DÜŞÜRÜR. Böylece 120'lik bir otoyolda
 * levha 120 kalır, 140'lık YİD otoyolunda 140 kalır ve N1 araçlar HER İKİSİNDE
 * de kendi tavanına (95/110) çekilir — istenen davranış tam olarak budur.
 */
export const TURKEY_SPEED_POLICY: readonly SpeedPolicyRow[] = [
  ..._row('M1', 'AUTOMOBILE',
    { URBAN: 50, INTERURBAN_TWO_WAY: 90, DIVIDED_HIGHWAY: 110, MOTORWAY_KGM: 130, MOTORWAY_YID: 140 },
    'Otomobil (M1). Otoyol değerleri 1/7/2022 İçişleri kararı; yönetmelik tabanı 120.',
    '2022-07-01', _ICI),
  ..._row('M1G', 'AUTOMOBILE',
    { URBAN: 50, INTERURBAN_TWO_WAY: 90, DIVIDED_HIGHWAY: 110, MOTORWAY_KGM: 130, MOTORWAY_YID: 140 },
    'Arazi tipi otomobil (M1G) — otomobil satırıyla aynı.',
    '2022-07-01', _ICI),

  ..._row('M2', 'MINIBUS',
    { URBAN: 50, INTERURBAN_TWO_WAY: 80, DIVIDED_HIGHWAY: 90, MOTORWAY_KGM: 100, MOTORWAY_YID: 100 },
    'Minibüs (M2).', '2010-09-01', _KGM),
  ..._row('M3', 'BUS',
    { URBAN: 50, INTERURBAN_TWO_WAY: 80, DIVIDED_HIGHWAY: 90, MOTORWAY_KGM: 100, MOTORWAY_YID: 100 },
    'Otobüs (M2-M3). Hız sınırlandırıcı cihaz 110 km/sa ayarlıdır.', '2010-09-01', _KGM),

  /* ── N1 — KRİTİK AYRIM: kamyonet ≠ panelvan ─────────────────────────────── */
  ..._row('N1', 'PICKUP',
    { URBAN: 50, INTERURBAN_TWO_WAY: 80, DIVIDED_HIGHWAY: 85, MOTORWAY_KGM: 95, MOTORWAY_YID: 95 },
    'Kamyonet (N1, N1G) — yönetmelik md.100 tablosu.', '2010-09-01', _YON),
  ..._row('N1G', 'PICKUP',
    { URBAN: 50, INTERURBAN_TWO_WAY: 80, DIVIDED_HIGHWAY: 85, MOTORWAY_KGM: 95, MOTORWAY_YID: 95 },
    'Arazi tipi kamyonet (N1G) — kamyonet satırıyla aynı.', '2010-09-01', _YON),
  ..._row('N1', 'PANELVAN',
    { URBAN: 50, INTERURBAN_TWO_WAY: 85, DIVIDED_HIGHWAY: 100, MOTORWAY_KGM: 110, MOTORWAY_YID: 110 },
    'Panelvan (N1) — RG 21/3/2012 ile kamyonetten AYRILDI.', '2012-03-21', _KGM),

  ..._row('N2', 'TRUCK',
    { URBAN: 50, INTERURBAN_TWO_WAY: 80, DIVIDED_HIGHWAY: 85, MOTORWAY_KGM: 90, MOTORWAY_YID: 90 },
    'Kamyon/çekici (N2-N3). Hız sınırlandırıcı 99 km/sa.', '2010-09-01', _KGM),
  ..._row('N3', 'TRUCK',
    { URBAN: 50, INTERURBAN_TWO_WAY: 80, DIVIDED_HIGHWAY: 85, MOTORWAY_KGM: 90, MOTORWAY_YID: 90 },
    'Kamyon/çekici (N2-N3). Hız sınırlandırıcı 99 km/sa.', '2010-09-01', _KGM),

  ..._row('UNKNOWN', 'TRACTOR',
    { URBAN: 20, INTERURBAN_TWO_WAY: 30, DIVIDED_HIGHWAY: 40, MOTORWAY_KGM: null, MOTORWAY_YID: null },
    'Lastik tekerlekli traktör — otoyola GİREMEZ.', '2010-09-01', _YON),
] as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Sorgulama
 * ════════════════════════════════════════════════════════════════════════ */

export interface VehicleClassCapQuery {
  readonly legalVehicleCategory: LegalVehicleCategory;
  readonly registrationBodyType: RegistrationBodyType;
  readonly roadClass: PolicyRoadClass;
  /**
   * Otoyolun işletmecisi (KGM/YİD) BİLİNİYOR mu.
   *
   * OSM `highway=motorway` etiketi işletmeciyi SÖYLEMEZ. Bilinmiyorken tavan,
   * iki otoyol satırının **büyüğü** alınır: tavan bir ÜST SINIRDIR ve levhayı
   * asla yükseltmez; büyük olanı almak M1 için levhayı olduğu gibi bırakır,
   * N1/N2 için ise iki satır da aynı olduğundan hiçbir şey değişmez.
   */
  readonly motorwayOperatorKnown?: boolean;
}

export interface VehicleClassCapResult {
  /** km/sa — `null` = bu sınıf/yol için tablo satırı YOK (uydurma yapılmaz). */
  readonly capKmh: number | null;
  /** Tavanın alındığı satır (LAB künyesi). */
  readonly row: SpeedPolicyRow | null;
  /** Gövde cinsi bilinmediği için birden fazla satır aday mıydı. */
  readonly ambiguous: boolean;
  /** Belirsizken değerlendirilen adayların km/sa değerleri. */
  readonly candidateCapsKmh: readonly number[];
  readonly reason: string;
}

const _NO_CAP: VehicleClassCapResult = {
  capKmh: null, row: null, ambiguous: false, candidateCapsKmh: [],
  reason: 'politika tablosunda satır yok',
} as const;

function _rowsFor(
  cat: LegalVehicleCategory, body: RegistrationBodyType, roadClass: PolicyRoadClass,
): SpeedPolicyRow[] {
  return TURKEY_SPEED_POLICY.filter((r) =>
    r.legalVehicleCategory === cat
    && r.roadClass === roadClass
    && (body === 'UNKNOWN' || r.registrationBodyType === body));
}

/**
 * Araç sınıfının bu yol sınıfındaki YASAL TAVANI.
 *
 * ── FAIL-CLOSED KURALLARI ───────────────────────────────────────────────────
 *  · Kategori `UNKNOWN` → tavan YOK (otomobil VARSAYILMAZ — görev §0).
 *  · Gövde cinsi bilinmiyor ve kategori birden çok satıra uyuyorsa (N1: kamyonet
 *    95 / panelvan 110) → **en DÜŞÜK aday** uygulanır ve `ambiguous=true` ilan
 *    edilir. Yüksek olanı seçmek panelvan sanılan bir kamyoneti 15 km/sa fazla
 *    hızda "yasal" gösterirdi; muhafazakâr taraf tek güvenli taraftır.
 *  · Levha sınıfları (`LOCAL_SIGN_OVERRIDE` / `TEMPORARY_SIGN`) tabloda YOKTUR:
 *    levha zaten YOL tarafından gelir ve tavan onu yükseltemez.
 */
export function vehicleClassCap(q: VehicleClassCapQuery): VehicleClassCapResult {
  if (q.legalVehicleCategory === 'UNKNOWN' && q.registrationBodyType === 'UNKNOWN') {
    return { ..._NO_CAP, reason: 'araç sınıfı bilinmiyor — otomobil tavanı VARSAYILMAZ' };
  }
  if (!POLICY_TABLE_ROAD_CLASSES.includes(q.roadClass)) {
    return { ..._NO_CAP, reason: `politika tablosunda yol sınıfı yok: ${q.roadClass}` };
  }

  const isMotorway = q.roadClass === 'MOTORWAY_KGM' || q.roadClass === 'MOTORWAY_YID';
  const classes: PolicyRoadClass[] = (isMotorway && q.motorwayOperatorKnown !== true)
    ? ['MOTORWAY_KGM', 'MOTORWAY_YID']
    : [q.roadClass];

  const rows = classes.flatMap((rc) =>
    _rowsFor(q.legalVehicleCategory, q.registrationBodyType, rc));
  if (rows.length === 0) {
    return { ..._NO_CAP, reason: 'bu kategori/gövde için tablo satırı yok' };
  }

  // Otoyol işletmecisi bilinmiyorken: aynı gövde için KGM/YİD arasından BÜYÜK olan
  // (üst sınır gevşetilmez, yalnız levhayı yanlışlıkla düşürmemek için).
  // Gövde belirsizken: farklı gövdeler arasından KÜÇÜK olan (muhafazakâr).
  const byBody = new Map<RegistrationBodyType, number[]>();
  for (const r of rows) {
    if (r.statutoryLimitKmh === null) continue;
    const arr = byBody.get(r.registrationBodyType) ?? [];
    arr.push(r.statutoryLimitKmh);
    byBody.set(r.registrationBodyType, arr);
  }
  if (byBody.size === 0) {
    // Satır var ama değer `null` → bu araç bu yola giremez.
    return {
      capKmh: null, row: rows[0], ambiguous: false, candidateCapsKmh: [],
      reason: 'bu araç sınıfı bu yola giremez',
    };
  }

  const perBody = [...byBody.entries()].map(([body, kmhs]) => ({
    body, kmh: Math.max(...kmhs),
  }));
  const ambiguous = perBody.length > 1;
  const chosen = perBody.reduce((a, b) => (b.kmh < a.kmh ? b : a));
  const row = rows.find((r) =>
    r.registrationBodyType === chosen.body && r.statutoryLimitKmh === chosen.kmh) ?? rows[0];

  return {
    capKmh: chosen.kmh,
    row,
    ambiguous,
    candidateCapsKmh: perBody.map((p) => p.kmh).sort((a, b) => a - b),
    reason: ambiguous
      ? 'gövde cinsi belirsiz — en düşük aday tavan uygulandı'
      : 'politika tablosu satırı',
  };
}
