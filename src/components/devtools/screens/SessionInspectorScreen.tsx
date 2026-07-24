/**
 * SessionInspectorScreen — CAROS LAB · Communication · Session Inspector (Faz A3).
 *
 * SALT-OKUNUR. Bu ekran yeni bir session manager/state machine/birleşik "truth object"
 * DEĞİLDİR: mevcut senkron snapshot getter'larını okur, her değeri
 * OBSERVED / DERIVED / UNAVAILABLE / STALE olarak işaretler ve çelişkileri AÇIĞA ÇIKARIR.
 *
 * YAPMADIKLARI (pazarlıksız): bağlantı açma/kapama · reconnect · reset · AT komutu ·
 * KWP recovery tetikleme · poll scheduler değiştirme · kuyruk temizleme · DTC okuma/silme ·
 * Deep Scan başlatma · native sözleşme genişletme · yeni timer/polling · yeni global store.
 *
 * YENİLE düğmesi YALNIZ mevcut senkron getter'ları yeniden çağırır (async native pull YOK).
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { readSessionRawSnapshot } from '../../../platform/devtools/sessionInspectorSources';
import {
  buildInspectorCards, buildMismatchInput, buildHealthInput,
  type SessionRawSnapshot,
} from '../../../platform/devtools/sessionInspectorBuild';
import {
  detectMismatches, deriveSessionHealth, countByClass, formatAge,
  type InspectorField, type Observability, type SessionHealth,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  DERIVED:     'border-sky-500/40 bg-sky-500/10 text-sky-300',
  UNAVAILABLE: 'border-white/15 bg-white/5 text-white/35',
  STALE:       'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

const HEALTH_STYLE: Record<SessionHealth, string> = {
  CONNECTED:    'border-emerald-500/50 bg-emerald-500/15 text-emerald-200',
  DEGRADED:     'border-amber-500/50 bg-amber-500/15 text-amber-200',
  DISCONNECTED: 'border-rose-500/50 bg-rose-500/15 text-rose-200',
  UNKNOWN:      'border-white/20 bg-white/5 text-white/50',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`session-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-white/5 px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-white/75">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-white/95">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-white/25">
          {field.source}
          {age && <> · güncellendi: {age}</>}
          {!age && <> · damga yok</>}
        </div>
        {field.note && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-white/35">{field.note}</div>
        )}
      </div>
      <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}>
        {field.klass}
      </span>
    </div>
  );
});

export const SessionInspectorScreen = memo(function SessionInspectorScreen() {
  // Tek seferlik senkron okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<SessionRawSnapshot>(() => readSessionRawSnapshot());

  const refresh = useCallback(() => { setSnap(readSessionRawSnapshot()); }, []);

  const cards      = useMemo(() => buildInspectorCards(snap), [snap]);
  const mismatches = useMemo(() => detectMismatches(buildMismatchInput(snap)), [snap]);
  const health     = useMemo(
    () => deriveSessionHealth(buildHealthInput(snap, mismatches.length)),
    [snap, mismatches.length],
  );
  const counts = useMemo(() => countByClass(cards), [cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="session-inspector">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
            <ShieldCheck size={11} /> SALT OKUNUR — bağlantıya, oturuma veya ECU'ya dokunmaz
          </span>
          <button
            type="button"
            data-testid="session-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-white/70 hover:bg-white/10"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-white/30">
            OBSERVED {counts.OBSERVED} · DERIVED {counts.DERIVED} · STALE {counts.STALE} · UNAVAILABLE {counts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-white/30">
          YENİLE yalnız mevcut senkron snapshot getter'larını yeniden çağırır; native pull,
          reconnect, reset, recovery veya komut gönderimi YOKTUR. Kaynağı olmayan alanlar
          UNAVAILABLE olarak gösterilir — değer uydurulmaz.
        </p>
      </div>

      {/* Fail-closed genel özet */}
      <div
        data-testid="session-health"
        data-health={health.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${HEALTH_STYLE[health.status]}`}
      >
        OTURUM ÖZETİ: {health.status}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {health.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Bu bir sağlık İDDİASI değil, okunabilen sinyallerin fail-closed özetidir. Güvenli
          birleşim kuralı uygulanamıyorsa UNKNOWN gösterilir.
        </div>
      </div>

      {/* Çelişki bölümü */}
      {mismatches.length > 0 && (
        <div data-testid="session-mismatches" className="shrink-0 rounded border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-amber-300">
            <AlertTriangle size={12} /> SOURCE MISMATCH ({mismatches.length})
          </div>
          <p className="mt-1 text-[9px] text-white/40">
            Aynı kavramı temsil eden ayrı kaynaklar çelişiyor. Hiçbiri diğerini EZMEZ; ikisi de gösterilir.
          </p>
          {mismatches.map((m) => (
            <div key={m.id} data-testid={`mismatch-${m.id}`} className="mt-2 border-t border-white/10 pt-1.5">
              <div className="font-mono text-[10px] text-amber-200">{m.topic}</div>
              <div className="mt-0.5 font-mono text-[10px] text-white/70">
                <div>A · {m.aSource} = <span className="text-white/95">{m.aValue}</span></div>
                <div>B · {m.bSource} = <span className="text-white/95">{m.bValue}</span></div>
              </div>
              <div className="mt-0.5 text-[9px] text-white/40">{m.note}</div>
            </div>
          ))}
        </div>
      )}

      {/* Katman kartları */}
      {cards.map((card) => (
        <div key={card.id} data-testid={`session-card-${card.id}`} className="shrink-0 rounded border border-white/10 bg-white/[0.02]">
          <div className="border-b border-white/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-cyan-300/80">
            {card.title}
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-white/25">
        Poll Scheduler · Queue Monitor · Recovery Monitor ayrı ekranlardır ve bu turda
        yapılmamıştır; ilgili alanlar burada UNAVAILABLE olarak beyan edilir.
      </p>
    </div>
  );
});
