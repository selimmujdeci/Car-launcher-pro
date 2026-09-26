/**
 * DriverPhoneLink — etkin sürücünün telefonunu bağlar ("bu benim telefonum").
 * Bağlı telefon araca bağlanınca profil kendiliğinden gelir (driverPhoneRecognition).
 */
import { memo, useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import type { DriverProfile } from '../../store/useStore';
import { linkDriverPhone, unlinkDriverPhone } from '../../platform/driverProfileService';
import {
  getConnectedBtDevices, subscribeConnectedBtDevices, normAddr, type BtDevice,
} from '../../platform/driverPhoneRecognition';

const chip: React.CSSProperties = {
  minHeight: 38, borderRadius: 12, padding: '0 12px', fontSize: 12, fontWeight: 700,
  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink-2)',
};

export const DriverPhoneLink = memo(function DriverPhoneLink({ driver }: { driver: DriverProfile }) {
  const [devices, setDevices] = useState<BtDevice[]>(getConnectedBtDevices);
  useEffect(() => subscribeConnectedBtDevices(() => setDevices(getConnectedBtDevices())), []);

  const linked = driver.phone;
  const linkedNow = linked ? devices.some((d) => normAddr(d.address) === normAddr(linked.address)) : false;

  return (
    <div className="mt-4">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] mb-2" style={{ color: 'var(--oem-ink-3)' }}>
        Telefonundan tanı
      </div>
      {linked ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--oem-ink)' }}>
            <Smartphone className="w-4 h-4" /> {linked.name}
          </span>
          <span className="text-[11px]" style={{ color: linkedNow ? 'var(--oem-good)' : 'var(--oem-ink-3)' }}>
            {linkedNow ? '· şu an bağlı' : '· bağlanınca profilin gelir'}
          </span>
          <button type="button" onClick={() => unlinkDriverPhone(driver.id)} className="ml-auto active:scale-95" style={chip}>
            Kaldır
          </button>
        </div>
      ) : devices.length > 0 ? (
        <>
          <div className="text-[12px] mb-2" style={{ color: 'var(--oem-ink-2)' }}>Hangisi senin telefonun?</div>
          <div className="flex flex-wrap gap-2">
            {devices.map((d) => (
              <button key={d.address} type="button" onClick={() => linkDriverPhone(driver.id, d)}
                className="flex items-center gap-1.5 active:scale-95" style={chip}>
                <Smartphone className="w-3.5 h-3.5" /> {d.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="text-[12px]" style={{ color: 'var(--oem-ink-3)' }}>
          Telefonunu araca Bluetooth ile bağla, sonra burada seç. Bir dahaki binişte profilin kendiliğinden gelir.
        </div>
      )}
    </div>
  );
});
