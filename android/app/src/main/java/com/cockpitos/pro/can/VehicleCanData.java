package com.cockpitos.pro.can;

/** Immutable snapshot of resolved CAN signals sent to JS. */
public final class VehicleCanData {

    // ── Temel sürüş verileri ─────────────────────────────────────────────────
    public final Float   speed;        // km/h
    public final Boolean reverse;
    public final Float   fuel;         // 0–100 %

    // ── Motor ────────────────────────────────────────────────────────────────
    public final Float   rpm;          // devir/dak
    public final Float   coolantTemp;  // °C
    public final Float   oilTemp;      // motor yağı °C
    public final Float   throttle;     // 0–100 %

    // ── Elektrik / enerji ────────────────────────────────────────────────────
    public final Float   batteryVolt;  // 12V akü gerilimi (V)

    // ── Vites ────────────────────────────────────────────────────────────────
    /** -1=Geri, 0=P/N, 1–8=ileri vitesler */
    public final Integer gearPos;

    // ── Çevre ────────────────────────────────────────────────────────────────
    public final Float   ambientTemp;  // dış hava °C

    // ── Güvenlik / şasi ──────────────────────────────────────────────────────
    public final Boolean abs;              // ABS aktif
    public final Boolean tractionControl;  // TCS/ASR aktif
    public final Boolean stabilityControl; // ESC/ESP aktif
    public final Boolean parkingBrake;     // El/park freni
    public final Boolean seatbelt;         // Sürücü emniyet kemeri takılı mı

    // ── Konfor / konvansiyonel ───────────────────────────────────────────────
    public final Boolean wipers;       // Silecek aktif
    public final Boolean airCondition; // Klima açık
    public final Boolean cruiseControl;// Seyir saati aktif

    // ── Kapı / aydınlatma ────────────────────────────────────────────────────
    public final Boolean doorOpen;
    public final Boolean headlightsOn;
    public final Boolean highBeam;       // uzun far
    public final Boolean turnLeft;       // sol sinyal
    public final Boolean turnRight;      // sağ sinyal
    public final Boolean hazard;         // dörtlü flaşör

    // ── TPMS ─────────────────────────────────────────────────────────────────
    public final float[] tpms; // [fl, fr, rl, rr] kPa — null if unavailable

    private VehicleCanData(Builder b) {
        this.speed          = b.speed;
        this.reverse        = b.reverse;
        this.fuel           = b.fuel;
        this.rpm            = b.rpm;
        this.coolantTemp    = b.coolantTemp;
        this.oilTemp        = b.oilTemp;
        this.throttle       = b.throttle;
        this.batteryVolt    = b.batteryVolt;
        this.gearPos        = b.gearPos;
        this.ambientTemp    = b.ambientTemp;
        this.abs            = b.abs;
        this.tractionControl  = b.tractionControl;
        this.stabilityControl = b.stabilityControl;
        this.parkingBrake   = b.parkingBrake;
        this.seatbelt       = b.seatbelt;
        this.wipers         = b.wipers;
        this.airCondition   = b.airCondition;
        this.cruiseControl  = b.cruiseControl;
        this.doorOpen       = b.doorOpen;
        this.headlightsOn   = b.headlightsOn;
        this.highBeam       = b.highBeam;
        this.turnLeft       = b.turnLeft;
        this.turnRight      = b.turnRight;
        this.hazard         = b.hazard;
        this.tpms           = b.tpms;
    }

    public static final class Builder {
        Float   speed; Boolean reverse; Float fuel;
        Float   rpm; Float coolantTemp; Float oilTemp; Float throttle;
        Float   batteryVolt; Integer gearPos; Float ambientTemp;
        Boolean abs; Boolean tractionControl; Boolean stabilityControl;
        Boolean parkingBrake; Boolean seatbelt;
        Boolean wipers; Boolean airCondition; Boolean cruiseControl;
        Boolean doorOpen; Boolean headlightsOn; float[] tpms;
        Boolean highBeam; Boolean turnLeft; Boolean turnRight; Boolean hazard;

        public Builder speed(float v)             { speed          = v; return this; }
        public Builder reverse(boolean v)         { reverse        = v; return this; }
        public Builder fuel(float v)              { fuel           = v; return this; }
        public Builder rpm(float v)               { rpm            = v; return this; }
        public Builder coolantTemp(float v)       { coolantTemp    = v; return this; }
        public Builder oilTemp(float v)           { oilTemp        = v; return this; }
        public Builder throttle(float v)          { throttle       = v; return this; }
        public Builder batteryVolt(float v)       { batteryVolt    = v; return this; }
        public Builder gearPos(int v)             { gearPos        = v; return this; }
        public Builder ambientTemp(float v)       { ambientTemp    = v; return this; }
        public Builder abs(boolean v)             { abs            = v; return this; }
        public Builder tractionControl(boolean v) { tractionControl  = v; return this; }
        public Builder stabilityControl(boolean v){ stabilityControl = v; return this; }
        public Builder parkingBrake(boolean v)    { parkingBrake   = v; return this; }
        public Builder seatbelt(boolean v)        { seatbelt       = v; return this; }
        public Builder wipers(boolean v)          { wipers         = v; return this; }
        public Builder airCondition(boolean v)    { airCondition   = v; return this; }
        public Builder cruiseControl(boolean v)   { cruiseControl  = v; return this; }
        public Builder doorOpen(boolean v)        { doorOpen       = v; return this; }
        public Builder headlights(boolean v)      { headlightsOn   = v; return this; }
        public Builder highBeam(boolean v)        { highBeam       = v; return this; }
        public Builder turnLeft(boolean v)        { turnLeft       = v; return this; }
        public Builder turnRight(boolean v)       { turnRight      = v; return this; }
        public Builder hazard(boolean v)          { hazard         = v; return this; }
        public Builder tpms(float[] v)            { tpms           = v; return this; }
        public VehicleCanData build()             { return new VehicleCanData(this); }
    }
}
