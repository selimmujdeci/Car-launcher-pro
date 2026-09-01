/**
 * maviBargeInControl.test.ts — **MAVİ F12 · BARGE-IN / KONUŞMA KONTROLÜ KİLİTLERİ.**
 *
 * F12 iki şeyi birden kanıtlamak zorundadır:
 *   (a) Kesme kararının KANIT KALİTESİ — sahte kesme (self-echo · gürültü · VAD)
 *       reddedilir, gerçek kullanıcı kesmesi geçer.
 *   (b) Kabul edilen kesmenin ZİNCİRİ — eski tur yetkisini kaybeder, akış
 *       iptal edilir, sahte "tamamlandı" YAYINLANMAZ, öncelikler bozulmaz.
 *
 * Ayrıca **sahte full-duplex üretilmediği** kaynak düzeyinde kilitlenir: duplex
 * sınıfı KANITTAN türetilir ve repoda ölçülen kanıtla `HALF_DUPLEX_INTERRUPT`tir.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  classifyMaviDuplex, duplexAllowsAcousticBargeIn, duplexHasSelfEchoRisk,
  MAVI_MEASURED_DUPLEX_EVIDENCE, MAVI_DUPLEX_CLASS_NOTE,
  type MaviDuplexEvidence,
} from '../platform/voice/duplexCapability';
import {
  evaluateBargeIn, setMaviDuplexEvidence, currentMaviDuplexClass,
  noteBargeInTtsStopRequested, noteBargeInListeningOpened,
  getMaviBargeInDiagnostics, _resetMaviBargeInForTest,
  BARGE_IN_MIN_SPEECH_MS, BARGE_IN_DEBOUNCE_MS, BARGE_IN_MIN_CONF_MILLI,
  type BargeInContext,
} from '../platform/assistant/maviBargeIn';
import { WAKE_DECISION_REASONS } from '../platform/voice/core/wakeDecisionModel';

const SRC = join(process.cwd(), 'src');
const read = (...seg: string[]): string => readFileSync(join(SRC, ...seg), 'utf8');
const readAbs = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

/** Yorumları çıkarır — kaynak kilitleri YALNIZ gerçek koda bakar. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Mavi konuşuyor, korunan kanal DEĞİL, mikrofon bu yolda açık. */
const SPEAKING: BargeInContext = {
  ttsSpeaking: true, protectedSpeech: false, captureOpenOnThisPath: true,
};

/** Duplex'i AÇIK varsayan kanıt (native ölçüm geldiğinde oluşacak durum). */
const DUPLEX_PROVEN: MaviDuplexEvidence = Object.freeze({
  micDiagnosticsPresent: true,
  captureOpenDuringTts:  true,
  aecEnabled:            true,
  aecEvidencePath:       'DUPLEX_CAPTURE' as const,
  echoReferenceWired:    true,
  cancelChainReady:      true,
});

beforeEach(() => { _resetMaviBargeInForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * A — DUPLEX YETENEK SINIFI (sahte full-duplex yasağı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · duplex yetenek sınıfı', () => {
  it('🔒 Repoda ÖLÇÜLEN kanıt HALF_DUPLEX_INTERRUPT verir — üst sınıf İLAN EDİLMEZ', () => {
    /* `wakeMicMustYield()` TTS sırasında mikrofonu bırakır, wake yolunda AEC
       HİÇ kurulmaz, echo referansı YOKTUR. Kanıt yoksa sınıf yükselmez. */
    expect(classifyMaviDuplex(MAVI_MEASURED_DUPLEX_EVIDENCE)).toBe('HALF_DUPLEX_INTERRUPT');
    expect(currentMaviDuplexClass()).toBe('HALF_DUPLEX_INTERRUPT');
    expect(duplexAllowsAcousticBargeIn('HALF_DUPLEX_INTERRUPT')).toBe(false);
  });

  it('🔒 AKTİF DİNLEME yolunda ölçülen AEC duplex kanıtı SAYILMAZ (kanıt transferi yasak)', () => {
    /* Aktif STT yolu TTS ile ASLA çakışmaz (`startListening` ilk iş `ttsCancel`
       çağırır) → orada ölçülen AEC duplex hakkında hiçbir şey kanıtlamaz. */
    const ev: MaviDuplexEvidence = {
      ...DUPLEX_PROVEN, aecEvidencePath: 'ACTIVE_LISTEN', echoReferenceWired: false,
    };
    expect(classifyMaviDuplex(ev)).toBe('HALF_DUPLEX_INTERRUPT');
  });

  it('AEC var + referans sinyali YOK → AEC_GATED_DUPLEX (TRUE değil)', () => {
    expect(classifyMaviDuplex({ ...DUPLEX_PROVEN, echoReferenceWired: false }))
      .toBe('AEC_GATED_DUPLEX');
  });

  it('Üç kanıt da varsa TRUE_FULL_DUPLEX', () => {
    expect(classifyMaviDuplex(DUPLEX_PROVEN)).toBe('TRUE_FULL_DUPLEX');
  });

  it('İptal zinciri kanıtlanmazsa UNSUPPORTED (fail-closed)', () => {
    expect(classifyMaviDuplex({ ...DUPLEX_PROVEN, cancelChainReady: false })).toBe('UNSUPPORTED');
    expect(classifyMaviDuplex(null)).toBe('UNSUPPORTED');
    expect(classifyMaviDuplex(undefined)).toBe('UNSUPPORTED');
  });

  it('Self-echo riski = mikrofon açık + duplex yolunda AEC kanıtı yok', () => {
    expect(duplexHasSelfEchoRisk(MAVI_MEASURED_DUPLEX_EVIDENCE, true)).toBe(true);
    expect(duplexHasSelfEchoRisk(MAVI_MEASURED_DUPLEX_EVIDENCE, false)).toBe(false);
    expect(duplexHasSelfEchoRisk(DUPLEX_PROVEN, true)).toBe(false);
  });

  it('Her sınıfın açıklaması vardır (LAB dürüstlüğü)', () => {
    for (const k of ['TRUE_FULL_DUPLEX', 'AEC_GATED_DUPLEX',
                     'HALF_DUPLEX_INTERRUPT', 'UNSUPPORTED'] as const) {
      expect(MAVI_DUPLEX_CLASS_NOTE[k].length).toBeGreaterThan(20);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — HAKEM: SAHTE KESME REDDİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · sahte kesme reddi', () => {
  it('🔒 SELF-ECHO: Mavi konuşurken gelen wake tetiği KANIT SAYILMAZ', () => {
    const v = evaluateBargeIn({ evidence: 'WAKE_TRIGGER', atMs: 1000 }, SPEAKING);
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('REJECTED_SELF_ECHO_RISK');
  });

  it('🔒 VAD/ENERJİ TEK BAŞINA asla kesmez — duplex KANITLANMIŞ olsa bile', () => {
    setMaviDuplexEvidence(DUPLEX_PROVEN);
    const v = evaluateBargeIn(
      { evidence: 'VAD_ENERGY', atMs: 1000, speechMs: 5000, confidenceMilli: 1000 },
      SPEAKING);
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('REJECTED_EVIDENCE_INSUFFICIENT');
  });

  it('🔒 KISA SPIKE reddedilir (yol gürültüsü · müzik transient\'i)', () => {
    setMaviDuplexEvidence(DUPLEX_PROVEN);
    const v = evaluateBargeIn(
      { evidence: 'ASR_PARTIAL', atMs: 1000, speechMs: BARGE_IN_MIN_SPEECH_MS - 1,
        confidenceMilli: 1000 },
      SPEAKING);
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('REJECTED_TOO_SHORT');
  });

  it('🔒 ÖLÇÜLMEMİŞ süre "yeterli" SAYILMAZ (olmayan sinyal uydurulmaz)', () => {
    setMaviDuplexEvidence(DUPLEX_PROVEN);
    for (const bad of [undefined, -1, Number.NaN]) {
      const v = evaluateBargeIn(
        { evidence: 'ASR_PARTIAL', atMs: 1000, speechMs: bad as number, confidenceMilli: 1000 },
        SPEAKING);
      expect(v.accepted).toBe(false);
      expect(v.reason).toBe('REJECTED_EVIDENCE_INSUFFICIENT');
    }
  });

  it('🔒 AEC_GATED yolda GÜVEN eşiği zorunludur; ölçülmemiş güven kabul edilmez', () => {
    setMaviDuplexEvidence({ ...DUPLEX_PROVEN, echoReferenceWired: false });
    expect(currentMaviDuplexClass()).toBe('AEC_GATED_DUPLEX');

    const low = evaluateBargeIn(
      { evidence: 'ASR_PARTIAL', atMs: 1000, speechMs: 800,
        confidenceMilli: BARGE_IN_MIN_CONF_MILLI - 1 }, SPEAKING);
    expect(low.reason).toBe('REJECTED_EVIDENCE_INSUFFICIENT');

    const none = evaluateBargeIn(
      { evidence: 'ASR_PARTIAL', atMs: 3000, speechMs: 800 }, SPEAKING);
    expect(none.reason).toBe('REJECTED_EVIDENCE_INSUFFICIENT');

    const ok = evaluateBargeIn(
      { evidence: 'ASR_PARTIAL', atMs: 5000, speechMs: 800,
        confidenceMilli: BARGE_IN_MIN_CONF_MILLI }, SPEAKING);
    expect(ok.accepted).toBe(true);
    expect(ok.reason).toBe('ACCEPTED_SPEECH_EVIDENCE');
  });

  it('Kesmenin hemen ardındaki eko kuyruğu İKİNCİ kez kesemez (debounce)', () => {
    setMaviDuplexEvidence(DUPLEX_PROVEN);
    const first = evaluateBargeIn(
      { evidence: 'ASR_PARTIAL', atMs: 1000, speechMs: 900, confidenceMilli: 900 }, SPEAKING);
    expect(first.accepted).toBe(true);

    const echo = evaluateBargeIn(
      { evidence: 'ASR_PARTIAL', atMs: 1000 + BARGE_IN_DEBOUNCE_MS - 1, speechMs: 900,
        confidenceMilli: 900 }, SPEAKING);
    expect(echo.accepted).toBe(false);
    expect(echo.reason).toBe('REJECTED_DEBOUNCE');
  });

  it('Konuşma yoksa bu bir kesme DEĞİLDİR (hata da değildir)', () => {
    const v = evaluateBargeIn({ evidence: 'EXPLICIT_USER', atMs: 1000 },
      { ...SPEAKING, ttsSpeaking: false });
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('REJECTED_NOT_SPEAKING');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — GERÇEK KULLANICI KESMESİ + ÖNCELİK
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · gerçek kesme ve öncelik', () => {
  it('Açık kullanıcı eylemi yarım-duplexte BİLE kabul edilir (kullanıcı daima kazanır)', () => {
    expect(currentMaviDuplexClass()).toBe('HALF_DUPLEX_INTERRUPT');
    const v = evaluateBargeIn({ evidence: 'EXPLICIT_USER', atMs: 1000 }, SPEAKING);
    expect(v.accepted).toBe(true);
    expect(v.reason).toBe('ACCEPTED_EXPLICIT');
  });

  it('🔒 GÜVENLİK/NAVİGASYON sesi HİÇBİR kanıtla kesilemez (K1 önceliği korunur)', () => {
    setMaviDuplexEvidence(DUPLEX_PROVEN);
    const ctx: BargeInContext = { ...SPEAKING, protectedSpeech: true };
    for (const kind of ['EXPLICIT_USER', 'WAKE_TRIGGER', 'ASR_PARTIAL', 'VAD_ENERGY'] as const) {
      const v = evaluateBargeIn(
        { evidence: kind, atMs: 1000, speechMs: 5000, confidenceMilli: 1000 }, ctx);
      expect(v.accepted).toBe(false);
      expect(v.reason).toBe('REJECTED_PROTECTED_AUDIO');
    }
  });

  it('Açık kullanıcı eylemi debounce\'a TABİ DEĞİLDİR (düğme yankı olamaz)', () => {
    const a = evaluateBargeIn({ evidence: 'EXPLICIT_USER', atMs: 1000 }, SPEAKING);
    const b = evaluateBargeIn({ evidence: 'EXPLICIT_USER', atMs: 1001 }, SPEAKING);
    expect(a.accepted).toBe(true);
    expect(b.accepted).toBe(true);
  });

  it('Bozuk/eksik girdi SESSİZCE reddedilir — throw ETMEZ', () => {
    expect(() => evaluateBargeIn(null, null)).not.toThrow();
    expect(evaluateBargeIn(null, SPEAKING).reason).toBe('REJECTED_EVIDENCE_INSUFFICIENT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — BOUNDED DEFTER + DÜRÜST GECİKME
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · defter ve gecikme dürüstlüğü', () => {
  it('Öneri/kabul/gerekçe sayaçları tutulur; PII taşımaz', () => {
    evaluateBargeIn({ evidence: 'WAKE_TRIGGER', atMs: 10 }, SPEAKING);
    evaluateBargeIn({ evidence: 'EXPLICIT_USER', atMs: 20 }, SPEAKING);
    const d = getMaviBargeInDiagnostics();
    expect(d.proposals).toBe(2);
    expect(d.accepted).toBe(1);
    expect(d.reasons.REJECTED_SELF_ECHO_RISK).toBe(1);
    expect(d.reasons.ACCEPTED_EXPLICIT).toBe(1);
    expect(d.evidenceKinds.WAKE_TRIGGER).toBe(1);
    expect(JSON.stringify(d)).not.toMatch(/transcript|text|utterance/i);
  });

  it('🔒 ÖLÇÜM YOK sahte `0 ms` gibi GÖSTERİLMEZ (-1 korunur)', () => {
    const d = getMaviBargeInDiagnostics();
    expect(d.lastTtsStopRequestMs).toBe(-1);
    expect(d.maxTtsStopRequestMs).toBe(-1);
    expect(d.lastListenOpenMs).toBe(-1);
    expect(d.ttsStopSamples).toBe(0);
  });

  it('Gecikme YALNIZ kabul edilmiş kesmeden sonra ölçülür', () => {
    noteBargeInTtsStopRequested(999);          // kabul yok → yok sayılır
    expect(getMaviBargeInDiagnostics().lastTtsStopRequestMs).toBe(-1);

    evaluateBargeIn({ evidence: 'EXPLICIT_USER', atMs: 1000 }, SPEAKING);
    noteBargeInTtsStopRequested(1040);
    noteBargeInListeningOpened(1310);
    const d = getMaviBargeInDiagnostics();
    expect(d.lastTtsStopRequestMs).toBe(40);
    expect(d.lastListenOpenMs).toBe(310);
    expect(d.maxTtsStopRequestMs).toBe(40);
  });

  it('Geriye giden damga ölçüme YAZILMAZ (negatif süre yok)', () => {
    evaluateBargeIn({ evidence: 'EXPLICIT_USER', atMs: 1000 }, SPEAKING);
    noteBargeInTtsStopRequested(900);
    expect(getMaviBargeInDiagnostics().lastTtsStopRequestMs).toBe(-1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — MİMARİ KİLİTLER (kaynak düzeyi)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · mimari kilitler', () => {
  const arbiter = read('platform', 'assistant', 'maviBargeIn.ts');
  const capability = read('platform', 'voice', 'duplexCapability.ts');
  const voiceSvc = read('platform', 'voiceService.ts');
  const wakeSvc = read('platform', 'wakeWordService.ts');
  const tts = read('platform', 'ttsService.ts');

  it('🔒 İŞ YÜKÜ (F8) konuşma otoritesi DEĞİLDİR — hakem `maviWorkload` OKUMAZ', () => {
    /* Workload iletişim BÜTÇESİ koyar; kesme yeteneğini KAPATAMAZ. Kaynağa
       bir workload importu girerse bu kilit kırmızıya döner. */
    expect(stripComments(arbiter)).not.toMatch(/maviWorkload|currentMaviWorkload/);
  });

  it('🔒 Hakem YENİ bir ses otoritesi kurmaz — TTS kesmez, mikrofon açmaz, tur açmaz', () => {
    const code = stripComments(arbiter);
    for (const forbidden of ['ttsCancel', 'startListening', 'beginMaviTurn',
                             'dispatchIntent', 'commandExecutor', 'speakMaviAnswer']) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('🔒 Yetenek matrisi SAFtır — hiçbir modül import ETMEZ', () => {
    expect(stripComments(capability)).not.toMatch(/^\s*import\s/m);
  });

  it('🔒 `interruptAndListen` hakemden GEÇER ve korunan sesi KESMEZ', () => {
    const code = stripComments(voiceSvc);
    const i = code.indexOf('export function interruptAndListen');
    expect(i).toBeGreaterThan(-1);
    const body = code.slice(i, i + 2400);
    expect(body).toContain('evaluateBargeIn');
    expect(body).toContain("REJECTED_PROTECTED_AUDIO");
    /* Korunan kanalda ERKEN dönülür → `startListening()` hiç çağrılmaz. */
    expect(body.indexOf('REJECTED_PROTECTED_AUDIO'))
      .toBeLessThan(body.indexOf('startListening()'));
  });

  it('🔒 KABUL EDİLEN kesme eski turu SUPERSEDE eder (geç sonuç eski cevabı diriltemez)', () => {
    /* Bu satır F12'nin kapattığı gerçek açıktır: `supersedeActiveMaviTurn`
       M5'te yazılmış ama ÜRETİMDE HİÇ ÇAĞRILMIYORDU. */
    const code = stripComments(voiceSvc);
    const i = code.indexOf('export function interruptAndListen');
    const body = code.slice(i, i + 2400);
    expect(body).toContain('supersedeActiveMaviTurn()');
    /* F4 iptal zinciri KORUNUR — supersede onun YERİNE geçmez. */
    expect(body).toContain('cancelActiveResponseStream()');
    /* MAVI-F13/2'de YENİDEN BAĞLANDI: kısmi transkript oturumu
       `voice/voicePerceptionRuntime`e taşındı; çağrı `interruptAndListen`
       gövdesinde AYNEN durur, yalnız adı kanonikleşti. */
    expect(body).toContain("closePartialTranscriptSession('CANCELLED')");
  });

  it('🔒 WAKE yolunda SELF-ECHO kapısı vardır ve hakeme bağlıdır', () => {
    const code = stripComments(wakeSvc);
    expect(code).toContain('evaluateBargeIn');
    expect(code).toContain("reason: 'SUPPRESSED_SELF_ECHO'");
    expect(code).toContain('isMicCaptureOpenDuringSpeech()');
    /* Wake yolu KENDİ duplex kararını vermez — sınıfı hakemden okur. */
    expect(code).not.toContain('classifyMaviDuplex');
  });

  it('🔒 SUPPRESSED_SELF_ECHO taksonomiye eklendi (JS\'te GÖRÜLEBİLİR bir karardır)', () => {
    expect(WAKE_DECISION_REASONS).toContain('SUPPRESSED_SELF_ECHO');
    /* Native dilim kararları JS taksonomisine hâlâ EKLENMEMİŞ olmalı. */
    expect(WAKE_DECISION_REASONS as readonly string[])
      .not.toContain('NOT_EVALUATED_TTS_HALF_DUPLEX');
  });

  it('🔒 Korunan kanallar `ttsService`de SABİTLENİR (güvenlik · tehlike · navigasyon)', () => {
    const code = stripComments(tts);
    expect(code).toMatch(/PROTECTED_SPEECH_CHANNELS[\s\S]{0,120}'SAFETY'[\s\S]{0,40}'HAZARD'[\s\S]{0,40}'NAVIGATION'/);
    expect(code).toContain("_pinSpeechChannel('SAFETY')");
    expect(code).toContain("_pinSpeechChannel('HAZARD')");
    expect(code).toContain("_pinSpeechChannel('NAVIGATION')");
  });

  it('🔒 Akış ortasında kanal/taşıma SIFIRLANMAZ (self-echo kanıtı kaybolmaz)', () => {
    const code = stripComments(tts);
    const i = code.indexOf('function _notifyTtsEnd');
    const body = code.slice(i, i + 700);
    expect(body).toContain('_refreshSpeakingClock()');
    expect(body).not.toContain('_markSpeakingStart()');
  });

  it('🔒 NATIVE yarım-duplex sözleşmesi DEĞİŞMEDİ — `wakeMicMustYield` fallback KALIR', () => {
    /* Spec F12: "wakeMicMustYield fallback olarak KALIR". Bu kilit, duplex
       sınıfının `HALF_DUPLEX_INTERRUPT` olmasının NEDENİNİ kaynakta tutar. */
    const java = readAbs('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(java).toMatch(/private boolean wakeMicMustYield\(\)/);
    expect(java).toMatch(/return voskCapturing \|\| ttsYield \|\| savedSpeechCall != null;/);
    /* WAKE yolunda hâlâ AEC KURULMUYOR — kanıt yokluğu ölçülebilir kalmalı. */
    const grammar = java.slice(java.indexOf('private void runVoskGrammar()'),
                               java.indexOf('private void runVoskGrammar()') + 6000);
    expect(grammar).not.toContain('AcousticEchoCanceler');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F — LAB GÖZLEM YÜZEYİ (yeni ekran YOK)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · CAROS LAB gözlemlenebilirliği', () => {
  it('🔒 YENİ EKRAN AÇILMADI — mevcut Mavi Konsolu J bölümüyle genişletildi', () => {
    const catalog = stripComments(read('platform', 'devtools', 'carosLabCatalog.ts'));
    expect(catalog).not.toContain("'barge-in-console'");
    expect(catalog).not.toContain("'duplex-console'");
    const model = read('platform', 'devtools', 'maviConsoleModel.ts');
    expect(model).toContain("'barge-in': 'J · Barge-in ve Konuşma Kontrolü (F12)'");
  });

  it('🔒 LAB ikinci otorite OLAMAZ — kaynak katmanı hüküm ÜRETMEZ', () => {
    const sources = stripComments(read('platform', 'devtools', 'maviConsoleSources.ts'));
    expect(sources).toContain('getMaviBargeInDiagnostics');
    expect(sources).not.toContain('evaluateBargeIn');
    expect(sources).not.toContain('setMaviDuplexEvidence');
  });
});
