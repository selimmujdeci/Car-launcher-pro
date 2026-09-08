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
  mergeRegionalGraphViews, mergeRegionalGraphWindow, validateTurkeyGraphManifest,
  type RegionWindowIdentity, type TurkeyGraphManifest, type TurkeyGraphRegion,
  type TurkeyGraphAltLandmarkSet,
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
/* On-demand pencere sayaclari — LAB gozlemi ve butce KANITI (uydurma yok). */
let _residentGraphBytes = 0;
let _peakResidentRegions = 0;
let _peakResidentGraphBytes = 0;
let _onDemandRegionLoads = 0;
let _regionEvictions = 0;
let _windowFailClosedReason: string | null = null;

/* ── ALT (landmark) dilim sakinliği ──────────────────────────────────────
   ALT, grafın YANINDA yaşayan OPSİYONEL bir kanıttır. Baytı grafın 64 MiB
   bütçesine KARIŞTIRILMAZ: ayrı sayılır, ayrı raporlanır. Kendi tavanı bu
   fazda ÜRETİLMEZ — cihazda ölçülmemiş bir sayıyı ürün tavanı yapmak,
   anayasanın "bütçesiz/kanıtsız özellik" yasağına girer. Bunun yerine ALT
   dilimleri bölgenin ÖMRÜNE bağlanır: bölge tahliye edilince dilim de düşer,
   dolayısıyla ALT belleği yerleşik bölge sayısıyla (≤3) SINIRLIDIR. */
const _altSliceCache = new Map<string, Uint16Array>();
let _altResidentBytes = 0;
let _altPeakResidentBytes = 0;
let _altSliceLoads = 0;
let _altSliceEvictions = 0;
/** ALT neden kullanılamadı — başarı hâlinde `null` (sahte "açık" YOK). */
let _altUnavailableReason: string | null = null;

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
      const expectedVersion = manifest.graphFormat === 'RTG4' ? 4 : 3;
      if (parsed.outcome !== 'OK' || !parsed.view || parsed.view.version !== expectedVersion) {
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

/* ══════════════════════════════════════════════════════════════════════════
   3b) BOUNDED ON-DEMAND PENCERE SAKİNLİĞİ (RTG4)

   ── GRAF SAKİNLİĞİ ≠ ARAMA SAKİNLİĞİ ─────────────────────────────────────
   Burada YALNIZ büyük tipli diziler (bölge grafı) yaşar ve ölür. Kanonik A*
   arama durumu (frontier · gScore · yeniden kurma kaydı) worker'da durur ve
   bölge tahliyesinden SAĞ ÇIKAR. Bir bölgeyi "öncül bilgisi lazım olabilir"
   diye bellekte TUTMAK bu yüzden gereksizdir ve yapılmaz.

   Bütçe pazarlıksızdır: en fazla `REGIONAL_GRAPH_MAX_RESIDENT` bölge ve
   `REGIONAL_GRAPH_MAX_BYTES` bayt. Meşru bir rota bu sınırda ilerleyemiyorsa
   sınır büyütülmez — FAIL-CLOSED edilir ve ölçülen engel bildirilir.
   ══════════════════════════════════════════════════════════════════════════ */

/** Ayrıştırılmış bölge önbelleği — pencere kayarken KALAN bölge yeniden indirilmez. */
const _regionCache = new Map<string, { view: RoutingGraphView; bytes: number }>();

export interface RegionWindowResidency {
  readonly view: RoutingGraphView;
  readonly identity: RegionWindowIdentity;
  readonly regionIds: readonly string[];
  /** Yerleşik bölge ikili artefakt baytları (bütçenin ölçüldüğü büyüklük). */
  readonly graphBytes: number;
  /** Bu çağrıda AĞDAN yüklenen bölgeler (önbellekten gelen sayılmaz). */
  readonly loadedRegionIds: readonly string[];
  readonly evictedRegionIds: readonly string[];
  /**
   * Pencerenin ALT kanıtı — `null` ise arama coğrafi sezgiselle koşar.
   * Dizi PENCERE düğüm sırasındadır: worker ek eşleme yapmaz.
   */
  readonly alt: RegionWindowAlt | null;
}

export interface RegionWindowAlt {
  readonly window: Uint16Array;
  readonly landmarkCount: number;
  readonly scaleM: number;
  readonly unreachableBucket: number;
  readonly landmarkSetId: string;
  /** Bu pencerenin dilimlerinin toplam baytı (graf baytından AYRI). */
  readonly bytes: number;
  readonly regionIds: readonly string[];
}

async function _fetchRegionView(
  region: TurkeyGraphRegion, expectedVersion: 3 | 4, baseUrl: string,
): Promise<{ view: RoutingGraphView; bytes: number } | null> {
  const graphUrl = `${baseUrl.replace(/\/$/, '')}/${region.graphFile.replace(/^\//, '')}`;
  const res = await fetch(graphUrl);
  if (!res.ok) { _report('MISSING', `${region.regionId}: HTTP ${res.status}`); return null; }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength !== region.byteSize || await _sha256(buffer) !== region.sha256) {
    _report('CORRUPT', `${region.regionId}: SHA/boyut uyumsuz`); return null;
  }
  const parsed = parseRoutingGraph(buffer);
  if (parsed.outcome !== 'OK' || !parsed.view || parsed.view.version !== expectedVersion) {
    _report('CORRUPT', `${region.regionId}: ${parsed.outcome}`); return null;
  }
  return { view: parsed.view, bytes: buffer.byteLength };
}

const ALT_MAGIC = 0x414c5431;                 // "ALT1"
const ALT_HEADER_BYTES = 24;

/**
 * Bir bölgenin ALT dilimini indirir ve KİMLİĞİNİ doğrular.
 *
 * Doğrulama TAMDIR: boyut · SHA · sihirli sayı · şema · landmark sayısı ·
 * ölçek · düğüm sayısı. Biri bile tutmazsa `null` döner — KISMEN geçerli veri
 * TÜKETİLMEZ, çünkü yanlış bir alt sınır rotayı bozabilir.
 */
async function _fetchAltSlice(
  region: TurkeyGraphRegion, set: TurkeyGraphAltLandmarkSet, baseUrl: string,
): Promise<Uint16Array | null> {
  const alt = region.alt;
  if (!alt) { _altUnavailableReason = `ALT_SLICE_ABSENT:${region.regionId}`; return null; }
  const url = `${baseUrl.replace(/\/$/, '')}/${alt.file.replace(/^\//, '')}`;
  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url);
    if (!res.ok) { _altUnavailableReason = `ALT_HTTP_${res.status}:${region.regionId}`; return null; }
    buffer = await res.arrayBuffer();
  } catch {
    _altUnavailableReason = `ALT_FETCH_FAILED:${region.regionId}`;
    return null;
  }
  if (buffer.byteLength !== alt.byteSize) {
    _altUnavailableReason = `ALT_SIZE_MISMATCH:${region.regionId}`; return null;
  }
  if (await _sha256(buffer) !== alt.sha256) {
    _altUnavailableReason = `ALT_SHA_MISMATCH:${region.regionId}`; return null;
  }
  const header = new Uint32Array(buffer.slice(0, ALT_HEADER_BYTES));
  if (header[0] !== ALT_MAGIC || header[1] !== alt.schemaVersion ||
      header[2] !== set.landmarkCount || header[3] !== set.scaleM ||
      header[4] !== region.nodeCount || header[5] !== set.unreachableBucket) {
    _altUnavailableReason = `ALT_HEADER_MISMATCH:${region.regionId}`; return null;
  }
  const body = new Uint16Array(buffer.slice(ALT_HEADER_BYTES));
  if (body.length !== region.nodeCount * set.landmarkCount * 2) {
    _altUnavailableReason = `ALT_BODY_TRUNCATED:${region.regionId}`; return null;
  }
  return body;
}

/**
 * Koridorun BİR penceresini yerleşik hâle getirir (talep üzerine).
 *
 * Pencerede olmayan her bölge TAHLİYE EDİLİR — "belki lazım olur" diye tutmak
 * bütçeyi sessizce şişirirdi. Tahliye güvenlidir çünkü arama durumu buraya
 * değil worker'a aittir ve kararlı/bölge-yerel kimlikle taşınır.
 */
export async function acquireRegionWindow(
  manifestValue: unknown, regionIds: readonly string[], baseUrl = '/maps/rtg3/',
  options: {
    /**
     * ALT dilimi bu pencere için İSTENİYOR mu? Varsayılan `false`: bölge içi
     * (tek pencereli) rota landmark sınırını KULLANMAZ, dolayısıyla dilimi
     * indirmesi de saf maliyettir (ölçüldü: Mersin→Adana'da 6,5 MB boşuna).
     * Karar rota katmanınındır; residency kendi başına ALT talep etmez.
     */
    readonly alt?: boolean;
  } = {},
): Promise<RegionWindowResidency | null> {
  _windowFailClosedReason = null;
  const manifest: TurkeyGraphManifest | null = validateTurkeyGraphManifest(manifestValue);
  if (!manifest || regionIds.length < 1 || regionIds.length > REGIONAL_GRAPH_MAX_RESIDENT) {
    _windowFailClosedReason = 'WINDOW_REGION_BUDGET';
    _report('UNSUPPORTED', 'pencere bölge bütçesi geçersiz');
    return null;
  }
  const selected: TurkeyGraphRegion[] = [];
  for (const id of regionIds) {
    const region = manifest.regions.find((candidate) => candidate.regionId === id);
    if (!region) {
      _windowFailClosedReason = 'WINDOW_REGION_MISSING';
      _report('MISSING', `pencere bölgesi manifestte yok: ${id}`);
      return null;
    }
    selected.push(region);
  }
  const graphBytes = selected.reduce((total, region) => total + region.byteSize, 0);
  if (graphBytes > REGIONAL_GRAPH_MAX_BYTES) {
    _windowFailClosedReason = 'WINDOW_BYTE_BUDGET';
    _report('UNSUPPORTED', `pencere ${graphBytes} B > ${REGIONAL_GRAPH_MAX_BYTES} B`);
    return null;
  }

  /* TAHLİYE ÖNCE: yeni pencereyi yüklerken eski bölgeleri de tutmak, tavanı
     anlık olarak iki katına çıkarırdı. Bütçe "ortalama" değil, HER AN geçerlidir. */
  const wanted = new Set(regionIds);
  const evictedRegionIds: string[] = [];
  for (const id of [..._regionCache.keys()]) if (!wanted.has(id)) {
    _regionCache.delete(id); evictedRegionIds.push(id); _regionEvictions++;
  }
  /* ALT dilimi bölgeyle BİRLİKTE düşer: grafı gitmiş bir bölgenin landmark
     dilimini tutmak, ölçülmeyen bir bellek sızıntısı olurdu. */
  for (const id of [..._altSliceCache.keys()]) if (!wanted.has(id)) {
    _altSliceCache.delete(id); _altSliceEvictions++;
  }

  const expectedVersion = manifest.graphFormat === 'RTG4' ? 4 : 3;
  const loadedRegionIds: string[] = [];
  _state = 'LOADING'; _loadCount++;
  for (const region of selected) {
    if (_regionCache.has(region.regionId)) continue;
    const loaded = await _fetchRegionView(region, expectedVersion, baseUrl);
    if (!loaded) { _windowFailClosedReason = 'WINDOW_REGION_LOAD'; return null; }
    _regionCache.set(region.regionId, loaded);
    loadedRegionIds.push(region.regionId);
    _onDemandRegionLoads++;
  }

  const merged = mergeRegionalGraphWindow(regionIds.map((id) => _regionCache.get(id)!.view), regionIds);
  if (!merged) {
    _windowFailClosedReason = 'WINDOW_MERGE_FAILED';
    _report('CORRUPT', 'pencere portal kimlikleri birleştirilemedi');
    return null;
  }

  /* ── ALT dilimleri — bölgenin ÖMRÜNE bağlı, GRAF BAYTINDAN AYRI ────────
     Politika BİLEREK basit: pencerenin BÜTÜN bölgeleri uyumlu dilim
     sağlayamıyorsa ALT hiç kullanılmaz. Karışık durumda "eksik bölgede sınır
     0 olur, yine kabul edilebilir" doğrudur ama arama profili (daha düşük
     ağırlık) tüm rota için tek seçilir; yarım kanıtla o profili seçmek
     bütçeyi riske atardı. Kanıt tamsa tam, değilse hiç. */
  const altSet = options.alt === true ? manifest.altLandmarkSet : undefined;
  let alt: RegionWindowAlt | null = null;
  if (options.alt !== true) {
    /* DAHA SPESİFİK bir sebep varsa (ör. hedef satırı çözülemedi) ÜSTÜNE
       YAZILMAZ: gözlemde kök neden kaybolmamalı. */
    if (_altUnavailableReason === null) _altUnavailableReason = 'ALT_NOT_REQUESTED';
  } else if (altSet !== undefined) {
    const slices: Uint16Array[] = [];
    let ok = true;
    for (const region of selected) {
      const cached = _altSliceCache.get(region.regionId);
      if (cached) { slices.push(cached); continue; }
      const loaded = await _fetchAltSlice(region, altSet, baseUrl);
      if (!loaded) { ok = false; break; }
      _altSliceCache.set(region.regionId, loaded);
      _altSliceLoads++;
      slices.push(loaded);
    }
    if (ok) {
      const k = altSet.landmarkCount;
      const window = new Uint16Array(merged.view.nodeCount * k * 2)
        .fill(altSet.unreachableBucket);
      for (let slot = 0; slot < regionIds.length; slot++) {
        const slice = slices[slot];
        const localToMerged = merged.identity.nodeLocalToMerged[slot];
        for (let local = 0; local < localToMerged.length; local++) {
          const target = localToMerged[local];
          if (target >= merged.view.nodeCount) continue;
          const src = local * k * 2, dst = target * k * 2;
          for (let i = 0; i < k * 2; i++) window[dst + i] = slice[src + i];
        }
      }
      const bytes = slices.reduce((total, slice) => total + slice.byteLength, 0);
      alt = {
        window, landmarkCount: k, scaleM: altSet.scaleM,
        unreachableBucket: altSet.unreachableBucket, landmarkSetId: altSet.landmarkSetId,
        bytes, regionIds: [...regionIds],
      };
      _altUnavailableReason = null;
    }
  } else {
    _altUnavailableReason = 'ALT_SET_ABSENT';
  }
  _altResidentBytes = alt?.bytes ?? 0;
  _altPeakResidentBytes = Math.max(_altPeakResidentBytes, _altResidentBytes);

  _strongView = merged.view; _weakView = new WeakRef(merged.view);
  _adjacency = null; _reverseAdjacency = null; _index = null;
  _bytes = graphBytes; _residentGraphBytes = graphBytes;
  _residentRegions = [...regionIds];
  _peakResidentRegions = Math.max(_peakResidentRegions, regionIds.length);
  _peakResidentGraphBytes = Math.max(_peakResidentGraphBytes, graphBytes);
  _report('AVAILABLE', `RTG4 window: ${_residentRegions.join(',')}`);
  return {
    view: merged.view, identity: merged.identity, regionIds: [...regionIds],
    graphBytes, loadedRegionIds, evictedRegionIds, alt,
  };
}

export interface AltTargetRowResult {
  readonly fromLandmark: Uint16Array;
  readonly toLandmark: Uint16Array;
  /** Satırın ait olduğu düğümün KARARLI OSM kimliği — worker doğrular. */
  readonly targetNodeId: string;
  readonly landmarkCount: number;
  readonly scaleM: number;
  readonly unreachableBucket: number;
  readonly landmarkSetId: string;
}

/**
 * HEDEF LANDMARK SATIRI — ALT sezgiseli ilk pencereden itibaren hedefin
 * landmark mesafelerini bilmek zorundadır, ama hedef bölgesi ancak SON
 * pencerede yerleşik olur. Bu yüzden hedef bölgeleri burada BİR KEZ,
 * pencere sakinliğini KİRLETMEDEN okunur.
 *
 * Hedef düğüm seçimi worker'ın `_nearest` mantığıyla AYNI ölçütü kullanır
 * (en küçük mesafe, eşitlikte ilk düğüm). Yine de satır, düğümün kararlı OSM
 * kimliğiyle birlikte gönderilir: worker son pencerede kendi bulduğu hedefle
 * karşılaştırır, tutmuyorsa ALT'yi KAPATIR. Yani buradaki seçim yanlışsa
 * sonuç bozulmaz, yalnız hızlanma kaybolur.
 *
 * Okunamayan/uyumsuz her durumda `null` döner → çağıran GEOMETRIC moda düşer.
 */
export async function resolveAltTargetRow(
  manifestValue: unknown, regionIds: readonly string[],
  lat: number, lon: number, baseUrl = '/maps/rtg3/',
): Promise<AltTargetRowResult | null> {
  const manifest = validateTurkeyGraphManifest(manifestValue);
  const set = manifest?.altLandmarkSet;
  if (!manifest || !set) { _altUnavailableReason = 'ALT_SET_ABSENT'; return null; }
  const k = set.landmarkCount;
  let bestDistance = Infinity, bestNodeId: string | null = null;
  let bestFrom: Uint16Array | null = null, bestTo: Uint16Array | null = null;
  for (const regionId of regionIds) {
    const region = manifest.regions.find((candidate) => candidate.regionId === regionId);
    if (!region?.alt) { _altUnavailableReason = `ALT_TARGET_REGION_SLICE_ABSENT:${regionId}`; return null; }
    const cachedView = _regionCache.get(regionId)?.view ?? null;
    const view = cachedView ?? (await _fetchRegionView(
      region, manifest.graphFormat === 'RTG4' ? 4 : 3, baseUrl))?.view ?? null;
    if (!view) { _altUnavailableReason = `ALT_TARGET_REGION_LOAD:${regionId}`; return null; }
    const slice = _altSliceCache.get(regionId) ?? await _fetchAltSlice(region, set, baseUrl);
    if (!slice) return null;                        // sebep `_fetchAltSlice`te yazıldı
    let localBest = -1, localBestDistance = Infinity;
    for (let i = 0; i < view.nodeCount; i++) {
      const dLat = (view.nodeLat[i] - lat) * 111_000;
      const dLon = (view.nodeLon[i] - lon) * 111_000 * Math.cos(lat * (Math.PI / 180));
      const distance = dLat * dLat + dLon * dLon;
      if (distance < localBestDistance) { localBestDistance = distance; localBest = i; }
    }
    if (localBest < 0 || localBestDistance >= bestDistance) continue;
    bestDistance = localBestDistance;
    bestNodeId = String(view.nodeSourceId[localBest]);
    const fromLandmark = new Uint16Array(k), toLandmark = new Uint16Array(k);
    for (let i = 0; i < k; i++) {
      fromLandmark[i] = slice[(localBest * k + i) * 2];
      toLandmark[i] = slice[(localBest * k + i) * 2 + 1];
    }
    bestFrom = fromLandmark; bestTo = toLandmark;
  }
  if (!bestNodeId || !bestFrom || !bestTo) {
    _altUnavailableReason = 'ALT_TARGET_NODE_UNRESOLVED';
    return null;
  }
  return {
    fromLandmark: bestFrom, toLandmark: bestTo, targetNodeId: bestNodeId,
    landmarkCount: k, scaleM: set.scaleM, unreachableBucket: set.unreachableBucket,
    landmarkSetId: set.landmarkSetId,
  };
}

/**
 * ALT'nin HİÇ DENENMEDİĞİNİ kaydeder (bozukluk DEĞİL, uygunluk kararı).
 * Gözlemde "ALT bozuk" ile "ALT gerekmedi" birbirine karışmamalıdır.
 */
export function markAltNotAttempted(reason: string): void {
  _altUnavailableReason = reason;
}

/** Pencere sakinliğini tamamen bırakır (Zero-Leak); sayaçlar gözlem için kalır. */
export function releaseRegionWindow(): void {
  _regionEvictions += _regionCache.size;
  _regionCache.clear();
  /* ALT dilimleri de bırakılır — bölge gitmişken landmark dilimini tutmak
     ölçülmeyen bir bellek borcu olurdu (Zero-Leak). */
  _altSliceEvictions += _altSliceCache.size;
  _altSliceCache.clear();
  _altResidentBytes = 0;
  _residentRegions = [];
  _residentGraphBytes = 0;
  _strongView = null; _weakView = null;
  _adjacency = null; _reverseAdjacency = null; _index = null;
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
  readonly version: 1 | 2 | 3 | 4 | null;
  readonly bytes: number | null;
  /** Ayrıştırma süresi (ms) — `null` = ölçülemedi. */
  readonly parseMs: number | null;
  /** Komşuluk kuruldu mu (tembel). */
  readonly adjacencyBuilt: boolean;
  /** Ters komşuluk kuruldu mu (tembel). */
  readonly reverseAdjacencyBuilt: boolean;
  /** Yakınlık indeksi kuruldu mu (tembel). */
  readonly spatialIndexBuilt: boolean;
  /** RTG3 dönüş kısıtı kayıt sayısı — `null` = graf çözülmedi (sahte 0 YOK). */
  readonly restrictionCount: number | null;
  /** Via-way zincir sayısı; RTG3 grafta kayıt yoksa 0, çözülmediyse `null`. */
  readonly viaWayChainCount: number | null;
  /** Makine-okur gerekçe/ayrıntı — `null` = hiç ölçülmedi. */
  readonly detail: string | null;
  /** Son ölçümün monotonik anı. */
  readonly observedAtMonoMs: number | null;
  readonly residentRegions: readonly string[];
  /** Yerleşik bölge ikili baytı — bütçe kanıtı. */
  readonly residentGraphBytes: number;
  readonly peakResidentRegions: number;
  readonly peakResidentGraphBytes: number;
  readonly maxResidentRegions: number;
  readonly maxResidentGraphBytes: number;
  readonly onDemandRegionLoads: number;
  readonly regionEvictions: number;
  /** Son pencere reddinin makine-okur nedeni — başarı hâlinde `null`. */
  readonly windowFailClosedReason: string | null;
  /* ── ALT (landmark) dilim sakinliği — GRAF BAYTINDAN AYRI ─────────────── */
  /** Yerleşik ALT dilimlerinin toplam baytı; ALT yoksa 0 (sahte tahmin YOK). */
  readonly altResidentBytes: number;
  readonly altPeakResidentBytes: number;
  readonly altSliceLoads: number;
  readonly altSliceEvictions: number;
  /** ALT neden kullanılamadı — kullanılabiliyorsa `null`. */
  readonly altUnavailableReason: string | null;
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
    restrictionCount: view?.restrictionCount ?? null,
    viaWayChainCount: view ? (view.viaWay?.chainCount ?? 0) : null,
    detail: _detail,
    observedAtMonoMs: _observedAtMonoMs,
    residentRegions: _residentRegions,
    residentGraphBytes: _residentGraphBytes,
    peakResidentRegions: _peakResidentRegions,
    peakResidentGraphBytes: _peakResidentGraphBytes,
    maxResidentRegions: REGIONAL_GRAPH_MAX_RESIDENT,
    maxResidentGraphBytes: REGIONAL_GRAPH_MAX_BYTES,
    onDemandRegionLoads: _onDemandRegionLoads,
    regionEvictions: _regionEvictions,
    windowFailClosedReason: _windowFailClosedReason,
    altResidentBytes: _altResidentBytes,
    altPeakResidentBytes: _altPeakResidentBytes,
    altSliceLoads: _altSliceLoads,
    altSliceEvictions: _altSliceEvictions,
    altUnavailableReason: _altUnavailableReason,
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
  _regionCache.clear();
  _residentGraphBytes = 0;
  _peakResidentRegions = 0;
  _peakResidentGraphBytes = 0;
  _onDemandRegionLoads = 0;
  _regionEvictions = 0;
  _windowFailClosedReason = null;
  _altSliceCache.clear();
  _altResidentBytes = 0;
  _altPeakResidentBytes = 0;
  _altSliceLoads = 0;
  _altSliceEvictions = 0;
  _altUnavailableReason = null;
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
