import { memo, useState, useEffect, useCallback } from 'react';
import { Download, Trash2, Loader2, MapPin, X, HardDrive } from 'lucide-react';
import {
  clearOfflineData,
  getOfflineMeta,
  downloadRegion,
  type OfflineCacheMeta,
} from '../../platform/offlineDataService';
import {
  TILE_PRESETS,
  downloadTilePreset,
  buildAreaPreset,
  estimateSizeMB,
  estimateTileCount,
  subscribeDownloadState,
  getDownloadState,
  cancelTileDownload,
  getCachedTileCount,
  clearCachedTiles,
  type DownloadState,
  type TileRegionPreset,
} from '../../platform/offlineTileDownloader';
import { useGPSLocation } from '../../platform/gpsService';

/**
 * Offline Bölge Yönetimi — profesyonel "alan indir" ekranı.
 * Bulunulan bölge + şehir presetleri + boyut tahmini + canlı ilerleme + yönetim.
 * Tile (harita görüntüsü) + POI (arama/adres) birlikte indirilir.
 */
export const OfflineDataPanel = memo(function OfflineDataPanel() {
  const [meta, setMeta]         = useState<OfflineCacheMeta | null>(() => getOfflineMeta());
  const [dl, setDl]             = useState<DownloadState>(() => getDownloadState());
  const [tileCount, setTileCnt] = useState(0);
  const gps = useGPSLocation();

  useEffect(() => subscribeDownloadState(setDl), []);
  const refreshStats = useCallback(() => {
    setMeta(getOfflineMeta());
    getCachedTileCount().then(setTileCnt).catch(() => {});
  }, []);
  useEffect(() => { refreshStats(); }, [refreshStats]);
  // İndirme bitince istatistikleri tazele
  useEffect(() => {
    if (dl.status === 'done' || dl.status === 'cancelled' || dl.status === 'error') refreshStats();
  }, [dl.status, refreshStats]);

  const busy = dl.status === 'downloading';
  const pct  = dl.total > 0 ? Math.round((dl.done / dl.total) * 100) : 0;

  // Bir bölgeyi indir: önce tile (ilerleme gösterilir), paralel POI (arama için)
  const downloadArea = useCallback((preset: TileRegionPreset, poi?: { lat: number; lon: number }) => {
    if (busy) return;
    void downloadTilePreset(preset);
    const c = poi ?? {
      lat: (preset.bbox.minLat + preset.bbox.maxLat) / 2,
      lon: (preset.bbox.minLon + preset.bbox.maxLon) / 2,
    };
    void downloadRegion(c.lat, c.lon).then(refreshStats).catch(() => {});
  }, [busy, refreshStats]);

  const downloadCurrent = useCallback(() => {
    if (!gps) return;
    const preset = buildAreaPreset(gps.latitude, gps.longitude, { radiusKm: 25, minZoom: 10, maxZoom: 14, name: 'Bulunduğun Bölge' });
    downloadArea(preset, { lat: gps.latitude, lon: gps.longitude });
  }, [gps, downloadArea]);

  const handleClear = useCallback(async () => {
    await clearOfflineData();
    await clearCachedTiles();
    refreshStats();
  }, [refreshStats]);

  const tileMB = (tileCount * 14) / 1024;

  return (
    <div className="flex flex-col gap-3 p-1">
      {/* ── Durum özeti ── */}
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
        <HardDrive className="w-4 h-4 text-cyan-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-slate-200">
            {tileCount > 0 || (meta && meta.totalRegions > 0)
              ? `${tileCount.toLocaleString('tr-TR')} harita karosu (~${tileMB.toFixed(0)} MB) · ${meta?.totalPlaces.toLocaleString('tr-TR') ?? 0} yer`
              : 'Henüz offline bölge indirilmedi'}
          </p>
          <p className="text-[10px] text-slate-500">
            İnternet kesilince indirilen bölgelerde harita + arama + rota çalışır
          </p>
        </div>
      </div>

      {/* ── Aktif indirme ── */}
      {busy && (
        <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl bg-blue-950/40 border border-blue-800/40">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-semibold text-blue-300 truncate max-w-[160px]">
              <Loader2 className="w-3 h-3 inline animate-spin mr-1" />{dl.presetName ?? 'İndiriliyor'}
            </span>
            <span className="text-[10px] text-blue-400 shrink-0 tabular-nums">{dl.done}/{dl.total} · %{pct}</span>
          </div>
          <div className="h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <button onClick={cancelTileDownload} className="self-end flex items-center gap-1 text-[10px] font-bold text-amber-400 mt-0.5">
            <X className="w-3 h-3" /> Durdur
          </button>
        </div>
      )}
      {dl.status === 'error' && <p className="text-[10px] text-red-400 px-1">{dl.errorMsg}</p>}

      {/* ── Bulunduğun bölge ── */}
      <button
        onClick={downloadCurrent}
        disabled={busy || !gps}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-900/30 border border-emerald-700/40 disabled:opacity-40 active:scale-[0.99] transition-all text-left"
      >
        <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-emerald-300">Bulunduğun Bölgeyi İndir</p>
          <p className="text-[10px] text-emerald-600">{gps ? '~25 km çevre · harita + yerler' : 'GPS konumu bekleniyor…'}</p>
        </div>
        <Download className="w-4 h-4 text-emerald-400 shrink-0" />
      </button>

      {/* ── Şehir / bölge presetleri ── */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">Hazır Bölgeler</p>
        {TILE_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => downloadArea(p)}
            disabled={busy}
            className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700/40 disabled:opacity-40 active:scale-[0.99] transition-all text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-slate-200">{p.name}</p>
              <p className="text-[10px] text-slate-500 tabular-nums">
                ~{estimateSizeMB(p).toFixed(0)} MB · {estimateTileCount(p).toLocaleString('tr-TR')} karo · z{p.minZoom}–{p.maxZoom}
              </p>
            </div>
            <Download className="w-4 h-4 text-blue-400 shrink-0" />
          </button>
        ))}
      </div>

      {/* ── Yönetim ── */}
      {(tileCount > 0 || (meta && meta.totalRegions > 0)) && !busy && (
        <button
          onClick={handleClear}
          className="flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-bold bg-red-900/30 border border-red-700/40 text-red-400 hover:bg-red-900/50 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" /> Tüm offline veriyi sil
        </button>
      )}

      <p className="text-[9px] text-slate-600 text-center px-2 leading-relaxed">
        © OpenStreetMap · İnternet varken bulunduğun bölge zaten arka planda otomatik cache'lenir;
        buradan seyahat öncesi istediğin şehri önceden indirebilirsin.
      </p>
    </div>
  );
});
