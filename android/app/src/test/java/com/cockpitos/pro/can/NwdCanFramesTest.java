package com.cockpitos.pro.can;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * NwdCanFramesTest — NWD dış CAN SDK wire sözleşmesini kilitler.
 *
 * Tablolar CanAllInOne v.26.07.30A writeToParcel sırasından (dexdump) birebir alındı; bir alan
 * kayarsa Parcel'in geri kalanı çöp okunur. Bu test sayıyı ve çapa alanların yerini sabitler.
 * Çerçeve örnekleri RemoteProtocalPack.pack* bit yerleşimine göre üretilir.
 */
public class NwdCanFramesTest {

    /** [0x6E][tip][len][veri...][0xFF] — RemoteProtocal.generateNullProtocal biçimi. */
    private static byte[] frame(int type, int... payload) {
        byte[] f = new byte[payload.length + 4];
        f[0] = 0x6E;
        f[1] = (byte) type;
        f[2] = (byte) payload.length;
        for (int i = 0; i < payload.length; i++) f[3 + i] = (byte) payload[i];
        f[f.length - 1] = (byte) 0xFF;
        return f;
    }

    @Test
    public void acTableEndsBeforeTypedListAndKeepsAnchors() {
        assertEquals(134, NwdCanFrames.AC_FIELDS.length);
        assertEquals("bACSwitch", NwdCanFrames.AC_FIELDS[0]);
        assertEquals("bAirSpeedLevel", NwdCanFrames.AC_FIELDS[13]);
        assertEquals("fLeftSideTemperature", NwdCanFrames.AC_FIELDS[16]);
        assertEquals("fRightSideTemperature", NwdCanFrames.AC_FIELDS[17]);
        assertEquals("bOutDegree", NwdCanFrames.AC_FIELDS[35]);
        assertEquals("bLeftSeatMassage", NwdCanFrames.AC_FIELDS[93]);
        assertEquals("bRightSeatMassage", NwdCanFrames.AC_FIELDS[94]);
        assertEquals("bRightSeatBackHeat", NwdCanFrames.AC_FIELDS[133]);
    }

    @Test
    public void tpmsTableCoversWholeParcel() {
        assertEquals(43, NwdCanFrames.TPMS_FIELDS.length);
        assertEquals("fFrontLeftWheelPressure", NwdCanFrames.TPMS_FIELDS[1]);
        assertEquals("bWheelBattery", NwdCanFrames.TPMS_FIELDS[42]);
    }

    @Test
    public void everyFieldHasKnownType() {
        for (String f : NwdCanFrames.AC_FIELDS)   assertTrue(f, "bfis".indexOf(NwdCanFrames.typeOf(f)) >= 0);
        for (String f : NwdCanFrames.TPMS_FIELDS) assertTrue(f, "bfis".indexOf(NwdCanFrames.typeOf(f)) >= 0);
    }

    @Test
    public void frameTypeRejectsForeignOrTruncatedFrames() {
        assertEquals(-1, NwdCanFrames.frameType(null));
        assertEquals(-1, NwdCanFrames.frameType(new byte[]{ 0x2E, 3, 1, 0, (byte) 0xFF }));
        assertEquals(-1, NwdCanFrames.frameType(new byte[]{ 0x6E, 4, 20, 0 }));   // 20 bayt bildiriyor, yok
        assertEquals(3, NwdCanFrames.frameType(frame(3, 0x80)));
    }

    @Test
    public void doorBitsMapToDoors() {
        // ön sol (bit7) + bagaj (bit3)
        assertEquals("önSol=1 önSağ=0 arkaSol=0 arkaSağ=0 bagaj=1 kaput=0",
            NwdCanFrames.decodeDoor(frame(3, 0x88)));
        assertEquals("önSol=0 önSağ=1 arkaSol=1 arkaSağ=1 bagaj=0 kaput=1",
            NwdCanFrames.decodeDoor(frame(3, 0x74)));
        assertNull("kapı olmayan çerçeve", NwdCanFrames.decodeDoor(frame(4, 0x88)));
    }

    @Test
    public void radarSplitsLevelsAndDistances() {
        int[] p = new int[20];
        for (int i = 0; i < 8; i++)  p[i] = i + 1;        // seviye 1..8
        for (int i = 8; i < 16; i++) p[i] = 100 + i;      // mesafe 108..115
        assertEquals("seviye[arka 1,2,3,4 | ön 5,6,7,8] mesafe[arka 108,109,110,111 | ön 112,113,114,115]",
            NwdCanFrames.decodeRadar(frame(4, p)));
    }

    @Test
    public void swcAngleCarriesSignInHighBit() {
        // +300 → [3]=0x2C [4]=0x01
        assertArrayEquals(new int[]{ 300, 0, 0 },
            NwdCanFrames.decodeSwcAngle(frame(6, 0x2C, 0x01, 0, 0, 0, 0)));
        // -300 → |300| ve yüksek bayta +0x80
        assertArrayEquals(new int[]{ -300, 0x0102, 0x0304 },
            NwdCanFrames.decodeSwcAngle(frame(6, 0x2C, 0x81, 0x02, 0x01, 0x04, 0x03)));
        assertNull(NwdCanFrames.decodeSwcAngle(frame(3, 0)));
    }

    @Test
    public void diffListsNonDefaultsFirstThenOnlyChanges() {
        String[] table = { "bA", "fB", "sC" };   // günlükte tip harfi atılır: "A", "B", "C"
        assertEquals("B=22.0", NwdCanFrames.diff(table, null, new String[]{ "0", "22.0", "null" }));
        assertEquals("A 0→1", NwdCanFrames.diff(table,
            new String[]{ "0", "22.0", "x" }, new String[]{ "1", "22.0", "x" }));
        assertEquals("", NwdCanFrames.diff(table,
            new String[]{ "1", "22.0", "x" }, new String[]{ "1", "22.0", "x" }));
    }
}
