/** ARCH-01/F5 — sole runtime recovery policy authority. It owns no boot, health, or domain truth. */
import type { RuntimeServiceDescriptor } from './lifecycleContract';
import { DEFAULT_RECOVERY_POLICY, decideRecovery, emptyRecoveryLedger, type RecoveryDecision, type RecoveryLedger, type RecoveryRequest } from './runtimeRecoveryPolicy';
import { OwnerCommandEvidence, type CommandMessage } from '../message';
/* ARCH-05 — YALNIZ elle tetiklenen yönetimsel kurtarma için yetki kapısı.
   Otomatik (süreç-içi) kurtarma yolu DEĞİŞMEDİ: sahiplik ve politika
   `decideRecovery`de kalır, bu kapı onun ÖNÜNE değil YANINA eklenir. */
import { authorizeOperation } from '../security/enforcement';
/* N-6 — kurtarma defteri süreç sınırını aşmalıdır. Yeni depo/tablo AÇILMAZ:
   CarOS'un mevcut cihaz-yerel depolama soyutlaması kullanılır. */
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';

/** Kalıcı kurtarma defteri anahtarı (cihaz-yerel, şema sürümlü). */
const RECOVERY_LEDGER_KEY = 'caros_runtime_recovery_v1';

/**
 * Kalıcı kayıtta TUTULAN alanlar.
 *
 * `inFlightKey` KASITLI olarak dışarıda bırakılır: süreç-yereldir ve yeniden
 * başlatma ortasında ölen bir süreçten miras alınırsa kurtarmayı kalıcı
 * olarak kilitlerdi. Tanı sayaçları (`dedupCount`, `staleRejectCount`) da
 * kalıcı değildir — karar vermezler.
 */
interface PersistedLedger {
  readonly a:  number;          // attempts
  readonly w:  number | null;   // windowStartedAt
  readonly la: number | null;   // lastAttemptAt
  readonly ls: number | null;   // lastSuccessAt
  readonly c:  RecoveryLedger['circuitState'];
}

const _CIRCUIT_STATES: ReadonlySet<string> = new Set(['CLOSED', 'OPEN', 'HALF_OPEN']);

/** Sonlu sayı ya da `null`; başka her şey (NaN, Infinity, string) `null`. */
function _finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface RecoveryExecution { readonly executeRestart: (serviceId: string, request: RecoveryRequest) => Promise<boolean>; readonly currentEpoch: (serviceId: string) => number | null; readonly dependencyBlocker?: (serviceId: string) => string | null; readonly onStaleCompletion?: () => void; }
export interface RecoveryEvidence { readonly request: RecoveryRequest; readonly decision: RecoveryDecision; readonly executionStarted: boolean; readonly executionOutcome: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED'; readonly finishedAt: number | null; }
export interface RuntimeRecoverySnapshot { readonly evidence: readonly RecoveryEvidence[]; readonly ledgers: Readonly<Record<string, RecoveryLedger>>; }

class RuntimeRecoverySupervisor {
  private _descriptors = new Map<string, RuntimeServiceDescriptor>();
  private _ledgers = new Map<string, RecoveryLedger>();
  private _evidence: RecoveryEvidence[] = [];
  private _execution: RecoveryExecution | null = null;
  private _shutdownActive = false;
  /** Observability only; policy and the existing execution adapter remain unchanged. */
  private readonly _commandEvidence = new OwnerCommandEvidence('RuntimeRecoverySupervisor');
  /** Kalıcı defter bu süreçte bir kez okunur. */
  private _loaded = false;
  setShutdownActive(active: boolean): void { this._shutdownActive = active; }

  /* ══════════════════════════════════════════════════════════════════════
     N-6 · KALICILIK — UYGULAMA RESTART != ARIZA GEÇMİŞİ SIFIRLAMA
     ══════════════════════════════════════════════════════════════════════
     `_ledgers` yalnız bellekteydi; süreç/uygulama yeniden başladığında
     singleton sıfırdan kuruluyor ve sürekli çöken bir kaynak yeniden tam
     bütçeyle deneniyordu. Burada POLİTİKA DEĞİŞMEZ — yalnız aynı defter
     süreç sınırını aşar. */

  /** Kalıcı defteri bir kez yükler. Bozuk kayıt sessizce YOK SAYILIR. */
  private _ensureLoaded(): void {
    if (this._loaded) return;
    this._loaded = true;                       // tekrar denemeyiz: okuma hatası storm üretmemeli
    let raw: string | null = null;
    try { raw = safeGetRaw(RECOVERY_LEDGER_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { v?: unknown; s?: unknown };
      if (parsed?.v !== 1 || typeof parsed.s !== 'object' || parsed.s === null) return;
      for (const [serviceId, value] of Object.entries(parsed.s as Record<string, unknown>)) {
        const p = value as Partial<PersistedLedger> | null;
        if (!p || typeof p !== 'object') continue;
        const attempts = _finiteOrNull(p.a);
        /* Şüpheli girdi ATILIR — kaydı "uydurmak" yerine o servis için boş
           deftere düşeriz. Bellek içi sınırlı politika yine geçerlidir,
           dolayısıyla bu fail-open bir storm değildir. */
        if (attempts === null || attempts < 0 || !Number.isInteger(attempts)) continue;
        const circuit = typeof p.c === 'string' && _CIRCUIT_STATES.has(p.c)
          ? p.c as RecoveryLedger['circuitState'] : 'CLOSED';
        this._ledgers.set(serviceId, Object.freeze({
          ...emptyRecoveryLedger(),
          attempts,
          windowStartedAt: _finiteOrNull(p.w),
          lastAttemptAt:   _finiteOrNull(p.la),
          lastSuccessAt:   _finiteOrNull(p.ls),
          circuitState:    circuit,
        }));
      }
    } catch { /* bozuk JSON → boş defter; sınır bellek içinde korunur */ }
  }

  /**
   * Defteri diske yazar. `immediate` KULLANILIR: bu kayıt tam da sürecin
   * ölebildiği durumlar için tutulur, debounce edilirse kaybolurdu.
   * Yalnız KARAR VEREN alanlar değiştiğinde çağrılır (tanı sayaçları için
   * yazma yapılmaz — gereksiz eMMC aşınması).
   */
  private _persist(): void {
    try {
      const s: Record<string, PersistedLedger> = {};
      for (const [serviceId, l] of this._ledgers) {
        s[serviceId] = { a: l.attempts, w: l.windowStartedAt, la: l.lastAttemptAt, ls: l.lastSuccessAt, c: l.circuitState };
      }
      safeSetRaw(RECOVERY_LEDGER_KEY, JSON.stringify({ v: 1, s }), 0, true);
    } catch { /* depo yoksa: bellek içi sınır yine geçerli */ }
  }

  /** Karar veren alanları değiştirir ve kalıcılaştırır. */
  private _commitLedger(serviceId: string, ledger: RecoveryLedger): void {
    this._ledgers.set(serviceId, ledger);
    this._persist();
  }

  /**
   * SAAT TUTARLILIĞI (N-6/§11). Kalıcı damgalar duvar saatindendir; cihaz
   * saati geri alınırsa kayıt "gelecekte" kalır ve pencere HİÇ dolmaz —
   * kurtarma kalıcı olarak kilitlenirdi. Gelecekteki damgalar şimdiye
   * çekilir: arıza geçmişi (`attempts`, `circuitState`) KORUNUR — yani
   * saat oynatarak cooldown atlanamaz — ama bekleme bir pencereyle sınırlanır.
   */
  private _clockSane(ledger: RecoveryLedger, now: number): RecoveryLedger {
    const w  = ledger.windowStartedAt;
    const la = ledger.lastAttemptAt;
    if ((w === null || w <= now) && (la === null || la <= now)) return ledger;
    return Object.freeze({
      ...ledger,
      windowStartedAt: w  === null ? null : Math.min(w, now),
      lastAttemptAt:   la === null ? null : Math.min(la, now),
    });
  }
  configure(descriptors: readonly RuntimeServiceDescriptor[], execution: RecoveryExecution): void { this._descriptors = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor])); this._execution = execution; }
  request(request: RecoveryRequest): RecoveryDecision {
    this._commandEvidence.record({ id: `${request.requestId}:request`, kind: 'REQUEST', name: 'runtime.recovery.request', source: request.source.toLowerCase(), target: 'runtime_recovery_supervisor', operationId: request.requestId, correlationId: request.requestId, sessionId: null, generation: null, epoch: request.lifecycleEpoch, reason: null, nowMs: request.requestedAt });
    /* ── ARCH-05 · RUNTIME_ADMIN KAPISI ──────────────────────────────────
       Yalnız ELLE tetiklenen istek yetki sorar. Otomatik kaynaklar (sağlık
       izleyici · kaynak yönetimi · boot · domain) süreç-içidir ve bu kapıya
       HİÇ girmez — güvenlik kapısı iç kurtarmayı bozmamalıdır (§9). Normal
       UI · Mavi · telefon `RUNTIME_ADMIN` yetkisine SAHİP DEĞİLDİR, dolayısıyla
       elle yeniden başlatma onlardan gelemez. */
    if (request.source === 'MANUAL_INTERNAL') {
      const principalClass = request.principal ?? 'UNKNOWN';
      const authz = authorizeOperation({
        principalClass, capability: 'RUNTIME_ADMIN', operationId: request.requestId,
        targetRef: `runtime:${request.serviceId}`,
      });
      if (!authz.allowed) {
        const denied = Object.freeze({ kind: 'DENIED' as const, reason: `SECURITY_DENIED: ${authz.evidence.decision}`, recoveryKey: `${request.serviceId}:${request.lifecycleEpoch ?? 'UNKNOWN'}:security`, attempt: 0, remaining: 0, backoffUntil: null, circuitState: 'CLOSED' as const, dependencyBlocker: null });
        this._commandEvidence.record({ id: `${request.requestId}:decision`, kind: 'RESULT', name: 'runtime.recovery.decision', source: 'runtime_recovery_supervisor', target: null, operationId: request.requestId, correlationId: request.requestId, sessionId: null, generation: null, epoch: request.lifecycleEpoch, reason: 'DENIED', nowMs: request.requestedAt });
        this._record(request, denied, false, 'NOT_RUN', null);
        return denied;
      }
    }
    this._ensureLoaded(); const descriptor = this._descriptors.get(request.serviceId) ?? null; const stored = this._ledgers.get(request.serviceId) ?? emptyRecoveryLedger(); const existing = this._clockSane(stored, request.requestedAt); /* Düzeltme YAPIŞKAN olmalı: her istekte yeniden `now`a çekilirse pencere HİÇ dolmaz ve kurtarma kalıcı kilitlenir. */ if (existing !== stored) this._commitLedger(request.serviceId, existing); const ledger = existing.windowStartedAt !== null && request.requestedAt - existing.windowStartedAt >= DEFAULT_RECOVERY_POLICY.windowMs && existing.circuitState !== 'OPEN' ? Object.freeze({ ...existing, attempts: 0, windowStartedAt: null, circuitState: 'CLOSED' }) : existing;
    const decision = this._shutdownActive ? Object.freeze({ kind: 'DENIED' as const, reason: 'SHUTDOWN_ACTIVE: recovery execution suppressed.', recoveryKey: `${request.serviceId}:${request.lifecycleEpoch ?? 'UNKNOWN'}:shutdown`, attempt: ledger.attempts, remaining: Math.max(0, DEFAULT_RECOVERY_POLICY.maxAttempts - ledger.attempts), backoffUntil: null, circuitState: ledger.circuitState, dependencyBlocker: null }) : decideRecovery({ request, descriptor, currentEpoch: this._execution?.currentEpoch(request.serviceId) ?? null, dependencyBlocker: this._execution?.dependencyBlocker?.(request.serviceId) ?? null, ledger, now: request.requestedAt, policy: DEFAULT_RECOVERY_POLICY });
    this._commandEvidence.record({ id: `${request.requestId}:decision`, kind: 'RESULT', name: 'runtime.recovery.decision', source: 'runtime_recovery_supervisor', target: null, operationId: request.requestId, correlationId: request.requestId, sessionId: null, generation: null, epoch: request.lifecycleEpoch, reason: decision.kind === 'RESTART_SERVICE' ? null : decision.kind, nowMs: request.requestedAt });
    if (decision.kind !== 'RESTART_SERVICE') { this._record(request, decision, false, 'NOT_RUN', null); if (decision.kind === 'STALE_REQUEST') this._ledgers.set(request.serviceId, Object.freeze({ ...ledger, staleRejectCount: ledger.staleRejectCount + 1 })); else if (ledger.inFlightKey === decision.recoveryKey) this._ledgers.set(request.serviceId, Object.freeze({ ...ledger, dedupCount: ledger.dedupCount + 1 })); return decision; }
    const key = decision.recoveryKey; const next: RecoveryLedger = Object.freeze({ ...ledger, attempts: (decision.circuitState === 'HALF_OPEN' ? 0 : ledger.attempts) + 1, windowStartedAt: decision.circuitState === 'HALF_OPEN' ? request.requestedAt : ledger.windowStartedAt ?? request.requestedAt, lastAttemptAt: request.requestedAt, circuitState: decision.circuitState === 'HALF_OPEN' ? 'HALF_OPEN' : ledger.circuitState, inFlightKey: key }); this._commitLedger(request.serviceId, next); this._record(request, decision, true, 'NOT_RUN', null);
    void this._execute(request, decision, next); return decision;
  }
  private async _execute(request: RecoveryRequest, decision: RecoveryDecision, ledger: RecoveryLedger): Promise<void> {
    const stillCurrent = this._execution?.currentEpoch(request.serviceId) === request.lifecycleEpoch;
    let success = false; if (stillCurrent && this._execution) { try { success = await this._execution.executeRestart(request.serviceId, request); } catch { success = false; } }
    const completionCurrent = this._execution?.currentEpoch(request.serviceId) === request.lifecycleEpoch;
    if (success && !completionCurrent) this._execution?.onStaleCompletion?.();
    success = success && completionCurrent;
    const current = this._ledgers.get(request.serviceId) ?? ledger;
    /* ── N-6/G1 · "YENİDEN BAŞLATMA YÜRÜDÜ" != "SERVİS SAĞLIKLI" ──────────
       ÖNCEKİ DAVRANIŞ: başarı halinde `attempts: 0, windowStartedAt: null`
       yazılıyordu. Ama buradaki `success`, `executeRestart`in dönüşüdür ve
       yürütme adaptöründe "boot hâlâ ayakta mı" sorusuna indirgenir —
       yani YALNIZCA "yeniden başlatma çalıştı ve boot hâlâ ayakta". Hemen
       tekrar çöken bir servis her turda bütçeyi sıfırlatıyordu, dolayısıyla
       `maxAttempts`a HİÇ ulaşılamıyordu: sınır fiilen ETKİSİZDİ (ölçüldü —
       12 ardışık çökmenin 12'si de RESTART_SERVICE aldı).

       Bütçeyi sıfırlayan kanonik kanıt artık ZAMAN PENCERESİDİR: arızasız
       geçen tam bir `windowMs`. Bu kural zaten `decideRecovery` ve aşağıdaki
       pencere devri içinde vardır; burada YENİ bir politika kurulmaz, yalnız
       kanıtsız sıfırlama KALDIRILIR. Başarı hâlâ kaydedilir (`lastSuccessAt`)
       ve devre kapatılır. */
    const finalized: RecoveryLedger = success ? Object.freeze({ ...current, lastSuccessAt: request.requestedAt, circuitState: 'CLOSED', inFlightKey: null }) : Object.freeze({ ...current, circuitState: current.attempts >= DEFAULT_RECOVERY_POLICY.maxAttempts ? 'OPEN' : current.circuitState, inFlightKey: null });
    this._commitLedger(request.serviceId, finalized); this._record(request, decision, true, success ? 'SUCCEEDED' : 'FAILED', request.requestedAt);
    this._commandEvidence.record({ id: `${request.requestId}:execution`, kind: 'RESULT', name: 'runtime.recovery.execution', source: 'system_boot', target: null, operationId: request.requestId, correlationId: request.requestId, sessionId: null, generation: null, epoch: request.lifecycleEpoch, reason: success ? null : (completionCurrent ? 'EXECUTION_FAILED' : 'STALE_EPOCH'), nowMs: request.requestedAt });
  }
  private _record(request: RecoveryRequest, decision: RecoveryDecision, executionStarted: boolean, executionOutcome: RecoveryEvidence['executionOutcome'], finishedAt: number | null): void { this._evidence = [...this._evidence.slice(-63), Object.freeze({ request, decision, executionStarted, executionOutcome, finishedAt })]; }
  snapshot(): RuntimeRecoverySnapshot { this._ensureLoaded(); return Object.freeze({ evidence: Object.freeze([...this._evidence]), ledgers: Object.freeze(Object.fromEntries([...this._ledgers.entries()].sort(([a], [b]) => a.localeCompare(b)))) }); }
  getCommandFlowEvidence(): readonly CommandMessage[] { return this._commandEvidence.recent(); }
  resetForTest(): void { this._ledgers.clear(); this._evidence = []; this._execution = null; this._descriptors.clear(); this._shutdownActive = false; this._loaded = false; try { safeRemoveRaw(RECOVERY_LEDGER_KEY); } catch { /* depo yok */ } }
}
export const runtimeRecoverySupervisor = new RuntimeRecoverySupervisor();
