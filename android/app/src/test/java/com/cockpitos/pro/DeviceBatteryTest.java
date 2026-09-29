package com.cockpitos.pro;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * DeviceBatteryTest — bilinmeyen pil sahte %0 olarak raporlanmaz.
 * `DeviceBattery.percentOrNull` saf karardır; Robolectric gerekmez.
 */
public class DeviceBatteryTest {

    @Test
    public void validReadingIsPercent() {
        assertEquals(Integer.valueOf(87), DeviceBattery.percentOrNull(true, 87, 100));
        assertEquals(Integer.valueOf(50), DeviceBattery.percentOrNull(true, 128, 256));
        assertEquals(Integer.valueOf(100), DeviceBattery.percentOrNull(true, 100, 100));
    }

    @Test
    public void realZeroStaysZero() {
        /* Gerçekten boşalmış pil 0'dır — yalnız BİLİNMEYEN null olur. */
        assertEquals(Integer.valueOf(0), DeviceBattery.percentOrNull(true, 0, 100));
    }

    @Test
    public void noBatteryIsUnknown() {
        /* Head unit: EXTRA_PRESENT=false — seviye ne olursa olsun pil yoktur. */
        assertNull(DeviceBattery.percentOrNull(false, 0, 100));
        assertNull(DeviceBattery.percentOrNull(false, 100, 100));
    }

    @Test
    public void missingOrInvalidExtrasAreUnknown() {
        assertNull(DeviceBattery.percentOrNull(true, -1, 100));   // EXTRA_LEVEL yok
        assertNull(DeviceBattery.percentOrNull(true, 50, -1));    // EXTRA_SCALE yok
        assertNull(DeviceBattery.percentOrNull(true, 50, 0));     // bölme hatası
        assertNull(DeviceBattery.percentOrNull(true, 150, 100));  // seviye > ölçek
    }
}
