/**
 * TripMeterRow — RESETLENEBİLİR YOL SAYACI için tema-agnostik paylaşılan satır (AŞAMA B).
 *
 * Palet/stil PROPS ile girer — bileşen içine sabit renk GÖMÜLMEZ; her tema
 * kendi `p.*` token'larını `palette` prop'una eşler, kendi görünümünü korur.
 *
 * Güvenlik: reset kapısı `canResetTripMeter` (UI katmanı) + `requestTripMeterReset`
 * (otorite, servis içinde) — burada ikinci bir "gerçek" kapı İCAT EDİLMEZ, yalnız
 * aynı saf fonksiyon UI'da da danışılır (buton disabled görünümü + bilgi metni için).
 *
 * MODAL/POPUP YOK: onay kartın içinde satır içi (`phase === 'confirm'`) gösterilir.
 * Onay açıkken araç hareket etmeye başlarsa kendiliğinden kapanır (reset YAPILMAZ)
 * — bkz. `tripMeterUiState.ts` (saf faz makinesi, orada test edilir).
 */

import { memo, useEffect, useState, type CSSProperties } from 'react';
import { RefreshCw, Gauge } from 'lucide-react';
import { useTripMeter } from '../../hooks/useTripMeter';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { canResetTripMeter, formatTripMeterKm, tripMeterGateSpeed } from '../../platform/trip/tripMeterModel';
import { showToast } from '../../platform/errorBus';
import {
  tripMeterUiPressReset, tripMeterUiCancel, tripMeterUiConfirmed, tripMeterUiSpeedChanged,
  type TripMeterUiPhase,
} from './tripMeterUiState';

export interface TripMeterPalette {
  ink:    string;
  ink2:   string;
  ink3:   string;
  accent: string;
  /** Nötr zemin (buton/track arka planı) — her temanın kendi "kutu" tonu. */
  tile:   string;
  /** İnce ayraç/kenar rengi (bare renk — `border`/`borderTop` içine girer). */
  edge:   string;
}

export interface TripMeterRowProps {
  palette: TripMeterPalette;
  /** Değer font boyutu (px). Varsayılan: 22. */
  valueSize?: number;
  /** "km" birim font boyutu (px). Varsayılan: 13. */
  unitSize?: number;
  /** "YOL SAYACI" etiket font boyutu (px). Varsayılan: 11. */
  labelSize?: number;
  /** Gauge ikon boyutu (px, kare). Varsayılan: 20. */
  iconSize?: number;
  gap?: number;
  /** Üstte ince ayraç (mevcut "Kilometre" bloklarındaki border-top deseniyle aynı). */
  showTopBorder?: boolean;
  className?: string;
  style?: CSSProperties;
}

function btnStyle(palette: TripMeterPalette, opts: { primary?: boolean; disabled?: boolean }): CSSProperties {
  return {
    minWidth: 44,
    minHeight: 44,
    padding: '6px 12px',
    borderRadius: 10,
    border: 'none',
    background: opts.primary ? palette.accent : palette.tile,
    color: opts.primary ? '#fff' : palette.ink2,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: '0.04em',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    cursor: opts.disabled ? 'not-allowed' : 'pointer',
    opacity: opts.disabled ? 0.45 : 1,
  };
}

function TripMeterRowBase({
  palette, valueSize = 22, unitSize = 13, labelSize = 11, iconSize = 20, gap = 12,
  showTopBorder = false, className, style,
}: TripMeterRowProps) {
  const { record, requestReset } = useTripMeter();
  // HAM hıza abone OLUNMAZ (10-20Hz → ana ekranda gereksiz render). Yalnız kapı
  // denklik sınıfı (null/0/1) izlenir; kapı hükmü aynı kalırken render OLMAZ.
  const speed = useUnifiedVehicleStore((s) => tripMeterGateSpeed(s.speed));
  const [phase, setPhase] = useState<TripMeterUiPhase>('idle');

  // Onay açıkken hareket başlarsa kendiliğinden kapat — MODAL/POPUP değil, reset YAPILMAZ.
  useEffect(() => {
    setPhase((p) => tripMeterUiSpeedChanged(p, speed));
  }, [speed]);

  const gate = canResetTripMeter(speed);
  const displayValue = record.state === 'READY' ? formatTripMeterKm(record.distanceKm) : formatTripMeterKm(null);

  const handlePress = () => setPhase((p) => tripMeterUiPressReset(p, speed));
  const handleCancel = () => setPhase(tripMeterUiCancel);
  const handleConfirm = () => {
    const result = requestReset();
    setPhase(tripMeterUiConfirmed);
    if (result.ok) {
      showToast({ type: 'success', title: 'Yol sayacı sıfırlandı.', duration: 2000 });
    }
  };

  return (
    <div
      className={className}
      style={{
        ...(showTopBorder ? { borderTop: `1px solid ${palette.edge}`, paddingTop: 9, marginTop: 2 } : {}),
        ...style,
      }}
    >
      <div className="flex items-center" style={{ gap }}>
        <Gauge style={{ width: iconSize, height: iconSize, color: palette.ink2, flexShrink: 0 }} />
        <span style={{ fontSize: valueSize, fontWeight: 800, color: palette.ink, fontVariantNumeric: 'tabular-nums' }}>
          {displayValue}
        </span>
        <span style={{ fontSize: unitSize, fontWeight: 600, color: palette.ink2 }}>km</span>
        <span style={{
          marginLeft: 'auto', fontSize: labelSize, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: palette.ink3, whiteSpace: 'nowrap',
        }}>
          Yol Sayacı
        </span>
      </div>

      {phase === 'confirm' ? (
        <div className="flex items-center justify-between" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: unitSize, fontWeight: 600, color: palette.ink2 }}>
            Yol sayacı sıfırlansın mı?
          </span>
          <div className="flex items-center" style={{ gap: 6 }}>
            <button type="button" onClick={handleCancel} style={btnStyle(palette, {})}>VAZGEÇ</button>
            <button type="button" onClick={handleConfirm} style={btnStyle(palette, { primary: true })}>SIFIRLA</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            disabled={!gate.allowed}
            onClick={handlePress}
            style={btnStyle(palette, { disabled: !gate.allowed })}
          >
            <RefreshCw size={13} /> Sıfırla
          </button>
          {!gate.allowed && (
            <div style={{ marginTop: 4, fontSize: Math.max(9, labelSize - 1), fontWeight: 600, color: palette.ink3 }}>
              Aracı durdurunca sıfırlayabilirsiniz.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const TripMeterRow = memo(TripMeterRowBase);
