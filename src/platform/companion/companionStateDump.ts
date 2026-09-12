/**
 * companionStateDump.ts — Geliştirici durum dökümü (P1-PREP · SAF).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok (zaman parametre) · modül durumu YOK.
 *
 * ── AMAÇ ────────────────────────────────────────────────────────────────────
 * CAROS LAB ve tanı raporu için JSON-serileştirilebilir, PII'siz, sınırlı
 * anlık görüntü üretir. GÖZLEM aracıdır — hiçbir şeyi değiştirmez.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Dökümde mesaj İÇERİĞİ (`payload`) · cihaz adı · MAC · telefon numarası · kişi ·
 * bildirim metni YOKTUR. Karşı taraf kimliği yalnız geri çevrilemez karma olarak
 * görünür. Bilinmeyen yetenek jetonları SAYI olarak taşınır (karşı tarafın
 * özel ad alanı dışa sızmasın).
 */

import {
  CAPABILITY_PRIVACY, isKnownCapability,
  type CapabilityToken, type CompanionCapability, type CompanionErrorCode,
  type CompanionPeerRole, type CompanionTransportType,
} from './companionDomain';
import type { ConnectionState } from './connectionStateMachine';
import { assessHeartbeat, connectDurationMs, type HeartbeatVerdict, type PhoneHubSession } from './companionSession';
import type { CapabilitySnapshot } from './companionCapabilityRegistry';
import type { TransportDescriptor, TransportStatus } from './connectionTransport';
import { emptyTelemetrySnapshot, type CompanionTelemetrySnapshot } from './companionTelemetry';

/* ══════════════════════════════════════════════════════════════════════════
 * Döküm tipleri
 * ════════════════════════════════════════════════════════════════════════ */

export interface SessionDump {
  readonly present: boolean;
  readonly sessionId: string | null;
  readonly generation: number | null;
  readonly status: ConnectionState | null;
  readonly transportType: CompanionTransportType | null;
  readonly deviceRole: CompanionPeerRole | null;
  readonly protocolVersion: number | null;
  readonly createdAt: number | null;
  readonly connectedAt: number | null;
  readonly lastSeen: number | null;
  /** Kalp atışı yaşı (ms). Hiç gözlem yoksa null — 0 GÖSTERİLMEZ. */
  readonly lastSeenAgeMs: number | null;
  readonly heartbeat: HeartbeatVerdict;
  readonly connectDurationMs: number | null;
  readonly peerKeyHash: string | null;
  readonly capabilityCount: number;
}

export interface CapabilitiesDump {
  readonly present: boolean;
  readonly generation: number | null;
  readonly grantedCount: number;
  readonly declaredCount: number;
  readonly unsupportedCount: number;
  readonly unknownCount: number;
  readonly rejectedTokenCount: number;
  readonly truncated: boolean;
  readonly digest: string | null;
  /** YALNIZ bilinen jetonlar listelenir; bilinmeyenler sayı olarak taşınır. */
  readonly granted: readonly CompanionCapability[];
  readonly unsupported: readonly CompanionCapability[];
  /** Anlaşılan yeteneklerin gizlilik sınıfları (onay kapısı tasarımı için). */
  readonly grantedPrivacy: readonly string[];
}

export interface TransportDump {
  readonly type: CompanionTransportType;
  readonly adapterId: string;
  readonly implemented: boolean;
  readonly link: string;
  readonly writable: boolean;
  readonly inboundQueued: number;
  readonly sentCount: number;
  readonly receivedCount: number;
  readonly maxPayloadChars: number;
  readonly limitations: readonly string[];
  readonly lastErrorCode: CompanionErrorCode | null;
}

export interface TelemetryDump extends CompanionTelemetrySnapshot {
  readonly present: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Döküm üreticileri
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Oturum dökümü. Oturum YOKSA `present:false` ve tüm alanlar null —
 * sahte 0 / sahte tarih ÜRETİLMEZ.
 */
export function dumpSession(
  session: PhoneHubSession | null, nowMs: number,
): SessionDump {
  if (session === null) {
    return {
      present: false, sessionId: null, generation: null, status: null,
      transportType: null, deviceRole: null, protocolVersion: null,
      createdAt: null, connectedAt: null, lastSeen: null, lastSeenAgeMs: null,
      heartbeat: 'UNKNOWN', connectDurationMs: null, peerKeyHash: null,
      capabilityCount: 0,
    };
  }
  const age = session.lastSeen === null ? null : Math.max(0, nowMs - session.lastSeen);
  return {
    present: true,
    sessionId: session.sessionId,
    generation: session.generation,
    status: session.status,
    transportType: session.transportType,
    deviceRole: session.deviceRole,
    protocolVersion: session.protocolVersion,
    createdAt: session.createdAt,
    connectedAt: session.connectedAt,
    lastSeen: session.lastSeen,
    lastSeenAgeMs: age,
    heartbeat: assessHeartbeat(session, nowMs),
    connectDurationMs: connectDurationMs(session),
    peerKeyHash: session.peerKeyHash,
    capabilityCount: session.capabilities.length,
  };
}

/** Yetenek dökümü. Anlaşma yoksa `present:false` (boş liste "hepsi yok" DEMEK DEĞİLDİR). */
export function dumpCapabilities(snapshot: CapabilitySnapshot | null): CapabilitiesDump {
  if (snapshot === null) {
    return {
      present: false, generation: null, grantedCount: 0, declaredCount: 0,
      unsupportedCount: 0, unknownCount: 0, rejectedTokenCount: 0, truncated: false,
      digest: null, granted: [], unsupported: [], grantedPrivacy: [],
    };
  }
  const granted = _knownOnly(snapshot.granted);
  return {
    present: true,
    generation: snapshot.generation,
    grantedCount: snapshot.granted.length,
    declaredCount: snapshot.declared.length,
    unsupportedCount: snapshot.unsupported.length,
    unknownCount: snapshot.unknown.length,
    rejectedTokenCount: snapshot.rejectedTokenCount,
    truncated: snapshot.truncated,
    digest: snapshot.digest,
    granted,
    unsupported: _knownOnly(snapshot.unsupported),
    grantedPrivacy: Object.freeze(granted.map((c) => `${c}:${CAPABILITY_PRIVACY[c]}`)),
  };
}

/** Bilinmeyen jetonları DIŞARI SIZDIRMAZ — karşı tarafın ad alanı dökülmez. */
function _knownOnly(tokens: readonly CapabilityToken[]): readonly CompanionCapability[] {
  const out: CompanionCapability[] = [];
  for (const t of tokens) if (isKnownCapability(t)) out.push(t);
  return Object.freeze(out.sort());
}

export function dumpTransport(
  descriptor: TransportDescriptor, status: TransportStatus,
): TransportDump {
  return {
    type: status.type,
    adapterId: descriptor.adapterId,
    implemented: descriptor.implemented,
    link: status.link,
    writable: status.writable,
    inboundQueued: status.inboundQueued,
    sentCount: status.sentCount,
    receivedCount: status.receivedCount,
    maxPayloadChars: descriptor.maxPayloadChars,
    limitations: descriptor.limitations,
    lastErrorCode: status.lastErrorCode,
  };
}

export function dumpTelemetry(snapshot: CompanionTelemetrySnapshot | null): TelemetryDump {
  const s = snapshot ?? emptyTelemetrySnapshot();
  return { present: snapshot !== null, ...s };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hazırlık hükmü
 * ════════════════════════════════════════════════════════════════════════ */

export type FoundationReadiness = 'READY' | 'NOT_READY';

export interface FoundationVerdict {
  readonly readiness: FoundationReadiness;
  /** Karşılanmayan koşul kodları — boşsa READY. */
  readonly unmet: readonly string[];
  /** Bu derlemede GERÇEKTEN uygulanmış taşımalar. */
  readonly implementedTransports: readonly CompanionTransportType[];
  /**
   * Foundation READY olsa BİLE gerçek bağlantı hazır DEĞİLDİR. Bu alan bunu
   * açıkça beyan eder ki ekran "bağlanabilir" izlenimi vermesin.
   */
  readonly realConnectionReady: false;
}

export interface FoundationCheckInput {
  readonly session: SessionDump;
  readonly capabilities: CapabilitiesDump;
  readonly transport: TransportDump;
  readonly telemetry: TelemetryDump;
}

/**
 * Companion Foundation hazır mı — YALNIZ ALTYAPI hükmü.
 *
 * "READY" burada "gerçek telefona bağlanabiliriz" DEMEK DEĞİLDİR; "iskelet
 * uçtan uca çalışıyor ve mock taşımayla doğrulandı" demektir. `realConnectionReady`
 * DAİMA false'tur — gerçek bağlantı P1-A'nın işidir ve saha kanıtı gerektirir.
 */
export function assessFoundation(input: FoundationCheckInput): FoundationVerdict {
  const unmet: string[] = [];

  if (!input.session.present) unmet.push('NO_SESSION');
  if (!input.transport.implemented) unmet.push('TRANSPORT_NOT_IMPLEMENTED');
  if (input.session.present && input.session.status !== 'CONNECTED'
    && input.session.status !== 'DEGRADED') {
    unmet.push('SESSION_NOT_CONNECTED');
  }
  if (input.session.present && input.session.protocolVersion === null) {
    unmet.push('PROTOCOL_NOT_NEGOTIATED');
  }
  if (!input.capabilities.present) unmet.push('CAPABILITIES_NOT_NEGOTIATED');
  if (input.telemetry.connectionAttempts === 0) unmet.push('NO_CONNECTION_ATTEMPT_RECORDED');

  return {
    readiness: unmet.length === 0 ? 'READY' : 'NOT_READY',
    unmet: Object.freeze(unmet),
    implementedTransports: Object.freeze(['MOCK'] as CompanionTransportType[]),
    realConnectionReady: false,
  };
}
