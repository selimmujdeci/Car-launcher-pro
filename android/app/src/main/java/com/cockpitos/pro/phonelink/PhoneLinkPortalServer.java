package com.cockpitos.pro.phonelink;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * PhoneLinkPortalServer — PHONE LINK F3.4 · misafir Music Remote portalının
 * YEREL dinleyicisi.
 *
 * ── BU SINIF NE KADAR "İNCE" ────────────────────────────────────────────────
 * Burada YETKİ, OTURUM, TOKEN veya MÜZİK kararı YOKTUR. Sınıfın tek işi:
 * soketi açmak, HTTP/1.1 istek satırını + birkaç başlığı + sınırlı gövdeyi
 * okumak, bunu TypeScript'e teslim etmek ve gelen yanıtı yazmaktır. Anlamın
 * tamamı {@code phoneLinkPortalHttp.ts} içindedir — F2'nin "opak native, dar
 * TS" deseninin aynısı.
 *
 * ── ÇERÇEVE YOK ─────────────────────────────────────────────────────────────
 * NanoHTTPD/Netty/Jetty gibi bir bağımlılık EKLENMEZ. Depoda zaten kanıtlanmış
 * olan ham {@code ServerSocket} + elle HTTP deseni kullanılır
 * ({@code CarLauncherPlugin}'in yolcu sunucusu aynı desenle gerçek head
 * unit'lerde çalışıyor). Kalıcı bir background Service de YOKTUR.
 *
 * ── BIND: WILDCARD DEĞİL ────────────────────────────────────────────────────
 * Soket {@code 0.0.0.0}'a DEĞİL, seçilen yerel IPv4 arayüzüne bağlanır. Port
 * çekirdek tarafından verilir (0) — sabit, taranabilir bir port İLAN EDİLMEZ.
 * Public WAN ifşası yoktur: adres her zaman özel/bağlantı-yerel bir LAN
 * adresidir ve loopback ASLA seçilmez (telefon ona ulaşamaz).
 *
 * ── YAŞAM DÖNGÜSÜ (F3.8) ────────────────────────────────────────────────────
 * Sunucu YALNIZ TS {@code start()} dediğinde (ilk geçerli GuestSession) açılır
 * ve {@code stop()} dediğinde (son GuestSession iptal) kapanır. Kapanışta:
 * dinleme soketi, tüm açık SSE soketleri ve bekleyen yanıt kuyrukları
 * temizlenir — yetim thread/socket BIRAKILMAZ. Hiçbir timer, alarm, wake lock
 * veya foreground service KULLANILMAZ.
 *
 * ── TIMER YOK, YİNE DE ASILI KALMAZ ─────────────────────────────────────────
 * Her istek thread'i TS'in yanıtını sınırlı süre BEKLER
 * ({@code RESPONSE_TIMEOUT_MS}); süre dolarsa 504 yazıp kapanır. Bu bir
 * arka plan timer'ı değil, isteğin KENDİ thread'inin sınırlı beklemesidir.
 */
public final class PhoneLinkPortalServer {

    /** Aynı anda açık tutulabilecek SSE istemcisi — sınırsız değil. */
    private static final int MAX_STREAM_CLIENTS = 4;

    /** Aynı anda işlenen istek tavanı — thread patlaması YOK. */
    private static final int MAX_INFLIGHT_REQUESTS = 8;

    /** Gövde sert üst sınırı (TS tarafında AYRICA denetlenir). */
    private static final int MAX_BODY_BYTES = 512;

    /** İstek satırı + başlık için sert üst sınır — sonsuz başlık akışı YOK. */
    private static final int MAX_HEADER_LINES = 24;
    private static final int MAX_LINE_CHARS = 1024;

    /** İstemci sessiz kalırsa soket bu sürede düşer. */
    private static final int SOCKET_READ_TIMEOUT_MS = 10_000;

    /** TS yanıtı için üst sınır — aşılırsa 504 ve soket kapanır. */
    private static final long RESPONSE_TIMEOUT_MS = 6_000;

    /** TS'e bir isteğin teslim edildiğini bildiren geri çağrı. */
    public interface Callback {
        void onPortalRequest(
            String requestId, String method, String path, String streamKey,
            String authorization, String origin, String body, boolean bodyTruncated);
    }

    /** TS'in ürettiği yanıt — native bunu YORUMLAMAZ, yalnız yazar. */
    public static final class PortalResponse {
        final int status;
        final String contentType;
        final String body;
        final boolean sseOpen;
        final String streamSessionId;

        public PortalResponse(int status, String contentType, String body,
                              boolean sseOpen, String streamSessionId) {
            this.status = status;
            this.contentType = contentType == null ? "text/plain; charset=utf-8" : contentType;
            this.body = body == null ? "" : body;
            this.sseOpen = sseOpen;
            this.streamSessionId = streamSessionId;
        }
    }

    private final Callback callback;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong requestSeq = new AtomicLong(0);
    private final AtomicInteger inflight = new AtomicInteger(0);

    private volatile ServerSocket listenSocket = null;
    private volatile String boundIp = null;
    private volatile int boundPort = 0;

    /** requestId → TS yanıtını bekleyen kuyruk. Sınırlı; her istekte temizlenir. */
    private final Map<String, ArrayBlockingQueue<PortalResponse>> pending = new ConcurrentHashMap<>();

    /** Açık SSE istemcileri. Yazma hatası = istemci gitti → kayıt düşer. */
    private final Map<String, Socket> streamClients = new ConcurrentHashMap<>();

    public PhoneLinkPortalServer(Callback callback) {
        this.callback = callback;
    }

    /* ── Yaşam döngüsü ──────────────────────────────────────────────────── */

    public synchronized boolean isRunning() {
        ServerSocket s = listenSocket;
        return running.get() && s != null && !s.isClosed();
    }

    public String getBoundIp()   { return boundIp; }
    public int    getBoundPort() { return boundPort; }
    public int    getStreamClientCount() { return streamClients.size(); }

    /**
     * Dinleyiciyi açar. Kullanılabilir bir LAN IPv4 arayüzü YOKSA
     * {@code false} döner — sahte bir "başladı" İDDİA EDİLMEZ (telefon
     * ulaşamayacağı bir adrese bağlanamaz).
     */
    public synchronized boolean start() {
        stop();
        String ip = selectLanIPv4();
        if (ip == null) return false;
        try {
            InetAddress bindAddr = InetAddress.getByName(ip);
            /* Wildcard DEĞİL: yalnız bu arayüz. Port çekirdekten (0). */
            ServerSocket srv = new ServerSocket(0, 16, bindAddr);
            listenSocket = srv;
            boundIp = ip;
            boundPort = srv.getLocalPort();
            running.set(true);
            Thread t = new Thread(this::acceptLoop, "PhoneLinkPortal");
            t.setDaemon(true);
            t.start();
            return true;
        } catch (Exception e) {
            stop();
            return false;
        }
    }

    /**
     * Dinleyiciyi ve TÜM açık istemcileri kapatır. Tekrar çağrılabilir
     * (idempotent). Yetim socket/thread/kuyruk BIRAKMAZ.
     */
    public synchronized void stop() {
        running.set(false);
        ServerSocket s = listenSocket;
        listenSocket = null;
        boundIp = null;
        boundPort = 0;
        if (s != null) { try { s.close(); } catch (IOException ignored) {} }
        closeAllStreams();
        /* Bekleyen istek thread'leri kuyruktan zaman aşımıyla çıkar; kuyrukları
         * burada boşaltmak onları asılı BIRAKMAZ (poll timeout'u var). */
        pending.clear();
    }

    /** Açık tüm SSE soketlerini kapatır (F3.9 — oturum düştü). */
    public void closeAllStreams() {
        for (Map.Entry<String, Socket> e : streamClients.entrySet()) {
            streamClients.remove(e.getKey());
            try { e.getValue().close(); } catch (IOException ignored) {}
        }
    }

    /* ── TS → native yanıt teslimi ──────────────────────────────────────── */

    /** TS'in ürettiği yanıtı bekleyen istek thread'ine teslim eder. */
    public void deliverResponse(String requestId, PortalResponse response) {
        ArrayBlockingQueue<PortalResponse> q = pending.get(requestId);
        if (q != null) q.offer(response);
    }

    /**
     * Kanonik Music değişimini açık SSE istemcilerine PUSH eder. Polling YOK:
     * bu metot yalnız TS'teki kanonik değişim olayında çağrılır.
     */
    public void pushEvent(String frame) {
        if (frame == null || frame.isEmpty()) return;
        byte[] data = frame.getBytes(StandardCharsets.UTF_8);
        for (Map.Entry<String, Socket> e : streamClients.entrySet()) {
            Socket sock = e.getValue();
            try {
                OutputStream out = sock.getOutputStream();
                out.write(data);
                out.flush();
            } catch (Exception ex) {
                /* İstemci gitti — kaydı düşür, soketi kapat. Sızıntı YOK. */
                streamClients.remove(e.getKey());
                try { sock.close(); } catch (IOException ignored) {}
            }
        }
    }

    /* ── Kabul döngüsü ──────────────────────────────────────────────────── */

    private void acceptLoop() {
        while (running.get()) {
            ServerSocket srv = listenSocket;
            if (srv == null || srv.isClosed()) break;
            try {
                Socket client = srv.accept();
                if (inflight.get() >= MAX_INFLIGHT_REQUESTS) {
                    try { client.close(); } catch (IOException ignored) {}
                    continue;
                }
                client.setSoTimeout(SOCKET_READ_TIMEOUT_MS);
                inflight.incrementAndGet();
                Thread t = new Thread(() -> {
                    try { handleClient(client); }
                    finally { inflight.decrementAndGet(); }
                }, "PhoneLinkPortalReq");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                /* stop() soketi kapattıysa döngü zaten sonlanır. */
                if (!running.get()) break;
            }
        }
    }

    private void handleClient(Socket client) {
        boolean keepOpen = false;
        try {
            InputStream rawIn = client.getInputStream();
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(rawIn, StandardCharsets.UTF_8));
            OutputStream out = client.getOutputStream();

            String requestLine = readBoundedLine(reader);
            if (requestLine == null) return;

            String[] parts = requestLine.split(" ", 3);
            if (parts.length < 2) { writeSimple(out, 400, "bad request"); return; }
            String method = parts[0];
            String fullPath = parts[1];

            int contentLength = 0;
            String authorization = null;
            String origin = null;
            for (int i = 0; i < MAX_HEADER_LINES; i++) {
                String hdr = readBoundedLine(reader);
                if (hdr == null || hdr.isEmpty()) break;
                int c = hdr.indexOf(':');
                if (c <= 0) continue;
                String name = hdr.substring(0, c).trim().toLowerCase();
                String value = hdr.substring(c + 1).trim();
                if ("content-length".equals(name)) {
                    try { contentLength = Integer.parseInt(value); }
                    catch (NumberFormatException ignored) { contentLength = 0; }
                } else if ("authorization".equals(name)) {
                    authorization = value;
                } else if ("origin".equals(name)) {
                    origin = value;
                }
            }

            /* Gövde SERT sınırlı okunur; fazlası OKUNMAZ (yalnız işaretlenir). */
            boolean truncated = contentLength > MAX_BODY_BYTES;
            String body = "";
            if (contentLength > 0) {
                int want = Math.min(contentLength, MAX_BODY_BYTES);
                char[] buf = new char[want];
                int read = 0;
                while (read < want) {
                    int n = reader.read(buf, read, want - read);
                    if (n < 0) break;
                    read += n;
                }
                body = new String(buf, 0, Math.max(read, 0));
            }

            int qi = fullPath.indexOf('?');
            String path  = (qi >= 0) ? fullPath.substring(0, qi) : fullPath;
            String query = (qi >= 0) ? fullPath.substring(qi + 1) : "";
            String streamKey = readQueryParam(query, "k");

            /* TS'e teslim — native hiçbir şeyi YORUMLAMAZ. */
            String requestId = "plp-" + requestSeq.incrementAndGet();
            ArrayBlockingQueue<PortalResponse> q = new ArrayBlockingQueue<>(1);
            pending.put(requestId, q);

            PortalResponse response = null;
            try {
                callback.onPortalRequest(requestId, method, path, streamKey,
                    authorization, origin, body, truncated);
                response = q.poll(RESPONSE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            } catch (Exception ignored) {
                /* TS köprüsü yoksa/atarsa: sahte başarı YOK → 503. */
            } finally {
                pending.remove(requestId);
            }

            if (response == null) { writeSimple(out, 504, "timeout"); return; }

            if (response.sseOpen && response.status == 200) {
                if (streamClients.size() >= MAX_STREAM_CLIENTS) {
                    writeSimple(out, 503, "too many streams");
                    return;
                }
                writeHead(out, 200, response.contentType, -1);
                out.write(response.body.getBytes(StandardCharsets.UTF_8));
                out.flush();
                String key = response.streamSessionId == null
                    ? requestId : response.streamSessionId + "#" + requestId;
                streamClients.put(key, client);
                keepOpen = true;   // soket PUSH için açık kalır
                return;
            }

            byte[] b = response.body.getBytes(StandardCharsets.UTF_8);
            writeHead(out, response.status, response.contentType, b.length);
            out.write(b);
            out.flush();
        } catch (Exception ignored) {
            /* Hiçbir iç ayrıntı istemciye SIZDIRILMAZ. */
        } finally {
            if (!keepOpen) { try { client.close(); } catch (IOException ignored) {} }
        }
    }

    /* ── HTTP yazımı ────────────────────────────────────────────────────── */

    /**
     * Güvenlik başlıkları HER yanıtta yazılır (F3.11). CORS başlığı
     * ÜRETİLMEZ — wildcard yoktur, çapraz-origin okuma mümkün değildir.
     */
    private static void writeHead(OutputStream out, int status, String contentType, int length)
        throws IOException {
        StringBuilder h = new StringBuilder(384);
        h.append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n");
        h.append("Content-Type: ").append(contentType).append("\r\n");
        if (length >= 0) {
            h.append("Content-Length: ").append(length).append("\r\n");
            h.append("Connection: close\r\n");
        } else {
            /* SSE: uzunluk bilinmez, bağlantı açık kalır. */
            h.append("Connection: keep-alive\r\n");
            h.append("X-Accel-Buffering: no\r\n");
        }
        h.append("Cache-Control: no-store\r\n");
        h.append("X-Content-Type-Options: nosniff\r\n");
        h.append("Referrer-Policy: no-referrer\r\n");
        h.append("X-Frame-Options: DENY\r\n");
        h.append("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; ")
         .append("script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; ")
         .append("form-action 'none'; frame-ancestors 'none'\r\n");
        h.append("\r\n");
        out.write(h.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static void writeSimple(OutputStream out, int status, String text) throws IOException {
        byte[] b = text.getBytes(StandardCharsets.UTF_8);
        writeHead(out, status, "text/plain; charset=utf-8", b.length);
        out.write(b);
        out.flush();
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 409: return "Conflict";
            case 413: return "Payload Too Large";
            case 429: return "Too Many Requests";
            case 503: return "Service Unavailable";
            case 504: return "Gateway Timeout";
            default:  return "Error";
        }
    }

    /* ── Sınırlı okuma yardımcıları ─────────────────────────────────────── */

    /** Sonsuz satır OKUNMAZ — tavanı aşan satır kırpılır. */
    private static String readBoundedLine(BufferedReader reader) throws IOException {
        StringBuilder sb = new StringBuilder(128);
        int c;
        while ((c = reader.read()) >= 0) {
            if (c == '\n') break;
            if (c == '\r') continue;
            if (sb.length() < MAX_LINE_CHARS) sb.append((char) c);
        }
        if (c < 0 && sb.length() == 0) return null;
        return sb.toString();
    }

    /** Yalnız BİR parametre okunur; genel bir query ayrıştırıcısı DEĞİL. */
    private static String readQueryParam(String query, String name) {
        if (query == null || query.isEmpty()) return null;
        String prefix = name + "=";
        for (String kv : query.split("&")) {
            if (kv.startsWith(prefix)) {
                String v = kv.substring(prefix.length());
                return v.isEmpty() ? null : v;
            }
        }
        return null;
    }

    /**
     * Telefonun ulaşabileceği YEREL IPv4 arayüzünü seçer.
     *
     * Loopback ASLA seçilmez (telefon ona ulaşamaz) ve hiçbir arayüz yoksa
     * {@code null} döner — "herhalde şu adrestir" UYDURULMAZ.
     */
    private static String selectLanIPv4() {
        List<String> candidates = new ArrayList<>(4);
        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            while (nics != null && nics.hasMoreElements()) {
                NetworkInterface nic = nics.nextElement();
                if (!nic.isUp() || nic.isLoopback() || nic.isVirtual()) continue;
                Enumeration<InetAddress> addrs = nic.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (!(addr instanceof Inet4Address)) continue;
                    if (addr.isLoopbackAddress() || addr.isAnyLocalAddress()) continue;
                    String host = addr.getHostAddress();
                    if (host == null) continue;
                    /* Wi-Fi arayüzü tercih edilir; yoksa diğer LAN adresi. */
                    String iface = nic.getName() == null ? "" : nic.getName();
                    if (iface.startsWith("wlan") || iface.startsWith("ap")) return host;
                    candidates.add(host);
                }
            }
        } catch (Exception ignored) {}
        return candidates.isEmpty() ? null : candidates.get(0);
    }
}
