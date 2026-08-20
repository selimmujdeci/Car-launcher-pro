'use client';

/**
 * TANI — Kanıt Konsolu dili (#663).
 *
 * ── DÜZELTİLEN SESSİZ KUSUR ───────────────────────────────────────────────
 * Bu ekran ölçümleri ESKİ SAYISAL YÜZEYDEN okuyordu (`v.engineTemp`, `v.fuel`,
 * `v.rpm`). O yüzey bilinmeyeni `0` ile doldurur; sonuç: hiç telemetri almamış
 * bir araç ekranda **"Yakıt %0"** (kırmızı) ve **"Motor 0°C"** gösteriyordu —
 * yani ölçüm yokken sahte alarm üretiyordu. Artık okuma `telemetry` gerçek
 * katmanından yapılır ve bilinmeyen `KANIT YOK` yazar.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { useVehicleStore } from '@/store/vehicleStore';
import { vehicleTitle, vehicleSubtitle, isFallbackTitle } from '@/lib/vehicleDisplay';
import {
  judgeVehicle,
  verdictLabel,
  verdictToken,
  agoLabel,
  evidenceLine,
} from '@/lib/console/evidenceModel';
import { measurementLabel } from '@/lib/fleet/vehicleTelemetryFreshness';
import {
  Panel,
  PanelHead,
  EvidenceBadge,
  StatusDot,
  EmptyState,
  TOKEN_COLOR,
} from '@/components/console/primitives';

export default function DiagnosticPage() {
  const vehicles = useVehicleStore((s) => s.getList());

  const judged = useMemo(
    () =>
      vehicles.map((v) => ({
        v,
        j: judgeVehicle(v.telemetry, v.batteryVoltage ?? null),
        offline: v.status === 'offline',
      })),
    [vehicles],
  );

  const critical = judged.filter((x) => x.j.verdict === 'CRITICAL');

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {/* Aktif kritik hükümler */}
      {critical.length > 0 && (
        <Panel>
          <PanelHead title="Aktif kritik hüküm" meta={`${critical.length} araç`} />
          <ul className="divide-y" style={{ borderColor: 'var(--cn-line-soft)' }}>
            {critical.map(({ v, j }) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                <span aria-hidden style={{ width: 4, height: 30, background: 'var(--cn-critical)' }} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[14px] text-t1 ${isFallbackTitle(v) ? 'cn-num' : 'cn-display'}`}>
                    {vehicleTitle(v)}
                  </div>
                  <div className="cn-num text-[10px] text-t3 mt-0.5">
                    {j.reason} · {evidenceLine(j.readings.engineTemp)}
                  </div>
                </div>
                <Link
                  href={`/dashboard/fleet/vehicles/${v.id}`}
                  className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1 flex-shrink-0"
                  style={{ borderRadius: 2 }}
                >
                  DETAY
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <PanelHead title="Araç sağlık özeti" meta={`${vehicles.length} araç · ölçülen telemetriden`} />
        {vehicles.length === 0 ? (
          <EmptyState
            title="BAĞLI ARAÇ YOK"
            detail="Araç eşleştirildiğinde tanı özeti burada belirir."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 p-3">
            {judged.map(({ v, j, offline }) => {
              const t = v.telemetry;
              const token = offline ? 'unknown' : verdictToken(j.verdict);
              return (
                <article
                  key={v.id}
                  className="cn-panel p-4 flex flex-col gap-3"
                  style={{ borderColor: TOKEN_COLOR[token] }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot verdict={j.verdict} offline={offline} />
                      <div className="min-w-0">
                        <div className={`text-[14px] text-t1 truncate ${isFallbackTitle(v) ? 'cn-num' : 'cn-display'}`}>
                          {vehicleTitle(v)}
                        </div>
                        <div className="cn-num text-[10px] text-t3 truncate">
                          {vehicleSubtitle(v) ?? 'isim verilmedi'}
                        </div>
                      </div>
                    </div>
                    <EvidenceBadge verdict={offline ? 'NO_EVIDENCE' : j.verdict} compact />
                  </div>

                  <dl className="flex flex-col gap-2 border-t border-hair-soft pt-3">
                    {[
                      { label: 'Motor ısısı', m: t?.engineTempC, unit: '°C' },
                      { label: 'RPM', m: t?.rpm, unit: '' },
                      { label: 'Yakıt', m: t?.fuelPercent, unit: '%' },
                      { label: 'Hız', m: t?.speedKmh, unit: 'km/h' },
                    ].map(({ label, m, unit }) => {
                      const known = m != null && m.value !== null;
                      return (
                        <div key={label} className="flex items-center justify-between">
                          <dt className="cn-eyebrow">{label}</dt>
                          <dd
                            className="cn-num text-[12px]"
                            style={{
                              color: !known
                                ? 'var(--cn-unknown)'
                                : m!.state === 'LIVE'
                                ? 'var(--cn-text-1)'
                                : 'var(--cn-text-3)',
                            }}
                          >
                            {m ? measurementLabel(m, unit) : 'Veri yok'}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>

                  <div className="cn-num text-[10px] text-t3 border-t border-hair-soft pt-2.5 leading-relaxed">
                    <span style={{ color: TOKEN_COLOR[token] }}>
                      {offline ? 'ÇEVRİMDIŞI' : verdictLabel(j.verdict)}
                    </span>
                    {' · '}{j.reason}
                    <span className="block">ünite {agoLabel(t?.deviceAgeMs ?? null)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHead title="Arıza kodları (DTC)" meta="araç bazlı okuma" />
        <EmptyState
          title="DTC ARAÇ DETAYINDA"
          detail="Arıza kodu taraması araç başına yapılır ve sonucu araç detay ekranında görünür. Tarama yapılmamış araçta 'arıza yok' DENMEZ — tarama olmadan hüküm verilmez."
        />
        <div className="px-4 pb-4">
          <Link
            href="/dashboard/fleet/vehicles"
            className="cn-num text-[10px] uppercase tracking-[0.16em]"
            style={{ color: 'var(--cn-copper)' }}
          >
            Araç kapsamına git →
          </Link>
        </div>
      </Panel>
    </div>
  );
}
