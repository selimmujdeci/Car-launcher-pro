'use client';

/**
 * VARDİYA PANOSU (V-16/6).
 *
 * SALT-OKUNUR: atama oluşturmaz/bitirmez — yazma yolları sayfanın mevcut
 * RPC'lerinde kalır (paralel yazma yolu KURULMAZ).
 *
 * ── VARDİYA = ZAMANLANMIŞ ATAMA ─────────────────────────────────────────────
 * Yeni bir "shifts" tablosu YOK: `vehicle_driver_assignments` zaten araç +
 * sürücü + zaman penceresi tutuyor. Ayrı bir kayıt açmak aynı gerçeğin ikinci
 * otoritesi olurdu.
 *
 * ── ASIL SORU: VARDİYA DIŞI SÜRÜŞ ───────────────────────────────────────────
 * Yalnız vardiyaları listeleyen bir ekran, "araç kimseye atanmamışken
 * kullanıldı mı?" sorusunu ASLA cevaplamaz. Pano bunu ayrıca gösterir ve
 * yolculuklar okunamadıysa **"0" DEMEZ**, "hesaplanamadı" der.
 */

import { memo, useMemo } from 'react';
import {
  buildShiftSummary, shiftDisclaimer,
  SHIFT_STATE_LABEL, SHIFT_VERDICT_LABEL,
  type AssignmentInput, type TripWindowInput, type ShiftState,
} from '@/lib/fleet/shiftView';

const STATE_STYLE: Record<ShiftState, string> = {
  ACTIVE:  'border-emerald-700 text-emerald-300',
  PLANNED: 'border-sky-700 text-sky-300',
  PAST:    'border-neutral-700 text-neutral-400',
  CLOSED:  'border-neutral-800 text-neutral-500',
};

interface Props {
  /** `null` = OKUNAMADI ("vardiya yok" DEĞİL). */
  readonly assignments: readonly AssignmentInput[] | null;
  /** `null` = yolculuklar okunamadı → vardiya dışı sürüş HESAPLANMAZ. */
  readonly trips: readonly TripWindowInput[] | null;
  /** Şimdi — bileşen saat OKUMAZ, çağıran verir (test edilebilirlik). */
  readonly nowMs: number;
  /** Yolculuk kapsamı kaç araç için okunabildi (dürüstlük notu). */
  readonly tripScopeNote?: string | null;
}

function clock(ms: number | null): string {
  if (ms === null) return 'açık uçlu';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const ShiftBoard = memo(function ShiftBoard(
  { assignments, trips, nowMs, tripScopeNote }: Props,
) {
  const s = useMemo(
    () => buildShiftSummary({ assignments, trips, nowMs }),
    [assignments, trips, nowMs],
  );
  const note = useMemo(() => shiftDisclaimer(s), [s]);

  return (
    <section
      data-testid="shift-board"
      data-shift-verdict={s.verdict}
      className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">Vardiyalar</h3>
          <p className="text-[11px] text-neutral-500">
            Vardiya ayrı bir kayıt değil — zamanlanmış araç–sürücü atamasıdır.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {s.verdict === 'OK' && (
            <>
              <span
                data-testid="shift-active-count"
                className="rounded border border-emerald-700 px-2 py-0.5 text-[11px] text-emerald-300"
              >
                {s.activeCount} yürürlükte
              </span>
              {s.conflictCount > 0 && (
                <span
                  data-testid="shift-conflict-count"
                  className="rounded border border-red-700 px-2 py-0.5 text-[11px] text-red-300"
                >
                  {s.conflictCount} çakışma
                </span>
              )}
            </>
          )}
          <span className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300">
            {SHIFT_VERDICT_LABEL[s.verdict]}
          </span>
        </div>
      </header>

      {s.verdict === 'OK' && (
        <ul className="flex flex-col gap-1.5">
          {s.shifts.map((sh) => (
            <li
              key={sh.id}
              data-testid={`shift-${sh.id}`}
              data-shift-state={sh.state}
              className="flex flex-wrap items-center gap-2 rounded border border-neutral-800 px-2.5 py-2 text-[11px]"
            >
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATE_STYLE[sh.state]}`}>
                {SHIFT_STATE_LABEL[sh.state]}
              </span>
              <span className="text-neutral-200">{sh.driverName ?? 'sürücü adı yok'}</span>
              <span className="text-neutral-500">·</span>
              <span className="text-neutral-300">{sh.vehicleName ?? 'araç adı yok'}</span>
              <span className="text-neutral-500">
                {clock(sh.startMs)} → {clock(sh.endMs)}
              </span>
              <span className="text-neutral-500">
                {sh.tripCount} yolculuk
                {sh.distanceKm !== null && ` · ${sh.distanceKm.toFixed(1).replace('.', ',')} km`}
              </span>
              {sh.vehicleConflict && (
                <span className="rounded border border-red-700 px-1.5 py-0.5 text-[10px] text-red-300">
                  ARAÇ ÇAKIŞMASI
                </span>
              )}
              {sh.driverConflict && (
                <span className="rounded border border-red-700 px-1.5 py-0.5 text-[10px] text-red-300">
                  SÜRÜCÜ ÇAKIŞMASI
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Dürüstlük cümlesi HER durumda görünür. */}
      <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">{note}</p>
      {tripScopeNote && (
        <p className="mt-1 text-[10px] leading-relaxed text-neutral-600">{tripScopeNote}</p>
      )}
    </section>
  );
});
