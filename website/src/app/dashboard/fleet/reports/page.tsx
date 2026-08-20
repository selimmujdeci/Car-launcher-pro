'use client';

/**
 * RAPORLAR — filo sağlık özeti + araç bazlı dışa aktarma (#662).
 *
 * DÜRÜSTLÜK: zaman serisi bir ÖLÇÜM DEĞİL TÜRETİMDİR (geçmiş sağlık durumu
 * saklanmıyor; elimizdeki tek kanıt olay/bildirim günlüğü). Ekran bunu
 * `TÜRETİLDİ` rozetiyle ve açık bir cümleyle söyler — "o gün kaç araç
 * kritikti" İDDİA EDİLMEZ.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVehicleStore } from '@/store/vehicleStore';
import { fetchDecisionLog, type DecisionEvent } from '@/lib/console/consoleSources';
import { bucketByDay, sharedMax, totals, shortDayLabel } from '@/lib/console/reportsModel';
import {
  judgeVehicle,
  tallyFleet,
  verdictLabel,
  verdictToken,
  agoLabel,
  evidenceLine,
} from '@/lib/console/evidenceModel';
import { trNumber } from '@/lib/console/exportModel';
import HealthTrendChart from '@/components/console/HealthTrendChart';
import DownloadCsvButton from '@/components/console/DownloadCsvButton';
import {
  Panel,
  PanelHead,
  StatTile,
  EmptyState,
  EvidenceBadge,
  TOKEN_COLOR,
} from '@/components/console/primitives';
import { vehicleTitle } from '@/lib/vehicleDisplay';

const WINDOW_DAYS = 14;

export default function ReportsPage() {
  const vehicles = useVehicleStore((s) => s.getList());

  const [log, setLog] = useState<DecisionEvent[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'unreadable'>('loading');
  const [showTable, setShowTable] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    /* Pencere 14 gün: günlük olay yoğunluğuna göre üst sınır bilinçli geniş. */
    const rows = await fetchDecisionLog(400);
    if (!mountedRef.current) return;
    setNow(Date.now());
    if (rows === null) { setState('unreadable'); return; }
    setLog(rows);
    setState('ok');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const buckets = useMemo(
    () => bucketByDay(log ?? [], now, WINDOW_DAYS),
    [log, now],
  );
  const max = useMemo(() => sharedMax(buckets), [buckets]);
  const sums = useMemo(() => totals(buckets), [buckets]);

  const judged = useMemo(
    () =>
      vehicles.map((v) => ({
        v,
        j: judgeVehicle(v.telemetry, v.batteryVoltage ?? null),
        offline: v.status === 'offline',
      })),
    [vehicles],
  );
  const tally = useMemo(
    () => tallyFleet(judged.map((x) => ({ verdict: x.j.verdict, offline: x.offline }))),
    [judged],
  );

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {/* ── Anlık hüküm dağılımı (ÖLÇÜM) ── */}
      <Panel>
        <PanelHead
          title="Filo sağlık dağılımı"
          meta="şu anki hüküm · ölçülen telemetriden"
          action={<EvidenceBadge verdict={tally.total === 0 ? 'NO_EVIDENCE' : 'VERIFIED'} compact />}
        />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 lg:gap-3 p-3">
          <StatTile label="Toplam araç" count={tally.total} token="copper" />
          <StatTile label="Kritik" count={tally.critical} token="critical" />
          <StatTile label="Uyarı" count={tally.warning} token="warning" />
          <StatTile label="Kanıtlı sağlıklı" count={tally.verified} token="verified" />
          <StatTile label="Kanıt bekliyor" count={tally.noEvidence} token="unknown" />
        </div>
        {tally.total > 0 && <DistributionBar tally={tally} />}
      </Panel>

      {/* ── Zaman serisi (TÜRETİM) ── */}
      <Panel>
        <PanelHead
          title={`Son ${WINDOW_DAYS} gün — olay yoğunluğu`}
          meta="TÜRETİLDİ · olay ve bildirim günlüğünden"
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTable((s) => !s)}
                aria-pressed={showTable}
                className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1"
                style={{ borderRadius: 2 }}
              >
                {showTable ? 'GRAFİK' : 'TABLO'}
              </button>
              <DownloadCsvButton
                filePrefix="filo-olay-serisi"
                headers={['Gün', 'Kritik', 'Uyarı', 'Bilgi']}
                rows={buckets.map((b) => [b.key, b.critical, b.warning, b.info])}
              />
              <button
                onClick={() => { if (typeof window !== 'undefined') window.print(); }}
                title="Tarayıcının yazdır diyaloğunda 'PDF olarak kaydet' seçilebilir"
                className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1"
                style={{ borderRadius: 2 }}
              >
                PDF / YAZDIR
              </button>
              <button
                onClick={() => void load()}
                className="cn-num text-[9px] uppercase tracking-[0.16em] px-2 py-1 border border-hair text-t2 hover:text-t1"
                style={{ borderRadius: 2 }}
              >
                YENİLE
              </button>
            </div>
          }
        />

        <p className="px-4 py-2 text-[11px] text-t3 leading-relaxed border-b border-hair-soft">
          Bu seri <strong className="text-t2">ölçülmüş bir sağlık geçmişi değildir</strong>: araçların
          geçmiş sağlık durumu saklanmıyor. Gösterilen, o gün düşen kritik ve uyarı
          <strong className="text-t2"> olay</strong> sayısıdır. "O gün kaç araç kritikti" iddia edilmez.
        </p>

        {state === 'loading' ? (
          <EmptyState title="SERİ HESAPLANIYOR" />
        ) : state === 'unreadable' ? (
          <EmptyState
            title="OLAY GÜNLÜĞÜ OKUNAMADI"
            detail="Seri türetilemedi. Bu, 'olay yok' anlamına GELMEZ — grafik yerine boş bir eğri çizmiyoruz."
          />
        ) : showTable ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-hair">
                  {['Gün', 'Kritik', 'Uyarı', 'Bilgi'].map((h) => (
                    <th key={h} className="cn-eyebrow px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.key} className="border-b border-hair-soft">
                    <td className="px-3 py-2 cn-num text-[11px] text-t2">{shortDayLabel(b.at)}</td>
                    <td className="px-3 py-2 cn-num text-[12px]" style={{ color: TOKEN_COLOR.critical }}>{b.critical}</td>
                    <td className="px-3 py-2 cn-num text-[12px]" style={{ color: TOKEN_COLOR.warning }}>{b.warning}</td>
                    <td className="px-3 py-2 cn-num text-[12px] text-t2">{b.info}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : sums.empty ? (
          <EmptyState
            title="BU PENCEREDE OLAY YOK"
            detail={`Son ${WINDOW_DAYS} günde kritik, uyarı ya da bilgi olayı düşmedi. Bu ölçülmüş bir gözlemdir — okunamama durumu ayrıca belirtilir.`}
          />
        ) : (
          <HealthTrendChart buckets={buckets} max={max} />
        )}
      </Panel>

      {/* ── Araç bazlı rapor ── */}
      <Panel>
        <PanelHead
          title="Araç bazlı rapor"
          meta={`${judged.length} araç`}
          action={
            <DownloadCsvButton
              filePrefix="arac-raporu"
              headers={[
                'Araç', 'Hüküm', 'Gerekçe', 'Akü (V)', 'Motor (°C)',
                'GPS yaşı (sn)', 'Kilometre', 'Sürücü', 'Son görülme',
              ]}
              rows={judged.map(({ v, j, offline }) => [
                vehicleTitle(v),
                offline ? 'ÇEVRİMDIŞI' : verdictLabel(j.verdict),
                j.reason,
                trNumber(j.readings.battery.value, 1),
                trNumber(j.readings.engineTemp.value, 0),
                trNumber(j.readings.gpsFreshness.value, 0),
                v.odometer > 0 ? v.odometer : '',
                v.driver && v.driver !== '—' ? v.driver : '',
                agoLabel(v.telemetry?.deviceAgeMs ?? null),
              ])}
            />
          }
        />
        {judged.length === 0 ? (
          <EmptyState title="FİLODA ARAÇ YOK" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-hair">
                  {['Araç', 'Hüküm', 'Akü', 'Motor', 'GPS', 'Kanıt'].map((h) => (
                    <th key={h} className="cn-eyebrow px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {judged.map(({ v, j, offline }) => {
                  const token = offline ? 'unknown' : verdictToken(j.verdict);
                  return (
                    <tr key={v.id} className="border-b border-hair-soft">
                      <td className="px-3 py-2 text-[12px] text-t1 whitespace-nowrap">{vehicleTitle(v)}</td>
                      <td className="px-3 py-2 cn-num text-[11px] whitespace-nowrap" style={{ color: TOKEN_COLOR[token] }}>
                        {offline ? 'ÇEVRİMDIŞI' : verdictLabel(j.verdict)}
                      </td>
                      <NumCell value={j.readings.battery.value} digits={1} unit="V" />
                      <NumCell value={j.readings.engineTemp.value} digits={0} unit="°C" />
                      <NumCell value={j.readings.gpsFreshness.value} digits={0} unit="sn" />
                      <td className="px-3 py-2 cn-num text-[10px] text-t3 whitespace-nowrap">
                        {evidenceLine(j.readings.engineTemp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function NumCell({ value, digits, unit }: { value: number | null; digits: number; unit: string }) {
  return (
    <td className="px-3 py-2 cn-num text-[12px] text-t1 whitespace-nowrap">
      {value === null
        ? <span className="text-[10px] text-unknown">YOK</span>
        : `${value.toFixed(digits)} ${unit}`}
    </td>
  );
}

/** Dağılım şeridi — oran görünür, sayı da yazılı (renk tek başına anlam taşımaz). */
function DistributionBar({
  tally,
}: {
  tally: { total: number; critical: number; warning: number; verified: number; noEvidence: number };
}) {
  const segments = [
    { key: 'critical',   label: 'Kritik',          value: tally.critical,   token: 'critical' as const },
    { key: 'warning',    label: 'Uyarı',           value: tally.warning,    token: 'warning' as const },
    { key: 'verified',   label: 'Kanıtlı',         value: tally.verified,   token: 'verified' as const },
    { key: 'noEvidence', label: 'Kanıt bekliyor',  value: tally.noEvidence, token: 'unknown' as const },
  ].filter((s) => s.value > 0);

  return (
    <div className="px-4 pb-4">
      <div className="flex gap-[2px] h-3" role="img" aria-label="Filo hüküm dağılımı">
        {segments.map((s) => (
          <div
            key={s.key}
            title={`${s.label}: ${s.value}`}
            style={{
              flex: s.value,
              background: TOKEN_COLOR[s.token],
              opacity: s.token === 'unknown' ? 0.55 : 1,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 cn-num text-[10px] text-t2">
            <span aria-hidden style={{ width: 7, height: 7, background: TOKEN_COLOR[s.token], display: 'inline-block' }} />
            {s.label} {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}
