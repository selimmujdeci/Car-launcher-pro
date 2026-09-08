/**
 * graphResidencyRuntime.ts — NAV v3 · L1 · ANA İŞ PARÇACIĞI GRAF SAKİNLİĞİ (F4).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F4.11/F4.12 (F1 borcu **B2**).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `MapStore` **SENKRON** bir cephedir ve sözleşmesi gereği `fetch`/timer/native
 * SAHİPLENEMEZ (F1 kilidi). Ama kenar gerçeğini verebilmesi için grafın ana iş
 * parçacığında ÇÖZÜLMÜŞ hâlde durması gerekir. Bu dosya tam olarak o boşluğu
 * doldurur: **ağ çağrısı burada, saf okuma orada.**
 *
 * ── TALEP-GÜDÜMLÜ (güç/bellek) ───────────────────────────────────────────
 * Graf uygulama açılışında YÜKLENMEZ. `acquireRoutingGraph()` navigasyon
 * oturumu başlayınca çağrılır, `releaseRoutingGraph()` bitince. Ölçülen boyut:
 * artefakt 7 651 542 bayt → tipli görünüm ≈ 6 MB, komşuluk ≈ 4 MB, yakınlık
 * indeksi ≈ 2,5 MB. Bunu boşta taşımak düşük-uç head unit'te gereksiz bellektir.
 *
 * ── İKİNCİ PARSER YOK ────────────────────────────────────────────────────
 * Ayrıştırma **yalnız** `rtg2Reader.parseRoutingGraph` ile yapılır — worker da
 * aynı okuyucuyu kullanır. İki ayrı parser, aynı baytların iki farklı yorumu
 * demektir (kilit test `src/` ağacını tarar).
 *
 * ── İKİNCİ YETENEK OTORİTESİ YOK ─────────────────────────────────────────
 * Graf yeteneği hükmü deponun mevcut otoritesindedir: `offlineRoutingStatus`.
 * Bu dosya kendi "graf var/yok" sözlüğünü ürün kararına BESLEMEZ; ölçtüğü
 * sonucu o otoriteye BİLDİRİR (`recordOfflineGraphOutcome`). Aşağıdaki
 * `GraphResidencyState` yalnız BU KATMANIN yükleme aşamasını anlatır
 * (LAB gözlemi) — dataset hükmü hâlâ `MapStore`/`offlineRoutingStatus`tur.
 */

import type { RoutingGraphView } from './rtg2Reader';
import { parseRoutingGraph } from './rtg2Reader';
import type { GraphAdjacency } from './graphAdjacency';
import { buildGraphAdjacency, buildReverseAdjacency } from './graphAdjacency';
import type { EdgeSpatialIndex } from './edgeSpatialIndex';
import { buildEdgeSpatialIndex } from './edgeSpatialIndex';
import { recordOfflineGraphOutcome } from '../../offlineRoutingStatus';
import { readMonotonicNow } from '../../time/navClock';
import {
  mergeRegionalGraphViews, validateTurkeyGraphManifest,
} from './turkeyGraphManifest';

/* ══════════════════════════════════════════════════════════════════════════
   1) SABİTLER
   ══════════════════════════════════════════════════════════════════════════ */

/** Worker ile AYNI artefakt yolu (ikinci kaynak YOK). */
export const ROUTING_GRAPH_URL = '/maps/routing-graph.bin';
const FETCH_TIMEOUT_MS = 5_000;
export const REGIONAL_GRAPH_MAX_BYTES = 64 * 1024 * 1024;
export const REGIONAL_GRAPH_MAX_RESIDENT = 3;

/* ══════════════════════════════════════════════════════════════════════════
   2) DURUM
   ══════════════════════════════════════════════════════════════════════════ */

export type GraphResidencyState =
  /** Hiç istenmedi — "graf yok" DEĞİL. */
  | 'UNINITIALIZED'
  | 'LOADING'
  | 'AVAILABLE'
  /** Artefakt sunulmuyor (404/500) veya ağ/ortam yok. */
  | 'MISSING'
  /** İndirildi ama biçim bozuk/kısa. */
  | 'CORRUPT'
  /** Biçim tanınıyor ama bu sürüm/kapasite desteklenmiyor. */
  | 'UNSUPPORTED';

let _state: GraphResidencyState = 'UNINITIALIZED';
let _strongView: RoutingGraphView | null = null;
let _weakView: WeakRef<RoutingGraphView> | null = null;
let _adjacency: GraphAdjacency | null = null;
let _reverseAdjacency: GraphAdjacency | null = null;
let _index: EdgeSpatialIndex | null = null;
let _inFlight: Promise<RoutingGraphView | null> | null = null;
let _holders = 0;
let _detail: string | null = null;
let _loadCount = 0;
let _parseMs: number | null = null;
let _bytes: number | null = null;
let _observedAtMonoMs: number | null = null;
let _residentRegions: readonly string[] = [];

/* ══════════════════════════════════════════════════════════════════════════
   3) YÜKLEME
   ══════════════════════════════════════════════════════════════════════════ */

function _report(state: GraphResidencyState, detail: string): void {
  _state = state;
  _detail = detail;
  _observedAtMonoMs = readMonotonicNow();
  /* Tek yetenek otoritesine BİLDİR (ikinci sözlük kurulmaz). */
  try {
    if (state === 'AVAILABLE') {
      recordOfflineGraphOutcome('AVAILABLE', Date.now(), readMonotonicNow());
    } else if (state === 'MISSING') {
      recordOfflineGraphOutcome('GRAPH_MISSING', Date.now(), readMonotonicNow());
    } else if (state === 'CORRUPT' || state === 'UNSUPPORTED') {
      recordOfflineGraphOutcome('GRAPH_CORRUPT', Date.now(), readMonotonicNow());
    }
  } catch { /* fail-soft: bildirim navigasyonu ASLA düşürmez */ }
}

async function _load(): Promise<RoutingGraphView | null> {
  _state = 'LOADING';
  _loadCount++;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ROUTING_GRAPH_URL, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      _report('MISSING', `HTTP ${res.status}`);
      return null;
    }

    const buf = await res.arrayBuffer();
    _bytes = buf.byteLength;

    const t0 = readMonotonicNow();
    const parsed = parseRoutingGraph(buf);
    const t1 = readMonotonicNow();
    _parseMs = (t0 !== null && t1 !== null) ? Math.max(0, t1 - t0) : null;

    if (parsed.outcome !== 'OK' || parsed.view === null) {
      /* Bozuk graf ASLA "kullanılabilir" sayılmaz (F4.12). */
      const state: GraphResidencyState =
        (parsed.outcome === 'UNSUPPORTED_VERSION' || parsed.outcome === 'ID_SPACE_OVERFLOW')
          ? 'UNSUPPORTED' : 'CORRUPT';
      _report(state, `${parsed.outcome}: ${parsed.detail}`);
      return null;
    }

    _strongView = parsed.view;
    _weakView = new WeakRef(parsed.view);
    _report('AVAILABLE', parsed.detail);
    return parsed.view;
  } catch (e) {
    /* Ağ/ortam hatası: artefakt YOK sayılır ama bu KALICI bir hüküm değildir —
       bir sonraki acquire yeniden dener. */
    _report('MISSING', e instanceof Error ? e.message : 'ağ/ortam hatası');
    return null;
  } finally {
    _inFlight = null;
  }
}

/**
 * Grafı ana iş parçacığında hazır hâle getirir. **İdempotent ve ref-count'lu:**
 * eşzamanlı çağrılar TEK yüklemeyi paylaşır (çift indirme/çift parse yok).
 */
export function acquireRoutingGraph(): Promise<RoutingGraphView | null> {
  _holders++;

  if (_strongView !== null) return Promise.resolve(_strongView);

  /* GC altında düşmüş olabilir; hayattaysa yeniden indirmeden geri al. */
  const alive = _weakView?.deref() ?? null;
  if (alive) {
    _strongView = alive;
    _state = 'AVAILABLE';
    return Promise.resolve(alive);
  }

  if (_inFlight !== null) return _inFlight;
  _inFlight = _load();
  return _inFlight;
}

async function _sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Manifest ile seçilmiş komşu paketleri mevcut residency authority içine alır.
 * Bir paket dahi eksik/bozuk/hash uyumsuzsa birleşik graph yayınlanmaz.
 */
export async function acquireRegionalRoutingGraph(
  manifestValue: unknown,
  requiredRegionIds: readonly string[],
  baseUrl = '/maps/rtg3/',
): Promise<RoutingGraphView | null> {
  _holders++;
  _state = 'LOADING'; _loadCount++;
  const manifest = validateTurkeyGraphManifest(manifestValue);
  if (!manifest || requiredRegionIds.length < 1 || requiredRegionIds.length > REGIONAL_GRAPH_MAX_RESIDENT) {
    _report('UNSUPPORTED', 'regional manifest veya residency region bütçesi geçersiz');
    return null;
  }
  const selected = requiredRegionIds.map((id) => manifest.regions.find((r) => r.regionId === id));
  if (selected.some((r) => !r)) { _report('MISSING', 'gerekli region manifestte yok'); return null; }
  const selectedIds = new Set(requiredRegionIds);
  const reached = new Set<string>([requiredRegionIds[0]]);
  const queue = [requiredRegionIds[0]];
  while (queue.length) {
    const current = queue.shift()!;
    const region = manifest.regions.find((candidate) => candidate.regionId === current);
    for (const neighbor of region?.neighbors ?? []) if (selectedIds.has(neighbor) && !reached.has(neighbor)) {
      reached.add(neighbor); queue.push(neighbor);
    }
  }
  if (reached.size !== selectedIds.size) {
    _report('MISSING', 'gerekli cross-region corridor komşuluk zinciri kırık');
    return null;
  }
  const bytes = selected.reduce((n, r) => n + r!.byteSize, 0);
  if (bytes > REGIONAL_GRAPH_MAX_BYTES) { _report('UNSUPPORTED', 'regional graph bellek bütçesini aşıyor'); return null; }
  try {
    const views: RoutingGraphView[] = [];
    for (const region of selected) {
      const graphUrl = `${baseUrl.replace(/\/$/, '')}/${region!.graphFile.replace(/^\//, '')}`;
      const res = await fetch(graphUrl);
      if (!res.ok) throw new Error(`${region!.regionId}: HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength !== region!.byteSize || await _sha256(buffer) !== region!.sha256) {
        _report('CORRUPT', `${region!.regionId}: SHA/boyut uyumsuz`); return null;
      }
      const parsed = parseRoutingGraph(buffer);
      if (parsed.outcome !== 'OK' || !parsed.view || parsed.view.version !== 3) {
        _report('CORRUPT', `${region!.regionId}: ${parsed.outcome}`); return null;
      }
      views.push(parsed.view);
    }
    const merged = mergeRegionalGraphViews(views);
    if (!merged) { _report('CORRUPT', 'region portal kimlikleri birleştirilemedi'); return null; }
    _strongView = merged; _weakView = new WeakRef(merged); _bytes = bytes;
    _residentRegions = [...requiredRegionIds];
    _report('AVAILABLE', `RTG3 regions: ${_residentRegions.join(',')}`);
    return merged;
  } catch (error) {
    _report('MISSING', error instanceof Error ? error.message : 'regional load hatası');
    return null;
  }
}

/**
 * Sakinliği bırak (Zero-Leak). Son tutucu çıkınca güçlü referanslar düşer;
 * görünüm zayıf referansta kalır → GC serbest bırakabilir, ama basınç yoksa
 * bir sonraki oturum yeniden indirmez.
 */
export function releaseRoutingGraph(): void {
  _holders = Math.max(0, _holders - 1);
  if (_holders > 0) return;
  _strongView = null;
  /* Türetilmiş yapılar TAMAMEN bırakılır: ~6,5 MB'lık bu iki yapı yeniden
     kurulabilir (O(kenar)); boşta taşımanın karşılığı yoktur. */
  _adjacency = null;
  _reverseAdjacency = null;
  _index = null;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) SENKRON OKUMA (MapStore kaynak katmanı için)
   ══════════════════════════════════════════════════════════════════════════ */

/** Çözülmüş graf görünümü. **Hiçbir şey BAŞLATMAZ** — yoksa `null`. */
export function readRoutingGraphView(): RoutingGraphView | null {
  if (_strongView !== null) return _strongView;
  const alive = _weakView?.deref() ?? null;
  return alive;
}

/** Komşuluk — İLK istendiğinde kurulur (tembel), sonra önbellekte. */
export function readGraphAdjacency(): GraphAdjacency | null {
  const view = readRoutingGraphView();
  if (view === null) return null;
  if (_adjacency === null) {
    try {
      _adjacency = buildGraphAdjacency(view);
    } catch {
      _adjacency = null;
    }
  }
  return _adjacency;
}

/** Ters komşuluk ("bu kenara HANGİ kenarlar geliyor") — tembel. */
export function readReverseAdjacency(): GraphAdjacency | null {
  const view = readRoutingGraphView();
  if (view === null) return null;
  if (_reverseAdjacency === null) {
    try {
      _reverseAdjacency = buildReverseAdjacency(view);
    } catch {
      _reverseAdjacency = null;
    }
  }
  return _reverseAdjacency;
}

/** Yakınlık indeksi — İLK istendiğinde kurulur (tembel), sonra önbellekte. */
export function readEdgeSpatialIndex(): EdgeSpatialIndex | null {
  const view = readRoutingGraphView();
  if (view === null) return null;
  if (_index === null) {
    try {
      _index = buildEdgeSpatialIndex(view);
    } catch {
      _index = null;
    }
  }
  return _index;
}

/* ══════════════════════════════════════════════════════════════════════════
   5) GÖZLEM (CAROS LAB — salt-okunur, KOORDİNAT TAŞIMAZ)
   ══════════════════════════════════════════════════════════════════════════ */

export interface GraphResidencySnapshot {
  readonly state: GraphResidencyState;
  /** Kaç yüzey grafı tutuyor (dengeli ömür kanıtı). */
  readonly holders: number;
  /** Kaç kez indirme+ayrıştırma denendi. */
  readonly loadCount: number;
  readonly nodeCount: number | null;
  readonly edgeCount: number | null;
  readonly version: 1 | 2 | 3 | null;
  readonly bytes: number | null;
  /** Ayrıştırma süresi (ms) — `null` = ölçülemedi. */
  readonly parseMs: number | null;
  /** Komşuluk kuruldu mu (tembel). */
  readonly adjacencyBuilt: boolean;
  /** Ters komşuluk kuruldu mu (tembel). */
  readonly reverseAdjacencyBuilt: boolean;
  /** Yakınlık indeksi kuruldu mu (tembel). */
  readonly spatialIndexBuilt: boolean;
  /** Makine-okur gerekçe/ayrıntı — `null` = hiç ölçülmedi. */
  readonly detail: string | null;
  /** Son ölçümün monotonik anı. */
  readonly observedAtMonoMs: number | null;
  readonly residentRegions: readonly string[];
}

export function getGraphResidencySnapshot(): GraphResidencySnapshot {
  const view = readRoutingGraphView();
  return {
    state: _state,
    holders: _holders,
    loadCount: _loadCount,
    nodeCount: view?.nodeCount ?? null,
    edgeCount: view?.edgeCount ?? null,
    version: view?.version ?? null,
    bytes: _bytes,
    parseMs: _parseMs === null ? null : Math.round(_parseMs),
    adjacencyBuilt: _adjacency !== null,
    reverseAdjacencyBuilt: _reverseAdjacency !== null,
    spatialIndexBuilt: _index !== null,
    detail: _detail,
    observedAtMonoMs: _observedAtMonoMs,
    residentRegions: _residentRegions,
  };
}

/** @internal testler arası izolasyon. */
export function _resetGraphResidencyForTest(): void {
  _state = 'UNINITIALIZED';
  _strongView = null;
  _weakView = null;
  _adjacency = null;
  _reverseAdjacency = null;
  _index = null;
  _inFlight = null;
  _holders = 0;
  _detail = null;
  _loadCount = 0;
  _parseMs = null;
  _bytes = null;
  _observedAtMonoMs = null;
  _residentRegions = [];
}

/** @internal testler için görünümü doğrudan kurar (ağ YOK). */
export function _setRoutingGraphViewForTest(view: RoutingGraphView | null): void {
  _strongView = view;
  _weakView = view ? new WeakRef(view) : null;
  _adjacency = null;
  _reverseAdjacency = null;
  _index = null;
  _state = view ? 'AVAILABLE' : 'UNINITIALIZED';
  _holders = view ? 1 : 0;
}
