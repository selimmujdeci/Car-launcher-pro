import { memo, type ReactNode, useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
const SecureAccessModal = lazy(() => import('../admin/SecureAccessModal').then(m => ({ default: m.SecureAccessModal })));
import { useCarTheme, isDay, baseOf, toDay, toNight, type BaseTheme } from '../../store/useCarTheme';
import expeditionEmblem from '../../assets/expedition/emblem.png';
import {
  Sun, Smartphone, Zap, Palette, Layout, Check, PenTool as Tool, Volume2,
  Wifi, HardDrive, RefreshCw, Database, Cloud, ArrowLeft, X,
  Cpu, Shield, ShieldCheck, Gauge, Settings2, Lock,
  Mic, Eye, EyeOff, CheckCircle, XCircle, Loader,
  Grid3X3, Star, Users, ChevronRight, Info, MessageCircle, AlertTriangle, type LucideIcon,
} from 'lucide-react';
import {
  sanitizeAssistantName, sanitizeUserCallsign, sanitizeWakePhrase,
  getWakePhraseWarning, COMPANION_TEXT_MAX_LEN,
  DEFAULT_ASSISTANT_NAME, DEFAULT_WAKE_PHRASE, DEFAULT_WAKE_MODE,
  suggestWakePhrase, resolveWakeWords, resolveCompanionIdentity,
  type CompanionPersonality, type CompanionChattiness, type CompanionWakeMode,
} from '../../platform/companion/companionIdentity';
import { testAIConnection, getEnvGeminiKey, getEnvHaikuKey, getEnvGroqKey, type AIProvider } from '../../platform/aiVoiceService';
import { openInApp } from '../../platform/inAppBrowser';
import { Clipboard } from '@capacitor/clipboard';
import { isNative, bridge } from '../../platform/bridge';
import { PrivacyPolicy } from './PrivacyPolicy';
import { useEditStore } from '../../store/useEditStore';
import { useStore, type VehicleType, type VehicleProfile } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { MUSIC_OPTIONS, type MusicOptionKey } from '../../data/apps';
import {
  getPerformanceMode, setPerformanceMode,
  isAutoModeEnabled, enableAutoMode, disableAutoMode,
} from '../../platform/performanceMode';
import { setBrightness, setVolume, isSystemControlSupported } from '../../platform/systemSettingsService';
import { MaintenancePanel } from '../obd/MaintenancePanel';
import { ExpertModePanel } from './ExpertModePanel';
import { OfflineDataPanel } from './OfflineDataPanel';
import { MobileLinkWidget } from './MobileLinkWidget';
import { KeyBeamPanel } from './KeyBeamPanel';
import { OtaUpdateCard } from './OtaUpdateCard';
import { SupportSnapshotCard } from './SupportSnapshotCard';
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
import {
  getAGCEnabled, setAGCEnabled,
  getDriverFocusEnabled, setDriverFocus,
  getSvcEnabled, setSvcEnabled,
} from '../../platform/audioService';
import { useDeviceStatus } from '../../platform/deviceApi';
import { CarLauncher } from '../../platform/nativePlugin';
import { getDeviceTier, type DeviceTier } from '../../platform/deviceCapabilities';

/* ════════════════════════════════════════
   PREMIUM SLIDER
════════════════════════════════════════ */
function PremiumSlider({ icon: Icon, label, value, onChange, colorA, colorB }: {
  icon: typeof Sun; label: string; value: number; onChange: (v: number) => void;
  colorA: string; colorB: string;
}) {
  return (
    <div className="rounded-xl p-4 lux-noise amber-soft"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--oem-line, rgba(255,255,255,0.06))',
        boxShadow: 'var(--oem-shadow-card, none)',
      }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background: `${colorA}15`,
              boxShadow: `inset 0 0 0 1px var(--oem-line, rgba(255,255,255,0.06)), 0 0 18px var(--oem-amber-soft, transparent)`,
            }}>
            <Icon className="w-5 h-5" style={{ color: colorA }} />
          </div>
          <span className="font-bold text-sm" style={{ color: 'var(--oem-ink)' }}>{label}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-black text-2xl tabular-nums" style={{ color: colorA, textShadow: `0 0 14px ${colorA}55` }}>{value}</span>
          <span className="text-xs font-bold" style={{ color: 'var(--oem-ink-3)' }}>%</span>
        </div>
      </div>
      <div className="relative h-2 rounded-full"
        style={{
          background: 'rgba(255,255,255,0.06)',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35), 0 0 0 1px var(--oem-amber-soft, transparent)',
        }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${value}%`, background: `linear-gradient(90deg,${colorA},${colorB})` }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white pointer-events-none transition-[left] duration-75"
          style={{
            left: `calc(${value}% - 8px)`,
            boxShadow:
              `0 0 0 3px ${colorA}55,` +
              ` 0 0 16px var(--oem-amber-glow, transparent),` +
              ` 0 4px 14px rgba(0,0,0,0.55),` +
              ` 0 0 22px ${colorA}40`,
          }} />
        <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer z-10" style={{ height: '100%', margin: 0 }} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   PREMIUM TOGGLE
════════════════════════════════════════ */
/* PremiumToggle — artık premium SettingTile + BigToggle'a delege eder.
   Böylece TÜM ayar kartları "Ses" bölümüyle BİREBİR aynı görünür:
   graphite kart, ikon çipi, karışık-harf başlık, gri açıklama, amber
   BigToggle (ETKİN/KAPALI). Eski gökkuşağı accent (mor/yeşil/mavi/cyan)
   ve uppercase başlıklar kaldırıldı — tutarlı OEM görünüm.
   `accent` prop'u geriye-uyum için imzada kalır ama kullanılmaz.
   (SettingTile/BigToggle function-declaration → hoisting ile erişilebilir.) */
function PremiumToggle({ label, desc, value, onChange, icon: Icon }: {
  label: string; desc: string; value: boolean; onChange: (v: boolean) => void;
  icon?: LucideIcon; accent?: string;
}) {
  return (
    <SettingTile
      icon={Icon}
      title={label}
      sub={desc}
      control={<BigToggle value={value} onChange={onChange} />}
    />
  );
}

/* ════════════════════════════════════════
   THEME PANEL — Ayarlar içi tema seçici
════════════════════════════════════════ */
/** dn dolu olan kartlar (carOS Expedition ailesi) gün/gece varyantını da seçer. */
type ThemeOpt = { id: BaseTheme; dn?: 'day' | 'night'; label: string; sub: string; accent: string; preview: string; emblem?: boolean };
const THEME_OPTIONS: ThemeOpt[] = [
  { id: 'horizon',  label: 'HORIZON',  sub: 'Expedition · Pivi Pro', accent: '#F2871C', preview: 'linear-gradient(135deg,#473d2c 0%,#221d15 52%,#0c0906 100%)' },
  { id: 'expedition', dn: 'day',   label: 'EXPEDITION DAY',   sub: 'Kum · Gündüz', accent: '#E07B14', preview: 'linear-gradient(135deg,#FBF7EF,#DED3C0)', emblem: true },
  { id: 'expedition', dn: 'night', label: 'EXPEDITION NIGHT', sub: 'Pas · Gece',   accent: '#F2871C', preview: 'linear-gradient(135deg,#2c2216,#0f0c09)', emblem: true },
  { id: 'tesla',    label: 'TESLA',    sub: 'Model S',          accent: '#E31937', preview: 'linear-gradient(135deg,#0a0a0a,#1a1a1a)' },
  { id: 'pro',      label: 'PRO',      sub: 'Dark Automotive',  accent: '#D4AF37', preview: 'linear-gradient(135deg,#0a0c10,#12151d)' },
];

function ThemePanel() {
  const { theme, setTheme } = useCarTheme();
  const dayMode = isDay(theme);
  const activeBase = baseOf(theme);
  const dayNightMode = useStore(s => s.settings.dayNightMode);

  function selectBase(id: BaseTheme) {
    setTheme(dayMode ? `${id}-day` as const : id);
    useSystemStore.getState().setUserOverride(120_000);
  }

  /** Expedition ailesi: tema varyantı + kanonik gün/gece sinyalini birlikte ayarlar
   *  (Sand=gündüz, Lava=gece). useDayNightManager auto modda dayNightMode'u zaten
   *  saate göre çevirir → otomatik eşleşme; bu da manuel seçimi sağlar. */
  function selectExpedition(dn: 'day' | 'night') {
    setTheme(dn === 'day' ? 'expedition-day' : 'expedition');
    useStore.getState().updateSettings({ dayNightMode: dn, theme: dn === 'day' ? 'light' : 'dark' });
    useSystemStore.getState().setUserOverride(120_000);
  }

  function toggleDayNight() {
    const target = dayMode ? 'night' : 'day';
    // 1) Tema varyantı (layout/önizleme)  2) KANONİK gündüz/gece sinyali
    //    (settings.dayNightMode → useDayNightManager: data-day-night + light-ui
    //     + dock + --oem palet). İkisini SENKRON tut, aksi halde toggle tutarsız.
    setTheme(target === 'day' ? toDay(theme) : toNight(theme));
    useStore.getState().updateSettings({
      dayNightMode: target,
      theme: target === 'day' ? 'light' : 'dark',
    });
    // Otomatik (saat-bazlı) geçiş manuel kararı hemen ezmesin
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
              <div className="text-sm font-black uppercase tracking-[0.15em]" style={{ color: 'var(--oem-ink, #fff)' }}>Kokpit Teması</div>
              <div className="text-[11px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.62))' }}>Ana ekran görünümünü seç</div>
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
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(t => {
            const active = t.dn
              ? (activeBase === 'expedition' && (t.dn === 'day' ? dayNightMode === 'day' : dayNightMode !== 'day'))
              : (activeBase === t.id);
            const preview = t.preview;
            return (
              <button
                key={t.label}
                onClick={() => (t.dn ? selectExpedition(t.dn) : selectBase(t.id))}
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
                  {t.emblem && (
                    <img src={expeditionEmblem} alt="" style={{ position: 'absolute', top: '50%', left: '50%', width: '38%', transform: 'translate(-50%,-55%)', opacity: 0.92, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))', pointerEvents: 'none' }} />
                  )}
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
                <div className="text-[11px] font-black uppercase tracking-wider" style={{ color: active ? t.accent : 'var(--oem-ink-2, rgba(255,255,255,0.72))' }}>{t.label}</div>
                <div className="text-[10px] font-medium" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.72))' }}>{t.sub}</div>
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
    <div className={`glass-card lux-panel lux-noise amber-soft cool-sheen overflow-hidden group transition-all duration-500 ${className}`}
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
          style={{ color: 'var(--oem-ink)' }}>
          {title}
        </div>
        {sub && (
          <div className="text-[10px] font-bold mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>{sub}</div>
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
  // Sağlayıcı seçici KALDIRILDI (3 numaralı görev — üç anahtar da her zaman
  // görünür/kayıtlı): bu panel artık ayarlar store'undan aiVoiceProvider
  // OKUMUYOR/YAZMIYOR — settings.aiVoiceProvider alanı yalnız voiceService'in
  // geriye-uyum `provider` alanı için varlığını sürdürüyor (dokunulmadı).
  const [geminiKey,  setGeminiKey]  = useSensitiveKey('geminiApiKey');
  const [haikuKey,   setHaikuKey]   = useSensitiveKey('claudeHaikuApiKey');
  const [groqKey,    setGroqKey]    = useSensitiveKey('groqApiKey');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showHaikuKey,  setShowHaikuKey]  = useState(false);
  const [showGroqKey,   setShowGroqKey]   = useState(false);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);
  const [waitingClip,   setWaitingClip]   = useState(false);
  const [showKeyBeam,   setShowKeyBeam]   = useState(false);
  // Anahtar boğması YOK: normal kullanıcı YALNIZ Gemini anahtarıyla tam çalışır
  // (sohbet + Google araması + yerel hava). Groq/Haiku "Gelişmiş — opsiyonel
  // yedek beyin" altında KATLI durur; yalnız kota derdi olan ileri kullanıcı açar.
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Dönen kullanıcı: daha önce yedek anahtar kaydettiyse panel otomatik açılsın
  // (anahtar deposu async yüklenir → truthy olunca genişlet).
  useEffect(() => {
    if (groqKey || haikuKey) setShowAdvanced(true);
  }, [groqKey, haikuKey]);

  // Hibrit zincirde sağlayıcı başına ayrı test durumu — tek genel test butonu
  // artık yanlış anahtarı test ediyormuş izlenimi verirdi (3 numaralı görev).
  type TestState = { testing: boolean; result: { ok: boolean; message: string } | null };
  const [geminiTest, setGeminiTest] = useState<TestState>({ testing: false, result: null });
  const [groqTest,   setGroqTest]   = useState<TestState>({ testing: false, result: null });
  const [haikuTest,  setHaikuTest]  = useState<TestState>({ testing: false, result: null });
  const geminiTestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groqTestTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const haikuTestTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const envGeminiKey = getEnvGeminiKey();
  const envHaikuKey  = getEnvHaikuKey();
  const envGroqKey   = getEnvGroqKey();

  /** Clipboard'u oku, key pattern'ine göre doğru alana otomatik kaydet.
   *  Artık tek bir "seçili sağlayıcı" kavramı YOK — üç alan da her zaman
   *  görünür, bu yüzden algılama yalnız pattern'e bakar (provider'a değil). */
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

      // Gemini key formatları: eski `AIza...` + yeni `AQ.Ab8...` (2026 API key sistemi).
      const isGeminiKey = /^(AIza[A-Za-z0-9_-]{35,}|AQ\.[A-Za-z0-9_.-]{20,})$/.test(text);
      const isHaikuKey  = /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(text);
      const isGroqKey   = /^gsk_[A-Za-z0-9]{20,}$/.test(text);

      if (isGeminiKey) {
        void setGeminiKey(text);
        setClipboardHint('Gemini key otomatik algılandı!');
        setWaitingClip(false);
      } else if (isHaikuKey) {
        void setHaikuKey(text);
        setShowAdvanced(true); // yedek beyin girildi → gelişmiş panel açık kalsın
        setClipboardHint('Haiku key otomatik algılandı!');
        setWaitingClip(false);
      } else if (isGroqKey) {
        void setGroqKey(text);
        setShowAdvanced(true); // yedek beyin girildi → gelişmiş panel açık kalsın
        setClipboardHint('Groq key otomatik algılandı!');
        setWaitingClip(false);
      }
      if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
      clipTimerRef.current = setTimeout(() => setClipboardHint(null), 4000);
    } catch { /* clipboard izni yok */ }
  }, []);

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

  /** Bölüm başına bağlantı testi — kendi anahtarını test eder. */
  const runTest = useCallback(async (
    prov: AIProvider,
    key: string,
    envKey: string,
    setState: React.Dispatch<React.SetStateAction<TestState>>,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    const effectiveKey = key || envKey;
    if (!effectiveKey) return;
    setState({ testing: true, result: null });
    const result = await testAIConnection(prov, effectiveKey);
    setState({ testing: false, result });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState((prev) => ({ ...prev, result: null })), 5000);
  }, []);

  useEffect(() => () => {
    if (geminiTestTimerRef.current) clearTimeout(geminiTestTimerRef.current);
    if (groqTestTimerRef.current)   clearTimeout(groqTestTimerRef.current);
    if (haikuTestTimerRef.current)  clearTimeout(haikuTestTimerRef.current);
    if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
  }, []);

  /** Küçük, bölüm-içi test butonu + sonuç göstergesi. */
  const TestRow = ({ state, onTest, disabled }: { state: TestState; onTest: () => void; disabled: boolean }) => (
    <div className="flex items-center gap-2 mt-1">
      <button
        onClick={onTest}
        disabled={state.testing || disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all active:scale-95 disabled:opacity-40"
        style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'var(--oem-ink-2, rgba(255,255,255,0.6))' }}
      >
        {state.testing ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
        {state.testing ? 'Test ediliyor…' : 'Bağlantıyı Test Et'}
      </button>
      {state.result && (
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          {state.result.ok
            ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            : <XCircle className="w-3.5 h-3.5 text-red-400" />
          }
          <span className={state.result.ok ? 'text-emerald-400' : 'text-red-400'}>{state.result.message}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="mt-8 pt-8 border-t border-white/10 flex flex-col gap-5">
      <div className="flex items-center gap-2 mb-1">
        <Mic className="w-4 h-4 text-purple-400" />
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-purple-400/70">AI Sesli Asistan</span>
        <span className="ml-auto text-[9px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-mono">İnternet gerektirir</span>
      </div>

      {/* Bilgi bandı — TEK anahtar yeter. Gemini tek başına sohbet + Google
          araması + (yerel) hava yapar; yedek beyin opsiyonel/katlı. */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
        <Info className="w-4 h-4 text-purple-300 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-[color:var(--oem-ink-2)] leading-relaxed">
          <span className="font-bold text-purple-300">Tek anahtar yeter:</span> Gemini sohbeti, komutları,
          {' '}internet aramasını (haber/döviz) ve havayı tek başına yapar. Yedek beyin eklemek zorunda değilsin.
        </p>
      </div>

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

      {/* Gemini — TEK gerekli anahtar */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">Gemini API Key · tek gerekli anahtar</span>
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
        {/* Telefonla QR ile getir */}
        <button
          onClick={() => setShowKeyBeam((v) => !v)}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-300 text-sm font-bold hover:bg-purple-500/20 active:scale-[0.98] transition-all"
        >
          <span>📱</span>
          {showKeyBeam ? 'QR\'ı Gizle' : 'Telefonla Getir (QR)'}
        </button>
        {showKeyBeam && (
          <KeyBeamPanel
            onKeySaved={setGeminiKey}
            onClose={() => setShowKeyBeam(false)}
          />
        )}
        <p className="text-[10px] text-[color:var(--oem-ink-3)] text-center">Key'i kopyala → otomatik algılanacak</p>
        <div className="relative">
          <input
            type={showGeminiKey ? 'text' : 'password'}
            value={geminiKey}
            onChange={(e) => { void setGeminiKey(e.target.value); }}
            placeholder={envGeminiKey ? '● .env\'den otomatik' : 'AIza... / AQ... (manuel giriş)'}
            className="w-full bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-xl px-3.5 py-2.5 text-[color:var(--oem-ink)] text-sm placeholder:text-[color:var(--oem-ink-3)] outline-none focus:border-[var(--oem-accent)] transition-all pr-10"
          />
          <button onClick={() => setShowGeminiKey((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)]">
            {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <TestRow
          state={geminiTest}
          disabled={!geminiKey && !envGeminiKey}
          onTest={() => void runTest('gemini', geminiKey, envGeminiKey, setGeminiTest, geminiTestTimerRef)}
        />
      </div>

      {/* ── GELİŞMİŞ (opsiyonel yedek beyin) — varsayılan KATLI ──
          Anahtar boğması yok: normal kullanıcı buraya hiç dokunmaz. Gemini kotası
          bittiğinde asistanın konuşmaya devam etmesini isteyen açar. */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-2 mt-1 pt-3 border-t border-[var(--oem-line)] text-left"
      >
        <ChevronRight className={`w-4 h-4 text-[color:var(--oem-ink-3)] transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
        <span className="text-[10px] font-bold text-[color:var(--oem-ink-3)] uppercase tracking-wider">Gelişmiş — yedek beyin ekle (opsiyonel)</span>
        {(groqKey || haikuKey) && (
          <span className="ml-auto text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Etkin ✓</span>
        )}
      </button>

      {showAdvanced && (
      <div className="flex flex-col gap-5">
      <p className="text-[10px] text-[color:var(--oem-ink-3)] leading-snug">
        Zorunlu değil. Girersen Gemini kotası bittiğinde asistan susmaz — sırayla Groq, sonra Haiku devreye girer.
        Bu yedekler tek başına internette arayamaz; canlı bilgi için Gemini gerekir (hava yine yerelden gelir).
      </p>

      {/* Yedek 1 — Groq */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-[color:var(--oem-ink-3)] uppercase tracking-wider">Yedek 1 — Groq API Key</span>
          {envGroqKey && !groqKey
            ? <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-mono">.env'den okunuyor</span>
            : groqKey
            ? <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Kayıtlı ✓</span>
            : null
          }
        </div>
        {/* Ücretsiz key al butonu */}
        <button
          onClick={() => handleOpenKeyPage('https://console.groq.com/keys')}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#f55036]/30 bg-[#f55036]/10 text-[#f55036] text-sm font-bold hover:bg-[#f55036]/20 active:scale-[0.98] transition-all"
        >
          <span>🔑</span>
          Ücretsiz Key Al — console.groq.com
        </button>
        <p className="text-[10px] text-[color:var(--oem-ink-3)] text-center">Key'i kopyala → otomatik algılanacak</p>
        <div className="relative">
          <input
            type={showGroqKey ? 'text' : 'password'}
            value={groqKey}
            onChange={(e) => { void setGroqKey(e.target.value); }}
            placeholder={envGroqKey ? '● .env\'den otomatik' : 'gsk_... (manuel giriş)'}
            className="w-full bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-xl px-3.5 py-2.5 text-[color:var(--oem-ink)] text-sm placeholder:text-[color:var(--oem-ink-3)] outline-none focus:border-[var(--oem-accent)] transition-all pr-10"
          />
          <button onClick={() => setShowGroqKey((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)]">
            {showGroqKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <TestRow
          state={groqTest}
          disabled={!groqKey && !envGroqKey}
          onTest={() => void runTest('groq', groqKey, envGroqKey, setGroqTest, groqTestTimerRef)}
        />
      </div>

      {/* Yedek 2 — Haiku */}
      <div className="flex flex-col gap-2 pt-3 border-t border-[var(--oem-line)]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-[color:var(--oem-ink-3)] uppercase tracking-wider">Yedek 2 — Claude Haiku API Key</span>
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
        <p className="text-[10px] text-[color:var(--oem-ink-3)] text-center">Key'i kopyala → otomatik algılanacak</p>
        <div className="relative">
          <input
            type={showHaikuKey ? 'text' : 'password'}
            value={haikuKey}
            onChange={(e) => { void setHaikuKey(e.target.value); }}
            placeholder={envHaikuKey ? '● .env\'den otomatik' : 'sk-ant-... (manuel giriş)'}
            className="w-full bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-xl px-3.5 py-2.5 text-[color:var(--oem-ink)] text-sm placeholder:text-[color:var(--oem-ink-3)] outline-none focus:border-[var(--oem-accent)] transition-all pr-10"
          />
          <button onClick={() => setShowHaikuKey((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)]">
            {showHaikuKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <TestRow
          state={haikuTest}
          disabled={!haikuKey && !envHaikuKey}
          onTest={() => void runTest('haiku', haikuKey, envHaikuKey, setHaikuTest, haikuTestTimerRef)}
        />
      </div>

      </div>
      )}

      {/* Info box */}
      <div className="p-3 rounded-xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[10px] text-[color:var(--oem-ink-3)] leading-relaxed">
        <span className="text-[color:var(--oem-ink-2)] font-bold">Nasıl çalışır?</span>
        {' '}Offline parser tanıyamadığında (%50 altı güven) AI devreye girer. İnternet yoksa otomatik olarak offline modda çalışır.
        {' '}<span className="text-[color:var(--oem-ink-3)]">API key cihazda şifrelenmiş olarak saklanır.</span>
      </div>
    </div>
  );
});

/* ════════════════════════════════════════
   COMPANION PANEL — "Yol Arkadaşım"
   Yalnız ayar/kimlik modeli (Commit 1) — motor, wake word ve Gemini
   sohbeti sonraki commit'lerde. Metin alanları blur'da sanitize edilip
   store'a yazılır; store'da asla ham riskli metin kalmaz.
════════════════════════════════════════ */
const CompanionPanel = memo(function CompanionPanel() {
  // Seçicisiz useStore() store'daki HER yazımda (volume/park/telemetri...) tüm
  // bölümü yeniden render ediyordu — zayıf GPU'da saha-ölçülmüş jank etkeni.
  const { settings, updateSettings } = useStore(
    useShallow((s) => ({ settings: s.settings, updateSettings: s.updateSettings })),
  );

  // Taslak değerler — yazarken sanitize ETME (kullanıcı deneyimi),
  // blur/commit anında sanitize et.
  const [nameDraft,     setNameDraft]     = useState(settings.companionAssistantName ?? DEFAULT_ASSISTANT_NAME);
  const [callsignDraft, setCallsignDraft] = useState(settings.companionUserCallsign ?? '');
  const [phraseDraft,   setPhraseDraft]   = useState(settings.companionWakePhrase ?? DEFAULT_WAKE_PHRASE);

  const commitName = useCallback(() => {
    const clean = sanitizeAssistantName(nameDraft);
    setNameDraft(clean);
    updateSettings({ companionAssistantName: clean });
  }, [nameDraft, updateSettings]);

  const commitCallsign = useCallback(() => {
    const clean = sanitizeUserCallsign(callsignDraft);
    setCallsignDraft(clean);
    updateSettings({ companionUserCallsign: clean });
  }, [callsignDraft, updateSettings]);

  const commitPhrase = useCallback(() => {
    const clean = sanitizeWakePhrase(phraseDraft);
    setPhraseDraft(clean);
    updateSettings({ companionWakePhrase: clean });
  }, [phraseDraft, updateSettings]);

  // Wake sözleri asistan ADINDAN türetilir — ad/şekil değişince önizleme
  // ve uyarı otomatik güncellenir (öneri: "Hey {ad}").
  const wakeMode  = settings.companionWakeMode ?? DEFAULT_WAKE_MODE;
  const cleanName = sanitizeAssistantName(settings.companionAssistantName);
  const wakePreview = resolveWakeWords(resolveCompanionIdentity(settings));
  // Yanlış tetikleme uyarısı: tek-isim tetikleyici aktifse ada, özel cümlede cümleye bakılır
  const phraseWarning = wakeMode === 'custom'
    ? getWakePhraseWarning(phraseDraft)
    : (wakeMode === 'name' || wakeMode === 'both')
      ? getWakePhraseWarning(cleanName)
      : null;

  const WAKE_MODES: { id: CompanionWakeMode; label: string; sub: string }[] = [
    { id: 'name',     label: 'Sadece isim', sub: `"${cleanName}"` },
    { id: 'hey_name', label: 'Hey + isim',  sub: `"Hey ${cleanName}"` },
    { id: 'both',     label: 'İkisi de',    sub: 'İsim veya Hey+isim' },
    { id: 'custom',   label: 'Özel cümle',  sub: 'Kendin yaz' },
  ];

  const PERSONALITIES: { id: CompanionPersonality; label: string; sub: string }[] = [
    { id: 'sessiz',      label: 'Sessiz',      sub: 'Yalnız sorulara cevap verir' },
    { id: 'samimi',      label: 'Samimi',      sub: 'Sıcak, doğal yol arkadaşı' },
    { id: 'neseli',      label: 'Neşeli',      sub: 'Enerjik ve esprili ton' },
    { id: 'profesyonel', label: 'Profesyonel', sub: 'Kısa, net, resmi' },
  ];
  const CHATTINESS: { id: CompanionChattiness; label: string; sub: string }[] = [
    { id: 'az',     label: 'Az',     sub: 'Yalnız önemli anlarda' },
    { id: 'normal', label: 'Normal', sub: 'Dengeli sohbet' },
    { id: 'sik',    label: 'Sık',    sub: 'Konuşkan yolculuk' },
  ];

  const inputClass = 'w-full bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-xl px-3.5 py-2.5 text-[color:var(--oem-ink)] text-sm placeholder:text-[color:var(--oem-ink-3)] outline-none focus:border-[var(--oem-accent)] transition-all';

  return (
    <div className="flex flex-col gap-3">
      <PremiumToggle
        icon={MessageCircle}
        label="Yol Arkadaşım"
        desc="Konuşan akıllı yolculuk asistanı — varsayılan kapalı"
        value={settings.companionEnabled ?? false}
        onChange={(v) => updateSettings({ companionEnabled: v })}
        accent="#22d3ee"
      />

      {(settings.companionEnabled ?? false) && (
        <div className="flex flex-col gap-5 mt-2 pl-1">
          {/* Asistan adı */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-[color:var(--oem-ink-3)] uppercase tracking-wider">Asistan Adı</span>
            <input
              type="text"
              value={nameDraft}
              maxLength={COMPANION_TEXT_MAX_LEN}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              placeholder={DEFAULT_ASSISTANT_NAME}
              className={inputClass}
            />
          </div>

          {/* Kullanıcı hitabı */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-[color:var(--oem-ink-3)] uppercase tracking-wider">Bana Böyle Seslen</span>
            <input
              type="text"
              value={callsignDraft}
              maxLength={COMPANION_TEXT_MAX_LEN}
              onChange={(e) => setCallsignDraft(e.target.value)}
              onBlur={commitCallsign}
              placeholder="Boş bırakılırsa hitapsız konuşur"
              className={inputClass}
            />
          </div>

          {/* Kişilik */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-[color:var(--oem-ink-3)] uppercase tracking-wider">Kişilik</span>
            <div className="grid grid-cols-2 gap-2">
              {PERSONALITIES.map(({ id, label, sub }) => {
                const active = (settings.companionPersonality ?? 'samimi') === id;
                return (
                  <button
                    key={id}
                    onClick={() => updateSettings({ companionPersonality: id })}
                    className="flex flex-col gap-0.5 px-4 py-3 rounded-xl border text-left transition-all active:scale-[0.98]"
                    style={active
                      ? { backgroundColor: 'rgba(34,211,238,0.10)', borderColor: 'rgba(34,211,238,0.45)' }
                      : { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
                  >
                    <span className="text-sm font-bold" style={{ color: active ? '#22d3ee' : 'var(--oem-ink-2, rgba(255,255,255,0.7))' }}>{label}</span>
                    <span className="text-[10px]" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.4))' }}>{sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Konuşma sıklığı */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-[color:var(--oem-ink-3)] uppercase tracking-wider">Konuşma Sıklığı</span>
            <div className="grid grid-cols-3 gap-2">
              {CHATTINESS.map(({ id, label, sub }) => {
                const active = (settings.companionChattiness ?? 'az') === id;
                return (
                  <button
                    key={id}
                    onClick={() => updateSettings({ companionChattiness: id })}
                    className="flex flex-col gap-0.5 px-3 py-3 rounded-xl border text-left transition-all active:scale-[0.98]"
                    style={active
                      ? { backgroundColor: 'rgba(34,211,238,0.10)', borderColor: 'rgba(34,211,238,0.45)' }
                      : { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
                  >
                    <span className="text-sm font-bold" style={{ color: active ? '#22d3ee' : 'var(--oem-ink-2, rgba(255,255,255,0.7))' }}>{label}</span>
                    <span className="text-[10px]" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.4))' }}>{sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Wake word — sözler asistan ADINDAN türetilir ("Mavi"/"Hey Mavi") */}
          <PremiumToggle
            icon={Mic}
            label="Sesle Uyandırma"
            desc={`"${suggestWakePhrase(settings.companionAssistantName)}" de, asistan uyansın`}
            value={settings.companionWakeWordEnabled ?? false}
            onChange={(v) => updateSettings({ companionWakeWordEnabled: v })}
            accent="#a78bfa"
          />

          {(settings.companionWakeWordEnabled ?? false) && (
            <div className="flex flex-col gap-3">
              {/* Uyanma şekli */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-[color:var(--oem-ink-3)] uppercase tracking-wider">Uyanma Şekli</span>
                <div className="grid grid-cols-2 gap-2">
                  {WAKE_MODES.map(({ id, label, sub }) => {
                    const active = wakeMode === id;
                    return (
                      <button
                        key={id}
                        onClick={() => updateSettings({ companionWakeMode: id })}
                        className="flex flex-col gap-0.5 px-4 py-3 rounded-xl border text-left transition-all active:scale-[0.98]"
                        style={active
                          ? { backgroundColor: 'rgba(167,139,250,0.10)', borderColor: 'rgba(167,139,250,0.45)' }
                          : { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
                      >
                        <span className="text-sm font-bold" style={{ color: active ? '#a78bfa' : 'var(--oem-ink-2, rgba(255,255,255,0.7))' }}>{label}</span>
                        <span className="text-[10px]" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.4))' }}>{sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Özel cümle girişi — yalnız 'custom' modda */}
              {wakeMode === 'custom' && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-[color:var(--oem-ink-3)] uppercase tracking-wider">Özel Uyandırma Cümlesi</span>
                  <input
                    type="text"
                    value={phraseDraft}
                    maxLength={COMPANION_TEXT_MAX_LEN}
                    onChange={(e) => setPhraseDraft(e.target.value)}
                    onBlur={commitPhrase}
                    placeholder={suggestWakePhrase(settings.companionAssistantName)}
                    className={inputClass}
                  />
                </div>
              )}

              {/* Aktif wake sözleri önizlemesi */}
              <div className="p-3 rounded-xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[11px] text-[color:var(--oem-ink-2)] leading-relaxed">
                Şu sözlerle uyanır: {wakePreview.map((w) => `"${w}"`).join(' · ')}
              </div>

              {phraseWarning && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] leading-relaxed text-amber-400">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{phraseWarning}</span>
                </div>
              )}
            </div>
          )}

          {/* Gizlilik notu */}
          <div className="p-3 rounded-xl bg-[var(--oem-surface-2)] border border-[var(--oem-line)] text-[10px] text-[color:var(--oem-ink-3)] leading-relaxed">
            <span className="text-[color:var(--oem-ink-2)] font-bold">Gizlilik:</span>
            {' '}Ses tanıma %100 cihaz içinde çalışır. Ad ve hitap bilgisi cihaz dışına gönderilmez.
          </div>
        </div>
      )}
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
  const updateSettings = useStore((s) => s.updateSettings);
  const [refreshing, setRefreshing] = useState(false);
  return (
    <div className="mt-8 pt-8 border-t border-white/10 flex flex-col gap-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[color:var(--oem-ink-3)]">Harita Altyapısı</span>
        <div className="flex gap-2.5">
          <span className="flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest glass-card border-none !shadow-none bg-[var(--oem-surface-2)]"
            style={isOnline ? { color: 'var(--oem-good)' } : { color: 'var(--oem-danger)' }}>
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-[var(--oem-good)] animate-pulse' : 'bg-[var(--oem-danger)]'}`} />
            {isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}
          </span>
          <button onClick={async () => { setRefreshing(true); await refreshMapSources(); setRefreshing(false); }}
            className="w-10 h-10 rounded-2xl flex items-center justify-center bg-[var(--oem-surface-2)] hover:bg-[var(--oem-surface-3)] border border-[var(--oem-line)] transition-all active:rotate-180">
            <RefreshCw className={`w-5 h-5 text-[color:var(--oem-ink-2)] ${refreshing ? 'animate-spin' : ''}`} />
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
            <div className="w-12 h-12 rounded-[1.25rem] flex items-center justify-center bg-[var(--oem-surface-2)] border border-[var(--oem-line)] shadow-inner"
              style={isActive ? { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.5)' } : {}}>
              <Icon className="w-6 h-6 transition-colors" style={{ color: isActive ? 'var(--oem-info)' : 'var(--oem-ink-3)' }} />
            </div>
            <div className="flex-1 text-left">
              <div className="text-base font-black tracking-tight text-[color:var(--oem-ink)]">{src.name}</div>
              <div className="text-[11px] text-[color:var(--oem-ink-3)] font-bold uppercase tracking-widest mt-1">{src.description}</div>
            </div>
            {isActive && <div className="w-8 h-8 rounded-full bg-[var(--oem-info)] flex items-center justify-center shadow-lg"><Check className="w-5 h-5 text-[color:var(--oem-accent-ink)] stroke-[4px]" /></div>}
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
              style={{ color: active ? m.color : 'var(--oem-ink-2, rgba(255,255,255,0.75))' }}>
              {m.label}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] mt-0.5"
              style={{ color: active ? `${m.color}90` : 'var(--oem-ink-3, rgba(255,255,255,0.58))' }}>
              {m.sub}
            </div>
          </div>
        </div>

        {/* Resource bars */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[8px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.60))' }}>CPU</span>
            <span className="text-[8px] font-black tabular-nums" style={{ color: active ? m.color : 'var(--oem-ink-3, rgba(255,255,255,0.55))' }}>{m.cpu}%</span>
          </div>
          <PerfMiniBar pct={active ? m.cpu : m.cpu * 0.5} color={m.color} />
          <div className="flex items-center justify-between mt-1 mb-0.5">
            <span className="text-[8px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.60))' }}>GPU</span>
            <span className="text-[8px] font-black tabular-nums" style={{ color: active ? m.color : 'var(--oem-ink-3, rgba(255,255,255,0.55))' }}>{m.gpu}%</span>
          </div>
          <PerfMiniBar pct={active ? m.gpu : m.gpu * 0.5} color={m.color} />
        </div>

        {/* Feature list */}
        <div className="flex flex-col gap-1.5 pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {m.features.map(f => (
            <div key={f} className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: active ? m.color : 'rgba(255,255,255,0.40)' }} />
              <span className="text-[10px] font-semibold" style={{ color: active ? 'var(--oem-ink-2, rgba(255,255,255,0.75))' : 'var(--oem-ink-2, rgba(255,255,255,0.65))' }}>{f}</span>
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
              style={{ background: active ? m.color : 'rgba(255,255,255,0.40)', boxShadow: active ? `0 0 6px ${m.color}` : 'none' }} />
            <span className="text-[8px] font-black uppercase tracking-[0.2em]"
              style={{ color: active ? m.color : 'var(--oem-ink-3, rgba(255,255,255,0.60))' }}>
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

const TIER_LABEL: Record<DeviceTier, { name: string; pct: number }> = {
  low:  { name: 'Giriş',   pct: 33  },
  mid:  { name: 'Orta',    pct: 66  },
  high: { name: 'Yüksek',  pct: 100 },
};

/** Gerçek WebView/Chromium sürümü — UA'dan; bulunamazsa tarayıcı bilinmiyor. */
function getWebViewLabel(): string {
  const m = /Chrome\/(\d+)/.exec(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return m ? `Chromium ${m[1]}` : 'Bilinmiyor';
}

/** Cihaz belleği (navigator.deviceMemory) — desteklenmeyen WebView'da "—". */
function getDeviceMemLabel(): string {
  const gb = typeof navigator !== 'undefined'
    ? (navigator as { deviceMemory?: number }).deviceMemory
    : undefined;
  return typeof gb === 'number' ? `${gb}GB RAM` : '—';
}

function LiveStatsRow() {
  const { ready, battery, charging } = useDeviceStatus();
  const [load,   setLoad]   = useState(0);   // ana thread yükü — longtask ms / pencere
  const [ramMb,  setRamMb]  = useState(0);   // usedJSHeapSize (MB); yoksa 0 → "—"
  const [netMs,  setNetMs]  = useState(-1);  // navigator.connection.rtt; yoksa -1
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  useEffect(() => {
    // Yük ölçümü longtask tabanlı: rAF döngüsü YOK (K24 boşta-çizim seli yasağı).
    let blockedMs = 0;
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) blockedMs += e.duration;
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch { /* longtask desteklemeyen WebView → yük %0 kalır */ }

    const PERIOD_MS = 2500;
    const id = setInterval(() => {
      setLoad(Math.min(99, Math.round((blockedMs / PERIOD_MS) * 100)));
      blockedMs = 0;
      const mem = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
      setRamMb(mem?.usedJSHeapSize ? Math.round(mem.usedJSHeapSize / 1048576) : 0);
      const rtt = (navigator as { connection?: { rtt?: number } }).connection?.rtt;
      setNetMs(typeof rtt === 'number' ? rtt : -1);
      setOnline(navigator.onLine);
    }, PERIOD_MS);
    return () => { obs?.disconnect(); clearInterval(id); };
  }, []);

  const stats = [
    { label: 'YÜK', val: `${load}%`, color: '#3b82f6', Icon: Cpu },
    { label: 'BAT', val: ready ? `%${battery}${charging ? '+' : ''}` : '—', color: '#f97316', Icon: Zap },
    { label: 'RAM', val: ramMb > 0 ? (ramMb >= 1024 ? `${(ramMb / 1024).toFixed(1)}G` : `${ramMb}M`) : '—', color: '#10b981', Icon: HardDrive },
    { label: 'NET', val: !online ? 'OFF' : netMs > 0 ? `${netMs}ms` : 'ON', color: '#8b5cf6', Icon: Gauge },
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
   COCKPIT PRIMITIVES — 1:1 screens.jsx (Phase 8)
════════════════════════════════════════ */

function SettingsHero({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="flex items-end justify-between gap-6" style={{ marginBottom: 36 }}>
      <div style={{ maxWidth: 780 }}>
        <div className="text-[11px] font-black uppercase"
          style={{ letterSpacing: '0.20em', color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
          {eyebrow}
        </div>
        <h1
          style={{
            fontSize: 'clamp(36px, 4.4vw, 56px)',
            fontWeight: 300,
            marginTop: 14,
            letterSpacing: '-0.025em',
            lineHeight: 1.02,
            color: 'var(--oem-ink, #F0EBE0)',
          }}>
          {title}
        </h1>
        {sub && (
          <div
            style={{
              fontSize: 17, marginTop: 14, maxWidth: 640, lineHeight: 1.5,
              color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
            }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingTile({ icon, title, sub, control, accent, span = 1, onClick }: {
  icon?: LucideIcon; title: string; sub?: string; control?: ReactNode;
  accent?: 'amber'; span?: number; onClick?: () => void;
}) {
  const Icon = icon;
  return (
    <div
      onClick={onClick}
      style={{
        gridColumn: `span ${span}`,
        padding: '28px 30px',
        display: 'flex', flexDirection: 'column', gap: 20,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        background:
          'linear-gradient(135deg, rgba(255,240,210,0.04), transparent 30%),' +
          ' var(--oem-surface-1, #262C3C)',
        border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
        borderRadius: 24,
        boxShadow: 'var(--oem-shadow-card)',
      }}>
      <div className="flex items-start gap-4">
        {Icon && (
          <span
            style={{
              width: 56, height: 56, borderRadius: 16,
              background: accent === 'amber'
                ? 'linear-gradient(135deg, oklch(82% 0.10 65 / 0.30), oklch(60% 0.10 50 / 0.10))'
                : 'var(--oem-surface-2, #303749)',
              border: '1px solid ' + (accent === 'amber'
                ? 'var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))'
                : 'var(--oem-line, rgba(255,240,210,0.08))'),
              display: 'grid', placeItems: 'center',
              color: accent === 'amber'
                ? 'var(--oem-amber, oklch(80% 0.13 60))'
                : 'var(--oem-ink-2, rgba(240,235,224,0.74))',
              flex: 'none',
              boxShadow: accent === 'amber' ? '0 0 18px oklch(70% 0.10 60 / 0.18)' : 'none',
            }}>
            <Icon className="w-6 h-6" />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--oem-ink, #F0EBE0)' }}>
            {title}
          </h3>
          {sub && (
            <div style={{ fontSize: 15, marginTop: 8, lineHeight: 1.5, color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
              {sub}
            </div>
          )}
        </div>
      </div>
      {control && <div style={{ marginTop: 'auto' }}>{control}</div>}
    </div>
  );
}

function BigToggle({ value, onChange }: { value: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span
        className="font-bold uppercase"
        style={{
          fontSize: 14,
          letterSpacing: '0.10em',
          color: value ? 'var(--oem-amber, oklch(80% 0.13 60))' : 'var(--oem-ink-3, rgba(240,235,224,0.52))',
        }}>
        {value ? 'Etkin' : 'Kapalı'}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange?.(!value)}
        style={{
          width: 60, height: 32, borderRadius: 999, position: 'relative',
          border: '1px solid ' + (value ? 'var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))' : 'var(--oem-line-strong, rgba(240,235,224,0.16))'),
          background: value
            ? 'linear-gradient(180deg, oklch(86% 0.10 70 / 0.55), oklch(60% 0.12 50 / 0.45))'
            : 'rgba(255,255,255,0.06)',
          boxShadow: value
            ? '0 0 18px var(--oem-amber-glow, transparent), inset 0 1px 0 rgba(255,240,210,0.20)'
            : 'inset 0 2px 5px rgba(0,0,0,0.35)',
          cursor: 'pointer',
          transition: 'background .2s ease, border-color .2s ease',
        }}>
        <span
          style={{
            position: 'absolute', top: 4, left: value ? 32 : 4,
            width: 22, height: 22, borderRadius: 999,
            background: '#ffffff',
            transition: 'left .2s ease',
            boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
          }} />
      </button>
    </div>
  );
}

/* ════════════════════════════════════════
   ABOUT / AÇIK KAYNAK LİSANSLARI
   CLAUDE.md "Ticari Lisans / Satışa Uygunluk" kuralı — atıf yükümlülüğü buradan karşılanır.
════════════════════════════════════════ */

const OSS_LICENSES: { name: string; license: string }[] = [
  { name: 'Vosk — offline ses tanıma',   license: 'Apache-2.0' },
  { name: 'Vosk Türkçe Dil Modeli',      license: 'Apache-2.0' },
  { name: 'MapLibre GL',                 license: 'BSD-3-Clause' },
  { name: 'OpenStreetMap harita verisi', license: 'ODbL' },
  { name: 'Capacitor',                   license: 'MIT' },
  { name: 'React',                       license: 'MIT' },
  { name: 'Zustand',                     license: 'MIT' },
  { name: 'Tailwind CSS',                license: 'MIT' },
  { name: 'Lucide Icons',                license: 'ISC' },
  { name: 'usb-serial-for-android',      license: 'MIT' },
];

function AboutTabContent() {
  return (
    <div className="space-y-5">
      <Panel accent="#60a5fa">
        <SectionTitle icon={Info} title="Hakkında" sub="Sürüm ve yasal bilgiler" color="#60a5fa" />
        <div className="flex items-center justify-between px-1">
          <div>
            <div className="text-base font-black" style={{ color: 'var(--oem-ink)' }}>CockpitOS Pro</div>
            <div className="text-[11px] font-bold mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>Araç içi infotainment sistemi</div>
          </div>
          <div className="px-3 py-1.5 rounded-xl glass-card text-[11px] font-black tabular-nums" style={{ color: '#60a5fa' }}>v1.0</div>
        </div>
        <OtaUpdateCard />
        <SupportSnapshotCard />
      </Panel>

      <Panel accent="#34d399">
        <SectionTitle icon={ShieldCheck} title="Açık Kaynak Lisansları" sub="Kullanılan açık kaynak bileşenler ve lisansları" color="#34d399" />
        <div className="flex flex-col gap-2">
          {OSS_LICENSES.map((c) => (
            <div key={c.name} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <span className="text-[12px] font-bold truncate" style={{ color: 'var(--oem-ink)' }}>{c.name}</span>
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg flex-shrink-0"
                style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.25)', color: '#93c5fd' }}>
                {c.license}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 px-3 py-2.5 rounded-xl text-[11px] leading-relaxed"
          style={{ background: 'var(--oem-warn-soft)', border: '1px solid var(--oem-warn)', color: 'var(--oem-ink-2)' }}>
          Harita verileri <span style={{ color: '#fbbf24', fontWeight: 800 }}>© OpenStreetMap katkıcıları</span> tarafından sağlanır (ODbL).
          Tüm açık kaynak bileşenler izin verici (permissive) lisanslıdır ve ticari kullanıma uygundur.
        </div>
      </Panel>
    </div>
  );
}

/* ════════════════════════════════════════
   TAB CONTENTS — Sound, Connect, Profiles (gerçek servislere bağlı)
════════════════════════════════════════ */

function SoundTabContent() {
  // Gerçek DSP durumu — audioService kalıcı saklar (safeStorage); sekme her
  // açılışta yeniden mount olduğundan getter'lar güncel değeri verir.
  const [agc,   setAgc]   = useState(() => getAGCEnabled());
  const [focus, setFocus] = useState(() => getDriverFocusEnabled());
  const [svc,   setSvc]   = useState(() => getSvcEnabled());
  return (
    <>
      <SettingsHero
        eyebrow="Ses"
        title="Kabin akustiği"
        sub="Hoparlör sahnesi, ekolayzer, hıza göre ses ve uyarı tonları."
      />
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr', maxWidth: 720, margin: '0 auto' }}>
        <SettingTile icon={Volume2} accent="amber" title="Akıllı Ses Dengeleme (AGC)"
          sub="YouTube, Spotify gibi kaynaklar arasında ses eşitlenir."
          control={<BigToggle value={agc} onChange={(v) => { setAgc(v); setAGCEnabled(v); }} />} />
        <SettingTile icon={Mic} title="Sürücü Odaklı Ses"
          sub="Ses sahnesi sürücü tarafına kaydırılır — Haas Effect (15ms)."
          control={<BigToggle value={focus} onChange={(v) => { setFocus(v); setDriverFocus(v); }} />} />
        <SettingTile icon={Settings2} title="Hıza Bağlı Ses"
          sub="40 km/s üzerinde yol gürültüsünü dengelemek için ses otomatik artar."
          control={<BigToggle value={svc} onChange={(v) => { setSvc(v); setSvcEnabled(v); }} />} />
        <SettingTile icon={Volume2} title="Uyarı Tonları"
          sub="Şerit ihlali, hız limiti, kapı uyarıları için özelleştirilebilir tonlar."
          control={<div className="text-[13px] font-bold" style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>OEM Varsayılan</div>} />
      </div>
    </>
  );
}

/** Bağlantı durumu rozeti — donanım WebView'dan yönetilemez, gerçek durum gösterilir. */
function ConnStatusBadge({ on }: { on: boolean }) {
  return (
    <span className="text-[10px] font-black uppercase tracking-[0.20em] whitespace-nowrap"
      style={{ color: on ? 'var(--oem-amber, oklch(80% 0.13 60))' : 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
      {on ? 'BAĞLI' : 'BAĞLI DEĞİL'}
    </span>
  );
}

function ConnectTabContent() {
  const dev = useDeviceStatus();
  // Wi-Fi/BT donanımı WebView'dan aç/kapa yapılamaz — native'de sistem ayarı açılır.
  const openWifi = useCallback(() => { void CarLauncher.openWifiSettings?.().catch(() => undefined); }, []);
  const openBt   = useCallback(() => { void CarLauncher.openBluetoothSettings?.().catch(() => undefined); }, []);
  const tapHint  = isNative ? ' · Ayarlar için dokun' : '';
  return (
    <>
      <SettingsHero
        eyebrow="Bağlantı"
        title="Ağ & Eşleme"
        sub="Wi-Fi, Bluetooth ve sistem güncellemeleri — cihazın gerçek durumu."
      />
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr', maxWidth: 720, margin: '0 auto' }}>
        <SettingTile icon={Wifi} accent={dev.wifiConnected ? 'amber' : undefined} title="Wi-Fi"
          sub={(dev.wifiConnected ? `Bağlı${dev.wifiName ? ` · ${dev.wifiName}` : ''}` : 'Bağlı değil') + tapHint}
          onClick={isNative ? openWifi : undefined}
          control={<ConnStatusBadge on={dev.wifiConnected} />} />
        <SettingTile icon={Smartphone} accent={dev.btConnected ? 'amber' : undefined} title="Bluetooth"
          sub={(dev.btConnected ? `Bağlı${dev.btDevice ? ` · ${dev.btDevice}` : ''}` : 'Eşleşmiş cihaz bağlı değil') + tapHint}
          onClick={isNative ? openBt : undefined}
          control={<ConnStatusBadge on={dev.btConnected} />} />
        {/* Gerçek OTA akışı — Hakkında sekmesindeki kartla aynı store (otaUpdateService) */}
        <OtaUpdateCard />
        <SettingTile icon={HardDrive} title="Veri Yansıtma"
          sub="CarPlay / Android Auto / MirrorLink protokol katmanı."
          control={<div className="text-[13px] font-bold" style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>Pasif</div>} />
      </div>
    </>
  );
}

const MAX_PROFILES = 4;
const DRIVE_MODE_LABEL: Record<'comfort' | 'sport' | 'eco', string> = {
  comfort: 'Konfor mod', sport: 'Spor mod', eco: 'Eko mod',
};

/** Profil özet satırı: mod · sıcaklık · müzik (yalnız dolu alanlar). */
function profileSummary(p: VehicleProfile): string {
  const parts: string[] = [];
  if (p.driveMode) parts.push(DRIVE_MODE_LABEL[p.driveMode]);
  if (typeof p.climateTempC === 'number') parts.push(`${p.climateTempC}°C`);
  if (p.defaultMusic && MUSIC_OPTIONS[p.defaultMusic]) parts.push(MUSIC_OPTIONS[p.defaultMusic].name);
  return parts.length ? parts.join(', ') : 'Tercih kaydedilmedi';
}

function ProfilesTabContent() {
  const { profiles, activeId, settings, addVehicleProfile, setActiveVehicleProfile, removeVehicleProfile, updateSettings } =
    useStore(useShallow((s) => ({
      profiles: s.settings.vehicleProfiles,
      activeId: s.settings.activeVehicleProfileId,
      settings: s.settings,
      addVehicleProfile: s.addVehicleProfile,
      setActiveVehicleProfile: s.setActiveVehicleProfile,
      removeVehicleProfile: s.removeVehicleProfile,
      updateSettings: s.updateSettings,
    })));

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const activate = useCallback((p: VehicleProfile) => {
    setActiveVehicleProfile(p.id);
    // Güvenli, görünür etki: profilin müzik tercihini uygulamaya yansıt.
    if (p.defaultMusic) updateSettings({ defaultMusic: p.defaultMusic });
  }, [setActiveVehicleProfile, updateSettings]);

  const confirmAdd = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    // Yeni profil MEVCUT tercihleri anlık görüntü olarak yakalar.
    addVehicleProfile({
      id: `prof-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      defaultMusic: settings.defaultMusic as MusicOptionKey | undefined,
      driveMode: 'comfort',
      climateTempC: 21,
      createdAt: now,
      lastUsedAt: null,
    });
    setNewName(''); setAdding(false);
  }, [newName, settings.defaultMusic, addVehicleProfile]);

  const del = useCallback((p: VehicleProfile) => {
    if (typeof window !== 'undefined' && !window.confirm(`"${p.name}" profili silinsin mi?`)) return;
    removeVehicleProfile(p.id);
  }, [removeVehicleProfile]);

  const full = profiles.length >= MAX_PROFILES;

  return (
    <>
      <SettingsHero
        eyebrow="Profiller"
        title="Sürücü hafızası"
        sub="Koltuk, iklim, müzik ve sürüş tercihlerini profil başına saklayın."
      />
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr', maxWidth: 720, margin: '0 auto' }}>
        {profiles.length === 0 && !adding && (
          <div style={{ padding: '28px 30px', borderRadius: 24, textAlign: 'center',
            background: 'var(--oem-surface-1, #262C3C)', border: '1px dashed var(--oem-line, rgba(255,240,210,0.18))',
            color: 'var(--oem-ink-2, rgba(240,235,224,0.74))', fontSize: 15 }}>
            Henüz profil yok. İlk sürücü profilini ekleyerek tercihlerini kaydet.
          </div>
        )}

        {profiles.map((p) => {
          const isActive = p.id === activeId;
          return (
            <SettingTile
              key={p.id}
              icon={Users}
              accent={isActive ? 'amber' : undefined}
              title={p.name}
              sub={`${isActive ? 'Aktif profil · ' : ''}${profileSummary(p)}`}
              onClick={() => activate(p)}
              control={
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.20em]"
                    style={{ color: isActive ? 'var(--oem-amber, oklch(80% 0.13 60))' : 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
                    {isActive ? 'AKTİF' : 'PASİF'}
                  </span>
                  <button
                    type="button"
                    aria-label="Profili sil"
                    onClick={(e) => { e.stopPropagation(); del(p); }}
                    style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center',
                      background: 'var(--oem-surface-2, #303749)', border: '1px solid var(--oem-line, rgba(255,240,210,0.08))',
                      color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              }
            />
          );
        })}

        {adding ? (
          <div style={{ padding: '24px 30px', borderRadius: 24,
            background: 'var(--oem-surface-1, #262C3C)', border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
            display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmAdd(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
              placeholder="Sürücü adı (örn. Mehmet)"
              maxLength={24}
              className="w-full outline-none"
              style={{ background: 'var(--oem-surface-2, #303749)', border: '1px solid var(--oem-line, rgba(255,240,210,0.10))',
                borderRadius: 14, padding: '14px 16px', fontSize: 17, color: 'var(--oem-ink, #F0EBE0)' }}
            />
            <div className="flex gap-3">
              <button type="button" onClick={confirmAdd} disabled={!newName.trim()}
                className="flex-1" style={{ padding: '13px 0', borderRadius: 14, fontSize: 15, fontWeight: 700,
                  background: newName.trim() ? 'var(--oem-amber, oklch(80% 0.13 60))' : 'var(--oem-surface-2, #303749)',
                  color: newName.trim() ? '#1a1206' : 'var(--oem-ink-3, rgba(240,235,224,0.4))', border: 'none' }}>
                Kaydet
              </button>
              <button type="button" onClick={() => { setAdding(false); setNewName(''); }}
                style={{ padding: '13px 22px', borderRadius: 14, fontSize: 15, fontWeight: 600,
                  background: 'transparent', border: '1px solid var(--oem-line, rgba(255,240,210,0.12))',
                  color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                Vazgeç
              </button>
            </div>
          </div>
        ) : (
          <SettingTile
            icon={Star}
            title="Yeni Profil Ekle"
            sub={full ? 'Profil sınırına ulaşıldı — silerek yer açın.' : `Maksimum ${MAX_PROFILES} profil destekler.`}
            onClick={full ? undefined : () => setAdding(true)}
            control={<div className="text-[10px] font-black uppercase tracking-[0.20em]"
              style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>{profiles.length} / {MAX_PROFILES}</div>}
          />
        )}
      </div>
    </>
  );
}

/* ════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════ */
interface Props { onOpenMap?: () => void; onClose?: () => void; }

type Tab = 'general' | 'appearance' | 'performance' | 'maintenance' | 'sound' | 'connect' | 'profiles' | 'about';
const TAB_IDS: Tab[] = ['general', 'appearance', 'performance', 'maintenance', 'sound', 'connect', 'profiles'];
const TAB_STORAGE_KEY = 'caros.settings.tab';

function SettingsPageInner({ onClose }: Props) {
  const { settings, updateSettings, updateVehicleProfile, setActiveVehicleProfile, addVehicleProfile, removeVehicleProfile } = useStore(
    useShallow((s) => ({
      settings: s.settings, updateSettings: s.updateSettings, updateVehicleProfile: s.updateVehicleProfile,
      setActiveVehicleProfile: s.setActiveVehicleProfile, addVehicleProfile: s.addVehicleProfile, removeVehicleProfile: s.removeVehicleProfile,
    })),
  );
  // Tab persists across the session (CLAUDE.md Faz 8 task 3).
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = sessionStorage.getItem(TAB_STORAGE_KEY) as Tab | null;
      return saved && TAB_IDS.includes(saved) ? saved : 'general';
    } catch { return 'general'; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* quota / private mode */ }
  }, [tab]);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showOBDConnect, setShowOBDConnect] = useState(false);
  const { locked: layoutLocked, toggleLock } = useEditStore();
  const [perfMode, setPerfMode]         = useState(() => getPerformanceMode());
  const [autoMode, setAutoMode]         = useState(() => isAutoModeEnabled());
  const [agcOn,    setAgcOn]            = useState(() => getAGCEnabled());
  const [focusOn,  setFocusOn]          = useState(() => getDriverFocusEnabled());
  // Ses sekmesi de aynı DSP servisini yönetiyor — sekme dönüşünde bayat state'i tazele.
  useEffect(() => {
    if (tab === 'general') { setAgcOn(getAGCEnabled()); setFocusOn(getDriverFocusEnabled()); }
  }, [tab]);

  // ── Gizli Mühendislik Erişimi ──────────────────────────────────────────────
  const [showSecureModal, setShowSecureModal] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSecretTap() {
    tapCountRef.current += 1;

    if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 3000);

    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      if (tapTimerRef.current !== null) { clearTimeout(tapTimerRef.current); tapTimerRef.current = null; }
      setShowSecureModal(true);
    }
  }

  function closeSecureModal() {
    setShowSecureModal(false);
    tapCountRef.current = 0;
    if (tapTimerRef.current !== null) { clearTimeout(tapTimerRef.current); tapTimerRef.current = null; }
  }

  useLayoutSync();
  const sense = useScreenSense();
  // Telefon/kompakt ekran tespiti: yükseklik < 500 veya genişlik < 800
  const isCompactScreen   = sense.height < 500 || sense.width < 800;
  const nativeControls    = isSystemControlSupported();

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

  // ─ Sidebar nav — 1:1 screens.jsx SETTINGS_NAV (Genel Bakış, Ekran, Ses, Araç, Sürüş, Bağlantı, Profiller)
  const TABS: Array<{ id: Tab; label: string; Icon: LucideIcon; color: string }> = [
    { id: 'general'     as Tab, label: 'Genel Bakış',      Icon: Grid3X3,    color: '#60a5fa' },
    { id: 'appearance'  as Tab, label: 'Ekran & Atmosfer', Icon: Palette,    color: '#e879f9' },
    { id: 'sound'       as Tab, label: 'Ses',              Icon: Volume2,    color: '#a78bfa' },
    { id: 'maintenance' as Tab, label: 'Araç',             Icon: Gauge,      color: '#34d399' },
    { id: 'performance' as Tab, label: 'Sürüş Asistanı',   Icon: Zap,        color: '#fbbf24' },
    { id: 'connect'     as Tab, label: 'Bağlantı',         Icon: Wifi,       color: '#22d3ee' },
    { id: 'profiles'    as Tab, label: 'Profiller',        Icon: Star,       color: '#fb923c' },
    { id: 'about'       as Tab, label: 'Hakkında',         Icon: Info,       color: '#60a5fa' },
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
      className="flex-1 flex flex-col min-h-0 ultra-premium-root settings-page"
      data-theme-pack={settings.themePack}
      data-theme-style={settings.themeStyle}
      data-day-night={settings.dayNightMode}
      style={{ background: wallpaperBg, width: '100%', maxWidth: '100%', minHeight: 0 } as React.CSSProperties}
    >

      {/* ═══ HEADER — 2 satır: üst (nav+stats), alt (sekmeler) ═══ */}
      <div className="flex-shrink-0 relative z-20"
        style={{
          background: settings.dayNightMode === 'day' ? 'rgba(248,249,251,0.94)' : 'rgba(8,12,24,0.92)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid ' + (settings.dayNightMode === 'day' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)'),
        }}>

        {/* Satır 1: Navigasyon + Live Stats */}
        <div className={`flex items-center gap-2 px-4 ${isCompactScreen ? 'py-1.5' : 'pt-3 pb-2'}`}>
          <button onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl active:scale-95 transition-all flex-shrink-0"
            style={{ background: 'var(--oem-surface-2, rgba(255,255,255,0.06))', border: '1px solid var(--oem-line-strong, rgba(255,255,255,0.09))' }}>
            <ArrowLeft className="w-4 h-4" style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.55))' }} />
            <span className="text-[11px] font-black uppercase tracking-widest hidden sm:inline" style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.45))' }}>Geri</span>
          </button>

          <div className="flex flex-col leading-none flex-shrink-0 ml-1">
            <span className="text-[13px] font-black uppercase tracking-[0.15em]" style={{ color: 'var(--oem-ink, #fff)' }}>Ayarlar</span>
            <span className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.60))' }}>
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
            style={{ background: 'var(--oem-surface-2, rgba(255,255,255,0.05))', border: '1px solid var(--oem-line-strong, rgba(255,255,255,0.08))' }}>
            <X className="w-4 h-4" style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.40))' }} />
          </button>
        </div>

        {/* Bottom glow line — kept under header (no more tab row) */}
        <div style={{
          height: '1px',
          background: 'linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.30) 30%, rgba(139,92,246,0.20) 70%, transparent 100%)',
        }} />
      </div>

      {/* ═══ BODY — 340px sidebar + content (1:1 screens.jsx SettingsScreen) ═══ */}
      <div className="flex flex-1 min-h-0 z-10">

        {/* SIDEBAR — fixed 340px (compact ekranlarda 96px ikon-only) */}
        <div
          style={{
            width: isCompactScreen ? 96 : 340,
            borderRight: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
            padding: isCompactScreen ? '24px 10px' : '32px 22px',
            overflow: 'auto',
            flex: 'none',
            background:
              'linear-gradient(180deg, rgba(255,240,210,0.03), transparent 12%, transparent 88%, rgba(255,240,210,0.02))',
          }}>
          {!isCompactScreen && (
            <div className="text-[11px] font-black uppercase"
              style={{
                padding: '0 18px 22px',
                letterSpacing: '0.20em',
                color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
              }}>
              Ayarlar
            </div>
          )}
          <div className="flex flex-col" style={{ gap: 8 }}>
            {TABS.map((s) => {
              const active = tab === s.id;
              const Icon = s.Icon;
              return (
                <button
                  key={s.id}
                  onClick={() => setTab(s.id)}
                  style={{
                    width: '100%',
                    appearance: 'none',
                    border: '1px solid ' + (active ? 'var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))' : 'transparent'),
                    background: active
                      ? 'linear-gradient(180deg, rgba(59,130,246,0.12), rgba(59,130,246,0.03) 70%), var(--oem-surface-1, #262C3C)'
                      : 'transparent',
                    color: active ? 'var(--oem-ink, #F0EBE0)' : 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                    padding: isCompactScreen ? '14px 8px' : '20px 22px',
                    borderRadius: 20,
                    display: 'flex',
                    flexDirection: isCompactScreen ? 'column' : 'row',
                    alignItems: 'center',
                    gap: isCompactScreen ? 6 : 18,
                    fontSize: 17,
                    fontWeight: 600,
                    textAlign: isCompactScreen ? 'center' : 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    letterSpacing: '-0.005em',
                    position: 'relative',
                    boxShadow: active
                      ? '0 1px 0 rgba(255,255,255,0.10) inset, 0 12px 28px -16px oklch(60% 0.10 250 / 0.40)'
                      : 'none',
                    transition: 'background .15s ease, color .15s ease, border-color .15s ease',
                  }}>
                  {/* Amber glow bar on the left when active */}
                  {active && !isCompactScreen && (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: -10,
                        top: 14,
                        bottom: 14,
                        width: 4,
                        borderRadius: 4,
                        background:
                          'linear-gradient(180deg, oklch(86% 0.07 248), oklch(66% 0.11 250) 60%, oklch(50% 0.12 252))',
                        boxShadow: '0 0 14px oklch(70% 0.10 248 / 0.50)',
                      }} />
                  )}
                  <span
                    style={{
                      width: isCompactScreen ? 36 : 48,
                      height: isCompactScreen ? 36 : 48,
                      borderRadius: 14,
                      background: active
                        ? 'var(--oem-amber-soft, oklch(80% 0.13 60 / 0.18))'
                        : 'var(--oem-surface-2, #303749)',
                      border: '1px solid ' + (active ? 'var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))' : 'var(--oem-line, rgba(255,240,210,0.08))'),
                      display: 'grid',
                      placeItems: 'center',
                      color: active ? 'var(--oem-amber, oklch(80% 0.13 60))' : s.color,
                      flex: 'none',
                      filter: active ? 'drop-shadow(0 0 10px oklch(80% 0.13 60 / 0.50))' : 'none',
                    }}>
                    <Icon className={isCompactScreen ? 'w-4 h-4' : 'w-5 h-5'} />
                  </span>
                  {!isCompactScreen && (
                    <>
                      <span className="truncate">{s.label}</span>
                      <span style={{ flex: 1 }} />
                      {active && <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }} />}
                    </>
                  )}
                  {isCompactScreen && (
                    <span className="text-[9px] font-black uppercase tracking-[0.10em] truncate w-full"
                      style={{ color: active ? 'var(--oem-amber, oklch(80% 0.13 60))' : 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
                      {s.label.split(' ')[0]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ═══ CONTENT STAGE ═══ */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
          style={{
            WebkitOverflowScrolling: 'touch',
            overflowY: 'scroll',
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
            padding: isCompactScreen ? '20px 16px' : '36px 40px',
          }}>
        <div className="max-w-[1600px] mx-auto flex flex-col gap-3">

          {tab === 'general' && (
            <div className="flex flex-col gap-4 mx-auto w-full" style={{ maxWidth: 760 }}>
              {nativeControls && (
                <Panel accent="#3b82f6">
                  <SectionTitle icon={Settings2} title="Donanım Kontrolleri" sub="Sistem öncelikli ayarlar" color="#3b82f6" />
                  <div className="flex flex-col gap-6">
                    <PremiumSlider icon={Sun}     label="Parlaklık Seviyesi" value={settings.brightness} onChange={handleBrightness} colorA="#f59e0b" colorB="#f97316" />
                    <PremiumSlider icon={Volume2} label="Ses Düzeyi" value={settings.volume} onChange={handleVolume} colorA="#3b82f6" colorB="#06b6d4" />
                  </div>
                </Panel>
              )}

              {/* ── Crystal Cabin DSP v3 ── */}
              <Panel accent="#8b5cf6">
                <SectionTitle icon={Volume2} title="Crystal Cabin DSP" sub="Otomotiv sınıfı ses işleme" color="#8b5cf6" />
                <div className="flex flex-col gap-3">
                  <PremiumToggle
                    icon={Volume2}
                    label="Akıllı Ses Dengeleme"
                    desc="YouTube, Spotify gibi kaynaklar arasında ses eşitler (AGC)"
                    value={agcOn}
                    onChange={(v) => { setAgcOn(v); setAGCEnabled(v); }}
                    accent="#8b5cf6"
                  />
                  <PremiumToggle
                    icon={Cpu}
                    label="Sürücü Odaklı Ses"
                    desc="Ses sürücü tarafına odaklanır — Haas Effect (15ms)"
                    value={focusOn}
                    onChange={(v) => { setFocusOn(v); setDriverFocus(v); }}
                    accent="#a78bfa"
                  />
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

              {/* ── "Yol Arkadaşım" (Companion AI) ── */}
              <Panel accent="#22d3ee">
                <SectionTitle icon={MessageCircle} title="Yol Arkadaşım" sub="Kişilikli yolculuk asistanı" color="#22d3ee" />
                <CompanionPanel />
              </Panel>

              <Panel accent="#22d3ee">
                <SectionTitle icon={HardDrive} title="Offline Konum Veritabanı" sub="Mahalle, benzinlik, hastane — internetsiz ara" color="#22d3ee" />
                <OfflineDataPanel />
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
                          <p className="text-sm font-bold" style={{ color: active ? 'var(--oem-ink, #fff)' : 'var(--oem-ink-2, rgba(255,255,255,0.80))' }}>{label}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: active ? `${color}90` : 'var(--oem-ink-3, rgba(255,255,255,0.60))' }}>{sub}</p>
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
                  <p className="text-[9px] mt-2 leading-relaxed" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.3))' }}>🌐 işaretli temalar internet bağlantısı gerektirir.</p>
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
                  <div className="text-center py-6 text-sm" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.3))' }}>
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
                                className="font-bold text-sm bg-transparent border-none outline-none truncate w-full max-w-[140px]"
                                style={{ caretColor: '#60a5fa', color: 'var(--oem-ink, #fff)' }}
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
                                    : { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: 'var(--oem-ink-2, rgba(255,255,255,0.70))' }}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            {!isActive && (
                              <button onClick={() => setActiveVehicleProfile(profile.id)}
                                className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10 hover:border-white/30 transition-all active:scale-95"
                                style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.4))' }}>
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
                  <p className="text-[11px] mb-3 leading-relaxed" style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.4))' }}>
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

              {/* CAN Bus Teşhis paneli KALDIRILDI (2026-07-03): sniffer/log-yakalama
                  geliştirme aracıydı; teşhis artık doğrudan ADB ile yapılıyor.
                  Alt servisler (canDiag listener, EventRecorder) duruyor — UI'sız uyur. */}

              {/* ── Expert Mode (AI Safety Layer) ── */}
              <Panel accent="#10b981">
                <SectionTitle icon={ShieldCheck} title="CarOS Pro Expert Mode" sub="AI tabanlı otomotiv güvenlik katmanı ve mühürlü diagnostik" color="#10b981" />
                <ExpertModePanel />
              </Panel>
            </div>
          )}

          {tab === 'performance' && (
            <div className="flex flex-col gap-4">
              <Panel accent="#fbbf24">
                <div className="flex items-center justify-between mb-4">
                  <div
                    onClick={handleSecretTap}
                    style={{ WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}
                    role="presentation"
                  >
                    <SectionTitle icon={Zap} title="Sistem Güç Profili" sub="İşlemci ve görsel kalite optimizasyonu" color="#fbbf24" />
                  </div>
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
                        style={{ color: autoMode ? '#fbbf24' : 'var(--oem-ink-2, rgba(255,255,255,0.45))' }}>
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
                    { label: 'Platform',       value: isNative ? 'Android' : 'Web',    Icon: Smartphone, color: '#60a5fa', pct: null },
                    { label: 'WebView',        value: getWebViewLabel(),               Icon: HardDrive,  color: '#34d399', pct: null },
                    { label: 'Donanım Sınıfı', value: TIER_LABEL[getDeviceTier()].name, Icon: Cpu,       color: '#fb923c', pct: TIER_LABEL[getDeviceTier()].pct },
                    { label: 'Bellek',         value: getDeviceMemLabel(),             Icon: Database,   color: '#a78bfa', pct: null },
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
                        <div className="text-[13px] font-black tracking-tight mt-0.5" style={{ color: 'var(--oem-ink, rgba(255,255,255,0.85))' }}>{s.value}</div>
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

          {/* ── Phase 8 new tabs — Sound, Connect, Profiles ── */}
          {tab === 'sound' && <SoundTabContent />}
          {tab === 'connect' && <ConnectTabContent />}
          {tab === 'profiles' && <ProfilesTabContent />}
          {tab === 'about' && <AboutTabContent />}

          {/* Privacy */}
          <div className="flex justify-center py-10">
            <button onClick={() => setShowPrivacy(true)}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl glass-card border-[var(--oem-line)] hover:bg-[var(--oem-surface-2)] transition-all group active:scale-95">
              <Shield className="w-4 h-4 text-[color:var(--oem-ink-3)] group-hover:text-[color:var(--oem-ink-2)] transition-colors" />
              <span className="text-[10px] font-black uppercase tracking-[0.5em] text-[color:var(--oem-ink-3)] group-hover:text-[color:var(--oem-ink-2)] transition-all">Gizlilik ve Güvenlik</span>
            </button>
          </div>
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

      {showSecureModal && (
        <Suspense fallback={null}>
          <SecureAccessModal onClose={closeSecureModal} />
        </Suspense>
      )}
    </div>
  );
}

export const SettingsPage = memo(SettingsPageInner);


