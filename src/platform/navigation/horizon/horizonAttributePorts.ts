/**
 * horizonAttributePorts.ts — NAV v3 · L3 · UFUK ÖZNİTELİK SINIRI (SAF · F3).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F3.4/F3.5.
 *
 * SAF: I/O YOK · timer YOK · ağ YOK · saat OKUMAZ · React YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYANIN İŞİ: SINIRI ÖNCE KURMAK ───────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "İleride limit / viraj / eğim / denetim noktası var mı" sorusu bugün depoda
 * dağınık cevaplanıyor (Guardian `enforcementMapSource` kendi koni sorgusunu
 * yapar; `speedLimitService` yalnız BULUNULAN yolu bilir; viraj/eğim
 * dilimlerinin ÜRETİCİSİ HİÇ YOKTUR). F3'ün işi bu cevapları topluca taşımak
 * DEĞİL, **tek kapıyı açmaktır**: yeni L4+ kod bu porttan sorar, ham
 * sağlayıcıdan sormaz (kilit test denetler).
 *
 * ── F3'TE NEDEN ÜRETİM BAĞLANTISI YOK (bilinçli borç) ────────────────────
 * ÖLÇÜLDÜ (2026-09-03): tek gerçek "ileride" üreticisi Guardian'ın
 * `enforcementMapSource`'udur ve kendi yarıçap/başlık koni kapısıyla ÇALIŞIR.
 * CEH'e ikinci bir denetim-noktası hesabı koymak, aynı fiziksel soruya iki
 * farklı cevap üreten PARALEL OTORİTE demek olurdu (CLAUDE.md §CROSS-DOMAIN 1).
 * Doğru sıra: önce sınır (bu dosya) → sonra TÜKETİCİNİN tek hamlede taşınması.
 * Bu yüzden üretim portu her sorguya dürüstçe `NOT_MEASURED` der.
 *
 * ── UNKNOWN ≠ NONE ───────────────────────────────────────────────────────
 * Boş nesne listesi **"ileride bir şey yok" DEMEK DEĞİLDİR**. Ayrımı
 * `HorizonAttributeOutcome` taşır: `NO_OBJECTS_IN_RANGE` bir ÖLÇÜMDÜR,
 * `NOT_MEASURED` bir BİLGİSİZLİKTİR. CEH ikisini asla aynı sunmaz.
 */

import type { MonotonicMs } from '../contracts/navMonotonicTime';
import type { EdgeId } from '../contracts/navEdgeId';
import type { EvidenceReason } from '../contracts/navEvidence';
import type {
  HorizonObject, HorizonPathId, HorizonPathProvenance,
} from '../contracts/navHorizon';

/* ══════════════════════════════════════════════════════════════════════════
   1) SORGU
   ══════════════════════════════════════════════════════════════════════════ */

export interface HorizonAttributeQuery {
  readonly pathId: HorizonPathId;
  readonly provenance: HorizonPathProvenance;
  /** Kolun başladığı kenar; fiziksel eşleşme yoksa `null`. */
  readonly startEdgeId: EdgeId | null;
  /**
   * Aracın o kenarın BAŞINDAN yol-boyu mesafesi (m) — koridorun çapası (F6).
   * `null` = eşleşme yok ya da mesafe ölçülemedi (uydurma 0 YOK).
   */
  readonly startAlongEdgeM: number | null;
  /**
   * Sorgunun coğrafi çapası — **eşleşmiş (snap edilmiş) konum**, ham GPS
   * DEĞİL. Yalnız uzamsal ön-eleme içindir (hangi öznitelikler yakında);
   * "önümde mi" kararı DAİMA yol koridorunundur (F6). `null` = ölçülemedi.
   */
  readonly anchorLat: number | null;
  readonly anchorLon: number | null;
  /** Bu kolda ileriye taranacak mesafe (m). */
  readonly budgetM: number;
  readonly nowMonoMs: MonotonicMs;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SONUÇ
   ══════════════════════════════════════════════════════════════════════════ */

export type HorizonAttributeOutcome =
  /** Öznitelik nesnesi üretildi. */
  | 'OBJECTS'
  /** Kaynak SAĞLAM ve tarandı; bu menzilde nesne YOK (gerçek ölçüm). */
  | 'NO_OBJECTS_IN_RANGE'
  /** Kaynak var ama bu kol/kenar için metadata YOK. */
  | 'INSUFFICIENT_METADATA'
  /** Kaynak yok / okunamıyor. */
  | 'SOURCE_UNAVAILABLE'
  /** HİÇ ölçülmedi — "yok" DEĞİL. */
  | 'NOT_MEASURED';

export const HORIZON_ATTRIBUTE_OUTCOMES: readonly HorizonAttributeOutcome[] = [
  'OBJECTS', 'NO_OBJECTS_IN_RANGE', 'INSUFFICIENT_METADATA',
  'SOURCE_UNAVAILABLE', 'NOT_MEASURED',
] as const;

export interface HorizonAttributeResult {
  readonly outcome: HorizonAttributeOutcome;
  /** `outcome !== 'OBJECTS'` iken DAİMA boş. */
  readonly objects: readonly HorizonObject[];
  readonly reason: EvidenceReason;
}

/** Bu sonuç "tarandı ve gerçekten yok" diyor mu (bilgisizlikten AYRI). */
export function outcomeIsMeasuredAbsence(o: HorizonAttributeOutcome): boolean {
  return o === 'NO_OBJECTS_IN_RANGE';
}

/* ══════════════════════════════════════════════════════════════════════════
   3) PORT
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir portun GERÇEKTEN üretebildiği öznitelik alanları.
 *
 * ── NEDEN ALAN ALAN (F6) ─────────────────────────────────────────────────
 * "Öznitelik portu bağlandı" TEK bir bayrak olamaz: F6'da yalnız denetim
 * noktası zinciri kuruldu; hız limiti · viraj · eğim alanlarının bu binary'de
 * (`RTG2`) kaynağı **YOKTUR** ve uydurulmayacaktır. Tek bayrak, bağlanmamış üç
 * alanı da "bağlı" göstererek cutover kapısını YALAN kanıtla açardı.
 */
export type HorizonAttributeDomain =
  | 'ENFORCEMENT'
  | 'SPEED_LIMIT'
  | 'CURVE'
  | 'ROAD_PROFILE';

export const HORIZON_ATTRIBUTE_DOMAINS: readonly HorizonAttributeDomain[] = [
  'ENFORCEMENT', 'SPEED_LIMIT', 'CURVE', 'ROAD_PROFILE',
] as const;

export interface HorizonAttributePorts {
  /** Senkron tek okuma. Abonelik AÇMAZ, timer KURMAZ, ağa ÇIKMAZ. */
  readAhead(query: HorizonAttributeQuery): HorizonAttributeResult;
  /**
   * Bu portun GERÇEKTEN üretebildiği alanlar. **Beyan değil kapasitedir:**
   * burada olmayan bir alanda boş sonuç "ileride yok" DEĞİL, "ölçülmedi"dir.
   */
  readonly boundDomains: readonly HorizonAttributeDomain[];
}

const _NOT_MEASURED: HorizonAttributeResult = {
  outcome: 'NOT_MEASURED',
  objects: [],
  reason: 'NO_SOURCE',
};

/** Hiçbir şey bilmeyen port — fail-closed varsayılan. */
export const UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS: HorizonAttributePorts = {
  readAhead: () => _NOT_MEASURED,
  boundDomains: [],
};

/**
 * Üretim VARSAYILANI — **hâlâ `UNAVAILABLE` ile aynıdır.**
 *
 * ── NEDEN BU SEMBOL GERÇEK PORTA DÖNÜŞTÜRÜLMEDİ (F6 kararı) ──────────────
 * Gerçek denetim portu `enforcement/**` ağacındaki ham paket okuyucusunu
 * çağırır ve L1 cephesini kullanır. Onu `horizon/**` ağacına koymak, L3'ün
 * ham "ileride" sağlayıcısını doğrudan sahiplenmesi demek olurdu — F3'ün
 * K1/K14 kilitlerinin ve CLAUDE.md §CROSS-DOMAIN 2'nin engellediği şey tam
 * olarak budur (kilit test kaynak taramasıyla denetler — bu dosyada bile
 * ham modül adı GEÇMEZ).
 *
 * Bu yüzden F6'da port **bileşim kökünden İTİLİR** (`navEgoHorizonBridge` →
 * `CehAuthority.bindAttributePorts`), tıpkı rota niyetinin itilmesi gibi.
 * Bu sembol fail-closed varsayılan olarak KALIR ve bağlanma hükmü artık bir
 * referans karşılaştırması değil, portun `boundDomains` KAPASİTESİDİR.
 */
export const productionHorizonAttributePorts: HorizonAttributePorts =
  UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS;

/** Bu port verilen alanı gerçekten üretebiliyor mu. */
export function portBindsDomain(
  ports: HorizonAttributePorts | null | undefined, domain: HorizonAttributeDomain,
): boolean {
  if (!ports || !Array.isArray(ports.boundDomains)) return false;
  return ports.boundDomains.indexOf(domain) >= 0;
}

/** Portun TÜM öznitelik alanlarını üretip üretmediği (cutover şartı). */
export function portBindsAllDomains(
  ports: HorizonAttributePorts | null | undefined,
): boolean {
  if (!ports || !Array.isArray(ports.boundDomains)) return false;
  for (const d of HORIZON_ATTRIBUTE_DOMAINS) {
    if (ports.boundDomains.indexOf(d) < 0) return false;
  }
  return true;
}
