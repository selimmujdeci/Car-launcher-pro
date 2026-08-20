/**
 * DIŞA AKTARMA — CSV üretimi (#662).
 *
 * Saf: I/O YOK, `Date.now` YOK. Dosyayı indirme işi çağıran tarafındadır.
 *
 * KURAL: bilinmeyen hücre BOŞ bırakılır — `0` ya da `-` yazılmaz. Dışa
 * aktarılan tablo muhasebeye/rapora girer; orada sahte `0` gerçek bir yanlış
 * hesaba dönüşür.
 */

export type CsvCell = string | number | null | undefined;

/** Excel/LibreOffice uyumlu alıntılama: tırnak ikilenir, alan tırnağa alınır. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text === '') return '';
  const needsQuote = /[",;\n\r]/.test(text);
  const escaped = text.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

/**
 * Satırlardan CSV metni.
 *
 * Ayraç `;` — Türkçe Windows yerelinde Excel virgülü ondalık ayracı sayar ve
 * virgüllü CSV tek sütuna çöker. BOM eklenir ki Türkçe karakterler bozulmasın.
 */
export function toCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [headers.map(csvCell).join(';')];
  for (const row of rows) lines.push(row.map(csvCell).join(';'));
  return `﻿${lines.join('\r\n')}`;
}

/** Dosya adı — tarih damgası çağıran tarafından verilir (model saat okumaz). */
export function csvFileName(prefix: string, isoDate: string): string {
  const safe = prefix.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  return `${safe}-${isoDate.slice(0, 10)}.csv`;
}

/** Sayıyı TR biçiminde metne çevirir; `null` BOŞ kalır (sahte 0 YOK). */
export function trNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return value.toFixed(digits).replace('.', ',');
}
