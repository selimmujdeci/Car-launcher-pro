/**
 * CapabilityFabricScreen — CAROS LAB · Yapay Zekâ · Capability Fabric (F5).
 *
 * SALT-OKUNUR. Hiçbir capability ÇALIŞTIRMAZ, kapıyı zorlayıcı kipe ALMAZ,
 * katalogu DEĞİŞTİRMEZ, sayaç SIFIRLAMAZ, Mavi'yi TETİKLEMEZ, timer KURMAZ.
 * Açılışta tek okuma + elle YENİLE (repodaki LAB deseni).
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Parametre DEĞERİ · transkript · kişi adı · adres · sensör sorgusu · VIN ·
 * konum bu ekrana GELMEZ. Yalnız katalog sabitleri (kimlik, işlem adı, alan,
 * güvenlik sınıfı), bounded enum ve ADET gösterilir.
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 * `UNKNOWN` availability bir KUSUR DEĞİLDİR: registry o yetenek için henüz
 * kanıt toplamamıştır ve yol KAPATILMAMIŞTIR. Kapsama oranı gerçek trafikten
 * gelir; hiç tur geçmediyse "%0" DEĞİL "ölçüm yok" yazar.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Boxes } from 'lucide-react';
import {
  readCapabilityFabricSources, type CapabilityFabricSources,
} from '../../../platform/devtools/capabilityFabricSources';
import {
  buildCapabilityFabricView,
  type CapabilityFabricInput, type FabricCatalogRowInput,
} from '../../../platform/devtools/capabilityFabricModel';
import {
  OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const AVAIL_STYLE: Record<string, string> = {
  AVAILABLE:   'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  UNAVAILABLE: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNKNOWN:     'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const FieldRow = memo(function FieldRow({ field }: { field: InspectorField }) {
  return (
    <div
      data-testid={`cf-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">{field.source}</div>
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

const CatalogRow = memo(function CatalogRow({ row }: { row: FabricCatalogRowInput }) {
  return (
    <div
      data-testid={`cf-op-${row.capabilityId}-${row.operation}`}
      className="flex flex-wrap items-center gap-1.5 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <span className="min-w-[190px] font-mono text-[10px] text-[var(--oem-ink)]">
        {row.capabilityId}<span className="text-[var(--oem-ink-3)]">#{row.operation}</span>
      </span>
      <span className="w-20 shrink-0 font-mono text-[9px] text-[var(--oem-ink-3)]">{row.domain}</span>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${
          AVAIL_STYLE[row.availability] ?? AVAIL_STYLE.UNKNOWN
        }`}
      >
        {row.availability}
      </span>
      <span className="shrink-0 rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
        {row.safetyClass}
      </span>
      <span className="shrink-0 rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
        tavan: {row.observationCeiling}
      </span>
      {row.requiresConfirmation && (
        <span className="shrink-0 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
          ONAY
        </span>
      )}
      {!row.exposedToBrain && (
        <span className="shrink-0 rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-danger)]">
          BEYNE KAPALI
        </span>
      )}
      <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--oem-ink-3)]">
        → {row.legacyIntent ?? 'köprü yok'}
      </span>
    </div>
  );
});

export const CapabilityFabricScreen = memo(function CapabilityFabricScreen() {
  const [snap, setSnap] = useState<CapabilityFabricSources>(() => readCapabilityFabricSources());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readCapabilityFabricSources());
  }, []);

  const input: CapabilityFabricInput = useMemo(() => ({
    diagnostics: snap.diagnostics,
    observation: snap.observation,   // MAVI-F7 · gözlem/uzlaştırma tanısı
    enforcing: snap.enforcing,
    rows: snap.rows,
    integrity: snap.integrity,
    brainIntentCount: snap.brainIntentCount,
  }), [snap]);

  const view = useMemo(() => buildCapabilityFabricView(input), [input]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="capability-fabric">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Boxes size={12} /> CAPABILITY FABRIC
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — capability ÇALIŞTIRMAZ
          </span>
          <button
            type="button"
            data-testid="cf-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          AVAILABILITY ≠ PERMISSION ≠ AUTHORITY. Bu katman yalnız KONTROLLÜ GİRİŞ KAPISIDIR:
          hiçbir şey yürütmez ve ikinci bir gerçeklik kaynağı kurmaz — güvenlik, onay ve
          yürütme kararı kanonik zincirde (`maviActionAuthority` → `AiSafetyGate` →
          `dispatchIntent`) kalır. Parametre DEĞERLERİ bu ekrana GELMEZ.
          <strong className="text-[var(--oem-warn)]"> GERÇEK ARAÇ DOĞRULAMASI YAPILMADI —
          DEVICE VALIDATION REQUIRED (kütük F5).</strong>
        </p>
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        {view.fields.map((f) => <FieldRow key={f.id} field={f} />)}
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
          KATALOG ({view.rows.length} işlem)
          {view.byDomain.length > 0 && (
            <span className="ml-2 normal-case text-[var(--oem-ink-3)]">
              {view.byDomain.map(([d, n]) => `${d} ${n}`).join(' · ')}
            </span>
          )}
        </div>
        {view.rows.length === 0 ? (
          <div className="px-2 py-3 font-mono text-[10px] text-[var(--oem-ink-3)]">
            KAYNAK YOK — katalog okunamadı.
          </div>
        ) : view.rows.map((r) => (
          <CatalogRow key={`${r.capabilityId}#${r.operation}`} row={r} />
        ))}
      </div>
    </div>
  );
});

export default CapabilityFabricScreen;
