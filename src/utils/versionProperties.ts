/**
 * versionProperties.ts — version.properties parser (OTA v1 / Commit 1)
 *
 * Tek sürüm kaynağı repo kökündeki version.properties'tir (VERSION_CODE,
 * VERSION_NAME). Tüketiciler:
 *   - android/app/build.gradle  → versionCode/versionName (Properties.load)
 *   - vite.config.ts            → VITE_APP_VERSION / VITE_APP_VERSION_CODE define
 *   - scripts/bump-version.mjs  → bump akışı
 *
 * Bu modül SAF string mantığıdır (fs yok) — vite.config (node) ve vitest
 * (jsdom) aynı parser'ı kullanır; Java Properties davranışıyla uyumlu
 * (#/!  yorum satırları, key=value, değer trim).
 */

export interface ParsedVersion {
  versionCode: number;
  versionName: string;
}

/** build.gradle:17-18 ile aynı fallback'ler — dosya/anahtar yoksa. */
export const VERSION_FALLBACK: ParsedVersion = {
  versionCode: 2,
  versionName: '1.0.0',
};

/**
 * version.properties içeriğini parse eder.
 * Bilinmeyen/bozuk değerlerde alan bazında fallback'e düşer (fail-soft) —
 * build hiçbir zaman sürüm yüzünden kırılmaz, gradle davranışıyla aynı.
 */
export function parseVersionProperties(content: string): ParsedVersion {
  const out: ParsedVersion = {
    versionCode: VERSION_FALLBACK.versionCode,
    versionName: VERSION_FALLBACK.versionName,
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key   = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'VERSION_CODE') {
      const n = Number.parseInt(value, 10);
      if (Number.isInteger(n) && n > 0) out.versionCode = n;
    } else if (key === 'VERSION_NAME') {
      if (value.length > 0) out.versionName = value;
    }
  }
  return out;
}
