package com.cockpitos.pro.voice;

/**
 * "Hey Mavi" dinleyicisinin ses-aktivite kapısı — Vosk yalnız konuşma olası
 * karelerde çözülür.
 *
 * SAHA 2026-10-02 (Megane / NWD K2401, park, kimse konuşmuyor): sabit 0,012
 * eşik + 1,2 sn devam süresiyle karelerin %42'si çözülüyordu (310/745); araç
 * içi gürültü RMS 0,003–0,013 eşiğin hemen altında dolaşıyor, her kısa aşım
 * 1,2 sn decode açıyordu → sürekli ~yarım çekirdek boşa.
 *
 * Kurallar (100 ms kare):
 *  - Gürültü tabanı yalnız konuşma DIŞI karelerde öğrenilir (düşüşe hızlı,
 *    yükselişe yavaş uyum) — konuşma tabanı şişirmez.
 *  - Eşik = max(MIN_THRESH, taban × FLOOR_FACTOR) — sessiz kabinde hassasiyet
 *    eski sabit eşikle AYNI kalır (alt sınır).
 *  - Konuşma başlangıcı ONSET_FRAMES ardışık eşik üstü kare ister (tek tıkırtı
 *    açmaz). Kelime başı kaçmasın diye çağıran son PRE_ROLL_FRAMES kareyi saklar
 *    ve başlangıçta onları da besler.
 *  - Başlangıçtan sonra HANGOVER kare boyunca (eşik altına düşse de) çözülür.
 */
public final class WakeVadGate {

    public static final double MIN_THRESH     = 0.012;
    public static final double FLOOR_FACTOR   = 2.0;
    public static final int    ONSET_FRAMES   = 2;
    public static final int    HANGOVER       = 8;
    public static final int    PRE_ROLL_FRAMES = 3;
    static final double FLOOR_RISE = 0.02;  // ~5 sn zaman sabiti
    static final double FLOOR_FALL = 0.15;

    private double floor = -1;   // -1 = henüz öğrenilmedi (sahte 0 yok)
    private int above = 0;
    private int hangover = 0;
    private boolean onsetNow = false;

    /** Kareyi değerlendirir; true → bu kare Vosk'a beslenmeli. */
    public boolean onFrame(double rms) {
        onsetNow = false;
        double th = threshold();
        boolean loud = rms >= th;
        if (hangover > 0) {
            if (loud) hangover = HANGOVER; else hangover--;
            return true;
        }
        if (loud) {
            if (++above >= ONSET_FRAMES) {
                above = 0;
                hangover = HANGOVER;
                onsetNow = true;
                return true;
            }
            return false;
        }
        above = 0;
        learn(rms);
        return false;
    }

    /** Son onFrame çağrısında konuşma YENİ başladıysa true (ön tampon beslenmeli). */
    public boolean onsetNow() { return onsetNow; }

    public double threshold() {
        return floor < 0 ? MIN_THRESH : Math.max(MIN_THRESH, floor * FLOOR_FACTOR);
    }

    /** Öğrenilmiş gürültü tabanı; öğrenilmediyse -1. */
    public double floor() { return floor; }

    private void learn(double rms) {
        if (floor < 0) { floor = rms; return; }
        floor += (rms < floor ? FLOOR_FALL : FLOOR_RISE) * (rms - floor);
    }
}
