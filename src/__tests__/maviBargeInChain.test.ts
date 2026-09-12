/**
 * maviBargeInChain.test.ts — **MAVİ F12 · KABUL EDİLEN KESMENİN ZİNCİRİ.**
 *
 * `maviBargeInControl.test.ts` kesme KARARINI kilitler. Bu dosya kararın
 * ARDINDAN gelen zinciri kilitler — F12'nin asıl riski buradadır:
 *
 *   1. bekleyen konuşma parçaları DÜŞER (kuyruk temizlenir)
 *   2. uçuştaki ses KESİLİR
 *   3. sağlayıcı akışı ABORT edilir
 *   4. eski tur STALE olur (yeni komut beklenmeden)
 *   5. tek-`answer` slotu BIRAKILIR (sonraki tur susmaz)
 *   6. **sahte `COMPLETED` YAYINLANMAZ** — iptal bir tamamlanma DEĞİLDİR
 *   7. geç gelen token/parça eski cevabı DİRİLTEMEZ
 *
 * Ayrıca F0–F11 sınırları korunur: wake bağımsızlığı, iş yükünün capability
 * kapatmaması ve takip dinlemesiyle çakışmama.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Uçuştaki ses ve oturum defteri — gerçek `ttsService` yerine ölçülebilir taklit. */
const TTS = {
  spoken:      [] as string[],
  cancels:     0,
  sessionOpen: 0,
  endNotified: [] as boolean[],
  chunkEndCbs: new Set<() => void>(),
};

vi.mock('../platform/ttsService', () => ({
  ttsCancel: () => { TTS.cancels += 1; },
  beginTtsSpeechSession: () => { TTS.sessionOpen += 1; },
  endTtsSpeechSession: (notify = true) => { TTS.sessionOpen -= 1; TTS.endNotified.push(notify); },
  registerTtsChunkEndListener: (cb: () => void) => {
    TTS.chunkEndCbs.add(cb);
    return () => { TTS.chunkEndCbs.delete(cb); };
  },
  isTtsSpeaking: () => false,
  registerTtsEndListener: () => () => {},
  speakAssistant: (t: string) => { TTS.spoken.push(t); },
  speakFeedback: vi.fn(),
  speakAlert: vi.fn(),
  isProtectedSpeechInFlight: () => false,
  isMicCaptureOpenDuringSpeech: () => false,
}));

import {
  beginResponseStream, cancelActiveResponseStream, getResponseStreamDiagnostics,
  MAVI_F4_STREAM_FLAG, _resetResponseStreamForTest,
} from '../platform/voice/maviResponseStream';
import {
  getSpeechStreamDiagnostics, _resetSpeechStreamForTest,
} from '../platform/voice/maviSpeechStream';
import {
  beginMaviTurn, isMaviTurnActive, supersedeActiveMaviTurn, getMaviTurnDiagnostics,
  continueIfTurnCurrent, _resetMaviTurnsForTest,
} from '../platform/assistant/maviTurn';
import {
  getMaviSpeechDiagnostics, speakMaviAnswer, _resetMaviSpeechForTest,
} from '../platform/assistant/maviSpeech';
import {
  evaluateBargeIn, _resetMaviBargeInForTest,
} from '../platform/assistant/maviBargeIn';

/** Sağlayıcının `say` akışı — ham token; yapısal ayrım F4'ün işidir. */
const say = (s: string): string => s;

let upstreamAborts = 0;
let closedCalls = 0;

beforeEach(() => {
  TTS.spoken = []; TTS.cancels = 0; TTS.sessionOpen = 0;
  TTS.endNotified = []; TTS.chunkEndCbs.clear();
  upstreamAborts = 0; closedCalls = 0;
  _resetResponseStreamForTest();
  _resetSpeechStreamForTest();
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  _resetMaviBargeInForTest();
  localStorage.setItem(MAVI_F4_STREAM_FLAG, 'true');   // F4 şalteri AÇIK
});
afterEach(() => { localStorage.removeItem(MAVI_F4_STREAM_FLAG); });

/** Motor "parça bitti" der (gerçek `registerTtsChunkEndListener` sinyalinin taklidi). */
function finishChunk(): void {
  for (const cb of Array.from(TTS.chunkEndCbs)) cb();
}

function openStream(turn = beginMaviTurn()) {
  const handle = beginResponseStream({
    turn, provider: 'gemini', isDriving: false,
    cancelUpstream: () => { upstreamAborts += 1; },
    ttsTier: 'edge',
    onClosed: () => { closedCalls += 1; },
  });
  return { handle, turn };
}

/* ══════════════════════════════════════════════════════════════════════════
 * A — STREAMING SIRASINDA BARGE-IN
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · streaming cevabın ortasında kesme', () => {
  it('1. Akış açılır ve ilk parça konuşulur (ön koşul)', () => {
    const { handle } = openStream();
    expect(handle).not.toBeNull();
    handle!.onToken(say('{"type":"chat","say":"Birinci cümle. İkinci cümle. '));
    expect(TTS.spoken.length).toBeGreaterThan(0);
    expect(getResponseStreamDiagnostics().active).toBe(true);
  });

  it('2. 🔒 KESME: kuyruk temizlenir · TTS kesilir · sağlayıcı ABORT edilir', () => {
    const { handle } = openStream();
    /* İlk parça KONUŞULMAYA başlar (motor onDone'u henüz gelmedi); ikinci
       parça bu yüzden KUYRUKTA bekler — barge-in tam bu anda gelir. */
    handle!.onToken(say('{"type":"chat","say":"Motor sıcaklığı normal seviyede. '
      + 'Yakıt seviyesi yarım depo civarında görünüyor. '));
    handle!.onToken(say('Lastik basıncı da uygun. Bakım zamanı için üç bin kilometre kaldı. '));
    const queuedBefore = getSpeechStreamDiagnostics().queued;
    expect(getSpeechStreamDiagnostics().speaking).toBe(true);
    expect(queuedBefore).toBeGreaterThan(0);          // sırada bekleyen parça VAR

    cancelActiveResponseStream();                      // barge-in iptal zinciri

    expect(TTS.cancels).toBeGreaterThan(0);            // ses kesildi
    expect(upstreamAborts).toBe(1);                    // sağlayıcı akışı durduruldu
    expect(getSpeechStreamDiagnostics().queued).toBe(0); // kuyruk TEMİZ
    expect(getResponseStreamDiagnostics().active).toBe(false);
  });

  it('3. 🔒 SAHTE TAMAMLANMA YOK: iptalde bitiş bildirimi YAPILMAZ', () => {
    const { handle } = openStream();
    handle!.onToken(say('{"type":"chat","say":"Bir. İki. '));
    cancelActiveResponseStream();
    /* `endTtsSpeechSession(false)` → takip dinlemesi/idle tetiklenmez;
       iptal bir "cevap bitti" DEĞİLDİR. */
    expect(TTS.endNotified).toContain(false);
    expect(TTS.endNotified).not.toContain(true);
    expect(TTS.sessionOpen).toBe(0);                   // oturum askıda kalmaz
    expect(closedCalls).toBe(1);                       // bekçi tam BİR kez söküldü
  });

  it('4. 🔒 GEÇ GELEN TOKEN eski cevabı DİRİLTEMEZ', () => {
    const { handle } = openStream();
    handle!.onToken(say('{"type":"chat","say":"Bir. '));
    const spokenAtCancel = TTS.spoken.length;
    cancelActiveResponseStream();

    handle!.onToken(say('İki. Üç. '));                 // sağlayıcı hâlâ token atıyor
    handle!.complete();                                // ve "bitti" diyor
    expect(TTS.spoken.length).toBe(spokenAtCancel);    // TEK bir kelime bile eklenmedi
    expect(TTS.endNotified).not.toContain(true);       // "tamamlandı" YAYINLANMADI
  });

  it('5. 🔒 GEÇ GELEN PARÇA BİTİŞİ sıradakini BAŞLATAMAZ', () => {
    const { handle } = openStream();
    handle!.onToken(say('{"type":"chat","say":"Motor sıcaklığı normal seviyede. '
      + 'Yakıt seviyesi yarım depo civarında görünüyor. '));
    handle!.onToken(say('Lastik basıncı da uygun. Bakım zamanı için üç bin kilometre kaldı. '));
    cancelActiveResponseStream();
    const before = TTS.spoken.length;
    finishChunk();                                     // motor geç onDone atıyor
    expect(TTS.spoken.length).toBe(before);
  });

  it('6. 🔒 `answer` SLOTU BIRAKILIR — kesmeden sonraki tur SUSMAZ', () => {
    const { handle } = openStream();
    handle!.onToken(say('{"type":"chat","say":"Bir. '));
    cancelActiveResponseStream();

    const nextTurn = beginMaviTurn();
    expect(speakMaviAnswer('Yeni turun cevabı.', { turn: nextTurn })).toBe(true);
    expect(getMaviSpeechDiagnostics().answeredThisTurn).toBe(true);
  });

  it('7. İKİ akış aynı anda konuşamaz — yeni akış eskisini iptal eder', () => {
    const a = openStream();
    a.handle!.onToken(say('{"type":"chat","say":"Eski. '));
    const b = openStream(beginMaviTurn());
    expect(b.handle).not.toBeNull();
    expect(upstreamAborts).toBe(1);                    // eski sağlayıcı durduruldu
    expect(getResponseStreamDiagnostics().active).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — TUR YETKİSİ (F12'nin kapattığı gerçek açık)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · kesme eski turun YETKİSİNİ düşürür', () => {
  it('8. 🔒 SUPERSEDE: kesilen turun geç sağlayıcı sonucu artık konuşamaz', () => {
    const turn = beginMaviTurn();
    expect(isMaviTurnActive(turn)).toBe(true);
    /* Kabul edilen kesme → `voiceService.interruptAndListen` bunu çağırır. */
    supersedeActiveMaviTurn();
    expect(isMaviTurnActive(turn)).toBe(false);
    /* M6'nın sonuç-temelli ACK kapısı da kapanır: `continueIfTurnCurrent`
       TAMAMLANMIŞ turu geçirir ama DEVRALINMIŞ turu GEÇİRMEZ. */
    expect(continueIfTurnCurrent(turn, 'provider_result')).toBe(false);
    expect(getMaviTurnDiagnostics().staleProviderResultsDropped).toBe(1);
    expect(getMaviTurnDiagnostics().turnsSuperseded).toBe(1);
  });

  it('9. Supersede İDEMPOTENT — iki kez kesme sayacı şişirmez', () => {
    beginMaviTurn();
    supersedeActiveMaviTurn();
    supersedeActiveMaviTurn();
    expect(getMaviTurnDiagnostics().turnsSuperseded).toBe(1);
  });

  it('10. 🔒 Kesilen turun akışı YENİ tur açılınca da konuşamaz', () => {
    const { handle, turn } = openStream();
    handle!.onToken(say('{"type":"chat","say":"Eski cevap. '));
    const before = TTS.spoken.length;
    supersedeActiveMaviTurn();                         // barge-in
    beginMaviTurn();                                   // kullanıcı yeni komut verdi
    handle!.onToken(say('Eski cevabın devamı. '));
    expect(TTS.spoken.length).toBe(before);
    expect(isMaviTurnActive(turn)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — NON-STREAMING YOLDA KESME (F4 şalteri KAPALI)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · akış KAPALIYKEN kesme (bugünkü ana yol)', () => {
  beforeEach(() => { localStorage.removeItem(MAVI_F4_STREAM_FLAG); });

  it('11. Akış açılmaz — barge-in yine de tam bir hüküm üretir', () => {
    const h = beginResponseStream({ turn: beginMaviTurn(), provider: 'gemini' });
    expect(h).toBeNull();
    const v = evaluateBargeIn(
      { evidence: 'EXPLICIT_USER', atMs: 100 },
      { ttsSpeaking: true, protectedSpeech: false, captureOpenOnThisPath: false });
    expect(v.accepted).toBe(true);
  });

  it('12. Aktif akış yokken iptal SESSİZ ve güvenlidir (throw etmez)', () => {
    expect(() => cancelActiveResponseStream()).not.toThrow();
    expect(upstreamAborts).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — F0–F11 SINIRLARI KORUNUR
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F12 · önceki fazların sınırları bozulmadı', () => {
  it('13. 🔒 F8: İŞ YÜKÜ barge-in yeteneğini KAPATAMAZ', () => {
    /* Hakem `maviWorkload`u okumaz; hangi iş yükü olursa olsun açık kullanıcı
       eylemi kabul edilir. Workload iletişim BÜTÇESİ koyar, otorite kurmaz. */
    const v = evaluateBargeIn(
      { evidence: 'EXPLICIT_USER', atMs: 1 },
      { ttsSpeaking: true, protectedSpeech: false, captureOpenOnThisPath: true });
    expect(v.accepted).toBe(true);
  });

  it('14. 🔒 F11: wake bağımsızlığı — hakem `companionEnabled` OKUMAZ', () => {
    const src = String(evaluateBargeIn);
    expect(src).not.toMatch(/companionEnabled|wakeWordEnabled/);
  });

  it('15. 🔒 F4: iptalden sonra oturum sayacı SIFIRLANIR (sonraki cevap yutulmaz)', () => {
    const { handle } = openStream();
    handle!.onToken(say('{"type":"chat","say":"Bir. '));
    cancelActiveResponseStream();
    expect(TTS.sessionOpen).toBe(0);

    const next = openStream(beginMaviTurn());
    expect(next.handle).not.toBeNull();
    expect(TTS.sessionOpen).toBe(1);                   // taze oturum, kalıntı YOK
  });
});
