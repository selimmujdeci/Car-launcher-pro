/**
 * Context Engine — GPS/OBD/zaman tabanlı bağlam-farkındı öneri sistemi.
 *
 * Tamamen yerel çalışır, ağ isteği yapmaz.
 *
 * Bağlam kaynakları:
 *   - GPS konum → ev/iş konumlarına mesafe (Haversine)
 *   - OBD → yakıt seviyesi, motor ısısı
 *   - Saat → sabah/öğle/akşam/gece
 *
 * Öneri türleri:
 *   engine-warning   (öncelik 100) — motor ısısı > 105°C
 *   fuel-warning     (öncelik 85)  — yakıt < %20
 *   route-work       (öncelik 60)  — sabah, evde/dışarıda, işe git
 *   route-home       (öncelik 60)  — akşam, işte/dışarıda, eve git
 */
import { useState, useEffect, useRef } from 'react';
import type { GPSLocation } from './gpsService';
import { onOBDData } from './obdService';
import type { AppSettings, MaintenanceInfo } from '../store/useStore';
import { computeReminders } from './vehicleReminderService';

/* ── Yardımcılar ─────────────────────────────────────────── */

/** Haversine mesafesi — iki koordinat arası km cinsinden. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Türler ──────────────────────────────────────────────── */

export type LocationCtx = 'home' | 'work' | 'near-home' | 'near-work' | 'away';
export type TimeCtx     = 'morning' | 'afternoon' | 'evening' | 'night';

export type CtxSuggestionKind =
  | 'route-home'
  | 'route-work'
  | 'fuel-warning'
  | 'engine-warning'
  | 'maintenance-warning';

export type CtxAction =
  | { type: 'navigate'; destination: 'home' | 'work' }
  | { type: 'open-drawer'; drawer: string }
  | { type: 'launch'; appId: string };

export interface CtxSuggestion {
  id:         string;
  kind:       CtxSuggestionKind;
  title:      string;
  subtitle:   string;
  /** Tailwind border-color CSS değeri — renk kodlaması için */
  color:      string;
  /** 0–100, yüksek = daha acil */
  priority:   number;
  action:     CtxAction;
  confidence: number;
}

export interface ContextState {
  suggestions: CtxSuggestion[];
  locationCtx: LocationCtx;
  timeCtx:     TimeCtx;
}

/* ── Sabitler ────────────────────────────────────────────── */

const AT_RADIUS_KM   = 0.15; // 150 m → "konumda"
const NEAR_RADIUS_KM = 2.0;  // 2 km  → "yakınında"

/* ── Konum bağlamı ───────────────────────────────────────── */

function getLocationCtx(
  location: GPSLocation | null,
  home:     { lat: number; lng: number } | null,
  work:     { lat: number; lng: number } | null,
): LocationCtx {
  if (!location) return 'away';
  const { latitude: lat, longitude: lon } = location;

  if (home) {
    const d = haversineKm(lat, lon, home.lat, home.lng);
    if (d < AT_RADIUS_KM)   return 'home';
    if (d < NEAR_RADIUS_KM) return 'near-home';
  }
  if (work) {
    const d = haversineKm(lat, lon, work.lat, work.lng);
    if (d < AT_RADIUS_KM)   return 'work';
    if (d < NEAR_RADIUS_KM) return 'near-work';
  }
  return 'away';
}

/* ── Zaman bağlamı ───────────────────────────────────────── */

function getTimeCtx(): TimeCtx {
  const h = new Date().getHours();
  if (h >= 6  && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

/* ── OBD anlık görüntüsü ─────────────────────────────────── */

interface OBDSnapshot {
  fuelLevel:  number;
  engineTemp: number;
  connected:  boolean;
}

/* ── Karar motoru ────────────────────────────────────────── */

function buildSuggestions(
  locationCtx:  LocationCtx,
  timeCtx:      TimeCtx,
  obd:          OBDSnapshot,
  hasHome:      boolean,
  hasWork:      boolean,
  isMoving:     boolean,
  maintenance?: MaintenanceInfo,
): CtxSuggestion[] {
  const out: CtxSuggestion[] = [];

  /* Güvenlik uyarıları — araç hareketinden bağımsız ─────── */

  if (obd.connected && obd.engineTemp > 105) {
    out.push({
      id:         'engine-warning',
      kind:       'engine-warning',
      title:      'Motor Isısı Yüksek',
      subtitle:   `${Math.round(obd.engineTemp)}°C — Güvenli bir yere çekin`,
      color:      '#ef4444',
      priority:   100,
      action:     { type: 'open-drawer', drawer: 'dtc' },
      confidence: 1.0,
    });
  }

  if (obd.connected && obd.fuelLevel >= 0 && obd.fuelLevel < 20) {
    out.push({
      id:         'fuel-warning',
      kind:       'fuel-warning',
      title:      'Yakıt Azalıyor',
      subtitle:   `%${Math.round(obd.fuelLevel)} kaldı — En yakın istasyona gidin`,
      color:      '#f59e0b',
      priority:   85,
      action:     { type: 'launch', appId: 'maps' },
      confidence: 1.0,
    });
  }

  /* Rota önerileri — araç duruyorken göster ─────────────── */

  if (!isMoving) {
    // Sabah + ev civarında / dışarıda → işe git
    if (
      timeCtx === 'morning' && hasWork &&
      (locationCtx === 'home' || locationCtx === 'near-home' || locationCtx === 'away')
    ) {
      out.push({
        id:         'route-work',
        kind:       'route-work',
        title:      'İşe Git',
        subtitle:   'Sabah rotası hazır — günaydın!',
        color:      '#3b82f6',
        priority:   60,
        action:     { type: 'navigate', destination: 'work' },
        confidence: 0.8,
      });
    }

    // Akşam/gece + iş civarında / dışarıda → eve git
    if (
      (timeCtx === 'evening' || timeCtx === 'night') && hasHome &&
      (locationCtx === 'work' || locationCtx === 'near-work' || locationCtx === 'away')
    ) {
      out.push({
        id:         'route-home',
        kind:       'route-home',
        title:      'Eve Git',
        subtitle:   'Akşam rotası hazır — hoş geldin!',
        color:      '#22c55e',
        priority:   60,
        action:     { type: 'navigate', destination: 'home' },
        confidence: 0.8,
      });
    }
  }

  /* Bakım uyarıları — sadece park halindeyken göster ──────── */

  if (!isMoving && maintenance) {
    const reminders = computeReminders(maintenance);
    const urgent = reminders.find((r) => r.urgency === 'urgent' || r.urgency === 'overdue');
    const soon   = !urgent && reminders.find((r) => r.urgency === 'soon');
    const target = urgent ?? soon;

    if (target) {
      out.push({
        id:         `maintenance-${target.id}`,
        kind:       'maintenance-warning',
        title:      target.label,
        subtitle:   target.detail,
        color:      urgent ? '#ef4444' : '#f59e0b',
        priority:   urgent ? 90 : 50,
        action:     { type: 'open-drawer', drawer: 'vehicle-reminder' },
        confidence: 1.0,
      });
    }
  }

  // Önceliğe göre azalan sıra
  return out.sort((a, b) => b.priority - a.priority);
}

/* ── React hook ──────────────────────────────────────────── */

/**
 * Bağlam motorunu başlatır; GPS konumu, OBD verileri veya ayarlar
 * değiştiğinde otomatik olarak yeniden hesaplar.
 *
 * `smartContextEnabled` false ise boş öneri listesi döndürür.
 */
export function useContextEngine(
  location: GPSLocation | null,
  settings: Pick<AppSettings, 'homeLocation' | 'workLocation' | 'smartContextEnabled' | 'maintenance'>,
): ContextState {
  const obdRef = useRef<OBDSnapshot>({ fuelLevel: 100, engineTemp: 70, connected: false });

  const compute = (): ContextState => {
    const locationCtx = getLocationCtx(location, settings.homeLocation, settings.workLocation);
    const timeCtx     = getTimeCtx();
    const isMoving    = location?.speed != null && location.speed * 3.6 > 5;
    const suggestions = settings.smartContextEnabled
      ? buildSuggestions(
          locationCtx, timeCtx, obdRef.current,
          !!settings.homeLocation, !!settings.workLocation,
          isMoving, settings.maintenance,
        )
      : [];
    return { suggestions, locationCtx, timeCtx };
  };

  const [state, setState] = useState<ContextState>(compute);

  // Konum veya ayar değişikliklerinde yeniden hesapla
  useEffect(() => {
    setState(compute());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    location?.latitude,
    location?.longitude,
    location?.speed,
    settings.homeLocation,
    settings.workLocation,
    settings.smartContextEnabled,
    settings.maintenance,
  ]);

  // OBD eşik değerleri değiştiğinde yeniden hesapla
  useEffect(() => {
    return onOBDData((d) => {
      const prev      = obdRef.current;
      const connected = d.connectionState === 'connected';

      // Sadece anlamlı değişikliklerde tetikle — gürültüyü filtrele
      const fuelChanged   = Math.abs(d.fuelLevel  - prev.fuelLevel)  > 2;
      const tempChanged   = Math.abs(d.engineTemp - prev.engineTemp) > 3;
      const connChanged   = connected !== prev.connected;

      if (fuelChanged || tempChanged || connChanged) {
        obdRef.current = { fuelLevel: d.fuelLevel, engineTemp: d.engineTemp, connected };
        setState(compute());
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
