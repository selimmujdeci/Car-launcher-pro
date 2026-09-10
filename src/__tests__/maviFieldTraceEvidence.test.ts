/**
 * maviFieldTraceEvidence.test.ts — MAVI-FIELD-1 · saha kaydı + ilk ses kanıtı.
 *
 * ── NE KİLİTLER ─────────────────────────────────────────────────────────────
 *  1. PROXY, KANIT gibi sunulamaz: yalnız `first_audio_requested` varsa satır
 *     `~` öneki ve `PROXY_ONLY` etiketi taşır.
 *  2. Ölçülmeyen alan `-` yazar; sıfır UYDURULMAZ.
 *  3. Sağlayıcı kritik yolda değilse `BYPASSED_LOCAL` AÇIKÇA görünür — yerel
 *     turun sağlayıcı süresi "0 ms" diye okunamaz.
 *  4. `speech_end` türetilmişse satır bunu söyler (native VAD deltası).
 *
 * ⚠️ Bu dosya SAHA kanıtı DEĞİLDİR. Testin geçmesi gerçek head-unit'te 2 sn
 * hedefinin tuttuğu anlamına GELMEZ (CLAUDE.md §11).
 */

import { describe, it, expect } from 'vitest';
import {
  buildFieldTraceLines,
  firstAudioEvidenceOf,
  type TraceShape,
} from '../platform/devtools/maviLatencyModel';

function trace(opts: {
  turnId?: number;
  route: string | null;
  marks: Record<string, number>;
  derivedSpeechEnd?: boolean;
  outcome?: string;
  provider?: string | null;
}): TraceShape {
  const marks: Record<string, { at: number; origin?: string } | undefined> = {};
  for (const [k, v] of Object.entries(opts.marks)) {
    marks[k] = { at: v, origin: k === 'speech_end' && opts.derivedSpeechEnd ? 'derived' : 'observed' };
  }
  return {
    traceId: 7, turnId: opts.turnId ?? 3, marks, route: opts.route,
    provider: opts.provider ?? null, presence: null,
    outcome: opts.outcome ?? 'completed',
    failureCode: null, fillerCount: 0, ackCount: 0, partialCount: 0,
    endpointReason: 'ACOUSTIC_TIMEOUT', sttCapability: null,
    endpointCommanded: false, speechChunkCount: 0, llmCapability: null,
    streamEndReason: null, bargeIn: false,
  } as unknown as TraceShape;
}

describe('ilk ses kanıt derecesi', () => {
  it('yalnız istek varsa REQUESTED (kanıt DEĞİL)', () => {
    const t = trace({ route: 'local_fast_path', marks: { speech_end: 0, first_audio_requested: 900 } });
    expect(firstAudioEvidenceOf(t)).toBe('REQUESTED');
  });

  it('oynatma geri bildirimi varsa CONFIRMED', () => {
    const t = trace({
      route: 'local_fast_path',
      marks: { speech_end: 0, first_audio_requested: 900, first_audio_confirmed: 1_050 },
    });
    expect(firstAudioEvidenceOf(t)).toBe('CONFIRMED');
  });

  it('hiç ses damgası yoksa NONE', () => {
    expect(firstAudioEvidenceOf(trace({ route: null, marks: { speech_end: 0 } }))).toBe('NONE');
  });
});

describe('saha kaydı — dürüstlük', () => {
  it('PROXY süre "~" ile işaretlenir ve PROXY_ONLY olarak etiketlenir', () => {
    const [line] = buildFieldTraceLines([
      trace({ route: 'local_fast_path', marks: { speech_end: 0, first_audio_requested: 1_400 } }),
    ]);
    expect(line).toContain('total=~1400');
    expect(line).toContain('evidence=REQUESTED');
    expect(line).not.toContain('total=1400 ');   // çıplak sayı = kanıt iddiası
  });

  it('KANITLI süre "~" TAŞIMAZ', () => {
    const [line] = buildFieldTraceLines([
      trace({
        route: 'local_fast_path',
        marks: { speech_end: 0, first_audio_requested: 1_400, first_audio_confirmed: 1_600 },
      }),
    ]);
    expect(line).toContain('total=1600');
    expect(line).toContain('evidence=CONFIRMED');
    expect(line).not.toContain('~');
  });

  it('ölçülmeyen alan "-" yazar (sıfır uydurulmaz)', () => {
    const [line] = buildFieldTraceLines([
      trace({ route: 'local_fast_path', marks: { speech_end: 0 } }),
    ]);
    expect(line).toContain('endpoint=-');
    expect(line).toContain('asr=-');
    expect(line).toContain('total=-');
    expect(line).not.toContain('=0ms');
  });

  it('yerel turda sağlayıcı BYPASSED_LOCAL olarak görünür (0 ms DEĞİL)', () => {
    const [line] = buildFieldTraceLines([
      trace({ route: 'local_fast_path', marks: { speech_end: 0, first_audio_confirmed: 900 } }),
    ]);
    expect(line).toContain('provider=BYPASSED_LOCAL');
    expect(line).toContain('sla=LOCAL');
  });

  it('bulut turunda sağlayıcı süresi gerçek değerle görünür', () => {
    const [line] = buildFieldTraceLines([
      trace({
        route: 'companion_chat', provider: 'gemini',
        marks: {
          speech_end: 0, brain_request_start: 300, brain_complete: 1_200,
          first_audio_confirmed: 1_800,
        },
      }),
    ]);
    expect(line).toContain('provider=gemini:900ms');
    expect(line).toContain('sla=CLOUD');
  });

  it('bulut rotasında sağlayıcı damgası yoksa SESSİZCE yerel sayılmaz', () => {
    const [line] = buildFieldTraceLines([
      trace({ route: 'companion_chat', marks: { speech_end: 0, first_audio_confirmed: 1_800 } }),
    ]);
    expect(line).toContain('provider=NO_PROVIDER_MARK');
    expect(line).not.toContain('BYPASSED_LOCAL');
  });

  it('türetilmiş speech_end satırda İŞARETLENİR', () => {
    const [line] = buildFieldTraceLines([
      trace({
        route: 'local_fast_path', derivedSpeechEnd: true,
        marks: { speech_end: 0, first_audio_confirmed: 900 },
      }),
    ]);
    expect(line).toContain('speechEnd=derived');
  });

  it('onay turu SLA-D olarak görünür', () => {
    const [line] = buildFieldTraceLines([
      trace({ route: 'confirmation_ack', marks: { speech_end: 0, first_audio_confirmed: 700 } }),
    ]);
    expect(line).toContain('sla=CONFIRMATION');
  });

  it('en yeni tur BAŞTA döner', () => {
    const lines = buildFieldTraceLines([
      trace({ turnId: 1, route: 'local_fast_path', marks: { speech_end: 0, first_audio_confirmed: 500 } }),
      trace({ turnId: 2, route: 'local_fast_path', marks: { speech_end: 0, first_audio_confirmed: 600 } }),
    ]);
    expect(lines[0]).toContain('turn=2');
    expect(lines[1]).toContain('turn=1');
  });
});
