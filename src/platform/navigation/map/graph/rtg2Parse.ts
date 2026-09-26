/**
 * rtg2Parse — RTG1–4 AYRIŞTIRICISI ve RTG4 KARARLI KİMLİK KATMANI.
 *
 * ── NEDEN AYRI DOSYA (#1218) ─────────────────────────────────────────────
 * Bu dosyadaki kod `BigUint64Array` ve **BigInt literalleri** (`0n`) kullanır.
 * BigInt bir SÖZDİZİMİ özelliğidir: polyfill EDİLEMEZ. Chrome 52-79 WebView'lı
 * eski head unit, bu sözdizimini içeren bir chunk'ı ÇALIŞTIRMADAN ÖNCE, daha
 * parse aşamasında reddeder → uygulama boot ölümü.
 *
 * ÖLÇÜLEN KUSUR (kütük #1218): `parseRoutingGraph` statik import zinciriyle
 * (`map/store/index` → `mapStoreSources` → `graphResidencyRuntime`)
 * `plugin-legacy`'nin ES2015 hedefli **startup** chunk'ına (`useStore-legacy`)
 * giriyordu. Ölçüm: o chunk'ta tam olarak 1 BigInt literali; acorn ES2015
 * parse'ı `Identifier directly after number` ile düşüyordu.
 *
 * ── SINIR ────────────────────────────────────────────────────────────────
 * `rtg2Reader.ts` BigInt sözdiziminden ARINDIRILDI ve statik kalır (saf alan
 * okuyucuları her yerde gerekir). Bu dosya YALNIZ `import()` ile yüklenir
 * (`graphResidencyRuntime`, `regionalDataDistribution`) ya da Chrome 80+'a
 * kapılı modül worker'ından statik alınır (`NavigationCompute.worker`).
 * Yani eski WebView bu dosyayı ne fetch eder ne parse eder.
 *
 * SEMANTİK DEĞİŞMEDİ: tek bir `0n` bile `Number`a çevrilmedi; RTG4 kararlı
 * kimlik hassasiyeti 64-bit olarak KORUNUR. Değişen yalnız MODÜL SINIRIDIR.
 */

import {
  RTG2_MAGIC, RTG3_MAGIC, RTG4_MAGIC,
  RTG_NODE_STRIDE, RTG1_EDGE_STRIDE, RTG2_EDGE_STRIDE, RTG3_EDGE_STRIDE,
  RTG3_RESTRICTION_STRIDE, RTG4_RESTRICTION_STRIDE,
  RTG_MAX_EDGE_COUNT,
  RTG3_VIA_WAY_FLAG, RTG3_VIA_WAY_FINAL, RTG3_VIA_WAY_BASE_MASK,
  buildViaWayIndex, _inEdgeRange,
  type RoutingGraphView, type RtgParseOutcome, type RoutingGraphParseResult,
} from './rtg2Reader';


/** Cross-region canonical directed edge identity; ordinal is never part of it. */
export function stableDirectedEdgeId(view: RoutingGraphView, ordinal: number): string | null {
  if (view.version < 3 || !_inEdgeRange(view, ordinal)) return null;
  const from = view.nodeSourceId[view.edgeFrom[ordinal]], to = view.nodeSourceId[view.edgeTo[ordinal]];
  const way = view.edgeSourceWayId[ordinal];
  if (from === 0n || to === 0n || way === 0n) return null;
  return `${way}:${from}:${to}:${view.edgeDirection[ordinal]}`;
}

export function stableRestrictionId(view: RoutingGraphView, ordinal: number): string | null {
  if (view.version !== 4 || ordinal < 0 || ordinal >= view.restrictionCount) return null;
  const relation = view.restrictionRelationId?.[ordinal] ?? 0n;
  if (relation === 0n) return null;
  const from = stableDirectedEdgeId(view, view.restrictionFromEdge[ordinal]);
  const to = stableDirectedEdgeId(view, view.restrictionToEdge[ordinal]);
  if (!from || !to) return null;
  return `${relation}:${view.restrictionChainSeq[ordinal]}:${from}>${to}`;
}

export interface StableRtg3SearchState {
  readonly nodeId: bigint;
  readonly previousEdgeId: string | null;
  readonly activeRestrictionIds: readonly string[];
}

export interface LocalRtg3SearchState {
  readonly node: number;
  readonly previousEdge: number;
  readonly viaWayMask: number;
}

function _stableRestrictionIdForSlot(view: RoutingGraphView, packed: number): string | null {
  const index = view.viaWay;
  if (!index) return null;
  const chain = packed >>> 8, seq = packed & 0xff;
  if (chain >= index.chainCount || seq >= index.chainLength[chain]) return null;
  const link = index.chainStart[chain] + seq;
  let found: string | null = null;
  for (let i = 0; i < view.restrictionCount; i++) {
    if (view.restrictionChainSeq[i] !== seq ||
        view.restrictionFromEdge[i] !== index.linkFromEdge[link] ||
        view.restrictionToEdge[i] !== index.linkToEdge[link] ||
        view.restrictionViaNode[i] !== index.linkViaNode[link]) continue;
    const id = stableRestrictionId(view, i);
    if (!id || found !== null) return null;
    found = id;
  }
  return found;
}

/** Loaded local handles are disposable; this is the eviction-safe state seam. */
export function captureStableRtg3SearchState(
  view: RoutingGraphView, node: number, previousEdge: number, viaWayMask: number,
): StableRtg3SearchState | null {
  if (view.version !== 4 || node < 0 || node >= view.nodeCount) return null;
  const previousEdgeId = previousEdge < 0 ? null : stableDirectedEdgeId(view, previousEdge);
  if (previousEdge >= 0 && !previousEdgeId) return null;
  const activeRestrictionIds: string[] = [];
  if (viaWayMask !== 0) {
    if (previousEdge < 0 || !view.viaWay) return null;
    const slots = view.viaWay.slotsByEdge.get(previousEdge) ?? [];
    if ((viaWayMask >>> slots.length) !== 0) return null;
    for (let bit = 0; bit < slots.length; bit++) if ((viaWayMask & (1 << bit)) !== 0) {
      const found = _stableRestrictionIdForSlot(view, slots[bit]);
      if (!found) return null;
      activeRestrictionIds.push(found);
    }
  }
  activeRestrictionIds.sort();
  return { nodeId:view.nodeSourceId[node], previousEdgeId, activeRestrictionIds };
}

/** Missing/ambiguous stable identity is never guessed. */
export function restoreLocalRtg3SearchState(
  view: RoutingGraphView, stable: StableRtg3SearchState,
): LocalRtg3SearchState | null {
  if (view.version !== 4 || stable.nodeId === 0n) return null;
  let node = -1;
  for (let i = 0; i < view.nodeCount; i++) if (view.nodeSourceId[i] === stable.nodeId) {
    if (node !== -1) return null; node = i;
  }
  if (node < 0) return null;
  let previousEdge = -1;
  if (stable.previousEdgeId !== null) {
    for (let i = 0; i < view.edgeCount; i++) if (stableDirectedEdgeId(view, i) === stable.previousEdgeId) {
      if (previousEdge !== -1) return null; previousEdge = i;
    }
    if (previousEdge < 0) return null;
  }
  if (!stable.activeRestrictionIds.length) return { node, previousEdge, viaWayMask:0 };
  if (previousEdge < 0 || !view.viaWay) return null;
  const wanted = new Set(stable.activeRestrictionIds);
  let viaWayMask = 0;
  const slots = view.viaWay.slotsByEdge.get(previousEdge) ?? [];
  for (let bit = 0; bit < slots.length; bit++) {
    const id = _stableRestrictionIdForSlot(view, slots[bit]);
    if (id && wanted.delete(id)) viaWayMask |= 1 << bit;
  }
  return wanted.size === 0 ? { node, previousEdge, viaWayMask } : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) AYRIŞTIRICI
   ══════════════════════════════════════════════════════════════════════════ */

function _fail(outcome: RtgParseOutcome, detail: string): RoutingGraphParseResult {
  return { outcome, view: null, detail };
}

/**
 * `RTG2`/v1 baytlarını tipli graf görünümüne çevirir.
 *
 * **FAIL-CLOSED:** bozuk, kısa veya desteklenmeyen girdi ASLA yarım bir graf
 * olarak yayınlanmaz — `view` `null` döner ve gerekçe makine-okur olur.
 * Sessiz kabul, "rota var ama yanlış" demektir.
 */
export function parseRoutingGraph(buffer: ArrayBuffer | null | undefined): RoutingGraphParseResult {
  if (!buffer || typeof (buffer as ArrayBuffer).byteLength !== 'number') {
    return _fail('EMPTY', 'bayt yok');
  }
  const total = buffer.byteLength;
  if (total < 8) return _fail('TRUNCATED', `başlık için yetersiz (${total} bayt)`);

  const view = new DataView(buffer);
  const firstWord = view.getUint32(0, true);

  /* ── Sürüm tespiti ────────────────────────────────────────────────────
     v1'de sihirli sayı YOKTUR (ilk kelime doğrudan nodeCount'tur). Bu yüzden
     "sihirli sayı tutmadı → bozuk" DENEMEZ. Ama `RTG` ailesinden BAŞKA bir
     sürüm (ör. `RTG3`) gelirse bu, sessizce v1 sanılacak bir çöp DEĞİL,
     desteklenmeyen bir SÜRÜMDÜR ve öyle raporlanır. */
  let version: 1 | 2 | 3 | 4;
  if (firstWord === RTG4_MAGIC) {
    version = 4;
  } else if (firstWord === RTG3_MAGIC) {
    version = 3;
  } else if (firstWord === RTG2_MAGIC) {
    version = 2;
  } else if (_isRtgFamilyMagic(firstWord)) {
    return _fail('UNSUPPORTED_VERSION', `desteklenmeyen RTG sürümü (0x${firstWord.toString(16)})`);
  } else {
    version = 1;
  }

  let off = 0;
  let nodeCount: number;
  if (version >= 2) {
    off = 4;
    nodeCount = view.getUint32(off, true);
    off += 4;
  } else {
    nodeCount = firstWord;
    off = 4;
  }

  if (!Number.isInteger(nodeCount) || nodeCount < 0) {
    return _fail('INVALID', `düğüm sayısı geçersiz (${nodeCount})`);
  }
  if (nodeCount === 0) return _fail('INVALID', 'düğüm sayısı 0');

  let declaredEdgeCount: number | null = null;
  let declaredRestrictionCount = 0;
  if (version >= 3) {
    if (off + 8 > total) return _fail('TRUNCATED', 'RTG3 sayaç başlığı eksik');
    declaredEdgeCount = view.getUint32(off, true); off += 4;
    declaredRestrictionCount = view.getUint32(off, true); off += 4;
  }
  const nodeBytes = nodeCount * RTG_NODE_STRIDE;
  if (off + nodeBytes + 4 > total) {
    return _fail('TRUNCATED',
      `düğüm tablosu sığmıyor (gereken ${off + nodeBytes + 4}, dosya ${total})`);
  }

  const nodeLat = new Float32Array(nodeCount);
  const nodeLon = new Float32Array(nodeCount);
  const nodeSourceId = new BigUint64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    nodeLat[i] = view.getFloat32(off, true);
    nodeLon[i] = view.getFloat32(off + 4, true);
    if (version >= 3) nodeSourceId[i] = view.getBigUint64(off + 8, true);
    off += RTG_NODE_STRIDE;   // 8 bayt REZERVE atlanır (formatın parçası)
  }

  const edgeCount = declaredEdgeCount ?? view.getUint32(off, true);
  if (declaredEdgeCount === null) off += 4;
  if (!Number.isInteger(edgeCount) || edgeCount < 0) {
    return _fail('INVALID', `kenar sayısı geçersiz (${edgeCount})`);
  }
  if (edgeCount > RTG_MAX_EDGE_COUNT) {
    /* Kanonik `EdgeId` 23-bit sıra numarası taşır. Sığmayan grafı sessizce
       kırpmak, yanlış kenara yanlış öznitelik demektir (F1 precision kuralı). */
    return _fail('ID_SPACE_OVERFLOW',
      `kenar sayısı kimlik uzayını aşıyor (${edgeCount} > ${RTG_MAX_EDGE_COUNT})`);
  }

  const stride = version >= 3 ? RTG3_EDGE_STRIDE : version === 2 ? RTG2_EDGE_STRIDE : RTG1_EDGE_STRIDE;
  const edgeBytes = edgeCount * stride;
  const restrictionStride = version === 4 ? RTG4_RESTRICTION_STRIDE : RTG3_RESTRICTION_STRIDE;
  const restrictionBytes = declaredRestrictionCount * restrictionStride;
  if (off + edgeBytes + restrictionBytes > total) {
    return _fail('TRUNCATED',
      `kenar tablosu sığmıyor (gereken ${off + edgeBytes}, dosya ${total})`);
  }

  const edgeFrom = new Uint32Array(edgeCount);
  const edgeTo = new Uint32Array(edgeCount);
  const edgeCostM = new Uint32Array(edgeCount);
  const edgeFlags = new Uint8Array(edgeCount);
  const edgeRoadClassV3 = new Uint8Array(edgeCount);
  const edgeAccessRole = new Uint8Array(edgeCount);
  const edgeDirection = new Uint8Array(edgeCount);
  const edgeStructure = new Uint8Array(edgeCount);
  const edgeLayer = new Int8Array(edgeCount);
  const edgeSourceWayId = new BigUint64Array(edgeCount);

  for (let i = 0; i < edgeCount; i++) {
    const from = view.getUint32(off, true);
    const to = view.getUint32(off + 4, true);
    const cost = view.getUint32(off + 8, true);
    /* Aralık dışı düğüm indeksi = YAPISAL BOZUKLUK. Worker'ın eski hâlinde bu
       `nodes[to] === undefined` ile A* içinde patlıyordu; burada ÖNCEDEN ve
       AÇIKÇA reddedilir. */
    if (from >= nodeCount || to >= nodeCount) {
      return _fail('INVALID',
        `kenar ${i} aralık dışı düğüm gösteriyor (from=${from}, to=${to}, n=${nodeCount})`);
    }
    edgeFrom[i] = from;
    edgeTo[i] = to;
    edgeCostM[i] = cost;
    if (version >= 3) {
      edgeSourceWayId[i] = view.getBigUint64(off + 12, true);
      edgeRoadClassV3[i] = view.getUint8(off + 20);
      edgeAccessRole[i] = view.getUint8(off + 21);
      edgeDirection[i] = view.getUint8(off + 22);
      edgeStructure[i] = view.getUint8(off + 23);
      edgeLayer[i] = view.getInt8(off + 24);
      if (edgeRoadClassV3[i] < 1 || edgeRoadClassV3[i] > 9 ||
          (edgeAccessRole[i] !== 1 && edgeAccessRole[i] !== 2) ||
          edgeDirection[i] > 1 || edgeStructure[i] > 3) {
        return _fail('INVALID', `RTG3 kenar ${i} metadata enum değeri geçersiz`);
      }
      edgeFlags[i] = (edgeDirection[i] === 0 ? 0 : 1) | ((edgeRoadClassV3[i] & 0x07) << 1);
    } else {
      edgeFlags[i] = version === 2 ? view.getUint8(off + 12) : 0;
    }
    off += stride;
  }
  if (version === 4) {
    const stableEdges = new Map<string, string>();
    for (let i = 0; i < edgeCount; i++) {
      const id = `${edgeSourceWayId[i]}:${nodeSourceId[edgeFrom[i]]}:${nodeSourceId[edgeTo[i]]}:${edgeDirection[i]}`;
      const semantics = `${edgeCostM[i]}:${edgeRoadClassV3[i]}:${edgeAccessRole[i]}:${edgeStructure[i]}:${edgeLayer[i]}`;
      const prior = stableEdges.get(id);
      if (prior !== undefined && prior !== semantics) return _fail('INVALID', `stable directed edge identity çakışması: ${id}`);
      stableEdges.set(id, semantics);
    }
  }

  const restrictionFromEdge = new Uint32Array(declaredRestrictionCount);
  const restrictionToEdge = new Uint32Array(declaredRestrictionCount);
  const restrictionViaNode = new Uint32Array(declaredRestrictionCount);
  const restrictionType = new Uint8Array(declaredRestrictionCount);
  const restrictionChainId = new Uint32Array(declaredRestrictionCount);
  const restrictionChainSeq = new Uint8Array(declaredRestrictionCount);
  const restrictionRelationId = new BigUint64Array(declaredRestrictionCount);
  for (let i = 0; i < declaredRestrictionCount; i++) {
    const fromEdge = view.getUint32(off, true);
    const toEdge = view.getUint32(off + 4, true);
    const viaNode = view.getUint32(off + 8, true);
    if (fromEdge >= edgeCount || toEdge >= edgeCount || viaNode >= nodeCount) {
      return _fail('INVALID', `RTG3 dönüş kısıtı ${i} aralık dışında`);
    }
    restrictionFromEdge[i] = fromEdge;
    restrictionToEdge[i] = toEdge;
    restrictionViaNode[i] = viaNode;
    const type = view.getUint8(off + 12);
    restrictionType[i] = type;
    if ((type & RTG3_VIA_WAY_FLAG) !== 0) {
      const base = type & RTG3_VIA_WAY_BASE_MASK;
      if (base < 1 || base > 7 || (type & ~(RTG3_VIA_WAY_FLAG | RTG3_VIA_WAY_FINAL | RTG3_VIA_WAY_BASE_MASK)) !== 0) {
        return _fail('INVALID', `RTG3 via-way kısıtı ${i} tür baytı geçersiz (0x${type.toString(16)})`);
      }
      restrictionChainSeq[i] = view.getUint8(off + 13);
      restrictionChainId[i] = view.getUint16(off + 14, true);
    } else if (type < 1 || type > 7) {
      return _fail('INVALID', `RTG3 dönüş kısıtı ${i} türü desteklenmiyor`);
    }
    if (version === 4) {
      restrictionRelationId[i] = view.getBigUint64(off + 16, true);
      if (restrictionRelationId[i] === 0n) return _fail('INVALID', `RTG4 dönüş kısıtı ${i} relation kimliği eksik`);
    }
    off += restrictionStride;
  }

  const viaWay = buildViaWayIndex(
    restrictionType, restrictionFromEdge, restrictionToEdge, restrictionViaNode,
    restrictionChainId, restrictionChainSeq, declaredRestrictionCount, edgeCount,
  );
  if (viaWay.error) return _fail('INVALID', `RTG3 via-way zinciri tutarsız: ${viaWay.error}`);

  if (version === 4) {
    const stableRestrictions = new Map<string, string>();
    for (let i = 0; i < declaredRestrictionCount; i++) {
      const transition = `${edgeSourceWayId[restrictionFromEdge[i]]}:${nodeSourceId[edgeFrom[restrictionFromEdge[i]]]}:${nodeSourceId[edgeTo[restrictionFromEdge[i]]]}>${edgeSourceWayId[restrictionToEdge[i]]}:${nodeSourceId[edgeFrom[restrictionToEdge[i]]]}:${nodeSourceId[edgeTo[restrictionToEdge[i]]]}`;
      const key = `${restrictionRelationId[i]}:${restrictionChainSeq[i]}:${transition}`;
      const semantics = String(restrictionType[i]);
      const prior = stableRestrictions.get(key);
      if (prior !== undefined && prior !== semantics) return _fail('INVALID', `stable restriction identity çakışması: ${key}`);
      stableRestrictions.set(key, semantics);
    }
  }

  const parsed: RoutingGraphView = {
    version,
    nodeCount,
    edgeCount,
    parsedBytes: off,
    trailingBytes: Math.max(0, total - off),
    nodeLat,
    nodeLon,
    nodeSourceId,
    edgeFrom,
    edgeTo,
    edgeCostM,
    edgeFlags,
    edgeRoadClassV3,
    edgeAccessRole,
    edgeDirection,
    edgeStructure,
    edgeLayer,
    edgeSourceWayId,
    restrictionCount: declaredRestrictionCount,
    restrictionFromEdge,
    restrictionToEdge,
    restrictionViaNode,
    restrictionType,
    restrictionChainId,
    restrictionChainSeq,
    restrictionRelationId,
    viaWay: viaWay.index,
  };

  return { outcome: 'OK', view: parsed, detail: `v${version} · ${nodeCount} düğüm · ${edgeCount} kenar` };
}

/** İlk kelime `RTG<rakam>` biçiminde bir sihirli sayı mı (LE). */
function _isRtgFamilyMagic(word: number): boolean {
  const b0 = word & 0xff;          // 'R'
  const b1 = (word >> 8) & 0xff;   // 'T'
  const b2 = (word >> 16) & 0xff;  // 'G'
  const b3 = (word >> 24) & 0xff;  // sürüm rakamı
  return b0 === 0x52 && b1 === 0x54 && b2 === 0x47 && b3 >= 0x30 && b3 <= 0x39;
}
