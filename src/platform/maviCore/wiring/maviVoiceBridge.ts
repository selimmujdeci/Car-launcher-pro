/**
 * maviCore/wiring/maviVoiceBridge.ts — MAVİ ÇEKİRDEĞİ Faz-2 · voiceService ↔ Orchestrator KÖPRÜSÜ.
 *
 * AMAÇ (task 1/3/4/5): Mevcut komut akışını (voiceService.registerCommandHandler → ParsedCommand)
 * Mavi Orchestrator'a TYPED bağlar. commandParser/intentEngine hattı KALDIRILMAZ — köprü onların
 * çıktısını (ParsedCommand) TÜKETİR (tam coexistence).
 *
 * COEXISTENCE (Model A — SHADOW varsayılan):
 *  - Köprü mevcut komut akışını GÖZLEMLER. Orchestrator akışı (lifecycle/güvenlik-kapısı/telemetry/
 *    context/feedback) GERÇEK trafikte çalışır; pilot handler'lar orchestrator kurulumunda SHADOW
 *    (no-op) verildiğinden GERÇEK eylemi hâlâ eski hat (useVoiceCommandHandler) yapar → ÇİFTE
 *    YÜRÜTME YOK. Feedback event üretilir ama TTS'e bağlı DEĞİL (tüketici ayrı) → çift ses yok.
 *  - TAKEOVER moduna geçiş: orchestrator GERÇEK handler'larla kurulur + useVoiceCommandHandler'a
 *    pilot-atlama guard'ı eklenir (AYRI PR — bu fazda YOK; köprü mode bayrağını taşır).
 *
 * SINIR (voiceService'e DOKUNMA): voiceService/wakeWordService state-subscribe olayı DIŞA AÇMADIĞI
 * için köprü KOMUT-MERKEZLİDİR — her ParsedCommand bir Mavi turu (listen→capture→execute→finish).
 * wake→listening SÜRE telemetrisi bu fazda beslenmez (voiceService'e additive olay kancası ayrı PR).
 *
 * BARGE-IN (task 3): yeni komut gelince veya bargeIn() çağrılınca ttsCancel() + orchestrator.cancel
 * → çalan cevap kesilir, lifecycle sıfırlanır; yeni tur yeni kuşak üretir → eski turun planı stale
 * reddedilir (task 4).
 *
 * SAF/DI: voiceService/ttsService DOĞRUDAN import EDİLMEZ (yan-etkisiz maviCore) — registerCommandHandler
 * + ttsCancel DI ile verilir (SystemBoot wiring gerçeğini bağlar; test mock'lar).
 */

import type { MaviOrchestrator } from '../maviOrchestrator';
import type { MaviPlan } from '../executionEngine';
import { MaviFeedbackChannel } from './maviFeedback';
import { buildActionFeedback, buildPlanFeedback, buildStageFeedback } from './maviFeedback';

/* ══════════════════════════════════════════════════════════════════════════
 * ParsedCommand → pilot eylem eşlemesi (coexistence glue)
 * ════════════════════════════════════════════════════════════════════════ */

/** Köprünün ihtiyaç duyduğu minimal ParsedCommand görünümü (voiceService tipine bağımlı değil). */
export interface ParsedCommandLike {
  readonly type: string;
  readonly raw?: string;
  readonly extra?: Record<string, unknown>;
}

export interface PilotMapping {
  readonly actionId: string;
  readonly payload?: Record<string, unknown>;
}

/**
 * Varsayılan eşleme: NET pilot karşılığı olan komut tiplerini pilot actionId'ye çevirir. Karşılığı
 * OLMAYAN tip → null (köprü karışmaz, eski hat halleder). Pilot sette olup mevcut parser'da net
 * kaynağı olmayanlar (ui.page.open, navigation.cancel, media.volume.set) burada BİLİNÇLİ boştur —
 * programatik/gelecek kaynak için handler'lar hazır ama sesli eşleme yok (dürüstlük: uydurma yok).
 */
export function defaultPilotCommandMap(cmd: ParsedCommandLike): PilotMapping | null {
  switch (cmd.type) {
    case 'theme_night':
    case 'theme_dark':  return { actionId: 'ui.theme.set', payload: { theme: 'night' } };
    case 'theme_day':   return { actionId: 'ui.theme.set', payload: { theme: 'day' } };
    case 'theme_oled':  return { actionId: 'ui.theme.set', payload: { theme: 'oled' } };

    case 'open_music':
    case 'open_radio':  return { actionId: 'media.play' };
    case 'stop_music':  return { actionId: 'media.pause' };
    case 'music_next':  return { actionId: 'media.next' };

    case 'navigate_address':
    case 'navigate_place': {
      const dest = typeof cmd.extra?.destination === 'string'
        ? cmd.extra.destination
        : (typeof cmd.raw === 'string' ? cmd.raw : '');
      return dest ? { actionId: 'navigation.open', payload: { destination: dest } } : null;
    }
    case 'open_maps':   return { actionId: 'navigation.open' };

    case 'vehicle_health_check': return { actionId: 'vehicle.health.read' };

    default: return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Köprü
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviBridgeMode = 'shadow' | 'takeover';

export interface MaviVoiceBridgeDeps {
  readonly orchestrator: MaviOrchestrator;
  readonly feedback: MaviFeedbackChannel;
  /** voiceService.registerCommandHandler (DI). Cleanup döner. */
  readonly registerCommandHandler: (fn: (cmd: ParsedCommandLike) => void) => () => void;
  /** ttsService.ttsCancel (DI) — barge-in'de çalan cevabı keser. */
  readonly ttsCancel: () => void;
  /** ParsedCommand → pilot eşleyici (varsayılan defaultPilotCommandMap). */
  readonly mapCommand?: (cmd: ParsedCommandLike) => PilotMapping | null;
  /** Coexistence modu (varsayılan 'shadow'). Bilgi amaçlı — handler seçimi orchestrator kurulumunda. */
  readonly mode?: MaviBridgeMode;
}

export class MaviVoiceBridge {
  private readonly _orch: MaviOrchestrator;
  private readonly _feedback: MaviFeedbackChannel;
  private readonly _registerCommandHandler: (fn: (cmd: ParsedCommandLike) => void) => () => void;
  private readonly _ttsCancel: () => void;
  private readonly _map: (cmd: ParsedCommandLike) => PilotMapping | null;
  private readonly _mode: MaviBridgeMode;

  private _started = false;
  private _unregister: (() => void) | null = null;
  /** Aktif tur zinciri — barge-in/dispose sıralaması için (yalnız izleme). */
  private _turnInFlight = false;

  constructor(deps: MaviVoiceBridgeDeps) {
    this._orch = deps.orchestrator;
    this._feedback = deps.feedback;
    this._registerCommandHandler = deps.registerCommandHandler;
    this._ttsCancel = deps.ttsCancel;
    this._map = typeof deps.mapCommand === 'function' ? deps.mapCommand : defaultPilotCommandMap;
    this._mode = deps.mode === 'takeover' ? 'takeover' : 'shadow';
  }

  get mode(): MaviBridgeMode { return this._mode; }

  /** Kur — idempotent. voiceService komut akışına abone olur; orchestrator'ı başlatır. */
  start(): void {
    if (this._started) return;
    this._started = true;
    this._orch.start();
    this._unregister = this._registerCommandHandler((cmd) => this._onCommand(cmd));
  }

  /** Sök — idempotent. Abonelik + orchestrator + feedback temizlenir. */
  dispose(): void {
    if (!this._started) { this._feedback.reset(); return; }
    this._started = false;
    if (this._unregister) { try { this._unregister(); } catch { /* fail-soft */ } this._unregister = null; }
    try { this._orch.dispose(); } catch { /* fail-soft */ }
    this._feedback.reset();
    this._turnInFlight = false;
  }

  restart(): void { this.dispose(); this.start(); }

  /**
   * Barge-in / iptal: çalan cevabı kes (ttsCancel) + lifecycle'ı iptal edip idle'a döndür. Yeni
   * turun beginListening'i yeni kuşak üreteceğinden eski turun (varsa uçuştaki) planı stale reddedilir.
   */
  bargeIn(): void {
    try { this._ttsCancel(); } catch { /* fail-soft */ }
    // Aktif bir tur varsa iptal et → cancelled; sonra recover → idle (yeni tur kuşağı için hazır).
    if (this._orch.state !== 'idle') {
      this._orch.cancel();
      this._orch.recover();
    }
  }

  /* ── İç akış ────────────────────────────────────────────────── */

  private _onCommand(cmd: ParsedCommandLike): void {
    if (!cmd || typeof cmd.type !== 'string') return;
    const mapped = this._map(cmd);
    if (!mapped) return; // pilot değil → eski hat halleder (coexistence)
    void this._runTurn(mapped);
  }

  private async _runTurn(mapped: PilotMapping): Promise<void> {
    // Yeni tur: önceki tur hâlâ açıksa (idle değil) barge-in ile temizle → yeni kuşak.
    if (this._orch.state !== 'idle') this.bargeIn();

    this._turnInFlight = true;
    try {
      // Komut-merkezli tur: listening→understanding (wake/dinleme gerçekte voiceService'te oldu).
      this._orch.beginListening();
      const token = this._orch.capture();
      if (!token) { this._turnInFlight = false; return; } // lifecycle reddetti (yarış) → sessiz çık

      // Sessiz bırakmama: planlama başında nötr ara feedback.
      this._feedback.emit(buildStageFeedback('planning'));

      const plan: MaviPlan = {
        mode: 'sequential',
        steps: [{ actionId: mapped.actionId, payload: mapped.payload }],
      };
      const result = await this._orch.execute(plan, token);

      // Sonuç doğrulama → typed feedback (dürüst).
      const step = result.steps[0];
      if (step) {
        const successText = extractSuccessText(mapped.actionId, step.value);
        this._feedback.emit(buildActionFeedback(step, successText ? { successText } : {}));
      } else {
        this._feedback.emit(buildPlanFeedback(result));
      }

      // Turu kapat (executing → idle + telemetry oturumu).
      this._orch.finish();
    } catch {
      // Fail-soft: köprü hiçbir koşulda uygulamayı çökertmez; turu güvenli kapat.
      try { if (this._orch.state !== 'idle') { this._orch.fail(); this._orch.recover(); } } catch { /* noop */ }
    } finally {
      this._turnInFlight = false;
    }
  }
}

/** Araç sağlığı gibi değer taşıyan eylemlerde başarı metnini çıkar (yoksa generic "Tamam"). */
function extractSuccessText(actionId: string, value: unknown): string | undefined {
  if (actionId === 'vehicle.health.read' && value && typeof value === 'object') {
    const summary = (value as { summary?: unknown }).summary;
    if (typeof summary === 'string' && summary.trim().length > 0) return summary.trim();
  }
  return undefined;
}

export function createMaviVoiceBridge(deps: MaviVoiceBridgeDeps): MaviVoiceBridge {
  return new MaviVoiceBridge(deps);
}
