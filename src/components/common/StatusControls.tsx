import { memo, useState, useCallback } from 'react';
import { Wifi, WifiOff, BluetoothConnected, BluetoothOff, Volume2, Volume1, VolumeX } from 'lucide-react';
import { CarLauncher } from '../../platform/nativePlugin';
import { useDeviceStatus, refreshDeviceStatusNow } from '../../platform/deviceApi';
import { setVolume } from '../../platform/systemSettingsService';
import { useStore } from '../../store/useStore';
import { VehicleStatusIndicators } from './VehicleStatusIndicators';
import { StatusItem } from './StatusItem';
import { DriverSwitcher } from './DriverSwitcher';

/**
 * StatusControls — tema status bar'larının paylaştığı CANLI + TIKLANIR durum düğmeleri.
 *
 * - Wi-Fi / Bluetooth: dokununca native sistem panelini açar ve ~1.2 sn sonra
 *   durumu tazeler (kullanıcı panelde açıp dönünce öğe güncellensin).
 * - Ses: UYGULAMA İÇİ popover slider (settings.volume + sistem sesi).
 *
 * ── GÖRSEL DİL (2026-09-24, saha: "bağlandığı/koptuğu belli olmuyor") ─────────
 * Her öğe = ikon + KISA ETİKET + anlamsal durum noktası (`StatusItem`):
 *   bağlı → tam kontrast + YEŞİL nokta · bağlanıyor/zayıf → TURUNCU (bağlanırken
 *   nabız) · hata → KIRMIZI · kapalı → soluk, üstü çizili ikon, nokta yok.
 * Bağlıyken KOPARSA öğe birkaç kez kırmızı yanıp söner, bağlanınca kısa yeşil
 * parlama — ikisi de CSS-only (JS timer YOK). Durum renkleri tema accent'inden
 * BAĞIMSIZDIR (her temada aynı anlam).
 * Eski "şebeke" çubukları KALDIRILDI: hiçbir şey ölçmeyen dekoratif göstergeydi.
 *
 * Tema sadece palette + ikon boyutunu verir; davranış ortak (tek doğruluk kaynağı).
 */

export interface StatusPalette {
  ink: string;
  ink2: string;
  accent: string;
  /** Ses popover zemini — verilmezse koyu fallback. Durum noktası halkası da bundan. */
  surface?: string;
  /** Ses popover kenar rengi (renk, tam border string DEĞİL) — verilmezse fallback. */
  line?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * StatusControls
 * ════════════════════════════════════════════════════════════════════════ */

function StatusControlsInner({ palette, size = 15 }: { palette: StatusPalette; size?: number }) {
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

  const VolIcon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  return (
    <div className="flex items-center" style={{ gap: 4, position: 'relative' }}>
      {/* Sürücü — hızlı değiştirme (driverProfileService) */}
      <DriverSwitcher palette={palette} size={size} />

      {/* Wi-Fi — native panel */}
      <StatusItem
        Icon={device.wifiConnected ? Wifi : WifiOff}
        state={device.wifiConnected ? 'ok' : 'off'}
        caption="Wi-Fi"
        label={device.wifiConnected ? `Wi-Fi bağlı: ${device.wifiName || 'ağ'}` : 'Wi-Fi bağlı değil — ayarları aç'}
        onClick={openWifi}
        palette={palette}
        size={size}
      />

      {/* Bluetooth — native panel; bağlıyken etiket = bağlı cihazın adı */}
      <StatusItem
        Icon={device.btConnected ? BluetoothConnected : BluetoothOff}
        state={device.btConnected ? 'ok' : 'off'}
        caption={device.btConnected && device.btDevice ? device.btDevice : 'BT'}
        label={device.btConnected ? `Bluetooth bağlı: ${device.btDevice || 'cihaz'}` : 'Bluetooth bağlı değil — ayarları aç'}
        onClick={openBt}
        palette={palette}
        size={size}
      />

      {/* OEM araç göstergeleri — OBD / GPS / AI (mevcut kaynaklardan; sahte "bağlı" yok) */}
      <VehicleStatusIndicators palette={palette} size={size} />

      {/* Ses — uygulama içi popover */}
      <StatusItem
        Icon={VolIcon}
        state={volume > 0 ? 'neutral' : 'off'}
        caption={`${volume}%`}
        label={`Ses: ${volume}%`}
        onClick={() => setVolOpen((o) => !o)}
        palette={palette}
        size={size}
      />

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
