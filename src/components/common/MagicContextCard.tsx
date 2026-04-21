/**
 * MagicContextCard — Markov tahminleri + bağlam senaryolarını
 * tema-özel görsel dilde sunan self-contained kart bileşeni.
 *
 * Senaryo öncelik sırası:
 *   1. Kritik Yakıt (fuelLevel < 10)          — tüm tahminlerin önüne geçer
 *   2. Sabah/Akşam nav önerisi (rota + konum) — iş/ev hedefi
 *   3. Medya odaklı kart (idle + yüksek tahmin)
 *   4. En yüksek skorlu Markov tahmini
 *
 * Self-contained: OBD + Store hook'larını içeride tüketir,
 * prop drilling yoktur — ThemeLayoutRenderer değişmez.
 *
 * Zero-Leak: useEffect cleanup + null early-return.
 * Mali-400: sadece CSS transition (Framer Motion yok).
 * Blur: yalnızca Mercedes varyantında (pahalı GPU op).
 */
import { memo, useState, useEffect, useCallback } from 'react';
import {
  Navigation2, Music2, AlertTriangle, Fuel, ChevronRight, X, MapPin, Briefcase,
} from 'lucide-react';
import type { SmartSnapshot } from '../../platform/smartEngine';
import { useOBDState } from '../../platform/obdService';
import { useStore } from '../../store/useStore';
import { APP_MAP } from '../../data/apps';

/* ── Kart varyant tipi ──────────────────────────────────────── */
export type MagicCardVariant = 'tesla' | 'audi' | 'cockpit' | 'mercedes' | 'pro';

export interface MagicContextCardProps {
  smart:    SmartSnapshot;
  variant:  MagicCardVariant;
  onLaunch: (appId: string) => void;
  onOpenMap?: () => void;
}

/* ── Senaryo modeli ─────────────────────────────────────────── */
type CardScenario =
  | { kind: 'critical-fuel' }
  | { kind: 'nav-home';   destName: string }
  | { kind: 'nav-work';   destName: string }
  | { kind: 'media';      appId: string }
  | { kind: 'prediction'; appId: string; probability: number };

function resolveScenario(
  smart:        SmartSnapshot,
  fuelLevel:    number,
  home:         { name: string } | null | undefined,
  work:         { name: string } | null | undefined,
): CardScenario | null {
  if (fuelLevel >= 0 && fuelLevel < 10) return { kind: 'critical-fuel' };

  const hour      = new Date().getHours();
  const isMorning = hour >= 6  && hour < 10;
  const isEvening = hour >= 17 && hour < 21;

  const navPred = smart.predictions.find(
    (p) => p.appId === 'maps' || p.appId === 'waze',
  );
  if (navPred) {
    if (isMorning && work)  return { kind: 'nav-work', destName: work.name };
    if (isEvening && home)  return { kind: 'nav-home', destName: home.name };
  }

  if (smart.drivingMode === 'idle') {
    const mediaPred = smart.predictions.find(
      (p) => (p.appId === 'youtube' || p.appId === 'spotify') && p.probability > 0.25,
    );
    if (mediaPred) return { kind: 'media', appId: mediaPred.appId };
  }

  const top = smart.predictions[0];
  if (top && top.probability > 0.15) {
    return { kind: 'prediction', appId: top.appId, probability: top.probability };
  }
  return null;
}

/* ── Senaryo → UI içeriği ───────────────────────────────────── */
interface CardContent {
  icon:        React.ReactNode;
  label:       string;
  title:       string;
  actionLabel: string;
  onAction:    () => void;
  isCritical?: boolean;
}

function buildContent(
  scenario: CardScenario,
  onLaunch: (id: string) => void,
  onOpenMap?: () => void,
): CardContent {
  switch (scenario.kind) {
    case 'critical-fuel':
      return {
        icon:        <Fuel className="w-5 h-5" />,
        label:       'KRİTİK',
        title:       'Yakıt kritik seviyede',
        actionLabel: 'Benzinlik Bul',
        onAction:    () => onLaunch('maps'),
        isCritical:  true,
      };
    case 'nav-work':
      return {
        icon:        <Briefcase className="w-5 h-5" />,
        label:       'SABAH ROTASI',
        title:       `İşe git — ${scenario.destName}`,
        actionLabel: 'Başlat',
        onAction:    () => { onOpenMap?.(); onLaunch('maps'); },
      };
    case 'nav-home':
      return {
        icon:        <MapPin className="w-5 h-5" />,
        label:       'AKŞAM ROTASI',
        title:       `Eve git — ${scenario.destName}`,
        actionLabel: 'Başlat',
        onAction:    () => { onOpenMap?.(); onLaunch('maps'); },
      };
    case 'media': {
      const app = APP_MAP[scenario.appId];
      return {
        icon:        <Music2 className="w-5 h-5" />,
        label:       'MÜZİK ÖNERİSİ',
        title:       app?.name ?? scenario.appId,
        actionLabel: 'Aç',
        onAction:    () => onLaunch(scenario.appId),
      };
    }
    case 'prediction': {
      const app = APP_MAP[scenario.appId];
      const pct = Math.round(scenario.probability * 100);
      return {
        icon:        app
          ? <span className="text-xl leading-none">{app.icon}</span>
          : <Navigation2 className="w-5 h-5" />,
        label:       `TAHMİN %${pct}`,
        title:       app?.name ?? scenario.appId,
        actionLabel: 'Aç',
        onAction:    () => onLaunch(scenario.appId),
      };
    }
  }
}

/* ── Varyant stil tablosu ───────────────────────────────────── */
interface VariantStyle {
  bg:             string;
  border:         string;
  labelColor:     string;
  titleColor:     string;
  btnBg:          string;
  btnText:        string;
  iconBg:         string;
  iconColor:      string;
  critBg:         string;
  critBorder:     string;
  critIconColor:  string;
  useBlur:        boolean;
}

const VARIANT_STYLES: Record<MagicCardVariant, VariantStyle> = {
  tesla: {
    bg:            'rgba(18,18,18,0.92)',
    border:        'rgba(255,255,255,0.08)',
    labelColor:    'var(--accent, #E31937)',
    titleColor:    '#FFFFFF',
    btnBg:         'var(--accent, #E31937)',
    btnText:       '#FFFFFF',
    iconBg:        'rgba(227,25,55,0.12)',
    iconColor:     'var(--accent, #E31937)',
    critBg:        'rgba(227,25,55,0.14)',
    critBorder:    'rgba(227,25,55,0.50)',
    critIconColor: '#EF4444',
    useBlur:       false,
  },
  audi: {
    bg:            'rgba(20,20,20,0.95)',
    border:        'rgba(168,169,173,0.13)',
    labelColor:    'var(--accent, #CC0000)',
    titleColor:    '#FFFFFF',
    btnBg:         'var(--accent, #CC0000)',
    btnText:       '#FFFFFF',
    iconBg:        'rgba(204,0,0,0.10)',
    iconColor:     'var(--accent, #CC0000)',
    critBg:        'rgba(204,0,0,0.14)',
    critBorder:    'rgba(204,0,0,0.55)',
    critIconColor: '#EF4444',
    useBlur:       false,
  },
  cockpit: {
    bg:            'rgba(6,12,20,0.96)',
    border:        'rgba(0,212,255,0.20)',
    labelColor:    'var(--accent, #00D4FF)',
    titleColor:    'var(--text, #E8F0FF)',
    btnBg:         'var(--accent, #00D4FF)',
    btnText:       '#050A10',
    iconBg:        'rgba(0,212,255,0.10)',
    iconColor:     'var(--accent, #00D4FF)',
    critBg:        'rgba(255,59,48,0.12)',
    critBorder:    'rgba(255,59,48,0.50)',
    critIconColor: '#FF3B30',
    useBlur:       false,
  },
  mercedes: {
    bg:            'rgba(16,14,14,0.88)',
    border:        'rgba(200,169,110,0.18)',
    labelColor:    'var(--accent, #C8A96E)',
    titleColor:    'var(--text, #F5F0EB)',
    btnBg:         'rgba(200,169,110,0.22)',
    btnText:       'var(--accent, #C8A96E)',
    iconBg:        'rgba(200,169,110,0.10)',
    iconColor:     'var(--accent, #C8A96E)',
    critBg:        'rgba(239,68,68,0.10)',
    critBorder:    'rgba(239,68,68,0.42)',
    critIconColor: '#EF4444',
    useBlur:       true,
  },
  pro: {
    bg:            'rgba(12,12,16,0.96)',
    border:        'rgba(255,255,255,0.08)',
    labelColor:    '#60A5FA',
    titleColor:    '#FFFFFF',
    btnBg:         '#3B82F6',
    btnText:       '#FFFFFF',
    iconBg:        'rgba(96,165,250,0.12)',
    iconColor:     '#60A5FA',
    critBg:        'rgba(239,68,68,0.10)',
    critBorder:    'rgba(239,68,68,0.40)',
    critIconColor: '#EF4444',
    useBlur:       false,
  },
};

/* ══════════════════════════════════════════════════════════════
   ANA BİLEŞEN
   ══════════════════════════════════════════════════════════════ */
export const MagicContextCard = memo(function MagicContextCard({
  smart,
  variant,
  onLaunch,
  onOpenMap,
}: MagicContextCardProps) {
  const obd      = useOBDState();
  const { settings } = useStore();
  const fuelLevel    = obd.fuelLevel ?? -1;
  const home         = settings.homeLocation;
  const work         = settings.workLocation;

  const [dismissed, setDismissed] = useState(false);

  const scenario = resolveScenario(smart, fuelLevel, home, work);

  // Yeni senaryo geldiğinde dismiss sıfırla — obj identity değil tür/değer bazlı
  const scenarioKey = scenario
    ? `${scenario.kind}:${(scenario as { destName?: string }).destName ?? ''}:${(scenario as { appId?: string }).appId ?? ''}`
    : null;

  useEffect(() => {
    if (scenarioKey) setDismissed(false);
  }, [scenarioKey]);

  // Kritik olmayan kartlar 10 sn sonra otomatik kapanır
  useEffect(() => {
    if (!scenario || dismissed || scenario.kind === 'critical-fuel') return;
    const t = setTimeout(() => setDismissed(true), 10_000);
    return () => clearTimeout(t);
  }, [scenario, dismissed]);

  const dismiss = useCallback(() => setDismissed(true), []);

  // Tahmin yok ya da dismiss → DOM yükü sıfır
  if (!scenario || dismissed) return null;

  const s      = VARIANT_STYLES[variant];
  const c      = buildContent(scenario, onLaunch, onOpenMap);
  const isCrit = !!c.isCritical;

  return (
    <div
      data-magic-card
      className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 flex-shrink-0"
      style={{
        background:           isCrit ? s.critBg : s.bg,
        border:               `1px solid ${isCrit ? s.critBorder : s.border}`,
        backdropFilter:       s.useBlur ? 'blur(14px)' : undefined,
        WebkitBackdropFilter: s.useBlur ? 'blur(14px)' : undefined,
        transition:           'opacity 220ms ease, transform 220ms ease',
        // Mali-400: GPU compositor layer — transition sırasında jank önleme
        transform:            'translateZ(0)',
        willChange:           'transform, opacity',
        backfaceVisibility:   'hidden',
      }}
    >
      {/* İkon */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background: isCrit ? s.critBg : s.iconBg,
          color:      isCrit ? s.critIconColor : s.iconColor,
          border:     `1px solid ${isCrit ? s.critBorder : 'transparent'}`,
        }}
      >
        {isCrit ? <AlertTriangle className="w-5 h-5" /> : c.icon}
      </div>

      {/* Metin */}
      <div className="flex-1 min-w-0">
        <div
          className="uppercase font-semibold leading-none mb-0.5"
          style={{
            fontSize:      9,
            letterSpacing: '0.18em',
            color:         isCrit ? s.critIconColor : s.labelColor,
          }}
        >
          {c.label}
        </div>
        <div
          className="font-semibold truncate leading-tight"
          style={{ fontSize: 13, color: s.titleColor }}
        >
          {c.title}
        </div>
      </div>

      {/* Aksiyon butonu */}
      <button
        onClick={() => { c.onAction(); if (!isCrit) dismiss(); }}
        className="flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl active:scale-95 transition-transform"
        style={{ background: isCrit ? s.critIconColor : s.btnBg, color: isCrit ? '#fff' : s.btnText }}
      >
        <span className="font-bold uppercase tracking-wider" style={{ fontSize: 10 }}>
          {c.actionLabel}
        </span>
        <ChevronRight className="w-3 h-3" />
      </button>

      {/* Kapat — kritik kartta kullanıcı kapatamaz */}
      {!isCrit && (
        <button
          onClick={dismiss}
          className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border:     '1px solid rgba(255,255,255,0.08)',
            color:      'rgba(255,255,255,0.40)',
          }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
});
