package com.cockpitos.pro.media;

import android.content.Context;
import android.net.Uri;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Metadata;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.MetadataRetriever;
import androidx.media3.exoplayer.source.TrackGroupArray;
import androidx.media3.extractor.metadata.id3.BinaryFrame;
import androidx.media3.extractor.metadata.vorbis.VorbisComment;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.io.UnsupportedEncodingException;
import java.util.List;
import java.util.concurrent.TimeUnit;

import com.google.common.util.concurrent.ListenableFuture;

/**
 * TrackLyricsExtractor — MUSIC F16 · Gömülü ID3 USLT/SYLT ve Vorbis LYRICS
 * etiketlerinden GERÇEK şarkı sözü okur.
 *
 * ÖLÇÜLEN GERÇEK (F16 denetimi, `media3-extractor-1.4.1.aar`ın `classes.jar`ı
 * açılıp `Id3Decoder.class` bayt kodu incelendi): media3 1.4.1'in ID3
 * çözücüsü USLT/SYLT için ÖZEL tipli bir çerçeve SUNMAZ — yalnız
 * `TextInformationFrame` / `CommentFrame` / `UrlLinkFrame` / `PrivFrame` /
 * `GeobFrame` / `ApicFrame` / `ChapterFrame` / `ChapterTocFrame` /
 * `MlltFrame` / `BinaryFrame` decode metotları vardır; USLT/SYLT için özel
 * bir `decodeXxxFrame` metodu YOKTUR. Sonuç: ikisi de genel `BinaryFrame`e
 * (id="USLT"/"SYLT", ham bayt gövdesi) düşer. Bu sınıf ID3v2.3/2.4 §4.10
 * (USLT) ve §4.9 (SYLT) çerçeve gövdesini BELGELENMİŞ ikili formata göre
 * elle çözer — media3'ün YENİDEN YAZIMI veya taklidi DEĞİL, media3'ün
 * bilerek dokunmadığı bir boşluğun DOLDURULMASI.
 *
 * PAZARLIKSIZ SINIRLAR (`TrackTraitExtractor`/F10.1 ile AYNI disiplin):
 *   · Çalma yolunda (hot path) ÇALIŞMAZ; çağıran ayrı bir arka plan
 *     havuzunda çalıştırır (bkz. `CarLauncherPlugin.readEmbeddedLyrics`).
 *   · UI thread'de ASLA çalışmaz.
 *   · Toplu iş SINIRLIDIR (`MAX_BATCH`) ve dosya başına ZAMAN AŞIMI vardır —
 *     bozuk/uzak bir dosya kütüphaneyi kilitleyemez.
 *   · Söz yoksa/çözülemiyorsa `source: "NONE"` — HİÇBİR ZAMAN metin veya
 *     zamanlama UYDURULMAZ.
 *   · SYLT zaman damgası yalnız MİLİSANİYE formatındaysa (`timestampFormat
 *     == 2`) kabul edilir. MPEG-frame formatı (1) bit hızı bilinmeden ms'ye
 *     ÇEVRİLMEZ — bu bir TAHMİN olurdu; o durumda `synced=null` döner ve
 *     çağıran (varsa) USLT/Vorbis düz metnine düşer.
 *   · Ayrıştırma döngüleri SINIRLIDIR (`MAX_SYNC_LINES`, ilerlemeyen döngü
 *     koruması) — bozuk çerçeve sonsuz döngü/OOM ÜRETEMEZ.
 *   · Kalıcı durum TUTMAZ; önbellek JS tarafındadır (tek kanıt deposu).
 */
public final class TrackLyricsExtractor {

    private TrackLyricsExtractor() {}

    /** Tek turda okunacak EN FAZLA dosya — metin BPM'den ağırdır, toplu iş küçük tutulur. */
    public static final int MAX_BATCH = 8;
    /** Dosya başına üst sınır; aşılırsa o dosya "bilinmiyor" kalır (fail-soft). */
    private static final long PER_ITEM_TIMEOUT_MS = 2000L;
    /** Bir SYLT çerçevesinde okunacak EN FAZLA satır — bozuk çerçeveye karşı savunma. */
    private static final int MAX_SYNC_LINES = 3000;
    /** Tek bir metin parçası (descriptor/satır) için üst bayt sınırı — çöp veriye karşı savunma. */
    private static final int MAX_TEXT_SPAN_BYTES = 4096;
    /** USLT/Vorbis düz metin için üst bayt sınırı. */
    private static final int MAX_PLAIN_CHARS = 200_000;

    /**
     * Verilen içerik URI'leri için gömülü şarkı sözü okur.
     *
     * @return `{ results: [{ uri, plain|null, synced:[{ms,text}]|null, source }], scanned, limited }`
     */
    @OptIn(markerClass = UnstableApi.class)
    public static JSObject readEmbeddedLyrics(Context ctx, List<String> uris) {
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
                String plain = null;
                JSArray synced = null;
                String source = "NONE";

                try {
                    ListenableFuture<TrackGroupArray> future = MetadataRetriever.retrieveMetadata(
                        ctx, MediaItem.fromUri(Uri.parse(raw)));
                    TrackGroupArray groups = future.get(PER_ITEM_TIMEOUT_MS, TimeUnit.MILLISECONDS);

                    String usltText = null;
                    JSArray syltLines = null;
                    String vorbisText = null;

                    outer:
                    for (int g = 0; g < groups.length; g++) {
                        androidx.media3.common.TrackGroup group = groups.get(g);
                        for (int f = 0; f < group.length; f++) {
                            Metadata meta = group.getFormat(f).metadata;
                            if (meta == null) continue;
                            for (int e = 0; e < meta.length(); e++) {
                                Metadata.Entry entry = meta.get(e);
                                if (entry instanceof BinaryFrame) {
                                    BinaryFrame bf = (BinaryFrame) entry;
                                    if (syltLines == null && "SYLT".equals(bf.id)) {
                                        syltLines = parseSylt(bf.data);
                                    } else if (usltText == null && "USLT".equals(bf.id)) {
                                        usltText = parseUslt(bf.data);
                                    }
                                } else if (entry instanceof VorbisComment) {
                                    VorbisComment vc = (VorbisComment) entry;
                                    if (vorbisText == null && vc.key != null
                                        && ("LYRICS".equalsIgnoreCase(vc.key)
                                            || "UNSYNCEDLYRICS".equalsIgnoreCase(vc.key))) {
                                        vorbisText = boundPlain(vc.value);
                                    }
                                }
                                if (syltLines != null && usltText != null && vorbisText != null) break outer;
                            }
                        }
                    }

                    if (syltLines != null && syltLines.length() > 0) {
                        synced = syltLines;
                        source = "ID3_SYLT";
                    } else if (usltText != null) {
                        plain = usltText;
                        source = "ID3_USLT";
                    } else if (vorbisText != null) {
                        plain = vorbisText;
                        source = "VORBIS_LYRICS";
                    }
                } catch (Throwable ignored) {
                    /* Bozuk dosya · zaman aşımı · desteklenmeyen kap → kanıt YOK.
                       Sahte bir değer ÜRETİLMEZ. */
                }

                row.put("plain", plain == null ? JSONObject.NULL : plain);
                row.put("synced", synced == null ? JSONObject.NULL : synced);
                row.put("source", source);
                out.put(row);
            }
        }

        JSObject result = new JSObject();
        result.put("results", out);
        result.put("scanned", scanned);
        result.put("limited", limited);
        return result;
    }

    /* ── ID3v2 §4.10 USLT — Unsynchronised lyrics/text transcription ─────────
     * [encoding:1][language:3][content descriptor: terminated][lyrics text]. */
    private static String parseUslt(byte[] data) {
        if (data == null || data.length < 5) return null;
        int encoding = data[0] & 0xFF;
        int pos = 4; // 1 bayt kodlama + 3 bayt dil
        int descEnd = findTerminator(data, pos, encoding);
        if (descEnd < 0) return null;
        int textStart = descEnd + terminatorLen(encoding);
        if (textStart > data.length) return null;
        return boundPlain(decodeText(data, textStart, data.length - textStart, encoding));
    }

    /* ── ID3v2 §4.9 SYLT — Synchronised lyrics/text ───────────────────────────
     * [encoding:1][language:3][timestampFormat:1][contentType:1]
     * [content descriptor: terminated]
     * ([syllable/text: terminated][timestamp: 4 bayt big-endian])*
     *
     * Yalnız `timestampFormat==2` (milisaniye) KABUL EDİLİR. MPEG-frame
     * formatı (1) bit hızı bilinmeden ms'ye ÇEVRİLEMEZ — bu bir TAHMİN
     * olurdu; o durumda `null` döner (çağıran USLT/Vorbis'e düşer). */
    private static JSArray parseSylt(byte[] data) {
        if (data == null || data.length < 6) return null;
        int encoding = data[0] & 0xFF;
        int timestampFormat = data[4] & 0xFF;
        if (timestampFormat != 2) return null; // ms DEĞİL → uydurmadan reddet
        int pos = 6; // encoding(1) + dil(3) + timestampFormat(1) + contentType(1)
        int descEnd = findTerminator(data, pos, encoding);
        if (descEnd < 0) return null;
        pos = descEnd + terminatorLen(encoding);

        JSArray lines = new JSArray();
        int guard = 0;
        while (pos < data.length && guard < MAX_SYNC_LINES) {
            guard++;
            int termIdx = findTerminator(data, pos, encoding);
            if (termIdx < 0) break;
            int span = termIdx - pos;
            if (span < 0 || span > MAX_TEXT_SPAN_BYTES) break; // bozuk çerçeve — güvenli çıkış
            String text = decodeText(data, pos, span, encoding);
            int tsStart = termIdx + terminatorLen(encoding);
            if (tsStart + 4 > data.length) break;
            long ms = ((data[tsStart] & 0xFFL) << 24) | ((data[tsStart + 1] & 0xFFL) << 16)
                | ((data[tsStart + 2] & 0xFFL) << 8) | (data[tsStart + 3] & 0xFFL);
            JSObject line = new JSObject();
            line.put("ms", ms);
            line.put("text", text == null ? "" : text);
            lines.put(line);
            int next = tsStart + 4;
            if (next <= pos) break; // ilerlemiyor — sonsuz döngü koruması
            pos = next;
        }
        return lines;
    }

    /** Kodlamaya göre metin sonlandırıcının BAŞLANGIÇ indeksini bulur (bulunamazsa -1). */
    private static int findTerminator(byte[] data, int from, int encoding) {
        boolean wide = (encoding == 1 || encoding == 2); // UTF-16 varyantları (çift bayt sonlandırıcı)
        if (wide) {
            for (int i = from; i + 1 < data.length; i += 2) {
                if (data[i] == 0 && data[i + 1] == 0) return i;
            }
            return -1;
        }
        for (int i = from; i < data.length; i++) {
            if (data[i] == 0) return i;
        }
        return -1;
    }

    private static int terminatorLen(int encoding) {
        return (encoding == 1 || encoding == 2) ? 2 : 1;
    }

    /** ID3 metin kodlama baytı (0=ISO-8859-1,1=UTF-16+BOM,2=UTF-16BE,3=UTF-8). */
    private static String decodeText(byte[] data, int offset, int length, int encoding) {
        if (data == null || offset < 0 || length < 0 || offset + length > data.length) return null;
        try {
            String charset;
            switch (encoding) {
                case 1: charset = "UTF-16"; break;    // BOM'lu
                case 2: charset = "UTF-16BE"; break;  // BOM'suz (yalnız v2.4)
                case 3: charset = "UTF-8"; break;
                default: charset = "ISO-8859-1"; break;
            }
            return new String(data, offset, length, charset);
        } catch (UnsupportedEncodingException e) {
            return null;
        }
    }

    /** Boş/aşırı büyük metni ELER — aşırı büyüklük gerçek söz değil çöp/bozuk veri belirtisidir. */
    private static String boundPlain(String s) {
        if (s == null || s.isEmpty()) return null;
        if (s.length() > MAX_PLAIN_CHARS) return null;
        return s;
    }
}
