package com.cockpitos.pro.media;

/**
 * MUSIC F6 — Ses kazancı matematiği (SAF, Android'e bağımsız).
 *
 * Neden ayrı sınıf: bu matematik ses zincirinin en tehlikeli yeridir (yanlış
 * bir katsayı ya sessizlik ya da clipping üretir) ve gerçek cihaz olmadan
 * JVM'de KİLİTLENEBİLMELİDİR. Buradaki hiçbir metot Android sınıfı, dosya,
 * zaman ya da durum kullanmaz.
 *
 * SÖZLEŞME:
 *   · Güvenlik preamp'i YALNIZ kısar; 1.0'ın üstüne ASLA çıkmaz.
 *   · Denge YALNIZ uzak kanalı kısar; hiçbir kanalı yükseltmez.
 *   · Örnek ölçeklemesi tam sayı tavanında SATURE olur (wrap-around YOK —
 *     taşan bir 16-bit örnek işaret değiştirirse duyulan şey klik/patlamadır).
 */
public final class CarosAudioGain {

    private CarosAudioGain() { }

    /** Preamp'in inebileceği taban (~ -26 dB). Altına inmek "arıza" ile ayırt edilemez. */
    public static final float MIN_PREAMP = 0.05f;

    /** Geçersiz/aşırı preamp'i güvenli banda çeker. NaN → 1.0 (etkisiz). */
    public static float clampPreamp(float g) {
        if (Float.isNaN(g) || Float.isInfinite(g)) return 1.0f;
        if (g > 1.0f) return 1.0f;
        if (g < MIN_PREAMP) return MIN_PREAMP;
        return g;
    }

    /** -1 (tam sol) … +1 (tam sağ). NaN → 0 (merkez). */
    public static float clampBalance(float b) {
        if (Float.isNaN(b) || Float.isInfinite(b)) return 0f;
        if (b > 1.0f) return 1.0f;
        if (b < -1.0f) return -1.0f;
        return b;
    }

    /** Sol kanal kazancı — sağa kaydıkça kısılır, ASLA 1.0'ı aşmaz. */
    public static float leftGain(float balance) {
        float b = clampBalance(balance);
        return b <= 0f ? 1.0f : Math.max(0f, 1.0f - b);
    }

    /** Sağ kanal kazancı — sola kaydıkça kısılır, ASLA 1.0'ı aşmaz. */
    public static float rightGain(float balance) {
        float b = clampBalance(balance);
        return b >= 0f ? 1.0f : Math.max(0f, 1.0f + b);
    }

    /**
     * Zincir tamamen etkisiz mi. Etkisizken işlemci örnek başına çarpma
     * YAPMAZ; tampon olduğu gibi kopyalanır (sıfır sinyal değişimi kanıtı).
     */
    public static boolean isUnity(float preamp, float balance) {
        return clampPreamp(preamp) == 1.0f && clampBalance(balance) == 0f;
    }

    /** 16-bit PCM örnek ölçekleme — tavanda SATURE olur, wrap-around YAPMAZ. */
    public static short scaleSample16(short sample, float gain) {
        float v = sample * gain;
        if (v > 32767f) return (short) 32767;
        if (v < -32768f) return (short) -32768;
        return (short) Math.round(v);
    }

    /** Float PCM örnek ölçekleme — [-1, 1] aralığında sature olur. */
    public static float scaleSampleFloat(float sample, float gain) {
        float v = sample * gain;
        if (v > 1.0f) return 1.0f;
        if (v < -1.0f) return -1.0f;
        return v;
    }
}
