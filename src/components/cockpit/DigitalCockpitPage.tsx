/**
 * DigitalCockpitPage — Digital Cockpit'in BAĞLAMA katmanı.
 *
 * Sunum `DigitalCockpitScreen.tsx`tedir ve platformdan TAMAMEN bağımsızdır.
 * Bu dosya yalnız MEVCUT kanonik kaynakları o sunuma bağlar:
 *   veri  → `useCockpitData` (yeni abonelik/timer AÇMAZ)
 *   tema  → `settings.dayNightMode` (CarOS'un TEK gün/gece otoritesi)
 *   saat  → `useClock` (HOME başlığıyla AYNI hook — ikinci saat kurulmaz)
 *   müzik → `carosMediaLayer` + `mediaService` (kanonik transport)
 *
 * Kokpit ikinci bir oynatıcı/navigasyon/araç otoritesi KURMAZ; yalnız var olanı
 * sürer ve okur.
 */

import { useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { useClock } from '../../hooks/useClock';
import { togglePlayPause } from '../../platform/mediaService';
import { next as mediaNext, previous as mediaPrevious } from '../../platform/media/carosMediaLayer';
import { DigitalCockpitScreen } from './DigitalCockpitScreen';
import { useCockpitData } from './useCockpitData';

export function DigitalCockpitPage() {
  const state = useCockpitData();
  const dayNightMode = useStore((s) => s.settings.dayNightMode);
  const use24Hour = useStore((s) => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, false);

  const onPrev = useCallback(() => { void mediaPrevious(); }, []);
  const onNext = useCallback(() => { void mediaNext(); }, []);
  const onToggle = useCallback(() => { togglePlayPause(); }, []);

  const mode: 'day' | 'night' = dayNightMode === 'night' ? 'night' : 'day';

  return (
    <DigitalCockpitScreen
      state={state}
      mode={mode}
      clock={{ time, date }}
      onMediaPrevious={onPrev}
      onMediaToggle={onToggle}
      onMediaNext={onNext}
    />
  );
}

export default DigitalCockpitPage;
