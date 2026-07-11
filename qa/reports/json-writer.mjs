/**
 * json-writer.mjs — report.json diske yazımı (stream).
 *
 * Büyük raporlarda tek seferde string birleştirip belleğe almamak için
 * WriteStream kullanılır; stream daima kapatılır (zero-leak).
 */
import { mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { validateReport } from './report-schema.mjs';

/**
 * @returns {Promise<string>} yazılan dosyanın yolu
 */
export async function writeReportJson(outDir, report) {
  // Şema ihlali SENKRON throw etmez — reddedilen promise döner (çağıranlar
  // tek bir hata yolu görsün; sync/async karışımı fail-soft'u bozar).
  const { valid, errors } = validateReport(report);
  if (!valid) throw new Error(`report.json şema ihlali: ${errors.join('; ')}`);

  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, 'report.json');

  return new Promise((resolve, reject) => {
    const stream = createWriteStream(target, { encoding: 'utf8' });
    stream.on('error', reject);
    stream.on('finish', () => resolve(target));
    stream.write(JSON.stringify(report, null, 2));
    stream.end();
  });
}
