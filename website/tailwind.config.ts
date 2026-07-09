import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ── Semantik site tokenları (light + dark, CSS değişken tabanlı) ──
        // Bu tokenlar hem pazarlama sayfalarını hem tema geçişini besler.
        // Dashboard literal hex kullandığı için bu repoint onu ETKİLEMEZ.
        bg: 'var(--st-bg)',
        surface: 'var(--st-surface)',
        'surface-2': 'var(--st-surface-2)',
        card: 'var(--st-card)',
        elevated: 'var(--st-elevated)',
        border: 'var(--st-border)',
        line: 'var(--st-border)',
        'line-2': 'var(--st-border-2)',
        ink: 'var(--st-ink)',
        'ink-2': 'var(--st-ink-2)',
        'ink-3': 'var(--st-ink-3)',
        'ink-4': 'var(--st-ink-4)',
        'text-muted': 'var(--st-ink-3)',
        accent: '#3b82f6',
        'accent-ink': 'var(--st-accent-ink)',
        'accent-solid': 'var(--st-accent-solid)',
        'accent-strong': 'var(--st-accent-strong)',
        'accent-dark': '#1d4ed8',
        'emerald-ink': 'var(--st-emerald-ink)',
        'violet-ink': 'var(--st-violet-ink)',
        'amber-ink': 'var(--st-amber-ink)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.03em',
      },
      backgroundImage: {
        'hero-gradient': 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(59,130,246,0.15) 0%, transparent 60%)',
        'card-gradient': 'linear-gradient(135deg, rgba(59,130,246,0.05) 0%, transparent 60%)',
        'grid-pattern': 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid': '48px 48px',
      },
      boxShadow: {
        'glow': '0 0 40px rgba(59,130,246,0.15)',
        'glow-sm': '0 0 20px rgba(59,130,246,0.1)',
        'card': '0 1px 0 rgba(255,255,255,0.05) inset, 0 -1px 0 rgba(0,0,0,0.3) inset',
        // ── Yumuşak tema-farkında yükseltiler (light modda görünür, dark'ta nötr) ──
        'soft': 'var(--st-shadow-soft)',
        'soft-lg': 'var(--st-shadow-soft-lg)',
        'soft-xl': 'var(--st-shadow-soft-xl)',
      },
      animation: {
        'fade-up':    'fadeUp 0.6s ease-out forwards',
        'slide-up':   'slideUp 0.35s ease-out forwards',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'neon-pulse': 'neonPulse 2.4s ease-in-out infinite',
        'glow-ring':  'glowRing 2.4s ease-in-out infinite',
        'scan-line':  'scanLine 4s linear infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        neonPulse: {
          '0%,100%': { boxShadow: '0 0 4px #34d399, 0 0 10px rgba(52,211,153,0.25)' },
          '50%':     { boxShadow: '0 0 12px #34d399, 0 0 28px rgba(52,211,153,0.5), 0 0 48px rgba(52,211,153,0.18)' },
        },
        glowRing: {
          '0%,100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%':     { opacity: '1',   transform: 'scale(1.25)' },
        },
        scanLine: {
          '0%':   { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(400%)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
