/**
 * HomeWorkAddressPanel — Ev/İş hızlı hedef kayıt paneli (NAVIGATION-P0-1).
 *
 * Ayarlar > Akıllı Servisler altında küçük bir bölüm. Kapsam BİLİNÇLİ olarak
 * dar tutuldu: adres arama (mevcut searchPlaces — MapSearchBar ile AYNI kaynak)
 * + "konumumu kullan". Harita-üzerinde-nokta-seçme (haritadan seç) BİLİNÇLİ
 * olarak DIŞARIDA bırakıldı — ayrı bir harita modu/mod-geçişi gerektirir,
 * bu atomik görevin kapsamı dışı (bkz. NAVIGATION-P0-1 final rapor).
 *
 * Yazma/okuma/silme TEK yüzeyden geçer: platform/addressBookService.ts
 * (setQuickAddress/getQuickAddress/clearQuickAddress) — paralel depolama YOK.
 */
import { memo, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Home, Briefcase, Search, Loader2, MapPin, Trash2, Navigation2 } from 'lucide-react';
import { searchPlaces } from '../../platform/mapService';
import type { StoredLocation } from '../../platform/offlineSearchService';
import {
  getQuickAddress,
  setQuickAddress,
  clearQuickAddress,
  type QuickAddressCategory,
  type Address,
} from '../../platform/addressBookService';
import { useGPSLocation } from '../../platform/gpsService';

interface QuickAddressRowProps {
  category: QuickAddressCategory;
  icon:     ComponentType<{ className?: string }>;
  gpsLat:   number | null;
  gpsLon:   number | null;
}

const QuickAddressRow = memo(function QuickAddressRow({ category, icon: Icon, gpsLat, gpsLon }: QuickAddressRowProps) {
  const { t } = useTranslation();
  const [saved, setSaved]         = useState<Address | null>(() => getQuickAddress(category));
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<StoredLocation[]>([]);
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  // Yarış koşulu koruması — MapSearchBar ile aynı desen: yalnız EN SON isteğin sonucu uygulanır.
  const reqRef      = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); setOpen(false); return; }
    setLoading(true);
    const myReq = ++reqRef.current;
    const timer = setTimeout(() => {
      searchPlaces(q, gpsLat ?? undefined, gpsLon ?? undefined, 5)
        .then((r) => {
          if (myReq !== reqRef.current) return; // bayat istek
          setResults(r);
          setOpen(true);
        })
        .catch(() => {
          if (myReq === reqRef.current) setResults([]);
        })
        .finally(() => {
          if (myReq === reqRef.current) setLoading(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, gpsLat, gpsLon]);

  // Zero-Leak: bileşen unmount olursa bekleyen "kaydedildi" flash timer'ı temizle.
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => { flashTimerRef.current = null; setSavedFlash(false); }, 1500);
  }, []);

  const pick = useCallback((loc: StoredLocation) => {
    const ok = setQuickAddress(category, {
      latitude:    loc.lat,
      longitude:   loc.lng,
      fullAddress: loc.address || loc.name,
      name:        loc.name,
    });
    if (!ok) return; // fail-closed — geçersiz koordinat sessizce reddedilir, eski kayıt korunur
    setSaved(getQuickAddress(category));
    setQuery(''); setResults([]); setOpen(false);
    flashSaved();
  }, [category, flashSaved]);

  const useCurrentLocation = useCallback(() => {
    if (gpsLat == null || gpsLon == null) return;
    const ok = setQuickAddress(category, {
      latitude:    gpsLat,
      longitude:   gpsLon,
      fullAddress: `${gpsLat.toFixed(5)}, ${gpsLon.toFixed(5)}`,
    });
    if (!ok) return;
    setSaved(getQuickAddress(category));
    flashSaved();
  }, [category, gpsLat, gpsLon, flashSaved]);

  const remove = useCallback(() => {
    clearQuickAddress(category);
    setSaved(null);
  }, [category]);

  const label = category === 'home' ? t('navigation.settings_home_label') : t('navigation.settings_work_label');
  const statusText = savedFlash
    ? t('navigation.settings_saved')
    : (saved?.fullAddress ?? saved?.name ?? t('navigation.settings_not_set'));

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-cyan-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-slate-200">{label}</div>
          <div className={`text-[10px] truncate ${savedFlash ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
            {statusText}
          </div>
        </div>
        {saved && (
          <button
            type="button"
            onClick={remove}
            aria-label={t('navigation.settings_delete')}
            className="p-1.5 rounded-lg hover:bg-slate-700/60 active:scale-90 transition-all shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5 text-slate-400" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-2.5 h-9 rounded-lg bg-slate-900/60 border border-slate-700/50 min-w-0">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (results.length) setOpen(true); }}
            placeholder={t('navigation.settings_placeholder')}
            aria-label={label}
            className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-slate-200 placeholder:text-slate-600"
          />
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500 shrink-0" />}
        </div>
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={gpsLat == null || gpsLon == null}
          className="flex items-center gap-1.5 px-2.5 h-9 rounded-lg bg-slate-900/60 border border-slate-700/50 text-[11px] font-bold text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all shrink-0"
        >
          <Navigation2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t('navigation.settings_use_current_location')}</span>
        </button>
      </div>

      {open && results.length > 0 && (
        <div className="rounded-lg overflow-hidden border border-slate-700/50 bg-slate-900/80">
          {results.map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => pick(loc)}
              className="w-full flex items-start gap-2 px-2.5 py-2 hover:bg-slate-800/80 active:bg-slate-800/80 text-left transition-colors border-b border-slate-800/60 last:border-0"
            >
              <MapPin className="w-3.5 h-3.5 mt-0.5 text-cyan-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-200 truncate">{loc.name}</div>
                {loc.address && <div className="text-[10px] text-slate-500 truncate">{loc.address}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && !loading && query.trim().length >= 2 && results.length === 0 && (
        <div className="px-2.5 py-2 rounded-lg text-center text-[10px] font-semibold text-slate-500 bg-slate-900/60 border border-slate-700/50">
          {t('navigation.settings_no_results')}
        </div>
      )}
    </div>
  );
});

export const HomeWorkAddressPanel = memo(function HomeWorkAddressPanel() {
  const gps = useGPSLocation();
  const gpsLat = gps?.latitude ?? null;
  const gpsLon = gps?.longitude ?? null;

  return (
    <div className="flex flex-col gap-3 p-1">
      <QuickAddressRow category="home" icon={Home}      gpsLat={gpsLat} gpsLon={gpsLon} />
      <QuickAddressRow category="work" icon={Briefcase}  gpsLat={gpsLat} gpsLon={gpsLon} />
    </div>
  );
});
