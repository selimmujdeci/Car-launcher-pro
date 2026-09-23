/**
 * semanticMatcher — bir DID'i referans sinyallerle ANLAMLANDIRMA (SAF).
 *
 * Yöntem (saha 2026-09-23'te elle doğrulanan yolun otomatiği):
 *  1. Her DID örneğini AYNI ZAMANA düşen referans değeriyle hizala
 *     (komşu iki referans örneği pencere içindeyse doğrusal ara değer).
 *  2. `referans ≈ k × ham + o` doğrusal uyumu (en küçük kareler) + korelasyon.
 *  3. Uyumu üretici ölçek kütüphanesine OTURT (k ±%3, o ± tolerans).
 *  4. Katı eşikler → oturum kanıtı; ≥2 oturum ya da birebir eşitlik → kanıtlı.
 *
 * DÜRÜSTLÜK: eşleşme yalnız "bu DID, standart X sinyaliyle aynı büyüklüğü
 * taşıyor" der. Referansı olmayan büyüklüğe ad VERİLMEZ. İki referans
 * birbirinden ayırt edilemiyorsa (motor ısınırken yağ ≈ soğutma suyu)
 * sonuç AMBIGUOUS'tur — tahminle seçilmez.
 *
 * SAF: I/O yok · timer yok · global durum yok.
 */
import {
  REFERENCE_DEFS, SCALE_FACTORS, SCALE_OFFSETS, type ReferenceDef, type ReferenceKey,
} from './referenceCatalog';
import type { DidSample } from './didClassifier';

export interface RefSample {
  readonly t: number;
  readonly value: number;
}

export type MatchStatus = 'NONE' | 'CANDIDATE' | 'SESSION_PROVEN' | 'AMBIGUOUS';

export interface MatchResult {
  readonly ref: ReferenceKey;
  readonly signed: boolean;
  /** Oturan (kütüphane) katsayılar — oturmadıysa serbest uyum. */
  readonly k: number;
  readonly o: number;
  readonly snapped: boolean;
  /** |korelasyon| — ham ile referans arasında. */
  readonly r: number;
  readonly n: number;
  /** Oturan katsayılarla kök-ortalama-kare hata (referans biriminde). */
  readonly rms: number;
  /** Oturum içinde referansın gördüğü aralık. */
  readonly refSpan: number;
  /** Tüm çiftlerde birebir eşitlik (k=1,o=0) — en güçlü kanıt. */
  readonly exactEquality: boolean;
  readonly status: MatchStatus;
  /** AMBIGUOUS ise ayırt edilemeyen diğer referans. */
  readonly ambiguousWith?: ReferenceKey;
}

export const MATCH_THRESHOLDS = Object.freeze({
  minPairsCandidate: 20,
  minPairsProven: 40,
  rCandidate: 0.95,
  rProven: 0.99,
  scaleRelTol: 0.03,
  /** Kanıt için referansın en az kaç FARKLI değer görmesi gerektiği. */
  minDistinctRef: 5,
  /** İki referansın ayırt edilemez sayılacağı karşılıklı korelasyon. */
  refIndistinguishableR: 0.98,
});

/* ── Zaman hizalama ─────────────────────────────────────────────────────── */

/** `ref` zaman sıralı olmalı. Pencere içinde değer yoksa `null` (uydurma yok). */
export function referenceAt(ref: readonly RefSample[], t: number, maxAgeMs: number): number | null {
  if (ref.length === 0) return null;
  let lo = 0;
  let hi = ref.length - 1;
  if (t <= ref[0]!.t) return ref[0]!.t - t <= maxAgeMs ? ref[0]!.value : null;
  if (t >= ref[hi]!.t) return t - ref[hi]!.t <= maxAgeMs ? ref[hi]!.value : null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ref[mid]!.t <= t) lo = mid; else hi = mid;
  }
  const a = ref[lo]!;
  const b = ref[hi]!;
  const da = t - a.t;
  const db = b.t - t;
  if (da <= maxAgeMs && db <= maxAgeMs) {
    const w = (t - a.t) / (b.t - a.t || 1);
    return a.value + (b.value - a.value) * w;
  }
  if (da <= maxAgeMs) return a.value;
  if (db <= maxAgeMs) return b.value;
  return null;
}

export function alignPairs(
  did: readonly DidSample[], ref: readonly RefSample[], maxAgeMs: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const s of did) {
    if (!Number.isFinite(s.raw)) continue;
    const v = referenceAt(ref, s.t, maxAgeMs);
    if (v !== null && Number.isFinite(v)) out.push([s.raw, v]);
  }
  return out;
}

/* ── İstatistik ─────────────────────────────────────────────────────────── */

export function linearFit(pairs: ReadonlyArray<readonly [number, number]>): { k: number; o: number; r: number } | null {
  const n = pairs.length;
  if (n < 3) return null;
  let mx = 0; let my = 0;
  for (const [x, y] of pairs) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (const [x, y] of pairs) { const dx = x - mx; const dy = y - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  const k = sxy / sxx;
  return { k, o: my - k * mx, r: sxy / Math.sqrt(sxx * syy) };
}

function rmsWith(pairs: ReadonlyArray<readonly [number, number]>, k: number, o: number): number {
  let s = 0;
  for (const [x, y] of pairs) { const e = k * x + o - y; s += e * e; }
  return Math.sqrt(s / pairs.length);
}

/** Serbest uyumu kütüphaneye oturtur; en düşük hatalı oturan çift ya da `null`. */
export function snapScale(
  pairs: ReadonlyArray<readonly [number, number]>, fitK: number, fitO: number, def: ReferenceDef,
): { k: number; o: number; rms: number } | null {
  let best: { k: number; o: number; rms: number } | null = null;
  for (const k0 of SCALE_FACTORS) {
    if (Math.abs(fitK - k0) > Math.abs(k0) * MATCH_THRESHOLDS.scaleRelTol) continue;
    for (const o0 of SCALE_OFFSETS) {
      if (Math.abs(fitO - o0) > Math.max(def.absTol * 2, Math.abs(o0) * 0.01)) continue;
      const rms = rmsWith(pairs, k0, o0);
      if (!best || rms < best.rms) best = { k: k0, o: o0, rms };
    }
  }
  return best;
}

const toSigned = (raw: number, bytes: number): number => {
  const bits = bytes * 8;
  if (bits <= 0 || bits > 32) return raw;
  const lim = 2 ** (bits - 1);
  return raw >= lim ? raw - 2 ** bits : raw;
};

/** Tek DID × tek referans. */
export function matchAgainst(
  did: readonly DidSample[], byteLength: number, ref: readonly RefSample[], key: ReferenceKey,
): MatchResult | null {
  const d = REFERENCE_DEFS[key];
  const basePairs = alignPairs(did, ref, d.maxAgeMs);
  if (basePairs.length < MATCH_THRESHOLDS.minPairsCandidate) return null;
  const refVals = basePairs.map((p) => p[1]);
  const refSpan = Math.max(...refVals) - Math.min(...refVals);
  const distinctRef = new Set(refVals.map((v) => Math.round(v / (d.absTol || 1)))).size;

  let best: MatchResult | null = null;
  for (const signed of byteLength >= 2 ? [false, true] : [false]) {
    const pairs = signed ? basePairs.map(([x, y]) => [toSigned(x, byteLength), y] as [number, number]) : basePairs;
    /* Birebir eşitlik: referans tamsayı birimde (km, s) ve ara değer kesir üretebilir →
       ±0,5 içinde eşitlik (yuvarlanmış eşitlik). En az 3 farklı ham değer şart. */
    const exactEquality = !signed && pairs.every(([x, y]) => Math.abs(x - y) <= 0.5)
      && new Set(pairs.map((p) => p[0])).size >= 3;
    const fit = linearFit(pairs);
    if (!fit) {
      continue;
    }
    const snap = snapScale(pairs, fit.k, fit.o, d);
    const r = Math.abs(fit.r);
    const informative = refSpan >= d.minSpan && distinctRef >= MATCH_THRESHOLDS.minDistinctRef;
    let status: MatchStatus = 'NONE';
    if (exactEquality && informative && pairs.length >= MATCH_THRESHOLDS.minPairsCandidate) status = 'SESSION_PROVEN';
    else if (snap && informative && r >= MATCH_THRESHOLDS.rProven
      && pairs.length >= MATCH_THRESHOLDS.minPairsProven && snap.rms <= d.absTol) status = 'SESSION_PROVEN';
    else if (r >= MATCH_THRESHOLDS.rCandidate) status = 'CANDIDATE';
    const res: MatchResult = {
      ref: key, signed,
      k: exactEquality ? 1 : snap?.k ?? fit.k,
      o: exactEquality ? 0 : snap?.o ?? fit.o,
      snapped: exactEquality || snap !== null,
      r, n: pairs.length,
      rms: exactEquality ? 0 : snap?.rms ?? rmsWith(pairs, fit.k, fit.o),
      refSpan, exactEquality, status,
    };
    if (!best || rank(res) > rank(best)) best = res;
  }
  return best;
}

const STATUS_RANK: Record<MatchStatus, number> = { NONE: 0, CANDIDATE: 1, AMBIGUOUS: 1.5, SESSION_PROVEN: 2 };
const rank = (m: MatchResult): number => STATUS_RANK[m.status] * 10 + m.r;

/** İki referans serisi bu oturumda ayırt edilebilir mi (ortak zamanlarda korelasyon). */
export function referencesIndistinguishable(a: readonly RefSample[], b: readonly RefSample[], maxAgeMs: number): boolean {
  const pairs: Array<[number, number]> = [];
  for (const s of a) {
    const v = referenceAt(b, s.t, maxAgeMs);
    if (v !== null) pairs.push([s.value, v]);
  }
  const fit = linearFit(pairs);
  return fit !== null && Math.abs(fit.r) >= MATCH_THRESHOLDS.refIndistinguishableR;
}

/**
 * Tek DID × TÜM referanslar → en iyi eşleşme. En iyi iki aday da güçlü ve
 * referanslar bu oturumda ayırt edilemiyorsa AMBIGUOUS.
 */
export function matchDid(
  did: readonly DidSample[], byteLength: number, refs: ReadonlyMap<ReferenceKey, readonly RefSample[]>,
): MatchResult | null {
  const results: MatchResult[] = [];
  for (const [key, series] of refs) {
    const m = matchAgainst(did, byteLength, series, key);
    if (m) results.push(m);
  }
  if (results.length === 0) return null;
  results.sort((x, y) => rank(y) - rank(x));
  const top = results[0]!;
  const second = results[1];
  if (top.status === 'SESSION_PROVEN' && second && second.status !== 'NONE' && second.r >= top.r - 0.01) {
    const a = refs.get(top.ref) ?? [];
    const b = refs.get(second.ref) ?? [];
    const age = Math.max(REFERENCE_DEFS[top.ref].maxAgeMs, REFERENCE_DEFS[second.ref].maxAgeMs);
    if (referencesIndistinguishable(a, b, age)) {
      return { ...top, status: 'AMBIGUOUS', ambiguousWith: second.ref };
    }
  }
  return top;
}
