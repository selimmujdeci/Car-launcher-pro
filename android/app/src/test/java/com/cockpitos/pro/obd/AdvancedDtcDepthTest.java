package com.cockpitos.pro.obd;

import static org.junit.Assert.*;
import org.junit.Test;

public class AdvancedDtcDepthTest {
    private static final class Ch implements ElmCommandChannel {
        final java.util.Map<String,String> r = new java.util.HashMap<>();
        Ch on(String c,String v){r.put(c,v);return this;}
        public String send(String c,int t){return r.getOrDefault(c,"NO DATA");}
        public void close(){}
    }

    @Test public void uds19_statusMask_positiveCarriesRaw() throws Exception {
        ElmProtocol.UdsEvidence e = new ElmProtocol(new Ch().on("1902FF","59 02 FF 01 02 03 09"))
            .readUdsDtcInformationDetailed("02","FF");
        assertEquals("OK",e.kind); assertEquals("FF01020309",e.data);
    }
    @Test public void uds19_availability_subfunction01() throws Exception {
        ElmProtocol.UdsEvidence e = new ElmProtocol(new Ch().on("1901FF","59 01 FF 01 00 02"))
            .readUdsDtcInformationDetailed("01","FF");
        assertEquals("FF010002",e.data);
    }
    @Test public void uds19_snapshotIdentification_subfunction03() throws Exception {
        ElmProtocol.UdsEvidence e = new ElmProtocol(new Ch().on("1903","59 03 01 02 03 04"))
            .readUdsDtcInformationDetailed("03","");
        assertEquals("01020304",e.data);
    }
    @Test public void uds19_extendedData_subfunction06() throws Exception {
        ElmProtocol.UdsEvidence e = new ElmProtocol(new Ch().on("1906010203FF","59 06 01 02 03 09 FF AA"))
            .readUdsDtcInformationDetailed("06","010203FF");
        assertEquals("01020309FFAA",e.data);
    }
    @Test public void uds19_negativeNrcIsEvidence_notEmptyCodes() throws Exception {
        ElmProtocol.UdsEvidence e = new ElmProtocol(new Ch().on("1902FF","7F 19 31"))
            .readUdsDtcInformationDetailed("02","FF");
        assertEquals("NEG_7F",e.kind); assertEquals(0x31,e.nrc.intValue()); assertNull(e.data);
    }
    @Test public void uds19_noDataSeparate() throws Exception {
        ElmProtocol.UdsEvidence e = new ElmProtocol(new Ch().on("1902FF","NO DATA"))
            .readUdsDtcInformationDetailed("02","FF");
        assertEquals("NO_DATA",e.kind);
    }
    @Test public void writeAndSecuritySubfunctionsRejected() {
        try { new ElmProtocol(new Ch()).readUdsDtcInformationDetailed("14",""); fail(); }
        catch(Exception expected){ assertTrue(expected.getMessage().contains("whitelist")); }
    }
    @Test public void kwp18Detailed_preservesStatus() throws Exception {
        ElmProtocol.UdsEvidence e = new ElmProtocol(new Ch().on("1800FF00","58 01 12 34 09"))
            .readKwpDtcsDetailed();
        assertEquals("OK",e.kind); assertEquals("01123409",e.data);
    }
}
