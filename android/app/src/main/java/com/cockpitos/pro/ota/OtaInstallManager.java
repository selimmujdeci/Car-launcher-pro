package com.cockpitos.pro.ota;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import java.io.File;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * OtaInstallManager — OTA v1 / Commit 5: güvenli kurulum kapısı.
 *
 * SESSİZ KURULUM YOK ve DENENMEZ: root'suz, platform-imzasız normal APK'da
 * kurulum her zaman Android sistem diyaloğundan geçer (kullanıcı onayı).
 * Bu sınıf yalnız "kapı bekçisi"dir — sistem ekranı açılmadan ÖNCE:
 *
 *   1. fileName güvenliği (traversal reddi) + dosya files/ota altında mı
 *      (canonical path containment — symlink/.. kaçışı imkânsız)
 *   2. İzin: canRequestPackageInstalls() yoksa
 *      ACTION_MANAGE_UNKNOWN_APP_SOURCES ayarına yönlendirir (action:
 *      settings_opened) — çağıran kullanıcı dönünce yeniden dener
 *   3. APK kimliği: packageName == bizimki (farklı paket REDDET)
 *   4. Sürüm: archiveVersionCode > kurulu (downgrade REDDET — Android da
 *      reddeder ama kullanıcıya diyalog göstermeden biz keseriz)
 *   5. İmza: arşivin imza sertifikası SHA-256'ları kurulu uygulamanınkiyle
 *      AYNI SET olmalı (farklı imza REDDET — sistem de reddeder, erken kes)
 *
 * Hepsi geçerse: FileProvider content-URI + ACTION_VIEW +
 * FLAG_GRANT_READ_URI_PERMISSION ile sistem kurulum ekranı (action:
 * install_prompted). İndirme mantığına DOKUNMAZ (OtaDownloadManager ayrı).
 */
public final class OtaInstallManager {

    private static final String TAG = "OtaInstall";
    private static final String APK_MIME = "application/vnd.android.package-archive";

    private OtaInstallManager() {}

    /** installOtaApk dönüş sözleşmesi (JS OtaInstallResult ile birebir). */
    public static final class Result {
        public final boolean ok;
        public final String  action;        // install_prompted | settings_opened | null
        public final String  errorCode;
        public final String  errorMessage;

        private Result(boolean ok, String action, String errorCode, String errorMessage) {
            this.ok = ok; this.action = action;
            this.errorCode = errorCode; this.errorMessage = errorMessage;
        }
        static Result prompted() {
            return new Result(true, "install_prompted", null, null);
        }
        static Result settingsOpened() {
            return new Result(false, "settings_opened", "ERR_NO_PERMISSION",
                "Bilinmeyen kaynak izni yok — ayar ekranı açıldı, izin sonrası yeniden dene");
        }
        static Result fail(String code, String message) {
            Log.w(TAG, code + ": " + message);
            return new Result(false, null, code, message);
        }
    }

    /** Hash-doğrulanmış APK için sistem kurulum akışını başlatır. */
    public static Result install(Context ctx, String fileName) {
        // ── 1. Dosya güvenliği: ad + konum (files/ota dışına çıkış imkânsız)
        if (!OtaDownloadManager.isSafeFileName(fileName)) {
            return Result.fail("ERR_INPUT",
                "Geçersiz fileName (path traversal/ayraç reddi): " + fileName);
        }
        File apk = new File(OtaDownloadManager.otaDir(ctx), fileName);
        try {
            String apkCanonical = apk.getCanonicalPath();
            String dirCanonical = OtaDownloadManager.otaDir(ctx).getCanonicalPath() + File.separator;
            if (!apkCanonical.startsWith(dirCanonical)) {
                return Result.fail("ERR_INPUT", "APK files/ota dışında: " + apkCanonical);
            }
        } catch (Exception e) {
            return Result.fail("ERR_IO", "Canonical path çözülemedi: " + e.getMessage());
        }
        if (!apk.exists() || !apk.isFile()) {
            return Result.fail("ERR_NOT_FOUND", "APK bulunamadı: " + apk.getName());
        }

        // ── 2. Bilinmeyen-kaynak kurulum izni (API 26+; minSdk 24 guard)
        PackageManager pm = ctx.getPackageManager();
        if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + ctx.getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(settings);
                return Result.settingsOpened();
            } catch (Exception e) {
                // OEM ROM ayar ekranını gizlemiş olabilir (bilinen K24 riski)
                return Result.fail("ERR_NO_PERMISSION",
                    "Bilinmeyen kaynak izni yok ve ayar ekranı açılamadı: " + e.getMessage());
            }
        }

        // ── 3-5. APK kimlik/sürüm/imza ön-kontrolleri (sistem diyaloğundan ÖNCE)
        try {
            int archiveFlags = Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
            PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), archiveFlags);
            if (archive == null) {
                return Result.fail("ERR_BAD_APK", "APK parse edilemedi (bozuk arşiv?)");
            }

            // 3. packageName eşleşmesi — farklı paket REDDET
            String ownPackage = ctx.getPackageName();
            if (!ownPackage.equals(archive.packageName)) {
                return Result.fail("ERR_PACKAGE",
                    "Paket uyuşmazlığı: beklenen " + ownPackage + ", arşiv " + archive.packageName);
            }

            // 4. versionCode — downgrade REDDET
            PackageInfo current = pm.getPackageInfo(ownPackage, archiveFlags);
            long archiveCode = versionCodeOf(archive);
            long currentCode = versionCodeOf(current);
            if (archiveCode <= currentCode) {
                return Result.fail("ERR_DOWNGRADE",
                    "Downgrade reddi: arşiv vc=" + archiveCode + " <= kurulu vc=" + currentCode);
            }

            // 5. İmza sertifikası — farklı imza REDDET
            Set<String> archiveSigs = signatureDigests(archive);
            Set<String> currentSigs = signatureDigests(current);
            if (archiveSigs.isEmpty() || !archiveSigs.equals(currentSigs)) {
                return Result.fail("ERR_SIGNATURE",
                    "İmza uyuşmazlığı: arşiv sertifikası kurulu uygulamayla aynı değil");
            }

            // ── 6. Sistem kurulum ekranı (kullanıcı onayı sistem diyaloğunda)
            Uri uri = FileProvider.getUriForFile(ctx, ownPackage + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, APK_MIME);
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(install);
            Log.i(TAG, "Kurulum ekranı açıldı: " + apk.getName() + " (vc=" + archiveCode + ")");
            return Result.prompted();

        } catch (android.content.ActivityNotFoundException e) {
            return Result.fail("ERR_NO_INSTALLER",
                "Sistem paket kurucusu bulunamadı (OEM ROM kısıtı?): " + e.getMessage());
        } catch (Exception e) {
            return Result.fail("ERR_IO",
                e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** API 28+ longVersionCode, altı deprecated versionCode. */
    private static long versionCodeOf(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    /** İmza sertifikalarının SHA-256 hex seti (sıra-bağımsız karşılaştırma). */
    private static Set<String> signatureDigests(PackageInfo info) throws Exception {
        Signature[] sigs;
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            sigs = info.signingInfo.getApkContentsSigners();
        } else {
            sigs = info.signatures;
        }
        Set<String> out = new HashSet<>();
        if (sigs == null) return out;
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        for (Signature s : sigs) {
            byte[] d = md.digest(s.toByteArray());
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) sb.append(String.format(Locale.ROOT, "%02x", b));
            out.add(sb.toString());
            md.reset();
        }
        Log.d(TAG, "İmza digest seti: " + Arrays.toString(out.toArray()));
        return out;
    }
}
