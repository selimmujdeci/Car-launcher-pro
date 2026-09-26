/**
 * ObdLivePage — OBD CANLI VERİLERİ sayfasının BAĞLAMA katmanı.
 *
 * Sunum `ObdLiveScreen.tsx`tedir ve platformdan TAMAMEN bağımsızdır.
 * Bu dosya yalnız MEVCUT kanonik kaynakları o sunuma bağlar:
 *   veri  → `useObdLiveData` (yeni abonelik/poll/timer AÇMAZ)
 *   tema  → `settings.dayNightMode` (CarOS'un TEK gün/gece otoritesi)
 *   saat  → `useClock` (HOME başlığıyla AYNI hook — ikinci saat kurulmaz)
 *
 * Sayfa kendi gezinmesine SAHİP DEĞİLDİR: ana ekrana dönüş `onHome` ile
 * sayfa sahibine (`CockpitPager`) devredilir — ikinci bir gezinme otoritesi
 * kurulmaz (CLAUDE.md §6).
 */

import { useStore } from '../../store/useStore';
import { useClock } from '../../hooks/useClock';
import { ObdLiveScreen } from './ObdLiveScreen';
import { useObdLiveData } from './useObdLiveData';

export interface ObdLivePageProps {
  /** Ana ekrana dönüş — sayfanın sahibi uygular. */
  readonly onHome: () => void;
}

export function ObdLivePage({ onHome }: ObdLivePageProps) {
  const state = useObdLiveData();
  const dayNightMode = useStore((s) => s.settings.dayNightMode);
  const use24Hour = useStore((s) => s.settings.use24Hour);
  const { time, date } = useClock(use24Hour, false);

  const mode: 'day' | 'night' = dayNightMode === 'night' ? 'night' : 'day';

  return (
    <ObdLiveScreen
      state={state}
      mode={mode}
      clock={{ time, date }}
      onHome={onHome}
    />
  );
}

export default ObdLivePage;
