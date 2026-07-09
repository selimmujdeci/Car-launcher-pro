/**
 * useDiscoveryObservations — DiscoveryCaptureService gözlemlerine CANLI abone olan hook.
 *
 * Yeni bir PID/DID yakalandığında servis abonelere bildirir → hook re-render tetikler
 * (uygulamayı yeniden başlatmadan liste güncellenir). Zero-leak: unmount'ta abonelik kaldırılır.
 * SALT-OKUNUR: servisin capture/queue mantığını çağırmaz, yalnız getObservations() okur.
 */

import { useEffect, useState } from 'react';
import {
  discoveryCaptureService,
  type DiscoveryObservation,
} from '../../platform/obd/discovery';

export function useDiscoveryObservations(): DiscoveryObservation[] {
  const [observations, setObservations] = useState<DiscoveryObservation[]>(
    () => discoveryCaptureService.getObservations(),
  );

  useEffect(() => {
    // İlk mount ile abonelik arasında gelen gözlemleri kaçırmamak için bir kez daha oku.
    setObservations(discoveryCaptureService.getObservations());
    const unsubscribe = discoveryCaptureService.subscribe(() => {
      setObservations(discoveryCaptureService.getObservations());
    });
    return unsubscribe; // zero-leak: unmount'ta aboneliği kaldır
  }, []);

  return observations;
}
