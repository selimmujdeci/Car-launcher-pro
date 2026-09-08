/**
 * rtg3Codec.mjs — RTG3 YAZMA OTORİTESİ (tek kaynak).
 *
 * Daha önce `build-pbf-streaming-rtg3.mjs` ve `build-rtg3-bounded.mjs` kendi
 * `serialize()` kopyalarını taşıyordu: aynı baytların iki yazarı demekti.
 * Okuma tarafında tek otorite (`src/platform/navigation/map/graph/rtg2Reader.ts`)
 * olduğu için yazma tarafında da tek otorite olmak zorundadır.
 *
 * ── KAYIT DÜZENİ ──────────────────────────────────────────────────────────
 *   header  16 B : magic(4) nodeCount(4) edgeCount(4) restrictionCount(4)
 *   node    16 B : lat f32 · lon f32 · osmNodeId u64
 *   edge    28 B : from u32 · to u32 · costM u32 · wayId u64 ·
 *                  cls u8 · accessRole u8 · direction u8 · structure u8 ·
 *                  layer i8 · rezerve 3 B
 *   restr   16 B : fromEdge u32 · toEdge u32 · viaNode u32 ·
 *                  type u8 · chainSeq u8 · chainId u16
 *
 * ── VIA-WAY GERİYE UYUM (fail-closed) ────────────────────────────────────
 * Via-node kısıtı `type` = 1..7 (DEĞİŞMEDİ; via-way içermeyen graf bayt bayt
 * aynı kalır). Via-way zinciri `type` baytının 0x80 bitini kullanır. ESKİ
 * okuyucu `type` 1..7 dışını `INVALID` sayıp GRAFI TÜMDEN REDDEDER → eski
 * uygulama yeni grafı sessizce eksik kısıtla sürmez. Bu bilinçli bir
 * fail-closed sözleşmedir; yeni sürüm sihirli sayısı gerekmez.
 */

export const RTG3_MAGIC = 0x33475452;
export const RTG3_NODE_STRIDE = 16;
export const RTG3_EDGE_STRIDE = 28;
export const RTG3_RESTRICTION_STRIDE = 16;

/** Via-node kısıt türleri — okuyucu ile BİREBİR aynı sayılar. */
export const RESTRICTION_TYPE = Object.freeze({
  no_left_turn: 1, no_right_turn: 2, no_straight_on: 3, no_u_turn: 4,
  only_left_turn: 5, only_right_turn: 6, only_straight_on: 7,
});

/** `type` baytı bit sözleşmesi (okuyucudaki sabitlerle AYNI). */
export const VIA_WAY_FLAG = 0x80;
export const VIA_WAY_FINAL = 0x40;
export const VIA_WAY_BASE_MASK = 0x07;

/**
 * Tek kenardan geçebilecek en fazla via-way zincir yuvası. A* durum anahtarı
 * bu yuvalar üzerinde bit maskesi taşır; sınırsız büyümesi arama uzayını
 * patlatır. Aşan ilişki UYDURULMAZ — `UNSUPPORTED_CAPACITY` olarak raporlanır.
 */
export const MAX_VIA_WAY_SLOTS_PER_EDGE = 8;
/** `chainId` alanı u16'dır. */
export const MAX_VIA_WAY_CHAINS = 0xffff;
/** `chainSeq` alanı u8'dir → bir zincirde en fazla 256 geçiş. */
export const MAX_VIA_WAY_CHAIN_LINKS = 256;

/** Via-way zincir halkası için `type` baytını üretir. */
export function viaWayTypeByte(baseType, isFinal) {
  return VIA_WAY_FLAG | (isFinal ? VIA_WAY_FINAL : 0) | (baseType & VIA_WAY_BASE_MASK);
}

/**
 * RTG3 baytlarını üretir.
 *
 * `graph.restrictions[i]` = `{ fromEdge, toEdge, viaNode, type, chainSeq?, chainId? }`
 * `type` ya 1..7 (via-node) ya da `viaWayTypeByte(...)` sonucudur.
 */
export function serializeRtg3(graph) {
  const nodeCount = graph.coords.length;
  const edgeCount = graph.edges.length;
  const restrictionCount = graph.restrictions.length;
  const buffer = Buffer.alloc(
    16 + nodeCount * RTG3_NODE_STRIDE + edgeCount * RTG3_EDGE_STRIDE
    + restrictionCount * RTG3_RESTRICTION_STRIDE,
  );
  buffer.writeUInt32LE(RTG3_MAGIC, 0);
  buffer.writeUInt32LE(nodeCount, 4);
  buffer.writeUInt32LE(edgeCount, 8);
  buffer.writeUInt32LE(restrictionCount, 12);
  let offset = 16;
  for (let i = 0; i < nodeCount; i++) {
    const point = graph.coords[i];
    buffer.writeFloatLE(point[0], offset);
    buffer.writeFloatLE(point[1], offset + 4);
    buffer.writeBigUInt64LE(BigInt(graph.nodeIds?.[i] ?? 0), offset + 8);
    offset += RTG3_NODE_STRIDE;
  }
  for (const edge of graph.edges) {
    buffer.writeUInt32LE(edge.from, offset);
    buffer.writeUInt32LE(edge.to, offset + 4);
    buffer.writeUInt32LE(edge.cost, offset + 8);
    buffer.writeBigUInt64LE(BigInt(edge.wayId), offset + 12);
    buffer[offset + 20] = edge.cls;
    buffer[offset + 21] = edge.accessRole;
    buffer[offset + 22] = edge.direction;
    buffer[offset + 23] = edge.structure;
    buffer.writeInt8(edge.layer, offset + 24);
    offset += RTG3_EDGE_STRIDE;
  }
  for (const restriction of graph.restrictions) {
    buffer.writeUInt32LE(restriction.fromEdge, offset);
    buffer.writeUInt32LE(restriction.toEdge, offset + 4);
    buffer.writeUInt32LE(restriction.viaNode, offset + 8);
    buffer[offset + 12] = restriction.type;
    buffer[offset + 13] = restriction.chainSeq ?? 0;
    buffer.writeUInt16LE(restriction.chainId ?? 0, offset + 14);
    offset += RTG3_RESTRICTION_STRIDE;
  }
  return buffer;
}
