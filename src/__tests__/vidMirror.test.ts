/**
 * vidMirror.test.ts — VID Mirror Layer (Sprint 2) birim testleri.
 *
 * Doğrular:
 *  - OBD yazma/temizleme metotları (obdStorage) VID obdAdapter alanlarını aynalar.
 *    · save* → ilgili alan; saveObdTransport → verified=false sıfırlama
 *    · clear* → alan null / verified false (kasıtlı temizleme)
 *  - initPlatformDetection başarıyla tamamlanınca VID headUnit alanlarını aynalar.
 *
 * Aynalama tek doğru kaynağı (localStorage / platform tespiti) DEĞİŞTİRMEZ;
 * yalnız VID'ye yansır. Bu testler o yansımayı doğrular.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Head unit tespiti native getApps'e dayanır → bilinen paket listesiyle mock'la
// (FYT imzası com.syu.bt + GApps com.google.android.gms).
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    getApps: vi.fn(async () => ({
      apps: [
        { packageName: 'com.syu.bt' },
        { packageName: 'com.syu.radio' },
        { packageName: 'com.google.android.gms' },
      ],
    })),
  },
}));

// seedDefaultProfile yan etkisini izole et (bu test kapsamı dışı).
vi.mock('../platform/vehicleProfileService', () => ({
  seedDefaultProfile: vi.fn(),
}));

import { useVidStore } from '../store/useVidStore';
import {
  saveObdAddress,
  clearObdAddress,
  saveObdTransport,
  saveObdTransportVerified,
  saveObdProtocol,
  clearObdProtocol,
  clearObdTransport,
} from '../platform/obdStorage';
import { initPlatformDetection } from '../platform/headUnitPlatform';

describe('VID Mirror Layer (Sprint 2)', () => {
  beforeEach(() => {
    useVidStore.getState().resetStore();
    try { localStorage.clear(); } catch { /* jsdom */ }
  });

  /* ── OBD transport aynalaması ────────────────────────────────────────── */

  describe('OBD yazma/temizleme aynalaması', () => {
    it('saveObdAddress → VID lastAddress güncellenir', () => {
      saveObdAddress('AA:BB:CC:DD:EE:FF');
      expect(useVidStore.getState().obdAdapter.lastAddress).toBe('AA:BB:CC:DD:EE:FF');
    });

    it('saveObdTransport → lastTransport set + isTransportVerified false sıfırlanır', () => {
      // Önce verified=true; yeni transport yazımı bunu sıfırlamalı (localStorage semantiğiyle uyumlu).
      saveObdTransportVerified(true);
      expect(useVidStore.getState().obdAdapter.isTransportVerified).toBe(true);

      saveObdTransport('classic');
      const { obdAdapter } = useVidStore.getState();
      expect(obdAdapter.lastTransport).toBe('classic');
      expect(obdAdapter.isTransportVerified).toBe(false);
    });

    it('saveObdTransportVerified(true) → isTransportVerified true', () => {
      saveObdTransport('ble');
      saveObdTransportVerified(true);
      expect(useVidStore.getState().obdAdapter.isTransportVerified).toBe(true);
    });

    it('saveObdProtocol → lastProtocolNum güncellenir', () => {
      saveObdProtocol('6');
      expect(useVidStore.getState().obdAdapter.lastProtocolNum).toBe('6');
    });

    it('clearObdProtocol → lastProtocolNum null (kasıtlı temizleme)', () => {
      saveObdProtocol('6');
      expect(useVidStore.getState().obdAdapter.lastProtocolNum).toBe('6');

      clearObdProtocol();
      expect(useVidStore.getState().obdAdapter.lastProtocolNum).toBeNull();
    });

    it('clearObdAddress → lastAddress null (kasıtlı temizleme)', () => {
      saveObdAddress('11:22:33:44:55:66');
      expect(useVidStore.getState().obdAdapter.lastAddress).toBe('11:22:33:44:55:66');

      clearObdAddress();
      expect(useVidStore.getState().obdAdapter.lastAddress).toBeNull();
    });

    it('clearObdTransport → lastTransport null + isTransportVerified false', () => {
      saveObdTransport('tcp');
      saveObdTransportVerified(true);

      clearObdTransport();
      const { obdAdapter } = useVidStore.getState();
      expect(obdAdapter.lastTransport).toBeNull();
      expect(obdAdapter.isTransportVerified).toBe(false);
    });
  });

  /* ── Head unit platform aynalaması ───────────────────────────────────── */

  describe('initPlatformDetection aynalaması', () => {
    it('başarılı tespit → VID headUnit (platform + paketler + GApps) aynalanır', async () => {
      await initPlatformDetection();

      const { headUnit } = useVidStore.getState();
      expect(headUnit.detectedPlatform).toBe('fyt');
      expect(headUnit.installedPackages).toContain('com.syu.bt');
      expect(headUnit.installedPackages).toContain('com.google.android.gms');
      expect(headUnit.isPlayServicesAvailable).toBe(true);
      // jsdom UA'sında "Chrome/" olmayabilir → 0 veya pozitif; her iki durum da geçerli.
      expect(headUnit.webViewChromeVersion).toBeGreaterThanOrEqual(0);
    });

    it('native tespit hatası (getApps reject) → catch → VID headUnit "stock" aynalanır', async () => {
      // initPlatformDetection modül-içi _platformInfo cache tutar; catch yolunu
      // GERÇEKTEN tetiklemek için modülü sıfırla → taze örnekle çalış (izolasyon).
      vi.resetModules();
      const nativePlugin = await import('../platform/nativePlugin');
      vi.mocked(nativePlugin.CarLauncher.getApps).mockRejectedValueOnce(new Error('no native bridge'));
      const { initPlatformDetection: freshInit } = await import('../platform/headUnitPlatform');
      const { useVidStore: freshVid } = await import('../store/useVidStore');

      // Aynalamanın GERÇEKTEN çalıştığını kanıtla: önce stock-DIŞI değerlere getir,
      // catch aynalaması bunları 'stock' + boş liste + false'a döndürmeli.
      freshVid.getState().updateHeadUnitInfo({
        detectedPlatform: 'fyt',
        installedPackages: ['com.syu.bt'],
        isPlayServicesAvailable: true,
      });

      await freshInit();

      const { headUnit } = freshVid.getState();
      expect(headUnit.detectedPlatform).toBe('stock');
      expect(headUnit.installedPackages).toEqual([]);
      expect(headUnit.isPlayServicesAvailable).toBe(false);
    });
  });
});
