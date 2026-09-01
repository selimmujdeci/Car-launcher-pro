package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * IsoTpTuningTest — P0-VDK-F1C kilitleri (yerel JVM, cihaz gerekmez).
 *
 * ── NEDEN JAVA TARAFINDA TEST ─────────────────────────────────────────────
 * ISO-TP tuning'in ASIL sözleşmesi ATOMİKLİKTİR: ayar kur → oku → **her
 * durumda** geri al. Bu sözleşme native'de yaşar ve TS mock'larıyla
 * doğrulanamaz — okuma istisna fırlattığında restore'un GERÇEKTEN çalıştığını
 * ancak burada kanıtlayabiliriz.
 *
 * KİLİTLER:
 *  1. Destekli adaptörde üç AT komutu da gönderilir ve tuning UYGULANIR.
 *  2. Herhangi bir komut "?" derse tuning UYGULANMADI sayılır (fail-soft).
 *  3. Restore `ATFCSM0` gönderir ve sonucu KANITA yazar.
 *  4. Restore başarısızlığı GÖRÜNÜR (sessizce geçilmez).
 *  5. ISO-TP çerçeve sayımı ölçümdür (tahmin değil).
 */
public class IsoTpTuningTest {

    /** Gönderilen her komutu kaydeden + komut→yanıt haritalı sahte kanal. */
    private static final class RecordingChannel implements ElmCommandChannel {
        final java.util.List<String> sent = new java.util.ArrayList<>();
        private final java.util.Map<String, String> responses = new java.util.HashMap<>();
        private String defaultResponse = "OK";

        RecordingChannel on(String cmd, String response) {
            responses.put(cmd, response);
            return this;
        }

        @Override
        public String send(String cmd, int timeoutMs) {
            sent.add(cmd);
            return responses.getOrDefault(cmd, defaultResponse);
        }

        @Override
        public void close() { /* no-op */ }
    }

    private static ElmProtocol protocol(RecordingChannel ch) {
        return new ElmProtocol(ch);
    }

    private static boolean sentContains(java.util.List<String> sent, String cmd) {
        for (String s : sent) if (cmd.equals(s)) return true;
        return false;
    }

    // ── Kilit 1: destekli adaptörde tuning UYGULANIR ───────────────────────────

    @Test
    public void appliesFlowControlOnCapableAdapter() {
        RecordingChannel ch = new RecordingChannel();
        ElmProtocol p = protocol(ch);

        ElmProtocol.IsoTpTuningEvidence ev = p.applyIsoTpFlowControl("7E0");

        assertTrue("destekli adaptörde tuning uygulanmalı", ev.applied);
        assertTrue("ATFCSH gönderilmedi", sentContains(ch.sent, "ATFCSH7E0"));
        assertTrue("ATFCSD gönderilmedi", sentContains(ch.sent, "ATFCSD300000"));
        assertTrue("ATFCSM gönderilmedi", sentContains(ch.sent, "ATFCSM1"));
        assertTrue("komut kanıtı taşınmıyor", ev.commands.contains("ATFCSH7E0=OK"));
    }

    /**
     * ATCAF ve ATCRA'ya DOKUNULMADIĞI kilitlenir.
     *
     * ATCAF0 ELM327'nin ISO-TP birleştirmesini kapatır ve `splitResponseBodies`
     * (tüm çözücülerin dayandığı) bozulur. ATCRA ise ZATEN `setEcuHeader`
     * tarafından yönetilir; ikinci otorite o atomikliği bozardı.
     */
    @Test
    public void doesNotTouchAutoFormattingOrReceiveFilter() {
        RecordingChannel ch = new RecordingChannel();
        protocol(ch).applyIsoTpFlowControl("7E0");

        for (String s : ch.sent) {
            assertFalse("ATCAF'a DOKUNULMAMALI (splitResponseBodies bozulur): " + s,
                s.startsWith("ATCAF"));
            assertFalse("ATCRA'ya DOKUNULMAMALI (setEcuHeader yönetiyor): " + s,
                s.startsWith("ATCRA"));
        }
    }

    // ── Kilit 2: desteklenmeyen komut → FAIL-SOFT ─────────────────────────────

    @Test
    public void failsSoftWhenAdapterRejectsCommand() {
        // Klon adaptör: ATFCSM'i bilmiyor → "?"
        RecordingChannel ch = new RecordingChannel().on("ATFCSM1", "?");
        ElmProtocol p = protocol(ch);

        ElmProtocol.IsoTpTuningEvidence ev = p.applyIsoTpFlowControl("7E0");

        assertFalse("komut reddedildiğinde tuning UYGULANMADI sayılmalı", ev.applied);
        assertTrue("red kanıtı taşınmıyor", ev.commands.contains("ATFCSM1="));
        assertFalse("red 'OK' olarak yazılmamalı", ev.commands.contains("ATFCSM1=OK"));
    }

    @Test
    public void failsSoftWhenFirstCommandRejected() {
        RecordingChannel ch = new RecordingChannel().on("ATFCSH7E0", "?");
        ElmProtocol.IsoTpTuningEvidence ev = protocol(ch).applyIsoTpFlowControl("7E0");
        assertFalse(ev.applied);
    }

    // ── Kilit 3 + 4: RESTORE ve görünürlüğü ───────────────────────────────────

    @Test
    public void restoreSendsAutoModeAndRecordsResult() {
        RecordingChannel ch = new RecordingChannel();
        ElmProtocol p = protocol(ch);
        ElmProtocol.IsoTpTuningEvidence applied = p.applyIsoTpFlowControl("7E0");
        ch.sent.clear();

        ElmProtocol.IsoTpTuningEvidence restored = p.restoreIsoTpFlowControl(applied);

        assertTrue("restore ATFCSM0 göndermeli", sentContains(ch.sent, "ATFCSM0"));
        assertTrue("restore başarılı olmalı", restored.restored);
        assertTrue(restored.restoreDetail.contains("ATFCSM0=OK"));
    }

    /** Restore DÜŞERSE bu SESSİZCE geçilmez — kanıtta görünür. */
    @Test
    public void restoreFailureIsVisible() {
        RecordingChannel ch = new RecordingChannel().on("ATFCSM0", "?");
        ElmProtocol p = protocol(ch);
        ElmProtocol.IsoTpTuningEvidence applied = p.applyIsoTpFlowControl("7E0");

        ElmProtocol.IsoTpTuningEvidence restored = p.restoreIsoTpFlowControl(applied);

        assertFalse("restore düştüğünde 'restored' true OLAMAZ", restored.restored);
        assertTrue("restore düşüşü kanıtta görünmeli",
            restored.newMode.contains("BİLİNMİYOR"));
    }

    /** Tuning hiç uygulanmamışsa bile restore GÜVENLE çağrılabilir (idempotent). */
    @Test
    public void restoreIsSafeWhenTuningNeverApplied() {
        RecordingChannel ch = new RecordingChannel();
        ElmProtocol.IsoTpTuningEvidence restored = protocol(ch).restoreIsoTpFlowControl(null);
        assertTrue(restored.restored);
        assertFalse("uygulanmamış tuning 'applied' olamaz", restored.applied);
    }

    // ── Kilit 5: ÇERÇEVE SAYIMI ÖLÇÜMDÜR ──────────────────────────────────────

    @Test
    public void countsIsoTpFrames() {
        assertEquals("boş gövde 0 çerçeve", 0, ElmProtocol.countIsoTpFrames(""));
        // ≤7 bayt tek çerçeve (SF)
        assertEquals(1, ElmProtocol.countIsoTpFrames("AABBCCDDEEFF11"));
        // 8 bayt: FF(6) + CF(2) = 2 çerçeve
        assertEquals(2, ElmProtocol.countIsoTpFrames("AABBCCDDEEFF1122"));
        // 83 bayt (20 DTC + availability) ≈ 1 + ceil(77/7) = 12 çerçeve
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 83; i++) big.append("AA");
        assertEquals(1 + (int) Math.ceil(77 / 7.0), ElmProtocol.countIsoTpFrames(big.toString()));
    }

    @Test
    public void frameCountIgnoresNonHexNoise() {
        assertEquals(ElmProtocol.countIsoTpFrames("AABBCCDDEEFF1122"),
            ElmProtocol.countIsoTpFrames("AA BB CC DD EE FF 11 22"));
    }
}
