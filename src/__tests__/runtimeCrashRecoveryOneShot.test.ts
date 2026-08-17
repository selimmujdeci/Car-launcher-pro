/**
 * runtimeCrashRecoveryOneShot.test.ts — #611 KİLİT: crash-recovery YAPIŞMAZ.
 *
 * SAHA (2026-08-17, Xiaomi 23090RA98I, CİHAZDA ÖLÇÜLDÜ): telefon
 * `rt-last-mode = SAFE_MODE` ile açıldı ve KENDİ KENDİNE ÇIKAMADI. Kayıt
 * `run-as` ile elle silinene kadar her açılış SAFE_MODE'a sabitleniyordu.
 *
 * KÖK (#604(F)): `PERSIST_KEY` yalnız `_commit`te YAZILIYOR, hiçbir yerde
 * silinmiyordu; üstelik `start()` içindeki `_commit(SAFE_MODE,'crash-recovery')`
 * kaydı YENİDEN YAZIYORDU → güvenlik ağı hiç devreden çıkmıyordu.
 *
 * DOĞRU SÖZLEŞME: bir korumalı açılış yeter. Bu oturum SAFE_MODE'da başlar ama
 * işareti TÜKETİR; sonraki açılış temiz başlar. Gerçekten yine SAFE_MODE'a
 * düşülürse `_commit` kaydı yeniden yazar → koruma tekrar devreye girer.
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ (CLAUDE.md regresyon kasası).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Donanım mock'ları — BALANCED baseline ─────────────────────────────── */
const env = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high', weakGpu: false }));
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => env.tier }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => env.weakGpu, getGpuRenderer: () => '' }));

/* ── safeStorage: GERÇEK davranışı taklit eden DURUMLU mock ──────────────
   Diğer runtime testleri no-op mock kullanır (kalıcılığı KAPATMAK için);
   burada kalıcılığın TA KENDİSİ sınandığı için durum tutulmalıdır. */
const store = vi.hoisted(() => new Map<string, string>());
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:    (k: string) => (store.has(k) ? store.get(k)! : null),
  safeSetRaw:    (k: string, v: string) => { store.set(k, v); },
  safeRemoveRaw: (k: string) => { store.delete(k); },
}));

import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { makeMockWorker } from './sim/runtimeSimulator';

const KEY = 'rt-last-mode';

/** Taze bir "açılış": singleton sıfırlanır, yeni instance start() edilir. */
function bootstrap(): AdaptiveRuntimeManager {
  (globalThis as { Worker?: unknown }).Worker = class {} as unknown as typeof Worker;
  (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer = class {} as unknown;
  Object.defineProperty(globalThis, 'crossOriginIsolated', { value: true, configurable: true });
  AdaptiveRuntimeManager._resetForTest();
  const m = AdaptiveRuntimeManager.getInstance();
  m.start();
  return m;
}

beforeEach(() => {
  vi.useFakeTimers();
  store.clear();
});

afterEach(() => {
  vi.useRealTimers();
  AdaptiveRuntimeManager._resetForTest();
  store.clear();
  vi.clearAllMocks();
});

describe('#611 — crash-recovery TEK ATIMLIK', () => {
  it('güvenlik ağı ÇALIŞIR: önceki oturum SAFE_MODE ise bu açılış SAFE_MODE olur', () => {
    store.set(KEY, RuntimeMode.SAFE_MODE);
    const m = bootstrap();
    expect(m.getMode()).toBe(RuntimeMode.SAFE_MODE);
  });

  it('KAYIT TÜKETİLİR — açılıştan sonra kalıcı işaret KALMAZ', () => {
    store.set(KEY, RuntimeMode.SAFE_MODE);
    bootstrap();
    /* Eski davranışta burada hâlâ 'SAFE_MODE' yazıyordu: `_commit` kaydı
       yeniden yazıyor, hiçbir yer silmiyordu. */
    expect(store.get(KEY)).toBeUndefined();
  });

  it('SONRAKİ AÇILIŞ TEMİZ BAŞLAR — yapışkanlık yok (saha kusurunun ta kendisi)', () => {
    store.set(KEY, RuntimeMode.SAFE_MODE);
    const ilk = bootstrap();
    expect(ilk.getMode()).toBe(RuntimeMode.SAFE_MODE);

    const ikinci = bootstrap();               // ikinci açılış
    expect(ikinci.getMode()).not.toBe(RuntimeMode.SAFE_MODE);
    expect(ikinci.getMode()).toBe(RuntimeMode.BALANCED);

    const ucuncu = bootstrap();               // üçüncü de temiz kalmalı
    expect(ucuncu.getMode()).not.toBe(RuntimeMode.SAFE_MODE);
  });

  it('AĞ KAYBOLMAZ: oturum içinde gerçekten SAFE_MODE\'a düşülürse koruma TEKRAR kurulur', () => {
    store.set(KEY, RuntimeMode.SAFE_MODE);
    const m = bootstrap();
    expect(store.get(KEY)).toBeUndefined();   // tüketildi

    // Bu oturumda gerçek bir kriz (ör. memoryWatchdog) SAFE_MODE'a indirir:
    m.setMode(RuntimeMode.BALANCED, 'test:kurtarma');
    vi.advanceTimersByTime(30_000);           // upgrade histerezisi
    m.setMode(RuntimeMode.SAFE_MODE, 'Memory Pressure');

    expect(store.get(KEY)).toBe(RuntimeMode.SAFE_MODE); // işaret yeniden yazıldı
    const sonraki = bootstrap();
    expect(sonraki.getMode()).toBe(RuntimeMode.SAFE_MODE); // koruma yine devrede
  });

  it('SAFE_MODE olmayan kayıt açılışı etkilemez ve silinmez', () => {
    store.set(KEY, RuntimeMode.BASIC_JS);
    const m = bootstrap();
    expect(m.getMode()).toBe(RuntimeMode.BALANCED); // yetenekten gelir, kayıttan değil
    expect(store.get(KEY)).toBe(RuntimeMode.BASIC_JS); // dokunulmadı
  });

  it('ZOMBIE TESPİTİ crash-recovery açılışında da BAŞLAR (eski kod erken return ediyordu)', () => {
    store.set(KEY, RuntimeMode.SAFE_MODE);
    const m = bootstrap();
    expect(m.getMode()).toBe(RuntimeMode.SAFE_MODE);

    const h = makeMockWorker();
    m.registerWorker('VisionCompute', h.worker, 'OPTIONAL');
    vi.advanceTimersByTime(30_000);          // ZOMBIE_PING_INTERVAL_MS

    const pings = h.posted.filter((x) => (x as { type?: string })?.type === 'PING');
    expect(pings.length, 'zombie tespiti hiç başlamamış').toBeGreaterThan(0);
  });
});
