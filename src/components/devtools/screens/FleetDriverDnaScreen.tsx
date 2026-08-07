/**
 * FleetDriverDnaScreen — CAROS LAB · Vehicle · DRIVER DNA.
 *
 * Sürücü DNA'sının SALT-OKUNUR gözlemi.
 *
 * ── BU EKRAN NE DEĞİLDİR ───────────────────────────────────────────────
 * Bir PUAN TABLOSU değildir. Sürücüye not vermez, sıralamaz, etiketlemez.
 * DNA, zaman içinde KANITLA oluşan bir sürüş karakteridir; bu ekran onun
 * ne kadarının bilindiğini ve ne kadarının BİLİNMEDİĞİNİ gösterir.
 *
 * ── HEAD UNIT'TE DNA ÜRETİLMEZ (bilinçli) ──────────────────────────────
 * DNA sunucuda birikir (`driver_dna`): karakter uzun dönemli bir kanıttır
 * ve tek bir cihazın belleğinde yaşayamaz — cihaz değişince kaybolurdu.
 * Bu ekran yerel köprüyü okur; köprü henüz bağlı değilse **dürüstçe
 * "DNA yok" der** ve sahte metrik ÜRETMEZ.
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · DNA hesaplama/yazma · yolculuk işleme · sunucuya yazma
 *   · sürücü seçme · ağ çağrısı · timer/abonelik kurma
 * Açılışta TEK okuma + elle YENİLE.
 *
 * ── GİZLİLİK ───────────────────────────────────────────────────────────
 * Sürücü ADI yok (`drv:xxxxxxxx`) · rota/konum yok · VIN yok · plaka yok.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Dna, Gauge, Clock, TrendingUp, AlertTriangle, HelpCircle,
} from 'lucide-react';
import { readDriverDna } from '../../../platform/fleet/driverDnaEngine';
import {
  dnaComponentLabel, dnaLearningLevelLabel, dnaStatusLabel,
  dnaDriftStateLabel, dnaUnknownReasonLabel, vehicleImpactKindLabel,
  type DnaMetric, type DnaProvenance,
} from '../../../platform/fleet/driverDna';

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
  if (ms < 60_000) return `${Math.floor(ms / 1_000)} sn`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} dk`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} sa`;
  return `${Math.floor(ms / 86_400_000)} gün`;
}

function driverRef(id: string | null): string {
  if (id === null || id.length === 0) return UNAVAILABLE;
  return `drv:${id.slice(0, 8)}`;
}

function provenanceTone(p: DnaProvenance): string {
  return p === 'MEASURED' ? OK : p === 'DERIVED' ? INFO : NONE;
}

/** Metrik değeri — `UNKNOWN` ise **sayı GÖSTERİLMEZ**, gerekçe yazılır. */
function metricValueText(m: DnaMetric): string {
  if (m.value === null) return UNAVAILABLE;
  switch (m.unit) {
    case 'EVENTS_PER_100KM': return `${m.value.toFixed(1)} /100km`;
    case 'L_PER_100KM':      return `${m.value.toFixed(1)} L/100km`;
    case 'RATIO':
    case 'INDEX_0_1':        return m.value.toFixed(2);
    case 'NONE':             return String(m.value);
  }
}

type Snap = {
  readonly data: ReturnType<typeof readDriverDna> | null;
  readonly readAtMs: number;
};

/** Okuma fail-soft: DNA katmanı düşse bile ekran çökmez. */
function readSnap(): Snap {
  const now = Date.now();
  try {
    return { data: readDriverDna(now), readAtMs: now };
  } catch {
    return { data: null, readAtMs: now };
  }
}

function FleetDriverDnaScreenBase() {
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
  const dna = d?.dna ?? null;
  const now = snap?.readAtMs ?? 0;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">
            Driver DNA
          </h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. DNA hesaplamaz, yazmaz, ağ çağrısı yapmaz.
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

      {/* 1 · ÖĞRENME DURUMU */}
      <Section title="Learning">
        <div className="flex flex-col">
          <Row label="status">
            {dna === null ? <Chip tone={NONE}>{UNAVAILABLE}</Chip> : (
              <Chip tone={dna.status === 'ACTIVE' ? OK
                : dna.status === 'FORMING' ? INFO : NONE}>
                <Dna size={11} className="mr-1" />{dnaStatusLabel(dna.status)}
              </Chip>
            )}
          </Row>
          <Row label="learningLevel">
            {dna === null ? UNAVAILABLE : (
              <Chip tone={dna.learningLevel === 'NONE' ? NONE : INFO}>
                {dnaLearningLevelLabel(dna.learningLevel)}
              </Chip>
            )}
          </Row>
          <Row label="confidence">
            {dna === null ? UNAVAILABLE : (
              <Chip tone={dna.confidence === 'HIGH' ? OK
                : dna.confidence === 'MEDIUM' ? INFO : NONE}>
                <Gauge size={11} className="mr-1" />{dna.confidence}
              </Chip>
            )}
          </Row>
          <Row label="driverRef">{driverRef(dna?.driverId ?? null)}</Row>
          <Row label="tripCount">{dna?.tripCount ?? UNAVAILABLE}</Row>
          <Row label="totalDistanceKm">
            {dna === null ? UNAVAILABLE : dna.totalDistanceKm.toFixed(1)}
          </Row>
          {/* DNA sunucuda üretilir; köprü yoksa kaynak NONE'dur (sahte veri YOK). */}
          <Row label="source">
            <Chip tone={d?.source === 'SERVER' ? OK : NONE}>{d?.source ?? UNAVAILABLE}</Chip>
          </Row>
        </div>
      </Section>

      {/* 2 · YAŞ VE TAZELİK */}
      <Section title="Age & Freshness">
        <div className="flex flex-col">
          <Row label="dnaAge">
            <Chip tone={d?.dnaAgeMs == null ? NONE : INFO}>
              <Clock size={11} className="mr-1" />{durationText(d?.dnaAgeMs ?? null)}
            </Chip>
          </Row>
          <Row label="lastUpdate">
            {d?.lastUpdateAtMs == null ? UNAVAILABLE
              : `${durationText(Math.max(0, now - d.lastUpdateAtMs))} önce`}
          </Row>
          {/* Son yolculuktan bu yana geçen süre — DNA bayatlığı. */}
          <Row label="staleness">{durationText(d?.stalenessMs ?? null)}</Row>
          <Row label="revision">{dna?.revision ?? UNAVAILABLE}</Row>
        </div>
      </Section>

      {/* 3 · METRİK KAPSAMI — ne kadarını BİLMİYORUZ */}
      <Section title="Coverage">
        <div className="flex flex-col">
          <Row label="metricCount">{d?.metricCount ?? UNAVAILABLE}</Row>
          <Row label="measuredCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.measuredCount > 0 ? OK : NONE}>{d.measuredCount}</Chip>
            )}
          </Row>
          {/* Bilinmeyen sayısı GİZLENMEZ — dürüstlüğün ana göstergesi. */}
          <Row label="unknownCount">
            {d === null ? UNAVAILABLE : (
              <Chip tone={d.unknownCount > 0 ? WARN : OK}>
                <HelpCircle size={11} className="mr-1" />{d.unknownCount}
              </Chip>
            )}
          </Row>
        </div>
      </Section>

      {/* 4 · SAPMA (trend) */}
      <Section title="Drift & Trend">
        <div className="flex flex-col">
          <Row label="drift">
            {dna === null ? UNAVAILABLE : (
              <Chip tone={dna.driftState === 'DRIFTING' ? WARN
                : dna.driftState === 'STABLE' ? OK : NONE}>
                <TrendingUp size={11} className="mr-1" />
                {dnaDriftStateLabel(dna.driftState)}
              </Chip>
            )}
          </Row>
          <Row label="driftEvidenceCount">{dna?.driftEvidence.length ?? UNAVAILABLE}</Row>
        </div>
        {dna !== null && dna.driftEvidence.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {dna.driftEvidence.slice(0, 5).map((e) => (
              <div key={e.component}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {dnaComponentLabel(e.component)}
                </span>
                <span className="text-[11px] font-mono text-[var(--oem-ink-3)]">
                  {e.baselineValue.toFixed(1)} → {e.recentValue.toFixed(1)}
                  {' '}({(e.relativeChange * 100).toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 5 · KANIT (metrik listesi) */}
      <Section title="Evidence">
        {dna === null || dna.metrics.length === 0 ? (
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Kanıt yok — bu cihazda DNA üretilmedi. Yeterli yolculuk birikmeden
            DNA <strong>bilinçli olarak oluşmaz</strong>.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {dna.metrics.map((m) => (
              <div key={m.component}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {dnaComponentLabel(m.component)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-[var(--oem-ink-2)]">
                    {metricValueText(m)}
                  </span>
                  <Chip tone={provenanceTone(m.provenance)}>{m.provenance}</Chip>
                  {m.unknownReason !== null && (
                    <span className="text-[10px] text-[var(--oem-ink-3)]">
                      {dnaUnknownReasonLabel(m.unknownReason)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 6 · ARAÇ ETKİSİ — TAHMİN */}
      {dna !== null && dna.vehicleImpact.length > 0 && (
        <Section title="Vehicle Impact (TAHMİN)">
          <div className="flex flex-col gap-1">
            {dna.vehicleImpact.map((i) => (
              <div key={i.kind}
                className="flex items-center justify-between gap-2 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1">
                <span className="text-[11px] text-[var(--oem-ink-1)]">
                  {vehicleImpactKindLabel(i.kind)}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-[var(--oem-ink-2)]">
                    {i.index === null ? UNAVAILABLE : i.index.toFixed(2)}
                  </span>
                  <Chip tone={WARN}>
                    <AlertTriangle size={11} className="mr-1" />TAHMİN
                  </Chip>
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        <strong>DNA bir puan değildir.</strong> Sürücüye not verilmez,
        sıralanmaz, etiketlenmez — yalnız kanıtla oluşan bir karakter
        gösterilir. <code>UNKNOWN</code> gerçek bir cevaptır: kanıtı olmayan
        metrik <strong>0 değil, boş</strong> kalır ve neden bilinmediği yazılır
        (viraj stili ve akü bakımı için <em>bu sinyali üreten kaynak yok</em>).
        Araç etkisi <strong>ÖLÇÜM DEĞİL TAHMİNDİR</strong>; gerçek balata/lastik
        aşınması ölçülmüyor. Yeterli yolculuk birikmeden DNA
        <strong> bilinçli olarak oluşmaz</strong> — iki kısa sürüşten karakter
        çıkarmak, kanıt gibi sunulan bir tahmin olurdu.
        <strong> Bu katman AI ÜRETMEZ:</strong> model, tahmin, öneri veya
        doğal dil yoktur; yalnız AI'nin gelecekte güvenle kullanabileceği
        kanıtlanmış altyapı vardır. Gerçek araç doğrulaması YAPILMADI.
      </p>
    </div>
  );
}

export default memo(FleetDriverDnaScreenBase);
