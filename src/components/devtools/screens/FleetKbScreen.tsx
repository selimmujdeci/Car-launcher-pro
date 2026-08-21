/**
 * FleetKbScreen — CAROS LAB · Araç · Filo Hafızası (V-04/4).
 *
 * NEDEN VAR: `fleetKb` "araçtan öğren, sonraki sefere hazır gel" mantığı olarak
 * yazılmıştı ama hiçbir yerden çağrılmıyordu — iddia kodda vardı, üründe yoktu.
 * Artık tam araç taraması sonunda öğreniyor; bu ekran öğrenilenin CİHAZDA
 * gözlemlenebilir olmasını sağlar.
 *
 * SALT-OKUNUR. YAPMADIKLARI: tarama başlatma · profil silme/düzenleme · öğrenme
 * tetikleme · yeni timer / abonelik / polling.
 *
 * GİZLİLİK: ham VIN NE DİSKE yazılır NE EKRANA gelir — kimlik FNV-1a hash'i veya
 * ECU+PID imzasıdır ve burada ayrıca kırpılır.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Brain } from 'lucide-react';
import {
  readFleetKbLabSnapshot,
  type FleetKbRawSnapshot,
} from '../../../platform/devtools/fleetKbLabSources';
import {
  buildFleetKbFields, buildFleetKbProfiles, deriveFleetKbVerdict,
  FLEET_KB_VERDICT_LABEL,
  type FleetKbVerdict,
} from '../../../platform/devtools/fleetKbLabModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const VERDICT_STYLE: Record<FleetKbVerdict, string> = {
  ESTABLISHED: 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  LEARNING:    'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  EMPTY:       'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  UNREADABLE:  'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const FieldRow = memo(function FieldRow({ field }: { field: InspectorField }) {
  return (
    <div
      data-testid={`fkb-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] font-bold text-[var(--oem-ink)]">
            {field.value}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">{field.source}</div>
        <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
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

export const FleetKbScreen = memo(function FleetKbScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<FleetKbRawSnapshot>(() => readFleetKbLabSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readFleetKbLabSnapshot());
  }, []);

  const fields   = useMemo(() => buildFleetKbFields(snap), [snap]);
  const profiles = useMemo(() => buildFleetKbProfiles(snap), [snap]);
  const verdict  = useMemo(() => deriveFleetKbVerdict(snap, profiles), [snap, profiles]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="fleet-kb">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Brain size={12} /> FİLO HAFIZASI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — tarama başlatmaz
          </span>
          <button
            type="button"
            data-testid="fkb-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Hafıza KANIT DEĞİL, İPUCUDUR: öğrenilen ECU listesi yalnız tarama SIRASINI
          etkiler (bilinen UDS'li ECU'lar öne alınır); hiçbir ECU atlanmaz ve hiçbir
          sonuç hafızadan üretilmez. Ham VIN diske yazılmaz, ekrana gelmez.
        </p>
      </div>

      <div
        data-testid="fkb-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        HAFIZA DURUMU: {FLEET_KB_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          DEPO
        </div>
        <div>{fields.map((f) => <FieldRow key={f.id} field={f} />)}</div>
      </div>

      <div
        data-testid="fkb-profiles"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          ÖĞRENİLEN ARAÇLAR ({profiles.length})
        </div>
        {profiles.length === 0 ? (
          <div className="px-2 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            Kayıt yok. Bu "araç öğrenilemez" DEMEK DEĞİL: tam araç taraması henüz
            tamamlanmamış ya da kimlik (VIN / ECU+PID imzası) üretilememiş olabilir.
          </div>
        ) : profiles.map((p) => (
          <div
            key={p.id}
            data-testid={`fkb-profile-${p.id}`}
            data-source={p.source}
            className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="break-all font-mono text-[11px] font-bold text-[var(--oem-ink)]">
                {p.fingerprint}
              </span>
              <span className="rounded border border-[var(--oem-line-strong)] px-1 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
                {p.sourceLabel}
              </span>
              <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
                güven %{p.confidencePct} · {p.observationCount} gözlem
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
              {p.ecuCount} ECU · {p.udsCount} UDS'li · {formatAge(p.lastSeenAt, snap.readAt) ?? 'zaman damgası yok'}
            </div>
            <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{p.note}</div>
          </div>
        ))}
      </div>

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        Güven 1'e ASLA ulaşmaz — araç her an değişebilir (sahada yaşandı: aynı dongle
        Doblo'dan Trafic'e taşındı). Hiç ortak ECU kalmadığında sistem bunu ARAÇ DEĞİŞİMİ
        sayar ve hafızayı canlı kanıtla günceller: hafızaya değil ARACA inanılır.
      </p>
    </div>
  );
});
