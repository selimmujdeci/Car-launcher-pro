package com.cockpitos.pro;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

/**
 * CapacitorPluginRegistrationContractTest — MRI F-04 · plugin'in DERLENMİŞ gerçeği.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NE KANITLAR
 *
 * Capacitor köprüsü bir plugin'i ÇALIŞMA ZAMANINDA yansımayla çözer:
 * sınıf `Plugin`'den türemeli, `@CapacitorPlugin` annotation'ı RUNTIME
 * retention ile taşınmalı ve `name` değeri JS'in `registerPlugin('…')`
 * çağrısıyla birebir aynı olmalıdır. Bu koşullardan biri bozulursa Java
 * DERLENİR, kaynak metninde her şey DOĞRU görünür, ama JS çağrısı cihazda
 * çözülemez.
 *
 * ── NE KANITLAMAZ (dürüstlük) ─────────────────────────────────────────────
 * Bu test plugin'in `MainActivity.onCreate()` kayıt listesinde OLDUĞUNU
 * kanıtlamaz — o çağrılar metod gövdesindedir ve yansımayla görülmez.
 * Kayıt üyeliği şurada ölçülür:
 *   src/__tests__/pluginRegistrationContractF04.test.ts
 *
 * Ve hiçbiri CİHAZ kanıtı değildir:
 *   IMPLEMENTED != REGISTERED != RESOLVABLE != DEVICE VERIFIED
 * ══════════════════════════════════════════════════════════════════════════
 */
public class CapacitorPluginRegistrationContractTest {

    /** JS'in beklediği plugin adı → Java sınıfı. Kaynak: TS `registerPlugin<…>('ad')`. */
    private static Map<String, Class<?>> expectedPlugins() {
        Map<String, Class<?>> m = new LinkedHashMap<>();
        m.put("CarLauncher",           CarLauncherPlugin.class);
        m.put("VehicleHAL",            com.cockpitos.pro.hal.VehicleHALPlugin.class);
        m.put("PhoneHubLink",          com.cockpitos.pro.phonehub.link.PhoneHubLinkPlugin.class);
        m.put("PhoneLinkPortal",       com.cockpitos.pro.phonelink.PhoneLinkPortalPlugin.class);
        m.put("PhoneInternetObserver", com.cockpitos.pro.phonelink.PhoneInternetObserverPlugin.class);
        return m;
    }

    /** VehicleHAL'in ÜRETİMDE çağrılan yüzeyi (NativeHALAdapter.ts). */
    private static final List<String> VEHICLE_HAL_PRODUCTION_METHODS =
        Arrays.asList("startHAL", "stopHAL", "getSignal");

    private static List<Method> pluginMethods(Class<?> type) {
        List<Method> out = new ArrayList<>();
        for (Method m : type.getDeclaredMethods()) {
            if (m.isAnnotationPresent(PluginMethod.class)) out.add(m);
        }
        return out;
    }

    // ── 1 · Annotation ÇALIŞMA ZAMANINDA okunabiliyor ─────────────────────

    @Test
    public void capacitorAnnotationSurvivesToRuntime() {
        /* RUNTIME retention kaybolursa Capacitor da plugin adını okuyamaz —
           yani bu testin okuyamaması, kopruN̈un da okuyamayacagi demektir. */
        for (Map.Entry<String, Class<?>> e : expectedPlugins().entrySet()) {
            CapacitorPlugin ann = e.getValue().getAnnotation(CapacitorPlugin.class);
            assertNotNull("@CapacitorPlugin calisma zamaninda YOK: " + e.getValue().getName(), ann);
        }
    }

    // ── 2 · JS adı ↔ Java annotation adı ──────────────────────────────────

    @Test
    public void pluginNameMatchesJavascriptContract() {
        List<String> mismatches = new ArrayList<>();
        for (Map.Entry<String, Class<?>> e : expectedPlugins().entrySet()) {
            CapacitorPlugin ann = e.getValue().getAnnotation(CapacitorPlugin.class);
            if (ann == null) { mismatches.add(e.getKey() + ": annotation YOK"); continue; }
            if (!e.getKey().equals(ann.name())) {
                mismatches.add("JS '" + e.getKey() + "' != Java '" + ann.name() + "'");
            }
        }
        assertEquals("plugin adi JS sozlesmesinden sapmis — kopru adi cozemez, "
            + "cagri cihazda sessizce UNIMPLEMENTED doner: " + mismatches,
            new ArrayList<String>(), mismatches);
    }

    // ── 3 · Sınıf gerçekten bir Capacitor Plugin'i ────────────────────────

    @Test
    public void everyPluginExtendsCapacitorPlugin() {
        List<String> bad = new ArrayList<>();
        for (Map.Entry<String, Class<?>> e : expectedPlugins().entrySet()) {
            if (!Plugin.class.isAssignableFrom(e.getValue())) bad.add(e.getValue().getName());
        }
        assertEquals("Plugin tabanindan turemeyen sinif kopruye kaydedilemez: " + bad,
            new ArrayList<String>(), bad);
    }

    // ── 4 · Her @PluginMethod Capacitor'ın çözebileceği imzada ────────────

    @Test
    public void everyPluginMethodIsResolvableByCapacitor() {
        List<String> broken = new ArrayList<>();
        for (Map.Entry<String, Class<?>> e : expectedPlugins().entrySet()) {
            List<Method> methods = pluginMethods(e.getValue());
            assertTrue("plugin hic @PluginMethod tasimiyor: " + e.getKey(), methods.size() > 0);
            for (Method m : methods) {
                Class<?>[] params = m.getParameterTypes();
                boolean ok = Modifier.isPublic(m.getModifiers())
                    && !Modifier.isStatic(m.getModifiers())
                    && m.getReturnType() == void.class
                    && params.length == 1
                    && PluginCall.class.isAssignableFrom(params[0]);
                if (!ok) broken.add(e.getKey() + "." + m.getName());
            }
        }
        assertEquals("@PluginMethod isaretli ama Capacitor'in cozemeyecegi imza — "
            + "kaynakta GORUNUR, cihazda CAGRILAMAZ: " + broken,
            new ArrayList<String>(), broken);
    }

    // ── 5 · VehicleHAL üretim yüzeyi (F-04 kök bulgusu) ───────────────────

    @Test
    public void vehicleHalExposesProductionCalledSurface() {
        /* Uretim zinciri: SystemBoot -> startVehicleDataLayer ->
           VehicleSignalResolver -> NativeHALAdapter -> VehicleHAL.startHAL(). */
        List<String> present = new ArrayList<>();
        for (Method m : pluginMethods(com.cockpitos.pro.hal.VehicleHALPlugin.class)) {
            present.add(m.getName());
        }
        List<String> missing = new ArrayList<>();
        for (String want : VEHICLE_HAL_PRODUCTION_METHODS) {
            if (!present.contains(want)) missing.add(want);
        }
        assertEquals("VehicleHAL'in uretimde cagrilan metodu derlenmis sinifta YOK "
            + "veya @PluginMethod isaretini kaybetmis: " + missing,
            new ArrayList<String>(), missing);
    }
}
