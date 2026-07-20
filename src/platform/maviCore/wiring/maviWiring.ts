/**
 * maviCore/wiring/maviWiring.ts — MAVİ ÇEKİRDEĞİ Faz-2 · SAF composition (test edilebilir).
 *
 * AMAÇ: Orchestrator + feedback + köprüyü tek yerde birleştiren SAF composition root. Gerçek
 * servisler DI ile verilir (PilotHandlerDeps + registerCommandHandler + ttsCancel) → bu modül
 * hiçbir gerçek servisi import ETMEZ (yan-etkisiz, tam test edilebilir). Gerçek servis bağlama
 * `system/platformCoreMaviVoiceWiring.ts`'te (SystemBoot komşusu).
 *
 * MOD SEÇİMİ (Model A varsayılan): mode='shadow' → SHADOW handler'lar (gerçek servis çağrısı YOK,
 * çifte yürütme yok). mode='takeover' → GERÇEK pilot handler'lar (createPilotHandlers). Takeover
 * için ayrıca useVoiceCommandHandler pilot-atlama guard'ı gerekir (AYRI PR — bu fazda YOK).
 */

import { createMaviOrchestrator } from '../maviOrchestrator';
import type { AiSafetyGate } from '../../aiCore/safetyGate';
import { createFeedbackChannel, MaviFeedbackChannel, type MaviFeedback } from './maviFeedback';
import { createPilotHandlers, createShadowHandlers, type PilotHandlerDeps } from './maviPilotHandlers';
import {
  createMaviVoiceBridge, MaviVoiceBridge,
  type ParsedCommandLike, type PilotMapping, type MaviBridgeMode,
} from './maviVoiceBridge';

export interface MaviWiringDeps {
  /** Gerçek pilot servis portları (takeover modda çağrılır; shadow'da kurulur ama çağrılmaz). */
  readonly pilotDeps: PilotHandlerDeps;
  /** voiceService.registerCommandHandler (DI). */
  readonly registerCommandHandler: (fn: (cmd: ParsedCommandLike) => void) => () => void;
  /** ttsService.ttsCancel (DI) — barge-in. */
  readonly ttsCancel: () => void;
  /** Coexistence modu (varsayılan 'shadow'). */
  readonly mode?: MaviBridgeMode;
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
  /** Kur — idempotent (bridge.start). */
  start(): void;
  /** Sök — idempotent (bridge.dispose + feedback aboneliği). */
  dispose(): void;
}

/**
 * Saf composition: mod'a göre handler seti seç, orchestrator+feedback+bridge kur, handle döner.
 * start/dispose idempotenttir (bridge idempotent + tek feedback aboneliği).
 */
export function createMaviWiring(deps: MaviWiringDeps): MaviWiringHandle {
  const mode: MaviBridgeMode = deps.mode === 'takeover' ? 'takeover' : 'shadow';
  const handlers = mode === 'takeover'
    ? createPilotHandlers(deps.pilotDeps)
    : createShadowHandlers();

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
  });

  let _feedbackUnsub: (() => void) | null = null;
  let _started = false;

  return {
    bridge, feedback, mode,
    start(): void {
      if (_started) return;
      _started = true;
      if (typeof deps.onFeedback === 'function') {
        _feedbackUnsub = feedback.subscribe(deps.onFeedback);
      }
      bridge.start();
    },
    dispose(): void {
      _started = false;
      if (_feedbackUnsub) { try { _feedbackUnsub(); } catch { /* fail-soft */ } _feedbackUnsub = null; }
      bridge.dispose();
    },
  };
}
