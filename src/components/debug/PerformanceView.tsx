import { memo } from 'react';
import { useDebugStore } from '../../platform/debug';
import { useHALStatusStore } from '../../platform/vehicleDataLayer/halStatusStore';

function msAgo(ts: number) {
  if (!ts) return 'never';
  const d = Date.now() - ts;
  if (d < 1000) return `${d}ms`;
  return `${(d / 1000).toFixed(1)}s ago`;
}

function HzBar({ hz, max = 10 }: { hz: number; max?: number }) {
  const pct = Math.min(100, (hz / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[var(--oem-surface-2)] rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-14 text-right text-[var(--oem-good)] font-mono text-xs">{hz} Hz</span>
    </div>
  );
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[var(--oem-line)] last:border-0">
      <span className="text-[var(--oem-ink-2)] text-xs font-mono">{label}</span>
      <div className="text-right">
        <span className="text-[var(--oem-ink)] text-xs font-mono">{value}</span>
        {sub && <span className="ml-2 text-[var(--oem-ink-3)] text-xs font-mono">{sub}</span>}
      </div>
    </div>
  );
}

function fmtBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  if (bytes < 1_024 * 1_024 * 1_024) return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
  return `${(bytes / (1_024 * 1_024 * 1_024)).toFixed(2)} GB`;
}

/** `null` = BİLİNMİYOR (ölçülmedi), `false` = ÖLÜ. İkisi ASLA karıştırılmaz. */
function aliveLabel(v: boolean | null): string {
  if (v === true)  return 'canlı';
  if (v === false) return 'ÖLÜ';
  return 'BİLİNMİYOR';
}

export const PerformanceView = memo(function PerformanceView() {
  const perf       = useDebugStore((s) => s.perf);
  const errorLog   = useDebugStore((s) => s.errorLog);
  const cacheStats = useDebugStore((s) => s.cacheStats);
  /* KAYNAK DURUMU (SAHA 2026-07-25): bu kart daha önce `debugStore.fallback`ten
     besleniyordu — ama `dbgUpdateFallback`in ÇAĞIRANI YOK, alan ÖLÜ. Kart her koşulda
     "stale / inactive / no" gösteriyordu: sahte bir durum beyanı. Artık GERÇEK kaynağa
     (Vehicle HAL `sourceHealth`) bağlıdır ve üç durumu AYIRIR: canlı / ÖLÜ / BİLİNMİYOR.
     `updatedAt` worker MONOTONİK saatidir (performance.now()) — duvar saatiyle yaş
     hesaplamak YANLIŞ olur, o yüzden ham gösterilir. */
  const sourceHealth = useHALStatusStore((s) => s.sourceHealth);

  return (
    <div className="flex flex-col gap-4 px-1">
      {/* Event rates */}
      <div>
        <p className="text-[var(--oem-ink-3)] text-xs font-mono uppercase mb-2">Olay Hızları</p>
        <div className="flex flex-col gap-2">
          <div>
            <div className="flex justify-between mb-0.5">
              <span className="text-[var(--oem-good)] text-xs font-mono">CAN</span>
              <span className="text-[var(--oem-ink-3)] text-xs font-mono">{msAgo(perf.canLastTs)}</span>
            </div>
            <HzBar hz={perf.canHz} max={20} />
          </div>
          <div>
            <div className="flex justify-between mb-0.5">
              <span className="text-[var(--oem-info)] text-xs font-mono">OBD</span>
              <span className="text-[var(--oem-ink-3)] text-xs font-mono">{msAgo(perf.obdLastTs)}</span>
            </div>
            <HzBar hz={perf.obdHz} max={5} />
          </div>
          <div>
            <div className="flex justify-between mb-0.5">
              <span className="text-[var(--oem-warn)] text-xs font-mono">GPS</span>
              <span className="text-[var(--oem-ink-3)] text-xs font-mono">{msAgo(perf.gpsLastTs)}</span>
            </div>
            <HzBar hz={perf.gpsHz} max={2} />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="border border-[var(--oem-line)] rounded px-3">
        <StatRow label="Dinleyici" value={String(perf.listenerCount)} />
        <StatRow label="CAN düşürülen" value={String(perf.canDropped)} sub="geçersiz frame" />
        <StatRow label="OBD düşürülen" value={String(perf.obdDropped)} sub="geçersiz frame" />
        <StatRow label="GPS düşürülen" value={String(perf.gpsDropped)} sub="geçersiz frame" />
      </div>

      {/* Tile Cache */}
      <div>
        <p className="text-[var(--oem-ink-3)] text-xs font-mono uppercase mb-2">Karo Önbelleği</p>
        <div className="border border-[var(--oem-line)] rounded px-3">
          <div className="flex items-center justify-between py-1.5 border-b border-[var(--oem-line)]">
            <span className="text-[var(--oem-ink-2)] text-xs font-mono">Önbellek İsabet Oranı</span>
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 bg-[var(--oem-surface-2)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--oem-info)] rounded-full transition-all duration-500"
                  style={{ width: `${cacheStats.hitRate}%` }}
                />
              </div>
              <span className="text-[var(--oem-info)] text-xs font-mono w-10 text-right">
                {cacheStats.hitRate}%
              </span>
            </div>
          </div>
          <StatRow
            label="Önbellek Boyutu"
            value={fmtBytes(cacheStats.totalBytes)}
            sub={`${cacheStats.tileCount} karo`}
          />
          <StatRow
            label="İsabet / Iska"
            value={`${cacheStats.hits} / ${cacheStats.misses}`}
          />
        </div>
      </div>

      {/* Kaynak sağlığı — GERÇEK Vehicle HAL verisi (ölü `fallback` alanı DEĞİL) */}
      <div>
        <p className="text-[var(--oem-ink-3)] text-xs font-mono uppercase mb-2">Kaynak Durumu</p>
        <div className="border border-[var(--oem-line)] rounded px-3" data-testid="perf-source-health">
          <StatRow label="CAN" value={aliveLabel(sourceHealth.canAlive)} sub="HAL sourceHealth" />
          <StatRow label="OBD" value={aliveLabel(sourceHealth.obdAlive)} sub="HAL sourceHealth" />
          <StatRow label="GPS" value={aliveLabel(sourceHealth.gpsAlive)} sub="HAL sourceHealth" />
          <StatRow
            label="Son güncelleme"
            value={sourceHealth.updatedAt === null ? 'BİLİNMİYOR' : String(Math.round(sourceHealth.updatedAt))}
            sub="worker monotonik saati (ms) — duvar saati DEĞİL"
          />
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--oem-ink-3)] font-mono">
          Worker yalnız DURUM GEÇİŞİNDE mesaj yollar; hiç geçiş olmadıysa üç alan da
          BİLİNMİYOR kalır — bu "ölü" DEMEK DEĞİLDİR. Ayrıntılı oturum kırılımı için
          Oturum Denetçisi ekranını kullanın.
        </p>
      </div>

      {/* Error log */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[var(--oem-ink-3)] text-xs font-mono uppercase">Hata Kütüğü</p>
          <button
            onClick={() => useDebugStore.getState().clearErrorLog()}
            className="px-2 py-0.5 rounded text-xs font-mono border border-[var(--oem-line)] text-[var(--oem-ink-3)] hover:bg-[var(--oem-surface-2)]"
          >
            TEMİZLE
          </button>
        </div>
        <div className="border border-[var(--oem-line)] rounded max-h-40 overflow-y-auto">
          {errorLog.length === 0 ? (
            <p className="text-[var(--oem-ink-3)] text-xs font-mono px-3 py-3">Hata yok</p>
          ) : (
            errorLog.slice().reverse().map((e, i) => (
              <div key={i} className="flex gap-2 px-3 py-1 text-xs font-mono border-b border-[var(--oem-line)] last:border-0">
                <span className={
                  e.level === 'error' ? 'text-[var(--oem-danger)]' :
                  e.level === 'warn'  ? 'text-[var(--oem-warn)]' :
                  'text-[var(--oem-ink-3)]'
                }>
                  {e.level.toUpperCase()}
                </span>
                <span className="text-[var(--oem-ink-3)]">[{e.source}]</span>
                <span className="text-[var(--oem-ink)]">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});
