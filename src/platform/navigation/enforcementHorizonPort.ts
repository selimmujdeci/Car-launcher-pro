/**
 * enforcementHorizonPort.ts — NAV v3 · DENETİM NOKTASI ↔ CEH ÖZNİTELİK PORTU
 * (bileşim kökü seviyesi · F6).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F6.5 · CLAUDE.md §CROSS-DOMAIN 1/2/3/10.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN `horizon/` AĞACINDA DEĞİL ───────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `horizon/**` L3 SINIRIDIR ve ham "ileride" sağlayıcısını (`enforcement/**`)
 * DOĞRUDAN İTHAL EDEMEZ (`horizonAttributePorts.ts` §"F3'te neden üretim
 * bağlantısı yok", F3 K1/K14 kilitleri). Bu dosya L3'ün DIŞINDA, tıpkı
 * `navEgoHorizonBridge.ts` gibi bir BİLEŞİM KÖKÜDÜR: `HorizonAttributePorts`
 * SÖZLEŞMESİNİ (aşağı yönde) uygular, ham sağlayıcıyı (yukarı yönde) okur.
 * `horizon/**` içindeki hiçbir dosya BU dosyayı import ETMEZ — yön TERSTİR:
 * bileşim kökü (`navEgoHorizonBridge`) HEM bunu HEM `cehAuthority`yi görür ve
 * ikisini `CehAuthority.bindAttributePorts()` ile bağlar.
 *
 * ── ZİNCİR ─────────────────────────────────────────────────────────────────
 *   `MatchedRoadPose` (L2) → `MapStore.expandCorridor` (L1, F6 sınırlı
 *   gezinme) → `enforcementPointsSource` (ham denetim paketi) →
 *   `enforcementEdgeIndex.matchEnforcementPointToEdge` (SAF eşleştirici) →
 *   `alongCorridorDistanceM` (koridor İÇİ yol-boyu mesafe) → `HorizonObject`.
 *
 * ── İKİNCİ OTORİTE YOK ─────────────────────────────────────────────────────
 * Bu dosya hiçbir kararı YENİDEN ÜRETMEZ: graf L1'in (`mapStore`), eşleştirme
 * `enforcementEdgeIndex`'in, koridor `boundedCorridor`'un tekelidir. Burada
 * yalnız bunların SIRALI BAĞLANMASI vardır — kendi topoloji/mesafe hesabı YOK.
 *
 * ── SADECE ENFORCEMENT ─────────────────────────────────────────────────────
 * `boundDomains = ['ENFORCEMENT']`. Hız limiti/viraj/eğim bu portun işi
 * DEĞİLDİR ve UYDURULMAZ — kaynakları bugün bu binary'de yoktur
 * (`horizonAttributePorts.ts` §"NEDEN ALAN ALAN").
 *
 * ── FAIL-SOFT, AMA SESSİZ DEĞİL ────────────────────────────────────────────
 * Bu port `CehAuthority`nin İÇİNDEN, tik sahibinin sıcak yolunda çağrılır.
 * Hiçbir hata ufku/navigasyonu DÜŞÜREMEZ — `readAhead` hiçbir zaman throw
 * etmez (dış `try/catch` son çare). Ama fail-soft `NOT_MEASURED`i
 * `NO_OBJECTS_IN_RANGE` gibi SUNMAZ (kilit test denetler).
 */

import type {
  HorizonAttributePorts, HorizonAttributeQuery, HorizonAttributeResult,
} from './horizon/horizonAttributePorts';
import type { HorizonObject } from './contracts/navHorizon';
import { derivedNav, unavailableNav } from './contracts/navEvidence';
import { getMapStore } from './map/store';
import { corridorContainsEdge, alongCorridorDistanceM } from './map/store/mapStore';
import type { RoadCorridor } from './map/store/mapStore';
import { CORRIDOR_HARD_MAX_BUDGET_M } from './map/graph/boundedCorridor';
import {
  isEnforcementPackageReady, getEnforcementSourceStatus, queryEnforcementPointsNear,
} from './enforcement/enforcementPointsSource';
import {
  matchEnforcementPointToEdge, foldEnforcementMatch, EMPTY_ENFORCEMENT_MATCH_COUNTERS,
  ENFORCEMENT_EDGE_QUERY_RADIUS_M,
} from './enforcement/enforcementEdgeIndex';
import type { EnforcementMatchCounters } from './enforcement/enforcementEdgeIndex';

/* ══════════════════════════════════════════════════════════════════════════
   1) GÖZLEM (LAB — salt-okunur; koordinat/etiket serbest metni TAŞIMAZ)
   ══════════════════════════════════════════════════════════════════════════ */

export interface EnforcementHorizonPortSnapshot {
  /** `readAhead` kaç kez çağrıldı. */
  readonly calls: number;
  /** Son çağrının port-seviyesi hükmü. */
  readonly lastOutcome: HorizonAttributeResult['outcome'] | null;
  /** Son çağrıda koridor hangi tavanla bitti (`COMPLETE`/`BUDGET_EXHAUSTED`/…). */
  readonly lastCorridorOutcome: RoadCorridor['outcome'] | null;
  readonly lastCorridorEdgeCount: number | null;
  readonly lastCorridorNodeExpansions: number | null;
  readonly lastCorridorBranchCount: number | null;
  /**
   * Son koridor bir TAVAN yüzünden KESİLDİ mi. Bu alan bir tanı süsü değil,
   * hükmün GİRDİSİDİR: kesikken boş sonuç `NOT_MEASURED` olur, `NO_OBJECTS_
   * IN_RANGE` OLMAZ. Sahada "neden yok demedi" sorusunun cevabı burasıdır.
   */
  readonly lastCorridorTruncated: boolean | null;
  /** Son çağrıda yarıçapta aday nokta sayısı (eşleşmeden ÖNCE). */
  readonly lastCandidateCount: number | null;
  /** Son çağrıda üretilen `HorizonObject` sayısı. */
  readonly lastObjectCount: number | null;
  /** Son çağrının ölçülen süresi (ms) — düşük-uç cihaz sıcak-yol maliyeti. */
  readonly lastDurationMs: number | null;
  /** Kümülatif eşleştirme dağılımı (MATCHED/AMBIGUOUS/NO_MATCH/…). */
  readonly cumulativeMatch: EnforcementMatchCounters;
}

let _calls = 0;
let _lastOutcome: HorizonAttributeResult['outcome'] | null = null;
let _lastCorridorOutcome: RoadCorridor['outcome'] | null = null;
let _lastCorridorEdgeCount: number | null = null;
let _lastCorridorNodeExpansions: number | null = null;
let _lastCorridorBranchCount: number | null = null;
let _lastCorridorTruncated: boolean | null = null;
let _lastCandidateCount: number | null = null;
let _lastObjectCount: number | null = null;
let _lastDurationMs: number | null = null;
let _cumulativeMatch: EnforcementMatchCounters = EMPTY_ENFORCEMENT_MATCH_COUNTERS;

/** Salt-okunur anlık görüntü — CAROS LAB'ın TEK okuma ucu. Yan etkisi YOKTUR. */
export function getEnforcementHorizonPortSnapshot(): EnforcementHorizonPortSnapshot {
  return {
    calls: _calls,
    lastOutcome: _lastOutcome,
    lastCorridorOutcome: _lastCorridorOutcome,
    lastCorridorEdgeCount: _lastCorridorEdgeCount,
    lastCorridorNodeExpansions: _lastCorridorNodeExpansions,
    lastCorridorBranchCount: _lastCorridorBranchCount,
    lastCorridorTruncated: _lastCorridorTruncated,
    lastCandidateCount: _lastCandidateCount,
    lastObjectCount: _lastObjectCount,
    lastDurationMs: _lastDurationMs,
    cumulativeMatch: _cumulativeMatch,
  };
}

/** @internal testler arası izolasyon. */
export function _resetEnforcementHorizonPortForTest(): void {
  _calls = 0;
  _lastOutcome = null;
  _lastCorridorOutcome = null;
  _lastCorridorEdgeCount = null;
  _lastCorridorNodeExpansions = null;
  _lastCorridorBranchCount = null;
  _lastCorridorTruncated = null;
  _lastCandidateCount = null;
  _lastObjectCount = null;
  _lastDurationMs = null;
  _cumulativeMatch = EMPTY_ENFORCEMENT_MATCH_COUNTERS;
}

function _nowMs(): number {
  /* Yalnız TANI/gözlem içindir — hiçbir karar/tazelik hesabına GİRMEZ
     (o hep `nowMonoMs` iledir). Duvar/perf saati burada meşrudur, tıpkı
     `enforcementPointsSource._nowWall` gibi. */
  try {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  } catch {
    return 0;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   2) OKUMA (impure — L1 + ham sağlayıcı okur; kendi kararını İCAT ETMEZ)
   ══════════════════════════════════════════════════════════════════════════ */

function _readEnforcementAhead(query: HorizonAttributeQuery): HorizonAttributeResult {
  const status = getEnforcementSourceStatus();
  if (!isEnforcementPackageReady()) {
    /* Yükleme hiç denenmedi/sürüyor → NOT_MEASURED. Denendi ve DÜŞTÜ →
       SOURCE_UNAVAILABLE. İkisi "yok" DEĞİLDİR. */
    return status.loadState === 'FAILED'
      ? { outcome: 'SOURCE_UNAVAILABLE', objects: [], reason: 'PROVIDER_ERROR' }
      : { outcome: 'NOT_MEASURED', objects: [], reason: 'NO_SOURCE' };
  }

  if (query.startEdgeId === null || query.startAlongEdgeM === null
    || query.anchorLat === null || query.anchorLon === null) {
    /* Fiziksel çapa yok (eşleşme yok) → koridor kurulamaz; uydurma çapa YOK. */
    return { outcome: 'NOT_MEASURED', objects: [], reason: 'NO_SOURCE' };
  }

  const store = getMapStore();
  const corridorEv = store.expandCorridor(
    { edgeId: query.startEdgeId, alongEdgeM: query.startAlongEdgeM },
    query.budgetM,
    query.nowMonoMs,
  );
  const corridor = corridorEv.value;
  if (corridor === null) {
    return { outcome: 'SOURCE_UNAVAILABLE', objects: [], reason: corridorEv.reason };
  }
  _lastCorridorOutcome = corridor.outcome;
  _lastCorridorEdgeCount = corridor.edges.length;
  _lastCorridorNodeExpansions = corridor.nodeExpansions;
  _lastCorridorBranchCount = corridor.branchCount;
  _lastCorridorTruncated = corridor.truncated;

  if (corridor.outcome === 'INVALID_START' || corridor.outcome === 'NO_TOPOLOGY') {
    /* Koridor İDDİA EDİLEMEZ (F6 kilidi: kuş uçuşuna sessiz düşüş YOK). */
    return { outcome: 'SOURCE_UNAVAILABLE', objects: [], reason: 'NO_SOURCE' };
  }

  /* Kuş uçuşu ⇒ yol-boyu için ÜST KÜME kanıtlıdır (`enforcementPointsPackage`
     §"NEDEN KUŞ UÇUŞU YARIÇAPI YETERLİ"). Elemeyi koridor yapar. */
  const radiusM = Math.min(Math.max(query.budgetM, 0), CORRIDOR_HARD_MAX_BUDGET_M);
  const hits = queryEnforcementPointsNear(query.anchorLat, query.anchorLon, radiusM);
  if (hits === null) {
    /* Paket "hazır" ama sorgu null döndürdü → tutarsız/ölçülmedi, temkinli. */
    return { outcome: 'SOURCE_UNAVAILABLE', objects: [], reason: 'PROVIDER_ERROR' };
  }
  _lastCandidateCount = hits.length;

  const evGrade = corridorEv.grade;
  const baseConfidence = evGrade === 'STALE' ? 0.4 : 0.7;
  const evInit = {
    source: 'MAP_PACKAGE' as const,
    confidence: baseConfidence,
    observedAtMonoMs: query.nowMonoMs,
    freshnessBudgetMs: null,
  };

  const objects: HorizonObject[] = [];

  for (let i = 0; i < hits.length; i++) {
    const point = hits[i].point;
    const nearbyEv = store.queryEdgesNear(
      point.lat, point.lng, ENFORCEMENT_EDGE_QUERY_RADIUS_M, query.nowMonoMs,
    );
    const match = matchEnforcementPointToEdge(point, nearbyEv.value);
    _cumulativeMatch = foldEnforcementMatch(_cumulativeMatch, match);
    if (match.outcome !== 'MATCHED_TO_EDGE') continue;

    const sides = [match.forward, match.backward] as const;
    for (const side of sides) {
      if (side === null) continue;
      if (!corridorContainsEdge(corridor, side.edgeId)) continue;

      const dist = alongCorridorDistanceM(corridor, side.edgeId, side.alongEdgeM);
      /* Koridor İÇİNDE ama ego'nun GERİSİNDE (negatif) → "önümde" DEĞİL. */
      if (dist === null || dist < 0) continue;

      objects.push({
        kind: 'ENFORCEMENT',
        /* Kararlı kimlik: paket-içi nokta kimliği + bağlandığı kenar. Aynı
           nokta iki carriageway'e bağlanamaz (AMBIGUOUS_EDGE eler) ama aynı
           yolun iki koluna (forward/backward) bağlanabilir — kimlik bunu
           ayırt eder. */
        id: `enf:${match.pointId}:${side.edgeId.hi}:${side.edgeId.lo}`,
        pathId: query.pathId,
        distanceFromEgoM: derivedNav<number>(dist, evInit),
        /* Makine-okur etiket: tür + yön uygulanabilirliği. Serbest metin
           (`point.label`) TAŞINMAZ. */
        label: derivedNav<string>(
          `enforcement:${point.type}:${match.directionApplicability ?? 'UNKNOWN_DIRECTION'}`,
          evInit,
        ),
        /* Kaynakta sayısal büyüklük (hız eşiği) YOK — sözleşme gereği. */
        magnitude: unavailableNav<number>('MAP_PACKAGE', 'NO_SOURCE'),
        edgeId: side.edgeId,
      });
    }
  }

  objects.sort((a, b) => (a.distanceFromEgoM.value ?? 0) - (b.distanceFromEgoM.value ?? 0));
  _lastObjectCount = objects.length;

  if (objects.length > 0) {
    return { outcome: 'OBJECTS', objects, reason: 'DETERMINISTIC_DERIVATION' };
  }
  /* ── KESİLMİŞ KORİDOR "YOK" DEMEZ (ÖLÇÜMLE BULUNDU) ────────────────────
     Koridor bir TAVAN yüzünden kesildiyse (`EDGE_LIMIT`/`NODE_LIMIT`/
     `DEPTH_LIMIT`, ya da L1'de kimlik çevirisinde kenar düştüyse) ileride
     TARANMAMIŞ yol kalmıştır. `boundedCorridor` sözleşmesi bunu açıkça söyler:
     yalnız `COMPLETE`/`BUDGET_EXHAUSTED` hâlinde tüketici "ileride yok"
     hükmü kurabilir.

     ⚠️ Bu teorik bir kenar durum DEĞİLDİR — gerçek grafta ÖLÇÜLDÜ
     (`navV3CorridorEnforcementF6.test.ts` §F6.8): 295 346 kenarlı üretim
     grafında 2 000 m bütçeyle 300 örneğin **74'ü (%24,7)** `NODE_LIMIT` ile
     KESİLDİ. Kesilmiş koridorda boş sonucu `NO_OBJECTS_IN_RANGE` diye sunmak,
     her dört sorgudan birinde bilgisizliği ölçülmüş yokluk gibi göstermek
     olurdu (F6 görev maddesi 13 · G9 ile aynı yasak, başka bir kapıdan).

     Bulunan nesneler ETKİLENMEZ: gezinme mesafe sırasında ilerler, bu yüzden
     kesme DAİMA uzak uçtadır — yakındaki nesne bulunduysa gerçektir. */
  if (corridor.truncated) {
    return { outcome: 'NOT_MEASURED', objects: [], reason: 'BELOW_QUALITY_GATE' };
  }

  /* Kaynak hazır + koridor kuruldu + sorgu koştu + koridor EKSİKSİZ tarandı,
     hiçbiri bağlanmadı → bu bir ÖLÇÜMDÜR ("ileride denetim yok"). */
  return { outcome: 'NO_OBJECTS_IN_RANGE', objects: [], reason: 'COVERAGE_NONE' };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) PORT (dışa açık — `CehAuthority.bindAttributePorts`e verilir)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Denetim noktası öznitelik portu. **Yalnız `ENFORCEMENT` bağlar** — hız
 * limiti/viraj/eğim kaynağı bu binary'de yoktur, bu port onları UYDURMAZ.
 */
export function createEnforcementHorizonAttributePorts(): HorizonAttributePorts {
  return {
    boundDomains: ['ENFORCEMENT'],
    readAhead(query: HorizonAttributeQuery): HorizonAttributeResult {
      const startedAt = _nowMs();
      _calls++;
      try {
        const r = _readEnforcementAhead(query);
        _lastOutcome = r.outcome;
        return r;
      } catch {
        /* Fail-soft son çare: ufuk/navigasyon ASLA düşmez. */
        _lastOutcome = 'SOURCE_UNAVAILABLE';
        return { outcome: 'SOURCE_UNAVAILABLE', objects: [], reason: 'PROVIDER_ERROR' };
      } finally {
        _lastDurationMs = Math.max(0, _nowMs() - startedAt);
      }
    },
  };
}
