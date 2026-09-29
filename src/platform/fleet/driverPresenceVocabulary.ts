/**
 * Presence kaynak/güven sözlüğü — import'u olmayan yaprak modül.
 * driverPresence ↔ driverPresencePersistence statik import döngüsünü kapatmak
 * için buraya taşındı (importCycleGuard); driverPresence aynen yeniden dışa aktarır.
 */

export const PRESENCE_SOURCES = [
  'UNKNOWN',
  'HEAD_UNIT',
  'PHONE',
  'BLUETOOTH',
  'NFC',
] as const;
export type PresenceSource = (typeof PRESENCE_SOURCES)[number];

export function isPresenceSource(v: unknown): v is PresenceSource {
  return typeof v === 'string' && (PRESENCE_SOURCES as readonly string[]).includes(v);
}

export const PRESENCE_CONFIDENCES =
  ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type PresenceConfidence = (typeof PRESENCE_CONFIDENCES)[number];

export function isPresenceConfidence(v: unknown): v is PresenceConfidence {
  return typeof v === 'string' && (PRESENCE_CONFIDENCES as readonly string[]).includes(v);
}
