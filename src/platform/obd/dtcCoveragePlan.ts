/**
 * dtcCoveragePlan — P0-VDK-F6B · ÇOKLU-ECU DTC KAPSAM PLANI VE DÜRÜSTLÜK SINIFI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── TEK İŞİ ───────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "Bu uç noktaya HANGİ salt-okunur DTC sorgusunu sormaya HAKKIM var, hangisini
 *  soramam ve NEDEN?" sorusunu SAF bir kararla yanıtlar; sonra ölçüm bitince
 * "ne sordum, ne aldım, neyi okuyamadım" sorusunu tek bir kapsam sınıfına
 * çevirir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ DTC OTORİTESİ DEĞİLDİR.** Kod listesi tutmaz, "araç temiz"
 *     demez — o karar `dtcAuthority.evaluateVehicleDtcVerdict` tekelindedir.
 * (2) **İKİNCİ YETENEK OTORİTESİ DEĞİLDİR.** Servis varlığı sınıflandırması
 *     F4-B `ecuCapabilityModel.deriveServicePresence`ten GELİR; burada
 *     yeniden hesaplanmaz, yalnız plana GİRDİ olur.
 * (3) **İKİNCİ GÜVENLİK KAPISI DEĞİLDİR.** Alt fonksiyon izni native
 *     `DiagnosticServiceGate`ten (TS aynası `GENERIC_UDS_19_SUBS`) VERİ
 *     olarak gelir; burada bir izin listesi TANIMLANMAZ.
 * (4) **İKİNCİ BÜTÇE OTORİTESİ DEĞİLDİR.** Plan yalnız SIRA ve GEREKÇE üretir;
 *     her isteğin hakkı F1-A `diagnosticTransaction.consumeRequest`tedir.
 * (5) **ROL TABLOSU DEĞİLDİR.** Hiçbir dal "ABS ise şunu gönder" demez.
 *     Rol bu dosyaya GİRMEZ: plan protokol + adreslenebilirlik + taşıma +
 *     ölçülmüş yetenekten türer. Rolü BİLİNMEYEN uç nokta da tam plana girer.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 */

import type { AdvancedDtcOutcome } from './advancedDtcEvidence';
import type { ServicePresence } from './ecuCapabilityModel';
/* P0-VDK-F6C — KOK NEDEN SOZLUGU MEVCUTTUR VE KOPYALANMAZ.
   `healing/gapModel.RootCauseClass` F5-A'dan beri kayip sinifini adlandiran
   TEK sozluktur (`TRANSPORT_BOUND` · `PARSER_BOUND` · `SESSION_CONDITIONED`
   · `CAPABILITY_UNMEASURED` …) ve `isMeasurementResolvable` zaten "parser
   borcu ölçümle kapanmaz" kuralini tasir. Yeni bir gap sozlugu YAZILMADI. */
import type { RootCauseClass } from './healing/gapModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) KAPSAM SINIFLARI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir uç noktada ölçülebilecek salt-okunur DTC kanalları.
 *
 * Sınıf ≠ servis: `UDS_DTC_BY_STATUS` (19-02) ile `UDS_SUPPORTED_DTC` (19-0A)
 * AYNI servisin AYRI gerçekleridir (biri status maskesiyle filtreler, diğeri
 * filtrelemez) ve tek satıra indirilirse kapsam yalanı doğar.
 */
export type DtcCoverageClass =
  | 'STANDARD_STORED'          // Mode 03
  | 'STANDARD_PENDING'         // Mode 07
  | 'STANDARD_PERMANENT'       // Mode 0A
  | 'UDS_STATUS_AVAILABILITY'  // 19-01 reportNumberOfDTCByStatusMask
  | 'UDS_DTC_BY_STATUS'        // 19-02 reportDTCByStatusMask
  | 'UDS_SNAPSHOT_ID'          // 19-03 reportDTCSnapshotIdentification
  | 'UDS_SNAPSHOT_RECORD'      // 19-04 reportDTCSnapshotRecordByDTCNumber
  | 'UDS_EXTENDED_DATA'        // 19-06 reportDTCExtDataRecordByDTCNumber
  | 'UDS_SUPPORTED_DTC'        // 19-0A reportSupportedDTC
  | 'KWP_DTC_18'               // ISO 14230-3 readDTCByStatus
  | 'KWP_DTC_13';              // ISO 14230-3 readDTC (0x18 öncesi nesil)

/** Sınıfın ait olduğu protokol ailesi — taşıma sınırının TEK kaynağı. */
export type DtcCoverageFamily = 'obd' | 'uds' | 'kwp';

/**
 * P0-VDK-F6C — KAPSAM EKSENİ.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (F6-B'de ÖLÇÜLEN KUSUR) ───────────────────────────
 * ═══════════════════════════════════════════════════════════════════════
 * F6-B tüm sınıfları TEK torbada topluyordu. Sonuç: **arıza hafizasi kusursuz
"
 * okunmuş, 0 DTC bulunmuş bir ECU sonsuza dek `KISMİ` görünüyordu** — çünkü
"
 * `19-06` (genişletilmiş veri) ön koşulsuz kalıp `ERTELENDİ` yazılıyor ve o da
"
 * `isCoverageIncomplete` üzerinden hükmü düşürüyordu. Yani **DTC'si olmayan
"
 * temiz bir ECU'ya asla “tam okundu” diyemiyorduk.**
 *
 * İki eksen bunu yapısal olarak çözer:
 *  · `core` — **ARıZA HAFIZASI OKUNDU MU?** (03/07/0A · 19-01/02/0A · 18 · 13)
 *    Bu eksenin tamamı terminal ise ECU'nun arıza hafizasi OKUNMUŞTUR.
 *  · `deep` — **KAYIT BAŞINA DERİN KANIT** (19-03 · 19-04 · 19-06)
 *    Bu eksen eksik olabilir; `core`u DÜŞÜRMEZ. `19-04` bu turda yapısal olarak
 *    kapalıdır (native kapı) — onun yüzünden temel kapsamı sonsuza dek kısmi
 *    göstermek, ölçülmemiş bir eksikliği ölçülmüş gibi sunmak olurdu.
 */
export type DtcCoverageAxis = 'core' | 'deep';

export const DTC_COVERAGE_AXIS_LABEL: Readonly<Record<DtcCoverageAxis, string>> = {
  core: 'TEMEL — arıza hafızası okundu mu',
  deep: 'DERİN — kayıt başına ek kanıt',
} as const;

export interface DtcCoverageClassSpec {
  readonly cls: DtcCoverageClass;
  readonly service: '03' | '07' | '0A' | '19' | '18' | '13';
  /** UDS alt fonksiyonu; standart modlarda ve KWP'de `null`. */
  readonly subFunction: string | null;
  readonly family: DtcCoverageFamily;
  /**
   * P0-VDK-F6C — `core` mu `deep` mi. `deep` sınıflar TEMEL kapsam hükmünü
   * DÜŞÜRMEZ; ayrı bir eksende raporlanır.
   */
  readonly axis: DtcCoverageAxis;
  /**
   * Bu sınıf DTC KAYDI üretir mi, yoksa yalnız META kanıt mı (maske · referans)?
   * Meta sınıflar `dtcPipelineAccounting` künyesine GİRMEZ — girerlerse tur
   * toplamına DTC olmayan satırlar karışır ve parite ölçümü bozulur.
   */
  readonly yieldsRecords: boolean;
  /**
   * CDDL `ServiceDef.id` karşılığı — plan girdi olarak aldığı tanım kümesinde
   * bunu ARAR. `null` = bu sınıfın CDDL tanımı YOKTUR (uydurulmaz); sınıf ancak
   * ürünün mevcut kanıtlı yolundan (0x19 alt fonksiyon uzayı) çıkabilir.
   */
  readonly serviceDefId: string | null;
  readonly label: string;
}

/**
 * Sınıf künyesi — ISO 14229-1 / ISO 14230-3 / SAE J1979 sabitleri.
 *
 * `serviceDefId` alanları `cddl/legacyAdapter`ın ÜRETTİĞİ kimliklerdir; test
 * bunların gerçekten var olduğunu kilitler (iki yerde tutulan bir eşleme,
 * birinin sessizce eskimesi demektir).
 */
export const DTC_COVERAGE_CLASS_SPECS: readonly DtcCoverageClassSpec[] = Object.freeze([
  { cls: 'STANDARD_STORED', service: '03', subFunction: null, axis: 'core', family: 'obd',
    yieldsRecords: true, serviceDefId: 'obd_stored_dtc', label: 'Mode 03 — saklı' },
  { cls: 'STANDARD_PENDING', service: '07', subFunction: null, axis: 'core', family: 'obd',
    yieldsRecords: true, serviceDefId: 'obd_pending_dtc', label: 'Mode 07 — bekleyen' },
  { cls: 'STANDARD_PERMANENT', service: '0A', subFunction: null, axis: 'core', family: 'obd',
    yieldsRecords: true, serviceDefId: 'obd_permanent_dtc', label: 'Mode 0A — kalıcı' },
  { cls: 'UDS_STATUS_AVAILABILITY', service: '19', subFunction: '01', axis: 'core', family: 'uds',
    yieldsRecords: false, serviceDefId: 'uds_read_dtc_information',
    label: 'UDS 19-01 — status availability + beyan edilen adet' },
  { cls: 'UDS_DTC_BY_STATUS', service: '19', subFunction: '02', axis: 'core', family: 'uds',
    yieldsRecords: true, serviceDefId: 'uds_read_dtc_information',
    label: 'UDS 19-02 — status maskesiyle DTC' },
  { cls: 'UDS_SNAPSHOT_ID', service: '19', subFunction: '03', axis: 'deep', family: 'uds',
    yieldsRecords: false, serviceDefId: 'uds_read_dtc_information',
    label: 'UDS 19-03 — snapshot kayıt kimlikleri' },
  { cls: 'UDS_SNAPSHOT_RECORD', service: '19', subFunction: '04', axis: 'deep', family: 'uds',
    yieldsRecords: false, serviceDefId: null,
    label: 'UDS 19-04 — snapshot kayıt gövdesi' },
  { cls: 'UDS_EXTENDED_DATA', service: '19', subFunction: '06', axis: 'deep', family: 'uds',
    yieldsRecords: false, serviceDefId: 'uds_read_dtc_information',
    label: 'UDS 19-06 — genişletilmiş veri kaydı' },
  { cls: 'UDS_SUPPORTED_DTC', service: '19', subFunction: '0A', axis: 'core', family: 'uds',
    yieldsRecords: true, serviceDefId: 'uds_report_supported_dtc',
    label: 'UDS 19-0A — desteklenen DTC listesi' },
  { cls: 'KWP_DTC_18', service: '18', subFunction: null, axis: 'core', family: 'kwp',
    yieldsRecords: true, serviceDefId: 'kwp_read_dtc_by_status',
    label: 'KWP 0x18 — DTC by status' },
  { cls: 'KWP_DTC_13', service: '13', subFunction: null, axis: 'core', family: 'kwp',
    yieldsRecords: true, serviceDefId: 'kwp_read_dtc_13',
    label: 'KWP 0x13 — eski nesil readDTC' },
]);

const _SPEC_BY_CLASS: ReadonlyMap<DtcCoverageClass, DtcCoverageClassSpec> =
  new Map(DTC_COVERAGE_CLASS_SPECS.map((s) => [s.cls, s]));

export function dtcCoverageSpec(cls: DtcCoverageClass): DtcCoverageClassSpec {
  const s = _SPEC_BY_CLASS.get(cls);
  /* Union üstünden anahtarlandığı için ulaşılamaz; yine de sessiz `undefined`
     dönmek yerine açık hata — sessiz `undefined` ekrana "—" olarak sızardı. */
  if (s === undefined) throw new Error(`bilinmeyen DTC kapsam sınıfı: ${cls}`);
  return s;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KAPSAM SONUCU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir (uç nokta × sınıf) çiftinin ÖLÇÜLEN kapsam gerçeği.
 *
 * `COMPLETE` yalnız TERMİNAL kanıt varsa yazılır. Sorulmayan servis COMPLETE
 * DEĞİLDİR; `NO_RESPONSE` `NO_DTC` DEĞİLDİR; parser düşmesi "ECU temiz" DEĞİLDİR.
 */
export type DtcCoverageOutcome =
  /** Sorgu gitti, terminal yanıt geldi, beyan/ölçüm arasında kayıp YOK. */
  | 'COMPLETE'
  /** Yanıt geldi ama eksik: beyan edilen kayıt sayısı tutmadı ya da parser kaybetti. */
  | 'PARTIAL'
  /** ECU AÇIKÇA "bu servis yok" dedi (7F .. 11 ailesi). Kapsam KAYBI DEĞİLDİR. */
  | 'UNSUPPORTED_MEASURED'
  /** Sorgu gitti, ölçüm alınamadı (sustu · bozuk · hat hatası). */
  | 'UNKNOWN'
  /** Sorgu HİÇ gönderilmedi: bütçe · iptal · bayat oturum · admisyon. */
  | 'DEFERRED'
  /** Gönderilemez: güvenlik kapısı ya da köprü sınırı. ARAÇ kararı DEĞİL. */
  | 'BLOCKED'
  /** Bu protokol ailesinde anlamsız (CAN'de KWP 0x18) — kayıp DEĞİL. */
  | 'NOT_APPLICABLE';

export const DTC_COVERAGE_OUTCOME_LABEL: Readonly<Record<DtcCoverageOutcome, string>> = {
  COMPLETE:             'TAM — terminal kanıt var',
  PARTIAL:              'KISMİ — kayıt eksik',
  UNSUPPORTED_MEASURED: 'DESTEKLENMİYOR (ölçüldü)',
  UNKNOWN:              'BİLİNMİYOR — ölçüm alınamadı',
  DEFERRED:             'ERTELENDİ — sorgu gönderilmedi',
  BLOCKED:              'ENGELLİ — kapı/köprü sınırı',
  NOT_APPLICABLE:       'GEÇERSİZ — protokol ailesi uymuyor',
} as const;

/** Sorgunun HİÇ gönderilmeme gerekçesi — kapalı sözlük, serbest metin YOK. */
export type DtcCoverageSkipReason =
  | 'NOT_QUERIED'
  | 'PROTOCOL_MISMATCH'
  | 'NOT_ADDRESSABLE'
  | 'TRANSPORT_LIMIT'
  | 'SUBFUNCTION_GATE_DENIED'
  | 'NO_SERVICE_DEFINITION'
  | 'BUDGET_EXHAUSTED'
  | 'SESSION_CONDITIONED'
  | 'NO_PRECONDITION_EVIDENCE'
  | 'SERVICE_ABSENT_MEASURED'
  | 'CAPABILITY_REUSED';

export const DTC_COVERAGE_SKIP_LABEL: Readonly<Record<DtcCoverageSkipReason, string>> = {
  NOT_QUERIED:              'sorulmadı',
  PROTOCOL_MISMATCH:        'protokol ailesi uymuyor',
  NOT_ADDRESSABLE:          'uç nokta adreslenemedi',
  TRANSPORT_LIMIT:          'köprü bu isteği taşımıyor',
  SUBFUNCTION_GATE_DENIED:  'alt fonksiyon salt-okunur kapıda YOK',
  NO_SERVICE_DEFINITION:    'CDDL tanımı yok — istek uydurulmaz',
  BUDGET_EXHAUSTED:         'bütçe/iptal/bayat oturum',
  SESSION_CONDITIONED:      'oturum/koşul gerekiyor',
  NO_PRECONDITION_EVIDENCE: 'ön koşul kanıtı ölçülmedi',
  SERVICE_ABSENT_MEASURED:  'servis yokluğu ÖLÇÜLDÜ',
  CAPABILITY_REUSED:        'öğrenilmiş yetenek yeniden kullanıldı',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
   3) PLAN — SAF KARAR
   ══════════════════════════════════════════════════════════════════════════ */

export type DtcCoverageDecision =
  /** Şimdi sorulur (bütçe hakkı ayrıca F1-A'dan alınır). */
  | 'QUERY'
  /** Yalnız ÖN KOŞUL ÖLÇÜLÜRSE sorulur (kör süpürme YASAK). */
  | 'CONDITIONAL'
  /** Sorulmaz; gerekçe `skipReason`da. */
  | 'SKIP';

export interface DtcCoveragePlanStep {
  readonly cls: DtcCoverageClass;
  readonly service: string;
  readonly subFunction: string | null;
  readonly decision: DtcCoverageDecision;
  readonly skipReason: DtcCoverageSkipReason | null;
  /** Ön koşulun adı — `CONDITIONAL` dışında `null`. */
  readonly precondition: string | null;
  readonly detail: string;
}

export interface DtcCoveragePlanInput {
  /** ÖLÇÜLMÜŞ protokol ailesi; `unknown` = ATDPN okunamadı (fail-closed). */
  readonly protocolFamily: 'can' | 'kwp' | 'unknown';
  /** Fiziksel `tx` türetilebildi mi — uydurma adrese istek GÖNDERİLMEZ. */
  readonly addressable: boolean;
  /** Gelişmiş (0x19/0x18/0x13) köprü var mı — NRC/alt fonksiyon ayrımı taşıyan yol. */
  readonly advancedBridge: boolean;
  /**
   * ESKİ APK'nın yalnız 0x19-**02** taşıyan dar köprüsü (`readUdsDtcs`).
   *
   * AYRI ALAN olmak ZORUNDA: o köprü status availability (19-01), snapshot
   * (19-03), genişletilmiş veri (19-06) ve desteklenen DTC (19-0A) isteklerini
   * TAŞIYAMAZ. İkisini tek bayrağa indirmek, eski cihazda gönderilemeyen dört
   * alt fonksiyonu "sorulmuş ama cevapsız" gibi göstermek olurdu.
   */
  readonly legacyUdsBridge: boolean;
  /** Standart Mode 03/07/0A köprüsü var mı. */
  readonly standardBridge: boolean;
  /**
   * Native salt-okunur 0x19 alt fonksiyon kümesi (TS aynası
   * `genericPduTransport.GENERIC_UDS_19_SUBS`). Burada YENİDEN TANIMLANMAZ.
   */
  readonly readOnlyUdsSubFunctions: ReadonlySet<string>;
  /** CDDL'den gelen `ServiceDef.id` kümesi — tanımsız sınıf hattan ÇIKMAZ. */
  readonly serviceDefIds: ReadonlySet<string>;
  /**
   * F4-B/F4-C'nin ÖLÇTÜĞÜ servis varlığı: anahtar `"<servis>|<altFonksiyon>"`
   * (alt fonksiyon yoksa boş). Kayıt YOKSA plan yoklamayı SÜRDÜRÜR — öğrenme
   * bir OPTİMİZASYONDUR, kapsamın ön koşulu DEĞİLDİR.
   */
  readonly measuredPresence: ReadonlyMap<string, ServicePresence>;
}

function _presenceKey(service: string, subFunction: string | null): string {
  return `${service}|${subFunction ?? ''}`;
}

function _step(
  spec: DtcCoverageClassSpec, decision: DtcCoverageDecision,
  skipReason: DtcCoverageSkipReason | null, detail: string,
  precondition: string | null = null,
): DtcCoveragePlanStep {
  return {
    cls: spec.cls, service: spec.service, subFunction: spec.subFunction,
    decision, skipReason, precondition, detail,
  };
}

/**
 * Bir uç noktanın salt-okunur DTC kapsam planını türetir (SAF · DETERMİNİSTİK).
 *
 * ── SIRA BİLİNÇLİDİR (görev §14) ──────────────────────────────────────────
 * ① kullanıcının beklediği temel sonuç (standart modlar) → ② üretici tabanı
 * (19-02 / 19-0A / KWP) → ③ status tamlığı (19-01) → ④ snapshot/extended
 * kanıtı. Dizinin sırası `DTC_COVERAGE_CLASS_SPECS` sırasıdır ve testle
 * kilitlenir; rastgele sıralama, iki taramanın farklı bütçe noktasında
 * kesilmesi ve raporların karşılaştırılamaz olması demektir.
 *
 * ── ROL PLANA GİRMEZ ──────────────────────────────────────────────────────
 * Girdi tipinde rol alanı YOKTUR. Rolü `unknown` olan bir uç nokta, rolü
 * kanıtlanmış bir uç noktayla BİREBİR aynı planı alır.
 */
export function planEcuDtcCoverage(i: DtcCoveragePlanInput): readonly DtcCoveragePlanStep[] {
  const out: DtcCoveragePlanStep[] = [];
  for (const spec of DTC_COVERAGE_CLASS_SPECS) {
    out.push(_planOne(spec, i));
  }
  return out;
}

function _planOne(
  spec: DtcCoverageClassSpec, i: DtcCoveragePlanInput,
): DtcCoveragePlanStep {
  /* ① ADRES — uydurma hedefe tek bayt çıkmaz. Bu kapı HER sınıf için ilktir. */
  if (!i.addressable) {
    return _step(spec, 'SKIP', 'NOT_ADDRESSABLE',
      'fiziksel tx türetilemedi — istek gönderilmez');
  }

  /* ② PROTOKOL AİLESİ — KWP servisleri CAN'de, UDS 0x19 yavaş seri hatta
     anlamsız trafiktir. Protokol BİLİNMİYORSA fail-closed: yalnız protokolden
     bağımsız standart modlar planlanır. */
  if (spec.family === 'kwp' && i.protocolFamily !== 'kwp') {
    return _step(spec, 'SKIP', 'PROTOCOL_MISMATCH',
      i.protocolFamily === 'unknown'
        ? 'protokol ÖLÇÜLMEDİ — KWP dalı açılmaz'
        : 'aktif protokol CAN — KWP servisi gönderilmez');
  }
  if (spec.family === 'uds' && i.protocolFamily === 'kwp') {
    return _step(spec, 'SKIP', 'PROTOCOL_MISMATCH',
      'aktif protokol yavaş seri — UDS 0x19 gönderilmez');
  }

  /* ③ TANIM — CDDL karşılığı olmayan bir sınıf hattan ÇIKAMAZ (uydurma YASAK).
     Bu, 19-04'ün bu turdaki DURUMUDUR ve bilinçlidir. */
  if (spec.serviceDefId === null || !i.serviceDefIds.has(spec.serviceDefId)) {
    return _step(spec, 'SKIP', 'NO_SERVICE_DEFINITION',
      spec.serviceDefId === null
        ? 'CDDL tanımı YOK — istek uydurulmaz'
        : `CDDL tanımı bulunamadı: ${spec.serviceDefId}`);
  }

  /* ④ GÜVENLİK KAPISI — 0x19 alt fonksiyonu native salt-okunur kümede mi.
     Küme VERİ olarak gelir; burada bir izin listesi TANIMLANMAZ. */
  if (spec.service === '19' && spec.subFunction !== null
      && !i.readOnlyUdsSubFunctions.has(spec.subFunction)) {
    return _step(spec, 'SKIP', 'SUBFUNCTION_GATE_DENIED',
      `0x19-${spec.subFunction} salt-okunur kapıda YOK — gönderilemez`);
  }

  /* ⑤ KÖPRÜ — istek taşınamıyorsa bu BİZİM sınırımızdır, aracın kararı DEĞİL.
     `UDS_DTC_BY_STATUS` (19-02) TEK istisnadır: eski dar köprü onu taşır. */
  const bridge = spec.family === 'obd'
    ? i.standardBridge
    : spec.cls === 'UDS_DTC_BY_STATUS'
      ? (i.advancedBridge || i.legacyUdsBridge)
      : i.advancedBridge;
  if (!bridge) {
    return _step(spec, 'SKIP', 'TRANSPORT_LIMIT',
      'köprü bu isteği taşımıyor — araç hakkında hiçbir şey ölçülmedi');
  }

  /* ⑥ ÖLÇÜLMÜŞ YOKLUK — ECU servisin YOKLUĞUNU beyan ettiyse tekrar sormak
     her turda boş bir istek harcamaktır. Kayıt bir OPTİMİZASYONDUR: yalnız
     `ABSENT` (7F..11) atlatır; `UNKNOWN` sınıfları ATLATMAZ (gürültü kanıt
     değildir — F4-C'nin (1) numaralı kuralıyla aynı ilke). */
  const presence = i.measuredPresence.get(_presenceKey(spec.service, spec.subFunction));
  if (presence === 'ABSENT') {
    return _step(spec, 'SKIP', 'SERVICE_ABSENT_MEASURED',
      'ECU 7F-11 ile servisin YOKLUĞUNU beyan etti — yeniden sorulmaz');
  }

  /* ⑦ ÖN KOŞULLU SINIFLAR — kör süpürme YASAK.
     19-06 bir DTC BAŞINA istektir: ölçülmüş bir kayıt yoksa gönderilecek
     hedef de yoktur. 19-03 tüm ECU için tek istektir ve ön koşulu YOKTUR. */
  if (spec.cls === 'UDS_EXTENDED_DATA') {
    return _step(spec, 'CONDITIONAL', null,
      'yalnız ÖLÇÜLMÜŞ DTC kayıtları için gönderilir — kör süpürme YOK',
      'measured_dtc_record');
  }

  return _step(spec, 'QUERY', null, 'plan: sorulur (bütçe hakkı F1-A\'dan alınır)');
}

/* ══════════════════════════════════════════════════════════════════════════
   4) STATUS MASKESİ — ÖLÇÜLEN, VARSAYILAN DEĞİL
   ══════════════════════════════════════════════════════════════════════════ */

export type StatusMaskProvenance = 'MEASURED' | 'ASSUMED_FULL';

export interface StatusMaskPlan {
  /** 19-02 isteğine konacak `DTCStatusMask` (2 hex hane). */
  readonly mask: string;
  readonly provenance: StatusMaskProvenance;
  readonly detail: string;
}

/**
 * 19-01'in ÖLÇTÜĞÜ `statusAvailabilityMask`ten 19-02 sorgu maskesini türetir.
 *
 * ── NEDEN SİHİRLİ `FF` DEĞİL ──────────────────────────────────────────────
 * ISO 14229-1'de ECU, isteğin maskesini kaydın status baytıyla AND'ler ve
 * sonuç sıfır değilse kaydı döner. `statusAvailabilityMask` ECU'nun HANGİ
 * status bitlerini HİÇ kullandığını beyan eder — yani her kaydın status
 * baytı bu maskenin ALT KÜMESİDİR. Dolayısıyla ölçülen maskeyle sorgulamak
 * `FF` ile sorgulamayla AYNI kümeyi verir ama ECU'nun UYGULAMADIĞINI beyan
 * ettiği bitleri İSTEMEZ — bazı ECU'lar tam olarak bu yüzden `FF`i
 * `requestOutOfRange` (0x31) ile reddeder.
 *
 * EK SORGU ÜRETMEZ: 19-01 zaten gönderiliyordu, maskesi ATILIYORDU.
 *
 * ── FAIL-SOFT ─────────────────────────────────────────────────────────────
 * Maske ölçülemediyse ya da `00` ise (hiçbir bit desteklenmiyor beyanı — o
 * maskeyle sorgu HİÇBİR kayıt döndürmezdi) `FF`e düşülür ve künye
 * `ASSUMED_FULL` olur. Varsayım SESSİZ DEĞİLDİR: kanıt satırında görünür.
 */
export function planStatusMask(availabilityMask: string | null | undefined): StatusMaskPlan {
  const m = (availabilityMask ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (m.length !== 2) {
    return { mask: 'FF', provenance: 'ASSUMED_FULL',
      detail: '19-01 maskesi ÖLÇÜLEMEDİ — tam maske varsayıldı' };
  }
  if (m === '00') {
    return { mask: 'FF', provenance: 'ASSUMED_FULL',
      detail: '19-01 maskesi 00 — o maskeyle sorgu boş dönerdi, tam maske varsayıldı' };
  }
  return { mask: m, provenance: 'MEASURED',
    detail: `19-01 ölçtü: status availability ${m}` };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) BEYAN ↔ ÖLÇÜM KARŞILAŞTIRMASI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ECU'nun 19-01'de BEYAN ETTİĞİ kayıt sayısı ile 19-02'den ÇÖZÜLEN sayının
 * karşılaştırması. Bu ürünün "COMPLETE" diyebilmesinin TEK bağımsız tanığıdır.
 */
export type DeclaredCountVerdict =
  /** Beyan ve ölçüm tutuyor — 19-02 tam okundu. */
  | 'MATCH'
  /** ECU daha fazla kayıt beyan etti; okuma EKSİK (çok-çerçeve kesilmesi…). */
  | 'SHORT'
  /** Ölçüm beyandan FAZLA — beyan bayattır ya da başka bir kanal da katkı verdi. */
  | 'OVER'
  /** Beyan ya da ölçüm YOK — karşılaştırma yapılamaz (sahte "tuttu" YASAK). */
  | 'UNKNOWN';

export const DECLARED_COUNT_VERDICT_LABEL: Readonly<Record<DeclaredCountVerdict, string>> = {
  MATCH:   'beyan = ölçüm',
  SHORT:   'ÖLÇÜM EKSİK — ECU daha fazla kayıt beyan etti',
  OVER:    'ölçüm beyandan fazla',
  UNKNOWN: 'karşılaştırılamaz (beyan ya da ölçüm yok)',
} as const;

export function compareDeclaredRecordCount(
  declared: number | null | undefined, parsed: number | null | undefined,
): DeclaredCountVerdict {
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared < 0) return 'UNKNOWN';
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) return 'UNKNOWN';
  if (parsed === declared) return 'MATCH';
  return parsed < declared ? 'SHORT' : 'OVER';
}

/* ══════════════════════════════════════════════════════════════════════════
   6) ÖLÇÜM → KAPSAM SINIFI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Gelişmiş servis sonucunu (`advancedDtcEvidence` sözlüğü) kapsam sınıfına
 * çevirir. **İKİNCİ SÖZLÜK KURULMAZ** — girdi mevcut sözlüktür.
 *
 * `security_required` UNSUPPORTED SAYILMAZ: servis VARDIR, erişim koşulludur
 * ve kapı ZORLANMAZ (görev §15). Kapsam açısından bu bir KAYIPTIR.
 */
export function coverageOutcomeFromAdvanced(
  outcome: AdvancedDtcOutcome | null | undefined,
  declaredVerdict: DeclaredCountVerdict = 'UNKNOWN',
): DtcCoverageOutcome {
  switch (outcome) {
    case 'ok':
      /* Beyan tutmuyorsa "tam" DENMEZ; beyan yoksa (UNKNOWN) tek bağımsız
         tanık da yoktur ama okuma terminaldir → COMPLETE kalır (aksi hâlde
         19-01'i desteklemeyen HER ECU sonsuza dek KISMİ görünürdü). */
      return declaredVerdict === 'SHORT' ? 'PARTIAL' : 'COMPLETE';
    case 'unsupported':
      return 'UNSUPPORTED_MEASURED';
    case 'security_required':
    case 'condition_required':
      return 'UNKNOWN';
    case 'no_response':
    case 'timeout':
    case 'malformed':
    case 'transport_error':
      return 'UNKNOWN';
    case 'not_addressable':
      return 'DEFERRED';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Plan adımının SKIP gerekçesini kapsam sınıfına çevirir (sorgu gitmediğinde).
 *
 * AYRIM PAZARLIKSIZ: kapı/köprü sınırı `BLOCKED` (bizim sınırımız), bütçe ve
 * oturum `DEFERRED` (zamanlama), protokol uyuşmazlığı `NOT_APPLICABLE`
 * (kayıp değil), ölçülmüş yokluk `UNSUPPORTED_MEASURED` (araç gerçeği).
 */
export function coverageOutcomeFromSkip(reason: DtcCoverageSkipReason): DtcCoverageOutcome {
  switch (reason) {
    case 'PROTOCOL_MISMATCH':        return 'NOT_APPLICABLE';
    case 'TRANSPORT_LIMIT':
    case 'SUBFUNCTION_GATE_DENIED':
    case 'NO_SERVICE_DEFINITION':    return 'BLOCKED';
    case 'SERVICE_ABSENT_MEASURED':  return 'UNSUPPORTED_MEASURED';
    case 'CAPABILITY_REUSED':        return 'COMPLETE';
    case 'SESSION_CONDITIONED':
    case 'BUDGET_EXHAUSTED':         return 'DEFERRED';
    case 'NOT_ADDRESSABLE':
    case 'NO_PRECONDITION_EVIDENCE':
    case 'NOT_QUERIED':
    default:                         return 'DEFERRED';
  }
}

/**
 * P0-VDK-F6C — BİR KAPSAM KAYBININ KÖK NEDENİ (mevcut F5-A sözlüğüne eşlenir).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ── NEDEN YENİ SÖZLÜK YAZILMADI ──────────────────────────────────
 * ═══════════════════════════════════════════════════════════════════════
 * `healing/gapModel.RootCauseClass` F5-A'dan beri bu ayırımı taşıyor ve
 * `isMeasurementResolvable` ile **ölçümle kapanabilir** olanı kapanamayandan
 * ayırıyor. İkinci bir sözlük, aynı gerçeği iki farklı adla anlatmak olurdu.
 *
 * ── PAZARLIKSIZ AYRIMLAR ─────────────────────────────────────
 *  · `TRANSPORT_BOUND`  — **ARAÇ KUSURU DEĞİL**, bizim köprü/kapı sınırımız.
 *    Araç kapsamını cezalandırmaz; ayrı sayılır.
 *  · `PARSER_BOUND`     — ECU cevap VERDİ, biz çözemedik. Aynı isteği tekrar
 *    göndermek aynı baytları getirir → **Self-Healing işi DEĞİLDİR**, yazılım
 *    borcudur. `isMeasurementResolvable` bunu zaten `false` döndürür.
 *  · `SESSION_CONDITIONED` — servis muhtemelen VAR, erişim koşullu. Kapı
 *    ZORLANMAZ; ölçüm tamamlanmadığı için kapsam düşer.
 *  · `CAPABILITY_UNMEASURED` — sustu / sorulmadı → hedefli yeniden yoklama
 *    ÖĞRETEBİLİR (F6-D için temiz girdi).
 *
 * TERMİNAL bir satırın kök nedeni YOKTUR → `null`.
 */
export function coverageGapRoot(
  outcome: DtcCoverageOutcome,
  measuredOutcome: string | null | undefined,
  skipReason: DtcCoverageSkipReason | null | undefined,
): RootCauseClass | null {
  /* Ölçülmüş terminal sonuç ve plan dışı sınıf bir KAYIP DEĞİLDİR. */
  if (outcome === 'COMPLETE' || outcome === 'UNSUPPORTED_MEASURED'
      || outcome === 'NOT_APPLICABLE') return null;

  /* Köprü/kapı/tanım sınırı — hattan tek bayt çıkmadı, ARAÇ SUSMADI. */
  if (outcome === 'BLOCKED') return 'TRANSPORT_BOUND';

  if (skipReason === 'SESSION_CONDITIONED') return 'SESSION_CONDITIONED';
  if (skipReason === 'TRANSPORT_LIMIT' || skipReason === 'SUBFUNCTION_GATE_DENIED'
      || skipReason === 'NO_SERVICE_DEFINITION') return 'TRANSPORT_BOUND';

  switch (measuredOutcome) {
    /* Yanıt GELDİ ama çözülemedi → DÜZELTİLECEK YER BİZİM ÇÖZÜCÜMÜZ. */
    case 'malformed':          return 'PARSER_BOUND';
    case 'security_required':
    case 'condition_required': return 'SESSION_CONDITIONED';
    case 'transport_error':    return 'TRANSPORT_BOUND';
    case 'no_response':
    case 'timeout':
    case 'not_addressable':    return 'CAPABILITY_UNMEASURED';
    default: break;
  }
  /* Sorgu hiç gitmedi (bütçe · ön koşul · sorulmadı) → ölçüm ÖĞRETEBİLİR. */
  return 'CAPABILITY_UNMEASURED';
}

/** Bu sınıf ölçülmüş bir KAPSAM KAYBI mı (ürün "temiz" diyemez)? */
export function isCoverageIncomplete(o: DtcCoverageOutcome): boolean {
  return o === 'PARTIAL' || o === 'UNKNOWN' || o === 'DEFERRED';
}

/** Bu sınıf TERMİNAL mi — yani araç hakkında kesin bir şey öğrendik mi? */
export function isCoverageTerminal(o: DtcCoverageOutcome): boolean {
  return o === 'COMPLETE' || o === 'UNSUPPORTED_MEASURED'
      || o === 'NOT_APPLICABLE' || o === 'BLOCKED';
}

/* ══════════════════════════════════════════════════════════════════════════
   7) UÇ NOKTA HÜKMÜ
   ══════════════════════════════════════════════════════════════════════════ */

export type EcuDtcCoverageVerdict =
  /** Planlanan HER sınıf terminal ve en az biri gerçekten okundu. */
  | 'COMPLETE'
  /** En az bir sınıf okundu ama en az biri de eksik/bilinmiyor. */
  | 'PARTIAL'
  /** Hiçbir sınıf okunamadı ama sorgular gitti — sonuç BİLİNMİYOR. */
  | 'UNKNOWN'
  /** Hiç sorgu gönderilmedi: bütçe/oturum/admisyon. */
  | 'DEFERRED'
  /** Yapısal olarak sorulamadı: kapı/köprü/protokol. */
  | 'BLOCKED'
  /** Uç nokta adreslenemedi — hattan tek bayt çıkmadı. */
  | 'NOT_ADDRESSABLE';

export const ECU_DTC_COVERAGE_VERDICT_LABEL: Readonly<Record<EcuDtcCoverageVerdict, string>> = {
  COMPLETE:        'TAM KAPSAM',
  PARTIAL:         'KISMİ KAPSAM',
  UNKNOWN:         'KAPSAM BİLİNMİYOR',
  DEFERRED:        'ERTELENDİ',
  BLOCKED:         'ENGELLİ',
  NOT_ADDRESSABLE: 'ADRESLENEMEDİ',
} as const;

export interface CoverageRollupRow {
  readonly cls: DtcCoverageClass;
  readonly outcome: DtcCoverageOutcome;
}

/** Tek eksenin (core ya da deep) hükmü ve sayımları. */
export interface AxisRollup {
  readonly verdict: EcuDtcCoverageVerdict;
  readonly reasons: readonly string[];
  readonly completeClasses: number;
  readonly incompleteClasses: number;
  /** Bu eksende PLANLANMIŞ birim (plan dışı ve engelli sınıflar HARİÇ). */
  readonly plannedUnits: number;
  /** Terminal ölçüm alan birim (COMPLETE + UNSUPPORTED_MEASURED). */
  readonly terminalUnits: number;
}

export interface CoverageRollup {
  /**
   * **TEMEL (core) hüküm.** Geriye uyum için adı `verdict` kaldı: çağıranların
   * sorduğu şey zaten “bu ECU'nun arıza hafızasını okuyabildim mi” idi.
   * `core.verdict` ile BİREBİR AYNIDIR.
   */
  readonly verdict: EcuDtcCoverageVerdict;
  readonly reasons: readonly string[];
  readonly completeClasses: number;
  readonly incompleteClasses: number;
  /** P0-VDK-F6C — arıza hafızası ekseni. */
  readonly core: AxisRollup;
  /** P0-VDK-F6C — kayıt başına derin kanıt ekseni; `core`u DÜŞÜRMEZ. */
  readonly deep: AxisRollup;
}

/**
 * Sınıf sonuçlarını TEK uç nokta hükmüne indirir (SAF · FAIL-CLOSED).
 *
 * PAZARLIKSIZ: **COMPLETE yalnız planlanan güvenli kapsamın TAMAMI terminal
 * kanıta sahipse** yazılır. Tek bir `UNKNOWN`/`DEFERRED`/`PARTIAL` bile
 * hükmü düşürür — "sorulmayan servis COMPLETE değildir" kuralının kod
 * düzeyindeki karşılığı budur.
 */
/** Tek eksenin hükmünü hesaplar (SAF). `core` ve `deep` AYNI kuralı kullanır. */
function _rollupAxis(rows: readonly CoverageRollupRow[]): AxisRollup {
  if (rows.length === 0) {
    /* Bu eksende hiç sınıf PLANLANMADI (ör. eski köprüde derin eksen yok).
       Bu bir KAYIP DEĞİLDİR ama TAM da değildir — ölçülmemiştir. */
    return { verdict: 'UNKNOWN', reasons: ['bu eksende hiç sınıf değerlendirilmedi'],
      completeClasses: 0, incompleteClasses: 0, plannedUnits: 0, terminalUnits: 0 };
  }

  const complete = rows.filter((r) => r.outcome === 'COMPLETE');
  const incomplete = rows.filter((r) => isCoverageIncomplete(r.outcome));

  /* ── BİRİM SAYIMI (yüzdenin TEK temeli) ─────────────────────────
     PAZARLIKSIZ: her PLANLANMIŞ sınıf **1 birimdir**. Bir servisin 50 DTC
     döndürmesi 50 puan KAZANDIRMAZ — 20 DTC'li ECU ile 0 DTC'li ECU aynı
     ağırlıktadır. DTC SAYISI yüzdeye GİRMEZ.

     PAYDA DıŞI KALANLAR (§7 "PLAN DIŞI ≠ SORULAMADI"):
      · `NOT_APPLICABLE` — protokol ailesi uymuyor (KWP ECU'da UDS). Planın
        dışındadır; eksiklik SAYILMAZ.
      · `BLOCKED` — kapı/köprü sınırı. **ARAÇ KUSURU DEĞİL**; ayrı sayılır
        (`TRANSPORT_CAPABILITY_GAP`) ve araç kapsamını cezalandırmaz. */
  const planned = rows.filter((r) =>
    r.outcome !== 'NOT_APPLICABLE' && r.outcome !== 'BLOCKED');
  const terminal = planned.filter((r) =>
    r.outcome === 'COMPLETE' || r.outcome === 'UNSUPPORTED_MEASURED');

  const counts = { plannedUnits: planned.length, terminalUnits: terminal.length };

  /* Uç nokta hiç ölçülemediyse tüm satırlar DEFERRED/BLOCKED olur; bunu
     "ertelendi" demek yanıltıcıdır — hattan tek bayt ÇIKMADI. */
  const anyMeasured = rows.some((r) =>
    r.outcome === 'COMPLETE' || r.outcome === 'PARTIAL'
    || r.outcome === 'UNSUPPORTED_MEASURED' || r.outcome === 'UNKNOWN');

  if (!anyMeasured) {
    const blockedOnly = rows.every((r) =>
      r.outcome === 'BLOCKED' || r.outcome === 'NOT_APPLICABLE');
    if (blockedOnly) {
      return { verdict: 'BLOCKED',
        reasons: ['hiçbir sınıf gönderilemedi — kapı/köprü/protokol sınırı'],
        completeClasses: 0, incompleteClasses: 0, ...counts };
    }
    return { verdict: 'DEFERRED',
      reasons: ['sorgu HİÇ gönderilmedi — bütçe/oturum/adres kanıtı yok'],
      completeClasses: 0, incompleteClasses: incomplete.length, ...counts };
  }

  const reasons: string[] = [];
  for (const r of incomplete) {
    reasons.push(`${dtcCoverageSpec(r.cls).label}: ${DTC_COVERAGE_OUTCOME_LABEL[r.outcome]}`);
  }

  if (incomplete.length === 0) {
    return complete.length > 0
      ? { verdict: 'COMPLETE',
          reasons: ['planlanan tüm sınıflar terminal kanıta sahip'],
          completeClasses: complete.length, incompleteClasses: 0, ...counts }
      /* Her sınıf "desteklenmiyor/geçersiz" ise ECU hakkında bir şey ÖĞRENDİK
         ama arıza hafızasını OKUMADIK — bu "tam kapsam" DEĞİLDİR. */
      : { verdict: 'UNKNOWN',
          reasons: ['hiçbir DTC servisi okunamadı — yalnız yokluk beyanları ölçüldü'],
          completeClasses: 0, incompleteClasses: 0, ...counts };
  }

  return complete.length > 0
    ? { verdict: 'PARTIAL', reasons,
        completeClasses: complete.length, incompleteClasses: incomplete.length, ...counts }
    : { verdict: 'UNKNOWN', reasons,
        completeClasses: 0, incompleteClasses: incomplete.length, ...counts };
}

/**
 * Sınıf sonuçlarını uç nokta hükmüne indirir (SAF · FAIL-CLOSED · İKİ EKSEN).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ── P0-VDK-F6C: NEDEN İKİ EKSEN (ÖLÇÜLEN KUSUR) ───────────────────
 * ═══════════════════════════════════════════════════════════════════════
 * F6-B tek torba kullanıyordu ve **arıza hafızası kusursuz okunmuş, 0 DTC
 * bulunmuş bir ECU sonsuza dek `KISMİ`** kalıyordu: `19-06` gönderilecek bir
 * kayıt olmadığı için `ERTELENDİ` yazılıyor, o da hükmü düşürüyordu. Yani
 * temiz ve tam okunmuş bir ECU'ya "tam okundu" diyemiyorduk.
 *
 * Artık: **`core` arıza hafızasını ölçer, `deep` kayıt başına ek kanıtı ölçer
 * ve `core`u DÜŞÜRMEZ.** `19-04` yapısal olarak kapalı olduğu için temel
 * kapsamı sonsuza dek kısmi göstermek ölçülmemiş bir eksikliği ölçülmüş gibi
 * sunmak olurdu.
 *
 * `verdict` alanı **core hükmüdür** (geriye uyum: çağıranın sorduğu soru zaten
 * "arıza hafızasını okuyabildim mi" idi).
 */
export function rollupEcuDtcCoverage(rows: readonly CoverageRollupRow[]): CoverageRollup {
  const coreRows = rows.filter((r) => dtcCoverageSpec(r.cls).axis === 'core');
  const deepRows = rows.filter((r) => dtcCoverageSpec(r.cls).axis === 'deep');
  const core = _rollupAxis(coreRows);
  const deep = _rollupAxis(deepRows);
  return {
    verdict: core.verdict,
    reasons: core.reasons,
    completeClasses: core.completeClasses,
    incompleteClasses: core.incompleteClasses,
    core, deep,
  };
}
