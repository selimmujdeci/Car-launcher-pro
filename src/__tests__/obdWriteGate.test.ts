/**
 * OBD-OS-F0-6 — Mode 04 (DTC hafızasını sil) WriteGate.
 *
 * İKİ KATMAN kilitlenir:
 *  (1) SAF KARAR: evaluateDtcClearGate — fail-closed kapı sırası + advisory'ler.
 *  (2) ZORLAMA: dtcService.clearDTCCodes kapıyı GERÇEKTEN uyguluyor mu — yani
 *      reddedilen durumda native CarLauncher.clearDTC() ÇAĞRILMIYOR mu.
 *      (1) doğru ama (2) yoksa kapı dekoratiftir; asıl güvenlik (2)'dedir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  evaluateDtcClearGate,
  WRITE_GATE_MAX_DATA_AGE_MS,
  WRITE_GATE_STOPPED_SPEED_KMH,
  type WriteGateContext,
} from '../platform/obd/writeGate';

/* ── Ortak kanıt tabanı: araç bağlı, duruyor, veri taze, kullanıcı onayladı ── */
const NOW = 1_700_000_000_000;
const OK: WriteGateContext = {
  connectionState: 'connected',
  speedKmh:        0,
  rpm:             0,
  lastSeenMs:      NOW - 500,
  nowMs:           NOW,
  confirmed:       true,
};

describe('OBD-OS-F0-6 · evaluateDtcClearGate (saf karar)', () => {
  it('tüm kapılar geçildiğinde İZİN VERİR', () => {
    const d = evaluateDtcClearGate(OK);
    expect(d.allowed).toBe(true);
  });

  it('KİLİT: araç HAREKET HALİNDE iken REDDEDER (F0-6 birincil güvenlik kapısı)', () => {
    const d = evaluateDtcClearGate({ ...OK, speedKmh: 42 });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('vehicle_moving');
    expect(d.userMessage).toMatch(/hareket halinde/i);
  });

  it('eşik: 1 km/h ve üstü "hareket", altı "duruyor" (el freni gürültüsüne pay)', () => {
    expect(evaluateDtcClearGate({ ...OK, speedKmh: WRITE_GATE_STOPPED_SPEED_KMH }).allowed).toBe(false);
    expect(evaluateDtcClearGate({ ...OK, speedKmh: 0.4 }).allowed).toBe(true);
  });

  it('FAIL-CLOSED: hız BİLİNMİYOR (-1/NaN) → "sıfır" SAYILMAZ, reddedilir', () => {
    const neg = evaluateDtcClearGate({ ...OK, speedKmh: -1 });
    expect(neg.allowed).toBe(false);
    if (!neg.allowed) expect(neg.reason).toBe('speed_unknown');

    const nan = evaluateDtcClearGate({ ...OK, speedKmh: Number.NaN });
    expect(nan.allowed).toBe(false);
    if (!nan.allowed) expect(nan.reason).toBe('speed_unknown');
  });

  it('FAIL-CLOSED: telemetri BAYAT → "hız 0" iddiası kanıt sayılmaz (sahte güven yok)', () => {
    const d = evaluateDtcClearGate({ ...OK, lastSeenMs: NOW - (WRITE_GATE_MAX_DATA_AGE_MS + 1) });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('stale_data');
  });

  it('FAIL-CLOSED: hiç veri gelmemiş (lastSeenMs=0) → reddedilir', () => {
    const d = evaluateDtcClearGate({ ...OK, lastSeenMs: 0 });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('stale_data');
  });

  it('bağlantı yoksa reddedilir (en temel önkoşul, hız kapısından ÖNCE)', () => {
    const d = evaluateDtcClearGate({ ...OK, connectionState: 'reconnecting', speedKmh: 90 });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('not_connected');   // hız değil, bağlantı raporlanır
  });

  it('açık onay YOKSA reddedilir (yıkıcı eylem tek tıkla tetiklenemez)', () => {
    const d = evaluateDtcClearGate({ ...OK, confirmed: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('not_confirmed');
  });

  it('motor çalışıyor → BLOKLAMAZ ama advisory üretir (8-kapı: anlam üret)', () => {
    const d = evaluateDtcClearGate({ ...OK, rpm: 850 });
    expect(d.allowed).toBe(true);
    expect(d.advisories).toContain('engine_running');
  });

  it('RPM bilinmiyor (-1/EV) → advisory UYDURULMAZ', () => {
    const d = evaluateDtcClearGate({ ...OK, rpm: -1 });
    expect(d.allowed).toBe(true);
    expect(d.advisories).toHaveLength(0);
  });

  it('hareket halinde REDDEDİLİRKEN de advisory taşınır (bilgi kaybolmaz)', () => {
    const d = evaluateDtcClearGate({ ...OK, speedKmh: 60, rpm: 2400 });
    expect(d.allowed).toBe(false);
    expect(d.advisories).toContain('engine_running');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ZORLAMA KİLİDİ — kapı dekoratif değil: reddedilince native'e GİTMİYOR.
═══════════════════════════════════════════════════════════════════════════ */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    clearDTC: vi.fn(async () => undefined),
    readDTC:  vi.fn(async () => ({ codes: [] })),
  },
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: vi.fn(),
}));

import { CarLauncher } from '../platform/nativePlugin';
import { getOBDDataSnapshot } from '../platform/obdService';
import { clearDTCCodes, readDTCCodes } from '../platform/dtcService';

/** OBD servisinin döndüreceği anlık veri — testler bunu araç durumu olarak kurar. */
function mockObd(over: { speed?: number; rpm?: number; connectionState?: string; lastSeenMs?: number }): void {
  vi.mocked(getOBDDataSnapshot).mockReturnValue({
    connectionState: over.connectionState ?? 'connected',
    speed:      over.speed ?? 0,
    rpm:        over.rpm ?? 0,
    lastSeenMs: over.lastSeenMs ?? Date.now(),
  } as ReturnType<typeof getOBDDataSnapshot>);
}

describe('OBD-OS-F0-6 · clearDTCCodes kapıyı ZORLAR (native yazma engellenir)', () => {
  beforeEach(async () => {
    vi.mocked(CarLauncher.clearDTC).mockClear();
    // Silinecek bir kod OLMALI — aksi halde fonksiyon kapıya gelmeden çıkar.
    // State'i GERÇEK okuma yolundan doldururuz (üretim koduna test-only kapı açmayız).
    vi.mocked(CarLauncher.readDTC).mockResolvedValue({ codes: ['P0301'] });
    await readDTCCodes();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('🔒 KİLİT: araç 42 km/h → native clearDTC ÇAĞRILMAZ, kodlar KORUNUR', async () => {
    mockObd({ speed: 42 });
    const d = await clearDTCCodes({ confirmed: true });

    expect(CarLauncher.clearDTC).not.toHaveBeenCalled();   // ← asıl güvenlik kilidi
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('vehicle_moving');
  });

  it('🔒 KİLİT: onay YOKSA (confirmed:false) native clearDTC ÇAĞRILMAZ', async () => {
    mockObd({ speed: 0 });
    const d = await clearDTCCodes({ confirmed: false });

    expect(CarLauncher.clearDTC).not.toHaveBeenCalled();
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('not_confirmed');
  });

  it('🔒 KİLİT: telemetri bayat → native clearDTC ÇAĞRILMAZ (hız 0 görünse bile)', async () => {
    mockObd({ speed: 0, lastSeenMs: Date.now() - 60_000 });
    const d = await clearDTCCodes({ confirmed: true });

    expect(CarLauncher.clearDTC).not.toHaveBeenCalled();
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('stale_data');
  });

  it('araç duruyor + taze veri + onay → native clearDTC ÇAĞRILIR (kapı geçirgen)', async () => {
    vi.useFakeTimers();
    mockObd({ speed: 0, rpm: 0, lastSeenMs: Date.now() });
    const p = clearDTCCodes({ confirmed: true });
    await vi.advanceTimersByTimeAsync(2_500);   // servis içi onay gecikmesi
    const d = await p;

    expect(CarLauncher.clearDTC).toHaveBeenCalledTimes(1);
    expect(d.allowed).toBe(true);
  });
});
