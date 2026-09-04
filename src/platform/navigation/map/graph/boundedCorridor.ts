/**
 * boundedCorridor.ts — NAV v3 · L1 · SINIRLI YOL KORİDORU GENİŞLEMESİ (SAF · F6).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F6.2 · F4 `graphAdjacency` · CLAUDE.md
 * §CROSS-DOMAIN 1/7/8/15.
 *
 * SAF: I/O YOK · timer YOK · React YOK · saat OKUMAZ · MODÜL DURUMU YOK ·
 * `Date.now`/`performance.now` YOK. Aynı girdi → aynı çıktı (deterministik).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── HANGİ SORUYU CEVAPLAR ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * *"Aracın oturduğu kenardan başlayarak, ÖNÜNDEKİ en fazla X metre yol ağı
 * hangi kenarlardan oluşur ve her kenarın başı araçtan kaç metre ötededir?"*
 *
 * Bu, F4'ün tek adımlık komşuluğunun (`isDirectlyConnected`) SINIRLI ve
 * ÖLÇÜLEBİLİR genişlemesidir. Yeni bir routing motoru DEĞİLDİR: hedefi yoktur,
 * maliyet fonksiyonu yoktur, yeniden yol bulmaz. A* hâlâ yalnız
 * `NavigationCompute.worker.ts` içindedir ve bu dosya onu görmez.
 *
 * ── NEDEN SINIRSIZ BFS/DIJKSTRA YASAK ────────────────────────────────────
 * 295 346 kenarlı monolit grafta sınırsız bir genişleme, düşük-uç head unit'te
 * GPS kadansındaki (≈1 Hz) sıcak yolu bloklar. Bu yüzden DÖRT bağımsız tavan
 * vardır ve hangisinin dolduğu SONUÇTA AÇIKÇA yazar:
 *   ① mesafe bütçesi (m)      → `BUDGET_EXHAUSTED`   (tasarım gereği sınır)
 *   ② kenar tavanı            → `EDGE_LIMIT`         (KISMİ — kesildi)
 *   ③ düğüm genişletme tavanı → `NODE_LIMIT`         (KISMİ — kesildi)
 *   ④ derinlik tavanı         → `DEPTH_LIMIT`        (KISMİ — kesildi)
 * "Kesildi" ile "bütçe kadarı tarandı" AYNI ŞEY DEĞİLDİR: birincisinde
 * "ileride nesne yok" DENEMEZ, ikincisinde denebilir. Tüketici bu ayrımı
 * `truncated` üzerinden okur.
 *
 * ── KUŞ UÇUŞUNA SESSİZ DÜŞÜŞ YOK ─────────────────────────────────────────
 * Topoloji okunamıyorsa sonuç `NO_TOPOLOGY`dir; düz çizgi mesafesi ASLA ağ
 * mesafesi yerine geçmez (F6 kilidi).
 *
 * ── YÖN SEMANTİĞİ (F4 ile AYNI, pazarlıksız) ─────────────────────────────
 * `dir = 0` ileri kol (`from → to`) · `dir = 1` çift yönlü kenarın ters kolu.
 * `buildGraphAdjacency` tek yönlü kenarın ters kolunu HİÇ ÜRETMEZ; dolayısıyla
 * bu genişleme **yasak yöne çıkamaz** (yapısal garanti, ek kontrol değil).
 * Aynı kenara geri dönüş (U dönüşü) ÜRETİLMEZ — F4 `_readEdgeTopology` ile
 * birebir aynı kural; sahte dallanma yaratmaz.
 *
 * ── HAM KİMLİK L1'DE KALIR ───────────────────────────────────────────────
 * Bu dosya graf sıra numarasıyla (`ordinal`) çalışır ve `map/graph/` altında
 * durur — tıpkı `graphAdjacency` ve `edgeSpatialIndex` gibi. Kanonik `EdgeId`
 * çevrimi L1 SINIRINDA (`mapStoreSources`) yapılır; ham sıra numarası L1'in
 * dışına ÇIKMAZ (F4 K6 kilidi korunur).
 */

import type { RoutingGraphView } from './rtg2Reader';
import { edgeIsOneway } from './rtg2Reader';
import type { GraphAdjacency } from './graphAdjacency';
import { edgeEndpoints, outgoingRange } from './graphAdjacency';

/* ══════════════════════════════════════════════════════════════════════════
   1) TAVANLAR — politika sayıları (ölçülmüş kalibrasyon DEĞİL)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ Aşağıdaki dört sayı **politikadır, sahamızdan ölçülmemiştir** ve
 * `docs/DEVICE_VALIDATION_LEDGER.md` maddesidir. Amaçları "doğru koridoru
 * bulmak" değil, **sıcak yolun bloklanmayacağını yapısal olarak garanti
 * etmektir**. Gerçek cihazda ölçülmeden "yeterli" DENEMEZ.
 */

/** Koridorda taşınabilecek en fazla kenar. */
export const CORRIDOR_MAX_EDGES = 96;

/** En fazla kaç düğüm genişletilir (dallanma maliyetinin gerçek ölçüsü). */
export const CORRIDOR_MAX_NODE_EXPANSIONS = 64;

/** Başlangıç kenarından en fazla kaç kenar derinliğe inilir. */
export const CORRIDOR_MAX_DEPTH = 32;

/**
 * L1 gezinme tavanı (m). **Ufuk bütçesi POLİTİKASI DEĞİLDİR** — o L3'ündür
 * (`navHorizon.HORIZON_MAX_M`) ve L1 onu import ETMEZ (katman yönü). Bu sayı
 * yalnız "istenen bütçe ne olursa olsun gezinme bunun ötesine geçemez"
 * güvenlik tavanıdır.
 */
export const CORRIDOR_HARD_MAX_BUDGET_M = 5_000;

export interface CorridorLimits {
  /** İleri taranacak yol-boyu mesafe (m). Tavan: `CORRIDOR_HARD_MAX_BUDGET_M`. */
  readonly budgetM: number;
  readonly maxEdges: number;
  readonly maxNodeExpansions: number;
  readonly maxDepth: number;
}

/** Varsayılan tavanlar — çağıran yalnız bütçeyi verir. */
export function corridorLimits(budgetM: number): CorridorLimits {
  const b = (typeof budgetM === 'number' && Number.isFinite(budgetM) && budgetM > 0)
    ? Math.min(budgetM, CORRIDOR_HARD_MAX_BUDGET_M)
    : 0;
  return {
    budgetM: b,
    maxEdges: CORRIDOR_MAX_EDGES,
    maxNodeExpansions: CORRIDOR_MAX_NODE_EXPANSIONS,
    maxDepth: CORRIDOR_MAX_DEPTH,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SONUÇ
   ══════════════════════════════════════════════════════════════════════════ */

export type CorridorOutcome =
  /** Ağ bütçe dolmadan bitti (yaprak/çıkmaz) — tarama TAM. */
  | 'COMPLETE'
  /** Bütçe doldu; ötesi TARANMADI. Tasarım gereği sınır — kusur DEĞİL. */
  | 'BUDGET_EXHAUSTED'
  /** Kenar tavanı doldu — koridor KESİLDİ (kısmi). */
  | 'EDGE_LIMIT'
  /** Düğüm genişletme tavanı doldu — koridor KESİLDİ (kısmi). */
  | 'NODE_LIMIT'
  /** Derinlik tavanı doldu — koridor KESİLDİ (kısmi). */
  | 'DEPTH_LIMIT'
  /** Başlangıç kenarı/konumu geçersiz (yasak yön dâhil) — koridor YOK. */
  | 'INVALID_START'
  /** Komşuluk okunamadı — koridor ÜRETİLEMEZ ("yol yok" DEĞİL). */
  | 'NO_TOPOLOGY';

export const CORRIDOR_OUTCOMES: readonly CorridorOutcome[] = [
  'COMPLETE', 'BUDGET_EXHAUSTED', 'EDGE_LIMIT', 'NODE_LIMIT', 'DEPTH_LIMIT',
  'INVALID_START', 'NO_TOPOLOGY',
] as const;

/**
 * Bu sonuç "koridor bütçe içinde EKSİKSİZ tarandı" diyor mu. Yalnız bu iki
 * hâlde tüketici "ileride yok" hükmü kurabilir; diğerlerinde bilgisizlik vardır.
 */
export function corridorIsScanComplete(o: CorridorOutcome): boolean {
  return o === 'COMPLETE' || o === 'BUDGET_EXHAUSTED';
}

/** Koridordaki tek kenar (ham graf kimliğiyle — L1 içi). */
export interface CorridorEdgeRef {
  readonly ordinal: number;
  readonly dir: 0 | 1;
  /**
   * Ego'dan bu kenarın BAŞINA yol-boyu mesafe (m).
   * **Başlangıç kenarında NEGATİFTİR** (kenarın başı araçtan geride kalmıştır);
   * böylece kenar üzerindeki `alongEdgeM` noktasının ego'ya uzaklığı daima
   * `entryDistanceM + alongEdgeM` olur — ayrı bir özel hâl gerekmez.
   */
  readonly entryDistanceM: number;
  /** Kenarın gerçek uzunluğu (m) — `costM`. */
  readonly lengthM: number;
  /** Başlangıç kenarından kaç kenar ötede (başlangıç = 0). */
  readonly depth: number;
}

export interface RawCorridor {
  readonly outcome: CorridorOutcome;
  /** Ego'dan uzaklığa göre ARTAN sırada (deterministik). */
  readonly edges: readonly CorridorEdgeRef[];
  /** Koridorun ego'dan itibaren kapsadığı en uzak yol-boyu mesafe (m). */
  readonly coveredM: number;
  /** Kaç düğüm genişletildi (gerçek CPU ölçüsü). */
  readonly nodeExpansions: number;
  /** Kaç genişletmede birden fazla çıkış vardı (gerçek dallanma sayısı). */
  readonly branchCount: number;
  /** Bir TAVAN yüzünden kesildi mi (bütçe sınırı kesme SAYILMAZ). */
  readonly truncated: boolean;
}

const _EMPTY_EDGES: readonly CorridorEdgeRef[] = Object.freeze([]);

function _empty(outcome: CorridorOutcome): RawCorridor {
  return {
    outcome,
    edges: _EMPTY_EDGES,
    coveredM: 0,
    nodeExpansions: 0,
    branchCount: 0,
    truncated: false,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) GENİŞLETİCİ (saf)
   ══════════════════════════════════════════════════════════════════════════ */

/** Sıraya alınmış aday kol. */
interface _Frontier {
  ordinal: number;
  dir: 0 | 1;
  entryDistanceM: number;
  depth: number;
}

/**
 * `key = ordinal * 2 + dir` — yönlü kenarın tek sayısal kimliği (yalnız bu
 * dosyanın içinde, ziyaret kümesi için). Graf dışına ÇIKMAZ.
 */
function _key(ordinal: number, dir: 0 | 1): number {
  return ordinal * 2 + dir;
}

/**
 * Sıraya DETERMİNİSTİK ekleme: (mesafe, ordinal, dir) üçlüsüne göre artan.
 * Eşit mesafeli iki kolun sırası ASLA rastgele olamaz — aksi hâlde aynı
 * girdide farklı koridor çıkar ve gölge karşılaştırması yorumlanamaz.
 *
 * Sıra en fazla birkaç yüz eleman tutar (tavanlar yüzünden), bu yüzden
 * eklemeli sıralama yığın (heap) kurmaktan hem daha ucuz hem allocation'sızdır.
 */
function _insert(queue: _Frontier[], item: _Frontier): void {
  let i = queue.length;
  while (i > 0) {
    const p = queue[i - 1];
    const newer = p.entryDistanceM > item.entryDistanceM
      || (p.entryDistanceM === item.entryDistanceM && p.ordinal > item.ordinal)
      || (p.entryDistanceM === item.entryDistanceM && p.ordinal === item.ordinal && p.dir > item.dir);
    if (!newer) break;
    queue[i] = p;
    i--;
  }
  queue[i] = item;
}

/**
 * Sınırlı koridor genişlemesi. **SAF ve DETERMİNİSTİK.**
 *
 * @param startAlongEdgeM Başlangıç kenarının başından aracın yol-boyu mesafesi.
 *        Aralık dışıysa kenar uzunluğuna kırpılır (uydurma değil, kırpma —
 *        eşleştiricinin ölçtüğü mesafe kenar uzunluğunu birkaç metre aşabilir).
 */
export function expandBoundedCorridor(
  view: RoutingGraphView | null,
  adj: GraphAdjacency | null,
  startOrdinal: number,
  startDir: 0 | 1,
  startAlongEdgeM: number,
  limits: CorridorLimits,
): RawCorridor {
  if (!view || !adj) return _empty('NO_TOPOLOGY');
  if (!Number.isInteger(startOrdinal) || startOrdinal < 0 || startOrdinal >= view.edgeCount) {
    return _empty('INVALID_START');
  }
  if (startDir !== 0 && startDir !== 1) return _empty('INVALID_START');
  /* Tek yönlü kenarın ters kolu diye bir şey YOKTUR — F4 topolojisiyle aynı
     kural; yasak yönde koridor açmak sürücüyü ters yola sokmaktır. */
  if (startDir === 1 && edgeIsOneway(view, startOrdinal)) return _empty('INVALID_START');

  const budgetM = (typeof limits?.budgetM === 'number' && Number.isFinite(limits.budgetM))
    ? Math.max(0, Math.min(limits.budgetM, CORRIDOR_HARD_MAX_BUDGET_M))
    : 0;
  const maxEdges = Math.max(1, Math.min(limits?.maxEdges ?? CORRIDOR_MAX_EDGES, CORRIDOR_MAX_EDGES));
  const maxNodes = Math.max(0, Math.min(
    limits?.maxNodeExpansions ?? CORRIDOR_MAX_NODE_EXPANSIONS, CORRIDOR_MAX_NODE_EXPANSIONS));
  const maxDepth = Math.max(0, Math.min(limits?.maxDepth ?? CORRIDOR_MAX_DEPTH, CORRIDOR_MAX_DEPTH));

  const startLenRaw = view.edgeCostM[startOrdinal];
  if (!Number.isFinite(startLenRaw)) return _empty('INVALID_START');
  const startLen = Math.max(0, startLenRaw);
  const along = (typeof startAlongEdgeM === 'number' && Number.isFinite(startAlongEdgeM))
    ? Math.max(0, Math.min(startAlongEdgeM, startLen))
    : 0;

  const edges: CorridorEdgeRef[] = [{
    ordinal: startOrdinal,
    dir: startDir,
    /* Kenarın BAŞI araçtan GERİDE → negatif giriş mesafesi (bkz. tip notu). */
    entryDistanceM: -along,
    lengthM: startLen,
    depth: 0,
  }];

  const visited = new Set<number>([_key(startOrdinal, startDir)]);
  const queue: _Frontier[] = [];

  /* Sayaçlar TEK mutable kayıtta: `expand` bir kapanış (closure) olduğu için
     ayrı `let`'lerin daraltılması derleyicide belirsizleşir; tek kayıt hem
     şekli sabit tutar (V8 hidden-class) hem okunabilirliği korur. */
  const st = {
    nodeExpansions: 0,
    branchCount: 0,
    coveredM: Math.max(0, startLen - along),
    truncatedBy: null as CorridorOutcome | null,
    budgetBlocked: false,
  };

  /** Bir kenarın BİTİŞİNDEN devam eden kolları sıraya alır. */
  const expand = (ordinal: number, dir: 0 | 1, exitDistanceM: number, depth: number): void => {
    if (depth >= maxDepth) {
      if (st.truncatedBy === null) st.truncatedBy = 'DEPTH_LIMIT';
      return;
    }
    if (st.nodeExpansions >= maxNodes) {
      if (st.truncatedBy === null) st.truncatedBy = 'NODE_LIMIT';
      return;
    }

    const ends = edgeEndpoints(view, ordinal, dir);
    if (ends === null) return;                             // uç okunamadı → dal yok

    const r = outgoingRange(adj, ends.toNode);
    st.nodeExpansions++;
    let pushed = 0;

    for (let k = r.start; k < r.end; k++) {
      const ord = adj.edgeOrdinal[k];
      /* U dönüşü ÜRETİLMEZ (F4 `_readEdgeTopology` ile aynı kural). */
      if (ord === ordinal) continue;
      const d = (adj.dir[k] === 1 ? 1 : 0) as 0 | 1;
      const key = _key(ord, d);
      if (visited.has(key)) continue;                      // döngü koruması
      visited.add(key);
      pushed++;
      _insert(queue, { ordinal: ord, dir: d, entryDistanceM: exitDistanceM, depth: depth + 1 });
    }

    if (pushed > 1) st.branchCount++;
  };

  /* Başlangıç kenarının bitişi bütçe içindeyse dallar sıraya girer. */
  if (st.coveredM <= budgetM) expand(startOrdinal, startDir, st.coveredM, 0);
  else st.budgetBlocked = true;

  while (queue.length > 0) {
    const next = queue.shift() as _Frontier;

    if (next.entryDistanceM > budgetM) { st.budgetBlocked = true; continue; }
    if (edges.length >= maxEdges) {
      if (st.truncatedBy === null) st.truncatedBy = 'EDGE_LIMIT';
      break;
    }

    const lenRaw = view.edgeCostM[next.ordinal];
    const len = Number.isFinite(lenRaw) ? Math.max(0, lenRaw) : 0;

    edges.push({
      ordinal: next.ordinal,
      dir: next.dir,
      entryDistanceM: next.entryDistanceM,
      lengthM: len,
      depth: next.depth,
    });

    const exit = next.entryDistanceM + len;
    if (exit > st.coveredM) st.coveredM = Math.min(exit, budgetM);

    /* Bütçeyi AŞAN kenar koridora GİRER (kısmen ufkun içindedir) ama ondan
       ÖTEYE genişletilmez — aksi hâlde bütçe anlamını yitirirdi. */
    if (exit <= budgetM) expand(next.ordinal, next.dir, exit, next.depth);
    else st.budgetBlocked = true;
  }

  const limitHit = st.truncatedBy;
  const outcome: CorridorOutcome = limitHit !== null
    ? limitHit
    : (st.budgetBlocked || queue.length > 0 ? 'BUDGET_EXHAUSTED' : 'COMPLETE');

  return {
    outcome,
    edges,
    coveredM: st.coveredM,
    nodeExpansions: st.nodeExpansions,
    branchCount: st.branchCount,
    truncated: limitHit !== null,
  };
}
