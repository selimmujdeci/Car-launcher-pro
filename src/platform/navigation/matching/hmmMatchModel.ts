/**
 * hmmMatchModel.ts — NAV v3 · L2 · HMM / VITERBI YOL EŞLEŞTİRME ÇEKİRDEĞİ
 * (SAF · F2).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F2.3 · v2 §3.4 · Newson & Krumm (2009).
 *
 * SAF: I/O YOK · timer YOK · React YOK · native YOK · saat OKUMAZ ·
 * global durum YOK · **ham graf/karo/MapLibre erişimi YOK**. Adaylar
 * DIŞARIDAN (L1 sınırı üzerinden) verilir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── MEVCUT `mapMatchModel` İLE İLİŞKİSİ (ikinci otorite DEĞİL) ────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `navigation/core/mapMatchModel.ts` **AKTİF ROTAYA** oturtur (rota-göreli) ve
 * L4/L5 ilerleme zincirinin sahibidir; DEĞİŞTİRİLMEDİ.
 * Bu dosya **YOL AĞINA** oturtur (ağ-göreli) ve farklı bir soruyu yanıtlar:
 * *"hangi KENARDAYIM?"* — rota olmasa bile. İkisi aynı gerçeği yazmaz;
 * tek yayıncı `egoAuthority`dir (kilit test).
 *
 * ── ADAY KAYNAĞI YALNIZ L1 ───────────────────────────────────────────────
 * `RoadCandidate` üretimi bu dosyanın işi DEĞİLDİR. Adaylar `MapStore` /
 * kanonik `EdgeId` / `StaticEdgeMetadata` sınırından gelir
 * (`roadCandidateSource.ts`). Bu çekirdek bir koordinatı bile kendisi
 * aramaz — böylece L2'nin raw graph binary'ye, tile store'a veya routing
 * worker internals'ına sızması YAPISAL OLARAK imkânsızdır.
 *
 * ── ZORLA SNAP YASAK ─────────────────────────────────────────────────────
 * Aday yoksa, adaylar ayrılamıyorsa veya topoloji/metadata kanıtı yetersizse
 * sonuç `NO_CANDIDATES` / `AMBIGUOUS` / `INSUFFICIENT_METADATA`'dır ve
 * `candidate` **null** döner. "En yakın yola oturt" bir kurtarma değil, bir
 * yalandır (bölünmüş bulvarda karşı şeride kilitlenmenin kaynağı).
 */

import type { EdgeId } from '../contracts/navEdgeId';
import { edgeIdEquals } from '../contracts/navEdgeId';
import type { MonotonicMs } from '../contracts/navMonotonicTime';
import type { StaticEdgeMetadata } from '../map/store/mapStore';
import { angularDeltaDeg, hav } from '../core/geo';

/* ══════════════════════════════════════════════════════════════════════════
   1) ADAY
   ══════════════════════════════════════════════════════════════════════════ */

export interface RoadCandidate {
  readonly edgeId: EdgeId;
  /** Gözlemin kenar üzerine dik izdüşümü. */
  readonly snappedLat: number;
  readonly snappedLon: number;
  /** Gözlemden kenara dik mesafe (m). */
  readonly perpDistM: number;
  /** Kenarın o noktadaki yönü (derece, 0 = Kuzey). `null` = bilinmiyor. */
  readonly bearingDeg: number | null;
  /** Kenar başından yol-boyu mesafe (m). */
  readonly alongEdgeM: number;
  /** L1'den gelen statik kenar bilgisi. `null` = metadata YOK. */
  readonly metadata: StaticEdgeMetadata | null;
}

/** Bir gözlem anı — EKF'in yayınladığı konum, HMM'in girdisi. */
export interface HmmObservation {
  readonly lat: number;
  readonly lon: number;
  /** Gidiş yönü (derece). `null` = bilinmiyor (durakta güvenilmez). */
  readonly headingDeg: number | null;
  readonly tsMonoMs: MonotonicMs;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) PARAMETRELER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ **KALİBRE EDİLMEMİŞTİR (v2 §3.4 ile aynı uyarı).** `sigmaZ` ve `beta`
 * literatür başlangıç değerleridir; **kendi saha kayıtlarımızdan medyan-tabanlı
 * dayanıklı kestiricilerle yeniden hesaplanana kadar üretim değeri SAYILMAZ**
 * (`DEVICE_VALIDATION_LEDGER` maddesi).
 */
export interface HmmParams {
  /** Emisyon gürültüsü (m) — v2: `σ_z ≈ 4–6 m`. */
  readonly sigmaZ: number;
  /** Geçiş ölçek parametresi (m) — v2: `β = medyan(d_t)/ln 2`. */
  readonly beta: number;
  /** Yön uyumsuzluğu cezası için standart sapma (derece). */
  readonly sigmaHeadingDeg: number;
  /** Viterbi penceresi (örnek). */
  readonly windowW: number;
  /** Yayın gecikmesi (örnek) — geriye düzeltme buradan sonra UYGULANMAZ. */
  readonly publishLagL: number;
  /**
   * En iyi ile ikinci aday arasındaki asgari log-olasılık farkı. Altındaysa
   * `AMBIGUOUS` — belirsizlikten kesin eşleşme ÜRETİLMEZ.
   */
  readonly minSeparationLogProb: number;
}

export const DEFAULT_HMM_PARAMS: HmmParams = {
  sigmaZ: 5,
  beta: 10,
  sigmaHeadingDeg: 45,
  windowW: 10,
  publishLagL: 2,
  minSeparationLogProb: 0.7,
};

/** Aday üretiminde azami aday sayısı (v2 §3.4: en fazla 8). */
export const HMM_MAX_CANDIDATES = 8;

/* ══════════════════════════════════════════════════════════════════════════
   3) TRELLIS
   ══════════════════════════════════════════════════════════════════════════ */

export interface HmmNode {
  readonly candidate: RoadCandidate;
  /** Yol boyu birikimli log-olasılık. */
  readonly logProb: number;
  /** Önceki katmandaki geri işaretçi; `-1` = başlangıç. */
  readonly backIdx: number;
}

export interface HmmLayer {
  readonly nodes: readonly HmmNode[];
  readonly obs: HmmObservation;
  /** Bu katmanda topoloji (ağ mesafesi) kanıtı KULLANILABİLDİ mi. */
  readonly topologyEvidence: boolean;
}

export interface HmmState {
  /** Sınırlı pencere — en fazla `windowW` katman (sınırsız kuyruk YASAK). */
  readonly layers: readonly HmmLayer[];
}

export const EMPTY_HMM_STATE: HmmState = { layers: [] };

/**
 * İki aday arasındaki AĞ mesafesi (m). `null` = topoloji bilinmiyor.
 *
 * Bu fonksiyonu HMM **sağlamaz** — L1 sınırından gelir. Bilinmiyorsa geçiş
 * terimi UYGULANMAZ (uydurma mesafe YASAK) ve katman
 * `topologyEvidence: false` ile işaretlenir.
 */
export type NetworkDistanceFn = (
  from: RoadCandidate,
  to: RoadCandidate,
) => number | null;

/* ══════════════════════════════════════════════════════════════════════════
   4) EMİSYON / GEÇİŞ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Emisyon log-olasılığı: `log p(z|c) = −½ (d⊥/σ_z)²` + yön cezası.
 *
 * Yön cezası YALNIZ hem gözlem yönü hem kenar yönü BİLİNİYORSA uygulanır —
 * bilinmeyen yön bir ceza değil, bir bilgisizliktir.
 */
export function emissionLogProb(
  c: RoadCandidate, obs: HmmObservation, p: HmmParams = DEFAULT_HMM_PARAMS,
): number {
  if (!c || !Number.isFinite(c.perpDistM) || c.perpDistM < 0) return -Infinity;
  if (!(p.sigmaZ > 0)) return -Infinity;

  const z = c.perpDistM / p.sigmaZ;
  let lp = -0.5 * z * z;

  if (obs && typeof obs.headingDeg === 'number' && Number.isFinite(obs.headingDeg)
      && typeof c.bearingDeg === 'number' && Number.isFinite(c.bearingDeg)
      && p.sigmaHeadingDeg > 0) {
    const d = angularDeltaDeg(obs.headingDeg, c.bearingDeg);
    const h = d / p.sigmaHeadingDeg;
    lp += -0.5 * h * h;
  }
  return lp;
}

/**
 * Geçiş log-olasılığı: `d_t = |büyükdaire(z_{t−1}, z_t) − ağMesafesi(c_i, c_j)|`,
 * `log p = −d_t / β`.
 *
 * Ağ mesafesi bilinmiyorsa `null` döner → çağıran geçiş terimini UYGULAMAZ
 * (uniform kabul eder) ve topoloji kanıtı YOK olarak işaretlenir.
 */
export function transitionLogProb(
  from: RoadCandidate, to: RoadCandidate,
  prevObs: HmmObservation, obs: HmmObservation,
  networkDistance: NetworkDistanceFn,
  p: HmmParams = DEFAULT_HMM_PARAMS,
): number | null {
  if (!from || !to || !prevObs || !obs || !(p.beta > 0)) return null;
  let net: number | null;
  try {
    net = networkDistance(from, to);
  } catch {
    return null;
  }
  if (typeof net !== 'number' || !Number.isFinite(net) || net < 0) return null;

  const gc = hav(prevObs.lat, prevObs.lon, obs.lat, obs.lon);
  if (!Number.isFinite(gc)) return null;
  return -Math.abs(gc - net) / p.beta;
}

/* ══════════════════════════════════════════════════════════════════════════
   5) VITERBI ADIMI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir gözlem adımını trellis'e ekler. **SAF** — yeni durum döner.
 *
 * Aday listesi boşsa katman EKLENMEZ ve durum aynen döner (boş katman bir
 * "eşleşmedi" kaydı değildir; karar `decodeHmm`in işidir).
 */
export function stepHmm(
  state: HmmState,
  obs: HmmObservation,
  candidates: readonly RoadCandidate[],
  networkDistance: NetworkDistanceFn,
  p: HmmParams = DEFAULT_HMM_PARAMS,
): HmmState {
  if (!state || !obs || !Array.isArray(candidates) || candidates.length === 0) {
    return state ?? EMPTY_HMM_STATE;
  }
  const cands = candidates.slice(0, HMM_MAX_CANDIDATES);
  const prev = state.layers.length > 0 ? state.layers[state.layers.length - 1] : null;

  const nodes: HmmNode[] = [];
  let topologyEvidence = false;

  for (const c of cands) {
    const em = emissionLogProb(c, obs, p);
    if (!Number.isFinite(em)) continue;

    if (prev === null || prev.nodes.length === 0) {
      nodes.push({ candidate: c, logProb: em, backIdx: -1 });
      continue;
    }

    let bestLp = -Infinity;
    let bestIdx = -1;
    for (let i = 0; i < prev.nodes.length; i++) {
      const pn = prev.nodes[i];
      if (!Number.isFinite(pn.logProb)) continue;
      const tr = transitionLogProb(pn.candidate, c, prev.obs, obs, networkDistance, p);
      if (tr !== null) topologyEvidence = true;
      const lp = pn.logProb + (tr ?? 0);
      if (lp > bestLp) { bestLp = lp; bestIdx = i; }
    }
    if (bestIdx < 0) continue;
    nodes.push({ candidate: c, logProb: bestLp + em, backIdx: bestIdx });
  }

  if (nodes.length === 0) return state;

  const layer: HmmLayer = { nodes, obs, topologyEvidence };
  const w = p.windowW > 0 ? p.windowW : DEFAULT_HMM_PARAMS.windowW;
  const layers = [...state.layers, layer];
  return { layers: layers.length > w ? layers.slice(layers.length - w) : layers };
}

/* ══════════════════════════════════════════════════════════════════════════
   6) ÇÖZÜMLEME (decode)
   ══════════════════════════════════════════════════════════════════════════ */

export type HmmMatchOutcome =
  /** Güvenli eşleşme — kenar kimliği YAYINLANABİLİR. */
  | 'MATCHED'
  /** Adaylar ayrılamadı — kesin eşleşme ÜRETİLMEZ. */
  | 'AMBIGUOUS'
  /** Hiç aday yok (kapsam dışı / kaynak yok). */
  | 'NO_CANDIDATES'
  /** Adaylar var ama metadata/topoloji kanıtı yetersiz. */
  | 'INSUFFICIENT_METADATA';

export type HmmReason =
  | 'DECODED'
  | 'NO_LAYERS'
  | 'LOW_SEPARATION'
  | 'NO_TOPOLOGY_EVIDENCE'
  | 'NO_EDGE_METADATA'
  | 'WARMING_UP';

export interface HmmDecision {
  readonly outcome: HmmMatchOutcome;
  /** **YALNIZ `MATCHED` iken doludur** — zorla snap yapısal olarak imkânsız. */
  readonly candidate: RoadCandidate | null;
  /** [0,1] — ayrışma marjından türetilir; `MATCHED` dışında 0. */
  readonly confidence: number;
  readonly reason: HmmReason;
  /** Ağ mesafesi kanıtı kullanılabildi mi. */
  readonly topologyEvidence: boolean;
  /** En iyi ile ikinci arasındaki log-olasılık farkı; ölçülemezse `null`. */
  readonly separation: number | null;
}

const _NO_MATCH = (outcome: HmmMatchOutcome, reason: HmmReason, topo = false): HmmDecision => ({
  outcome, candidate: null, confidence: 0, reason, topologyEvidence: topo, separation: null,
});

/**
 * Trellis'ten yayınlanacak kararı çıkarır.
 *
 * **Yayın gecikmesi (`publishLagL`):** karar, penceredeki EN SON katmandan
 * değil `L` örnek GERİDEN yayınlanır; böylece geriye dönük Viterbi düzeltmesi
 * iç inanca uygulanır, YAYINLANMIŞ akış değişmez (v2 P8).
 * Pencerede henüz `L+1` katman yoksa `WARMING_UP` döner — erken kesinlik yok.
 */
export function decodeHmm(
  state: HmmState, p: HmmParams = DEFAULT_HMM_PARAMS,
): HmmDecision {
  if (!state || !Array.isArray(state.layers) || state.layers.length === 0) {
    return _NO_MATCH('NO_CANDIDATES', 'NO_LAYERS');
  }
  const lag = p.publishLagL >= 0 ? p.publishLagL : 0;
  const lastIdx = state.layers.length - 1;
  const publishIdx = lastIdx - lag;
  if (publishIdx < 0) {
    return _NO_MATCH('INSUFFICIENT_METADATA', 'WARMING_UP',
      state.layers[lastIdx]?.topologyEvidence === true);
  }

  const last = state.layers[lastIdx];
  if (last.nodes.length === 0) return _NO_MATCH('NO_CANDIDATES', 'NO_LAYERS');

  /* En iyi ve ikinci en iyi uç düğüm. */
  let b1 = -Infinity, b2 = -Infinity, bi = -1;
  for (let i = 0; i < last.nodes.length; i++) {
    const lp = last.nodes[i].logProb;
    if (!Number.isFinite(lp)) continue;
    if (lp > b1) { b2 = b1; b1 = lp; bi = i; }
    else if (lp > b2) { b2 = lp; }
  }
  if (bi < 0) return _NO_MATCH('NO_CANDIDATES', 'NO_LAYERS');

  const topo = state.layers.some((l) => l.topologyEvidence === true);
  const separation = Number.isFinite(b2) ? b1 - b2 : null;

  /* Tek aday varsa ayrışma ÖLÇÜLEMEZ — bu bir kesinlik değil, bir bilgisizliktir;
     ama tek aday da meşru bir eşleşmedir. Ayrışma yalnız ≥2 adayda kapı olur. */
  if (separation !== null && separation < p.minSeparationLogProb) {
    return {
      outcome: 'AMBIGUOUS', candidate: null, confidence: 0,
      reason: 'LOW_SEPARATION', topologyEvidence: topo, separation,
    };
  }

  /* Geri izleme — yayın katmanına kadar. */
  let idx = bi;
  for (let l = lastIdx; l > publishIdx; l--) {
    const node = state.layers[l].nodes[idx];
    if (!node || node.backIdx < 0) return _NO_MATCH('INSUFFICIENT_METADATA', 'WARMING_UP', topo);
    idx = node.backIdx;
  }
  const chosen = state.layers[publishIdx].nodes[idx];
  if (!chosen) return _NO_MATCH('NO_CANDIDATES', 'NO_LAYERS');

  /* METADATA KAPISI: kenar kimliği yayınlamak, o kenar hakkında BİR ŞEY
     bildiğimizi iddia etmektir. Ne statik metadata ne topoloji kanıtı varsa
     bu iddia dayanaksızdır → kesin eşleşme ÜRETİLMEZ. */
  if (chosen.candidate.metadata === null && !topo) {
    return {
      outcome: 'INSUFFICIENT_METADATA', candidate: null, confidence: 0,
      reason: chosen.candidate.metadata === null ? 'NO_EDGE_METADATA' : 'NO_TOPOLOGY_EVIDENCE',
      topologyEvidence: topo, separation,
    };
  }

  /* Güven ayrışma marjından — "aday var → güven 1" YASAK. */
  const conf = separation === null
    ? 0.5
    : Math.max(0, Math.min(1, 1 - Math.exp(-separation)));

  return {
    outcome: 'MATCHED',
    candidate: chosen.candidate,
    confidence: conf,
    reason: 'DECODED',
    topologyEvidence: topo,
    separation,
  };
}

/** Aynı kenara mı eşleşti (süreklilik teşhisi). */
export function isSameEdge(a: RoadCandidate | null, b: RoadCandidate | null): boolean {
  if (!a || !b) return false;
  return edgeIdEquals(a.edgeId, b.edgeId);
}
