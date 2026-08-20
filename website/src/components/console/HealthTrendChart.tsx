'use client';

/**
 * FİLO SAĞLIK SERİSİ — günlük kritik / uyarı olay sayısı (#662).
 *
 * ── FORM KARARI (ölçüme dayalı, tercihe değil) ────────────────────────────
 * İki seri TEK grafikte yan yana boyanMAZ; ayrı katlar (small multiples)
 * hâlinde çizilir. Gerekçe ölçüldü: konsol paletinde gündüz temasında
 * kritik (#C13527) ↔ uyarı (#B0741E) ayrımı normal görüşte ΔE 13,5 —
 * güvenli eşiğin (15) ALTINDA; deutan görüşte ΔE 6,4. Yani bu iki rengi aynı
 * eksende bitişik boyamak, tam renk görüşü olan okuyucu için bile ayırt
 * edilemez bir grafik üretirdi. Palet tasarım sisteminin sabitidir; o yüzden
 * ÇÖZÜM RENKTE DEĞİL FORMDA arandı: iki seri hiç yan yana gelmez.
 *
 * İkincil kodlama (renk tek başına anlam taşımaz): her katın kendi başlığı,
 * kendi rozeti, tepe sütunda doğrudan sayı etiketi ve tablo görünümü vardır.
 *
 * Tek eksen. Katlar ORTAK tavanı paylaşır — yükseklikler karşılaştırılabilir.
 * Saf çizim: veri çekmez, timer kurmaz.
 */

import { useId } from 'react';
import type { DayBucket } from '@/lib/console/reportsModel';
import { shortDayLabel } from '@/lib/console/reportsModel';

type SeriesKey = 'critical' | 'warning';

const SERIES: Record<SeriesKey, { title: string; color: string; label: string }> = {
  critical: { title: 'Kritik olaylar', color: 'var(--cn-critical)', label: 'KRİTİK' },
  warning:  { title: 'Uyarı olayları', color: 'var(--cn-warning)',  label: 'UYARI' },
};

interface Props {
  buckets: readonly DayBucket[];
  /** Katların paylaştığı tavan; 0 ise eksen 1'e sabitlenir (düz taban çizgisi). */
  max: number;
}

export default function HealthTrendChart({ buckets, max }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
      {(Object.keys(SERIES) as SeriesKey[]).map((key) => (
        <Facet key={key} seriesKey={key} buckets={buckets} max={max} />
      ))}
    </div>
  );
}

function Facet({
  seriesKey,
  buckets,
  max,
}: {
  seriesKey: SeriesKey;
  buckets: readonly DayBucket[];
  max: number;
}) {
  const titleId = useId();
  const meta = SERIES[seriesKey];
  const ceiling = max > 0 ? max : 1;

  /* Geometri — sabit viewBox, kap genişliğine ölçeklenir. */
  const W = 420, H = 150;
  const padL = 26, padR = 8, padT = 14, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = buckets.length || 1;
  const slot = plotW / n;
  /* 2 px yüzey boşluğu — bitişik sütunlar birbirine yapışmaz. */
  const barW = Math.max(3, slot - 4);

  const peak = buckets.reduce(
    (best, b, i) => (b[seriesKey] > (buckets[best]?.[seriesKey] ?? -1) ? i : best),
    0,
  );
  const peakValue = buckets[peak]?.[seriesKey] ?? 0;

  return (
    <figure className="m-0">
      <figcaption className="flex items-center gap-2 mb-2">
        <span aria-hidden style={{ width: 9, height: 9, background: meta.color, display: 'inline-block' }} />
        <span className="cn-eyebrow" id={titleId}>{meta.title}</span>
        <span className="cn-num text-[10px] text-t3 ml-auto">
          en yüksek {peakValue} · {shortDayLabel(buckets[peak]?.at ?? 0)}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby={titleId}
      >
        {/* Izgara — geri planda, ince */}
        {[0, 0.5, 1].map((t) => {
          const y = padT + plotH - t * plotH;
          return (
            <g key={t}>
              <line
                x1={padL} y1={y} x2={W - padR} y2={y}
                stroke="var(--cn-line)" strokeWidth={1}
                opacity={t === 0 ? 1 : 0.45}
              />
              <text
                x={padL - 6} y={y}
                fill="var(--cn-text-3)" fontSize={9}
                fontFamily="var(--font-mono), monospace"
                textAnchor="end" dominantBaseline="middle"
              >
                {Math.round(t * ceiling)}
              </text>
            </g>
          );
        })}

        {/* Sütunlar */}
        {buckets.map((b, i) => {
          const value = b[seriesKey];
          const h = (value / ceiling) * plotH;
          const x = padL + i * slot + (slot - barW) / 2;
          const y = padT + plotH - h;
          return (
            <g key={b.key}>
              {value > 0 && (
                <rect
                  x={x} y={y} width={barW} height={Math.max(h, 2)}
                  fill={meta.color} rx={2} ry={2}
                />
              )}
              {/* Sıfır günü de görünür kalsın — "veri yok" ile karışmasın */}
              {value === 0 && (
                <rect
                  x={x} y={padT + plotH - 1.5} width={barW} height={1.5}
                  fill="var(--cn-line)"
                />
              )}
              <title>{`${shortDayLabel(b.at)} — ${value} ${meta.label.toLocaleLowerCase('tr-TR')} olayı`}</title>
            </g>
          );
        })}

        {/* Tepe noktasında doğrudan etiket (her sütuna sayı basılmaz) */}
        {peakValue > 0 && (
          <text
            x={padL + peak * slot + slot / 2}
            y={padT + plotH - (peakValue / ceiling) * plotH - 4}
            fill="var(--cn-text-1)" fontSize={10}
            fontFamily="var(--font-mono), monospace"
            textAnchor="middle"
          >
            {peakValue}
          </text>
        )}

        {/* X ekseni — ilk, orta, son gün */}
        {[0, Math.floor(n / 2), n - 1].map((i) => {
          const b = buckets[i];
          if (!b) return null;
          return (
            <text
              key={`x-${b.key}`}
              x={padL + i * slot + slot / 2}
              y={H - 6}
              fill="var(--cn-text-3)" fontSize={9}
              fontFamily="var(--font-mono), monospace"
              textAnchor="middle"
            >
              {shortDayLabel(b.at)}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}
