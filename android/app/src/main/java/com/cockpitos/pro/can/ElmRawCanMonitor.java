package com.cockpitos.pro.can;

import android.bluetooth.BluetoothSocket;
import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * ElmRawCanMonitor — ELM327 adaptörünü "Monitor All" (ATMA) moduna geçirir.
 *
 * Bağlı bir BluetoothSocket üzerinden:
 *   1. ELM327'yi sıfırlar ve konfigüre eder (ATZ, ATE0, ATL0, ATH0, ATSP0)
 *   2. ATMA komutu ile tüm CAN frame'lerini dinlemeye başlar
 *   3. Her satırı ("1D0 8 FF 00 32...") listener'a iletir
 *   4. stop() çağrıldığında ATPC (Protocol Close) gönderir
 *
 * Sadece okur — CAN bus'a hiçbir şey yazmaz.
 */
public final class ElmRawCanMonitor {

    public interface FrameListener {
        /** Ham CAN frame satırı: "1D0 8 FF 00 32 00 00 00 00 00" */
        void onFrame(String line);
        void onError(String msg);
        void onReady();
    }

    private static final String TAG      = "ElmRawCan";
    private static final int    TIMEOUT  = 3000;   // ms — AT komut yanıt timeout
    private static final int    BUF_SIZE = 256;

    private final BluetoothSocket _socket;
    private final FrameListener   _listener;
    private final AtomicBoolean   _running = new AtomicBoolean(false);

    private InputStream  _in;
    private OutputStream _out;

    private final ExecutorService _exec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "ElmRawCan");
        t.setDaemon(true);
        return t;
    });
    private Future<?> _task;

    public ElmRawCanMonitor(BluetoothSocket socket, FrameListener listener) {
        this._socket   = socket;
        this._listener = listener;
    }

    /** Raw CAN izlemeyi başlat (socket bağlı olmalı). */
    public synchronized void start() {
        if (_running.get()) return;
        _running.set(true);
        _task = _exec.submit(this::run);
    }

    /** İzlemeyi durdur, ATPC gönder. */
    public synchronized void stop() {
        if (!_running.getAndSet(false)) return;
        try {
            if (_out != null) {
                _out.write("ATPC\r".getBytes(StandardCharsets.US_ASCII));
                _out.flush();
            }
        } catch (IOException ignored) {}
        if (_task != null) { _task.cancel(true); _task = null; }
    }

    // ── Ana iş parçacığı ─────────────────────────────────────────────────────

    private void run() {
        try {
            _in  = _socket.getInputStream();
            _out = _socket.getOutputStream();

            // 1. ELM327 init sekansı
            if (!initElm()) {
                _listener.onError("ELM327 init başarısız");
                return;
            }

            // 2. ATMA — Monitor All
            send("ATMA");
            _listener.onReady();

            // 3. Frame okuma döngüsü
            readLoop();

        } catch (IOException e) {
            if (_running.get()) _listener.onError("IO: " + e.getMessage());
        }
    }

    private boolean initElm() throws IOException {
        String resp;

        // 1. ATZ — sıfırla, ELM327 versiyonunu doğrula
        send("ATZ");
        resp = readUntilPrompt(2500);
        Log.d(TAG, "ATZ: " + resp.trim());
        _listener.onError("[ELM] ATZ: " + resp.trim().replace("\r","").replace("\n"," "));

        // 2. ATE0 — echo kapat (gereksiz yansımayı önle)
        send("ATE0");
        resp = readUntilPrompt(TIMEOUT);
        if (!resp.contains("OK")) Log.w(TAG, "ATE0 yanıtsız: " + resp);

        // 3. ATL0 — satır besleme kapat (parse kolaylığı)
        send("ATL0");
        readUntilPrompt(TIMEOUT);

        // 4. ATS0 — boşlukları kapat (daha hızlı parse, ATMA için önemli)
        send("ATS0");
        readUntilPrompt(TIMEOUT);

        // 5. ATH1 — header AÇIK (CAN ID'yi görmek için — ATMA'da zorunlu)
        send("ATH1");
        resp = readUntilPrompt(TIMEOUT);
        Log.d(TAG, "ATH1: " + resp.trim());

        // 6. ATSP6 — ISO 15765-4 CAN (11-bit, 500kbps) — Fiat C-CAN
        //    ATMA öncesi protokol zorunlu; ATSP0 (auto) bazı ELM327'de ATMA'yı kırar.
        send("ATSP6");
        resp = readUntilPrompt(TIMEOUT);
        Log.d(TAG, "ATSP6: " + resp.trim());

        // 7. 0100 — PID discovery denemesi (bus'u aktive eder, protokolü confirm eder)
        send("0100");
        resp = readUntilPrompt(4000); // araç yanıt vermeyebilir — timeout bekleniyor
        String pidResp = resp.trim().replace("\r","").replace("\n"," ");
        Log.d(TAG, "0100: " + pidResp);
        _listener.onError("[ELM] 0100 yanıt: " + pidResp);

        // Yanıt yoksa ATSP6 yerine ATSP0 dene (bazı araçlar farklı protokol)
        if (resp.contains("NO DATA") || resp.contains("UNABLE") || resp.contains("ERROR")) {
            Log.w(TAG, "ATSP6 başarısız, ATSP0 deneniyor...");
            _listener.onError("[ELM] ATSP6 yok → ATSP0 deneniyor");
            send("ATSP0");
            resp = readUntilPrompt(TIMEOUT);
            send("0100");
            resp = readUntilPrompt(4000);
            _listener.onError("[ELM] ATSP0 + 0100: " + resp.trim().replace("\r","").replace("\n"," "));
        }

        // Init başarılı — ATMA'ya hazır
        _listener.onError("[ELM] Init tamamlandı — ATMA başlatılıyor");
        return true;
    }

    /** ELM327'nin '>' prompt'una kadar okur. */
    private String readUntilPrompt(int timeoutMs) throws IOException {
        StringBuilder sb  = new StringBuilder();
        long          end = System.currentTimeMillis() + timeoutMs;
        byte[]        buf = new byte[1];

        while (System.currentTimeMillis() < end && _running.get()) {
            if (_in.available() > 0) {
                int n = _in.read(buf, 0, 1);
                if (n > 0) {
                    char c = (char)(buf[0] & 0xFF);
                    if (c == '>') break;
                    sb.append(c);
                }
            } else {
                try { Thread.sleep(5); } catch (InterruptedException e) { break; }
            }
        }
        return sb.toString();
    }

    /** ATMA sonrası frame okuma — "1D0 8 FF ..." satırları */
    private void readLoop() throws IOException {
        StringBuilder line = new StringBuilder();
        byte[]        buf  = new byte[BUF_SIZE];

        while (_running.get()) {
            int n = _in.read(buf);
            if (n < 0) break;

            for (int i = 0; i < n; i++) {
                char c = (char)(buf[i] & 0xFF);
                if (c == '\r' || c == '\n') {
                    String s = line.toString().trim();
                    line.setLength(0);
                    if (!s.isEmpty() && !s.equals(">") && !s.startsWith("ATMA")) {
                        _listener.onFrame(s);
                    }
                } else {
                    line.append(c);
                }
            }
        }
    }

    private void send(String cmd) throws IOException {
        String full = cmd + "\r";
        _out.write(full.getBytes(StandardCharsets.US_ASCII));
        _out.flush();
        Log.d(TAG, "→ " + cmd);
    }
}
