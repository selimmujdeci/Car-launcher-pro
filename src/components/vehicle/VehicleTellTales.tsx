import { memo } from 'react';
import {
  DoorOpen, TriangleAlert, ChevronsLeft, ChevronsRight,
  Lightbulb, CircleParking,
} from 'lucide-react';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';

/**
 * VehicleTellTales — gerçek araç gövde sinyallerini ekranda gösteren
 * tell-tale (uyarı lambası) şeridi. Tüm temalar kullanır.
 *
 * Kaynak: UnifiedVehicleStore (NwdSettingsReader → CAN gövde sinyalleri).
 * Bu araçta (Fiat Doblo / Hiworld) mevcut: kapı, el freni, geri vites,
 * sol/sağ sinyal, dörtlü, far, uzun far. (RPM/yakıt CAN'da YOK.)
 *
 * Renkler standart otomotiv kodlaması: yeşil=sinyal/far, mavi=uzun far,
 * kırmızı=kapı/elfreni, amber=geri/dörtlü. Pasifken sönük, aktifken parlak+glow.
 */

const OFF = '#454b54'; // pasif (sönük gri)

interface CellProps {
  active: boolean;
  color: string;
  label: string;
  children: React.ReactNode;
  blink?: boolean;
}

const Cell = memo(function Cell({ active, color, label, children, blink }: CellProps) {
  const c = active ? color : OFF;
  return (
    <div
      className={active && blink ? 'tt-blink' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 2, minWidth: 40,
        color: c,
        filter: active ? `drop-shadow(0 0 5px ${color})` : 'none',
        opacity: active ? 1 : 0.45,
        transition: 'color .2s, opacity .2s, filter .2s',
      }}
    >
      {children}
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', color: c }}>{label}</span>
    </div>
  );
});

export const VehicleTellTales = memo(function VehicleTellTales() {
  const door    = useUnifiedVehicleStore(s => s.canDoorOpen);
  const hbrake  = useUnifiedVehicleStore(s => s.canParkingBrake);
  const reverse = useUnifiedVehicleStore(s => s.reverse);
  const turnL   = useUnifiedVehicleStore(s => s.canTurnLeft);
  const turnR   = useUnifiedVehicleStore(s => s.canTurnRight);
  const hazard  = useUnifiedVehicleStore(s => s.canHazard);
  const hibeam  = useUnifiedVehicleStore(s => s.canHighBeam);
  const head    = useUnifiedVehicleStore(s => s.canHeadlights);

  const SZ = 22;
  return (
    <div className="flex items-center justify-center" style={{ gap: 6, flexWrap: 'wrap' }}>
      <Cell active={turnL} color="#2ecc40" label="SOL" blink>
        <ChevronsLeft width={SZ} height={SZ} />
      </Cell>
      <Cell active={head} color="#2ecc40" label="FAR">
        <Lightbulb width={SZ} height={SZ} />
      </Cell>
      <Cell active={hibeam} color="#3aa0ff" label="UZUN">
        <Lightbulb width={SZ} height={SZ} fill="currentColor" />
      </Cell>
      <Cell active={hazard} color="#ff7b29" label="DÖRTLÜ" blink>
        <TriangleAlert width={SZ} height={SZ} />
      </Cell>
      <Cell active={door} color="#ff4136" label="KAPI">
        <DoorOpen width={SZ} height={SZ} />
      </Cell>
      <Cell active={hbrake} color="#ff4136" label="EL FR.">
        <CircleParking width={SZ} height={SZ} />
      </Cell>
      <Cell active={reverse} color="#ffb700" label="GERİ">
        <span style={{ fontSize: SZ - 2, fontWeight: 900, lineHeight: 1 }}>R</span>
      </Cell>
      <Cell active={turnR} color="#2ecc40" label="SAĞ" blink>
        <ChevronsRight width={SZ} height={SZ} />
      </Cell>
    </div>
  );
});
