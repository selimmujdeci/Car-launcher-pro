package com.cockpitos.pro;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.junit.Test;

/**
 * CarLauncherPluginBridgeContractTest — MRI F-10 · köprünün DERLENMİŞ gerçeği.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN YANSIMA (reflection), NEDEN KAYNAK METNİ DEĞİL
 *
 * Capacitor köprüsü JS'ten gelen çağrıyı ÇALIŞMA ZAMANINDA yansımayla çözer:
 * metodun `@PluginMethod` ile işaretli, `public` ve tek parametresi
 * `PluginCall` olması gerekir. Bu koşullardan biri bozulursa Java DERLENİR,
 * kaynak metninde metod GÖRÜNÜR, ama JS çağrısı cihazda çözülemez.
 *
 * Yani "CarLauncherPlugin.java içinde şu string var" testi bu arıza sınıfını
 * YAKALAYAMAZ. Bu dosya derlenmiş sınıfın gerçek çağrılabilir yüzeyini ölçer.
 *
 * Tamamlayıcı yarı — TS arayüzü ile bu yüzeyin uyuşması:
 *   src/__tests__/nativeBridgeContractF10.test.ts
 * ══════════════════════════════════════════════════════════════════════════
 */
public class CarLauncherPluginBridgeContractTest {

    /**
     * Üretimde GERÇEK çağıranı olan, güvenlik/araç açısından kritik köprü
     * metodları. Kaynakları (TS çağrı yerleri):
     *   · MCU/CAN fiziksel komut   — nativeCommandBridge.executeMcuCommand
     *   · checkCommandNonce        — nativeCommandBridge.checkCrossChannelNonceReplay
     *   · secureStoreSet/Get       — sensitiveKeyStore (cihaz sırları)
     *   · getStableDeviceId        — vehicleIdentityService (cihaz kimliği)
     *   · connectOBD/readPidOnce   — araç veri katmanı
     *   · getCommandServiceStatus  — uzak komut altyapısı durumu
     *
     * Liste KASITLI olarak dar: tamamı değil, kaybı sessiz kalırsa en pahalı
     * olanlar. Tam TS↔Java kapsaması Vitest yarısında ölçülür.
     */
    private static final List<String> CRITICAL_BRIDGE_METHODS = Arrays.asList(
        "lockDoors", "unlockDoors", "honkHorn", "flashLights", "triggerAlarm", "stopAlarm",
        "checkCommandNonce",
        "secureStoreSet", "secureStoreGet",
        "getStableDeviceId",
        "connectOBD", "readPidOnce",
        "getCommandServiceStatus",
        /* Wave 12B — local PIN otoritesi (valet/geofence koruması).
           Eksilirse pinService FAIL-CLOSED davranır ve koruma kapatılamaz
           hâle gelir; sessiz bir "PIN yok" durumuna DÜŞMEZ. */
        "localPinStatus", "setLocalPin", "verifyLocalPin",
        "changeLocalPin", "clearLocalPin"
    );

    private static List<Method> annotatedBridgeMethods() {
        List<Method> out = new ArrayList<>();
        for (Method m : CarLauncherPlugin.class.getDeclaredMethods()) {
            if (m.isAnnotationPresent(PluginMethod.class)) out.add(m);
        }
        return out;
    }

    // ── 1 · Ölçüm gerçekten çalışıyor mu (boş kümede yeşil olmasın) ────────

    @Test
    public void bridgeSurfaceIsMeasurable() {
        List<Method> bridge = annotatedBridgeMethods();
        assertTrue("@PluginMethod yüzeyi yansımayla okunamadı — annotation RUNTIME "
            + "retention'ını kaybetmiş olabilir (bu durumda Capacitor de çözemez): "
            + bridge.size(), bridge.size() > 100);
    }

    // ── 2 · Her köprü metodu GERÇEKTEN çağrılabilir imzada ────────────────

    @Test
    public void everyAnnotatedMethodIsActuallyResolvableByCapacitor() {
        List<String> broken = new ArrayList<>();
        for (Method m : annotatedBridgeMethods()) {
            Class<?>[] params = m.getParameterTypes();
            boolean ok = Modifier.isPublic(m.getModifiers())
                && !Modifier.isStatic(m.getModifiers())
                && m.getReturnType() == void.class
                && params.length == 1
                && PluginCall.class.isAssignableFrom(params[0]);
            if (!ok) {
                broken.add(m.getName() + " (public=" + Modifier.isPublic(m.getModifiers())
                    + " static=" + Modifier.isStatic(m.getModifiers())
                    + " returns=" + m.getReturnType().getSimpleName()
                    + " params=" + Arrays.toString(m.getParameterTypes()) + ")");
            }
        }
        assertEquals("@PluginMethod isaretli ama Capacitor'in cozemeyecegi imza — "
            + "kaynakta GORUNUR, cihazda CAGRILAMAZ: " + broken,
            new ArrayList<String>(), broken);
    }

    // ── 3 · Kritik köprü metodları derlenmiş sınıfta MEVCUT ───────────────

    @Test
    public void criticalBridgeMethodsExistOnCompiledClass() {
        Set<String> present = new HashSet<>();
        for (Method m : annotatedBridgeMethods()) present.add(m.getName());

        List<String> missing = new ArrayList<>();
        for (String name : CRITICAL_BRIDGE_METHODS) {
            if (!present.contains(name)) missing.add(name);
        }
        assertEquals("kritik kopru metodu derlenmis sinifta YOK veya @PluginMethod "
            + "isaretini kaybetmis — JS cagrisi cihazda UNIMPLEMENTED doner: " + missing,
            new ArrayList<String>(), missing);
    }

    // ── 4 · Ölçülmüş borç: PIN köprüsü GERÇEKTEN yok ──────────────────────

    @Test
    public void knownMissingPinBridgeStaysMeasured() {
        /* nativePlugin.ts bu ucunu ZORUNLU beyan eder ve pinService uretimde
           cagirir; Java karsiligi YOKTUR -> gercek cihazda PIN hash'i Keystore
           destekli depoya DEGIL, web depolamasina yazilir. Borc burada da
           olculur ki iki yari (TS/Java) ayni gercegi soylesin. Java tarafi
           eklendiginde bu test kirmizi olur ve karantinanin kapatilmasini
           zorlar. */
        Set<String> present = new HashSet<>();
        for (Method m : annotatedBridgeMethods()) present.add(m.getName());

        for (String name : new String[] { "setPinHash", "verifyPin", "clearPin" }) {
            assertTrue("PIN kopru metodu '" + name + "' artik MEVCUT — F-10 karantinasi "
                + "(nativeBridgeContractF10.test.ts KNOWN_MISSING) guncellenmeli",
                !present.contains(name));
        }
    }
}
