package com.cockpitos.pro.phonehub.link;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * PhoneHubChannel — taşımadan bağımsız TEK bağlantı.
 *
 * ── TAŞIMA GÜVEN ÜRETMEZ ────────────────────────────────────────────────────
 * {@code LinkSession} yalnız iki akış ister. Kimlik imzası, ECDH, oturum
 * şifrelemesi ve 6 haneli doğrulama kodu OTURUMDADIR; bu yüzden Bluetooth
 * RFCOMM ile yerel Wi-Fi TCP AYNI el sıkışmadan ve AYNI kullanıcı onayından
 * geçer. Kanal yalnız baytı taşır — hangi yoldan geldiği bir yetki değildir.
 */
public interface PhoneHubChannel {

    enum Transport { BLUETOOTH, WIFI }

    Transport transport();

    InputStream input() throws IOException;

    OutputStream output() throws IOException;

    /** İdempotent; kapanış hatası yutulur. */
    void closeQuietly();
}
