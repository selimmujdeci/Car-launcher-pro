/**
 * companionProactiveWiring.test.ts — Proaktif kritik arıza uyarısının ÜRETİM KÖPRÜSÜ (#124).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. critical verdict → onSpeak TAM 1 kez; metin ≤180 karakter.
 *  2. Geri viteste SUSAR (fail-closed) — güvenlik kapısı.
 *  3. ÇİFTE SESLENDİRME YASAĞI: SystemOrchestrator'ın zaten seslendirdiği
 *     engine_overheat hattında köprü SUSAR.
 *  4. Verdict yok/okunamaz → SUSAR; köprü hatası ASLA dışarı kaçmaz.
 *  5. aiCoreRuntime gözlemcisi YENİ POLL/TIMER AÇMAZ (kaynak sözleşmesi).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* TTS gerçek ses üretmesin — köprünün varsayılan çıkışı da mock'lanır. */
const SPOKE = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../platform/ttsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/ttsService')>()),
  speakSafetyAlert: (t: string) => { SPOKE.calls.push(t); },
}));

import { handleAiCoreRunResult } from '../platform/companion/companionProactiveWiring';
import {
  _resetCompanionChatForTest, PROACTIVE_ALERT_MAX_CHARS, PROACTIVE_ALERT_DEBOUNCE_MS,
  getProactiveAlertDiagnostics,
} from '../platform/companion/companionChatProvider';
import { _resetAiOfflineReasonForTest } from '../platform/ai/aiOfflineReason';

/** aiCore koşu sonucunun köprü için gereken minimum şekli. */
function runResult(opts: { critical?: boolean; code?: string; active?: boolean } = {}) {
  const active = opts.active ?? true;
  return {
    verdict: {
      hasActiveRootCause: active,
      topRootCauses: active ? [{
        problem: 'Akü şarj sistemi arızalı',
        severity: (opts.critical === false ? 'warning' : 'critical'),
        code: opts.code ?? 'ROOT_CHARGING',
      }] : [],
    },
  };
}

const SAFE = () => ({});

beforeEach(() => {
  SPOKE.calls.length = 0;
  _resetCompanionChatForTest();
  _resetAiOfflineReasonForTest();
});

describe('handleAiCoreRunResult — üretim köprüsü', () => {
  it('critical verdict → onSpeak TAM 1 kez, metin ≤180 karakter', () => {
    const r = handleAiCoreRunResult(runResult(), { safety: SAFE, now: () => 0 });

    expect(r.outcome).toBe('spoken');
    expect(SPOKE.calls).toHaveLength(1);
    expect(SPOKE.calls[0].length).toBeGreaterThan(0);
    expect(SPOKE.calls[0].length).toBeLessThanOrEqual(PROACTIVE_ALERT_MAX_CHARS);
    expect(getProactiveAlertDiagnostics().spokenCount).toBe(1);
  });

  it('geri viteste SUSAR (güvenlik kapısı fail-closed)', () => {
    const r = handleAiCoreRunResult(runResult(), {
      safety: () => ({ reverseActive: true }), now: () => 0,
    });

    expect(r.outcome).toBe('suppressed');
    expect(SPOKE.calls).toHaveLength(0);
  });

  /* SystemOrchestrator.ts ENGINE_OVERHEAT dalında ZATEN speakAlert çağırıyor.
     Köprü aynı durumu ikinci kez söylerse sürücü üst üste iki uyarı duyar. */
  it('engine_overheat hattında SUSAR — çifte seslendirme YASAK', () => {
    const r = handleAiCoreRunResult(runResult(), {
      safety: () => ({ engineOverheat: true }), now: () => 0,
    });

    expect(r.outcome).toBe('suppressed');
    expect(r.reason).toBe('already_voiced_by_orchestrator');
    expect(SPOKE.calls).toHaveLength(0);
  });

  it('verdict yok / kritik değil → SUSAR, throw ETMEZ', () => {
    expect(handleAiCoreRunResult(null, { safety: SAFE, now: () => 0 }).reason).toBe('no_verdict');
    expect(handleAiCoreRunResult({}, { safety: SAFE, now: () => 0 }).reason).toBe('no_verdict');
    expect(handleAiCoreRunResult(runResult({ critical: false }), { safety: SAFE, now: () => 0 }).outcome)
      .toBe('suppressed');
    expect(handleAiCoreRunResult(runResult({ active: false }), { safety: SAFE, now: () => 0 }).outcome)
      .toBe('suppressed');
    expect(SPOKE.calls).toHaveLength(0);
  });

  it('güvenlik bağlamı patlarsa SUSAR ve hata DIŞARI KAÇMAZ', () => {
    const boom = () => { throw new Error('safety boom'); };
    let r!: ReturnType<typeof handleAiCoreRunResult>;
    expect(() => { r = handleAiCoreRunResult(runResult(), { safety: boom, now: () => 0 }); }).not.toThrow();
    expect(r.outcome).toBe('suppressed');
    expect(SPOKE.calls).toHaveLength(0);
  });

  it('debounce köprü üzerinden de geçerli — aynı arıza 5 dk içinde tekrar konuşmaz', () => {
    let t = 0;
    const deps = { safety: SAFE, now: () => t };

    expect(handleAiCoreRunResult(runResult(), deps).outcome).toBe('spoken');
    t = PROACTIVE_ALERT_DEBOUNCE_MS - 1;
    expect(handleAiCoreRunResult(runResult(), deps).reason).toBe('debounce');
    expect(SPOKE.calls).toHaveLength(1);

    t = PROACTIVE_ALERT_DEBOUNCE_MS;
    expect(handleAiCoreRunResult(runResult(), deps).outcome).toBe('spoken');
    expect(SPOKE.calls).toHaveLength(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KAYNAK SÖZLEŞMESİ — köprü YENİ POLL/TIMER AÇMAZ
 *
 * Gemini denetimi bu bağlantıyı SystemOrchestrator'a 5 sn'lik periyodik kontrol
 * olarak koymayı önermişti; SystemOrchestrator kaynağında "Sadece event-driven —
 * poll yok, overhead sıfır" yazar. Bu kilit o invaryantı KORUR.
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — proaktif bağlantı yeni bir zamanlayıcı KURMAZ', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf-8');

  it('köprü modülü setInterval/setTimeout/subscribe KULLANMAZ', () => {
    const src = read('src/platform/companion/companionProactiveWiring.ts');
    for (const f of ['setInterval', 'setTimeout', '.subscribe(', 'addEventListener']) {
      expect(src, `köprü '${f}' kullanmamalı`).not.toContain(f);
    }
  });

  it('SystemOrchestrator event-driven KALIR (poll eklenmedi)', () => {
    const src = read('src/platform/system/SystemOrchestrator.ts');
    expect(src).toContain('poll yok, overhead sıfır');
    expect(src).not.toContain('setInterval');
    // Proaktif bağlantı oraya DEĞİL aiCore edge döngüsüne bağlandı.
    expect(src).not.toContain('triggerProactiveDiagnosticAlert');
  });

  it('bağlantı aiCore edge döngüsünün gözlemcisinden gelir', () => {
    const wiring = read('src/platform/system/platformCoreAiRuntimeWiring.ts');
    expect(wiring).toContain('handleAiCoreRunResult');
    expect(wiring).toContain('onRunResult');
    const runtime = read('src/platform/aiCore/runtime/aiCoreRuntime.ts');
    // Gözlemci runtime'ın KENDİ edge tetiğine biner; yeni abonelik/timer eklenmedi.
    expect(runtime).toContain('onRunResult gözlemci hatası — izole');
    expect(runtime).toContain('İKİNCİ POLLING/VERİ/KARAR OTORİTESİ YOK');
  });
});
