/**
 * vehiclePartitionPolicy — P0-VDK-F5G · ARAÇ BÖLÜMÜ ÇÖP TOPLAMA (SAF POLİTİKA).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR (bu dosyanın var olma nedeni) ───────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F5-F raporunda açık borç olarak yazıldı: sicil araca göre bölümlendi ama
 * **bölüm sayısının tavanı yoktu**. Servis dükkânı gibi çok araç bağlanan bir
 * cihazda `caros-gap-ledger-v1:*` ve `caros-capability-graph-v1:*` dosyaları
 * sınırsız birikirdi — araç başına 120 boşluk + 400 yetenek kenarı.
 *
 * Bu katman o birikmeyi **deterministik ve açıklanabilir** biçimde durdurur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **KATALOG DEĞİLDİR.** Tek satır saklamaz; katalog ayrı modüldedir.
 * (2) **SİLME YAPMAZ.** Yalnız "hangisi gitmeli" sorusunu yanıtlar; silme ve
 *     atomiklik `vehiclePartitionCatalog`ın işidir.
 * (3) **İKİNCİ TAZELİK OTORİTESİ DEĞİLDİR.** Bayatlık eşiği MEVCUT
 *     `CAPABILITY_FRESH_MS`tir (F4-C).
 * (4) **KİMLİK ÜRETMEZ.** Referanslar F4-C parmak izi karmalarıdır.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import { CAPABILITY_FRESH_MS } from './capability/capabilityGraph';

/* ══════════════════════════════════════════════════════════════════════════
   1) TAVAN — repo/cihaz gerçeğinden, uydurma DEĞİL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Cihazda tutulacak azami ARAÇ bölümü sayısı.
 *
 * ⚠️ Sayı uydurulmadı, MEVCUT repo desenlerinden alındı: `safeStorage`
 * `LRU_PROTECTED` listesi `car-vehicle-fingerprints` anahtarını *"bounded LRU
 * cache (max 8 araç kimliği)"* olarak tanımlıyor — yani bu üründe "kaç araç
 * hatırlanır" sorusunun zaten ölçülmüş bir cevabı var. Tanı bölümleri o
 * kimlik önbelleğinden DAHA FAZLA araç tutamaz: tutarsa, kimliği artık
 * hatırlanmayan bir aracın tanı geçmişi cihazda öksüz kalırdı.
 *
 * (`car-deep-scan-history` 16 araç tutar ama o yalnız mod kararı için küçük
 * bir özettir; bölüm başına 120 boşluk + 400 kenarla kıyaslanamaz.)
 */
export const MAX_VEHICLE_PARTITIONS = 8;

/* ══════════════════════════════════════════════════════════════════════════
   2) BÖLÜM ÖZETİ — katalogda tutulan METADATA (ham kenar/boşluk DEĞİL)
   ══════════════════════════════════════════════════════════════════════════ */

/** Bölümün son bilinen sağlığı — MEVCUT `StoreHealth` diliyle uyumlu. */
export type PartitionHealth =
  | 'OK'
  /** Depo okunamadı / şema tutmadı — değeri düşüktür. */
  | 'CORRUPT'
  /** Çöp toplama YARIM kaldı — yeniden denenmeli, sessiz başarı YASAK. */
  | 'PARTIAL_GC'
  /** Hiç ölçülmedi. */
  | 'UNKNOWN';

export const PARTITION_HEALTH_LABEL: Readonly<Record<PartitionHealth, string>> = {
  OK:         'okundu ve geçerli',
  CORRUPT:    'BOZUK — yok sayıldı',
  PARTIAL_GC: 'YARIM TEMİZLİK — tekrar denenmeli',
  UNKNOWN:    'ÖLÇÜLMEDİ',
} as const;

/**
 * Katalog satırı — **yalnız metadata**.
 *
 * ⚠️ Ham yetenek kenarı, ham boşluk kaydı, ham yanıt, VIN ve MAC buraya
 * GİRMEZ. Katalog bir FleetMemory veritabanı değildir; "hangi araçlar var ve
 * ne kadar değerli" sorusunun cevabıdır.
 */
export interface VehiclePartitionEntry {
  /** F4-C parmak izi karması (16 hex) — ham VIN DEĞİL. */
  readonly ref: string;
  readonly createdAt: number | null;
  readonly lastUsedAt: number | null;
  /** Son bilinen boşluk satırı sayısı (yaklaşık — o araç aktifken ölçüldü). */
  readonly gapEntries: number;
  /** Son bilinen KAPANMAMIŞ boşluk sayısı — koruma değerinin temeli. */
  readonly unresolvedGaps: number;
  /** Son bilinen yetenek kenarı sayısı. */
  readonly capabilityEdges: number;
  readonly health: PartitionHealth;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DEĞER SIRALAMASI — açık, tam sayı, kanıtlanabilir
   ══════════════════════════════════════════════════════════════════════════ */

export const PARTITION_RANK_UNRESOLVED = 200;
export const PARTITION_RANK_HEALTHY = 40;
export const PARTITION_RANK_FRESH = 20;

/** Bölüm bayatladı mı — eşik MEVCUT `CAPABILITY_FRESH_MS` (30 gün). */
export function isPartitionStale(
  e: VehiclePartitionEntry, nowMs: number | null,
): boolean {
  if (nowMs === null || e.lastUsedAt === null) return false;
  return (nowMs - e.lastUsedAt) > CAPABILITY_FRESH_MS;
}

/**
 * Bölümün SAKLANMA değeri — yüksek olan kalır.
 *
 * ⚠️ PAZARLIKSIZ KİLİT: `PARTITION_RANK_UNRESOLVED` (200), diğer tüm
 * bileşenlerin toplamından (40 + 20 = 60) BÜYÜKTÜR. Yani **kapanmamış tanı
 * eksiği olan bir aracın bölümü, hiç eksiği olmayan bir araç uğruna ASLA
 * silinmez.** Sicilin varlık sebebi tam olarak o kapanmamış eksiklerdir.
 */
export function partitionRetentionRank(
  e: VehiclePartitionEntry, nowMs: number | null,
): number {
  let r = 0;
  if (e.unresolvedGaps > 0) r += PARTITION_RANK_UNRESOLVED;
  if (e.health === 'OK') r += PARTITION_RANK_HEALTHY;
  if (!isPartitionStale(e, nowMs)) r += PARTITION_RANK_FRESH;
  return r;
}

/**
 * Çöp toplama sırası — ÖNCE silinecek olan başa gelir.
 *
 * Tamamen deterministik: değer → en eski kullanım → referans. Aynı girdi her
 * cihazda AYNI bölümü seçer.
 */
export function comparePartitionGcOrder(
  a: VehiclePartitionEntry, b: VehiclePartitionEntry, nowMs: number | null,
): number {
  const ra = partitionRetentionRank(a, nowMs);
  const rb = partitionRetentionRank(b, nowMs);
  if (ra !== rb) return ra - rb;
  const la = a.lastUsedAt ?? -1;
  const lb = b.lastUsedAt ?? -1;
  if (la !== lb) return la - lb;
  return a.ref.localeCompare(b.ref);
}

/* ══════════════════════════════════════════════════════════════════════════
   4) PLAN
   ══════════════════════════════════════════════════════════════════════════ */

export interface PartitionGcPlan {
  /** Silinecek bölüm referansları — deterministik sırayla. */
  readonly evict: readonly string[];
  /** Neden bu kadar silindi (ya da neden hiç silinmedi). */
  readonly reason: string;
  /** Aktif araç korumasının devreye girip girmediği (kanıt). */
  readonly activeProtected: boolean;
}

const NO_GC = (reason: string, activeProtected: boolean): PartitionGcPlan =>
  Object.freeze({ evict: [], reason, activeProtected });

/**
 * Tavanı aşan bölümleri seçer — SAF.
 *
 * ⚠️ AKTİF ARAÇ HİÇBİR KOŞULDA ADAY DEĞİLDİR: listeden en başta çıkarılır.
 * Bu bir sıralama tercihi değil YAPISAL bir kilittir — kota dolduğu için
 * kullanıcının şu anda bağlı olduğu aracın tanı geçmişini silmek, ürünün en
 * çok ihtiyaç duyulan anda hafızasını kaybetmesi demekti.
 */
export function planPartitionGc(
  entries: readonly VehiclePartitionEntry[],
  activeRef: string | null,
  nowMs: number | null,
  maxPartitions: number = MAX_VEHICLE_PARTITIONS,
): PartitionGcPlan {
  const activeProtected = activeRef !== null
    && entries.some((e) => e.ref === activeRef);
  if (entries.length <= maxPartitions) {
    return NO_GC(
      `bölüm sayısı ${entries.length} ≤ tavan ${maxPartitions} — temizlik gerekmedi`,
      activeProtected);
  }
  const candidates = entries.filter((e) => e.ref !== activeRef);
  const overflow = entries.length - maxPartitions;
  if (candidates.length === 0) {
    return NO_GC('tek bölüm var ve o da AKTİF araç — silinemez', activeProtected);
  }
  const ordered = [...candidates].sort((a, b) => comparePartitionGcOrder(a, b, nowMs));
  const evict = ordered.slice(0, Math.min(overflow, ordered.length)).map((e) => e.ref);
  return Object.freeze({
    evict: Object.freeze(evict),
    reason: `bölüm ${entries.length} > tavan ${maxPartitions} — `
      + `${evict.length} en düşük değerli bölüm temizlendi`
      + (activeProtected ? ' (aktif araç KORUNDU)' : ''),
    activeProtected,
  });
}
