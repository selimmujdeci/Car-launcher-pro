/**
 * FirstRunSetup — ilk kurulum sihirbazı (yalnız yeni kurulumda, bir kez).
 *
 * Yeni mantık yok: her adım mevcut kanonik yolu kullanır — sürücü profili
 * (`addDriver`), telefon tanıma (`DriverPhoneLink`), Ev/İş (`HomeWorkAddressPanel`),
 * OBD (`OBDConnectModal`). Her adım atlanabilir; "Kurulumu atla" tek dokunuş.
 * Araç hareket hâlindeyse görünmez (sürücüyü meşgul etmez), durunca döner.
 */
import { memo, useEffect, useState } from 'react';
import { ChevronRight, Plug, Smartphone, Home, User, Check } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { addDriver } from '../../platform/driverProfileService';
import { isVehicleMovingNow } from '../../platform/driverPhoneRecognition';
import { DriverPhoneLink } from '../settings/DriverPhoneLink';
import { HomeWorkAddressPanel } from '../settings/HomeWorkAddressPanel';
import { OBDConnectModal } from '../obd/OBDConnectModal';

const STEPS = [
  { icon: User,       title: 'Merhaba! Adın ne?',           sub: 'Tema, ses, müzik ve adres tercihlerin sana özel saklanır.' },
  { icon: Smartphone, title: 'Telefonunu tanıyalım',        sub: 'Telefonun araca bağlanınca profilin kendiliğinden gelir.' },
  { icon: Home,       title: 'Ev ve iş adresin',            sub: '"Eve götür" demen yeterli olsun.' },
  { icon: Plug,       title: 'OBD adaptörü',                sub: 'Hız, yakıt, arıza ve motor bilgileri için. Adaptörün yoksa atlayabilirsin.' },
  { icon: Check,      title: 'Hazırsın',                    sub: 'Bunların hepsini istediğin zaman Ayarlar\'dan değiştirebilirsin.' },
] as const;

function useMovingPoll(): boolean {
  const [moving, setMoving] = useState(() => isVehicleMovingNow());
  useEffect(() => {
    const t = setInterval(() => setMoving(isVehicleMovingNow()), 2000);
    return () => clearInterval(t);
  }, []);
  return moving;
}

const btn: React.CSSProperties = {
  minHeight: 52, borderRadius: 16, padding: '0 22px', fontSize: 16, fontWeight: 800, border: 'none',
};

function FirstRunSetupInner() {
  const done = useStore((s) => s.settings.setupCompleted);
  const [hydrated, setHydrated] = useState(() => useStore.persist?.hasHydrated?.() ?? true);
  useEffect(() => useStore.persist?.onFinishHydration?.(() => setHydrated(true)), []);
  const active = useStore((s) => (s.settings.driverProfiles ?? []).find((d) => d.id === s.settings.activeDriverProfileId) ?? null);
  const moving = useMovingPoll();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [obdOpen, setObdOpen] = useState(false);

  if (done || !hydrated || moving) return null;

  const finish = () => useStore.getState().updateSettings({ setupCompleted: true });
  const next = () => {
    if (step === 0 && name.trim() && !active) addDriver(name);
    if (step >= STEPS.length - 1) finish(); else setStep(step + 1);
  };
  const S = STEPS[step];
  const Icon = S.icon;

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4"
      style={{ background: 'var(--oem-bg, #14171F)' }} role="dialog" aria-modal="true" aria-label="İlk kurulum">
      <div className="w-full max-w-[640px] max-h-full overflow-y-auto flex flex-col gap-5">
        <div className="flex items-center gap-2">
          {STEPS.map((_, i) => (
            <span key={i} className="h-1.5 flex-1 rounded-full"
              style={{ background: i <= step ? 'var(--oem-accent)' : 'var(--oem-line-strong, rgba(255,255,255,.15))' }} />
          ))}
          <button type="button" onClick={finish} className="ml-3 text-[13px] font-bold whitespace-nowrap"
            style={{ color: 'var(--oem-ink-3)', background: 'transparent', border: 'none', minHeight: 44 }}>
            Kurulumu atla
          </button>
        </div>

        <div className="flex items-center gap-4">
          <span className="grid place-items-center rounded-2xl" style={{ width: 56, height: 56, background: 'var(--oem-accent-soft)', color: 'var(--oem-accent)' }}>
            <Icon className="w-7 h-7" />
          </span>
          <div>
            <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--oem-ink)' }}>{S.title}</div>
            <div style={{ fontSize: 14, color: 'var(--oem-ink-2)' }}>{S.sub}</div>
          </div>
        </div>

        <div>
          {step === 0 && (active ? (
            <div style={{ fontSize: 16, color: 'var(--oem-ink-2)' }}>Profilin hazır: <b style={{ color: 'var(--oem-ink)' }}>{active.name}</b></div>
          ) : (
            <input autoFocus value={name} maxLength={32} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
              placeholder="Adın (örn. Selim)" className="w-full outline-none"
              style={{ background: 'var(--oem-surface-2, #303749)', border: '1px solid var(--oem-line)', borderRadius: 16,
                padding: '16px 18px', fontSize: 20, color: 'var(--oem-ink)' }} />
          ))}
          {step === 1 && (active
            ? <DriverPhoneLink driver={active} />
            : <div style={{ fontSize: 15, color: 'var(--oem-ink-3)' }}>Telefon tanıma için bir sürücü profili gerekir; ilk adımda adını yazabilirsin.</div>)}
          {step === 2 && <HomeWorkAddressPanel />}
          {step === 3 && (
            <button type="button" onClick={() => setObdOpen(true)} className="active:scale-95"
              style={{ ...btn, background: 'var(--oem-surface-2, #303749)', color: 'var(--oem-ink)', border: '1px solid var(--oem-line)' }}>
              Adaptörü bağla
            </button>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          {step > 0 && step < STEPS.length - 1 && (
            <button type="button" onClick={() => setStep(step + 1)}
              style={{ ...btn, background: 'transparent', color: 'var(--oem-ink-2)', border: '1px solid var(--oem-line)' }}>
              Atla
            </button>
          )}
          <button type="button" onClick={next} className="flex items-center gap-2 active:scale-95"
            style={{ ...btn, background: 'var(--oem-accent)', color: 'var(--oem-accent-ink, #1A140A)' }}>
            {step === STEPS.length - 1 ? 'Başla' : 'Devam'} <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
      <OBDConnectModal open={obdOpen} onClose={() => setObdOpen(false)} />
    </div>
  );
}

export const FirstRunSetup = memo(FirstRunSetupInner);
