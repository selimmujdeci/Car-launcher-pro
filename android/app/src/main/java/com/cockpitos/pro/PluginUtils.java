package com.cockpitos.pro;

import android.content.Context;
import android.graphics.Bitmap;
import android.net.Uri;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * PluginUtils — CarLauncherPlugin God Object'inden çıkarılan saf/durumsuz
 * yardımcılar (Phase 5, adım 1).
 *
 * Bu sınıftaki hiçbir metot örnek (instance) durumuna, Capacitor köprüsüne
 * (notifyListeners), statik _instance singleton'a veya mainHandler thread
 * bağlamına dokunmaz — yalnızca girdi → çıktı dönüşümü yapar. Bu yüzden
 * davranış değişmeden taşınabildiler ve tek başına test edilebilirler.
 *
 * NOT: Görüntü/string dönüşümleri burada toplanır; durumlu Media/OBD/System
 * mantığı ayrı bir adımda (cihaz doğrulamasıyla) ele alınacaktır.
 */
public final class PluginUtils {

    private PluginUtils() { /* yalnızca statik yardımcılar */ }

    /** Drawable'ı verilen kare boyuta ölçeklenmiş bir Bitmap'e çevirir. */
    public static Bitmap drawableToBitmap(android.graphics.drawable.Drawable drawable, int size) {
        if (drawable == null) return null;

        if (drawable instanceof android.graphics.drawable.BitmapDrawable) {
            Bitmap src = ((android.graphics.drawable.BitmapDrawable) drawable).getBitmap();
            if (src != null && !src.isRecycled()) {
                return Bitmap.createScaledBitmap(src, size, size, true);
            }
        }

        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        android.graphics.Canvas canvas = new android.graphics.Canvas(bmp);
        drawable.setBounds(0, 0, size, size);
        drawable.draw(canvas);
        return bmp;
    }

    /** Bitmap'i 200×200 JPEG base64 data URI string'ine çevirir. */
    public static String bitmapToDataUri(Bitmap src) {
        try {
            Bitmap scaled = Bitmap.createScaledBitmap(src, 200, 200, true);
            ByteArrayOutputStream stream = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 75, stream);
            String b64 = android.util.Base64.encodeToString(
                stream.toByteArray(), android.util.Base64.NO_WRAP);
            return "data:image/jpeg;base64," + b64;
        } catch (Exception ignored) {
            return "";
        }
    }

    /** İlk boş olmayan string'i döner; hepsi boş/null ise null. */
    public static String firstNonEmpty(String... vals) {
        if (vals == null) return null;
        for (String v : vals) {
            if (v != null && !v.isEmpty()) return v;
        }
        return null;
    }

    /**
     * URI bazlı bitmap yükler (content/file/android.resource veya http/https).
     * Context yalnızca content çözümleyici için parametre olarak alınır.
     */
    public static Bitmap loadBitmapFromUri(Context ctx, String uriStr) {
        if (uriStr == null || uriStr.isEmpty()) return null;
        try {
            Uri uri = Uri.parse(uriStr);
            String scheme = uri.getScheme();
            if (scheme == null) return null;
            scheme = scheme.toLowerCase();

            if ("content".equals(scheme) || "file".equals(scheme) || "android.resource".equals(scheme)) {
                InputStream is = ctx.getContentResolver().openInputStream(uri);
                if (is == null) return null;
                try {
                    return android.graphics.BitmapFactory.decodeStream(is);
                } finally {
                    try { is.close(); } catch (Exception ignored) {}
                }
            } else if ("http".equals(scheme) || "https".equals(scheme)) {
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection)
                    new java.net.URL(uriStr).openConnection();
                conn.setConnectTimeout(2_000);
                conn.setReadTimeout(2_500);
                conn.setRequestProperty("User-Agent", "CockpitOS/1.0");
                conn.setInstanceFollowRedirects(true);
                conn.connect();
                try {
                    InputStream is = conn.getInputStream();
                    try {
                        return android.graphics.BitmapFactory.decodeStream(is);
                    } finally {
                        try { is.close(); } catch (Exception ignored) {}
                    }
                } finally {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        } catch (Throwable ignored) { /* sessizce başarısız */ }
        return null;
    }
}
