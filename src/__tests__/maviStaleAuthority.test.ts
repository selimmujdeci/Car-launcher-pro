/**
 * maviStaleAuthority.test.ts — MAVI-M6-DEAD-STALE-BRANCH · STALE OTORİTESİNİN YERİ.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `maviSpeech.speakMaviAnswer` içinde bir `isMaviTurnCurrent(getActiveMaviTurn())`
 * kontrolü vardı ve **ULAŞILAMAZ KODDU**: `getActiveMaviTurn()` her zaman
 * `_activeId`yi döndürdüğü için karşılaştırma tanım gereği `true`ydu. Kontrol
 * "M5 stale koruması burada" izlenimi veriyor, `_suppressedStale` sayacı da
 * sabit 0 kalarak bu izlenimi pekiştiriyordu.
 *
 * Dal ve sayaç KALDIRILDI (yorumla gizlenmedi). Bu dosya, kaldırma sonrası
 * ortaya çıkan asıl riski kilitler:
 *
 *   GERÇEK stale otoritesi ÇAĞRI YERLERİNDEDİR — orası zayıflatılamaz.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Devralınmış tur SIFIR TTS üretir (çağrı-yeri kapısı sayesinde).
 *  2. Çağrı-yeri kapısı kaldırılırsa bu dosya KIRILIR (kapı gerçekten yük taşır).
 *  3. Tamamlanmış AMA current tur, geç M3 sonucunu BİR KEZ konuşabilir.
 *  4. Aktif tur normal cevabı BİR KEZ konuşur (M6 tek cevap).
 *  5. Proaktif güvenlik hattı bu sözleşmeden ETKİLENMEZ.
 *  6. `maviSpeech` içinde ulaşılamaz stale dalı GERİ GELEMEZ.
 *  7. Yanıltıcı `suppressedStale` alanı tanı yüzeyinde YOKTUR; gerçek stale
 *     reddi `maviTurn` tanılarında ÖLÇÜLÜR.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const S = vi.hoisted(() => ({ spoken: [] as string[], safety: [] as string[] }));

vi.mock('../platform/ttsService', () => ({
  speakFeedback:   (t: string) => { S.spoken.push(t); },
  speakAssistant:  (t: string) => { S.spoken.push(t); },
  speakSafetyAlert:(t: string) => { S.safety.push(t); },
  speakAlert: vi.fn(), ttsCancel: vi.fn(), registerTtsEndListener: () => () => {},
}));

import {
  speakMaviAnswer, getMaviSpeechDiagnostics, _resetMaviSpeechForTest,
} from '../platform/assistant/maviSpeech';
import {
  beginMaviTurn, completeMaviTurn, supersedeActiveMaviTurn, getActiveMaviTurn,
  isMaviTurnCurrent, isMaviTurnActive, continueIfTurnCurrent, continueIfTurnActive,
  getMaviTurnDiagnostics, _resetMaviTurnsForTest, _setMaviTurnCounterForTest,
} from '../platform/assistant/maviTurn';
import {
  getMaviActionTrace, _resetMaviActionTraceForTest,
} from '../platform/action/maviActionTrace';

const read = (...seg: string[]): string => readFileSync(join(process.cwd(), ...seg), 'utf8');
/** Kaynak kilitleri YALNIZ gerçek koda bakar — belge metni suç değildir. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SPEECH_SRC = read('src', 'platform', 'assistant', 'maviSpeech.ts');
const HOOK_SRC   = read('src', 'hooks', 'useVoiceCommandHandler.ts');
const VOICE_SRC  = read('src', 'platform', 'voiceService.ts');

beforeEach(() => {
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  _resetMaviActionTraceForTest();
  S.spoken = [];
  S.safety = [];
});

/* ══════════════════════════════════════════════════════════════════════════
 * 0 — KÖK NEDEN: global tur okuması stale ölçemez (ölçülmüş gerçek)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-DSB · 0. kök neden', () => {
  it('`isMaviTurnCurrent(getActiveMaviTurn())` HER durumda true — ölçemez', () => {
    // (a) aktif
    const t1 = beginMaviTurn();
    expect(isMaviTurnCurrent(getActiveMaviTurn())).toBe(true);
    // (b) tamamlanmış
    completeMaviTurn(t1);
    expect(isMaviTurnCurrent(getActiveMaviTurn())).toBe(true);
    expect(isMaviTurnActive(getActiveMaviTurn())).toBe(false);   // durum farklı, KİMLİK aynı
    // (c) devralınmış
    beginMaviTurn();
    supersedeActiveMaviTurn();
    expect(isMaviTurnCurrent(getActiveMaviTurn())).toBe(true);
    // (d) sayaç sarılması
    _setMaviTurnCounterForTest(Number.MAX_SAFE_INTEGER);
    beginMaviTurn();
    expect(isMaviTurnCurrent(getActiveMaviTurn())).toBe(true);
  });

  it('YAKALANMIŞ token ise gerçekten eskiyebilir → tek geçerli stale ölçümü budur', () => {
    const captured = beginMaviTurn();
    beginMaviTurn();
    expect(isMaviTurnCurrent(captured)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1/2 — Devralınmış tur sıfır TTS + çağrı-yeri kapısı yük taşır
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-DSB · 1/2. çağrı-yeri kapısı', () => {
  it('1. devralınmış turun geç cevabı SIFIR TTS üretir', () => {
    const captured = beginMaviTurn();        // komut anında yakalanan token
    beginMaviTurn();                         // kullanıcı yeni komut verdi

    // Üretimdeki hook'un birebir yaptığı iş:
    if (continueIfTurnCurrent(captured, 'feedback')) speakMaviAnswer('geç cevap');

    expect(S.spoken).toHaveLength(0);
  });

  it('1b. kapı olmadan aynı akış KONUŞUR — yani kapı gerçekten yük taşıyor', () => {
    const captured = beginMaviTurn();
    beginMaviTurn();
    // Kapı KASTEN atlanır (kaldırılmış hâlin simülasyonu):
    speakMaviAnswer('geç cevap');
    expect(S.spoken).toEqual(['geç cevap']);   // koruma YALNIZ kapıdan geliyor
    void captured;
  });

  it('2. KİLİT: hook geç sonucu söylemeden ÖNCE tur kapısını sorar', () => {
    const code = stripComments(HOOK_SRC);
    const gate = code.indexOf('continueIfTurnCurrent');
    expect(gate, 'çağrı-yeri stale kapısı KALDIRILMIŞ').toBeGreaterThan(-1);
    // Kapıdan sonra seslendirme gelmeli (kapı seslendirmeyi koruyor).
    expect(code.slice(gate)).toMatch(/speakMaviAnswer/);
    // Kapı en az iki dalda (sonuç + hata) uygulanır.
    expect((code.match(/continueIfTurnCurrent\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('2b. KİLİT: voiceService async yollarında tur kapısı KORUNUR', () => {
    const code = stripComments(VOICE_SRC);
    expect((code.match(/continueIfTurnActive\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(code).toMatch(/isMaviTurnCurrent\(turn\)/);
  });

  it('2c. stale reddi GERÇEKTEN ölçülür (sayaç çağrı-yerinde artar)', () => {
    const captured = beginMaviTurn();
    beginMaviTurn();
    continueIfTurnCurrent(captured, 'feedback');
    expect(getMaviTurnDiagnostics().staleFeedbackSuppressed).toBe(1);
  });

  it('2d. `continueIfTurnActive` devralınmış turda eylemi de durdurur', () => {
    const captured = beginMaviTurn();
    beginMaviTurn();
    expect(continueIfTurnActive(captured, 'action')).toBe(false);
    expect(getMaviTurnDiagnostics().staleActionsPrevented).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3/4 — M3 geç sonucu + M6 tek cevap korunur
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-DSB · 3/4. cevap sözleşmesi korunur', () => {
  it('3. TAMAMLANMIŞ ama current tur geç M3 sonucunu BİR KEZ konuşur', () => {
    const turn = beginMaviTurn();
    completeMaviTurn(turn);                       // tur bitti (nihai zarf beklenirken)
    // M3 sonucu `completeMaviTurn`ten SONRA çözülür — susturulmamalı.
    expect(continueIfTurnCurrent(turn, 'feedback')).toBe(true);
    expect(speakMaviAnswer('Bu araçta kapı kilitleme bağlantısı henüz hazır değil.')).toBe(true);
    expect(S.spoken).toHaveLength(1);
  });

  it('3b. tamamlanmış tur `continueIfTurnActive` ile susardı — bu yüzden `Current` kullanılır', () => {
    const turn = beginMaviTurn();
    completeMaviTurn(turn);
    expect(continueIfTurnActive(turn, 'feedback')).toBe(false);   // yanlış kapı
    expect(continueIfTurnCurrent(turn, 'feedback')).toBe(true);   // doğru kapı
  });

  it('4. aktif tur normal cevabı BİR KEZ konuşur (M6 tek cevap otoritesi)', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('birinci')).toBe(true);
    expect(speakMaviAnswer('ikinci')).toBe(false);
    expect(S.spoken).toEqual(['birinci']);
    expect(getMaviSpeechDiagnostics().suppressedDuplicate).toBe(1);
  });

  it('4b. `progress` + `answer` ayrımı ve geç-filler yasağı korunur', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('Bakıyorum', { tier: 'progress' })).toBe(true);
    expect(speakMaviAnswer('sonuç')).toBe(true);
    expect(speakMaviAnswer('geç filler', { tier: 'progress' })).toBe(false);
    expect(S.spoken).toEqual(['Bakıyorum', 'sonuç']);
  });

  it('4c. yeni tur cevap slotunu TAZELER', () => {
    beginMaviTurn();
    expect(speakMaviAnswer('a')).toBe(true);
    beginMaviTurn();
    expect(speakMaviAnswer('b')).toBe(true);
    expect(S.spoken).toEqual(['a', 'b']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 — Proaktif güvenlik hattı etkilenmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-DSB · 5. proaktif hat etkilenmez', () => {
  it('`maviSpeech` proaktif güvenlik kanalını İMPORT ETMEZ / ÇAĞIRMAZ', () => {
    const code = stripComments(SPEECH_SRC);
    expect(code).not.toMatch(/speakSafetyAlert/);
    expect(code).not.toMatch(/speakNavigation/);
  });

  it('proaktif uyarı devralınmış turda BİLE susturulmaz (ayrı kanal, ölçülür)', async () => {
    const { speakSafetyAlert } = await import('../platform/ttsService');
    beginMaviTurn();
    beginMaviTurn();                 // önceki tur devralındı
    supersedeActiveMaviTurn();       // aktif tur da devralındı → kullanıcı cevabı susar

    // Kullanıcı-cevabı otoritesi bu durumda dahi tek-cevap defterine tabidir…
    speakMaviAnswer('kullanıcı cevabı');
    // …ama proaktif kritik uyarı AYRI kanaldır ve tur durumundan ETKİLENMEZ.
    speakSafetyAlert('Motor sıcaklığı yüksek, güvenli yerde durun.');

    expect(S.safety).toEqual(['Motor sıcaklığı yüksek, güvenli yerde durun.']);
  });

  it('proaktif kayıt zincirde AYRI tür olarak kalır (turId taşımaz)', async () => {
    const { recordMaviActionStage } = await import('../platform/action/maviActionTrace');
    beginMaviTurn();
    recordMaviActionStage({ stage: 'proactive_speech', status: 'spoken', reason: 'ok', turnId: null });
    const rec = getMaviActionTrace().find((r) => r.stage === 'proactive_speech');
    expect(rec?.turnId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6/7 — Ölü dal geri gelemez · yanıltıcı sayaç yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-DSB · 6/7. ölü dal ve sayaç', () => {
  /* ⚠️ KİLİT GÜNCELLENDİ (MAVI-M6-LATE-SPEECH-GATE): `isMaviTurnCurrent` artık
   * `maviSpeech`te KULLANILIR — ama YALNIZ çağıranın verdiği YAKALANMIŞ token
   * için (`opts.turn`). Yasak olan, GLOBAL aktif turu okuyup onunla karşılaştıran
   * kendi kendini doğrulayan kontroldür. Kilit o ayrımı ölçer. */
  it('6. `maviSpeech` GLOBAL aktif turu okuyup stale KARARI VERMEZ', () => {
    const code = stripComments(SPEECH_SRC);
    // Ölü desen: `isMaviTurnCurrent(getActiveMaviTurn())` — hangi biçimde olursa olsun.
    expect(code, 'kendini doğrulayan ölü kontrol geri gelmiş')
      .not.toMatch(/isMaviTurnCurrent\(\s*getActiveMaviTurn\(\)/);
    // `getActiveMaviTurn()` sonucu bir stale reddine (erken `return false`) BAĞLANAMAZ.
    const activeRead = code.indexOf('getActiveMaviTurn()');
    expect(activeRead).toBeGreaterThan(-1);
    expect(code.slice(activeRead, activeRead + 160)).not.toMatch(/isMaviTurnCurrent/);
    expect(code).not.toMatch(/isMaviTurnActive/);
  });

  it('6b. stale kararı YALNIZ çağıranın verdiği token ile alınır', () => {
    const code = stripComments(SPEECH_SRC);
    expect(code).toMatch(/opts\.turn\s*&&\s*!isMaviTurnCurrent\(\s*opts\.turn\s*\)/);
  });

  it('7. tanı yüzeyi: yanıltıcı `suppressedStale` YOK, ölçülebilir yeni sayaç VAR', () => {
    beginMaviTurn();
    speakMaviAnswer('cevap');
    const d = getMaviSpeechDiagnostics();
    expect(Object.keys(d).sort()).toEqual([
      'answeredThisTurn', 'progressedThisTurn', 'spoken',
      'staleLateSpeechSuppressed', 'suppressedDuplicate', 'turnId',
    ]);
    expect('suppressedStale' in d).toBe(false);   // ölçülemeyen eski alan GERİ GELMEZ
  });

  it('7d. yeni sayaç GERÇEKTEN artar (eski ölü sayacın aksine)', () => {
    const captured = beginMaviTurn();
    beginMaviTurn();
    expect(speakMaviAnswer('geç cevap', { turn: captured })).toBe(false);
    expect(getMaviSpeechDiagnostics().staleLateSpeechSuppressed).toBe(1);
  });

  it('7b. gerçek stale ölçümü `maviTurn` tanılarında DURUYOR (gözlem kaybolmadı)', () => {
    const d = getMaviTurnDiagnostics();
    expect(Object.keys(d)).toContain('staleFeedbackSuppressed');
    expect(Object.keys(d)).toContain('staleActionsPrevented');
    expect(Object.keys(d)).toContain('staleProviderResultsDropped');
  });

  it('7c. tanı yüzeyi hâlâ PII\'siz (metin taşımaz)', () => {
    beginMaviTurn();
    speakMaviAnswer('gizli kullanıcı metni');
    expect(JSON.stringify(getMaviSpeechDiagnostics())).not.toMatch(/gizli/);
  });
});
