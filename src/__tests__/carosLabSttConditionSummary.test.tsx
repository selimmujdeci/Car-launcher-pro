/**
 * carosLabSttConditionSummary.test.tsx — CAROS LAB · KOŞUL BAZLI TOPLU ÖZET
 * KİLİTLERİ (MAVI-STT-LAB-3).
 *
 * ANA İLKELER:
 *  1. **İKİ SEVİYE KARIŞMAZ:** kayıt-içi p50 ile kayıtlar-arası medyan ayrı
 *     havuzlardır; ham örnek ne açılır ne saklanır.
 *  2. **YALNIZ `complete`:** `cancelled` dışlanır, `source_lost` AYRI sayılır ve
 *     hiçbir merkez değeri, dağılımı veya damgayı bozmaz.
 *  3. **UYDURMA YOK:** `null`/sentinel/NaN/Infinity dışlanır, gerçek `0` korunur,
 *     hız kanıtı yoksa 0 km/s SAYILMAZ, geçerli kayıt yoksa KAYNAK YOK.
 *  4. **TEKRAR EŞİĞİ:** <3 kayıt YETERSİZ TEKRAR'dır (tek ölçüm koşulu temsil etmez).
 *  5. **KARAR ÜRETİLMEZ:** karşılaştırma yalnız A · B · (B−A).
 *  6. **SALT-OKUNUR:** özet katmanı ham kaydı GÖRMEZ ve mutasyon geri çağrısı ALMAZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  buildConditionSummaries, summarizeCondition, aggregateAcrossRecords,
  buildDistribution, effectKey, compareConditionSummaries,
  STT_MIN_REPEATS, STT_AGG_METRIC_IDS, MAX_DISTRIBUTION_ENTRIES,
  type SttConditionSummary,
} from '../platform/devtools/sttConditionSummaryModel';
import {
  STT_CONDITION_IDS, STT_MEASUREMENT_SCHEMA_VERSION,
  type SttMeasurementRecord, type SttConditionId, type NumericStats,
} from '../platform/devtools/sttMeasurementModel';
import { percentileNearestRank } from '../platform/devtools/sttMicModel';
import { SttConditionSummarySection } from '../components/devtools/screens/SttConditionSummary';
import { SttMeasurementSection } from '../components/devtools/screens/SttMeasurementSection';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE'LAR — YALNIZ BU DOSYADA (üretim yoluna GİRMEZ)
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

const SECRET_TRANSCRIPT = 'klimayı kıs ve Ayşe Yıldırım\'ı ara';
const SECRET_WAKE       = 'hey mavi kaptan';

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function readSrc(...p: string[]): string {
  return readFileSync(join(process.cwd(), ...p), 'utf8');
}

const MODEL_PATH   = ['src', 'platform', 'devtools', 'sttConditionSummaryModel.ts'];
const SECTION_PATH = ['src', 'components', 'devtools', 'screens', 'SttConditionSummary.tsx'];

function stats(p50: number, p95: number): NumericStats {
  return { count: 21, min: p50 * 0.8, p50, avg: p50, p95, max: p95 * 1.1 };
}

interface RecOver {
  id: string;
  condition: SttConditionId;
  at?: number;
  outcome?: SttMeasurementRecord['outcome'];
  rms?: NumericStats | null;
  floor?: NumericStats | null;
  thr?: NumericStats | null;
  speech?: number | null;
  speed?: NumericStats | null;
  source?: string;
  sampleRate?: number;
  grammar?: SttMeasurementRecord['grammarType'];
  nsEnabled?: boolean;
  samplesTaken?: number;
  samplesValid?: number;
  missing?: number;
}

/** Tam bir ölçüm kaydı (LAB-2 sözleşmesiyle birebir alan seti). */
function rec(o: RecOver): SttMeasurementRecord {
  const outcome = o.outcome ?? 'complete';
  return {
    schemaVersion: STT_MEASUREMENT_SCHEMA_VERSION,
    measurementId: o.id,
    conditionId: o.condition,
    startedAt: o.at ?? NOW,
    elapsedMs: 10_000, targetMs: 10_000,
    samplesTaken: o.samplesTaken ?? 21,
    samplesValid: o.samplesValid ?? 21,
    missingSourceCount: o.missing ?? 0,
    selectedSourceName: o.source ?? 'MIC',
    sourceChanged: false,
    sampleRate: o.sampleRate ?? 16000,
    channelCount: 1,
    aecAvailable: true, aecCreated: true, aecEnabled: true,
    nsAvailable: true,  nsCreated: true,  nsEnabled: o.nsEnabled !== false,
    agcAvailable: true, agcCreated: true, agcEnabled: true,
    effectsChanged: false,
    rms:        o.rms   === undefined ? stats(0.030, 0.050) : o.rms,
    noiseFloor: o.floor === undefined ? stats(0.012, 0.018) : o.floor,
    threshold:  o.thr   === undefined ? stats(0.023, 0.034) : o.thr,
    speechDetectedRatio: o.speech === undefined ? 0.20 : o.speech,
    speed:      o.speed === undefined ? stats(0, 0) : o.speed,
    speedUnknownRatio: 0,
    motionDistribution: { moving: 0, stopped: 21, unknown: 0 },
    grammarType: o.grammar ?? 'static_command',
    grammarChanged: false,
    wakeActiveRatio: 0, recognizerActiveRatio: 1,
    outcome,
    reasonCode: outcome === 'source_lost' ? 'SOURCE_LOST_NO_EVIDENCE' : 'COMPLETED',
  };
}

/** Park / motor kapalı — üç kayıt, sessiz kabin, hız 0 GERÇEK ölçüm. */
const FIXTURE_PARK: readonly SttMeasurementRecord[] = Object.freeze([
  rec({ id: 'P1', condition: 'park_motor_kapali', at: NOW,          floor: stats(0.0050, 0.0068), thr: stats(0.0100, 0.0100), rms: stats(0.0060, 0.0090), speech: 0.00, speed: stats(0, 0) }),
  rec({ id: 'P2', condition: 'park_motor_kapali', at: NOW + 60_000, floor: stats(0.0052, 0.0071), thr: stats(0.0100, 0.0100), rms: stats(0.0070, 0.0100), speech: 0.05, speed: stats(0, 0) }),
  rec({ id: 'P3', condition: 'park_motor_kapali', at: NOW + 120_000, floor: stats(0.0048, 0.0065), thr: stats(0.0100, 0.0100), rms: stats(0.0055, 0.0085), speech: 0.00, speed: stats(0, 0) }),
]);

/** Şehir içi ~50 km/s — üç kayıt, taban yükselir. */
const FIXTURE_CITY50: readonly SttMeasurementRecord[] = Object.freeze([
  rec({ id: 'C1', condition: 'sehir_ici_50', at: NOW + 200_000, floor: stats(0.0160, 0.0195), thr: stats(0.0304, 0.0371), rms: stats(0.0310, 0.0400), speech: 0.20, speed: stats(49.5, 53.0) }),
  rec({ id: 'C2', condition: 'sehir_ici_50', at: NOW + 260_000, floor: stats(0.0162, 0.0199), thr: stats(0.0308, 0.0378), rms: stats(0.0340, 0.0430), speech: 0.25, speed: stats(50.2, 54.1) }),
  rec({ id: 'C3', condition: 'sehir_ici_50', at: NOW + 320_000, floor: stats(0.0158, 0.0191), thr: stats(0.0300, 0.0363), rms: stats(0.0290, 0.0380), speech: 0.15, speed: stats(51.0, 55.0) }),
]);

/** Otoyol ~110 km/s — üç kayıt; biri FARKLI AudioSource, biri NS KAPALI. */
const FIXTURE_HWY110: readonly SttMeasurementRecord[] = Object.freeze([
  rec({ id: 'H1', condition: 'otoyol_100_110', at: NOW + 400_000, floor: stats(0.0340, 0.0410), thr: stats(0.0646, 0.0779), rms: stats(0.0620, 0.0790), speech: 0.45, speed: stats(108.0, 113.0) }),
  rec({ id: 'H2', condition: 'otoyol_100_110', at: NOW + 460_000, floor: stats(0.0352, 0.0425), thr: stats(0.0669, 0.0808), rms: stats(0.0680, 0.0850), speech: 0.50, speed: stats(110.5, 115.2), source: 'VOICE_RECOGNITION' }),
  rec({ id: 'H3', condition: 'otoyol_100_110', at: NOW + 520_000, floor: stats(0.0336, 0.0402), thr: stats(0.0638, 0.0764), rms: stats(0.0590, 0.0760), speech: 0.40, speed: stats(111.2, 116.0), nsEnabled: false, grammar: 'free', sampleRate: 8000 }),
]);

/** Hız kanıtı OLMAYAN kayıtlar (rölanti — OBD/GPS yok). */
const FIXTURE_NO_SPEED: readonly SttMeasurementRecord[] = Object.freeze([
  rec({ id: 'N1', condition: 'rolanti', speed: null, floor: stats(0.0090, 0.0110) }),
  rec({ id: 'N2', condition: 'rolanti', speed: null, floor: stats(0.0095, 0.0115) }),
  rec({ id: 'N3', condition: 'rolanti', speed: stats(0, 0), floor: stats(0.0092, 0.0112) }),
]);

/** Kaynak kaybı — tam süre koştu ama hiçbir metrik üretmedi. */
const FIXTURE_SOURCE_LOST: readonly SttMeasurementRecord[] = Object.freeze([
  rec({
    id: 'L1', condition: 'park_motor_kapali', at: NOW + 900_000, outcome: 'source_lost',
    rms: null, floor: null, thr: null, speech: null, speed: null,
    source: 'UNKNOWN', sampleRate: 0, samplesValid: 0, missing: 21,
  }),
]);

/** İptal edilmiş kayıt — LAB-2 sözleşmesi gereği deftere GİRMEZ, yine de süzülmeli. */
const FIXTURE_CANCELLED: readonly SttMeasurementRecord[] = Object.freeze([
  rec({ id: 'X1', condition: 'park_motor_kapali', outcome: 'cancelled', floor: stats(9.9, 9.9), thr: stats(9.9, 9.9) }),
]);

const FULL_LEDGER: readonly SttMeasurementRecord[] = Object.freeze([
  ...FIXTURE_PARK, ...FIXTURE_CITY50, ...FIXTURE_HWY110,
  ...FIXTURE_NO_SPEED, ...FIXTURE_SOURCE_LOST, ...FIXTURE_CANCELLED,
]);

function find(list: readonly SttConditionSummary[], id: SttConditionId): SttConditionSummary {
  return list.find((s) => s.conditionId === id)!;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1-5 — Gruplama sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-3 · 1-5. gruplama', () => {
  it('1. YALNIZ `complete` kayıtlar metrik hesabına girer', () => {
    const s = summarizeCondition('park_motor_kapali', [...FIXTURE_PARK, ...FIXTURE_SOURCE_LOST]);
    expect(s.completeCount).toBe(3);
    // 3 tamamlanmış kaydın taban p50'leri: 0.0048 · 0.0050 · 0.0052 → medyan 0.0050
    expect(s.metrics.floorP50!.validRecords).toBe(3);
    expect(s.metrics.floorP50!.median).toBeCloseTo(0.0050, 9);
  });

  it('2. `cancelled` kayıtlar DIŞLANIR (metriği ve sayacı kirletmez)', () => {
    const withX = summarizeCondition('park_motor_kapali', [...FIXTURE_PARK, ...FIXTURE_CANCELLED]);
    const clean = summarizeCondition('park_motor_kapali', FIXTURE_PARK);
    expect(withX.completeCount).toBe(3);
    expect(withX.totalCount).toBe(3);            // iptal TOPLAMA da girmez
    expect(withX.metrics.floorP50).toEqual(clean.metrics.floorP50);
    // 9.9'luk sahte değer hiçbir yere sızmadı.
    expect(withX.metrics.floorP50!.max).toBeLessThan(1);
  });

  it('3. `source_lost` AYRI sayılır ve merkez değeri/damgayı BOZMAZ', () => {
    const clean = summarizeCondition('park_motor_kapali', FIXTURE_PARK);
    const withLost = summarizeCondition('park_motor_kapali', [...FIXTURE_PARK, ...FIXTURE_SOURCE_LOST]);

    expect(withLost.sourceLostCount).toBe(1);
    expect(withLost.completeCount).toBe(3);
    expect(withLost.totalCount).toBe(4);
    // Metrikler BİREBİR aynı.
    for (const id of STT_AGG_METRIC_IDS) {
      expect(withLost.metrics[id]).toEqual(clean.metrics[id]);
    }
    // Damgalar da yalnız complete kayıtlardan (kaynak-kayıp en geç kayıt olmasına rağmen).
    expect(withLost.lastAt).toBe(clean.lastAt);
    expect(withLost.lastAt).toBe(NOW + 120_000);
    // Dağılımlar da bozulmadı — 'UNKNOWN' kaynak listeye girmedi.
    expect(withLost.sourceDistribution).toEqual(clean.sourceDistribution);
    expect(withLost.sourceDistribution.some((d) => d.key === 'UNKNOWN')).toBe(false);
  });

  it('4-5. aynı koşul doğru gruplanır, farklı koşullar KARIŞMAZ', () => {
    const all = buildConditionSummaries(FULL_LEDGER);
    // Sabit enum sırası, HER ZAMAN 8 satır (kayıtsız koşul da görünür).
    expect(all.map((s) => s.conditionId)).toEqual([...STT_CONDITION_IDS]);

    expect(find(all, 'park_motor_kapali').completeCount).toBe(3);
    expect(find(all, 'sehir_ici_50').completeCount).toBe(3);
    expect(find(all, 'otoyol_100_110').completeCount).toBe(3);
    expect(find(all, 'rolanti').completeCount).toBe(3);
    expect(find(all, 'fan_acik').completeCount).toBe(0);

    // Otoyol tabanı park tabanıyla KARIŞMADI.
    expect(find(all, 'park_motor_kapali').metrics.floorP50!.median).toBeCloseTo(0.0050, 9);
    expect(find(all, 'otoyol_100_110').metrics.floorP50!.median).toBeCloseTo(0.0340, 9);
    expect(find(all, 'sehir_ici_50').metrics.floorP50!.median).toBeCloseTo(0.0160, 9);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6-8 — Tekrar eşiği
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-3 · 6-8. tekrar eşiği', () => {
  it('6. 0 kayıt → KAYNAK YOK (sahte özet ÜRETİLMEZ)', () => {
    const s = summarizeCondition('fan_acik', FULL_LEDGER);
    expect(s.status).toBe('NO_DATA');
    expect(s.hasEnoughRepeats).toBe(false);
    expect(s.totalCount).toBe(0);
    expect(s.firstAt).toBeNull();
    expect(s.lastAt).toBeNull();
    expect(s.speedUnknownRecordRatio).toBeNull();
    for (const id of STT_AGG_METRIC_IDS) expect(s.metrics[id]).toBeNull();
  });

  it('7. 1–2 kayıt → YETERSİZ TEKRAR (tek ölçüm koşulu temsil etmez)', () => {
    const one = summarizeCondition('park_motor_kapali', [FIXTURE_PARK[0]!]);
    expect(one.status).toBe('INSUFFICIENT_REPEATS');
    expect(one.hasEnoughRepeats).toBe(false);
    // Tek kayıtta dağılım genişliği 0'dır AMA bu "kararlı" demek DEĞİLDİR.
    expect(one.metrics.floorP50!.spread).toBe(0);
    expect(one.metrics.floorP50!.validRecords).toBe(1);

    const two = summarizeCondition('park_motor_kapali', FIXTURE_PARK.slice(0, 2));
    expect(two.status).toBe('INSUFFICIENT_REPEATS');
    expect(two.hasEnoughRepeats).toBe(false);
  });

  it('8. 3 kayıt → YETERLİ TEKRAR', () => {
    const s = summarizeCondition('park_motor_kapali', FIXTURE_PARK);
    expect(s.status).toBe('READY');
    expect(s.hasEnoughRepeats).toBe(true);
    expect(STT_MIN_REPEATS).toBe(3);
  });

  it('8b. `source_lost` tek başına YETERLİ TEKRAR üretmez', () => {
    const lost3 = [0, 1, 2].map((i) => rec({
      id: `LL${i}`, condition: 'fan_kapali', outcome: 'source_lost',
      rms: null, floor: null, thr: null, speech: null, speed: null,
    }));
    const s = summarizeCondition('fan_kapali', lost3);
    expect(s.totalCount).toBe(3);
    expect(s.completeCount).toBe(0);
    expect(s.sourceLostCount).toBe(3);
    expect(s.hasEnoughRepeats).toBe(false);
    expect(s.status).toBe('INSUFFICIENT_REPEATS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9-14 — Kayıtlar arası istatistik
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-3 · 9-14. istatistik', () => {
  it('9. kayıtlar arası MEDYAN doğru ve deterministik hesaplanır', () => {
    const st = aggregateAcrossRecords([0.020, 0.010, 0.012])!;
    expect(st.median).toBeCloseTo(0.012, 9);
    // Deterministik: aynı girdi her zaman aynı çıktı, dönen değer GERÇEK bir kayıt.
    for (let i = 0; i < 30; i++) {
      expect(aggregateAcrossRecords([0.020, 0.010, 0.012])!.median).toBe(st.median);
    }
    expect([0.020, 0.010, 0.012]).toContain(st.median);
    // Tek gerçek: LAB-1/LAB-2 ile AYNI en-yakın-sıra sözleşmesi.
    expect(percentileNearestRank([1, 2, 3, 4], 0.5)).toBe(2);
    expect(aggregateAcrossRecords([1, 2, 3, 4])!.median).toBe(2);
  });

  it('9b. merkez değer ORTALAMA DEĞİL medyandır (tek bozuk ölçüm kaydırmaz)', () => {
    const st = aggregateAcrossRecords([0.010, 0.011, 0.012, 0.013, 5.0])!;
    expect(st.median).toBeCloseTo(0.012, 9); // ortalama ~1.0 olurdu
    expect(st.max).toBe(5.0);
  });

  it('10. min / max / dağılım genişliği doğru hesaplanır', () => {
    const s = summarizeCondition('park_motor_kapali', FIXTURE_PARK);
    const f = s.metrics.floorP50!;
    expect(f.min).toBeCloseTo(0.0048, 9);
    expect(f.max).toBeCloseTo(0.0052, 9);
    expect(f.spread).toBeCloseTo(0.0004, 9);
    expect(f.spread).toBeCloseTo(f.max - f.min, 12);
  });

  it('11. GERÇEK 0 korunur (eksik veri SAYILMAZ)', () => {
    const st = aggregateAcrossRecords([0, 0, 0])!;
    expect(st.validRecords).toBe(3);
    expect(st.median).toBe(0);
    expect(st.min).toBe(0);
    expect(st.spread).toBe(0);

    // Park'ta hız gerçekten 0 → hız metriği ÜRETİLİR ve 0'dır.
    const s = summarizeCondition('park_motor_kapali', FIXTURE_PARK);
    expect(s.metrics.speedP50!.validRecords).toBe(3);
    expect(s.metrics.speedP50!.median).toBe(0);
    expect(s.speedUnknownRecordRatio).toBe(0);
  });

  it('12. null · sentinel(-1) · NaN · Infinity DIŞLANIR', () => {
    expect(aggregateAcrossRecords([null, undefined])).toBeNull();
    expect(aggregateAcrossRecords([NaN, Infinity, -Infinity, -1])).toBeNull();
    const st = aggregateAcrossRecords([-1, 0.2, NaN, null, 0.4, Infinity])!;
    expect(st.validRecords).toBe(2);
    expect(st.min).toBeCloseTo(0.2, 9);
    expect(st.max).toBeCloseTo(0.4, 9);
    expect(aggregateAcrossRecords([])).toBeNull();
    expect(aggregateAcrossRecords(null)).toBeNull();
  });

  it('13. hız kanıtı olmayan kayıt 0 km/s SAYILMAZ', () => {
    const s = summarizeCondition('rolanti', FIXTURE_NO_SPEED);
    // 3 kayıttan 2'sinde hız kanıtı YOK → yalnız 1 kayıt metriğe girer.
    expect(s.metrics.speedP50!.validRecords).toBe(1);
    expect(s.metrics.speedP50!.median).toBe(0);   // kanıtlı olan gerçekten 0'dı
    expect(s.speedUnknownRecordRatio).toBeCloseTo(2 / 3, 9);
    // Taban metriği 3 kayıttan da beslenir — hız eksikliği onu ÇÜRÜTMEZ.
    expect(s.metrics.floorP50!.validRecords).toBe(3);

    // Hepsinde kanıt yoksa metrik HİÇ üretilmez (0 km/s uydurulmaz).
    const none = summarizeCondition('rolanti', FIXTURE_NO_SPEED.slice(0, 2));
    expect(none.metrics.speedP50).toBeNull();
    expect(none.speedUnknownRecordRatio).toBe(1);
  });

  it('14. bir metrik KISMEN eksikse geçerli kayıt sayısı doğru gösterilir', () => {
    const mixed = [
      rec({ id: 'M1', condition: 'diger', thr: stats(0.020, 0.030) }),
      rec({ id: 'M2', condition: 'diger', thr: null }),                 // eşik hiç uygulanmadı
      rec({ id: 'M3', condition: 'diger', thr: stats(0.024, 0.034) }),
    ];
    const s = summarizeCondition('diger', mixed);
    expect(s.completeCount).toBe(3);
    expect(s.hasEnoughRepeats).toBe(true);
    expect(s.metrics.thrP50!.validRecords).toBe(2);   // metrik bazında DÜRÜST
    expect(s.metrics.floorP50!.validRecords).toBe(3);
    expect(s.metrics.thrP50!.median).toBeCloseTo(0.020, 9);
  });

  it('14b. kayıt-içi oranlar ikinci seviyede toplulaştırılır; payda 0 ise üretilmez', () => {
    const s = summarizeCondition('park_motor_kapali', FIXTURE_PARK);
    expect(s.metrics.validSampleRatio!.median).toBe(1);        // 21/21
    expect(s.metrics.missingSourceRatio!.median).toBe(0);      // gerçek 0 korunur

    const zeroSamples = [rec({ id: 'Z1', condition: 'diger', samplesTaken: 0, samplesValid: 0 })];
    const z = summarizeCondition('diger', zeroSamples);
    expect(z.metrics.validSampleRatio).toBeNull();             // sahte %0 YOK
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 15-17 — Dağılımlar
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-3 · 15-17. dağılımlar', () => {
  it('15. AudioSource dağılımı doğru hesaplanır (adet azalan, eşitlikte alfabetik)', () => {
    const s = summarizeCondition('otoyol_100_110', FIXTURE_HWY110);
    expect(s.sourceDistribution).toEqual([
      { key: 'MIC', count: 2 },
      { key: 'VOICE_RECOGNITION', count: 1 },
    ]);
    // Örnekleme hızı dağılımı da ayrışır; 0 Hz "BİLİNMİYOR" olur (sahte 0 değil).
    expect(s.sampleRateDistribution).toEqual([
      { key: '16000 Hz', count: 2 },
      { key: '8000 Hz', count: 1 },
    ]);
    const withUnknown = summarizeCondition('diger', [rec({ id: 'U1', condition: 'diger', sampleRate: 0 })]);
    expect(withUnknown.sampleRateDistribution[0]!.key).toBe('BİLİNMİYOR');
  });

  it('15b. dağılım deterministik ve BOUNDED', () => {
    expect(buildDistribution(['b', 'a', 'b', 'c'])).toEqual([
      { key: 'b', count: 2 }, { key: 'a', count: 1 }, { key: 'c', count: 1 },
    ]);
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`);
    expect(buildDistribution(many).length).toBe(MAX_DISTRIBUTION_ENTRIES);
    expect(buildDistribution([])).toEqual([]);
  });

  it('16. efekt durum dağılımı doğru hesaplanır (9 eksen tek anahtarda)', () => {
    const s = summarizeCondition('otoyol_100_110', FIXTURE_HWY110);
    // H3'te NS ETKİN DEĞİL → ayrı grup.
    expect(s.effectDistribution).toHaveLength(2);
    expect(s.effectDistribution[0]!.count).toBe(2);
    expect(s.effectDistribution[0]!.key).toContain('NS MOE');
    expect(s.effectDistribution[1]!.key).toContain('NS MO-');
    // Anahtar üç ekseni AYRI taşır (mevcut ≠ oluşturuldu ≠ etkin).
    expect(effectKey(FIXTURE_HWY110[2]!)).toBe('AEC MOE · NS MO- · AGC MOE');
  });

  it('17. grammar sınıfı dağılımı doğru hesaplanır', () => {
    const s = summarizeCondition('otoyol_100_110', FIXTURE_HWY110);
    expect(s.grammarDistribution).toEqual([
      { key: 'static_command', count: 2 },
      { key: 'free', count: 1 },
    ]);
    // Dağılım YALNIZ SINIF taşır — grammar KELİMESİ değil.
    for (const d of s.grammarDistribution) {
      expect(['static_command', 'wake_word', 'confirmation', 'free']).toContain(d.key);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 18-19 — İki koşul karşılaştırması
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-3 · 18-19. koşul farkı', () => {
  const all = buildConditionSummaries(FULL_LEDGER);
  const park = find(all, 'park_motor_kapali');
  const hwy  = find(all, 'otoyol_100_110');

  it('18. karşılaştırma DOĞRU matematiksel farkları gösterir', () => {
    const cmp = compareConditionSummaries(park, hwy);
    expect(cmp.aId).toBe('park_motor_kapali');
    expect(cmp.bId).toBe('otoyol_100_110');

    const row = (id: string) => cmp.rows.find((r) => r.id === id)!;
    expect(row('cdFloor').diffValue).toBeCloseTo(0.0340 - 0.0050, 9);
    expect(row('cdRms').diffValue).toBeCloseTo(0.0620 - 0.0060, 9);
    expect(row('cdThr').diffValue).toBeCloseTo(0.0646 - 0.0100, 9);
    expect(row('cdSpeech').diffValue).toBeCloseTo(0.45 - 0.00, 9);
    // Otoyol hız p50'leri: 108.0 · 110.5 · 111.2 → medyan 110.5 (park medyanı 0).
    expect(row('cdSpeed').diffValue).toBeCloseTo(110.5 - 0, 9);
    expect(row('cdSpread').diffValue).toBeCloseTo(
      hwy.metrics.floorP50!.spread - park.metrics.floorP50!.spread, 12);
    expect(row('cdRepeats').diffValue).toBe(0); // ikisi de 3 kayıt
  });

  it('18b. bir tarafta değer yoksa fark UYDURULMAZ', () => {
    const empty = find(all, 'fan_acik');
    const cmp = compareConditionSummaries(park, empty);
    for (const r of cmp.rows) {
      if (r.id === 'cdRepeats') continue; // sayaç her zaman vardır
      expect(r.b).toBe('—');
      expect(r.diff).toBe('—');
      expect(r.diffValue).toBeNull();
    }
    expect(cmp.rows.find((r) => r.id === 'cdRepeats')!.diffValue).toBe(-3);
  });

  it('19. NEDENSEL veya ÖNERİ metni ÜRETİLMEZ', () => {
    const text = JSON.stringify(compareConditionSummaries(park, hwy));
    for (const banned of [
      'daha iyi', 'daha kötü', 'uygun eşik', 'öneri', 'önerilir', 'tavsiye',
      'kullan', 'yüzünden', 'kaynaklandı', 'neden oldu', 'sebep', 'artırdı', 'arttırdı',
    ]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
    const model = stripComments(readSrc(...MODEL_PATH));
    expect(model).not.toMatch(/daha iyi|uygun eşik|tavsiye|önerilir|kaynaklandı/i);

    const markup = renderToStaticMarkup(<SttConditionSummarySection summaries={all} />);
    expect(markup).not.toMatch(/daha iyi|daha kötü|uygun eşik|tavsiye|önerilir|yüzünden|kaynaklandı/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 20-23 — Gizlilik, salt-okunurluk, bounded yapı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-3 · 20-23. gizlilik ve salt-okunurluk', () => {
  const all = buildConditionSummaries(FULL_LEDGER);

  it('20. HAM KAYIT ve ham örnek markup\'a GİRMEZ (measurementId dahil)', () => {
    const markup = renderToStaticMarkup(<SttConditionSummarySection summaries={all} />);
    for (const id of ['P1', 'P2', 'P3', 'C1', 'H1', 'H2', 'H3', 'L1', 'X1']) {
      expect(markup).not.toMatch(new RegExp(`>${id}<|"${id}"`));
    }
    // Özet sözleşmesinde kayıt kimliği ALANI YOK (yapısal).
    for (const s of all) {
      expect(Object.keys(s)).not.toContain('measurementId');
      expect(Object.keys(s)).not.toContain('records');
      expect(Object.keys(s)).not.toContain('samples');
    }
    expect(JSON.stringify(all)).not.toContain('measurementId');
    // Özet bileşeni ham kaydı TİP olarak da göremez.
    expect(stripComments(readSrc(...SECTION_PATH))).not.toMatch(/SttMeasurementRecord/);
  });

  it('21. transcript · n-best · wake sözcüğü · grammar KELİMELERİ sızmaz', () => {
    const json = JSON.stringify(all);
    expect(json).not.toContain(SECRET_TRANSCRIPT);
    expect(json).not.toContain(SECRET_WAKE);

    const markup = renderToStaticMarkup(<SttConditionSummarySection summaries={all} />);
    expect(markup).not.toContain(SECRET_TRANSCRIPT);
    expect(markup).not.toContain(SECRET_WAKE);

    for (const p of [MODEL_PATH, SECTION_PATH]) {
      const src = stripComments(readSrc(...p));
      for (const banned of ['transcript', 'alternatives', 'nBest', 'lastHeard', 'wakeWords', 'utterance', 'audioWav']) {
        expect(src).not.toMatch(new RegExp(`\\b${banned}\\b`));
      }
      expect(src).not.toMatch(/Int16Array|Float32Array|ArrayBuffer|Uint8Array|base64|\bPCM\b|\bWAV\b/);
    }
  });

  it('22. özet katmanı HİÇBİR kaydı veya STT davranışını DEĞİŞTİREMEZ', () => {
    const src = stripComments(readSrc(...SECTION_PATH));
    for (const banned of [
      'removeMeasurement', 'appendMeasurement', 'saveMeasurementLedger',
      'clearMeasurementLedgerStorage', 'createSttMeasurementRunner',
      'startListening', 'startSpeechRecognition', 'startWakeWordListening',
      'refreshVoiceMicDiagnostics', 'AudioRecord', 'setEnabled', 'CarLauncher',
      'safeSetRaw', 'safeRemoveRaw', 'localStorage',
    ]) {
      expect(src).not.toContain(banned);
    }
    // Prop yüzeyi TEK: yalnız hesaplanmış özetler; mutasyon geri çağrısı YOK.
    expect(src).toMatch(/\{\s*summaries,?\s*\}\s*:\s*\{\s*summaries:\s*readonly Summary\[\]\s*\}/);
    expect(src).not.toMatch(/onDelete|onClear|onStart|onChangeRecord/);
  });

  it('23. yeni persistence katmanı veya AĞ çağrısı KURULMAZ', () => {
    for (const p of [MODEL_PATH, SECTION_PATH]) {
      const src = stripComments(readSrc(...p));
      expect(src).not.toMatch(/\bfetch\(|supabase|firebase|axios|XMLHttpRequest|https?:\/\//i);
      expect(src).not.toMatch(/safeStorage|localStorage|sessionStorage|indexedDB/i);
    }
    // Saf model: I/O · timer · saat · rastgelelik · React YOK.
    const model = stripComments(readSrc(...MODEL_PATH));
    expect(model).not.toMatch(/Date\.now|Math\.random|setInterval|setTimeout|performance\.now|from 'react'/);
    /* MODÜL SEVİYESİ MUTABLE DURUM YOK. Yalnız GİRİNTİSİZ (üst düzey) bildirimler
       taranır — fonksiyon gövdesindeki yerel `let` meşrudur ve cache değildir. */
    const topLevelMutable = model.match(/^(export\s+)?(let|var)\s+\w+/gm) ?? [];
    expect(topLevelMutable).toEqual([]);
    expect(model).not.toMatch(/^(export\s+)?const\s+_?(cache|memo|store|state)\b/m);
  });

  it('23b. hesap ihtiyaç anında ve yalnız EKRAN ÖMRÜ boyunca memoize edilir', () => {
    const parent = stripComments(readSrc(
      'src', 'components', 'devtools', 'screens', 'SttMeasurementSection.tsx'));
    expect(parent).toMatch(/useMemo\(\(\) => buildConditionSummaries\(ledger\), \[ledger\]\)/);
    // Koşul sayısı enum ile bounded.
    expect(buildConditionSummaries([])).toHaveLength(STT_CONDITION_IDS.length);
    expect(STT_CONDITION_IDS).toHaveLength(8);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 24-25 — Mevcut yüzeylerin korunması
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-3 · 24-25. regresyon', () => {
  it('24. LAB-2 ölçüm kontrolleri AYNEN korunur; özet bölümü ekranda', () => {
    const markup = renderToStaticMarkup(<SttMeasurementSection />);
    // LAB-2 kontrolleri duruyor…
    expect(markup).toContain('ÖLÇÜMÜ BAŞLAT');
    expect(markup).toContain('TÜM KAYITLARI TEMİZLE');
    expect(markup).toContain('ÖLÇÜM DEFTERİ');
    // …ve LAB-3 özet bölümü eklendi.
    expect(markup).toContain('KOŞUL ÖZETLERİ');
    // Boş defterde 8 koşul da KAYNAK YOK gösterir (sahte özet yok).
    expect(markup).toContain('KAYNAK YOK');
    expect(markup).toContain('SALT OKUNUR');
  });

  it('25. CAROS LAB bağlantısı ve OEM token disiplini BOZULMADI', () => {
    expect(getCarosLabTool('stt-mic')!.status).toBe('AVAILABLE');
    expect(renderAvailableTool('stt-mic')).not.toBeNull();
    const markup = renderToStaticMarkup(
      <SttConditionSummarySection summaries={buildConditionSummaries(FULL_LEDGER)} />);
    expect(markup).toContain('--oem-');
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/);
    // Sabit koşul sırası markup'ta da korunur.
    const first = markup.indexOf('stt-cs-card-park_motor_kapali');
    const last  = markup.indexOf('stt-cs-card-diger');
    expect(first).toBeGreaterThan(-1);
    expect(last).toBeGreaterThan(first);
  });
});
