/**
 * predictionEngine — Trend Öngörüsü (OBD-OS-F4-3). Anayasanın 6. kapısı: "5 dk sonra ne olacak?"
 *
 * NEDEN: eşiği AŞTIKTAN sonra uyarmak, uyarmak değil RAPOR ETMEKTİR. Motor 96°C'ye çıkınca
 * "aşırı ısınma" demek geç kalmaktır — sürücü rampada, klima açık, sıcaklık 4 dakikadır
 * düzenli tırmanıyorsa bunu ÖNCEDEN söylemek gerekir. Tesla kendi aracını bilir; biz
 * bilmediğimiz araçta TRENDDEN öğreniriz.
 *
 * YÖNTEM: basit doğrusal regresyon (en küçük kareler) — kasıtlı olarak BASİT. Neden:
 *  - Cold-path'te çalışır (Mali-400 bütçesi: birkaç aritmetik işlem, tahsis yok).
 *  - Açıklanabilir: "son 60 sn'de dakikada +2.1°C" → kullanıcıya GEREKÇE gösterilebilir.
 *  - Karmaşık model (Kalman/ML) burada YANLIŞ olurdu: veri gürültülü, örneklem küçük,
 *    ve yanlış-pozitif bir "overheat" uyarısı, hiç uyarmamaktan daha zararlıdır.
 *
 * ZERO-TRUST / FAIL-CLOSED:
 *  - Yetersiz örneklem → tahmin YOK (uydurma trend üretmeyiz).
 *  - Zayıf uyum (R² düşük) → tahmin YOK (gürültüyü trend sanmayız).
 *  - Yalnız DECISION-GRADE sinyaller beslenir (F4-2: suspect/stale/no_data karar veremez).
 *
 * SAF: modül-durumu yok, I/O yok, zaman enjekte edilir — tam test edilebilir.
 */

export interface TrendSample {
  /** Ölçüm zamanı (Unix ms). */
  t: number;
  value: number;
}

export interface TrendFit {
  /** Değişim hızı — birim/dakika (pozitif = yükseliyor). */
  slopePerMin: number;
  /** Uyum kalitesi 0..1 (R²). Düşükse trend YOK sayılır (gürültü). */
  fitQuality: number;
  /** Kullanılan örneklem sayısı. */
  samples: number;
}

/** Trend için gereken minimum örneklem — altında tahmin ÜRETİLMEZ. */
export const MIN_TREND_SAMPLES = 5;
/** Bu R²'nin altındaki uyum "gürültü" sayılır — trend ÜRETİLMEZ. */
export const MIN_FIT_QUALITY = 0.6;

/**
 * En küçük kareler doğrusal uyum. Yetersiz/dejenere örneklemde null (uydurma trend yok).
 */
export function fitTrend(samples: TrendSample[]): TrendFit | null {
  if (samples.length < MIN_TREND_SAMPLES) return null;

  const n = samples.length;
  const t0 = samples[0]!.t;
  // Zamanı DAKİKAYA çevir (slope birimi doğrudan birim/dk olsun — okunabilirlik).
  const xs = samples.map((s) => (s.t - t0) / 60_000);
  const ys = samples.map((s) => s.value);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  if (sxx === 0) return null;   // tüm örnekler aynı anda → eğim tanımsız

  const slope = sxy / sxx;
  // R²: değişimin ne kadarını doğru açıklıyor. syy=0 → değer hiç değişmemiş: eğim 0,
  // uyum MÜKEMMEL (düz çizgi) — bu bir trend YOKLUĞUDUR, gürültü değil.
  const r2 = syy === 0 ? 1 : Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy)));

  return { slopePerMin: slope, fitQuality: r2, samples: n };
}

export type PredictionKind = 'overheat' | 'battery_drain' | 'oil_pressure_drop';

export interface Prediction {
  kind: PredictionKind;
  severity: 'critical' | 'warning';
  /** Eşiğe tahmini varış süresi (dakika). */
  minutesToThreshold: number;
  title: string;
  /** GEREKÇE — ölçülen trend (kullanıcı körü körüne inanmasın). */
  reason: string;
  /** Tahminin güveni = uyum kalitesi (R²) — sabit DEĞİL. */
  confidence: number;
}

export interface PredictionRule {
  kind: PredictionKind;
  severity: 'critical' | 'warning';
  /** Kritik eşik (bu değere ulaşırsa sorun var). */
  threshold: number;
  /** Eşiğe bu süreden erken varılacaksa uyar (dakika). */
  horizonMin: number;
  /** Eşiğe YAKLAŞMA yönü: 'up' = artarak, 'down' = azalarak. */
  direction: 'up' | 'down';
  unit: string;
  title: string;
}

/**
 * Varsayılan kurallar — güvenlik-kritik ve UCUZ (anayasa: güvenlik katmanı HER tier'da açık).
 * Eşikler muhafazakâr: yanlış-pozitif uyarı, güveni yok eder.
 */
export const DEFAULT_PREDICTION_RULES: Record<PredictionKind, PredictionRule> = {
  overheat: {
    kind: 'overheat', severity: 'critical', threshold: 110, horizonMin: 10,
    direction: 'up', unit: '°C', title: 'Motor aşırı ısınma riski',
  },
  battery_drain: {
    kind: 'battery_drain', severity: 'warning', threshold: 11.8, horizonMin: 15,
    direction: 'down', unit: 'V', title: 'Akü voltajı düşüyor — marş riski',
  },
  oil_pressure_drop: {
    kind: 'oil_pressure_drop', severity: 'critical', threshold: 100, horizonMin: 10,
    direction: 'down', unit: 'kPa', title: 'Yağ basıncı düşüyor',
  },
};

/**
 * Bir sinyalin trendinden öngörü üretir.
 *
 * FAIL-CLOSED: yetersiz örneklem, zayıf uyum, yanlış yön veya ufuk dışı varış → null.
 * Yani "emin değilsek SUSARIZ" — yanlış-pozitif overheat uyarısı, güveni sıfırlar.
 */
export function predict(
  samples: TrendSample[],
  rule: PredictionRule,
  currentValue: number,
): Prediction | null {
  const fit = fitTrend(samples);
  if (!fit) return null;                                   // yetersiz örneklem → SUS
  if (fit.fitQuality < MIN_FIT_QUALITY) return null;       // gürültü → SUS

  const rising = rule.direction === 'up';
  const slope = fit.slopePerMin;

  // Eşiğe DOĞRU gitmiyorsa öngörü yok (soğuyan motor için "overheat" deme).
  if (rising && slope <= 0) return null;
  if (!rising && slope >= 0) return null;

  // Zaten eşiği aştıysak bu bir ÖNGÖRÜ değil, mevcut durumdur → başka katmanın işi.
  const alreadyBreached = rising ? currentValue >= rule.threshold : currentValue <= rule.threshold;
  if (alreadyBreached) return null;

  const delta = rule.threshold - currentValue;             // rising'de +, düşüşte −
  const minutes = delta / slope;                           // iki durumda da pozitif çıkar
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes > rule.horizonMin) return null;              // ufuk dışı → henüz uyarma

  const dir = rising ? '+' : '';
  return {
    kind: rule.kind,
    severity: rule.severity,
    minutesToThreshold: Number(minutes.toFixed(1)),
    title: rule.title,
    reason: `Son ${((samples[samples.length - 1]!.t - samples[0]!.t) / 60_000).toFixed(1)} dk trendi: `
      + `${dir}${slope.toFixed(1)} ${rule.unit}/dk → ${rule.threshold}${rule.unit} eşiğine ~${minutes.toFixed(0)} dk.`,
    confidence: Number(fit.fitQuality.toFixed(2)),
  };
}
