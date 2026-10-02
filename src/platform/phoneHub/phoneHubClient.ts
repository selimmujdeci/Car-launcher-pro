/**
 * phoneHubClient.ts — Phone Link TELEFON rolü köprüsü (aynı CarOS Pro telefonda).
 *
 * Telefon araca İKİ yoldan birden bağlanmayı dener (native
 * `PhoneHubClientController`): yerel Wi-Fi (aracın beacon'ı / ağ geçidi) ve
 * Bluetooth (eşleşmiş cihazlarda Phone Hub servisi). Hangisi önce bağlanırsa
 * o kullanılır. Güven taşımadan GELMEZ: iki ekranda aynı 6 haneli kodun
 * onayı şarttır.
 *
 * Bu modül karar VERMEZ; native gerçeği okur ve kullanıcı eylemini iletir.
 * Ölçülmemiş durum "bağlı" sayılmaz.
 */
import type { PluginListenerHandle } from '@capacitor/core';
import { PhoneHubLink } from './phoneHubLink';

export type ClientPhase =
  | 'IDLE' | 'SEARCHING' | 'HANDSHAKING' | 'AWAITING_CONFIRM' | 'CONNECTED'
  | 'RETRY_WAIT' | 'NOT_FOUND' | 'FAILED';

export type ClientPathState =
  | 'IDLE' | 'SEARCHING' | 'FOUND' | 'CONNECTED' | 'NOT_FOUND' | 'DISABLED'
  | 'PERMISSION_REQUIRED' | 'UNAVAILABLE' | 'CANCELLED';

export interface PhoneHubClientSnapshot {
  /** Native gerçekten okundu mu — okunamadıysa diğer alanlar ANLAMSIZDIR. */
  readonly present: boolean;
  readonly phase: ClientPhase | null;
  readonly wifi: ClientPathState | null;
  readonly bluetooth: ClientPathState | null;
  readonly activeTransport: 'WIFI' | 'BLUETOOTH' | null;
  readonly connected: boolean;
  readonly awaitingConfirmation: boolean;
  readonly hasTrustedCar: boolean;
  readonly lastErrorCode: string | null;
}

export const CLIENT_ABSENT: PhoneHubClientSnapshot = Object.freeze({
  present: false, phase: null, wifi: null, bluetooth: null, activeTransport: null,
  connected: false, awaitingConfirmation: false, hasTrustedCar: false, lastErrorCode: null,
});

const PHASES: readonly ClientPhase[] = [
  'IDLE', 'SEARCHING', 'HANDSHAKING', 'AWAITING_CONFIRM', 'CONNECTED', 'RETRY_WAIT', 'NOT_FOUND', 'FAILED',
];
const PATHS: readonly ClientPathState[] = [
  'IDLE', 'SEARCHING', 'FOUND', 'CONNECTED', 'NOT_FOUND', 'DISABLED', 'PERMISSION_REQUIRED', 'UNAVAILABLE', 'CANCELLED',
];

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** Ham native anlık görüntüyü güvenli biçime çevirir (SAF). Bilinmeyen → null. */
export function parseClientSnapshot(raw: unknown): PhoneHubClientSnapshot {
  if (!raw || typeof raw !== 'object') return CLIENT_ABSENT;
  const r = raw as Record<string, unknown>;
  if (typeof r.error === 'string' || r.role !== 'PHONE') return CLIENT_ABSENT;
  const paths = (r.paths ?? {}) as Record<string, unknown>;
  const session = (r.session ?? null) as Record<string, unknown> | null;
  const trust = (r.trust ?? {}) as Record<string, unknown>;
  const pairing = (r.pairing ?? {}) as Record<string, unknown>;
  const phase = pick(r.phase, PHASES);
  const active = r.activeTransport === 'WIFI' || r.activeTransport === 'BLUETOOTH' ? r.activeTransport : null;
  return Object.freeze({
    present: true,
    phase,
    wifi: pick(paths.wifi, PATHS),
    bluetooth: pick(paths.bluetooth, PATHS),
    activeTransport: active,
    /* "Bağlı" yalnız native oturum GERÇEKTEN kurulduysa (şifreli + onaylı). */
    connected: phase === 'CONNECTED' && session !== null && session.trulyEstablished === true,
    awaitingConfirmation: pairing.awaitingConfirmation === true,
    hasTrustedCar: trust.hasTrustedPeer === true,
    lastErrorCode: typeof r.lastErrorCode === 'string' ? r.lastErrorCode : null,
  });
}

export function isClientBridgeAvailable(): boolean {
  return typeof PhoneHubLink?.getClientSnapshot === 'function';
}

export async function refreshPhoneHubClient(): Promise<PhoneHubClientSnapshot> {
  try {
    if (typeof PhoneHubLink?.getClientSnapshot !== 'function') return CLIENT_ABSENT;
    return parseClientSnapshot(await PhoneHubLink.getClientSnapshot());
  } catch {
    return CLIENT_ABSENT;
  }
}

/** "Araca bağlan" — kullanıcı eylemi; Android 12+'da Bluetooth izni burada istenir. */
export async function connectToCar(): Promise<boolean> {
  try {
    if (typeof PhoneHubLink?.clientConnect !== 'function') return false;
    const r = await PhoneHubLink.clientConnect({ askPermission: true });
    return r?.started === true;
  } catch {
    return false;
  }
}

export async function disconnectFromCar(): Promise<void> {
  try { await PhoneHubLink?.clientDisconnect?.(); } catch { /* fail-soft */ }
}

export async function forgetTrustedCar(): Promise<void> {
  try { await PhoneHubLink?.forgetTrustedCar?.(); } catch { /* fail-soft */ }
}

/** Onay bekleyen kod — önbelleğe ALINMAZ, yalnız ekranda o an gösterilir. */
export async function getCarPairingCode(): Promise<string | null> {
  try {
    if (typeof PhoneHubLink?.getClientPairingCode !== 'function') return null;
    const r = await PhoneHubLink.getClientPairingCode();
    return r?.awaiting === true && typeof r.code === 'string' && r.code.length > 0 ? r.code : null;
  } catch {
    return null;
  }
}

export async function confirmCarPairing(accepted: boolean): Promise<boolean> {
  try {
    if (typeof PhoneHubLink?.confirmClientPairing !== 'function') return false;
    const r = await PhoneHubLink.confirmClientPairing({ accepted });
    return r?.applied === true;
  } catch {
    return false;
  }
}

/** Faz değişimlerini dinler (olay tabanlı; polling YOK). Söküm thunk'ı döner. */
export function subscribeClientPhase(fn: (phase: ClientPhase | null) => void): () => void {
  let handle: PluginListenerHandle | null = null;
  let disposed = false;
  try {
    void PhoneHubLink.addListener('clientState', (e) => fn(pick(e?.phase, PHASES)))
      .then((h) => { if (disposed) void h.remove(); else handle = h; })
      .catch(() => { /* eski native — olay yok, ekran elle tazelenir */ });
  } catch { /* plugin yok */ }
  return () => {
    disposed = true;
    if (handle) void handle.remove();
  };
}
