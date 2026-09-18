'use client';

/**
 * ARACINIZIN DURUMU — OEM++ sağlık kartı (F2.2).
 *
 * ── BU BİLEŞEN HÜKÜM VERMEZ ──────────────────────────────────────────────
 * Tek işi `buildVehicleHealthSummary` projeksiyonunu RENDER etmektir. Burada
 * eşik yok, severity yok, "arıza yok" kararı yok. UI'da karar üretmek, F2.1'de
 * kapatılan yalanı (taşıma başarısını ölçüm başarısı sanmak) geri getirirdi.
 *
 * Kart yeni komut GÖNDERMEZ: aracın daha önce yazdığı ölçümü okur. Tarama
 * başlatmak kullanıcının açık eylemidir ve altındaki teşhis panelinde durur.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import {
  buildVehicleHealthSummary,
  healthMeasuredAtLabel,
  type VehicleHealthSummary,
} from '@/lib/diagnostics/vehicleHealth';
import {
  readLatestDtcOutcome,
  readLatestVoltageOutcome,
} from '@/lib/diagnostics/dtcResultReader';
import type { Verdict } from '@/lib/console/evidenceModel';

/* ── Görsel dil ────────────────────────────────────────────────────────────
   Korkutucu kırmızı YALNIZ `CRITICAL`de. `NO_EVIDENCE` sakin gri: "bilmiyoruz"
   bir hata durumu gibi gösterilmez (§16). */
const TONE: Record<Verdict, { fg: string; bg: string; border: string; glyph: string }> = {
  VERIFIED:    { fg: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.22)', glyph: '✓' },
  WARNING:     { fg: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.25)', glyph: '!' },
  CRITICAL:    { fg: '#f87171', bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.28)',  glyph: '!' },
  NO_EVIDENCE: { fg: 'rgba(255,255,255,0.45)', bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', glyph: '—' },
};

interface Props {
  vehicle: LiveVehicle | null;
}

function VehicleHealthCardBase({ vehicle }: Props) {
  const [summary, setSummary] = useState<VehicleHealthSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const vehicleId = vehicle?.id ?? null;
  const telemetry = vehicle?.telemetry;

  const load = useCallback(async () => {
    if (!vehicleId) { setSummary(null); return; }
    setLoading(true);
    /* İki okuma de RLS üzerinden ve PARALEL: yetki sunucudadır, burada ikinci
       bir yetki katmanı kurulmaz. Okunamayan kanıt `null` kalır — sahte veri
       ÜRETİLMEZ, projeksiyon onu "kanıt yok" olarak işler. */
    const [dtc, voltage] = await Promise.all([
      readLatestDtcOutcome(vehicleId),
      readLatestVoltageOutcome(vehicleId),
    ]);
    if (!mounted.current) return;
    setSummary(buildVehicleHealthSummary({
      now: Date.now(),
      freshness: telemetry,
      dtc,
      voltage,
    }));
    setLoading(false);
  }, [vehicleId, telemetry]);

  useEffect(() => { void load(); }, [load]);

  if (!vehicle) return null;
  return <HealthCardView summary={summary} loading={loading} now={Date.now()} />;
}

/**
 * SAF GÖRÜNÜM — yalnız projeksiyonu basar.
 *
 * Veri okuma ve hüküm DIŞARIDADIR: burada `fetch` de yoktur, eşik de. Ayrım
 * bilinçlidir — böylece "UI karar üretmiyor" iddiası yapısal olarak DOĞRUDUR
 * ve gerçek render ile sınanabilir.
 */
export function HealthCardView({
  summary,
  loading,
  now,
}: {
  summary: VehicleHealthSummary | null;
  loading: boolean;
  now: number;
}) {
  if (!summary) {
    return (
      <div className="rounded-3xl px-5 py-6"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-xs font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Aracınızın durumu
        </p>
        <p className="mt-3 text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {loading ? 'Sağlık verisi okunuyor…' : 'Sağlık verisi okunamadı'}
        </p>
      </div>
    );
  }

  const tone = TONE[summary.verdict];

  return (
    <section
      className="rounded-3xl px-5 py-5 flex flex-col gap-4"
      style={{ background: tone.bg, border: `1.5px solid ${tone.border}` }}
      aria-label="Aracınızın durumu"
    >
      {/* ── Ana sonuç: ilk bakışta TEK cümle ───────────────────────────── */}
      <div className="flex items-start gap-3.5">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 text-lg font-black"
          style={{ background: `${tone.fg}1f`, border: `1px solid ${tone.fg}3d`, color: tone.fg }}
          aria-hidden="true"
        >
          {tone.glyph}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em]"
            style={{ color: 'rgba(255,255,255,0.32)' }}>
            Aracınızın durumu
          </p>
          <h2 className="mt-1 text-lg font-black leading-tight" style={{ color: tone.fg }}>
            {summary.headline}
          </h2>
          <p className="mt-1.5 text-[13px] leading-snug" style={{ color: 'rgba(255,255,255,0.62)' }}>
            {summary.explanation}
          </p>
          <p className="mt-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {healthMeasuredAtLabel(summary, now)}
          </p>
        </div>
      </div>

      {/* ── Arıza kodları: araçtan geldiği kadarıyla ───────────────────── */}
      {summary.dtcs.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Tespit edilen arıza kodları">
          {summary.dtcs.map((d) => (
            <li key={d.code}
              className="flex items-baseline gap-2 px-3 py-2 rounded-xl"
              style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span className="text-[11px] font-black tracking-wider flex-shrink-0" style={{ color: tone.fg }}>
                {d.code}
              </span>
              <span className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.72)' }}>
                {d.desc}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Kanıtlar: veri yoksa SAHTE KART DOLDURULMAZ ─────────────────── */}
      <ul className="grid grid-cols-3 gap-2" aria-label="Sağlık kanıtları">
        {summary.evidence.map((e) => {
          const t = TONE[e.verdict];
          return (
            <li key={e.id}
              className="px-2.5 py-2.5 rounded-xl flex flex-col gap-1"
              style={{ background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span className="text-[9px] font-black uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.3)' }}>
                {e.label}
              </span>
              <span className="text-[11px] font-bold leading-snug" style={{ color: t.fg }}>
                {e.detail}
              </span>
            </li>
          );
        })}
      </ul>

      {/* ── Kapsam sınırları: hükmün NEYİ kapsamadığı ───────────────────── */}
      {summary.limitations.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Değerlendirme sınırları">
          {summary.limitations.map((l) => (
            <li key={l} className="text-[11px] leading-snug pl-3 relative"
              style={{ color: 'rgba(255,255,255,0.34)' }}>
              <span aria-hidden="true" className="absolute left-0">·</span>
              {l}
            </li>
          ))}
        </ul>
      )}

      {/* ── BAĞLANTI: sağlıkla KARIŞTIRILMAZ (§11) ──────────────────────── */}
      <div className="flex items-center justify-between pt-3"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-[10px] font-black uppercase tracking-wider"
          style={{ color: 'rgba(255,255,255,0.28)' }}>
          Bağlantı
        </span>
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {summary.connection.label} · son veri {summary.connection.lastSeenLabel}
        </span>
      </div>
    </section>
  );
}

export const VehicleHealthCard = memo(VehicleHealthCardBase);
export default VehicleHealthCard;
