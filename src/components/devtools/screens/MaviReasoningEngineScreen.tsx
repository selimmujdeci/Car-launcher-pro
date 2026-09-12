/**
 * MaviReasoningEngineScreen — CAROS LAB · AI · MAVI REASONING ENGINE.
 *
 * Tek karar otoritesinin SALT-OKUNUR gözlemi.
 *
 * ── BU EKRAN NE DEĞİLDİR ───────────────────────────────────────────────
 * Bir AI paneli DEĞİLDİR. Burada cevap, öneri veya cümle yoktur: bir karar
 * bir CÜMLE değil, niyeti · dayanağı · güveni ve gerekçesi belli bir
 * KAYITTIR. Ekran "neye karar verebildik" kadar **"neye karar
 * VEREMEDİĞİMİZİ"** de gösterir — bilinmeyen, çelişkili ve süresi dolmuş
 * kararlar gizlenmez.
 *
 * ── HEAD UNIT'TE KARAR ÜRETİLMEZ (bilinçli) ────────────────────────────
 * Karar omurgası sunucuda yaşar (migration 057): karar şirket geneli
 * sorgulanır ve kanıt omurgasının yanında durmalıdır. Bu ekran yerel
 * köprüyü okur; köprü bağlı değilse **dürüstçe "karar yok" der**.
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · karar üretme/yazma · durum ilerletme · süre kapatma · sunucuya yazma
 *   · ağ çağrısı · timer/abonelik kurma · **LLM çağrısı**
 * Açılışta TEK okuma + elle YENİLE.
 *
 * ── GİZLİLİK ───────────────────────────────────────────────────────────
 * Araç/sürücü ADI yok · plaka yok · VIN yok · konum yok — yalnız
 * kısaltılmış referans (`veh:xxxxxxxx`) ve bounded kodlar.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, ShieldCheck, ShieldAlert, GitBranch, Scale, HelpCircle,
  Clock, Layers, AlertTriangle, Ban, Inbox, Workflow, Timer,
} from 'lucide-react';
import { readMaviReasoning } from '../../../platform/reasoning/maviReasoningEngine';
import {
  confidenceReasonLabel, reasoningDecisionLabel, reasoningIntentLabel,
  reasoningStateLabel,
  type ReasoningConfidence, type ReasoningDecision,
} from '../../../platform/reasoning/maviReasoning';
import {
  eventSkipReasonLabel, reasoningEventStateLabel, reasoningEventTypeLabel,
  reasoningResolverLabel,
  type ReasoningEventState,
} from '../../../platform/reasoning/maviReasoningQueue';
import {
  schedulerOutcomeLabel, schedulerStatus, schedulerStatusLabel,
  type SchedulerStatus,
} from '../../../platform/reasoning/maviReasoningSchedule';

/* ── OEM tokenlar ──────────────────────────────────────────────────────── */

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';
const INFO = 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]';

const UNAVAILABLE = 'UNAVAILABLE';

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--oem-line)] py-1.5 last:border-b-0">
      <span className="text-[12px] text-[var(--oem-ink-3)]">{label}</span>
      <span className="text-[12px] font-mono text-[var(--oem-ink-1)] text-right">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--oem-line)] bg-[var(--oem-surface-1)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--oem-ink-2)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function shortRef(prefix: string, id: string | null): string {
  if (id === null || id.length === 0) return UNAVAILABLE;
  return `${prefix}:${id.slice(0, 8)}`;
}

function durationText(ms: number | null): string {
  if (ms === null) return UNAVAILABLE;
  if (ms < 60_000) return `${Math.floor(ms / 1000)} sn`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} dk`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} sa`;
  return `${Math.floor(ms / 86_400_000)} gün`;
}

function confidenceTone(c: ReasoningConfidence): string {
  return c === 'VERY_HIGH' || c === 'HIGH' ? OK
    : c === 'MEDIUM' ? INFO : c === 'LOW' ? WARN : NONE;
}

/** Yalnız `SUPPORTED`/`UNSUPPORTED` bir bilgi taşır; diğerleri bilinmezliktir. */
function decisionTone(d: ReasoningDecision): string {
  if (d === 'SUPPORTED') return OK;
  if (d === 'UNSUPPORTED') return WARN;
  if (d === 'CONFLICTED_EVIDENCE') return WARN;
  return NONE;
}

/**
 * Kuyruk durumunun tonu.
 *
 * ⚠️ `SKIPPED` ve `DEDUPED` **hata değildir**: ilki "özne yoktu, karar
 * uydurmadık", ikincisi "aynı iş zaten bekliyordu". Yalnız `FAILED` uyarıdır.
 */
function eventStateTone(s: ReasoningEventState): string {
  if (s === 'COMPLETED') return OK;
  if (s === 'FAILED') return WARN;
  if (s === 'RUNNING' || s === 'PENDING' || s === 'RETRY_PENDING') return INFO;
  return NONE;
}

/**
 * Zamanlayıcı durumunun tonu.
 *
 * ⚠️ `NOT_READ` ve `INTERVAL_UNKNOWN` uyarı DEĞİL nötrdür: ikisi de bizim
 * körlüğümüzdür, sistemin arızası değil. `NOT_SCHEDULED` ise gerçek arızadır
 * — koşucu hiç çalışmayacak demektir.
 */
function schedulerTone(s: SchedulerStatus): string {
  if (s === 'HEALTHY') return OK;
  if (s === 'NOT_INSTALLED' || s === 'NOT_SCHEDULED'
      || s === 'FAILING' || s === 'OVERDUE') return WARN;
  if (s === 'NEVER_RUN') return INFO;
  return NONE;
}

/** Saniye ölçümü — bilinmiyorsa UNAVAILABLE (sahte `0` YOK). */
function secondsText(s: number | null): string {
  if (s === null) return UNAVAILABLE;
  if (s < 90) return `${Math.round(s)} sn`;
  if (s < 5400) return `${(s / 60).toFixed(1)} dk`;
  return `${(s / 3600).toFixed(1)} sa`;
}

/** Milisaniye ölçümü — bilinmiyorsa UNAVAILABLE (sahte `0` YOK). */
function msText(ms: number | null): string {
  if (ms === null) return UNAVAILABLE;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} sn`;
}

type Snap = {
  readonly data: ReturnType<typeof readMaviReasoning> | null;
  readonly readAtMs: number;
};

/** Okuma fail-soft: omurga düşse bile ekran çökmez. */
function readSnap(): Snap {
  const now = Date.now();
  try {
    return { data: readMaviReasoning(now), readAtMs: now };
  } catch {
    return { data: null, readAtMs: now };
  }
}

function MaviReasoningEngineScreenBase() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readSnap();
    if (!mountedRef.current) return;   // unmount sonrası setState YOK
    setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                          // açılışta TEK okuma; timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const d = snap?.data ?? null;
  const entries = d?.ledger.entries ?? [];

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">
            MAVI Reasoning Engine
          </h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. Karar üretmez, durum ilerletmez, LLM çağırmaz.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2 py-1 text-[11px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={12} /> YENİLE
        </button>
      </div>

      {/* 1 · SAYAÇLAR VE BÜTÜNLÜK */}
      <Section title="Decisions & Integrity">
        <div className="flex flex-col">
          <Row label="source">
            <Chip tone={d?.source === 'SERVER' ? OK : NONE}>{d?.source ?? UNAVAILABLE}</Chip>
          </Row>
          <Row label="reasoningCount">
            <Chip tone={d === null ? NONE : INFO}>
              <Scale size={11} className="mr-1" />{d?.reasoningCount ?? UNAVAILABLE}
            </Chip>
          </Row>
          <Row label="validCount">{d?.validCount ?? UNAVAILABLE}</Row>
          {/* Çelişki gizlenmez: karar üretilememiş olması bir bilgidir. */}
          <Row label="conflictCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.conflictedCount > 0 ? WARN : OK}>
                <AlertTriangle size={11} className="mr-1" />{d.conflictedCount}
              </Chip>
            )}
          </Row>
          <Row label="unknownCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.unknownCount > 0 ? WARN : OK}>
                <HelpCircle size={11} className="mr-1" />{d.unknownCount}
              </Chip>
            )}
          </Row>
          <Row label="expiredEvidenceCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.expiredEvidenceCount > 0 ? WARN : NONE}>
                {d.expiredEvidenceCount}
              </Chip>
            )}
          </Row>
          <Row label="expiredCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.expiredCount > 0 ? WARN : NONE}>
                <Clock size={11} className="mr-1" />{d.expiredCount}
              </Chip>
            )}
          </Row>
          <Row label="rejectedCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.rejectedCount > 0 ? WARN : NONE}>
                <Ban size={11} className="mr-1" />{d.rejectedCount}
              </Chip>
            )}
          </Row>
          {/* Bastırılan tekrar SESSİZCE YUTULMAZ. */}
          <Row label="duplicateSuppressed">{d?.duplicateCount ?? UNAVAILABLE}</Row>
          <Row label="invalidTransitions">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.invalidTransitionCount > 0 ? WARN : OK}>
                {d.invalidTransitionCount}
              </Chip>
            )}
          </Row>
          <Row label="evidenceRefCount">{d?.evidenceRefCount ?? UNAVAILABLE}</Row>
          {/* Karar yoksa yaş BİLİNMEZ (0 DEĞİL — "hiç karar verilmedi"). */}
          <Row label="newestDecisionAge">{durationText(d?.newestDecisionAgeMs ?? null)}</Row>
          <Row label="oldestDecisionAge">{durationText(d?.oldestDecisionAgeMs ?? null)}</Row>
          {/* BÜTÜNLÜK: sonuçlandırıcı karar kanıtsız/güvensiz olamaz. */}
          <Row label="integrityOk">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.integrityOk ? OK : WARN}>
                {d.integrityOk
                  ? <ShieldCheck size={11} className="mr-1" />
                  : <ShieldAlert size={11} className="mr-1" />}
                {d.integrityOk ? 'SAĞLAM' : 'BOZUK'}
              </Chip>
            )}
          </Row>
        </div>
      </Section>

      {/* 1b · ÜRETİM OLAY KUYRUĞU (P1 wiring) */}
      <Section title="Live Event Queue">
        <div className="flex flex-col">
          <Row label="pending">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.queue.pending > 0 ? INFO : NONE}>
                <Inbox size={11} className="mr-1" />{d.queue.pending}
              </Chip>
            )}
          </Row>
          <Row label="running">{d?.queue.running ?? UNAVAILABLE}</Row>
          <Row label="completed">{d?.queue.completed ?? UNAVAILABLE}</Row>
          <Row label="failed">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.queue.failed > 0 ? WARN : OK}>{d.queue.failed}</Chip>
            )}
          </Row>
          <Row label="retryPending">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.queue.retryPending > 0 ? WARN : NONE}>
                {d.queue.retryPending}
              </Chip>
            )}
          </Row>
          <Row label="rejected">{d?.queue.rejected ?? UNAVAILABLE}</Row>
          {/* Atlanan iş bir hata DEĞİLDİR: özne yoktu, karar uydurulmadı. */}
          <Row label="skipped">{d?.queue.skipped ?? UNAVAILABLE}</Row>
          <Row label="dedupedEvents">{d?.queue.deduped ?? UNAVAILABLE}</Row>
          {/* Bastırılan tekrarlar SESSİZCE YUTULMAZ. */}
          <Row label="suppressedEvents">{d?.queue.suppressedTotal ?? UNAVAILABLE}</Row>
          {/* Ölçüm yoksa UNAVAILABLE — "0 ms" demek yanlış olurdu. */}
          <Row label="avgQueueTime">{msText(d?.queue.avgQueueMs ?? null)}</Row>
          <Row label="avgDecisionTime">{msText(d?.queue.avgDecisionMs ?? null)}</Row>
          <Row label="queueHealthy">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.queue.healthy ? OK : WARN}>
                {d.queue.healthy ? 'SAĞLIKLI' : 'BİRİKME/DÜŞME VAR'}
              </Chip>
            )}
          </Row>
        </div>
        {d === null || d.queue.events.length === 0 ? (
          <p className="mt-2 text-[11px] text-[var(--oem-ink-3)]">
            Olay yok — bu cihazda karar tetiklenmiyor (üretim sunucudadır).
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            {d.queue.events.slice(0, 8).map((e) => (
              <div key={e.id}
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-[var(--oem-ink-1)]">
                    {reasoningEventTypeLabel(e.eventType)}
                  </span>
                  <Chip tone={eventStateTone(e.state)}>
                    {reasoningEventStateLabel(e.state)}
                  </Chip>
                </div>
                <div className="mt-1 text-[10px] font-mono text-[var(--oem-ink-3)]">
                  <Workflow size={10} className="mr-1 inline" />
                  {reasoningResolverLabel(e.resolver)} · {e.intent}
                  {' · kuyruk '}{msText(e.queueMs)} · karar {msText(e.decisionMs)}
                  {e.attempts > 1 && ` · deneme ${e.attempts}`}
                  {e.suppressedCount > 0 && ` · bastırılan ${e.suppressedCount}`}
                  {e.skipReason !== null && ` · ${eventSkipReasonLabel(e.skipReason)}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 1c · KUYRUK ZAMANLAYICISI (059)
          ⚠️ Bölüm koşum yokken de gösterilir: "hiç koşmadı" ile "koşuyor ama
          iş bulamıyor" farklı arızalardır ve ikisi de görünmek zorundadır. */}
      <Section title="Queue Scheduler">
        <div className="flex flex-col">
          <Row label="status">
            {d === null ? UNAVAILABLE : (
              <Chip tone={schedulerTone(schedulerStatus(d.schedule, d.scheduleRead))}>
                <Timer size={11} className="mr-1" />
                {schedulerStatusLabel(schedulerStatus(d.schedule, d.scheduleRead))}
              </Chip>
            )}
          </Row>
          {/* Zamanlanmamış koşucu = kuyruk hiç boşalmaz (058 açık borcu #280). */}
          <Row label="jobScheduled">
            {d === null || !d.scheduleRead ? UNAVAILABLE : (
              <Chip tone={d.schedule.jobScheduled ? OK : WARN}>
                {d.schedule.jobScheduled ? 'EVET' : 'HAYIR'}
              </Chip>
            )}
          </Row>
          <Row label="scheduleExpression">
            {d === null || d.schedule.scheduleExpression === null
              ? UNAVAILABLE : d.schedule.scheduleExpression}
          </Row>
          {/* Aralık YALNIZ bilinen ifadeden türetilir — tahmin edilmez. */}
          <Row label="intervalSeconds">{secondsText(d?.schedule.intervalSeconds ?? null)}</Row>
          <Row label="lastRunAge">{secondsText(d?.schedule.lastRunAgeSeconds ?? null)}</Row>
          <Row label="lastRunOutcome">
            {d === null || d.schedule.lastRunOutcome === null ? UNAVAILABLE
              : schedulerOutcomeLabel(d.schedule.lastRunOutcome)}
          </Row>
          <Row label="lastRunDuration">{msText(d?.schedule.lastRunDurationMs ?? null)}</Row>
          {/* Ölçülmeyen sayaç UNAVAILABLE — sahte "0 iş" YOK. */}
          <Row label="lastProcessed">
            {d === null || d.schedule.lastProcessed === null
              ? UNAVAILABLE : d.schedule.lastProcessed}
          </Row>
          <Row label="lastExpired">
            {d === null || d.schedule.lastExpired === null
              ? UNAVAILABLE : d.schedule.lastExpired}
          </Row>
          <Row label="consecutiveFailures">
            {d === null || !d.scheduleRead ? UNAVAILABLE : (
              <Chip tone={d.schedule.consecutiveFailureCount > 0 ? WARN : OK}>
                {d.schedule.consecutiveFailureCount}
              </Chip>
            )}
          </Row>
          {/* ÜÇ DEĞERLİ: ölçülemeyen gecikme "gecikmiyor" DEMEK DEĞİLDİR. */}
          <Row label="overdue">
            {d === null || d.schedule.overdue === null ? UNAVAILABLE : (
              <Chip tone={d.schedule.overdue ? WARN : OK}>
                {d.schedule.overdue ? 'EVET' : 'HAYIR'}
              </Chip>
            )}
          </Row>
          <Row label="runTotal">
            {d === null || !d.scheduleRead ? UNAVAILABLE : d.schedule.runTotal}
          </Row>
        </div>
        {d === null || !d.scheduleRead ? (
          <p className="mt-2 text-[11px] text-[var(--oem-ink-3)]">
            Zamanlayıcı sunucudan okunmadı — bu bir sağlık raporu DEĞİLDİR.
          </p>
        ) : null}
      </Section>

      {/* 2 · NİYET DAĞILIMI */}
      <Section title="Intents">
        {d === null || d.intentBreakdown.length === 0 ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Niyet yok — bu cihazda karar üretilmiyor (üretim sunucudadır).
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {d.intentBreakdown.map((i) => (
              <div key={i.intent}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {reasoningIntentLabel(i.intent)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-[var(--oem-ink-2)]">{i.count}</span>
                  {/* Niyeti çözülemeyen karar bir başarı değildir. */}
                  {i.intent === 'UNKNOWN' && <Chip tone={WARN}>NİYET YOK</Chip>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 3 · KARAR DAĞILIMI */}
      <Section title="Decision Breakdown">
        {d === null || d.decisionBreakdown.length === 0 ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">Karar yok.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {d.decisionBreakdown.map((x) => (
              <div key={x.decision}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {reasoningDecisionLabel(x.decision)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Chip tone={decisionTone(x.decision)}>{x.decision}</Chip>
                  <span className="text-[11px] font-mono text-[var(--oem-ink-2)]">{x.count}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 4 · KARAR DEFTERİ VE ZİNCİR UÇLARI */}
      <Section title="Reasoning Ledger">
        {entries.length === 0 ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Karar yok — bu cihazda karar üretilmedi. <strong>Kanıtsız,
            çelişkili veya niyeti çözülemeyen bir kayıt sonuçlandırıcı karar
            sayılmaz.</strong>
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {entries.slice(0, 10).map((r) => (
              <div key={r.reasoningId}
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-[var(--oem-ink-1)]">
                    {reasoningIntentLabel(r.intent)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Chip tone={confidenceTone(r.confidence)}>{r.confidence}</Chip>
                    <Chip tone={decisionTone(r.decision)}>
                      {reasoningStateLabel(r.state)}
                    </Chip>
                  </span>
                </div>
                <div className="mt-1 text-[10px] font-mono text-[var(--oem-ink-3)]">
                  <Layers size={10} className="mr-1 inline" />
                  {r.decision} · {shortRef('veh', r.vehicleId)}
                  {' · '}{shortRef('drv', r.driverId)}
                  {' · '}{r.evidenceIds.length} kanıt
                  {' · v'}{r.reasoningVersion}
                </div>
                {/* Gerekçe bounded KOD — serbest metin DEĞİL. */}
                <div className="mt-0.5 text-[10px] text-[var(--oem-ink-3)]">
                  <GitBranch size={10} className="mr-1 inline" />
                  {confidenceReasonLabel(r.confidenceReason)}
                  {r.insightIds.length > 0 && ` · içgörü ${r.insightIds.length}`}
                  {r.dnaIds.length > 0 && ` · DNA ${r.dnaIds.length}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        <strong>LLM KARAR VERMEZ.</strong> Bu katmanda model, tahmin, öneri
        veya doğal dil yoktur; LLM yalnız burada <strong>zaten verilmiş</strong>
        kararı cümleye çevirir. <strong>Karar kanıtsız üretilemez</strong> —
        &quot;veri yok, o hâlde sorun yok&quot; bir karar değildir.
        <strong> Güven dışarıdan yazılamaz</strong>: kanıtların en zayıf
        halkasından türetilir (formül kanıt omurgasından gelir, burada
        yeniden yazılmaz) ve tek kanıtlı karar <code>MEDIUM</code> tavanını
        aşamaz. <strong>Çelişkili kanıtta karar üretilmez</strong>: iki
        kaynağın çeliştiği yerde birini seçmek uydurmaktır.
        <strong> Süresi dolan karar silinmez</strong> — geçmişte verilmiş bir
        kararın dayanağı yok edilirse o karar açıklanamaz hâle gelir. Aynı
        kanıtla ikinci kez düşünmek <strong>yeni karar açmaz</strong>.
        Üretim sunucudadır; köprü bağlı değilse bu ekran boş görünür. Gerçek
        araç doğrulaması YAPILMADI.
      </p>
    </div>
  );
}

export default memo(MaviReasoningEngineScreenBase);
