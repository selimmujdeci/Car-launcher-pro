/**
 * aiCore/vehicleMemory.ts — ARAÇ HAFIZASI (fingerprint-anahtarlı · kalıcı · pekiştirmeli).
 *
 * AMAÇ (VİZYON — "yüzlerce bilinmeyen aracı ÖĞRENİRİZ"): her aracın (fingerprint hash ile
 * tanınan) zamanla ÖĞRENİLEN kalıcı gerçeklerini tutar — "bu araçta 0x3C katalizör decode
 * güvenilmez", "KWP: hız ABS ECU'sunda, motor ECU'su 0 döner", "bu araç Mode09/VIN
 * desteklemiyor". Böylece araç tekrar bağlandığında sistem sıfırdan öğrenmez (self-learning).
 *
 * companionMemory'DEN FARKI: o SÜRÜCÜ-kişisel ("kızımın adı Elif"); bu ARAÇ-teknik ve
 * fingerprint'e bağlı. İkisi ayrı depo, ayrı gizlilik sınırı.
 *
 * PEKİŞTİRME (self-learning): aynı gerçek tekrar gözlenince güven ARTAR (bounded, asla 1'e
 * ulaşmaz — zero-trust). Tek gözlem "kesin" yapmaz; tekrar eden gözlem güçlenir.
 *
 * ZERO-TRUST / KALICILIK: safeStorage bounded LRU (max araç + araç başı max gerçek). Bozuk
 * disk → fail-soft boş. PII: statement sanitize. SAF çekirdek + DI (zaman/storage enjekte).
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';

/* ── Model ──────────────────────────────────────────────────────── */

export interface VehicleMemoryFact {
  /** Kararlı, normalize anahtar (dedup) — ör. 'catalyst_decode_unreliable'. */
  readonly key: string;
  /** İnsan-okur ifade (PII-temizli). */
  readonly statement: string;
  /** 0..1 — pekiştirmeyle artan güven (asla 1'e ulaşmaz). */
  readonly confidence: number;
  /** Kaç kez gözlendi (pekiştirme sayacı). */
  readonly observations: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
  /** Kaynak/gerekçe etiketi (provenance). */
  readonly source: string;
}

/** remember() girdisi. */
export interface RememberInput {
  readonly key: string;
  readonly statement: string;
  readonly confidence: number;
  readonly source?: string;
}

interface VehicleMemoryRecord {
  fingerprintHash: string;
  facts: VehicleMemoryFact[];
  updatedAt: number;
}

/* ── Sabitler + saf yardımcılar ─────────────────────────────────── */

export const VEHICLE_MEMORY_STORAGE_KEY = 'car-vehicle-memory-v1';
export const MAX_MEMORY_VEHICLES = 8;         // fingerprint deposuyla hizalı
export const MAX_FACTS_PER_VEHICLE = 32;
/** Pekiştirme oranı: yeni gözlem güveni ne kadar yukarı iter (0..1). */
const REINFORCE_RATE = 0.5;
/** Güven tavanı — zero-trust: tek/çok gözlem asla mutlak kesinlik olmaz. */
const CONFIDENCE_CEILING = 0.99;
const MAX_STATEMENT_CHARS = 160;

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const COORD_RE = /-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g;
const SECRET_RE = /\b(?:sk|pk|api|key|token|bearer)[-_]?[A-Za-z0-9_-]{12,}\b/gi;

function _sanitize(v: unknown, maxChars = MAX_STATEMENT_CHARS): string {
  if (typeof v !== 'string') return '';
  const c = v.replace(SECRET_RE, '[redacted]').replace(MAC_RE, '[redacted]')
    .replace(VIN_RE, '[redacted]').replace(COORD_RE, '[redacted]').trim();
  return c.length > maxChars ? c.slice(0, maxChars) : c;
}

/** Anahtar normalize — küçük harf, boşluk→_, yalnız [a-z0-9_.]. */
function _key(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.]/g, '').slice(0, 64);
}

function _clamp01(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function _fingerprint(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 17) return null;
  return /^[0-9a-fA-F]{8,64}$/.test(s) ? s.toLowerCase() : null;
}

/** Pekiştirme: mevcut güveni yeni gözleme göre yukarı iter (bounded, monoton). */
export function reinforceConfidence(existing: number, observed: number): number {
  const e = _clamp01(existing);
  const o = _clamp01(observed);
  const next = e + (1 - e) * (o * REINFORCE_RATE);
  return Math.min(CONFIDENCE_CEILING, Number(next.toFixed(4)));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Depo
 * ════════════════════════════════════════════════════════════════════════ */

export interface VehicleMemoryDeps {
  readonly now?: () => number;
  readonly storageKey?: string;
  readonly maxVehicles?: number;
  readonly maxFactsPerVehicle?: number;
}

/**
 * Araç hafızası deposu — fingerprint hash başına gerçekler, safeStorage kalıcı, bounded LRU.
 * En yeni-görülen araç başta; taşınca en eski-görülen araç düşer. Araç içi gerçek taşınca
 * en DÜŞÜK güvenli (eşitlikte en eski) gerçek düşer.
 */
export class VehicleMemoryStore {
  private readonly _now: () => number;
  private readonly _storageKey: string;
  private readonly _maxVehicles: number;
  private readonly _maxFacts: number;
  private _records: VehicleMemoryRecord[] = [];
  private _loaded = false;

  constructor(deps: VehicleMemoryDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._storageKey = deps.storageKey ?? VEHICLE_MEMORY_STORAGE_KEY;
    this._maxVehicles = deps.maxVehicles && deps.maxVehicles > 0 ? Math.floor(deps.maxVehicles) : MAX_MEMORY_VEHICLES;
    this._maxFacts = deps.maxFactsPerVehicle && deps.maxFactsPerVehicle > 0 ? Math.floor(deps.maxFactsPerVehicle) : MAX_FACTS_PER_VEHICLE;
  }

  private _ensureLoaded(): void {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = safeGetRaw(this._storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) this._records = (parsed as VehicleMemoryRecord[]).filter(
          (r) => r && typeof r.fingerprintHash === 'string' && Array.isArray(r.facts),
        );
      }
    } catch {
      this._records = [];   // bozuk disk → dürüstçe boş
    }
  }

  private _persist(): void {
    try { safeSetRaw(this._storageKey, JSON.stringify(this._records)); } catch { /* kota — fail-soft */ }
  }

  private _find(hash: string): VehicleMemoryRecord | null {
    return this._records.find((r) => r.fingerprintHash === hash) ?? null;
  }

  /**
   * Bir gerçeği öğrenir/pekiştirir. Var olan anahtar → pekiştirilir (observations++,
   * güven yukarı, lastSeen güncel); yeni → eklenir. Aracı LRU önüne taşır. Geçersiz
   * hash/anahtar/ifade → null (sahte hafıza yazılmaz). @returns saklanan gerçek.
   */
  remember(fingerprintHash: string, input: RememberInput): VehicleMemoryFact | null {
    this._ensureLoaded();
    const hash = _fingerprint(fingerprintHash);
    const key = _key(input?.key);
    const statement = _sanitize(input?.statement);
    if (!hash || !key || !statement) return null;

    const now = this._now();
    let rec = this._find(hash);
    if (!rec) {
      rec = { fingerprintHash: hash, facts: [], updatedAt: now };
      this._records.push(rec);
    }

    const existingIdx = rec.facts.findIndex((f) => f.key === key);
    let stored: VehicleMemoryFact;
    if (existingIdx >= 0) {
      const prev = rec.facts[existingIdx];
      stored = Object.freeze({
        key,
        statement,                                     // en güncel ifade kazanır
        confidence: reinforceConfidence(prev.confidence, input.confidence),
        observations: prev.observations + 1,
        firstSeen: prev.firstSeen,
        lastSeen: now,
        source: _sanitize(input.source, 48) || prev.source,
      });
      rec.facts.splice(existingIdx, 1);
    } else {
      stored = Object.freeze({
        key, statement,
        confidence: _clamp01(input.confidence),
        observations: 1, firstSeen: now, lastSeen: now,
        source: _sanitize(input.source, 48) || 'unknown',
      });
    }
    rec.facts.unshift(stored);              // en güncel gerçek başta
    if (rec.facts.length > this._maxFacts) this._evictWeakestFact(rec);
    rec.updatedAt = now;

    // Aracı LRU önüne taşı; taşınca en eski araç düşer.
    const ri = this._records.indexOf(rec);
    if (ri > 0) { this._records.splice(ri, 1); this._records.unshift(rec); }
    if (this._records.length > this._maxVehicles) this._records.length = this._maxVehicles;

    this._persist();
    return stored;
  }

  /** Araç içi en DÜŞÜK güvenli (eşitlikte en eski lastSeen) gerçeği düşürür. */
  private _evictWeakestFact(rec: VehicleMemoryRecord): void {
    let victim = -1, minConf = Number.POSITIVE_INFINITY, oldest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < rec.facts.length; i++) {
      const f = rec.facts[i];
      if (f.confidence < minConf || (f.confidence === minConf && f.lastSeen < oldest)) {
        minConf = f.confidence; oldest = f.lastSeen; victim = i;
      }
    }
    if (victim >= 0) rec.facts.splice(victim, 1);
  }

  /** Bu aracın öğrenilmiş gerçekleri (güvene göre azalan kopya) veya boş. */
  recall(fingerprintHash: string): VehicleMemoryFact[] {
    this._ensureLoaded();
    const hash = _fingerprint(fingerprintHash);
    if (!hash) return [];
    const rec = this._find(hash);
    if (!rec) return [];
    return rec.facts.slice().sort((a, b) => (b.confidence - a.confidence) || (b.lastSeen - a.lastSeen));
  }

  recallFact(fingerprintHash: string, key: string): VehicleMemoryFact | null {
    this._ensureLoaded();
    const hash = _fingerprint(fingerprintHash);
    const k = _key(key);
    if (!hash || !k) return null;
    return this._find(hash)?.facts.find((f) => f.key === k) ?? null;
  }

  forget(fingerprintHash: string, key: string): boolean {
    this._ensureLoaded();
    const hash = _fingerprint(fingerprintHash);
    const k = _key(key);
    if (!hash || !k) return false;
    const rec = this._find(hash);
    if (!rec) return false;
    const idx = rec.facts.findIndex((f) => f.key === k);
    if (idx < 0) return false;
    rec.facts.splice(idx, 1);
    this._persist();
    return true;
  }

  forgetVehicle(fingerprintHash: string): boolean {
    this._ensureLoaded();
    const hash = _fingerprint(fingerprintHash);
    if (!hash) return false;
    const idx = this._records.findIndex((r) => r.fingerprintHash === hash);
    if (idx < 0) return false;
    this._records.splice(idx, 1);
    this._persist();
    return true;
  }

  clear(): void {
    this._records = [];
    this._loaded = true;
    try { safeRemoveRaw(this._storageKey); } catch { /* yoksay */ }
  }

  get vehicleCount(): number {
    this._ensureLoaded();
    return this._records.length;
  }
}

/** Uygulama geneli tekil depo (foundation). Testler kendi örneğini kurar. */
export function createVehicleMemoryStore(deps: VehicleMemoryDeps = {}): VehicleMemoryStore {
  return new VehicleMemoryStore(deps);
}
