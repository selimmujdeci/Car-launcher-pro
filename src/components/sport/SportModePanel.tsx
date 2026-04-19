/**
 * Sport Mode Panel — G-Meter, 0-100 ve Çeyrek Mil arayüzü.
 *
 * G-Meter: SVG tabanlı tesla/porsche tarzı top görselleştirme.
 * 0-100 / QM testleri: canlı sayaç + sonuç gösterimi.
 */

import { memo, useCallback, useMemo } from 'react';
import { Zap, Flag, RotateCcw, Play, X, AlertTriangle } from 'lucide-react';
import {
  usePerformanceState,
  usePerformanceBridge,
  startSprintTest,
  startQMTest,
  cancelTest,
  resetPeaks,
  type SprintState,
  type QMState,
} from '../../platform/performanceService';
import { useOBDState } from '../../platform/obdService';

/* ── Yardımcı ────────────────────────────────────────────── */

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor((ms % 1000) / 10);
  return `${s}.${h.toString().padStart(2, '0')}`;
}

function clampG(g: number, max: number): number {
  return Math.max(-max, Math.min(max, g));
}

/* ── G-Meter Bileşeni ────────────────────────────────────── */

const G_MAX = 2.5;   // görsel ölçek sınırı

const GMeter = memo(function GMeter({
  longG,
  latG,
}: {
  longG: number;
  latG: number;
}) {
  const SIZE   = 220;
  const CX     = SIZE / 2;
  const CY     = SIZE / 2;
  const RADIUS = SIZE * 0.42;
  const DOT_R  = SIZE * 0.06;

  // Top pozisyonu: boyuna G dikey, yanal G yatay
  const bx = CX + clampG(latG,  G_MAX) / G_MAX * (RADIUS - DOT_R - 4);
  const by = CY - clampG(longG, G_MAX) / G_MAX * (RADIUS - DOT_R - 4);

  // Renk: güçlü G'de kırmızı, düşükte mavi
  const absG    = Math.sqrt(longG ** 2 + latG ** 2);
  const dotColor = absG > 1.5 ? '#ef4444' : absG > 0.8 ? '#f59e0b' : '#3b82f6';

  // Konsantrik çemberler ölçek çizgileri
  const rings = [0.25, 0.5, 0.75, 1.0];

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-slate-500 text-[10px] uppercase tracking-widest">G-Metre</span>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="overflow-visible">
        <defs>
          <radialGradient id="gmBg" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#1e3a5f" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--panel-bg)" stopOpacity="0.9" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Arka plan */}
        <circle cx={CX} cy={CY} r={RADIUS} fill="url(#gmBg)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

        {/* Konsantrik ölçek çemberleri */}
        {rings.map((r) => (
          <circle
            key={r}
            cx={CX} cy={CY}
            r={RADIUS * r}
            fill="none"
            stroke={r === 1.0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}
            strokeWidth={r === 1.0 ? 1 : 0.5}
            strokeDasharray={r === 1.0 ? undefined : '3 4'}
          />
        ))}

        {/* Eksen çizgileri */}
        <line x1={CX - RADIUS} y1={CY} x2={CX + RADIUS} y2={CY} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        <line x1={CX} y1={CY - RADIUS} x2={CX} y2={CY + RADIUS} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />

        {/* Yön etiketleri */}
        <text x={CX}          y={CY - RADIUS - 8} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10">İVME</text>
        <text x={CX}          y={CY + RADIUS + 16} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10">FREN</text>
        <text x={CX - RADIUS - 8} y={CY + 4}       textAnchor="end"    fill="rgba(255,255,255,0.3)" fontSize="10">SOL</text>
        <text x={CX + RADIUS + 8} y={CY + 4}       textAnchor="start"  fill="rgba(255,255,255,0.3)" fontSize="10">SAĞ</text>

        {/* Merkez + */}
        <line x1={CX - 6} y1={CY} x2={CX + 6} y2={CY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        <line x1={CX} y1={CY - 6} x2={CX} y2={CY + 6} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />

        {/* Hareket izi */}
        <circle cx={bx} cy={by} r={DOT_R + 6} fill={dotColor} opacity="0.15" filter="url(#glow)" />

        {/* Ana top */}
        <circle cx={bx} cy={by} r={DOT_R} fill={dotColor} filter="url(#glow)" />
        <circle cx={bx - DOT_R * 0.3} cy={by - DOT_R * 0.3} r={DOT_R * 0.35} fill="white" opacity="0.4" />
      </svg>

      {/* G değerleri */}
      <div className="flex gap-6 text-center">
        <div>
          <div className="text-primary text-lg font-black tabular-nums">
            {Math.abs(longG).toFixed(2)}<span className="text-slate-500 text-xs">g</span>
          </div>
          <div className="text-slate-600 text-[10px] uppercase tracking-wider">
            {longG >= 0 ? 'İvme' : 'Fren'}
          </div>
        </div>
        <div>
          <div className="text-primary text-lg font-black tabular-nums">
            {Math.abs(latG).toFixed(2)}<span className="text-slate-500 text-xs">g</span>
          </div>
          <div className="text-slate-600 text-[10px] uppercase tracking-wider">
            {latG >= 0 ? 'Sağ' : 'Sol'}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ── Test kartı ──────────────────────────────────────────── */

const TestCard = memo(function TestCard({
  title,
  icon: Icon,
  state,
  elapsedMs,
  resultTime,
  resultExtra,
  onStart,
  onCancel,
}: {
  title: string;
  icon: typeof Zap;
  state: SprintState | QMState;
  elapsedMs: number;
  resultTime: number | null;
  resultExtra?: string;
  onStart: () => void;
  onCancel: () => void;
}) {
  const isRunning = state === 'running' || state === 'waiting';
  const isDone    = state === 'done';

  return (
    <div className={`
      rounded-2xl border p-4 flex flex-col gap-3 transition-all duration-300
      ${isDone ? 'border-emerald-500/30 bg-emerald-500/5' :
        isRunning ? 'border-blue-400/30 bg-blue-500/5' :
        'border-white/[0.1] bg-white/[0.05]'}
    `}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${isDone ? 'text-emerald-400' : isRunning ? 'text-blue-400' : 'text-slate-500'}`} />
          <span className="text-primary/70 text-xs font-bold uppercase tracking-wider">{title}</span>
        </div>
        {isRunning && (
          <button
            onClick={onCancel}
            className="w-6 h-6 rounded-lg var(--panel-bg-secondary) flex items-center justify-center text-slate-500 hover:text-red-400 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Sayaç / Sonuç */}
      <div className="text-center py-2">
        {state === 'idle' && (
          <div className="text-slate-600 text-sm">Hazır</div>
        )}
        {state === 'waiting' && (
          <div className="flex flex-col items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <div className="text-amber-400 text-sm font-bold">Çıkış bekleniyor…</div>
          </div>
        )}
        {state === 'running' && (
          <div className="text-4xl font-black tabular-nums text-primary">
            {fmtMs(elapsedMs)}
            <span className="text-slate-500 text-lg font-light ml-1">s</span>
          </div>
        )}
        {isDone && resultTime !== null && (
          <div className="flex flex-col items-center gap-1">
            <div className="text-5xl font-black tabular-nums text-emerald-400">
              {fmtMs(resultTime)}
              <span className="text-emerald-600 text-xl font-light ml-1">s</span>
            </div>
            {resultExtra && (
              <div className="text-slate-400 text-xs">{resultExtra}</div>
            )}
          </div>
        )}
      </div>

      {/* Buton */}
      {(state === 'idle' || state === 'done') && (
        <button
          onClick={onStart}
          className={`
            h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2
            active:scale-95 transition-all
            ${isDone
              ? 'var(--panel-bg-secondary) border border-white/10 text-slate-400'
              : 'bg-blue-500/20 border border-blue-400/30 text-blue-400'}
          `}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          {isDone ? 'Tekrar Test' : 'Testi Başlat'}
        </button>
      )}
    </div>
  );
});

/* ── Peak kartı ──────────────────────────────────────────── */

const PeakCard = memo(function PeakCard({
  peakAccelG,
  peakBrakeG,
  onReset,
}: {
  peakAccelG: number;
  peakBrakeG: number;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.1] bg-white/[0.05] p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-500 text-[10px] uppercase tracking-widest">Oturum Rekoru</span>
        <button
          onClick={onReset}
          className="w-6 h-6 rounded-lg var(--panel-bg-secondary) flex items-center justify-center text-slate-500 hover:text-primary transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="text-center">
          <div className="text-blue-400 text-2xl font-black tabular-nums">
            {peakAccelG.toFixed(2)}<span className="text-slate-500 text-sm">g</span>
          </div>
          <div className="text-slate-600 text-[10px] mt-0.5">En Yüksek İvme</div>
        </div>
        <div className="text-center">
          <div className="text-red-400 text-2xl font-black tabular-nums">
            {peakBrakeG.toFixed(2)}<span className="text-slate-500 text-sm">g</span>
          </div>
          <div className="text-slate-600 text-[10px] mt-0.5">En Sert Fren</div>
        </div>
      </div>
    </div>
  );
});

/* ── Ana panel ───────────────────────────────────────────── */

export const SportModePanel = memo(function SportModePanel() {
  // OBD+GPS verilerini performans servisine köprüle
  usePerformanceBridge();

  const perf = usePerformanceState();
  const obd  = useOBDState();

  const sprintExtra = useMemo(() => {
    if (!perf.sprintResult) return undefined;
    return perf.sprintResult.launchRPM
      ? `Çıkış devriyesi: ${perf.sprintResult.launchRPM} RPM`
      : undefined;
  }, [perf.sprintResult]);

  const qmExtra = useMemo(() => {
    if (!perf.qmResult) return undefined;
    return `Bitiş hızı: ${Math.round(perf.qmResult.finishSpeedKmh)} km/h`;
  }, [perf.qmResult]);

  const handleCancelSprint = useCallback(() => cancelTest(), []);
  const handleCancelQM     = useCallback(() => cancelTest(), []);

  return (
    <div className="h-full flex flex-col overflow-y-auto glass-card text-primary border-none !shadow-none" data-editable="sport-mode" data-editable-type="card">
      {/* Başlık */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <div className="text-primary font-bold text-lg tracking-tight">Sport Mod Pro</div>
            <div className="text-slate-500 text-xs">Performans & Yarış İstatistikleri</div>
          </div>
        </div>
        {/* Simüle OBD uyarısı — veriler güvenilir değil */}
        {obd.source === 'mock' && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="text-amber-400/80 text-[10px] font-semibold">
              OBD bağlı değil — performans verileri simüle edilmektedir, gerçeği yansıtmaz
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
        {/* G-Metre */}
        <div className="glass-card border border-white/5 p-4 flex justify-center !shadow-none">
          <GMeter longG={perf.longitudinalG} latG={perf.lateralG} />
        </div>

        {/* Peak rekoru */}
        <PeakCard
          peakAccelG={perf.peakAccelG}
          peakBrakeG={perf.peakBrakeG}
          onReset={resetPeaks}
        />

        {/* 0-100 Test */}
        <TestCard
          title="0 → 100 km/h"
          icon={Zap}
          state={perf.sprintState}
          elapsedMs={perf.sprintElapsedMs}
          resultTime={perf.sprintResult?.timeMs ?? null}
          resultExtra={sprintExtra}
          onStart={startSprintTest}
          onCancel={handleCancelSprint}
        />

        {/* Çeyrek Mil Test */}
        <TestCard
          title="Çeyrek Mil (400 m)"
          icon={Flag}
          state={perf.qmState}
          elapsedMs={perf.qmElapsedMs}
          resultTime={perf.qmResult?.timeMs ?? null}
          resultExtra={qmExtra}
          onStart={startQMTest}
          onCancel={handleCancelQM}
        />

        {/* 400m mesafe göstergesi (test sırasında) */}
        {perf.qmState === 'running' && (
          <div className="rounded-xl var(--panel-bg-secondary) border border-white/5 p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-slate-500 text-xs">Mesafe</span>
              <span className="text-primary font-bold tabular-nums">{Math.round(perf.qmDistanceM)} / 400 m</span>
            </div>
            <div className="w-full h-2 var(--panel-bg-secondary) rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (perf.qmDistanceM / 402.336) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Bilgi notu */}
        <div className="text-slate-500 text-[10px] text-center px-4 pb-2 leading-relaxed">
          G-metre ve testler OBD + GPS verisi gerektirir.
          Güvenli, özel bir alanda test yapınız.
        </div>
      </div>
    </div>
  );
});

export default SportModePanel;


