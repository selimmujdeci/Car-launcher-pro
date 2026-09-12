/**
 * tripMetricsAccumulator.ts — TRIP METRİK BİRİKİMİ (SAF).
 *
 * ── İKİNCİ OTORİTE DEĞİL ──────────────────────────────────────────────
 * Bu modül **abonelik kurmaz, timer açmaz, durum SAHİPLENMEZ**. Yalnız saf
 * fonksiyonlar sunar: `(mevcut birikim, örnek) → yeni birikim`.
 * Durumun sahibi ve tek otorite `tripLogService`'dir; o kendi GPS/OBD
 * aboneliklerinde bu fonksiyonları çağırır.
 *
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────
 * Eşik, debounce ve tazelik kuralları test edilebilir olmalı. Bunlar
 * `tripLogService` içine gömülürse gerçek OBD/GPS aboneliği olmadan
 * doğrulanamaz — ve bu kurallar (sert olay çift sayımı, reconnect spike'ı,
 * bilinmeyen sürenin idle sayılması) sessizce yanlış olmaya en yatkın yer.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · abonelik YOK · React YOK.
 * Zaman DIŞARIDAN (`perfNowMs` — monotonik) verilir.
 */

/* ── Eşikler ve kapılar ────────────────────────────────────────────────── */

/**
 * SERT MANEVRA EŞİĞİ (km/h, ardışık örnek arası mutlak delta).
 *
 * 15 km/h mevcut `tripLogService` davranışıdır ve KORUNUR — değiştirmek
 * geçmiş skorlarla kıyaslanabilirliği bozar.
 */
export const HARSH_DELTA_KMH = 15;

/**
 * SERT MANEVRA DEBOUNCE (ms).
 *
 * NEDEN GEREKLİ: GPS 5 Hz'e kadar örnek üretir. Tek bir gerçek fren
 * manevrası (≈1,5–3 s) ardışık birden çok örnekte eşiği aşar ve **aynı
 * fiziksel olay 3–5 kez sayılır**. 2 s'lik debounce bir manevrayı bir olay
 * sayar; iki gerçek ayrı manevra arasında ≥2 s geçmesi fiziksel olarak
 * beklenir (aksi halde tek sürekli manevradır).
 */
export const HARSH_DEBOUNCE_MS = 2_000;

/**
 * ÖRNEK BAYATLIK KAPISI (ms).
 *
 * Ardışık iki örnek arası bu süreyi aşarsa aradaki zaman **`unknown`**
 * sayılır ve delta'dan olay ÜRETİLMEZ. Sebebi: 8 s susmuş bir kaynağın
 * dönüşündeki 40 km/h fark bir "sert fren" değil, **veri boşluğudur**.
 * 3 s: 2 Hz taban akışta bir kaçırılan örneğe tolerans.
 */
export const SAMPLE_STALE_MS = 3_000;

/** Hareket eşiği (km/h) — bunun üstü `moving`. */
export const MOVING_MIN_KMH = 3;
/** Duruş eşiği (km/h) — bunun altı `idle` (trip aktifken). */
export const IDLE_MAX_KMH = 1;

/**
 * DURUŞ MİNİMUM SÜRESİ (ms) — `stopCount` için.
 *
 * NEDEN: GPS jitter'ı duran araçta 0↔2 km/h salınımı üretir; her salınım
 * bir "duruş" sayılırsa şehirde 200 duruş çıkar. 5 s gerçek bir duruşun
 * (ışık/trafik) alt sınırıdır.
 */
export const STOP_MIN_MS = 5_000;

/** OBD metrik geçerlilik aralıkları — `-1` = desteklenmiyor sentinel'i. */
export const OBD_RANGES = {
  rpm: { min: 0, max: 20_000 },
  engineTempC: { min: -50, max: 250 },
  fuelPercent: { min: 0, max: 100 },
} as const;

/**
 * YAKIT İKMALİ BELİRTİSİ (yüzde puan artışı).
 *
 * Yakıt seviyesi trip içinde bu kadar ARTARSA ikmal (veya sensör sıçraması)
 * olmuştur; `fuelUsedPercent` **ÖLÇÜLMÜŞ SAYILAMAZ**.
 * 2 puan: şamandıra gürültüsü (yakıt çalkalanması) tipik olarak bunun
 * altındadır; gerçek ikmal çok daha büyüktür.
 */
export const REFUEL_RISE_PCT = 2;

/**
 * FİZİKSEL OLARAK MAKUL ÜST SINIR (yüzde puan / 100 km).
 *
 * 100 km'de deponun %60'ından fazlasının bitmesi (≈50 L/100 km, 80 L depo)
 * bir binek araçta gerçekçi değildir → sensör hatası sayılır.
 */
export const MAX_FUEL_PCT_PER_100KM = 60;

/* ── Birikim durumu ────────────────────────────────────────────────────── */

/** Ölçüm kaynağı sınıfı — kanonik modeldeki `MetricSource` ile AYNI sözleşme. */
export type SampleSource = 'GPS' | 'OBD';

/**
 * Trip boyunca biriken ölçümler.
 *
 * TÜM alanlar `null` başlar: **hiç ölçülmemiş metrik `0` DEĞİLDİR.**
 * Şablon nesne — tüm anahtarlar baştan tanımlı (V8 hidden-class kararlılığı).
 */
export interface TripMetricsAccumulator {
  /* ── Süre sınıflandırması (ms) ── */
  readonly movingMs: number;
  readonly idleMs: number;
  readonly unknownMs: number;
  /** Son sınıflandırma anı (monotonik). */
  readonly lastClassPerfMs: number | null;

  /* ── Duruş ── */
  readonly stopCount: number;
  /** İçinde bulunulan duruşun başlangıcı; hareket halindeyse `null`. */
  readonly stopSincePerfMs: number | null;
  /** Bu duruş zaten sayıldı mı (aynı duruş iki kez sayılmasın). */
  readonly currentStopCounted: boolean;

  /* ── OBD tepe değerleri (yalnız TAZE veriden) ── */
  readonly maxRpm: number | null;
  readonly maxEngineTempC: number | null;

  /* ── Yakıt ── */
  readonly fuelAtStartPct: number | null;
  readonly fuelAtEndPct: number | null;
  /** Yakıt ikmali/sıçraması gözlendi mi — `true` ise ÖLÇÜM geçersiz. */
  readonly refuelSuspected: boolean;
  /** OBD bağlantısı trip içinde koptu mu — yakıt sürekliliği kırılır. */
  readonly obdContinuityBroken: boolean;

  /* ── Sert manevralar ── */
  readonly harshBrakeCount: number;
  readonly harshAccelCount: number;
  /** Son sayılan olayın anı — debounce çapası. */
  readonly lastHarshPerfMs: number | null;

  /* ── Kapsama ve kalite kanıtı ── */
  readonly speedSampleCount: number;
  readonly obdSampleCount: number;
  readonly gpsSampleCount: number;
  /** Bayat kapısını aşan boşluk sayısı. */
  readonly dataGapCount: number;
  readonly totalGapMs: number;
  /** GPS ↔ OBD arası kaynak değişimi sayısı. */
  readonly sourceSwitchCount: number;
  readonly lastSource: SampleSource | null;
  /** Son geçerli hız örneği (delta hesabı için). */
  readonly lastSpeedKmh: number | null;
  readonly lastSpeedPerfMs: number | null;
}

export function createAccumulator(): TripMetricsAccumulator {
  return {
    movingMs: 0, idleMs: 0, unknownMs: 0, lastClassPerfMs: null,
    stopCount: 0, stopSincePerfMs: null, currentStopCounted: false,
    maxRpm: null, maxEngineTempC: null,
    fuelAtStartPct: null, fuelAtEndPct: null,
    refuelSuspected: false, obdContinuityBroken: false,
    harshBrakeCount: 0, harshAccelCount: 0, lastHarshPerfMs: null,
    speedSampleCount: 0, obdSampleCount: 0, gpsSampleCount: 0,
    dataGapCount: 0, totalGapMs: 0,
    sourceSwitchCount: 0, lastSource: null,
    lastSpeedKmh: null, lastSpeedPerfMs: null,
  };
}

/* ── Örnek girdisi ─────────────────────────────────────────────────────── */

export interface MetricSample {
  /** Monotonik zaman (`performance.now()`) — saat atlamalarına bağışık. */
  readonly perfNowMs: number;
  readonly source: SampleSource;
  /** km/h; bilinmiyorsa `null`. */
  readonly speedKmh: number | null;
  /** OBD verisi TAZE mi (`OBDData.dataFresh`). GPS örneklerinde `true`. */
  readonly fresh: boolean;
  /* Yalnız OBD örneklerinde anlamlı; `-1` desteklenmiyor demektir. */
  readonly rpm?: number | null;
  readonly engineTempC?: number | null;
  readonly fuelPercent?: number | null;
  /** OBD taşıma bağlantısı canlı mı (`OBDData.transportConnected`). */
  readonly transportConnected?: boolean;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

/** `-1` sentinel'i ve aralık dışı değer → `null` (0 DEĞİL). */
function obdValue(raw: unknown, key: keyof typeof OBD_RANGES): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < 0 && key !== 'engineTempC') return null;       // -1 sentinel
  if (raw === -1) return null;                              // temp için de sentinel
  const r = OBD_RANGES[key];
  return raw >= r.min && raw <= r.max ? raw : null;
}

/* ── Ana birikim ───────────────────────────────────────────────────────── */

/**
 * Bir örneği birikime uygular.
 *
 * ── SIRA ÖNEMLİ ──
 *  1. Boşluk tespiti (bayat kapısı) — sonraki adımların GÜVENİ buna bağlı
 *  2. Süre sınıflandırması (moving / idle / unknown)
 *  3. Duruş sayımı (debounce'lu)
 *  4. Sert manevra (yalnız TAZE + ARDIŞIK örnekten, debounce'lu)
 *  5. OBD tepe değerleri (yalnız taze + geçerli)
 *  6. Yakıt izleme (ikmal/süreklilik tespiti)
 */
export function applySample(
  acc: TripMetricsAccumulator,
  s: MetricSample,
): TripMetricsAccumulator {
  const now = s.perfNowMs;
  if (!Number.isFinite(now)) return acc;

  let out: TripMetricsAccumulator = acc;

  /* ── 1. BOŞLUK TESPİTİ ────────────────────────────────────────────── */
  const prevClassAt = acc.lastClassPerfMs;
  const gapMs = prevClassAt === null ? 0 : Math.max(0, now - prevClassAt);
  const isGap = gapMs > SAMPLE_STALE_MS;
  /* Örneğin KENDİSİ bayatsa (OBD `dataFresh=false`) da boşluk sayılır. */
  const staleSample = s.fresh === false;

  /* ── 2. SÜRE SINIFLANDIRMASI ─────────────────────────────────────── */
  if (prevClassAt !== null && gapMs > 0) {
    if (isGap || staleSample) {
      /* BİLİNMEYEN süre IDLE SAYILMAZ — ayrı kovaya gider. */
      out = {
        ...out,
        unknownMs: out.unknownMs + gapMs,
        dataGapCount: isGap ? out.dataGapCount + 1 : out.dataGapCount,
        totalGapMs: isGap ? out.totalGapMs + gapMs : out.totalGapMs,
      };
    } else if (acc.lastSpeedKmh !== null && acc.lastSpeedKmh >= MOVING_MIN_KMH) {
      out = { ...out, movingMs: out.movingMs + gapMs };
    } else if (acc.lastSpeedKmh !== null && acc.lastSpeedKmh <= IDLE_MAX_KMH) {
      out = { ...out, idleMs: out.idleMs + gapMs };
    } else {
      /* Eşikler ARASI (1–3 km/h) veya hız bilinmiyor → bilinmeyen.
         "Muhtemelen duruyor" demek TAHMİN ÜRETMEKTİR. */
      out = { ...out, unknownMs: out.unknownMs + gapMs };
    }
  }
  out = { ...out, lastClassPerfMs: now };

  /* Bayat örnek buradan sonra ÖLÇÜM ÜRETMEZ — yalnız süre kovası aldı. */
  if (staleSample) {
    return {
      ...out,
      obdContinuityBroken: s.transportConnected === false
        ? true : out.obdContinuityBroken,
    };
  }

  const speed = typeof s.speedKmh === 'number' && Number.isFinite(s.speedKmh)
    && s.speedKmh >= 0 && s.speedKmh <= 400
      ? s.speedKmh : null;

  /* ── 3. DURUŞ SAYIMI ─────────────────────────────────────────────── */
  if (speed !== null) {
    if (speed <= IDLE_MAX_KMH) {
      if (out.stopSincePerfMs === null) {
        out = { ...out, stopSincePerfMs: now, currentStopCounted: false };
      } else if (!out.currentStopCounted && now - out.stopSincePerfMs >= STOP_MIN_MS) {
        /* Aynı duruş YALNIZ BİR KEZ sayılır (jitter salınımı sayılmaz). */
        out = { ...out, stopCount: out.stopCount + 1, currentStopCounted: true };
      }
    } else if (speed >= MOVING_MIN_KMH && out.stopSincePerfMs !== null) {
      /* Duruş bitti — çapayı temizle. */
      out = { ...out, stopSincePerfMs: null, currentStopCounted: false };
    }
  }

  /* ── 4. SERT MANEVRA ─────────────────────────────────────────────── */
  const prevSpeed = acc.lastSpeedKmh;
  const prevSpeedAt = acc.lastSpeedPerfMs;
  if (
    speed !== null &&
    prevSpeed !== null &&
    prevSpeedAt !== null &&
    /* İLK ÖRNEKTEN olay çıkarılmaz (prevSpeed null olurdu — zaten kapalı) */
    !isGap &&                                    // veri boşluğu olay DEĞİLDİR
    now - prevSpeedAt <= SAMPLE_STALE_MS &&      // ardışık örnek şartı
    s.source === acc.lastSource                  // KAYNAK DEĞİŞİMİ olay DEĞİLDİR
  ) {
    const delta = speed - prevSpeed;
    if (Math.abs(delta) > HARSH_DELTA_KMH) {
      const debounced = out.lastHarshPerfMs !== null
        && now - out.lastHarshPerfMs < HARSH_DEBOUNCE_MS;
      if (!debounced) {
        out = delta < 0
          ? { ...out, harshBrakeCount: out.harshBrakeCount + 1, lastHarshPerfMs: now }
          : { ...out, harshAccelCount: out.harshAccelCount + 1, lastHarshPerfMs: now };
      }
    }
  }

  /* ── Kaynak geçişi muhasebesi ────────────────────────────────────── */
  if (acc.lastSource !== null && acc.lastSource !== s.source) {
    out = { ...out, sourceSwitchCount: out.sourceSwitchCount + 1 };
  }

  /* ── Örnek sayaçları ─────────────────────────────────────────────── */
  out = {
    ...out,
    lastSource: s.source,
    gpsSampleCount: s.source === 'GPS' ? out.gpsSampleCount + 1 : out.gpsSampleCount,
    obdSampleCount: s.source === 'OBD' ? out.obdSampleCount + 1 : out.obdSampleCount,
  };
  if (speed !== null) {
    out = {
      ...out,
      speedSampleCount: out.speedSampleCount + 1,
      lastSpeedKmh: speed,
      lastSpeedPerfMs: now,
    };
  }

  /* ── 5. OBD TEPE DEĞERLERİ (yalnız TAZE + GEÇERLİ) ───────────────── */
  if (s.source === 'OBD') {
    const rpm = obdValue(s.rpm, 'rpm');
    if (rpm !== null) {
      out = { ...out, maxRpm: out.maxRpm === null ? rpm : Math.max(out.maxRpm, rpm) };
    }
    const temp = obdValue(s.engineTempC, 'engineTempC');
    if (temp !== null) {
      out = {
        ...out,
        maxEngineTempC: out.maxEngineTempC === null
          ? temp : Math.max(out.maxEngineTempC, temp),
      };
    }

    /* ── 6. YAKIT İZLEME ──────────────────────────────────────────── */
    const fuel = obdValue(s.fuelPercent, 'fuelPercent');
    if (fuel !== null) {
      if (out.fuelAtStartPct === null) {
        out = { ...out, fuelAtStartPct: fuel, fuelAtEndPct: fuel };
      } else {
        const prevEnd = out.fuelAtEndPct;
        /* Yakıt ARTTIYSA ikmal/sıçrama → ölçüm geçersiz. */
        if (prevEnd !== null && fuel - prevEnd >= REFUEL_RISE_PCT) {
          out = { ...out, refuelSuspected: true };
        }
        out = { ...out, fuelAtEndPct: fuel };
      }
    }

    if (s.transportConnected === false) {
      out = { ...out, obdContinuityBroken: true };
    }
  }

  return out;
}

/**
 * Trip kapanışında son süre dilimini kapatır.
 *
 * Son örnekten kapanışa kadar geçen süre sınıflandırılmamış kalır; onu
 * `unknown` saymak dürüsttür (o aralıkta ölçüm YOK). `idle` saymak
 * "duruyordu" TAHMİNİ üretmek olur.
 */
export function sealAccumulator(
  acc: TripMetricsAccumulator,
  endPerfMs: number,
): TripMetricsAccumulator {
  if (acc.lastClassPerfMs === null || !Number.isFinite(endPerfMs)) return acc;
  const tail = Math.max(0, endPerfMs - acc.lastClassPerfMs);
  if (tail === 0) return acc;
  return { ...acc, unknownMs: acc.unknownMs + tail, lastClassPerfMs: endPerfMs };
}

/* ── Yakıt ölçüm hükmü (§3) ────────────────────────────────────────────── */

export type FuelVerdict =
  | { measured: true; usedPercent: number }
  | { measured: false; reason: FuelRejectReason };

export type FuelRejectReason =
  | 'NO_START'          // başlangıç okuması yok
  | 'NO_END'            // bitiş okuması yok
  | 'REFUEL_SUSPECTED'  // trip içinde yakıt arttı
  | 'CONTINUITY_BROKEN' // OBD bağlantısı koptu
  | 'NEGATIVE_DELTA'    // bitiş > başlangıç (küçük gürültü)
  | 'IMPLAUSIBLE'       // fiziksel olarak makul değil
  | 'NO_DISTANCE';      // makullük mesafe olmadan sınanamaz

/**
 * Yakıt tüketimini YALNIZ tüm kapılar geçerse `MEASURED` sayar (§3).
 *
 * **Yüzde farkı LİTRE DEĞİLDİR** — bu fonksiyon yüzde döndürür. Litreye
 * çevirme ayrı ve `DERIVED`'dır (bkz. `fuelPercentToLitres`).
 */
export function evaluateFuelMeasurement(
  acc: TripMetricsAccumulator,
  distanceKm: number | null,
): FuelVerdict {
  if (acc.fuelAtStartPct === null) return { measured: false, reason: 'NO_START' };
  if (acc.fuelAtEndPct === null) return { measured: false, reason: 'NO_END' };
  if (acc.refuelSuspected) return { measured: false, reason: 'REFUEL_SUSPECTED' };
  if (acc.obdContinuityBroken) return { measured: false, reason: 'CONTINUITY_BROKEN' };

  const used = acc.fuelAtStartPct - acc.fuelAtEndPct;
  /* Negatif fark: küçük şamandıra gürültüsü — ölçüm sayılmaz. */
  if (used < 0) return { measured: false, reason: 'NEGATIVE_DELTA' };

  if (distanceKm === null || distanceKm <= 0) {
    return { measured: false, reason: 'NO_DISTANCE' };
  }
  const per100 = (used / distanceKm) * 100;
  if (per100 > MAX_FUEL_PCT_PER_100KM) {
    return { measured: false, reason: 'IMPLAUSIBLE' };
  }

  return { measured: true, usedPercent: Math.round(used * 10) / 10 };
}

/**
 * Yüzde → litre dönüşümü.
 *
 * **DERIVED'dır, MEASURED DEĞİL**: depo kapasitesi kullanıcı araç
 * profilinden gelir ve doğrulanmamıştır (üretici verisi değil, kullanıcı
 * girdisi). Kapasite yoksa/`0` ise `null` — uydurma litre ÜRETİLMEZ.
 */
export function fuelPercentToLitres(
  usedPercent: number,
  tankCapacityL: number | null,
): number | null {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return null;
  if (tankCapacityL === null || !Number.isFinite(tankCapacityL) || tankCapacityL <= 0) {
    return null;
  }
  /* Makul depo aralığı: 20–200 L. Dışı kullanıcı girdi hatasıdır. */
  if (tankCapacityL < 20 || tankCapacityL > 200) return null;
  return Math.round((usedPercent / 100) * tankCapacityL * 100) / 100;
}

/* ── Kapsama oranları (§9 confidence kanıtı) ──────────────────────────── */

export interface CoverageReport {
  /** Süre kapsaması: (moving+idle) / toplam sınıflandırılmış. 0–1. */
  readonly timeCoverage: number | null;
  /** OBD örneği oranı — 0 ise motor metrikleri yok. */
  readonly obdCoverage: number | null;
  readonly speedSampleCount: number;
  readonly dataGapCount: number;
  readonly sourceSwitchCount: number;
}

export function buildCoverageReport(acc: TripMetricsAccumulator): CoverageReport {
  const classified = acc.movingMs + acc.idleMs + acc.unknownMs;
  const known = acc.movingMs + acc.idleMs;
  const samples = acc.gpsSampleCount + acc.obdSampleCount;
  return {
    timeCoverage: classified > 0 ? Math.round((known / classified) * 100) / 100 : null,
    obdCoverage: samples > 0 ? Math.round((acc.obdSampleCount / samples) * 100) / 100 : null,
    speedSampleCount: acc.speedSampleCount,
    dataGapCount: acc.dataGapCount,
    sourceSwitchCount: acc.sourceSwitchCount,
  };
}
