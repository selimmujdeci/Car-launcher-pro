/**
 * RecoveryMonitorScreen — CAROS LAB · Çalışma Zamanı · Kurtarma İzleyici.
 *
 * SALT-OKUNUR. Kurtarma TETİKLEYEMEZ, kapı zorlayamaz, cooldown sıfırlayamaz,
 * tavan açamaz, reconnect başlatamaz, araca komut GÖNDEREMEZ.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 * (Periyodik okuma, kurtarmanın kendi zamanlamasını gözlemleyen bir ekranda
 * ölçülen şeyi kirletirdi; üstelik cooldown saniyeleri sahte "canlı" hissi verirdi.)
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * CAN ECU-silent kurtarma merdiveni sahada ÇALIŞIYOR ama tek çıktısı
 * `console.info` idi: cihazda logcat'e bağlanmadan "merdiven neden tırmanmıyor"
 * sorusu CEVAPSIZDI. Bu ekran sekiz kapıyı KOD SIRASIYLA gösterir ve ilk
 * engelleyeni adıyla söyler.
 *
 * GİZLİLİK: VIN, adaptör MAC, cihaz adı, ham çerçeve ve ham komut bu ekrana
 * GELMEZ — yalnız enum · adet · süre · protokol etiketi · voltaj skaleri.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, LifeBuoy, Ban } from 'lucide-react';
import {
  readRecoveryMonitorSnapshot, type RecoveryMonitorRawSnapshot,
} from '../../../platform/devtools/recoveryMonitorSources';
import {
  resolveRecoveryAuthority, evaluateRecoveryGates, firstBlockingGate,
  deriveRecoveryVerdict, recoveryVerdictTone, gateStateTone,
  buildLadderFields, buildKwpFields, buildReconnectFields, buildLedgerFields,
  RECOVERY_AUTHORITY_LABEL, RECOVERY_VERDICT_LABEL, RECOVERY_GATE_STATE_LABEL,
  type RecoveryTone, type RecoveryGate, type RecoveryFieldsInput,
} from '../../../platform/devtools/recoveryMonitorModel';
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

/** Model renk BİLMEZ; ton → OEM token çevirimi YALNIZ burada. */
const TONE_STYLE: Record<RecoveryTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`rm-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
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

const GateRow = memo(function GateRow({ gate }: { gate: RecoveryGate }) {
  return (
    <div
      data-testid={`rm-gate-${gate.id}`}
      data-state={gate.state}
      className="flex items-start gap-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <span
        title={gate.state}
        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${TONE_STYLE[gateStateTone(gate.state)]}`}
      >
        {RECOVERY_GATE_STATE_LABEL[gate.state]}
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[11px] text-[var(--oem-ink)]">{gate.label}</div>
        <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{gate.evidence}</div>
      </div>
    </div>
  );
});

const Section = memo(function Section({
  title, fields, nowMs,
}: { title: string; fields: readonly InspectorField[]; nowMs: number }) {
  return (
    <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
      <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
        {title}
      </div>
      {fields.map((f) => <FieldRow key={f.id} field={f} nowMs={nowMs} />)}
    </div>
  );
});

export const RecoveryMonitorScreen = memo(function RecoveryMonitorScreen() {
  /* Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
     `Date.now()` yalnız BURADA çağrılır; saf katmanlara parametre olarak iner. */
  const [snap, setSnap] = useState<RecoveryMonitorRawSnapshot>(
    () => readRecoveryMonitorSnapshot(Date.now()),
  );

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readRecoveryMonitorSnapshot(Date.now()));
  }, []);

  const nowMs = snap.readAt;
  const l = snap.ladder;

  const authority = useMemo(
    () => resolveRecoveryAuthority({
      protocolActive: l?.protocolActive ?? null,
      canApplicable:  l?.canApplicable === true,
    }),
    [l],
  );

  const gates = useMemo(
    () => evaluateRecoveryGates(l === null ? null : {
      inFlight: l.inFlight,
      exhausted: l.exhausted,
      transportConnected: l.transportConnected,
      dataFresh: l.dataFresh,
      ecuSilentStreak: l.ecuSilentStreak,
      streakThreshold: l.streakThreshold,
      nativeReconnectInFlight: l.nativeReconnectInFlight,
      protocolActive: l.protocolActive,
      canApplicable: l.canApplicable,
      voltageKnown: l.voltageKnown,
      engineLikelyRunning: l.engineLikelyRunning,
      batteryVoltage: l.batteryVoltage,
      engineVoltageThresholdV: l.engineVoltageThresholdV,
      lastRecoveryAtMs: l.lastRecoveryAtMs,
      cooldownMs: l.cooldownMs,
      nextLevelPresent: l.nextLevel !== null,
    }, nowMs),
    [l, nowMs],
  );

  const verdict = useMemo(
    () => deriveRecoveryVerdict({
      gates,
      authority,
      inFlight:  l?.inFlight === true,
      exhausted: l?.exhausted === true,
      dataFresh: l?.dataFresh === true,
      available: l !== null,
    }),
    [gates, authority, l],
  );

  const blocker = useMemo(() => firstBlockingGate(gates), [gates]);

  const fieldsInput = useMemo<RecoveryFieldsInput>(() => ({
    ladder: l === null ? null : {
      inFlight: l.inFlight,
      exhausted: l.exhausted,
      transportConnected: l.transportConnected,
      dataFresh: l.dataFresh,
      ecuSilentStreak: l.ecuSilentStreak,
      streakThreshold: l.streakThreshold,
      nativeReconnectInFlight: l.nativeReconnectInFlight,
      protocolActive: l.protocolActive,
      canApplicable: l.canApplicable,
      voltageKnown: l.voltageKnown,
      engineLikelyRunning: l.engineLikelyRunning,
      batteryVoltage: l.batteryVoltage,
      engineVoltageThresholdV: l.engineVoltageThresholdV,
      lastRecoveryAtMs: l.lastRecoveryAtMs,
      cooldownMs: l.cooldownMs,
      nextLevelPresent: l.nextLevel !== null,
      attemptsUsed: l.attemptsUsed,
      maxAttempts: l.maxAttempts,
      nextLevel: l.nextLevel,
      lastLevel: l.lastLevel,
    },
    kwp: snap.kwp === null ? null : {
      status: snap.kwp.status,
      recoveryCount: snap.kwp.recoveryCount,
      consecutiveFailedRecoveries: snap.kwp.consecutiveFailedRecoveries,
      suppressedCount: snap.kwp.suppressedCount,
      atpcSendFailures: snap.kwp.atpcSendFailures,
      maxCoreNoDataStreak: snap.kwp.maxCoreNoDataStreak,
      lastRecoveryToFirstPidMs: snap.kwp.lastRecoveryToFirstPidMs,
      refreshedAt: snap.kwp.refreshedAt,
    },
    reconnect: snap.reconnect === null ? null : {
      consecutiveRetryStreak: snap.reconnect.consecutiveRetryStreak,
      lifetimeRequested: snap.reconnect.lifetimeRequested,
      sessionEventCount: snap.reconnect.sessionEventCount,
      sessionTimeoutCount: snap.reconnect.sessionTimeoutCount,
      lastReason: snap.reconnect.lastReason,
      lastReconnectAt: snap.reconnect.lastReconnectAt,
      lastOutcome: snap.reconnect.lastOutcome,
      /* P0-OBD-CORE-06 — connect otoritesi (tek-uçuş kapısı) kanıtı. */
      connectInFlight: snap.reconnect.connectInFlight,
      connectAttemptsStarted: snap.reconnect.connectAttemptsStarted,
      connectBusyRejections: snap.reconnect.connectBusyRejections,
      connectPreemptions: snap.reconnect.connectPreemptions,
      reconnectYieldedToRecovery: snap.reconnect.reconnectYieldedToRecovery,
      lastNativeFailureClass: snap.reconnect.lastNativeFailureClass,
      /* P0-OBD-FINAL-01 — native reconnect otoritesinin ölçülen künyesi. */
      nativeReconnectEpoch: snap.reconnect.nativeReconnectEpoch,
      nativeReconnectInFlight: snap.reconnect.nativeReconnectInFlight,
      nativeReconnectRounds: snap.reconnect.nativeReconnectRounds,
      nativeReconnectRecovered: snap.reconnect.nativeReconnectRecovered,
      nativeReconnectFailed: snap.reconnect.nativeReconnectFailed,
      nativeReconnectGuardTimeouts: snap.reconnect.nativeReconnectGuardTimeouts,
      nativeReconnectLastOutcome: snap.reconnect.nativeReconnectLastOutcome,
      nativeReconnectLastDurationMs: snap.reconnect.nativeReconnectLastDurationMs,
    },
    linkLoss: snap.linkLoss === null ? null : {
      total: snap.linkLoss.summary.total,
      pendingRecoveryCount: snap.linkLoss.summary.pendingRecoveryCount,
      supersededCount: snap.linkLoss.summary.supersededCount,
      medianRecoveryMs: snap.linkLoss.summary.medianRecoveryMs,
      maxRecoveryMs: snap.linkLoss.summary.maxRecoveryMs,
    },
    nowMs,
  }), [l, snap.kwp, snap.reconnect, snap.linkLoss, nowMs]);

  const ladderFields    = useMemo(() => buildLadderFields(fieldsInput), [fieldsInput]);
  const kwpFields       = useMemo(() => buildKwpFields(fieldsInput), [fieldsInput]);
  const reconnectFields = useMemo(() => buildReconnectFields(fieldsInput), [fieldsInput]);
  const ledgerFields    = useMemo(() => buildLedgerFields(fieldsInput), [fieldsInput]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="recovery-monitor">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <LifeBuoy size={12} /> KURTARMA İZLEYİCİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — kurtarma tetiklemez
          </span>
          <button
            type="button"
            data-testid="rm-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Yalnız mevcut senkron getter okunur. Kurtarma TETİKLENMEZ, kapı zorlanmaz,
          cooldown sıfırlanmaz, tavan açılmaz. Native KWP kanıtı bu ekranda TAZELENMEZ —
          onu üstteki “TÜMÜNÜ YENİLE” (kwp-recovery bölümü) doldurur; kanıt yaşı aşağıda
          her zaman gösterilir.
        </p>
      </div>

      {/* Hüküm + otorite */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="rm-verdict"
            data-verdict={verdict}
            title={verdict}
            className={`rounded border px-2 py-0.5 font-mono text-[11px] ${TONE_STYLE[recoveryVerdictTone(verdict)]}`}
          >
            {RECOVERY_VERDICT_LABEL[verdict]}
          </span>
          <span
            data-testid="rm-authority"
            data-authority={authority}
            className="rounded border border-[var(--oem-line-strong)] px-2 py-0.5 font-mono text-[10px] text-[var(--oem-ink-2)]"
          >
            OTORİTE: {RECOVERY_AUTHORITY_LABEL[authority]}
          </span>
          {l?.protocolActive && (
            <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
              ATDPN {l.protocolActive}
            </span>
          )}
        </div>

        {blocker && (
          <div
            data-testid="rm-blocker"
            className="mt-2 flex items-start gap-2 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-2 py-1.5"
          >
            <Ban size={12} className="mt-0.5 shrink-0 text-[var(--oem-warn)]" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] text-[var(--oem-warn)]">
                İLK ENGELLEYEN KAPI: {blocker.label}
              </div>
              <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-2)]">
                {blocker.evidence}
              </div>
            </div>
          </div>
        )}

        <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          İKİ MOTOR, TEK OTORİTE: CAN'de (ATSP 6/7/8/9/A/B/C) TS merdiveni
          (protocol_close → elm_reinit → transport_reconnect), KWP/ISO9141'de native
          ATPC çalışır. İkisi BİLEREK aynı anda tırmanmaz — çift ATPC oturumu sürekli
          kapatır. “Diğer motor sessiz” bir arıza DEĞİL, tasarımdır.
        </p>
      </div>

      {/* Kapılar — kod sırasıyla */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--oem-ink-2)]">
          KAPILAR (kod sırasıyla) — ilk DURDURAN'dan sonrası değerlendirilmez
        </div>
        {gates.map((g) => <GateRow key={g.id} gate={g} />)}
      </div>

      <Section title="CAN merdiveni"                fields={ladderFields}    nowMs={nowMs} />
      <Section title="Native ATPC (KWP/ISO9141)"    fields={kwpFields}       nowMs={nowMs} />
      <Section title="Reconnect yaşam döngüsü"      fields={reconnectFields} nowMs={nowMs} />
      <Section title="Kopma defteri — ölçülmüş süre" fields={ledgerFields}   nowMs={nowMs} />
    </div>
  );
});
