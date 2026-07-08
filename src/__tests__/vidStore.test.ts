/**
 * vidStore.test.ts — Vehicle Intelligence Database (VID) Sprint 1 Foundation testleri.
 *
 * Test kapsamı:
 *  - Başlangıç durumunun şemaya uygun varsayılanlarla yüklenmesi
 *  - updateHeadUnitInfo / updateObdAdapterInfo / updateVehicleInfo kısmi güncelleme
 *  - updateTelemetryInfo trustScore sanitizasyonu ([0.0, 1.0] clamp)
 *  - resetStore ile tam sıfırlama
 *
 * Zustand modül-seviyesi state tuttuğu için her testten önce resetStore() ile izole edilir.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useVidStore } from '../store/useVidStore';

describe('useVidStore — VID Foundation', () => {
  beforeEach(() => {
    useVidStore.getState().resetStore();
  });

  /* ── 1. Başlangıç durumu ─────────────────────────────────────────────── */

  describe('başlangıç durumu şemaya uygun', () => {
    it('headUnit varsayılanları', () => {
      const { headUnit } = useVidStore.getState();
      expect(headUnit.detectedPlatform).toBe('stock');
      expect(headUnit.installedPackages).toEqual([]);
      expect(headUnit.webViewChromeVersion).toBe(0);
      expect(headUnit.ramSizeRealGb).toBe(0);
      expect(headUnit.isPlayServicesAvailable).toBe(false);
    });

    it('obdAdapter varsayılanları', () => {
      const { obdAdapter } = useVidStore.getState();
      expect(obdAdapter.lastAddress).toBeNull();
      expect(obdAdapter.lastTransport).toBeNull();
      expect(obdAdapter.isTransportVerified).toBe(false);
      expect(obdAdapter.lastProtocolNum).toBeNull();
    });

    it('vehicle varsayılanları', () => {
      const { vehicle } = useVidStore.getState();
      expect(vehicle.vin).toBeNull();
      expect(vehicle.make).toBeNull();
      expect(vehicle.model).toBeNull();
      expect(vehicle.modelYear).toBeNull();
      expect(vehicle.vehicleType).toBe('ice');
    });

    it('telemetry varsayılanları', () => {
      const { telemetry } = useVidStore.getState();
      expect(telemetry.trustScore).toBe(1.0);
      expect(telemetry.healthState).toBe('HEALTHY');
      expect(telemetry.thermalStatus).toBe('COLD');
      expect(telemetry.isDiagnosticDegraded).toBe(false);
      expect(telemetry.plausibilityFailures).toEqual({});
    });
  });

  /* ── 2. Yazma aksiyonları ────────────────────────────────────────────── */

  describe('yazma aksiyonları state\'i doğru günceller', () => {
    it('updateHeadUnitInfo kısmi günceller, dokunulmayan alan korunur', () => {
      useVidStore.getState().updateHeadUnitInfo({
        detectedPlatform: 'fyt',
        webViewChromeVersion: 90,
        installedPackages: ['com.foo.bar'],
      });
      const { headUnit } = useVidStore.getState();
      expect(headUnit.detectedPlatform).toBe('fyt');
      expect(headUnit.webViewChromeVersion).toBe(90);
      expect(headUnit.installedPackages).toEqual(['com.foo.bar']);
      // güncellenmeyen alanlar varsayılanda kalır
      expect(headUnit.ramSizeRealGb).toBe(0);
      expect(headUnit.isPlayServicesAvailable).toBe(false);
    });

    it('updateObdAdapterInfo günceller (false değeri de birleşir)', () => {
      useVidStore.getState().updateObdAdapterInfo({
        lastAddress: 'AA:BB:CC:DD:EE:FF',
        lastTransport: 'classic',
        isTransportVerified: true,
        lastProtocolNum: '6',
      });
      const { obdAdapter } = useVidStore.getState();
      expect(obdAdapter.lastAddress).toBe('AA:BB:CC:DD:EE:FF');
      expect(obdAdapter.lastTransport).toBe('classic');
      expect(obdAdapter.isTransportVerified).toBe(true);
      expect(obdAdapter.lastProtocolNum).toBe('6');
    });

    it('updateVehicleInfo günceller', () => {
      useVidStore.getState().updateVehicleInfo({
        vin: 'VF1TESTVIN1234567',
        make: 'Renault',
        model: 'Duster',
        modelYear: 2022,
        vehicleType: 'diesel',
      });
      const { vehicle } = useVidStore.getState();
      expect(vehicle.vin).toBe('VF1TESTVIN1234567');
      expect(vehicle.make).toBe('Renault');
      expect(vehicle.model).toBe('Duster');
      expect(vehicle.modelYear).toBe(2022);
      expect(vehicle.vehicleType).toBe('diesel');
    });
  });

  /* ── 3. trustScore sanitizasyonu ─────────────────────────────────────── */

  describe('updateTelemetryInfo trustScore clamp', () => {
    it('üst limit aşımı 1.5 → 1.0', () => {
      useVidStore.getState().updateTelemetryInfo({ trustScore: 1.5 });
      expect(useVidStore.getState().telemetry.trustScore).toBe(1.0);
    });

    it('alt limit aşımı -0.5 → 0.0', () => {
      useVidStore.getState().updateTelemetryInfo({ trustScore: -0.5 });
      expect(useVidStore.getState().telemetry.trustScore).toBe(0);
    });

    it('geçerli aralık 0.42 aynen korunur', () => {
      useVidStore.getState().updateTelemetryInfo({ trustScore: 0.42 });
      expect(useVidStore.getState().telemetry.trustScore).toBe(0.42);
    });

    it('diğer telemetri alanları trustScore olmadan güncellenir', () => {
      useVidStore.getState().updateTelemetryInfo({ healthState: 'STRESSED' });
      const { telemetry } = useVidStore.getState();
      expect(telemetry.healthState).toBe('STRESSED');
      // trustScore verilmediği için varsayılan korunur
      expect(telemetry.trustScore).toBe(1.0);
    });
  });

  /* ── 4. resetStore ───────────────────────────────────────────────────── */

  describe('resetStore tüm durumu başlangıca sıfırlar', () => {
    it('tüm gruplar varsayılana döner', () => {
      const st = useVidStore.getState();
      st.updateHeadUnitInfo({ detectedPlatform: 'ksw', ramSizeRealGb: 4 });
      st.updateObdAdapterInfo({ lastAddress: '11:22:33', isTransportVerified: true });
      st.updateVehicleInfo({ vin: 'SECRETVIN', make: 'Dacia' });
      st.updateTelemetryInfo({ trustScore: 0.2, healthState: 'SERVICE_SOON' });

      useVidStore.getState().resetStore();

      const after = useVidStore.getState();
      expect(after.headUnit.detectedPlatform).toBe('stock');
      expect(after.headUnit.ramSizeRealGb).toBe(0);
      expect(after.obdAdapter.lastAddress).toBeNull();
      expect(after.obdAdapter.isTransportVerified).toBe(false);
      expect(after.vehicle.vin).toBeNull();
      expect(after.vehicle.make).toBeNull();
      expect(after.telemetry.trustScore).toBe(1.0);
      expect(after.telemetry.healthState).toBe('HEALTHY');
    });
  });
});
