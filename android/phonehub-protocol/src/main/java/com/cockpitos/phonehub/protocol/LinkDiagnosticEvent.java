package com.cockpitos.phonehub.protocol;

/**
 * LinkDiagnosticEvent — yapısal tanı olayı (GÖREV 16).
 *
 * ── NEDEN SERBEST METİN LOG DEĞİL ───────────────────────────────────────────
 * "Bağlanamadı" satırı sahada işe yaramaz. Hangi TARAF, hangi AŞAMA, hangi
 * KOD — bu üçlü olmadan bir arıza tekrar üretilemez. Yapısal olay bu üçlüyü
 * ZORUNLU kılar ve serbest metni {@code safeDetails} içinde sınırlı tutar.
 *
 * ── GİZLİLİK: ALAN DÜZEYİNDE YASAK ──────────────────────────────────────────
 * {@code safeDetails} ham exception metni DEĞİLDİR. MAC · eşleştirme kodu ·
 * telefon numarası · kişi adı · mesaj/bildirim içeriği · anahtar · ham yük ·
 * SSID · IP buraya GİREMEZ. {@link LinkDiagnosticBuffer} yazma yolunda bunu
 * ayrıca süzer — tek kapı değil, iki kapı.
 */
public final class LinkDiagnosticEvent {

    public enum Side { HEAD_UNIT, PHONE }

    public enum Category {
        LIFECYCLE, PERMISSION, BLUETOOTH, SOCKET, FRAME,
        NEGOTIATION, PAIRING, SECURITY, HEARTBEAT, RECONNECT, SERVICE, UI
    }

    public enum Severity { DEBUG, INFO, WARN, ERROR }

    /** {@code safeDetails} tavanı — sınırsız metin log şişirir. */
    public static final int MAX_DETAIL_CHARS = 160;

    private final long timestampMs;
    private final Side side;
    private final Category category;
    private final String stage;
    private final LinkErrorCode code;
    private final Severity severity;
    private final long sessionGeneration;
    private final String safeDetails;

    public LinkDiagnosticEvent(long timestampMs, Side side, Category category, String stage,
                               LinkErrorCode code, Severity severity,
                               long sessionGeneration, String safeDetails) {
        this.timestampMs = timestampMs;
        this.side = side == null ? Side.HEAD_UNIT : side;
        this.category = category == null ? Category.LIFECYCLE : category;
        this.stage = stage == null ? "" : clamp(stage, 48);
        this.code = code;
        this.severity = severity == null ? Severity.INFO : severity;
        this.sessionGeneration = sessionGeneration;
        this.safeDetails = safeDetails == null ? "" : clamp(safeDetails, MAX_DETAIL_CHARS);
    }

    public long timestampMs() { return timestampMs; }
    public Side side() { return side; }
    public Category category() { return category; }
    public String stage() { return stage; }
    public LinkErrorCode code() { return code; }
    public Severity severity() { return severity; }
    public long sessionGeneration() { return sessionGeneration; }
    public String safeDetails() { return safeDetails; }

    /** Tanı dışa aktarımı için satır — PII taşımaz. */
    public String toLine() {
        return timestampMs + "|" + side + "|" + category + "|" + stage
            + "|" + (code == null ? "-" : code.name())
            + "|" + severity + "|g" + sessionGeneration
            + "|" + safeDetails;
    }

    @Override
    public String toString() { return toLine(); }

    private static String clamp(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
