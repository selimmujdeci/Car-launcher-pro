/**
 * cehCutoverGate.ts — NAV v3 · F5 · CEH ÜRETİM OTORİTESİ KAPISI (SAF).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F5.10 · CLAUDE.md §SAHA DOĞRULAMA KÜTÜĞÜ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · modül durumu YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPININ VARLIK SEBEBİ ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F4'ün fiziksel doğruluğu (`docs/DEVICE_VALIDATION_LEDGER.md` #1232–#1243,
 * "NAV-V3-F4/1..12") GERÇEK ARAÇTA ÖLÇÜLMEDİ — hepsi 🔴 DEVICE PENDING.
 * Ölçülmemiş bir eşleştiriciye sürücü uyarısı devretmek, yanlış yolda yanlış
 * uyarı üretmektir. Bu yüzden CEH kaynaklı kararlar **üretim-otoriter
 * OLAMAZ**; kapı bunu kodla — niyetle değil — garanti eder.
 *
 * ── FAIL-CLOSED (pazarlıksız) ────────────────────────────────────────────
 * Her şart ÜÇ DEĞERLİDİR: `true` (kanıtlandı) · `false` (düştü) ·
 * **`null` (ölçülmedi)**. `null` bir şartı KARŞILAMAZ. "Ölçmedik ama muhtemelen
 * iyidir" bir kanıt değildir; kapı yalnız KANITLA açılır.
 *
 * ── BU KAPI NE YAPMAZ ────────────────────────────────────────────────────
 *  · Kendi başına saha hükmü ÜRETMEZ — kütük mutlak otoritedir.
 *  · Legacy otoriteyi SÖKMEZ; yalnız CEH'in üretim otoritesi olup
 *    olamayacağını söyler.
 *  · Açık kapı bile tek başına anons/uyarı ÜRETMEZ — tüketiciyi taşımak
 *    ayrı bir fazın (F6) işidir.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) VARSAYILAN — KAPALI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kapının varsayılan hâli. **`false` — pazarlıksız.** Bu sabiti `true`
 * yapmak, saha kanıtı olmadan sürücü kararını CEH'e devretmek demektir ve
 * kilit test bunu engeller.
 */
/* Tip `boolean` olarak SABİTLENİR (`false` literali DEĞİL): iki bağımsız
   kontrol noktasının (`evaluateCehCutoverGate` + `isCehProductionAuthority`)
   derleyici tarafından "gereksiz karşılaştırma" diye elenmesini engeller —
   kemer + askı, tek bir düzenlemeyle çözülemesin. */
export const CEH_CUTOVER_DEFAULT_OPEN: boolean = false;

/**
 * Kapının açılabilmesi için gereken EN AZ gölge örneği. ⚠️ Politika sayısı —
 * sahamızdan kalibre EDİLMEMİŞTİR (kütük maddesi). Tek bir uyuşan örnekle
 * "sapma yok" demek istatistiksel olarak anlamsızdır.
 */
export const CEH_CUTOVER_MIN_SHADOW_SAMPLES = 500;

/**
 * Kabul edilebilir fark oranı tavanı [0,1]. ⚠️ Politika sayısı — sahadan
 * ölçülmedi. Oran hesaplanamıyorsa (karşılaştırılabilir örnek yok) şart
 * KARŞILANMAZ (bkz. `shadowDivergenceRatio` → `null`).
 */
export const CEH_CUTOVER_MAX_DIVERGENCE_RATIO = 0.02;

/* ══════════════════════════════════════════════════════════════════════════
   2) ŞARTLAR
   ══════════════════════════════════════════════════════════════════════════ */

export type CehCutoverCondition =
  /** Kütük #1232–#1243 (NAV-V3-F4/1..12) gerçek araçta PASS. */
  | 'F4_FIELD_VALIDATION'
  /** Yeterli gölge örneği toplandı. */
  | 'SHADOW_SAMPLE_VOLUME'
  /** Gölge fark oranı kabul eşiği içinde. */
  | 'SHADOW_DIVERGENCE'
  /** Belirsizlik/fail-closed testleri PASS (belirsiz kol kesin karar üretmiyor). */
  | 'AMBIGUITY_FAIL_CLOSED'
  /** F0–F5 regresyon/authority kilitleri PASS. */
  | 'REGRESSION_GUARDS'
  /** CEH öznitelik portları GERÇEKTEN bağlı (bugün: değil). */
  | 'ATTRIBUTE_PORTS_BOUND';

export const CEH_CUTOVER_CONDITIONS: readonly CehCutoverCondition[] = [
  'F4_FIELD_VALIDATION', 'SHADOW_SAMPLE_VOLUME', 'SHADOW_DIVERGENCE',
  'AMBIGUITY_FAIL_CLOSED', 'REGRESSION_GUARDS', 'ATTRIBUTE_PORTS_BOUND',
] as const;

/** Şart açıklamaları — LAB'da "neden kapalı" sorusunun cevabı. */
export const CEH_CUTOVER_CONDITION_LABEL:
  Readonly<Record<CehCutoverCondition, string>> = Object.freeze({
    F4_FIELD_VALIDATION:   'F4 saha doğrulaması (kütük #1232–#1243)',
    SHADOW_SAMPLE_VOLUME:  'yeterli gölge örneği',
    SHADOW_DIVERGENCE:     'gölge fark oranı eşik içinde',
    AMBIGUITY_FAIL_CLOSED: 'belirsizlik fail-closed kanıtı',
    REGRESSION_GUARDS:     'regresyon/authority kilitleri',
    ATTRIBUTE_PORTS_BOUND: 'CEH öznitelik portları bağlı',
  });

export interface CehCutoverGateInput {
  /**
   * Kütük hükmü. **Üretimde bu değeri üreten bir kaynak YOKTUR** → `null`
   * (ölçülmedi) gelir ve kapı yapısal olarak KAPALI kalır. Saha kanıtı bir
   * insan kararıdır; kod onu kendi kendine ilan EDEMEZ.
   */
  readonly f4FieldValidationPassed: boolean | null;
  /** Toplanan karşılaştırılabilir gölge örneği sayısı. */
  readonly comparableSamples: number;
  /** Gölge fark oranı [0,1]. `null` = hesaplanamadı → şart KARŞILANMAZ. */
  readonly divergenceRatio: number | null;
  readonly ambiguityFailClosedProven: boolean | null;
  readonly regressionGuardsPassed: boolean | null;
  /** CEH öznitelik portları gerçekten bağlandı mı. */
  readonly attributePortsBound: boolean;
}

export interface CehCutoverGateVerdict {
  /** `true` YALNIZ tüm şartlar KANITLA karşılandığında. */
  readonly open: boolean;
  readonly state: 'OPEN' | 'CLOSED';
  /** Karşılanmayan şartlar — LAB bunları olduğu gibi basar. */
  readonly unmet: readonly CehCutoverCondition[];
  /** Karşılanan şartlar. */
  readonly met: readonly CehCutoverCondition[];
  /** Şartların kaçı ölçülmedi (`null`) — "düştü" ile AYRI sayılır. */
  readonly unmeasuredCount: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DEĞERLENDİRİCİ (saf)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kapıyı değerlendirir. **Saf** — aynı girdi daima aynı hükmü verir.
 *
 * `CEH_CUTOVER_DEFAULT_OPEN === false` iken kapı HİÇBİR girdiyle açılamaz:
 * bu, sahada bir kalibrasyon hatasının otoriteyi sessizce devretmesini
 * yapısal olarak imkânsız kılar (kilit test denetler).
 */
export function evaluateCehCutoverGate(
  input: CehCutoverGateInput | null | undefined,
): CehCutoverGateVerdict {
  const unmet: CehCutoverCondition[] = [];
  const met: CehCutoverCondition[] = [];
  let unmeasured = 0;

  const three = (cond: CehCutoverCondition, v: boolean | null | undefined): void => {
    if (v === true) { met.push(cond); return; }
    if (v === null || v === undefined) unmeasured++;
    unmet.push(cond);
  };

  const i = input ?? null;

  three('F4_FIELD_VALIDATION', i?.f4FieldValidationPassed ?? null);

  const samples = typeof i?.comparableSamples === 'number'
    && Number.isFinite(i.comparableSamples) ? i.comparableSamples : null;
  three('SHADOW_SAMPLE_VOLUME',
    samples === null ? null : samples >= CEH_CUTOVER_MIN_SHADOW_SAMPLES);

  const ratio = typeof i?.divergenceRatio === 'number'
    && Number.isFinite(i.divergenceRatio) ? i.divergenceRatio : null;
  three('SHADOW_DIVERGENCE',
    ratio === null ? null : ratio <= CEH_CUTOVER_MAX_DIVERGENCE_RATIO);

  three('AMBIGUITY_FAIL_CLOSED', i?.ambiguityFailClosedProven ?? null);
  three('REGRESSION_GUARDS', i?.regressionGuardsPassed ?? null);
  three('ATTRIBUTE_PORTS_BOUND', i?.attributePortsBound === true ? true : false);

  /* Kapı yalnız: (a) varsayılan açılışa izin veriyorsa VE (b) hiçbir şart
     karşılanmamış olarak kalmadıysa açılır. (a) bu fazda `false`tır. */
  const open = CEH_CUTOVER_DEFAULT_OPEN && unmet.length === 0;

  return {
    open,
    state: open ? 'OPEN' : 'CLOSED',
    unmet,
    met,
    unmeasuredCount: unmeasured,
  };
}

/**
 * Üretim otoritesi CEH'te mi. **F5'te DAİMA `false`.**
 *
 * Tüketiciler (Guardian kuralları · sesli yönlendirme · ETA) gerçek kararı
 * bu fonksiyon `true` dönene kadar LEGACY otoriteden alır. Kilit test bu
 * fonksiyonun bu fazda `true` dönemeyeceğini denetler.
 */
export function isCehProductionAuthority(
  verdict: CehCutoverGateVerdict | null | undefined,
): boolean {
  return !!verdict && verdict.open === true && CEH_CUTOVER_DEFAULT_OPEN === true;
}
