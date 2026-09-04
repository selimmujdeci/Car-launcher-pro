package com.cockpitos.pro.media;

import android.media.audiofx.AudioEffect;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.media.audiofx.Virtualizer;
import android.os.Bundle;

import androidx.annotation.Nullable;

/**
 * MUSIC F6 — Native DSP efekt katmanı (EQ · loudness · denge/preamp bağlama).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SINIR (Cross-Domain §1, §6, §7)
 * ══════════════════════════════════════════════════════════════════════════
 * Bu sınıf SES RENGİNİN sahibidir. Şunların sahibi DEĞİLDİR ve onlara YAZMAZ:
 *   · oynatma durumu   → CarosPlaybackService (ExoPlayer)
 *   · kullanıcı sesi   → CarosPlaybackService.userVolume
 *   · duck çarpanı     → CarosAudioFocusManager
 *   · audio focus      → CarosAudioFocusManager
 *
 * ══════════════════════════════════════════════════════════════════════════
 * FAIL-SAFE — "DSP sesi kilitleyemez"
 * ══════════════════════════════════════════════════════════════════════════
 * {@link AudioEffect} üretici implementasyonlarında kararsızdır: kimi cihaz
 * {@code IllegalStateException}, kimi {@code UnsupportedOperationException},
 * kimi de sessizce {@code ERROR_INVALID_OPERATION} döndürür. Bu yüzden HER
 * çağrı yakalanır ve tek bir sonuç üretir: **BYPASS**. Bypass'ta oynatma
 * kesilmez, kuyruk bozulmaz, focus etkilenmez — yalnız ses rengi düzleşir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KUŞAK (generation) — bayat yazım koruması
 * ══════════════════════════════════════════════════════════════════════════
 * Her attach/detach kuşağı ARTIRIR. JS otoritesi okuduğu kuşakla yazar;
 * arada audio session değiştiyse yazım {@code stale_session} ile REDDEDİLİR.
 * Eski oturumun ayarı yeni oturuma sızamaz.
 */
public final class CarosAudioEffects {

    /** Efekt önceliği — uygulama içi, düşük öncelik (sistem efektlerini ezmez). */
    private static final int EFFECT_PRIORITY = 0;

    /** Ürün tavanı: cihaz izin verse bile loudness bu değeri aşmaz (mB). */
    public static final int MAX_LOUDNESS_MILLIBEL = 600;

    private final CarosBalanceAudioProcessor processor;

    private @Nullable Equalizer eq;
    private @Nullable LoudnessEnhancer loudness;

    private int sessionId = AudioEffect.ERROR;          // geçersiz başlangıç
    private long generation = 0L;

    /* ── Ölçülen yetenekler (probe edilmeden HEPSİ yok sayılır) ───────────── */
    private boolean probed = false;
    private boolean supportsEqualizer = false;
    private int bandCount = 0;
    private int[] bandFrequenciesHz = new int[0];
    private int minGainMilliBel = 0;
    private int maxGainMilliBel = 0;
    private boolean supportsLoudness = false;
    private boolean supportsVirtualizer = false;
    private boolean vendorDspDetected = false;
    private String unavailableReason = "not_probed";

    /* ── Uygulanmış durum (gözlem) ────────────────────────────────────────── */
    private boolean enabled = true;
    private int[] appliedBands = new int[0];
    private int appliedLoudness = 0;
    private float appliedPreamp = 1.0f;
    private float appliedBalance = 0f;
    private boolean bypass = true;
    private String bypassReason = "not_attached";

    /* ── Sayaçlar (bounded, PII yok) ──────────────────────────────────────── */
    private int attachCount = 0;
    private int attachFailureCount = 0;
    private int applyFailureCount = 0;
    private String lastFailureCode = "";
    private long lastApplyLatencyMs = 0L;
    private long lastAttachLatencyMs = 0L;

    public CarosAudioEffects(CarosBalanceAudioProcessor processor) {
        this.processor = processor;
    }

    public synchronized long getGeneration() { return generation; }

    /* ── Bağlama / çözme ──────────────────────────────────────────────────── */

    /**
     * Efektleri verilen audio session'a bağlar. Aynı session için tekrar
     * çağrılmak GÜVENLİDİR (idempotent). Başarısızlıkta bypass'a düşer;
     * oynatma HİÇBİR ŞEKİLDE etkilenmez.
     */
    public synchronized void attach(int newSessionId) {
        if (newSessionId == AudioEffect.ERROR || newSessionId == 0) {
            // Session henüz yok: efekt ZORLANMAZ (§10 — player hazır değilse yazma yok).
            releaseEffects();
            sessionId = AudioEffect.ERROR;
            generation++;
            probed = false;
            unavailableReason = "no_audio_session";
            setBypass("no_audio_session");
            return;
        }
        if (newSessionId == sessionId && eq != null) return;   // zaten bağlı

        long t0 = System.currentTimeMillis();
        releaseEffects();
        sessionId = newSessionId;
        generation++;
        attachCount++;

        probeAndBind();
        lastAttachLatencyMs = System.currentTimeMillis() - t0;

        /* Yeniden bağlanmada SON BİLİNEN ayar geri uygulanır — kullanıcı
           her session değişiminde EQ'sunu kaybetmez. Bu bir "live truth"
           yükseltmesi değildir: yetenekler yeniden ölçülmüştür. */
        if (probed) applyInternal(enabled, appliedBands, appliedLoudness, appliedPreamp, appliedBalance);
    }

    /** Servis kapanışı — zero-leak. */
    public synchronized void release() {
        releaseEffects();
        sessionId = AudioEffect.ERROR;
        generation++;
        probed = false;
        unavailableReason = "released";
        setBypass("released");
    }

    private void releaseEffects() {
        if (eq != null) {
            try { eq.setEnabled(false); } catch (Throwable ignored) { }
            try { eq.release(); } catch (Throwable ignored) { }
            eq = null;
        }
        if (loudness != null) {
            try { loudness.setEnabled(false); } catch (Throwable ignored) { }
            try { loudness.release(); } catch (Throwable ignored) { }
            loudness = null;
        }
        try { processor.resetGains(); } catch (Throwable ignored) { }
    }

    /** Yetenekleri CİHAZDAN ölçer. Hiçbir değer varsayılmaz. */
    private void probeAndBind() {
        probed = false;
        supportsEqualizer = false;
        supportsLoudness = false;
        bandCount = 0;
        bandFrequenciesHz = new int[0];
        minGainMilliBel = 0;
        maxGainMilliBel = 0;

        try {
            Equalizer e = new Equalizer(EFFECT_PRIORITY, sessionId);
            short bands = e.getNumberOfBands();
            short[] range = e.getBandLevelRange();
            int count = Math.max(0, Math.min((int) bands, 32));
            int[] freqs = new int[count];
            for (int i = 0; i < count; i++) {
                // getCenterFreq milliHz döndürür → Hz'e indirilir.
                freqs[i] = Math.max(1, e.getCenterFreq((short) i) / 1000);
            }
            eq = e;
            bandCount = count;
            bandFrequenciesHz = freqs;
            minGainMilliBel = range != null && range.length > 0 ? range[0] : 0;
            maxGainMilliBel = range != null && range.length > 1 ? range[1] : 0;
            supportsEqualizer = count > 0 && maxGainMilliBel > minGainMilliBel;
        } catch (Throwable t) {
            attachFailureCount++;
            lastFailureCode = "equalizer_unavailable";
            eq = null;
        }

        try {
            loudness = new LoudnessEnhancer(sessionId);
            supportsLoudness = true;
        } catch (Throwable t) {
            lastFailureCode = "loudness_unavailable";
            loudness = null;
            supportsLoudness = false;
        }

        // Virtualizer YALNIZ raporlanır; F6'da kontrolü YOKTUR (yetenek uydurulmaz).
        supportsVirtualizer = false;
        Virtualizer v = null;
        try {
            v = new Virtualizer(EFFECT_PRIORITY, sessionId);
            supportsVirtualizer = v.getStrengthSupported();
        } catch (Throwable ignored) {
            supportsVirtualizer = false;
        } finally {
            if (v != null) { try { v.release(); } catch (Throwable ignored) { } }
        }

        vendorDspDetected = detectVendorDsp();

        probed = supportsEqualizer || supportsLoudness || processor.isFormatSupported();
        if (!probed) {
            unavailableReason = "no_effect_available";
            setBypass("no_effect_available");
        } else {
            unavailableReason = "";
        }
    }

    /**
     * Üretici DSP'si var mı — TÜRETİLMİŞ bir gözlemdir, kesin bilgi DEĞİLDİR.
     * AOSP dışı bir equalizer implementasyonu bildirilmişse donanım/üretici
     * DSP'si olduğunu VARSAYARIZ; bunun ötesinde bir iddia kurulmaz.
     */
    private boolean detectVendorDsp() {
        try {
            AudioEffect.Descriptor[] all = AudioEffect.queryEffects();
            if (all == null) return false;
            for (AudioEffect.Descriptor d : all) {
                if (d == null || d.type == null) continue;
                if (!AudioEffect.EFFECT_TYPE_EQUALIZER.equals(d.type)) continue;
                String impl = d.implementor == null ? "" : d.implementor;
                if (!impl.toLowerCase().contains("android open source")) return true;
            }
        } catch (Throwable ignored) { }
        return false;
    }

    /* ── Uygulama ─────────────────────────────────────────────────────────── */

    /**
     * Ayarı uygular. Dönüş "" ise uygulandı; aksi hâlde hata kodu.
     * KUŞAK KAPISI: okunan kuşak artık geçerli değilse yazım REDDEDİLİR.
     */
    public synchronized String apply(long callerGeneration, boolean wantEnabled,
                                     int[] bandsMilliBel, int loudnessMilliBel,
                                     float preampLinear, float balance) {
        if (callerGeneration != generation) return "stale_session";
        if (!probed) return "dsp_unavailable";

        long t0 = System.currentTimeMillis();
        String err = applyInternal(wantEnabled, bandsMilliBel, loudnessMilliBel, preampLinear, balance);
        lastApplyLatencyMs = System.currentTimeMillis() - t0;
        return err;
    }

    private String applyInternal(boolean wantEnabled, int[] bandsMilliBel, int loudnessMilliBel,
                                 float preampLinear, float balance) {
        enabled = wantEnabled;

        if (!wantEnabled) {
            // Tam bypass: efektler kapanır, sinyal zinciri nötrlenir.
            try {
                if (eq != null) eq.setEnabled(false);
                if (loudness != null) loudness.setEnabled(false);
                processor.resetGains();
                appliedPreamp = 1.0f;
                appliedBalance = 0f;
                setBypass("user_disabled");
                return "";
            } catch (Throwable t) {
                return fail("disable_failed");
            }
        }

        boolean anyApplied = false;

        // ── EQ ───────────────────────────────────────────────────────────────
        if (supportsEqualizer && eq != null && bandsMilliBel != null) {
            try {
                int n = Math.min(bandCount, bandsMilliBel.length);
                int[] written = new int[bandCount];
                for (int i = 0; i < bandCount; i++) {
                    int mb = i < n ? bandsMilliBel[i] : 0;
                    if (mb < minGainMilliBel) mb = minGainMilliBel;
                    if (mb > maxGainMilliBel) mb = maxGainMilliBel;
                    eq.setBandLevel((short) i, (short) mb);
                    written[i] = mb;
                }
                eq.setEnabled(true);
                appliedBands = written;
                anyApplied = true;
            } catch (Throwable t) {
                return fail("eq_apply_failed");
            }
        }

        // ── Loudness ─────────────────────────────────────────────────────────
        if (supportsLoudness && loudness != null) {
            try {
                int mb = loudnessMilliBel;
                if (mb < 0) mb = 0;
                if (mb > MAX_LOUDNESS_MILLIBEL) mb = MAX_LOUDNESS_MILLIBEL;
                loudness.setTargetGain(mb);
                loudness.setEnabled(mb > 0);
                appliedLoudness = mb;
                anyApplied = true;
            } catch (Throwable t) {
                return fail("loudness_apply_failed");
            }
        }

        // ── Denge + güvenlik preamp'i ────────────────────────────────────────
        try {
            float p = CarosAudioGain.clampPreamp(preampLinear);
            float b = CarosAudioGain.clampBalance(balance);
            processor.setGains(p, b);
            appliedPreamp = p;
            appliedBalance = b;
            if (processor.isFormatSupported()) anyApplied = true;
        } catch (Throwable t) {
            return fail("gain_apply_failed");
        }

        if (anyApplied) {
            bypass = false;
            bypassReason = "";
            lastFailureCode = "";
        } else {
            setBypass("nothing_to_apply");
        }
        return "";
    }

    /** Hata → BYPASS. Oynatma devam eder; yalnız ses rengi düzleşir. */
    private String fail(String code) {
        applyFailureCount++;
        lastFailureCode = code;
        try {
            if (eq != null) eq.setEnabled(false);
            if (loudness != null) loudness.setEnabled(false);
            processor.resetGains();
        } catch (Throwable ignored) { }
        appliedPreamp = 1.0f;
        appliedBalance = 0f;
        setBypass(code);
        return code;
    }

    private void setBypass(String reason) {
        bypass = true;
        bypassReason = reason == null ? "" : reason;
    }

    /* ── Gözlem ───────────────────────────────────────────────────────────── */

    /** Yetenek raporu — ölçülmediyse `probed:false` (varsayım ÜRETİLMEZ). */
    public synchronized Bundle capabilities() {
        Bundle b = new Bundle();
        b.putBoolean("probed", probed);
        b.putBoolean("supportsEqualizer", supportsEqualizer);
        b.putInt("eqBandCount", supportsEqualizer ? bandCount : 0);
        b.putIntArray("eqBandFrequenciesHz", supportsEqualizer ? bandFrequenciesHz : new int[0]);
        b.putInt("eqMinGainMilliBel", supportsEqualizer ? minGainMilliBel : 0);
        b.putInt("eqMaxGainMilliBel", supportsEqualizer ? maxGainMilliBel : 0);
        b.putBoolean("supportsLoudness", supportsLoudness);
        b.putInt("loudnessMaxMilliBel", supportsLoudness ? MAX_LOUDNESS_MILLIBEL : 0);
        /* Denge, uygulamanın KENDİ ses zincirinde uygulanır; yeteneği işlemcinin
           zincire kurulmuş olmasıdır. O anki akışın formatı ayrı bir GÖZLEMdir
           (snapshot.processorActive) ve yetenekle karıştırılmaz. */
        b.putBoolean("supportsBalance", true);
        /* Android uygulama ses yolu STEREO'dur: gerçek ön/arka kanal YOKTUR.
           Fader'ı "varmış gibi" göstermek sahte bir donanım iddiasıdır. */
        b.putBoolean("supportsFader", false);
        b.putString("faderUnsupportedReason", "stereo_output_only");
        b.putBoolean("supportsVirtualizer", supportsVirtualizer);
        b.putBoolean("supportsHardwareDsp", vendorDspDetected);
        b.putString("unavailableReason", unavailableReason);
        b.putLong("generation", generation);
        return b;
    }

    /** Bounded gözlem — sır/PII taşımaz. */
    public synchronized Bundle snapshot() {
        Bundle b = new Bundle();
        b.putBoolean("available", probed);
        b.putInt("audioSessionId", sessionId);
        b.putLong("generation", generation);
        b.putBoolean("equalizerAttached", eq != null && supportsEqualizer);
        b.putBoolean("loudnessAttached", loudness != null && supportsLoudness);
        b.putBoolean("processorActive", processor.isFormatSupported());
        b.putBoolean("bypass", bypass);
        b.putString("bypassReason", bypassReason);
        b.putIntArray("appliedBandsMilliBel", appliedBands);
        b.putInt("appliedLoudnessMilliBel", appliedLoudness);
        b.putFloat("appliedPreampLinear", appliedPreamp);
        b.putFloat("appliedBalance", appliedBalance);
        b.putInt("attachCount", attachCount);
        b.putInt("attachFailureCount", attachFailureCount);
        b.putInt("applyFailureCount", applyFailureCount);
        b.putString("lastFailureCode", lastFailureCode);
        b.putLong("lastApplyLatencyMs", lastApplyLatencyMs);
        b.putLong("lastAttachLatencyMs", lastAttachLatencyMs);
        return b;
    }
}
