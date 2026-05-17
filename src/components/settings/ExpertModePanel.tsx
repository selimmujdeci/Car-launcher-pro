import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
  Cpu,
  Fingerprint,
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
  HEAVY_INERTIA_MS,
  diagnosticPulseTransitionStyle,
} from './DiagnosticPulse';
import { ExpertTrustGauge, HEAVY_INERTIA_STYLE } from './expert/ExpertTrustGauge';
import { ExpertRecoveryAction } from './expert/ExpertRecoveryAction';
import { CRMInspector }        from './expert/CRMInspector';
import { CognitiveInspector }  from './expert/CognitiveInspector';

export type ExpertModeState = 'INIT' | 'SEARCHING' | 'UNVERIFIED' | 'SECURE';

const VIN_OK = /^[A-HJ-NPR-Z0-9]{17}$/;

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
              <ExpertTrustGauge score={trustScore} writeLocked={writeLocked} />
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

            <ExpertRecoveryAction
              canReset={canResetSafetyProfile}
              vinKey={vinKey}
              onConfirm={onConfirmReset}
            />
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

      {/* CRM Teşhis Paneli */}
      <CRMInspector />

      {/* Bilişsel Motor Teşhis Paneli */}
      <CognitiveInspector />

    </div>
  );
});
