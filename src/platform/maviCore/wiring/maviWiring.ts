/**
 * maviCore/wiring/maviWiring.ts — MAVİ ÇEKİRDEĞİ Faz-2 · SAF composition (test edilebilir).
 *
 * AMAÇ: Orchestrator + feedback + köprüyü tek yerde birleştiren SAF composition root. Gerçek
 * servisler DI ile verilir (PilotHandlerDeps + registerCommandHandler + ttsCancel) → bu modül
 * hiçbir gerçek servisi import ETMEZ (yan-etkisiz, tam test edilebilir). Gerçek servis bağlama
 * `system/platformCoreMaviVoiceWiring.ts`'te (SystemBoot komşusu).
 *
 * MOD SEÇİMİ — FAZ-3 · MAVI3-4b: TAKEOVER ARTIK GLOBAL DEĞİL, EYLEM BAZLIDIR.
 * `buildHybridHandlers` her pilot eylem için ayrı ayrı karar verir:
 *   - politika o eylemi gerçekten devralıyorsa (allowlist ∩ eligible) → GERÇEK handler,
 *   - aksi halde → SHADOW (no-op) handler.
 * Yani mode='takeover' iken bile YALNIZ `media.next` gerçek çalışır; `media.play`, `ui.theme.set`,
 * `navigation.*` vb. SHADOW kalır → eski hat onları yapmaya devam eder (çifte yürütme yok).
 * `vehicle.*`/ecu/coding/adaptation/actuator eylemleri takeoverPolicy tarafından eligible
 * kümesinin dışında tutulduğu için HİÇBİR config ile gerçek handler'a bağlanamaz (savunma
 * derinliği); AiSafetyGate ayrıca tek araç güvenlik otoritesi olarak kalır.
 *
 * Takeover'ın eski hattı susturması için ayrıca useVoiceCommandHandler guard'ı gerekir (MAVI3-4c).
 */

import { createMaviOrchestrator } from '../maviOrchestrator';
import type { AiSafetyGate } from '../../aiCore/safetyGate';
import type { ActionHandler } from '../executionEngine';
import { createFeedbackChannel, MaviFeedbackChannel, type MaviFeedback } from './maviFeedback';
import { createPilotHandlers, createShadowHandlers, type PilotHandlerDeps } from './maviPilotHandlers';
import { createTakeoverPolicy, type TakeoverPolicy } from './takeoverPolicy';
import { getTakeoverArbiter, type TakeoverArbiter } from './takeoverArbiter';
import { setMaviOwnershipResolver, clearMaviOwnershipResolver } from './maviOwnership';
import {
  createMaviVoiceBridge, MaviVoiceBridge, defaultPilotCommandMap,
  type ParsedCommandLike, type PilotMapping, type MaviBridgeMode, type VoiceLifecycleEventLike,
} from './maviVoiceBridge';

/** Pilot eylem kimlikleri — hibrit setin anahtar kümesi (SHADOW seti otoritedir). */
const PILOT_ACTION_IDS: readonly string[] = Object.freeze(Object.keys(createShadowHandlers()));

/**
 * Bir eylemin GERÇEK mi SHADOW mu handler'a bağlandığı — SAF karar (referans karşılaştırması YOK).
 * Pilot sette olmayan hiçbir actionId gerçek handler alamaz (fail-closed genişleme): politika
 * `ecu.write` gibi bir kimlik önerse bile burada 'unknown' döner ve sete hiç girmez.
 */
export function handlerKindFor(actionId: string, policy: TakeoverPolicy): 'real' | 'shadow' | 'unknown' {
  if (!PILOT_ACTION_IDS.includes(actionId)) return 'unknown';
  return policy.shouldTakeover(actionId) ? 'real' : 'shadow';
}

/**
 * EYLEM BAZLI hibrit handler seti: allowlist'te GERÇEKTEN devralınan eylemler gerçek handler'a,
 * kalan TÜM pilot eylemler SHADOW'a bağlanır.
 */
export function buildHybridHandlers(
  pilotDeps: PilotHandlerDeps, policy: TakeoverPolicy,
): Record<string, ActionHandler> {
  const shadow = createShadowHandlers();
  const real = createPilotHandlers(pilotDeps);
  const out: Record<string, ActionHandler> = {};
  for (const actionId of PILOT_ACTION_IDS) {
    const useReal = handlerKindFor(actionId, policy) === 'real' && typeof real[actionId] === 'function';
    out[actionId] = useReal ? real[actionId] : shadow[actionId];
  }
  return out;
}

export interface MaviWiringDeps {
  /** Gerçek pilot servis portları (takeover modda çağrılır; shadow'da kurulur ama çağrılmaz). */
  readonly pilotDeps: PilotHandlerDeps;
  /** voiceService.registerCommandHandler (DI). */
  readonly registerCommandHandler: (fn: (cmd: ParsedCommandLike) => void) => () => void;
  /** ttsService.ttsCancel (DI) — barge-in. */
  readonly ttsCancel: () => void;
  /** Coexistence modu (varsayılan 'shadow'). `policy` verilmezse bundan türetilir. */
  readonly mode?: MaviBridgeMode;
  /** TAKEOVER politikası (varsayılan: mode'dan türetilir — allowlist yalnız media.next). */
  readonly policy?: TakeoverPolicy;
  /** TAKEOVER hakemi (varsayılan: modül tekil örneği). start/dispose ile aktive/pasifize edilir. */
  readonly arbiter?: TakeoverArbiter;
  /** voiceService.subscribeVoiceState (MAVI3-1, DI) — kuşak/oturum kimliği için. */
  readonly subscribeVoiceState?: (listener: (e: VoiceLifecycleEventLike) => void) => () => void;
  /** Araç güvenlik kapısı (varsayılan: createAiSafetyGate — yalnız read). */
  readonly gate?: AiSafetyGate;
  readonly now?: () => number;
  readonly mapCommand?: (cmd: ParsedCommandLike) => PilotMapping | null;
  /** Typed feedback gözlemcisi (TTS/UI tüketicisi — takeover'da bağlanır; shadow'da opsiyonel). */
  readonly onFeedback?: (fb: MaviFeedback) => void;
}

export interface MaviWiringHandle {
  readonly bridge: MaviVoiceBridge;
  readonly feedback: MaviFeedbackChannel;
  readonly mode: MaviBridgeMode;
  /** Etkin TAKEOVER politikası (hangi eylemlerin gerçek çalıştığının tek kaynağı). */
  readonly policy: TakeoverPolicy;
  /** Bir eylemin GERÇEK handler'a mı SHADOW'a mı bağlandığı (tanı/test). */
  handlerKindOf(actionId: string): 'real' | 'shadow' | 'unknown';
  /** Kur — idempotent (bridge.start + hakem aktivasyonu). */
  start(): void;
  /** Sök — idempotent (bridge.dispose + feedback aboneliği + hakem pasifleştirme). */
  dispose(): void;
}

/**
 * Saf composition: EYLEM BAZLI hibrit handler seti kur, orchestrator+feedback+bridge bağla.
 * start/dispose idempotenttir (bridge idempotent + tek feedback aboneliği + idempotent hakem).
 */
export function createMaviWiring(deps: MaviWiringDeps): MaviWiringHandle {
  const mode: MaviBridgeMode = deps.mode === 'takeover' ? 'takeover' : 'shadow';
  const policy = deps.policy ?? createTakeoverPolicy({ mode });
  const arbiter = deps.arbiter ?? getTakeoverArbiter();

  // GLOBAL DEĞİL — eylem bazlı: yalnız politikanın gerçekten devraldığı eylem gerçek handler alır.
  const handlers = buildHybridHandlers(deps.pilotDeps, policy);

  const feedback = createFeedbackChannel({ now: deps.now });
  const orchestrator = createMaviOrchestrator({
    handlers,
    gate: deps.gate,
    now: deps.now,
  });
  const bridge = createMaviVoiceBridge({
    orchestrator, feedback,
    registerCommandHandler: deps.registerCommandHandler,
    ttsCancel: deps.ttsCancel,
    mapCommand: deps.mapCommand,
    mode,
    arbiter,
    subscribeVoiceState: deps.subscribeVoiceState,
    // KRİTİK: bu eylem GERÇEK handler'a bağlıysa, köprü sahiplik ALAMADIĞI turda planı hiç
    // çalıştırmamalıdır — aksi halde claim reddedilse (duplicate/stale/hakem hatası) bile
    // orchestrator gerçek servisi çağırırdı (çifte yürütme).
    isRealHandler: (actionId) => handlerKindFor(actionId, policy) === 'real',
  });

  let _feedbackUnsub: (() => void) | null = null;
  let _started = false;

  return {
    bridge, feedback, mode, policy,
    handlerKindOf(actionId: string): 'real' | 'shadow' | 'unknown' {
      return handlerKindFor(actionId, policy);
    },
    start(): void {
      if (_started) return;
      _started = true;
      if (typeof deps.onFeedback === 'function') {
        _feedbackUnsub = feedback.subscribe(deps.onFeedback);
      }
      // Hakemi politikayla etkinleştir. SHADOW politikada hakem PASİF kalır (active=false) →
      // eski hat hiçbir şekilde susturulmaz; mevcut davranış birebir korunur.
      try { arbiter.activate(policy); } catch { /* fail-soft */ }
      bridge.start();
      // Eski hattın sahiplik sorgusunu bağla — KÖPRÜNÜN eşleyicisi + KÖPRÜNÜN kimliği kullanılır
      // (tek key-builder → iki tarafta anahtar sapması imkânsız).
      setMaviOwnershipResolver({
        mapCommand: typeof deps.mapCommand === 'function' ? deps.mapCommand : defaultPilotCommandMap,
        identity: () => bridge.identity,
        arbiter,
      });
    },
    dispose(): void {
      _started = false;
      if (_feedbackUnsub) { try { _feedbackUnsub(); } catch { /* fail-soft */ } _feedbackUnsub = null; }
      // Sahiplik sorgusu ÖNCE sökülür → dispose anından itibaren eski hat davranışı geri gelir.
      clearMaviOwnershipResolver();
      bridge.dispose();
      // Güvenlik ağı: sahiplik terminal yollarda zaten bırakılmıştır; bu yalnız hakemi pasifleştirir.
      try { arbiter.deactivate(); } catch { /* fail-soft */ }
    },
  };
}
