// @vitest-environment node
/**
 * Depo sızıntı taraması — takip edilen HER metin dosyasında gerçek formatlı
 * sağlayıcı anahtarı / özel anahtar YOKTUR.
 *
 * KÖK (inceleme 2026-09-29): `docs/archive/2026-05-audit/eski-env-yedek.txt`
 * gerçek formatlı Gemini ve Claude API anahtarlarıyla depoya işlenmişti
 * (08c9a1d8); hiçbir kilit yakalamadı. Dosya silindi; anahtarlar git geçmişinde
 * kaldığı için sahibi tarafından İPTAL EDİLMELİDİR (silmek geçmişi temizlemez).
 *
 * Rapor yalnız dosya:satır + sağlayıcı + maskeli önek verir; değer ASLA yazılmaz.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/g],
  ['anthropic-key',  /sk-ant-[A-Za-z0-9_-]{80,}/g],
  ['openai-key',     /sk-(?:proj-)?[A-Za-z0-9]{40,}/g],
  ['groq-key',       /gsk_[A-Za-z0-9]{40,}/g],
  ['github-token',   /gh[pousr]_[A-Za-z0-9]{36,}/g],
  ['aws-access-key', /AKIA[0-9A-Z]{16}/g],
  ['private-key',    /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]{100,}/g],
];

/** Test verisi olduğu açık değerler (ardışık alfabe, tekrar, yer tutucu). */
function isSynthetic(v: string): boolean {
  return /ABCDEFGH|abcdefgh|(.)\1{7,}|XXXX|your|example|placeholder/i.test(v);
}

/**
 * Bilinçli istisnalar — her biri gerekçeli:
 *  - Firebase Android yapılandırması: API anahtarı APK'ya gömülmek için tasarlanmıştır
 *    (sır değildir); Google Cloud'da paket adı + SHA-1 ile KISITLANMALIDIR.
 */
const ALLOW = new Map<string, string>([
  ['android/app/google-services.json', 'google-api-key'],
]);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.bmp', '.svgz', '.ttf', '.otf', '.woff', '.woff2',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.pbf', '.mbtiles', '.db', '.sqlite', '.zip', '.gz', '.jar',
  '.apk', '.aab', '.so', '.wasm', '.bin', '.pdf', '.keystore', '.jks', '.onnx', '.tflite',
]);
const MAX_BYTES = 2 * 1024 * 1024;

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
}

describe('depo sızıntı taraması', () => {
  it('takip edilen dosyalarda gerçek formatlı anahtar yok', () => {
    const hits: string[] = [];
    for (const rel of trackedFiles()) {
      if (BINARY_EXT.has(extname(rel).toLowerCase())) continue;
      const abs = join(ROOT, rel);
      let size = 0;
      try { size = statSync(abs).size; } catch { continue; }   // silinmiş/izlenmeyen
      if (size === 0 || size > MAX_BYTES) continue;
      const text = readFileSync(abs, 'utf8');
      if (text.includes('\0')) continue;                        // ikili içerik
      for (const [provider, re] of PATTERNS) {
        for (const m of text.matchAll(re)) {
          if (isSynthetic(m[0]) || ALLOW.get(rel) === provider) continue;
          const line = text.slice(0, m.index).split('\n').length;
          hits.push(`${rel}:${line} ${provider} ${m[0].slice(0, 6)}… (${m[0].length} karakter)`);
        }
      }
    }
    expect(hits, `Sızmış anahtar(lar) — dosyayı kaldırın VE anahtarı iptal edin:\n${hits.join('\n')}`).toEqual([]);
  }, 60_000);
});
