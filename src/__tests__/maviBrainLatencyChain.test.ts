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

import {
  GEMINI_MODEL_CHAIN, GEMINI_MODELS, DEFAULT_GEMINI_MODEL,
  isGeminiThinkingRejected, noteGeminiThinkingRejected, geminiThinkingConfig,
  noteGeminiThinkingRejectedIf400, _resetGeminiThinkingForTest,
} from '../platform/ai/gateway/models';
import { _resetGeminiModelForTest } from '../platform/companion/companionChatProvider';
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
  beforeEach(() => { _resetGeminiModelForTest(); _resetGeminiThinkingForTest(); });

  it('reddedilen model hatırlanır (oturum ömürlü)', () => {
    expect(isGeminiThinkingRejected('gemini-3.5-flash-lite')).toBe(false);
    noteGeminiThinkingRejected('gemini-3.5-flash-lite');
    expect(isGeminiThinkingRejected('gemini-3.5-flash-lite')).toBe(true);
    // Model BAZINDA: biri reddetti diye diğeri damgalanmaz.
    expect(isGeminiThinkingRejected('gemini-3.1-flash-lite')).toBe(false);
  });

  it('🔒 istek gövdesi AKTİF MODELİN öğrenilmiş durumunu okur (tur-yerel bayrak DEĞİL)', () => {
    const src = read('src/platform/companion/companionChatProvider.ts');
    expect(src).toMatch(/body:\s+mkBody\(getActiveGeminiModel\(\)\)/);
    expect(src).toMatch(/\.\.\.geminiThinkingConfig\(model\)/);
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

/* ══════════════════════════════════════════════════════════════════════════
 * TEK KAPI — `thinkingConfig` HER ÇAĞRI YERİNDE AYNI BİLGİYİ OKUR
 *
 * SAHA 2026-09-11 (ağ izi): alan SEKİZ ayrı yerden KOŞULSUZ gönderiliyordu ve
 * öğrenilen ret yalnız beyin yolunda tutuluyordu → tek turda AYNI model üç kez
 * 400 aldı (0,51 + 0,60 + 0,41 sn ≈ 1,5 sn boşa). Ayrıca semantik yönlendirici
 * ve AI komut yolu `DEFAULT_GEMINI_MODEL`e sabit olduğu için HER turda 400 alıp
 * sessizce `null` dönüyordu.
 * ════════════════════════════════════════════════════════════════════════ */
describe('geminiThinkingConfig — tek kapı', () => {
  beforeEach(() => { _resetGeminiThinkingForTest(); });

  it('reddedilmemiş modelde alan EKLENİR (düşünen modeller metinsiz dönmesin)', () => {
    expect(geminiThinkingConfig('gemini-3.1-flash-lite')).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
  });

  it('reddeden modelde alan HİÇ gönderilmez', () => {
    noteGeminiThinkingRejected('gemini-3.5-flash-lite');
    expect(geminiThinkingConfig('gemini-3.5-flash-lite')).toEqual({});
  });

  it('400 sınıflandırması TEK KURAL: API_KEY_INVALID öğrenilmez', async () => {
    const anahtarHatasi = new Response('{"error":{"message":"API_KEY_INVALID"}}', { status: 400 });
    expect(await noteGeminiThinkingRejectedIf400(DEFAULT_GEMINI_MODEL, anahtarHatasi)).toBe(false);
    expect(isGeminiThinkingRejected(DEFAULT_GEMINI_MODEL)).toBe(false);
  });

  it('400 INVALID_ARGUMENT öğrenilir; 200/429 öğrenilmez', async () => {
    expect(await noteGeminiThinkingRejectedIf400('m1', new Response('{"error":{"status":"INVALID_ARGUMENT"}}', { status: 400 }))).toBe(true);
    expect(isGeminiThinkingRejected('m1')).toBe(true);
    expect(await noteGeminiThinkingRejectedIf400('m2', new Response('{}', { status: 429 }))).toBe(false);
    expect(await noteGeminiThinkingRejectedIf400('m3', new Response('{}', { status: 200 }))).toBe(false);
  });

  it('gövde okunamıyorsa MUHAFAZAKÂR: kayıt YOK', async () => {
    expect(await noteGeminiThinkingRejectedIf400('m4', new Response('', { status: 400 }))).toBe(false);
    expect(isGeminiThinkingRejected('m4')).toBe(false);
  });

  it('🔒 hiçbir Gemini çağrı yeri alanı KOŞULSUZ göndermez', () => {
    for (const rel of [
      'src/platform/companion/companionChatProvider.ts',
      'src/platform/ai/semanticAiService.ts',
      'src/platform/aiVoiceService.ts',
      'src/platform/ai/gateway/providers/geminiProvider.ts',
    ]) {
      const kod = read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(kod, `${rel}: thinkingConfig kapıdan geçmeden gönderiliyor`)
        .not.toMatch(/thinkingConfig:\s*\{/);
    }
  });

  it('🔒 yönlendirici ve AI komut yolu ret sonrası isteği TEKRARLAR', () => {
    for (const rel of ['src/platform/ai/semanticAiService.ts', 'src/platform/aiVoiceService.ts']) {
      expect(read(rel)).toMatch(/if \(await noteGeminiThinkingRejectedIf400\(DEFAULT_GEMINI_MODEL, resp\)\) resp = await send\(\);/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ÖĞRENME KAYDI — REDDİ İLK GÖREN KAYDEDER
 *
 * SAHA 2026-09-11 (cihaz, gövde parmak izleriyle ayrıştırıldı): tek turda ÜÇ
 * ayrı yol aynı reddi SIFIRDAN keşfetti —
 *   54,56s  `max=1 think=VAR`                → 400  (ısıtma; sonucu ATIYORDU)
 *   59,51s  `temp=0.4 max=2600 mime=- VAR`   → 400  (gateway geminiProvider)
 *   60,14s  `temp=0.4 max=2600 mime=json VAR`→ 400  (beyin; kurtardı → 200)
 * Toplam ~1,9 sn. Isıtma zaten yapılan bir istektir: sonucunu OKUMAK ek maliyet
 * getirmez ve zincirin tamamını tek seferde öğretir.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 reddi ilk gören KAYDEDER', () => {
  it('ısıtma isteği sonucunu okur ve reddi kaydeder', () => {
    const src = read('src/platform/companion/companionChatProvider.ts');
    const i = src.indexOf('export async function warmupGemini');
    expect(i).toBeGreaterThan(-1);
    const govde = src.slice(i, i + 1800);
    expect(govde, 'ısıtma sonucu yine atılıyor — zincir reddi sıfırdan öğrenir')
      .toMatch(/await noteGeminiThinkingRejectedIf400\(model, resp\)/);
  });

  it('gateway Gemini sağlayıcısı reddi kaydeder ve isteği TEKRARLAR', () => {
    const src = read('src/platform/ai/gateway/providers/geminiProvider.ts');
    expect(src).toMatch(/await noteGeminiThinkingRejectedIf400\(model, response\)/);
    expect(src).toMatch(/response = await send\(\);/);
    expect(src).toMatch(/\.\.\.geminiThinkingConfig\(model\)/);
  });
});
