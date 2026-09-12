/**
 * carosLabSttMic.test.tsx — CAROS LAB · Mavi STT / Mikrofon KİLİTLERİ (MAVI-STT-LAB-1).
 *
 * ANA İLKELER:
 *  1. **GİZLİLİK YAPISALDIR:** transcript · n-best · wake sözcüğü · grammar kelimeleri ·
 *     HAM SES ne native sözleşmesine girer ne render'a çıkar. Kilitler bunu HEM saf
 *     modelden HEM gerçek markup'tan doğrular.
 *  2. **SALT-OKUNUR:** ekran mikrofon/STT/wake motoruna, eşiğe, AudioSource seçimine
 *     ve AEC/NS/AGC'ye DOKUNAMAZ; başlat/durdur/değiştir butonu YOKTUR.
 *  3. Kaynak yoksa KAYNAK YOK — sahte 0 / sahte "sağlıklı" / sahte taban YOK.
 *  4. RMS halkası ve kaynak denemeleri BOUNDED.
 *  5. Ekran kapalıyken polling YOK; oto-yenileme VARSAYILAN KAPALI, unmount'ta temizlenir.
 *  6. STT davranışı DEĞİŞMEZ (gözlem hiçbir kararı etkilemez).
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(async () => {}) } }));

import {
  buildSttSections, countBySttClass, computeRmsStats, deriveSttProbeStatus,
  normalizePath, normalizeGrammar, normalizeResult, normalizeAttempt, normalizeMotion,
  MAX_RMS_SAMPLES, MAX_SOURCE_ATTEMPTS, MAX_FIELDS_PER_STT_SECTION, STT_MIC_STALE_MS,
  type SttMicRaw, type SttSection,
} from '../platform/devtools/sttMicModel';
import { readSttMicSnapshot } from '../platform/devtools/sttMicSources';
import {
  _resetVoiceMicDiagnosticsForTest, getVoiceMicDiagnostics, getVoiceMicDiagnosticsCachedAt,
} from '../platform/voice/voiceMicDiagnosticsProbe';
import { getCarosLabTool, resolveToolActivation, isToolOpenable } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import { isCarosLabAllowed, shouldRenderCarosLab } from '../platform/devtools/carosLabGate';
import { SttMicScreen, STT_AUTO_REFRESH_MS } from '../components/devtools/screens/SttMicScreen';

/* ══════════════════════════════════════════════════════════════════════════
 * Fixture — SIZDIRILMASI YASAK içerikler burada tanımlıdır
 * ════════════════════════════════════════════════════════════════════════ */

const NOW = 1_700_000_000_000;

/** Bunlar HİÇBİR alanda ve HİÇBİR markup'ta görünmemelidir. */
const SECRET_TRANSCRIPT = 'haritayı aç ve Ayşe Yıldırım\'ı ara';
const SECRET_NBEST      = 'haritayi ac ve ayse yildirimi ara';
const SECRET_WAKE_WORD  = 'hey mavi kaptan';

/** Yorumları çıkarır — kaynak kilitleri YALNIZ gerçek koda bakar. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readSrc(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

const SCREEN_PATH  = ['src', 'components', 'devtools', 'screens', 'SttMicScreen.tsx'];
const MODEL_PATH   = ['src', 'platform', 'devtools', 'sttMicModel.ts'];
const SOURCES_PATH = ['src', 'platform', 'devtools', 'sttMicSources.ts'];
const NATIVE_PATH  = ['android', 'app', 'src', 'main', 'java', 'com', 'cockpitos', 'pro',
                      'voice', 'VoiceMicDiagnostics.java'];

/** Tam dolu, GERÇEKÇİ bir gözlem (aktif dinleme yolu). */
function raw(over: Partial<SttMicRaw> = {}): SttMicRaw {
  return {
    readAt: NOW,
    present: true,
    schemaVersion: 1,
    capturedAt: NOW - 1_000,
    path: 'ACTIVE_LISTEN',
    sessionActive: false,
    sessionStartedAt: NOW - 9_000,
    source: {
      selectedSource: 1,
      selectedSourceName: 'MIC',
      sampleRate: 16000,
      channelCount: 1,
      bufferBytes: 16000,
      frameSamples: 8000,
      attempts: [
        { source: 6, sourceName: 'VOICE_RECOGNITION', outcome: 'NO_SIGNAL' },
        { source: 1, sourceName: 'MIC',               outcome: 'SIGNAL' },
      ],
    },
    effects: {
      probed: true,
      aecAvailable: true,  aecCreated: true,  aecEnabled: true,
      nsAvailable:  true,  nsCreated:  true,  nsEnabled:  false,
      agcAvailable: false, agcCreated: false, agcEnabled: false,
      errors: ['AGC_SETUP_FAILED'],
    },
    vad: {
      present: true,
      lastRms: 0.0431,
      noiseFloor: 0.0122,
      effectiveThreshold: 0.0232,
      staticMinThreshold: 0.010,
      floorFactor: 1.9,
      speechDetected: true,
      lastAudioAtMs: 120_000,
      monotonicNowMs: 120_450,
      sampleCount: 132,
      samples: [0.01, 0.02, 0.03, 0.04, 0.05],
    },
    stt: {
      wakeEngineActive: false,
      activeRecognizerActive: false,
      grammarType: 'static_command',
      grammarWordCount: 214,
      lastResultCategory: 'success',
      lastResultAt: NOW - 2_000,
    },
    vehicle: {
      speedKmh: 52.4,
      motionState: 'moving',
      hvacFanLevel: null,
      sampledAt: NOW,
    },
    js: {
      wakeEnabled: true,
      wakeStatus: 'listening',
      wakePhraseCount: 2,
      voiceStatus: 'idle',
      micAvailable: true,
      commandGrammarWordCount: 214,
    },
    ...over,
  };
}

/** Hiç kanıt yok (eski APK / native metot yok). */
function emptyRaw(): SttMicRaw {
  return {
    readAt: NOW, present: false, schemaVersion: null, capturedAt: null,
    path: 'NONE', sessionActive: false, sessionStartedAt: null,
    source: null, effects: null, vad: null, stt: null, vehicle: null, js: null,
  };
}

function flat(sections: readonly SttSection[]) {
  return sections.flatMap((s) => s.fields);
}

function field(sections: readonly SttSection[], id: string) {
  return flat(sections).find((f) => f.id === id);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 — Ses kaynağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-1 · 1. ses kaynağı', () => {
  it('1. seçilen AudioSource ve denenen kaynaklar snapshot\'a AYNEN yansır', () => {
    const s = buildSttSections(raw());
    expect(field(s, 'sttSelectedSource')?.value).toBe('MIC (1)');
    expect(field(s, 'sttSelectedSource')?.klass).toBe('OBSERVED');

    expect(field(s, 'sttAttemptCount')?.value).toBe('2');
    // Denemeler SIRASIYLA ve sonucuyla görünür — "ölü kaynak" gerçeği gizlenmez.
    expect(field(s, 'sttAttempt0')?.value).toContain('VOICE_RECOGNITION (6)');
    expect(field(s, 'sttAttempt0')?.value).toContain('SİNYAL YOK');
    expect(field(s, 'sttAttempt1')?.value).toContain('MIC (1)');
    expect(field(s, 'sttAttempt1')?.value).toContain('SİNYAL VAR');

    expect(field(s, 'sttSampleRate')?.value).toBe('16000');
    expect(field(s, 'sttChannels')?.value).toBe('1');
    expect(field(s, 'sttBufferBytes')?.value).toBe('16000');
    expect(field(s, 'sttFrameSamples')?.value).toBe('8000');
  });

  it('1b. kaynak SEÇİLMEDİYSE (-1) varsayılan UYDURULMAZ → KAYNAK YOK', () => {
    const base = raw();
    const s = buildSttSections(raw({
      source: { ...base.source!, selectedSource: -1, selectedSourceName: 'UNKNOWN' },
    }));
    const f = field(s, 'sttSelectedSource');
    expect(f?.klass).toBe('UNAVAILABLE');
    // 0 (DEFAULT) ile "seçilmedi" AYRI: -1 sentinel'i sıfıra indirgenmez.
    expect(f?.value).not.toContain('DEFAULT');
  });

  it('1c. kaynak 0 (DEFAULT) GERÇEK bir seçimdir — sentinel ile karıştırılmaz', () => {
    const base = raw();
    const s = buildSttSections(raw({
      source: { ...base.source!, selectedSource: 0, selectedSourceName: 'DEFAULT' },
    }));
    expect(field(s, 'sttSelectedSource')?.klass).toBe('OBSERVED');
    expect(field(s, 'sttSelectedSource')?.value).toBe('DEFAULT (0)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2/3 — Android ses efektleri
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-1 · 2-3. ses efektleri', () => {
  it('2. AEC/NS/AGC için available · created · enabled AYRI AYRI gösterilir', () => {
    const s = buildSttSections(raw());
    for (const p of ['sttAec', 'sttNs', 'sttAgc']) {
      expect(field(s, `${p}Available`)).toBeDefined();
      expect(field(s, `${p}Created`)).toBeDefined();
      expect(field(s, `${p}Enabled`)).toBeDefined();
    }
    // NS: oluşturuldu AMA etkin DEĞİL → üç eksen birbirine indirgenmemiş.
    expect(field(s, 'sttNsCreated')?.value).toBe('true');
    expect(field(s, 'sttNsEnabled')?.value).toBe('false');
    // AGC: mevcut değil → created/enabled de false, ama AYRI alanlarda.
    expect(field(s, 'sttAgcAvailable')?.value).toBe('false');
    expect(field(s, 'sttAgcEnabled')?.value).toBe('false');
  });

  it('2b. "mevcut" olmak "etkin" SAYILMAZ (türetme yok — üçü de bağımsız okunur)', () => {
    const base = raw();
    const s = buildSttSections(raw({
      effects: { ...base.effects!, aecAvailable: true, aecCreated: false, aecEnabled: false },
    }));
    expect(field(s, 'sttAecAvailable')?.value).toBe('true');
    expect(field(s, 'sttAecCreated')?.value).toBe('false');
    expect(field(s, 'sttAecEnabled')?.value).toBe('false');
  });

  it('3. efekt istisnası YALNIZ bounded KOD olarak çıkar — ham metin SIZMAZ', () => {
    const base = raw();
    const s = buildSttSections(raw({
      effects: { ...base.effects!, errors: ['AEC_SETUP_FAILED', 'NS_SETUP_FAILED'] },
    }));
    const v = field(s, 'sttEffectErrors')?.value ?? '';
    expect(v).toBe('AEC_SETUP_FAILED · NS_SETUP_FAILED');
    // Ham exception izlerinden HİÇBİRİ görünmemeli.
    expect(v).not.toMatch(/Exception|java\.|at com\.|\.java:|Caused by|null pointer/i);

    // Native sözleşmesi de yalnız KOD kabul eder: exception nesnesi/mesajı taşınmaz.
    const native = stripComments(readSrc(...NATIVE_PATH));
    expect(native).toMatch(/noteEffectError\(String boundedCode\)/);
    expect(native).not.toMatch(/getMessage\(\)|printStackTrace|getStackTrace/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4/8 — VAD, gürültü, bounded halka
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-1 · 4-8. VAD ve gürültü', () => {
  it('4. anlık RMS, öğrenilmiş taban ve KULLANILAN gerçek eşik ayrı ayrı gösterilir', () => {
    const s = buildSttSections(raw());
    expect(field(s, 'sttLastRms')?.value).toBe('0.0431');
    expect(field(s, 'sttNoiseFloor')?.value).toBe('0.0122');
    // Kullanılan eşik = max(taban×1.9, 0.010) = 0.0232 — türetilmiş değil ÖLÇÜLMÜŞ.
    expect(field(s, 'sttThreshold')?.value).toBe('0.0232');
    expect(field(s, 'sttThreshold')?.klass).toBe('OBSERVED');
    // Statik alt eşik ve taban çarpanı da AYRI alanlardır.
    expect(field(s, 'sttStaticThreshold')?.value).toBe('0.0100');
    expect(field(s, 'sttFloorFactor')?.value).toBe('1.9');
    expect(field(s, 'sttSpeechDetected')?.value).toBe('VAR');
  });

  it('4b. taban ÖĞRENİLMEDİYSE (-1) sahte 0 taban ÜRETİLMEZ (wake yolu gerçeği)', () => {
    const base = raw();
    const s = buildSttSections(raw({
      path: 'WAKE_WORD',
      vad: { ...base.vad!, noiseFloor: -1, floorFactor: -1, staticMinThreshold: 0.012, effectiveThreshold: 0.012 },
    }));
    const nf = field(s, 'sttNoiseFloor');
    expect(nf?.klass).toBe('UNAVAILABLE');
    expect(nf?.value).not.toBe('0.0000');
    // Taban çarpanı bu yolda UYGULANMAZ — 0 gösterilmez.
    expect(field(s, 'sttFloorFactor')?.klass).toBe('UNAVAILABLE');
    // Ama SABİT eşik gerçek bir ölçümdür → gösterilir.
    expect(field(s, 'sttThreshold')?.klass).toBe('OBSERVED');
  });

  it('4c. RMS 0 GERÇEK bir değerdir — "ölçüm yok" ile karıştırılmaz', () => {
    const base = raw();
    const zero = buildSttSections(raw({ vad: { ...base.vad!, lastRms: 0 } }));
    expect(field(zero, 'sttLastRms')?.klass).toBe('OBSERVED');
    expect(field(zero, 'sttLastRms')?.value).toBe('0.0000');

    const none = buildSttSections(raw({ vad: { ...base.vad!, lastRms: -1 } }));
    expect(field(none, 'sttLastRms')?.klass).toBe('UNAVAILABLE');
  });

  it('4d. son ses paketi yaşı MONOTONIC farktan türetilir; paket yoksa 0 ms GÖSTERİLMEZ', () => {
    const base = raw();
    const s = buildSttSections(raw());
    expect(field(s, 'sttAudioAge')?.value).toBe('450');
    expect(field(s, 'sttAudioAge')?.klass).toBe('DERIVED');

    const never = buildSttSections(raw({ vad: { ...base.vad!, lastAudioAtMs: 0 } }));
    expect(field(never, 'sttAudioAge')?.klass).toBe('UNAVAILABLE');
    expect(field(never, 'sttAudioAge')?.value).not.toBe('0');
  });

  it('8a. RMS özeti min/p50/ort/p95/max üretir; boş girdi SAHTE istatistik ÜRETMEZ', () => {
    const st = computeRmsStats([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(st).not.toBeNull();
    expect(st!.count).toBe(5);
    expect(st!.min).toBeCloseTo(0.1, 6);
    expect(st!.max).toBeCloseTo(0.5, 6);
    expect(st!.avg).toBeCloseTo(0.3, 6);
    // En-yakın-sıra: dönen değer HER ZAMAN gerçekten ölçülmüş bir örnektir.
    expect([0.1, 0.2, 0.3, 0.4, 0.5]).toContain(st!.p50);
    expect([0.1, 0.2, 0.3, 0.4, 0.5]).toContain(st!.p95);

    expect(computeRmsStats([])).toBeNull();
    expect(computeRmsStats(null)).toBeNull();
    expect(computeRmsStats(undefined)).toBeNull();
    // Geçersiz sayı yığını da istatistiğe DÖNÜŞMEZ.
    expect(computeRmsStats([NaN, Infinity, -1])).toBeNull();
  });

  it('8b. kayıt geçmişi BOUNDED kalır — halka tavanı aşılmaz (model + native + kaynak)', () => {
    const many = Array.from({ length: 500 }, (_, i) => i / 1000);
    const st = computeRmsStats(many);
    expect(st!.count).toBe(MAX_RMS_SAMPLES);

    // Native halka da aynı tavanı taşır ve modulo ile eskisini EZER (sınırsız büyümez).
    const native = stripComments(readSrc(...NATIVE_PATH));
    expect(native).toMatch(/RMS_RING_CAP\s*=\s*64/);
    expect(native).toMatch(/rmsHead\s*=\s*\(rmsHead \+ 1\) % RMS_RING_CAP/);
    expect(native).toMatch(/ATTEMPT_CAP\s*=\s*8/);

    // Kaynak katmanı da native'e körü körüne güvenmez, kendi tavanını uygular.
    const src = stripComments(readSrc(...SOURCES_PATH));
    expect(src).toMatch(/samples\.length < MAX_RMS_SAMPLES/);
    expect(src).toMatch(/attempts\.length >= MAX_SOURCE_ATTEMPTS/);
  });

  it('8c. bölüm başına alan sayısı BOUNDED (hiçbir bölüm tavanı aşmaz)', () => {
    for (const sec of buildSttSections(raw())) {
      expect(sec.fields.length).toBeLessThanOrEqual(MAX_FIELDS_PER_STT_SECTION);
    }
    expect(MAX_SOURCE_ATTEMPTS).toBe(8);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 — Araç bağlamı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-1 · 5. araç bağlamı', () => {
  it('5. hız BİLİNMİYORSA 0 GÖSTERİLMEZ — KAYNAK YOK olur', () => {
    const base = raw();
    const s = buildSttSections(raw({
      vehicle: { ...base.vehicle!, speedKmh: null, motionState: 'unknown' },
    }));
    const f = field(s, 'sttSpeed');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.value).not.toBe('0');
    expect(f?.note).toContain('BİLİNMİYOR');
    // "unknown" hareket durumu "DURUYOR"a indirgenmez.
    expect(field(s, 'sttMotion')?.value).toBe('BİLİNMİYOR');
    expect(field(s, 'sttMotion')?.value).not.toBe('DURUYOR');
  });

  it('5b. hız 0 GERÇEK bir ölçümse gösterilir (null ile karıştırılmaz)', () => {
    const base = raw();
    const s = buildSttSections(raw({
      vehicle: { ...base.vehicle!, speedKmh: 0, motionState: 'stopped' },
    }));
    expect(field(s, 'sttSpeed')?.klass).toBe('OBSERVED');
    expect(field(s, 'sttSpeed')?.value).toBe('0');
    expect(field(s, 'sttMotion')?.value).toBe('DURUYOR');
  });

  it('5c. klima/fan için repoda KAYNAK YOKTUR → sahte 0/"kapalı" ÜRETİLMEZ', () => {
    const s = buildSttSections(raw());
    const f = field(s, 'sttFan');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.note).toContain('KAYNAK YOK');
    // Kaynak katmanı da null yazar — uydurma sağlayıcı kurulmadı.
    expect(stripComments(readSrc(...SOURCES_PATH))).toMatch(/hvacFanLevel:\s*null/);
  });

  it('5d. hız ile gürültü AYNI okuma turunda örneklenir; sapma GİZLENMEZ', () => {
    // Kaynak katmanı tek `readAt` üretir ve araç bağlamını O damgayla örnekler.
    const src = stripComments(readSrc(...SOURCES_PATH));
    expect(src).toMatch(/const readAt = Date\.now\(\)/);
    expect(src).toMatch(/currentMaviVehicleContext\(readAt\)/);
    expect(src).toMatch(/sampledAt: readAt/);

    // Model, native damgasıyla arasındaki farkı AÇIKÇA gösterir.
    const s = buildSttSections(raw());
    expect(field(s, 'sttSampleSkew')?.value).toBe('1000');
    expect(field(s, 'sttSampleSkew')?.klass).toBe('DERIVED');
  });

  it('5e. NEDENSELLİK ÇIKARIMI YAPILMAZ ("hız gürültüyü artırdı" denmez)', () => {
    const s = buildSttSections(raw());
    expect(field(s, 'sttNoCausality')?.value).toContain('YAPILMADI');

    const markup = renderToStaticMarkup(<SttMicScreen />);
    expect(markup).not.toMatch(/gürültüyü artır|sebep oldu|yüzünden|neden oldu/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6/7 — Gizlilik: transcript, n-best, ham ses
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-1 · 6-7. gizlilik', () => {
  it('6. transcript ve n-best ne snapshot\'ta ne markup\'ta bulunur', () => {
    const snapJson = JSON.stringify(raw());
    expect(snapJson).not.toContain(SECRET_TRANSCRIPT);
    expect(snapJson).not.toContain(SECRET_NBEST);
    expect(snapJson).not.toContain(SECRET_WAKE_WORD);

    const markup = renderToStaticMarkup(<SttMicScreen />);
    expect(markup).not.toContain(SECRET_TRANSCRIPT);
    expect(markup).not.toContain(SECRET_NBEST);
    expect(markup).not.toContain(SECRET_WAKE_WORD);
  });

  it('6b. tip sözleşmesinde metin taşıyan kullanıcı-içeriği alanı YOKTUR (yapısal)', () => {
    const model = stripComments(readSrc(...MODEL_PATH));
    /* Tanımlayıcı sınırlarıyla aranır: `openBestMicRecorder` gibi meşru adların
       içinde geçen harf dizileri yanlış alarm ÜRETMESİN. */
    for (const banned of [
      'transcript', 'alternatives', 'nBest', 'lastCommand',
      'utterance', 'wakeWords', 'lastHeard', 'phrases', 'audioWav',
    ]) {
      expect(model).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
    // Grammar YALNIZ sınıf + adet olarak modellenir.
    expect(model).toMatch(/grammarWordCount/);
    expect(model).not.toMatch(/grammarWords\s*:\s*(readonly )?string\[\]/);
  });

  it('6c. wake sözcükleri ve grammar YALNIZ ADET olarak indirgenir', () => {
    const src = stripComments(readSrc(...SOURCES_PATH));
    // wakeWords dizisi SAYIYA indirgenir, dışarı verilmez.
    expect(src).toMatch(/wakePhraseCount:\s*wake \? _count\(wake\.wakeWords\)/);
    // lastHeard (duyulan transcript'ler) hiçbir yerde OKUNMAZ.
    expect(src).not.toContain('lastHeard');

    const s = buildSttSections(raw());
    expect(field(s, 'sttWakePhrases')?.value).toBe('2');
    expect(field(s, 'sttGrammarWords')?.value).toBe('214');
  });

  it('7. HAM SES saklanmaz/dışa aktarılmaz — native yalnız normalize skaler tutar', () => {
    const native = stripComments(readSrc(...NATIVE_PATH));
    // Ses tamponu tipleri (short[]/byte[]/PCM/WAV) tanı sınıfında BULUNMAZ.
    expect(native).not.toMatch(/short\[\]|byte\[\]|ByteArrayOutputStream|Base64|wav|WAV|pcm|PCM/);
    // Yalnız double halkası vardır.
    expect(native).toMatch(/private final double\[\] rmsRing/);

    // Model/kaynak katmanı da ham ses tipi taşımaz.
    expect(stripComments(readSrc(...MODEL_PATH))).not.toMatch(/Int16Array|Float32Array|ArrayBuffer|base64/);
    expect(stripComments(readSrc(...SOURCES_PATH))).not.toMatch(/Int16Array|Float32Array|ArrayBuffer|base64/);

    // Ekran dışa aktarma/kopyalama yüzeyi SUNMAZ.
    const screen = stripComments(readSrc(...SCREEN_PATH));
    expect(screen).not.toMatch(/download|Blob|createObjectURL|Clipboard|navigator\.clipboard/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 — Kaynak yoksa sahte değer yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-1 · 9. kanıt yoksa uydurma yok', () => {
  beforeEach(() => { _resetVoiceMicDiagnosticsForTest(); });

  it('9. native kanıt yokken TÜM bölümler KAYNAK YOK gösterir (sahte 0/başarı YOK)', () => {
    const s = buildSttSections(emptyRaw());
    expect(deriveSttProbeStatus(emptyRaw())).toBe('UNAVAILABLE');

    for (const id of ['sttSource', 'sttEffects', 'sttVad', 'sttVehicle', 'sttEngine']) {
      expect(field(s, id)?.klass).toBe('UNAVAILABLE');
    }
    const counts = countBySttClass(s);
    expect(counts.UNAVAILABLE).toBeGreaterThan(0);

    // Hiçbir alanda sahte "sağlıklı/başarılı/0 ms" değeri yok.
    for (const f of flat(s)) {
      if (f.klass === 'UNAVAILABLE') expect(f.value).toBe('—');
    }
  });

  it('9b. damga yoksa AVAILABLE DENMEZ (yaş doğrulanamaz → BAYAT)', () => {
    expect(deriveSttProbeStatus(raw({ capturedAt: null }))).toBe('STALE');
    expect(deriveSttProbeStatus(raw({ capturedAt: NOW - STT_MIC_STALE_MS - 1 }))).toBe('STALE');
    expect(deriveSttProbeStatus(raw({ capturedAt: NOW - 100 }))).toBe('AVAILABLE');
  });

  it('9c. önbellek başlangıçta BOŞ ve damgasızdır — "şimdi" uydurulmaz', () => {
    expect(getVoiceMicDiagnostics()).toEqual({ present: false });
    expect(getVoiceMicDiagnosticsCachedAt()).toBe(0);
  });

  it('9d. gerçek okuma katmanı (native yokken) fail-soft çalışır ve present:false verir', () => {
    const snap = readSttMicSnapshot();
    expect(snap.present).toBe(false);
    expect(snap.source).toBeNull();
    expect(snap.vad).toBeNull();
    expect(snap.schemaVersion).toBeNull();
    expect(snap.capturedAt).toBeNull();
    // readAt GERÇEK bir damgadır (okuma anı) — bu uydurma değildir.
    expect(snap.readAt).toBeGreaterThan(0);
  });

  it('9e. bilinmeyen enum değerleri güvenli tarafa düşer (fail-closed normalizasyon)', () => {
    expect(normalizePath('SOMETHING')).toBe('NONE');
    expect(normalizeGrammar('unknown')).toBe('free');
    expect(normalizeResult('weird')).toBeNull();
    expect(normalizeResult(null)).toBeNull();
    expect(normalizeAttempt('???')).toBe('EXCEPTION');
    expect(normalizeMotion('???')).toBe('unknown');
  });

  it('9f. son sonuç kaydı yoksa "başarılı" VARSAYILMAZ', () => {
    const base = raw();
    const s = buildSttSections(raw({
      stt: { ...base.stt!, lastResultCategory: null, lastResultAt: 0 },
    }));
    const f = field(s, 'sttLastResult');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.value).not.toMatch(/success/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 — Salt-okunur: davranış değiştirilemez
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-1 · 10. salt-okunur', () => {
  it('10. ekran hiçbir STT/mikrofon davranış fonksiyonunu ÇAĞIRAMAZ', () => {
    const screen = stripComments(readSrc(...SCREEN_PATH));
    for (const banned of [
      'startListening', 'stopListening', 'startSpeechRecognition', 'startWakeWordListening',
      'stopWakeWordListening', 'enableWakeWord', 'disableWakeWord', 'setWakeWord',
      'enrollWakeWord', 'preloadVoskModel', 'AudioRecord', 'getUserMedia',
      'setEnabled', 'notifyWakeDetected', 'speak(',
    ]) {
      expect(screen).not.toContain(banned);
    }
    // Ekranın native yüzeyi TEK bir salt-okunur pull'dur.
    expect(screen).toMatch(/refreshVoiceMicDiagnostics/);
    expect(screen.match(/CarLauncher\./g)).toBeNull();
  });

  it('10b. okuma katmanı SENKRON ve yan etkisizdir — await/timer/abonelik YOK', () => {
    const src = stripComments(readSrc(...SOURCES_PATH));
    expect(src).not.toMatch(/\bawait\b|setInterval|setTimeout|addListener|addEventListener/);
    expect(src).toMatch(/export function readSttMicSnapshot\(\): SttMicRaw/);
  });

  it('10c. saf model I/O · timer · Date.now · React içermez', () => {
    const model = stripComments(readSrc(...MODEL_PATH));
    expect(model).not.toMatch(/Date\.now|setInterval|setTimeout|performance\.now|from 'react'/);
    // Servis importu yok → girdi YAPISAL (mock'suz test edilir).
    expect(model).not.toMatch(/from '\.\.\/(voiceService|wakeWordService|nativePlugin)'/);
  });

  it('10d. native getter hiçbir ses yolunu BAŞLATMAZ (yalnız snapshot okur)', () => {
    const plugin = stripComments(readSrc(
      'android', 'app', 'src', 'main', 'java', 'com', 'cockpitos', 'pro', 'CarLauncherPlugin.java'));
    const start = plugin.indexOf('public void getVoiceMicDiagnostics(PluginCall call)');
    expect(start).toBeGreaterThan(0);
    const body = plugin.slice(start, plugin.indexOf('call.resolve(ret);', start));
    for (const banned of [
      'new AudioRecord', 'startRecording', 'setEnabled', 'runVoskListening', 'runVoskGrammar',
      'ensureVoskModel', 'requestPermissions', 'new Recognizer', 'notifyListeners',
    ]) {
      expect(body).not.toContain(banned);
    }
    expect(body).toContain('VoiceMicDiagnostics.INSTANCE.snapshot(');
  });

  it('10e. tanı biriktiricisi yalnız KAYIT tutar — eşik/kaynak/efekt kararı ÜRETMEZ', () => {
    const native = stripComments(readSrc(...NATIVE_PATH));
    /* YAPISAL KANIT: sınıfın TEK bağımlılığı `java.util` — Android/Vosk/ses API'si
       import EDİLMEZ, dolayısıyla mikrofonu açmak veya efekt/eşik değiştirmek
       teknik olarak İMKÂNSIZDIR (saf JUnit ile de test edilebilir). */
    const imports = native.match(/^import .+;$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const imp of imports) expect(imp).toMatch(/^import java\.util\./);

    for (const banned of ['new AudioRecord', 'MediaRecorder', 'AudioManager',
                          'new Recognizer', 'android.media', 'setEnabled(',
                          'new Thread', 'new Timer']) {
      expect(native).not.toContain(banned);
    }
    // Yalnız ölçümü YAZAN metotlar ve tek bir snapshot okuyucusu vardır.
    expect(native).toMatch(/public Snapshot snapshot\(long wallClockMs, long monotonicMs\)/);
  });

  it('10f. VAD eşikleri ve AudioSource aday sırası DEĞİŞMEDİ (davranış kilidi)', () => {
    const plugin = readSrc(
      'android', 'app', 'src', 'main', 'java', 'com', 'cockpitos', 'pro', 'CarLauncherPlugin.java');
    expect(plugin).toMatch(/VOSK_VAD_SILENCE_MS\s*=\s*1100/);
    expect(plugin).toMatch(/VOSK_VAD_MIN_THRESH\s*=\s*0\.010f/);
    expect(plugin).toMatch(/VOSK_VAD_FLOOR_FACTOR\s*=\s*1\.9f/);
    expect(plugin).toMatch(/VAD_RMS_ON\s*=\s*0\.012/);
    // Aday kaynak sırası: ASR-ideal → ham mik → çağrı yolu → sistem → kamera.
    const order = plugin.slice(plugin.indexOf('final int[] base = {'));
    const idxVr = order.indexOf('VOICE_RECOGNITION');
    const idxMic = order.indexOf('AudioSource.MIC');
    const idxVc = order.indexOf('VOICE_COMMUNICATION');
    expect(idxVr).toBeGreaterThan(-1);
    expect(idxVr).toBeLessThan(idxMic);
    expect(idxMic).toBeLessThan(idxVc);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11/12 — Yaşam döngüsü ve polling
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-1 · 11-12. yaşam döngüsü', () => {
  /* ⚠️ DÜRÜST SINIR: bu repoda `@testing-library/react` YOK ve jsdom'da
   * `react-dom/client` createRoot ÇALIŞMIYOR → `renderToStaticMarkup` EFFECT
   * ÇALIŞTIRMAZ. "Timer gerçekten kuruldu/temizlendi mi" RUNTIME'da ölçülemez;
   * buradaki kilitler YAPISALDIR. Cihaz gerçeği saha kütüğünde 🔴 maddedir —
   * burada "ölçüldü" DENMEZ. */
  it('11. ekran KAPALIYKEN host hiç render etmez → polling yapısal olarak imkânsız', () => {
    expect(shouldRenderCarosLab('none', true)).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', true)).toBe(true);
  });

  it('11b. otomatik yenileme VARSAYILAN KAPALI ve ilk markup bunu DÜRÜSTÇE yazar', () => {
    const screen = readSrc(...SCREEN_PATH);
    expect(screen).toMatch(/const \[autoRefresh, setAutoRefresh\] = useState\(false\)/);
    // Açılışta okuma TEK seferlik lazy initializer (render başına okuma YOK).
    expect(screen).toMatch(/useState<SttMicRaw>\(\(\) => readSttMicSnapshot\(\)\)/);
    expect(renderToStaticMarkup(<SttMicScreen />)).toContain('OTO YENİLE');
    expect(renderToStaticMarkup(<SttMicScreen />)).toContain('KAPALI');
  });

  it('11c. oto-yenileme aralığı en az 2 saniyedir', () => {
    expect(STT_AUTO_REFRESH_MS).toBeGreaterThanOrEqual(2000);
  });

  it('12. timer YALNIZ açıkken kurulur ve cleanup MUTLAKA temizler', () => {
    const screen = stripComments(readSrc(...SCREEN_PATH));
    const block = screen.slice(
      screen.indexOf('if (!autoRefresh) return;'), screen.indexOf('const sections'));
    expect(block).toMatch(/setInterval\(refresh, STT_AUTO_REFRESH_MS\)/);
    expect(block).toMatch(/return \(\) => \{ clearInterval\(id\); \}/);
    // Bağımlılık dizisi autoRefresh içerir → kapatınca interval SÖKÜLÜR.
    expect(block).toMatch(/\}, \[autoRefresh, refresh\]\)/);
  });

  it('12b. unmount sonrası setState YASAK — mountedRef kapısı vardır', () => {
    const screen = stripComments(readSrc(...SCREEN_PATH));
    expect(screen).toMatch(/mountedRef\.current = false/);
    expect(screen).toMatch(/if \(mountedRef\.current\) setSnap\(readSttMicSnapshot\(\)\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 13 — CAROS LAB entegrasyonu ve developer gate
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-STT-LAB-1 · 13. LAB entegrasyonu', () => {
  it('13. developer gate KORUNUR (LAB kapalıyken ekran erişilemez)', () => {
    expect(isCarosLabAllowed(false)).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', false)).toBe(false);
    expect(shouldRenderCarosLab('caros-lab', true)).toBe(true);
  });

  it('13b. katalog kaydı AVAILABLE ve gerçek ekrana çözülür', () => {
    const tool = getCarosLabTool('stt-mic');
    expect(tool).not.toBeNull();
    expect(tool!.category).toBe('ai');
    expect(tool!.status).toBe('AVAILABLE');
    expect(isToolOpenable(tool)).toBe(true);
    expect(resolveToolActivation(tool)).toBe('stt-mic');
    expect(renderAvailableTool('stt-mic')).not.toBeNull();
  });

  it('13c. katalog notu salt-okunurluğu ve gizlilik sınırını AÇIKÇA beyan eder', () => {
    const note = getCarosLabTool('stt-mic')!.note ?? '';
    expect(note).toContain('SALT');
    expect(note).toContain('transcript');
    expect(note).toContain('KAYNAK YOK');
  });

  it('13d. mevcut AI araçları (Mavi Konsolu · Eylem Otoritesi) BOZULMADI', () => {
    expect(getCarosLabTool('mavi-console')!.status).toBe('AVAILABLE');
    expect(getCarosLabTool('action-registry')!.status).toBe('AVAILABLE');
    expect(renderAvailableTool('mavi-console')).not.toBeNull();
    expect(renderAvailableTool('action-registry')).not.toBeNull();
  });

  it('13e. ekran OEM token\'larını kullanır (ham renk YOK) ve gözlem rozetlerini gösterir', () => {
    const markup = renderToStaticMarkup(<SttMicScreen />);
    expect(markup).toContain('--oem-');
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(markup).toContain('SALT OKUNUR');
    expect(markup).toContain('KAYNAK YOK');
  });
});
