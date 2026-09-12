import { TIMING } from './constants';
import { clamp, lerp } from './utils';
import type { VehicleUpdate, ConnectionStatus } from '@/types/realtime';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface RealtimeCallbacks {
  onUpdate: (update: VehicleUpdate) => void;
  onConnectionChange: (status: ConnectionStatus) => void;
}

/** Neden yeniden abone olundu (gözlem — kişisel veri TAŞIMAZ). */
export type ReconnectReason = 'none' | 'initial' | 'ids_changed' | 'ids_cleared';

/**
 * Salt-okunur abonelik tanısı. Kişisel veri, plaka ya da ham ID TAŞIMAZ —
 * yalnız SAYI, sürüm ve durum. Yeni telemetri çerçevesi kurulmaz; bu alan
 * testlerde ve gerekirse tanı ekranında okunur.
 */
export interface RealtimeSubscriptionDiagnostics {
  readonly generation: number;
  readonly vehicleIdCount: number;
  readonly previousVehicleIdCount: number;
  readonly activeChannelCount: number;
  readonly lastReconnectReason: ReconnectReason;
  readonly lastSubscribeStatus: string | null;
  readonly lastUnsubscribeCount: number;
}

/**
 * Araç ID listesini KANONİK hâle getirir: boş/geçersiz atılır, tekrarlar
 * silinir, sıra deterministik olur → "aynı küme, farklı sıra" GEREKSİZ
 * yeniden abonelik ÜRETMEZ (karşılaştırma sıraya duyarsızdır).
 */
export function normalizeVehicleIds(ids: readonly string[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const raw of Array.isArray(ids) ? ids : []) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (id) out.add(id);
  }
  // Array.from: website tsconfig'inde `target` alanı YOKTUR (varsayılan ES5) →
  // Set spread'i derlenmez. Davranış aynı, tsc temiz.
  return Array.from(out).sort();
}

// ── Abstract base ────────────────────────────────────────────────────────────
export abstract class BaseRealtimeEngine {
  protected cb: RealtimeCallbacks;
  constructor(callbacks: RealtimeCallbacks) { this.cb = callbacks; }
  setVehicleIds(_ids: string[]): void {}
  /**
   * Aktif araç ID kümesini uygular. Küme GERÇEKTEN değişmediyse hiçbir şey
   * yapmaz ve `false` döner (gereksiz reconnect yok). Değiştiyse eski kanalları
   * kapatıp güncel kümeyle yeniden kurar ve `true` döner.
   */
  syncVehicleIds(ids: string[]): boolean {
    this.setVehicleIds(ids);
    return false;
  }
  getSubscriptionDiagnostics(): RealtimeSubscriptionDiagnostics {
    return {
      generation: 0, vehicleIdCount: 0, previousVehicleIdCount: 0,
      activeChannelCount: 0, lastReconnectReason: 'none',
      lastSubscribeStatus: null, lastUnsubscribeCount: 0,
    };
  }
  abstract connect(): void;
  abstract disconnect(): void;
}

// ── Mock simulation ──────────────────────────────────────────────────────────

interface SimVehicle {
  id: string;
  lat: number;
  lng: number;
  speed: number;
  speedTarget: number;
  fuel: number;
  engineTemp: number;
  rpm: number;
  active: boolean;
  bearingRad: number; // rough heading
}

const INITIAL_SIM: SimVehicle[] = [
  { id: '1', lat: 40.9897, lng: 29.0269, speed: 48,  speedTarget: 50,  fuel: 72,  engineTemp: 88,  rpm: 1800, active: true,  bearingRad: 0.4 },
  { id: '2', lat: 41.0426, lng: 29.0054, speed: 0,   speedTarget: 0,   fuel: 45,  engineTemp: 72,  rpm: 0,    active: true,  bearingRad: 1.2 },
  { id: '3', lat: 39.9334, lng: 32.8597, speed: 95,  speedTarget: 98,  fuel: 28,  engineTemp: 105, rpm: 3200, active: true,  bearingRad: 2.7 }, // alarm
  { id: '4', lat: 38.4237, lng: 27.1428, speed: 0,   speedTarget: 0,   fuel: 61,  engineTemp: 20,  rpm: 0,    active: false, bearingRad: 0 },   // offline
  { id: '5', lat: 40.7978, lng: 29.4249, speed: 72,  speedTarget: 70,  fuel: 88,  engineTemp: 87,  rpm: 2100, active: true,  bearingRad: 3.9 },
  { id: '6', lat: 40.1980, lng: 29.0610, speed: 0,   speedTarget: 0,   fuel: 15,  engineTemp: 20,  rpm: 0,    active: false, bearingRad: 0 },   // offline, low fuel
];

const TICK_S = TIMING.MOCK_UPDATE_INTERVAL_MS / 1000;

export class MockRealtimeEngine extends BaseRealtimeEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sim: SimVehicle[] = INITIAL_SIM.map((v) => ({ ...v }));
  private tick = 0;

  connect(): void {
    this.cb.onConnectionChange('connecting');
    setTimeout(() => {
      this.cb.onConnectionChange('connected');
      this.timer = setInterval(() => this.simulate(), TIMING.MOCK_UPDATE_INTERVAL_MS);
    }, 350);
  }

  disconnect(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.cb.onConnectionChange('disconnected');
  }

  private simulate(): void {
    this.tick++;

    // Re-randomize speed targets periodically
    if (this.tick % 10 === 0) {
      this.sim[0].speedTarget = 25 + Math.random() * 50;
      this.sim[1].speedTarget = Math.random() > 0.4 ? 0 : 15 + Math.random() * 20;
      this.sim[2].speedTarget = 88 + Math.random() * 18; // stays in alarm range
      this.sim[4].speedTarget = 55 + Math.random() * 35;
      // drift bearings slightly
      for (const v of this.sim) {
        v.bearingRad += (Math.random() - 0.5) * 0.3;
      }
    }

    for (const v of this.sim) {
      if (!v.active) continue;

      // Speed toward target with noise
      v.speed = clamp(
        lerp(v.speed, v.speedTarget, 0.18) + (Math.random() - 0.5) * 2.5,
        0, 130
      );

      // Move position: speed km/h → degrees per tick (1° lat ≈ 111 km)
      const degPerTick = (v.speed / 111_000) * TICK_S;
      v.lat += Math.cos(v.bearingRad) * degPerTick;
      v.lng += Math.sin(v.bearingRad) * degPerTick;

      // Fuel drains: ~1% per 125 updates (~3 min at 1.5s interval)
      v.fuel = clamp(v.fuel - 0.008, 0, 100);

      // Engine temp follows speed with inertia
      const tempTarget = v.speed > 2 ? 78 + v.speed * 0.36 : 20;
      v.engineTemp = clamp(
        lerp(v.engineTemp, tempTarget, 0.04) + (Math.random() - 0.5) * 0.5,
        18, 130
      );

      // RPM roughly follows speed
      v.rpm = Math.max(0, Math.round(v.speed * 36 + (Math.random() - 0.5) * 300));

      this.cb.onUpdate({
        vehicleId: v.id,
        lat:         +v.lat.toFixed(6),
        lng:         +v.lng.toFixed(6),
        speed:       +v.speed.toFixed(1),
        fuel:        +v.fuel.toFixed(1),
        engineTemp:  +v.engineTemp.toFixed(1),
        rpm:         v.rpm,
        timestamp:   Date.now(),
      });
    }
  }
}

// ── Supabase Realtime engine ─────────────────────────────────────────────────
// Activated automatically when NEXT_PUBLIC_SUPABASE_URL + ANON_KEY are set.
// Subscribes to the broadcast channel 'vehicle-updates' and listens for
// events named 'v:{vehicleId}' that are emitted by /api/vehicle/update.

/* ── Supabase modülü: TEK ve MEMOIZE dinamik import ───────────────────────────
 * ÖNEMLİ (ölçüldü): `connect()` ve `disconnect()` ayrı ayrı `import('@/lib/supabase')`
 * çağırıyordu. Yeniden abone olurken ikisi AYNI TİKTE tetikleniyor ve ikinci
 * `import()` modülün UÇUŞTAKİ (henüz bağlanmamış) namespace'ini çözüyor →
 * `supabaseBrowser` `undefined` geliyor, motor `error` durumuna düşüyor ve
 * YENİ KANALLAR HİÇ KURULMUYORDU. Tek bir promise'i paylaşmak bu yarışı
 * yapısal olarak ortadan kaldırır (ve tekrar eden import maliyetini de siler).
 * Tembel kalır: mock modda supabase-js paketi hâlâ bundle'a girmez. */
let _supabaseModule: Promise<typeof import('@/lib/supabase')> | null = null;
function loadSupabase(): Promise<typeof import('@/lib/supabase')> {
  _supabaseModule ??= import('@/lib/supabase');
  return _supabaseModule;
}

export class SupabaseRealtimeEngine extends BaseRealtimeEngine {
  private channels: RealtimeChannel[] = [];
  private vehicleIds: string[] = [];
  // Zero-leak: prevents connect() promise from completing after disconnect()
  private _alive = false;
  /* ── P1 · KUŞAK (generation) BELİRTECİ ────────────────────────────────────
   * Kusur: araç eklenince kanallar yeniden kuruluyor ama ESKİ kuşağın uçuştaki
   * dinamik import'u ve geç gelen kanal geri çağrıları hâlâ canlıydı → mükerrer
   * kanal, mükerrer olay ve eski durumun yeni durumu EZMESİ mümkündü.
   * Her `connect()` kuşağı artırır; her async devam ve her olay `isCurrent(gen)`
   * kapısından geçer. Küçük ve seri bir yaşam döngüsüdür — durum makinesi DEĞİL. */
  private generation = 0;
  /** Kanalların HANGİ ID kümesiyle kurulduğu (`null` → kurulu değil). */
  private connectedKey: string | null = null;
  private previousIdCount = 0;
  private lastReason: ReconnectReason = 'none';
  private lastSubscribeStatus: string | null = null;
  private lastUnsubscribeCount = 0;

  /** Pass the vehicleIds the current user is subscribed to. */
  override setVehicleIds(ids: string[]) { this.vehicleIds = normalizeVehicleIds(ids); }

  /** Bu kuşak hâlâ güncel mi? Değilse hiçbir yan etki uygulanmaz. */
  private isCurrent(generation: number): boolean {
    return this._alive && generation === this.generation;
  }

  override getSubscriptionDiagnostics(): RealtimeSubscriptionDiagnostics {
    return {
      generation:             this.generation,
      vehicleIdCount:         this.vehicleIds.length,
      previousVehicleIdCount: this.previousIdCount,
      activeChannelCount:     this.channels.length,
      lastReconnectReason:    this.lastReason,
      lastSubscribeStatus:    this.lastSubscribeStatus,
      lastUnsubscribeCount:   this.lastUnsubscribeCount,
    };
  }

  /**
   * TEK GİRİŞ NOKTASI: aktif araç kümesini uygular.
   *  · aynı küme (sıradan bağımsız) → NO-OP, `false`
   *  · küme boş → kanallar kapanır, `true`
   *  · küme değişti → eski kanallar kapanır, güncel filtreyle yeniden kurulur, `true`
   */
  override syncVehicleIds(ids: string[]): boolean {
    const next    = normalizeVehicleIds(ids);
    const nextKey = next.join(',');

    if (this.connectedKey !== null && this.connectedKey === nextKey) return false;

    this.previousIdCount = this.vehicleIds.length;
    this.vehicleIds = next;

    if (next.length === 0) {
      this.lastReason = 'ids_cleared';
      if (this.connectedKey !== null) this.disconnect();
      this.connectedKey = null;
      return true;
    }

    const reason: ReconnectReason = this.connectedKey === null ? 'initial' : 'ids_changed';
    // Eski kuşak burada ölür: kanallar kapatılır, generation artar, geç gelen
    // olaylar `isCurrent` kapısına takılır.
    if (this.connectedKey !== null) this.disconnect();
    this.connect(reason);
    return true;
  }

  connect(reason: ReconnectReason = 'initial'): void {
    const key = this.vehicleIds.join(',');
    /* Mükerrer abonelik kilidi: aynı kümeyle zaten kuruluysa (kanallar henüz
       async gelmemiş olsa bile) ikinci bir kanal çifti AÇILMAZ. */
    if (this._alive && this.connectedKey === key) return;

    this._alive = true;
    this.connectedKey = key;
    this.lastReason = reason;
    const generation = ++this.generation;
    this.cb.onConnectionChange('connecting');

    // Dynamic import avoids pulling supabase-js into mock-mode bundles
    loadSupabase().then(({ supabaseBrowser }) => {
      // Guard: disconnect() / yeni bir kuşak promise çözülmeden önce başlamış olabilir
      if (!this.isCurrent(generation)) return;

      if (!supabaseBrowser) {
        this.cb.onConnectionChange('error');
        return;
      }

      const locationsChannel = supabaseBrowser
        .channel('vehicle-locations')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'vehicle_locations',
            filter: this.vehicleIds.length > 0 ? `vehicle_id=in.(${this.vehicleIds.join(',')})` : undefined,
          },
          ({ new: row }: { new: Record<string, unknown> }) => {
            if (!this.isCurrent(generation)) return;   // eski kuşak / kapalı → yoksay
            this.cb.onUpdate({
              vehicleId: String(row.vehicle_id ?? ''),
              lat: Number(row.lat ?? 0),
              lng: Number(row.lng ?? 0),
              speed: Number.NaN,
              fuel: Number.NaN,
              engineTemp: Number.NaN,
              rpm: Number.NaN,
              timestamp: Date.parse(String(row.created_at ?? new Date().toISOString())),
            });
          },
        )
        .subscribe();

      const telemetryChannel = supabaseBrowser
        .channel('vehicle-telemetry')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'vehicle_telemetry',
            filter: this.vehicleIds.length > 0 ? `vehicle_id=in.(${this.vehicleIds.join(',')})` : undefined,
          },
          ({ new: row }: { new: Record<string, unknown> }) => {
            if (!this.isCurrent(generation)) return;   // eski kuşak / kapalı → yoksay
            this.cb.onUpdate({
              vehicleId: String(row.vehicle_id ?? ''),
              lat: Number.NaN,
              lng: Number.NaN,
              speed: Number(row.speed ?? 0),
              fuel: Number(row.fuel ?? 0),
              engineTemp: Number(row.temp ?? 0),
              rpm: Number(row.rpm ?? 0),
              timestamp: Date.parse(String(row.updated_at ?? new Date().toISOString())),
            });
          },
        )
        .subscribe((status: string) => {
          if (!this.isCurrent(generation)) return;   // eski kuşağın durumu YOKSAYILIR
          this.lastSubscribeStatus = status;
          if (status === 'SUBSCRIBED') this.cb.onConnectionChange('connected');
          if (status === 'CHANNEL_ERROR') this.cb.onConnectionChange('error');
          if (status === 'CLOSED') this.cb.onConnectionChange('disconnected');
        });

      // Son bir kapı: import çözülürken yeni kuşak başladıysa bu kanallar
      // SAHİPSİZDİR — kaydedilmez, derhal kapatılır (sızıntı yok).
      if (!this.isCurrent(generation)) {
        supabaseBrowser.removeChannel(locationsChannel);
        supabaseBrowser.removeChannel(telemetryChannel);
        return;
      }
      this.channels = [locationsChannel, telemetryChannel];
    });
  }

  disconnect(): void {
    this._alive = false;      // blocks any in-flight connect() from completing
    this.generation++;        // uçuştaki tüm eski geri çağrılar burada ölür
    this.connectedKey = null;
    this.lastSubscribeStatus = null;

    if (this.channels.length > 0) {
      const channels = [...this.channels];
      this.channels = [];
      this.lastUnsubscribeCount = channels.length;
      loadSupabase().then(({ supabaseBrowser }) => {
        channels.forEach((channel) => {
          supabaseBrowser?.removeChannel(channel);
        });
      });
    } else {
      this.lastUnsubscribeCount = 0;
    }

    this.cb.onConnectionChange('disconnected');
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────
// Returns SupabaseRealtimeEngine when Supabase env vars are present,
// otherwise falls back to the in-process Mock simulation.

export function createRealtimeEngine(
  callbacks: RealtimeCallbacks,
): BaseRealtimeEngine {
  return new SupabaseRealtimeEngine(callbacks);
}
