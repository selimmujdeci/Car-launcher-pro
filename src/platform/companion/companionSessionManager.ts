/**
 * companionSessionManager.ts — Companion oturum yöneticisi (P1-PREP).
 *
 * ── SORUMLULUK ──────────────────────────────────────────────────────────────
 * TEK aktif oturumu yönetir: durum makinesini sürer, el sıkışmayı yürütür,
 * yetenekleri anlaşır, kalp atışı/zaman aşımı kurallarını uygular, telemetriyi
 * besler ve olayları Event Bus köprüsüne verir.
 *
 * ── NE YAPMAZ ───────────────────────────────────────────────────────────────
 * Gerçek bağlantı KURMAZ (taşıma soyuttur) · eşleştirme/keşif/tarama BAŞLATMAZ ·
 * izin İSTEMEZ · medya/çağrı/SMS komutu GÖNDERMEZ · Bluetooth otoritesi HAKKINDA
 * HÜKÜM VERMEZ · OBD'ye DOKUNMAZ.
 *
 * ── TIMER YOK: ZAMAN VE KİMLİK ENJEKTE EDİLİR ───────────────────────────────
 * `setInterval`/`setTimeout` KULLANILMAZ. Zamanı ilerletmek ve `pump()`/`tick()`
 * çağırmak ÇAĞIRANIN işidir. Gerekçe: sahipsiz timer bu depoda gerçekten
 * yaşanmış bir arıza sınıfıdır (VehicleDataLayer'ın stop sonrası dirilmesi).
 * Sahiplik tek yerde durur, sızıntı yapısal olarak imkânsızlaşır.
 *
 * ── NESİL (GENERATION) KAPISI ───────────────────────────────────────────────
 * Her yeni bağlantı denemesi nesli ARTIRIR. Eski nesille yapılan gönderim
 * `SESSION_GENERATION_STALE` ile REDDEDİLİR — geciken bir çağrı yeni oturumu
 * kirletemez.
 */

import {
  type CapabilityToken, type CompanionCapability, type CompanionErrorCode,
  type CompanionPeerRole, type CompanionTransportType,
  stableStringify,
} from './companionDomain';
import {
  canSendApplicationMessage, transition, type ConnectionAction, type ConnectionState,
} from './connectionStateMachine';
import {
  assessHeartbeat, connectDurationMs, createPhoneHubSession, demoteRestoredSession,
  isHandshakeTimedOut, withHeartbeat, withNegotiated, withNextGeneration, withStatus,
  withTransport, type HeartbeatVerdict, type PhoneHubSession,
} from './companionSession';
import {
  createCompanionCapabilityRegistry, LOCALLY_SUPPORTED_CAPABILITIES,
  type CapabilitySnapshot, type CompanionCapabilityRegistry,
} from './companionCapabilityRegistry';
import {
  buildAck, buildEnvelope, buildRequest, validateEnvelope,
  type CompanionEnvelope, type EnvelopeKind,
} from './messageEnvelope';
import {
  HELLO_PAYLOAD_TYPE, LOCAL_PROTOCOL_RANGE, negotiateProtocol, parseHelloPayload,
} from './protocolNegotiation';
import { createCompanionEventBridge, type CompanionEventBridge, type CompanionEventTarget } from './companionEvents';
import { createCompanionTelemetry, type CompanionTelemetry } from './companionTelemetry';
import type { ConnectionTransport } from './connectionTransport';

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç tipleri
 * ════════════════════════════════════════════════════════════════════════ */

export interface CompanionOpResult {
  readonly ok: boolean;
  readonly state: ConnectionState;
  readonly error: CompanionErrorCode | null;
}

export interface PumpResult {
  readonly processed: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly errors: readonly CompanionErrorCode[];
  readonly state: ConnectionState;
}

export interface TickResult {
  readonly state: ConnectionState;
  readonly heartbeat: HeartbeatVerdict;
  readonly actions: readonly ConnectionAction[];
  readonly errors: readonly CompanionErrorCode[];
}

export interface CompanionSessionManagerDeps {
  readonly transport: ConnectionTransport;
  /** Duvar saati — ENJEKTE. Bu modül `Date.now()` çağırmaz. */
  readonly now: () => number;
  /** Kimlik üreteci — ENJEKTE (rastgelelik test dışına taşınır). */
  readonly newId: (prefix: string) => string;
  readonly bus?: CompanionEventTarget | null;
  readonly capabilities?: CompanionCapabilityRegistry;
  readonly telemetry?: CompanionTelemetry;
  readonly locallySupported?: readonly CompanionCapability[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yönetici
 * ════════════════════════════════════════════════════════════════════════ */

const MAX_PENDING_REQUESTS = 32;
const MAX_INBOUND_PER_PUMP = 32;

export class CompanionSessionManager {
  private readonly _transport: ConnectionTransport;
  private readonly _now: () => number;
  private readonly _newId: (prefix: string) => string;
  private readonly _bridge: CompanionEventBridge;
  private readonly _caps: CompanionCapabilityRegistry;
  private readonly _telemetry: CompanionTelemetry;
  private readonly _localCaps: readonly CompanionCapability[];

  private _session: PhoneHubSession | null = null;
  private _state: ConnectionState = 'IDLE';
  private _lastError: CompanionErrorCode | null = null;
  private _capsSnapshot: CapabilitySnapshot | null = null;
  private _pending = new Map<string, number>();
  private _disposed = false;

  constructor(deps: CompanionSessionManagerDeps) {
    this._transport = deps.transport;
    this._now = typeof deps.now === 'function' ? deps.now : (): number => 0;
    this._newId = typeof deps.newId === 'function'
      ? deps.newId
      : (p: string): string => `${p}-0`;
    this._bridge = createCompanionEventBridge(deps.bus ?? null);
    this._localCaps = deps.locallySupported ?? LOCALLY_SUPPORTED_CAPABILITIES;
    this._caps = deps.capabilities
      ?? createCompanionCapabilityRegistry({ locallySupported: this._localCaps });
    this._telemetry = deps.telemetry ?? createCompanionTelemetry();
  }

  /* ── Okuma yüzeyi ───────────────────────────────────────────────────── */

  get state(): ConnectionState { return this._state; }
  get session(): PhoneHubSession | null { return this._session; }
  get generation(): number { return this._session ? this._session.generation : 0; }
  get lastError(): CompanionErrorCode | null { return this._lastError; }
  get telemetry(): CompanionTelemetry { return this._telemetry; }
  get capabilities(): CompanionCapabilityRegistry { return this._caps; }
  get eventBridge(): CompanionEventBridge { return this._bridge; }
  get isDisposed(): boolean { return this._disposed; }

  capabilitySnapshot(): CapabilitySnapshot | null { return this._capsSnapshot; }

  /* ── Oturum yaşam döngüsü ───────────────────────────────────────────── */

  /**
   * Yeni oturum açar. Var olan oturum varsa nesli DEVRALIR ve ARTIRIR — böylece
   * eski nesle ait geciken hiçbir şey yeni oturuma karışamaz.
   */
  beginSession(peerKeyHash: string | null = null): CompanionOpResult {
    if (this._disposed) return this._fail('SESSION_NOT_ACTIVE');
    const now = this._now();
    const prevGen = this._session ? this._session.generation : 0;

    this._session = createPhoneHubSession({
      sessionId: this._newId('phs'),
      nowMs: now,
      transportType: this._transport ? this._transport.type : 'UNKNOWN',
      generation: prevGen + 1,
      peerKeyHash,
    });
    this._state = 'IDLE';
    this._lastError = null;
    this._capsSnapshot = null;
    this._pending.clear();
    this._caps.clear();

    this._bridge.sessionCreated(this._sessionPayload(), now);
    return { ok: true, state: this._state, error: null };
  }

  /**
   * Kalıcı kayıttan gelen oturumu devralır.
   *
   * DAİMA indirgenir (`demoteRestoredSession`): uygulama yeniden başladığında
   * hiçbir taşıma açık değildir, bu yüzden diskteki `CONNECTED` durumu OLDUĞU
   * GİBİ geri yüklenemez.
   */
  adoptRestoredSession(restored: PhoneHubSession | null): CompanionOpResult {
    if (this._disposed || restored === null) return this._fail('SESSION_NOT_ACTIVE');
    this._session = demoteRestoredSession(restored);
    this._state = this._session.status;
    this._capsSnapshot = null;
    this._caps.clear();
    this._pending.clear();
    return { ok: true, state: this._state, error: null };
  }

  /**
   * Taşımayı açar (gerçek soket DEĞİL — adapter sözleşmesi) ve el sıkışmayı
   * başlatır. Uygulanmamış taşıma DÜRÜSTÇE reddedilir.
   */
  openTransport(): CompanionOpResult {
    if (this._disposed) return this._fail('SESSION_NOT_ACTIVE');
    if (this._session === null) return this._fail('SESSION_NOT_ACTIVE');

    const moved = this._apply('OPEN');
    if (!moved.ok) return moved;

    const now = this._now();
    this._telemetry.recordConnectionAttempt(now);
    this._session = withTransport(withHeartbeat(this._session, now), this._transport.type);

    const opened = this._transport.open();
    if (!opened.ok) {
      const code = opened.error ?? 'TRANSPORT_OPEN_FAILED';
      this._apply('FAIL');
      return this._raise(code);
    }

    /* El sıkışma isteğini gönder. Bu bir UYGULAMA mesajı DEĞİLDİR; gönderim
       kapısı (yalnız CONNECTED/DEGRADED) el sıkışma trafiğine uygulanmaz. */
    const hello = buildRequest(
      this._newId('msg'), now, HELLO_PAYLOAD_TYPE,
      {
        protocol: { min: LOCAL_PROTOCOL_RANGE.min, max: LOCAL_PROTOCOL_RANGE.max },
        capabilities: [...this._localCaps].sort(),
        role: 'HEAD_UNIT',
        peerKeyHash: this._session.peerKeyHash,
      },
    );
    const sent = this._transport.send(hello);
    if (!sent.ok) {
      this._telemetry.recordSendFailure(now);
      this._apply('FAIL');
      return this._raise(sent.error ?? 'TRANSPORT_SEND_FAILED');
    }
    this._trackPending(hello, now);

    const negotiating = this._apply('NEGOTIATE');
    return negotiating;
  }

  /** Kasıtlı kapatma — otomatik yeniden bağlanma TETİKLEMEZ. */
  closeSession(): CompanionOpResult {
    if (this._disposed) return { ok: true, state: this._state, error: null };
    const result = this._apply('CLOSE');
    try { this._transport.close(); } catch { /* fail-soft */ }
    this._pending.clear();
    if (this._session !== null) {
      this._bridge.disconnected(this._sessionPayload(), this._now());
    }
    return result;
  }

  /**
   * Yeniden bağlanma: nesli ARTIRIR, anlaşmayı SIFIRLAR ve taşımayı yeniden açar.
   * Yetenekler taşınmaz — karşı taraf bir yeteneği kaybettiyse taşımak sahte
   * yetenek olurdu.
   */
  reconnect(): CompanionOpResult {
    if (this._disposed || this._session === null) return this._fail('SESSION_NOT_ACTIVE');
    const retry = this._apply('RETRY');
    if (!retry.ok) return retry;

    const now = this._now();
    this._session = withNextGeneration(this._session);
    this._caps.clear();
    this._capsSnapshot = null;
    this._pending.clear();
    this._telemetry.recordReconnect(now);
    return this.openTransport();
  }

  /* ── Gelen akış ─────────────────────────────────────────────────────── */

  /**
   * Taşımadan bekleyenleri okur ve işler. Kendi kendine ÇAĞRILMAZ — çağıran
   * ne zaman okuyacağına karar verir (timer yok).
   */
  pump(): PumpResult {
    const errors: CompanionErrorCode[] = [];
    if (this._disposed || this._session === null) {
      return { processed: 0, accepted: 0, rejected: 0, errors: ['SESSION_NOT_ACTIVE'], state: this._state };
    }

    let inbound: readonly { readonly receivedAt: number; readonly raw: unknown }[] = [];
    try { inbound = this._transport.poll(); } catch { inbound = []; }

    let accepted = 0;
    let rejected = 0;
    let processed = 0;

    for (const item of inbound) {
      if (processed >= MAX_INBOUND_PER_PUMP) break;
      processed++;
      const now = this._now();

      const validation = validateEnvelope(item.raw);
      if (!validation.ok) {
        rejected++;
        for (const e of validation.errors) if (!errors.includes(e)) errors.push(e);
        this._telemetry.recordEnvelopeRejected(now);
        if (validation.errors.includes('CHECKSUM_MISMATCH')) {
          this._telemetry.recordChecksumFailure(now);
        }
        /* REDDEDİLEN ZARF BAĞLANTIYI DÜŞÜRMEZ: tek bozuk mesaj yüzünden oturumu
           kapatmak, gürültülü bir taşımada sürekli kopmaya yol açar. Sayaç artar,
           olay yayınlanır, karar üst katmana bırakılır. */
        this._bridge.error({
          sessionId: this._session.sessionId,
          generation: this._session.generation,
          code: validation.errors[0] ?? 'ENVELOPE_MALFORMED',
          state: this._state,
        }, now);
        continue;
      }

      const env = item.raw as CompanionEnvelope;
      accepted++;
      this._session = withHeartbeat(this._session, now);
      this._resolvePending(env, now);

      if (env.payloadType === HELLO_PAYLOAD_TYPE
        || env.payloadType === 'companion.hello.accept') {
        const r = this._handleHello(env, now);
        if (r !== null && !errors.includes(r)) errors.push(r);
        continue;
      }

      if (env.payloadType === 'companion.heartbeat') {
        this._bridge.heartbeat({
          sessionId: this._session.sessionId,
          generation: this._session.generation,
          ageMs: 0,
          verdict: 'OK',
        }, now);
        this._maybeAck(env, now);
        continue;
      }

      /* Uygulama mesajı: İÇERİK yayınlanmaz — yalnız tür/boyut/kabul bilgisi. */
      let chars = 0;
      try { chars = stableStringify(env.payload).length; } catch { chars = 0; }
      this._bridge.message({
        sessionId: this._session.sessionId,
        generation: this._session.generation,
        payloadType: env.payloadType,
        payloadVersion: env.payloadVersion,
        kind: env.kind as EnvelopeKind,
        payloadChars: chars,
        accepted: true,
      }, now);
      this._maybeAck(env, now);
    }

    return { processed, accepted, rejected, errors: Object.freeze(errors), state: this._state };
  }

  /**
   * Zaman temelli kuralları uygular: el sıkışma zaman aşımı + kalp atışı
   * zayıflama/kayıp. Çağıran zamanı ilerletir.
   */
  tick(): TickResult {
    const actions: ConnectionAction[] = [];
    const errors: CompanionErrorCode[] = [];
    if (this._disposed || this._session === null) {
      return { state: this._state, heartbeat: 'UNKNOWN', actions, errors: ['SESSION_NOT_ACTIVE'] };
    }

    const now = this._now();

    if (isHandshakeTimedOut(this._session, now)) {
      this._apply('FAIL');
      actions.push('FAIL');
      errors.push('HANDSHAKE_TIMEOUT');
      this._raise('HANDSHAKE_TIMEOUT');
      return { state: this._state, heartbeat: 'UNKNOWN', actions, errors };
    }

    const verdict = assessHeartbeat(this._session, now);
    if (this._state === 'CONNECTED' && verdict === 'DEGRADED') {
      this._apply('DEGRADE');
      actions.push('DEGRADE');
    } else if (verdict === 'LOST' && (this._state === 'CONNECTED' || this._state === 'DEGRADED')) {
      this._telemetry.recordHeartbeatLoss(now);
      this._apply('LOSE');
      actions.push('LOSE');
      errors.push('HEARTBEAT_TIMEOUT');
      this._raise('HEARTBEAT_TIMEOUT');
    } else if (this._state === 'DEGRADED' && verdict === 'OK') {
      this._apply('RECOVER');
      actions.push('RECOVER');
    }

    return { state: this._state, heartbeat: verdict, actions, errors: Object.freeze(errors) };
  }

  /* ── Giden akış ─────────────────────────────────────────────────────── */

  /**
   * UYGULAMA mesajı gönderir.
   *
   * İKİ KAPI: (1) durum YALNIZ CONNECTED/DEGRADED olmalı; (2) `expectedGeneration`
   * verildiyse güncel nesille EŞLEŞMELİ — geciken bir çağrı yeni oturumu
   * kirletemez.
   */
  send(
    payloadType: string, payload?: unknown,
    expectedGeneration?: number, payloadVersion = 1,
  ): CompanionOpResult {
    if (this._disposed || this._session === null) return this._fail('SESSION_NOT_ACTIVE');
    if (!canSendApplicationMessage(this._state)) return this._fail('SESSION_NOT_ACTIVE');
    if (typeof expectedGeneration === 'number'
      && expectedGeneration !== this._session.generation) {
      return this._fail('SESSION_GENERATION_STALE');
    }

    const now = this._now();
    const env = buildEnvelope({
      messageId: this._newId('msg'), nowMs: now, kind: 'REQUEST',
      payloadType, payloadVersion, payload, ack: true,
      correlationId: null,
    });
    const validation = validateEnvelope(env);
    if (!validation.ok) {
      /* Kendi ürettiğimiz zarf geçersizse (ör. yük tavanı) GÖNDERMEYİZ ve
         "gönderdim" DEMEYİZ. */
      return this._fail(validation.errors[0] ?? 'ENVELOPE_MALFORMED');
    }

    const sent = this._transport.send(env);
    if (!sent.ok) {
      this._telemetry.recordSendFailure(now);
      return this._raise(sent.error ?? 'TRANSPORT_SEND_FAILED');
    }
    this._trackPending(env, now);
    return { ok: true, state: this._state, error: null };
  }

  /* ── Kapatma ────────────────────────────────────────────────────────── */

  /** Zero-leak: taşımayı kapatır, köprüyü kilitler, kuyrukları bırakır. İdempotent. */
  dispose(): void {
    if (this._disposed) return;
    try { this._transport.close(); } catch { /* fail-soft */ }
    this._bridge.dispose();
    this._pending.clear();
    this._caps.clear();
    this._disposed = true;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * İç yardımcılar
   * ════════════════════════════════════════════════════════════════════ */

  /** Durum geçişi + geçersiz geçiş telemetrisi. Sessiz sıçrama YOK. */
  private _apply(action: ConnectionAction): CompanionOpResult {
    const r = transition(this._state, action);
    if (!r.ok) {
      this._telemetry.recordInvalidTransition(this._now());
      this._lastError = 'INVALID_STATE_TRANSITION';
      return { ok: false, state: this._state, error: 'INVALID_STATE_TRANSITION' };
    }
    this._state = r.next;
    if (this._session !== null) {
      this._session = withStatus(this._session, r.next, this._now());
    }
    return { ok: true, state: this._state, error: null };
  }

  private _fail(code: CompanionErrorCode): CompanionOpResult {
    this._lastError = code;
    return { ok: false, state: this._state, error: code };
  }

  /** Hatayı kaydeder + olay yayınlar. */
  private _raise(code: CompanionErrorCode): CompanionOpResult {
    const now = this._now();
    this._lastError = code;
    this._bridge.error({
      sessionId: this._session ? this._session.sessionId : null,
      generation: this._session ? this._session.generation : null,
      code,
      state: this._state,
    }, now);
    return { ok: false, state: this._state, error: code };
  }

  /**
   * El sıkışma yükünü işler: protokol anlaşması → yetenek anlaşması → CONNECTED.
   * Sürüm uyuşmazlığı BAĞLANTIYI DÜŞÜRÜR (yanlış yorumlanmış wire, sessiz hatanın
   * en kötü türüdür).
   */
  private _handleHello(env: CompanionEnvelope, now: number): CompanionErrorCode | null {
    if (this._session === null) return 'SESSION_NOT_ACTIVE';

    const hello = parseHelloPayload(env.payload);
    const proto = negotiateProtocol(hello.protocol);
    if (!proto.ok || proto.agreed === null) {
      this._telemetry.recordProtocolMismatch(now);
      this._apply('FAIL');
      this._raise('PROTOCOL_VERSION_MISMATCH');
      return 'PROTOCOL_VERSION_MISMATCH';
    }

    const before = this._capsSnapshot;
    const snapshot = this._caps.applyDeclaration(hello.capabilities, this._session.generation);
    this._capsSnapshot = snapshot;

    const role: CompanionPeerRole =
      hello.role === 'PHONE' || hello.role === 'HEAD_UNIT'
        || hello.role === 'COMPANION_APP' || hello.role === 'OTHER'
        ? hello.role : 'UNKNOWN';

    this._session = withNegotiated(
      this._session, proto.agreed, snapshot.granted as readonly CapabilityToken[], role,
    );

    /* Yetenek kümesi DEĞİŞTİYSE olay yayınlanır. İlk anlaşmada `before` null
       olduğu için de yayınlanır (ilk bildirim kaybolmasın). */
    if (before === null || before.digest !== snapshot.digest) {
      this._bridge.capabilitiesUpdated({
        sessionId: this._session.sessionId,
        generation: this._session.generation,
        grantedCount: snapshot.granted.length,
        unknownCount: snapshot.unknown.length,
        unsupportedCount: snapshot.unsupported.length,
        granted: snapshot.granted,
        digest: snapshot.digest,
      }, now);
    }

    if (this._state === 'NEGOTIATING') {
      const done = this._apply('NEGOTIATED');
      if (done.ok) {
        this._telemetry.recordConnectSuccess(connectDurationMs(this._session), now);
        this._bridge.connected(this._sessionPayload(), now);
      }
    } else if (this._state === 'CONNECTED' || this._state === 'DEGRADED') {
      /* Bağlıyken gelen yeni beyan → YENİDEN ANLAŞMA. Durum makinesi bu geçişi
         açıkça destekler (CONNECTED/DEGRADED → NEGOTIATING → CONNECTED). */
      if (this._apply('NEGOTIATE').ok) this._apply('NEGOTIATED');
    }
    return null;
  }

  /** Karşı taraf ACK istediyse ACK gönderir (uygulama mesajı DEĞİLDİR). */
  private _maybeAck(env: CompanionEnvelope, now: number): void {
    if (env.ack !== true) return;
    try {
      const ack = buildAck(this._newId('msg'), now, env);
      const r = this._transport.send(ack);
      if (!r.ok) this._telemetry.recordSendFailure(now);
    } catch {
      this._telemetry.recordSendFailure(now);
    }
  }

  private _trackPending(env: CompanionEnvelope, now: number): void {
    const key = env.correlationId ?? env.messageId;
    if (typeof key !== 'string' || key.length === 0) return;
    if (this._pending.size >= MAX_PENDING_REQUESTS) {
      /* En eski bekleyeni düşür — bounded. Kaybedilen ölçüm sessizce "0 ms"
         diye kaydedilmez, sadece ölçülmez. */
      const oldest = this._pending.keys().next();
      if (!oldest.done) this._pending.delete(oldest.value);
    }
    this._pending.set(key, now);
  }

  /** Yanıt/ACK geldiyse gidiş-dönüş gecikmesini ölçer. */
  private _resolvePending(env: CompanionEnvelope, now: number): void {
    const key = env.correlationId;
    if (typeof key !== 'string' || key.length === 0) return;
    const sentAt = this._pending.get(key);
    if (sentAt === undefined) return;
    this._pending.delete(key);
    const latency = now - sentAt;
    if (latency >= 0) this._telemetry.recordMessageLatency(latency, now);
  }

  private _sessionPayload(): {
    sessionId: string; generation: number; transportType: CompanionTransportType;
    deviceRole: CompanionPeerRole; status: ConnectionState; protocolVersion: number | null;
  } {
    const s = this._session;
    return {
      sessionId: s ? s.sessionId : '',
      generation: s ? s.generation : 0,
      transportType: s ? s.transportType : 'UNKNOWN',
      deviceRole: s ? s.deviceRole : 'UNKNOWN',
      status: this._state,
      protocolVersion: s ? s.protocolVersion : null,
    };
  }
}

export function createCompanionSessionManager(
  deps: CompanionSessionManagerDeps,
): CompanionSessionManager {
  return new CompanionSessionManager(deps);
}
