/**
 * SafetyContext — Safety Assistant FAZ 4A
 *
 * TEK queue, TEK ticker, TEK state garantisi.
 *
 * Neden:
 *   Önceki mimaride SafetyOverlay ve SafetyAnnouncer her biri useSafetyAlerts()
 *   çağırıyordu → 2 ayrı SafetyAlertQueue, 2 ayrı safetyTicker, 2 ayrı state.
 *   Bu context ile tek provider tüm tüketicilere aynı output ve mute fonksiyonunu
 *   dağıtır; queue/ticker yalnızca bir kez örneklenir.
 *
 * Kullanım:
 *   - SafetyProvider: App.tsx'te SafetyOverlay + SafetyAnnouncer'ı sarar.
 *   - useSafetyContext: consumer bileşenler (SafetyOverlay, SafetyAnnouncer) içinde.
 *   - SafetyContext nesnesi kasıtlı export edilmez — yalnız hook üzerinden erişilir.
 *
 * Faz 4B notu: opts (SafetyMapOptions) şu an provider'a verilmez.
 *   Faz 4B'de signalsAvailable CAN handshake bağlandığında SafetyProvider
 *   opts prop'u alacak; buraya iletmek yeterli.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { useSafetyAlerts } from '../../platform/safety/useSafetyAlerts';
import { deriveSignalsAvailable } from '../../platform/safety/signalsAvailability';
import { deriveIsDark } from '../../platform/safety/isDark';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { useStore } from '../../store/useStore';
import type { SafetySignalsAvailable } from '../../platform/safety/signalsAvailability';
import type { SafetyMapOptions } from '../../platform/safety/safetyStateMapper';
import type { SafetyQueueOutput } from '../../platform/safety/types';

// ── Context değer tipi ────────────────────────────────────────────────────────

interface SafetyContextValue {
  /** Güncel kuyruğun çıktısı — visibleAlerts, banner, ses kararı. */
  output: SafetyQueueOutput;
  /**
   * ruleId bazlı susturma. Stabil referans (useCallback).
   * Çağırmak mevcut instance için sesi keser; koşul kalkıp yeniden oluşunca
   * yeni track → susturma otomatik kalkar.
   */
  mute: (ruleId: string) => void;
}

// ── Context nesnesi (kasıtlı olarak dışa açılmaz) ────────────────────────────

const SafetyContext = createContext<SafetyContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

/**
 * SafetyProvider — useSafetyAlerts hook'unu TEK kez çağırır ve
 * output + mute'u tüm alt bileşenlerle paylaşır.
 *
 * @param children - SafetyOverlay ve SafetyAnnouncer (ve gerekirse başkaları).
 * @param opts     - Gece/sinyal seçenekleri (Faz 4B'de bağlanacak; şimdilik opsiyonel).
 */
export function SafetyProvider({
  children,
  opts,
}: {
  children: ReactNode;
  opts?: SafetyMapOptions;
}): JSX.Element {
  // ── FAZ 4B: signalsAvailable türetimi ──────────────────────────────────────
  // Hangi opsiyonel CAN sinyali bu araçta gerçekten var (profil + safeMode).
  // Handshake async tamamlanır (OBD bağlandıktan sonra) → store değişimini
  // render-tetikleyici olarak kullan; availability değişmezse setState yok.
  const [signalsAvailable, setSignalsAvailable] = useState<SafetySignalsAvailable>(
    () => deriveSignalsAvailable(),
  );
  useEffect(() => {
    const recompute = (): void => {
      const next = deriveSignalsAvailable();
      setSignalsAvailable((prev) =>
        prev.seatbelt === next.seatbelt && prev.headlights === next.headlights
          ? prev
          : next,
      );
    };
    recompute(); // mount anında
    // CAN aktıkça store güncellenir → availability'yi tazele (cache'li, ucuz).
    const unsub = useUnifiedVehicleStore.subscribe(recompute);
    return unsub;
  }, []);

  // ── FAZ 4C: isDark (gece/karanlık) tema dayNightMode'undan ─────────────────
  // headlights.off.dark kuralı isDark gerektirir. İlk sürüm: tema gece modu
  // (settings.dayNightMode). Reaktif: dayNightMode değişince provider re-render.
  const dayNightMode = useStore((s) => s.settings.dayNightMode);
  const isDark = deriveIsDark(dayNightMode);

  // Derived signalsAvailable + isDark'ı opts ile birleştir (caller açıkça verirse o kazanır).
  // NOT: availability handshake'te bir kez flip edince useSafetyAlerts effect cleanup
  // queue.reset() çağırır (Faz 2.6 davranışı) → nadir + erken; kabul edilir.
  const mergedOpts = useMemo<SafetyMapOptions>(
    () => ({
      ...opts,
      isDark: opts?.isDark ?? isDark,
      signalsAvailable: { ...signalsAvailable, ...opts?.signalsAvailable },
    }),
    [opts, isDark, signalsAvailable],
  );

  // TEK hook çağrısı — tek queue, tek ticker, tek state.
  const { output, mute } = useSafetyAlerts(mergedOpts);

  // value: output veya mute referansı değişince yeniden oluşturulur.
  // output: safetyOutputsEqual ile korunan → gereksiz re-render minimumdur.
  // mute: useCallback ile stabil → genellikle value yeniden oluşmaz.
  const value = useMemo<SafetyContextValue>(
    () => ({ output, mute }),
    [output, mute],
  );

  return (
    <SafetyContext.Provider value={value}>
      {children}
    </SafetyContext.Provider>
  );
}

// ── Consumer hook ─────────────────────────────────────────────────────────────

/**
 * useSafetyContext — SafetyProvider içindeki bileşenler için.
 *
 * @throws SafetyProvider dışında çağrılırsa hata fırlatır (geliştirme güvencesi).
 * @returns SafetyContextValue — output ve mute.
 */
export function useSafetyContext(): SafetyContextValue {
  const ctx = useContext(SafetyContext);
  if (ctx === null) {
    throw new Error('useSafetyContext SafetyProvider içinde kullanılmalı');
  }
  return ctx;
}
