export const TURKEY_GRAPH_MANIFEST_SCHEMA = 2;

export interface TurkeyGraphComponentArtifact {
  readonly schemaVersion: 1;
  readonly file: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly indexFile: string;
  readonly indexSha256: string;
  readonly indexByteSize: number;
  readonly indexEncoding: 'UINT32_LE_LOCAL_NODE_COMPONENT_INDEX';
  readonly count: number;
  readonly directedLinkCount: number;
  readonly portalComponentIds: readonly string[];
}

/**
 * ALT (landmark) dilimi — bölge grafının YANINDA dağıtılan OPSİYONEL kanıt.
 *
 * Bu artefakt bir OPTİMİZASYON KANITIDIR: rota otoritesi değildir, yokluğunda
 * rota yine çıkar (sezgisel coğrafi moda düşer). Bu yüzden manifest şeması
 * onu zorunlu kılmaz; ama VARSA kimliği graf sürümüne SIKI bağlanır —
 * uyumsuz çift asla kullanılmaz.
 */
export interface TurkeyGraphAltSlice {
  readonly schemaVersion: 1;
  readonly file: string;
  readonly sha256: string;
  readonly byteSize: number;
  /** Landmark seti kimliği: graf sürümü + landmark düğümleri üzerinden türer. */
  readonly landmarkSetId: string;
  readonly landmarkCount: number;
  readonly scaleM: number;
  readonly unreachableBucket: number;
  /** Dilim, bölgenin KENDİ düğüm sırasındadır; sayı tutmazsa kullanılamaz. */
  readonly nodeCount: number;
  readonly encoding: 'UINT16_LE_PER_NODE_LANDMARK_PAIR';
}

/** Landmark setinin köken kaydı — manifest düzeyinde TEK kez taşınır. */
export interface TurkeyGraphAltLandmarkSet {
  readonly schemaVersion: 1;
  readonly landmarkSetId: string;
  readonly landmarkCount: number;
  readonly scaleM: number;
  readonly unreachableBucket: number;
  readonly metric: 'ONEWAY_ONLY_BASE_COST_M';
  readonly selection: 'BACKBONE_CONSTRAINED_FARTHEST_POINT_REACHABILITY_VERIFIED';
  readonly buildTimestamp: string;
  readonly landmarks: readonly { readonly index: number; readonly nodeId: string;
    readonly lat: number; readonly lon: number }[];
}

export interface TurkeyGraphPortalV2 {
  readonly portalId: string;
  readonly portalNodeId: string;
  readonly sourceRegionId: string;
  readonly destinationRegionId: string;
  readonly sourceComponentId: string;
  readonly destinationComponentId: string;
  readonly traversalDirection: 'FORWARD' | 'REVERSE';
  readonly accessRole: 1 | 2;
  readonly incidentEdgeId: string;
  readonly sourceNodeId: string;
  readonly destinationNodeId: string;
  readonly provenance: 'OSM_DIRECTED_EDGE_TILE_CROSSING';
  readonly sourceHash: string;
}

export type TurkeyGraphNeighborClassification = 'ROUTABLE' | 'NON_ROUTABLE' | 'INVALID' | 'AMBIGUOUS';

export interface TurkeyGraphNeighborAudit {
  readonly total: number;
  readonly ROUTABLE: number;
  readonly NON_ROUTABLE: number;
  readonly INVALID: number;
  readonly AMBIGUOUS: number;
  readonly links: readonly { readonly sourceRegionId: string; readonly destinationRegionId: string; readonly classification: TurkeyGraphNeighborClassification }[];
}

export interface TurkeyGraphRegion {
  readonly regionId: string;
  readonly bbox: readonly [number, number, number, number];
  readonly graphFile: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly neighbors: readonly string[];
  readonly sourceHash: string;
  readonly components?: TurkeyGraphComponentArtifact;
  /** Bu bölgenin ALT dilimi — OPSİYONEL; yoksa rota coğrafi sezgiselle çıkar. */
  readonly alt?: TurkeyGraphAltSlice;
}

export interface TurkeyGraphManifest {
  readonly schemaVersion: 1 | 2;
  readonly datasetId: string;
  readonly country: 'TR';
  readonly source: string;
  readonly sourceTimestamp: string;
  readonly buildTimestamp: string;
  readonly policyVersion: string;
  readonly graphFormat: 'RTG3' | 'RTG4';
  readonly portalSchemaVersion?: 2;
  readonly portals?: readonly TurkeyGraphPortalV2[];
  readonly neighborAudit?: TurkeyGraphNeighborAudit;
  /** ALT landmark setinin kökeni — bölge dilimleri buna bağlanır. */
  readonly altLandmarkSet?: TurkeyGraphAltLandmarkSet;
  readonly regions: readonly TurkeyGraphRegion[];
}

export function validateTurkeyGraphManifest(value: unknown): TurkeyGraphManifest | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Partial<TurkeyGraphManifest>;
  if ((m.schemaVersion !== 1 && m.schemaVersion !== TURKEY_GRAPH_MANIFEST_SCHEMA) || m.country !== 'TR' ||
      (m.graphFormat !== 'RTG3' && m.graphFormat !== 'RTG4') || !Array.isArray(m.regions) || !m.regions.length) return null;
  if ((m.schemaVersion === 1) !== (m.graphFormat === 'RTG3')) return null;
  const ids = new Set(m.regions.map((r) => r.regionId));
  if (ids.size !== m.regions.length) return null;
  for (const r of m.regions) {
    if (!r.regionId || !Array.isArray(r.bbox) || r.bbox.length !== 4 || !r.graphFile ||
        !/^[a-f0-9]{64}$/.test(r.sha256) || r.byteSize <= 0 || r.nodeCount <= 0 ||
        r.edgeCount <= 0 || !Array.isArray(r.neighbors)) return null;
    if (r.neighbors.some((id: string) => !ids.has(id))) return null;
    for (const neighbor of r.neighbors) {
      const other = m.regions.find((candidate) => candidate.regionId === neighbor);
      if (!other?.neighbors.includes(r.regionId)) return null;
    }
  }
  if (m.schemaVersion === 2) {
    if (m.portalSchemaVersion !== 2 || !Array.isArray(m.portals) || !m.neighborAudit || !Array.isArray(m.neighborAudit.links)) return null;
    const componentsByRegion = new Map<string, Set<string>>();
    for (const region of m.regions) {
      const components = region.components;
      if (!components || components.schemaVersion !== 1 || !components.file || !/^[a-f0-9]{64}$/.test(components.sha256) ||
          !components.indexFile || !/^[a-f0-9]{64}$/.test(components.indexSha256) || components.indexByteSize !== region.nodeCount * 4 ||
          components.indexEncoding !== 'UINT32_LE_LOCAL_NODE_COMPONENT_INDEX' ||
          components.byteSize <= 0 || components.count <= 0 || components.directedLinkCount < 0 || !Array.isArray(components.portalComponentIds)) return null;
      const idsForRegion = new Set<string>();
      for (const id of components.portalComponentIds) {
        if (typeof id !== 'string' || !id.startsWith(`${region.regionId}:`) || idsForRegion.has(id)) return null;
        idsForRegion.add(id);
      }
      componentsByRegion.set(region.regionId, idsForRegion);
    }
    const portalIds = new Set<string>();
    const portalSemantics = new Map<string, string>();
    const portalPairs = new Set<string>();
    for (const portal of m.portals) {
      if (!/^p2:[a-f0-9]{64}$/.test(portal.portalId) || portalIds.has(portal.portalId) ||
          !ids.has(portal.sourceRegionId) || !ids.has(portal.destinationRegionId) || portal.sourceRegionId === portal.destinationRegionId ||
          !componentsByRegion.get(portal.sourceRegionId)?.has(portal.sourceComponentId) ||
          !componentsByRegion.get(portal.destinationRegionId)?.has(portal.destinationComponentId) ||
          (portal.traversalDirection !== 'FORWARD' && portal.traversalDirection !== 'REVERSE') ||
          (portal.accessRole !== 1 && portal.accessRole !== 2) || !portal.portalNodeId || !portal.incidentEdgeId ||
          !portal.sourceNodeId || !portal.destinationNodeId || portal.provenance !== 'OSM_DIRECTED_EDGE_TILE_CROSSING' ||
          !/^[a-f0-9]{64}$/.test(portal.sourceHash)) return null;
      portalIds.add(portal.portalId);
      const semanticKey = `${portal.sourceRegionId}>${portal.destinationRegionId}:${portal.incidentEdgeId}:${portal.traversalDirection}`;
      const semanticValue = `${portal.sourceComponentId}:${portal.destinationComponentId}:${portal.accessRole}:${portal.portalNodeId}`;
      const previous = portalSemantics.get(semanticKey);
      if (previous !== undefined && previous !== semanticValue) return null;
      portalSemantics.set(semanticKey, semanticValue);
      if (portal.accessRole === 1) portalPairs.add([portal.sourceRegionId, portal.destinationRegionId].sort().join('|'));
    }
    const audit = m.neighborAudit;
    if (!Number.isInteger(audit.total) || audit.total !== audit.links.length ||
        audit.ROUTABLE + audit.NON_ROUTABLE + audit.INVALID + audit.AMBIGUOUS !== audit.total) return null;
    const auditedPairs = new Set<string>();
    const counts: Record<TurkeyGraphNeighborClassification, number> = { ROUTABLE:0, NON_ROUTABLE:0, INVALID:0, AMBIGUOUS:0 };
    for (const link of audit.links) {
      if (!ids.has(link.sourceRegionId) || !ids.has(link.destinationRegionId) || link.sourceRegionId >= link.destinationRegionId ||
          !Object.hasOwn(counts, link.classification)) return null;
      const pair = `${link.sourceRegionId}|${link.destinationRegionId}`;
      if (auditedPairs.has(pair) || (link.classification === 'ROUTABLE') !== portalPairs.has(pair)) return null;
      auditedPairs.add(pair); counts[link.classification]++;
    }
    if (counts.ROUTABLE !== audit.ROUTABLE || counts.NON_ROUTABLE !== audit.NON_ROUTABLE ||
        counts.INVALID !== audit.INVALID || counts.AMBIGUOUS !== audit.AMBIGUOUS) return null;
    for (const region of m.regions) {
      const expected = new Set<string>();
      for (const pair of portalPairs) {
        const [a, b] = pair.split('|');
        if (a === region.regionId) expected.add(b); else if (b === region.regionId) expected.add(a);
      }
      if (region.neighbors.length !== expected.size || region.neighbors.some((id: string) => !expected.has(id))) return null;
    }
  }

  /* ── ALT (landmark) kanıtı — OPSİYONEL ama YARIM OLAMAZ ─────────────────
     ALT bir optimizasyon kanıtıdır; hiç olmayabilir. Ama manifest ALT iddia
     ediyorsa iddia TAM olmalıdır: set kaydı + her dilimin sete bağlı kimliği +
     bölge düğüm sayısıyla tutan boyut. Yarım/uyumsuz kanıt manifestin tamamını
     reddettirir — çünkü "bir kısmı doğru" bir alt sınır GÜVENLİ DEĞİLDİR. */
  const altSet = m.altLandmarkSet;
  const altRegions = m.regions.filter((region) => region.alt !== undefined);
  if (altSet !== undefined || altRegions.length > 0) {
    if (!altSet || altSet.schemaVersion !== 1 || !altSet.landmarkSetId ||
        !Number.isInteger(altSet.landmarkCount) || altSet.landmarkCount <= 0 ||
        !Number.isInteger(altSet.scaleM) || altSet.scaleM <= 0 ||
        !Number.isInteger(altSet.unreachableBucket) || altSet.unreachableBucket <= 0 ||
        altSet.metric !== 'ONEWAY_ONLY_BASE_COST_M' ||
        altSet.selection !== 'BACKBONE_CONSTRAINED_FARTHEST_POINT_REACHABILITY_VERIFIED' ||
        !Array.isArray(altSet.landmarks) || altSet.landmarks.length !== altSet.landmarkCount) return null;
    const seenIndex = new Set<number>();
    for (const landmark of altSet.landmarks) {
      if (!Number.isInteger(landmark.index) || landmark.index < 0 ||
          landmark.index >= altSet.landmarkCount || seenIndex.has(landmark.index) ||
          typeof landmark.nodeId !== 'string' || !landmark.nodeId ||
          !Number.isFinite(landmark.lat) || !Number.isFinite(landmark.lon)) return null;
      seenIndex.add(landmark.index);
    }
    for (const region of altRegions) {
      const alt = region.alt!;
      if (alt.schemaVersion !== 1 || !alt.file || !/^[a-f0-9]{64}$/.test(alt.sha256) ||
          alt.landmarkSetId !== altSet.landmarkSetId ||
          alt.landmarkCount !== altSet.landmarkCount || alt.scaleM !== altSet.scaleM ||
          alt.unreachableBucket !== altSet.unreachableBucket ||
          alt.encoding !== 'UINT16_LE_PER_NODE_LANDMARK_PAIR' ||
          alt.nodeCount !== region.nodeCount) return null;
      /* Boyut tek doğru değerdir: 24 B başlık + düğüm × landmark × 2 × 2 B. */
      if (alt.byteSize !== 24 + region.nodeCount * altSet.landmarkCount * 4) return null;
    }
  }
  return m as TurkeyGraphManifest;
}

export interface RegionalRouteCorridor {
  readonly originRegionId: string;
  readonly destinationRegionId: string;
  readonly requiredRegionIds: readonly string[];
}

/** Manifest komşuluk grafında en kısa bounded corridor'u seçer; coğrafi boşlukta fail-closed döner. */
export function selectRegionalRouteCorridor(
  manifest: TurkeyGraphManifest,
  origin: readonly [number, number],
  destination: readonly [number, number],
  maxRegions = 3,
): RegionalRouteCorridor | null {
  const contains = (bbox: readonly [number,number,number,number], point: readonly [number,number]) =>
    point[1] >= bbox[0] && point[1] <= bbox[2] && point[0] >= bbox[1] && point[0] <= bbox[3];
  const originRegion = manifest.regions.find((region) => contains(region.bbox, origin));
  const destinationRegion = manifest.regions.find((region) => contains(region.bbox, destination));
  if (!originRegion || !destinationRegion || maxRegions < 1) return null;
  const queue: string[][] = [[originRegion.regionId]];
  const visited = new Set<string>([originRegion.regionId]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    if (current === destinationRegion.regionId) {
      return { originRegionId:originRegion.regionId, destinationRegionId:destinationRegion.regionId, requiredRegionIds:path };
    }
    if (path.length >= maxRegions) continue;
    const region = manifest.regions.find((candidate) => candidate.regionId === current);
    for (const neighbor of region?.neighbors ?? []) if (!visited.has(neighbor)) {
      visited.add(neighbor); queue.push([...path, neighbor]);
    }
  }
  return null;
}

/** Pencere-yerel indeks ile bölge-yerel indeks arasındaki KESİN çeviri tablosu. */
export const REGION_WINDOW_NO_LOCAL = 0xffffffff;

/**
 * Bir residency penceresinin kimlik haritası.
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Birleştirilmiş görünümdeki düğüm/kenar sıra numaraları PENCEREYE özgüdür:
 * aynı yol, [A,B,C] penceresinde başka, [B,C,D] penceresinde başka bir ordinal
 * alır. Bounded on-demand A* pencere kaydırdığında canlı arama durumunu
 * taşımak zorundadır; bunu her seferinde kararlı kimlik (OSM id) üzerinden
 * yapmak lineer taramadır ve ölçekte imkânsızdır.
 *
 * Bu tablo çeviriyi O(1) yapar: `pencere ordinal → (bölge, bölge-yerel indeks)`
 * ve tersi. Bölge-yerel indeks pencereden BAĞIMSIZDIR (bölge dosyası aynı
 * baytlardır, SHA ile doğrulanır) — bu yüzden iki pencere arasındaki ortak
 * bölgeler üzerinden çeviri KESİNDİR, tahmin içermez.
 */
export interface RegionWindowIdentity {
  readonly regionIds: readonly string[];
  /** Bölge yuvası → (bölge-yerel düğüm → pencere ordinali). */
  readonly nodeLocalToMerged: readonly Uint32Array[];
  /** Bölge yuvası → (bölge-yerel kenar → pencere ordinali). */
  readonly edgeLocalToMerged: readonly Uint32Array[];
  /** Bölge yuvası → (pencere ordinali → bölge-yerel düğüm | NO_LOCAL). */
  readonly nodeMergedToLocal: readonly Uint32Array[];
  /** Bölge yuvası → (pencere ordinali → bölge-yerel kenar | NO_LOCAL). */
  readonly edgeMergedToLocal: readonly Uint32Array[];
}


/* ══════════════════════════════════════════════════════════════════════════
   BOUNDED ON-DEMAND ARAMA ZARFI (RTG4)

   ── PORTAL KORİDORU ROTA DEĞİLDİR ────────────────────────────────────────
   Aşağıdaki zarf yalnız BUDAMA KANITIDIR: hangi bölgelerin sırayla belleğe
   alınacağını söyler. Kullanıcının süreceği yol, her zaman kanonik kenar
   durumlu A*'ın ürettiği kenar dizisidir. Portal dizisi ASLA rota olarak
   yayınlanmaz (bu dosya geometri üretmez — üretemez de).
   ══════════════════════════════════════════════════════════════════════════ */

export interface CrossRegionSearchEnvelope {
  readonly originRegionId: string;
  readonly destinationRegionId: string;
  /** Yönlü Portal v2 kanıtıyla seçilmiş sıralı bölge koridoru. */
  readonly corridorRegionIds: readonly string[];
  /** Ardışık, örtüşen residency pencereleri (her biri ≤ `maxResidentRegions`). */
  readonly windows: readonly (readonly string[])[];
  /**
   * `windows[i]` → `windows[i+1]` geçişinde AŞILAN sınır: kaynak bölge, hedef
   * bölge ve o yönde geçiş veren portal düğümlerinin kararlı OSM kimlikleri.
   * A* bu düğümlere ulaştığında pencerenin kaydırılması GEREKTİĞİNİ bilir.
   */
  readonly transitions: readonly {
    readonly fromRegionId: string;
    readonly toRegionId: string;
    readonly portalNodeIds: readonly string[];
    /**
     * Bu geçişte AŞILMASI ZORUNLU coğrafi sınır — iki karo bbox'ının kesişimi
     * (`[lonMin, latMin, lonMax, latMax]`, bir kenarda dejenere).
     *
     * ── NEDEN KANITTIR ─────────────────────────────────────────────────────
     * Bölgeler coğrafi karolardır. `fromRegionId`den `toRegionId`ye geçen HER
     * yol poligonu bu doğru parçasını FİZİKSEL OLARAK KESER. Dolayısıyla bir
     * durumdan bu kutuya olan uzaklık, kalan yolun kabul edilebilir (asla
     * fazla tahmin etmeyen) bir ALT SINIRIDIR. Portal düğüm koordinatı
     * gerekmez; manifest bbox'ı yeter.
     */
    readonly boundaryBox: readonly [number, number, number, number];
    /**
     * Bu sınır AŞILDIKTAN sonra hedefe kalan yolun alt sınırı (m): sonraki
     * zorunlu sınırlar arasındaki en kısa mesafelerin toplamı + son sınırdan
     * hedefe en kısa mesafe.
     *
     * ── NE İŞE YARAR ───────────────────────────────────────────────────────
     * Kuş uçuşu sezgisel, koridor dolambaçlıyken kalan yolu ÇOK DÜŞÜK tahmin
     * eder ve A* geniş bir elips tarar. Bu terim aramayı UZAK hedefe değil
     * SIRADAKİ zorunlu sınıra yöneltir; pencere başına arama menzili
     * koridor genişliğine iner. Kabul edilebilirlik korunur → rota gerçeği
     * DEĞİŞMEZ, yalnız aynı rotaya daha az durum açarak varılır.
     */
    readonly remainingLowerBoundM: number;
  }[];
  readonly maxResidentRegions: number;
}

/** İki bbox'ın kesişimi; komşu karolarda bir kenarda dejenere dikdörtgendir. */
function _boxIntersection(
  a: readonly [number, number, number, number], b: readonly [number, number, number, number],
): [number, number, number, number] {
  return [
    Math.max(a[0], b[0]), Math.max(a[1], b[1]),
    Math.min(a[2], b[2]), Math.min(a[3], b[3]),
  ];
}

const _EARTH_R = 6_371_000;

function _havMeters(la1: number, lo1: number, la2: number, lo2: number): number {
  const rad = Math.PI / 180;
  const dLa = (la2 - la1) * rad, dLo = (lo2 - lo1) * rad;
  const h = Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) ** 2;
  return _EARTH_R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Nokta → bbox en kısa mesafesi (içerideyse 0). Kutu `[lonMin,latMin,lonMax,latMax]`. */
export function distanceToBoxM(
  lat: number, lon: number, box: readonly [number, number, number, number],
): number {
  const nearestLon = Math.min(Math.max(lon, box[0]), box[2]);
  const nearestLat = Math.min(Math.max(lat, box[1]), box[3]);
  return _havMeters(lat, lon, nearestLat, nearestLon);
}

/** İki bbox arasındaki en kısa mesafe (kesişiyorlarsa 0). */
function _boxToBoxM(
  a: readonly [number, number, number, number], b: readonly [number, number, number, number],
): number {
  const lonGap = Math.max(0, Math.max(a[0] - b[2], b[0] - a[2]));
  const latGap = Math.max(0, Math.max(a[1] - b[3], b[1] - a[3]));
  if (lonGap === 0 && latGap === 0) return 0;
  const lat = (Math.max(a[1], b[1]) + Math.min(a[3], b[3])) / 2;
  const lonM = lonGap * 111_320 * Math.cos(lat * (Math.PI / 180));
  const latM = latGap * 110_540;
  return Math.sqrt(lonM * lonM + latM * latM);
}

/**
 * Uçtan uca bölge koridorunu ve residency penceresi dizisini planlar.
 *
 * ── NEDEN BÖLGE DÜZEYİ YETMEZ (ÖLÇÜLDÜ) ──────────────────────────────────
 * Bölge komşuluk grafında en kısa yol KARAYOLUYLA geçilebilir olmak zorunda
 * değildir. İstanbul→Ankara için bölge düzeyi en kısa koridor
 * `tr-57-82 → tr-57-81 → tr-58-81` seçiyordu; bu dizi Marmara'yı kesiyor ve
 * Avrupa yakasından o sınıra ulaşan yol YOK. Arama 757 bin durum açıp
 * tükeniyordu: koridor "komşu" olduğu hâlde rota imkânsızdı.
 *
 * ── BU YÜZDEN BİLEŞEN DÜZEYİ ─────────────────────────────────────────────
 * Arama yönlü Portal v2 kayıtları üzerinde BİLEŞENDEN BİLEŞENE yürür. Bir
 * bölgeye hangi güçlü bağlı bileşenden GİRİLDİYSE, o bölgeden ancak AYNI
 * bileşene ait bir portalla ÇIKILABİLİR. Bileşen içi karşılıklı erişilebilirlik
 * tanım gereği garantidir; böylece koridor artık "komşuluk" değil GERÇEK
 * SÜRÜLEBİLİRLİK kanıtı taşır.
 *
 * Bölge içi bileşen-arası (condensation) bağlar bu planlamada KULLANILMAZ —
 * onlar manifestte değil ayrı artefakttadır. Sonuç bilinçli olarak TUTUCUdur:
 * bulunan koridor sürülebilir; bulunamazsa uydurulmaz, fail-closed edilir.
 *
 * `selectRegionalRouteCorridor` KALDIRILMADI: koridor tavana sığdığında
 * kullanılan tek-pencere yolu ve davranışı DEĞİŞMEDİ.
 */
export function planCrossRegionSearchEnvelope(
  manifest: TurkeyGraphManifest,
  origin: readonly [number, number],
  destination: readonly [number, number],
  maxResidentRegions: number,
): CrossRegionSearchEnvelope | null {
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.portals) || maxResidentRegions < 1) return null;
  const contains = (bbox: readonly [number, number, number, number], point: readonly [number, number]) =>
    point[1] >= bbox[0] && point[1] <= bbox[2] && point[0] >= bbox[1] && point[0] <= bbox[3];
  const originRegion = manifest.regions.find((region) => contains(region.bbox, origin));
  const destinationRegion = manifest.regions.find((region) => contains(region.bbox, destination));
  if (!originRegion || !destinationRegion) return null;

  if (originRegion.regionId === destinationRegion.regionId) {
    return {
      originRegionId: originRegion.regionId, destinationRegionId: destinationRegion.regionId,
      corridorRegionIds: [originRegion.regionId], windows: [[originRegion.regionId]],
      transitions: [], maxResidentRegions,
    };
  }

  /* Yönlü bileşen komşuluğu — YALNIZ olağan erişim. Destination-only geçiş bir
     sınır KANITIdır ama transit koridor yetkisi DEĞİLDİR; onu koridora almak
     servis yolunu ülke geçişi yapmak olurdu. */
  const arcs = new Map<string, { component: string; portal: TurkeyGraphPortalV2 }[]>();
  for (const portal of manifest.portals) {
    if (portal.accessRole !== 1) continue;
    const bucket = arcs.get(portal.sourceComponentId);
    const arc = { component: portal.destinationComponentId, portal };
    if (bucket) bucket.push(arc); else arcs.set(portal.sourceComponentId, [arc]);
  }
  const regionOfComponent = (componentId: string) => componentId.slice(0, componentId.indexOf(':'));

  /* Başlangıç bileşeni bilinmiyor (bileşen indeksi ayrı artefakttadır), bu
     yüzden köken bölgesinin TÜM bileşenleri kaynak alınır. İzin genişliği
     yalnız İLK adımdadır; sonraki her adım bileşen sürekliliğine tabidir. */
  const sources = (originRegion.components?.portalComponentIds ?? [])
    .filter((id) => arcs.has(id));
  if (!sources.length) return null;

  const previous = new Map<string, { component: string; portal: TurkeyGraphPortalV2 }>();
  const seen = new Set<string>(sources);
  const queue = [...sources];
  let goal: string | null = null;
  for (let cursor = 0; cursor < queue.length && goal === null; cursor++) {
    const current = queue[cursor];
    for (const arc of arcs.get(current) ?? []) {
      if (seen.has(arc.component)) continue;
      seen.add(arc.component);
      previous.set(arc.component, { component: current, portal: arc.portal });
      if (regionOfComponent(arc.component) === destinationRegion.regionId) { goal = arc.component; break; }
      queue.push(arc.component);
    }
  }
  if (goal === null) return null;                 // fail-closed: sürülebilir kanıt yok

  const componentPath: string[] = [goal];
  while (!sources.includes(componentPath[0])) {
    const step = previous.get(componentPath[0]);
    if (!step) return null;
    componentPath.unshift(step.component);
  }
  const corridorRegionIds = componentPath.map(regionOfComponent);
  if (new Set(corridorRegionIds).size !== corridorRegionIds.length) return null;   // tekrar eden bölge → fail-closed

  /* Pencereler ardışık ve ÖRTÜŞENDİR: [R0,R1,R2] → [R1,R2,R3] … Böylece her
     kaydırmada iki bölge yerinde kalır; canlı arama durumunun büyük kısmı
     kararlı kimliğe düşmeden, bölge-yerel indeksle KESİN olarak taşınır. */
  const windows: string[][] = [];
  if (corridorRegionIds.length <= maxResidentRegions) windows.push([...corridorRegionIds]);
  else for (let i = 0; i + maxResidentRegions <= corridorRegionIds.length; i++) {
    windows.push(corridorRegionIds.slice(i, i + maxResidentRegions));
  }

  /* Geçiş kanıtı SEÇİLEN bileşen çiftine aittir: aynı bölge çiftinde başka
     bileşenlere giden portallar bu koridorun sınırı DEĞİLDİR. */
  const nodesForPair = (from: string, to: string): string[] => {
    const nodes = new Set<string>();
    for (const portal of manifest.portals ?? []) {
      if (portal.accessRole !== 1) continue;
      if (portal.sourceComponentId !== from || portal.destinationComponentId !== to) continue;
      nodes.add(portal.sourceNodeId);
    }
    return [...nodes];
  };
  const boxOf = (regionId: string) =>
    manifest.regions.find((region) => region.regionId === regionId)!.bbox as
      readonly [number, number, number, number];
  const partial = windows.slice(0, -1).map((_window, i) => {
    /* Tetik pencerenin ÖNCÜ bölgesinde DEĞİL, bir SONRAKİ karo sınırındadır.
       Öncü sınırı hedeflemek, aramanın her pencerede ~2,5 karo boyu ilerlemesi
       demekti ve sezgisel hedefi 110 km uzağa taşıyordu; yakın sınır hedefi
       pencere başına taranan alanı belirgin küçültür. Gereken graf zaten
       yerleşiktir → ek yükleme YOK. */
    const step = i + 1;
    return {
      fromRegionId: corridorRegionIds[step],
      toRegionId: corridorRegionIds[step + 1],
      portalNodeIds: nodesForPair(componentPath[step], componentPath[step + 1]),
      boundaryBox: _boxIntersection(boxOf(corridorRegionIds[step]), boxOf(corridorRegionIds[step + 1])),
    };
  });
  if (partial.some((t) => t.portalNodeIds.length === 0)) return null;   // fail-closed

  /* Kalan alt sınır SONDAN başa toplanır. Her terim iki ZORUNLU sınır arasındaki
     en kısa mesafedir; hiçbiri gerçek yoldan uzun olamaz → toplam kabul
     edilebilir bir alt sınırdır (asla fazla tahmin etmez). */
  const remaining = new Array<number>(partial.length).fill(0);
  for (let i = partial.length - 1; i >= 0; i--) {
    remaining[i] = i === partial.length - 1
      ? distanceToBoxM(destination[0], destination[1], partial[i].boundaryBox)
      : _boxToBoxM(partial[i].boundaryBox, partial[i + 1].boundaryBox) + remaining[i + 1];
  }
  const transitions = partial.map((t, i) => ({ ...t, remainingLowerBoundM: remaining[i] }));

  return {
    originRegionId: originRegion.regionId,
    destinationRegionId: destinationRegion.regionId,
    corridorRegionIds, windows, transitions, maxResidentRegions,
  };
}
