/**
 * CanMonitorScreen — CAROS LAB · Communication · CAN Monitor.
 *
 * YENİDEN KULLANIM: mevcut `CanRawView` + mevcut debug store halka tamponu.
 * Toplama (`collecting`) yalnız ekran açıkken açılır → kapalıyken tampon dolmaz.
 */

import { memo } from 'react';
import { CanRawView } from '../../debug/CanRawView';
import { useCanCollect } from '../../../hooks/useDevtoolsCapture';

export const CanMonitorScreen = memo(function CanMonitorScreen() {
  useCanCollect();

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-mono text-white/50">
        SALT-OKUNUR · frame gönderimi YOK. Kütük yalnız ekran açıkken toplanır.
      </div>
      <div className="min-h-0 flex-1">
        <CanRawView />
      </div>
    </div>
  );
});
