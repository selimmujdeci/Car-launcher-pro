/**
 * extendedPollTimeline — ELEME ↔ TAZELİK ZAMAN EKSENİ (kütük #512, saha hipotezi 2).
 *
 * ── SINANAN HİPOTEZ ─────────────────────────────────────────────────────────
 * Saha gözlemi: *"bağlantı hiç kopmadan da veriler bir süre bayat geliyor, sonra
 * tazeleniyor ve taze kalıyor."* Hipotez: **tazelenme, elemenin SONUCU olabilir.**
 *
 * Mekanizma gerçek: `OBDManager.pollLoop` round-robin dalında **tur başına EN FAZLA
 * BİR** extended PID okunur ve elenen (demote) PID atlanır. Yani bir PID'in yeniden
 * güncellenme aralığı ≈ **sorgulanabilir liste uzunluğu × tur süresi**. Liste
 * kısaldıkça rotasyon hızlanır → **hayatta kalanlar tazeleşir**. Uçta liste sıfıra
 * inerse hiçbir şey güncellenmez (2026-08-09 ölçümü: izlenen 11'in 11'i elenmiş).
 *
 * Yani "oturdu" sanılan an, "çoğundan vazgeçti" olabilir. Bu modül o iki eğriyi
 * **AYNI ZAMAN EKSENİNDE** kaydeder ki iddia ölçümle sınansın.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · Kaydedici SENKRON ve BOUNDED; timer KURMAZ, ağa ÇIKMAZ, diske YAZMAZ.
 *  · `Date.now` BURADA çağrılmaz — zaman çağırandan gelir (test edilebilirlik).
 *  · Örnekleme kendi başına iş üretmez: yalnız ZATEN olan olaylara iliştirilir
 *    (değer olayı · eleme olayı). Kanal sustuğunda örnekleme de durur — ve bu
 *    **bulgunun kendisidir**, boşluk uydurulmaz.
 *  · Özet fonksiyonu SAF: aynı örnek dizisi → aynı hüküm.
 */

/* ── Örnek ────────────────────────────────────────────────────────────────── */

export interface ExtendedTimelineSample {
  /** Gerçek zaman ekseni (epoch ms) — çağırandan gelir. */
  readonly atMs: number;
  /** İzlenen PID sayısı. */
  readonly watched: number;
  /** Oturum-içi ELENEN (demote) PID sayısı. */
  readonly demoted: number;
  /** Rotasyona giren = izlenen − elenen. Tur başına 1 PID kuralıyla, bir PID'in
   *  güncellenme aralığı ≈ bu sayı × tur süresi. */
  readonly pollable: number;
  /** Değeri olan PID sayısı (en az bir kez veri gelmiş). */
  readonly valued: number;
  /** Değeri olanların ORTALAMA yaşı (ms). Değer yoksa `null` — sahte 0 YOK. */
  readonly avgAgeMs: number | null;
  /** En bayat PID'in yaşı (ms). Değer yoksa `null`. */
  readonly maxAgeMs: number | null;
}

/** Kaydediciye verilen ham girdi (yaşlar çağıranda hesaplanır — `Date.now` orada). */
export interface ExtendedTimelineInput {
  readonly atMs: number;
  readonly watched: number;
  readonly demoted: number;
  readonly valued: number;
  readonly ageMsList: readonly number[];
}

/* ── Tavanlar ─────────────────────────────────────────────────────────────── */

/** Halka tampon boyu — bounded, bellek tavanı sabit. */
export const TIMELINE_MAX_SAMPLES = 240;
/** Aynı saniyede onlarca örnek yazılmasın; ELEME değişimi bu kısıttan MUAF. */
export const TIMELINE_MIN_GAP_MS = 1_000;

/* ── Halka tampon (modül durumu) ──────────────────────────────────────────── */

let _samples: ExtendedTimelineSample[] = [];

/**
 * Örnek ekler — throttled. `demoted` DEĞİŞTİYSE kısıt uygulanmaz: geçişin tam anı
 * kaydın en değerli noktasıdır, throttle onu yutmamalı.
 *
 * @returns eklendi mi (teşhis/test için).
 */
export function recordExtendedTimelineSample(input: ExtendedTimelineInput): boolean {
  try {
    if (!input || !Number.isFinite(input.atMs)) return false;

    const last = _samples.length > 0 ? _samples[_samples.length - 1] : null;
    const demotedChanged = last !== null && last.demoted !== input.demoted;
    if (last !== null && !demotedChanged && input.atMs - last.atMs < TIMELINE_MIN_GAP_MS) {
      return false;
    }

    const ages = (input.ageMsList ?? []).filter((a) => Number.isFinite(a) && a >= 0);
    const avgAgeMs = ages.length > 0
      ? ages.reduce((s, a) => s + a, 0) / ages.length
      : null;
    const maxAgeMs = ages.length > 0 ? Math.max(...ages) : null;

    _samples.push({
      atMs:     input.atMs,
      watched:  input.watched,
      demoted:  input.demoted,
      pollable: Math.max(0, input.watched - input.demoted),
      valued:   input.valued,
      avgAgeMs,
      maxAgeMs,
    });
    if (_samples.length > TIMELINE_MAX_SAMPLES) {
      _samples = _samples.slice(_samples.length - TIMELINE_MAX_SAMPLES);
    }
    return true;
  } catch {
    return false;   // fail-soft: gözlem hiçbir zaman ürünü düşürmez
  }
}

/** Kayıtlı örnekler (kopyası). */
export function readExtendedTimeline(): readonly ExtendedTimelineSample[] {
  return _samples.slice();
}

/** Yeni oturum/bağlantı — öğrenme gibi zaman ekseni de sıfırlanır. */
export function resetExtendedTimeline(): void {
  _samples = [];
}

/* ── Hüküm (SAF) ──────────────────────────────────────────────────────────── */

export type TimelineVerdict =
  /** Yeterli örnek yok — hüküm VERİLMEZ (sahte ilişki üretilmez). */
  | 'YETERSIZ_ORNEK'
  /** Eleme arttıkça yaş DÜŞÜYOR → saha hipotezi DOĞRULANDI. */
  | 'TERS_ORANTILI'
  /** Eleme arttıkça yaş da ARTIYOR → hipotez ÇÜRÜDÜ. */
  | 'AYNI_YONDE'
  /** Belirgin yön yok. */
  | 'ILISKI_YOK';

export interface TimelineSummary {
  readonly verdict:        TimelineVerdict;
  readonly sampleCount:    number;
  /** `demoted` değerinin kaç farklı seviyesi gözlendi (geçiş var mı). */
  readonly demoteLevels:   number;
  /** Eleme ↑ iken yaş ↓ olan geçiş sayısı (hipotezi DESTEKLEYEN). */
  readonly opposingSteps:  number;
  /** Eleme ↑ iken yaş da ↑ olan geçiş sayısı (hipoteze KARŞI). */
  readonly agreeingSteps:  number;
  /** İlk ve son ölçülebilir ortalama yaş — insan okuru için. */
  readonly firstAvgAgeMs:  number | null;
  readonly lastAvgAgeMs:   number | null;
  readonly firstDemoted:   number | null;
  readonly lastDemoted:    number | null;
  /** Rotasyon uzunluğu sıfıra düştü mü (hiçbir şey güncellenmiyor). */
  readonly reachedZeroPollable: boolean;
}

/** Hüküm için gereken en az örnek — altında hüküm VERİLMEZ. */
export const TIMELINE_MIN_SAMPLES_FOR_VERDICT = 6;

/**
 * Zaman ekseninden hüküm çıkarır — SAF, yan etkisiz.
 *
 * YÖNTEM (bilinçli olarak basit): ardışık örnek çiftlerinde `demoted` DEĞİŞTİĞİ
 * adımlara bakılır ve ortalama yaşın yönü karşılaştırılır. Korelasyon katsayısı
 * ÜRETİLMEZ — örnekler düzensiz aralıklı olduğu için sahte hassasiyet olurdu;
 * yalnız adım YÖNLERİ sayılır ve ham sayılar okura verilir.
 */
export function summarizeExtendedTimeline(
  samples: readonly ExtendedTimelineSample[],
): TimelineSummary {
  const list = (samples ?? []).filter((s) => s && s.avgAgeMs !== null);
  const levels = new Set(list.map((s) => s.demoted));

  let opposing = 0;
  let agreeing = 0;
  for (let i = 1; i < list.length; i += 1) {
    const dDemote = list[i].demoted - list[i - 1].demoted;
    if (dDemote === 0) continue;
    const dAge = (list[i].avgAgeMs as number) - (list[i - 1].avgAgeMs as number);
    if (dAge === 0) continue;
    if ((dDemote > 0 && dAge < 0) || (dDemote < 0 && dAge > 0)) opposing += 1;
    else agreeing += 1;
  }

  const enough = list.length >= TIMELINE_MIN_SAMPLES_FOR_VERDICT && levels.size >= 2;
  const verdict: TimelineVerdict = !enough
    ? 'YETERSIZ_ORNEK'
    : opposing > agreeing ? 'TERS_ORANTILI'
      : agreeing > opposing ? 'AYNI_YONDE'
        : 'ILISKI_YOK';

  return {
    verdict,
    sampleCount:   list.length,
    demoteLevels:  levels.size,
    opposingSteps: opposing,
    agreeingSteps: agreeing,
    firstAvgAgeMs: list.length > 0 ? list[0].avgAgeMs : null,
    lastAvgAgeMs:  list.length > 0 ? list[list.length - 1].avgAgeMs : null,
    firstDemoted:  list.length > 0 ? list[0].demoted : null,
    lastDemoted:   list.length > 0 ? list[list.length - 1].demoted : null,
    reachedZeroPollable: (samples ?? []).some((s) => s && s.pollable === 0),
  };
}

export const TIMELINE_VERDICT_LABEL: Readonly<Record<TimelineVerdict, string>> = {
  YETERSIZ_ORNEK: 'YETERSİZ ÖRNEK — hüküm verilmez',
  TERS_ORANTILI:  'TERS ORANTILI — eleme arttıkça tazelik arttı (saha hipotezi DOĞRULANDI)',
  AYNI_YONDE:     'AYNI YÖNDE — eleme arttıkça yaş da arttı (hipotez ÇÜRÜDÜ)',
  ILISKI_YOK:     'BELİRGİN YÖN YOK',
};
