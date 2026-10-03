/**
 * VehicleLinkCard — "Araç bağlantısı": hangi araç, hangi erişim seviyesi, hangi özellik geliyor.
 *
 * SALT OKUMA: `vehicleAccess` projeksiyonunu gösterir; hiçbir izni/ayarı DEĞİŞTİRMEZ.
 * Tam erişim tek seferlik bir KURULUM adımıdır (kurulumu yapan kişi bilerek uygular) —
 * uygulama yetki almaz, yalnız durumun ne olduğunu ve neyin eksik olduğunu söyler.
 * Bilinmeyen değer "bekleniyor" yazar; sahte "var" yok.
 */
import { memo, useEffect, useState } from 'react';
import {
  readVehicleAccess, describeVehicleProfile,
  type VehicleAccessState, type VehicleFeature, type FeatureAvailability,
} from '../../platform/vehicleDataLayer/vehicleAccess';

const POLL_MS = 5_000;

const FEATURE_LABEL: Readonly<Record<VehicleFeature, string>> = {
  climate: 'Klima', doors: 'Kapılar', steering: 'Direksiyon açısı',
  tpms: 'Lastik basıncı', trip: 'Yol bilgisayarı', massage: 'Koltuk masajı', ambient: 'İç ambiyans',
};

const AVAIL_TEXT: Readonly<Record<FeatureAvailability, [string, string]>> = {
  AVAILABLE: ['Geliyor', '#34d399'],
  NOT_SEEN:  ['Bekleniyor', 'var(--oem-ink-3, rgba(255,255,255,0.45))'],
  LOCKED:    ['Kurulum gerekli', '#fbbf24'],
  NO_SOURCE: ['Kaynak yok', 'var(--oem-ink-3, rgba(255,255,255,0.45))'],
};

const TIER_TEXT: Readonly<Record<VehicleAccessState['tier'], [string, string]>> = {
  FULL:    ['Tam', '#34d399'],
  BASIC:   ['Temel', '#fbbf24'],
  NONE:    ['Araç bağlantısı yok', '#f87171'],
  UNKNOWN: ['Okunamadı', 'var(--oem-ink-3, rgba(255,255,255,0.45))'],
};

export const VehicleLinkCard = memo(function VehicleLinkCard() {
  const [state, setState] = useState<VehicleAccessState | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      void readVehicleAccess().then((s) => { if (alive) setState(s); }).catch(() => { /* fail-soft */ });
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const ink2 = 'var(--oem-ink-3, rgba(255,255,255,0.45))';
  if (!state) {
    return <div className="text-[11px]" style={{ color: ink2 }}>Araç bağlantısı okunuyor…</div>;
  }
  const [tierText, tierColor] = TIER_TEXT[state.tier];
  const vehicle = describeVehicleProfile(state.profile);

  return (
    <div className="flex flex-col gap-2.5" data-testid="vehicle-link-card">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold">{vehicle ?? 'Araç profili okunamadı'}</span>
        <span className="text-[11px] font-bold" style={{ color: tierColor }}>{tierText}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {(Object.keys(FEATURE_LABEL) as VehicleFeature[]).map((f) => {
          const [t, c] = AVAIL_TEXT[state.features[f]];
          return (
            <div key={f} className="flex justify-between text-[11px]">
              <span>{FEATURE_LABEL[f]}</span>
              <span style={{ color: c }}>{t}</span>
            </div>
          );
        })}
      </div>

      {state.tier === 'BASIC' && (
        <div className="text-[11px] leading-snug" style={{ color: ink2 }}>
          Lastik basıncı, yol bilgisayarı ve masaj/ambiyans durumu için bir kerelik araç
          bağlantısı kurulumu gerekiyor. Kurulumu yapan kişi bilgisayardan şu iki adımı uygular:
          <div className="mt-1 font-mono text-[10px] select-all">
            {state.missingSetup.includes('READ_LOGS') && <div>pm grant com.cockpitos.pro android.permission.READ_LOGS</div>}
            {state.missingSetup.includes('CANAPP_DEBUG') && <div>settings put system canapp_debug 1</div>}
          </div>
          Kurulum yapılmazsa da araç komutları çalışır; yalnız sonuçlarını doğrulayamam.
        </div>
      )}
      {state.tier === 'FULL' && !state.rawFlowing && (
        <div className="text-[11px] leading-snug" style={{ color: '#fbbf24' }}>
          Kurulum tamam ama araçtan henüz ham veri gelmiyor. Ünite yeniden başlatıldıktan sonra gelmesi beklenir.
        </div>
      )}
    </div>
  );
});
