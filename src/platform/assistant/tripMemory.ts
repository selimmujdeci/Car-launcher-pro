/**
 * tripMemory.ts — **MAVİ F10 · YOLCULUK HAFIZASI (TRIP scope).**
 *
 * ── NE ÇÖZER (B7a) ─────────────────────────────────────────────────────────
 * Denetim ölçtü: repoda *"bu yolculukta konuştuklarımız"* diye bir kavram
 * **hiç yoktu**. Konuşma bağlamı yalnız `companionChatProvider._history`
 * (8 tur, HAM transkript, RAM) ve tur-sayaçlı `_activeTopic` idi. Üç saat
 * sonra "hani şu bahsettiğin yer" sorusunun bağlamı **yoktu**.
 *
 * ── YOLCULUK KİMLİĞİ UYDURULMADI ────────────────────────────────────────────
 * Ölçüm: `tripLogService`'te AKTİF yolculuğun **kimliği YOKTUR** —
 * `generateTripId()` yalnız yolculuk BİTERKEN çağrılır (kayıt oluşurken).
 * Bu yüzden F10 yeni bir kimlik sistemi KURMAZ; mevcut ve gerçek bir olgudan
 * (`ActiveTrip.startTime`) **türetilmiş** bir kapsam anahtarı kullanır:
 *
 *     tripKey = 'trip:' + startTime      (aktif yolculuk yoksa → null)
 *
 * `startTime` yolculuk başına benzersizdir ve zaten kalıcı kayda giren bir
 * alandır; yeni bir gerçeklik kaynağı doğurmaz.
 *
 * ── SINIRLAR (pazarlıksız) ──────────────────────────────────────────────────
 *  · **YALNIZ RAM.** Yolculuk hafızası kalıcı depoya YAZILMAZ. Yolculuk özeti
 *    ancak AÇIK izinle uzun döneme taşınabilir — ve bu turda o taşıma yolunun
 *    üretimde çağıranı YOKTUR (açık borç; sessizce kalıcılaştırma YASAK).
 *  · **HAM TRANSKRİPT ÇÖPLÜĞÜ DEĞİL.** Yazılan her değer hassas-veri kapısından
 *    geçer, ≤160 karakterdir ve bounded `kind` taşır (`topic` · `action` ·
 *    `open_loop` · `preference` · `fact`).
 *  · **YENİ YOLCULUK ESKİSİNİ DEVRALMAZ.** Anahtar değişince önceki yolculuk
 *    MÜHÜRLENİR (kayıtları düşer); projeksiyon da anahtar eşleşmesi arar.
 *  · **TIMER/ABONELİK YOK.** Yolculuk sınırı, okuma/yazma anında canlı kaynaktan
 *    (DI) tespit edilir — `maviWorkloadSource` deseniyle birebir aynı.
 *  · Bu modül **karar vermez**: eylem yürütmez, tercih üretmez, konuşmaz.
 */

import { guardMemoryText } from '../ai/memory/sensitiveMemoryGuard';
import {
  MAVI_MEMORY_MAX_TRIP,
  MAVI_MEMORY_SCHEMA_VERSION,
  classifyMemoryDomain,
  normalizeMemoryValue,
  type MaviMemoryKind,
  type MaviMemoryRecord,
} from './maviMemoryModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Yolculuk kapsamı (DI — canlı okuma AYRI dosyada değil, tek satırlık port)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Aktif yolculuğun başlangıç damgası (Unix ms) ya da `null` (yolculuk yok).
 * Port bağlı DEĞİLSE kapsam DÜRÜSTÇE `null` döner — "yolculuk var" varsayılmaz.
 */
export type TripScopeSource = () => number | null;

let _scopeSource: TripScopeSource | null = null;

/** Canlı kaynağı kaydeder (idempotent). `null` → kapsam UNAVAILABLE. */
export function setTripScopeSource(source: TripScopeSource | null): void {
  _scopeSource = typeof source === 'function' ? source : null;
}

/** Kaynak bağlı mı — LAB dürüstlüğü için (bağlı değilse TRIP hafızası ÇALIŞMAZ). */
export function isTripScopeBound(): boolean {
  return _scopeSource !== null;
}

/**
 * Şu anki yolculuk anahtarı. Aktif yolculuk yoksa ya da kaynak bağlı değilse
 * `null` — **uydurma anahtar ÜRETİLMEZ**.
 */
export function currentTripKey(): string | null {
  if (!_scopeSource) return null;
  let start: number | null = null;
  try { start = _scopeSource(); } catch { start = null; }
  if (typeof start !== 'number' || !Number.isFinite(start) || start <= 0) return null;
  return `trip:${start}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Depo (RAM · bounded · süreç ömürlü)
 * ════════════════════════════════════════════════════════════════════════ */

let _tripKey: string | null = null;
let _records: MaviMemoryRecord[] = [];

/* Bounded sayaçlar (PII YOK — yalnız adet). */
const MAX_COUNTER = 1_000_000;
function _bump(v: number): number { return v >= MAX_COUNTER ? MAX_COUNTER : v + 1; }
let _written = 0;
let _rejected = 0;
let _dropped = 0;
let _sealed = 0;

let _seq = 0;
function _newId(nowMs: number): string {
  _seq = (_seq + 1) % 100000;
  return `t${Math.trunc(nowMs).toString(36)}${_seq.toString(36)}`;
}

/**
 * Yolculuk sınırını uygular. Anahtar değiştiyse **önceki yolculuk MÜHÜRLENİR**:
 * kayıtları düşer (RAM'den de) ve yeni yolculuk BOŞ başlar.
 *
 * Mühürleme bir ÖZET ÜRETMEZ ve hiçbir şeyi kalıcılaştırmaz — özet taşıma yolu
 * AÇIK İZNE bağlıdır ve bu turda çağıranı yoktur (bkz. dosya başlığı).
 */
function _syncScope(): string | null {
  const key = currentTripKey();
  if (key !== _tripKey) {
    if (_records.length > 0 || _tripKey !== null) _sealed = _bump(_sealed);
    _records = [];
    _tripKey = key;
  }
  return _tripKey;
}

export interface TripMemoryWriteResult {
  readonly stored: boolean;
  /** `ok` · `no_trip` · `rejected_sensitive` · `duplicate` — bounded. */
  readonly reason: 'ok' | 'no_trip' | 'rejected_sensitive' | 'duplicate';
  readonly id: string | null;
}

/**
 * Yolculuk hafızasına bounded bir kayıt yazar.
 *
 * **Ham konuşma metni buraya YAZILMAZ** — çağıranın sözleşmesi kısa, konu
 * düzeyinde bir ifadedir. Yine de kapı burada da uygulanır (savunma katmanı).
 */
export function rememberTrip(
  value: string,
  kind: MaviMemoryKind,
  nowMs: number,
): TripMemoryWriteResult {
  try {
    const key = _syncScope();
    if (key === null) return Object.freeze({ stored: false, reason: 'no_trip' as const, id: null });

    const guard = guardMemoryText(value);
    if (!guard.allowed) {
      _rejected = _bump(_rejected);
      return Object.freeze({ stored: false, reason: 'rejected_sensitive' as const, id: null });
    }

    const norm = normalizeMemoryValue(guard.text);
    const existing = _records.find((r) => normalizeMemoryValue(r.value) === norm && r.kind === kind);
    if (existing) {
      /* Tekrar gözlem: yeni kayıt AÇMAZ, tazeliği günceller (gürültü önleme). */
      const idx = _records.indexOf(existing);
      _records[idx] = Object.freeze({
        ...existing,
        lastConfirmedAtMs: nowMs,
        evidenceCount: existing.evidenceCount + 1,
      });
      return Object.freeze({ stored: true, reason: 'duplicate' as const, id: existing.id });
    }

    const record: MaviMemoryRecord = Object.freeze({
      id: _newId(nowMs),
      schemaVersion: MAVI_MEMORY_SCHEMA_VERSION,
      scope: 'TRIP' as const,
      kind,
      domain: classifyMemoryDomain(guard.text),
      /* Yolculuk kaydı bir BEYAN değildir; gözlemdir. Ama INFERRED de değildir —
         "bu yolculukta konuşuldu/yapıldı" doğrudan gözlenmiş bir olgudur ve
         uzun dönem tercih ÜRETMEZ (F6/F7: OBSERVED ≠ tercih). */
      origin: 'EXPLICIT' as const,
      source: 'trip_event' as const,
      provenance: 'trip_memory',
      value: guard.text,
      confidence: 1,
      evidenceCount: 1,
      createdAtMs: nowMs,
      lastConfirmedAtMs: nowMs,
      decayHalfLifeMs: null,
      expiresAtMs: null,
      correction: Object.freeze({ state: 'NONE' as const, atMs: null, supersededById: null }),
      privacyClass: 'SAFE' as const,
      tripKey: key,
    });

    _records.push(record);
    if (_records.length > MAVI_MEMORY_MAX_TRIP) {
      _records = _records.slice(-MAVI_MEMORY_MAX_TRIP);   // en eski düşer
      _dropped = _bump(_dropped);
    }
    _written = _bump(_written);
    return Object.freeze({ stored: true, reason: 'ok' as const, id: record.id });
  } catch {
    return Object.freeze({ stored: false, reason: 'no_trip' as const, id: null });
  }
}

/**
 * AKTİF yolculuğun kayıtları. Yolculuk değiştiyse burada da mühürlenir →
 * eski yolculuğun bağlamı yeni yolculuğa **sızamaz**.
 */
export function getTripRecords(): readonly MaviMemoryRecord[] {
  try {
    _syncScope();
    return [..._records];
  } catch { return []; }
}

/** Belirli kayıtları siler (FORGET yolu). Silinen adedi döner. */
export function forgetTripRecords(predicate: (r: MaviMemoryRecord) => boolean): number {
  try {
    const before = _records.length;
    _records = _records.filter((r) => !predicate(r));
    return before - _records.length;
  } catch { return 0; }
}

export interface TripMemoryDiagnostics {
  readonly scopeBound: boolean;
  /** Aktif yolculuk VAR mı (anahtar `null` ise TRIP hafızası yazılmaz). */
  readonly hasActiveTrip: boolean;
  readonly recordCount: number;
  readonly capacity: number;
  readonly written: number;
  readonly rejectedSensitive: number;
  readonly droppedOverflow: number;
  readonly tripsSealed: number;
}

/** Bounded tanı — **kayıt METNİ TAŞINMAZ** (yalnız adet ve bayrak). */
export function getTripMemoryDiagnostics(): TripMemoryDiagnostics {
  let hasTrip = false;
  try { hasTrip = _syncScope() !== null; } catch { hasTrip = false; }
  return Object.freeze({
    scopeBound: _scopeSource !== null,
    hasActiveTrip: hasTrip,
    recordCount: _records.length,
    capacity: MAVI_MEMORY_MAX_TRIP,
    written: _written,
    rejectedSensitive: _rejected,
    droppedOverflow: _dropped,
    tripsSealed: _sealed,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetTripMemoryForTest(): void {
  _scopeSource = null;
  _tripKey = null;
  _records = [];
  _written = 0; _rejected = 0; _dropped = 0; _sealed = 0; _seq = 0;
}
