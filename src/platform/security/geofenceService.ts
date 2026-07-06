/**
 * geofenceService (Security) — Supabase kaynaklı geofence izleme servisi.
 *
 * Akış:
 *   1. Bağlı araç ID'sini sensitiveKeyStore'dan al
 *   2. Supabase'den vehicle_geofences tablosunu çek
 *   3. Zona listesini Worker'a gönder (updateGeofenceZones)
 *   4. VehicleEventHub'dan GEOFENCE_EXIT / GEOFENCE_ENTER dinle
 *   5. EXIT → useSystemStore.geofenceAlarm set → GeofenceAlarmOverlay tetikler
 *
 * Offline Security:
 *   Zonalar bir kez Worker'a yüklendikten sonra internet kesilse bile
 *   Worker içinde denetim kesintisiz devam eder.
 *
 * Performance:
 *   Worker'daki _checkGeofences() yalnızca speed > 0 iken çalışır.
 */

import { onVehicleEvent, dispatchGeofenceViolation } from '../vehicleDataLayer/VehicleEventHub';
import { updateGeofenceZones }   from '../vehicleDataLayer/index';
import { sensitiveKeyStore }     from '../sensitiveKeyStore';
import { getSupabaseClient }     from '../supabaseClient';
import { connectivityService }   from '../connectivityService';
import { useSystemStore }        from '../../store/useSystemStore';
import { speakAlert }            from '../ttsService';
import { logError }              from '../crashLogger';
import type { WorkerGeofenceZone } from '../vehicleDataLayer/types';
import type { GeofenceZone }       from '../geofenceService';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const RETRY_MS   = 60_000; // Çekme başarısız olursa 1 dk sonra tekrar dene
const SK_API_KEY = 'veh_api_key' as const;

// Yazma yolu doğrudan RPC endpoint'ine connectivityService kuyruğuyla gider
// (at-least-once). Okuma yolu supabase-js .rpc() kullanır (getSupabaseClient).
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const RPC_BASE          = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/rpc` : null;

// ── Modül state ───────────────────────────────────────────────────────────────

let _active       = false;
let _unsubEvent:  (() => void) | null = null;
let _retryTimer:  ReturnType<typeof setTimeout> | null = null;

/** Tanı: son bulut-okuma denemesinin sonucu + son bilinen bölge sayısı. */
export type GeofenceReadState = 'idle' | 'ok' | 'not_paired' | 'schema_missing' | 'error';
let _lastReadState: GeofenceReadState = 'idle';
let _lastZoneCount = 0;

// ── Supabase'den zona çekme ────────────────────────────────────────────────────

interface SupabaseZoneRow {
  id:       string;
  name:     string;
  type:     'polygon' | 'circle';
  polygon?: unknown;   // [[lat, lng], ...]
  center?:  unknown;   // [lat, lng]
  radius_m?: unknown;  // numeric — PostgREST string VEYA number döndürebilir
  is_active?: boolean;
}

async function _fetchZones(apiKey: string): Promise<WorkerGeofenceZone[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  // 🔒 MAHREMİYET: tabloya DOĞRUDAN erişim YOK. anon'a tablo GRANT'i verilmez;
  // okuma SECURITY DEFINER get_geofence_zones RPC'sinden geçer — RPC api_key'i
  // araca çözer ve YALNIZ o aracın kendi bölgelerini döndürür (migration 028).
  const { data, error } = await supabase.rpc('get_geofence_zones', { p_api_key: apiKey });

  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) return [];

  return (data as SupabaseZoneRow[]).map((row) => {
    // radius_m PostgREST'te numeric → string gelebilir; güvenli sayıya çevir
    // (Number.isFinite guard: NaN/null daire yarıçapını sessizce bozmasın —
    // null → Number(null)=0 tuzağını at, undefined bırak).
    const radius = row.radius_m == null ? NaN : Number(row.radius_m);
    return {
      id:      row.id,
      name:    row.name,
      type:    row.type,
      polygon: Array.isArray(row.polygon) ? (row.polygon as [number, number][]) : undefined,
      center:  Array.isArray(row.center)  ? (row.center  as [number, number])   : undefined,
      radiusM: Number.isFinite(radius) ? radius : undefined,
    };
  });
}

// ── İhlal işleyicisi ──────────────────────────────────────────────────────────

function _onGeofenceExit(zoneId: string, zoneName: string, ts: number): void {
  // VIOLATION önce dispatch edilir → App.tsx listener alarm'ı set eder (birincil yol)
  dispatchGeofenceViolation(zoneId, zoneName);
  // Güvenlik ağı: dispatch sırasında alarm set edilmediyse burada set edilir (idempotent)
  useSystemStore.getState().setGeofenceAlarm({ zoneId, zoneName, ts });
  // speakAlert kendi duckMedia/unduckMedia döngüsünü yönetir — ayrıca çağırmak gerekmez
  speakAlert('Güvenli bölge dışına çıkıldı');
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startGeofenceService(): Promise<() => void> {
  if (_active) return stopGeofenceService;
  _active = true;

  // VehicleEventHub aboneliği
  _unsubEvent = onVehicleEvent((e) => {
    if (!_active) return;
    if (e.type === 'GEOFENCE_EXIT') {
      _onGeofenceExit(e.zoneId, e.zoneName, e.ts);
    }
    // GEOFENCE_ENTER: şimdilik sadece logla (opsiyonel bildirim)
  });

  // Zona yükle
  await _loadAndPushZones();

  return stopGeofenceService;
}

async function _loadAndPushZones(): Promise<void> {
  if (!_active) return;
  try {
    const apiKey = await sensitiveKeyStore.get(SK_API_KEY);
    if (!apiKey) { _lastReadState = 'not_paired'; return; } // Cihaz eşli değil → bulut okuma yok (yerel yine çalışır)

    const zones = await _fetchZones(apiKey);
    updateGeofenceZones(zones);
    _lastReadState = 'ok';
    _lastZoneCount = zones.length;
  } catch (e) {
    logError('geofenceService:_loadAndPushZones', e);
    // Kalıcı ŞEMA hatası (tablo/şema yok) → RETRY ETME. 60sn'de bir sonsuza dek
    // denemek ağ + log israfı; eksik tablo kendiliğinden gelmez (SAHA 2026-07-06:
    // vehicle_geofences tablosu deploy edilmemiş → PGRST205 her dakika tekrar
    // düşüyordu). PostgREST PGRST205 (şema cache'de tablo yok) / PGRST202 (fonksiyon
    // yok) / Postgres 42P01 (undefined_table). Servis canlı kalır (ihlal event'i
    // dinlenir); yalnız beyhude zone-çekme döngüsü durur. Tablo sonradan gelirse
    // yeniden başlatma yeniden dener.
    const code = (e && typeof e === 'object' && 'code' in e)
      ? String((e as { code?: unknown }).code) : '';
    const permanentSchemaError = code === 'PGRST205' || code === 'PGRST202' || code === '42P01';
    _lastReadState = permanentSchemaError ? 'schema_missing' : 'error';
    if (!permanentSchemaError && _active) {
      _retryTimer = setTimeout(() => {
        _retryTimer = null;
        void _loadAndPushZones();
      }, RETRY_MS);
    }
  }
}

export function stopGeofenceService(): void {
  if (!_active) return;
  _active = false;
  _unsubEvent?.(); _unsubEvent = null;
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
  // Worker'a boş liste gönder → geofence deaktif
  updateGeofenceZones([]);
}

/**
 * Zona listesini harici olarak güncelle (yerel ayarlardan, ör: SecuritySuite).
 * Internet bağlantısı olmasa bile çağrılabilir.
 */
export function pushLocalZones(zones: WorkerGeofenceZone[]): void {
  updateGeofenceZones(zones);
}

/**
 * Tanı: son bulut-okuma denemesinin sonucu + son bilinen bölge sayısı +
 * bulut senkronu env'de aktif mi (RPC_BASE + ANON_KEY var mı). Koordinat/VIN
 * gibi PII YOK — yalnız durum/sayı.
 */
export function getGeofenceStatus(): { readState: GeofenceReadState; zoneCount: number; cloudSync: boolean } {
  return {
    readState: _lastReadState,
    zoneCount: _lastZoneCount,
    cloudSync: !!(RPC_BASE && SUPABASE_ANON_KEY),
  };
}

// ── Yazma yolu — head unit yukarı senkronlar ────────────────────────────────────

/**
 * Yerel GeofenceZone'u bulut şemasına dönüştürür (client-side normalize).
 * RPC ne alırsa aynen saklar → dönüşüm burada yapılır:
 *   center {lat,lng} → [lat,lng] (okuma yolu WorkerGeofenceZone dizi bekler)
 *   radiusKm → radius_m (× 1000)
 */
function _toCloudZone(zone: GeofenceZone): Record<string, unknown> {
  return {
    id:       zone.id,
    name:     zone.name,
    type:     zone.type,
    polygon:  zone.polygon ?? null,
    center:   zone.center ? [zone.center.lat, zone.center.lng] : null,
    radius_m: typeof zone.radiusKm === 'number' ? zone.radiusKm * 1000 : null,
    is_active: true,
  };
}

/**
 * Sürücünün tanımladığı bölgeyi buluta senkronlar (upsert, at-least-once).
 * Fail-soft: eşli değilse (veh_api_key yok) veya Supabase env yoksa sessiz
 * no-op — yerel geofence yine çalışır. connectivityService offline'da kuyruğa
 * alır, çevrimiçi olunca gönderir.
 */
export async function pushZoneToCloud(zone: GeofenceZone): Promise<void> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) return; // Supabase env yok → no-op
  const apiKey = await sensitiveKeyStore.get(SK_API_KEY);
  if (!apiKey) return;                          // Eşli değil → yerel yeterli

  await connectivityService.enqueue(
    `${RPC_BASE}/push_geofence_zone`,
    'POST',
    { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    { p_api_key: apiKey, p_zone: _toCloudZone(zone) },
    'normal',
    'telemetry',
  );
}

/**
 * Bölgeyi bulutta soft-delete eder (is_active=false). Fail-soft: eşli
 * değilse/env yoksa no-op.
 */
export async function deleteZoneFromCloud(zoneId: string): Promise<void> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) return;
  const apiKey = await sensitiveKeyStore.get(SK_API_KEY);
  if (!apiKey) return;

  await connectivityService.enqueue(
    `${RPC_BASE}/delete_geofence_zone`,
    'POST',
    { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    { p_api_key: apiKey, p_zone_id: zoneId },
    'normal',
    'telemetry',
  );
}
