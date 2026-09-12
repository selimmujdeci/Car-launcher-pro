/**
 * EcuCapabilityScreen — CAROS LAB · Vehicle · ECU YETENEK MATRİSİ (P0-OBD-PARITY).
 *
 * SALT-OKUNUR. Tarama BAŞLATMAZ, OBD komutu GÖNDERMEZ, timer KURMAZ, abonelik AÇMAZ.
 * Yalnız `ecuCapabilitySources` tek okuma katmanını açılışta bir kez ve elle
 * YENİLE ile okur (A3–A8 desenleriyle AYNI).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * "Bu ECU'ya ne sorabildik ve ne cevap verdi?" sorusunun cevabı BEŞ ayrı
 * deftere dağılmıştı; sahada kimse beş ekranı yan yana koymuyordu. Bu ekran
 * ECU başına TEK künye gösterir: rota · adres kanıtı · oturum · servis
 * matrisi · kod adedi · kapsam boşlukları · silme kanıt zinciri.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Yalnız OBD protokol verisi (adres · rol · servis · NRC · ham hex · adet).
 * VIN, konum ve kullanıcı verisi bu ekrana GİRMEZ.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Cpu, ShieldAlert } from 'lucide-react';
import {
  readEcuCapabilitySnapshot,
  type EcuCapabilitySnapshot, type EcuCapabilityRow,
} from '../../../platform/devtools/ecuCapabilitySources';
import {
  ECU_SERVICE_CAPABILITY_LABEL, ECU_CLEAR_READINESS_LABEL,
  isCapabilityCoverageLoss, isCapabilityMeasured,
  type EcuServiceCapability,
} from '../../../platform/obd/ecuCapabilityModel';

const NA = 'UNAVAILABLE';

function toneOf(c: EcuServiceCapability): string {
  if (isCapabilityMeasured(c)) {
    return c === 'SUPPORTED_WITH_DATA'
      ? 'border-[var(--oem-danger)] text-[var(--oem-danger)]'
      : 'border-[var(--oem-line)] text-[var(--oem-ink-1)]';
  }
  return isCapabilityCoverageLoss(c)
    ? 'border-[var(--oem-warn)] text-[var(--oem-warn)]'
    : 'border-[var(--oem-line)] text-[var(--oem-ink-3)]';
}

const EcuRow = memo(function EcuRow({ row }: { row: EcuCapabilityRow }) {
  const c = row.capability;
  return (
    <div
      data-testid={`ecu-capability-${c.rxHeader}`}
      className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-2 font-mono text-[9px] flex flex-col gap-1"
    >
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--oem-ink-1)]">
        <Cpu size={11} />
        <span className="font-semibold">{c.label}</span>
        {/* Rol yalnız KANIT varsa basılır — adresten rol UYDURULMAZ. */}
        <span className="text-[var(--oem-ink-3)]">rol: {c.role ?? 'UNKNOWN'}</span>
        <span className="text-[var(--oem-ink-3)]">
          {c.txHeader ?? 'tx YOK'} → {c.rxHeader} · {c.addressBits} bit
        </span>
        <span className="text-[var(--oem-ink-3)]">
          {c.protocol !== null ? `ATDPN ${c.protocol}` : NA}
        </span>
        <span className="text-[var(--oem-ink-3)]">oturum #{c.sessionEpoch}</span>
      </div>

      <div className="flex flex-wrap gap-2 text-[var(--oem-ink-3)]">
        <span>adres: {c.addressing}</span>
        <span>oturum: {c.session}</span>
        <span>
          {/* "Güven bilinmiyor" ile "%0 güven" AYRI — sahte yüzde YASAK. */}
          güven: {c.confidence === null ? NA : `%${Math.round(c.confidence * 100)}`}
        </span>
        <span>kod: {c.totalCodes === null ? NA : c.totalCodes}</span>
      </div>

      <div className="text-[var(--oem-ink-3)] break-all">gerekçe: {c.addressingReason}</div>

      {/* SERVİS MATRİSİ — eksik servis GİZLENMEZ, "SORULMADI" olarak durur. */}
      <div className="flex flex-wrap gap-1">
        {c.services.map((s) => (
          <span
            key={`${s.service}-${s.subFunction}`}
            data-testid={`svc-${c.rxHeader}-${s.service}-${s.subFunction}`}
            title={`${ECU_SERVICE_CAPABILITY_LABEL[s.capability]}${
              s.nrc === null ? '' : ` · NRC 0x${s.nrc.toString(16).toUpperCase().padStart(2, '0')}`
            }${s.raw === null ? '' : ` · raw ${s.raw}`}`}
            className={`rounded border px-1.5 py-0.5 ${toneOf(s.capability)}`}
          >
            {s.service}{s.subFunction === s.service ? '' : `-${s.subFunction}`}
            {' '}{s.capability}
            {s.codeCount === null ? '' : ` (${s.codeCount})`}
          </span>
        ))}
      </div>

      {c.coverageGaps.length > 0 && (
        <div className="text-[var(--oem-warn)]">
          KAPSAM BOŞLUĞU: {c.coverageGaps.join(' · ')}
        </div>
      )}

      {/* ⚠️ İZİN DEĞİL — silme için gereken KANIT ZİNCİRİNİN tamlığı. */}
      <div
        data-testid={`clear-readiness-${c.rxHeader}`}
        className={row.clearReadiness === 'BLOCKED'
          ? 'text-[var(--oem-warn)]' : 'text-[var(--oem-ink-3)]'}
      >
        silme kanıt zinciri: {ECU_CLEAR_READINESS_LABEL[row.clearReadiness]}
      </div>
    </div>
  );
});

export default function EcuCapabilityScreen() {
  const [snap, setSnap] = useState<EcuCapabilitySnapshot | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readEcuCapabilitySnapshot();
    if (mountedRef.current) setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] font-semibold text-[var(--oem-ink-1)]">
          ECU Yetenek Matrisi
        </div>
        <button
          onClick={refresh}
          data-testid="ecu-capability-refresh"
          className="flex items-center gap-1.5 rounded border border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={11} /> YENİLE
        </button>
      </div>

      {/* ARAÇ ÖZETİ — "tam kapsam" iddiası YALNIZ kanıtlandıysa yazılır. */}
      {snap !== null && (
        <div
          data-testid="ecu-capability-summary"
          className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-2 py-1.5 font-mono text-[10px] text-[var(--oem-ink-1)]"
        >
          {snap.summary.ecuCount} ECU · adres kanıtlı {snap.summary.provenCount}
          {' · '}adreslenemeyen {snap.summary.notAddressableCount}
          {' · '}toplam kod {snap.summary.totalCodes ?? NA}
          <div className={snap.summary.fullCoverageProven
            ? 'text-[var(--oem-ink-1)]' : 'text-[var(--oem-warn)]'}>
            {snap.summary.fullCoverageProven
              ? 'TAM KAPSAM KANITLANDI'
              : `TAM KAPSAM KANITLANMADI — ${snap.summary.gapCount} boşluk`}
          </div>
          <div className="text-[var(--oem-ink-3)]">
            oturum: {snap.sessionEpoch ?? NA}
          </div>
        </div>
      )}

      {snap === null ? (
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">okunuyor…</div>
      ) : snap.empty ? (
        <div className="flex items-start gap-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
          <ShieldAlert size={12} className="shrink-0" />
          <span>
            Bu oturumda ECU gözlemi YOK. Bu &quot;araçta ECU yok&quot; DEĞİL, &quot;tam araç
            taraması bu oturumda hiç koşmadı&quot; demektir.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {snap.rows.map((r) => (
            <EcuRow key={`${r.capability.rxHeader}-${r.capability.addressBits}`} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}
