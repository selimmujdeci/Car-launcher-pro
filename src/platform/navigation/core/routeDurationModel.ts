/**
 * routeDurationModel.ts — rota sağlayıcısının SÜRE modeli (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · ağ YOK · React YOK · global durum YOK.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `routingService` OSRM'den **zaten** `annotations=duration` istiyordu
 * (`routingService.ts` istek URL'i) ama yanıttaki süre dizisi HİÇ ayrıştırılmıyordu.
 * Yani her rotada o veri için bant genişliği harcanıp çöpe atılıyordu; ETA ise
 * `kalanMesafe / anlıkHız` ile yeniden türetiliyordu.
 *
 * Sonuç: şehir içinden başlayıp otoyola çıkan bir rotada ETA başta çok kötümser,
 * otoyolda çok iyimser oluyor ve varış saati sürekli kayıyordu. Sorun gecikme
 * değil MODELDİ: rotanın kendi yol-sınıfı bazlı süre bilgisi kullanılmıyordu.
 *
 * Bu dosya o veriyi doğrular ve kalan süreyi O(1) okunabilir hâle getirir.
 * `cumulativeDistances` ile BİREBİR aynı deseni kullanır (suffix-sum, son eleman 0).
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 * Eksik/bozuk süre verisi KESİN ETA ÜRETMEZ. Doğrulama başarısızsa dizi
 * kurulmaz ve bütünlük durumu açıkça bildirilir; ETA modeli o zaman
 * `DEGRADED_FALLBACK`e düşer ve bunu LAB'da ilan eder.
 */

/** Süre verisinin nereden geldiği. */
export type RouteDurationSource =
  /** OSRM `annotation.duration` — segment başına gerçek süre. */
  | 'OSRM_ANNOTATION'
  /** Yalnız rota toplamı biliniyor (segment dağılımı yok). */
  | 'ROUTE_TOTAL'
  /** Düz-hat yedeği — GERÇEK ROTA SÜRESİ DEĞİLDİR. */
  | 'STRAIGHT_LINE_ESTIMATE'
  /** Süre bilgisi yok. */
  | 'NONE';

/** Süre dizisinin doğrulama sonucu. */
export type RouteDurationIntegrity =
  /** Uzunluk ve değerler doğrulandı → kesin ETA üretilebilir. */
  | 'VALID'
  /** Dizi uzunluğu geometriyle uyuşmuyor. */
  | 'LENGTH_MISMATCH'
  /** NaN / Infinity / negatif değer var. */
  | 'INVALID_VALUES'
  /** Sağlayıcı süre dizisi göndermedi. */
  | 'MISSING';

export const DURATION_SOURCE_LABEL: Readonly<Record<RouteDurationSource, string>> = {
  OSRM_ANNOTATION:       'OSRM segment süreleri',
  ROUTE_TOTAL:           'yalnız rota toplamı',
  STRAIGHT_LINE_ESTIMATE:'düz hat tahmini (rota değil)',
  NONE:                  'yok',
} as const;

export const DURATION_INTEGRITY_LABEL: Readonly<Record<RouteDurationIntegrity, string>> = {
  VALID:           'DOĞRULANDI',
  LENGTH_MISMATCH: 'UZUNLUK UYUŞMUYOR',
  INVALID_VALUES:  'GEÇERSİZ DEĞER',
  MISSING:         'YOK',
} as const;

export interface ParsedRouteDurations {
  /** Segment başına süre (sn). `null` = doğrulama düştü. Uzunluk = nokta sayısı − 1. */
  readonly segmentDurations: Float64Array | null;
  /** Noktadan sona kalan süre (sn). `null` = doğrulama düştü. Uzunluk = nokta sayısı. */
  readonly cumulativeDurations: Float64Array | null;
  readonly integrity: RouteDurationIntegrity;
  readonly source: RouteDurationSource;
  /** Segment sürelerinin toplamı (sn) — sağlayıcının `route.duration`'ı ile karşılaştırılır. */
  readonly sumSeconds: number | null;
}

const _FAILED = (integrity: RouteDurationIntegrity): ParsedRouteDurations => ({
  segmentDurations: null, cumulativeDurations: null,
  integrity, source: integrity === 'MISSING' ? 'NONE' : 'ROUTE_TOTAL', sumSeconds: null,
});

/** Bir segment süresi bu değeri aşarsa veri bozuk sayılır (24 saat). */
const MAX_SEGMENT_SECONDS = 86_400;

/**
 * Ham OSRM `annotation.duration` dizisini doğrular ve suffix-sum kurar.
 *
 * @param raw            Sağlayıcının segment süreleri (sn). Uzunluk = nokta sayısı − 1.
 * @param geometryPoints Rota geometrisindeki NOKTA sayısı (segment değil).
 *
 * Doğrulama fail-closed'dur: tek bir bozuk değer bile diziyi TÜMDEN reddeder —
 * yarı doğru bir süre modeliyle "kesin" ETA üretmek, hiç üretmemekten kötüdür.
 */
export function parseRouteDurations(
  raw: readonly number[] | null | undefined,
  geometryPoints: number,
): ParsedRouteDurations {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return _FAILED('MISSING');
  if (!Number.isFinite(geometryPoints) || geometryPoints < 2) return _FAILED('LENGTH_MISMATCH');
  if (raw.length !== geometryPoints - 1) return _FAILED('LENGTH_MISMATCH');

  const n = raw.length;
  const seg = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_SEGMENT_SECONDS) {
      return _FAILED('INVALID_VALUES');
    }
    seg[i] = v;
    sum += v;
  }

  // Suffix-sum: cum[i] = i. noktadan rotanın SONUNA kalan süre. cum[n] === 0.
  const cum = new Float64Array(n + 1);
  cum[n] = 0;
  for (let i = n - 1; i >= 0; i--) cum[i] = cum[i + 1] + seg[i];

  return {
    segmentDurations: seg,
    cumulativeDurations: cum,
    integrity: 'VALID',
    source: 'OSRM_ANNOTATION',
    sumSeconds: sum,
  };
}

/**
 * Aracın rota üzerindeki konumundan hedefe KALAN SÜRE (sn).
 *
 * Konum iki girdiden çıkar: eşleşen segment indeksi ve rota üzerinde kalan
 * mesafe. Segment içindeki kesir mesafe oranından türetilir — böylece süre
 * adım adım değil, sürekli azalır.
 *
 * `null` döner (ve ETA modeli buna göre düşer) şu hâllerde:
 *  · süre dizisi yok/doğrulanmadı · segment indeksi aralık dışı
 *  · mesafe dizisi yok · kalan mesafe geçersiz
 *
 * **Geçilen segmentlerin süresi yeniden EKLENMEZ**: hesap birikimli değil
 * MUTLAKTIR — her çağrı yalnız kalan kısmı okur.
 */
export function remainingRouteDurationS(input: {
  readonly cumulativeDurations: Float64Array | null;
  readonly segmentDurations: Float64Array | null;
  readonly cumulativeDistances: Float64Array | null;
  /** Aracın üzerinde olduğu segmentin indeksi (0 … nokta sayısı−2). */
  readonly segIdx: number | null;
  /** Rota üzerinde hedefe kalan mesafe (m). */
  readonly alongRemainingM: number | null;
}): number | null {
  const { cumulativeDurations: cumD, segmentDurations: segD,
    cumulativeDistances: cumM, segIdx, alongRemainingM } = input;

  if (!cumD || !segD || !cumM) return null;
  if (segIdx === null || !Number.isInteger(segIdx) || segIdx < 0 || segIdx >= segD.length) return null;
  if (alongRemainingM === null || !Number.isFinite(alongRemainingM) || alongRemainingM < 0) return null;
  // Mesafe ve süre dizileri AYNI geometriye ait olmalı.
  if (cumM.length !== cumD.length) return null;

  const segEndRemainM   = cumM[segIdx + 1];
  const segStartRemainM = cumM[segIdx];
  const segLenM = segStartRemainM - segEndRemainM;

  let frac: number;
  if (!(segLenM > 0)) {
    frac = 0;
  } else {
    const withinM = alongRemainingM - segEndRemainM;
    frac = withinM <= 0 ? 0 : withinM >= segLenM ? 1 : withinM / segLenM;
  }

  const remaining = cumD[segIdx + 1] + segD[segIdx] * frac;
  return Number.isFinite(remaining) && remaining >= 0 ? remaining : null;
}
