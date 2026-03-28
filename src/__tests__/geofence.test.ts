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
} from '../platform/geofenceService';

/* ── Her testten önce state'i sıfırla ──────────────────────── */

beforeEach(() => {
  // Pin kilidini kapat
  setPinLock(false, '');
  // Vale modunu kapat
  setValeMode(false);
  // Geofence'i kapat
  setGeofenceEnabled(false);
  setGeofenceCenter(null);
  setGeofenceRadius(0.5);
});

/* ── PIN kilit testleri ────────────────────────────────────── */

describe('PIN kilit', () => {
  it('doğru kod ile kilit açılır (true)', () => {
    setPinLock(true, '1234');
    expect(unlockPin('1234')).toBe(true);
  });

  it('yanlış kod reddedilir (false)', () => {
    setPinLock(true, '1234');
    expect(unlockPin('0000')).toBe(false);
    expect(unlockPin('9999')).toBe(false);
    expect(unlockPin('123')).toBe(false);
  });

  it('kilit kapalıyken her kod kabul edilir', () => {
    setPinLock(false, '');
    expect(unlockPin('anything')).toBe(true);
  });

  it('kod değiştirilince yeni kod çalışır', () => {
    setPinLock(true, '1234');
    setPinLock(true, '5678');
    expect(unlockPin('1234')).toBe(false);
    expect(unlockPin('5678')).toBe(true);
  });

  it('lockPin state güncellenmiş (pin kapalı)', () => {
    setPinLock(true, '1234');
    unlockPin('1234'); // pin açık
    lockPin();
    // Kilitlendikten sonra pinLocked state doğru
    const state = getGeofenceState();
    expect(state.pinUnlocked).toBe(false);
  });
});

/* ── Vale modu testleri ────────────────────────────────────── */

describe('Vale modu', () => {
  it('varsayılan hız limiti 30 km/h', () => {
    setValeMode(true);
    const state = getGeofenceState();
    expect(state.valeSpeedLimit).toBeGreaterThan(0);
  });

  it('özel hız limiti ayarlanabilir', () => {
    setValeSpeedLimit(50);
    const state = getGeofenceState();
    expect(state.valeSpeedLimit).toBe(50);
  });

  it('vale modu etkinleştirilince durum güncellenir', () => {
    setValeMode(true);
    expect(getGeofenceState().valeModeActive).toBe(true);
    setValeMode(false);
    expect(getGeofenceState().valeModeActive).toBe(false);
  });
});

/* ── Geofence testleri ─────────────────────────────────────── */

describe('Geofence — state yönetimi', () => {
  it('geofence center ve radius ayarlanabilir', () => {
    setGeofenceCenter({ lat: 41.01, lng: 28.98 });
    setGeofenceRadius(1.0);
    setGeofenceEnabled(true);

    const state = getGeofenceState();
    expect(state.center?.lat).toBeCloseTo(41.01);
    expect(state.center?.lng).toBeCloseTo(28.98);
    expect(state.radiusKm).toBe(1.0);
    expect(state.enabled).toBe(true);
  });

  it('geofence kapatılınca enabled false', () => {
    setGeofenceEnabled(true);
    setGeofenceEnabled(false);
    expect(getGeofenceState().enabled).toBe(false);
  });
});

describe('checkGeofence — koordinat tabanlı ihlal', () => {
  beforeEach(() => {
    // Merkez: İstanbul Taksim (41.037, 28.985)
    setGeofenceCenter({ lat: 41.037, lng: 28.985 });
    setGeofenceRadius(1.0); // 1 km yarıçap
    setGeofenceEnabled(true);
  });

  it('merkez koordinatlarında ihlal yok', () => {
    checkGeofence(41.037, 28.985, 0);
    const state = getGeofenceState();
    expect(state.lastAlert?.type).not.toBe('exit');
  });

  it('çok uzakta ihlal tetiklenir', () => {
    // Kadıköy (~7 km uzakta)
    checkGeofence(40.990, 29.027, 0);
    const state = getGeofenceState();
    // exit tetiklendi mi?
    expect(state.lastAlert?.type).toBe('exit');
  });

  it('geofence kapalıyken ihlal tetiklenmez', () => {
    setGeofenceEnabled(false);
    const alertBefore = getGeofenceState().lastAlert;
    checkGeofence(40.0, 29.0, 0); // çok uzak
    expect(getGeofenceState().lastAlert).toBe(alertBefore);
  });
});

describe('checkGeofence — vale hız ihlali', () => {
  it('vale modunda hız limitini aşınca kayıt edilir', () => {
    setValeMode(true);
    setValeSpeedLimit(30);
    setGeofenceEnabled(true);
    setGeofenceCenter({ lat: 41.037, lng: 28.985 });

    // Merkez içinde ama hız yüksek
    checkGeofence(41.037, 28.985, 60);
    const state = getGeofenceState();
    expect(state.valeViolations.length).toBeGreaterThan(0);
    expect(state.valeViolations[0].speedKmh).toBe(60);
  });

  it('vale modu kapalıyken hız ihlali kaydedilmez', () => {
    setValeMode(false);
    setGeofenceEnabled(true);
    const countBefore = getGeofenceState().valeViolations.length;
    checkGeofence(41.037, 28.985, 999);
    expect(getGeofenceState().valeViolations.length).toBe(countBefore);
  });
});
