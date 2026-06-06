/**
 * VolumeGestureLayer — global GÖRÜNMEZ ses kontrolü (şoför tarafı dikey kaydırma).
 *
 * Her sayfada, müzik açık olsun olmasın çalışır. Ekranın SOL (şoför) kenar bandında
 * parmağı yukarı/aşağı kaydırınca sistem sesi (STREAM_MUSIC) artar/azalır.
 *
 * Tasarım — UI'ı ENGELLEMEZ:
 *   • Görünür/engelleyici bir katman YOK. window'a capture-fazında pointer dinleyici
 *     bağlanır; yalnızca "şoför bandında başlayan + dikeyliği baskın" hareket ses
 *     jesti sayılır. O ana kadar tüm dokunuşlar (tap, yatay kaydırma, buton) normal
 *     UI'a geçer.
 *   • Dikey jest doğrulanınca event capture edilir (preventDefault + stopPropagation)
 *     → altdaki liste/slider yanlışlıkla kaymaz; yalnız ses değişir.
 *   • Jest sırasında kısa süreli ses göstergesi belirir (body portal, tam ekran
 *     videonun da üstünde), bırakınca ~700ms sonra kaybolur. "Kontrol" görünmez;
 *     yalnız kullanırken anlık geri bildirim verir.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, VolumeX } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { setVolume } from '../../platform/systemSettingsService';

// Şoför (sol) kenar bandı genişliği — ekran genişliğinin %18'i, 90–220px arası.
const ZONE_RATIO = 0.18;
const ZONE_MIN_PX = 90;
const ZONE_MAX_PX = 220;
// Dikey jest sayılması için minimum hareket (px).
const ENGAGE_PX = 12;
// Ekran yüksekliğinin bu oranı kadar kaydırma = tam 0–100 aralığı.
const FULL_RANGE_RATIO = 0.6;

export function VolumeGestureLayer() {
  const storeVolume    = useStore((s) => s.settings.volume);
  const updateSettings = useStore((s) => s.updateSettings);

  // Jest sırasında gösterilecek ses % (null = gizli).
  const [overlayPct, setOverlayPct] = useState<number | null>(null);

  // Jest durumu — re-render tetiklemeden mutasyon için ref.
  const g = useRef({ armed: false, active: false, startX: 0, startY: 0, startVol: 60, pointerId: -1 });
  // Canlı ses değeri — jest yokken store'dan senkronlanır (aşağıdaki effect).
  const volRef = useRef(storeVolume);
  const hideTimer = useRef<number | null>(null);

  // Açılışta kayıtlı ses düzeyini bir kez motorlara aktar — uygulama içi
  // oynatıcılar (YouTube IFrame / HTML5 stream) kullanıcının son seviyesinde başlasın.
  useEffect(() => {
    setVolume(volRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jest AKTİF değilken store değerini canlı ref'e yansıt (slider'dan değişebilir).
  useEffect(() => {
    if (!g.current.active) volRef.current = storeVolume;
  }, [storeVolume]);

  useEffect(() => {
    const zoneWidth = () => Math.min(ZONE_MAX_PX, Math.max(ZONE_MIN_PX, window.innerWidth * ZONE_RATIO));

    const onDown = (e: PointerEvent) => {
      // Yalnızca sol (şoför) kenar bandında başlayan hareketi izle.
      if (e.clientX > zoneWidth()) { g.current.armed = false; return; }
      g.current = { armed: true, active: false, startX: e.clientX, startY: e.clientY, startVol: volRef.current, pointerId: e.pointerId };
    };

    const onMove = (e: PointerEvent) => {
      const s = g.current;
      if (!s.armed || e.pointerId !== s.pointerId) return;
      const dy = e.clientY - s.startY;
      const dx = e.clientX - s.startX;

      if (!s.active) {
        // Henüz karar verilmedi: önce yatay baskınsa bu jest ses değil → bırak.
        if (Math.abs(dx) > ENGAGE_PX && Math.abs(dx) >= Math.abs(dy)) { s.armed = false; return; }
        // Dikey baskın ve eşiği aştıysa ses jestine gir.
        if (Math.abs(dy) < ENGAGE_PX) return;
        s.active = true;
      }
      // Ses jesti aktif → olayı sahiplen (UI kaymasın).
      e.preventDefault();
      e.stopPropagation();

      const range = window.innerHeight * FULL_RANGE_RATIO;
      const delta = -(dy / range) * 100;                // yukarı (dy<0) → artır
      const next  = Math.round(Math.max(0, Math.min(100, s.startVol + delta)));
      if (next !== volRef.current) {
        volRef.current = next;
        setVolume(next);                                 // sistem sesi (debounce'lı, native)
      }
      setOverlayPct(next);
    };

    const onUp = (e: PointerEvent) => {
      const s = g.current;
      if (e.pointerId !== s.pointerId) return;
      if (s.active) {
        e.stopPropagation();                             // sahte click'i engelle
        // Son değeri store'a bir kez yaz (UI/slider senkronu + kalıcılık).
        updateSettings({ volume: volRef.current });
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setOverlayPct(null), 700);
      }
      g.current = { armed: false, active: false, startX: 0, startY: 0, startVol: volRef.current, pointerId: -1 };
    };

    const optsCapPassive: AddEventListenerOptions = { capture: true, passive: true };
    const optsCapActive:  AddEventListenerOptions = { capture: true, passive: false };
    window.addEventListener('pointerdown',   onDown, optsCapPassive);
    window.addEventListener('pointermove',   onMove, optsCapActive);
    window.addEventListener('pointerup',     onUp,   optsCapPassive);
    window.addEventListener('pointercancel', onUp,   optsCapPassive);
    return () => {
      window.removeEventListener('pointerdown',   onDown, optsCapPassive);
      window.removeEventListener('pointermove',   onMove, optsCapActive);
      window.removeEventListener('pointerup',     onUp,   optsCapPassive);
      window.removeEventListener('pointercancel', onUp,   optsCapPassive);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [updateSettings]);

  if (overlayPct === null) return null;

  // Anlık geri bildirim — sol-orta dikey ses göstergesi (body portal: YT tam ekranın da üstünde).
  return createPortal(
    <div
      style={{
        position: 'fixed', left: 'calc(env(safe-area-inset-left, 0px) + 22px)', top: '50%',
        transform: 'translateY(-50%)', zIndex: 2147483550, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        padding: '18px 14px', borderRadius: 22,
        background: 'rgba(8,10,14,0.6)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
      }}
    >
      {overlayPct === 0 ? <VolumeX className="w-6 h-6" color="#fff" /> : <Volume2 className="w-6 h-6" color="#fff" />}
      {/* Dikey track + dolgu */}
      <div style={{ position: 'relative', width: 8, height: 150, borderRadius: 9999, background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: `${overlayPct}%`,
          background: 'linear-gradient(to top, #3b82f6, #06b6d4)', borderRadius: 9999,
          transition: 'height 0.08s linear',
        }} />
      </div>
      <div style={{ color: '#fff', fontWeight: 900, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{overlayPct}</div>
    </div>,
    document.body,
  );
}
