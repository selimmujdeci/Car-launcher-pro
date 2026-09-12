/**
 * VehicleClassSettings — ruhsat sınıfının kullanıcı tarafından DÜZELTİLMESİ.
 *
 * Görev §5: "Kullanıcı sonradan ayarlardan düzeltebilir." Sürüş sırasında çıkan
 * soru bir KEZ sorulur; kalıcı düzeltme yeri burasıdır.
 *
 * Bu ekran salt-okunur DEĞİLDİR (CAROS LAB değildir) — kullanıcı kendi
 * beyanını burada verir. Ama gösterdiği tanı bilgileri kanıta dayanır:
 * bilinmeyen alanlar "—" değil AÇIK metinle "kanıt yok" olarak yazılır ve
 * tam VIN gösterilmez.
 */

import { memo, useCallback } from 'react';
import {
  useVehicleClassSnapshot, setUserVehicleClass, clearUserVehicleClass,
} from '../../platform/vehicle/vehicleClassRuntime';
import {
  USER_CHOICE_LABEL, VEHICLE_CLASS_STATE_LABEL,
  LEGAL_CATEGORY_LABEL, BODY_TYPE_LABEL,
  type VehicleClassUserChoice,
} from '../../platform/vehicle/legalVehicleClass';
import { RESEARCH_OUTCOME_LABEL } from '../../platform/vehicle/vehicleClassResearch';

const CHOICES: readonly VehicleClassUserChoice[] = [
  'AUTOMOBILE_M1', 'PICKUP_N1', 'PANELVAN_N1', 'MINIBUS_M2', 'DONT_KNOW',
] as const;

/** Aktif beyanı seçenek anahtarına çevirir (hangi düğme seçili görünecek). */
function activeChoice(cat: string, body: string, source: string): VehicleClassUserChoice | null {
  if (source !== 'USER_CONFIRMED') return null;
  if (cat === 'M1' && body === 'AUTOMOBILE') return 'AUTOMOBILE_M1';
  if (cat === 'N1' && body === 'PICKUP')     return 'PICKUP_N1';
  if (cat === 'N1' && body === 'PANELVAN')   return 'PANELVAN_N1';
  if (cat === 'M2' && body === 'MINIBUS')    return 'MINIBUS_M2';
  return null;
}

export const VehicleClassSettings = memo(function VehicleClassSettings() {
  const snap = useVehicleClassSnapshot();
  const p = snap.profile;
  const selected = activeChoice(p.legalVehicleCategory, p.registrationBodyType, p.source);

  const choose = useCallback((c: VehicleClassUserChoice) => setUserVehicleClass(c), []);
  const reset = useCallback(() => clearUserVehicleClass(), []);

  const ink2 = 'var(--oem-ink-3, rgba(255,255,255,0.45))';

  return (
    <div className="flex flex-col gap-2.5" data-testid="vehicle-class-settings">
      <div className="text-[11px] leading-snug" style={{ color: ink2 }}>
        Hız sınırı araç sınıfına göre değişir. Otoyolda otomobil (M1) için 130 km/sa
        geçerliyken kamyonet (N1) 95, panelvan (N1) 110 km/sa ile sınırlıdır.
        Sınıf bilinmiyorsa CAROS <b>otomobil varsaymaz</b>; yalnız yolun levhasını gösterir.
      </div>

      {!snap.key && (
        <div className="text-[11px] font-bold" style={{ color: '#fbbf24' }}>
          Araç kimliği yok (VIN veya marka/model okunmadı) — seçim saklanamaz.
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {CHOICES.map((c) => {
          const on = selected === c;
          return (
            <button
              key={c}
              onClick={() => choose(c)}
              disabled={!snap.key}
              className="px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40"
              style={{
                background: on ? 'rgba(96,165,250,0.18)' : 'var(--oem-surface-3, rgba(255,255,255,0.05))',
                border: `1px solid ${on ? 'rgba(96,165,250,0.5)' : 'var(--oem-line, rgba(255,255,255,0.1))'}`,
                color: on ? '#60a5fa' : 'var(--oem-ink-2, rgba(255,255,255,0.7))',
              }}
            >
              {USER_CHOICE_LABEL[c]}
            </button>
          );
        })}
      </div>

      {/* ── Kanıt künyesi (dürüstlük) ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]" style={{ color: ink2 }}>
        <span>Durum</span>
        <b style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.75))' }}>
          {VEHICLE_CLASS_STATE_LABEL[p.resolutionState]}
        </b>
        <span>Yasal sınıf</span>
        <b style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.75))' }}>
          {LEGAL_CATEGORY_LABEL[p.legalVehicleCategory]}
        </b>
        <span>Gövde cinsi</span>
        <b style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.75))' }}>
          {BODY_TYPE_LABEL[p.registrationBodyType]}
        </b>
        <span>Kaynak</span>
        <b style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.75))' }}>{p.source}</b>
        <span>VIN</span>
        <b style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.75))' }}>
          {snap.vinMasked ?? 'okunmadı'}
        </b>
        <span>İnternet araştırması</span>
        <b style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.75))' }}>
          {RESEARCH_OUTCOME_LABEL[snap.researchOutcome]}
        </b>
      </div>

      {p.resolutionState === 'CONFLICTED' && (
        <div className="text-[11px] font-bold" style={{ color: '#fbbf24' }}>
          Beyanınız dış kaynakla çelişiyor. Sizin beyanınız uygulanıyor.
        </div>
      )}

      <button
        onClick={reset}
        disabled={!snap.key || p.source !== 'USER_CONFIRMED'}
        className="self-start px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider disabled:opacity-30"
        style={{
          background: 'var(--oem-surface-3, rgba(255,255,255,0.05))',
          border: '1px solid var(--oem-line, rgba(255,255,255,0.1))',
          color: 'var(--oem-ink-2, rgba(255,255,255,0.6))',
        }}
      >
        Beyanı sıfırla
      </button>
    </div>
  );
});
