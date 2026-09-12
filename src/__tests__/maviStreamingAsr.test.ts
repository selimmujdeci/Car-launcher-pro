/**
 * maviStreamingAsr.test.ts — **MAVI-F3 · STREAMING ASR + SEMANTİK ENDPOINT KİLİDİ.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Mavi, kullanıcının cümlesinin BİTMESİNİ bekleyip sonra anlamaya başlayan
 * klasik bir komut sistemiydi: kısmi transkript JS'e HİÇ ulaşmıyordu
 * (`onPartialResults` gövdesi BOŞTU, `EXTRA_PARTIAL_RESULTS` istenmiyordu) ve
 * cümle-sonu kararı TEK sensörlüydü (akustik VAD, 1100 ms). O eşik bilinçli
 * olarak 900'den 1100'e ÇIKARILMIŞTI — çünkü tek sensörle "kesmemek" ancak
 * "yavaş olmak" pahasına alınabiliyordu.
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  1. **Kısmi transkript EYLEM YETKİSİ TAŞIMAZ** — en kritik kilit (spec K5/I4).
 *  2. Eskimiş/iptal edilmiş oturumun kısmi olayı YENİ oturumu ETKİLEYEMEZ.
 *  3. Kullanıcının sözü agresif kesilmez: askıda cümle ("… ama", "Ankara'ya")
 *     ASLA erken bitirilmez; histerezis olmadan karar verilmez.
 *  4. Kendini düzeltme ("Ankara'ya… yok Mersin'e götür") korunur.
 *  5. Sessizlik kanıtı OLMAYAN sağlayıcıda semantik yol ÇALIŞMAZ (sahte VAD YOK).
 *  6. Endpoint sebebi gözlemlenebilir ve bounded'dır.
 *  7. Gizlilik: kısmi METİN tanı yüzeyine / telemetriye HİÇ girmez.
 *  8. F2 invaryantı korunur: bekleme sırasında filler ÜRETİLMEZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  classifyCompleteness, decideEndpoint, areThresholdsConsistent,
  DEFAULT_ENDPOINT_THRESHOLDS,
  type EndpointEvidence, type EndpointThresholds,
} from '../platform/voice/semanticEndpointer';
import {
  openListenSession, closeListenSession, notePartial, noteProviderFinal,
  configureSttPartialPorts, activeListenSessionId, getSttPartialDiagnostics,
  _resetSttPartialStreamForTest, PARTIAL_TEXT_MAX_CHARS,
  type SttEndpointEvent,
} from '../platform/voice/sttPartialStream';

const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');
const codeOf = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Kanıt kurucusu — yalnız ilgilendiğimiz alanı değiştirip gerisini sabitler. */
function ev(over: Partial<EndpointEvidence> = {}): EndpointEvidence {
  return {
    partialText: 'eve gotur',
    partialCount: 3,
    stableForMs: 1000,
    silenceMs: 1000,
    speechDurationMs: 1500,
    sessionElapsedMs: 2000,
    providerFinal: false,
    cancelled: false,
    ...over,
  };
}

/* Test saati — monotonik, elle ilerletilir (gerçek timer YOK). */
let T = 0;
const decisions: SttEndpointEvent[] = [];
let finalizeCalls = 0;

beforeEach(() => {
  _resetSttPartialStreamForTest();
  T = 0; finalizeCalls = 0; decisions.length = 0;
  configureSttPartialPorts({
    now: () => T,
    finalize: () => { finalizeCalls += 1; },
    onDecision: (d) => { decisions.push(d); },
  });
});
afterEach(() => { _resetSttPartialStreamForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * A — Türkçe anlam tamamlanmışlığı (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F3 · A · anlam tamamlanmışlığı', () => {
  it('1. çekimli fiille biten komut TAMAMLANMIŞ sayılır', () => {
    for (const t of [
      'beni eve gotur', 'Beni eve götür', 'müziği aç', 'radyoyu kapat',
      'Kadıköy\'e git', 'Sezen Aksu çal', 'annemi ara', 'arıza kodlarını göster',
      'parlaklığı azalt', 'yağ sıcaklığını söyle', 'navigasyonu başlat',
      'bana bir fıkra anlatır mısın', 'eve gidiyorum', 'yarın gideceğim',
    ]) expect(classifyCompleteness(t), t).toBe('COMPLETE');
  });

  it('2. ASKIDA bırakan son sözcük ASLA tamamlanmış sayılmaz (sözü kesme yasağı)', () => {
    for (const t of [
      'beni eve götür ama',            // kullanıcının verdiği kritik örnek
      'müziği aç ve', 'eve git de', 'Kadıköy\'e gidelim ancak',
      'şunu yap yani', 'bir şey soracaktım şey',
      'Ankara\'ya',                    // fiil HENÜZ gelmedi
      'beni', 'bana', 'şunu',
    ]) expect(classifyCompleteness(t), t).toBe('DANGLING');
  });

  it('3. KENDİNİ DÜZELTME askıda kalır — "yok/hayır/pardon" bitiş DEĞİLDİR', () => {
    expect(classifyCompleteness('ankaraya')).toBe('DANGLING');
    expect(classifyCompleteness('ankaraya yok')).toBe('DANGLING');
    expect(classifyCompleteness('ankaraya yok pardon')).toBe('DANGLING');
    // Düzeltme TAMAMLANINCA cümle biter ve NİHAİ metin bütünüdür (hedefi beyin çözer).
    expect(classifyCompleteness('ankaraya yok mersine gotur')).toBe('COMPLETE');
  });

  it('4. karar verilemeyen metin UNKNOWN\'dır — "tamamlandı" DEĞİL', () => {
    expect(classifyCompleteness('kirmizi araba')).toBe('UNKNOWN');
    expect(classifyCompleteness('')).toBe('EMPTY');
    expect(classifyCompleteness('   ')).toBe('EMPTY');
    expect(classifyCompleteness(null)).toBe('EMPTY');
  });

  it('5. ASKIDA kontrolü FİİL kontrolünden ÖNCE gelir (sıra bir güvenlik gereğidir)', () => {
    /* "götür" bir fiildir; fiil kontrolü önce yapılsaydı "beni eve götür ama"
       TAMAMLANMIŞ sanılır ve kullanıcının sözü KESİLİRDİ. */
    expect(classifyCompleteness('beni eve gotur')).toBe('COMPLETE');
    expect(classifyCompleteness('beni eve gotur ama')).toBe('DANGLING');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — Endpoint kararı (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F3 · B · kanıt temelli endpoint kararı', () => {
  it('6. tek kanıt yetmez — HİSTEREZİS olmadan bitirilmez', () => {
    const first = decideEndpoint(ev());
    expect(first.endpoint).toBe(false);          // 1. tik: karar YOK
    expect(first.agreeingTicks).toBe(1);
    const second = decideEndpoint(ev(), DEFAULT_ENDPOINT_THRESHOLDS, first.agreeingTicks);
    expect(second.endpoint).toBe(true);
    expect(second.reason).toBe('SEMANTIC_CONFIDENT');
  });

  it('7. tek bir koşul eksikse DEVAM edilir ve histerezis SIFIRLANIR', () => {
    const base = decideEndpoint(ev());
    expect(base.agreeingTicks).toBe(1);
    // metin yeniden değişti (kararlılık kayboldu) → sayaç sıfırlanır
    const reset = decideEndpoint(ev({ stableForMs: 10 }), DEFAULT_ENDPOINT_THRESHOLDS, base.agreeingTicks);
    expect(reset.endpoint).toBe(false);
    expect(reset.agreeingTicks).toBe(0);
  });

  it('8. ASKIDA cümle sessizlik dolsa bile SEMANTİK olarak bitirilmez', () => {
    const d = decideEndpoint(ev({ partialText: 'beni eve gotur ama', silenceMs: 1000 }),
      DEFAULT_ENDPOINT_THRESHOLDS, 5);
    expect(d.endpoint).toBe(false);
    expect(d.completeness).toBe('DANGLING');
  });

  it('9. kısa konuşma semantik olarak bitirilmez (yanlış tetik kalkanı)', () => {
    const d = decideEndpoint(ev({ speechDurationMs: 100 }), DEFAULT_ENDPOINT_THRESHOLDS, 5);
    expect(d.endpoint).toBe(false);
  });

  it('10. sessizlik ÖLÇÜLMEMİŞSE (null) semantik yol ÇALIŞMAZ — sahte VAD yok', () => {
    const d = decideEndpoint(ev({ silenceMs: null }), DEFAULT_ENDPOINT_THRESHOLDS, 5);
    expect(d.endpoint).toBe(false);
  });

  it('11. akustik eşik dolduysa sebep ACOUSTIC_TIMEOUT\'tur (semantik sahiplenmez)', () => {
    const d = decideEndpoint(ev({ silenceMs: 1100 }), DEFAULT_ENDPOINT_THRESHOLDS, 5);
    expect(d.endpoint).toBe(true);
    expect(d.reason).toBe('ACOUSTIC_TIMEOUT');   // ölçüm YALAN söylemez
  });

  it('12. öncelik sırası: iptal > sağlayıcı finali > failsafe > akustik', () => {
    expect(decideEndpoint(ev({ cancelled: true, providerFinal: true })).reason).toBe('CANCELLED');
    expect(decideEndpoint(ev({ providerFinal: true, silenceMs: 1100 })).reason).toBe('FINAL_PROVIDER');
    expect(decideEndpoint(ev({ sessionElapsedMs: 99_999, silenceMs: 0 })).reason)
      .toBe('MAX_DURATION_FAILSAFE');
  });

  it('13. varsayılan eşikler İÇSEL OLARAK TUTARLI (semantik ≤ akustik taban)', () => {
    expect(areThresholdsConsistent(DEFAULT_ENDPOINT_THRESHOLDS)).toBe(true);
    expect(DEFAULT_ENDPOINT_THRESHOLDS.semanticSilenceMs)
      .toBeLessThanOrEqual(DEFAULT_ENDPOINT_THRESHOLDS.acousticSilenceMs);
    expect(DEFAULT_ENDPOINT_THRESHOLDS.minAgreeingTicks).toBeGreaterThanOrEqual(2);
    // Bozuk yapılandırma YAPISAL olarak yakalanır.
    const broken: EndpointThresholds = { ...DEFAULT_ENDPOINT_THRESHOLDS, semanticSilenceMs: 2000 };
    expect(areThresholdsConsistent(broken)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — Oturum runtime'ı: sahiplik · gizlilik · komut kipi
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F3 · C · kısmi transkript oturumu', () => {
  it('14. kısmi olay canlı pipeline\'a ulaşır ve karar üretir', () => {
    const sid = openListenSession({ capability: 'STREAMING_WITH_VAD', commandFinalize: true });
    expect(activeListenSessionId()).toBe(sid);
    T = 100; notePartial(sid, { text: 'beni', silenceMs: 0, speechMs: 300 });
    T = 900; notePartial(sid, { text: 'beni eve gotur', silenceMs: 0, speechMs: 900 });
    T = 1500; notePartial(sid, { text: 'beni eve gotur', silenceMs: 950, speechMs: 900 });
    T = 1700; const d = notePartial(sid, { text: 'beni eve gotur', silenceMs: 950, speechMs: 900 });
    expect(d?.endpoint).toBe(true);
    expect(d?.reason).toBe('SEMANTIC_CONFIDENT');
    expect(getSttPartialDiagnostics().partialsTotal).toBe(4);
  });

  it('15. **KISMİ SONUÇ EYLEM ÜRETMEZ** — tek yan etki mikrofonu kapatmaktır', () => {
    const sid = openListenSession({ capability: 'STREAMING_WITH_VAD', commandFinalize: true });
    T = 900;  notePartial(sid, { text: 'muzigi ac', silenceMs: 0, speechMs: 900 });
    T = 1500; notePartial(sid, { text: 'muzigi ac', silenceMs: 950, speechMs: 900 });
    T = 1700; notePartial(sid, { text: 'muzigi ac', silenceMs: 950, speechMs: 900 });
    // Karar verildi VE komut gönderildi — ama yapılan TEK şey finalize'dir.
    expect(finalizeCalls).toBe(1);
    expect(decisions[0].reason).toBe('SEMANTIC_CONFIDENT');
    expect(decisions[0].commanded).toBe(true);
    /* Modül hiçbir CarOS yeteneğini İMPORT ETMEZ → eylem yapısal olarak imkânsız.
       (Kaynak kilidi aşağıda 22. maddede ayrıca doğrulanır.) */
  });

  it('16. KOMUT KİPİ KAPALIYKEN (varsayılan) karar ÖLÇÜLÜR ama sağlayıcıya DOKUNULMAZ', () => {
    const sid = openListenSession({ capability: 'STREAMING_WITH_VAD' }); // commandFinalize yok
    T = 900;  notePartial(sid, { text: 'muzigi ac', silenceMs: 0, speechMs: 900 });
    T = 1500; notePartial(sid, { text: 'muzigi ac', silenceMs: 950, speechMs: 900 });
    T = 1700; const d = notePartial(sid, { text: 'muzigi ac', silenceMs: 950, speechMs: 900 });
    expect(d?.endpoint).toBe(true);              // karar VAR
    expect(finalizeCalls).toBe(0);               // ama cihaz davranışı DEĞİŞMEDİ
    expect(decisions[0].commanded).toBe(false);  // gölge karar olarak işaretli
  });

  it('17. ESKİMİŞ oturumun kısmi olayı yeni oturumu ETKİLEMEZ', () => {
    const old = openListenSession({ capability: 'STREAMING_WITH_VAD', commandFinalize: true });
    const fresh = openListenSession({ capability: 'STREAMING_WITH_VAD', commandFinalize: true });
    expect(fresh).not.toBe(old);
    T = 900;  expect(notePartial(old, { text: 'eve gotur', silenceMs: 950, speechMs: 900 })).toBeNull();
    T = 1500; expect(notePartial(old, { text: 'eve gotur', silenceMs: 950, speechMs: 900 })).toBeNull();
    expect(finalizeCalls).toBe(0);
    expect(getSttPartialDiagnostics().staleDropped).toBeGreaterThan(0);
    expect(getSttPartialDiagnostics().openPartialCount).toBe(0);   // yeni oturum TEMİZ
  });

  it('18. İPTAL EDİLMİŞ oturumun geç kısmi olayı düşer (barge-in koruması)', () => {
    const sid = openListenSession({ capability: 'STREAMING_WITH_VAD', commandFinalize: true });
    closeListenSession(sid, 'CANCELLED');
    T = 1500; expect(notePartial(sid, { text: 'eve gotur', silenceMs: 950, speechMs: 900 })).toBeNull();
    expect(finalizeCalls).toBe(0);
    expect(activeListenSessionId()).toBeNull();
  });

  it('19. sağlayıcı finali oturumu kapatır ve KISMİ METNİ BELLEKTEN SİLER', () => {
    const sid = openListenSession({ capability: 'STREAMING_WITH_VAD' });
    T = 500; notePartial(sid, { text: 'gizli bir cumle', silenceMs: 0, speechMs: 500 });
    expect(getSttPartialDiagnostics().openPartialChars).toBeGreaterThan(0);
    noteProviderFinal(sid);
    expect(activeListenSessionId()).toBeNull();
    expect(getSttPartialDiagnostics().openPartialChars).toBe(0);   // metin oturumla ÖLDÜ
    expect(decisions.at(-1)?.reason).toBe('FINAL_PROVIDER');
  });

  it('20. FINAL-ONLY / TEXT-ONLY sağlayıcıda semantik endpoint ÇALIŞMAZ (fallback korunur)', () => {
    const sid = openListenSession({ capability: 'STREAMING_TEXT_ONLY', commandFinalize: true });
    // Sağlayıcı sessizlik ölçmüyor → silenceMs geçilse bile YOK SAYILIR (sahte VAD yok).
    T = 900;  notePartial(sid, { text: 'muzigi ac', silenceMs: 5000, speechMs: 900 });
    T = 1500; notePartial(sid, { text: 'muzigi ac', silenceMs: 5000, speechMs: 900 });
    T = 2500; const d = notePartial(sid, { text: 'muzigi ac', silenceMs: 5000, speechMs: 900 });
    expect(d?.endpoint).toBe(false);
    expect(finalizeCalls).toBe(0);
  });

  it('21. GİZLİLİK + SINIRLAR: tanı yüzeyi METİN taşımaz, metin ve olay sayısı BOUNDED', () => {
    const sid = openListenSession({ capability: 'STREAMING_WITH_VAD' });
    const secret = 'x'.repeat(PARTIAL_TEXT_MAX_CHARS + 500);
    T = 100; notePartial(sid, { text: secret, silenceMs: 0, speechMs: 100 });
    const diag = getSttPartialDiagnostics();
    expect(diag.openPartialChars).toBe(PARTIAL_TEXT_MAX_CHARS);      // kırpıldı
    expect(JSON.stringify(diag)).not.toContain('xxx');               // metin GEÇMİYOR
    // Karar olayı da metin taşımaz — yalnız bounded enum/sayaç/süre.
    noteProviderFinal(sid);
    expect(JSON.stringify(decisions)).not.toContain('xxx');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — Kaynak kilitleri: eylem yetkisi sınırı + F2 korunması
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F3 · D · eylem yetkisi sınırı (kaynak kilitleri)', () => {
  const STREAM = read('src', 'platform', 'voice', 'sttPartialStream.ts');
  const ENDPOINTER = read('src', 'platform', 'voice', 'semanticEndpointer.ts');

  it('22. kısmi akış modülü HİÇBİR eylem yolunu import etmez/çağırmaz', () => {
    const code = codeOf(STREAM);
    for (const forbidden of [
      'processTextCommand', 'dispatchIntent', 'commandExecutor', 'companionChatProvider',
      'navigationService', 'mediaService', 'appLauncher', 'obdService', 'useStore',
      'speakMaviAnswer', 'beginMaviTurn',
    ]) {
      expect(code, `kısmi akış eylem yoluna dokunuyor: ${forbidden}`).not.toContain(forbidden);
    }
    // Tek izinli yan etki: enjekte edilen `finalize` portu (mikrofonu kapatır).
    expect(code).toContain('_ports.finalize');
  });

  it('23. endpointer SAF kalır (import · I/O · timer · global durum YOK)', () => {
    const code = codeOf(ENDPOINTER);
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/Date\.now|setTimeout|setInterval|localStorage|fetch\(/);
    expect(code).not.toMatch(/^\s*let\s/m);
  });

  it('24. kısmi akış modülü kendi TIMER\'ını kurmaz (sıfır sızıntı)', () => {
    const code = codeOf(STREAM);
    expect(code).not.toMatch(/setInterval\(|setTimeout\(/);
  });

  it('25. MAVI-F2 KORUNDU: kısmi/endpoint yolunda yapay ara söz YOK', () => {
    for (const src of [STREAM, ENDPOINTER]) {
      const code = codeOf(src);
      expect(code).not.toMatch(/Bakıyorum|Düşünüyorum|Bir saniye|Kontrol ediyorum/i);
      expect(code).not.toContain('speakMaviAnswer');
    }
  });

  it('26. native kısmi olay + finalize komutu GERÇEKTEN bağlı (native kilidi)', () => {
    const java = read('android', 'app', 'src', 'main', 'java', 'com', 'cockpitos', 'pro',
      'CarLauncherPlugin.java');
    // Vosk aktif dinleme döngüsü kısmi sonuç YAYINLIYOR.
    expect(java).toContain('notifyListeners("sttPartial"');
    expect(java).toContain('recognizer.getPartialResult()');
    // Android SpeechRecognizer yolunda kısmi sonuç İSTENİYOR ve gövde DOLU.
    expect(java).toContain('RecognizerIntent.EXTRA_PARTIAL_RESULTS');
    expect(java).not.toContain('onPartialResults(android.os.Bundle partialResults) {}');
    // Semantik endpoint komutu var ve konuşma görülmeden uygulanmıyor (fail-safe).
    expect(java).toContain('public void finalizeSpeechRecognition(PluginCall call)');
    expect(java).toContain('voskFinalizeRequested');
  });
});
