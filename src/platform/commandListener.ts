/**
 * commandListener.ts — Launcher Realtime Komut Dinleyici
 *
 * Automotive Grade:
 * - Zero-Leak: _alive flag ile async connect/disconnect race önlenir
 * - Idempotency: executedNonces set ile aynı komut iki kez çalışmaz
 * - TTL Guard: 5 dakikadan eski komutları reddeder
 * - Tehlikeli komut koruması: sürüş sırasında lock reddi
 * - Offline recovery: bağlantı kopunca 3s bekleyip yeniden bağlanır
 */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { nativeCoreService } from './nativeCoreService';
import { buildNavIntent } from '../../website/src/lib/routeEngine';

// ── Supabase client (launcher kendi session ile auth yapar) ──────────────────

async function getSupabase() {
  const { supabaseBrowser } = await import('./supabaseClient');
  return supabaseBrowser;
}

// ── Tipler ────────────────────────────────────────────────────────────────────

export type CommandType =
  | 'lock' | 'unlock' | 'horn' | 'alarm_on' | 'alarm_off'
  | 'lights_on' | 'route_send' | 'navigation_start' | 'theme_change';

interface VehicleCommand {
  id:         string;
  vehicle_id: string;
  type:       CommandType;
  payload:    Record<string, unknown>;
  status:     string;
  nonce:      string;
  ttl:        string;
  created_at: string;
}

// ── Tehlikeli komut koruması ──────────────────────────────────────────────────

const DANGEROUS_WHILE_MOVING: CommandType[] = ['lock', 'unlock'];
const SPEED_THRESHOLD_KMH = 5; // bu hızın üstünde kapı açma/kapatma reddi

let currentSpeedKmh = 0;
export function updateCurrentSpeed(speedKmh: number): void {
  currentSpeedKmh = speedKmh;
}

function isDangerousWhileMoving(type: CommandType): boolean {
  return DANGEROUS_WHILE_MOVING.includes(type) && currentSpeedKmh > SPEED_THRESHOLD_KMH;
}

// ── Executor — komut → Android Intent / Native API ───────────────────────────

async function executeCommand(cmd: VehicleCommand): Promise<'completed' | 'rejected' | 'failed'> {
  const payload = cmd.payload as Record<string, unknown>;

  // Tehlikeli komut kontrolü
  if (isDangerousWhileMoving(cmd.type)) {
    console.warn(`[CommandListener] ${cmd.type} sürüş sırasında reddedildi (${currentSpeedKmh} km/h)`);
    return 'rejected';
  }

  try {
    switch (cmd.type) {
      case 'lock':
        await nativeCoreService.lockDoors?.();
        return 'completed';

      case 'unlock':
        await nativeCoreService.unlockDoors?.();
        return 'completed';

      case 'horn':
        await nativeCoreService.honkHorn?.();
        return 'completed';

      case 'alarm_on':
        await nativeCoreService.triggerAlarm?.();
        return 'completed';

      case 'alarm_off':
        await nativeCoreService.stopAlarm?.();
        return 'completed';

      case 'lights_on':
        await nativeCoreService.flashLights?.();
        return 'completed';

      case 'route_send':
      case 'navigation_start': {
        const route = (payload.route ?? payload) as {
          lat: number; lng: number;
          address_name?: string;
          provider_intent?: string;
        };
        const lat  = Number(route.lat);
        const lng  = Number(route.lng);
        const addr = route.address_name ?? '';
        const prov = (route.provider_intent ?? 'google_maps') as
          'google_maps' | 'yandex' | 'waze' | 'apple_maps';

        // Koordinat sınır kontrolü (Sensor Resiliency)
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
            !Number.isFinite(lng) || lng < -180 || lng > 180) {
          console.error('[CommandListener] Geçersiz koordinat:', lat, lng);
          return 'failed';
        }

        const intentUri = buildNavIntent(lat, lng, addr, prov);

        if (Capacitor.isNativePlatform()) {
          await App.openUrl({ url: intentUri });
        } else {
          // Web/dev modu
          window.open(intentUri, '_blank');
        }
        return 'completed';
      }

      case 'theme_change': {
        const theme = String(payload.theme ?? 'dark');
        const themeVars = payload.themeVars as Record<string, string> | undefined;
        // Tema motoru entegrasyonu
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
        console.warn('[CommandListener] Bilinmeyen komut tipi:', cmd.type);
        return 'rejected';
    }
  } catch (err) {
    console.error('[CommandListener] Execute hatası:', err);
    return 'failed';
  }
}

// ── Durum güncelleme ─────────────────────────────────────────────────────────

async function updateCommandStatus(
  commandId: string,
  status: 'accepted' | 'executing' | 'completed' | 'failed' | 'rejected',
): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) return;

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status, updated_at: now };

  if (status === 'accepted')                                        updates.accepted_at = now;
  if (status === 'executing')                                       updates.executed_at = now;
  if (status === 'completed' || status === 'failed' || status === 'rejected') updates.finished_at = now;

  const { error } = await supabase
    .from('vehicle_commands')
    .update(updates)
    .eq('id', commandId);
  if (error) console.error('[CommandListener] Status güncelleme hatası:', error.message);
}

// ── Ana Listener Sınıfı ───────────────────────────────────────────────────────

export class CommandListener {
  private vehicleId:      string;
  private _alive =        false;
  private channel:        ReturnType<Awaited<ReturnType<typeof getSupabase>>['channel']> | null = null;
  private executedNonces: Set<string> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(vehicleId: string) {
    this.vehicleId = vehicleId;
  }

  async connect(): Promise<void> {
    this._alive = true;
    const supabase = await getSupabase();
    if (!supabase || !this._alive) return;

    // Başlangıçta bekleyen komutları işle (offline recovery)
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
          void this.handleCommand(row as VehicleCommand);
        },
      )
      .subscribe((status: string) => {
        if (!this._alive) return;
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          // Zero-leak recovery: 3s bekleyip yeniden bağlan
          this.scheduleReconnect();
        }
      });
  }

  disconnect(): void {
    this._alive = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.channel) {
      const ch = this.channel;
      this.channel = null;
      getSupabase().then((sb) => sb?.removeChannel(ch));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this._alive) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this._alive) {
        await this.connect();
      }
    }, 3_000);
  }

  // Offline recovery: araç internete girince pending komutları yakala
  private async processPendingCommands(
    supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>,
  ): Promise<void> {
    const { data: cmds } = await supabase
      .from('vehicle_commands')
      .select('*')
      .eq('vehicle_id', this.vehicleId)
      .eq('status', 'pending')
      .gt('ttl', new Date().toISOString()) // sadece TTL geçmemiş olanlar
      .order('created_at', { ascending: true })
      .limit(10);

    for (const cmd of cmds ?? []) {
      if (!this._alive) break;
      await this.handleCommand(cmd as VehicleCommand);
    }
  }

  private async handleCommand(cmd: VehicleCommand): Promise<void> {
    // 1. TTL kontrolü
    if (new Date(cmd.ttl) < new Date()) {
      await updateCommandStatus(cmd.id, 'failed');
      return;
    }

    // 2. Idempotency — aynı nonce tekrar işlenmez
    if (this.executedNonces.has(cmd.nonce)) {
      console.log('[CommandListener] Tekrarlayan nonce atlandı:', cmd.nonce);
      return;
    }
    this.executedNonces.add(cmd.nonce);

    // Nonce set'i çok büyümesin (max 500 kayıt)
    if (this.executedNonces.size > 500) {
      const first = this.executedNonces.values().next().value;
      this.executedNonces.delete(first);
    }

    // 3. Kabul et
    await updateCommandStatus(cmd.id, 'accepted');

    // 4. Yürüt
    await updateCommandStatus(cmd.id, 'executing');
    const outcome = await executeCommand(cmd);

    // 5. Sonuç
    await updateCommandStatus(cmd.id, outcome);
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
