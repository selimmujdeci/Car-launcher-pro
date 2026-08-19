'use client';

/**
 * ARAÇ HARİTA KARTI — #661.
 *
 * Kullanıcı isteği: *"yeşil noktaya dokununca aracın konumu tam olarak ve araç
 * bilgileri belli olacak kart içinde"*.
 *
 * Sözleşme (kanıtsız bilgi ÜRETİLMEZ):
 *  - Ölçümler `telemetry` (VehicleFreshness) gerçek katmanından okunur;
 *    bilinmeyen alan `Veri yok` yazar, sahte `0` YAZILMAZ.
 *  - Konum canlı değilse "son bilinen konum" DENİR; "şu an burada" denmez.
 *  - Adres ters çözümlemesi başarısızsa `adres çözümlenemedi` yazar ve
 *    koordinat tek gerçek olarak kalır.
 *  - Bileşen kendi timer'ını KURMAZ; tek bir ağ isteği yapar ve `mountedRef`
 *    ile iptal olur.
 */

import { useEffect, useRef, useState } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import {
  measurementLabel,
  locationLabel,
  freshnessLabel,
  dataSourceLabel,
  ageLabel,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import { formatCoords, vehicleTitle, vehicleSubtitle, isFallbackTitle } from '@/lib/vehicleDisplay';
import { reverseGeocode } from '@/lib/reverseGeocode';

interface Props {
  vehicle: LiveVehicle;
  onClose: () => void;
  /** "Detay" — mevcut araç modalını açar. */
  onOpenDetail?: () => void;
  /** "İsim ver / Düzenle" — kimlik düzenleyiciyi açar. */
  onEditIdentity?: () => void;
}

type AddressState =
  | { kind: 'IDLE' }
  | { kind: 'LOADING' }
  | { kind: 'RESOLVED'; text: string }
  | { kind: 'UNRESOLVED' };

const statusStyle = {
  online:  { label: 'Online',  color: '#34d399' },
  alarm:   { label: 'Alarm',   color: '#f87171' },
  offline: { label: 'Offline', color: '#9ca3af' },
} as const;

export default function VehicleMapCard({ vehicle: v, onClose, onOpenDetail, onEditIdentity }: Props) {
  const t = v.telemetry;
  const s = statusStyle[v.status];

  /* Koordinat otoritesi: gerçek katmanı varsa O, yoksa eski sayısal yüzey.
     İkisi de yoksa konum BİLİNMİYOR — uydurma 0,0 gösterilmez. */
  const lat = t?.latitude  ?? (v.lat !== 0 ? v.lat : null);
  const lng = t?.longitude ?? (v.lng !== 0 ? v.lng : null);
  const hasFix = lat !== null && lng !== null && !(lat === 0 && lng === 0);

  const [address, setAddress] = useState<AddressState>({ kind: 'IDLE' });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!hasFix) { setAddress({ kind: 'IDLE' }); return; }
    setAddress({ kind: 'LOADING' });
    let cancelled = false;
    reverseGeocode(lat as number, lng as number).then((text) => {
      if (cancelled || !mountedRef.current) return;
      setAddress(text ? { kind: 'RESOLVED', text } : { kind: 'UNRESOLVED' });
    });
    return () => { cancelled = true; };
  }, [hasFix, lat, lng]);

  const addressText =
    address.kind === 'RESOLVED'   ? address.text
    : address.kind === 'LOADING'  ? 'Adres çözümleniyor…'
    : address.kind === 'UNRESOLVED' ? 'Adres çözümlenemedi'
    : 'Konum verisi yok';

  const osmUrl = hasFix
    ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
    : null;

  return (
    <div
      className="absolute left-3 right-3 bottom-3 z-30 rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(6,13,26,0.92)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 20px 48px rgba(0,0,0,0.65)',
      }}
    >
      {/* Başlık */}
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3 border-b border-white/[0.07]">
        <span
          className="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-sm font-bold text-white/90 ${isFallbackTitle(v) ? '' : 'font-mono'}`}>
              {vehicleTitle(v)}
            </span>
            {vehicleSubtitle(v) && (
              <span className="text-[11px] text-white/35 truncate">{vehicleSubtitle(v)}</span>
            )}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: s.color }}>
            {s.label}
            <span className="text-white/25">
              {' · '}
              {t ? ageLabel(t.deviceAgeMs) : v.lastSeen}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Kartı kapat"
          className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white transition-colors flex-shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* İsim yoksa doğrudan çözüm yolu göster */}
      {isFallbackTitle(v) && onEditIdentity && (
        <button
          onClick={onEditIdentity}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-accent/[0.09] border-b border-accent/20 text-left"
        >
          <span className="text-[11px] text-accent/90 font-medium">
            Bu araca henüz isim/plaka verilmedi
          </span>
          <span className="text-[11px] font-bold text-accent">İsim ver →</span>
        </button>
      )}

      {/* Konum */}
      <div className="px-4 py-3 flex flex-col gap-2 border-b border-white/[0.06]">
        <div className="flex items-start gap-2">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="mt-0.5 flex-shrink-0">
            <path d="M7 12.5s4.5-4 4.5-7A4.5 4.5 0 0 0 2.5 5.5c0 3 4.5 7 4.5 7z"
              stroke="#60a5fa" strokeWidth="1.3" strokeLinejoin="round" />
            <circle cx="7" cy="5.5" r="1.6" stroke="#60a5fa" strokeWidth="1.3" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-white/85 leading-snug">{addressText}</p>
            <p className="text-[11px] font-mono text-white/40 mt-1">
              {hasFix ? formatCoords(lat as number, lng as number) : 'Koordinat yok'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[10px] text-white/35">
          <span>{t ? locationLabel(t) : 'Konum durumu bilinmiyor'}</span>
          {t && <span>· {dataSourceLabel(t.locationSource)}</span>}
          {t?.accuracyM != null && <span>· ±{Math.round(t.accuracyM)} m</span>}
          {t?.locationAgeMs != null && <span>· {ageLabel(t.locationAgeMs)}</span>}
        </div>
      </div>

      {/* Ölçümler — bilinmeyen `Veri yok`, sahte 0 YOK */}
      <div className="grid grid-cols-4 divide-x divide-white/[0.06] border-b border-white/[0.06]">
        {[
          { label: 'Hız',   m: t?.speedKmh,    unit: 'km/h' },
          { label: 'Yakıt', m: t?.fuelPercent, unit: '%'    },
          { label: 'Motor', m: t?.engineTempC, unit: '°C'   },
          { label: 'RPM',   m: t?.rpm,         unit: ''     },
        ].map(({ label, m, unit }) => {
          const known = m != null && m.value !== null;
          return (
            <div key={label} className="px-2 py-2.5 text-center">
              <p className={`text-[13px] font-mono font-bold ${
                !known ? 'text-white/25' : m!.state === 'LIVE' ? 'text-white/90' : 'text-white/45'
              }`}>
                {m ? measurementLabel(m, unit).replace(' · eski veri', '').replace(' · araç çevrimdışı', '')
                   : 'Veri yok'}
              </p>
              <p className="text-[9px] uppercase tracking-widest text-white/25 mt-0.5">{label}</p>
            </div>
          );
        })}
      </div>

      {/* Kaynak/tazelik satırı */}
      {t && (
        <div className="px-4 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[10px] text-white/30 border-b border-white/[0.06]">
          <span>Ünite: {freshnessLabel(t.device)}</span>
          <span>· Motor verisi: {freshnessLabel(t.engine)}</span>
          {v.driver && v.driver !== '—' && <span>· Sürücü: {v.driver}</span>}
        </div>
      )}

      {/* Eylemler */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {onOpenDetail && (
          <button
            onClick={onOpenDetail}
            className="flex-1 px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-white/[0.05] border border-white/[0.08] text-white/70 hover:text-white transition-colors min-h-[40px]"
          >
            Araç detayı
          </button>
        )}
        {onEditIdentity && !isFallbackTitle(v) && (
          <button
            onClick={onEditIdentity}
            className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-white/[0.05] border border-white/[0.08] text-white/70 hover:text-white transition-colors min-h-[40px]"
          >
            Düzenle
          </button>
        )}
        {osmUrl && (
          <a
            href={osmUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-white/[0.05] border border-white/[0.08] text-white/70 hover:text-white transition-colors min-h-[40px] flex items-center"
          >
            Haritada aç
          </a>
        )}
      </div>
    </div>
  );
}
