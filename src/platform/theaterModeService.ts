/**
 * theaterModeService.ts — Theater (Sinema) Modu güvenlik çıkışı.
 *
 * NOT: Otomatik aktivasyon KALDIRILDI. Araç durunca sistem kendiliğinden
 * "siyah perde"ye (Theater Mode) GİRMEZ. Premium UI her modda net kalır.
 * Theater Mode yalnızca kullanıcı manuel açtığında (SmartCard / buton) aktifleşir.
 *
 * Bu servisin TEK sorumluluğu kaldı:
 *   GÜVENLİK ÇIKIŞI: araç harekete geçerse (speed > EXIT_SPEED_KMH) Theater
 *   Mode anında kapanır.
 *
 * MUSIC F6.1 — SES PROFİLİ SORUMLULUĞU KALDIRILDI (ölü yol temizliği):
 * bu servis `audioService.setCinemaAudioProfile()/setNormalAudioProfile()`
 * çağırıyordu. O fonksiyonlar bir **Web Audio** EQ zincirini ayarlıyordu;
 * üretimde o zincire hiçbir kaynak bağlı DEĞİLDİ (kanonik oynatma native
 * ExoPlayer'dır) → çağrılar duyulur hiçbir şey yapmıyordu. Kanonik ses rengi
 * otoritesi `AudioExperienceAuthority`dir (F6) ve preset KULLANICININDIR;
 * Theater Mode oraya YAZMAZ (ikinci preset yazarı kurulmaz — Cross-Domain §1).
 *
 * Akış:
 *   speed > EXIT_SPEED_KMH  →  setTheaterMode(false)  [anında güvenlik çıkışı]
 */

import { useUnifiedVehicleStore as useVehicleStore }    from './vehicleDataLayer/UnifiedVehicleStore';
import { useSystemStore }                               from '../store/useSystemStore';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const EXIT_SPEED_KMH = 2;      // Bu hızı aşınca → anında çıkış (GPS jitter payı)

// ── Modül state ───────────────────────────────────────────────────────────────

let _active      = false;
let _unsubSpeed: (() => void) | null = null;

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

  return stopTheaterService;
}

export function stopTheaterService(): void {
  if (!_active) return;
  _active = false;
  _exitTheaterMode();
  _unsubSpeed?.(); _unsubSpeed = null;
}
