import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * CockpitOS Core Themes — 4 tema seçimi (CLAUDE.md §UX Simplicity)
 * 
 * Kullanıcı başına 4 tema = optimal seçim, overchoice önleme
 * - tesla: Minimalist premium (Tesla sahipleri)
 * - mercedes: Luxury ambient (Mercedes sahipleri)
 * - pro: Glass Pro — düşük güçlü ARM + Hiworld (senin aracın için önerilen)
 * - sunlight: Güneş altı optimizasyon (açık hava kullanımı)
 * 
 * Arşivlenen temalar (kodda durur, UI'da gösterilmez):
 * - cockpit: Cockpit immersive → pro ile birleştirildi
 * - audi: Sport theme → mercedes ile birleştirildi  
 * - oled: Pure black → pro ile birleştirildi
 */

export type CoreTheme = 'tesla' | 'mercedes' | 'pro' | 'sunlight' | 'expedition' | 'horizon';
export type LegacyTheme = 'cockpit' | 'audi' | 'oled';

export type BaseTheme = CoreTheme | LegacyTheme;
export type CarTheme =
  | CoreTheme
  | `${CoreTheme}-day`  // Günduz varyantlari
  | LegacyTheme         // Arşiv: UI'da gizli ama kodda mevcut
  | `${LegacyTheme}-day`
  | 'sunlight';         // sunlight -day yok, zaten gündüz için optimize

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
 * Core themes for UI display — only 4 themes shown to user
 * Legacy themes accessible via code but hidden from theme selector
 */
export const CORE_THEMES: { id: CoreTheme; label: string; desc: string }[] = [
  { id: 'expedition', label: 'CarOS Expedition', desc: 'Ana tema · Offroad · Day (kum) / Night (pas-metal)' },
  { id: 'horizon',    label: 'CarOS Horizon', desc: 'Premium · harita-odaklı · Day / Night' },
  { id: 'tesla',    label: 'Tesla',      desc: 'Minimalist, premium his' },
  { id: 'mercedes', label: 'Mercedes',   desc: 'Luxury, ambient lighting' },
  { id: 'pro',      label: 'Glass Pro',  desc: 'Düşük güç, Hiworld optimize' },
  { id: 'sunlight', label: 'Sunlight',   desc: 'Güneş altı okunabilirlik' },
];

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
  const root = document.documentElement;
  // Render Guard: data-theme değişimi color/background transition'larını binlerce
  // elemanda aynı anda tetikler → "transition fırtınası" (jank). 'theme-switching'
  // sınıfı geçişleri swap frame'inde bastırır (CSS: html.theme-switching *) →
  // recalc/repaint animasyonsuz, tek seferde olur.
  root.classList.add('theme-switching');
  root.setAttribute('data-theme', theme);
  // Validation: data-theme atamasının DOM'a yansıdığını doğrula (Automotive Grade §R-3)
  if (root.getAttribute('data-theme') !== theme) {
    console.error(`[CarTheme] data-theme doğrulama hatası: beklenen "${theme}"`);
  }
  // OLED-Pro GPU doğrulama: --glass-blur 0px olmak zorunda (R-3 sıfır GPU yükü)
  if (theme === 'oled' || theme === 'oled-day') {
    const blur = getComputedStyle(root).getPropertyValue('--glass-blur').trim();
    if (blur && blur !== '0px') {
      console.warn(`[CarTheme] OLED GPU kontrol: --glass-blur beklenen 0px, gerçek "${blur}"`);
    }
  }
  // Geçişleri bir sonraki frame'de geri aç (rAF) — recalc/paint tamamlandıktan
  // sonra, ana thread'i kilitlemeden. rAF yoksa (test/SSR) senkron temizle (fail-soft).
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => root.classList.remove('theme-switching'));
    });
  } else {
    root.classList.remove('theme-switching');
  }
}

export const useCarTheme = create<CarThemeState>()(
  persist(
    (set) => ({
      theme: 'expedition', // Default: CarOS Expedition (ana tema) — Day kum / Night pas-metal
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'car-launcher-theme',
      version: 1,
      // v1: varsayılan tema 'pro' → 'expedition' (ana tema) oldu.
      // Yalnızca hâlâ ESKİ varsayılanda (pro) olan kurulumları bir kez taşı;
      // kullanıcının bilinçli seçtiği temaları (mercedes/tesla/horizon...) KORU.
      migrate: (persisted) => {
        const s = persisted as Partial<CarThemeState> | undefined;
        if (s && (s.theme === 'pro' || s.theme === 'pro-day')) {
          s.theme = 'expedition';
        }
        return s as CarThemeState;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Tüm geçerli temalar (core + legacy — kullanıcı eski temayı seçtiyse koru)
        const VALID: CarTheme[] = [
          'tesla', 'mercedes', 'pro', 'sunlight', 'expedition', 'horizon',
          'tesla-day', 'mercedes-day', 'pro-day', 'expedition-day', 'horizon-day',
          // Legacy themes — backward compatibility
          'cockpit', 'audi', 'oled',
          'cockpit-day', 'audi-day', 'oled-day',
        ];
        if (!VALID.includes(state.theme)) state.theme = 'expedition';
        // Migration: gündüz yöneticisi eskiden temayı zorla 'sunlight' yapıyordu
        // (premium ProLayout'u fallback'e düşüren bug). Kalıcı 'sunlight'ı
        // premium 'pro'ya geri al. (Tema seçicide 'sunlight' zaten sunulmuyor.)
        if (state.theme === 'sunlight') state.theme = 'pro';
        applyTheme(state.theme);
      },
    }
  )
);
