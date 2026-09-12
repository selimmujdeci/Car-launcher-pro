/**
 * mechanicHistoryAnalyzer — SAF geçmiş/eğilim/tazelik analizi.
 *
 * ⚠️ TEŞHİSİ DEĞİŞTİRMEZ. Girdi olarak aldığı `MechanicDiagnosis` okunur; güven
 * yüzdesi, risk veya nedenler ASLA yeniden hesaplanmaz. Çıktı yalnız YORUMdur.
 *
 * SAF: IO yok, rastgelelik yok, `Date.now()` yok (zaman DIŞARIDAN verilir) →
 * aynı girdi → aynı çıktı, test edilebilir.
 *
 * VERİ UYDURMA YASAK: ölçmeye yetecek geçmiş yoksa 'bilinmiyor' döner;
 * eksik veriyi "kararlı" veya "ilk" diye maskelemez.
 */

import type { MechanicDiagnosis, MechanicRiskLevel } from './mechanicTypes';
import { stripControlChars } from '../controlChars';
import type {
  MechanicFreshness,
  MechanicHistoryEvent,
  MechanicInsight,
  MechanicRecurrence,
  MechanicTrend,
} from './mechanicHistoryTypes';

/* ── Sınırlar / eşikler ────────────────────────────────────────────────────
 * Eşikler aiCore runtime'ının koşu kadansına göre seçildi: teşhis periyodik
 * yenilenir, dakikalar süren bir sonuç ARTIK anlık aracı temsil etmez. */

/** Bu süreden genç → 'taze'. */
export const FRESH_MS  = 60_000;
/** Bu süreden genç → 'gecikmiş'; sonrası 'bayat'. */
export const AGING_MS  = 300_000;

/** Prompt bütçesi: en fazla bu kadar geçmiş olay taşınır. */
export const MAX_SIMILAR_EVENTS = 3;
/** Mevcut Vehicle Memory'den en fazla bu kadar öğrenilmiş gerçek taşınır. */
export const MAX_LEARNED_FACTS  = 2;
/** Bu sayı ve üstü tekrar → 'kronik'. */
export const CHRONIC_THRESHOLD  = 3;

/** Eğilim eşikleri: son aralık, önceki aralıkların ortalamasına göre. */
const SPEEDING_UP_RATIO = 0.6;
const SLOWING_DOWN_RATIO = 1.6;

const MAX_TEXT_CHARS = 140;

/* ── Saf yardımcılar ───────────────────────────────────────────────────────*/

/** Serbest metni tek satıra indirger → blok içine TALİMAT enjekte edilemez. */
function sanitize(text: unknown): string {
  if (typeof text !== 'string') return '';
  return stripControlChars(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/* ══════════════ Tazelik ══════════════ */

/**
 * Teşhisin yaşını değerlendirir. Zaman damgası yoksa/geçersizse 'bilinmiyor'
 * (uydurma "taze" YOK). Gelecek damgası (saat sıçraması) da 'bilinmiyor'.
 */
export function assessFreshness(generatedAt: unknown, now: number): {
  readonly freshness: MechanicFreshness;
  readonly ageMs?: number;
} {
  if (!isFiniteNumber(generatedAt) || !isFiniteNumber(now) || generatedAt <= 0) {
    return { freshness: 'bilinmiyor' };
  }
  const age = now - generatedAt;
  if (age < 0) return { freshness: 'bilinmiyor' };      // saat sıçraması → dürüstçe bilinmiyor
  if (age < FRESH_MS) return { freshness: 'taze', ageMs: age };
  if (age < AGING_MS) return { freshness: 'gecikmiş', ageMs: age };
  return { freshness: 'bayat', ageMs: age };
}

/* ══════════════ Tekrar ══════════════ */

/**
 * Geçmiş olaylardan MEVCUT koda eşleşenleri süzer (en yeni önce).
 * `excludeAt` mevcut sonucun kendi zaman damgasıdır — kendini "tekrar" saymaz.
 */
export function selectSimilarEvents(
  code: string,
  events: readonly MechanicHistoryEvent[],
  excludeAt?: number,
): readonly MechanicHistoryEvent[] {
  if (!code || !Array.isArray(events)) return [];
  return events
    .filter((e) =>
      e && e.code === code && isFiniteNumber(e.at) &&
      !(isFiniteNumber(excludeAt) && e.at === excludeAt))
    .slice()
    .sort((a, b) => b.at - a.at);
}

/** Görülme sayısı → tekrarlama durumu. Geçmiş okunamadıysa 'bilinmiyor'. */
export function classifyRecurrence(repeatCount: number, historyRead: boolean): MechanicRecurrence {
  if (!historyRead) return 'bilinmiyor';
  if (repeatCount <= 0) return 'ilk';
  if (repeatCount >= CHRONIC_THRESHOLD) return 'kronik';
  return 'tekrar';
}

/* ══════════════ Eğilim ══════════════ */

/**
 * Aynı kodun görülme ARALIKLARINDAN eğilim çıkarır.
 * En az 3 gözlem (= 2 aralık) gerekir; azsa 'bilinmiyor' (uydurma yok).
 */
export function analyzeTrend(
  events: readonly MechanicHistoryEvent[],
  nowAt?: number,
): MechanicTrend {
  const stamps = events
    .filter((e) => e && isFiniteNumber(e.at))
    .map((e) => e.at)
    .sort((a, b) => a - b);
  if (isFiniteNumber(nowAt) && (stamps.length === 0 || stamps[stamps.length - 1] !== nowAt)) {
    stamps.push(nowAt);
  }
  if (stamps.length < 3) return 'bilinmiyor';

  const intervals: number[] = [];
  for (let i = 1; i < stamps.length; i++) intervals.push(stamps[i] - stamps[i - 1]);

  const latest = intervals[intervals.length - 1];
  const earlier = intervals.slice(0, -1);
  const mean = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  if (!(mean > 0)) return 'bilinmiyor';                 // sıfır/bozuk aralık → ölçülemez

  if (latest < mean * SPEEDING_UP_RATIO)  return 'sıklaşıyor';
  if (latest > mean * SLOWING_DOWN_RATIO) return 'seyrekleşiyor';
  return 'kararlı';
}

/* ══════════════ Takip önerisi ══════════════ */

const EMERGENCY_RISKS: ReadonlySet<MechanicRiskLevel> = new Set(['Yüksek', 'Kritik']);

/**
 * DETERMİNİSTİK takip önerisi. Sıra ÖNEMLİ: veri sorunları → tazelik →
 * kronik/acil → sıklaşma → normal. LLM bu metni üretmez, yalnız okur.
 */
export function suggestFollowUp(
  diagnosis: MechanicDiagnosis,
  recurrence: MechanicRecurrence,
  trend: MechanicTrend,
  freshness: MechanicFreshness,
): string {
  if (diagnosis.availability === 'unavailable') {
    return 'Araç bağlıyken teşhisi tekrar iste — şu an değerlendirilecek veri yok.';
  }
  if (diagnosis.availability === 'insufficient') {
    return 'Kanıt birikene kadar bekle; araç çalışırken birkaç dakika sonra tekrar bak.';
  }
  if (freshness === 'bayat') {
    return 'Bu sonuç eskimiş — karar vermeden önce güncel okumayı bekle.';
  }
  if (recurrence === 'kronik' && EMERGENCY_RISKS.has(diagnosis.risk)) {
    return 'Yinelenen ve riskli bir bulgu: yetkili servise göstermeyi ertelemeyin.';
  }
  if (recurrence === 'kronik') {
    return 'Aynı bulgu tekrarlıyor: kalıcı bir nedeni olabilir, serviste kontrol ettir.';
  }
  if (trend === 'sıklaşıyor') {
    return 'Bulgu sıklaşıyor: yakından takip et, kötüleşirse servise danış.';
  }
  if (EMERGENCY_RISKS.has(diagnosis.risk)) {
    return 'Riskli bulgu: güvenli şekilde durup ilgili sistemi kontrol et.';
  }
  if (recurrence === 'tekrar') {
    return 'Daha önce de görüldü: bir sonraki sürüşte aynı belirtiyi gözle.';
  }
  return 'Şimdilik gözlem yeterli: belirti tekrarlarsa not al.';
}

/* ══════════════ Birleştirici ══════════════ */

export interface HistoryAnalysisInput {
  readonly diagnosis:    MechanicDiagnosis;
  /** Mevcut sonucun üretim zamanı (aiCore `generatedAt`). */
  readonly generatedAt?: number;
  /** Bus geçmişinden okunan olaylar. */
  readonly events:       readonly MechanicHistoryEvent[];
  /** Geçmiş gerçekten okunabildi mi (kaynak yoksa false → 'bilinmiyor'). */
  readonly historyRead:  boolean;
  /** Mevcut Vehicle Memory'den ilgili ifadeler (salt okunur). */
  readonly learnedFacts: readonly string[];
  readonly now:          number;
}

/**
 * Faz 1 teşhisini DEĞİŞTİRMEDEN geçmiş/eğilim/tazelik yorumunu üretir.
 * SAF ve toplam: her yol bir `MechanicInsight` döner, hiçbiri throw etmez.
 */
export function analyzeMechanicHistory(input: HistoryAnalysisInput): MechanicInsight {
  const { diagnosis, events, historyRead, now } = input;
  const code = diagnosis.topCause?.code ?? '';

  const similar = code ? selectSimilarEvents(code, events, input.generatedAt) : [];
  const repeatCount = similar.length;
  const recurrence = code ? classifyRecurrence(repeatCount, historyRead) : 'bilinmiyor';
  const trend = code ? analyzeTrend(similar, input.generatedAt) : 'bilinmiyor';

  const { freshness, ageMs } = assessFreshness(input.generatedAt, now);
  const followUp = suggestFollowUp(diagnosis, recurrence, trend, freshness);

  return {
    similarEvents: similar.slice(0, MAX_SIMILAR_EVENTS),
    repeatCount,
    recurrence,
    trend,
    freshness,
    ...(ageMs !== undefined ? { ageMs } : {}),
    followUp,
    ...(freshness === 'bayat'
      ? { stalenessNote: 'Bu teşhis güncel değil; araçtan yeni okuma gelmedi.' }
      : {}),
    learnedFacts: (Array.isArray(input.learnedFacts) ? input.learnedFacts : [])
      .map(sanitize).filter(Boolean).slice(0, MAX_LEARNED_FACTS),
  };
}
