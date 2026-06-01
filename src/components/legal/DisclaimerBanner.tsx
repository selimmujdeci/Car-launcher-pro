import { memo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ShieldCheck } from 'lucide-react';

const DISCLAIMER =
  'Bu uygulama yalnızca araç verilerini görüntülemek amacıyla tasarlanmıştır. ' +
  'Araç sistemlerine müdahale etmez ve sürüş kontrolü sağlamaz.';

const useDisclaimerStore = create<{ seen: boolean; accept: () => void }>()(
  persist(
    (set) => ({ seen: false, accept: () => set({ seen: true }) }),
    { name: 'car-launcher-disclaimer' },
  ),
);

export const DisclaimerBanner = memo(function DisclaimerBanner() {
  const { seen, accept } = useDisclaimerStore();
  if (seen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: 'rgba(8,10,14,0.62)', backdropFilter: 'blur(10px) saturate(120%)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-title"
    >
      <div
        className="w-full max-w-md flex flex-col overflow-hidden"
        style={{
          background:
            'linear-gradient(180deg, var(--oem-surface-1) 0%, var(--oem-surface-0) 100%)',
          border: '1px solid var(--oem-line-strong)',
          borderRadius: 'var(--oem-radius-card)',
          boxShadow: 'var(--oem-shadow-pop)',
        }}
      >
        {/* Üst amber hairline — premium aksan */}
        <div
          style={{
            height: 2,
            background:
              'linear-gradient(90deg, transparent 0%, var(--oem-accent) 50%, transparent 100%)',
            opacity: 0.9,
          }}
        />

        <div className="flex flex-col gap-5 p-7">
          <div className="flex items-center gap-3.5">
            <div
              className="flex items-center justify-center flex-shrink-0"
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'var(--oem-accent-soft)',
                border: '1px solid var(--oem-line-warm)',
                boxShadow: '0 0 0 4px var(--oem-accent-glow)',
              }}
            >
              <ShieldCheck size={24} strokeWidth={2} style={{ color: 'var(--oem-accent)' }} />
            </div>
            <div className="flex flex-col">
              <h2
                id="disclaimer-title"
                className="text-lg font-bold tracking-tight"
                style={{ color: 'var(--oem-ink)' }}
              >
                Bilgilendirme
              </h2>
              <span
                className="text-xs font-medium tracking-wide"
                style={{ color: 'var(--oem-ink-3)' }}
              >
                Salt görüntüleme · Güvenli mod
              </span>
            </div>
          </div>

          <p
            className="text-sm leading-relaxed"
            style={{ color: 'var(--oem-ink-2)' }}
          >
            {DISCLAIMER}
          </p>

          <button
            onClick={accept}
            className="w-full font-bold text-sm tracking-wide active:scale-[0.985] transition-transform"
            style={{
              padding: '15px 0',
              borderRadius: 'var(--oem-radius-tile)',
              color: 'var(--oem-accent-ink)',
              background:
                'linear-gradient(180deg, var(--oem-accent) 0%, var(--oem-accent-strong) 100%)',
              boxShadow:
                '0 1px 0 rgba(255,255,255,0.18) inset, 0 14px 30px -14px var(--oem-accent-glow)',
              transitionDuration: 'var(--oem-dur-fast)',
              transitionTimingFunction: 'var(--oem-ease-out)',
            }}
          >
            Anladım
          </button>
        </div>
      </div>
    </div>
  );
});
