/**
 * AiEvidenceEngineScreen — CAROS LAB · Vehicle · AI EVIDENCE ENGINE.
 *
 * Kanıt omurgasının SALT-OKUNUR gözlemi.
 *
 * ── BU EKRAN NE DEĞİLDİR ───────────────────────────────────────────────
 * Bir AI paneli DEĞİLDİR. Burada cevap, öneri veya cümle yoktur: kanıt bir
 * CÜMLE değil, kaynağı · kategorisi · öznesi · ölçüm kalitesi belli bir
 * KAYITTIR. Ekran "neyi kanıtlayabiliyoruz" ve **"neyi kanıtlayamıyoruz"**
 * sorusunu gösterir.
 *
 * ── HEAD UNIT'TE KANIT ÜRETİLMEZ (bilinçli) ────────────────────────────
 * Kanıt omurgası sunucuda yaşar (migration 055): kanıt uzun ömürlüdür ve
 * şirket geneli sorgulanır. Bu ekran yerel köprüyü okur; köprü bağlı
 * değilse **dürüstçe "kanıt yok" der**.
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · kanıt üretme/yazma · zincir kurma · süre kapatma · sunucuya yazma
 *   · ağ çağrısı · timer/abonelik kurma · LLM çağrısı
 * Açılışta TEK okuma + elle YENİLE.
 *
 * ── GİZLİLİK ───────────────────────────────────────────────────────────
 * Araç/sürücü ADI yok · plaka yok · VIN yok · konum yok — yalnız
 * kısaltılmış referans (`veh:xxxxxxxx`) ve metrik adı.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, ShieldCheck, ShieldAlert, Link2, Layers, HelpCircle,
  Clock, Gauge, Database,
} from 'lucide-react';
import { readAiEvidence } from '../../../platform/fleet/aiEvidenceEngine';
import {
  readUnknownInputStats, UNKNOWN_INPUT_FIELDS, type UnknownInputStats,
} from '../../../platform/reasoning/core/evidenceInputGuard';
import {
  readBatteryEvidenceStats, type BatteryEvidenceStats,
} from '../../../platform/reasoning/batteryEvidenceSource';
import {
  computeEvidenceCoverage,
} from '../../../platform/fleet/aiEvidenceEngine';
import {
  evidenceSourceLabel, evidenceCategoryLabel, evidenceStateLabel,
  evidenceRejectReasonLabel, evidenceConsumerLabel,
  type EvidenceConfidence,
} from '../../../platform/fleet/aiEvidence';
import type { AdapterResult } from '../../../platform/fleet/aiEvidenceEngine';

/** Adaptör sonucunun tonu — yalnız `REPORTED`/`DEDUPED` iyi sayılır. */
function adapterResultTone(r: AdapterResult): string {
  return r === 'REPORTED' || r === 'DEDUPED' ? OK
    : r === 'REJECTED' ? NONE : WARN;
}

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
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} dk`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} sa`;
  return `${Math.floor(ms / 86_400_000)} gün`;
}

function confidenceTone(c: EvidenceConfidence): string {
  return c === 'VERY_HIGH' || c === 'HIGH' ? OK
    : c === 'MEDIUM' ? INFO : c === 'LOW' ? WARN : NONE;
}

type Snap = {
  readonly data: ReturnType<typeof readAiEvidence> | null;
  readonly readAtMs: number;
  /** Tanınmayan girdi sayaçları (#497 madde 2) — aynı okumada alınır. */
  readonly guard: UnknownInputStats;
  /** Cihazda üretilen kanıt sayaçları (#490). */
  readonly local: BatteryEvidenceStats | null;
};

const EMPTY_GUARD: UnknownInputStats = {
  totalRejected: 0,
  byField: { category: 0, source: 0, severity: 0, provenance: 0, state: 0 },
  bySource: {},
  lastRejectedAtMs: null,
};

/** Okuma fail-soft: omurga düşse bile ekran çökmez. */
function readSnap(): Snap {
  const now = Date.now();
  /* Sayaç okuması kanıt omurgasından BAĞIMSIZ fail-soft: omurga düşse bile
     "kaç girdi anlaşılamadı" bilgisi kaybolmamalı — asıl arıza o olabilir. */
  let guard: UnknownInputStats = EMPTY_GUARD;
  try { guard = readUnknownInputStats(); } catch { /* sayaç yoksa boş kalır */ }
  /* Yerel üretim sayaçları sunucu köprüsünden BAĞIMSIZ okunur: ağ yokken de
     "cihaz kanıt üretiyor mu" sorusu cevaplanabilmeli. */
  let local: BatteryEvidenceStats | null = null;
  try { local = readBatteryEvidenceStats(); } catch { /* üretim yoksa null */ }
  try {
    return { data: readAiEvidence(now), readAtMs: now, guard, local };
  } catch {
    return { data: null, readAtMs: now, guard, local };
  }
}

function AiEvidenceEngineScreenBase() {
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
  const guard = snap?.guard ?? EMPTY_GUARD;
  const local = snap?.local ?? null;
  const now = snap?.readAtMs ?? 0;
  const entries = d?.ledger.entries ?? [];

  /* Kapsam örneği: defterdeki ilk aracın kanıt kapsamı (varsa). */
  const sampleVehicle = entries.find((e) => e.vehicleId !== null)?.vehicleId ?? null;
  const coverage = d !== null && sampleVehicle !== null
    ? computeEvidenceCoverage(d.ledger, 'VEHICLE', sampleVehicle, now) : null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">
            AI Evidence Engine
          </h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. Kanıt üretmez, zincir kurmaz, ağ çağrısı yapmaz.
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

      {/* 0a · CİHAZDA ÜRETİLEN KANIT — kütük #490
          Ağ YOK varsayımıyla çalışır. "Kaç kanıt üretildi, hangi sinyalden,
          hangi güvenle, ne zaman" burada okunur. DEĞER gösterilmez (voltajın
          kendisi kanıtın içindedir, LAB'a taşınmaz). */}
      <Section title="Local Evidence — device (no network)">
        <div className="flex flex-col">
          <Row label="signal">battery_voltage (OBD · ATRV)</Row>
          <Row label="produced">
            <Chip tone={local === null ? NONE : local.produced > 0 ? OK : NONE}>
              {local?.produced ?? UNAVAILABLE}
            </Chip>
          </Row>
          <Row label="samplesSeen">{local?.samplesSeen ?? UNAVAILABLE}</Row>
          <Row label="ledgerSize">{local?.ledgerSize ?? UNAVAILABLE}</Row>
          <Row label="rejectedByGuard">
            <Chip tone={(local?.rejectedByGuard ?? 0) > 0 ? WARN : NONE}>
              {local?.rejectedByGuard ?? UNAVAILABLE}
            </Chip>
          </Row>
          <Row label="lastProduced">
            {local?.lastProducedAtMs == null
              ? UNAVAILABLE
              : durationText(Math.max(0, now - local.lastProducedAtMs))}
          </Row>
          {local !== null && Object.keys(local.bySeverity).sort().map((k) => (
            <Row key={`sev-${k}`} label={`severity:${k}`}>{local.bySeverity[k]}</Row>
          ))}
          {local !== null && Object.keys(local.bySkipReason).sort().map((k) => (
            <Row key={`skip-${k}`} label={`skipped:${k}`}>{local.bySkipReason[k]}</Row>
          ))}
          <Row label="policy">{local?.policyVersion ?? UNAVAILABLE}</Row>
          {/* KAPSAM SINIRI — ürün kuralı, gizlenmez. */}
          <Row label="scope">
            <span className="text-[var(--oem-warn)]">
              yalnız AKÜ · araç sağlığı DEĞİL
            </span>
          </Row>
        </div>
      </Section>

      {/* 0 · TANINMAYAN GİRDİ — kütük #497 madde 2
          "Bilgimiz yok" ile "kanıt geldi ama ANLAYAMADIK" ayrı şeylerdir;
          ikincisi bir ARIZA sinyalidir (şema sürüklenmesi · bozuk veri).
          Sessiz düşüş bu ayrımı yok ederdi. Reddedilen DEĞER taşınmaz —
          yalnız hangi alan, kaç adet, hangi kaynaktan. */}
      <Section title="Rejected Input (unknown enum)">
        <div className="flex flex-col">
          <Row label="totalRejected">
            <Chip tone={guard.totalRejected > 0 ? WARN : OK}>
              {guard.totalRejected}
            </Chip>
          </Row>
          {guard.totalRejected === 0 ? (
            <Row label="status">
              <span className="text-[var(--oem-ink-2)]">
                tanınmayan girdi yok
              </span>
            </Row>
          ) : (
            <>
              {UNKNOWN_INPUT_FIELDS.filter((f) => guard.byField[f] > 0).map((f) => (
                <Row key={f} label={`field:${f}`}>{guard.byField[f]}</Row>
              ))}
              {Object.keys(guard.bySource).sort().map((s) => (
                <Row key={s} label={`from:${s}`}>{guard.bySource[s]}</Row>
              ))}
              <Row label="lastRejected">
                {guard.lastRejectedAtMs === null
                  ? UNAVAILABLE
                  : durationText(Math.max(0, now - guard.lastRejectedAtMs))}
              </Row>
            </>
          )}
        </div>
      </Section>

      {/* 1 · SAYAÇLAR VE BÜTÜNLÜK */}
      <Section title="Evidence & Integrity">
        <div className="flex flex-col">
          <Row label="source">
            <Chip tone={d?.source === 'SERVER' ? OK : NONE}>{d?.source ?? UNAVAILABLE}</Chip>
          </Row>
          <Row label="evidenceCount">
            <Chip tone={d === null ? NONE : INFO}>
              <Database size={11} className="mr-1" />{d?.evidenceCount ?? UNAVAILABLE}
            </Chip>
          </Row>
          <Row label="activeCount">{d?.activeCount ?? UNAVAILABLE}</Row>
          <Row label="expiredCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.expiredCount > 0 ? WARN : NONE}>
                <Clock size={11} className="mr-1" />{d.expiredCount}
              </Chip>
            )}
          </Row>
          <Row label="rejectedCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.rejectedCount > 0 ? WARN : NONE}>{d.rejectedCount}</Chip>
            )}
          </Row>
          {/* Güveni türetilememiş kanıtlar GİZLENMEZ. */}
          <Row label="unknownConfidenceCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.unknownConfidenceCount > 0 ? WARN : OK}>
                <HelpCircle size={11} className="mr-1" />{d.unknownConfidenceCount}
              </Chip>
            )}
          </Row>
          <Row label="mergeCount">{d?.mergeCount ?? UNAVAILABLE}</Row>
          <Row label="refreshTotal">{d?.refreshTotal ?? UNAVAILABLE}</Row>
          {/* En eski kanıtın yaşı — omurganın ne kadar zamandır öğrendiği. */}
          <Row label="oldestEvidenceAge">
            {durationText(entries.length === 0 ? null
              : Math.max(0, now - Math.min(...entries.map((e) => e.createdAt))))}
          </Row>
          {/* BÜTÜNLÜK: kaynağı/güveni bilinmeyen ACTIVE kanıt olmamalı. */}
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

      {/* 1b · ÜRETİM ADAPTÖRLERİ (P1 wiring) */}
      <Section title="Source Adapters">
        <div className="flex flex-col">
          {/* Kaç adaptör GERÇEKTEN kanıt üretmiş — kaynak kapsamı. */}
          <Row label="sourceCoverage">
            {d?.sourceCoverage == null ? UNAVAILABLE
              : `%${Math.round(d.sourceCoverage * 100)}`}
          </Row>
          <Row label="orphanChainCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.orphanChainCount > 0 ? WARN : OK}>{d.orphanChainCount}</Chip>
            )}
          </Row>
          <Row label="retryPendingCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.retryPendingTotal > 0 ? WARN : OK}>{d.retryPendingTotal}</Chip>
            )}
          </Row>
        </div>
        {d === null || d.adapters.length === 0 ? (
          <p className="mt-2 text-[11px] text-[var(--oem-ink-3)]">
            Adaptör durumu yok — bu cihazda kanıt üretilmiyor (üretim
            sunucudadır).
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            {d.adapters.map((a) => (
              <div key={a.source}
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-[var(--oem-ink-1)]">
                    {evidenceSourceLabel(a.source)}
                  </span>
                  <Chip tone={adapterResultTone(a.lastResult)}>{a.lastResult}</Chip>
                </div>
                <div className="mt-1 text-[10px] font-mono text-[var(--oem-ink-3)]">
                  {a.evidenceCount} kanıt · bildirilen {a.reportedCount}
                  {' · '}tekrar {a.dedupedCount} · reddedilen {a.rejectedCount}
                  {' · '}düşen {a.degradedCount} · bekleyen {a.retryPendingCount}
                  {' · '}öksüz zincir {a.orphanChainCount}
                  {' · '}son olay {durationText(a.lastEventAtMs === null
                    ? null : Math.max(0, now - a.lastEventAtMs))} önce
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2 · KAYNAK DAĞILIMI */}
      <Section title="Evidence Sources">
        {d === null || d.sourceBreakdown.length === 0 ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Kaynak yok — bu cihazda kanıt üretilmiyor.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {d.sourceBreakdown.map((s) => (
              <div key={s.source}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {evidenceSourceLabel(s.source)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-[var(--oem-ink-2)]">{s.count}</span>
                  {/* Kaynaksız kanıt ACTIVE olamaz — varsa uyarı. */}
                  {s.source === 'SOURCE_UNKNOWN' && (
                    <Chip tone={WARN}>KAYNAKSIZ</Chip>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 3 · KAPSAM */}
      <Section title="Coverage">
        <div className="flex flex-col">
          <Row label="coverageSubject">{shortRef('veh', sampleVehicle)}</Row>
          {/* Kanıt yoksa oran NULL — 0 DEĞİL ("hiç bakmadık" ≠ "sıfır ölçtük"). */}
          <Row label="coverage">
            {coverage?.ratio == null ? UNAVAILABLE
              : `%${Math.round(coverage.ratio * 100)}`}
          </Row>
          <Row label="coverageConfidence">
            {coverage === null ? UNAVAILABLE : (
              <Chip tone={confidenceTone(coverage.confidence)}>
                <Gauge size={11} className="mr-1" />{coverage.confidence}
              </Chip>
            )}
          </Row>
          <Row label="missingCategories">
            {coverage === null || coverage.missingCategories.length === 0
              ? UNAVAILABLE
              : coverage.missingCategories.map(evidenceCategoryLabel).join(' · ')}
          </Row>
        </div>
      </Section>

      {/* 4 · KANIT ZİNCİRİ */}
      <Section title="Evidence Chain">
        <div className="flex flex-col">
          <Row label="chainLinkCount">
            <Chip tone={d === null ? NONE : INFO}>
              <Link2 size={11} className="mr-1" />{d?.chainLinkCount ?? UNAVAILABLE}
            </Chip>
          </Row>
        </div>
        {d !== null && d.ledger.chain.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {d.ledger.chain.slice(0, 8).map((l) => (
              <div key={`${l.consumer}-${l.consumerId}-${l.evidenceId}`}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {evidenceConsumerLabel(l.consumer)} · {l.consumerId.slice(0, 12)}
                </span>
                <span className="text-[10px] font-mono text-[var(--oem-ink-3)]">
                  ← {l.evidenceId.slice(0, 24)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 5 · KANIT DEFTERİ */}
      <Section title="Ledger">
        {entries.length === 0 ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Kanıt yok — bu cihazda kanıt üretilmedi. <strong>Kaynaksız,
            öznesiz veya ölçümsüz bir kayıt kanıt sayılmaz.</strong>
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {entries.slice(0, 10).map((e) => (
              <div key={e.id}
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-[var(--oem-ink-1)]">
                    {evidenceCategoryLabel(e.category)} · {e.metric}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Chip tone={confidenceTone(e.confidence)}>{e.confidence}</Chip>
                    <Chip tone={e.state === 'ACTIVE' ? OK : NONE}>
                      {evidenceStateLabel(e.state)}
                    </Chip>
                  </span>
                </div>
                <div className="mt-1 text-[10px] font-mono text-[var(--oem-ink-3)]">
                  <Layers size={10} className="mr-1 inline" />
                  {evidenceSourceLabel(e.source)} · {shortRef('veh', e.vehicleId)}
                  {' · '}{e.value === null ? UNAVAILABLE : e.value}
                  {' · '}{e.sampleCount} örnek · tazeleme {e.refreshCount}
                  {' · v'}{e.evidenceVersion}
                  {e.rejectReason !== null
                    && ` · ${evidenceRejectReasonLabel(e.rejectReason)}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        <strong>Bu katman AI cevabı ÜRETMEZ.</strong> Burada model, tahmin,
        öneri veya doğal dil yoktur — kanıt bir cümle değil, <strong>kaynağı
        ve ölçüm kalitesi belli bir kayıttır</strong>.
        <strong> Kaynaksız kanıt geçerli olamaz</strong> (hangi modülden
        geldiği bilinmeyen bir iddia kanıt sayılmaz) ve <strong>güven
        dışarıdan yazılamaz</strong>: kaynak · ölçüm kalitesi · örnek
        sayısının en zayıf halkasından türetilir. Kanıt <strong>değişmezdir</strong>
        ve süresi dolunca <strong>silinmez</strong> — geçmiş bir iddianın
        dayanağı yok edilirse o iddia açıklanamaz hâle gelir. Kapsam oranı
        <code> UNAVAILABLE</code> ise bu &quot;sıfır ölçtük&quot; değil,
        <strong> &quot;hiç bakmadık&quot;</strong> demektir. Üretim
        sunucudadır; köprü bağlı değilse bu ekran boş görünür. Gerçek araç
        doğrulaması YAPILMADI.
      </p>
    </div>
  );
}

export default memo(AiEvidenceEngineScreenBase);
