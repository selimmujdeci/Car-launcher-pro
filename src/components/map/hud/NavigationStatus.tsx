/**
 * NavigationStatus — P0-NAV-04 · HUD durumunun TEK sakin şeridi.
 *
 * ── NEDEN TEK ŞERİT ───────────────────────────────────────────────────────
 * Eskiden durum bilgisi üç ayrı yerden bağırıyordu: `ReroutingBanner` (üst
 * orta, tam kart), `GPS ±2m` rozeti (manevra kartının üstüne binen çip) ve
 * dürüstlük cipleri (alt bar). Üçü aynı anda çıkabiliyordu.
 *
 * Artık **baskın durum tektir** (`hudPresentationModel` seçer) ve tek satırda
 * görünür. Görev şartı: *"dürüstlük uyarıları sürekli büyük alarm gibi
 * haritayı işgal etmesin"* — bu yüzden şerit ince, üst-orta ve `NOTICE`
 * tonunda; yalnız `GPS_DEGRADED` (gerçek güvenlik sinyali) `ALERT` tonundadır.
 *
 * Hüküm ÜRETMEZ: durum ve ton dışarıdan gelir.
 */

import { memo } from 'react';
import { AlertTriangle, Loader2, SatelliteDish, Route } from 'lucide-react';
import {
  HUD_STATE_LABEL, type HudPresentation,
} from '../../../platform/navigation/core/hudPresentationModel';

const TONE_STYLE = {
  NOTICE: {
    color: 'var(--oem-ink-2, rgba(240,235,224,0.80))',
    background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
    borderColor: 'var(--oem-line-strong, rgba(255,240,210,0.18))',
  },
  ALERT: {
    color: 'var(--oem-warn)',
    background: 'var(--oem-warn-soft)',
    borderColor: 'var(--oem-warn)',
  },
} as const;

function _icon(state: HudPresentation['state']) {
  switch (state) {
    case 'REROUTING':      return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    case 'GPS_DEGRADED':   return <SatelliteDish className="w-3.5 h-3.5" />;
    case 'ROUTE_DEGRADED': return <Route className="w-3.5 h-3.5" />;
    default:               return <AlertTriangle className="w-3.5 h-3.5" />;
  }
}

export const NavigationStatus = memo(function NavigationStatus({ hud }: { hud: HudPresentation }) {
  if (!hud.showStatus) return null;
  const tone = hud.tone === 'ALERT' ? TONE_STYLE.ALERT : TONE_STYLE.NOTICE;

  return (
    <div
      data-testid="navigation-status"
      data-hud-state={hud.state}
      data-hud-tone={hud.tone}
      className="absolute z-[var(--z-map-hud)] pointer-events-none flex items-center gap-2 rounded-full"
      style={{
        top: 'calc(var(--sat, 0px) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '5px 12px',
        maxWidth: 'calc(100vw - 32px)',
        border: `1px solid ${tone.borderColor}`,
        background: tone.background,
        color: tone.color,
        backdropFilter: 'blur(calc(var(--rt-blur, 1) * 16px))',
        WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 16px))',
      }}
    >
      {_icon(hud.state)}
      <span
        className="truncate"
        style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em' }}
      >
        {HUD_STATE_LABEL[hud.state]}
      </span>
      {/* Gerekçe erişilebilirlik metnidir; ekranda yer kaplamaz. */}
      <span className="sr-only">{hud.reason}</span>
    </div>
  );
});
