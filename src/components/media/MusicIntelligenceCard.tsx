/**
 * MusicIntelligenceCard.tsx — MUSIC F8 · Sürüş-farkında tek öneri satırı.
 *
 * SINIRLAR:
 *   · İş mantığı YOK: karar `musicIntelligenceRuntime`den gelir, yürütme
 *     kanonik F3/F7 yolundadır. Bileşen kütüphane taramaz, sağlayıcı çağırmaz,
 *     kuyruğa dokunmaz.
 *   · **Kullanıcıya skor · güven · kova · gerekçe GÖSTERİLMEZ** (yalnız LAB).
 *   · Karar `SUGGEST`/`AUTO_RESUME` değilse veya adın kanonik karşılığı
 *     çözülemiyorsa HİÇBİR ŞEY ÇİZİLMEZ — boş/uydurma öneri yoktur.
 *   · "Senin için · ruh hâline göre · AI DJ" gibi çıkarım iddiası YOKTUR;
 *     metin yalnız yolculuk bağlamını söyler.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

import {
  applyIntelligenceCandidate, evaluateMusicIntelligence, resolveCandidateLabel,
} from '../../platform/media/intelligence/musicIntelligenceRuntime';
import type { DrivingContext } from '../../platform/media/intelligence/drivingContextModel';
import type { IntelligenceDecision } from '../../platform/media/intelligence/musicIntelligenceModel';
import {
  getListeningSession, subscribeListeningSession,
} from '../../platform/media/session/listeningSession';

interface Props {
  /** Kütüphane/oturum değişince yeniden değerlendirilsin diye dışarıdan verilir. */
  readonly revision: string;
  readonly onStarted?: () => void;
}

/** Bağlamı kullanıcı diline çevirir — teknik sınıf adı GÖSTERİLMEZ. */
function headlineFor(motion: DrivingContext['motion'], journey: DrivingContext['journey']): string {
  if (journey === 'LONG_HAUL') return 'Uzun yol için';
  if (motion === 'HIGHWAY') return 'Yol için';
  if (motion === 'PARKED') return 'Yola çıkmadan';
  return 'Yolculuğun için';
}

export const MusicIntelligenceCard = memo(function MusicIntelligenceCard(
  { revision, onStarted }: Props,
) {
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{
    readonly decision: IntelligenceDecision;
    readonly label: { readonly title: string; readonly subtitle: string | null };
  } | null>(null);
  const mountedRef = useRef(true);

  /* Değerlendirme RENDER İÇİNDE yapılmaz (yan etkisi var: ölçüm yazar).
     Yüzey değişince ve dinleme bağlamı değişince BİR KEZ koşar; runtime
     ayrıca 1 sn'lik kendi önbelleğini uygular. Timer KURULMAZ. */
  useEffect(() => {
    mountedRef.current = true;
    const evaluate = (): void => {
      if (!mountedRef.current) return;
      const decision = evaluateMusicIntelligence();
      if (decision.action === 'HOLD' || decision.candidate === null) { setView(null); return; }
      const label = resolveCandidateLabel(decision.candidate);
      // Kanonik karşılığı çözülemeyen aday GÖSTERİLMEZ (silinmiş albüm uydurulmaz).
      setView(label === null ? null : { decision, label });
    };
    evaluate();
    /* Kullanıcı bir şey başlattığında öneri derhâl susmalı — bunun kanıtı
       kanonik dinleme oturumudur (F8 kendi olay yolunu kurmaz). */
    const unsubscribe = subscribeListeningSession(() => { void getListeningSession(); evaluate(); });
    return () => { mountedRef.current = false; unsubscribe(); };
  }, [revision]);

  const handlePlay = useCallback(() => {
    if (view === null || busy) return;
    setBusy(true);
    void applyIntelligenceCandidate(view.decision.candidate!)
      .then((ok) => { if (ok) onStarted?.(); })
      .finally(() => setBusy(false));
  }, [view, busy, onStarted]);

  if (view === null) return null;

  const headline = headlineFor(view.decision.motion, view.decision.journey);

  return (
    <section data-music-intelligence="suggestion" className="px-1">
      <button
        type="button"
        onClick={handlePlay}
        disabled={busy}
        aria-label={`${headline}: ${view.label.title}${view.label.subtitle ? ` — ${view.label.subtitle}` : ''}`}
        className="flex w-full items-center gap-3 rounded-2xl border-0 p-3 text-left"
        style={{ background: 'var(--oem-surface-2, #292d35)', opacity: busy ? 0.6 : 1 }}
      >
        <span
          aria-hidden
          className="flex flex-shrink-0 items-center justify-center rounded-full"
          style={{ width: 44, height: 44, background: 'var(--oem-amber, #e0a23c)', color: '#111' }}
        >
          <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--oem-ink-3, #8b919c)' }}
          >
            {headline}
          </span>
          <span className="block truncate text-sm font-bold" style={{ color: 'var(--oem-ink, #fff)' }}>
            {view.label.title}
          </span>
          {view.label.subtitle && (
            <span className="block truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
              {view.label.subtitle}
            </span>
          )}
        </span>
      </button>
    </section>
  );
});
