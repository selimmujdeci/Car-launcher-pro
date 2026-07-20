/**
 * maviCore/navActions.ts — MAVİ 4.0 · DRIVE-1 · UYGULAMA NAVİGASYONU EYLEM KATMANI.
 *
 * AMAÇ (VİZYON — "Mavi aracın ikinci beyni; uygulamanın tamamını sesle yönetir"): Uygulama-içi
 * ekran açma/kapatma eylemlerini MEVCUT Action Registry + Execution Engine üzerinden tanımlar.
 * **YENİ router / navigator / dispatcher / state manager / event bus YOKTUR** — bu katman yalnız:
 *   1. `MaviActionRegistry`'ye typed `open.<screen>` / `open.home` / `go.back` tanımları kaydeder,
 *   2. Bu eylemleri MEVCUT navigator port'una (screenRegistry.getScreenById + drawerBus) bağlayan
 *      handler'lar üretir,
 *   3. MEVCUT `MaviExecutionEngine`'i tek dispatch yolu olarak sarar.
 *
 * TOUCH == VOICE: Her iki yüzey de AYNI registry + AYNI engine + AYNI handler üzerinden gider;
 * `source` yalnız TANI alanıdır (ownership) — karar/yol AYRIŞMAZ. İkinci paralel dispatcher yok.
 *
 * SÖZLEŞME (executionEngine'den devralınır — CLAUDE.md §2/§3):
 *  - typed input  : her eylemin `validate`'i (fail-closed payload doğrulama).
 *  - typed output : StepResult (ack — ekran eylemleri veri taşımaz).
 *  - rollback     : `open.<screen>` reversible → geri-alma = mevcut çekmeceyi kapat (ana ekran).
 *                   `go.back`/`open.home` tek-yön (reversible=false → rollback denenmez).
 *  - timeout      : def.timeoutMs (motor AbortSignal ile keser).
 *  - cancel       : AbortSignal (timeout) + stale-generation reddi (motor).
 *  - ownership    : dispatch `source` ('touch'|'voice'|…) — tanı alanı, karar değil.
 *  - diagnostic   : her dispatch correlationId/actionId/duration/cancelReason/errorCategory/
 *                   ownership üretir. **PASS/FAIL / yeşil-kırmızı ÜRETMEZ** (olgusal kategori).
 *
 * GÜVENLİK: AiSafetyGate KORUNUR (motor `evaluateActionSafety` çağırır). Nav eylemleri araç
 * kapsamsız + düşük risk → gate araç kararına dokunmaz; bilinmeyen eylem fail-closed reddedilir.
 * Ekran bulunamazsa handler ok:false döner → mevcut ekran BOZULMAZ (çekmece değişmez).
 */

import {
  MaviActionRegistry, createActionRegistry, validateEmpty,
  type ActionDefinition,
} from './actionRegistry';
import {
  createExecutionEngine, type ActionHandler, type ActionExecResult,
  type MaviPlan, type PlanResult, type StepStatus,
} from './executionEngine';
import type { AiSafetyGate } from '../aiCore/safetyGate';

/* ══════════════════════════════════════════════════════════════════════════
 * Eylem kimlikleri (kararlı, nokta/prefix-ayrık)
 * ════════════════════════════════════════════════════════════════════════ */

/** `open.<screenId>` — belirli bir kanonik ekranı aç. */
export const NAV_OPEN_PREFIX = 'open.';
/** Ana ekrana dön (açık çekmeceyi kapat). */
export const NAV_HOME_ID = 'open.home';
/** Geri: mevcut çekmeceyi kapat (nav yığını yok → temel ekrana döner). */
export const NAV_BACK_ID = 'go.back';

/** Bir ekran kimliğinden nav action kimliği türetir (saf). */
export function navActionIdForScreen(screenId: string): string {
  return NAV_OPEN_PREFIX + screenId;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Navigator port'u (MEVCUT screenRegistry/drawerBus DI ile bağlanır — saf/testable)
 * ════════════════════════════════════════════════════════════════════════ */

export interface NavPort {
  /** Kanonik ekranı KİMLİĞİYLE aç (screenRegistry.getScreenById → entry.open). Bulunamazsa false. */
  readonly openScreenById: (screenId: string) => boolean;
  /** Ana ekrana dön / açık çekmeceyi kapat (drawerBus.openDrawer('none')). */
  readonly closeToHome: () => void;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Eylem tanımları (SAF metadata — screenIds kaynaktan verilir)
 * ════════════════════════════════════════════════════════════════════════ */

/** `open.<screen>` timeout tavanı (UI geçişi hızlıdır; motor bunu aşarsa keser). */
export const NAV_OPEN_TIMEOUT_MS = 2_000;

/**
 * Verilen kanonik ekran kimliklerinden nav eylem tanımlarını üretir:
 *   - her ekran için `open.<id>` (düşük risk · reversible · ack),
 *   - `open.home` ve `go.back` (tek-yön · reversible=false).
 * Hiçbiri araç kapsamı taşımaz (UI eylemi) → AiSafetyGate araç kararına dokunmaz.
 */
export function buildNavActionDefinitions(screenIds: readonly string[]): ActionDefinition[] {
  const defs: ActionDefinition[] = [];
  const seen = new Set<string>();
  for (const id of screenIds) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    defs.push({
      id: navActionIdForScreen(id),
      title: `Ekran aç: ${id}`,
      risk: 'low', reversible: true,
      timeoutMs: NAV_OPEN_TIMEOUT_MS, resultContract: 'ack',
      validate: validateEmpty,
    });
  }
  defs.push({
    id: NAV_HOME_ID, title: 'Ana ekrana dön', risk: 'low', reversible: false,
    timeoutMs: NAV_OPEN_TIMEOUT_MS, resultContract: 'ack', validate: validateEmpty,
  });
  defs.push({
    id: NAV_BACK_ID, title: 'Geri', risk: 'low', reversible: false,
    timeoutMs: NAV_OPEN_TIMEOUT_MS, resultContract: 'ack', validate: validateEmpty,
  });
  return defs;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Handler'lar (MEVCUT navigator'a bağlar — yeni navigation davranışı YOK)
 * ════════════════════════════════════════════════════════════════════════ */

function ok(rollback?: () => void): ActionExecResult {
  return rollback ? { ok: true, rollback } : { ok: true };
}
function fail(error: string): ActionExecResult {
  return { ok: false, error };
}

/**
 * Nav actionId → gerçek handler. `open.<screen>` MEVCUT ekranı açar (bulunamazsa ok:false —
 * mevcut ekran bozulmaz); reversible olduğundan geri-alma = ana ekrana dön. `open.home`/`go.back`
 * tek çağrıda ana ekrana döner. Tüm handler'lar fail-soft (throw → ok:false).
 */
export function createNavHandlers(port: NavPort, screenIds: readonly string[]): Record<string, ActionHandler> {
  const handlers: Record<string, ActionHandler> = {};
  const seen = new Set<string>();
  for (const id of screenIds) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    handlers[navActionIdForScreen(id)] = (): ActionExecResult => {
      let found = false;
      try { found = port.openScreenById(id); }
      catch (e) { return fail(`ekran: ${e instanceof Error ? e.message : String(e)}`); }
      if (!found) return fail(`ekran bulunamadı: ${id}`);
      // reversible: açılan çekmece kapatılarak geri alınır (ana ekran).
      return ok(() => { try { port.closeToHome(); } catch { /* rollback fail-soft */ } });
    };
  }
  const home: ActionHandler = (): ActionExecResult => {
    try { port.closeToHome(); } catch (e) { return fail(`ana ekran: ${e instanceof Error ? e.message : String(e)}`); }
    return ok(); // tek-yön → rollback yok
  };
  handlers[NAV_HOME_ID] = home;
  handlers[NAV_BACK_ID] = home;
  return handlers;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tanı (her dispatch üretir — PASS/FAIL YOK, olgusal kategori)
 * ════════════════════════════════════════════════════════════════════════ */

export interface NavActionDiagnostic {
  readonly correlationId: string;
  readonly actionId: string;
  /** İsteği yapan yüzey — ownership (karar değil, tanı). */
  readonly ownership: string;
  readonly durationMs: number;
  /** Motorun terminal adım/plan durumu (olgusal — yorum değil). */
  readonly status: StepStatus | 'rejected' | 'empty';
  /** İptal/red gerekçesi (varsa) — timeout / stale_generation / null. */
  readonly cancelReason: string | null;
  /** Olgusal hata kategorisi (PASS/FAIL değil). */
  readonly errorCategory: string;
}

/** StepStatus/PlanStatus → olgusal errorCategory (yorumsuz). */
export function navErrorCategory(status: NavActionDiagnostic['status']): string {
  switch (status) {
    case 'ok': return 'none';
    case 'rolled_back': return 'none';
    case 'timeout': return 'timeout';
    case 'denied': return 'safety_denied';
    case 'needs_confirmation': return 'needs_confirmation';
    case 'invalid': return 'invalid_payload';
    case 'unknown_action': return 'unknown_action';
    case 'no_handler': return 'no_handler';
    case 'duplicate': return 'duplicate';
    case 'rejected': return 'stale_or_empty';
    case 'empty': return 'empty_plan';
    case 'failed': return 'handler_error';
    default: return 'other';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Façade — MEVCUT registry+engine'i tek dispatch yolu olarak sarar
 * ════════════════════════════════════════════════════════════════════════ */

export interface AppNavigationActionsDeps {
  readonly gate: AiSafetyGate;
  readonly port: NavPort;
  /** Kanonik ekran kimlikleri (screenRegistry.screenIds()). */
  readonly screenIds: readonly string[];
  readonly now?: () => number;
  /** Stale-generation reddi için mevcut kuşak (barge-in/cancel). Yoksa stale kontrolü yapılmaz. */
  readonly currentGeneration?: () => number;
  /** Dedupe penceresi (ms) — çift-tetik koruması. Varsayılan motor değeri (1500). */
  readonly dedupeWindowMs?: number;
}

export interface NavDispatchOptions {
  /** Plan kuşağı (stale reddi). currentGeneration ile uyuşmazsa → 'rejected'. */
  readonly generation?: number;
  /** Kullanıcı orta/yüksek riski önceden onayladı mı (nav düşük risk → etkisiz). */
  readonly confirmed?: boolean;
}

export interface NavDispatchOutcome {
  readonly result: PlanResult;
  readonly diagnostic: NavActionDiagnostic;
}

export interface AppNavigationActions {
  /** Kayıtlı nav eylem kimlikleri (deterministik, sıralı). */
  ids(): readonly string[];
  has(actionId: string): boolean;
  /** Tek nav eylemini yürüt — TOUCH ve VOICE ortak yolu. */
  dispatch(actionId: string, source: string, opts?: NavDispatchOptions): Promise<NavDispatchOutcome>;
  /** Kısa yol: belirli ekranı aç. */
  open(screenId: string, source: string, opts?: NavDispatchOptions): Promise<NavDispatchOutcome>;
  /** Kısa yol: ana ekrana dön. */
  home(source: string, opts?: NavDispatchOptions): Promise<NavDispatchOutcome>;
  /** Kısa yol: geri. */
  back(source: string, opts?: NavDispatchOptions): Promise<NavDispatchOutcome>;
  /** @internal test/tanı — altta yatan registry (aynı örnek touch+voice). */
  readonly registry: MaviActionRegistry;
}

/**
 * Nav eylem katmanını kurar: MEVCUT `MaviActionRegistry`'ye nav tanımlarını kaydeder, MEVCUT
 * `MaviExecutionEngine`'i handler'larla bağlar ve tek dispatch yüzeyi döndürür. Import yan etkisiz;
 * çağrı-başına yeni ölçüm/timer/abonelik YOK. Aynı örnek hem touch hem voice tarafından kullanılır.
 */
export function createAppNavigationActions(deps: AppNavigationActionsDeps): AppNavigationActions {
  const now = typeof deps.now === 'function' ? deps.now : defaultNow;
  const registry: MaviActionRegistry = createActionRegistry();
  for (const def of buildNavActionDefinitions(deps.screenIds)) registry.register(def); // çift id → Error (kurulum-zamanı)
  const handlers = createNavHandlers(deps.port, deps.screenIds);
  const engine = createExecutionEngine({
    registry, gate: deps.gate, handlers,
    now: deps.now,
    dedupeWindowMs: deps.dedupeWindowMs,
    currentGeneration: deps.currentGeneration,
  });

  let _seq = 0;
  const correlationId = (source: string, actionId: string): string => {
    _seq = (_seq + 1) % Number.MAX_SAFE_INTEGER;
    return `nav.${sanitizeSource(source)}.${actionId}#${_seq}`;
  };

  const run = async (
    actionId: string, source: string, opts?: NavDispatchOptions,
  ): Promise<NavDispatchOutcome> => {
    const cid = correlationId(source, actionId);
    const startedAt = safeNow(now);
    const plan: MaviPlan = {
      mode: 'sequential',
      steps: [{ actionId, confirmed: opts?.confirmed }],
      ...(typeof opts?.generation === 'number' ? { generation: opts.generation } : {}),
    };
    let result: PlanResult;
    try { result = await engine.executePlan(plan); }
    catch { result = Object.freeze({ status: 'failed', steps: [], rolledBack: false, reason: 'engine_error' }); }
    const durationMs = Math.max(0, safeNow(now) - startedAt);

    const step = result.steps[0];
    const status: NavActionDiagnostic['status'] = step
      ? step.status
      : (result.status === 'rejected'
        ? (result.reason === 'empty_plan' ? 'empty' : 'rejected')
        : 'rejected');
    const cancelReason = status === 'timeout'
      ? 'timeout'
      : (result.status === 'rejected' && result.reason === 'stale_generation' ? 'stale_generation' : null);

    return Object.freeze({
      result,
      diagnostic: Object.freeze({
        correlationId: cid,
        actionId,
        ownership: sanitizeSource(source),
        durationMs,
        status,
        cancelReason,
        errorCategory: navErrorCategory(status),
      }),
    });
  };

  return {
    ids: () => registry.ids(),
    has: (actionId: string) => registry.has(actionId),
    dispatch: run,
    open: (screenId: string, source: string, opts?: NavDispatchOptions) => run(navActionIdForScreen(screenId), source, opts),
    home: (source: string, opts?: NavDispatchOptions) => run(NAV_HOME_ID, source, opts),
    back: (source: string, opts?: NavDispatchOptions) => run(NAV_BACK_ID, source, opts),
    registry,
  };
}

/* ── Saf yardımcılar ──────────────────────────────────────────── */

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}

function safeNow(now: () => number): number {
  try { const t = now(); return typeof t === 'number' && Number.isFinite(t) ? t : 0; }
  catch { return 0; }
}

/** Kaynak etiketini sınırla (tanı alanı — serbest metin/PII taşımasın). */
function sanitizeSource(source: string): string {
  if (typeof source !== 'string' || source.length === 0) return 'unknown';
  return source.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 24) || 'unknown';
}
