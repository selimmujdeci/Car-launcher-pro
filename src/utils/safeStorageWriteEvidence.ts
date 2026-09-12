/**
 * safeStorageWriteEvidence.ts — ARCH-04/F5 · KALICI YAZIM TAMAMLANMA KANITI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SAFESTORAGE SAHİP DEĞİL, ALTYAPIDIR ──────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu dosya yeni bir depolama gerçeği motoru KURMAZ. `safeStorage`ın ZATEN
 * yaptığı atomik yazım hattını (tmp → stat → rename → verify-read → cache)
 * yalnız GÖRÜNÜR kılar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── PAZARLIKSIZ KURAL: KISMİ TAMAMLANMA BAŞARI DEĞİLDİR ──────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   rename başarılı + verify-read başarısız → TAM KALICILIK YOK
 *   cache güncellendi                        ≠ dayanıklı native yazım
 *   backup (localStorage) yazıldı            ≠ asıl (Filesystem) yazım sağlıklı
 *
 * Bir yazım ancak GEREKLİ TÜM aşamalar tamamlandığında `SUCCESS` olur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── GİZLİLİK ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Yazılan DEĞER kanıta GİRMEZ. Yalnız anahtar adı, bayt uzunluğu ve aşama
 * bayrakları taşınır.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Sözlük
 * ════════════════════════════════════════════════════════════════════════ */

export type StorageWriteStage =
  | 'writeRequested'
  | 'tempWriteCompleted'
  | 'statVerified'
  | 'renameCompleted'
  | 'verifyReadCompleted'
  | 'cacheUpdated'
  | 'backupUpdated';

export const STORAGE_WRITE_STAGES: readonly StorageWriteStage[] = Object.freeze([
  'writeRequested', 'tempWriteCompleted', 'statVerified', 'renameCompleted',
  'verifyReadCompleted', 'cacheUpdated', 'backupUpdated',
]);

/**
 * Native atomik hattın DAYANIKLILIK için ZORUNLU aşamaları.
 * `backupUpdated` ve `cacheUpdated` bu kümede DEĞİLDİR — biri yedek, diğeri
 * bellek; ikisi de diske yazıldığını KANITLAMAZ.
 */
export const REQUIRED_DURABILITY_STAGES: readonly StorageWriteStage[] = Object.freeze([
  'writeRequested', 'tempWriteCompleted', 'statVerified',
  'renameCompleted', 'verifyReadCompleted',
]);

export type StorageWriteOutcome =
  | 'SUCCESS'
  | 'PARTIAL_FAILURE'
  | 'FAILED'
  | 'BACKUP_ONLY'
  | 'UNKNOWN';

export type StorageWritePath = 'NATIVE_FILESYSTEM' | 'WEB_STORAGE' | 'UNKNOWN';

export interface StorageWriteRecord {
  readonly seq: number;
  readonly key: string;
  readonly path: StorageWritePath;
  readonly byteLength: number | null;
  readonly stages: Readonly<Record<StorageWriteStage, boolean>>;
  readonly finalOutcome: StorageWriteOutcome;
  /** İlk düşen aşama; düşmediyse `null`. */
  readonly failureStage: StorageWriteStage | null;
  readonly failureReason: string | null;
  /** Dayanıklı native yazım KANITLANDI mı — cache/backup bunu vermez. */
  readonly durableWriteProven: boolean;
  readonly provenance: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Saf hüküm
 * ════════════════════════════════════════════════════════════════════════ */

const EMPTY_STAGES: Readonly<Record<StorageWriteStage, boolean>> = Object.freeze({
  writeRequested: false, tempWriteCompleted: false, statVerified: false,
  renameCompleted: false, verifyReadCompleted: false, cacheUpdated: false,
  backupUpdated: false,
});

/** Native hattın dayanıklılığı KANITLANDI mı — tüm zorunlu aşamalar şart. */
export function isDurableWriteProven(
  stages: Readonly<Record<StorageWriteStage, boolean>>, path: StorageWritePath,
): boolean {
  if (path !== 'NATIVE_FILESYSTEM') return false;
  return REQUIRED_DURABILITY_STAGES.every((s) => stages[s] === true);
}

/**
 * Nihai hüküm — YAZIM KAPANDIĞINDA verilir.
 *
 * `SUCCESS` YALNIZ tüm zorunlu aşamalar tamamlandığında verilir. Hattın
 * istisnasız tamamlanması bile (`failed:false`) verify-read kanıtı yoksa
 * BAŞARI SAYILMAZ — kısmi tamamlanma `PARTIAL_FAILURE`'dır. Yalnız yedek
 * yazıldıysa `BACKUP_ONLY`: asıl yol sağlıklı DEĞİLDİR.
 */
export function judgeStorageWriteOutcome(
  stages: Readonly<Record<StorageWriteStage, boolean>>,
  path: StorageWritePath,
  failed: boolean,
): StorageWriteOutcome {
  if (path === 'WEB_STORAGE') {
    if (failed) return stages.backupUpdated ? 'PARTIAL_FAILURE' : 'FAILED';
    return stages.backupUpdated ? 'SUCCESS' : 'UNKNOWN';
  }
  if (path === 'UNKNOWN') return 'UNKNOWN';
  if (isDurableWriteProven(stages, path)) return 'SUCCESS';
  const anyNativeProgress = stages.tempWriteCompleted || stages.statVerified
    || stages.renameCompleted;
  if (anyNativeProgress) return 'PARTIAL_FAILURE';
  /* Native hat hiç ilerlemedi ama senkron yedek yazıldı → asıl yol SAĞLIKSIZ. */
  return stages.backupUpdated ? 'BACKUP_ONLY' : 'FAILED';
}

/** İlk düşen aşama: tamamlanmayan ilk ZORUNLU aşama. */
export function firstFailedStage(
  stages: Readonly<Record<StorageWriteStage, boolean>>,
): StorageWriteStage | null {
  for (const stage of REQUIRED_DURABILITY_STAGES) {
    if (stages[stage] !== true) return stage;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Bounded defter — canlı yazım oturumu
 * ════════════════════════════════════════════════════════════════════════ */

const CAPACITY = 24;

const PROVENANCE: readonly string[] = Object.freeze([
  'safeStorage._commitToStorage()',
  'safeStorage._fsWriteAtomic() (tmp → stat → rename → verify-read → cache)',
]);

interface OpenWrite {
  readonly key: string;
  readonly path: StorageWritePath;
  readonly byteLength: number | null;
  stages: Record<StorageWriteStage, boolean>;
}

let _seq = 0;
let _records: StorageWriteRecord[] = [];
let _open = new Map<number, OpenWrite>();
let _success = 0;
let _partial = 0;
let _backupOnly = 0;
let _failed = 0;

/** Yeni bir yazım işlemi açar; dönen kimlik aşama işaretlemede kullanılır. */
export function beginStorageWrite(
  key: string, path: StorageWritePath, byteLength: number | null,
): number {
  _seq += 1;
  _open.set(_seq, {
    key,
    path,
    byteLength: typeof byteLength === 'number' && Number.isFinite(byteLength) ? byteLength : null,
    stages: { ...EMPTY_STAGES, writeRequested: true },
  });
  /* Sınırsız büyümeyi önle: yarıda kalan (asla kapatılmayan) girişleri kırp. */
  if (_open.size > CAPACITY) {
    const oldest = _open.keys().next();
    if (!oldest.done) _open.delete(oldest.value);
  }
  return _seq;
}

/** Bir aşamayı tamamlanmış işaretler. Bilinmeyen kimlik sessizce yok sayılır. */
export function markStorageWriteStage(id: number, stage: StorageWriteStage): void {
  const entry = _open.get(id);
  if (entry === undefined) return;
  entry.stages[stage] = true;
}

/** Yazımı kapatır ve hükmü defterlere yazar. */
export function completeStorageWrite(
  id: number, failed: boolean, failureReason: string | null = null,
): StorageWriteRecord | null {
  const entry = _open.get(id);
  if (entry === undefined) return null;
  _open.delete(id);
  const stages = Object.freeze({ ...entry.stages });
  const outcome = judgeStorageWriteOutcome(stages, entry.path, failed);
  const record: StorageWriteRecord = Object.freeze({
    seq: id,
    key: entry.key,
    path: entry.path,
    byteLength: entry.byteLength,
    stages,
    finalOutcome: outcome,
    failureStage: outcome === 'SUCCESS' ? null : firstFailedStage(stages),
    failureReason: typeof failureReason === 'string' && failureReason.length <= 120
      ? failureReason : null,
    durableWriteProven: isDurableWriteProven(stages, entry.path),
    provenance: PROVENANCE,
  });
  if (outcome === 'SUCCESS') _success += 1;
  else if (outcome === 'PARTIAL_FAILURE') _partial += 1;
  else if (outcome === 'BACKUP_ONLY') _backupOnly += 1;
  else if (outcome === 'FAILED') _failed += 1;
  _records.push(record);
  if (_records.length > CAPACITY) _records.shift();
  return record;
}

export interface StorageWriteEvidence {
  readonly totalWrites: number;
  readonly successCount: number;
  readonly partialFailureCount: number;
  readonly backupOnlyCount: number;
  readonly failedCount: number;
  readonly openWrites: number;
  readonly recent: readonly StorageWriteRecord[];
  readonly provenance: readonly string[];
}

export function getStorageWriteEvidence(): StorageWriteEvidence {
  return Object.freeze({
    totalWrites: _seq,
    successCount: _success,
    partialFailureCount: _partial,
    backupOnlyCount: _backupOnly,
    failedCount: _failed,
    openWrites: _open.size,
    recent: Object.freeze([..._records]),
    provenance: PROVENANCE,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetStorageWriteEvidenceForTest(): void {
  _seq = 0;
  _records = [];
  _open = new Map();
  _success = 0;
  _partial = 0;
  _backupOnly = 0;
  _failed = 0;
}
