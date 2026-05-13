import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import {
  ShieldAlert,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Cpu,
  Fingerprint,
  Lock,
} from 'lucide-react';
import { useExpertStore } from '../../store/useExpertStore';
import {
  listSafetyDisabledFeatureWarnings,
  subscribeSafetyBrain,
  resetVinProfile,
  getCurrentVinKey,
  NO_VIN_KEY,
} from '../../platform/safety/SafetyBrain';
import { getHandshakeVin } from '../../platform/safety/vinContext';
import { normalizeVin, WRITE_LOCK_THRESHOLD } from '../../platform/expert/TrustEngine';
import { useStore } from '../../store/useStore';
import {
  DiagnosticPulse,
  HEAVY_INERTIA_EASE,
  HEAVY_INERTIA_MS,
  diagnosticPulseTransitionStyle,
} from './DiagnosticPulse';

export type ExpertModeState = 'INIT' | 'SEARCHING' | 'UNVERIFIED' | 'SECURE';

const VIN_OK = /^[A-HJ-NPR-Z0-9]{17}$/;

const HEAVY_INERTIA_STYLE: CSSProperties = {
  transitionProperty:        'opacity, transform, color, background-color, border-color, stroke, stroke-dashoffset',
  transitionDuration:        `${HEAVY_INERTIA_MS}ms`,
  transitionTimingFunction:  HEAVY_INERTIA_EASE,
};

/** Statü metinleri — otomotiv diagnostik paneli (TR) */
const OEM_STATUS: Record<ExpertModeState, { title: string; subtitle: string }> = {
  INIT: {
    title:    'Güvenlik modülü başlatılıyor',
    subtitle: 'Mühürlü bağlam güvenli depodan yükleniyor.',
  },
  SEARCHING: {
    title:    'Araç bağlantısı bekleniyor',
    subtitle:
      'Bu oturumda doğrulanmış VIN bulunamadı. OBD-II bağlantısı kurun veya etkin araç profiline VIN tanımlayın.',
  },
  UNVERIFIED: {
    title:    'Kimlik mühürlenmedi',
    subtitle: 'Geçici VIN kaydı mevcut. Expert mühür onayı bekleniyor.',
  },
  SECURE: {
    title:    'Güvenilir teşhis hattı',
    subtitle: 'Mühürlü VIN aktif. Güven yayı geçerli politika durumunu gösterir.',
  },
};

function resolveExpertModeState(
  hydrated: boolean,
  hasExpertVin: boolean,
  hasProvisionalVin: boolean,
): ExpertModeState {
  if (!hydrated) return 'INIT';
  if (hasExpertVin) return 'SECURE';
  if (hasProvisionalVin) return 'UNVERIFIED';
  return 'SEARCHING';
}

function gaugeAccent(score: number, writeLocked: boolean): string {
  if (writeLocked || score < WRITE_LOCK_THRESHOLD) return '#ef4444';
  if (score <= 85) return '#f59e0b';
  return '#22c55e';
}

function gaugeLabel(score: number, writeLocked: boolean): string {
  if (writeLocked || score < WRITE_LOCK_THRESHOLD) return 'Yazma Kilidi';
  if (score <= 85) return 'Kısıtlı İzleme';
  return 'Nominal Çalışma';
}

type AccessLevelBadge = 'LOCKED' | 'LIMITED' | 'VERIFIED';

function resolveAccessLevel(score: number, writeLocked: boolean): AccessLevelBadge {
  if (writeLocked || score < WRITE_LOCK_THRESHOLD) return 'LOCKED';
  if (score <= 85) return 'LIMITED';
  return 'VERIFIED';
}

/** Rozet görünen metin — iç mantık anahtarları (LOCKED vb.) değişmez */
const ACCESS_LEVEL_LABEL: Record<AccessLevelBadge, string> = {
  LOCKED:   'KİLİTLİ',
  LIMITED:  'KISITLI',
  VERIFIED: 'DOĞRULANDI',
};

const ACCESS_LEVEL_STYLE: Record<AccessLevelBadge, { ring: string; fg: string }> = {
  LOCKED: {
    ring: 'border-red-400/45 bg-red-950/55 shadow-[0_0_28px_rgba(239,68,68,0.22)]',
    fg:   'text-red-100',
  },
  LIMITED: {
    ring: 'border-amber-400/45 bg-amber-950/40 shadow-[0_0_28px_rgba(245,158,11,0.18)]',
    fg:   'text-amber-100',
  },
  VERIFIED: {
    ring: 'border-emerald-400/40 bg-emerald-950/45 shadow-[0_0_28px_rgba(34,197,94,0.2)]',
    fg:   'text-emerald-100',
  },
};

/** Yalnızca SECURE durumunda — ağır atalet 400 ms; güven yayı 180° ark + 1 Hz nabız */
function TrustGauge({
  score,
  writeLocked,
}: {
  score:        number;
  writeLocked:  boolean;
}) {
  const filterId     = useId().replace(/:/g, '');
  const accent       = gaugeAccent(score, writeLocked);
  const accessLevel  = resolveAccessLevel(score, writeLocked);
  const badge        = ACCESS_LEVEL_STYLE[accessLevel];
  const arcDash      = 100;
  const arcOffset    = arcDash - (arcDash * score) / 100;

  return (
    <div
      className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6"
      style={HEAVY_INERTIA_STYLE}
    >
      <div
        className="absolute left-0 right-0 top-0 h-1"
        style={{ ...HEAVY_INERTIA_STYLE, background: accent }}
      />

      <div className="relative z-[1] flex w-full max-w-[260px] flex-col items-center">
        <p className="text-[9px] font-black uppercase tracking-[0.38em] text-white/35">Erişim Seviyesi</p>
        <div
          className={`mt-3 rounded-2xl border px-5 py-2.5 ${badge.ring} ${badge.fg}`}
          style={HEAVY_INERTIA_STYLE}
        >
          <span className="block text-center text-[13px] font-black uppercase tracking-[0.28em]">
            {ACCESS_LEVEL_LABEL[accessLevel]}
          </span>
        </div>

        <p className="mt-3 text-center text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-400/75">
          Donanımsal Güven: MÜHÜRLÜ (TEE)
        </p>

        <div className="relative mt-1 h-[108px] w-full max-w-[220px]">
          <svg
            className="h-full w-full overflow-visible"
            viewBox="0 0 120 78"
            fill="none"
            aria-hidden
          >
            <defs>
              <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="2.2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path
              d="M 14 72 A 46 46 0 0 1 106 72"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="7"
              strokeLinecap="round"
              pathLength={arcDash}
            />
            <path
              className="trust-gauge-arc-pulse"
              d="M 14 72 A 46 46 0 0 1 106 72"
              stroke={accent}
              strokeWidth="7"
              strokeLinecap="round"
              pathLength={arcDash}
              strokeDasharray={arcDash}
              strokeDashoffset={arcOffset}
              filter={`url(#${filterId})`}
              style={{
                ...HEAVY_INERTIA_STYLE,
                transitionProperty: 'stroke, stroke-dashoffset',
              }}
            />
          </svg>
        </div>

        <div className="mt-1 flex flex-col items-center gap-0.5 text-center">
          <span
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ ...HEAVY_INERTIA_STYLE, color: accent }}
          >
            {gaugeLabel(score, writeLocked)}
          </span>
          <div className="flex items-baseline gap-2 text-white/38">
            <span className="text-[9px] font-bold uppercase tracking-widest">Güven skoru</span>
            <span
              className="font-mono text-sm font-black tabular-nums text-white/55"
              style={HEAVY_INERTIA_STYLE}
            >
              {Math.round(score)}
            </span>
          </div>
        </div>
      </div>

      <p className="relative z-[1] mt-4 text-center text-[11px] font-medium leading-relaxed text-white/40">
        {writeLocked
          ? 'Güven skoru yapılandırılmış eşiğe ulaşana kadar yazma işlemleri engellenir.'
          : 'Geçerli güven politikası ve eşikler çerçevesinde yazma işlemlerine izin verilir.'}
      </p>
    </div>
  );
}

export const ExpertModePanel = memo(function ExpertModePanel() {
  const trustScore     = useExpertStore((s) => s.trustScore);
  const vinRaw         = useExpertStore((s) => s.vin);
  const writeLocked    = useExpertStore((s) => s.writeLocked);
  const hydrated       = useExpertStore((s) => s.hydrated);
  const ecuSupplier    = useExpertStore((s) => s.ecuSupplier);
  const recomputeTrust = useExpertStore((s) => s.recomputeTrust);

  const activeProfile = useStore((s) => {
    const id = s.settings.activeVehicleProfileId;
    return s.settings.vehicleProfiles.find((p) => p.id === id) ?? null;
  });

  const [safetyRev, setSafetyRev] = useState(0);
  const [recomputeBusy, setRecomputeBusy] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => subscribeSafetyBrain(() => setSafetyRev((n) => n + 1)), []);

  const safetyWarnings = useMemo(
    () => listSafetyDisabledFeatureWarnings(),
    [safetyRev, vinRaw],
  );

  const vExpert = normalizeVin(vinRaw);
  const hasExpertVin = VIN_OK.test(vExpert);

  const profileVin = activeProfile?.vin ? normalizeVin(activeProfile.vin) : '';
  const handshake  = getHandshakeVin() ?? '';
  const hNorm        = normalizeVin(handshake);

  const hasProvisionalVin = VIN_OK.test(profileVin) || VIN_OK.test(hNorm);

  const displayVin = hasExpertVin
    ? vExpert
    : VIN_OK.test(profileVin)
      ? profileVin
      : VIN_OK.test(hNorm)
        ? hNorm
        : '—';

  const mode = resolveExpertModeState(hydrated, hasExpertVin, hasProvisionalVin);

  const oemPrimary = useMemo(() => {
    if (mode === 'SECURE' && writeLocked) {
      return {
        title:    'Yazma yolu kilitlendi (Interlock)',
        subtitle:
          'Güven skoru yazma eşiğinin altında. Politika, güven skoru normale dönene kadar yazma sınıfı işlemleri bloke eder.',
      };
    }
    return OEM_STATUS[mode];
  }, [mode, writeLocked]);

  const vinKey = getCurrentVinKey();
  const canResetSafetyProfile = hydrated;

  const onRecompute = useCallback(() => {
    setRecomputeBusy(true);
    recomputeTrust();
    window.setTimeout(() => setRecomputeBusy(false), HEAVY_INERTIA_MS);
  }, [recomputeTrust]);

  const onConfirmReset = useCallback(() => {
    const target = vinKey !== NO_VIN_KEY ? vinKey : '';
    resetVinProfile(target);
    setShowResetConfirm(false);
    setSafetyRev((n) => n + 1);
  }, [vinKey]);

  const statusTitleId = 'expert-mode-oem-status';

  return (
    <div className="flex flex-col gap-4">
      {/* OEM statü şeridi — tüm durumlarda */}
      <header
        className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3"
        style={HEAVY_INERTIA_STYLE}
      >
        <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/35">Expert Durumu</p>
        <h2 id={statusTitleId} className="mt-1 text-sm font-black uppercase tracking-[0.12em] text-white/95">
          {oemPrimary.title}
        </h2>
        <p className="mt-1 text-[11px] font-medium leading-relaxed text-white/45">{oemPrimary.subtitle}</p>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-cyan-500/80">{mode}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section
          aria-labelledby={statusTitleId}
          className="relative flex min-h-[280px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6"
          style={HEAVY_INERTIA_STYLE}
        >
          {mode === 'SECURE' ? (
            <div className="w-full max-w-sm" style={HEAVY_INERTIA_STYLE}>
              <TrustGauge score={trustScore} writeLocked={writeLocked} />
            </div>
          ) : (
            <div
              className="flex flex-col items-center gap-5"
              style={diagnosticPulseTransitionStyle}
            >
              <DiagnosticPulse labelId={statusTitleId} />
            </div>
          )}
        </section>

        <div
          className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
          style={HEAVY_INERTIA_STYLE}
        >
          <div className="mb-1 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
              <Fingerprint className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <div className="text-sm font-black uppercase tracking-widest text-white">Araç Kimliği</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                Etkin profil ve SafetyBrain anahtarı
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/25">Görüntülenen VIN</span>
              <span className="break-all font-mono text-xs font-bold text-white/80">{displayVin}</span>
              {mode === 'UNVERIFIED' && (
                <span className="text-[9px] font-bold uppercase tracking-wide text-amber-400/90">
                  Geçici VIN — mühür bekleniyor
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/25">ECU tedarikçisi</span>
              <span className="font-mono text-xs font-bold text-white/70">{ecuSupplier || '—'}</span>
            </div>
            <div className="flex items-center justify-between border-t border-white/5 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">Modül hazırlığı</span>
              <span
                className={`text-[10px] font-black uppercase tracking-widest ${
                  hydrated ? 'text-emerald-400' : 'text-amber-400'
                }`}
                style={HEAVY_INERTIA_STYLE}
              >
                {hydrated ? 'Tamamlandı' : 'Devam ediyor'}
              </span>
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-3" style={HEAVY_INERTIA_STYLE}>
            <button
              type="button"
              onClick={onRecompute}
              disabled={recomputeBusy || mode === 'INIT'}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              style={HEAVY_INERTIA_STYLE}
            >
              <RefreshCw className={`h-4 w-4 text-sky-400 ${recomputeBusy ? 'animate-spin' : ''}`} />
              <span className="text-[11px] font-black uppercase tracking-widest text-white">Güven Skorunu Güncelle</span>
            </button>

            <div
              className="rounded-2xl border border-amber-500/35 bg-amber-500/[0.08] p-4"
              style={HEAVY_INERTIA_STYLE}
            >
              <h3 className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-200/95">Sistem Kurtarma</h3>
              <p className="mt-2 text-[11px] font-medium leading-snug text-amber-50/80">
                Bu araç anahtarı için SafetyBrain sayaçları ve özellik kapıları temizlenir. Expert mühür verisi korunur.
              </p>
              <div
                className="mt-3 rounded-xl border border-amber-400/55 bg-amber-950/40 px-3 py-2.5"
                role="status"
              >
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">
                  Geri alınamaz işlem
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-snug text-amber-100/95">
                  Bu temizleme geri alınamaz. Güvenlik durumunu fabrika taban çizgisinden yeniden kurmanız gerekir.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                disabled={!canResetSafetyProfile}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-amber-500/45 bg-amber-600/20 hover:bg-amber-600/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                style={HEAVY_INERTIA_STYLE}
              >
                <Trash2 className="h-4 w-4 text-amber-200" />
                <span className="text-[11px] font-black uppercase tracking-widest text-amber-100">
                  Araç Profilini Temizle
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {safetyWarnings.length > 0 && (
        <div
          className="flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"
          style={HEAVY_INERTIA_STYLE}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-500">
              Güvenlik kilidi — koşullu özellikler
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {safetyWarnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-[11px] font-medium leading-snug text-amber-100/85">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500/90" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="flex items-start gap-4 rounded-2xl border border-blue-500/15 bg-blue-500/[0.06] p-5"
        style={HEAVY_INERTIA_STYLE}
      >
        <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
        <div className="space-y-2">
          <h4 className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">Durum modeli</h4>
          <p className="text-[11px] font-medium leading-relaxed text-white/45">
            <span className="font-mono text-white/55">INIT</span> → <span className="font-mono text-white/55">SEARCHING</span> →{' '}
            <span className="font-mono text-white/55">UNVERIFIED</span> → <span className="font-mono text-white/55">SECURE</span>.
            Güven yayı yalnızca <span className="font-mono text-white/55">SECURE</span> durumunda gösterilir. Yazma kilidi{' '}
            <span className="font-mono text-cyan-400/90">{WRITE_LOCK_THRESHOLD}</span> değerinin altında devreye girer.
          </p>
        </div>
      </div>

      {showResetConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          style={{
            opacity:            1,
            transitionProperty: 'opacity',
            transitionDuration: `${HEAVY_INERTIA_MS}ms`,
            transitionTimingFunction: HEAVY_INERTIA_EASE,
          }}
          role="presentation"
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="expert-reset-title"
            className="max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 p-6 shadow-2xl"
            style={HEAVY_INERTIA_STYLE}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <Lock className="h-5 w-5 text-amber-400" />
              <h2 id="expert-reset-title" className="text-sm font-black uppercase tracking-widest text-white">
                Araç profilini temizlemeyi onayla
              </h2>
            </div>
            <div
              className="rounded-xl border border-amber-500/50 bg-amber-950/35 px-3 py-2.5"
              role="alert"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">
                Bu işlem geri alınamaz
              </p>
              <p className="mt-1 text-[11px] font-semibold leading-snug text-amber-50/95">
                Bu araç anahtarı için temizleme kalıcıdır. SafetyBrain durumu sıfırlanır; Expert güven mührü kaldırılmaz.
              </p>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-white/50">
              Kapsam: yalnızca güvenlik sayaçları ve koşullu özellik bayrakları. İşlem sonrası politika durumunu taban
              çizgisinden yeniden oluşturun.
            </p>
            <p className="mt-2 font-mono text-[11px] text-white/40">
              Anahtar: {vinKey === NO_VIN_KEY ? 'atanmamış' : vinKey}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-white/10 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white/60 hover:bg-white/5"
                style={HEAVY_INERTIA_STYLE}
                onClick={() => setShowResetConfirm(false)}
              >
                İptal
              </button>
              <button
                type="button"
                className="rounded-xl border border-amber-500/50 bg-amber-600/85 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-amber-950 hover:bg-amber-500"
                style={HEAVY_INERTIA_STYLE}
                onClick={onConfirmReset}
              >
                Temizle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
