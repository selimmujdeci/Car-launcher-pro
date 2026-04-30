/**
 * theaterModeService.ts — Theater Mode Otomasyonu.
 *
 * Araç 30 saniye boyunca durursa VE medya oynatılıyorsa Theater Mode doğrudan aktifleşir.
 * Araç hareket ederse (speed > EXIT_SPEED_KMH) → anında deaktif (GÜVENLİK).
 *
 * Akış:
 *   speed → 0  ──30s timer──►  playing? → setTheaterMode(true)
 *   speed > EXIT_SPEED_KMH    →  setTheaterMode(false)  [anında, 100ms bekleme yok]
 *   isTheaterModeActive: true  →  setCinemaAudioProfile()
 *   isTheaterModeActive: false →  setNormalAudioProfile()
 */

import { useVehicleStore }                              from './vehicleDataLayer/VehicleStateStore';
import { getMediaState }                                from './mediaService';
import { setCinemaAudioProfile, setNormalAudioProfile } from './audioService';
import { useSystemStore }                               from '../store/useSystemStore';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const STOP_DELAY_MS  = 30_000; // Araç durduktan kaç ms sonra aktifleşir
const EXIT_SPEED_KMH = 2;      // Bu hızı aşınca → anında çıkış (GPS jitter payı)

// ── Modül state ───────────────────────────────────────────────────────────────

let _stopTimer:       ReturnType<typeof setTimeout> | null = null;
let _active           = false;
let _unsubSpeed:      (() => void) | null = null;
let _unsubTheater:    (() => void) | null = null;
let _wasTheaterActive = false;

// ── İç yardımcılar ───────────────────────────────────────────────────────────

function _cancelTimer(): void {
  if (_stopTimer) { clearTimeout(_stopTimer); _stopTimer = null; }
}

/**
 * 30s duruş sonrası doğrudan aktivasyon.
 * Medya oynatılmıyorsa sessizce geçer — zamanlayıcı bir sonraki duruşta yeniden dener.
 */
function _activateTheaterMode(): void {
  if (!_active) return;
  if (useSystemStore.getState().isTheaterModeActive) return; // zaten aktif
  if (!getMediaState().playing) return;                      // medya yok → bekle
  useSystemStore.getState().setTheaterMode(true);
}

/**
 * Güvenlik çıkışı — araç harekete geçti.
 * Blocking olmadan çağrılır; animate gerekmez (100ms fade TheaterOverlay'de).
 */
function _exitTheaterMode(): void {
  if (useSystemStore.getState().isTheaterModeActive) {
    useSystemStore.getState().setTheaterMode(false);
  }
  _cancelTimer();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Theater Mode servisini başlatır.
 * App.tsx'te bir kez çağrılmalı; dönen thunk cleanup fonksiyonudur.
 */
export function startTheaterService(): () => void {
  if (_active) return stopTheaterService;
  _active = true;

  // ── Hız aboneliği ─────────────────────────────────────────────────────────
  let _prevSpeed = useVehicleStore.getState().speed;

  _unsubSpeed = useVehicleStore.subscribe((state) => {
    const speed = state.speed;
    const spd   = speed ?? 0;

    // Güvenlik öncelikli: hareket → anında çıkış, timer iptal
    if (spd > EXIT_SPEED_KMH) {
      _exitTheaterMode();
      _prevSpeed = speed;
      return;
    }

    // Durma geçişi (hareket → 0) → 30s sayacını başlat
    if (spd === 0 && ((_prevSpeed ?? 0) > EXIT_SPEED_KMH)) {
      _cancelTimer();
      _stopTimer = setTimeout(_activateTheaterMode, STOP_DELAY_MS);
    }

    _prevSpeed = speed;
  });

  // ── Theater Mode değişiminde ses profili güncelle ─────────────────────────
  // Yalnızca gerçekten değiştiğinde → setState döngüsü riski yok.
  _wasTheaterActive = useSystemStore.getState().isTheaterModeActive;

  _unsubTheater = useSystemStore.subscribe((state) => {
    const isActive = state.isTheaterModeActive;
    if (isActive === _wasTheaterActive) return;
    _wasTheaterActive = isActive;
    if (isActive) {
      setCinemaAudioProfile();
    } else {
      setNormalAudioProfile();
    }
  });

  return stopTheaterService;
}

export function stopTheaterService(): void {
  if (!_active) return;
  _active = false;
  _cancelTimer();
  _exitTheaterMode();
  _unsubSpeed?.();   _unsubSpeed   = null;
  _unsubTheater?.(); _unsubTheater = null;
}
