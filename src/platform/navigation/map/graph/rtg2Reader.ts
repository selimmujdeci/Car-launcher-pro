/**
 * rtg2Reader.ts — NAV v3 · L1 · KANONİK `RTG2/RTG3` GRAF OKUYUCUSU (SAF · F4).
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
 * RTG3, RTG2'yi yerinde bozmaz; ayrı sihirli sayı ve sabit kayıt boylarıyla
 * road/access/direction/structure/source kimliği ile dönüş kısıtını taşır.
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
export const RTG3_MAGIC = 0x33475452;
export const RTG4_MAGIC = 0x34475452;

/** Düğüm kaydı: lat(4) + lon(4) + 8 bayt rezerve. */
export const RTG_NODE_STRIDE = 16;
/** Kenar kaydı: from(4) + to(4) + costM(4) + flags(1). */
export const RTG2_EDGE_STRIDE = 13;
/** v1 kenar kaydı — flags baytı YOK. */
export const RTG1_EDGE_STRIDE = 12;
export const RTG3_EDGE_STRIDE = 28;
export const RTG3_RESTRICTION_STRIDE = 16;
export const RTG4_RESTRICTION_STRIDE = 24;

/* ── Via-way dönüş kısıtı bit sözleşmesi ───────────────────────────────────
   `type` baytı 1..7 iken kayıt KLASİK via-node kısıtıdır (format DEĞİŞMEDİ).
   0x80 biti kurulu ise kayıt bir via-way ZİNCİR HALKASIDIR; 0x40 biti o
   halkanın zincirin SON geçişi olduğunu söyler, düşük 3 bit temel türdür.

   Bu bilinçli olarak `RTG4` sihirli sayısı DEĞİLDİR: eski okuyucu `type`
   1..7 dışını `INVALID` sayıp grafı TÜMDEN reddeder → eski uygulama yeni
   grafı "kısıtı görmeden" sürmez (fail-closed). Via-way içermeyen RTG3
   artefaktı bayt bayt aynıdır; RTG1/RTG2 hiç etkilenmez. */
export const RTG3_VIA_WAY_FLAG = 0x80;
export const RTG3_VIA_WAY_FINAL = 0x40;
export const RTG3_VIA_WAY_BASE_MASK = 0x07;

/**
 * Bir kenardan geçebilecek EN FAZLA via-way zincir yuvası.
 *
 * A* durum anahtarı bu yuvalar üzerinde bir bit maskesi taşır: `(düğüm,
 * önceki kenar, maske)`. Maske sınırsız büyürse arama uzayı üstel olur —
 * bu tavan "bounded transition context" sözünün SAYISAL karşılığıdır.
 * Aşan graf sessizce kırpılmaz, `INVALID` ile reddedilir.
 */
export const RTG3_MAX_VIA_WAY_SLOTS_PER_EDGE = 8;
/** `chainSeq` alanı u8 — bir zincirde en fazla 256 geçiş. */
export const RTG3_MAX_VIA_WAY_CHAIN_LINKS = 256;

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
  readonly version: 1 | 2 | 3 | 4;
  readonly nodeCount: number;
  readonly edgeCount: number;
  /** Ayrıştırılan bayt uzunluğu (artakalan baytlar dâhil DEĞİL). */
  readonly parsedBytes: number;
  /** Dosyanın sonunda kullanılmayan bayt sayısı (hata DEĞİL, kayıt). */
  readonly trailingBytes: number;
  readonly nodeLat: Float32Array;
  readonly nodeLon: Float32Array;
  /** RTG3 OSM node kimliği; RTG1/2 ve eski RTG3 artefact'ta 0. */
  readonly nodeSourceId: BigUint64Array;
  readonly edgeFrom: Uint32Array;
  readonly edgeTo: Uint32Array;
  readonly edgeCostM: Uint32Array;
  /** v1'de tümü 0 (sınıf/tek-yön bilgisi YOK → BİLİNMİYOR). */
  readonly edgeFlags: Uint8Array;
  /** RTG3 metadata; RTG1/2 views carry zero-filled arrays. */
  readonly edgeRoadClassV3: Uint8Array;
  readonly edgeAccessRole: Uint8Array;
  readonly edgeDirection: Uint8Array;
  readonly edgeStructure: Uint8Array;
  readonly edgeLayer: Int8Array;
  readonly edgeSourceWayId: BigUint64Array;
  readonly restrictionCount: number;
  readonly restrictionFromEdge: Uint32Array;
  readonly restrictionToEdge: Uint32Array;
  readonly restrictionViaNode: Uint32Array;
  readonly restrictionType: Uint8Array;
  /** Via-way zincir kimliği; via-node kaydında ANLAMSIZ (0). */
  readonly restrictionChainId: Uint32Array;
  /** Via-way zincirindeki halka sırası; via-node kaydında ANLAMSIZ (0). */
  readonly restrictionChainSeq: Uint8Array;
  /** RTG4 stable OSM restriction relation identity; older formats carry 0. */
  readonly restrictionRelationId?: BigUint64Array;
  /** Via-way otomatı — kayıt yoksa `null` (davranış RTG3 öncesiyle AYNI). */
  readonly viaWay: ViaWayRestrictionIndex | null;
}

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

/**
 * Via-way maskesini BİR PENCEREDEN DİĞERİNE taşır (RTG4 bounded on-demand A*).
 *
 * ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
 * Maske bitleri `slotsByEdge` dizisindeki SIRAYA bağlıdır; o sıra, birleştirilen
 * bölge kümesine (yani PENCEREYE) göre değişir. Pencere kaydığında aynı fiziksel
 * zincir başka bir bit konumuna düşebilir. Biti körlemesine taşımak, aktif bir
 * `only_*` zincirini sessizce DÜŞÜRMEK ya da alakasız bir `no_*` zincirini
 * aktifmiş gibi göstermek demektir — ikisi de yasa dışı rota üretir.
 *
 * ── NEDEN BURADA ──────────────────────────────────────────────────────────
 * `slotsByEdge` iç yapısı yalnız bu okuyucunundur (kilit: regresyon kasası).
 * Çevirici de bu yüzden BURADA durur; worker maskeyi yorumlamaz, yalnız taşır.
 *
 * Eşleme kimliği yuvanın İÇERİĞİDİR: zincir türü + zincir uzunluğu + adım +
 * halkanın (from-edge, to-edge, via-node) üçlüsü — hepsi `mapEdge`/`mapNode`
 * ile HEDEF pencere kimliklerine çevrilmiş hâlde. Tahmin YAPILMAZ.
 *
 * ── ÜÇ AYRI SONUÇ (birbirine KARIŞTIRILMAZ) ──────────────────────────────
 *  · `number` → kesin çeviri; kısıt hedef pencerede AYNI anlamı taşır.
 *  · `RTG3_VIA_WAY_MASK_ABSENT` (-1) → zincir hedef pencerede YOK (bölgesi
 *    tahliye edilmiş). Bu bir bozulma DEĞİLDİR; çağıran o arama durumunu
 *    DÜŞÜRÜR. Kısıt asla "yokmuş gibi" sıfırlanıp devam ettirilmez.
 *  · `null` → kaynak durumu tutarsız ya da hedefte BİRDEN ÇOK aday var.
 *    Belirsizlikle rota üretmek yasa dışı manevra riski demektir → fail-closed.
 */
export const RTG3_VIA_WAY_MASK_ABSENT = -1;

export function remapViaWayMask(
  fromView: RoutingGraphView, fromEdge: number, mask: number,
  toView: RoutingGraphView, toEdge: number,
  mapEdge: (edge: number) => number, mapNode: (node: number) => number,
): number | null {
  if (mask === 0) return 0;
  const fromIndex = fromView.viaWay;
  if (!fromIndex || fromEdge < 0) return null;
  const fromSlots = fromIndex.slotsByEdge.get(fromEdge);
  if (!fromSlots || (mask >>> fromSlots.length) !== 0) return null;
  const toIndex = toView.viaWay;
  if (!toIndex || toEdge < 0) return RTG3_VIA_WAY_MASK_ABSENT;
  const toSlots = toIndex.slotsByEdge.get(toEdge);
  if (!toSlots) return RTG3_VIA_WAY_MASK_ABSENT;

  /* İmza TÜM ZİNCİRİ kapsar, tek halkayı değil. Ölçüldü: gerçek Türkiye
     verisinde aynı kavşakta aynı türde, aynı ilk halkayla başlayıp SONRA
     ayrılan iki zincir var; tek halkalık imza bunları ayırt edemiyor ve
     meşru bir rota "belirsiz" diye fail-closed ediliyordu. */
  const signature = (
    index: ViaWayRestrictionIndex, slot: number,
    edgeOf: (edge: number) => number, nodeOf: (node: number) => number,
  ): string | null => {
    const chain = _slotChain(slot), step = _slotStep(slot);
    if (chain >= index.chainCount || step >= index.chainLength[chain]) return null;
    const parts: string[] = [`${index.chainType[chain]}:${index.chainLength[chain]}:${step}`];
    for (let j = 0; j < index.chainLength[chain]; j++) {
      const link = index.chainStart[chain] + j;
      const from = edgeOf(index.linkFromEdge[link]);
      const to = edgeOf(index.linkToEdge[link]);
      const via = nodeOf(index.linkViaNode[link]);
      if (from < 0 || to < 0 || via < 0) return null;
      parts.push(`${from}>${to}@${via}`);
    }
    return parts.join('|');
  };

  const identity = (value: number): number => value;
  const targets: (string | null)[] = toSlots.map((slot) => signature(toIndex, slot, identity, identity));

  let next = 0;
  for (let bit = 0; bit < fromSlots.length; bit++) {
    if ((mask & (1 << bit)) === 0) continue;
    const wanted = signature(fromIndex, fromSlots[bit], mapEdge, mapNode);
    /* Zincirin kendi kenarları hedef pencerede yoksa `signature` çeviremez —
       bu, kısıtın BOZUK olduğu değil, o bölgenin artık yerleşik OLMADIĞI
       anlamına gelir. */
    if (wanted === null) return RTG3_VIA_WAY_MASK_ABSENT;
    let matched = -1;
    for (let j = 0; j < targets.length; j++) {
      if (targets[j] !== wanted) continue;
      if (matched !== -1) return null;   // belirsiz eşleşme → fail-closed
      matched = j;
    }
    if (matched === -1) return RTG3_VIA_WAY_MASK_ABSENT;   // zincir hedef pencerede YOK
    next |= 1 << matched;
  }
  return next;
}

/**
 * Via-way dönüş kısıtı otomatı — **saf veri**, karar `viaWayStep`tedir.
 *
 * Bir OSM `from way → via way(lar) → to way` kısıtı, kenar dizisi
 * `e0 → e1 → … → em` biçiminde ZİNCİR olarak taşınır. `link j` zincirin
 * `e_j → e_{j+1}` geçişidir ve `linkViaNode[j]` o geçişin kavşağıdır.
 */
export interface ViaWayRestrictionIndex {
  readonly chainCount: number;
  /** Temel kısıt türü (1..7) — `>=5` ise `only_*`. */
  readonly chainType: Uint8Array;
  readonly chainStart: Uint32Array;
  /** Zincirdeki geçiş (link) sayısı `m`. */
  readonly chainLength: Uint32Array;
  readonly linkFromEdge: Uint32Array;
  readonly linkToEdge: Uint32Array;
  readonly linkViaNode: Uint32Array;
  /**
   * Kenar → o kenarın üzerinde duran yuvalar. Yuva değeri `chain*256 + step`
   * paketlenmiştir; `step`, zincirin o kenardan ÇIKAN halkasının indeksidir.
   * Dizideki SIRA, A* durum maskesindeki bit sırasıdır.
   */
  readonly slotsByEdge: ReadonlyMap<number, readonly number[]>;
  /**
   * Sıcak yol koruması: kenarın ÜZERİNDE yuva var mı (1 bit/kenar).
   *
   * `viaWayStep` her kenar genişlemesinde çağrılır. Yuvası olmayan kenar
   * grafın neredeyse tamamıdır; orada `Map.get` yapmak ölçülebilir bir
   * yavaşlamadır. Bu bitset ile ortak durum tek dizi okumasıyla elenir
   * (`edgeCount/8` bayt — 629k kenarlı bölgede ≈ 79 KB, yalnız via-way
   * kaydı VARSA ayrılır).
   */
  readonly slotEdgeBits: Uint8Array;
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
  if (view.version >= 3) return view.edgeDirection[ordinal] !== 0;
  return (view.edgeFlags[ordinal] & 0x01) === 1;
}

/**
 * Yol sınıfı (flags bit 1-3). **`0` = BİLİNMİYOR** — "yerel yol" DEĞİL.
 * Tüketici 0'ı bir sınıf sanıp hız/limit türetemez.
 */
export function edgeRoadClass(view: RoutingGraphView, ordinal: number): number {
  if (!_inEdgeRange(view, ordinal)) return 0;
  if (view.version >= 3) return view.edgeRoadClassV3[ordinal];
  return (view.edgeFlags[ordinal] >> 1) & 0x07;
}

/** 0=UNKNOWN/legacy, 1=ROUTABLE_PUBLIC, 2=DESTINATION_ACCESS_ONLY. */
export function edgeAccessRole(view: RoutingGraphView, ordinal: number): number {
  if (!_inEdgeRange(view, ordinal) || view.version < 3) return 0;
  return view.edgeAccessRole[ordinal];
}

/**
 * RTG3 **via-node** dönüş kısıtı sorgusu. RTG1/2'de kısıt yoktur → serbest.
 *
 * Via-way zincir kayıtları BURADA DEĞERLENDİRİLMEZ: tek kavşak bakışı bir
 * via-way kısıtını doğru yanıtlayamaz (yasak olan, tüm dizinin tamamlanması).
 * Onların sahibi `viaWayStep`tir.
 */
export function turnIsAllowed(
  view: RoutingGraphView, previousEdge: number, nextEdge: number, viaNode: number,
): boolean {
  if (view.version < 3 || previousEdge < 0) return true;
  let hasOnly = false;
  let matchedOnly = false;
  for (let i = 0; i < view.restrictionCount; i++) {
    if ((view.restrictionType[i] & RTG3_VIA_WAY_FLAG) !== 0) continue;
    if (view.restrictionViaNode[i] !== viaNode || view.restrictionFromEdge[i] !== previousEdge) continue;
    const type = view.restrictionType[i];
    if (type >= 1 && type <= 4 && view.restrictionToEdge[i] === nextEdge) return false;
    if (type >= 5 && type <= 7) {
      hasOnly = true;
      if (view.restrictionToEdge[i] === nextEdge) matchedOnly = true;
    }
  }
  return !hasOnly || matchedOnly;
}

/** Yuva paketleme — `chain*256 + step`. */
const _slotChain = (slot: number): number => slot >>> 8;
const _slotStep = (slot: number): number => slot & 0xff;

/**
 * Via-way otomatının TEK geçiş kuralı.
 *
 * Girdi durum: `(previousEdge, mask)` — `mask`, `previousEdge` üzerindeki
 * yuvalardan hangilerinin AKTİF olduğudur (yani hangi zincirlerin o ana kadar
 * eksiksiz izlendiği). Çıktı, `nextEdge` üzerindeki YENİ maskedir.
 *
 * Dönüş `-1` ise geçiş YASAK:
 *  - `no_*`  → zincirin SON halkası tamamlanmak üzere (yasak manevra),
 *  - `only_*`→ zincire girilmiş ama izin verilen devam kenarı seçilmemiş.
 *
 * Zincire GİRİLMEMİŞSE hiçbir kenar bloklanmaz — alakasız yollar kapanmaz.
 * Via-way kaydı olmayan grafta daima `0` döner → durum anahtarı ve arama
 * davranışı RTG3'ün önceki hâliyle BİREBİR aynıdır.
 */
export function viaWayStep(
  view: RoutingGraphView, previousEdge: number, mask: number,
  viaNode: number, nextEdge: number,
): number {
  const index = view.viaWay;
  if (!index) return 0;

  const bits = index.slotEdgeBits;
  const previousHasSlots = previousEdge >= 0 && mask !== 0
    && (bits[previousEdge >> 3] & (1 << (previousEdge & 7))) !== 0;
  const nextHasSlots = (bits[nextEdge >> 3] & (1 << (nextEdge & 7))) !== 0;
  if (!previousHasSlots && !nextHasSlots) return 0;   // sıcak yol: zincirle ilgisiz

  const previousSlots = previousHasSlots ? index.slotsByEdge.get(previousEdge) : undefined;

  if (previousSlots) {
    for (let i = 0; i < previousSlots.length; i++) {
      if ((mask & (1 << i)) === 0) continue;
      const chain = _slotChain(previousSlots[i]);
      const step = _slotStep(previousSlots[i]);
      const link = index.chainStart[chain] + step;
      /* Zincir bu kavşakta ilerlemiyorsa (kenarın DİĞER ucundayız) kısıt
         uygulanmaz — ne yasaklar ne zorlar; yalnızca sönümlenir. */
      if (index.linkViaNode[link] !== viaNode) continue;
      const expected = index.linkToEdge[link];
      if (index.chainType[chain] >= 5) {
        if (nextEdge !== expected) return -1;          // only_* → zorunlu devam
      } else if (nextEdge === expected && step === index.chainLength[chain] - 1) {
        return -1;                                      // no_* → yasak dizi tamamlanıyor
      }
    }
  }

  const nextSlots = index.slotsByEdge.get(nextEdge);
  if (!nextSlots) return 0;
  let next = 0;
  for (let j = 0; j < nextSlots.length; j++) {
    const chain = _slotChain(nextSlots[j]);
    const step = _slotStep(nextSlots[j]);
    if (step === 0) { next |= 1 << j; continue; }       // zincirin `from` kenarındayız
    if (!previousSlots) continue;
    for (let i = 0; i < previousSlots.length; i++) {
      if ((mask & (1 << i)) === 0) continue;
      if (_slotChain(previousSlots[i]) !== chain || _slotStep(previousSlots[i]) !== step - 1) continue;
      const link = index.chainStart[chain] + step - 1;
      if (index.linkViaNode[link] === viaNode && index.linkToEdge[link] === nextEdge) {
        next |= 1 << j;
      }
    }
  }
  return next;
}

/**
 * Via-way kayıtlarından otomat indeksini kurar (saf).
 *
 * Ayrıştırıcı ve `mergeRegionalGraphViews` AYNI kurucuyu kullanır — ikinci bir
 * zincir yorumu bırakmak, aynı kısıtın iki farklı anlamı demektir.
 * Tutarsız zincir sessizce atılmaz: `error` döner → çağıran fail-closed reddeder.
 */
export function buildViaWayIndex(
  restrictionType: Uint8Array, restrictionFromEdge: Uint32Array,
  restrictionToEdge: Uint32Array, restrictionViaNode: Uint32Array,
  restrictionChainId: Uint32Array, restrictionChainSeq: Uint8Array,
  count: number, edgeCount: number,
): { index: ViaWayRestrictionIndex | null; error: string | null } {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    if ((restrictionType[i] & RTG3_VIA_WAY_FLAG) === 0) continue;
    const id = restrictionChainId[i];
    const bucket = groups.get(id);
    if (bucket) bucket.push(i); else groups.set(id, [i]);
  }
  if (!groups.size) return { index: null, error: null };

  const chainType: number[] = [];
  const chainStart: number[] = [];
  const chainLength: number[] = [];
  const linkFromEdge: number[] = [];
  const linkToEdge: number[] = [];
  const linkViaNode: number[] = [];
  const slotsByEdge = new Map<number, number[]>();

  const chainIds = [...groups.keys()].sort((a, b) => a - b);
  for (const id of chainIds) {
    const records = groups.get(id)!.sort((a, b) => restrictionChainSeq[a] - restrictionChainSeq[b]);
    const links = records.length;
    if (links > RTG3_MAX_VIA_WAY_CHAIN_LINKS) {
      return { index: null, error: `via-way zinciri ${id} çok uzun (${links})` };
    }
    const base = restrictionType[records[0]] & RTG3_VIA_WAY_BASE_MASK;
    if (base < 1 || base > 7) {
      return { index: null, error: `via-way zinciri ${id} temel türü geçersiz (${base})` };
    }
    const chain = chainType.length;
    if (chain > 0xffff) return { index: null, error: 'via-way zincir sayısı taşıyor' };
    chainType.push(base);
    chainStart.push(linkFromEdge.length);
    chainLength.push(links);
    for (let j = 0; j < links; j++) {
      const record = records[j];
      if (restrictionChainSeq[record] !== j) {
        return { index: null, error: `via-way zinciri ${id} halka sırası bozuk (${restrictionChainSeq[record]} ≠ ${j})` };
      }
      if ((restrictionType[record] & RTG3_VIA_WAY_BASE_MASK) !== base) {
        return { index: null, error: `via-way zinciri ${id} halkaları farklı tür taşıyor` };
      }
      const isFinal = (restrictionType[record] & RTG3_VIA_WAY_FINAL) !== 0;
      if (isFinal !== (j === links - 1)) {
        return { index: null, error: `via-way zinciri ${id} son halka işareti yanlış (halka ${j})` };
      }
      if (j > 0 && restrictionFromEdge[record] !== linkToEdge[linkToEdge.length - 1]) {
        return { index: null, error: `via-way zinciri ${id} halka ${j} bitişik değil` };
      }
      const slotEdge = restrictionFromEdge[record];
      const slots = slotsByEdge.get(slotEdge) ?? [];
      if (slots.length >= RTG3_MAX_VIA_WAY_SLOTS_PER_EDGE) {
        return { index: null, error: `kenar ${slotEdge} via-way yuva tavanını aşıyor (${RTG3_MAX_VIA_WAY_SLOTS_PER_EDGE})` };
      }
      slots.push(chain * 256 + j);
      slotsByEdge.set(slotEdge, slots);
      linkFromEdge.push(slotEdge);
      linkToEdge.push(restrictionToEdge[record]);
      linkViaNode.push(restrictionViaNode[record]);
    }
  }

  const slotEdgeBits = new Uint8Array(Math.ceil(Math.max(edgeCount, 1) / 8));
  for (const edge of slotsByEdge.keys()) {
    if (edge >= edgeCount) return { index: null, error: `via-way yuvası kenar aralığı dışında (${edge})` };
    slotEdgeBits[edge >> 3] |= 1 << (edge & 7);
  }

  return {
    index: {
      chainCount: chainType.length,
      chainType: Uint8Array.from(chainType),
      chainStart: Uint32Array.from(chainStart),
      chainLength: Uint32Array.from(chainLength),
      linkFromEdge: Uint32Array.from(linkFromEdge),
      linkToEdge: Uint32Array.from(linkToEdge),
      linkViaNode: Uint32Array.from(linkViaNode),
      slotsByEdge,
      slotEdgeBits,
    },
    error: null,
  };
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
