/**
 * HARİTA TABANI VE GECE OKUNURLUĞU (#665).
 *
 * Saf: I/O YOK, MapLibre importu YOK, React YOK. Yalnız "hangi taban" ve
 * "hangi katman hangi renge" sorularını yanıtlar; uygulamayı çağıran yapar.
 *
 * ── NEDEN GECE YAMASI VAR ─────────────────────────────────────────────────
 * Kullanıcı: *"öyle kapkara bir şey olmasın, biri haritaya baktığında net
 * görecek"*. ÖLÇÜLDÜ (CARTO dark-matter stil JSON'u, 93 katman): yol
 * DOLGULARI `#0b0b0b` (zeminden ayırt edilemez) ve `rgba(65,71,88)`;
 * yani stil, yolu çizmiş ama görünmez bırakmış.
 *
 * Kök #622'nin dersiyle aynı: sorun kontrast ORANI değil, MUTLAK yüzey
 * parlaklığıdır. Zemini bir tık açıp yolları hiyerarşiye göre parlatıyoruz —
 * ana arter en parlak, servis yolu en sönük. Böylece gece kimliği korunur
 * ama yol ağı okunur olur.
 */

import type { ConsoleTheme } from './consoleTheme';

export type MapBase = 'night' | 'day';

/** İkisi de CARTO tabanı (atıflı, ticari kullanıma uygun). */
export const MAP_STYLE_URL: Record<MapBase, string> = {
  night: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  /** Voyager: sokak/POI kontrastı yüksek, gündüz için okunur taban. */
  day: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
};

/** Konsol teması → harita tabanı. Harita uygulamanın temasını TAKİP EDER. */
export function baseForTheme(theme: ConsoleTheme): MapBase {
  return theme === 'day' ? 'day' : 'night';
}

/** Karolar gelene kadar görünen kap zemini — tabanla uyumlu. */
export function loadingBackdrop(base: MapBase): string {
  return base === 'day' ? '#e8e6e1' : '#12151a';
}

/* ── Gece okunurluk yaması ─────────────────────────────────────────────── */

interface RoadRule {
  /** Katman id kalıbı (CARTO dark-matter adlandırması). */
  readonly match: RegExp;
  /** Yeni çizgi rengi. */
  readonly color: string;
}

/**
 * Yol hiyerarşisi — parlaklık yol sınıfını YANSITIR.
 * Sıra önemlidir: ilk eşleşen kural kazanır (özelden genele).
 */
export const NIGHT_ROAD_RULES: readonly RoadRule[] = [
  // Otoyol / ana arter — en parlak
  { match: /^(road|bridge|tunnel)_(mot|trunk)_fill/, color: '#9AA4B8' },
  // Birincil
  { match: /^(road|bridge|tunnel)_pri_fill/,         color: '#8892A6' },
  // İkincil
  { match: /^(road|bridge|tunnel)_sec_fill/,         color: '#79839A' },
  // Tali / servis — sönük ama görünür
  { match: /^(road|bridge|tunnel)_minor_fill/,       color: '#68718A' },
  { match: /^(road|bridge|tunnel)_service_fill/,     color: '#59617A' },
  // Yaya yolu / patika
  { match: /^(road|bridge|tunnel)_path/,             color: '#4E566B' },
  // Kenarlık (case) katmanları — yolun etrafına koyu ayraç, form belirginleşir
  { match: /^(road|bridge|tunnel)_(mot|trunk|pri)_case/, color: '#20242E' },
  { match: /^(road|bridge|tunnel)_(sec|minor|service)_case/, color: '#1B1E26' },
];

/** Katman için gece rengi; kural yoksa `null` (katmana DOKUNULMAZ). */
export function nightRoadColor(layerId: string): string | null {
  for (const rule of NIGHT_ROAD_RULES) {
    if (rule.match.test(layerId)) return rule.color;
  }
  return null;
}

/** Gece zemini — saf siyah DEĞİL; yol/etiket için taban parlaklığı. */
export const NIGHT_BACKGROUND = '#12151a';

/** Gece etiket renkleri — yer adları okunur olmalı. */
export const NIGHT_LABEL = {
  text: '#C9CEDA',
  halo: '#0C0F14',
} as const;

/** Su yüzeyi — zeminden ayırt edilebilir kalsın. */
export const NIGHT_WATER = '#16202B';

/**
 * Bir katmanın etiket katmanı olup olmadığı — yer adı/yol adı sayılır,
 * ev numarası gibi gürültü katmanları dışarıda bırakılır.
 */
export function isLabelLayer(layerId: string): boolean {
  if (/housenum/i.test(layerId)) return false;
  return /label|place|poi|water_name|road_name|country|state|city|town|village/i.test(layerId);
}
