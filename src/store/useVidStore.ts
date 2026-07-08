/**
 * useVidStore — Vehicle Intelligence Database (VID) · Sprint 1 Foundation
 *
 * Araç, head unit, OBD adaptörü ve telemetri sinyallerini TEK bütünsel şemada
 * konsolide eden izole temel store. Sprint 1'de yalnız durum + yazma API'si;
 * hiçbir mevcut store/servise bağlanmaz (regresyon riski sıfır).
 *
 * Gizlilik garantisi: Bu store hassas veri (VIN dahil) ASLA loglamaz —
 * içeride hiçbir console.* çağrısı yoktur. VIN yalnız durumda tutulur, ifşa edilmez.
 */

import { create } from 'zustand';

/* ── Alt-şema arayüzleri ─────────────────────────────────────────────────── */

/** Head unit donanım/yazılım kimliği (platform tespiti + kabiliyet). */
export interface VidHeadUnitInfo {
  detectedPlatform: 'fyt' | 'microntek' | 'ksw' | 'roadrover' | 'hiworld' | 'stock';
  installedPackages: string[];
  webViewChromeVersion: number;
  ramSizeRealGb: number;
  isPlayServicesAvailable: boolean;
}

/** OBD adaptörü son-bilinen bağlantı durumu (transport öğrenme kalıcılığı). */
export interface VidObdAdapterInfo {
  lastAddress: string | null;
  lastTransport: 'classic' | 'ble' | 'tcp' | null;
  isTransportVerified: boolean;
  lastProtocolNum: string | null;
}

/** Araç kimliği (VIN + marka/model çözümlemesi). */
export interface VidVehicleInfo {
  vin: string | null;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  vehicleType: 'ice' | 'diesel' | 'ev' | 'hybrid' | 'phev';
}

/** Zero-trust telemetri özeti (güven + sağlık + termal + akıl-yürütme sonuçları). */
export interface VidTelemetryInfo {
  trustScore: number;
  healthState: 'HEALTHY' | 'MONITOR' | 'STRESSED' | 'ATTENTION' | 'SERVICE_SOON';
  thermalStatus: 'COLD' | 'WARM' | 'OPTIMAL' | 'HEAT_SOAK' | 'OVERHEAT_RISK';
  isDiagnosticDegraded: boolean;
  plausibilityFailures: Record<string, string>;
}

/** Dört ana grubu içeren bütünsel VID şeması. */
export interface VehicleIntelligenceSchema {
  headUnit: VidHeadUnitInfo;
  obdAdapter: VidObdAdapterInfo;
  vehicle: VidVehicleInfo;
  telemetry: VidTelemetryInfo;
}

/* ── Yazma API'si (actions) ──────────────────────────────────────────────── */

interface VidStoreActions {
  updateHeadUnitInfo: (info: Partial<VidHeadUnitInfo>) => void;
  updateObdAdapterInfo: (info: Partial<VidObdAdapterInfo>) => void;
  updateVehicleInfo: (info: Partial<VidVehicleInfo>) => void;
  updateTelemetryInfo: (info: Partial<VidTelemetryInfo>) => void;
  resetStore: () => void;
}

export type VidStore = VehicleIntelligenceSchema & VidStoreActions;

/* ── Saf sanitizasyon / birleştirme yardımcıları ─────────────────────────── */

/** trustScore'u [0.0, 1.0] aralığına sabitler (saf, yan etkisiz). */
function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}

/**
 * Sığ birleştirme: patch içindeki YALNIZ undefined/null OLMAYAN alanları base'e
 * kopyalar (yanlışlıkla alan sıfırlamayı önler). Derin kopya yok — performans dostu;
 * her grup düz nesne olduğu için sığ birleştirme yeterlidir.
 */
function mergeDefined<T extends object>(base: T, patch: Partial<T>): T {
  const out: T = { ...base };
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key];
    if (value !== undefined && value !== null) {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}

/* ── Başlangıç durumu (fabrika — reset'te taze referanslar) ───────────────── */

/**
 * Varsayılan şemayı HER çağrıda taze nesne/dizi referanslarıyla üretir; böylece
 * resetStore paylaşılan dizi/kayıt mutasyonu riski taşımaz.
 */
function createInitialSchema(): VehicleIntelligenceSchema {
  return {
    headUnit: {
      detectedPlatform: 'stock',
      installedPackages: [],
      webViewChromeVersion: 0,
      ramSizeRealGb: 0,
      isPlayServicesAvailable: false,
    },
    obdAdapter: {
      lastAddress: null,
      lastTransport: null,
      isTransportVerified: false,
      lastProtocolNum: null,
    },
    vehicle: {
      vin: null,
      make: null,
      model: null,
      modelYear: null,
      vehicleType: 'ice',
    },
    telemetry: {
      trustScore: 1.0,
      healthState: 'HEALTHY',
      thermalStatus: 'COLD',
      isDiagnosticDegraded: false,
      plausibilityFailures: {},
    },
  };
}

/* ── Zustand store ───────────────────────────────────────────────────────── */

export const useVidStore = create<VidStore>()((set) => ({
  ...createInitialSchema(),

  updateHeadUnitInfo: (info) =>
    set((s) => ({ headUnit: mergeDefined(s.headUnit, info) })),

  updateObdAdapterInfo: (info) =>
    set((s) => ({ obdAdapter: mergeDefined(s.obdAdapter, info) })),

  updateVehicleInfo: (info) =>
    set((s) => ({ vehicle: mergeDefined(s.vehicle, info) })),

  updateTelemetryInfo: (info) =>
    set((s) => {
      // trustScore verildiğinde [0,1]'e sanitize et; diğer alanlar sığ birleşir.
      const patch: Partial<VidTelemetryInfo> =
        typeof info.trustScore === 'number'
          ? { ...info, trustScore: clamp01(info.trustScore) }
          : info;
      return { telemetry: mergeDefined(s.telemetry, patch) };
    }),

  // set() varsayılan sığ-birleştirmeyle yalnız şema alanlarını sıfırlar; action'lar korunur.
  resetStore: () => set(createInitialSchema()),
}));
