import { useOBDState } from '../platform/obdService';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

/**
 * useEngineReadout — motor göstergesi (RPM / motor ısısı / yakıt) için TEK kaynak.
 *
 * İki yolu birleştirir:
 *   1. Doğrudan OBD servisi (obdService → useOBDState) — app kendi BT ELM327'sine
 *      bağlanırsa. K24'te standart Android BT KİLİTLİ olduğundan bu yol genelde boş.
 *   2. OEM CarInfo akışı (NwdCanClient → UnifiedVehicleStore.canRpm/canCoolantTemp).
 *      K24'te OBD, OEM "OBD match" (Classic SPP ELM327) ile bağlanınca OEM RPM'i
 *      setCarEngineSpeedFromObd ile CarInfo'ya yazar → buraya akar.
 *
 * Öncelik: doğrudan OBD (taze) → yoksa CarInfo. Her ikisi de yoksa null ("—").
 * Bu sayede tema bileşenleri kaynaktan bağımsız tek hook ile motor verisini gösterir.
 */
export interface EngineReadout {
  rpm: number | null;          // devir/dak
  engineTemp: number | null;   // soğutma suyu °C
  fuel: number | null;         // 0–100 %
}

export function useEngineReadout(): EngineReadout {
  const obd = useOBDState();
  const canRpm     = useUnifiedVehicleStore(s => s.canRpm);
  const canCoolant = useUnifiedVehicleStore(s => s.canCoolantTemp);
  const storeFuel  = useUnifiedVehicleStore(s => s.fuel);

  const rpm =
    obd.rpm != null && obd.rpm >= 0 ? obd.rpm
    : canRpm != null && canRpm >= 0 ? canRpm
    : null;

  const engineTemp =
    obd.engineTemp != null && obd.engineTemp >= 0 ? obd.engineTemp
    : canCoolant != null && canCoolant > -40 && canCoolant < 200 ? canCoolant
    : null;

  const fuel =
    obd.fuelLevel != null && obd.fuelLevel >= 0 ? obd.fuelLevel
    : storeFuel != null && storeFuel >= 0 ? storeFuel
    : null;

  return { rpm, engineTemp, fuel };
}
