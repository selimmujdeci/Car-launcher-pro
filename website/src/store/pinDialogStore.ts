import { create } from 'zustand';

interface PinDialogState {
  visible:  boolean;
  prompt:   string;
  resolve:  (pin: string | null) => void;
  // Diyaloğu aç — PIN girilince/iptal edilince resolve çağrılır
  show: (prompt: string) => Promise<string | null>;
}

export const usePinDialogStore = create<PinDialogState>((set) => ({
  visible:  false,
  prompt:   '',
  resolve:  () => {},

  show: (prompt) =>
    new Promise<string | null>((res) => {
      set({
        visible: true,
        prompt,
        resolve: (pin) => {
          set({ visible: false });
          res(pin);
        },
      });
    }),
}));
