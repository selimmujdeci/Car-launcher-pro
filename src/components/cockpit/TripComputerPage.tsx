/**
 * TripComputerPage — YOLCULUK BİLGİSAYARI sayfasının BAĞLAMA katmanı.
 *
 * Sunum `TripComputerScreen.tsx`tedir ve platformdan TAMAMEN bağımsızdır.
 * Bu dosya yalnız MEVCUT kanonik kaynakları o sunuma bağlar:
 *   veri  → `useTripComputerData` (yeni abonelik/motor/timer AÇMAZ)
 *   tema  → `settings.dayNightMode` (CarOS'un TEK gün/gece otoritesi)
 *   saat  → `useClock` (HOME başlığıyla AYNI hook — ikinci saat kurulmaz)
 *
 * Sayfa kendi gezinmesine SAHİP DEĞİLDİR: ana ekrana dönüş `onHome` ile
 * sayfa sahibine (`CockpitPager`) devredilir.
 */

import { useStore } from '../../store/useStore';
import { useClock } from '../../hooks/useClock';
import { TripComputerScreen } from './TripComputerScreen';
import { useTripComputerData } from './useTripComputerData';

export interface TripComputerPageProps {
  readonly onHome: () => void;
}

export function TripComputerPage({ onHome }: TripComputerPageProps) {
  const state = useTripComputerData();
  const dayNightMode = useStore((s) => s.settings.dayNightMode);
  const use24Hour = useStore((s) => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, false);

  const mode: 'day' | 'night' = dayNightMode === 'night' ? 'night' : 'day';

  return (
    <TripComputerScreen
      state={state}
      mode={mode}
      clock={{ time, date }}
      onHome={onHome}
    />
  );
}

export default TripComputerPage;
