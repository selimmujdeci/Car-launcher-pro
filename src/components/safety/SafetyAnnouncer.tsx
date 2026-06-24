/**
 * SafetyAnnouncer — Safety Assistant FAZ 3B
 *
 * Görsel DOM üretmeyen, effect tabanlı bileşen.
 * useSafetyAlerts() çıktısını dinler → çekirdeğe iletir → TTS + chime.
 *
 * Neden null render:
 *  - Ses kararı tamamen effect katmanında; UI payload yok.
 *  - SafetyOverlay'den bağımsız: aynı hook iki kez çağrılır (bkz. Risk notu).
 *
 * Mount noktası: App.tsx içinde SafetyOverlay yanına, ErrorBoundary içinde.
 */

import { useEffect, useRef } from 'react';
import { useSafetyAlerts } from '../../platform/safety/useSafetyAlerts';
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

  // useSafetyAlerts: kendi queue/ticker'ını yönetir
  // NOT: SafetyOverlay da aynı hook'u çağırır → iki ayrı queue instance
  // (bkz. safetyAnnouncerCore.ts; FAZ 4'te tek context ile birleştirilmeli)
  const output = useSafetyAlerts();

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
