'use client';

/**
 * Aracın sağlık özetini okur — TEK yükleme yolu (F3).
 *
 * ── NEDEN HOOK ───────────────────────────────────────────────────────────
 * F2.2'de okuma `VehicleHealthCard` içindeydi. F3'te ana ekran da aynı özeti
 * istiyor. İki bileşenin ayrı ayrı okuma/birleştirme yapması İKİNCİ BİR
 * BİLEŞİM YOLU doğururdu (biri düzeltilince öteki eski kalır — bu repoda
 * `vehicleStore` ile `pairingService` arasında bir kez yaşanmış bir kusur).
 * Okuma ve bileşim burada TEK yerdedir.
 *
 * Otorite BURADA DEĞİLDİR: hüküm `buildVehicleHealthSummary`, yetki RLS'tedir.
 * Bu hook yalnız okur, birleştirir ve `null` ile "henüz okunmadı"yı ayırır.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VehicleFreshness } from '@/lib/fleet/vehicleTelemetryFreshness';
import {
  buildVehicleHealthSummary,
  type VehicleHealthSummary,
} from '@/lib/diagnostics/vehicleHealth';
import {
  readLatestDtcOutcome,
  readLatestVoltageOutcome,
} from '@/lib/diagnostics/dtcResultReader';

export interface VehicleHealthState {
  /** `null` = HENÜZ OKUNMADI. UNKNOWN ile KARIŞTIRILMAZ (§19). */
  readonly summary: VehicleHealthSummary | null;
  readonly loading: boolean;
  readonly reload: () => void;
}

export function useVehicleHealth(
  vehicleId: string | null,
  telemetry: VehicleFreshness | undefined,
): VehicleHealthState {
  const [summary, setSummary] = useState<VehicleHealthSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  /**
   * Araç kimliği damgası — GEÇ GELEN OKUMA KORUMASI.
   *
   * Araç A'nın okuması sürerken kullanıcı B'ye geçerse, A'nın sonucu B'nin
   * ekranına SIZAMAZ (§17). Bu, mevcut `key`-ile-yeniden-kurma davranışının
   * yanında ikinci bir kemerdir; yeni bir durum otoritesi değildir.
   */
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!vehicleId) {
      requestedFor.current = null;
      setSummary(null);
      return;
    }
    requestedFor.current = vehicleId;
    setLoading(true);

    /* İkisi de RLS üzerinden ve paralel; okunamayan kanıt `null` kalır. */
    const [dtc, voltage] = await Promise.all([
      readLatestDtcOutcome(vehicleId),
      readLatestVoltageOutcome(vehicleId),
    ]);

    if (!mounted.current || requestedFor.current !== vehicleId) return;

    setSummary(buildVehicleHealthSummary({
      now: Date.now(),
      freshness: telemetry,
      dtc,
      voltage,
    }));
    setLoading(false);
  }, [vehicleId, telemetry]);

  useEffect(() => { void load(); }, [load]);

  return { summary, loading, reload: () => void load() };
}
