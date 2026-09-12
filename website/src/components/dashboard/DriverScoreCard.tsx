'use client';

/**
 * SÜRÜCÜ SKOR KARTI (V-16/4).
 *
 * ── NEDEN AYRI BİR KART ─────────────────────────────────────────────────────
 * `DriverDnaCard`ın kendi başlığı **"Sürüş karakteri — puan değil, kanıt"**
 * diyor: DNA bilinçli olarak sürüşü tek bir sayıya İNDİRGEMEZ. Enterprise
 * sayfası ise "Driver scoring" vaat ediyor. Bu gerçek bir gerilimdir ve
 * sessizce ezilmez.
 *
 * Çözüm: skor DNA kartının İÇİNE konmaz; AYRI bir kart olur ve şu üç kuralı
 * taşır:
 *   ① Skor **asla yalnız** gösterilmez — bileşenleri ve eşikleri hep yanındadır
 *     (opak bir sayıya itiraz edilemez).
 *   ② Kanıt yoksa **skor ÜRETİLMEZ**; yerine NEDEN üretilmediği yazılır.
 *   ③ Türetilmişse, eksik bileşen varsa veya sürüş biçimi değişiyorsa bu
 *     kartın üstünde SÖYLENİR.
 *
 * SALT-OKUNUR ve SAF: veri çekmez, saat okumaz, timer kurmaz.
 */

import { memo, useMemo } from 'react';
import { buildDriverDnaView, type DriverDnaRow } from '@/lib/fleet/driverDnaView';
import {
  computeDriverScore, scoreDisclaimer, SCORE_VERDICT_LABEL, SCORE_BANDS,
} from '@/lib/fleet/driverScore';

interface Props {
  /** `null`/`undefined` = DNA satırı yok (skor üretilmez). */
  readonly row: DriverDnaRow | null | undefined;
}

function fmt(v: number, digits = 1): string {
  return v.toFixed(digits).replace('.', ',');
}

export const DriverScoreCard = memo(function DriverScoreCard({ row }: Props) {
  const score = useMemo(() => computeDriverScore(buildDriverDnaView(row)), [row]);
  const note = useMemo(() => scoreDisclaimer(score), [score]);

  return (
    <section
      data-testid="driver-score-card"
      data-score-verdict={score.verdict}
      className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">Sürücü skoru</h3>
          <p className="text-[11px] text-neutral-500">
            DNA'dan TÜRETİLİR — DNA'nın yerine geçmez.
          </p>
        </div>
        <span className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300">
          {SCORE_VERDICT_LABEL[score.verdict]}
        </span>
      </header>

      {score.verdict === 'OK' && score.score !== null ? (
        <>
          <div className="mb-3 flex items-baseline gap-2">
            <span data-testid="driver-score-value" className="text-2xl font-semibold text-neutral-100">
              {fmt(score.score, 0)}
            </span>
            <span className="text-[11px] text-neutral-500">/ 100</span>
            <span
              data-testid="driver-score-provenance"
              className={`ml-1 rounded border px-1.5 py-0.5 text-[10px] ${
                score.provenance === 'MEASURED'
                  ? 'border-emerald-700 text-emerald-300'
                  : 'border-amber-700 text-amber-300'
              }`}
            >
              {score.provenance === 'MEASURED' ? 'ÖLÇÜLDÜ' : 'TÜRETİLDİ'}
            </span>
          </div>

          {/* Skor ASLA yalnız gösterilmez: gerekçe hep yanında. */}
          <ul className="flex flex-col gap-1">
            {score.components.map((c) => {
              const band = SCORE_BANDS.find((b) => b.label === c.label);
              return (
                <li
                  key={c.label}
                  data-testid={`score-component-${c.label}`}
                  className="flex items-center justify-between gap-2 text-[11px]"
                >
                  <span className="text-neutral-400">{c.label}</span>
                  <span className="text-neutral-300">
                    {fmt(c.value, 2)}{band?.unit}
                    <span className="ml-2 text-neutral-500">
                      → {fmt(c.points, 0)} puan
                    </span>
                    <span className="ml-2 text-neutral-600">
                      (iyi ≤ {fmt(band?.good ?? 0, 2)} · kötü ≥ {fmt(band?.bad ?? 0, 2)} · ağırlık {fmt((band?.weight ?? 0) * 100, 0)}%)
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>

          {score.tripCount !== null && (
            <p className="mt-2 text-[11px] text-neutral-500">
              {score.tripCount} yolculuk birikiminden
            </p>
          )}
        </>
      ) : (
        /* Skor yoksa boş kart DEĞİL, GEREKÇE. */
        <p data-testid="driver-score-absent" className="text-[12px] text-neutral-400">
          {note}
        </p>
      )}

      {score.verdict === 'OK' && (
        <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">{note}</p>
      )}
    </section>
  );
});
