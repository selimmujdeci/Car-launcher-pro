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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useClock } from '../../hooks/useClock';
import { togglePlayPause } from '../../platform/mediaService';
import { next as mediaNext, previous as mediaPrevious } from '../../platform/media/carosMediaLayer';
import { DigitalCockpitScreen } from './DigitalCockpitScreen';
import { useCockpitData } from './useCockpitData';
import {
  COCKPIT_ACCENT_LABELS, COCKPIT_STYLE_LABELS, cockpitSurfaceMode, cockpitTokensFor, nextCockpitAccent, nextCockpitStyle,
} from './cockpitLayout';

/** Görünüm adı bildirimi ekranda kalma süresi. */
const STYLE_TOAST_MS = 1400;

export function DigitalCockpitPage() {
  const state = useCockpitData();
  const dayNightMode = useStore((s) => s.settings.dayNightMode);
  const use24Hour = useStore((s) => s.settings.use24Hour);
  const cockpitStyle = useStore((s) => s.settings.cockpitStyle);
  const cockpitAccent = useStore((s) => s.settings.cockpitAccent);
  const { time, date } = useClock(use24Hour, false);

  const onPrev = useCallback(() => { void mediaPrevious(); }, []);
  const onNext = useCallback(() => { void mediaNext(); }, []);
  const onToggle = useCallback(() => { togglePlayPause(); }, []);

  const mode: 'day' | 'night' = dayNightMode === 'night' ? 'night' : 'day';

  /* Görünüm değiştir (kullanıcı isteği 2026-09-27): sürüşte de TEK dokunuş —
     menü/onay yok, sıradaki görünüme geçer ve adı kısa süre görünür. Yalnız
     görünüm ayarını yazar (tek sahip: ayar deposu); araç verisine dokunmaz. */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), STYLE_TOAST_MS);
  }, []);
  const cycleStyle = useCallback(() => {
    const next = nextCockpitStyle(useStore.getState().settings.cockpitStyle);
    useStore.getState().updateSettings({ cockpitStyle: next });
    showToast(COCKPIT_STYLE_LABELS[next]);
  }, [showToast]);
  /* Renk de aynı şekilde (2026-09-28): Ayarlar'daki seçici kaldırıldı, rengin
     tek giriş noktası burası. */
  const cycleAccent = useCallback(() => {
    const next = nextCockpitAccent(useStore.getState().settings.cockpitAccent);
    useStore.getState().updateSettings({ cockpitAccent: next });
    showToast(COCKPIT_ACCENT_LABELS[next]);
  }, [showToast]);
  /* Düğme ve bildirim, görünümün GERÇEK zeminine göre renklenir: imza
     görünümler gündüz de koyu çizildiği için gündüz renkli düğme koyu zeminde
     kayboluyordu (saha 2026-09-28, Neon · gündüz). */
  const night = cockpitSurfaceMode(cockpitStyle, mode) === 'night';
  // Bilinmeyen/eski bir görünüm kimliği etiketsiz kalmasın (ekran zaten 'road'a düşer).
  const styleLabel = COCKPIT_STYLE_LABELS[cockpitStyle] ?? COCKPIT_STYLE_LABELS.road;
  const accentLabel = COCKPIT_ACCENT_LABELS[cockpitAccent] ?? COCKPIT_ACCENT_LABELS.blue;
  const swatch = cockpitTokensFor(night ? 'night' : 'day', cockpitAccent).accent;
  const ctrl = (top: string): React.CSSProperties => ({
    position: 'absolute', left: '2.2%', top, width: 72, height: 72, borderRadius: 22,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
    background: night ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
    border: `1px solid ${night ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`,
    color: night ? 'rgba(255,255,255,0.86)' : 'rgba(0,0,0,0.78)', cursor: 'pointer',
  });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <DigitalCockpitScreen
      state={state}
      mode={mode}
      clock={{ time, date }}
      onMediaPrevious={onPrev}
      onMediaToggle={onToggle}
      onMediaNext={onNext}
      styleId={cockpitStyle}
      accent={cockpitAccent}
    />
    <button type="button" data-no-page-swipe data-testid="cockpit-style-switch"
      onClick={cycleStyle} onPointerDown={(e) => e.stopPropagation()}
      aria-label={`Sürüş ekranı görünümünü değiştir (şu an ${styleLabel})`}
      className="active:scale-95" style={ctrl('3.5%')}>
      <Layers style={{ width: 28, height: 28 }} aria-hidden="true" />
      <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>{styleLabel}</span>
    </button>
    <button type="button" data-no-page-swipe data-testid="cockpit-accent-switch"
      onClick={cycleAccent} onPointerDown={(e) => e.stopPropagation()}
      aria-label={`Sürüş ekranı rengini değiştir (şu an ${accentLabel})`}
      className="active:scale-95" style={ctrl('calc(3.5% + 84px)')}>
      <span aria-hidden="true" style={{
        width: 26, height: 26, borderRadius: 999, background: swatch,
        boxShadow: `0 0 0 3px ${night ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)'}`,
      }} />
      <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1, marginTop: 4 }}>{accentLabel}</span>
    </button>
    {toast && (
      <div role="status" data-testid="cockpit-style-toast"
        style={{
          position: 'absolute', left: '50%', top: '14%', transform: 'translateX(-50%)', pointerEvents: 'none',
          padding: '10px 26px', borderRadius: 999, fontSize: 26, fontWeight: 700, letterSpacing: '0.04em',
          background: night ? 'rgba(10,14,22,0.82)' : 'rgba(255,255,255,0.9)',
          color: night ? '#fff' : '#111', border: `1px solid ${night ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)'}`,
        }}>
        {toast}
      </div>
    )}
    </div>
  );
}

export default DigitalCockpitPage;
