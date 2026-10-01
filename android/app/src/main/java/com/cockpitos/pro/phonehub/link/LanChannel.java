package com.cockpitos.pro.phonehub.link;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;

/** Yerel Wi-Fi TCP soketinin {@link PhoneHubChannel} görünümü. */
final class LanChannel implements PhoneHubChannel {

    private final Socket socket;

    LanChannel(Socket socket) {
        this.socket = socket;
    }

    @Override public Transport transport() { return Transport.WIFI; }

    @Override public InputStream input() throws IOException { return socket.getInputStream(); }

    @Override public OutputStream output() throws IOException { return socket.getOutputStream(); }

    @Override public void closeQuietly() {
        try { socket.close(); } catch (IOException ignored) { /* kapanış sessiz */ }
    }

    /** Bağlantı ayarları: gecikmesiz küçük çerçeveler + çekirdek canlılık yoklaması. */
    static void tune(Socket s) {
        try {
            s.setTcpNoDelay(true);
            s.setKeepAlive(true);
            s.setSoTimeout(0);   // canlılık LinkSession kalp atışındadır
        } catch (IOException ignored) { /* ayar uygulanamazsa varsayılanlarla sürer */ }
    }
}
