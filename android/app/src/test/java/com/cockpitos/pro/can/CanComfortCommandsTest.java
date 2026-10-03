package com.cockpitos.pro.can;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Saha 2026-10-03 (Megane): sağlamasız {@code 2E 83 02 18 01} UART'a {@code 2E 83 02 18 62}
 * olarak çıktı — NWD son baytı sağlama sayıp değeri ezdi. Çerçeve sağlama baytını taşımalı.
 */
public class CanComfortCommandsTest {

    private static byte[] b(int... v) {
        byte[] o = new byte[v.length];
        for (int i = 0; i < v.length; i++) o[i] = (byte) v[i];
        return o;
    }

    @Test
    public void ambientColorFrameKeepsValueAndCarriesChecksum() {
        assertArrayEquals(b(0x2E, 0x83, 0x02, 0x18, 0x01, 0x61), CanComfortCommands.centralSetting(0x18, 1));
    }

    @Test
    public void dataRequestMatchesNwdOwnFrameShape() {
        // NWD'nin kendi isteği: 2E 90 02 7D 0A E6 → aynı biçim, aynı sağlama kuralı.
        assertArrayEquals(b(0x2E, 0x90, 0x02, 0x71, 0x00, 0xFC), CanComfortCommands.dataRequest(0x71));
    }

    @Test
    public void framesPassTheSameValidatorAsIncomingFrames() {
        assertNotNull(NwdRawFrameTap.parse("2E8302180161"));
        assertNotNull(NwdRawFrameTap.parse("2E90027D0AE6"));
        byte[] f = CanComfortCommands.centralSetting(0x92, 4);
        StringBuilder hex = new StringBuilder();
        for (byte x : f) hex.append(String.format("%02X", x & 0xFF));
        assertNotNull(NwdRawFrameTap.parse(hex.toString()));
    }

    @Test
    public void fuelAndRangeRequestsAreReadOnlyAndBounded() {
        assertArrayEquals(b(0x2E, 0x90, 0x02, 0x80, 0x00, 0xED), CanComfortCommands.dataRequest(0x80, 0));
        assertArrayEquals(b(0x2E, 0x90, 0x02, 0x7D, 0x04, 0xEC), CanComfortCommands.dataRequest(0x7D, 4));
        assertNull(CanComfortCommands.dataRequest(0x7D, 0x0A));   // NWD zaten istiyor
        assertNull(CanComfortCommands.dataRequest(0x80, 1));
        assertNull(CanComfortCommands.dataRequest(0x83, 0));      // yazma tipi ASLA istek değildir
    }

    @Test
    public void whitelistStillRejects() {
        assertNull(CanComfortCommands.centralSetting(0x18, 8));
        assertNull(CanComfortCommands.centralSetting(0x40, 1));
        assertNull(CanComfortCommands.dataRequest(0x7D));
    }
}
