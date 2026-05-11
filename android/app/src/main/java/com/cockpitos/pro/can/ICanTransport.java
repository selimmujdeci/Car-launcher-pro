package com.cockpitos.pro.can;

import java.util.List;

/**
 * CAN bus transport soyutlaması.
 *
 * Üç implementasyon:
 *   FileSerialTransport  — dahili UART (/dev/ttyS*, ttyMT*, ttyHS*), su ile chmod bypass
 *   UsbSerialTransport   — USB-to-serial adaptörler (CH340, CP2102, FTDI, CDC ACM)
 *   BtSerialTransport    — Bluetooth RFCOMM (HC-05/HC-06, BT-CAN köprüler)
 *
 * readFrames() her implementasyonda aynı CAN frame formatını döner:
 *   [ ID_HIGH, ID_LOW, D0 .. DN ]
 */
public interface ICanTransport {

    /**
     * Bağlantıyı kur.
     * @param baudRate İstenen baud rate (dosya/USB için kullanılır, BT için yok sayılır)
     * @return true: bağlantı kuruldu
     */
    boolean connect(int baudRate);

    /**
     * O anki OS read chunk'ındaki tüm tamamlanmış CAN frame'lerini döner.
     * Boş liste: timeout / veri yok (döngü devam etmeli).
     * Birden fazla frame aynı pakette gelebilir — hepsi döner.
     * @throws java.io.IOException bağlantı koptu
     * @throws InterruptedException thread durduruldu
     */
    List<byte[]> readFrames() throws java.io.IOException, InterruptedException;

    /**
     * MCU komut paketi yaz.
     * @return true: başarıyla yazıldı
     */
    boolean write(byte[] data);

    /** Bağlantıyı kapat ve kaynakları serbest bırak. */
    void disconnect();

    /** Bağlantı aktif mi? */
    boolean isConnected();

    /** Kısa açıklayıcı isim (log ve canStatus için). */
    String name();
}
