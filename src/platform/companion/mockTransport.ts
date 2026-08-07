/**
 * mockTransport.ts — Scriptlenebilir MOCK taşıma (P1-PREP).
 *
 * ── AMAÇ ────────────────────────────────────────────────────────────────────
 * Gerçek bağlantı OLMADAN tüm Companion akışını uçtan uca sürmek. Bu adapter
 * gerçek bir soket/BLE/RFCOMM AÇMAZ; yalnız bellek içi kuyruk kullanır.
 *
 * ── DETERMİNİSTİK: TIMER YOK ────────────────────────────────────────────────
 * Senaryo adımları KENDİLİĞİNDEN ilerlemez — çağıran `step()` der. Gerekçe:
 * `setTimeout` tabanlı bir mock, testleri saat toleransına bağımlı ve flaky
 * yapar; ayrıca sahipsiz timer riski getirir. Zaman DAİMA dışarıdan verilir.
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Hiçbir metot throw ETMEZ; hata sabit kodla döner.
 */

import {
  MAX_PAYLOAD_CHARS, stableStringify,
  type CompanionErrorCode, type CompanionTransportType,
} from './companionDomain';
import type { CompanionEnvelope } from './messageEnvelope';
import {
  TRANSPORT_OK, transportFail,
  type ConnectionTransport, type TransportDescriptor, type TransportInbound,
  type TransportLinkState, type TransportResult, type TransportStatus,
} from './connectionTransport';

/* ══════════════════════════════════════════════════════════════════════════
 * Senaryo betiği
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Betik adımı. Her adım bir `step()` çağrısında UYGULANIR.
 *
 *  OPEN_OK        : açılış başarılı olsun.
 *  OPEN_FAIL      : açılış başarısız olsun (TRANSPORT_OPEN_FAILED).
 *  DELIVER        : sağlanan gövdeyi gelen kuyruğuna koy (ham — bozuk olabilir).
 *  DROP_SEND      : sonraki `send()` başarısız olsun.
 *  SILENCE        : hiçbir şey yapma (kalp atışı kaybını simüle etmek için —
 *                   zamanı çağıran ilerletir, adapter beklemez).
 *  LINK_LOST      : bağlantı koptu (link ERROR, writable false).
 *  RESTORE        : bağlantıyı geri getir (yeniden bağlanma senaryosu).
 */
export type MockStepKind =
  | 'OPEN_OK' | 'OPEN_FAIL' | 'DELIVER' | 'DROP_SEND' | 'SILENCE' | 'LINK_LOST' | 'RESTORE';

export interface MockStep {
  readonly kind: MockStepKind;
  /** DELIVER için gövde (zarf VEYA kasten bozuk bir şey). */
  readonly payload?: unknown;
  /** Bu adımın uygulandığı an (yalnız kayıt için; adapter saat OKUMAZ). */
  readonly atMs?: number;
}

export interface MockTransportDeps {
  readonly adapterId?: string;
  /** Bu adapter'ın HANGİ taşıma gibi davrandığı. Varsayılan MOCK. */
  readonly reportedType?: CompanionTransportType;
  readonly script?: readonly MockStep[];
  /** Test için yük tavanı daraltılabilir. */
  readonly maxPayloadChars?: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Adapter
 * ════════════════════════════════════════════════════════════════════════ */

export class MockTransport implements ConnectionTransport {
  readonly type: CompanionTransportType;
  readonly adapterId: string;

  private readonly _maxPayloadChars: number;
  private _script: MockStep[];
  private _cursor = 0;

  private _link: TransportLinkState = 'CLOSED';
  private _openShouldFail = false;
  private _dropNextSend = false;
  private _inbound: TransportInbound[] = [];
  private _sent: CompanionEnvelope[] = [];
  private _sentCount = 0;
  private _receivedCount = 0;
  private _lastError: CompanionErrorCode | null = null;
  private _closed = false;

  constructor(deps: MockTransportDeps = {}) {
    this.type = deps.reportedType ?? 'MOCK';
    this.adapterId = typeof deps.adapterId === 'string' && deps.adapterId.length > 0
      ? deps.adapterId.slice(0, 32) : 'mock-1';
    this._maxPayloadChars = Number.isFinite(deps.maxPayloadChars)
      && (deps.maxPayloadChars as number) > 0
      ? Math.trunc(deps.maxPayloadChars as number) : MAX_PAYLOAD_CHARS;
    this._script = Array.isArray(deps.script) ? [...deps.script] : [];
  }

  /* ── Sözleşme ────────────────────────────────────────────────────────── */

  describe(): TransportDescriptor {
    return Object.freeze({
      type: this.type,
      adapterId: this.adapterId,
      /* MOCK GERÇEKTEN uygulanmıştır; ama gerçek bir bağlantı DEĞİLDİR ve bu
         sınır `limitations` içinde açıkça beyan edilir. */
      implemented: true,
      maxPayloadChars: this._maxPayloadChars,
      limitations: Object.freeze([
        'NO_REAL_LINK', 'SCRIPT_DRIVEN', 'NO_ENCRYPTION', 'NO_COMPRESSION',
      ]),
    });
  }

  open(): TransportResult {
    if (this._closed) return transportFail('TRANSPORT_UNAVAILABLE');
    if (this._openShouldFail) {
      this._link = 'ERROR';
      this._lastError = 'TRANSPORT_OPEN_FAILED';
      return transportFail('TRANSPORT_OPEN_FAILED');
    }
    this._link = 'OPEN';
    this._lastError = null;
    return TRANSPORT_OK;
  }

  /** İdempotent — ikinci kapatma hata DEĞİLDİR. Tüm kuyruk bırakılır (zero-leak). */
  close(): TransportResult {
    this._link = 'CLOSED';
    this._closed = true;
    this._inbound = [];
    this._sent = [];
    return TRANSPORT_OK;
  }

  send(envelope: CompanionEnvelope): TransportResult {
    if (this._closed || this._link !== 'OPEN') {
      this._lastError = 'TRANSPORT_UNAVAILABLE';
      return transportFail('TRANSPORT_UNAVAILABLE');
    }
    if (this._dropNextSend) {
      this._dropNextSend = false;
      this._lastError = 'TRANSPORT_SEND_FAILED';
      return transportFail('TRANSPORT_SEND_FAILED');
    }
    if (!envelope || typeof envelope !== 'object') {
      this._lastError = 'ENVELOPE_MALFORMED';
      return transportFail('ENVELOPE_MALFORMED');
    }
    let chars = 0;
    try { chars = stableStringify(envelope.payload).length; } catch { chars = 0; }
    if (chars > this._maxPayloadChars) {
      this._lastError = 'PAYLOAD_TOO_LARGE';
      return transportFail('PAYLOAD_TOO_LARGE');
    }

    if (this._sent.length < 64) this._sent.push(envelope);
    this._sentCount++;
    this._lastError = null;
    return TRANSPORT_OK;
  }

  /** Gelenleri TÜKETEREK döndürür — ikinci çağrı aynı mesajı VERMEZ. */
  poll(): readonly TransportInbound[] {
    if (this._inbound.length === 0) return Object.freeze([]);
    const out = this._inbound;
    this._inbound = [];
    return Object.freeze(out);
  }

  status(): TransportStatus {
    return Object.freeze({
      type: this.type,
      link: this._link,
      implemented: true,
      writable: this._link === 'OPEN' && !this._closed,
      inboundQueued: this._inbound.length,
      sentCount: this._sentCount,
      receivedCount: this._receivedCount,
      lastErrorCode: this._lastError,
    });
  }

  /* ── Test sürüşü ─────────────────────────────────────────────────────── */

  /** Betiği değiştirir ve imleci sıfırlar. */
  setScript(script: readonly MockStep[]): void {
    this._script = Array.isArray(script) ? [...script] : [];
    this._cursor = 0;
  }

  /** Betiğe adım ekler (kuyruk sonuna). */
  queue(step: MockStep): void {
    if (this._script.length < 256) this._script.push(step);
  }

  /**
   * Betikten TEK adım uygular. Betik bittiyse `false` döner.
   * Adapter kendiliğinden ilerlemez → testler deterministiktir.
   */
  step(nowMs = 0): boolean {
    if (this._cursor >= this._script.length) return false;
    const s = this._script[this._cursor++];
    this._apply(s, nowMs);
    return true;
  }

  /** Kalan tüm adımları uygular; uygulanan adım sayısını döner. */
  runAll(nowMs = 0): number {
    let n = 0;
    while (this.step(nowMs)) n++;
    return n;
  }

  /** Betik dışı doğrudan teslim (testte tek satırlık kolaylık). */
  deliver(raw: unknown, nowMs = 0): void {
    this._enqueue(raw, nowMs);
  }

  /** Gönderilmiş zarflar — doğrulama için salt-okunur. */
  sentEnvelopes(): readonly CompanionEnvelope[] {
    return Object.freeze([...this._sent]);
  }

  private _apply(s: MockStep, nowMs: number): void {
    const at = Number.isFinite(s.atMs) ? (s.atMs as number) : nowMs;
    switch (s.kind) {
      case 'OPEN_OK':
        this._openShouldFail = false;
        break;
      case 'OPEN_FAIL':
        this._openShouldFail = true;
        break;
      case 'DELIVER':
        this._enqueue(s.payload, at);
        break;
      case 'DROP_SEND':
        this._dropNextSend = true;
        break;
      case 'SILENCE':
        /* Bilinçli olarak hiçbir şey yapmaz: kalp atışı kaybı ZAMAN ile
           simüle edilir (çağıran saati ilerletir), adapter beklemez. */
        break;
      case 'LINK_LOST':
        this._link = 'ERROR';
        this._lastError = 'TRANSPORT_UNAVAILABLE';
        break;
      case 'RESTORE':
        this._closed = false;
        this._openShouldFail = false;
        this._link = 'OPEN';
        this._lastError = null;
        break;
      default:
        break;
    }
  }

  private _enqueue(raw: unknown, nowMs: number): void {
    if (this._inbound.length >= 64) return;      // bounded
    this._inbound.push({ receivedAt: nowMs, raw });
    this._receivedCount++;
  }
}

export function createMockTransport(deps: MockTransportDeps = {}): MockTransport {
  return new MockTransport(deps);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hazır senaryolar — görevde istenen yedi durum
 * ════════════════════════════════════════════════════════════════════════ */

export type MockScenarioName =
  | 'SUCCESSFUL_CONNECT'
  | 'HANDSHAKE_TIMEOUT'
  | 'HEARTBEAT_LOSS'
  | 'CAPABILITY_CHANGE'
  | 'RECONNECT'
  | 'VERSION_MISMATCH'
  | 'CHECKSUM_ERROR';

export const MOCK_SCENARIOS: readonly MockScenarioName[] = Object.freeze([
  'SUCCESSFUL_CONNECT', 'HANDSHAKE_TIMEOUT', 'HEARTBEAT_LOSS',
  'CAPABILITY_CHANGE', 'RECONNECT', 'VERSION_MISMATCH', 'CHECKSUM_ERROR',
]);

export const MOCK_SCENARIO_LABEL: Readonly<Record<MockScenarioName, string>> = {
  SUCCESSFUL_CONNECT: 'Başarılı bağlantı',
  HANDSHAKE_TIMEOUT:  'El sıkışma zaman aşımı',
  HEARTBEAT_LOSS:     'Kalp atışı kaybı',
  CAPABILITY_CHANGE:  'Yetenek değişimi',
  RECONNECT:          'Yeniden bağlanma',
  VERSION_MISMATCH:   'Protokol sürümü uyuşmazlığı',
  CHECKSUM_ERROR:     'Sağlama toplamı hatası',
} as const;

/**
 * Senaryonun TAŞIMA tarafındaki adımları.
 *
 * NOT: el sıkışma yükleri (hello) taşımadan BAĞIMSIZDIR ve Session Manager
 * testinde enjekte edilir; burada yalnız taşıma davranışı betiklenir. Böylece
 * mock taşıma protokol bilgisi TAŞIMAZ (katman ayrımı korunur).
 */
export function scenarioScript(name: MockScenarioName): readonly MockStep[] {
  switch (name) {
    case 'SUCCESSFUL_CONNECT':
      return Object.freeze([{ kind: 'OPEN_OK' } as MockStep]);
    case 'HANDSHAKE_TIMEOUT':
      /* Açılış olur ama karşı taraf HİÇ hello göndermez → üst katman zaman aşımı verir. */
      return Object.freeze([{ kind: 'OPEN_OK' } as MockStep, { kind: 'SILENCE' } as MockStep]);
    case 'HEARTBEAT_LOSS':
      return Object.freeze([{ kind: 'OPEN_OK' } as MockStep, { kind: 'SILENCE' } as MockStep]);
    case 'CAPABILITY_CHANGE':
      return Object.freeze([{ kind: 'OPEN_OK' } as MockStep]);
    case 'RECONNECT':
      return Object.freeze([
        { kind: 'OPEN_OK' } as MockStep,
        { kind: 'LINK_LOST' } as MockStep,
        { kind: 'RESTORE' } as MockStep,
      ]);
    case 'VERSION_MISMATCH':
      return Object.freeze([{ kind: 'OPEN_OK' } as MockStep]);
    case 'CHECKSUM_ERROR':
      return Object.freeze([{ kind: 'OPEN_OK' } as MockStep]);
    default:
      return Object.freeze([]);
  }
}

/** Senaryo için hazır adapter. */
export function createScenarioTransport(
  name: MockScenarioName, deps: MockTransportDeps = {},
): MockTransport {
  return new MockTransport({ ...deps, script: scenarioScript(name) });
}
