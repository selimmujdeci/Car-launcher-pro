/**
 * maviBrainLatencyChain.test.ts — SAHA 2026-09-11 · "ben konuştuktan sonra çok
 * geç cevap veriyor".
 *
 * ÖLÇÜLEN TUR (gerçek cihaz, uygulamanın kendi `maviLatencyTrace` izi):
 *   listen_start → stt_result        3,49 sn
 *   → brain_complete               +10,10 sn   ⬅️ baskın maliyet
 *   → ilk duyulabilir ses           +4,41 sn
 *   TOPLAM 18,1 sn
 *
 * Beynin 10,1 sn'sinin ~4,1 sn'si ÖLÜ SAĞLAYICI DENEMELERİNDE harcanıyordu
 * (OpenRouter 402 · gemini-2.5-flash 404 ×2 · gemini-3.6-flash 400 → 429).
 * Bu dosya o üç kaybın geri gelmemesini kilitler.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GEMINI_MODEL_CHAIN, GEMINI_MODELS } from '../platform/ai/gateway/models';
import {
  isGeminiThinkingRejected, noteGeminiThinkingRejected, _resetGeminiModelForTest,
} from '../platform/companion/companionChatProvider';
import {
  isProviderCoolingDown, noteGatewayFailureKind, noteProviderRateLimited,
  _resetProviderHealthForTest, NO_CREDIT_COOLDOWN_MS, RATE_LIMIT_COOLDOWN_MS,
} from '../platform/companion/companionProviderHealth';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Gemini model zinciri — ölü model taşınmaz', () => {
  it('SAHA: kalıcı emekli `gemini-2.5-flash` zincirde YOK', () => {
    /* 404 "no longer available to new users" — 429/503 gibi geri DÖNMEZ.
       Zincirin 1. sırasındaydı: her oturumun ilk turunda 2 istek boşa gidiyordu. */
    expect(GEMINI_MODEL_CHAIN).not.toContain('gemini-2.5-flash');
    expect(Object.values(GEMINI_MODELS)).not.toContain('gemini-2.5-flash');
  });

  it('zincir boş değil ve tekrarsız (tek model = tek arıza noktası)', () => {
    expect(GEMINI_MODEL_CHAIN.length).toBeGreaterThan(2);
    expect(new Set(GEMINI_MODEL_CHAIN).size).toBe(GEMINI_MODEL_CHAIN.length);
  });

  it('zincirin BAŞI ölçülen en hızlı çalışan model', () => {
    // Cihazda ölçüldü: 0,56 sn. Önceki baş (`gemini-2.5-flash`) 404 veriyordu.
    expect(GEMINI_MODEL_CHAIN[0]).toBe('gemini-3.5-flash-lite');
  });
});

describe('thinkingConfig reddi — ÖĞRENİLEN BİLGİ TUR SONUNDA UNUTULMAZ', () => {
  beforeEach(() => { _resetGeminiModelForTest(); });

  it('reddedilen model hatırlanır (oturum ömürlü)', () => {
    expect(isGeminiThinkingRejected('gemini-3.5-flash-lite')).toBe(false);
    noteGeminiThinkingRejected('gemini-3.5-flash-lite');
    expect(isGeminiThinkingRejected('gemini-3.5-flash-lite')).toBe(true);
    // Model BAZINDA: biri reddetti diye diğeri damgalanmaz.
    expect(isGeminiThinkingRejected('gemini-3.1-flash-lite')).toBe(false);
  });

  it('🔒 istek gövdesi AKTİF MODELİN öğrenilmiş durumunu okur (tur-yerel bayrak DEĞİL)', () => {
    const src = read('src/platform/companion/companionChatProvider.ts');
    expect(src).toMatch(/mkBody\(!isGeminiThinkingRejected\(getActiveGeminiModel\(\)\)\)/);
    expect(src, 'tur-yerel bayrak geri gelmiş — öğrenilen bilgi her turda unutulur')
      .not.toMatch(/let _thinkingSupported/);
  });

  it('🔒 kurtarma zincirin HER adımında geçerli (ikinci model 400 ile zinciri düşürmez)', () => {
    const src = read('src/platform/companion/companionChatProvider.ts');
    expect(src).toMatch(/while \(!resp\.ok && _advanceGeminiModel\(resp\.status\)\) \{\s*resp = await sendWithThinkingRecovery\(\);/);
  });
});

describe('Kredi/kimlik arızası — her turda yeniden denenmez', () => {
  beforeEach(() => { _resetProviderHealthForTest(); });

  it('SAHA: 402 (kredi yok) sonrası gateway bounded süre ATLANIR', () => {
    expect(isProviderCoolingDown('gateway')).toBe(false);
    noteGatewayFailureKind('insufficient_credit');
    expect(isProviderCoolingDown('gateway')).toBe(true);
  });

  it('kimlik arızası (auth) da aynı pencereyi kurar', () => {
    noteGatewayFailureKind('auth');
    expect(isProviderCoolingDown('gateway')).toBe(true);
  });

  it('pencere SONSUZ DEĞİL ve 429 penceresinden UZUN (insan müdahalesi gerekir)', () => {
    expect(NO_CREDIT_COOLDOWN_MS).toBeGreaterThan(RATE_LIMIT_COOLDOWN_MS);
    expect(Number.isFinite(NO_CREDIT_COOLDOWN_MS)).toBe(true);
  });

  it('geçici arıza penceresi DEĞİŞMEDİ — 429 hâlâ kendi süresinde', () => {
    noteGatewayFailureKind('rate_limited');
    expect(isProviderCoolingDown('gateway')).toBe(false);   // 402/auth dışı kurmaz
    noteProviderRateLimited('gemini');
    expect(isProviderCoolingDown('gemini')).toBe(true);
    expect(isProviderCoolingDown('groq')).toBe(false);      // çapraz kirlenme yok
  });
});
