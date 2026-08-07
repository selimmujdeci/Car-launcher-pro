/**
 * useCameraFollow — kanonik kamera takip otoritesinin React köprüsü.
 *
 * Otorite (`platform/navigation/cameraFollowAuthority`) React'ten BAĞIMSIZDIR
 * ve saf tutulur (test edilebilirlik); bu hook yalnız abone olur. Yeni durum
 * ÜRETMEZ — tek satırlık bir ayna.
 *
 * Hem `FullMapView` hem `MiniMapWidget` bunu kullanır: iki görünüm AYNI durumu
 * görür, bu yüzden "Ortala" davranışı ikisinde birebir aynıdır.
 */

import { useEffect, useState } from 'react';
import {
  CameraFollowState,
  getCameraFollowState,
  subscribeCameraFollow,
} from '../platform/navigation/cameraFollowAuthority';

export interface CameraFollowView {
  readonly state: CameraFollowState;
  /** Kamera aracı takip ediyor mu (FOLLOWING). */
  readonly following: boolean;
  /** "Ortala" düğmesi gösterilmeli mi. */
  readonly recenterAvailable: boolean;
}

export function useCameraFollow(): CameraFollowView {
  const [state, setState] = useState<CameraFollowState>(() => getCameraFollowState());

  useEffect(() => {
    // Abonelikten ÖNCE bir kez senkronize et — mount ile son değişim arasında
    // kaçan bir geçiş olursa düğme yanlış durumda kalmasın.
    setState(getCameraFollowState());
    return subscribeCameraFollow(setState);
  }, []);

  // Türetme YEREL `state`ten yapılır (modül okumasından DEĞİL): render sırasında
  // modülü okumak, abonelik henüz tetiklenmemişken bayat değer verebilirdi.
  return {
    state,
    following: state === CameraFollowState.FOLLOWING,
    recenterAvailable:
      state === CameraFollowState.USER_PANNING ||
      state === CameraFollowState.FOLLOW_SUSPENDED ||
      state === CameraFollowState.UNKNOWN,
  };
}
