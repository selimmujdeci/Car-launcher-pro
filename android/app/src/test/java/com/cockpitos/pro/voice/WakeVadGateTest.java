package com.cockpitos.pro.voice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Random;

import org.junit.Test;

/**
 * WakeVadGateTest — "Hey Mavi" kapısı: araç gürültüsünde boşa decode yok, konuşma kaçmaz.
 * Saha 2026-10-02: park hâlinde RMS 0,003–0,013 iken eski sabit eşik karelerin %42'sini çözdü.
 */
public class WakeVadGateTest {

    /** Sahadaki dağılıma benzer araç içi gürültü: çoğu 0,003–0,010, ara sıra 0,013'e sıçrar. */
    private static double cabinNoise(Random r) {
        double base = 0.003 + r.nextDouble() * 0.007;
        return r.nextDouble() < 0.12 ? base + 0.004 : base;
    }

    @Test
    public void aracGurultusundeNeredeyseHicDecodeYok() {
        WakeVadGate g = new WakeVadGate();
        Random r = new Random(42);
        int decoded = 0, frames = 3000; // 5 dk
        for (int i = 0; i < frames; i++) if (g.onFrame(cabinNoise(r))) decoded++;
        assertTrue("decode oranı " + decoded + "/" + frames, decoded < frames * 0.03);
    }

    @Test
    public void konusmaIkinciKaredeBaslarOnsetBirKezVeDevamSurer() {
        WakeVadGate g = new WakeVadGate();
        Random r = new Random(1);
        for (int i = 0; i < 200; i++) g.onFrame(cabinNoise(r)); // taban öğrenilir
        assertFalse("ilk yüksek kare tek başına açmaz", g.onFrame(0.06));
        assertTrue("ikinci ardışık yüksek kare açar", g.onFrame(0.06));
        assertTrue(g.onsetNow());
        assertTrue(g.onFrame(0.07));
        assertFalse("onset yalnız bir kez", g.onsetNow());
        int tail = 0;
        while (g.onFrame(0.004)) tail++;
        assertEquals("sessizlikten sonra HANGOVER kadar devam", WakeVadGate.HANGOVER, tail);
    }

    @Test
    public void tekTiklamaAcmaz() {
        WakeVadGate g = new WakeVadGate();
        for (int i = 0; i < 100; i++) g.onFrame(0.004);
        assertFalse(g.onFrame(0.2));
        assertFalse(g.onFrame(0.004));
        assertFalse(g.onFrame(0.2));
    }

    @Test
    public void sessizKabindeAltSinirEskiEsikleAyni() {
        WakeVadGate g = new WakeVadGate();
        for (int i = 0; i < 300; i++) g.onFrame(0.001);
        assertEquals(WakeVadGate.MIN_THRESH, g.threshold(), 1e-9);
        assertFalse(g.onFrame(0.013));
        assertTrue("0,012 üstü fısıltı yine yakalanır", g.onFrame(0.013));
    }

    @Test
    public void konusmaTabaniSisirmez() {
        WakeVadGate g = new WakeVadGate();
        for (int i = 0; i < 200; i++) g.onFrame(0.005);
        double before = g.floor();
        for (int i = 0; i < 100; i++) g.onFrame(0.08); // uzun konuşma
        assertEquals(before, g.floor(), 1e-9);
    }

    @Test
    public void tabanOgrenilmedenMinimumEsikVeSahte0Yok() {
        WakeVadGate g = new WakeVadGate();
        assertEquals(-1, g.floor(), 0);
        assertEquals(WakeVadGate.MIN_THRESH, g.threshold(), 1e-9);
    }
}
