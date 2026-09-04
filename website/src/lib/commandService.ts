/**
 * commandService.ts — PWA Komut Gönderici
 *
 * Automotive Grade:
 * - İmza tabanlı nonce idempotency (aynı komut iki kez çalışmaz)
 * - TTL doğrulaması (5 dk)
 * - Zero-leak: subscribeCommandStatus cleanup ile her zaman sonlanır
 * - Offline guard: Araç çevrimdışıysa kullanıcıya "Sıraya alındı" mesajı
 */

import {
  requiresE2E, fetchCarPublicKey, encryptE2EPayload, carKeyErrorMessage,
} from '@/lib/e2eCommandCrypto';
import { supabaseBrowser, isSupabaseConfigured } from './supabase';
import { encryptPayload } from './commandCrypto';
import { getStoredApiKey } from './pairingService';
import { TIMING } from './constants';
import {
  evaluateAccountScopedCapability,
} from '@/security/accountCleanup/accountCleanupRuntime';

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
  | 'route_send' | 'navigation_start' | 'theme_change' | 'layout_change'
  | 'read_dtc' | 'clear_dtc' | 'read_voltage'
  | 'set_speed_alert';

export type CommandStatus =
  | 'pending' | 'accepted' | 'executing'
  | 'completed' | 'failed' | 'expired' | 'rejected';

export interface RoutePayload {
  lat:             number;
  lng:             number;
  address_name:    string;
  /**
   * Rotanın araçta NEREDE açılacağı.
   *
   * `'caros'` = aracın KENDİ navigasyonu (varsayılan). Diğerleri aracın
   * üzerindeki harici uygulamayı açar.
   *
   * SAHA KUSURU (2026-08-21): bu alan yalnız harici uygulama adlarını
   * taşıyordu ve varsayılanı `'google_maps'`ti → "Araca Gönder" her zaman
   * Google Maps'i açıyordu; aracın kendi navigasyonu bir SEÇENEK BİLE değildi.
   */
  provider_intent: 'caros' | 'google_maps' | 'yandex' | 'waze' | 'apple_maps';
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
  code?:      'ACCOUNT_CLEANUP_LOCKDOWN' | 'SECURITY_RUNTIME_UNAVAILABLE';
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

// ── Araç çevrimiçi mi? (son telemetri OFFLINE_TIMEOUT_MS içinde) ─────────────
// vehicle_telemetry.updated_at kullanılır: park halindeki araç konum satırı
// üretmez ama her heartbeat'te telemetry upsert eder — komutlar realtime ile
// park halindeki araca da anında ulaştığından bu pencere UI eşiğiyle aynıdır.

export async function isVehicleOnline(vehicleId: string): Promise<boolean> {
  if (!supabaseBrowser) return false;
  const since = new Date(Date.now() - TIMING.OFFLINE_TIMEOUT_MS).toISOString();
  const { count } = await supabaseBrowser
    .from('vehicle_telemetry')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId)
    .gte('updated_at', since);
  return (count ?? 0) > 0;
}

/* ── OTURUMSUZ (api_key) KOMUT YOLU KALDIRILDI — P0-001A ───────────────────
 * Buradaki `sendCommandViaApiKey`, ham `api_key`i `Authorization` başlığında
 * `/api/pwa/command`e gönderiyordu. O uç fail-closed kapatıldı çünkü
 * doğrulaması (`sha256(raw) === api_key_hash`) düz metin kolona karşı
 * MATEMATİKSEL OLARAK eşleşemiyordu (üretim: 834/834 satır UUID biçimli).
 *
 * Ayrıca yol ZATEN erişilemezdi: kanonik eşleştirme (#631) `api_key`
 * döndürmez, `getStoredApiKey` boş dizeyi `null`a çevirir → fonksiyon hiç
 * çağrılmıyordu. Kaldırılması davranış DEĞİŞTİRMEZ, yalnız ölü kodu ve
 * "ham anahtarı tarayıcıda taşı" desenini ortadan kaldırır.
 *
 * Oturumsuz komut yeniden istenirse doğru çözüm bu fonksiyonu geri getirmek
 * DEĞİL, cihaz anahtarını gerçekten hash'leyip (P0-001H) uca tek doğrulama
 * otoritesi bağlamaktır (P0-001I). */

// ── Komut gönder ──────────────────────────────────────────────────────────────

export async function sendCommand(
  vehicleId: string,
  type: CommandType,
  payload: CommandPayload = {},
  options: SendCommandOptions = {},
): Promise<SendResult> {
  const access = evaluateAccountScopedCapability('COMMAND_DISPATCH');
  if (!access.allowed) {
    return {
      ok: false,
      error: 'Güvenli oturum temizliği sırasında komut gönderilemez.',
      code: access.code === 'RUNTIME_UNAVAILABLE'
        ? 'SECURITY_RUNTIME_UNAVAILABLE'
        : 'ACCOUNT_CLEANUP_LOCKDOWN',
    };
  }
  // Giriş yapılmamışsa api_key yolunu kullan (standalone PWA modu)
  const session = supabaseBrowser
    ? (await supabaseBrowser.auth.getSession()).data.session
    : null;

  /* P0-001A: oturumsuz (api_key) komut yolu KAPATILDI — gerekçe yukarıda.
     Eskiden burada "API anahtarı bulunamadı. Aracı yeniden eşleştirin."
     deniyordu; bu YANLIŞ TEŞHİSTİ — yeniden eşleştirmek anahtar üretmez
     (kanonik rota anahtar döndürmez), kullanıcı sonsuz döngüye giriyordu. */
  if (!session) {
    return {
      ok: false,
      error: 'Komut göndermek için hesabınızla giriş yapmalısınız.',
    };
  }

  if (!isSupabaseConfigured || !supabaseBrowser) {
    return { ok: false, error: 'Supabase yapılandırması eksik.' };
  }

  // Araç çevrimdışı uyarısı — komut sıraya girer (TTL sayesinde araç gelince alır)
  const online = await isVehicleOnline(vehicleId);

  /* ── E2E ŞİFRELEME (#672) ────────────────────────────────────────────────
     Araç tarafı `lock`, `unlock`, `horn`, `alarm_on`, `alarm_off`, `lights_on`, `clear_dtc` için `ecdh_v1`
     zarfı ŞART koşar ve başka her biçimi `Decryption Error` ile reddeder.
     Buradaki eski kod ya PBKDF2 `{iv,data}` üretiyordu ya da düz metin
     gönderiyordu — İKİSİ DE reddediliyordu, üstelik `.catch(() => payload)`
     şifreleme çökerse SESSİZCE düz metne düşüyordu. Artık:
       · E2E gerektiren komut → araç public key'iyle `ecdh_v1` zarfı,
       · anahtar yoksa/şifrelenemezse KOMUT GÖNDERİLMEZ ve gerekçe döner
         (sessizce reddedilen komut göndermek kullanıcıyı kör bırakır),
       · diğer komutlar → eski davranış aynen korunur. */
  const apiKey = getStoredApiKey(vehicleId);
  let finalPayload: Record<string, unknown> = payload as Record<string, unknown>;

  if (requiresE2E(type)) {
    const keyRes = await fetchCarPublicKey(vehicleId);
    if (!keyRes.ok) return { ok: false, error: carKeyErrorMessage(keyRes.reason) };
    try {
      finalPayload = await encryptE2EPayload(payload, keyRes.publicKey) as unknown as Record<string, unknown>;
    } catch {
      return { ok: false, error: 'Komut şifrelenemedi; güvenlik gereği gönderilmedi.' };
    }
  } else if (apiKey) {
    finalPayload = await encryptPayload(payload, apiKey)
      .then((enc) => enc as unknown as Record<string, unknown>)
      .catch(() => payload as Record<string, unknown>);
  }

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
  if (!evaluateAccountScopedCapability('COMMAND_DISPATCH').allowed) {
    return () => {};
  }
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
