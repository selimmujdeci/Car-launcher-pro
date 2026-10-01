package com.cockpitos.pro.phonehub.link;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.ParcelUuid;
import android.util.Log;

import com.cockpitos.phonehub.protocol.LinkDiagnosticBuffer;
import com.cockpitos.phonehub.protocol.LinkDiagnosticEvent;
import com.cockpitos.phonehub.protocol.LinkErrorCode;
import com.cockpitos.phonehub.protocol.LinkHandshake;
import com.cockpitos.phonehub.protocol.LinkSession;
import com.cockpitos.phonehub.protocol.PhoneHubUuid;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * PhoneHubClientController — CarOS Pro TELEFONDA çalışırken araca bağlanan taraf.
 *
 * ── TEK UYGULAMA, İKİ ROL ───────────────────────────────────────────────────
 * Ayrı bir telefon uygulaması YOKTUR: aynı CarOS Pro araçta sunucu
 * ({@link PhoneHubLinkController}), telefonda bu sınıfla istemcidir. Kimlik
 * anahtarı ve güven kaydı rol başına AYRIDIR.
 *
 * ── HİBRİT: HANGİSİ VARSA ───────────────────────────────────────────────────
 * Her bağlanma denemesinde iki yol AYNI ANDA denenir:
 *   · Wi-Fi — aracın yerel ağ beacon'ı + ağ geçidi denemesi
 *     ({@link LanClientConnector}; yalnız özel/yerel adresler)
 *   · Bluetooth — eşleşmiş cihazlarda Phone Hub RFCOMM servisi
 * İLK kurulan kanal kazanır, diğer yol kapatılır. Bluetooth'u Android'e kapalı
 * bir head unit'te Wi-Fi tek başına yeter; Wi-Fi yoksa Bluetooth yeter.
 *
 * ── GÜVEN TAŞIMADA DEĞİL ────────────────────────────────────────────────────
 * Kanal hangi yoldan gelirse gelsin aynı imzalı el sıkışma ve iki ekranda
 * aynı 6 haneli kodun kullanıcı onayı gerekir. Güven kaydı YALNIZ oturum
 * gerçekten kurulunca yazılır.
 *
 * ── SINIRLI KAYNAK ──────────────────────────────────────────────────────────
 * Sabit 2 iş parçacıklı havuz (iki yol) + tek zamanlayıcı (geri çekilmeli
 * yeniden deneme). Kullanıcı "kes" deyince her şey durur; yeniden deneme
 * yalnız daha önce güvenilen araç için ve sınırlı sayıda yapılır.
 */
public final class PhoneHubClientController implements LinkSession.Listener {

    private static final String TAG = "PhoneHubClient";

    /** Telefon rolünün kimliği — araç rolünün anahtarından AYRI. */
    private static final String IDENTITY_ALIAS = "caros-phonehub-phone-identity";
    private static final String TRUST_PREFS = "caros.phonehub.trust.client";
    private static final List<String> LOCAL_CAPABILITIES = Arrays.asList("HEALTH");

    /** Bir denemede araç arama süresi. */
    static final long DISCOVERY_WINDOW_MS = 30_000L;
    private static final int BEACON_WAIT_MS = 2_500;
    private static final int GATEWAY_CONNECT_TIMEOUT_MS = 1_500;
    /** Bluetooth'ta denenecek en fazla eşleşmiş cihaz. */
    private static final int MAX_BT_CANDIDATES = 4;
    private static final long[] RECONNECT_BACKOFF_MS = { 2_000L, 4_000L, 8_000L, 16_000L, 30_000L };
    private static final int MAX_RECONNECT_ATTEMPTS = 8;

    public enum Phase { IDLE, SEARCHING, HANDSHAKING, AWAITING_CONFIRM, CONNECTED, RETRY_WAIT, NOT_FOUND, FAILED }

    /** Yol durumu — ekranda "Wi-Fi: aranıyor · Bluetooth: kapalı" diye gösterilir. */
    public enum PathState { IDLE, SEARCHING, FOUND, CONNECTED, NOT_FOUND, DISABLED, PERMISSION_REQUIRED, UNAVAILABLE, CANCELLED }

    public interface StateListener {
        void onClientStateChanged(String phase);
        void onClientApplicationMessage(String peerFingerprint, long sessionEpoch, String payloadUtf8);
    }

    private static PhoneHubClientController instance;

    public static synchronized PhoneHubClientController get(Context context, String appVersion) {
        if (instance == null) instance = new PhoneHubClientController(context, appVersion);
        return instance;
    }

    private final Context appContext;
    private final String appVersion;
    private final LinkDiagnosticBuffer diagnostics = new LinkDiagnosticBuffer();
    private final KeystoreIdentitySigner signer;
    private final PhoneHubTrustStore trustStore;
    private final ExecutorService paths = Executors.newFixedThreadPool(2);
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    private final AtomicLong attemptSource = new AtomicLong(0L);
    private final AtomicLong sessionSource = new AtomicLong(0L);
    private final AtomicReference<LinkSession> session = new AtomicReference<>(null);
    private final AtomicReference<String[]> pendingPairing = new AtomicReference<>(null);

    private volatile Attempt attempt;
    private volatile ScheduledFuture<?> reconnectFuture;
    private volatile boolean userWantsConnection;
    private volatile int reconnectAttempts;
    private volatile Phase phase = Phase.IDLE;
    private volatile PathState wifiPath = PathState.IDLE;
    private volatile PathState bluetoothPath = PathState.IDLE;
    private volatile PhoneHubChannel.Transport activeTransport;
    private volatile String lastErrorCode;
    private volatile long attemptStartedAtMs = -1L;
    private volatile StateListener listener;

    /** Bir bağlanma denemesinin durumu — iki yol aynı nesneyi paylaşır. */
    private static final class Attempt {
        final long id;
        volatile boolean settled;
        volatile int finishedPaths;
        volatile DatagramSocket beaconSocket;
        volatile BluetoothSocket btSocket;
        Attempt(long id) { this.id = id; }
    }

    private PhoneHubClientController(Context context, String appVersion) {
        this.appContext = context.getApplicationContext();
        this.appVersion = appVersion == null ? "?" : appVersion;
        this.signer = new KeystoreIdentitySigner(IDENTITY_ALIAS);
        this.trustStore = new PhoneHubTrustStore(appContext, TRUST_PREFS);
    }

    public void setStateListener(StateListener l) { listener = l; }

    /* ══════════════════════════════════════════════════════════════════════
     * Komutlar
     * ════════════════════════════════════════════════════════════════════ */

    /** Kullanıcı "Araca bağlan" dedi. Zaten bağlıysa/deniyorsa yeni deneme açılmaz. */
    public synchronized void connect() {
        userWantsConnection = true;
        reconnectAttempts = 0;
        cancelReconnect();
        startAttempt();
    }

    /** Kullanıcı bağlantıyı kesti — yeniden deneme YAPILMAZ. */
    public synchronized void disconnect() {
        userWantsConnection = false;
        cancelReconnect();
        cancelAttempt();
        LinkSession s = session.getAndSet(null);
        if (s != null) s.close(LinkErrorCode.SOCKET_CLOSED);
        pendingPairing.set(null);
        activeTransport = null;
        setPhase(Phase.IDLE);
    }

    public boolean confirmPairing(boolean accepted) {
        LinkSession s = session.get();
        if (s == null) return false;
        boolean ok = s.confirmPairing(accepted);
        if (!accepted) pendingPairing.set(null);
        return ok;
    }

    /** "Bu aracı unut" — güven silinir, bağlantı kapanır. */
    public void forgetTrustedCar() {
        trustStore.forget();
        disconnect();
    }

    public boolean sendApplicationMessage(String payloadUtf8) {
        LinkSession s = session.get();
        if (s == null || payloadUtf8 == null) return false;
        return s.sendApplicationMessage(payloadUtf8.getBytes(StandardCharsets.UTF_8));
    }

    /** Onay bekleyen kod — yalnız onay penceresinde, yalnız bu çağrıyla. */
    public String pendingPairingCodeForDisplay() {
        String[] p = pendingPairing.get();
        if (p == null) return null;
        try {
            if (LinkSession.SYSTEM_CLOCK.nowMs() >= Long.parseLong(p[1])) return null;
        } catch (NumberFormatException e) {
            return null;
        }
        return p[0];
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Bağlanma denemesi — iki yol yarışır
     * ════════════════════════════════════════════════════════════════════ */

    private synchronized void startAttempt() {
        LinkSession s = session.get();
        if (s != null && isLive(s)) return;
        Attempt current = attempt;
        if (current != null && !current.settled) return;   // zaten arıyor

        final Attempt a = new Attempt(attemptSource.incrementAndGet());
        attempt = a;
        attemptStartedAtMs = LinkSession.SYSTEM_CLOCK.nowMs();
        wifiPath = PathState.SEARCHING;
        bluetoothPath = PathState.SEARCHING;
        setPhase(Phase.SEARCHING);
        record(LinkDiagnosticEvent.Category.LIFECYCLE, "attempt", null, LinkDiagnosticEvent.Severity.INFO,
            "arac araniyor (wifi + bluetooth)");

        paths.execute(new Runnable() { @Override public void run() { runWifiPath(a); } });
        paths.execute(new Runnable() { @Override public void run() { runBluetoothPath(a); } });
    }

    private void runWifiPath(Attempt a) {
        WifiManager.MulticastLock lock = acquireMulticastLock();
        DatagramSocket ds = null;
        try {
            ds = LanClientConnector.openBeaconSocket(LanBeacon.UDP_PORT);
            a.beaconSocket = ds;
            String preferred = LanBeacon.hintOf(trustStore.trustedFingerprint());
            long deadline = LinkSession.SYSTEM_CLOCK.nowMs() + DISCOVERY_WINDOW_MS;
            while (!a.settled && LinkSession.SYSTEM_CLOCK.nowMs() < deadline) {
                /* Telefon aracın erişim noktasına bağlıysa araç ağ geçididir. */
                InetAddress gw = wifiGateway();
                if (gw != null && LanAddressPolicy.isLocal(gw)) {
                    try {
                        PhoneHubChannel ch = LanClientConnector.connect(gw,
                            LanServerTransport.PREFERRED_TCP_PORT, GATEWAY_CONNECT_TIMEOUT_MS,
                            LanAddressPolicy.LOCAL_ONLY);
                        if (offerChannel(a, ch)) wifiPath = PathState.CONNECTED;
                        return;
                    } catch (IOException ignored) { /* geçit CarOS değil — beacon beklenir */ }
                }
                LanClientConnector.Found f = LanClientConnector.awaitBeacon(ds, BEACON_WAIT_MS,
                    LanAddressPolicy.LOCAL_ONLY, preferred);
                if (f == null || a.settled) continue;
                wifiPath = PathState.FOUND;
                try {
                    PhoneHubChannel ch = LanClientConnector.connect(f.host, f.port,
                        LanClientConnector.CONNECT_TIMEOUT_MS, LanAddressPolicy.LOCAL_ONLY);
                    if (offerChannel(a, ch)) wifiPath = PathState.CONNECTED;
                    return;
                } catch (IOException e) {
                    wifiPath = PathState.SEARCHING;   // bir sonraki beacon'da yeniden
                }
            }
            if (wifiPath != PathState.CONNECTED) wifiPath = a.settled ? PathState.CANCELLED : PathState.NOT_FOUND;
        } catch (IOException e) {
            if (!a.settled) wifiPath = PathState.UNAVAILABLE;
        } finally {
            a.beaconSocket = null;
            if (ds != null) ds.close();
            if (lock != null && lock.isHeld()) lock.release();
            pathFinished(a);
        }
    }

    private void runBluetoothPath(Attempt a) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) { bluetoothPath = PathState.UNAVAILABLE; return; }
            if (!hasConnectPermission()) { bluetoothPath = PathState.PERMISSION_REQUIRED; return; }
            if (!adapter.isEnabled()) { bluetoothPath = PathState.DISABLED; return; }

            List<BluetoothDevice> candidates = rankCandidates(adapter.getBondedDevices());
            for (BluetoothDevice d : candidates) {
                if (a.settled) break;
                BluetoothSocket socket;
                try {
                    /* GÜVENLİ varyant: sistem eşleştirmesi şarttır. */
                    socket = d.createRfcommSocketToServiceRecord(PhoneHubUuid.serviceUuid());
                } catch (IOException e) {
                    continue;
                }
                a.btSocket = socket;
                try {
                    socket.connect();
                    if (offerChannel(a, new BluetoothChannel(socket))) bluetoothPath = PathState.CONNECTED;
                    return;
                } catch (IOException e) {
                    try { socket.close(); } catch (IOException ignored) { /* sessiz */ }
                } finally {
                    a.btSocket = null;
                }
            }
            bluetoothPath = a.settled ? PathState.CANCELLED : PathState.NOT_FOUND;
        } catch (SecurityException e) {
            bluetoothPath = PathState.PERMISSION_REQUIRED;
        } finally {
            pathFinished(a);
        }
    }

    /**
     * Eşleşmiş cihazlar: Phone Hub servisini önbellekte ilan edenler önce,
     * sonra araç ses cihazı sınıfı, sonra diğerleri; en fazla
     * {@link #MAX_BT_CANDIDATES}. MAC adresi OKUNMAZ.
     */
    private static List<BluetoothDevice> rankCandidates(Set<BluetoothDevice> bonded) {
        List<BluetoothDevice> list = new ArrayList<>();
        if (bonded == null) return list;
        list.addAll(bonded);
        Collections.sort(list, new Comparator<BluetoothDevice>() {
            @Override public int compare(BluetoothDevice x, BluetoothDevice y) {
                return rank(x) - rank(y);
            }
        });
        return list.size() > MAX_BT_CANDIDATES ? list.subList(0, MAX_BT_CANDIDATES) : list;
    }

    private static int rank(BluetoothDevice d) {
        try {
            ParcelUuid[] uuids = d.getUuids();
            if (uuids != null) {
                for (ParcelUuid u : uuids) {
                    if (PhoneHubUuid.serviceUuid().equals(u.getUuid())) return 0;
                }
            }
            BluetoothClass c = d.getBluetoothClass();
            if (c != null && c.getDeviceClass() == BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO) return 1;
        } catch (SecurityException ignored) { /* izin yoksa sıralama nötr */ }
        return 2;
    }

    /**
     * Kazananı seçer: denemenin İLK kanalı oturum olur, geç gelen kapatılır.
     * Diğer yol iptal edilir (bekleyen Bluetooth soketi / beacon soketi kapanır).
     */
    private synchronized boolean offerChannel(Attempt a, PhoneHubChannel ch) {
        if (a != attempt || a.settled) {
            ch.closeQuietly();
            return false;
        }
        a.settled = true;
        if (ch.transport() == PhoneHubChannel.Transport.WIFI) {
            BluetoothSocket pending = a.btSocket;
            if (pending != null) {
                try { pending.close(); } catch (IOException ignored) { /* sessiz */ }
            }
        } else {
            DatagramSocket ds = a.beaconSocket;
            if (ds != null) ds.close();
        }
        return startSession(ch);
    }

    private synchronized void pathFinished(Attempt a) {
        a.finishedPaths++;
        if (a.finishedPaths < 2 || a.settled || a != attempt) return;
        a.settled = true;
        record(LinkDiagnosticEvent.Category.LIFECYCLE, "attempt", LinkErrorCode.CLIENT_CONNECT_FAILED,
            LinkDiagnosticEvent.Severity.WARN, "arac bulunamadi");
        lastErrorCode = LinkErrorCode.CLIENT_CONNECT_FAILED.name();
        if (!scheduleReconnect()) setPhase(Phase.NOT_FOUND);
    }

    private synchronized boolean startSession(PhoneHubChannel ch) {
        LinkSession.Config cfg = new LinkSession.Config();
        cfg.serverSide = false;
        cfg.signer = signer;
        cfg.capabilities = LOCAL_CAPABILITIES;
        cfg.appVersion = appVersion;
        cfg.trustedPeerFingerprint = trustStore.trustedFingerprint();
        cfg.diagnostics = diagnostics;
        cfg.side = LinkDiagnosticEvent.Side.PHONE;
        cfg.listener = this;

        LinkSession s = new LinkSession(cfg, sessionSource.incrementAndGet());
        LinkSession previous = session.getAndSet(s);
        if (previous != null) previous.close(LinkErrorCode.SOCKET_CLOSED);
        activeTransport = ch.transport();
        setPhase(Phase.HANDSHAKING);
        try {
            if (s.start(ch.input(), ch.output())) return true;
        } catch (IOException e) {
            Log.w(TAG, "kanal akışı alınamadı");
        }
        ch.closeQuietly();
        session.compareAndSet(s, null);
        activeTransport = null;
        return false;
    }

    private void cancelAttempt() {
        Attempt a = attempt;
        if (a == null) return;
        a.settled = true;
        DatagramSocket ds = a.beaconSocket;
        if (ds != null) ds.close();
        BluetoothSocket bs = a.btSocket;
        if (bs != null) {
            try { bs.close(); } catch (IOException ignored) { /* sessiz */ }
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Yeniden deneme — yalnız güvenilen araç için, sınırlı
     * ════════════════════════════════════════════════════════════════════ */

    private synchronized boolean scheduleReconnect() {
        if (!userWantsConnection || !trustStore.hasTrustedPeer()) return false;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            lastErrorCode = LinkErrorCode.RECONNECT_EXHAUSTED.name();
            return false;
        }
        long delay = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1)];
        reconnectAttempts++;
        setPhase(Phase.RETRY_WAIT);
        cancelReconnect();
        reconnectFuture = scheduler.schedule(new Runnable() {
            @Override public void run() {
                synchronized (PhoneHubClientController.this) {
                    if (userWantsConnection) startAttempt();
                }
            }
        }, delay, TimeUnit.MILLISECONDS);
        return true;
    }

    private void cancelReconnect() {
        ScheduledFuture<?> f = reconnectFuture;
        reconnectFuture = null;
        if (f != null) f.cancel(false);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * LinkSession.Listener
     * ════════════════════════════════════════════════════════════════════ */

    @Override
    public void onStateChanged(LinkSession.State state, long generation) {
        LinkSession s = session.get();
        if (s == null || s.generation() != generation) return;   // bayat oturum
        if (state == LinkSession.State.AWAITING_USER_CONFIRM) {
            setPhase(Phase.AWAITING_CONFIRM);
        } else if (state == LinkSession.State.CONNECTED) {
            setPhase(Phase.CONNECTED);
        } else if (state == LinkSession.State.CLOSED || state == LinkSession.State.FAILED) {
            session.compareAndSet(s, null);
            pendingPairing.set(null);
            activeTransport = null;
            synchronized (this) {
                if (!scheduleReconnect()) setPhase(state == LinkSession.State.FAILED ? Phase.FAILED : Phase.IDLE);
            }
        }
    }

    @Override
    public void onApplicationMessage(byte[] payload, long generation) {
        if (!PhoneHubLinkController.isAcceptableApplicationPayloadSize(payload)) return;
        LinkSession s = session.get();
        if (s == null || s.generation() != generation) return;
        LinkHandshake hs = s.handshake();
        String fingerprint = hs.peerFingerprint();
        if (fingerprint == null) return;
        StateListener l = listener;
        if (l == null) return;
        try {
            l.onClientApplicationMessage(fingerprint, generation, new String(payload, StandardCharsets.UTF_8));
        } catch (RuntimeException ignored) { /* köprü hatası oturumu bozmaz */ }
    }

    @Override
    public void onPairingCodeReady(String code, long expiresAtMs, long generation) {
        pendingPairing.set(new String[] { code, Long.toString(expiresAtMs) });
        setPhase(Phase.AWAITING_CONFIRM);
    }

    @Override
    public void onEstablished(List<String> grantedCapabilities, long generation) {
        pendingPairing.set(null);
        reconnectAttempts = 0;
        LinkSession s = session.get();
        if (s == null) return;
        LinkHandshake hs = s.handshake();
        String fingerprint = hs.peerFingerprint();
        if (fingerprint != null) {
            trustStore.trustPeer(fingerprint, "CarOS", hs.negotiatedProtocolVersion(),
                LinkSession.SYSTEM_CLOCK.nowMs());
        }
        setPhase(Phase.CONNECTED);
    }

    @Override
    public void onError(LinkErrorCode code, String safeDetails, long generation) {
        if (code != null) lastErrorCode = code.name();
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Anlık görüntü — sır/MAC/kod TAŞIMAZ
     * ════════════════════════════════════════════════════════════════════ */

    public JSONObject snapshotJson() {
        JSONObject root = new JSONObject();
        try {
            root.put("schemaVersion", 1);
            root.put("role", "PHONE");
            root.put("phase", phase.name());
            root.put("userWantsConnection", userWantsConnection);
            JSONObject paths = new JSONObject();
            paths.put("wifi", wifiPath.name());
            paths.put("bluetooth", bluetoothPath.name());
            root.put("paths", paths);
            root.put("activeTransport", activeTransport == null ? JSONObject.NULL : activeTransport.name());
            root.put("attemptStartedAtMs", attemptStartedAtMs);
            root.put("reconnectAttempts", reconnectAttempts);
            root.put("lastErrorCode", lastErrorCode == null ? JSONObject.NULL : lastErrorCode);

            LinkSession s = session.get();
            if (s == null) {
                root.put("session", JSONObject.NULL);
            } else {
                JSONObject so = new JSONObject();
                so.put("generation", s.generation());
                so.put("state", s.state().name());
                String fp = s.handshake().peerFingerprint();
                so.put("peerFingerprint", fp == null ? JSONObject.NULL : fp);
                so.put("trulyEstablished", s.snapshot().isTrulyEstablished());
                root.put("session", so);
            }

            JSONObject trust = new JSONObject();
            trust.put("hasTrustedPeer", trustStore.hasTrustedPeer());
            String tfp = trustStore.trustedFingerprint();
            trust.put("peerFingerprint", tfp == null ? JSONObject.NULL : tfp);
            trust.put("lastConnectedAtMs", trustStore.lastConnectedAtMs());
            root.put("trust", trust);

            String[] p = pendingPairing.get();
            JSONObject pairing = new JSONObject();
            pairing.put("awaitingConfirmation", p != null);
            root.put("pairing", pairing);
        } catch (JSONException e) {
            try { root.put("error", "SNAPSHOT_BUILD_FAILED"); } catch (JSONException ignored) { /* umutsuz */ }
        }
        return root;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İç
     * ════════════════════════════════════════════════════════════════════ */

    private void setPhase(Phase next) {
        if (phase == next) return;
        phase = next;
        StateListener l = listener;
        if (l == null) return;
        try {
            l.onClientStateChanged(next.name());
        } catch (RuntimeException ignored) { /* köprü hatası durumu bozmaz */ }
    }

    private static boolean isLive(LinkSession s) {
        LinkSession.State st = s.state();
        return st != LinkSession.State.CLOSED && st != LinkSession.State.FAILED
            && st != LinkSession.State.CLOSING;
    }

    private boolean hasConnectPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** Wi-Fi beacon'ları uyku filtresine takılmasın diye çok noktaya yayın kilidi. */
    private WifiManager.MulticastLock acquireMulticastLock() {
        try {
            WifiManager wm = (WifiManager) appContext.getSystemService(Context.WIFI_SERVICE);
            if (wm == null) return null;
            WifiManager.MulticastLock lock = wm.createMulticastLock("caros-phonehub");
            lock.setReferenceCounted(false);
            lock.acquire();
            return lock;
        } catch (RuntimeException e) {
            return null;   // izin/servis yoksa beacon yine denenir (hotspot'ta gerekmez)
        }
    }

    /** Telefon bir Wi-Fi'ye istemci olarak bağlıysa o ağın IPv4 ağ geçidi; yoksa null. */
    private InetAddress wifiGateway() {
        try {
            ConnectivityManager cm = (ConnectivityManager) appContext.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return null;
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(n);
                if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
                LinkProperties lp = cm.getLinkProperties(n);
                if (lp == null) continue;
                for (RouteInfo r : lp.getRoutes()) {
                    InetAddress g = r.getGateway();
                    if (r.isDefaultRoute() && g instanceof Inet4Address) return g;
                }
            }
        } catch (RuntimeException ignored) { /* ağ bilgisi okunamadı */ }
        return null;
    }

    private void record(LinkDiagnosticEvent.Category category, String stage, LinkErrorCode code,
                        LinkDiagnosticEvent.Severity severity, String details) {
        diagnostics.record(LinkSession.SYSTEM_CLOCK.nowMs(), LinkDiagnosticEvent.Side.PHONE,
            category, stage, code, severity, attemptSource.get(), details);
    }
}
