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

/* ── Internal helpers ────────────────────────────────────── */

function _push(partial: Partial<AddressNavState>): void {
  _state = { ..._state, ...partial };
  const snap = { ..._state };
  _listeners.forEach((fn) => fn(snap));
}

function _confirmResult(result: GeoResult): void {
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

  // Kart 4 saniye sonra kapanır
  setTimeout(() => {
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

  // ── Offline-first lookup: internet yoksa IndexedDB'den anında cevap ────
  if (!isNearby && !navigator.onLine) {
    searchOffline(destination, 3).then((offlineHits) => {
      if (gen !== _searchGeneration) return;
      if (offlineHits.length > 0 && offlineHits[0].score >= 0.65) {
        const best = offlineHits[0].location;
        const result: GeoResult = {
          id:       best.id,
          name:     best.name,
          fullName: best.address ?? best.name,
          lat:      best.lat,
          lng:      best.lng,
          type:     'address',
        };
        _push({ results: [result] });
        _confirmResult(result);
        return;
      }
      // Sonuç yok veya düşük güven → offline hata göster
      _push({
        phase:        'error',
        errorMessage: 'İnternet yok — bu adres geçmişte aranmadı',
        suggestions:  [],
      });
      setTimeout(() => {
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
        setTimeout(() => {
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
      setTimeout(() => {
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
