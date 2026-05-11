/**
 * OBD Bluetooth Auto-Pair Servisi (JS katmanı)
 *
 * Görev:
 *   - Native OBDBluetoothManager state'ini JS'e taşır
 *   - Kullanıcı onay flag'ini safeStorage'da saklar
 *   - FALLBACK durumunda UI'a event gönderir
 *   - startAuto() → start(..., userConfirmed=true)
 *   - startSilent() → start(..., userConfirmed=false) — yalnızca bilinen cihaz
 *
 * Güvenlik:
 *   - MAC/PIN yalnızca Android SharedPreferences'ta saklanır (native taraf)
 *   - JS katmanı MAC/PIN'e erişmez; yalnızca state event'lerini tüketir
 *   - Kullanıcı onayı safeStorage'da saklanır — tekrar sorulmaz
 */

import { CarLauncher } from './nativePlugin';
import type { OBDBtState, OBDBtStateEvent, SavedOBDDevice } from './nativePlugin';
import { isNative } from './bridge';
import { safeStorage } from '../utils/safeStorage';

export type { OBDBtState, OBDBtStateEvent };

const USER_CONFIRMED_KEY = 'obd_bt_user_confirmed';

class OBDBluetoothService {
  private _currentState: OBDBtState = 'IDLE';
  private _currentEvent: OBDBtStateEvent | null = null;
  private _listeners = new Set<(e: OBDBtStateEvent) => void>();
  private _nativeHandle: { remove(): void } | null = null;

  get state(): OBDBtState { return this._currentState; }
  get lastEvent(): OBDBtStateEvent | null { return this._currentEvent; }

  /** Durum değişikliklerine abone ol. Cleanup fonksiyonu döner. */
  onState(cb: (e: OBDBtStateEvent) => void): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  // ── Kullanıcı onayı ────────────────────────────────────────────────────────

  isUserConfirmed(): boolean {
    return safeStorage.getItem(USER_CONFIRMED_KEY) === 'true';
  }

  /** Kullanıcı "Otomatik Bağlan" iznini verdi — kalıcı olarak sakla. */
  setUserConfirmed(): void {
    safeStorage.setItem(USER_CONFIRMED_KEY, 'true');
  }

  /** Kullanıcı iznini geri al (ayarlardan). */
  revokeUserConfirmed(): void {
    safeStorage.removeItem(USER_CONFIRMED_KEY);
  }

  // ── Başlat / Durdur ────────────────────────────────────────────────────────

  /**
   * Tam otomatik mod: kullanıcı onayını kaydet ve silent PIN pairing et.
   * UI bu metodu kullanıcı "Otomatik Bağlan"a dokunduktan sonra çağırır.
   */
  async startAuto(): Promise<void> {
    this.setUserConfirmed();
    await this._start(true);
  }

  /**
   * Pasif mod: yalnızca daha önce eşleştirilmiş + kayıtlı cihazı dener.
   * Kullanıcı onayı gerektirmez; uygulama açılışında güvenle çağrılabilir.
   */
  async startSilent(): Promise<void> {
    await this._start(false);
  }

  async stop(): Promise<void> {
    this._nativeHandle?.remove();
    this._nativeHandle = null;
    if (isNative && CarLauncher.stopOBDBluetooth) {
      await CarLauncher.stopOBDBluetooth().catch(() => {});
    }
  }

  /**
   * FALLBACK_USER_ACTION_REQUIRED durumundan devam et.
   * UI "Bağlanmak için dokunun" mesajındaki butona basıldığında çağrılır.
   */
  async requestUserConnect(): Promise<void> {
    this.setUserConfirmed();
    if (isNative && CarLauncher.userConnectOBD) {
      await CarLauncher.userConnectOBD().catch(() => {});
    }
  }

  // ── Kayıtlı cihaz ─────────────────────────────────────────────────────────

  async getSavedDevice(): Promise<SavedOBDDevice | null> {
    if (!isNative || !CarLauncher.getSavedOBDDevice) return null;
    try {
      const r = await CarLauncher.getSavedOBDDevice();
      return (r?.mac && r?.name) ? (r as SavedOBDDevice) : null;
    } catch {
      return null;
    }
  }

  async clearSavedDevice(): Promise<void> {
    if (!isNative || !CarLauncher.clearSavedOBD) return;
    await CarLauncher.clearSavedOBD().catch(() => {});
  }

  // ── İç yardımcılar ────────────────────────────────────────────────────────

  private async _start(userConfirmed: boolean): Promise<void> {
    if (!isNative || !CarLauncher.startOBDBluetooth) return;

    // Önceki listener'ı temizle (duplicate listener koruması)
    if (this._nativeHandle) {
      this._nativeHandle.remove();
      this._nativeHandle = null;
    }

    // Native event'i dinle
    try {
      this._nativeHandle = await CarLauncher.addListener(
        'obdBtState',
        (e: OBDBtStateEvent) => this._onNativeState(e),
      );
    } catch {
      return;
    }

    await CarLauncher.startOBDBluetooth({ userConfirmed }).catch(() => {});
  }

  private _onNativeState(e: OBDBtStateEvent): void {
    this._currentState = e.state;
    this._currentEvent = e;
    this._listeners.forEach(fn => {
      try { fn(e); } catch { /* listener hatası servisi durdurmasın */ }
    });
  }
}

export const obdBluetoothService = new OBDBluetoothService();
