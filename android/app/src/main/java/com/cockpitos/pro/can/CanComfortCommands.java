package com.cockpitos.pro.can;

/**
 * CAN kutusuna yazılabilecek TEK komut kümesi — beyaz liste (güvenlik sınırı).
 *
 * Kaynak: NWD Raise/Renault çözücüsü (`CanProtocalUtil.requestCentralSetting`,
 * dexdump 2026-10-02) + saha yankısı (ham çerçeve 0x72 aynı ayar numaralarını
 * geri bildirir). Biçim: {@code 2E 83 02 <ayar no> <değer>} — sağlama toplamını
 * NWD servisi ekler. Durum isteği: {@code 2E 90 02 <tip> 00} (salt okuma).
 *
 * YALNIZ KONFOR: koltuk masajı ve iç ambiyans. Lastik basıncı sıfırlama, kilitler,
 * sürüş destek ayarları (şerit / kör nokta / acil fren) ve klima burada YOKTUR —
 * yanlış yazılmaları güvenlik sonucu doğurur ve ayrı karar ister.
 */
public final class CanComfortCommands {

    private CanComfortCommands() {}

    /** Ayar no → izinli değer aralığı {min, max}; izinli değilse null. */
    static int[] range(int id) {
        switch (id) {
            case 0x90:  // sürücü koltuğu masajı aç/kapa
            case 0x94:  // yolcu koltuğu masajı aç/kapa
            case 0x15:  // iç ambiyans aç/kapa
            case 0x16:  // ön ambiyans
            case 0x17:  // arka ambiyans
                return new int[]{0, 1};
            case 0x91:  // masaj modu — NWD arayüzü: 0 dinlendirici · 1 bel · 2 tonik
                return new int[]{0, 2};
            case 0x92:  // masaj şiddeti — NWD arayüzü: 0–4 (ekranda 1–5)
                return new int[]{0, 4};
            case 0x93:  // masaj hızı (aralık belgelenmedi; sahada 5 görüldü)
                return new int[]{0, 10};
            case 0x18:  // ambiyans rengi (3 bit)
                return new int[]{0, 7};
            case 0x19:  // ambiyans parlaklığı
                return new int[]{0, 100};
            default:
                return null;
        }
    }

    /** İzinli merkezi ayar çerçevesi (sağlamasız); izinli değilse null. */
    public static byte[] centralSetting(int id, int value) {
        int[] r = range(id);
        if (r == null || value < r[0] || value > r[1]) return null;
        return new byte[]{ 0x2E, (byte) 0x83, 0x02, (byte) id, (byte) value };
    }

    /** Ayarın durum yankısının geldiği ham tip: masaj 0x72 · ambiyans 0x71; değilse -1. */
    public static int echoType(int id) {
        if (id >= 0x90 && id <= 0x94) return 0x72;
        if (id >= 0x15 && id <= 0x19) return 0x71;
        return -1;
    }

    /** Salt-okuma durum isteği: lastik 0x61 · yol bilgisayarı 0x81 · merkezi 0x71–0x73. */
    public static byte[] dataRequest(int type) {
        switch (type) {
            case 0x61: case 0x81: case 0x71: case 0x72: case 0x73:
                return new byte[]{ 0x2E, (byte) 0x90, 0x02, (byte) type, 0x00 };
            default:
                return null;
        }
    }
}
