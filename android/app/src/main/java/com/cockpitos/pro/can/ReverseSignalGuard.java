package com.cockpitos.pro.can;

/**
 * Reverse sinyal güvenlik filtresi.
 *
 * Kural: Araç > 5 km/h hızda ilerlerken reverse=true sinyali reddedilir.
 * Bu kural native katmanda uygulanır; JS tarafı (VehicleSignalResolver) da aynı kuralı
 * uygular — savunma derinliği için çift kontrol.
 */
public final class ReverseSignalGuard {

    private static final float REVERSE_SPEED_THRESHOLD_KMH = 5.0f;

    private volatile float _lastSpeedKmh = 0f;

    /** Son bilinen hızı güncelle (her hız frame'inde çağrılır). */
    public void updateSpeed(float speedKmh) {
        _lastSpeedKmh = speedKmh;
    }

    /**
     * Reverse sinyalinin geçerli olup olmadığını döner.
     *
     * @param reverse  CAN'dan gelen ham reverse değeri
     * @return  true → sinyal geçerli, false → reddedildi
     */
    public boolean isValid(boolean reverse) {
        if (reverse && _lastSpeedKmh > REVERSE_SPEED_THRESHOLD_KMH) {
            return false; // hız > 5 km/h → reverse kabul edilmez
        }
        return true;
    }

    /** Geçerli hız snapshot'ı (debug). */
    public float getLastSpeedKmh() {
        return _lastSpeedKmh;
    }
}
