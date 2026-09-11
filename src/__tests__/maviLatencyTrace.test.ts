/**
 * maviLatencyTrace.test — MAVİ F0 · uçtan uca gecikme telemetrisi kilitleri.
 *
 * Bu testler ölçümün DOĞRULUĞUNU değil, ölçümün DÜRÜSTLÜĞÜNÜ kilitler:
 *  · kapalıyken hiçbir iz üretilmez (üretim davranışı değişmez),
 *  · proxy ("ses istendi") ile kanıt ("ses başladı") ASLA birleşmez,
 *  · türetilmiş damga ölçülmüş gibi işaretlenmez,
 *  · iki turun damgaları karışmaz,
 *  · iptal/timeout turlar istatistiğe girmez,
 *  · eksik damga sahte süre ÜRETMEZ.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  openMaviLatencyTrace, closeMaviLatencyTrace, markMaviLatency, markMaviLatencyDerived,
  bindMaviLatencyTurn, setMaviLatencyRoute, setMaviLatencyFailure, hasMaviLatencyMark,
  getMaviLatencyEvidence, setMaviLatencyTraceRemoteFlag, _resetMaviLatencyTraceForTest,
  MAVI_LATENCY_RING_MAX, MAVI_LATENCY_LOCAL_FLAG,
  type MaviLatencyMarker,
} from '../platform/assistant/maviLatencyTrace';
import {
  deriveTraceSegments, firstAudioEvidenceOf, speechEndIsDerived, summarize,
  computeStat, deriveMaviLatencyVerdict, buildMaviLatencyFields, buildTraceRows,
  buildMarkRows, deriveLatencyBottleneck, type TraceShape,
} from '../platform/devtools/maviLatencyModel';

/* ── Yardımcı: monotonik saati adım adım ilerlet ───────────────────────────── */

let _clock = 0;

function tick(ms: number): void { _clock += ms; }

beforeEach(() => {
  _resetMaviLatencyTraceForTest();
  try { localStorage.removeItem(MAVI_LATENCY_LOCAL_FLAG); } catch { /* jsdom */ }
  _clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => _clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetMaviLatencyTraceForTest();
});

/** Telemetriyi açar (uzak bayrak yolu — localStorage'a dokunmadan). */
function enable(): void { setMaviLatencyTraceRemoteFlag(true); }

/** Tam bir "başarılı tur" senaryosu üretir ve kapatır. */
function runHappyTurn(opts: { confirmAudio: boolean; turnId: number; filler?: boolean }): void {
  openMaviLatencyTrace();                       // listen_start @ t
  tick(300); markMaviLatency('stt_request_start');
  tick(2000); markMaviLatency('stt_result');
  // native VAD deltası: konuşma 1400ms'de bitti (stt_request_start ankoruna göre)
  markMaviLatencyDerived('speech_end', 'stt_request_start', 1400);
  bindMaviLatencyTurn(opts.turnId);
  tick(20); markMaviLatency('route_start');
  tick(30); markMaviLatency('brain_request_start');
  if (opts.filler) { tick(1500); markMaviLatency('filler_trigger'); tick(200); }
  else tick(900);
  markMaviLatency('brain_complete');
  setMaviLatencyRoute('companion_chat', 'gemini');
  tick(15); markMaviLatency('tts_request');
  tick(400); markMaviLatency('tts_audio_ready');
  tick(30); markMaviLatency('first_audio_requested');
  if (opts.confirmAudio) { tick(50); markMaviLatency('first_audio_confirmed'); }
  tick(2000); markMaviLatency('response_complete');
  closeMaviLatencyTrace('completed');
}

const traces = (): readonly TraceShape[] =>
  getMaviLatencyEvidence().traces as unknown as readonly TraceShape[];

/* ══════════════════════════════════════════════════════════════════════════ */

describe('maviLatencyTrace · bayrak (varsayılan KAPALI)', () => {
  it('kapalıyken iz AÇILMAZ ve hiçbir damga kaydedilmez', () => {
    const id = openMaviLatencyTrace();
    markMaviLatency('stt_request_start');
    markMaviLatency('first_audio_requested');
    const ev = getMaviLatencyEvidence();

    expect(id).toBeNull();
    expect(ev.enabled).toBe(false);
    expect(ev.traces).toHaveLength(0);
    expect(ev.tracesOpened).toBe(0);
  });

  it('kapalıyken damgalar "sahipsiz" sayılır → enstrümantasyon boşluğu görünür kalır', () => {
    markMaviLatency('route_start');
    markMaviLatency('brain_complete');
    expect(getMaviLatencyEvidence().orphanMarks).toBe(2);
  });

  it('uzak bayrak açınca iz açılır; kapatınca uçuştaki iz bırakılır', () => {
    enable();
    expect(openMaviLatencyTrace()).toBe(1);
    setMaviLatencyTraceRemoteFlag(false);
    expect(openMaviLatencyTrace()).toBeNull();
    expect(getMaviLatencyEvidence().openTraceId).toBeNull();
  });

  it('yerel kaldıraç YALNIZ tam "true" ile açar (fail-closed)', () => {
    localStorage.setItem(MAVI_LATENCY_LOCAL_FLAG, '1');
    expect(openMaviLatencyTrace()).toBeNull();
    localStorage.setItem(MAVI_LATENCY_LOCAL_FLAG, 'yes');
    expect(openMaviLatencyTrace()).toBeNull();
    localStorage.setItem(MAVI_LATENCY_LOCAL_FLAG, 'true');
    expect(openMaviLatencyTrace()).not.toBeNull();
  });
});

describe('maviLatencyTrace · damga sözleşmesi', () => {
  beforeEach(enable);

  it('marker sırası ve monotonik süreler korunur', () => {
    runHappyTurn({ confirmAudio: true, turnId: 7 });
    const s = deriveTraceSegments(traces()[0]);

    expect(s.warmupMs).toBe(300);
    expect(s.sttCaptureMs).toBe(2000);
    // speech_end = stt_request_start + 1400 → stt_result'a 600ms kalmış
    expect(s.endpointToTextMs).toBe(600);
    expect(s.brainMs).toBe(900);
    expect(s.ttsToFirstAudioMs).toBe(430);
    expect(s.requestedToConfirmedMs).toBe(50);
    // Tüm süreler negatif olmayan
    for (const v of Object.values(s)) {
      if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('AYNI marker tekrar gelirse İLK damga korunur ve tekrar sayılır', () => {
    openMaviLatencyTrace();
    tick(100); markMaviLatency('stt_request_start');
    tick(500); markMaviLatency('stt_request_start');   // tekrar
    closeMaviLatencyTrace('completed');

    const t = traces()[0];
    expect(t.duplicateMarks).toBe(1);
    expect(getMaviLatencyEvidence().duplicateMarks).toBe(1);
    expect(deriveTraceSegments(t).warmupMs).toBe(100);   // 600 DEĞİL
  });

  it('bilinmeyen marker sessizce reddedilir (throw etmez)', () => {
    openMaviLatencyTrace();
    expect(() => markMaviLatency('bogus_marker' as MaviLatencyMarker)).not.toThrow();
    expect(getMaviLatencyEvidence().invalidMarks).toBe(1);
  });

  it('açık iz yokken gelen damga sahipsiz sayılır, iz UYDURULMAZ', () => {
    markMaviLatency('tts_request');
    const ev = getMaviLatencyEvidence();
    expect(ev.traces).toHaveLength(0);
    expect(ev.orphanMarks).toBe(1);
  });

  it('hasMaviLatencyMark yalnız AÇIK iz için doğru cevap verir', () => {
    expect(hasMaviLatencyMark('tts_request')).toBe(false);
    openMaviLatencyTrace();
    expect(hasMaviLatencyMark('tts_request')).toBe(false);
    markMaviLatency('tts_request');
    expect(hasMaviLatencyMark('tts_request')).toBe(true);
    closeMaviLatencyTrace('completed');
    expect(hasMaviLatencyMark('tts_request')).toBe(false);
  });
});

describe('maviLatencyTrace · TÜRETİLMİŞ damga dürüstlüğü', () => {
  beforeEach(enable);

  it('türetilmiş damga "derived" olarak işaretlenir (ölçülmüş gibi sunulmaz)', () => {
    openMaviLatencyTrace();
    tick(100); markMaviLatency('stt_request_start');
    markMaviLatencyDerived('speech_end', 'stt_request_start', 1400);
    closeMaviLatencyTrace('completed');

    const t = traces()[0];
    expect(speechEndIsDerived(t)).toBe(true);
    expect(t.marks['stt_request_start']?.origin).toBe('observed');
    const rows = buildMarkRows(t);
    expect(rows.find((r) => r.marker === 'speech_end')?.origin).toBe('derived');
  });

  it('taban damga YOKSA türetme YAPILMAZ (sahte taban üretilmez)', () => {
    openMaviLatencyTrace();
    markMaviLatencyDerived('speech_end', 'stt_request_start', 1400);   // taban yok
    closeMaviLatencyTrace('completed');
    expect(traces()[0].marks['speech_end']).toBeUndefined();
  });

  it('negatif/geçersiz delta REDDEDİLİR', () => {
    openMaviLatencyTrace();
    markMaviLatency('stt_request_start');
    markMaviLatencyDerived('speech_end', 'stt_request_start', -5);
    markMaviLatencyDerived('speech_start', 'stt_request_start', Number.NaN);
    closeMaviLatencyTrace('completed');
    const t = traces()[0];
    expect(t.marks['speech_end']).toBeUndefined();
    expect(t.marks['speech_start']).toBeUndefined();
  });
});

describe('maviLatencyTrace · ilk ses SEMANTİĞİ (proxy ≠ kanıt)', () => {
  beforeEach(enable);

  it('yalnız play() çağrıldıysa kanıt düzeyi REQUESTED kalır', () => {
    runHappyTurn({ confirmAudio: false, turnId: 1 });
    const t = traces()[0];
    expect(firstAudioEvidenceOf(t)).toBe('REQUESTED');
    expect(deriveTraceSegments(t).speechEndToFirstAudioConfirmedMs).toBeNull();
    expect(deriveTraceSegments(t).speechEndToFirstAudioRequestedMs).not.toBeNull();
  });

  it('platform başlangıç bildirdiyse CONFIRMED olur ve İKİ metrik AYRI kalır', () => {
    runHappyTurn({ confirmAudio: true, turnId: 1 });
    const s = deriveTraceSegments(traces()[0]);
    expect(firstAudioEvidenceOf(traces()[0])).toBe('CONFIRMED');
    expect(s.speechEndToFirstAudioRequestedMs).not.toBeNull();
    expect(s.speechEndToFirstAudioConfirmedMs).not.toBeNull();
    // Kanıtlı ölçüm proxy'den DAİMA büyüktür — birleştirilmedikleri buradan görünür.
    expect(s.speechEndToFirstAudioConfirmedMs!).toBeGreaterThan(s.speechEndToFirstAudioRequestedMs!);
  });

  it('YABANCI SES: cevap seslendirmeye verilmeden gelen ses damgası DÜŞER ve SAYILIR', () => {
    // Senaryo: Mavi dinlerken/karar verirken navigasyon talimatı konuşuyor.
    // `speakNavigation` → ttsService → ses damgaları; bunlar Mavi'nin cevabı DEĞİLDİR.
    openMaviLatencyTrace();
    markMaviLatency('stt_request_start');
    markMaviLatencyDerived('speech_end', 'stt_request_start', 100);
    tick(50);
    markMaviLatency('tts_audio_ready');          // navigasyon sesi
    markMaviLatency('first_audio_requested');    // navigasyon sesi
    markMaviLatency('first_audio_confirmed');    // navigasyon sesi

    const openTrace = traces()[traces().length - 1];
    expect(openTrace.marks['first_audio_requested']).toBeUndefined();
    expect(openTrace.marks['first_audio_confirmed']).toBeUndefined();
    expect(getMaviLatencyEvidence().foreignAudioMarks).toBe(3);

    // Mavi'nin GERÇEK cevabı gelince kapı açılır ve ölçüm doğru tabandan başlar.
    tick(400); markMaviLatency('tts_request');
    tick(120); markMaviLatency('first_audio_requested');
    closeMaviLatencyTrace('completed');
    const t = traces()[0];
    expect(t.marks['first_audio_requested']).toBeDefined();
    expect(deriveTraceSegments(t).ttsToFirstAudioMs).toBe(120);
  });

  it('ARA SÖZ (filler) sesi "cevabın ilk sesi" SAYILMAZ', () => {
    openMaviLatencyTrace();
    markMaviLatency('stt_request_start');
    markMaviLatencyDerived('speech_end', 'stt_request_start', 100);
    markMaviLatency('filler_trigger');           // progress tier → tts_request YOK
    markMaviLatency('first_audio_requested');    // filler'ın sesi
    closeMaviLatencyTrace('completed');
    const t = traces()[0];
    expect(t.fillerCount).toBe(1);
    expect(firstAudioEvidenceOf(t)).toBe('NONE');
    expect(deriveTraceSegments(t).speechEndToFirstAudioRequestedMs).toBeNull();
  });

  it('hiç ses istenmediyse NONE ve ana metrik null (uydurma yok)', () => {
    openMaviLatencyTrace();
    markMaviLatency('stt_request_start');
    markMaviLatencyDerived('speech_end', 'stt_request_start', 100);
    closeMaviLatencyTrace('completed');
    const t = traces()[0];
    expect(firstAudioEvidenceOf(t)).toBe('NONE');
    expect(deriveTraceSegments(t).speechEndToFirstAudioRequestedMs).toBeNull();
  });

  it('satır başlığı proxy ise AÇIKÇA proxy işaretlenir', () => {
    runHappyTurn({ confirmAudio: false, turnId: 1 });
    const row = buildTraceRows(traces())[0];
    expect(row.headlineIsProxy).toBe(true);
    runHappyTurn({ confirmAudio: true, turnId: 2 });
    expect(buildTraceRows(traces())[0].headlineIsProxy).toBe(false);
  });
});

describe('maviLatencyTrace · TUR İZOLASYONU', () => {
  beforeEach(enable);

  it('yeni iz açılınca eski iz superseded ile kapanır; damgalar karışmaz', () => {
    openMaviLatencyTrace();
    markMaviLatency('stt_request_start');
    bindMaviLatencyTurn(11);

    openMaviLatencyTrace();                     // kullanıcı yeni komut verdi
    markMaviLatency('route_start');
    bindMaviLatencyTurn(12);
    closeMaviLatencyTrace('completed');

    const all = traces();
    expect(all).toHaveLength(2);
    const first = all.find((t) => t.turnId === 11)!;
    const second = all.find((t) => t.turnId === 12)!;
    expect(first.outcome).toBe('superseded');
    expect(first.marks['route_start']).toBeUndefined();     // 2. turun damgası sızmadı
    expect(second.marks['stt_request_start']).toBeUndefined(); // 1. turun damgası sızmadı
    expect(second.outcome).toBe('completed');
  });

  it('turId bir kez bağlanır; ikinci bağlama İZİ DEĞİŞTİRMEZ', () => {
    openMaviLatencyTrace();
    bindMaviLatencyTurn(5);
    bindMaviLatencyTurn(9);
    closeMaviLatencyTrace('completed');
    expect(traces()[0].turnId).toBe(5);
  });

  it('barge-in kesilen İZE yazılır ve o iz cancelled kapanır', () => {
    openMaviLatencyTrace();
    markMaviLatency('stt_request_start');
    markMaviLatencyDerived('speech_end', 'stt_request_start', 100);
    markMaviLatency('tts_request');            // ses kapısı: cevap seslendirmeye verildi
    tick(500); markMaviLatency('first_audio_requested');
    tick(90);  markMaviLatency('barge_in');
    closeMaviLatencyTrace('cancelled');

    const t = traces()[0];
    expect(t.bargeIn).toBe(true);
    expect(t.outcome).toBe('cancelled');
    expect(deriveTraceSegments(t).firstAudioToBargeInMs).toBe(90);
  });
});

describe('maviLatencyTrace · sonuç sınıfları ve istatistik', () => {
  beforeEach(enable);

  it('YALNIZ tamamlanmış turlar istatistiğe girer', () => {
    runHappyTurn({ confirmAudio: true, turnId: 1 });

    // İptal edilen tur — "hızlı" görünür ama kullanıcı cevabı hiç duymadı
    openMaviLatencyTrace();
    markMaviLatency('stt_request_start');
    markMaviLatencyDerived('speech_end', 'stt_request_start', 10);
    markMaviLatency('tts_request');
    tick(5); markMaviLatency('first_audio_requested');
    closeMaviLatencyTrace('cancelled');

    const sum = summarize(traces());
    expect(sum.completed).toBe(1);
    expect(sum.confirmedStat.count).toBe(1);
    expect(sum.requestedStat.count).toBe(1);   // iptal edilen SAYILMADI
    expect(sum.byOutcome['cancelled']).toBe(1);
    expect(sum.byOutcome['completed']).toBe(1);
  });

  it('timeout ve no_speech ayrı sınıflardır', () => {
    openMaviLatencyTrace();
    setMaviLatencyFailure('listen_failsafe');
    closeMaviLatencyTrace('timeout');
    openMaviLatencyTrace();
    closeMaviLatencyTrace('no_speech');

    const sum = summarize(traces());
    expect(sum.byOutcome['timeout']).toBe(1);
    expect(sum.byOutcome['no_speech']).toBe(1);
    expect(sum.completed).toBe(0);
    expect(traces()[0].failureCode).toBe('listen_failsafe');
  });

  it('yapay ara söz sayılır (F2 hedefi 0)', () => {
    runHappyTurn({ confirmAudio: true, turnId: 1, filler: true });
    const t = traces()[0];
    expect(t.fillerCount).toBe(1);
    expect(deriveTraceSegments(t).speechEndToFillerMs).not.toBeNull();
    expect(summarize(traces()).tracesWithFiller).toBe(1);
  });

  it('computeStat: örnek yoksa null (uydurma yüzdelik YOK)', () => {
    expect(computeStat([])).toEqual({ count: 0, p50: null, p95: null, worst: null });
    expect(computeStat([null, null])).toEqual({ count: 0, p50: null, p95: null, worst: null });
    const s = computeStat([100, 200, 300, 400]);
    expect(s.count).toBe(4);
    expect(s.worst).toBe(400);
    expect(s.p50).toBe(200);
    expect(s.p95).toBe(400);
  });
});

describe('maviLatencyTrace · sınırlar ve dayanıklılık', () => {
  beforeEach(enable);

  it('halka tavanı aşılmaz (sınırsız büyüme yok)', () => {
    for (let i = 0; i < MAVI_LATENCY_RING_MAX + 15; i++) {
      openMaviLatencyTrace();
      closeMaviLatencyTrace('completed');
    }
    expect(getMaviLatencyEvidence().traces.length).toBe(MAVI_LATENCY_RING_MAX);
  });

  it('route/provider kodu sanitize edilir (serbest metin sızamaz)', () => {
    openMaviLatencyTrace();
    setMaviLatencyRoute('Ankara\'ya git! <script>', 'GEMİNİ pro-1.5');
    closeMaviLatencyTrace('completed');
    const t = traces()[0];
    expect(t.route).toMatch(/^[a-z0-9_]+$/);
    expect(t.route!.length).toBeLessThanOrEqual(24);
    expect(t.route).not.toContain('<');
    expect(t.provider).toMatch(/^[a-z0-9_]*$/);
  });

  it('kapatma idempotenttir ve iz yokken no-op', () => {
    expect(() => closeMaviLatencyTrace('completed')).not.toThrow();
    openMaviLatencyTrace();
    closeMaviLatencyTrace('completed');
    closeMaviLatencyTrace('completed');
    expect(getMaviLatencyEvidence().traces).toHaveLength(1);
  });

  it('reset sonrası (uygulama yeniden başlangıcı benzeri) defter BOŞ başlar', () => {
    runHappyTurn({ confirmAudio: true, turnId: 1 });
    expect(getMaviLatencyEvidence().traces.length).toBe(1);
    _resetMaviLatencyTraceForTest();
    const ev = getMaviLatencyEvidence();
    expect(ev.traces).toHaveLength(0);
    expect(ev.enabled).toBe(false);          // bayrak da varsayılana döner
    expect(ev.tracesOpened).toBe(0);
  });

  it('açık iz kanıt listesinde outcome "open" ile görünür', () => {
    openMaviLatencyTrace();
    markMaviLatency('stt_request_start');
    const ev = getMaviLatencyEvidence();
    expect(ev.openTraceId).toBe(1);
    expect(ev.traces[ev.traces.length - 1].outcome).toBe('open');
  });
});

describe('maviLatencyModel · hüküm ve alanlar', () => {
  beforeEach(enable);

  const inputFrom = () => {
    const ev = getMaviLatencyEvidence();
    return {
      enabled: ev.enabled,
      traces: ev.traces as unknown as readonly TraceShape[],
      capacity: ev.capacity,
      openTraceId: ev.openTraceId,
      tracesOpened: ev.tracesOpened,
      tracesClosed: ev.tracesClosed,
      orphanMarks: ev.orphanMarks,
      invalidMarks: ev.invalidMarks,
      duplicateMarks: ev.duplicateMarks,
      foreignAudioMarks: ev.foreignAudioMarks,
    };
  };

  it('telemetri kapalıyken hüküm DISABLED', () => {
    setMaviLatencyTraceRemoteFlag(false);
    const i = inputFrom();
    expect(deriveMaviLatencyVerdict({
      enabled: i.enabled, traceCount: 0, summary: summarize([]),
    })).toBe('DISABLED');
  });

  it('iz yokken NO_TRACES; yalnız proxy varsa PROXY_ONLY; kanıt varsa CONFIRMED', () => {
    const i0 = inputFrom();
    expect(deriveMaviLatencyVerdict({
      enabled: i0.enabled, traceCount: 0, summary: summarize([]),
    })).toBe('NO_TRACES');

    runHappyTurn({ confirmAudio: false, turnId: 1 });
    let t = traces();
    expect(deriveMaviLatencyVerdict({
      enabled: true, traceCount: t.length, summary: summarize(t),
    })).toBe('PROXY_ONLY');

    runHappyTurn({ confirmAudio: true, turnId: 2 });
    t = traces();
    expect(deriveMaviLatencyVerdict({
      enabled: true, traceCount: t.length, summary: summarize(t),
    })).toBe('CONFIRMED');
  });

  it('damga zinciri kopuksa NO_METRIC (sahte sayı üretilmez)', () => {
    openMaviLatencyTrace();
    markMaviLatency('stt_request_start');    // speech_end ve ses damgası YOK
    closeMaviLatencyTrace('completed');
    const t = traces();
    expect(deriveMaviLatencyVerdict({
      enabled: true, traceCount: t.length, summary: summarize(t),
    })).toBe('NO_METRIC');
  });

  it('ölçüm yoksa alan UNAVAILABLE gösterir, sayı UYDURMAZ', () => {
    const fields = buildMaviLatencyFields(inputFrom());
    const conf = fields.find((f) => f.id === 'confirmed')!;
    expect(conf.klass).toBe('UNAVAILABLE');
    expect(conf.value).not.toMatch(/\d+\s*ms/);
  });

  it('ölçüm varsa alanlar DERIVED sınıfıyla gelir (OBSERVED değil)', () => {
    runHappyTurn({ confirmAudio: true, turnId: 1 });
    const fields = buildMaviLatencyFields(inputFrom());
    expect(fields.find((f) => f.id === 'confirmed')!.klass).toBe('DERIVED');
    expect(fields.find((f) => f.id === 'requested')!.klass).toBe('DERIVED');
  });

  it('GİZLİLİK: hiçbir alanda transcript/prompt/serbest metin taşınmaz', () => {
    openMaviLatencyTrace();
    setMaviLatencyRoute('companion_chat', 'gemini');
    closeMaviLatencyTrace('completed');
    const fields = buildMaviLatencyFields(inputFrom());
    const blob = JSON.stringify(fields) + JSON.stringify(traces());
    // Kayıt yalnız sabit kodlar taşır — kullanıcı cümlesi biçiminde veri OLAMAZ.
    expect(blob).not.toMatch(/transcript/i);
    expect(blob).not.toMatch(/prompt/i);
    for (const t of traces()) {
      expect(Object.keys(t)).not.toContain('text');
      expect(Object.keys(t)).not.toContain('transcript');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * deriveLatencyBottleneck — P0-MAVI-FORENSIC-DEVICE-1
 *
 * SAHA (2026-09-11): gerçek cihazda `speech_end` HİÇ damgalanmadı (native STT
 * VAD telemetrisi bu yolda yok) → tüm SLA sınıfları evidence:NONE, hüküm
 * NO_METRIC. Ama STT yakalama / sağlayıcı / TTS kuyruğu segmentleri bu damgaya
 * BAĞLI DEĞİLDİR. Bu blok tam olarak o senaryoyu üretip darboğazın YİNE DE
 * türetilebildiğini kilitler.
 * ════════════════════════════════════════════════════════════════════════ */
describe('deriveLatencyBottleneck — speech_end YOKKEN bile türetilir (SAHA 2026-09-11)', () => {
  beforeEach(enable);

  /** `speech_end` KASITLI OLARAK atlanır — gerçek cihazda ölçülemeyen tam senaryo. */
  function runTurnWithoutSpeechEnd(turnId: number): void {
    openMaviLatencyTrace();
    tick(300); markMaviLatency('stt_request_start');
    tick(2000); markMaviLatency('stt_result');          // STT yakalama ≈ 2000ms
    bindMaviLatencyTurn(turnId);
    tick(20); markMaviLatency('route_start');
    tick(30); markMaviLatency('brain_request_start');
    tick(9000); markMaviLatency('brain_complete');        // sağlayıcı ≈ 9000ms (en yavaş)
    setMaviLatencyRoute('companion_haiku', 'haiku');
    tick(15); markMaviLatency('tts_request');
    tick(400); markMaviLatency('tts_audio_ready');
    tick(30); markMaviLatency('first_audio_requested');   // tts kuyruğu ≈ 45ms
    tick(2000); markMaviLatency('response_complete');
    closeMaviLatencyTrace('completed');
  }

  it('speech_end yokken üst hüküm NO_METRIC kalır (sahte SLA üretilmez)', () => {
    runTurnWithoutSpeechEnd(1);
    const t = traces();
    expect(deriveMaviLatencyVerdict({
      enabled: true, traceCount: t.length, summary: summarize(t),
    })).toBe('NO_METRIC');
  });

  it('ama darboğaz GERÇEK segment kanıtından türetilir — PROVIDER en yavaş', () => {
    runTurnWithoutSpeechEnd(1);
    const bn = deriveLatencyBottleneck(summarize(traces()));
    expect(bn.bottleneck).toBe('PROVIDER');
    expect(bn.providerMs).toBe(9000);
    expect(bn.sttMs).toBe(2000);
    expect(bn.ttsQueueMs).toBe(430);   // tts_request → first_audio_requested (400+30)
  });

  it('hiç segment yoksa UNKNOWN döner (uydurma darboğaz YOK)', () => {
    const bn = deriveLatencyBottleneck(summarize([]));
    expect(bn.bottleneck).toBe('UNKNOWN');
    expect(bn.sttMs).toBeNull();
    expect(bn.providerMs).toBeNull();
    expect(bn.ttsQueueMs).toBeNull();
  });

  it('STT en yavaşsa darboğaz STT olur (sabit sıra varsayılmaz)', () => {
    openMaviLatencyTrace();
    tick(300); markMaviLatency('stt_request_start');
    tick(12000); markMaviLatency('stt_result');           // STT bu kez en yavaş
    bindMaviLatencyTurn(2);
    tick(20); markMaviLatency('route_start');
    tick(30); markMaviLatency('brain_request_start');
    tick(500); markMaviLatency('brain_complete');
    setMaviLatencyRoute('companion_gemini', 'gemini');
    tick(15); markMaviLatency('tts_request');
    tick(400); markMaviLatency('tts_audio_ready');
    tick(30); markMaviLatency('first_audio_requested');
    tick(2000); markMaviLatency('response_complete');
    closeMaviLatencyTrace('completed');

    const bn = deriveLatencyBottleneck(summarize(traces()));
    expect(bn.bottleneck).toBe('STT');
  });

  it('buildMaviLatencyFields darboğaz alanını taşır ve ölçüm yoksa UNKNOWN gösterir', () => {
    const emptyFields = buildMaviLatencyFields({
      enabled: true, traces: [], capacity: 20, openTraceId: null,
      tracesOpened: 0, tracesClosed: 0, orphanMarks: 0, invalidMarks: 0,
      duplicateMarks: 0, foreignAudioMarks: 0,
    });
    expect(emptyFields.find((f) => f.id === 'bottleneck')!.value).toContain('UNKNOWN');

    runTurnWithoutSpeechEnd(3);
    const t = traces();
    const fields = buildMaviLatencyFields({
      enabled: true, traces: t, capacity: 20, openTraceId: null,
      tracesOpened: 1, tracesClosed: 1, orphanMarks: 0, invalidMarks: 0,
      duplicateMarks: 0, foreignAudioMarks: 0,
    });
    expect(fields.find((f) => f.id === 'bottleneck')!.value).toContain('PROVIDER');
  });
});
