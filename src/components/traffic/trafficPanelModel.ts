/**
 * trafficPanelModel — trafik panelinin SAF metin/biçim kuralları (test edilebilir).
 * Bilinmeyen değer uydurulmaz: gecikme/mesafe/ad yoksa ilgili parça GÖSTERİLMEZ.
 */
import type { TrafficIncident, TrafficRoad, TrafficUnavailable } from '../../platform/trafficService';

export const INCIDENT_COLORS: Record<TrafficIncident['kind'], string> = {
  accident: '#E53935', road_closed: '#B71C1C', lane_closed: '#F57C00', roadworks: '#F9A825',
  jam: '#E53935', broken_vehicle: '#F57C00', weather: '#1E88E5', danger: '#F57C00', other: '#90A4AE',
};

export const LEVEL_LABEL = { free: 'Akıcı', moderate: 'Yavaş', heavy: 'Yoğun', standstill: 'Durma noktasında' } as const;

export const INCIDENT_TITLE: Record<TrafficIncident['kind'], string> = {
  accident: 'Kaza', jam: 'Sıkışıklık', roadworks: 'Yol çalışması', road_closed: 'Yol kapalı',
  lane_closed: 'Şerit kapalı', broken_vehicle: 'Arızalı araç', weather: 'Hava koşulu', danger: 'Tehlike', other: 'Olay',
};

export const UNAVAILABLE_TEXT: Record<TrafficUnavailable, { title: string; body: string }> = {
  no_key: { title: 'Canlı trafik kaynağı bağlı değil', body: 'TomTom anahtarı tanımlı değil; gerçek veri olmadan trafik gösterilmez.' },
  no_location: { title: 'Konum bekleniyor', body: 'GPS konumu alınınca çevredeki trafik yüklenecek.' },
  fetch_failed: { title: 'Trafik verisi alınamadı', body: 'Bağlantı ya da servis yanıt vermedi; birkaç dakika içinde yeniden denenecek.' },
};

/** Saniye → "+7 dk" / "+1 sa 5 dk"; 60 sn altı gösterilmez. */
export function fmtDelay(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec < 60) return null;
  const m = Math.round(sec / 60);
  if (m < 60) return `+${m} dk`;
  return `+${Math.floor(m / 60)} sa ${m % 60} dk`;
}

export function fmtDistance(m: number | null): string | null {
  if (m === null || !Number.isFinite(m)) return null;
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function fmtAge(updatedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 60) return 'az önce';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} dk önce` : `${Math.floor(m / 60)} sa önce`;
}

/** "Adana Yolu → Tarsus Merkez · D400" — yalnız bilinen parçalar. */
export function incidentRoute(i: TrafficIncident): string | null {
  const parts: string[] = [];
  if (i.from && i.to) parts.push(`${i.from} → ${i.to}`);
  else if (i.from || i.to) parts.push((i.from ?? i.to)!);
  if (i.roadNumbers.length > 0) parts.push(i.roadNumbers.join(', '));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** "22 km/s · normalde 60 km/s". */
export function roadSpeedLine(r: TrafficRoad): string {
  if (r.roadClosed) return 'Yol kapalı';
  return `${Math.round(r.currentSpeedKmh)} km/s · normalde ${Math.round(r.freeFlowSpeedKmh)} km/s`;
}

/** TomTom güveni düşükse (az araç verisi) kullanıcıya söylenir. */
export function lowConfidence(r: TrafficRoad): boolean {
  return r.confidence !== null && r.confidence < 0.5;
}
