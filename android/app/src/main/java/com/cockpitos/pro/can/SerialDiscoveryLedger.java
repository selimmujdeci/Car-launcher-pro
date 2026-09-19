package com.cockpitos.pro.can;

import android.util.Log;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/**
 * SerialDiscoveryLedger — seri port keşfinin GÖZLEMLENEBİLİR kaydı (MRI F-01).
 *
 * Keşif adımları artık ölçülebilir: hangi aday görüldü, neden reddedildi, hangi
 * porta pasif kanıt geldi, yazma/heartbeat ne zaman AÇILDI ya da BASTIRILDI.
 * Tek görevi kayıt tutmaktır — karar VERMEZ, transport SEÇMEZ (ikinci otorite
 * değildir). Karar sahibi `SerialPortHandler` (port) ve `CanBusManager`
 * (transport) olarak kalır.
 *
 * Gizlilik: yalnız port yolu, aday türü ve makine-okur neden kodu yazılır;
 * sır/anahtar/kişisel veri bu deftere GİRMEZ.
 */
public final class SerialDiscoveryLedger {

    private static final String TAG = "CanDiscovery";
    private static final int    CAPACITY = 128;

    /** Keşif olay türleri — MRI §12 gözlemlenebilirlik listesiyle birebir. */
    public enum Kind {
        CANDIDATE_DISCOVERED,
        REJECTED_OEM_OWNED,
        REJECTED_FOREIGN_HELD,
        REJECTED_UNPROVABLE,
        REJECTED_COOLDOWN,
        OBSERVING,
        PASSIVE_EVIDENCE,
        VERIFIED_TRANSPORT,
        SELECTED_TRANSPORT,
        WRITE_ENABLED,
        WRITE_REFUSED,
        HEARTBEAT_ENABLED,
        HEARTBEAT_SUPPRESSED,
        NO_EVIDENCE_TIMEOUT,
        TRANSPORT_UNAVAILABLE,
        ARBITRATION_CONFLICT,
    }

    /** Tek kayıt — değiştirilemez. */
    public static final class Entry {
        public final long   atMs;
        public final Kind   kind;
        public final String subject;
        public final String detail;

        Entry(long atMs, Kind kind, String subject, String detail) {
            this.atMs = atMs; this.kind = kind; this.subject = subject; this.detail = detail;
        }

        @Override public String toString() {
            return kind + " " + subject + (detail == null || detail.isEmpty() ? "" : " (" + detail + ")");
        }
    }

    private static final ArrayDeque<Entry> RING = new ArrayDeque<>(CAPACITY);

    private SerialDiscoveryLedger() {}

    /** Olay kaydeder: logcat'e tek satır + bellek-içi halka (son 128). */
    public static void record(Kind kind, String subject, String detail) {
        Entry e = new Entry(System.currentTimeMillis(), kind, subject == null ? "?" : subject, detail);
        synchronized (RING) {
            if (RING.size() >= CAPACITY) RING.pollFirst();
            RING.addLast(e);
        }
        Log.i(TAG, e.toString());
    }

    /** Salt-okunur anlık görüntü (eski → yeni). */
    public static List<Entry> snapshot() {
        synchronized (RING) { return new ArrayList<>(RING); }
    }

    /** Yalnız test/teşhis: defteri boşaltır. */
    public static void clearForTest() {
        synchronized (RING) { RING.clear(); }
    }
}
