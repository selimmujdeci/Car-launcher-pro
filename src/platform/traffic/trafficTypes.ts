/**
 * Traffic Intelligence — Canonical Type System
 *
 * Bu dosya sadece tip tanımı içerir; runtime kodu yoktur.
 * Tüm traffic alt-modülleri buradan import eder.
 *
 * Koordinat sözleşmesi:
 *   Her yerde {lat, lng} kullanılır.
 *   OSRM [lon, lat] array'leri routingService sınırında dönüştürülür,
 *   bu modül içine asla girmez.
 */

/* ── Temel koordinat ─────────────────────────────────────────── */

export interface LatLng {
  lat: number;
  lng: number;
}

/* ── Trafik yoğunluk seviyesi ────────────────────────────────── */

/**
 * trafficService.ts ile aynı değerler — backward compat sağlanır.
 * Yeni kod bu canonical tipten import eder.
 */
export type TrafficLevel = 'free' | 'moderate' | 'heavy' | 'standstill';

/* ── Veri kaynağı ────────────────────────────────────────────── */

/**
 * Trafik verisinin kökeni.
 * confidence eşiği kaynağa göre ayarlanır:
 *   live      → en güvenilir (API anlık)
 *   historical → saatlik örüntü (orta güven)
 *   learned   → kullanıcı sürüş geçmişi (düşük-orta)
 *   fallback  → hiç veri yoksa sabit tahmin (düşük)
 */
export type TrafficDataSource = 'live' | 'historical' | 'learned' | 'fallback';

/* ── Yol segmenti tanımı ─────────────────────────────────────── */

/**
 * Fiziksel bir yol segmentini temsil eder.
 * segmentId: rota koordinatlarından türetilen stabil hash —
 *   aynı yol parçası her seferinde aynı ID'yi alır.
 */
export interface RoadSegment {
  /** Segment tanımlayıcı — Haversine grid bucket hash */
  segmentId:    string;
  /** İnsan-okunabilir isim (sokak / cadde adı, opsiyonel) */
  label:        string;
  /** Segment başlangıç noktası */
  start:        LatLng;
  /** Segment bitiş noktası */
  end:          LatLng;
  /** Toplam segment uzunluğu (metre) */
  lengthMeters: number;
}

/* ── Segment trafik durumu ───────────────────────────────────── */

/**
 * Bir yol segmentinin anlık trafik durumu.
 * trafficEngine.ts bu veriyi birden fazla kaynaktan sentezleyerek üretir.
 */
export interface SegmentTrafficState {
  segmentId:         string;
  level:             TrafficLevel;
  /** Gözlenen veya tahmin edilen ortalama hız (km/h) */
  avgSpeedKmh:       number;
  /** Bu segmentte beklenen gecikme (saniye) */
  expectedDelaySec:  number;
  /** 0.0 – 1.0 arası güven skoru */
  confidence:        number;
  source:            TrafficDataSource;
  /** Verinin alındığı zaman (epoch ms) */
  timestampMs:       number;
}

/* ── Saatlik tahmin verisi ───────────────────────────────────── */

/**
 * Belirli bir segment için saate göre tahmin profili.
 * trafficPredictionEngine.ts bu yapıyı üretir ve cache'e yazar.
 */
export interface HourlyPrediction {
  segmentId:    string;
  /** 0–23 arası saat indeksi */
  hour:         number;
  /** 0–6 arası gün indeksi (0 = Pazar) */
  dayOfWeek:    number;
  level:        TrafficLevel;
  avgSpeedKmh:  number;
  /** Modelin kaç gözleme dayandığı — az sample = düşük güven */
  sampleCount:  number;
}

/* ── Öğrenilmiş segment profili ─────────────────────────────── */

/**
 * trafficLearningEngine.ts'in her segment için biriktirdiği veri.
 * Gözlenen hız ile beklenen hız arasındaki sapma burada tutulur.
 */
export interface LearnedSegmentProfile {
  segmentId:       string;
  /** Segment başından beri toplam gözlem sayısı */
  totalSamples:    number;
  /** Birikimli hız toplamı — ortalama = sum/count */
  speedSumKmh:     number;
  /** Gecikme faktörü: gözlenen_hız / beklenen_hız — 1.0 = normal */
  delayFactor:     number;
  /** Son güncellenme zamanı (epoch ms) */
  lastUpdatedMs:   number;
  /** Saatlik gözlem dağılımı (0–23 indeksli) */
  hourlyObservations: Readonly<Record<number, number>>;
}

/* ── ETA maliyet hesabı ──────────────────────────────────────── */

/**
 * routingService'den gelen ham süreyi trafik verisine göre
 * düzelten trafficRouteCost.ts'in ürettiği çıktı.
 */
export interface RouteCostResult {
  /** OSRM'den gelen orijinal süre (saniye) */
  baseSeconds:          number;
  /** Trafik gecikmelerinin toplamı (saniye) */
  trafficDelaySeconds:  number;
  /** Kavşak + durağan beklemelerden gelen ceza (saniye) */
  junctionPenaltySeconds: number;
  /** Düzeltilmiş toplam süre (saniye) */
  adjustedSeconds:      number;
  /** Ortalama trafik güven skoru (0.0 – 1.0) */
  avgConfidence:        number;
  /** Hangi segmentler hesaba katıldı */
  segmentCount:         number;
}

/* ── Trafik uyarısı ──────────────────────────────────────────── */

/**
 * Sürücüye gösterilecek trafik uyarısı.
 * severity=info → pasif badge; severity=warn/critical → banner gösterilir.
 */
export type TrafficAlertSeverity = 'info' | 'warn' | 'critical';

export interface TrafficAlert {
  id:         string;
  severity:   TrafficAlertSeverity;
  message:    string;
  segmentId?: string;
  /** Uyarının gösterilmeyeceği epoch ms — TTL */
  expiresMs:  number;
}

/* ── Alternatif rota önerisi ─────────────────────────────────── */

/**
 * trafficSuggestionEngine.ts'in ürettiği öneri.
 * Eşik: mevcut rotaya kıyasla ≥ 4 dakika kazanç.
 */
export interface RouteAlternative {
  /** Benzersiz öneri ID'si */
  id:                string;
  label:             string;      // "Alternatif Rota 1"
  /** Önerilen rotanın tahmini süresi (traffic dahil, saniye) */
  estimatedSeconds:  number;
  /** Mevcut rotaya göre kazanç (saniye, pozitif = daha hızlı) */
  savingSeconds:     number;
  /** Önerinin hesaplandığı zaman */
  computedAtMs:      number;
  /** Bu önerinin rota geometrisi (opsiyonel — UI için) */
  geometry?:         LatLng[];
}

/* ── Ana trafik intelligence durumu ─────────────────────────── */

/**
 * trafficEngine.ts'in dışarıya sunduğu birleşik state.
 * useTrafficIntelligence() hook'u bu tipi döner.
 */
export interface TrafficIntelligenceState {
  /** Aktif rota üzerindeki segment durumları */
  segments:          SegmentTrafficState[];
  /** Düzeltilmiş ETA hesabı — mevcut navigasyon için */
  routeCost:         RouteCostResult | null;
  /** Aktif trafik uyarıları */
  alerts:            TrafficAlert[];
  /** Alternatif rota önerileri (boş = öneri yok) */
  alternatives:      RouteAlternative[];
  /** Sistemin son güncelleme zamanı */
  lastRefreshMs:     number;
  /** Veri yeterince taze mi (< 10 dakika) */
  isFresh:           boolean;
}

/* ── Segment ID üreteci ──────────────────────────────────────── */

/**
 * İki koordinattan deterministik segment ID üretir.
 * Aynı yol parçası her seferinde aynı ID'yi alır.
 * Precision 3 ≈ 111m grid — segment granülasyonu.
 *
 * Saf fonksiyon, runtime kodu içermez — tip dosyasında güvenli.
 */
export function makeSegmentId(start: LatLng, end: LatLng): string {
  const r = (n: number) => Math.round(n * 1000) / 1000; // 3 decimal = ~111m
  return `${r(start.lat)},${r(start.lng)}_${r(end.lat)},${r(end.lng)}`;
}

/**
 * OSRM [lon, lat] array'ini {lat, lng} objesine dönüştürür.
 * Koordinat dönüşümünün tek yetkili noktası — başka yerde kullanılmaz.
 */
export function fromOsrm([lon, lat]: [number, number]): LatLng {
  return { lat, lng: lon };
}

/**
 * TrafficLevel'den km/h referans hızı döner.
 * Segment'te gerçek hız yoksa bu değer kullanılır.
 */
export function refSpeedKmh(level: TrafficLevel): number {
  switch (level) {
    case 'free':       return 80;
    case 'moderate':   return 45;
    case 'heavy':      return 20;
    case 'standstill': return 5;
  }
}

/**
 * Yoğunluk katsayısından (0–1) TrafficLevel türetir.
 * trafficService.ts ile aynı eşikler — migrasyon sırasında uyumluluk.
 */
export function levelFromDensity(d: number): TrafficLevel {
  if (d < 0.30) return 'free';
  if (d < 0.60) return 'moderate';
  if (d < 0.85) return 'heavy';
  return 'standstill';
}
