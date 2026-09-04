package com.cockpitos.pro.media;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;

/**
 * MUSIC F6 — Sol/sağ denge + güvenlik preamp'i (gerçek sinyal işleme).
 *
 * NEDEN BURADA: Android'in standart {@code AudioEffect} yüzeyinde stereo denge
 * YOKTUR. Denge ve headroom kazancını kullanıcı sesine (ExoPlayer volume)
 * yazmak YASAKTIR — o başka bir otoritenin mülküdür (F0 · userVolume ·
 * duck çarpanı). Bu yüzden ikisi ses zincirinin İÇİNDE, ayrı ve sınırlı bir
 * katsayı olarak uygulanır.
 *
 * FAIL-SAFE:
 *   · Desteklenmeyen format (stereo değil / PCM değil) → işlemci PASİF kalır
 *     ve tampon HİÇ dokunulmadan geçer. Ses ASLA kesilmez.
 *   · Nötr ayarda (preamp = 1.0 ve denge = 0) örnek başına çarpma yapılmaz;
 *     tampon birebir kopyalanır.
 *   · Kazançlar volatile okunur: ayar değişimi akışı yeniden yapılandırmaz,
 *     bir sonraki tampondan itibaren geçerlidir (yeniden kurulum sırasında
 *     oluşacak sessizlik/klik riski YOK).
 */
@OptIn(markerClass = UnstableApi.class)
public final class CarosBalanceAudioProcessor extends BaseAudioProcessor {

    /** Güvenlik preamp'i (0.05–1.0). Kullanıcı sesi DEĞİLDİR. */
    private volatile float preamp = 1.0f;
    /** -1 … +1 denge. */
    private volatile float balance = 0f;

    /** Yapılandırılan format destekleniyor mu — LAB bunu okur. */
    private volatile boolean formatSupported = false;
    private volatile int configuredEncoding = C.ENCODING_INVALID;

    public void setGains(float preampLinear, float balanceValue) {
        this.preamp = CarosAudioGain.clampPreamp(preampLinear);
        this.balance = CarosAudioGain.clampBalance(balanceValue);
    }

    /**
     * Tam bypass — efekt katmanı kapandığında çağrılır.
     * NOT: {@code BaseAudioProcessor.reset()} final'dır ve akışı sıfırlar;
     * bu metot YALNIZ katsayıları nötrler, akışa DOKUNMAZ.
     */
    public void resetGains() {
        this.preamp = 1.0f;
        this.balance = 0f;
    }

    public boolean isFormatSupported() { return formatSupported; }
    public float getPreamp()  { return preamp; }
    public float getBalance() { return balance; }

    @Override
    protected AudioProcessor.AudioFormat onConfigure(AudioProcessor.AudioFormat inputAudioFormat)
        throws AudioProcessor.UnhandledAudioFormatException {
        boolean stereo = inputAudioFormat.channelCount == 2;
        boolean pcm = inputAudioFormat.encoding == C.ENCODING_PCM_16BIT
            || inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT;
        formatSupported = stereo && pcm;
        configuredEncoding = inputAudioFormat.encoding;
        if (!formatSupported) {
            /* Desteklenmiyor: NOT_SET döndürmek işlemciyi PASİF yapar ve
               ExoPlayer tamponu bize hiç uğratmadan geçirir (fail-safe). */
            return AudioProcessor.AudioFormat.NOT_SET;
        }
        return inputAudioFormat;
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        int remaining = inputBuffer.remaining();
        if (remaining == 0) return;

        ByteBuffer out = replaceOutputBuffer(remaining);
        final float p = preamp;
        final float b = balance;

        if (CarosAudioGain.isUnity(p, b)) {
            // Nötr: sinyale DOKUNULMAZ (bit-birebir geçiş).
            out.put(inputBuffer);
            out.flip();
            return;
        }

        final float gl = CarosAudioGain.leftGain(b) * p;
        final float gr = CarosAudioGain.rightGain(b) * p;

        if (configuredEncoding == C.ENCODING_PCM_FLOAT) {
            int frames = remaining / 8;   // 2 kanal × 4 bayt
            for (int i = 0; i < frames; i++) {
                out.putFloat(CarosAudioGain.scaleSampleFloat(inputBuffer.getFloat(), gl));
                out.putFloat(CarosAudioGain.scaleSampleFloat(inputBuffer.getFloat(), gr));
            }
        } else {
            int frames = remaining / 4;   // 2 kanal × 2 bayt
            for (int i = 0; i < frames; i++) {
                out.putShort(CarosAudioGain.scaleSample16(inputBuffer.getShort(), gl));
                out.putShort(CarosAudioGain.scaleSample16(inputBuffer.getShort(), gr));
            }
        }
        inputBuffer.position(inputBuffer.limit());
        out.flip();
    }

    @Override
    protected void onReset() {
        formatSupported = false;
        configuredEncoding = C.ENCODING_INVALID;
    }
}
