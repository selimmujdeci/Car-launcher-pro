import { memo, useState } from 'react';
import { Trash2, Lock } from 'lucide-react';
import { NO_VIN_KEY } from '../../../platform/safety/SafetyBrain';
import { HEAVY_INERTIA_STYLE } from './ExpertTrustGauge';
import { HEAVY_INERTIA_MS, HEAVY_INERTIA_EASE } from '../DiagnosticPulse';

interface ExpertRecoveryActionProps {
  canReset:  boolean;
  vinKey:    string;
  onConfirm: () => void;
}

export const ExpertRecoveryAction = memo(function ExpertRecoveryAction({
  canReset,
  vinKey,
  onConfirm,
}: ExpertRecoveryActionProps) {
  const [showDialog, setShowDialog] = useState(false);

  const handleConfirm = () => {
    onConfirm();
    setShowDialog(false);
  };

  return (
    <>
      {/* ── Sistem Kurtarma kartı ── */}
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
          onClick={() => setShowDialog(true)}
          disabled={!canReset}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-amber-500/45 bg-amber-600/20 hover:bg-amber-600/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          style={HEAVY_INERTIA_STYLE}
        >
          <Trash2 className="h-4 w-4 text-amber-200" />
          <span className="text-[11px] font-black uppercase tracking-widest text-amber-100">
            Araç Profilini Temizle
          </span>
        </button>
      </div>

      {/* ── Onay diyaloğu — backdrop-blur + geri alınamaz uyarıları ── */}
      {showDialog && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          style={{
            opacity:                  1,
            transitionProperty:       'opacity',
            transitionDuration:       `${HEAVY_INERTIA_MS}ms`,
            transitionTimingFunction: HEAVY_INERTIA_EASE,
          }}
          role="presentation"
          onClick={() => setShowDialog(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="expert-reset-title"
            className="max-w-md rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-0)] p-6 shadow-2xl"
            style={HEAVY_INERTIA_STYLE}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <Lock className="h-5 w-5 text-amber-400" />
              <h2 id="expert-reset-title" className="text-sm font-black uppercase tracking-widest text-[color:var(--oem-ink)]">
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
            <p className="mt-3 text-[12px] leading-relaxed text-[color:var(--oem-ink-2)]">
              Kapsam: yalnızca güvenlik sayaçları ve koşullu özellik bayrakları. İşlem sonrası politika durumunu taban
              çizgisinden yeniden oluşturun.
            </p>
            <p className="mt-2 font-mono text-[11px] text-[color:var(--oem-ink-3)]">
              Anahtar: {vinKey === NO_VIN_KEY ? 'atanmamış' : vinKey}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-[var(--oem-line)] px-4 py-2 text-[11px] font-black uppercase tracking-widest text-[color:var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
                style={HEAVY_INERTIA_STYLE}
                onClick={() => setShowDialog(false)}
              >
                İptal
              </button>
              <button
                type="button"
                className="rounded-xl border border-amber-500/50 bg-amber-600/85 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-amber-950 hover:bg-amber-500"
                style={HEAVY_INERTIA_STYLE}
                onClick={handleConfirm}
              >
                Temizle
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
