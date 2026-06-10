/**
 * remoteLogService.test.ts — Remote Log v1 / Commit 2
 *
 * Kapsam: sanitize (allowlist + deny-list + regex maskeleri) · dedup ·
 * token bucket rate limit · boot-time crash drain + clearErrorLog ispatı ·
 * support snapshot içeriği · pushVehicleEvent payload şekli · canlı sink.
 *
 * crashLogger GERÇEK implementasyonla koşar (jsdom localStorage) —
 * yalnız clearErrorLog spy ile sarılır (çağrı ispatı). pushVehicleEvent
 * yakalanan-parametre mock'u (otaUpdateService.test.ts deseni).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock'lar ────────────────────────────────────────────────── */

const M = vi.hoisted(() => ({
  pushed: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  pushError: null as Error | null,
  clearSpy: vi.fn(),
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  pushVehicleEvent: vi.fn(async (type: string, payload: Record<string, unknown>) => {
    if (M.pushError) throw M.pushError;
    M.pushed.push({ type, payload });
  }),
}));

// crashLogger: gerçek modül + clearErrorLog çağrı-ispatı spy'ı
vi.mock('../platform/crashLogger', async (importOriginal) => {
  const real = await importOriginal<typeof import('../platform/crashLogger')>();
  return {
    ...real,
    clearErrorLog: (...a: Parameters<typeof real.clearErrorLog>) => {
      M.clearSpy(...a);
      return real.clearErrorLog(...a);
    },
  };
});

vi.mock('../platform/obdService', () => ({
  getOBDStatusSnapshot: () => ({
    connectionState: 'connected',
    source: 'real',
    vehicleType: 'ice',
    lastSeenMs: 1234,
  }),
}));

vi.mock('../platform/system/SystemHealthMonitor', () => ({
  healthMonitor: {
    getGlobalHealthSnapshot: () => ({
      appVersion: '2.4.0',
      overallHealth: 'healthy',
      services: [{ name: 'GPS', healthy: true, restartCount: 0, criticality: 'critical' }],
    }),
  },
}));

// Commit 4: snapshot OTA özeti — ağır otaUpdateService grafiği yerine sabit mock
vi.mock('../platform/otaUpdateService', () => ({
  useOtaStore: { getState: () => ({ state: 'idle', errorCode: null, release: null, lastCheckTs: null }) },
  getCurrentVersionCode: vi.fn(async () => 7),
}));

import {
  sanitizeForRemote,
  reportCritical,
  reportObdDiag,
  reportSupportSnapshot,
  drainBootCrashLog,
  startRemoteLogService,
  _resetRemoteLogServiceForTest,
} from '../platform/remoteLogService';
import { logError, getErrorLog, clearErrorLog } from '../platform/crashLogger';

let _stopService: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
  _resetRemoteLogServiceForTest();
  clearErrorLog();
  M.pushed = [];
  M.pushError = null;
  M.clearSpy.mockClear();
});

afterEach(() => {
  _stopService?.();
  _stopService = null;
  clearErrorLog();
  vi.useRealTimers();
});

/* ── Sanitize: deny-list ─────────────────────────────────────── */

describe('sanitizeForRemote — allowlist + deny-list', () => {
  it('üst seviyede yalnız allowlist alanları geçer', () => {
    const out = sanitizeForRemote({
      ctx: 'OBD', msg: 'x', errorCode: 'E1', severity: 'critical',
      appVersion: '1.0', transport: 'ble', protocol: 'elm327',
      attempts: 3, elapsedMs: 120, bootId: 'abc', source: 'real', stack: 's',
      speed: 88, rpm: 3000, foo: { bar: 1 },        // allowlist dışı → düşer
    });
    expect(Object.keys(out).sort()).toEqual([
      'appVersion', 'attempts', 'bootId', 'ctx', 'elapsedMs', 'errorCode',
      'msg', 'protocol', 'severity', 'source', 'stack', 'transport',
    ]);
  });

  it('deny-list alanları HER derinlikte düşer (büyük/küçük harf dahil)', () => {
    const out = sanitizeForRemote({
      ctx: 'GPS',
      protocol: {
        name: 'elm327',
        lat: 41.0, lng: 29.0, latitude: 41, longitude: 29,
        location: { lat: 1 }, address: 'Kadıköy', vin: 'X', plate: '34AB123',
        plaka: '34', phone: '+90', contact: 'x', ssid: 'wifi', bssid: 'b',
        mac: 'AA', API_KEY: 'gizli', Token: 't',
        nested: { deep: { Lat: 5, msg: 'ok' } },
      },
    });
    const proto = out.protocol as Record<string, unknown>;
    expect(proto.name).toBe('elm327');
    for (const k of ['lat', 'lng', 'latitude', 'longitude', 'location', 'address',
                     'vin', 'plate', 'plaka', 'phone', 'contact', 'ssid', 'bssid',
                     'mac', 'API_KEY', 'Token']) {
      expect(proto, `deny alanı sızdı: ${k}`).not.toHaveProperty(k);
    }
    const deep = (proto.nested as Record<string, unknown>).deep as Record<string, unknown>;
    expect(deep.msg).toBe('ok');
    expect(deep).not.toHaveProperty('Lat');
  });
});

/* ── Sanitize: regex maskeleri ───────────────────────────────── */

describe('sanitizeForRemote — regex maskeleri', () => {
  it('VIN, MAC, koordinat çifti, api_key= ve token= maskelenir', () => {
    const out = sanitizeForRemote({
      msg: 'vin=WVWZZZ1JZXW000001 mac=AA:BB:CC:DD:EE:FF pos=41.00821, 28.97842 ' +
           'url?api_key=sk_live_123&token=eyJabc.def end',
    });
    const msg = out.msg as string;
    expect(msg).not.toContain('WVWZZZ1JZXW000001');
    expect(msg).toContain('[VIN]');
    expect(msg).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(msg).toContain('[MAC]');
    expect(msg).not.toContain('41.00821');
    expect(msg).toContain('[COORD]');
    expect(msg).not.toContain('sk_live_123');
    expect(msg).toContain('api_key=[MASKED]');
    expect(msg).not.toContain('eyJabc.def');
    expect(msg).toContain('token=[MASKED]');
  });

  it('maske iç içe string alanlarda da uygulanır (stack)', () => {
    const out = sanitizeForRemote({ stack: 'at connect (mac AA:BB:CC:DD:EE:FF)' });
    expect(out.stack as string).toContain('[MAC]');
  });

  it('uzun string 2048 karaktere kırpılır (client ön-kırpma)', () => {
    const out = sanitizeForRemote({ msg: 'a'.repeat(10_000) });
    expect((out.msg as string).length).toBeLessThanOrEqual(2_048);
  });
});

/* ── Dedup ───────────────────────────────────────────────────── */

describe('dedup — aynı ctx+msg oturum başına 1 kez', () => {
  it('ikinci aynı rapor gönderilmez, farklı msg gönderilir', async () => {
    expect(await reportCritical('OBD', 'connect timeout')).toBe(true);
    expect(await reportCritical('OBD', 'connect timeout')).toBe(false);
    expect(await reportCritical('OBD', 'handshake failed')).toBe(true);
    expect(M.pushed).toHaveLength(2);
  });

  it('dedup düşürmesi rate limit jetonu HARCAMAZ', async () => {
    await reportCritical('A', 'same');
    for (let i = 0; i < 50; i++) await reportCritical('A', 'same'); // hepsi dedup
    expect(await reportCritical('B', 'fresh')).toBe(true);          // jeton hâlâ var
  });
});

/* ── Rate limit ──────────────────────────────────────────────── */

describe('rate limit — saatte maks. 10 critical_error', () => {
  it('11. farklı hata düşer; 1 saat sonra bütçe yenilenir', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await reportCritical('CTX', `err-${i}`)).toBe(true);
    }
    expect(await reportCritical('CTX', 'err-overflow')).toBe(false);
    expect(M.pushed).toHaveLength(10);

    vi.advanceTimersByTime(3_600_000); // 1 saat → bucket dolar
    expect(await reportCritical('CTX', 'err-after-refill')).toBe(true);
    expect(M.pushed).toHaveLength(11);
  });

  it('kısmi yenileme: 6 dk = 1 jeton', async () => {
    for (let i = 0; i < 10; i++) await reportCritical('C', `e${i}`);
    vi.advanceTimersByTime(6 * 60_000 + 1);
    expect(await reportCritical('C', 'one-token')).toBe(true);
    expect(await reportCritical('C', 'no-token')).toBe(false);
  });
});

/* ── Boot drain ──────────────────────────────────────────────── */

describe('boot-time crash drain', () => {
  it('önceki oturumun critical kayıtları gönderilir, sonra clearErrorLog çağrılır', async () => {
    logError('GPS',  new Error('fatal gps crash'),  'critical');
    logError('OBD',  new Error('fatal obd crash'),  'critical');
    logError('Media', new Error('non-critical'));            // error → gitmez
    logError('Theme', new Error('just warn'), 'warning');    // warning → gitmez

    const sent = await drainBootCrashLog();

    expect(sent).toBe(2);
    expect(M.pushed.map((p) => p.type)).toEqual(['critical_error', 'critical_error']);
    expect(M.pushed[0]!.payload.msg).toBe('fatal gps crash');
    // clearErrorLog ÇAĞRILDI (spy ispatı) + log gerçekten boş (etki ispatı)
    expect(M.clearSpy).toHaveBeenCalledTimes(1);
    expect(getErrorLog()).toHaveLength(0);
  });

  it('critical kayıt yoksa hiçbir şey gönderilmez ve log TEMİZLENMEZ', async () => {
    logError('Media', new Error('minor'));
    const sent = await drainBootCrashLog();
    expect(sent).toBe(0);
    expect(M.pushed).toHaveLength(0);
    expect(M.clearSpy).not.toHaveBeenCalled();
    expect(getErrorLog()).toHaveLength(1); // lokal log korunur
  });

  it('enqueue hatasında log SİLİNMEZ (bir sonraki boot yeniden dener)', async () => {
    logError('GPS', new Error('fatal'), 'critical');
    M.pushError = new Error('network down');
    await drainBootCrashLog();
    expect(M.clearSpy).not.toHaveBeenCalled();
    expect(getErrorLog()).toHaveLength(1);
  });

  it('replayBuffer (kara kutu konum verisi) payload\'a SIZMAZ', async () => {
    logError('Safety', new Error('crash with replay'), 'critical');
    await drainBootCrashLog();
    expect(M.pushed[0]!.payload).not.toHaveProperty('replayBuffer');
    expect(M.pushed[0]!.payload).not.toHaveProperty('lat');
  });
});

/* ── Canlı sink (crashLogger → remoteLogService) ─────────────── */

describe('registerRemoteSink entegrasyonu', () => {
  it('critical logError anında reportCritical üretir; error/warning üretmez', async () => {
    _stopService = startRemoteLogService();
    await vi.runAllTimersAsync(); // boot drain mikrotask'ları

    logError('React', new Error('render crash'), 'critical');
    logError('GPS',   new Error('normal error'));            // default 'error'
    logError('Theme', new Error('a warning'), 'warning');
    await vi.runAllTimersAsync();

    expect(M.pushed).toHaveLength(1);
    expect(M.pushed[0]!.type).toBe('critical_error');
    expect(M.pushed[0]!.payload.ctx).toBe('React');
  });

  it('canlı gönderilen entry bir sonraki boot drain\'inde TEKRAR gitmez (watermark)', async () => {
    _stopService = startRemoteLogService();
    await vi.runAllTimersAsync();
    logError('React', new Error('sent live'), 'critical');
    await vi.runAllTimersAsync();
    expect(M.pushed).toHaveLength(1);

    // Yeni "oturum": dedup/token sıfırlanır ama watermark safeStorage'da kalır
    _stopService();
    _stopService = null;
    _resetRemoteLogServiceForTest({ keepWatermark: true });
    const sent = await drainBootCrashLog();
    expect(sent).toBe(0);             // watermark filtreledi (dedup değil)
    expect(M.pushed).toHaveLength(1); // tekrar gönderilmedi
  });
});

/* ── support_snapshot ────────────────────────────────────────── */

describe('reportSupportSnapshot', () => {
  it('appVersion + OBD durumu + son hata özeti + sağlık özeti içerir; konum YOK', async () => {
    logError('OBD', new Error('recent failure at 41.00821, 28.97842'));
    const payload = await reportSupportSnapshot();

    expect(payload.appVersion).toBe('2.4.0');
    expect(payload.bootId).toBeTruthy();

    const obd = payload.obd as Record<string, unknown>;
    expect(obd.connectionState).toBe('connected');
    expect(obd.source).toBe('real');

    const lastErrors = payload.lastErrors as Array<Record<string, unknown>>;
    expect(lastErrors).toHaveLength(1);
    expect(lastErrors[0]!.ctx).toBe('OBD');
    expect(lastErrors[0]!.msg as string).toContain('[COORD]'); // koordinat maskelendi
    expect(lastErrors[0]!).not.toHaveProperty('stack');        // stack snapshot'a girmez

    const health = payload.health as Record<string, unknown>;
    expect(health.overallHealth).toBe('healthy');

    // Konum hiçbir derinlikte yok
    const flat = JSON.stringify(payload).toLowerCase();
    expect(flat).not.toContain('"lat"');
    expect(flat).not.toContain('"lng"');
    expect(flat).not.toContain('"location"');

    // pushVehicleEvent doğru tiple çağrıldı
    expect(M.pushed[0]!.type).toBe('support_snapshot');
  });
});

/* ── obd_diag + payload şekli ────────────────────────────────── */

describe('pushVehicleEvent payload şekli', () => {
  it('critical_error: ctx/msg/severity/appVersion/bootId alanları + tip', async () => {
    await reportCritical('OBD', 'boom', { stack: 'at x', errorCode: 'E42' });
    expect(M.pushed).toHaveLength(1);
    const { type, payload } = M.pushed[0]!;
    expect(type).toBe('critical_error');
    expect(payload).toMatchObject({
      ctx: 'OBD', msg: 'boom', stack: 'at x', errorCode: 'E42',
      severity: 'critical', appVersion: '2.4.0',
    });
    expect(typeof payload.bootId).toBe('string');
    expect((payload.bootId as string).length).toBeLessThan(17); // VIN maskesine takılmaz
  });

  it('obd_diag: allowlist alanları geçer, gizli alanlar düşer', async () => {
    await reportObdDiag({
      msg: 'handshake timeout', transport: 'ble', protocol: 'elm327',
      attempts: 3, elapsedMs: 4500, errorCode: 'OBD_TIMEOUT',
      mac: 'AA:BB:CC:DD:EE:FF', ssid: 'CarWifi', speed: 90,
    });
    const { type, payload } = M.pushed[0]!;
    expect(type).toBe('obd_diag');
    expect(payload).toMatchObject({
      msg: 'handshake timeout', transport: 'ble', protocol: 'elm327',
      attempts: 3, elapsedMs: 4500, errorCode: 'OBD_TIMEOUT', ctx: 'OBD',
    });
    expect(payload).not.toHaveProperty('mac');
    expect(payload).not.toHaveProperty('ssid');
    expect(payload).not.toHaveProperty('speed'); // allowlist dışı
  });
});
