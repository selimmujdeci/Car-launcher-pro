/**
 * mode22Evidence.test — PR-OBD-DATA-1.
 *
 * Kabul kriteri: Trafic/Renault için Mode-22'den EN AZ BİR gerçek manufacturer value
 * okunur VEYA fail-closed "desteklenmiyor/kanıt yok" sonucu üretilir. Bu test o kararın
 * (classifyMode22) tüm dallarını + gerçek _tick akışının sayaç/karar üretimini kilitler.
 * SAHTE değer yok: yalnız native readObdDid gerçekliği kaydedilir.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn().mockReturnValue(true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { readObdDid: vi.fn() },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));
vi.mock('../platform/safety/vinContext', () => ({ getHandshakeVin: vi.fn().mockReturnValue(null) }));

import { CarLauncher } from '../platform/nativePlugin';
import {
  classifyMode22,
  getMode22Evidence,
  loadProfile,
  watchDid,
  _internals,
} from '../platform/obd/manufacturerPidService';
import { renaultDaciaProfile } from '../platform/obd/profiles/renaultDaciaProfile';

describe('classifyMode22 — fail-closed karar (kabul kriteri)', () => {
  const B = (o: Partial<Parameters<typeof classifyMode22>[0]>) => classifyMode22({
    profileLoaded: true, watchedCount: 1, probed: 0, supported: 0, unsupported: 0, commError: 0, ...o,
  });

  it('profil yok → NO_PROFILE (kanıt yok, fail-closed)', () => {
    expect(B({ profileLoaded: false })).toBe('NO_PROFILE');
  });
  it('profil var, sorgulanmadı → NOT_PROBED', () => {
    expect(B({ probed: 0 })).toBe('NOT_PROBED');
  });
  it('en az bir gerçek değer → HAS_REAL_VALUE', () => {
    expect(B({ probed: 5, supported: 1 })).toBe('HAS_REAL_VALUE');
  });
  it('tümü 7F → ALL_UNSUPPORTED (araç desteklemiyor, fail-closed)', () => {
    expect(B({ probed: 4, supported: 0, unsupported: 4, commError: 0 })).toBe('ALL_UNSUPPORTED');
  });
  it('değer yok + iletişim hatası baskın → COMM_FAILING (KWP adresleme/flaky)', () => {
    expect(B({ probed: 6, supported: 0, unsupported: 0, commError: 6 })).toBe('COMM_FAILING');
  });
  it('karışık/eksik → INCONCLUSIVE', () => {
    expect(B({ probed: 3, supported: 0, unsupported: 0, commError: 0 })).toBe('INCONCLUSIVE');
  });
});

describe('getMode22Evidence — _tick akışı gerçek sayaç üretir', () => {
  beforeEach(() => {
    _internals.reset();
    vi.mocked(CarLauncher.readObdDid).mockReset();
  });

  it('profil yüklü değil → NO_PROFILE', () => {
    const e = getMode22Evidence();
    expect(e.profileLoaded).toBe(false);
    expect(e.decision).toBe('NO_PROFILE');
  });

  it('SUPPORTED tick → gerçek değer okunur, karar HAS_REAL_VALUE, provenance görünür', async () => {
    expect(loadProfile(renaultDaciaProfile).ok).toBe(true);
    const stop = watchDid('F190', () => {});
    // F190 = VIN (ascii): 17 bayt hex → decode string döner (NaN değil) → SUPPORTED.
    vi.mocked(CarLauncher.readObdDid).mockResolvedValue({
      supported: true, data: '5646314A5A5A5A5A5A5A5A5A5A5A5A5A5A',
    });
    await _internals.tick();
    const e = getMode22Evidence();
    expect(e.supported).toBe(1);
    expect(e.decision).toBe('HAS_REAL_VALUE');
    expect(e.lastSupportedDid).toBe('F190');
    expect(e.lastAttempts.at(-1)?.tx).toBe('7E0'); // provenance: ECU header görünür
    expect(e.lastAttempts.at(-1)?.valuePresent).toBe(true);
    expect(e.evidenceComplete).toBe(true);
    stop();
  });

  it('UNSUPPORTED (7F) tick → fail-closed, ALL_UNSUPPORTED', async () => {
    expect(loadProfile(renaultDaciaProfile).ok).toBe(true);
    const stop = watchDid('F190', () => {});
    vi.mocked(CarLauncher.readObdDid).mockResolvedValue({ supported: false, data: null });
    await _internals.tick();
    const e = getMode22Evidence();
    expect(e.unsupported).toBe(1);
    expect(e.supported).toBe(0);
    expect(e.decision).toBe('ALL_UNSUPPORTED');
    expect(e.evidenceComplete).toBe(true);
    stop();
  });

  it('COMM_ERROR (native reject — KWP adresleme) → COMM_FAILING, değer UYDURULMAZ', async () => {
    expect(loadProfile(renaultDaciaProfile).ok).toBe(true);
    const stop = watchDid('F190', () => {});
    vi.mocked(CarLauncher.readObdDid).mockRejectedValue(new Error('OBD bağlantısı yok'));
    await _internals.tick();
    const e = getMode22Evidence();
    expect(e.commError).toBe(1);
    expect(e.supported).toBe(0);
    expect(e.decision).toBe('COMM_FAILING');
    stop();
  });

  it('profil kaldırılınca kanıt sıfırlanır (yeni oturum)', async () => {
    expect(loadProfile(renaultDaciaProfile).ok).toBe(true);
    const stop = watchDid('F190', () => {});
    vi.mocked(CarLauncher.readObdDid).mockResolvedValue({ supported: false, data: null });
    await _internals.tick();
    expect(getMode22Evidence().probed).toBeGreaterThan(0);
    stop();
    _internals.reset();
    expect(getMode22Evidence().probed).toBe(0);
  });
});
