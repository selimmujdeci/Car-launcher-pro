/**
 * vehicleIdentityService — Android device identity + Supabase vehicle registration.
 *
 * Responsibilities:
 *   1. Generate/persist a stable deviceId (UUID stored encrypted)
 *   2. Register device with Supabase backend on first launch (idempotent)
 *   3. Store api_key securely after registration — never sent back again
 *   4. Generate/refresh 6-digit linking codes shown to the user
 *   5. Push realtime telemetry events (fire-and-forget, api_key auth)
 *
 * When VITE_SUPABASE_URL is not set → demo mode (mock codes, no network).
 */

import { sensitiveKeyStore }      from './sensitiveKeyStore';
import { connectivityService }    from './connectivityService';

const SK_DEVICE_ID  = 'veh_device_id'  as const;
const SK_API_KEY    = 'veh_api_key'    as const;
const SK_VEHICLE_ID = 'veh_vehicle_id' as const;

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const RPC_BASE          = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/rpc` : null;

/* ── Types ──────────────────────────────────────────────────── */

export interface VehicleIdentity {
  vehicleId: string;
  deviceId:  string;
}

export interface LinkingCodeInfo {
  code:      string;
  expiresAt: number; // epoch ms
}

/* ── Module state (in-memory cache) ────────────────────────── */

let _identity: VehicleIdentity | null = null;
let _apiKey:   string | null = null;

/* ── Internal helpers ───────────────────────────────────────── */

function _uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function _mockCode(): LinkingCodeInfo {
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  return { code, expiresAt: Date.now() + 60_000 };
}

async function _rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) throw new Error('Supabase not configured');
  const res = await fetch(`${RPC_BASE}/${fn}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `RPC ${fn} failed`);
  return data;
}

async function _getOrCreateDeviceId(): Promise<string> {
  const stored = await sensitiveKeyStore.get(SK_DEVICE_ID);
  if (stored) return stored;
  const id = _uuid();
  await sensitiveKeyStore.set(SK_DEVICE_ID, id);
  return id;
}

/* ── Public API ─────────────────────────────────────────────── */

/**
 * Returns a stable anonymous device identifier for community features
 * (radar reports, traffic data). Does NOT require vehicle registration —
 * the ID is created and persisted on first call.
 *
 * Used by radarCommunityService to:
 *   a) Attribute outgoing reports (spam prevention on the server)
 *   b) Suppress Realtime echoes of our own inserts
 */
export async function getReporterDeviceId(): Promise<string> {
  return _getOrCreateDeviceId();
}

/** Returns cached identity from SecureStorage, or null if not yet registered. */
export async function getVehicleIdentity(): Promise<VehicleIdentity | null> {
  if (_identity) return _identity;
  const [vehicleId, deviceId] = await Promise.all([
    sensitiveKeyStore.get(SK_VEHICLE_ID),
    sensitiveKeyStore.get(SK_DEVICE_ID),
  ]);
  if (vehicleId && deviceId) {
    _identity = { vehicleId, deviceId };
    return _identity;
  }
  return null;
}

/**
 * Register this device with the backend (idempotent).
 * Returns a fresh 6-digit linking code to display to the user (60s TTL).
 * Call once on first launch; call again whenever the user asks to re-link.
 */
export async function registerVehicle(name = 'Araç'): Promise<LinkingCodeInfo> {
  const deviceId = await _getOrCreateDeviceId();

  if (!RPC_BASE) return _mockCode();

  try {
    const data = await _rpc('register_vehicle', { p_device_id: deviceId, p_name: name }) as {
      vehicle_id:    string;
      api_key?:      string;
      linking_code?: string;
      expires_at?:   string;
    };

    await sensitiveKeyStore.set(SK_VEHICLE_ID, data.vehicle_id);
    if (data.api_key) {
      await sensitiveKeyStore.set(SK_API_KEY, data.api_key);
      _apiKey = data.api_key;
    }
    _identity = { vehicleId: data.vehicle_id, deviceId };

    return {
      code:      data.linking_code ?? _mockCode().code,
      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : Date.now() + 60_000,
    };
  } catch {
    // Sunucu ulaşılamıyor veya RPC hatası → çevrimdışı mod, mock kod göster
    return _mockCode();
  }
}

/**
 * Request a new linking code (previous one expired or already used).
 * Authenticated by the stored api_key — no user JWT required.
 */
export async function refreshLinkingCode(): Promise<LinkingCodeInfo> {
  if (!RPC_BASE) return _mockCode();

  const apiKey = _apiKey ?? (await sensitiveKeyStore.get(SK_API_KEY));
  if (!apiKey) return _mockCode();

  try {
    const data = await _rpc('refresh_linking_code', { p_api_key: apiKey }) as {
      linking_code: string;
      expires_at:   string;
    };
    return {
      code:      data.linking_code,
      expiresAt: new Date(data.expires_at).getTime(),
    };
  } catch {
    return _mockCode();
  }
}

/**
 * Remote komut işlenince durumu günceller. Fire-and-forget — hatalar sessizce yutulur.
 * Spec §3.4: push_vehicle_event ile aynı api_key auth pattern'ini kullanır.
 */
/**
 * Komut yaşam döngüsü durumları:
 *   accepted  : araç komutu aldı, sıraya koydu
 *   executing : executeIntent() başladı
 *   completed : komut başarıyla icra edildi (kapı kilitlendi vb.)
 *   failed    : yürütme hatası — error mesajı ile birlikte
 *   rejected  : güvenlik reddi (sürüş sırasında lock/unlock vb.)
 */
export type CommandLifecycleStatus =
  | 'received'   // araç komutu aldı — TTL kontrolünden önce
  | 'accepted'   // (legacy alias — received ile eş anlamlı, backward compat)
  | 'executing'  // executeIntent() başladı
  | 'completed'  // komut başarıyla icra edildi
  | 'expired'    // TTL aşıldı, komut çalıştırılmadı
  | 'queued'     // çevrimdışı — kritik komut retry kuyruğunda bekliyor
  | 'failed'     // yürütme hatası
  | 'rejected';  // güvenlik reddi (sürüş sırasında lock/unlock vb.)

export async function updateRemoteCommandStatus(
  commandId: string,
  status:    CommandLifecycleStatus,
  error?:    string,
): Promise<void> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) return;
  const apiKey = _apiKey ?? (await sensitiveKeyStore.get(SK_API_KEY));
  if (!apiKey) return;

  const now = new Date().toISOString();

  // Durum → timestamp eşlemesi
  const body: Record<string, unknown> = {
    p_api_key:    apiKey,
    p_command_id: commandId,
    p_status:     status,
  };
  if (status === 'received' || status === 'accepted')  body.p_accepted_at  = now;
  if (status === 'executing')                          body.p_executed_at  = now;
  if (status === 'completed' || status === 'failed' ||
      status === 'rejected'  || status === 'expired')  body.p_finished_at  = now;
  if (error)                                          body.p_error        = error;

  // Yüksek öncelik — at-least-once garantisi (connectivityService kuyruğu)
  await connectivityService.enqueue(
    `${RPC_BASE}/update_command_status`,
    'POST',
    { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body,
    'high',
    `cmd_status_${commandId}`,  // Benzersiz dedup key: aynı komut birden fazla kez queue'a girmez
  );
}

/**
 * Push a telemetry event to Supabase.
 * Artık fire-and-forget değil — connectivityService kuyruğu aracılığıyla at-least-once.
 */
export async function pushVehicleEvent(
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) return;
  const apiKey = _apiKey ?? (await sensitiveKeyStore.get(SK_API_KEY));
  if (!apiKey) return;

  // Alarm/kaza eventi kritik — önce işlenir
  const isCritical = type === 'alarm' || type === 'crash' || type === 'sos';
  const priority   = isCritical ? 'critical' : 'normal';

  await connectivityService.enqueue(
    `${RPC_BASE}/push_vehicle_event`,
    'POST',
    { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    { p_api_key: apiKey, p_type: type, p_payload: payload },
    priority,
    'telemetry',
  );
}
