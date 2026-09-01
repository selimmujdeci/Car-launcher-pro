/**
 * vdkReplayLab.test.ts — P0-VDK-F2B · CAROS LAB "VDK REPLAY" KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ZORUNLU GÖZLEMLENEBİLİRLİK KURALI
 * ══════════════════════════════════════════════════════════════════════════
 * "Gözlemlenemeyen özellik tamamlanmış değildir." Bu dosya LAB blokunun
 * yedi şartını KİLİTLER:
 *
 *   · salt-okunur (komut GÖNDERMEZ, replay BAŞLATMAZ)
 *   · gerçek kaynaklardan okur (sabit/örnek veri YOK)
 *   · kanıtsız bilgi ÜRETMEZ (koşu yoksa `0` değil KAYNAK YOK)
 *   · gizli veri taşımaz (ham istek/yanıt gövdesi ekrana GİRMEZ)
 *   · hüküm fail-closed (`UNKNOWN` bir BAŞARI DEĞİLDİR)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from './helpers';

import { readVdkReplaySnapshot } from '../platform/devtools/vdkReplaySources';
import {
  buildVdkReplayView, deriveReplayVerdict, REPLAY_VERDICT_LABEL,
} from '../platform/devtools/vdkReplayModel';
import type { VdkReplayRawSnapshot } from '../platform/devtools/vdkReplaySources';
import { _resetVdkTransportForTest } from '../platform/obd/vdkTransport';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import type { FunctionalDtcEvidenceEntry } from '../platform/obd/functionalDtcEvidence';
import type { ConformanceRunResult } from '../platform/obd/conformanceRun';

const EMPTY: VdkReplayRawSnapshot = {
  active: false, replayRunId: null, sourceTraceId: null, mode: null,
  sourceEventCount: null, requested: null, matched: null, mismatched: null,
  exhausted: null, noRecordedResponse: null, cancelled: null, timingInvalid: null,
  unconsumed: null, gapSignals: null, outcomeCounts: null,
  traceProvenanceMode: 'live', liveTraceEventCount: 0, replayStampedEventCount: 0,
  functionalEntries: [], functionalGapSignals: [],
  conformance: null, gapRegistry: [], gapRegistryDropped: null,
  pduCapabilities: {
    kind: 'elm327', supportsArbitraryPdu: false,
    supportedServices: ['03', '07', '0A', '19', '18', '13', '3E'],
  },
};

/** P0-VDK-F2C1 · fonksiyonel çözümleyici kanıt satırı (varsayılan: kanonik). */
function fnEntry(p: Partial<FunctionalDtcEvidenceEntry> = {}): FunctionalDtcEvidenceEntry {
  return {
    mode: '03', provenance: 'CANONICAL_TS', parity: 'MATCH', parityDetail: null,
    block: null, parserOutcome: 'POSITIVE_WITH_CODES', malformedReason: null,
    inputBytes: 14, recordsDecoded: 1, paddingRecords: 2, leftoverBytes: 0,
    positiveSid: '43', ecuAttribution: 'NOT_APPLICABLE', bodyCount: 1,
    authorityCodeCount: 1, replay: false,
    ...p,
  };
}

function withRun(p: Partial<VdkReplayRawSnapshot>): VdkReplayRawSnapshot {
  return {
    ...EMPTY, active: true, replayRunId: 'R1', sourceTraceId: 'T1', mode: 'FAST',
    functionalEntries: [fnEntry()],
    sourceEventCount: 10, requested: 5, matched: 5, mismatched: 0, exhausted: 0,
    noRecordedResponse: 0, cancelled: 0, timingInvalid: 0, unconsumed: 5,
    gapSignals: [], outcomeCounts: { MATCHED: 5 },
    traceProvenanceMode: 'replay', liveTraceEventCount: 7, replayStampedEventCount: 7,
    ...p,
  };
}

beforeEach(() => { _resetVdkTransportForTest(); });

/* ═══════════════════════════════════════════════════════════════════════════
   A) KAYNAK KATMANI
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · LAB A) kaynak', () => {
  it('🔒 KİLİT: koşu YOKKEN sayaç ÜRETİLMEZ (sahte 0 YASAK)', () => {
    const s = readVdkReplaySnapshot();
    expect(s.active).toBe(false);
    expect(s.replayRunId).toBeNull();
    expect(s.requested).toBeNull();
    expect(s.matched).toBeNull();
    expect(s.gapSignals).toBeNull();
  });

  it('🔒 KİLİT: kaynak katmanı ASLA fırlatmaz', () => {
    expect(() => readVdkReplaySnapshot()).not.toThrow();
  });

  it('🔒 KİLİT: kaynak katmanı HAM istek/yanıt taşımıyor (gizlilik)', () => {
    const src = stripComments(
      readFileSync(resolve(__dirname, '../platform/devtools/vdkReplaySources.ts'), 'utf8'));
    expect(src).not.toMatch(/rawRequest/);
    expect(src).not.toMatch(/rawResponse/);
  });

  it('🔒 KİLİT: kaynak katmanı replay BAŞLATMAZ/DURDURMAZ', () => {
    const src = stripComments(
      readFileSync(resolve(__dirname, '../platform/devtools/vdkReplaySources.ts'), 'utf8'));
    expect(src).not.toMatch(/startReplay|stopReplay|cancelReplay|importTracePackage/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) HÜKÜM — FAIL-CLOSED
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · LAB B) hüküm', () => {
  it('🔒 koşu yok → UNKNOWN (BAŞARI DEĞİL)', () => {
    expect(deriveReplayVerdict(EMPTY)).toBe('UNKNOWN');
  });

  it('🔒 tüm istekler eşleşti → PASS', () => {
    expect(deriveReplayVerdict(withRun({}))).toBe('PASS');
  });

  it('🔒 TEK uyuşmazlık bile PASS’i DÜŞÜRÜR ("çoğu tuttu" hüküm değildir)', () => {
    expect(deriveReplayVerdict(withRun({ requested: 6, matched: 5, mismatched: 1 })))
      .toBe('PARITY_MISMATCH');
  });

  it('🔒 tükenme · ölçülmemiş yanıt · zaman geçersizliği de SAPMA sayılır', () => {
    expect(deriveReplayVerdict(withRun({ exhausted: 1 }))).toBe('PARITY_MISMATCH');
    expect(deriveReplayVerdict(withRun({ noRecordedResponse: 1 }))).toBe('PARITY_MISMATCH');
    expect(deriveReplayVerdict(withRun({ timingInvalid: 1 }))).toBe('PARITY_MISMATCH');
  });

  it('🔒 iptal → INCOMPLETE (PASS DEĞİL)', () => {
    expect(deriveReplayVerdict(withRun({ cancelled: 1 }))).toBe('INCOMPLETE');
  });

  it('🔒 hiç istek gelmediyse → INCOMPLETE', () => {
    expect(deriveReplayVerdict(withRun({ requested: 0, matched: 0 }))).toBe('INCOMPLETE');
  });

  it('🔒 sayaç okunamadıysa → TRACE_INVALID', () => {
    expect(deriveReplayVerdict(withRun({ requested: null }))).toBe('TRACE_INVALID');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) GÖRÜNÜM
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · LAB C) görünüm', () => {
  it('🔒 KİLİT: beş bölüm SIRAYLA üretilir', () => {
    const v = buildVdkReplayView(withRun({}));
    expect(v.sections.map((s) => s.id))
      .toEqual(['conformance', 'run', 'accounting', 'parity', 'functional', 'isolation', 'gaps']);
  });

  it('🔒 KİLİT: koşu yokken sayaç alanları UNAVAILABLE (0 DEĞİL)', () => {
    const v = buildVdkReplayView(EMPTY);
    const acc = v.sections.find((s) => s.id === 'accounting')!;
    expect(acc.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
    expect(acc.fields.some((f) => f.value === '0')).toBe(false);
  });

  it('🔒 KİLİT: GERÇEK sıfır ile KAYNAK YOK karışmaz', () => {
    const v = buildVdkReplayView(withRun({ mismatched: 0 }));
    const acc = v.sections.find((s) => s.id === 'accounting')!;
    const mis = acc.fields.find((f) => f.id === 'mismatched')!;
    expect(mis.klass).toBe('OBSERVED');
    expect(mis.value).toBe('0');
  });

  it('🔒 KİLİT: aktif koşuda CANLI damgalı olay varsa KARIŞIK denir', () => {
    const clean = buildVdkReplayView(withRun({ liveTraceEventCount: 7, replayStampedEventCount: 7 }));
    expect(clean.sections.find((s) => s.id === 'isolation')!
      .fields.find((f) => f.id === 'mix')!.value).toBe('TEMİZ');

    const dirty = buildVdkReplayView(withRun({ liveTraceEventCount: 9, replayStampedEventCount: 7 }));
    expect(dirty.sections.find((s) => s.id === 'isolation')!
      .fields.find((f) => f.id === 'mix')!.value).toBe('KARIŞIK');
  });

  it('🔒 KİLİT: boşluk sinyalleri KAYBOLMAZ ama ÇÖZÜLMEZ', () => {
    const v = buildVdkReplayView(withRun({ gapSignals: ['PARSER_GAP', 'UNKNOWN_ECU_VARIANT'] }));
    /* P0-VDK-F2C1: bölüm artık fonksiyonel sinyalleri de taşıyor; kilit
       REPLAY sinyallerinin kendi alanını hedefler (zayıflatılmadı). */
    const gaps = v.sections.find((s) => s.id === 'gaps')!
      .fields.find((f) => f.id === 'gaps')!;
    expect(gaps.value).toContain('PARSER_GAP');
    expect(gaps.value).toContain('UNKNOWN_ECU_VARIANT');
    expect(gaps.note).toMatch(/BU FAZDA ÇÖZÜLMEZ/);
  });

  it('🔒 KİLİT: her hüküm için Türkçe etiket VAR', () => {
    for (const k of ['PASS', 'PARITY_MISMATCH', 'TRACE_INVALID', 'INCOMPLETE', 'UNKNOWN'] as const) {
      expect(REPLAY_VERDICT_LABEL[k].length).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) EKRAN + KATALOG
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · LAB D) ekran ve katalog', () => {
  const screen = () => stripComments(
    readFileSync(resolve(__dirname, '../components/devtools/screens/VdkReplayScreen.tsx'), 'utf8'));

  it('🔒 KİLİT: ekran TIMER/ABONELİK kurmaz (açılışta tek okuma + elle YENİLE)', () => {
    const src = screen();
    expect(src).not.toMatch(/setInterval|setTimeout|addListener|subscribe\(/);
    expect(src).toMatch(/data-testid="vr-refresh"/);
  });

  it('🔒 KİLİT: ekran replay BAŞLATMAZ ve komut GÖNDERMEZ', () => {
    const src = screen();
    expect(src).not.toMatch(/startReplay|stopReplay|cancelReplay|CarLauncher/);
  });

  it('🔒 KİLİT: ekran unmount sonrası setState YAPMAZ (zero-leak)', () => {
    const src = screen();
    expect(src).toMatch(/mountedRef/);
    expect(src).toMatch(/mountedRef\.current = false/);
  });

  it('🔒 KİLİT: katalogda AVAILABLE olarak kayıtlı', () => {
    const entry = getCarosLabTool('vdk-replay');
    expect(entry, 'katalogda yok').not.toBeNull();
    expect(entry!.status).toBe('AVAILABLE');
    expect(entry!.category).toBe('communication');
    /* Katalog notu ölçülen katman sınırını AÇIKÇA beyan etmeli. */
    expect(entry!.note).toMatch(/parseDtcResponse/);
  });

  it('🔒 KİLİT: ekran haritasında lazy kayıt VAR', () => {
    const map = stripComments(
      readFileSync(resolve(__dirname, '../components/devtools/carosLabScreenMap.tsx'), 'utf8'));
    expect(map).toMatch(/case 'vdk-replay': return <VdkReplayScreen \/>;/);
    expect(map).toMatch(/import\('\.\/screens\/VdkReplayScreen'\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) FONKSIYONEL DTC COZUMLEYICISI BLOKU (P0-VDK-F2C1)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · LAB E) fonksiyonel cozumleyici blogu', () => {
  const fnFields = (s: VdkReplayRawSnapshot) =>
    buildVdkReplayView(s).sections.find((x) => x.id === 'functional')!.fields;

  it('KILIT: hic tur kosulmadiysa sahte satir URETILMEZ', () => {
    const f = fnFields(EMPTY);
    expect(f).toHaveLength(1);
    expect(f[0]!.klass).toBe('UNAVAILABLE');
  });

  it('KILIT: kanonik kaynak ACIKCA yazilir', () => {
    const f = fnFields(withRun({}));
    const src = f.find((x) => x.id === 'fn-03-src')!;
    expect(src.value).toContain('CANONICAL_TS');
    expect(src.note).toMatch(/urun otoritesidir|ürün otoritesidir/i);
  });

  it('KILIT: LEGACY_NATIVE gorulurse "kanonik parite KANITLANMADI" yazilir', () => {
    const f = fnFields(withRun({
      functionalEntries: [fnEntry({
        provenance: 'LEGACY_NATIVE', parity: 'NOT_APPLICABLE', block: 'RAW_ABSENT',
        parserOutcome: null, recordsDecoded: null, paddingRecords: null,
        inputBytes: null, leftoverBytes: null, positiveSid: null,
        ecuAttribution: null, bodyCount: null,
      })],
    }));
    const src = f.find((x) => x.id === 'fn-03-src')!;
    expect(src.value).toContain('LEGACY_NATIVE');
    expect(src.note).toMatch(/KANITLANMADI/);
    /* Kanonik cozum yokken kayit sayaci URETILMEZ. */
    expect(f.find((x) => x.id === 'fn-03-rec')!.klass).toBe('UNAVAILABLE');
    /* Engel sebebi GORUNUR. */
    expect(f.find((x) => x.id === 'fn-03-block')!.value).toBe('RAW_ABSENT');
  });

  it('KILIT: PARITE CELISKISI gizlenmez', () => {
    const f = fnFields(withRun({
      functionalEntries: [fnEntry({ parity: 'MISMATCH', parityDetail: 'yalniz native: P9999' })],
    }));
    const p = f.find((x) => x.id === 'fn-03-parity')!;
    expect(p.value).toContain('MISMATCH');
    expect(p.value).toContain('P9999');
  });

  it('KILIT: bozukluk sebebi GIZLENMEZ', () => {
    const f = fnFields(withRun({
      functionalEntries: [fnEntry({ malformedReason: 'PARTIAL_COUNT', recordsDecoded: 0 })],
    }));
    expect(f.find((x) => x.id === 'fn-03-bad')!.value).toBe('PARTIAL_COUNT');
  });

  it('KILIT: fonksiyonel bosluk sinyalleri bosluk bolumunde GORUNUR', () => {
    const v = buildVdkReplayView(withRun({
      functionalGapSignals: ['LEGACY_NATIVE_ONLY', 'PARSER_PARITY_MISMATCH'],
    }));
    const g = v.sections.find((x) => x.id === 'gaps')!.fields.find((x) => x.id === 'fn-gaps')!;
    expect(g.value).toContain('LEGACY_NATIVE_ONLY');
    expect(g.value).toContain('PARSER_PARITY_MISMATCH');
    expect(g.note).toMatch(/BU FAZDA COZULMEZ|BU FAZDA ÇÖZÜLMEZ/);
  });

  it('KILIT: ECU atfi UNKNOWN ise uydurulmaz', () => {
    const f = fnFields(withRun({
      functionalEntries: [fnEntry({ ecuAttribution: 'UNKNOWN', bodyCount: 2 })],
    }));
    const a = f.find((x) => x.id === 'fn-03-attr')!;
    expect(a.value).toBe('UNKNOWN');
    expect(a.note).toMatch(/VARSAYILMAZ/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) UYGUNLUK KOSUSU BLOKU + BOSLUK SICILI (P0-VDK-F2C2)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C2 · LAB F) uygunluk kosusu blogu', () => {
  const cfFields = (s: VdkReplayRawSnapshot) =>
    buildVdkReplayView(s).sections.find((x) => x.id === 'conformance')!.fields;

  const run = (p: Partial<ConformanceRunResult> = {}): ConformanceRunResult => ({
    runId: 'R', provenance: 'SIMULATED', verdict: 'PASS', checks: [],
    stage: 'COMPARE', abort: null, abortDetail: null,
    sourceTraceId: 'T1', sourceEventCount: 12, packageChecksum: 'abcd1234',
    mismatchLayers: [], gapSignals: [],
    counts: { match: 34, mismatch: 0, unmeasured: 0 },
    ...p,
  });

  it('KILIT: kosu YOKSA "gecti" VARSAYILMAZ', () => {
    const f = cfFields(EMPTY);
    expect(f).toHaveLength(1);
    expect(f[0]!.klass).toBe('UNAVAILABLE');
  });

  it('KILIT: SIMULATED kosu SAHA KANITI degildir — ekran bunu YAZAR', () => {
    const f = cfFields({ ...EMPTY, conformance: run() });
    const prov = f.find((x) => x.id === 'cf-provenance')!;
    expect(prov.value).toContain('SIMULATED');
    expect(prov.note).toMatch(/SAHA DOGRULAMASI SAYILMAZ|SAHA DOĞRULAMASI SAYILMAZ/);
  });

  it('KILIT: FIELD kosu saha kaniti olarak isaretlenir', () => {
    const f = cfFields({ ...EMPTY, conformance: run({ provenance: 'FIELD' }) });
    expect(f.find((x) => x.id === 'cf-provenance')!.value).toContain('FIELD');
  });

  it('KILIT: UNMEASURED sayaci gorunur ve PASS degil INCOMPLETE yazar', () => {
    const f = cfFields({
      ...EMPTY,
      conformance: run({ verdict: 'INCOMPLETE', counts: { match: 30, mismatch: 0, unmeasured: 4 } }),
    });
    expect(f.find((x) => x.id === 'cf-counts')!.value).toContain('UNMEASURED 4');
    expect(f.find((x) => x.id === 'cf-verdict')!.value).toContain('INCOMPLETE');
  });

  it('KILIT: MISMATCH katmani ve ayrintisi GIZLENMEZ', () => {
    const f = cfFields({
      ...EMPTY,
      conformance: run({
        verdict: 'FAIL',
        counts: { match: 30, mismatch: 2, unmeasured: 0 },
        mismatchLayers: ['TRANSPORT', 'AUTHORITY'],
        checks: [{
          id: 'x', label: 'canli↔FAST · ham yanit sirasi', outcome: 'MISMATCH',
          layer: 'TRANSPORT', detail: 'responses #3: "A" → "B"',
        }],
      }),
    });
    expect(f.find((x) => x.id === 'cf-layers')!.value).toBe('TRANSPORT → AUTHORITY');
    const chk = f.find((x) => x.id.startsWith('cf-chk-'))!;
    expect(chk.value).toBe('MISMATCH');
    expect(chk.note).toContain('responses #3');
  });

  it('KILIT: kesinti GIZLENMEZ', () => {
    const f = cfFields({
      ...EMPTY,
      conformance: run({
        verdict: 'ABORTED', stage: 'IMPORT',
        abort: 'IMPORT_REJECTED', abortDetail: 'CHECKSUM_MISMATCH',
      }),
    });
    expect(f.find((x) => x.id === 'cf-abort')!.value).toContain('IMPORT_REJECTED');
    expect(f.find((x) => x.id === 'cf-stage')!.value).toBe('IMPORT');
  });

  it('KILIT: bosluk sicili gorunur ve "cozuldu" demez', () => {
    const v = buildVdkReplayView({
      ...EMPTY,
      gapRegistry: [{
        signal: 'UNKNOWN_ECU_ATTRIBUTION', scope: 'PARSER', context: 'mode03',
        count: 3, firstSeenMs: 1, lastSeenMs: 2, runId: 'R',
      }],
      gapRegistryDropped: 0,
    });
    const g = v.sections.find((x) => x.id === 'gaps')!.fields.find((x) => x.id === 'gap-reg')!;
    expect(g.value).toContain('UNKNOWN_ECU_ATTRIBUTION@mode03×3');
    expect(g.note).toMatch(/otomatik kapatilmaz|otomatik kapatılmaz/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G) PDU TASIMA GORUNURLUGU (P0-VDK-F3A)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3A · LAB G) PDU tasimasi', () => {
  const pduFields = (s: VdkReplayRawSnapshot) =>
    buildVdkReplayView(s).sections.find((x) => x.id === 'isolation')!.fields;

  it('KILIT: aktif tasima ve tasinabilen servisler GORUNUR', () => {
    const f = pduFields(EMPTY);
    expect(f.find((x) => x.id === 'pdu-kind')!.value).toBe('elm327');
    expect(f.find((x) => x.id === 'pdu-services')!.value).toContain('19');
    expect(f.find((x) => x.id === 'pdu-services')!.value).toContain('3E');
  });

  it('KILIT: tasinamayan servis "arac desteklemiyor" DEGILDIR — ekran yazar', () => {
    const note = pduFields(EMPTY).find((x) => x.id === 'pdu-services')!.note;
    expect(note).toMatch(/DEMEK DEGILDIR|DEĞİLDİR/);
    expect(note).toMatch(/sorulamadi|sorulamadı/);
  });

  it('KILIT: genel ham PDU yolunun YOK oldugu acikca beyan edilir', () => {
    const f = pduFields(EMPTY).find((x) => x.id === 'pdu-arbitrary')!;
    expect(f.value).toBe('YOK');
    expect(f.note).toMatch(/kopru degisikligi|köprü değişikliği/);
  });

  it('KILIT: replay altinda sanal tasima gorunur', () => {
    const f = pduFields({
      ...EMPTY,
      pduCapabilities: {
        kind: 'virtual', supportsArbitraryPdu: false,
        supportedServices: ['03', '07', '0A', '19', '18', '13', '3E'],
      },
    });
    expect(f.find((x) => x.id === 'pdu-kind')!.value).toBe('virtual');
  });

  it('KILIT: yetenek okunamazsa "her seyi tasir" VARSAYILMAZ', () => {
    const f = pduFields({ ...EMPTY, pduCapabilities: null });
    expect(f.find((x) => x.id === 'pdu-cap')!.klass).toBe('UNAVAILABLE');
  });
});
