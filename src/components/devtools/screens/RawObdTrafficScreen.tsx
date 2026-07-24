/**
 * RawObdTrafficScreen — CAROS LAB · Communication · Raw OBD Traffic.
 *
 * YENİDEN KULLANIM: mevcut `ObdRawView` (debug store'un 500'lük halka tamponu) +
 * mevcut native yakalama kanalı. YENİ POLLING YOK, KOMUT GÖNDERME YOK (görev §F).
 * Yakalama yalnız bu ekran açıkken açılır (ref-count'lu; DebugPanel ile çakışmaz).
 */

import { memo } from 'react';
import { ObdRawView } from '../../debug/ObdRawView';
import { useObdTrafficCapture } from '../../../hooks/useDevtoolsCapture';

export const RawObdTrafficScreen = memo(function RawObdTrafficScreen() {
  useObdTrafficCapture();

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-mono leading-relaxed text-white/50">
        SALT-OKUNUR · komut gönderimi bu ekranda YOK. Yakalama yalnız ekran açıkken çalışır.
        <br />
        Maskeleme AÇIK: VIN yükü (09 02 / 49 02), token, MAC ve e-posta gizlenir.
      </div>
      <div className="min-h-0 flex-1">
        <ObdRawView maskSensitive />
      </div>
    </div>
  );
});
