/**
 * AudioExperiencePanel — MUSIC F6 · Ses deneyimi ÜRÜN yüzeyi.
 *
 * SÖZLEŞME:
 *   · Bu panel bir PROJEKSİYONDUR (Cross-Domain §14). Kendi DSP gerçeğini
 *     tutmaz; her değeri `audioExperienceAuthority`den okur, her değişikliği
 *     aynı otoriteye yazar. İkinci bir EQ state'i YOKTUR.
 *   · Cihazın desteklemediği kontrol RENDER EDİLMEZ — "kapalı" görünen kutu
 *     yığını (disabled mezarlığı) kurulmaz (§13).
 *   · Sürüşte ince ayar etkileşimi kapanır; preset ve bypass büyük dokunma
 *     hedefiyle açık kalır. Kısıtlanan şey zekâ değil, yalnız etkileşimdir.
 *   · Sürükleme YOKTUR: her ayar ± adım düğmeleriyle değişir (araç içinde
 *     hassas sürükleme dikkat maliyeti yüksektir).
 *   · Hiçbir oynatma komutu göndermez; sesi (userVolume) değiştirmez.
 */

import { memo, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Sliders, RotateCcw, Power, AudioWaveform } from 'lucide-react';
import {
  getCapabilities, getConfig, getSafetyPreampDb, resetAudioExperience,
  setBalance, setBandGainDb, setEnabled, setLoudnessDb, setPreset,
  subscribeAudioExperience,
} from '../../platform/media/audio/audioExperienceAuthority';
import {
  AUDIO_PRESETS, interactionModeFor, visibleControls,
  type PresetId,
} from '../../platform/media/audio/audioExperienceModel';
import {
  getTransitionPreference, setTransitionPreference, subscribeTransition,
} from '../../platform/media/transition/transitionPreference';
import { MAX_FADE_MS, MIN_FADE_MS } from '../../platform/media/transition/transitionModel';
import type { DrivingMode } from './nowPlayingModel';

const BAND_STEP_DB = 1;
const LOUDNESS_STEP_DB = 0.5;
const BALANCE_STEP = 0.1;
/** MUSIC F20 · geçiş süresi adımı — araç içinde ince ayar aranmaz. */
const FADE_STEP_MS = 300;

function formatHz(hz: number): string {
  return hz >= 1000 ? `${Math.round(hz / 100) / 10}k` : `${Math.round(hz)}`;
}

function formatDb(db: number): string {
  const v = Math.round(db * 10) / 10;
  return `${v > 0 ? '+' : ''}${v}`;
}

/** Büyük dokunma hedefi — araç içi minimum 44px. */
const StepButton = memo(function StepButton({
  label, onPress, testId,
}: { label: string; onPress: () => void; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onPress}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[18px] font-bold text-[var(--oem-ink)] active:bg-[var(--oem-surface-3)]"
    >
      {label}
    </button>
  );
});

interface Props {
  /** Sürüş dikkat düzeyi — yalnız ETKİLEŞİMİ kısıtlar, yeteneği değil. */
  readonly drivingMode?: DrivingMode;
}

export const AudioExperiencePanel = memo(function AudioExperiencePanel({
  drivingMode = 'idle',
}: Props) {
  /* Otorite değişince yeniden çiz. Yerel kopya TUTULMAZ — tek gerçek otoritede. */
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const unsub = subscribeAudioExperience(() => { if (mountedRef.current) bump(); });
    /* MUSIC F20 · geçiş tercihi AYRI bir otoritedir (transitionRuntime);
       burada yalnız PROJEKSİYONU çizilir ve aboneliği ayrıca temizlenir. */
    const unsubTransition = subscribeTransition(() => { if (mountedRef.current) bump(); });
    return () => { mountedRef.current = false; unsub(); unsubTransition(); };
  }, []);

  const caps = getCapabilities();
  const cfg = getConfig();
  /* Geçiş tercihi kendi otoritesinden OKUNUR; burada kopyası TUTULMAZ. */
  const transition = getTransitionPreference();
  const preampDb = getSafetyPreampDb();
  const vis = useMemo(() => visibleControls(caps), [caps]);
  const mode = interactionModeFor(drivingMode);
  const fine = mode === 'FULL';

  const onBand = useCallback((i: number, delta: number) => {
    setBandGainDb(i, (cfg.bandGainsDb[i] ?? 0) + delta);
  }, [cfg.bandGainsDb]);

  /* Hiçbir yetenek yoksa: TEK bir dürüst açıklama. Sahte kontrol çizilmez. */
  if (!vis.any) {
    return (
      <div
        data-testid="audio-experience-unavailable"
        className="rounded-xl border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-4 py-5"
      >
        <div className="flex items-center gap-2 text-[15px] font-bold text-[var(--oem-ink)]">
          <AudioWaveform size={18} /> Ses işleme
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu cihazda uygulama içi ses işleme (ekolayzer, loudness, denge) kullanılamıyor.
          Var olmayan bir ayar gösterilmez — müzik, cihazın kendi ses yolunda değişmeden çalar.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="audio-experience"
      data-interaction={mode}
      className="flex flex-col gap-4 rounded-xl border border-[var(--oem-line)] bg-[var(--oem-surface-1)] p-4"
    >
      {/* Başlık + bypass */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[15px] font-bold text-[var(--oem-ink)]">
          <Sliders size={18} /> Ses işleme
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="ax-bypass"
            aria-pressed={cfg.enabled}
            onClick={() => setEnabled(!cfg.enabled)}
            className={`flex h-11 items-center gap-2 rounded-lg border px-4 text-[13px] font-bold ${
              cfg.enabled
                ? 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]'
                : 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]'
            }`}
          >
            <Power size={15} /> {cfg.enabled ? 'AÇIK' : 'KAPALI'}
          </button>
          {fine && (
            <button
              type="button"
              data-testid="ax-reset"
              onClick={resetAudioExperience}
              className="flex h-11 items-center gap-2 rounded-lg border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-4 text-[13px] font-bold text-[var(--oem-ink-2)]"
            >
              <RotateCcw size={15} /> Sıfırla
            </button>
          )}
        </div>
      </div>

      {/* Preset — sürüşte de açık kalır (büyük hedef, tek dokunuş) */}
      {vis.presets && (
        <div data-testid="ax-presets" className="flex flex-wrap gap-2">
          {AUDIO_PRESETS.filter((p) => p.id !== 'custom' || cfg.presetId === 'custom').map((p) => {
            const active = cfg.presetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`ax-preset-${p.id}`}
                data-active={active}
                disabled={!cfg.enabled}
                onClick={() => setPreset(p.id as PresetId)}
                className={`h-11 rounded-lg border px-4 text-[13px] font-bold ${
                  active
                    ? 'border-[var(--oem-accent)] bg-[var(--oem-accent-soft,var(--oem-surface-3))] text-[var(--oem-accent)]'
                    : 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]'
                } ${cfg.enabled ? '' : 'opacity-40'}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      {/* EQ bantları — cihazın GERÇEK bant sayısı ve frekansları */}
      {vis.eqBands && (
        <div data-testid="ax-eq" className="flex flex-col gap-1.5">
          {cfg.bandGainsDb.map((gain, i) => {
            const hz = caps.eqBandFrequenciesHz[i] ?? 0;
            const span = Math.max(1, caps.eqMaxGainDb - caps.eqMinGainDb);
            const pct = ((gain - caps.eqMinGainDb) / span) * 100;
            return (
              <div
                key={`${hz}-${i}`}
                data-testid={`ax-band-${i}`}
                data-hz={hz}
                data-gain={gain}
                className="flex items-center gap-2"
              >
                <span className="w-12 shrink-0 text-right font-mono text-[12px] text-[var(--oem-ink-3)]">
                  {formatHz(hz)}
                </span>
                {fine && (
                  <StepButton
                    label="−"
                    testId={`ax-band-${i}-down`}
                    onPress={() => onBand(i, -BAND_STEP_DB)}
                  />
                )}
                <div className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--oem-surface-3)]">
                  <div
                    className="absolute inset-y-0 rounded-full bg-[var(--oem-accent)]"
                    style={{ left: '0%', width: `${Math.max(0, Math.min(100, pct))}%` }}
                  />
                </div>
                {fine && (
                  <StepButton
                    label="+"
                    testId={`ax-band-${i}-up`}
                    onPress={() => onBand(i, BAND_STEP_DB)}
                  />
                )}
                <span className="w-12 shrink-0 text-right font-mono text-[12px] text-[var(--oem-ink)]">
                  {formatDb(gain)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Loudness */}
      {vis.loudness && (
        <div data-testid="ax-loudness" className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[13px] font-bold text-[var(--oem-ink-2)]">
            Loudness
            <span className="ml-2 font-normal text-[var(--oem-ink-3)]">
              Düşük seviyede gövdeyi korur
            </span>
          </span>
          {fine && (
            <StepButton
              label="−"
              testId="ax-loudness-down"
              onPress={() => setLoudnessDb(cfg.loudnessDb - LOUDNESS_STEP_DB)}
            />
          )}
          <span className="w-16 text-right font-mono text-[13px] text-[var(--oem-ink)]">
            {formatDb(cfg.loudnessDb)} dB
          </span>
          {fine && (
            <StepButton
              label="+"
              testId="ax-loudness-up"
              onPress={() => setLoudnessDb(cfg.loudnessDb + LOUDNESS_STEP_DB)}
            />
          )}
        </div>
      )}

      {/* Denge */}
      {vis.balance && (
        <div data-testid="ax-balance" className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[13px] font-bold text-[var(--oem-ink-2)]">
            Denge
            <span className="ml-2 font-normal text-[var(--oem-ink-3)]">Sol · Sağ</span>
          </span>
          {fine && (
            <StepButton
              label="◀"
              testId="ax-balance-left"
              onPress={() => setBalance(cfg.balance - BALANCE_STEP)}
            />
          )}
          <span
            data-testid="ax-balance-value"
            className="w-16 text-center font-mono text-[13px] text-[var(--oem-ink)]"
          >
            {cfg.balance === 0
              ? 'MERKEZ'
              : `${cfg.balance < 0 ? 'S' : 'R'}${Math.round(Math.abs(cfg.balance) * 10)}`}
          </span>
          {fine && (
            <StepButton
              label="▶"
              testId="ax-balance-right"
              onPress={() => setBalance(cfg.balance + BALANCE_STEP)}
            />
          )}
        </div>
      )}

      {/* Güvenlik kazancı — gizlenmez; kullanıcı neden ses "biraz kısıldı" bilir. */}
      {preampDb < 0 && (
        <p data-testid="ax-headroom" className="text-[12px] leading-relaxed text-[var(--oem-ink-3)]">
          Yüksek yükseltme nedeniyle bozulmayı önlemek için {formatDb(preampDb)} dB
          güvenlik payı uygulanıyor. Ses düzeyi ayarınız değişmedi.
        </p>
      )}

      {/* ── MUSIC F20 · Parça geçişi ───────────────────────────────────────
          Boşluksuz (gapless) geçiş cihazın oynatıcısında ZATEN vardır ve
          kapatılamaz — burada gösterilen yalnız SINIRDA FADE tercihidir.
          Gerçek crossfade (üst üste binme) bu mimaride DESTEKLENMEZ ve
          varmış gibi bir kontrol ÇİZİLMEZ. */}
      <div
        data-testid="ax-transition"
        className="flex flex-col gap-2 border-t border-[var(--oem-line)] pt-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] font-bold text-[var(--oem-ink)]">Parça geçişi</span>
          <button
            type="button"
            data-testid="ax-fade-toggle"
            aria-pressed={transition.fadeEnabled}
            onClick={() => { setTransitionPreference({ fadeEnabled: !transition.fadeEnabled }); }}
            className={`flex h-11 items-center gap-2 rounded-lg border px-4 text-[13px] font-bold ${
              transition.fadeEnabled
                ? 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]'
                : 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]'
            }`}
          >
            <Power size={15} /> {transition.fadeEnabled ? 'AÇIK' : 'KAPALI'}
          </button>
        </div>

        {transition.fadeEnabled && fine && (
          <div className="flex items-center gap-2">
            <StepButton
              label="−"
              testId="ax-fade-down"
              onPress={() => {
                setTransitionPreference({
                  fadeMs: Math.max(MIN_FADE_MS, transition.fadeMs - FADE_STEP_MS),
                });
              }}
            />
            <span
              data-testid="ax-fade-value"
              className="w-20 text-center font-mono text-[13px] text-[var(--oem-ink)]"
            >
              {(Math.round(transition.fadeMs / 100) / 10).toFixed(1)} sn
            </span>
            <StepButton
              label="+"
              testId="ax-fade-up"
              onPress={() => {
                setTransitionPreference({
                  fadeMs: Math.min(MAX_FADE_MS, transition.fadeMs + FADE_STEP_MS),
                });
              }}
            />
          </div>
        )}

        <p data-testid="ax-transition-note" className="text-[12px] leading-relaxed text-[var(--oem-ink-3)]">
          Albümlerde boşluksuz geçiş her zaman açıktır ve geçiş yumuşatması
          uygulanmaz. Yumuşatma iki parçayı ÜST ÜSTE BİNDİRMEZ; parçanın sonunda
          kısılır, yenisinde açılır. Canlı yayında ve Caros konuşurken uygulanmaz.
        </p>
      </div>

      {!fine && (
        <p data-testid="ax-driving-note" className="text-[12px] leading-relaxed text-[var(--oem-ink-3)]">
          Araç hareket hâlinde: ince ayarlar kapalı. Hazır profiller ve açma/kapama
          kullanılabilir.
        </p>
      )}
    </div>
  );
});
