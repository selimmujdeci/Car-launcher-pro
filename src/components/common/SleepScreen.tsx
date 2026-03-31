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
      className="fixed inset-0 z-[200] bg-black flex items-center justify-center cursor-pointer"
      onClick={onWake}
    >
      <div className="text-white/10 text-xs font-medium tracking-widest uppercase select-none">
        Uyku modu — dokunun
      </div>
    </div>
  );
});
