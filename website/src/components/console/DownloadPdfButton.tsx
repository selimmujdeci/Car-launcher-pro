'use client';

/**
 * PDF RAPOR İNDİRME DÜĞMESİ (V-16/1).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Enterprise sayfası "günlük/haftalık PDF rapor" vaat ediyordu; gerçekte yalnız
 * `window.print()` vardı — kullanıcı tarayıcı diyaloğunda "PDF olarak kaydet"
 * seçmek zorundaydı. Bu düğme GERÇEK PDF baytları üretir.
 *
 * Zero-leak: blob URL indirme tetiklendikten sonra serbest bırakılır.
 *
 * Kanıtsız çıktı yasağı: rapor edilecek hiçbir şey yoksa düğme PASİFTİR —
 * boş bir PDF indirtip "rapor alındı" izlenimi vermek yanıltıcı olurdu.
 */

import { useCallback, useState } from 'react';
import {
  buildFleetReportPdf, fleetReportFileName, type FleetReportInput,
} from '@/lib/reports/fleetReportPdf';

interface Props {
  /** Zaman damgası DIŞINDA her şey; damgayı düğme tıklama anında üretir. */
  readonly data: Omit<FleetReportInput, 'generatedAtLabel'>;
  readonly label?: string;
}

function trStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function DownloadPdfButton({ data, label = 'PDF rapor' }: Props) {
  const [busy, setBusy] = useState(false);

  /* Rapor edilecek hiçbir şey yoksa pasif: araç da yok, gün de yok, günlük de
     okunabilmiş. Bu hâlde üretilecek PDF boş bir kabuk olurdu. */
  const empty = data.vehicles.length === 0 && data.days.length === 0 && !data.logUnreadable;

  const download = useCallback(() => {
    if (empty || busy) return;
    setBusy(true);
    try {
      const now = new Date();
      const res = buildFleetReportPdf({ ...data, generatedAtLabel: trStamp(now) });
      /* `Uint8Array`ın kendi tamponu kullanılır; kopya çıkarmak büyük
         raporlarda gereksiz bellek tepesi yaratır. */
      const blob = new Blob([res.bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fleetReportFileName(now.toISOString());
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }, [data, empty, busy]);

  return (
    <button
      onClick={download}
      disabled={empty || busy}
      data-testid="download-pdf"
      title={empty ? 'Raporlanacak veri yok' : 'Sunucusuz üretilen gerçek PDF dosyası'}
      className="cn-num text-[9px] uppercase tracking-[0.16em] px-2.5 py-1.5 border border-hair transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ borderRadius: 2, color: empty ? 'var(--cn-text-3)' : 'var(--cn-copper)' }}
    >
      {busy ? '…' : label}
    </button>
  );
}
