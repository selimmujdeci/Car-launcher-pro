/**
 * dtcAuthority — DTC GÖZLEMLERİNİN TEK KANONİK ÜRÜN OTORİTESİ (P0-OBD-CORE-03).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçülen kusur) ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * DTC sonuçları **SEKİZ ayrı yerde** yaşıyordu ve hiçbiri diğerini bilmiyordu:
 *
 *   1. `dtcService._state.codes`      → YALNIZ Mode 03 (DTCState)
 *   2. `dtcService._lastScan`         → 03+07+0A birleşik
 *   3. `dtcScanEvidence` halkası      → servis bazında okuma kanıtı
 *   4. `dtcClearEvidence` halkası     → silme kanıtı
 *   5. `multiEcuScan` raporu          → ECU başına kodlar (panelin YEREL state'i)
 *   6. `DTCPanel` yerel state         → pending · permanent · completeness
 *   7. UDS 0x19 sonucu                → `EcuDtc.fromUds`
 *   8. KWP 0x18 sonucu                → `EcuDtc.fromKwp`
 *
 * Sonuç: **yanlış tüketici yalnız klasik `codes` dizisine bakıyordu** ve
 * multi-ECU / pending / permanent / üretici bulgularını KAÇIRIYORDU. Daha
 * kötüsü, boş dizi sessizce "araç temiz" hükmüne dönüşüyordu:
 *
 *   · `commandExecutor._buildDTCSpeech`  → "Araç sistemleri temiz, sorun yok"
 *   · `platformCoreMaviVoiceWiring`      → "Araç sistemleri temiz, sorun yok"
 *   · `maviTools.read_dtc`               → "Kayıtlı arıza kodu bulunmuyor."
 *   · `useAssistantContextStore`         → boş bağlam = sorun yok
 *
 * Bu dört yol da **okuma yapılıp yapılmadığına BAKMIYORDU**: ECU sustuğunda,
 * tarama hiç koşmadığında ve gerçekten temiz araçta AYNI cümle çıkıyordu.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · **"0 kod" YALNIZ ilgili servis GERÇEKTEN başarılı tarandıysa anlamlıdır.**
 *  · Aynı kod farklı ECU'da → İKİ AYRI gözlem (birleşip kaybolmaz).
 *  · Aynı kod pending + confirmed → İKİ AYRI gözlem (sınıflar karışmaz).
 *  · `NO_DATA` · `UNSUPPORTED` · `TIMEOUT` · `NOT_SCANNED` · `FAILED` AYRI kalır.
 *  · Hiçbir tüketici `observations.length === 0` ile "temiz" DİYEMEZ —
 *    hüküm `evaluateVehicleDtcVerdict()` tek otoritesinden gelir.
 *  · ECU rolü bilinmiyorsa `null` KALIR — adresten rol UYDURULMAZ.
 *  · **OTURUM MÜHRÜ:** başka bir OBD oturumunun gözlemi yeni araca TAŞINMAZ.
 *
 * SAF DEĞİL (durum tutar) ama I/O yapmaz; `Date.now` yalnız damga içindir.
 * Mevcut çözümleyiciler YENİDEN KULLANILIR — yeni parser/ECU keşfi KURULMADI.
 */

import type { EcuRole } from './ecuRoleModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) GÖZLEM
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir DTC gözleminin SINIFI. Beşi AYRI kavramdır; biri diğerine dönüşmez.
 * `UDS`/`KWP` üretici tabanıdır — standart tarama onları GÖREMEZ.
 */
export type DtcObservationClass = 'CONFIRMED' | 'PENDING' | 'PERMANENT' | 'UDS' | 'KWP';

/** Gözlemi üreten servis. Sınıfla BİRE BİR değildir (UDS/KWP ayrı servistir). */
/**
 * P0-OBD-DIAG-02: `'13'` EKLENDİ — ISO 14230-3'te 0x18 ÖNCESİ nesil DTC okuma
 * servisi. Çok sayıda 2000-2008 KWP ECU'su 0x18'i BİLMEZ ve `7F 18 11`
 * (serviceNotSupported) döner; o araçlarda üretici arızası YALNIZ 0x13'te
 * okunur. Ayrı bir kaynak servisi olarak durur çünkü provenance KAYBOLAMAZ:
 * kodun 0x18'den mi 0x13'ten mi geldiği teşhis için farklı bir gerçektir.
 */
export type DtcSourceService = '03' | '07' | '0A' | '19' | '18' | '13';

/** Gözlemin nasıl adreslendiği — fonksiyonel yayın mı, fiziksel ECU mu. */
export type DtcProvenance = 'functional_7DF' | 'physical_ecu';

export const DTC_CLASS_OF_SERVICE_CANON: Readonly<Record<DtcSourceService, DtcObservationClass>> = {
  '03': 'CONFIRMED',
  '07': 'PENDING',
  '0A': 'PERMANENT',
  '19': 'UDS',
  '18': 'KWP',
  /* Sınıf AYNIDIR (üretici KWP tabanı); ayrılan şey KAYNAK SERVİSTİR. */
  '13': 'KWP',
} as const;

export const DTC_OBSERVATION_CLASS_LABEL: Readonly<Record<DtcObservationClass, string>> = {
  CONFIRMED: 'ONAYLANMIŞ',
  PENDING:   'BEKLEYEN',
  PERMANENT: 'KALICI',
  UDS:       'ÜRETİCİ (UDS 0x19)',
  KWP:       'ÜRETİCİ (KWP 0x18)',
} as const;

export interface DtcObservation {
  readonly dtcCode: string;
  readonly dtcClass: DtcObservationClass;
  /** Kararlı ECU kimliği; fonksiyonel okumada `null` (tek ECU'ya ait değil). */
  readonly ecuKey: string | null;
  /** ECU rolü; KANIT yoksa `null` — adresten rol UYDURULMAZ. */
  readonly ecuRole: EcuRole | null;
  readonly rxHeader: string | null;
  readonly txHeader: string | null;
  /** Okuma anındaki ATDPN protokolü; ölçülmediyse `null`. */
  readonly protocol: string | null;
  /** Gözlemin ait olduğu OBD oturumu. `-1` = okunamadı (sahte 0 YASAK). */
  readonly sessionEpoch: number;
  readonly sourceService: DtcSourceService;
  /** Gözlem VARSA okuma başarılıydı — bu alan kaydı okunabilir kılar. */
  readonly scanOutcome: 'ok';
  readonly measuredAt: number;
  readonly provenance: DtcProvenance;
  /** UDS/KWP status baytı; standart Mode 03/07/0A'da ölçülmez. */
  readonly rawStatusByte?: string;
  /**
   * P0-OBD-FINISH — ALT KOD (FTB / failure type byte, 2 hane hex).
   * Car Scanner'ın `P0380(11)` parantezi. Standart Mode 03/07/0A'da YOKTUR.
   */
  readonly failureType?: string;
  /** Ham DTC baytları (hex) — üretici tablosu eşlemesi için KAYBOLMAZ. */
  readonly rawDtc?: string;
  /** Gözlemi üreten read-only alt-fonksiyon; standart modlarda yoktur. */
  readonly sourceSubFunction?: string;
}

/**
 * DEDUP ANAHTARI — kod + SINIF + ECU + ALT KOD + STATUS.
 *
 * NEDEN İLK ÜÇÜ: aynı kod (a) iki farklı ECU'da ve (b) hem bekleyen hem
 * onaylanmış olarak görülebilir; ikisi de GERÇEKTİR ve biri diğerini
 * EZMEMELİDİR. Yalnız koda göre birleştirmek bilgi KAYBIDIR.
 *
 * ── P0-OBD-FINISH: SON İKİSİ NEDEN EKLENDİ ────────────────────────────────
 * ÖLÇÜLEN KUSUR: üçlü anahtar üretici kayıtlarında YETMİYORDU. Aynı ECU'nun
 * aynı UDS sınıfındaki `P0380(11)` · `P0380(12)` · `P0380(13)` · `P0380(96)`
 * kayıtları AYNI anahtara düşüyor ve son yazan diğer ÜÇÜNÜ eziyordu — yani
 * kanonik otoritenin kendisi de kanıt kaybediyordu.
 *
 * GERİ UYUM: alt kod ve status baytı ÖLÇÜLMEMİŞSE (standart Mode 03/07/0A)
 * anahtar BİREBİR eskisi gibi kalır (`P0089|PENDING|7E0`) — sahte bir ayrım
 * üretilmez.
 */
export function observationKey(o: DtcObservation): string {
  const base = `${o.dtcCode}|${o.dtcClass}|${o.ecuKey ?? 'FUNC'}`;
  const ftb = (o.failureType ?? '').trim();
  const st = (o.rawStatusByte ?? '').trim();
  if (ftb === '' && st === '') return base;
  return `${base}|${ftb}|${st}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SERVİS TARAMA SONUCU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir (servis × ECU) okumasının ÖLÇÜLEN sonucu.
 * BEŞİ AYRI KALIR — hiçbiri "temiz"e çevrilmez.
 */
export type DtcScanOutcome =
  /** POZİTİF yanıt geldi. Kod 0 olabilir — bu GERÇEK "kod yok"tur. */
  | 'ok'
  /** ECU SUSTU (NO DATA). "Kod yok" DEĞİL — ölçüm YOK. */
  | 'no_data'
  /** Araç/ECU bu servisi HİÇ bilmiyor (açık negatif yanıt). */
  | 'unsupported'
  /** Zaman aşımı — yanıt gelmedi. */
  | 'timeout'
  /** Hat/protokol hatası veya çözümlenemeyen yanıt. */
  | 'failed'
  /** Hiç sorulmadı. */
  | 'not_scanned';

export const DTC_SCAN_OUTCOME_LABEL: Readonly<Record<DtcScanOutcome, string>> = {
  ok:          'okundu',
  no_data:     'ECU YANIT VERMEDİ',
  unsupported: 'servis desteklenmiyor',
  timeout:     'ZAMAN AŞIMI',
  failed:      'okuma DÜŞTÜ',
  not_scanned: 'HİÇ SORULMADI',
} as const;

/** Yalnız `ok` bir ÖLÇÜMDÜR; gerisi ölçüm YOKLUĞUDUR. */
export function isMeasuredOutcome(o: DtcScanOutcome): boolean {
  return o === 'ok';
}

/**
 * Kapsam kaybı mı? `unsupported` **kayıp DEĞİLDİR** (araçta o servis yok —
 * ölçülmüş bir gerçektir). Gerisi kapsam kaybıdır.
 */
export function isCoverageLoss(o: DtcScanOutcome): boolean {
  return o === 'no_data' || o === 'timeout' || o === 'failed' || o === 'not_scanned';
}

export interface DtcServiceScan {
  readonly service: DtcSourceService;
  /** `null` = fonksiyonel (7DF) okuma. */
  readonly ecuKey: string | null;
  readonly ecuRole: EcuRole | null;
  readonly txHeader: string | null;
  readonly outcome: DtcScanOutcome;
  readonly sessionEpoch: number;
  readonly measuredAt: number;
  /** Bu okumadan çıkan kod adedi. `outcome !== 'ok'` ise 0 ve ANLAMSIZDIR. */
  readonly codeCount: number;
  readonly protocol: string | null;
  /** Gelişmiş servis ayrımı; ana verdict sonucu değişmez, kanıt kaybolmaz. */
  readonly diagnosticOutcome?: string;
}

function scanKey(s: DtcServiceScan): string {
  return `${s.service}|${s.ecuKey ?? 'FUNC'}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DEFTER (oturum mühürlü)
   ══════════════════════════════════════════════════════════════════════════ */

/** Tavan — sınırsız gözlem cihazda bellek sorunudur. */
export const DTC_OBSERVATION_MAX = 240;
export const DTC_SCAN_MAX = 96;

let _observations = new Map<string, DtcObservation>();
let _scans = new Map<string, DtcServiceScan>();
let _epoch = -1;
let _lastScanAt: number | null = null;

/** Yeni oturum: eski gözlemler DÜŞER (araç değişmiş olabilir). */
function _sealSession(epoch: number): void {
  if (_epoch !== epoch) {
    _observations = new Map();
    _scans = new Map();
    _lastScanAt = null;
    _epoch = epoch;
  }
}

export type RecordObservationInput =
  Omit<DtcObservation, 'measuredAt' | 'scanOutcome'> & { readonly measuredAt?: number };

/** Gözlem yazar. ASLA throw etmez — defter ürünü düşüremez. */
export function recordDtcObservation(input: RecordObservationInput): void {
  try {
    _sealSession(input.sessionEpoch);
    if (_observations.size >= DTC_OBSERVATION_MAX) return;   // bounded
    const entry: DtcObservation = {
      ...input,
      scanOutcome: 'ok',
      measuredAt: input.measuredAt ?? Date.now(),
    };
    _observations.set(observationKey(entry), entry);
  } catch { /* kanıt kaydı ürünü DÜŞÜRMEZ */ }
}

export type RecordScanInput =
  Omit<DtcServiceScan, 'measuredAt' | 'codeCount'> &
  { readonly measuredAt?: number; readonly codeCount?: number };

/**
 * Servis tarama sonucunu yazar. **Her tarama TURU bunu çağırmalıdır** —
 * gözlem yoksa bile: "0 kod" hükmü ancak buradan doğar.
 */
export function recordDtcServiceScan(input: RecordScanInput): void {
  try {
    _sealSession(input.sessionEpoch);
    if (_scans.size >= DTC_SCAN_MAX && !_scans.has(scanKey(input as DtcServiceScan))) return;
    const at = input.measuredAt ?? Date.now();
    const entry: DtcServiceScan = {
      ...input,
      measuredAt: at,
      /* Başarısız okumanın kod adedi ANLAMSIZDIR — sahte 0 yazılmaz, 0 yazılır
         ama `outcome` onu okunamaz kılar. */
      codeCount: input.outcome === 'ok' ? (input.codeCount ?? 0) : 0,
    };
    _scans.set(scanKey(entry), entry);
    _lastScanAt = _lastScanAt === null ? at : Math.max(_lastScanAt, at);
  } catch { /* fail-soft */ }
}

/**
 * Bir tarama turu BAŞLARKEN o oturumun ÖNCEKİ gözlemlerini düşürür.
 *
 * NEDEN GEREKLİ: silme sonrası yeniden okuma ya da ikinci bir tarama, artık
 * OLMAYAN kodları defterde bırakırsa ekran "kod hâlâ var" der. Tur bazlı
 * temizlik AYNI oturum içinde de zorunludur.
 *
 * `scans` KORUNUR — tur ortasında hüküm "hiç taranmadı"ya düşmesin diye;
 * her servis kendi sonucunu yeniden yazacaktır.
 */
export function beginDtcScanRound(epoch: number): void {
  try {
    _sealSession(epoch);
    _observations = new Map();
  } catch { /* fail-soft */ }
}

/** Yeni OBD oturumu / araç değişimi — defter tamamen düşer. */
export function resetDtcAuthorityForSession(epoch: number): void {
  _observations = new Map();
  _scans = new Map();
  _lastScanAt = null;
  _epoch = epoch;
}

/** Test izolasyonu. */
export function _resetDtcAuthorityForTest(): void {
  _observations = new Map();
  _scans = new Map();
  _lastScanAt = null;
  _epoch = -1;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) SNAPSHOT + HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export interface DtcAuthoritySnapshot {
  readonly sessionEpoch: number;
  readonly observations: readonly DtcObservation[];
  readonly scans: readonly DtcServiceScan[];
  readonly lastScanAt: number | null;
}

/** Salt-okunur kopya — çağıran defteri bozamaz. */
export function getDtcAuthoritySnapshot(): DtcAuthoritySnapshot {
  return {
    sessionEpoch: _epoch,
    observations: [..._observations.values()],
    scans:        [..._scans.values()],
    lastScanAt:   _lastScanAt,
  };
}

/**
 * ARAÇ HÜKMÜ — "temiz" demenin TEK yeri.
 *
 *  · `issues`   : en az bir gözlem var.
 *  · `clean`    : gözlem YOK **VE** en az bir servis `ok` **VE** hiçbir
 *                 servis kapsam kaybında değil. ("kanıtlı temiz")
 *  · `unproven` : gözlem yok ama kanıt eksik → **"temiz" DENEMEZ.**
 *  · `not_scanned`: hiç tarama koşmadı.
 */
export type VehicleDtcVerdict = 'issues' | 'clean' | 'unproven' | 'not_scanned';

export interface VehicleDtcVerdictResult {
  readonly verdict: VehicleDtcVerdict;
  /** Kullanıcıya söylenecek DÜRÜST cümle — tüketiciler bunu ELLE yazmaz. */
  readonly message: string;
  readonly observationCount: number;
  /** Kapsam kaybı yaşayan servisler (teşhis için). */
  readonly lossServices: readonly DtcSourceService[];
  /** `ok` dönen servis adedi. 0 iken "temiz" İMKÂNSIZDIR. */
  readonly measuredServices: number;
}

export function evaluateVehicleDtcVerdict(
  snap: DtcAuthoritySnapshot = getDtcAuthoritySnapshot(),
): VehicleDtcVerdictResult {
  const observationCount = snap.observations.length;
  const measuredServices = snap.scans.filter((s) => isMeasuredOutcome(s.outcome)).length;
  const lossSet = new Set<DtcSourceService>();
  for (const s of snap.scans) if (isCoverageLoss(s.outcome)) lossSet.add(s.service);
  const lossServices = [...lossSet];

  /* BULGU HER ŞEYDEN ÖNCE GELİR: kapsam eksik olsa da bulgu bulgudur. */
  if (observationCount > 0) {
    return {
      verdict: 'issues',
      message: `${observationCount} arıza gözlemi var.`,
      observationCount, lossServices, measuredServices,
    };
  }

  if (snap.scans.length === 0) {
    return {
      verdict: 'not_scanned',
      message: 'Arıza taraması yapılmadı — bu "arıza yok" DEMEK DEĞİLDİR.',
      observationCount, lossServices, measuredServices,
    };
  }

  /* KANIT KAPISI: tek bir ölçüm bile yoksa "temiz" İMKÂNSIZDIR. */
  if (measuredServices === 0) {
    return {
      verdict: 'unproven',
      message: 'Hiçbir arıza servisi okunamadı — sonuç BİLİNMİYOR, "arıza yok" DEMEK DEĞİLDİR.',
      observationCount, lossServices, measuredServices,
    };
  }

  /* Kapsam kaybı varsa "temiz" DENMEZ — okunmayan yerde kod olabilir. */
  if (lossServices.length > 0) {
    return {
      verdict: 'unproven',
      message: 'Kısmi tarama — bazı servisler okunamadı, sonuç kesin değil.',
      observationCount, lossServices, measuredServices,
    };
  }

  return {
    verdict: 'clean',
    message: 'Taranan tüm servisler okundu ve arıza kodu bulunmadı.',
    observationCount, lossServices, measuredServices,
  };
}

/**
 * Tüketiciler için TEK KAPI: "temiz" diyebilir miyim?
 *
 * `observations.length === 0` ile "temiz" demek YASAKTIR; bu fonksiyon o
 * yasağın kod düzeyindeki karşılığıdır.
 */
export function isProvenClean(
  snap: DtcAuthoritySnapshot = getDtcAuthoritySnapshot(),
): boolean {
  return evaluateVehicleDtcVerdict(snap).verdict === 'clean';
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ÖZETLER (LAB tüketir — SAF)
   ══════════════════════════════════════════════════════════════════════════ */

export interface DtcAuthoritySummary {
  readonly total: number;
  readonly byClass: Readonly<Record<DtcObservationClass, number>>;
  /** ECU anahtarı → gözlem sayısı. Fonksiyonel okuma `FUNC` altında toplanır. */
  readonly byEcu: ReadonlyArray<{ ecuKey: string; ecuRole: EcuRole | null; count: number }>;
  readonly scannedServices: number;
  readonly skippedServices: number;
  readonly failedServices: number;
  readonly lastScanAt: number | null;
  readonly sessionEpoch: number;
}

const _EMPTY_BY_CLASS: Record<DtcObservationClass, number> = {
  CONFIRMED: 0, PENDING: 0, PERMANENT: 0, UDS: 0, KWP: 0,
};

export function summarizeDtcAuthority(
  snap: DtcAuthoritySnapshot = getDtcAuthoritySnapshot(),
): DtcAuthoritySummary {
  const byClass = { ..._EMPTY_BY_CLASS };
  const ecuMap = new Map<string, { ecuKey: string; ecuRole: EcuRole | null; count: number }>();

  for (const o of snap.observations) {
    byClass[o.dtcClass] = (byClass[o.dtcClass] ?? 0) + 1;
    const key = o.ecuKey ?? 'FUNC';
    const cur = ecuMap.get(key);
    if (cur) cur.count++;
    else ecuMap.set(key, { ecuKey: key, ecuRole: o.ecuRole, count: 1 });
  }

  let scanned = 0, skipped = 0, failed = 0;
  for (const s of snap.scans) {
    if (s.outcome === 'ok') scanned++;
    else if (s.outcome === 'unsupported' || s.outcome === 'not_scanned') skipped++;
    else failed++;
  }

  return {
    total: snap.observations.length,
    byClass,
    byEcu: [...ecuMap.values()],
    scannedServices: scanned,
    skippedServices: skipped,
    failedServices: failed,
    lastScanAt: snap.lastScanAt,
    sessionEpoch: snap.sessionEpoch,
  };
}
