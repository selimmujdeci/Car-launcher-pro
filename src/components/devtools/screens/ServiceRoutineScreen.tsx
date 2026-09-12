/**
 * ServiceRoutineScreen — CAROS LAB · Araç · Servis Fonksiyonları Kapısı (V-04/5).
 *
 * NEDEN VAR: `serviceFunctions` "araca yazan tek profesyonel yol"un KAPISI olarak
 * yazılmıştı ama üründe hiç çağrılmıyordu — kapının gerçek araç verisiyle nasıl
 * karar verdiği cihazda hiç görülemiyordu.
 *
 * ⚠️ BU EKRAN ARACA HİÇBİR ŞEY YAZMAZ. Rutin çalıştırma düğmesi YOKTUR ve
 * OLMAYACAKTIR (LAB kuralı: gözlem ekranı aktif komut göndermez). Gösterilen tek
 * şey: "şu anki araç durumuyla bu rutinin ÖNKOŞULLARI açık mıydı".
 *
 * Kullanıcı onayı ve risk kabulü burada DAİMA kapalıdır; ekran bunları toplamaz.
 * Rutin destek kanıtı için bir keşif kanalı YOKTUR — bu dürüstçe yazılır, uydurulmaz.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Wrench, AlertTriangle, Lock } from 'lucide-react';
import {
  readServiceRoutineSnapshot,
  type ServiceRoutineRawSnapshot,
} from '../../../platform/devtools/serviceRoutineSources';
import {
  buildServiceRoutineViews, buildHumanGates, deriveServiceRoutineVerdict,
  READINESS_LABEL, SERVICE_VERDICT_LABEL,
  type ServiceRoutineVerdict, type VehicleReadiness,
} from '../../../platform/devtools/serviceRoutineModel';
import { OBSERVABILITY_LABEL, type Observability } from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const READINESS_STYLE: Record<VehicleReadiness, string> = {
  READY:   'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  BLOCKED: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNKNOWN: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const VERDICT_STYLE: Record<ServiceRoutineVerdict, string> = {
  VEHICLE_READY_GATES_CLOSED: 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  VEHICLE_BLOCKED:            'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNKNOWN:                    'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

export const ServiceRoutineScreen = memo(function ServiceRoutineScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<ServiceRoutineRawSnapshot>(() => readServiceRoutineSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readServiceRoutineSnapshot());
  }, []);

  const views      = useMemo(() => buildServiceRoutineViews(snap), [snap]);
  const humanGates = useMemo(() => buildHumanGates(), []);
  const verdict    = useMemo(() => deriveServiceRoutineVerdict(snap, views), [snap, views]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="service-routines">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Wrench size={12} /> SERVİS FONKSİYONLARI KAPISI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — rutin ÇALIŞTIRMAZ
          </span>
          <button
            type="button"
            data-testid="svc-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ekranda rutin çalıştırma düğmesi YOKTUR. Gösterilen tek şey: şu anki araç
          durumuyla ÖNKOŞULLARIN açık olup olmadığı. Karar `serviceFunctions` kapısının
          kendisinden gelir — burada ikinci bir izin motoru YOKTUR.
        </p>
      </div>

      <div
        data-testid="svc-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        DURUM: {SERVICE_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      {/* Rutinler */}
      {views.map((v) => (
        <div
          key={v.kind}
          data-testid={`svc-routine-${v.kind}`}
          data-readiness={v.readiness}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {v.title}
            </span>
            <span className="rounded border border-[var(--oem-line-strong)] px-1 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
              {v.engineLabel}
            </span>
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${READINESS_STYLE[v.readiness]}`}>
              {READINESS_LABEL[v.readiness]}
            </span>
            <span
              title={v.klass}
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[v.klass]}`}
            >
              {OBSERVABILITY_LABEL[v.klass]}
            </span>
          </div>
          <div className="px-3 py-1.5">
            {v.blockedMessage && (
              <div className="font-mono text-[10px] text-[var(--oem-warn)]">
                KAPI: {v.blockedMessage}
              </div>
            )}
            <div className="mt-1 flex items-start gap-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
              <AlertTriangle size={11} className="mt-0.5 shrink-0 text-[var(--oem-warn)]" />
              <span>RİSK (ham metin, kısaltılmadı): {v.risk}</span>
            </div>
          </div>
        </div>
      ))}

      {/* İnsan / kanıt kapıları — burada DAİMA kapalı */}
      <div
        data-testid="svc-human-gates"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="flex items-center gap-1 border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          <Lock size={11} /> İNSAN / KANIT KAPILARI — bu ekranda DAİMA KAPALI
        </div>
        {humanGates.map((g) => (
          <div
            key={g.id}
            data-testid={`svc-gate-${g.id}`}
            data-state={g.state}
            className="border-b border-[var(--oem-line)] px-3 py-1.5 last:border-b-0"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{g.label}</span>
              <span className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1 py-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
                {g.state === 'CLOSED' ? 'KAPALI' : 'KANIT KANALI YOK'}
              </span>
            </div>
            <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{g.note}</div>
          </div>
        ))}
      </div>

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        "ARAÇ ÖNKOŞULLARI UYGUN", "rutin çalıştırılabilir" DEMEK DEĞİLDİR: yazma yolu
        ayrıca kullanıcı onayı, bilgilendirilmiş rıza ve rutin destek KANITI ister —
        üçü de burada kapalıdır. Native yazma (UDS 0x31 / 0x2E / 0x27) bu üründe HENÜZ
        UYGULANMADI; kapı ve model önce, yazma sonra — bilinçli bir sıradır.
      </p>
    </div>
  );
});
