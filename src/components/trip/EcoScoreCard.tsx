/**
 * EcoScoreCard — Eko sürüş puanı (Seyir Defteri).
 *
 * Hesap `ecoScoreModel`de (SAF). Bu bileşenler yalnız gösterir: puan yoksa
 * sayı basmaz, NEDEN'ini yazar. Puan yalnız yolculuk bittikten sonra ve
 * Seyir Defteri'nde görünür — sürüş sırasında canlı puan yoktur.
 */
import { memo, useMemo } from 'react';
import { Gauge, Lightbulb, ChevronDown } from 'lucide-react';
import type { TripRecord } from '../../platform/tripLogService';
import {
  buildEcoWeek, ecoBand,
  ECO_DIMENSION_COPY, ECO_BAND_LABEL, ECO_STATUS_COPY, ECO_ALL_GOOD_COPY,
  type EcoBand, type EcoDimension, type TripEcoScore,
} from '../../platform/trip/ecoScoreModel';

/* Bant → kanonik --oem-* durum token'ı. */
const BAND_TONE: Record<EcoBand, string> = {
  excellent: 'var(--oem-good)',
  good:      'var(--oem-good)',
  fair:      'var(--oem-warn)',
  poor:      'var(--oem-danger)',
};

const BAND_CHIP: Record<EcoBand, string> = {
  excellent: 'bg-[var(--oem-good-soft)] text-[color:var(--oem-good)]',
  good:      'bg-[var(--oem-good-soft)] text-[color:var(--oem-good)]',
  fair:      'bg-[var(--oem-warn-soft)] text-[color:var(--oem-warn)]',
  poor:      'bg-[var(--oem-danger-soft)] text-[color:var(--oem-danger)]',
};

/* ── Halka ─────────────────────────────────────────────────────────────── */

function EcoRing({ score, band }: { score: number | null; band: EcoBand | null }) {
  const size = 96;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = band ? BAND_TONE[band] : undefined;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--oem-line)" strokeWidth={stroke} />
        {score !== null && tone && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-primary font-black text-3xl tabular-nums leading-none">{score ?? '—'}</span>
        {band && (
          <span className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: tone }}>
            {ECO_BAND_LABEL[band]}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Boyut satırı ──────────────────────────────────────────────────────── */

function DimRow({ d, showMetric }: { d: EcoDimension; showMetric: boolean }) {
  const copy = ECO_DIMENSION_COPY[d.id];
  const tone = d.score === null ? undefined : BAND_TONE[ecoBand(d.score)];
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold text-[color:var(--oem-ink)]">{copy.title}</span>
        <span className="text-[11px] font-black tabular-nums" style={tone ? { color: tone } : undefined}>
          {d.score ?? '—'}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--oem-line)] overflow-hidden">
        {d.score !== null && (
          <div className="h-full rounded-full" style={{ width: `${d.score}%`, background: tone }} />
        )}
      </div>
      {showMetric && (
        <span className="text-[10px] text-[color:var(--oem-ink-3)] tabular-nums">
          {d.metricPct !== null ? `${copy.metric}: %${d.metricPct}` : 'Yeterli gözlem yok'}
        </span>
      )}
    </div>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-[12px] leading-snug text-[color:var(--oem-ink-2)]">
      <Lightbulb className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[color:var(--oem-good)]" />
      <span>{text}</span>
    </div>
  );
}

/* ── Haftalık kart ─────────────────────────────────────────────────────── */

function EcoScoreCardInner({ history, nowMs }: { history: readonly TripRecord[]; nowMs: number }) {
  const week = useMemo(() => buildEcoWeek(history, nowMs), [history, nowMs]);
  if (week.trips === 0) return null;

  const tip = week.score === null
    ? ECO_STATUS_COPY[week.blocker ?? 'NOT_ENOUGH_SIGNAL']
    : week.focus ? ECO_DIMENSION_COPY[week.focus].tip : ECO_ALL_GOOD_COPY;

  return (
    <div className="rounded-2xl p-4 border bg-[var(--oem-surface-2)] border-[var(--oem-line)]"
      data-editable="trip.eco-score" data-editable-type="card">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="w-4 h-4 text-[color:var(--oem-good)]" />
        <span className="text-primary font-black text-xs uppercase tracking-widest">Eko sürüş · bu hafta</span>
        {week.delta !== null && week.delta !== 0 && (
          <span className={`ml-auto text-[11px] font-black tabular-nums px-2 py-0.5 rounded-lg ${
            week.delta > 0
              ? 'bg-[var(--oem-good-soft)] text-[color:var(--oem-good)]'
              : 'bg-[var(--oem-warn-soft)] text-[color:var(--oem-warn)]'}`}
            title={`Geçen hafta: ${week.lastWeekScore}`}>
            {week.delta > 0 ? '+' : ''}{week.delta} geçen haftaya göre
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <EcoRing score={week.score} band={week.band} />
        <div className="flex-1 min-w-0 flex flex-col gap-2.5">
          {week.dimensions.map((d) => <DimRow key={d.id} d={d} showMetric={false} />)}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--oem-line)] flex flex-col gap-1.5">
        <Tip text={tip} />
        <span className="text-[10px] text-[color:var(--oem-ink-3)] tabular-nums">
          {week.trips} yolculuğun {week.scoredTrips} tanesi puanlandı · km ile ağırlıklı
        </span>
      </div>
    </div>
  );
}

export const EcoScoreCard = memo(EcoScoreCardInner);

/* ── Yolculuk kartı: rozet + açılır ayrıntı ────────────────────────────── */

export function TripEcoChip({ result, open, onToggle }: {
  result: TripEcoScore; open: boolean; onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      aria-label={result.score !== null ? `Eko puanı ${result.score}, ayrıntılar` : 'Eko puanı yok, nedeni'}
      className="flex items-center gap-1.5 min-h-[32px] pl-2 active:scale-95 transition-transform">
      <span className="text-[10px] text-[color:var(--oem-ink-3)] uppercase tracking-wide">Eko</span>
      <span className={`text-xs font-black tabular-nums px-2 py-0.5 rounded-lg ${
        result.band ? BAND_CHIP[result.band] : 'text-[color:var(--oem-ink-3)] border border-[var(--oem-line)]'}`}>
        {result.score ?? '—'}
      </span>
      <ChevronDown className={`w-3.5 h-3.5 text-[color:var(--oem-ink-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

export function TripEcoDetail({ result }: { result: TripEcoScore }) {
  if (result.status !== 'OK') {
    return (
      <div className="mt-2 pt-2 border-t border-[var(--oem-line)] text-[11px] text-[color:var(--oem-ink-3)]">
        {ECO_STATUS_COPY[result.status]}
      </div>
    );
  }
  return (
    <div className="mt-2 pt-3 border-t border-[var(--oem-line)] flex flex-col gap-2.5">
      {result.dimensions.map((d) => <DimRow key={d.id} d={d} showMetric />)}
      <Tip text={result.focus ? ECO_DIMENSION_COPY[result.focus].tip : ECO_ALL_GOOD_COPY} />
    </div>
  );
}
