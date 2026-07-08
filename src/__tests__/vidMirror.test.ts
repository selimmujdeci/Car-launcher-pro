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

// seedDefaultProfile yan etkisini izole et; diğer TÜM export'lar GERÇEK kalır
// (Sprint 3 vehicle mirror testleri startVehicleDetection/persistHandshakeVin kullanır).
vi.mock('../platform/vehicleProfileService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/vehicleProfileService')>();
  return { ...actual, seedDefaultProfile: vi.fn() };
});

import { useVidStore } from '../store/useVidStore';
import { useStore } from '../store/useStore';
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
import {
  startVehicleDetection,
  stopVehicleDetection,
  persistHandshakeVin,
} from '../platform/vehicleProfileService';
import { useVehicleIntelligenceStore } from '../store/useVehicleIntelligenceStore';
import {
  startVehicleIntelligenceService,
  stopVehicleIntelligenceService,
} from '../platform/vehicleIntelligenceService';

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

  /* ── Araç profili / VIN aynalaması (Sprint 3) ────────────────────────── */

  describe('Vehicle profile + VIN aynalaması', () => {
    const BASE_PROFILE = {
      id: 'p1',
      name: 'Test Duster',
      vehicleType: 'diesel' as const,
      createdAt: '2020-01-01T00:00:00.000Z',
      lastUsedAt: null,
    };

    beforeEach(() => {
      // useStore izole başlasın (profiller boş) → startVehicleDetection güvenli
      // (_detectProfile erken döner, aktif profili yanlışlıkla temizlemez).
      useStore.getState().resetSettings();
    });

    afterEach(() => {
      // Zero-leak: interval + VID subscription temizlensin.
      stopVehicleDetection();
    });

    it('(a) aktif profil değişince VID.vehicle otomatik güncellenir', () => {
      startVehicleDetection(); // profiller boş → subscription kurulur, tespit erken döner

      const store = useStore.getState();
      store.addVehicleProfile({ ...BASE_PROFILE });
      store.setActiveVehicleProfile('p1'); // store değişimi → subscription → mirror

      const { vehicle } = useVidStore.getState();
      expect(vehicle.model).toBe('Test Duster');
      expect(vehicle.vehicleType).toBe('diesel');
    });

    it('(b) geçerli VIN persistHandshakeVin ile aynalanır → marka/yıl decode edilir', () => {
      startVehicleDetection();

      const store = useStore.getState();
      store.addVehicleProfile({ ...BASE_PROFILE });
      store.setActiveVehicleProfile('p1');

      // VF1 → Renault; VIN index 9 = 'N' → model yılı 2022
      persistHandshakeVin('VF1RFB000N1234567');

      const { vehicle } = useVidStore.getState();
      expect(vehicle.vin).toBe('VF1RFB000N1234567');
      expect(vehicle.make).toBe('Renault');
      expect(vehicle.modelYear).toBe(2022);
    });

    it('(c) stopVehicleDetection subscription\'ı temizler (sonraki değişim aynalanmaz)', () => {
      startVehicleDetection();

      const store = useStore.getState();
      store.addVehicleProfile({ ...BASE_PROFILE });
      store.setActiveVehicleProfile('p1');
      expect(useVidStore.getState().vehicle.model).toBe('Test Duster');

      stopVehicleDetection();
      // VID'i sıfırla → temizlenmiş subscription sonraki store değişimini YAZMAMALI.
      useVidStore.getState().resetStore();
      store.updateVehicleProfile('p1', { name: 'Değişti' });

      expect(useVidStore.getState().vehicle.model).toBeNull();
    });

    it('(d) mükerrer startVehicleDetection duplicate subscription oluşturmaz', () => {
      startVehicleDetection();
      startVehicleDetection(); // idempotent — ikinci çağrı TEK subscription'ı korur

      const store = useStore.getState();
      store.addVehicleProfile({ ...BASE_PROFILE });
      store.setActiveVehicleProfile('p1');
      expect(useVidStore.getState().vehicle.model).toBe('Test Duster');

      // TEK stop → TEK subscription temizlenmeli. Duplicate abonelik OLSAYDI, tek stop
      // yalnız birini sökerdi ve aşağıdaki değişim hâlâ aynalanırdı.
      stopVehicleDetection();
      useVidStore.getState().resetStore();
      store.updateVehicleProfile('p1', { name: 'Değişti' });

      expect(useVidStore.getState().vehicle.model).toBeNull(); // aynalanmadı → tek subscription vardı
    });

    it('(e) çift stopVehicleDetection hata vermez (idempotent temizlik)', () => {
      startVehicleDetection();
      stopVehicleDetection();
      expect(() => stopVehicleDetection()).not.toThrow();
    });
  });

  /* ── Telemetri aynalaması (Sprint 4) ─────────────────────────────────── */

  describe('Telemetry aynalaması', () => {
    beforeEach(() => {
      // Scheduler wheel'i gerçek zamanlı çalışmasın (yalnız start'taki tek _tick);
      // timing assert etmiyoruz, subscription davranışını izole ediyoruz.
      vi.useFakeTimers();
      useVehicleIntelligenceStore.getState().reset();
    });
    afterEach(() => {
      stopVehicleIntelligenceService();
      vi.useRealTimers();
    });

    it('(a) intel store değişimi VID.telemetry\'yi günceller', () => {
      startVehicleIntelligenceService();

      const intel = useVehicleIntelligenceStore.getState();
      intel.setDiagnosticState('STRESSED', 'STRESSED', true);
      intel.updateTrustScore(0.42);
      intel.updatePlausibility('rpm', { isValid: false, reason: 'jump>5000' });

      const { telemetry } = useVidStore.getState();
      expect(telemetry.trustScore).toBe(0.42);
      expect(telemetry.healthState).toBe('STRESSED');
      expect(telemetry.isDiagnosticDegraded).toBe(true);
      expect(telemetry.plausibilityFailures).toEqual({ rpm: 'jump>5000' });
    });

    it('(b) ardışık aynı değerli güncellemeler VID\'ye redundant yazmaz (shallow guard)', () => {
      startVehicleIntelligenceService();

      useVehicleIntelligenceStore.getState().updateTrustScore(0.5);
      const ref1 = useVidStore.getState().telemetry;

      // AYNI trust değeri + mirror-DIŞI alan (sampleCount) değişimi → shallow guard
      // aynı JSON key üretir → VID'ye YAZILMAZ (referans değişmez).
      useVehicleIntelligenceStore.getState().updateTrustScore(0.5);
      useVehicleIntelligenceStore.getState().incrementSampleCount();
      const ref2 = useVidStore.getState().telemetry;

      expect(ref2).toBe(ref1); // aynı referans → redundant güncelleme yok
    });

    it('(c) stopVehicleIntelligenceService subscription\'ı temizler', () => {
      startVehicleIntelligenceService();

      useVehicleIntelligenceStore.getState().updateTrustScore(0.3);
      expect(useVidStore.getState().telemetry.trustScore).toBe(0.3);

      stopVehicleIntelligenceService();
      // VID'i sıfırla (trustScore → 1.0) → temizlenmiş subscription sonraki değişimi YAZMAMALI.
      useVidStore.getState().resetStore();
      useVehicleIntelligenceStore.getState().updateTrustScore(0.9);

      expect(useVidStore.getState().telemetry.trustScore).toBe(1.0);
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
