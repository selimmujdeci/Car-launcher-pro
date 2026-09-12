/**
 * deepScanModel — Deep Scan durum/faz modeli ve SAF yardımcıları.
 *
 * Bu dosya YALNIZ tip + sabit + SAF fonksiyon içerir: servis import'u YOK, yan
 * etki YOK, timer YOK. Böylece kural motoru (hangi faz kontak ister? progress
 * tabanı nedir? uyarı metni nasıl temizlenir?) cihazsız, mock'suz test edilir.
 *
 * VİZYON (docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md): Deep Scan, yeni bir
 * araç ilk kez bağlandığında kapsamlı keşif yapar; sonucu kalıcı öğrenir; sonraki
 * bağlantılarda tam tarama yerine yalnız DEĞİŞİKLİK KONTROLÜ yapar. Bu dosya o
 * davranışın karar modelini (FULL_SCAN / CHANGE_CHECK) taşır.
 *
 * ⚠️ KONTAK (ignition): Bu depoda kontak/ACC durumunu yayan GERÇEK bir kaynak
 * YOKTUR (`obdDiagnosticTypes.IGNITION_OFF` yalnız bir mesaj sabiti — hiçbir yerde
 * emit edilmiyor). Bu yüzden `ignitionConfirmed` üç durumludur: `true` (dışarıdan
 * doğrulandı) · `false` (dışarıdan kapalı bildirildi) · `null` (BİLİNMİYOR).
 * `null` kontak AÇIK sayılmaz — aktif araç sorgusu gerektiren fazlar açılmaz.
 * Kontak formülü BU PR'DA UYDURULMAZ.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Durum / faz / mod
 * ════════════════════════════════════════════════════════════════════════ */

export type DeepScanStatus =
  | 'idle'
  | 'waiting_for_ignition'
  | 'preparing'
  | 'scanning'
  | 'analyzing'
  | 'completed'
  | 'paused'
  | 'cancelled'
  | 'failed';

export type DeepScanPhase =
  | 'vehicle_identity'
  | 'protocol_detection'
  | 'ecu_discovery'
  | 'standard_pid_discovery'
  | 'manufacturer_did_discovery'
  | 'firmware_inventory'
  | 'capability_analysis'
  | 'fingerprint_update'
  | 'knowledge_update'
  | 'evidence_update'
  | 'change_detection'
  | 'report_generation';

/** Tarama modu — yeni araç mı, öğrenilmiş araç mı. */
export type DeepScanMode = 'FULL_SCAN' | 'CHANGE_CHECK';

/** Terminal (artık mutasyon kabul etmeyen) durumlar. */
export const TERMINAL_STATUSES: readonly DeepScanStatus[] = ['completed', 'cancelled', 'failed'];

export function isTerminalStatus(status: DeepScanStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Faz sınıflandırması — AKTİF (araca sorgu gönderir) vs OFFLINE (yerel analiz)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Araca AKTİF sorgu gönderen faz ADLARI (tip düzeyi). `OfflinePhase` bu kümenin
 * tümleyeni olarak TÜRETİLİR → offline yüzeyler aktif faz KABUL EDEMEZ (compile-time).
 */
export type ActivePhase =
  | 'vehicle_identity'
  | 'protocol_detection'
  | 'ecu_discovery'
  | 'standard_pid_discovery'
  | 'manufacturer_did_discovery'
  | 'firmware_inventory';

/**
 * Araca HİÇ sorgu göndermeyen faz adları — `DeepScanPhase` eksi `ActivePhase`.
 * `Exclude` ile türetildiği için yeni bir faz eklenirse ikisinden birine düşmek
 * ZORUNDADIR; sessizce "sınıflandırılmamış" faz oluşamaz.
 */
export type OfflinePhase = Exclude<DeepScanPhase, ActivePhase>;

/**
 * Araca AKTİF sorgu gönderen fazlar. Bunlar YALNIZ `ignitionConfirmed === true`
 * iken çalışabilir. `vehicle_identity` (Mode 09 VIN sorgusu) ve
 * `firmware_inventory` (DID sorgusu) de araca istek gönderir → aktif sayılır.
 */
export const ACTIVE_PHASES: readonly ActivePhase[] = [
  'vehicle_identity',
  'protocol_detection',
  'ecu_discovery',
  'standard_pid_discovery',
  'manufacturer_did_discovery',
  'firmware_inventory',
];

/**
 * Araca hiç sorgu göndermeyen, önceden toplanmış veriyi işleyen fazlar.
 * Kontak kapalı/bilinmiyorken de çalışabilirler.
 */
export const OFFLINE_PHASES: readonly OfflinePhase[] = [
  'capability_analysis',
  'fingerprint_update',
  'knowledge_update',
  'evidence_update',
  'change_detection',
  'report_generation',
];

/**
 * Offline pass'in DETERMİNİSTİK yürütme sırası. `DEEP_SCAN_PHASE_SEQUENCE`'in offline
 * alt-dizisiyle AYNI göreli sırayı korur — ama aktif fazlar kümede HİÇ YOKTUR: offline
 * pass onları "atlamaz", göremez bile. Sekans tuzağı (aktif faz faz-0'da bloke eder)
 * bu yüzden yapısal olarak oluşamaz.
 */
export const OFFLINE_PHASE_SEQUENCE: readonly OfflinePhase[] = [
  'capability_analysis',
  'fingerprint_update',
  'knowledge_update',
  'evidence_update',
  'change_detection',
  'report_generation',
];

/**
 * TÜM fazlar — aktif + offline. `DEEP_SCAN_PHASE_SEQUENCE` (orchestrator) ile AYNI
 * içerik ve sıradadır; kilit testi bunu doğrular. Model katmanı orchestrator'ı import
 * EDEMEZ (döngü) → sekans burada bağımsız türetilir.
 */
export const ALL_DEEP_SCAN_PHASES: readonly DeepScanPhase[] = [
  ...ACTIVE_PHASES,
  ...OFFLINE_PHASES,
];

/** Faz offline mı (tip daraltıcı — aktif faz yüzeylerinde çalışma-zamanı ikinci kilidi). */
export function isOfflinePhase(phase: DeepScanPhase): phase is OfflinePhase {
  return !isActivePhase(phase);
}

/** Faz araca aktif sorgu gönderir mi (tip daraltıcı). */
export function isActivePhase(phase: DeepScanPhase): phase is ActivePhase {
  return (ACTIVE_PHASES as readonly DeepScanPhase[]).includes(phase);
}

/**
 * Kritik fazlar: bunlar başarısız olursa tarama anlamını yitirir → `failed`.
 * Diğer fazların hatası uyarıya çevrilir ve faz ATLANABİLİR (fail-soft).
 */
export const CRITICAL_PHASES: readonly DeepScanPhase[] = [
  'vehicle_identity',
  'protocol_detection',
];

export function isCriticalPhase(phase: DeepScanPhase): boolean {
  return CRITICAL_PHASES.includes(phase);
}

/**
 * Bir faz verilen kontak durumunda çalıştırılabilir mi.
 * `ignitionConfirmed === true` DEĞİLSE (false VEYA null=bilinmiyor) aktif fazlar
 * REDDEDİLİR — "kontak açıkmış gibi varsayma" kuralı (fail-closed).
 */
export function canRunPhase(phase: DeepScanPhase, ignitionConfirmed: boolean | null): boolean {
  if (!isActivePhase(phase)) return true;      // offline faz: her koşulda serbest
  return ignitionConfirmed === true;
}

/* ══════════════════════════════════════════════════════════════════════════
 * İlerleme (progress) modeli — deterministik + monotonik
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Faz tabanları: bir faza girildiğinde progress EN AZ bu değere çıkar (asla
 * düşmez). Sahte ilerleme üretilmez — bunlar faz SIRASININ deterministik
 * yansımasıdır; faz içi ince ilerleme yalnız `updateProgress()` ile ÖLÇÜLMÜŞ
 * değer olarak gelir (gerçek orchestrator ayrı PR).
 */
export const PHASE_PROGRESS_FLOOR: Readonly<Record<DeepScanPhase, number>> = {
  vehicle_identity:            5,
  protocol_detection:         12,
  ecu_discovery:              20,
  standard_pid_discovery:     35,
  manufacturer_did_discovery: 50,
  firmware_inventory:         62,
  capability_analysis:        70,
  fingerprint_update:         78,
  knowledge_update:           84,
  evidence_update:            89,
  change_detection:           94,
  report_generation:          97,
};

/** [0,100] aralığına sabitler; geçersiz sayı → 0. */
export function clampProgress(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/** Monotonik ilerleme: yeni değer mevcuttan küçükse mevcut korunur. */
export function monotonicProgress(current: number, next: unknown): number {
  const c = clampProgress(current);
  const n = clampProgress(next);
  return n > c ? n : c;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gizlilik — uyarı/özet metinlerinden hassas içerik temizlenir
 * ════════════════════════════════════════════════════════════════════════ */

/** Bounded: en fazla bu kadar uyarı tutulur (en eskisi düşer). */
export const MAX_WARNINGS = 16;
/** Bounded: en fazla bu kadar dinleyici (duplicate Set semantiğiyle zaten engellenir). */
export const MAX_LISTENERS = 32;
/** Uyarı metni üst sınırı. */
export const MAX_WARNING_CHARS = 160;

const VIN_RE   = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const MAC_RE   = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const COORD_RE = /-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g;
/** Ham CAN/OBD frame şüphesi: 8+ karakterlik sürekli hex öbeği. */
const RAW_HEX_RE = /\b[0-9A-Fa-f]{8,}\b/g;
/** Anahtar/secret şüphesi: uzun base64/token benzeri diziler. */
const SECRET_RE = /\b(?:sk|pk|api|key|token|bearer)[-_]?[A-Za-z0-9_-]{12,}\b/gi;

/**
 * Uyarı/özet metnini gizlilik açısından temizler: VIN · MAC · koordinat · ham hex
 * (CAN frame) · API key/secret kalıpları `[redacted]` ile değiştirilir, sonuç
 * kırpılır. SAF — girdiyi mutate etmez. Sıra önemli: SECRET önce (içinde hex
 * öbeği barındırabilir), RAW_HEX en sonda.
 */
export function sanitizeText(input: unknown, maxChars: number = MAX_WARNING_CHARS): string {
  if (typeof input !== 'string') return '';
  const cleaned = input
    .replace(SECRET_RE, '[redacted]')
    .replace(MAC_RE, '[redacted]')
    .replace(VIN_RE, '[redacted]')
    .replace(COORD_RE, '[redacted]')
    .replace(RAW_HEX_RE, '[redacted]')
    .trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Snapshot / rapor / olaylar
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tarama raporu özeti. Ham veri TAŞIMAZ — yalnız sayımlar ve bayraklar.
 * (`useAssistantContextStore` deepScan bölümüyle alan-uyumlu: completed /
 * progress / newDiscoveriesCount / changedFirmware / changedECU.)
 */
export interface DeepScanReportSummary {
  readonly mode:                DeepScanMode;
  readonly ecuCount:            number;
  readonly pidCount:            number;
  readonly didCount:            number;
  readonly newDiscoveriesCount: number;
  readonly firmwareCheckedCount: number;
  readonly changedFirmware:     boolean;
  readonly changedEcu:          boolean;
  readonly warningCount:        number;
  /** Tarama süresi (ms) — `startedAt`→`completedAt` farkı. */
  readonly durationMs:          number;
  /** Serbest, TEMİZLENMİŞ not (opsiyonel). Ham veri içermez. */
  readonly note:                string | null;
}

/** Dondurulmuş, ham/gizli alan içermeyen tarama durumu. */
export interface DeepScanSnapshot {
  readonly scanId:                string | null;
  /** Araç parmak izi HASH'i (VIN değil — türetilmiş kimlik). */
  readonly vehicleFingerprintHash: string | null;
  readonly status:                DeepScanStatus;
  readonly mode:                  DeepScanMode | null;
  readonly phase:                 DeepScanPhase | null;
  readonly progressPercent:       number;
  readonly startedAt:             number | null;
  readonly updatedAt:             number | null;
  readonly completedAt:           number | null;
  readonly isFirstScan:           boolean;
  /** Aktif fazlar için kontak gerekiyor mu (bu servis için daima true). */
  readonly ignitionRequired:      boolean;
  /** `null` = BİLİNMİYOR (gerçek kaynak yok) — açık VARSAYILMAZ. */
  readonly ignitionConfirmed:     boolean | null;
  readonly discoveredEcuCount:    number;
  readonly discoveredPidCount:    number;
  readonly discoveredDidCount:    number;
  readonly newDiscoveriesCount:   number;
  readonly changedFirmware:       boolean;
  readonly changedEcu:            boolean;
  readonly warnings:              readonly string[];
  readonly errorCode:             string | null;
  readonly reportSummary:         DeepScanReportSummary | null;
}

/** Olay tipleri — `subscribe()` ile yayınlanır. */
export type DeepScanEventType =
  | 'scan_started'
  | 'ignition_required'
  | 'phase_changed'
  | 'progress_changed'
  | 'ecu_discovered'
  | 'pid_discovered'
  | 'did_discovered'
  | 'firmware_checked'
  | 'change_detected'
  | 'scan_paused'
  | 'scan_resumed'
  | 'scan_completed'
  | 'scan_failed'
  | 'scan_cancelled';

/** Olay zarfı. `snapshot` dondurulmuş; `reason`/`code` temizlenmiş metindir. */
export interface DeepScanEvent {
  readonly type:     DeepScanEventType;
  readonly at:       number;
  readonly snapshot: DeepScanSnapshot;
  readonly reason:   string | null;
}

export type DeepScanListener = (event: DeepScanEvent) => void;

/* ══════════════════════════════════════════════════════════════════════════
 * Girdi tipleri (servis API'si) — hepsi salt-okunur, mutate EDİLMEZ
 * ════════════════════════════════════════════════════════════════════════ */

export interface StartDeepScanInput {
  /** Araç parmak izi hash'i (VIN DEĞİL). Bilinmiyorsa boş bırakılabilir. */
  readonly vehicleFingerprintHash?: string;
  /**
   * Bu araç için daha ÖNCE tamamlanmış bir Deep Scan var mı. Çağıran bilir
   * (kalıcı geçmiş deposu BU PR'ın kapsamı DEĞİL). true → CHANGE_CHECK.
   */
  readonly hasCompletedScanBefore?: boolean;
  /** Kontak durumu — `true` dışında her değer aktif fazları KAPALI tutar. */
  readonly ignitionConfirmed?: boolean | null;
}

export interface EcuDiscoveryInput {
  readonly ecuAddress: string;
  /** Katalogda olmayan / ilk kez görülen mi. */
  readonly isNew?: boolean;
}

export interface SignalDiscoveryInput {
  /** PID veya DID (hex, ör. '0C' / 'F190'). */
  readonly pidOrDid: string;
  readonly ecuAddress?: string;
  readonly isNew?: boolean;
}

export interface FirmwareResultInput {
  readonly ecuAddress?: string;
  /** Değişiklik TESPİT EDİLDİ mi. Bu servis firmware sürümünü SAKLAMAZ. */
  readonly changed?: boolean;
}

export interface ChangeDetectionInput {
  readonly changedFirmware?: boolean;
  readonly changedEcu?: boolean;
  readonly reason?: string;
}

/** `completeScan()` için opsiyonel not (sayımlar servis tarafından üretilir). */
export interface CompleteDeepScanInput {
  readonly note?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Mod kararı (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tarama modunu belirler:
 *  - Daha önce TAMAMLANMIŞ tarama YOKSA → yeni/ilk araç → `FULL_SCAN`
 *  - Daha önce tamamlanmışsa → aynı araca her bağlantıda tam tarama YAPMA →
 *    `CHANGE_CHECK`
 */
export function resolveScanMode(hasCompletedScanBefore: boolean | undefined): DeepScanMode {
  return hasCompletedScanBefore === true ? 'CHANGE_CHECK' : 'FULL_SCAN';
}

/** `isFirstScan` mod kararının ikizidir — tek kaynak, tutarlılık garantisi. */
export function resolveIsFirstScan(hasCompletedScanBefore: boolean | undefined): boolean {
  return hasCompletedScanBefore !== true;
}

/** Kontak üç-durumlu normalizasyon: yalnız gerçek boolean kabul, aksi → null. */
export function normalizeIgnition(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Parmak izi hash'i doğrulaması. `vehicleFingerprintService.fingerprintHash()`
 * 16 haneli hex üretir; ileriye dönük olarak 8–64 hex kabul edilir.
 *
 * ⚠️ VIN SIZINTI KAPISI: VIN 17 karakterdir → 17 uzunluğundaki her girdi
 * REDDEDİLİR. Hex olmayan her girdi de reddedilir (`null`). Bu sayede snapshot'a
 * yanlışlıkla VIN/plaka/serbest metin yazılamaz. `sanitizeText()` burada
 * KULLANILMAZ: o, uzun hex öbeklerini ham CAN frame sanıp hash'i imha ederdi.
 */
export function normalizeFingerprintHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v.length === 17) return null;                  // VIN uzunluğu — asla kabul etme
  if (!/^[0-9a-fA-F]{8,64}$/.test(v)) return null;
  return v.toLowerCase();
}

/* ══════════════════════════════════════════════════════════════════════════
 * COMPLETION TRUTH — Coverage Ledger + TEK karar otoritesi (SAF)
 *
 * SORUN (düzeltilen): handler'ı olmayan faz `{ status:'skipped' }` üretiyordu ve
 * `skipped` başarı EŞDEĞERİ sayılıyordu → pipeline sonuna ulaşıyor, `completeScan()`
 * çağrılıyor ve `hasCompletedFullScan` GERÇEK KAPSAM OLMADAN true oluyordu.
 *
 * ÇÖZÜM: her tarama için tipli, bounded bir KAPSAM KÜTÜĞÜ tutulur; `full` kararı
 * YALNIZ `evaluateDeepScanCompletion()` tarafından verilir. Dağınık `status === 'completed'`
 * kontrolü YASAK — tek karar otoritesi budur. Bilinmeyen faz durumu FAIL-CLOSED'dur.
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir fazın KAPSAM açısından sonucu (tipli — serbest metin yok).
 * `unknown`: tanınmayan/eksik durum → fail-closed (full completion'ı ENGELLER).
 */
export type DeepScanPhaseCompletionStatus =
  | 'completed'
  | 'skipped'
  | 'handler_unavailable'
  | 'failed'
  | 'timeout'
  | 'budget_exhausted'
  | 'partial'
  | 'cancelled'
  | 'unknown';

/** Taramanın nihai kapsam kararı. */
export type DeepScanFinalVerdict = 'full' | 'partial' | 'incomplete' | 'failed' | 'cancelled';

/** `hasCompletedFullScan` üretme yetkisi (tipli — boolean bayrak dağılımı yok). */
export type DeepScanCompletionEligibility = 'eligible' | 'ineligible';

/** Neden full sayılmadı — KAPALI KÜME (bounded, PII-güvenli, persist edilebilir). */
export type DeepScanIncompleteReason =
  | 'no_required_phases'
  | 'required_phase_not_attempted'
  | 'required_phase_handler_unavailable'
  | 'required_phase_skipped'
  | 'required_phase_failed'
  | 'required_phase_timeout'
  | 'required_phase_budget_exhausted'
  | 'required_phase_partial'
  | 'required_phase_cancelled'
  | 'required_phase_unknown_status'
  | 'scan_cancelled'
  | 'scan_failed'
  | 'safety_blocked'
  | 'persistence_not_finalized'
  | 'completion_evidence_missing';

/** Kütüğe yazılan tek faz kaydı. */
export interface DeepScanPhaseLedgerEntry {
  readonly phase:  DeepScanPhase;
  readonly status: DeepScanPhaseCompletionStatus;
}

/**
 * KAPSAM KÜTÜĞÜ — bir taramanın gerçekte NE KADARININ yapıldığının tipli kanıtı.
 * Bounded: her dizi en fazla faz sayısı kadar öğe taşır; ham veri/VIN/kimlik TAŞIMAZ.
 */
export interface DeepScanCoverageLedger {
  readonly scanId:                string | null;
  readonly requiredPhases:        readonly DeepScanPhase[];
  readonly attemptedPhases:       readonly DeepScanPhase[];
  readonly completedPhases:       readonly DeepScanPhase[];
  readonly skippedPhases:         readonly DeepScanPhase[];
  readonly failedPhases:          readonly DeepScanPhase[];
  readonly unavailablePhases:     readonly DeepScanPhase[];
  readonly timedOutPhases:        readonly DeepScanPhase[];
  readonly budgetExhaustedPhases: readonly DeepScanPhase[];
  readonly partialPhases:         readonly DeepScanPhase[];
  readonly cancelledPhases:       readonly DeepScanPhase[];
  readonly unknownPhases:         readonly DeepScanPhase[];
  /** Tarama kullanıcı/handler tarafından iptal edildi mi. */
  readonly scanCancelled:         boolean;
  /** Tarama kritik faz hatasıyla `failed`'a düştü mü. */
  readonly scanFailed:            boolean;
  /** Güvenlik/kontak kapısı (ignition unknown, safety block) taramayı durdurdu mu. */
  readonly safetyBlocked:         boolean;
  /** Persistence finalizasyonu BAŞARIYLA tamamlandı mı (fail-closed: varsayılan false). */
  readonly persistenceFinalized:  boolean;
}

/** Kapsam sayımları — persist edilir, LAB'da gösterilebilir (ham veri YOK). */
export interface DeepScanCoverageSummary {
  readonly requiredCount:         number;
  readonly attemptedCount:        number;
  readonly completedCount:        number;
  readonly skippedCount:          number;
  readonly failedCount:           number;
  readonly unavailableCount:      number;
  readonly timedOutCount:         number;
  readonly budgetExhaustedCount:  number;
  readonly partialCount:          number;
  readonly unknownCount:          number;
}

/** `evaluateDeepScanCompletion()` çıktısı — taramanın KAPSAM GERÇEĞİ. */
export interface DeepScanCompletionOutcome {
  readonly scanId:                string | null;
  readonly completionEligibility: DeepScanCompletionEligibility;
  readonly finalVerdict:          DeepScanFinalVerdict;
  /** YALNIZ `finalVerdict === 'full'` iken true. Persistence bunun dışında true YAZAMAZ. */
  readonly hasCompletedFullScan:  boolean;
  readonly incompleteReasons:     readonly DeepScanIncompleteReason[];
  readonly coverage:              DeepScanCoverageSummary;
}

/** Kütük dizilerinin üst sınırı — bounded (faz sayısı). */
export const MAX_LEDGER_PHASES = ALL_DEEP_SCAN_PHASES.length;
/** Bounded: en fazla bu kadar farklı neden taşınır (kapalı küme zaten sınırlı). */
export const MAX_INCOMPLETE_REASONS = 16;

/** Faz adı geçerli mi (bilinmeyen/uydurma ad kütüğe GİRMEZ). */
function _isPhase(v: unknown): v is DeepScanPhase {
  return typeof v === 'string' && (ALL_DEEP_SCAN_PHASES as readonly string[]).includes(v);
}

/**
 * Ham faz sonucu durumunu KAPSAM durumuna çevirir. Tanınmayan her değer
 * `unknown` olur (FAIL-CLOSED — "bilmiyorsak başarı sayma").
 */
export function toPhaseCompletionStatus(raw: unknown): DeepScanPhaseCompletionStatus {
  switch (raw) {
    case 'success':
    case 'completed':           return 'completed';
    case 'skipped':             return 'skipped';
    case 'handler_unavailable': return 'handler_unavailable';
    case 'error':
    case 'failed':              return 'failed';
    case 'timeout':             return 'timeout';
    case 'budget_exhausted':    return 'budget_exhausted';
    case 'partial':             return 'partial';
    case 'cancelled':           return 'cancelled';
    default:                    return 'unknown';
  }
}

/**
 * Kütük ÖNCELİK sırası (kötüden iyiye). Aynı faz birden çok kovada görünürse
 * (bozuk girdi) EN KÖTÜ durum kazanır — fail-closed birleştirme.
 */
const _LEDGER_PRIORITY: readonly DeepScanPhaseCompletionStatus[] = [
  'unknown', 'cancelled', 'failed', 'timeout', 'budget_exhausted',
  'partial', 'handler_unavailable', 'skipped', 'completed',
];

/** Kütük kurucusunun girdisi — hepsi opsiyonel; eksik alan fail-closed yorumlanır. */
export interface DeepScanCoverageLedgerInput {
  readonly scanId?:               string | null;
  /** Verilmezse TÜM fazlar zorunlu sayılır (fail-closed — opsiyonel faz modeli YOK). */
  readonly requiredPhases?:       readonly DeepScanPhase[];
  readonly entries?:              readonly DeepScanPhaseLedgerEntry[];
  readonly scanCancelled?:        boolean;
  readonly scanFailed?:           boolean;
  readonly safetyBlocked?:        boolean;
  readonly persistenceFinalized?: boolean;
}

/**
 * Kütüğü kurar: faz adlarını doğrular, tekilleştirir (en kötü durum kazanır),
 * kovalara ayırır, dondurur. SAF — girdiyi mutate etmez, I/O yapmaz.
 */
export function buildDeepScanCoverageLedger(
  input: DeepScanCoverageLedgerInput = {},
): DeepScanCoverageLedger {
  const byPhase = new Map<DeepScanPhase, DeepScanPhaseCompletionStatus>();
  const entries = Array.isArray(input.entries) ? input.entries : [];
  for (const e of entries) {
    if (!e || typeof e !== 'object' || !_isPhase(e.phase)) continue;
    if (byPhase.size >= MAX_LEDGER_PHASES && !byPhase.has(e.phase)) continue;  // bounded
    const next = toPhaseCompletionStatus(e.status);
    const prev = byPhase.get(e.phase);
    if (prev === undefined) { byPhase.set(e.phase, next); continue; }
    // En kötü kazanır (öncelik dizisinde daha erken olan).
    byPhase.set(e.phase, _LEDGER_PRIORITY.indexOf(next) < _LEDGER_PRIORITY.indexOf(prev) ? next : prev);
  }

  const required: DeepScanPhase[] = [];
  const seenRequired = new Set<DeepScanPhase>();
  const rawRequired = Array.isArray(input.requiredPhases) ? input.requiredPhases : ALL_DEEP_SCAN_PHASES;
  for (const p of rawRequired) {
    if (!_isPhase(p) || seenRequired.has(p)) continue;
    seenRequired.add(p);
    required.push(p);
  }

  const bucket = (s: DeepScanPhaseCompletionStatus): DeepScanPhase[] =>
    [...byPhase.entries()].filter(([, v]) => v === s).map(([k]) => k);

  return Object.freeze({
    scanId:                typeof input.scanId === 'string' ? input.scanId : null,
    requiredPhases:        Object.freeze(required),
    attemptedPhases:       Object.freeze([...byPhase.keys()]),
    completedPhases:       Object.freeze(bucket('completed')),
    skippedPhases:         Object.freeze(bucket('skipped')),
    failedPhases:          Object.freeze(bucket('failed')),
    unavailablePhases:     Object.freeze(bucket('handler_unavailable')),
    timedOutPhases:        Object.freeze(bucket('timeout')),
    budgetExhaustedPhases: Object.freeze(bucket('budget_exhausted')),
    partialPhases:         Object.freeze(bucket('partial')),
    cancelledPhases:       Object.freeze(bucket('cancelled')),
    unknownPhases:         Object.freeze(bucket('unknown')),
    scanCancelled:         input.scanCancelled === true,
    scanFailed:            input.scanFailed === true,
    safetyBlocked:         input.safetyBlocked === true,
    persistenceFinalized:  input.persistenceFinalized === true,   // FAIL-CLOSED varsayılan
  }) as DeepScanCoverageLedger;
}

/** Faz kapsam durumu → "neden full değil" gerekçesi. `completed` → gerekçe YOK. */
function _reasonFor(status: DeepScanPhaseCompletionStatus): DeepScanIncompleteReason | null {
  switch (status) {
    case 'completed':           return null;
    case 'skipped':             return 'required_phase_skipped';
    case 'handler_unavailable': return 'required_phase_handler_unavailable';
    case 'failed':              return 'required_phase_failed';
    case 'timeout':             return 'required_phase_timeout';
    case 'budget_exhausted':    return 'required_phase_budget_exhausted';
    case 'partial':             return 'required_phase_partial';
    case 'cancelled':           return 'required_phase_cancelled';
    case 'unknown':             return 'required_phase_unknown_status';
    default: {
      // Exhaustive kilit: yeni bir durum eklenip burada UNUTULURSA derleme hatası verir;
      // çalışma zamanında da fail-closed davranır (asla `null` dönmez → full olamaz).
      const _never: never = status;
      void _never;
      return 'required_phase_unknown_status';
    }
  }
}

function _has(list: readonly DeepScanPhase[], phase: DeepScanPhase): boolean {
  return list.includes(phase);
}

/**
 * ★ TEK KARAR OTORİTESİ — bir taramanın full completion üretip üretemeyeceğini belirler.
 *
 * DETERMİNİSTİK · SAF · FAIL-CLOSED. `hasCompletedFullScan` YALNIZ buradan `true`
 * dönebilir; başka hiçbir katman kendi başına "tam tarandı" iddia ETMEZ.
 *
 * `full` için ŞART: zorunlu faz kümesi BOŞ DEĞİL · her zorunlu faz denendi ·
 * her zorunlu faz `completed` · hiçbiri skipped/handler_unavailable/timeout/
 * budget_exhausted/failed/partial/cancelled/unknown değil · tarama iptal/hata ile
 * bitmedi · güvenlik kapısı taramayı kesmedi · persistence finalizasyonu başarılı.
 */
export function evaluateDeepScanCompletion(
  ledger: DeepScanCoverageLedger,
): DeepScanCompletionOutcome {
  const reasons = new Set<DeepScanIncompleteReason>();

  const required = Array.isArray(ledger?.requiredPhases) ? ledger.requiredPhases : [];
  const attempted = Array.isArray(ledger?.attemptedPhases) ? ledger.attemptedPhases : [];

  // BOŞ zorunlu küme = kanıt yok → "her şey tamam" DEĞİL (fail-closed karar).
  if (required.length === 0) reasons.add('no_required_phases');

  let requiredCompleted = 0;
  for (const phase of required) {
    if (!_has(attempted, phase)) { reasons.add('required_phase_not_attempted'); continue; }
    // Öncelik sırasıyla ilk eşleşen kova fazın durumudur (en kötü kazanır).
    let status: DeepScanPhaseCompletionStatus = 'unknown';
    if      (_has(ledger.unknownPhases,         phase)) status = 'unknown';
    else if (_has(ledger.cancelledPhases,       phase)) status = 'cancelled';
    else if (_has(ledger.failedPhases,          phase)) status = 'failed';
    else if (_has(ledger.timedOutPhases,        phase)) status = 'timeout';
    else if (_has(ledger.budgetExhaustedPhases, phase)) status = 'budget_exhausted';
    else if (_has(ledger.partialPhases,         phase)) status = 'partial';
    else if (_has(ledger.unavailablePhases,     phase)) status = 'handler_unavailable';
    else if (_has(ledger.skippedPhases,         phase)) status = 'skipped';
    else if (_has(ledger.completedPhases,       phase)) status = 'completed';
    // else: denendi ama hiçbir kovada yok → tanımsız → `unknown` kalır (fail-closed).

    const reason = _reasonFor(status);
    if (reason === null) requiredCompleted += 1;
    else reasons.add(reason);
  }

  if (ledger.scanCancelled === true)        reasons.add('scan_cancelled');
  if (ledger.scanFailed === true)           reasons.add('scan_failed');
  if (ledger.safetyBlocked === true)        reasons.add('safety_blocked');
  if (ledger.persistenceFinalized !== true) reasons.add('persistence_not_finalized');

  const eligible = reasons.size === 0;

  let verdict: DeepScanFinalVerdict;
  if (ledger.scanCancelled === true)   verdict = 'cancelled';
  else if (ledger.scanFailed === true) verdict = 'failed';
  else if (eligible)                   verdict = 'full';
  else if (requiredCompleted > 0)      verdict = 'partial';
  else                                 verdict = 'incomplete';

  const coverage: DeepScanCoverageSummary = Object.freeze({
    requiredCount:        required.length,
    attemptedCount:       attempted.length,
    completedCount:       ledger.completedPhases.length,
    skippedCount:         ledger.skippedPhases.length,
    failedCount:          ledger.failedPhases.length,
    unavailableCount:     ledger.unavailablePhases.length,
    timedOutCount:        ledger.timedOutPhases.length,
    budgetExhaustedCount: ledger.budgetExhaustedPhases.length,
    partialCount:         ledger.partialPhases.length,
    unknownCount:         ledger.unknownPhases.length,
  });

  const reasonList = [...reasons].slice(0, MAX_INCOMPLETE_REASONS);

  return Object.freeze({
    scanId:                ledger.scanId ?? null,
    completionEligibility: (eligible ? 'eligible' : 'ineligible') as DeepScanCompletionEligibility,
    finalVerdict:          verdict,
    hasCompletedFullScan:  verdict === 'full',
    incompleteReasons:     Object.freeze(reasonList),
    coverage,
  }) as DeepScanCompletionOutcome;
}

/**
 * Kanıt YOKKEN kullanılacak fail-closed sonuç: hiçbir çağıran "kütük vermedim ama
 * tamamlandı say" diyemesin. Persistence, `completion` alanı gelmediğinde bunu kullanır.
 */
export function missingCompletionOutcome(scanId: string | null = null): DeepScanCompletionOutcome {
  return Object.freeze({
    scanId,
    completionEligibility: 'ineligible' as DeepScanCompletionEligibility,
    finalVerdict:          'incomplete' as DeepScanFinalVerdict,
    hasCompletedFullScan:  false,
    incompleteReasons:     Object.freeze(['completion_evidence_missing' as DeepScanIncompleteReason]),
    coverage: Object.freeze({
      requiredCount: 0, attemptedCount: 0, completedCount: 0, skippedCount: 0,
      failedCount: 0, unavailableCount: 0, timedOutCount: 0,
      budgetExhaustedCount: 0, partialCount: 0, unknownCount: 0,
    }),
  }) as DeepScanCompletionOutcome;
}
