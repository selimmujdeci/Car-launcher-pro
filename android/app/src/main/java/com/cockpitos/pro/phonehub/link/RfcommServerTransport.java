package com.cockpitos.pro.phonehub.link;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import com.cockpitos.phonehub.protocol.LinkDiagnosticBuffer;
import com.cockpitos.phonehub.protocol.LinkDiagnosticEvent;
import com.cockpitos.phonehub.protocol.LinkErrorCode;
import com.cockpitos.phonehub.protocol.LinkSession;
import com.cockpitos.phonehub.protocol.PhoneHubUuid;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * RfcommServerTransport — head unit tarafı RFCOMM dinleyicisi (GÖREV 4).
 *
 * ── BU SINIF NE KADAR "İNCE" ────────────────────────────────────────────────
 * Burada protokol YOKTUR: çerçeveleme, kripto, el sıkışma, kalp atışı ve
 * sayaçların tamamı {@code :phonehub-protocol} modülündeki {@link LinkSession}
 * içindedir ve JUnit ile test edilmiştir. Bu sınıfın TEK işi bir
 * {@link BluetoothSocket} elde edip akışlarını oturuma teslim etmektir.
 * Böylece cihaz gerektiren yüzey mümkün olan en küçük hâle iner.
 *
 * ── DİNLEME SOKETİ ≠ AKTİF SOKET (SAHİPLİK AYRIMI) ──────────────────────────
 * {@code listenSocket} ile {@code activeSocket} AYRI alanlardır ve ayrı
 * kapatılır. Tek alanda tutulsaydı, aktif bağlantıyı kapatmak dinlemeyi de
 * öldürür (ya da tersi) ve "kullanıcı bağlantıyı kesti, artık kimse
 * bağlanamıyor" arızası doğardı.
 *
 * ── TEK AKTİF OTURUM ────────────────────────────────────────────────────────
 * Aynı anda YALNIZ BİR telefon bağlı olabilir. İkinci istemci gelirse soketi
 * NAZİKÇE kapatılır ve olay deftere yazılır; mevcut oturum BOZULMAZ.
 *
 * ── OBD İZOLASYONU (GÖREV 17) ───────────────────────────────────────────────
 * Bu sınıf {@code startDiscovery} · {@code cancelDiscovery} ·
 * {@code adapter.enable/disable} · {@code createBond} ÇAĞIRMAZ ve OBD'nin
 * soketine, executor'ına veya durum makinesine DOKUNMAZ. Phone Hub kendi
 * UUID'sini kullanır ({@link PhoneHubUuid}), OBD'nin SPP'sini DEĞİL.
 */
public final class RfcommServerTransport {

    private static final String TAG = "PhoneHubServer";

    /** Kabul döngüsünün bloklanma süresi — sonsuz beklemeyi engeller. */
    private static final int ACCEPT_TIMEOUT_MS = 30_000;

    public interface Callback {
        /** Yeni bağlantı kabul edildi; oturum başlatılmalı. */
        void onClientAccepted(BluetoothSocket socket, long generation);
        void onServerError(LinkErrorCode code, String safeDetails);
        void onServerStateChanged(String state);
    }

    public enum ServerState { STOPPED, STARTING, LISTENING, CLIENT_CONNECTED, ERROR }

    private final Context appContext;
    private final LinkDiagnosticBuffer diagnostics;
    private final Callback callback;
    private final LinkSession.MonotonicClock clock;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean disposed = new AtomicBoolean(false);
    private final AtomicLong generationSource = new AtomicLong(0L);

    private volatile BluetoothServerSocket listenSocket;
    private volatile BluetoothSocket activeSocket;
    private volatile Thread acceptThread;

    private volatile ServerState state = ServerState.STOPPED;
    private volatile LinkErrorCode lastError;
    private volatile long listenStartedAtMs = -1L;
    private volatile long acceptedCount;
    private volatile long rejectedSecondClientCount;

    public RfcommServerTransport(Context context, LinkDiagnosticBuffer diagnostics,
                                 LinkSession.MonotonicClock clock, Callback callback) {
        this.appContext = context.getApplicationContext();
        this.diagnostics = diagnostics;
        this.clock = clock == null ? LinkSession.SYSTEM_CLOCK : clock;
        this.callback = callback;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Ön koşullar — ÖLÇÜLÜR, VARSAYILMAZ
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Sunucu başlatılabilir mi. Her çağrıda YENİDEN ölçülür: head unit'lerde
     * izin ve Bluetooth durumu uygulama çalışırken değişebilir ve önbelleğe
     * alınmış bir "izin vardı" bilgisi yanlış güven üretir.
     *
     * @return engel yoksa {@code null}, varsa SABİT hata kodu.
     */
    public LinkErrorCode checkPreconditions() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) return LinkErrorCode.BLUETOOTH_UNAVAILABLE;
        if (!hasConnectPermission()) return LinkErrorCode.BLUETOOTH_PERMISSION_REQUIRED;
        /* isEnabled() BLUETOOTH_CONNECT ister (S+); izin kontrolünden SONRA. */
        if (!adapter.isEnabled()) return LinkErrorCode.BLUETOOTH_DISABLED;
        return null;
    }

    /**
     * BLUETOOTH_CONNECT yalnız API 31+ runtime iznidir. Daha eski sürümlerde
     * manifest izni yeterlidir → true. Bu ayrım yapılmazsa eski head unit'ler
     * "izin yok" diye yanlışlıkla reddedilir.
     */
    public boolean hasConnectPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
            == PackageManager.PERMISSION_GRANTED;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Yaşam döngüsü
     * ════════════════════════════════════════════════════════════════════ */

    /** Dinlemeyi başlatır. İdempotenttir: zaten çalışıyorsa true döner. */
    public boolean start() {
        if (disposed.get()) {
            reportError(LinkErrorCode.TRANSPORT_DISPOSED, "kapatilmis sunucu");
            return false;
        }
        if (running.get()) return true;

        LinkErrorCode blocker = checkPreconditions();
        if (blocker != null) {
            setState(ServerState.ERROR);
            reportError(blocker, "on kosul saglanmadi");
            return false;
        }

        setState(ServerState.STARTING);
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        try {
            /* GÜVENLİ varyant: sistem eşleştirmesi (bonding) ŞARTTIR.
             * `listenUsingInsecureRfcomm...` eşleştirmesiz bağlantıya izin
             * verirdi — kullanıcı onayını atlamak yasak (GÖREV 3). */
            listenSocket = adapter.listenUsingRfcommWithServiceRecord(
                PhoneHubUuid.SERVICE_NAME, PhoneHubUuid.serviceUuid());
        } catch (IOException e) {
            setState(ServerState.ERROR);
            reportError(LinkErrorCode.SERVER_LISTEN_FAILED, "listen acilamadi");
            return false;
        } catch (SecurityException e) {
            setState(ServerState.ERROR);
            reportError(LinkErrorCode.BLUETOOTH_PERMISSION_DENIED, "izin reddedildi");
            return false;
        }

        running.set(true);
        listenStartedAtMs = clock.nowMs();
        setState(ServerState.LISTENING);
        record(LinkDiagnosticEvent.Category.LIFECYCLE, "listen", null,
            LinkDiagnosticEvent.Severity.INFO, "sunucu dinlemede");

        acceptThread = new Thread(new Runnable() {
            @Override public void run() { acceptLoop(); }
        }, "phonehub-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return true;
    }

    /**
     * Dinlemeyi durdurur ve TÜM kaynağı bırakır. İdempotenttir.
     *
     * @param closeActiveSession true ise aktif telefon bağlantısı da kapatılır.
     *        LAB'daki "Server'ı Durdur" düğmesi bunu true ile çağırır —
     *        kullanıcı durdur dediğinde arkada açık bir soket kalmamalıdır.
     */
    public void stop(boolean closeActiveSession) {
        running.set(false);

        BluetoothServerSocket ls = listenSocket;
        listenSocket = null;
        closeQuietly(ls);

        Thread t = acceptThread;
        acceptThread = null;
        if (t != null) t.interrupt();

        if (closeActiveSession) {
            BluetoothSocket as = activeSocket;
            activeSocket = null;
            closeQuietly(as);
        }

        setState(ServerState.STOPPED);
        record(LinkDiagnosticEvent.Category.LIFECYCLE, "stop", null,
            LinkDiagnosticEvent.Severity.INFO, "sunucu durduruldu");
    }

    /** Kalıcı kapatma — bundan sonra start() çalışmaz (diriliş yok). */
    public void dispose() {
        if (!disposed.compareAndSet(false, true)) return;
        stop(true);
    }

    /** Aktif oturum kapandığında çağrılır → yeniden dinlemeye dönülür. */
    public void onActiveSessionClosed() {
        activeSocket = null;
        if (running.get() && !disposed.get()) {
            setState(ServerState.LISTENING);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Kabul döngüsü
     * ════════════════════════════════════════════════════════════════════ */

    private void acceptLoop() {
        while (running.get() && !disposed.get()) {
            BluetoothServerSocket server = listenSocket;
            if (server == null) return;

            BluetoothSocket socket;
            try {
                /* Zaman aşımlı accept: sonsuz bloklanan bir iş parçacığı
                 * interrupt'a da yanıt vermez; periyodik uyanış kapanışın
                 * gerçekten uygulanabilmesini sağlar. */
                socket = server.accept(ACCEPT_TIMEOUT_MS);
            } catch (IOException e) {
                if (!running.get() || disposed.get()) return;   // kasıtlı kapanış
                /* Zaman aşımı da IOException'dır — bu bir arıza DEĞİLDİR,
                 * yalnız döngüye devam edilir. */
                continue;
            } catch (SecurityException e) {
                reportError(LinkErrorCode.BLUETOOTH_PERMISSION_DENIED, "accept izni yok");
                setState(ServerState.ERROR);
                return;
            }

            if (socket == null) continue;

            if (activeSocket != null) {
                /* İkinci istemci: mevcut oturum KORUNUR, yeni soket kapatılır. */
                rejectedSecondClientCount++;
                record(LinkDiagnosticEvent.Category.SOCKET, "second-client", null,
                    LinkDiagnosticEvent.Severity.WARN, "ikinci istemci reddedildi");
                closeQuietly(socket);
                continue;
            }

            activeSocket = socket;
            acceptedCount++;
            long generation = generationSource.incrementAndGet();
            setState(ServerState.CLIENT_CONNECTED);
            record(LinkDiagnosticEvent.Category.SOCKET, "accept", null,
                LinkDiagnosticEvent.Severity.INFO, "istemci kabul edildi");

            if (callback != null) callback.onClientAccepted(socket, generation);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * Durum
     * ════════════════════════════════════════════════════════════════════ */

    public ServerState state() { return state; }
    public LinkErrorCode lastError() { return lastError; }
    public long listenStartedAtMs() { return listenStartedAtMs; }
    public long acceptedCount() { return acceptedCount; }
    public long rejectedSecondClientCount() { return rejectedSecondClientCount; }
    public boolean isRunning() { return running.get(); }
    public boolean isDisposed() { return disposed.get(); }
    public boolean hasActiveSocket() { return activeSocket != null; }
    public long currentGeneration() { return generationSource.get(); }

    public void resetCounters() {
        acceptedCount = 0L;
        rejectedSecondClientCount = 0L;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * İç
     * ════════════════════════════════════════════════════════════════════ */

    private void setState(ServerState next) {
        if (state == next) return;
        state = next;
        if (callback != null) callback.onServerStateChanged(next.name());
    }

    private void reportError(LinkErrorCode code, String safeDetails) {
        lastError = code;
        record(LinkDiagnosticEvent.Category.BLUETOOTH, "server", code,
            LinkDiagnosticEvent.Severity.ERROR, safeDetails);
        if (callback != null) callback.onServerError(code, safeDetails);
    }

    private void record(LinkDiagnosticEvent.Category category, String stage,
                        LinkErrorCode code, LinkDiagnosticEvent.Severity severity,
                        String details) {
        if (diagnostics == null) return;
        diagnostics.record(clock.nowMs(), LinkDiagnosticEvent.Side.HEAD_UNIT,
            category, stage, code, severity, generationSource.get(), details);
    }

    private static void closeQuietly(BluetoothServerSocket s) {
        if (s == null) return;
        try { s.close(); } catch (IOException e) { Log.d(TAG, "listen kapanis"); }
    }

    private static void closeQuietly(BluetoothSocket s) {
        if (s == null) return;
        try { s.close(); } catch (IOException e) { Log.d(TAG, "soket kapanis"); }
    }
}
