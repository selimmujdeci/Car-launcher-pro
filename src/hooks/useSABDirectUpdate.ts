/**
 * useSABDirectUpdate — SAB-Exclusive Gauge Hook
 *
 * 60 FPS RAF döngüsü; SharedArrayBuffer mevcutsa Atomics.load ile doğrudan
 * okur, yoksa Zustand aboneliğini yedek veri kaynağı olarak kullanır.
 *
 * Kritik tasarım kararı: onFrame() hiçbir zaman React state güncellemez.
 * Çağıran bileşen DOM elemanlarına ref üzerinden yazar:
 *   onFrame(raw, smoothed) {
 *     if (arcRef.current) arcRef.current.setAttribute('stroke-dashoffset', String(offset));
 *     if (textRef.current) textRef.current.textContent = String(raw);
 *   }
 *
 * SAB yoksa (eski WebView / COOP+COEP eksik):
 *   Zustand subscribe + RAF batcher → aynı onFrame() imzası, sıfır re-render.
 *
 * @param sabIndex  — SAB_IDX.SPEED veya SAB_IDX.RPM
 * @param onFrame   — (raw: integer, smoothed: float) → DOM mutasyonu
 * @param alpha     — EMA katsayısı (0.1=yavaş, 0.5=hızlı); varsayılan 0.30
 *
 * Mali-400 optimizasyonu: RAF tick yalnızca generation counter değişirse işlem
 * yapar; değişmezse tek Atomics.load ile çıkar → sıfır ekstra CPU.
 */

import { useEffect }                 from 'react';
import { sabChannel, SAB_GEN_IDX, SAB_IDX } from '../platform/vehicleDataLayer/sabChannel';
import { useUnifiedVehicleStore }    from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { UnifiedVehicleState }  from '../platform/vehicleDataLayer/UnifiedVehicleStore';

type OnFrameCb = (raw: number, smoothed: number) => void;

/** UnifiedVehicleState'ten ham float değer çıkar — sabIndex eşlemesi */
function _zustandField(state: UnifiedVehicleState, idx: number): number | null {
  switch (idx) {
    case SAB_IDX.SPEED:   return state.speed;
    case SAB_IDX.RPM:     return state.rpm != null ? state.rpm : null;
    case SAB_IDX.FUEL:    return state.fuel;
    default:              return null;
  }
}

export function useSABDirectUpdate(
  sabIndex: number,
  onFrame:  OnFrameCb,
  alpha     = 0.30,
): void {
  useEffect(() => {
    let smoothed = 0;
    let rafId:   number;
    let lastGen  = -1;

    // ── Zustand yedek: SAB henüz hazır değilse veya hiç olmayacaksa ─────────
    // Değişen değeri `_latestZustand` içinde tut; RAF tick'te okunur.
    // Bu sayede subscribe callback'i render tetiklemez.
    let _latestZustand: number | null = _zustandField(
      useUnifiedVehicleStore.getState(),
      sabIndex,
    );

    const unsubZustand = useUnifiedVehicleStore.subscribe((state) => {
      _latestZustand = _zustandField(state, sabIndex);
    });

    // İlk kare: anlık değeri yansıt (boş ekrandan kaçın)
    if (_latestZustand != null) {
      smoothed = _latestZustand;
      onFrame(_latestZustand, _latestZustand);
    }

    // ── RAF döngüsü ────────────────────────────────────────────────────────
    const tick = () => {
      const ch  = sabChannel;
      let raw: number | null = null;

      if (ch.f64 && ch.i32) {
        // SAB yolu — Atomics.load ile acquire fence; değişmezse early-exit
        const gen = Atomics.load(ch.i32, SAB_GEN_IDX);
        if (gen !== lastGen) {
          lastGen  = gen;
          const f  = ch.f64[sabIndex];
          if (Number.isFinite(f) && !Number.isNaN(f)) raw = f;
        }
      } else {
        // Zustand yedek yolu — her frame mevcut değeri al
        raw = _latestZustand;
      }

      if (raw != null) {
        smoothed += alpha * (raw - smoothed);
        onFrame(raw, smoothed);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      unsubZustand();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-once — sabChannel ve onFrame dışarıdan değişmemeli
}

export { SAB_IDX };
