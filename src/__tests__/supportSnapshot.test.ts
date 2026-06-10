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
  SNAPSHOT_COOLDOWN_MS,
  _resetRemoteLogServiceForTest,
} from '../platform/remoteLogService';
import { logError, clearErrorLog } from '../platform/crashLogger';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
  _resetRemoteLogServiceForTest();
  clearErrorLog();
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
