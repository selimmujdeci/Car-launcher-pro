/**
 * navHorizon.ts — NAV v3 · L3 CEH / ELECTRONIC HORIZON SÖZLEŞMESİ (SAF · F3).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F3.2 · v2 §1.1 P2 · ADR-N01.
 *
 * SAF: I/O YOK · timer YOK · `Date.now`/`performance.now` YOK · React YOK ·
 * modül durumu YOK · ALGORİTMA YOK. Bu dosya ufuk ÜRETMEZ — yalnız "önümde ne
 * var?" sorusunun cevabının HANGİ ŞEKİLDE taşınacağını tiple sabitler. Motor
 * `horizon/horizonModel.ts`, cephe `horizon/cehAuthority.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN TEK CEVAPLAYICI ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "İleride kamera var mı · viraj sert mi · limit düşüyor mu · kavşak nerede"
 * sorularının bugün depoda AYRI AYRI cevaplayıcıları var (Guardian
 * `enforcementMapSource` kendi koni sorgusunu yapar; rota adımları kendi
 * mesafesini üretir). Aynı fiziksel soruya farklı katmanların farklı cevap
 * vermesi, bir uyarının bir yüzeyde çıkıp diğerinde çıkmaması demektir.
 * L3 bu soruların TEK cevaplayıcısıdır (F0 `NAV_LAYER_DEPENDENCY_LAW`:
 * L4/L5/L6 L1'e DOKUNAMAZ, yol gerçeğini ufuktan alır).
 *
 * ── ÜÇ AYRI GERÇEK KARIŞTIRILAMAZ ────────────────────────────────────────
 *   1. `RealtimeEgoPose`  — araç FİZİKSEL olarak nerede (L2, ham).
 *   2. `MatchedRoadPose`  — araç hangi KENARA oturuyor (L2, türev).
 *   3. Aktif rota          — sürücünün NİYETİ (L4). **Fiziksel gerçek DEĞİL.**
 * "Rota var → araç kesinlikle bu yolda" çıkarımı YASAKTIR: paralel yol,
 * servis yolu ve viyadük altı bu çıkarımı sessizce yanlışlar (v2 FMEA F05).
 * Bu yüzden her `HorizonPath` kendi KÖKENİNİ (`HorizonPathProvenance`) ve
 * fiziksel doğrulanma durumunu (`physicallyConfirmed`) taşır.
 *
 * ── UNKNOWN ≠ NONE (pazarlıksız) ─────────────────────────────────────────
 * Ölçülmemiş öznitelik `Evidenced.grade = 'UNAVAILABLE'` taşır. "İleride
 * kamera bilgisi YOK" ile "ileride kamera YOK" aynı şey değildir ve bu
 * sözleşme ikisini yapısal olarak ayırır — `magnitude.value === null` bir
 * yokluk BEYANIDIR, sıfır DEĞİLDİR.
 */

import type { Evidenced, EvidenceReason } from './navEvidence';
import type { EdgeId } from './navEdgeId';
import type { MonotonicMs } from './navMonotonicTime';
import type { MatchedRoadPose, RealtimeEgoPose } from './navEgoPose';
import type { NavDegradation } from './navDegradation';

/* ══════════════════════════════════════════════════════════════════════════
   1) UFUK DURUMU — bozulma AYRIŞTIRILIR, tek "yok" kovası YOKTUR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * CEH'nin o andaki hükmü. Ayrı ayrı durur çünkü sahada alınacak aksiyon
 * farklıdır: "eşleşme yok" bir kapsam sorunu, "ego yok" bir konum sorunu,
 * "belirsiz kol" ise bir KARAR reddidir (veri var ama tek yola inmiyor).
 */
export type CehHorizonState =
  /** Kanıtlı MPP var ve ufuk mesafesi kapsandı. */
  | 'HORIZON_AVAILABLE'
  /** Yol/rota bilinir ama ufuk kısmi (öznitelik veya mesafe eksik). */
  | 'HORIZON_PARTIAL'
  /** Birden çok makul kol var — MPP'ye ZORLA indirgenmedi. */
  | 'AMBIGUOUS_PATH'
  /** Kullanılabilir ego pozu yok → ufuk çapası yok. */
  | 'EGO_UNAVAILABLE'
  /** Ego pozu var ama tazelik bütçesini aştı → taze ufuk üretilemez. */
  | 'EGO_STALE'
  /** L1 harita gerçeği yok/ölçülmedi → yol ağı ufku üretilemez. */
  | 'MAP_UNAVAILABLE'
  /** Harita var ama araç ağa oturtulamadı (kapsam/okuyucu yok). */
  | 'MATCH_UNAVAILABLE'
  /** Yol biliniyor ama öznitelik metadatası yok. */
  | 'INSUFFICIENT_METADATA'
  /** Ne rota niyeti ne yol eşleşmesi — ufuk için hiçbir kaynak yok. */
  | 'NO_HORIZON_SOURCE';

export const CEH_HORIZON_STATES: readonly CehHorizonState[] = [
  'HORIZON_AVAILABLE', 'HORIZON_PARTIAL', 'AMBIGUOUS_PATH',
  'EGO_UNAVAILABLE', 'EGO_STALE', 'MAP_UNAVAILABLE', 'MATCH_UNAVAILABLE',
  'INSUFFICIENT_METADATA', 'NO_HORIZON_SOURCE',
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   2) YOL KÖKENİ — niyet ile fiziksel gerçek AYRI
   ══════════════════════════════════════════════════════════════════════════ */

export type HorizonPathProvenance =
  /** Fiziksel eşleşme + harita topolojisi — en güçlü köken. */
  | 'MATCHED_ROAD_TOPOLOGY'
  /** Aktif rota niyeti + fiziksel eşleşme UYUŞUYOR. */
  | 'ROUTE_INTENT_CONFIRMED'
  /** Yalnız aktif rota niyeti — **fiziksel doğrulama YOK**. */
  | 'ROUTE_INTENT'
  /** Rota yok; yalnız harita topolojisinden serbest sürüş ufku. */
  | 'MAP_TOPOLOGY';

export const HORIZON_PATH_PROVENANCES: readonly HorizonPathProvenance[] = [
  'MATCHED_ROAD_TOPOLOGY', 'ROUTE_INTENT_CONFIRMED', 'ROUTE_INTENT', 'MAP_TOPOLOGY',
] as const;

/** Bu köken tek başına "araç fiilen bu yolda" demeye YETER Mİ. */
export function provenanceIsPhysical(p: HorizonPathProvenance): boolean {
  return p === 'MATCHED_ROAD_TOPOLOGY' || p === 'ROUTE_INTENT_CONFIRMED';
}

/* ══════════════════════════════════════════════════════════════════════════
   3) UFUK NESNELERİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ufuktaki bir nesnenin türü. Değer alanı `magnitude` türe göre okunur:
 *   `SPEED_LIMIT` → km/h · `CURVE` → yarıçap (m) · `SLOPE` → eğim (%) ·
 *   `ROAD_CLASS` → sınıf kodu · `MANEUVER`/`JUNCTION`/`ENFORCEMENT` → yok.
 */
export type HorizonObjectKind =
  | 'MANEUVER'
  | 'JUNCTION'
  | 'SPEED_LIMIT'
  | 'CURVE'
  | 'ENFORCEMENT'
  | 'SLOPE'
  | 'ROAD_CLASS';

export const HORIZON_OBJECT_KINDS: readonly HorizonObjectKind[] = [
  'MANEUVER', 'JUNCTION', 'SPEED_LIMIT', 'CURVE', 'ENFORCEMENT', 'SLOPE', 'ROAD_CLASS',
] as const;

/** Yol kolu kimliği. `'MPP'` ayrılmıştır; kollar `'BRANCH_<n>'`. */
export type HorizonPathId = string;

export const MPP_PATH_ID: HorizonPathId = 'MPP';

/**
 * Ufuktaki tek nesne. **Şekil sabittir** (V8 hidden-class kuralı): her alan
 * her zaman vardır; bilinmeyen alan `UNAVAILABLE` kanıt taşır, silinmez.
 */
export interface HorizonObject {
  readonly kind: HorizonObjectKind;
  /** Kararlı kimlik — aynı nesne tik'ler arasında aynı kimliği taşır. */
  readonly id: string;
  readonly pathId: HorizonPathId;
  /** Ego'dan YOL BOYU mesafe (m). Kuş uçuşu DEĞİL. */
  readonly distanceFromEgoM: Evidenced<number>;
  /** Makine-okur etiket (`turn:left`, `camera:fixed_speed`…). Serbest metin DEĞİL. */
  readonly label: Evidenced<string>;
  /** Türe göre sayısal öznitelik. Ölçülmediyse `UNAVAILABLE` (0 DEĞİL). */
  readonly magnitude: Evidenced<number>;
  /**
   * Nesnenin oturduğu kanonik kenar (F6). Kenar-bağımsız nesneler (örn.
   * rota niyetinden gelen `MANEUVER`) için `null` — **şekil sabit kalır**
   * (V8 hidden-class), alan silinmez.
   */
  readonly edgeId: EdgeId | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) YOL KOLU
   ══════════════════════════════════════════════════════════════════════════ */

export interface HorizonPath {
  readonly pathId: HorizonPathId;
  readonly provenance: HorizonPathProvenance;
  /** Bu kol MPP mi. Belirsizlikte HİÇBİR kol `true` OLAMAZ. */
  readonly isMostProbable: boolean;
  /** [0,1] — kolun kendi kanıtından gelir; "rota var" tek başına 1 YAPMAZ. */
  readonly confidence: number;
  /** Fiziksel eşleşmeyle doğrulandı mı (niyet ≠ doğrulama). */
  readonly physicallyConfirmed: boolean;
  /** Ufukta gerçekten KAPSANAN mesafe (m). Ölçülemezse `UNAVAILABLE`. */
  readonly lengthM: Evidenced<number>;
  /** Kolun başladığı kenar; fiziksel eşleşme yoksa `null`. */
  readonly startEdgeId: EdgeId | null;
  readonly objects: readonly HorizonObject[];
  /**
   * Bu kolda kaynağın GERÇEKTEN ölçüm ürettiği nesne türleri (F6).
   *
   * **Neden gerekli:** `objects` boş olması iki BAMBAŞKA şey demek olabilir —
   * (a) kaynak baktı ve ileride bu türden nesne yok (ÖLÇÜLMÜŞ YOKLUK),
   * (b) kaynak hiç bakamadı / kesik koridor / paket hazır değil (BİLGİSİZLİK).
   * Tür burada YOKSA boş liste **"ileride yok" DEMEK DEĞİLDİR**; tüketici
   * `NOT_MEASURED` hükmü kurar (`cehConsumerContract` §3 kuralı).
   *
   * Şekil sabittir (V8 hidden-class): alan her zaman vardır, hiç ölçüm
   * yoksa BOŞ dizidir — silinmez, `undefined` bırakılmaz.
   */
  readonly measuredKinds: readonly HorizonObjectKind[];
}

/* ══════════════════════════════════════════════════════════════════════════
   5) UFUK
   ══════════════════════════════════════════════════════════════════════════ */

export interface ElectronicHorizon {
  readonly kind: 'ELECTRONIC_HORIZON';
  /**
   * Üretim kimliği — her yayınlanan ufukta MONOTONİK artar. Tüketici eski bir
   * ufku yeni sanıp karar veremesin diye (F0 §17 stale/generation güvenliği).
   */
  readonly generation: number;
  readonly tsMonoMs: MonotonicMs;
  readonly state: CehHorizonState;
  readonly reason: EvidenceReason;
  /** Ufkun çapası — ham ego pozu. Yoksa `null` (ufuk da yayınlanmaz). */
  readonly egoAnchor: RealtimeEgoPose | null;
  /** Yol-ağı çapası. `null` = fiziksel eşleşme yok. */
  readonly matchedAnchor: MatchedRoadPose | null;
  /** Tüm kollar (MPP dâhil). Belirsizlikte ≥ 2 kol taşınır. */
  readonly paths: readonly HorizonPath[];
  /** MPP kolunun kimliği. **Belirsizlikte `null`** — zorla indirgeme YASAK. */
  readonly mppPathId: HorizonPathId | null;
  readonly ambiguous: boolean;
  /** Kanonik bozulma katkısı (F0 `NavDegradation` — paralel sistem YOK). */
  readonly degradation: NavDegradation;
  /** Bu tik'te HEDEFLENEN ufuk mesafesi (m) — politika, ölçüm değil. */
  readonly budgetM: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   6) UFUK BÜTÇESİ — POLİTİKA (kalibre edilmiş ölçüm DEĞİL)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ **DÜRÜSTLÜK NOTU:** aşağıdaki üç sayı bir zaman-başlığı politikasıdır,
 * bizim sahamızdan ÖLÇÜLMEMİŞTİR. Kalibrasyon `DEVICE_VALIDATION_LEDGER`
 * maddesidir; ölçülmeden "kalibre edildi" YAZILAMAZ.
 */
export const HORIZON_TIME_HEADWAY_S = 30;
export const HORIZON_MIN_M = 200;
export const HORIZON_MAX_M = 2_000;

/** Hıza göre hedef ufuk mesafesi. Hız bilinmiyorsa TABAN kullanılır. */
export function horizonBudgetM(speedMps: number | null | undefined): number {
  if (typeof speedMps !== 'number' || !Number.isFinite(speedMps) || speedMps <= 0) {
    return HORIZON_MIN_M;
  }
  const raw = speedMps * HORIZON_TIME_HEADWAY_S;
  return Math.min(HORIZON_MAX_M, Math.max(HORIZON_MIN_M, raw));
}

/* ══════════════════════════════════════════════════════════════════════════
   7) SAF TÜRETİCİLER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bu durumda "önümde şu var" TÜRÜ bir iddia üretilebilir mi.
 * Belirsiz kol dâhil hiçbir bozulma durumu kesin iddiaya izin VERMEZ.
 */
export function cehStateAllowsAheadClaim(state: CehHorizonState): boolean {
  return state === 'HORIZON_AVAILABLE' || state === 'HORIZON_PARTIAL';
}

/**
 * CEH durumunun KANONİK bozulma karşılığı. CEH kendi bozulma sözlüğünü
 * KURMAZ — `NavDegradation` tek otoritedir (F0 §3).
 *
 * `AMBIGUOUS_PATH` bilinçli olarak `FULL` DEĞİLDİR ama `NO_MAP_DATA` da
 * değildir: harita ve konum vardır, YALNIZ yol kararı verilememiştir →
 * mutlak-doğruluk iddiaları (`STALE_MAP_DATA` satırı: limit/viraj/denetim)
 * susar, rota/manevra rehberliği sürer.
 */
export function degradationForHorizonState(state: CehHorizonState): NavDegradation {
  switch (state) {
    case 'HORIZON_AVAILABLE':
      return 'FULL';
    case 'HORIZON_PARTIAL':
    case 'INSUFFICIENT_METADATA':
    case 'AMBIGUOUS_PATH':
      return 'STALE_MAP_DATA';
    case 'MAP_UNAVAILABLE':
    case 'MATCH_UNAVAILABLE':
    case 'NO_HORIZON_SOURCE':
      return 'NO_MAP_DATA';
    case 'EGO_UNAVAILABLE':
    case 'EGO_STALE':
      return 'NO_POSITION';
    default:
      return 'NO_MAP_DATA';
  }
}

export function isElectronicHorizon(h: unknown): h is ElectronicHorizon {
  return !!h && typeof h === 'object'
    && (h as { kind?: unknown }).kind === 'ELECTRONIC_HORIZON';
}

/** MPP kolunu döndürür. Belirsizlikte / MPP yokken `null`. */
export function mostProbablePath(h: ElectronicHorizon | null | undefined): HorizonPath | null {
  if (!h || h.mppPathId === null || h.ambiguous) return null;
  for (const p of h.paths) {
    if (p.pathId === h.mppPathId && p.isMostProbable) return p;
  }
  return null;
}

/**
 * Sözleşme doğrulayıcı (kilit test): belirsiz bir ufukta HİÇBİR kol MPP
 * işaretli olamaz ve `mppPathId` `null` olmalıdır.
 */
export function ambiguityContractHolds(h: ElectronicHorizon | null | undefined): boolean {
  if (!h) return false;
  if (!h.ambiguous) return true;
  return h.mppPathId === null && h.paths.every((p) => p.isMostProbable === false);
}
