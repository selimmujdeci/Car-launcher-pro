/**
 * remoteCommandService — Supabase Realtime üzerinden PWA → araç komut kanalı.
 *
 * Spec §3: vehicle_commands tablosundaki INSERT eventlarını dinler,
 *   fromAIResponse() ile AppIntent'e dönüştürür, commandExecutor ile çalıştırır,
 *   sonucu updateRemoteCommandStatus() ile geri bildirir.
 *
 * Zero-Leak (CLAUDE.md §1):
 *   stopRemoteCommands() her zaman channel.unsubscribe() çağırır.
 *   _active flag çift başlatmayı önler.
 *
 * Sensor Resiliency (CLAUDE.md §2):
 *   Stale guard: created_at > 5 dk geçmiş komutlar sessizce drop edilir.
 *   Context yoksa komut 'failed' olarak işaretlenir — sessiz drop yok.
 *
 * Data Integrity (CLAUDE.md §4):
 *   Komut başarı/hata durumu updateRemoteCommandStatus() ile kaydedilir.
 *   Hata logları pushVehicleEvent() ile cloud'a iletilir.
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

const SK_API_KEY         = 'veh_api_key' as const;
const STALE_THRESHOLD_MS = 5 * 60 * 1_000; // 5 dakika

/* ── Deferred UI context (useRef semantiği — stale closure önlenir) ──── */

// Ref benzeri kapsayıcı: her zaman güncel ctx'e işaret eder
const _ctxRef: { current: CommandContext | null } = { current: null };

/**
 * UI katmanı (App.tsx / MainLayout) CommandContext hazır olduğunda çağırır.
 * startRemoteCommands'dan önce veya sonra çağrılabilir.
 */
export function setRemoteCommandContext(ctx: CommandContext): void {
  _ctxRef.current = ctx;
}

/* ── Stale command guard (Spec §5 Data Integrity) ──────────────────── */

function _isStale(createdAt: string | undefined): boolean {
  if (!createdAt) return false;
  return Date.now() - new Date(createdAt).getTime() > STALE_THRESHOLD_MS;
}

/* ── Core dispatcher ─────────────────────────────────────────────────── */

async function _processCommand(row: Record<string, unknown>): Promise<void> {
  const commandId  = row['id']         as string | undefined;
  const createdAt  = row['created_at'] as string | undefined;
  const status     = row['status']     as string | undefined;

  if (!commandId) return;

  // Yalnızca pending komutları işle — idempotent guard
  if (status !== 'pending') return;

  // Stale komut koruması (Spec §5)
  if (_isStale(createdAt)) {
    await updateRemoteCommandStatus(commandId, 'failed');
    return;
  }

  // SET_STYLE: CSS custom property live sync — context gerekmez
  const rowType = row['type'] as string | undefined;
  if (rowType === 'set_style') {
    const payload = row['payload'] as Record<string, unknown> | undefined;
    const vars = payload?.['vars'] as Record<string, string> | undefined;
    if (vars && typeof vars === 'object') {
      applyVars(vars);
    }
    await updateRemoteCommandStatus(commandId, 'completed');
    return;
  }

  // ── Faz 1: Kabul ACK — komut alındı, işleme başlıyor ────────────────────
  // "Komut alındı" bilgisi PWA ekranında anlık gösterilir.
  await updateRemoteCommandStatus(commandId, 'accepted');

  const ctx = _ctxRef.current;
  if (!ctx) {
    await updateRemoteCommandStatus(commandId, 'failed', 'CommandContext not ready');
    return;
  }

  // Spec §3.3: fromAIResponse ile AppIntent'e dönüştür
  const intent = fromAIResponse(row, (row['intent'] as string | undefined) ?? 'Remote Command');

  if (!intent) {
    await updateRemoteCommandStatus(commandId, 'failed', 'Unknown intent');
    await pushVehicleEvent('remote_command_rejected', { commandId, row });
    return;
  }

  // ── Faz 2: Executing ACK — native intent çağrısı başlıyor ────────────────
  // PWA "yürütülüyor…" spinner'ı gösterebilir.
  await updateRemoteCommandStatus(commandId, 'executing');

  try {
    // ── Faz 3: executeIntent bekle → gerçek sonuç ────────────────────────
    // NOT: Önceki implementasyon 'executed' ACK'i executeIntent'i beklemeden
    // gönderiyordu ("fire-and-forget" anti-pattern). Bu sürümde AWAIT yapılır;
    // PWA yalnızca gerçek yürütme tamamlandığında 'completed' görür.
    await executeIntent(intent, ctx);

    // ── Faz 3a: Başarı ACK ────────────────────────────────────────────────
    await updateRemoteCommandStatus(commandId, 'completed');
    await pushVehicleEvent('remote_command_completed', {
      commandId,
      intent: (row['intent'] as string | undefined) ?? 'unknown',
    });
  } catch (err) {
    // ── Faz 3b: Hata ACK — somut hata mesajıyla ──────────────────────────
    const msg = err instanceof Error ? err.message : String(err);
    await updateRemoteCommandStatus(commandId, 'failed', msg);
    await pushVehicleEvent('remote_command_error', { commandId, error: msg });
  }
}

/* ── Module state ────────────────────────────────────────────────────── */

let _active:  boolean          = false;
let _channel: RealtimeChannel  | null = null;

/* ── Public API ──────────────────────────────────────────────────────── */

/**
 * Supabase Realtime kanalını açar, vehicle_commands INSERT'lerini dinler.
 * Demo modunda (VITE_SUPABASE_URL yok) veya vehicleId eksikse sessizce çıkar.
 * Çift çağrı güvenli.
 */
export async function startRemoteCommands(): Promise<void> {
  if (_active) return;

  const supabase = getSupabaseClient();
  if (!supabase) return; // demo mod

  const identity = await getVehicleIdentity();
  if (!identity) return;

  // api_key yoksa Realtime bağlantısını açma — güvenlik garantisi
  const apiKey = await sensitiveKeyStore.get(SK_API_KEY);
  if (!apiKey) return;

  _active = true;

  // Spec §3.2: vehicle_commands INSERT filtresi
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
        if (!_active) return; // race condition — stop sonrası gelen event
        const row = evt.new as Record<string, unknown>;
        _processCommand(row).catch(() => {});
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (import.meta.env.DEV) console.log('[RemoteCommand] Subscribed to Remote Commands');
      }
    });
}

/**
 * Realtime kanalını kapatır, tüm referansları sıfırlar.
 * startVehicleDataLayer cleanup zincirinde çağrılır.
 * Spec §4 Phase 3 Memory Management.
 */
export function stopRemoteCommands(): void {
  _active = false;
  if (_channel) {
    _channel.unsubscribe();
    _channel = null;
  }
  _ctxRef.current = null;
}
