/**
 * maviCore/wiring/voiceStateBridge.ts — MAVİ ÇEKİRDEĞİ Faz-3 · MAVI3-2 Telemetri köprüsü.
 *
 * AMAÇ: voiceService.subscribeVoiceState typed olaylarını Mavi gecikme telemetrisine bağlar ve
 * beş MONOTONİK segment üretir (kullanıcının hiçbir aşamada sessiz kalmaması + performans bütçesi
 * gözlemi). Faz-2'nin komut-merkezli sınırını (wake→listening kaçıyordu) giderir.
 *
 * SEGMENTLER (monotonik farklar — clock-jump güvenli):
 *   wake→listening · listening→transcript · transcript→plan · plan→execution · execution→speech
 *
 * TASARIM (CLAUDE.md · aiCore deseni):
 *  - SAF/DI: voiceService'i DOĞRUDAN import ETMEZ — subscribeVoiceState fn DI ile verilir (test/
 *    wiring gerçeği bağlar). latencyTracker opsiyonel beslenir.
 *  - EKSİK/SIRA-DIŞI olayda CRASH YOK: beklenmeyen phase → bounded diagnostic; segment undefined kalır.
 *  - STALE GENERATION telemetriyi KİRLETMEZ: eski kuşaktan geç gelen olay YOK SAYILIR.
 *  - `planning`/`executing` voiceService'ten GELMEZ (Faz-2 komut-merkezli) → o segmentler doğal
 *    olarak eksik kalır + diagnostic'le işaretlenir (dürüst kapsam; MAVI3-4 takeover'da gelebilir).
 *  - TIMER/polling YOK · UI/TTS simülasyonu YOK · unsubscribe İDEMPOTENT.
 */

import type { MaviLatencyTracker, LatencyMarker } from '../latencyTelemetry';

/* ══════════════════════════════════════════════════════════════════════════
 * Kontratlar
 * ════════════════════════════════════════════════════════════════════════ */

/** voiceService VoiceLifecycleEvent'in minimal görünümü (voiceService tipine bağımlı değil). */
export interface VoiceLifecycleEventLike {
  readonly phase: string;
  readonly generationId: number;
  readonly sessionId: number;
  readonly at: number;
  readonly transcriptLength?: number;
}

export type VoiceSegmentKey =
  | 'wakeToListening'
  | 'listeningToTranscript'
  | 'transcriptToPlan'
  | 'planToExecution'
  | 'executionToSpeech';

export interface VoiceSessionTiming {
  readonly generationId: number;
  readonly sessionId: number;
  readonly segments: Readonly<Partial<Record<VoiceSegmentKey, number>>>;
  /** Eksik/sıra-dışı işaretleri (bounded) — telemetri güvenilirliğini şeffaf gösterir. */
  readonly diagnostics: readonly string[];
  readonly at: number;
}

/* Phase → iç marker anahtarı (voiceService yaşam döngüsü noktaları). */
type MarkerKey = 'wake' | 'listening' | 'transcript' | 'plan' | 'execution' | 'speech';

const PHASE_TO_MARKER: Readonly<Record<string, MarkerKey>> = Object.freeze({
  wake_detected: 'wake',
  listening: 'listening',
  transcribing: 'transcript',
  planning: 'plan',
  executing: 'execution',
  speaking: 'speech',
});

/* Beklenen sıra (sıra-dışı tespiti için). */
const MARKER_ORDER: readonly MarkerKey[] = ['wake', 'listening', 'transcript', 'plan', 'execution', 'speech'];

/* Phase → Mavi latencyTracker marker'ı (opsiyonel besleme). */
const PHASE_TO_LATENCY: Readonly<Record<string, LatencyMarker>> = Object.freeze({
  wake_detected: 'wake',
  listening: 'listening',
  transcribing: 'speechEnd',
  planning: 'planStart',
  executing: 'firstAction',
  speaking: 'complete',
});

const SEGMENT_DEFS: ReadonlyArray<{ key: VoiceSegmentKey; from: MarkerKey; to: MarkerKey }> = [
  { key: 'wakeToListening', from: 'wake', to: 'listening' },
  { key: 'listeningToTranscript', from: 'listening', to: 'transcript' },
  { key: 'transcriptToPlan', from: 'transcript', to: 'plan' },
  { key: 'planToExecution', from: 'plan', to: 'execution' },
  { key: 'executionToSpeech', from: 'execution', to: 'speech' },
];

/* ══════════════════════════════════════════════════════════════════════════
 * Köprü
 * ════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_MAX_VOICE_TIMINGS = 20;
export const MAX_SESSION_DIAGNOSTICS = 8;

export interface VoiceStateBridgeDeps {
  /** voiceService.subscribeVoiceState (DI). Cleanup döner. */
  readonly subscribeVoiceState: (listener: (e: VoiceLifecycleEventLike) => void) => () => void;
  /** Opsiyonel Mavi gecikme izleyicisi (verilirse phase→marker beslenir). */
  readonly latencyTracker?: MaviLatencyTracker;
  readonly maxTimings?: number;
}

export class VoiceStateBridge {
  private readonly _subscribe: (l: (e: VoiceLifecycleEventLike) => void) => () => void;
  private readonly _latency?: MaviLatencyTracker;
  private readonly _maxTimings: number;

  private _started = false;
  private _unsub: (() => void) | null = null;

  private _currentGen = -1;
  private _markers = new Map<MarkerKey, number>();
  private _diagnostics: string[] = [];
  private _lastMarkerIndex = -1;
  private readonly _ring: VoiceSessionTiming[] = [];

  constructor(deps: VoiceStateBridgeDeps) {
    this._subscribe = deps.subscribeVoiceState;
    this._latency = deps.latencyTracker;
    this._maxTimings = typeof deps.maxTimings === 'number' && deps.maxTimings > 0
      ? Math.floor(deps.maxTimings) : DEFAULT_MAX_VOICE_TIMINGS;
  }

  /** Kur — idempotent. voiceService olaylarına abone olur. */
  start(): void {
    if (this._started) return;
    this._started = true;
    this._unsub = this._subscribe((e) => this._onEvent(e));
  }

  /** Sök — idempotent. Aktif oturumu finalize eder, aboneliği kapatır. */
  dispose(): void {
    if (!this._started) return;
    this._started = false;
    if (this._unsub) { try { this._unsub(); } catch { /* fail-soft */ } this._unsub = null; }
    this._finalizeSession();
    this._resetSession();
    this._currentGen = -1;
  }

  restart(): void { this.dispose(); this.start(); }

  /** Mevcut (canlı) oturumun türetilmiş segmentleri. */
  currentSegments(): Readonly<Partial<Record<VoiceSegmentKey, number>>> {
    return this._deriveSegments();
  }

  /** Son tamamlanan oturum zamanlamaları (bounded, en eski→en yeni). */
  recent(): readonly VoiceSessionTiming[] {
    return this._ring.slice();
  }

  /* ── İç akış ──────────────────────────────────────────────── */

  private _onEvent(e: VoiceLifecycleEventLike): void {
    if (!e || typeof e.phase !== 'string' || typeof e.generationId !== 'number') return;

    // Stale generation → telemetriyi KİRLETME (eski kuşaktan geç gelen olay yok sayılır).
    if (this._currentGen >= 0 && e.generationId < this._currentGen) return;

    // Yeni kuşak → önceki oturumu finalize et, sıfırla.
    if (e.generationId > this._currentGen) {
      this._finalizeSession();
      this._resetSession();
      this._currentGen = e.generationId;
    }

    const marker = PHASE_TO_MARKER[e.phase];
    if (marker) {
      const at = typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0;
      if (this._markers.has(marker)) {
        this._pushDiagnostic(`dup:${marker}`); // aynı marker tekrar → ilk değeri koru
      } else {
        // Sıra-dışı: bu marker beklenen sıradan geriye gidiyorsa işaretle (yine de kaydet).
        const idx = MARKER_ORDER.indexOf(marker);
        if (idx <= this._lastMarkerIndex) this._pushDiagnostic(`out_of_order:${marker}`);
        this._lastMarkerIndex = Math.max(this._lastMarkerIndex, idx);
        this._markers.set(marker, at);
      }
    }

    // Mavi latencyTracker besle (opsiyonel) — fail-soft.
    if (this._latency) {
      const lm = PHASE_TO_LATENCY[e.phase];
      try {
        if (e.phase === 'wake_detected' || (this._currentGen === e.generationId && this._markers.size === 1)) {
          this._latency.beginSession(e.sessionId);
        }
        if (lm) this._latency.mark(lm);
      } catch { /* telemetri beslemesi köprüyü bozmaz */ }
    }
  }

  private _deriveSegments(): Partial<Record<VoiceSegmentKey, number>> {
    const out: Partial<Record<VoiceSegmentKey, number>> = {};
    for (const def of SEGMENT_DEFS) {
      const a = this._markers.get(def.from);
      const b = this._markers.get(def.to);
      if (a === undefined || b === undefined) continue;
      const d = b - a;
      if (d >= 0) out[def.key] = d; // negatif (sıra anomalisi) → segment yok
      else this._pushDiagnostic(`neg:${def.key}`);
    }
    return out;
  }

  private _finalizeSession(): void {
    if (this._currentGen < 0 || this._markers.size === 0) return;
    // Eksik zorunlu marker'ları diagnostic'e işle (dürüst kapsam).
    for (const m of ['wake', 'listening', 'transcript'] as MarkerKey[]) {
      if (!this._markers.has(m)) this._pushDiagnostic(`missing:${m}`);
    }
    const anySession = [...this._markers.values()][0] ?? 0;
    const entry: VoiceSessionTiming = Object.freeze({
      generationId: this._currentGen,
      sessionId: this._currentGen,
      segments: Object.freeze(this._deriveSegments()),
      diagnostics: Object.freeze(this._diagnostics.slice()),
      at: anySession,
    });
    this._ring.push(entry);
    if (this._ring.length > this._maxTimings) {
      this._ring.splice(0, this._ring.length - this._maxTimings);
    }
  }

  private _resetSession(): void {
    this._markers = new Map();
    this._diagnostics = [];
    this._lastMarkerIndex = -1;
  }

  private _pushDiagnostic(msg: string): void {
    if (this._diagnostics.length >= MAX_SESSION_DIAGNOSTICS) return; // bounded
    if (!this._diagnostics.includes(msg)) this._diagnostics.push(msg);
  }
}

export function createVoiceStateBridge(deps: VoiceStateBridgeDeps): VoiceStateBridge {
  return new VoiceStateBridge(deps);
}
