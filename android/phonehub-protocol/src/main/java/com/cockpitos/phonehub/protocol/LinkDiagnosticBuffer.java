package com.cockpitos.phonehub.protocol;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Locale;

/**
 * LinkDiagnosticBuffer — sınırlı (bounded) dairesel tanı defteri (GÖREV 16).
 *
 * ── NEDEN SINIRLI ───────────────────────────────────────────────────────────
 * Bir bağlantı arızası saniyede yüzlerce olay üretebilir (kopma → yeniden
 * bağlanma döngüsü). Sınırsız log, arızanın kendisinden daha büyük bir arızaya
 * (bellek tükenmesi) dönüşür. Defter sabit kapasitelidir; en eski olay düşer
 * ve DÜŞEN SAYISI sayılır — "kayıp yok" gibi davranılmaz.
 *
 * ── İKİNCİ GİZLİLİK KAPISI ──────────────────────────────────────────────────
 * Olayın kendisi zaten sınırlıdır; burada YAZMA YOLUNDA ikinci bir süzgeç
 * vardır. MAC benzeri desenler, uzun onaltılık diziler ve yasak anahtar
 * sözcükler içeren ayrıntı REDDEDİLİR (olay yine kaydedilir, ayrıntısı
 * {@code [REDACTED]} olur). Tek kapıya güvenmek, bir gün birinin o kapıyı
 * atlamasıyla biter.
 *
 * İş parçacığı güvenliği: tüm erişim {@code synchronized} — okuma UI'dan,
 * yazma worker'dan gelir.
 */
public final class LinkDiagnosticBuffer {

    public static final int DEFAULT_CAPACITY = 200;

    /** Ayrıntıda geçmesi yasak anahtar sözcükler (küçük harfe indirgenerek). */
    private static final String[] FORBIDDEN_HINTS = {
        "mac", "bdaddr", "passkey", "pin", "code=", "phone", "msisdn",
        "contact", "notification", "track", "privatekey", "private_key",
        "secret", "sessionkey", "session_key", "nonce", "ssid", "ipaddr",
        "password", "token", "bearer",
    };

    private final int capacity;
    private final Deque<LinkDiagnosticEvent> events = new ArrayDeque<>();

    private long droppedCount;
    private long totalRecorded;
    private long redactedCount;

    public LinkDiagnosticBuffer() { this(DEFAULT_CAPACITY); }

    public LinkDiagnosticBuffer(int capacity) {
        this.capacity = capacity > 0 && capacity <= 2000 ? capacity : DEFAULT_CAPACITY;
    }

    /**
     * Olay kaydeder. Ayrıntı şüpheliyse olay KAYBEDİLMEZ, yalnız ayrıntısı
     * maskelenir — arızanın varlığı gizlilik uğruna silinmez.
     */
    public synchronized void record(LinkDiagnosticEvent event) {
        if (event == null) return;

        LinkDiagnosticEvent safe = event;
        String details = event.safeDetails();
        if (looksSensitive(details)) {
            redactedCount++;
            safe = new LinkDiagnosticEvent(event.timestampMs(), event.side(),
                event.category(), event.stage(), event.code(), event.severity(),
                event.sessionGeneration(), "[REDACTED]");
        }

        events.addLast(safe);
        totalRecorded++;
        while (events.size() > capacity) {
            events.pollFirst();
            droppedCount++;
        }
    }

    /** Kısa yol — çağrı yerinde okunabilirlik için. */
    public void record(long nowMs, LinkDiagnosticEvent.Side side,
                       LinkDiagnosticEvent.Category category, String stage,
                       LinkErrorCode code, LinkDiagnosticEvent.Severity severity,
                       long generation, String safeDetails) {
        record(new LinkDiagnosticEvent(nowMs, side, category, stage, code,
            severity, generation, safeDetails));
    }

    public synchronized List<LinkDiagnosticEvent> snapshot() {
        return new ArrayList<>(events);
    }

    /** En son N olay (yeni → eski). Tanı ekranı bunu gösterir. */
    public synchronized List<LinkDiagnosticEvent> recent(int limit) {
        int n = limit <= 0 ? 0 : Math.min(limit, events.size());
        List<LinkDiagnosticEvent> all = new ArrayList<>(events);
        List<LinkDiagnosticEvent> out = new ArrayList<>(n);
        for (int i = all.size() - 1; i >= all.size() - n; i--) out.add(all.get(i));
        return out;
    }

    public synchronized int size() { return events.size(); }
    public int capacity() { return capacity; }
    public synchronized long droppedCount() { return droppedCount; }
    public synchronized long totalRecorded() { return totalRecorded; }
    public synchronized long redactedCount() { return redactedCount; }

    public synchronized void clear() {
        events.clear();
        droppedCount = 0;
        totalRecorded = 0;
        redactedCount = 0;
    }

    /**
     * Şüpheli desen sezgisi. Kasıtlı olarak GENİŞ tutulur: yanlış-pozitif
     * (gereksiz maskeleme) kabul edilebilir, yanlış-negatif (PII sızması)
     * kabul EDİLEMEZ.
     */
    static boolean looksSensitive(String details) {
        if (details == null || details.isEmpty()) return false;
        String lower = details.toLowerCase(Locale.ROOT);

        for (String hint : FORBIDDEN_HINTS) {
            if (lower.contains(hint)) return true;
        }
        /* MAC deseni: AA:BB:CC:DD:EE:FF veya AA-BB-... */
        if (lower.matches(".*\\b[0-9a-f]{2}([:-])[0-9a-f]{2}\\1[0-9a-f]{2}\\1[0-9a-f]{2}.*")) {
            return true;
        }
        /* Uzun onaltılık dizi: anahtar/nonce/ham yük olabilir. */
        if (lower.matches(".*\\b[0-9a-f]{24,}\\b.*")) return true;
        /* 6+ haneli çıplak sayı dizisi: eşleştirme kodu veya telefon numarası. */
        if (lower.matches(".*\\b\\d{6,}\\b.*")) return true;
        return false;
    }
}
