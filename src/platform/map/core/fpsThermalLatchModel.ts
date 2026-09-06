/**
 * fpsThermalLatchModel — termal raster mandalının GİRİŞ kanıtı (SAF model).
 *
 * ── KÖK NEDEN (CİHAZDA ÖLÇÜLDÜ · 2026-09-06 · Xiaomi 23090RA98I) ───────────
 * MINI → FULL geçişinde, aynı GÜNDÜZ durumu içinde harita üç kez stil
 * değiştiriyordu:
 *
 *   Vector (Automotive Day) → OSM Map → Vector (Automotive Day)   (~3,4 sn)
 *
 * CDP izinde yakalanan kanıt (`trace-before-final.json`):
 *   tileRender-intent  vector → raster   t=967529  thermalLock=true   deviceTier=high
 *   tileRender-intent  raster → vector   t=970971  thermalLock=false
 * ve ilk olayın çağıran yığını `FullMapView → mapSourceManager.notifyLowFPS`.
 *
 * Yani raster'a düşüren şey ısı DEĞİLDİ: tam ekran haritanın AÇILIŞ saniyesi
 * (WebGL context + stil derleme + karo çözme) doğal olarak <20 FPS ölçülüyor,
 * FPS örnekleyicisi bu TEK örneği "termal boğulma" kanıtı sayıyor, mandal
 * kapanıyor, `setStyle(OSM Map)` çalışıyor; 2500 ms sonra kurtarma vektöre
 * geri dönüyor. `deviceTier: 'high'` bir cihazda bile.
 *
 * ── NEDEN BU DÜZELTME "POLİTİKA DEĞİŞİKLİĞİ" DEĞİL ────────────────────────
 * Termal mandalın kendisi korunur; yalnız GİRİŞİNİN kanıt eşiği ÇIKIŞINKİYLE
 * simetrik hâle gelir. Mevcut sözleşmede asimetri vardı:
 *   · çıkış  → 2500 ms İSTİKRARLI yüksek FPS isteniyordu (kanıt vardı),
 *   · giriş  → tek bir 1 sn'lik örnek yetiyordu (kanıt YOKTU).
 * Gerçek termal boğulma dakikalar süren bir olaydır; 3 sn'lik kanıt penceresi
 * korumayı zayıflatmaz, yalnız açılış geçişini termal olay saymayı bırakır.
 *
 * SAF: I/O · timer · `Date.now` · global durum · React importu YOK.
 */

/** Mandalın FPS eşiği — mevcut üretim değeri, DEĞİŞMEDİ. */
export const FPS_LOW_THRESHOLD = 20;

/** Girişte istenen ardışık düşük örnek sayısı (örnek periyodu 1000 ms). */
export const FPS_LOW_CONFIRM_SAMPLES = 3;

export interface FpsThermalLatchInput {
  /** Son 1 sn'de sayılan kare (FullMapView örnekleyicisi). */
  readonly fps: number;
  /** Mandal şu an kapalı mı (raster kilidi istendi mi). */
  readonly latched: boolean;
  /** Şu ana kadarki ardışık düşük örnek sayısı. */
  readonly lowStreak: number;
  /**
   * Yüzey henüz oturmadı mı (harita READY değil ya da stil değişiyor).
   * Bu pencerede ölçülen FPS termal kanıt DEĞİLDİR.
   */
  readonly surfaceSettling: boolean;
}

export interface FpsThermalLatchDecision {
  readonly lowStreak: number;
  readonly latched: boolean;
  /** `notifyLowFPS` yalnız kenar değişiminde çağrılır. */
  readonly changed: boolean;
}

export function evaluateFpsThermalLatch(input: FpsThermalLatchInput): FpsThermalLatchDecision {
  const { fps, latched, lowStreak, surfaceSettling } = input;

  // Kurulum/stil penceresi: örnek yok sayılır, seri sıfırlanır, mandal KORUNUR.
  // (Mandal zaten kapalıysa buradan açılmaz — kendi setStyle'ı yeni bir düşük
  //  örnek üretip mandalı besleyen geri besleme döngüsü de böylece kesilir.)
  if (surfaceSettling) return { lowStreak: 0, latched, changed: false };

  if (fps < FPS_LOW_THRESHOLD) {
    const next = lowStreak + 1;
    const shouldLatch = next >= FPS_LOW_CONFIRM_SAMPLES;
    return { lowStreak: next, latched: latched || shouldLatch, changed: !latched && shouldLatch };
  }

  // Tek iyi örnek seriyi sıfırlar; bırakma tarafının debounce'u
  // `mapSourceManager.notifyLowFPS(false)` içindedir (2500 ms) — burada
  // ikinci bir zamanlayıcı KURULMAZ.
  return { lowStreak: 0, latched: false, changed: latched };
}
