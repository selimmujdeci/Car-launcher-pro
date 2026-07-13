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

import {
  reportSupportSnapshot,
  triggerSupportSnapshot,
  triggerSupportSnapshotEx,
  buildDiagnosticPreview,
  DIAGNOSTIC_CATEGORIES,
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

/* ── Cooldown ────────────────────────────────────────────────── */

describe('cooldown', () => {
  it('ilk basış sent; pencere içinde ikinci basış cooldown (push üretmez)', async () => {
    expect(await triggerSupportSnapshot()).toBe('queued');
    expect(await triggerSupportSnapshot()).toBe('cooldown');
    expect(await triggerSupportSnapshot()).toBe('cooldown');
    expect(M.pushed).toHaveLength(1);

    vi.advanceTimersByTime(SNAPSHOT_COOLDOWN_MS + 1);
    expect(await triggerSupportSnapshot()).toBe('queued');
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
    expect(await triggerSupportSnapshot()).toBe('queued');
    expect(M.pushed).toHaveLength(1);
  });
});

/* ── PR-4: kullanıcı raporu (açıklama + kategori) + önizleme ──── */

describe('PR-4 — kullanıcı raporu meta threading + önizleme', () => {
  it('meta {note, category} → payload.userReport (teknik bölümler korunur)', async () => {
    await triggerSupportSnapshotEx({ note: 'motor titriyor', category: 'OBD' });
    const p = M.pushed.at(-1)!;
    expect(p.type).toBe('support_snapshot');
    expect(p.payload.userReport).toEqual({ note: 'motor titriyor', category: 'OBD' });
    // Teknik bölümler DURUYOR (PR-1/2/3 bozulmaz)
    expect(p.payload.appVersion).toBeDefined();
    expect(p.payload.obd).toBeDefined();
    expect(p.payload.health).toBeDefined();
  });

  it('SANITIZE: not içindeki VIN/koordinat MASKELENİR (serbest metin PII sızıntısı yok)', async () => {
    await triggerSupportSnapshotEx({ note: 'VIN WBA12345678901234 konum 41.0082,28.9784', category: 'GPS' });
    const ur = M.pushed.at(-1)!.payload.userReport as { note: string };
    expect(ur.note).toContain('[VIN]');
    expect(ur.note).toContain('[COORD]');
    expect(ur.note).not.toContain('WBA12345678901234');
    expect(ur.note).not.toContain('41.0082');
  });

  it('geçersiz kategori DÜŞER (allowlist); not boşsa userReport üretilmez', async () => {
    await triggerSupportSnapshotEx({ note: '', category: 'HACK' });
    expect(M.pushed.at(-1)!.payload.userReport).toBeUndefined();
  });

  it('meta VERİLMEZSE eski davranış — userReport yok (PR-3 geriye uyumlu)', async () => {
    await triggerSupportSnapshotEx();
    expect(M.pushed.at(-1)!.payload.userReport).toBeUndefined();
  });

  it('kategori listesi 10 örnek içerir (OBD/GPS/…/Diğer)', () => {
    expect(DIAGNOSTIC_CATEGORIES).toContain('OBD');
    expect(DIAGNOSTIC_CATEGORIES).toContain('Çökme');
    expect(DIAGNOSTIC_CATEGORIES).toContain('Diğer');
    expect(DIAGNOSTIC_CATEGORIES.length).toBe(10);
  });

  it('ÖNİZLEME upload YAPMAZ (rıza öncesi gönderim yok) ama boyut+bölüm döndürür', async () => {
    const before = M.pushed.length;
    const preview = await buildDiagnosticPreview();
    expect(M.pushed.length).toBe(before);       // hiçbir şey gönderilmedi
    expect(preview.sizeBytes).toBeGreaterThan(0);
    expect(preview.sections.length).toBeGreaterThan(0);
    expect(preview.masked.some((m) => m.includes('VIN'))).toBe(true);
    expect(preview.notSent.some((n) => n.includes('konum'))).toBe(true);
  });
});

/* ── UI kaynak-sözleşmesi ────────────────────────────────────── */

describe('SupportSnapshotCard — UI sözleşmesi', () => {
  const card = readFileSync(join(process.cwd(),
    'src/components/settings/SupportSnapshotCard.tsx'), 'utf-8');
  const page = readFileSync(join(process.cwd(),
    'src/components/settings/SettingsPage.tsx'), 'utf-8');

  it('PR-4: kart ortak DiagnosticReportModal açar (triggerSupportSnapshotEx send)', () => {
    expect(card).toContain("from '../../platform/remoteLogService'");
    expect(card).toContain("import { DiagnosticReportModal }");
    expect(card).toContain('<DiagnosticReportModal');
    // Gönderim yalnız modal içinden (rıza sonrası) — send prop'u Ex tetikleyici.
    expect(card).toMatch(/send=\{\(meta\) => triggerSupportSnapshotEx\(meta\)\}/);
    expect(card).toContain('Tanı Gönder');
  });

  it('kart DOĞRUDAN göndermez — akış (rıza/önizleme/teslim) modalda', () => {
    // Buton yalnız modalı açar; upload rıza olmadan başlamaz (DiagnosticReportModal).
    expect(card).toMatch(/onClick=\{\(\) => setOpen\(true\)\}/);
    expect(card).not.toContain('awaitDelivery'); // teslim bekleme modalda
  });

  it('SettingsPage "Hakkında" paneli kartı render ediyor', () => {
    expect(page).toContain("import { SupportSnapshotCard } from './SupportSnapshotCard'");
    expect(page).toContain('<SupportSnapshotCard />');
  });

  it('gizlilik notu kartta görünür', () => {
    expect(card).toContain('Konum, kimlik ve cihaz bilgisi içermez');
  });
});
