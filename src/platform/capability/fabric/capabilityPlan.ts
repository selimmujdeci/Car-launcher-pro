/**
 * capabilityPlan.ts — **MAVİ F6 · KANONİK BİLEŞİK PLAN MODELİ.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Denetim (2026-08-29) şunu ölçtü: bileşik komut **yalnız yerel ayrıştırıcı
 * yolunda** vardı (`voiceService.tryHandleChain` → bağlaç bölmesi →
 * `dispatchChain`). Beyin (LLM) yolu **tek intent** üretiyordu: `parseBrainJson`
 * tek bir `intent` alanı okur, `fromSemanticResult` tek bir `AppIntent` döner.
 * Yani "Eve rota aç, müziği kıs, annemi ara" cümlesinde beyin yolu **tek işi**
 * yapıp diğerlerini sessizce düşürüyordu.
 *
 * Bu dosya o boşluğu **tipli tek bir plan** ile kapatır.
 *
 * ── ÜÇ DURUMUN AYRIMI (F5 sözleşmesinin plan düzeyindeki karşılığı) ─────────
 *   **PROPOSAL** ≠ **EXECUTION** ≠ **OBSERVATION**
 *   · `PlanItem.parameters`     → önerilen (doğrulanmış) girdi
 *   · `PlanItem.executionState` → yürütücüye ne oldu
 *   · `PlanItem.observationState` → sonucun KANIT seviyesi ("yaptım" hakkı)
 *   Üçü ayrı alandır ve biri diğerinden TÜRETİLEREK ezilmez.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** yalnız `capabilityContract` + katalog TİPLERİNİ import eder;
 *    I/O · timer · `Date.now` · global durum · React YOK. Kimlikler DIŞARIDAN
 *    verilir (`planId`/`itemId` üreteci çağıranındır).
 *  · **YÜRÜTMEZ.** Bu dosya hiçbir şey çalıştırmaz, konuşmaz, onay istemez.
 *    Yürütme `capabilityPlanRunner`, yetki kanonik zincirdedir.
 *  · **DETERMİNİSTİK:** aynı girdi → aynı plan. Çakışma ve tekrar politikaları
 *    sabittir; "duruma göre" davranış YOKTUR.
 */

import type {
  CapabilityFailure, CapabilityObservation, CapabilitySafetyClass,
} from './capabilityContract';
import { isSuccessObservation } from './capabilityContract';
import { findByLegacyIntent } from './carosCapabilityCatalog';

/* ══════════════════════════════════════════════════════════════════════════
 * Durum sözlükleri — BOUNDED
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir plan adımının YÜRÜTME durumu (gözlemden AYRI). */
export type PlanItemExecutionState =
  /** Planlandı; henüz hiçbir kapıya gitmedi. */
  | 'PENDING'
  /** Açık kullanıcı onayı bekliyor — yürütülmedi. */
  | 'AWAITING_CONFIRMATION'
  /** Yürütücüye teslim edildi. */
  | 'DISPATCHED'
  /** Yürütme bitti (sonucu `observationState` söyler). */
  | 'SETTLED'
  /** Kullanıcı/tur iptali; hiç başlamadı ya da iptal edilebildi. */
  | 'CANCELLED'
  /** Plan kurulurken elendi (tekrar/çakışma/geçersiz) — ASLA yürütülmedi. */
  | 'SUPPRESSED';

/** Bir adımın neden elendiği — deterministik ve bounded. */
export type PlanSuppressionReason =
  /** Aynı işlem + aynı parametre imzası zaten planda. */
  | 'DUPLICATE'
  /** Aynı capability üzerinde çelişen işlem; SON istek kazandı. */
  | 'CONFLICT_SUPERSEDED'
  /** Katalogda karşılığı yok ya da şema düştü. */
  | 'UNRESOLVED';

/** Planın bütünsel sonucu — "hepsi oldu" iddiası buradan ÜRETİLEMEZ. */
export type PlanResultClass =
  /** Her adım kanıtlı başarıya ulaştı. */
  | 'ALL_SUCCEEDED'
  /** Bazıları başardı, bazıları başaramadı — DÜRÜST kısmi sonuç. */
  | 'PARTIAL'
  /** Hiçbir adım başarıya ulaşmadı. */
  | 'ALL_FAILED'
  /** En az bir adım onay bekliyor; plan henüz kapanmadı. */
  | 'AWAITING_CONFIRMATION'
  /** Plan iptal edildi. */
  | 'CANCELLED'
  /** Plan hiç kurulamadı (çözülebilir adım yok). */
  | 'EMPTY'
  /** Politika gereği tümüyle reddedildi (ör. çoklu onay). */
  | 'REFUSED';

/* ══════════════════════════════════════════════════════════════════════════
 * Plan adımı
 * ════════════════════════════════════════════════════════════════════════ */

export interface PlanItem {
  /** Plan içinde kararlı kimlik (çağıran üretir; sıra numarası yeterlidir). */
  readonly itemId: string;
  readonly capabilityId: string;
  readonly operation: string;
  /** Şemadan geçmiş parametreler — **telemetriye GİRMEZ**. */
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  /** Kanonik yürütücü köprüsü (F5 sözleşmesi — yeni yürütücü YOK). */
  readonly legacyIntent: string;
  /** Bu adımdan ÖNCE bitmesi gereken adım kimlikleri. */
  readonly dependencies: readonly string[];
  /** Yürütme sırası (0'dan artan). Bağımlılıklar bu sırayı EZEBİLİR. */
  readonly order: number;
  /**
   * Açık kullanıcı onayı gerekiyor mu. Katalog + (varsa) kanonik defter
   * birleşimidir; **kapı DEĞİLDİR** — gerçek onay kararını `maviActionAuthority`
   * verir ve çelişkide KANONİK olan kazanır.
   */
  readonly confirmationRequirement: boolean;
  readonly safetyClass: CapabilitySafetyClass;
  /** Yürütme başladıktan sonra iptal edilebilir mi (katalogdan). */
  readonly cancellable: boolean;
  /**
   * Yürütüldükten sonra GERİ ALINABİLİR mi.
   * **Bugün her adım için `false`tur ve bu bilinçlidir:** katalogdaki hiçbir
   * işlem kanonik bir geri-alma sözleşmesi taşımıyor. Sahte rollback üretmek,
   * rollback olmamasından tehlikelidir (kullanıcı geri alındığını sanır).
   */
  readonly reversible: boolean;
  readonly executionState: PlanItemExecutionState;
  readonly observationState: CapabilityObservation;
  readonly failureClass: CapabilityFailure | null;
  /** Elendiyse sebebi (bounded); elenmediyse `null`. */
  readonly suppressionReason: PlanSuppressionReason | null;
}

export interface CapabilityPlan {
  readonly planId: string;
  /** Turu sahiplenen token kimliği — eskimiş plan yürütülemez (F3/F4 sözleşmesi). */
  readonly turnId: number | null;
  readonly items: readonly PlanItem[];
  /** Kurulum sırasında elenen adımlar (gözlem için taşınır, yürütülmez). */
  readonly suppressed: readonly PlanItem[];
  readonly resultClass: PlanResultClass;
  /** Politika reddi varsa bounded gerekçe. */
  readonly refusalReason: 'multiple_confirmation_required_items' | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çakışma sözlüğü — DETERMİNİSTİK
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Aynı capability üzerinde birbirini GEÇERSİZ KILAN işlem çiftleri.
 * "Müziği aç ve kapat" gibi bir cümlede kör yürütme yapılmaz.
 *
 * **POLİTİKA: SON İSTEK KAZANIR (LAST_WINS).** Gerekçe: konuşma dilinde sonradan
 * söylenen kendini düzeltmedir ("müziği aç… yok kapat"). Politika SABİTTİR ve
 * belgelenmiştir — "duruma göre" karar YOKTUR. Elenen adım silinmez,
 * `CONFLICT_SUPERSEDED` olarak gözlemde KALIR.
 */
const CONFLICTING_OPERATIONS: Readonly<Record<string, readonly (readonly [string, string])[]>> =
  Object.freeze({
    'media.playback': Object.freeze([
      Object.freeze(['pause', 'searchAndPlay'] as const),
      Object.freeze(['pause', 'next'] as const),
      Object.freeze(['pause', 'previous'] as const),
    ]),
    'media.volume': Object.freeze([
      Object.freeze(['increase', 'decrease'] as const),
    ]),
  });

/** İki işlem aynı capability üzerinde çelişiyor mu (sırasız karşılaştırma). */
export function operationsConflict(capabilityId: string, a: string, b: string): boolean {
  if (a === b) return false;
  const pairs = CONFLICTING_OPERATIONS[capabilityId];
  if (!pairs) return false;
  for (const [x, y] of pairs) {
    if ((a === x && b === y) || (a === y && b === x)) return true;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Plan kurulumu
 * ════════════════════════════════════════════════════════════════════════ */

/** Plan kurucusuna verilen HAM adım önerisi (F5 kapısından GEÇMİŞ olmalıdır). */
export interface PlanItemProposal {
  readonly capabilityId: string;
  readonly operation: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly legacyIntent: string;
  /** `true` → kanonik defter bu eylem için açık onay istiyor. */
  readonly requiresConfirmation: boolean;
  /** Bir önceki adıma bağımlı mı ("önce … sonra …"). */
  readonly dependsOnPrevious?: boolean;
}

/** Parametre imzası — tekrar tespiti için. **Değerler yalnız BURADA kalır.** */
function signatureOf(p: PlanItemProposal): string {
  const keys = Object.keys(p.parameters).sort();
  const body = keys.map((k) => `${k}=${String(p.parameters[k])}`).join('&');
  return `${p.capabilityId}#${p.operation}?${body}`;
}

export interface BuildPlanOptions {
  readonly planId: string;
  readonly turnId?: number | null;
  /**
   * Bağımsız adımlar için varsayılan sıralama. **Varsayılan `sequential`
   * bilinçlidir:** paralel yürütme audio focus, onay slotu ve TTS tek-cevap
   * sözleşmesini aynı anda zorlar; kazancı ise kullanıcı için ölçülmemiştir.
   */
  readonly ordering?: 'sequential';
}

/**
 * Önerilerden **kanonik plan** kurar.
 *
 * Sırayla uygulanan deterministik kurallar:
 *  1. **TEKRAR:** aynı imza ikinci kez gelirse elenir (`DUPLICATE`). Düzeltme
 *     cümlesi ("Kadıköy'e git, Kadıköy'e git") tek adım üretir.
 *  2. **ÇAKIŞMA:** aynı capability üzerinde çelişen işlem varsa ÖNCEKİ adım
 *     elenir (`CONFLICT_SUPERSEDED`) — son istek kazanır.
 *  3. **BAĞIMLILIK:** `dependsOnPrevious` verilen adım, kendinden önceki
 *     YAŞAYAN adıma bağlanır.
 *  4. **ÇOKLU ONAY:** birden fazla onay gerektiren adım varsa plan TÜMÜYLE
 *     reddedilir. Bu, `sequenceConfirmationPolicy`nin (P1) plan düzeyindeki
 *     karşılığıdır — **yeni politika icat edilmez**, aynı fail-closed karar
 *     korunur: belirsiz rızada hiçbir şey yapmamak, yanlış eylemi onaylatmaktan
 *     üstündür.
 */
export function buildCapabilityPlan(
  proposals: readonly PlanItemProposal[],
  opts: BuildPlanOptions,
): CapabilityPlan {
  const live: PlanItem[] = [];
  const suppressed: PlanItem[] = [];
  const seen = new Map<string, number>();          // imza → live index

  const mk = (
    p: PlanItemProposal, index: number,
    state: PlanItemExecutionState, reason: PlanSuppressionReason | null,
    dependencies: readonly string[],
  ): PlanItem => {
    const def = findByLegacyIntent(p.legacyIntent);
    return Object.freeze({
      itemId: `${opts.planId}:${index}`,
      capabilityId: p.capabilityId,
      operation: p.operation,
      parameters: Object.freeze({ ...p.parameters }),
      legacyIntent: p.legacyIntent,
      dependencies: Object.freeze([...dependencies]),
      order: index,
      confirmationRequirement: p.requiresConfirmation === true,
      safetyClass: (def?.safetyClass ?? 'informational') as CapabilitySafetyClass,
      cancellable: def?.cancellable === true,
      /* Katalogda geri-alma sözleşmesi YOK → sahte rollback üretilmez. */
      reversible: false,
      executionState: state,
      observationState: state === 'SUPPRESSED' ? 'CANCELLED' : 'REQUESTED',
      failureClass: null,
      suppressionReason: reason,
    });
  };

  proposals.forEach((p, index) => {
    const sig = signatureOf(p);

    // 1) TEKRAR
    if (seen.has(sig)) {
      suppressed.push(mk(p, index, 'SUPPRESSED', 'DUPLICATE', []));
      return;
    }

    // 2) ÇAKIŞMA — önceki YAŞAYAN adım elenir (son istek kazanır)
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const prev = live[i];
      if (prev.capabilityId === p.capabilityId
          && operationsConflict(p.capabilityId, prev.operation, p.operation)) {
        suppressed.push(Object.freeze({
          ...prev, executionState: 'SUPPRESSED' as const,
          observationState: 'CANCELLED' as const,
          suppressionReason: 'CONFLICT_SUPERSEDED' as const,
        }));
        live.splice(i, 1);
        seen.delete(`${prev.capabilityId}#${prev.operation}?${
          Object.keys(prev.parameters).sort().map((k) => `${k}=${String(prev.parameters[k])}`).join('&')
        }`);
      }
    }

    // 3) BAĞIMLILIK
    const deps = p.dependsOnPrevious === true && live.length > 0
      ? [live[live.length - 1].itemId]
      : [];

    const item = mk(p, index, 'PENDING', null, deps);
    seen.set(sig, live.length);
    live.push(item);
  });

  // 4) ÇOKLU ONAY → plan TÜMÜYLE reddedilir (P1 fail-closed politikası)
  const confirmCount = live.filter((i) => i.confirmationRequirement).length;
  if (confirmCount > 1) {
    return Object.freeze({
      planId: opts.planId,
      turnId: opts.turnId ?? null,
      items: Object.freeze(live.map((i) => Object.freeze({
        ...i, executionState: 'SUPPRESSED' as const,
        observationState: 'CANCELLED' as const,
        suppressionReason: 'UNRESOLVED' as const,
      }))),
      suppressed: Object.freeze(suppressed),
      resultClass: 'REFUSED' as const,
      refusalReason: 'multiple_confirmation_required_items' as const,
    });
  }

  return Object.freeze({
    planId: opts.planId,
    turnId: opts.turnId ?? null,
    items: Object.freeze(live),
    suppressed: Object.freeze(suppressed),
    resultClass: live.length === 0 ? 'EMPTY' : 'AWAITING_CONFIRMATION',
    refusalReason: null,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sıralama
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bağımlılıkları gözeten yürütme sırası (kararlı topolojik sıralama).
 * Döngü ya da çözülemeyen bağımlılık varsa **kalan adımlar özgün sıralarıyla**
 * eklenir — plan sessizce KAYBOLMAZ (fail-soft, deterministik).
 */
export function resolveExecutionOrder(items: readonly PlanItem[]): readonly PlanItem[] {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const done = new Set<string>();
  const out: PlanItem[] = [];
  let progressed = true;

  while (progressed && out.length < items.length) {
    progressed = false;
    for (const item of items) {
      if (done.has(item.itemId)) continue;
      const ready = item.dependencies.every((d) => !byId.has(d) || done.has(d));
      if (!ready) continue;
      out.push(item); done.add(item.itemId); progressed = true;
    }
  }
  for (const item of items) if (!done.has(item.itemId)) out.push(item);
  return Object.freeze(out);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç sınıflandırması
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Planın bütünsel sonucunu **gözlemlerden** türetir.
 *
 * **SAHTE TOPLU BAŞARI YASAK:** `ALL_SUCCEEDED` yalnız YAŞAYAN adımların
 * TAMAMI kanıtlı başarıya (`EXECUTED`/`OBSERVED`) ulaştıysa verilir. Bir adım
 * bile doğrulanamadıysa sonuç `PARTIAL`dır.
 */
export function classifyPlanResult(plan: CapabilityPlan): PlanResultClass {
  if (plan.refusalReason !== null) return 'REFUSED';
  const live = plan.items.filter((i) => i.executionState !== 'SUPPRESSED');
  if (live.length === 0) return 'EMPTY';
  if (live.some((i) => i.executionState === 'AWAITING_CONFIRMATION')) return 'AWAITING_CONFIRMATION';
  if (live.every((i) => i.executionState === 'CANCELLED')) return 'CANCELLED';

  const settled = live.filter((i) => i.executionState === 'SETTLED');
  if (settled.length === 0) return 'CANCELLED';

  /* ÜÇ KOVA — iki farklı dürüstlük hatasını AYNI ANDA önler:
   *  · `verified`  → KANITLI başarı (`EXECUTED`/`OBSERVED`). Yalnız bu kova
   *    doluysa "hepsini yaptım" denebilir (fazla iddia yasağı).
   *  · `delivered` → yürütücüye teslim edildi ve reddedilmedi (`ACCEPTED`).
   *    Bu bir başarı KANITI değildir ama bir BAŞARISIZLIK da değildir —
   *    `ALL_FAILED` demek eksik iddia olurdu (ters yönde yalan).
   *  · kalanı      → `FAILED`/`UNKNOWN`/`CANCELLED` (kanıt yok).
   * `ALL_FAILED` YALNIZ hiçbir adım teslim bile edilemediğinde verilir. */
  const verified = settled.filter((i) => isSuccessObservation(i.observationState));
  const delivered = settled.filter((i) => i.observationState === 'ACCEPTED');
  if (verified.length === live.length) return 'ALL_SUCCEEDED';
  if (verified.length + delivered.length === 0) return 'ALL_FAILED';
  return 'PARTIAL';
}

/** Plan üzerinde tek adımı günceller (immutable). */
export function withItemUpdate(
  plan: CapabilityPlan,
  itemId: string,
  patch: Partial<Pick<PlanItem,
    'executionState' | 'observationState' | 'failureClass'>>,
): CapabilityPlan {
  const items = plan.items.map((i) => (i.itemId === itemId ? Object.freeze({ ...i, ...patch }) : i));
  const next = Object.freeze({ ...plan, items: Object.freeze(items) });
  return Object.freeze({ ...next, resultClass: classifyPlanResult(next) });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded gözlem özeti (telemetri) — **PARAMETRE DEĞERİ TAŞIMAZ**
 * ════════════════════════════════════════════════════════════════════════ */

export interface PlanTelemetrySummary {
  readonly itemCount: number;
  readonly dependencyCount: number;
  readonly confirmationCount: number;
  readonly executedCount: number;
  readonly observedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly suppressedCount: number;
  readonly resultClass: PlanResultClass;
}

export function summarizePlan(plan: CapabilityPlan): PlanTelemetrySummary {
  const live = plan.items.filter((i) => i.executionState !== 'SUPPRESSED');
  return Object.freeze({
    itemCount: live.length,
    dependencyCount: live.reduce((n, i) => n + i.dependencies.length, 0),
    confirmationCount: live.filter((i) => i.confirmationRequirement).length,
    executedCount: live.filter((i) => i.observationState === 'EXECUTED').length,
    observedCount: live.filter((i) => i.observationState === 'OBSERVED').length,
    failedCount: live.filter((i) => i.observationState === 'FAILED').length,
    cancelledCount: live.filter((i) => i.executionState === 'CANCELLED').length,
    suppressedCount: plan.suppressed.length
      + plan.items.filter((i) => i.executionState === 'SUPPRESSED').length,
    resultClass: plan.resultClass,
  });
}
