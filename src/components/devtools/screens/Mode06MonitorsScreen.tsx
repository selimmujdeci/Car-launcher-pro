/**
 * Mode06MonitorsScreen — CAROS LAB · Vehicle · SERVİS 06 İZLEME TESTLERİ.
 *
 * ECU → monitör → test → değer/min/max/sonuç hiyerarşisinde salt-okunur gözlem.
 *
 * YAPTIĞI TEK AKTİF İŞ: kullanıcı "TARA" derse `06 <MID>` OKUMA istekleri gönderir
 * (Deep Scan ekranıyla AYNI sözleşme). YAZMA · AKTÜATÖR · SERVİS RUTİNİ ·
 * OTURUM DEĞİŞTİRME YOKTUR. Tarama talep-güdümlüdür: ekran açıkken bile
 * kendiliğinden hatta çıkmaz, timer kurmaz.
 *
 * DÜRÜSTLÜK: "ECU sustu" (NO DATA) ve "yanıt bozuk" ASLA "geçti" sayılmaz;
 * ölçek kimliği tanınmayan test için hüküm VERİLMEZ, ham değer gösterilir.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Cpu, Play, ShieldCheck } from 'lucide-react';
import {
  runMode06Scan, getMode06Scan, isMode06ScanRunning,
  type Mode06Scan, type Mode06EcuResult,
} from '../../../platform/obd/mode06Service';
import {
  buildTestRows, buildOverview, buildHeadline, midTone,
  MID_STATUS_LABEL, ECU_STATUS_LABEL,
  type Mode06Tone,
} from '../../../platform/devtools/mode06LabModel';

const TONE: Readonly<Record<Mode06Tone, string>> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

function Chip({ tone, children }: { tone: Mode06Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const EcuBlock = memo(function EcuBlock({ ecu }: { ecu: Mode06EcuResult }) {
  return (
    <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      data-testid={`m06-ecu-${ecu.ecuTx || 'default'}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-2 py-1.5 font-mono text-[10px]">
        <Cpu size={12} className="text-[var(--oem-ink-3)]" />
        <span className="text-[11px] font-semibold text-[var(--oem-ink-1)]">{ecu.ecuLabel}</span>
        <span className="text-[var(--oem-ink-3)]">tx {ecu.ecuTx || '—'} · rx {ecu.ecuRx || '—'}</span>
        <Chip tone={ecu.status === 'ok' ? 'ok' : ecu.status === 'failed' ? 'warn' : 'muted'}>
          {ECU_STATUS_LABEL[ecu.status]}
        </Chip>
        <span className="text-[var(--oem-ink-3)]">{ecu.supportedCount} MID destekli</span>
        {ecu.truncated > 0 && (
          <Chip tone="warn">{ecu.truncated} MID bütçe dışı — SORULMADI</Chip>
        )}
      </div>

      {ecu.mids.length === 0 && (
        <p className="px-2 py-1.5 text-[10px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ECU Servis 06'ya yanıt vermedi. Bu <b>“test yok”</b> DEĞİL,
          <b> “sorulamadı”</b> demektir.
        </p>
      )}

      {ecu.mids.map((m) => (
        <div key={m.mid} className="border-t border-[var(--oem-line)] px-2 py-1.5"
          data-testid={`m06-mid-${ecu.ecuTx || 'default'}-${m.mid}`} data-status={m.status}>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
            <span className="text-[var(--oem-ink-1)]">MID {m.mid}</span>
            <span className="text-[var(--oem-ink-2)]">{m.family ?? 'Aile bilinmiyor (üretici/tanımsız)'}</span>
            <Chip tone={midTone(m.status)}>{MID_STATUS_LABEL[m.status]}</Chip>
            <span className="text-[var(--oem-ink-3)]">{m.tests.length} test</span>
          </div>

          {m.tests.length > 0 && (
            <div className="mt-1 overflow-x-auto">
              <table className="w-full min-w-[460px] border-collapse font-mono text-[10px]">
                <thead>
                  <tr className="text-left text-[var(--oem-ink-3)]">
                    <th className="py-0.5 pr-2 font-medium">TID</th>
                    <th className="py-0.5 pr-2 font-medium">Ölçek</th>
                    <th className="py-0.5 pr-2 font-medium text-right">Değer</th>
                    <th className="py-0.5 pr-2 font-medium text-right">Min</th>
                    <th className="py-0.5 pr-2 font-medium text-right">Maks</th>
                    <th className="py-0.5 pr-2 font-medium text-right">Pay</th>
                    <th className="py-0.5 font-medium text-right">Sonuç</th>
                  </tr>
                </thead>
                <tbody>
                  {buildTestRows(m).map((t) => (
                    <tr key={t.id} className="border-t border-[var(--oem-line)] align-top"
                      data-testid={`m06-test-${m.mid}-${t.tid}`} data-result={t.result}>
                      <td className="py-0.5 pr-2 text-[var(--oem-ink-2)]">{t.tid}</td>
                      <td className="py-0.5 pr-2 text-[var(--oem-ink-3)]">{t.uas}</td>
                      <td className="py-0.5 pr-2 text-right text-[var(--oem-ink-1)]">{t.value}</td>
                      <td className="py-0.5 pr-2 text-right text-[var(--oem-ink-3)]">{t.min}</td>
                      <td className="py-0.5 pr-2 text-right text-[var(--oem-ink-3)]">{t.max}</td>
                      <td className="py-0.5 pr-2 text-right text-[var(--oem-ink-3)]">
                        {t.marginPct === null ? '—' : `%${t.marginPct}`}
                      </td>
                      <td className="py-0.5 text-right"><Chip tone={t.tone}>{t.result}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {buildTestRows(m).filter((t) => t.note !== null).map((t) => (
                <p key={`n-${t.id}`} className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
                  TID {t.tid}: {t.note}
                </p>
              ))}
            </div>
          )}

          {m.status === 'malformed' && (
            <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-warn)]">
              Yanıt geldi ama tam bir test kaydına çözülemedi. <b>“Test yok” SAYILMAZ.</b>
              {m.raw && <> Ham: <span className="font-mono">{m.raw.slice(0, 48)}</span></>}
            </p>
          )}
        </div>
      ))}
    </div>
  );
});

interface Snap {
  scan: Mode06Scan | null;
  stale: boolean;
  lastError: string | null;
  runs: number;
  readAtMs: number;
}

function read(): Snap {
  const r = getMode06Scan();
  return { ...r, readAtMs: Date.now() };
}

export default function Mode06MonitorsScreen() {
  const mountedRef = useRef(true);
  const [snap, setSnap] = useState<Snap>(() => read());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    setSnap(read());
  }, []);

  const scan = useCallback(() => {
    if (isMode06ScanRunning()) return;
    setBusy(true);
    void runMode06Scan()
      .catch(() => { /* servis fail-soft; hüküm ekranda görünür */ })
      .finally(() => {
        if (!mountedRef.current) return;
        setBusy(false);
        setSnap(read());
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                        // açılışta TEK okuma — timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const head = buildHeadline(snap.scan, snap.stale);
  const o = buildOverview(snap.scan);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2" data-testid="mode06-monitors">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            SERVİS 06 — İZLEME TESTLERİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT-OKUNUR — yazma/aktüatör YOK
          </span>
          <button type="button" data-testid="m06-scan" disabled={busy} onClick={scan}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] disabled:opacity-50">
            <Play size={11} /> {busy ? 'TARANIYOR…' : 'TARA'}
          </button>
          <button type="button" data-testid="m06-refresh" onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)]">
            <RefreshCw size={11} /> YENİLE
          </button>
          <Chip tone={head.tone}>{head.text}</Chip>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Servis 06, ECU'nun kendi izleme testlerinin sonucunu verir: ölçülen değer ve
          <b> ECU'nun KENDİ belirlediği</b> alt/üst sınır. Geçti/kaldı hükmü bir yorum
          değil, bu sınırların doğrudan sonucudur — eşik UYDURULMAZ. “Pay” sütunu
          değerin banda ne kadar uzak olduğunu gösterir; Servis 06'nın asıl değeri
          budur (kod yanmadan önce sınıra yaklaşma görünür). ECU'nun susması ya da
          bozuk yanıt <b>ASLA “geçti” sayılmaz</b>. Ölçek kimliği tanınmayan testte
          hüküm VERİLMEZ; değer ham gösterilir.
        </p>
        {snap.scan !== null && (
          <p className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">
            {o.ecuCount} ECU · {o.readable} monitör okundu · {o.pass} geçti · {o.fail} kaldı ·
            {' '}{o.unknown} yorumlanamadı · {o.noData} sustu · {o.malformed} bozuk
            {o.truncated > 0 && <> · {o.truncated} MID bütçe dışı</>}
            {' '}· tarama {snap.runs}
          </p>
        )}
        {snap.lastError !== null && (
          <p className="mt-1 font-mono text-[9px] text-[var(--oem-warn)]">{snap.lastError}</p>
        )}
      </div>

      {(snap.scan?.ecus ?? []).map((e) => <EcuBlock key={`${e.ecuTx}-${e.ecuLabel}`} ecu={e} />)}

      {snap.scan === null && (
        <p className="px-2 text-[10px] leading-relaxed text-[var(--oem-ink-3)]">
          Henüz tarama yapılmadı. “TARA” düğmesi ECU keşfini kullanır ve yalnız
          <b> ECU'nun DESTEKLİ bildirdiği</b> monitörleri sorgular — desteklenmeyen
          MID uydurulmaz ve sorulmaz.
        </p>
      )}
    </div>
  );
}
