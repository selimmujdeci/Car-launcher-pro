package com.cockpitos.pro.voice;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Çevrim dışı Türkçe ses modelini (Piper / sherpa-onnx) BİR KEZ indirir, doğrular, kurar.
 *
 * Neden: bazı head-unit'lerde (Megane / NWD K2401, saha 2026-10-02) hiç TTS motoru yok
 * ("No services found") → Mavi ve navigasyon susuyordu. CarOS kendi sesini taşır; APK
 * şişmesin diye model (~20 MB) APK'da değil, ilk internet bağlantısında iner.
 *
 * Güvenlik/doğruluk:
 *  - Sabit sürüm adresi + SHA-256 — uyuşmazsa kurulmaz (sahte "hazır" yok).
 *  - Paket dışına yazma engellenir (path traversal).
 *  - Kurulum atomik: geçici klasöre açılır, işaret dosyası en son yazılır.
 */
public final class OfflineTtsInstaller {

    private static final String TAG = "OfflineTts";

    /** Seçilen ses. Değiştirmek için yalnız bu sabit (+ SHA) güncellenir. */
    public static final VoiceSpec VOICE = new VoiceSpec(
        "tr_TR-fahrettin-medium-int8",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-tr_TR-fahrettin-medium-int8.tar.bz2",
        "9897e4da7f26be2bd03dc920d9c698634060832cbdb18b7d2908728db1465089",
        "tr_TR-fahrettin-medium.onnx");

    public static final class VoiceSpec {
        public final String id, url, sha256, modelFile;
        public VoiceSpec(String id, String url, String sha256, String modelFile) {
            this.id = id; this.url = url; this.sha256 = sha256; this.modelFile = modelFile;
        }
    }

    public enum State { ABSENT, WAITING_NETWORK, DOWNLOADING, INSTALLING, READY, ERROR }

    public interface Listener { void onState(State state, int progressPct, String detail); }

    static final String MARKER = "INSTALLED";
    private static final long[] RETRY_MS = { 30_000, 120_000, 600_000 };

    private final Context ctx;
    private final VoiceSpec voice;
    private final Listener listener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> new Thread(r, "offline-tts-install"));
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile State state = State.ABSENT;
    private volatile int progress = 0;
    private volatile String detail = "";
    private volatile boolean running = false;
    private int failures = 0;
    private ConnectivityManager.NetworkCallback netCb = null;

    public OfflineTtsInstaller(Context ctx, VoiceSpec voice, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.voice = voice;
        this.listener = listener;
        if (isInstalled(voiceDir(), voice)) setState(State.READY, 100, "");
    }

    public State state() { return state; }
    public int progress() { return progress; }
    public String detail() { return detail; }
    public VoiceSpec voice() { return voice; }

    public File voiceDir() { return new File(new File(ctx.getFilesDir(), "tts"), voice.id); }
    public File modelFile() { return new File(voiceDir(), voice.modelFile); }
    public File tokensFile() { return new File(voiceDir(), "tokens.txt"); }
    public File espeakDir() { return new File(voiceDir(), "espeak-ng-data"); }

    public boolean isInstalled() { return state == State.READY && isInstalled(voiceDir(), voice); }

    /** Kurulu değilse arka planda indir+kur. Tekrar çağrılması güvenli. */
    public synchronized void ensureInstalledAsync() {
        if (state == State.READY || running) return;
        running = true;
        worker.execute(this::runInstall);
    }

    private void runInstall() {
        try {
            if (isInstalled(voiceDir(), voice)) { setState(State.READY, 100, ""); return; }
            if (!hasNetwork()) {
                setState(State.WAITING_NETWORK, 0, "");
                waitForNetwork();
                return;
            }
            File tmp = new File(ctx.getCacheDir(), voice.id + ".tar.bz2.part");
            String sha = download(voice.url, tmp);
            if (!voice.sha256.equalsIgnoreCase(sha)) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                throw new IOException("SHA-256 uyuşmadı");
            }
            setState(State.INSTALLING, 100, "");
            File staging = new File(voiceDir().getParentFile(), voice.id + ".staging");
            deleteRecursive(staging);
            try (InputStream in = new BufferedInputStream(new FileInputStream(tmp))) {
                extractTarBz2(in, staging);
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            if (!new File(staging, voice.modelFile).isFile() || !new File(staging, "tokens.txt").isFile()
                    || !new File(staging, "espeak-ng-data").isDirectory()) {
                throw new IOException("paket eksik");
            }
            writeText(new File(staging, MARKER), voice.sha256);
            deleteRecursive(voiceDir());
            if (!staging.renameTo(voiceDir())) throw new IOException("kurulum taşınamadı");
            failures = 0;
            setState(State.READY, 100, "");
            Log.i(TAG, "Çevrim dışı ses kuruldu: " + voice.id);
        } catch (Throwable t) {
            Log.w(TAG, "Çevrim dışı ses kurulamadı: " + t.getMessage());
            setState(State.ERROR, progress, String.valueOf(t.getMessage()));
            scheduleRetry();
        } finally {
            running = false;
        }
    }

    private String download(String url, File out) throws Exception {
        setState(State.DOWNLOADING, 0, "");
        File parent = out.getParentFile();
        if (parent != null) //noinspection ResultOfMethodCallIgnored
            parent.mkdirs();
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(20_000);
        c.setReadTimeout(30_000);
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            long total = c.getContentLengthLong();
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long done = 0;
            int lastPct = -1;
            byte[] buf = new byte[64 * 1024];
            try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                int n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    md.update(buf, 0, n);
                    done += n;
                    if (total > 0) {
                        int pct = (int) (done * 100 / total);
                        if (pct != lastPct) { lastPct = pct; setState(State.DOWNLOADING, pct, ""); }
                    }
                }
            }
            return hex(md.digest());
        } finally {
            c.disconnect();
        }
    }

    private boolean hasNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            return cm != null && cm.getActiveNetwork() != null;
        } catch (Throwable t) { return true; } // ölçülemezse denemek zararsız
    }

    private synchronized void waitForNetwork() {
        if (netCb != null) return;
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            netCb = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) {
                    unregisterNet();
                    ensureInstalledAsync();
                }
            };
            cm.registerDefaultNetworkCallback(netCb);
        } catch (Throwable t) {
            netCb = null;
            scheduleRetry();
        }
    }

    private synchronized void unregisterNet() {
        if (netCb == null) return;
        try {
            ((ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE)).unregisterNetworkCallback(netCb);
        } catch (Throwable ignored) {}
        netCb = null;
    }

    private void scheduleRetry() {
        long delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
        failures++;
        main.postDelayed(this::ensureInstalledAsync, delay);
    }

    private void setState(State s, int pct, String d) {
        state = s; progress = pct; detail = d == null ? "" : d;
        if (listener != null) {
            try { listener.onState(s, pct, detail); } catch (Throwable ignored) {}
        }
    }

    /* ── Saf yardımcılar (JUnit) ───────────────────────────────────────── */

    /** Kurulum tam ve doğru sürümse true. */
    static boolean isInstalled(File dir, VoiceSpec v) {
        File marker = new File(dir, MARKER);
        if (!marker.isFile()) return false;
        try {
            String sha = readText(marker).trim();
            return v.sha256.equalsIgnoreCase(sha)
                && new File(dir, v.modelFile).isFile()
                && new File(dir, "tokens.txt").isFile()
                && new File(dir, "espeak-ng-data").isDirectory();
        } catch (IOException e) {
            return false;
        }
    }

    /**
     * tar.bz2 paketini destDir'e açar. Paketteki tek üst klasör (ör.
     * "vits-piper-…-int8/") atılır. Klasör dışına yazmaya çalışan girdi reddedilir.
     */
    static void extractTarBz2(InputStream in, File destDir) throws IOException {
        //noinspection ResultOfMethodCallIgnored
        destDir.mkdirs();
        String root = destDir.getCanonicalPath() + File.separator;
        try (TarArchiveInputStream tar = new TarArchiveInputStream(new BZip2CompressorInputStream(in))) {
            TarArchiveEntry e;
            byte[] buf = new byte[64 * 1024];
            while ((e = tar.getNextEntry()) != null) {
                String name = stripTopDir(e.getName());
                if (name.isEmpty()) continue;
                File f = new File(destDir, name);
                if (!f.getCanonicalPath().startsWith(root)) {
                    throw new IOException("paket dışına yazma girişimi: " + e.getName());
                }
                if (e.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.mkdirs();
                } else if (e.isFile()) {
                    File p = f.getParentFile();
                    if (p != null) //noinspection ResultOfMethodCallIgnored
                        p.mkdirs();
                    try (OutputStream os = new FileOutputStream(f)) {
                        int n;
                        while ((n = tar.read(buf)) > 0) os.write(buf, 0, n);
                    }
                }
                // sembolik bağ vb. atlanır
            }
        }
    }

    static String stripTopDir(String name) {
        String n = name.replace('\\', '/');
        while (n.startsWith("./")) n = n.substring(2);
        int i = n.indexOf('/');
        return i < 0 ? "" : n.substring(i + 1);
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static void writeText(File f, String s) throws IOException {
        try (OutputStream os = new FileOutputStream(f)) { os.write(s.getBytes(StandardCharsets.UTF_8)); }
    }

    private static String readText(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) Math.min(f.length(), 4096)];
            int n = in.read(b);
            return n <= 0 ? "" : new String(b, 0, n, StandardCharsets.UTF_8);
        }
    }
}
