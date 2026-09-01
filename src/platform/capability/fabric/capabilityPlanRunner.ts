/**
 * capabilityPlanRunner.ts — **MAVİ F6 · PLAN YÜRÜTME KOORDİNATÖRÜ.**
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * Kanonik planı sırayla yürütür ve her adımın **gerçek** sonucunu plana yazar.
 * Yürütmenin kendisini YAPMAZ: kanonik yürütücüyü bir **port** üzerinden çağırır
 * (`dispatch`). Böylece bu dosya `commandExecutor`ı import etmez ve F5'in
 * "ikinci yürütücü YOK" sözleşmesi plan düzeyinde de korunur.
 *
 * ── SERT SINIRLAR ───────────────────────────────────────────────────────────
 *  1. **YETKİ BURADA DOĞMAZ.** Güvenlik · hareket politikası · açık onay ·
 *     port kontrolü kanonik zincirdedir (`maviActionAuthority` → `AiSafetyGate`).
 *     Bu koordinatör onları TAKLİT ETMEZ; yalnız SIRA ve DURUM yönetir.
 *  2. **SAHTE TOPLU BAŞARI YOK.** Her adımın gözlemi ayrı yazılır; plan sonucu
 *     gözlemlerden TÜRETİLİR (`classifyPlanResult`).
 *  3. **ESKİMİŞ TUR YÜRÜTMEZ.** Her adımdan ÖNCE tur güncelliği sorulur; tur
 *     devralındıysa kalan adımlar `CANCELLED` olur ve yan etki BAŞLAMAZ
 *     (F3/F4 stale sözleşmesinin plan düzeyindeki karşılığı).
 *  4. **ONAY BEKLEYEN ADIM YÜRÜTÜLMEZ.** Güvenli adımlar çalışır, onay isteyen
 *     adım `AWAITING_CONFIRMATION`ta bekler. Plan bu hâlde KAPANMAZ.
 *  5. **SAHTE ROLLBACK YOK.** Katalogdaki hiçbir işlem geri-alma sözleşmesi
 *     taşımadığı için tamamlanmış adım "geri alındı" diye GÖSTERİLMEZ.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · Timer KURMAZ · `Date.now` KULLANMAZ · global durum tutmaz (yalnız bounded
 *    tanı sayaçları). Her genel API fail-soft'tur ve ASLA throw etmez.
 */

import type { CapabilityFailure, CapabilityObservation } from './capabilityContract';
import { classifyObservation } from './capabilityFabric';
import { findByLegacyIntent } from './carosCapabilityCatalog';
import {
  classifyPlanResult, resolveExecutionOrder, withItemUpdate,
  type CapabilityPlan, type PlanItem,
} from './capabilityPlan';

/* ══════════════════════════════════════════════════════════════════════════
 * Portlar (DI)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir adımın yürütme sonucu.
 *
 * `observation` **zaten dürüstlük tavanı uygulanmış** gözlemdir
 * (`commandExecutor._recordCapabilityOutcome` → `capabilityFabric`). Tavan
 * ikinci kez uygulanmaz; `status` yalnız daha keskin hata sınıfı için taşınır.
 */
export interface PlanDispatchOutcome {
  readonly observation: CapabilityObservation | null;
  /** Kanonik `IntentExecutionResult.status` (varsa) — hata sınıfını keskinleştirir. */
  readonly status?: string;
}

export interface PlanRunnerPorts {
  /**
   * Kanonik yürütücüyü çağırır. Bu port `commandExecutor` hattına bağlanır;
   * yürütme burada TAKLİT EDİLMEZ ve ikinci bir yürütücü kurulmaz.
   */
  readonly dispatch: (item: PlanItem) => Promise<PlanDispatchOutcome> | PlanDispatchOutcome;
  /** Tur hâlâ bu plana mı ait (stale kapısı). */
  readonly isTurnCurrent: () => boolean;
  /** Onay bekleyen adım için kanonik bekleyen-eylem kurulumu (opsiyonel). */
  readonly requestConfirmation?: (item: PlanItem) => void;
  /** Bounded gözlem olayı — **PARAMETRE DEĞERİ TAŞIMAZ**. */
  readonly onItemSettled?: (
    itemId: string, observation: CapabilityObservation, failure: CapabilityFailure | null,
  ) => void;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yürütme
 * ════════════════════════════════════════════════════════════════════════ */

/** Kanonik durum → bounded hata sınıfı (yalnız BAŞARISIZ durumlar için). */
function failureOfStatus(status: string | undefined): CapabilityFailure | null {
  switch (status) {
    case 'denied':             return 'SAFETY_BLOCKED';
    case 'needs_confirmation': return 'CONFIRMATION_REQUIRED';
    case 'unsupported':        return 'UNAVAILABLE';
    case 'failed':             return 'EXECUTION_FAILED';
    case 'unknown':
    case 'not_handled':        return 'OBSERVATION_UNKNOWN';
    default:                   return null;
  }
}

/** Durum bilinmiyorsa hata sınıfı GÖZLEMDEN türetilir (bounded, kaba ama dürüst). */
function failureOfObservation(o: CapabilityObservation): CapabilityFailure | null {
  switch (o) {
    case 'FAILED':    return 'EXECUTION_FAILED';
    case 'REQUESTED': return 'CONFIRMATION_REQUIRED';
    case 'UNKNOWN':   return 'OBSERVATION_UNKNOWN';
    case 'CANCELLED': return 'CANCELLED';
    default:          return null;
  }
}

/**
 * Planı yürütür ve **güncellenmiş planı** döndürür.
 *
 * Sıra `resolveExecutionOrder` ile belirlenir (bağımlılıklar önce). Varsayılan
 * **ardışıktır**: paralel yürütme audio focus, tek-onay slotu ve TTS tek-cevap
 * sözleşmesini aynı anda zorlar ve kullanıcı için ölçülmüş bir kazancı yoktur.
 */
export async function runCapabilityPlan(
  plan: CapabilityPlan,
  ports: PlanRunnerPorts,
): Promise<CapabilityPlan> {
  let current = plan;
  try {
    if (plan.refusalReason !== null) return plan;      // politika reddi — hiçbir adım çalışmaz

    const ordered = resolveExecutionOrder(
      plan.items.filter((i) => i.executionState !== 'SUPPRESSED'),
    );

    for (const item of ordered) {
      /* STALE KAPISI — her adımdan ÖNCE. Tur devralındıysa kalan adımlar
       * yan etki BAŞLATMADAN iptal edilir. */
      let live = true;
      try { live = ports.isTurnCurrent() === true; } catch { live = false; }
      if (!live) {
        current = withItemUpdate(current, item.itemId, {
          executionState: 'CANCELLED', observationState: 'CANCELLED',
        });
        continue;
      }

      /* ONAY BEKLEYEN ADIM YÜRÜTÜLMEZ — güvenli adımlar akmaya devam eder. */
      if (item.confirmationRequirement) {
        current = withItemUpdate(current, item.itemId, {
          executionState: 'AWAITING_CONFIRMATION', observationState: 'REQUESTED',
          failureClass: 'CONFIRMATION_REQUIRED',
        });
        try { ports.requestConfirmation?.(item); } catch { /* fail-soft */ }
        continue;
      }

      /* BAĞIMLILIK: öncülü başarısız/iptal olduysa bu adım da çalışmaz —
       * "önce eve rota aç, sonra müziği başlat" cümlesinde rota kurulamadıysa
       * ikinci adımı yürütmek kullanıcının istediği şey DEĞİLDİR. */
      const blocked = item.dependencies.some((d) => {
        const dep = current.items.find((x) => x.itemId === d);
        if (!dep) return false;
        return dep.executionState !== 'SETTLED'
          || !(dep.observationState === 'EXECUTED' || dep.observationState === 'OBSERVED');
      });
      if (blocked) {
        current = withItemUpdate(current, item.itemId, {
          executionState: 'CANCELLED', observationState: 'CANCELLED',
          failureClass: 'CANCELLED',
        });
        continue;
      }

      current = withItemUpdate(current, item.itemId, { executionState: 'DISPATCHED' });

      let outcome: PlanDispatchOutcome = { observation: null };
      try { outcome = (await ports.dispatch(item)) ?? { observation: null }; }
      catch { outcome = { observation: 'FAILED', status: 'failed' }; }

      /* Gözlem GELMEDİYSE başarı İDDİA EDİLMEZ: kanonik durum varsa ondan
       * tavanla türetilir, o da yoksa dürüstçe `UNKNOWN` kalır. */
      const def = findByLegacyIntent(item.legacyIntent);
      const observation: CapabilityObservation = outcome.observation
        ?? (outcome.status !== undefined
          ? classifyObservation(outcome.status, def?.observationCeiling ?? 'ACCEPTED')
          : 'UNKNOWN');
      const failure = failureOfStatus(outcome.status) ?? failureOfObservation(observation);
      current = withItemUpdate(current, item.itemId, {
        executionState: 'SETTLED', observationState: observation, failureClass: failure,
      });
      try { ports.onItemSettled?.(item.itemId, observation, failure); } catch { /* fail-soft */ }
    }

    return Object.freeze({ ...current, resultClass: classifyPlanResult(current) });
  } catch {
    /* FAIL-SOFT: koordinatör çökerse plan OLDUĞU GİBİ döner — yarım bir
     * "başarılı" iddiası ÜRETİLMEZ. */
    return Object.freeze({ ...current, resultClass: classifyPlanResult(current) });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * İptal
 * ════════════════════════════════════════════════════════════════════════ */

export interface PlanCancelOutcome {
  readonly plan: CapabilityPlan;
  /** Hiç başlamamış ve iptal edilen adım adedi. */
  readonly cancelled: number;
  /** Uçuşta olup İPTAL EDİLEMEYEN adım adedi — dürüstçe raporlanır. */
  readonly notCancellable: number;
  /** Zaten tamamlanmış ve **geri alınmayan** adım adedi. */
  readonly alreadySettled: number;
}

/**
 * Planı iptal eder ("Boşver").
 *
 *  · `PENDING` / `AWAITING_CONFIRMATION` → `CANCELLED` (hiç başlamadı).
 *  · `DISPATCHED` + `cancellable` → `CANCELLED`.
 *  · `DISPATCHED` + iptal EDİLEMEZ → dokunulmaz ve `notCancellable` sayılır.
 *  · `SETTLED` → **DOKUNULMAZ.** Tamamlanmış iş "geri alındı" gibi
 *    GÖSTERİLMEZ; katalogda geri-alma sözleşmesi yoktur (sahte rollback yasağı).
 */
export function cancelCapabilityPlan(plan: CapabilityPlan): PlanCancelOutcome {
  let cancelled = 0; let notCancellable = 0; let alreadySettled = 0;
  let next = plan;
  for (const item of plan.items) {
    if (item.executionState === 'SUPPRESSED') continue;
    if (item.executionState === 'SETTLED') { alreadySettled += 1; continue; }
    if (item.executionState === 'DISPATCHED' && !item.cancellable) { notCancellable += 1; continue; }
    if (item.executionState === 'CANCELLED') continue;
    next = withItemUpdate(next, item.itemId, {
      executionState: 'CANCELLED', observationState: 'CANCELLED', failureClass: 'CANCELLED',
    });
    cancelled += 1;
  }
  return Object.freeze({
    plan: Object.freeze({ ...next, resultClass: classifyPlanResult(next) }),
    cancelled, notCancellable, alreadySettled,
  });
}
