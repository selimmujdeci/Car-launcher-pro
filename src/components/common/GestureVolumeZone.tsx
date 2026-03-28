/**
 * GestureVolumeZone — ekran kenarından dikey swipe ile ses kontrolü.
 *
 * Sadece kenar bölgesinden (EDGE_ZONE_PX genişliğinde) başlayan gesture'ları
 * yakalar — harita ve diğer dokunmatik alanlarla çakışmaz.
 *
 * Yukarı swipe → ses artar | Aşağı swipe → ses azalır
 *
 * Görsel geri bildirim: mevcut VolumeOverlay bileşeni settings.volume
 * değişince otomatik görünür — burada ayrıca overlay yönetimi gerekmez.
 */
import { memo, useRef, useCallback, useEffect } from 'react';
import { setVolume } from '../../platform/systemSettingsService';

/* ── Sabitler ─────────────────────────────────────────────── */

/** Kenar hit zone genişliği (px) */
const EDGE_ZONE_PX = 60;

/** Kaç piksel swipe = 1% ses değişimi */
const PX_PER_PCT = 2.8;

/**
 * Minimum dikey hareket — bu değerden önce gesture aktif olmaz.
 * Yanlışlıkla tetiklenmeyi önler (küçük titreme, yatay kaydırma).
 */
const MIN_VERTICAL_PX = 14;

/* ── Bileşen ─────────────────────────────────────────────── */

interface Props {
  side: 'left' | 'right';
  volume: number;
  onVolumeChange: (v: number) => void;
}

export const GestureVolumeZone = memo(function GestureVolumeZone({
  side,
  volume,
  onVolumeChange,
}: Props) {
  /* Ref'ler — pointer event handler'larını yeniden oluşturmadan güncel tut */
  const pointerIdRef  = useRef<number | null>(null);
  const startYRef     = useRef(0);
  const baseVolRef    = useRef(0);
  const activatedRef  = useRef(false);  // min eşiği geçti mi?
  const rafRef        = useRef<number | null>(null);
  const volRef        = useRef(volume);

  useEffect(() => { volRef.current = volume; }, [volume]);

  /* Throttled volume apply — gesture sırasında max 60fps güncelleme */
  const applyVolume = useCallback((raw: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(raw)));
    if (rafRef.current !== null) return; // önceki frame bekleniyor
    rafRef.current = requestAnimationFrame(() => {
      onVolumeChange(clamped);
      setVolume(clamped);      // native sistem sesi
      rafRef.current = null;
    });
  }, [onVolumeChange]);

  /* Pointer down — takibi başlat */
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== null) return; // zaten takip var
    pointerIdRef.current  = e.pointerId;
    startYRef.current     = e.clientY;
    baseVolRef.current    = volRef.current;
    activatedRef.current  = false;
    // Pointer capture: div dışına çıksa bile move/up olaylarını al
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }, []);

  /* Pointer move — ses hesapla */
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointerIdRef.current) return;

    const deltaY = startYRef.current - e.clientY; // pozitif = yukarı swipe

    // Minimum hareket eşiğine ulaşmadan aktif etme
    if (!activatedRef.current) {
      if (Math.abs(deltaY) < MIN_VERTICAL_PX) return;
      activatedRef.current = true;
    }

    applyVolume(baseVolRef.current + deltaY / PX_PER_PCT);
    e.stopPropagation();
  }, [applyVolume]);

  /* Pointer up / cancel — takibi sonlandır */
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointerIdRef.current) return;
    pointerIdRef.current = null;
    activatedRef.current = false;
    e.stopPropagation();
  }, []);

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position:         'fixed',
        top:              0,
        bottom:           0,
        [side]:           0,
        width:            EDGE_ZONE_PX,
        zIndex:           40,   // VolumeOverlay (z-100) üstünde değil — sadece input
        touchAction:      'none', // tarayıcı scroll/pinch engagement önle
        userSelect:       'none',
        WebkitUserSelect: 'none',
      }}
    />
  );
});
