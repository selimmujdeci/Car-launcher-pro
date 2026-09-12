/**
 * RTG4 ALT — LANDMARK ALT SINIRI.
 *
 * Kilitlenen davranışlar:
 *   · ALT bir SINIRDIR, rota otoritesi DEĞİLDİR,
 *   · sınır hiçbir grafta gerçek en kısa yolu AŞMAZ (kabul edilebilirlik),
 *   · kova yuvarlaması DAİMA sınırın aleyhine yazılır,
 *   · bilinmeyen mesafe sınıra katılmaz (uydurma yok),
 *   · eksik/bozuk kanıt sıfır katkı verir (fail-soft, rota uydurulmaz),
 *   · ALT ara pencerede doğrudan sezgisel DEĞİLDİR (ölçülmüş karar),
 *   · bölge içi (tek pencere) rota ALT'siz eski davranışta kalır.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { altLowerBoundM, ALT_SLICE_STRIDE_PER_LANDMARK } from
  '../platform/navigation/map/graph/altLowerBound';

const WORKER = resolve(__dirname, '../platform/navigation/NavigationCompute.worker.ts');
const BUILDER = resolve(__dirname, '../../scripts/build-rtg4-alt.ts');
const UNREACHABLE = 0xffff;

/* ── Referans graf: yönlü, deterministik, gerçek Dijkstra ile çözülür ────── */

interface TinyGraph { n: number; out: number[][][]; }

/** Deterministik sözde rastgelelik — tohum aynıysa graf de aynıdır. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x1_0000_0000; };
}

function buildTinyGraph(seed: number, n: number): TinyGraph {
  const random = lcg(seed);
  const out: number[][][] = Array.from({ length: n }, () => []);
  /* Halka: her düğüm en az bir çıkışa sahip olsun (kopuk graf testi ayrı). */
  for (let i = 0; i < n; i++) {
    out[i].push([(i + 1) % n, 100 + Math.floor(random() * 900)]);
  }
  for (let k = 0; k < n * 2; k++) {
    const a = Math.floor(random() * n), b = Math.floor(random() * n);
    if (a === b) continue;
    out[a].push([b, 100 + Math.floor(random() * 4000)]);
  }
  return { n, out };
}

function dijkstra(graph: TinyGraph, source: number): number[] {
  const dist = new Array<number>(graph.n).fill(Infinity);
  dist[source] = 0;
  const seen = new Array<boolean>(graph.n).fill(false);
  for (;;) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < graph.n; i++) if (!seen[i] && dist[i] < bestD) { bestD = dist[i]; best = i; }
    if (best < 0) break;
    seen[best] = true;
    for (const [to, cost] of graph.out[best]) {
      if (dist[best] + cost < dist[to]) dist[to] = dist[best] + cost;
    }
  }
  return dist;
}

function reverse(graph: TinyGraph): TinyGraph {
  const out: number[][][] = Array.from({ length: graph.n }, () => []);
  for (let from = 0; from < graph.n; from++) {
    for (const [to, cost] of graph.out[from]) out[to].push([from, cost]);
  }
  return { n: graph.n, out };
}

/** Ön işlemeyi taklit eder: kovalara AŞAĞI yuvarlanmış landmark mesafeleri. */
function preprocess(graph: TinyGraph, landmarks: number[], scaleM: number) {
  const rev = reverse(graph);
  const fromL = landmarks.map((l) => dijkstra(graph, l));      // d(L→v)
  const toL = landmarks.map((l) => dijkstra(rev, l));          // d(v→L)
  const bucket = (value: number) =>
    Number.isFinite(value) ? Math.floor(value / scaleM) : UNREACHABLE;
  const k = landmarks.length;
  const window = new Uint16Array(graph.n * k * ALT_SLICE_STRIDE_PER_LANDMARK);
  for (let v = 0; v < graph.n; v++) {
    for (let i = 0; i < k; i++) {
      window[(v * k + i) * 2] = bucket(fromL[i][v]);
      window[(v * k + i) * 2 + 1] = bucket(toL[i][v]);
    }
  }
  const targetRow = (t: number) => ({
    fromLandmark: Uint16Array.from(landmarks.map((_l, i) => bucket(fromL[i][t]))),
    toLandmark: Uint16Array.from(landmarks.map((_l, i) => bucket(toL[i][t]))),
  });
  return { window, targetRow, k };
}

describe('RTG4 ALT landmark alt sınırı', () => {
  /* ── Kabul edilebilirlik: sınır GERÇEK mesafeyi asla aşamaz ─────────────
     Bu, ALT'nin tek pazarlıksız sözleşmesidir: aşarsa A* yanlış rota
     döndürebilir. Rastgele ama DETERMİNİSTİK graflarda tüm (v, t) çiftleri
     taranır. */
  it('🔒 hiçbir graf/çiftte gerçek en kısa yolu AŞMAZ', () => {
    const scaleM = 250;
    let checked = 0, nonZero = 0;
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const graph = buildTinyGraph(seed, 24);
      const landmarks = [0, 6, 12, 18];
      const { window, targetRow, k } = preprocess(graph, landmarks, scaleM);
      for (let t = 0; t < graph.n; t += 5) {
        const trueDist = dijkstra(graph, 0);                   // yalnız erişilebilirlik için
        expect(trueDist.length).toBe(graph.n);
        const target = targetRow(t);
        for (let v = 0; v < graph.n; v++) {
          const real = dijkstra(graph, v)[t];
          const bound = altLowerBoundM(window, v, k, scaleM, UNREACHABLE, target);
          checked++;
          if (bound > 0) nonZero++;
          if (Number.isFinite(real)) expect(bound).toBeLessThanOrEqual(real);
          else expect(bound).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    /* Sınır işe de yaramalı: hep 0 dönen bir "alt sınır" kabul edilebilirdir
       ama HİÇBİR ŞEY kazandırmaz. */
    expect(nonZero).toBeGreaterThan(0);
  });

  it('🔒 kova yuvarlaması sınırın ALEYHİNE yazılır (bir kova düşülür)', () => {
    const k = 1, scaleM = 100;
    const window = new Uint16Array(2);
    window[0] = 0;            // d(L→v) = 0 kova
    window[1] = 50;           // d(v→L) = 50 kova → gerçek ∈ [5000, 5100)
    const target = { fromLandmark: Uint16Array.from([0]), toLandmark: Uint16Array.from([10]) };
    /* d(t→L) kovası 10 → gerçek ∈ [1000, 1100). En kötü hâlde
       d(v→L) − d(t→L) > 5000 − 1100 = 3900 = (50 − 10 − 1) × 100. */
    expect(altLowerBoundM(window, 0, k, scaleM, UNREACHABLE, target)).toBe(3900);
  });

  it('🔒 bilinmeyen mesafe sınıra KATILMAZ (uydurma yok)', () => {
    const k = 2, scaleM = 100;
    const window = new Uint16Array(4);
    window[0] = 0; window[1] = UNREACHABLE;      // L0: d(v→L0) bilinmiyor
    window[2] = 0; window[3] = 80;               // L1: d(v→L1) = 80 kova
    const target = {
      fromLandmark: Uint16Array.from([900, 0]),
      toLandmark: Uint16Array.from([0, 20]),
    };
    /* L0 kolu bilinmeyen terim taşıdığı için ATLANIR; ilk kol yalnız L1'den
       gelir: (80 − 20 − 1) × 100 = 5900. İkinci kol L1: (0 − 0 − 1) < 0.
       L0'ın `d(L0→t) − d(L0→v)` kolu ise BİLİNEN iki terim taşır: 899 × 100. */
    expect(altLowerBoundM(window, 0, k, scaleM, UNREACHABLE, target)).toBe(89_900);
  });

  it('eksik/bozuk kanıt SIFIR katkı verir (fail-soft)', () => {
    const target = { fromLandmark: Uint16Array.from([10]), toLandmark: Uint16Array.from([0]) };
    expect(altLowerBoundM(null, 0, 1, 100, UNREACHABLE, target)).toBe(0);
    expect(altLowerBoundM(new Uint16Array(2), 0, 0, 100, UNREACHABLE, target)).toBe(0);
    expect(altLowerBoundM(new Uint16Array(2), 0, 1, 0, UNREACHABLE, target)).toBe(0);
    expect(altLowerBoundM(new Uint16Array(2), 5, 1, 100, UNREACHABLE, target)).toBe(0);  // dilim dışı
    expect(altLowerBoundM(new Uint16Array(2), 0, 1, 100, UNREACHABLE, null)).toBe(0);
    /* Landmark sayısı satırla tutmuyorsa kanıt geçersizdir. */
    expect(altLowerBoundM(new Uint16Array(4), 0, 2, 100, UNREACHABLE, target)).toBe(0);
  });

  it('sınır asla NEGATİF dönmez', () => {
    const window = new Uint16Array([100, 100]);
    const target = { fromLandmark: Uint16Array.from([0]), toLandmark: Uint16Array.from([9000]) };
    expect(altLowerBoundM(window, 0, 1, 50, UNREACHABLE, target)).toBe(0);
  });

  /* ── Otorite ve entegrasyon kilitleri ──────────────────────────────────── */

  it('🔒 ALT rota otoritesi DEĞİLDİR — kanonik A* tek kalır', () => {
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker.match(/function routeRtg3EdgeState\(/g)).toHaveLength(1);
    /* Sınır hesabı TEK yerde ve SAF modülde. */
    expect(worker.match(/function _altLowerBoundM\(/g)).toHaveLength(1);
    expect(worker).toContain("import { altLowerBoundM } from './map/graph/altLowerBound'");
    /* ALT geometri/rota üretmez: yalnız `f` sezgiseline girer. */
    expect(worker).not.toMatch(/altWindow[\s\S]{0,80}geometry/);
  });

  /**
   * ÖLÇÜLMÜŞ KARAR — ALT ara pencerede DOĞRUDAN sezgisel yapılmaz.
   * Denendi: arama koridorun zorunlu sınırı yerine ülke ölçeğindeki en kısa
   * yola yöneldi, o yol pencerede yerleşik olmayan bölgelerden geçtiği için
   * sınıra ulaşılamadı (Mersin→Ankara 86 338 → 200 001 tavan; İstanbul→Ankara
   * rotası 608 686 → 662 861 m). Bu kilit o gerilemeyi geri getirmez.
   */
  it('🔒 ALT ara pencerede KALAN terimi güçlendirir, yönlendirmeyi ele geçirmez', () => {
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker).toContain('const bucket = members[i];');
    expect(worker).toContain('_altLowerBoundM(session, portalNodes[memberIndex])');
    /* Ara pencerede sezgisel koridor kutusu + kalan terimidir. */
    expect(worker).toContain('distanceToBoxM(lat, lon, boxes[i]) + (remaining[i]');
    /* SON pencerede ALT doğrudan kullanılır (hedef gerçekten oradadır). */
    expect(worker).toContain('const alt = session.altK > 0 ? _altLowerBoundM(session, node) : 0;');
  });

  it('🔒 kanıta göre profil: ALT varken ayrı sabitler, yokken eski profil', () => {
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker).toContain('const CORRIDOR_BASE_WEIGHT = 1.6;');
    expect(worker).toContain('const ALT_CORRIDOR_BASE_WEIGHT = 1.35;');
    expect(worker).toContain('const ALT_CORRIDOR_CLASS_LIMIT = 5;');
    expect(worker).toContain('const ALT_CORRIDOR_TIER_OFFSET_M = 60_000;');
    expect(worker).toContain('const ALT_CORRIDOR_ESCALATE_MAX_WEIGHT = 2.5;');
    /* Profil seçimi KANITA bağlıdır; kanıt önce doğrulanır. */
    expect(worker).toContain('const altReady = multiWindow && _altEvidenceIsUsable(msg);');
    expect(worker).toContain('if (altReady) _installAltTargetEvidence(_crossSession, msg);');
  });

  it('🔒 bölge içi (tek pencere) rota ALT KULLANMAZ — parite korunur', () => {
    const worker = readFileSync(WORKER, 'utf8');
    /* `multiWindow` olmadan ALT hiç kurulmaz → dilim bile okunmaz. */
    expect(worker).toContain('multiWindow && _altEvidenceIsUsable(msg)');
    expect(worker).toContain('return multiWindow ? CORRIDOR_BASE_WEIGHT : HEURISTIC_WEIGHT;'.replace(
      'return multiWindow ? CORRIDOR_BASE_WEIGHT : HEURISTIC_WEIGHT;',
      'if (!multiWindow) return HEURISTIC_WEIGHT;'));
  });

  it('🔒 hedef satırı BAŞKA düğüme aitse ALT KAPANIR (sessizce kullanılmaz)', () => {
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker).toContain("session.altDisabledReason = 'ALT_TARGET_NODE_MISMATCH'");
    expect(worker).toContain("session.altDisabledReason = 'ALT_WINDOW_SLICE_TRUNCATED'");
    expect(worker).toContain("'ALT_WINDOW_SLICE_MISSING'");
  });

  it('🔒 arama tavanı ALT ile de YÜKSELTİLMEDİ', () => {
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker).toContain('if (!mem || mem <= 1) return 30_000;');
    expect(worker).toContain('return 200_000;');
  });

  /* ── Ön işleme sözleşmesi ──────────────────────────────────────────────── */

  it('🔒 ön işleme metriği EN GEVŞEK graftır ve seçim DETERMİNİSTİKTİR', () => {
    const builder = readFileSync(BUILDER, 'utf8');
    /* Metrik sözleşmesi artefaktın içine yazılır (köken kanıtı). */
    expect(builder).toContain("metric: 'ONEWAY_ONLY_BASE_COST_M'");
    expect(builder).toContain('BACKBONE_CONSTRAINED_FARTHEST_POINT_REACHABILITY_VERIFIED');
    /* Şehir adı SABİTLENMEZ — seçim veriden gelir. */
    expect(builder).not.toMatch(/İstanbul|Ankara|Mersin|Antalya/);
    /* Erişilemeyen aday landmark OLAMAZ (ölçüldü: ileri yönde 1 düğüm çözen aday). */
    expect(builder).toContain('const ACCEPT_RATIO = 0.5;');
    expect(builder).toContain("throw new Error('ALT_NO_REACHABLE_LANDMARK')");
    /* Taşan kova KIRPILMAZ (kırpma sınırı fazla tahmin ettirebilir). */
    expect(builder).toContain('out[i] = bucket >= UNREACHABLE ? UNREACHABLE : bucket;');
    /* Yanlış graf ↔ ALT birleşimi reddedilebilsin diye köken yazılır. */
    expect(builder).toContain('datasetId: manifest.datasetId');
    expect(builder).toContain('graphManifestSha256');
  });
});
