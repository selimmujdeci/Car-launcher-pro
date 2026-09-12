/**
 * maviDecisionExplainability.test.ts — açıklanabilir karar zinciri (Görev 3).
 *
 * ── KANITLANAN DİKEY ZİNCİR ─────────────────────────────────────────────────
 *   gerçek karar kaynağı  (triggerProactiveDiagnosticAlert — rule-based)
 *     → mevcut evidence kaydı (aiOfflineReason proaktif karar halkası)
 *       → mevcut diagnostic trail (diagnosticTrailCore.pushTrail)
 *         → CAROS LAB Mavi Konsolu · "E" bölümü
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  · YENİ DecisionEnvelope / paralel telemetry modeli KURULMADI.
 *  · `TakeoverDecisionRecord` DOKUNULMADI (yalnız sahiplik semantiği taşır).
 *  · Kaynağı olmayan alan yazılmaz — sahte confidence YOK.
 *  · İki confidence ölçeği (0-100 / 0-1) BİRLEŞTİRİLMEZ; ölçek birlikte taşınır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  triggerProactiveDiagnosticAlert, getProactiveAlertDiagnostics,
  _resetCompanionChatForTest, PROACTIVE_ALERT_DEBOUNCE_MS,
  type ProactiveVerdictLike,
} from '../platform/companion/companionChatProvider';
import {
  getProactiveSuppressionHistory, recordProactiveDecision, sanitizeReasonSummary,
  _resetAiOfflineReasonForTest, MAX_REASON_SUMMARY_CHARS,
  type ProactiveSuppressionRecord,
} from '../platform/ai/aiOfflineReason';
import { _resetDiagnosticTrailForTest } from '../platform/diagnosticTrail';
import { getOwnTrail } from '../platform/diagnosticTrailCore';
import { readMaviConsoleSnapshot } from '../platform/devtools/maviConsoleSources';
import { buildMaviSections } from '../platform/devtools/maviConsoleModel';

/** GERÇEK kaynak biçimi: diagnosticTriage.RootCauseHypothesis (confidence 0-100). */
function verdict(over: { confidence?: number | null; problem?: string; code?: string } = {}): ProactiveVerdictLike {
  const hyp: Record<string, unknown> = {
    problem: over.problem ?? 'Soğutma fanı devrede değil',
    severity: 'critical',
    code: over.code ?? 'ROOT_FAN',
  };
  if (over.confidence !== null) hyp.confidence = over.confidence ?? 87;
  return { hasActiveRootCause: true, topRootCauses: [hyp as never] };
}

const SAFE = {} as const;
const spoke = vi.fn();

function trigger(v: ProactiveVerdictLike, now = 0) {
  return triggerProactiveDiagnosticAlert(v, { onSpeak: spoke, safety: SAFE, now: () => now });
}
function lastRecord(): ProactiveSuppressionRecord {
  const h = getProactiveSuppressionHistory();
  return h[h.length - 1];
}
function trailRows() {
  return getOwnTrail().filter((e) => e.label.startsWith('mavi proaktif:'));
}

beforeEach(() => {
  spoke.mockClear();
  _resetCompanionChatForTest();
  _resetAiOfflineReasonForTest();
  _resetDiagnosticTrailForTest();
});

/* ── 1 + 2. Rule-based karar → bounded reasonCode + gerçek confidence ─── */

describe('1/2 — gerçek rule-based karar bounded kodla ve GERÇEK ölçekle kaydedilir', () => {
  it('konuşulan karar: reasonCode=ok, source=rule, confidence 0-100 ölçeğinde AYNEN taşınır', () => {
    const r = trigger(verdict({ confidence: 87 }));
    expect(r.outcome).toBe('spoken');
    expect(r.reason).toBe('ok');

    const rec = lastRecord();
    expect(rec.outcome).toBe('spoken');
    expect(rec.reasonCode).toBe('ok');
    expect(rec.source).toBe('rule');                    // LLM DEĞİL
    expect(rec.confidence).toBe(87);                    // değer AYNEN
    expect(rec.confidenceScale).toBe('percent_0_100');  // ölçek BİRLİKTE

    const diag = getProactiveAlertDiagnostics();
    expect(diag.lastReasonCode).toBe('ok');
    expect(diag.lastConfidence).toBe(87);
    expect(diag.lastConfidenceScale).toBe('percent_0_100');
    expect(diag.lastDecisionSource).toBe('rule');
  });

  it('ölçek sessizce NORMALIZE EDİLMEZ (0-100 → 0-1 dönüşümü YOK)', () => {
    trigger(verdict({ confidence: 87 }));
    expect(lastRecord().confidence).not.toBeCloseTo(0.87);
    expect(lastRecord().confidence).toBe(87);
  });
});

/* ── 3. Kaynak yoksa SAHTE değer üretilmez ────────────────────────────── */

describe('3 — confidence kaynağı yoksa sahte değer üretilmez', () => {
  it('hipotezde confidence YOKSA alan HİÇ yazılmaz (0 da yazılmaz)', () => {
    trigger(verdict({ confidence: null }));
    const rec = lastRecord();
    expect(rec.confidence).toBeUndefined();
    expect(rec.confidenceScale).toBeUndefined();
    expect('confidence' in rec).toBe(false);

    const diag = getProactiveAlertDiagnostics();
    expect(diag.lastConfidence).toBeNull();       // null = BİLİNMİYOR (0 DEĞİL)
    expect(diag.lastConfidenceScale).toBeNull();
  });

  it('ölçeksiz confidence veya değersiz ölçek → İKİSİ DE yazılmaz', () => {
    recordProactiveDecision({ outcome: 'spoken', reasonCode: 'ok', confidence: 55 });
    expect(lastRecord().confidence).toBeUndefined();
    _resetAiOfflineReasonForTest();
    recordProactiveDecision({ outcome: 'spoken', reasonCode: 'ok', confidenceScale: 'unit_0_1' });
    expect(lastRecord().confidenceScale).toBeUndefined();
  });

  it('fallbackReason bu yolda KAYNAKSIZ → yazılmaz', () => {
    trigger(verdict());
    expect(lastRecord().fallbackReason).toBeUndefined();
  });
});

/* ── 4 + 5. Suppression / fallback gerekçesi görünür ──────────────────── */

describe('4/5 — suppressed kararda suppressionReason, fallback kaynağı varsa fallbackReason', () => {
  it('geri manevrada suppressionReason görünür', () => {
    const r = triggerProactiveDiagnosticAlert(verdict(), {
      onSpeak: spoke, safety: { reverseActive: true }, now: () => 0,
    });
    expect(r.outcome).toBe('suppressed');
    const rec = lastRecord();
    expect(rec.outcome).toBe('suppressed');
    expect(rec.suppressionReason).toBe('reverse_attention');
    expect(rec.reasonCode).toBe('reverse_attention');
  });

  it('debounce susturmasında da gerekçe + güven taşınır', () => {
    trigger(verdict({ confidence: 91 }), 0);
    const r = trigger(verdict({ confidence: 91 }), PROACTIVE_ALERT_DEBOUNCE_MS - 1);
    expect(r.reason).toBe('debounce');
    const rec = lastRecord();
    expect(rec.suppressionReason).toBe('debounce');
    expect(rec.confidence).toBe(91);
  });

  it('konuşulan kararda suppressionReason YAZILMAZ', () => {
    trigger(verdict());
    expect(lastRecord().suppressionReason).toBeUndefined();
  });

  it('fallbackReason gerçek kaynak verildiğinde taşınır', () => {
    recordProactiveDecision({ outcome: 'suppressed', reasonCode: 'wiring_error', fallbackReason: 'provider_timeout' });
    expect(lastRecord().fallbackReason).toBe('provider_timeout');
  });
});

/* ── 6. Geriye uyum ───────────────────────────────────────────────────── */

describe('6 — eski kayıtlar yeni alanlar OLMADAN okunur', () => {
  it('yalnız eski alanları taşıyan kayıt okunabilir (opsiyonel alanlar undefined)', () => {
    const legacy = {
      reason: 'PROACTIVE_SAFETY_SUPPRESSED', timestamp: '2026-01-01T00:00:00.000Z',
      atMs: 1, alertKey: 'ROOT_X', detail: 'debounce',
    } as ProactiveSuppressionRecord;

    expect(legacy.outcome).toBeUndefined();
    expect(legacy.confidence).toBeUndefined();
    expect(legacy.reasonCode).toBeUndefined();
    expect(legacy.detail).toBe('debounce');        // eski okuyucular çalışmaya devam eder
  });

  it('yeni kayıt eski `detail` alanını DA doldurur (eski okuyucu bozulmaz)', () => {
    trigger(verdict());
    expect(lastRecord().detail).toBe('ok');
  });
});

/* ── 7 + 8. Sanitize / gizlilik ───────────────────────────────────────── */

describe('7/8 — uzun ve hassas metin sanitize/truncate; ham girdi SIZMAZ', () => {
  it('uzun özet tavana kırpılır', () => {
    const long = 'A'.repeat(400);
    expect(sanitizeReasonSummary(long)!.length).toBeLessThanOrEqual(MAX_REASON_SUMMARY_CHARS);
    trigger(verdict({ problem: long }));
    expect(lastRecord().reasonSummary!.length).toBeLessThanOrEqual(MAX_REASON_SUMMARY_CHARS);
  });

  it('satır sonu / kontrol karakteri / işaretleme temizlenir', () => {
    const dirty = 'Fan\n\tarızası <script>alert(1)</script> {"raw":"x"}';
    const clean = sanitizeReasonSummary(dirty)!;
    expect(clean).not.toMatch(/[\r\n\t<>{}"]/);
    expect(clean).toContain('Fan');
  });

  it('ham prompt / chain-of-thought / kullanıcı mesajı / seslendirilen metin TRAIL\'e girmez', () => {
    const r = trigger(verdict());
    expect(r.outcome).toBe('spoken');
    const spokenText = r.text!;
    const blob = JSON.stringify(trailRows()) + JSON.stringify(getProactiveSuppressionHistory());

    // Seslendirilen TAM metin taşınmaz…
    expect(blob).not.toContain(spokenText);
    // …ve tipik gizli-girdi imzaları da yok.
    for (const leak of ['system_instruction', 'Düşünce:', 'chain-of-thought', 'apiKey', 'Bearer ']) {
      expect(blob).not.toContain(leak);
    }
  });
});

/* ── 9. CAROS LAB gerçek trail kaynağından okur ───────────────────────── */

describe('9 — CAROS LAB görünürlüğü GERÇEK kaynaklardan', () => {
  it('karar mevcut diagnostic trail\'e tek satır olarak yazılır', () => {
    trigger(verdict({ confidence: 87, code: 'ROOT_FAN' }));
    const rows = trailRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('action');
    expect(rows[0].label).toBe('mavi proaktif: spoken');
    expect(rows[0].detail).toContain('reason=ok');
    expect(rows[0].detail).toContain('key=ROOT_FAN');
    expect(rows[0].detail).toContain('conf=87%');     // ölçek AÇIK yazılır
  });

  it('Mavi Konsolu "E" bölümü karar alanlarını gerçek kaynaklardan gösterir', () => {
    trigger(verdict({ confidence: 87 }));
    const sections = buildMaviSections(readMaviConsoleSnapshot());
    const e = sections.find((s) => s.id === 'proactive')!;
    const byId = (id: string) => e.fields.find((f) => f.id === id)!;

    expect(byId('mvPaReasonCode').klass).toBe('OBSERVED');
    expect(String(byId('mvPaConfidence').value)).toContain('percent_0_100');
    expect(byId('mvPaSource').value).toBe('rule');
    expect(byId('mvPaTrailRows').klass).toBe('OBSERVED');
    // (InspectorField.value görüntü için dizeleştirilir)
    expect(Number(byId('mvPaTrailRows').value)).toBeGreaterThanOrEqual(1);   // GERÇEK trail sayımı
  });

  it('karar yokken alanlar UNAVAILABLE — sahte 0/varsayılan BASILMAZ', () => {
    const sections = buildMaviSections(readMaviConsoleSnapshot());
    const e = sections.find((s) => s.id === 'proactive')!;
    for (const id of ['mvPaReasonCode', 'mvPaConfidence', 'mvPaSource', 'mvPaSummary']) {
      expect(e.fields.find((f) => f.id === id)!.klass, id).toBe('UNAVAILABLE');
    }
  });
});

/* ── 10. Mevcut davranış DEĞİŞMEDİ ────────────────────────────────────── */

describe('10 — yeni alanlar execution/takeover davranışını DEĞİŞTİRMEZ', () => {
  it('TakeoverDecisionRecord\'a DOKUNULMADI (yalnız sahiplik semantiği)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'maviCore', 'wiring', 'maviEvidence.ts'), 'utf-8');
    const block = src.slice(src.indexOf('interface TakeoverDecisionRecord'), src.indexOf('interface MediaNextRecord'));
    for (const f of ['reasonCode', 'reasonSummary', 'confidence', 'suppressionReason', 'fallbackReason']) {
      expect(block, `TakeoverDecisionRecord '${f}' TAŞIMAMALI`).not.toContain(f);
    }
  });

  it('karar akışı (spoken/suppressed + debounce) eskisiyle AYNI kalır', () => {
    expect(trigger(verdict(), 0).outcome).toBe('spoken');
    expect(spoke).toHaveBeenCalledTimes(1);
    expect(trigger(verdict(), 1).reason).toBe('debounce');
    expect(spoke).toHaveBeenCalledTimes(1);
    expect(trigger(verdict(), PROACTIVE_ALERT_DEBOUNCE_MS).outcome).toBe('spoken');
    expect(spoke).toHaveBeenCalledTimes(2);
  });

  it('kayıt hattı YENİ timer/poll/storage AÇMAZ (kaynak kilidi)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'companion', 'companionChatProvider.ts'), 'utf-8');
    const block = src.slice(src.indexOf('function _emitDecisionEvidence'), src.indexOf('export function triggerProactiveDiagnosticAlert'));
    for (const f of ['setInterval', 'setTimeout', 'safeSetRaw', 'localStorage', 'fetch(', '.subscribe(']) {
      expect(block, `karar kayıt hattı '${f}' kullanmamalı`).not.toContain(f);
    }
  });
});
