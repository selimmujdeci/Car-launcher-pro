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
import { geocodeAddress, searchNearby, readGeocodeTrace, type GeoResult } from './geocodingService';
import { startNavigation } from './navigationService';
import { logError } from './crashLogger';
import { searchOffline, saveSearchQuery } from './offlineSearchService';
import { searchOfflinePlaces } from './offlineDataService';
import {
  describeQueryShape,
  type AddressSearchOutcome,
  type AddressSearchStage,
  type AddressSearchSurface,
} from './geo/addressSearchLedger';
import { recordAddressSearch, noteAddressSearchChoice } from './geo/addressSearchLedgerStore';
import { applyLocationBias } from './geo/locationBiasGate';

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
async function _localSearch(
  destination: string,
  location?: { lat: number; lng: number },
): Promise<GeoResult[]> {
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
  const unique = out.filter((r) => {
    const k = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return _bias(destination, unique, location);
}

/* ── Konum/şehir kapısı — cihaz-içi listeler için ───────────────────────────
 *
 * Cihaz-içi sonuçlar sürücüye çevrimiçi sonuçlarla AYNI kartta sunulur →
 * aynı kural uygulanmalıdır: şehir belirtilmişse o şehir kesin, belirtilmemişse
 * en yakın önce. Yeni otorite KURULMAZ — `geocodeAddress`in kullandığı SAF
 * fonksiyonun aynısı çağrılır (iki yolun ayrışması bu projenin tekrar eden
 * saha kusuruydu; kütük #332/#544).
 *
 * `cityUnverified` burada KONMAZ: cihaz-içi kayıtların çoğu (POI adı, geçmiş
 * girdisi) il bilgisi taşımaz ve hepsini onaya düşürmek çevrimdışı yolu
 * kullanılamaz hâle getirirdi. Yanlış İL kanıtı olan aday yine ELENİR. */
function _bias(
  query: string,
  results: GeoResult[],
  location?: { lat: number; lng: number },
): GeoResult[] {
  return applyLocationBias(query, results, location ?? null).kept.map((c) => (
    c.distanceKm === null && !c.farFromUser
      ? c.item
      : {
          ...c.item,
          ...(c.distanceKm !== null ? { distanceKm: c.distanceKm } : {}),
          ...(c.farFromUser ? { farFromUser: true } : {}),
        }
  ));
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

/* ── Kanıt defteri kaydı ────────────────────────────────────────────────────
 *
 * TEŞHİS TURU (2026-08-11): bu zincirin hiçbir denemesi kayıt altına
 * ALINMIYORDU; `saveSearchQuery` yalnız BAŞARILI ve SEÇİLMİŞ sonucu yazıyordu.
 * Yani "aradım bulamadı" şikâyeti üründe hiçbir iz bırakmıyordu.
 *
 * Kayıt yüzey başına TEKTİR: aşağıdaki `_record` her terminal noktada bir kez
 * çağrılır. `geocodeAddress` kendi kaydını YAZMAZ (iki yüzeyden çağrıldığı için
 * çifte sayım olurdu) — yalnız izini `readGeocodeTrace` ile buraya taşır.
 *
 * GİZLİLİK: sorgu METNİ deftere GİRMEZ, yalnız biçimi (`describeQueryShape`).
 */
function _record(
  destination: string,
  outcome:     AddressSearchOutcome,
  surface:     AddressSearchSurface,
  results:     readonly GeoResult[] | null,
  stageHint:   AddressSearchStage | null,
  hadLocation: boolean,
): void {
  const trace = results !== null ? readGeocodeTrace(results) : null;
  recordAddressSearch({
    surface,
    shape:   describeQueryShape(destination),
    /* Sorgu buraya AYRIŞTIRICIDAN GEÇMİŞ gelir (commandParser →
       tryParseNavAddress) ama ham metni GÖRMÜYORUZ → bozulup bozulmadığını
       İDDİA EDEMEYİZ. `null` = ölçülmedi; defter bunu QUERY_INTEGRITY kanıt
       boşluğu olarak sayar ve LAB'da "önce bunu ölç" listesine düşürür.
       (Ölçüm 2026-08-11: ayrıştırıcının bazı biçimlerde "Sokak" sözcüğünü
       "Mahallesi" ile değiştirdiği SAF testte kanıtlandı — o yüzden bu boşluk
       kapatılması gereken gerçek bir borçtur, kozmetik değil.) */
    queryRewritten:      null,
    queryLostRoadType:   null,
    stage:               trace?.stage ?? stageHint ?? 'NONE',
    resultCount:         results?.length ?? 0,
    rejectedCount:       trace?.rejectedCount ?? null,
    providerMs:          trace?.providerMs ?? null,
    fastFailHit:         trace?.fastFailHit ?? null,
    hadLocation:         trace?.hadLocation ?? hadLocation,
    online:              trace?.online ?? (typeof navigator === 'undefined' ? null : navigator.onLine),
    fallbackQueryUsable: trace?.fallbackQueryUsable ?? null,
    biasDroppedCount:    trace?.biasDroppedCount ?? null,
    outcome,
  }, 'addressNavigationEngine.resolveAndNavigate');
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
    query:        destination === '__nearby_gas__'       ? 'En yakın benzinlik'
                : destination === '__nearby_parking__'   ? 'En yakın otopark'
                : destination === '__nearby_hospital__'  ? 'En yakın hastane'
                : destination === '__nearby_rest_area__' ? 'En yakın dinlenme tesisi'
                : destination,
    results:      [],
    selected:     null,
    errorMessage: null,
    suggestions:  [],
    shouldOpenMap: false,
  });

  const isNearby = destination === '__nearby_gas__' || destination === '__nearby_parking__'
    || destination === '__nearby_hospital__' || destination === '__nearby_rest_area__';
  const surface: AddressSearchSurface = isNearby ? 'NEARBY_SHORTCUT' : 'VOICE_ADDRESS';
  const hadLoc  = location != null;

  // ── Offline-first lookup: internet yoksa önbellek + IndexedDB ────
  if (!isNearby && !navigator.onLine) {
    Promise.all([
      searchOffline(destination, 3),
      Promise.resolve(_searchGeoCache(destination)),
      searchOfflinePlaces(destination, 5),
    ]).then(([offlineHits, cacheHits, poiHits]) => {
      if (gen !== _searchGeneration) return;

      /* Çevrimdışı dal da AYNI konum/şehir kapısından geçer — yoksa aynı sorgu
         internet varken başka, yokken başka yere götürürdü. */
      // 1. IndexedDB geçmiş — daha önce navigasyon başlatılan yerler
      if (offlineHits.length > 0 && offlineHits[0].score >= 0.55) {
        const best = offlineHits[0].location;
        const hist = _bias(destination, [{
          id: best.id, name: best.name,
          fullName: best.address ?? best.name,
          lat: best.lat, lng: best.lng, type: 'address',
        }], location);
        /* Kapı geçmiş kaydını elediyse (yanlış il) bu katman cevap VERMEMİŞ
           sayılır ve sıradaki kaynağa bakılır. */
        if (hist.length === 1 && !hist[0].farFromUser) {
          _record(destination, 'RESOLVED_AUTO', surface, null, 'LOCAL_HISTORY', hadLoc);
          _push({ results: hist });
          _confirmResult(hist[0]);
          return;
        }
        if (hist.length === 1) {
          _record(destination, 'AWAITING_CHOICE', surface, null, 'LOCAL_HISTORY', hadLoc);
          _push({ phase: 'selecting', results: hist });
          return;
        }
      }

      // 2. Türkiye POI veritabanı — offlineDataService'ten indirilen mahalle/POI
      if (poiHits.length > 0) {
        const results = _bias(destination, poiHits.map(p => ({
          id:       p.id,
          name:     p.name,
          fullName: p.name,
          lat:      p.lat,
          lng:      p.lon,
          type:     'address' as const,
        })), location);
        if (results.length > 0) {
          const auto = results.length === 1 && !results[0].farFromUser;
          _record(destination, auto ? 'RESOLVED_AUTO' : 'AWAITING_CHOICE',
                  surface, null, 'LOCAL_POI', hadLoc);
          if (auto) {
            _push({ results });
            _confirmResult(results[0]);
          } else {
            _push({ phase: 'selecting', results });
          }
          return;
        }
      }

      // 3. Geocoding cache — daha önce online'da arama yapılan yerler
      const cacheGated = _bias(destination, cacheHits, location);
      if (cacheGated.length > 0) {
        const auto = cacheGated.length === 1 && !cacheGated[0].farFromUser;
        _record(destination, auto ? 'RESOLVED_AUTO' : 'AWAITING_CHOICE',
                surface, null, 'GEO_CACHE', hadLoc);
        if (auto) {
          _push({ results: cacheGated });
          _confirmResult(cacheGated[0]);
        } else {
          _push({ phase: 'selecting', results: cacheGated });
        }
        return;
      }

      // Hiçbir önbellekte yok
      _record(destination, 'EMPTY', surface, null, 'NONE', hadLoc);
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
      _record(destination, 'PROVIDER_ERROR', surface, null, 'NONE', hadLoc);
      _push({ phase: 'error', errorMessage: 'Çevrimdışı arama hatası', suggestions: [] });
    });
    return;
  }

  const fetch = isNearby
    ? (location
        ? searchNearby(
            destination === '__nearby_gas__' ? 'fuel'
              : destination === '__nearby_parking__' ? 'parking'
              : destination === '__nearby_rest_area__' ? 'rest_area'
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
        // Online arama boş döndü → PES ETMEDEN ÖNCE cihazdaki veriye bak
        // (Nominatim Türkçe POI adlarında sık başarısız olur — bkz. _localSearch).
        if (isNearby) {
          _record(destination, 'EMPTY', surface, results, 'NONE', hadLoc);
          _failNoResult(gen, destination, true); onResult?.('empty'); return;
        }
        void _localSearch(destination, location).then((localHits) => {
          if (gen !== _searchGeneration) return;
          /* Çevrimiçi zincir boş döndü; cihaz-içi arama SON söz. Kayıt burada
             yazılır ki "online 0 ama cihazda vardı" ayrımı sahada görünsün.
             İz (`trace`) çevrimiçi zincirin ölçümünü taşımaya devam eder. */
          const stage: AddressSearchStage = localHits.length === 0
            ? 'NONE'
            : (localHits[0].type === 'address' ? 'LOCAL_HISTORY' : 'LOCAL_POI');
          const localAuto = localHits.length === 1 && !localHits[0].farFromUser;
          const outcome: AddressSearchOutcome = localHits.length === 0
            ? 'EMPTY' : localAuto ? 'RESOLVED_AUTO' : 'AWAITING_CHOICE';
          _record(destination, outcome, surface, localHits.length ? null : results, stage, hadLoc);
          if (!localHits.length) { _failNoResult(gen, destination, false); onResult?.('empty'); return; }
          if (localAuto) {
            _push({ results: localHits });
            _confirmResult(localHits[0]);
            onResult?.('confirmed');
          } else {
            _push({ phase: 'selecting', results: localHits });
            onResult?.('multiple');
          }
        }).catch(() => {
          if (gen !== _searchGeneration) return;
          _record(destination, 'PROVIDER_ERROR', surface, results, 'NONE', hadLoc);
          _failNoResult(gen, destination, false);
          onResult?.('empty');
        });
        return;
      }

      /* Otomatik rota YALNIZ kanıtı TAM tek sonuç içindir. Üç işaretten biri
         bile varsa onay istenir (aşağıdaki dala düşer). */
      const only = results[0];
      const autoSafe = !only.relaxed && !only.farFromUser && !only.cityUnverified;
      if (results.length === 1 && autoSafe) {
        // Tek sonuç: direkt rota
        _record(destination, 'RESOLVED_AUTO', surface, results, null, hadLoc);
        _push({ results });
        _confirmResult(results[0]);
        onResult?.('confirmed');
        return;
      }

      /* KANITI EKSİK tek sonuç ASLA otomatik rotaya çevrilmez:
          · `relaxed`        — kullanıcının SÖYLEDİĞİ sorguyla değil,
                               kısaltılmış bir varyantıyla bulundu
                               (bkz. geocodingService.relaxQueryVariants).
          · `farFromUser`    — şehir belirtilmemişken kullanıcıdan çok uzakta;
                               "en yakın" kuralı bunu kesin cevap SAYMAZ.
          · `cityUnverified` — şehir açıkça istendi ama sonucun adı hangi ilde
                               olduğunu söylemiyor → doğrulanamadı.
         Tek aday olsa bile onay listesi gösterilir: yanlış yere sessizce
         götürmek, bulamamaktan daha kötüdür. */
      if (results.length === 1) {
        _record(destination, 'AWAITING_CHOICE', surface, results, null, hadLoc);
        _push({ phase: 'selecting', results });
        onResult?.('multiple');
        return;
      }

      // Çok sonuç: kullanıcı seçimi
      _record(destination, 'AWAITING_CHOICE', surface, results, null, hadLoc);
      _push({ phase: 'selecting', results });
      onResult?.('multiple');
    })
    .catch((e: unknown) => {
      if (gen !== _searchGeneration) return;
      logError('AddressNavEngine:resolve', e);
      _record(destination, 'PROVIDER_ERROR', surface, null, 'NONE', hadLoc);
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
  /* Kanıt defteri: sunulan liste KULLANILDI — "sonuç döndü" ile "aradığı yer
     bulundu" arasındaki farkı ölçen tek sinyal budur. */
  noteAddressSearchChoice(true);
  _confirmResult(result);
}

/**
 * Navigasyon kartını kapat.
 */
export function dismissAddressNav(): void {
  /* Seçim listesi AÇIKKEN kapatmak "sunulanlar aradığım yer değildi" demektir.
     Diğer aşamalarda (hata kartı / onaylanmış rota) seçim kanıtı YOKTUR ve
     deftere sahte bir "beğenmedi" yazılmaz. */
  if (_state.phase === 'selecting') noteAddressSearchChoice(false);
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
