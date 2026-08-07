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

/* ── Yerel (cihaz-içi) arama — ONLINE sonuç yokken de kullanılır ────────────
 *
 * SAHA KUSURU (2026-08-03, kullanıcı: "Mersin Hemşirenin Park Piknik Yeri'ni
 * bulamıyor, birçok yer böyle"): motor ONLINE iken YALNIZ Nominatim serbest
 * metin aramasına bakıyordu. Nominatim Türkçe POI adlarında sık başarısız olur;
 * 0 sonuç dönünce motor doğrudan "bulunamadı" diyordu — oysa cihazda ZATEN
 * indirilmiş POI veritabanı, navigasyon geçmişi ve geocode önbelleği vardı ve
 * bunlara SADECE internet YOKKEN bakılıyordu. Yani internet varken ürün kendi
 * verisini görmezden geliyordu (harita arama çubuğu `searchPlaces` ile bunları
 * kullanıyordu → aynı yer bir ekranda bulunup diğerinde bulunamıyordu).
 *
 * Burada YENİ bir arama otoritesi KURULMAZ: çevrimdışı dalın kullandığı ÜÇ
 * kaynağın aynısı, aynı eşiklerle çağrılır. */
async function _localSearch(destination: string): Promise<GeoResult[]> {
  const [offlineHits, poiHits] = await Promise.all([
    searchOffline(destination, 3).catch(() => []),
    searchOfflinePlaces(destination, 5).catch(() => []),
  ]);

  const out: GeoResult[] = [];

  // 1. Navigasyon geçmişi — çevrimdışı dalla AYNI 0.55 güven eşiği
  for (const h of offlineHits) {
    if (h.score < 0.55) continue;
    out.push({
      id: h.location.id, name: h.location.name,
      fullName: h.location.address ?? h.location.name,
      lat: h.location.lat, lng: h.location.lng, type: 'address',
      source: 'offline',
    });
  }

  // 2. İndirilmiş Türkiye POI veritabanı
  for (const p of poiHits) {
    out.push({
      id: p.id, name: p.name, fullName: p.name,
      lat: p.lat, lng: p.lon, type: 'address', source: 'offline',
    });
  }

  // 3. Daha önce online bulunmuş sonuçların önbelleği
  out.push(..._searchGeoCache(destination));

  // Aynı yer birden çok kaynaktan gelebilir — koordinata göre tekille (~11 m).
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ── Şehir önerileri — UYDURMA yapmadan ─────────────────────────────────────
 * Eski hâli sorguya körlemesine `, Mersin` `, İstanbul` `, Ankara` ekliyordu.
 * Sorgu ZATEN "Mersin ..." ile başlıyorsa üretilen öneri "Mersin ..., Mersin"
 * oluyordu — kullanıcıya sunulan üç seçenekten biri anlamsız, üçü de
 * doğrulanmamış. Sorguda geçen şehir tekrar EKLENMEZ. */
const _SUGGEST_CITIES = ['Mersin', 'İstanbul', 'Ankara', 'İzmir'] as const;

function _citySuggestions(destination: string): string[] {
  const q = _norm(destination);
  return _SUGGEST_CITIES
    .filter((c) => !q.includes(_norm(c)))
    .slice(0, 3)
    .map((c) => `${destination}, ${c}`);
}

/** "Bulunamadı" hata kartını basar ve 6 sn sonra idle'a döner. */
function _failNoResult(gen: number, destination: string, isNearby: boolean): void {
  _push({
    phase:        'error',
    errorMessage: `"${_state.query}" için sonuç bulunamadı`,
    suggestions:  isNearby ? [] : _citySuggestions(destination),
  });
  if (_activeTimerId !== null) { clearTimeout(_activeTimerId); _activeTimerId = null; }
  _activeTimerId = setTimeout(() => {
    _activeTimerId = null;
    if (gen === _searchGeneration) _push({ phase: 'idle' });
  }, 6_000);
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
  }, false, 'USER_VOICE');   // kütük #429: sesli/adres onayı kullanıcı iradesidir

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
 * resolveAndNavigate'in NAVIGATION-P0-2 ile eklenen opsiyonel sonuç callback'i.
 * Geriye dönük UYUMLU — çağıran vermiyorsa davranış birebir aynı kalır.
 * Yalnız TTS/telemetri gibi yan etkiler için; state zaten useAddressNavState
 * üzerinden akar, bu callback state'in YERİNE geçmez.
 */
export type AddressNavOutcome = 'confirmed' | 'multiple' | 'empty' | 'error';

/**
 * Ana giriş noktası: metin veya yakın-hedef sorgusunu çözer ve navigasyonu başlatır.
 *
 * destination özel değerleri:
 *   '__nearby_gas__'      → Overpass yakın benzinlik
 *   '__nearby_parking__'  → Overpass yakın otopark
 *   '__nearby_hospital__' → Overpass yakın hastane (NAVIGATION-P0-2)
 */
export function resolveAndNavigate(
  destination: string,
  location?: { lat: number; lng: number },
  onResult?: (outcome: AddressNavOutcome) => void,
): void {
  const gen = ++_searchGeneration;

  _push({
    phase:        'searching',
    query:        destination === '__nearby_gas__'      ? 'En yakın benzinlik'
                : destination === '__nearby_parking__'  ? 'En yakın otopark'
                : destination === '__nearby_hospital__' ? 'En yakın hastane'
                : destination,
    results:      [],
    selected:     null,
    errorMessage: null,
    suggestions:  [],
    shouldOpenMap: false,
  });

  const isNearby = destination === '__nearby_gas__' || destination === '__nearby_parking__' || destination === '__nearby_hospital__';

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
            destination === '__nearby_gas__' ? 'fuel'
              : destination === '__nearby_parking__' ? 'parking'
              : 'hospital',
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
        // Online arama boş döndü → PES ETMEDEN ÖNCE cihazdaki veriye bak.
        // (Nominatim Türkçe POI adlarında sık başarısız olur; POI DB + geçmiş +
        //  önbellek bu boşluğu doldurur — bkz. _localSearch.)
        if (isNearby) { _failNoResult(gen, destination, true); onResult?.('empty'); return; }
        void _localSearch(destination).then((localHits) => {
          if (gen !== _searchGeneration) return;
          if (!localHits.length) { _failNoResult(gen, destination, false); onResult?.('empty'); return; }
          if (localHits.length === 1) {
            _push({ results: localHits });
            _confirmResult(localHits[0]);
            onResult?.('confirmed');
          } else {
            _push({ phase: 'selecting', results: localHits });
            onResult?.('multiple');
          }
        }).catch(() => {
          if (gen !== _searchGeneration) return;
          _failNoResult(gen, destination, false);
          onResult?.('empty');
        });
        return;
      }

      if (results.length === 1 && !results[0].relaxed) {
        // Tek sonuç: direkt rota
        _push({ results });
        _confirmResult(results[0]);
        onResult?.('confirmed');
        return;
      }

      /* GEVŞETİLMİŞ sonuç ASLA otomatik rotaya çevrilmez.
         Sonuç kullanıcının SÖYLEDİĞİ sorguyla değil, kısaltılmış bir
         varyantıyla bulunmuştur (bkz. geocodingService.relaxQueryVariants) →
         doğru yer olduğu KANITLANMIŞ değildir. Tek aday olsa bile onay
         listesi gösterilir: yanlış yere sessizce götürmek, bulamamaktan
         daha kötüdür. */
      if (results.length === 1) {
        _push({ phase: 'selecting', results });
        onResult?.('multiple');
        return;
      }

      // Çok sonuç: kullanıcı seçimi
      _push({ phase: 'selecting', results });
      onResult?.('multiple');
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
      onResult?.('error');
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
