/**
 * maviVoiceProfile — Mavi'nin SES KİMLİĞİ (yalnız yapılandırma, otorite DEĞİL).
 *
 * ── NEDEN VAR (denetim 2026-09-22) ─────────────────────────────────────────
 * Kullanıcı "iki farklı Mavi sesi" duyuyordu. Ölçüldü: normal cevap Edge
 * `tr-TR-EmelNeural`, Live cevabı Gemini `Kore`, wake selamı native Android
 * TTS, sabit uyarılar Piper klibi. Motorlar farklı olmak ZORUNDA (Live yalnız
 * Gemini sesleriyle konuşur; Edge yalnız Microsoft sesleriyle) — ama Gemini
 * ailesindeki iki yol (Live ses + Gemini TTS yedeği) iki ayrı dosyada iki ayrı
 * sabit tutuyordu. Bu dosya o seçimi TEK yere indirir.
 *
 * ── SEÇİM GEREKÇESİ ────────────────────────────────────────────────────────
 * Resmi Gemini ses kataloğu (ai.google.dev/gemini-api/docs/speech-generation,
 * 2026-09) 30 ön-tanımlı sesi yalnız KARAKTER etiketiyle listeler; cinsiyet
 * belgelenmez. Live rehberi: "Native audio output models support any of the
 * voices available for our TTS models." Mavi persona sözleşmesi
 * (`buildCompanionSystemPrompt`: "sıcak, senli benli yol arkadaşı") ve Edge
 * tarafındaki Emel karakteri ("premium kadın, sıcak") ile eşleşen belgeli etiket
 * **Sulafat — Warm**'dur. Eski `Kore — Firm` persona sözleşmesiyle çelişiyordu.
 * İşitsel yakınlık cihazda doğrulanmadı (DEVICE PENDING); burada yalnız
 * BELGELİ karakter etiketi esas alınır, uydurma yoktur.
 *
 * ── SINIR ──────────────────────────────────────────────────────────────────
 *  · Yeni TTS kanalı/otoritesi KURMAZ; hiçbir şey import etmez (yaprak).
 *  · Zincir sırası (klip → Edge → Gemini TTS → native) BURADA DEĞİL,
 *    `ttsService.speakAssistant`tedir ve değişmez.
 *  · Edge sesi proxy tarafında (`carospro.com/api/tts`) sabittir; istemci yalnız
 *    metin gönderir. Buradaki `edgeVoice` REFERANS/belgedir, istek parametresi
 *    değildir — "aynı voice id" iddiası üretmez.
 *  · Wake selamı (`wakeWordService` → native `ttsSpeak`) bilinçli olarak dışarıda:
 *    mikrofon yield'ı `nativeTtsSpeaking` bayrağına bağlıdır.
 */

export const MAVI_VOICE_PROFILE = Object.freeze({
  /** BCP-47 — Live `speechConfig.languageCode` ve Edge/TTS isteklerinin dili. */
  language: 'tr-TR',
  /**
   * Gemini ön-tanımlı ses — Gemini Live (native audio) ve Gemini TTS yedeği
   * AYNI sesi kullanır; böylece Gemini ailesinde tek Mavi karakteri duyulur.
   */
  geminiVoice: 'Sulafat',
  /** Edge Neural (proxy tarafında sabit) — yalnız referans. */
  edgeVoice: 'tr-TR-EmelNeural',
} as const);
