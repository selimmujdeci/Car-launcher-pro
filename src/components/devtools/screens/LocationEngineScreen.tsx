/**
 * LocationEngineScreen — CAROS LAB · Vehicle · LOCATION ENGINE (P1).
 *
 * Çok kaynaklı konum motorunun SALT-OKUNUR gözlemi (§7).
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · GPS başlatma/durdurma · yeni fix isteme · `watchPosition` açma
 *   · sağlayıcı kaydı/kaldırma · kaynak geçişi ZORLAMA
 *   · `gpsService` konfigürasyonuna dokunma · ağ çağrısı
 * Açılışta TEK okuma + elle YENİLE; timer/abonelik YOK.
 *
 * HAM VERİ GÖSTERİLMEZ: **koordinat (enlem/boylam) GÖSTERİLMEZ** — konum
 * kişisel veridir ve LAB'a taşınmaz. Yalnız hassasiyet · yaş · güven ·
 * durum · sağlayıcı ve sayaçlar gösterilir.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Satellite, AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  readLocationEngineSnapshot,
  readLocationEngineProviders,
} from '../../../platform/location/locationEngineRuntime';
import type { ArbiterSnapshot } from '../../../platform/location/locationArbiter';
import {
  DEMOTE_GRACE_MS, MIN_DWELL_MS,
} from '../../../platform/location/locationArbiter';
import {
  locationStateLabel, confidenceLabel, providerLabel, classifyAccuracy,
  type LocationState,
} from '../../../platform/location/locationConfidence';
import {
  PROVIDER_PRIORITY, LOCATION_PROVIDERS,
  type LocationConfidence, type LocationProviderId,
} from '../../../platform/location/locationProvider';
import {
  getGPSLocationEnvelope,
  getGPSLocationTruthDiagnostics,
  getGPSState,
} from '../../../platform/gpsService';
import type { CanonicalStateEnvelope } from '../../../platform/state/canonicalStateEnvelope';
import type { GPSLocation } from '../../../platform/vehicleDataLayer/types';
import { getVDLHydrationDiagnostics } from '../../../platform/vehicleDataLayer/UnifiedVehicleStore';

/* ── OEM tokenlar ──────────────────────────────────────────────────────── */

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const BAD  = 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';
const INFO = 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]';

/** Bilinmeyen için TEK gösterim — sahte 0 / sahte tarih YOK. */
const UNAVAILABLE = 'UNAVAILABLE';

const STATE_TONE: Record<LocationState, string> = {
  LIVE: OK, STALE: WARN, LAST_KNOWN: INFO, OFFLINE: BAD, UNKNOWN: NONE,
};

const CONF_TONE: Record<LocationConfidence, string> = {
  VERY_HIGH: OK, HIGH: OK, MEDIUM: INFO, LOW: WARN, UNKNOWN: NONE,
};

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

/** Yaş — mutlak zaman damgası SIZDIRMAZ. */
function ageText(atMs: number | null, nowMs: number): string {
  if (atMs === null) return UNAVAILABLE;
  const d = Math.max(0, nowMs - atMs);
  if (d < 1_000) return `${d} ms`;
  if (d < 60_000) return `${(d / 1_000).toFixed(1)} s`;
  return `${Math.floor(d / 60_000)} dk`;
}

interface Snap {
  readonly engine: ArbiterSnapshot | null;
  readonly providers: readonly LocationProviderId[];
  readonly vehicleTruth: CanonicalStateEnvelope<GPSLocation | null> | null;
  readonly gpsState: ReturnType<typeof getGPSState> | null;
  readonly gpsTruthDiagnostics: ReturnType<typeof getGPSLocationTruthDiagnostics> | null;
  readonly vdlHydration: ReturnType<typeof getVDLHydrationDiagnostics> | null;
  readonly readAtMs: number;
}

function readSnap(): Snap {
  let engine: ArbiterSnapshot | null = null;
  let providers: readonly LocationProviderId[] = [];
  let vehicleTruth: CanonicalStateEnvelope<GPSLocation | null> | null = null;
  let gpsState: ReturnType<typeof getGPSState> | null = null;
  let gpsTruthDiagnostics: ReturnType<typeof getGPSLocationTruthDiagnostics> | null = null;
  let vdlHydration: ReturnType<typeof getVDLHydrationDiagnostics> | null = null;
  try { engine = readLocationEngineSnapshot(); } catch { engine = null; }
  try { providers = readLocationEngineProviders(); } catch { providers = []; }
  try { vehicleTruth = getGPSLocationEnvelope(); } catch { vehicleTruth = null; }
  try { gpsState = getGPSState(); } catch { gpsState = null; }
  try { gpsTruthDiagnostics = getGPSLocationTruthDiagnostics(); } catch { gpsTruthDiagnostics = null; }
  try { vdlHydration = getVDLHydrationDiagnostics(); } catch { vdlHydration = null; }
  return { engine, providers, vehicleTruth, gpsState, gpsTruthDiagnostics, vdlHydration, readAtMs: Date.now() };
}

function LocationEngineScreenBase() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readSnap();
    if (!mountedRef.current) return;   // unmount sonrası setState YOK
    setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                          // açılışta TEK okuma; timer/abonelik YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const e = snap?.engine ?? null;
  const now = snap?.readAtMs ?? 0;
  const sample = e?.sample ?? null;
  const registered = snap?.providers ?? [];
  const truth = snap?.vehicleTruth ?? null;
  const gpsState = snap?.gpsState ?? null;
  const gpsDiagnostics = snap?.gpsTruthDiagnostics ?? null;
  const hydration = snap?.vdlHydration ?? null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">Location Engine</h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            Salt-okunur. GPS başlatmaz, fix istemez, kaynak geçişi zorlamaz.
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

      {/* Canonical vehicle truth. Privacy: raw latitude/longitude deliberately omitted. */}
      <Section title="Vehicle Location Truth">
        {truth === null ? (
          <Chip tone={NONE}>KAYNAK YOK</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Canonical Owner">VDL · UnifiedVehicleStore</Row>
            <Row label="Source Evidence Owner">gpsService</Row>
            <Row label="Authority Direction">gpsService → VDL → consumers</Row>
            <Row label="Classification"><Chip tone={INFO}>{truth.classification}</Chip></Row>
            <Row label="Freshness"><Chip tone={truth.freshness === 'CURRENT' ? OK : truth.freshness === 'STALE' ? WARN : NONE}>{truth.freshness}</Chip></Row>
            <Row label="Provenance">{truth.provenance.length === 0 ? 'KAYNAK YOK' : truth.provenance.join(' · ')}</Row>
            <Row label="Observed At">{truth.observedAt === null ? 'KAYNAK YOK' : 'VAR'}</Row>
            <Row label="Generation">{truth.generation === null ? 'KAYNAK YOK' : String(truth.generation)}</Row>
            <Row label="Scope">{truth.scope.id === null ? truth.scope.type : `${truth.scope.type} · ${truth.scope.id}`}</Row>
            <Row label="Source Ref">{truth.sourceRef ?? 'KAYNAK YOK'}</Row>
            <Row label="Location">{truth.value === null ? 'KAYNAK YOK' : 'ÖLÇÜLDÜ'}</Row>
            <Row label="Heading">{truth.value?.heading == null ? 'KAYNAK YOK' : truth.value.heading === 0 ? 'ÖLÇÜLDÜ · 0 GEÇERLİ' : 'ÖLÇÜLDÜ'}</Row>
            <Row label="Accuracy">{truth.value?.accuracy == null ? 'KAYNAK YOK' : 'ÖLÇÜLDÜ'}</Row>
            <Row label="Provider / Tracking">{gpsState === null ? 'KAYNAK YOK' : `${gpsState.source ?? 'KAYNAK YOK'} · ${gpsState.isTracking ? 'AKTİF' : 'KAPALI'}`}</Row>
            <Row label="Provider Error">{gpsState?.error ?? 'KAYNAK YOK'}</Row>
            <Row label="Stale Generation Rejects">{gpsDiagnostics === null ? 'KAYNAK YOK' : String(gpsDiagnostics.staleGenerationRejectCount)}</Row>
            <Row label="Out-of-order Rejects">{gpsDiagnostics === null ? 'KAYNAK YOK' : String(gpsDiagnostics.outOfOrderRejectCount)}</Row>
          </div>
        )}
      </Section>

      <Section title="VDL Persistence / Hydration">
        {hydration === null ? <Chip tone={NONE}>KAYNAK YOK</Chip> : <div className="flex flex-col">
          <Row label="Store Key">{hydration.storeKey}</Row>
          <Row label="Persisted Fields">{hydration.persistedFields.join(', ')}</Row>
          <Row label="Persisted Field Count">{hydration.persistedFieldCount}</Row>
          <Row label="Hydrated?">{hydration.hydrated ? 'EVET' : 'HAYIR'}</Row>
          <Row label="Hydration Timestamp">{hydration.hydratedAt === null ? 'KAYNAK YOK' : 'VAR'}</Row>
          <Row label="Odometer Baseline Restored?">{hydration.odometerBaselineRestored ? 'EVET' : 'HAYIR'}</Row>
          <Row label="Classification">{hydration.classification}</Row>
          <Row label="Freshness">{hydration.freshness}</Row>
          <Row label="Provenance">{hydration.provenance.join(' · ')}</Row>
          <Row label="Live Revalidated?">{hydration.liveRevalidated ? 'EVET' : 'HAYIR'}</Row>
          <Row label="Live Telemetry Persisted?">{hydration.liveTelemetryPersisted ? 'EVET' : 'HAYIR'}</Row>
          <Row label="GPS Truth Persisted?">{hydration.gpsTruthPersisted ? 'EVET' : 'HAYIR'}</Row>
        </div>}
      </Section>

      {/* 1 · Aktif kaynak ve durum */}
      <Section title="Aktif Kaynak">
        {e === null ? (
          <Chip tone={NONE}>{UNAVAILABLE} — motor okunamadı</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Active Provider">
              {e.activeProvider === null
                ? <Chip tone={NONE}>{UNAVAILABLE}</Chip>
                : (
                  <span className="inline-flex items-center gap-1">
                    <Satellite size={11} className="text-[var(--oem-ink-3)]" />
                    {providerLabel(e.activeProvider)}
                    <span className="text-[var(--oem-ink-3)]">
                      (#{PROVIDER_PRIORITY[e.activeProvider]})
                    </span>
                  </span>
                )}
            </Row>
            <Row label="Location State">
              <Chip tone={STATE_TONE[e.state]}>{e.state} · {locationStateLabel(e.state)}</Chip>
            </Row>
            <Row label="Confidence">
              {sample === null
                ? <Chip tone={NONE}>{UNAVAILABLE}</Chip>
                : (
                  <Chip tone={CONF_TONE[sample.confidence]}>
                    {sample.confidence} · {confidenceLabel(sample.confidence)}
                  </Chip>
                )}
            </Row>
            <Row label="Accuracy">
              {sample?.accuracyM == null
                ? UNAVAILABLE
                : `±${Math.round(sample.accuracyM)} m · ${classifyAccuracy(sample.accuracyM)}`}
            </Row>
            <Row label="Age">{ageText(sample?.timestampMs ?? null, now)}</Row>
            <Row label="Süreklilik (fix zinciri)">
              {e.streak === 0 ? UNAVAILABLE : String(e.streak)}
            </Row>
            <Row label="Son karar">{ageText(e.lastDecisionAtMs, now)}</Row>
          </div>
        )}
      </Section>

      {/* 2 · Geçiş sayaçları */}
      <Section title="Kaynak Geçişleri">
        {e === null ? (
          <Chip tone={NONE}>{UNAVAILABLE}</Chip>
        ) : (
          <div className="flex flex-col">
            <Row label="Switch Count">{e.switchCount}</Row>
            <Row label="Fallback Count">
              {e.fallbackCount === 0
                ? <Chip tone={OK}><ShieldCheck size={11} className="mr-1" />0</Chip>
                : <Chip tone={WARN}>{e.fallbackCount}</Chip>}
            </Row>
            <Row label="Geçiş kapısı">
              {e.holdReason === null
                ? <Chip tone={OK}>AÇIK</Chip>
                : <Chip tone={INFO}>BEKLETİLDİ — {e.holdReason}</Chip>}
            </Row>
            <Row label="Tutunma / toparlanma">
              <span className="text-[11px] text-[var(--oem-ink-3)]">
                dwell {MIN_DWELL_MS / 1000}s · grace {DEMOTE_GRACE_MS / 1000}s
              </span>
            </Row>
          </div>
        )}
      </Section>

      {/* 3 · Sağlayıcı öncelik tablosu */}
      <Section title="Provider Priority">
        <div className="flex flex-col">
          {LOCATION_PROVIDERS.map((id) => {
            const available = e?.providerAvailability[id];
            const isRegistered = registered.includes(id);
            return (
              <Row key={id} label={`#${PROVIDER_PRIORITY[id]} ${providerLabel(id)}`}>
                {!isRegistered
                  ? <Chip tone={NONE}>KAYITLI DEĞİL</Chip>
                  : available === undefined
                    ? <Chip tone={NONE}>{UNAVAILABLE}</Chip>
                    : available
                      ? <Chip tone={OK}>HAZIR</Chip>
                      : <Chip tone={NONE}>YOK</Chip>}
              </Row>
            );
          })}
        </div>
      </Section>

      {/* 4 · Sağlayıcı hataları */}
      <Section title="Provider Errors">
        {e === null || Object.keys(e.providerErrors).length === 0 ? (
          <Chip tone={OK}>Kayıtlı hata YOK</Chip>
        ) : (
          <div className="flex flex-col">
            {Object.entries(e.providerErrors).map(([id, err]) => (
              <Row key={id} label={providerLabel(id as LocationProviderId)}>
                {err.count === 0
                  ? <Chip tone={OK}>0</Chip>
                  : (
                    <Chip tone={BAD}>
                      <AlertTriangle size={11} className="mr-1" />
                      {err.count} · {err.lastKind ?? UNAVAILABLE}
                    </Chip>
                  )}
              </Row>
            ))}
          </div>
        )}
      </Section>

      <p className="text-[10px] text-[var(--oem-ink-3)]">
        Bu ekran hiçbir şey başlatmaz ve mevcut GPS akışına DOKUNMAZ —
        `gpsService` yalnız GÖZLENİR. <strong>Koordinat (enlem/boylam)
        gösterilmez</strong>: konum kişisel veridir. Bilinmeyen alanlar
        UNAVAILABLE gösterilir; tek fix ASLA yüksek güven sayılmaz ve
        &quot;son bilinen konum&quot; ASLA canlı olarak sunulmaz.
      </p>
    </div>
  );
}

export default memo(LocationEngineScreenBase);
