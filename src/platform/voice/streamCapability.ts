/**
 * streamCapability.ts — **MAVİ F4 · LLM ve TTS AKIŞ YETENEK MATRİSİ.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * "Streaming var" demek kolaydır; **hangi yolun gerçekte ne yapabildiğini**
 * söylemek zordur. Bu dosya o ayrımı TEK yerde ve DÜRÜSTÇE tutar:
 * desteklemeyen bir yol için **sahte streaming üretilmez**, yol final-only
 * olarak bildirilir ve bugünkü güvenli davranışa düşülür.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** hiçbir modülü import ETMEZ · I/O · timer · global durum YOK.
 *  · Yetenek **ölçülmüş koda dayanır**, iyimser varsayıma değil (aşağıdaki her
 *    satırın gerekçesi kaynak dosyada doğrulanmıştır).
 */

/* ══════════════════════════════════════════════════════════════════════════
 * LLM
 * ════════════════════════════════════════════════════════════════════════ */

export type LlmStreamCapability =
  /** Gerçek token akışı (SSE) — `onToken` her token'da çağrılır. */
  | 'TOKEN_STREAM'
  /** Parça parça gelir ama token değil (bloklu akış). */
  | 'CHUNK_STREAM'
  /** Yalnız tam cevap döner — akış YOK (bugünkü güvenli davranış). */
  | 'FINAL_ONLY';

/**
 * Sağlayıcı → yetenek. **Ölçülen gerçek** (2026-08-29 kod denetimi):
 *
 * | Sağlayıcı | Yetenek | Gerekçe (kaynakta doğrulandı) |
 * |-----------|---------|--------------------------------|
 * | `openrouter` | `TOKEN_STREAM` | `openRouterProvider` SSE ayrıştırıcısı (`consumeSseLine` → `onToken`) GERÇEKTİR ve `readStreamingResponse` `streamed:true` döndürür. |
 * | `gemini` | `TOKEN_STREAM` | F4'te `streamGenerateContent?alt=sse` alt-sürümü eklendi; eklenmeden ÖNCE dosya başlığında açıkça "NON-STREAMING, `onToken` ÇAĞRILMAZ" yazıyordu. |
 * | `gemini_direct` | `FINAL_ONLY` | `companionChatProvider` canlı varsayılan yolu `aiPostJson` ile tek seferlik `generateContent` çağırır — akış yok. |
 * | `groq` | `FINAL_ONLY` | Aynı `aiPostJson` deseni; SSE istenmiyor. |
 * | `haiku` | `FINAL_ONLY` | Aynı desen. |
 * | `offline` | `FINAL_ONLY` | Cihaz-içi şablon cevabı; akış kavramı yok. |
 */
export function llmStreamCapability(provider: string): LlmStreamCapability {
  switch ((provider ?? '').toLowerCase()) {
    case 'openrouter':
    case 'gateway':
    case 'gemini':
      return 'TOKEN_STREAM';
    default:
      return 'FINAL_ONLY';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * TTS
 * ════════════════════════════════════════════════════════════════════════ */

export type TtsStreamCapability =
  /** Ses baytları akarken çalınabilir (ilk sese sentez bitmeden ulaşılır). */
  | 'TRUE_STREAMING'
  /** Parça parça SENTEZ + sırayla çalma (parça içi akış yok). */
  | 'CHUNKED_SYNTHESIS'
  /** Yalnız tam cümle/tam metin — parçalanamaz. */
  | 'FULL_SENTENCE_ONLY'
  /** Native motor tek utterance olarak alır; bitişi yalnız sonda bildirir. */
  | 'NATIVE_FINAL_ONLY';

/**
 * TTS katmanı → yetenek. **Ölçülen gerçek** (2026-08-29 kod denetimi):
 *
 * | Katman | Yetenek | Gerekçe |
 * |--------|---------|---------|
 * | `clip` (`voiceClips`) | `FULL_SENTENCE_ONLY` | Önceden sentezlenmiş SABİT ifade; parçalanamaz ama zaten anında çalar. |
 * | `edge` (`edgeTtsService`) | `CHUNKED_SYNTHESIS` | İstek başına tam blob döner; parça başına AYRI istek yapılabilir. |
 * | `online` (`onlineTtsService`, Gemini TTS) | `CHUNKED_SYNTHESIS` | Aynı desen. |
 * | `native` (Android TextToSpeech) | `CHUNKED_SYNTHESIS` | `speakSegments` + `QUEUE_ADD` ardışık kuyruk destekler (`CarLauncherPlugin`). |
 * | `web` (`speechSynthesis`) | `CHUNKED_SYNTHESIS` | Ardışık `utterance` kuyruğu. |
 *
 * **HİÇBİR katman `TRUE_STREAMING` DEĞİLDİR.** Bu bilinçli ve dürüst bir
 * tespittir: mevcut sağlayıcıların hiçbiri ses baytı akıtmaz, hepsi parça
 * başına tam sentez yapar. F4'ün kazancı "ses akışı" değil, **cevabın
 * tamamının beklenmemesidir** — ilk cümle sentezlenirken model kalanını üretir.
 */
export function ttsStreamCapability(tier: string): TtsStreamCapability {
  switch ((tier ?? '').toLowerCase()) {
    case 'clip':   return 'FULL_SENTENCE_ONLY';
    case 'edge':
    case 'online':
    case 'native':
    case 'web':    return 'CHUNKED_SYNTHESIS';
    default:       return 'NATIVE_FINAL_ONLY';
  }
}

/** Bu yolda parçalı seslendirme YAPILABİLİR mi (sahte streaming üretilmesin). */
export function supportsChunkedSpeech(tier: string): boolean {
  const cap = ttsStreamCapability(tier);
  return cap === 'TRUE_STREAMING' || cap === 'CHUNKED_SYNTHESIS';
}

/** Bu sağlayıcıdan token akışı BEKLENEBİLİR mi. */
export function supportsTokenStream(provider: string): boolean {
  return llmStreamCapability(provider) === 'TOKEN_STREAM';
}
