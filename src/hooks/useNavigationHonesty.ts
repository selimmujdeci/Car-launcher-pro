/**
 * useNavigationHonesty — P0-NAV-02 · dürüstlük hükmünün TEK UI girişi.
 *
 * `useEffectiveSpeedLimit` ile AYNI desen: **yeni veri kaynağı değildir.**
 * Üç MEVCUT otoriteyi okur ve saf `navigationHonestyModel`e verir:
 *
 *   1. `navigationService`  → `distanceSource`   (kalan mesafe nasıl bulundu)
 *   2. `navigationService`  → `getEtaVerdict()`  (ETA hangi modelden geldi)
 *   3. `routingService`     → `validation.verdict` (rota doğrulama hükmü)
 *
 * Timer KURMAZ · ağa ÇIKMAZ · sayı HESAPLAMAZ · ikinci otorite KURMAZ.
 *
 * ── `getEtaVerdict()` NEDEN ABONELİKSİZ OKUNUYOR ──────────────────────────
 * ETA hükmü `navigationService` içinde modül düzeyinde tutulur; store alanı
 * DEĞİLDİR. Onu store'a taşımak ikinci bir otorite/senkron noktası yaratırdı.
 * Bunun yerine değer RENDER sırasında okunur: bu hook'u çağıran yüzeyler zaten
 * `useRouteState()`e abonedir ve rota ilerleme tick'i (her GPS fix'i) store'u
 * güncelleyip yeniden render tetikler — hüküm en fazla bir tick geride kalır.
 * Aynı okuma deseni `useEffectiveSpeedLimit`in `getSnappedMarkerPosition()`
 * çağrısında da kullanılır (mevcut sözleşme).
 */

import { useNavigation, NavStatus, getEtaVerdict } from '../platform/navigationService';
import { useRouteState } from '../platform/routingService';
import {
  evaluateNavigationHonesty, HONEST_SILENT,
  type NavigationHonestyVerdict, type HonestyDistanceSource,
} from '../platform/navigation/core/navigationHonestyModel';

/**
 * Sürüş yüzeyinin dürüstlük hükmü.
 *
 * Sayı gösterilmeyen durumlarda (`IDLE` / `ARRIVED` / `ERROR`) sessiz döner.
 */
export function useNavigationHonesty(): NavigationHonestyVerdict {
  const { status, distanceSource } = useNavigation();
  const route = useRouteState();

  const numbersVisible =
    status === NavStatus.ACTIVE ||
    status === NavStatus.REROUTING ||
    status === NavStatus.PREVIEW ||
    status === NavStatus.ROUTING;

  if (!numbersVisible) return HONEST_SILENT;

  /* Fail-soft: hüküm okunamazsa `UNKNOWN` girdi üretilir — model onu
     "doğrulanmadı" olarak işaretler, sessizce KESİN saymaz. */
  let etaState: ReturnType<typeof getEtaVerdict>['state'] = 'UNKNOWN';
  let etaSource: ReturnType<typeof getEtaVerdict>['source'] = 'NONE';
  try {
    const v = getEtaVerdict();
    etaState = v.state;
    etaSource = v.source;
  } catch { /* fail-soft */ }

  return evaluateNavigationHonesty({
    numbersVisible: true,
    distanceSource: (distanceSource ?? null) as HonestyDistanceSource | null,
    etaState,
    etaSource,
    routeVerdict: route.validation?.verdict ?? 'UNKNOWN',
  });
}
