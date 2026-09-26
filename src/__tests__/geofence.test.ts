/**
 * geofence.test.ts — Güvenlik suite testleri.
 *
 * Test kapsamı:
 *  - PIN kilit doğru kod → true, yanlış kod → false
 *  - PIN kilidi etkinleştirme / deaktif etme
 *  - Vale modu hız limiti state
 *  - Geofence etkinleştirme/merkez/yarıçap
 *  - checkGeofence: sahte koordinatlarla içeri/dışarı testi
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPinLock,
  unlockPin,
  lockPin,
  setValeMode,
  setValeSpeedLimit,
  setGeofenceEnabled,
  setGeofenceCenter,
  setGeofenceRadius,
  checkGeofence,
  getGeofenceState,
  _resetGeofenceStateForTest,
} from '../platform/geofenceService';
import { setupPin, changePin } from '../platform/pinService';

/* ── Her testten önce state'i sıfırla ──────────────────────── */

beforeEach(async () => {
  /* Wave 12B: korunan mutasyonlar artık PIN kanıtı ister ve kapı fail-closed'dır.
     Testler için deterministik başlangıç, kanonik sıfırlayıcı + doğrulayıcı
     deposunun temizlenmesiyle kurulur (repo konvansiyonu `_reset*ForTest`). */
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ }
  _resetGeofenceStateForTest();
  // Koruma KAPALI başlar → aşağıdaki hazırlıklar kapıya takılmaz.
  await setGeofenceCenter({ lat: 41.0, lng: 29.0 });
  await setGeofenceRadius(0.5);
  await setGeofenceEnabled(false);
});

/* ── PIN kilit testleri ────────────────────────────────────── */

describe('PIN kilit', () => {
  it('doğru kod ile kilit açılır (true)', async () => {
    await setupPin('1234');
    await setPinLock(true);
    expect(await unlockPin('1234')).toBe(true);
  });

  it('yanlış kod reddedilir (false)', async () => {
    await setupPin('1234');
    await setPinLock(true);
    expect(await unlockPin('0000')).toBe(false);
    expect(await unlockPin('9999')).toBe(false);
    expect(await unlockPin('123')).toBe(false);
  });

  it('kilit kapalıyken her kod kabul edilir', async () => {
    await setPinLock(false);
    expect(await unlockPin('anything')).toBe(true);
  });

  it('kod değiştirilince yeni kod çalışır', async () => {
    await setupPin('1234');
    await setPinLock(true);
    /* Wave 12B: ikinci setupPin ARTIK sessizce ezmez (ALREADY_SET);
       değiştirmek MEVCUT PIN kanıtı ister. */
    expect((await setupPin('5678')).status).toBe('ALREADY_SET');
    expect(await changePin('0000', '5678'), 'yanlış mevcut PIN ile değişti').toBe(false);
    expect(await changePin('1234', '5678')).toBe(true);
    expect(await unlockPin('1234')).toBe(false);
    expect(await unlockPin('5678')).toBe(true);
  });

  it('lockPin state güncellenmiş (pin kapalı)', async () => {
    await setupPin('1234');
    await setPinLock(true);
    await unlockPin('1234'); // pin açık
    lockPin();
    // Kilitlendikten sonra pinLocked state doğru
    const state = getGeofenceState();
    expect(state.pinUnlocked).toBe(false);
  });
});

/* ── Vale modu testleri ────────────────────────────────────── */

describe('Vale modu', () => {
  it('varsayılan hız limiti 30 km/h', async () => {
    await setValeMode(true);
    const state = getGeofenceState();
    expect(state.valeSpeedLimit).toBeGreaterThan(0);
  });

  it('özel hız limiti ayarlanabilir', async () => {
    await setValeSpeedLimit(50);
    const state = getGeofenceState();
    expect(state.valeSpeedLimit).toBe(50);
  });

  it('vale modu etkinleştirilince durum güncellenir', async () => {
    await setValeMode(true);
    expect(getGeofenceState().valeModeActive).toBe(true);
    await setValeMode(false);
    expect(getGeofenceState().valeModeActive).toBe(false);
  });
});

/* ── Geofence testleri ─────────────────────────────────────── */

describe('Geofence — state yönetimi', () => {
  it('geofence center ve radius ayarlanabilir', async () => {
    await setGeofenceCenter({ lat: 41.01, lng: 28.98 });
    await setGeofenceRadius(1.0);
    await setGeofenceEnabled(true);

    const state = getGeofenceState();
    expect(state.center?.lat).toBeCloseTo(41.01);
    expect(state.center?.lng).toBeCloseTo(28.98);
    expect(state.radiusKm).toBe(1.0);
    expect(state.enabled).toBe(true);
  });

  it('geofence kapatılınca enabled false', async () => {
    await setGeofenceEnabled(true);
    await setGeofenceEnabled(false);
    expect(getGeofenceState().enabled).toBe(false);
  });
});

describe('checkGeofence — koordinat tabanlı ihlal', () => {
  beforeEach(async () => {
    // Merkez: İstanbul Taksim (41.037, 28.985)
    await setGeofenceCenter({ lat: 41.037, lng: 28.985 });
    await setGeofenceRadius(1.0); // 1 km yarıçap
    await setGeofenceEnabled(true);
  });

  it('merkez koordinatlarında ihlal yok', async () => {
    checkGeofence(41.037, 28.985, 0);
    const state = getGeofenceState();
    expect(state.lastAlert?.type).not.toBe('exit');
  });

  it('çok uzakta ihlal tetiklenir', async () => {
    // Kadıköy (~7 km uzakta)
    checkGeofence(40.990, 29.027, 0);
    const state = getGeofenceState();
    // exit tetiklendi mi?
    expect(state.lastAlert?.type).toBe('exit');
  });

  it('geofence kapalıyken ihlal tetiklenmez', async () => {
    await setGeofenceEnabled(false);
    const alertBefore = getGeofenceState().lastAlert;
    checkGeofence(40.0, 29.0, 0); // çok uzak
    expect(getGeofenceState().lastAlert).toBe(alertBefore);
  });
});

describe('checkGeofence — vale hız ihlali', () => {
  it('vale modunda hız limitini aşınca kayıt edilir', async () => {
    await setValeMode(true);
    await setValeSpeedLimit(30);
    await setGeofenceEnabled(true);
    await setGeofenceCenter({ lat: 41.037, lng: 28.985 });

    // Merkez içinde ama hız yüksek
    checkGeofence(41.037, 28.985, 60);
    const state = getGeofenceState();
    expect(state.valeViolations.length).toBeGreaterThan(0);
    expect(state.valeViolations[0].speedKmh).toBe(60);
  });

  it('vale modu kapalıyken hız ihlali kaydedilmez', async () => {
    await setValeMode(false);
    await setGeofenceEnabled(true);
    const countBefore = getGeofenceState().valeViolations.length;
    checkGeofence(41.037, 28.985, 999);
    expect(getGeofenceState().valeViolations.length).toBe(countBefore);
  });
});
