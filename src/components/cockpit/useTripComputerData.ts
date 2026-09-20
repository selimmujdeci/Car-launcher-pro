/**
 * useTripComputerData — YOLCULUK BİLGİSAYARI sayfasının KANONİK VERİ ADAPTÖRÜ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EN ÖNEMLİ KURAL: BU DOSYA HİÇBİR ŞEY BAŞLATMAZ ───────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Yeni trip motoru · telemetri · yakıt otoritesi · OBD poll turu · kalıcılık
 * · paralel store AÇILMAZ. Sayfa bir PROJEKSİYONDUR (CLAUDE.md §6).
 *
 * Okunan otoriteler (ikisi de mevcut, hiçbiri bu tur eklenmedi):
 *   yolculuk ölçümleri → `useTripState()`  (`tripLogService` — TEK sahip;
 *                        kendi `onTripState` aboneliğini kurar ve unmount'ta
 *                        bırakır, bu yüzden sayfa ikinci bir dinleyici açmaz)
 *   depo hacmi         → `settings.fuelTankL` (kullanıcı ayarı; yoksa yakıt
 *                        litresi ÜRETİLMEZ)
 *
 * Karar mantığı `tripComputerModel.ts` içinde saf ve test edilebilirdir;
 * burada yalnız kanonik kaynaklar o modele BAĞLANIR.
 */

import { useMemo } from 'react';
import { useTripState } from '../../platform/tripLogService';
import { useStore } from '../../store/useStore';
import { selectTrip, type TripComputerState } from './tripComputerModel';

export function useTripComputerData(): TripComputerState {
  const trip = useTripState();
  /* Depo hacmi ÖLÇÜLMEZ, AKTİF ARAÇ PROFİLİNDE yapılandırılır — üretimdeki
     `useLayoutServices` ile AYNI yol. Yoksa yakıt litresi ve maliyet
     `UNAVAILABLE` kalır; tahmini bir sayı uydurulmaz.

     ARAÇ İZOLASYONU: depo hacmi aktif profile bağlı olduğu için araç
     değiştiğinde bu değer de değişir — eski aracın deposu yeni aracın
     yolculuğuna UYGULANMAZ. */
  const profiles = useStore((s) => s.settings.vehicleProfiles);
  const activeId = useStore((s) => s.settings.activeVehicleProfileId);

  return useMemo(() => {
    const tankL = profiles.find((p) => p.id === activeId)?.fuelTankL;
    return selectTrip(trip, {
      tankL: typeof tankL === 'number' && tankL > 0 ? tankL : null,
    });
  }, [trip, profiles, activeId]);
}
