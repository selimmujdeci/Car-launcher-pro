/**
 * SafetyAnnouncer — Safety Assistant FAZ 3B / FAZ 4A
 *
 * Görsel DOM üretmeyen, effect tabanlı bileşen.
 * useSafetyContext() çıktısını dinler → çekirdeğe iletir → TTS + chime.
 *
 * Neden null render:
 *  - Ses kararı tamamen effect katmanında; UI payload yok.
 *  - FAZ 4A: SafetyProvider üzerinden tek queue/ticker instance paylaşılır;
 *    SafetyOverlay ile artık ayrı instance YOK.
 *
 * Mount noktası: App.tsx içinde SafetyProvider altında, SafetyOverlay yanında.
 */

import { useEffect, useRef } from 'react';
import { useSafetyContext } from './SafetyContext';
import {
  createSafetyAnnouncerCore,
} from '../../platform/safety/safetyAnnouncerCore';
import type { SafetyAnnouncer as ISafetyAnnouncer } from '../../platform/safety/safetyAnnouncerCore';

/**
 * Ses duyuru bileşeni — `null` render eder, DOM üretmez.
 *
 * Lifecycle:
 *  - Mount: çekirdek instance oluşturulur (useRef).
 *  - voiceAnnouncementAlert.ruleId değişince effect → announce().
 *  - Unmount: dispose() → sonraki announce no-op.
 */
export function SafetyAnnouncer(): null {
  // Çekirdek instance: her render'da yeniden oluşturulmaz
  const coreRef = useRef<ISafetyAnnouncer | null>(null);
  if (coreRef.current === null) {
    coreRef.current = createSafetyAnnouncerCore();
  }

  // useSafetyContext: SafetyProvider'ın tek queue/ticker instance'ından gelir (FAZ 4A).
  // Artık iki ayrı instance yok — SafetyOverlay ile aynı output paylaşılır.
  const { output } = useSafetyContext();

  // voiceAnnouncementAlert.ruleId değişince duyuru yap
  // undefined (null tick) de effect'i tetikler → lastRuleId sıfırlanır
  useEffect(() => {
    coreRef.current?.announce(output);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output.voiceAnnouncementAlert?.ruleId]);

  // Unmount temizliği
  useEffect(() => {
    return () => {
      coreRef.current?.dispose();
    };
  }, []);

  return null;
}
