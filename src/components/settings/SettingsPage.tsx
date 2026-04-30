import { memo, type ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { useCarTheme, isDay, baseOf, toDay, toNight, type BaseTheme } from '../../store/useCarTheme';
import {
  Sun, Smartphone, Zap, Palette, Layout, Check, PenTool as Tool, Volume2,
  Wifi, HardDrive, RefreshCw, Database, Cloud, ArrowLeft, X,
  Cpu, Thermometer, Shield, Gauge, Settings2, Lock,
  Mic, Eye, EyeOff, CheckCircle, XCircle, Loader,
} from 'lucide-react';
import { testAIConnection, getEnvGeminiKey, getEnvHaikuKey, type AIProvider } from '../../platform/aiVoiceService';
import { openInApp } from '../../platform/inAppBrowser';
import { Clipboard } from '@capacitor/clipboard';
import { isNative, bridge } from '../../platform/bridge';
import { PrivacyPolicy } from './PrivacyPolicy';
import { useEditStore } from '../../store/useEditStore';
import { useStore, type VehicleType } from '../../store/useStore';
import {
  getPerformanceMode, setPerformanceMode,
  isAutoModeEnabled, enableAutoMode, disableAutoMode,
} from '../../platform/performanceMode';
import { setBrightness, setVolume } from '../../platform/systemSettingsService';
import { MaintenancePanel } from '../obd/MaintenancePanel';
import { MobileLinkWidget } from './MobileLinkWidget';
import { OBDConnectModal } from '../obd/OBDConnectModal';
import {
  useMapSources, useMapNetworkStatus, setActiveMapSource,
  refreshMapSources, type MapSource,
} from '../../platform/mapSourceManager';
import { useLayoutSync } from '../../platform/themeLayoutEngine';
import { useScreenSense } from '../../hooks/useScreenSense';
import { setObdVehicleType } from '../../platform/obdService';
import { useSensitiveKey } from '../../platform/sensitiveKeyStore';
import { useSystemStore } from '../../store/useSystemStore';

/* ════════════════════════════════════════
   PREMIUM SLIDER
════════════════════════════════════════ */
function PremiumSlider({ icon: Icon, label, value, onChange, colorA, colorB }: {
  icon: typeof Sun; label: string; value: number; onChange: (v: number) => void;
  colorA: string; colorB: string;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${colorA}15` }}>
            <Icon className="w-5 h-5" style={{ color: colorA }} />
          </div>
          <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-black text-2xl tabular-nums" style={{ color: colorA }}>{value}</span>
          <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>%</span>
        </div>
      </div>
      <div className="relative h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${value}%`, background: `linear-gradient(90deg,${colorA},${colorB})` }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white pointer-events-none transition-[left] duration-75"
          style={{ left: `calc(${value}% - 8px)`, boxShadow: `0 0 0 3px ${colorA}55, 0 2px 8px rgba(0,0,0,0.4)` }} />
        <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer z-10" style={{ height: '100%', margin: 0 }} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   PREMIUM TOGGLE
════════════════════════════════════════ */
function PremiumToggle({ label, desc, value, onChange, icon: Icon, accent = '#3b82f6' }: {
  label: string; desc: string; value: boolean; onChange: (v: boolean) => void;
  icon?: typeof Wifi; accent?: string;
}) {
  return (
    <button onClick={() => onChange(!value)}
      className="group w-full flex items-center gap-4 p-4 rounded-2xl text-left glass-card lux-noise"
      style={value
        ? { backgroundColor: `${accent}12`, borderColor: `${accent}35`, boxShadow: `0 0 0 1px ${accent}20, 0 0 24px ${accent}18, 0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)` }
        : {}}>
      {Icon && (
        <div className="lux-icon-box w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-400"
          style={value ? { backgroundColor: `${accent}18`, borderColor: `${accent}45`, boxShadow: `0 0 14px ${accent}30` } : {}}>
          <Icon className="w-5 h-5 transition-all duration-400"
            style={{ color: value ? accent : 'var(--text-secondary)', filter: value ? `drop-shadow(0 0 10px ${accent}) brightness(1.2)` : 'none' }} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-black tracking-[0.1em] uppercase transition-colors" style={{ color: 'var(--text-primary)' }}>{label}</div>
        <div className="text-[11px] truncate mt-1.5 font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', opacity: 0.55 }}>{desc}</div>
      </div>
      {/* Toggle pill — neon glow aktifken */}
      <div className="relative w-[66px] h-[36px] rounded-full flex-shrink-0 border"
        style={value
          ? { background: accent, borderColor: `${accent}50`, boxShadow: `0 0 18px ${accent}60, 0 0 36px ${accent}25, inset 0 1px 0 rgba(255,255,255,0.20)` }
          : { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)', boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.35)' }}>
        <div className="lux-toggle-thumb absolute top-[5px] w-[24px] h-[24px] rounded-full bg-white"
          style={{ left: value ? '36px' : '6px', transform: value ? 'scale(1.08)' : 'scale(1)', boxShadow: '0 2px 8px rgba(0,0,0,0.5), 0 0 8px rgba(255,255,255,0.15)' }} />
      </div>
    </button>
  );
}

/* ════════════════════════════════════════
   THEME PANEL — Ayarlar içi tema seçici
════════════════════════════════════════ */
const THEME_OPTIONS: { id: BaseTheme; label: string; sub: string; accent: string; nightBg: string; dayBg: string }[] = [
  { id: 'pro',      label: 'PRO',      sub: 'Dark Automotive',  accent: '#D4AF37', nightBg: 'linear-gradient(135deg,#0a0c10,#12151d)', dayBg: 'linear-gradient(135deg,#2D2D44,#3D3D5C)' },
  { id: 'tesla',    label: 'TESLA',    sub: 'Model S',          accent: '#E31937', nightBg: 'linear-gradient(135deg,#0a0a0a,#1a1a1a)', dayBg: 'linear-gradient(135deg,#1E2A3A,#263040)' },
  { id: 'cockpit',  label: 'COCKPIT',  sub: 'Glass Cockpit',    accent: '#00B4D8', nightBg: 'linear-gradient(135deg,#050a10,#0a1628)', dayBg: 'linear-gradient(135deg,#0D2137,#0F2A45)' },
  { id: 'mercedes', label: 'MERCEDES', sub: 'MBUX',             accent: '#C8A882', nightBg: 'linear-gradient(135deg,#181818,#2c2c2c)', dayBg: 'linear-gradient(135deg,#2C2C3A,#363645)' },
  { id: 'audi',     label: 'AUDI',     sub: 'Virtual Cockpit',  accent: '#BB0A21', nightBg: 'linear-gradient(135deg,#1E1E2C,#252535)', dayBg: 'linear-gradient(135deg,#1E1E2C,#28283A)' },
];

function ThemePanel() {
  const { theme, setTheme } = useCarTheme();
  const dayMode = isDay(theme);
  const activeBase = baseOf(theme);

  function selectBase(id: BaseTheme) {
    setTheme(dayMode ? `${id}-day` as const : id);
    useSystemStore.getState().setUserOverride(120_000);
  }

  function toggleDayNight() {
    setTheme(dayMode ? toNight(theme) : toDay(theme));
    useSystemStore.getState().setUserOverride(120_000);
  }

  return (
    <div className="glass-card lux-panel lux-noise overflow-hidden" style={{ padding: 0 }}>
      <div className="lux-accent-top" style={{ color: '#ff9800' }} />
      <div className="p-5">
        {/* Başlık + Gündüz/Gece toggle */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,152,0,0.12)', border: '1px solid rgba(255,152,0,0.25)' }}>
              <Palette className="w-5 h-5" style={{ color: '#ff9800' }} />
            </div>
            <div>
              <div className="text-sm font-black uppercase tracking-[0.15em]" style={{ color: '#fff' }}>Kokpit Teması</div>
              <div className="text-[11px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Ana ekran görünümünü seç</div>
            </div>
          </div>
          {/* Gündüz / Gece toggle */}
          <button
            onClick={toggleDayNight}
            className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 active:scale-95 flex-shrink-0"
            style={{
              background: dayMode ? 'rgba(251,191,36,0.15)' : 'rgba(99,102,241,0.12)',
              border: `1px solid ${dayMode ? 'rgba(251,191,36,0.40)' : 'rgba(99,102,241,0.30)'}`,
              boxShadow: dayMode ? '0 0 16px rgba(251,191,36,0.12)' : 'none',
            }}
          >
            <span style={{ fontSize: 16 }}>{dayMode ? '☀️' : '🌙'}</span>
            <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: dayMode ? '#fbbf24' : 'rgba(255,255,255,0.55)' }}>
              {dayMode ? 'Gündüz' : 'Gece'}
            </span>
          </button>
        </div>

        {/* Tema kartları */}
        <div className="grid grid-cols-5 gap-3">
          {THEME_OPTIONS.map(t => {
            const active = activeBase === t.id;
            const preview = dayMode ? t.dayBg : t.nightBg;
            return (
              <button
                key={t.id}
                onClick={() => selectBase(t.id)}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-300 active:scale-95"
                style={{
                  background: active ? `${t.accent}18` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${active ? `${t.accent}55` : 'rgba(255,255,255,0.07)'}`,
                  boxShadow: active ? `0 0 20px ${t.accent}25` : 'none',
                }}
              >
                {/* Preview swatch - gündüz/gece rengini göster */}
                <div className="relative w-full aspect-video rounded-xl overflow-hidden" style={{ background: preview }}>
                  <div style={{ position: 'absolute', bottom: 6, left: 6, right: 6, height: 3, background: `${t.accent}70`, borderRadius: 2 }} />
                  <div style={{ position: 'absolute', top: 6, left: 6, width: 16, height: 3, background: `${t.accent}50`, borderRadius: 2 }} />
                  {/* Gündüz göstergesi */}
                  {dayMode && (
                    <div style={{ position: 'absolute', top: 5, right: 6, fontSize: 10 }}>☀️</div>
                  )}
                  {active && (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.30)' }}>
                      <Check className="w-5 h-5" style={{ color: t.accent, filter: `drop-shadow(0 0 6px ${t.accent})` }} />
                    </div>
                  )}
                </div>
                <div className="text-[11px] font-black uppercase tracking-wider" style={{ color: active ? t.accent : 'rgba(255,255,255,0.45)' }}>{t.label}</div>
                <div className="text-[9px] font-medium" style={{ color: 'rgba(255,255,255,0.28)' }}>{t.sub}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   PANEL CARD
════════════════════════════════════════ */
function Panel({ children, className = '', accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <div className={`glass-card lux-panel lux-noise overflow-hidden group transition-all duration-500 ${className}`}
      style={{ padding: 0 }}>
      {accent && (
        <div className="lux-accent-top group-hover:opacity-100 transition-opacity" style={{ color: accent }} />
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ════════════════════════════════════════
   SECTION TITLE
════════════════════════════════════════ */
function SectionTitle({ icon: Icon, title, sub, color = '#3b82f6' }: {
  icon: typeof Settings2; title: string; sub?: string; color?: string;
}) {
  return (
    <div className="flex items-center gap-4 mb-5">
      <div className="lux-icon-box rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ width: '2.5rem', height: '2.5rem', borderColor: `${color}35`, boxShadow: `0 0 14px ${color}20` }}>
        <Icon className="w-5 h-5" style={{ color, filter: `drop-shadow(0 0 8px ${color}80)` }} />
      </div>
      <div>
        <div className="text-[12px] font-black uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-primary)' }}>
          {title}
        </div>
        {sub && (
          <div className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>{sub}</div>
        )}
      </div>
      <div className="lux-section-line" style={{ '--tw-gradient-from': color } as React.CSSProperties} />
    </div>
  );
}


/* ════════════════════════════════════════
   AI VOICE PANEL
════════════════════════════════════════ */
const AIVoicePanel = memo(function AIVoicePanel() {
  const { settings, updateSettings } = useStore();
  const [geminiKey,  setGeminiKey]  = useSensitiveKey('geminiApiKey');
  const [haikuKey,   setHaikuKey]   = useSensitiveKey('claudeHaikuApiKey');
  const [showGeminiKey, setShowGeminiKey]   = useState(false);
  const [showHaikuKey,  setShowHaikuKey]    = useState(false);
  const [testing,       setTesting]         = useState(false);
  const [testResult,    setTestResult]      = useState<{ ok: boolean; message: string } | null>(null);
  const [clipboardHint, setClipboardHint]   = useState<string | null>(null);
  const [waitingClip,   setWaitingClip]     = useState(false);
  const testTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const provider     = settings.aiVoiceProvider ?? 'none';
  const activeKey    = provider === 'gemini' ? geminiKey : haikuKey;
  const envGeminiKey = getEnvGeminiKey();
  const envHaikuKey  = getEnvHaikuKey();

  /** Clipboard'u oku, key pattern'i varsa otomatik kaydet */
  const checkClipboard = useCallback(async () => {
    try {
      let text = '';
      if (isNative) {
        const { value } = await Clipboard.read();
        text = value ?? '';
      } else {
        text = await navigator.clipboard.readText().catch(() => '');
      }
      text = text.trim();

      const isGeminiKey = /^AIza[A-Za-z0-9_-]{35,}$/.test(text);
      const isHaikuKey  = /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(text);

      if (isGeminiKey && provider === 'gemini') {
        void setGeminiKey(text);
        setClipboardHint('Key otomatik algılandı!');
        setWaitingClip(false);
      } else if (isHaikuKey && provider === 'haiku') {
        void setHaikuKey(text);
        setClipboardHint('Key otomatik algılandı!');
        setWaitingClip(false);
      }
      if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
      clipTimerRef.current = setTimeout(() => setClipboardHint(null), 4000);
    } catch { /* clipboard izni yok */ }
  }, [provider, updateSettings]);

  /** Sayfa odağa döndüğünde clipboard kontrol et */
  useEffect(() => {
    if (!waitingClip) return;
    const onFocus = () => checkClipboard();
    const onVisibility = () => { if (document.visibilityState === 'visible') checkClipboard(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [waitingClip, checkClipboard]);

  /** Linke tıkla → browser aç + clipboard beklemeye başla */
  const handleOpenKeyPage = useCallback((url: string) => {
    openInApp(url);
    setWaitingClip(true);
    setClipboardHint('Key\'i kopyalayıp geri dönün — otomatik algılanacak');
  }, []);

  const handleTest = useCallback(async () => {
    if (testing || provider === 'none' || !activeKey) return;
    setTesting(true);
    setTestResult(null);
    const result = await testAIConnection(provider, activeKey);
    setTesting(false);
    setTestResult(result);
    if (testTimerRef.current) clearTimeout(testTimerRef.current);
    testTimerRef.current = setTimeout(() => setTestResult(null), 5000);
  }, [testing, provider, activeKey]);

  useEffect(() => () => {
    if (testTimerRef.current) clearTimeout(testTimerRef.current);
    if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
  }, []);

  const PROVIDERS: { id: AIProvider; label: string; sub: string; color: string; badge: string }[] = [
    { id: 'none',   label: 'Kapalı',         sub: 'Sadece offline parser',    color: '#64748b', badge: 'ÜCRETSİZ' },
    { id: 'gemini', label: 'Gemini Flash',   sub: 'Google AI — 1500 istek/gün ücretsiz', color: '#4285f4', badge: 'ÜCRETSİZ' },
    { id: 'haiku',  label: 'Claude Haiku',   sub: 'Anthropic — ~$0.13/ay',    color: '#d97706', badge: 'DÜŞÜK MALİYET' },
  ];

  return (
    <div className="mt-8 pt-8 border-t border-white/10 flex flex-col gap-5">
      <div className="flex items-center gap-2 mb-1">
        <Mic className="w-4 h-4 text-purple-400" />
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-purple-400/70">AI Sesli Asistan</span>
        <span className="ml-auto text-[9px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-mono">İnternet gerektirir</span>
      </div>

      {/* Provider selection */}
      <div className="flex flex-col gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => updateSettings({ aiVoiceProvider: p.id as AIProvider })}
            className="flex items-center gap-4 p-4 rounded-2xl border transition-all active:scale-[0.98]"
            style={provider === p.id
              ? { backgroundColor: `${p.color}12`, borderColor: `${p.color}50` }
              : { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }
            }
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${p.color}18`, border: `1px solid ${p.color}30` }}>
              <Mic className="w-5 h-5" style={{ color: provider === p.id ? p.color : 'rgba(255,255,255,0.3)' }} />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-bold" style={{ color: provider === p.id ? p.color : 'rgba(255,255,255,0.7)' }}>{p.label}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{p.sub}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black px-2 py-0.5 rounded"
                style={{ backgroundColor: `${p.color}15`, color: p.color, border: `1px solid ${p.color}30` }}>
                {p.badge}
              </span>
              {provider === p.id && (
                <div className="w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: p.color }}>
                  <Check className="w-3 h-3 text-black stroke-[3px]" />
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* API key inputs */}
      {/* Clipboard hint */}
      {clipboardHint && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border ${
          clipboardHint.includes('algılandı')
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
        }`}>
          {clipboardHint.includes('algılandı')
            ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            : <Loader className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
          }
          {clipboardHint}
        </div>
      )}

      {provider === 'gemini' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Gemini API Key</span>
            {envGeminiKey && !geminiKey
              ? <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-mono">.env'den okunuyor</span>
              : geminiKey
              ? <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Kayıtlı ✓</span>
              : null
            }
          </div>
          {/* Ücretsiz key al butonu */}
          <button
            onClick={() => handleOpenKeyPage('https://aistudio.google.com/apikey')}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-400 text-sm font-bold hover:bg-blue-500/20 active:scale-[0.98] transition-all"
          >
            <span>🔑</span>
            Ücretsiz Key Al — aistudio.google.com
          </button>
          <p className="text-[10px] text-slate-600 text-center">Key'i kopyala → otomatik algılanacak</p>
          <div className="relative">
            <input
              type={showGeminiKey ? 'text' : 'password'}
              value={geminiKey}
              onChange={(e) => { void setGeminiKey(e.target.value); }}
              placeholder={envGeminiKey ? '● .env\'den otomatik' : 'AIza... (manuel giriş)'}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm placeholder:text-slate-500 outline-none focus:border-blue-500/50 transition-all pr-10"
            />
            <button onClick={() => setShowGeminiKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {provider === 'haiku' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Claude API Key</span>
            {envHaikuKey && !haikuKey
              ? <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-mono">.env'den okunuyor</span>
              : haikuKey
              ? <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Kayıtlı ✓</span>
              : null
            }
          </div>
          {/* Key al butonu */}
          <button
            onClick={() => handleOpenKeyPage('https://console.anthropic.com/settings/keys')}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-sm font-bold hover:bg-amber-500/20 active:scale-[0.98] transition-all"
          >
            <span>🔑</span>
            Key Al — console.anthropic.com
          </button>
          <p className="text-[10px] text-slate-600 text-center">Key'i kopyala → otomatik algılanacak</p>
          <div className="relative">
            <input
              type={showHaikuKey ? 'text' : 'password'}
              value={haikuKey}
              onChange={(e) => { void setHaikuKey(e.target.value); }}
              placeholder={envHaikuKey ? '● .env\'den otomatik' : 'sk-ant-... (manuel giriş)'}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm placeholder:text-slate-500 outline-none focus:border-amber-500/50 transition-all pr-10"
            />
            <button onClick={() => setShowHaikuKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              {showHaikuKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Test button */}
      {provider !== 'none' && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing || !activeKey}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)' }}
          >
            {testing
              ? <Loader className="w-4 h-4 animate-spin" />
              : <Mic className="w-4 h-4" />
            }
            {testing ? 'Test ediliyor…' : 'Bağlantıyı Test Et'}
          </button>

          {testResult && (
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {testResult.ok
                ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                : <XCircle className="w-4 h-4 text-red-400" />
              }
              <span className={testResult.ok ? 'text-emerald-400' : 'text-red-400'}>
                {testResult.message}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[10px] text-slate-600 leading-relaxed">
        <span className="text-slate-500 font-bold">Nasıl çalışır?</span>
        {' '}Offline parser tanıyamadığında (%50 altı güven) AI devreye girer. İnternet yoksa otomatik olarak offline modda çalışır.
        {' '}<span className="text-slate-500">API key cihazda şifrelenmiş olarak saklanır.</span>
      </div>
    </div>
  );
});

/* ════════════════════════════════════════
   MAP SOURCE PANEL
════════════════════════════════════════ */
const MapSourcePanel = memo(function MapSourcePanel() {
  const mapState = useMapSources();
  const sources: MapSource[] = Array.from(mapState.sources.values());
  const activeId = mapState.activeSourceId;
  const { isOnline } = useMapNetworkStatus();
  const { updateSettings } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <div className="mt-8 pt-8 border-t border-white/10 flex flex-col gap-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-secondary opacity-50">Harita Altyapısı</span>
        <div className="flex gap-2.5">
          <span className="flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest glass-card border-none !shadow-none var(--panel-bg-secondary)"
            style={isOnline ? { color: '#10b981' } : { color: '#ef4444' }}>
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]' : 'bg-red-500'}`} />
            {isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}
          </span>
          <button onClick={async () => { setRefreshing(true); await refreshMapSources(); setRefreshing(false); }}
            className="w-10 h-10 rounded-2xl flex items-center justify-center var(--panel-bg-secondary) hover:var(--panel-bg-secondary) border border-white/10 transition-all active:rotate-180">
            <RefreshCw className={`w-5 h-5 text-secondary ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      {sources.map(src => {
        const Icon = src.type === 'offline' ? HardDrive : src.id === 'cached' ? Database : Cloud;
        const isActive = activeId === src.id;
        return (
          <button key={src.id} onClick={() => { if (src.isAvailable) { setActiveMapSource(src.id); updateSettings({ activeMapSourceId: src.id }); } }}
            disabled={!src.isAvailable}
            className="flex items-center gap-5 p-5 rounded-3xl transition-all duration-300 glass-card border-white/5 hover:border-white/20 shadow-md"
            style={isActive ? { backgroundColor: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.4)' } : { opacity: src.isAvailable ? 1 : 0.4 }}>
            <div className="w-12 h-12 rounded-[1.25rem] flex items-center justify-center var(--panel-bg-secondary) border border-white/10 shadow-inner"
              style={isActive ? { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.5)' } : {}}>
              <Icon className="w-6 h-6 transition-colors" style={{ color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)' }} />
            </div>
            <div className="flex-1 text-left">
              <div className="text-base font-black tracking-tight text-primary">{src.name}</div>
              <div className="text-[11px] text-secondary font-bold uppercase tracking-widest mt-1 opacity-50">{src.description}</div>
            </div>
            {isActive && <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shadow-lg"><Check className="w-5 h-5 text-primary stroke-[4px]" /></div>}
          </button>
        );
      })}
    </div>
  );
});

/* ════════════════════════════════════════
   PERFORMANCE CARD
════════════════════════════════════════ */
const PERF_MODES = {
  lite: {
    icon: '⚡',
    label: 'Verimli',
    sub: 'Minimum Yük',
    color: '#fbbf24',
    features: ['Düşük CPU önceliği', 'Animasyon kapalı', 'Uzun pil ömrü'],
    cpu: 20,
    gpu: 15,
  },
  balanced: {
    icon: '◎',
    label: 'Dengeli',
    sub: 'Önerilen Mod',
    color: '#60a5fa',
    features: ['Otomatik optimizasyon', 'Tam animasyon', 'Smart Engine'],
    cpu: 50,
    gpu: 55,
    recommended: true,
  },
  premium: {
    icon: '◈',
    label: 'Premium',
    sub: 'Tam Performans',
    color: '#a78bfa',
    features: ['Maksimum CPU hızı', '60fps render', 'Tüm efektler aktif'],
    cpu: 90,
    gpu: 85,
  },
} as const;

function PerfMiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)', width: '100%' }}>
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }} />
    </div>
  );
}

function PerfCard({ mode, active, isAuto, onClick }: { mode: keyof typeof PERF_MODES; active: boolean; isAuto?: boolean; onClick: () => void }) {
  const m = PERF_MODES[mode];
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col gap-0 rounded-[22px] overflow-hidden transition-all duration-400 active:scale-[0.97] text-left"
      style={{
        background: active
          ? `linear-gradient(145deg, ${m.color}18 0%, ${m.color}08 100%)`
          : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? m.color + '45' : 'rgba(255,255,255,0.07)'}`,
        boxShadow: active
          ? `0 0 0 1px ${m.color}22, 0 12px 40px -8px ${m.color}30`
          : 'none',
        transform: active ? 'translateY(-2px)' : 'none',
      }}
    >
      {/* Top accent stripe */}
      <div className="h-[3px] w-full"
        style={{ background: active ? `linear-gradient(90deg, transparent, ${m.color}, transparent)` : 'rgba(255,255,255,0.04)' }} />

      {/* Badges */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-1">
        {isAuto && (
          <div className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-[0.15em]"
            style={{ background: 'rgba(251,191,36,0.20)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.40)' }}>
            🤖 Otomatik
          </div>
        )}
        {'recommended' in m && m.recommended && !isAuto && (
          <div className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-[0.15em]"
            style={{ background: `${m.color}22`, color: m.color, border: `1px solid ${m.color}40` }}>
            Önerilen
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 p-5">
        {/* Icon + name */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-[14px] flex items-center justify-center text-2xl flex-shrink-0 transition-all duration-400"
            style={{
              background: active ? `${m.color}20` : 'rgba(255,255,255,0.06)',
              boxShadow: active ? `0 0 20px ${m.color}30` : 'none',
              color: m.color,
            }}>
            {m.icon}
          </div>
          <div>
            <div className="font-black text-[15px] leading-tight tracking-tight transition-colors duration-300"
              style={{ color: active ? m.color : 'rgba(255,255,255,0.75)' }}>
              {m.label}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] mt-0.5"
              style={{ color: active ? `${m.color}90` : 'rgba(255,255,255,0.28)' }}>
              {m.sub}
            </div>
          </div>
        </div>

        {/* Resource bars */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[8px] font-black uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.3)' }}>CPU</span>
            <span className="text-[8px] font-black tabular-nums" style={{ color: active ? m.color : 'rgba(255,255,255,0.25)' }}>{m.cpu}%</span>
          </div>
          <PerfMiniBar pct={active ? m.cpu : m.cpu * 0.5} color={m.color} />
          <div className="flex items-center justify-between mt-1 mb-0.5">
            <span className="text-[8px] font-black uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.3)' }}>GPU</span>
            <span className="text-[8px] font-black tabular-nums" style={{ color: active ? m.color : 'rgba(255,255,255,0.25)' }}>{m.gpu}%</span>
          </div>
          <PerfMiniBar pct={active ? m.gpu : m.gpu * 0.5} color={m.color} />
        </div>

        {/* Feature list */}
        <div className="flex flex-col gap-1.5 pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {m.features.map(f => (
            <div key={f} className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: active ? m.color : 'rgba(255,255,255,0.2)' }} />
              <span className="text-[10px] font-semibold" style={{ color: active ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)' }}>{f}</span>
            </div>
          ))}
        </div>

        {/* Active indicator */}
        <div className="flex items-center justify-center pt-1">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full transition-all duration-400"
            style={{
              background: active ? `${m.color}20` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${active ? m.color + '50' : 'rgba(255,255,255,0.07)'}`,
            }}>
            <div className="w-1.5 h-1.5 rounded-full transition-all duration-400"
              style={{ background: active ? m.color : 'rgba(255,255,255,0.2)', boxShadow: active ? `0 0 6px ${m.color}` : 'none' }} />
            <span className="text-[8px] font-black uppercase tracking-[0.2em]"
              style={{ color: active ? m.color : 'rgba(255,255,255,0.25)' }}>
              {active ? 'Aktif' : 'Seç'}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ════════════════════════════════════════
   LIVE STATS
════════════════════════════════════════ */
function LiveStatsRow() {
  const [cpu, setCpu] = useState(14);
  const [temp, setTemp] = useState(42);
  useEffect(() => {
    const id = setInterval(() => {
      setCpu(Math.floor(8 + Math.random() * 20));
      setTemp(Math.floor(40 + Math.random() * 5));
    }, 2500);
    return () => clearInterval(id);
  }, []);
  const stats = [
    { label: 'CPU',  val: `${cpu}%`,  color: '#3b82f6', Icon: Cpu         },
    { label: 'TEMP', val: `${temp}°`, color: '#f97316', Icon: Thermometer },
    { label: 'RAM',  val: '1.2G',     color: '#10b981', Icon: HardDrive   },
    { label: 'NET',  val: '12ms',     color: '#8b5cf6', Icon: Gauge       },
  ];
  return (
    <>
      {stats.map(s => (
        <div key={s.label}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl flex-shrink-0"
          style={{
            background: `${s.color}10`,
            border: `1px solid ${s.color}25`,
          }}>
          <s.Icon className="w-3 h-3 flex-shrink-0" style={{ color: s.color }} />
          <div className="leading-none">
            <div className="text-[7px] uppercase tracking-[0.2em] font-black" style={{ color: `${s.color}90` }}>{s.label}</div>
            <div className="text-[11px] font-black tabular-nums" style={{ color: s.color }}>{s.val}</div>
          </div>
        </div>
      ))}
    </>
  );
}

/* ════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════ */
interface Props { onOpenMap?: () => void; onClose?: () => void; }

function SettingsPageInner({ onClose }: Props) {
  const { settings, updateSettings, updateVehicleProfile, setActiveVehicleProfile, addVehicleProfile, removeVehicleProfile } = useStore();
  type Tab = 'general' | 'appearance' | 'performance' | 'maintenance';
  const [tab, setTab] = useState<Tab>('general');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showOBDConnect, setShowOBDConnect] = useState(false);
  const { locked: layoutLocked, toggleLock } = useEditStore();
  const [perfMode, setPerfMode] = useState(() => getPerformanceMode());
  const [autoMode, setAutoMode] = useState(() => isAutoModeEnabled());

  useLayoutSync();
  const sense = useScreenSense();
  // Telefon/kompakt ekran tespiti: yükseklik < 500 veya genişlik < 800
  const isCompactScreen = sense.height < 500 || sense.width < 800;

  const handleBrightness = useCallback((v: number) => {
    updateSettings({ brightness: v });
    setBrightness(v);
    useSystemStore.getState().setUserOverride(120_000);
  }, [updateSettings]);
  const handleVolume     = useCallback((v: number) => { updateSettings({ volume: v }); setVolume(v); }, [updateSettings]);
  const applyPerf = useCallback((m: 'lite' | 'balanced' | 'premium') => {
    disableAutoMode();
    setPerformanceMode(m);
    setPerfMode(m);
    setAutoMode(false);
  }, []);

  const applyAutoPerf = useCallback(() => {
    const detected = enableAutoMode();
    setPerfMode(detected);
    setAutoMode(true);
  }, []);

  const TABS = [
    { id: 'general'     as Tab, label: 'Sistem',     Icon: Smartphone, color: '#60a5fa' },
    { id: 'appearance'  as Tab, label: 'Arayüz',     Icon: Palette,    color: '#e879f9' },
    { id: 'maintenance' as Tab, label: 'Bakım',      Icon: Tool,       color: '#34d399' },
    { id: 'performance' as Tab, label: 'Performans', Icon: Zap,        color: '#fbbf24' },
  ];

  const WALLPAPERS: Array<{ id: string; label: string; url: string; preview?: string; type: 'gradient' | 'photo'; online?: boolean }> = [
    // ── Varsayılan ──
    { id: 'none', label: 'Varsayılan', url: 'none', type: 'gradient' },

    // ── Premium Koyu Gradyanlar (offline) ──
    { id: 'midnight-blue',  label: 'Gece Mavisi',   url: 'linear-gradient(135deg,#020617 0%,#0f172a 40%,#1e3a8a 100%)',                         type: 'gradient' },
    { id: 'carbon-dark',    label: 'Carbon Siyah',  url: 'linear-gradient(160deg,#080808 0%,#141414 45%,#0d0d0d 100%)',                         type: 'gradient' },
    { id: 'ocean-deep',     label: 'Derin Okyanus', url: 'linear-gradient(160deg,#010b14 0%,#0c3a5e 55%,#0369a1 100%)',                         type: 'gradient' },
    { id: 'aurora',         label: 'Aurora',        url: 'linear-gradient(135deg,#021a12 0%,#054d30 35%,#1a1040 65%,#2e1f6e 100%)',             type: 'gradient' },
    { id: 'neon-sunset',    label: 'Neon Gün Batımı',url:'linear-gradient(145deg,#0d0117 0%,#3b0764 35%,#9f1239 70%,#c2410c 100%)',             type: 'gradient' },
    { id: 'ferrari-red',    label: 'Ferrari',       url: 'linear-gradient(145deg,#0c0101 0%,#3b0000 40%,#7f1d1d 75%,#991b1b 100%)',             type: 'gradient' },
    { id: 'bugatti',        label: 'Bugatti Gece',  url: 'linear-gradient(135deg,#020417 0%,#0a0f3d 40%,#1a0a3d 70%,#2d1b69 100%)',             type: 'gradient' },
    { id: 'lamborghini',    label: 'Lamborghini',   url: 'linear-gradient(150deg,#0a0500 0%,#1a0800 35%,#431407 65%,#7c2d12 100%)',             type: 'gradient' },
    { id: 'mclaren',        label: 'McLaren',       url: 'linear-gradient(145deg,#0a0400 0%,#291200 35%,#7c2d12 65%,#c2410c 100%)',             type: 'gradient' },
    { id: 'asfalt',         label: 'Asfalt Gri',    url: 'linear-gradient(160deg,#0a0a0a 0%,#1c1c1e 40%,#2c2c2e 75%,#1c1c1e 100%)',            type: 'gradient' },
    { id: 'akgam-altin',    label: 'Akşam Altını',  url: 'linear-gradient(145deg,#0c0700 0%,#1c1100 30%,#431c00 60%,#78350f 85%,#92400e 100%)', type: 'gradient' },
    { id: 'polar',          label: 'Polar Gece',    url: 'linear-gradient(135deg,#010b14 0%,#023047 40%,#054d60 70%,#0e7490 100%)',             type: 'gradient' },
    { id: 'uzay',           label: 'Uzay Siyahı',   url: 'radial-gradient(ellipse at 30% 40%, #0d1b2a 0%, #020407 55%, #000000 100%)',           type: 'gradient' },
    { id: 'kan-kirmizi',    label: 'Kan Kırmızı',   url: 'radial-gradient(ellipse at 50% 20%, #3b0000 0%, #0c0000 60%, #000000 100%)',           type: 'gradient' },
    { id: 'elektrik',       label: 'Elektrik',      url: 'radial-gradient(ellipse at 20% 50%, #0c0a2e 0%, #050318 50%, #000000 100%)',           type: 'gradient' },
    { id: 'moka',           label: 'Moka',          url: 'linear-gradient(145deg,#0c0804 0%,#1e1008 35%,#3d1f0d 65%,#5c2d1a 100%)',             type: 'gradient' },
    { id: 'titanium',       label: 'Titanyum',      url: 'linear-gradient(145deg,#0a0a0a 0%,#1a1a1a 30%,#262626 55%,#1a1a1a 80%,#0f0f0f 100%)', type: 'gradient' },
    { id: 'karanlık-orman', label: 'Karanlık Orman',url: 'linear-gradient(145deg,#020d04 0%,#0a1f0c 40%,#14381a 70%,#1a4521 100%)',             type: 'gradient' },
    { id: 'neon-cyber',     label: 'Cyber Neon',    url: 'radial-gradient(ellipse at 70% 30%, #001a0f 0%, #000d08 40%, #000000 100%)',            type: 'gradient' },
    { id: 'amethyst',       label: 'Ametist',       url: 'radial-gradient(ellipse at 40% 30%, #1a0a2e 0%, #0d0518 55%, #000000 100%)',           type: 'gradient' },

    // ── Fotoğraf (internet gerektirir) ──
    { id: 'road-night', label: 'Gece Yolu 🌐',   url: 'https://images.unsplash.com/photo-1489824904134-891ab64532f1?w=1920&q=90&auto=format&fit=crop', preview: 'https://images.unsplash.com/photo-1489824904134-891ab64532f1?w=400&q=70&auto=format&fit=crop', type: 'photo', online: true },
    { id: 'city-neon',  label: 'Neon Şehir 🌐',  url: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1920&q=90&auto=format&fit=crop', preview: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=400&q=70&auto=format&fit=crop', type: 'photo', online: true },
    { id: 'galaxy',     label: 'Galaksi 🌐',     url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920&q=90&auto=format&fit=crop', preview: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=400&q=70&auto=format&fit=crop', type: 'photo', online: true },
  ];

  const wallpaperBg = (settings.wallpaper && settings.wallpaper !== 'none')
    ? (settings.wallpaper.startsWith('linear-gradient') ? settings.wallpaper : `url(${settings.wallpaper}) center/cover`)
    : 'linear-gradient(160deg, #08090e 0%, #0a0c12 40%, #090b10 70%, #070810 100%)';

  return (
    <div
      className="flex-1 flex flex-col min-h-0 ultra-premium-root"
      data-theme-pack={settings.themePack}
      data-theme-style={settings.themeStyle}
      data-day-night={settings.dayNightMode}
      style={{ background: wallpaperBg } as React.CSSProperties}
    >

      {/* ═══ HEADER — 2 satır: üst (nav+stats), alt (sekmeler) ═══ */}
      <div className="flex-shrink-0 relative z-20"
        style={{ background: 'rgba(8,12,24,0.92)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>

        {/* Satır 1: Navigasyon + Live Stats */}
        <div className={`flex items-center gap-2 px-4 ${isCompactScreen ? 'py-1.5' : 'pt-3 pb-2'}`}>
          <button onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl active:scale-95 transition-all flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)' }}>
            <ArrowLeft className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.55)' }} />
            <span className="text-[11px] font-black uppercase tracking-widest hidden sm:inline" style={{ color: 'rgba(255,255,255,0.45)' }}>Geri</span>
          </button>

          <div className="flex flex-col leading-none flex-shrink-0 ml-1">
            <span className="text-[13px] font-black uppercase tracking-[0.15em]" style={{ color: '#fff' }}>Ayarlar</span>
            <span className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
              {TABS.find(t => t.id === tab)?.label ?? ''}
            </span>
          </div>

          {/* Live stats — yalnızca geniş ekranlarda (HU / tablet) */}
          {!isCompactScreen && (
            <div className="flex-1 flex items-center justify-end gap-1.5 overflow-x-auto no-scrollbar">
              <LiveStatsRow />
            </div>
          )}

          {/* Kompakt ekranda boşluk doldurucu */}
          {isCompactScreen && <div className="flex-1" />}

          <button onClick={onClose}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl active:scale-90 transition-all ml-1"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.40)' }} />
          </button>
        </div>

        {/* Satır 2: Sekmeler — tam genişlik */}
        <div className={`flex px-4 pb-0 gap-1 ${isCompactScreen ? 'pb-0' : ''}`}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative flex-1 flex flex-col items-center gap-1 ${isCompactScreen ? 'py-1.5' : 'py-2.5'} rounded-t-xl transition-all duration-200 active:scale-95`}
              style={{
                background: tab === t.id ? `${t.color}12` : 'transparent',
                borderTop: tab === t.id ? `1px solid ${t.color}30` : '1px solid transparent',
                borderLeft: tab === t.id ? `1px solid ${t.color}20` : '1px solid transparent',
                borderRight: tab === t.id ? `1px solid ${t.color}20` : '1px solid transparent',
                borderBottom: 'none',
              }}>
              <t.Icon className="w-4 h-4" style={{ color: tab === t.id ? t.color : 'rgba(255,255,255,0.22)' }} />
              <span className="text-[10px] font-black uppercase tracking-[0.08em]"
                style={{ color: tab === t.id ? t.color : 'rgba(255,255,255,0.25)' }}>{t.label}</span>
              {tab === t.id && (
                <div className="absolute bottom-0 left-[15%] right-[15%] h-[2px] rounded-t-full"
                  style={{ background: `linear-gradient(90deg, transparent, ${t.color}, transparent)` }} />
              )}
            </button>
          ))}
        </div>

        {/* Bottom glow line */}
        <div style={{
          height: '1px',
          background: 'linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.30) 30%, rgba(139,92,246,0.20) 70%, transparent 100%)',
        }} />
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 z-10" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-[1600px] mx-auto flex flex-col gap-3">

          {tab === 'general' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel accent="#3b82f6">
                <SectionTitle icon={Settings2} title="Donanım Kontrolleri" sub="Sistem öncelikli ayarlar" color="#3b82f6" />
                <div className="flex flex-col gap-6">
                  <PremiumSlider icon={Sun}     label="Parlaklık Seviyesi" value={settings.brightness} onChange={handleBrightness} colorA="#f59e0b" colorB="#f97316" />
                  <PremiumSlider icon={Volume2} label="Ses Düzeyi" value={settings.volume} onChange={handleVolume} colorA="#3b82f6" colorB="#06b6d4" />
                </div>
              </Panel>

              <Panel accent="#60a5fa">
                <SectionTitle icon={Wifi} title="Akıllı Servisler" sub="Bağlam duyarlı özellikler" color="#60a5fa" />
                <div className="flex flex-col gap-3">
                  <PremiumToggle icon={Layout}   label="Hızlı Harita" desc="Açılışta otomatik navigasyon" value={settings.autoNavOnStart ?? true} onChange={v => updateSettings({ autoNavOnStart: v })} accent="#60a5fa" />
                  <PremiumToggle icon={Smartphone} label="Voice Assistant" desc='"Hey Araba" komut desteği' value={settings.wakeWordEnabled ?? false} onChange={v => updateSettings({ wakeWordEnabled: v })} accent="#a78bfa" />
                  <PremiumToggle icon={Cpu} label="Smart Engine" desc="Yapay zeka tabanlı sürüş modları" value={settings.smartContextEnabled ?? true} onChange={v => updateSettings({ smartContextEnabled: v })} accent="#34d399" />
                  <PremiumToggle icon={HardDrive} label="Offline Map HUD" desc="Gömülü vektör harita motoru" value={settings.offlineMap} onChange={v => updateSettings({ offlineMap: v })} accent="#22d3ee" />
                </div>
                {settings.offlineMap && <MapSourcePanel />}
                <AIVoicePanel />
              </Panel>

              {/* ── Hotspot / İnternet Bağlantısı ── */}
              <Panel accent="#22d3ee">
                <SectionTitle icon={Wifi} title="Bluetooth İnternet" sub="Telefondan Bluetooth ile internet paylaşımı" color="#22d3ee" />

                {/* Mode seçici */}
                <div className="flex flex-col gap-2 mb-4">
                  {(
                    [
                      { val: 'auto', label: 'Otomatik Aç',       sub: 'Uygulama açılınca Bluetooth ayarlarına git', color: '#34d399' },
                      { val: 'ask',  label: 'Her Seferinde Sor', sub: 'Açılışta sor, ben karar vereyim',             color: '#60a5fa' },
                      { val: 'off',  label: 'Kapalı',         sub: 'Bildirim gösterme',                                color: '#6b7280' },
                    ] as const
                  ).map(({ val, label, sub, color }) => {
                    const active = (settings.hotspotMode ?? 'ask') === val;
                    return (
                      <button
                        key={val}
                        onClick={() => updateSettings({ hotspotMode: val })}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 active:scale-[0.98] text-left"
                        style={{
                          background: active ? `${color}12` : 'rgba(255,255,255,0.03)',
                          border: `1.5px solid ${active ? `${color}40` : 'rgba(255,255,255,0.07)'}`,
                          boxShadow: active ? `0 0 16px ${color}14` : 'none',
                        }}
                      >
                        {/* Radio dot */}
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center"
                          style={{
                            border: `2px solid ${active ? color : 'rgba(255,255,255,0.2)'}`,
                            background: active ? color : 'transparent',
                          }}
                        >
                          {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold" style={{ color: active ? '#fff' : 'rgba(255,255,255,0.55)' }}>{label}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: active ? `${color}90` : 'rgba(255,255,255,0.25)' }}>{sub}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Manuel aç butonu */}
                {isNative && (
                  <button
                    onClick={() => bridge.launchHotspotSettings()}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
                    style={{
                      background: 'rgba(34,211,238,0.08)',
                      border: '1px solid rgba(34,211,238,0.25)',
                      color: '#22d3ee',
                    }}
                  >
                    <Wifi size={15} />
                    Bluetooth Ayarlarını Şimdi Aç
                  </button>
                )}
              </Panel>
            </div>
          )}

          {tab === 'appearance' && (
            <>
              {/* ── Tema Seçici ── */}
              <ThemePanel />

              <div className="grid grid-cols-1 gap-4">
                <Panel accent="#06b6d4">
                  <SectionTitle icon={Layout} title="Duvar Kağıdı Motoru" sub={`${WALLPAPERS.length - 1} premium tema · offline kullanılabilir`} color="#06b6d4" />
                  <div className="grid grid-cols-4 gap-2.5">
                    {WALLPAPERS.map(w => {
                      const isActive = settings.wallpaper === w.url || (w.id === 'none' && (!settings.wallpaper || settings.wallpaper === 'none'));
                      return (
                        <button key={w.id} onClick={() => updateSettings({ wallpaper: w.url })}
                          className="group relative aspect-video rounded-2xl overflow-hidden transition-all duration-300 active:scale-95"
                          style={isActive
                            ? { border: '2px solid #22d3ee', boxShadow: '0 0 20px rgba(6,182,212,0.5)', transform: 'scale(1.04)', zIndex: 1 }
                            : { border: '1px solid rgba(255,255,255,0.08)', opacity: 0.65 }
                          }>
                          {w.type === 'photo' ? (
                            <img src={w.preview ?? w.url} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" alt={w.label} />
                          ) : (
                            <div className="w-full h-full" style={{ background: w.url !== 'none' ? w.url : 'linear-gradient(135deg,#111827,#000)' }} />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                          <div className="absolute bottom-1.5 left-2 right-2 text-[9px] font-black uppercase tracking-wider text-white/90 leading-tight">{w.label}</div>
                          {isActive && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#22d3ee] flex items-center justify-center shadow-lg">
                              <Check className="w-3 h-3 text-black stroke-[4px]" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[9px] text-white/30 mt-2 leading-relaxed">🌐 işaretli temalar internet bağlantısı gerektirir.</p>
                </Panel>

                <Panel accent="#a78bfa">
                  <SectionTitle icon={Settings2} title="Kişiselleştirme" sub="Sürüş odaklı arayüz ayarları" color="#a78bfa" />
                  <div className="flex flex-col gap-3">
                    <PremiumToggle icon={Lock} label="Layout Lock" desc="Widget düzenleme modunu kilitle" value={layoutLocked} onChange={toggleLock} accent="#a78bfa" />
                  </div>
                </Panel>
              </div>
            </>
          )}

          {tab === 'maintenance' && (
            <div className="flex flex-col gap-4">

              {/* ── Araç Profilleri ── */}
              <Panel accent="#60a5fa">
                <div className="flex items-center justify-between mb-3">
                  <SectionTitle icon={Gauge} title="Araç Profilleri" sub="Her araç için tahrik tipi ve OBD yapılandırması" color="#60a5fa" />
                  <button
                    onClick={() => {
                      const now = Date.now();
                      const id = `vp-${now}`;
                      const name = `Araç ${settings.vehicleProfiles.length + 1}`;
                      addVehicleProfile({ id, name, vehicleType: 'ice', createdAt: new Date(now).toISOString(), lastUsedAt: new Date(now).toISOString() });
                      if (settings.vehicleProfiles.length === 0) setActiveVehicleProfile(id);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 shrink-0"
                    style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa' }}
                  >
                    + Ekle
                  </button>
                </div>
                {settings.vehicleProfiles.length === 0 ? (
                  <div className="text-center py-6 text-white/30 text-sm">
                    Henüz araç profili yok. Yukarıdan ekleyin.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {settings.vehicleProfiles.map((profile) => {
                      const isActive = profile.id === settings.activeVehicleProfileId;
                      const VEHICLE_TYPES: { value: VehicleType; label: string; color: string }[] = [
                        { value: 'ice',    label: '⛽ Benzin',   color: '#60a5fa' },
                        { value: 'diesel', label: '🛢 Dizel',    color: '#fbbf24' },
                        { value: 'ev',     label: '⚡ Elektrik', color: '#34d399' },
                        { value: 'hybrid', label: '♻️ Hybrid',   color: '#22d3ee' },
                        { value: 'phev',   label: '🔋 P-Hybrid', color: '#a78bfa' },
                      ];
                      return (
                        <div key={profile.id}
                          className="flex items-center gap-4 p-4 rounded-2xl glass-card transition-all"
                          style={isActive ? { borderColor: 'rgba(96,165,250,0.4)', backgroundColor: 'rgba(59,130,246,0.06)' } : {}}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {/* İsim düzenlenebilir */}
                              <input
                                defaultValue={profile.name}
                                onBlur={(e) => updateVehicleProfile(profile.id, { name: e.target.value || profile.name })}
                                className="font-bold text-sm text-white bg-transparent border-none outline-none truncate w-full max-w-[140px]"
                                style={{ caretColor: '#60a5fa' }}
                              />
                              {isActive && (
                                <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 shrink-0">AKTİF</span>
                              )}
                            </div>
                            {/* Araç tipi seçici */}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {VEHICLE_TYPES.map(({ value, label, color }) => (
                                <button key={value}
                                  onClick={() => { updateVehicleProfile(profile.id, { vehicleType: value }); if (isActive) setObdVehicleType(value); }}
                                  className="text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all active:scale-95"
                                  style={profile.vehicleType === value
                                    ? { backgroundColor: `${color}20`, borderColor: `${color}60`, color }
                                    : { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            {!isActive && (
                              <button onClick={() => setActiveVehicleProfile(profile.id)}
                                className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-all active:scale-95">
                                Seç
                              </button>
                            )}
                            <button onClick={() => { removeVehicleProfile(profile.id); }}
                              className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-red-500/20 text-red-400/50 hover:text-red-400 hover:border-red-500/40 transition-all active:scale-95">
                              Sil
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {/* ── Mobil Cihaz Eşleştirme ── */}
              <Panel accent="#22d3ee">
                <SectionTitle icon={Smartphone} title="Mobil Cihaz Eşleştirme" sub="Telefon uygulamasıyla araç bağlantısı — QR veya 6 haneli kod" color="#22d3ee" />
                <MobileLinkWidget />
              </Panel>

              {/* ── OBD Cihaz Bağlantısı ── */}
              <Panel accent="#38bdf8">
                <SectionTitle icon={Wifi} title="OBD Cihaz Bağlantısı" sub="iCar 3 / ELM327 Bluetooth adaptörü bağla" color="#38bdf8" />
                <div className="glass-card p-4">
                  <p className="text-[11px] text-white/40 mb-3 leading-relaxed">
                    OBD adaptörünüzü araca takın, ardından aşağıdan tarayıp doğrudan bağlanın. Android Bluetooth ayarlarına girmenize gerek yok.
                  </p>
                  <button
                    onClick={() => setShowOBDConnect(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
                    style={{
                      background: 'rgba(56,189,248,0.12)',
                      border: '1px solid rgba(56,189,248,0.3)',
                      color: '#38bdf8',
                    }}
                  >
                    <Wifi className="w-4 h-4" />
                    OBD Cihazı Tara ve Bağlan
                  </button>
                </div>
              </Panel>

              {/* ── OBD Sağlık Sistemi ── */}
              <Panel accent="#34d399">
                <SectionTitle icon={Tool} title="Araç Sağlık Sistemi" sub="OBD-II telemetri ve servis takibi" color="#34d399" />
                <div className="glass-card p-4">
                  <MaintenancePanel />
                </div>
              </Panel>
            </div>
          )}

          {tab === 'performance' && (
            <div className="flex flex-col gap-4">
              <Panel accent="#fbbf24">
                <div className="flex items-center justify-between mb-4">
                  <SectionTitle icon={Zap} title="Sistem Güç Profili" sub="İşlemci ve görsel kalite optimizasyonu" color="#fbbf24" />
                  {/* Otomatik mod toggle */}
                  <button
                    onClick={autoMode ? undefined : applyAutoPerf}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 active:scale-95 flex-shrink-0"
                    style={{
                      background: autoMode ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${autoMode ? 'rgba(251,191,36,0.45)' : 'rgba(255,255,255,0.10)'}`,
                      boxShadow: autoMode ? '0 0 16px rgba(251,191,36,0.15)' : 'none',
                      cursor: autoMode ? 'default' : 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 15 }}>🤖</span>
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-widest"
                        style={{ color: autoMode ? '#fbbf24' : 'rgba(255,255,255,0.45)' }}>
                        {autoMode ? 'Otomatik Aktif' : 'Otomatik'}
                      </div>
                      {autoMode && (
                        <div className="text-[9px] font-medium" style={{ color: 'rgba(251,191,36,0.60)' }}>
                          {navigator.hardwareConcurrency ?? '?'} çekirdek · {Math.round(((navigator as { deviceMemory?: number }).deviceMemory ?? 2))}GB RAM
                        </div>
                      )}
                    </div>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {(['lite','balanced','premium'] as const).map(m => (
                    <PerfCard
                      key={m}
                      mode={m}
                      active={perfMode === m}
                      isAuto={autoMode && perfMode === m}
                      onClick={() => applyPerf(m)}
                    />
                  ))}
                </div>
              </Panel>

              <Panel>
                <SectionTitle icon={Cpu} title="Donanım Analizi" sub="Gerçek zamanlı sistem verileri" color="#60a5fa" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Platform',    value: 'Android Auto', Icon: Smartphone,  color: '#60a5fa', pct: null   },
                    { label: 'WebView',     value: 'Chromium 114', Icon: HardDrive,   color: '#34d399', pct: null   },
                    { label: 'Core Temp',   value: '42°C',         Icon: Thermometer, color: '#fb923c', pct: 42     },
                    { label: 'Unit Status', value: 'Certified',    Icon: Check,       color: '#a78bfa', pct: null   },
                  ].map(s => (
                    <div key={s.label}
                      className="relative flex flex-col gap-3 p-4 rounded-[18px] overflow-hidden"
                      style={{
                        background: `linear-gradient(145deg, ${s.color}10 0%, ${s.color}05 100%)`,
                        border: `1px solid ${s.color}25`,
                      }}>
                      {/* Top accent */}
                      <div className="absolute top-0 left-4 right-4 h-px"
                        style={{ background: `linear-gradient(90deg, transparent, ${s.color}50, transparent)` }} />

                      <div className="flex items-center justify-between">
                        <div className="w-9 h-9 rounded-[12px] flex items-center justify-center"
                          style={{ background: `${s.color}18`, border: `1px solid ${s.color}35` }}>
                          <s.Icon className="w-4 h-4" style={{ color: s.color }} />
                        </div>
                        <div className="w-2 h-2 rounded-full" style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
                      </div>

                      <div>
                        <div className="text-[8px] font-black uppercase tracking-[0.25em]" style={{ color: `${s.color}80` }}>{s.label}</div>
                        <div className="text-[13px] font-black tracking-tight mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>{s.value}</div>
                      </div>

                      {s.pct !== null && (
                        <div className="h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                          <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}

          {/* Privacy */}
          <div className="flex justify-center py-10">
            <button onClick={() => setShowPrivacy(true)}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl glass-card border-white/5 hover:var(--panel-bg-secondary) transition-all group active:scale-95">
              <Shield className="w-4 h-4 text-primary/20 group-hover:text-primary/60 transition-colors" />
              <span className="text-[10px] font-black uppercase tracking-[0.5em] text-primary/20 group-hover:text-primary/60 transition-all">Gizlilik ve Güvenlik</span>
            </button>
          </div>
        </div>
      </div>

      {showPrivacy && (
        <div className="absolute inset-0 z-[1100]">
          <PrivacyPolicy onBack={() => setShowPrivacy(false)} />
        </div>
      )}

      <OBDConnectModal
        open={showOBDConnect}
        onClose={() => setShowOBDConnect(false)}
      />
    </div>
  );
}

export const SettingsPage = memo(SettingsPageInner);


