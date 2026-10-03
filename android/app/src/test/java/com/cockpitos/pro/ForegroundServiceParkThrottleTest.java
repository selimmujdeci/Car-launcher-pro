package com.cockpitos.pro;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.Manifest;
import android.app.Application;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;

import androidx.test.core.app.ApplicationProvider;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;

import java.lang.reflect.Field;

/**
 * Park kısması × araç ünitesi (saha 2026-10-03: "cihazda konum var, uygulamada yok").
 *
 * Araç ünitesinde JS Fused'ı hiç açmaz (NATIVE_GNSS_ONLY) → uygulamanın TEK konum
 * kaynağı bu servisin GPS_PROVIDER akışıdır. Park kısması 5 dk hareketsizlikte GPS'i
 * kapatıp hareketi NETWORK_PROVIDER ile yakalamayı varsayar; GMS'siz/çökük ünitede ağ
 * konumu yoktur → GPS bir daha açılmaz. Ünite kontakla kapanmayıp uyuduğundan ertesi
 * gün de aynı süreçte konumsuz başlar.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class ForegroundServiceParkThrottleTest {

    private ServiceController<CarLauncherForegroundService> controller;
    private CarLauncherForegroundService service;

    @Before
    public void setUp() {
        Application app = ApplicationProvider.getApplicationContext();
        shadowOf(app).grantPermissions(
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION);
        LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
        shadowOf(lm).setProviderEnabled(LocationManager.GPS_PROVIDER, true);
        shadowOf(lm).setProviderEnabled(LocationManager.NETWORK_PROVIDER, false); // GMS'siz ünite
        // WebView canlı sayılsın (ağ heartbeat yolu devreye girmesin)
        CarLauncherForegroundService.setCallbacks((a, b, c, d, e, f, g) -> { }, m -> { });
        CarLauncherForegroundService.setNavigationActive(false);
        CarLauncherForegroundService.setGnssPrimary(false);
    }

    @After
    public void tearDown() {
        CarLauncherForegroundService.setGnssPrimary(false);
        CarLauncherForegroundService.setCallbacks(null, null);
        if (controller != null) controller.destroy();
    }

    @Test
    public void varsayilan_parkKismasi_GPSiKapatir() throws Exception {
        startService();
        assertTrue("ön koşul: servis açılışta 1 Hz GPS ister", gpsActive());
        deliverStationaryFixAfterParkTimeout();
        assertFalse("telefon/pil davranışı korunur: 5 dk hareketsizlikte GPS kısılır", gpsActive());
    }

    @Test
    public void yerelGnssTekKaynak_parkKismasi_GPSiKapatmaz() throws Exception {
        CarLauncherForegroundService.setGnssPrimary(true);
        startService();
        deliverStationaryFixAfterParkTimeout();
        assertTrue("araç ünitesinde tek konum kaynağı kısılıp kör kaldı", gpsActive());
    }

    @Test
    public void zatenKisilmisken_yerelGnssTekKaynak_GPSiGeriAcar() throws Exception {
        startService();
        deliverStationaryFixAfterParkTimeout();
        assertFalse("ön koşul: kısma devrede", gpsActive());
        CarLauncherForegroundService.setGnssPrimary(true);
        assertTrue("dün kısmaya giren servis uyanınca GPS'i geri açmalı", gpsActive());
    }

    // ── Yardımcılar ─────────────────────────────────────────────────────────

    private void startService() {
        controller = Robolectric.buildService(CarLauncherForegroundService.class).create();
        service = controller.get();
    }

    /** 5 dk'dan uzun hareketsizlik + durağan (0 km/h) fix — kısmanın tetik koşulu. */
    private void deliverStationaryFixAfterParkTimeout() throws Exception {
        field("lastGpsMotionMs").setLong(service, System.currentTimeMillis() - 6 * 60_000L);
        Location loc = new Location(LocationManager.GPS_PROVIDER);
        loc.setLatitude(39.92);
        loc.setLongitude(32.85);
        loc.setSpeed(0f);
        loc.setTime(System.currentTimeMillis());
        ((LocationListener) field("locationListener").get(service)).onLocationChanged(loc);
    }

    private boolean gpsActive() throws Exception {
        return field("gpsHighAccuracyActive").getBoolean(service);
    }

    private static Field field(String name) throws Exception {
        Field f = CarLauncherForegroundService.class.getDeclaredField(name);
        f.setAccessible(true);
        return f;
    }
}
