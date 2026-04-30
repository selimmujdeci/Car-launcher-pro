import { memo, useState } from 'react';
import { useCarTheme, type CarTheme } from '../../store/useCarTheme';
import { useSystemStore } from '../../store/useSystemStore';
import { ThemeStudio } from './ThemeStudio';

const THEMES: { id: CarTheme; label: string; sub: string; accent: string; bg: string; border: string }[] = [
  {
    id: 'sunlight',
    label: '☀ SUNLIGHT',
    sub: 'Güneş Modu · WCAG AAA',
    accent: '#003BB5',
    bg: 'rgba(255,255,255,0.98)',
    border: 'rgba(0,59,181,0.60)',
  },
  {
    id: 'tesla',
    label: 'TESLA',
    sub: 'Model S',
    accent: '#E31937',
    bg: 'rgba(0,0,0,0.95)',
    border: 'rgba(227,25,55,0.35)',
  },
  {
    id: 'audi',
    label: 'AUDI',
    sub: 'Virtual Cockpit',
    accent: '#CC0000',
    bg: 'rgba(10,10,10,0.95)',
    border: 'rgba(204,0,0,0.35)',
  },
  {
    id: 'mercedes',
    label: 'MERCEDES',
    sub: 'MBUX',
    accent: '#C8A96E',
    bg: 'rgba(8,6,6,0.95)',
    border: 'rgba(200,169,110,0.35)',
  },
  {
    id: 'cockpit',
    label: 'COCKPIT',
    sub: 'Glass Cockpit',
    accent: '#00D4FF',
    bg: 'rgba(5,10,16,0.95)',
    border: 'rgba(0,212,255,0.35)',
  },
  {
    id: 'pro',
    label: 'PRO',
    sub: 'Dark Automotive',
    accent: '#ff9800',
    bg: 'rgba(10,12,16,0.97)',
    border: 'rgba(255,152,0,0.40)',
  },
  {
    id: 'oled',
    label: 'OLED PRO',
    sub: 'AMOLED High Contrast',
    accent: '#00E5FF',
    bg: '#000000',
    border: 'rgba(0,229,255,0.40)',
  },
];

export const ThemeSwitcher = memo(function ThemeSwitcher() {
  const { theme, setTheme } = useCarTheme();
  const [open,        setOpen]        = useState(false);
  const [studioOpen,  setStudioOpen]  = useState(false);

  return (
    <>
      {/* Theme Studio — full screen */}
      {studioOpen && <ThemeStudio onClose={() => setStudioOpen(false)} />}

      {/* Toggle butonu */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-24 right-4 z-[9001] w-11 h-11 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
        style={{
          background: 'rgba(0,0,0,0.80)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.60)',
        }}
        title="Tema Değiştir"
      >
        <span className="text-lg leading-none">🎨</span>
      </button>

      {/* Tema paneli */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[8999]"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div
            className="fixed bottom-40 right-4 z-[9000] flex flex-col gap-2 p-3 rounded-3xl"
            style={{
              background: 'rgba(6,6,6,0.95)',
              backdropFilter: 'blur(32px)',
              WebkitBackdropFilter: 'blur(32px)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.80)',
              minWidth: 180,
            }}
          >
            <div className="text-[9px] uppercase tracking-[0.45em] font-light px-2 pb-1"
              style={{ color: 'rgba(255,255,255,0.30)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              TEMA SEÇ
            </div>

            {/* Stüdyo butonu */}
            <button
              onClick={() => { setOpen(false); setStudioOpen(true); }}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-2xl active:scale-95 transition-all w-full"
              style={{
                background: 'rgba(59,130,246,0.12)',
                border: '1px solid rgba(59,130,246,0.3)',
              }}
            >
              <div className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#f59e0b,#a855f7)', boxShadow: '0 0 8px rgba(168,85,247,0.5)' }} />
              <div className="text-left flex-1">
                <div className="text-[11px] font-semibold tracking-wider text-blue-400">Tema Stüdyo</div>
                <div className="text-[9px] font-light" style={{ color: 'rgba(255,255,255,0.25)' }}>Renk · Şekil · İkon · Yazı</div>
              </div>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M3 2l4 3-4 3" stroke="rgba(96,165,250,0.6)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {THEMES.map(t => {
              const active = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id);
                    useSystemStore.getState().setUserOverride(120_000);
                    setOpen(false);
                  }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-2xl active:scale-95 transition-all"
                  style={{
                    background: active ? t.bg : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${active ? t.border : 'rgba(255,255,255,0.05)'}`,
                    boxShadow: active ? `0 4px 20px ${t.accent}20` : 'none',
                  }}
                >
                  {/* Renk noktası */}
                  <div className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{
                      background: t.accent,
                      boxShadow: active ? `0 0 8px ${t.accent}80` : 'none',
                    }} />
                  <div className="text-left">
                    <div className="text-[11px] font-semibold tracking-wider" style={{ color: active ? t.accent : 'rgba(255,255,255,0.60)' }}>
                      {t.label}
                    </div>
                    <div className="text-[9px] font-light" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {t.sub}
                    </div>
                  </div>
                  {active && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: t.accent }} />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
});
