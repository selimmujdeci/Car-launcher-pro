/**
 * PidDiscoveryScreen — CAROS LAB · Vehicle · PID KEŞİF KANITI (P0-OBD-CORE-01B).
 *
 * SALT-OKUNUR. El sıkışması BAŞLATMAZ, OBD komutu GÖNDERMEZ, timer KURMAZ.
 * Yalnız `obdService.getHandshakeDiagnostics()` anlık kopyasını okur
 * (açılışta bir kez + elle YENİLE).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Sahada `supportedCount ≈ 15` görülüyordu ve bu sayı İKİ TAMAMEN FARKLI
 * gerçeğin AYNI görünümüydü:
 *   (a) ECU gerçekten yalnız ilk bloğu destekliyor  → 0100 continuation = 0
 *   (b) CarOS keşfi ilk blokta KIRILDI              → 0120 timeout / NO DATA
 * Ürün ikisini ayırt edemiyor ve (b) hâlinde de "araç 15 PID destekliyor"
 * diyordu. Bu ekran o ayrımı ham kanıtla görünür kılar.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Yalnız OBD protokol verisi (bitmap hex, blok adı, sonuç, deneme sayısı).
 * **VIN GÖSTERİLMEZ** — yalnız VAR/YOK.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Radar } from 'lucide-react';
import {
  readPidDiscoverySnapshot, type PidDiscoverySnapshot,
} from '../../../platform/devtools/pidDiscoverySources';
import {
  buildDiscoveryRows, buildDiscoveryStats, totalRetries,
  COMPLETENESS_MESSAGE, completenessTone, DISCOVERY_NA,
  type DiscoveryBlockRow, type DiscoveryTone, type Completeness,
} from '../../../platform/devtools/pidDiscoveryModel';

const TONE: Readonly<Record<DiscoveryTone, string>> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

function Chip({ tone, children }: { tone: DiscoveryTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const BlockRow = memo(function BlockRow({ row }: { row: DiscoveryBlockRow }) {
  return (
    <div
      className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5"
      data-testid={`pid-disc-${row.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-semibold text-[var(--oem-ink-1)]">{row.command}</span>
        <Chip tone={row.tone}>{row.outcomeLabel}</Chip>
        <span className="font-mono text-[10px] text-[var(--oem-ink-3)]">{row.attempts}</span>
        {row.retried && (
          <span className="font-mono text-[10px] text-[var(--oem-warn)]">↻ yeniden denendi</span>
        )}
      </div>
      <div className="mt-1 grid gap-0.5 font-mono text-[10px]">
        <div className="break-all">
          <span className="text-[var(--oem-ink-3)]">RX (ham): </span>
          <span className={row.raw === DISCOVERY_NA ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-ink-1)]'}>
            {row.raw}
          </span>
        </div>
        <div>
          <span className="text-[var(--oem-ink-3)]">bitmap: </span>
          <span className={row.bitmapBytes === DISCOVERY_NA ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-ink-1)]'}>
            {row.bitmapBytes}
          </span>
        </div>
        <div>
          <span className="text-[var(--oem-ink-3)]">süreklilik: </span>
          <span className="text-[var(--oem-ink-1)]">{row.continuation}</span>
        </div>
      </div>
    </div>
  );
});

export default function PidDiscoveryScreen() {
  const [snap, setSnap] = useState<PidDiscoverySnapshot | null>(null);
  /** Zero-leak: sökülmüş bileşene setState YAPILMAZ. */
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readPidDiscoverySnapshot();
    if (mountedRef.current) setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — abonelik/timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const diag = snap?.diag ?? null;
  const ev = diag?.discoveryEvidence ?? null;
  const completeness: Completeness = diag?.discoveryCompleteness ?? 'not_run';
  const attempts = diag?.blockAttempts ?? [];

  const stats = diag === null ? [] : buildDiscoveryStats({
    completeness,
    supportedCount:  diag.supportedCount,
    readBlocks:      diag.readBlocks,
    attemptedBlocks: diag.attemptedBlocks,
    failedBlock:     diag.failedBlock,
    retryTotal:      totalRetries(attempts),
  });
  const rows = ev === null ? [] : buildDiscoveryRows(ev.blocks, attempts);

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="pid-discovery-screen">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radar size={14} className="text-[var(--oem-ink-3)]" />
          <span className="text-[12px] font-semibold text-[var(--oem-ink-1)]">PID Keşif Kanıtı</span>
          <span className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            el sıkışması: {diag?.outcome ?? DISCOVERY_NA}
          </span>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={11} /> YENİLE
        </button>
      </div>

      {/* Hüküm — en üstte: kullanıcının sorusu "bu sayıya güvenebilir miyim?" */}
      <div className={`rounded border px-2 py-1.5 text-[10px] leading-relaxed ${TONE[completenessTone(completeness)]}`}>
        {COMPLETENESS_MESSAGE[completeness]}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className={`rounded border px-2 py-1.5 ${TONE[s.tone]}`}>
            <div className="text-[10px] opacity-90">{s.label}</div>
            <div className="font-mono text-[11px] font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {snap === null ? (
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">okunuyor…</div>
      ) : rows.length === 0 ? (
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
          Bu oturumda bitmap keşfi ÇALIŞMADI — bu &quot;araç PID desteklemiyor&quot; DEMEK DEĞİLDİR.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => <BlockRow key={r.id} row={r} />)}
        </div>
      )}

      {ev !== null && (
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
          zincir durma nedeni: {ev.finalStopReason} · kanıt: {ev.evidenceComplete ? 'TAM' : 'EKSİK'}
        </div>
      )}
    </div>
  );
}
