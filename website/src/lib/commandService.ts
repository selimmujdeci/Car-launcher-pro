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
import { supabaseBrowser, isSupabaseConfigured, ensurePwaSession } from './supabase';
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

/* ── PIN: SUNUCU DOĞRULAR (MRI N-2/N-3, migration 083) ───────────────────────
   Eski model: istemci SHA-256(PIN) üretip `p_pin_hash` gönderiyor, sunucu hash'i
   hash'le karşılaştırıyordu (pass-the-hash) — üstelik PIN yalnız localStorage'da
   olduğu için sunucuda hiç kayıtlı değildi ve `critical_auth_verified: true`
   istemci iddiası trigger'ı geçiyordu. Artık ham PIN TLS içinde
   `verify_and_send_critical_command(p_pin)`e gider; sunucu bcrypt doğrular,
   komutu AYNI transaction'da yaratır. İstemci hiçbir güvenlik kararı yazmaz. */

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
  /**
   * true: araç çevrimdışı; komut satırı `COMMAND_TTL_MS` boyunca sunucuda bekler.
   * Araç bu süre içinde yoklama yaparsa komutu alır; süre dolarsa sunucu satırı
   * bir daha VERMEZ (`fetch_pending_vehicle_commands` `ttl > now()`), telefon
   * `EXPIRED` görür. Araç tarafı da aynı 5 dk'yı kabul eder (MRI N-7:
   * `src/platform/commandCrypto.COMMAND_VALIDITY_WINDOW_MS`).
   */
  queued?:    boolean;
  error?:     string;
  code?:      'ACCOUNT_CLEANUP_LOCKDOWN' | 'SECURITY_RUNTIME_UNAVAILABLE';
}

/**
 * Komutun ürünce vaat edilen geçerlilik süresi — `vehicle_commands.ttl`.
 * Araç tarafındaki kripto kabul penceresiyle (`COMMAND_VALIDITY_WINDOW_MS`)
 * BİREBİR aynı olmak ZORUNDADIR; iki sayı ayrışırsa "sıraya alındı" yalan olur.
 */
export const COMMAND_TTL_MS = 5 * 60_000;
export const COMMAND_TTL_MINUTES = COMMAND_TTL_MS / 60_000;

export interface SendCommandOptions {
  requireCriticalAuth?: boolean;
  /**
   * Ham PIN (4–8 rakam). Kritik komutlarda ZORUNLU: sunucu doğrular
   * (`verify_and_send_critical_command`). Sunucuda PIN kayıtlı değilse bu
   * PIN `set_vehicle_pin` ile kaydedilir ve komut yeniden gönderilir.
   */
  pin?: string;
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
  /* ── OTURUM ZORUNLU (F1, 2026-09-17) ────────────────────────────────────
     `ensurePwaSession` ARTIK oturum AÇMAZ; yalnız var olanı okur. Giriş
     Google ile yapılır ve PWA kapısı (`app/(pwa)/kumanda`) zaten oturumsuz
     kullanıcıyı buraya kadar getirmez — bu kontrol ikinci savunma hattıdır.

     P0-001A: oturumsuz (api_key) komut yolu KAPATILDI — gerekçe yukarıda.
     Eskiden burada "API anahtarı bulunamadı. Aracı yeniden eşleştirin."
     deniyordu; bu YANLIŞ TEŞHİSTİ — yeniden eşleştirmek anahtar üretmez
     (kanonik rota anahtar döndürmez), kullanıcı sonsuz döngüye giriyordu.
     Komut kullanıcı JWT'siyle gider; ham anahtar hiçbir yerde dönmez. */
  const token = await ensurePwaSession();
  if (!token) {
    return {
      ok: false,
      error: 'Oturum başlatılamadı — bağlantınızı kontrol edip tekrar deneyin.',
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
  const ttl   = new Date(Date.now() + COMMAND_TTL_MS).toISOString();

  // Kritik komut: TEK KAPI = sunucu tarafı PIN doğrulaması (083). Doğrudan
  // INSERT kritik komut için yapısal olarak reddedilir (trigger, sunucu kanıtı).
  if (isCriticalCommand(type)) {
    if (!options.pin) return { ok: false, error: 'Kritik komut için PIN gerekli.' };
    const res = await sendCriticalViaServer(vehicleId, type, finalPayload, options.pin, nonce, ttl);
    if (!res.ok) return res;
    return { ok: true, commandId: res.commandId, queued: !online };
  }

  const { data, error } = await supabaseBrowser
    .from('vehicle_commands')
    .insert({
      vehicle_id: vehicleId,
      created_by: (await supabaseBrowser.auth.getUser()).data.user?.id,
      type,
      payload:    finalPayload,
      nonce,
      ttl,
      /* `critical_auth_verified` GÖNDERİLMEZ: sunucu yazar (istemci iddiası değil). */
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  // Push-to-Wake: aracı sessizce uyandır (fire-and-forget)
  void triggerPushWake(vehicleId, data.id);

  return { ok: true, commandId: data.id, queued: !online };
}

// ── Kritik komut: sunucu PIN kapısı ──────────────────────────────────────────

interface CriticalRpcResult { ok: boolean; command_id?: string; error?: string }

const CRITICAL_ERROR_TEXT: Record<string, string> = {
  pin_not_set:     'Araç için PIN kayıtlı değil.',
  pin_locked:      'Çok fazla yanlış PIN — 15 dakika sonra tekrar deneyin.',
  pin_mismatch:    'Mevcut PIN yanlış.',
  unauthenticated: 'Oturum gerekli.',
};

function criticalErrorText(code: string | undefined): string {
  if (!code) return 'PIN doğrulaması başarısız.';
  return CRITICAL_ERROR_TEXT[code] ?? code;
}

/**
 * Sunucuda PIN doğrula + komutu yarat (tek transaction). Sunucu `pin_not_set`
 * derse — araçta HİÇ PIN kayıtlı değil (eski PWA PIN'i yalnız telefonda
 * tutuyordu) — girilen PIN `set_vehicle_pin` ile kaydedilir ve komut BİR KEZ
 * yeniden denenir. Sahip olmayan eşleşmiş kullanıcı mevcut PIN'i bilmeden
 * PIN değiştiremez; bu istemcide çözülmez, sunucu reddeder.
 */
async function sendCriticalViaServer(
  vehicleId: string,
  type:      CommandType,
  payload:   Record<string, unknown>,
  pin:       string,
  nonce:     string,
  ttl:       string,
): Promise<{ ok: true; commandId?: string } | { ok: false; error: string }> {
  if (!supabaseBrowser) return { ok: false, error: 'Supabase yapılandırması eksik.' };
  const call = async (): Promise<CriticalRpcResult | { rpcError: string }> => {
    const { data, error } = await supabaseBrowser!.rpc('verify_and_send_critical_command', {
      p_vehicle_id: vehicleId,
      p_type:       type,
      p_payload:    payload,
      p_pin:        pin,
      p_nonce:      nonce,
      p_ttl:        ttl,
    });
    if (error) return { rpcError: error.message };
    return data as CriticalRpcResult;
  };

  let res = await call();
  if ('rpcError' in res) return { ok: false, error: res.rpcError };

  if (!res.ok && res.error === 'pin_not_set') {
    const { data: setData, error: setErr } = await supabaseBrowser.rpc('set_vehicle_pin', {
      p_vehicle_id: vehicleId,
      p_pin:        pin,
    });
    if (setErr) return { ok: false, error: setErr.message };
    const setRes = setData as { ok: boolean; error?: string };
    if (!setRes.ok) return { ok: false, error: criticalErrorText(setRes.error) };
    markCriticalPinEnrolled();
    res = await call();
    if ('rpcError' in res) return { ok: false, error: res.rpcError };
  }

  if (!res.ok) return { ok: false, error: criticalErrorText(res.error) };
  markCriticalPinEnrolled();
  return { ok: true, commandId: res.command_id };
}

/** Yalnız UX ipucu ("PIN belirleyin" vs "PIN girin") — güvenlik otoritesi DEĞİL. */
export const CRITICAL_PIN_ENROLLED_KEY = 'caros_critical_pin_enrolled';
function markCriticalPinEnrolled(): void {
  try { localStorage.setItem(CRITICAL_PIN_ENROLLED_KEY, '1'); } catch { /* quota */ }
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
