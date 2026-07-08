/**
 * Vitest Setup — CockpitOS Test Environment
 *
 * Test başlamadan önce çalışır. Ortak mocks ve temizlik.
 */

import { vi } from 'vitest';
import { webcrypto } from 'node:crypto';

/* ── Deterministik ortam: timezone + WebCrypto ─────────
 * CI (Linux/UTC) ile yerel (Windows/İstanbul) farkını kapatır; ikisinde de
 * aynı sonuç:
 *  - TZ: sunTimes gibi YEREL-saat testleri İstanbul varsayar. UTC'de düşüyordu
 *    ("expected 151 to be greater than 295"). İstanbul'a pinlenir.
 *  - crypto: jsdom'un SubtleCrypto'su cross-realm ArrayBuffer'ı reddediyor
 *    ("Failed to execute 'importKey' on 'SubtleCrypto': ... not instance of
 *    ArrayBuffer"); Node webcrypto tutarlı realm kullanır → keyBeam/expertTrust
 *    round-trip'leri her ortamda geçer. (Yerelde zaten geçiyordu — no-op/uyumlu.)
 */
process.env.TZ = 'Europe/Istanbul';
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
  writable: true,
});

/* ── Global mocks ─────────────────────────────────── */

// CSS mock — component render hatalarını önle
vi.mock('*.css', () => ({}));

/* ── Environment vars ──────────────────────────────── */

// Vite env vars mock
Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: true,
    PROD: false,
    MODE: 'test',
    VITE_ENABLE_OBD_MOCK: 'true',
  },
  writable: true,
});

/* ── Navigator geolocation mock ──────────────────────── */

// Mock navigator.geolocation for GPS service tests
Object.defineProperty(globalThis, 'navigator', {
  value: {
    ...globalThis.navigator,
    geolocation: {
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  },
  writable: true,
  configurable: true,
});

/* ── Cleanup ───────────────────────────────────────── */

// Her test dosyasından önce çalışır
beforeEach(() => {
  // localStorage temizle
  localStorage.clear();
  sessionStorage.clear();
});

// afterEach'de ek cleanup gerekirse buraya ekle
afterEach(() => {
  vi.clearAllMocks();
});