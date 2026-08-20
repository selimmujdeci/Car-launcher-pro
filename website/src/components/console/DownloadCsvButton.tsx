'use client';

/**
 * CSV İNDİRME DÜĞMESİ (#662).
 *
 * Blob URL bir sonraki tick'te DEĞİL, indirme tetiklendikten sonra
 * `revokeObjectURL` ile serbest bırakılır — aksi hâlde her indirme sekme
 * ömrü boyunca bellekte kalır (zero-leak kuralı).
 *
 * Veri yoksa düğme pasiftir: boş dosya indirtip "dışa aktarıldı" izlenimi
 * vermek, kanıtsız çıktı üretmektir.
 */

import { useCallback } from 'react';
import { toCsv, csvFileName, type CsvCell } from '@/lib/console/exportModel';

interface Props {
  headers: readonly string[];
  rows: readonly CsvCell[][];
  filePrefix: string;
  label?: string;
}

export default function DownloadCsvButton({ headers, rows, filePrefix, label = 'CSV indir' }: Props) {
  const disabled = rows.length === 0;

  const download = useCallback(() => {
    if (disabled) return;
    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFileName(filePrefix, new Date().toISOString());
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [disabled, headers, rows, filePrefix]);

  return (
    <button
      onClick={download}
      disabled={disabled}
      title={disabled ? 'Dışa aktarılacak kayıt yok' : undefined}
      className="cn-num text-[9px] uppercase tracking-[0.16em] px-2.5 py-1.5 border border-hair transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ borderRadius: 2, color: disabled ? 'var(--cn-text-3)' : 'var(--cn-copper)' }}
    >
      {label}
    </button>
  );
}
