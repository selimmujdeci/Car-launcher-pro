/**
 * sentryEngine.ts — Sentry Mode 2.0 (Tesla tarzı olay bazlı güvenlik kaydı).
 *
 * Durum makinesi:
 *   idle ──armSentry()──► armed ──G>THRESHOLD──► triggered ──clip hazır──► armed
 *
 * Her tetikleme bağımsız: klip arka planda yüklenir, armed modu devam eder.
 * Çevrimdışıysa blob bellekte tutulur; bağlantı gelince otomatik yüklenir.
 *
 * Adaptive Performance:
 *   - Kamera erişilebilir → Video pre-buffer + G-Sensor
 *   - Kamera yok/Mali-400 → Yalnızca G-Sensor (videoAvailable = false)
 *
 * Altyapı gereksinimleri (Supabase):
 *   - `sentry_clips` Storage bucket (public veya signed URL)
 *   - `vehicle_events` tablosu (id, vehicle_id, type, metadata, created_at)
 */

import { useState, useEffect } from 'react';
import { subscribeToAccelerometer } from '../deviceApi';
import {
  startSentryPreBuffer,
  stopSentryPreBuffer,
  captureEmergencyClip,
} from '../dashcamService';
import { uploadSentryClip, insertVehicleEvent, getSupabaseClient } from '../supabaseClient';

/* ── Sabitler ────────────────────────────────────────────────── */

const IMPACT_THRESHOLD = 25;     // m/s² — park halinde darbe eşiği (false-positive azaltmak için dashcam'den yüksek)
const COOLDOWN_MS      = 30_000; // Aynı olaydan ard arda tetiklenmeyi engeller
const POST_BUFFER_SEC  = 20;     // Olay sonrası kaç saniye kayıt devam etsin

/* ── Tipler ──────────────────────────────────────────────────── */

export type SentryStatus = 'idle' | 'armed' | 'triggered';

export interface SentryAlert {
  id:           string;
  triggeredAt:  number;     // Date.now()
  impactG:      number;     // m/s²
  clipUrl:      string | null;
  uploadStatus: 'pending' | 'uploading' | 'done' | 'failed';
}

export interface SentryState {
  status:         SentryStatus;
  alerts:         SentryAlert[];
  pendingUploads: number;   // bellekte bekleyen klip sayısı
  lastImpactG:    number;   // anlık G kuvveti (m/s²)
  videoAvailable: boolean;  // false → G-Sensor only modu
}

/* ── Module state ────────────────────────────────────────────── */

const INITIAL: SentryState = {
  status:         'idle',
  alerts:         [],
  pendingUploads: 0,
  lastImpactG:    0,
  videoAvailable: false,
};

let _state: SentryState = { ...INITIAL };
const _listeners        = new Set<(s: SentryState) => void>();

let _unsubAccel: (() => void) | null = null;
let _vehicleId:  string | null       = null;
let _lastTrigger = 0;

// Çevrimdışı retry kuyruğu: alertId → blob (G-Sensor only ise null)
const _pendingBlobs = new Map<string, Blob | null>();

/* ── State helpers ───────────────────────────────────────────── */

function _notify(): void {
  const snap: SentryState = { ..._state, alerts: _state.alerts.map((a) => ({ ...a })) };
  _listeners.forEach((fn) => fn(snap));
}

function _set(partial: Partial<SentryState>): void {
  _state = { ..._state, ...partial };
  _notify();
}

function _patchAlert(id: string, patch: Partial<SentryAlert>): void {
  _set({ alerts: _state.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
}

function _uid(): string {
  return `snt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ── G-Sensor callback ───────────────────────────────────────── */

function _onAccel(_x: number, _y: number, _z: number, total: number): void {
  if (_state.status !== 'armed') return;

  const rounded = Math.round(total * 10) / 10;
  if (_state.lastImpactG !== rounded) _set({ lastImpactG: rounded });

  if (total < IMPACT_THRESHOLD) return;
  const now = Date.now();
  if (now - _lastTrigger < COOLDOWN_MS) return;

  _lastTrigger = now;
  void _handleImpact(total);
}

/* ── Olay tetikleme ──────────────────────────────────────────── */

async function _handleImpact(impactG: number): Promise<void> {
  const alertId = _uid();

  const alert: SentryAlert = {
    id:           alertId,
    triggeredAt:  Date.now(),
    impactG:      Math.round(impactG * 10) / 10,
    clipUrl:      null,
    uploadStatus: 'pending',
  };

  _set({ status: 'triggered', alerts: [..._state.alerts, alert] });

  // Video klip yakala (video yoksa null blob)
  let blob: Blob | null = null;
  if (_state.videoAvailable) {
    try {
      blob = await captureEmergencyClip(POST_BUFFER_SEC);
    } catch {
      // Kamera hatası → G-Sensor kaydı olarak devam et
    }
  }

  // Pre-buffer'ı bir sonraki olay için yeniden başlat
  if (_state.videoAvailable) {
    void startSentryPreBuffer();
  }

  // Armed moda geri dön (yükleme arka planda)
  _set({ status: 'armed' });

  // Arka plan yüklemesi — bloku asla
  void _upload(alertId, blob);
}

/* ── Upload ──────────────────────────────────────────────────── */

async function _upload(alertId: string, blob: Blob | null): Promise<void> {
  _patchAlert(alertId, { uploadStatus: 'uploading' });

  const result = await _doUpload(alertId, blob);

  if (result !== null) {
    _pendingBlobs.delete(alertId);
    _patchAlert(alertId, {
      uploadStatus: 'done',
      clipUrl:      result !== '' ? result : null,
    });
  } else {
    // Başarısız: belleğe al, tekrar denenecek
    _pendingBlobs.set(alertId, blob);
    _patchAlert(alertId, { uploadStatus: 'failed' });
  }

  _set({ pendingUploads: _pendingBlobs.size });
}

/**
 * @returns  URL (video yüklendi) | '' (video yok ama event kaydedildi) | null (hata)
 */
async function _doUpload(alertId: string, blob: Blob | null): Promise<string | null> {
  const alert = _state.alerts.find((a) => a.id === alertId);
  const ts    = alert?.triggeredAt ?? Date.now();

  let clipUrl: string | null = null;

  // 1. Video blob yükle
  // Klasör adı auth.uid() — Storage policy'si bunu zorunlu kılıyor
  const supabase = getSupabaseClient();
  const uid = supabase
    ? (await supabase.auth.getUser()).data.user?.id ?? _vehicleId ?? 'unknown'
    : (_vehicleId ?? 'unknown');

  if (blob && blob.size > 0) {
    const path = `${uid}/${alertId}-${ts}.webm`;
    try {
      clipUrl = await uploadSentryClip(blob, path);
      if (clipUrl === null) return null; // Yükleme başarısız → retry kuyruğuna eklenecek
    } catch {
      return null;
    }
  }

  // 2. Vehicle event kaydı (fire-and-forget — event insert hatası yüklemeyi iptal etmez)
  void insertVehicleEvent(_vehicleId, 'sentry_alert', {
    alert_id:     alertId,
    impact_g:     alert?.impactG ?? 0,
    clip_url:     clipUrl,
    triggered_at: ts,
  });

  return clipUrl ?? ''; // '' = başarılı ama video yok
}

/* ── Çevrimiçi retry ─────────────────────────────────────────── */

async function _retryPending(): Promise<void> {
  if (_pendingBlobs.size === 0) return;

  for (const [alertId, blob] of Array.from(_pendingBlobs.entries())) {
    if (!navigator.onLine) break;

    const result = await _doUpload(alertId, blob);
    if (result !== null) {
      _pendingBlobs.delete(alertId);
      _patchAlert(alertId, {
        uploadStatus: 'done',
        clipUrl:      result !== '' ? result : null,
      });
    }
  }

  _set({ pendingUploads: _pendingBlobs.size });
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Gözcü modunu başlatır.
 * @param vehicleId  Supabase'de eşleşen araç ID'si (opsiyonel, bilinmiyorsa null)
 */
export async function armSentry(vehicleId?: string): Promise<void> {
  if (_state.status !== 'idle') return;

  _vehicleId = vehicleId ?? null;

  // Video pre-buffer'ı başlat; başaramazsa G-Sensor only
  const videoOk = await startSentryPreBuffer();

  // G-Sensor dinleyicisi
  _unsubAccel = subscribeToAccelerometer(_onAccel);

  // Bağlantı gelince bekleyen klipler yüklensin
  window.addEventListener('online', _retryPending);

  _set({ status: 'armed', lastImpactG: 0, videoAvailable: videoOk });
}

/** Gözcü modunu durdurur ve tüm kaynakları temizler. */
export function disarmSentry(): void {
  if (_state.status === 'idle') return;

  _unsubAccel?.();
  _unsubAccel = null;

  stopSentryPreBuffer();

  window.removeEventListener('online', _retryPending);

  _set({ status: 'idle', lastImpactG: 0 });
}

/** Alert geçmişini temizler. */
export function clearSentryAlerts(): void {
  _set({ alerts: [] });
}

export function getSentryState(): SentryState {
  return { ..._state, alerts: _state.alerts.map((a) => ({ ...a })) };
}

export function onSentryState(fn: (s: SentryState) => void): () => void {
  _listeners.add(fn);
  fn(getSentryState());
  return () => { _listeners.delete(fn); };
}

export function useSentryState(): SentryState {
  const [s, setS] = useState<SentryState>(getSentryState());
  useEffect(() => onSentryState(setS), []);
  return s;
}

