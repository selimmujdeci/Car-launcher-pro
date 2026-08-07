'use client';

/**
 * ReasoningCards — Fleet Dashboard · KARAR KARTLARI (SALT-OKUNUR).
 *
 * ── BU BİR AI PANELİ DEĞİLDİR ─────────────────────────────────────────
 * Cevap/öneri/cümle üretilmez. **LLM burada karar vermez**: kartlar
 * sunucunun (migration 057) ZATEN VERDİĞİ kararı sayar.
 *
 * ── DÜRÜSTLÜK KURALLARI ───────────────────────────────────────────────
 *   · Karar yoksa BOŞ KART değil, GEREKÇE gösterilir.
 *   · Bilinmeyen değer `—` gösterilir, **`0` değil**.
 *   · Çelişki ve bilinmezlik GİZLENMEZ — ayrı kartları vardır.
 *   · Bütünlük bozuksa AÇIKÇA görünür.
 *   · Aktif komut YOK: karar tetiklenmez, durum ilerletilmez.
 */

import {
  buildReasoningQueueView, buildReasoningView, buildSchedulerView,
  queueAbsenceExplanation,
  reasoningAbsenceExplanation, reasoningDecisionExplanation,
  type QueueCard, type ReasoningCard, type ReasoningQueueRow,
  type ReasoningSummaryRow, type RecentReasoningRow, type SchedulerHealthRow,
} from '@/lib/fleet/reasoningView';

export interface ReasoningCardsProps {
  /** `get_reasoning_summary()` satırı; yoksa `null`. */
  readonly summary: ReasoningSummaryRow | null;
  /** `get_recent_reasoning()` satırları; yoksa `null`. */
  readonly recent?: readonly RecentReasoningRow[] | null;
  /** `get_reasoning_queue()` satırı; yoksa `null`. */
  readonly queue?: ReasoningQueueRow | null;
  /** `get_reasoning_scheduler_health()` satırı; yoksa `null` (okunamadı). */
  readonly scheduler?: SchedulerHealthRow | null;
}

function valueText(c: ReasoningCard): string {
  if (c.value === null) return '—';
  return c.unit === 'PERCENT' ? `%${c.value}` : String(c.value);
}

function queueValueText(c: QueueCard): string {
  if (c.value === null) return '—';
  return c.unit === 'MS' ? `${c.value} ms` : String(c.value);
}

function ageText(seconds: number | null): string {
  if (seconds === null) return 'UNKNOWN';
  if (seconds < 60) return `${seconds} sn`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa`;
  return `${Math.floor(seconds / 86400)} gün`;
}

/**
 * Üretim kuyruğu bölümü — **her zaman gösterilir**.
 *
 * ⚠️ Karar yokken bile kuyruk görünür kalmalıdır: "hiç karar yok" ile
 * "olaylar geliyor ama karara bağlanamıyor" farklı arızalardır.
 */
function QueueSection({ queue }: { queue?: ReasoningQueueRow | null }) {
  const q = buildReasoningQueueView(queue);

  if (!q.present) {
    return (
      <section
        data-testid="reasoning-queue-absent"
        className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3"
      >
        <p className="text-[11px] font-semibold text-neutral-300">Karar Kuyruğu</p>
        <p className="mt-1 text-[11px] text-neutral-400">
          {queueAbsenceExplanation(q)}
        </p>
      </section>
    );
  }

  return (
    <section data-testid="reasoning-queue-cards" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {q.cards.map((c) => (
          <div
            key={c.key}
            data-testid={`queue-card-${c.key}`}
            data-known={c.known ? 'true' : 'false'}
            data-attention={c.attention ? 'true' : 'false'}
            className={`rounded-xl border p-3 ${
              c.attention
                ? 'border-amber-500/40 bg-amber-500/[0.06]'
                : 'border-neutral-800 bg-neutral-900/60'
            }`}
          >
            <p className="text-[11px] text-neutral-400">{c.label}</p>
            <p className="mt-1 font-mono text-lg text-neutral-100">{queueValueText(c)}</p>
            <p className="mt-1 text-[11px] leading-snug text-neutral-500">{c.detail}</p>
          </div>
        ))}
      </div>
      {q.healthy === false && (
        <p
          data-testid="reasoning-queue-unhealthy"
          className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200"
        >
          Karar kuyruğu sağlıksız: düşmüş iş var veya bekleyen işler birikmiş.
          Bu kararlar henüz üretilmedi — eksik karar, olumlu karar değildir.
        </p>
      )}
    </section>
  );
}

/**
 * Kuyruk zamanlayıcısı bölümü (059) — **her zaman gösterilir**.
 *
 * ⚠️ Zamanlayıcı olmadan kuyruk kartları yanıltıcıdır: "0 bekleyen iş" ile
 * "işleri işleyecek kimse yok" ekranda aynı görünürdü. Bu yüzden koşucunun
 * durumu kuyruğun hemen yanında ve GİZLENMEDEN durur.
 */
function SchedulerSection({ scheduler }: { scheduler?: SchedulerHealthRow | null }) {
  const s = buildSchedulerView(scheduler);

  return (
    <section
      data-testid="reasoning-scheduler"
      data-status={s.status}
      data-attention={s.attention ? 'true' : 'false'}
      className={`rounded-xl border p-3 ${
        s.attention
          ? 'border-amber-500/40 bg-amber-500/[0.06]'
          : 'border-neutral-800 bg-neutral-900/60'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold text-neutral-300">Kuyruk Koşucusu</p>
        <p
          data-testid="scheduler-status-label"
          className={`text-[11px] font-medium ${
            s.attention ? 'text-amber-200' : 'text-neutral-400'
          }`}
        >
          {s.label}
        </p>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-neutral-500">{s.detail}</p>
      {s.present && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-4">
          {/* Ölçülmeyen değer `—` — sahte `0` YOK. */}
          <Metric label="son koşum" value={ageText(s.lastRunAgeSeconds)} />
          <Metric
            label="işlenen iş"
            value={s.lastProcessed === null ? '—' : String(s.lastProcessed)}
          />
          <Metric
            label="koşum süresi"
            value={s.lastRunDurationMs === null ? '—' : `${Math.round(s.lastRunDurationMs)} ms`}
          />
          <Metric
            label="aralık"
            value={s.intervalSeconds === null ? '—' : `${s.intervalSeconds} sn`}
          />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-neutral-500">{label}</p>
      <p className="font-mono text-[12px] text-neutral-200">{value}</p>
    </div>
  );
}

export function ReasoningCards({
  summary, recent, queue, scheduler,
}: ReasoningCardsProps) {
  const v = buildReasoningView(summary, recent);

  if (!v.present) {
    return (
      <div className="flex flex-col gap-2">
        <AbsentDecisions v={v} />
        <QueueSection queue={queue} />
        <SchedulerSection scheduler={scheduler} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PresentDecisions v={v} />
      <QueueSection queue={queue} />
      <SchedulerSection scheduler={scheduler} />
    </div>
  );
}

function AbsentDecisions({ v }: { v: ReturnType<typeof buildReasoningView> }) {
  {
    return (
      <section
        data-testid="reasoning-absent"
        className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
      >
        <h3 className="mb-1 text-sm font-semibold text-neutral-100">Karar Motoru</h3>
        <p className="text-[12px] text-neutral-400">{reasoningAbsenceExplanation(v)}</p>
        {v.duplicateSuppressed !== null && v.duplicateSuppressed > 0 && (
          <p className="mt-1 text-[11px] text-neutral-500">
            {v.duplicateSuppressed} tekrar bastırıldı — aynı kanıtla ikinci kez
            düşünmek yeni karar açmaz
          </p>
        )}
      </section>
    );
  }
}

function PresentDecisions({ v }: { v: ReturnType<typeof buildReasoningView> }) {
  return (
    <section data-testid="reasoning-cards" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {v.cards.map((c) => (
          <div
            key={c.key}
            data-testid={`reasoning-card-${c.key}`}
            data-known={c.known ? 'true' : 'false'}
            data-attention={c.attention ? 'true' : 'false'}
            className={`rounded-xl border p-3 ${
              c.attention
                ? 'border-amber-500/40 bg-amber-500/[0.06]'
                : 'border-neutral-800 bg-neutral-900/60'
            }`}
          >
            <p className="text-[11px] text-neutral-400">{c.label}</p>
            <p className="mt-1 font-mono text-lg text-neutral-100">{valueText(c)}</p>
            <p className="mt-1 text-[11px] leading-snug text-neutral-500">{c.detail}</p>
          </div>
        ))}
      </div>

      {/* BÜTÜNLÜK — sonuçlandırıcı karar kanıtsız/çelişkili olamaz. */}
      {v.integrityOk === false && (
        <p
          data-testid="reasoning-integrity-broken"
          className="rounded-lg border border-red-500/40 bg-red-500/[0.06] px-3 py-2 text-[11px] text-red-300"
        >
          Karar bütünlüğü BOZUK: kanıtsız, güveni türetilememiş veya çelişkili
          bir karar sonuçlandırıcı görünüyor. Bu kararlara dayanılmamalıdır.
        </p>
      )}

      {/* Geçersiz durum geçişi sessizce yutulmaz. */}
      {v.invalidTransitions !== null && v.invalidTransitions > 0 && (
        <p className="text-[11px] text-neutral-500">
          {v.invalidTransitions} geçersiz durum geçişi reddedildi
          {v.duplicateSuppressed !== null && v.duplicateSuppressed > 0
            && ` · ${v.duplicateSuppressed} tekrar bastırıldı`}
        </p>
      )}

      {v.items.length > 0 && (
        <div data-testid="reasoning-recent" className="flex flex-col gap-1">
          {v.items.slice(0, 10).map((it) => (
            <div
              key={it.id}
              data-testid={`reasoning-item-${it.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] text-neutral-200">
                  {it.intent} · {reasoningDecisionExplanation(it.decision)}
                </p>
                <p className="truncate font-mono text-[10px] text-neutral-500">
                  {it.subjectRef} · {it.evidenceCount} kanıt
                  {it.conflictCount > 0 && ` · ${it.conflictCount} çelişki`}
                  {' · '}{ageText(it.ageSeconds)} önce
                </p>
              </div>
              <span
                data-conclusive={it.conclusive ? 'true' : 'false'}
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  it.conclusive
                    ? 'border-neutral-700 bg-neutral-800 text-neutral-200'
                    : 'border-neutral-800 bg-neutral-900 text-neutral-500'
                }`}
              >
                {it.confidence}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] leading-snug text-neutral-500">
        <strong>LLM karar vermez.</strong> Bu kartlar sunucunun verdiği kararı
        gösterir; burada model, tahmin veya öneri yoktur. Kanıtsız karar
        sonuçlandırıcı olamaz, çelişkili kanıtta karar üretilmez ve güven
        kanıtların en zayıf halkasından türetilir. Gerçek araç doğrulaması
        YAPILMADI.
      </p>
    </section>
  );
}

export default ReasoningCards;
