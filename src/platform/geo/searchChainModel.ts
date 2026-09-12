/**
 * searchChainModel — ARAMA ZİNCİRİNİN KANONİK SÖZLEŞMESİ (SAF KATMAN).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK ·
 * ağ YOK. Yalnız "hangi sağlayıcı ne yaptı" olgularından bir HÜKÜM türetir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-08 ölçümü · 2026-08-24) ─────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Ürünün İKİ arama yüzeyi var ve ikisi de kanıt yazıyor:
 *   · `geocodingService.geocodeAddress`  (Mavi / adres kartı — MERDİVEN)
 *   · `mapService.searchPlaces`          (harita arama çubuğu — BİRLEŞTİREN)
 *
 * Defter (`addressSearchLedger`) YALNIZ **cevabı üreten katmanı** (`stage`)
 * ve zincir düzeyinde tek bir başarısızlık sınıfı yazıyordu. Ölçülen boşluk:
 *
 *   "Nominatim zaman aşımına mı uğradı, 0 mı döndü, JSON'u mu bozuktu,
 *    yoksa hiç mi denenmedi?" → **ÜÇÜ DE `stage: 'NONE'` olarak görünüyor.**
 *
 * Bu ayrım ürün kararıdır, süs değil:
 *   · `TRUE_ZERO`  → veri boşluğu; sağlayıcı eklemek/veri lisanslamak gerekir.
 *   · `TIMEOUT`    → cevap VARDI, beklemedik; eşik/ağ işi.
 *   · `PARSE_FAILURE` → sağlayıcı sözleşmesi değişmiş; KOD işi.
 *   · `OFFLINE_NO_COVERAGE` → `poi.db` kapsamı işi.
 * Dördü aynı kovaya atıldığında hiçbiri düzeltilemez.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · KARAR ÜRETMEZ: yeniden deneme tetiklemez, sorgu değiştirmez, sağlayıcı
 *    seçmez, eşik uygulamaz. Yalnız SINIFLANDIRIR ve TAŞIR.
 *  · Kanıt yetmiyorsa `UNKNOWN` — "muhtemelen" YASAK.
 *  · Ölçülemeyen alan `null` taşınır; sahte 0 / sahte süre YASAK.
 *  · `TRUE_ZERO` **yalnız** denenen TÜM sağlayıcılara ULAŞILDIĞINDA ve
 *    hepsi ham 0 döndüğünde iddia edilir. Tek bir zaman aşımı bile bu iddiayı
 *    ÇÜRÜTÜR (cevap gelmiş olabilirdi) — bkz. `classifySearchChain` sırası.
 *  · PII TAŞIMAZ: sorgu metni, koordinat, adres bu modüle GİRMEZ.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) SAĞLAYICI KİMLİĞİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Aday üretebilen HER kaynak. `addressSearchLedger.AddressSearchStage` ile
 * kasten ÖRTÜŞÜR ama aynı şey DEĞİLDİR: `stage` "kim cevapladı" sorusunun tek
 * kazananıdır, bu ise "kim DENENDİ" listesinin her üyesidir.
 */
export type SearchProviderId =
  /** BYOK premium sağlayıcı (Google/HERE/Yandex). */
  | 'PREMIUM'
  /** Nominatim — kullanıcının YAZDIĞI sorgu. */
  | 'NOMINATIM'
  /** Nominatim — gevşetilmiş varyant. */
  | 'NOMINATIM_RELAXED'
  /** Overpass — sokak adına tam eşleşme. */
  | 'OVERPASS_STREET'
  /** Overpass — kategori + yarıçap. */
  | 'OVERPASS_CATEGORY'
  /** Cihaz-içi geçmiş / favoriler (IndexedDB). */
  | 'LOCAL_HISTORY'
  /** İndirilmiş POI veritabanı (`poi.db`, Worker). */
  | 'LOCAL_POI';

export const SEARCH_PROVIDER_LABEL: Readonly<Record<SearchProviderId, string>> = {
  PREMIUM:           'premium sağlayıcı (BYOK)',
  NOMINATIM:         'Nominatim — yazılan sorgu',
  NOMINATIM_RELAXED: 'Nominatim — gevşetilmiş varyant',
  OVERPASS_STREET:   'Overpass — sokak adı',
  OVERPASS_CATEGORY: 'Overpass — kategori + yarıçap',
  LOCAL_HISTORY:     'cihaz-içi geçmiş / favoriler',
  LOCAL_POI:         'indirilmiş POI veritabanı',
} as const;

/** Sağlayıcı cihaz-içi mi (ağ gerektirmez)? Kapsam hükmü buna dayanır. */
export const SEARCH_PROVIDER_IS_LOCAL: Readonly<Record<SearchProviderId, boolean>> = {
  PREMIUM:           false,
  NOMINATIM:         false,
  NOMINATIM_RELAXED: false,
  OVERPASS_STREET:   false,
  OVERPASS_CATEGORY: false,
  LOCAL_HISTORY:     true,
  LOCAL_POI:         true,
} as const;

/* ══════════════════════════════════════════════════════════════════════════
   2) SAĞLAYICI SONUCU — ÖLÇÜLEN OLGU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * TEK bir sağlayıcı denemesinin ölçülen sonucu.
 *
 * ⚠️ `ZERO` ile `NOT_ATTEMPTED` KARIŞTIRILAMAZ: birincisi "sorduk, yok" der
 * ve veri boşluğu KANITIDIR; ikincisi hiçbir şey söylemez. Ürünün eski hâli
 * ikisini de görünmez kılıyordu.
 */
export type SearchProviderOutcome =
  /** En az bir ham aday üretti. */
  | 'HIT'
  /** Sağlayıcıya ULAŞILDI, 0 ham aday döndü. */
  | 'ZERO'
  /** Bekleme bırakıldı / istek iptal edildi — cevap gelmiş OLABİLİR. */
  | 'TIMEOUT'
  /** Ağ ya da HTTP hatası. */
  | 'ERROR'
  /** Yanıt GELDİ ama çözümlenemedi (sağlayıcı sözleşmesi değişmiş olabilir). */
  | 'PARSE_ERROR'
  /** Cihaz çevrimdışı olduğu için hiç denenmedi. */
  | 'OFFLINE_SKIPPED'
  /** Anahtar/yapılandırma yok (yalnız `PREMIUM` için anlamlı). */
  | 'NOT_CONFIGURED'
  /** Ön koşul yoktu ya da zincir daha önce cevap buldu → hiç denenmedi. */
  | 'NOT_ATTEMPTED';

export const SEARCH_OUTCOME_LABEL: Readonly<Record<SearchProviderOutcome, string>> = {
  HIT:             'aday üretti',
  ZERO:            'ulaşıldı, 0 sonuç',
  TIMEOUT:         'beklenmedi (zaman aşımı)',
  ERROR:           'ağ / servis hatası',
  PARSE_ERROR:     'yanıt çözümlenemedi',
  OFFLINE_SKIPPED: 'çevrimdışı — atlandı',
  NOT_CONFIGURED:  'yapılandırılmamış',
  NOT_ATTEMPTED:   'denenmedi',
} as const;

/** Sağlayıcıya GERÇEKTEN ulaşıldı mı — `TRUE_ZERO` iddiasının ön koşulu. */
export function wasProviderReached(outcome: SearchProviderOutcome): boolean {
  return outcome === 'HIT' || outcome === 'ZERO';
}

/**
 * TEK bir sağlayıcı denemesinin kaydı. PII TAŞIMAZ (yalnız sayı ve sınıf).
 */
export interface SearchProviderAttempt {
  readonly provider: SearchProviderId;
  readonly outcome: SearchProviderOutcome;
  /** Sağlayıcıdan gelen HAM aday sayısı. Ulaşılamadıysa `null`. */
  readonly rawCount: number | null;
  /**
   * Kapı/filtre (numaralı sokak · konum/şehir · alaka tabanı) SONRASI kalan.
   * Ölçülmediyse `null`. `rawCount > 0 && keptCount === 0` → adaylar VARDI,
   * ürün ELEDİ — bu `TRUE_ZERO`dan tamamen FARKLI bir kusurdur.
   */
  readonly keptCount: number | null;
  /** Denemenin süresi (ms). Ölçülmediyse `null` — sahte 0 YASAK. */
  readonly ms: number | null;
}

/** Denenmemiş sağlayıcı için kanonik kayıt (sahte sayı üretmez). */
export function notAttempted(
  provider: SearchProviderId,
  outcome: SearchProviderOutcome = 'NOT_ATTEMPTED',
): SearchProviderAttempt {
  return { provider, outcome, rawCount: null, keptCount: null, ms: null };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ZİNCİR HÜKMÜ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Zincirin tamamının hükmü — "kullanıcıya neden sonuç gösteremedik".
 *
 * Her sınıfın FARKLI bir sonraki adımı vardır; bu yüzden ayrılırlar.
 */
export type SearchChainVerdict =
  /** Sonuç sunuldu. */
  | 'RESULTS'
  /** Denenen TÜM sağlayıcılara ulaşıldı ve hepsi ham 0 döndü → veri boşluğu. */
  | 'TRUE_ZERO'
  /** Adaylar GELDİ ama ürünün kapıları/filtreleri hepsini eledi. */
  | 'FILTERED_OUT'
  /** Cihaz çevrimdışıydı ve cihaz-içi kaynak da denenmedi. */
  | 'NETWORK_UNAVAILABLE'
  /** Cihaz çevrimdışıydı; cihaz-içi kaynaklar denendi ve boş döndü. */
  | 'OFFLINE_NO_COVERAGE'
  /** En az bir sağlayıcı beklenmeden bırakıldı → cevap gelmiş olabilirdi. */
  | 'TIMEOUT'
  /** En az bir sağlayıcı ağ/servis hatası verdi. */
  | 'PROVIDER_ERROR'
  /** Yanıt geldi, çözümlenemedi → sağlayıcı sözleşmesi kırılmış olabilir. */
  | 'PARSE_FAILURE'
  /** Kanıt yetersiz — hüküm iddia EDİLMEZ. */
  | 'UNKNOWN';

export const SEARCH_VERDICT_LABEL: Readonly<Record<SearchChainVerdict, string>> = {
  RESULTS:             'sonuç sunuldu',
  TRUE_ZERO:           'gerçek 0 sonuç — tüm sağlayıcılara ulaşıldı, veri yok',
  FILTERED_OUT:        'adaylar geldi, ürünün kapıları hepsini eledi',
  NETWORK_UNAVAILABLE: 'ağ yok — hiçbir kaynak denenemedi',
  OFFLINE_NO_COVERAGE: 'çevrimdışı — cihaz-içi kapsamda yok',
  TIMEOUT:             'sağlayıcı beklenmedi — cevap gelmiş olabilirdi',
  PROVIDER_ERROR:      'sağlayıcı ağ / servis hatası',
  PARSE_FAILURE:       'yanıt çözümlenemedi — sağlayıcı sözleşmesi değişmiş olabilir',
  UNKNOWN:             'kanıt yetersiz — hüküm iddia edilmiyor',
} as const;

/** Zincir hükmünü üretmek için gereken bağlam. */
export interface SearchChainContext {
  /** Kullanıcıya SUNULAN sonuç sayısı. */
  readonly resultCount: number;
  /** Cihaz o an çevrimiçi miydi. `null` = bildirilmedi. */
  readonly online: boolean | null;
}

export interface SearchChainClassification {
  readonly verdict: SearchChainVerdict;
  /** İnsan-okur tek cümle gerekçe. PII TAŞIMAZ. */
  readonly why: string;
  /** Denenen (yani `NOT_ATTEMPTED` olmayan) sağlayıcı sayısı. */
  readonly attemptedCount: number;
  /** Gerçekten ULAŞILAN sağlayıcı sayısı — `TRUE_ZERO` iddiasının dayanağı. */
  readonly reachedCount: number;
  /** Zincir boyunca gelen TOPLAM ham aday. Hiç ulaşılmadıysa `null`. */
  readonly totalRaw: number | null;
  /** Kapılardan SONRA kalan toplam. Ölçülmediyse `null`. */
  readonly totalKept: number | null;
  /**
   * Hüküm, ölçülen kanıtın TAMAMINA dayanıyor mu. `false` ise en az bir
   * sağlayıcı sonucunu bildirmedi → hüküm bir ALT SINIR'dır.
   */
  readonly evidenceComplete: boolean;
}

/**
 * Sağlayıcı denemelerinden zincir hükmü türetir. **SAF.**
 *
 * ── SIRA NEDEN BÖYLE (her adım bir çürütme) ───────────────────────────────
 *  1. Sonuç varsa hüküm `RESULTS`tir; başka soru sorulmaz.
 *  2. `PARSE_ERROR` en yüksek önceliklidir çünkü tek KOD kusuru sınıfıdır —
 *     ağ ya da veri suçlanırsa gerçek sebep gizlenir.
 *  3. `TIMEOUT`, `TRUE_ZERO`yu ÇÜRÜTÜR: beklemediğimiz sağlayıcı doğru cevabı
 *     vermiş olabilir (saha 2026-08-08 "Ofis Parkı" ölçümüyle birebir aynı
 *     ders). Bu yüzden eleme sınıfının ÜSTÜNDEDİR.
 *  4. `ERROR` de aynı sebeple `TRUE_ZERO`yu çürütür.
 *  5. `FILTERED_OUT` yalnız ham aday GELDİĞİ kanıtlandığında iddia edilir.
 *  6. `TRUE_ZERO` EN SON gelir ve yalnız ulaşılan sağlayıcı VARSA — hiçbirine
 *     ulaşılmadıysa hüküm `UNKNOWN`dır, "veri yok" DEĞİL.
 */
export function classifySearchChain(
  attempts: readonly SearchProviderAttempt[],
  ctx: SearchChainContext,
): SearchChainClassification {
  const attempted = attempts.filter((a) => a.outcome !== 'NOT_ATTEMPTED');
  const reached   = attempted.filter((a) => wasProviderReached(a.outcome));

  let totalRaw:  number | null = null;
  let totalKept: number | null = null;
  for (const a of reached) {
    if (a.rawCount  !== null) totalRaw  = (totalRaw  ?? 0) + a.rawCount;
    if (a.keptCount !== null) totalKept = (totalKept ?? 0) + a.keptCount;
  }

  /* Kanıt tamlığı: ulaşılan her sağlayıcı ham sayısını bildirmiş mi. */
  const evidenceComplete =
    attempted.length > 0 && reached.every((a) => a.rawCount !== null);

  const base = {
    attemptedCount: attempted.length,
    reachedCount:   reached.length,
    totalRaw,
    totalKept,
    evidenceComplete,
  };

  const verdict = (v: SearchChainVerdict, why: string): SearchChainClassification =>
    ({ verdict: v, why, ...base });

  /* 1 — Sonuç var. */
  if (ctx.resultCount > 0) {
    return verdict('RESULTS', `${ctx.resultCount} sonuç sunuldu`);
  }

  /* Hiç deneme bildirilmediyse hüküm YOKTUR. */
  if (attempted.length === 0) {
    return verdict('UNKNOWN', 'hiçbir sağlayıcı denemesi bildirilmedi');
  }

  const has = (o: SearchProviderOutcome): boolean => attempted.some((a) => a.outcome === o);
  const countOf = (o: SearchProviderOutcome): number =>
    attempted.filter((a) => a.outcome === o).length;

  /* 2 — Çözümleme kusuru: tek KOD sınıfı, en önce. */
  if (has('PARSE_ERROR')) {
    return verdict(
      'PARSE_FAILURE',
      `${countOf('PARSE_ERROR')} sağlayıcı yanıtı çözümlenemedi — sözleşme değişmiş olabilir`,
    );
  }

  /* 3 — Çevrimdışı: cihaz-içi kaynak denendi mi sorusu hükmü BELİRLER. */
  if (ctx.online === false) {
    const localTried = attempted.some((a) => SEARCH_PROVIDER_IS_LOCAL[a.provider]);
    return localTried
      ? verdict('OFFLINE_NO_COVERAGE', 'çevrimdışı — cihaz-içi kaynaklarda eşleşme yok')
      : verdict('NETWORK_UNAVAILABLE', 'çevrimdışı — cihaz-içi kaynak da denenmedi');
  }

  /* 4 — Beklemedik: "veri yok" iddiası ÇÜRÜTÜLDÜ. */
  if (has('TIMEOUT')) {
    return verdict(
      'TIMEOUT',
      `${countOf('TIMEOUT')} sağlayıcı beklenmeden bırakıldı — doğru cevap gelmiş olabilirdi`,
    );
  }

  /* 5 — Servis hatası: aynı sebeple "veri yok" denemez. */
  if (has('ERROR')) {
    return verdict('PROVIDER_ERROR', `${countOf('ERROR')} sağlayıcı ağ / servis hatası verdi`);
  }

  /* 6 — Adaylar geldi, biz eledik. Yalnız KANITLIYSA iddia edilir. */
  if (totalRaw !== null && totalRaw > 0 && (totalKept === null || totalKept === 0)) {
    return verdict(
      'FILTERED_OUT',
      `${totalRaw} ham aday geldi, ürünün kapıları hepsini eledi`,
    );
  }

  /* 7 — Gerçek 0: yalnız ULAŞILAN sağlayıcı varsa ve hepsi ham 0 döndüyse. */
  if (reached.length > 0 && totalRaw === 0) {
    return verdict(
      'TRUE_ZERO',
      `${reached.length} sağlayıcıya ulaşıldı, hiçbiri aday üretmedi — veri boşluğu`,
    );
  }

  /* Çevrimdışı bilgisi yoksa ve hiçbirine ulaşılamadıysa hüküm verilemez. */
  return verdict('UNKNOWN', 'denemeler sonuçlandı ama sınıf ayırt edilemedi');
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KANONİK SONUÇ SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

/** Sonucu ÜRETEN kaynağın kanıtı — "bu koordinat nereden geldi". */
export interface SearchResultProvenance {
  readonly provider: SearchProviderId;
  /** Kaynak ağdan mı geldi. `SEARCH_PROVIDER_IS_LOCAL` ile tutarlıdır. */
  readonly online: boolean;
  /**
   * Sağlayıcının verdiği HAM kimlik (Nominatim `place_id`, OSM id…).
   * Sağlayıcı kimlik vermediyse `null` — UYDURULMAZ.
   */
  readonly providerRef: string | null;
}

/**
 * Sıralamanın BİLEŞENLERİ — "bu sonuç neden birinci" sorusunun cevabı.
 * Ağırlıklandırılmış toplam `total`dır; bileşenler HAM (0–1) puanlardır.
 */
export interface SearchScoreEvidence {
  readonly total: number;
  /** Ad/metin benzerliği (0–1). */
  readonly name: number;
  /** Kategori kanıtı uyumu (0–1). */
  readonly category: number;
  /** Mesafe puanı (0–1). Konum yoksa nötr ağırlık taşır. */
  readonly distance: number;
  /** Sorgudaki il/ilçe/mahalle sözcüklerinin adayda geçme oranı (0–1). */
  readonly context: number;
  /** Katman güven ikramiyesi (mutlak, toplama EKLENİR). */
  readonly layerBonus: number;
}

/**
 * TEK KANONİK ARAMA SONUCU.
 *
 * İki yüzeyin (`GeoResult` · `StoredLocation`) ORTAK sözleşmesidir. Yüzeyleri
 * bu tipe TAŞIMAK bir sonraki turun işidir; bu tur sözleşmeyi KURAR ve kanıt
 * katmanında (LAB) kullanır — mevcut çağıranların hiçbiri bozulmaz.
 */
export interface CanonicalSearchResult {
  /** Ürün-içi tekil kimlik. */
  readonly id: string;
  /** Kısa görünen ad. */
  readonly name: string;
  /** Tam görünen ad / adres satırı. */
  readonly fullName: string;
  /** Kanonik kategori kimliği. Kanıt yoksa `null` — TAHMİN EDİLMEZ. */
  readonly categoryId: string | null;
  readonly lat: number;
  readonly lng: number;
  /** Ayrı adres alanı; yoksa `null`. */
  readonly address: string | null;
  /** Kullanıcıya ÖLÇÜLEN mesafe (km). Konum yoksa `null` — sahte 0 YASAK. */
  readonly distanceKm: number | null;
  readonly provenance: SearchResultProvenance;
  /** Sıralama kanıtı. Sıralama koşmadıysa `null` (uydurma puan YASAK). */
  readonly score: SearchScoreEvidence | null;
}

/** Koordinat gerçekten kullanılabilir mi (Null Island ve NaN dâhil). */
export function isUsableCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  /* 0,0 Atlantik'te bir noktadır; ürünümüzde her zaman "konum yok" imzasıdır. */
  if (lat === 0 && lng === 0) return false;
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
   5) TEKİLLEŞTİRME KANITI
   ══════════════════════════════════════════════════════════════════════════ */

/** "Kaç aday birleşti" — sessiz düşen aday sahada görünmüyordu. */
export interface DedupeEvidence {
  readonly before: number;
  readonly after: number;
  /** Birleştirilerek düşen aday sayısı. */
  readonly merged: number;
}

export function describeDedupe(before: number, after: number): DedupeEvidence {
  const b = Number.isFinite(before) && before >= 0 ? Math.floor(before) : 0;
  const a = Number.isFinite(after) && after >= 0 ? Math.floor(after) : 0;
  return { before: b, after: a, merged: Math.max(0, b - a) };
}
