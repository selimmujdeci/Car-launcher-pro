/**
 * voiceOverlayFollowUpClose.test.ts — REGRESYON KİLİDİ (saha bug 2026-07-03).
 *
 * Şikayet: "asistana bir şey soruyorum, o da bana soru soruyor; ben cevap
 * vereceğim ama pencere sorunun cevabını beklemeden kapanıyor."
 *
 * Kök neden: VoiceAssistant overlay/pill otomatik-kapanma efektleri success
 * (2200/1800ms) ve error (3000ms) durumlarında pencereyi kapatırken `followUp`
 * bayrağını YOK SAYIYORDU. Asistan bir soru sorup cevap beklerken (companion
 * sohbeti ya da "bunu mu demek istedin?" onayı) followUp=true olur; TTS bitince
 * mikrofon yeniden açılır. Otokapat bundan önce tetiklenince cevap alınamıyordu.
 *
 * KİLİT: followUp KURULUYKEN pencere ASLA otomatik kapanmaz. Bu kilidi
 * ZAYIFLATMA/SİLME (CLAUDE.md §Regresyon Kasası) — followUp bayrağı bilinçli
 * kaldırılırsa bu testi yeni doğru davranışa GÜNCELLE.
 */
import { describe, it, expect } from 'vitest';
import { voiceOverlayShouldAutoClose } from '../components/modals/VoiceAssistant';

describe('VoiceAssistant otomatik-kapanma — followUp kilidi', () => {
  it('followUp=true → pencere OTOMATİK KAPANMAZ (cevap bekleniyor)', () => {
    // Asistan soru sordu, mikrofon cevap için yeniden açılacak → kapatma yok.
    expect(voiceOverlayShouldAutoClose(true)).toBe(false);
  });

  it('followUp=false → normal otomatik kapanma korunur', () => {
    // Sohbet döngüsü yok (tek seferlik komut/cevap) → success/error/idle kapanır.
    expect(voiceOverlayShouldAutoClose(false)).toBe(true);
  });
});
