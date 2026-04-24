/**
 * SetupWizard — ilk açılışta kurulum sihirbazı (premium).
 *
 * Adımlar:
 *   0. Hoş Geldiniz   — marka tanıtımı + özellik özeti
 *   1. Görünüm        — tema paketi seçimi (renk swatch + emoji)
 *   2. Uygulamalar    — varsayılan müzik + navigasyon seçimi
 *   3. İzinler        — gerekli sistem izinleri
 *   4. OBD (opsiyonel)— Bluetooth ELM327 bağlantısı (atlanabilir)
 *   5. Önizleme       — ana ekran mockup + Başlat butonu
 *
 * Tamamlandığında useStore.hasCompletedSetup = true olur.
 */
import { useState, useEffect, memo } from 'react';
import {
  ChevronRight, ChevronLeft, Check,
  Bluetooth, Rocket, Eye,
  ShieldCheck, MapPin, Mic, BookUser, Camera,
  Music2, Loader2, Navigation,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { CarLauncher } from '../../platform/nativePlugin';
import { isNative } from '../../platform/bridge';
import { scanOBD, connectOBD } from '../../platform/obdService';
import { NAV_OPTIONS, MUSIC_OPTIONS } from '../../data/apps';
import type { NavOptionKey, MusicOptionKey } from '../../data/apps';

/* ── Adım tanımları ──────────────────────────────────────── */

type IconComp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

interface StepDef { id: string; title: string; icon: IconComp; }

const STEPS: StepDef[] = [
  { id: 'welcome',     title: 'Hoş Geldiniz',   icon: Rocket      },
  { id: 'apps',        title: 'Uygulamalar',     icon: Music2      },
  { id: 'permissions', title: 'İzinler',         icon: ShieldCheck },
  { id: 'obd',         title: 'OBD',             icon: Bluetooth   },
  { id: 'preview',     title: 'Hazır!',          icon: Eye         },
];

const NAV_COLORS: Record<NavOptionKey, string> = {
  maps:   '#4285f4',
  waze:   '#33ccff',
  yandex: '#f5404a',
};

/* ── İzin listesi ────────────────────────────────────────── */

interface PermDef {
  id:       string;
  label:    string;
  desc:     string;
  icon:     IconComp;
  required: boolean;
}

const PERM_DEFS: PermDef[] = [
  { id: 'location',   label: 'Konum',          desc: 'GPS navigasyon ve park konumu',          icon: MapPin,   required: true  },
  { id: 'microphone', label: 'Mikrofon',        desc: 'Sesli asistan ve uyandırma sözcüğü',    icon: Mic,      required: false },
  { id: 'contacts',   label: 'Kişiler',         desc: 'Araç ekranında telefon rehberi',        icon: BookUser, required: false },
  { id: 'camera',     label: 'Kamera',          desc: 'Geri görüş kamerası ve dashcam',        icon: Camera,   required: false },
];

type PermStatus = 'idle' | 'granted';

/* ── OBD cihaz tipi ─────────────────────────────────────── */

interface OBDDevice { name: string; address: string; }

/* ── BootSplash — High-end brand presentation ────────────── */

export const BootSplash = memo(function BootSplash({ phase }: { phase: 'idle' | 'loading' | 'ready' }) {
  if (phase === 'ready') return null;

  return (
    <div className="fixed inset-0 z-[200] bg-[var(--panel-bg)] flex flex-col items-center justify-center animate-fade-in">
      <div className="flex flex-col items-center gap-8">
        {/* Brand Icon */}
        <div className="w-24 h-24 rounded-[2rem] bg-blue-600 flex items-center justify-center shadow-[0_0_50px_rgba(37,99,235,0.3)] animate-pulse">
          <Rocket className="w-12 h-12 text-primary" />
        </div>
        
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-primary text-3xl font-black tracking-[0.2em] uppercase">Caros Pro</h1>
          <p className="text-blue-400/60 text-xs font-bold tracking-[0.4em] uppercase">Professional Automotive UI</p>
        </div>

        {/* Loader bar */}
        <div className="w-48 h-1 var(--panel-bg-secondary) rounded-full overflow-hidden mt-4">
          <div 
            className="h-full bg-blue-600 rounded-full transition-all duration-1000 ease-out"
            style={{ width: phase === 'loading' ? '100%' : '0%' }}
          />
        </div>
      </div>
    </div>
  );
});

/* ── Ana bileşen ─────────────────────────────────────────── */

export function SetupWizard() {
  const { settings, updateSettings } = useStore();
  const [step, setStep] = useState(0);

  const isLast   = step === STEPS.length - 1;
  const stepMeta = STEPS[step];
  const accent   = '#3b82f6';

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goPrev = () => setStep((s) => Math.max(s - 1, 0));

  // Android hardware back button — wizard adımları arasında geri git
  useEffect(() => {
    const handler = () => { if (step > 0) goPrev(); };
    document.addEventListener('backbutton', handler);
    return () => document.removeEventListener('backbutton', handler);
  }, [step]);
  const finish = () => {
    updateSettings({ hasCompletedSetup: true });
    // Defensive fallback: ensure flag is persisted even if Zustand has a hiccup
    try {
      const stored = JSON.parse(localStorage.getItem('car-launcher-storage') ?? '{}');
      if (stored?.state?.settings) {
        stored.state.settings.hasCompletedSetup = true;
        localStorage.setItem('car-launcher-storage', JSON.stringify(stored));
      }
    } catch {
      // ignore — Zustand persist handles it
    }
  };

  /* ── Permissions ──────────────────────────────────────── */

  const [permStatuses, setPermStatuses] = useState<Record<string, PermStatus>>({});
  const [mediaAccess,  setMediaAccess]  = useState<boolean | null>(null);
  const [writeAccess,  setWriteAccess]  = useState<boolean | null>(null);

  useEffect(() => {
    if (step !== 2 || !isNative) return;
    CarLauncher.checkNotificationAccess()
      .then((r) => setMediaAccess(r.granted))
      .catch(() => setMediaAccess(false));
    CarLauncher.checkWriteSettings()
      .then((r) => setWriteAccess(r.granted))
      .catch(() => setWriteAccess(false));
  }, [step]);

  const grantMedia = () => {
    if (!isNative) return;
    CarLauncher.requestNotificationAccess().catch(() => undefined);
    setTimeout(() => {
      CarLauncher.checkNotificationAccess()
        .then((r) => setMediaAccess(r.granted))
        .catch(() => undefined);
    }, 1800);
  };

  const grantWrite = () => {
    if (!isNative) return;
    CarLauncher.requestWriteSettings()
      .then(() => CarLauncher.checkWriteSettings())
      .then((r) => setWriteAccess(r.granted))
      .catch(() => undefined);
  };

  const grantPerm = (id: string) =>
    setPermStatuses((prev) => ({ ...prev, [id]: 'granted' }));

  /* ── OBD ────────────────────────────────────────────────── */

  const [obdScanning,   setObdScanning]   = useState(false);
  const [obdDevices,    setObdDevices]    = useState<OBDDevice[]>([]);
  const [obdConnecting, setObdConnecting] = useState<string | null>(null);
  const [obdConnected,  setObdConnected]  = useState(false);
  const [obdError,      setObdError]      = useState<string | null>(null);

  const handleScanOBD = async () => {
    setObdScanning(true); setObdError(null); setObdDevices([]);
    try {
      const result = await scanOBD();
      setObdDevices(result);
      if (result.length === 0)
        setObdError('Eşleşmiş Bluetooth cihazı bulunamadı. Cihaz Ayarları → Bluetooth\'tan ELM327 adapterinizi önce eşleştirin.');
    } catch (e) {
      setObdError((e as Error).message ?? 'Tarama başarısız');
    } finally {
      setObdScanning(false);
    }
  };

  const handleConnectOBD = async (address: string) => {
    setObdConnecting(address); setObdError(null);
    try {
      await connectOBD(address);
      setObdConnected(true);
    } catch (e) {
      setObdError((e as Error).message ?? 'Bağlantı başarısız');
    } finally {
      setObdConnecting(null);
    }
  };

  /* ── Safe key lookups ──────────────────────────────────── */

  const musicKey = (settings.defaultMusic in MUSIC_OPTIONS
    ? settings.defaultMusic : 'spotify') as MusicOptionKey;
  const navKey   = (settings.defaultNav   in NAV_OPTIONS
    ? settings.defaultNav   : 'maps')    as NavOptionKey;

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#030810] flex items-center justify-center sm:p-4 animate-fade-in overflow-hidden"
      style={{
        paddingTop:    'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft:   'env(safe-area-inset-left)',
        paddingRight:  'env(safe-area-inset-right)',
      }}
    >
      <div
        className="w-full sm:max-w-xl flex flex-col overflow-hidden"
        style={{
          background:   '#0a1020',
          borderRadius: window.innerWidth < 640 ? 0 : 32,
          border:       window.innerWidth < 640 ? 'none' : '1px solid rgba(255,255,255,0.06)',
          boxShadow:    window.innerWidth < 640 ? 'none' : `0 32px 80px rgba(0,0,0,0.8), 0 0 60px ${accent}14`,
          // JS hesaplaması — CSS min() eski WebView'da desteklenmez
          height: window.innerWidth < 640
            ? '100%'
            : `${Math.min(700, Math.floor(window.innerHeight * 0.96))}px`,
        }}
      >
        {/* ── Adım göstergesi ────────────────────────────── */}
        <div className="flex items-center justify-between px-6 sm:px-8 pt-7 pb-1">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className="rounded-full"
                style={{
                  width:           i === step ? 20 : 6,
                  height:          6,
                  backgroundColor: i < step   ? '#22c55e'
                                 : i === step ? accent
                                 :              'rgba(255,255,255,0.08)',
                  transition:      'all 0.35s cubic-bezier(0.4,0,0.2,1)',
                }}
              />
            ))}
          </div>
          <span className="text-slate-700 text-[11px] font-bold tabular-nums">
            {step + 1} / {STEPS.length}
          </span>
        </div>

        {/* ── İçerik — key={step} ile her adımda animate-slide-up ── */}
        <div key={step} className="flex-1 min-h-0 flex flex-col items-center px-6 sm:px-8 py-5 animate-slide-up overflow-y-auto no-scrollbar">

          {/* Adım ikonu */}
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 flex-shrink-0"
            style={{
              background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
              border:     `1px solid ${accent}28`,
            }}
          >
            <stepMeta.icon className="w-7 h-7" style={{ color: accent }} />
          </div>

          {/* ── Adım 0: Hoş Geldiniz ─────────────────────── */}
          {step === 0 && (
            <div className="w-full flex flex-col items-center gap-5 text-center">
              <div>
                <h1 className="text-2xl font-bold text-primary mb-2">CockpitOS</h1>
                <p className="text-slate-400 text-sm leading-relaxed max-w-sm px-2">
                  Aracınız için tasarlanmış dijital kokpit. Birkaç adımda
                  kişiselleştirin ve yola çıkın.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 w-full max-w-sm">
                {[
                  { icon: '🗺️', label: 'Offline Harita' },
                  { icon: '🔌', label: 'OBD-II Veri'    },
                  { icon: '🎵', label: 'Medya Hub'       },
                  { icon: '🎤', label: 'Sesli Asistan'   },
                  { icon: '📷', label: 'Dashcam'         },
                  { icon: '👥', label: 'Yolcu Kontrolü'  },
                ].map((f) => (
                  <div
                    key={f.label}
                    className="flex flex-col items-center gap-2 py-3 px-2 rounded-2xl border border-white/5"
                    style={{ backgroundColor: `${accent}09` }}
                  >
                    <span className="text-2xl leading-none">{f.icon}</span>
                    <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wide leading-tight text-center">
                      {f.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Adım 1: Varsayılan Uygulamalar ───────────── */}
          {step === 1 && (
            <div className="w-full flex flex-col gap-5">
              <div className="text-center">
                <h2 className="text-xl font-bold text-primary mb-1">Varsayılan Uygulamalar</h2>
                <p className="text-slate-500 text-sm">
                  Sesli komutlarda ve hızlı erişimde kullanılır.
                </p>
              </div>

              {/* Müzik */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-0.5">
                  <Music2 className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">
                    Müzik Uygulaması
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.entries(MUSIC_OPTIONS) as [MusicOptionKey, typeof MUSIC_OPTIONS[MusicOptionKey]][]).map(([key, opt]) => {
                    const active = settings.defaultMusic === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => updateSettings({ defaultMusic: key })}
                        className="flex items-center gap-3 p-3.5 rounded-2xl border text-left active:scale-95"
                        style={{
                          backgroundColor: active ? `${opt.color}15` : 'rgba(255,255,255,0.04)',
                          borderColor:     active ? opt.color : 'rgba(255,255,255,0.06)',
                        }}
                      >
                        <span className="text-2xl leading-none flex-shrink-0">{opt.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-primary text-sm font-bold truncate">{opt.name}</div>
                          {active && (
                            <div className="text-[10px] font-bold mt-0.5" style={{ color: opt.color }}>
                              Seçili ✓
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Navigasyon */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-0.5">
                  <Navigation className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">
                    Navigasyon Uygulaması
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.entries(NAV_OPTIONS) as [NavOptionKey, typeof NAV_OPTIONS[NavOptionKey]][]).map(([key, opt]) => {
                    const active = settings.defaultNav === key;
                    const color  = NAV_COLORS[key] ?? '#4285f4';
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => updateSettings({ defaultNav: key })}
                        className="flex items-center gap-3 p-3.5 rounded-2xl border text-left active:scale-95"
                        style={{
                          backgroundColor: active ? `${color}15` : 'rgba(255,255,255,0.04)',
                          borderColor:     active ? color : 'rgba(255,255,255,0.06)',
                        }}
                      >
                        <span className="text-2xl leading-none flex-shrink-0">{opt.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-primary text-sm font-bold truncate">{opt.name}</div>
                          {active && (
                            <div className="text-[10px] font-bold mt-0.5" style={{ color }}>
                              Seçili ✓
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Adım 2: İzinler ──────────────────────────── */}
          {step === 2 && (
            <div className="w-full flex flex-col gap-3">
              <div className="text-center">
                <h2 className="text-xl font-bold text-primary mb-1">Uygulama İzinleri</h2>
                <p className="text-slate-500 text-sm">
                  Tam deneyim için önerilen izinler.
                </p>
              </div>

              {/* Standart izinler */}
              {PERM_DEFS.map((p) => {
                const granted = permStatuses[p.id] === 'granted';
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-white/5"
                    style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: granted ? '#22c55e15' : `${accent}10`,
                        border:          `1px solid ${granted ? '#22c55e25' : `${accent}18`}`,
                      }}
                    >
                      <p.icon className="w-4 h-4" style={{ color: granted ? '#22c55e' : '#64748b' }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-primary text-sm font-bold">{p.label}</span>
                        {p.required && (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                            style={{ backgroundColor: `${accent}18`, color: accent }}
                          >
                            GEREKLİ
                          </span>
                        )}
                      </div>
                      <div className="text-slate-600 text-[11px] truncate">{p.desc}</div>
                    </div>

                    {granted ? (
                      <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => grantPerm(p.id)}
                        className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex-shrink-0 active:scale-95"
                        style={{
                          backgroundColor: `${accent}18`,
                          color:            accent,
                          border:          `1px solid ${accent}22`,
                        }}
                      >
                        İzin Ver
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Android özel izinleri */}
              {isNative && (
                <>
                  {/* Bildirim erişimi */}
                  <div
                    className="flex items-center gap-3 p-3 rounded-xl border border-white/5"
                    style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: mediaAccess ? '#22c55e15' : `${accent}10`,
                        border:          `1px solid ${mediaAccess ? '#22c55e25' : `${accent}18`}`,
                      }}
                    >
                      <Music2 className="w-4 h-4" style={{ color: mediaAccess ? '#22c55e' : '#64748b' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-primary text-sm font-bold">Bildirim Erişimi</span>
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ backgroundColor: `${accent}18`, color: accent }}
                        >
                          GEREKLİ
                        </span>
                      </div>
                      <div className="text-slate-600 text-[11px] truncate">
                        Müzik metadata tespiti için
                      </div>
                    </div>
                    {mediaAccess
                      ? <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      : <button
                          type="button"
                          onClick={grantMedia}
                          className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex-shrink-0 active:scale-95"
                          style={{ backgroundColor: `${accent}18`, color: accent, border: `1px solid ${accent}22` }}
                        >
                          Aç
                        </button>
                    }
                  </div>

                  {/* Parlaklık kontrolü */}
                  <div
                    className="flex items-center gap-3 p-3 rounded-xl border border-white/5"
                    style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: writeAccess ? '#22c55e15' : `${accent}10`,
                        border:          `1px solid ${writeAccess ? '#22c55e25' : `${accent}18`}`,
                      }}
                    >
                      <ShieldCheck className="w-4 h-4" style={{ color: writeAccess ? '#22c55e' : '#64748b' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-primary text-sm font-bold block">Parlaklık Kontrolü</span>
                      <span className="text-slate-600 text-[11px]">Otomatik parlaklık için WRITE_SETTINGS</span>
                    </div>
                    {writeAccess
                      ? <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      : <button
                          type="button"
                          onClick={grantWrite}
                          className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex-shrink-0 active:scale-95"
                          style={{ backgroundColor: `${accent}18`, color: accent, border: `1px solid ${accent}22` }}
                        >
                          Aç
                        </button>
                    }
                  </div>
                </>
              )}

              <p className="text-slate-700 text-[11px] text-center mt-1">
                İzinleri daha sonra Ayarlar → İzinler bölümünden değiştirebilirsiniz.
              </p>
            </div>
          )}

          {/* ── Adım 3: OBD ──────────────────────────────── */}
          {step === 3 && (
            <div className="w-full flex flex-col items-center gap-4">
              <div className="text-center">
                <h2 className="text-xl font-bold text-primary mb-1">OBD-II Entegrasyonu</h2>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
                  ELM327 Bluetooth adapteriniz varsa bağlayın.
                  Araç hız, RPM, sıcaklık ve yakıt verisi gösterilir.
                  Yoksa atlamanız yeterli.
                </p>
              </div>

              {obdConnected ? (
                <div
                  className="w-full max-w-xs rounded-2xl p-4 flex items-center gap-3"
                  style={{
                    backgroundColor: '#22c55e10',
                    border:          '1px solid #22c55e25',
                  }}
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-emerald-400 font-bold text-sm">Bağlandı!</div>
                    <div className="text-slate-400 text-xs">OBD verisi aktarılıyor.</div>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-xs flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handleScanOBD}
                    disabled={obdScanning}
                    className="w-full py-3.5 text-primary rounded-2xl font-bold flex items-center justify-center gap-2.5 active:scale-95 disabled:opacity-50"
                    style={{
                      backgroundColor: accent,
                      boxShadow:       `0 4px 20px ${accent}35`,
                    }}
                  >
                    {obdScanning
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <Bluetooth className="w-5 h-5" />
                    }
                    {obdScanning ? 'Taranıyor…' : 'Bluetooth Cihazlarını Tara'}
                  </button>

                  {obdError && (
                    <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-3 text-red-400 text-xs leading-relaxed">
                      {obdError}
                    </div>
                  )}

                  {obdDevices.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {obdDevices.map((d) => (
                        <button
                          type="button"
                          key={d.address}
                          onClick={() => handleConnectOBD(d.address)}
                          disabled={!!obdConnecting}
                          className="w-full flex items-center justify-between var(--panel-bg-secondary) border border-white/5 rounded-xl p-3 text-left disabled:opacity-50 active:scale-95"
                        >
                          <div>
                            <div className="text-primary text-sm font-bold">{d.name}</div>
                            <div className="text-slate-600 text-xs font-mono">{d.address}</div>
                          </div>
                          {obdConnecting === d.address
                            ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: accent }} />
                            : <Bluetooth className="w-4 h-4 text-slate-600" />
                          }
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Adım 4: Önizleme ─────────────────────────── */}
          {step === 4 && (
            <div className="w-full flex flex-col items-center gap-4">
              <div className="text-center">
                <h2 className="text-xl font-bold text-primary mb-1">Her Şey Hazır!</h2>
                <p className="text-slate-500 text-sm">Ana ekranınızın önizlemesi.</p>
              </div>

              {/* Ana ekran mockup */}
              <div
                className="w-full rounded-2xl overflow-hidden border"
                style={{
                  height:          204,
                  backgroundColor: '#0a0e1a',
                  borderColor:     `${accent}22`,
                  boxShadow:       `0 0 30px ${accent}10`,
                }}
              >
                <div className="h-full p-3 flex gap-2">
                  {/* Sol kolon */}
                  <div className="flex flex-col gap-2 w-[38%]">
                    {/* Saat */}
                    <div
                      className="flex-1 rounded-xl p-2.5 flex flex-col justify-center border border-white/5"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                    >
                      <div
                        className="text-primary font-thin text-xl tabular-nums leading-none"
                        style={{ textShadow: `0 0 20px ${accent}50` }}
                      >
                        {new Date().getHours().toString().padStart(2, '0')}
                        :{new Date().getMinutes().toString().padStart(2, '0')}
                      </div>
                      <div className="text-slate-600 text-[9px] mt-0.5 font-medium">
                        {new Date().toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </div>
                      <div className="flex gap-1 mt-2">
                        {['#3b82f6', '#22c55e', '#f59e0b'].map((c, ci) => (
                          <div
                            key={ci}
                            className="flex-1 h-5 rounded-lg"
                            style={{ backgroundColor: `${c}15`, border: `1px solid ${c}25` }}
                          />
                        ))}
                      </div>
                    </div>
                    {/* Favoriler */}
                    <div
                      className="flex-1 rounded-xl p-2 border border-white/5"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                    >
                      <div className="grid grid-cols-3 gap-1 h-full">
                        {['📞', '💬', '🗺️', '🎵', '🌐', '⚙️'].map((icon) => (
                          <div key={icon} className="rounded-lg var(--panel-bg-secondary) flex items-center justify-center text-base">
                            {icon}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Sağ kolon */}
                  <div className="flex-1 flex flex-col gap-2">
                    {/* Harita */}
                    <div
                      className="flex-[1.3] rounded-xl border relative overflow-hidden"
                      style={{ backgroundColor: '#0d1825', borderColor: `${accent}18` }}
                    >
                      <div
                        className="absolute inset-0 opacity-25"
                        style={{ background: `radial-gradient(ellipse at 65% 35%, ${accent}50, transparent 65%)` }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <MapPin className="w-5 h-5 opacity-70" style={{ color: accent }} />
                      </div>
                      <div
                        className="absolute bottom-1.5 left-2 text-[8px] font-black tracking-widest uppercase opacity-60"
                        style={{ color: accent }}
                      >
                        HARİTA
                      </div>
                    </div>

                    {/* Medya Hub */}
                    <div
                      className="flex-1 rounded-xl p-2.5 flex items-center gap-2.5 border border-white/5"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                    >
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                        style={{ backgroundColor: `${accent}20` }}
                      >
                        {MUSIC_OPTIONS[musicKey]?.icon ?? '🎵'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-primary text-[10px] font-bold truncate">
                          {MUSIC_OPTIONS[musicKey]?.name ?? 'Müzik'}
                        </div>
                        <div
                          className="h-1 rounded-full mt-1.5 overflow-hidden"
                          style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                        >
                          <div
                            className="h-full w-[55%] rounded-full"
                            style={{ backgroundColor: accent }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Seçim özet chip'leri */}
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  { label: MUSIC_OPTIONS[musicKey]?.name ?? 'Müzik',  emoji: '🎵' },
                  { label: NAV_OPTIONS[navKey]?.name ?? 'Harita',      emoji: '🗺️' },
                ].map((chip) => (
                  <div
                    key={chip.label}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
                    style={{
                      backgroundColor: `${accent}14`,
                      color:            accent,
                      border:          `1px solid ${accent}22`,
                    }}
                  >
                    <span>{chip.emoji}</span>
                    {chip.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer navigasyon ────────────────────────────── */}
        <div className="px-6 sm:px-8 pb-7 sm:pb-8 pt-4 flex items-center justify-between border-t border-white/5 bg-[#0a1020]/80 backdrop-blur-md">
          {/* Geri */}
          <button
            type="button"
            onClick={goPrev}
            disabled={step === 0}
            className="flex items-center gap-1 text-slate-500 active:text-slate-300 disabled:opacity-25 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm font-medium">Geri</span>
          </button>

          {/* İleri / Başlat */}
          {isLast ? (
            <button
              type="button"
              onClick={finish}
              className="flex items-center gap-2 px-7 py-3 rounded-2xl text-primary font-bold active:scale-95 transition-all"
              style={{
                backgroundColor: '#22c55e',
                boxShadow:       '0 4px 24px rgba(34,197,94,0.4)',
              }}
            >
              <Rocket className="w-4 h-4" />
              Başlat
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              className="flex items-center gap-2 px-7 py-3 rounded-2xl text-primary font-bold active:scale-95 transition-all"
              style={{
                backgroundColor: accent,
                boxShadow:       `0 4px 20px ${accent}38`,
              }}
            >
              {step === 4 ? (obdConnected ? 'Devam' : 'Atla') : 'İleri'}
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


