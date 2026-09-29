/**
 * Sürüşte ayar kilidi kararı (Google/Tesla: hareket hâlinde karmaşık ayar yok).
 *
 * Kaynak: kanonik araç hızı (`UnifiedVehicleStore.speed`) — sinema modunun güvenlik
 * çıkışıyla AYNI kaynak, ikinci bir hız otoritesi kurulmaz. Titremesin diye
 * histerezis: ≥ LOCK_KMH kilitler, < UNLOCK_KMH açar. Hız bilinmiyorsa (`null`)
 * ÖNCEKİ karar korunur: parkta bilinmeyen hız kilit koymaz, ama sürüşte GPS/OBD
 * düşmesi (tünel) kilidi AÇMAZ — "bilinmiyor" duruş kanıtı değildir.
 */
import { useEffect, useRef, useState } from 'react';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';

export const LOCK_KMH = 10;
export const UNLOCK_KMH = 3;

/** Saf karar: önceki kilit + hız → yeni kilit. */
export function nextMovingLock(prev: boolean, speedKmh: number | null | undefined): boolean {
  if (typeof speedKmh !== 'number' || !Number.isFinite(speedKmh)) return prev;
  if (prev) return speedKmh >= UNLOCK_KMH;
  return speedKmh >= LOCK_KMH;
}

export function useMovingLock(): boolean {
  const speed = useUnifiedVehicleStore((s) => s.speed);
  const lockedRef = useRef(false);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const next = nextMovingLock(lockedRef.current, speed);
    lockedRef.current = next;
    setLocked(next);
  }, [speed]);
  return locked;
}
