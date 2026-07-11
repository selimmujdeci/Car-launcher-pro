/**
 * adb.mjs — ADB transport (tek gerçek cihaz iletişim yolu, PR-2).
 *
 * YENİDEN KULLANIM (yeni keşif mantığı yazılmadı): adb arama sırası
 * `tools/diag-restart.ps1`'in aday listesinden alındı (LOCALAPPDATA SDK →
 * Android Studio → PATH) ve platformlar arası (Windows/Linux/macOS) genişletildi.
 * `tools/hu-probe.ps1`'in sabit-yol yaklaşımı BİLİNÇLİ olarak taşınmadı
 * (makineye özgü mutlak yol taşınabilir değil).
 *
 * DAYANIKLILIK:
 *  - Public API throw ETMEZ → her şey OpResult.
 *  - Zaman sınırı (bounded); timeout retry EDİLMEZ.
 *  - Geçici transport hatası (broken pipe / device offline / protocol fault) →
 *    **en fazla 1 retry**, sonra fail-soft `BROKEN`.
 *  - Bir kez `broken` olunca `isAlive()` false döner; çağıran fazlar SKIPPED_NA'ya düşebilir.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../../core/exec.mjs';
import { redactSerial } from '../../core/redact.mjs';
import {
  TRANSPORT_KIND, OP_STATUS, createOpResult,
  isTransientTransportError, parseAdbDevices,
} from '../types/device-types.mjs';

export const DEFAULT_ADB_TIMEOUT_MS = 20_000;
export const MAX_RETRY = 1;   // "Retry en fazla 1" — sözleşme

/**
 * adb çalıştırılabilir dosyasını bulur. Bulamazsa `null` (throw YOK).
 * `exists` enjekte edilebilir → Windows/Linux/macOS yolları cihazsız test edilir.
 */
export function findAdb(env = process.env, exists = existsSync) {
  const exeNames = process.platform === 'win32' ? ['adb.exe', 'adb'] : ['adb'];

  const roots = [];
  if (env.ADB_PATH) {
    // Doğrudan tam yol verilmişse önce o.
    if (exists(env.ADB_PATH)) return env.ADB_PATH;
  }
  for (const sdk of [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]) {
    if (sdk) roots.push(join(sdk, 'platform-tools'));
  }
  if (env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools'));
  if (env.ProgramFiles) roots.push(join(env.ProgramFiles, 'Android', 'Android Studio', 'platform-tools'));
  if (env.USERPROFILE)  roots.push(join(env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools'));
  if (env.HOME) {
    roots.push(join(env.HOME, 'Library', 'Android', 'sdk', 'platform-tools'));  // macOS
    roots.push(join(env.HOME, 'Android', 'Sdk', 'platform-tools'));             // Linux
  }

  for (const root of roots) {
    for (const exe of exeNames) {
      const candidate = join(root, exe);
      if (exists(candidate)) return candidate;
    }
  }

  // PATH taraması (son çare) — spawn etmeden, yalnız dosya varlığı.
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of String(env.PATH ?? env.Path ?? '').split(sep)) {
    if (!dir) continue;
    for (const exe of exeNames) {
      const candidate = join(dir, exe);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * ADB transport kurar. Hazır cihaz yoksa **null transport'a düşürmez** — bunun
 * kararı çağıranın (interfaces/transport.mjs); burada `available:false` bir ADB
 * transport'u döner ve tüm çağrılar SKIPPED_NA verir (adb var, cihaz yok).
 */
export async function createAdbTransport({
  adbPath,
  env = process.env,
  exec = runCommand,
  serial = env.CAROS_QA_DEVICE ?? null,
  timeoutMs = DEFAULT_ADB_TIMEOUT_MS,
} = {}) {
  let broken = false;
  let brokenReason = null;

  /** Ham adb çağrısı — retry politikası burada, TEK yerde. */
  async function invoke(args, opts = {}) {
    const limit = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : timeoutMs;
    const argv  = serial ? ['-s', serial, ...args] : [...args];
    const started = Date.now();

    for (let attempt = 1; attempt <= MAX_RETRY + 1; attempt++) {
      const res = await exec(adbPath, argv, { timeoutMs: limit, env });

      if (res.timedOut) {
        // Timeout RETRY EDİLMEZ: zaman bütçesi iki katına çıkmasın.
        return createOpResult({
          status: OP_STATUS.TIMEOUT, stdout: res.stdout, stderr: res.stderr, code: res.code,
          reason: `zaman aşımı (${limit}ms)`, attempts: attempt, durationMs: Date.now() - started,
        });
      }

      if (res.ok) {
        return createOpResult({
          status: OP_STATUS.OK, stdout: res.stdout, stderr: res.stderr, code: res.code,
          attempts: attempt, durationMs: Date.now() - started,
        });
      }

      const blob = `${res.stderr}\n${res.stdout}\n${res.error ?? ''}`;
      if (isTransientTransportError(blob)) {
        if (attempt <= MAX_RETRY) continue;             // tek bir yeniden deneme
        broken = true;
        brokenReason = 'transport koptu (broken pipe / device offline)';
        return createOpResult({
          status: OP_STATUS.BROKEN, stdout: res.stdout, stderr: res.stderr, code: res.code,
          reason: brokenReason, attempts: attempt, durationMs: Date.now() - started,
        });
      }

      // Komut koştu, cihaz "hayır" dedi → gerçek başarısızlık (retry ETME).
      return createOpResult({
        status: OP_STATUS.FAILED, stdout: res.stdout, stderr: res.stderr, code: res.code,
        reason: res.error ?? `exit ${res.code}`, attempts: attempt, durationMs: Date.now() - started,
      });
    }

    /* istanbul ignore next — döngü yukarıda daima döner */
    return createOpResult({ status: OP_STATUS.BROKEN, reason: 'ulaşılamaz', attempts: MAX_RETRY + 1 });
  }

  // ── Cihaz seçimi ────────────────────────────────────────────────────────
  const list = await invoke(['devices', '-l'], { timeoutMs: Math.min(timeoutMs, 15_000) });
  const devices = list.ok ? parseAdbDevices(list.stdout) : [];
  const ready   = devices.filter((d) => d.ready);
  const notReady = devices.filter((d) => !d.ready);

  if (!serial && ready.length === 1) serial = ready[0].serial;
  const available = Boolean(serial) && ready.some((d) => !serial || d.serial === serial || ready.length === 1);

  let unavailableReason = null;
  if (!list.ok)             unavailableReason = `adb devices başarısız: ${list.reason ?? list.status}`;
  else if (ready.length === 0 && notReady.length > 0) unavailableReason = `cihaz hazır değil: ${notReady.map((d) => d.state).join(', ')}`;
  else if (ready.length === 0) unavailableReason = 'bağlı cihaz yok (USB hata ayıklama açık mı?)';
  else if (ready.length > 1 && !serial) unavailableReason = `birden çok cihaz — CAROS_QA_DEVICE ile seç (${ready.length} adet)`;

  const guarded = (fn) => async (...a) => {
    if (!available) {
      return createOpResult({ status: OP_STATUS.SKIPPED_NA, reason: unavailableReason ?? 'cihaz yok' });
    }
    if (broken) {
      return createOpResult({ status: OP_STATUS.SKIPPED_NA, reason: brokenReason ?? 'transport kopuk' });
    }
    return fn(...a);
  };

  return Object.freeze({
    kind:      TRANSPORT_KIND.ADB,
    available,
    serial:    redactSerial(serial),   // DIŞARIYA yalnız redakte seri no
    reason:    unavailableReason,

    describe() {
      return Object.freeze({
        kind:      TRANSPORT_KIND.ADB,
        available,
        serial:    redactSerial(serial),
        adbPath:   'adb',              // makine yolu rapora GİRMEZ
        reason:    unavailableReason,
        deviceCount: devices.length,
        readyCount:  ready.length,
      });
    },

    shell: guarded((args = [], opts = {}) => invoke(['shell', ...args], opts)),
    exec:  guarded((args = [], opts = {}) => invoke([...args], opts)),
    push:  guarded((local, remote, opts = {}) => invoke(['push', local, remote], opts)),
    pull:  guarded((remote, local, opts = {}) => invoke(['pull', remote, local], opts)),

    isAlive() { return available && !broken; },
  });
}
