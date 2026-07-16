import { memo, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Wifi, WifiOff, Bluetooth, BluetoothConnected, Volume2, Volume1, VolumeX } from 'lucide-react';
import { CarLauncher } from '../../platform/nativePlugin';
import { useDeviceStatus, refreshDeviceStatusNow } from '../../platform/deviceApi';
import { setVolume } from '../../platform/systemSettingsService';
import { useStore } from '../../store/useStore';
import { VehicleStatusIndicators } from './VehicleStatusIndicators';

/**
 * StatusControls — tema status bar'larının paylaştığı CANLI + TIKLANIR durum düğmeleri.
 *
 * - Wi-Fi / Bluetooth: bağlıysa accent + belirgin, değilse sönük (useDeviceStatus canlı
 *   yoklama). Dokununca native sistem panelini açar (openWifiSettings/openBluetoothSettings)
 *   ve ~1.2s sonra durumu tazeler (kullanıcı panelde açıp dönünce ikon güncellensin).
 * - Ses: UYGULAMA İÇİ popover slider (settings.volume + sistem sesi). Native panel açmaz.
 * - Şebeke: pasif gösterge (cellular toggle head unit'lerde OEM kilitli — karma karar).
 *
 * Tema sadece palette + ikon boyutunu verir; davranış ortak (tek doğruluk kaynağı).
 */

export interface StatusPalette {
  ink: string;
  ink2: string;
  accent: string;
  /** Ses popover zemini — verilmezse koyu fallback. */
  surface?: string;
  /** Ses popover kenar rengi (renk, tam border string DEĞİL) — verilmezse fallback. */
  line?: string;
}

function StatusControlsInner({
  palette, size = 15, showCellular = true,
}: { palette: StatusPalette; size?: number; showCellular?: boolean }) {
  const device = useDeviceStatus();
  const volume = useStore((s) => s.settings.volume);
  const updateSettings = useStore((s) => s.updateSettings);
  const [volOpen, setVolOpen] = useState(false);

  const openWifi = useCallback(() => {
    void CarLauncher.openWifiSettings?.().catch(() => undefined);
    setTimeout(refreshDeviceStatusNow, 1200);
  }, []);
  const openBt = useCallback(() => {
    void CarLauncher.openBluetoothSettings?.().catch(() => undefined);
    setTimeout(refreshDeviceStatusNow, 1200);
  }, []);
  const onVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    updateSettings({ volume: clamped });
    setVolume(clamped); // sistem sesi (native, debounce'lı)
  }, [updateSettings]);

  const px: CSSProperties = { width: size, height: size, flexShrink: 0 };
  const btn: CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 5, borderRadius: 9, minWidth: 34, minHeight: 34,
  };
  const VolIcon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  return (
    <div className="flex items-center" style={{ gap: 2, position: 'relative' }}>
      {showCellular && (
        <div className="flex items-end" style={{ gap: 2, height: size, padding: '0 5px' }} aria-hidden>
          {[0.45, 0.65, 0.85, 1].map((f, i) => (
            <div key={i} style={{
              width: 2.5, height: Math.round(size * f), borderRadius: 1,
              background: palette.ink2, opacity: device.wifiConnected ? 0.35 : 0.7,
            }} />
          ))}
        </div>
      )}

      {/* Wi-Fi — native panel; bağlıysa accent */}
      <button
        onClick={openWifi}
        style={btn}
        aria-label={device.wifiConnected ? `Wi-Fi bağlı: ${device.wifiName || 'ağ'}` : 'Wi-Fi ayarlarını aç'}
        title={device.wifiConnected ? (device.wifiName || 'Wi-Fi bağlı') : 'Wi-Fi'}
      >
        {device.wifiConnected
          ? <Wifi    style={{ ...px, color: palette.accent }} />
          : <WifiOff style={{ ...px, color: palette.ink2, opacity: 0.5 }} />}
      </button>

      {/* Bluetooth — native panel; bağlıysa accent */}
      <button
        onClick={openBt}
        style={btn}
        aria-label={device.btConnected ? `Bluetooth bağlı: ${device.btDevice || 'cihaz'}` : 'Bluetooth ayarlarını aç'}
        title={device.btConnected ? (device.btDevice || 'Bluetooth bağlı') : 'Bluetooth'}
      >
        {device.btConnected
          ? <BluetoothConnected style={{ ...px, color: palette.accent }} />
          : <Bluetooth          style={{ ...px, color: palette.ink2, opacity: 0.5 }} />}
      </button>

      {/* OEM araç göstergeleri — OBD / GPS / AI (mevcut kaynaklardan; sahte "bağlı" yok) */}
      <VehicleStatusIndicators palette={palette} size={size} />

      {/* Ses — uygulama içi popover */}
      <button onClick={() => setVolOpen((o) => !o)} style={btn} aria-label="Ses seviyesi" title={`Ses: ${volume}%`}>
        <VolIcon style={{ ...px, color: volume > 0 ? palette.ink : palette.ink2, opacity: volume > 0 ? 1 : 0.5 }} />
      </button>

      {volOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 120 }} onClick={() => setVolOpen(false)} />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 121,
              background: palette.surface ?? 'rgba(22,22,27,0.97)',
              border: `1px solid ${palette.line ?? 'rgba(255,255,255,0.14)'}`, borderRadius: 14,
              padding: '12px 14px', boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
              display: 'flex', alignItems: 'center', gap: 10, width: 220,
            }}
          >
            <VolIcon style={{ width: 18, height: 18, flexShrink: 0, color: palette.ink2 }} />
            <input
              type="range" min={0} max={100} value={volume}
              onChange={(e) => onVolume(Number(e.target.value))}
              style={{ flex: 1, accentColor: palette.accent, cursor: 'pointer' }}
              aria-label="Ses seviyesi kaydırıcı"
            />
            <span style={{ fontSize: 12, fontWeight: 800, minWidth: 34, textAlign: 'right', color: palette.ink, fontVariantNumeric: 'tabular-nums' }}>
              {volume}%
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export const StatusControls = memo(StatusControlsInner);
