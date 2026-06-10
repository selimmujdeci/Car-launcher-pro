/**
 * otaUpdateService.test.ts — OTA v1 / Commit 6: orkestrasyon servisi
 *
 * Kapsam: durum makinesi geçişleri · duplicate poll engeli · kanal/sürüm
 * filtresi (sorgu parametreleri) · park kapısı · settings_opened kurtarma ·
 * safeStorage kalıcılığı · boot uzlaştırma.
 *
 * Native indirme/kurulum MOCK (Commit 4-5'in kendi testleri var);
 * Supabase sorgusu yakalanan-parametre mock'u. Gerçek uçtan uca akış
 * "cihazda/deploy'da doğrulanmadı".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock'lar (vi.mock hoist — vi.hoisted ile TDZ'siz state) ──────────────────

const M = vi.hoisted(() => ({
  speed: null as number | null,
  versionCode: 5,
  rows: [] as Array<Record<string, unknown>>,
  queryError: null as { message: string } | null,
  captured: {} as Record<string, unknown>,
  fromCalls: 0,
  queryGate: null as Promise<void> | null, // duplicate-poll testi: sorguyu askıda tut
  mockDownload: vi.fn(),
  mockInstall: vi.fn(),
}));

vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: { getState: () => ({ speed: M.speed }) },
}));

vi.mock('../platform/nativeCommandBridge', () => ({
  getAppVersionInfo: vi.fn(async () => ({ versionCode: M.versionCode, versionName: 'x', packageName: 'p' })),
  downloadOtaApk: (...a: unknown[]) => M.mockDownload(...a),
  installOtaApk: (...a: unknown[]) => M.mockInstall(...a),
}));

vi.mock('../platform/supabaseClient', () => ({
  getSupabaseClient: () => {
    const b: Record<string, unknown> = {};
    const chain = (key: string) => (...args: unknown[]) => { M.captured[key] = args; return b; };
    b['select'] = chain('select');
    b['eq']     = (col: string, val: unknown) => { M.captured[`eq_${col}`] = val; return b; };
    b['gt']     = (col: string, val: unknown) => { M.captured[`gt_${col}`] = val; return b; };
    b['order']  = chain('order');
    b['limit']  = async () => {
      if (M.queryGate) await M.queryGate;
      return { data: M.rows, error: M.queryError };
    };
    return { from: (table: string) => { M.fromCalls++; M.captured['table'] = table; return b; } };
  },
}));

vi.mock('../platform/debug', () => ({ logInfo: vi.fn() }));
// Commit 7: telemetri importu — bu dosyada davranışı test edilmez (otaTelemetry.test.ts)
vi.mock('../platform/vehicleIdentityService', () => ({ pushVehicleEvent: vi.fn(async () => {}) }));

import {
  useOtaStore,
  checkForUpdate,
  installVerifiedApk,
  resumeOtaFlow,
  reconcileOnBoot,
  setOtaChannel,
  getOtaChannel,
  isParkedForOta,
  _resetOtaServiceForTest,
} from '../platform/otaUpdateService';
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';

const RELEASE_ROW = {
  version_code: 7, version_name: '1.1.0', channel: 'production',
  apk_path: 'releases/v1.1.0/caros-pro-v7.apk', apk_size: 1024, sha256: 'a'.repeat(64),
};

beforeEach(() => {
  _resetOtaServiceForTest();
  safeRemoveRaw('ota-state-v1');
  safeRemoveRaw('ota-channel');
  safeRemoveRaw('ota-telemetry-v1');
  M.speed = null;            // sensör yok = park (fail-soft)
  M.versionCode = 5;
  M.rows = [];
  M.queryError = null;
  M.captured = {};
  M.fromCalls = 0;
  M.queryGate = null;
  M.mockDownload.mockReset().mockResolvedValue({ ok: true, path: '/x', sha256: 'a'.repeat(64), size: 1024 });
  M.mockInstall.mockReset();
});

/* ═══════════════════════════════════════════════════════════════
   Filtreler — kanal + sürüm + status
═══════════════════════════════════════════════════════════════ */

describe('sorgu filtreleri', () => {
  it("yalnız status='active' + cihaz kanalı + version_code > kurulu sorgulanır", async () => {
    setOtaChannel('pilot');
    await checkForUpdate();
    expect(M.captured['table']).toBe('ota_releases');
    expect(M.captured['eq_status']).toBe('active');
    expect(M.captured['eq_channel']).toBe('pilot');
    expect(M.captured['gt_version_code']).toBe(5); // mock kurulu vc
  });

  it('kanal varsayılanı production; geçersiz kanal yazılamaz', () => {
    expect(getOtaChannel()).toBe('production');
    setOtaChannel('internal');
    expect(getOtaChannel()).toBe('internal');
    safeSetRaw('ota-channel', 'hacker-channel', undefined, true);
    expect(getOtaChannel()).toBe('production'); // bilinmeyen → fallback
  });

  it('yeni sürüm yok → idle (release temiz)', async () => {
    M.rows = [];
    await checkForUpdate();
    expect(useOtaStore.getState()).toMatchObject({ state: 'idle', release: null });
  });
});

/* ═══════════════════════════════════════════════════════════════
   Durum makinesi — mutlu yol + park kapısı
═══════════════════════════════════════════════════════════════ */

describe('durum makinesi', () => {
  it('park halinde: idle→checking→available→downloading→verified zinciri', async () => {
    M.rows = [RELEASE_ROW];
    const seen: string[] = [];
    const unsub = useOtaStore.subscribe((s) => { seen.push(s.state); });

    await checkForUpdate();
    unsub();

    expect(seen).toEqual(['checking', 'available', 'downloading', 'verified']);
    const s = useOtaStore.getState();
    expect(s.fileName).toBe('caros-pro-v7.apk'); // apk_path basename
    expect(s.release?.versionCode).toBe(7);
    expect(s.progressPercent).toBe(100);
    // İndirme çağrısı doğru sözleşmeyle: storage URL + anon header + sha/size
    const opts = M.mockDownload.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts['url']).toContain('/storage/v1/object/ota_apks/releases/v1.1.0/caros-pro-v7.apk');
    expect(opts['expectedSha256']).toBe(RELEASE_ROW.sha256);
    expect(opts['expectedSize']).toBe(1024);
  });

  it('park kapısı: hız > 0 → available\'da BEKLER, indirme çağrılmaz', async () => {
    M.rows = [RELEASE_ROW];
    M.speed = 50;
    await checkForUpdate();
    expect(useOtaStore.getState().state).toBe('available');
    expect(M.mockDownload).not.toHaveBeenCalled();
    expect(isParkedForOta()).toBe(false);

    // Araç durdu + kullanıcı dokundu → indirme sürer
    M.speed = 0;
    await resumeOtaFlow();
    expect(useOtaStore.getState().state).toBe('verified');
    expect(M.mockDownload).toHaveBeenCalledTimes(1);
  });

  it('indirme hatası (ERR_HASH) → failed; sonraki poll yeniden dener (failed→idle reset)', async () => {
    M.rows = [RELEASE_ROW];
    M.mockDownload.mockResolvedValue({ ok: false, errorCode: 'ERR_HASH' });
    await checkForUpdate();
    expect(useOtaStore.getState()).toMatchObject({ state: 'failed', errorCode: 'ERR_HASH' });

    M.mockDownload.mockResolvedValue({ ok: true, path: '/x', sha256: 'a'.repeat(64), size: 1024 });
    await checkForUpdate();
    expect(useOtaStore.getState().state).toBe('verified');
  });

  it('duplicate poll engeli: sorgu askıdayken ikinci checkForUpdate atlanır', async () => {
    let release!: () => void;
    M.queryGate = new Promise((res) => { release = res; });
    M.rows = [];

    const first = checkForUpdate();   // _busy senkron set edilir
    await checkForUpdate();           // _busy → anında döner, sorguya inmez

    release();
    await first;
    // İki çağrıya rağmen tek Supabase sorgusu → duplicate poll engellendi
    expect(M.fromCalls).toBe(1);
    expect(useOtaStore.getState().state).toBe('idle');
  });
});

/* ═══════════════════════════════════════════════════════════════
   Kurulum — settings_opened kurtarma + park kapısı
═══════════════════════════════════════════════════════════════ */

describe('kurulum akışı', () => {
  async function driveToVerified(): Promise<void> {
    M.rows = [RELEASE_ROW];
    await checkForUpdate();
    expect(useOtaStore.getState().state).toBe('verified');
  }

  it('izin yok: settings_opened → verified + awaitingPermission; izin sonrası yeniden dene → installed_waiting_reboot', async () => {
    await driveToVerified();
    M.mockInstall.mockResolvedValueOnce({
      ok: false, action: 'settings_opened', errorCode: 'ERR_NO_PERMISSION',
    });
    await installVerifiedApk();
    expect(useOtaStore.getState()).toMatchObject({ state: 'verified', awaitingPermission: true });

    // Kullanıcı izni verdi, karta tekrar dokundu
    M.mockInstall.mockResolvedValueOnce({ ok: true, action: 'install_prompted' });
    await resumeOtaFlow();
    expect(useOtaStore.getState()).toMatchObject({
      state: 'installed_waiting_reboot', awaitingPermission: false,
    });
    expect(M.mockInstall).toHaveBeenCalledTimes(2);
    expect(M.mockInstall).toHaveBeenCalledWith('caros-pro-v7.apk');
  });

  it('kurulumda park kapısı: hız > 0 → installOtaApk çağrılmaz', async () => {
    await driveToVerified();
    M.speed = 30;
    await installVerifiedApk();
    expect(M.mockInstall).not.toHaveBeenCalled();
    expect(useOtaStore.getState().state).toBe('verified');
  });

  it('native red (ERR_SIGNATURE) → failed', async () => {
    await driveToVerified();
    M.mockInstall.mockResolvedValueOnce({ ok: false, errorCode: 'ERR_SIGNATURE' });
    await installVerifiedApk();
    expect(useOtaStore.getState()).toMatchObject({ state: 'failed', errorCode: 'ERR_SIGNATURE' });
  });
});

/* ═══════════════════════════════════════════════════════════════
   Kalıcılık + boot uzlaştırma
═══════════════════════════════════════════════════════════════ */

describe('safeStorage kalıcılığı + boot uzlaştırma', () => {
  it('verified durumu diske yazılır (state + fileName + release)', async () => {
    M.rows = [RELEASE_ROW];
    await checkForUpdate();
    const persisted = JSON.parse(safeGetRaw('ota-state-v1') ?? '{}') as Record<string, unknown>;
    expect(persisted['state']).toBe('verified');
    expect(persisted['fileName']).toBe('caros-pro-v7.apk');
    expect((persisted['release'] as Record<string, unknown>)['versionCode']).toBe(7);
  });

  it('boot: hedef sürüme ulaşıldıysa (kurulum başarılı) → temiz idle', async () => {
    safeSetRaw('ota-state-v1', JSON.stringify({
      state: 'installed_waiting_reboot', fileName: 'caros-pro-v7.apk',
      release: { versionCode: 7, versionName: '1.1.0' },
    }), undefined, true);
    M.versionCode = 7; // güncelleme KURULMUŞ
    await reconcileOnBoot();
    expect(useOtaStore.getState()).toMatchObject({ state: 'idle', release: null, fileName: null });
  });

  it('boot: reboot bekleniyordu ama sürüm değişmemiş → verified\'a düşer (yeniden kurulabilir)', async () => {
    safeSetRaw('ota-state-v1', JSON.stringify({
      state: 'installed_waiting_reboot', fileName: 'caros-pro-v7.apk',
      release: { versionCode: 7, versionName: '1.1.0' },
    }), undefined, true);
    M.versionCode = 5; // hâlâ eski sürüm
    await reconcileOnBoot();
    expect(useOtaStore.getState()).toMatchObject({ state: 'verified', fileName: 'caros-pro-v7.apk' });
  });

  it('boot: yarım indirme (downloading) → temiz idle (sonraki poll yeniden bulur)', async () => {
    safeSetRaw('ota-state-v1', JSON.stringify({
      state: 'downloading', release: { versionCode: 7 },
    }), undefined, true);
    M.versionCode = 5;
    await reconcileOnBoot();
    expect(useOtaStore.getState().state).toBe('idle');
  });
});
