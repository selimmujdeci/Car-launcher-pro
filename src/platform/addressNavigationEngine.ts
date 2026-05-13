/**
 * Address Navigation Engine — serbest adres navigasyon orkestratörü.
 *
 * Zincir: metin → geocode/nearby → tek sonuç → direkt rota
 *                               → çok sonuç → kullanıcı seçimi
 *                               → sonuç yok → hata + öneri
 *
 * Mimari: module-level push state (deviceApi / obdService ile aynı desen).
 * React bileşenleri useAddressNavState() ile subscribe olur.
 */

import { useState, useEffect } from 'react';
import { geocodeAddress, searchNearby, type GeoResult } from './geocodingService';
import { startNavigation } from './navigationService';
import { logError } from './crashLogger';
import { searchOffline, saveSearchQuery } from './offlineSearchService';
import { searchOfflinePlaces } from './offlineDataService';

/* ── Geocoding önbellek (offline fallback) ───────────────── */

const _GEO_CACHE_KEY     = 'caros-geo-cache';
const _GEO_CACHE_MAX     = 120;
const _GEO_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 gün

interface _GeoCacheEntry { query: string; results: GeoResult[]; savedAt: number; }

const _TR: Record<string, string> = {
  'İ':'i','ı':'i','Ş':'s','ş':'s','Ğ':'g','ğ':'g','Ü':'u','ü':'u','Ö':'o','ö':'o','Ç':'c','ç':'c',
};
function _norm(s: string): string {
  return s.toLowerCase().replace(/[İışŞğĞüÜöÖçÇ]/g, c => _TR[c] ?? c).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function _dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tg = (t: string) => { const s = new Set<string>(); const p = `  ${t}  `; for (let i = 0; i < p.length - 2; i++) s.add(p.slice(i, i + 3)); return s; };
  const ta = tg(a); const tb = tg(b);
  let ix = 0; for (const t of ta) { if (tb.has(t)) ix++; }
  return (2 * ix) / (ta.size + tb.size);
}

function _saveGeoCache(query: string, results: GeoResult[]): void {
  if (!results.length) return;
  try {
    const raw: _GeoCacheEntry[] = JSON.parse(localStorage.getItem(_GEO_CACHE_KEY) ?? '[]');
    const q = _norm(query);
    const filtered = raw.filter(e => e.query !== q && Date.now() - e.savedAt < _GEO_CACHE_MAX_AGE);
    filtered.unshift({ query: q, results, savedAt: Date.now() });
    localStorage.setItem(_GEO_CACHE_KEY, JSON.stringify(filtered.slice(0, _GEO_CACHE_MAX)));
  } catch { /* quota */ }
}

function _searchGeoCache(query: string): GeoResult[] {
  try {
    const raw: _GeoCacheEntry[] = JSON.parse(localStorage.getItem(_GEO_CACHE_KEY) ?? '[]');
    const q = _norm(query);
    const valid = raw.filter(e => Date.now() - e.savedAt < _GEO_CACHE_MAX_AGE);
    // Exact / prefix / substring önce
    for (const e of valid) {
      if (e.query === q || e.query.startsWith(q) || q.startsWith(e.query) || e.query.includes(q) || q.includes(e.query)) {
        return e.results;
      }
    }
    // Fuzzy (Dice ≥ 0.5)
    let best: _GeoCacheEntry | null = null;
    let bestSc = 0;
    for (const e of valid) {
      const sc = _dice(q, e.query);
      if (sc > bestSc) { bestSc = sc; best = e; }
    }
    return bestSc >= 0.5 && best ? best.results : [];
  } catch { return []; }
}

/* ── Types ───────────────────────────────────────────────── */

export type AddressNavPhase =
  | 'idle'        // gösterilmiyor
  | 'searching'   // Nominatim/Overpass isteği uçuşta
  | 'selecting'   // birden fazla sonuç — kullanıcı seçim bekliyor
  | 'confirmed'   // navigasyon başladı
  | 'error';      // geocode başarısız veya sonuç yok

export interface AddressNavState {
  phase:        AddressNavPhase;
  query:        string;           // kullanıcının sorgusu (görüntüleme için)
  results:      GeoResult[];      // 0 = error, 1 = auto-confirmed, 2+ = selecting
  selected:     GeoResult | null; // confirmed aşamasında seçilen
  errorMessage: string | null;
  suggestions:  string[];         // hata durumunda alternatif öneriler
  /** true olduğunda MainLayout harita görünümünü açar */
  shouldOpenMap: boolean;
}

/* ── Module state ────────────────────────────────────────── */

const INITIAL: AddressNavState = {
  phase:        'idle',
  query:        '',
  results:      [],
  selected:     null,
  errorMessage: null,
  suggestions:  [],
  shouldOpenMap: false,
};

let _state: AddressNavState = { ...INITIAL };
const _listeners            = new Set<(s: AddressNavState) => void>();
let   _searchGeneration     = 0; // arama iptali için nesil sayacı
let   _activeTimerId: ReturnType<typeof setTimeout> | null = null; // Zero-Leak: tek aktif auto-dismiss timer

/* ── Internal helpers ────────────────────────────────────── */

function _push(partial: Partial<AddressNavState>): void {
  _state = { ..._state, ...partial };
  const snap = { ..._state };
  _listeners.forEach((fn) => fn(snap));
}

function _confirmResult(result: GeoResult): void {
  // Uçuştaki tüm asenkron aramaları iptal et — onay anında gen sıfırla
  _searchGeneration++;

  startNavigation({
    id:        result.id,
    name:      result.name,
    latitude:  result.lat,
    longitude: result.lng,
    type:      'history',
  });

  // Offline arama veritabanına kaydet — gelecek offline sorguları için
  saveSearchQuery(_state.query, {
    name:    result.name,
    address: result.fullName,
    lat:     result.lat,
    lng:     result.lng,
  }).catch(() => { /* IndexedDB erişim hatası — sessizce devam */ });

  _push({
    phase:        'confirmed',
    selected:     result,
    shouldOpenMap: true,
  });

  // Zero-Leak: önceki auto-dismiss timer'ı temizle
  if (_activeTimerId !== null) { clearTimeout(_activeTimerId); _activeTimerId = null; }
  // Kart 4 saniye sonra kapanır
  _activeTimerId = setTimeout(() => {
    _activeTimerId = null;
    _push({ phase: 'idle', shouldOpenMap: false });
  }, 4_000);
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Ana giriş noktası: metin veya yakın-hedef sorgusunu çözer ve navigasyonu başlatır.
 *
 * destination özel değerleri:
 *   '__nearby_gas__'     → Overpass yakın benzinlik
 *   '__nearby_parking__' → Overpass yakın otopark
 */
export function resolveAndNavigate(
  destination: string,
  location?: { lat: number; lng: number },
): void {
  const gen = ++_searchGeneration;

  _push({
    phase:        'searching',
    query:        destination === '__nearby_gas__'     ? 'En yakın benzinlik'
                : destination === '__nearby_parking__' ? 'En yakın otopark'
                : destination,
    results:      [],
    selected:     null,
    errorMessage: null,
    suggestions:  [],
    shouldOpenMap: false,
  });

  const isNearby = destination === '__nearby_gas__' || destination === '__nearby_parking__';

  // ── Offline-first lookup: internet yoksa önbellek + IndexedDB ────
  if (!isNearby && !navigator.onLine) {
    Promise.all([
      searchOffline(destination, 3),
      Promise.resolve(_searchGeoCache(destination)),
      searchOfflinePlaces(destination, 5),
    ]).then(([offlineHits, cacheHits, poiHits]) => {
      if (gen !== _searchGeneration) return;

      // 1. IndexedDB geçmiş — daha önce navigasyon başlatılan yerler
      if (offlineHits.length > 0 && offlineHits[0].score >= 0.55) {
        const best = offlineHits[0].location;
        const result: GeoResult = {
          id: best.id, name: best.name,
          fullName: best.address ?? best.name,
          lat: best.lat, lng: best.lng, type: 'address',
        };
        _push({ results: [result] });
        _confirmResult(result);
        return;
      }

      // 2. Türkiye POI veritabanı — offlineDataService'ten indirilen mahalle/POI
      if (poiHits.length > 0) {
        const results: GeoResult[] = poiHits.map(p => ({
          id:       p.id,
          name:     p.name,
          fullName: p.name,
          lat:      p.lat,
          lng:      p.lon,
          type:     'address' as const,
        }));
        if (results.length === 1) {
          _push({ results });
          _confirmResult(results[0]);
        } else {
          _push({ phase: 'selecting', results });
        }
        return;
      }

      // 3. Geocoding cache — daha önce online'da arama yapılan yerler
      if (cacheHits.length > 0) {
        if (cacheHits.length === 1) {
          _push({ results: cacheHits });
          _confirmResult(cacheHits[0]);
        } else {
          _push({ phase: 'selecting', results: cacheHits });
        }
        return;
      }

      // Hiçbir önbellekte yok
      _push({
        phase:        'error',
        errorMessage: 'İnternet yok — önbellekte bulunamadı',
        suggestions:  [],
      });
      if (_activeTimerId !== null) { clearTimeout(_activeTimerId); _activeTimerId = null; }
      _activeTimerId = setTimeout(() => {
        _activeTimerId = null;
        if (gen === _searchGeneration) _push({ phase: 'idle' });
      }, 5_000);
    }).catch(() => {
      if (gen !== _searchGeneration) return;
      _push({ phase: 'error', errorMessage: 'Çevrimdışı arama hatası', suggestions: [] });
    });
    return;
  }

  const fetch = isNearby
    ? (location
        ? searchNearby(
            destination === '__nearby_gas__' ? 'fuel' : 'parking',
            location.lat,
            location.lng,
          )
        : Promise.reject(new Error('Konum bilgisi gerekli'))
      )
    : geocodeAddress(destination, location?.lat, location?.lng);

  fetch
    .then((results) => {
      if (gen !== _searchGeneration) return; // iptal edildi

      // Başarılı Nominatim sonuçlarını cache'e yaz (offline fallback için)
      if (!isNearby && results.length) _saveGeoCache(destination, results);

      if (!results.length) {
        _push({
          phase:        'error',
          errorMessage: `"${_state.query}" için sonuç bulunamadı`,
          suggestions:  isNearby ? [] : [
            `${destination}, Mersin`,
            `${destination}, İstanbul`,
            `${destination}, Ankara`,
          ],
        });
        // Hata kartı 6 saniye sonra kapanır
        if (_activeTimerId !== null) { clearTimeout(_activeTimerId); _activeTimerId = null; }
        _activeTimerId = setTimeout(() => {
          _activeTimerId = null;
          if (gen === _searchGeneration) _push({ phase: 'idle' });
        }, 6_000);
        return;
      }

      if (results.length === 1) {
        // Tek sonuç: direkt rota
        _push({ results });
        _confirmResult(results[0]);
        return;
      }

      // Çok sonuç: kullanıcı seçimi
      _push({ phase: 'selecting', results });
    })
    .catch((e: unknown) => {
      if (gen !== _searchGeneration) return;
      logError('AddressNavEngine:resolve', e);
      _push({
        phase:        'error',
        errorMessage: 'Bağlantı hatası — ağ bağlantısını kontrol edin',
        suggestions:  [],
      });
      if (_activeTimerId !== null) { clearTimeout(_activeTimerId); _activeTimerId = null; }
      _activeTimerId = setTimeout(() => {
        _activeTimerId = null;
        if (gen === _searchGeneration) _push({ phase: 'idle' });
      }, 6_000);
    });
}

/**
 * Kullanıcı seçim kartından bir sonuç seçti.
 */
export function selectAddressResult(index: number): void {
  const result = _state.results[index];
  if (!result) return;
  _confirmResult(result);
}

/**
 * Navigasyon kartını kapat.
 */
export function dismissAddressNav(): void {
  _searchGeneration++; // uçuştaki arama iptal
  if (_activeTimerId !== null) { clearTimeout(_activeTimerId); _activeTimerId = null; }
  _push({ ...INITIAL });
}

/**
 * shouldOpenMap bayrağını sıfırla — MainLayout haritayı açtıktan sonra çağırır.
 */
export function clearOpenMapFlag(): void {
  _push({ shouldOpenMap: false });
}

/**
 * Non-React abonelik. cleanup fonksiyonu döner.
 */
export function onAddressNavState(fn: (s: AddressNavState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state });
  return () => { _listeners.delete(fn); };
}

/* ── React hook ──────────────────────────────────────────── */

export function useAddressNavState(): AddressNavState {
  const [state, setState] = useState<AddressNavState>(() => ({ ..._state }));
  useEffect(() => {
    setState({ ..._state });
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
