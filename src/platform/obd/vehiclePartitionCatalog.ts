/**
 * vehiclePartitionCatalog — P0-VDK-F5G · ARAÇ BÖLÜM KATALOĞU + ÇÖP TOPLAMA.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE YAPAR ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Cihazda hangi araç bölümlerinin var olduğunu ve ne kadar değerli olduklarını
 * tutar; tavan aşılınca SAF `vehiclePartitionPolicy` planına göre en düşük
 * değerli bölümleri siler.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **FLEETMEMORY VERİTABANI DEĞİLDİR.** Yalnız METADATA tutar: referans ·
 *     damgalar · yaklaşık sayılar · sağlık. Ham yetenek kenarı, ham boşluk
 *     kaydı, ham yanıt, VIN, MAC buraya GİRMEZ.
 * (2) **İKİNCİ KİMLİK OTORİTESİ DEĞİLDİR.** Referans MEVCUT F4-C parmak izi
 *     karmasıdır; burada kimlik ÜRETİLMEZ.
 * (3) **BULUT DEĞİLDİR.** Supabase/FleetKB/ağ TEK BAYT yazmaz.
 * (4) **KARAR VERMEZ.** Hangi bölümün gideceği SAF politikadadır.
 *
 * ⚠️ ATOMİKLİK: `safeStorage` bir işlem (transaction) sunmaz. Bu yüzden GC
 * "hepsi ya da hiçbiri" GARANTİ ETMEZ — ama **sessizce başarı da SAYMAZ**:
 * silinemeyen bir bölüm katalogda `PARTIAL_GC` olarak KALIR ve bir sonraki
 * turda yeniden denenir. Yarım temizlik bir kanıttır, bir sessizlik değil.
 *
 * timer YOK · abonelik YOK · ağ YOK · `Date.now` ENJEKTE edilir.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';
import { logError } from '../crashLogger';
import { isStoreTrustworthy, type StoreHealth } from './capability/capabilityStore';
import { isPersistableVehicleRef, vehiclePartitionKeys } from './gapLedgerScope';
import {
  MAX_VEHICLE_PARTITIONS, planPartitionGc,
  type PartitionGcPlan, type PartitionHealth, type VehiclePartitionEntry,
} from './vehiclePartitionPolicy';

/* ══════════════════════════════════════════════════════════════════════════
   1) ŞEMA
   ══════════════════════════════════════════════════════════════════════════ */

export const PARTITION_CATALOG_KEY = 'caros-vehicle-partitions-v1';
export const PARTITION_CATALOG_SCHEMA_VERSION = 1;

interface StoredCatalog {
  readonly schemaVersion: number;
  readonly savedAt: number | null;
  /** BÜTÜNLÜK: `entries.length` ile eşleşmezse depo YARIM sayılır. */
  readonly entryCount: number;
  readonly entries: readonly VehiclePartitionEntry[];
  readonly lastGcAt: number | null;
  readonly evictedTotal: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) DEFTER
   ══════════════════════════════════════════════════════════════════════════ */

const _entries = new Map<string, VehiclePartitionEntry>();
let _health: StoreHealth = 'EMPTY';
let _loaded = false;
let _lastGcAt: number | null = null;
let _evictedTotal = 0;
let _partialGc = 0;

export function getVehiclePartitions(): readonly VehiclePartitionEntry[] {
  try {
    _ensureLoaded();
    return [..._entries.values()].sort((a, b) => a.ref.localeCompare(b.ref));
  } catch { return []; }
}

export function getPartitionCatalogHealth(): StoreHealth { return _health; }
export function getPartitionLastGcAt(): number | null { return _lastGcAt; }
export function getPartitionEvictedTotal(): number { return _evictedTotal; }
/** YARIM kalan temizlik adedi — sessiz başarı YASAK. */
export function getPartitionPartialGcCount(): number { return _partialGc; }
export function isPartitionCatalogLoaded(): boolean { return _loaded; }

export function getCorruptPartitionCount(): number {
  let n = 0;
  try {
    for (const e of _entries.values()) {
      if (e.health === 'CORRUPT' || e.health === 'PARTIAL_GC') n++;
    }
  } catch { /* fail-soft */ }
  return n;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) OKUMA — fail-closed
   ══════════════════════════════════════════════════════════════════════════ */

function _validEntry(v: unknown): v is VehiclePartitionEntry {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return typeof e.ref === 'string' && isPersistableVehicleRef(e.ref)
    && (e.createdAt === null || typeof e.createdAt === 'number')
    && (e.lastUsedAt === null || typeof e.lastUsedAt === 'number')
    && typeof e.gapEntries === 'number'
    && typeof e.unresolvedGaps === 'number'
    && typeof e.capabilityEdges === 'number'
    && typeof e.health === 'string';
}

/**
 * Katalogu yükler. ASLA throw etmez ve bozuk katalogda bölüm İDDİA ETMEZ.
 *
 * Tek şekilsiz satır TÜM katalogu reddettirir: kısmen güvenilen bir katalog,
 * hangi aracın bölümünün silinebileceğini bilmediğimiz bir katalogdur.
 */
export function loadPartitionCatalog(): StoreHealth {
  _entries.clear();
  _loaded = true;
  let raw: string | null;
  try {
    raw = safeGetRaw(PARTITION_CATALOG_KEY);
  } catch (e) {
    logError('OBD:PartitionCatalogRead', e);
    _health = 'UNAVAILABLE';
    return _health;
  }
  if (raw === null || raw.length === 0) { _health = 'EMPTY'; return _health; }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { _health = 'CORRUPT'; return _health; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    _health = 'CORRUPT'; return _health;
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.schemaVersion !== 'number') { _health = 'CORRUPT'; return _health; }
  if (env.schemaVersion !== PARTITION_CATALOG_SCHEMA_VERSION) {
    _health = 'SCHEMA_MISMATCH'; return _health;
  }
  if (!Array.isArray(env.entries)) { _health = 'CORRUPT'; return _health; }
  if (typeof env.entryCount !== 'number' || env.entryCount !== env.entries.length) {
    _health = 'CORRUPT'; return _health;
  }
  if (!env.entries.every(_validEntry)) { _health = 'CORRUPT'; return _health; }

  for (const e of env.entries as VehiclePartitionEntry[]) _entries.set(e.ref, e);
  _lastGcAt = typeof env.lastGcAt === 'number' ? env.lastGcAt : null;
  _evictedTotal = typeof env.evictedTotal === 'number' && env.evictedTotal > 0
    ? env.evictedTotal : 0;
  _health = 'OK';
  return _health;
}

function _ensureLoaded(): void {
  if (!_loaded) loadPartitionCatalog();
}

function _persist(atMs: number | null): boolean {
  if (!isStoreTrustworthy(_health)) return false;
  const entries = [..._entries.values()];
  const env: StoredCatalog = {
    schemaVersion: PARTITION_CATALOG_SCHEMA_VERSION,
    savedAt: atMs,
    entryCount: entries.length,
    entries,
    lastGcAt: _lastGcAt,
    evictedTotal: _evictedTotal,
  };
  try {
    safeSetRaw(PARTITION_CATALOG_KEY, JSON.stringify(env), undefined, false);
    return true;
  } catch (e) {
    logError('OBD:PartitionCatalogWrite', e);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KAYIT
   ══════════════════════════════════════════════════════════════════════════ */

export interface TouchPartitionInput {
  readonly ref: string;
  readonly nowMs: number | null;
  readonly gapEntries: number;
  readonly unresolvedGaps: number;
  readonly capabilityEdges: number;
  readonly health: PartitionHealth;
}

/**
 * Bir bölümü "şu an kullanıldı" olarak işaretler ve özetini günceller.
 *
 * ⚠️ Yalnız KALICI bölüm açabilen (parmak izi biçimli) referans katalogda yer
 * alır: bellek içi/zayıf kimlikli bir oturum diskte bölüm açmadığı için
 * katalogda da satır AÇMAZ — olmayan bir dosyayı silmeye çalışmak, yarım
 * temizlik kanıtı üretirdi.
 */
export function touchVehiclePartition(input: TouchPartitionInput): void {
  try {
    if (!isPersistableVehicleRef(input.ref)) return;
    _ensureLoaded();
    const prev = _entries.get(input.ref) ?? null;
    _entries.set(input.ref, Object.freeze({
      ref: input.ref,
      createdAt: prev?.createdAt ?? input.nowMs,
      lastUsedAt: input.nowMs,
      gapEntries: input.gapEntries,
      unresolvedGaps: input.unresolvedGaps,
      capabilityEdges: input.capabilityEdges,
      health: input.health,
    }));
    _persist(input.nowMs);
  } catch (e) { logError('OBD:PartitionTouch', e); }
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ÇÖP TOPLAMA
   ══════════════════════════════════════════════════════════════════════════ */

export interface PartitionGcResult {
  readonly plan: PartitionGcPlan;
  /** GERÇEKTEN silinen bölümler. */
  readonly removed: readonly string[];
  /** Silinemeyen (YARIM kalan) bölümler — katalogda `PARTIAL_GC` kalır. */
  readonly partial: readonly string[];
}

/**
 * Bir aracın TÜM kalıcı bölümlerini siler ve gerçekten gittiğini DOĞRULAR.
 *
 * Sıra sabittir (yetenek → boşluk) ve her silmeden sonra anahtar yeniden
 * okunur: `safeStorage` işlem sunmadığı için "sildim" demek yetmez, silinmiş
 * OLDUĞU ölçülür. Bir anahtar hâlâ duruyorsa sonuç YARIM sayılır.
 */
function _removePartitionFiles(ref: string): boolean {
  let allGone = true;
  for (const key of vehiclePartitionKeys(ref)) {
    try {
      safeRemoveRaw(key);
      const still = safeGetRaw(key);
      if (still !== null && still.length > 0) allGone = false;
    } catch (e) {
      logError('OBD:PartitionRemove', e);
      allGone = false;
    }
  }
  return allGone;
}

/**
 * Tavanı aşan bölümleri temizler. ASLA throw etmez.
 *
 * ⚠️ AKTİF ARAÇ ASLA SİLİNMEZ — bu kilit SAF politikadadır (`planPartitionGc`
 * aktif referansı aday listesinden çıkarır) ve burada İKİNCİ kez uygulanır:
 * plan yanlışlıkla aktif aracı içerse bile bu döngü onu ATLAR ve sayar.
 */
export function runPartitionGc(
  activeRef: string | null, nowMs: number | null,
  maxPartitions: number = MAX_VEHICLE_PARTITIONS,
): PartitionGcResult {
  const removed: string[] = [];
  const partial: string[] = [];
  let plan: PartitionGcPlan = {
    evict: [], reason: 'katalog okunamadı', activeProtected: false,
  };
  try {
    _ensureLoaded();
    plan = planPartitionGc(getVehiclePartitions(), activeRef, nowMs, maxPartitions);
    for (const ref of plan.evict) {
      /* İKİNCİ KAPI: aktif araç hiçbir koşulda silinemez. */
      if (activeRef !== null && ref === activeRef) continue;
      if (_removePartitionFiles(ref)) {
        _entries.delete(ref);
        removed.push(ref);
        _evictedTotal++;
      } else {
        const prev = _entries.get(ref);
        if (prev !== undefined) {
          _entries.set(ref, Object.freeze({ ...prev, health: 'PARTIAL_GC' as const }));
        }
        partial.push(ref);
        _partialGc++;
      }
    }
    if (plan.evict.length > 0) {
      _lastGcAt = nowMs;
      _persist(nowMs);
    }
  } catch (e) { logError('OBD:PartitionGc', e); }
  return { plan, removed, partial };
}

/** @internal — testler arası izolasyon. */
export function _resetPartitionCatalogForTest(): void {
  _entries.clear();
  _health = 'EMPTY';
  _loaded = false;
  _lastGcAt = null;
  _evictedTotal = 0;
  _partialGc = 0;
  try { safeRemoveRaw(PARTITION_CATALOG_KEY); } catch { /* test temizliği */ }
}

/** @internal — bozuk katalog yazıp fail-closed davranışı ölçmek için. */
export function _writeRawCatalogForTest(raw: string): void {
  safeSetRaw(PARTITION_CATALOG_KEY, raw, undefined, true);
  _loaded = false;
}
