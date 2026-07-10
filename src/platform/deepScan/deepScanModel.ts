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
 * Araca AKTİF sorgu gönderen fazlar. Bunlar YALNIZ `ignitionConfirmed === true`
 * iken çalışabilir. `vehicle_identity` (Mode 09 VIN sorgusu) ve
 * `firmware_inventory` (DID sorgusu) de araca istek gönderir → aktif sayılır.
 */
export const ACTIVE_PHASES: readonly DeepScanPhase[] = [
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
export const OFFLINE_PHASES: readonly DeepScanPhase[] = [
  'capability_analysis',
  'fingerprint_update',
  'knowledge_update',
  'evidence_update',
  'change_detection',
  'report_generation',
];

/** Faz araca aktif sorgu gönderir mi. */
export function isActivePhase(phase: DeepScanPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
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
