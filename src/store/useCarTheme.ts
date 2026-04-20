import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BaseTheme = 'pro' | 'tesla' | 'cockpit' | 'mercedes' | 'audi';
export type CarTheme =
  | 'pro' | 'tesla' | 'cockpit' | 'mercedes' | 'audi'
  | 'pro-day' | 'tesla-day' | 'cockpit-day' | 'mercedes-day' | 'audi-day';

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

interface CarThemeState {
  theme: CarTheme;
  setTheme: (t: CarTheme) => void;
}

function applyTheme(theme: CarTheme) {
  document.documentElement.setAttribute('data-theme', theme);
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
          'tesla','audi','mercedes','cockpit','pro',
          'tesla-day','audi-day','mercedes-day','cockpit-day','pro-day',
        ];
        if (!VALID.includes(state.theme)) state.theme = 'tesla';
        applyTheme(state.theme);
      },
    }
  )
);
