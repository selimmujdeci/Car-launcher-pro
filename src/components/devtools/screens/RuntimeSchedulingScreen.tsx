/**
 * RuntimeSchedulingScreen — CAROS LAB · Runtime · RUNTIME SCHEDULING (Faz A4).
 *
 * Queue Monitor ve Poll Scheduler için ORTAK, SALT-OKUNUR görünüm.
 *
 * YENİ scheduler · queue · polling motoru · runtime otoritesi OLUŞTURMAZ.
 * "Global queue/scheduler" varmış gibi davranmaz: her gerçek otorite AYRI kanaldır.
 *
 * YAPMADIKLARI: queue temizleme/pause/resume · poll hızı değiştirme · komut önceliği ·
 * reconnect · recovery tetikleme · keep-alive gönderme · AT komutu · PID/DID sorgusu ·
 * Deep Scan başlatma · CAN capture başlatma · ECU write · DTC clear · native pull.
 *
 * YENİLE yalnız yan etkisiz senkron getter'ları yineler.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { readSchedRawSnapshot } from '../../../platform/devtools/runtimeSchedulingSources';
import {
  buildSchedChannels, buildSchedConflictInput, buildRuntimeSummaryInput,
  type SchedRawSnapshot,
} from '../../../platform/devtools/runtimeSchedulingBuild';
import {
  detectSchedConflicts, deriveRuntimeSummary, summarizeChannels,
  countBySchedClass, schedFormatAge,
  type SchedField, type SchedObservability, type ChannelActivity, type RuntimeSummary,
} from '../../../platform/devtools/runtimeSchedulingModel';

const CLASS_STYLE: Record<SchedObservability, string> = {
  OBSERVED:          'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  DERIVED:           'border-sky-500/40 bg-sky-500/10 text-sky-300',
  UNAVAILABLE:       'border-white/15 bg-white/5 text-white/35',
  STALE:             'border-amber-500/40 bg-amber-500/10 text-amber-300',
  UNSAFE_TO_OBSERVE: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300',
};

const ACTIVITY_STYLE: Record<ChannelActivity, string> = {
  RUNNING:     'border-emerald-500/50 bg-emerald-500/15 text-emerald-200',
  NOT_RUNNING: 'border-white/20 bg-white/5 text-white/45',
  BLOCKED:     'border-rose-500/50 bg-rose-500/15 text-rose-200',
  UNKNOWN:     'border-white/20 bg-white/5 text-white/40',
};

const SUMMARY_STYLE: Record<RuntimeSummary, string> = {
  ACTIVE:  'border-emerald-500/50 bg-emerald-500/15 text-emerald-200',
  PARTIAL: 'border-amber-500/50 bg-amber-500/15 text-amber-200',
  IDLE:    'border-sky-500/50 bg-sky-500/15 text-sky-200',
  BLOCKED: 'border-rose-500/50 bg-rose-500/15 text-rose-200',
  UNKNOWN: 'border-white/20 bg-white/5 text-white/50',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: SchedField; nowMs: number }) {
  const age = schedFormatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`sched-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-white/5 px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-white/75">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-white/95">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-white/25">
          {field.source}{age ? <> · {age}</> : <> · damga yok</>}
        </div>
        {field.note && <div className="mt-0.5 text-[9px] leading-relaxed text-white/35">{field.note}</div>}
      </div>
      <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}>
        {field.klass}
      </span>
    </div>
  );
});

export const RuntimeSchedulingScreen = memo(function RuntimeSchedulingScreen() {
  // Tek seferlik senkron okuma. TIMER YOK, ABONELİK YOK, POLLING YOK, NATIVE PULL YOK.
  const [snap, setSnap] = useState<SchedRawSnapshot>(() => readSchedRawSnapshot());
  const refresh = useCallback(() => { setSnap(readSchedRawSnapshot()); }, []);

  const channels  = useMemo(() => buildSchedChannels(snap), [snap]);
  const conflicts = useMemo(() => detectSchedConflicts(buildSchedConflictInput(snap)), [snap]);
  const counts    = useMemo(() => summarizeChannels(channels), [channels]);
  const summary   = useMemo(
    () => deriveRuntimeSummary(buildRuntimeSummaryInput(channels, conflicts.length, counts)),
    [channels, conflicts.length, counts],
  );
  const classCounts = useMemo(() => countBySchedClass(channels), [channels]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="runtime-scheduling">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="text-[11px] font-bold tracking-wide text-cyan-300">RUNTIME SCHEDULING</span>
          <span className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
            <ShieldCheck size={11} /> SALT OKUNUR — araç iletişimini değiştirmez
          </span>
          <button
            type="button"
            data-testid="sched-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-white/70 hover:bg-white/10"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-white/30">
            OBSERVED {classCounts.OBSERVED} · DERIVED {classCounts.DERIVED} · STALE {classCounts.STALE} ·
            UNAVAILABLE {classCounts.UNAVAILABLE} · UNSAFE {classCounts.UNSAFE_TO_OBSERVE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-white/30">
          Tek bir "global queue/scheduler" YOKTUR — aşağıdaki her kart AYRI bir runtime
          otoritesidir ve birleştirilmez. YENİLE yalnız yan etkisiz senkron getter'ları
          yineler: polling başlatmaz, kuyruk boşaltmaz, native pull yapmaz, handshake
          veya Deep Scan tetiklemez. Kuyruk derinliği bilinmiyorsa 0 GÖSTERİLMEZ.
        </p>
      </div>

      {/* Fail-closed runtime özeti */}
      <div
        data-testid="runtime-summary"
        data-summary={summary.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${SUMMARY_STYLE[summary.status]}`}
      >
        RUNTIME: {summary.status}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {summary.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Bu bir araç bağlantısı durumu DEĞİL, runtime zamanlama durumudur. "Zamanlayıcı var"
          tek başına ACTIVE kanıtı sayılmaz; kuyruk bilinmediği için IDLE varsayılmaz.
        </div>
      </div>

      {/* Çelişkiler */}
      {conflicts.length > 0 && (
        <div data-testid="sched-conflicts" className="shrink-0 rounded border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-amber-300">
            <AlertTriangle size={12} /> ÇELİŞKİ ({conflicts.length})
          </div>
          {conflicts.map((c) => (
            <div key={c.id} data-testid={`sched-conflict-${c.id}`} className="mt-2 border-t border-white/10 pt-1.5">
              <div className="font-mono text-[10px] text-amber-200">{c.topic}</div>
              <div className="mt-0.5 font-mono text-[10px] text-white/70">
                <div>A · {c.aSource} = <span className="text-white/95">{c.aValue}</span></div>
                <div>B · {c.bSource} = <span className="text-white/95">{c.bValue}</span></div>
              </div>
              <div className="mt-0.5 text-[9px] text-white/40">{c.note}</div>
            </div>
          ))}
        </div>
      )}

      {/* Kanallar */}
      {channels.map((ch) => (
        <div key={ch.id} data-testid={`sched-channel-${ch.id}`} className="shrink-0 rounded border border-white/10 bg-white/[0.02]">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-cyan-300/80">{ch.title}</span>
            <span
              data-testid={`sched-activity-${ch.id}`}
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${ACTIVITY_STYLE[ch.activity]}`}
            >
              {ch.activity}
            </span>
            <span className="font-mono text-[9px] text-white/30">otorite: {ch.authority}</span>
          </div>
          <div className="border-b border-white/5 px-3 py-1 text-[9px] leading-relaxed text-white/35">
            {ch.activityNote}
          </div>
          <div>
            {ch.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-white/25">
        Komut kuyruğu derinliği ve anlık aktif iş native tarafta olduğu için okunamıyor;
        bu alanlar UNAVAILABLE'dır ve boş kuyruk VARSAYILMAZ. Recovery Monitor ve Adapter
        Diagnostics ayrı ekranlardır, bu turda yapılmamıştır.
      </p>
    </div>
  );
});
