/**
 * companionTelemetry.ts — Companion telemetri sayaçları (P1-PREP).
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  · YEREL ve YALNIZ SAYISALDIR. Uzak sunucuya gönderim YOKTUR (bu dosyada ağ
 *    çağrısı bulunmaz). Kullanıcı verisi, cihaz kimliği, mesaj içeriği ve
 *    payload TAŞIMAZ — yalnız adet ve süre.
 *  · Timer YOK: zaman DAİMA çağırandan gelir.
 *  · Bounded: gecikme örnekleri sabit tavanla tutulur (bellek sızıntısı yok).
 *  · ASLA throw etmez.
 */

import { MAX_TELEMETRY_SAMPLES } from './companionDomain';

/* ══════════════════════════════════════════════════════════════════════════
 * Model
 * ════════════════════════════════════════════════════════════════════════ */

export interface CompanionTelemetrySnapshot {
  readonly connectionAttempts: number;
  /** Başarılı bağlantı süreleri (ms) özeti. Hiç bağlanılmadıysa null (0 DEĞİL). */
  readonly connectDurationMsLast: number | null;
  readonly connectDurationMsMin: number | null;
  readonly connectDurationMsMax: number | null;
  readonly successfulConnects: number;
  readonly heartbeatLoss: number;
  readonly reconnectCount: number;
  readonly protocolMismatch: number;
  readonly checksumFailure: number;
  readonly envelopeRejected: number;
  readonly sendFailures: number;
  readonly invalidTransitions: number;
  /** Mesaj gidiş-dönüş gecikmesi (ms). Ölçüm yoksa null. */
  readonly messageLatencyMsLast: number | null;
  readonly messageLatencyMsMedian: number | null;
  readonly messageLatencyMsMax: number | null;
  readonly messageLatencySampleCount: number;
  /** Son güncelleme damgası; hiç olay yoksa null ("şimdi" UYDURULMAZ). */
  readonly lastUpdatedAt: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Toplayıcı
 * ════════════════════════════════════════════════════════════════════════ */

export class CompanionTelemetry {
  private _connectionAttempts = 0;
  private _successfulConnects = 0;
  private _connectLast: number | null = null;
  private _connectMin: number | null = null;
  private _connectMax: number | null = null;
  private _heartbeatLoss = 0;
  private _reconnectCount = 0;
  private _protocolMismatch = 0;
  private _checksumFailure = 0;
  private _envelopeRejected = 0;
  private _sendFailures = 0;
  private _invalidTransitions = 0;
  private _latency: number[] = [];
  private _latencyLast: number | null = null;
  private _lastUpdatedAt: number | null = null;

  private _touch(nowMs?: number): void {
    if (typeof nowMs === 'number' && Number.isFinite(nowMs) && nowMs > 0) {
      this._lastUpdatedAt = this._lastUpdatedAt === null
        ? nowMs : Math.max(this._lastUpdatedAt, nowMs);
    }
  }

  recordConnectionAttempt(nowMs?: number): void {
    this._connectionAttempts++;
    this._touch(nowMs);
  }

  /**
   * Başarılı bağlantı + süresi. Negatif/geçersiz süre KAYDEDİLMEZ (saat
   * sıçraması sahte istatistik üretmesin) ama bağlantı sayısı yine artar.
   */
  recordConnectSuccess(durationMs: number | null, nowMs?: number): void {
    this._successfulConnects++;
    this._touch(nowMs);
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return;
    const d = Math.trunc(durationMs);
    this._connectLast = d;
    this._connectMin = this._connectMin === null ? d : Math.min(this._connectMin, d);
    this._connectMax = this._connectMax === null ? d : Math.max(this._connectMax, d);
  }

  recordHeartbeatLoss(nowMs?: number): void { this._heartbeatLoss++; this._touch(nowMs); }
  recordReconnect(nowMs?: number): void { this._reconnectCount++; this._touch(nowMs); }
  recordProtocolMismatch(nowMs?: number): void { this._protocolMismatch++; this._touch(nowMs); }
  recordChecksumFailure(nowMs?: number): void { this._checksumFailure++; this._touch(nowMs); }
  recordEnvelopeRejected(nowMs?: number): void { this._envelopeRejected++; this._touch(nowMs); }
  recordSendFailure(nowMs?: number): void { this._sendFailures++; this._touch(nowMs); }
  recordInvalidTransition(nowMs?: number): void { this._invalidTransitions++; this._touch(nowMs); }

  /** Gecikme örneği (ms). Bounded halka: en yeni örnekler korunur. */
  recordMessageLatency(latencyMs: number, nowMs?: number): void {
    this._touch(nowMs);
    if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0) return;
    const v = Math.trunc(latencyMs);
    this._latencyLast = v;
    this._latency.push(v);
    if (this._latency.length > MAX_TELEMETRY_SAMPLES) this._latency.shift();
  }

  snapshot(): CompanionTelemetrySnapshot {
    const sorted = [...this._latency].sort((a, b) => a - b);
    const median = sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : Math.trunc((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

    return {
      connectionAttempts: this._connectionAttempts,
      connectDurationMsLast: this._connectLast,
      connectDurationMsMin: this._connectMin,
      connectDurationMsMax: this._connectMax,
      successfulConnects: this._successfulConnects,
      heartbeatLoss: this._heartbeatLoss,
      reconnectCount: this._reconnectCount,
      protocolMismatch: this._protocolMismatch,
      checksumFailure: this._checksumFailure,
      envelopeRejected: this._envelopeRejected,
      sendFailures: this._sendFailures,
      invalidTransitions: this._invalidTransitions,
      messageLatencyMsLast: this._latencyLast,
      messageLatencyMsMedian: median,
      messageLatencyMsMax: sorted.length === 0 ? null : sorted[sorted.length - 1],
      messageLatencySampleCount: sorted.length,
      lastUpdatedAt: this._lastUpdatedAt,
    };
  }

  reset(): void {
    this._connectionAttempts = 0;
    this._successfulConnects = 0;
    this._connectLast = null;
    this._connectMin = null;
    this._connectMax = null;
    this._heartbeatLoss = 0;
    this._reconnectCount = 0;
    this._protocolMismatch = 0;
    this._checksumFailure = 0;
    this._envelopeRejected = 0;
    this._sendFailures = 0;
    this._invalidTransitions = 0;
    this._latency = [];
    this._latencyLast = null;
    this._lastUpdatedAt = null;
  }

  /** Kalıcı gövdeden geri yükler (sayaçlar toplanmaz, ATANIR). */
  restore(v: unknown): void {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const n = (k: string): number => {
      const x = o[k];
      return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.trunc(x) : 0;
    };
    const nn = (k: string): number | null => {
      const x = o[k];
      return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.trunc(x) : null;
    };
    this._connectionAttempts = n('connectionAttempts');
    this._successfulConnects = n('successfulConnects');
    this._connectLast = nn('connectDurationMsLast');
    this._connectMin = nn('connectDurationMsMin');
    this._connectMax = nn('connectDurationMsMax');
    this._heartbeatLoss = n('heartbeatLoss');
    this._reconnectCount = n('reconnectCount');
    this._protocolMismatch = n('protocolMismatch');
    this._checksumFailure = n('checksumFailure');
    this._envelopeRejected = n('envelopeRejected');
    this._sendFailures = n('sendFailures');
    this._invalidTransitions = n('invalidTransitions');
    this._latencyLast = nn('messageLatencyMsLast');
    this._latency = [];
    this._lastUpdatedAt = nn('lastUpdatedAt');
  }
}

export function createCompanionTelemetry(): CompanionTelemetry {
  return new CompanionTelemetry();
}

/** Boş anlık görüntü — "hiç ölçüm yok" durumunun tek doğru temsili. */
export function emptyTelemetrySnapshot(): CompanionTelemetrySnapshot {
  return new CompanionTelemetry().snapshot();
}
