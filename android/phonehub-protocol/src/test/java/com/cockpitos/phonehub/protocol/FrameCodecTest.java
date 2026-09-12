package com.cockpitos.phonehub.protocol;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * FrameCodecTest — çerçeveleme katmanının kilitleri (GÖREV 6 / GÖREV 20).
 *
 * Deterministiktir: rastgelelik yalnız SABİT tohumlu {@link Random} ile
 * üretilir, gerçek Bluetooth veya Android çalışma zamanı GEREKMEZ.
 */
public class FrameCodecTest {

    private static LinkFrame plainFrame(long id, String text) {
        return new LinkFrame(LinkFrame.FRAMING_VERSION, 0, id,
            new byte[0], text.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] encodeOrFail(LinkFrame f) {
        FrameCodec.EncodeResult r = FrameCodec.encode(f);
        assertTrue("kodlama başarısız: " + r.error, r.ok());
        return r.bytes;
    }

    /** Çözücüyü NEED_MORE gelene kadar sürer, çerçeveleri toplar. */
    private static List<LinkFrame> drain(FrameDecoder d, List<LinkErrorCode> errors) {
        List<LinkFrame> out = new ArrayList<>();
        for (;;) {
            FrameDecoder.Result r = d.next();
            if (r.status == FrameDecoder.Status.NEED_MORE) return out;
            if (r.status == FrameDecoder.Status.FRAME) out.add(r.frame);
            else errors.add(r.error);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Gidiş-dönüş
     * ════════════════════════════════════════════════════════════════════ */

    @Test
    public void roundTripPreservesEveryField() {
        LinkFrame src = new LinkFrame(LinkFrame.FRAMING_VERSION,
            LinkFrame.FLAG_ENCRYPTED | LinkFrame.FLAG_ACK_REQUIRED,
            0x0102030405060708L,
            new byte[LinkFrame.NONCE_BYTES],
            "merhaba".getBytes(StandardCharsets.UTF_8));

        FrameDecoder d = new FrameDecoder();
        byte[] wire = encodeOrFail(src);
        assertNull(d.append(wire, 0, wire.length));

        List<LinkErrorCode> errors = new ArrayList<>();
        List<LinkFrame> frames = drain(d, errors);

        assertEquals("hata olmamalı", 0, errors.size());
        assertEquals(1, frames.size());
        assertEquals(src, frames.get(0));
        assertEquals(0x0102030405060708L, frames.get(0).messageId());
        assertTrue(frames.get(0).isEncrypted());
        assertTrue(frames.get(0).isAckRequired());
    }

    @Test
    public void emptyPayloadIsValid() {
        FrameDecoder d = new FrameDecoder();
        byte[] wire = encodeOrFail(plainFrame(1L, ""));
        assertNull(d.append(wire, 0, wire.length));
        List<LinkErrorCode> errors = new ArrayList<>();
        assertEquals(1, drain(d, errors).size());
        assertEquals(0, errors.size());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Parçalı okuma · çoklu çerçeve
     * ════════════════════════════════════════════════════════════════════ */

    /** Bir çerçeve BAYT BAYT gelse bile çözülmeli (RFCOMM gerçeği). */
    @Test
    public void partialReadsAssembleSingleFrame() {
        byte[] wire = encodeOrFail(plainFrame(7L, "parçalı gelen yük"));
        FrameDecoder d = new FrameDecoder();
        List<LinkErrorCode> errors = new ArrayList<>();
        List<LinkFrame> frames = new ArrayList<>();

        for (int i = 0; i < wire.length; i++) {
            assertNull(d.append(wire, i, 1));
            frames.addAll(drain(d, errors));
        }
        assertEquals(0, errors.size());
        assertEquals(1, frames.size());
        assertEquals("parçalı gelen yük",
            new String(frames.get(0).payload(), StandardCharsets.UTF_8));
    }

    /** Tek bir read içinde üç çerçeve → üçü de çözülmeli. */
    @Test
    public void multipleFramesInOneReadAreAllDecoded() {
        FrameDecoder d = new FrameDecoder();
        byte[] a = encodeOrFail(plainFrame(1L, "bir"));
        byte[] b = encodeOrFail(plainFrame(2L, "iki"));
        byte[] c = encodeOrFail(plainFrame(3L, "üç"));

        byte[] all = new byte[a.length + b.length + c.length];
        System.arraycopy(a, 0, all, 0, a.length);
        System.arraycopy(b, 0, all, a.length, b.length);
        System.arraycopy(c, 0, all, a.length + b.length, c.length);

        assertNull(d.append(all, 0, all.length));
        List<LinkErrorCode> errors = new ArrayList<>();
        List<LinkFrame> frames = drain(d, errors);

        assertEquals(0, errors.size());
        assertEquals(3, frames.size());
        assertEquals(1L, frames.get(0).messageId());
        assertEquals(2L, frames.get(1).messageId());
        assertEquals(3L, frames.get(2).messageId());
    }

    /** Rastgele parçalanmış uzun akış — sıra ve içerik korunmalı. */
    @Test
    public void randomlyChunkedStreamKeepsOrderAndContent() {
        final int count = 40;
        StringBuilder expected = new StringBuilder();
        java.io.ByteArrayOutputStream stream = new java.io.ByteArrayOutputStream();
        for (int i = 0; i < count; i++) {
            String text = "mesaj-" + i;
            expected.append(text).append('|');
            byte[] w = encodeOrFail(plainFrame(i, text));
            stream.write(w, 0, w.length);
        }
        byte[] all = stream.toByteArray();

        FrameDecoder d = new FrameDecoder();
        List<LinkErrorCode> errors = new ArrayList<>();
        StringBuilder actual = new StringBuilder();
        Random rnd = new Random(20260726L);

        int pos = 0;
        while (pos < all.length) {
            int chunk = 1 + rnd.nextInt(97);
            if (pos + chunk > all.length) chunk = all.length - pos;
            assertNull(d.append(all, pos, chunk));
            pos += chunk;
            for (LinkFrame f : drain(d, errors)) {
                actual.append(new String(f.payload(), StandardCharsets.UTF_8)).append('|');
            }
        }
        assertEquals(0, errors.size());
        assertEquals(expected.toString(), actual.toString());
        assertEquals(count, d.framesDecoded());
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Bozuk girdi
     * ════════════════════════════════════════════════════════════════════ */

    /** Sağlama bozulursa çerçeve ATILIR ama akış SENKRONDA kalır. */
    @Test
    public void checksumFailureIsReportedAndStreamStaysInSync() {
        byte[] bad = encodeOrFail(plainFrame(1L, "bozulacak"));
        bad[LinkFrame.FIXED_HEADER_BYTES + 2] ^= 0xFF;   // yükü boz
        byte[] good = encodeOrFail(plainFrame(2L, "sağlam"));

        FrameDecoder d = new FrameDecoder();
        assertNull(d.append(bad, 0, bad.length));
        assertNull(d.append(good, 0, good.length));

        List<LinkErrorCode> errors = new ArrayList<>();
        List<LinkFrame> frames = drain(d, errors);

        assertEquals(1, errors.size());
        assertEquals(LinkErrorCode.CHECKSUM_FAILED, errors.get(0));
        assertEquals("bozuk çerçeve sonrası sağlam çerçeve okunmalı", 1, frames.size());
        assertEquals(2L, frames.get(0).messageId());
        assertEquals(1L, d.checksumFailures());
    }

    /** Beyan edilen yük tavanı aşarsa reddedilir — bellek şişirilemez. */
    @Test
    public void oversizedDeclaredPayloadIsRejected() {
        byte[] wire = encodeOrFail(plainFrame(1L, "x"));
        // payloadLength alanını 100 MB yap
        wire[8] = 0x06; wire[9] = 0x00; wire[10] = 0x00; wire[11] = 0x00;

        FrameDecoder d = new FrameDecoder();
        assertNull(d.append(wire, 0, wire.length));
        List<LinkErrorCode> errors = new ArrayList<>();
        drain(d, errors);

        assertTrue("tavan aşımı raporlanmalı", errors.contains(LinkErrorCode.FRAME_TOO_LARGE));
        assertTrue(d.oversizeRejections() >= 1);
    }

    /** Negatif görünen uzunluk (yüksek bit) reddedilmeli, taşma OLMAMALI. */
    @Test
    public void negativeLookingLengthIsRejected() {
        byte[] wire = encodeOrFail(plainFrame(1L, "x"));
        wire[8] = (byte) 0xFF; wire[9] = (byte) 0xFF;
        wire[10] = (byte) 0xFF; wire[11] = (byte) 0xFF;

        FrameDecoder d = new FrameDecoder();
        assertNull(d.append(wire, 0, wire.length));
        List<LinkErrorCode> errors = new ArrayList<>();
        drain(d, errors);
        assertTrue(errors.contains(LinkErrorCode.FRAME_TOO_LARGE));
    }

    /** Bilinmeyen bayrak sessizce kabul EDİLMEZ. */
    @Test
    public void unknownFlagBitIsRejected() {
        byte[] wire = encodeOrFail(plainFrame(1L, "x"));
        wire[5] = (byte) 0x80;

        FrameDecoder d = new FrameDecoder();
        assertNull(d.append(wire, 0, wire.length));
        List<LinkErrorCode> errors = new ArrayList<>();
        drain(d, errors);
        assertTrue(errors.contains(LinkErrorCode.FRAME_MALFORMED));
    }

    /** Şifreli bayrak var ama nonce yoksa çerçeve REDDEDİLİR (sahte güven yok). */
    @Test
    public void encryptedFlagWithoutNonceIsRejectedAtEncode() {
        LinkFrame bogus = new LinkFrame(LinkFrame.FRAMING_VERSION,
            LinkFrame.FLAG_ENCRYPTED, 1L, new byte[0], new byte[] { 1, 2, 3 });
        FrameCodec.EncodeResult r = FrameCodec.encode(bogus);
        assertTrue("nonce'suz şifreli çerçeve kodlanmamalı", !r.ok());
        assertEquals(LinkErrorCode.FRAME_MALFORMED, r.error);
    }

    /** Önde çöp varsa resync ile sonraki geçerli çerçeve bulunmalı. */
    @Test
    public void leadingGarbageIsResynced() {
        byte[] garbage = "ÇÖÖÖP-VERİ-XYZ".getBytes(StandardCharsets.UTF_8);
        byte[] good = encodeOrFail(plainFrame(9L, "sonunda"));

        FrameDecoder d = new FrameDecoder();
        assertNull(d.append(garbage, 0, garbage.length));
        assertNull(d.append(good, 0, good.length));

        List<LinkErrorCode> errors = new ArrayList<>();
        List<LinkFrame> frames = drain(d, errors);

        assertEquals(0, errors.size());
        assertEquals(1, frames.size());
        assertEquals(9L, frames.get(0).messageId());
        assertTrue("resync sayacı artmalı", d.resyncEvents() >= 1);
    }

    /** Resync SINIRSIZ değildir — bütçe aşılınca hata döner. */
    @Test
    public void resyncIsBoundedAndEventuallyFails() {
        FrameDecoder d = new FrameDecoder();
        byte[] junk = new byte[4096];
        for (int i = 0; i < junk.length; i++) junk[i] = (byte) (i % 251);

        LinkErrorCode seen = null;
        for (int round = 0; round < 8 && seen == null; round++) {
            LinkErrorCode appendErr = d.append(junk, 0, junk.length);
            if (appendErr != null) { seen = appendErr; break; }
            for (;;) {
                FrameDecoder.Result r = d.next();
                if (r.status == FrameDecoder.Status.NEED_MORE) break;
                if (r.status == FrameDecoder.Status.ERROR) { seen = r.error; break; }
            }
        }
        assertNotNull("sınırsız resync olmamalı", seen);
        assertEquals(LinkErrorCode.FRAME_MALFORMED, seen);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Sayaç sözleşmesi
     * ════════════════════════════════════════════════════════════════════ */

    /** Sayaç sıfırlama akış hizasını BOZMAMALI (GÖREV 14 kuralı). */
    @Test
    public void resetCountersKeepsStreamAlignment() {
        FrameDecoder d = new FrameDecoder();
        byte[] a = encodeOrFail(plainFrame(1L, "önce"));
        byte[] b = encodeOrFail(plainFrame(2L, "sonra"));

        assertNull(d.append(a, 0, a.length));
        List<LinkErrorCode> errors = new ArrayList<>();
        assertEquals(1, drain(d, errors).size());
        assertEquals(1L, d.framesDecoded());

        d.resetCounters();
        assertEquals(0L, d.framesDecoded());

        assertNull(d.append(b, 0, b.length));
        List<LinkFrame> after = drain(d, errors);
        assertEquals(1, after.size());
        assertEquals(2L, after.get(0).messageId());
        assertEquals(0, errors.size());
    }

    /** Dönen diziler KOPYADIR — çağıran iç durumu değiştiremez. */
    @Test
    public void accessorsReturnDefensiveCopies() {
        byte[] payload = { 1, 2, 3 };
        LinkFrame f = new LinkFrame(LinkFrame.FRAMING_VERSION, 0, 1L, new byte[0], payload);
        payload[0] = 99;
        assertArrayEquals(new byte[] { 1, 2, 3 }, f.payload());

        byte[] got = f.payload();
        got[0] = 42;
        assertArrayEquals(new byte[] { 1, 2, 3 }, f.payload());
    }

    /** toString PII veya yük İÇERİĞİ taşımamalı — loglanabilir olmalı. */
    @Test
    public void toStringDoesNotLeakPayloadContent() {
        LinkFrame f = plainFrame(5L, "GİZLİ-İÇERİK-0555");
        String s = f.toString();
        assertTrue(!s.contains("GİZLİ"));
        assertTrue(!s.contains("0555"));
        assertTrue(s.contains("len=" + f.payloadLength()));
    }
}
