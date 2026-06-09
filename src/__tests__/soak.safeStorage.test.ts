/**
 * soak.safeStorage.test.ts — T4 Commit 2: safeStorage write-throttle 8h endurance.
 *
 * Amaç: 8 saatlik SANAL çalışma içinde safeStorage debounce/coalescing'in eMMC
 * fiziksel yazım sayısını gerçekten sınırladığını doğrulamak (flash ömrü kritik).
 * Gerçek bekleme YOK — T4 soakHarness sanal saatiyle 8 saat milisaniyelerde koşar.
 *
 * Kurallar (CLAUDE.md):
 *   - Production/native hot-path'e DOKUNULMAZ. safeStorage yalnız mevcut public/
 *     test API'leri üzerinden sürülür (safeSetRaw / safeFlushAll / getEmmcWriteCount
 *     / resetEmmcWriteCount). Yeni production hook EKLENMEZ.
 *   - Web modu (NATIVE=false) → localStorage yolu; Filesystem mock'lanır.
 *
 * Senaryolar:
 *   1. Aynı key'e yüksek frekanslı yazım → fiziksel yazım debounce üst sınırının altında
 *   2. Çok key'li yazım → key bazlı coalescing
 *   3. Immediate vs safety vs normal yol ayrımı
 *   4. Flush sonrası bekleyen timer kalmaz + sayaç sıfırlanır
 *   5. Sanal saat ileri sıçrayınca debounce/sayaç negatif/taşma üretmez
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Capacitor mock: web modu (NATIVE=false) — mevcut safeStorage.test.ts ile aynı ── */
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    readdir:    vi.fn().mockResolvedValue({ files: [] }),
    readFile:   vi.fn().mockResolvedValue({ data: '' }),
    writeFile:  vi.fn().mockResolvedValue({}),
    deleteFile: vi.fn().mockResolvedValue({}),
    rename:     vi.fn().mockResolvedValue({}),
    stat:       vi.fn().mockResolvedValue({ size: 10 }),
  },
  Directory: { Data: 'DATA' },
  Encoding:  { UTF8: 'utf8' },
}));

import {
  safeSetRaw,
  safeFlushAll,
  getEmmcWriteCount,
  resetEmmcWriteCount,
} from '../utils/safeStorage';
import {
  startVirtualClock,
  installSoakProbes,
  runSoak,
  SECONDS,
  MINUTES,
  HOURS,
} from './sim/soakHarness';

/** safeStorage WRITE_DEBOUNCE_MS (internal sabit) — fiziksel yazım üst sınırı türetimi. */
const WRITE_DEBOUNCE_MS = 5_000;
/** safeStorage SAFETY_DEBOUNCE_MS (internal sabit). */
const SAFETY_DEBOUNCE_MS = 1_000;

beforeEach(() => {
  // Modül singleton durumunu testler arası temizle (buffer + sayaç + localStorage).
  safeFlushAll();
  resetEmmcWriteCount();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  safeFlushAll();
  localStorage.clear();
});

describe('T4 — safeStorage 8h endurance: aynı key yüksek frekanslı yazım', () => {
  it('debounce, fiziksel yazımı üst sınırın çok altında tutar (coalescing)', async () => {
    resetEmmcWriteCount();
    const WRITES_PER_STEP = 10;

    const result = await runSoak({
      durationMs: HOURS(8),
      stepMs:     SECONDS(10), // 2880 adım
      onStep: ({ index }) => {
        // Tek 10s penceresinde 10 yüksek frekanslı yazım — hepsi aynı key
        for (let i = 0; i < WRITES_PER_STEP; i++) {
          safeSetRaw('car-cache-soak', `v-${index}-${i}`);
        }
      },
      collect: () => ({ emmc: getEmmcWriteCount().count }),
    });

    const emmc       = getEmmcWriteCount().count;
    const rawWrites  = result.steps * WRITES_PER_STEP;
    // Teorik fiziksel üst sınır: 8 saat / 5s debounce = 5760 yazım.
    const physicalUpperBound = Math.ceil(HOURS(8) / WRITE_DEBOUNCE_MS);

    result.teardown();

    expect(rawWrites).toBe(28_800);                  // 2880 adım × 10 = 28.800 ham yazım
    expect(emmc).toBeLessThanOrEqual(physicalUpperBound); // ≤ 5760 (HEADLINE)
    expect(emmc).toBeLessThanOrEqual(result.steps);  // pencere başına ≤ 1 fiziksel yazım
    expect(emmc).toBeGreaterThan(0);                 // tamamen yutmadı — veri kalıcı
    // Coalescing oranı: ham yazımın en az 9 katı bastırıldı (10:1 hedefi)
    expect(rawWrites / emmc).toBeGreaterThanOrEqual(9);
  });
});

describe('T4 — safeStorage 8h endurance: çok key\'li key-bazlı coalescing', () => {
  it('her key bağımsız debounce eder; toplam yazım key sayısıyla sınırlı', async () => {
    resetEmmcWriteCount();
    const KEYS = ['car-cache-k1', 'car-cache-k2', 'car-cache-k3'];
    const WRITES_PER_KEY = 5;

    const result = await runSoak({
      durationMs: MINUTES(30),
      stepMs:     SECONDS(10), // 180 adım
      onStep: ({ index }) => {
        for (const k of KEYS) {
          for (let i = 0; i < WRITES_PER_KEY; i++) safeSetRaw(k, `${k}-${index}-${i}`);
        }
      },
      collect: () => ({ emmc: getEmmcWriteCount().count }),
    });

    const emmc      = getEmmcWriteCount().count;
    const rawWrites = result.steps * KEYS.length * WRITES_PER_KEY;

    result.teardown();

    // Pencere başına key başına ≤ 1 fiziksel yazım → toplam ≤ steps × keyCount
    expect(emmc).toBeLessThanOrEqual(result.steps * KEYS.length);
    // Key bazlı coalescing: key başına 5 yazım → 1 commit
    expect(rawWrites / emmc).toBeGreaterThanOrEqual(WRITES_PER_KEY - 1);
    expect(emmc).toBeGreaterThan(0);
  });
});

describe('T4 — safeStorage: immediate vs safety vs normal yol ayrımı', () => {
  it('immediate her yazımda diske gider; normal/safety coalesce eder (safety daha hızlı)', async () => {
    const clock = startVirtualClock();

    // ── IMMEDIATE (car-gps-last-known): 50 ardışık → 50 fiziksel yazım (1:1) ──
    resetEmmcWriteCount();
    for (let i = 0; i < 50; i++) safeSetRaw('car-gps-last-known', `{"i":${i}}`);
    expect(getEmmcWriteCount().count).toBe(50); // debounce yok

    // ── NORMAL (5s debounce): 50 ardışık → buffer'da, henüz 0 ──
    resetEmmcWriteCount();
    for (let i = 0; i < 50; i++) safeSetRaw('car-cache-batch', `v${i}`);
    expect(getEmmcWriteCount().count).toBe(0);
    await clock.advance(WRITE_DEBOUNCE_MS + 1_000); // 5s debounce + idle
    expect(getEmmcWriteCount().count).toBe(1);      // 50 → 1 coalesced

    // ── SAFETY (1s debounce): 50 ardışık → 1s sonra 1 (normalden hızlı, ama kontrollü) ──
    resetEmmcWriteCount();
    for (let i = 0; i < 50; i++) safeSetRaw('car-launcher-storage', `{"v":${i}}`);
    expect(getEmmcWriteCount().count).toBe(0);
    await clock.advance(SAFETY_DEBOUNCE_MS + 500); // 1s debounce + idle
    expect(getEmmcWriteCount().count).toBe(1);     // 50 → 1, daha kısa pencerede

    clock.restore();
  });
});

describe('T4 — safeStorage: flush sonrası bekleyen timer kalmaz', () => {
  it('safeFlushAll bekleyen debounce timer\'ını temizler ve commit eder', async () => {
    // Not: jsdom localStorage.setItem 'storage' event'ini setTimeout ile kuyruğa
    // alır → timer spy bunu da sayar. Bu nedenle commit'ten sonra advance ile o
    // event timer'ı boşaltılıp GERÇEK kalıntı ölçülür. Ölçümler önce alınıp restore
    // edilir, sonra assert edilir → bir assertion düşse bile fake-timer sızmaz.
    const clock  = startVirtualClock();
    const probes = installSoakProbes();
    resetEmmcWriteCount();

    safeSetRaw('car-cache-pending', 'x'); // 5s debounce → bekleyen timer (localStorage'a yazmaz)
    const pendingTimers = probes.timers.activeTimeouts();

    safeFlushAll();                                  // debounce timer clear + senkron commit
    const commitsAfterFlush = getEmmcWriteCount().count;

    await clock.advance(SECONDS(1));                 // jsdom storage-event timer'ını boşalt
    const leftoverTimers = probes.timers.activeTimeouts();

    resetEmmcWriteCount();
    const countAfterReset = getEmmcWriteCount().count;

    probes.restore();
    clock.restore();

    expect(pendingTimers).toBe(1);        // debounce timer beklemede
    expect(commitsAfterFlush).toBe(1);    // flush → 1 fiziksel yazım
    expect(leftoverTimers).toBe(0);       // bekleyen timer kalmadı (sızıntı yok)
    expect(countAfterReset).toBe(0);      // sayaç sıfırlandı
  });
});

describe('T4 — safeStorage: clock-jump dayanıklılığı', () => {
  it('sanal saat 8 saat ileri sıçrayınca debounce ve sayaç negatif/taşma üretmez', async () => {
    const clock = startVirtualClock();
    resetEmmcWriteCount();

    // Büyük ileri sıçrama — Date + performance birlikte ilerler (kontak aç/kapa benzeri)
    await clock.advance(HOURS(8));
    const sinceMs8h = getEmmcWriteCount().sinceMs;

    // Sıçrama sonrası debounce hâlâ doğru çalışır (setTimeout tabanlı — saat atlamasından bağımsız)
    safeSetRaw('car-cache-afterjump', 'v');
    const countBeforeDebounce = getEmmcWriteCount().count;
    await clock.advance(WRITE_DEBOUNCE_MS + 1_000);
    const countAfterDebounce = getEmmcWriteCount().count;

    // Reset sonrası sinceMs 0'dan başlar (birikim/taşma yok)
    resetEmmcWriteCount();
    const sinceMsAfterReset = getEmmcWriteCount().sinceMs;

    clock.restore();

    expect(sinceMs8h).toBe(HOURS(8));            // monotonik ileri, taşma yok
    expect(sinceMs8h).toBeGreaterThanOrEqual(0); // negatif Δ yok
    expect(countBeforeDebounce).toBe(0);         // debounce sıçramadan etkilenmedi
    expect(countAfterDebounce).toBe(1);          // 5s sonra commit
    expect(sinceMsAfterReset).toBe(0);
  });
});
