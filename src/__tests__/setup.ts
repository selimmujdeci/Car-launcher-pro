/**
 * Vitest Setup — CockpitOS Test Environment
 *
 * Test başlamadan önce çalışır. Ortak mocks ve temizlik.
 */

import { vi } from 'vitest';

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