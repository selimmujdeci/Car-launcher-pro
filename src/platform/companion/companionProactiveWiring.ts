/**
 * companionProactiveWiring.ts — Proaktif kritik arıza uyarısının ÜRETİM KÖPRÜSÜ (#124).
 *
 * ── NEDEN BURAYA BAĞLANDI (SystemOrchestrator DEĞİL) ────────────────────────
 * `SystemOrchestrator` bilinçli olarak **tamamen event-driven**'dır ve kaynağında
 * "Sadece event-driven — poll yok, overhead sıfır" yazar. Oraya 5 sn'lik periyodik
 * bir tanı kontrolü koymak hem o invaryantı hem CLAUDE.md performans bütçesini
 * (hot-path'e iş ekleme yasağı) ihlal ederdi.
 *
 * Repoda kritik verdikti ZATEN üreten canlı bir döngü var: `aiCoreRuntime`
 * (edge-triggered · 600 ms coalesce · en az 4 sn ara · `ai.mechanic.report` yayını).
 * Bu köprü o döngünün SONUNA fail-soft bir GÖZLEMCİ olarak biner:
 *   YENİ TIMER YOK · YENİ ABONELİK YOK · YENİ POLL YOK.
 *
 * ── ÇİFTE SESLENDİRME KORUMASI (kaynakta doğrulandı) ────────────────────────
 * `SystemOrchestrator` bazı kritik durumları ZATEN seslendiriyor:
 *   ENGINE_OVERHEAT → speakAlert('Motor sıcaklığı yüksek, lütfen güvenli yerde durun.')
 *   CRITICAL_FUEL · CRASH_DETECTED · MAINTENANCE_REQUIRED → speakAlert(...)
 * Bu köprü aynı durumu İKİNCİ kez söylerse sürücü üst üste iki uyarı duyar. Bu yüzden
 * güvenlik çekirdeğinin `engine_overheat` şablonuna düşen durumlarda köprü SUSAR
 * (`already_voiced_by_orchestrator`) — o hat zaten kapsanmıştır. Köprünün KATTIĞI
 * değer, araç-olayı OLMAYAN kök-nedenlerdir (kritik DTC, tanı motoru hipotezleri).
 *
 * ── DİĞER SINIRLAR ──────────────────────────────────────────────────────────
 *  · Tek çıkış `speakSafetyAlert` (ttsService). UI manipülasyonu YOK.
 *  · Verdict okunamaz/null → SUSULUR (fail-closed).
 *  · 5 dk debounce · geri manevrada susma · ≤180 karakter tavanı: hepsi
 *    `triggerProactiveDiagnosticAlert` içinde; bu köprü onları EZMEZ.
 *  · Bu modülün import edilmesi YAN ETKİSİZDİR (timer/abonelik açmaz).
 */

import { speakSafetyAlert } from '../ttsService';
import { buildSafetyContext, evaluatePreGate } from '../assistant/assistantSafetyKernel';
import {
  triggerProactiveDiagnosticAlert,
  type ProactiveAlertResult,
  type ProactiveVerdictLike,
} from './companionChatProvider';
import type { ProactiveReasonCode } from '../ai/aiOfflineReason';
// MAVI-M4-LAB-2: zincir gözlemi (saf depo — TTS kanalını veya kararı DEĞİŞTİRMEZ).
import { recordMaviActionStage } from '../action/maviActionTrace';

/**
 * `SystemOrchestrator`'ın ZATEN seslendirdiği güvenlik şablonları. Bu şablonlardan
 * birine düşen durumda köprü susar (çifte seslendirme yasağı). Liste kaynak
 * doğrulamasıyla kuruldu (SystemOrchestrator.ts — ENGINE_OVERHEAT dalı).
 */
const ALREADY_VOICED_TEMPLATES: ReadonlySet<string> = new Set(['engine_overheat']);

/** Köprünün ihtiyaç duyduğu, aiCore koşu sonucunun MİNİMUM yapısal şekli. */
export interface ProactiveRunResultLike {
  readonly verdict?: ProactiveVerdictLike | null;
}

export interface ProactiveWiringDeps {
  /** Test enjeksiyonu — varsayılan `ttsService.speakSafetyAlert`. */
  readonly speak?: (text: string) => void;
  /** Test enjeksiyonu — varsayılan canlı `buildSafetyContext()`. */
  readonly safety?: () => ReturnType<typeof buildSafetyContext>;
  /** Test enjeksiyonu — MONOTONİK saat (debounce hesabı için). */
  readonly now?: () => number;
  /** Sürüş hâli (metin tavanı için bilgi amaçlı; tavan zaten koşulsuz 180). */
  readonly isDriving?: () => boolean;
}

/**
 * aiCore koşu sonucundan proaktif uyarıyı değerlendirir. ASLA throw etmez —
 * dönüş değeri yalnız TEŞHİS/test içindir; çağıran (runtime gözlemcisi) onu yok sayar.
 */
export function handleAiCoreRunResult(
  result: ProactiveRunResultLike | null | undefined,
  deps: ProactiveWiringDeps = {},
): ProactiveAlertResult {
  /* MAVI-M4-LAB-2: proaktif kritik güvenlik hattı gözlem halkasına AYRI bir
   * event türüyle (`proactive_speech`) ve **`turnId: null`** ile yazılır.
   * NEDEN AYRI: bu bir kullanıcı komutunun cevabı DEĞİLDİR — kullanıcı turu
   * değişince susturulamaz (M6 sözleşmesi). Kullanıcı turu gibi gösterilirse
   * gözlem yalan söyler ve "bu uyarı hangi komuta cevaptı?" sorusu uydurulur.
   * GİZLİLİK: seslendirilen METİN (`result.text`) KAYDEDİLMEZ; yalnız
   * makine-okur kök-neden anahtarı ve gerekçe geçer. */
  const traceProactive = (outcome: string, reason: string, alertKey: string | null): void => {
    recordMaviActionStage({
      stage: 'proactive_speech', status: outcome, reason,
      actionId: alertKey, turnId: null,
    });
  };

  const suppressed = (reason: ProactiveReasonCode): ProactiveAlertResult => {
    traceProactive('suppressed', reason, null);
    return Object.freeze({ outcome: 'suppressed' as const, reason, alertKey: null, text: null });
  };

  try {
    const verdict = result?.verdict;
    if (!verdict) return suppressed('no_verdict');   // verdict okunamadı → SUS (fail-closed)

    // Güvenlik bağlamı bir kez okunur ve HEM çifte-seslendirme kontrolüne HEM de
    // uyarı fonksiyonuna verilir (iki farklı anlık görüntü kullanılmasın).
    let ctx: ReturnType<typeof buildSafetyContext>;
    try { ctx = (deps.safety ?? buildSafetyContext)(); } catch { return suppressed('safety_context_unavailable'); }

    try {
      const pre = evaluatePreGate(ctx);
      if (pre.safetyTemplateId && ALREADY_VOICED_TEMPLATES.has(pre.safetyTemplateId)) {
        return suppressed('already_voiced_by_orchestrator');
      }
    } catch { return suppressed('safety_gate_unavailable'); }

    let driving = false;
    try { driving = deps.isDriving?.() === true; } catch { driving = false; }

    const alert = triggerProactiveDiagnosticAlert(verdict, {
      onSpeak: deps.speak ?? speakSafetyAlert,
      isDriving: driving,
      safety: ctx,
      ...(deps.now ? { now: deps.now } : {}),
    });
    traceProactive(alert.outcome, alert.reason, alert.alertKey);
    return alert;
  } catch {
    return suppressed('wiring_error');   // köprü hatası aiCore döngüsünü ASLA bozmaz
  }
}
