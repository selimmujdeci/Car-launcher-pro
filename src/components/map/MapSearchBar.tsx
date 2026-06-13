/**
 * MapSearchBar — tam ekran haritada adres/yer arama çubuğu.
 *
 * - searchPlaces() (offline geçmiş → SQLite POI → Nominatim online) tek kaynak.
 * - Her sonuçta km: TEK kanonik haversine (_haversineMeters) + TEK format
 *   (formatDistance) — Benzinlik/İş/Ev km'leriyle AYNI kaynak.
 * - Sonuç seçilince startNavigation() → FullMapView rota önizlemesini açar.
 *
 * İnternetsiz (head unit): online Nominatim atlanır, offline/SQLite sonuçları
 * gelir (fail-soft). GPS yoksa km gizlenir.
 */
import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, MapPin, Loader2 } from 'lucide-react';
import { searchPlaces } from '../../platform/mapService';
import type { StoredLocation } from '../../platform/offlineSearchService';
import { startNavigation, formatDistance } from '../../platform/navigationService';
import { _haversineMeters } from '../../platform/gps/gpsMath';

export const MapSearchBar = memo(function MapSearchBar({
  gpsLat, gpsLon, hidden = false,
}: {
  gpsLat: number | null;
  gpsLon: number | null;
  /** Navigasyon/önizleme aktifken gizle — rota paneliyle çakışmasın. */
  hidden?: boolean;
}) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<StoredLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  // Yarış koşulu koruması: yalnız EN SON isteğin sonucu uygulanır.
  const reqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); setOpen(false); return; }
    setLoading(true);
    const myReq = ++reqRef.current;
    const t = setTimeout(async () => {
      try {
        const r = await searchPlaces(q, gpsLat ?? undefined, gpsLon ?? undefined, 8);
        if (myReq !== reqRef.current) return;        // bayat istek — yok say
        setResults(r);
        setOpen(true);
      } catch {
        if (myReq === reqRef.current) setResults([]);
      } finally {
        if (myReq === reqRef.current) setLoading(false);
      }
    }, 350);  // debounce — her tuşta ağ çağrısı yok
    return () => clearTimeout(t);
  }, [query, gpsLat, gpsLon]);

  const pick = useCallback((loc: StoredLocation) => {
    startNavigation({
      id: loc.id, name: loc.name,
      latitude: loc.lat, longitude: loc.lng,
      type: 'history',
    });
    setQuery('');
    setResults([]);
    setOpen(false);
  }, []);

  const clear = useCallback(() => {
    setQuery(''); setResults([]); setOpen(false);
  }, []);

  if (hidden) return null;

  return (
    <div
      className="absolute z-[37] pointer-events-auto"
      style={{
        top:       'calc(var(--sat, 0px) + 12px)',
        left:      '50%',
        transform: 'translateX(-50%)',
        width:     'min(440px, 64vw)',
      }}
    >
      {/* Arama girişi — adaptif --oem-* (gündüz açık/koyu yazı, gece tersi).
          Opak yüzey: harita üstünde kontrast garantisi + Mali-400 dostu (blur yok). */}
      <div
        className="flex items-center gap-2 px-3 h-11 rounded-2xl"
        style={{
          background:      'var(--oem-surface-1)',
          border:          '1px solid var(--oem-ink-4)',
          boxShadow:       '0 12px 30px rgba(0,0,0,0.25)',
        }}
      >
        <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--oem-accent)' }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true); }}
          placeholder="Adres veya yer ara…"
          className="flex-1 bg-transparent outline-none text-sm font-semibold text-[color:var(--oem-ink)] placeholder:text-[color:var(--oem-ink-4)]"
          aria-label="Adres ara"
        />
        {loading && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-[color:var(--oem-ink-3)]" />}
        {!loading && query.length > 0 && (
          <button onClick={clear} aria-label="Temizle" className="flex-shrink-0 active:scale-90 transition-all">
            <X className="w-4 h-4 text-[color:var(--oem-ink-3)]" />
          </button>
        )}
      </div>

      {/* Sonuç listesi */}
      {open && results.length > 0 && (
        <div
          className="mt-2 rounded-2xl overflow-hidden overflow-y-auto"
          style={{
            maxHeight:      '52vh',
            background:     'var(--oem-surface-1)',
            border:         '1px solid var(--oem-ink-4)',
            boxShadow:      '0 20px 50px rgba(0,0,0,0.3)',
          }}
        >
          {results.map((loc) => {
            const km = (gpsLat != null && gpsLon != null)
              ? formatDistance(_haversineMeters(gpsLat, gpsLon, loc.lat, loc.lng))
              : null;
            return (
              <button
                key={loc.id}
                onClick={() => pick(loc)}
                className="w-full flex items-center gap-3 px-3 py-2.5 last:border-0 active:scale-[0.99] transition-all text-left"
                style={{ borderBottom: '1px solid var(--oem-ink-4)' }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--oem-accent-soft)', border: '1px solid var(--oem-accent-glow)' }}
                >
                  <MapPin className="w-4 h-4" style={{ color: 'var(--oem-accent)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold truncate text-[color:var(--oem-ink)]">{loc.name}</div>
                  {loc.address && <div className="text-[10px] truncate text-[color:var(--oem-ink-3)]">{loc.address}</div>}
                </div>
                {km && (
                  <span className="text-[12px] font-black tabular-nums flex-shrink-0" style={{ color: 'var(--oem-accent)' }}>
                    {km}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Sonuç yok bilgisi (sorgu var ama eşleşme yok) */}
      {open && !loading && query.trim().length >= 2 && results.length === 0 && (
        <div
          className="mt-2 px-3 py-3 rounded-2xl text-center text-[11px] font-bold text-[color:var(--oem-ink-3)]"
          style={{ background: 'var(--oem-surface-1)', border: '1px solid var(--oem-ink-4)' }}
        >
          Sonuç bulunamadı
        </div>
      )}
    </div>
  );
});
