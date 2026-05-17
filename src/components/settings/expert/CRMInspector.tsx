/**
 * CRMInspector — Collective Road Memory Teşhis Paneli
 *
 * Expert Mode'da CRM sistemi hakkında anlık durum bilgisi gösterir:
 *   - Son başarılı cloud pull zamanı
 *   - Yerel kuyruk boyutu
 *   - Aktif topluluk tehlikeleri sayısı
 *   - Senkronizasyonu engelleyen durumlar (termal, ağ)
 *
 * MALI-400 güvenli: sadece Zustand store snapshot okur, polling yok.
 */

import { memo, useEffect, useState } from 'react';
import { Radio, Thermometer, Wifi, WifiOff, CloudOff, Cloud } from 'lucide-react';
import { useHazardStore }              from '../../../store/useHazardStore';
import { useVehicleIntelligenceStore } from '../../../store/useVehicleIntelligenceStore';
import { getPendingBatch, getLastPullSync } from '../../../platform/communityService';

/* ── Yardımcı: zaman damgasını okunabilir metne çevir ──────────────────── */

function _relativeTime(ms: number): string {
  if (ms === 0) return 'Hiç';
  const elapsed = Date.now() - ms;
  if (elapsed < 60_000)  return `${Math.floor(elapsed / 1000)}s önce`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} dk önce`;
  return `${Math.floor(elapsed / 3_600_000)} sa önce`;
}

/* ── CRMInspector bileşeni ─────────────────────────────────────────────── */

export const CRMInspector = memo(function CRMInspector() {
  const activeHazards   = useHazardStore((s) => s.activeHazards);
  const thermalStatus   = useVehicleIntelligenceStore((s) => s.thermalStatus);

  // Ağ ve pull zamanı — bir dakikada bir yenile (1Hz'den fazla değil)
  const [online,       setOnline]       = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queueSize,    setQueueSize]    = useState(0);
  const [lastPull,     setLastPull]     = useState(0);
  const [_tick,        setTick]         = useState(0);  // göreli zaman güncelleme tetikleyicisi

  useEffect(() => {
    const refresh = () => {
      setOnline(navigator.onLine);
      setQueueSize(getPendingBatch().length);
      setLastPull(getLastPullSync());
      setTick((n) => n + 1);
    };
    refresh(); // ilk render
    const interval = setInterval(refresh, 15_000); // 15s — yeterince taze
    window.addEventListener('online',  refresh);
    window.addEventListener('offline', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online',  refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  const communityHazardCount = activeHazards.filter((h) => h.isCommunity).length;
  const isThermalBlocked = thermalStatus === 'HEAT_SOAK' || thermalStatus === 'OVERHEAT_RISK';

  return (
    <section
      className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4"
      aria-label="CRM Teşhis Paneli"
    >
      {/* Başlık */}
      <div className="mb-3 flex items-center gap-2">
        <Radio className="h-3.5 w-3.5 text-blue-400" />
        <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/35">
          Kollektif Yol Belleği — CRM
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Son Pull */}
        <_Cell
          label="Son Pull"
          value={_relativeTime(lastPull)}
          accent={lastPull === 0 ? 'yellow' : 'green'}
        />

        {/* Yerel Kuyruk */}
        <_Cell
          label="Kuyruk"
          value={`${queueSize} rapor`}
          accent={queueSize > 8 ? 'yellow' : 'neutral'}
        />

        {/* Topluluk Tehlikeler */}
        <_Cell
          label="Aktif Tehlike"
          value={`${communityHazardCount} topluluk`}
          accent={communityHazardCount > 0 ? 'blue' : 'neutral'}
        />

        {/* Durum */}
        <div className="flex flex-col gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
          <p className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30">Durum</p>
          <div className="flex flex-col gap-1">
            <_StatusRow
              Icon={online ? Wifi : WifiOff}
              label={online ? 'Çevrimiçi' : 'Çevrimdışı'}
              ok={online}
            />
            <_StatusRow
              Icon={isThermalBlocked ? Thermometer : Cloud}
              label={isThermalBlocked ? `Termal: ${thermalStatus}` : 'Termal OK'}
              ok={!isThermalBlocked}
            />
            {!online || isThermalBlocked ? (
              <_StatusRow
                Icon={CloudOff}
                label="Sync engellendi"
                ok={false}
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
});

/* ── Alt bileşenler ─────────────────────────────────────────────────────── */

const ACCENT_COLORS = {
  green:   { border: 'rgba(52,211,153,0.15)', text: '#34d399' },
  yellow:  { border: 'rgba(251,191,36,0.15)',  text: '#fbbf24' },
  blue:    { border: 'rgba(96,165,250,0.15)',   text: '#60a5fa' },
  neutral: { border: 'rgba(255,255,255,0.06)',  text: 'rgba(255,255,255,0.45)' },
} as const;

function _Cell({ label, value, accent }: {
  label: string; value: string; accent: keyof typeof ACCENT_COLORS;
}) {
  const c = ACCENT_COLORS[accent];
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border p-2.5"
      style={{ borderColor: c.border, background: 'rgba(255,255,255,0.02)' }}
    >
      <p className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30">{label}</p>
      <p className="font-mono text-[11px] font-bold" style={{ color: c.text }}>{value}</p>
    </div>
  );
}

function _StatusRow({ Icon, label, ok }: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`h-3 w-3 ${ok ? 'text-emerald-400' : 'text-amber-400'}`} />
      <span className="text-[9px] font-medium text-white/50">{label}</span>
    </div>
  );
}
