/**
 * VehicleStatusCard — araç silüeti: açık kapı/bagaj ve lastik basınçları tek bakışta.
 *
 * · Değerler ARACIN bildirdiğidir (store canDoors / canTpms); bilinmeyen "—", sahte yok.
 * · Lastik uyarısı yalnız AYNI akstaki iki teker arasında (`tireAxleLow`, Mavi ile aynı kural).
 * · CAN akışı sustuysa "son bilinen" uyarısı; kurulum yoksa lastik için yol gösterir.
 * · Görünür değilken sorgu durur (`useVehicleAccess(ref)`).
 */
import { memo, useRef } from 'react';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { tireAxleLow } from '../../platform/vehicleDataLayer/canComfortControl';
import { useVehicleAccess } from '../../hooks/useVehicleAccess';

const OPEN = '#ef4444';
const LOW = '#f59e0b';
const BODY = 'var(--oem-surface-2)';
const LINE = 'var(--oem-line)';

function fmtBar(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
}

export const VehicleStatusCard = memo(function VehicleStatusCard() {
  const doors = useUnifiedVehicleStore((s) => s.canDoors);
  const tpms = useUnifiedVehicleStore((s) => s.canTpms);
  const rootRef = useRef<HTMLDivElement>(null);
  const access = useVehicleAccess(rootRef);

  const bar = tpms?.bar ?? [null, null, null, null];
  const low = tpms ? tireAxleLow(tpms.bar) : [null, null, null, null];
  const doorCol = (open: boolean | undefined): string => (open ? OPEN : LINE);
  const openList = doors
    ? [doors.frontLeft && 'ön sol kapı', doors.frontRight && 'ön sağ kapı', doors.rearLeft && 'arka sol kapı',
      doors.rearRight && 'arka sağ kapı', doors.trunk && 'bagaj'].filter(Boolean) as string[]
    : [];

  /* Teker etiketi: [x, y, hizalama] — silüetin solu/sağı. */
  const tireLabel = (i: 0 | 1 | 2 | 3, x: number, y: number, anchor: 'start' | 'end') => (
    <text x={x} y={y} textAnchor={anchor} fontSize="15" fontWeight={700}
      fill={low[i] !== null ? LOW : 'var(--oem-ink)'}>
      {fmtBar(bar[i])}
    </text>
  );

  return (
    <div ref={rootRef} className="flex flex-col items-center gap-2" data-testid="vehicle-status-card">
      <svg width="260" height="230" viewBox="0 0 260 230" aria-label="Araç durumu">
        {/* gövde (üstten, ön yukarıda) */}
        <rect x="85" y="20" width="90" height="190" rx="30" fill={BODY} stroke={LINE} strokeWidth="2" />
        <rect x="97" y="62" width="66" height="96" rx="12" fill="none" stroke={LINE} strokeWidth="1.5" />
        {/* tekerlekler */}
        {[[72, 48], [175, 48], [72, 150], [175, 150]].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="13" height="32" rx="4" fill={LINE} />
        ))}
        {/* kapılar: sol ön/arka · sağ ön/arka (açıksa kırmızı ve dışa açık) */}
        <line x1="85" y1="66" x2={doors?.frontLeft ? 62 : 85} y2={doors?.frontLeft ? 96 : 108} stroke={doorCol(doors?.frontLeft)} strokeWidth="5" strokeLinecap="round" />
        <line x1="85" y1="112" x2={doors?.rearLeft ? 62 : 85} y2={doors?.rearLeft ? 142 : 154} stroke={doorCol(doors?.rearLeft)} strokeWidth="5" strokeLinecap="round" />
        <line x1="175" y1="66" x2={doors?.frontRight ? 198 : 175} y2={doors?.frontRight ? 96 : 108} stroke={doorCol(doors?.frontRight)} strokeWidth="5" strokeLinecap="round" />
        <line x1="175" y1="112" x2={doors?.rearRight ? 198 : 175} y2={doors?.rearRight ? 142 : 154} stroke={doorCol(doors?.rearRight)} strokeWidth="5" strokeLinecap="round" />
        {/* bagaj (arka) */}
        <line x1="104" y1={doors?.trunk ? 222 : 210} x2="156" y2={doors?.trunk ? 222 : 210} stroke={doorCol(doors?.trunk)} strokeWidth="5" strokeLinecap="round" />
        {/* lastik basınçları (bar) */}
        {tireLabel(0, 64, 68, 'end')}
        {tireLabel(1, 196, 68, 'start')}
        {tireLabel(2, 64, 170, 'end')}
        {tireLabel(3, 196, 170, 'start')}
      </svg>

      <div className="text-[12px] font-semibold text-center" style={{ color: openList.length ? OPEN : 'var(--oem-ink-3)' }}>
        {!doors ? 'Kapı bilgisi gelmiyor' : openList.length ? `Açık: ${openList.join(', ')}` : 'Tüm kapılar ve bagaj kapalı'}
      </div>
      <div className="text-[11px] text-center text-[color:var(--oem-ink-3)]">
        {tpms
          ? (low.some((d) => d !== null) ? 'Aynı akstaki bir lastik diğerinden düşük — kontrol etmeni öneririm.' : 'Lastik basınçları (bar)')
          : access?.features.tpms === 'LOCKED'
            ? 'Lastik basıncı için bir kerelik araç bağlantısı kurulumu gerekiyor.'
            : 'Lastik basıncı henüz gelmedi.'}
      </div>
      {access?.stream === 'STALE' && (doors || tpms) && (
        <div className="text-[11px] font-semibold text-center" style={{ color: LOW }}>
          Araçtan bir süredir veri gelmiyor — gösterilenler son bilinen değer.
        </div>
      )}
    </div>
  );
});
