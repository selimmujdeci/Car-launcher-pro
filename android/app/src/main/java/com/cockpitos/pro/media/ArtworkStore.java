package com.cockpitos.pro.media;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import com.cockpitos.pro.PluginUtils;
import com.getcapacitor.JSObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * ArtworkStore — F2 artwork byte tier.
 *
 * Two things the previous "decode full, then resize" path did not do:
 *   1. REAL target-size decode: bounds are read first, an inSampleSize is computed
 *      and the bitmap is decoded already close to the target. A 3000x3000 cover for
 *      a 96px thumbnail is decoded at 1/32, not fully into memory and then thrown away.
 *   2. A file, not a data URI: the result is written atomically (`.tmp` → rename)
 *      into a schema-versioned cache directory and referenced by path, so image bytes
 *      never cross the JS bridge on the main path.
 *
 * The LRU POLICY lives in JS (artworkDiskCache): this class writes, reads, deletes
 * and counts. Everything is fail-soft — no artwork is always a valid answer, and an
 * artwork failure must never influence library or playback truth.
 */
public final class ArtworkStore {

    /** Bump when the on-disk format changes; older directories are dropped on init. */
    public static final int SCHEMA = 1;
    private static final String ROOT = "caros-artwork";
    private static final String DIR = "v" + SCHEMA;
    private static final int JPEG_QUALITY = 86;

    private ArtworkStore() {}

    private static File root(Context ctx) {
        return new File(ctx.getCacheDir(), ROOT);
    }

    /** Creates the current schema directory and removes any foreign-schema siblings. */
    public static File dir(Context ctx) {
        File root = root(ctx);
        File current = new File(root, DIR);
        if (!current.exists()) current.mkdirs();
        File[] siblings = root.listFiles();
        if (siblings != null) {
            for (File f : siblings) {
                if (f.isDirectory() && !DIR.equals(f.getName())) deleteRecursive(f);
            }
        }
        return current;
    }

    private static void deleteRecursive(File f) {
        try {
            if (f.isDirectory()) {
                File[] kids = f.listFiles();
                if (kids != null) for (File k : kids) deleteRecursive(k);
            }
            f.delete();
        } catch (Throwable ignored) {}
    }

    /** Deterministic: the same uri + target always maps to the same file name. */
    public static String keyFor(String uri, int targetPx) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] digest = md.digest((uri + "|" + targetPx).getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) sb.append(String.format(Locale.US, "%02x", b));
            return sb.toString();
        } catch (Throwable t) {
            return "fallback_" + Math.abs((uri + "|" + targetPx).hashCode());
        }
    }

    private static InputStream open(Context ctx, String uri) {
        try {
            return ctx.getContentResolver().openInputStream(Uri.parse(uri));
        } catch (Throwable ignored) {
            return null;
        }
    }

    /** Standard power-of-two sampling: the largest step that still covers the target. */
    static int sampleSizeFor(int width, int height, int targetPx) {
        int largest = Math.max(width, height);
        if (largest <= 0 || targetPx <= 0) return 1;
        int sample = 1;
        while (largest / (sample * 2) >= targetPx) sample *= 2;
        return sample;
    }

    private static Bitmap decodeSampled(Context ctx, String uri, int targetPx, int[] outSample) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        InputStream boundsStream = open(ctx, uri);
        if (boundsStream != null) {
            try { BitmapFactory.decodeStream(boundsStream, null, bounds); }
            catch (Throwable ignored) {}
            finally { try { boundsStream.close(); } catch (Throwable ignored) {} }
        }

        int sample = sampleSizeFor(bounds.outWidth, bounds.outHeight, targetPx);
        outSample[0] = sample;

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        // Small surfaces do not need 8888: half the bytes, no visible difference.
        opts.inPreferredConfig = targetPx <= 160 ? Bitmap.Config.RGB_565 : Bitmap.Config.ARGB_8888;

        InputStream stream = open(ctx, uri);
        Bitmap bmp = null;
        if (stream != null) {
            try { bmp = BitmapFactory.decodeStream(stream, null, opts); }
            catch (Throwable ignored) {}
            finally { try { stream.close(); } catch (Throwable ignored) {} }
        }
        // http(s) and exotic providers keep the existing loader as a last resort.
        if (bmp == null) {
            try { bmp = PluginUtils.loadBitmapFromUri(ctx, uri); } catch (Throwable ignored) {}
            outSample[0] = 1;
        }
        return bmp;
    }

    /** Sampling is power-of-two, so a bounded final resize lands exactly on the target. */
    private static Bitmap fit(Bitmap src, int targetPx) {
        if (src == null) return null;
        int largest = Math.max(src.getWidth(), src.getHeight());
        if (largest <= targetPx) return src;
        float scale = targetPx / (float) largest;
        int w = Math.max(1, Math.round(src.getWidth() * scale));
        int h = Math.max(1, Math.round(src.getHeight() * scale));
        try {
            Bitmap scaled = Bitmap.createScaledBitmap(src, w, h, true);
            if (scaled != src) src.recycle();
            return scaled;
        } catch (Throwable ignored) {
            return src;
        }
    }

    /** A zero-length or undecodable cache file is corruption, not a hit. */
    private static boolean usable(File f) {
        if (!f.exists() || f.length() <= 0) return false;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try {
            BitmapFactory.decodeFile(f.getAbsolutePath(), bounds);
            return bounds.outWidth > 0 && bounds.outHeight > 0;
        } catch (Throwable ignored) {
            return false;
        }
    }

    /**
     * Resolves one artwork to a cache file. Never throws: `source: MISSING` with an
     * empty path is the honest answer when nothing can be decoded.
     */
    public static JSObject resolve(Context ctx, String uri, int targetPx) {
        JSObject out = new JSObject();
        String key = keyFor(uri, targetPx);
        out.put("key", key);
        out.put("path", "");
        out.put("bytes", 0);
        out.put("width", 0);
        out.put("height", 0);
        out.put("sampleSize", 1);
        out.put("source", "MISSING");
        if (uri == null || uri.isEmpty() || targetPx <= 0) return out;

        File dir = dir(ctx);
        File file = new File(dir, key + ".jpg");

        if (file.exists()) {
            if (usable(file)) {
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                try { BitmapFactory.decodeFile(file.getAbsolutePath(), bounds); } catch (Throwable ignored) {}
                try { file.setLastModified(System.currentTimeMillis()); } catch (Throwable ignored) {}
                out.put("path", file.getAbsolutePath());
                out.put("bytes", file.length());
                out.put("width", Math.max(0, bounds.outWidth));
                out.put("height", Math.max(0, bounds.outHeight));
                out.put("source", "DISK");
                return out;
            }
            try { file.delete(); } catch (Throwable ignored) {}
        }

        int[] sample = new int[]{ 1 };
        Bitmap bmp = fit(decodeSampled(ctx, uri, targetPx, sample), targetPx);
        if (bmp == null) return out;

        File tmp = new File(dir, key + ".tmp");
        boolean written = false;
        FileOutputStream fos = null;
        try {
            fos = new FileOutputStream(tmp);
            written = bmp.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, fos);
            fos.flush();
            fos.getFD().sync();
        } catch (Throwable ignored) {
            written = false;
        } finally {
            if (fos != null) try { fos.close(); } catch (Throwable ignored) {}
        }

        int width = bmp.getWidth();
        int height = bmp.getHeight();
        try { bmp.recycle(); } catch (Throwable ignored) {}

        if (!written || tmp.length() <= 0) {
            try { tmp.delete(); } catch (Throwable ignored) {}
            return out; // fail-soft: a failed write costs artwork, nothing else
        }

        // Atomic publish: readers only ever see a complete file under the final name.
        if (!tmp.renameTo(file)) {
            try { tmp.delete(); } catch (Throwable ignored) {}
            return out;
        }

        out.put("path", file.getAbsolutePath());
        out.put("bytes", file.length());
        out.put("width", width);
        out.put("height", height);
        out.put("sampleSize", sample[0]);
        out.put("source", "DECODED");
        return out;
    }

    /** Eviction/invalidation executed on behalf of the JS LRU policy. */
    public static int delete(Context ctx, java.util.List<String> keys, boolean all) {
        File dir = dir(ctx);
        int deleted = 0;
        if (all) {
            File[] files = dir.listFiles();
            if (files != null) for (File f : files) { if (f.delete()) deleted++; }
            return deleted;
        }
        if (keys == null) return 0;
        for (String key : keys) {
            if (key == null || key.isEmpty()) continue;
            File f = new File(dir, key + ".jpg");
            if (f.exists() && f.delete()) deleted++;
            File t = new File(dir, key + ".tmp");
            if (t.exists()) t.delete();
        }
        return deleted;
    }

    public static JSObject stats(Context ctx) {
        File dir = dir(ctx);
        long bytes = 0;
        int entries = 0;
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.isFile() && f.getName().endsWith(".jpg")) { entries++; bytes += f.length(); }
            }
        }
        JSObject out = new JSObject();
        out.put("entries", entries);
        out.put("bytes", bytes);
        out.put("schema", SCHEMA);
        out.put("dir", dir.getAbsolutePath());
        return out;
    }
}
