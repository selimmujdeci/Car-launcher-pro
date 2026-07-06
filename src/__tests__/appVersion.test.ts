/**
 * appVersion.test.ts — Device Version Truth (OTA v1 / Commit 1)
 *
 * Kapsam:
 *  1. parseVersionProperties — saf parser doğruluğu (yorum/CRLF/bozuk değer)
 *  2. Tek-kaynak tutarlılığı — version.properties ↔ build.gradle ↔ package.json
 *  3. getAppVersionInfo wrapper — web'de undefined, native'de değer + cache,
 *     köprü hatasında undefined
 *  4. SystemHealthMonitor — sahte '1.0.0' körlüğü kalktı; native sürüm
 *     geldiğinde snapshot gerçek değeri raporlar
 *
 * NOT: Native PackageManager dönüşünün GERÇEK cihazdaki değeri burada
 * doğrulanamaz — "cihazda doğrulanmadı" (RELEASE_CHECKLIST kapsamı).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseVersionProperties,
  VERSION_FALLBACK,
} from '../utils/versionProperties';

// ── Mock altyapısı ────────────────────────────────────────────────────────────

const capState = { native: false };
const mockNativeGetAppVersionInfo = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capState.native,
    getPlatform:      () => (capState.native ? 'android' : 'web'),
  },
  registerPlugin: () => new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'getAppVersionInfo') return mockNativeGetAppVersionInfo;
      return vi.fn();
    },
  }),
}));

// vitest cwd = repo kökü (vitest.config.ts konumu)
const _root = (rel: string) => join(process.cwd(), rel);

/* ═══════════════════════════════════════════════════════════════
   1. parseVersionProperties — saf parser
═══════════════════════════════════════════════════════════════ */

describe('parseVersionProperties', () => {
  it('standart formatı parse eder (yorum + CRLF + trim)', () => {
    const content = '# yorum\r\n! eski stil yorum\r\n  VERSION_CODE = 7 \r\nVERSION_NAME=2.1.0\r\n\r\n';
    expect(parseVersionProperties(content)).toEqual({ versionCode: 7, versionName: '2.1.0' });
  });

  it('bozuk VERSION_CODE → alan bazında fallback (VERSION_NAME korunur)', () => {
    const r = parseVersionProperties('VERSION_CODE=abc\nVERSION_NAME=3.0.0');
    expect(r.versionCode).toBe(VERSION_FALLBACK.versionCode);
    expect(r.versionName).toBe('3.0.0');
  });

  it('negatif/sıfır VERSION_CODE reddedilir (Android strict-artan kuralı)', () => {
    expect(parseVersionProperties('VERSION_CODE=0').versionCode).toBe(VERSION_FALLBACK.versionCode);
    expect(parseVersionProperties('VERSION_CODE=-5').versionCode).toBe(VERSION_FALLBACK.versionCode);
  });

  it('eksik anahtarlar / boş içerik → tam fallback', () => {
    expect(parseVersionProperties('')).toEqual(VERSION_FALLBACK);
    expect(parseVersionProperties('UNRELATED=x')).toEqual(VERSION_FALLBACK);
  });
});

/* ═══════════════════════════════════════════════════════════════
   2. Tek-kaynak tutarlılığı (version.properties ↔ gradle ↔ package.json)
═══════════════════════════════════════════════════════════════ */

describe('tek sürüm kaynağı tutarlılığı', () => {
  const props = parseVersionProperties(readFileSync(_root('version.properties'), 'utf-8'));

  it('version.properties geçerli: VERSION_CODE ≥ 1, VERSION_NAME semver', () => {
    expect(props.versionCode).toBeGreaterThanOrEqual(1);
    expect(props.versionName).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('package.json "version" === VERSION_NAME (release:bump senkronu)', () => {
    const pkg = JSON.parse(readFileSync(_root('package.json'), 'utf-8')) as { version: string };
    expect(pkg.version).toBe(props.versionName);
  });

  it('build.gradle version.properties okuyor ve fallback değerleri parser ile aynı', () => {
    const gradle = readFileSync(_root('android/app/build.gradle'), 'utf-8');
    expect(gradle).toContain('version.properties');
    // build.gradle:17-18 fallback'leri ('2', '1.0.0') VERSION_FALLBACK ile senkron olmalı —
    // biri değişirse bu test kırılır ve iki tüketici birlikte güncellenir.
    expect(gradle).toContain(`?: '${VERSION_FALLBACK.versionCode}'`);
    expect(gradle).toContain(`?: '${VERSION_FALLBACK.versionName}'`);
  });

  it('vite.config.ts VITE_APP_VERSION define enjeksiyonu içeriyor (körlük fix kanıtı)', () => {
    const viteConfig = readFileSync(_root('vite.config.ts'), 'utf-8');
    expect(viteConfig).toContain('parseVersionProperties');
    expect(viteConfig).toContain("'import.meta.env.VITE_APP_VERSION'");
  });
});

/* ═══════════════════════════════════════════════════════════════
   3. getAppVersionInfo wrapper (nativeCommandBridge)
═══════════════════════════════════════════════════════════════ */

describe('getAppVersionInfo wrapper', () => {
  beforeEach(() => {
    vi.resetModules(); // modül-içi cache'i sıfırla
    capState.native = false;
    mockNativeGetAppVersionInfo.mockReset();
  });

  it('web/dev → undefined, native köprü hiç çağrılmaz', async () => {
    const { getAppVersionInfo } = await import('../platform/nativeCommandBridge');
    await expect(getAppVersionInfo()).resolves.toBeUndefined();
    expect(mockNativeGetAppVersionInfo).not.toHaveBeenCalled();
  });

  it('native → değer döner; ikinci çağrı cache (köprü 1 kez çağrılır)', async () => {
    capState.native = true;
    mockNativeGetAppVersionInfo.mockResolvedValue({
      versionCode: 7, versionName: '1.2.3', packageName: 'com.cockpitos.pro',
    });
    const { getAppVersionInfo } = await import('../platform/nativeCommandBridge');

    const first = await getAppVersionInfo();
    expect(first).toEqual({ versionCode: 7, versionName: '1.2.3', packageName: 'com.cockpitos.pro' });

    await getAppVersionInfo();
    expect(mockNativeGetAppVersionInfo).toHaveBeenCalledTimes(1);
  });

  it('köprü hatası → undefined (fail-soft, çağıran build-time değere düşer)', async () => {
    capState.native = true;
    mockNativeGetAppVersionInfo.mockRejectedValue(new Error('bridge down'));
    const { getAppVersionInfo } = await import('../platform/nativeCommandBridge');
    await expect(getAppVersionInfo()).resolves.toBeUndefined();
  });

  it('boş versionName → undefined ve CACHE\'lenmez (bozuk yanıt kalıcılaşmaz)', async () => {
    capState.native = true;
    mockNativeGetAppVersionInfo.mockResolvedValueOnce({ versionCode: 0, versionName: '', packageName: '' });
    const { getAppVersionInfo } = await import('../platform/nativeCommandBridge');
    await expect(getAppVersionInfo()).resolves.toBeUndefined();

    // Sonraki çağrıda köprü tekrar denenir (cache kirletilmedi)
    mockNativeGetAppVersionInfo.mockResolvedValueOnce({ versionCode: 3, versionName: '1.0.1', packageName: 'p' });
    await expect(getAppVersionInfo()).resolves.toMatchObject({ versionName: '1.0.1' });
    expect(mockNativeGetAppVersionInfo).toHaveBeenCalledTimes(2);
  });
});

/* ═══════════════════════════════════════════════════════════════
   4. SystemHealthMonitor — '1.0.0' körlüğü kalktı
═══════════════════════════════════════════════════════════════ */

describe('SystemHealthMonitor appVersion', () => {
  // Ağır import zinciri (UnifiedVehicleStore/gps/errorBus...) describe başına
  // TEK KEZ yüklenir — test başına resetModules+import paralel suite yükünde
  // 5s varsayılan timeout'u aşıyordu (izole geçip suite'te düşen flake).
  let healthMonitor: typeof import('../platform/system/SystemHealthMonitor')['healthMonitor'];

  beforeAll(async () => {
    vi.resetModules();
    capState.native = false;
    mockNativeGetAppVersionInfo.mockReset();
    ({ healthMonitor } = await import('../platform/system/SystemHealthMonitor'));
  }, 30_000);

  it("enjeksiyon + native yokken sahte '1.0.0' DEĞİL, görünür '0.0.0-unknown'", () => {
    const snap = healthMonitor.getGlobalHealthSnapshot();
    // Eski bug: ?? '1.0.0' her cihazı gerçek sürüm gibi gösteriyordu.
    expect(snap.appVersion).not.toBe('1.0.0');
    expect(snap.appVersion).toBe('0.0.0-unknown');
  });

  it('start() sonrası native sürüm snapshot\'a yansır (kurulu gerçek kazanır)', async () => {
    capState.native = true;
    mockNativeGetAppVersionInfo.mockResolvedValue({
      versionCode: 9, versionName: '9.9.9', packageName: 'com.cockpitos.pro',
    });
    try {
      healthMonitor.start();
      await Promise.resolve(); // _primeAppVersion mikrotask flush
      await Promise.resolve();
      expect(healthMonitor.getGlobalHealthSnapshot().appVersion).toBe('9.9.9');
    } finally {
      healthMonitor.stop();
      capState.native = false;
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   5. SystemHealthMonitor — GPS izin-reddi ile "healthy" çelişkisi (BUG FIX)
   SAHA: rapor "GPS healthy:true" + "permission denied" çelişkisi gösteriyordu —
   heartbeat bazlı hesap izin durumunu hiç görmüyordu (register() anındaki
   lastBeat deadline'ı henüz doldurmadığı için erken healthy=true görünüyordu).
═══════════════════════════════════════════════════════════════ */

describe('SystemHealthMonitor — GPS izin reddi ile healthy çelişkisi (BUG FIX)', () => {
  let healthMonitor: typeof import('../platform/system/SystemHealthMonitor')['healthMonitor'];
  let setGPSTestOverride: typeof import('../platform/gpsService')['setGPSTestOverride'];
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    vi.resetModules();
    capState.native = false;
    ({ healthMonitor } = await import('../platform/system/SystemHealthMonitor'));
    ({ setGPSTestOverride } = await import('../platform/gpsService'));
  }, 30_000);

  beforeEach(() => {
    nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    healthMonitor.register({
      name:       'GPS',
      criticality: 'warning',
      deadlineMs:  20_000,
      alertTitle:  'GPS Sinyali Yok',
      alertMsg:    'Konum verisi alınamıyor.',
    });
    healthMonitor.start();
  });

  afterEach(() => {
    healthMonitor.stop();
    setGPSTestOverride(null); // override'ı ve store alanlarını gerçek (varsayılan) duruma döndür
    nowSpy.mockRestore();
  });

  it('STARTUP_GRACE (45s) sonrası izin reddi → healthy:false + sebep', () => {
    setGPSTestOverride({ unavailable: true, error: 'GPS permission denied' });
    nowSpy.mockReturnValue(46_000);
    const gps = healthMonitor.getGlobalHealthSnapshot().services.find((s) => s.name === 'GPS');
    expect(gps?.healthy).toBe(false);
    expect(gps?.unhealthyReason).toBe('gps_permission_denied');
  });

  it('grace penceresi içinde (erken) izin reddi tek başına healthy:false yapmaz (cold-start koruması penceresiyle aynı)', () => {
    setGPSTestOverride({ unavailable: true, error: 'GPS permission denied' });
    nowSpy.mockReturnValue(10_000); // 45s grace içinde
    const gps = healthMonitor.getGlobalHealthSnapshot().services.find((s) => s.name === 'GPS');
    expect(gps?.healthy).toBe(true);
    expect(gps?.unhealthyReason).toBeUndefined();
  });

  it('izin reddi YOKSA taze heartbeat ile healthy:true kalır (regresyon yok)', () => {
    nowSpy.mockReturnValue(46_000);
    healthMonitor.beat('GPS');
    const gps = healthMonitor.getGlobalHealthSnapshot().services.find((s) => s.name === 'GPS');
    expect(gps?.healthy).toBe(true);
    expect(gps?.unhealthyReason).toBeUndefined();
  });
});
