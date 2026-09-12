'use client';

/**
 * DriverDnaCard — Fleet UI · SÜRÜCÜ DNA KARTI.
 *
 * Araç detayında ve sürücü detayında kullanılan SALT-OKUNUR karttır.
 *
 * ── BU BİR PUAN KARTI DEĞİLDİR ────────────────────────────────────────
 * Not verilmez, sıralanmaz, "iyi/kötü sürücü" denmez. Kart yalnız
 * kanıtın ne kadar olduğunu ve NEREDE OLMADIĞINI gösterir.
 *
 * ── DÜRÜSTLÜK KURALLARI ───────────────────────────────────────────────
 *   · Eşik altında DNA GÖSTERİLMEZ — nedeni yazılır (boş kart yok).
 *   · Kanıtı olmayan oran `—` gösterilir, **`0` değil**.
 *   · Sürücü değişimi nedeniyle katkı geri alındıysa bu GİZLENMEZ.
 *   · Hiçbir metrik "tahmin" olarak süslenmez; tahmin katmanı ayrıdır.
 */

import {
  buildDriverDnaView, dnaStatusLabel, dnaLearningLevelLabel, dnaDriftLabel,
  dnaAbsenceExplanation,
  type DriverDnaRow,
} from '@/lib/fleet/driverDnaView';

export interface DriverDnaCardProps {
  /** `get_driver_dna()` satırı; yoksa `null`. */
  readonly row: DriverDnaRow | null;
  /** Sürücü referansı — **AD DEĞİL** (kart paylaşılabilir olmalı). */
  readonly driverRef?: string;
}

function fmt(n: number | null, digits = 1): string {
  return n === null ? '—' : n.toFixed(digits);
}

function ageText(fromMs: number | null, nowMs: number): string {
  if (fromMs === null) return '—';
  const d = Math.max(0, nowMs - fromMs);
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} dk`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} sa`;
  return `${Math.floor(d / 86_400_000)} gün`;
}

export function DriverDnaCard({ row, driverRef }: DriverDnaCardProps) {
  const v = buildDriverDnaView(row);
  const now = Date.now();

  return (
    <section
      data-testid="driver-dna-card"
      data-dna-status={v.status}
      className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
    >
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">Sürücü DNA</h3>
          <p className="text-[11px] text-neutral-500">
            Sürüş karakteri — puan değil, kanıt.
          </p>
        </div>
        <span
          data-testid="dna-learning-level"
          className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300"
        >
          {dnaLearningLevelLabel(v.learningLevel)}
        </span>
      </header>

      {/* DNA YOKSA: boş kart değil, GEREKÇE. */}
      {!v.present ? (
        <p data-testid="dna-absent" className="text-[12px] text-neutral-400">
          {dnaAbsenceExplanation(v)}
          {v.tripCount !== null && (
            <span className="mt-1 block text-[11px] text-neutral-500">
              Şu ana kadar {v.tripCount} yolculuk
              {v.totalDistanceKm !== null && ` · ${fmt(v.totalDistanceKm)} km`}
            </span>
          )}
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 text-[12px]">
            <div>
              <span className="text-neutral-500">Durum</span>
              <div data-testid="dna-status" className="text-neutral-200">
                {dnaStatusLabel(v.status)}
              </div>
            </div>
            <div>
              <span className="text-neutral-500">Yolculuk</span>
              <div className="text-neutral-200">{v.tripCount ?? '—'}</div>
            </div>
            <div>
              <span className="text-neutral-500">Toplam mesafe</span>
              <div className="text-neutral-200">{fmt(v.totalDistanceKm)} km</div>
            </div>
            <div>
              <span className="text-neutral-500">DNA yaşı</span>
              <div className="text-neutral-200">{ageText(v.firstTripAtMs, now)}</div>
            </div>
          </div>

          {/* Oranlar — kanıtı olmayan `—` (0 DEĞİL). */}
          <ul className="mb-3 flex flex-col gap-1">
            {v.rates.map((r) => (
              <li
                key={r.label}
                data-testid={`dna-rate-${r.provenance}`}
                className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950/50 px-2 py-1 text-[12px]"
              >
                <span className="text-neutral-300">{r.label}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-neutral-200">
                    {r.value === null ? '—' : `${fmt(r.value, 2)} ${r.unit}`.trim()}
                  </span>
                  <span className="rounded border border-neutral-700 px-1 text-[10px] text-neutral-500">
                    {r.provenance}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              data-testid="dna-drift"
              className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300"
            >
              Değişim: {dnaDriftLabel(v.driftState)}
              {v.driftRelativeChange !== null && v.driftState === 'DRIFTING'
                && ` (%${Math.round(v.driftRelativeChange * 100)})`}
            </span>
            {v.unknownRateCount > 0 && (
              <span data-testid="dna-unknown-count" className="text-neutral-500">
                {v.unknownRateCount} ölçüm bilinmiyor
              </span>
            )}
            {/* Geri alma GİZLENMEZ: karakterin bir bölümü başka sürücüye taşındı. */}
            {v.retracted && (
              <span data-testid="dna-retracted" className="text-amber-500">
                {v.retractedTripCount} yolculuk başka sürücüye taşındı
              </span>
            )}
            <span className="text-neutral-600">
              Güncelleme: {ageText(v.updatedAtMs, now)} önce
            </span>
          </div>
        </>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-neutral-600">
        DNA bir puan değildir; sürücü sıralanmaz veya etiketlenmez. Kanıtı
        olmayan ölçüm <strong>boş bırakılır</strong> — <code>0</code> değil.
        Karakter, yeterli yolculuk birikmeden oluşmaz.
        {driverRef !== undefined && (
          <span className="ml-1 text-neutral-700">({driverRef})</span>
        )}
      </p>
    </section>
  );
}

export default DriverDnaCard;
