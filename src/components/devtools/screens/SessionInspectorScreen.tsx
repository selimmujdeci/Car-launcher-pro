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
  OBSERVABILITY_LABEL, SESSION_HEALTH_LABEL,
  type InspectorField, type Observability, type SessionHealth,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const HEALTH_STYLE: Record<SessionHealth, string> = {
  CONNECTED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DEGRADED:     'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  DISCONNECTED: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNKNOWN:      'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`session-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age && <> · güncellendi: {age}</>}
          {!age && <> · zaman damgası yok</>}
        </div>
        {field.note && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
        )}
      </div>
      <span
        title={field.klass}
        className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}
      >
        {OBSERVABILITY_LABEL[field.klass]}
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
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — bağlantıya, oturuma veya ECU'ya dokunmaz
          </span>
          <button
            type="button"
            data-testid="session-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {counts.OBSERVED} · TÜRETİLDİ {counts.DERIVED} · BAYAT {counts.STALE} · KAYNAK YOK {counts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          YENİLE yalnız mevcut senkron snapshot getter'larını yeniden çağırır; native pull,
          reconnect, reset, kurtarma veya komut gönderimi YOKTUR. Kaynağı olmayan alanlar
          "KAYNAK YOK" olarak gösterilir — değer uydurulmaz.
        </p>
      </div>

      {/* Fail-closed genel özet */}
      <div
        data-testid="session-health"
        data-health={health.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${HEALTH_STYLE[health.status]}`}
      >
        OTURUM ÖZETİ: {SESSION_HEALTH_LABEL[health.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {health.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Bu bir sağlık İDDİASI değil, okunabilen sinyallerin fail-closed özetidir. Güvenli
          birleşim kuralı uygulanamıyorsa "BİLİNMİYOR" gösterilir.
        </div>
      </div>

      {/* Çelişki bölümü */}
      {mismatches.length > 0 && (
        <div data-testid="session-mismatches" className="shrink-0 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-3 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--oem-warn)]">
            <AlertTriangle size={12} /> KAYNAK ÇELİŞKİSİ ({mismatches.length})
          </div>
          <p className="mt-1 text-[9px] text-[var(--oem-ink-3)]">
            Aynı kavramı temsil eden ayrı kaynaklar çelişiyor. Hiçbiri diğerini EZMEZ; ikisi de gösterilir.
          </p>
          {mismatches.map((m) => (
            <div key={m.id} data-testid={`mismatch-${m.id}`} className="mt-2 border-t border-[var(--oem-line)] pt-1.5">
              <div className="font-mono text-[10px] text-[var(--oem-warn)]">{m.topic}</div>
              <div className="mt-0.5 font-mono text-[10px] text-[var(--oem-ink-2)]">
                <div>A · {m.aSource} = <span className="text-[var(--oem-ink)]">{m.aValue}</span></div>
                <div>B · {m.bSource} = <span className="text-[var(--oem-ink)]">{m.bValue}</span></div>
              </div>
              <div className="mt-0.5 text-[9px] text-[var(--oem-ink-3)]">{m.note}</div>
            </div>
          ))}
        </div>
      )}

      {/* Katman kartları */}
      {cards.map((card) => (
        <div key={card.id} data-testid={`session-card-${card.id}`} className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
          <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            {card.title}
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        Sorgu Zamanlayıcı · Kuyruk İzleyici · Kurtarma İzleyici ayrı ekranlardır ve bu turda
        yapılmamıştır; ilgili alanlar burada "KAYNAK YOK" olarak beyan edilir.
      </p>
    </div>
  );
});
