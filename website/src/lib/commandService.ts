/**
 * commandService.ts — PWA Komut Gönderici
 *
 * Automotive Grade:
 * - İmza tabanlı nonce idempotency (aynı komut iki kez çalışmaz)
 * - TTL doğrulaması (5 dk)
 * - Zero-leak: subscribeCommandStatus cleanup ile her zaman sonlanır
 * - Offline guard: Araç çevrimdışıysa kullanıcıya "Sıraya alındı" mesajı
 */

import { supabaseBrowser, isSupabaseConfigured } from './supabase';
import { encryptPayload } from './commandCrypto';
import { getStoredApiKey } from './pairingService';

// ── Kritik komut tipi listesi ─────────────────────────────────────────────────
const CRITICAL_COMMANDS: CommandType[] = ['unlock', 'alarm_off'];

export function isCriticalCommand(type: CommandType): boolean {
  return CRITICAL_COMMANDS.includes(type);
}

// ── SHA-256 hash (PIN plaintext asla sunucuya gitmez) ─────────────────────────
export async function hashPin(pin: string): Promise<string> {
  const data   = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Tipler ────────────────────────────────────────────────────────────────────

export type CommandType =
  | 'lock' | 'unlock' | 'horn' | 'alarm_on' | 'alarm_off' | 'lights_on'
  | 'route_send' | 'navigation_start' | 'theme_change'
  | 'read_dtc' | 'clear_dtc' | 'read_voltage'
  | 'set_speed_alert';

export type CommandStatus =
  | 'pending' | 'accepted' | 'executing'
  | 'completed' | 'failed' | 'expired' | 'rejected';

export interface RoutePayload {
  lat:             number;
  lng:             number;
  address_name:    string;
  provider_intent: 'google_maps' | 'yandex' | 'waze' | 'apple_maps';
}

export interface CommandPayload {
  route?:  RoutePayload;
  theme?:  string;
  [key: string]: unknown;
}

export interface SendResult {
  ok:         boolean;
  commandId?: string;
  queued?:    boolean;  // true: araç offline, komut sıraya alındı
  error?:     string;
}

export interface SendCommandOptions {
  requireCriticalAuth?: boolean;
  /** SHA-256 hex hash of the PIN — required for critical commands if vehicle has a PIN set. */
  pinHash?: string;
}

export interface StatusEvent {
  commandId: string;
  status:    CommandStatus;
  updatedAt: Date;
}

// ── Push-to-Wake: aracı uyandır ──────────────────────────────────────────────

const PUSH_FN_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/push-notify`
  : null;

async function triggerPushWake(vehicleId: string, commandId: string): Promise<void> {
  if (!PUSH_FN_URL || !supabaseBrowser) return;
  try {
    const session = (await supabaseBrowser.auth.getSession()).data.session;
    await fetch(PUSH_FN_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({
        event:     'new_command',
        vehicleId,
        payload:   { command_id: commandId },
      }),
    });
  } catch { /* fire-and-forget */ }
}

// ── Araç çevrimiçi mi? (son telemetri 30s içinde) ────────────────────────────

export async function isVehicleOnline(vehicleId: string): Promise<boolean> {
  if (!supabaseBrowser) return false;
  const since = new Date(Date.now() - 30_000).toISOString();
  const { count } = await supabaseBrowser
    .from('vehicle_locations')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId)
    .gte('created_at', since);
  return (count ?? 0) > 0;
}

// ── api_key tabanlı komut gönderimi (login gerektirmez) ──────────────────────

async function sendCommandViaApiKey(
  vehicleId: string,
  type:      CommandType,
  payload:   CommandPayload,
  apiKey:    string,
  options:   SendCommandOptions = {},
): Promise<SendResult> {
  try {
    const body: Record<string, unknown> = {
      vehicleId,
      type,
      payload,
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ttl:   new Date(Date.now() + 5 * 60_000).toISOString(),
    };
    if (options.pinHash) body.pinHash = options.pinHash;

    const res = await fetch('/api/pwa/command', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; commandId?: string; error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? 'Komut gönderilemedi.' };
    return { ok: true, commandId: data.commandId };
  } catch {
    return { ok: false, error: 'Sunucuya ulaşılamadı.' };
  }
}

// ── Komut gönder ──────────────────────────────────────────────────────────────

export async function sendCommand(
  vehicleId: string,
  type: CommandType,
  payload: CommandPayload = {},
  options: SendCommandOptions = {},
): Promise<SendResult> {
  // Giriş yapılmamışsa api_key yolunu kullan (standalone PWA modu)
  const session = supabaseBrowser
    ? (await supabaseBrowser.auth.getSession()).data.session
    : null;

  if (!session) {
    const apiKey = getStoredApiKey(vehicleId);
    if (!apiKey) {
      return { ok: false, error: 'API anahtarı bulunamadı. Aracı yeniden eşleştirin.' };
    }
    return sendCommandViaApiKey(vehicleId, type, payload, apiKey, options);
  }

  if (!isSupabaseConfigured || !supabaseBrowser) {
    return { ok: false, error: 'Supabase yapılandırması eksik.' };
  }

  // Araç çevrimdışı uyarısı — komut sıraya girer (TTL sayesinde araç gelince alır)
  const online = await isVehicleOnline(vehicleId);

  // E2E şifreleme: api_key varsa payload'u şifrele
  const apiKey = getStoredApiKey(vehicleId);
  const finalPayload = apiKey
    ? await encryptPayload(payload, apiKey).catch(() => payload)
    : payload;

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ttl   = new Date(Date.now() + 5 * 60_000).toISOString();

  // Kritik komut: PIN hash ile verify_and_send_critical_command RPC
  if (isCriticalCommand(type) && options.pinHash) {
    const { data: rpcData, error: rpcErr } = await supabaseBrowser.rpc(
      'verify_and_send_critical_command',
      {
        p_vehicle_id: vehicleId,
        p_type:       type,
        p_payload:    finalPayload,
        p_pin_hash:   options.pinHash,
        p_nonce:      nonce,
        p_ttl:        ttl,
      },
    );
    if (rpcErr) return { ok: false, error: rpcErr.message };
    const res = rpcData as { ok: boolean; command_id?: string; error?: string };
    if (!res.ok) return { ok: false, error: res.error ?? 'PIN doğrulaması başarısız.' };
    return { ok: true, commandId: res.command_id, queued: !online };
  }

  const { data, error } = await supabaseBrowser
    .from('vehicle_commands')
    .insert({
      vehicle_id:             vehicleId,
      created_by:             (await supabaseBrowser.auth.getUser()).data.user?.id,
      type,
      payload:                finalPayload,
      nonce,
      ttl,
      critical_auth_verified: options.requireCriticalAuth === true,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  // Push-to-Wake: aracı sessizce uyandır (fire-and-forget)
  void triggerPushWake(vehicleId, data.id);

  return { ok: true, commandId: data.id, queued: !online };
}

// ── Komut durumunu dinle (Realtime) ───────────────────────────────────────────

export function subscribeCommandStatus(
  commandId: string,
  onEvent:   (ev: StatusEvent) => void,
  timeoutMs  = 15_000,
): () => void {
  if (!supabaseBrowser) return () => {};

  let settled = false;

  // Zaman aşımı — araç yanıt vermezse
  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    onEvent({ commandId, status: 'expired', updatedAt: new Date() });
    cleanup();
  }, timeoutMs);

  const channel = supabaseBrowser
    .channel(`cmd-status:${commandId}`)
    .on(
      'postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'vehicle_commands',
        filter: `id=eq.${commandId}`,
      },
      ({ new: row }: { new: Record<string, unknown> }) => {
        if (settled) return;
        const status = row['status'] as CommandStatus;
        onEvent({ commandId, status, updatedAt: new Date() });

        // Terminal durumlar → aboneliği kapat
        if (['completed', 'failed', 'expired', 'rejected'].includes(status)) {
          settled = true;
          clearTimeout(timeoutId);
          cleanup();
        }
      },
    )
    .subscribe();

  const cleanup = () => {
    supabaseBrowser?.removeChannel(channel);
  };

  return () => {
    if (!settled) {
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
    }
  };
}

// ── Komut gönder + dinle (birleşik API) ───────────────────────────────────────

export async function sendAndTrack(
  vehicleId: string,
  type:      CommandType,
  payload:   CommandPayload,
  onStatus:  (ev: StatusEvent) => void,
  options:   SendCommandOptions = {},
): Promise<{ unsubscribe: () => void; result: SendResult }> {
  const result = await sendCommand(vehicleId, type, payload, options);
  if (!result.ok || !result.commandId) {
    return { unsubscribe: () => {}, result };
  }
  const unsubscribe = subscribeCommandStatus(result.commandId, onStatus);
  return { unsubscribe, result };
}
