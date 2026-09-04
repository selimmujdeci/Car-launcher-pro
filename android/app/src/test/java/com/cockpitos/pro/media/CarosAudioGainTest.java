package com.cockpitos.pro.media;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * MUSIC F6 — Ses kazancı matematiğinin DAVRANIŞ KİLİTLERİ (saf JVM).
 *
 * Bu kilitler gerçek cihaz doğrulamasının YERİNE GEÇMEZ; yalnız "sessizlik"
 * ve "clipping" üreten sınıf hatalarının sessizce geri gelmesini engeller.
 */
public class CarosAudioGainTest {

    /* ── Preamp: yalnız kısar ─────────────────────────────────────────────── */

    @Test
    public void preampAsla1inUstuneCikmaz() {
        assertEquals(1.0f, CarosAudioGain.clampPreamp(1.0f), 1e-6);
        assertEquals(1.0f, CarosAudioGain.clampPreamp(4.0f), 1e-6);
        assertEquals(1.0f, CarosAudioGain.clampPreamp(Float.POSITIVE_INFINITY), 1e-6);
    }

    @Test
    public void preampTabaninAltinaInmez() {
        assertEquals(CarosAudioGain.MIN_PREAMP, CarosAudioGain.clampPreamp(0f), 1e-6);
        assertEquals(CarosAudioGain.MIN_PREAMP, CarosAudioGain.clampPreamp(-3f), 1e-6);
    }

    @Test
    public void bozukPreampSessizlikDegilEtkisizlikUretir() {
        // NaN bir "0 kazanç" (sessizlik) değildir; etkisiz (1.0) kabul edilir.
        assertEquals(1.0f, CarosAudioGain.clampPreamp(Float.NaN), 1e-6);
    }

    /* ── Denge: yalnız uzak kanalı kısar ──────────────────────────────────── */

    @Test
    public void merkezDengeIkiKanaliDaBozmaz() {
        assertEquals(1.0f, CarosAudioGain.leftGain(0f), 1e-6);
        assertEquals(1.0f, CarosAudioGain.rightGain(0f), 1e-6);
    }

    @Test
    public void dengeHicbirKanaliYukseltmez() {
        for (float b = -1f; b <= 1f; b += 0.1f) {
            assertTrue(CarosAudioGain.leftGain(b) <= 1.0f);
            assertTrue(CarosAudioGain.rightGain(b) <= 1.0f);
            assertTrue(CarosAudioGain.leftGain(b) >= 0f);
            assertTrue(CarosAudioGain.rightGain(b) >= 0f);
        }
    }

    @Test
    public void tamSagDengeSolKanaliSusturur() {
        assertEquals(0f, CarosAudioGain.leftGain(1f), 1e-6);
        assertEquals(1.0f, CarosAudioGain.rightGain(1f), 1e-6);
    }

    @Test
    public void tamSolDengeSagKanaliSusturur() {
        assertEquals(1.0f, CarosAudioGain.leftGain(-1f), 1e-6);
        assertEquals(0f, CarosAudioGain.rightGain(-1f), 1e-6);
    }

    @Test
    public void bozukDengeMerkezKabulEdilir() {
        assertEquals(0f, CarosAudioGain.clampBalance(Float.NaN), 1e-6);
        assertEquals(1.0f, CarosAudioGain.clampBalance(9f), 1e-6);
        assertEquals(-1.0f, CarosAudioGain.clampBalance(-9f), 1e-6);
    }

    /* ── Nötr kapı: dokunulmama garantisi ─────────────────────────────────── */

    @Test
    public void notrAyardaZincirEtkisizSayilir() {
        assertTrue(CarosAudioGain.isUnity(1.0f, 0f));
        assertFalse(CarosAudioGain.isUnity(0.5f, 0f));
        assertFalse(CarosAudioGain.isUnity(1.0f, 0.3f));
    }

    /* ── Örnek ölçekleme: SATURE olur, wrap-around YAPMAZ ─────────────────── */

    @Test
    public void tasanOrnekIsaretDegistirmez() {
        // Wrap-around olsaydı +32767 × 2 negatif bir değere düşerdi → duyulur klik.
        assertEquals((short) 32767, CarosAudioGain.scaleSample16((short) 32767, 2.0f));
        assertEquals((short) -32768, CarosAudioGain.scaleSample16((short) -32768, 2.0f));
    }

    @Test
    public void birlikKazancOrnegiDegistirmez() {
        assertEquals((short) 1234, CarosAudioGain.scaleSample16((short) 1234, 1.0f));
        assertEquals((short) -1234, CarosAudioGain.scaleSample16((short) -1234, 1.0f));
    }

    @Test
    public void yariKazancGenligiYariyaIndirir() {
        assertEquals((short) 5000, CarosAudioGain.scaleSample16((short) 10000, 0.5f));
    }

    @Test
    public void floatOrnekAraliginDisinaCikmaz() {
        assertEquals(1.0f, CarosAudioGain.scaleSampleFloat(0.9f, 4.0f), 1e-6);
        assertEquals(-1.0f, CarosAudioGain.scaleSampleFloat(-0.9f, 4.0f), 1e-6);
        assertEquals(0.25f, CarosAudioGain.scaleSampleFloat(0.5f, 0.5f), 1e-6);
    }
}
