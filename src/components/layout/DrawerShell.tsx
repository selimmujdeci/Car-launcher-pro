import { memo, type ReactNode } from 'react';

interface Props {
  open:    boolean;
  onClose: () => void;
  children: ReactNode;
}

export const DrawerShell = memo(function DrawerShell({ open, onClose, children }: Props) {
  return (
    <div className={`fixed inset-0 z-40 transition-opacity duration-200 ${
      open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
    }`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`absolute inset-x-0 bottom-0 h-[85%] rounded-t-3xl flex flex-col bg-[#0b1424] transition-transform duration-200 ease-out ${
        open ? 'translate-y-0' : 'translate-y-full'
      }`}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-12 h-1 bg-white/20 rounded-full" />
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </div>
    </div>
  );
});
