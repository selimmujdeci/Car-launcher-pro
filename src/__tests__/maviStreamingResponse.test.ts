/**
 * maviStreamingResponse.test.ts — **MAVI-F4 · STREAMING LLM + CHUNKED TTS KİLİDİ.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Mavi cevabın TAMAMI üretilmeden konuşamıyordu: `final transcript → tam LLM
 * cevabı → tam TTS sentezi → çalma`. Altyapı (SSE + `onToken`) vardı ama canlı
 * hatta HİÇ kullanılmıyordu.
 *
 * F4 bunu değiştirir — ama streaming'in en tehlikeli tarafı hız değil
 * **YETKİ ve YARIM CÜMLE**dir. Aşağıdaki kilitler onu korur.
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  1. **Ham token KONUŞULMAZ** — önce yapısal ayrım, sonra güvenli parçalama.
 *  2. **Yapısal çıktı (`action`/`web`) HİÇ seslendirilmez** — LLM akışı otorite değildir.
 *  3. Kelime ortasından/yarım yapıdan parça ÜRETİLMEZ.
 *  4. Parça SIRASI korunur, ardışık DUPLICATE konuşulmaz.
 *  5. İptal zinciri: kuyruk → TTS → sağlayıcı akışı; eski akış SONRADAN konuşmaz.
 *  6. Eskimiş akış kimliği yeni akışı ETKİLEYEMEZ.
 *  7. **Akış TEK `answer`dır** → nihai metin ayrıca konuşulmaz (DUPLICATE YOK).
 *  8. Akış hiç konuşmadıysa `answer` slotu BIRAKILIR (sessiz ölüm koruması).
 *  9. Sağlayıcı yarıda ölürse yarım cevap "tamamlandı" SAYILMAZ.
 * 10. F2 filler=0 · F3 yetki sınırı · tek konuşma oturumu korunur.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSayExtractor, SAY_MAX_CHARS } from '../platform/voice/streamSayExtractor';
import {
  createSpeechChunker, DEFAULT_CHUNK_POLICY,
} from '../platform/voice/speechChunker';
import {
  openSpeechStream, pushSpeechChunk, finishSpeechStream, cancelSpeechStream,
  configureSpeechStreamPorts, activeSpeechStreamId, getSpeechStreamDiagnostics,
  tickSpeechStream, _resetSpeechStreamForTest,
  type StreamEndReason,
} from '../platform/voice/maviSpeechStream';
import {
  llmStreamCapability, ttsStreamCapability, supportsTokenStream, supportsChunkedSpeech,
} from '../platform/voice/streamCapability';

const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8');
const codeOf = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* ══════════════════════════════════════════════════════════════════════════
 * A — Yapısal çıktı ile konuşulacak metnin ayrımı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F4 · A · streamSayExtractor (yapısal ayrım)', () => {
  /** Metni token'lara böler (gerçek SSE'nin keyfi sınırlarını taklit eder). */
  const tokens = (s: string, size = 7): string[] =>
    s.match(new RegExp(`.{1,${size}}`, 'gs')) ?? [];

  it('1. `chat` akışında YALNIZ `say` içeriği yayınlanır — JSON iskeleti ASLA', () => {
    const ex = createSayExtractor();
    const json = '{"type":"chat","say":"Yaklaşık 83 kilometre kaldı."}';
    let out = '';
    for (const t of tokens(json)) out += ex.push(t);
    out += ex.finish();
    expect(out).toBe('Yaklaşık 83 kilometre kaldı.');
    expect(out).not.toContain('type');
    expect(out).not.toContain('say');
    expect(out).not.toContain('{');
  });

  it('2. **ACTION akışından HİÇBİR ŞEY konuşulmaz** (LLM akışı otorite değildir)', () => {
    const ex = createSayExtractor();
    const json = '{"type":"action","intent":"OPEN_NAVIGATION","destination":"Kadıköy",'
      + '"feedback":"Kadıköy rotası açılıyor","confidence":0.95}';
    let out = '';
    for (const t of tokens(json)) out += ex.push(t);
    out += ex.finish();
    expect(out).toBe('');
    expect(ex.state()).toBe('STRUCTURED');
  });

  it('3. `web` akışı da konuşulmaz (grounding sorgusu seslendirilmez)', () => {
    const ex = createSayExtractor();
    let out = '';
    for (const t of tokens('{"type":"web","query":"güncel dolar TL kuru"}')) out += ex.push(t);
    expect(out + ex.finish()).toBe('');
    expect(ex.state()).toBe('STRUCTURED');
  });

  it('4. `type` GÖRÜLMEDEN hiçbir şey yayınlanmaz (fail-closed)', () => {
    const ex = createSayExtractor();
    expect(ex.push('{"say":"erken konuşma denemesi",')).toBe('');
    expect(ex.state()).toBe('UNKNOWN');
    // `type` gelince geriye dönük olarak çözülür.
    expect(ex.push('"type":"chat"}').length).toBeGreaterThan(0);
  });

  it('5. YARIM KAÇIŞ dizisi yayınlanmaz (kelime/karakter ortasında kesme yok)', () => {
    const ex = createSayExtractor();
    ex.push('{"type":"chat","say":"Merhaba');
    // Ters eğik çizgi henüz tamamlanmadı → o karakter DIŞARIDA bırakılır.
    expect(ex.push('\\')).toBe('');
    expect(ex.push('n2. satır')).toBe('\n2. satır');
    // Yarım \u kaçışı da bekletilir.
    expect(ex.push('\\u00')).toBe('');
    expect(ex.push('e7')).toBe('ç');
  });

  it('6. `say` kapanınca DONE olur; JSON kuyruğu konuşulmaz', () => {
    const ex = createSayExtractor();
    let out = '';
    for (const t of tokens('{"type":"chat","say":"Kısa cevap.","extra":"gizli"}')) out += ex.push(t);
    expect(out).toBe('Kısa cevap.');
    expect(ex.state()).toBe('DONE');
    expect(out).not.toContain('gizli');
  });

  it('7. BOUNDED: aşırı uzun `say` tavanda kırpılır (bellek büyümez)', () => {
    const ex = createSayExtractor();
    ex.push('{"type":"chat","say":"');
    let out = '';
    for (let i = 0; i < 60; i++) out += ex.push('x'.repeat(100));
    expect(out.length).toBeLessThanOrEqual(SAY_MAX_CHARS);
    expect(ex.stats().truncated).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — Speech Chunker
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F4 · B · speechChunker (güvenli parçalar)', () => {
  it('8. cümle sınırında böler; sınır yokken BEKLETİR (yarım cümle konuşulmaz)', () => {
    const c = createSpeechChunker();
    expect(c.push('Yaklaşık 83 kilometre kaldı')).toEqual([]);     // sınır yok → bekle
    expect(c.push('. Yaklaşık bir saat sürer')).toEqual(['Yaklaşık 83 kilometre kaldı.']);
    expect(c.flush()).toEqual(['Yaklaşık bir saat sürer']);
  });

  it('9. KELİME ORTASINDAN ASLA bölmez (zorunlu boşaltmada bile)', () => {
    const c = createSpeechChunker({ ...DEFAULT_CHUNK_POLICY, maxChars: 40, allowClauseBreak: false });
    const long = 'buçokuzunbirkelimedir ve devamında başka kelimeler geliyor burada';
    const out = c.push(long);
    for (const chunk of out) {
      // Parça bir sözcük ortasında bitmemeli → kalan tamponun ilk karakteri boşluk sonrası.
      expect(long.startsWith(chunk)).toBe(true);
      expect(long[chunk.length] === undefined || /\s/.test(long[chunk.length])).toBe(true);
    }
  });

  it('10. YARIM YAPI (dengesiz tırnak/parantez) konuşulmaz', () => {
    const c = createSpeechChunker();
    expect(c.push('Şöyle dedi: "bu cümle henüz kapanmadı. ')).toEqual([]);
    const out = c.push('ve şimdi kapandı." Devam ediyor. ');
    expect(out.length).toBeGreaterThan(0);
    for (const chunk of out) {
      expect((chunk.match(/"/g) ?? []).length % 2).toBe(0);
    }
  });

  it('11. İLK PARÇA ANLAM TAŞIR — içeriksiz giriş tek başına konuşulmaz', () => {
    const c = createSpeechChunker();
    // "Tabii," tek başına parça OLMAZ; gerçek içerikle BİRLEŞİR.
    expect(c.push('Tabii, ')).toEqual([]);
    const out = c.push('yaklaşık 83 kilometre kaldı. ');
    expect(out.length).toBe(1);
    expect(out[0]).toContain('83 kilometre');
    // Metin SİLİNMEZ — yalnız bölünme noktası ötelenir.
    expect(out[0].startsWith('Tabii')).toBe(true);
  });

  it('12. flush() kuyruğu YUTMAZ (cevabın son cümlesi kaybolmaz)', () => {
    const c = createSpeechChunker();
    c.push('Bir. ');
    expect(c.flush()).toEqual(['Bir.']);
    const c2 = createSpeechChunker();
    c2.push('kısa');                                  // asgari eşiğin altında
    expect(c2.flush()).toEqual(['kısa']);             // yine de KONUŞULUR
  });

  it('13. parça SIRASI giriş sırasıyla aynıdır', () => {
    const c = createSpeechChunker();
    const all = [
      ...c.push('Birinci cümle burada. İkinci cümle burada. '),
      ...c.push('Üçüncü cümle burada. '),
      ...c.flush(),
    ];
    expect(all.join(' ')).toBe('Birinci cümle burada. İkinci cümle burada. Üçüncü cümle burada.');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — Chunk sıralayıcı: sıra · iptal · stale · açlık
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F4 · C · maviSpeechStream (sıralama ve iptal)', () => {
  let T = 0;
  let spoken: string[] = [];
  let pendingDone: (() => void) | null = null;
  let cancelSpeechCalls = 0;
  let upstreamCancels = 0;
  let ends: StreamEndReason[] = [];

  beforeEach(() => {
    _resetSpeechStreamForTest();
    T = 0; spoken = []; pendingDone = null;
    cancelSpeechCalls = 0; upstreamCancels = 0; ends = [];
    configureSpeechStreamPorts({
      now: () => T,
      speakChunk: (text, done) => { spoken.push(text); pendingDone = done; },
      cancelSpeech: () => { cancelSpeechCalls += 1; },
      onCancelUpstream: () => { upstreamCancels += 1; },
      onSessionEnd: (r) => { ends.push(r); },
    });
  });
  afterEach(() => { _resetSpeechStreamForTest(); });

  /** Uçuştaki parçayı bitirir (motor onDone taklidi). */
  const finishChunk = (): void => { const d = pendingDone; pendingDone = null; d?.(); };

  it('14. parçalar SIRAYLA konuşulur; önceki bitmeden sonraki BAŞLAMAZ', () => {
    const id = openSpeechStream();
    pushSpeechChunk(id, 'Birinci.');
    pushSpeechChunk(id, 'İkinci.');
    pushSpeechChunk(id, 'Üçüncü.');
    expect(spoken).toEqual(['Birinci.']);            // üst üste BİNMEZ
    finishChunk(); expect(spoken).toEqual(['Birinci.', 'İkinci.']);
    finishChunk(); expect(spoken).toEqual(['Birinci.', 'İkinci.', 'Üçüncü.']);
    finishSpeechStream(id);
    finishChunk();
    expect(ends).toEqual(['COMPLETED']);
  });

  it('15. ardışık DUPLICATE parça konuşulmaz', () => {
    const id = openSpeechStream();
    pushSpeechChunk(id, 'Aynı cümle.');
    expect(pushSpeechChunk(id, 'Aynı cümle.')).toBe(false);
    finishChunk();
    expect(spoken).toEqual(['Aynı cümle.']);
    expect(getSpeechStreamDiagnostics().duplicateDropped).toBe(1);
  });

  it('16. **İPTAL ZİNCİRİ**: kuyruk temizlenir → TTS kesilir → sağlayıcı durdurulur', () => {
    const id = openSpeechStream();
    pushSpeechChunk(id, 'Birinci.');
    pushSpeechChunk(id, 'İkinci.');
    cancelSpeechStream(id);
    expect(cancelSpeechCalls).toBe(1);
    expect(upstreamCancels).toBe(1);
    expect(ends).toEqual(['CANCELLED']);
    // İptalden SONRA gelen parça konuşulmaz — eski cevap yeniden başlayamaz.
    expect(pushSpeechChunk(id, 'Geç gelen.')).toBe(false);
    finishChunk();
    expect(spoken).toEqual(['Birinci.']);
  });

  it('17. ESKİMİŞ akış kimliği YENİ akışı etkilemez', () => {
    const oldId = openSpeechStream();
    const freshId = openSpeechStream();
    expect(freshId).not.toBe(oldId);
    expect(pushSpeechChunk(oldId, 'Eski turdan.')).toBe(false);
    finishSpeechStream(oldId);
    expect(spoken).toEqual([]);
    expect(getSpeechStreamDiagnostics().staleDropped).toBeGreaterThan(0);
    expect(activeSpeechStreamId()).toBe(freshId);
  });

  it('18. sağlayıcı yarıda ÖLÜRSE yarım cevap "tamamlandı" SAYILMAZ', () => {
    const id = openSpeechStream();
    pushSpeechChunk(id, 'Birinci cümle.');
    finishChunk();                                    // konuşuldu, kuyruk boş, akış bitmedi
    T = 100; tickSpeechStream(6000);
    expect(ends).toEqual([]);                         // henüz açlık yok → BEKLER
    T = 10_000; tickSpeechStream(6000);
    expect(ends).toEqual(['UPSTREAM_STALLED']);       // COMPLETED DEĞİL — dürüst
    expect(upstreamCancels).toBe(1);
  });

  it('18b. **ASILMIŞ SESLENDİRME**: motor bitiş bildirimini HİÇ göndermezse akış asılı KALMAZ', () => {
    /* Native TTS düşerse ya da audio focus kaybedilirse `done` hiç çağrılmaz.
       Bu kapı olmasaydı konuşma oturumu kapanmaz, tek-`answer` slotu bırakılmaz
       ve Mavi oturumun kalanında TÜMÜYLE susardı. */
    const id = openSpeechStream();
    pushSpeechChunk(id, 'Yaklaşık seksen üç kilometre kaldı.');
    finishSpeechStream(id);                           // sağlayıcı bitti — motor asılı
    expect(spoken).toEqual(['Yaklaşık seksen üç kilometre kaldı.']);

    T = 25_000; tickSpeechStream(6000, 30_000);
    expect(ends).toEqual([]);                         // uzun cümle KESİLMEZ

    T = 40_000; tickSpeechStream(6000, 30_000);
    expect(ends).toEqual(['SPEECH_STALLED']);         // COMPLETED DEĞİL — dürüst
    expect(cancelSpeechCalls).toBe(1);                // asılı ses kesildi
    expect(upstreamCancels).toBe(1);                  // zincir yukarı taşındı
  });

  it('18c. NORMAL konuşan parça açlık kapısıyla KESİLMEZ (yanlış pozitif yok)', () => {
    const id = openSpeechStream();
    pushSpeechChunk(id, 'Birinci cümle.');
    T = 60_000; tickSpeechStream(6000, 120_000);      // konuşma tavanı AŞILMADI
    expect(ends).toEqual([]);
    expect(cancelSpeechCalls).toBe(0);
    finishChunk();
    finishSpeechStream(id);
    expect(ends).toEqual(['COMPLETED']);
  });

  it('19. kuyruk boş ama akış bitmediyse oturum KAPANMAZ (gereksiz sessizlik ≠ bitiş)', () => {
    const id = openSpeechStream();
    pushSpeechChunk(id, 'Birinci.');
    finishChunk();
    expect(ends).toEqual([]);                         // sağlayıcı devam edebilir
    pushSpeechChunk(id, 'İkinci.');
    expect(spoken).toEqual(['Birinci.', 'İkinci.']);  // boşluk sonrası devam eder
  });

  it('20. hiç parça gelmeden biten akış EMPTY\'dir (COMPLETED değil)', () => {
    const id = openSpeechStream();
    finishSpeechStream(id);
    expect(ends).toEqual(['EMPTY']);
  });

  it('21. motor onDone\'u İKİ KEZ atsa bile sıra bozulmaz', () => {
    const id = openSpeechStream();
    pushSpeechChunk(id, 'Bir.');
    pushSpeechChunk(id, 'İki.');
    const d = pendingDone!;
    d(); d();                                          // çift bildirim
    expect(spoken).toEqual(['Bir.', 'İki.']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — Yetenek matrisi (sahte streaming yasağı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F4 · D · sağlayıcı yetenek matrisi', () => {
  it('22. LLM: yalnız GERÇEK akış yolları TOKEN_STREAM\'dir', () => {
    expect(llmStreamCapability('openrouter')).toBe('TOKEN_STREAM');
    expect(llmStreamCapability('gemini')).toBe('TOKEN_STREAM');
    expect(llmStreamCapability('gateway')).toBe('TOKEN_STREAM');
    for (const p of ['groq', 'haiku', 'gemini_direct', 'offline', '']) {
      expect(llmStreamCapability(p), p).toBe('FINAL_ONLY');
      expect(supportsTokenStream(p), p).toBe(false);
    }
  });

  it('23. TTS: HİÇBİR katman TRUE_STREAMING DEĞİLDİR (dürüst tespit)', () => {
    for (const tier of ['clip', 'edge', 'online', 'native', 'web']) {
      expect(ttsStreamCapability(tier), tier).not.toBe('TRUE_STREAMING');
    }
    expect(ttsStreamCapability('edge')).toBe('CHUNKED_SYNTHESIS');
    expect(ttsStreamCapability('clip')).toBe('FULL_SENTENCE_ONLY');
    expect(supportsChunkedSpeech('edge')).toBe(true);
    expect(supportsChunkedSpeech('clip')).toBe(false);
    expect(supportsChunkedSpeech('bilinmeyen')).toBe(false);   // fail-closed
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — Kaynak kilitleri: yetki sınırı · F2/F3 korunması · saflık
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F4 · E · kaynak kilitleri', () => {
  const EXTRACTOR = read('src', 'platform', 'voice', 'streamSayExtractor.ts');
  const CHUNKER   = read('src', 'platform', 'voice', 'speechChunker.ts');
  const STREAM    = read('src', 'platform', 'voice', 'maviSpeechStream.ts');
  const COORD     = read('src', 'platform', 'voice', 'maviResponseStream.ts');
  const CAP       = read('src', 'platform', 'voice', 'streamCapability.ts');

  it('24. saf katmanlar SAF kalır (import · I/O · timer · MODÜL durumu YOK)', () => {
    for (const [name, src] of [['extractor', EXTRACTOR], ['chunker', CHUNKER], ['capability', CAP]] as const) {
      const code = codeOf(src);
      expect(code, name).not.toMatch(/\bimport\b/);
      expect(code, name).not.toMatch(/Date\.now|setTimeout|setInterval|localStorage|fetch\(/);
      /* MODÜL DÜZEYİ (sütun 0) mutable durum yasak. Fabrika kapanışındaki
         GİRİNTİLİ `let` serbesttir ve bilinçlidir: durum modülde tutulsaydı iki
         eşzamanlı akış birbirinin metnini kirletirdi. */
      expect(code, name).not.toMatch(/^let\s/m);
    }
  });

  it('25. **AKIŞ KATMANI EYLEM ÜRETMEZ** (LLM akışı otorite değildir)', () => {
    for (const [name, src] of [['sequencer', STREAM], ['coordinator', COORD]] as const) {
      const code = codeOf(src);
      for (const forbidden of [
        'processTextCommand', 'dispatchIntent', 'commandExecutor', 'navigationService',
        'mediaService', 'appLauncher', 'obdService', 'useStore', 'fromSemanticResult',
      ]) {
        expect(code, `${name} eylem yoluna dokunuyor: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('26. sıralayıcı kendi TIMER\'ını kurmaz (sıfır sızıntı)', () => {
    expect(codeOf(STREAM)).not.toMatch(/setInterval\(|setTimeout\(/);
    expect(codeOf(COORD)).not.toMatch(/setInterval\(|setTimeout\(/);
  });

  it('27. F2 KORUNDU: akış yolunda yapay ara söz YOK', () => {
    for (const src of [EXTRACTOR, CHUNKER, STREAM, COORD]) {
      expect(codeOf(src)).not.toMatch(/Bakıyorum|Düşünüyorum|Bir saniye|Kontrol ediyorum/i);
    }
  });

  it('28. **AKIŞ TEK `answer`DIR**: slot bir kez talep edilir, konuşulmazsa BIRAKILIR', () => {
    const code = codeOf(COORD);
    expect(code).toContain('claimMaviAnswerStream');
    expect(code).toContain('releaseMaviAnswerSlot');   // sessiz ölüm koruması
    // Sürüşte akış AÇILMAZ (ISO 15008).
    expect(code).toMatch(/isDriving\s*===\s*true\)\s*return null/);
  });

  it('29. tek konuşma oturumu: parça bitişi ile CEVAP bitişi AYRI kanaldır', () => {
    const tts = codeOf(read('src', 'platform', 'ttsService.ts'));
    expect(tts).toContain('registerTtsChunkEndListener');
    expect(tts).toContain('_speechSessionDepth');
    // Barge-in oturumu KOŞULSUZ kapatır (sonraki cevabın bitişi yutulmasın).
    const cancelIdx = tts.indexOf('export function ttsCancel');
    expect(tts.slice(cancelIdx, cancelIdx + 400)).toContain('_speechSessionDepth = 0');
  });

  it('30. Gemini sağlayıcısı GERÇEK SSE akışı yapar ve akış içinde YENİDEN DENEMEZ', () => {
    const gem = read('src', 'platform', 'ai', 'gateway', 'providers', 'geminiProvider.ts');
    expect(gem).toContain('streamGenerateContent?alt=sse');
    expect(gem).toContain('streamed: true');
    // Çift token yasağı: akış koptuğunda tekrar denenmez, hata yukarı taşınır.
    expect(codeOf(gem)).toContain('if (!state.text) return null;');
  });
});
