/**
 * carosLabSttMeasurement.test.tsx — CAROS LAB · Kabin Gürültü Ölçüm Defteri
 * KİLİTLERİ (MAVI-STT-LAB-2).
 *
 * ANA İLKELER:
 *  1. **ÖLÇÜM YALNIZ KULLANICI KOMUTUYLA** başlar; otomatik kayıt YOKTUR.
 *  2. **ARAÇSIZ TEST EDİLEBİLİR:** saat, timer ve örnek kaynağı ENJEKTE edilir;
 *     fixture'lar YALNIZ bu dosyada yaşar (üretim paketine girmez).
 *  3. **UYDURMA YOK:** kaynak yoksa sahte ölçüm üretilmez; `-1`/NaN/Infinity
 *     istatistiğe girmez ama GERÇEK `0` korunur; bilinmeyen hız `0`a çevrilmez.
 *  4. **KARAR ÜRETİLMEZ:** karşılaştırma yalnız sayısal farktır — öneri veya
 *     nedensellik iddiası YOKTUR.
 *  5. **GİZLİLİK YAPISAL:** transcript · n-best · wake sözcüğü · grammar kelimesi ·
 *     ham ses hiçbir kayda, snapshot'a veya markup'a giremez.
 *  6. Defter BOUNDED; ekran kapanınca ölçüm ölür, timer temizlenir.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  sampleFromSnapshot, finalizeMeasurement, computeNumericStats, ratio,
  appendMeasurement, removeMeasurement, compareMeasurements, isLedgerEligible,
  sanitizeMeasurementRecord, sanitizeLedger,
  STT_LEDGER_MAX, STT_SAMPLE_INTERVAL_MS, STT_DURATION_OPTIONS_S,
  STT_CONDITION_IDS, STT_MAX_SAMPLES_PER_MEASUREMENT, STT_LEDGER_STORAGE_KEY,
  isSttConditionId,
  type SttMeasurementRecord, type SttConditionId,
} from '../platform/devtools/sttMeasurementModel';
import {
  createSttMeasurementRunner, isValidTargetMs, STT_DEFAULT_DURATION_MS,
  type SttRunnerState,
} from '../platform/devtools/sttMeasurementRunner';
import {
  saveMeasurementLedger, loadMeasurementLedger, clearMeasurementLedgerStorage,
} from '../platform/devtools/sttMeasurementStore';
import { percentileNearestRank, type SttMicRaw } from '../platform/devtools/sttMicModel';
import { SttMeasurementSection } from '../components/devtools/screens/SttMeasurementSection';
import { SttMicScreen } from '../components/devtools/screens/SttMicScreen';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE'LAR — YALNIZ BU DOSYADA (üretim paketine GİRMEZ)
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

/** Bunlar hiçbir kayda, snapshot'a veya markup'a giremez. */
const SECRET_TRANSCRIPT = 'klimayı kıs ve Ayşe Yıldırım\'ı ara';
const SECRET_WAKE       = 'hey mavi kaptan';

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function readSrc(...p: string[]): string {
  return readFileSync(join(process.cwd(), ...p), 'utf8');
}

const SECTION_PATH = ['src', 'components', 'devtools', 'screens', 'SttMeasurementSection.tsx'];
const RUNNER_PATH  = ['src', 'platform', 'devtools', 'sttMeasurementRunner.ts'];
const MODEL_PATH   = ['src', 'platform', 'devtools', 'sttMeasurementModel.ts'];
const STORE_PATH   = ['src', 'platform', 'devtools', 'sttMeasurementStore.ts'];

interface SnapOver {
  present?: boolean;
  rms?: number; noiseFloor?: number; threshold?: number; speech?: boolean;
  speedKmh?: number | null; motionState?: string;
  sourceName?: string; grammarType?: string;
  nsEnabled?: boolean; vadPresent?: boolean;
  wakeActive?: boolean; recognizerActive?: boolean;
}

/** Tek bir STT-LAB-1 gözlemi üretir (araçsız test için). */
function snap(o: SnapOver = {}): SttMicRaw {
  const present = o.present !== false;
  if (!present) {
    return {
      readAt: NOW, present: false, schemaVersion: null, capturedAt: null,
      path: 'NONE', sessionActive: false, sessionStartedAt: null,
      source: null, effects: null, vad: null, stt: null,
      vehicle: { speedKmh: o.speedKmh ?? null, motionState: o.motionState ?? 'unknown', hvacFanLevel: null, sampledAt: NOW },
      js: null,
    };
  }
  return {
    readAt: NOW, present: true, schemaVersion: 1, capturedAt: NOW - 200,
    path: 'ACTIVE_LISTEN', sessionActive: true, sessionStartedAt: NOW - 5_000,
    source: {
      selectedSource: 1, selectedSourceName: o.sourceName ?? 'MIC',
      sampleRate: 16000, channelCount: 1, bufferBytes: 16000, frameSamples: 8000,
      attempts: [],
    },
    effects: {
      probed: true,
      aecAvailable: true, aecCreated: true, aecEnabled: true,
      nsAvailable: true,  nsCreated: true,  nsEnabled: o.nsEnabled !== false,
      agcAvailable: true, agcCreated: true, agcEnabled: true,
      errors: [],
    },
    vad: {
      present: o.vadPresent !== false,
      lastRms: o.rms ?? 0.04,
      noiseFloor: o.noiseFloor ?? 0.012,
      effectiveThreshold: o.threshold ?? 0.0228,
      staticMinThreshold: 0.010, floorFactor: 1.9,
      speechDetected: o.speech === true,
      lastAudioAtMs: 1000, monotonicNowMs: 1200, sampleCount: 8, samples: [0.01, 0.02],
    },
    stt: {
      wakeEngineActive: o.wakeActive === true,
      activeRecognizerActive: o.recognizerActive !== false,
      grammarType: o.grammarType ?? 'static_command',
      grammarWordCount: 214,
      lastResultCategory: 'success', lastResultAt: NOW - 500,
    },
    vehicle: {
      speedKmh: o.speedKmh === undefined ? 0 : o.speedKmh,
      motionState: o.motionState ?? 'stopped',
      hvacFanLevel: null, sampledAt: NOW,
    },
    js: {
      wakeEnabled: true, wakeStatus: 'listening', wakePhraseCount: 2,
      voiceStatus: 'idle', micAvailable: true, commandGrammarWordCount: 214,
    },
  };
}

/** Park / motor kapalı — sessiz kabin, düşük taban, hız 0 GERÇEK. */
const FIXTURE_PARK: readonly SttMicRaw[] = Object.freeze([
  snap({ rms: 0.006, noiseFloor: 0.0050, threshold: 0.0100, speedKmh: 0, motionState: 'stopped' }),
  snap({ rms: 0.000, noiseFloor: 0.0050, threshold: 0.0100, speedKmh: 0, motionState: 'stopped' }),
  snap({ rms: 0.008, noiseFloor: 0.0052, threshold: 0.0100, speedKmh: 0, motionState: 'stopped' }),
  snap({ rms: 0.007, noiseFloor: 0.0051, threshold: 0.0100, speedKmh: 0, motionState: 'stopped' }),
]);

/** Şehir içi ~50 km/s — taban yükselir, eşik taban×1.9'a taşar. */
const FIXTURE_CITY50: readonly SttMicRaw[] = Object.freeze([
  snap({ rms: 0.031, noiseFloor: 0.0160, threshold: 0.0304, speedKmh: 49.5, motionState: 'moving' }),
  snap({ rms: 0.034, noiseFloor: 0.0162, threshold: 0.0308, speedKmh: 50.2, motionState: 'moving', speech: true }),
  snap({ rms: 0.029, noiseFloor: 0.0158, threshold: 0.0300, speedKmh: 51.0, motionState: 'moving' }),
  snap({ rms: 0.036, noiseFloor: 0.0165, threshold: 0.0314, speedKmh: 50.8, motionState: 'moving', speech: true }),
]);

/** Otoyol ~110 km/s — taban ve eşik belirgin yükselir. */
const FIXTURE_HWY110: readonly SttMicRaw[] = Object.freeze([
  snap({ rms: 0.062, noiseFloor: 0.0340, threshold: 0.0646, speedKmh: 108.0, motionState: 'moving' }),
  snap({ rms: 0.068, noiseFloor: 0.0352, threshold: 0.0669, speedKmh: 110.5, motionState: 'moving', speech: true }),
  snap({ rms: 0.059, noiseFloor: 0.0336, threshold: 0.0638, speedKmh: 111.2, motionState: 'moving' }),
  snap({ rms: 0.071, noiseFloor: 0.0358, threshold: 0.0680, speedKmh: 109.4, motionState: 'moving', speech: true }),
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Koşucu test tezgâhı — GERÇEK ZAMAN BEKLENMEZ
 * ════════════════════════════════════════════════════════════════════════ */

function harness(source: readonly SttMicRaw[] | (() => SttMicRaw)) {
  let mono = 0;
  let wall = NOW;
  let tick: (() => void) | null = null;
  let intervalMs = -1;
  let timersSet = 0;
  let timersCleared = 0;
  let i = 0;
  const finalized: SttMeasurementRecord[] = [];
  const states: SttRunnerState[] = [];

  const next = (): SttMicRaw =>
    typeof source === 'function' ? source() : source[i++ % source.length]!;

  const runner = createSttMeasurementRunner({
    sampleOnce: next,                       // SENKRON → tam deterministik
    nowWall: () => wall,
    nowMono: () => mono,
    setTimer: (fn, ms) => { tick = fn; intervalMs = ms; timersSet++; return 42; },
    clearTimer: () => { timersCleared++; tick = null; },
    onFinalized: (r) => finalized.push(r),
  });

  return {
    runner, finalized, states,
    get intervalMs() { return intervalMs; },
    get timersSet() { return timersSet; },
    get timersCleared() { return timersCleared; },
    listen: () => runner.subscribe((s) => { states.push(s); }),
    /** Zamanı ilerlet ve (varsa) tik'i tetikle — gerçek `setInterval` gibi. */
    advance(ms: number) { mono += ms; wall += ms; if (tick) tick(); },
    /** Hedef süre boyunca tikleri koştur. */
    run(targetMs: number) {
      const n = Math.ceil(targetMs / STT_SAMPLE_INTERVAL_MS);
      for (let k = 0; k < n; k++) this.advance(STT_SAMPLE_INTERVAL_MS);
    },
  };
}

function record(over: Partial<SttMeasurementRecord> = {}): SttMeasurementRecord {
  const base = finalizeMeasurement({
    measurementId: 'M-BASE',
    conditionId: 'park_motor_kapali',
    startedAt: NOW, elapsedMs: 10_000, targetMs: 10_000,
    samples: FIXTURE_PARK.map(sampleFromSnapshot),
    cancelled: false,
  });
  return { ...base, ...over };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1-8 — Koşucu ve yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-2 · 1-8. koşucu ve yaşam döngüsü', () => {
  it('1. ölçüm YALNIZ kullanıcı komutuyla başlar (kendiliğinden timer kurulmaz)', () => {
    const h = harness(FIXTURE_PARK);
    expect(h.runner.getState().running).toBe(false);
    expect(h.timersSet).toBe(0);
    expect(h.finalized).toHaveLength(0);

    // Zaman ilerlese bile hiçbir şey olmaz — otomatik kayıt YOK.
    h.advance(60_000);
    expect(h.runner.getState().samplesTaken).toBe(0);
    expect(h.finalized).toHaveLength(0);

    expect(h.runner.start('park_motor_kapali', 5_000)).toBe(true);
    expect(h.runner.getState().running).toBe(true);
    expect(h.timersSet).toBe(1);
  });

  it('1b. geçersiz koşul veya geçersiz süre ölçüm BAŞLATMAZ', () => {
    const h = harness(FIXTURE_PARK);
    expect(h.runner.start('uydurma' as SttConditionId, 5_000)).toBe(false);
    expect(h.runner.start('park_motor_kapali', 7_000)).toBe(false); // listede yok
    expect(h.runner.start('park_motor_kapali', 0)).toBe(false);
    expect(h.timersSet).toBe(0);
    expect(isValidTargetMs(10_000)).toBe(true);
    expect(isValidTargetMs(7_000)).toBe(false);
  });

  it('2. aynı anda İKİNCİ ölçüm başlayamaz', () => {
    const h = harness(FIXTURE_PARK);
    expect(h.runner.start('rolanti', 10_000)).toBe(true);
    expect(h.runner.start('otoyol_100_110', 5_000)).toBe(false);
    // İlk ölçümün koşulu DEĞİŞMEDİ (ikinci istek durumu kirletmedi).
    expect(h.runner.getState().conditionId).toBe('rolanti');
    expect(h.timersSet).toBe(1);
  });

  it('3. 5/10/20/30 sn süreleri doğru çalışır ve hedef kayda yazılır', () => {
    for (const s of STT_DURATION_OPTIONS_S) {
      const h = harness(FIXTURE_PARK);
      h.runner.start('park_motor_kapali', s * 1000);
      h.run(s * 1000);
      expect(h.finalized).toHaveLength(1);
      const rec = h.finalized[0]!;
      expect(rec.targetMs).toBe(s * 1000);
      expect(rec.elapsedMs).toBe(s * 1000);
      expect(rec.outcome).toBe('complete');
      // t=0 örneği + her 500ms bir örnek.
      expect(rec.samplesTaken).toBe(s * 1000 / STT_SAMPLE_INTERVAL_MS + 1);
    }
    expect(STT_DEFAULT_DURATION_MS).toBe(10_000);
  });

  it('4. örnekleme aralığı TABANIN altına inmez (≥500ms)', () => {
    const h = harness(FIXTURE_PARK);
    h.runner.start('park_motor_kapali', 5_000);
    expect(h.intervalMs).toBe(STT_SAMPLE_INTERVAL_MS);
    expect(STT_SAMPLE_INTERVAL_MS).toBeGreaterThanOrEqual(500);
    // Koşucu kaynağında başka bir aralık sabiti YOK.
    expect(stripComments(readSrc(...RUNNER_PATH)))
      .toMatch(/setTimer\(takeSample, STT_SAMPLE_INTERVAL_MS\)/);
  });

  it('4b. örnek uçuşta iken gelen tik ATLANIR ve dürüstçe sayılır', () => {
    let resolve!: (v: SttMicRaw) => void;
    const h = harness(() => new Promise<SttMicRaw>((r) => { resolve = r; }) as unknown as SttMicRaw);
    h.runner.start('park_motor_kapali', 5_000);
    h.advance(500);
    h.advance(500);
    expect(h.runner.getState().skippedTicks).toBeGreaterThan(0);
    expect(h.runner.getState().samplesTaken).toBe(0); // sahte örnek ÜRETİLMEDİ
    resolve(snap());
  });

  it('5. süre sonunda TEK özet kayıt oluşur (tekrar tik kayıt üretmez)', () => {
    const h = harness(FIXTURE_PARK);
    h.runner.start('park_motor_kapali', 5_000);
    h.run(5_000);
    expect(h.finalized).toHaveLength(1);
    h.advance(5_000);
    h.advance(5_000);
    expect(h.finalized).toHaveLength(1);
    expect(h.runner.getState().running).toBe(false);
  });

  it('6. SÖZLEŞME: iptal edilen ölçüm `cancelled` üretilir ama DEFTERE YAZILMAZ', () => {
    const h = harness(FIXTURE_PARK);
    h.runner.start('sehir_ici_50', 10_000);
    h.run(2_000);
    const rec = h.runner.cancel();
    expect(rec).not.toBeNull();
    expect(rec!.outcome).toBe('cancelled');
    expect(rec!.reasonCode).toBe('USER_CANCELLED');
    expect(rec!.elapsedMs).toBeLessThan(10_000);

    // Kullanıcı sonucu GÖRÜR (son ölçüm), ama defter kabul ETMEZ.
    expect(h.runner.getState().lastRecord?.outcome).toBe('cancelled');
    expect(isLedgerEligible(rec!)).toBe(false);
    expect(appendMeasurement([], rec!)).toHaveLength(0);

    // İptal sonrası yeni ölçüm başlatılabilir.
    expect(h.runner.start('rolanti', 5_000)).toBe(true);
  });

  it('6b. `source_lost` DEFTERE YAZILIR (tam süre koştu — gerçek saha bulgusu)', () => {
    const lost = record({ measurementId: 'M-LOST', outcome: 'source_lost', reasonCode: 'SOURCE_LOST_NO_EVIDENCE' });
    expect(isLedgerEligible(lost)).toBe(true);
    expect(appendMeasurement([], lost)).toHaveLength(1);
  });

  it('7. `dispose()` aktif ölçümü güvenle iptal eder ve timer\'ı TEMİZLER', () => {
    const h = harness(FIXTURE_PARK);
    h.runner.start('park_motor_kapali', 30_000);
    h.run(1_000);
    expect(h.timersCleared).toBe(0);

    h.runner.dispose();
    expect(h.timersCleared).toBe(1);
    expect(h.runner.getState().running).toBe(false);
    // Ekran kapandı → onFinalized ÇAĞRILMAZ (bileşen artık yok).
    expect(h.finalized).toHaveLength(0);
    // Dispose sonrası yeni ölçüm BAŞLAMAZ (arka planda ölçüm imkânsız).
    expect(h.runner.start('rolanti', 5_000)).toBe(false);
  });

  it('8. dispose sonrası abone HİÇ çağrılmaz (unmount sonrası setState imkânsız)', () => {
    const h = harness(FIXTURE_PARK);
    h.listen();
    h.runner.start('park_motor_kapali', 10_000);
    const before = h.states.length;
    expect(before).toBeGreaterThan(0);

    h.runner.dispose();
    const after = h.states.length;
    h.advance(10_000);
    h.runner.cancel();
    expect(h.states.length).toBe(after);

    // Bileşen tarafında da mountedRef kapısı var.
    const src = stripComments(readSrc(...SECTION_PATH));
    expect(src).toMatch(/mountedRef\.current = false/);
    expect(src).toMatch(/if \(mountedRef\.current\) setRunner\(s\)/);
    expect(src).toMatch(/r\.dispose\(\)/);
  });

  it('8b. koşucuda MODÜL SEVİYESİ DURUM ve gerçek saat/timer YOK (fabrika deseni)', () => {
    const src = stripComments(readSrc(...RUNNER_PATH));
    expect(src).not.toMatch(/\bDate\.now\(\)|\bMath\.random\(\)|\bsetInterval\(|\bsetTimeout\(/);
    // İki koşucu birbirinden BAĞIMSIZ (paylaşılan singleton yok).
    const a = harness(FIXTURE_PARK); const b = harness(FIXTURE_CITY50);
    a.runner.start('park_motor_kapali', 5_000);
    expect(b.runner.getState().running).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9-13 — İstatistik doğruluğu
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-2 · 9-13. istatistik', () => {
  it('9. RMS / noise floor / threshold istatistikleri doğru hesaplanır', () => {
    const samples = FIXTURE_CITY50.map(sampleFromSnapshot);
    const rec = finalizeMeasurement({
      measurementId: 'M1', conditionId: 'sehir_ici_50',
      startedAt: NOW, elapsedMs: 10_000, targetMs: 10_000, samples, cancelled: false,
    });
    expect(rec.rms!.count).toBe(4);
    expect(rec.rms!.min).toBeCloseTo(0.029, 6);
    expect(rec.rms!.max).toBeCloseTo(0.036, 6);
    expect(rec.rms!.avg).toBeCloseTo((0.031 + 0.034 + 0.029 + 0.036) / 4, 6);
    expect(rec.noiseFloor!.min).toBeCloseTo(0.0158, 6);
    expect(rec.threshold!.max).toBeCloseTo(0.0314, 6);
    // 4 örneğin 2'sinde konuşma → 0.5
    expect(rec.speechDetectedRatio).toBeCloseTo(0.5, 6);
    expect(rec.samplesValid).toBe(4);
    expect(rec.missingSourceCount).toBe(0);
    expect(rec.reasonCode).toBe('COMPLETED');
  });

  it('10. p50 ve p95 DETERMİNİSTİKtir ve gerçekten ölçülmüş bir örnektir', () => {
    const vals = [0.5, 0.1, 0.4, 0.2, 0.3];
    const first = computeNumericStats(vals)!;
    for (let i = 0; i < 50; i++) {
      const again = computeNumericStats(vals.slice())!;
      expect(again.p50).toBe(first.p50);
      expect(again.p95).toBe(first.p95);
    }
    expect(vals).toContain(first.p50);
    expect(vals).toContain(first.p95);
    // En-yakın-sıra sözleşmesi tek kaynaktan gelir (STT-LAB-1 ile AYNI).
    expect(percentileNearestRank([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentileNearestRank([1, 2, 3, 4], 0.95)).toBe(4);
  });

  it('11. GERÇEK 0 değeri korunur (eksik veri SAYILMAZ)', () => {
    const st = computeNumericStats([0, 0, 0])!;
    expect(st.count).toBe(3);
    expect(st.min).toBe(0);
    expect(st.avg).toBe(0);
    expect(st.p95).toBe(0);

    // Park fixture'ında bir örnekte RMS tam 0 — istatistiğe DAHİL.
    const rec = finalizeMeasurement({
      measurementId: 'M0', conditionId: 'park_motor_kapali',
      startedAt: NOW, elapsedMs: 10_000, targetMs: 10_000,
      samples: FIXTURE_PARK.map(sampleFromSnapshot), cancelled: false,
    });
    expect(rec.rms!.count).toBe(4);
    expect(rec.rms!.min).toBe(0);
  });

  it('12. sentinel (-1) · NaN · Infinity istatistiğe GİRMEZ', () => {
    expect(computeNumericStats([-1, -1, -1])).toBeNull();
    expect(computeNumericStats([NaN, Infinity, -Infinity])).toBeNull();
    const st = computeNumericStats([-1, 0.2, NaN, 0.4, Infinity])!;
    expect(st.count).toBe(2);
    expect(st.min).toBeCloseTo(0.2, 6);
    expect(st.max).toBeCloseTo(0.4, 6);
    expect(computeNumericStats([])).toBeNull();
    expect(computeNumericStats(null)).toBeNull();
    expect(ratio(1, 0)).toBeNull();
  });

  it('12b. taban ÖĞRENİLMEMİŞ (-1) örnekler taban istatistiğini ÇÜRÜTMEZ', () => {
    const samples = [
      sampleFromSnapshot(snap({ noiseFloor: -1, rms: 0.03 })),
      sampleFromSnapshot(snap({ noiseFloor: -1, rms: 0.03 })),
    ];
    const rec = finalizeMeasurement({
      measurementId: 'M2', conditionId: 'rolanti',
      startedAt: NOW, elapsedMs: 5_000, targetMs: 5_000, samples, cancelled: false,
    });
    expect(rec.noiseFloor).toBeNull();   // 0 taban UYDURULMADI
    expect(rec.rms).not.toBeNull();      // diğer ölçümler korunur
  });

  it('13. hız BİLİNMİYORSA 0\'a çevrilmez — ayrı oranla raporlanır', () => {
    const samples = [
      sampleFromSnapshot(snap({ speedKmh: null, motionState: 'unknown' })),
      sampleFromSnapshot(snap({ speedKmh: null, motionState: 'unknown' })),
      sampleFromSnapshot(snap({ speedKmh: 42, motionState: 'moving' })),
    ];
    const rec = finalizeMeasurement({
      measurementId: 'M3', conditionId: 'diger',
      startedAt: NOW, elapsedMs: 5_000, targetMs: 5_000, samples, cancelled: false,
    });
    expect(rec.speed!.count).toBe(1);
    expect(rec.speed!.min).toBe(42);
    expect(rec.speedUnknownRatio).toBeCloseTo(2 / 3, 6);
    expect(rec.motionDistribution).toEqual({ moving: 1, stopped: 0, unknown: 2 });

    // Hepsi bilinmiyorsa hız istatistiği YOK (0 km/s uydurulmaz).
    const none = finalizeMeasurement({
      measurementId: 'M4', conditionId: 'diger',
      startedAt: NOW, elapsedMs: 5_000, targetMs: 5_000,
      samples: [sampleFromSnapshot(snap({ speedKmh: null }))], cancelled: false,
    });
    expect(none.speed).toBeNull();
    expect(none.speedUnknownRatio).toBe(1);
  });

  it('13b. koşul ETİKETİNDEN hız/fan ÇIKARILMAZ — gerçek hız ayrı kaydedilir', () => {
    // Etiket "otoyol" ama gerçek hız BİLİNMİYOR → kayıt bunu gizlemez.
    const rec = finalizeMeasurement({
      measurementId: 'M5', conditionId: 'otoyol_100_110',
      startedAt: NOW, elapsedMs: 10_000, targetMs: 10_000,
      samples: [sampleFromSnapshot(snap({ speedKmh: null }))], cancelled: false,
    });
    expect(rec.conditionId).toBe('otoyol_100_110');
    expect(rec.speed).toBeNull();
    expect(rec.speedUnknownRatio).toBe(1);
    // Modelde etiket→hız/fan türeten hiçbir eşleme YOK.
    const model = stripComments(readSrc(...MODEL_PATH));
    expect(model).not.toMatch(/otoyol_100_110\s*:\s*\d/);
    expect(model).not.toMatch(/fanLevel|hvac/i);
    expect(STT_CONDITION_IDS).toHaveLength(8);
    expect(isSttConditionId('fan_acik')).toBe(true);
    expect(isSttConditionId('uydurma')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14-16 — Değişim işaretleri
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-2 · 14-16. ölçüm boyunca değişim', () => {
  const mk = (snaps: SttMicRaw[]): SttMeasurementRecord => finalizeMeasurement({
    measurementId: 'MC', conditionId: 'diger',
    startedAt: NOW, elapsedMs: 5_000, targetMs: 5_000,
    samples: snaps.map(sampleFromSnapshot), cancelled: false,
  });

  it('14. AudioSource değişimi doğru işaretlenir', () => {
    expect(mk([snap({ sourceName: 'MIC' }), snap({ sourceName: 'MIC' })]).sourceChanged).toBe(false);
    const changed = mk([snap({ sourceName: 'MIC' }), snap({ sourceName: 'VOICE_RECOGNITION' })]);
    expect(changed.sourceChanged).toBe(true);
    // Son GÖZLENEN kaynak taşınır.
    expect(changed.selectedSourceName).toBe('VOICE_RECOGNITION');
  });

  it('15. efekt durumu değişimi doğru işaretlenir (9 eksenin herhangi biri)', () => {
    expect(mk([snap({ nsEnabled: true }), snap({ nsEnabled: true })]).effectsChanged).toBe(false);
    const changed = mk([snap({ nsEnabled: true }), snap({ nsEnabled: false })]);
    expect(changed.effectsChanged).toBe(true);
    expect(changed.nsEnabled).toBe(false); // son gözlenen durum
    expect(changed.aecEnabled).toBe(true);
  });

  it('16. grammar sınıfı değişimi doğru işaretlenir', () => {
    expect(mk([snap({ grammarType: 'static_command' }), snap({ grammarType: 'static_command' })]).grammarChanged).toBe(false);
    const changed = mk([snap({ grammarType: 'static_command' }), snap({ grammarType: 'wake_word' })]);
    expect(changed.grammarChanged).toBe(true);
    expect(changed.grammarType).toBe('wake_word');
  });

  it('14b. KANITSIZ örnekler değişim işaretini KİRLETMEZ', () => {
    // Arada kanıt kaybı var ama gerçek kaynak hiç değişmedi → sourceChanged false.
    const rec = mk([snap({ sourceName: 'MIC' }), snap({ present: false }), snap({ sourceName: 'MIC' })]);
    expect(rec.sourceChanged).toBe(false);
    expect(rec.missingSourceCount).toBe(1);
    expect(rec.reasonCode).toBe('COMPLETED_PARTIAL_LOSS');
    expect(rec.outcome).toBe('complete'); // kısmi kayıp ölçümü ÖLDÜRMEZ
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 17-20 — Defter, silme, onay
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-2 · 17-20. defter', () => {
  beforeEach(() => { clearMeasurementLedgerStorage(); });

  it('17-18. defter 30 kaydı AŞMAZ ve 31. kayıtta EN ESKİ düşer', () => {
    let ledger: SttMeasurementRecord[] = [];
    for (let i = 0; i < STT_LEDGER_MAX; i++) {
      ledger = appendMeasurement(ledger, record({ measurementId: `M${i}` }));
    }
    expect(ledger).toHaveLength(STT_LEDGER_MAX);
    expect(ledger[0]!.measurementId).toBe('M29');                 // en yeni başta
    expect(ledger[STT_LEDGER_MAX - 1]!.measurementId).toBe('M0'); // en eski sonda

    ledger = appendMeasurement(ledger, record({ measurementId: 'M30' }));
    expect(ledger).toHaveLength(STT_LEDGER_MAX);
    expect(ledger[0]!.measurementId).toBe('M30');
    expect(ledger.some((r) => r.measurementId === 'M0')).toBe(false); // EN ESKİ düştü
    expect(ledger.some((r) => r.measurementId === 'M1')).toBe(true);
  });

  it('19. kayıt silme YALNIZ seçili kaydı siler', () => {
    const ledger = [record({ measurementId: 'A' }), record({ measurementId: 'B' }), record({ measurementId: 'C' })];
    const after = removeMeasurement(ledger, 'B');
    expect(after.map((r) => r.measurementId)).toEqual(['A', 'C']);
    // Bilinmeyen kimlik hiçbir şeyi silmez.
    expect(removeMeasurement(after, 'ZZZ')).toHaveLength(2);
  });

  it('20. TÜM KAYITLARI TEMİZLE İKİ ADIMLI ONAY ister (in-app, window.confirm YOK)', () => {
    const src = stripComments(readSrc(...SECTION_PATH));
    // Silme fiilleri doğrudan butona bağlı DEĞİL — önce "armed" durumu gerekir.
    expect(src).toMatch(/onClick=\{\(\) => setArmedClearAll\(true\)\}/);
    expect(src).toMatch(/data-testid="stt-m-clear-confirm"[\s\S]{0,120}onClick=\{clearAll\}/);
    expect(src).toMatch(/onClick=\{\(\) => onArm\(rec\.measurementId\)\}/);
    // Head unit'te siyah/İngilizce çıkan native diyalog KULLANILMAZ.
    expect(src).not.toMatch(/window\.confirm|window\.alert|window\.prompt/);

    const markup = renderToStaticMarkup(<SttMeasurementSection />);
    expect(markup).toContain('TÜM KAYITLARI TEMİZLE');
    expect(markup).not.toContain('ONAYLA — GERİ ALINAMAZ'); // onay YALNIZ armed durumda
  });

  it('20b. yerel depo round-trip: bounded, temizlenmiş ve `cancelled` kayıt KABUL ETMEZ', () => {
    const many = Array.from({ length: 40 }, (_, i) => record({ measurementId: `S${i}` }));
    expect(saveMeasurementLedger(many)).toBe(true);
    expect(loadMeasurementLedger()).toHaveLength(STT_LEDGER_MAX);

    saveMeasurementLedger([record({ measurementId: 'CX', outcome: 'cancelled' })]);
    expect(loadMeasurementLedger()).toHaveLength(0);

    expect(clearMeasurementLedgerStorage()).toBe(true);
    expect(loadMeasurementLedger()).toHaveLength(0);
  });

  it('20c. bozuk/eski gövde ÇÖKERTMEZ ve sahte kayıt ÜRETMEZ', () => {
    localStorage.setItem(STT_LEDGER_STORAGE_KEY, '{bozuk json');
    expect(loadMeasurementLedger()).toEqual([]);
    localStorage.setItem(STT_LEDGER_STORAGE_KEY, JSON.stringify({ records: [{ nope: 1 }, null, 7] }));
    expect(loadMeasurementLedger()).toEqual([]);
    expect(sanitizeMeasurementRecord({ measurementId: 'x' })).toBeNull(); // koşul yok → reddedilir
    expect(sanitizeLedger('değil')).toEqual([]);
    clearMeasurementLedgerStorage();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 21-22 — Karşılaştırma
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-2 · 21-22. karşılaştırma', () => {
  const mk = (id: string, cond: SttConditionId, snaps: readonly SttMicRaw[]): SttMeasurementRecord =>
    finalizeMeasurement({
      measurementId: id, conditionId: cond,
      startedAt: NOW, elapsedMs: 10_000, targetMs: 10_000,
      samples: snaps.map(sampleFromSnapshot), cancelled: false,
    });

  it('21. karşılaştırma DOĞRU sayısal farkları gösterir', () => {
    const park = mk('P', 'park_motor_kapali', FIXTURE_PARK);
    const hwy  = mk('H', 'otoyol_100_110',    FIXTURE_HWY110);
    const cmp  = compareMeasurements(park, hwy);

    expect(cmp.aId).toBe('P');
    expect(cmp.bId).toBe('H');

    const row = (id: string) => cmp.rows.find((r) => r.id === id)!;
    expect(row('cmpFloorP50').diffValue).toBeCloseTo(hwy.noiseFloor!.p50 - park.noiseFloor!.p50, 9);
    expect(row('cmpRmsP95').diffValue).toBeCloseTo(hwy.rms!.p95 - park.rms!.p95, 9);
    expect(row('cmpThrP50').diffValue).toBeCloseTo(hwy.threshold!.p50 - park.threshold!.p50, 9);
    expect(row('cmpSpeech').diffValue).toBeCloseTo(hwy.speechDetectedRatio! - park.speechDetectedRatio!, 9);
    // Park'ta hız 0 GERÇEK ölçümdür → fark hesaplanır.
    expect(row('cmpSpeedP50').diffValue).toBeCloseTo(hwy.speed!.p50 - park.speed!.p50, 9);
    // Kategorik satırlar AYNI/FARKLI der, sayı uydurmaz.
    expect(row('cmpSource').numeric).toBe(false);
    expect(row('cmpSource').diff).toBe('AYNI');
    expect(row('cmpGrammar').diffValue).toBeNull();
  });

  it('21b. bir tarafta değer yoksa fark UYDURULMAZ', () => {
    const a = mk('A', 'park_motor_kapali', FIXTURE_PARK);
    const b = mk('B', 'diger', [snap({ speedKmh: null })]);
    const cmp = compareMeasurements(a, b);
    const speed = cmp.rows.find((r) => r.id === 'cmpSpeedP50')!;
    expect(speed.b).toBe('—');
    expect(speed.diff).toBe('—');
    expect(speed.diffValue).toBeNull();
  });

  it('22. karşılaştırma NEDENSEL veya ÖNERİ metni ÜRETMEZ', () => {
    const cmp = compareMeasurements(
      mk('A', 'park_motor_kapali', FIXTURE_PARK),
      mk('B', 'otoyol_100_110', FIXTURE_HWY110),
    );
    const text = JSON.stringify(cmp);
    for (const banned of [
      'daha iyi', 'daha kötü', 'öneri', 'önerilir', 'kullan', 'yüzünden',
      'neden oldu', 'sebep', 'arttırdı', 'artırdı', 'iyileştir', 'tavsiye',
    ]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
    // Modelde ve ekranda da hüküm cümlesi yok.
    const model = stripComments(readSrc(...MODEL_PATH));
    expect(model).not.toMatch(/daha iyi|tavsiye|önerilir/i);
    const markup = renderToStaticMarkup(<SttMeasurementSection />);
    expect(markup).not.toMatch(/daha iyi|tavsiye|önerilir|yüzünden|neden oldu/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 23-27 — Gizlilik, uydurma yok, fixture izolasyonu
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-2 · 23-27. gizlilik ve dürüstlük', () => {
  it('23. transcript · n-best · wake sözcüğü · grammar kelimeleri hiçbir yere GİRMEZ', () => {
    const rec = record();
    const asJson = JSON.stringify(rec);
    expect(asJson).not.toContain(SECRET_TRANSCRIPT);
    expect(asJson).not.toContain(SECRET_WAKE);

    // Kayıt tipinde metin taşıyan alan YOK: yalnız sabit enum ve kısa kimlik.
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v !== 'string') continue;
      expect(['measurementId', 'conditionId', 'selectedSourceName', 'grammarType', 'outcome', 'reasonCode'])
        .toContain(k);
      expect(v.length).toBeLessThanOrEqual(64);
    }

    const model = stripComments(readSrc(...MODEL_PATH));
    for (const banned of ['transcript', 'alternatives', 'nBest', 'lastHeard', 'wakeWords', 'utterance', 'audioWav']) {
      expect(model).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
    expect(renderToStaticMarkup(<SttMeasurementSection />)).not.toContain(SECRET_WAKE);
  });

  it('24. HAM SES tipi veya verisi TUTULMAZ; kayıtlar ham örnek de saklamaz', () => {
    for (const p of [MODEL_PATH, RUNNER_PATH, STORE_PATH, SECTION_PATH]) {
      const src = stripComments(readSrc(...p));
      expect(src).not.toMatch(/Int16Array|Float32Array|ArrayBuffer|Uint8Array|base64|\bPCM\b|\bWAV\b/);
    }
    // Kayıtta örnek dizisi YOKTUR — yalnız özet istatistik.
    const rec = record();
    expect(Object.keys(rec)).not.toContain('samples');
    for (const v of Object.values(rec)) expect(Array.isArray(v)).toBe(false);

    // Depoya yazılan gövde de örnek taşımaz.
    saveMeasurementLedger([rec]);
    const stored = localStorage.getItem(STT_LEDGER_STORAGE_KEY) ?? '';
    expect(stored).not.toContain('"samples"');
    clearMeasurementLedgerStorage();
  });

  it('24b. sanitize kapısı BİLİNMEYEN alanı diske/ekrana TAŞIMAZ', () => {
    const dirty = { ...record(), transcript: SECRET_TRANSCRIPT, wakeWord: SECRET_WAKE, pcm: [1, 2, 3] };
    const clean = sanitizeMeasurementRecord(dirty)!;
    expect(clean).not.toBeNull();
    expect(JSON.stringify(clean)).not.toContain(SECRET_TRANSCRIPT);
    expect(JSON.stringify(clean)).not.toContain(SECRET_WAKE);
    expect(Object.keys(clean)).not.toContain('pcm');

    saveMeasurementLedger([dirty as SttMeasurementRecord]);
    const stored = localStorage.getItem(STT_LEDGER_STORAGE_KEY) ?? '';
    expect(stored).not.toContain(SECRET_TRANSCRIPT);
    expect(stored).not.toContain('pcm');
    clearMeasurementLedgerStorage();
  });

  it('25-26. kaynak yoksa SAHTE ölçüm üretilmez → `source_lost`', () => {
    const h = harness([snap({ present: false })]);
    h.runner.start('masaustu_simulasyon', 5_000);
    h.run(5_000);
    const rec = h.finalized[0]!;
    expect(rec.outcome).toBe('source_lost');
    expect(rec.reasonCode).toBe('SOURCE_LOST_NO_EVIDENCE');
    expect(rec.samplesValid).toBe(0);
    expect(rec.missingSourceCount).toBe(rec.samplesTaken);
    // Hiçbir istatistik UYDURULMADI.
    expect(rec.rms).toBeNull();
    expect(rec.noiseFloor).toBeNull();
    expect(rec.threshold).toBeNull();
    expect(rec.speechDetectedRatio).toBeNull();
    expect(rec.selectedSourceName).toBe('UNKNOWN');
    expect(rec.sampleRate).toBe(0);
    // Ama tam süre koştu → gerçek saha bulgusu olarak deftere girer.
    expect(rec.elapsedMs).toBe(5_000);
    expect(isLedgerEligible(rec)).toBe(true);
  });

  it('26b. kanıt VAR ama VAD ölçümü yoksa da geçerli örnek SAYILMAZ', () => {
    const rec = finalizeMeasurement({
      measurementId: 'MV', conditionId: 'rolanti',
      startedAt: NOW, elapsedMs: 5_000, targetMs: 5_000,
      samples: [sampleFromSnapshot(snap({ vadPresent: false }))], cancelled: false,
    });
    expect(rec.samplesValid).toBe(0);
    expect(rec.outcome).toBe('source_lost');
    expect(rec.missingSourceCount).toBe(0); // kanıt VARDI — ayrı eksenler
  });

  it('27. fixture ve sahte veri ÜRETİM yoluna GİRMEZ', () => {
    for (const p of [MODEL_PATH, RUNNER_PATH, STORE_PATH, SECTION_PATH]) {
      const src = readSrc(...p);
      expect(src).not.toContain('FIXTURE_');
      expect(src).not.toMatch(/__tests__|\.test\./);
      expect(src).not.toMatch(/\bdemoMode\b|simulateSample|fakeSnapshot|mockSnapshot/i);
    }
    /* Ekranda veri ÜRETEN bir kontrol YOK. (Metinde geçen "Sahte/örnek kayıt
       ÜRETİLMEZ" bir OLUMSUZLAMADIR — kaba dize taraması bunu yanlış alarma
       çevirmesin diye kontrol YÜZEYİ üzerinden doğrulanır.) */
    const markup = renderToStaticMarkup(<SttMeasurementSection />);
    const buttonLabels = (markup.match(/<button[\s\S]*?<\/button>/g) ?? [])
      .map((b) => b.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    for (const label of buttonLabels) {
      expect(label).not.toMatch(/üret|simüle|demo|sahte|örnek veri/i);
    }
    // Yalnız beklenen dört kontrol sınıfı bulunabilir.
    expect(buttonLabels.join(' | ')).toMatch(/ÖLÇÜMÜ BAŞLAT/);
    expect(markup).not.toMatch(/simülasyon verisi|demo veri|test verisi/i);
    // "masaustu_simulasyon" YALNIZ bir KOŞUL ETİKETİDİR — veri üretmez.
    expect(stripComments(readSrc(...MODEL_PATH)))
      .not.toMatch(/masaustu_simulasyon[\s\S]{0,80}(sample|snap|generate)/i);
  });

  it('27b. örnek sayısı BOUNDED — uzun ölçüm belleği şişirmez', () => {
    const h = harness(FIXTURE_PARK);
    h.runner.start('otoyol_100_110', 30_000);
    h.run(30_000);
    expect(h.finalized[0]!.samplesTaken).toBeLessThanOrEqual(STT_MAX_SAMPLES_PER_MEASUREMENT);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 28-29 — Salt-okunurluk ve mevcut yüzeylerin korunması
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-2 · 28-29. salt-okunurluk ve regresyon', () => {
  it('28. bölüm hiçbir STT/mikrofon/araç davranışını DEĞİŞTİREMEZ', () => {
    const src = stripComments(readSrc(...SECTION_PATH));
    for (const banned of [
      'startListening', 'stopListening', 'startSpeechRecognition', 'startWakeWordListening',
      'stopWakeWordListening', 'enableWakeWord', 'disableWakeWord', 'enrollWakeWord',
      'preloadVoskModel', 'AudioRecord', 'getUserMedia', 'setEnabled',
      'CarLauncher.', 'obdService', 'commandExecutor', 'speak(',
    ]) {
      expect(src).not.toContain(banned);
    }
    // Native yüzeyi TEK bir salt-okunur pull'dur.
    expect(src).toMatch(/refreshVoiceMicDiagnostics/);
    // Model ve koşucu da davranış fonksiyonu import etmez.
    for (const p of [MODEL_PATH, RUNNER_PATH]) {
      expect(stripComments(readSrc(...p))).not.toMatch(/voiceService|wakeWordService|nativePlugin|bridge/);
    }
  });

  it('28b. saf model I/O · timer · Date.now · Math.random · React içermez', () => {
    const model = stripComments(readSrc(...MODEL_PATH));
    expect(model).not.toMatch(/Date\.now|Math\.random|setInterval|setTimeout|performance\.now|from 'react'/);
    // Depo katmanında ağ çağrısı YOK (yalnız yerel).
    const store = stripComments(readSrc(...STORE_PATH));
    expect(store).not.toMatch(/\bfetch\(|supabase|firebase|axios|XMLHttpRequest|https?:\/\//i);
    expect(store).toMatch(/safeSetRaw|safeGetRaw|safeRemoveRaw/); // mevcut LAB deseni
  });

  it('29. STT-LAB-1 yüzeyi ve CAROS LAB bağlantıları BOZULMADI', () => {
    const tool = getCarosLabTool('stt-mic');
    expect(tool!.status).toBe('AVAILABLE');
    expect(renderAvailableTool('stt-mic')).not.toBeNull();

    const markup = renderToStaticMarkup(<SttMicScreen />);
    // LAB-1 bölümleri duruyor…
    expect(markup).toContain('SALT OKUNUR');
    expect(markup).toContain('KAYNAK YOK');
    // …ve LAB-2 bölümü ekranda.
    expect(markup).toContain('ÖLÇÜM DEFTERİ');
    expect(markup).toContain('ÖLÇÜMÜ BAŞLAT');
    // Boş defterde sahte kayıt YOK.
    expect(markup).toContain('Defter boş');
    // OEM token'ları korunur, ham renk yok.
    expect(markup).toContain('--oem-');
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('29b. koşucunun sahibi BİLEŞENDİR — modül seviyesinde tekil koşucu YOK', () => {
    const runnerSrc = stripComments(readSrc(...RUNNER_PATH));
    expect(runnerSrc).not.toMatch(/^(export )?(const|let) _?(instance|INSTANCE|singleton)/m);
    expect(runnerSrc).toMatch(/export function createSttMeasurementRunner/);
    const sectionSrc = stripComments(readSrc(...SECTION_PATH));
    expect(sectionSrc).toMatch(/runnerRef\s*=\s*useRef/);
    expect(sectionSrc).toMatch(/runnerRef\.current = null/);
  });
});
