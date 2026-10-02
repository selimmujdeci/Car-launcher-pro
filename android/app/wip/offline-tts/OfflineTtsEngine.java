package com.cockpitos.pro.voice;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.SystemClock;
import android.util.Log;

import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * CarOS'un kendi çevrim dışı Türkçe sesi (sherpa-onnx + Piper). Android TTS'i olmayan /
 * Türkçe bilmeyen cihazlarda native TTS yolunun yerine geçer (CarLauncherPlugin karar verir).
 *
 * Çalışma: model ilk kullanımda yüklenir (bir kez). Metin cümle cümle üretilir; her parça
 * üretilir üretilmez AudioTrack'e yazılır → uzun cevapta ilk ses beklemeden başlar.
 * Yeni konuşma eskisini keser (QUEUE_FLUSH anlamı; nesil sayacı).
 */
public final class OfflineTtsEngine {

    private static final String TAG = "OfflineTts";

    public interface Listener {
        void onStart(String utteranceId);
        void onDone(String utteranceId);
        void onError(String utteranceId, String reason);
    }

    public static final class Segment {
        public final String text;
        public final float rate;
        public final int pauseMs;
        public Segment(String text, float rate, int pauseMs) {
            this.text = text; this.rate = rate; this.pauseMs = Math.max(0, pauseMs);
        }
    }

    private final OfflineTtsInstaller installer;
    private final Listener listener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "offline-tts");
        t.setPriority(Thread.NORM_PRIORITY + 1);
        return t;
    });
    private final AtomicInteger gen = new AtomicInteger();
    private volatile OfflineTts tts = null;
    private volatile AudioTrack track = null;

    public OfflineTtsEngine(OfflineTtsInstaller installer, Listener listener) {
        this.installer = installer;
        this.listener = listener;
    }

    public boolean isReady() { return installer.isInstalled(); }

    /** Modeli arka planda önden yükle (ilk cevap gecikmesin). */
    public void preload() {
        if (!isReady()) return;
        worker.execute(() -> { try { ensureLoaded(); } catch (Throwable t) { Log.w(TAG, "ön yükleme: " + t.getMessage()); } });
    }

    /** Segmentleri sırayla seslendir; bitince doneId için onDone. Önceki konuşmayı keser. */
    public void speak(final List<Segment> segments, final String doneId) {
        final int my = gen.incrementAndGet();
        stopTrack();
        worker.execute(() -> runSpeak(segments, doneId, my));
    }

    public void stop() {
        gen.incrementAndGet();
        stopTrack();
    }

    private void runSpeak(List<Segment> segments, String doneId, int my) {
        if (my != gen.get()) { listener.onDone(doneId); return; }
        AudioTrack at = null;
        try {
            OfflineTts engine = ensureLoaded();
            int sr = engine.sampleRate();
            int minBuf = AudioTrack.getMinBufferSize(sr, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT);
            at = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
                .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(sr)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build())
                .setBufferSizeInBytes(Math.max(minBuf, sr * 4 / 2)) // ≥ 0,5 sn
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
            track = at;
            at.play();
            final AudioTrack fat = at;
            final long[] written = { 0 };
            final boolean[] started = { false };
            for (int i = 0; i < segments.size(); i++) {
                Segment s = segments.get(i);
                if (my != gen.get()) break;
                if (s.text == null || s.text.trim().isEmpty()) continue;
                float speed = s.rate > 0 ? s.rate : 1.0f;
                engine.generateWithCallback(s.text, 0, speed, samples -> {
                    if (my != gen.get()) return 0; // kesildi → üretimi durdur
                    if (!started[0]) { started[0] = true; listener.onStart(doneId); }
                    int w = fat.write(samples, 0, samples.length, AudioTrack.WRITE_BLOCKING);
                    if (w > 0) written[0] += w;
                    return my == gen.get() ? 1 : 0;
                });
                if (s.pauseMs > 0 && i < segments.size() - 1 && my == gen.get()) {
                    float[] sil = new float[sr * s.pauseMs / 1000];
                    int w = at.write(sil, 0, sil.length, AudioTrack.WRITE_BLOCKING);
                    if (w > 0) written[0] += w;
                }
            }
            // Kalan tamponun gerçekten çalınmasını bekle (bitiş = ses bitti).
            if (my == gen.get()) {
                long deadline = SystemClock.elapsedRealtime() + 3_000 + written[0] * 1000L / sr;
                while (my == gen.get() && at.getPlaybackHeadPosition() < written[0]
                        && SystemClock.elapsedRealtime() < deadline) {
                    SystemClock.sleep(30);
                }
            }
            listener.onDone(doneId);
        } catch (Throwable t) {
            Log.w(TAG, "seslendirme hatası: " + t.getMessage());
            listener.onError(doneId, String.valueOf(t.getMessage()));
        } finally {
            if (at != null) {
                try { at.stop(); } catch (Throwable ignored) {}
                try { at.release(); } catch (Throwable ignored) {}
            }
            if (track == at) track = null;
        }
    }

    private synchronized OfflineTts ensureLoaded() {
        if (tts != null) return tts;
        if (!installer.isInstalled()) throw new IllegalStateException("model kurulu değil");
        long t0 = SystemClock.elapsedRealtime();
        OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig(
            installer.modelFile().getAbsolutePath(), "", installer.tokensFile().getAbsolutePath(),
            installer.espeakDir().getAbsolutePath(), "", 0.667f, 0.8f, 1.0f);
        OfflineTtsModelConfig model = new OfflineTtsModelConfig();
        model.setVits(vits);
        model.setNumThreads(threadsFor(Runtime.getRuntime().availableProcessors()));
        model.setProvider("cpu");
        model.setDebug(false);
        OfflineTtsConfig cfg = new OfflineTtsConfig();
        cfg.setModel(model);
        cfg.setMaxNumSentences(1); // cümle başına geri çağırma → ilk ses erken
        tts = new OfflineTts(null, cfg);
        Log.i(TAG, "model yüklendi " + (SystemClock.elapsedRealtime() - t0) + " ms, sr=" + tts.sampleRate());
        return tts;
    }

    private void stopTrack() {
        AudioTrack at = track;
        if (at != null) {
            try { at.pause(); at.flush(); } catch (Throwable ignored) {}
        }
    }

    /** 4+ çekirdekte 2 iş parçacığı (Vosk/arayüz nefes alsın), azsa 1. */
    static int threadsFor(int cores) { return cores >= 4 ? 2 : 1; }
}
