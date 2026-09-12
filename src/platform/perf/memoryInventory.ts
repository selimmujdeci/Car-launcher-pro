/**
 * memoryInventory — ARCH-06/F1 · BELLEK VE CACHE ENVANTERİ (SALT-OKUNUR).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **MERKEZÎ CACHE SAHİBİ DEĞİLDİR.** F0 kararı: her alan kendi cache'inin
 *     sahibi KALIR. Burada yalnız "kim, hangi sınıf, ne kadar, silinebilir mi"
 *     yazılıdır.
 * (2) **EVICTION YAPMAZ.** Tek satır bile silmez. Baskı kararı
 *     `memoryWatchdog`ta, uygulama alan sahibindedir.
 * (3) **HEDEF BAYT UYDURMAZ.** `targetBytes` bu turda DAİMA `null`dur —
 *     baseline ölçülmeden hedef koymak, "en çok yer açan"ı değil "listede ilk
 *     olan"ı silmektir. `configuredLimit` yalnız GERÇEKTEN var olan sabit
 *     tavanları taşır (ring kapasitesi gibi).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEMEYEN DÜRÜSTÇE null KALIR ───────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F0 ölçtü: 12 cache'in HİÇBİRİ boyutunu bilmiyor. Bu turda ölçülebilenler
 * ölçülür (giriş adedi, sabit tavan), ölçülemeyenler `null` kalır.
 * **`estimatedBytes: null` olan katılımcı, baskı altında EN SON kırpılır** —
 * bilinmeyeni önce silmek kör davranıştır (F5 kuralı).
 */

/** F0 §C.14.1 sınıfları. */
export type MemoryClass =
  /** Canlı gerçek. Baskının HİÇBİR kademesinde silinmez. */
  | 'NON_EVICTABLE_TRUTH'
  /** Silinebilir, yeniden kurulabilir türev. */
  | 'REBUILDABLE_DERIVED'
  /** Sunum önbelleği (decoded görsel, tile). */
  | 'PRESENTATION_CACHE'
  /** Önyükleme — baskıda İLK GİDEN. */
  | 'PREFETCH_CACHE'
  /** Geçmiş/defter — kırpılır, silinmez. */
  | 'HISTORY'
  /** Geliştirici yüzeyi — baskıda İLK GİDEN. */
  | 'DEVTOOLS';

export type RebuildCost = 'FREE' | 'CHEAP' | 'EXPENSIVE' | 'NETWORK_REQUIRED' | 'UNKNOWN';

export interface MemoryBudgetDescriptor {
  readonly resourceId: string;
  readonly owner: string;
  readonly memoryClass: MemoryClass;
  /** Giriş adedi — ölçülebiliyorsa. Bayt DEĞİLDİR. */
  readonly entries: number | null;
  /** Ölçülmüş bayt. **Ölçülemiyorsa `null` — 0 YAZILMAZ.** */
  readonly estimatedBytes: number | null;
  /** GERÇEKTEN var olan sabit tavan (ring kapasitesi vb.); yoksa `null`. */
  readonly configuredLimit: number | null;
  /** Tavanın birimi — "40 giriş" ile "40 MB" karıştırılmasın. */
  readonly limitUnit: 'entries' | 'bytes' | null;
  /** F1'de DAİMA `null` — baseline öncesi hedef bayt YASAK. */
  readonly targetBytes: null;
  readonly evictable: boolean;
  readonly rebuildCost: RebuildCost;
  /** `memoryWatchdog.registerCachePurge` ile GERÇEKTEN kayıtlı mı. */
  readonly pressureParticipant: boolean;
  /** Kapsam: global · araç · oturum. */
  readonly scope: 'GLOBAL' | 'VEHICLE' | 'SESSION';
  readonly provenance: string;
}

const D = (d: MemoryBudgetDescriptor): MemoryBudgetDescriptor => Object.freeze(d);

/** Ölçüm sağlayıcısı — sahibi bağlar; bağlanmamışsa `null` (fail-closed). */
type EntryReader = () => number | null;
const _entryReaders = new Map<string, EntryReader>();

/**
 * Bir cache sahibinin ÖLÇÜM sağlayıcısını bağlar (ARCH-01 wiring deseni).
 *
 * Sağlayıcı UCUZ olmalıdır (bir `.size` okuması gibi). Pahalı bir sayım
 * yapan sağlayıcı, ölçmek istediğimiz maliyeti üretir (§39). Bağlanmamış
 * kaynak dürüstçe `null` gösterir.
 */
export function bindMemoryEntryReader(resourceId: string, read: EntryReader): void {
  _entryReaders.set(resourceId, read);
}

/** @internal YALNIZ TEST. */
export function _resetMemoryReadersForTest(): void { _entryReaders.clear(); }

function readEntries(resourceId: string): number | null {
  const r = _entryReaders.get(resourceId);
  if (r === undefined) return null;
  try {
    const v = r();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch { return null; }
}

/**
 * BÜYÜK BELLEK TÜKETİCİLERİ.
 *
 * Sıra bilinçlidir: `NON_EVICTABLE_TRUTH` en üstte durur ki baskı merdiveni
 * tasarlanırken "buna dokunulmaz" listesi ilk okunan şey olsun.
 */
const RESOURCES: readonly MemoryBudgetDescriptor[] = Object.freeze([
  /* ── ASLA SİLİNMEZ ────────────────────────────────────────────────── */
  D({ resourceId: 'vdl.vehicleTruth', owner: 'UnifiedVehicleStore', memoryClass: 'NON_EVICTABLE_TRUTH',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: false, rebuildCost: 'UNKNOWN', pressureParticipant: false, scope: 'VEHICLE',
    provenance: 'vehicleDataLayer/UnifiedVehicleStore.ts' }),
  D({ resourceId: 'navigation.activeSession', owner: 'navigationSessionRuntime', memoryClass: 'NON_EVICTABLE_TRUTH',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: false, rebuildCost: 'NETWORK_REQUIRED', pressureParticipant: false, scope: 'SESSION',
    provenance: 'platform/navigation/navigationSessionRuntime.ts' }),
  D({ resourceId: 'media.activeSession', owner: 'mediaAuthorityRuntime', memoryClass: 'NON_EVICTABLE_TRUTH',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: false, rebuildCost: 'UNKNOWN', pressureParticipant: false, scope: 'SESSION',
    provenance: 'platform/media/authority/mediaAuthorityRuntime.ts' }),
  D({ resourceId: 'security.decisionEvidence', owner: 'security/authorization', memoryClass: 'NON_EVICTABLE_TRUTH',
    entries: null, estimatedBytes: null, configuredLimit: 40, limitUnit: 'entries', targetBytes: null,
    evictable: false, rebuildCost: 'FREE', pressureParticipant: false, scope: 'SESSION',
    provenance: 'platform/security/authorization.ts (MAX_DECISION_EVIDENCE)' }),

  /* ── YENİDEN KURULABİLİR TÜREV ────────────────────────────────────── */
  D({ resourceId: 'routing.graph', owner: 'offlineRoutingService', memoryClass: 'REBUILDABLE_DERIVED',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'EXPENSIVE', pressureParticipant: false, scope: 'GLOBAL',
    provenance: 'platform/offlineRoutingService.ts (worker)' }),
  D({ resourceId: 'poi.searchDatabase', owner: 'offlineSearchService', memoryClass: 'REBUILDABLE_DERIVED',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'EXPENSIVE', pressureParticipant: true, scope: 'GLOBAL',
    provenance: 'platform/offlineSearchService.ts:61 (registerCachePurge KAYITLI)' }),

  /* ── SUNUM ÖNBELLEĞİ ──────────────────────────────────────────────── */
  D({ resourceId: 'artwork.decoded', owner: 'mediaService', memoryClass: 'PRESENTATION_CACHE',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'CHEAP', pressureParticipant: false, scope: 'SESSION',
    provenance: 'platform/mediaService.ts (djb2 dedup VAR, bayt bütçesi YOK)' }),
  D({ resourceId: 'map.tileCacheRam', owner: 'MapLibre', memoryClass: 'PRESENTATION_CACHE',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'NETWORK_REQUIRED', pressureParticipant: false, scope: 'GLOBAL',
    provenance: 'MapCore.ts maxTileCacheSize (MapLibre iç yönetimi — JS ölçemez)' }),

  /* ── ÖNYÜKLEME — BASKIDA İLK GİDEN ────────────────────────────────── */
  D({ resourceId: 'map.tilePrefetch', owner: 'offlineTileDownloader', memoryClass: 'PREFETCH_CACHE',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'NETWORK_REQUIRED', pressureParticipant: false, scope: 'GLOBAL',
    provenance: 'platform/offlineTileDownloader.ts' }),
  D({ resourceId: 'community.prefetch', owner: 'communityService', memoryClass: 'PREFETCH_CACHE',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'NETWORK_REQUIRED', pressureParticipant: false, scope: 'GLOBAL',
    provenance: 'platform/communityService.ts' }),

  /* ── GEÇMİŞ — KIRPILIR, SİLİNMEZ ──────────────────────────────────── */
  D({ resourceId: 'perf.series', owner: 'perfSeriesRecorder', memoryClass: 'HISTORY',
    entries: null, estimatedBytes: null, configuredLimit: 40, limitUnit: 'entries', targetBytes: null,
    evictable: true, rebuildCost: 'FREE', pressureParticipant: false, scope: 'SESSION',
    provenance: 'platform/perfSeriesRecorder.ts (MAX_SAMPLES)' }),
  D({ resourceId: 'boot.serviceTimings', owner: 'bootTimingRecorder', memoryClass: 'HISTORY',
    entries: null, estimatedBytes: null, configuredLimit: 96, limitUnit: 'entries', targetBytes: null,
    evictable: true, rebuildCost: 'FREE', pressureParticipant: false, scope: 'SESSION',
    provenance: 'platform/bootTimingRecorder.ts (MAX_SERVICE_ROWS)' }),
  D({ resourceId: 'obd.evidenceRings', owner: 'obd/* (≈40 halka)', memoryClass: 'HISTORY',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'FREE', pressureParticipant: false, scope: 'VEHICLE',
    provenance: 'her halka KENDİ sabit tavanını taşır (ARCH-01…05)' }),
  D({ resourceId: 'can.learnedInventory', owner: 'obd/capability/capabilityStore', memoryClass: 'HISTORY',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: false, rebuildCost: 'EXPENSIVE', pressureParticipant: false, scope: 'VEHICLE',
    provenance: 'araç bölümlü öğrenme — KULLANICI KAZANIMI, silinmez' }),
  D({ resourceId: 'trip.log', owner: 'tripLogService', memoryClass: 'HISTORY',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: false, rebuildCost: 'UNKNOWN', pressureParticipant: false, scope: 'GLOBAL',
    provenance: 'platform/tripLogService.ts — KULLANICI VERİSİ, baskıda silinmez' }),
  D({ resourceId: 'mavi.memory', owner: 'assistant/maviMemory', memoryClass: 'HISTORY',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'FREE', pressureParticipant: false, scope: 'SESSION',
    provenance: 'platform/assistant/maviMemory.ts (bounded)' }),
  D({ resourceId: 'companion.buffers', owner: 'companion/companionStore', memoryClass: 'HISTORY',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'FREE', pressureParticipant: false, scope: 'SESSION',
    provenance: 'platform/companion/companionStore.ts (bounded)' }),

  /* ── GELİŞTİRİCİ — BASKIDA İLK GİDEN ──────────────────────────────── */
  D({ resourceId: 'debug.rings', owner: 'debug/debugStore', memoryClass: 'DEVTOOLS',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'FREE', pressureParticipant: false, scope: 'SESSION',
    provenance: 'platform/debug/debugStore.ts (ringPush)' }),
  D({ resourceId: 'lab.projections', owner: 'devtools/* (136 kaynak)', memoryClass: 'DEVTOOLS',
    entries: null, estimatedBytes: null, configuredLimit: null, limitUnit: null, targetBytes: null,
    evictable: true, rebuildCost: 'CHEAP', pressureParticipant: false, scope: 'SESSION',
    provenance: 'LAB ekranı MOUNT değilken projeksiyon KOŞMAZ (T2)' }),
]);

export interface MemoryInventorySnapshot {
  readonly resources: readonly MemoryBudgetDescriptor[];
  readonly byClass: Readonly<Record<MemoryClass, number>>;
  /** JS heap (yalnız Chromium); ölçülemiyorsa `null`. */
  readonly jsHeapUsedMb: number | null;
  readonly jsHeapLimitMb: number | null;
  /** Bayt ölçümü OLAN kaynak adedi — dürüstlük göstergesi. */
  readonly measuredByteCount: number;
  /** Baskı kaydı GERÇEKTEN olan kaynak adedi. */
  readonly pressureParticipantCount: number;
  readonly notes: readonly string[];
  readonly provenance: readonly string[];
}

const CLASSES: readonly MemoryClass[] = Object.freeze([
  'NON_EVICTABLE_TRUTH', 'REBUILDABLE_DERIVED', 'PRESENTATION_CACHE',
  'PREFETCH_CACHE', 'HISTORY', 'DEVTOOLS',
]);

/** JS heap — yalnız Chromium sağlar; yoksa `null` (sahte 0 YOK). */
function readHeap(): { usedMb: number | null; limitMb: number | null } {
  try {
    const mem = (performance as unknown as {
      memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
    }).memory;
    if (!mem) return { usedMb: null, limitMb: null };
    const u = mem.usedJSHeapSize;
    const l = mem.jsHeapSizeLimit;
    return {
      usedMb: typeof u === 'number' && Number.isFinite(u) ? u / 1_048_576 : null,
      limitMb: typeof l === 'number' && Number.isFinite(l) ? l / 1_048_576 : null,
    };
  } catch { return { usedMb: null, limitMb: null }; }
}

/** Salt-okunur projeksiyon. Hiçbir cache'e dokunmaz, hiçbir şey silmez. */
export function getMemoryInventory(): MemoryInventorySnapshot {
  const byClass = {} as Record<MemoryClass, number>;
  for (const c of CLASSES) byClass[c] = 0;

  const rows: MemoryBudgetDescriptor[] = [];
  let measured = 0;
  let participants = 0;
  for (const r of RESOURCES) {
    byClass[r.memoryClass] += 1;
    if (r.estimatedBytes !== null) measured += 1;
    if (r.pressureParticipant) participants += 1;
    const entries = readEntries(r.resourceId);
    rows.push(entries === r.entries ? r : Object.freeze({ ...r, entries }));
  }

  const heap = readHeap();
  return Object.freeze({
    resources: Object.freeze(rows),
    byClass: Object.freeze(byClass),
    jsHeapUsedMb: heap.usedMb,
    jsHeapLimitMb: heap.limitMb,
    measuredByteCount: measured,
    pressureParticipantCount: participants,
    notes: Object.freeze([
      'targetBytes F1’de DAİMA null — baseline ölçülmeden hedef bayt konulmaz.',
      'estimatedBytes null olan kaynak, baskı altında EN SON kırpılır (bilinmeyeni önce silmek kördür).',
      'MapLibre iç GPU/tile belleği JS’ten ölçülemez → null (sahte değer üretilmedi).',
      'pressureParticipant = memoryWatchdog.registerCachePurge ile GERÇEKTEN kayıtlı olanlar.',
    ]),
    provenance: Object.freeze([
      'perf/memoryInventory.ts (statik bildirim + bağlı ucuz okuyucular)',
      'performance.memory (yalnız Chromium)',
    ]),
  });
}

/** Statik kilit testleri için kapalı liste. */
export function memoryDescriptors(): readonly MemoryBudgetDescriptor[] { return RESOURCES; }
