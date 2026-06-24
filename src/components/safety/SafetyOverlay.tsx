/**
 * SafetyOverlay — FAZ 3A
 *
 * İKİ export:
 *  - SafetyOverlayView: saf presentational (hook/store yok) — server render + test edilir.
 *  - SafetyOverlay: bağlı bileşen — useSafetyAlerts() çağırır, View'a iletir.
 *
 * K24 / Chrome 64-78 KISITLARI:
 *  - Blur YOK, backdrop-filter YOK.
 *  - inset-0 KULLANILMAZ → top-0 left-0 right-0 bottom-0 kullan.
 *  - clamp(), aspect-ratio, dvh KULLANILMAZ.
 *  - Animasyon YOK (transition-opacity tek geçiş max.).
 *  - Renkler solid, yüksek kontrast.
 *
 * Reverse politikası:
 *  - Geri vites tamamen App.tsx içindeki ReversePriorityOverlay (z-[100000])
 *    sorumluluğundadır. SafetyOverlay reverse aktifken HİÇBİR ŞEY render etmez
 *    (banner/ikon dahil) → çift katman / fazladan paint yok.
 *
 * Z-Index hiyerarşisi:
 *  - Banner / ikon şeridi: z-[9000]
 */

import {
  AlertTriangle,
  BatteryWarning,
  Camera,
  Car,
  CircleParking,
  DoorOpen,
  Fuel,
  Lightbulb,
  ShieldAlert,
  Thermometer,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { ComponentType, ReactElement } from 'react';
import { useSafetyContext } from './SafetyContext';
import type { SafetyAlert, SafetyQueueOutput } from '../../platform/safety/types';

// ── İkon eşleme tablosu ───────────────────────────────────────────────────────

const ICON_MAP: Record<string, ComponentType<LucideProps>> = {
  door:         DoorOpen,
  parkingBrake: CircleParking,
  temp:         Thermometer,
  seatbelt:     ShieldAlert,
  hood:         Car,
  headlights:   Lightbulb,
  fuel:         Fuel,
  battery:      BatteryWarning,
  reverse:      Camera,
};

function resolveIcon(iconKey: string): ComponentType<LucideProps> {
  return ICON_MAP[iconKey] ?? AlertTriangle;
}

// ── Seviye renk yardımcıları ──────────────────────────────────────────────────

function bannerClasses(level: SafetyAlert['level']): string {
  if (level === 'critical') {
    return 'bg-red-600 text-white';
  }
  // warning
  return 'bg-amber-500 text-black';
}

function iconColor(level: SafetyAlert['level']): string {
  if (level === 'critical') return 'text-red-400';
  if (level === 'warning')  return 'text-amber-400';
  return 'text-blue-400';
}

// ── Saf presentational bileşen ────────────────────────────────────────────────

/**
 * SafetyOverlayView — hook/store YOK. Yalnızca output'tan render.
 * react-dom/server ile test edilebilir.
 */
export function SafetyOverlayView({ output }: { output: SafetyQueueOutput }): ReactElement | null {
  const { visibleAlerts, primaryBannerAlert } = output;

  // Hiçbir şey yoksa → null (DOM üretme)
  if (visibleAlerts.length === 0 && primaryBannerAlert === null) {
    return null;
  }

  // ── Reverse (ekran='overlay') ────────────────────────────────────────────
  // Geri vites tamamen App.tsx ReversePriorityOverlay (gerçek kamera) işidir.
  // Reverse aktifken SafetyOverlay HİÇBİR ŞEY göstermez (banner/ikon dahil).
  const hasReverse = visibleAlerts.some((a) => a.screen === 'overlay');
  if (hasReverse) {
    return null;
  }

  // ── Banner yüksekliği tahmini (ikon şeridini banner altına itmek için) ───
  // critical: büyük punto → ~56px; warning: küçük → ~40px
  const bannerHeight: string =
    primaryBannerAlert?.level === 'critical' ? 'top-14' : 'top-10';

  // Sadece banner==='banner' VE info OLMAYAN alertler gösterilir
  const showBanner =
    primaryBannerAlert !== null && primaryBannerAlert.level !== 'info';

  // ── Yalnız icon/banner screen alertleri ikon şeridinde göster ────────────
  // overlay dışındaki tüm visibleAlerts ikon şeridine girer
  const iconAlerts = visibleAlerts.filter((a) => a.screen !== 'overlay');

  return (
    <>
      {/* ── Üst Banner (tek banner, yalnız critical/warning) ── */}
      {showBanner && (
        <div
          data-testid={
            primaryBannerAlert.level === 'critical'
              ? 'safety-banner-critical'
              : 'safety-banner-warning'
          }
          className={[
            'fixed top-0 left-0 right-0 z-[9000] pointer-events-none',
            'flex items-center gap-2 px-4',
            primaryBannerAlert.level === 'critical' ? 'py-3' : 'py-2',
            bannerClasses(primaryBannerAlert.level),
          ].join(' ')}
        >
          {(() => {
            const Icon = resolveIcon(primaryBannerAlert.icon);
            return (
              <Icon
                size={primaryBannerAlert.level === 'critical' ? 22 : 16}
                className="flex-shrink-0"
                aria-hidden="true"
              />
            );
          })()}
          <span
            className={[
              'font-bold leading-tight',
              primaryBannerAlert.level === 'critical' ? 'text-base' : 'text-sm',
            ].join(' ')}
          >
            {primaryBannerAlert.message}
          </span>
        </div>
      )}

      {/* ── İkon Şeridi (sağ üst köşe, banner altı) ── */}
      {iconAlerts.length > 0 && (
        <div
          data-testid="safety-icon-strip"
          className={[
            'fixed right-2 z-[9000] pointer-events-none',
            'flex flex-col gap-1 items-end',
            // Banner varsa şeridi altına it; yoksa sıfırdan başla
            showBanner ? bannerHeight : 'top-2',
          ].join(' ')}
        >
          {iconAlerts.map((alert) => {
            const Icon = resolveIcon(alert.icon);
            return (
              <div
                key={alert.ruleId}
                data-rule={alert.ruleId}
                className={[
                  'w-7 h-7 rounded flex items-center justify-center',
                  'bg-zinc-900/90',
                  iconColor(alert.level),
                ].join(' ')}
                title={alert.message}
                aria-label={alert.message}
              >
                <Icon size={16} aria-hidden="true" />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Bağlı bileşen ─────────────────────────────────────────────────────────────

/**
 * SafetyOverlay — context'ten output alır, SafetyOverlayView'a iletir.
 * useSafetyAlerts() doğrudan ÇAĞIRILMAZ — SafetyProvider üzerinden gelir (FAZ 4A).
 * App.tsx'te SafetyProvider içine sarıldığında çalışır.
 */
export function SafetyOverlay(): ReactElement | null {
  const { output } = useSafetyContext();
  return <SafetyOverlayView output={output} />;
}
