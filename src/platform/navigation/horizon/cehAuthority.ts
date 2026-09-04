/**
 * cehAuthority.ts — NAV v3 · L3 · TEK ELECTRONIC HORIZON OTORİTESİ (F3).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F3.2/F3.5.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── TEK CEVAPLAYICI ───────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "Önümde ne var?" sorusunun KANONİK cevabı buradan çıkar. L4 (Routing) ·
 * L5 (Guidance) · L6 (Arbitration) bu soruyu ham sağlayıcılara (harita
 * paketi · denetim noktası paketi · rota adımları · Overpass) SORAMAZ —
 * F0 `NAV_LAYER_DEPENDENCY_LAW` gereği yol gerçeğini ufuktan alır.
 *
 * ── NE İMPORT EDİLİR, NE EDİLMEZ ─────────────────────────────────────────
 * İZİNLİ: L1 `map/store` cephesi · L2 `ego/egoAuthority` cephesi · F0
 * sözleşmeleri · `time/navClock` · `freshnessPolicy` (yalnız TANIMLI eşik).
 * YASAK: `routing-graph.bin` · `NavigationCompute.worker` içi · MapLibre ·
 * tile store · Overpass · offline tile downloader · POI DB · `gpsService` ·
 * `routingService` · `navigationService` (kilit test kaynak taramasıyla
 * denetler).
 *
 * ── TİK SAHİPLİĞİ YOK ────────────────────────────────────────────────────
 * Bu dosya **timer/abonelik/scheduler KURMAZ**. `observe()` çağrısını tik
 * sahibi (`navigationSessionRuntime` → `navEgoHorizonBridge`) yapar.
 *
 * ── ROTA NİYETİ İTİLİR ───────────────────────────────────────────────────
 * `noteRouteIntent()` bileşim kökünden çağrılır. L3 hiçbir L4 modülünü
 * import ETMEZ (ters kenar bağımlılık grafiğini döngülü yapardı).
 *
 * ── BAYAT UPSTREAM TAZEYE YÜKSELTİLEMEZ ──────────────────────────────────
 * Ego bayatsa ufuk `EGO_STALE`tir; rota niyeti bayatsa mesafe iddiası
 * DÜŞÜRÜLÜR. Aşağı akışta hiçbir kanıt yukarı akıştan daha taze OLAMAZ.
 */

import type { MonotonicMs } from '../contracts/navMonotonicTime';
import { monoAgeMs } from '../contracts/navMonotonicTime';
import type { CehHorizonState, ElectronicHorizon } from '../contracts/navHorizon';
import { degradationForHorizonState, horizonBudgetM } from '../contracts/navHorizon';
import type { RouteIntentSnapshot } from './routeIntent';
import { NO_ROUTE_INTENT } from './routeIntent';
import type { HorizonAttributePorts, HorizonAttributeDomain } from './horizonAttributePorts';
import { productionHorizonAttributePorts } from './horizonAttributePorts';
import { buildHorizon } from './horizonModel';
import { readMonotonicNow } from '../time/navClock';
import { getEgoAuthority } from '../ego/egoAuthority';
import type { EgoAuthority } from '../ego/egoAuthority';
import { getMapStore } from '../map/store';
import type { MapStore } from '../map/store';
/* Tazelik BÜTÇESİ deponun TANIMLI eşiğinden gelir — uydurma eşik YASAK. */
import { GPS_FIX_STALE_MS } from '../../freshnessPolicy';

/* ══════════════════════════════════════════════════════════════════════════
   1) TEŞHİS GÖRÜNTÜSÜ (salt-okunur — LAB için; KOORDİNAT TAŞIMAZ)
   ══════════════════════════════════════════════════════════════════════════ */

export interface CehDiagnostics {
  /** Hiç ufuk üretildi mi. */
  readonly initialized: boolean;
  readonly state: CehHorizonState;
  readonly generation: number;
  /** Kaç `observe()` çağrısı işlendi. */
  readonly observations: number;
  /** Monotonik saat okunabiliyor mu (yoksa hiçbir ufuk yayınlanmaz). */
  readonly monotonicClock: boolean;
  /** Son ufkun yaşı (ms) — `null` = hiç üretilmedi. */
  readonly horizonAgeMs: number | null;
  readonly pathCount: number;
  readonly mppPresent: boolean;
  readonly ambiguous: boolean;
  readonly physicallyConfirmed: boolean;
  readonly objectCount: number;
  readonly budgetM: number;
  /** L1 yol ağı hükmü: `true`/`false`/`null` = ÖLÇÜLMEDİ. */
  readonly mapAvailable: boolean | null;
  /** Rota niyeti itildi mi ve kaç kez. */
  readonly routeIntentAvailable: boolean;
  readonly routeIntentPushes: number;
  /** Rota niyeti projeksiyonunun yaşı (ms) — `null` = ölçülemedi. */
  readonly routeIntentAgeMs: number | null;
  /** Motor içinden kaçan hata sayısı (fail-soft ile yutuldu). */
  readonly errorCount: number;
  /**
   * Şu an bağlı öznitelik portunun GERÇEKTEN ürettiği alanlar (F6). Beyan
   * DEĞİL — bağlı portun `boundDomains` KAPASİTESİDİR. Boş dizi = hiçbir
   * öznitelik alanı bağlı değil (üretim varsayılanı).
   */
  readonly boundDomains: readonly HorizonAttributeDomain[];
}

const _EMPTY_DIAGNOSTICS: CehDiagnostics = {
  initialized: false,
  state: 'NO_HORIZON_SOURCE',
  generation: 0,
  observations: 0,
  monotonicClock: false,
  horizonAgeMs: null,
  pathCount: 0,
  mppPresent: false,
  ambiguous: false,
  physicallyConfirmed: false,
  objectCount: 0,
  budgetM: horizonBudgetM(null),
  mapAvailable: null,
  routeIntentAvailable: false,
  routeIntentPushes: 0,
  routeIntentAgeMs: null,
  errorCount: 0,
  boundDomains: [],
};

/* ══════════════════════════════════════════════════════════════════════════
   2) CEPHE
   ══════════════════════════════════════════════════════════════════════════ */

export interface CehAuthority {
  /** Bir ufuk adımı üretir. Tik SAHİBİ DEĞİLDİR — çağıran tetikler. */
  observe(): void;
  /**
   * Rota niyetini İTER (L4 → L3). Ufuk ÜRETMEZ; yalnız bir sonraki
   * `observe()` için girdiyi tazeler.
   */
  noteRouteIntent(intent: RouteIntentSnapshot): void;
  /** Kanonik ufuk. Üretilemiyorsa `null`. */
  getHorizon(): ElectronicHorizon | null;
  getDiagnostics(): CehDiagnostics;
  reset(): void;
  /**
   * Öznitelik portunu SONRADAN bağlar (F6 bileşim kökü:
   * `navEgoHorizonBridge` → burası). `horizon/**` bu portun ARKASINDAKİ ham
   * sağlayıcıyı hiç GÖRMEZ — yalnız sözleşmeyi bilir. Bozuk/eksik nesne
   * SESSİZCE reddedilir (üretim varsayılanı korunur, throw YOK).
   */
  bindAttributePorts(ports: HorizonAttributePorts): void;
}

export interface CehAuthorityDeps {
  readonly ego: EgoAuthority;
  readonly map: MapStore;
  readonly attributes?: HorizonAttributePorts;
  /** Monotonik saat okuma noktası (enjekte edilebilir — testler için). */
  readonly clock?: () => MonotonicMs | null;
  /** Ego tazelik bütçesi (ms). Verilmezse deponun TANIMLI eşiği. */
  readonly egoFreshnessBudgetMs?: number | null;
  /**
   * Rota ↔ fiziksel eşleşme çelişki eşiği (m). L4'ün kendi sapma eşiği
   * dışarıdan verilir; L3 kendi eşiğini İCAT ETMEZ. `null` → çelişki
   * kontrolü yapılmaz.
   */
  readonly routeConflictThresholdM?: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) FABRİKA
   ══════════════════════════════════════════════════════════════════════════ */

export function createCehAuthority(deps: CehAuthorityDeps): CehAuthority {
  const ego = deps.ego;
  const map = deps.map;
  /* F6: SONRADAN bağlanabilir (`bindAttributePorts`) — bu yüzden `let`.
     Bileşim kökü henüz bağlamadıysa üretim varsayılanı (fail-closed,
     `UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS` ile AYNI referans) geçerlidir. */
  let attributes = deps.attributes ?? productionHorizonAttributePorts;
  const clock = deps.clock ?? readMonotonicNow;
  const egoFreshnessBudgetMs = deps.egoFreshnessBudgetMs === undefined
    ? GPS_FIX_STALE_MS
    : deps.egoFreshnessBudgetMs;
  const routeConflictThresholdM = deps.routeConflictThresholdM ?? null;

  let horizon: ElectronicHorizon | null = null;
  let diag: CehDiagnostics = _EMPTY_DIAGNOSTICS;
  let generation = 0;
  let intent: RouteIntentSnapshot = NO_ROUTE_INTENT;
  let intentPushes = 0;
  let errorCount = 0;

  function _reset(): void {
    horizon = null;
    diag = _EMPTY_DIAGNOSTICS;
    generation = 0;
    intent = NO_ROUTE_INTENT;
    intentPushes = 0;
    errorCount = 0;
  }

  function _noteRouteIntent(next: RouteIntentSnapshot): void {
    /* Bozuk/eksik itilirse rota niyeti YOK sayılır — yarım niyetle mesafe
       üretmek uydurma mesafe demektir. */
    intent = (next && typeof next === 'object' && typeof next.available === 'boolean')
      ? next
      : NO_ROUTE_INTENT;
    intentPushes++;
  }

  function _mapAvailable(now: MonotonicMs): boolean | null {
    try {
      const ds = map.getDatasetStatus('ROUTING_GRAPH', now);
      if (!ds || ds.value === null) return null;      // ÖLÇÜLMEDİ ≠ YOK
      const a = ds.value.availability;
      if (a === 'AVAILABLE_FRESH' || a === 'AVAILABLE_STALE') return true;
      if (a === 'UNAVAILABLE' || a === 'INVALID') return false;
      return null;
    } catch {
      errorCount++;
      return null;
    }
  }

  function _observe(): void {
    const observations = diag.observations + 1;
    const now = clock();

    /* FAIL-CLOSED: monotonik saat yoksa yaş/tazelik hesaplanamaz → ufuk
       YAYINLANMAZ (uydurma zaman, uydurma mesafe demektir). */
    if (now === null) {
      horizon = null;
      diag = {
        ..._EMPTY_DIAGNOSTICS, observations, monotonicClock: false, errorCount,
        boundDomains: attributes.boundDomains,
      };
      return;
    }

    let egoPose = null;
    let matched = null;
    try {
      egoPose = ego.getRealtimeEgoPose();
      matched = ego.getMatchedRoadPose();
    } catch {
      errorCount++;
    }

    const mapAvailable = _mapAvailable(now);
    generation++;

    let next: ElectronicHorizon;
    try {
      next = buildHorizon({
        nowMonoMs: now,
        generation,
        ego: egoPose,
        matched,
        route: intent,
        mapAvailable,
        attributes,
        egoFreshnessBudgetMs,
        /* Eşik NİYETLE birlikte gelir (L4 sahibidir); deps yalnız test
           amaçlı ezme yoludur. İkisi de yoksa çelişki kontrolü YAPILMAZ. */
        routeConflictThresholdM: routeConflictThresholdM ?? intent.conflictThresholdM,
      });
    } catch {
      /* Fail-soft: motor hatası navigasyonu ÖLDÜRMEZ; ufuk yayınlanmaz. */
      errorCount++;
      horizon = null;
      diag = {
        ..._EMPTY_DIAGNOSTICS, observations, monotonicClock: true,
        generation, mapAvailable, errorCount,
        routeIntentAvailable: intent.available, routeIntentPushes: intentPushes,
        boundDomains: attributes.boundDomains,
      };
      return;
    }

    horizon = next;

    let objectCount = 0;
    let physicallyConfirmed = false;
    for (const p of next.paths) {
      objectCount += p.objects.length;
      if (p.physicallyConfirmed) physicallyConfirmed = true;
    }

    diag = {
      initialized: true,
      state: next.state,
      generation: next.generation,
      observations,
      monotonicClock: true,
      horizonAgeMs: 0,
      pathCount: next.paths.length,
      mppPresent: next.mppPathId !== null,
      ambiguous: next.ambiguous,
      physicallyConfirmed,
      objectCount,
      budgetM: next.budgetM,
      mapAvailable,
      routeIntentAvailable: intent.available,
      routeIntentPushes: intentPushes,
      routeIntentAgeMs: monoAgeMs(intent.observedAtMonoMs, now),
      errorCount,
      boundDomains: attributes.boundDomains,
    };
  }

  function _bindAttributePorts(ports: HorizonAttributePorts): void {
    /* Bozuk nesne SESSİZCE reddedilir — üretim varsayılanı korunur. Bu bir
       gözlem/tanı yolu değildir; bileşim kökünün TEK seferlik çağrısıdır,
       throw etmek navigasyonu devirmez ama gereksiz risktir. */
    if (!ports || typeof ports.readAhead !== 'function' || !Array.isArray(ports.boundDomains)) {
      return;
    }
    attributes = ports;
  }

  return {
    observe: _observe,
    noteRouteIntent: _noteRouteIntent,
    getHorizon: () => horizon,
    getDiagnostics: () => {
      /* `boundDomains` CANLI okunur — bağlama bir `observe()` BEKLEMEZ.
         "Port bağlı mı" ile "ufuk üretildi mi" AYRI sorulardır (F6). */
      if (!diag.initialized || horizon === null) {
        return { ...diag, boundDomains: attributes.boundDomains };
      }
      /* Yaş OKUMA ANINDA hesaplanır — donmuş yaş taze görünmesin diye. */
      const now = clock();
      if (now === null) return { ...diag, boundDomains: attributes.boundDomains };
      return {
        ...diag,
        horizonAgeMs: monoAgeMs(horizon.tsMonoMs, now),
        boundDomains: attributes.boundDomains,
      };
    },
    reset: _reset,
    bindAttributePorts: _bindAttributePorts,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ÜRETİM TEKİLİ
   ══════════════════════════════════════════════════════════════════════════ */

let _instance: CehAuthority | null = null;

/**
 * Üretim L3 cephesi (tekil). **Timer kurmaz · abonelik açmaz · ağa çıkmaz ·
 * hiçbir kaynağı başlatmaz** — yalnız `observe()` çağrıldığında senkron okur.
 */
export function getCehAuthority(): CehAuthority {
  if (_instance === null) {
    _instance = createCehAuthority({
      ego: getEgoAuthority(),
      map: getMapStore(),
    });
  }
  return _instance;
}

/** Kanonik bozulma katkısı — tüketiciler kendi eşlemesini KURMAZ. */
export function cehDegradation(): ReturnType<typeof degradationForHorizonState> {
  const h = _instance?.getHorizon() ?? null;
  return degradationForHorizonState(h?.state ?? 'NO_HORIZON_SOURCE');
}

/** @internal testler arası izolasyon. */
export function _resetCehAuthorityForTest(): void {
  _instance = null;
}
