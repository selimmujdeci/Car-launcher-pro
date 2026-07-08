/**
 * Vitest Setup — CockpitOS Test Environment
 *
 * Test başlamadan önce çalışır. Ortak mocks ve temizlik.
 */

import { vi } from 'vitest';

/* ── Deterministik timezone ────────────────────────────
 * sunTimes gibi YEREL-saat testleri İstanbul varsayar; CI UTC'de kosunca
 * düşüyordu ("expected 151 to be greater than 295"). İstanbul'a pinlenir
 * (kabuk TZ=UTC altında bile override eder — doğrulandı).
 * NOT: WebCrypto realm sorunu (keyBeam ve expertTrust: "Failed to execute
 * 'importKey'... not instance of ArrayBuffer") jsdom'un SubtleCrypto wrapper'ından
 * kaynaklanıyor; o testler `// @vitest-environment node` ile Node realm'de koşar
 * (jsdom crypto hiç devreye girmez). Bu setup her iki environment'ta çalışır.
 */
process.env.TZ = 'Europe/Istanbul';

/* ── node environment localStorage shim ────────────────
 * `@vitest-environment node` kullanan test dosyalarında (keyBeam*, expertTrust)
 * jsdom yok → localStorage tanımsız. Minimal in-memory shim: hem SUT'un
 * (expertTrustSeal localStorage) hem aşağıdaki beforeEach temizliğinin çalışması
 * için. jsdom environment'ta localStorage zaten var → shim atlanır. */
if (typeof globalThis.localStorage === 'undefined') {
  const makeStore = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, String(v)); },
      removeItem: (k: string) => { m.delete(k); },
      clear: () => { m.clear(); },
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    } as Storage;
  };
  Object.defineProperty(globalThis, 'localStorage',   { value: makeStore(), writable: true, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: makeStore(), writable: true, configurable: true });
}

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