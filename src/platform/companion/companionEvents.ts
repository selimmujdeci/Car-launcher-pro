/**
 * companionEvents.ts — Companion olay adları + Event Bus köprüsü (P1-PREP).
 *
 * ── DOĞRUDAN BAĞIMLILIK YOK (PAZARLIKSIZ) ───────────────────────────────────
 * Companion katmanı Event Bus'ı SINIF OLARAK import ETMEZ. Yalnız minimal bir
 * `publish` sözleşmesi (`CompanionEventTarget`) bilir — depodaki mevcut köprü
 * deseniyle (`capabilityEventBridge`, `vehicleHalEventBridge`) birebir aynı.
 * Böylece Session Manager bus olmadan da test edilebilir ve bus dispose edilse
 * bile companion tarafı çökmez.
 *
 * ── AD SÖZLEŞMESİ ───────────────────────────────────────────────────────────
 * Bus'ın ad kuralı `alan.nesne.eylem` (küçük harf) olduğu için görevdeki mantıksal
 * adlar (`PHONE_SESSION_CREATED` …) bus adlarına EŞLENİR. İki isim de tek yerde
 * tutulur → ayrışma imkânsız.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Olay yükleri YALNIZ sayım · sabit enum · geri çevrilemez karma taşır. Mesaj
 * içeriği (`payload`), cihaz adı, MAC, numara, kişi ASLA yayınlanmaz — yayınlanan
 * tek mesaj bilgisi `payloadType` ve boyuttur.
 */

import { clampText, type CompanionErrorCode, type CompanionTransportType } from './companionDomain';
import type { CapabilityToken, CompanionPeerRole } from './companionDomain';
import type { ConnectionState } from './connectionStateMachine';

/* ══════════════════════════════════════════════════════════════════════════
 * Olay adları
 * ════════════════════════════════════════════════════════════════════════ */

/** Mantıksal ad → bus adı. Bus regex'i: `^[a-z_]+\.[a-z_]+\.[a-z_]+$`. */
export const COMPANION_EVENTS = Object.freeze({
  PHONE_SESSION_CREATED:      'companion.session.created',
  PHONE_CONNECTED:            'companion.connection.connected',
  PHONE_DISCONNECTED:         'companion.connection.disconnected',
  PHONE_CAPABILITIES_UPDATED: 'companion.capabilities.updated',
  PHONE_HEARTBEAT:            'companion.heartbeat.received',
  PHONE_ERROR:                'companion.error.raised',
  PHONE_MESSAGE:              'companion.message.received',
} as const);

export type CompanionEventKey = keyof typeof COMPANION_EVENTS;
export type CompanionEventName = (typeof COMPANION_EVENTS)[CompanionEventKey];

export const COMPANION_EVENT_NAMES: readonly CompanionEventName[] = Object.freeze(
  Object.values(COMPANION_EVENTS) as CompanionEventName[],
);

/** Bus kataloğuna eklenecek girdiler (domain 'companion'). */
export const COMPANION_EVENT_CATALOG: readonly {
  readonly name: CompanionEventName;
  readonly domain: 'companion';
  readonly priority: 'high' | 'normal' | 'low';
  readonly retained?: boolean;
  readonly transient?: boolean;
}[] = Object.freeze([
  { name: COMPANION_EVENTS.PHONE_SESSION_CREATED, domain: 'companion', priority: 'normal' },
  { name: COMPANION_EVENTS.PHONE_CONNECTED, domain: 'companion', priority: 'high', retained: true },
  { name: COMPANION_EVENTS.PHONE_DISCONNECTED, domain: 'companion', priority: 'high', retained: true },
  { name: COMPANION_EVENTS.PHONE_CAPABILITIES_UPDATED, domain: 'companion', priority: 'normal', retained: true },
  /* Kalp atışı YÜKSEK FREKANSLIDIR → transient: geçmişe yazılmaz (bellek). */
  { name: COMPANION_EVENTS.PHONE_HEARTBEAT, domain: 'companion', priority: 'low', transient: true },
  { name: COMPANION_EVENTS.PHONE_ERROR, domain: 'companion', priority: 'high' },
  { name: COMPANION_EVENTS.PHONE_MESSAGE, domain: 'companion', priority: 'normal', transient: true },
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Yük sözleşmeleri — PII TAŞIMAZ
 * ════════════════════════════════════════════════════════════════════════ */

export interface CompanionSessionEventPayload {
  readonly sessionId: string;
  readonly generation: number;
  readonly transportType: CompanionTransportType;
  readonly deviceRole: CompanionPeerRole;
  readonly status: ConnectionState;
  readonly protocolVersion: number | null;
}

export interface CompanionCapabilitiesEventPayload {
  readonly sessionId: string;
  readonly generation: number;
  readonly grantedCount: number;
  readonly unknownCount: number;
  readonly unsupportedCount: number;
  /** Yalnız BİLİNEN ve ANLAŞILAN jetonlar — bilinmeyenler sayı olarak taşınır. */
  readonly granted: readonly CapabilityToken[];
  readonly digest: string;
}

export interface CompanionHeartbeatEventPayload {
  readonly sessionId: string;
  readonly generation: number;
  readonly ageMs: number | null;
  readonly verdict: string;
}

export interface CompanionErrorEventPayload {
  readonly sessionId: string | null;
  readonly generation: number | null;
  readonly code: CompanionErrorCode;
  readonly state: ConnectionState | null;
}

/** Mesaj olayı — İÇERİK YOK: yalnız tür, boyut ve yön. */
export interface CompanionMessageEventPayload {
  readonly sessionId: string;
  readonly generation: number;
  readonly payloadType: string;
  readonly payloadVersion: number;
  readonly kind: string;
  readonly payloadChars: number;
  readonly accepted: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yayın hedefi (minimal sözleşme)
 * ════════════════════════════════════════════════════════════════════════ */

/** Event Bus'ın SADECE ihtiyaç duyulan yüzeyi — sınıf bağımlılığı YOK. */
export interface CompanionEventTarget {
  publish: (input: {
    name: string;
    payload?: unknown;
    domain?: string;
    source?: string;
    transient?: boolean;
    retained?: boolean;
  }) => unknown;
}

export interface CompanionEventBridgeStatus {
  readonly publishedCount: number;
  readonly droppedCount: number;
  readonly disposed: boolean;
  readonly lastPublishAt: number | null;
}

/**
 * Companion → Event Bus köprüsü.
 *
 * ZERO-LEAK: abonelik AÇMAZ (yalnız yayın yapar) → bırakılacak kaynak yoktur;
 * `dispose()` yine de idempotenttir ve sonrasında tüm yayınlar no-op olur.
 * FAIL-SOFT: bus patlarsa istisna YUTULUR ve `droppedCount` artar — companion
 * akışı bus yüzünden ASLA durmaz.
 */
export class CompanionEventBridge {
  private readonly _bus: CompanionEventTarget | null;
  private _published = 0;
  private _dropped = 0;
  private _disposed = false;
  private _lastPublishAt: number | null = null;

  constructor(bus: CompanionEventTarget | null) {
    this._bus = bus ?? null;
  }

  private _emit(
    name: CompanionEventName, payload: unknown, nowMs: number,
    opts: { transient?: boolean; retained?: boolean } = {},
  ): void {
    if (this._disposed || this._bus === null) { this._dropped++; return; }
    try {
      this._bus.publish({
        name,
        payload,
        domain: 'companion',
        /* Bus'ın `source` enum'unda companion'a ayrılmış değer YOK → dürüstçe
           'unknown' bırakılır (uydurma kaynak etiketi eklenmez). */
        transient: opts.transient,
        retained: opts.retained,
      });
      this._published++;
      this._lastPublishAt = Number.isFinite(nowMs) ? nowMs : this._lastPublishAt;
    } catch {
      this._dropped++;
    }
  }

  sessionCreated(p: CompanionSessionEventPayload, nowMs: number): void {
    this._emit(COMPANION_EVENTS.PHONE_SESSION_CREATED, p, nowMs);
  }

  connected(p: CompanionSessionEventPayload, nowMs: number): void {
    this._emit(COMPANION_EVENTS.PHONE_CONNECTED, p, nowMs, { retained: true });
  }

  disconnected(p: CompanionSessionEventPayload, nowMs: number): void {
    this._emit(COMPANION_EVENTS.PHONE_DISCONNECTED, p, nowMs, { retained: true });
  }

  capabilitiesUpdated(p: CompanionCapabilitiesEventPayload, nowMs: number): void {
    this._emit(COMPANION_EVENTS.PHONE_CAPABILITIES_UPDATED, p, nowMs, { retained: true });
  }

  heartbeat(p: CompanionHeartbeatEventPayload, nowMs: number): void {
    this._emit(COMPANION_EVENTS.PHONE_HEARTBEAT, p, nowMs, { transient: true });
  }

  error(p: CompanionErrorEventPayload, nowMs: number): void {
    this._emit(COMPANION_EVENTS.PHONE_ERROR, {
      ...p, code: clampText(p.code, 48) as CompanionErrorCode,
    }, nowMs);
  }

  message(p: CompanionMessageEventPayload, nowMs: number): void {
    this._emit(COMPANION_EVENTS.PHONE_MESSAGE, p, nowMs, { transient: true });
  }

  status(): CompanionEventBridgeStatus {
    return Object.freeze({
      publishedCount: this._published,
      droppedCount: this._dropped,
      disposed: this._disposed,
      lastPublishAt: this._lastPublishAt,
    });
  }

  /** İdempotent. Bus ÇAĞIRANIN sahibidir → burada dispose EDİLMEZ. */
  dispose(): void { this._disposed = true; }

  get isDisposed(): boolean { return this._disposed; }
}

export function createCompanionEventBridge(
  bus: CompanionEventTarget | null,
): CompanionEventBridge {
  return new CompanionEventBridge(bus);
}
