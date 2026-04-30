/**
 * commandListener.ts — Launcher Realtime Komut Dinleyici
 *
 * Automotive Grade:
 * - Zero-Leak:        _alive flag ile async connect/disconnect race önlenir
 * - Idempotency:      executedIds (command ID bazlı) ile aynı komut iki kez çalışmaz
 * - TTL Guard:        5 dakikadan eski komutları reddeder
 * - Retry + Backoff:  max 3 retry, exponential backoff (1s → 2s → 4s)
 * - Tehlikeli komut:  sürüş sırasında lock/unlock reddi (>5 km/h)
 * - Offline recovery: reconnect'te pending komutları FIFO sırayla işler
 * - Push notify:      tamamlanan komutlar için Edge Function tetiklenir
 */

import {
  isE2EPayload, decryptE2EPayload, getCarPrivateKey, loadOrCreateDeviceKey,
  isEncryptedPayload, decryptPayload,
} from './commandCrypto';
import { sensitiveKeyStore }                       from './sensitiveKeyStore';
import { connectivityService }                     from './connectivityService';
import { executeMcuCommand }                       from './nativeCommandBridge';

// Lazy imports — native modüller sadece runtime'da yüklenir
let _buildNavIntent:  typeof import('../../website/src/lib/routeEngine').buildNavIntent | null = null;

async function getBuildNavIntent() {
  if (!_buildNavIntent) _buildNavIntent = (await import('../../website/src/lib/routeEngine')).buildNavIntent;
  return _buildNavIntent;
}

// ── Supabase client — statik import (dynamic import INEFFECTIVE_DYNAMIC_IMPORT uyarısını tetikler)
// remoteCommandService ve weatherService zaten statik import yaptığı için
// bu modül de aynı chunk'a düşmeli.
import { getSupabaseClient } from './supabaseClient';

function getSupabase() {
  return getSupabaseClient();
}

// ── Sabitler ─────────────────────────────────────────────────────────────────

const MAX_RETRY         = 3;
const RECONNECT_DELAY   = 3_000;   // ms — bağlantı kopunca bekleme
const PUSH_EDGE_FN_URL  = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-notify`
  : null;

// ── Tipler ────────────────────────────────────────────────────────────────────

export type CommandType =
  | 'lock' | 'unlock' | 'horn' | 'alarm_on' | 'alarm_off'
  | 'lights_on' | 'route_send' | 'navigation_start' | 'theme_change';

interface VehicleCommand {
  id:              string;
  vehicle_id:      string;
  type:            CommandType;
  payload:         Record<string, unknown>;
  status:          string;
  nonce:           string;
  ttl:             string;
  created_at:      string;
  retry_count?:    number;
  last_attempt_at?: string | null;
  error_reason?:   string | null;
}

// ── Tehlikeli komut koruması ──────────────────────────────────────────────────

const DANGEROUS_WHILE_MOVING: CommandType[] = ['lock', 'unlock'];
const SPEED_THRESHOLD_KMH = 5;

let currentSpeedKmh = 0;
export function updateCurrentSpeed(speedKmh: number): void {
  currentSpeedKmh = speedKmh;
}

function isDangerousWhileMoving(type: CommandType): boolean {
  return DANGEROUS_WHILE_MOVING.includes(type) && currentSpeedKmh > SPEED_THRESHOLD_KMH;
}

// ── Executor ─────────────────────────────────────────────────────────────────

async function executeCommand(
  cmd: VehicleCommand,
): Promise<'completed' | 'rejected' | 'failed' | 'crypto_failed'> {
  let payload = cmd.payload;

  // ── E2E (ECDH) deşifreleme — yeni yol, önce kontrol edilir ──────────────────
  if (isE2EPayload(payload)) {
    const privKey = getCarPrivateKey();
    if (!privKey) {
      // Anahtar henüz yüklenmemiş — bu kritik bir başlangıç sorunudur
      console.error('[CmdListener] E2E private key yüklenmemiş; komut reddedildi.');
      return 'crypto_failed';
    }
    try {
      payload = await decryptE2EPayload(payload, privKey);
    } catch (err) {
      // Zero-Plaintext: hata mesajını logla, komutu ASLA icra etme
      const reason = err instanceof Error ? err.message : 'Decryption Error';
      console.error(`[CmdListener] E2E deşifreleme başarısız: ${reason}`);
      return 'crypto_failed';
    }

  // ── Legacy PBKDF2 deşifreleme — geriye dönük uyumluluk ──────────────────────
  } else if (isEncryptedPayload(payload)) {
    try {
      const apiKey = await sensitiveKeyStore.get('veh_api_key');
      if (apiKey) {
        payload = await decryptPayload(
          payload as unknown as import('./commandCrypto').EncryptedPayload,
          apiKey,
        );
      } else {
        console.warn('[CmdListener] Şifreli payload alındı fakat api_key bulunamadı.');
        return 'rejected';
      }
    } catch (err) {
      console.error('[CmdListener] PBKDF2 deşifreleme başarısız:', err);
      return 'failed';
    }
  }

  if (isDangerousWhileMoving(cmd.type)) {
    console.warn(`[CmdListener] ${cmd.type} sürüş sırasında reddedildi (${currentSpeedKmh} km/h)`);
    return 'rejected';
  }

  try {
    switch (cmd.type) {
      case 'lock':
      case 'unlock':
      case 'horn':
      case 'alarm_on':
      case 'alarm_off':
      case 'lights_on':
        // H-4: nativeCommandBridge → CarLauncherPlugin → McuCommandFactory → CAN bus
        return await executeMcuCommand(cmd.type);

      case 'route_send':
      case 'navigation_start': {
        const route = (payload.route ?? payload) as {
          lat: number; lng: number;
          address_name?: string;
          provider_intent?: string;
        };
        const lat  = Number(route.lat);
        const lng  = Number(route.lng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
            !Number.isFinite(lng) || lng < -180 || lng > 180) {
          console.error('[CmdListener] Geçersiz koordinat:', lat, lng);
          return 'failed';
        }
        const buildNav = await getBuildNavIntent();
        const intentUri = buildNav(lat, lng, route.address_name ?? '',
          (route.provider_intent ?? 'google_maps') as 'google_maps' | 'yandex' | 'waze' | 'apple_maps');
        // Android'de intent URI'yi window.open ile aç
        window.open(intentUri, '_blank');
        return 'completed';
      }

      case 'theme_change': {
        const theme     = String(payload.theme ?? 'dark');
        const themeVars = payload.themeVars as Record<string, string> | undefined;
        document.documentElement.setAttribute('data-theme', theme);
        if (themeVars && typeof themeVars === 'object') {
          Object.entries(themeVars).forEach(([k, v]) => {
            document.documentElement.style.setProperty(k, String(v));
          });
        }
        localStorage.setItem('theme', theme);
        return 'completed';
      }

      default:
        console.warn('[CmdListener] Bilinmeyen komut tipi:', cmd.type);
        return 'rejected';
    }
  } catch (err) {
    console.error('[CmdListener] Execute hatası:', err);
    return 'failed';
  }
}

// ── Durum güncelleme ─────────────────────────────────────────────────────────

async function updateCommandStatus(
  commandId:   string,
  status:      'accepted' | 'executing' | 'completed' | 'failed' | 'rejected',
  errorReason?: string,
): Promise<void> {
  const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
  const SUPABASE_ANON    = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!SUPABASE_URL || !SUPABASE_ANON) return;

  const now     = new Date().toISOString();
  const updates: Record<string, unknown> = { status };
  if (status === 'accepted')  updates.accepted_at = now;
  if (status === 'executing') updates.last_attempt_at = now;
  if (['completed', 'failed', 'rejected'].includes(status)) updates.finished_at = now;
  if (errorReason) updates.error_reason = errorReason;

  // Komut durumu kritik — kuyruğa al, at-least-once garantisi
  await connectivityService.enqueue(
    `${SUPABASE_URL}/rest/v1/vehicle_commands?id=eq.${commandId}`,
    'PATCH',
    {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
      'Prefer':        'return=minimal',
    },
    updates,
    'high',
    'cmd_status',
  );
}

// ── Retry increment (RPC üzerinden — atomik) ─────────────────────────────────

async function incrementRetry(commandId: string, errorReason: string): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) return;
  // increment_command_retry RPC: retry_count artırır, max 3'te failed'a çeker
  await supabase.rpc('increment_command_retry', {
    p_command_id: commandId,
    p_error:      errorReason,
  });
}

// ── Push bildirim — Edge Function tetikle ────────────────────────────────────

async function triggerPushNotify(
  event:     string,
  vehicleId: string,
  payload:   Record<string, unknown>,
): Promise<void> {
  if (!PUSH_EDGE_FN_URL) return;
  try {
    await fetch(PUSH_EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event, vehicleId, payload }),
    });
  } catch { /* fire-and-forget — bildirim hatası ana akışı etkilemez */ }
}

// ── Ana Listener Sınıfı ───────────────────────────────────────────────────────

export class CommandListener {
  private vehicleId:      string;
  private _alive =        false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private channel:        any = null;
  private executedIds:    Set<string> = new Set(); // ID bazlı dedup (nonce değil)
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimers:    Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(vehicleId: string) {
    this.vehicleId = vehicleId;
  }

  async connect(): Promise<void> {
    this._alive = true;
    const supabase = await getSupabase();
    if (!supabase || !this._alive) return;

    // ── E2E Anahtar Init + Supabase'e Public Key Yayını ─────────────────────
    // loadOrCreateDeviceKey RAM'i önbelleğe alır; ilk çağrı ~10–20ms, sonraki <1 μs.
    // Bağlantı kurulmadan önce anahtar hazır olmalı — komutlar gelmeden önce init tam olsun.
    try {
      const { pubKeyB64 } = await loadOrCreateDeviceKey();
      // vehicles tablosuna e2e_public_key yaz — telefon bu key ile şifreler
      await supabase
        .from('vehicles')
        .upsert({
          id:             this.vehicleId,
          e2e_public_key: pubKeyB64,
          e2e_key_alg:    'ECDH-P256-AES-GCM-256',
        });
    } catch (e) {
      // Non-fatal: anahtar publish başarısız olursa eski key ile devam
      console.warn('[CmdListener] E2E public key publish başarısız:', e);
    }

    // Reconnect'te bekleyen + retry-eligible komutları işle
    await this.processPendingCommands(supabase);

    this.channel = supabase
      .channel(`vehicle-cmds:${this.vehicleId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'vehicle_commands',
          filter: `vehicle_id=eq.${this.vehicleId}`,
        },
        ({ new: row }: { new: Record<string, unknown> }) => {
          if (!this._alive) return;
          void this.handleCommand(row as unknown as VehicleCommand);
        },
      )
      .subscribe((status: string) => {
        if (!this._alive) return;
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          this.scheduleReconnect();
        }
      });
  }

  /**
   * Bekleyen komutları DB'den anlık çeker — Realtime gap koruması için.
   * Push-to-Wake sinyali geldiğinde, listener zaten canlıyken çağrılır.
   */
  async triggerPendingPoll(): Promise<void> {
    if (!this._alive) return;
    const supabase = await getSupabase();
    if (!supabase) return;
    await this.processPendingCommands(supabase);
  }

  disconnect(): void {
    this._alive = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Bekleyen retry timer'ları temizle
    this.retryTimers.forEach((t) => clearTimeout(t));
    this.retryTimers.clear();

    if (this.channel) {
      const ch = this.channel;
      this.channel = null;
      getSupabase()?.removeChannel(ch);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this._alive) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this._alive) await this.connect();
    }, RECONNECT_DELAY);
  }

  // ── Offline recovery ────────────────────────────────────────────────────────
  // Bağlantı kurulunca:
  //   1. TTL'i geçmemiş pending komutları çek
  //   2. retry_count < MAX_RETRY olanları dahil et
  //   3. FIFO sırayla işle

  private async processPendingCommands(
    supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>,
  ): Promise<void> {
    const now = new Date().toISOString();

    const { data: cmds } = await supabase
      .from('vehicle_commands')
      .select('*')
      .eq('vehicle_id', this.vehicleId)
      .eq('status', 'pending')
      .gt('ttl', now)                         // TTL geçmemiş
      .lt('retry_count', MAX_RETRY)           // max retry aşılmamış
      .order('created_at', { ascending: true })
      .limit(10);

    for (const cmd of cmds ?? []) {
      if (!this._alive) break;
      // ID dedup: zaten bu session'da işlenmiş olanları atla
      if (this.executedIds.has(cmd.id as string)) continue;
      await this.handleCommand(cmd as unknown as VehicleCommand);
    }
  }

  // ── Komut işleyici ──────────────────────────────────────────────────────────

  private async handleCommand(cmd: VehicleCommand): Promise<void> {
    // 1. TTL kontrolü
    if (cmd.ttl && new Date(cmd.ttl) < new Date()) {
      await updateCommandStatus(cmd.id, 'failed', 'TTL aşıldı');
      return;
    }

    // 2. Idempotency — aynı komut ID'si bu session'da tekrar işlenmez
    if (this.executedIds.has(cmd.id)) return;
    this.executedIds.add(cmd.id);

    // Set büyümesin (max 500 kayıt)
    if (this.executedIds.size > 500) {
      const first = this.executedIds.values().next().value;
      if (first) this.executedIds.delete(first);
    }

    // 3. Kabul et → yürüt
    await updateCommandStatus(cmd.id, 'accepted');
    await updateCommandStatus(cmd.id, 'executing');

    const outcome = await executeCommand(cmd);

    if (outcome === 'completed') {
      await updateCommandStatus(cmd.id, 'completed');
      // Push bildirim: komut tamamlandı
      void triggerPushNotify('command_completed', cmd.vehicle_id, {
        command_id:    cmd.id,
        command_label: cmd.type,
      });
      return;
    }

    if (outcome === 'rejected') {
      // Güvenlik reddi — retry yok
      await updateCommandStatus(cmd.id, 'rejected', 'Sürüş güvenliği: komut reddedildi');
      return;
    }

    if (outcome === 'crypto_failed') {
      // E2E deşifreleme hatası — retry yok, komut kalıcı olarak geçersiz
      await updateCommandStatus(cmd.id, 'failed', 'Decryption Error: komut reddedildi');
      return;
    }

    // 'failed' — retry değerlendirmesi
    const retryCount = cmd.retry_count ?? 0;

    if (retryCount < MAX_RETRY) {
      // Exponential backoff: 2^retry saniye (1s, 2s, 4s)
      const backoffMs = Math.pow(2, retryCount) * 1_000;
      console.log(`[CmdListener] Retry ${retryCount + 1}/${MAX_RETRY} — ${backoffMs}ms sonra: ${cmd.id}`);

      // DB'yi güncelle (retry_count++ ve status pending kalır)
      await incrementRetry(cmd.id, `Attempt ${retryCount + 1} failed`);

      // ID dedup'tan çıkar — bir sonraki retry'da tekrar işlenebilsin
      this.executedIds.delete(cmd.id);

      // Timer ile retry — araç online'sa bu session'da dene
      const timer = setTimeout(async () => {
        this.retryTimers.delete(cmd.id);
        if (!this._alive) return;
        // Güncel cmd'yi DB'den çek (retry_count güncellenmiş olabilir)
        const supabase = await getSupabase();
        if (!supabase) return;
        const { data } = await supabase
          .from('vehicle_commands')
          .select('*')
          .eq('id', cmd.id)
          .eq('status', 'pending')
          .single();
        if (data) await this.handleCommand(data as unknown as VehicleCommand);
      }, backoffMs);

      this.retryTimers.set(cmd.id, timer);
    } else {
      // Max retry aşıldı → kalıcı failed
      await updateCommandStatus(cmd.id, 'failed', `${MAX_RETRY} denemede başarısız`);
      void triggerPushNotify('command_failed', cmd.vehicle_id, {
        command_id:   cmd.id,
        error_reason: `${MAX_RETRY} denemede başarısız`,
      });
    }
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let _instance: CommandListener | null = null;

export function startCommandListener(vehicleId: string): () => void {
  stopCommandListener();
  _instance = new CommandListener(vehicleId);
  void _instance.connect();
  return stopCommandListener;
}

export function stopCommandListener(): void {
  _instance?.disconnect();
  _instance = null;
}

/** Listener canlı mı? pushService wake kararı için. */
export function isCommandListenerActive(): boolean {
  return _instance !== null;
}

/**
 * Aktif listener üzerinde DB poll'u anında tetikler.
 * Push-to-Wake: listener canlıysa Realtime gap'ını kapatmak için çağrılır.
 */
export function triggerPendingPoll(): void {
  void _instance?.triggerPendingPoll();
}
