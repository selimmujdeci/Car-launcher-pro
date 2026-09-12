/**
 * deepScanPersistence — Deep Scan sonuç geçmişi KALICI deposu (Foundation).
 *
 * AMAÇ: Bir aracın Deep Scan sonucunu araç PARMAK İZİ HASH'ine bağlı, kalıcı,
 * bounded ve fail-soft şekilde saklar. Böylece sistem sonraki bağlantıda
 * "bu araç daha önce TAM tarandı mı?" sorusunu cevaplayıp `full_scan` yerine
 * `change_check` seçebilir. safeStorage tabanlı; şema sürümlü; 16 araç LRU;
 * throttle'lı (debounce) yazma; immutable çıktı.
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız PERSISTENCE katmanıdır):
 *  - Gerçek araç taraması BAŞLATMAZ, native OBD'ye DOKUNMAZ, ignition kaynağı
 *    EKLEMEZ, SystemBoot/Assistant Context wiring YAPMAZ, UI ÜRETMEZ.
 *  - `deepScanRuntimeService`'i OTOMATİK bağlamaz — yalnız ileride orchestration
 *    PR'ının kullanacağı temiz bir API sunar. Import edilmesi YAN ETKİSİZDİR
 *    (yapıcı timer/abonelik/native çağrı açmaz; disk yalnız API çağrısında okunur).
 *
 * GİZLİLİK: VIN · MAC · plaka · koordinat · ham CAN frame · ham PID/DID response ·
 * API key/secret · kullanıcı kimliği ASLA saklanmaz. Parmak izi hash'i
 * `normalizeFingerprintHash` ile doğrulanır (17-karakter=VIN reddedilir). Firmware
 * kaydı yalnız ECU + NORMALİZE sürüm KİMLİĞİ tutar (ham response değil); VIN/MAC/
 * koordinat kalıbı taşıyan sürüm dizisi reddedilir. Serbest metinler `sanitizeText`
 * süzgecinden geçer.
 *
 * ⚠️ Runtime `DeepScanSnapshot` gizlilik gereği ECU/PID/DID KİMLİKLERİNİ taşımaz,
 * yalnız SAYIM taşır. Bu yüzden keşif kimlik LİSTELERİ (`ecuAddresses`/`pidIds`/
 * `didIds`/`firmware`) `DeepScanPersistInput`'a OPSİYONEL alanlar olarak gelir —
 * ileride orchestration PR'ı discovery servislerinden sağlar. Verilmezse listeler
 * boş kalır (sayımlar `reportSummary` üzerinden yine korunur).
 *
 * ZERO-LEAK: `dispose()` debounce timer'ını temizler + bekleyeni diske yazar.
 * FAIL-SOFT: hiçbir public API throw ETMEZ; bozuk JSON/eski şema → boş; tek bozuk
 * kayıt tüm depoyu ÇÖPE ATMAZ; hata durumunda güvenli varsayılan `full_scan`.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';
import {
  clampProgress,
  missingCompletionOutcome,
  normalizeFingerprintHash,
  sanitizeText,
  MAX_INCOMPLETE_REASONS,
  type DeepScanCompletionOutcome,
  type DeepScanCoverageSummary,
  type DeepScanFinalVerdict,
  type DeepScanIncompleteReason,
  type DeepScanMode,
  type DeepScanReportSummary,
  type DeepScanSnapshot,
  type DeepScanStatus,
} from './deepScanModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

/** safeStorage anahtarı (LRU_PROTECTED — kota dolunca SİLİNMEZ; kendi 16 kayıt tavanımız var). */
export const DEEP_SCAN_HISTORY_KEY = 'car-deep-scan-history';
/** Depo şema sürümü — eski/uyumsuz veri fail-soft atılır. */
export const DEEP_SCAN_SCHEMA_VERSION = 1;
/** Bounded tavan — en fazla bu kadar ARAÇ geçmişi tutulur (LRU eviction). */
export const MAX_DEEP_SCAN_RECORDS = 16;
/** Yazma debounce (ms) — progress burst'ları tek disk yazımına indirger (eMMC ömrü). */
export const DEEP_SCAN_WRITE_DEBOUNCE_MS = 5000;

/** Kayıt başı bounded liste tavanları (Mali-400 disk/RAM koruması). */
export const MAX_RECORD_ECUS = 128;
export const MAX_RECORD_PIDS = 512;
export const MAX_RECORD_DIDS = 512;
export const MAX_RECORD_FIRMWARE = 128;
export const MAX_RECORD_WARNINGS = 16;
/** Serbest metin (capabilitySummary / firmware version / scanId) üst sınırları. */
const MAX_CAPABILITY_CHARS = 160;
const MAX_FIRMWARE_VERSION_CHARS = 40;
const MAX_SCAN_ID_CHARS = 64;

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

/** Firmware envanteri girdisi — ham response DEĞİL, ECU + normalize sürüm kimliği. */
export interface DeepScanFirmwareEntry {
  readonly ecu: string;
  readonly version: string;
}

/** Bir araç için kalıcı Deep Scan geçmiş kaydı (immutable). */
export interface DeepScanRecord {
  readonly schemaVersion: number;
  readonly vehicleFingerprintHash: string;
  readonly lastScanId: string | null;
  readonly lastMode: DeepScanMode | null;
  readonly lastStatus: DeepScanStatus;
  readonly firstScanAt: number | null;
  readonly lastScanStartedAt: number | null;
  readonly lastScanCompletedAt: number | null;
  readonly lastUpdatedAt: number;
  readonly hasCompletedFullScan: boolean;
  readonly completedScanCount: number;
  readonly changeCheckCount: number;
  readonly lastProgressPercent: number;
  readonly discoveredEcus: readonly string[];
  readonly discoveredPids: readonly string[];
  readonly discoveredDids: readonly string[];
  readonly firmwareInventory: readonly DeepScanFirmwareEntry[];
  readonly capabilitySummary: string | null;
  readonly newDiscoveriesCount: number;
  readonly changedFirmware: boolean;
  readonly changedEcu: boolean;
  readonly warnings: readonly string[];
  readonly reportSummary: DeepScanReportSummary | null;
  /** İdempotent sayaç koruması — aynı scanId iki kez `completedScanCount`'u artırmasın. */
  readonly lastCompletedScanId: string | null;

  /* ── COMPLETION TRUTH (kapsam gerçeği) — legacy alanların YANINDA zorunlu meta ──
   * `lastStatus === 'completed'` YALNIZ "state machine terminale ulaştı" demektir.
   * "Gerçekten tam tarandı mı" sorusunun cevabı AŞAĞIDAKİ alanlardadır. */

  /** Tarama terminale ulaştı mı (completed/failed/cancelled). */
  readonly lastScanTerminal: boolean;
  /** Son taramanın kapsam kararı (tek otorite çıktısı). Bilinmiyorsa `null`. */
  readonly lastFinalVerdict: DeepScanFinalVerdict | null;
  /** Son tarama neden `full` sayılmadı — kapalı küme, bounded. */
  readonly lastIncompleteReasons: readonly DeepScanIncompleteReason[];
  /** Son taramanın kapsam sayımları (ham veri YOK). */
  readonly lastCoverage: DeepScanCoverageSummary | null;
  /** Tam kapsam elde EDİLEMEDEN sonlanan tarama sayısı (gözlemlenebilirlik). */
  readonly partialScanCount: number;
}

/**
 * `saveSnapshot()` / `completeScan()` girdisi. `snapshot` zorunlu (runtime'dan gelir);
 * keşif kimlik listeleri OPSİYONEL (snapshot yalnız sayım taşır — bkz. dosya başlığı).
 */
export interface DeepScanPersistInput {
  readonly snapshot: DeepScanSnapshot;
  readonly ecuAddresses?: readonly string[];
  readonly pidIds?: readonly string[];
  readonly didIds?: readonly string[];
  readonly firmware?: ReadonlyArray<{ readonly ecu?: string; readonly version?: string }>;
  readonly capabilitySummary?: string;
  /**
   * KAPSAM KANITI (`evaluateDeepScanCompletion()` çıktısı) — `completeScan()` için
   * ZORUNLU sayılır. Geriye uyumluluk için tip düzeyinde opsiyoneldir, ama
   * VERİLMEZSE FAIL-CLOSED davranılır: `hasCompletedFullScan` YÜKSELTİLMEZ,
   * sayaçlar ARTMAZ ve kayda `completion_evidence_missing` nedeni yazılır.
   * `saveSnapshot()` (ara checkpoint) bu alanı KULLANMAZ.
   */
  readonly completion?: DeepScanCompletionOutcome;
}

/** Kalıcı zarf (şema sürümlü). */
interface DeepScanHistoryEnvelope {
  schema: number;
  items: DeepScanRecord[];
}

/** Enjekte edilebilir I/O (varsayılan safeStorage; test için değiştirilebilir). */
export interface DeepScanStoreIO {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  remove: (key: string) => void;
}

const DEFAULT_IO: DeepScanStoreIO = { read: safeGetRaw, write: safeSetRaw, remove: safeRemoveRaw };

/* ══════════════════════════════════════════════════════════════════════════
 * Saf normalizasyon yardımcıları (girdi mutate EDİLMEZ)
 * ════════════════════════════════════════════════════════════════════════ */

/** ECU/PID/DID kimliği normalize: trim · UPPER · boşluksuz · 0x ön eki atılır. */
function _normId(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().toUpperCase().replace(/\s+/g, '').replace(/^0X/, '');
}

/** Negatif olmayan sonlu sayı; aksi → fallback. */
function _count(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Sonlu sayı ya da null (zaman damgaları için). */
function _numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function _mode(v: unknown): DeepScanMode | null {
  return v === 'FULL_SCAN' || v === 'CHANGE_CHECK' ? v : null;
}

const _VALID_STATUSES: ReadonlySet<string> = new Set<DeepScanStatus>([
  'idle', 'waiting_for_ignition', 'preparing', 'scanning',
  'analyzing', 'completed', 'paused', 'cancelled', 'failed',
]);
function _status(v: unknown): DeepScanStatus {
  return typeof v === 'string' && _VALID_STATUSES.has(v) ? (v as DeepScanStatus) : 'idle';
}

/** scanId'yi bound'lar (gizli değil — üretilmiş kimlik; sanitizeText hex sayısını bozardı). */
function _boundScanId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > MAX_SCAN_ID_CHARS ? s.slice(0, MAX_SCAN_ID_CHARS) : s;
}

/** İki kaynaktan kimlik listesi birleştir → normalize · unique · sort · bounded. */
function _mergeIds(
  existing: readonly unknown[] | undefined,
  incoming: readonly unknown[] | undefined,
  max: number,
): string[] {
  const set = new Set<string>();
  if (Array.isArray(existing)) for (const s of existing) { const n = _normId(s); if (n) set.add(n); }
  if (Array.isArray(incoming)) for (const s of incoming) { const n = _normId(s); if (n) set.add(n); }
  const sorted = [...set].sort();
  return sorted.length > max ? sorted.slice(0, max) : sorted;
}

const _MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/;
const _COORD_RE = /-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/;

/** Firmware sürüm kimliği normalize + PII kapısı; reddedilirse '' (kayıt atlanır). */
function _normFirmwareVersion(v: unknown): string {
  if (typeof v !== 'string') return '';
  const raw = v.trim();
  if (!raw) return '';
  if (raw.length === 17) return '';                 // VIN uzunluğu → asla kabul etme
  if (_MAC_RE.test(raw) || _COORD_RE.test(raw)) return ''; // MAC/koordinat → reddet
  const s = raw.toUpperCase().replace(/\s+/g, '');
  return s.length > MAX_FIRMWARE_VERSION_CHARS ? s.slice(0, MAX_FIRMWARE_VERSION_CHARS) : s;
}

/** Firmware envanterini birleştir → ECU+version ile tekilleştir · sort · bounded. */
function _mergeFirmware(
  existing: readonly unknown[] | undefined,
  incoming: readonly unknown[] | undefined,
  max: number,
): DeepScanFirmwareEntry[] {
  const map = new Map<string, DeepScanFirmwareEntry>();
  const add = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    const rec = item as { ecu?: unknown; version?: unknown };
    const version = _normFirmwareVersion(rec.version);
    if (!version) return;                            // sürüm yok/PII → atla
    const ecu = _normId(rec.ecu);
    const key = `${ecu}:${version}`;
    if (!map.has(key)) map.set(key, { ecu, version });
  };
  if (Array.isArray(existing)) for (const it of existing) add(it);
  if (Array.isArray(incoming)) for (const it of incoming) add(it);
  const arr = [...map.values()].sort((a, b) =>
    a.ecu === b.ecu
      ? (a.version < b.version ? -1 : a.version > b.version ? 1 : 0)
      : (a.ecu < b.ecu ? -1 : 1),
  );
  return arr.length > max ? arr.slice(0, max) : arr;
}

/** Uyarı listesi normalize → sanitize · boş at · son MAX_RECORD_WARNINGS tut. */
function _normWarnings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const w of v) { const c = sanitizeText(w); if (c) out.push(c); }
  return out.length > MAX_RECORD_WARNINGS ? out.slice(out.length - MAX_RECORD_WARNINGS) : out;
}

/** Rapor özetini gizlilik-güvenli klonlar (yalnız sayım + bayrak + temizlenmiş not). */
function _cloneReport(v: unknown): DeepScanReportSummary | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<DeepScanReportSummary>;
  return Object.freeze({
    mode: r.mode === 'CHANGE_CHECK' ? 'CHANGE_CHECK' : 'FULL_SCAN',
    ecuCount: _count(r.ecuCount),
    pidCount: _count(r.pidCount),
    didCount: _count(r.didCount),
    newDiscoveriesCount: _count(r.newDiscoveriesCount),
    firmwareCheckedCount: _count(r.firmwareCheckedCount),
    changedFirmware: r.changedFirmware === true,
    changedEcu: r.changedEcu === true,
    warningCount: _count(r.warningCount),
    durationMs: _count(r.durationMs),
    note: sanitizeText(r.note) || null,
  }) as DeepScanReportSummary;
}

/* ── Completion truth normalizasyonu (kapalı küme → uydurma değer geçemez) ──── */

const _VALID_VERDICTS: ReadonlySet<string> = new Set<DeepScanFinalVerdict>([
  'full', 'partial', 'incomplete', 'failed', 'cancelled',
]);

const _VALID_REASONS: ReadonlySet<string> = new Set<DeepScanIncompleteReason>([
  'no_required_phases',
  'required_phase_not_attempted',
  'required_phase_handler_unavailable',
  'required_phase_skipped',
  'required_phase_failed',
  'required_phase_timeout',
  'required_phase_budget_exhausted',
  'required_phase_partial',
  'required_phase_cancelled',
  'required_phase_unknown_status',
  'scan_cancelled',
  'scan_failed',
  'safety_blocked',
  'persistence_not_finalized',
  'completion_evidence_missing',
]);

function _verdict(v: unknown): DeepScanFinalVerdict | null {
  return typeof v === 'string' && _VALID_VERDICTS.has(v) ? (v as DeepScanFinalVerdict) : null;
}

/** Nedenleri kapalı kümeye süzer + tekilleştirir + bound'lar (serbest metin GEÇMEZ). */
function _normReasons(v: unknown): DeepScanIncompleteReason[] {
  if (!Array.isArray(v)) return [];
  const set = new Set<DeepScanIncompleteReason>();
  for (const r of v) {
    if (typeof r === 'string' && _VALID_REASONS.has(r)) set.add(r as DeepScanIncompleteReason);
    if (set.size >= MAX_INCOMPLETE_REASONS) break;
  }
  return [...set];
}

/** Kapsam sayımlarını gizlilik-güvenli klonlar (yalnız sayı). */
function _cloneCoverage(v: unknown): DeepScanCoverageSummary | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Partial<DeepScanCoverageSummary>;
  return Object.freeze({
    requiredCount:        _count(c.requiredCount),
    attemptedCount:       _count(c.attemptedCount),
    completedCount:       _count(c.completedCount),
    skippedCount:         _count(c.skippedCount),
    failedCount:          _count(c.failedCount),
    unavailableCount:     _count(c.unavailableCount),
    timedOutCount:        _count(c.timedOutCount),
    budgetExhaustedCount: _count(c.budgetExhaustedCount),
    partialCount:         _count(c.partialCount),
    unknownCount:         _count(c.unknownCount),
  }) as DeepScanCoverageSummary;
}

/**
 * Kapsam kanıtını doğrular. FAIL-CLOSED:
 *  - kanıt yok / bozuk → `missingCompletionOutcome()` (asla `full`)
 *  - `hasCompletedFullScan` yalnız `finalVerdict === 'full'` ile birlikte kabul edilir
 *    (çağıran uyumsuz bir çift gönderirse iddia DÜŞÜRÜLÜR).
 */
function _normCompletion(v: unknown, scanId: string | null): DeepScanCompletionOutcome {
  if (!v || typeof v !== 'object') return missingCompletionOutcome(scanId);
  const c = v as Partial<DeepScanCompletionOutcome>;
  const verdict = _verdict(c.finalVerdict);
  if (verdict === null) return missingCompletionOutcome(scanId);
  const reasons = _normReasons(c.incompleteReasons);
  const full = verdict === 'full' && c.hasCompletedFullScan === true && reasons.length === 0;
  return Object.freeze({
    scanId: _boundScanId(c.scanId) ?? scanId,
    completionEligibility: full ? 'eligible' : 'ineligible',
    finalVerdict: full ? 'full' : (verdict === 'full' ? 'incomplete' : verdict),
    hasCompletedFullScan: full,
    incompleteReasons: Object.freeze(
      full ? [] : (reasons.length > 0 ? reasons : ['completion_evidence_missing' as DeepScanIncompleteReason]),
    ),
    coverage: _cloneCoverage(c.coverage) ?? _cloneCoverage({})!,
  }) as DeepScanCompletionOutcome;
}

/** Serbest kapasite özeti metni → temizlenir + bound'lanır ya da null. */
function _normCapability(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = sanitizeText(v, MAX_CAPABILITY_CHARS);
  return c || null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ★ LEGACY FULL-SCAN GÜVEN SINIFLANDIRMASI — TEK MERKEZİ OTORİTE
 *
 * SORUN: Completion Truth'tan ÖNCEKİ sürümler `hasCompletedFullScan = true`'yu
 * yalnız `status === 'completed'` görerek yazıyordu — kapsam kanıtı olmadan. O
 * kayıtlar diskte DURUYOR (silinmiyor, şema bump edilmiyor) ve ham alana bakan
 * her tüketici onları "tam tarandı" sanardı → CHANGE_CHECK'e geçilir ve eksik bir
 * kayıt baseline olurdu.
 *
 * KURAL (fail-closed): `hasCompletedFullScan === true` iddiası ancak YANINDA
 * tutarlı completion metadata varsa GÜVENİLİRDİR. Metadata yok/eksik/tutarsızsa
 * kayıt `legacy_unverified_full`'dür: SİLİNMEZ, sayaçları DEĞİŞTİRİLMEZ, ama
 * baseline OLAMAZ ve CHANGE_CHECK ÜRETEMEZ.
 *
 * ⚠️ Bu sınıflandırma TEK YERDE yapılır. Tüketiciler ham `record.hasCompletedFullScan`
 * alanına BAKMAZ — `isVerifiedFullScan()` / `classifyFullScanTrust()` kullanır.
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir kaydın "tam tarandı" iddiasının güven seviyesi. */
export type DeepScanFullScanTrust =
  /** Kanıtlı: `hasCompletedFullScan` + tutarlı completion metadata (verdict `full`). */
  | 'verified_full'
  /** İddia var ama KANIT YOK/TUTARSIZ (eski sürüm kaydı) → güvenilmez. */
  | 'legacy_unverified_full'
  /** Tam tarama iddiası hiç yok (kısmi/incomplete/failed/cancelled/kayıt yok). */
  | 'not_full';

/**
 * Kaydın full-scan güven seviyesini belirler. SAF · DETERMİNİSTİK · throw ETMEZ ·
 * kaydı MUTATE ETMEZ. Eksik/`undefined` alanlar güvenli şekilde ele alınır.
 *
 * `verified_full` için TÜM şartlar:
 *  - `hasCompletedFullScan === true`  (iddia)
 *  - `lastFinalVerdict === 'full'`    (kapsam kararı kanıtı)
 *  - `lastIncompleteReasons` BOŞ      (tutarlılık — `full` + gerekçe bir arada olamaz)
 *  - `lastScanTerminal === true`      (tutarlılık — full daima terminaldir)
 */
export function classifyFullScanTrust(
  record: DeepScanRecord | null | undefined,
): DeepScanFullScanTrust {
  if (!record || typeof record !== 'object') return 'not_full';
  if (record.hasCompletedFullScan !== true) return 'not_full';

  const verdictOk = record.lastFinalVerdict === 'full';
  const reasonsOk = !Array.isArray(record.lastIncompleteReasons) || record.lastIncompleteReasons.length === 0;
  const terminalOk = record.lastScanTerminal === true;

  return verdictOk && reasonsOk && terminalOk ? 'verified_full' : 'legacy_unverified_full';
}

/** Kayıt KANITLI tam tarama mı (baseline/CHANGE_CHECK için TEK kapı). */
export function isVerifiedFullScan(record: DeepScanRecord | null | undefined): boolean {
  return classifyFullScanTrust(record) === 'verified_full';
}

/** Kaydı derinlemesine dondurur (iç durum referansla dışarı sızmasın). */
function _freezeRecord(r: DeepScanRecord): DeepScanRecord {
  return Object.freeze({
    ...r,
    discoveredEcus: Object.freeze([...r.discoveredEcus]),
    discoveredPids: Object.freeze([...r.discoveredPids]),
    discoveredDids: Object.freeze([...r.discoveredDids]),
    firmwareInventory: Object.freeze(r.firmwareInventory.map((f) => Object.freeze({ ...f }))),
    warnings: Object.freeze([...r.warnings]),
    reportSummary: r.reportSummary ? Object.freeze({ ...r.reportSummary }) : null,
    lastIncompleteReasons: Object.freeze([...r.lastIncompleteReasons]),
    lastCoverage: r.lastCoverage ? Object.freeze({ ...r.lastCoverage }) : null,
  }) as DeepScanRecord;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Depo
 * ════════════════════════════════════════════════════════════════════════ */

export class DeepScanPersistenceStore {
  private readonly storageKey: string;
  private readonly maxRecords: number;
  private readonly debounceMs: number;
  private readonly _io: DeepScanStoreIO;
  private readonly _now: () => number;

  /** vehicleFingerprintHash → kayıt. Eviction status+zaman temelli (sıra-bağımsız). */
  private _records = new Map<string, DeepScanRecord>();
  private _loaded = false;
  private _dirty = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;

  constructor(
    storageKey = DEEP_SCAN_HISTORY_KEY,
    maxRecords = MAX_DEEP_SCAN_RECORDS,
    debounceMs = DEEP_SCAN_WRITE_DEBOUNCE_MS,
    io: DeepScanStoreIO = DEFAULT_IO,
    now: () => number = () => Date.now(),
  ) {
    this.storageKey = storageKey;
    this.maxRecords = maxRecords;
    this.debounceMs = debounceMs;
    this._io = io;
    this._now = now;
  }

  /* ── Kalıcılık ─────────────────────────────────────────────────────────── */

  private _ensureLoaded(): void {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = this._io.read(this.storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;      // bozuk yapı → boş
      const env = parsed as Partial<DeepScanHistoryEnvelope>;
      if (env.schema !== DEEP_SCAN_SCHEMA_VERSION || !Array.isArray(env.items)) return; // eski şema → boş
      for (const it of env.items) {
        const rec = this._recordFromRaw(it);                  // tek bozuk kayıt → null → atla
        if (rec) this._records.set(rec.vehicleFingerprintHash, rec);
      }
      this._evictIfNeeded();                                   // eski dosya 16'dan fazla içeriyorsa
    } catch {
      this._records = new Map();                               // bozuk JSON → dürüstçe boş
    }
  }

  private _scheduleFlush(): void {
    this._dirty = true;
    if (this._timer !== null || this._disposed) return;
    this._timer = setTimeout(() => { this._timer = null; this._flushNow(); }, this.debounceMs);
  }

  private _flushNow(): void {
    if (!this._dirty) return;
    try {
      const env: DeepScanHistoryEnvelope = {
        schema: DEEP_SCAN_SCHEMA_VERSION,
        items: [...this._records.values()],
      };
      this._io.write(this.storageKey, JSON.stringify(env));
      this._dirty = false;
    } catch {
      /* kota/serileştirme hatası — bellek korunur, fail-soft */
    }
  }

  /* ── Bounded LRU eviction (status-aware, deterministik, sıra-bağımsız) ──── */

  private _evictIfNeeded(): void {
    while (this._records.size > this.maxRecords) {
      let victimHash: string | null = null;
      let victimProtect = Infinity;   // 0 = tamamlanmamış (önce evict) · 1 = tam tarama var
      let victimRecency = Infinity;   // en eski önce evict
      for (const [hash, r] of this._records) {
        const protect = r.hasCompletedFullScan ? 1 : 0;
        const recency = Math.max(r.lastScanCompletedAt ?? 0, r.lastUpdatedAt ?? 0);
        // Deterministik: önce en düşük protect, sonra en eski, sonra en büyük hash.
        if (protect < victimProtect ||
            (protect === victimProtect && recency < victimRecency) ||
            (protect === victimProtect && recency === victimRecency && (victimHash === null || hash > victimHash))) {
          victimHash = hash; victimProtect = protect; victimRecency = recency;
        }
      }
      if (victimHash === null) break;
      this._records.delete(victimHash);
    }
  }

  /* ── Kayıt üretimi (merge + load ortak yolu) ───────────────────────────── */

  /**
   * Ham/loosely-typed alanlardan normalize + bounded + dondurulmuş kayıt üretir.
   * `hash` geçersizse (VIN/hex-dışı) → null (kayıt reddedilir). Load'da da kullanılır.
   */
  private _recordFromRaw(raw: unknown): DeepScanRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as Record<string, unknown>;
    const hash = normalizeFingerprintHash(d.vehicleFingerprintHash);
    if (hash === null) return null;
    return _freezeRecord({
      schemaVersion: DEEP_SCAN_SCHEMA_VERSION,
      vehicleFingerprintHash: hash,
      lastScanId: _boundScanId(d.lastScanId),
      lastMode: _mode(d.lastMode),
      lastStatus: _status(d.lastStatus),
      firstScanAt: _numOrNull(d.firstScanAt),
      lastScanStartedAt: _numOrNull(d.lastScanStartedAt),
      lastScanCompletedAt: _numOrNull(d.lastScanCompletedAt),
      lastUpdatedAt: _count(d.lastUpdatedAt, this._now()),
      hasCompletedFullScan: d.hasCompletedFullScan === true,
      completedScanCount: _count(d.completedScanCount),
      changeCheckCount: _count(d.changeCheckCount),
      lastProgressPercent: clampProgress(d.lastProgressPercent),
      discoveredEcus: _mergeIds(d.discoveredEcus as unknown[], undefined, MAX_RECORD_ECUS),
      discoveredPids: _mergeIds(d.discoveredPids as unknown[], undefined, MAX_RECORD_PIDS),
      discoveredDids: _mergeIds(d.discoveredDids as unknown[], undefined, MAX_RECORD_DIDS),
      firmwareInventory: _mergeFirmware(d.firmwareInventory as unknown[], undefined, MAX_RECORD_FIRMWARE),
      capabilitySummary: _normCapability(d.capabilitySummary),
      newDiscoveriesCount: _count(d.newDiscoveriesCount),
      changedFirmware: d.changedFirmware === true,
      changedEcu: d.changedEcu === true,
      warnings: _normWarnings(d.warnings),
      reportSummary: _cloneReport(d.reportSummary),
      lastCompletedScanId: _boundScanId(d.lastCompletedScanId),
      // Completion truth — eski şema kayıtlarında YOKTUR → fail-closed varsayılan
      // (`null` verdict = "bilinmiyor", asla "full" varsayılmaz).
      lastScanTerminal: d.lastScanTerminal === true,
      lastFinalVerdict: _verdict(d.lastFinalVerdict),
      lastIncompleteReasons: _normReasons(d.lastIncompleteReasons),
      lastCoverage: _cloneCoverage(d.lastCoverage),
      partialScanCount: _count(d.partialScanCount),
    });
  }

  /**
   * Snapshot + opsiyonel keşif listelerini mevcut kayıtla BİRLEŞTİRİP yeni kayıt üretir.
   * `isCompleteCall` yalnız `completeScan()` için true → tamamlanmış geçişte sayaçlar artar.
   */
  private _mergeRecord(
    hash: string,
    existing: DeepScanRecord | null,
    input: DeepScanPersistInput,
    isCompleteCall: boolean,
  ): DeepScanRecord {
    const now = this._now();
    const snap = input.snapshot;

    let completedScanCount = existing?.completedScanCount ?? 0;
    let changeCheckCount = existing?.changeCheckCount ?? 0;
    let partialScanCount = existing?.partialScanCount ?? 0;
    let hasCompletedFullScan = existing?.hasCompletedFullScan ?? false;
    let lastCompletedScanId = existing?.lastCompletedScanId ?? null;
    let lastScanTerminal = existing?.lastScanTerminal ?? false;
    let lastFinalVerdict = existing?.lastFinalVerdict ?? null;
    let lastIncompleteReasons: readonly DeepScanIncompleteReason[] = existing?.lastIncompleteReasons ?? [];
    let lastCoverage = existing?.lastCoverage ?? null;

    if (isCompleteCall) {
      const scanId = _boundScanId(snap.scanId);
      // ★ KAPSAM KANITI — kanıt yoksa fail-closed (`completion_evidence_missing`).
      const completion = _normCompletion(input.completion, scanId);
      const terminal = snap.status === 'completed' || snap.status === 'failed' || snap.status === 'cancelled';

      lastScanTerminal = terminal;
      lastFinalVerdict = completion.finalVerdict;
      lastIncompleteReasons = completion.incompleteReasons;
      lastCoverage = completion.coverage;

      // ⚠️ TEK YÜKSELTME KAPISI: `hasCompletedFullScan` ve tamamlanma sayaçları YALNIZ
      // gerçek FULL kapsamda ilerler. `status === 'completed'` TEK BAŞINA YETMEZ —
      // eski hata buydu (handler'sız/atlanmış fazlarla "tam tarandı" yazılıyordu).
      const isFullCompletion =
        snap.status === 'completed' && completion.hasCompletedFullScan === true;

      // İdempotent: aynı scanId sayaçları YENİDEN artırmaz (full VE partial için).
      if (scanId !== null && scanId !== lastCompletedScanId) {
        if (isFullCompletion) {
          completedScanCount += 1;
          if (snap.mode === 'CHANGE_CHECK') changeCheckCount += 1;
          if (snap.mode === 'FULL_SCAN') hasCompletedFullScan = true;
          lastCompletedScanId = scanId;
        } else if (terminal) {
          // Terminal ama TAM DEĞİL → yalnız gözlem sayacı. Baseline/mod kararına
          // etki ETMEZ (`hasCompletedFullScan` dokunulmadan kalır).
          partialScanCount += 1;
          lastCompletedScanId = scanId;   // sayaç idempotans anahtarı (full/partial ortak)
        }
      }
    }

    return _freezeRecord({
      schemaVersion: DEEP_SCAN_SCHEMA_VERSION,
      vehicleFingerprintHash: hash,
      lastScanId: _boundScanId(snap.scanId),
      lastMode: _mode(snap.mode),
      lastStatus: _status(snap.status),
      firstScanAt: existing?.firstScanAt ?? _numOrNull(snap.startedAt) ?? now,   // KORUNUR
      lastScanStartedAt: _numOrNull(snap.startedAt) ?? existing?.lastScanStartedAt ?? null,
      lastScanCompletedAt: _numOrNull(snap.completedAt) ?? existing?.lastScanCompletedAt ?? null,
      lastUpdatedAt: now,                                                        // GÜNCELLENİR
      hasCompletedFullScan,
      completedScanCount,
      changeCheckCount,
      lastProgressPercent: clampProgress(snap.progressPercent),
      discoveredEcus: _mergeIds(existing?.discoveredEcus, input.ecuAddresses, MAX_RECORD_ECUS),
      discoveredPids: _mergeIds(existing?.discoveredPids, input.pidIds, MAX_RECORD_PIDS),
      discoveredDids: _mergeIds(existing?.discoveredDids, input.didIds, MAX_RECORD_DIDS),
      firmwareInventory: _mergeFirmware(existing?.firmwareInventory, input.firmware, MAX_RECORD_FIRMWARE),
      capabilitySummary: _normCapability(input.capabilitySummary) ?? existing?.capabilitySummary ?? null,
      newDiscoveriesCount: _count(snap.newDiscoveriesCount),
      changedFirmware: snap.changedFirmware === true,
      changedEcu: snap.changedEcu === true,
      warnings: _normWarnings(snap.warnings),
      reportSummary: _cloneReport(snap.reportSummary) ?? existing?.reportSummary ?? null,
      lastCompletedScanId,
      lastScanTerminal,
      lastFinalVerdict,
      lastIncompleteReasons,
      lastCoverage,
      partialScanCount,
    });
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  /** Araç kaydını getirir (dondurulmuş kopya) veya null. */
  load(vehicleFingerprintHash: unknown): DeepScanRecord | null {
    this._ensureLoaded();
    const hash = normalizeFingerprintHash(vehicleFingerprintHash);
    if (hash === null) return null;
    return this._records.get(hash) ?? null;   // kayıt zaten dondurulmuş
  }

  /** Tüm araç kayıtlarının (dondurulmuş) listesi. */
  list(): DeepScanRecord[] {
    this._ensureLoaded();
    return [...this._records.values()];        // her öğe zaten frozen
  }

  /**
   * Bu araçta daha önce KANITLI tam tarama tamamlandı mı.
   *
   * ⚠️ Ham `record.hasCompletedFullScan` alanını DÖNMEZ — onu `classifyFullScanTrust()`
   * süzgecinden geçirir. Completion Truth öncesi yazılmış (metadata'sız) `true`
   * kayıtları `legacy_unverified_full`'dür ve buradan `false` döner (fail-closed).
   * Ham alanı görmek gerekirse `load()` ile kayıt okunur; karar için BU metod kullanılır.
   */
  hasCompletedFullScan(vehicleFingerprintHash: unknown): boolean {
    return isVerifiedFullScan(this.load(vehicleFingerprintHash));
  }

  /**
   * Kaydın full-scan güven seviyesi (teşhis/gözlemlenebilirlik).
   * Kayıt yoksa `not_full`. Throw ETMEZ.
   */
  getFullScanTrust(vehicleFingerprintHash: unknown): DeepScanFullScanTrust {
    return classifyFullScanTrust(this.load(vehicleFingerprintHash));
  }

  /**
   * Sonraki bağlantı için mod kararı — `deepScanModel.resolveScanMode` ile uyumlu:
   *  - Kayıt yok → `FULL_SCAN`
   *  - Kayıt var ama tam tarama tamamlanmamış → `FULL_SCAN`
   *  - Kayıt "tam" diyor ama KANIT YOK (legacy) → `FULL_SCAN` (fail-closed)
   *  - KANITLI tam tarama → `CHANGE_CHECK`
   */
  resolveMode(vehicleFingerprintHash: unknown): DeepScanMode {
    return this.hasCompletedFullScan(vehicleFingerprintHash) ? 'CHANGE_CHECK' : 'FULL_SCAN';
  }

  /**
   * İlerleyen tarama durumunu kalıcılaştırır (upsert). Sayaçları ARTIRMAZ
   * (`completeScan` bunun için). Geçersiz parmak izi → null (fail-soft, yazma yok).
   */
  saveSnapshot(input: DeepScanPersistInput): DeepScanRecord | null {
    return this._upsert(input, false);
  }

  /**
   * Tarama SONLANDIĞINDA çağrılır (terminal: completed/failed/cancelled).
   *
   * Dört durumu AYRI AYRI kaydeder:
   *  1. terminale ulaştı            → `lastScanTerminal` + `lastStatus`
   *  2. kapsam kararı               → `lastFinalVerdict` (+ `lastIncompleteReasons`, `lastCoverage`)
   *  3. TAM tarama tamamlandı       → `hasCompletedFullScan` / `completedScanCount` / `changeCheckCount`
   *  4. kısmi/eksik tarama sonlandı → `partialScanCount` (yükseltme YOK)
   *
   * ⚠️ 3. madde YALNIZ `input.completion.hasCompletedFullScan === true` (yani
   * `evaluateDeepScanCompletion` kararı `full`) VE `snapshot.status === 'completed'`
   * iken gerçekleşir. Kanıt gelmezse FAIL-CLOSED: yükseltme YOK, neden
   * `completion_evidence_missing` olarak persist edilir. `failed`/`cancelled` sayaç ARTIRMAZ.
   */
  completeScan(input: DeepScanPersistInput): DeepScanRecord | null {
    return this._upsert(input, true);
  }

  private _upsert(input: DeepScanPersistInput, isCompleteCall: boolean): DeepScanRecord | null {
    if (this._disposed) return null;
    if (!input || typeof input !== 'object' || !input.snapshot || typeof input.snapshot !== 'object') return null;
    this._ensureLoaded();
    const hash = normalizeFingerprintHash(input.snapshot.vehicleFingerprintHash);
    if (hash === null) return null;              // parmak izi yok → araca bağlanamaz → yazma yok

    const existing = this._records.get(hash) ?? null;
    const merged = this._mergeRecord(hash, existing, input, isCompleteCall);
    this._records.delete(hash);                  // recency: sona taşı (tie-break hint)
    this._records.set(hash, merged);
    this._evictIfNeeded();
    this._scheduleFlush();
    return merged;                               // zaten frozen
  }

  /** Araç kaydını siler. @returns silindi mi. */
  remove(vehicleFingerprintHash: unknown): boolean {
    this._ensureLoaded();
    const hash = normalizeFingerprintHash(vehicleFingerprintHash);
    if (hash === null) return false;
    if (!this._records.delete(hash)) return false;
    this._scheduleFlush();
    return true;
  }

  /** Tüm geçmişi ve kalıcı kaydı temizler. */
  clear(): void {
    this._records = new Map();
    this._loaded = true;
    if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
    this._dirty = false;
    try { this._io.remove(this.storageKey); } catch { /* yoksay */ }
  }

  /** Bekleyen yazımı HEMEN diske aktarır (debounce beklemeden). */
  flush(): void {
    if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
    this._flushNow();
  }

  /** Zaman ölçerini temizler + bekleyeni yazar (zero-leak). Sonrası: yeni yazma planlanmaz. */
  dispose(): void {
    if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
    this._flushNow();
    this._disposed = true;
  }

  /** Saklanan araç sayısı. */
  get size(): number {
    this._ensureLoaded();
    return this._records.size;
  }
}

/**
 * Uygulama geneli tekil depo. Yapıcı YAN ETKİ ÜRETMEZ (timer/abonelik/native yok;
 * disk yalnız ilk API çağrısında okunur). Runtime servise BAĞLI DEĞİLDİR —
 * orchestration/wiring ayrı PR kapsamıdır.
 */
export const deepScanPersistenceStore = new DeepScanPersistenceStore();
