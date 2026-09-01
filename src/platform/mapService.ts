// ══════════════════════════════════════════════════════════════════════════
// CarOS Pro — mapService (Facade / Gateway)
//
// Bu dosya artık monolitik God-Object DEĞİL; bir geçittir. Harita yetenekleri
// üç modüle bölündü ve paylaşılan durum bir yaprak modülde toplandı:
//
//   map/_mapState.ts            → useMapStore + M (mutable state) + sabitler
//   map/MapCore.ts              → lifecycle, WebGL context, _freeContext (kritik)
//   map/MapLayerManager.ts      → layer/source/GeoJSON, marker, rota, mood/focus
//   map/MapInteractionManager.ts→ kamera (flyTo/easeTo/jumpTo), driving view, listeners
//
// Dış servisler için TÜM public metodlar AYNI İSİMLERLE buradan re-export edilir
// (geriye dönük uyumlu — import yolları değişmedi). Davranış değişikliği YOK.
// ══════════════════════════════════════════════════════════════════════════
import { searchOffline } from './offlineSearchService';
import type { StoredLocation } from './offlineSearchService';
import { searchGlobal } from './poi/offlinePoiService';
import { NOMINATIM_URL, NOMINATIM_UA } from './map/_mapState';
import { signalWithTimeout } from '../utils/abortCompat';
import { filterNumberedStreetMismatch } from './geocodingService';
import { searchStreetByName, extractStreetQuery, type StreetQuery } from './streetSearchService';
import { describeQueryShape, type AddressSearchStage } from './geo/addressSearchLedger';
import { recordAddressSearch } from './geo/addressSearchLedgerStore';
import { applyLocationBias, detectCitiesInQuery } from './geo/locationBiasGate';
import { resolveCityAnchor } from './geo/cityAnchor';
import { awaitNominatimSlot } from './geo/nominatimRateLimit';
import {
  detectPlaceIntent, rankPlaces, dedupePlacesWithEvidence, type PlaceLayer,
} from './geo/placeQueryModel';
import {
  notAttempted,
  type DedupeEvidence,
  type SearchProviderAttempt,
  type SearchProviderId,
  type SearchProviderOutcome,
  type SearchScoreEvidence,
} from './geo/searchChainModel';
import { searchCategoryNearby } from './geo/overpassCategorySearch';
import { foldTr } from './navigation/core/turkishFold';

// ── Public API re-exports (delegation) ───────────────────────────────────────
export * from './map/MapCore';
export * from './map/MapLayerManager';
export * from './map/MapInteractionManager';
export type { MapConfig } from './map/_mapState';

/* ── Unified Place Search ───────────────────────────────────────────────────
 * Katmanlı offline-önce arama:
 *   1. offlineSearchService  — IndexedDB geçmiş/favoriler (<10ms)
 *   2. offlinePoiService     — SQLite FTS5 global POI DB (offline)
 *   3. Nominatim geocoder    — OSM online (son çare, internet gerekli)
 *
 * Tüm sonuçlar StoredLocation[] olarak döner; çakışan koordinatlar deduplicate edilir.
 */
/* ── Nominatim yanlılığı (P0-NAV-06 · canlı ölçüm 2026-08-23) ────────────────
 *
 * ÖLÇÜLEN KUSUR: bu yüzeyin isteği `countrycodes` ve `viewbox` TAŞIMIYORDU.
 * Sonuç, ürünün kurduğu isteğin AYNISIYLA ölçüldü (konum: Tarsus):
 *   "Bağlar Mahallesi"    → en yakın aday **200 km** (Konya); kullanıcının
 *                           0,8 km ötesindeki Tarsus/Bağlar listede HİÇ YOK
 *   "Cumhuriyet Mahallesi"→ en yakın aday **371 km**
 *   "Şok Market"          → listede **Köln/Almanya 2706 km**
 *   "eczane"              → listede **Musul/Irak 743 km**
 * `locationBiasGate` bu listeyi mesafeye göre SIRALAYABİLİR ama listeye HİÇ
 * girmemiş olan doğru adayı GERİ GETİREMEZ — yanlılık sağlayıcıda olmalıydı.
 *
 * AYNI istekler `countrycodes=tr` + `viewbox(±0,35°)` + `bounded=0` ile:
 *   "Bağlar Mahallesi"    → **0,8 km** (Bağlar Mahallesi, Tarsus, Mersin)
 *   "Cumhuriyet Mahallesi"→ **3,5 km** (Tarsus)
 *   "sifa eczanesi" (Türkçe harfsiz yazılmış) → **2,9 km** "Şifa Eczanesi, Tarsus"
 * `bounded=0` KASITLIDIR: kutu bir SINIR değil YANLILIKTIR — kullanıcı gerçekten
 * uzağa gidiyorsa (İstanbul araması) sonuç yine gelir.
 */
/** Nominatim viewbox yarı-kenarı (derece). Ölçülen değer — ~39 km kuzey-güney. */
const NOMINATIM_VIEWBOX_DEG = 0.35;

/** Türkiye kaba sınır kutusu — `countrycodes=tr` yanlılığı buna göre açılır. */
const TR_BBOX = { minLat: 35.7, maxLat: 42.3, minLng: 25.5, maxLng: 45.0 } as const;

/**
 * Ülke yanlılığı uygulanmalı mı.
 * Konum BİLİNİYOR ve Türkiye dışındaysa uygulanmaz (ürün yurt dışında da
 * arayabilsin); konum yoksa uygulanır — `geocodeAddress` zinciriyle AYNI
 * varsayım (`countrycodes: 'tr'`), iki yüzey ayrışmasın.
 */
function _useTrBias(lat?: number, lng?: number): boolean {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  return lat >= TR_BBOX.minLat && lat <= TR_BBOX.maxLat
      && lng >= TR_BBOX.minLng && lng <= TR_BBOX.maxLng;
}

/* Kısa ömürlü yanıt önbelleği — 350 ms debounce'lu arama çubuğunda kullanıcı
   bir harf silip geri yazdığında ağa TEKRAR çıkılmaz (Nominatim ToS dostu). */
const _NOM_CACHE_TTL_MS = 3 * 60_000;
const _NOM_CACHE_MAX    = 24;
const _nomCache = new Map<string, { at: number; hits: StoredLocation[] }>();

/** Test izolasyonu — önbellek testler arasında SIZMASIN. */
export function _resetMapSearchCacheForTest(): void { _nomCache.clear(); }

/**
 * Sağlayıcı denemesinin sonucunu ÇAĞIRANA taşıyan yazılabilir kova (P0-NAV-08).
 *
 * NEDEN OUT-PARAMETRE: `_nominatimSearch`in dönüş tipi (`StoredLocation[]`)
 * DEĞİŞMEZ → mevcut çağıranların hiçbiri bozulmaz. Eskiden `catch { return [] }`
 * zaman aşımını, ağ hatasını, bozuk JSON'u ve GERÇEK 0 sonucu AYNI değere
 * indiriyordu; dördü farklı işleri işaret ettiği için ayrılmaları gerekir.
 */
interface _AttemptSink {
  outcome:  SearchProviderOutcome;
  rawCount: number | null;
  ms:       number | null;
}

function _sink(): _AttemptSink {
  return { outcome: 'NOT_ATTEMPTED', rawCount: null, ms: null };
}

/** Kovayı kanonik deneme kaydına çevirir. `keptCount` çağıran tarafından bilinir. */
function _attemptOf(
  provider: SearchProviderId, sink: _AttemptSink, keptCount: number | null,
): SearchProviderAttempt {
  return {
    provider,
    outcome:  sink.outcome,
    rawCount: sink.rawCount,
    keptCount,
    ms:       sink.ms,
  };
}

/** `fetch` hatasını zaman aşımı / ağ hatası olarak AYIRT eder. */
function _classifyFetchError(e: unknown): SearchProviderOutcome {
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError' ? 'TIMEOUT' : 'ERROR';
}

async function _nominatimSearch(
  query:      string,
  maxResults: number,
  userLat?:   number,
  userLng?:   number,
  sink?:      _AttemptSink,
): Promise<StoredLocation[]> {
  const _t0 = Date.now();
  const _mark = (outcome: SearchProviderOutcome, rawCount: number | null): void => {
    if (sink === undefined) return;
    sink.outcome  = outcome;
    sink.rawCount = rawCount;
    sink.ms       = Date.now() - _t0;
  };
  try {
    const params = new URLSearchParams({
      q:              query,
      format:         'jsonv2',
      limit:          String(Math.min(12, Math.max(maxResults, 8))),
      addressdetails: '1',
    });
    if (_useTrBias(userLat, userLng)) params.set('countrycodes', 'tr');
    if (userLat != null && userLng != null && Number.isFinite(userLat) && Number.isFinite(userLng)) {
      const d = NOMINATIM_VIEWBOX_DEG;
      params.set('viewbox', `${userLng - d},${userLat - d},${userLng + d},${userLat + d}`);
      params.set('bounded', '0');   // SINIR değil YANLILIK
    }

    const cacheKey = params.toString();
    const cached   = _nomCache.get(cacheKey);
    if (cached && Date.now() - cached.at <= _NOM_CACHE_TTL_MS) {
      /* Önbellek isabeti de bir ULAŞMA kanıtıdır: bu yanıt daha önce
         sağlayıcıdan GELDİ. Süre ölçülür ama sağlayıcının gecikmesi DEĞİLDİR —
         bu yüzden sicilde medyan süreyi aşağı çeker; kabul edilir, çünkü
         alternatif (sahte `null`) ulaşma kanıtını da yok ederdi. */
      _mark(cached.hits.length > 0 ? 'HIT' : 'ZERO', cached.hits.length);
      return cached.hits.slice();
    }
    if (cached) _nomCache.delete(cacheKey);

    /* ToS bekleyicisi — TEK otorite (`geo/nominatimRateLimit`).
       ÖNBELLEK KONTROLÜNDEN SONRA: önbellekten cevaplanan arama ağa
       ÇIKMADIĞI için slot HARCAMAMALIDIR (yoksa her tuş vuruşu sırayı
       gereksiz ileri sarar ve gerçek istekler beklerdi). */
    await awaitNominatimSlot();

    let res: Response;
    try {
      res = await fetch(`${NOMINATIM_URL}?${params}`, {
        headers: { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'tr' },
        signal:  signalWithTimeout(5_000), // Chrome <103 WebView güvenli (abortCompat)
      });
    } catch (e) {
      /* Zaman aşımı ile ağ hatası AYRI sınıflardır: birincisinde doğru cevap
         gelmiş OLABİLİR (→ "veri yok" iddiası çürür), ikincisinde servis
         konuşamadı. Davranış aynı kalır (boş dizi), KAYIT ayrışır. */
      _mark(_classifyFetchError(e), null);
      return [];
    }
    if (!res.ok) { _mark('ERROR', null); return []; }

    let data: Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      address?: { road?: string; city?: string; country?: string };
    }>;
    try {
      data = await res.json() as typeof data;
    } catch {
      /* Yanıt GELDİ ama çözümlenemedi → sağlayıcı sözleşmesi değişmiş olabilir.
         Bu tek KOD kusuru sınıfıdır; ağ ya da veri suçlanırsa gizlenir. */
      _mark('PARSE_ERROR', null);
      return [];
    }

    const hits = data
      .map((item): StoredLocation => ({
        id:        `nominatim_${item.place_id}`,
        name:      item.display_name.split(',')[0]?.trim() ?? item.display_name,
        address:   item.display_name,
        lat:       parseFloat(item.lat),
        lng:       parseFloat(item.lon),
        source:    'search',
        timestamp: Date.now(),
        useCount:  0,
      }))
      .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng));

    if (hits.length) {
      if (_nomCache.size >= _NOM_CACHE_MAX) {
        const oldest = _nomCache.keys().next().value;
        if (oldest !== undefined) _nomCache.delete(oldest);
      }
      _nomCache.set(cacheKey, { at: Date.now(), hits });
    }
    /* Ham sayı `data.length`tir, `hits.length` DEĞİL: geçersiz koordinat yüzünden
       düşen aday sağlayıcının ÜRETTİĞİ bir adaydır ve "0 sonuç döndü" demek
       onu görünmez kılardı. */
    _mark(data.length > 0 ? 'HIT' : 'ZERO', data.length);
    return hits.slice();
  } catch (e) {
    _mark(_classifyFetchError(e), null);
    return [];
  }
}

/* ── Sokak eşleşme kanıtı ───────────────────────────────────────────────────
 *
 * ÖLÇÜLEN KUSUR (2026-08-23): Overpass sokak araması YALNIZ hiç sonuç yokken
 * koşuyordu. "Kuvayimilliye Caddesi" sorgusunda Nominatim **702 km öteden bir
 * CAMİ** ("Kuvayımilliye Cami, Beylikdüzü/İstanbul") döndürüyor → `combined`
 * boş kalmıyor → sokak araması HİÇ ÇALIŞMIYORDU. Oysa aynı sorgu Mersin
 * merkezden Overpass'e sorulduğunda **0,78 km**'de "Kuvayi Milliye Caddesi"
 * dönüyor (ölçüldü, 1385 ms). Yani alakasız TEK sonuç, doğru katmanı bloke
 * ediyordu.
 *
 * Kural: sorgu bir sokak/cadde istiyorsa ve elde O SOKAĞI taşıyan aday YOKSA,
 * sokak araması yine koşar. Saf fonksiyon.
 *
 * ── NEDEN BİTİŞİKLİK ŞARTI (ölçüm bunu ZORUNLU kıldı) ──────────────────────
 * Yalnız gövde ("kuvayimilliye") aransaydı, İstanbul'daki **CAMİ** de eşleşirdi
 * (adı "Kuvayımilliye Cami") ve sokak katmanı yine bloke kalırdı. Gövdenin
 * hemen ARDINDAN yol tipi gelmelidir:
 *   "kuvayimilliyecaddesi"  → `kuvayimilliye` + `cadde` BİTİŞİK  ✅ sokak VAR
 *   "kuvayimilliyecamiyakuplucaddesi" → bitişik DEĞİL            ❌ sokak YOK
 */
export function _hasStreetMatch(sq: StreetQuery, list: readonly StoredLocation[]): boolean {
  const flat = (s: string): string => foldTr(s).replace(/\s+/g, '');
  /* Yol tipi `label`ın SON sözcüğüdür (`extractStreetQuery`: `${gövde} ${tip}`). */
  const typeWord = flat(sq.label.split(' ').pop() ?? '');
  /* ÜNSÜZ YUMUŞAMASI: OSM adları iyelik ekli yazılır ve `Sokak` → `Sokağı`
     olur (k → ğ). Düz `sokak` araması bu yüzden "Şifa Sokağı"nı KAÇIRIR —
     kilit testi bunu yakaladı. `cadde`/`bulvar` köklerinde değişim yoktur
     (`Caddesi` · `Bulvarı`), yalnız `sokak` kısaltılır. */
  const typeRoot = typeWord === 'sokak' ? 'soka' : typeWord;
  const needles = (sq.candidates.length > 0
    ? sq.candidates.map((c) => flat(c) + typeRoot)
    : [flat(sq.label)]
  ).filter((n) => n.length >= 5);
  if (needles.length === 0) return false;
  return list.some((c) => {
    const key = flat(`${c.name} ${c.address ?? ''}`);
    return needles.some((n) => key.includes(n));
  });
}

/** Aday + onu üreten katman. Katman etiketi DIŞARI SIZMAZ (sonda soyulur). */
type LayeredLocation = StoredLocation & {
  readonly layer: PlaceLayer;
  /** Kanıtlı kategori kimliği (Overpass etiketi / poi.db kategorisi). */
  readonly categoryId?: string | null;
};

/** Katman → deftere yazılan katman adı. Uydurma eşleme YOK. */
const _STAGE_OF_LAYER: Readonly<Record<PlaceLayer, AddressSearchStage>> = {
  HISTORY:           'LOCAL_HISTORY',
  OFFLINE_POI:       'LOCAL_POI',
  NOMINATIM:         'NOMINATIM',
  OVERPASS_CATEGORY: 'OVERPASS_CATEGORY',
  OVERPASS_NAME:     'NOMINATIM',   // bu yüzeyde ad araması Nominatim'e aittir
  OVERPASS_STREET:   'OVERPASS_STREET',
};

/**
 * Birleşik yer arama — cihaz-içi ve çevrimiçi katmanlar TEK listede.
 *
 * Katmanlar (hepsi koşar, biri diğerini ELEMEZ):
 *   1. `searchOffline`        — IndexedDB geçmiş / favoriler   (<10 ms)
 *   2. `searchGlobal`         — indirilmiş `poi.db` (Worker)   (~50 ms)
 *   3a. `_nominatimSearch`    — çevrimiçi serbest metin, TR + viewbox yanlılığı
 *   3b. `searchCategoryNearby`— çevrimiçi kategori ("pastane" · "en yakın eczane")
 *   4. `searchStreetByName`   — çevrimiçi sokak adı tam eşleşme
 * Sonuçlar `placeQueryModel` ile tekilleştirilir ve
 * **ad benzerliği + kategori + mesafe + şehir bağlamı** ile sıralanır.
 *
 * İnternet yoksa 1–2 aynen çalışır (fail-soft); çevrimiçi katman hata verirse
 * arama ÇÖKMEZ, elde olan liste döner.
 *
 * @param query      Kullanıcı arama metni
 * @param userLat    Mevcut konum (mesafe sıralaması + sağlayıcı yanlılığı için)
 * @param userLng    Mevcut konum
 * @param maxResults Toplam maksimum sonuç (varsayılan 8)
 * @param onPartial  Cihaz-içi katmanlar hazır olunca ÇAĞRILIR (çevrimiçi
 *                   beklenmeden ekran boyanabilsin). Nihai liste yine döner ve
 *                   bunu EZER. Dinleyicideki hata aramayı DÜŞÜRMEZ.
 */
export async function searchPlaces(
  query:      string,
  userLat?:   number,
  userLng?:   number,
  maxResults: number = 8,
  onPartial?: (partial: StoredLocation[]) => void,
): Promise<StoredLocation[]> {
  if (!query.trim()) return [];

  /* ── Kanıt defteri (teşhis turu 2026-08-11) ────────────────────────────────
   * Bu yüzey (harita arama çubuğu) `geocodeAddress` zincirinden AYRI çalışır ve
   * ölçümde 30 sorgunun 8'inde diğer yüzeyden FARKLI sonuç verdi. Ayrışmanın
   * sahada görünmesi için hangi yüzeyin ne bulduğu KAYDEDİLİR.
   * Sorgu METNİ deftere GİRMEZ — yalnız biçimi (gizlilik şartı #6). */
  const _t0    = Date.now();
  const _shape = describeQueryShape(query);
  let   _stage: AddressSearchStage = 'NONE';
  let   _rejected: number | null   = null;
  let   _biasDropped: number | null = null;
  /* ── P0-NAV-08 · SAĞLAYICI DÜZEYİ KANIT ───────────────────────────────────
   * Her katman kendi denemesini buraya yazar. Başlangıç değeri
   * `NOT_ATTEMPTED`tır — "denenmedi" ile "0 döndü" AYNI ŞEY DEĞİLDİR ve
   * eskiden ikisi de görünmezdi. */
  const _attempts: SearchProviderAttempt[] = [];
  let   _dedupe: DedupeEvidence | null = null;
  let   _topScore: SearchScoreEvidence | null = null;

  /* ── KONUM/ŞEHİR KAPISI (2026-08-12) ───────────────────────────────────────
   * ÖLÇÜLDÜ: bu yüzey `countrycodes`/viewbox bias KULLANMADIĞI için "Bağlar
   * Mahallesi" sorgusuna ilk aday olarak **Siverek/Şanlıurfa 405 km** dönüyordu;
   * en yakın aday listenin SONUNDAYDI. Adres zinciriyle AYNI saf kapı burada da
   * çağrılır — iki yüzeyin ayrışması bu projenin tekrar eden saha kusurudur. */
  const _origin = (userLat != null && userLng != null) ? { lat: userLat, lng: userLng } : null;
  /* GENERIC: kapı adayın EK alanlarını (katman etiketi, kategori kimliği)
     KAYBETMEZ — yalnız kendi okuduğu `fullName`i soyar. */
  const _gate = <T extends StoredLocation>(hits: readonly T[]): T[] => {
    if (hits.length === 0) return hits.slice();
    const r = applyLocationBias(
      query,
      hits.map((h) => ({ ...h, fullName: h.address ?? h.name })),
      _origin,
    );
    _biasDropped = (_biasDropped ?? 0) + r.droppedFar + r.droppedWrongCity;
    /* `fullName` yalnız kapının okuması için eklenmişti — dışarı SIZMAZ. */
    return r.kept.map((c) => {
      const { fullName: _drop, ...rest } = c.item;
      void _drop;
      return rest as unknown as T;
    });
  };
  const _finish = (results: StoredLocation[]): StoredLocation[] => {
    recordAddressSearch({
      surface:             'MAP_SEARCH_BAR',
      shape:               _shape,
      /* Bu yüzey ayrıştırıcıdan GEÇMEZ — kullanıcı ne yazdıysa o aranır. */
      queryRewritten:      false,
      queryLostRoadType:   false,
      stage:               _stage,
      resultCount:         results.length,
      /* Kapı da bir DOĞRULAMA filtresidir → toplam elemeye girer; ayrıştırılmış
         hâli `biasDroppedCount`tadır (bkz. geocodingService.done). */
      rejectedCount:       (_rejected === null && _biasDropped === null)
        ? null : (_rejected ?? 0) + (_biasDropped ?? 0),
      providerMs:          Date.now() - _t0,
      /* Bu yüzey fast-fail kullanmaz (tek 5 s'lik istek) → "beklemeyi bıraktık mı"
         sorusu burada ANLAMSIZ; sahte `false` yerine ölçülmedi (`null`). */
      fastFailHit:         null,
      hadLocation:         userLat != null && userLng != null,
      online:              typeof navigator === 'undefined' ? null : navigator.onLine,
      fallbackQueryUsable: (userLat != null && userLng != null)
        ? extractStreetQuery(query) !== null : null,
      biasDroppedCount:    _biasDropped,
      /* Liste kullanıcıya sunulur; SEÇİM kanıtı sonra gelir (noteAddressSearchChoice). */
      outcome:             results.length === 0 ? 'EMPTY' : 'AWAITING_CHOICE',
      providerAttempts:    _attempts.length > 0 ? _attempts.slice() : null,
      dedupe:              _dedupe,
      topScore:            _topScore,
    }, 'mapService.searchPlaces');
    return results;
  };

  /* Sorgunun ANLAMI — kategori mi, ad mı, adres mi (saf; bkz. placeQueryModel). */
  const _intent = detectPlaceIntent(query);
  /* YALNIZ AÇIKÇA `false` çevrimdışıdır (bkz. overpassCategorySearch'teki aynı
     kural): bayrağı tanımlamayan çalışma zamanında çevrimiçi katman sessizce
     KAPANMAZ. Yanlış tarafa düşmenin bedeli yok — ağ hatası zaten `[]`dir. */
  const _online = typeof navigator === 'undefined' || navigator.onLine !== false;

  /* Adaylar katman etiketiyle taşınır: sıralama ve tekilleştirme "hangi kaynak
     daha zengin/güvenilir" sorusunu bu etiketle cevaplar. Etiket DIŞARI SIZMAZ. */
  const combined: LayeredLocation[] = [];

  /** Nihai listeyi kurar: tekilleştir → sırala → katman etiketini soy. */
  const _present = (list: readonly LayeredLocation[]): StoredLocation[] =>
    /* ARA sunum: kanıt BURADA yazılmaz — nihai liste (5. adım) onu ezerdi ve
       defterde ara sonucun tekilleştirmesi görünürdü. Yalnız liste alınır. */
    rankPlaces(_intent, dedupePlacesWithEvidence(list).kept, { origin: _origin, limit: maxResults })
      .map(({ item }) => {
        const { layer: _l, categoryId: _c, ...rest } = item;
        void _l; void _c;
        return rest;
      });

  // 1 — IndexedDB geçmiş/favoriler
  const _histT0 = Date.now();
  const offlineHits = await searchOffline(query, maxResults);
  _attempts.push({
    provider:  'LOCAL_HISTORY',
    outcome:   offlineHits.length > 0 ? 'HIT' : 'ZERO',
    rawCount:  offlineHits.length,
    /* Bu katmanın kapısı YOKTUR — gelen aday olduğu gibi listeye girer. */
    keptCount: offlineHits.length,
    ms:        Date.now() - _histT0,
  });
  for (const hit of offlineHits) combined.push({ ...hit.location, layer: 'HISTORY' });

  /* 2 — İndirilmiş POI veritabanı (poi.db, Worker).
     ⚠️ ARTIK KOŞULSUZ ÇALIŞIR. Eskiden 1. katman `maxResults`i doldurursa
     buradan ERKEN DÖNÜLÜYORDU; aynı erken dönüş ÇEVRİMİÇİ katmanı da
     atlıyordu (kullanıcının bildirdiği "internet varken bile bulamıyor"
     davranışının yapısal kaynağı). Katmanlar artık ELENMEZ, BİRLEŞTİRİLİR.

     ── KATEGORİ SORGUSU İÇİN AYRI TERİM (ölçüm 2026-08-23) ──────────────────
     Worker `poi.db`de TEK bir `search LIKE '%terim%'` yapar. Ham sorgu
     "en yakın benzinlik" bu sütunda HİÇBİR ŞEYE uymaz → çevrimdışı katman da
     sessizce 0 dönerdi. Oysa `search` sütunu üretimde `ad + KATEGORİ + adres`
     olarak yazılır (bkz. build-poi-db.mjs) — yani kategori adı ORADADIR ve
     `poi.db` 6.007 benzinlik · 23.845 eczane · 13.578 market taşır.
     Bu yüzden kategori tespit edildiğinde AYRICA kanonik kategori adıyla
     aranır. İkinci sorgu cihaz-içidir (~50 ms) ve ağ gerektirmez.

     ⚠️ Ham sorgu KORUNUR ve `normalizePlaceQuery`den GEÇİRİLMEZ: `poi.db`nin
     katlama ikizi `foldTr`dir, ek sadeleştirme (mahallesi→mahalle) O TARAFTA
     YOKTUR. Normalize edilmiş anahtar gönderilseydi adres sorguları sessizce
     eşleşmezdi. */
  const _offlineCat = _intent.category?.offlineCat ?? null;
  const _poiT0 = Date.now();
  const _poiBatches = await Promise.all([
    searchGlobal(query, userLat, userLng, maxResults),
    (_offlineCat !== null && _offlineCat !== query.trim().toLowerCase())
      ? searchGlobal(_offlineCat, userLat, userLng, maxResults)
      : Promise.resolve([]),
  ]);
  const _poiRaw = _poiBatches.reduce((n, b) => n + b.length, 0);
  /* `searchGlobal` fail-soft'tur (Worker yoksa boş dizi) → 0 sonuç ile
     "veritabanı yüklenmedi" burada AYIRT EDİLEMEZ. Bu bir KANIT BOŞLUĞUDUR ve
     `ZERO` demek onu gizlerdi; bu yüzden kapsam sorusu poi.db katmanının kendi
     turuna (P0-NAV-08 açık borç) bırakılır ve burada yalnız ÖLÇÜLEN yazılır. */
  _attempts.push({
    provider:  'LOCAL_POI',
    outcome:   _poiRaw > 0 ? 'HIT' : 'ZERO',
    rawCount:  _poiRaw,
    keptCount: _poiRaw,
    ms:        Date.now() - _poiT0,
  });
  for (const batch of _poiBatches) {
    for (const p of batch) combined.push({ ...p, layer: 'OFFLINE_POI' });
  }

  /* Cihaz-içi katmanlar milisaniyeler içinde cevap verir; çevrimiçi katman
     saniyeler sürebilir. Kullanıcıyı bekletmemek için ara sonuç HEMEN sunulur
     (varsa) — nihai liste yine döndürülür ve onu EZER. */
  if (onPartial && combined.length > 0) {
    try { onPartial(_present(combined)); } catch { /* dinleyici ürünü düşürmez */ }
  }

  if (_online) {
    /* 3 — ÇEVRİMİÇİ KATMANLAR PARALEL koşar.
       (a) Nominatim serbest metin — ad · mahalle · ilçe · sokak · adres
       (b) Overpass kategori — "pastane / eczane / en yakın benzinlik"
       Seri koşsalardı en kötü hâl 5 s + 6 s olurdu; paralel koşunca üst sınır
       ikisinin BÜYÜĞÜ kadardır. İkisi de fail-soft: biri düşerse diğeri döner. */
    const _catDef  = _intent.category;
    const _canGeo  = userLat != null && userLng != null
                  && Number.isFinite(userLat) && Number.isFinite(userLng);

    /* ── KAPSAM AYRIMI (P0-NAV-07) ────────────────────────────────────────
     * Viewbox yanlılığı YEREL sorgular için ŞART (ölçüldü: `sifa eczanesi`
     * yanlılıkla 2,9 km, yanlılıksız 41,2 km), ama HEDEF ADRES sorgularında
     * aynı adı taşıyan UZAK adayları listeden KESİYOR:
     *   `"Bağlar Mahallesi"`      ±0,35° → **1 sonuç** · yanlılıksız → **10**
     *   `"Cumhuriyet Mahallesi"`  ±0,35° → **3 sonuç** · yanlılıksız → **10**
     * Ara genişlik denendi ve ÇÜRÜTÜLDÜ: ±1° "Bağlar"ı hâlâ açmıyor, ±2,5°
     * ise `Cumhuriyet Mahallesi`'nin 3,5 km'deki YEREL adayını KAYBEDİYOR
     * (en yakın 43 km'ye fırlıyor). Yani tek bir genişlik iki işi göremez →
     * İKİ GEÇİŞ gerekir.
     *
     * İkinci geçiş SADECE adres/idari sorgularda yapılır (mahalle · cadde ·
     * sokak · bulvar · site VEYA sorguda il adı geçiyorsa). Kategori ve
     * işletme-adı sorguları YEREL kalır — "en yakın eczane" ülke geneline
     * AÇILMAZ. İki geçiş de ortak ToS bekleyicisinden sırayla geçer. */
    const _wantsWideGeocode =
      _catDef === null && (_intent.hasAddressStructure || detectCitiesInQuery(query).length > 0);

    const _nearSink = _sink();
    const _wideSink = _sink();
    const _catT0    = Date.now();
    const [onlineRaw, wideRaw, catRaw] = await Promise.all([
      _nominatimSearch(query, maxResults, userLat, userLng, _nearSink),
      _wantsWideGeocode
        ? _nominatimSearch(query, maxResults, undefined, undefined, _wideSink)
        : Promise.resolve([] as StoredLocation[]),
      (_catDef !== null && _canGeo)
        ? searchCategoryNearby(_catDef, userLat as number, userLng as number)
        : Promise.resolve([]),
    ]);

    /* ── SAHA DÜZELTMESİ (2026-08-03, cihazda gözlendi) ───────────────────────
     * Bu çubuğa "0455 sokak" yazıldığında Nominatim **İzmir'de 701 km uzaktaki
     * "Sokak"** kaydını öneriyordu — kullanıcı dokunsa oraya rota kurulurdu.
     * Aynı koruma `geocodeAddress` zincirine eklenmişti (kütük #335) ama harita
     * arama çubuğu AYRI zinciri (`searchPlaces`) kullandığı için korumasızdı:
     * iki arama yüzeyi ayrışmıştı. Sorgu numaralı bir sokak istiyorsa, farklı
     * numaralı sonuç CEVAP DEĞİLDİR — elenir. */
    /* İki geçiş TEK listede birleşir; tekilleştirme ve sıralama (5. adım)
       çakışanları zaten teker. Yakın aday 1. geçişten, uzak aynı-adlılar
       2. geçişten gelir — kullanıcı konumu artık yalnız SIRALAMA kanıtıdır. */
    const onlineAll = [...onlineRaw, ...wideRaw];
    const onlineHits = filterNumberedStreetMismatch(
      query,
      onlineAll.map((h) => ({ ...h, fullName: h.address ?? h.name, layer: 'NOMINATIM' as const })),
    );
    _rejected = onlineAll.length - onlineHits.length;
    /* Numara doğrulamasından SONRA konum/şehir kapısı: önce "doğru sokak mı",
       sonra "doğru şehirde / ulaşılabilir mi". */
    const onlineGated = _gate(onlineHits.map(({ fullName: _f, ...rest }) => { void _f; return rest; }));
    combined.push(...onlineGated);

    /* İki Nominatim geçişi AYNI sağlayıcıdır ama AYRI denemedir (biri yanlı,
       öteki ülke geneli) — tek kayda katlansalardı "hangi geçiş cevapladı"
       sorusu kaybolurdu. `keptCount` iki geçişin ORTAK kapı çıktısıdır; geçiş
       başına ayrıştırılamaz, bu yüzden yalnız yanlı geçişe yazılır ve geniş
       geçiş `null` taşır (uydurma pay YASAK). */
    _attempts.push(_attemptOf('NOMINATIM', _nearSink, onlineGated.length));
    if (_wantsWideGeocode) _attempts.push(_attemptOf('NOMINATIM', _wideSink, null));
    else _attempts.push(notAttempted('NOMINATIM_RELAXED'));

    /* Kategori adayları AYNI kapıdan geçer — "İstanbul eczane" ararken
       Tarsus'taki eczaneler cevap DEĞİLDİR. */
    if (_catDef !== null && _canGeo) {
      /* `searchCategoryNearby` fail-soft'tur; 0 ile hata AYIRT EDİLEMEZ →
         ölçülen tek şey ham sayıdır. */
      _attempts.push({
        provider:  'OVERPASS_CATEGORY',
        outcome:   catRaw.length > 0 ? 'HIT' : 'ZERO',
        rawCount:  catRaw.length,
        keptCount: null,
        ms:        Date.now() - _catT0,
      });
    } else {
      _attempts.push(notAttempted('OVERPASS_CATEGORY'));
    }

    if (catRaw.length > 0) {
      const catGated = _gate(catRaw.map((p): LayeredLocation => ({
        id:         p.id,
        name:       p.name,
        address:    p.address.length > 0 ? p.address : undefined,
        lat:        p.lat,
        lng:        p.lng,
        source:     'search',
        timestamp:  Date.now(),
        useCount:   0,
        categoryId: p.categoryId,
        layer:      'OVERPASS_CATEGORY',
      })));
      combined.push(...catGated);
    }
  }

  if (!_online) {
    /* Çevrimdışı: çevrimiçi sağlayıcılar HİÇ DENENMEDİ. Bunu yazmak zorunludur —
       yoksa hüküm katmanı "ulaşıldı, 0 döndü" (yani VERİ YOK) sanır ve yanlış
       işi işaret eder (`classifySearchChain` → `TRUE_ZERO` yerine
       `OFFLINE_NO_COVERAGE`). */
    _attempts.push(
      { provider: 'NOMINATIM',         outcome: 'OFFLINE_SKIPPED', rawCount: null, keptCount: null, ms: null },
      { provider: 'OVERPASS_CATEGORY', outcome: 'OFFLINE_SKIPPED', rawCount: null, keptCount: null, ms: null },
      { provider: 'OVERPASS_STREET',   outcome: 'OFFLINE_SKIPPED', rawCount: null, keptCount: null, ms: null },
    );
  }

  /* 4 — Sokak adıyla doğrudan OSM (Overpass). Nominatim Türkçe numaralı
   *     sokakları eşleştiremiyor (ölçüldü, kütük #336); Overpass tam eşleşme
   *     verir. Fail-soft: konum yoksa/hata olursa boş döner.
   *
   *     KAPSAM GENİŞLETİLDİ (P0-NAV-06): eskiden YALNIZ `combined.length === 0`
   *     iken koşuyordu. Ölçüldü ki alakasız TEK bir Nominatim sonucu bu katmanı
   *     bloke ediyor ("Kuvayimilliye Caddesi" → 702 km'deki bir CAMİ dönüyor,
   *     0,78 km'deki cadde HİÇ sorulmuyordu). Artık sorgu bir sokak istiyorsa
   *     ve elde o sokağı taşıyan aday YOKSA da koşar. */
  const _streetQuery   = extractStreetQuery(query);
  const _streetPending = _streetQuery !== null && !_hasStreetMatch(_streetQuery, combined);
  if (combined.length === 0 || _streetPending) {
    /* ── KAPSAM AYRIMI (P0-NAV-07) ────────────────────────────────────────
     * Sokak araması artık kullanıcının 20 km'sine HAPSEDİLMİŞ değil:
     *  · sorguda il adı geçiyorsa ÇAPA çözülür ve arama ORADA yapılır
     *    (ölçüldü: çapa+20 km **587 ms**, kullanıcı+20 km **0 sonuç**);
     *  · il adı yoksa ve yakın çevre boş dönerse TEK adımlık genişletme
     *    (`WIDE_RADIUS_M` = 60 km; ölçüldü 1264 · 2302 ms — 100 km 429/504).
     * Çapa YALNIZ burada, yani sokak sorgusu gerçekten cevapsız kaldığında
     * çözülür → halka açık sağlayıcılara gereksiz istek gitmez. */
    const _anchor = _streetQuery !== null ? await resolveCityAnchor(query) : null;
    const _streetT0 = Date.now();
    const streets = await searchStreetByName(query, userLat, userLng, {
      anchor:          _anchor,
      allowWideRadius: true,
    });
    const _streetMs = Date.now() - _streetT0;
    const gatedStreets = _gate(streets.map((s): LayeredLocation => ({
      id:        s.id,
      name:      s.name,
      address:   s.fullName,
      lat:       s.lat,
      lng:       s.lng,
      source:    'search' as const,
      timestamp: Date.now(),
      useCount:  0,
      layer:     'OVERPASS_STREET',
    })));
    if (_online) {
      _attempts.push({
        provider:  'OVERPASS_STREET',
        outcome:   streets.length > 0 ? 'HIT' : 'ZERO',
        rawCount:  streets.length,
        keptCount: gatedStreets.length,
        ms:        _streetMs,
      });
    }
    combined.push(...gatedStreets);
  } else if (_online) {
    /* Sokak katmanı KOŞMADI çünkü elde zaten o sokağı taşıyan aday vardı —
       bu bir başarısızlık değildir ve `ZERO` yazılması yanıltıcı olurdu. */
    _attempts.push(notAttempted('OVERPASS_STREET'));
  }

  /* 5 — TEK LİSTE: tekilleştir → ad benzerliği + kategori + mesafe + bağlam. */
  const _deduped = dedupePlacesWithEvidence(combined);
  _dedupe = _deduped.evidence;
  const ranked  = rankPlaces(_intent, _deduped.kept, { origin: _origin, limit: maxResults });
  /* Birinci sonucun puan bileşenleri — "neden bu birinci" sorusu sahada
     ölçülemiyordu (P0-NAV-08). Liste boşsa iddia YOK. */
  _topScore = ranked.length > 0 ? ranked[0].breakdown : null;
  const results = ranked.map(({ item }) => {
    const { layer: _l, categoryId: _c, ...rest } = item;
    void _l; void _c;
    return rest;
  });

  /* Defterdeki "hangi katman cevapladı" artık BİRİNCİ SIRADAKİ adayın
     katmanıdır — katmanlar birleştiği için "ilk cevap veren" kavramı
     kalmadı. Uydurma yok: liste boşsa `NONE`. */
  _stage = ranked.length === 0 ? 'NONE' : _STAGE_OF_LAYER[ranked[0].item.layer];

  return _finish(results);
}
