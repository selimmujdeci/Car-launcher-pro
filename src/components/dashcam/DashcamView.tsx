import { memo, useEffect, useRef } from 'react';
import { Video, VideoOff, Lock, Download, AlertTriangle, Camera, X } from 'lucide-react';
import {
  useDashcamState,
  startDashcam, stopDashcam,
  lockCurrentRecording,
  downloadCurrentBuffer, downloadLockedRecording,
  getVideoStream,
} from '../../platform/dashcamService';

/* ── Helpers ─────────────────────────────────────────────── */

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ── GForce indicator ────────────────────────────────────── */

function gForceColor(g: number): string {
  if (g > 14) return 'text-[color:var(--oem-danger)]';
  if (g > 10) return 'text-[color:var(--oem-warn)]';
  return 'text-[color:var(--oem-good)]';
}

/* ── Component ───────────────────────────────────────────── */

interface Props {
  onClose: () => void;
}

function DashcamViewInner({ onClose }: Props) {
  const state    = useDashcamState();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach video stream when recording becomes active
  useEffect(() => {
    if (state.active && videoRef.current) {
      const stream = getVideoStream();
      if (stream && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
    } else if (!state.active && videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [state.active]);

  return (
    <div className="flex flex-col h-full glass-card border-none !shadow-none text-[color:var(--oem-ink)] select-none" data-editable="dashcam" data-editable-type="card">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--oem-line)] flex-shrink-0">
        <div className="flex items-center gap-3">
          <Camera className="w-5 h-5 text-[color:var(--oem-danger)]" />
          <span className="text-[color:var(--oem-ink)] font-black text-sm uppercase tracking-widest">Araç Kamerası</span>
          {state.active && (
            <div className="flex items-center gap-1.5 bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)] px-2.5 py-1 rounded-full">
              <div className="w-1.5 h-1.5 bg-[var(--oem-danger)] rounded-full animate-pulse" />
              <span className="text-[color:var(--oem-danger)] text-[10px] font-black uppercase">KAYIT</span>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--oem-surface-2)] hover:bg-[var(--oem-surface-3)] text-[color:var(--oem-ink-3)] hover:text-[color:var(--oem-ink)] transition-colors active:scale-90"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Main area ────────────────────────────────────── */}
      <div className="flex-1 flex gap-4 p-4 min-h-0">

        {/* Camera preview */}
        <div className="flex-[2] min-h-0 relative bg-[var(--oem-surface-2)] rounded-2xl overflow-hidden border border-[var(--oem-line)]">
          {state.active ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[color:var(--oem-ink-3)]">
              <VideoOff className="w-16 h-16" />
              <div className="text-sm font-medium">Kamera kapalı</div>
              {state.hasPermission === false && (
                <div className="text-xs text-red-400 text-center px-8 leading-relaxed">
                  {state.error ?? 'Kamera izni reddedildi'}
                </div>
              )}
            </div>
          )}

          {/* G-force overlay */}
          {state.active && (
            <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-2 flex items-center gap-2">
              <AlertTriangle className={`w-4 h-4 ${gForceColor(state.gForce)}`} />
              <span className={`text-sm font-black tabular-nums ${gForceColor(state.gForce)}`}>
                {state.gForce.toFixed(1)}<span className="text-[10px] ml-0.5 opacity-60">G</span>
              </span>
            </div>
          )}

          {/* Impact lock flash */}
          {state.locked && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-[var(--oem-warn)] rounded-2xl px-8 py-5 flex items-center gap-3 shadow-2xl">
                <Lock className="w-8 h-8 text-white" />
                <span className="text-white font-black text-xl">KİLİTLENDİ!</span>
              </div>
            </div>
          )}

          {/* Segment duration */}
          {state.active && (
            <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-1.5">
              <span className="text-white text-sm font-black tabular-nums">
                {fmtDuration(state.currentDurationSec)}
              </span>
            </div>
          )}
        </div>

        {/* Controls column */}
        <div className="flex flex-col gap-3 w-40 flex-shrink-0">

          {/* Start / Stop */}
          <button
            onClick={state.active ? stopDashcam : startDashcam}
            className={`flex flex-col items-center gap-2 py-4 rounded-2xl border font-bold text-sm transition-all active:scale-95 ${
              state.active
                ? 'bg-[var(--oem-danger-soft)] border-[var(--oem-danger)] text-[color:var(--oem-danger)] hover:opacity-80'
                : 'bg-[var(--oem-good-soft)] border-[var(--oem-good)] text-[color:var(--oem-good)] hover:opacity-80'
            }`}
          >
            {state.active ? <VideoOff className="w-7 h-7" /> : <Video className="w-7 h-7" />}
            <span className="text-xs uppercase tracking-wide">{state.active ? 'Durdur' : 'Başlat'}</span>
          </button>

          {/* Lock */}
          <button
            onClick={lockCurrentRecording}
            disabled={!state.active}
            className="flex flex-col items-center gap-2 py-4 rounded-2xl border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[color:var(--oem-warn)] hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            <Lock className="w-7 h-7" />
            <span className="text-xs uppercase tracking-wide">Kilitle</span>
          </button>

          {/* Download buffer */}
          <button
            onClick={downloadCurrentBuffer}
            disabled={state.segments === 0}
            className="flex flex-col items-center gap-2 py-4 rounded-2xl border border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[color:var(--oem-info)] hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            <Download className="w-7 h-7" />
            <span className="text-xs uppercase tracking-wide">İndir</span>
          </button>

          {/* Stats */}
          <div className="mt-auto flex flex-col gap-2">
            <div className="bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-xl p-3 text-center">
              <div className="text-[10px] text-[color:var(--oem-ink-3)] uppercase tracking-widest mb-1">Buffer</div>
              <div className="text-[color:var(--oem-ink)] font-black text-lg">{state.segments}<span className="text-[color:var(--oem-ink-3)] text-xs font-normal">/3</span></div>
            </div>
            <div className="bg-[var(--oem-surface-2)] border border-[var(--oem-line)] rounded-xl p-3 text-center">
              <div className="text-[10px] text-[color:var(--oem-ink-3)] uppercase tracking-widest mb-1">Kilitli</div>
              <div className="text-[color:var(--oem-warn)] font-black text-lg">{state.lockedCount}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Locked recordings ────────────────────────────── */}
      {state.lockedCount > 0 && (
        <div className="px-4 pb-4 flex-shrink-0">
          <div className="text-[10px] text-[color:var(--oem-ink-3)] uppercase tracking-widest mb-2">Kilitli Kayıtlar</div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {Array.from({ length: state.lockedCount }, (_, i) => (
              <button
                key={i}
                onClick={() => downloadLockedRecording(i)}
                className="flex-shrink-0 flex items-center gap-2 bg-[var(--oem-warn-soft)] border border-[var(--oem-warn)] rounded-xl px-3 py-2 text-[color:var(--oem-warn)] text-xs font-bold hover:opacity-80 transition-colors active:scale-95"
              >
                <Lock className="w-3.5 h-3.5" />
                Kayıt #{i + 1}
                <Download className="w-3 h-3 opacity-60" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Info bar */}
      <div className="px-4 pb-3 flex-shrink-0">
        <p className="text-[color:var(--oem-ink-3)] text-[10px] text-center leading-relaxed">
          Döngüsel kayıt: son 6 dakika bellekte tutulur • G-Sensörü {SHAKE_THRESHOLD_DISPLAY}G üzerinde otomatik kilitler
        </p>
      </div>
    </div>
  );
}

const SHAKE_THRESHOLD_DISPLAY = 15;

export const DashcamView = memo(DashcamViewInner);


