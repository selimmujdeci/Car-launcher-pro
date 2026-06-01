/**
 * theaterModeService.ts — Theater (Sinema) Modu ses profili senkronizasyonu.
 *
 * NOT: Otomatik aktivasyon KALDIRILDI. Araç durunca sistem kendiliğinden
 * "siyah perde"ye (Theater Mode) GİRMEZ. Premium UI her modda net kalır.
 * Theater Mode yalnızca kullanıcı manuel açtığında (SmartCard / buton) aktifleşir.
 *
 * Bu servisin iki sorumluluğu kaldı:
 *   1. GÜVENLİK ÇIKIŞI: araç harekete geçerse (speed > EXIT_SPEED_KMH) Theater
 *      Mode anında kapanır.
 *   2. SES PROFİLİ: isTheaterModeActive değiştiğinde sinema/normal ses profili.
 *
 * Akış:
 *   speed > EXIT_SPEED_KMH      →  setTheaterMode(false)  [anında güvenlik çıkışı]
 *   isTheaterModeActive: true   →  setCinemaAudioProfile()
 *   isTheaterModeActive: false  →  setNormalAudioProfile()
 */

import { useUnifiedVehicleStore as useVehicleStore }    from './vehicleDataLayer/UnifiedVehicleStore';
import { setCinemaAudioProfile, setNormalAudioProfile } from './audioService';
import { useSystemStore }                               from '../store/useSystemStore';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const EXIT_SPEED_KMH = 2;      // Bu hızı aşınca → anında çıkış (GPS jitter payı)

// ── Modül state ───────────────────────────────────────────────────────────────

let _active           = false;
let _unsubSpeed:      (() => void) | null = null;
let _unsubTheater:    (() => void) | null = null;
let _wasTheaterActive = false;

// ── İç yardımcılar ───────────────────────────────────────────────────────────

/**
 * Güvenlik çıkışı — araç harekete geçti.
 * Blocking olmadan çağrılır; animate gerekmez (100ms fade TheaterOverlay'de).
 */
function _exitTheaterMode(): void {
  if (useSystemStore.getState().isTheaterModeActive) {
    useSystemStore.getState().setTheaterMode(false);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Theater Mode servisini başlatır.
 * App.tsx'te bir kez çağrılmalı; dönen thunk cleanup fonksiyonudur.
 */
export function startTheaterService(): () => void {
  if (_active) return stopTheaterService;
  _active = true;

  // ── Hız aboneliği — yalnızca GÜVENLİK çıkışı için ─────────────────────────
  // Otomatik aktivasyon yok: araç durunca Theater Mode kendiliğinden AÇILMAZ.
  // Yalnızca araç hareket ederse manuel açılmış modu güvenlik gereği kapatır.
  _unsubSpeed = useVehicleStore.subscribe((state) => {
    const spd = state.speed ?? 0;
    if (spd > EXIT_SPEED_KMH) {
      _exitTheaterMode();
    }
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
  _exitTheaterMode();
  _unsubSpeed?.();   _unsubSpeed   = null;
  _unsubTheater?.(); _unsubTheater = null;
}
