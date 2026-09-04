package com.cockpitos.pro.media;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * SonicAudioAnalyzer — MUSIC F17 · SESIN KENDISINDEN olculen kanit.
 *
 * F10.1 bir ETIKET okumasiydi (ID3 `TBPM`): ureticinin yazdigi deger. Bu sinif
 * ilk kez dosyayi DECODE eder ve dalga formunun kendisini olcer:
 *   - gercek tepe/RMS seviyesi (dBFS) ve crest faktoru,
 *   - onset (baslangic) zarfindan otokorelasyonla TEMPO,
 *   - spektral agirlik merkezi, %85 rolloff, sifir-gecis orani,
 *   - 8 bantlik normalize enerji vektoru (kompakt sonic tanimlayici).
 *
 * PAZARLIKSIZ SINIRLAR (F17):
 *   - Calma yolunda (hot path) ASLA calismaz ve UI thread'e DOKUNMAZ; cagri
 *     ayri bir arka plan havuzundan gelir.
 *   - Is SINIRLIDIR: tur basina MAX_BATCH dosya, dosya basina
 *     PER_ITEM_BUDGET_MS duvar-saati butcesi, en cok MAX_ANALYZE_MS ses.
 *   - IPTAL EDILEBILIR: cancelAll() kusagi artirir; calisan dongu bir sonraki
 *     tamponda cikar (yarim sonuc DONMEZ, CANCELLED doner).
 *   - Kalici durum TUTMAZ; onbellek JS tarafindadir (tek kanit deposu).
 *   - MOOD / RUH HALI URETMEZ. Dalga formundan psikolojik bir yorum cikarmak
 *     uydurma olurdu; bu sinif yalniz OLCULEBILENI dondurur.
 *   - Olculemeyen alan null doner: sahte 0 ve sahte BPM YOKTUR.
 *   - Parca adi, etiket veya soz OKUMAZ; yalniz sayisal betimleyici uretir.
 */
public final class SonicAudioAnalyzer {

    private SonicAudioAnalyzer() {}

    /** Tek turda cozumlenecek EN FAZLA dosya - decode pahalidir, batch KUCUKTUR. */
    public static final int MAX_BATCH = 4;
    /** Dosya basina duvar-saati butcesi; asilirsa o dosya TIMEOUT kalir. */
    private static final long PER_ITEM_BUDGET_MS = 4000L;
    /** Analiz edilecek EN FAZLA ses suresi (parcanin tamami DEGIL). */
    private static final int MAX_ANALYZE_MS = 20000;
    /** Anlamli olcum icin gereken EN AZ ses suresi. */
    private static final int MIN_ANALYZE_MS = 4000;
    /** Analiz ornekleme hizi hedefi - decimation ile buraya indirilir. */
    private static final int TARGET_RATE = 11025;
    /** Girisin ilk yuzde INTRO_SKIP_PCT kadari atlanir (intro yaniltmasin). */
    private static final int INTRO_SKIP_PCT = 15;

    private static final int FFT_SIZE = 512;
    private static final int HOP = 256;
    private static final int SPECTRUM_BINS = FFT_SIZE / 2 + 1;
    /** Kompakt tanimlayicinin bant sayisi (log arali). */
    public static final int BAND_COUNT = 8;

    /** Otokorelasyonda aranan tempo araligi - disi olcum sayilmaz. */
    private static final double MIN_BPM = 50.0;
    private static final double MAX_BPM = 200.0;

    private static final double DB_FLOOR = -120.0;

    /** Iptal kusagi - artinca calisan analiz bir sonraki tamponda cikar. */
    private static final AtomicInteger generation = new AtomicInteger(0);

    /** Devam eden tum analizleri iptal eder (kullanici ekrandan cikti vb.). */
    public static void cancelAll() { generation.incrementAndGet(); }

    public static int currentGeneration() { return generation.get(); }

    /* ======================================================================
       1) GIRIS
       ====================================================================== */

    /**
     * Verilen icerik URI'leri icin ses analizini kosar.
     *
     * @return { results: [...], scanned, limited, cancelled, generation }
     */
    public static JSObject analyze(Context ctx, List<String> uris, int maxItems) {
        final int gen = generation.get();
        final int budget = (maxItems <= 0) ? MAX_BATCH : Math.min(MAX_BATCH, maxItems);

        JSArray out = new JSArray();
        int scanned = 0;
        boolean limited = false;
        boolean cancelled = false;

        if (uris != null) {
            for (String raw : uris) {
                if (generation.get() != gen) { cancelled = true; break; }
                if (scanned >= budget) { limited = true; break; }
                if (raw == null || raw.isEmpty()) continue;
                scanned++;
                out.put(analyzeOne(ctx, raw, gen));
            }
        }

        JSObject result = new JSObject();
        result.put("results", out);
        result.put("scanned", scanned);
        result.put("limited", limited);
        result.put("cancelled", cancelled);
        result.put("generation", gen);
        return result;
    }

    private static JSObject analyzeOne(Context ctx, String uri, int gen) {
        JSObject row = new JSObject();
        row.put("uri", uri);

        Decoded decoded;
        try {
            decoded = decodeMono(ctx, uri, System.nanoTime() + PER_ITEM_BUDGET_MS * 1000000L, gen);
        } catch (Throwable t) {
            /* Bozuk dosya, izin, desteklenmeyen kap -> kanit YOK, uydurma YOK. */
            decoded = Decoded.failed("DECODE_FAILED");
        }

        if (decoded.reason != null) return fail(row, decoded.reason);

        final int n = decoded.length;
        final int rate = decoded.rate;
        if (rate <= 0 || n < (MIN_ANALYZE_MS * rate) / 1000) return fail(row, "TOO_SHORT");

        Measurement m = measure(decoded.samples, n, rate);
        if (m == null) return fail(row, "SILENT");

        row.put("analyzed", true);
        row.put("reason", "OK");
        row.put("sampleRate", rate);
        row.put("analyzedMs", (int) ((long) n * 1000L / rate));
        row.put("peakDbfs", round3(m.peakDbfs));
        row.put("rmsDbfs", round3(m.rmsDbfs));
        row.put("crestDb", round3(m.crestDb));
        row.put("zeroCrossingRate", round4(m.zcr));
        row.put("spectralCentroidHz", round2(m.centroidHz));
        row.put("spectralRolloffHz", round2(m.rolloffHz));
        row.put("spectralFlux", round4(m.flux));
        row.put("onsetRate", round4(m.onsetRate));
        row.put("tempoBpm", m.tempoBpm == null ? JSONObject.NULL : round2(m.tempoBpm.doubleValue()));
        row.put("tempoConfidence", round4(m.tempoConfidence));

        JSArray bands = new JSArray();
        /* put(double) JSONException bildirir (NaN/Inf kapısı); değerler zaten
           sonlu ve 0..1 aralığındadır → nesne aşırı yüklemesi kullanılır. */
        for (int i = 0; i < BAND_COUNT; i++) {
            bands.put((Object) Double.valueOf(round4(m.bands[i])));
        }
        row.put("bands", bands);
        return row;
    }

    private static JSObject fail(JSObject row, String reason) {
        row.put("analyzed", false);
        row.put("reason", reason);
        row.put("sampleRate", JSONObject.NULL);
        row.put("analyzedMs", 0);
        row.put("peakDbfs", JSONObject.NULL);
        row.put("rmsDbfs", JSONObject.NULL);
        row.put("crestDb", JSONObject.NULL);
        row.put("zeroCrossingRate", JSONObject.NULL);
        row.put("spectralCentroidHz", JSONObject.NULL);
        row.put("spectralRolloffHz", JSONObject.NULL);
        row.put("spectralFlux", JSONObject.NULL);
        row.put("onsetRate", JSONObject.NULL);
        row.put("tempoBpm", JSONObject.NULL);
        row.put("tempoConfidence", JSONObject.NULL);
        row.put("bands", new JSArray());
        return row;
    }

    /* ======================================================================
       2) DECODE - MediaExtractor + MediaCodec (AOSP; yeni bagimlilik YOK)
       ====================================================================== */

    private static final class Decoded {
        float[] samples; int length; int rate; String reason;
        static Decoded failed(String r) { Decoded d = new Decoded(); d.reason = r; return d; }
    }

    private static Decoded decodeMono(Context ctx, String uri, long deadlineNs, int gen) {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        Decoded result = new Decoded();

        try {
            extractor.setDataSource(ctx, Uri.parse(uri), null);

            int track = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String m = f.getString(MediaFormat.KEY_MIME);
                if (m != null && m.startsWith("audio/")) { track = i; format = f; break; }
            }
            if (track < 0 || format == null) return Decoded.failed("NO_AUDIO_TRACK");

            int inRate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE)
                ? format.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 0;
            int channels = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                ? format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 1;
            if (inRate <= 0 || channels <= 0) return Decoded.failed("UNSUPPORTED_CODEC");

            long durationUs = format.containsKey(MediaFormat.KEY_DURATION)
                ? format.getLong(MediaFormat.KEY_DURATION) : 0L;

            extractor.selectTrack(track);
            if (durationUs > (long) MIN_ANALYZE_MS * 2000L) {
                extractor.seekTo((durationUs * INTRO_SKIP_PCT) / 100L,
                    MediaExtractor.SEEK_TO_CLOSEST_SYNC);
            }

            String mime = format.getString(MediaFormat.KEY_MIME);
            try {
                codec = MediaCodec.createDecoderByType(mime);
                codec.configure(format, null, null, 0);
                codec.start();
            } catch (Throwable t) {
                return Decoded.failed("UNSUPPORTED_CODEC");
            }

            /* Decimation: giris hizi hedefe indirilir (kutu ortalamasi ile). */
            int factor = Math.max(1, Math.round((float) inRate / (float) TARGET_RATE));
            int outRate = Math.max(1, inRate / factor);
            int maxSamples = Math.max(1, (MAX_ANALYZE_MS * outRate) / 1000);
            float[] mono = new float[maxSamples];
            int written = 0;

            double boxSum = 0.0;
            int boxCount = 0;
            int pcmEncoding = AudioFormat.ENCODING_PCM_16BIT;

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean outputDone = false;
            boolean timedOut = false;
            boolean cancelled = false;

            while (!outputDone) {
                if (System.nanoTime() > deadlineNs) { timedOut = true; break; }
                if (generation.get() != gen) { cancelled = true; break; }

                if (!inputDone) {
                    int inIdx = codec.dequeueInputBuffer(2000L);
                    if (inIdx >= 0) {
                        ByteBuffer inBuf = codec.getInputBuffer(inIdx);
                        int size = (inBuf == null) ? -1 : extractor.readSampleData(inBuf, 0);
                        if (size < 0) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0L,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            codec.queueInputBuffer(inIdx, 0, size, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }

                int outIdx = codec.dequeueOutputBuffer(info, 2000L);
                if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = codec.getOutputFormat();
                    if (written == 0) {
                        if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                            channels = Math.max(1, of.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
                        }
                        if (of.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                            int r = of.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                            if (r > 0 && r != inRate) {
                                inRate = r;
                                factor = Math.max(1, Math.round((float) inRate / (float) TARGET_RATE));
                                outRate = Math.max(1, inRate / factor);
                                maxSamples = Math.max(1, (MAX_ANALYZE_MS * outRate) / 1000);
                                mono = new float[maxSamples];
                            }
                        }
                    }
                    if (of.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                        pcmEncoding = of.getInteger(MediaFormat.KEY_PCM_ENCODING);
                    }
                    continue;
                }
                if (outIdx < 0) continue;

                if (info.size > 0) {
                    ByteBuffer outBuf = codec.getOutputBuffer(outIdx);
                    if (outBuf != null) {
                        outBuf.position(info.offset);
                        outBuf.limit(info.offset + info.size);
                        ByteBuffer view = outBuf.slice().order(ByteOrder.nativeOrder());

                        if (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT) {
                            java.nio.FloatBuffer fb = view.asFloatBuffer();
                            int frames = fb.remaining() / channels;
                            for (int f = 0; f < frames && written < maxSamples; f++) {
                                double acc = 0.0;
                                for (int c = 0; c < channels; c++) acc += fb.get();
                                boxSum += acc / channels;
                                if (++boxCount == factor) {
                                    mono[written++] = (float) (boxSum / factor);
                                    boxSum = 0.0; boxCount = 0;
                                }
                            }
                        } else {
                            java.nio.ShortBuffer sb = view.asShortBuffer();
                            int frames = sb.remaining() / channels;
                            for (int f = 0; f < frames && written < maxSamples; f++) {
                                int acc = 0;
                                for (int c = 0; c < channels; c++) acc += sb.get();
                                boxSum += (acc / (double) channels) / 32768.0;
                                if (++boxCount == factor) {
                                    mono[written++] = (float) (boxSum / factor);
                                    boxSum = 0.0; boxCount = 0;
                                }
                            }
                        }
                    }
                }
                codec.releaseOutputBuffer(outIdx, false);

                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                if (written >= maxSamples) outputDone = true;
            }

            if (cancelled) return Decoded.failed("CANCELLED");
            if (written == 0) return Decoded.failed(timedOut ? "TIMEOUT" : "DECODE_FAILED");
            /* Zaman asimi olsa bile ELDEKI ses yeterliyse olcum GERCEKTIR. */
            if (written < (MIN_ANALYZE_MS * outRate) / 1000) {
                return Decoded.failed(timedOut ? "TIMEOUT" : "TOO_SHORT");
            }

            result.samples = mono;
            result.length = written;
            result.rate = outRate;
            return result;
        } catch (Throwable t) {
            return Decoded.failed("DECODE_FAILED");
        } finally {
            if (codec != null) {
                try { codec.stop(); } catch (Throwable ignored) {}
                try { codec.release(); } catch (Throwable ignored) {}
            }
            try { extractor.release(); } catch (Throwable ignored) {}
        }
    }

    /* ======================================================================
       3) OLCUM - yalniz dalga formundan; hicbir yorum EKLENMEZ
       ====================================================================== */

    static final class Measurement {
        double peakDbfs, rmsDbfs, crestDb, zcr, centroidHz, rolloffHz, flux, onsetRate;
        Double tempoBpm; double tempoConfidence;
        double[] bands = new double[BAND_COUNT];
    }

    static Measurement measure(float[] x, int n, int rate) {
        double peak = 0.0;
        double sumSq = 0.0;
        int crossings = 0;
        for (int i = 0; i < n; i++) {
            double v = x[i];
            double a = Math.abs(v);
            if (a > peak) peak = a;
            sumSq += v * v;
            if (i > 0 && ((x[i - 1] < 0f && x[i] >= 0f) || (x[i - 1] >= 0f && x[i] < 0f))) crossings++;
        }
        double rms = Math.sqrt(sumSq / n);
        /* Tam sessizlik olcum DEGILDIR: sahte "0 enerji" kaniti uretmeyiz. */
        if (!(rms > 1e-6)) return null;

        Measurement m = new Measurement();
        m.peakDbfs = toDb(peak);
        m.rmsDbfs = toDb(rms);
        m.crestDb = m.peakDbfs - m.rmsDbfs;
        m.zcr = (double) crossings / n;

        /* STFT: 512 nokta Hann, hop 256. */
        int frames = (n - FFT_SIZE) / HOP + 1;
        if (frames < 8) return null;

        double[] window = hann(FFT_SIZE);
        double[] re = new double[FFT_SIZE];
        double[] im = new double[FFT_SIZE];
        double[] mag = new double[SPECTRUM_BINS];
        double[] prev = new double[SPECTRUM_BINS];
        double[] onset = new double[frames];
        double[] bandAcc = new double[BAND_COUNT];
        int[] bandEdge = logBandEdges(rate);

        double centroidAcc = 0.0, rolloffAcc = 0.0, fluxAcc = 0.0;
        int spectralFrames = 0;

        for (int f = 0; f < frames; f++) {
            int off = f * HOP;
            for (int i = 0; i < FFT_SIZE; i++) { re[i] = x[off + i] * window[i]; im[i] = 0.0; }
            fft(re, im);

            double magSum = 0.0, weighted = 0.0, flux = 0.0;
            for (int k = 0; k < SPECTRUM_BINS; k++) {
                double v = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
                mag[k] = v;
                magSum += v;
                weighted += v * ((double) k * rate / FFT_SIZE);
                double d = v - prev[k];
                if (d > 0) flux += d;
            }
            if (magSum > 1e-9) {
                centroidAcc += weighted / magSum;
                rolloffAcc += rolloff(mag, magSum, rate, 0.85);
                for (int b = 0; b < BAND_COUNT; b++) {
                    double acc = 0.0;
                    for (int k = bandEdge[b]; k < bandEdge[b + 1]; k++) acc += mag[k];
                    bandAcc[b] += acc;
                }
                spectralFrames++;
            }
            onset[f] = flux;
            fluxAcc += flux;
            System.arraycopy(mag, 0, prev, 0, SPECTRUM_BINS);
        }
        if (spectralFrames < 8) return null;

        m.centroidHz = centroidAcc / spectralFrames;
        m.rolloffHz = rolloffAcc / spectralFrames;
        m.flux = fluxAcc / frames;

        double bandTotal = 0.0;
        for (int b = 0; b < BAND_COUNT; b++) bandTotal += bandAcc[b];
        for (int b = 0; b < BAND_COUNT; b++) {
            m.bands[b] = bandTotal > 1e-9 ? bandAcc[b] / bandTotal : 0.0;
        }

        /* Tempo: onset zarfinin otokorelasyonu. */
        double envRate = (double) rate / HOP;
        Tempo tempo = estimateTempo(onset, frames, envRate);
        m.tempoBpm = tempo.bpm;
        m.tempoConfidence = tempo.confidence;
        m.onsetRate = tempo.onsetRate;
        return m;
    }

    static final class Tempo { Double bpm; double confidence; double onsetRate; }

    /**
     * Onset zarfindan tempo kestirimi.
     *
     * Zarf yerel ortalamadan aritilir (yarim-dalga dogrultma), sonra 50-200 BPM
     * araligindaki gecikmelerde normalize otokorelasyon aranir. Tepe belirgin
     * degilse guven DUSUKTUR; JS tarafi esigin altini "tempo yok" sayar - zayif
     * bir tepe "tempo bulundu" demek DEGILDIR (uydurma BPM yasagi).
     */
    static Tempo estimateTempo(double[] onset, int frames, double envRate) {
        Tempo out = new Tempo();
        out.bpm = null;
        out.confidence = 0.0;
        out.onsetRate = 0.0;
        if (frames < 32 || envRate <= 0) return out;

        int w = Math.max(3, (int) Math.round(envRate * 0.5));
        double[] d = new double[frames];
        double mean = 0.0;
        for (int i = 0; i < frames; i++) {
            int a = Math.max(0, i - w), b = Math.min(frames - 1, i + w);
            double s = 0.0;
            for (int j = a; j <= b; j++) s += onset[j];
            double local = s / (b - a + 1);
            d[i] = Math.max(0.0, onset[i] - local);
            mean += d[i];
        }
        mean /= frames;
        if (!(mean > 1e-9)) return out;

        int peaks = 0;
        for (int i = 1; i < frames - 1; i++) {
            if (d[i] > d[i - 1] && d[i] >= d[i + 1] && d[i] > mean * 1.5) peaks++;
        }
        out.onsetRate = peaks / (frames / envRate);

        int minLag = (int) Math.floor(envRate * 60.0 / MAX_BPM);
        int maxLag = (int) Math.ceil(envRate * 60.0 / MIN_BPM);
        if (minLag < 2) minLag = 2;
        if (maxLag >= frames / 2) maxLag = frames / 2 - 1;
        if (maxLag <= minLag) return out;

        double energy = 0.0;
        for (int i = 0; i < frames; i++) energy += d[i] * d[i];
        if (!(energy > 1e-12)) return out;

        double bestScore = 0.0;
        int bestLag = -1;
        double scoreSum = 0.0;
        int scoreCount = 0;
        for (int lag = minLag; lag <= maxLag; lag++) {
            double acc = 0.0;
            for (int i = 0; i + lag < frames; i++) acc += d[i] * d[i + lag];
            double norm = acc / energy;
            scoreSum += norm;
            scoreCount++;
            if (norm > bestScore) { bestScore = norm; bestLag = lag; }
        }
        if (bestLag < 0 || scoreCount == 0) return out;

        double avg = scoreSum / scoreCount;
        /* Guven = tepenin ortalamaya gore BELIRGINLIGI (0..1'e sikistirilir). */
        double prominence = (bestScore + avg > 1e-9) ? (bestScore - avg) / (bestScore + avg) : 0.0;
        out.confidence = Math.max(0.0, Math.min(1.0, prominence));
        out.bpm = Double.valueOf(60.0 * envRate / bestLag);
        return out;
    }

    /* ======================================================================
       4) YARDIMCILAR - saf sayisal
       ====================================================================== */

    private static double toDb(double linear) {
        if (!(linear > 0.0)) return DB_FLOOR;
        double db = 20.0 * Math.log10(linear);
        return db < DB_FLOOR ? DB_FLOOR : db;
    }

    private static double rolloff(double[] mag, double magSum, int rate, double pct) {
        double target = magSum * pct;
        double acc = 0.0;
        for (int k = 0; k < SPECTRUM_BINS; k++) {
            acc += mag[k];
            if (acc >= target) return (double) k * rate / FFT_SIZE;
        }
        return (double) rate / 2.0;
    }

    private static double[] hann(int size) {
        double[] w = new double[size];
        for (int i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos(2.0 * Math.PI * i / (size - 1));
        return w;
    }

    /** Log arali bant kenarlari (bin indeksleri) - kompakt tanimlayici icin. */
    private static int[] logBandEdges(int rate) {
        int[] edges = new int[BAND_COUNT + 1];
        double lo = 40.0;
        double hi = Math.min(rate / 2.0, 5000.0);
        if (hi <= lo) hi = lo * 2.0;
        for (int b = 0; b <= BAND_COUNT; b++) {
            double hz = lo * Math.pow(hi / lo, (double) b / BAND_COUNT);
            int bin = (int) Math.round(hz * FFT_SIZE / rate);
            edges[b] = Math.max(0, Math.min(SPECTRUM_BINS - 1, bin));
        }
        for (int b = 1; b <= BAND_COUNT; b++) {
            if (edges[b] <= edges[b - 1]) {
                edges[b] = Math.min(SPECTRUM_BINS, edges[b - 1] + 1);
            }
        }
        return edges;
    }

    /** Yerinde radix-2 FFT (uzunluk 2'nin kuvveti olmali). */
    static void fft(double[] re, double[] im) {
        final int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                double tr = re[i]; re[i] = re[j]; re[j] = tr;
                double ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (int len = 2; len <= n; len <<= 1) {
            double ang = -2.0 * Math.PI / len;
            double wr = Math.cos(ang), wi = Math.sin(ang);
            for (int i = 0; i < n; i += len) {
                double cr = 1.0, ci = 0.0;
                for (int k = 0; k < len / 2; k++) {
                    int a = i + k, b = i + k + len / 2;
                    double xr = re[b] * cr - im[b] * ci;
                    double xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr;        im[a] += xi;
                    double nr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = nr;
                }
            }
        }
    }

    private static double round2(double v) { return Math.round(v * 100.0) / 100.0; }
    private static double round3(double v) { return Math.round(v * 1000.0) / 1000.0; }
    private static double round4(double v) { return Math.round(v * 10000.0) / 10000.0; }
}
