/**
 * ObdDataBridgeScreen — CAROS LAB · Vehicle · OBD DATA BRIDGE (P0-OBD-01).
 *
 * Zaten okunabilen OBD sinyallerinin kanonik `UnifiedVehicleStore`a taşınmasının
 * SALT-OKUNUR gözlemi. Dört soruyu AYRI AYRI cevaplar:
 *   1. Köprü ayakta mı ve mağazaya yazıyor mu?
 *   2. Hangi sinyal akıyor · hangisi bayat · hangisini araç vermiyor?
 *   3. Paylaşılan büyüklükte otorite kim — CAN mı OBD mi, yoksa hiç mi yok?
 *   4. ELM327 hattına GERÇEKTE kaç PID gidiyor (bütçe)?
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · PID SORGULAMAZ · izleyici KURMAZ · köprüyü başlatmaz/durdurmaz
 *   · mağazaya YAZMAZ · BURST modunu açmaz · araca komut GÖNDERMEZ
 * Açılışta TEK okuma + elle YENİLE; timer/abonelik YOK.
 *
 * SAHTE VERİ YOK: ölçülmeyen her alan `UNAVAILABLE` yazar; hiç yazılmamış
 * değerde YAŞ HESAPLANMAZ.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Cable, Gauge, Scale, Activity } from 'lucide-react';
import {
  readBridgeDiagnostics, readCanonicalSignals, readAuthorities, readWireBudget,
} from '../../../platform/devtools/obdBridgeLabSources';
import {
  buildBridgeLines, buildSignalRows, buildAuthorityLines, buildWireBudgetLines,
  summarizeSignals, overallVerdict,
  type LabLine, type LabVerdict, type SignalRow,
} from '../../../platform/devtools/obdBridgeLabModel';

/* ── OEM tokenlar (tek katman) ─────────────────────────────────────────── */

const TONE: Readonly<Record<LabVerdict, string>> = {
  OK:          'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  WARN:        'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  BAD:         'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const OVERALL_LABEL: Readonly<Record<LabVerdict, string>> = {
  OK:          'KÖPRÜ AKIYOR',
  WARN:        'DİKKAT — bir dal zayıf',
  BAD:         'KIRIK — OBD sinyalleri mağazaya ULAŞMIYOR',
  UNAVAILABLE: 'KANIT YOK',
};

function Chip({ tone, children }: { tone: LabVerdict; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function LineRow({ line }: { line: LabLine }) {
  return (
    <div className="border-b border-[var(--oem-line)] py-1.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] text-[var(--oem-ink-3)]">{line.label}</span>
        <Chip tone={line.verdict}>{line.value}</Chip>
      </div>
      {line.note !== null && (
        <p className="mt-1 text-[11px] leading-snug text-[var(--oem-ink-3)]">{line.note}</p>
      )}
    </div>
  );
}

function Section({
  title, icon, children,
}: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--oem-line)] bg-[var(--oem-surface-1)] p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--oem-ink-2)]">
        {icon}{title}
      </h3>
      {children}
    </section>
  );
}

/** `1716123456789` → `14:37:21`. Damga yoksa `—` (sahte saat basılmaz). */
function clockOf(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return '—';
  try { return new Date(ms).toLocaleTimeString('tr-TR'); } catch { return '—'; }
}

const SignalTable = memo(function SignalTable({ rows }: { rows: readonly SignalRow[] }) {
  if (rows.length === 0) {
    return <p className="text-[11px] text-[var(--oem-ink-3)]">UNAVAILABLE — katalog okunamadı.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-[var(--oem-ink-3)]">
            <th className="py-1 pr-2 font-medium">PID</th>
            <th className="py-1 pr-2 font-medium">Sinyal</th>
            <th className="py-1 pr-2 font-medium text-right">Ölçüm</th>
            <th className="py-1 pr-2 font-medium text-right">Yaş</th>
            <th className="py-1 pr-2 font-medium text-right">Son güncelleme</th>
            <th className="py-1 font-medium text-right">Durum</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-[var(--oem-line)] align-top">
              <td className="py-1 pr-2 font-mono text-[var(--oem-ink-2)]">
                {r.pid}
                <span className="ml-1 text-[9px] text-[var(--oem-ink-3)]">
                  {r.path === 'core' ? 'çekirdek' : r.cls}
                </span>
              </td>
              <td className="py-1 pr-2 text-[var(--oem-ink-2)]">
                {r.safety && <span className="mr-1 text-[var(--oem-warn)]">●</span>}
                {r.name}
                <p className="mt-0.5 text-[10px] leading-snug text-[var(--oem-ink-3)]">{r.why}</p>
              </td>
              <td className="py-1 pr-2 text-right font-mono text-[var(--oem-ink-1)]">{r.reading}</td>
              <td className="py-1 pr-2 text-right font-mono text-[var(--oem-ink-2)]">
                {r.age}
                <span className="block text-[9px] text-[var(--oem-ink-3)]">eşik {r.window}</span>
              </td>
              <td className="py-1 pr-2 text-right font-mono text-[var(--oem-ink-3)]">
                {clockOf(r.measuredAtMs)}
              </td>
              <td className="py-1 text-right"><Chip tone={r.verdict}>{r.state}</Chip></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── Ekran ─────────────────────────────────────────────────────────────── */

interface Snapshot {
  bridge:    readonly LabLine[];
  signals:   readonly SignalRow[];
  authority: readonly LabLine[];
  budget:    readonly LabLine[];
  overall:   LabVerdict;
  readAtMs:  number;
}

function readSnapshot(): Snapshot {
  const nowMs     = Date.now();
  const bridge    = buildBridgeLines(readBridgeDiagnostics());
  const signals   = buildSignalRows(readCanonicalSignals(nowMs));
  const authority = buildAuthorityLines(readAuthorities(nowMs));
  const budget    = buildWireBudgetLines(readWireBudget());
  return {
    bridge, signals, authority, budget,
    overall: overallVerdict([bridge, authority, budget]),
    readAtMs: nowMs,
  };
}

export default function ObdDataBridgeScreen() {
  const mountedRef = useRef(true);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    setSnap(readSnapshot());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const summary = useMemo(
    () => summarizeSignals(snap?.signals ?? []),
    [snap],
  );

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="obd-data-bridge-screen">
      <div className="flex items-center justify-between gap-2">
        <Chip tone={snap?.overall ?? 'UNAVAILABLE'}>
          {OVERALL_LABEL[snap?.overall ?? 'UNAVAILABLE']}
        </Chip>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2 py-1 text-[11px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={12} />YENİLE
        </button>
      </div>

      <Section title="Köprü" icon={<Cable size={12} />}>
        {(snap?.bridge ?? []).map((l) => <LineRow key={l.label} line={l} />)}
      </Section>

      <Section
        title={`Kanonik sinyaller — ${summary.live} LIVE · ${summary.stale} STALE · ${summary.missing} UNAVAILABLE`}
        icon={<Gauge size={12} />}
      >
        <p className="mb-2 text-[11px] leading-snug text-[var(--oem-ink-3)]">
          ● işaretli sinyaller GÜVENLİK-KRİTİKTİR ve düşük-uç cihazda feda edilmez.
          Tazelik eşiği her sinyalde AYRIDIR: PID adının yanındaki sınıf
          (hot · medium · slow · archival) ile GERÇEK okuma kadansından türer —
          genişletilmiş grup turda yalnız 1 PID okur, dolayısıyla 16 PID izlenirken
          bir sinyalin SAĞLIKLI yaşı onlarca saniye olabilir. “Yaş” sütununun
          altındaki “eşik” bu sinyalin LIVE penceresidir; aşılınca STALE, üç katı
          aşılınca UNAVAILABLE olur. STALE bir değer GÖSTERİLİR ama Guardian ve
          akü koruması onu KULLANMAZ.
        </p>
        <SignalTable rows={snap?.signals ?? []} />
      </Section>

      <Section title="Otorite — aynı veriyi kim veriyor" icon={<Scale size={12} />}>
        {(snap?.authority ?? []).map((l) => <LineRow key={l.label} line={l} />)}
      </Section>

      <Section title="Hat bütçesi (ELM327)" icon={<Activity size={12} />}>
        {(snap?.budget ?? []).map((l) => <LineRow key={l.label} line={l} />)}
      </Section>

      <p className="text-[10px] leading-snug text-[var(--oem-ink-3)]">
        SALT-OKUNUR: bu ekran PID sorgulamaz, izleyici kurmaz, köprüyü
        başlatmaz/durdurmaz, mağazaya yazmaz ve araca komut göndermez. Değerler
        açılışta bir kez okunur; güncellemek için YENİLE.
        {snap !== null && <> Son okuma: {new Date(snap.readAtMs).toLocaleTimeString('tr-TR')}.</>}
      </p>
    </div>
  );
}
