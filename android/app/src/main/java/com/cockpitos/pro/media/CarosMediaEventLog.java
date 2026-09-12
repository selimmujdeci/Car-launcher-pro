package com.cockpitos.pro.media;

import android.os.SystemClock;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * MÜZİK HUB PAKET B — Native medya olaylarının bounded, PII'siz izi.
 *
 * NEDEN: Paket A yalnız ANLIK DURUM yayınlıyordu ("şu an çalıyor mu"). Gerçek
 * araç doğrulaması SIRA gerektirir: focus istendi → verildi → kayboldu →
 * duraklatıldı → geri geldi. Tek bir anlık görüntü bu zinciri gösteremez;
 * sahada "neden sustu" sorusu logcat olmadan cevaplanamıyordu.
 *
 * TASARIM:
 *   - Sabit boyutlu halka (bellek sınırlı, sızıntı YOK).
 *   - **Monotonic saat** ({@link SystemClock#elapsedRealtime()}): araçta kontak
 *     kesilip RTC atlasa bile olay sırası bozulmaz.
 *   - Ardışık AYNI olay yeni kayıt açmaz, tekrar sayacını artırır (focus churn
 *     halkayı doldurup teşhisi silmesin).
 *   - Yazma O(1), tahsis tek kısa nesne; ses callback'lerinde ağır iş YOK.
 *
 * GİZLİLİK (pazarlıksız): parça başlığı · sanatçı · **URI/URL** · token bu
 * sınıfa GİREMEZ. API yalnız sabit olay adı + kısa kod kabul eder; kod
 * allowlist karakter kümesinden geçer, geçmezse "invalid" olur.
 *
 * SAF: Android'den yalnız SystemClock kullanılır — bu sınıf Robolectric'siz
 * JVM testinde de koşabilir (SystemClock hariç bağımlılık yoktur).
 */
public final class CarosMediaEventLog {

    /** Halkada tutulan en fazla olay. */
    public static final int MAX_EVENTS = 80;

    /** Kod alanında izin verilen karakterler — serbest metin sızıntısını keser. */
    private static final int MAX_CODE_LEN = 48;

    public static final String EV_SERVICE_CREATED       = "service_created";
    public static final String EV_SERVICE_DESTROYED     = "service_destroyed";
    public static final String EV_PLAYER_CREATED        = "player_created";
    public static final String EV_PLAYER_RELEASED       = "player_released";
    public static final String EV_SESSION_CREATED       = "media_session_created";
    public static final String EV_SESSION_RELEASED      = "media_session_released";
    public static final String EV_FOCUS_REQUESTED       = "focus_requested";
    public static final String EV_FOCUS_GRANTED         = "focus_granted";
    public static final String EV_FOCUS_DENIED          = "focus_denied";
    public static final String EV_FOCUS_DELAYED         = "focus_delayed";
    public static final String EV_FOCUS_LOST            = "focus_lost";
    public static final String EV_FOCUS_DUCK            = "focus_duck";
    public static final String EV_FOCUS_REGAINED        = "focus_regained";
    public static final String EV_BECOMING_NOISY        = "becoming_noisy";
    public static final String EV_ROUTE_CHANGED         = "route_changed";
    public static final String EV_COMMAND_RECEIVED      = "command_received";
    public static final String EV_COMMAND_ACCEPTED      = "command_accepted";
    public static final String EV_COMMAND_REJECTED      = "command_rejected";
    public static final String EV_PLAYBACK_STATE        = "playback_state_changed";
    public static final String EV_SOURCE_SWITCH_START   = "source_switch_started";
    public static final String EV_SOURCE_SWITCH_DONE    = "source_switch_completed";
    public static final String EV_SOURCE_SWITCH_FAILED  = "source_switch_failed";
    public static final String EV_STALE_CALLBACK        = "stale_callback_rejected";

    private static final class Entry {
        final long   seq;
        final long   atMs;
        final String type;
        final String code;
        final long   generation;
        int repeat;

        Entry(long seq, long atMs, String type, String code, long generation) {
            this.seq = seq;
            this.atMs = atMs;
            this.type = type;
            this.code = code;
            this.generation = generation;
            this.repeat = 0;
        }
    }

    private final Deque<Entry> events = new ArrayDeque<>(MAX_EVENTS);
    private long seq = 0L;
    private long dropped = 0L;

    /** Kısa kodu doğrular; serbest metin/URL buradan GEÇEMEZ. */
    static String sanitizeCode(String code) {
        if (code == null || code.isEmpty()) return "";
        if (code.length() > MAX_CODE_LEN) return "invalid";
        for (int i = 0; i < code.length(); i++) {
            char c = code.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.' || c == ':';
            if (!ok) return "invalid";
        }
        return code;
    }

    /** Olay kaydeder. FAIL-SOFT: kayıt hiçbir koşulda oynatmayı bozmaz. */
    public synchronized void record(String type, String code, long generation) {
        try {
            if (type == null || type.isEmpty()) return;
            String safeCode = sanitizeCode(code);
            Entry last = events.peekLast();
            if (last != null
                && last.type.equals(type)
                && last.code.equals(safeCode)
                && last.generation == generation) {
                last.repeat++;
                return;
            }
            seq++;
            events.addLast(new Entry(seq, SystemClock.elapsedRealtime(), type, safeCode, generation));
            while (events.size() > MAX_EVENTS) { events.pollFirst(); dropped++; }
        } catch (Exception ignored) { /* teşhis ASLA akışı bozmaz */ }
    }

    public synchronized long getTotal()   { return seq; }
    public synchronized long getDropped() { return dropped; }
    public synchronized int  size()       { return events.size(); }

    /**
     * Kompakt satır dizisi: {@code seq|atMs|type|code|generation|repeat}.
     * Bundle sınırlarını zorlamamak için en fazla {@code limit} kayıt döner
     * (en YENİLER). Ayrıştırma JS tarafındadır.
     */
    public synchronized String[] snapshot(int limit) {
        int n = Math.max(0, Math.min(limit, events.size()));
        String[] out = new String[n];
        int skip = events.size() - n;
        int i = 0, idx = 0;
        for (Entry e : events) {
            if (i++ < skip) continue;
            out[idx++] = e.seq + "|" + e.atMs + "|" + e.type + "|" + e.code
                + "|" + e.generation + "|" + e.repeat;
        }
        return out;
    }

    public synchronized void clear() {
        events.clear();
        seq = 0L;
        dropped = 0L;
    }
}
