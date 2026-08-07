package com.cockpitos.phonehub.protocol;

/**
 * FrameDecoder — akış (stream) çözücü (GÖREV 6, okuma yönü).
 *
 * ── NEDEN AYRI BİR ÇÖZÜCÜ ───────────────────────────────────────────────────
 * RFCOMM'dan gelen her `read()` çağrısı bir MESAJ değildir: yarım çerçeve de
 * gelebilir, arka arkaya üç çerçeve de. Çözücü bu iki durumu da tek bir tamponla
 * ele alır ve çağırana "tam çerçeve" ya da "daha fazla bayt gerekli" der.
 *
 * ── SINIRLILIK (BOUNDED) — PAZARLIKSIZ ──────────────────────────────────────
 * Tampon sınırsız BÜYÜMEZ. Karşı taraf (veya hat gürültüsü) hiç geçerli çerçeve
 * üretmese bile bellek tavanı sabittir; tavan aşılırsa kodlanmış hata döner.
 *
 * ── BOZUK MAGIC → SINIRLI RESYNC ────────────────────────────────────────────
 * Akış kayarsa (hat gürültüsü, yarım yazım) çözücü ileri doğru magic arar.
 * Bu arama SINIRSIZ DEĞİLDİR: {@link #MAX_RESYNC_BYTES} bayt boyunca geçerli
 * çerçeve bulunamazsa bağlantı umutsuz kabul edilir ve hata döner. Sonsuz
 * "yeniden hizalama" döngüsü, sessiz bir CPU yakıcıdır.
 *
 * ── BOZUK ÇERÇEVE BAĞLANTIYI TEK BAŞINA ÇÖKERTMEZ ───────────────────────────
 * Sağlama hatası olan çerçeve ATILIR ve akış senkronda kalır (uzunluklar
 * geçerliydi). Oturumu kapatma kararı ÇAĞIRANA aittir: art arda ihlal eşiği
 * (bkz. LinkSession) aşılınca kapatılır. Tek bir bozuk çerçeve = kopma DEĞİL.
 *
 * İş parçacığı güvenliği: DEĞİLDİR. Tek bir okuma worker'ına aittir.
 */
public final class FrameDecoder {

    /** Geçerli çerçeve bulunamadan taranabilecek azami bayt. */
    public static final int MAX_RESYNC_BYTES = 16 * 1024;

    /** Tampon tavanı: en büyük çerçeve + resync payı. */
    private static final int MAX_BUFFER_BYTES =
        LinkFrame.FIXED_HEADER_BYTES + LinkFrame.MAX_HEADER_BYTES
            + LinkFrame.MAX_PAYLOAD_BYTES + 4096;

    public enum Status { FRAME, NEED_MORE, ERROR }

    /** Tek bir çözme adımının sonucu. */
    public static final class Result {
        public final Status status;
        public final LinkFrame frame;
        public final LinkErrorCode error;

        private Result(Status s, LinkFrame f, LinkErrorCode e) {
            this.status = s; this.frame = f; this.error = e;
        }

        static final Result NEED_MORE = new Result(Status.NEED_MORE, null, null);
        static Result frame(LinkFrame f) { return new Result(Status.FRAME, f, null); }
        static Result error(LinkErrorCode c) { return new Result(Status.ERROR, null, c); }
    }

    private byte[] buf = new byte[4096];
    private int start;   // okunacak ilk bayt
    private int end;     // son baytın bir sonrası

    private final int maxPayloadBytes;

    /* Sayaçlar — tanı ekranı bunları GERÇEK veri olarak gösterir. */
    private long framesDecoded;
    private long bytesConsumed;
    private long checksumFailures;
    private long malformedFrames;
    private long oversizeRejections;
    private long resyncEvents;
    private long resyncSkippedBytes;

    /** Son geçerli çerçeveden bu yana atılan bayt (resync bütçesi). */
    private int resyncBudgetUsed;

    public FrameDecoder() {
        this(LinkFrame.MAX_PAYLOAD_BYTES);
    }

    /** Yük tavanı düşürülebilir (ör. düşük bellekli head unit). Yükseltilemez. */
    public FrameDecoder(int maxPayloadBytes) {
        int m = maxPayloadBytes;
        if (m <= 0 || m > LinkFrame.MAX_PAYLOAD_BYTES) m = LinkFrame.MAX_PAYLOAD_BYTES;
        this.maxPayloadBytes = m;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Besleme
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Sokettten okunan baytları tampona ekler.
     *
     * @return null ise kabul edildi; değilse tavan aşıldı ve veri EKLENMEDİ.
     */
    public LinkErrorCode append(byte[] data, int offset, int length) {
        if (data == null || length <= 0) return null;
        if (offset < 0 || length < 0 || offset + length > data.length) {
            malformedFrames++;
            return LinkErrorCode.FRAME_MALFORMED;
        }
        if (available() + length > MAX_BUFFER_BYTES) {
            oversizeRejections++;
            return LinkErrorCode.FRAME_TOO_LARGE;
        }
        ensureCapacity(length);
        System.arraycopy(data, offset, buf, end, length);
        end += length;
        return null;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Çözme
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Tampondan SIRADAKİ çerçeveyi çözmeye çalışır.
     *
     * Bir `read()` içinde birden çok çerçeve gelebileceği için çağıran bunu
     * {@code NEED_MORE} dönene kadar DÖNGÜ İÇİNDE çağırmalıdır.
     */
    public Result next() {
        for (;;) {
            int avail = available();
            if (avail < 4) return Result.NEED_MORE;

            /* 1 · Magic hizası */
            if (!magicAt(start)) {
                int idx = indexOfMagic(start + 1);
                if (idx < 0) {
                    /* Magic yok. Sınırda yarım magic olabilir → son 3 baytı SAKLA. */
                    int drop = avail - 3;
                    if (drop > 0) {
                        start += drop;
                        bytesConsumed += drop;
                        resyncSkippedBytes += drop;
                        resyncBudgetUsed += drop;
                        resyncEvents++;
                    }
                    compact();
                    if (resyncBudgetUsed > MAX_RESYNC_BYTES) {
                        return Result.error(LinkErrorCode.FRAME_MALFORMED);
                    }
                    return Result.NEED_MORE;
                }
                int skipped = idx - start;
                start = idx;
                bytesConsumed += skipped;
                resyncSkippedBytes += skipped;
                resyncBudgetUsed += skipped;
                resyncEvents++;
                if (resyncBudgetUsed > MAX_RESYNC_BYTES) {
                    compact();
                    return Result.error(LinkErrorCode.FRAME_MALFORMED);
                }
                continue;
            }

            /* 2 · Sabit başlık tam mı */
            if (avail < LinkFrame.FIXED_HEADER_BYTES) return Result.NEED_MORE;

            int version = buf[start + 4] & 0xFF;
            int flags = buf[start + 5] & 0xFF;
            int headerLen = ((buf[start + 6] & 0xFF) << 8) | (buf[start + 7] & 0xFF);
            long payloadLenRaw =
                  ((long) (buf[start + 8] & 0xFF) << 24)
                | ((long) (buf[start + 9] & 0xFF) << 16)
                | ((long) (buf[start + 10] & 0xFF) << 8)
                | ((long) (buf[start + 11] & 0xFF));

            /* 3 · Başlık akla yatkın mı — DEĞİLSE uzunluklara GÜVENİLMEZ.
             * Bu yüzden yalnız 4 bayt (magic) atlanır ve resync sürer; yanlış
             * bir uzunluğa göre atlamak akışı büsbütün kaydırırdı. */
            boolean headerSane = version == LinkFrame.FRAMING_VERSION
                && (flags & ~LinkFrame.KNOWN_FLAGS) == 0
                && headerLen >= 0 && headerLen <= LinkFrame.MAX_HEADER_BYTES
                && payloadLenRaw >= 0 && payloadLenRaw <= maxPayloadBytes
                && (((flags & LinkFrame.FLAG_ENCRYPTED) == 0)
                    || headerLen == LinkFrame.NONCE_BYTES);

            if (!headerSane) {
                boolean oversize = payloadLenRaw > maxPayloadBytes
                    || headerLen > LinkFrame.MAX_HEADER_BYTES;
                if (oversize) oversizeRejections++; else malformedFrames++;
                start += 4;
                bytesConsumed += 4;
                resyncBudgetUsed += 4;
                compact();
                return Result.error(oversize
                    ? LinkErrorCode.FRAME_TOO_LARGE
                    : LinkErrorCode.FRAME_MALFORMED);
            }

            int payloadLen = (int) payloadLenRaw;
            int total = LinkFrame.FIXED_HEADER_BYTES + headerLen + payloadLen;
            if (avail < total) return Result.NEED_MORE;

            /* 4 · Sağlama */
            long declared =
                  ((long) (buf[start + 20] & 0xFF) << 24)
                | ((long) (buf[start + 21] & 0xFF) << 16)
                | ((long) (buf[start + 22] & 0xFF) << 8)
                | ((long) (buf[start + 23] & 0xFF));

            byte[] ext = new byte[headerLen];
            System.arraycopy(buf, start + LinkFrame.FIXED_HEADER_BYTES, ext, 0, headerLen);
            byte[] payload = new byte[payloadLen];
            System.arraycopy(buf, start + LinkFrame.FIXED_HEADER_BYTES + headerLen,
                payload, 0, payloadLen);

            /* messageId çerçeve TÜKETİLMEDEN önce okunur: `compact()` veriyi
             * tamponun başına kaydırdığı için tüketim sonrası mutlak indeks
             * geçersizdir. */
            long messageId = 0L;
            for (int i = 0; i < 8; i++) {
                messageId = (messageId << 8) | (buf[start + 12 + i] & 0xFFL);
            }

            /* Uzunluklar geçerliydi → çerçeveyi TAM tüket, akış senkronda kalsın. */
            start += total;
            bytesConsumed += total;
            compact();

            long actual = FrameCodec.checksumOf(ext, payload);
            if (actual != declared) {
                checksumFailures++;
                return Result.error(LinkErrorCode.CHECKSUM_FAILED);
            }

            framesDecoded++;
            resyncBudgetUsed = 0;
            return Result.frame(new LinkFrame(version, flags, messageId, ext, payload));
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Sayaçlar ve durum
     * ════════════════════════════════════════════════════════════════════ */

    public long framesDecoded() { return framesDecoded; }
    public long bytesConsumed() { return bytesConsumed; }
    public long checksumFailures() { return checksumFailures; }
    public long malformedFrames() { return malformedFrames; }
    public long oversizeRejections() { return oversizeRejections; }
    public long resyncEvents() { return resyncEvents; }
    public long resyncSkippedBytes() { return resyncSkippedBytes; }
    public int bufferedBytes() { return available(); }

    /** Sayaçları sıfırlar — tamponu ve akış hizasını BOZMAZ (GÖREV 14). */
    public void resetCounters() {
        framesDecoded = 0; bytesConsumed = 0; checksumFailures = 0;
        malformedFrames = 0; oversizeRejections = 0;
        resyncEvents = 0; resyncSkippedBytes = 0;
    }

    /** Tamponu boşaltır — yeni oturum başlarken çağrılır. */
    public void reset() {
        start = 0; end = 0; resyncBudgetUsed = 0;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İç yardımcılar
     * ════════════════════════════════════════════════════════════════════ */

    private int available() { return end - start; }

    private boolean magicAt(int i) {
        if (i + 4 > end) return false;
        return buf[i] == LinkFrame.MAGIC[0]
            && buf[i + 1] == LinkFrame.MAGIC[1]
            && buf[i + 2] == LinkFrame.MAGIC[2]
            && buf[i + 3] == LinkFrame.MAGIC[3];
    }

    private int indexOfMagic(int from) {
        for (int i = Math.max(from, start); i + 4 <= end; i++) {
            if (magicAt(i)) return i;
        }
        return -1;
    }

    private void ensureCapacity(int extra) {
        if (end + extra <= buf.length) return;
        compact();
        if (end + extra <= buf.length) return;
        int needed = available() + extra;
        int cap = buf.length;
        while (cap < needed) cap = Math.min(cap * 2, MAX_BUFFER_BYTES + 64);
        byte[] nb = new byte[cap];
        System.arraycopy(buf, start, nb, 0, available());
        end = available();
        start = 0;
        buf = nb;
    }

    private void compact() {
        if (start == 0) return;
        int avail = available();
        if (avail > 0) System.arraycopy(buf, start, buf, 0, avail);
        start = 0;
        end = avail;
    }
}
