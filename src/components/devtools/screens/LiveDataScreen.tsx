/**
 * LiveDataScreen — CAROS LAB · Vehicle · Live Data.
 *
 * YENİDEN KULLANIM: mevcut `ObdLiveTestPanel` (tüm Mode-01 PID + marka DID canlı akışı).
 * Panelin SIFIR-MALİYET sözleşmesi korunur: abonelikler ve native diagnostic burst
 * yalnız `active` iken açılır; ekran kapanınca panel unmount olur → burst kapanır.
 * İKİNCİ POLLING MOTORU BAŞLATILMAZ — mevcut native akışın modu değişir, o kadar.
 */

import { memo } from 'react';
import { ObdLiveTestPanel } from '../../obd/ObdLiveTestPanel';

export const LiveDataScreen = memo(function LiveDataScreen() {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2 text-[10px] font-mono text-[var(--oem-ink-2)]">
        SALT-OKUNUR · ekran açıkken native tanı burst'ü etkin (ekstra ECU trafiği); kapanınca düşük-yük
        round-robin'e döner.
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ObdLiveTestPanel active />
      </div>
    </div>
  );
});
