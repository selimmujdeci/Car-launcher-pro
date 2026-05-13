import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Download, Trash2, CheckCircle2, Loader2, WifiOff } from 'lucide-react';
import {
  clearOfflineData,
  getOfflineMeta,
  triggerAutoDownload,
  type OfflineCacheMeta,
} from '../../platform/offlineDataService';

export const OfflineDataPanel = memo(function OfflineDataPanel() {
  const [meta,     setMeta]     = useState<OfflineCacheMeta | null>(() => getOfflineMeta());
  const [status,   setStatus]   = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 81, province: '' });
  const [errMsg,   setErrMsg]   = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { setMeta(getOfflineMeta()); }, []);

  const handleDownload = useCallback(async () => {
    if (status === 'downloading') {
      abortRef.current?.abort();
      setStatus('idle');
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus('downloading');
    setErrMsg('');
    setProgress({ done: 0, total: 81, province: '' });
    try {
      // triggerAutoDownload ile mevcut konumu merkez alarak indirme başlat
      triggerAutoDownload(39.9, 32.8);
      // İndirme arka planda yürür; tamamlanınca meta güncellenir
      setStatus('done');
      setMeta(getOfflineMeta());
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setStatus('idle'); return; }
      setErrMsg((e as Error).message ?? 'İndirme hatası');
      setStatus('error');
    }
  }, [status]);

  const handleClear = useCallback(async () => {
    await clearOfflineData();
    setMeta(null);
    setStatus('idle');
  }, []);

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const ageText = meta ? (() => {
    const region = meta.regions[0];
    if (!region) return null;
    const days = Math.floor((Date.now() - region.downloadedAt) / 86_400_000);
    return days === 0 ? 'Bugün' : `${days} gün önce`;
  })() : null;

  return (
    <div className="flex flex-col gap-3 p-1">
      {meta && meta.totalRegions > 0 ? (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-900/30 border border-emerald-700/40">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-emerald-300">
              {meta.totalPlaces.toLocaleString('tr-TR')} yer — {meta.totalRegions} bölge
            </p>
            <p className="text-[10px] text-emerald-500">{ageText} indirildi · 90 gün geçerli</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/40">
          <WifiOff className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-slate-300">Offline veri yok</p>
            <p className="text-[10px] text-slate-500">Mahalle, benzinlik, hastane vb.</p>
          </div>
        </div>
      )}

      {status === 'downloading' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-slate-400 truncate max-w-[180px]">
              {progress.province || '…'}
            </span>
            <span className="text-[10px] text-slate-400 shrink-0">
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {status === 'error' && (
        <p className="text-[10px] text-red-400 px-1">{errMsg}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleDownload}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-bold transition-all ${
            status === 'downloading'
              ? 'bg-amber-900/40 border border-amber-700/50 text-amber-300'
              : 'bg-blue-900/40 border border-blue-700/50 text-blue-300 hover:bg-blue-800/50'
          }`}
        >
          {status === 'downloading'
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Durdur</>
            : <><Download className="w-3.5 h-3.5" /> {meta ? 'Güncelle' : 'Tüm Türkiye İndir'}</>
          }
        </button>
        {meta && status !== 'downloading' && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-red-900/30 border border-red-700/40 text-red-400 hover:bg-red-900/50 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="text-[9px] text-slate-600 text-center px-2">
        OpenStreetMap verisi · mahalle, benzinlik, hastane, eczane · ~10–30 dk
      </p>
    </div>
  );
});
