import { useEffect, useRef } from 'react';
import { setDrivingMode } from '../platform/mapService';
import { getNavigationState } from '../platform/navigationService';
import { useDisplaySpeed } from './useDisplaySpeed';
import type { AppSettings } from '../store/useStore';

interface UseDriveModeDetectionParams {
  settings: AppSettings;
}

/** Bu hızın üstünde 3 sn kalınca harita sürüş görünümüne geçer. */
export const DRIVE_MODE_ACTIVATE_KMH = 15;
export const DRIVE_MODE_ACTIVATE_MS  = 3_000;
/** Bu hızın altında 30 sn kalınca (park benzeri duruş) sürüş görünümünden çıkılır. */
export const DRIVE_MODE_STOP_KMH     = 3;
export const DRIVE_MODE_DEACTIVATE_MS = 30_000;

type Band = 'unknown' | 'high' | 'mid' | 'stopped';

function bandOf(speedKmh: number | null): Band {
  if (speedKmh === null || !Number.isFinite(speedKmh)) return 'unknown';
  if (speedKmh > DRIVE_MODE_ACTIVATE_KMH) return 'high';
  if (speedKmh < DRIVE_MODE_STOP_KMH) return 'stopped';
  return 'mid';
}

/**
 * Hıza göre otomatik harita sürüş görünümü (Ayarlar → Smart Engine).
 *
 * Eski sürümün iki kusuru vardı:
 *  1. Efekt temizliği HER hız güncellemesinde zamanlayıcıları siliyordu → GPS
 *     saniyede bir güncellendiği için 3 sn'lik aktivasyon HİÇ tetiklenmiyordu.
 *  2. Hız bilinmiyorsa (`null`) 0 sayılıp `setDrivingMode(false)` yazılıyordu;
 *     kırmızı ışıkta 2 sn durmak aktif navigasyonda bile sürüş görünümünü kapatıyordu.
 *
 * Şimdi: kanonik hız (`useDisplaySpeed`); yalnız BANT GEÇİŞİNDE zamanlayıcı kurulur
 * (bant aynı kaldıkça çalışan zamanlayıcı korunur, kullanıcının elle seçimi bir
 * sonraki geçişe kadar ezilmez); bilinmeyen hız hiçbir şey yazmaz; rehberlik
 * sürerken sürüş görünümü kapatılmaz (o sırada otorite navigasyondur).
 */
export function useDriveModeDetection({ settings }: UseDriveModeDetectionParams): void {
  const speedKmh = useDisplaySpeed();
  const enabled = settings.smartContextEnabled ?? true;
  const bandRef  = useRef<Band>('unknown');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
    if (!enabled) { clear(); bandRef.current = 'unknown'; return; }

    const band = bandOf(speedKmh);
    if (band === bandRef.current) return;   // aynı bant → bekleyen zamanlayıcı sürer
    bandRef.current = band;
    clear();

    if (band === 'high') {
      timerRef.current = setTimeout(() => { timerRef.current = null; setDrivingMode(true); }, DRIVE_MODE_ACTIVATE_MS);
    } else if (band === 'stopped') {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (getNavigationState().isGuidanceActive) return;
        setDrivingMode(false);
      }, DRIVE_MODE_DEACTIVATE_MS);
    }
  }, [speedKmh, enabled]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
}
