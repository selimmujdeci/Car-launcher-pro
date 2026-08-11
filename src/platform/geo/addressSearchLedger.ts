/**
 * addressSearchLedger.ts — ADRES ARAMA KANIT DEFTERİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK.
 * Zaman ve girdiler dışarıdan verilir → cihazsız test edilebilir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN (teşhis turu · 2026-08-11) ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Kullanıcı sahada "adreslerin ~%40'ı bulunamıyor" dedi. Ölçüm denendiğinde
 * ortaya çıkan İLK gerçek şu oldu: **ürün hiçbir arama denemesini KAYDETMİYOR.**
 * `saveSearchQuery()` yalnız BAŞARILI ve KULLANICI TARAFINDAN SEÇİLMİŞ sonucu
 * yazıyor; başarısız denemeler (0 sonuç · yanlış sonuç · timeout · kullanıcı
 * hiçbirini seçmedi) hiçbir yere düşmüyor. Yani şikâyetin sebebi ölçülemiyordu;
 * her tur canlı sağlayıcıya elle sorgu atıp tahmin yürütmek gerekiyordu.
 *
 * Bu defter o boşluğu kapatır: her denemenin HANGİ KATMANIN cevapladığını,
 * sonucun kullanıcı tarafından SEÇİLİP SEÇİLMEDİĞİNİ ve başarısızlığın hangi
 * SEBEP SINIFINA girdiğini sayar.
 *
 * ── DÜZELTME DEĞİLDİR ─────────────────────────────────────────────────────
 * Defter eşik uygulamaz, sorgu değiştirmez, sağlayıcı seçmez, yeniden deneme
 * tetiklemez. Yalnız SINIFLANDIRIR (vizyon §7.9 "sessiz kayıt" kovası).
 *
 * ── GİZLİLİK (CLAUDE.md gözlemlenebilirlik şartı #6 — PAZARLIKSIZ) ────────
 * Adres metni PII'dır: kullanıcının EV adresini taşır. Bu yüzden defter
 * **sorgu metnini SAKLAMAZ**; yerine sorgunun BİÇİMİNİ (`AddressQueryShape`)
 * tutar — token sayısı, "İ harfi var mı", "ekli yol tipi (Caddesi) var mı",
 * "kapı numarası var mı" gibi PII taşımayan bayraklar. Teşhis için gereken tam
 * olarak bu eksenlerdir (ölçüm 2026-08-11: kusurların hepsi biçim eksenindeydi),
 * koordinat ve sokak adı ise gerekmez ve TAŞINMAZ.
 *
 * ── DÜRÜSTLÜK SÖZLEŞMESİ ──────────────────────────────────────────────────
 *  · Kanıt yetmiyorsa sınıf `UNKNOWN`tır. "Muhtemelen veri yok" demek tam
 *    olarak kaçındığımız hatadır — OSM'de VAR MI sorusunun cevabı yer gerçeği
 *    (Overpass) sorulmadan bilinemez → `GROUND_TRUTH` kanıt boşluğu yazılır.
 *  · Ölçülemeyen alan `null` taşınır — sahte 0 / sahte gecikme YASAK.
 *  · Defter EKSİK KANITI DA SAYAR (`evidenceGap`): "neyi ölçemedik" sorusu bir
 *    sonraki turun enstrümantasyon iş listesidir.
 *  · Kullanıcı seçimi GEÇ gelir. Kayıt o an KESKİNLEŞİR (`noteUserChoice`);
 *    seçim gelmediyse "kullanıcı beğenmedi" İDDİA EDİLMEZ (`AWAITING_CHOICE`).
 */

/** Defterin tavanı — sınırsız kayıt cihazda bellek sorunudur. */
export const ADDRESS_SEARCH_RING = 40;

/** Aday "baskın" ilan edilebilmesi için gereken pay (linkLossLedger ile aynı ilke). */
export const ADDRESS_SEARCH_DOMINANT_MIN_SHARE = 0.4;

/**
 * Ürünün 2 s fast-fail eşiği (`geocodingService.FAST_FAIL_MS`) ile AYNI SAYI —
 * YALNIZ belgeleme amaçlı taşınır.
 *
 * ⚠️ Bu eşik `providerMs` ile KARŞILAŞTIRILMAZ: `providerMs` tüm ZİNCİRİN süresidir
 * (rate-limit beklemesi + gevşetme varyantları + Overpass) ve doğal olarak 2 s'yi
 * aşar. Ölçüm 2026-08-11: 8,6 s süren bir zincirde tek Nominatim yanıtı 606 ms'ydi
 * — zincir süresine bakan bir dedektör bunu "ağ yavaş" diye YANLIŞ sınıflandırırdı.
 * Yavaşlığın tek dürüst sinyali `fastFailHit`tir (beklemeyi gerçekten bıraktık mı).
 */
export const ADDRESS_SEARCH_FAST_FAIL_MS = 2_000;

/* ══════════════════════════════════════════════════════════════════════════
   SORGU BİÇİMİ — PII taşımayan teşhis ekseni
   ══════════════════════════════════════════════════════════════════════════ */

/** Sorguda geçen yol tipi sözcüğü — ad DEĞİL, yalnız SINIF. */
export type RoadTypeWord = 'SOKAK' | 'CADDE' | 'BULVAR' | 'NONE';

/**
 * Sorgunun BİÇİMİ — metnin kendisi DEĞİL.
 *
 * Her alan ölçüm 2026-08-11'de bir kusur sınıfına karşılık geldiği için burada:
 *  · `hasDottedCapitalI` — `'İ'.toLowerCase()` İKİ kod birimi üretir; ürünün
 *    metin katmanı `lower` üzerinden hesapladığı indeksleri `raw`a uyguladığı
 *    yerlerde kayma olur (ölçüldü: "…Caddesi git" → "…Caddesi g").
 *  · `hasSuffixedRoadType` — "Caddesi/Sokağı/Bulvarı" biçimleri numara
 *    doğrulama korumasının KAPSAMI DIŞINDA kalıyordu (ölçüldü).
 *  · `hasHouseNumber` — kapı numarası hiçbir katmanda yapılandırılmış olarak
 *    aranmıyor.
 */
export interface AddressQueryShape {
  readonly tokenCount: number;
  readonly lengthBucket: 'SHORT' | 'MEDIUM' | 'LONG';
  /** Türkçe noktalı büyük İ (U+0130) var mı — indeks kayması sınıfı. */
  readonly hasDottedCapitalI: boolean;
  /** ı ş ğ ü ö ç türü diyakritik var mı. */
  readonly hasDiacritic: boolean;
  /** mah · mh · cd · cad · sk · sok · blv gibi kısaltma var mı. */
  readonly hasAbbrev: boolean;
  /** Numaralı sokak/cadde deseni var mı ("0455 Sokak"). */
  readonly hasNumberedStreet: boolean;
  /** İyelik ekli yol tipi var mı ("Caddesi" · "Sokağı" · "Bulvarı"). */
  readonly hasSuffixedRoadType: boolean;
  /** Kapı numarası deseni var mı ("No 25" · sondaki 1-4 haneli sayı). */
  readonly hasHouseNumber: boolean;
  /** "Mahalle(si)" geçiyor mu — Türk adres sırası göstergesi. */
  readonly hasMahalle: boolean;
  readonly roadTypeWord: RoadTypeWord;
}

const _ABBREV_RE   = /\b(mah|mh|cad|cd|sok|sk|bulv|blv|apt)\.?\b/i;
const _NUMBERED_RE = /\d{2,5}\s*\.?\s*(sokak|sokağı|sok|sk|cadde|caddesi|cad|cd|bulvar|bulvarı|blv)\b/i;
/* YALNIZ YOL TİPİ ekli biçimleri — "Mahallesi" buraya GİRMEZ (o bir yol tipi
   değildir ve `hasMahalle` ile ayrıca ölçülür). Bu ayrım önemlidir: koruma
   kapsamı kararı yol tipinin ekli olup olmamasına bağlıdır — ölçüm 2026-08-11
   `_NUM_STREET_RE`'nin "Cadde"yi yakalayıp "Caddesi"yi KAÇIRDIĞINI gösterdi. */
const _SUFFIXED_RE = /\b(caddesi|sokağı|sokagi|bulvarı|bulvari)\b/i;
const _HOUSENO_RE  = /(\bno[:.]?\s*\d{1,4}\b|\d{1,4}\s*$)/i;
const _MAHALLE_RE  = /\bmahalle(si)?\b|\bmah\.?\b|\bmh\.?\b/i;
const _DIACRITIC_RE = /[ıİşŞğĞüÜöÖçÇ]/;

function _roadTypeWord(q: string): RoadTypeWord {
  if (/\bbulvar\w*\b|\bblv\b|\bbulv\.?\b/i.test(q)) return 'BULVAR';
  if (/\bcadde\w*\b|\bcad\.?\b|\bcd\.?\b/i.test(q)) return 'CADDE';
  if (/\bsokak\w*\b|\bsokağı\b|\bsok\.?\b|\bsk\.?\b/i.test(q)) return 'SOKAK';
  return 'NONE';
}

/**
 * Sorgu metninden PII taşımayan biçim tanımı üretir. **Metin SAKLANMAZ** —
 * çağıran bu fonksiyonun dönüşünü deftere verir, ham sorguyu ASLA vermez.
 * Saf fonksiyon.
 */
export function describeQueryShape(rawQuery: string): AddressQueryShape {
  const q = typeof rawQuery === 'string' ? rawQuery.trim().replace(/\s+/g, ' ') : '';
  const tokens = q.length === 0 ? [] : q.split(' ');
  return {
    tokenCount:          tokens.length,
    lengthBucket:        q.length <= 12 ? 'SHORT' : q.length <= 40 ? 'MEDIUM' : 'LONG',
    hasDottedCapitalI:   q.includes('İ'),
    hasDiacritic:        _DIACRITIC_RE.test(q),
    hasAbbrev:           _ABBREV_RE.test(q),
    hasNumberedStreet:   _NUMBERED_RE.test(q),
    hasSuffixedRoadType: _SUFFIXED_RE.test(q),
    hasHouseNumber:      _HOUSENO_RE.test(q),
    hasMahalle:          _MAHALLE_RE.test(q),
    roadTypeWord:        _roadTypeWord(q),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   ÖLÇÜLEN OLGULAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Aramayı BAŞLATAN yüzey — iki yüzeyin ayrışması saha kusuru olmuştu (#332). */
export type AddressSearchSurface =
  /** Mavi / adres kartı zinciri (`addressNavigationEngine.resolveAndNavigate`). */
  | 'VOICE_ADDRESS'
  /** Tam ekran harita arama çubuğu (`mapService.searchPlaces`). */
  | 'MAP_SEARCH_BAR'
  /** Yakın POI kestirmesi (benzinlik/otopark/hastane). */
  | 'NEARBY_SHORTCUT'
  /** Bilinmeyen çağıran. */
  | 'UNKNOWN';

/** Cevabı ÜRETEN katman — "hangi kaynak konuştu" sorusu sahada görünmüyordu. */
export type AddressSearchStage =
  /** BYOK premium sağlayıcı (Google/HERE/Yandex) — anahtar varsa. */
  | 'PREMIUM'
  /** Nominatim, kullanıcının YAZDIĞI sorguyla. */
  | 'NOMINATIM'
  /** Nominatim, GEVŞETİLMİŞ varyantla (onay istenir). */
  | 'NOMINATIM_RELAXED'
  /** Overpass ile sokak adına TAM eşleşme (son şans). */
  | 'OVERPASS_STREET'
  /** Cihaz-içi navigasyon geçmişi / favoriler (IndexedDB). */
  | 'LOCAL_HISTORY'
  /** İndirilmiş POI veritabanı (SQLite FTS5 / offlineDataService). */
  | 'LOCAL_POI'
  /** Daha önce online bulunmuş sonuçların localStorage önbelleği. */
  | 'GEO_CACHE'
  /** Hiçbir katman cevap üretmedi. */
  | 'NONE';

export const ADDRESS_SEARCH_STAGE_LABEL: Readonly<Record<AddressSearchStage, string>> = {
  PREMIUM:           'premium sağlayıcı (BYOK)',
  NOMINATIM:         'Nominatim — yazılan sorgu',
  NOMINATIM_RELAXED: 'Nominatim — gevşetilmiş varyant',
  OVERPASS_STREET:   'Overpass — sokak adı tam eşleşme',
  LOCAL_HISTORY:     'cihaz-içi geçmiş / favoriler',
  LOCAL_POI:         'indirilmiş POI veritabanı',
  GEO_CACHE:         'geocode önbelleği',
  NONE:              'hiçbir katman cevap vermedi',
} as const;

/** Denemenin ÖLÇÜLEN sonucu — yorum değil. */
export type AddressSearchOutcome =
  /** Tek sonuç → doğrudan rota kuruldu (kullanıcı onayı istenmedi). */
  | 'RESOLVED_AUTO'
  /** Kullanıcı listeden bir sonuç seçti. */
  | 'RESOLVED_PICKED'
  /** Liste sunuldu, kullanıcı HENÜZ seçmedi. */
  | 'AWAITING_CHOICE'
  /** Liste sunuldu, kullanıcı hiçbirini seçmeden kapattı. */
  | 'ABANDONED'
  /**
   * Liste sunuldu ama kullanıcı YAZMAYA DEVAM ETTİ → aynı yüzeyden yeni deneme
   * geldi. Bu bir başarısızlık DEĞİLDİR: deneme hiç yargılanmadı.
   *
   * NEDEN VAR: harita arama çubuğu her 350 ms'lik debounce penceresinde arama
   * yapar; "Mersin Yenişehir…" yazan kullanıcı tek bir niyet için 6-8 deneme
   * üretir. Bunlar `EMPTY`/`ABANDONED` sayılsaydı defter ön-ek sorgularıyla
   * dolar ve başarısızlık oranı UYDURMA çıkardı.
   */
  | 'SUPERSEDED'
  /** Sonuç sayısı 0. */
  | 'EMPTY'
  /** Ağ/servis hatası. */
  | 'PROVIDER_ERROR';

export const ADDRESS_SEARCH_OUTCOME_LABEL: Readonly<Record<AddressSearchOutcome, string>> = {
  RESOLVED_AUTO:   'tek sonuç → doğrudan rota',
  RESOLVED_PICKED: 'kullanıcı listeden seçti',
  AWAITING_CHOICE: 'liste sunuldu, seçim bekleniyor',
  ABANDONED:       'liste sunuldu, kullanıcı seçmeden kapattı',
  SUPERSEDED:      'kullanıcı yazmaya devam etti (yargılanmadı)',
  EMPTY:           '0 sonuç',
  PROVIDER_ERROR:  'ağ / servis hatası',
} as const;

/**
 * BAŞARISIZLIK SINIFI — hüküm değil, imza sınıfıdır.
 *
 * `UNKNOWN` bir eksiklik değil dürüst cevaptır: "OSM'de yok" ile "geocoder
 * bulamadı" imzası yer gerçeği sorulmadan BİREBİR aynıdır.
 */
export type AddressSearchFailureClass =
  /** Ürünün METİN katmanı sorguyu bozdu (ayrıştırıcı/normalizasyon). */
  | 'QUERY_CORRUPTED'
  /** Sağlayıcıya ulaşıldı, 0 sonuç döndü → veri boşluğu ŞÜPHESİ. */
  | 'PROVIDER_ZERO'
  /** Sonuç geldi ama doğrulama filtresi hepsini eledi (bulanık eşleşme). */
  | 'PROVIDER_FUZZY_REJECTED'
  /** Doğrulama korumasının KAPSAMI DIŞINDA biçim → yanlış yer sunulmuş olabilir. */
  | 'GUARD_OUT_OF_SCOPE'
  /** Son şans (Overpass) çağrılamadı ya da kullanılamaz sorgu üretti. */
  | 'FALLBACK_UNUSABLE'
  /** Yanıt fast-fail eşiğini aştı → doğru cevap gelse bile kullanılmadı. */
  | 'NETWORK_SLOW'
  /** Çevrimdışı ve önbellekte yok. */
  | 'OFFLINE_NO_CACHE'
  /** Konum yoktu → yarıçap gerektiren katmanlar hiç denenmedi. */
  | 'LOCATION_MISSING'
  /** Başarısızlık YOK (kayıt başarılı bir deneme). */
  | 'NONE'
  /** Kanıt yetersiz — sınıf iddia EDİLMEZ. */
  | 'UNKNOWN';

export const ADDRESS_SEARCH_FAILURE_LABEL: Readonly<Record<AddressSearchFailureClass, string>> = {
  QUERY_CORRUPTED:         'sorgu ürünün metin katmanında bozuldu',
  PROVIDER_ZERO:           'sağlayıcı 0 sonuç döndü (veri boşluğu şüphesi)',
  PROVIDER_FUZZY_REJECTED: 'sonuçlar geldi, doğrulama hepsini eledi',
  GUARD_OUT_OF_SCOPE:      'doğrulama koruması bu biçimi kapsamıyor',
  FALLBACK_UNUSABLE:       'son şans katmanı kullanılamadı',
  NETWORK_SLOW:            'yanıt fast-fail eşiğini aştı',
  OFFLINE_NO_CACHE:        'çevrimdışı, önbellekte yok',
  LOCATION_MISSING:        'konum yok — yarıçaplı katmanlar denenmedi',
  NONE:                    'başarısızlık yok',
  UNKNOWN:                 'kanıt yetersiz — sınıf iddia edilmiyor',
} as const;

/**
 * Kararı VEREMEDİĞİMİZ noktada eksik olan kanıt.
 * Bu liste bir sonraki turun ENSTRÜMANTASYON İŞ LİSTESİDİR.
 */
export type AddressSearchEvidenceGap =
  /** Aranan yol/yer OSM'de VAR MI sorulmadı → "veri yok" İDDİA EDİLEMEZ. */
  | 'GROUND_TRUTH'
  /** Kullanıcı seçim yaptı mı bilinmiyor (kart hâlâ açık olabilir). */
  | 'USER_CHOICE'
  /** Sağlayıcı gecikmesi ölçülmedi → NETWORK_SLOW ayırt edilemez. */
  | 'LATENCY'
  /** Sorgunun ayrıştırıcıdan geçip geçmediği bildirilmedi. */
  | 'QUERY_INTEGRITY'
  /** Konumun varlığı bildirilmedi. */
  | 'LOCATION'
  /** Hangi yüzeyin aradığı bildirilmedi → iki yüzey ayrışması görünmez. */
  | 'SURFACE';

export const ADDRESS_SEARCH_GAP_LABEL: Readonly<Record<AddressSearchEvidenceGap, string>> = {
  GROUND_TRUTH:    'OSM yer gerçeği sorulmadı (veri var mı bilinmiyor)',
  USER_CHOICE:     'kullanıcı seçimi henüz bilinmiyor',
  LATENCY:         'sağlayıcı gecikmesi ölçülmedi',
  QUERY_INTEGRITY: 'sorgu bütünlüğü bildirilmedi',
  LOCATION:        'konum varlığı bildirilmedi',
  SURFACE:         'arama yüzeyi bildirilmedi',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
   ÖRNEK → KAYIT
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir arama denemesinin ölçülen durumu. Ölçülemeyen her alan `null`. */
export interface AddressSearchSample {
  /** Duvar saati damgası — yalnız gösterim/sıralama için. */
  readonly atMs: number;
  readonly surface: AddressSearchSurface | null;
  /** Sorgunun BİÇİMİ — metin DEĞİL (gizlilik şartı #6). */
  readonly shape: AddressQueryShape;
  /**
   * Ayrıştırıcı sorguyu DEĞİŞTİRDİ mi. `null` = ayrıştırıcıdan geçmedi/bilinmiyor.
   * `true` tek başına kusur DEĞİLDİR (kısaltma açılımı meşrudur) — bu yüzden
   * ayrıca `queryLostRoadType` sorulur.
   */
  readonly queryRewritten: boolean | null;
  /**
   * Ayrıştırma sonrası yol tipi sözcüğü KAYBOLDU/DEĞİŞTİ mi (ör. "Sokak" →
   * "Mahallesi"). Ölçüldü 2026-08-11: ayrıştırıcı bunu yapıyor. `null` = bilinmiyor.
   */
  readonly queryLostRoadType: boolean | null;
  /** Cevabı üreten katman. */
  readonly stage: AddressSearchStage;
  /** Sunulan sonuç sayısı (0 olabilir). */
  readonly resultCount: number;
  /** Doğrulama filtresinin ELEDİĞİ sonuç sayısı. `null` = filtre çalışmadı. */
  readonly rejectedCount: number | null;
  /** ZİNCİRİN toplam süresi (ms). `null` = ölçülmedi. Eşikle KARŞILAŞTIRILMAZ. */
  readonly providerMs: number | null;
  /**
   * En az bir sağlayıcı denemesi 2 s fast-fail'i aşıp beklenmeden bırakıldı mı.
   * `null` = ölçülmedi → yavaşlık sınıfı İDDİA EDİLEMEZ.
   */
  readonly fastFailHit: boolean | null;
  /** Konum var mıydı (yarıçaplı katmanlar için şart). `null` = bildirilmedi. */
  readonly hadLocation: boolean | null;
  /** Cihaz o an çevrimiçi miydi. `null` = bildirilmedi. */
  readonly online: boolean | null;
  /** Son şans (Overpass) için kullanılabilir bir sorgu üretilebildi mi. */
  readonly fallbackQueryUsable: boolean | null;
  readonly outcome: AddressSearchOutcome;
}

export interface AddressSearchRecord {
  readonly atMs: number;
  readonly surface: AddressSearchSurface;
  readonly shape: AddressQueryShape;
  readonly stage: AddressSearchStage;
  readonly outcome: AddressSearchOutcome;
  /** Deneme ANINDAKİ kanıtla kurulan sınıf. */
  readonly failureClass: AddressSearchFailureClass;
  /** Kullanıcı seçimi kanıtıyla keskinleşen sınıf — seçim yoksa `failureClass`. */
  readonly refinedFailureClass: AddressSearchFailureClass;
  /** İnsan-okur tek cümle — LAB'da doğrudan gösterilir. PII TAŞIMAZ. */
  readonly note: string;
  /** Kararı engelleyen eksik kanıtlar (boş = kanıt tamdı). */
  readonly evidenceGap: readonly AddressSearchEvidenceGap[];
  /**
   * Sınıfın kanıt sağlamlığı (0–1). Eksik kanıt başına düşer; `UNKNOWN` sınıfı
   * hiçbir zaman 1.0 olamaz. Sahte kesinlik üretmemek için TÜRETİLİR, verilmez.
   */
  readonly confidence: number;
  /** Kaydı üreten modül — kanıt zincirinin adresi. */
  readonly sourceRef: string;
  readonly resultCount: number;
  readonly rejectedCount: number | null;
  readonly providerMs: number | null;
  readonly fastFailHit: boolean | null;
}

/** Kullanıcı seçimi kanıtı — liste sunulduktan SONRA bilinir. */
export interface AddressSearchChoice {
  readonly atMs: number;
  /** Kullanıcı bir sonuç seçti mi (false = seçmeden kapattı). */
  readonly picked: boolean;
}

/* ── Sınıflandırma ─────────────────────────────────────────────────────── */

function _confidenceOf(cls: AddressSearchFailureClass, gaps: readonly AddressSearchEvidenceGap[]): number {
  if (cls === 'UNKNOWN') return 0;
  /* Her eksik kanıt payı düşürür; taban 1.0'dan başlar ve 0.2'nin altına inmez
     (sınıf tamamen dayanaksız olsaydı UNKNOWN olurdu). */
  const penalty = Math.min(0.8, gaps.length * 0.2);
  return Math.round((1 - penalty) * 100) / 100;
}

/**
 * Deneme anındaki kanıttan başarısızlık sınıfı üretir.
 *
 * ⚠️ KARAR ÜRETMEZ: yeniden deneme tetiklemez, sorgu değiştirmez, sağlayıcı
 * seçmez. Yalnız sınıflandırır.
 */
export function classifyAddressSearch(
  sample: AddressSearchSample,
  sourceRef: string,
): AddressSearchRecord {
  const gaps: AddressSearchEvidenceGap[] = [];
  if (sample.surface === null)           gaps.push('SURFACE');
  if (sample.hadLocation === null)       gaps.push('LOCATION');
  if (sample.providerMs === null)        gaps.push('LATENCY');
  if (sample.queryRewritten === null)    gaps.push('QUERY_INTEGRITY');

  const surface = sample.surface ?? 'UNKNOWN';
  /* "Yavaş" = beklemeyi GERÇEKTEN bıraktık. Zincir süresine BAKMAZ (bkz.
     `ADDRESS_SEARCH_FAST_FAIL_MS` başlığındaki ölçüm). */
  const slow = sample.fastFailHit === true;
  if (sample.fastFailHit === null) gaps.push('LATENCY');

  let cls: AddressSearchFailureClass = 'UNKNOWN';
  let why = 'kanıt yetersiz';

  /* Sorgu ürünün İÇİNDE bozulduysa sağlayıcıyı suçlamak anlamsızdır —
     bu yüzden EN ÖNCE bakılır (ölçüm 2026-08-11: ayrıştırıcı "Sokak"ı
     "Mahallesi" ile değiştiriyordu; hata sessizce aşağı akıyordu). */
  if (sample.queryLostRoadType === true) {
    cls = 'QUERY_CORRUPTED';
    why = 'ayrıştırıcı yol tipi sözcüğünü kaybetti/değiştirdi';
  } else if (sample.outcome === 'RESOLVED_AUTO' || sample.outcome === 'RESOLVED_PICKED') {
    cls = 'NONE';
    why = `${ADDRESS_SEARCH_STAGE_LABEL[sample.stage]} cevapladı`;
    /* Başarı kaydında "kullanıcı seçti mi" sorusu KAPANMIŞTIR. */
  } else if (sample.outcome === 'PROVIDER_ERROR') {
    cls = slow ? 'NETWORK_SLOW' : 'UNKNOWN';
    why = slow
      ? `sağlayıcı denemesi ${ADDRESS_SEARCH_FAST_FAIL_MS} ms'de yanıt vermedi — beklemeden vazgeçildi`
      : 'servis hatası, sınıf ayırt edilemedi';
  } else if (sample.online === false) {
    cls = 'OFFLINE_NO_CACHE';
    why = 'çevrimdışı — cihaz-içi kaynaklarda eşleşme yok';
  } else if (sample.outcome === 'EMPTY') {
    if (slow) {
      cls = 'NETWORK_SLOW';
      why = 'sağlayıcı yanıtı beklenmeden bırakıldı — doğru cevap gelse bile kullanılmadı';
    } else if (sample.rejectedCount !== null && sample.rejectedCount > 0) {
      cls = 'PROVIDER_FUZZY_REJECTED';
      why = `${sample.rejectedCount} sonuç geldi, doğrulama hepsini eledi`;
    } else if (sample.hadLocation === false) {
      cls = 'LOCATION_MISSING';
      why = 'konum yok — Overpass son şansı hiç denenmedi';
    } else if (sample.fallbackQueryUsable === false) {
      cls = 'FALLBACK_UNUSABLE';
      why = 'son şans için kullanılabilir sokak sorgusu üretilemedi';
    } else {
      /* AYRILAMAZ: "OSM'de yok" ile "geocoder kör" imzası burada AYNIDIR.
         Yer gerçeği sorulmadıkça hangisi olduğu UYDURMA olur. */
      cls = 'PROVIDER_ZERO';
      why = 'sağlayıcı 0 sonuç — verinin OSM\'de olup olmadığı BİLİNMİYOR';
      gaps.push('GROUND_TRUTH');
    }
  } else if (sample.outcome === 'AWAITING_CHOICE') {
    /* Henüz başarısızlık DEĞİL: kullanıcı seçebilir. Sınıf iddia edilmez. */
    cls = 'UNKNOWN';
    why = 'liste sunuldu — sonuç kullanıcı seçimine bağlı';
    gaps.push('USER_CHOICE');
  } else if (sample.outcome === 'SUPERSEDED') {
    /* Yargılanmamış deneme — sınıf iddia edilmez ve kanıt boşluğu YAZILMAZ:
       eksik olan kanıt değil, sorunun kendisi hiç sorulmadı. */
    cls = 'UNKNOWN';
    why = 'kullanıcı yazmaya devam etti — bu deneme yargılanmadı';
  } else if (sample.outcome === 'ABANDONED') {
    cls = sample.shape.hasSuffixedRoadType && sample.shape.hasNumberedStreet
      ? 'GUARD_OUT_OF_SCOPE'
      : 'PROVIDER_FUZZY_REJECTED';
    why = 'kullanıcı sunulan hiçbir sonucu seçmedi — sunulanlar aradığı yer değildi';
  }

  /* Koruma kapsamı dışında kalan biçim, sonuç SUNULMUŞ olsa bile bir risktir:
     yanlış yere sessizce rota kurulabilir. Başarı kaydını bozmadan İŞARETLENİR. */
  if (
    cls === 'NONE' &&
    sample.shape.hasNumberedStreet &&
    sample.shape.hasSuffixedRoadType
  ) {
    cls = 'GUARD_OUT_OF_SCOPE';
    why = 'numaralı yol + ekli tip ("Caddesi"/"Sokağı") — numara doğrulaması bu biçimi kapsamıyor';
  }

  const uniqueGaps = gaps.filter((g, i) => gaps.indexOf(g) === i);
  const note = `${ADDRESS_SEARCH_OUTCOME_LABEL[sample.outcome]} · `
             + `${ADDRESS_SEARCH_STAGE_LABEL[sample.stage]} → `
             + `${ADDRESS_SEARCH_FAILURE_LABEL[cls]} · ${why}`;

  return {
    atMs: sample.atMs,
    surface,
    shape: sample.shape,
    stage: sample.stage,
    outcome: sample.outcome,
    failureClass: cls,
    refinedFailureClass: cls,
    note,
    evidenceGap: uniqueGaps,
    confidence: _confidenceOf(cls, uniqueGaps),
    sourceRef,
    resultCount: sample.resultCount,
    rejectedCount: sample.rejectedCount,
    providerMs: sample.providerMs,
    fastFailHit: sample.fastFailHit,
  };
}

/**
 * Kullanıcı seçimi kanıtını kayda işler ve ayırt EDİLEBİLİR hâle gelen sınıfı
 * keskinleştirir.
 *
 * Yalnız `AWAITING_CHOICE` kayıtları keskinleşir; kanıtı olan bir sınıf seçim
 * yüzünden DEĞİŞTİRİLMEZ (geriye dönük yeniden yorum yasağı).
 */
export function attachUserChoice(
  rec: AddressSearchRecord, choice: AddressSearchChoice,
): AddressSearchRecord {
  if (rec.outcome !== 'AWAITING_CHOICE') return rec;

  const outcome: AddressSearchOutcome = choice.picked ? 'RESOLVED_PICKED' : 'ABANDONED';
  const refined: AddressSearchFailureClass = choice.picked
    ? 'NONE'
    : (rec.shape.hasNumberedStreet && rec.shape.hasSuffixedRoadType
        ? 'GUARD_OUT_OF_SCOPE'
        : 'PROVIDER_FUZZY_REJECTED');

  const gaps = rec.evidenceGap.filter((g) => g !== 'USER_CHOICE');
  const note = `${rec.note} → SEÇİM: ${choice.picked ? 'kullanıcı bir sonuç seçti' : 'kullanıcı hiçbirini seçmedi'}`;

  return {
    ...rec,
    outcome,
    refinedFailureClass: refined,
    note,
    evidenceGap: gaps,
    confidence: _confidenceOf(refined, gaps),
  };
}

/**
 * AYNI yüzeyde seçim bekleyen kaydı `SUPERSEDED`'e taşır.
 *
 * Debounce'lu arama çubuğu tek niyet için birçok deneme üretir; eski deneme
 * yargılanmamıştır. Yalnız EN YENİ bekleyen kayıt taşınır ve yalnız `UNKNOWN`
 * sınıfındaki (yani hüküm verilmemiş) kayıt taşınabilir — kanıtı olan bir sınıf
 * geriye dönük yeniden yorumlanmaz.
 */
export function supersedePending(
  ledger: readonly AddressSearchRecord[], surface: AddressSearchSurface,
): AddressSearchRecord[] {
  for (let i = ledger.length - 1; i >= 0; i--) {
    const rec = ledger[i];
    if (rec.surface !== surface) continue;
    if (rec.outcome !== 'AWAITING_CHOICE') continue;
    const out = ledger.slice();
    out[i] = {
      ...rec,
      outcome: 'SUPERSEDED',
      note: `${rec.note} → YARGILANMADI: kullanıcı yazmaya devam etti`,
      evidenceGap: rec.evidenceGap.filter((g) => g !== 'USER_CHOICE'),
    };
    return out;
  }
  return ledger.slice();
}

/** Bounded defter — en YENİ kayıtlar korunur. */
export function appendAddressSearch(
  ledger: readonly AddressSearchRecord[], rec: AddressSearchRecord,
): AddressSearchRecord[] {
  const out = [...ledger, rec];
  return out.length > ADDRESS_SEARCH_RING ? out.slice(out.length - ADDRESS_SEARCH_RING) : out;
}

/**
 * Seçim BEKLEYEN en yeni kayda işler. Bekleyen yoksa defter DEĞİŞMEZ
 * (seçim kanıtı sahibi olmayan bir kayda yazılmaz).
 */
export function noteUserChoice(
  ledger: readonly AddressSearchRecord[], choice: AddressSearchChoice,
): AddressSearchRecord[] {
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (ledger[i].outcome !== 'AWAITING_CHOICE') continue;
    const out = ledger.slice();
    out[i] = attachUserChoice(ledger[i], choice);
    return out;
  }
  return ledger.slice();
}

/* ── Özet ──────────────────────────────────────────────────────────────── */

export interface AddressSearchSummary {
  readonly total: number;
  /** Çözülen deneme sayısı (auto + kullanıcı seçimi). */
  readonly resolvedCount: number;
  /** Başarısız deneme sayısı (seçim bekleyenler HARİÇ — henüz belli değil). */
  readonly failedCount: number;
  /** Seçim kanıtı bekleyen kayıt sayısı. */
  readonly awaitingChoiceCount: number;
  /** Yargılanmamış (kullanıcı yazmaya devam etti) deneme sayısı. */
  readonly supersededCount: number;
  /**
   * Başarısızlık oranı — YALNIZ karara bağlanmış denemeler üzerinden.
   * Karara bağlanmış deneme yoksa `null` (sahte %0 YASAK).
   */
  readonly failureRate: number | null;
  readonly byStage: Readonly<Record<AddressSearchStage, number>>;
  readonly byFailureClass: Readonly<Record<AddressSearchFailureClass, number>>;
  readonly bySurface: Readonly<Record<AddressSearchSurface, number>>;
  /**
   * Baskın başarısızlık sınıfı — **yalnız açık farkla öndeyse**. `NONE` ve
   * `UNKNOWN` yarışa GİRMEZ: biri başarı, öteki kanıt yokluğudur.
   */
  readonly dominantFailure: AddressSearchFailureClass | null;
  readonly medianProviderMs: number | null;
  readonly slowCount: number;
  readonly evidenceGapCounts: Readonly<Record<AddressSearchEvidenceGap, number>>;
  /** En çok eksik olan kanıt → "önce bunu ölç". Kayıt/boşluk yoksa `null`. */
  readonly nextMeasurement: AddressSearchEvidenceGap | null;
  /** Kayıtların ortalama kanıt sağlamlığı. Kayıt yoksa `null`. */
  readonly meanConfidence: number | null;
}

function _emptyStages(): Record<AddressSearchStage, number> {
  return {
    PREMIUM: 0, NOMINATIM: 0, NOMINATIM_RELAXED: 0, OVERPASS_STREET: 0,
    LOCAL_HISTORY: 0, LOCAL_POI: 0, GEO_CACHE: 0, NONE: 0,
  };
}

function _emptyFailures(): Record<AddressSearchFailureClass, number> {
  return {
    QUERY_CORRUPTED: 0, PROVIDER_ZERO: 0, PROVIDER_FUZZY_REJECTED: 0,
    GUARD_OUT_OF_SCOPE: 0, FALLBACK_UNUSABLE: 0, NETWORK_SLOW: 0,
    OFFLINE_NO_CACHE: 0, LOCATION_MISSING: 0, NONE: 0, UNKNOWN: 0,
  };
}

function _emptySurfaces(): Record<AddressSearchSurface, number> {
  return { VOICE_ADDRESS: 0, MAP_SEARCH_BAR: 0, NEARBY_SHORTCUT: 0, UNKNOWN: 0 };
}

function _emptyGaps(): Record<AddressSearchEvidenceGap, number> {
  return { GROUND_TRUTH: 0, USER_CHOICE: 0, LATENCY: 0, QUERY_INTEGRITY: 0, LOCATION: 0, SURFACE: 0 };
}

function _median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function summarizeAddressSearches(
  ledger: readonly AddressSearchRecord[],
): AddressSearchSummary {
  const byStage = _emptyStages();
  const byFailureClass = _emptyFailures();
  const bySurface = _emptySurfaces();
  const evidenceGapCounts = _emptyGaps();
  const latencies: number[] = [];
  const confidences: number[] = [];
  let resolvedCount = 0;
  let failedCount = 0;
  let awaitingChoiceCount = 0;
  let supersededCount = 0;
  let slowCount = 0;

  for (const r of ledger) {
    byStage[r.stage] += 1;
    byFailureClass[r.refinedFailureClass] += 1;
    bySurface[r.surface] += 1;
    for (const g of r.evidenceGap) evidenceGapCounts[g] += 1;
    confidences.push(r.confidence);
    if (r.providerMs !== null) latencies.push(r.providerMs);
    /* Yavaşlık zincir süresinden DEĞİL, beklemenin bırakılıp bırakılmadığından
       sayılır — zincir üç deneme yaptığı için süresi zaten eşiği aşar. */
    if (r.fastFailHit === true) slowCount += 1;
    if (r.outcome === 'AWAITING_CHOICE') awaitingChoiceCount += 1;
    /* Yargılanmamış deneme ne başarı ne başarısızlıktır → orana GİRMEZ. */
    else if (r.outcome === 'SUPERSEDED') supersededCount += 1;
    else if (r.outcome === 'RESOLVED_AUTO' || r.outcome === 'RESOLVED_PICKED') resolvedCount += 1;
    else failedCount += 1;
  }

  const decided = resolvedCount + failedCount;

  const contenders = (Object.keys(byFailureClass) as AddressSearchFailureClass[])
    .filter((k) => k !== 'NONE' && k !== 'UNKNOWN')
    .map((k) => [k, byFailureClass[k]] as const)
    .sort((a, b) => b[1] - a[1]);
  let dominantFailure: AddressSearchFailureClass | null = null;
  if (decided > 0 && contenders.length > 0 && contenders[0][1] > 0) {
    const share = contenders[0][1] / decided;
    const clearLead = contenders.length < 2 || contenders[0][1] > contenders[1][1];
    if (share >= ADDRESS_SEARCH_DOMINANT_MIN_SHARE && clearLead) dominantFailure = contenders[0][0];
  }

  const gapRank = (Object.keys(evidenceGapCounts) as AddressSearchEvidenceGap[])
    .map((k) => [k, evidenceGapCounts[k]] as const)
    .sort((a, b) => b[1] - a[1]);

  return {
    total: ledger.length,
    resolvedCount,
    failedCount,
    awaitingChoiceCount,
    supersededCount,
    failureRate: decided > 0 ? Math.round((failedCount / decided) * 100) / 100 : null,
    byStage,
    byFailureClass,
    bySurface,
    dominantFailure,
    medianProviderMs: _median(latencies),
    slowCount,
    evidenceGapCounts,
    nextMeasurement: gapRank.length > 0 && gapRank[0][1] > 0 ? gapRank[0][0] : null,
    meanConfidence: confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
      : null,
  };
}
