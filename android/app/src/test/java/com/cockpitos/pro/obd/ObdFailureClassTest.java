package com.cockpitos.pro.obd;

import static org.junit.Assert.*;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;

import org.junit.Test;

/**
 * P0-OBD-CORE-06 — CONNECT_FAILED nedeni UNKNOWN'a DÜŞMEMELİ.
 *
 * Sahada 17 başarısız bağlantı denemesi vardı ve hiçbirinin nedeni yoktu:
 * neden yalnız hata MESAJINDAN okunuyordu, mesaj {@code null} olduğunda
 * (Java'da sık) sonuç "bilinmiyor" oluyordu. Bu testler sınıfın MESAJDAN
 * BAĞIMSIZ olarak da üretildiğini kilitler.
 */
public class ObdFailureClassTest {

    @Test public void nullMessage_stillClassifiedByType() {
        // Mesaj YOK — eski yol burada UNKNOWN derdi.
        assertEquals(ObdFailureClass.TIMEOUT, ObdFailureClass.of(new SocketTimeoutException()));
        assertEquals(ObdFailureClass.CONNECTION_REFUSED, ObdFailureClass.of(new ConnectException()));
        assertEquals(ObdFailureClass.PERMISSION_DENIED, ObdFailureClass.of(new SecurityException()));
    }

    @Test public void unableToConnect_isVehicleSilence_notSocketFault() {
        assertEquals(ObdFailureClass.NO_VEHICLE_RESPONSE,
            ObdFailureClass.of(new ElmInitSequencer.UnableToConnectException("UNABLE TO CONNECT")));
    }

    @Test public void messageEvidenceUsedWhenTypeIsGeneric() {
        assertEquals(ObdFailureClass.SOCKET_CLOSED,
            ObdFailureClass.of(new IOException("read failed, socket might closed or timeout, read ret: -1")));
        assertEquals(ObdFailureClass.RESOURCE_BUSY,
            ObdFailureClass.of(new IOException("connect: EBUSY (Device or resource busy)")));
    }

    @Test public void causeChainIsRead_whenTopMessageIsNull() {
        IOException cause = new IOException("Device or resource busy");
        assertEquals(ObdFailureClass.RESOURCE_BUSY, ObdFailureClass.of(new IOException(null, cause)));
    }

    @Test public void genericIoException_isIoError_notUnknown() {
        assertEquals(ObdFailureClass.IO_ERROR, ObdFailureClass.of(new IOException()));
    }

    @Test public void unmeasurable_staysUnknown_noFabrication() {
        assertEquals(ObdFailureClass.UNKNOWN, ObdFailureClass.of(null));
        assertEquals(ObdFailureClass.UNKNOWN, ObdFailureClass.of(new RuntimeException()));
    }

    @Test public void messageIsNeverNull_fallsBackToClassName() {
        assertEquals("java.io.IOException", ObdFailureClass.messageOf(new IOException()));
        assertEquals("bum", ObdFailureClass.messageOf(new IOException("bum")));
    }

    @Test public void selfReferencingCause_doesNotLoop() {
        // Bozuk sebep zinciri ürünü DONDURMAMALI (bounded gezinme).
        RuntimeException e = new RuntimeException("x") {
            @Override public synchronized Throwable getCause() { return this; }
        };
        assertNotNull(ObdFailureClass.of(e));
    }
}
