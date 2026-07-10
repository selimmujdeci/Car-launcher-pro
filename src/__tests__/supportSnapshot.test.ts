/**
 * supportSnapshot.test.ts — Remote Log v1 / Commit 4
 *
 * Kapsam: support_snapshot payload formatı (versionCode + OTA özeti dahil) ·
 * hassas alan yok (OBD + OTA güvenli) · cooldown · offline queue davranışı ·
 * enqueue hatasında 'error' (cooldown yanmaz) · UI kaynak-sözleşmesi
 * (react-dom/client bu jsdom setup'ında çöktüğünden render YOK —
 * runtimeSimulator.ts notu; repo deseni: otaTelemetry.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({
  pushed: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  pushError: null as Error | null,
  ota: {
    state: 'failed', errorCode: 'ERR_SHA256_MISMATCH',
    release: {
      versionCode: 9, versionName: '1.2.0', channel: 'production',
      apkPath: 'releases/v1.2.0/caros-pro-v9.apk', apkSize: 1024, sha256: 'a'.repeat(64),
    },
    lastCheckTs: 1765000000000,
  } as Record<string, unknown>,
  versionCode: 7,
  replay: [] as unknown[], // blackBox getReplayData() dönüşü (test başına ayarlanır)
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  pushVehicleEvent: vi.fn(async (type: string, payload: Record<string, unknown>) => {
    if (M.pushError) throw M.pushError;
    M.pushed.push({ type, payload });
  }),
}));

vi.mock('../platform/obdService', () => ({
  getOBDStatusSnapshot: () => ({
    connectionState: 'error',
    source: 'none',
    vehicleType: 'ice',
    lastSeenMs: 1765000001000,
  }),
}));

vi.mock('../platform/system/SystemHealthMonitor', () => ({
  healthMonitor: {
    getGlobalHealthSnapshot: () => ({
      appVersion: '2.4.0',
      overallHealth: 'degraded',
      services: [{ name: 'OBD', healthy: false, restartCount: 2, criticality: 'critical' }],
    }),
  },
}));

vi.mock('../platform/otaUpdateService', () => ({
  useOtaStore: { getState: () => M.ota },
  getCurrentVersionCode: vi.fn(async () => M.versionCode),
}));

// Kara Kutu replay: getReplayData() kontrollü örnek döndürsün (gerçek servis
// startBlackBox olmadan boş ring döner). Yalnız bu alanı mock'la — diğer export'lara
// dokunmaya gerek yok (remoteLogService yalnız getReplayData çağırır).
vi.mock('../platform/security/blackBoxService', () => ({
  getReplayData: vi.fn(() => M.replay),
}));

import {
  reportSupportSnapshot,
  triggerSupportSnapshot,
  SNAPSHOT_COOLDOWN_MS,
  _resetRemoteLogServiceForTest,
} from '../platform/remoteLogService';
import { logError, clearErrorLog } from '../platform/crashLogger';
import { useVidStore } from '../store/useVidStore';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
  _resetRemoteLogServiceForTest();
  clearErrorLog();
  useVidStore.getState().resetStore(); // VID izolasyonu — testler arası kimlik sızmasın
  M.pushed = [];
  M.pushError = null;
  M.versionCode = 7;
  M.replay = [];
});

afterEach(() => {
  clearErrorLog();
  vi.useRealTimers();
});

/* ── Payload formatı ─────────────────────────────────────────── */

describe('support_snapshot payload formatı', () => {
  it('appVersion/versionCode/bootId/obd/health/lastErrors/lastCritical/ota alanları', async () => {
    logError('GPS', new Error('normal hata'));
    logError('React', new Error('render crash'), 'critical');

    const payload = await reportSupportSnapshot();

    expect(M.pushed[0]!.type).toBe('support_snapshot');
    expect(payload.appVersion).toBe('2.4.0');
    expect(payload.versionCode).toBe(7);
    expect(typeof payload.bootId).toBe('string');

    const obd = payload.obd as Record<string, unknown>;
    expect(obd).toMatchObject({
      connectionState: 'error', source: 'none', vehicleType: 'ice', lastSeenMs: 1765000001000,
    });

    const health = payload.health as Record<string, unknown>;
    expect(health.overallHealth).toBe('degraded');
    expect((health.services as unknown[])).toHaveLength(1);

    expect(payload.lastErrors as unknown[]).toHaveLength(2);

    const lastCritical = payload.lastCritical as Record<string, unknown>;
    expect(lastCritical.ctx).toBe('React');
    expect(lastCritical.msg).toBe('render crash');
    expect(lastCritical).not.toHaveProperty('stack');

    const ota = payload.ota as Record<string, unknown>;
    expect(ota).toMatchObject({
      state: 'failed', errorCode: 'ERR_SHA256_MISMATCH',
      targetVersionCode: 9, lastCheckTs: 1765000000000,
    });
  });

  it('critical kayıt yoksa lastCritical=null', async () => {
    logError('Media', new Error('minor'));
    const payload = await reportSupportSnapshot();
    expect(payload.lastCritical).toBeNull();
  });
});

/* ── Hassas alan filtreleri ──────────────────────────────────── */

describe('hassas alan yok', () => {
  it('OTA özeti apkPath/fileName/sha256 İÇERMEZ (storage yolu sızmaz)', async () => {
    const payload = await reportSupportSnapshot();
    const ota = payload.ota as Record<string, unknown>;
    expect(ota).not.toHaveProperty('apkPath');
    expect(ota).not.toHaveProperty('fileName');
    expect(ota).not.toHaveProperty('sha256');
    expect(JSON.stringify(payload)).not.toContain('releases/v1.2.0');
  });

  it('OBD snapshot güvenli: deviceName/address/mac yok', async () => {
    const payload = await reportSupportSnapshot();
    const obd = payload.obd as Record<string, unknown>;
    expect(Object.keys(obd).sort()).toEqual(
      ['connectionState', 'lastSeenMs', 'source', 'vehicleType']);
  });

  it('hata mesajlarındaki VIN/MAC/koordinat maskelenir; konum anahtarı hiç yok', async () => {
    logError('OBD', new Error('vin WVWZZZ1JZXW000001 mac AA:BB:CC:DD:EE:FF poz 41.00821, 28.97842'), 'critical');
    const payload = await reportSupportSnapshot();

    const flat = JSON.stringify(payload);
    expect(flat).not.toContain('WVWZZZ1JZXW000001');
    expect(flat).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(flat).not.toContain('41.00821');
    expect(flat).toContain('[VIN]');
    expect(flat).toContain('[MAC]');
    expect(flat).toContain('[COORD]');

    const lower = flat.toLowerCase();
    for (const key of ['"lat"', '"lng"', '"location"', '"token"', '"api_key"', '"plate"', '"plaka"', '"vin"']) {
      expect(lower, `hassas anahtar sızdı: ${key}`).not.toContain(key);
    }
  });
});

/* ── vidMirror allowlist ─────────────────────────────────────── */

describe('vidMirror allowlist + gizlilik', () => {
  it('vidMirror bölümü dört alt-bölümüyle (allowlist alanları) payload\'a eklenir', async () => {
    const vid = useVidStore.getState();
    vid.updateHeadUnitInfo({ detectedPlatform: 'hiworld', webViewChromeVersion: 88, isPlayServicesAvailable: false });
    vid.updateObdAdapterInfo({ lastTransport: 'classic', isTransportVerified: true, lastProtocolNum: '6' });
    vid.updateVehicleInfo({ make: 'Dacia', model: 'Duster', modelYear: 2021, vehicleType: 'diesel' });
    vid.updateTelemetryInfo({ trustScore: 0.42, healthState: 'STRESSED', thermalStatus: 'HEAT_SOAK', isDiagnosticDegraded: true });

    const payload = await reportSupportSnapshot();
    const vm = payload.vidMirror as Record<string, Record<string, unknown>>;
    expect(vm).toBeTruthy();

    expect(vm.headUnit).toMatchObject({ detectedPlatform: 'hiworld', webViewChromeVersion: 88, isPlayServicesAvailable: false });
    // store'daki isTransportVerified → payload'da transportVerified olarak map edilir
    expect(vm.obdAdapter).toMatchObject({ lastTransport: 'classic', transportVerified: true, lastProtocolNum: '6' });
    expect(vm.vehicle).toMatchObject({ make: 'Dacia', model: 'Duster', modelYear: 2021, vehicleType: 'diesel' });
    expect(vm.telemetry).toMatchObject({ trustScore: 0.42, healthState: 'STRESSED', thermalStatus: 'HEAT_SOAK', isDiagnosticDegraded: true });
  });

  it('ham VIN payload\'a girmez; yalnız maskeli vinMasked çıkar', async () => {
    useVidStore.getState().updateVehicleInfo({ vin: 'WVWZZZ1JZXW000001', make: 'VW', model: 'Golf' });

    const payload = await reportSupportSnapshot();
    const vm = payload.vidMirror as Record<string, Record<string, unknown>>;

    expect(vm.vehicle.vinMasked).toBeTruthy();
    expect(vm.vehicle.vinMasked).not.toBe('WVWZZZ1JZXW000001'); // maskeli, ham değil
    expect(vm.vehicle).not.toHaveProperty('vin');               // ham vin anahtarı yok
    expect(JSON.stringify(payload)).not.toContain('WVWZZZ1JZXW000001');
  });

  it('VIN yoksa vinMasked=null', async () => {
    const payload = await reportSupportSnapshot();
    const vm = payload.vidMirror as Record<string, Record<string, unknown>>;
    expect(vm.vehicle.vinMasked).toBeNull();
  });

  it('ham MAC/adres (lastAddress) ve installedPackages payload\'a girmez', async () => {
    useVidStore.getState().updateObdAdapterInfo({ lastAddress: '00:11:22:33:44:55', lastTransport: 'ble' });
    useVidStore.getState().updateHeadUnitInfo({ installedPackages: ['com.secret.app'] });

    const payload = await reportSupportSnapshot();
    const vm = payload.vidMirror as Record<string, Record<string, unknown>>;

    expect(vm.obdAdapter).not.toHaveProperty('lastAddress');   // MAC/adres allowlist dışı
    expect(vm.headUnit).not.toHaveProperty('installedPackages'); // uygulama listesi allowlist dışı
    const flat = JSON.stringify(payload);
    expect(flat).not.toContain('00:11:22:33:44:55');
    expect(flat).not.toContain('com.secret.app');
  });

  it('telemetry alanları (trustScore/healthState/thermalStatus/isDiagnosticDegraded/plausibilityFailures) mevcut', async () => {
    useVidStore.getState().updateTelemetryInfo({
      trustScore: 0.7, healthState: 'MONITOR', thermalStatus: 'WARM',
      isDiagnosticDegraded: false, plausibilityFailures: { rpm: 'jump>5000' },
    });

    const payload = await reportSupportSnapshot();
    const tel = (payload.vidMirror as Record<string, Record<string, unknown>>).telemetry;

    expect(tel).toMatchObject({
      trustScore: 0.7, healthState: 'MONITOR', thermalStatus: 'WARM', isDiagnosticDegraded: false,
    });
    expect(tel.plausibilityFailures).toEqual({ rpm: 'jump>5000' });
  });

  it('sanitize pipeline vidMirror üstünde de çalışır (deep sanitize son savunma)', async () => {
    // Allowlist ham VIN'i zaten dışarıda tutar; _deepSanitize ise izinli bir
    // alanın DEĞERİNE sızan koordinat/VIN'i yine de maskeler (üst üste savunma).
    useVidStore.getState().updateVehicleInfo({ vin: 'WVWZZZ1JZXW000001' });
    useVidStore.getState().updateTelemetryInfo({
      plausibilityFailures: { gps: 'poz 41.00821, 28.97842 sapmasi' },
    });

    const payload = await reportSupportSnapshot();
    const flat = JSON.stringify(payload);

    expect(flat).toContain('[COORD]');            // plausibility reason'daki koordinat maskelendi
    expect(flat).not.toContain('41.00821');
    expect(flat).not.toContain('WVWZZZ1JZXW000001'); // ham VIN hiçbir yerde yok
  });
});

/* ── Black Box replayBuffer ──────────────────────────────────── */

describe('replayBuffer (Kara Kutu) bölümü', () => {
  it('support snapshot içinde replayBuffer bölümü var', async () => {
    M.replay = [
      { ts: 1000, signals: { spd: 40, rpm: 1800, gear: 3, fuel: 55 }, workers: { 'vehicle-intel': 'active' }, env: { therm: 1, mem: 'OK' }, lastCmd: 'OPEN_APP' },
    ];
    const payload = await reportSupportSnapshot();
    expect(payload).toHaveProperty('replayBuffer');
    expect(Array.isArray(payload.replayBuffer)).toBe(true);
  });

  it('replayBuffer örnekleri payload\'a giriyor (en yeni örnekler)', async () => {
    M.replay = [
      { ts: 1000, signals: { spd: 40, rpm: 1800, gear: 3, fuel: 55 }, workers: { core: 'active' }, env: { therm: 1, mem: 'OK' }, lastCmd: 'OPEN_APP' },
      { ts: 2000, signals: { spd: 0, rpm: 0, gear: 0, fuel: 54 }, workers: { core: 'dead' }, env: { therm: 2, mem: 'MOD' }, lastCmd: 'STOP' },
    ];
    const payload = await reportSupportSnapshot();
    const rb = payload.replayBuffer as Array<Record<string, unknown>>;

    expect(rb).toHaveLength(2);
    expect(rb[0]).toMatchObject({ ts: 1000, signals: { spd: 40, rpm: 1800 }, lastCmd: 'OPEN_APP' });
    expect(rb[1]).toMatchObject({ ts: 2000, env: { therm: 2, mem: 'MOD' }, lastCmd: 'STOP' });
  });

  it('en fazla son 20 örnek gönderilir (genişlik tavanı)', async () => {
    M.replay = Array.from({ length: 60 }, (_, i) => ({
      ts: i, signals: { spd: i, rpm: null, gear: null, fuel: null }, workers: {}, env: { therm: 0, mem: 'OK' },
    }));
    const payload = await reportSupportSnapshot();
    const rb = payload.replayBuffer as Array<Record<string, unknown>>;
    expect(rb).toHaveLength(20);
    // En yeni pencere: ts 40..59 (son 20)
    expect((rb[0].signals as Record<string, unknown>).spd).toBe(40);
    expect((rb[19].signals as Record<string, unknown>).spd).toBe(59);
  });

  it('PII son savunma: replay örneğine sızan koordinat/konum anahtarı temizlenir', async () => {
    // Kötü senaryo — blackBox bir şekilde konum sızdırsa bile _deepSanitize keser:
    // lat/lng anahtarları DENY_KEYS ile düşer; koordinat string'i [COORD] maskelenir.
    M.replay = [{
      ts: 1000,
      signals: { spd: 40, rpm: 1800, gear: 3, fuel: 55 },
      lat: 41.00821, lng: 28.97842,
      lastCmd: 'poz 41.00821, 28.97842',
      workers: {}, env: { therm: 0, mem: 'OK' },
    }];
    const payload = await reportSupportSnapshot();
    const rb = payload.replayBuffer as Array<Record<string, unknown>>;

    expect(rb[0]).not.toHaveProperty('lat');
    expect(rb[0]).not.toHaveProperty('lng');
    const flat = JSON.stringify(payload);
    expect(flat).not.toContain('41.00821');   // koordinat hiçbir biçimde kalmadı
    expect(flat).toContain('[COORD]');         // lastCmd içindeki koordinat maskelendi
  });

  it('fail-soft: getReplayData patlarsa replayBuffer null, snapshot yine üretilir', async () => {
    const bb = await import('../platform/security/blackBoxService');
    (bb.getReplayData as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('blackbox down');
    });
    const payload = await reportSupportSnapshot();
    expect(payload.replayBuffer).toBeNull();
    expect(payload.appVersion).toBe('2.4.0'); // ana gövde etkilenmedi
  });
});

/* ── Section Failure Report ──────────────────────────────────── */

describe('sectionFailures (Section Failure Report)', () => {
  /** getReplayData'yı tek seferlik throw ettir → replayBuffer bölümü çöker. */
  async function throwReplayOnce(err: unknown): Promise<void> {
    const bb = await import('../platform/security/blackBoxService');
    (bb.getReplayData as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw err;
    });
  }

  it('bir section throw edince snapshot crash etmez; section null kalır; sectionFailures dolar', async () => {
    await throwReplayOnce(new Error('replay ring bozuldu'));

    const payload = await reportSupportSnapshot();

    expect(payload.replayBuffer).toBeNull();   // null davranışı korunur (geriye dönük uyum)
    expect(payload.appVersion).toBe('2.4.0');  // snapshot yine üretildi (crash yok)

    const sf = payload.sectionFailures as Record<string, { message: string; stack?: string }>;
    expect(sf.replayBuffer).toBeDefined();
    expect(sf.replayBuffer.message).toContain('replay ring bozuldu');
  });

  it('başarılı section sectionFailures\'a girmez; sectionFailures her zaman obje', async () => {
    M.replay = [{ ts: 1, signals: { spd: 10, rpm: 0, gear: 0, fuel: 0 }, workers: {}, env: { therm: 0, mem: 'OK' } }];
    const payload = await reportSupportSnapshot();

    expect(typeof payload.sectionFailures).toBe('object');
    expect(payload.sectionFailures).not.toBeNull();
    const sf = payload.sectionFailures as Record<string, unknown>;
    expect(sf.replayBuffer).toBeUndefined();                 // başarılı → kayıt yok
    expect(payload.replayBuffer as unknown[]).toHaveLength(1);
  });

  it('sectionFailures mesajındaki VIN maskelenir (PII sızmaz)', async () => {
    await throwReplayOnce(new Error('decode failed for vin WVWZZZ1JZXW000001'));

    const payload = await reportSupportSnapshot();
    const sf = payload.sectionFailures as Record<string, { message: string }>;

    expect(sf.replayBuffer.message).toContain('[VIN]');
    expect(sf.replayBuffer.message).not.toContain('WVWZZZ1JZXW000001');
    expect(JSON.stringify(payload)).not.toContain('WVWZZZ1JZXW000001');
  });

  it('sectionFailures message 240 karakterle sınırlı', async () => {
    await throwReplayOnce(new Error('E'.repeat(500)));

    const payload = await reportSupportSnapshot();
    const sf = payload.sectionFailures as Record<string, { message: string }>;
    expect(sf.replayBuffer.message.length).toBe(240);
  });

  it('sectionFailures stack yalnız ilk 3 satır ve ≤240 karakter', async () => {
    const err = new Error('boom');
    err.stack = Array.from({ length: 10 }, (_, i) => `at frame${i} (` + 'x'.repeat(80) + ')').join('\n');
    await throwReplayOnce(err);

    const payload = await reportSupportSnapshot();
    const sf = payload.sectionFailures as Record<string, { message: string; stack?: string }>;

    expect(sf.replayBuffer.stack).toBeDefined();
    expect(sf.replayBuffer.stack!.length).toBeLessThanOrEqual(240);
    expect(sf.replayBuffer.stack).toContain('frame0'); // ilk satır var
    expect(sf.replayBuffer.stack).not.toContain('frame3'); // 4. satır ve sonrası kesildi
  });

  it('Error olmayan throw değeri de kaydedilir (String(err))', async () => {
    const notAnError = 'ham string hata'; // literal throw'dan kaçın (no-throw-literal)
    await throwReplayOnce(notAnError);

    const payload = await reportSupportSnapshot();
    const sf = payload.sectionFailures as Record<string, { message: string; stack?: string }>;

    expect(sf.replayBuffer.message).toBe('ham string hata');
    expect(sf.replayBuffer.stack).toBeUndefined();
  });
});

/* ── Cooldown ────────────────────────────────────────────────── */

describe('cooldown', () => {
  it('ilk basış sent; pencere içinde ikinci basış cooldown (push üretmez)', async () => {
    expect(await triggerSupportSnapshot()).toBe('sent');
    expect(await triggerSupportSnapshot()).toBe('cooldown');
    expect(await triggerSupportSnapshot()).toBe('cooldown');
    expect(M.pushed).toHaveLength(1);

    vi.advanceTimersByTime(SNAPSHOT_COOLDOWN_MS + 1);
    expect(await triggerSupportSnapshot()).toBe('sent');
    expect(M.pushed).toHaveLength(2);
  });
});

/* ── Offline queue ───────────────────────────────────────────── */

describe('offline queue davranışı', () => {
  it('çevrimdışı → queued_offline; event yine kuyruğa girer (at-least-once)', async () => {
    // setup.ts navigator'ı düz objeyle değiştirir (onLine alanı yok) —
    // kesin offline sinyali için onLine=false alanını geçici olarak ekle.
    const nav = window.navigator as unknown as { onLine?: boolean };
    nav.onLine = false;
    try {
      expect(await triggerSupportSnapshot()).toBe('queued_offline');
      expect(M.pushed).toHaveLength(1); // pushVehicleEvent kuyruğu yine çağrıldı
    } finally {
      delete nav.onLine; // diğer testlere sızmasın (undefined = fail-open online)
    }
  });
});

/* ── Hata durumu ─────────────────────────────────────────────── */

describe('hata durumunda', () => {
  it('enqueue hatası → error; cooldown YANMAZ, düzeltilince hemen sent', async () => {
    M.pushError = new Error('queue write failed');
    expect(await triggerSupportSnapshot()).toBe('error');
    expect(M.pushed).toHaveLength(0);

    M.pushError = null; // hata giderildi — beklemeden tekrar denenebilmeli
    expect(await triggerSupportSnapshot()).toBe('sent');
    expect(M.pushed).toHaveLength(1);
  });
});

/* ── UI kaynak-sözleşmesi ────────────────────────────────────── */

describe('SupportSnapshotCard — UI sözleşmesi', () => {
  const card = readFileSync(join(process.cwd(),
    'src/components/settings/SupportSnapshotCard.tsx'), 'utf-8');
  const page = readFileSync(join(process.cwd(),
    'src/components/settings/SettingsPage.tsx'), 'utf-8');

  it('buton triggerSupportSnapshot çağırır (reportSupportSnapshot zinciri)', () => {
    expect(card).toContain("from '../../platform/remoteLogService'");
    expect(card).toMatch(/await triggerSupportSnapshot\(\)/);
    expect(card).toContain('Tanı Gönder');
  });

  it('dört sonuç mesajı da kullanıcıya gösteriliyor (hata dahil)', () => {
    expect(card).toContain('Tanı raporu gönderildi');
    expect(card).toContain('internet gelince gönderilecek');   // offline mesajı
    expect(card).toContain('lütfen biraz bekleyin');           // cooldown mesajı
    expect(card).toContain('Gönderilemedi — tekrar deneyin');  // hata mesajı
    expect(card).toMatch(/RESULT_MSG\[status\]/);
  });

  it('art arda basış koruması: sending sırasında buton kilitli', () => {
    expect(card).toMatch(/disabled=\{status === 'sending'\}/);
    expect(card).toMatch(/if \(status === 'sending'\) return/);
  });

  it('SettingsPage "Hakkında" paneli kartı render ediyor', () => {
    expect(page).toContain("import { SupportSnapshotCard } from './SupportSnapshotCard'");
    expect(page).toContain('<SupportSnapshotCard />');
  });

  it('gizlilik notu kartta görünür', () => {
    expect(card).toContain('Konum, kimlik ve cihaz bilgisi içermez');
  });
});
