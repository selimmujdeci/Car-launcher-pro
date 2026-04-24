import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#060d1a',
        surface: '#0a1628',
        'surface-2': '#0f1f38',
        border: 'rgba(255,255,255,0.08)',
        accent: '#3b82f6',
        'accent-dark': '#1d4ed8',
        'text-muted': '#64748b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
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
