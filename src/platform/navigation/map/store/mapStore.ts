/**
 * mapStore.ts — NAV v3 · L1 · KANONİK HARİTA GERÇEĞİ CEPHESİ (SAF · F1).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F1/2 · v2 §2 · ADR-N01.
 *
 * SAF: I/O YOK · timer YOK · global durum YOK · React YOK ·
 * `Date.now`/`performance.now` YOK. Zaman ve kaynak okuma DIŞARIDAN gelir
 * (`MapDataPorts` + `nowMonoMs`).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE İŞE YARAR ──────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Navigasyonun **statik harita gerçeği** hakkındaki sorularının TEK cevap
 * yeri. L4 (Routing) · L5 (Guidance) · L6 (Arbitration) bu soruları ham
 * kaynaklara (Overpass · tile DB · graph binary · gpsService) SORAMAZ.
 *
 *   · Bu karo/segment mevcut mu?          → `hasTile`
 *   · Statik kenar bilgisi nedir?          → `getEdgeMetadata`
 *   · Harita verisi kullanılabilir mi?     → `getDatasetStatus`
 *   · Bayat / yok / bozuk mu?              → `MapDataAvailability`
 *   · Bu bilgi HANGİ kaynaktan geldi?      → `MapDatasetStatus.provenance`
 *
 * ── NE YAPMAZ (bağlayıcı) ────────────────────────────────────────────────
 *  · Mevcut harita/rota altyapısını SİLMEZ, yeniden yazmaz — SARAR.
 *  · Binary graf formatına DOKUNMAZ.
 *  · Kendi kendine `confidence` UYDURMAZ — güven kaynağın ölçüm durumundan gelir.
 *  · **Kendi degradation otoritesini KURMAZ.** `NavDegradation` eşlemesi
 *    çağıranın işidir; L1 yalnız epistemik durumu üretir.
 *  · Timer/abonelik/scheduler SAHİBİ OLAMAZ.
 *
 * ── FAIL-CLOSED ──────────────────────────────────────────────────────────
 * "Ölçülmedi" ile "yok" ASLA aynı sayılmaz. Port `available: null` derse
 * (hiç ölçülmedi) sonuç `UNAVAILABLE` kanıtıdır — "harita yok" DEĞİL.
 * Köken bilinmiyorsa (`MAP_SRC_NONE`) kesinlik iddia EDİLMEZ: kanıt sınıfı
 * `UNAVAILABLE`a düşürülür.
 */

import type { Evidenced, EvidenceReason } from '../../contracts/navEvidence';
import { observedNav, unavailableNav, staleNav } from '../../contracts/navEvidence';
import type { MonotonicMs } from '../../contracts/navMonotonicTime';
import { isMonoStale } from '../../contracts/navMonotonicTime';
import type { EdgeId } from '../../contracts/navEdgeId';
import type { TileCoord } from './tileGrid';
import { isValidTile } from './tileGrid';
/* F6: koridor SONUÇ SÖZLÜĞÜ tek yerde tanımlıdır (`map/graph/boundedCorridor`);
   burada yalnız TİP olarak taşınır — çalışma zamanı bağı YOKTUR (`import type`
   derlemede silinir), dolayısıyla L1 cephesi hâlâ saf kalır. */
import type { MapSourceMask } from './mapProvenance';
import { MAP_SRC_NONE, isUnknownProvenance, isValidMask } from './mapProvenance';

/* ══════════════════════════════════════════════════════════════════════════
   1) VERİ KÜMELERİ VE EPİSTEMİK DURUM
   ══════════════════════════════════════════════════════════════════════════ */

export type MapDatasetId =
  /** `/maps/routing-graph.bin` — yol ağı grafiği. */
  | 'ROUTING_GRAPH'
  /** `/maps/poi.db` — cihaz-içi POI veritabanı. */
  | 'POI_DB'
  /** Karo kaynağı (yerel dosya · cihaz önbelleği · çevrimiçi). */
  | 'TILES';

export const MAP_DATASET_IDS: readonly MapDatasetId[] = ['ROUTING_GRAPH', 'POI_DB', 'TILES'] as const;

/**
 * Harita verisinin epistemik durumu. **Kullanıcı mesajı DEĞİLDİR** — L1 yalnız
 * durumu üretir; sunum ve bozulma eşlemesi üst katmanın işidir.
 */
export type MapDataAvailability =
  /** Ölçüldü, var ve gözlem taze. */
  | 'AVAILABLE_FRESH'
  /** Ölçüldü ve var, ama gözlem TANIMLI tazelik bütçesini aştı. */
  | 'AVAILABLE_STALE'
  /** Ölçüldü ve YOK. */
  | 'UNAVAILABLE'
  /** Ölçüldü ama biçim/sihirli sayı tutmadı — veri BOZUK. */
  | 'INVALID';

export const MAP_DATA_AVAILABILITIES: readonly MapDataAvailability[] = [
  'AVAILABLE_FRESH', 'AVAILABLE_STALE', 'UNAVAILABLE', 'INVALID',
] as const;

export interface MapDatasetStatus {
  readonly dataset: MapDatasetId;
  readonly availability: MapDataAvailability;
  /** Bu hükmü besleyen fiziksel kaynaklar (bitset). Kanıt sınıfı DEĞİLDİR. */
  readonly provenance: MapSourceMask;
}

/** Bugünkü grafın taşıdığı statik kenar öznitelikleri (`RTG2` biçiminden). */
export interface StaticEdgeMetadata {
  /** Kenar uzunluğu / maliyeti (metre) — `RTG2` `costM`. */
  readonly lengthM: number;
  readonly oneway: boolean;
  /** `RTG2` FLAGS bit 1-3. `0` = BİLİNMİYOR (uydurma sınıf üretilmez). */
  readonly roadClass: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) PORTLAR — gerçek kaynaklar bu arayüzün ARKASINDA kalır
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir veri kümesi hakkında ham gözlem. **`available: null` = HİÇ ÖLÇÜLMEDİ**
 * ("yok" DEĞİL). Bu ayrım pazarlıksızdır.
 */
export interface MapDatasetObservation {
  readonly available: boolean | null;
  /** Ölçüldü ve biçim bozuk. `true` ise `available` yok sayılır. */
  readonly invalid: boolean;
  readonly provenance: MapSourceMask;
  readonly reason: EvidenceReason;
  /** Gözlemin monotonik anı; yoksa `null` → bayatlık HESAPLANMAZ. */
  readonly observedAtMonoMs: MonotonicMs | null;
  /**
   * Bu gözlem için REPODA TANIMLI tazelik bütçesi. `null` → bayatlık
   * hesaplanmaz (uydurma eşik YASAK — F0 kuralı).
   */
  readonly freshnessBudgetMs: number | null;
}

/** Hiç ölçüm yapılmamış gözlem — fail-closed varsayılan. */
export const UNMEASURED_DATASET: MapDatasetObservation = {
  available: null,
  invalid: false,
  provenance: MAP_SRC_NONE,
  reason: 'NO_SOURCE',
  observedAtMonoMs: null,
  freshnessBudgetMs: null,
};

/* ── Topoloji (F4) ──────────────────────────────────────────────────────── */

/**
 * Bir kenarın yol ağındaki bağlantısı. **Ham düğüm indeksi TAŞIMAZ** —
 * graf içi kimlikler L1'in dışına ÇIKMAZ (kilit test denetler); komşuluk
 * yalnız kanonik `EdgeId` ile ifade edilir.
 */
export interface EdgeTopology {
  readonly edgeId: EdgeId;
  /** Kenarın BİTİŞİNDEN devam eden kenarlar (yasak yön DAHİL EDİLMEZ). */
  readonly outgoing: readonly EdgeId[];
  /** Kenarın BAŞLANGICINA gelen kenarlar. */
  readonly incoming: readonly EdgeId[];
  readonly oneway: boolean;
  /** Kenar uzunluğu (m) — `costM` (seyreltme ÖNCESİ gerçek yol uzunluğu). */
  readonly lengthM: number;
}

/** Yakınlık sorgusunun tek sonucu — L2 aday üretiminin ham girdisi. */
export interface NearbyEdge {
  readonly edgeId: EdgeId;
  /** Gözlemin kenara dik mesafesi (m). */
  readonly perpDistM: number;
  readonly snappedLat: number;
  readonly snappedLon: number;
  /** Kenar başından yol-boyu mesafe (m). */
  readonly alongEdgeM: number;
  /** Segment gidiş yönü (derece, 0 = Kuzey). `null` = ölçülemedi. */
  readonly bearingDeg: number | null;
  /** Kenarın statik bilgisi. `null` = metadata YOK (uydurulmaz). */
  readonly metadata: StaticEdgeMetadata | null;
}

/** Ağ üzerinde bir konum: hangi kenar, kenar başından ne kadar ileride. */
export interface EdgePosition {
  readonly edgeId: EdgeId;
  readonly alongEdgeM: number;
}

/* ── Sınırlı koridor (F6) ───────────────────────────────────────────────── */

/**
 * Koridordaki tek kenarın KANONİK gösterimi. Ham graf sıra numarası TAŞIMAZ —
 * gezinme `map/graph/boundedCorridor` içinde yapılır ve kimlik bu sınırda
 * kanonikleşir (kilit test denetler).
 */
export interface CorridorEdge {
  readonly edgeId: EdgeId;
  /**
   * Ego'dan bu kenarın BAŞINA yol-boyu mesafe (m). Başlangıç kenarında
   * NEGATİFTİR (kenarın başı geride kalmıştır) — böylece kenar üzerindeki bir
   * noktanın ego'ya uzaklığı daima `entryDistanceM + alongEdgeM`dir.
   */
  readonly entryDistanceM: number;
  readonly lengthM: number;
  readonly depth: number;
}

/**
 * L1'in KENDİ koridor hükmü sözlüğü. `map/graph/boundedCorridor.CorridorOutcome`
 * ile bilerek AYNI 7 değeri taşır (yapısal ayna) — SAF çekirdek dosyalar
 * kendi paketleri + F0 sözleşmeleri DIŞINDA import ETMEZ (F1 kilidi); gezinme
 * motoru `map/graph/`dedir, bu yüzden L1 kendi vocabulary'sini TEKRAR TANIMLAR,
 * import ETMEZ. `mapStoreSources.ts` (bileşim katmanı, bu kısıtın DIŞINDA)
 * ikisini köprüler — string birleşimleri birebir eşit olduğu için dönüşüm
 * derleyicide otomatiktir, elle eşleme GEREKMEZ.
 */
export type RoadCorridorOutcome =
  | 'COMPLETE'
  | 'BUDGET_EXHAUSTED'
  | 'EDGE_LIMIT'
  | 'NODE_LIMIT'
  | 'DEPTH_LIMIT'
  | 'INVALID_START'
  | 'NO_TOPOLOGY';

/**
 * "Aracın önündeki en fazla X metre yol ağı" — SINIRLI ve ölçülebilir.
 * Sonuç `outcome` alanı hangi tavanın dolduğunu AÇIKÇA söyler; kuş uçuşuna
 * sessiz düşüş YOKTUR.
 */
export interface RoadCorridor {
  readonly outcome: RoadCorridorOutcome;
  readonly startEdgeId: EdgeId | null;
  /** İstenen bütçe (m) — L1'in kendi tavanına kırpılmış hâli. */
  readonly budgetM: number;
  /** Ego'dan itibaren gerçekten kapsanan yol-boyu mesafe (m). */
  readonly coveredM: number;
  readonly edges: readonly CorridorEdge[];
  readonly nodeExpansions: number;
  readonly branchCount: number;
  /** Bir TAVAN kesti mi (bütçe sınırı kesme SAYILMAZ). */
  readonly truncated: boolean;
}

/**
 * MapStore'un gerçek dünyaya tek bağlantısı. Uygulamaları
 * `mapStoreSources.ts` içindedir; bu dosya onları GÖRMEZ.
 */
export interface MapDataPorts {
  readDataset(dataset: MapDatasetId): MapDatasetObservation;
  /** Karo mevcut mu. `null` = bilinmiyor (ölçülmedi) — "yok" DEĞİL. */
  readTilePresence(tile: TileCoord): boolean | null;
  /** Statik kenar bilgisi. `null` = bu kimlik için okunabilir kaynak YOK. */
  readEdgeMetadata(edgeId: EdgeId): StaticEdgeMetadata | null;
  /** Kenar komşuluğu. `null` = topoloji okunamıyor (uydurma komşu YOK). */
  readEdgeTopology(edgeId: EdgeId): EdgeTopology | null;
  /**
   * Noktanın yarıçapındaki kenarlar. `null` = graf ana iş parçacığında
   * ÇÖZÜLMEMİŞ (ölçülmedi) — boş dizi ise "bu yarıçapta yol YOK" (ölçüldü).
   * İki hâl KARIŞTIRILMAZ.
   */
  readEdgesNear(lat: number, lon: number, radiusM: number): readonly NearbyEdge[] | null;
  /**
   * İki ağ konumu arasındaki YOL-BOYU mesafe (m). `null` = topolojiden
   * KANITLANAMADI (çok adımlı arama YAPILMAZ — hot-path bütçesi).
   */
  readNetworkDistanceM(from: EdgePosition, to: EdgePosition): number | null;
  /**
   * Sınırlı koridor genişlemesi (F6). `null` = topoloji okunamadı
   * (ölçülmedi) — "ileride yol yok" DEĞİL.
   */
  expandCorridor(start: EdgePosition, budgetM: number): RoadCorridor | null;
}

/** Hiçbir şey bilmeyen fail-closed port kümesi (test ve boot öncesi). */
export const UNAVAILABLE_MAP_DATA_PORTS: MapDataPorts = {
  readDataset: () => UNMEASURED_DATASET,
  readTilePresence: () => null,
  readEdgeMetadata: () => null,
  readEdgeTopology: () => null,
  readEdgesNear: () => null,
  readNetworkDistanceM: () => null,
  expandCorridor: () => null,
};

/* ══════════════════════════════════════════════════════════════════════════
   3) CEPHE
   ══════════════════════════════════════════════════════════════════════════ */

export interface MapTruthSnapshot {
  readonly datasets: readonly Evidenced<MapDatasetStatus>[];
  /** Tüm veri kümelerinin kökenlerinin birleşimi. */
  readonly provenance: MapSourceMask;
}

export interface MapStore {
  getDatasetStatus(dataset: MapDatasetId, nowMonoMs: MonotonicMs): Evidenced<MapDatasetStatus>;
  hasTile(tile: TileCoord, nowMonoMs: MonotonicMs): Evidenced<boolean>;
  getEdgeMetadata(edgeId: EdgeId, nowMonoMs: MonotonicMs): Evidenced<StaticEdgeMetadata>;
  /** Kenar komşuluğu (F4). Graf hükmü yoksa/bozuksa `UNAVAILABLE`. */
  getEdgeTopology(edgeId: EdgeId, nowMonoMs: MonotonicMs): Evidenced<EdgeTopology>;
  /**
   * Noktanın yarıçapındaki kenarlar (F4). **Zorla en yakın yola snap YOK:**
   * yarıçap dışı kenar sonuca GİRMEZ ve boş sonuç bir ÖLÇÜMDÜR ("yol yok"),
   * ölçülmemişlikten (`UNAVAILABLE`) ayrıdır.
   */
  queryEdgesNear(
    lat: number, lon: number, radiusM: number, nowMonoMs: MonotonicMs,
  ): Evidenced<readonly NearbyEdge[]>;
  /** İki ağ konumu arası yol-boyu mesafe (m). Kanıtlanamazsa `null`. */
  networkDistanceM(from: EdgePosition, to: EdgePosition, nowMonoMs: MonotonicMs): number | null;
  /**
   * Aracın ÖNÜNDEKİ sınırlı yol koridoru (F6). Graf hükmü yoksa/bozuksa
   * `UNAVAILABLE`. **Sınırsız arama YOKTUR** — tavanlar `boundedCorridor`
   * içinde tanımlıdır ve hangisinin dolduğu sonuçta yazar.
   */
  expandCorridor(
    start: EdgePosition, budgetM: number, nowMonoMs: MonotonicMs,
  ): Evidenced<RoadCorridor>;
  getSnapshot(nowMonoMs: MonotonicMs): MapTruthSnapshot;
}

/* ══════════════════════════════════════════════════════════════════════════
   2b) KORİDOR İÇİ AĞ MESAFESİ (saf — F6)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Koridor içindeki bir ağ konumunun ego'ya YOL-BOYU mesafesi (m).
 *
 * ── NEDEN AYRI, NEDEN `networkDistanceM` GENİŞLETİLMEDİ ──────────────────
 * F4'ün `networkDistanceM`'i HMM geçiş teriminin sıcak yolunda (aday × aday)
 * çağrılır; oraya çok adımlı arama koymak GPS kadansında kare karmaşıklık
 * demektir. F6 tüketicisinin ihtiyacı farklıdır: TEK bir koridor bir kez
 * genişletilir ve mesafe o koridorun İÇİNDEN okunur — arama YOKTUR, tablo
 * okuması vardır.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────
 *  · Sonuç DAİMA yol-boyudur; kuş uçuşu mesafe ASLA yerine geçmez.
 *  · Konum koridorda değilse `null` (bilinmiyor) — düz çizgiye DÜŞÜLMEZ.
 *  · Negatif sonuç MEŞRUDUR: nokta aracın GERİSİNDE kalmıştır; çağıran
 *    "önümde" hükmünü kendisi kurar (bu fonksiyon karar VERMEZ).
 */
export function alongCorridorDistanceM(
  corridor: RoadCorridor | null | undefined,
  edgeId: EdgeId,
  alongEdgeM: number,
): number | null {
  if (!corridor || !Array.isArray(corridor.edges) || corridor.edges.length === 0) return null;
  if (!edgeId || typeof alongEdgeM !== 'number' || !Number.isFinite(alongEdgeM)) return null;

  for (let i = 0; i < corridor.edges.length; i++) {
    const e = corridor.edges[i];
    if (e.edgeId.hi !== edgeId.hi || e.edgeId.lo !== edgeId.lo) continue;
    const clamped = Math.max(0, Math.min(alongEdgeM, e.lengthM));
    return e.entryDistanceM + clamped;
  }
  return null;
}

/** Koridor bu kenarı (yönüyle birlikte) kapsıyor mu. */
export function corridorContainsEdge(
  corridor: RoadCorridor | null | undefined, edgeId: EdgeId,
): boolean {
  if (!corridor || !edgeId) return false;
  for (let i = 0; i < corridor.edges.length; i++) {
    const e = corridor.edges[i];
    if (e.edgeId.hi === edgeId.hi && e.edgeId.lo === edgeId.lo) return true;
  }
  return false;
}

/**
 * Gözlemi epistemik duruma çevirir. **SAF.**
 *
 * Sıra (ilk eşleşen kazanır):
 *   1. biçim bozuk           → `INVALID`
 *   2. hiç ölçülmedi         → `null` (durum İDDİA EDİLMEZ)
 *   3. ölçüldü, yok          → `UNAVAILABLE`
 *   4. ölçüldü, var + bayat  → `AVAILABLE_STALE`
 *   5. ölçüldü, var          → `AVAILABLE_FRESH`
 */
export function classifyAvailability(
  obs: MapDatasetObservation,
  nowMonoMs: MonotonicMs,
): MapDataAvailability | null {
  if (!obs) return null;
  if (obs.invalid === true) return 'INVALID';
  if (obs.available === null || obs.available === undefined) return null;
  if (obs.available === false) return 'UNAVAILABLE';
  return isMonoStale(obs.observedAtMonoMs, nowMonoMs, obs.freshnessBudgetMs)
    ? 'AVAILABLE_STALE'
    : 'AVAILABLE_FRESH';
}

function _statusEvidence(
  dataset: MapDatasetId,
  obs: MapDatasetObservation,
  nowMonoMs: MonotonicMs,
): Evidenced<MapDatasetStatus> {
  const availability = classifyAvailability(obs, nowMonoMs);
  if (availability === null) {
    /* Ölçülmedi → hüküm YOK. "Harita yok" demek DEĞİLDİR. */
    return unavailableNav<MapDatasetStatus>('MAP_PACKAGE', obs?.reason ?? 'NO_SOURCE');
  }

  const provenance = isValidMask(obs.provenance) ? obs.provenance : MAP_SRC_NONE;

  /* KÖKENSİZ KESİNLİK YASAK: veri "var" deniyor ama hangi kaynaktan geldiği
     bilinmiyorsa bu bir ölçüm değil, bir tahmindir → kanıt UNAVAILABLE. */
  if ((availability === 'AVAILABLE_FRESH' || availability === 'AVAILABLE_STALE')
      && isUnknownProvenance(provenance)) {
    return unavailableNav<MapDatasetStatus>('MAP_PACKAGE', 'BELOW_QUALITY_GATE');
  }

  const value: MapDatasetStatus = { dataset, availability, provenance };
  const init = {
    source: 'MAP_PACKAGE' as const,
    observedAtMonoMs: obs.observedAtMonoMs,
    freshnessBudgetMs: obs.freshnessBudgetMs,
  };

  /* Bayat gözlem bayat KANIT taşır — güven tavanı kurucuda uygulanır. */
  return availability === 'AVAILABLE_STALE'
    ? staleNav<MapDatasetStatus>(value, init)
    : observedNav<MapDatasetStatus>(value, init);
}

/**
 * Kanonik L1 cephesini kurar. **SAF fabrika** — port'lar dışarıdan verilir,
 * hiçbir kaynağı kendisi import etmez, hiçbir zamanlayıcı kurmaz.
 */
export function createMapStore(ports: MapDataPorts): MapStore {
  const p = ports ?? UNAVAILABLE_MAP_DATA_PORTS;

  const getDatasetStatus = (
    dataset: MapDatasetId,
    nowMonoMs: MonotonicMs,
  ): Evidenced<MapDatasetStatus> => {
    let obs: MapDatasetObservation;
    try {
      obs = p.readDataset(dataset) ?? UNMEASURED_DATASET;
    } catch {
      /* Kaynak patladı → sessiz "sağlıklı" YOK. */
      return unavailableNav<MapDatasetStatus>('MAP_PACKAGE', 'PROVIDER_ERROR');
    }
    return _statusEvidence(dataset, obs, nowMonoMs);
  };

  return {
    getDatasetStatus,

    hasTile(tile: TileCoord, nowMonoMs: MonotonicMs): Evidenced<boolean> {
      if (!isValidTile(tile)) {
        return unavailableNav<boolean>('MAP_PACKAGE', 'BELOW_QUALITY_GATE');
      }
      let present: boolean | null;
      try {
        present = p.readTilePresence(tile);
      } catch {
        return unavailableNav<boolean>('MAP_PACKAGE', 'PROVIDER_ERROR');
      }
      if (present === null || present === undefined) {
        return unavailableNav<boolean>('MAP_PACKAGE', 'NO_SOURCE');
      }

      /* Karo varlığı, karo VERİ KÜMESİNİN durumundan bağımsız iddia edilemez:
         veri kümesi ölçülmediyse tek bir karo hakkında da hüküm verilmez. */
      const ds = getDatasetStatus('TILES', nowMonoMs);
      if (ds.value === null) return unavailableNav<boolean>('MAP_PACKAGE', 'NO_SOURCE');
      if (ds.value.availability === 'INVALID') {
        return unavailableNav<boolean>('MAP_PACKAGE', 'VERSION_MISMATCH');
      }

      const init = {
        source: 'MAP_PACKAGE' as const,
        observedAtMonoMs: ds.observedAtMonoMs,
        freshnessBudgetMs: ds.freshnessBudgetMs,
      };
      return ds.value.availability === 'AVAILABLE_STALE'
        ? staleNav<boolean>(present, init)
        : observedNav<boolean>(present, init);
    },

    getEdgeMetadata(edgeId: EdgeId, nowMonoMs: MonotonicMs): Evidenced<StaticEdgeMetadata> {
      let meta: StaticEdgeMetadata | null;
      try {
        meta = p.readEdgeMetadata(edgeId);
      } catch {
        return unavailableNav<StaticEdgeMetadata>('MAP_PACKAGE', 'PROVIDER_ERROR');
      }
      if (meta === null || meta === undefined) {
        return unavailableNav<StaticEdgeMetadata>('MAP_PACKAGE', 'NO_SOURCE');
      }

      const ds = getDatasetStatus('ROUTING_GRAPH', nowMonoMs);
      if (ds.value === null) return unavailableNav<StaticEdgeMetadata>('MAP_PACKAGE', 'NO_SOURCE');
      if (ds.value.availability === 'INVALID') {
        return unavailableNav<StaticEdgeMetadata>('MAP_PACKAGE', 'VERSION_MISMATCH');
      }

      const init = {
        source: 'MAP_PACKAGE' as const,
        observedAtMonoMs: ds.observedAtMonoMs,
        freshnessBudgetMs: ds.freshnessBudgetMs,
      };
      return ds.value.availability === 'AVAILABLE_STALE'
        ? staleNav<StaticEdgeMetadata>(meta, init)
        : observedNav<StaticEdgeMetadata>(meta, init);
    },

    getEdgeTopology(edgeId: EdgeId, nowMonoMs: MonotonicMs): Evidenced<EdgeTopology> {
      /* Graf hükmü ÖNCE: bozuk/ölçülmemiş graf üzerinden komşuluk iddia
         edilemez (F4.12 — bozuk graf asla "kullanılabilir" değildir). */
      const ds = getDatasetStatus('ROUTING_GRAPH', nowMonoMs);
      if (ds.value === null) return unavailableNav<EdgeTopology>('MAP_PACKAGE', 'NO_SOURCE');
      if (ds.value.availability === 'INVALID') {
        return unavailableNav<EdgeTopology>('MAP_PACKAGE', 'VERSION_MISMATCH');
      }
      if (ds.value.availability === 'UNAVAILABLE') {
        return unavailableNav<EdgeTopology>('MAP_PACKAGE', 'NO_SOURCE');
      }

      let topo: EdgeTopology | null;
      try {
        topo = p.readEdgeTopology(edgeId);
      } catch {
        return unavailableNav<EdgeTopology>('MAP_PACKAGE', 'PROVIDER_ERROR');
      }
      if (topo === null || topo === undefined) {
        return unavailableNav<EdgeTopology>('MAP_PACKAGE', 'NO_SOURCE');
      }

      const init = {
        source: 'MAP_PACKAGE' as const,
        observedAtMonoMs: ds.observedAtMonoMs,
        freshnessBudgetMs: ds.freshnessBudgetMs,
      };
      return ds.value.availability === 'AVAILABLE_STALE'
        ? staleNav<EdgeTopology>(topo, init)
        : observedNav<EdgeTopology>(topo, init);
    },

    queryEdgesNear(
      lat: number, lon: number, radiusM: number, nowMonoMs: MonotonicMs,
    ): Evidenced<readonly NearbyEdge[]> {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)
        || !Number.isFinite(radiusM) || radiusM <= 0) {
        return unavailableNav<readonly NearbyEdge[]>('MAP_PACKAGE', 'BELOW_QUALITY_GATE');
      }

      const ds = getDatasetStatus('ROUTING_GRAPH', nowMonoMs);
      if (ds.value === null) {
        return unavailableNav<readonly NearbyEdge[]>('MAP_PACKAGE', 'NO_SOURCE');
      }
      if (ds.value.availability === 'INVALID') {
        return unavailableNav<readonly NearbyEdge[]>('MAP_PACKAGE', 'VERSION_MISMATCH');
      }
      if (ds.value.availability === 'UNAVAILABLE') {
        return unavailableNav<readonly NearbyEdge[]>('MAP_PACKAGE', 'NO_SOURCE');
      }

      let near: readonly NearbyEdge[] | null;
      try {
        near = p.readEdgesNear(lat, lon, radiusM);
      } catch {
        return unavailableNav<readonly NearbyEdge[]>('MAP_PACKAGE', 'PROVIDER_ERROR');
      }
      /* `null` = ÖLÇÜLMEDİ · `[]` = ÖLÇÜLDÜ, bu yarıçapta yol YOK. */
      if (near === null || near === undefined) {
        return unavailableNav<readonly NearbyEdge[]>('MAP_PACKAGE', 'NO_SOURCE');
      }

      const init = {
        source: 'MAP_PACKAGE' as const,
        observedAtMonoMs: ds.observedAtMonoMs,
        freshnessBudgetMs: ds.freshnessBudgetMs,
      };
      return ds.value.availability === 'AVAILABLE_STALE'
        ? staleNav<readonly NearbyEdge[]>(near, init)
        : observedNav<readonly NearbyEdge[]>(near, init);
    },

    networkDistanceM(from: EdgePosition, to: EdgePosition, nowMonoMs: MonotonicMs): number | null {
      const ds = getDatasetStatus('ROUTING_GRAPH', nowMonoMs);
      if (ds.value === null) return null;
      if (ds.value.availability === 'INVALID' || ds.value.availability === 'UNAVAILABLE') return null;
      try {
        const d = p.readNetworkDistanceM(from, to);
        return (typeof d === 'number' && Number.isFinite(d) && d >= 0) ? d : null;
      } catch {
        return null;
      }
    },

    expandCorridor(
      start: EdgePosition, budgetM: number, nowMonoMs: MonotonicMs,
    ): Evidenced<RoadCorridor> {
      if (!start || !start.edgeId
        || typeof budgetM !== 'number' || !Number.isFinite(budgetM) || budgetM <= 0) {
        return unavailableNav<RoadCorridor>('MAP_PACKAGE', 'BELOW_QUALITY_GATE');
      }

      /* Graf hükmü ÖNCE: bozuk/ölçülmemiş graf üzerinden koridor iddia
         edilemez (F4.12 ile aynı kapı sırası). */
      const ds = getDatasetStatus('ROUTING_GRAPH', nowMonoMs);
      if (ds.value === null) return unavailableNav<RoadCorridor>('MAP_PACKAGE', 'NO_SOURCE');
      if (ds.value.availability === 'INVALID') {
        return unavailableNav<RoadCorridor>('MAP_PACKAGE', 'VERSION_MISMATCH');
      }
      if (ds.value.availability === 'UNAVAILABLE') {
        return unavailableNav<RoadCorridor>('MAP_PACKAGE', 'NO_SOURCE');
      }

      let corridor: RoadCorridor | null;
      try {
        corridor = p.expandCorridor(start, budgetM);
      } catch {
        return unavailableNav<RoadCorridor>('MAP_PACKAGE', 'PROVIDER_ERROR');
      }
      if (corridor === null || corridor === undefined) {
        return unavailableNav<RoadCorridor>('MAP_PACKAGE', 'NO_SOURCE');
      }

      const init = {
        source: 'MAP_PACKAGE' as const,
        observedAtMonoMs: ds.observedAtMonoMs,
        freshnessBudgetMs: ds.freshnessBudgetMs,
      };
      return ds.value.availability === 'AVAILABLE_STALE'
        ? staleNav<RoadCorridor>(corridor, init)
        : observedNav<RoadCorridor>(corridor, init);
    },

    getSnapshot(nowMonoMs: MonotonicMs): MapTruthSnapshot {
      const datasets = MAP_DATASET_IDS.map((d) => getDatasetStatus(d, nowMonoMs));
      let provenance: MapSourceMask = MAP_SRC_NONE;
      for (const ev of datasets) {
        if (ev.value !== null && isValidMask(ev.value.provenance)) {
          provenance = (provenance | ev.value.provenance) >>> 0;
        }
      }
      return { datasets, provenance };
    },
  };
}
