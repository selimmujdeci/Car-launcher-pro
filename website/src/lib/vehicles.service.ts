import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { formatLastSeen } from '@/lib/utils';
import { TIMING } from '@/lib/constants';
import { buildVehicleFreshness } from '@/lib/fleet/vehicleTelemetryFreshness';
import type { VehicleIdentityRow } from '@/lib/fleet/vehicleIdentityView';
import type { TripRow } from '@/lib/fleet/vehicleTripsView';
import type { PresenceHistoryRow } from '@/lib/fleet/driverPresenceHistoryView';
import type { LiveVehicle } from '@/types/realtime';

interface VehicleRow {
  id: string;
  plate: string | null;
  name: string | null;
  driver_name: string | null;
  odometer_km: number | null;
  company_id: string;
}

interface LocationRow {
  vehicle_id: string;
  lat: number;
  lng: number;
  created_at: string;
}

interface TelemetryRow {
  vehicle_id: string;
  speed: number | null;
  fuel: number | null;
  temp: number | null;
  rpm: number | null;
  updated_at: string;
  /* 042 ile eklenen tazelik/kaynak alanları — eski satırlarda null olabilir. */
  observed_at?: string | null;
  received_at?: string | null;
  gps_observed_at?: string | null;
  obd_observed_at?: string | null;
  health_observed_at?: string | null;
  accuracy_m?: number | null;
  telemetry_source?: string | null;
  location_source?: string | null;
}

/**
 * 042 kolonları henüz uygulanmamış ortamlarda PostgREST `42703` döndürür.
 * O durumda ESKİ kolon kümesine düşülür — ama tazelik alanları `null` kalır,
 * yani UI "canlı" İDDİA ETMEZ (dürüst düşüş).
 */
const TELEMETRY_COLUMNS_V2 =
  'vehicle_id, speed, fuel, temp, rpm, updated_at, observed_at, received_at, ' +
  'gps_observed_at, obd_observed_at, health_observed_at, accuracy_m, ' +
  'telemetry_source, location_source';
const TELEMETRY_COLUMNS_V1 = 'vehicle_id, speed, fuel, temp, rpm, updated_at';

/**
 * Son okumada 042 tazelik kolonlarının gerçekten okunabildiği.
 * `null` = henüz okuma yapılmadı (uydurma "sağlıklı" YOK).
 */
let _telemetrySchemaV2: boolean | null = null;

/**
 * ARAÇ YOLCULUKLARINI OKU (`list_vehicle_trips`).
 *
 * RPC koordinat/rota DÖNDÜRMEZ (trip tablosunda öyle bir kolon yoktur);
 * `anon` bu RPC'yi çağıramaz (046 REVOKE). Kapsam `owner_id` veya şirket
 * eşleşmesinden gelir.
 *
 * Dönüş `null` = OKUNAMADI (RPC yok / yetki yok / ağ hatası). Bu, "yolculuk
 * yok" ile KARIŞTIRILMAZ — UI ikisini ayrı gösterir.
 */
export async function fetchVehicleTrips(
  vehicleId: string,
  limit = 50,
): Promise<TripRow[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('list_vehicle_trips', {
      p_vehicle_id: vehicleId,
      p_limit: limit,
    });
    /* 046 uygulanmamış ortamda RPC yoktur → "okunamadı" (sahte boşluk YOK). */
    if (error) return null;
    return (data ?? []) as TripRow[];
  } catch {
    return null;
  }
}

/**
 * ARAÇ VARLIK GEÇMİŞİNİ OKU (`list_vehicle_presence_history`).
 *
 * RPC, DOĞRULANMAMIŞ kaynaklı kayıtlarda `driver_id`/`driver_name`
 * alanlarını **NULL** döndürür (050): head unit'ten gelen "ben Ahmet'im"
 * beyanı bir kimlik kanıtı değildir ve tarayıcıya isim olarak GELMEZ.
 * `anon` bu RPC'yi çağıramaz (050 REVOKE).
 *
 * Dönüş `null` = OKUNAMADI (RPC yok / yetki yok / ağ hatası). Bu, "gözlem
 * yok" ile KARIŞTIRILMAZ — UI ikisini ayrı gösterir.
 */
export async function fetchVehiclePresenceHistory(
  vehicleId: string,
  limit = 20,
): Promise<PresenceHistoryRow[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('list_vehicle_presence_history', {
      p_vehicle_id: vehicleId,
      p_limit: limit,
    });
    /* 050 uygulanmamış ortamda RPC yoktur → "okunamadı" (sahte boşluk YOK). */
    if (error) return null;
    return (data ?? []) as PresenceHistoryRow[];
  } catch {
    return null;
  }
}

/**
 * ARAÇ KİMLİK ÖZETİNİ OKU (`list_company_vehicle_identity`).
 *
 * RPC VIN'i **MASKELİ** (son 6 hane) ve parmak izini **kısaltılmış** (ilk 12)
 * döndürür — ham değerler tarayıcıya HİÇ gelmez. `anon` bu RPC'yi
 * çağıramaz (043 REVOKE); yalnız oturumlu kullanıcı okur.
 *
 * Dönüş `null` = OKUNAMADI (RPC yok / yetki yok / ağ hatası). Bu, "kimlik
 * kaydı yok" ile KARIŞTIRILMAZ: UI ikisini ayrı gösterir.
 */
export async function fetchVehicleIdentities(): Promise<Map<string, VehicleIdentityRow> | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('list_company_vehicle_identity');
    /* 043 uygulanmamış ortamda RPC yoktur → "okunamadı" (sahte boşluk YOK). */
    if (error) return null;
    const map = new Map<string, VehicleIdentityRow>();
    for (const row of (data ?? []) as VehicleIdentityRow[]) {
      const id = row.vehicle_id;
      if (typeof id === 'string' && id.length > 0) map.set(id, row);
    }
    return map;
  } catch {
    return null;
  }
}

/** LAB'ın salt-okunur sorması için — gizli veri TAŞIMAZ. */
export function getTelemetrySchemaState(): 'V2_FRESHNESS' | 'V1_LEGACY' | 'UNKNOWN' {
  if (_telemetrySchemaV2 === null) return 'UNKNOWN';
  return _telemetrySchemaV2 ? 'V2_FRESHNESS' : 'V1_LEGACY';
}

export async function fetchVehicles(): Promise<LiveVehicle[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, plate, name, driver_name, odometer_km, company_id')
    .order('created_at', { ascending: false });
  if (vehiclesError) throw new Error(vehiclesError.message ?? 'vehicles sorgusu başarısız');

  const rows = (vehicles ?? []) as VehicleRow[];
  const ids = rows.map((v) => v.id);
  if (ids.length === 0) return [];

  const [{ data: locations, error: locationsError }, telemetryResult] = await Promise.all([
    supabase
      .from('vehicle_locations')
      .select('vehicle_id, lat, lng, created_at')
      .in('vehicle_id', ids)
      .order('created_at', { ascending: false }),
    supabase
      .from('vehicle_telemetry')
      .select(TELEMETRY_COLUMNS_V2)
      .in('vehicle_id', ids),
  ]);

  if (locationsError) throw new Error(locationsError.message ?? 'vehicle_locations sorgusu başarısız');

  /* 042 uygulanmamışsa (bilinmeyen kolon) eski kolon kümesine düş. */
  /* Üretilmiş Supabase tipleri 042 kolonlarını henüz tanımadığı için
     `unknown` üzerinden daraltılır; şekil `TelemetryRow` ile doğrulanır
     (opsiyonel alanlar eksik olabilir — bilinmeyen null kalır). */
  let telemetry = telemetryResult.data as unknown as TelemetryRow[] | null;
  _telemetrySchemaV2 = true;
  if (telemetryResult.error) {
    const code = (telemetryResult.error as { code?: string }).code;
    if (code !== '42703') {
      throw new Error(telemetryResult.error.message ?? 'vehicle_telemetry sorgusu başarısız');
    }
    _telemetrySchemaV2 = false;
    const fallback = await supabase
      .from('vehicle_telemetry')
      .select(TELEMETRY_COLUMNS_V1)
      .in('vehicle_id', ids);
    if (fallback.error) throw new Error(fallback.error.message ?? 'vehicle_telemetry sorgusu başarısız');
    telemetry = fallback.data as unknown as TelemetryRow[] | null;
  }

  const latestLocationByVehicle = new Map<string, LocationRow>();
  for (const location of (locations ?? []) as LocationRow[]) {
    if (!latestLocationByVehicle.has(location.vehicle_id)) {
      latestLocationByVehicle.set(location.vehicle_id, location);
    }
  }

  const latestTelemetryByVehicle = new Map<string, TelemetryRow>();
  for (const event of telemetry ?? []) {
    if (!latestTelemetryByVehicle.has(event.vehicle_id)) {
      latestTelemetryByVehicle.set(event.vehicle_id, event);
    }
  }

  const now = Date.now();

  return rows.map((vehicle): LiveVehicle => {
    const loc = latestLocationByVehicle.get(vehicle.id);
    const tel = latestTelemetryByVehicle.get(vehicle.id);
    const timestamp = new Date(tel?.updated_at ?? loc?.created_at ?? 0).getTime();

    /* GERÇEK KATMANI — bilinmeyen `null` kalır, tazelik/kaynak ayrı taşınır.
       Telemetri satırı hiç yoksa `null` verilir; `readable: true` çünkü
       sorgu BAŞARILI oldu (hata yolunda yukarıda throw edildi) — yani
       "okunamadı" ile "hiç veri yok" karıştırılmaz. */
    const telemetryTruth = buildVehicleFreshness({
      now,
      readable: true,
      row: tel
        ? {
            updatedAt:        tel.updated_at,
            observedAt:       tel.observed_at ?? null,
            receivedAt:       tel.received_at ?? null,
            gpsObservedAt:    tel.gps_observed_at ?? null,
            obdObservedAt:    tel.obd_observed_at ?? null,
            healthObservedAt: tel.health_observed_at ?? null,
            /* Konum `vehicle_locations`'tan gelir; koordinatı oradan taşı. */
            lat: loc?.lat ?? null,
            lng: loc?.lng ?? null,
            accuracyM: tel.accuracy_m ?? null,
            speed: tel.speed, rpm: tel.rpm, temp: tel.temp, fuel: tel.fuel,
            telemetrySource: tel.telemetry_source ?? null,
            locationSource:  tel.location_source ?? null,
          }
        : null,
    });

    return {
      id: vehicle.id,
      /* KİMLİK UYDURULMAZ (#661): plaka boşsa ARAÇ UUID'si plaka diye
         GÖSTERİLİYORDU. Boş kimlik boş kalır; gösterim `vehicleTitle()`
         tek otoritesinden yapılır ve orada "Araç #kısaid" olur. */
      plate: vehicle.plate ?? '',
      name: vehicle.name ?? '',
      driver: vehicle.driver_name ?? '—',
      status: timestamp > 0 && Date.now() - timestamp < TIMING.OFFLINE_TIMEOUT_MS ? 'online' : 'offline',
      /* ⚠️ ESKİ SAYISAL YÜZEY — bilinmeyeni 0 ile doldurur, yalnız harita/
         hesap gibi eski tüketiciler için korunur. KULLANICIYA GÖSTERİLMEZ;
         gösterim `telemetry` alanından yapılır. */
      lat: loc?.lat ?? 0,
      lng: loc?.lng ?? 0,
      speed: tel?.speed ?? 0,
      fuel: tel?.fuel ?? 0,
      engineTemp: tel?.temp ?? 0,
      rpm: tel?.rpm ?? 0,
      odometer: vehicle.odometer_km ?? 0,
      location: '—',
      lastSeen: formatLastSeen(timestamp),
      lastTimestamp: Number.isFinite(timestamp) ? timestamp : 0,
      telemetry: telemetryTruth,
    };
  });
}

/**
 * ARAÇ KİMLİĞİNİ YAZ (plaka / isim / sürücü) — #661.
 *
 * Bu proje daha önce `vehicles` satırının kimlik alanlarına HİÇ yazmıyordu:
 * araç eşleşiyor, panelde UUID görünüyor ve kullanıcının isim verebileceği
 * bir yüzey bulunmuyordu ("motor var, besleyen yok" deseninin bir örneği).
 *
 * Yazma sunucu rotası üzerinden yapılır (`PATCH /api/vehicles/:id`): oturum
 * doğrulaması ve kapsam kontrolü orada tek yerde durur.
 *
 * Dönüş: `{ ok: true }` ya da `{ ok: false, error }` — sessiz başarı YOK.
 */
export async function updateVehicleIdentity(
  vehicleId: string,
  patch: { plate?: string | null; name?: string | null; driver?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { ok: false, error: 'Supabase yapılandırılmamış.' };

  let token: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
  } catch {
    token = null;
  }
  if (!token) return { ok: false, error: 'Oturum bulunamadı. Yeniden giriş yapın.' };

  try {
    const res = await fetch(`/api/vehicles/${vehicleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `Hata ${res.status}: kimlik kaydedilemedi.` };
  } catch {
    return { ok: false, error: 'Bağlantı hatası. İnternet bağlantınızı kontrol edin.' };
  }
}
