package com.cockpitos.pro.ota;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Map;

/**
 * OtaDownloadManager — OTA v1 / Commit 4: güvenli APK indirme + SHA-256 doğrulama.
 *
 * Akış (fail-fast, her hata kodlu):
 *   1. Girdi doğrulama (url https, sha256 64-hex, size>0, fileName traversal-red)
 *   2. Bayat .tmp temizliği (yarım indirmeler)
 *   3. Disk kontrolü: usableSpace >= expectedSize * 2
 *   4. Streaming indirme → files/ota/{fileName}.tmp (64KB buffer, RAM'e
 *      KOMPLE ALINMAZ) + eş-zamanlı MessageDigest SHA-256
 *   5. Boyut eşleşmedi → tmp SİL + ERR_SIZE; aşım anında kes (sunucuya güven yok)
 *   6. Hash eşleşmedi → tmp SİL + ERR_HASH
 *   7. Ancak doğrulama SONRASI .tmp → .apk rename (atomik teslim)
 *
 * Güvenlik:
 *   - Servis-rol anahtarı CİHAZDA YOK: çağıran (JS) anon-key header'larını
 *     geçirir (CarLauncherForegroundService heartbeat deseniyle aynı sınıf erişim).
 *   - Kurulum BU SINIFTA YOK (Commit 5) — yalnız indirme + doğrulama.
 */
public final class OtaDownloadManager {

    private static final String TAG = "OtaDownload";
    private static final int  BUFFER_SIZE        = 64 * 1024;
    private static final int  CONNECT_TIMEOUT_MS = 15_000;
    private static final int  READ_TIMEOUT_MS    = 30_000;
    /** Progress bildirimi en az bu kadar bayt arayla (UI köprüsünü boğma) */
    private static final long PROGRESS_STEP_BYTES = 256 * 1024;

    private OtaDownloadManager() {}

    public interface ProgressListener {
        void onProgress(long downloadedBytes, long totalBytes, int percent);
    }

    /** downloadOtaApk dönüş sözleşmesi (JS OtaDownloadResult ile birebir). */
    public static final class Result {
        public final boolean ok;
        public final String  path;
        public final String  sha256;
        public final long    size;
        public final String  errorCode;
        public final String  errorMessage;

        private Result(boolean ok, String path, String sha256, long size,
                       String errorCode, String errorMessage) {
            this.ok = ok; this.path = path; this.sha256 = sha256; this.size = size;
            this.errorCode = errorCode; this.errorMessage = errorMessage;
        }
        static Result success(String path, String sha256, long size) {
            return new Result(true, path, sha256, size, null, null);
        }
        static Result fail(String code, String message) {
            Log.w(TAG, code + ": " + message);
            return new Result(false, null, null, 0, code, message);
        }
    }

    /** OTA çalışma dizini: files/ota/ (FileProvider file_paths.xml ile uyumlu). */
    public static File otaDir(Context ctx) {
        File dir = new File(ctx.getFilesDir(), "ota");
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "ota dizini oluşturulamadı: " + dir);
        }
        return dir;
    }

    /**
     * Yarım indirme temizliği — yeni indirme başında (ve Commit 6'da boot'ta)
     * çağrılır. Yalnız .tmp uzantılıları siler; doğrulanmış .apk korunur.
     */
    public static void cleanupStaleTmp(Context ctx) {
        File[] files = otaDir(ctx).listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.getName().endsWith(".tmp") && f.delete()) {
                Log.i(TAG, "Bayat tmp silindi: " + f.getName());
            }
        }
    }

    /** fileName güvenliği: traversal / ayraç / gizli dosya reddi. */
    static boolean isSafeFileName(String name) {
        return name != null
            && !name.isEmpty()
            && name.matches("[A-Za-z0-9][A-Za-z0-9._-]*")
            && !name.contains("..");
    }

    /**
     * Streaming indirme + doğrulama. ARKA PLAN THREAD'İNDE çağrılmalı
     * (CarLauncherPlugin executor'u) — ağ + disk I/O, UI bloklamaz.
     */
    public static Result download(Context ctx, String urlStr, String expectedSha256,
                                  long expectedSize, String fileName,
                                  Map<String, String> headers, ProgressListener listener) {
        // ── 1. Girdi doğrulama (JS wrapper'la aynı kurallar — defense-in-depth)
        if (urlStr == null || !urlStr.startsWith("https://")) {
            return Result.fail("ERR_INPUT", "url https:// olmalı");
        }
        if (expectedSha256 == null || !expectedSha256.matches("[0-9a-fA-F]{64}")) {
            return Result.fail("ERR_INPUT", "expectedSha256 64-hex olmalı");
        }
        if (expectedSize <= 0) {
            return Result.fail("ERR_INPUT", "expectedSize > 0 olmalı");
        }
        if (!isSafeFileName(fileName)) {
            return Result.fail("ERR_INPUT", "Geçersiz fileName (path traversal/ayraç reddi): " + fileName);
        }

        File dir = otaDir(ctx);
        cleanupStaleTmp(ctx);

        // ── 2. Disk alanı: en az expectedSize * 2 (tmp + rename payı)
        long usable = dir.getUsableSpace();
        if (usable < expectedSize * 2) {
            return Result.fail("ERR_DISK",
                "Yetersiz disk: " + usable + "B var, " + (expectedSize * 2) + "B gerekli");
        }

        File tmpFile   = new File(dir, fileName + ".tmp");
        File finalFile = new File(dir, fileName);
        HttpURLConnection conn = null;

        try {
            // ── 3. Bağlantı (anon-key header'ları çağırandan — servis-rol anahtarı YOK)
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            if (headers != null) {
                for (Map.Entry<String, String> h : headers.entrySet()) {
                    conn.setRequestProperty(h.getKey(), h.getValue());
                }
            }
            int status = conn.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                return Result.fail("ERR_HTTP", "HTTP " + status);
            }

            // ── 4. Streaming: ağ → digest → tmp dosya (RAM'e komple alınmaz)
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long downloaded = 0;
            long lastNotify = 0;
            byte[] buffer = new byte[BUFFER_SIZE];

            try (InputStream in = conn.getInputStream();
                 FileOutputStream out = new FileOutputStream(tmpFile)) {
                int n;
                while ((n = in.read(buffer)) > 0) {
                    downloaded += n;
                    if (downloaded > expectedSize) {
                        // Sunucu beklenenden fazla gönderiyor — anında kes (güven yok)
                        tmpFile.delete();
                        return Result.fail("ERR_SIZE",
                            "Boyut aşımı: beklenen " + expectedSize + "B aşıldı");
                    }
                    out.write(buffer, 0, n);
                    digest.update(buffer, 0, n);
                    if (listener != null && downloaded - lastNotify >= PROGRESS_STEP_BYTES) {
                        lastNotify = downloaded;
                        listener.onProgress(downloaded, expectedSize,
                            (int) (downloaded * 100 / expectedSize));
                    }
                }
            }

            // ── 5. Boyut doğrulama
            if (downloaded != expectedSize) {
                tmpFile.delete();
                return Result.fail("ERR_SIZE",
                    "Boyut uyuşmazlığı: beklenen " + expectedSize + "B, inen " + downloaded + "B");
            }

            // ── 6. Hash doğrulama — eşleşmezse tmp SİLİNİR
            String actual = toHex(digest.digest());
            if (!actual.equalsIgnoreCase(expectedSha256)) {
                tmpFile.delete();
                return Result.fail("ERR_HASH",
                    "SHA-256 uyuşmazlığı: beklenen " + expectedSha256 + ", hesaplanan " + actual);
            }

            // ── 7. Atomik teslim: doğrulama SONRASI .tmp → .apk
            if (finalFile.exists() && !finalFile.delete()) {
                tmpFile.delete();
                return Result.fail("ERR_RENAME", "Eski APK silinemedi: " + finalFile);
            }
            if (!tmpFile.renameTo(finalFile)) {
                tmpFile.delete();
                return Result.fail("ERR_RENAME", "tmp → apk rename başarısız");
            }

            if (listener != null) listener.onProgress(downloaded, expectedSize, 100);
            Log.i(TAG, "OTA indirme OK: " + finalFile + " (" + downloaded + "B)");
            return Result.success(finalFile.getAbsolutePath(),
                actual.toLowerCase(Locale.ROOT), downloaded);

        } catch (Exception e) {
            tmpFile.delete(); // her hata yolunda yarım dosya bırakma
            return Result.fail("ERR_IO",
                e.getClass().getSimpleName() + ": " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }
}
