/**
 * VehicleClassPrompt — "Aracınız ruhsatta hangi sınıfta?" — MODAL DEĞİL.
 *
 * ── SÜRÜŞ GÜVENLİĞİ (görev §0 + §5, pazarlıksız) ────────────────────────────
 *  · Modal/onay/overlay AÇMAZ; haritanın altında duran ince bir şerittir.
 *  · Yalnız araç DURURKEN görünür (`shouldPromptVehicleClass` kapısı: hız
 *    bilinmiyorsa veya > 3 km/sa ise HİÇ çizilmez). Şerit görünürken araç
 *    hareket ederse anında KAYBOLUR — sürücünün dikkatini çekmez.
 *  · Bir kez cevaplanır; "Bilmiyorum" da bir cevaptır (sınıf UNKNOWN kalır ama
 *    bir daha sorulmaz). Kapat düğmesi de kalıcı olarak susturur.
 *  · Kullanıcı sonradan Ayarlar → Araç Sınıfı'ndan düzeltebilir.
 */

import { memo, useCallback } from 'react';
import {
  useVehicleClassSnapshot, shouldPromptVehicleClass,
  setUserVehicleClass, dismissVehicleClassPrompt,
} from '../../platform/vehicle/vehicleClassRuntime';
import {
  USER_CHOICE_LABEL, type VehicleClassUserChoice,
} from '../../platform/vehicle/legalVehicleClass';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';

const _CHOICES: readonly VehicleClassUserChoice[] = [
  'AUTOMOBILE_M1', 'PICKUP_N1', 'PANELVAN_N1', 'MINIBUS_M2', 'DONT_KNOW',
] as const;

export const VehicleClassPrompt = memo(function VehicleClassPrompt() {
  const snapshot = useVehicleClassSnapshot();
  const speedKmh = useUnifiedVehicleStore((s) => s.speed);

  const choose = useCallback((c: VehicleClassUserChoice) => {
    setUserVehicleClass(c);
  }, []);
  const close = useCallback(() => { dismissVehicleClassPrompt(); }, []);

  if (!shouldPromptVehicleClass({ snapshot, speedKmh: speedKmh ?? null })) return null;

  return (
    <div
      data-testid="vehicle-class-prompt"
      className="absolute left-1/2 -translate-x-1/2 z-[var(--z-map-prompt)] pointer-events-auto rounded-2xl px-3 py-2.5"
      style={{
        bottom: 'calc(var(--sab, 0px) + 96px)',
        maxWidth: 'min(94vw, 560px)',
        background: 'var(--oem-surface-2, rgba(18,18,20,0.94))',
        border: '1px solid var(--oem-line, rgba(255,255,255,0.14))',
        boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-[12px] font-bold leading-tight"
            style={{ color: 'var(--oem-ink, #F0EBE0)' }}>
            Aracınız ruhsatta hangi sınıfta?
          </div>
          <div className="text-[10px] leading-tight mt-0.5"
            style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.7))' }}>
            Hız sınırı araç sınıfına göre değişir (kamyonet otoyolda 95, panelvan 110 km/sa).
          </div>
        </div>
        <button
          onClick={close}
          aria-label="Soruyu kapat"
          className="shrink-0 w-7 h-7 rounded-lg text-[14px] font-black"
          style={{
            color: 'var(--oem-ink-2, rgba(240,235,224,0.7))',
            background: 'var(--oem-surface-3, rgba(255,255,255,0.06))',
          }}
        >×</button>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2">
        {_CHOICES.map((c) => (
          <button
            key={c}
            onClick={() => choose(c)}
            className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
            style={{
              color: 'var(--oem-ink, #F0EBE0)',
              background: 'var(--oem-surface-3, rgba(255,255,255,0.08))',
              border: '1px solid var(--oem-line, rgba(255,255,255,0.12))',
            }}
          >
            {USER_CHOICE_LABEL[c]}
          </button>
        ))}
      </div>
    </div>
  );
});
