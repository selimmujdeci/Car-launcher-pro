/**
 * carosLabToolCalling.test.tsx — CAROS LAB · Araç Çağrısı KİLİTLERİ.
 *
 * ANA İLKE: bu tur YENİ VERİ ÜRETMEDİ — `runToolLoop`ın ZATEN ürettiği
 * gizlilik-güvenli telemetriyi bounded bir deftere yazdı. Kilitler üç şeyi
 * korur: (1) argüman/sonuç sızmaması, (2) hiç çağrı yokken oran uydurulmaması,
 * (3) tavana takılan turun ayrı sayılması.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import {
  recordToolCall, recordToolLoopEnd, getToolCallEvidence,
  _resetToolCallEvidenceForTest, TOOL_EVIDENCE_CAPACITY,
} from '../platform/ai/tools/toolCallEvidence';
import {
  buildToolCallFields, breakdownByTool, dominantErrorCode,
  deriveToolCallVerdict, successRate, toolCallVerdictTone,
  type ToolCallRecordShape, type ToolCallingInput,
} from '../platform/devtools/toolCallingModel';
import { ToolCallingScreen } from '../components/devtools/screens/ToolCallingScreen';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = 1_700_000_000_000;

const tel = (over: Record<string, unknown> = {}) => ({
  toolName: 'getVehicleSpeed',
  effect: 'read' as const,
  ok: true,
  durationMs: 120,
  resultFields: 2,
  ...over,
}) as never;

function rec(over: Partial<ToolCallRecordShape> = {}): ToolCallRecordShape {
  return {
    toolName: 'getVehicleSpeed', effect: 'read', ok: true,
    errorCode: null, durationMs: 100, resultFields: 2, atMs: NOW,
    ...over,
  };
}

function input(over: Partial<ToolCallingInput> = {}): ToolCallingInput {
  return {
    records: [], capacity: TOOL_EVIDENCE_CAPACITY,
    totalCalls: 0, failedCalls: 0, totalLoops: 0, cappedLoops: 0,
    lastCallAtMs: null, nowMs: NOW,
    ...over,
  };
}

const fieldOf = (fs: readonly { id: string }[], id: string) => fs.find((f) => f.id === id);

/* ══════════════════════════════════════════════════════════════════════════
 * 1) DEFTER
 * ═════════════════════════════════════════════════════════════════════════ */
describe('toolCallEvidence › defter', () => {
  beforeEach(() => { _resetToolCallEvidenceForTest(); });

  it('çağrıyı kaydeder ve sayaçları ilerletir', () => {
    recordToolCall(tel(), NOW);
    recordToolCall(tel({ ok: false, errorCode: 'timeout' }), NOW + 10);
    const ev = getToolCallEvidence();
    expect(ev.totalCalls).toBe(2);
    expect(ev.failedCalls).toBe(1);
    expect(ev.lastCallAtMs).toBe(NOW + 10);
  });

  it('halka tampon TAVANI aşmaz ama doyumlu sayaç ARTMAYA DEVAM eder', () => {
    for (let i = 0; i < TOOL_EVIDENCE_CAPACITY + 15; i++) recordToolCall(tel(), NOW + i);
    const ev = getToolCallEvidence();
    expect(ev.records.length).toBe(TOOL_EVIDENCE_CAPACITY);
    expect(ev.totalCalls).toBe(TOOL_EVIDENCE_CAPACITY + 15);
  });

  it('tur ve TAVAN sayacı ayrı ilerler', () => {
    recordToolLoopEnd(false);
    recordToolLoopEnd(true);
    const ev = getToolCallEvidence();
    expect(ev.totalLoops).toBe(2);
    expect(ev.cappedLoops).toBe(1);
  });

  it('bozuk telemetri defteri KIRMAZ (fail-soft)', () => {
    expect(() => recordToolCall(null as never, NOW)).not.toThrow();
    expect(() => recordToolCall({} as never, NOW)).not.toThrow();
    expect(getToolCallEvidence().totalCalls).toBe(0);
  });

  it('geçersiz damga sahte 0 üretmez ama defteri bozmaz', () => {
    recordToolCall(tel(), Number.NaN);
    expect(getToolCallEvidence().lastCallAtMs).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) DÜRÜSTLÜK — oran uydurma yasağı ve tavan
 * ═════════════════════════════════════════════════════════════════════════ */
describe('toolCalling › dürüstlük', () => {
  it('hiç çağrı yokken başarı oranı UYDURULMAZ', () => {
    expect(successRate({ totalCalls: 0, failedCalls: 0 })).toBeNull();
    const f = fieldOf(buildToolCallFields(input()), 'tc-rate');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toMatch(/UYDURULMAZ/);
    expect(f?.value).not.toBe('%100');
  });

  it('hiç çağrı yokken hüküm NO_CALLS — "sağlıklı" DEĞİL', () => {
    expect(deriveToolCallVerdict({ totalCalls: 0, failedCalls: 0, cappedLoops: 0 }))
      .toBe('NO_CALLS');
    expect(toolCallVerdictTone('NO_CALLS')).toBe('muted');
  });

  it('TAVAN hükmü HEALTHY durumunu EZER', () => {
    // Tüm çağrılar başarılı ama model istediği aracı alamadı.
    expect(deriveToolCallVerdict({ totalCalls: 5, failedCalls: 0, cappedLoops: 2 }))
      .toBe('CAPPED');
  });

  it('hepsi düşerse FAILING, bir kısmı düşerse DEGRADED', () => {
    expect(deriveToolCallVerdict({ totalCalls: 3, failedCalls: 3, cappedLoops: 0 }))
      .toBe('FAILING');
    expect(deriveToolCallVerdict({ totalCalls: 3, failedCalls: 1, cappedLoops: 0 }))
      .toBe('DEGRADED');
    expect(deriveToolCallVerdict({ totalCalls: 3, failedCalls: 0, cappedLoops: 0 }))
      .toBe('HEALTHY');
  });

  it('damga yoksa son çağrı yaşı HESAPLANMAZ', () => {
    const f = fieldOf(buildToolCallFields(input()), 'tc-last');
    expect(f?.klass).toBe('UNAVAILABLE');
  });

  it('süresi ölçülmemiş çağrılar ortalamayı BOZMAZ', () => {
    const b = breakdownByTool([
      rec({ durationMs: 100 }), rec({ durationMs: 0 }), rec({ durationMs: 200 }),
    ]);
    expect(b[0].avgMs).toBe(150);           // yalnız 100 ve 200 sayılır
    expect(b[0].calls).toBe(3);
  });

  it('hiç süre ölçülmemişse ortalama null (sahte 0 YOK)', () => {
    expect(breakdownByTool([rec({ durationMs: 0 })])[0].avgMs).toBeNull();
  });

  it('baskın hata kodu yalnız BAŞARISIZ kayıtlardan çıkar', () => {
    expect(dominantErrorCode([
      rec({ ok: false, errorCode: 'timeout' }),
      rec({ ok: false, errorCode: 'timeout' }),
      rec({ ok: false, errorCode: 'denied' }),
      rec({ ok: true, errorCode: null }),
    ])).toBe('timeout');
    expect(dominantErrorCode([rec()])).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) GİZLİLİK
 * ═════════════════════════════════════════════════════════════════════════ */
describe('toolCalling › gizlilik', () => {
  it('defter tipi ARGÜMAN veya SONUÇ alanı TAŞIMAZ', () => {
    const src = stripComments(read('src/platform/ai/tools/toolCallEvidence.ts'));
    const shape = src.slice(
      src.indexOf('export interface ToolCallRecord'),
      src.indexOf('export interface ToolCallEvidence'),
    );
    for (const forbidden of ['arguments', 'args', 'result', 'summary', 'content', 'text']) {
      expect(shape, `${forbidden} sızdı`).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });

  it('defter kalıcı depoya YAZMAZ (süreç ömürlü)', () => {
    const src = stripComments(read('src/platform/ai/tools/toolCallEvidence.ts'));
    expect(src).not.toMatch(/localStorage|safeStorage|Preferences|writeFile/);
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });

  it('defter kendi Date.now\'ını çağırmaz — damga DIŞARIDAN gelir', () => {
    const src = stripComments(read('src/platform/ai/tools/toolCallEvidence.ts'));
    expect(src).not.toMatch(/Date\.now\(/);
  });

  it('ekran araç ÇAĞIRMAZ / tool loop başlatmaz', () => {
    const src = stripComments(read('src/components/devtools/screens/ToolCallingScreen.tsx'));
    expect(src).not.toMatch(/runToolLoop|router\.call|_resetToolCallEvidence/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) KABLO — runToolLoop defteri BESLİYOR
 * ═════════════════════════════════════════════════════════════════════════ */
describe('toolCalling › kablo', () => {
  it('runToolLoop her çağrıyı defterler ve tur sonunu bildirir', () => {
    const src = stripComments(read('src/platform/ai/tools/toolLoop.ts'));
    expect(src).toMatch(/recordToolCall\(outcome\.telemetry, Date\.now\(\)\)/);
    // Üç çıkış noktasının hepsi tur sonunu bildirmeli.
    const ends = src.match(/recordToolLoopEnd\(/g) ?? [];
    expect(ends.length).toBeGreaterThanOrEqual(3);
    // TAVAN yalnız model HÂLÂ araç isterken bildirilmeli.
    expect(src).toMatch(/recordToolLoopEnd\(isLastRound && calls\.length > 0\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) KATALOG + EKRAN
 * ═════════════════════════════════════════════════════════════════════════ */
describe('toolCalling › katalog ve ekran', () => {
  it('katalog AVAILABLE ve gerçek ekran eşlemesi var', () => {
    expect(getCarosLabTool('tool-calling')?.status).toBe('AVAILABLE');
    expect(renderAvailableTool('tool-calling')).not.toBeNull();
    expect(getCarosLabTool('tool-calling')?.note).not.toMatch(/^Ekran yok/);
  });

  it('ekran render olur ve salt-okunur beyanını basar', () => {
    const html = renderToStaticMarkup(<ToolCallingScreen />);
    expect(html).toContain('ARAÇ ÇAĞRISI');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('data-testid="tc-verdict"');
  });

  it('ekran TIMER kurmaz ve unmount sonrası setState yapmaz', () => {
    const src = read('src/components/devtools/screens/ToolCallingScreen.tsx');
    expect(src).not.toMatch(/setInterval\(/);
    expect(src).toContain('mountedRef');
    expect(src).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });

  it('saf model I/O · timer · Date.now İÇERMEZ', () => {
    const src = stripComments(read('src/platform/devtools/toolCallingModel.ts'));
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });
});
