package com.cockpitos.pro.can;

import static org.junit.Assert.assertFalse;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import org.junit.Test;

/**
 * McuEventSniffer araca YAZAMAZ (saha 2026-10-01, Megane head-unit).
 *
 * Eskiden NWD Backcar/FactorySetting/CanService'e 1..20 arası kör binder transact
 * atıyordu; CanService kod 1 = sendCanData. Her açılışta klima AUTO/DUAL/buğu
 * kendiliğinden değişti, fan geri döndü. Keşif katmanı binder çağrısı yapmamalı.
 */
public class McuSnifferNoWriteTest {

    @Test
    public void snifferBinderTransactYapmaz() throws Exception {
        String src = new String(Files.readAllBytes(Paths.get(
                "src/main/java/com/cockpitos/pro/can/McuEventSniffer.java")), StandardCharsets.UTF_8);
        assertFalse("McuEventSniffer binder transact içeremez", src.contains(".transact("));
        assertFalse("McuEventSniffer bindService içeremez", src.contains("bindService("));
    }
}
