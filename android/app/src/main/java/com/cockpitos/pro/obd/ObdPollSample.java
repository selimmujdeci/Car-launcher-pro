package com.cockpitos.pro.obd;

/**
 * ObdPollSample — bir poll turunun TÜM PID sonuçlarını taşıyan değişmez veri taşıyıcı (Patch 6).
 *
 * KÖK NEDEN: FAST/SLOW grup ayrışması (bkz. {@link AdaptivePollingController} — TS tarafı
 * src/platform/obd/AdaptivePollingController.ts) ile alan sayısı 4'ten 8'e çıktı (voltage +
 * throttle + intakeTemp + boostPressure eklendi — obdPidConfig.ts bunları zaten JS'ten
 * iletiyordu ama native poll hiç sorgulamıyordu). Büyüyen pozisyonel int parametre listesi
 * ({@code onObdData(int,int,int,int,int,int,int,double)}) hataya açık olurdu; bu taşıyıcı
 * alan isimleriyle netlik sağlar.
 *
 * SÖZLEŞME: desteklenmeyen/henüz ölçülmemiş (bu turda sorgulanmamış) alan -1 (voltage için
 * -1.0) — mevcut sözleşmeyle AYNI: JS sanitizer/obdService bu alanları ATLAR, önceki bilinen
 * değer korunur (kademeli/staggered polling — SLOW grup her turda sorulmaz).
 */
public final class ObdPollSample {
    public final int speed;
    public final int rpm;
    public final int engineTemp;
    public final int fuelLevel;
    public final int throttle;
    public final int intakeTemp;
    public final int boostPressure;
    /** ATRV — 12V akü/besleme voltajı (Volt). -1.0 = bu turda ölçülmedi/desteklenmiyor. */
    public final double voltage;

    public ObdPollSample(int speed, int rpm, int engineTemp, int fuelLevel,
                          int throttle, int intakeTemp, int boostPressure, double voltage) {
        this.speed = speed;
        this.rpm = rpm;
        this.engineTemp = engineTemp;
        this.fuelLevel = fuelLevel;
        this.throttle = throttle;
        this.intakeTemp = intakeTemp;
        this.boostPressure = boostPressure;
        this.voltage = voltage;
    }
}
