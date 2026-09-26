/**
 * DidLearningScreen — CAROS LAB · Vehicle · Otomatik DID Öğrenme.
 *
 * Yalnız GÖRÜNÜM: motorun (`discoveryLive.getLiveDidLearningEngine`) durumunu ve
 * kalıcı öğrenme kayıtlarını gösterir. Ekranı açmak tarama BAŞLATMAZ; motor bağlantı
 * sağlıklı olunca izleyiciyle kendiliğinden çalışır. Tazeleme yalnız ekran açıkken.
 *
 * Sözlük: PROVEN = standart bir sinyalle KANITLI eşleşme (Marka verilerine eklenir) ·
 * CANDIDATE = güçlü ama henüz yetersiz kanıt · AMBIGUOUS = iki referanstan ayırt edilemedi ·
 * UNKNOWN = anlamı yok (referansı olmayan büyüklük ad ALMAZ).
 */
import { memo, useEffect, useMemo, useState } from 'react';
import {
  getLiveDidLearningEngine, isDidLearningEnabled, setDidLearningEnabled,
} from '../../../platform/obd/discovery/discoveryLive';
import {
  deleteRecord, exportLearning, listLearnedEcuKeys, loadRecord,
  type EcuLearningRecord, type LearnedDid,
} from '../../../platform/obd/didLearning/didLearningStore';
import { REFERENCE_DEFS } from '../../../platform/obd/didLearning/referenceCatalog';

const STATUS_ORDER: Record<string, number> = { PROVEN: 0, CANDIDATE: 1, AMBIGUOUS: 2, UNKNOWN: 3 };
const CLASS_ORDER: Record<string, number> = { ANALOG: 0, COUNTER: 1, FLAG: 2, UNKNOWN: 3, CONSTANT: 4 };

const STATUS_CLASS: Record<string, string> = {
  PROVEN: 'text-[var(--oem-good)]',
  CANDIDATE: 'text-[var(--oem-warn)]',
  AMBIGUOUS: 'text-[var(--oem-warn)]',
  UNKNOWN: 'text-[var(--oem-ink-3)]',
};

function fmtMatch(d: LearnedDid): string {
  const m = d.lastMatch;
  if (!m) return '—';
  const ref = REFERENCE_DEFS[m.ref];
  const scale = m.exactEquality ? 'birebir' : `×${+m.k.toPrecision(4)}${m.o ? ` ${m.o > 0 ? '+' : ''}${+m.o.toFixed(2)}` : ''}`;
  return `${ref.label} · ${scale} · r=${m.r.toFixed(3)} · n=${m.n}`;
}

function sortDids(r: EcuLearningRecord): LearnedDid[] {
  return Object.values(r.dids).sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    || (CLASS_ORDER[a.cls] ?? 9) - (CLASS_ORDER[b.cls] ?? 9)
    || a.did.localeCompare(b.did));
}

export const DidLearningScreen = memo(function DidLearningScreen() {
  const [, setTick] = useState(0);
  const [enabled, setEnabled] = useState(isDidLearningEnabled());
  const [showAll, setShowAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  const engine = getLiveDidLearningEngine();
  const status = engine.status();
  const live = engine.records();
  const stored = useMemo(() => listLearnedEcuKeys().map(loadRecord).filter((r): r is EcuLearningRecord => r !== null),
    // her tazelemede yeniden oku (kayıt motor tarafından güncellenir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status.requests, msg]);
  const records = live.length > 0 ? live : stored;

  const onExport = async () => {
    const json = exportLearning();
    try { await navigator.clipboard.writeText(json); setMsg(`Panoya kopyalandı (${json.length} karakter)`); }
    catch { setMsg('Pano kullanılamadı — konsola yazıldı'); console.warn('[DID-LEARN-EXPORT]', json); }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto font-mono text-[11px] text-[var(--oem-ink-1)]">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="didlearn-phase">MOTOR: {status.phase.toUpperCase()}</span>
          <span>oturum: {status.sessionId ?? '—'}</span>
          <span>istek: {status.requests}</span>
          {status.lastError && <span className="text-[var(--oem-bad)]">hata: {status.lastError}</span>}
          <button type="button" className="ml-auto rounded border border-[var(--oem-line-strong)] px-2 py-1"
            onClick={() => { const v = !enabled; setDidLearningEnabled(v); setEnabled(v); }}>
            {enabled ? 'ÖĞRENME AÇIK — kapat' : 'ÖĞRENME KAPALI — aç'}
          </button>
          <button type="button" className="rounded border border-[var(--oem-line-strong)] px-2 py-1" onClick={() => { void onExport(); }}>
            JSON dışa aktar
          </button>
          <button type="button" className="rounded border border-[var(--oem-line-strong)] px-2 py-1" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Yalnız canlı/anlamlı' : 'Tüm DID\'ler'}
          </button>
        </div>
        <div className="mt-1 text-[10px] leading-relaxed text-[var(--oem-ink-2)]">
          Sayım yalnız ARAÇ DURURKEN yapılır; örnekleme her hızda, bütçeli ve salt-okumadır (servis 22).
          PROVEN = standart bir sinyalle kanıtlı eşleşme → Marka verilerine eklenir. Referansı olmayan
          büyüklüğe ad verilmez (UNKNOWN kalır).
        </div>
        {msg && <div className="mt-1 text-[var(--oem-ink-2)]">{msg}</div>}
      </div>

      {records.length === 0 && (
        <div className="rounded border border-[var(--oem-line)] px-3 py-2 text-[var(--oem-ink-3)]">
          Henüz kayıt yok — araca bağlanıp motor çalışırken bekleyin; sayım için araç durmalı.
        </div>
      )}

      {records.map((r) => {
        const view = status.ecus.find((e) => e.ecuKey === r.ecuKey);
        const dids = sortDids(r).filter((d) => showAll || d.status !== 'UNKNOWN' || d.cls === 'ANALOG' || d.cls === 'COUNTER');
        const counts = Object.values(r.dids).reduce<Record<string, number>>((acc, d) => {
          acc[d.status] = (acc[d.status] ?? 0) + 1; acc[d.cls] = (acc[d.cls] ?? 0) + 1; return acc;
        }, {});
        return (
          <div key={r.ecuKey} className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
            <div className="flex flex-wrap items-center gap-3 border-b border-[var(--oem-line)] px-3 py-2">
              <span className="font-bold">ECU {r.rx}</span>
              <span>parça: {r.partNo ?? '—'}</span>
              <span>yazılım: {r.software ?? '—'}</span>
              <span>sayım: {r.enumeration ? `${r.enumeration.method} (${r.enumeration.maskBases.join(',') || '—'})` : 'yapılmadı'}</span>
              <span>DID: {Object.keys(r.dids).length}</span>
              {view && <span>tur: {view.sampledSweeps}</span>}
              <span>oturum: {r.sessions}</span>
              <span className="text-[var(--oem-good)]">PROVEN {counts.PROVEN ?? 0}</span>
              <span className="text-[var(--oem-warn)]">ADAY {counts.CANDIDATE ?? 0}</span>
              <span>ANALOG {counts.ANALOG ?? 0} · SAYAÇ {counts.COUNTER ?? 0} · BAYRAK {counts.FLAG ?? 0} · SABİT {counts.CONSTANT ?? 0}</span>
              <button type="button" className="ml-auto rounded border border-[var(--oem-line-strong)] px-2 py-0.5"
                onClick={() => { if (window.confirm(`${r.ecuKey} öğrenme kaydı silinsin mi?`)) { deleteRecord(r.ecuKey); setMsg('Kayıt silindi'); } }}>
                kaydı sil
              </button>
            </div>
            {dids.map((d) => (
              <div key={d.did} className="flex items-center gap-3 border-b border-[var(--oem-line)] px-3 py-1 last:border-b-0">
                <span className="w-10 shrink-0">{d.did}</span>
                <span className="w-6 shrink-0 text-[var(--oem-ink-3)]">{d.bytes}B</span>
                <span className="w-16 shrink-0">{d.cls}</span>
                <span className={`w-20 shrink-0 ${STATUS_CLASS[d.status] ?? ''}`}>
                  {d.status}{d.ambiguousWith ? `≈${d.ambiguousWith}` : ''}
                </span>
                <span className="min-w-0 flex-1 truncate" title={fmtMatch(d)}>{fmtMatch(d)}</span>
                <span className="shrink-0 text-[var(--oem-ink-3)]">{d.lastRawHex || '—'}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
});
