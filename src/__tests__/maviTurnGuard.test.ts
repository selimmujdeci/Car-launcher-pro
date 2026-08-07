/**
 * maviTurnGuard.test.ts — MAVI-M5 · TUR SÖZLEŞMESİ (saf) + MİMARİ KİLİTLER.
 *
 * M1 (#146, P1): `processTextCommand` içinde istek kimliği yoktu → geç dönen
 * sağlayıcı cevabı yeni turu bozabiliyordu. Bu dosya (a) tur sözleşmesinin saf
 * davranışını, (b) kapıların kaynak düzeyinde yerinde durduğunu kilitler.
 *
 * KRİTİK KİLİT: **proaktif güvenlik hattı kullanıcı turuna BAĞLANAMAZ** — kritik
 * DTC uyarısı kullanıcı yeni komut verdi diye susturulamaz.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  beginMaviTurn, completeMaviTurn, supersedeActiveMaviTurn,
  isMaviTurnCurrent, isMaviTurnActive, continueIfTurnActive,
  getActiveMaviTurn, getMaviTurnDiagnostics,
  _resetMaviTurnsForTest, _setMaviTurnCounterForTest,
} from '../platform/assistant/maviTurn';

const SRC = join(process.cwd(), 'src');
const read = (...seg: string[]): string => readFileSync(join(SRC, ...seg), 'utf8');

/** Yorumları çıkarır — kaynak kilitleri YALNIZ gerçek koda bakar. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

beforeEach(() => { _resetMaviTurnsForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * A — Saf sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M5 · tur sözleşmesi', () => {
  it('1/3. ilk tur id=1; sayaç monotonik artar, aynı kimliği tekrar üretmez', () => {
    const t1 = beginMaviTurn();
    const t2 = beginMaviTurn();
    const t3 = beginMaviTurn();
    expect(t1.id).toBe(1);
    expect(t2.id).toBe(2);
    expect(t3.id).toBe(3);
    expect(new Set([t1.id, t2.id, t3.id]).size).toBe(3);
  });

  it('2. yeni tur öncekini SUPERSEDED yapar → eski token eylem yetkisini KAYBEDER', () => {
    const t1 = beginMaviTurn();
    expect(isMaviTurnActive(t1)).toBe(true);
    const t2 = beginMaviTurn();
    expect(isMaviTurnActive(t1)).toBe(false);
    expect(isMaviTurnCurrent(t1)).toBe(false);
    expect(isMaviTurnActive(t2)).toBe(true);
    expect(getMaviTurnDiagnostics().turnsSuperseded).toBe(1);
  });

  it('4. TAMAMLANAN tur yeni yan etki başlatamaz ama "current" kalır (UI sıfırlaması meşru)', () => {
    const t = beginMaviTurn();
    completeMaviTurn(t);
    expect(isMaviTurnActive(t)).toBe(false);    // gecikmeli konuşma/eylem YOK
    expect(isMaviTurnCurrent(t)).toBe(true);    // ama daha yeni tur da yok → UI sıfırlanabilir
    expect(getMaviTurnDiagnostics().turnsCompleted).toBe(1);
  });

  it('completeMaviTurn idempotenttir ve devralınmış turu geri almaz', () => {
    const t1 = beginMaviTurn();
    completeMaviTurn(t1);
    completeMaviTurn(t1);
    expect(getMaviTurnDiagnostics().turnsCompleted).toBe(1);

    const t2 = beginMaviTurn();
    beginMaviTurn();                            // t2 devralındı
    completeMaviTurn(t2);                        // etkisiz
    expect(getMaviTurnDiagnostics().turnsCompleted).toBe(1);
  });

  it('supersedeActiveMaviTurn tek seferlik ve idempotent (barge-in)', () => {
    const t = beginMaviTurn();
    supersedeActiveMaviTurn();
    supersedeActiveMaviTurn();
    expect(isMaviTurnActive(t)).toBe(false);
    expect(getMaviTurnDiagnostics().turnsSuperseded).toBe(1);
  });

  it('geçersiz/boş token her zaman yetkisizdir', () => {
    beginMaviTurn();
    expect(isMaviTurnActive(null)).toBe(false);
    expect(isMaviTurnActive(undefined)).toBe(false);
    expect(isMaviTurnActive({ id: 999, startedAtMs: 0 })).toBe(false);
    expect(isMaviTurnCurrent({ id: NaN, startedAtMs: 0 } as never)).toBe(false);
  });

  it('`Date.now()` KİMLİK olarak kullanılmaz — saat aynı olsa da id ayrışır', () => {
    const t1 = beginMaviTurn(1_700_000_000_000);
    const t2 = beginMaviTurn(1_700_000_000_000);
    expect(t1.startedAtMs).toBe(t2.startedAtMs);
    expect(t1.id).not.toBe(t2.id);
  });

  it('sayaç taşması TANIMLIDIR: tavanda 1\'e sarılır, eski token ÇAKIŞMAZ', () => {
    _setMaviTurnCounterForTest(Number.MAX_SAFE_INTEGER - 1);
    const last = beginMaviTurn();
    expect(last.id).toBe(Number.MAX_SAFE_INTEGER);
    const wrapped = beginMaviTurn();
    expect(wrapped.id).toBe(1);
    expect(isMaviTurnActive(last)).toBe(false);   // eski token yetkisiz
    expect(isMaviTurnActive(wrapped)).toBe(true);
  });

  it('getActiveMaviTurn senkron handler\'ın kimliği yakalamasını sağlar', () => {
    expect(getActiveMaviTurn()).toBeNull();
    const t = beginMaviTurn();
    expect(getActiveMaviTurn()?.id).toBe(t.id);
    expect(isMaviTurnActive(getActiveMaviTurn())).toBe(true);
  });

  it('continueIfTurnActive stale olayı SESSİZCE düşürür ve türüne göre sayar', () => {
    const t = beginMaviTurn();
    expect(continueIfTurnActive(t, 'action')).toBe(true);
    beginMaviTurn();                              // t devralındı
    expect(continueIfTurnActive(t, 'provider_result')).toBe(false);
    expect(continueIfTurnActive(t, 'action')).toBe(false);
    expect(continueIfTurnActive(t, 'feedback')).toBe(false);
    const d = getMaviTurnDiagnostics();
    expect(d.staleProviderResultsDropped).toBe(1);
    expect(d.staleActionsPrevented).toBe(1);
    expect(d.staleFeedbackSuppressed).toBe(1);
  });

  it('token dondurulmuştur (tüketici kimliği değiştiremez)', () => {
    expect(Object.isFrozen(beginMaviTurn())).toBe(true);
  });

  it('tanı yüzeyi bounded ve PII\'siz (yalnız sayı/enum)', () => {
    beginMaviTurn();
    const d = getMaviTurnDiagnostics();
    for (const [k, v] of Object.entries(d)) {
      if (k === 'activeState') { expect(typeof v).toBe('string'); continue; }
      if (k === 'countersSaturated') { expect(typeof v).toBe('boolean'); continue; }
      expect(typeof v, k).toBe('number');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — Mimari kilitler
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M5 · guard — kapılar yerinde', () => {
  const VOICE = stripComments(read('platform', 'voiceService.ts'));

  it('35. sağlayıcı sonucu tüketilmeden ÖNCE güncellik kapısı vardır', () => {
    const brainIdx = VOICE.indexOf('await tryCompanionBrain');
    expect(brainIdx).toBeGreaterThan(-1);
    const afterBrain = VOICE.slice(brainIdx);
    const gateIdx = afterBrain.indexOf("continueIfTurnActive(turn, 'provider_result')");
    const consumeIdx = afterBrain.indexOf('_dispatchConversation(brain.response');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(consumeIdx);   // kapı, tüketimden ÖNCE
  });

  it('36. `_aiHandlers` yalnız güncellik kapısının ARDINDAN çağrılır', () => {
    /* Handler ÇAĞRISININ kendisi aranır — `_aiHandlers` adı başka yerlerde de
       geçtiği için (Set tanımı, kayıt/sökme) çağrı kalıbına çıpalanır.
       2026-07-31: dönüş `Promise` olabildiğinden çağrı `Promise.resolve(...)`
       ile sarılır; SENKRON çağrı garantisi (kapıdan sonra await yok) KORUNUR. */
    const callIdx = VOICE.indexOf('_aiHandlers.forEach((fn) => { _aiPending.push(');
    expect(callIdx, 'AI handler çağrı yeri bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    const before = VOICE.slice(0, callIdx);
    const gateIdx = before.lastIndexOf("continueIfTurnActive(turn, 'action')");
    expect(gateIdx).toBeGreaterThan(-1);
    // Kapı ile çağrı arasında `await` OLMAMALI (araya yeni tur giremesin).
    expect(before.slice(gateIdx)).not.toMatch(/\bawait\b/);
    /* Handler MİKROTASK'a ERTELENMEMELİ — erteleme kapı garantisini bozar. */
    expect(VOICE).not.toContain('Promise.resolve().then(() => fn(');
  });

  it('37. zincir adımları her yinelemede stale kapısından geçer', () => {
    const chainIdx = VOICE.indexOf('function dispatchChain');
    const chain = VOICE.slice(chainIdx, chainIdx + 1200);
    expect(chain).toMatch(/continueIfTurnActive\(_chainTurn, 'action'\)/);
  });

  it('38. gecikmeli feedback timer\'ı tur token\'ı TAŞIR', () => {
    const timerIdx = VOICE.indexOf('THINKING_FEEDBACK_DELAY_MS);');
    expect(timerIdx).toBeGreaterThan(-1);
    const block = VOICE.slice(Math.max(0, timerIdx - 400), timerIdx);
    expect(block).toMatch(/continueIfTurnActive\(turn, 'feedback'\)/);
    expect(block).toMatch(/_speakThinking\(\)/);
  });

  it('fallback zinciri öncesinde de kapı vardır (stale tur offline cevapla konuşamaz)', () => {
    // Ham kaynak üzerinde: fallback'in ilk dalı `AUTO_DISPATCH_MIN` karşılaştırmasıdır.
    const RAW = read('platform', 'voiceService.ts');
    const fbIdx = RAW.indexOf('result.command.confidence >= AUTO_DISPATCH_MIN');
    expect(fbIdx).toBeGreaterThan(-1);
    const before = RAW.slice(0, fbIdx);
    const gateIdx = before.lastIndexOf("continueIfTurnActive(turn, 'provider_result')");
    expect(gateIdx).toBeGreaterThan(-1);
    // Kapı ile fallback arasında `await` OLMAMALI.
    expect(before.slice(gateIdx)).not.toMatch(/\bawait\b/);
  });

  it('39. üretim kodunda global mutable `currentVehicleContext` YOKTUR', () => {
    for (const f of [
      ['platform', 'voiceService.ts'],
      ['platform', 'assistant', 'maviVehicleContext.ts'],
      ['platform', 'assistant', 'maviTurn.ts'],
      ['hooks', 'useVoiceCommandHandler.ts'],
    ] as const) {
      const src = stripComments(read(...f));
      expect(src, f.join('/')).not.toMatch(/let\s+_?current(Mavi)?VehicleContext/i);
      expect(src, f.join('/')).not.toMatch(/let\s+_lastVehicleContext/i);
    }
  });

  it('40. PROAKTİF GÜVENLİK HATTI kullanıcı tur sayacına BAĞLANAMAZ', () => {
    // Kritik DTC uyarısı, kullanıcı yeni komut verdi diye SUSTURULAMAZ.
    for (const f of [
      ['platform', 'companion', 'companionProactiveWiring.ts'],
      ['platform', 'system', 'platformCoreAiRuntimeWiring.ts'],
      ['platform', 'assistant', 'assistantSafetyKernel.ts'],
    ] as const) {
      const src = read(...f);
      expect(src, f.join('/')).not.toMatch(/from '[^']*maviTurn'/);
      expect(src, f.join('/')).not.toMatch(/isMaviTurn|continueIfTurnActive|beginMaviTurn/);
    }
  });

  it('tur modülü store/localStorage/timer KURMAZ (saf, izole)', () => {
    const src = stripComments(read('platform', 'assistant', 'maviTurn.ts'));
    expect(src).not.toMatch(/localStorage|sessionStorage/);
    expect(src).not.toMatch(/setTimeout|setInterval/);
    expect(src).not.toMatch(/from '/);          // hiçbir runtime import yok
  });

  it('stale bir HATA DEĞİLDİR: tur kapısı errorBus/console\'a yazmaz', () => {
    const src = stripComments(read('platform', 'assistant', 'maviTurn.ts'));
    expect(src).not.toMatch(/showToast|errorBus|console\.(error|warn)/);
  });
});
