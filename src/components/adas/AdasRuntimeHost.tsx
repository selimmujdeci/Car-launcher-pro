/**
 * AdasRuntimeHost — Sürüş Asistanı çalışma zamanının yaşam döngüsü (DOM yok).
 *
 * ADAS kapalıyken runtime modülü (kamera kirası, dedektör, modeller) HİÇ
 * yüklenmez — açılış yolu ve bellek etkilenmez. Geri viteste DE bağlı kalır:
 * vites kapısı runtime'ın içindedir (kamerayı bırakır, öğrenilen kalibrasyon
 * ilerlemesi kaybolmaz).
 */
import { useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { logError } from '../../platform/crashLogger';

export function AdasRuntimeHost(): null {
  const enabled = useStore((s) => s.settings.adas?.enabled === true);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    import('../../platform/adas/adasRuntime')
      .then((m) => { if (!cancelled) stop = m.startAdasRuntime(); })
      .catch((err: unknown) => logError('AdasRuntimeHost:load', err));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [enabled]);

  return null;
}
