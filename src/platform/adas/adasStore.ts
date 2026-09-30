/**
 * adasStore.ts — ADAS'ın TEK kanonik otoritesi (ayarlar + kalibrasyon + canlı sinyaller).
 *
 * YAZAR SÖZLEŞMESİ:
 *   · Kullanıcı ayarları / kalibrasyon → UI eylemleri (`setAdasSettings`, `saveAdasCalibration`…).
 *   · Canlı durum ve sinyaller       → YALNIZ `adasRuntime` (tek yazar).
 *   · Safety köprüsü                  → yalnız OKUR (`signals`), bayatlık kapısını kendi uygular.
 *
 * EPOCH: her kamera oturumu yeni bir epoch açar. `publishAdasEvaluation` eski epoch'la
 * gelen sonucu REDDEDER — kapanmış oturumun geç gelen karesi yeni oturumun truth'unu
 * değiştiremez (CLAUDE.md §8).
 *
 * KALICILIK: yalnız `settings` + `calibrations` diske yazılır; canlı sinyal ASLA
 * kalıcı değildir (replay ≠ current truth).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../../utils/safeStorage';
import { sanitizeCalibration, DEFAULT_ADAS_CALIBRATION } from './adasCalibration';
import type {
  AdasCalibration, AdasCameraInfo, AdasLaneState, AdasLeadState, AdasReason,
  AdasSensitivity, AdasSignal, AdasSignals, AdasStatus,
} from './adasTypes';

export const ADAS_PERSIST_KEY = 'car-adas-v1';
/** Otomatik kamera seçimi için kalibrasyon anahtarı. */
export const ADAS_AUTO_CAMERA_KEY = 'auto';
const MAX_CALIBRATIONS = 8;

export interface AdasSettings {
  /** Ana anahtar — varsayılan KAPALI (kamera + CPU bilinçli olarak açılır). */
  enabled: boolean;
  forwardCollision: boolean;
  headway: boolean;
  laneDeparture: boolean;
  leadDeparture: boolean;
  sensitivity: AdasSensitivity;
  /** Yol kamerası; null = otomatik (arka/`environment` kamera). */
  cameraDeviceId: string | null;
}

export const DEFAULT_ADAS_SETTINGS: Readonly<AdasSettings> = Object.freeze({
  enabled: false,
  forwardCollision: true,
  headway: true,
  laneDeparture: true,
  leadDeparture: true,
  sensitivity: 'normal',
  cameraDeviceId: null,
});

const NEVER = Number.NEGATIVE_INFINITY;

function sig<T>(value: T): AdasSignal<T> {
  return { value, ts: NEVER, epoch: 0 };
}

export function emptyAdasSignals(): AdasSignals {
  return {
    forwardCollision: sig(false),
    headway: sig(false),
    laneDeparture: sig<'left' | 'right' | null>(null),
    leadDeparture: sig(false),
  };
}

export interface AdasState {
  settings: AdasSettings;
  calibrations: Record<string, AdasCalibration>;

  status: AdasStatus;
  reason: AdasReason | null;
  epoch: number;
  signals: AdasSignals;
  lead: AdasLeadState | null;
  lane: AdasLaneState | null;
  camera: AdasCameraInfo | null;
  /** Son işlenen karenin yakalanma anı (performance.now). */
  lastFrameTs: number | null;
  /** Otomatik ufuk kalibrasyonu ilerlemesi (0..1). */
  calibrationProgress: number;
}

export const useAdasStore = create<AdasState>()(
  persist(
    (): AdasState => ({
      settings: { ...DEFAULT_ADAS_SETTINGS },
      calibrations: {},
      status: 'off',
      reason: null,
      epoch: 0,
      signals: emptyAdasSignals(),
      lead: null,
      lane: null,
      camera: null,
      lastFrameTs: null,
      calibrationProgress: 0,
    }),
    {
      name: ADAS_PERSIST_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ settings: s.settings, calibrations: s.calibrations }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<AdasState, 'settings' | 'calibrations'>>;
        return { ...current, settings: sanitizeSettings(p.settings), calibrations: sanitizeCalibrations(p.calibrations) };
      },
    },
  ),
);

// ── Doğrulama (kalıcı veri güvenilmezdir) ────────────────────────────────────

function sanitizeSettings(raw: unknown): AdasSettings {
  const d = DEFAULT_ADAS_SETTINGS;
  if (raw === null || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;
  const bool = (k: keyof AdasSettings, def: boolean): boolean => (typeof r[k] === 'boolean' ? (r[k] as boolean) : def);
  const sens = r.sensitivity === 'early' || r.sensitivity === 'late' || r.sensitivity === 'normal' ? r.sensitivity : d.sensitivity;
  const cam = typeof r.cameraDeviceId === 'string' && r.cameraDeviceId.length > 0 && r.cameraDeviceId.length < 512
    ? r.cameraDeviceId : null;
  return {
    enabled: bool('enabled', d.enabled),
    forwardCollision: bool('forwardCollision', d.forwardCollision),
    headway: bool('headway', d.headway),
    laneDeparture: bool('laneDeparture', d.laneDeparture),
    leadDeparture: bool('leadDeparture', d.leadDeparture),
    sensitivity: sens,
    cameraDeviceId: cam,
  };
}

function sanitizeCalibrations(raw: unknown): Record<string, AdasCalibration> {
  const out: Record<string, AdasCalibration> = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_CALIBRATIONS)) {
    if (typeof k === 'string' && k.length > 0 && k.length < 512) out[k] = sanitizeCalibration(v);
  }
  return out;
}

// ── Kullanıcı eylemleri ──────────────────────────────────────────────────────

export function setAdasSettings(patch: Partial<AdasSettings>): void {
  useAdasStore.setState((s) => ({ settings: sanitizeSettings({ ...s.settings, ...patch }) }));
}

export function cameraKeyFor(deviceId: string | null): string {
  return deviceId ?? ADAS_AUTO_CAMERA_KEY;
}

/** Seçili kameranın kalibrasyonu; yoksa varsayılan (metrik değil). */
export function getAdasCalibration(deviceId: string | null): AdasCalibration {
  return useAdasStore.getState().calibrations[cameraKeyFor(deviceId)] ?? { ...DEFAULT_ADAS_CALIBRATION };
}

export function saveAdasCalibration(deviceId: string | null, cal: AdasCalibration): void {
  const key = cameraKeyFor(deviceId);
  useAdasStore.setState((s) => {
    const next: Record<string, AdasCalibration> = { ...s.calibrations, [key]: sanitizeCalibration(cal) };
    const keys = Object.keys(next);
    // Sınırlı: en eski (ekleme sırası) anahtar düşer, aktif anahtar korunur.
    while (keys.length > MAX_CALIBRATIONS) {
      const drop = keys.find((k) => k !== key);
      if (drop === undefined) break;
      delete next[drop];
      keys.splice(keys.indexOf(drop), 1);
    }
    return { calibrations: next };
  });
}

export function resetAdasCalibration(deviceId: string | null): void {
  const key = cameraKeyFor(deviceId);
  useAdasStore.setState((s) => {
    const next = { ...s.calibrations };
    delete next[key];
    return { calibrations: next };
  });
}

// ── Çalışma zamanı yazarı (YALNIZ adasRuntime) ───────────────────────────────

/** Yeni kamera oturumu açar; tüm sinyaller sıfırlanır. @returns yeni epoch. */
export function beginAdasEpoch(camera: AdasCameraInfo | null): number {
  const epoch = useAdasStore.getState().epoch + 1;
  useAdasStore.setState({
    epoch,
    camera,
    signals: emptyAdasSignals(),
    lead: null,
    lane: null,
    lastFrameTs: null,
  });
  return epoch;
}

export function setAdasStatus(status: AdasStatus, reason: AdasReason | null): void {
  const s = useAdasStore.getState();
  if (s.status === status && s.reason === reason) return;
  useAdasStore.setState({ status, reason });
}

/** Tüm sinyalleri düşürür (koşul/oturum bitti, kare dondu). Değer zaten sönükse yazmaz. */
export function clearAdasSignals(): void {
  const s = useAdasStore.getState();
  const sg = s.signals;
  const anyOn = sg.forwardCollision.value || sg.headway.value || sg.laneDeparture.value !== null || sg.leadDeparture.value;
  if (!anyOn && s.lead === null && s.lane === null) return;
  useAdasStore.setState({ signals: emptyAdasSignals(), lead: null, lane: null });
}

export interface AdasEvaluation {
  epoch: number;
  ts: number;
  forwardCollision: boolean;
  headway: boolean;
  laneDeparture: 'left' | 'right' | null;
  leadDeparture: boolean;
  lead: AdasLeadState | null;
  lane: AdasLaneState | null;
  calibrationProgress: number;
}

/**
 * Bir karenin değerlendirmesini yayımlar. Eski epoch → REDDEDİLİR (false döner).
 * Sinyal zaman damgaları her karede tazelenir (Safety bayatlık kapısı bunu okur).
 */
export function publishAdasEvaluation(e: AdasEvaluation): boolean {
  const s = useAdasStore.getState();
  if (e.epoch !== s.epoch) return false;
  useAdasStore.setState({
    signals: {
      forwardCollision: { value: e.forwardCollision, ts: e.ts, epoch: e.epoch },
      headway: { value: e.headway, ts: e.ts, epoch: e.epoch },
      laneDeparture: { value: e.laneDeparture, ts: e.ts, epoch: e.epoch },
      leadDeparture: { value: e.leadDeparture, ts: e.ts, epoch: e.epoch },
    },
    lead: e.lead,
    lane: e.lane,
    lastFrameTs: e.ts,
    calibrationProgress: e.calibrationProgress,
  });
  return true;
}

/** Sinyal DEĞERLERİ değişti mi (damga hariç) — Safety aboneliği için seçici. */
export function adasSignalValuesChanged(a: AdasSignals, b: AdasSignals): boolean {
  return a.forwardCollision.value !== b.forwardCollision.value
    || a.headway.value !== b.headway.value
    || a.laneDeparture.value !== b.laneDeparture.value
    || a.leadDeparture.value !== b.leadDeparture.value;
}
