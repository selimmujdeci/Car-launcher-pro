/**
 * artifact-store.mjs — Koşu artefaktlarının SINIRLI (bounded) + REDAKTE deposu.
 *
 * NEDEN:
 * - Ham komut çıktıları (gradle/aapt2/apksigner) rapora değil `raw/` altına yazılır;
 *   report.json yalnız artefakt REFERANSI taşır (şişmiş JSON yok).
 * - Her yazım redaksiyondan geçer (sır + kişisel yol sızıntısı yok).
 * - Dosya sayısı ve dosya başı boyut SINIRLI → kaçak faz diski doldurmaz.
 * - Yazım yolu HER ZAMAN koşu klasörünün altındadır (path traversal engellenir).
 *
 * Dry-run modu (`baseDir: null`): hiçbir şey diske yazılmaz — testler ve
 * `--validate-profile` gibi salt-kontrol akışları için.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { redactText } from './redact.mjs';

export const MAX_ARTIFACTS       = 200;
export const MAX_BYTES_PER_FILE  = 512 * 1024; // 512 KB

/**
 * @param {{baseDir:string|null, repoRoot?:string, maxFiles?:number, maxBytesPerFile?:number}} opts
 */
export function createArtifactStore(opts = {}) {
  const baseDir         = opts.baseDir ?? null;
  const repoRoot        = opts.repoRoot ?? null;
  const maxFiles        = Number.isFinite(opts.maxFiles) ? opts.maxFiles : MAX_ARTIFACTS;
  const maxBytesPerFile = Number.isFinite(opts.maxBytesPerFile) ? opts.maxBytesPerFile : MAX_BYTES_PER_FILE;

  /** @type {{path:string, bytes:number, truncated:boolean, dropped?:boolean}[]} */
  const written = [];
  let dropped = 0;

  /** Göreli yolu koşu klasörü içine hapseder (traversal yok). */
  function safeTarget(relPath) {
    if (typeof relPath !== 'string' || relPath.length === 0) throw new TypeError('artifact yolu zorunlu');
    if (isAbsolute(relPath)) throw new TypeError('artifact yolu göreli olmalı');
    const abs = resolve(baseDir, relPath);
    const rel = relative(resolve(baseDir), abs);
    if (rel.startsWith('..')) throw new TypeError(`artifact yolu koşu klasörü dışına çıkıyor: ${relPath}`);
    return abs;
  }

  return Object.freeze({
    /**
     * Artefakt yazar. Döndürdüğü referans faz sonucuna eklenir.
     * @returns {{path:string, bytes:number, truncated:boolean, dropped:boolean}}
     */
    write(relPath, content) {
      const redacted  = redactText(String(content ?? ''), repoRoot);
      const truncated = redacted.length > maxBytesPerFile;
      const body      = truncated
        ? `${redacted.slice(0, maxBytesPerFile)}\n…[ARTEFAKT KESİLDİ — bounded ${maxBytesPerFile} bayt]`
        : redacted;

      if (written.length >= maxFiles) {
        dropped += 1;
        return Object.freeze({ path: relPath, bytes: 0, truncated: false, dropped: true });
      }

      if (baseDir) {
        const abs = safeTarget(relPath);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, body, 'utf8');
      }

      const ref = Object.freeze({
        path:      relPath.replace(/\\/g, '/'),
        bytes:     body.length,
        truncated,
        dropped:   false,
      });
      written.push(ref);
      return ref;
    },

    /** Ham komut çıktısı → raw/ altına (aynı sınırlar + redaksiyon). */
    writeRaw(name, content) {
      return this.write(join('raw', name).replace(/\\/g, '/'), content);
    },

    list()          { return Object.freeze([...written]); },
    get count()     { return written.length; },
    get droppedCount() { return dropped; },
    get baseDir()   { return baseDir; },
  });
}
