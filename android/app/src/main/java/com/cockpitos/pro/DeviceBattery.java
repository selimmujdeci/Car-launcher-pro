package com.cockpitos.pro;

/**
 * Cihaz pili okuması — saf karar (Android çağrısı yok, JVM'de test edilir).
 *
 * KÖK: `getDeviceStatus` pil okunamadığında (sticky intent yok, EXTRA_LEVEL eksik)
 * ya da cihazda pil HİÇ YOKKEN (head unit: EXTRA_PRESENT=false) `battery: 0`
 * yazıyordu. Tema durum kümesi bunu "0%" diye gösteriyordu — bilinmeyen değer
 * sahte sıfır olarak sunuluyordu. Artık bu durumlarda `null` (UNKNOWN) döner.
 */
final class DeviceBattery {

    private DeviceBattery() {}

    /**
     * @param present EXTRA_PRESENT (extra hiç yoksa çağıran `true` geçer: seviye geçerliyse gerçek okumadır)
     * @param level   EXTRA_LEVEL (yoksa -1)
     * @param scale   EXTRA_SCALE (yoksa -1)
     * @return 0–100 yüzde; pil yok veya okuma geçersizse {@code null}
     */
    static Integer percentOrNull(boolean present, int level, int scale) {
        if (!present || level < 0 || scale <= 0 || level > scale) return null;
        return (int) ((level / (float) scale) * 100);
    }
}
