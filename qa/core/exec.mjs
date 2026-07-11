/**
 * exec.mjs — Sınırlı (bounded), shell'siz alt-süreç çalıştırıcı.
 *
 * NEDEN (CLAUDE.md §Zero-Leak + §Fail-soft):
 * - Shell string birleştirme YOK → argüman dizisi (enjeksiyon + Windows tırnak cehennemi yok).
 * - Her komut zaman-sınırlı; timeout'ta süreç öldürülür ve timer TEMİZLENİR (zombi yok).
 * - Çıktı boyutu sınırlı (maxBuffer) → dev gradle logu belleği patlatmaz.
 * - ASLA throw etmez: bulunamayan/başarısız komut { ok:false, code, error } döner →
 *   tek bir eksik host aracı tüm Lab'i çökertmez.
 *
 * Yan etkisiz: import edildiğinde hiçbir süreç başlatılmaz.
 */
import { spawn } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1_000_000; // 1 MB — üstü kesilir (bounded)

/**
 * @param {string} command  Çalıştırılacak dosya (shell YOK)
 * @param {string[]} args   Argümanlar (dizi — asla birleştirilmiş string değil)
 * @param {{cwd?:string, timeoutMs?:number, env?:object}} opts
 * @returns {Promise<{ok:boolean, code:number|null, signal:string|null, stdout:string, stderr:string, timedOut:boolean, truncated:boolean, error:string|null, durationMs:number}>}
 */
export function runCommand(command, args = [], opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timer = null;
    let timedOut = false;
    let truncated = false;
    let outBytes = 0;
    const stdout = [];
    const stderr = [];

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }   // zero-leak: timer daima temizlenir
      resolve(Object.freeze({
        ok:         payload.ok,
        code:       payload.code ?? null,
        signal:     payload.signal ?? null,
        stdout:     stdout.join(''),
        stderr:     stderr.join(''),
        timedOut,
        truncated,
        error:      payload.error ?? null,
        durationMs: Date.now() - started,
      }));
    };

    const collect = (bucket) => (chunk) => {
      if (truncated) return;
      const text = String(chunk);
      outBytes += text.length;
      if (outBytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        bucket.push('\n…[ÇIKTI KESİLDİ — bounded]');
        return;
      }
      bucket.push(text);
    };

    try {
      // Windows: .bat/.cmd (ör. Android SDK'nın apksigner.bat) doğrudan spawn
      // EDİLEMEZ (Node kısıtı) → cmd.exe /c ile çalıştırılır. shell:true KULLANILMAZ;
      // argümanlar yine DİZİ olarak geçer (string birleştirme yok).
      const isBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command);
      const file    = isBatch ? (process.env.COMSPEC ?? 'cmd.exe') : command;
      const argv    = isBatch ? ['/d', '/s', '/c', command, ...args] : args;

      child = spawn(file, argv, {
        cwd:   opts.cwd,
        env:   opts.env ?? process.env,
        shell: false,             // ASLA shell — argüman dizisi tek yol
        windowsHide: true,
      });
    } catch (e) {
      finish({ ok: false, code: null, error: `spawn hatası: ${e?.message ?? e}` });
      return;
    }

    child.stdout?.on('data', collect(stdout));
    child.stderr?.on('data', collect(stderr));
    child.on('error', (e) => finish({ ok: false, code: null, error: `çalıştırılamadı: ${e?.message ?? e}` }));
    child.on('close', (code, signal) => finish({ ok: code === 0 && !timedOut, code, signal }));

    timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* zaten ölmüş */ }
      finish({ ok: false, code: null, error: `zaman aşımı (${timeoutMs}ms)` });
    }, timeoutMs);
    // Timer olay döngüsünü canlı tutmasın — iş bitince process kapanabilsin.
    if (typeof timer.unref === 'function') timer.unref();
  });
}
