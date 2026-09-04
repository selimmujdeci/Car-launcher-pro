package com.cockpitos.pro.media;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * MediaStoreLibraryScanner — F2 library scan executor.
 *
 * The JS side owns the refresh POLICY (mediaStoreRefreshPlanner); this class only
 * executes what it is told and reports what the provider actually said:
 *
 *   volumeFacts()  → visible volumes + version/generation, NO track query
 *   queryTracks()  → FULL or DELTA rows for the requested volumes, plus (optionally)
 *                    the full `_ID` set per volume so deletions are OBSERVED
 *
 * Nothing here invents a value: unavailable version/generation is reported as null,
 * which makes the planner fail closed to FULL_RECONCILE.
 */
@android.annotation.SuppressLint("NewApi")
public final class MediaStoreLibraryScanner {

    /** Pre-API29 there is exactly one addressable external volume. */
    private static final String LEGACY_VOLUME = "external_primary";

    private MediaStoreLibraryScanner() {}

    /* ── Permission ─────────────────────────────────────────────────────── */

    public static boolean hasAudioReadPermission(Context ctx) {
        String perm = Build.VERSION.SDK_INT >= 33
            ? Manifest.permission.READ_MEDIA_AUDIO
            : Manifest.permission.READ_EXTERNAL_STORAGE;
        try {
            return ctx.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static boolean supportsGeneration() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
    }

    /**
     * MUSIC F10.1 — `MediaStore.Audio.Media.GENRE` yalnız API 30+ (R) sütunudur.
     * Daha eski platformda sorgulanırsa cursor patlar; bu yüzden aynı kapı.
     * YEAR her sürümde vardır ve ayrı kapı GEREKTİRMEZ.
     */
    private static boolean supportsGenreColumn() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
    }

    /* ── Volume enumeration ─────────────────────────────────────────────── */

    private static Set<String> visibleVolumes(Context ctx) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                for (String name : MediaStore.getExternalVolumeNames(ctx)) {
                    if (name != null && !name.isEmpty()) out.add(name);
                }
            } catch (Throwable ignored) {}
        }
        if (out.isEmpty()) out.add(LEGACY_VOLUME);
        return out;
    }

    private static String versionOf(Context ctx, String volume) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return MediaStore.getVersion(ctx, volume);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) return MediaStore.getVersion(ctx);
            return null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    /** Returns null (not 0) when the platform cannot report a generation. */
    private static Long generationOf(Context ctx, String volume) {
        if (!supportsGeneration()) return null;
        try {
            return MediaStore.getGeneration(ctx, volume);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String storageKindOf(String volume) {
        if (volume == null) return "UNKNOWN";
        if (MediaStore.VOLUME_EXTERNAL_PRIMARY.equals(volume) || LEGACY_VOLUME.equals(volume)) return "INTERNAL_SHARED";
        if (MediaStore.VOLUME_EXTERNAL.equals(volume)) return "UNKNOWN";
        return "REMOVABLE";
    }

    private static Uri audioUriFor(String volume) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try { return MediaStore.Audio.Media.getContentUri(volume); } catch (Throwable ignored) {}
        }
        return MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
    }

    /**
     * A volume is "available" when it is enumerated AND a trivial probe query
     * succeeds. A detached SD card can linger in the name list for a moment; a
     * failing probe is reported as unavailable rather than as an empty library.
     */
    private static boolean probe(Context ctx, String volume) {
        Cursor c = null;
        try {
            c = ctx.getContentResolver().query(
                audioUriFor(volume), new String[]{ MediaStore.Audio.Media._ID }, null, null, null);
            return c != null;
        } catch (Throwable ignored) {
            return false;
        } finally {
            if (c != null) try { c.close(); } catch (Throwable ignored) {}
        }
    }

    public static JSObject volumeFacts(Context ctx) {
        boolean granted = hasAudioReadPermission(ctx);
        JSArray volumes = new JSArray();
        if (granted) {
            for (String volume : visibleVolumes(ctx)) {
                Long generation = generationOf(ctx, volume);
                JSObject v = new JSObject();
                v.put("name", volume);
                v.put("version", versionOf(ctx, volume));
                if (generation == null) v.put("generation", JSONObject.NULL); else v.put("generation", generation.longValue());
                v.put("available", probe(ctx, volume));
                v.put("storageKind", storageKindOf(volume));
                volumes.put(v);
            }
        }
        JSObject out = new JSObject();
        out.put("permissionGranted", granted);
        out.put("supportsGeneration", supportsGeneration());
        out.put("volumes", volumes);
        return out;
    }

    /* ── Track query ────────────────────────────────────────────────────── */

    private static String[] projection() {
        List<String> cols = new ArrayList<>();
        cols.add(MediaStore.Audio.Media._ID);
        cols.add(MediaStore.Audio.Media.TITLE);
        cols.add(MediaStore.Audio.Media.ARTIST);
        cols.add(MediaStore.Audio.Media.ALBUM);
        cols.add(MediaStore.Audio.Media.ALBUM_ARTIST);
        cols.add(MediaStore.Audio.Media.ALBUM_ID);
        cols.add(MediaStore.Audio.Media.DURATION);
        cols.add(MediaStore.Audio.Media.MIME_TYPE);
        cols.add(MediaStore.Audio.Media.RELATIVE_PATH);
        cols.add(MediaStore.Audio.Media.SIZE);
        cols.add(MediaStore.Audio.Media.DATE_MODIFIED);
        cols.add(MediaStore.Audio.Media.TRACK);
        if (supportsGeneration()) cols.add(MediaStore.Audio.Media.GENERATION_MODIFIED);
        /* MUSIC F10.1 — GERÇEK karakter kanıtı için kütüphane metadata'sı.
           Uydurma YOK: sütun boşsa alan `null` gider ve trait katmanı kanıt
           ÜRETMEZ. GENRE API 30+ ile sınırlıdır (bkz. supportsGenreColumn). */
        cols.add(MediaStore.Audio.Media.YEAR);
        if (supportsGenreColumn()) cols.add(MediaStore.Audio.Media.GENRE);
        return cols.toArray(new String[0]);
    }

    private static String str(Cursor c, int col) { return col < 0 ? null : c.getString(col); }
    private static long lng(Cursor c, int col) { return col < 0 ? 0L : c.getLong(col); }

    /**
     * @param volumeNames   volumes to scan
     * @param delta         true → only rows with GENERATION_MODIFIED > since
     * @param sinceByVolume volumeName → exclusive lower bound (delta only)
     * @param identityVolumes volumes whose complete `_ID` set must also be returned
     */
    public static JSObject queryTracks(
        Context ctx, List<String> volumeNames, boolean delta,
        JSONObject sinceByVolume, List<String> identityVolumes
    ) throws Exception {
        ContentResolver cr = ctx.getContentResolver();
        JSArray tracks = new JSArray();
        JSArray queried = new JSArray();
        JSObject identities = new JSObject();
        String[] projection = projection();

        for (String volume : volumeNames) {
            if (volume == null || volume.isEmpty()) continue;

            String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
            String[] args = null;
            if (delta && supportsGeneration() && sinceByVolume != null && sinceByVolume.has(volume)) {
                selection += " AND " + MediaStore.Audio.Media.GENERATION_MODIFIED + " > ?";
                args = new String[]{ String.valueOf(sinceByVolume.optLong(volume, 0L)) };
            }

            Cursor cursor = cr.query(audioUriFor(volume), projection, selection, args,
                MediaStore.Audio.Media.TITLE + " ASC");
            if (cursor == null) throw new IllegalStateException("MEDIA_QUERY_NULL_CURSOR:" + volume);

            try {
                int idCol = cursor.getColumnIndex(MediaStore.Audio.Media._ID);
                int titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE);
                int artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST);
                int albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM);
                int albumArtistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM_ARTIST);
                int albumIdCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID);
                int durationCol = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION);
                int mimeCol = cursor.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE);
                int pathCol = cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH);
                int sizeCol = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE);
                int modifiedCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATE_MODIFIED);
                int trackCol = cursor.getColumnIndex(MediaStore.Audio.Media.TRACK);
                int generationCol = supportsGeneration()
                    ? cursor.getColumnIndex(MediaStore.Audio.Media.GENERATION_MODIFIED) : -1;
                int yearCol = cursor.getColumnIndex(MediaStore.Audio.Media.YEAR);
                int genreCol = supportsGenreColumn()
                    ? cursor.getColumnIndex(MediaStore.Audio.Media.GENRE) : -1;

                Uri base = audioUriFor(volume);
                String storageKind = storageKindOf(volume);

                while (cursor.moveToNext()) {
                    long id = lng(cursor, idCol);
                    long albumId = lng(cursor, albumIdCol);

                    JSObject track = new JSObject();
                    track.put("id", String.valueOf(id));
                    track.put("uri", ContentUris.withAppendedId(base, id).toString());
                    track.put("title", str(cursor, titleCol));
                    track.put("artist", str(cursor, artistCol));
                    track.put("album", str(cursor, albumCol));
                    track.put("albumArtist", str(cursor, albumArtistCol));
                    track.put("albumArtUri", "content://media/" + volume + "/audio/albumart/" + albumId);
                    track.put("durationMs", lng(cursor, durationCol));
                    track.put("mimeType", str(cursor, mimeCol));
                    track.put("relativePath", str(cursor, pathCol));
                    track.put("sizeBytes", lng(cursor, sizeCol));
                    track.put("dateModifiedSec", lng(cursor, modifiedCol));
                    if (generationCol >= 0) track.put("generationModified", cursor.getLong(generationCol));
                    else track.put("generationModified", JSONObject.NULL);
                    if (trackCol >= 0) track.put("trackNumber", cursor.getLong(trackCol));
                    /* MUSIC F10.1 — boş/0 değer KANIT DEĞİLDİR: `null` gönderilir
                       ki trait katmanı "bilinmiyor" ile "sıfır"ı karıştırmasın. */
                    long yearVal = yearCol >= 0 ? cursor.getLong(yearCol) : 0L;
                    track.put("year", yearVal > 0 ? yearVal : JSONObject.NULL);
                    String genreVal = genreCol >= 0 ? cursor.getString(genreCol) : null;
                    track.put("genre",
                        (genreVal != null && !genreVal.trim().isEmpty()) ? genreVal : JSONObject.NULL);
                    track.put("volumeName", volume);
                    track.put("storageKind", storageKind);
                    tracks.put(track);
                }
            } finally {
                try { cursor.close(); } catch (Throwable ignored) {}
            }

            queried.put(volume);
        }

        /* Deletion evidence: the complete current identity set, one cheap column. */
        if (identityVolumes != null) {
            for (String volume : identityVolumes) {
                if (volume == null || volume.isEmpty()) continue;
                Cursor c = cr.query(audioUriFor(volume), new String[]{ MediaStore.Audio.Media._ID },
                    MediaStore.Audio.Media.IS_MUSIC + " != 0", null, null);
                if (c == null) throw new IllegalStateException("MEDIA_IDENTITY_NULL_CURSOR:" + volume);
                try {
                    JSONArray ids = new JSONArray();
                    int idCol = c.getColumnIndex(MediaStore.Audio.Media._ID);
                    while (c.moveToNext()) ids.put(String.valueOf(lng(c, idCol)));
                    identities.put(volume, ids);
                } finally {
                    try { c.close(); } catch (Throwable ignored) {}
                }
            }
        }

        JSObject out = new JSObject();
        out.put("tracks", tracks);
        out.put("queriedVolumes", queried);
        out.put("mode", delta ? "DELTA" : "FULL");
        out.put("identities", identities);
        out.put("volumes", volumeFacts(ctx).getJSONArray("volumes"));
        return out;
    }

    /** Every visible volume, used by the legacy single-shot `getMusicTracks` path. */
    public static List<String> allVisibleVolumes(Context ctx) {
        return new ArrayList<>(visibleVolumes(ctx));
    }
}
