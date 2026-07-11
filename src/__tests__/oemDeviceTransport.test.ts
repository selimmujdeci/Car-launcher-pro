/**
 * oemDeviceTransport.test.ts — OEM Validation Lab PR-2 (Device Layer Foundation).
 *
 * KİLİTLENEN İNVARYANTLAR:
 *  · Public API ASLA throw etmez — her şey OpResult (status + reason).
 *  · ADB yoksa → null transport, her çağrı SKIPPED_NA. Hiçbir faz çökmez.
 *  · Retry EN FAZLA 1 ve yalnız geçici transport hatasında; timeout retry EDİLMEZ.
 *  · Broken pipe → fail-soft (BROKEN), throw yok, transport ölü işaretlenir.
 *  · Ham seri no rapora GİRMEZ (redakte).
 *  · Yetenek yoklaması TEK SEFER koşar (memoize).
 *  · PR-2 performans ÖLÇMEZ / uygulamaya DOKUNMAZ (device.json scope bayrakları).
 *  · Import yan etkisiz.
 *
 * Hiçbir test gerçek adb çalıştırmaz — exec/exists tamamen enjekte edilir.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  TRANSPORT_KIND, OP_STATUS, isTransientTransportError,
  parseAdbDevices, parseGetpropDump, parseWmSize, parseWmDensity,
  parseMemTotalMb, parseCpuinfo, parseBattery, parseGlesRenderer,
  parseDfData, parseServiceList, parseIsRoot, computeScreenInches,
} from '../../qa/device/types/device-types.mjs';
import { createTransport, createNullTransport } from '../../qa/device/interfaces/transport.mjs';
import { findAdb, MAX_RETRY } from '../../qa/device/transport/adb.mjs';
import { probeCapabilities } from '../../qa/device/transport/capability-probe.mjs';
import { collectDeviceInfo } from '../../qa/device/transport/device-info.mjs';
import { scanDevice, deviceRunId } from '../../qa/device/index.mjs';
import { redactSerial } from '../../qa/core/redact.mjs';

const REPO_ROOT = process.cwd();

/* ── sahte adb ────────────────────────────────────────────────────────────── */

const DEVICES_OK = 'List of devices attached\nABC123XYZ9      device product:k24 model:K24 device:k24 transport_id:2\n';

type ExecResult = {
  ok: boolean; code: number | null; signal: null; stdout: string; stderr: string;
  timedOut: boolean; truncated: boolean; error: string | null; durationMs: number;
};

function res(partial: Partial<ExecResult>): ExecResult {
  return {
    ok: false, code: 1, signal: null, stdout: '', stderr: '',
    timedOut: false, truncated: false, error: null, durationMs: 1, ...partial,
  };
}
const okRes = (stdout: string) => res({ ok: true, code: 0, stdout });

/** Komut sözlüğüne göre cevap veren sahte exec. */
function fakeExec(routes: Array<[RegExp, ExecResult | ((args: string[]) => ExecResult)]>, calls: string[][] = []) {
  return vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args);
    const line = args.join(' ');
    for (const [re, out] of routes) {
      if (re.test(line)) return typeof out === 'function' ? out(args) : out;
    }
    return okRes('');
  });
}

const existsAlways = () => true;
const existsNever = () => false;

/* ── 1-3, 10: Transport oluşturma ────────────────────────────────────────── */

describe('Transport — tek giriş createTransport()', () => {
  it('1. transport oluşturulur ve sözleşmeyi sağlar', async () => {
    const t = await createTransport({
      adbPath: '/fake/adb', exists: existsAlways,
      exec: fakeExec([[/devices/, okRes(DEVICES_OK)]]),
      env: {},
    });
    expect(t.kind).toBe(TRANSPORT_KIND.ADB);
    for (const fn of ['shell', 'exec', 'push', 'pull', 'isAlive', 'describe']) {
      expect(typeof (t as unknown as Record<string, unknown>)[fn]).toBe('function');
    }
    expect(Object.isFrozen(t)).toBe(true);
  });

  it('2. adb BULUNDU → ADB transport, cihaz hazır', async () => {
    const t = await createTransport({
      adbPath: '/fake/adb', exists: existsAlways,
      exec: fakeExec([[/devices/, okRes(DEVICES_OK)]]),
      env: {},
    });
    expect(t.kind).toBe(TRANSPORT_KIND.ADB);
    expect(t.available).toBe(true);
    expect(t.isAlive()).toBe(true);
    expect(t.describe().readyCount).toBe(1);
  });

  it('3. adb BULUNAMADI → null transport (throw YOK)', async () => {
    const t = await createTransport({ exists: existsNever, env: {}, exec: fakeExec([]) });
    expect(t.kind).toBe(TRANSPORT_KIND.NONE);
    expect(t.available).toBe(false);
    expect(t.reason).toMatch(/bulunamadı/i);
  });

  it('3b. adb var ama BAĞLI CİHAZ yok → SKIPPED_NA (çökme yok)', async () => {
    const t = await createTransport({
      adbPath: '/fake/adb', exists: existsAlways, env: {},
      exec: fakeExec([[/devices/, okRes('List of devices attached\n\n')]]),
    });
    expect(t.available).toBe(false);
    const r = await t.shell(['getprop']);
    expect(r.status).toBe(OP_STATUS.SKIPPED_NA);
    expect(r.ok).toBe(false);
  });

  it('3c. cihaz unauthorized → sessizce "cihaz yok" DEMEZ, sebebi söyler', async () => {
    const t = await createTransport({
      adbPath: '/fake/adb', exists: existsAlways, env: {},
      exec: fakeExec([[/devices/, okRes('List of devices attached\nXYZ  unauthorized\n')]]),
    });
    expect(t.available).toBe(false);
    expect(t.reason).toMatch(/unauthorized|hazır değil/i);
  });

  it('10. null transport: HER çağrı SKIPPED_NA döner, hiçbiri throw etmez', async () => {
    const t = createNullTransport();
    for (const call of [t.shell(['x']), t.exec(['devices']), t.push('a', 'b'), t.pull('a', 'b')]) {
      const r = await call;
      expect(r.status).toBe(OP_STATUS.SKIPPED_NA);
      expect(r.ok).toBe(false);
    }
    expect(t.isAlive()).toBe(false);
    expect(t.describe().kind).toBe(TRANSPORT_KIND.NONE);
  });
});

/* ── 4-6: Timeout / retry / broken pipe ──────────────────────────────────── */

describe('Dayanıklılık — timeout, retry, broken pipe', () => {
  it('4. timeout → TIMEOUT durumu, throw YOK ve RETRY YOK (zaman bütçesi korunur)', async () => {
    const calls: string[][] = [];
    const exec = fakeExec([
      [/devices/, okRes(DEVICES_OK)],
      [/getprop/, res({ timedOut: true, code: null, error: 'zaman aşımı (20000ms)' })],
    ], calls);

    const t = await createTransport({ adbPath: '/fake/adb', exists: existsAlways, exec, env: {} });
    const r = await t.shell(['getprop']);

    expect(r.status).toBe(OP_STATUS.TIMEOUT);
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(1);                                   // retry YOK
    expect(calls.filter((c) => c.join(' ').includes('getprop'))).toHaveLength(1);
  });

  it('5. geçici hata → EN FAZLA 1 retry, sonra başarı', async () => {
    let n = 0;
    const exec = vi.fn(async (_c: string, args: string[]) => {
      if (args.includes('devices')) return okRes(DEVICES_OK);
      n++;
      return n === 1
        ? res({ stderr: 'error: protocol fault (couldn\'t read status): Broken pipe' })
        : okRes('sonuc');
    });

    const t = await createTransport({ adbPath: '/fake/adb', exists: existsAlways, exec, env: {} });
    const r = await t.shell(['id']);

    expect(r.status).toBe(OP_STATUS.OK);
    expect(r.attempts).toBe(2);        // 1 deneme + 1 retry
    expect(MAX_RETRY).toBe(1);
    expect(n).toBe(2);                 // ASLA 3 deneme
  });

  it('6. ısrarlı broken pipe → BROKEN (fail-soft), transport ölür, throw YOK', async () => {
    const brokenRes = res({ stderr: 'error: protocol fault: Broken pipe' });
    const exec = fakeExec([
      [/devices/, okRes(DEVICES_OK)],
      [/.*/, brokenRes],
    ]);

    const t = await createTransport({ adbPath: '/fake/adb', exists: existsAlways, exec, env: {} });
    const r = await t.shell(['id']);

    expect(r.status).toBe(OP_STATUS.BROKEN);
    expect(r.attempts).toBe(2);        // 1 + tek retry
    expect(t.isAlive()).toBe(false);   // transport ölü işaretlendi

    // Kopuk transport'a sonraki çağrılar SKIPPED_NA — yeni komut denenmez.
    const after = await t.shell(['getprop']);
    expect(after.status).toBe(OP_STATUS.SKIPPED_NA);
  });

  it('6b. gerçek başarısızlık (exit≠0, geçici DEĞİL) retry EDİLMEZ', async () => {
    let n = 0;
    const exec = vi.fn(async (_c: string, args: string[]) => {
      if (args.includes('devices')) return okRes(DEVICES_OK);
      n++;
      return res({ code: 1, stderr: 'No such file or directory' });
    });
    const t = await createTransport({ adbPath: '/fake/adb', exists: existsAlways, exec, env: {} });
    const r = await t.shell(['cat', '/yok']);

    expect(r.status).toBe(OP_STATUS.FAILED);
    expect(n).toBe(1);
  });

  it('6c. geçici hata sınıflandırması doğru', () => {
    expect(isTransientTransportError('error: protocol fault: Broken pipe')).toBe(true);
    expect(isTransientTransportError('device offline')).toBe(true);
    expect(isTransientTransportError('No such file or directory')).toBe(false);
  });
});

/* ── 8, 9, 7: Parser'lar ─────────────────────────────────────────────────── */

describe('Parser — getprop / capability / device info', () => {
  it('8. getprop dökümü ayrıştırılır (boş değer atlanır)', () => {
    const props = parseGetpropDump([
      '[ro.product.model]: [K24]',
      '[ro.product.manufacturer]: [NWD]',
      '[ro.build.version.sdk]: [28]',
      '[ro.bos]: []',
    ].join('\n'));

    expect(props['ro.product.model']).toBe('K24');
    expect(props['ro.build.version.sdk']).toBe('28');
    expect(props['ro.bos']).toBeUndefined();   // boş değer → yok
  });

  it('8b. adb devices ayrıştırılır (hazır / hazır-değil ayrımı)', () => {
    const list = parseAdbDevices('List of devices attached\nABC1  device model:K24\nZZZ9  offline\n');
    expect(list).toHaveLength(2);
    expect(list[0].ready).toBe(true);
    expect(list[0].model).toBe('K24');
    expect(list[1].ready).toBe(false);
    expect(list[1].state).toBe('offline');
  });

  it('9. servis listesi ve root ayrıştırılır', () => {
    const services = parseServiceList('12  sensorservice: [android.hardware.ISensorServer]\n13  thermalservice: []\ngfxinfo\n');
    expect(services.has('sensorservice')).toBe(true);
    expect(services.has('thermalservice')).toBe(true);
    expect(services.has('gfxinfo')).toBe(true);
    expect(services.has('olmayan')).toBe(false);

    expect(parseIsRoot('uid=0(root) gid=0(root)')).toBe(true);
    expect(parseIsRoot('uid=2000(shell) gid=2000(shell)')).toBe(false);
  });

  it('7. cihaz kimliği alanları ayrıştırılır (ekran/RAM/CPU/GPU/batarya/depolama)', () => {
    expect(parseWmSize('Physical size: 1024x600')).toEqual({ width: 1024, height: 600 });
    expect(parseWmSize('Physical size: 1024x600\nOverride size: 800x480').width).toBe(800);  // override kazanır
    expect(parseWmDensity('Physical density: 160')).toBe(160);
    expect(parseMemTotalMb('MemTotal:        2027544 kB')).toBe(1980);

    const cpu = parseCpuinfo('processor\t: 0\nprocessor\t: 1\nHardware\t: sun50iw9\n');
    expect(cpu.cores).toBe(2);
    expect(cpu.hardware).toBe('sun50iw9');
    // Çekirdek indeksi satırı model adı DEĞİLDİR (gerçek cihazda model="0" çıkmıştı)
    expect(cpu.model).toBeNull();
    expect(parseCpuinfo('processor : 0\nmodel name : ARMv8 Cortex-A55\n').model).toBe('ARMv8 Cortex-A55');

    const gpu = parseGlesRenderer('GLES: ARM, Mali-400 MP, OpenGL ES 2.0');
    expect(gpu.renderer).toBe('Mali-400 MP');       // düşük-uç tespiti bu satıra bağlı

    const bat = parseBattery('  level: 87\n  scale: 100\n  temperature: 315\n  voltage: 4123\n');
    expect(bat.level).toBe(87);
    expect(bat.temperatureC).toBe(31.5);            // 1/10 °C

    expect(parseDfData('Filesystem 1K-blocks Used Available Use% Mounted\n/dev/x 10485760 2097152 8388608 20% /data'))
      .toEqual({ totalMb: 10240, availableMb: 8192 });
  });

  it('7b. bilinmeyen alan null kalır (yalancı kesinlik yok)', () => {
    expect(parseWmSize('')).toEqual({ width: null, height: null });
    expect(parseMemTotalMb('')).toBeNull();
    expect(parseGlesRenderer('').renderer).toBeNull();
    expect(computeScreenInches(null as unknown as number, 600, 160)).toBeNull();
    expect(computeScreenInches(1024, 600, 0)).toBeNull();
  });
});

/* ── Capability probe ────────────────────────────────────────────────────── */

describe('Capability probe', () => {
  const PROBE_ROUTES: Array<[RegExp, ExecResult]> = [
    [/devices/,               okRes(DEVICES_OK)],
    [/getprop ro\.build\.version\.release/, okRes('9\n')],
    [/getprop ro\.build\.version\.sdk/,     okRes('28\n')],
    [/shell id/,              okRes('uid=0(root) gid=0(root)')],
    [/dumpsys -l/,            okRes('Currently running services:\n  activity\n  package\n  gfxinfo\n  sensorservice\n  thermalservice\n  battery\n  meminfo\n  cpuinfo\n')],
    [/service list/,          okRes('0  activity: []\n')],
    [/logcat/,                okRes('--------- beginning of main\n')],
  ];

  it('9b. yetenekler toplanır (var/yok açıkça), root ve Android sürümü okunur', async () => {
    const t = await createTransport({
      adbPath: '/fake/adb', exists: existsAlways, env: {},
      exec: fakeExec(PROBE_ROUTES),
    });
    const caps = await probeCapabilities(t, { env: {}, exists: existsNever, now: () => new Date('2026-07-11T12:00:00Z') });

    expect(caps.transport).toBe(TRANSPORT_KIND.ADB);
    expect(caps.adb).toBe(true);
    expect(caps.root).toBe(true);
    expect(caps.androidRelease).toBe('9');
    expect(caps.sdk).toBe(28);
    expect(caps.dumpsys).toBe(true);
    expect(caps.gfxinfo).toBe(true);
    expect(caps.sensorservice).toBe(true);
    expect(caps.thermal).toBe(true);
    expect(caps.logcat).toBe(true);
    expect(caps.fastboot).toBe(false);      // exists=never → host'ta fastboot yok
    expect(caps.missing).toEqual([]);
  });

  it('9c. eksik servis "yok" olarak İŞARETLENİR (sessizce var sayılmaz)', async () => {
    const t = await createTransport({
      adbPath: '/fake/adb', exists: existsAlways, env: {},
      exec: fakeExec([
        [/devices/,    okRes(DEVICES_OK)],
        [/getprop/,    okRes('10\n')],
        [/shell id/,   okRes('uid=2000(shell)')],
        [/dumpsys -l/, okRes('Currently running services:\n  activity\n  package\n')],  // thermal/sensor YOK
        [/service list/, okRes('')],
        [/logcat/,     res({ code: 1, stderr: 'permission denied' })],
      ]),
    });
    const caps = await probeCapabilities(t, { env: {}, exists: existsNever });

    expect(caps.root).toBe(false);
    expect(caps.thermal).toBe(false);
    expect(caps.sensorservice).toBe(false);
    expect(caps.logcat).toBe(false);
    expect(caps.missing).toContain('thermal');
    expect(caps.missing).toContain('logcat');
    expect(caps.notes.join(' ')).toMatch(/thermalservice yok/i);
  });

  it('9d. yoklama TEK SEFER koşar (memoize — fazlar arası tutarlı kanıt)', async () => {
    const exec = fakeExec(PROBE_ROUTES);
    const t = await createTransport({ adbPath: '/fake/adb', exists: existsAlways, env: {}, exec });

    const first  = await probeCapabilities(t, { env: {}, exists: existsNever });
    const callsAfterFirst = exec.mock.calls.length;
    const second = await probeCapabilities(t, { env: {}, exists: existsNever });

    expect(second).toBe(first);                              // AYNI nesne
    expect(exec.mock.calls.length).toBe(callsAfterFirst);    // yeni komut YOK
  });

  it('9e. transport yokken yoklama çökmez → her yetenek false, missing dolu', async () => {
    const caps = await probeCapabilities(createNullTransport(), { env: {}, exists: existsNever });
    expect(caps.transport).toBe(TRANSPORT_KIND.NONE);
    expect(caps.adb).toBe(false);
    expect(caps.dumpsys).toBe(false);
    expect(caps.missing).toContain('adb');
  });
});

/* ── Device info + device.json ───────────────────────────────────────────── */

describe('Device info & device.json', () => {
  const FULL_ROUTES: Array<[RegExp, ExecResult]> = [
    [/devices/,                 okRes(DEVICES_OK)],
    [/getprop ro\.build\.version\.release/, okRes('9\n')],
    [/getprop ro\.build\.version\.sdk/,     okRes('28\n')],
    [/shell id/,                okRes('uid=0(root)')],
    [/dumpsys -l/,              okRes('  activity\n  gfxinfo\n  sensorservice\n  thermalservice\n  battery\n  meminfo\n  cpuinfo\n  package\n')],
    [/service list/,            okRes('')],
    [/logcat/,                  okRes('x')],
    [/shell getprop$/,          okRes([   // (seri-no öneki nedeniyle "^" kullanılamaz)
      '[ro.product.model]: [K24]',
      '[ro.product.manufacturer]: [NWD]',
      '[ro.product.brand]: [nwd]',
      '[ro.product.device]: [k24]',
      '[ro.build.version.release]: [9]',
      '[ro.build.version.sdk]: [28]',
      '[ro.build.type]: [userdebug]',
      '[ro.product.cpu.abi]: [armeabi-v7a]',
      '[ro.product.cpu.abilist]: [armeabi-v7a,armeabi]',
      '[ro.product.board]: [nwd]',
    ].join('\n'))],
    [/wm size/,                 okRes('Physical size: 1024x600')],
    [/wm density/,              okRes('Physical density: 160')],
    [/cat \/proc\/meminfo/,     okRes('MemTotal:        1027544 kB')],
    [/cat \/proc\/cpuinfo/,     okRes('processor\t: 0\nprocessor\t: 1\nprocessor\t: 2\nprocessor\t: 3\nHardware\t: nwd\n')],
    [/df \/data/,               okRes('Filesystem 1K-blocks Used Available Use%\n/dev/x 8388608 4194304 4194304 50% /data')],
    [/dumpsys SurfaceFlinger/,  okRes('GLES: ARM, Mali-400 MP, OpenGL ES 2.0')],
    [/dumpsys battery/,         okRes('  level: 90\n  scale: 100\n  temperature: 280\n')],
  ];

  it('7c. cihaz kimliği uçtan uca toplanır', async () => {
    const t = await createTransport({ adbPath: '/fake/adb', exists: existsAlways, env: {}, exec: fakeExec(FULL_ROUTES) });
    const caps = await probeCapabilities(t, { env: {}, exists: existsNever });
    const info = await collectDeviceInfo(t, caps, { now: () => new Date('2026-07-11T12:00:00Z') });

    expect(info.model).toBe('K24');
    expect(info.manufacturer).toBe('NWD');
    expect(info.androidRelease).toBe('9');
    expect(info.sdk).toBe(28);
    expect(info.abi).toBe('armeabi-v7a');
    expect(info.abiList).toEqual(['armeabi-v7a', 'armeabi']);
    expect(info.cpu.cores).toBe(4);
    expect(info.gpu.renderer).toBe('Mali-400 MP');
    expect(info.ramMb).toBe(1003);
    expect(info.storage.totalMb).toBe(8192);
    expect(info.display).toMatchObject({ width: 1024, height: 600, density: 160 });
    expect(info.display.sizeInches).toBeCloseTo(7.4, 1);
    expect(info.battery.level).toBe(90);
    expect(info.thermalSupport).toBe(true);
    expect(info.adbSupport).toBe(true);
  });

  it('cihazsız collectDeviceInfo boş ama GEÇERLİ kimlik döner (adbSupport:false)', async () => {
    const info = await collectDeviceInfo(createNullTransport(), null, {});
    expect(info.adbSupport).toBe(false);
    expect(info.model).toBeNull();
    expect(info.ramMb).toBeNull();
  });

  it('device.json üretilir; ham seri no SIZMAZ, scope bayrakları PR-2 kapsamını söyler', async () => {
    const t = await createTransport({ adbPath: '/fake/adb', exists: existsAlways, env: {}, exec: fakeExec(FULL_ROUTES) });
    const doc = await scanDevice({ transport: t, env: {}, exists: existsNever, now: () => new Date('2026-07-11T12:00:00Z') });

    expect(doc.schemaVersion).toBe(1);
    expect(doc.status).toBe('OK');
    expect(doc.device.model).toBe('K24');

    // Kapsam dürüstlüğü: PR-2 yalnız transport.
    expect(doc.scope).toEqual({
      transportOnly: true, performanceMeasured: false, sensorsAnalyzed: false, vehicleHalVerified: false,
    });

    // Gizlilik: ham seri no HİÇBİR yerde geçmez.
    const blob = JSON.stringify(doc);
    expect(blob).not.toContain('ABC123XYZ9');
    expect(doc.transport.serial).toBe('ABC1****');
    expect(blob).not.toMatch(/\/fake\/adb/);      // makine yolu da yok
  });

  it('ADB yokken device.json yine üretilir → status SKIPPED_NA (çökme YOK)', async () => {
    const doc = await scanDevice({ exists: existsNever, env: {}, exec: fakeExec([]), now: () => new Date('2026-07-11T12:00:00Z') });
    expect(doc.status).toBe('SKIPPED_NA');
    expect(doc.reason).toMatch(/bulunamadı/i);
    expect(doc.device.adbSupport).toBe(false);
    expect(doc.capabilities.adb).toBe(false);
  });

  it('seri no redaksiyonu: ağ seri numarasında IP gizlenir', () => {
    expect(redactSerial('ABC123XYZ9')).toBe('ABC1****');
    expect(redactSerial('10.118.60.216:5555')).toBe('<REDACTED_IP>:5555');
    expect(redactSerial('')).toBeNull();
  });
});

/* ── 11-13: Platform yolları ─────────────────────────────────────────────── */

describe('adb keşfi — Windows / Linux / macOS', () => {
  // path.join ayraçları çalıştığı platforma göre üretir (Windows'ta "\") →
  // aday yollar ayraçtan bağımsız karşılaştırılır. Böylece bu testler HER
  // platformda (yerel Windows + Ubuntu CI) aynı şeyi doğrular.
  const matcher = (suffix: string) => (p: string) => p.replace(/\\/g, '/').endsWith(suffix);

  it('11. Windows: LOCALAPPDATA Android SDK yolu bulunur', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };
    const seen: string[] = [];
    const found = findAdb(env, (p: string) => {
      seen.push(p);
      return matcher('AppData/Local/Android/Sdk/platform-tools/adb.exe')(p) ||
             matcher('AppData/Local/Android/Sdk/platform-tools/adb')(p);
    });
    expect(found).toBeTruthy();
    expect(String(found)).toMatch(/platform-tools/);
    expect(seen.some((p) => p.includes('AppData'))).toBe(true);
  });

  it('12. Linux: $HOME/Android/Sdk/platform-tools bulunur', () => {
    const found = findAdb({ HOME: '/home/x' }, matcher('/home/x/Android/Sdk/platform-tools/adb'));
    expect(found).toBeTruthy();
    expect(String(found).replace(/\\/g, '/')).toContain('/Android/Sdk/platform-tools/adb');
  });

  it('13. macOS: $HOME/Library/Android/sdk/platform-tools bulunur', () => {
    const found = findAdb({ HOME: '/Users/x' }, matcher('/Users/x/Library/Android/sdk/platform-tools/adb'));
    expect(found).toBeTruthy();
    expect(String(found).replace(/\\/g, '/')).toContain('/Library/Android/sdk/platform-tools/adb');
  });

  it('13b. ANDROID_HOME ve doğrudan ADB_PATH önceliklidir', () => {
    expect(findAdb({ ADB_PATH: '/özel/adb' }, (p: string) => p === '/özel/adb')).toBe('/özel/adb');
    const fromHome = findAdb({ ANDROID_HOME: '/sdk' }, matcher('/sdk/platform-tools/adb'));
    expect(fromHome).toBeTruthy();
  });

  it('13c. hiçbir yerde yoksa null (throw YOK)', () => {
    expect(findAdb({}, existsNever)).toBeNull();
    expect(findAdb({ PATH: '/a:/b', HOME: '/h' }, existsNever)).toBeNull();
  });
});

/* ── 14: Kapsam kilitleri ────────────────────────────────────────────────── */

describe('PR-2 kapsam kilitleri', () => {
  it('14. import yan etkisiz — modül yüklemek komut ÇALIŞTIRMAZ', () => {
    expect(typeof scanDevice).toBe('function');
    expect(typeof deviceRunId).toBe('function');
    const src = readFileSync(join(REPO_ROOT, 'qa', 'device', 'index.mjs'), 'utf8');
    expect(src).toMatch(/invokedDirectly/);   // main yalnız doğrudan çağrıda koşar
  });

  it('14b. cihaz katmanı UYGULAMAYA DOKUNMAZ (install/başlatma/uninstall yok)', () => {
    const files = [
      'qa/device/index.mjs',
      'qa/device/interfaces/transport.mjs',
      'qa/device/transport/adb.mjs',
      'qa/device/transport/capability-probe.mjs',
      'qa/device/transport/device-info.mjs',
    ];
    for (const f of files) {
      const src = readFileSync(join(REPO_ROOT, f), 'utf8');
      expect(src).not.toMatch(/['"`]install['"`]/);       // adb install YOK
      expect(src).not.toMatch(/['"`]uninstall['"`]/);
      expect(src).not.toMatch(/am\s+start|am\s+force-stop/);
      expect(src).not.toMatch(/gfxinfo['"`]\s*,\s*['"`]framestats/);  // performans ÖLÇÜMÜ yok
      expect(src).not.toMatch(/\bpm\s+(install|clear)/);
    }
  });

  it('14c. cihaz katmanı ürün runtime\'ını (src/) import ETMEZ', () => {
    const files = ['qa/device/index.mjs', 'qa/device/transport/adb.mjs', 'qa/device/transport/device-info.mjs'];
    for (const f of files) {
      const src = readFileSync(join(REPO_ROOT, f), 'utf8');
      expect(src).not.toMatch(/from\s+['"].*\/src\//);
      expect(src).not.toMatch(/from\s+['"]\.\.\/\.\.\/\.\.\/src/);
    }
  });

  it('14d. public API\'nin hiçbiri throw etmez (bozuk exec ile bile)', async () => {
    const explodingExec = vi.fn(async () => { throw new Error('exec patladı'); });
    const t = await createTransport({ adbPath: '/fake/adb', exists: existsAlways, env: {}, exec: explodingExec });
    // createTransport bile patlamaz → null transport'a düşer
    expect(t.kind).toBe(TRANSPORT_KIND.NONE);

    const doc = await scanDevice({ transport: t, env: {}, exists: existsNever, now: () => new Date('2026-07-11T12:00:00Z') });
    expect(doc.status).toBe('SKIPPED_NA');
  });
});
