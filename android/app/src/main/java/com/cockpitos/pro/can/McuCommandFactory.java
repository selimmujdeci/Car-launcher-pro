package com.cockpitos.pro.can;

/**
 * McuCommandFactory — MCU protokolüne uygun komut paketleri üretir.
 *
 * Paket formatı:
 *   [0xBB][CMD][DATA_LEN][D0..DN][XOR_CRC][0xEE]
 *
 *   FRAME_START = 0xBB
 *   CMD         = 1 byte komut kodu (sadece whitelist'ten)
 *   DATA_LEN    = 1 byte veri uzunluğu (0–8)
 *   D0..DN      = veri baytları
 *   XOR_CRC     = CMD ^ DATA_LEN ^ D0 ^ ... ^ DN
 *   FRAME_END   = 0xEE
 *
 * GÜVENLİK: Sadece bu sınıf üzerinden oluşturulan paketler MCU'ya gönderilebilir.
 * Dışarıdan ham byte dizisi kabul edilmez.
 */
public final class McuCommandFactory {

    // ── Frame sabitleri ────────────────────────────────────────────────────
    static final byte FRAME_START = (byte) 0xBB;
    static final byte FRAME_END   = (byte) 0xEE;

    // ── Komut kodu whitelist ───────────────────────────────────────────────
    public static final byte CMD_HEARTBEAT     = 0x00; // Watchdog canlılık sinyali
    public static final byte CMD_LOCK_DOORS    = 0x10;
    public static final byte CMD_UNLOCK_DOORS  = 0x11;
    public static final byte CMD_HONK_HORN     = 0x20;
    public static final byte CMD_FLASH_LIGHTS  = 0x21;
    public static final byte CMD_ALARM_ON      = 0x30;
    public static final byte CMD_ALARM_OFF     = 0x31;

    /** Whitelist — sadece bu komutlar gönderilir. */
    private static final byte[] ALLOWED_COMMANDS = {
        CMD_HEARTBEAT,
        CMD_LOCK_DOORS,
        CMD_UNLOCK_DOORS,
        CMD_HONK_HORN,
        CMD_FLASH_LIGHTS,
        CMD_ALARM_ON,
        CMD_ALARM_OFF,
    };

    // ── Public factory metodları ───────────────────────────────────────────

    /** Watchdog heartbeat — veri içermeyen canlılık sinyali. */
    public static byte[] heartbeat()    { return buildPacket(CMD_HEARTBEAT,    new byte[0]); }
    public static byte[] lockDoors()    { return buildPacket(CMD_LOCK_DOORS,   new byte[0]); }
    public static byte[] unlockDoors()  { return buildPacket(CMD_UNLOCK_DOORS, new byte[0]); }
    public static byte[] honkHorn()     { return buildPacket(CMD_HONK_HORN,    new byte[0]); }
    public static byte[] flashLights()  { return buildPacket(CMD_FLASH_LIGHTS, new byte[0]); }
    public static byte[] alarmOn()      { return buildPacket(CMD_ALARM_ON,     new byte[0]); }
    public static byte[] alarmOff()     { return buildPacket(CMD_ALARM_OFF,    new byte[0]); }

    // ── Paket oluşturma ────────────────────────────────────────────────────

    /**
     * Whitelist kontrolü + XOR checksum ile paket oluşturur.
     * Komut whitelist'te yoksa null döner (gönderilmez).
     *
     * @param cmd    Komut kodu (whitelist'te olmalı)
     * @param data   Veri baytları (max 8)
     * @return Tam paket veya null (güvensiz komut)
     */
    static byte[] buildPacket(byte cmd, byte[] data) {
        if (!isAllowed(cmd)) return null;
        int dataLen = Math.min(data != null ? data.length : 0, 8);

        // Format: START(1) + CMD(1) + DATA_LEN(1) + DATA(N) + CRC(1) + END(1)
        byte[] packet = new byte[4 + dataLen + 1];
        packet[0] = FRAME_START;
        packet[1] = cmd;
        packet[2] = (byte) dataLen;
        for (int i = 0; i < dataLen; i++) {
            packet[3 + i] = data[i];
        }

        // XOR checksum: CMD ^ DATA_LEN ^ D0 ^ ... ^ DN
        byte crc = (byte) (cmd ^ dataLen);
        for (int i = 0; i < dataLen; i++) crc ^= data[i];

        packet[3 + dataLen] = crc;
        packet[4 + dataLen] = FRAME_END;
        return packet;
    }

    /** Komutun whitelist'te olup olmadığını kontrol eder. */
    static boolean isAllowed(byte cmd) {
        for (byte allowed : ALLOWED_COMMANDS) {
            if (cmd == allowed) return true;
        }
        return false;
    }

    private McuCommandFactory() {} // instantiation yok
}
