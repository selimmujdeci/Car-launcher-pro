/**
 * aiMechanicView.ts — Fleet Dashboard · AI MECHANIC ÖZET GÖRÜNÜMÜ (SAF).
 *
 * ── AI MECHANIC KARAR ÜRETMEZ ──────────────────────────────────────────
 * Bu dosya `get_ai_mechanic_summary()` satırını KARTA çevirir. Hiçbir karar,
 * güven, kanıt veya öneri ÜRETMEZ; sunucunun MAVI kararlarından türettiği
 * sayıları okur.
 *
 * ── DÜRÜSTLÜK KURALLARI ────────────────────────────────────────────────
 *   · Bilinmeyen değer `null`dır → UI `—` gösterir, **`0` DEĞİL**.
 *   · Analiz yoksa BOŞ KART değil, GEREKÇE gösterilir.
 *   · Öneri/tavsiye/parça/maliyet alanı YOKTUR (P1 yalnız teşhis).
 *
 * SAF: I/O YOK · `Date.now()` YOK · React YOK.
 */

/** `get_ai_mechanic_summary()` satırı (SQL sütun adlarıyla birebir). */
export interface AiMechanicSummaryRow {
  readonly analysis_total?: number | null;
  readonly supported_count?: number | null;
  readonly unsupported_count?: number | null;
  readonly unknown_count?: number | null;
  readonly insufficient_count?: number | null;
  readonly conflicted_count?: number | null;
  readonly expired_count?: number | null;
  readonly critical_count?: number | null;
  readonly warning_count?: number | null;
  readonly engine_count?: number | null;
  readonly cooling_count?: number | null;
  readonly battery_count?: number | null;
  readonly fuel_count?: number | null;
  readonly obd_count?: number | null;
  readonly temperature_count?: number | null;
  readonly connectivity_count?: number | null;
  readonly unknown_category_count?: number | null;
  readonly evidence_ref_total?: number | null;
  readonly conclusive_ratio?: number | null;
  readonly high_confidence_ratio?: number | null;
  readonly newest_analysis_age_seconds?: number | null;
}

export type MechanicCardTone = 'NEUTRAL' | 'GOOD' | 'WARN' | 'BAD';
export type MechanicCardUnit = 'COUNT' | 'PERCENT';

export interface MechanicCard {
  readonly id: string;
  readonly label: string;
  /** `null` = ÖLÇÜLMEDİ. UI bunu `—` gösterir; `0` ile karıştırmaz. */
  readonly value: number | null;
  readonly unit: MechanicCardUnit;
  readonly tone: MechanicCardTone;
  /** Bounded açıklama KODU değil, kısa sabit metin — serbest üretim YOK. */
  readonly detail: string;
}

export interface MechanicView {
  readonly cards: readonly MechanicCard[];
  readonly categories: readonly { readonly label: string; readonly count: number }[];
  /** Analiz yoksa gösterilecek GEREKÇE; varsa `null`. */
  readonly absence: string | null;
}

export const EMPTY_MECHANIC_VIEW: MechanicView = Object.freeze({
  cards: Object.freeze([]) as readonly MechanicCard[],
  categories: Object.freeze([]) as readonly { label: string; count: number }[],
  absence: 'Özet okunamadı — bu "analiz yok" DEMEK DEĞİLDİR.',
});

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pct(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
}

/**
 * Analiz yokluğunun GEREKÇESİ — boş kart yerine dürüst cümle.
 * "Sorun yok" ASLA denmez: analiz yokluğu sağlık kanıtı değildir.
 */
export function mechanicAbsenceExplanation(total: number | null): string | null {
  if (total === null) {
    return 'Özet okunamadı — bu "analiz yok" DEMEK DEĞİLDİR.';
  }
  if (total === 0) {
    return 'Henüz mekanik kapsamda karar üretilmedi. Bu "araç sağlıklı" DEMEK DEĞİLDİR — '
         + 'AI Mechanic yalnız MAVI Reasoning Engine kararlarını yorumlar; karar yoksa teşhis de yoktur.';
  }
  return null;
}

/** SAF görünüm kurucusu — sunucu satırından kart üretir. */
export function buildMechanicView(row: AiMechanicSummaryRow | null | undefined): MechanicView {
  if (row === null || row === undefined) return EMPTY_MECHANIC_VIEW;

  const total       = num(row.analysis_total);
  const critical    = num(row.critical_count);
  const warning     = num(row.warning_count);
  const unknown     = num(row.unknown_count);
  const conflicted  = num(row.conflicted_count);
  const expired     = num(row.expired_count);
  const insufficient = num(row.insufficient_count);
  const evidenceRefs = num(row.evidence_ref_total);
  const conclusive  = pct(row.conclusive_ratio);
  const highConf    = pct(row.high_confidence_ratio);

  const cards: MechanicCard[] = [
    {
      id: 'analysisTotal', label: 'Analiz', value: total, unit: 'COUNT',
      tone: 'NEUTRAL',
      detail: 'MAVI kararlarından türetilen mekanik teşhis sayısı. Yeni karar üretilmez.',
    },
    {
      id: 'critical', label: 'Kritik', value: critical, unit: 'COUNT',
      tone: critical !== null && critical > 0 ? 'BAD' : 'NEUTRAL',
      detail: 'Olumsuz kanıt + yüksek MAVI güveni. Şiddet karar DEĞİL, sunum sıralamasıdır.',
    },
    {
      id: 'warning', label: 'Uyarı', value: warning, unit: 'COUNT',
      tone: warning !== null && warning > 0 ? 'WARN' : 'NEUTRAL',
      detail: 'Olumsuz kanıt + orta/düşük MAVI güveni.',
    },
    {
      id: 'unknown', label: 'Bilinmeyen', value: unknown, unit: 'COUNT',
      tone: 'NEUTRAL',
      detail: 'Karar üretilemedi. Bilinmezlik GİZLENMEZ — ayrı sayılır.',
    },
    {
      id: 'conflicted', label: 'Çelişkili', value: conflicted, unit: 'COUNT',
      tone: 'NEUTRAL',
      detail: 'İki kaynak çelişti. Çelişki bir arıza kanıtı DEĞİL, bilgi eksikliğidir.',
    },
    {
      id: 'insufficient', label: 'Kanıt yetersiz', value: insufficient, unit: 'COUNT',
      tone: 'NEUTRAL',
      detail: '"Veri yok, o hâlde sorun yok" bir teşhis DEĞİLDİR.',
    },
    {
      id: 'expired', label: 'Süresi dolmuş', value: expired, unit: 'COUNT',
      tone: 'NEUTRAL',
      detail: 'Kanıt/karar süresi doldu. Kayıt SİLİNMEZ — geçmiş teşhis açıklanabilir kalır.',
    },
    {
      id: 'evidenceRefs', label: 'Kanıt bağı', value: evidenceRefs, unit: 'COUNT',
      tone: 'NEUTRAL',
      detail: 'Analizlerin dayandığı toplam kanıt referansı (kanıt kopyalanmaz).',
    },
    {
      id: 'conclusive', label: 'Kesin oran', value: conclusive, unit: 'PERCENT',
      tone: 'NEUTRAL',
      detail: 'SUPPORTED + UNSUPPORTED oranı. Analiz yoksa ÖLÇÜLMEDİ (0 değil).',
    },
    {
      id: 'highConfidence', label: 'Yüksek güven', value: highConf, unit: 'PERCENT',
      tone: 'NEUTRAL',
      detail: 'Güven MAVI tarafından türetilir; burada yeniden hesaplanmaz.',
    },
  ];

  const categories = [
    { label: 'Motor',      count: num(row.engine_count) ?? 0 },
    { label: 'Soğutma',    count: num(row.cooling_count) ?? 0 },
    { label: 'Akü',        count: num(row.battery_count) ?? 0 },
    { label: 'Yakıt',      count: num(row.fuel_count) ?? 0 },
    { label: 'OBD/Tanı',   count: num(row.obd_count) ?? 0 },
    { label: 'Sıcaklık',   count: num(row.temperature_count) ?? 0 },
    { label: 'Bağlantı',   count: num(row.connectivity_count) ?? 0 },
    { label: 'Bilinmiyor', count: num(row.unknown_category_count) ?? 0 },
  ];

  return Object.freeze({
    cards: Object.freeze(cards),
    categories: Object.freeze(categories),
    absence: mechanicAbsenceExplanation(total),
  });
}
