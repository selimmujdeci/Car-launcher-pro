/**
 * FleetPresenceHistoryScreen — CAROS LAB · Vehicle · PRESENCE HISTORY.
 *
 * Sürücü varlığının ZAMAN İÇİNDEKİ değişiminin SALT-OKUNUR gözlemi (§18).
 *
 * ── HANGİ SORUYU CEVAPLAR ──────────────────────────────────────────────
 * `Fleet Driver Identity` ekranı "ŞU AN kim araçta?" der. Bu ekran farklı
 * bir soruyu cevaplar: **"varlık nasıl değişti — kim geldi, ne kadar
 * kaldı, yerine kim geçti, kaç kez el değiştirdi?"**
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · gözlem üretme/kaydetme · segment kapatma/silme · sürücü seçme
 *   · ağ çağrısı · timer/abonelik kurma
 * Açılışta TEK okuma + elle YENİLE.
 *
 * ── GİZLİLİK (BAĞLAYICI) ───────────────────────────────────────────────
 *   · sürücü ADI GÖSTERİLMEZ — yalnız `drv:a1b2c3d4`
 *   · araç kimliği KISALTILIR — `veh:a1b2c3d4`
 *   · ehliyet / telefon / e-posta / kullanıcı kimliği YOK
 *   · MUTLAK zaman damgası YOK (yalnız yaş ve süre)
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, History, ArrowRightLeft, Clock, ShieldCheck,
  Database, Link2, AlertTriangle,
} from 'lucide-react';
import {
  readDriverPresenceHistory, readDriverPresenceDurability, isIdentityVerifying,
} from '../../../platform/fleet/driverPresence';
import {
  segmentStatus, segmentDurationMs, presenceSegmentStatusLabel,
  presenceCloseReasonLabel, PRESENCE_HISTORY_MAX_ENTRIES,
  type PresenceHistoryEntry, type PresenceHistorySummary,
} from '../../../platform/fleet/driverPresenceHistory';

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

/** Sürücü referansı — **AD DEĞİL** (ekran görüntüsü paylaşılabilir). */
function driverRef(id: string | null): string {
  if (id === null || id.length === 0) return UNAVAILABLE;
  return `drv:${id.slice(0, 8)}`;
}

function vehicleRef(id: string | null): string {
  if (id === null || id.length === 0) return UNAVAILABLE;
  return `veh:${id.slice(0, 8)}`;
}

/** Süre metni — bilinmiyorsa `UNAVAILABLE` (sahte `0 sn` YOK). */
function durationText(ms: number | null): string {
  if (ms === null) return UNAVAILABLE;
  if (ms < 1_000) return '<1 sn';
  if (ms < 60_000) return `${Math.floor(ms / 1_000)} sn`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} dk`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`;
}

/** Yaş — mutlak zaman damgası SIZDIRMAZ. */
function ago(atMs: number | null, nowMs: number): string {
  if (atMs === null) return UNAVAILABLE;
  return `${durationText(Math.max(0, nowMs - atMs))} önce`;
}

function statusTone(s: string): string {
  return s === 'OPEN' ? OK : s === 'TTL_EXPIRED' ? WARN : NONE;
}

/** Tek segment bloğu — current/previous ve defter listesi aynı biçimi kullanır. */
function SegmentBlock(
  { entry, nowMs }: { entry: PresenceHistoryEntry | null; nowMs: number },
) {
  if (entry === null) {
    return (
      <div className="flex flex-col">
        <Row label="driverRef"><Chip tone={NONE}>{UNAVAILABLE}</Chip></Row>
        <Row label="reason">gözlem yok</Row>
      </div>
    );
  }
  const st = segmentStatus(entry, nowMs);
  return (
    <div className="flex flex-col">
      {/* Sürücü ADI DEĞİL — bounded referans. */}
      <Row label="driverRef">{driverRef(entry.driverId)}</Row>
      <Row label="vehicleRef">{vehicleRef(entry.vehicleId)}</Row>
      <Row label="source">
        <Chip tone={isIdentityVerifying(entry.source) ? OK : NONE}>{entry.source}</Chip>
      </Row>
      <Row label="identityVerifying">
        <Chip tone={isIdentityVerifying(entry.source) ? OK : NONE}>
          {isIdentityVerifying(entry.source) ? 'EVET' : 'HAYIR'}
        </Chip>
      </Row>
      <Row label="confidence">
        {entry.confidence === 'UNKNOWN' ? UNAVAILABLE : (
          <Chip tone={
            entry.confidence === 'VERY_HIGH' || entry.confidence === 'HIGH' ? OK
            : entry.confidence === 'MEDIUM' ? INFO : NONE
          }>{entry.confidence}</Chip>
        )}
      </Row>
      <Row label="detectedAt">{ago(entry.detectedAt, nowMs)}</Row>
      <Row label="expiredAt">{ago(entry.expiredAt, nowMs)}</Row>
      <Row label="duration">{durationText(segmentDurationMs(entry, nowMs))}</Row>
      <Row label="status">
        <Chip tone={statusTone(st)}>{presenceSegmentStatusLabel(st)}</Chip>
      </Row>
      <Row label="closeReason">{presenceCloseReasonLabel(entry.closeReason)}</Row>
      {/* Tekrar okumalar YENİ segment üretmez — dedupe kanıtı. */}
      <Row label="refreshCount">{entry.refreshCount}</Row>
    </div>
  );
}

type Durability = ReturnType<typeof readDriverPresenceDurability>;

interface Snap {
  readonly summary: PresenceHistorySummary | null;
  readonly durability: Durability | null;
  readonly readAtMs: number;
}

/** Okuma fail-soft: defter düşse bile ekran çökmez. */
function readSnap(): Snap {
  const now = Date.now();
  let summary: PresenceHistorySummary | null = null;
  let durability: Durability | null = null;
  try { summary = readDriverPresenceHistory(now); } catch { summary = null; }
  /* Dayanıklılık okuması AYRI try içinde: biri düşerse diğeri yine gösterilir
     (tek bir hata tüm gözlem yüzeyini kör etmemeli). */
  try { durability = readDriverPresenceDurability(now); } catch { durability = null; }
  return { summary, durability, readAtMs: now };
}

/** Kalıcılık durumunun rengi — "iyi" sayılan TEK durum RESTORED'dır. */
function persistenceTone(s: string): string {
  if (s === 'RESTORED') return OK;
  if (s === 'EMPTY') return NONE;            // kayıt yok: arıza DEĞİL
  return WARN;                                // REJECTED · READ/WRITE_FAILED
}

function FleetPresenceHistoryScreenBase() {
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

  const h = snap?.summary ?? null;
  const d = snap?.durability ?? null;
  const now = snap?.readAtMs ?? 0;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">
            Presence History
          </h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. Gözlem üretmez, segment kapatmaz, ağ çağrısı yapmaz.
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

      {/* 1 · Defter özeti */}
      <Section title="Ledger Summary">
        <div className="flex flex-col">
          <Row label="switchCount">
            <Chip tone={h === null ? NONE : h.switchCount > 0 ? INFO : NONE}>
              <ArrowRightLeft size={11} className="mr-1" />
              {h?.switchCount ?? UNAVAILABLE}
            </Chip>
          </Row>
          <Row label="segmentCount">{h?.segmentCount ?? UNAVAILABLE}</Row>
          {/* Dedupe kanıtı: tekrar gözlemler segment ÜRETMEDİ. */}
          <Row label="deduplicatedObservations">{h?.duplicateCount ?? UNAVAILABLE}</Row>
          {/* Sınır aşımında düşen segment GİZLENMEZ. */}
          <Row label="droppedSegments">
            {h === null ? UNAVAILABLE
              : h.droppedCount === 0
                ? <Chip tone={OK}><ShieldCheck size={11} className="mr-1" />0</Chip>
                : <Chip tone={WARN}>{h.droppedCount}</Chip>}
          </Row>
          <Row label="maxLedgerEntries">{PRESENCE_HISTORY_MAX_ENTRIES}</Row>
          <Row label="latestSegmentStatus">
            {h === null || h.currentStatus === null ? UNAVAILABLE : (
              <Chip tone={statusTone(h.currentStatus)}>
                <Clock size={11} className="mr-1" />
                {presenceSegmentStatusLabel(h.currentStatus)}
              </Chip>
            )}
          </Row>
        </div>
      </Section>

      {/* 1b · DAYANIKLILIK (P2) — kalıcılık · süre dolumu · araç bağı */}
      <Section title="Durability (P2)">
        <div className="flex flex-col">
          {/* Kalıcılık: yeniden başlatmada defter geri geldi mi. */}
          <Row label="persistenceState">
            {d === null ? <Chip tone={NONE}>{UNAVAILABLE}</Chip> : (
              <Chip tone={persistenceTone(d.persistenceState)}>
                <Database size={11} className="mr-1" />{d.persistenceState}
              </Chip>
            )}
          </Row>
          {/* Geri yükleme anı uydurulmaz: saat bilinmiyorsa UNAVAILABLE. */}
          <Row label="lastRestore">{ago(d?.lastRestoreAtMs ?? null, now)}</Row>
          <Row label="restoredSegments">{d?.restoredSegmentCount ?? UNAVAILABLE}</Row>
          <Row label="snapshotSaved">{ago(d?.snapshotSavedAtMs ?? null, now)}</Row>

          {/* Süre dolumu: TIMER YOKTUR — kapanış tembeldir (zero-leak). */}
          <Row label="expiryMode">
            <Chip tone={INFO}>{d?.expiryMode ?? UNAVAILABLE}</Chip>
          </Row>
          <Row label="expiredSegmentCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.expiredSegmentCount > 0 ? WARN : NONE}>
                {d.expiredSegmentCount}
              </Chip>
            )}
          </Row>
          <Row label="openSegmentCount">{d?.openSegmentCount ?? UNAVAILABLE}</Row>

          {/* Araç bağı: gözlem yalnız DOĞRULANMIŞ araca yazılabilir. */}
          <Row label="vehicleBindingState">
            {d === null ? <Chip tone={NONE}>{UNAVAILABLE}</Chip> : (
              <Chip tone={d.vehicleBindingState === 'BOUND' ? OK : NONE}>
                <Link2 size={11} className="mr-1" />{d.vehicleBindingState}
              </Chip>
            )}
          </Row>
          {/* Tam araç kimliği SIZDIRILMAZ — bounded referans. */}
          <Row label="boundVehicleRef">{vehicleRef(d?.boundVehicleId ?? null)}</Row>
          <Row label="bindingRejectedCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.bindingRejectedCount > 0 ? WARN : NONE}>
                {d.bindingRejectedCount}
              </Chip>
            )}
          </Row>
          <Row label="lastRejectReason">{d?.lastRejectReason ?? UNAVAILABLE}</Row>
          {/* Tekrar oynatılan gözlemler: defteri değiştirmedi ama SAYILDI. */}
          <Row label="replayCount">{d?.replayCount ?? UNAVAILABLE}</Row>

          {/* Son arıza: bounded KOD (serbest metin/PII yok). */}
          <Row label="lastFailure">
            {d === null ? UNAVAILABLE
              : d.lastFailure === null
                ? <Chip tone={OK}><ShieldCheck size={11} className="mr-1" />YOK</Chip>
                : <Chip tone={WARN}>
                    <AlertTriangle size={11} className="mr-1" />{d.lastFailure}
                  </Chip>}
          </Row>
          <Row label="lastFailureAt">{ago(d?.lastFailureAtMs ?? null, now)}</Row>
        </div>
      </Section>

      {/* 2 · ŞU ANKİ segment */}
      <Section title="Current Presence">
        <div className="flex flex-col">
          <Row label="currentDuration">
            <Chip tone={h?.current == null ? NONE : OK}>
              {durationText(h?.currentDurationMs ?? null)}
            </Chip>
          </Row>
        </div>
        <SegmentBlock entry={h?.current ?? null} nowMs={now} />
      </Section>

      {/* 3 · ÖNCEKİ segment */}
      <Section title="Previous Presence">
        <div className="flex flex-col">
          <Row label="previousDuration">{durationText(h?.previousDurationMs ?? null)}</Row>
        </div>
        <SegmentBlock entry={h?.previous ?? null} nowMs={now} />
      </Section>

      {/* 4 · Defter (yeniden eskiye) */}
      <Section title="Ledger (newest first)">
        {h === null || h.entries.length === 0 ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Kayıt yok — bu cihazda hiç presence gözlemi üretilmedi.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {h.entries.slice(0, 10).map((e, i) => {
              const st = segmentStatus(e, now);
              return (
                <div
                  key={`${e.driverId}-${e.detectedAt}-${i}`}
                  className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1"
                >
                  <span className="text-[11px] font-mono text-[var(--oem-ink-1)]">
                    <History size={10} className="mr-1 inline" />
                    {driverRef(e.driverId)}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--oem-ink-3)]">
                    {e.source} · {durationText(segmentDurationMs(e, now))}
                  </span>
                  <Chip tone={statusTone(st)}>{presenceSegmentStatusLabel(st)}</Chip>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        Bu defter bir <strong>KARAR katmanı değildir</strong>: sürücü
        attribution kararını yalnız <code>resolveDriverPresence</code> verir
        ve o otorite bu ekranı <strong>görmez bile</strong>. Geçmiş kaydı
        hiçbir sürücüyü &quot;kanıtlanmış&quot; yapmaz. Açık bir segmentin
        süresi <em>kesin değildir</em> — kapanana kadar
        &quot;şimdiye kadar&quot; anlamındadır; kapanış anı bilinmiyorsa süre
        <strong> UYDURULMAZ</strong>, <code>UNAVAILABLE</code> kalır.
        <strong> Sürücü adı, ehliyet, telefon ve e-posta bu ekrana
        TAŞINMAZ.</strong> NFC/Bluetooth üreticisi bağlanmadığı için bu
        cihazda defter <strong>boştur</strong> — bu bir eksiklik değil,
        katmanın güvenlik tasarımıdır.
      </p>
    </div>
  );
}

export default memo(FleetPresenceHistoryScreenBase);
