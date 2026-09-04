/**
 * rtg2Reader.ts — NAV v3 · L1 · KANONİK `RTG2` GRAF OKUYUCUSU (SAF · F4).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F4.0 (F1 borcu **B2**).
 *
 * SAF: I/O YOK · `fetch` YOK · timer YOK · React YOK · native YOK ·
 * `Date.now`/`performance.now` YOK · modül durumu YOK. Bayt dizisi DIŞARIDAN
 * gelir → testler deterministiktir ve gerçek artefaktla koşulabilir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `RTG2` ayrıştırma mantığı `NavigationCompute.worker.ts:_loadGraph()` İÇİNDE
 * gömülüydü. Sonucu ölçülmüş bir borçtu (F1/B2): ana iş parçacığı grafı
 * OKUYAMIYOR → `MapStore.getEdgeMetadata` üretimde daima `UNAVAILABLE` →
 * `RoadCandidateSource` aday üretemiyor → `MatchedRoadPose` DOĞMUYOR → F3 CEH
 * fiziksel doğrulama YAPAMIYOR. Zincirin tamamı tek bir dosyanın içinde kilitli
 * kalmıştı.
 *
 * Bu dosya o kilidi açar ve **TEK ayrıştırma otoritesi** olur: worker da,
 * `MapStore` da aynı okuyucuyu kullanır. İkinci bir parser bırakmak, aynı
 * baytların iki farklı yorumu demektir (kilit test `src/` ağacını tarar).
 *
 * ── FORMAT (ölçüldü — `public/maps/routing-graph.bin`, 2026-09-03) ────────
 * Gerçek artefakt: **7 651 542 bayt · 238 252 düğüm · 295 346 kenar**.
 *
 *   [0..3]   uint32 LE  magic `RTG2` (0x32475452) — v1'de bu alan nodeCount'tur
 *   [4..7]   uint32 LE  nodeCount            (yalnız v2)
 *   düğümler nodeCount × 16 bayt:
 *            float32 lat · float32 lon · 8 bayt REZERVE (okunmaz)
 *   sonra    uint32 LE  edgeCount
 *   kenarlar edgeCount × 13 bayt (v2) / 12 bayt (v1):
 *            uint32 from · uint32 to · uint32 costM · uint8 flags (yalnız v2)
 *            flags: bit0 = tek yön · bit1-3 = yol sınıfı (0 = BİLİNMİYOR)
 *
 * `expected = 8 + n×16 + 4 + e×13` = 7 651 542 → gerçek dosyayla BİREBİR.
 *
 * ── BİNARY FORMAT DEĞİŞTİRİLMEDİ ─────────────────────────────────────────
 * Bu tur yeni bir format (RTG3) çıkarmaz, artefaktı yeniden üretmez,
 * `scripts/build-routing-graph.mjs` üreticisine DOKUNMAZ. Yalnız var olan
 * baytların TEK ve AÇIK modeli kurulur.
 *
 * ── UYDURMA ALAN YOK ─────────────────────────────────────────────────────
 * Bu binary'de **hız limiti · yol adı · şerit sayısı · eğim · viraj yarıçapı ·
 * ara poliline geometrisi YOKTUR.** Okuyucu bunları ÜRETMEZ ve "varsayılan"
 * ile doldurmaz. Kenar geometrisi düğümden düğüme DÜZ segmenttir (§F4.7) —
 * `costM` ise seyreltme ÖNCESİ tam poliline üzerinden toplanmıştır, yani
 * gerçek uzunluk düz segmentten UZUN olabilir. İkisi karıştırılmaz.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) SABİTLER
   ══════════════════════════════════════════════════════════════════════════ */

/** `RTG2` sihirli sayısı (LE) — worker ile AYNI değer. */
export const RTG2_MAGIC = 0x32475452;

/** Düğüm kaydı: lat(4) + lon(4) + 8 bayt rezerve. */
export const RTG_NODE_STRIDE = 16;
/** Kenar kaydı: from(4) + to(4) + costM(4) + flags(1). */
export const RTG2_EDGE_STRIDE = 13;
/** v1 kenar kaydı — flags baytı YOK. */
export const RTG1_EDGE_STRIDE = 12;

/** Kimlik uzayı tavanı (F0 `localIdx` 23 bit) — aşan graf REDDEDİLİR. */
export const RTG_MAX_EDGE_COUNT = 8_388_607;

/* ══════════════════════════════════════════════════════════════════════════
   2) ÇIKTI TİPLERİ
   ══════════════════════════════════════════════════════════════════════════ */

export type RtgParseOutcome =
  /** Ayrıştırıldı ve doğrulandı. */
  | 'OK'
  /** Dosya beklenen uzunluktan KISA — sessizce yarım graf kabul EDİLMEZ. */
  | 'TRUNCATED'
  /** `RTG` ailesinden ama desteklenmeyen sürüm (ör. `RTG3`). */
  | 'UNSUPPORTED_VERSION'
  /** Yapısal olarak geçersiz (aralık dışı düğüm indeksi, saçma sayaç…). */
  | 'INVALID'
  /** Kimlik uzayına SIĞMIYOR (kenar sayısı 23-bit tavanını aşıyor). */
  | 'ID_SPACE_OVERFLOW'
  /** Boş/eksik girdi — ölçüm YOK. */
  | 'EMPTY';

/**
 * Ayrıştırılmış graf görünümü — **worker ve `MapStore` ORTAK tüketir**.
 *
 * Tipli dizilerdir: nesne grafiği (238k `{lat,lon}` nesnesi + `Map`) yerine
 * bitişik bellek. Bu bilinçli: eski gösterim düşük-uç head unit'te onlarca MB
 * tutuyordu ve GC baskısı yaratıyordu.
 */
export interface RoutingGraphView {
  readonly version: 1 | 2;
  readonly nodeCount: number;
  readonly edgeCount: number;
  /** Ayrıştırılan bayt uzunluğu (artakalan baytlar dâhil DEĞİL). */
  readonly parsedBytes: number;
  /** Dosyanın sonunda kullanılmayan bayt sayısı (hata DEĞİL, kayıt). */
  readonly trailingBytes: number;
  readonly nodeLat: Float32Array;
  readonly nodeLon: Float32Array;
  readonly edgeFrom: Uint32Array;
  readonly edgeTo: Uint32Array;
  readonly edgeCostM: Uint32Array;
  /** v1'de tümü 0 (sınıf/tek-yön bilgisi YOK → BİLİNMİYOR). */
  readonly edgeFlags: Uint8Array;
}

export interface RoutingGraphParseResult {
  readonly outcome: RtgParseOutcome;
  /** `outcome !== 'OK'` iken DAİMA `null` — yarım graf yayınlanmaz. */
  readonly view: RoutingGraphView | null;
  /** İnsan-okur gerekçe (LAB/log). Serbest metin, karar girdisi DEĞİL. */
  readonly detail: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) SAF ALAN OKUYUCULARI
   ══════════════════════════════════════════════════════════════════════════ */

/** Kenar tek yönlü mü (flags bit 0). v1'de daima `false` (bilgi YOK). */
export function edgeIsOneway(view: RoutingGraphView, ordinal: number): boolean {
  if (!_inEdgeRange(view, ordinal)) return false;
  return (view.edgeFlags[ordinal] & 0x01) === 1;
}

/**
 * Yol sınıfı (flags bit 1-3). **`0` = BİLİNMİYOR** — "yerel yol" DEĞİL.
 * Tüketici 0'ı bir sınıf sanıp hız/limit türetemez.
 */
export function edgeRoadClass(view: RoutingGraphView, ordinal: number): number {
  if (!_inEdgeRange(view, ordinal)) return 0;
  return (view.edgeFlags[ordinal] >> 1) & 0x07;
}

function _inEdgeRange(view: RoutingGraphView, ordinal: number): boolean {
  return !!view && Number.isInteger(ordinal) && ordinal >= 0 && ordinal < view.edgeCount;
}

/** Düğüm indeksi geçerli mi. */
export function isValidNodeIndex(view: RoutingGraphView, idx: number): boolean {
  return !!view && Number.isInteger(idx) && idx >= 0 && idx < view.nodeCount;
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
  let version: 1 | 2;
  if (firstWord === RTG2_MAGIC) {
    version = 2;
  } else if (_isRtgFamilyMagic(firstWord)) {
    return _fail('UNSUPPORTED_VERSION', `desteklenmeyen RTG sürümü (0x${firstWord.toString(16)})`);
  } else {
    version = 1;
  }

  let off = 0;
  let nodeCount: number;
  if (version === 2) {
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

  const nodeBytes = nodeCount * RTG_NODE_STRIDE;
  if (off + nodeBytes + 4 > total) {
    return _fail('TRUNCATED',
      `düğüm tablosu sığmıyor (gereken ${off + nodeBytes + 4}, dosya ${total})`);
  }

  const nodeLat = new Float32Array(nodeCount);
  const nodeLon = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    nodeLat[i] = view.getFloat32(off, true);
    nodeLon[i] = view.getFloat32(off + 4, true);
    off += RTG_NODE_STRIDE;   // 8 bayt REZERVE atlanır (formatın parçası)
  }

  const edgeCount = view.getUint32(off, true);
  off += 4;
  if (!Number.isInteger(edgeCount) || edgeCount < 0) {
    return _fail('INVALID', `kenar sayısı geçersiz (${edgeCount})`);
  }
  if (edgeCount > RTG_MAX_EDGE_COUNT) {
    /* Kanonik `EdgeId` 23-bit sıra numarası taşır. Sığmayan grafı sessizce
       kırpmak, yanlış kenara yanlış öznitelik demektir (F1 precision kuralı). */
    return _fail('ID_SPACE_OVERFLOW',
      `kenar sayısı kimlik uzayını aşıyor (${edgeCount} > ${RTG_MAX_EDGE_COUNT})`);
  }

  const stride = version === 2 ? RTG2_EDGE_STRIDE : RTG1_EDGE_STRIDE;
  const edgeBytes = edgeCount * stride;
  if (off + edgeBytes > total) {
    return _fail('TRUNCATED',
      `kenar tablosu sığmıyor (gereken ${off + edgeBytes}, dosya ${total})`);
  }

  const edgeFrom = new Uint32Array(edgeCount);
  const edgeTo = new Uint32Array(edgeCount);
  const edgeCostM = new Uint32Array(edgeCount);
  const edgeFlags = new Uint8Array(edgeCount);

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
    edgeFlags[i] = version === 2 ? view.getUint8(off + 12) : 0;
    off += stride;
  }

  const parsed: RoutingGraphView = {
    version,
    nodeCount,
    edgeCount,
    parsedBytes: off,
    trailingBytes: Math.max(0, total - off),
    nodeLat,
    nodeLon,
    edgeFrom,
    edgeTo,
    edgeCostM,
    edgeFlags,
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
