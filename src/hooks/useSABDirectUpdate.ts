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

/**
 * Fallback (Zustand) yolu SNAP eşikleri — EMA hedefe "oturdu" sayılınca
 * onFrame atlanır. Davranış sözleşmesi SAB yolundakiyle aynıdır:
 *   "değer değişmedi (yeni sequence yok) VE smoothed hedefe oturdu → onFrame atla".
 * Eşik altında kalan |raw - smoothed| farkı insan gözüyle ayırt edilemez.
 */
// SPEED: rafSmoother.ts'teki SPEED snap (0.5 km/h, satır ~83) ile hizalı.
const SNAP_SPEED_KMH = 0.5;
// RPM: 0-8000 ölçeğinde 0.5 anlamsız küçük; ~3 RPM ibre açısında görünmez.
const SNAP_RPM = 3;
// FUEL ve diğer index'ler: 0-100 yüzde ölçeği için küçük makul varsayılan.
const SNAP_DEFAULT = 0.1;

/** sabIndex'e göre fallback SNAP eşiğini döndür. */
function _snapThreshold(idx: number): number {
  switch (idx) {
    case SAB_IDX.SPEED: return SNAP_SPEED_KMH;
    case SAB_IDX.RPM:   return SNAP_RPM;
    default:            return SNAP_DEFAULT;
  }
}

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

    // B — Sequence sayacı: subscribe her veri güncellemesinde artırır.
    // RAF tick bu sayacı _lastFallbackSeq ile karşılaştırarak "yeni veri var mı"
    // sorusunu O(1) cevaplar (değer karşılaştırmasından bağımsız).
    let _fallbackSeq = 0;
    // İlk RAF tick'i ASLA guard'a takılmasın: -1 ≠ 0 → en az bir kez işlenir.
    let _lastFallbackSeq = -1;

    const unsubZustand = useUnifiedVehicleStore.subscribe((state) => {
      _latestZustand = _zustandField(state, sabIndex);
      _fallbackSeq++;
    });

    const snapThreshold = _snapThreshold(sabIndex);

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
        // SAB yolu — Seqlock double-check (Worker tek-yazar, +2/yazım):
        //   GEN tek → yazım sürüyor; baş≠son → Torn Read. Her ikisinde de bu
        //   frame'i atla (lastGen güncellenmez → sonraki RAF temiz okur).
        const g1 = Atomics.load(ch.i32, SAB_GEN_IDX);
        if ((g1 & 1) === 0 && g1 !== lastGen) {
          const f  = ch.f64[sabIndex];
          const g2 = Atomics.load(ch.i32, SAB_GEN_IDX);
          if (g1 === g2) {
            lastGen = g1;
            if (Number.isFinite(f) && !Number.isNaN(f)) raw = f;
          }
        }
      } else {
        // Zustand yedek yolu — her frame mevcut değeri al.
        // B+C generation-guard: SAB yolundaki "değişmeyen değerde onFrame atla"
        // kazancını fallback'e taşır. Guard YALNIZCA iki koşul BİRDEN sağlanınca
        // durur (donma önleme):
        //   (a) sequence değişmedi → yeni veri yok, VE
        //   (b) |raw - smoothed| < SNAP eşiği → EMA hedefe oturdu.
        // İkisinden biri sağlanmazsa onFrame çağrılmaya devam eder; ibre hedefe
        // yumuşak oturur, ekranda donma/sıçrama olmaz. (null davranışı korunur.)
        raw = _latestZustand;
        if (raw != null) {
          const seqUnchanged   = _fallbackSeq === _lastFallbackSeq;
          const emaSettled     = Math.abs(raw - smoothed) < snapThreshold;
          _lastFallbackSeq = _fallbackSeq;
          if (seqUnchanged && emaSettled) {
            // Hem yeni veri yok hem ibre oturmuş → DOM mutasyonunu atla.
            rafId = requestAnimationFrame(tick);
            return;
          }
        }
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
