/**
 * vehicleLearningEvidenceStore — Kalıcı Araç Öğrenme Kanıtı Deposu (P2-2).
 *
 * AMAÇ: P2-1'in ürettiği LearningEvidence kayıtlarını OTURUMLAR ARASI kalıcı kılar → sistem
 * farklı araçlardan/günlerden gelen kanıtı OFFLINE biriktirir. safeStorage tabanlı, bounded
 * (512) LRU, throttle'lı yazma, fail-soft.
 *
 * KESİN SINIRLAR (CLAUDE.md): Cloud/SQL/LLM/Native YOK · hot-path YOK · localStorage DOĞRUDAN
 * kullanılmaz (yalnız safeStorage) · yüksek-frekanslı disk yazma YASAK (debounce). Vehicle
 * Learning Engine confidence FORMÜLÜ DEĞİŞTİRİLMEZ — yeniden hesap için P1'in
 * evidenceConfidence/evidenceStatus fonksiyonları SALT-OKUNUR çağrılır. Discovery/VKB/
 * Manufacturer Intelligence/Diagnostic davranışı DEĞİŞMEZ. Bu PR'da decay/prune YOK (P2-3).
 *
 * ZERO-LEAK: dispose() debounce timer'ını temizler + bekleyeni diske yazar.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';
import {
  evidenceConfidence,
  evidenceStatus,
  type LearningEvidence,
  type EvidenceStatus,
} from './vehicleLearningEngine';

/** safeStorage LRU_PROTECTED anahtarı (kota dolunca SİLİNMEZ — bkz. safeStorage.ts). */
export const EVIDENCE_STORAGE_KEY = 'car-vehicle-learning-evidence';
/** Depo şema sürümü — eski/uyumsuz veri fail-soft atılır. */
export const EVIDENCE_SCHEMA_VERSION = 1;
/** Bounded tavan — en fazla bu kadar kanıt (LRU eviction). */
export const MAX_EVIDENCE = 512;
/** Yazma debounce (ms) — yüksek frekanslı disk yazımını önler (5–10 sn). */
export const EVIDENCE_WRITE_DEBOUNCE_MS = 5000;

/** Kalıcı zarf (şema sürümlü). */
interface EvidenceEnvelope {
  schema: number;
  items:  LearningEvidence[];
}

/** Enjekte edilebilir I/O (varsayılan safeStorage; test için değiştirilebilir). */
export interface EvidenceStoreIO {
  read:   (key: string) => string | null;
  write:  (key: string, value: string) => void;
  remove: (key: string) => void;
}

const DEFAULT_IO: EvidenceStoreIO = { read: safeGetRaw, write: safeSetRaw, remove: safeRemoveRaw };

const STATUS_RANK: Record<EvidenceStatus, number> = { weak: 0, candidate: 1, strong: 2 };

/* ── Saf yardımcılar ──────────────────────────────────────────────────────── */

function _normEcu(s: string): string {
  return (s ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/^0X/, '');
}
function _uniqSortEcus(...lists: readonly string[][]): string[] {
  const set = new Set<string>();
  for (const l of lists) for (const s of l ?? []) { const n = _normEcu(s); if (n) set.add(n); }
  return [...set].sort();
}
function _uniqSortHashes(...lists: readonly string[][]): string[] {
  const set = new Set<string>();
  for (const l of lists) for (const s of l ?? []) { const n = (s ?? '').trim(); if (n) set.add(n); }
  return [...set].sort();
}
function _safeCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Store'a girecek kanonik kanıt üretir (SALT-OKUNUR — girdiyi mutasyona uğratmaz):
 * ECU/hash normalize+unique, vehicleCount = distinct hash sayısı, confidence/status P1
 * fonksiyonlarıyla yeniden hesaplanır. `existing` verilirse BİRLEŞTİRİLİR (upsert).
 */
function _normalizeIncoming(ev: LearningEvidence, existing: LearningEvidence | null, now: number): LearningEvidence {
  const hashes = existing
    ? _uniqSortHashes(existing.supportingVehicleHashes, ev.supportingVehicleHashes)
    : _uniqSortHashes(ev.supportingVehicleHashes);
  const ecus = existing
    ? _uniqSortEcus(existing.ecuAddresses, ev.ecuAddresses)
    : _uniqSortEcus(ev.ecuAddresses);
  const observationCount = existing
    ? _safeCount(existing.observationCount) + _safeCount(ev.observationCount)
    : _safeCount(ev.observationCount);
  const vehicleCount = hashes.length;                       // distinct fingerprint sayısı
  const firstSeen = existing ? Math.min(existing.firstSeen, ev.firstSeen) : ev.firstSeen;
  const lastSeen = existing ? Math.max(existing.lastSeen, ev.lastSeen) : ev.lastSeen;

  return {
    evidenceId:              ev.evidenceId,
    manufacturer:            ev.manufacturer,
    profileHint:             ev.profileHint || (existing?.profileHint ?? ''),
    protocol:                ev.protocol,
    discoverySource:         ev.discoverySource,
    pidOrDid:                ev.pidOrDid,
    mode:                    ev.mode,
    ecuAddresses:            ecus,
    supportingVehicleHashes: hashes,
    vehicleCount,
    observationCount,
    firstSeen,
    lastSeen,
    confidence:              evidenceConfidence(vehicleCount, observationCount, ecus.length), // P1 — DEĞİŞMEZ
    status:                  evidenceStatus(vehicleCount, ecus.length),                       // P1 — DEĞİŞMEZ
    createdAt:               existing ? existing.createdAt : (ev.createdAt || now),           // KORUNUR
    updatedAt:               Math.max(existing?.updatedAt ?? 0, ev.updatedAt || now),         // GÜNCELLENİR
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Depo
 * ════════════════════════════════════════════════════════════════════════ */

export class VehicleLearningEvidenceStore {
  private readonly storageKey: string;
  private readonly maxItems: number;
  private readonly debounceMs: number;
  private readonly _io: EvidenceStoreIO;
  private readonly _now: () => number;

  /** evidenceId → kanıt (ekleme sırası = LRU recency ipucu; ama eviction status+zaman temelli). */
  private _items = new Map<string, LearningEvidence>();
  private _loaded = false;
  private _dirty = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;

  constructor(
    storageKey = EVIDENCE_STORAGE_KEY,
    maxItems = MAX_EVIDENCE,
    debounceMs = EVIDENCE_WRITE_DEBOUNCE_MS,
    io: EvidenceStoreIO = DEFAULT_IO,
    now: () => number = () => Date.now(),
  ) {
    this.storageKey = storageKey;
    this.maxItems = maxItems;
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
      // Eski/uyumsuz şema veya bozuk yapı → fail-soft boş.
      if (!parsed || typeof parsed !== 'object') return;
      const env = parsed as Partial<EvidenceEnvelope>;
      if (env.schema !== EVIDENCE_SCHEMA_VERSION || !Array.isArray(env.items)) return;
      for (const it of env.items) {
        if (it && typeof it.evidenceId === 'string' && it.evidenceId) this._items.set(it.evidenceId, it);
      }
    } catch {
      this._items = new Map(); // bozuk JSON → dürüstçe boş
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
      const env: EvidenceEnvelope = { schema: EVIDENCE_SCHEMA_VERSION, items: [...this._items.values()] };
      this._io.write(this.storageKey, JSON.stringify(env));
      this._dirty = false;
    } catch {
      /* kota/serileştirme — bellek korunur, fail-soft */
    }
  }

  /* ── Bounded LRU eviction (status-aware, deterministik) ────────────────── */

  private _evictIfNeeded(): void {
    while (this._items.size > this.maxItems) {
      let victimId: string | null = null;
      let victimRank = Infinity;
      let victimRecency = Infinity;
      for (const [id, e] of this._items) {
        const rank = STATUS_RANK[e.status] ?? 0;                 // weak<candidate<strong
        const recency = Math.max(e.lastSeen ?? 0, e.updatedAt ?? 0); // en eski öncelikli
        // Deterministik: önce en düşük status (weak önce silinir), sonra en eski, sonra id.
        if (rank < victimRank ||
            (rank === victimRank && recency < victimRecency) ||
            (rank === victimRank && recency === victimRecency && (victimId === null || id < victimId))) {
          victimId = id; victimRank = rank; victimRecency = recency;
        }
      }
      if (victimId === null) break;
      this._items.delete(victimId);
    }
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  /** Kanıtı BİRLEŞTİREREK ekler/günceller (aynı evidenceId → duplicate YOK). */
  upsert(ev: LearningEvidence): LearningEvidence {
    this._ensureLoaded();
    const existing = this._items.get(ev.evidenceId) ?? null;
    const merged = _normalizeIncoming(ev, existing, this._now());
    this._items.delete(merged.evidenceId);   // recency: sona taşı
    this._items.set(merged.evidenceId, merged);
    this._evictIfNeeded();
    this._scheduleFlush();
    return { ...merged, ecuAddresses: [...merged.ecuAddresses], supportingVehicleHashes: [...merged.supportingVehicleHashes] };
  }

  /** Kanıtı yazar (id'de kayıt varsa createdAt korunarak ÜZERİNE yazar; birikim YOK). */
  save(ev: LearningEvidence): LearningEvidence {
    this._ensureLoaded();
    const existing = this._items.get(ev.evidenceId) ?? null;
    const norm = _normalizeIncoming(ev, null, this._now());
    const record: LearningEvidence = existing ? { ...norm, createdAt: existing.createdAt } : norm;
    this._items.delete(record.evidenceId);
    this._items.set(record.evidenceId, record);
    this._evictIfNeeded();
    this._scheduleFlush();
    return { ...record, ecuAddresses: [...record.ecuAddresses], supportingVehicleHashes: [...record.supportingVehicleHashes] };
  }

  /** evidenceId ile kanıtı getirir (kopya) veya null. */
  get(evidenceId: string): LearningEvidence | null {
    this._ensureLoaded();
    const e = this._items.get(evidenceId);
    return e ? { ...e, ecuAddresses: [...e.ecuAddresses], supportingVehicleHashes: [...e.supportingVehicleHashes] } : null;
  }

  /** Tüm kanıtların kopyası. */
  list(): LearningEvidence[] {
    this._ensureLoaded();
    return [...this._items.values()].map((e) => ({ ...e, ecuAddresses: [...e.ecuAddresses], supportingVehicleHashes: [...e.supportingVehicleHashes] }));
  }

  /** evidenceId ile siler. @returns silindi mi. */
  remove(evidenceId: string): boolean {
    this._ensureLoaded();
    if (!this._items.delete(evidenceId)) return false;
    this._scheduleFlush();
    return true;
  }

  /** Tüm kanıtları ve kalıcı kaydı temizler. */
  clear(): void {
    this._items = new Map();
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

  /** Saklanan kanıt sayısı. */
  get size(): number {
    this._ensureLoaded();
    return this._items.size;
  }
}

/** Uygulama geneli tekil depo (wiring YOK — UI/mantık on-demand kullanır). */
export const vehicleLearningEvidenceStore = new VehicleLearningEvidenceStore();
