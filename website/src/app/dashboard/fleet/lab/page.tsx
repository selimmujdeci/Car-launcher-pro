'use client';

/**
 * /dashboard/fleet/lab — CAROS LAB · FİLO & ÇEVRİMDIŞI GÖZLEM PANELİ.
 *
 * SALT-OKUNUR. Hiçbir şirket, üyelik, eşleştirme veya sahiplik işlemi
 * TETİKLEMEZ. Timer/abonelik KURMAZ — açılışta tek okuma + elle YENİLE.
 * Hassas veri (kod, api_key, isim, plaka, ham payload) GÖSTERİLMEZ.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import { readFleetLab } from '@/lib/lab/fleetLabSources';
import { buildFleetLabModel, type FleetLabModel, type LabField } from '@/lib/lab/fleetLabModel';
import { readReasoningLab, type ReasoningLabReading } from '@/lib/lab/reasoningLabSource';
import { readAiMechanicLab, type AiMechanicLabReading } from '@/lib/lab/aiMechanicLabSource';
import { readIntelligenceLab, type IntelligenceLabReading } from '@/lib/lab/intelligenceLabSource';
import { FleetIntelligenceCards } from '@/components/dashboard/FleetIntelligenceCards';
import { EvidenceCoverageCards } from '@/components/dashboard/EvidenceCoverageCards';
import { AiGatewayAccessCard } from '@/components/dashboard/AiGatewayAccessCard';
import { FleetInsightDetail } from '@/components/dashboard/FleetInsightDetail';
import { ReasoningCards } from '@/components/dashboard/ReasoningCards';
import { AiMechanicSummaryCard } from '@/components/dashboard/AiMechanicSummaryCard';

export default function FleetLabPage() {
  const { userId, loading } = useSessionUser();
  /* Rol yalnizca butonu gizler; GUVENLIK sunucudadir (set_ai_gateway_access). */
  const fleet = useFleet(userId);
  const [model, setModel]   = useState<FleetLabModel | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningLabReading | null>(null);
  const [mechanic, setMechanic]   = useState<AiMechanicLabReading | null>(null);
  const [intel, setIntel]         = useState<IntelligenceLabReading | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    /* İki okuma BİRBİRİNİ BEKLEMEZ ve biri düşerse diğeri gösterilir —
       karar motoru okunamadı diye filo paneli kararmaz. */
    const [reading, reasoningReading, mechanicReading, intelReading] = await Promise.all([
      readFleetLab(userId),
      readReasoningLab(userId),
      /* AI Mechanic de bagimsizdir: dusesrse karar panosu ve filo paneli
         calismaya DEVAM EDER (hata yalitimi). */
      readAiMechanicLab(userId),
      /* Zeka okumalari da bagimsizdir: dusesrse diger paneller calisir. */
      readIntelligenceLab(userId),
    ]);
    if (!mountedRef.current) return;
    setModel(buildFleetLabModel(reading, Date.now()));
    setReadAt(reading.readAt);
    setReasoning(reasoningReading);
    setMechanic(mechanicReading);
    setIntel(intelReading);
  }, [userId]);

  // Açılışta TEK okuma. Abonelik/interval YOK.
  useEffect(() => {
    if (loading) return;
    void refresh();
  }, [loading, refresh]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">CAROS LAB · Filo & Çevrimdışı</h2>
          <p className="mt-1 text-xs text-white/40">
            Salt-okunur gözlem paneli — bu ekran hiçbir işlem tetiklemez.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
        >
          YENİLE
        </button>
      </div>

      {model === null ? (
        <Panel title="Okunuyor…"><p className="text-sm text-white/50">Veri alınıyor.</p></Panel>
      ) : (
        <>
          <Panel title={`Panel sağlığı: ${model.health}`}>
            <p className="text-xs text-white/40">
              Son okuma: {readAt ? new Date(readAt).toISOString() : 'UNKNOWN'}
            </p>
          </Panel>

          <Panel title="Kimlik & Oturum"><FieldTable fields={model.identity} /></Panel>
          <Panel title="Yetki Anlık Görüntüsü"><FieldTable fields={model.permissions} /></Panel>
          <Panel title="Çevrimdışı Kuyruk"><FieldTable fields={model.queue} /></Panel>
          <Panel title="İşlem Türüne Göre Kuyruk">
            {model.byOperation.length === 0
              ? <p className="text-sm text-white/40">Kuyrukta işlem yok.</p>
              : <FieldTable fields={model.byOperation} />}
          </Panel>
          <Panel title="Senkron & Çakışma"><FieldTable fields={model.sync} /></Panel>
          <Panel title="Hesap İzolasyonu & Kuşak"><FieldTable fields={model.isolation} /></Panel>
          <Panel title="Realtime & Boşluk Tespiti"><FieldTable fields={model.realtime} /></Panel>
          <Panel title="Çevrimdışı Politika"><FieldTable fields={model.offlinePolicy} /></Panel>
          <Panel title="Telefon Doğrulama"><FieldTable fields={model.phoneValidation} /></Panel>

          {/* MAVI Reasoning Engine — TEK KARAR OTORİTESİ (salt-okunur).
              ⚠️ "Okunamadı" ile "karar yok" AYRI şeylerdir; ikisi
              karıştırılmaz. */}
          <Panel title="MAVI Reasoning Engine">
            {reasoning === null ? (
              <p className="text-sm text-white/40">Okunuyor…</p>
            ) : !reasoning.summaryReadable ? (
              <p className="text-sm text-amber-300/80">
                Karar özeti OKUNAMADI — bu &quot;karar yok&quot; demek değildir.
                Oturum veya yetki eksik olabilir.
              </p>
            ) : (
              <ReasoningCards
                summary={reasoning.summary}
                recent={reasoning.recent}
                queue={reasoning.queue}
                /* Okunamadıysa `null` gider ve bölüm "okunmadı" der —
                   sessizce "sağlıklı" GÖSTERİLMEZ (059). */
                scheduler={reasoning.schedulerReadable ? reasoning.scheduler : null}
              />
            )}
          </Panel>

          {/* AI MECHANIC — MAVI kararlarinin mekanik teshis yorumu.
              Karar URETMEZ, oneri VERMEZ (P1 yalniz teshis katmanidir). */}
          <Panel title="AI Mechanic">
            {mechanic === null ? (
              <p className="text-sm text-white/40">Okunuyor…</p>
            ) : !mechanic.summaryReadable ? (
              <p className="text-sm text-amber-300/80">
                AI Mechanic ozeti OKUNAMADI — bu &quot;analiz yok&quot; demek degildir.
                Oturum veya yetki eksik olabilir.
              </p>
            ) : (
              <AiMechanicSummaryCard summary={mechanic.summary} />
            )}
          </Panel>

          {/* AI ERISIM YONETIMI — izni YALNIZ buradan verilebilir. */}
          <Panel title="AI Erisimi">
            <AiGatewayAccessCard
              canManage={fleet.can('member.invite')}
              vehicles={fleet.vehicles.map((v) => ({
                id: v.vehicle_id,
                /* Plaka/ad yoksa KISALTILMIS referans — ham uuid basilmaz. */
                name: v.name ?? v.plate ?? `veh:${v.vehicle_id.slice(0, 8)}`,
              }))}
            />
          </Panel>

          {/* FLEET INTELLIGENCE — SQL 054 zaten uretiyordu, OKUMA UCU yoktu. */}
          <Panel title="Fleet Intelligence">
            {intel === null ? (
              <p className="text-sm text-white/40">Okunuyor…</p>
            ) : !intel.fleetIntelligenceReadable ? (
              <p className="text-sm text-amber-300/80">
                Filo zekasi OKUNAMADI — bu &quot;icgoru yok&quot; demek degildir.
                Oturum veya yetki eksik olabilir.
              </p>
            ) : (
              <FleetIntelligenceCards row={intel.fleetIntelligence} />
            )}
            {/* Icgoru DETAYI + KANIT ZINCIRI — karttan detaya inis yolu. */}
            <div className="mt-3">
              <FleetInsightDetail userId={userId} />
            </div>
          </Panel>

          {/* EVIDENCE COVERAGE — SQL 055 zaten uretiyordu, OKUMA UCU yoktu. */}
          <Panel title="Kanit Kapsami">
            {intel === null ? (
              <p className="text-sm text-white/40">Okunuyor…</p>
            ) : !intel.evidenceCoverageReadable ? (
              <p className="text-sm text-amber-300/80">
                Kanit kapsami OKUNAMADI — bu &quot;kanit yok&quot; demek degildir.
                Oturum veya yetki eksik olabilir.
              </p>
            ) : (
              <EvidenceCoverageCards row={intel.evidenceCoverage} />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h3 className="mb-3 font-mono text-sm font-semibold uppercase tracking-wide text-white/70">
        {title}
      </h3>
      {children}
    </section>
  );
}

const ORIGIN_CLASS: Record<string, string> = {
  OBSERVED:    'text-emerald-300/80',
  DERIVED:     'text-sky-300/80',
  STALE:       'text-amber-300/80',
  UNAVAILABLE: 'text-white/30',
};

function FieldTable({ fields }: { fields: readonly LabField[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] font-mono text-xs">
        <tbody>
          {fields.map((f) => (
            <tr key={f.label} className="border-b border-white/5 last:border-0">
              <td className="py-1.5 pr-4 text-white/50">{f.label}</td>
              <td className="py-1.5 pr-4 text-white/90">{f.value}</td>
              <td className={`py-1.5 text-right ${ORIGIN_CLASS[f.origin] ?? 'text-white/30'}`}>
                {f.origin}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
