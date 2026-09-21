/**
 * liveTurnResolution — Gemini Live turunun SONUÇ ANLAMI (saf karar tablosu).
 *
 * ── NEDEN VAR (REGRESSION 2026-09-21, kök neden `28afb632`) ─────────────────
 * Eski kural `spokeAudio || transcript → çözüldü, fallback YOK` idi. "Model bir
 * şey söyledi" ile "kullanıcının isteği çözüldü" aynı şey değildir: "Bunu
 * yapamıyorum", araçsız "klimayı açıyorum" (sahte onay) ve transkriptsiz ses bile
 * BAŞARI sayılıyor, REST ve yerel parser hiç devreye girmiyordu.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · SAF: I/O yok · durum yok · `Date.now` yok. Girdi → tek `LiveTurnResolution`.
 *  · OTORİTE DEĞİL: yalnız "bu tur ne üretti"yi adlandırır. Kapı/onay/yürütme
 *    (`parseBrainJson` → capability → dispatch → maviActionAuthority → AiSafetyGate)
 *    ve sağlayıcı zinciri (`runCompanionBrain`) DEĞİŞMEZ; ikinci router YOK.
 *  · EYLEM BAŞARISI = GEÇERLİ TOOL/INTENT. Ses/transkript eylem kanıtı DEĞİLDİR.
 *  · "Ses kullanıcıya verildi mi" (`audioCommitted`) yaşam döngüsünden gelir:
 *    `maviLiveAudioStream` ilk PCM parçasını gerçek oynatmaya verdiğinde true.
 *    Metin tahmini YOK.
 *  · "Eylem isteği miydi" kanıtı çağırandan gelir (`requestEvidence`): yerel parser
 *    (`isInformationalCommand` dışı komut ≥0.5) ya da kanonik ekran kaydı
 *    (`resolveScreen`) eşleşmesi, ya da modelin kendi `mavi_unresolved` beyanı.
 *    Transkript içeriğine bakılarak "sahte onay" tahmini YAPILMAZ.
 */

import type { BrainRaw } from '../../companion/companionBrainParser';

export type LiveTurnResolutionKind =
  | 'ACTION_RESOLVED'   // geçerli tool → parseBrainJson kabul etti (action ya da web)
  | 'CHAT_RESOLVED'     // sohbet isteği, anlamlı transkript, araç yok
  | 'UNRESOLVED'        // eylem isteği ama geçerli tool yok (model beyanı ya da kanıt) — ses çalınmış olabilir
  | 'INVALID_TOOL'      // tool çağrıldı ama hiçbiri geçerli değil, konuşulmadı
  | 'NO_OUTPUT';        // kullanılabilir hiçbir şey yok (ses gelmiş olabilir ama transkript/tool yok)

export type LiveTurnResolution =
  | { readonly kind: 'ACTION_RESOLVED'; readonly result: BrainRaw; readonly audioCommitted: boolean }
  | { readonly kind: 'CHAT_RESOLVED'; readonly transcript: string; readonly audioCommitted: boolean }
  | { readonly kind: 'UNRESOLVED'; readonly transcript: string; readonly audioCommitted: boolean; readonly why: 'model_declared' | 'action_request_without_tool' }
  | { readonly kind: 'INVALID_TOOL'; readonly audioCommitted: boolean }
  | { readonly kind: 'NO_OUTPUT'; readonly audioCommitted: boolean };

/** Çağıranın turdan topladığı kanıtlar. */
export interface LiveTurnEvidence {
  /** Geçerli ilk tool kararı (`parseBrainJson` kabul etti) — yoksa null. */
  readonly firstValidTool: BrainRaw | null;
  /** En az bir tool çağrısı geldi (geçerli ya da değil). */
  readonly sawToolCall: boolean;
  /** Model `mavi_unresolved` çağırdı. */
  readonly declaredUnresolved: boolean;
  /** Çıkış transkripti (whitespace sadeleştirilmiş). */
  readonly transcript: string;
  /** İlk PCM parçası gerçek oynatmaya verildi (kullanıcı duydu/duyuyor). */
  readonly audioCommitted: boolean;
  /** Çağıranın istek sınıfı kanıtı. `'action'` → eylem istendiği kanıtlı. */
  readonly requestEvidence: 'action' | 'unknown';
}

export function resolveLiveTurn(e: LiveTurnEvidence): LiveTurnResolution {
  const transcript = (e.transcript ?? '').replace(/\s+/g, ' ').trim();
  const audioCommitted = e.audioCommitted === true;

  // 1. Geçerli tool = eylem/web çözüldü (tek başarı kanıtı).
  if (e.firstValidTool) return { kind: 'ACTION_RESOLVED', result: e.firstValidTool, audioCommitted };

  // 2. Model açıkça "eşleyemedim" dedi → çözülmedi (ses çalınmış olsa bile).
  if (e.declaredUnresolved) return { kind: 'UNRESOLVED', transcript, audioCommitted, why: 'model_declared' };

  // 3. Konuşulmadı.
  if (!transcript && !audioCommitted) {
    return e.sawToolCall ? { kind: 'INVALID_TOOL', audioCommitted } : { kind: 'NO_OUTPUT', audioCommitted };
  }

  // 4. Ses var ama transkript yok → kullanılabilir çıktı yok (boş cevap BAŞARI DEĞİL).
  if (!transcript) return { kind: 'NO_OUTPUT', audioCommitted };

  // 5. Transkript var, tool yok: eylem istendiği KANITLIYSA çözülmedi; değilse sohbet çözüldü.
  if (e.requestEvidence === 'action') {
    return { kind: 'UNRESOLVED', transcript, audioCommitted, why: 'action_request_without_tool' };
  }
  return { kind: 'CHAT_RESOLVED', transcript, audioCommitted };
}
