/**
 * ReplayService — BlackBox Kayıt Yeniden Oynatıcı (DEV ONLY)
 *
 * BlackBoxSample[] dizisini okuyup 1Hz frekansta UnifiedVehicleStore'a
 * enjekte eder. Kaza öncesi araç dinamiklerini simüle etmek için kullanılır.
 *
 * Production'da no-op: import.meta.env.DEV kontrolü + tree-shaking.
 */

import type { BlackBoxSample } from '../security/blackBoxService';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface ReplayState {
  playing:      boolean;
  currentIndex: number;
  totalFrames:  number;
  elapsedMs:    number;
}

type ReplayListener = (state: ReplayState) => void;

/* ── Engine state ─────────────────────────────────────────────────────────── */

let _playing     = false;
let _samples:    BlackBoxSample[] = [];
let _cursor      = 0;
let _startTime   = 0;
let _tickTimer:  ReturnType<typeof setInterval> | null = null;
let _listeners   = new Set<ReplayListener>();

/* ── Internal helpers ─────────────────────────────────────────────────────── */

function _emitState(): void {
  const s: ReplayState = {
    playing:      _playing,
    currentIndex: _cursor,
    totalFrames:  _samples.length,
    elapsedMs:    _playing ? Date.now() - _startTime : 0,
  };
  _listeners.forEach((fn) => fn(s));
}

function _applyFrame(sample: BlackBoxSample): void {
  const { updateVehicleState, updateCanExtras } = useUnifiedVehicleStore.getState();

  const { spd, rpm, gear } = sample.signals;

  if (spd !== null || rpm !== null) {
    updateVehicleState({
      ...(spd !== null ? { speed: spd } : {}),
      ...(rpm !== null ? { rpm }        : {}),
    });
  }

  if (gear !== null) {
    updateCanExtras({ gearPos: gear });
  }
}

function _tick(): void {
  if (!_playing || _cursor >= _samples.length) {
    stopReplay();
    return;
  }

  const frame = _samples[_cursor];
  if (frame) _applyFrame(frame);
  _cursor++;
  _emitState();
}

/* ── Public API ───────────────────────────────────────────────────────────── */

/**
 * JSON string'den BlackBoxSample[] ayrıştırır.
 * Bilinmeyen alan varsa sessizce görmezden gelir.
 */
export function parseReplayJson(json: string): BlackBoxSample[] {
  if (!import.meta.env.DEV) return [];

  try {
    const raw = JSON.parse(json);
    const arr: unknown[] = Array.isArray(raw) ? raw : (raw as { replayBuffer?: unknown[] }).replayBuffer ?? [];

    return arr
      .filter((item): item is BlackBoxSample =>
        typeof item === 'object' &&
        item !== null &&
        'ts' in item &&
        'signals' in item,
      )
      .sort((a, b) => (a as BlackBoxSample).ts - (b as BlackBoxSample).ts);
  } catch {
    console.warn('[ReplayService] JSON ayrıştırma hatası');
    return [];
  }
}

/**
 * Örnekleri yükler ve 1Hz oynatmaya başlar. DEV only.
 */
export function startReplay(samples: BlackBoxSample[]): void {
  if (!import.meta.env.DEV) return;
  if (samples.length === 0) return;

  stopReplay();

  _samples   = samples;
  _cursor    = 0;
  _playing   = true;
  _startTime = Date.now();

  console.info(`[ReplayService] Başlıyor: ${samples.length} frame`);

  _tickTimer = setInterval(_tick, 1_000);
  _emitState();
}

/**
 * Oynatmayı durdurur, store'u temizlemez (son frame'de kalır).
 */
export function stopReplay(): void {
  if (!import.meta.env.DEV) return;

  if (_tickTimer !== null) {
    clearInterval(_tickTimer);
    _tickTimer = null;
  }

  _playing = false;
  _emitState();

  console.info('[ReplayService] Durduruldu.');
}

export function isReplayPlaying(): boolean { return _playing; }

export function getReplayState(): ReplayState {
  return {
    playing:      _playing,
    currentIndex: _cursor,
    totalFrames:  _samples.length,
    elapsedMs:    _playing ? Date.now() - _startTime : 0,
  };
}

/** Oynatma durum değişikliklerine abone ol. */
export function onReplayState(fn: ReplayListener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
