/**
 * emblemBoot — amblemli açılışın girdisini kanonik sahiplerden OKUR (projeksiyon).
 *
 * `null` → amblemli açılış yok (ayar kapalı / kimlik bilinmiyor): çağıran
 * varsayılan CarOS Pro açılışını gösterir. Metin yalnız bilinen veriden kurulur;
 * bilinmeyen alan boş bırakılır (sahte değer yok). Hava sıcaklığı yalnız tazeyse.
 */
import { useStore } from '../../store/useStore';
import { getBrand } from '../../platform/vehicle/brandCatalog';
import { onWeatherState, type WeatherState } from '../../platform/weatherService';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { resolveEmblem } from '../vehicle/VehicleEmblem';
import type { EmblemBootInfo } from './BootSplash';

/** Hava sıcaklığı bu süreden eskiyse açılışta gösterilmez. */
export const BOOT_WEATHER_MAX_AGE_MS = 60 * 60_000;

function currentWeather(): WeatherState | null {
  let s: WeatherState | null = null;
  const off = onWeatherState((w) => { s = w; });
  off();
  return s;
}

export function freshTemperature(w: WeatherState | null, nowMs: number): number | null {
  if (!w?.weather || w.lastUpdated === null) return null;
  if (nowMs - w.lastUpdated > BOOT_WEATHER_MAX_AGE_MS) return null;
  return Number.isFinite(w.weather.temperature) ? Math.round(w.weather.temperature) : null;
}

export function buildEmblemBoot(nowMs: number = Date.now()): EmblemBootInfo | null {
  const s = useStore.getState().settings;
  if (s.bootSplashStyle !== 'emblem') return null;
  const vehicle = s.vehicleProfiles.find((p) => p.id === s.activeVehicleProfileId) ?? null;
  const emblem = resolveEmblem(vehicle);
  if (!vehicle || !emblem) return null;

  const driver = (s.driverProfiles ?? []).find((d) => d.id === s.activeDriverProfileId);
  const model = [getBrand(vehicle.brandId)?.name, vehicle.model].filter(Boolean).join(' ');
  const temp = freshTemperature(currentWeather(), nowMs);
  const line = [model || null, temp !== null ? `${temp}°C` : null].filter(Boolean).join(' · ');
  const mode = runtimeManager.getMode();

  return {
    emblem,
    treatment: vehicle.emblemTreatment ?? 'neon',
    driverName: driver?.name?.trim() || undefined,
    line: line || undefined,
    /* Kullanıcı kararı (2026-09-27): açılış sahnesi düşük kademede de TAM oynar
       (~4 sn, yalnız açılışta). Işık tozları yalnız güç koruma/kurtarma modunda kapalı;
       reduced-motion BootSplash'te ayrıca kapatılır. */
    particles: mode !== 'POWER_SAVE' && mode !== 'SAFE_MODE',
  };
}
