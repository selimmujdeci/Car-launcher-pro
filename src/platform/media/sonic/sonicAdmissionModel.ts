/**
 * sonicAdmissionModel.ts — MUSIC F17 · Ses analizi KABUL kararı (SAF).
 *
 * Ses analizi CarOS'un yaptığı EN PAHALI müzik işidir (decode + FFT). Bu yüzden
 * "çalıştırılabilir mi" sorusu bir POLİTİKA sorusudur ve burada, saf bir
 * fonksiyonda cevaplanır.
 *
 * ── OTORİTE SINIRI (Cross-Domain §5 · §7) ────────────────────────────────
 * Bu model **hiçbir yeni otorite kurmaz**: cihaz sınıfı `deviceCapabilities`in,
 * termal seviye termal sahibinin, bellek baskısı `memoryWatchdog`un truth'udur.
 * Burada yalnız MEVCUT kanıt okunup bir iş yükü kararı verilir.
 *
 * ── PERFORMANS GERÇEĞİ DEĞİŞTİRMEZ (§7) ──────────────────────────────────
 * Baskı altında karar `BYPASS`tır: **ölçüm YAPILMAZ.** Kaba/eksik bir ölçümü
 * "kanıt" diye kaydetmek performansı gerçeğe karıştırmak olurdu.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

export type SonicAdmissionDecision = 'ADMIT' | 'DEFER' | 'BYPASS';

export type SonicAdmissionReason =
  /** Native yüzey yok (tarayıcı/demo) — ölçüm mümkün değil. */
  | 'NATIVE_UNAVAILABLE'
  /** Cihaz ısınmış; ağır decode termal duruma eklenmez. */
  | 'THERMAL_PRESSURE'
  /** Bellek baskısı: arka plan işi DURDU. */
  | 'MEMORY_PRESSURE'
  /** Düşük-uç cihazda ses çalarken decode yapılmaz (dropout riski). */
  | 'LOW_TIER_WHILE_PLAYING'
  /** Zaten bir tur koşuyor — ikinci tur açılmaz. */
  | 'ALREADY_RUNNING'
  /** İstenecek dosya yok. */
  | 'NOTHING_TO_ANALYZE'
  | 'OK';

export interface SonicAdmissionInput {
  /** Native `analyzeTrackAudio` yüzeyi var mı. */
  readonly nativeAvailable: boolean;
  /** 0..3 termal seviye; ölçülemiyorsa `null`. */
  readonly thermalLevel: 0 | 1 | 2 | 3 | null;
  /** Bellek merdiveni; ölçülemiyorsa `null`. */
  readonly memoryLevel: string | null;
  readonly deviceTier: 'low' | 'mid' | 'high' | null;
  /** Şu anda ses çalıyor mu (gözlenen oynatma gerçeği). */
  readonly playbackActive: boolean;
  /** Halihazırda koşan bir analiz turu var mı. */
  readonly inFlight: boolean;
  /** Kuyruğa alınmış (henüz ölçülmemiş) dosya sayısı. */
  readonly pendingCount: number;
}

export interface SonicAdmission {
  readonly decision: SonicAdmissionDecision;
  readonly reason: SonicAdmissionReason;
  /** Bu turda istenecek EN FAZLA dosya (karar `ADMIT` değilse 0). */
  readonly batchSize: number;
}

/** Cihaz sınıfına göre tur büyüklüğü — düşük-uçta tek dosya. */
export function batchSizeForTier(tier: 'low' | 'mid' | 'high' | null): number {
  switch (tier) {
    case 'high': return 4;
    case 'mid': return 2;
    /* Bilinmeyen cihaz DÜŞÜK varsayılır (fail-closed bütçe). */
    default: return 1;
  }
}

/** Bellek merdiveninde arka plan işini durduran seviyeler. */
const MEMORY_STOP: readonly string[] = Object.freeze(['PAUSE_BACKGROUND', 'CRITICAL_PROTECT']);

const deny = (reason: SonicAdmissionReason, decision: SonicAdmissionDecision): SonicAdmission =>
  Object.freeze({ decision, reason, batchSize: 0 });

/**
 * Analiz turu açılabilir mi.
 *
 * Sıra ANLAMLIDIR: önce "mümkün mü", sonra "güvenli mi", en son "ne kadar".
 * Hiçbir dalda kısmi/kaba ölçüm önerilmez — `BYPASS` gerçekten hiç ölçmemektir.
 */
export function admitSonicAnalysis(input: SonicAdmissionInput): SonicAdmission {
  if (!input.nativeAvailable) return deny('NATIVE_UNAVAILABLE', 'BYPASS');
  if (input.pendingCount <= 0) return deny('NOTHING_TO_ANALYZE', 'BYPASS');
  if (input.inFlight) return deny('ALREADY_RUNNING', 'DEFER');

  if (input.thermalLevel !== null && input.thermalLevel >= 2) {
    return deny('THERMAL_PRESSURE', 'BYPASS');
  }
  if (input.memoryLevel !== null && MEMORY_STOP.includes(input.memoryLevel)) {
    return deny('MEMORY_PRESSURE', 'BYPASS');
  }
  if (input.deviceTier === 'low' && input.playbackActive) {
    /* Ertelenir, iptal EDİLMEZ: kullanıcı durdurunca ölçüm yapılabilir. */
    return deny('LOW_TIER_WHILE_PLAYING', 'DEFER');
  }

  const tierBatch = batchSizeForTier(input.deviceTier);
  /* Isınma başlangıcında (seviye 1) tur yarıya iner ama DURMAZ. */
  const thermalBatch = input.thermalLevel === 1 ? Math.max(1, Math.floor(tierBatch / 2)) : tierBatch;
  return Object.freeze({
    decision: 'ADMIT' as const,
    reason: 'OK' as const,
    batchSize: Math.max(1, Math.min(thermalBatch, input.pendingCount)),
  });
}
