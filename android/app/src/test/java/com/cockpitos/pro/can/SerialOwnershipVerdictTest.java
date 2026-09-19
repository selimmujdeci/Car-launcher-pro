package com.cockpitos.pro.can;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

/**
 * SerialOwnershipVerdictTest — MRI F-01 sahiplik KARARININ saf mantığı.
 *
 * Kilitlenen invariant: openable ≠ owned ≠ CAN ≠ safe-to-write.
 *   · OEM/foreign/unprovable → port AÇILMAZ (chmod da yapılmaz).
 *   · Yalnız ölçülmüş FREE ya da platform allow-list PLATFORM_MAPPED açılabilir.
 *   · "chmod başarılı" / "dosya var" karar girdisi bile DEĞİLDİR — decideVerdict
 *     böyle bir parametre almaz.
 * Tek fiziksel port → tek sahip (claim kaydı) da burada kilitlenir.
 */
public class SerialOwnershipVerdictTest {

    @Before
    public void reset() {
        SerialPortHandler.resetRegistriesForTest();
        SerialDiscoveryLedger.clearForTest();
    }

    // ── decideVerdict ───────────────────────────────────────────────────────

    @Test
    public void oemOwned_alwaysWins_evenIfProbeSaysFree() {
        assertEquals(SerialPortHandler.PortVerdict.OEM_OWNED,
            SerialPortHandler.decideVerdict(true, false, Boolean.FALSE));
        assertEquals(SerialPortHandler.PortVerdict.OEM_OWNED,
            SerialPortHandler.decideVerdict(true, true, Boolean.FALSE));
    }

    @Test
    public void unknownPort_withoutRootProbe_isUnprovable_notFree() {
        // Root yok → sahiplik ölçülemez → AÇILMAZ. Eski davranış burada "dene" idi.
        assertEquals(SerialPortHandler.PortVerdict.UNPROVABLE,
            SerialPortHandler.decideVerdict(false, false, null));
    }

    @Test
    public void unknownPort_heldByForeignProcess_isRejected() {
        assertEquals(SerialPortHandler.PortVerdict.FOREIGN_HELD,
            SerialPortHandler.decideVerdict(false, false, Boolean.TRUE));
    }

    @Test
    public void unknownPort_measuredFree_isObserveOnly() {
        assertEquals(SerialPortHandler.PortVerdict.FREE,
            SerialPortHandler.decideVerdict(false, false, Boolean.FALSE));
    }

    @Test
    public void platformMapped_isVerified_withoutProbe() {
        assertEquals(SerialPortHandler.PortVerdict.PLATFORM_MAPPED,
            SerialPortHandler.decideVerdict(false, true, null));
    }

    // ── parseOwnerProbe (root fd taraması çıktısı) ──────────────────────────

    @Test
    public void probeOutput_withoutEnumMarker_meansUnmeasured() {
        assertNull(SerialPortHandler.parseOwnerProbe(null));
        assertNull(SerialPortHandler.parseOwnerProbe(""));
        assertNull(SerialPortHandler.parseOwnerProbe("Permission denied\n"));
        // su reddedildi ama bir şeyler yazdı — yine ölçülemedi
        assertNull(SerialPortHandler.parseOwnerProbe("OWNED:/proc/123\n"));
    }

    @Test
    public void probeOutput_enumOk_noOwner_meansFree() {
        assertEquals(Boolean.FALSE, SerialPortHandler.parseOwnerProbe("CAROS_ENUM_OK\n"));
    }

    @Test
    public void probeOutput_enumOk_withOwner_meansForeignHeld() {
        assertEquals(Boolean.TRUE,
            SerialPortHandler.parseOwnerProbe("CAROS_ENUM_OK\nOWNED:/proc/842\n"));
    }

    // ── allow-list ──────────────────────────────────────────────────────────

    @Test
    public void allowList_isEmptyToday_soNoPortIsPlatformMapped() {
        // Bilinçli: sahada UART-CAN kanıtı olan ünite yok. Bir satır eklemek kanıt ister.
        assertEquals(0, SerialPortHandler.KNOWN_CAN_PORTS.length);
        assertFalse(SerialPortHandler.isPlatformMappedCanPort("/dev/ttyS2", "sun50iw10p1", "ceres-b3"));
        assertFalse(SerialPortHandler.isPlatformMappedCanPort("/dev/ttyS1", null, null));
    }

    // ── claim kaydı: tek fiziksel port → tek sahip ──────────────────────────

    @Test
    public void secondOwner_cannotClaim_sameUart() {
        assertTrue(SerialPortHandler.claimPort("/dev/ttyS4", "FileSerialTransport"));
        assertFalse(SerialPortHandler.claimPort("/dev/ttyS4", "McuEventSniffer"));
        assertTrue(SerialPortHandler.isPortClaimed("/dev/ttyS4"));

        boolean conflictLogged = false;
        for (SerialDiscoveryLedger.Entry e : SerialDiscoveryLedger.snapshot()) {
            if (e.kind == SerialDiscoveryLedger.Kind.ARBITRATION_CONFLICT) conflictLogged = true;
        }
        assertTrue("çakışma defterlenmeli", conflictLogged);
    }

    @Test
    public void claim_isReentrantForSameOwner_andReleasedOnlyByOwner() {
        assertTrue(SerialPortHandler.claimPort("/dev/ttyS4", "FileSerialTransport"));
        assertTrue(SerialPortHandler.claimPort("/dev/ttyS4", "FileSerialTransport"));
        SerialPortHandler.releasePort("/dev/ttyS4", "SomeoneElse");
        assertTrue("başkası bırakamaz", SerialPortHandler.isPortClaimed("/dev/ttyS4"));
        SerialPortHandler.releasePort("/dev/ttyS4", "FileSerialTransport");
        assertFalse(SerialPortHandler.isPortClaimed("/dev/ttyS4"));
    }
}
