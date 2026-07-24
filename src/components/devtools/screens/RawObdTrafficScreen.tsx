/**
 * RawObdTrafficScreen — CAROS LAB · Communication · Raw OBD Traffic Inspector (Faz A2).
 *
 * SALT-OKUNUR. Bu ekran araç iletişimini DEĞİŞTİRMEZ: komut göndermez, polling
 * başlatmaz, yeni native kanal açmaz, ECU'ya yazmaz. Yalnız MEVCUT `obdTraffic`
 * yakalama kanalını (ref-count'lu, DebugPanel ile paylaşımlı) dinler ve mevcut
 * 500 kayıtlık halka tamponunu görüntüler.
 *
 * ── SEMANTİK (pazarlıksız) ──────────────────────────────────────────────────
 *  PAUSE   : YALNIZ görünüm güncellemesini dondurur. Native yakalama, OBD polling
 *            ve halka tamponu AYNEN çalışmaya devam eder (veri kaybı yok — devam
 *            edilince biriken her şey görünür).
 *  TEMİZLE : YALNIZ bu ekranın yerel görünüm penceresini keser (işaretten sonrası).
 *            Global tampon ve DebugPanel verisi KORUNUR.
 *  DIŞA AKTAR: HAM tampondan YENİDEN maskelenerek üretilir — ekrandaki nesne
 *            serileştirilmez. Üç maskeleme kapısı + kayıt/karakter/bayt tavanı.
 *
 * ── VERİ GERÇEĞİ ────────────────────────────────────────────────────────────
 *  Native olay yalnız {cmd, resp, ms, ts} taşır. Protokol · oturum · transport
 *  alanları YOKTUR → sütun/filtre olarak SUNULMAZ (uydurma yasak). Anlık protokol
 *  yalnız OTURUM düzeyinde bilinir; başlıkta o şekilde etiketlenir.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Pause, Play, Eraser, Download, ShieldCheck, Search } from 'lucide-react';
import { useDebugStore } from '../../../platform/debug';
import type { ObdTrafficEntry } from '../../../platform/debug';
import { getOBDStatusSnapshot, getHandshakeDiagnostics } from '../../../platform/obdService';
import { useObdTrafficCapture } from '../../../hooks/useDevtoolsCapture';
import {
  expandTrafficRows, filterTrafficRows, countByKind,
  applyViewClear, makeViewClearMarker, describeEmptyState,
  RAW_TRAFFIC_KINDS, ALL_KINDS, MAX_VIEW_ROWS, EMPTY_REASON_TEXT,
  type RawTrafficKind, type ViewClearMarker,
} from '../../../platform/devtools/rawTrafficModel';
import {
  buildRawTrafficExport, MAX_EXPORT_RECORDS,
} from '../../../platform/devtools/rawTrafficExport';

const KIND_CLASS: Record<RawTrafficKind, string> = {
  TX:     'border-sky-500/40 bg-sky-500/10 text-sky-300',
  RX:     'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  SYSTEM: 'border-white/20 bg-white/5 text-white/45',
  ERROR:  'border-rose-500/50 bg-rose-500/15 text-rose-300',
};

function fmtTs(ts: number): string {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join(':') + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

/** Oturum düzeyi bağlam — SATIR düzeyi DEĞİL (açıkça etiketlenir). */
interface SessionContext {
  readonly connectionState: string;
  readonly protocol:        string | null;
}

function readSessionContext(): SessionContext {
  let connectionState = 'unknown';
  let protocol: string | null = null;
  try { connectionState = String(getOBDStatusSnapshot().connectionState ?? 'unknown'); } catch { /* fail-soft */ }
  try {
    const d = getHandshakeDiagnostics();
    protocol = d.protocolActive ?? d.protocolTried ?? null;
  } catch { /* fail-soft */ }
  return { connectionState, protocol };
}

export const RawObdTrafficScreen = memo(function RawObdTrafficScreen() {
  // Yakalama YALNIZ bu ekran mount'ken açık (ref-count'lu; unmount'ta bırakılır).
  useObdTrafficCapture();

  const log = useDebugStore((s) => s.obdTrafficLog);

  const [paused,     setPaused]     = useState(false);
  const [frozenLog,  setFrozenLog]  = useState<readonly ObdTrafficEntry[]>(log);
  const [clearMark,  setClearMark]  = useState<ViewClearMarker>(null);
  const [kinds,      setKinds]      = useState<ReadonlySet<RawTrafficKind>>(ALL_KINDS);
  const [query,      setQuery]      = useState('');
  const [session,    setSession]    = useState<SessionContext>(() => readSessionContext());
  const [exportMsg,  setExportMsg]  = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  /* PAUSE: yalnız GÖRÜNÜM dondurulur. Abonelik ve native yakalama dokunulmaz —
     devam edilince biriken tüm kayıtlar görünür (veri kaybı yok). */
  useEffect(() => {
    if (!paused) setFrozenLog(log);
  }, [log, paused]);

  /* Oturum bağlamı: TIMER YOK — mevcut store akışı (log değişimi) tetikler. */
  useEffect(() => {
    setSession(readSessionContext());
  }, [log]);

  /* Yeni satırda en alta kaydır (duraklatılmışken kaydırma yapılmaz). */
  useEffect(() => {
    if (paused) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [frozenLog, paused]);

  const visibleLog = useMemo(() => applyViewClear(frozenLog, clearMark), [frozenLog, clearMark]);
  const rows       = useMemo(() => expandTrafficRows(visibleLog), [visibleLog]);
  const counts     = useMemo(() => countByKind(rows), [rows]);
  const filtered   = useMemo(() => filterTrafficRows(rows, { kinds, query }), [rows, kinds, query]);

  const toggleKind = useCallback((k: RawTrafficKind) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  /* TEMİZLE: yalnız yerel görünüm penceresi. Global tampon / DebugPanel DOKUNULMAZ. */
  const clearView = useCallback(() => {
    setClearMark(makeViewClearMarker(useDebugStore.getState().obdTrafficLog));
    setExportMsg(null);
  }, []);

  /* DIŞA AKTAR: HAM tampondan yeniden maskelenir (ekrandaki satırlar KULLANILMAZ). */
  const exportMasked = useCallback(async () => {
    const raw = applyViewClear(useDebugStore.getState().obdTrafficLog, clearMark);
    const result = buildRawTrafficExport(raw, {
      generatedAtWallMs: Date.now(),
      platform: (() => { try { return Capacitor.getPlatform(); } catch { return 'unknown'; } })(),
    });

    if (result.recordCount === 0) {
      setExportMsg('Dışa aktarılacak kayıt yok.');
      return;
    }

    const suffix = `${result.recordCount} kayıt${result.truncated ? ' (kırpıldı)' : ''}` +
      `${result.droppedCount > 0 ? ` · ${result.droppedCount} düşürüldü` : ''}`;

    try {
      if (!Capacitor.isNativePlatform()) {
        const blob = new Blob([result.body], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = result.fileName; a.click();
        URL.revokeObjectURL(url);
        setExportMsg(`İndirilenler/${result.fileName} · ${suffix}`);
        return;
      }
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      let savedPath: string;
      try {
        const res = await Filesystem.writeFile({
          path: result.fileName, data: result.body, directory: Directory.Documents,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `Documents/${result.fileName}`;
      } catch {
        const res = await Filesystem.writeFile({
          path: result.fileName, data: result.body, directory: Directory.External,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `External/${result.fileName}`;
      }
      setExportMsg(`${savedPath} · ${suffix}`);
    } catch {
      setExportMsg('Dosya kaydı başarısız.');
    }
  }, [clearMark]);

  const isNative = (() => { try { return Capacitor.isNativePlatform(); } catch { return false; } })();
  const emptyReason = describeEmptyState({
    isNative,
    connectionState: session.connectionState,
    viewCleared: clearMark !== null,
    bufferSize: frozenLog.length,
  });

  return (
    <div className="flex h-full flex-col gap-2" data-testid="raw-obd-inspector">
      {/* Salt-okunur beyanı + oturum bağlamı */}
      <div className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
            <ShieldCheck size={11} /> SALT OKUNUR — araç iletişimini değiştirmez
          </span>
          <span className="rounded border border-white/15 px-1.5 py-0.5 text-white/45">
            oturum: {session.connectionState}
          </span>
          <span className="rounded border border-white/15 px-1.5 py-0.5 text-white/45">
            protokol (oturum düzeyi): {session.protocol ?? 'bilinmiyor'}
          </span>
          {paused && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
              GÖRÜNÜM DURAKLATILDI — yakalama sürüyor
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-white/30">
          Komut gönderme · ECU yazma · DTC silme yüzeyi YOK. Yön (TX/RX) kaydın komut ve
          yanıt yarılarından TÜRETİLİR; protokol/oturum/transport alanları native olayda
          BULUNMADIĞI için satır düzeyinde gösterilmez.
        </p>
      </div>

      {/* Kontroller */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="raw-obd-pause"
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 font-mono text-[10px] text-white/70 hover:bg-white/10"
        >
          {paused ? <><Play size={11} /> DEVAM</> : <><Pause size={11} /> DURAKLAT</>}
        </button>
        <button
          type="button"
          data-testid="raw-obd-clear"
          onClick={clearView}
          className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 font-mono text-[10px] text-white/70 hover:bg-white/10"
        >
          <Eraser size={11} /> GÖRÜNÜMÜ TEMİZLE
        </button>
        <button
          type="button"
          data-testid="raw-obd-export"
          onClick={() => { void exportMasked(); }}
          className="flex items-center gap-1 rounded border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] text-cyan-200 hover:bg-cyan-500/20"
        >
          <Download size={11} /> MASKELİ DIŞA AKTAR
        </button>

        <div className="flex items-center gap-1 rounded border border-white/15 px-2 py-1">
          <Search size={11} className="text-white/30" />
          <input
            data-testid="raw-obd-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="içerik ara…"
            className="w-28 bg-transparent font-mono text-[10px] text-white/80 outline-none placeholder:text-white/25"
          />
        </div>

        {RAW_TRAFFIC_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            data-testid={`raw-obd-kind-${k}`}
            onClick={() => toggleKind(k)}
            className={`rounded border px-2 py-1 font-mono text-[10px] ${
              kinds.has(k) ? KIND_CLASS[k] : 'border-white/10 text-white/25'
            }`}
          >
            {k} ({counts[k]})
          </button>
        ))}

        <span className="ml-auto font-mono text-[10px] text-white/30">
          {filtered.length} / {rows.length} satır · tavan {MAX_VIEW_ROWS}
        </span>
      </div>

      {exportMsg && (
        <div
          data-testid="raw-obd-export-msg"
          className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-white/50"
        >
          {exportMsg} · dışa aktarım maskeli ve en fazla {MAX_EXPORT_RECORDS} kayıttır.
        </div>
      )}

      {/* Başlıklar */}
      <div className="grid shrink-0 grid-cols-[3.5rem_7rem_4.5rem_4rem_1fr] gap-x-3 border-b border-white/10 px-2 pb-1 font-mono text-[10px] uppercase text-white/30">
        <span>#</span>
        <span>Zaman</span>
        <span>Yön</span>
        <span>ms</span>
        <span>İçerik</span>
      </div>

      {/* Liste — bounded (model MAX_VIEW_ROWS ile sınırlar) */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="raw-obd-list">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 font-mono text-[11px] leading-relaxed text-white/40">
            {rows.length === 0
              ? EMPTY_REASON_TEXT[emptyReason]
              : 'Filtreye uyan satır yok (yön seçimini veya aramayı gevşetin).'}
          </p>
        ) : (
          filtered.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[3.5rem_7rem_4.5rem_4rem_1fr] gap-x-3 px-2 py-0.5 font-mono text-[11px] even:bg-white/[0.03]"
            >
              <span className="text-white/25">{r.seq}</span>
              <span className="text-white/40">{fmtTs(r.ts)}</span>
              <span>
                <span className={`rounded border px-1 py-0.5 text-[9px] ${KIND_CLASS[r.kind]}`}>{r.kind}</span>
              </span>
              <span className={r.elapsedMs != null && r.elapsedMs > 1000 ? 'text-orange-400' : 'text-white/30'}>
                {r.elapsedMs ?? ''}
              </span>
              <span className={`break-all ${r.masked ? 'italic text-white/40' : 'text-white/80'}`}>
                {r.text || '—'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
