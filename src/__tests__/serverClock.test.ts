/**
 * serverClock.test.ts — MRI N-7: sunucu saati gözlemi (yerel saat uydurulmaz).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseServerDateOffset, observeServerDate, getServerNowMs, getServerClockSnapshot,
  resetServerClockForTest, SERVER_CLOCK_MAX_AGE_MS,
} from '../platform/serverClock';

describe('serverClock', () => {
  beforeEach(() => resetServerClockForTest());

  it('gözlem yokken null — sahte sunucu saati yok', () => {
    expect(getServerNowMs(1_000)).toBeNull();
    expect(getServerClockSnapshot(1_000)).toEqual({ offsetMs: null, ageMs: null, source: null });
  });

  it('Date başlığı offset\'e çevrilir; bozuk başlık yok sayılır', () => {
    const local = Date.parse('2026-09-19T12:00:00Z');
    expect(parseServerDateOffset('Sat, 19 Sep 2026 12:03:00 GMT', local)).toBe(3 * 60_000);
    expect(parseServerDateOffset('garbage', local)).toBeNull();
    expect(parseServerDateOffset(null, local)).toBeNull();
    observeServerDate('garbage', 'rpc:x', local);
    expect(getServerNowMs(local)).toBeNull();
  });

  it('head-unit 3 dk geride: sunucu saati tahmini = yerel + offset', () => {
    const local = Date.parse('2026-09-19T12:00:00Z');
    observeServerDate('Sat, 19 Sep 2026 12:03:00 GMT', 'rpc:fetch_pending_vehicle_commands', local);
    expect(getServerNowMs(local + 15_000)).toBe(local + 15_000 + 3 * 60_000);
    expect(getServerClockSnapshot(local + 15_000)).toEqual({ offsetMs: 3 * 60_000, ageMs: 15_000, source: 'rpc:fetch_pending_vehicle_commands' });
  });

  it('gözlem bayatlayınca null (fail-closed → çağıran yerel saate düşer)', () => {
    const local = 1_000_000_000;
    observeServerDate(new Date(local + 5_000).toUTCString(), 'rpc:x', local);
    expect(getServerNowMs(local + SERVER_CLOCK_MAX_AGE_MS)).not.toBeNull();
    expect(getServerNowMs(local + SERVER_CLOCK_MAX_AGE_MS + 1)).toBeNull();
    expect(getServerNowMs(local - 1)).toBeNull();   // yerel saat geriye gittiyse
  });
});
