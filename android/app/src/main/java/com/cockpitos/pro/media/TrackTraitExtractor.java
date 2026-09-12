package com.cockpitos.pro.media;

import android.content.Context;
import android.net.Uri;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Metadata;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.MetadataRetriever;
import androidx.media3.exoplayer.source.TrackGroupArray;
import androidx.media3.extractor.metadata.id3.InternalFrame;
import androidx.media3.extractor.metadata.id3.TextInformationFrame;
import androidx.media3.extractor.metadata.vorbis.VorbisComment;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.TimeUnit;

import com.google.common.util.concurrent.ListenableFuture;

/**
 * TrackTraitExtractor — MUSIC F10.1 · GÖMÜLÜ etiketlerden GERÇEK karakter kanıtı.
 *
 * NE OKUR: kabın (container) metadata'sı — ID3v2 `TBPM` ve Vorbis `BPM` yorumu.
 * Bu bir ETİKET okumasıdır, ses analizi DEĞİLDİR: dosya DECODE EDİLMEZ.
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · Çalma yolunda (hot path) ÇALIŞMAZ; çağrı ayrı bir arka plan havuzundadır.
 *   · UI thread'de ASLA çalışmaz.
 *   · Toplu iş SINIRLIDIR (`MAX_BATCH`) ve dosya başına ZAMAN AŞIMI vardır —
 *     bozuk/uzak bir dosya kütüphaneyi kilitleyemez.
 *   · Etiket yoksa alan `null` döner. **Süre/başlık/türden BPM ÜRETİLMEZ.**
 *   · Kalıcı durum TUTMAZ; önbellek JS tarafındadır (tek kanıt deposu).
 */
public final class TrackTraitExtractor {

    private TrackTraitExtractor() {}

    /** Tek turda okunacak EN FAZLA dosya — düşük-uç cihaz bütçesi. */
    public static final int MAX_BATCH = 24;
    /** Dosya başına üst sınır; aşılırsa o dosya "bilinmiyor" kalır (fail-soft). */
    private static final long PER_ITEM_TIMEOUT_MS = 1500L;

    /**
     * Verilen içerik URI'leri için gömülü BPM okur.
     *
     * @return `{ traits: [{ uri, bpm|null, source }] , scanned, limited }`
     */
    @OptIn(markerClass = UnstableApi.class)
    public static JSObject readEmbeddedTraits(Context ctx, List<String> uris) {
        JSArray out = new JSArray();
        int scanned = 0;
        boolean limited = false;

        if (uris != null) {
            for (String raw : uris) {
                if (scanned >= MAX_BATCH) { limited = true; break; }
                if (raw == null || raw.isEmpty()) continue;
                scanned++;

                JSObject row = new JSObject();
                row.put("uri", raw);
                Integer bpm = null;
                String source = "NONE";
                /* MUSIC F19 - ReplayGain / R128 seviye etiketi (varsa). */
                Double gainDb = null;
                Double gainPeak = null;
                String gainSource = "NONE";

                try {
                    ListenableFuture<TrackGroupArray> future = MetadataRetriever.retrieveMetadata(
                        ctx, MediaItem.fromUri(Uri.parse(raw)));
                    TrackGroupArray groups = future.get(PER_ITEM_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                    for (int g = 0; g < groups.length; g++) {
                        androidx.media3.common.TrackGroup group = groups.get(g);
                        for (int f = 0; f < group.length; f++) {
                            Metadata meta = group.getFormat(f).metadata;
                            if (meta == null) continue;
                            for (int e = 0; e < meta.length(); e++) {
                                Metadata.Entry entry = meta.get(e);
                                if (bpm == null) {
                                    Integer parsed = parseEntry(entry);
                                    if (parsed != null) {
                                        bpm = parsed;
                                        source = (entry instanceof TextInformationFrame)
                                            ? "ID3_TBPM" : "VORBIS_BPM";
                                    }
                                }
                                /* MUSIC F19 - seviye etiketleri BPM'den BAGIMSIZ okunur:
                                   biri varken digeri olmayabilir. */
                                Gain gv = parseGainEntry(entry);
                                if (gv != null) {
                                    if (gv.db != null && gainDb == null) {
                                        gainDb = gv.db;
                                        gainSource = gv.source;
                                    }
                                    if (gv.peak != null && gainPeak == null) gainPeak = gv.peak;
                                }
                            }
                        }
                    }
                } catch (Throwable ignored) {
                    /* Bozuk dosya · zaman aşımı · desteklenmeyen kap → kanıt YOK.
                       Sahte bir değer ÜRETİLMEZ. */
                }

                row.put("bpm", bpm == null ? JSONObject.NULL : bpm.intValue());
                row.put("source", source);
                row.put("gainDb", gainDb == null ? JSONObject.NULL : gainDb.doubleValue());
                row.put("gainPeak", gainPeak == null ? JSONObject.NULL : gainPeak.doubleValue());
                row.put("gainSource", gainSource);
                out.put(row);
            }
        }

        JSObject result = new JSObject();
        result.put("traits", out);
        result.put("scanned", scanned);
        result.put("limited", limited);
        return result;
    }

    /* ======================================================================
       MUSIC F19 - REPLAYGAIN / R128 SEVIYE ETIKETI

       Bu da bir ETIKET okumasidir: dosyayi URETEN aracin yazdigi seviye
       bilgisidir, bizim olcumumuz DEGILDIR. Bu yuzden deger oldugu gibi
       tasinir; LUFS UYDURULMAZ ve etiket yoksa alan null kalir.

       Okunan yerler:
         - ID3v2 TXXX (description = replaygain_track_gain / _peak)
         - MP4/iTunes ---- ic cercevesi (ayni aciklama adlari)
         - Vorbis/FLAC/Opus yorumlari (REPLAYGAIN_* ve R128_TRACK_GAIN)
       R128 degeri Q7.8 tamsayidir -> dB icin 256'ya bolunur.
       ====================================================================== */

    private static final class Gain {
        Double db; Double peak; String source;
    }

    @OptIn(markerClass = UnstableApi.class)
    private static Gain parseGainEntry(Metadata.Entry entry) {
        String key = null;
        String value = null;

        if (entry instanceof TextInformationFrame) {
            TextInformationFrame frame = (TextInformationFrame) entry;
            if ("TXXX".equalsIgnoreCase(frame.id) && !frame.values.isEmpty()) {
                key = frame.description;
                value = frame.values.get(0);
            }
        } else if (entry instanceof InternalFrame) {
            InternalFrame frame = (InternalFrame) entry;
            key = frame.description;
            value = frame.text;
        } else if (entry instanceof VorbisComment) {
            VorbisComment comment = (VorbisComment) entry;
            key = comment.key;
            value = comment.value;
        }
        if (key == null || value == null) return null;

        String k = key.trim().toLowerCase(java.util.Locale.US);
        Gain g = new Gain();
        if ("replaygain_track_gain".equals(k) || "replaygain_album_gain".equals(k)) {
            Double db = parseDecibel(value);
            if (db == null) return null;
            g.db = db;
            g.source = "replaygain_track_gain".equals(k) ? "REPLAYGAIN_TRACK" : "REPLAYGAIN_ALBUM";
            return g;
        }
        if ("replaygain_track_peak".equals(k) || "replaygain_album_peak".equals(k)) {
            Double peak = parsePlainDouble(value);
            /* Tepe 0..2 araligi disindaysa bozuk etikettir (1.0 = tam olcek). */
            if (peak == null || peak <= 0.0 || peak > 2.0) return null;
            g.peak = peak;
            g.source = "NONE";
            return g;
        }
        if ("r128_track_gain".equals(k) || "r128_album_gain".equals(k)) {
            Double q78 = parsePlainDouble(value);
            if (q78 == null) return null;
            g.db = Double.valueOf(q78.doubleValue() / 256.0);
            g.source = "r128_track_gain".equals(k) ? "R128_TRACK" : "R128_ALBUM";
            return g;
        }
        return null;
    }

    /** "-7.50 dB" gibi yazimlar; makul aralik disi bozuk sayilir. */
    private static Double parseDecibel(String raw) {
        String cleaned = raw.replace("dB", "").replace("DB", "").replace("db", "");
        Double v = parsePlainDouble(cleaned);
        if (v == null) return null;
        return (v.doubleValue() >= -60.0 && v.doubleValue() <= 60.0) ? v : null;
    }

    private static Double parsePlainDouble(String raw) {
        try {
            String t = raw.trim().replace(',', '.');
            if (t.isEmpty()) return null;
            return Double.valueOf(Double.parseDouble(t));
        } catch (Throwable ignored) {
            return null;
        }
    }

    /** ID3 `TBPM` veya Vorbis `BPM` girdisinden makul bir BPM çıkar; yoksa `null`. */
    @OptIn(markerClass = UnstableApi.class)
    private static Integer parseEntry(Metadata.Entry entry) {
        String value = null;
        if (entry instanceof TextInformationFrame) {
            TextInformationFrame frame = (TextInformationFrame) entry;
            if ("TBPM".equalsIgnoreCase(frame.id) && !frame.values.isEmpty()) {
                value = frame.values.get(0);
            }
        } else if (entry instanceof VorbisComment) {
            VorbisComment comment = (VorbisComment) entry;
            if ("BPM".equalsIgnoreCase(comment.key)) value = comment.value;
        }
        if (value == null) return null;

        try {
            /* "128", "128.0", "128 BPM" gibi yazımlar sahada görülür. */
            String digits = value.trim().replaceAll("[^0-9.].*$", "");
            if (digits.isEmpty()) return null;
            int bpm = (int) Math.round(Double.parseDouble(digits));
            /* Makul aralık dışındaki değer bir ÖLÇÜM değil, bozuk etikettir. */
            return (bpm >= 40 && bpm <= 250) ? Integer.valueOf(bpm) : null;
        } catch (Throwable ignored) {
            return null;
        }
    }
}
