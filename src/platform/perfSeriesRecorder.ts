/**
 * perfSeriesRecorder — oturum boyu performans zaman serisi (tanı genişliği).
 *
 * "Rapor hikâye anlatsın" hedefinin perf boyutu: ısınma/kasma/bellek sızıntısı
 * ANLIK snapshot'ta görünmez — TREND gerekir. Bu kaydedici düşük frekansla
 * (varsayılan 12s) küçük bir HALKA TAMPONUNA örnekler:
 *   • tempC / level  — termal watchdog (gerçek termal throttle görünür)
 *   • memMb          — JS heap (yalnız Chromium; sızıntı = artan seri)
 *   • fps / maxGapMs — kısa rAF salvosu (render kadansı; throttle'da düşer)
 *   • lagMs          — ana-thread zamanlama sapması (jank vekili)
 *
 * ⚡ PERF-UYARLANABİLİR HİBRİT (CLAUDE.md): KALICI rAF YOK (boşta-render ısı
 * anti-pattern'i — bkz. idle-map-render-heat). Örnekleme aralıklı; fps salvosu
 * yalnız ~400ms sürer ve DÜŞÜK tier'da ATLANIR (yalnız termal+bellek). Örnekleme
 * tick'i ucuz; hot-path'e (3Hz hız/RPM) girmez.
 *
 * PII yok — yalnız sayısal donanım metrikleri.
 */

import { getThermalSnapshot } from './thermalWatchdog';
import { getDeviceTier } from './deviceCapabilities';

/* ── Tipler ──────────────────────────────────────────────────── */

export interface PerfSample {
  ts:       number;   // Date.now
  tempC:    number;   // termal (°C; -1 = kaynak yok)
  level:    number;   // termal seviye 0–3
  memMb:    number;   // JS heap kullanılan (MB; -1 = API yok)
  fps:      number;   // rAF kadansı (-1 = ölçülmedi/düşük tier)
  maxGapMs: number;   // salvoda en büyük kare aralığı (-1 = ölçülmedi)
  lagMs:    number;   // ana-thread zamanlama sapması (jank vekili)
  // DONMA SİNYALİ (tüm tier'lar — düşük-tier'da fps salvosu ATLANDIĞI için asıl kanıt):
  // PerformanceObserver('longtask') ile son örnekten beri ana-thread'i ≥50ms bloke
  // eden en uzun görev + adet. PASİF (rAF/polling yok) → ısı bütçesine dokunmaz.
  // Harita + gösterge birlikte donuyorsa BURADA görünür (data throttle değil, stall).
  maxLongTaskMs: number;  // -1 = longtask API yok
  longTaskCount: number;  // bu pencerede ≥50ms görev adedi
}

export interface PerfSeriesSnapshot {
  installed: boolean;
  sampleMs:  number;
  samples:   PerfSample[];
}

/* ── Modül durumu ───────────────────────────────────────────── */

const SAMPLE_MS = 12_000;   // örnekleme aralığı (düşük frekans — ısı/CPU dostu)
const MAX_SAMPLES = 40;     // ~8 dk pencere; payload'da kompakt kalır
const FPS_BURST_MS = 400;   // fps salvosu süresi (yalnız mid/high tier)

let _installed = false;
let _timer: ReturnType<typeof setInterval> | null = null;
const _samples: PerfSample[] = [];

/* ── Pasif long-task gözlemcisi (donma dedektörü) ───────────────── */
// PerformanceObserver ana-thread'i ≥50ms bloke eden görevleri raporlar. Örnek
// pencereleri arasında biriktiririz; _sample() okuyup SIFIRLAR. API yoksa -1 kalır.
let _longTaskObserver: PerformanceObserver | null = null;
let _longTaskSupported = false;
let _winMaxLongTaskMs = 0;
let _winLongTaskCount = 0;

function _installLongTaskObserver(): void {
  try {
    if (typeof PerformanceObserver === 'undefined') return;
    // Bazı WebView'lerde 'longtask' desteklenmez → observe() throw eder (fail-soft).
    _longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const dur = entry.duration;
        if (dur > _winMaxLongTaskMs) _winMaxLongTaskMs = dur;
        _winLongTaskCount++;
      }
    });
    _longTaskObserver.observe({ entryTypes: ['longtask'] });
    _longTaskSupported = true;
  } catch {
    _longTaskObserver = null;
    _longTaskSupported = false;
  }
}

/** Pencere long-task metriğini okur ve sayaçları sıfırlar (örnek başına bir kez). */
function _drainLongTask(): { maxLongTaskMs: number; longTaskCount: number } {
  if (!_longTaskSupported) return { maxLongTaskMs: -1, longTaskCount: 0 };
  const out = { maxLongTaskMs: Math.round(_winMaxLongTaskMs), longTaskCount: _winLongTaskCount };
  _winMaxLongTaskMs = 0;
  _winLongTaskCount = 0;
  return out;
}

/* ── Ölçüm yardımcıları (fail-soft) ─────────────────────────── */

function _readMemMb(): number {
  try {
    // Yalnız Chromium; standart-dışı → tip güvenli erişim.
    const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
    if (mem && typeof mem.usedJSHeapSize === 'number') {
      return Math.round(mem.usedJSHeapSize / 1_048_576);
    }
  } catch { /* fail-soft */ }
  return -1;
}

/**
 * Ana-thread zamanlama sapması: 0ms hedefli setTimeout'un gerçek gecikmesi.
 * Yüksek = ana-thread meşgul (jank). Senkron, ucuz.
 */
function _measureLagMs(): Promise<number> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    setTimeout(() => resolve(Math.max(0, Math.round(performance.now() - t0))), 0);
  });
}

/**
 * Kısa rAF salvosu → fps + en büyük kare aralığı. KALICI DEĞİL (salvo bitince
 * durur). Düşük tier'da ATLANIR (ısı/CPU tasarrufu) → {-1,-1}.
 */
function _measureFpsBurst(): Promise<{ fps: number; maxGapMs: number }> {
  return new Promise((resolve) => {
    if (getDeviceTier() === 'low' || typeof requestAnimationFrame === 'undefined') {
      resolve({ fps: -1, maxGapMs: -1 });
      return;
    }
    let frames = 0;
    let maxGap = 0;
    const t0 = performance.now();
    let prev = t0;
    const loop = (t: number): void => {
      frames++;
      const gap = t - prev;
      if (gap > maxGap) maxGap = gap;
      prev = t;
      if (t - t0 < FPS_BURST_MS) {
        requestAnimationFrame(loop);
      } else {
        const dur = t - t0;
        resolve({
          fps:      dur > 0 ? Math.round((frames * 1000) / dur) : -1,
          maxGapMs: Math.round(maxGap),
        });
      }
    };
    requestAnimationFrame(loop);
  });
}

async function _sample(): Promise<void> {
  try {
    const thermal = getThermalSnapshot();
    const memMb   = _readMemMb();
    const lagMs   = await _measureLagMs();
    const { fps, maxGapMs } = await _measureFpsBurst();
    if (!_installed) return;  // teardown sırasında çözüldü → geç örnek kaydetme (zero-leak)
    const { maxLongTaskMs, longTaskCount } = _drainLongTask();
    _samples.push({
      ts: Date.now(),
      tempC: thermal.tempC, level: thermal.level,
      memMb, fps, maxGapMs, lagMs, maxLongTaskMs, longTaskCount,
    });
    if (_samples.length > MAX_SAMPLES) _samples.shift();
  } catch { /* fail-soft — tek örnek düşse seri devam eder */ }
}

/* ── Kurulum ────────────────────────────────────────────────── */

/**
 * Perf serisini başlatır. SystemBoot Wave 1'de çağrılır. İdempotent; dönen
 * cleanup timer'ı söker (zero-leak). İlk örnek hemen alınır (boot tabanı).
 */
export function startPerfSeries(): () => void {
  if (_installed) return () => { /* zaten kurulu */ };
  _installed = true;
  _installLongTaskObserver();  // pasif donma dedektörü (boot'tan itibaren dinler)
  void _sample();  // boot tabanı
  try {
    _timer = setInterval(() => { void _sample(); }, SAMPLE_MS);
  } catch { /* fail-soft */ }

  return () => {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_longTaskObserver) {
      try { _longTaskObserver.disconnect(); } catch { /* fail-soft */ }
      _longTaskObserver = null;
    }
    _longTaskSupported = false;
    _winMaxLongTaskMs = 0;
    _winLongTaskCount = 0;
    _samples.length = 0;
    _installed = false;
  };
}

/** Tanı payload'ı için zaman serisi anlık görüntüsü (kopya). */
export function getPerfSeriesSnapshot(): PerfSeriesSnapshot {
  return { installed: _installed, sampleMs: SAMPLE_MS, samples: [..._samples] };
}

/** @internal testler için. */
export function _resetPerfSeriesForTest(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_longTaskObserver) {
    try { _longTaskObserver.disconnect(); } catch { /* fail-soft */ }
    _longTaskObserver = null;
  }
  _longTaskSupported = false;
  _winMaxLongTaskMs = 0;
  _winLongTaskCount = 0;
  _samples.length = 0;
  _installed = false;
}
