/**
 * useTripComputerData — YOLCULUK BİLGİSAYARI sayfasının KANONİK VERİ ADAPTÖRÜ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EN ÖNEMLİ KURAL: BU DOSYA HİÇBİR ŞEY BAŞLATMAZ ───────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Yeni trip motoru · telemetri · yakıt otoritesi · OBD poll turu · kalıcılık
 * · paralel store AÇILMAZ. Sayfa bir PROJEKSİYONDUR (CLAUDE.md §6).
 *
 * Okunan otoriteler (hiçbiri bu tur ÜRETİLMEDİ — hepsi zaten vardı):
 *   seyahat oturumu    → `readTripSessionOrNull()` (`tripSessionService` —
 *                        segmentleri TEK yolculuğa toplayan kanonik katman;
 *                        depolama segmenti kullanıcı yolculuğu DEĞİLDİR)
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
import { useClock } from '../../hooks/useClock';
import { useTripState } from '../../platform/tripLogService';
/* Seyahat oturumu — SIFIR BAĞIMLILIKLI ince kapı (yeni abonelik/servis
   başlatmaz). Kayıt yoksa `null` döner ve sayfa eski davranışına düşer. */
import { readTripSessionOrNull } from '../../platform/trip/tripSessionAccess';
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
  /* MOLADA `onTripState` YAYINI YOKTUR (aktif yolculuk yok → 5 sn tick yok);
     oysa oturumun geçen süresi ve süren molası zamanla büyür ve OKUMA ANINDA
     türetilir. Mevcut dakika saati (`useClock`, saniyesiz → 10 sn aralık)
     memo'yu dakikada bir tazeler — yeni zamanlayıcı türü/otorite KURULMAZ. */
  const { time: minuteTick } = useClock(true, false);

  return useMemo(() => {
    const tankL = profiles.find((p) => p.id === activeId)?.fuelTankL;
    /* Oturum okuma anında türetilir; `trip` yayını (aktifken 5 sn) ve dakika
       saati (molada) bu memo'yu tazeler. */
    const session = readTripSessionOrNull();
    return selectTrip(trip, {
      tankL: typeof tankL === 'number' && tankL > 0 ? tankL : null,
    }, session);
  /* `minuteTick` değeri kullanılmaz; yalnız okuma anını ilerletir (oturum
     projeksiyonu `readTripSessionOrNull` içinde saatten türetilir). */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, profiles, activeId, minuteTick]);
}
