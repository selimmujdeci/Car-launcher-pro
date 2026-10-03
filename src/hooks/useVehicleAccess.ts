/**
 * useVehicleAccess — `vehicleAccess` projeksiyonunu ekran GÖRÜNÜRKEN periyodik okur.
 * Yeni depo DEĞİL: her okuma native durumu + store'u yeniden yorumlar.
 *
 * GÖRÜNÜRLÜK: çekmeceler kapalıyken de mount kalır (yalnız ekran dışına kaydırılır).
 * `ref` verilirse IntersectionObserver ile ekranda değilken sorgu DURUR — kapalı
 * çekmece arka planda 5 sn'de bir native çağrı yapmaz. Sıfır sızıntı: kapanışta
 * zamanlayıcı ve gözlemci bırakılır.
 */
import { useEffect, useState, type RefObject } from 'react';
import { readVehicleAccess, type VehicleAccessState } from '../platform/vehicleDataLayer/vehicleAccess';

export const VEHICLE_ACCESS_POLL_MS = 5_000;

export function useVehicleAccess(ref?: RefObject<Element | null>): VehicleAccessState | null {
  const [state, setState] = useState<VehicleAccessState | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref?.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      if (e) setVisible(e.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const tick = (): void => {
      void readVehicleAccess().then((s) => { if (alive) setState(s); }).catch(() => { /* fail-soft */ });
    };
    tick();
    const id = setInterval(tick, VEHICLE_ACCESS_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [visible]);

  return state;
}
