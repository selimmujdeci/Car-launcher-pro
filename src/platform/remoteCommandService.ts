/**
 * remoteCommandService — Supabase Realtime üzerinden PWA → araç komut kanalı.
 *
 * Tunnel-Proof Command Engine (Spec §3 Resiliency):
 *
 * TTL (Time-To-Live):
 *   Her komut satırında isteğe bağlı `ttl_ms` alanı bulunur (varsayılan 30s).
 *   `now - created_at > ttl_ms` ise komut "expired" olarak reddedilir.
 *   Tünelden çıkınca 10dk önceki korna komutunun çalmasını engeller.
 *
 * Critical Retry Queue:
 *   LOCK / UNLOCK gibi kritik komutlar çevrimdışıyken RetryQueue'ya alınır.
 *   Bağlantı geldiğinde (online event) TTL kontrolüyle sırayla yürütülür.
 *   Queue safeStorage'a persist edilir → uygulama yeniden başlasa da kaybolmaz.
 *
 * Status Phases (RECEIVED → EXECUTING → COMPLETED/EXPIRED/FAILED):
 *   received  : komut araca ulaştı, TTL geçerliyse işleme alındı
 *   executing : executeIntent() başladı
 *   completed : başarıyla tamamlandı
 *   expired   : TTL doldu, çalıştırılmadı
 *   queued    : çevrimdışı kritik komut — bağlantıda işlenecek
 *   failed    : yürütme hatası
 *   rejected  : güvenlik reddi
 *
 * Zero-Leak (CLAUDE.md §1):
 *   stopRemoteCommands() her zaman channel.unsubscribe() + online listener temizler.
 *
 * Data Integrity (CLAUDE.md §4):
 *   Tüm durum geçişleri connectivityService.enqueue ile at-least-once garantili.
 */

import type { RealtimeChannel }               from '@supabase/supabase-js';
import { getSupabaseClient }                   from './supabaseClient';
import { getVehicleIdentity }                  from './vehicleIdentityService';
import { updateRemoteCommandStatus,
         pushVehicleEvent }                    from './vehicleIdentityService';
import { sensitiveKeyStore }                   from './sensitiveKeyStore';
import { fromAIResponse }                      from './intentEngine';
import { executeIntent }                       from './commandExecutor';
import type { CommandContext }                  from './commandExecutor';
import { applyVars }                           from './liveStyleEngine';
import { safeGetRaw, safeSetRaw }              from '../utils/safeStorage';

// ── TTL Sabitleri ─────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 60_000; // 60 saniye — güvenlik kritik (park/şehir içi senaryo)

/**
 * Komut satırının TTL değerini döner.
 * DB satırında `ttl_ms` varsa kullanılır; yoksa 30s varsayılan.
 */
function _ttlMs(row: Record<string, unknown>): number {
  const t = row['ttl_ms'];
  return typeof t === 'number' && t > 0 ? t : DEFAULT_TTL_MS;
}

/** Komutun created_at'ten itibaren geçen ms */
function _ageMs(row: Record<string, unknown>): number {
  const createdAt = row['created_at'] as string | undefined;
  if (!createdAt) return 0;
  return Date.now() - new Date(createdAt).getTime();
}

/** TTL aşıldı mı? */
function _isExpired(row: Record<string, unknown>): boolean {
  return _ageMs(row) > _ttlMs(row);
}

// ── Hardware ACK (Acknowledge) Mekanizması ────────────────────────────────
//
// Fiziksel donanım komutları (kapı kilidi, CAN bus) için iki aşamalı onay:
//   1. executeIntent() çağrısı → komutu native plugin'e iletir
//   2. Native CAN bus handler → acknowledgeCommand(id) çağırır → 'completed'
//
// ACK_TIMEOUT_MS içinde yanıt gelmezse → 'failed' (ack_timeout).
// Araç bağlantısı kesilirse timeout tetiklenir; telefon "başarısız" görür.
//
// Native entegrasyon: CarLauncherPlugin'deki CAN bus geri bildirimi
//   carPlugin.addListener('hardwareAck', ({ commandId }) => acknowledgeCommand(commandId));

const ACK_TIMEOUT_MS = 10_000; // 10 saniye — CAN bus yanıt bekleme süresi

/** Donanım onayı gerektiren komut tipleri (kapı kilidi, CAN bus kritik) */
const COMMANDS_REQUIRING_ACK = new Set([
  'lock', 'unlock',
  'hw_lock_doors', 'hw_unlock_doors',
  'HARDWARE_LOCK', 'HARDWARE_UNLOCK',
]);

interface PendingAck {
  timer:   ReturnType<typeof setTimeout>;
  resolve: (acked: boolean) => void;
}
/** commandId → bekleyen ACK kaydı */
const _pendingAcks = new Map<string, PendingAck>();

/**
 * Donanım ACK'ını teslim al — native CAN bus handler tarafından çağrılır.
 * Zamanında gelirse komutu 'completed' olarak işaretler; yoksa timeout tetikler.
 */
export function acknowledgeCommand(commandId: string): void {
  const pending = _pendingAcks.get(commandId);
  if (!pending) return; // zaten tamamlandı veya timeout oldu
  clearTimeout(pending.timer);
  _pendingAcks.delete(commandId);
  pending.resolve(true);
}

/**
 * ACK zaman aşımını manuel tetikle (test veya native bridge kopması için).
 * Normal akışta acknowledgeCommand çağrılmazsa ACK_TIMEOUT_MS sonra otomatik tetikler.
 */
export function timeoutCommandAck(commandId: string): void {
  const pending = _pendingAcks.get(commandId);
  if (!pending) return;
  clearTimeout(pending.timer);
  _pendingAcks.delete(commandId);
  pending.resolve(false);
}

/** ACK bekle — timeout → false, zamanında → true */
function _awaitHardwareAck(commandId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      _pendingAcks.delete(commandId);
      resolve(false); // timeout — donanım yanıt vermedi
    }, ACK_TIMEOUT_MS);
    _pendingAcks.set(commandId, { timer, resolve });
  });
}

// ── Critical Retry Queue ──────────────────────────────────────────────────

/**
 * Kritik komut tipleri — internet yokken kuyruğa alınır.
 * Semantik yükler (lock/unlock), DB type alanı adları ve AppIntent tipleri.
 */
const CRITICAL_TYPES = new Set([
  'lock', 'unlock',
  'hw_lock_doors', 'hw_unlock_doors',
  'HARDWARE_LOCK', 'HARDWARE_UNLOCK',
]);

const QUEUE_STORAGE_KEY = 'cmd-retry-queue-v1';
const QUEUE_MAX         = 50; // memory overflow koruması

interface RetryEntry {
  row:     Record<string, unknown>;
  savedAt: number; // Date.now() — eviction için
}

/** Queue'yu safeStorage'dan yükle; expired entry'leri at. */
function _loadQueue(): RetryEntry[] {
  try {
    const raw = safeGetRaw(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RetryEntry[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => !_isExpired(e.row));
  } catch { return []; }
}

function _saveQueue(q: RetryEntry[]): void {
  try { safeSetRaw(QUEUE_STORAGE_KEY, JSON.stringify(q)); } catch { /* quota */ }
}

let _retryQueue: RetryEntry[] = _loadQueue();

function _enqueueRetry(row: Record<string, unknown>): void {
  if (_retryQueue.length >= QUEUE_MAX) {
    // En eski (veya zaten expired) entry'yi çıkar
    _retryQueue.shift();
  }
  _retryQueue.push({ row, savedAt: Date.now() });
  _saveQueue(_retryQueue);
}

function _dequeueAll(): RetryEntry[] {
  const snapshot = [..._retryQueue];
  _retryQueue = [];
  _saveQueue([]);
  return snapshot;
}

/** Çevrimdışı kritik komutları bağlantı gelince yürüt. */
async function _drainRetryQueue(): Promise<void> {
  if (!_active) return;
  const entries = _dequeueAll();
  if (entries.length === 0) return;

  if (import.meta.env.DEV) {
    console.log(`[RemoteCommand] Draining ${entries.length} queued command(s)`);
  }

  for (const entry of entries) {
    if (_isExpired(entry.row)) {
      // TTL doldu — bildir ve at
      const id = entry.row['id'] as string | undefined;
      if (id) await updateRemoteCommandStatus(id, 'expired').catch(() => {});
    } else {
      await _processCommand(entry.row, /* fromQueue */ true).catch(() => {});
    }
  }
}

// ── Deferred UI context ───────────────────────────────────────────────────

const _ctxRef: { current: CommandContext | null } = { current: null };

export function setRemoteCommandContext(ctx: CommandContext): void {
  _ctxRef.current = ctx;
}

// ── Core dispatcher ───────────────────────────────────────────────────────

async function _processCommand(
  row: Record<string, unknown>,
  fromQueue = false,
): Promise<void> {
  const commandId = row['id']     as string | undefined;
  const status    = row['status'] as string | undefined;

  if (!commandId) return;

  // Idempotent guard — yalnızca pending/queued komutları işle
  if (!fromQueue && status !== 'pending') return;

  // ── Phase 1: RECEIVED ACK — komut araca ulaştı ──────────────────────────
  await updateRemoteCommandStatus(commandId, 'received');

  // TTL kontrolü — expired ise çalıştırma
  if (_isExpired(row)) {
    await updateRemoteCommandStatus(commandId, 'expired');
    if (import.meta.env.DEV) {
      console.warn(`[RemoteCommand] Expired (${_ageMs(row)}ms > ${_ttlMs(row)}ms):`, commandId);
    }
    return;
  }

  // SET_STYLE: CSS custom property live sync — context gerekmez, kritik değil
  const rowType = row['type'] as string | undefined;
  if (rowType === 'set_style') {
    const vars = (row['payload'] as Record<string, unknown> | undefined)?.['vars'];
    if (vars && typeof vars === 'object') {
      applyVars(vars as Record<string, string>);
    }
    await updateRemoteCommandStatus(commandId, 'completed');
    return;
  }

  // ── Critical command + çevrimdışı → RetryQueue ──────────────────────────
  const intentType = row['intent'] as string | undefined;
  const isCritical = CRITICAL_TYPES.has(rowType ?? '') || CRITICAL_TYPES.has(intentType ?? '');

  if (!navigator.onLine && !fromQueue) {
    if (isCritical) {
      // Kritik komut: TTL içinde bağlantı gelince yeniden denenir
      _enqueueRetry(row);
      await updateRemoteCommandStatus(commandId, 'queued').catch(() => {});
      if (import.meta.env.DEV) {
        console.log(`[RemoteCommand] Queued critical command (offline):`, commandId);
      }
    } else {
      // Kritik olmayan komut: queue'ya alma — süresi dolmuş olabilir, telefonu uyar
      await updateRemoteCommandStatus(commandId, 'failed', 'vehicle_unreachable').catch(() => {});
      await pushVehicleEvent('remote_command_unreachable', {
        commandId,
        reason: 'offline_non_critical',
        ttlMs: _ttlMs(row),
      }).catch(() => {});
      if (import.meta.env.DEV) {
        console.warn(`[RemoteCommand] Ulaşılamıyor (offline, non-critical):`, commandId);
      }
    }
    return;
  }

  const ctx = _ctxRef.current;
  if (!ctx) {
    await updateRemoteCommandStatus(commandId, 'failed', 'CommandContext not ready');
    return;
  }

  const intent = fromAIResponse(row, (row['intent'] as string | undefined) ?? 'Remote Command');

  if (!intent) {
    await updateRemoteCommandStatus(commandId, 'failed', 'Unknown intent');
    await pushVehicleEvent('remote_command_rejected', { commandId, row });
    return;
  }

  // ── Phase 2: EXECUTING ACK ───────────────────────────────────────────────
  await updateRemoteCommandStatus(commandId, 'executing');

  // Uzaktan komut bayrağı — commandExecutor güvenlik bariyerlerini bu flag'e göre tetikler
  const remoteCtx: CommandContext = { ...ctx, isRemote: true };
  const requiresAck = COMMANDS_REQUIRING_ACK.has(rowType ?? '') ||
                      COMMANDS_REQUIRING_ACK.has(intentType ?? '');

  try {
    await executeIntent(intent, remoteCtx);

    if (requiresAck) {
      // ── Phase 2b: PENDING_ACK — donanımdan onay bekle ─────────────────
      // Status 'executing' olarak kalır; ACK gelince veya timeout'ta sonuçlanır.
      // Telefon 'executing' görürken araç CAN bus yanıtı bekler.
      if (import.meta.env.DEV) {
        console.log(`[RemoteCommand] Awaiting hardware ACK (${ACK_TIMEOUT_MS / 1000}s):`, commandId);
      }
      const acked = await _awaitHardwareAck(commandId);
      if (!acked) {
        // Donanım zamanında yanıt vermedi — telefona başarısız bildir
        const timeoutMsg = 'Hardware ACK timeout — donanım yanıt vermedi';
        await updateRemoteCommandStatus(commandId, 'failed', timeoutMsg);
        await pushVehicleEvent('remote_command_error', { commandId, error: timeoutMsg });
        return;
      }
    }

    // ── Phase 3: COMPLETED — hem intent hem ACK (varsa) onaylandı ─────────
    await updateRemoteCommandStatus(commandId, 'completed');
    await pushVehicleEvent('remote_command_completed', {
      commandId,
      intent: intentType ?? 'unknown',
      fromQueue,
      ackRequired: requiresAck,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // SafetyReject → 'rejected' statüsü; diğer hatalar → 'failed'
    const finalStatus = msg.startsWith('SafetyReject') ? 'rejected' : 'failed';
    _pendingAcks.get(commandId)?.resolve(false); // Bekleyen ACK varsa iptal et
    _pendingAcks.delete(commandId);
    await updateRemoteCommandStatus(commandId, finalStatus, msg);
    await pushVehicleEvent('remote_command_error', { commandId, error: msg, status: finalStatus });
  }
}

// ── Module state ──────────────────────────────────────────────────────────

let _active:  boolean         = false;
let _channel: RealtimeChannel | null = null;
let _onlineHandler: (() => void) | null = null;

// ── "Ulaşılamıyor" — Çevrimdışı Komut Fetch ──────────────────────────────
//
// Araç çevrimdışıyken telefon `vehicle_commands` tablosuna komut ekler.
// Supabase Realtime o sırada araçta bağlı olmadığı için INSERT eventi teslim edilmez.
// Araç tekrar bağlandığında (SUBSCRIBED) 'pending' komutları DB'den çeker;
//   TTL geçerliyse işler, süresi dolmuşsa 'expired' olarak işaretler.
// Telefon 'expired' statüsünü okuyunca "Ulaşılamıyor" uyarısını gösterir.

async function _fetchMissedCommands(): Promise<void> {
  if (!_active) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const identity = await getVehicleIdentity();
  if (!identity) return;

  // Yalnızca TTL penceresi içindeki pending komutları getir
  const cutoff = new Date(Date.now() - DEFAULT_TTL_MS).toISOString();
  const { data } = await supabase
    .from('vehicle_commands')
    .select('*')
    .eq('vehicle_id', identity.vehicleId)
    .eq('status', 'pending')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(20); // memory overflow koruması

  if (!data?.length) return;

  if (import.meta.env.DEV) {
    console.log(`[RemoteCommand] Fetching ${data.length} missed command(s) after reconnect`);
  }

  for (const row of data) {
    await _processCommand(row as Record<string, unknown>).catch(() => {});
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export async function startRemoteCommands(): Promise<void> {
  if (_active) return;

  const supabase = getSupabaseClient();
  if (!supabase) return;

  const identity = await getVehicleIdentity();
  if (!identity) return;

  const apiKey = await sensitiveKeyStore.get('veh_api_key' as const);
  if (!apiKey) return;

  _active = true;

  // Online event → retry queue'yu boşalt + kaçırılan komutları fetch et
  _onlineHandler = () => {
    void _drainRetryQueue();
    void _fetchMissedCommands();
  };
  window.addEventListener('online', _onlineHandler);

  // Başlangıçta online ise queue'yu hemen boşalt (restart recovery)
  if (navigator.onLine && _retryQueue.length > 0) {
    setTimeout(() => { void _drainRetryQueue(); }, 500);
  }

  _channel = supabase
    .channel(`remote-commands:${identity.vehicleId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'vehicle_commands',
        filter: `vehicle_id=eq.${identity.vehicleId}`,
      },
      (evt) => {
        if (!_active) return;
        const row = evt.new as Record<string, unknown>;
        _processCommand(row).catch(() => {});
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (import.meta.env.DEV) {
          console.log('[RemoteCommand] Subscribed — TTL:', DEFAULT_TTL_MS / 1000, 's');
        }
        // Bağlantı yeniden kuruldu — offline dönemde gelen komutları işle
        void _fetchMissedCommands();
      }
    });
}

export function stopRemoteCommands(): void {
  _active = false;

  if (_onlineHandler) {
    window.removeEventListener('online', _onlineHandler);
    _onlineHandler = null;
  }
  if (_channel) {
    _channel.unsubscribe();
    _channel = null;
  }
  _ctxRef.current = null;
  // RetryQueue kalıcı — stop sonrasında persist edilmeye devam eder
}
