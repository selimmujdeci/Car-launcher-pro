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

/* Mock navigator.geolocation for GPS service tests.
 *
 * BULUNAN KUSUR (F8.1 denetimi, react-dom gerçek render testleri eklenirken):
 * eski hâli `{...globalThis.navigator}` ile TÜM navigator'ı YENİ bir düz
 * nesneyle DEĞİŞTİRİYORDU. `navigator.userAgent` (ve platform/vendor/…) jsdom'da
 * PROTOTYPE getter'ıdır — spread yalnız KENDİ enumerable alanları kopyalar, bu
 * yüzden sonuç nesnede `userAgent === undefined` kalıyordu. Bu, `navigator`ı
 * DOĞRUDAN okuyan hiçbir mevcut testi BOZMADI ama react-dom'un kök oluşturma
 * yolundaki DevTools algılaması `navigator.userAgent.indexOf(...)` çağırınca
 * `undefined.indexOf` ile SESSİZCE çöküyordu (test dosyası "0 test" toplayıp
 * anlamsız bir hatayla düşüyordu — kanıt: izole tekrar üretim).
 *
 * DÜZELTME: jsdom environment'ta GERÇEK `navigator` nesnesi zaten var —
 * onu DEĞİŞTİRMEK yerine yalnız `geolocation`'ı ÜZERİNE ekleriz (userAgent
 * ve diğer her şey AYNEN kalır). `@vitest-environment node` kullanan
 * dosyalarda (`navigator` hiç yoksa) eski sentetik nesne davranışı KORUNUR. */
if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      geolocation: {
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
        getCurrentPosition: vi.fn(),
      },
    },
    writable: true,
    configurable: true,
  });
} else {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: {
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
    writable: true,
    configurable: true,
  });

  /* `navigator.onLine` jsdom'da PROTOTYPE üzerinde YALNIZ-getter'dır — birçok
   * mevcut test doğrudan `navigator.onLine = false` ATAMASI yapar (eski
   * "navigator'ı komple değiştir" davranışında bu her zaman yazılabilirdi).
   * Gerçek nesneyi KORURKEN (userAgent için) `onLine`ı KENDİ nesnenin
   * (`instance`) YAZILABİLİR bir alanı olarak GÖLGELERİZ — prototip
   * getter'ı artık devreye girmez, testler eskisi gibi doğrudan atayabilir.
   * Varsayılan `true` — jsdom'un kendi varsayılanıyla AYNI. */
  if (!Object.prototype.hasOwnProperty.call(globalThis.navigator, 'onLine')) {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

/* ── Cleanup ───────────────────────────────────────── */

// Her test dosyasından önce çalışır
beforeEach(() => {
  // localStorage temizle
  localStorage.clear();
  sessionStorage.clear();

  /* Bazı testler kendi `afterEach`inde `delete navigator.onLine` yapıyor
   * (eski "navigator düz obje" davranışına göre yazılmış — bkz. yukarıdaki
   * F8.1 notu). Bu, yukarıda TANIMLANAN yazılabilir gölge alanı SİLER; bir
   * sonraki testin `navigator.onLine = ...` ataması prototipin salt-okunur
   * getter'ına düşüp THROW eder. Global `beforeEach` dosya-yerel
   * `beforeEach`lerden ÖNCE çalıştığı için burada YENİDEN kurmak, silinmiş
   * olsa bile her testin başında yazılabilir alanı GERİ GETİRİR. */
  if (typeof globalThis.navigator !== 'undefined'
    && !Object.prototype.hasOwnProperty.call(globalThis.navigator, 'onLine')) {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: true, writable: true, configurable: true, enumerable: true,
    });
  }
});

// afterEach'de ek cleanup gerekirse buraya ekle
afterEach(() => {
  vi.clearAllMocks();
});