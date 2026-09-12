/**
 * bootResilienceGuard.test.ts — beklenmeyen yeniden başlatma tespiti kilitleri.
 *
 * Kapsam:
 *  - wasAbnormalRestart: saf karar tablosu (yakın/uzak heartbeat, null, clock-jump)
 *  - readLastHeartbeatMs / writeHeartbeatNow: fail-soft (bozuk değer, storage hatası)
 *  - evaluateBootResilience: okuma + karar birleşimi, gözlem alanları
 *  - startBootHeartbeat: Zero-Leak (stop() sonrası yeni yazım YOK), throttle aralığı
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const _store = new Map<string, string>();

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: vi.fn((key: string) => _store.get(key) ?? null),
  safeSetRaw: vi.fn((key: string, value: string) => { _store.set(key, value); }),
}));

import {
  wasAbnormalRestart,
  readLastHeartbeatMs,
  writeHeartbeatNow,
  evaluateBootResilience,
  startBootHeartbeat,
  ABNORMAL_RESTART_WINDOW_MS,
  HEARTBEAT_WRITE_INTERVAL_MS,
} from '../platform/system/bootResilienceGuard';
import { safeGetRaw, safeSetRaw } from '../utils/safeStorage';

beforeEach(() => {
  _store.clear();
  vi.clearAllMocks();
});

describe('bootResilienceGuard › wasAbnormalRestart (saf karar)', () => {
  it('heartbeat yok (null) → ANORMAL SAYILMAZ (ilk kurulum / eski sürüm)', () => {
    expect(wasAbnormalRestart(null, 1_000_000)).toBe(false);
  });

  it('heartbeat pencerenin İÇİNDE (1 dk önce) → ANORMAL', () => {
    const now = 1_000_000;
    expect(wasAbnormalRestart(now - 60_000, now)).toBe(true);
  });

  it('heartbeat pencerenin tam SINIRINDA → ANORMAL (kapsayıcı)', () => {
    const now = 1_000_000;
    expect(wasAbnormalRestart(now - ABNORMAL_RESTART_WINDOW_MS, now)).toBe(true);
  });

  it('heartbeat pencerenin 1ms DIŞINDA → normal (uzun kapat/aç)', () => {
    const now = 1_000_000;
    expect(wasAbnormalRestart(now - ABNORMAL_RESTART_WINDOW_MS - 1, now)).toBe(false);
  });

  it('heartbeat çok eski (saatler önce) → normal', () => {
    const now = 1_000_000;
    expect(wasAbnormalRestart(now - 8 * 60 * 60_000, now)).toBe(false);
  });

  it('saat GERİYE sıçramış (heartbeat gelecekte) → ANORMAL SAYILMAZ (clock-jump fail-soft)', () => {
    const now = 1_000_000;
    expect(wasAbnormalRestart(now + 5_000, now)).toBe(false);
  });
});

describe('bootResilienceGuard › heartbeat okuma/yazma (fail-soft)', () => {
  it('hiç yazılmamışsa null döner', () => {
    expect(readLastHeartbeatMs()).toBeNull();
  });

  it('yazılan değer birebir okunur', () => {
    writeHeartbeatNow(42_000);
    expect(readLastHeartbeatMs()).toBe(42_000);
  });

  it('bozuk (sayı olmayan) değer → null, TAHMİN EDİLMEZ', () => {
    _store.set('car-launcher-boot-heartbeat-v1', 'not-a-number');
    expect(readLastHeartbeatMs()).toBeNull();
  });

  it('sıfır/negatif değer → null (geçersiz zaman damgası)', () => {
    _store.set('car-launcher-boot-heartbeat-v1', '0');
    expect(readLastHeartbeatMs()).toBeNull();
  });

  it('safeGetRaw throw ederse null döner, dışarı sızmaz', () => {
    vi.mocked(safeGetRaw).mockImplementationOnce(() => { throw new Error('storage error'); });
    expect(readLastHeartbeatMs()).toBeNull();
  });

  it('safeSetRaw throw ederse writeHeartbeatNow sessizce yutar', () => {
    vi.mocked(safeSetRaw).mockImplementationOnce(() => { throw new Error('quota'); });
    expect(() => writeHeartbeatNow(1)).not.toThrow();
  });
});

describe('bootResilienceGuard › evaluateBootResilience (birleşik)', () => {
  it('yeni cihaz (heartbeat yok): abnormalRestart=false, heartbeatAgeMs=null', () => {
    const d = evaluateBootResilience(1_000_000);
    expect(d.abnormalRestart).toBe(false);
    expect(d.lastHeartbeatMs).toBeNull();
    expect(d.heartbeatAgeMs).toBeNull();
  });

  it('taze heartbeat: abnormalRestart=true, yaş doğru hesaplanır', () => {
    writeHeartbeatNow(1_000_000 - 30_000);
    const d = evaluateBootResilience(1_000_000);
    expect(d.abnormalRestart).toBe(true);
    expect(d.heartbeatAgeMs).toBe(30_000);
  });
});

describe('bootResilienceGuard › startBootHeartbeat (Zero-Leak + throttle)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('başlarken ANINDA bir yazım yapar (kısa oturumlar heartbeat almadan kalmasın)', () => {
    const t = 5_000;
    const stop = startBootHeartbeat({ nowMs: () => t });
    expect(readLastHeartbeatMs()).toBe(5_000);
    stop();
  });

  it(`her ${HEARTBEAT_WRITE_INTERVAL_MS}ms'te bir yazar, arada YAZMAZ`, () => {
    let t = 0;
    const stop = startBootHeartbeat({ nowMs: () => t });
    const writesAfterStart = vi.mocked(safeSetRaw).mock.calls.length;

    t = HEARTBEAT_WRITE_INTERVAL_MS / 2;
    vi.advanceTimersByTime(HEARTBEAT_WRITE_INTERVAL_MS / 2);
    expect(vi.mocked(safeSetRaw).mock.calls.length).toBe(writesAfterStart); // henüz yok

    t = HEARTBEAT_WRITE_INTERVAL_MS;
    vi.advanceTimersByTime(HEARTBEAT_WRITE_INTERVAL_MS / 2);
    expect(vi.mocked(safeSetRaw).mock.calls.length).toBe(writesAfterStart + 1);
    stop();
  });

  it('stop() sonrası ZAMANLAYICI TEMİZLENİR — yeni yazım OLMAZ', () => {
    let t = 0;
    const stop = startBootHeartbeat({ nowMs: () => t });
    const callsAtStop = vi.mocked(safeSetRaw).mock.calls.length;
    stop();

    t = HEARTBEAT_WRITE_INTERVAL_MS * 5;
    vi.advanceTimersByTime(HEARTBEAT_WRITE_INTERVAL_MS * 5);
    expect(vi.mocked(safeSetRaw).mock.calls.length).toBe(callsAtStop);
  });
});
