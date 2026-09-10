/**
 * maviLongAnswerFollowUpCutoff.test.ts — **UZUN CEVABI KESEN İKİNCİ WATCHDOG.**
 *
 * ── SAHA (9d94ed2b'den SONRA da sürdü) ──────────────────────────────────────
 * *"Türkiye'nin 7 bölgesini detaylıca anlat"* → birkaç bölge anlatılıyor, cevap
 * bitmeden konuşma ve tur kesiliyor. 9d94ed2b `ttsService`in kendi tavanlarını
 * (30 sn / 120 sn) düzeltti; kesilme DEVAM ETTİ çünkü kesen katman orası değildi.
 *
 * ── ÖLÇÜLEN İLK KESME OLAYI ─────────────────────────────────────────────────
 * `voiceConversationRuntime._scheduleFollowUpFallback` — pencere
 * `FOLLOWUP_FALLBACK_MS (20 sn) + MAX_SPEAKING_EXTENSIONS × SPEAKING_EXTEND_MS`
 * ile SABİT 140 sn'de doluyordu. O anda `P.speaking()` HÂLÂ `true` (motor
 * konuşuyor) olmasına rağmen uzatma bütçesi bittiği için akış
 * `P.startListening({followUpWindow:true})`e düşüyor → `voiceService.startListening()`
 * İLK İŞ olarak `ttsCancel()` çağırıyor → `CarLauncher.ttsStop()` → ses ORTADAN
 * kesiliyor. Kardeş yol `_scheduleConvIdleFallback` aynı sınıfta 135 sn'de
 * `P.goIdle()` ile turu kapatıyordu.
 *
 * ── KÖK SINIFI: MÜKERRER WATCHDOG OTORİTESİ ─────────────────────────────────
 * "Bu konuşma hâlâ meşru mu" sorusunun TEK sahibi `ttsService`tir (uzunlukla
 * orantılı bütçe, mutlak tavan `TTS_ABSOLUTE_CEILING_MS`). Bu modül SAHİBE
 * soruyor (`P.speaking()`) ama sahibin cevabını KENDİ daha erken tavanıyla
 * eziyordu (CLAUDE.md §6). 3200 karakterlik bir cevap sahibin bütçesinde
 * ~300 sn meşrudur; 140 sn'de kesilmesi belirtinin ta kendisidir.
 *
 * ── KİLİT SÖZLEŞMESİ ────────────────────────────────────────────────────────
 * Kilitleri ZAYIFLATMA/SİLME. Watchdog KALDIRILMADI: pencere hâlâ bounded'dır,
 * yalnız SAHİBİNDEN ÖNCE ateşleyemez.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  configureVoiceConversation, beginConversationSession, armFollowUp,
  armConvIdleOnTtsEnd, isFollowUpEngaged,
  _resetConversationRuntimeForTest, _pendingConversationTimersForTest,
} from '../platform/voice/voiceConversationRuntime';

const read = (...s: string[]): string => readFileSync(join(process.cwd(), 'src', ...s), 'utf8');
const num = (src: string, name: string): number =>
  Number(new RegExp(name + '\\s*=\\s*([\\d_]+)').exec(src)?.[1].replace(/_/g, ''));

const CONV = read('platform', 'voice', 'voiceConversationRuntime.ts');
const TTS = read('platform', 'ttsService.ts');

/* Kaynaktan okunan GERÇEK sayılar — testte sabit kopya tutulmaz. */
const FOLLOWUP_FALLBACK_MS = num(CONV, 'FOLLOWUP_FALLBACK_MS');
const CONV_IDLE_FALLBACK_MS = num(CONV, 'CONV_IDLE_FALLBACK_MS');
const SPEAKING_EXTEND_MS = num(CONV, 'SPEAKING_EXTEND_MS');
const MAX_SPEAKING_WINDOW_MS = num(CONV, 'MAX_SPEAKING_WINDOW_MS');
const TTS_CEILING = num(TTS, 'TTS_ABSOLUTE_CEILING_MS');
const TTS_MS_PER_CHAR = num(TTS, 'TTS_MS_PER_CHAR');
const TTS_BASE_MS = num(TTS, 'TTS_SAFETY_BASE_MS');

/** "7 bölgeyi detaylıca anlat" ölçeğinde gerçek bir cevap. */
const LONG_ANSWER_CHARS = 3200;
const ownerBudgetFor = (chars: number): number =>
  Math.min(TTS_CEILING, TTS_BASE_MS + chars * TTS_MS_PER_CHAR);

let startCalls: number;
let idleCalls: number;
let speaking: boolean;
let status: string;

function wire(): void {
  configureVoiceConversation({
    startListening: () => { startCalls++; },     // ← üretimde İLK İŞİ ttsCancel()
    currentStatus: () => status,
    setUiFollowUp: () => {},
    goIdleFromSuccess: () => { idleCalls++; status = 'idle'; },
    isTtsSpeaking: () => speaking,
    isVoicePaused: () => false,
    responseBudgetAllowsFollowUp: () => true,
    noteFollowUpSuppressed: () => {},
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  _resetConversationRuntimeForTest();
  startCalls = 0; idleCalls = 0; speaking = true; status = 'success';
  wire();
  beginConversationSession();
});
afterEach(() => { _resetConversationRuntimeForTest(); vi.useRealTimers(); });

describe('Uzun cevap · takip penceresi sahibinden önce kapanmaz', () => {
  it('çapa: 3200 karakterlik cevap SAHİBİN bütçesinde meşru', () => {
    expect(LONG_ANSWER_CHARS * TTS_MS_PER_CHAR).toBeGreaterThan(140_000);
    expect(ownerBudgetFor(LONG_ANSWER_CHARS)).toBe(TTS_CEILING);
  });

  it('SÖZLEŞME: takip penceresi sahibin mutlak tavanını AŞAR', () => {
    /* Bu kilit iki modülün SIRALAMASINI tutar: biri düşerse pencere yine
       sahibinden önce kapanır ve cevap kesilmeye geri döner. */
    expect(MAX_SPEAKING_WINDOW_MS, 'takip penceresi sahibin tavanından kısa')
      .toBeGreaterThan(TTS_CEILING);
    expect(FOLLOWUP_FALLBACK_MS + MAX_SPEAKING_WINDOW_MS).toBeGreaterThan(TTS_CEILING);
    expect(CONV_IDLE_FALLBACK_MS + MAX_SPEAKING_WINDOW_MS).toBeGreaterThan(TTS_CEILING);
  });

  it('KONUŞMA SÜRERKEN mikrofon açılmaz — cevap kesilmez (takip kurulu)', async () => {
    armFollowUp();
    await vi.advanceTimersByTimeAsync(ownerBudgetFor(LONG_ANSWER_CHARS) - 5_000);
    expect(startCalls, 'konuşma sürerken startListening → ttsCancel cevabı kesti').toBe(0);
    expect(isFollowUpEngaged(), 'döngü canlı kalmalı').toBe(true);
  });

  it('KONUŞMA SÜRERKEN tur idle olmaz (takipsiz sohbet yolu)', async () => {
    armConvIdleOnTtsEnd();
    await vi.advanceTimersByTimeAsync(ownerBudgetFor(LONG_ANSWER_CHARS) - 5_000);
    expect(idleCalls, 'konuşma sürerken tur idle oldu').toBe(0);
  });

  it('konuşma bitince mikrofon NORMAL şekilde devralır (davranış korunur)', async () => {
    armFollowUp();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(startCalls).toBe(0);
    speaking = false;                                   // motor bitirdi
    await vi.advanceTimersByTimeAsync(SPEAKING_EXTEND_MS + 1_000);
    expect(startCalls, 'konuşma bitti ama takip dinlemesi açılmadı').toBe(1);
  });

  it('GERÇEK stall: watchdog hâlâ bounded — sonsuza kadar uzatmaz', async () => {
    armFollowUp();
    /* Bayrak HİÇ düşmese bile pencere kapanır (sahibin tavanı da bounded'dır). */
    await vi.advanceTimersByTimeAsync(FOLLOWUP_FALLBACK_MS + MAX_SPEAKING_WINDOW_MS + 10_000);
    expect(startCalls, 'bounded kurtarma çalışmadı').toBe(1);
    expect(_pendingConversationTimersForTest(), 'zamanlayıcı sızdı').toBe(0);
  });

  it('kullanıcı "dur" dedi: oturum kapanınca döngü ANINDA ölür', async () => {
    armFollowUp();
    await vi.advanceTimersByTimeAsync(30_000);
    _resetConversationRuntimeForTest();                 // disposeConversationRuntime yolu
    wire();
    await vi.advanceTimersByTimeAsync(MAX_SPEAKING_WINDOW_MS + 10_000);
    expect(startCalls, 'iptalden sonra mikrofon açıldı').toBe(0);
    expect(_pendingConversationTimersForTest()).toBe(0);
  });
});
