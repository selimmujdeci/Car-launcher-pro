package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * UDS 0x14 (uretici DTC silme) HEDEF KILIDI.
 *
 * Silme yikici bir istektir: fonksiyonel yayinla (7DF / 18DB33F1) giderse araçtaki
 * TUM ECU'larin hafizasi silinir; K-line'da yanlis hedef baska modulu uyandirabilir.
 * Bu yuzden yalniz FIZIKSEL CAN adresi kabul edilir.
 */
public class UdsClearTargetTest {

    @Test
    public void physicalCanHeadersAreAccepted() {
        assertTrue(ElmProtocol.isPhysicalCanRequestHeader("7E1"));   // sahadaki sanziman
        assertTrue(ElmProtocol.isPhysicalCanRequestHeader("7E0"));
        assertTrue(ElmProtocol.isPhysicalCanRequestHeader("18DA10F1"));
        assertTrue(ElmProtocol.isPhysicalCanRequestHeader("18 DA 10 F1"));
    }

    @Test
    public void functionalBroadcastIsRejected() {
        assertFalse(ElmProtocol.isPhysicalCanRequestHeader("7DF"));
        assertFalse(ElmProtocol.isPhysicalCanRequestHeader("7df"));
        assertFalse(ElmProtocol.isPhysicalCanRequestHeader("18DB33F1"));
    }

    @Test
    public void kLineAndMalformedHeadersAreRejected() {
        assertFalse(ElmProtocol.isPhysicalCanRequestHeader("8210F1"));   // KWP
        assertFalse(ElmProtocol.isPhysicalCanRequestHeader("C133F1"));   // KWP fonksiyonel
        assertFalse(ElmProtocol.isPhysicalCanRequestHeader(""));
        assertFalse(ElmProtocol.isPhysicalCanRequestHeader(null));
        assertFalse(ElmProtocol.isPhysicalCanRequestHeader("7E"));
    }

    @Test
    public void clearCommandTargetsAllGroups() {
        assertEquals("14FFFFFF", ElmProtocol.UDS_CLEAR_ALL_CMD);
    }
}
