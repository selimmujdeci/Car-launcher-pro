/**
 * SleepScreen — araç park halindeyken gösterilen uyku ekranı.
 * Dokunuşla veya hareket algılandığında kaldırılır.
 */
import { memo } from 'react';

interface Props {
  onWake?: () => void;
}

export const SleepScreen = memo(function SleepScreen({ onWake }: Props) {
  return (
    <div
      className="fixed inset-0 z-[200] bg-[#020617]/95 backdrop-blur-3xl flex flex-col items-center justify-center cursor-pointer transition-all duration-700"
      onClick={onWake}
    >
      <div className="w-24 h-24 rounded-full border border-white/5 var(--panel-bg-secondary) flex items-center justify-center mb-8 animate-pulse">
        <div className="w-12 h-12 rounded-full bg-blue-500/20 shadow-[0_0_30px_rgba(59,130,246,0.3)]" />
      </div>
      <div className="text-primary text-sm font-black tracking-[0.4em] uppercase select-none opacity-40">
        Sistem Uyku Modunda
      </div>
      <div className="text-secondary text-[10px] font-bold uppercase tracking-[0.2em] mt-3 select-none opacity-30">
        Uyandırmak için dokunun
      </div>
    </div>
  );
});


