/**
 * FleetIntelligenceScreen — CAROS LAB · Vehicle · FLEET INTELLIGENCE.
 *
 * Filo zekâsı altyapısının SALT-OKUNUR gözlemi.
 *
 * ── BU EKRAN NE DEĞİLDİR ───────────────────────────────────────────────
 * Bir öneri/uyarı paneli DEĞİLDİR. Burada cümle yoktur: bir içgörü, kanıt
 * kümesidir. Ekran "ne bildiğimizi" ve **"ne kadarını bilmediğimizi"**
 * gösterir.
 *
 * ── HEAD UNIT'TE FİLO ZEKÂSI ÜRETİLMEZ (bilinçli) ──────────────────────
 * Filo iddiası FİLO düzeyinde kanıt ister; tek bir araç kendi başına filo
 * hakkında bir şey söyleyemez. Üretim sunucudadır (migration 054); bu ekran
 * yerel köprüyü okur ve köprü bağlı değilse **dürüstçe "veri yok" der**.
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · içgörü üretme/yazma · kanıt ekleme · trend hesaplama · sunucuya yazma
 *   · ağ çağrısı · timer/abonelik kurma · LLM çağrısı
 * Açılışta TEK okuma + elle YENİLE.
 *
 * ── GİZLİLİK ───────────────────────────────────────────────────────────
 * Araç/sürücü ADI yok · plaka yok · VIN yok · konum/rota yok — kanıt
 * satırları yalnız kısaltılmış referans (`veh:xxxxxxxx`) ile gösterilir.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Brain, Layers, TrendingUp, HelpCircle, Gauge, Activity, Clock,
} from 'lucide-react';
import { readFleetIntelligence } from '../../../platform/fleet/fleetIntelligenceEngine';
import { FleetScopeNotice } from './FleetScopeNotice';
import {
  insightTypeLabel, insightStateLabel, trendMetricLabel, trendDirectionLabel,
  healthDimensionLabel, healthStateLabel, insightUnknownReasonLabel,
  type InsightConfidence,
} from '../../../platform/fleet/fleetIntelligence';

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

function durationText(ms: number | null): string {
  if (ms === null) return UNAVAILABLE;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} dk`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} sa`;
  return `${Math.floor(ms / 86_400_000)} gün`;
}

function shortRef(prefix: string, id: string): string {
  return `${prefix}:${id.slice(0, 8)}`;
}

function confidenceTone(c: InsightConfidence): string {
  return c === 'VERY_HIGH' || c === 'HIGH' ? OK
    : c === 'MEDIUM' ? INFO : c === 'LOW' ? WARN : NONE;
}

type Snap = {
  readonly data: ReturnType<typeof readFleetIntelligence> | null;
  readonly readAtMs: number;
};

/** Okuma fail-soft: katman düşse bile ekran çökmez. */
function readSnap(): Snap {
  const now = Date.now();
  try {
    return { data: readFleetIntelligence(now), readAtMs: now };
  } catch {
    return { data: null, readAtMs: now };
  }
}

function FleetIntelligenceScreenBase() {
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
  const s = d?.snapshot ?? null;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* YETKİ KAPSAMI: bu ekranın boş olması BEKLENEN mi yoksa KUSUR mu —
          ölçülmüş GRANT gerçeğinden (fleetScopeModel) okunur. */}
      <FleetScopeNotice surface="fleet-intelligence" />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">
            Fleet Intelligence
          </h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. İçgörü üretmez, kanıt yazmaz, ağ çağrısı yapmaz.
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

      {/* 1 · KANIT SAYAÇLARI */}
      <Section title="Evidence & Insights">
        <div className="flex flex-col">
          <Row label="source">
            <Chip tone={d?.source === 'SERVER' ? OK : NONE}>{d?.source ?? UNAVAILABLE}</Chip>
          </Row>
          <Row label="insightCount">
            <Chip tone={d === null ? NONE : INFO}>
              <Brain size={11} className="mr-1" />{d?.insightCount ?? UNAVAILABLE}
            </Chip>
          </Row>
          <Row label="activeInsightCount">{d?.activeInsightCount ?? UNAVAILABLE}</Row>
          <Row label="evidenceCount">
            <Chip tone={d === null ? NONE : INFO}>
              <Layers size={11} className="mr-1" />{d?.evidenceCount ?? UNAVAILABLE}
            </Chip>
          </Row>
          <Row label="trendCount">{d?.trendCount ?? UNAVAILABLE}</Row>
          {/* Bilinmeyenler GİZLENMEZ — dürüstlüğün ana göstergesi. */}
          <Row label="unknownCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.unknownCount > 0 ? WARN : OK}>
                <HelpCircle size={11} className="mr-1" />{d.unknownCount}
              </Chip>
            )}
          </Row>
          <Row label="learningAge">
            <Chip tone={d?.learningAgeMs == null ? NONE : INFO}>
              <Clock size={11} className="mr-1" />{durationText(d?.learningAgeMs ?? null)}
            </Chip>
          </Row>
          {/* Veri kapsamı: filonun ne kadarı GERÇEKTEN ölçülüyor. */}
          <Row label="coverage">
            {d?.coverage == null ? UNAVAILABLE : `%${Math.round(d.coverage * 100)}`}
          </Row>
        </div>
      </Section>

      {/* 2 · SAPMA */}
      <Section title="Fleet Drift">
        <div className="flex flex-col">
          <Row label="drift">
            {s === null ? UNAVAILABLE : (
              <Chip tone={s.driftState === 'DRIFTING' ? WARN
                : s.driftState === 'STABLE' ? OK : NONE}>
                <TrendingUp size={11} className="mr-1" />{s.driftState}
              </Chip>
            )}
          </Row>
          <Row label="driftEvidenceCount">{s?.driftEvidence.length ?? UNAVAILABLE}</Row>
        </div>
        {s !== null && s.driftEvidence.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {s.driftEvidence.slice(0, 6).map((e) => (
              <div key={e.metric}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {trendMetricLabel(e.metric)}
                </span>
                <span className="text-[11px] font-mono text-[var(--oem-ink-3)]">
                  {e.baselineValue.toFixed(2)} → {e.recentValue.toFixed(2)}
                  {' '}(%{Math.round(e.relativeChange * 100)}) · {e.vehicleCount} araç
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 3 · TRENDLER */}
      <Section title="Trends">
        {s === null || s.trends.length === 0 ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Trend yok — yeterli veri birikmeden trend <strong>bilinçli olarak
            üretilmez</strong> (iki noktadan trend çıkarmak gürültüyü bilgi
            sanmaktır).
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {s.trends.map((t) => (
              <div key={t.metric}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {trendMetricLabel(t.metric)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-[var(--oem-ink-2)]">
                    {trendDirectionLabel(t.direction)}
                  </span>
                  <Chip tone={confidenceTone(t.confidence)}>{t.confidence}</Chip>
                  {t.unknownReason !== null && (
                    <span className="text-[10px] text-[var(--oem-ink-3)]">
                      {insightUnknownReasonLabel(t.unknownReason)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 4 · FİLO SAĞLIĞI — TEK PUAN YOK */}
      <Section title="Fleet Health">
        {s?.health == null ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Sağlık verisi yok. <strong>Tek bir &quot;filo puanı&quot;
            üretilmez</strong> — boyutlar ayrı ayrı durur.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {s.health.dimensions.map((h) => (
              <div key={h.dimension}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {healthDimensionLabel(h.dimension)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-[var(--oem-ink-2)]">
                    {h.index === null ? UNAVAILABLE : h.index.toFixed(2)}
                  </span>
                  <Chip tone={h.state === 'GOOD' ? OK : h.state === 'WATCH' ? INFO
                    : h.state === 'POOR' ? WARN : NONE}>
                    {healthStateLabel(h.state)}
                  </Chip>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 5 · İÇGÖRÜLER VE KANITLARI (izlenebilirlik) */}
      <Section title="Insights (evidence-traceable)">
        {s === null || s.insights.length === 0 ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            İçgörü yok — <strong>kanıtsız içgörü oluşmaz</strong>.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {s.insights.slice(0, 8).map((i) => (
              <div key={i.id}
                className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-[var(--oem-ink-1)]">
                    {insightTypeLabel(i.type)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Chip tone={confidenceTone(i.confidence)}>
                      <Gauge size={11} className="mr-1" />{i.confidence}
                    </Chip>
                    <Chip tone={i.state === 'ACTIVE' ? OK : NONE}>
                      {insightStateLabel(i.state)}
                    </Chip>
                  </span>
                </div>
                <div className="mt-1 text-[10px] font-mono text-[var(--oem-ink-3)]">
                  <Activity size={10} className="mr-1 inline" />
                  {i.evidenceCount} kanıt · {i.vehicleCount} araç ·
                  {' '}{i.driverCount} sürücü · {i.tripCount} yolculuk
                  {i.unknownReason !== null
                    && ` · ${insightUnknownReasonLabel(i.unknownReason)}`}
                </div>
                {/* İZLENEBİLİRLİK: hangi kanıttan oluştuğu tek tek görünür. */}
                {i.evidence.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {i.evidence.slice(0, 6).map((e) => (
                      <span key={`${e.kind}-${e.refId}-${e.metric}`}
                        className="rounded border border-[var(--oem-line)] px-1 text-[10px] font-mono text-[var(--oem-ink-3)]">
                        {e.kind === 'METRIC' ? e.metric
                          : shortRef(e.kind.slice(0, 3).toLowerCase(), e.refId)}
                        {e.value !== null && `=${e.value}`} · {e.provenance}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        <strong>Bu katman AI ÜRETMEZ.</strong> Burada model, tahmin, öneri
        veya doğal dil yoktur — bir içgörü bir cümle değil, <strong>kanıt
        kümesidir</strong> ve hangi araçlardan, sürücülerden, yolculuklardan
        ve metriklerden oluştuğu tek tek izlenebilir.
        <strong> Kanıtsız içgörü oluşmaz</strong> ve <strong>tek araçtan
        yüksek güven çıkmaz</strong>: bir aracın davranışı filo hakkında bir
        iddia değildir. Filo sağlığında <strong>tek puan üretilmez</strong>;
        boyutlar ayrı durur ve ölçülemeyen boyut <code>UNKNOWN</code> kalır
        (<code>0</code> değil). Veri kapsamı bir başarı ölçüsü değil, bir
        <em> bilgi ölçüsüdür</em>: düşük kapsam &quot;filo kötü&quot; değil,
        <strong> &quot;bilmiyoruz&quot;</strong> demektir. Üretim sunucudadır;
        köprü bağlı değilse bu ekran boş görünür. Gerçek araç doğrulaması
        YAPILMADI.
      </p>
    </div>
  );
}

export default memo(FleetIntelligenceScreenBase);
