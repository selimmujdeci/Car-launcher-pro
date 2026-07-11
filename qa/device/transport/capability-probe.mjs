/**
 * capability-probe.mjs — Cihaz yeteneklerini **TEK SEFER** yoklar.
 *
 * NEDEN TEK SEFER: her faz kendi başına `dumpsys -l` koşarsa hem yavaşlar hem de
 * cihaz durumu fazlar arasında değişebilir (tutarsız kanıt). Sonuç memoize edilir;
 * `probeCapabilities()` ikinci kez çağrılırsa AYNI nesne döner.
 *
 * NE ÖLÇER: hangi servis VAR, hangisi YOK. **Hiçbir performans ölçümü yapmaz**
 * (gfxinfo'nun VARLIĞINI kontrol eder, FPS OKUMAZ — o PR-4).
 *
 * FAIL-SOFT: her yoklama ayrı; biri düşerse diğerleri devam eder. Transport yoksa
 * tüm yetenekler `false` + `missing` listesi dolar (SKIPPED_NA semantiği).
 */
import {
  TRANSPORT_KIND, OP_STATUS,
  createDeviceCapabilities, parseServiceList, parseIsRoot,
} from '../types/device-types.mjs';
import { findBuildTool } from '../../core/context.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Yoklanacak cihaz-içi servisler: [yetenek adı, servis/dumpsys adayları]. */
const SERVICE_MATRIX = Object.freeze([
  ['dumpsys',       ['activity', 'package']],           // dumpsys çalışıyorsa bunlar listede olur
  ['logcat',        []],                                 // ayrı yoklanır (servis değil)
  ['gfxinfo',       ['gfxinfo']],
  ['sensorservice', ['sensorservice']],
  ['thermal',       ['thermalservice', 'thermal']],
  ['battery',       ['battery', 'batterystats']],
  ['meminfo',       ['meminfo']],
  ['cpuinfo',       ['cpuinfo']],
]);

/** fastboot host binary'si var mı? (çalıştırılmaz — yalnız varlık.) */
export function findFastboot(env = process.env, exists = existsSync) {
  const exe = process.platform === 'win32' ? 'fastboot.exe' : 'fastboot';
  const roots = [
    env.ANDROID_HOME ? join(env.ANDROID_HOME, 'platform-tools') : null,
    env.ANDROID_SDK_ROOT ? join(env.ANDROID_SDK_ROOT, 'platform-tools') : null,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools') : null,
    env.HOME ? join(env.HOME, 'Android', 'Sdk', 'platform-tools') : null,
    env.HOME ? join(env.HOME, 'Library', 'Android', 'sdk', 'platform-tools') : null,
  ].filter(Boolean);
  for (const root of roots) {
    if (exists(join(root, exe))) return true;
  }
  return false;
}

/** Yetenek haritasını, transport + cihaz-içi yoklamalardan üretir (memoized). */
const cache = new WeakMap();

export async function probeCapabilities(transport, { env = process.env, exists = existsSync, now = () => new Date() } = {}) {
  if (cache.has(transport)) return cache.get(transport);

  const notes   = [];
  const missing = [];
  const fastboot = findFastboot(env, exists);

  // ── Transport yok → her şey false, hiçbir şey çökmez ────────────────────
  if (!transport || transport.kind === TRANSPORT_KIND.NONE || !transport.available) {
    const result = createDeviceCapabilities({
      transport: TRANSPORT_KIND.NONE,
      adb:       false,
      fastboot,
      missing:   ['adb', 'getprop', 'dumpsys', 'logcat', 'gfxinfo', 'sensorservice', 'thermal', 'battery', 'meminfo', 'cpuinfo'],
      probedAt:  now().toISOString(),
      notes:     [transport?.reason ?? 'transport yok — cihaz yetenekleri SKIPPED_NA'],
    });
    cache.set(transport ?? {}, result);
    return result;
  }

  // ── getprop (kimlik + Android sürümü) ──────────────────────────────────
  const release = await transport.shell(['getprop', 'ro.build.version.release']);
  const sdkRes  = await transport.shell(['getprop', 'ro.build.version.sdk']);
  const getprop = release.status === OP_STATUS.OK && release.stdout.trim().length > 0;
  if (!getprop) missing.push('getprop');

  // ── root (hu-probe.sh ile aynı ölçüt: uid=0) ───────────────────────────
  const idRes = await transport.shell(['id']);
  const root  = idRes.status === OP_STATUS.OK && parseIsRoot(idRes.stdout);

  // ── servis listesi (dumpsys -l + service list birleşimi) ───────────────
  const dumpsysList = await transport.shell(['dumpsys', '-l']);
  const serviceList = await transport.shell(['service', 'list']);
  const services = new Set([
    ...parseServiceList(dumpsysList.status === OP_STATUS.OK ? dumpsysList.stdout : ''),
    ...parseServiceList(serviceList.status === OP_STATUS.OK ? serviceList.stdout : ''),
  ]);
  const dumpsysWorks = dumpsysList.status === OP_STATUS.OK && services.size > 0;

  // ── logcat (servis değil — ayrı yoklanır, 1 satır yeter) ───────────────
  const logcatRes = await transport.shell(['logcat', '-d', '-t', '1'], { timeoutMs: 10_000 });
  const logcat = logcatRes.status === OP_STATUS.OK;
  if (!logcat) missing.push('logcat');

  const has = (candidates) => candidates.some((name) => services.has(name));
  const caps = {};
  for (const [name, candidates] of SERVICE_MATRIX) {
    if (name === 'logcat') { caps.logcat = logcat; continue; }
    if (name === 'dumpsys') { caps.dumpsys = dumpsysWorks; if (!dumpsysWorks) missing.push('dumpsys'); continue; }
    const present = dumpsysWorks && has(candidates);
    caps[name] = present;
    if (!present) missing.push(name);
  }

  if (!root) notes.push('root YOK — bazı derin yoklamalar (UART/CAN sniff) yapılamaz');
  if (!caps.thermal) notes.push('thermalservice yok — termal bütçe testi bu cihazda MANUAL_PENDING olur');

  const result = createDeviceCapabilities({
    transport:      TRANSPORT_KIND.ADB,
    adb:            true,
    fastboot,
    root,
    androidRelease: getprop ? release.stdout.trim() : null,
    sdk:            sdkRes.status === OP_STATUS.OK ? Number(sdkRes.stdout.trim()) || null : null,
    getprop,
    dumpsys:        caps.dumpsys,
    logcat:         caps.logcat,
    gfxinfo:        caps.gfxinfo,
    sensorservice:  caps.sensorservice,
    thermal:        caps.thermal,
    battery:        caps.battery,
    meminfo:        caps.meminfo,
    cpuinfo:        caps.cpuinfo,
    missing,
    probedAt:       now().toISOString(),
    notes,
  });

  cache.set(transport, result);
  return result;
}

/** Test/araç yardımcısı — memoization'ı temizler. */
export function resetProbeCache(transport) {
  if (transport) cache.delete(transport);
}

/** Host tarafı SDK aracı var mı (aapt2/apksigner) — PR-1'in tespitini yeniden kullanır. */
export function hasHostBuildTool(name, env = process.env) {
  return Boolean(findBuildTool(name, env));
}
