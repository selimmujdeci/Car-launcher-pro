/**
 * otaTelemetry.test.ts — OTA v1 / Commit 7: telemetri döngüsü
 *
 * Kapsam: ota_success (boot reconcile, sürüm başına bir kez) ·
 * ota_fail (failed geçişleri, aynı errorCode+versionCode bir kez) ·
 * payload format sözleşmesi · rollout health veri akışı (kaynak-sözleşme).
 *
 * NOT: Gerçek vehicle_events satırı + RolloutCenter görünürlüğü
 * "deploy'da doğrulanmadı" (RELEASE_CHECKLIST §4c).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({
  speed: null as number | null,
  versionCode: 5,
  rows: [] as Array<Record<string, unknown>>,
  mockDownload: vi.fn(),
  mockInstall: vi.fn(),
  mockPushEvent: vi.fn(async () => {}),
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
    const self = () => b;
    b['select'] = self; b['eq'] = self; b['gt'] = self; b['order'] = self;
    b['limit'] = async () => ({ data: M.rows, error: null });
    return { from: () => b };
  },
}));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn() }));
vi.mock('../platform/vehicleIdentityService', () => ({
  pushVehicleEvent: (...a: unknown[]) => M.mockPushEvent(...a as [string, Record<string, unknown>]),
}));

import {
  checkForUpdate,
  installVerifiedApk,
  reconcileOnBoot,
  _resetOtaServiceForTest,
} from '../platform/otaUpdateService';
import { safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';

const RELEASE_ROW = {
  version_code: 7, version_name: '1.1.0', channel: 'production',
  apk_path: 'releases/v1.1.0/caros-pro-v7.apk', apk_size: 1024, sha256: 'a'.repeat(64),
};

function seedWaitingReboot(): void {
  safeSetRaw('ota-state-v1', JSON.stringify({
    state: 'installed_waiting_reboot', fileName: 'caros-pro-v7.apk',
    release: { versionCode: 7, versionName: '1.1.0' },
  }), undefined, true);
}

beforeEach(() => {
  _resetOtaServiceForTest();
  safeRemoveRaw('ota-state-v1');
  safeRemoveRaw('ota-telemetry-v1');
  safeRemoveRaw('ota-channel');
  M.speed = null;
  M.versionCode = 5;
  M.rows = [];
  M.mockDownload.mockReset().mockResolvedValue({ ok: true, path: '/x', sha256: 'a'.repeat(64), size: 1024 });
  M.mockInstall.mockReset();
  M.mockPushEvent.mockClear();
});

/* ═══════════════════════════════════════════════════════════════
   ota_success — boot reconcile
═══════════════════════════════════════════════════════════════ */

describe('ota_success', () => {
  it('hedef sürüme ulaşıldığında SPEC payload formatıyla gönderilir', async () => {
    seedWaitingReboot();
    M.versionCode = 7; // kurulum başarılı
    await reconcileOnBoot();
    expect(M.mockPushEvent).toHaveBeenCalledTimes(1);
    expect(M.mockPushEvent).toHaveBeenCalledWith('ota_event', {
      event: 'ota_success',
      versionCode: 7,
      versionName: '1.1.0',
    });
  });

  it('duplicate suppression: aynı sürümün success eventi İKİNCİ kez gönderilmez', async () => {
    seedWaitingReboot();
    M.versionCode = 7;
    await reconcileOnBoot();
    // İkinci boot (kalıcı durum yeniden tohumla — dedup safeStorage'da yaşar)
    seedWaitingReboot();
    await reconcileOnBoot();
    expect(M.mockPushEvent).toHaveBeenCalledTimes(1);
  });

  it('sürüm hedefe ulaşmadıysa success GÖNDERİLMEZ', async () => {
    seedWaitingReboot();
    M.versionCode = 5; // hâlâ eski sürüm
    await reconcileOnBoot();
    expect(M.mockPushEvent).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════
   ota_fail — failed geçişleri
═══════════════════════════════════════════════════════════════ */

describe('ota_fail', () => {
  it('indirme hatası (ERR_HASH) SPEC payload formatıyla gönderilir', async () => {
    M.rows = [RELEASE_ROW];
    M.mockDownload.mockResolvedValue({ ok: false, errorCode: 'ERR_HASH' });
    await checkForUpdate();
    expect(M.mockPushEvent).toHaveBeenCalledTimes(1);
    expect(M.mockPushEvent).toHaveBeenCalledWith('ota_event', {
      event: 'ota_fail',
      errorCode: 'ERR_HASH',
      versionCode: 7, // hedef (denenen) sürüm
    });
  });

  it('duplicate suppression: aynı (errorCode, versionCode) bir kez; FARKLI hata yeniden gönderilir', async () => {
    M.rows = [RELEASE_ROW];
    M.mockDownload.mockResolvedValue({ ok: false, errorCode: 'ERR_HASH' });
    await checkForUpdate();
    await checkForUpdate(); // aynı hata tekrar → suppress
    expect(M.mockPushEvent).toHaveBeenCalledTimes(1);

    M.mockDownload.mockResolvedValue({ ok: false, errorCode: 'ERR_HTTP' });
    await checkForUpdate(); // farklı hata → gönderilir
    expect(M.mockPushEvent).toHaveBeenCalledTimes(2);
    expect(M.mockPushEvent).toHaveBeenLastCalledWith('ota_event',
      expect.objectContaining({ event: 'ota_fail', errorCode: 'ERR_HTTP' }));
  });

  it('kurulum reddi (ERR_SIGNATURE) gönderilir; settings_opened TELEMETRİ DEĞİL', async () => {
    M.rows = [RELEASE_ROW];
    await checkForUpdate(); // → verified
    expect(M.mockPushEvent).not.toHaveBeenCalled();

    // settings_opened: beklenen kullanıcı akışı — event yok
    M.mockInstall.mockResolvedValueOnce({ ok: false, action: 'settings_opened', errorCode: 'ERR_NO_PERMISSION' });
    await installVerifiedApk();
    expect(M.mockPushEvent).not.toHaveBeenCalled();

    // Gerçek red: imza uyuşmazlığı — event var
    M.mockInstall.mockResolvedValueOnce({ ok: false, errorCode: 'ERR_SIGNATURE' });
    await installVerifiedApk();
    expect(M.mockPushEvent).toHaveBeenCalledWith('ota_event',
      expect.objectContaining({ event: 'ota_fail', errorCode: 'ERR_SIGNATURE', versionCode: 7 }));
  });
});

/* ═══════════════════════════════════════════════════════════════
   Rollout health veri akışı (kaynak-sözleşme kilitleri)
═══════════════════════════════════════════════════════════════ */

describe('rollout health entegrasyonu', () => {
  it('taşıyıcı zincir: pushVehicleEvent → push_vehicle_event RPC → vehicle_events; getRolloutHealth aynı tabloyu okur', () => {
    const identity = readFileSync(join(process.cwd(),
      'src/platform/vehicleIdentityService.ts'), 'utf-8');
    const superadmin = readFileSync(join(process.cwd(),
      'src/admin/services/superadmin.service.ts'), 'utf-8');
    // Cihaz tarafı: ota_event'in bindiği RPC
    expect(identity).toContain('push_vehicle_event');
    // Admin tarafı: circuit breaker aynı tablodan beslenir
    expect(superadmin).toContain("from('vehicle_events')");
    expect(superadmin).toContain('getRolloutHealth');
  });
});
