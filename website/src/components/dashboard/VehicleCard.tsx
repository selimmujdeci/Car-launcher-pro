'use client';

/**
 * ARAÇ KARTI — Kanıt Konsolu dili (#663).
 *
 * Korunan sözleşme (#661'den devralındı, ZAYIFLATILMADI):
 *  · Kimlik `vehicleTitle()` tek otoritesinden gelir; UUID plaka diye YAZILMAZ.
 *  · Bilinmeyen ölçüm UYARI RENGİ ALMAZ — sahte alarm yasak. Yakıt bilinmiyorsa
 *    çubuk çizilmez (eskiden bilinmeyen yakıt `0` sayılıp KIRMIZI boş çubukla
 *    "yakıt bitti" sahte alarmı üretiliyordu).
 *  · Kart kenarlığı artık HÜKMÜ taşır: kanıtsız araç gri kalır, yeşile boyanmaz.
 */

import type { LiveVehicle } from '@/types/realtime';
import { vehicleTitle, vehicleSubtitle, isFallbackTitle } from '@/lib/vehicleDisplay';
import {
  measurementLabel,
  locationLabel,
  dataSourceLabel,
  type Measurement,
  type VehicleFreshness,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import {
  judgeVehicle,
  verdictToken,
  verdictLabel,
  agoLabel,
  evidenceLine,
} from '@/lib/console/evidenceModel';
import { EvidenceBadge, StatusDot, TOKEN_COLOR } from '@/components/console/primitives';

interface VehicleCardProps {
  vehicle: LiveVehicle;
  onClick: (v: LiveVehicle) => void;
}

/** Ölçüm rengi. Bilinmeyen veri UYARI RENGİ ALMAZ. */
function measurementColor(m: Measurement | undefined, warnBelow?: number, alertBelow?: number): string {
  if (!m || m.value === null) return 'var(--cn-unknown)';
  if (m.state !== 'LIVE') return 'var(--cn-text-3)';
  if (alertBelow !== undefined && m.value < alertBelow) return 'var(--cn-critical)';
  if (warnBelow !== undefined && m.value < warnBelow) return 'var(--cn-warning)';
  return 'var(--cn-text-1)';
}

export default function VehicleCard({ vehicle: v, onClick }: VehicleCardProps) {
  const t: VehicleFreshness | undefined = v.telemetry;
  const j = judgeVehicle(t, v.batteryVoltage ?? null);
  const offline = v.status === 'offline';
  const token = offline ? 'unknown' : verdictToken(j.verdict);

  const fuel = t?.fuelPercent;
  const fuelKnown = fuel?.value !== null && fuel?.value !== undefined;
  const fuelPct = fuelKnown ? Math.max(0, Math.min(100, fuel!.value as number)) : 0;
  const fuelBarColor =
    !fuelKnown ? 'var(--cn-line)'
    : fuel!.state !== 'LIVE' ? 'var(--cn-unknown)'
    : fuelPct < 20 ? 'var(--cn-critical)'
    : fuelPct < 35 ? 'var(--cn-warning)'
    : 'var(--cn-verified)';

  return (
    <button
      onClick={() => onClick(v)}
      className="cn-panel w-full text-left p-4 flex flex-col gap-3 hover:bg-bezel transition-colors"
      style={{ borderColor: TOKEN_COLOR[token] }}
    >
      {/* Başlık */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot verdict={j.verdict} offline={offline} />
          <div className="min-w-0">
            <div className={`text-[15px] text-t1 truncate ${isFallbackTitle(v) ? 'cn-num' : 'cn-display'}`}>
              {vehicleTitle(v)}
            </div>
            <div className="cn-num text-[10px] text-t3 truncate">
              {vehicleSubtitle(v) ?? 'isim verilmedi'}
            </div>
          </div>
        </div>
        <EvidenceBadge verdict={offline ? 'NO_EVIDENCE' : j.verdict} compact />
      </div>

      {/* Ölçümler */}
      <div className="grid grid-cols-3 gap-2 border-t border-hair-soft pt-3">
        <Metric label="Hız" m={t?.speedKmh} unit="km/h" />
        <Metric label="Motor" m={t?.engineTempC} unit="°C" />
        <Metric label="RPM" m={t?.rpm} unit="" />
      </div>

      {/* Yakıt — bilinmiyorsa çubuk YOK */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="cn-eyebrow">Yakıt</span>
          <span
            className="cn-num text-[11px]"
            style={{ color: measurementColor(fuel, 35, 20) }}
          >
            {fuel ? measurementLabel(fuel, '%') : 'Veri yok'}
          </span>
        </div>
        {fuelKnown ? (
          <div className="h-1.5" style={{ background: 'var(--cn-line-soft)' }}>
            <div className="h-full" style={{ width: `${fuelPct}%`, background: fuelBarColor }} />
          </div>
        ) : (
          <div
            className="h-1.5"
            style={{
              background:
                'repeating-linear-gradient(45deg, var(--cn-line) 0 4px, transparent 4px 8px)',
            }}
            title="Yakıt ölçümü yok — çubuk çizilmez"
          />
        )}
      </div>

      {/* Kanıt satırı */}
      <div className="cn-num text-[10px] text-t3 leading-relaxed border-t border-hair-soft pt-2.5">
        <span style={{ color: TOKEN_COLOR[token] }}>
          {offline ? 'ÇEVRİMDIŞI' : verdictLabel(j.verdict)}
        </span>
        {' · '}{j.reason}
        <span className="block">
          {t ? locationLabel(t) : 'konum bilinmiyor'}
          {t && ` · ${dataSourceLabel(t.locationSource)}`}
        </span>
        <span className="block">
          ünite {agoLabel(t?.deviceAgeMs ?? null)} · {evidenceLine(j.readings.engineTemp)}
        </span>
      </div>
    </button>
  );
}

function Metric({ label, m, unit }: { label: string; m: Measurement | undefined; unit: string }) {
  const known = m != null && m.value !== null;
  return (
    <div>
      <div className="cn-eyebrow">{label}</div>
      <div
        className="cn-num text-[14px] mt-1"
        style={{ color: known ? (m!.state === 'LIVE' ? 'var(--cn-text-1)' : 'var(--cn-text-3)') : 'var(--cn-unknown)' }}
      >
        {known ? `${m!.value}${unit ? ` ${unit}` : ''}` : <span className="text-[10px]">YOK</span>}
      </div>
    </div>
  );
}
