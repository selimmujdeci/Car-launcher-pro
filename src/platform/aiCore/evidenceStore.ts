/**
 * aiCore/evidenceStore.ts — AI Core KANIT DEPOSU (bounded · read-only · dedup).
 *
 * AMAÇ: Akıl-yürütmenin ham malzemesini (kanıt) tek yerde, sınırlı ve tazelik-duyarlı
 * biriktirir. Ajanlar buradan OKUR; asla ham telemetriye dokunmaz (VİZYON invaryantı:
 * "UI/tüketici ham veri okumaz"). Depo VERİ ÜRETMEZ — mevcut kaynakları (SignalEnvelope,
 * DTC, diagnostics hipotezleri, capability) KANIT satırına çevirir (ikinci otorite değil).
 *
 * NEDEN AYRI DEPO: bir ajanın kararı "hangi kanıta dayandı" izlenebilir olmalı (explainable).
 * Depo, kanıtı anahtara göre TEKİLLEŞTİRİR (aynı sinyal iki kez → en TAZE olan kalır) ve
 * bounded tutar (bellek + gürültü sınırı). Böylece "kanıt yoksa tahmin yok" invaryantı
 * ölçülebilir olur: depo boşsa ajan susar.
 *
 * ZERO-TRUST / PII: her `summary` sanitize edilir (VIN/MAC/koordinat/ham hex → redacted),
 * kırpılır. SAF/DI: zaman enjekte edilir, I/O yok, import yan etkisizdir.
 */

import type { AiEvidenceItem, AiEvidenceKind } from './types';
import type { SignalEnvelope } from '../obd/signalEnvelope';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler + saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_MAX_EVIDENCE = 128;
const MAX_SUMMARY_CHARS = 96;

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const COORD_RE = /-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g;
const RAW_HEX_RE = /\b[0-9A-Fa-f]{8,}\b/g;
const SECRET_RE = /\b(?:sk|pk|api|key|token|bearer)[-_]?[A-Za-z0-9_-]{12,}\b/gi;

/** PII-temizli, kırpılmış özet metni. */
function _sanitize(input: unknown): string {
  if (typeof input !== 'string') return '';
  const cleaned = input
    .replace(SECRET_RE, '[redacted]')
    .replace(MAC_RE, '[redacted]')
    .replace(VIN_RE, '[redacted]')
    .replace(COORD_RE, '[redacted]')
    .replace(RAW_HEX_RE, '[redacted]')
    .trim();
  return cleaned.length > MAX_SUMMARY_CHARS ? cleaned.slice(0, MAX_SUMMARY_CHARS) : cleaned;
}

function _clamp01(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const VALID_KINDS: ReadonlySet<string> = new Set<AiEvidenceKind>([
  'signal', 'dtc', 'diagnostic', 'capability', 'memory', 'fingerprint', 'derived',
]);

/**
 * Ham girdiyi normalize + sanitize edip TAM-şekilli kanıt satırına çevirir. Geçersiz
 * (anahtar yok / tür yok / özet boş) → null (fail-soft, sahte kanıt üretilmez).
 */
export function makeEvidence(input: {
  key: string; kind: AiEvidenceKind; summary: string;
  confidence: number; observedAt: number; source: string;
}): AiEvidenceItem | null {
  if (!input || typeof input.key !== 'string' || !input.key || !VALID_KINDS.has(input.kind)) return null;
  const summary = _sanitize(input.summary);
  if (!summary) return null;
  return Object.freeze({
    key: input.key,
    kind: input.kind,
    summary,
    confidence: _clamp01(input.confidence),
    observedAt: typeof input.observedAt === 'number' && Number.isFinite(input.observedAt) ? input.observedAt : 0,
    source: _sanitize(input.source) || 'unknown',
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kaynak adaptörleri (mevcut şekilleri → kanıt; SAF, decoupled)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * SignalEnvelope → kanıt. "0 ≠ no-data" ilkesine sadık: value null (no_data/unsupported)
 * ise KANIT DEĞİL → null döner (araç sinyali vermiyorsa uydurma yok). Değeri olan
 * valid/stale/suspect zarflar, ENVELOPE confidence'ıyla kanıta çevrilir.
 */
export function signalToEvidence(key: string, sig: SignalEnvelope | null | undefined, label?: string): AiEvidenceItem | null {
  if (!sig || sig.value === null || sig.state === 'no_data' || sig.state === 'unsupported') return null;
  const name = label ?? key;
  const summary = `${name}=${sig.value}${sig.unit || ''} (${sig.state}, güven ${(sig.confidence * 100).toFixed(0)}%)`;
  return makeEvidence({
    key: `signal.${key}`,
    kind: 'signal',
    summary,
    confidence: sig.confidence,
    observedAt: sig.updatedAt,
    source: sig.source,
  });
}

/** DTC → kanıt. Arıza kodu varlığı KANITTIR (severity=critical → yüksek güven). */
export function dtcToEvidence(code: string, severity: string | undefined, observedAt: number): AiEvidenceItem | null {
  if (typeof code !== 'string' || !code) return null;
  const sev = severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'info';
  return makeEvidence({
    key: `dtc.${code}`,
    kind: 'dtc',
    summary: `Arıza kodu ${code} (${sev})`,
    confidence: sev === 'critical' ? 0.95 : sev === 'warning' ? 0.8 : 0.6,
    observedAt,
    source: 'obd',
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Depo
 * ════════════════════════════════════════════════════════════════════════ */

export interface EvidenceQuery {
  readonly kind?: AiEvidenceKind;
  readonly minConfidence?: number;
  readonly source?: string;
  /** Anahtar bu önekle başlıyorsa (ör. 'signal.', 'dtc.'). */
  readonly keyPrefix?: string;
}

export interface EvidenceStoreDeps {
  readonly now?: () => number;
  readonly maxItems?: number;
}

/**
 * Bounded kanıt deposu. Anahtar-bazlı dedup (aynı anahtar → en TAZE gözlem kalır); taşınca
 * en ESKİ gözlemli kanıt düşer. Read-only tüketim: query/snapshot immutable kopya döner.
 */
export class EvidenceStore {
  private readonly _now: () => number;
  private readonly _max: number;
  private readonly _items = new Map<string, AiEvidenceItem>();
  private _ingested = 0;
  private _rejected = 0;

  constructor(deps: EvidenceStoreDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._max = typeof deps.maxItems === 'number' && deps.maxItems > 0 ? Math.floor(deps.maxItems) : DEFAULT_MAX_EVIDENCE;
  }

  /**
   * Kanıt ekler (dedup + bounded). Aynı anahtar varsa yalnız daha TAZE (veya eşit tazelikte
   * daha yüksek güvenli) olan kabul edilir → gürültüsüz güncelleme. @returns kabul edildi mi.
   */
  ingest(item: AiEvidenceItem | null): boolean {
    if (!item || typeof item.key !== 'string' || !item.key || !VALID_KINDS.has(item.kind)) { this._rejected++; return false; }
    const existing = this._items.get(item.key);
    if (existing) {
      const staleReplace = item.observedAt > existing.observedAt
        || (item.observedAt === existing.observedAt && item.confidence > existing.confidence);
      if (!staleReplace) { this._rejected++; return false; }
    }
    this._items.set(item.key, item);
    this._ingested++;
    if (this._items.size > this._max) this._evictOldest();
    return true;
  }

  ingestMany(items: readonly (AiEvidenceItem | null)[]): number {
    let n = 0;
    if (Array.isArray(items)) for (const it of items) if (this.ingest(it)) n++;
    return n;
  }

  /** En eski gözlemli kanıtı düşürür (bounded eviction). */
  private _evictOldest(): void {
    let victimKey: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [k, v] of this._items) {
      if (v.observedAt < oldest) { oldest = v.observedAt; victimKey = k; }
    }
    if (victimKey !== null) this._items.delete(victimKey);
  }

  getByKey(key: string): AiEvidenceItem | null {
    return this._items.get(key) ?? null;
  }

  /** Filtreli, GÜVENE göre azalan (eşitlikte tazeye göre) immutable kanıt listesi. */
  query(filter?: EvidenceQuery): AiEvidenceItem[] {
    const out: AiEvidenceItem[] = [];
    for (const v of this._items.values()) {
      if (filter) {
        if (filter.kind !== undefined && v.kind !== filter.kind) continue;
        if (filter.source !== undefined && v.source !== filter.source) continue;
        if (typeof filter.minConfidence === 'number' && v.confidence < filter.minConfidence) continue;
        if (filter.keyPrefix !== undefined && !v.key.startsWith(filter.keyPrefix)) continue;
      }
      out.push(v);
    }
    return out.sort((a, b) => (b.confidence - a.confidence) || (b.observedAt - a.observedAt));
  }

  /** Tüm kanıtın immutable görüntüsü (query() kısayolu). */
  snapshot(): AiEvidenceItem[] {
    return this.query();
  }

  /** Tazeliğini yitirmiş kanıtları temizler (observedAt bu yaştan eski → düşür). */
  pruneStale(maxAgeMs: number): number {
    if (typeof maxAgeMs !== 'number' || maxAgeMs <= 0) return 0;
    const cutoff = this._now() - maxAgeMs;
    let removed = 0;
    for (const [k, v] of [...this._items]) {
      if (v.observedAt > 0 && v.observedAt < cutoff) { this._items.delete(k); removed++; }
    }
    return removed;
  }

  clear(): void {
    this._items.clear();
  }

  get size(): number {
    return this._items.size;
  }

  get stats(): { size: number; ingested: number; rejected: number } {
    return { size: this._items.size, ingested: this._ingested, rejected: this._rejected };
  }
}

export function createEvidenceStore(deps: EvidenceStoreDeps = {}): EvidenceStore {
  return new EvidenceStore(deps);
}
