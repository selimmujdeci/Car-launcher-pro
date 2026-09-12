/**
 * perfContract — ARCH-06/F1 KANONİK PERFORMANS ÖLÇÜM SÖZLEŞMESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **DEPO DEĞİLDİR.** Hiçbir metriği saklamaz. Sahibi kim ise ölçümü o
 *     tutar (`bootTimingRecorder` · `perfSeriesRecorder` · `perfCounters` ·
 *     native köprü). Burada yalnız ORTAK ŞEKİL vardır.
 * (2) **OTORİTE DEĞİLDİR.** Eşik koymaz, hüküm vermez, "yavaş" demez.
 * (3) **YÜRÜTMEZ.** I/O · timer · abonelik · `Date.now` YOK. Saf ve
 *     dondurulmuş nesne üretir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── DEĞİŞMEZ KURALLAR ─────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   ölçüm yok         → `value: null`   ("0" DEĞİL)
 *   `null` ≠ 0        · desteklenmiyor ≠ sıfır
 *   erişilemez ≠ sağlıklı · bayat ≠ güncel
 *   sentetik ölçüm ≠ saha kanıtı  (`kind` + `provenance` bunu taşır)
 *
 * Bu kurallar ARCH-02'nin "sahte 0 yasak" sözleşmesinin performans yüzüdür:
 * ölçülmemiş bir FPS'i 0 yazmak, "ekran donuyor" demektir — oysa yalnız
 * ölçülmemiştir.
 */

/**
 * ARCH-01/F8 sözlüğü AYNEN kullanılır — ikinci bir tazelik enum'u KURULMAZ.
 * (`CURRENT · STALE · UNAVAILABLE · UNKNOWN`)
 */
export type { EvidenceFreshness } from '../runtime/runtimeObservability';
import type { EvidenceFreshness } from '../runtime/runtimeObservability';

/**
 * Ölçümün DOĞASI — değerin nereden geldiğini söyler.
 *
 *  `MEASURED`   doğrudan ölçüldü (sayaç · zaman damgası · API okuması)
 *  `DERIVED`    ölçülmüş değerlerden HESAPLANDI (oran · fark · ortalama)
 *  `UNMEASURED` ölçüm yok — `value` DAİMA `null`
 */
export type PerfMetricKind = 'MEASURED' | 'DERIVED' | 'UNMEASURED';

/** Sayısal birim — serbest metin YOK (LAB birim uydurmasın). */
export type PerfUnit =
  | 'ms' | 'count' | 'per_sec' | 'bytes' | 'mb' | 'fps' | 'celsius' | 'ratio' | 'none';

export interface PerfMetric {
  /** Nokta ayrılmış kanonik ad: `boot.first_frame` · `bridge.can_data.rate`. */
  readonly name: string;
  /** Ölçümün SAHİBİ — projeksiyonu yapan değil, veriyi tutan modül. */
  readonly owner: string;
  /** Ölçülmediyse `null`. ASLA 0 ile doldurulmaz. */
  readonly value: number | null;
  readonly unit: PerfUnit;
  /** Örnekleme penceresi (ms). Anlık/kümülatif ölçümde `null`. */
  readonly sampleWindowMs: number | null;
  /** Monotonik gözlem damgası (`performance.now()`). Ölçülmediyse `null`. */
  readonly observedAt: number | null;
  readonly freshness: EvidenceFreshness;
  readonly provenance: readonly string[];
  readonly kind: PerfMetricKind;
}

/** Bir bölümün metrikleri — LAB ve dışa aktarım aynı şekli görür. */
export interface PerfSection {
  readonly sectionId: string;
  readonly metrics: readonly PerfMetric[];
  readonly notes: readonly string[];
}

const EMPTY: readonly string[] = Object.freeze([]);

/**
 * ÖLÇÜLMÜŞ metrik. `value` geçerli bir sayı değilse otomatik olarak
 * `UNMEASURED`e düşer — çağıran yanlışlıkla `NaN`/`Infinity` yazamaz.
 */
export function measured(input: {
  readonly name: string;
  readonly owner: string;
  readonly value: number | null | undefined;
  readonly unit: PerfUnit;
  readonly observedAt?: number | null;
  readonly sampleWindowMs?: number | null;
  readonly freshness?: EvidenceFreshness;
  readonly provenance?: readonly string[];
}): PerfMetric {
  const ok = typeof input.value === 'number' && Number.isFinite(input.value);
  return Object.freeze({
    name: input.name,
    owner: input.owner,
    value: ok ? (input.value as number) : null,
    unit: input.unit,
    sampleWindowMs: input.sampleWindowMs ?? null,
    observedAt: input.observedAt ?? null,
    /* Ölçüm yoksa tazelik iddiası da YOKTUR. */
    freshness: ok ? (input.freshness ?? 'CURRENT') : 'UNAVAILABLE',
    provenance: Object.freeze([...(input.provenance ?? EMPTY)]),
    kind: ok ? 'MEASURED' : 'UNMEASURED',
  });
}

/** ÖLÇÜLMÜŞ değerlerden TÜRETİLMİŞ metrik (oran · hız · fark). */
export function derived(input: {
  readonly name: string;
  readonly owner: string;
  readonly value: number | null | undefined;
  readonly unit: PerfUnit;
  readonly sampleWindowMs?: number | null;
  readonly observedAt?: number | null;
  readonly provenance?: readonly string[];
}): PerfMetric {
  const base = measured(input);
  return Object.freeze({ ...base, kind: base.value === null ? 'UNMEASURED' : 'DERIVED' });
}

/**
 * ÖLÇÜLMEMİŞ metrik — dürüst boşluk.
 *
 * Bir metriği listeden ÇIKARMAK yerine `unmeasured` ile göstermek bilinçlidir:
 * "bu metrik var ama ölçemiyoruz" ile "böyle bir metrik yok" AYRI şeylerdir.
 */
export function unmeasured(
  name: string, owner: string, unit: PerfUnit, reason: string,
): PerfMetric {
  return Object.freeze({
    name, owner, value: null, unit,
    sampleWindowMs: null, observedAt: null,
    freshness: 'UNAVAILABLE' as EvidenceFreshness,
    provenance: Object.freeze([reason]),
    kind: 'UNMEASURED' as PerfMetricKind,
  });
}

export function section(
  sectionId: string, metrics: readonly PerfMetric[], notes: readonly string[] = EMPTY,
): PerfSection {
  return Object.freeze({
    sectionId,
    metrics: Object.freeze([...metrics]),
    notes: Object.freeze([...notes]),
  });
}

/**
 * Monotonik saat. Duvar saati (`Date.now`) süre hesabına GİRMEZ — cihaz saati
 * ileri/geri atlarsa süre yalanlanır (CLAUDE.md §4 clock-jump koruması).
 * `performance` yoksa `null` döner: sahte 0 üretmez.
 */
export function perfNow(): number | null {
  try {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() : null;
  } catch { return null; }
}

/**
 * Pencere hızı türetir (olay/sn). Pencere yoksa/0 ise `null` — sıfıra bölüp
 * `Infinity` yazmak ya da 0 döndürmek iki ayrı yalan olurdu.
 */
export function ratePerSec(count: number | null, windowMs: number | null): number | null {
  if (count === null || windowMs === null || !Number.isFinite(count) || !Number.isFinite(windowMs)) return null;
  if (windowMs <= 0) return null;
  return (count * 1000) / windowMs;
}
