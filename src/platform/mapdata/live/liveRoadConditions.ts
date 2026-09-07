/**
 * liveRoadConditions.ts — MAP DATA PLATFORM · F6 · CANLI YOL KOŞULU DİKİŞİ (SAF).
 *
 * SAF: I/O YOK · ağ YOK · timer YOK · saat YOK · global durum YOK · React YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA BİR SAĞLAYICI ENTEGRASYONU DEĞİLDİR ──────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bugün hiçbir trafik/olay sağlayıcısı bağlı DEĞİLDİR ve bu dosya bir tane
 * bağlamaz. Yalnız gelecekte (gelir oluştuğunda) HERE · TomTom · yerel bir
 * kamu servisi gibi sağlayıcıların takılabileceği **sözleşmeyi** tanımlar.
 *
 * ── STATİK GERÇEK ≠ CANLI KOŞUL (bağlayıcı ayrım) ─────────────────────────
 * `Map Data` statik gerçeği üretir: yol NEREDE, adı NE, bina NEREDE.
 * Canlı yol koşulu bambaşka bir şeydir: yol ŞU AN nasıl. İkisi aynı
 * otoritede TOPLANMAZ:
 *
 *   · Statik gerçek bayatlarsa → veri kümesi güncellenir (haftalar/aylar).
 *   · Canlı koşul bayatlarsa → **derhal UNKNOWN olur** (dakikalar).
 *
 * Bir tıkanıklık gözlemi yolun geometrisini, adını veya sınıfını DEĞİŞTİRMEZ;
 * bir yol kapanışı bile statik topolojiyi silmez — yalnız o kenarın ŞU ANKİ
 * geçilebilirliğine dair KANIT taşır.
 *
 * ── SAĞLAYICI KAYBOLURSA NAVİGASYON ÇALIŞMAYA DEVAM EDER ──────────────────
 * CLAUDE.md §16 (cross-domain failure isolation): canlı sağlayıcı yoksa,
 * hata verirse veya bayatlarsa **statik navigasyon KAPANMAZ**. Bu yüzden
 * sözleşmenin varsayılanı `NULL_LIVE_ROAD_CONDITIONS`tır ve o daima
 * `UNAVAILABLE` döner — sessiz "trafik yok" DEĞİL.
 *
 * ── ROUTING/CEH'E SINIRLI KANIT ───────────────────────────────────────────
 * Canlı sağlayıcı rota HESAPLAMAZ ve rota DEĞİŞTİRMEZ. Yalnız kenar başına
 * sınırlı kanıt yayınlar; onu kullanıp kullanmamak Routing/CEH kararıdır.
 */

import type { EvidenceGrade } from '../../navigation/contracts/navEvidence';
import type { EpochMs, MapDataSourceId } from '../mapDataSource';
import type { LonLat } from '../mapDataObservation';
import type { MapDataFreshness } from '../mapDataObservation';
import { classifyFreshness } from '../mapDataObservation';

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLÜK
   ══════════════════════════════════════════════════════════════════════════ */

export type LiveConditionKind =
  /** Ölçülen akış hızı (km/h) — serbest akış hızıyla kıyaslanır. */
  | 'TRAFFIC_SPEED'
  /** Tıkanıklık derecesi (0..1, 1 = durma noktası). */
  | 'CONGESTION'
  /** Kaza bildirimi. */
  | 'ACCIDENT'
  /** Yol kapalı. */
  | 'CLOSURE'
  /** Yol çalışması. */
  | 'ROAD_WORKS'
  /** Diğer olay (hava · etkinlik · kontrol noktası). */
  | 'INCIDENT';

export const LIVE_CONDITION_KINDS: readonly LiveConditionKind[] = [
  'TRAFFIC_SPEED', 'CONGESTION', 'ACCIDENT', 'CLOSURE', 'ROAD_WORKS', 'INCIDENT',
] as const;

/**
 * Canlı koşulun tazelik bütçesi (ms). Statik veri bütçeleriyle (gün/hafta)
 * KIYASLANAMAZ: burada birim DAKİKADIR ve aşıldığında değer kullanılmaz.
 *
 * Değerler sağlayıcı seçilmeden ÖLÇÜLEMEZ; bu yüzden tek bir "makul" sayı
 * uydurmak yerine olay tipine göre EN UZUN kabul edilebilir süre yazılır:
 * hız/tıkanıklık hızla eskir, kapanış/yol çalışması daha uzun geçerlidir.
 */
export const LIVE_FRESHNESS_BUDGET_MS: Readonly<Record<LiveConditionKind, number>> = {
  TRAFFIC_SPEED: 3 * 60 * 1000,
  CONGESTION: 5 * 60 * 1000,
  ACCIDENT: 30 * 60 * 1000,
  CLOSURE: 60 * 60 * 1000,
  ROAD_WORKS: 6 * 60 * 60 * 1000,
  INCIDENT: 30 * 60 * 1000,
};

/* ══════════════════════════════════════════════════════════════════════════
   2) GÖZLEM
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * TEK bir canlı gözlem. **Kenar kimliği taşımaz** — canlı sağlayıcılar kendi
 * yol referans sistemlerini kullanır (TMC · OpenLR · kendi id'leri) ve onları
 * bizim `EdgeId`imize eşlemek AYRI bir iştir (map matching). Bu sözleşme
 * eşlemeyi VARSAYMAZ: konum ve sağlayıcı referansı taşınır, eşleme
 * tüketicinin (Routing/CEH) sorumluluğundadır.
 */
export interface LiveRoadObservation {
  readonly kind: LiveConditionKind;
  readonly providerId: MapDataSourceId;
  /** Sağlayıcının kendi yol/olay referansı (ham, yorumlanmadan taşınır). */
  readonly providerRef: string;
  /** Olayın konumu; sağlayıcı vermiyorsa `null` (uydurulmaz). */
  readonly position: LonLat | null;
  /**
   * Sayısal değer — `TRAFFIC_SPEED` için km/h, `CONGESTION` için [0,1].
   * Diğer tiplerde `null` (olayın kendisi bilgidir).
   */
  readonly value: number | null;
  /** Gözlemin sağlayıcıdaki damgası. `null` → tazelik HESAPLANMAZ. */
  readonly observedAtEpochMs: EpochMs | null;
  /** Sağlayıcının ilan ettiği güven [0,1]; bildirmiyorsa `null`. */
  readonly providerConfidence: number | null;
}

/** Tazelik + kanıt sınıfı ile zenginleştirilmiş canlı kanıt. */
export interface LiveRoadEvidence {
  readonly observation: LiveRoadObservation;
  readonly freshness: MapDataFreshness;
  readonly grade: EvidenceGrade;
}

/**
 * Canlı gözlemi kanıta çevirir. **Bayat canlı veri STALE değil, kullanılamaz
 * sayılır**: statik veride bayat bir ad hâlâ işe yarar, bayat bir trafik
 * hızı ise YANLIŞ karar ürettirir. Bu yüzden bütçe aşımında `UNAVAILABLE`.
 */
export function gradeLiveObservation(
  observation: LiveRoadObservation,
  nowEpochMs: EpochMs,
): LiveRoadEvidence {
  const budget = LIVE_FRESHNESS_BUDGET_MS[observation?.kind] ?? null;
  const freshness = classifyFreshness(observation?.observedAtEpochMs ?? null, nowEpochMs, budget);
  const usable = freshness.classification === 'FRESH' || freshness.classification === 'AGING';
  return {
    observation,
    freshness,
    grade: usable ? 'OBSERVED' : 'UNAVAILABLE',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) PORT
   ══════════════════════════════════════════════════════════════════════════ */

export type LiveProviderUnavailableReason =
  | 'NO_PROVIDER'
  | 'NO_COVERAGE'
  | 'PROVIDER_ERROR'
  | 'NOT_AUTHORIZED'
  | 'OFFLINE';

export interface LiveRoadConditionsResult {
  readonly evidence: readonly LiveRoadEvidence[];
  readonly grade: EvidenceGrade;
  readonly unavailableReason: LiveProviderUnavailableReason | null;
}

export function unavailableLiveResult(
  reason: LiveProviderUnavailableReason,
): LiveRoadConditionsResult {
  return { evidence: [], grade: 'UNAVAILABLE', unavailableReason: reason };
}

/** Sorgu penceresi — sınırsız sorgu YOKTUR (maliyet ve gizlilik). */
export interface LiveRoadQuery {
  /** İlgilenilen koridor noktaları (rota geometrisinin seyreltilmiş hâli). */
  readonly corridor: readonly LonLat[];
  /** Koridor çevresinde metre cinsinden tampon. */
  readonly bufferM: number;
  readonly kinds: readonly LiveConditionKind[];
}

export interface LiveRoadConditionsPort {
  readonly providerId: MapDataSourceId | null;
  query(q: LiveRoadQuery, nowEpochMs: EpochMs): Promise<LiveRoadConditionsResult>;
}

/**
 * Varsayılan: **sağlayıcı yok.** Bu bir eksiklik değil, bugünkü gerçeğin
 * beyanıdır. Bu port bağlıyken navigasyon TAM ÇALIŞIR — canlı koşul yalnız
 * bir zenginleştirmedir, bir bağımlılık değil.
 */
export const NULL_LIVE_ROAD_CONDITIONS: LiveRoadConditionsPort = {
  providerId: null,
  query: async () => unavailableLiveResult('NO_PROVIDER'),
};

/* ══════════════════════════════════════════════════════════════════════════
   4) SAF YARDIMCILAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Sorgu anlamlı mı — boş koridorla sağlayıcı ÇAĞRILMAZ (maliyet). */
export function isMeaningfulLiveQuery(q: LiveRoadQuery | null | undefined): boolean {
  return !!q && Array.isArray(q.corridor) && q.corridor.length > 0
    && Array.isArray(q.kinds) && q.kinds.length > 0
    && typeof q.bufferM === 'number' && Number.isFinite(q.bufferM) && q.bufferM > 0;
}

/**
 * Karar için kullanılabilir kanıtlar. Bayat/kanıtsız olanlar ELENİR —
 * "elimizdeki en iyi veri" diye bayat trafik verisi kullanılmaz.
 */
export function usableLiveEvidence(
  result: LiveRoadConditionsResult | null | undefined,
): readonly LiveRoadEvidence[] {
  if (!result || !Array.isArray(result.evidence)) return [];
  return result.evidence.filter((e) => e.grade === 'OBSERVED' && e.observation !== null);
}

/**
 * Canlı koşulun statik gerçeği DEĞİŞTİRİP değiştiremeyeceği — cevap DAİMA
 * `false`. Bu fonksiyon bir kilit noktasıdır: birisi canlı veriyi statik
 * veri kümesine yazmak isterse buradan geçmek zorundadır ve geçemez.
 */
export function canLiveConditionMutateStaticTruth(): false {
  return false;
}
