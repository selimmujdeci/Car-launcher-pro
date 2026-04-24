import { memo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className="w-full max-w-lg bg-slate-900/95 border border-white/10 rounded-2xl p-5 flex flex-col gap-4">
        <p className="text-xs text-slate-400 leading-relaxed">{DISCLAIMER}</p>
        <button
          onClick={accept}
          className="w-full py-3 rounded-xl bg-blue-600 active:bg-blue-700 text-white font-bold text-sm active:scale-95 transition-all"
        >
          Anladım
        </button>
      </div>
    </div>
  );
});
