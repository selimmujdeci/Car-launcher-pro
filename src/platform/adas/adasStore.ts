/**
 * adasStore.ts — ADAS projeksiyonu (Zustand).
 *
 * TEK YAZAR: `adasRuntime`. UI ve güvenlik asistanı yalnız OKUR. Bu depo bir
 * truth üretmez; runtime'ın o anki hükmünü taşır. Hafif tutulur (yalnız
 * zustand) ki güvenlik asistanı onu import ettiğinde ağır görüntü/dedektör
 * zinciri paketlere sızmasın.
 */
import { create } from 'zustand';
import type {
  AdasCalibration, AdasFeatureStatus, AdasReason, AdasWarningSignal, LaneObservation, NormBox, NormLine,
} from './adasTypes';
import { NO_ADAS_WARNING } from './adasTypes';

/** Genel durum: kapalı · başlıyor · çalışıyor · kısmen · kullanılamaz. */
export type AdasOverall = 'OFF' | 'STARTING' | 'ACTIVE' | 'CALIBRATING' | 'DEGRADED' | 'UNAVAILABLE';

export interface AdasDebug {
  /** Son şerit gözlemi (normalize) — canlı görünüm için. */
  readonly lanes: LaneObservation | null;
  readonly lead: {
    readonly box: NormBox; readonly distanceM: number | null;
    readonly ttcS: number | null; readonly headwayS: number | null;
  } | null;
  readonly offsetM: number | null;
  readonly laneFps: number;
  readonly detectHz: number;
  readonly detectLatencyMs: number | null;
  readonly calibrationProgress: number;
  readonly turnSignalKnown: boolean;
  /** Dedektör arka ucu (webgl/cpu) ya da null. */
  readonly detectorBackend: string | null;
  readonly cameraLabel: string | null;
  readonly cameraIsUsb: boolean;
  readonly referenceLine: NormLine | null;
}

/**
 * ADAS'ın şu an işlediği yol kamerasının geometrisi. AR katmanı rotayı yola
 * BUNUNLA oturtur (ölçülmüş ufuk > cihaz sensörü > varsayılan) — iki katman
 * aynı kamerayı aynı modelle görür, ikinci bir kalibrasyon otoritesi kurulmaz.
 */
export interface AdasCameraModel {
  readonly hfovDeg: number;
  readonly cameraHeightM: number;
  /** Öğrenilmemişse `null` — AR varsayımla doldurmaz, sensöre/varsayılana düşer. */
  readonly calibration: AdasCalibration | null;
}

export interface AdasStoreState {
  readonly overall: AdasOverall;
  readonly overallReason: AdasReason | null;
  readonly features: readonly AdasFeatureStatus[];
  readonly warning: AdasWarningSignal;
  readonly debug: AdasDebug;
  /** ADAS kamerayı işlemiyorsa `null`. */
  readonly camera: AdasCameraModel | null;
}

export const EMPTY_ADAS_DEBUG: AdasDebug = {
  lanes: null, lead: null, offsetM: null, laneFps: 0, detectHz: 0, detectLatencyMs: null,
  calibrationProgress: 0, turnSignalKnown: false, detectorBackend: null,
  cameraLabel: null, cameraIsUsb: false, referenceLine: null,
};

export const useAdasStore = create<AdasStoreState>(() => ({
  overall: 'OFF',
  overallReason: 'DISABLED',
  features: [],
  warning: NO_ADAS_WARNING,
  debug: EMPTY_ADAS_DEBUG,
  camera: null,
}));

/** Güvenlik asistanının okuduğu sinyal (saf okuma). */
export function getAdasWarningSignal(): AdasWarningSignal {
  return useAdasStore.getState().warning;
}

/** Yalnız uyarı İÇERİĞİ değiştiyse true (kalp atışı damgası sayılmaz). */
export function adasWarningChanged(a: AdasWarningSignal, b: AdasWarningSignal): boolean {
  return a.lane !== b.lane || a.forward !== b.forward || a.leadDeparted !== b.leadDeparted;
}
