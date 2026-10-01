package com.cockpitos.pro.phonehub.link;

import android.bluetooth.BluetoothSocket;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** RFCOMM soketinin {@link PhoneHubChannel} görünümü (sunucu ve istemci aynı sarmalayıcıyı kullanır). */
final class BluetoothChannel implements PhoneHubChannel {

    private final BluetoothSocket socket;

    BluetoothChannel(BluetoothSocket socket) {
        this.socket = socket;
    }

    @Override public Transport transport() { return Transport.BLUETOOTH; }

    @Override public InputStream input() throws IOException { return socket.getInputStream(); }

    @Override public OutputStream output() throws IOException { return socket.getOutputStream(); }

    @Override public void closeQuietly() {
        try { socket.close(); } catch (IOException ignored) { /* kapanış sessiz */ }
    }
}
