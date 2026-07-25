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
  PIDDID_STATE_LABEL, PIDDID_OVERALL_LABEL,
  type PidDidWiringState,
} from '../../../platform/devtools/pidDidExplorerModel';

const STATE_CLASS: Record<PidDidWiringState, string> = {
  WIRED:       'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  NOT_WIRED:   'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
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
        data-status={overall}
        title={overall}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${
          overall === 'FOUNDATION_ONLY'
            ? 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]'
            : 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]'
        }`}
      >
        DURUM: {PIDDID_OVERALL_LABEL[overall]}
        <div className="mt-1 text-[10px] leading-relaxed text-[var(--oem-ink-2)]">
          Altyapı mevcut ve keşif elle çalıştırılabilir; ancak keşif ÇIKTISI henüz canlı
          polling'e veya Mavi'ye bağlı değildir. Bu ekranı açmak tarama BAŞLATMAZ.
        </div>
      </div>

      {/* Wiring tablosu */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-3 border-b border-[var(--oem-line)] px-3 py-2 last:border-b-0"
          >
            <span
              data-testid={`piddid-wiring-${r.id}`}
              data-state={r.state}
              title={r.state}
              className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] ${STATE_CLASS[r.state]}`}
            >
              {PIDDID_STATE_LABEL[r.state]}
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[11px] text-[var(--oem-ink)]">{r.label}</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-[var(--oem-ink-3)]">{r.note}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Mevcut panel — DEĞİŞTİRİLMEDEN */}
      <PidDidDeepScanPanel />
    </div>
  );
});
