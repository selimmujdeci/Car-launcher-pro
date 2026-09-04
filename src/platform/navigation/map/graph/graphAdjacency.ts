/**
 * graphAdjacency.ts — NAV v3 · L1 · YOL AĞI KOMŞULUĞU (SAF · F4).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F4.2/F4.5.
 *
 * SAF: I/O YOK · timer YOK · React YOK · saat OKUMAZ · modül durumu YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN CSR (bitişik dizi), NEDEN `Map<number, Edge[]>` DEĞİL ───────────
 * ══════════════════════════════════════════════════════════════════════════
 * Worker'ın eski gösterimi düğüm başına bir dizi ve kenar başına bir NESNE
 * tutuyordu: 238 252 düğüm + ~525 000 yarım-kenar nesnesi. Bitişik tipli
 * dizilere geçmek aynı bilgiyi tutar ama GC baskısını ve bellek ayak izini
 * düşürür — düşük-uç head unit'te ölçülebilir fark.
 *
 * ── SIRA PARİTESİ (pazarlıksız) ──────────────────────────────────────────
 * A*'ın gezinme sırası komşu sırasına bağlıdır: eşit maliyetli iki rota
 * arasında hangisinin seçileceğini bu sıra belirler. Bu yüzden CSR **eski
 * `Map` gösteriminin kenar ekleme sırasını BİREBİR** korur:
 *   kenar `i` için önce `from`'a ileri kol, tek yönlü DEĞİLSE `to`'ya geri kol.
 * Parite testi gerçek artefakt üzerinde aynı rotayı üretmeyi kanıtlar.
 *
 * ── YÖN SEMANTİĞİ ────────────────────────────────────────────────────────
 * `dir = 0` ileri kol (`from → to`) · `dir = 1` geri kol (çift yönlü kenarın
 * ters yönü) — F1 `legacyEdgeIdAdapter` ile AYNI sözleşme. Tek yönlü kenarın
 * geri kolu HİÇ ÜRETİLMEZ (yasak yöne komşuluk kurulmaz).
 */

import type { RoutingGraphView } from './rtg2Reader';
import { edgeIsOneway } from './rtg2Reader';

/* ══════════════════════════════════════════════════════════════════════════
   1) YAPI
   ══════════════════════════════════════════════════════════════════════════ */

export interface GraphAdjacency {
  /** `offsets[n] .. offsets[n+1]` → düğüm `n`'in yarım-kenar aralığı. */
  readonly offsets: Uint32Array;
  /** Yarım-kenarın vardığı düğüm. */
  readonly targetNode: Uint32Array;
  /** Yarım-kenarın ait olduğu kenarın SIRA NUMARASI (`EdgeId` kaynağı). */
  readonly edgeOrdinal: Uint32Array;
  /** 0 = ileri kol · 1 = geri kol. */
  readonly dir: Uint8Array;
  /** Toplam yarım-kenar sayısı. */
  readonly halfEdgeCount: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KURUCU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Graf görünümünden CSR komşuluk kurar. **İki geçiş:** önce derece sayımı,
 * sonra doldurma — ikisi de kenar sıra numarası düzeninde ilerler, böylece
 * düğüm başına komşu sırası eski gösterimle AYNI kalır.
 */
export function buildGraphAdjacency(view: RoutingGraphView): GraphAdjacency {
  const n = view.nodeCount;
  const e = view.edgeCount;

  /* ── 1) Derece sayımı ─────────────────────────────────────────────────── */
  const counts = new Uint32Array(n + 1);
  let half = 0;
  for (let i = 0; i < e; i++) {
    counts[view.edgeFrom[i]]++;
    half++;
    if (!edgeIsOneway(view, i)) {
      counts[view.edgeTo[i]]++;
      half++;
    }
  }

  /* ── 2) Önek toplamı → offsets ────────────────────────────────────────── */
  const offsets = new Uint32Array(n + 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = acc;
    acc += counts[i];
  }
  offsets[n] = acc;

  /* ── 3) Doldurma — düğüm başına imleç, kenar sırası KORUNUR ───────────── */
  const cursor = new Uint32Array(n);
  const targetNode = new Uint32Array(half);
  const edgeOrdinal = new Uint32Array(half);
  const dir = new Uint8Array(half);

  for (let i = 0; i < e; i++) {
    const from = view.edgeFrom[i];
    const to = view.edgeTo[i];

    const a = offsets[from] + cursor[from]++;
    targetNode[a] = to;
    edgeOrdinal[a] = i;
    dir[a] = 0;

    if (!edgeIsOneway(view, i)) {
      const b = offsets[to] + cursor[to]++;
      targetNode[b] = from;
      edgeOrdinal[b] = i;
      dir[b] = 1;
    }
  }

  return { offsets, targetNode, edgeOrdinal, dir, halfEdgeCount: half };
}

/**
 * HEDEFE göre komşuluk (ters CSR) — "bu düğüme HANGİ kenarlar geliyor"
 * sorusunu yanıtlar. Ayrı bir yapı gerekir çünkü ileri CSR yalnız düğümden
 * ÇIKAN yarım-kenarları tutar; tek yönlü bir kenarın varış düğümünde hiçbir
 * çıkış kaydı YOKTUR.
 *
 * **Tembel kurulur:** yalnız "gelen kenarlar" sorulursa bellek harcanır.
 */
export function buildReverseAdjacency(view: RoutingGraphView): GraphAdjacency {
  const n = view.nodeCount;
  const e = view.edgeCount;

  const counts = new Uint32Array(n + 1);
  let half = 0;
  for (let i = 0; i < e; i++) {
    counts[view.edgeTo[i]]++;
    half++;
    if (!edgeIsOneway(view, i)) {
      counts[view.edgeFrom[i]]++;
      half++;
    }
  }

  const offsets = new Uint32Array(n + 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = acc;
    acc += counts[i];
  }
  offsets[n] = acc;

  const cursor = new Uint32Array(n);
  const targetNode = new Uint32Array(half);
  const edgeOrdinal = new Uint32Array(half);
  const dir = new Uint8Array(half);

  for (let i = 0; i < e; i++) {
    const from = view.edgeFrom[i];
    const to = view.edgeTo[i];

    /* İleri kol `to` düğümüne GELİR. */
    const a = offsets[to] + cursor[to]++;
    targetNode[a] = from;      // geldiği düğüm
    edgeOrdinal[a] = i;
    dir[a] = 0;

    if (!edgeIsOneway(view, i)) {
      const b = offsets[from] + cursor[from]++;
      targetNode[b] = to;
      edgeOrdinal[b] = i;
      dir[b] = 1;
    }
  }

  return { offsets, targetNode, edgeOrdinal, dir, halfEdgeCount: half };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) SAF SORGULAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Düğümün giden yarım-kenar aralığı `[start, end)`. Geçersizse boş aralık. */
export function outgoingRange(
  adj: GraphAdjacency, node: number,
): { readonly start: number; readonly end: number } {
  if (!adj || !Number.isInteger(node) || node < 0 || node + 1 >= adj.offsets.length) {
    return { start: 0, end: 0 };
  }
  return { start: adj.offsets[node], end: adj.offsets[node + 1] };
}

/** Düğümün giden komşu sayısı. */
export function outDegree(adj: GraphAdjacency, node: number): number {
  const r = outgoingRange(adj, node);
  return r.end - r.start;
}

/**
 * Bir kenarın (sıra numarası + yön) BAŞLANGIÇ ve BİTİŞ düğümü.
 * `dir = 1` (geri kol) uçları TERS çevirir. Aralık dışı → `null`.
 */
export function edgeEndpoints(
  view: RoutingGraphView, ordinal: number, dir: 0 | 1,
): { readonly fromNode: number; readonly toNode: number } | null {
  if (!view || !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= view.edgeCount) return null;
  const a = view.edgeFrom[ordinal];
  const b = view.edgeTo[ordinal];
  return dir === 1 ? { fromNode: b, toNode: a } : { fromNode: a, toNode: b };
}

/**
 * `from` kenarının bitiş düğümünden `to` kenarının başlangıç düğümüne
 * DOĞRUDAN bir kol var mı (tek adımlık bağlanabilirlik).
 *
 * Çok adımlı ağ mesafesi BİLİNÇLİ olarak üretilmez: bunun için graf araması
 * gerekir ve o, ufuk tik'inde koşulacak bir iş DEĞİLDİR (hot-path bütçesi).
 * Bilinmeyen mesafe `null` kalır — HMM geçiş terimini UYGULAMAZ (uydurma
 * mesafe YASAK).
 */
export function isDirectlyConnected(
  view: RoutingGraphView, adj: GraphAdjacency,
  fromOrdinal: number, fromDir: 0 | 1,
  toOrdinal: number, toDir: 0 | 1,
): boolean {
  const a = edgeEndpoints(view, fromOrdinal, fromDir);
  const b = edgeEndpoints(view, toOrdinal, toDir);
  if (a === null || b === null) return false;
  if (a.toNode === b.fromNode) return true;

  const r = outgoingRange(adj, a.toNode);
  for (let k = r.start; k < r.end; k++) {
    if (adj.edgeOrdinal[k] === toOrdinal) return true;
  }
  return false;
}
