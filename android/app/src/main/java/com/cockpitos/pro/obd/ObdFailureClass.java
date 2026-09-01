package com.cockpitos.pro.obd;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Locale;

/**
 * P0-OBD-CORE-06 — bağlantı hatasının SINIFI (saf, statik, yan etkisiz).
 *
 * ── ÖLÇÜLEN KUSUR (saha 2026-08-25) ─────────────────────────────────────────
 * Sahada 17 başarısız bağlantı denemesi sayıldı ama NEDENLERİ hiçbir yerde
 * yoktu. Tek sınıflandırıcı JS tarafındaydı ({@code classifyObdErrorReason})
 * ve **hata MESAJINI regex'le** okuyordu. İki yapısal sorun:
 *
 *  1. {@code Throwable.getMessage()} Java'da {@code null} olabilir — özellikle
 *     yansıma (reflection) yoluyla açılan RFCOMM soketinden gelen istisnalarda
 *     ve bazı {@code SecurityException}'larda. Mesaj boş gidince JS sınıfı
 *     {@code unknown} yazıyordu: 17 başarısızlığın hepsi "bilinmiyor".
 *  2. Mesaj metni ROM'a/Android sürümüne göre değişir ("read failed, socket
 *     might closed or timeout, read ret: -1" cümlesi K24 OEM ROM'unda farklı).
 *     Yani ürünün teşhisi, cihaz üreticisinin metnine bağlıydı.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · Sınıf önce İSTİSNA TİPİNDEN (ve sebep zincirinden) türetilir — metin
 *    yalnız tip yetmediğinde, İKİNCİ kanıt olarak kullanılır.
 *  · Dönen değerler KAPALI bir kümedir ve TS tarafındaki
 *    {@code NATIVE_CONNECT_FAILURE_CLASSES} ile BİREBİR aynıdır. İki tarafta
 *    iki ayrı liste tutulmaz: küme sözleşmedir, tanınmayan değer JS'te reddedilir.
 *  · Ölçemediğinde {@code "unknown"} döner — SAHTE SINIF ÜRETİLMEZ.
 *  · PII yok: dönen değer bir enum dizesidir; MAC/cihaz adı/ham mesaj TAŞIMAZ.
 */
public final class ObdFailureClass {

    private ObdFailureClass() {}

    public static final String SOCKET_CLOSED       = "socket_closed";
    public static final String RESOURCE_BUSY       = "resource_busy";
    public static final String CONNECTION_REFUSED  = "connection_refused";
    public static final String BROKEN_PIPE         = "broken_pipe";
    public static final String READ_FAILED         = "read_failed";
    public static final String PERMISSION_DENIED   = "permission_denied";
    public static final String DEVICE_NOT_FOUND    = "device_not_found";
    public static final String BT_DISABLED         = "bt_disabled";
    public static final String BOND_FAILED         = "bond_failed";
    public static final String GATT_FAILURE        = "gatt_failure";
    public static final String ELM_INIT_FAILED     = "elm_init_failed";
    public static final String NO_VEHICLE_RESPONSE = "no_vehicle_response";
    public static final String TIMEOUT             = "timeout";
    public static final String IO_ERROR            = "io_error";
    public static final String INTERRUPTED         = "interrupted";
    public static final String UNKNOWN             = "unknown";

    /** Sebep zincirinde en fazla kaç adım gezilir (döngü koruması). */
    private static final int MAX_CAUSE_DEPTH = 6;

    /**
     * İstisnayı PII-güvenli bir sınıfa indirger.
     *
     * @param t Bağlantı denemesini düşüren istisna ({@code null} olabilir).
     * @return kapalı kümeden bir dize; ölçülemezse {@link #UNKNOWN}.
     */
    public static String of(Throwable t) {
        if (t == null) return UNKNOWN;

        // 1) TİP KANITI — sebep zinciri boyunca (en spesifik tip kazanır).
        Throwable cur = t;
        for (int depth = 0; cur != null && depth < MAX_CAUSE_DEPTH; depth++) {
            String byType = byType(cur);
            if (byType != null) return byType;
            Throwable next = cur.getCause();
            if (next == cur) break;                 // kendi kendine sebep — döngü koruması
            cur = next;
        }

        // 2) METİN KANITI — yalnız tip yetmediğinde; zincirdeki TÜM mesajlar birleşir
        //    (üst istisnanın mesajı null olsa bile sebebinki okunabilir).
        String msg = joinMessages(t);
        if (!msg.isEmpty()) {
            String byMsg = byMessage(msg);
            if (byMsg != null) return byMsg;
        }

        // 3) IOException ama alt ayrım yok → hâlâ ölçülmüş bir bilgi (metin değil, tip).
        if (t instanceof IOException) return IO_ERROR;

        return UNKNOWN;   // DÜRÜST BOŞLUK — uydurma yok
    }

    /** Yalnız istisna TİPİNDEN çıkan sınıf; çıkmıyorsa {@code null}. */
    private static String byType(Throwable t) {
        if (t instanceof ElmInitSequencer.UnableToConnectException) return NO_VEHICLE_RESPONSE;
        if (t instanceof ElmPromptTimeoutException)                 return ELM_INIT_FAILED;
        if (t instanceof SocketTimeoutException)                    return TIMEOUT;
        if (t instanceof InterruptedIOException)                    return INTERRUPTED;
        if (t instanceof InterruptedException)                      return INTERRUPTED;
        if (t instanceof ConnectException)                          return CONNECTION_REFUSED;
        if (t instanceof UnknownHostException)                      return DEVICE_NOT_FOUND;
        if (t instanceof SecurityException)                         return PERMISSION_DENIED;
        if (t instanceof IllegalArgumentException)                  return DEVICE_NOT_FOUND;
        return null;
    }

    /** Mesaj metninden çıkan sınıf; çıkmıyorsa {@code null}. Girdi küçük harf DEĞİL. */
    private static String byMessage(String raw) {
        final String m = raw.toLowerCase(Locale.ROOT);
        if (m.contains("ebusy") || m.contains("resource busy") || m.contains("device or resource busy")) {
            return RESOURCE_BUSY;
        }
        if (m.contains("connection refused") || m.contains("econnrefused")) return CONNECTION_REFUSED;
        if (m.contains("broken pipe") || m.contains("epipe"))               return BROKEN_PIPE;
        if (m.contains("socket might closed") || m.contains("socket closed")
            || m.contains("closed or timeout") || m.contains("read ret")
            || m.contains("bt socket") || m.contains("already closed")) {
            return SOCKET_CLOSED;
        }
        if (m.contains("read failed"))                                       return READ_FAILED;
        if (m.contains("permission") || m.contains("eacces")
            || m.contains("not allowed") || m.contains("izin yok")) {
            return PERMISSION_DENIED;
        }
        if (m.contains("bond") || m.contains("pair") || m.contains("eşleş")) return BOND_FAILED;
        if (m.contains("gatt"))                                              return GATT_FAILURE;
        if (m.contains("bluetooth desteklenmiyor") || m.contains("bluetooth kapalı")
            || m.contains("bt_disabled") || m.contains("adapter is off")) {
            return BT_DISABLED;
        }
        if (m.contains("unable to connect") || m.contains("no data")
            || m.contains("araç yanıt") || m.contains("protokol uyuş")) {
            return NO_VEHICLE_RESPONSE;
        }
        if (m.contains("elm") || m.contains("init"))                         return ELM_INIT_FAILED;
        if (m.contains("timeout") || m.contains("timed out")
            || m.contains("zaman aşımı")) {
            return TIMEOUT;
        }
        if (m.contains("not found") || m.contains("bulunamadı")
            || m.contains("no such device")) {
            return DEVICE_NOT_FOUND;
        }
        return null;
    }

    /**
     * Sebep zincirindeki mesajları birleştirir — üst istisnanın mesajı
     * {@code null} olduğunda kanıt SEBEPTE olabilir (sahadaki tam durum).
     */
    private static String joinMessages(Throwable t) {
        StringBuilder sb = new StringBuilder();
        Throwable cur = t;
        for (int depth = 0; cur != null && depth < MAX_CAUSE_DEPTH; depth++) {
            String m = cur.getMessage();
            if (m != null && !m.isEmpty()) {
                if (sb.length() > 0) sb.append(" | ");
                sb.append(m);
            }
            Throwable next = cur.getCause();
            if (next == cur) break;
            cur = next;
        }
        return sb.toString();
    }

    /**
     * JS'e gidecek MESAJ — {@code null} ASLA gönderilmez.
     * Mesaj yoksa istisnanın SINIF ADI kullanılır (ör. "java.io.IOException"):
     * bu bir metin uydurması değil, ölçülmüş bir gerçektir ve teşhisi kurtarır.
     */
    public static String messageOf(Throwable t) {
        if (t == null) return "unknown";
        String joined = joinMessages(t);
        return joined.isEmpty() ? t.getClass().getName() : joined;
    }
}
