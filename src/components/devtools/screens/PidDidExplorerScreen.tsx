/**
 * PidDidExplorerScreen — CAROS LAB · Vehicle · PID/DID Explorer.
 *
 * YENİDEN KULLANIM: mevcut `PidDidDeepScanPanel` (Faz-1 keşif altyapısı) DEĞİŞTİRİLMEDEN
 * gömülür. Bu tur YALNIZ görünür/erişilebilir yapar — Mavi wiring, applyVerified canlı
 * polling tüketicisi veya geniş tarama davranışı EKLENMEZ (görev "yapılmayacaklar").
 *
 * DÜRÜSTLÜK (görev §E): ekranın üstünde FOUNDATION_ONLY / NOT_WIRED tablosu vardır —
 * neyin gerçekten bağlı olduğu satır satır yazılır. Ekranı AÇMAK keşif BAŞLATMAZ;
 * tarama yalnız panelin "Keşfi Başlat" düğmesiyle, elle başlar.
 */

import { memo, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../../../platform/nativePlugin';
import { PidDidDeepScanPanel } from '../../discovery/PidDidDeepScanPanel';
import {
  describePidDidWiring, pidDidOverallStatus,
  type PidDidWiringState,
} from '../../../platform/devtools/pidDidExplorerModel';

const STATE_CLASS: Record<PidDidWiringState, string> = {
  WIRED:       'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  NOT_WIRED:   'border-amber-500/40 bg-amber-500/10 text-amber-300',
  UNAVAILABLE: 'border-white/15 bg-white/5 text-white/40',
};

/** Native DID okuma köprüsü bu ortamda var mı — ÖLÇÜLÜR, varsayılmaz. */
function detectNativeDidChannel(): boolean {
  try {
    return Capacitor.isNativePlatform() && typeof CarLauncher.readObdDid === 'function';
  } catch {
    return false;
  }
}

export const PidDidExplorerScreen = memo(function PidDidExplorerScreen() {
  const rows = useMemo(
    () => describePidDidWiring({ nativeDidChannel: detectNativeDidChannel() }),
    [],
  );
  const overall = pidDidOverallStatus(rows);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      {/* Dürüst genel durum */}
      <div
        data-testid="piddid-overall-status"
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${
          overall === 'FOUNDATION_ONLY'
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
            : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
        }`}
      >
        DURUM: {overall}
        <div className="mt-1 text-[10px] leading-relaxed text-white/50">
          Altyapı mevcut ve keşif elle çalıştırılabilir; ancak keşif ÇIKTISI henüz canlı
          polling'e veya Mavi'ye bağlı değildir. Bu ekranı açmak tarama BAŞLATMAZ.
        </div>
      </div>

      {/* Wiring tablosu */}
      <div className="shrink-0 rounded border border-white/10 bg-white/[0.03]">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-3 border-b border-white/5 px-3 py-2 last:border-b-0"
          >
            <span
              data-testid={`piddid-wiring-${r.id}`}
              className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] ${STATE_CLASS[r.state]}`}
            >
              {r.state}
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[11px] text-white/80">{r.label}</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-white/40">{r.note}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Mevcut panel — DEĞİŞTİRİLMEDEN */}
      <PidDidDeepScanPanel />
    </div>
  );
});
