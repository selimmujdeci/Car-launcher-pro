/**
 * maviCompoundPlanRuntime.ts — **MAVI-F13/3 · BİLEŞİK PLAN YÜRÜTME MEKANİĞİ.**
 *
 * ── NE İÇİN VAR ─────────────────────────────────────────────────────────────
 * F13 iki bileşik yolu (beyin · yerel ayrıştırıcı) tek kanonik plana bağladı,
 * ama **mekaniği İKİ KEZ yazdı**: plan kimliği üretimi, `buildCapabilityPlan`,
 * `runCapabilityPlan`, adım↔yük eşlemesi, `summarizePlan`, telemetri şekli ve
 * `renderPlanOutcome` her iki yolda da satır satır tekrarlanıyordu (~120 satır
 * ikiz kod). İkiz kod ikiz kusur demektir: birinde düzeltilen bir sıra hatası
 * ötekinde sessizce yaşar.
 *
 * Bu dosya o mekaniği **tek yere** alır.
 *
 * ── SÖZLEŞME (PAZARLIKSIZ) — BU MODÜL OTORİTE DEĞİLDİR ──────────────────────
 *  · **KONUŞMAZ.** `maviSpeech` çağırmaz, `speakMaviAnswerChunk` bilmez, cevap
 *    slotunu tutmaz/bırakmaz. Yalnız **metni DÖNER**; söyleme kararı ve tek-cevap
 *    slotu bileşim kökünün (`voiceService`) elindedir.
 *  · **TUR AÇMAZ/KAPATMAZ.** `maviTurn` import ETMEZ. "Tur hâlâ bizim mi"
 *    sorusunu `isTurnCurrent` PORTUNDAN sorar.
 *  · **YÜRÜTMEZ.** `commandExecutor` · `intentEngine` · `_aiHandlers` ·
 *    `_commandHandlers` bilmez. Adımı `execute` PORTUNA verir; gerçek yürütme ve
 *    gözlem kanalı kökte kalır.
 *  · **KAPI KURMAZ.** `capabilityFabric` · `maviActionAuthority` import ETMEZ.
 *    Öneriler (`PlanItemProposal`) **kapıdan GEÇMİŞ** hâlde gelir; güvenlik,
 *    onay ve capability kararı kanonik zincirdedir.
 *  · **TELEMETRİ YAZMAZ.** Sayıları şekillendirir (`toLatencyPlanPayload`),
 *    kaydı kök yapar — yeni telemetri kanalı AÇILMAZ.
 *
 * Yani bu modülün yaptığı tek şey **plan mekaniğidir**: normalize et, sırala,
 * sırayla çalıştır, sonucu bounded topla.
 *
 * ── IMPORT SINIRI (kilitli) ─────────────────────────────────────────────────
 * YALNIZ kanonik plan katmanını import eder (`capabilityPlan` ·
 * `capabilityPlanRunner` · `capabilityPlanSummary`). Başka hiçbir platform
 * modülü import EDİLMEZ — `voiceRuntimeSeparation` kilitleri bunu tarar.
 */

import {
  buildCapabilityPlan, summarizePlan,
  type CapabilityPlan, type PlanItemProposal, type PlanTelemetrySummary,
} from '../capability/fabric/capabilityPlan';
import { runCapabilityPlan } from '../capability/fabric/capabilityPlanRunner';
import { renderPlanOutcome } from '../capability/fabric/capabilityPlanSummary';
import type { CapabilityObservation } from '../capability/fabric/capabilityContract';

/* ══════════════════════════════════════════════════════════════════════════
 * PLAN KİMLİĞİ — tek sayaç, iki yol
 * ════════════════════════════════════════════════════════════════════════ */

let _planSeq = 0;

/**
 * Plan kimliği öneki — **kapalı küme**. `p` = beyin yolu · `c` = ayrıştırıcı
 * zinciri; LAB'da iki yol bu harften ayırt edilir.
 *
 * ⚠️ **NEDEN SERBEST `string` DEĞİL (QA F13/3 bulgusu):** `itemId` biçimi
 * `${planId}:${öneri indeksi}` ve yürütücü adımı **`itemId.split(':')[1]`**
 * ile yüke eşliyor. Önekte iki nokta bulunursa indeks YANLIŞ okunur ve plan
 * **yanlış komutu çalıştırır** — sessiz ve tehlikeli bir kusur. Sözleşme
 * eskiden yalnız yorumdaydı; artık TİPTE.
 */
export type MaviPlanIdPrefix = 'p' | 'c';

/** Üretilen kimliğin ayrıştırılabilirliğini bozan tek karakter. */
const PLAN_ID_SEPARATOR = ':';

/**
 * Sıradaki plan kimliği. Sayaç taşmaya karşı sarılır (sonsuz büyüme YOK).
 *
 * **FAIL-CLOSED:** tip kapısını aşan bir önek (JS çağrısı · `as` zorlaması ·
 * ileride eklenen üçüncü yol) ayırıcı içeriyorsa kimlik ÜRETİLMEZ ve çağrı
 * ATILIR. Yanlış adımı çalıştırmaktansa planı hiç kurmamak dürüsttür.
 */
export function nextPlanId(prefix: MaviPlanIdPrefix): string {
  if (typeof prefix !== 'string' || prefix.length === 0
      || prefix.includes(PLAN_ID_SEPARATOR)) {
    throw new Error('maviCompoundPlanRuntime: geçersiz plan öneki');
  }
  _planSeq = _planSeq >= Number.MAX_SAFE_INTEGER ? 1 : _planSeq + 1;
  return `${prefix}${_planSeq}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * İSTEK / SONUÇ SÖZLEŞMESİ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir plan adımı: **kapıdan geçmiş** öneri + o adımı yürütmek için gereken
 * çağıran-özel yük (beyin yolunda ham `SemanticResult`, ayrıştırıcı yolunda
 * `ParsedCommand`). Bu modül yükün İÇİNE BAKMAZ — yalnız taşır.
 */
export interface MaviPlanStep<T> {
  readonly proposal: PlanItemProposal;
  readonly payload: T;
}

export interface MaviPlanRequest<T> {
  /** Sıra KORUNUR: `steps[i]` ↔ plan `itemId` indeksi `i`. */
  readonly steps: readonly MaviPlanStep<T>[];
  /** Plan kimliği öneki — kapalı küme (`'p'` beyin · `'c'` zincir). */
  readonly planIdPrefix: MaviPlanIdPrefix;
  /** Plana yazılacak tur kimliği (yalnız etiket — otorite DEĞİL). */
  readonly turnId: number | null;
  /**
   * Tur hâlâ bu plana mı ait? **Her adımdan ÖNCE** sorulur; `false` dönerse
   * kalan adımlar yan etki BAŞLATMADAN iptal edilir. Kararın sahibi kök.
   */
  readonly isTurnCurrent: () => boolean;
  /**
   * Adımı KANONİK yürütücüye teslim eder ve **tavanı uygulanmış** gözlemi
   * döner. Yürütme burada TAKLİT EDİLMEZ; ikinci yürütücü kurulmaz.
   */
  readonly execute: (payload: T) => Promise<CapabilityObservation | null>;
}

export interface MaviPlanResult {
  /** Yürütülmüş plan (adım durumları + gözlemler). */
  readonly plan: CapabilityPlan;
  /** Bounded telemetri özeti (adet + sınıf; metin/parametre YOK). */
  readonly summary: PlanTelemetrySummary;
  /**
   * Gözleme dayalı TEK cümle. **Boş dize = söylenecek kanıtlı bir şey yok** —
   * bu katman cümle UYDURMAZ; çağıran kendi dürüst yedeğini kullanır.
   */
  readonly outcomeText: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * YÜRÜTME
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bileşik planı kurar, sırayla yürütür ve bounded sonucu döner.
 *
 * Sıra sözleşmesi (F6/F13'ten BİREBİR taşındı):
 *   1. `buildCapabilityPlan` — tekrar/çakışma/bağımlılık/çoklu-onay kuralları
 *   2. `runCapabilityPlan` — adım başına stale kapısı + onay kapısı + gözlem
 *   3. `summarizePlan` — bounded sayılar
 *   4. `renderPlanOutcome` — gözleme dayalı tek cümle (uydurma YOK)
 *
 * ⚠️ Bu fonksiyon **cevap slotu tutmaz**. Çağıran, planı çalıştırmadan ÖNCE
 * slotu tutmuş olmalıdır — aksi hâlde adım başına gelen yürütücü geri
 * bildirimleri susturulmaz ve kullanıcı üst üste konuşma duyar (F6 tek-cevap
 * sözleşmesi). Slot sahipliği bilinçli olarak KÖKTE bırakıldı: konuşma
 * otoritesi bu modüle SIZAMAZ.
 */
export async function runMaviCompoundPlan<T>(
  req: MaviPlanRequest<T>,
): Promise<MaviPlanResult> {
  const proposals = req.steps.map((s) => s.proposal);
  const payloads  = req.steps.map((s) => s.payload);

  let plan = buildCapabilityPlan(proposals, {
    planId: nextPlanId(req.planIdPrefix),
    turnId: req.turnId,
  });

  plan = await runCapabilityPlan(plan, {
    isTurnCurrent: req.isTurnCurrent,
    dispatch: async (item) => {
      /* `itemId` = `${planId}:${öneri indeksi}` — `proposals[i]` ile
       * `payloads[i]` aynı adımda ve aynı sırada dolduruldu. */
      const idx = Number(item.itemId.split(':')[1]);
      const payload = payloads[idx];
      if (payload === undefined) return { observation: null };
      return { observation: await req.execute(payload) };
    },
  });

  return Object.freeze({
    plan,
    summary: summarizePlan(plan),
    outcomeText: renderPlanOutcome(plan),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * TELEMETRİ ŞEKLİ (kayıt DEĞİL — yalnız şekil)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * `PlanTelemetrySummary` → F0 gecikme izinin beklediği bounded alan seti.
 *
 * SAF: hiçbir şey yazmaz. Kaydı kök yapar (`setMaviLatencyPlan`) — bu modül
 * telemetri kanalına bağlanmaz. Şekil iki yolda İKİ KEZ yazılıyordu; artık tek.
 */
export function toLatencyPlanPayload(summary: PlanTelemetrySummary): {
  readonly itemCount: number;
  readonly dependencyCount: number;
  readonly confirmationCount: number;
  readonly executedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly resultClass: PlanTelemetrySummary['resultClass'];
} {
  return {
    itemCount:         summary.itemCount,
    dependencyCount:   summary.dependencyCount,
    confirmationCount: summary.confirmationCount,
    /* Gözlenmiş adımlar da "yürütüldü" sayılır — F6'daki toplama BİREBİR. */
    executedCount:     summary.executedCount + summary.observedCount,
    failedCount:       summary.failedCount,
    cancelledCount:    summary.cancelledCount,
    resultClass:       summary.resultClass,
  };
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetMaviCompoundPlanForTest(): void {
  _planSeq = 0;
}
