/**
 * musicSearchCoordinator.ts — F5 · Birleşik arama ORKESTRASYONU.
 *
 * ═══ NE OLDUĞU ═══
 * `query → normalize → uygun kaynak seçimi → sınırlı paralel arama →
 *  sonuç normalizasyonu → tekilleştirme → sıralama → gruplu projeksiyon`
 *
 * ═══ NE OLMADIĞI (PAZARLIKSIZ) ═══
 *   · **Birleşik truth otoritesi DEĞİLDİR.** `LOCAL` gerçeği `musicIndex`'ten,
 *     sağlayıcı sonucu ilgili sağlayıcıdan gelir; burada yeni gerçek üretilmez.
 *   · Playback komutu GÖNDERMEZ. Kuyruk/oturum YAZMAZ. Library state YAZMAZ.
 *   · Sağlayıcı durumunu SAHİPLENMEZ — yalnız gözlemlenen kullanılabilirliği okur.
 *
 * ═══ BAYATLIK (Cross-Domain §17) ═══
 * Her arama bir KUŞAK (generation) taşır. "sezen" sorgusunun geç gelen sonucu
 * "sezen aksu" sorgusunun durumunu DEĞİŞTİREMEZ — bayat sonuç DÜŞÜRÜLÜR ve
 * sayaca yazılır. Aynı kuşaktan gelen yinelenen geri çağrı da bir kez sayılır.
 */
import { getSource, isKnownSourceClass, type SourceClass } from '../authority/sourceCapabilities';
import type { ProviderId } from '../providers';
import { dedupeResults } from './searchDedup';
import { normalizeQuery } from './searchNormalize';
import { rankResults } from './searchRanking';
import type { SearchResult, SearchResultKind } from './searchResult';
import {
  noteCancellation, noteFirstResult, noteProjection, noteQueryStarted,
  noteSearchComplete, noteSearchState, noteSourceRun, noteStaleResultDropped,
} from './searchTelemetry';

/* ── Kaynak portu ────────────────────────────────────────────────────────── */

export interface SearchSourcePort {
  readonly providerId: ProviderId;
  readonly sourceClass: SourceClass;
  /**
   * Kaynak ŞU AN aranabilir mi — GÖZLENEN durum, varsayım DEĞİL.
   * (Spotify oturumu yoksa `false`; ağ yoksa sağlayıcı `false` döndürebilir.)
   */
  isAvailable(): boolean;
  /** Yerel kaynak senkron olabilir; ağ kaynağı `AbortSignal`'a uymalıdır. */
  search(query: string, signal: AbortSignal): Promise<readonly SearchResult[]>;
  /** Sonuç beklemeden önce tanınan üst süre. */
  readonly timeoutMs?: number;
}

/* ── Durum ───────────────────────────────────────────────────────────────── */

export type SearchState =
  /** Hiç arama yapılmadı. */
  | 'IDLE'
  /** Kaynaklar çalışıyor, henüz hiçbiri dönmedi. */
  | 'SEARCHING'
  /** Bazı kaynaklar döndü, hepsi bitmedi — "tamamlandı" DENMEZ. */
  | 'PARTIAL'
  /** Uygun tüm kaynaklar sorunsuz tamamlandı. */
  | 'COMPLETE'
  /** Tamamlandı ama en az bir kaynak düştü/zaman aşımına uğradı. */
  | 'DEGRADED';

export type SourceRunState =
  | 'PENDING' | 'OK' | 'EMPTY' | 'FAILED' | 'TIMEOUT'
  | 'SKIPPED_UNSUPPORTED' | 'SKIPPED_UNAVAILABLE';

export interface SourceRunStatus {
  readonly providerId: ProviderId;
  readonly sourceClass: SourceClass;
  readonly state: SourceRunState;
  readonly resultCount: number;
  readonly elapsedMs: number | null;
}

/** Kullanıcıya gösterilecek boş/başarısızlık ayrımı — hepsi "sonuç yok" DEĞİL. */
export type SearchEmptyReason =
  | null
  | 'NO_QUERY'
  | 'NO_RESULTS'
  | 'NO_ELIGIBLE_SOURCE'
  | 'ALL_SOURCES_UNAVAILABLE'
  | 'ALL_SOURCES_FAILED';

export interface SearchSnapshot {
  readonly generation: number;
  /** Normalize edilmiş sorgu (arama anahtarı) — gösterim için değil. */
  readonly query: string;
  readonly state: SearchState;
  readonly results: readonly SearchResult[];
  readonly sources: readonly SourceRunStatus[];
  readonly emptyReason: SearchEmptyReason;
  readonly mergedCount: number;
  readonly ambiguousKept: number;
}

export const EMPTY_SEARCH_SNAPSHOT: SearchSnapshot = Object.freeze({
  generation: 0, query: '', state: 'IDLE' as const,
  results: Object.freeze([] as readonly SearchResult[]),
  sources: Object.freeze([] as readonly SourceRunStatus[]),
  emptyReason: null, mergedCount: 0, ambiguousKept: 0,
});

/* ── Modül durumu ────────────────────────────────────────────────────────── */

const DEFAULT_TIMEOUT_MS = 8000;
/** Sıralamaya giren aday üst sınırı — sınırsız birleştirme yapılmaz. */
export const MAX_RESULTS = 120;

let ports: readonly SearchSourcePort[] = [];
let snapshot: SearchSnapshot = EMPTY_SEARCH_SNAPSHOT;
let generation = 0;
/** Sesli/arka plan aramalarının AYRI kuşağı — yüzey kuşağını kirletmez. */
let detachedGeneration = 0;
let inFlightController: AbortController | null = null;
const subs = new Set<() => void>();

function emit(next: SearchSnapshot): void {
  snapshot = Object.freeze(next);
  subs.forEach((fn) => { try { fn(); } catch { /* abone hatası aramayı bozmaz */ } });
}

export function getSearchSnapshot(): SearchSnapshot { return snapshot; }
export function subscribeSearch(listener: () => void): () => void {
  subs.add(listener); return () => { subs.delete(listener); };
}

/** Kaynak portlarını kaydeder. Üretimde bir kez, testte enjekte edilir. */
export function configureSearchSources(next: readonly SearchSourcePort[]): void {
  ports = Object.freeze([...next]);
}

export function getConfiguredSearchSources(): readonly SearchSourcePort[] { return ports; }

/* ── Uygunluk kapısı ─────────────────────────────────────────────────────── */

export interface EligibilityDecision {
  readonly port: SearchSourcePort;
  readonly eligible: boolean;
  readonly skip: 'SKIPPED_UNSUPPORTED' | 'SKIPPED_UNAVAILABLE' | null;
}

/**
 * Hangi kaynağa sorgu gidebilir.
 *
 * İki AYRI red vardır ve karıştırılmaz: kaynak arama semantiğini hiç
 * DESTEKLEMİYOR olabilir (Bluetooth), ya da destekliyor ama ŞU AN
 * kullanılamıyor olabilir (Spotify oturumu yok). İkisi farklı teşhistir.
 */
export function decideEligibility(port: SearchSourcePort): EligibilityDecision {
  let supportsSearch = false;
  try {
    supportsSearch = isKnownSourceClass(port.sourceClass)
      && getSource(port.sourceClass).capabilities.supportsSearch === true;
  } catch { supportsSearch = false; }

  if (!supportsSearch) {
    return Object.freeze({ port, eligible: false, skip: 'SKIPPED_UNSUPPORTED' as const });
  }
  let available = false;
  try { available = port.isAvailable() === true; } catch { available = false; }
  if (!available) {
    return Object.freeze({ port, eligible: false, skip: 'SKIPPED_UNAVAILABLE' as const });
  }
  return Object.freeze({ port, eligible: true, skip: null });
}

/* ── Projeksiyon ─────────────────────────────────────────────────────────── */

function project(raw: readonly SearchResult[]): {
  results: readonly SearchResult[]; merged: number; ambiguousKept: number;
} {
  const startedAt = performance.now();
  const deduped = dedupeResults(raw);
  const ranked = rankResults(deduped.results).slice(0, MAX_RESULTS);
  noteProjection({
    elapsedMs: performance.now() - startedAt,
    normalized: ranked.length,
    merged: deduped.mergedCount,
    ambiguousKept: deduped.ambiguousKept,
    topSignals: ranked[0]?.evidence.signals ?? [],
  });
  return { results: ranked, merged: deduped.mergedCount, ambiguousKept: deduped.ambiguousKept };
}

function emptyReasonFor(
  results: readonly SearchResult[], statuses: readonly SourceRunStatus[], query: string,
): SearchEmptyReason {
  if (results.length > 0) return null;
  if (!query) return 'NO_QUERY';
  if (statuses.length === 0) return 'NO_ELIGIBLE_SOURCE';
  const ran = statuses.filter((s) => s.state === 'OK' || s.state === 'EMPTY');
  if (ran.length === 0) {
    const allUnavailable = statuses.every(
      (s) => s.state === 'SKIPPED_UNAVAILABLE' || s.state === 'SKIPPED_UNSUPPORTED',
    );
    return allUnavailable ? 'ALL_SOURCES_UNAVAILABLE' : 'ALL_SOURCES_FAILED';
  }
  return 'NO_RESULTS';
}

/* ── Yürütme ─────────────────────────────────────────────────────────────── */

/** Devam eden aramayı iptal eder (kullanıcı alanı temizledi / ekran kapandı). */
export function cancelSearch(): void {
  if (!inFlightController) return;
  generation += 1;                    // uçuşan sonuçlar artık BAYAT
  inFlightController.abort();
  inFlightController = null;
  noteCancellation();
  noteSearchState('IDLE');
  emit({ ...EMPTY_SEARCH_SNAPSHOT, generation });
}

/**
 * Birleşik arama çalıştırır.
 *
 * `LOCAL` gibi hızlı kaynaklar döner dönmez yayınlanır (kullanıcı beklemez), ama
 * durum tüm uygun kaynaklar bitene kadar `COMPLETE` OLMAZ — "arama tamamlandı"
 * iddiası yalnız gerçekten tamamlanınca kurulur.
 */
export function runSearch(rawQuery: string): Promise<SearchSnapshot> {
  return executeSearch(rawQuery, { publishToSurface: true });
}

/**
 * F5.1 · Yüzeye YAYIN YAPMADAN arama (sesli komut yolu).
 *
 * Sesli bir istek, kullanıcının açık olan arama ekranını DEĞİŞTİRMEMELİDİR;
 * ama ikinci bir orkestrasyon, ikinci bir sıralama veya ikinci bir tekilleştirme
 * de kurulmaz — aynı `executeSearch` çalışır, yalnız sonuç yayınlanmaz ve UI
 * kuşağı ilerletilmez.
 */
export function searchOnce(rawQuery: string): Promise<SearchSnapshot> {
  return executeSearch(rawQuery, { publishToSurface: false });
}

async function executeSearch(
  rawQuery: string, options: { readonly publishToSurface: boolean },
): Promise<SearchSnapshot> {
  const query = normalizeQuery(rawQuery);
  const toSurface = options.publishToSurface;
  /* Kuşak sayaçları AYRIDIR: sesli arama, ekrandaki aramayı bayatlatmaz ve
     ekrandaki arama sesli sonucu düşürmez. Bayatlık kuralı her iki hatta da
     AYNI biçimde uygulanır. */
  const myGeneration = toSurface ? ++generation : ++detachedGeneration;
  const currentGeneration = (): number => (toSurface ? generation : detachedGeneration);
  const startedAt = performance.now();

  const controller = new AbortController();
  if (toSurface) {
    if (inFlightController) inFlightController.abort();
    inFlightController = controller;
  }

  if (!query) {
    // Boş sorgu bir arama değildir: sağlayıcılara istek GİTMEZ.
    noteQueryStarted({ generation: myGeneration, queryLength: 0, eligible: [] });
    noteSearchState('IDLE');
    const empty: SearchSnapshot = Object.freeze({
      ...EMPTY_SEARCH_SNAPSHOT, generation: myGeneration, state: 'IDLE' as const,
      emptyReason: 'NO_QUERY' as const,
    });
    if (toSurface) { emit(empty); inFlightController = null; }
    return empty;
  }

  const decisions = ports.map(decideEligibility);
  const eligible = decisions.filter((d) => d.eligible);

  const statuses = new Map<ProviderId, SourceRunStatus>();
  decisions.forEach((d) => {
    statuses.set(d.port.providerId, Object.freeze({
      providerId: d.port.providerId,
      sourceClass: d.port.sourceClass,
      state: (d.eligible ? 'PENDING' : d.skip!) as SourceRunState,
      resultCount: 0,
      elapsedMs: null,
    }));
    if (!d.eligible) {
      noteSourceRun({
        providerId: d.port.providerId, outcome: d.skip!, resultCount: 0,
        elapsedMs: null, generation: myGeneration,
      });
    }
  });

  noteQueryStarted({
    generation: myGeneration, queryLength: query.length,
    eligible: eligible.map((d) => d.port.providerId),
  });

  const collected: SearchResult[] = [];
  let firstResultSeen = false;
  let pending = eligible.length;

  /** Son hesaplanan projeksiyon — yayınlanmayan hatta da sonuç döndürülebilsin. */
  let latest: SearchSnapshot = { ...EMPTY_SEARCH_SNAPSHOT, generation: myGeneration, query };

  const publish = (state: SearchState): void => {
    // BAYATLIK KAPISI: eski kuşağın yayını yeni aramanın durumunu EZEMEZ.
    if (myGeneration !== currentGeneration()) { noteStaleResultDropped(); return; }
    const projected = project(collected);
    latest = Object.freeze({
      generation: myGeneration,
      query,
      state,
      results: projected.results,
      sources: Array.from(statuses.values()),
      emptyReason: state === 'COMPLETE' || state === 'DEGRADED'
        ? emptyReasonFor(projected.results, Array.from(statuses.values()), query)
        : null,
      mergedCount: projected.merged,
      ambiguousKept: projected.ambiguousKept,
    });
    if (toSurface) emit(latest);
  };

  publish('SEARCHING');

  if (eligible.length === 0) {
    const done: SearchSnapshot = {
      generation: myGeneration, query, state: 'DEGRADED',
      results: Object.freeze([] as readonly SearchResult[]),
      sources: Array.from(statuses.values()),
      emptyReason: emptyReasonFor([], Array.from(statuses.values()), query),
      mergedCount: 0, ambiguousKept: 0,
    };
    if (myGeneration === currentGeneration() && toSurface) emit(done);
    noteSearchComplete({ elapsedMs: performance.now() - startedAt, state: 'DEGRADED', finalCount: 0 });
    if (toSurface) inFlightController = null;
    return done;
  }

  const runOne = async (port: SearchSourcePort): Promise<void> => {
    const sourceStartedAt = performance.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    try {
      const budget = port.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const results = await Promise.race([
        port.search(query, controller.signal),
        new Promise<readonly SearchResult[]>((_, reject) => {
          timer = setTimeout(() => { timedOut = true; reject(new Error('search_timeout')); }, budget);
        }),
      ]);
      const elapsedMs = performance.now() - sourceStartedAt;

      // Bayat kuşak: sonucu TOPLAMAYIZ bile — eski sorgu yeniyi kirletemez.
      if (myGeneration !== currentGeneration()) {
        noteStaleResultDropped();
        noteSourceRun({
          providerId: port.providerId, outcome: 'OK', resultCount: results.length,
          elapsedMs, generation: myGeneration,
        });
        return;
      }

      collected.push(...results);
      statuses.set(port.providerId, Object.freeze({
        providerId: port.providerId, sourceClass: port.sourceClass,
        state: results.length > 0 ? 'OK' : 'EMPTY',
        resultCount: results.length, elapsedMs,
      }));
      noteSourceRun({
        providerId: port.providerId, outcome: results.length > 0 ? 'OK' : 'EMPTY',
        resultCount: results.length, elapsedMs, generation: myGeneration,
      });
      if (!firstResultSeen && results.length > 0) {
        firstResultSeen = true;
        noteFirstResult(performance.now() - startedAt);
      }
    } catch {
      const elapsedMs = performance.now() - sourceStartedAt;
      if (myGeneration === currentGeneration()) {
        statuses.set(port.providerId, Object.freeze({
          providerId: port.providerId, sourceClass: port.sourceClass,
          state: timedOut ? 'TIMEOUT' : 'FAILED', resultCount: 0, elapsedMs,
        }));
      }
      noteSourceRun({
        providerId: port.providerId, outcome: timedOut ? 'TIMEOUT' : 'FAILED',
        resultCount: 0, elapsedMs, generation: myGeneration,
      });
    } finally {
      if (timer !== null) clearTimeout(timer);
      pending -= 1;
      /* Bir kaynağın düşmesi DİĞERLERİNİN sonucunu yok etmez; kısmi sonuç
         gösterilir ama "tamamlandı" denmez. */
      if (pending > 0) publish('PARTIAL');
    }
  };

  await Promise.allSettled(eligible.map((d) => runOne(d.port)));

  if (myGeneration !== currentGeneration()) {
    // Bu arama yerini yenisine bıraktı: son durumu YAZMAYIZ.
    noteStaleResultDropped();
    return toSurface ? snapshot : latest;
  }

  const failed = Array.from(statuses.values()).some(
    (s) => s.state === 'FAILED' || s.state === 'TIMEOUT',
  );
  const finalState: SearchState = failed ? 'DEGRADED' : 'COMPLETE';
  publish(finalState);
  noteSearchComplete({
    elapsedMs: performance.now() - startedAt,
    state: finalState,
    finalCount: latest.results.length,
  });
  if (toSurface) inFlightController = null;
  return latest;
}

export function _resetSearchCoordinatorForTest(): void {
  ports = [];
  snapshot = EMPTY_SEARCH_SNAPSHOT;
  generation = 0;
  detachedGeneration = 0;
  if (inFlightController) { inFlightController.abort(); inFlightController = null; }
  subs.clear();
}

export type { SearchResult, SearchResultKind };
