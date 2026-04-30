import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BaseTheme = 'pro' | 'tesla' | 'cockpit' | 'mercedes' | 'audi' | 'oled';
export type CarTheme =
  | 'pro' | 'tesla' | 'cockpit' | 'mercedes' | 'audi' | 'oled'
  | 'pro-day' | 'tesla-day' | 'cockpit-day' | 'mercedes-day' | 'audi-day' | 'oled-day'
  | 'sunlight';

export function isDay(theme: CarTheme): boolean {
  return theme.endsWith('-day');
}

export function baseOf(theme: CarTheme): BaseTheme {
  return theme.replace('-day', '') as BaseTheme;
}

export function toDay(theme: CarTheme): CarTheme {
  return `${baseOf(theme)}-day` as CarTheme;
}

export function toNight(theme: CarTheme): CarTheme {
  return baseOf(theme);
}

/** Saat 07:00–19:00 arası gündüz sayılır (useDayNightManager ile aynı aralık). */
export function isDayTime(): boolean {
  const h = new Date().getHours();
  return h >= 7 && h < 19;
}

/**
 * Aktif tema 'oled' / 'oled-day' ise saate uygun varyantı uygular.
 * Başka bir tema aktifse hiçbir şey yapmaz — kullanıcı tercihi korunur.
 * Zustand getState() ile çağrılır; React dışında ve interval içinde güvenli.
 */
export function autoApplyOledVariant(): void {
  const store = useCarTheme.getState();
  if (baseOf(store.theme) !== 'oled') return;
  const target: CarTheme = isDayTime() ? 'oled-day' : 'oled';
  if (store.theme !== target) store.setTheme(target);
}

interface CarThemeState {
  theme: CarTheme;
  setTheme: (t: CarTheme) => void;
}

function applyTheme(theme: CarTheme) {
  document.documentElement.setAttribute('data-theme', theme);
  // Validation: data-theme atamasının DOM'a yansıdığını doğrula (Automotive Grade §R-3)
  if (document.documentElement.getAttribute('data-theme') !== theme) {
    console.error(`[CarTheme] data-theme doğrulama hatası: beklenen "${theme}"`);
  }
  // OLED-Pro GPU doğrulama: --glass-blur 0px olmak zorunda (R-3 sıfır GPU yükü)
  if (theme === 'oled' || theme === 'oled-day') {
    const blur = getComputedStyle(document.documentElement).getPropertyValue('--glass-blur').trim();
    if (blur && blur !== '0px') {
      console.warn(`[CarTheme] OLED GPU kontrol: --glass-blur beklenen 0px, gerçek "${blur}"`);
    }
  }
}

export const useCarTheme = create<CarThemeState>()(
  persist(
    (set) => ({
      theme: 'tesla',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'car-launcher-theme',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const VALID: CarTheme[] = [
          'tesla','audi','mercedes','cockpit','pro','oled',
          'tesla-day','audi-day','mercedes-day','cockpit-day','pro-day','oled-day',
          'sunlight',
        ];
        if (!VALID.includes(state.theme)) state.theme = 'tesla';
        applyTheme(state.theme);
      },
    }
  )
);
