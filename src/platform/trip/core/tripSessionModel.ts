/**
 * tripSessionModel.ts — SEYAHAT OTURUMU (saf).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK ·
 * import YOK. Tüm girdiler dışarıdan → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Mavi "3 saattir yoldayız" derken gerçek 40 dakikaydı; kat edilen km de
 * yanlıştı. KÖK: `tripLogService`'te yolculuğu kapatan duruş penceresi YALNIZ
 * `_onGPS`/`_onOBD` gövdesinin İÇİNDE kuruluyor (`_liveClock` yalnız
 * dinleyicilere haber verir, bitiş DEĞERLENDİRMEZ). Araç park edip GPS ve OBD
 * tamamen susunca hiçbir callback gelmez → kapanış zamanlayıcısı hiç kurulmaz
 * → yolculuk açık kalır ve bir sonraki sürüşte AYNI oturum devam eder.
 * `liveDurationMin` monotonik olduğu için park süresini de sayar.
 *
 * ── BU MODELİN İŞİ ────────────────────────────────────────────────────────
 * `tripLogService`'in ÜRETTİĞİ yolculukları ve aralarındaki BOŞLUKLARI tek bir
 * "seyahat"e toplamak. Sürücünün sorduğu şey tekil yolculuk değildir:
 *
 *     08:20 hareket · 08:50 durdu · 09:10 tekrar hareket
 *     → yola çıkalı 50 dk · hareket 30 dk · mola 20 dk
 *
 * ── SAHİPLİK (pazarlıksız) ────────────────────────────────────────────────
 * Bu model HİÇBİR ŞEY ÖLÇMEZ. Her sayı mevcut sahibinden gelir:
 *   · hareket/rölanti/bilinmeyen süre → `tripMetricsAccumulator` (movingMs/idleMs/unknownMs)
 *   · kat edilen mesafe              → `tripLogService` (GPS haversine + OBD yedeği)
 *   · anlık duruş                    → `tripMetricsAccumulator.stopSincePerfMs`
 *
 * SAHİPSİZ OLAN TEK ŞEY, bu modelin GERÇEKTEN türettiği şeydir: **iki yolculuk
 * arasındaki boşluk** — yani MOLA. Bugün bunu kimse tutmuyor.
 *
 * ── BU MODELİN YAPMADIĞI ──────────────────────────────────────────────────
 *  · Mesafe BİRİKTİRMEZ: segment mesafesi dışarıdan KÜMÜLATİF gelir, model
 *    yalnız segment değişiminde MÜHÜRLER → çifte sayım YAPISAL olarak imkânsız.
 *  · Ölü hesaplama (PR-451a) mesafesini EKLEMEZ — o bir projeksiyondur, ölçüm
 *    değil; odometreye de dokunulmaz.
 *  · KALAN rota mesafesini kat edilen mesafe SAYMAZ (ikisi ayrı kavramdır).
 *  · Bilinmeyen süreyi "mola" SAYMAZ — ayrı kovada dürüstçe taşır.
 *  · Her kısa duruşta YENİ oturum açmaz.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir molanın oturumu BİTİRDİĞİ eşik.
 *
 * Neden 45 dk: kullanıcı senaryosundaki 20 dk'lık mola oturumu BİTİRMEMELİ
 * (şart), ama saatler sonraki ayrı bir sürüş de aynı seyahat SAYILMAMALI —
 * "3 saattir yoldayız" kusuru tam olarak buydu. 45 dk yemek/yakıt molasının
 * rahatça üstünde, ayrı bir seyahatin ise altındadır.
 */
export const SESSION_MAX_BREAK_MS = 45 * 60_000;

/** Mola kaydı tavanı — sınırsız dizi büyümesi YOK (bellek sözleşmesi). */
export const MAX_STOP_PERIODS = 50;

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type TripSessionState = 'NOT_STARTED' | 'MOVING' | 'STOPPED';

/**
 * Oturumun TÜRÜ — kullanıcı NİYETİNDEN gelir, ölçümden değil.
 *
 *  · `JOURNEY`   — navigasyon hedefi VAR: "hedefe giden bir yolculuktayım".
 *  · `DRIVE_LOG` — hedef YOK: "aracın hareket geçmişini kaydediyorum".
 *
 * AYRIM NEDEN ÜRÜN KARARIDIR: hedef yokken CarOS kullanıcı adına "yolculuk
 * bitti" diyemez — nereye gittiğini bilmediği bir sürüşün BİTTİĞİNİ de
 * bilemez. Hedef varken ise tersi geçerlidir: dinlenme tesisinde 40 dk
 * durmak yolculuğu BİTİRMEZ, çünkü niyet hâlâ ortadadır.
 */
export type TripSessionKind = 'JOURNEY' | 'DRIVE_LOG';

/**
 * Oturum KAPANIŞ hükmü.
 *
 *  · `OPEN`                — sürüyor (ya da bitip bitmediği BİLİNMİYOR).
 *  · `DESTINATION_REACHED` — navigasyon otoritesi varışı MÜHÜRLEDİ.
 *
 * Başka bir "tamamlandı" hükmü YOKTUR: rota iptali, motor kapanması, veri
 * sessizliği ve depolama segmentinin mühürlenmesi TAMAMLANMA DEĞİLDİR.
 */
export type TripSessionCompletion = 'OPEN' | 'DESTINATION_REACHED';

export interface TripPoint {
  readonly lat: number;
  readonly lon: number;
}

/** Bir mola — iki yolculuk arasındaki boşluk. */
export interface TripStopPeriod {
  /** Molanın başladığı monotonik an. */
  readonly startedMonoMs: number;
  /** Bittiği an; `null` = mola HÂLÂ sürüyor. */
  readonly endedMonoMs: number | null;
  /** Kapanmış molanın süresi (ms). Süren molada 0 — süre `project` ile okunur. */
  readonly durationMs: number;
}

/**
 * `tripLogService`'in aktif yolculuğundan okunan KÜMÜLATİF görüntü.
 *
 * `key` segment kimliğidir (yolculuğun monotonik başlangıcı) — DEĞİŞMESİ yeni
 * bir yolculuk demektir ve mühürleme tam orada olur.
 */
export interface TripSessionSegment {
  readonly key: number;
  /** Yolculuğun gerçek başlangıcı — monotonik (oturum başlangıcı buradan gelir). */
  readonly startedMonoMs: number;
  /** Yolculuğun gerçek başlangıcı — duvar saati (yalnız GÖSTERİM). */
  readonly startedWallMs: number;
  /** `tripMetricsAccumulator` kovaları (kümülatif, ms). */
  readonly movingMs: number;
  readonly idleMs: number;
  readonly unknownMs: number;
  /** `tripLogService` kat edilen mesafe (kümülatif, metre). */
  readonly distanceM: number;
  /** İçinde bulunulan duruşun başlangıcı; hareket hâlindeyse `null`. */
  readonly stoppedSinceMonoMs: number | null;

  /* ── SEGMENTİN KANONİK ÖLÇÜMLERİ ───────────────────────────────────────
     Hepsi MEVCUT sahiplerinden gelir; bu model hiçbirini ÜRETMEZ, yalnız
     segmentler arasında toplar/en büyüğünü alır. Yeni mesafe · hız · yakıt
     · sert manevra dedektörü YOKTUR (bkz. dosya başlığı). */

  /** GPS haversine payı (m) — mesafe kaynağı sınıfı buna bakar. */
  readonly gpsDistanceM?: number;
  /** OBD Euler payı (m). */
  readonly obdDistanceM?: number;
  /** Gözlenen tepe hız (km/s) — `tripLogService`. */
  readonly maxSpeedKmh?: number;
  /** Hız örneklerinin toplamı ve sayısı — ortalama BURADA hesaplanmaz. */
  readonly speedSum?: number;
  readonly speedCount?: number;
  /** Debounce'lu gerçek duruş sayısı — `tripMetricsAccumulator`. */
  readonly stopCount?: number;
  /** Sert manevra sayaçları — 9d78b68e ile TEK kanonik sahibi akümülatördür. */
  readonly harshBrakeCount?: number;
  readonly harshAccelCount?: number;
  /** OBD tepe değerleri; ölçülmediyse `null`. */
  readonly maxRpm?: number | null;
  readonly maxEngineTempC?: number | null;
  /**
   * Segmentte harcanan yakıt YÜZDESİ — hüküm `evaluateFuelMeasurement`'a
   * aittir ve burada TEKRARLANMAZ. Ölçüm kapıları geçilmediyse `null`
   * (tahmini sayı ÜRETİLMEZ). Litreye çevirme depo hacmini bilen SUNUM
   * katmanının işidir; bu model litre HESAPLAMAZ.
   */
  readonly fuelUsedPct?: number | null;
  /**
   * Yakıt birim fiyatı anlık görüntüsü — ÖLÇÜM DEĞİL, bağlamdır
   * (`tripLogService` yolculuk başında yakalar). Oturum bunu yalnız TAŞIR:
   * maliyet, molada da gösterilebilsin diye son bilinen fiyat korunur.
   */
  readonly priceUnit?: number | null;
  readonly priceCurrency?: string | null;
  readonly priceSource?: string | null;
}

/** Tek okuma anı — runtime bunu üretir, model yorumlar. */
export interface TripSessionSample {
  readonly monoMs: number;
  readonly wallMs: number;
  /** `null` = `tripLogService`'te aktif yolculuk YOK (mola ya da henüz başlamadı). */
  readonly segment: TripSessionSegment | null;
  readonly lat: number | null;
  readonly lon: number | null;
  /**
   * Navigasyon OTURUMU açık mı (`NavigationState.isNavigating`).
   *
   * Bu model navigasyonu OKUMAZ — değer dışarıdan gelir (saflık). Verilmezse
   * `false` sayılır: niyet KANITLANMADIKÇA varsayılmaz.
   */
  readonly routeActive?: boolean;
  /**
   * Navigasyon varış mührünün sırası (`getNavArrivalMark().seq`).
   * 0 = hiç varış gözlenmedi. Oturum yalnız KENDİ açılışından SONRA artan
   * bir mührü sahiplenir — eski bir varış yeni yolculuğu tamamlayamaz.
   */
  readonly arrivalSeq?: number;
}

export interface TripSession {
  /** Oturumun türü — navigasyon niyetinden gelir (bkz. `TripSessionKind`). */
  readonly kind: TripSessionKind;
  /** Kapanış hükmü — yalnız mühürlenmiş varış kapatır. */
  readonly completion: TripSessionCompletion;
  /** Son örnekte navigasyon oturumu açık mıydı. */
  readonly routeActive: boolean;
  /** Oturum açılırken gözlenen varış mührü sırası (sahiplenme sınırı). */
  readonly arrivalSeqAtOpen: number;
  /** Oturum kimliği — `null` = henüz hiç hareket edilmedi. */
  readonly sessionId: string | null;
  /** Oturumun başladığı duvar saati (GÖSTERİM) — "yola ne zaman çıktık". */
  readonly startWallMs: number | null;
  /** Oturumun başladığı monotonik an (OTORİTE). */
  readonly startMonoMs: number | null;
  /** En son HAREKET gözlenen monotonik an. */
  readonly lastMotionMonoMs: number | null;
  readonly state: TripSessionState;

  /* ── Mühürlenmiş segmentlerin toplamı (kapanmış yolculuklar) ── */
  readonly sealedMovingMs: number;
  readonly sealedIdleMs: number;
  readonly sealedUnknownMs: number;
  readonly sealedDistanceM: number;
  readonly sealedGpsDistanceM: number;
  readonly sealedObdDistanceM: number;
  readonly sealedMaxSpeedKmh: number;
  readonly sealedSpeedSum: number;
  readonly sealedSpeedCount: number;
  readonly sealedStopCount: number;
  readonly sealedHarshBrakeCount: number;
  readonly sealedHarshAccelCount: number;
  readonly sealedMaxRpm: number | null;
  readonly sealedMaxEngineTempC: number | null;
  /** Mühürlenmiş segmentlerin ÖLÇÜLEN yakıt yüzdesi toplamı. */
  readonly sealedFuelPct: number;
  /** Son bilinen yakıt fiyatı bağlamı (ölçüm değil) — mola boyunca korunur. */
  readonly lastPriceUnit: number | null;
  readonly lastPriceCurrency: string | null;
  readonly lastPriceSource: string | null;
  /**
   * Mühürlenen HER segmentte yakıt ölçülebildi mi.
   *
   * Tek bir segment bile ölçülemediyse oturum toplamı EKSİKTİR; eksik
   * toplamı "yolculuğun yakıtı" diye sunmak uydurma olurdu. `false` ise
   * projeksiyon yakıtı `null` verir — kısmi sayı SUNULMAZ.
   */
  readonly sealedFuelComplete: boolean;
  /** Segmentler ARASI mola toplamı — bu modelin türettiği TEK büyüklük. */
  readonly sealedBreakMs: number;

  /* ── İçinde bulunulan segment (kümülatif, henüz mühürlenmedi) ── */
  readonly currentSegment: TripSessionSegment | null;

  /** Süren molanın başlangıcı; `null` = mola yok. */
  readonly breakSinceMonoMs: number | null;

  readonly startLocation: TripPoint | null;
  readonly currentLocation: TripPoint | null;
  readonly stopPeriods: readonly TripStopPeriod[];
  /** Son örneğin alındığı monotonik an. */
  readonly lastUpdateMonoMs: number | null;
  /** Bu oturumda kaç ayrı yolculuk (segment) birleşti. */
  readonly segmentCount: number;
}

/** `project()` çıktısı — okunmaya hazır, TÜRETİLMİŞ görüntü. */
export interface TripSessionProjection {
  readonly sessionId: string | null;
  readonly state: TripSessionState;
  readonly startWallMs: number | null;
  /** Yola çıkalı geçen toplam süre (ms). */
  readonly elapsedMs: number;
  /** Hareket hâlinde geçen süre (ms) — `tripMetricsAccumulator` otoritesi. */
  readonly movingMs: number;
  /** Mola + rölanti (ms): segment içi duruş + segmentler arası boşluk. */
  readonly stoppedMs: number;
  /** ÖLÇÜLEMEYEN süre — "mola" SAYILMAZ, dürüstçe ayrı taşınır. */
  readonly unknownMs: number;
  /** Kat edilen mesafe (m) — KALAN rota mesafesi DEĞİLDİR. */
  readonly distanceMeters: number;
  readonly startLocation: TripPoint | null;
  readonly currentLocation: TripPoint | null;
  readonly stopPeriods: readonly TripStopPeriod[];
  readonly segmentCount: number;
  /** Süren molanın uzunluğu (ms); mola yoksa 0. */
  readonly currentBreakMs: number;
  /**
   * Süren mola oturum eşiğini AŞTI mı. `true` ise bir sonraki hareket YENİ
   * oturum başlatır.
   *
   * ROTA AKTİFKEN DAİMA `false`: hedefe varılmadan geçen süre, ne kadar
   * uzun olursa olsun, oturumu bitirmez (dinlenme tesisi · yemek · yakıt ·
   * motoru kapatmak). Eşik yalnız niyetin BİLİNMEDİĞİ sürüşlerde işler.
   */
  readonly breakExceededSession: boolean;
  readonly kind: TripSessionKind;
  readonly completion: TripSessionCompletion;
  /** Navigasyon oturumu şu an açık mı. */
  readonly routeActive: boolean;

  /* ── OTURUM BOYU KANONİK TOPLAMLAR (segmentlerden toplanır) ───────────
     Depolama sınırı kullanıcı sınırı DEĞİLDİR: dinlenme tesisinde mühürlenen
     segment kullanıcı için yolculuğun ortasıdır. Bu alanlar yolculuğun
     BAŞINDAN İTİBAREN toplam gerçeği taşır. */

  /** GPS ve OBD paylarının ayrı toplamı — mesafe kaynağı sınıfı için. */
  readonly gpsDistanceMeters: number;
  readonly obdDistanceMeters: number;
  /** Oturum boyu gözlenen tepe hız (km/s); hiç örnek yoksa `null`. */
  readonly maximumSpeedKmh: number | null;
  /** Oturum boyu ortalama hız (km/s) — örnek toplamı/sayısı; yoksa `null`. */
  readonly averageSpeedKmh: number | null;
  /** Debounce'lu gerçek duruş sayısı (segmentler toplamı). */
  readonly stopCount: number;
  /** Sert manevralar — kanonik akümülatör sayaçlarının toplamı. */
  readonly harshBrakeCount: number;
  readonly harshAccelCount: number;
  readonly maxRpm: number | null;
  readonly maxEngineTempC: number | null;
  /**
   * Oturum boyu harcanan yakıt YÜZDESİ. Segmentlerden BİRİ bile ölçülemediyse
   * `null` — eksik toplam "yolculuğun yakıtı" diye sunulmaz.
   */
  readonly fuelUsedPct: number | null;
  /** Kaç segmentin mühürlendiği + süren segment (gözlem/teşhis). */
  readonly segmentSealedCount: number;
  /** Son bilinen yakıt fiyatı bağlamı — ölçüm DEĞİLDİR. */
  readonly priceUnit: number | null;
  readonly priceCurrency: string | null;
  readonly priceSource: string | null;
  /**
   * ÜRÜN ANLAMINDA yolculuk tamamlandı mı — YALNIZ mühürlenmiş varış.
   *
   * Depolama segmentinin kapanması (`tripLogService` duruş penceresi),
   * molanın eşiği aşması, rota iptali veya motorun kapanması BURAYA
   * `true` YAZMAZ. Depolama yaşam döngüsü ile ürün yolculuğu AYRI şeylerdir.
   */
  readonly journeyCompleted: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Negatif/ölçülemeyen süre 0 sayılır — sayaçlar GERİ GİTMEZ. */
function _ms(n: unknown): number {
  return _finite(n) && n > 0 ? n : 0;
}

function _point(lat: unknown, lon: unknown): TripPoint | null {
  if (!_finite(lat) || !_finite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Varış mührü sırası — ölçülemeyen/negatif değer "hiç varış yok" sayılır. */
function _seq(n: unknown): number {
  return _finite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Boş oturum — TÜM anahtarlar baştan tanımlı (V8 hidden-class kararlılığı). */
export function emptyTripSession(): TripSession {
  return {
    kind:             'DRIVE_LOG',
    completion:       'OPEN',
    routeActive:      false,
    arrivalSeqAtOpen: 0,
    sessionId:        null,
    startWallMs:      null,
    startMonoMs:      null,
    lastMotionMonoMs: null,
    state:            'NOT_STARTED',
    sealedMovingMs:   0,
    sealedIdleMs:     0,
    sealedUnknownMs:  0,
    sealedDistanceM:  0,
    sealedGpsDistanceM:   0,
    sealedObdDistanceM:   0,
    sealedMaxSpeedKmh:    0,
    sealedSpeedSum:       0,
    sealedSpeedCount:     0,
    sealedStopCount:      0,
    sealedHarshBrakeCount: 0,
    sealedHarshAccelCount: 0,
    sealedMaxRpm:         null,
    sealedMaxEngineTempC: null,
    sealedFuelPct:        0,
    sealedFuelComplete:   true,
    lastPriceUnit:        null,
    lastPriceCurrency:    null,
    lastPriceSource:      null,
    sealedBreakMs:    0,
    currentSegment:   null,
    breakSinceMonoMs: null,
    startLocation:    null,
    currentLocation:  null,
    stopPeriods:      [],
    lastUpdateMonoMs: null,
    segmentCount:     0,
  };
}

/** Segment girdisini savunmacı okur; kullanılamazsa `null`. */
function _readSegment(s: unknown): TripSessionSegment | null {
  if (s === null || typeof s !== 'object') return null;
  const g = s as Record<string, unknown>;
  if (!_finite(g['key']) || !_finite(g['startedMonoMs'])) return null;
  return {
    key:            g['key'] as number,
    startedMonoMs:  g['startedMonoMs'] as number,
    startedWallMs:  _finite(g['startedWallMs']) ? (g['startedWallMs'] as number) : 0,
    movingMs:       _ms(g['movingMs']),
    idleMs:         _ms(g['idleMs']),
    unknownMs:      _ms(g['unknownMs']),
    distanceM:      _ms(g['distanceM']),
    stoppedSinceMonoMs: _finite(g['stoppedSinceMonoMs'])
      ? (g['stoppedSinceMonoMs'] as number) : null,
    /* Kanonik ölçümler savunmacı okunur: eksik alan 0/`null` olur ve
       toplama KATILMAZ — uydurma değer üretilmez. */
    gpsDistanceM:    _ms(g['gpsDistanceM']),
    obdDistanceM:    _ms(g['obdDistanceM']),
    maxSpeedKmh:     _ms(g['maxSpeedKmh']),
    speedSum:        _ms(g['speedSum']),
    speedCount:      _ms(g['speedCount']),
    stopCount:       _ms(g['stopCount']),
    harshBrakeCount: _ms(g['harshBrakeCount']),
    harshAccelCount: _ms(g['harshAccelCount']),
    maxRpm:          _finite(g['maxRpm']) ? (g['maxRpm'] as number) : null,
    maxEngineTempC:  _finite(g['maxEngineTempC']) ? (g['maxEngineTempC'] as number) : null,
    fuelUsedPct:     _finite(g['fuelUsedPct']) && (g['fuelUsedPct'] as number) >= 0
      ? (g['fuelUsedPct'] as number) : null,
    priceUnit:       _finite(g['priceUnit']) && (g['priceUnit'] as number) >= 0
      ? (g['priceUnit'] as number) : null,
    priceCurrency:   typeof g['priceCurrency'] === 'string' ? g['priceCurrency'] : null,
    priceSource:     typeof g['priceSource'] === 'string' ? g['priceSource'] : null,
  };
}

/** İki tepe değerin büyüğü; ikisi de ölçülmemişse `null` (0 UYDURULMAZ). */
function _peak(a: number | null, b: number | null | undefined): number | null {
  const bb = _finite(b) ? b : null;
  if (a === null) return bb;
  if (bb === null) return a;
  return Math.max(a, bb);
}

/** Mevcut segmenti toplamlara MÜHÜRLE — kümülatif değerler tam burada donar. */
function _seal(session: TripSession): TripSession {
  const cur = session.currentSegment;
  if (cur === null) return session;
  return {
    ...session,
    sealedMovingMs:  session.sealedMovingMs  + cur.movingMs,
    sealedIdleMs:    session.sealedIdleMs    + cur.idleMs,
    sealedUnknownMs: session.sealedUnknownMs + cur.unknownMs,
    sealedDistanceM: session.sealedDistanceM + cur.distanceM,
    sealedGpsDistanceM: session.sealedGpsDistanceM + _ms(cur.gpsDistanceM),
    sealedObdDistanceM: session.sealedObdDistanceM + _ms(cur.obdDistanceM),
    /* Tepe hız TOPLANMAZ — en büyüğü alınır. */
    sealedMaxSpeedKmh:  Math.max(session.sealedMaxSpeedKmh, _ms(cur.maxSpeedKmh)),
    /* Ortalama hız segment ortalamalarının ortalaması DEĞİLDİR: örnek
       toplamı ve sayısı ayrı taşınır, bölme okuma anında yapılır. */
    sealedSpeedSum:     session.sealedSpeedSum   + _ms(cur.speedSum),
    sealedSpeedCount:   session.sealedSpeedCount + _ms(cur.speedCount),
    sealedStopCount:    session.sealedStopCount  + _ms(cur.stopCount),
    sealedHarshBrakeCount: session.sealedHarshBrakeCount + _ms(cur.harshBrakeCount),
    sealedHarshAccelCount: session.sealedHarshAccelCount + _ms(cur.harshAccelCount),
    sealedMaxRpm:         _peak(session.sealedMaxRpm, cur.maxRpm),
    sealedMaxEngineTempC: _peak(session.sealedMaxEngineTempC, cur.maxEngineTempC),
    /* Yakıt: ölçülebilen segmentler toplanır, ölçülemeyen BİR segment bile
       toplamı EKSİK yapar ve bayrak düşer (kısmi sayı sunulmaz). */
    sealedFuelPct:      session.sealedFuelPct
      + (_finite(cur.fuelUsedPct) ? (cur.fuelUsedPct as number) : 0),
    sealedFuelComplete: session.sealedFuelComplete && _finite(cur.fuelUsedPct),
    currentSegment:  null,
  };
}

/** Yeni oturum aç (segmentin KENDİ başlangıcıyla — gözlem anıyla DEĞİL). */
function _open(seg: TripSessionSegment, sample: TripSessionSample): TripSession {
  const base = emptyTripSession();
  const routeActive = sample.routeActive === true;
  return {
    ...base,
    /* NİYET AÇILIŞTA OKUNUR: hedef varsa bu bir YOLCULUK, yoksa sürüş
       günlüğüdür. Sonradan hedef girilirse tür YÜKSELİR (bkz. advance). */
    kind:             routeActive ? 'JOURNEY' : 'DRIVE_LOG',
    routeActive,
    /* Açılıştan ÖNCEKİ varışlar bu oturuma ait değildir. */
    arrivalSeqAtOpen: _seq(sample.arrivalSeq),
    /* Kimlik monotonik başlangıçtan türer: aynı oturum iki kez açılamaz ve
       `Date.now`/rastgelelik gerekmez (saflık korunur). */
    sessionId:        `session-${Math.round(seg.startedMonoMs)}`,
    startWallMs:      seg.startedWallMs > 0 ? seg.startedWallMs : sample.wallMs,
    startMonoMs:      seg.startedMonoMs,
    lastMotionMonoMs: sample.monoMs,
    state:            seg.stoppedSinceMonoMs === null ? 'MOVING' : 'STOPPED',
    currentSegment:   seg,
    startLocation:    _point(sample.lat, sample.lon),
    currentLocation:  _point(sample.lat, sample.lon),
    lastUpdateMonoMs: sample.monoMs,
    segmentCount:     1,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * İlerletme
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * NİYETİ ve VARIŞI oturuma uygula — açık oturumda her örnekte çalışır.
 *
 * ÜÇ KURAL, ÜÇÜ DE TEK YÖNLÜ:
 *  1. `routeActive` son örneğe göre tazelenir (mola sırasında da).
 *  2. `DRIVE_LOG` → `JOURNEY` YÜKSELİR: kullanıcı yola çıktıktan sonra hedef
 *     girmiş olabilir; bu aynı sürüşün devamıdır, yeni yolculuk değildir.
 *     Tür geri DÜŞMEZ — rota iptali yolculuğu sürüş günlüğüne çevirmez,
 *     çünkü niyet gerçekten VARDI (bkz. iptal ≠ varış).
 *  3. Varış YALNIZ oturumun KENDİ açılışından sonra artan bir mühürle
 *     sahiplenilir ve yalnız `JOURNEY` için geçerlidir: hedefi olmayan bir
 *     sürüş "hedefe vardı" diyemez.
 */
function _applyIntent(session: TripSession, sample: TripSessionSample): TripSession {
  const routeActive = sample.routeActive === true;
  const kind: TripSessionKind =
    session.kind === 'JOURNEY' || routeActive ? 'JOURNEY' : 'DRIVE_LOG';

  /* Tür bu örnekte yükseldiyse sahiplenme sınırı DA o ana taşınır: hedef
     girilmeden önce olmuş bir varış bu yolculuğu tamamlayamaz. */
  const arrivalSeqAtOpen = session.kind === 'DRIVE_LOG' && kind === 'JOURNEY'
    ? _seq(sample.arrivalSeq)
    : session.arrivalSeqAtOpen;

  const reached = kind === 'JOURNEY'
    && _seq(sample.arrivalSeq) > arrivalSeqAtOpen;

  return {
    ...session,
    kind,
    routeActive,
    arrivalSeqAtOpen,
    completion: reached ? 'DESTINATION_REACHED' : session.completion,
  };
}

/**
 * Oturumu tek örnekle ilerlet.
 *
 * FAIL-SAFE: ölçülemeyen örnek oturumu DEĞİŞTİRMEZ (geri sarma yok, uydurma
 * yok). Zaman geriye giderse (monotonik olmayan kaynak) örnek YOK SAYILIR.
 */
export function advanceTripSession(
  session: TripSession,
  sample: TripSessionSample,
): TripSession {
  if (!sample || !_finite(sample.monoMs)) return session;
  /* Monotoniklik şartı: geriye giden zaman süre kovalarını bozardı. */
  if (session.lastUpdateMonoMs !== null && sample.monoMs < session.lastUpdateMonoMs) {
    return session;
  }

  const seg = _readSegment(sample.segment);
  const here = _point(sample.lat, sample.lon);

  /* Niyet AÇIK oturumda her örnekte tazelenir; henüz oturum yoksa açılışta
     okunur (`_open`). */
  if (session.startMonoMs !== null) session = _applyIntent(session, sample);

  /* ── A) Aktif yolculuk YOK → MOLA (ya da henüz başlamadı) ─────────────── */
  if (seg === null) {
    if (session.startMonoMs === null) {
      // Hiç hareket edilmedi: oturum AÇILMAZ. Rota kurulması yola çıkmak DEĞİLDİR.
      return session;
    }
    // Segment kapandıysa mühürle ve molayı başlat.
    let next = _seal(session);
    if (next.breakSinceMonoMs === null) {
      const startedAt = session.lastUpdateMonoMs ?? sample.monoMs;
      const periods = next.stopPeriods.length >= MAX_STOP_PERIODS
        ? next.stopPeriods.slice(1)
        : next.stopPeriods;
      next = {
        ...next,
        breakSinceMonoMs: startedAt,
        stopPeriods: [...periods, { startedMonoMs: startedAt, endedMonoMs: null, durationMs: 0 }],
      };
    }
    return {
      ...next,
      state:            'STOPPED',
      currentLocation:  here ?? next.currentLocation,
      lastUpdateMonoMs: sample.monoMs,
    };
  }

  /* ── B) İlk hareket → oturumu AÇ ──────────────────────────────────────── */
  if (session.startMonoMs === null) return _open(seg, sample);

  /* ── C) Yeni segment mi? ──────────────────────────────────────────────── */
  if (session.currentSegment !== null && session.currentSegment.key !== seg.key) {
    // Önceki segment mühürlenmemişse burada mühürlenir (mola görülmeden geçiş).
    session = _seal(session);
  }

  const isNewSegment = session.currentSegment === null;

  if (isNewSegment) {
    const breakStart = session.breakSinceMonoMs;
    const breakMs = breakStart === null ? 0 : Math.max(0, seg.startedMonoMs - breakStart);

    /* ── HEDEFE VARILDIYSA oturum KAPANMIŞTIR ─────────────────────────
       Yeni hareket yeni yolculuktur; varılmış bir yolculuğa segment
       EKLENMEZ. Bu, ürün anlamında tek meşru kapanıştır. */
    if (session.completion === 'DESTINATION_REACHED') return _open(seg, sample);

    /* ── MOLA EŞİĞİ — YALNIZ NİYET BİLİNMİYORSA ───────────────────────
       Rota aktifken mola oturumu BİTİRMEZ: dinlenme tesisi, yemek, yakıt
       ve motorun kapatılması hedefe varmak DEĞİLDİR. Eşik yalnız hedefsiz
       sürüşlerde (sürüş günlüğü) işler; orada da "yolculuk tamamlandı"
       demez — yalnız yeni bir kayıt bloğu açar (bkz. `journeyCompleted`). */
    if (breakMs >= SESSION_MAX_BREAK_MS && !session.routeActive) {
      return _open(seg, sample);
    }

    /* Aynı oturum devam eder: molayı kapat ve toplama ekle. */
    const periods = session.stopPeriods.map((p, i) =>
      i === session.stopPeriods.length - 1 && p.endedMonoMs === null
        ? { startedMonoMs: p.startedMonoMs, endedMonoMs: seg.startedMonoMs, durationMs: breakMs }
        : p,
    );
    session = {
      ...session,
      sealedBreakMs:    session.sealedBreakMs + breakMs,
      breakSinceMonoMs: null,
      stopPeriods:      periods,
      segmentCount:     session.segmentCount + 1,
    };
  }

  /* ── D) Segmenti güncelle (kümülatif — model BİRİKTİRMEZ) ─────────────── */
  const moving = seg.stoppedSinceMonoMs === null;
  return {
    ...session,
    /* Fiyat bağlamı SON BİLİNEN hâliyle taşınır; ölçüm değildir ve
       bilinmeyen bir fiyat eskisini SİLMEZ (uydurma da yapmaz). */
    lastPriceUnit:     _finite(seg.priceUnit) ? (seg.priceUnit as number) : session.lastPriceUnit,
    lastPriceCurrency: seg.priceCurrency ?? session.lastPriceCurrency,
    lastPriceSource:   seg.priceSource ?? session.lastPriceSource,
    state:            moving ? 'MOVING' : 'STOPPED',
    currentSegment:   seg,
    lastMotionMonoMs: moving ? sample.monoMs : session.lastMotionMonoMs,
    currentLocation:  here ?? session.currentLocation,
    startLocation:    session.startLocation ?? here,
    lastUpdateMonoMs: sample.monoMs,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Okuma (türetme)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Yolculuk ortalama hızının TEK tanımı: gidilen yol / sürüş süresi (ışıkta
 * bekleme DAHİL, park molası HARİÇ) — ekrandaki yol ve süreyle tutarlı.
 *
 * SAHA 2026-09-25: 6,2 km / 15 dk ekranında "42 km/s" yazıyordu; eski değer
 * hız ÖRNEKLERİNİN ortalamasıydı (örnekler harekette sık gelir, duruşlar
 * ortalamaya girmez → şişer). Hız kanıtı yoksa ya da süre çok kısaysa
 * BİLİNMİYOR (`null`) — 0 uydurulmaz.
 */
export const AVG_SPEED_MIN_TIME_MS = 60_000;

export function averageSpeedKmh(distanceM: number, drivingMs: number, hasSpeedEvidence: boolean): number | null {
  if (!hasSpeedEvidence) return null;
  if (!Number.isFinite(distanceM) || !Number.isFinite(drivingMs)) return null;
  if (distanceM < 0 || drivingMs < AVG_SPEED_MIN_TIME_MS) return null;
  return Math.round((distanceM / 1000) / (drivingMs / 3_600_000));
}

/**
 * Oturumu `monoNow` anına göre yansıt.
 *
 * NEDEN AYRI BİR ADIM: süren mola ve geçen süre ZAMANLA büyür. Bunu ilerletme
 * adımında biriktirmek periyodik bir tick (yeni timer) gerektirirdi; burada
 * OKUMA ANINDA türetilir → **yeni zamanlayıcı kurulmaz**.
 */
export function projectTripSession(
  session: TripSession,
  monoNow: number,
): TripSessionProjection {
  const empty: TripSessionProjection = {
    sessionId: null, state: 'NOT_STARTED', startWallMs: null,
    elapsedMs: 0, movingMs: 0, stoppedMs: 0, unknownMs: 0, distanceMeters: 0,
    startLocation: null, currentLocation: null, stopPeriods: [],
    segmentCount: 0, currentBreakMs: 0, breakExceededSession: false,
    kind: 'DRIVE_LOG', completion: 'OPEN', routeActive: false,
    journeyCompleted: false,
    gpsDistanceMeters: 0, obdDistanceMeters: 0,
    maximumSpeedKmh: null, averageSpeedKmh: null,
    stopCount: 0, harshBrakeCount: 0, harshAccelCount: 0,
    maxRpm: null, maxEngineTempC: null, fuelUsedPct: null,
    segmentSealedCount: 0,
    priceUnit: null, priceCurrency: null, priceSource: null,
  };
  if (!session || session.startMonoMs === null) return empty;
  if (!_finite(monoNow)) return empty;

  const cur = session.currentSegment;
  const movingMs  = session.sealedMovingMs  + (cur ? cur.movingMs  : 0);
  const idleMs    = session.sealedIdleMs    + (cur ? cur.idleMs    : 0);
  const unknownMs = session.sealedUnknownMs + (cur ? cur.unknownMs : 0);
  const distanceM = session.sealedDistanceM + (cur ? cur.distanceM : 0);

  /* ── OTURUM TOPLAMLARI: mühürlenmiş + SÜREN segment ───────────────────
     Süren segment kümülatif geldiği için burada da BİRİKTİRİLMEZ, yalnız
     mühürlenmiş toplamın üstüne EKLENİR (çifte sayım yapısal olarak yok). */
  const gpsM   = session.sealedGpsDistanceM + (cur ? _ms(cur.gpsDistanceM) : 0);
  const obdM   = session.sealedObdDistanceM + (cur ? _ms(cur.obdDistanceM) : 0);
  const peakKmh = Math.max(session.sealedMaxSpeedKmh, cur ? _ms(cur.maxSpeedKmh) : 0);
  const spdCnt = session.sealedSpeedCount + (cur ? _ms(cur.speedCount) : 0);
  const stops  = session.sealedStopCount  + (cur ? _ms(cur.stopCount)  : 0);
  const brake  = session.sealedHarshBrakeCount + (cur ? _ms(cur.harshBrakeCount) : 0);
  const accel  = session.sealedHarshAccelCount + (cur ? _ms(cur.harshAccelCount) : 0);
  const rpm    = _peak(session.sealedMaxRpm, cur ? cur.maxRpm : null);
  const tempC  = _peak(session.sealedMaxEngineTempC, cur ? cur.maxEngineTempC : null);

  /* Yakıt: süren segment de ölçülebilmiş OLMALI, yoksa toplam eksiktir. */
  const curFuelOk = cur === null || _finite(cur.fuelUsedPct);
  const fuelUsedPct = session.sealedFuelComplete && curFuelOk
    ? Math.round((session.sealedFuelPct
        + (cur && _finite(cur.fuelUsedPct) ? (cur.fuelUsedPct as number) : 0)) * 10) / 10
    : null;

  /* Süren mola okuma anına kadar uzar (mühürlenmiş molalar zaten toplamda). */
  const currentBreakMs = session.breakSinceMonoMs === null
    ? 0
    : Math.max(0, monoNow - session.breakSinceMonoMs);

  /* Geçen süre saatten DEĞİL monotonik farktan gelir (saat sıçraması güvenli). */
  const elapsedMs = Math.max(0, monoNow - session.startMonoMs);

  const periods = session.breakSinceMonoMs === null
    ? session.stopPeriods
    : session.stopPeriods.map((p, i) =>
        i === session.stopPeriods.length - 1 && p.endedMonoMs === null
          ? { startedMonoMs: p.startedMonoMs, endedMonoMs: null, durationMs: currentBreakMs }
          : p,
      );

  return {
    sessionId:      session.sessionId,
    state:          session.state,
    startWallMs:    session.startWallMs,
    elapsedMs,
    movingMs,
    /* Mola = segment içi rölanti + segmentler arası boşluk. Bilinmeyen süre
       BURAYA GİRMEZ — ölçülemeyeni "mola" saymak uydurma olurdu. */
    stoppedMs:      idleMs + session.sealedBreakMs + currentBreakMs,
    unknownMs,
    distanceMeters: distanceM,
    startLocation:  session.startLocation,
    currentLocation: session.currentLocation,
    stopPeriods:    periods,
    segmentCount:   session.segmentCount,
    currentBreakMs,
    /* Rota aktifken eşik İŞLEMEZ: bir sonraki hareket yeni oturum AÇMAZ,
       dolayısıyla "bu seyahat fiilen bitti" de denemez. */
    breakExceededSession: !session.routeActive
      && currentBreakMs >= SESSION_MAX_BREAK_MS,
    kind:             session.kind,
    completion:       session.completion,
    routeActive:      session.routeActive,
    journeyCompleted: session.completion === 'DESTINATION_REACHED',
    gpsDistanceMeters: gpsM,
    obdDistanceMeters: obdM,
    /* Hiç hız örneği gelmediyse tepe/ortalama BİLİNMİYOR — 0 DEĞİL. */
    maximumSpeedKmh:  spdCnt > 0 || peakKmh > 0 ? peakKmh : null,
    /* Yol / sürüş süresi (park molaları hariç) — örnek ortalaması şişiyordu (bkz. averageSpeed). */
    averageSpeedKmh:  averageSpeedKmh(distanceM, elapsedMs - session.sealedBreakMs - currentBreakMs, spdCnt > 0),
    stopCount:        stops,
    harshBrakeCount:  brake,
    harshAccelCount:  accel,
    maxRpm:           rpm,
    maxEngineTempC:   tempC,
    fuelUsedPct,
    segmentSealedCount: session.segmentCount - (cur ? 1 : 0),
    priceUnit:     cur && _finite(cur.priceUnit) ? (cur.priceUnit as number) : session.lastPriceUnit,
    priceCurrency: (cur ? cur.priceCurrency : null) ?? session.lastPriceCurrency,
    priceSource:   (cur ? cur.priceSource : null) ?? session.lastPriceSource,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * KALICILIK (SAF) — süreç ölümünden sonra AYNI oturumu sürdürmek
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── NEDEN MONOTONİK ZAMAN PERSIST EDİLEMEZ ───────────────────────────────
 * Oturumun bütün zamanları `performance.now()` tabanlıdır ve bu saat HER
 * SÜREÇTE SIFIRDAN başlar. Ham hâliyle yazılan bir `startMonoMs` yeniden
 * açılışta "yolculuk 9 saat önce başladı" gibi uydurma sonuçlar verirdi.
 * Bu yüzden yazarken duvar saatine çevrilir, okurken YENİ monotonik tabana
 * geri çevrilir — `tripLogService`in `startWallMs` hesabıyla aynı yöntem.
 *
 * ── NE PERSIST EDİLMEZ ───────────────────────────────────────────────────
 * Dinleyici · timer · callback · süren segment · canlı rota durumu. Süren
 * segment KASITLI olarak mühürlenir: yeniden açılışta `tripLogService`in
 * aktif yolculuğu YOKTUR, dolayısıyla yeniden başlatma bir MOLADIR.
 * `routeActive` de yazılmaz — canlı rota/rehberlik iddiası YALNIZ navigasyon
 * otoritesinden gelir, kalıcı kayıttan diriltilemez.
 */

/** Kalıcı biçim sürümü — alan anlamı değişirse ARTIRILMALIDIR. */
export const TRIP_SESSION_PERSIST_VERSION = 1;

/**
 * Kalıcı kaydın azami yaşı.
 *
 * `nav_crash_state` ile AYNI pencere (4 saat): iki kayıt aynı yeniden
 * açılışı anlatır, farklı yaşlarda geçerli olmaları tutarsızlık olurdu.
 * Daha eskisi bir sonraki günün sürüşüne karışır.
 */
export const TRIP_SESSION_PERSIST_MAX_AGE_MS = 4 * 60 * 60_000;

/** Saat ileri kaymasına tolerans — bundan fazlası "gelecekten kayıt"tır. */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

export interface PersistedStopPeriod {
  readonly startedWallMs: number;
  readonly endedWallMs: number | null;
  readonly durationMs: number;
}

/** Diske yazılan TEK biçim. Runtime nesnesinin tamamı DEĞİLDİR. */
export interface PersistedTripSession {
  readonly v: number;
  /** Hangi araca ait — başka araçta restore EDİLMEZ. */
  readonly vehicleId: string | null;
  readonly savedAtWallMs: number;
  readonly sessionId: string;
  readonly startWallMs: number;
  readonly kind: TripSessionKind;
  readonly segmentCount: number;
  readonly sealedMovingMs: number;
  readonly sealedIdleMs: number;
  readonly sealedUnknownMs: number;
  readonly sealedBreakMs: number;
  readonly sealedDistanceM: number;
  readonly sealedGpsDistanceM: number;
  readonly sealedObdDistanceM: number;
  readonly sealedMaxSpeedKmh: number;
  readonly sealedSpeedSum: number;
  readonly sealedSpeedCount: number;
  readonly sealedStopCount: number;
  readonly sealedHarshBrakeCount: number;
  readonly sealedHarshAccelCount: number;
  readonly sealedMaxRpm: number | null;
  readonly sealedMaxEngineTempC: number | null;
  readonly sealedFuelPct: number;
  readonly sealedFuelComplete: boolean;
  /** Süren molanın başlangıcı (duvar saati); mola yoksa son güncelleme anı. */
  readonly breakSinceWallMs: number;
  readonly stopPeriods: readonly PersistedStopPeriod[];
  readonly startLocation: TripPoint | null;
  readonly currentLocation: TripPoint | null;
}

/** Monotonik an → duvar saati (yazma anındaki iki saatin farkıyla). */
function _toWall(monoMs: number, nowMonoMs: number, nowWallMs: number): number {
  return Math.round(nowWallMs - (nowMonoMs - monoMs));
}

/** Duvar saati → YENİ sürecin monotonik tabanı. */
function _toMono(wallMs: number, nowMonoMs: number, nowWallMs: number): number {
  return nowMonoMs - (nowWallMs - wallMs);
}

/**
 * Oturumu kalıcı biçime çevir.
 *
 * SÜREN SEGMENT MÜHÜRLENİR: yeniden açılışta o yolculuk artık yoktur; onu
 * "açık" yazmak, var olmayan bir ölçümü diriltmek olurdu.
 *
 * `null` döner (YAZMA YOK) şu hâllerde: oturum hiç açılmadı ya da hedefe
 * VARILDI — tamamlanmış bir yolculuk sürdürülmez, yeni sürüş yeni yolculuktur.
 */
export function serializeTripSession(
  session: TripSession,
  nowMonoMs: number,
  nowWallMs: number,
  vehicleId: string | null,
): PersistedTripSession | null {
  if (!session || session.startMonoMs === null || session.sessionId === null) return null;
  if (session.completion === 'DESTINATION_REACHED') return null;
  if (!_finite(nowMonoMs) || !_finite(nowWallMs)) return null;

  const sealed = _seal(session);
  const breakSince = session.breakSinceMonoMs ?? session.lastUpdateMonoMs ?? nowMonoMs;

  return {
    v: TRIP_SESSION_PERSIST_VERSION,
    vehicleId,
    savedAtWallMs: Math.round(nowWallMs),
    sessionId:   session.sessionId,
    startWallMs: session.startWallMs ?? _toWall(session.startMonoMs, nowMonoMs, nowWallMs),
    kind:        session.kind,
    segmentCount: session.segmentCount,
    sealedMovingMs:  sealed.sealedMovingMs,
    sealedIdleMs:    sealed.sealedIdleMs,
    sealedUnknownMs: sealed.sealedUnknownMs,
    sealedBreakMs:   sealed.sealedBreakMs,
    sealedDistanceM: sealed.sealedDistanceM,
    sealedGpsDistanceM: sealed.sealedGpsDistanceM,
    sealedObdDistanceM: sealed.sealedObdDistanceM,
    sealedMaxSpeedKmh:  sealed.sealedMaxSpeedKmh,
    sealedSpeedSum:     sealed.sealedSpeedSum,
    sealedSpeedCount:   sealed.sealedSpeedCount,
    sealedStopCount:    sealed.sealedStopCount,
    sealedHarshBrakeCount: sealed.sealedHarshBrakeCount,
    sealedHarshAccelCount: sealed.sealedHarshAccelCount,
    sealedMaxRpm:          sealed.sealedMaxRpm,
    sealedMaxEngineTempC:  sealed.sealedMaxEngineTempC,
    sealedFuelPct:         sealed.sealedFuelPct,
    sealedFuelComplete:    sealed.sealedFuelComplete,
    breakSinceWallMs: _toWall(breakSince, nowMonoMs, nowWallMs),
    stopPeriods: session.stopPeriods.map((p) => ({
      startedWallMs: _toWall(p.startedMonoMs, nowMonoMs, nowWallMs),
      endedWallMs: p.endedMonoMs === null ? null : _toWall(p.endedMonoMs, nowMonoMs, nowWallMs),
      durationMs: p.durationMs,
    })),
    startLocation:   session.startLocation,
    currentLocation: session.currentLocation,
  };
}

/** Reddetme gerekçesi — sessiz düşüş yok, gözlemlenebilir hüküm. */
export type SessionRestoreRejection =
  | 'NO_RECORD' | 'BAD_SHAPE' | 'VERSION_MISMATCH' | 'VEHICLE_MISMATCH'
  | 'FUTURE_TIMESTAMP' | 'STALE' | 'IMPOSSIBLE_STATE';

export type SessionRestoreResult =
  | { readonly restored: true; readonly session: TripSession }
  | { readonly restored: false; readonly reason: SessionRestoreRejection };

function _nonNeg(v: unknown): number {
  return _finite(v) && v >= 0 ? v : -1;
}

/**
 * Kalıcı kaydı oturuma çevir — FAIL-CLOSED.
 *
 * Reddedilen kayıt hiçbir şey ÜRETMEZ: çağıran temiz bir kayıt durumuna
 * geçer. Reddetmek "yolculuk tamamlandı" DEMEK DEĞİLDİR — tamamlanma yalnız
 * mühürlenmiş varıştan gelir ve reddedilen kayıt öyle bir mühür taşımaz
 * (tamamlanmış oturum zaten yazılmaz).
 *
 * VARIŞ TABANI SIFIRLANIR: varış mührü sayacı da süreçle birlikte sıfırdan
 * başlar; eski bir mühür sırasını taşımak, yeniden açılıştan SONRAKİ ilk
 * varışı görmezden gelmek olurdu.
 */
export function deserializeTripSession(
  raw: unknown,
  nowMonoMs: number,
  nowWallMs: number,
  vehicleId: string | null,
  maxAgeMs: number = TRIP_SESSION_PERSIST_MAX_AGE_MS,
): SessionRestoreResult {
  if (raw === null || raw === undefined) return { restored: false, reason: 'NO_RECORD' };
  if (typeof raw !== 'object') return { restored: false, reason: 'BAD_SHAPE' };
  const p = raw as Record<string, unknown>;

  if (p['v'] !== TRIP_SESSION_PERSIST_VERSION) {
    return { restored: false, reason: 'VERSION_MISMATCH' };
  }
  if (typeof p['sessionId'] !== 'string' || p['sessionId'].length === 0) {
    return { restored: false, reason: 'BAD_SHAPE' };
  }
  if (p['kind'] !== 'JOURNEY' && p['kind'] !== 'DRIVE_LOG') {
    return { restored: false, reason: 'BAD_SHAPE' };
  }
  /* ARAÇ İZOLASYONU: A aracının açık yolculuğu B aracına TAŞINMAZ. */
  const savedVehicle = typeof p['vehicleId'] === 'string' ? p['vehicleId'] : null;
  if (savedVehicle !== (typeof vehicleId === 'string' ? vehicleId : null)) {
    return { restored: false, reason: 'VEHICLE_MISMATCH' };
  }

  const savedAt = _nonNeg(p['savedAtWallMs']);
  const startWall = _nonNeg(p['startWallMs']);
  if (savedAt < 0 || startWall < 0) return { restored: false, reason: 'BAD_SHAPE' };
  if (savedAt > nowWallMs + CLOCK_SKEW_TOLERANCE_MS) {
    return { restored: false, reason: 'FUTURE_TIMESTAMP' };
  }
  if (nowWallMs - savedAt > maxAgeMs) return { restored: false, reason: 'STALE' };
  /* Yolculuk kaydedilmeden ÖNCE başlamış olmalı. */
  if (startWall > savedAt + CLOCK_SKEW_TOLERANCE_MS) {
    return { restored: false, reason: 'IMPOSSIBLE_STATE' };
  }

  const movingMs   = _nonNeg(p['sealedMovingMs']);
  const idleMs     = _nonNeg(p['sealedIdleMs']);
  const unknownMs  = _nonNeg(p['sealedUnknownMs']);
  const breakMs    = _nonNeg(p['sealedBreakMs']);
  const distanceM  = _nonNeg(p['sealedDistanceM']);
  const segCount   = _nonNeg(p['segmentCount']);
  if ([movingMs, idleMs, unknownMs, breakMs, distanceM, segCount].some((n) => n < 0)) {
    return { restored: false, reason: 'BAD_SHAPE' };
  }
  /* Hareket süresi yolculuğun kendisinden UZUN olamaz. */
  if (movingMs > (savedAt - startWall) + CLOCK_SKEW_TOLERANCE_MS) {
    return { restored: false, reason: 'IMPOSSIBLE_STATE' };
  }

  const breakSinceWall = _nonNeg(p['breakSinceWallMs']);
  const periodsRaw = Array.isArray(p['stopPeriods']) ? p['stopPeriods'] : [];
  const stopPeriods: TripStopPeriod[] = [];
  for (const item of periodsRaw.slice(-MAX_STOP_PERIODS)) {
    if (item === null || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    const st = _nonNeg(q['startedWallMs']);
    if (st < 0) continue;
    stopPeriods.push({
      startedMonoMs: _toMono(st, nowMonoMs, nowWallMs),
      endedMonoMs: _finite(q['endedWallMs'])
        ? _toMono(q['endedWallMs'] as number, nowMonoMs, nowWallMs) : null,
      durationMs: _ms(q['durationMs']),
    });
  }

  /* YENİDEN BAŞLATMA BİR MOLADIR — ve her mola `stopPeriods`'ta görünür.
     Süreç segment SÜRERKEN öldüyse kayıtta açık mola yoktur (mola serialize
     anında başladı); burada açılır ki bir sonraki hareket onu kapatıp
     sayabilsin. Kayıt zaten mola içindeyken yazıldıysa açık mola vardır,
     ikinci kez EKLENMEZ. */
  const breakSinceMono = _toMono(breakSinceWall >= 0 ? breakSinceWall : savedAt, nowMonoMs, nowWallMs);
  const last = stopPeriods[stopPeriods.length - 1];
  if (last === undefined || last.endedMonoMs !== null) {
    if (stopPeriods.length >= MAX_STOP_PERIODS) stopPeriods.shift();
    stopPeriods.push({ startedMonoMs: breakSinceMono, endedMonoMs: null, durationMs: 0 });
  }

  const startPt = p['startLocation'] as { lat?: unknown; lon?: unknown } | null;
  const curPt = p['currentLocation'] as { lat?: unknown; lon?: unknown } | null;

  const base = emptyTripSession();
  const session: TripSession = {
    ...base,
    kind:       p['kind'],
    completion: 'OPEN',
    /* Canlı rota iddiası kalıcı kayıttan DİRİLTİLMEZ — ilk örnekte
       navigasyon otoritesinden tazelenir. */
    routeActive: false,
    /* Yeni süreçte varış sayacı da sıfırdan başlar (bkz. yukarıdaki not). */
    arrivalSeqAtOpen: 0,
    sessionId:   p['sessionId'],
    startWallMs: startWall,
    startMonoMs: _toMono(startWall, nowMonoMs, nowWallMs),
    lastMotionMonoMs: _toMono(savedAt, nowMonoMs, nowWallMs),
    /* Yeniden başlatma bir MOLADIR: süren segment yoktur. */
    state: 'STOPPED',
    sealedMovingMs:  movingMs,
    sealedIdleMs:    idleMs,
    sealedUnknownMs: unknownMs,
    sealedBreakMs:   breakMs,
    sealedDistanceM: distanceM,
    sealedGpsDistanceM: _ms(p['sealedGpsDistanceM']),
    sealedObdDistanceM: _ms(p['sealedObdDistanceM']),
    sealedMaxSpeedKmh:  _ms(p['sealedMaxSpeedKmh']),
    sealedSpeedSum:     _ms(p['sealedSpeedSum']),
    sealedSpeedCount:   _ms(p['sealedSpeedCount']),
    sealedStopCount:    _ms(p['sealedStopCount']),
    sealedHarshBrakeCount: _ms(p['sealedHarshBrakeCount']),
    sealedHarshAccelCount: _ms(p['sealedHarshAccelCount']),
    sealedMaxRpm:         _finite(p['sealedMaxRpm']) ? (p['sealedMaxRpm'] as number) : null,
    sealedMaxEngineTempC: _finite(p['sealedMaxEngineTempC'])
      ? (p['sealedMaxEngineTempC'] as number) : null,
    sealedFuelPct:      _ms(p['sealedFuelPct']),
    sealedFuelComplete: p['sealedFuelComplete'] === true,
    currentSegment: null,
    breakSinceMonoMs: breakSinceMono,
    stopPeriods,
    startLocation:   _point(startPt?.lat, startPt?.lon),
    currentLocation: _point(curPt?.lat, curPt?.lon),
    lastUpdateMonoMs: _toMono(savedAt, nowMonoMs, nowWallMs),
    segmentCount: segCount,
  };
  return { restored: true, session };
}
