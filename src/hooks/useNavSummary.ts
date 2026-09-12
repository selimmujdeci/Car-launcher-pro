/**
 * useNavSummary — ana ekran harita kartındaki rota özeti için TEK kaynak.
 *
 * SAHA 2026-08-02: Expedition/Pro/Tesla yerleşimlerinde bu chip'e sabit
 * `2.4 km / Sahil Yolu Cd.` YAZILMIŞTI — hiçbir kaynağa bağlı değildi. Gerçek
 * rota "71.1 km / Mersin-Antalya Yolu" derken kart bunu gösteriyordu.
 *
 * KURAL: kanıtsız bilgi ÜRETİLMEZ. Aktif rota yoksa `null` döner ve çağıran
 * chip'i HİÇ göstermez — sahte hedef/mesafe uydurulmaz. Mesafe bilinmiyorsa
 * hedef adı yine gösterilir, mesafe yerine `—` yazılır.
 *
 * Yeni mesafe/rota otoritesi KURMAZ: yalnız `navigationService`'in
 * `useNavigation()` sözleşmesini okur.
 */

import { useNavigation } from '../platform/navigationService';

export interface NavSummary {
  /** tr-TR, tek ondalık: `71,1` · mesafe bilinmiyorsa `—`. */
  readonly mesafe: string;
  /** Hedef adı — boşsa `Hedef`. */
  readonly hedef: string;
  /**
   * Mesafe rota boyu mu ölçüldü, kuş uçuşu mu tahmin edildi (kütük #404).
   * Sahada örneklerin %38'i kuş uçuşuydu ama ekranda gerçek kalan mesafeyle
   * aynı kesinlikte gösteriliyordu. `true` iken çağıran `~` ön eki koyar.
   */
  readonly yaklasik: boolean;
}

/** tr-TR tek ondalık; Intl yoksa manuel (eski WebView). */
function _km(meters: number): string {
  const km = meters / 1000;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function') {
      return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km);
    }
  } catch { /* manuel fallback */ }
  const fixed = (Math.round(km * 10) / 10).toFixed(1);
  const [i, d] = fixed.split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`;
}

export function useNavSummary(): NavSummary | null {
  const { isNavigating, destination, distanceMeters, distanceSource } = useNavigation();

  if (!isNavigating || !destination) return null;

  const gecerliMesafe =
    typeof distanceMeters === 'number' && Number.isFinite(distanceMeters) && distanceMeters >= 0;

  // Kütük #404: kuş uçuşu değer, rota boyu ölçümmüş gibi sunulmaz.
  const yaklasik = gecerliMesafe && distanceSource !== 'ALONG_ROUTE';

  return {
    mesafe: gecerliMesafe ? `${yaklasik ? '~' : ''}${_km(distanceMeters)}` : '—',
    hedef: (destination.name || '').trim() || 'Hedef',
    yaklasik,
  };
}
