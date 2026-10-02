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

    // ── Klima durumu (NWD AirConditionState — saha 2026-10-02, Megane 4 · Raise) ──
    // null = bu kaynak alanı vermiyor / bilinmiyor (sahte 0 YOK).
    public final Boolean climatePower;         // klima sistemi açık (ACSwitch)
    public final Boolean climateAc;            // A/C kompresörü (ACMode)
    public final Boolean climateAuto;
    public final Boolean climateDual;
    public final Boolean climateRecirc;        // iç hava / devridaim
    public final Boolean climateDefrostFront;
    public final Boolean climateDefrostRear;
    public final Integer climateFanLevel;      // 0..climateFanMax
    public final Integer climateFanMax;
    public final Float   climateTempDriver;    // °C (0,5 adım)
    public final Float   climateTempPassenger; // °C

    // ── Tek tek kapılar (NWD ham çerçeve tip 3) ──────────────────────────────
    public final Boolean doorFrontLeft;
    public final Boolean doorFrontRight;
    public final Boolean doorRearLeft;
    public final Boolean doorRearRight;
    public final Boolean trunkOpen;

    // ── Direksiyon açısı (NWD ham çerçeve tip 6; işaretli ham birim, sol −) ──
    public final Integer steeringAngle;

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
        this.climatePower         = b.climatePower;
        this.climateAc            = b.climateAc;
        this.climateAuto          = b.climateAuto;
        this.climateDual          = b.climateDual;
        this.climateRecirc        = b.climateRecirc;
        this.climateDefrostFront  = b.climateDefrostFront;
        this.climateDefrostRear   = b.climateDefrostRear;
        this.climateFanLevel      = b.climateFanLevel;
        this.climateFanMax        = b.climateFanMax;
        this.climateTempDriver    = b.climateTempDriver;
        this.climateTempPassenger = b.climateTempPassenger;
        this.doorFrontLeft  = b.doorFrontLeft;
        this.doorFrontRight = b.doorFrontRight;
        this.doorRearLeft   = b.doorRearLeft;
        this.doorRearRight  = b.doorRearRight;
        this.trunkOpen      = b.trunkOpen;
        this.steeringAngle  = b.steeringAngle;
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
        Boolean climatePower; Boolean climateAc; Boolean climateAuto; Boolean climateDual;
        Boolean climateRecirc; Boolean climateDefrostFront; Boolean climateDefrostRear;
        Integer climateFanLevel; Integer climateFanMax;
        Float   climateTempDriver; Float climateTempPassenger;
        Boolean doorFrontLeft; Boolean doorFrontRight; Boolean doorRearLeft; Boolean doorRearRight;
        Boolean trunkOpen; Integer steeringAngle;

        /** Var olan anlık görüntünün TÜM alanlarını kopyalar (kaynak birleştirme için). */
        public static Builder from(VehicleCanData d) {
            Builder b = new Builder();
            if (d == null) return b;
            b.speed = d.speed; b.reverse = d.reverse; b.fuel = d.fuel;
            b.rpm = d.rpm; b.coolantTemp = d.coolantTemp; b.oilTemp = d.oilTemp; b.throttle = d.throttle;
            b.batteryVolt = d.batteryVolt; b.gearPos = d.gearPos; b.ambientTemp = d.ambientTemp;
            b.abs = d.abs; b.tractionControl = d.tractionControl; b.stabilityControl = d.stabilityControl;
            b.parkingBrake = d.parkingBrake; b.seatbelt = d.seatbelt;
            b.wipers = d.wipers; b.airCondition = d.airCondition; b.cruiseControl = d.cruiseControl;
            b.doorOpen = d.doorOpen; b.headlightsOn = d.headlightsOn; b.tpms = d.tpms;
            b.highBeam = d.highBeam; b.turnLeft = d.turnLeft; b.turnRight = d.turnRight; b.hazard = d.hazard;
            b.climatePower = d.climatePower; b.climateAc = d.climateAc; b.climateAuto = d.climateAuto;
            b.climateDual = d.climateDual; b.climateRecirc = d.climateRecirc;
            b.climateDefrostFront = d.climateDefrostFront; b.climateDefrostRear = d.climateDefrostRear;
            b.climateFanLevel = d.climateFanLevel; b.climateFanMax = d.climateFanMax;
            b.climateTempDriver = d.climateTempDriver; b.climateTempPassenger = d.climateTempPassenger;
            b.doorFrontLeft = d.doorFrontLeft; b.doorFrontRight = d.doorFrontRight;
            b.doorRearLeft = d.doorRearLeft; b.doorRearRight = d.doorRearRight;
            b.trunkOpen = d.trunkOpen; b.steeringAngle = d.steeringAngle;
            return b;
        }

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
        public Builder climatePower(Boolean v)        { climatePower         = v; return this; }
        public Builder climateAc(Boolean v)           { climateAc            = v; return this; }
        public Builder climateAuto(Boolean v)         { climateAuto          = v; return this; }
        public Builder climateDual(Boolean v)         { climateDual          = v; return this; }
        public Builder climateRecirc(Boolean v)       { climateRecirc        = v; return this; }
        public Builder climateDefrostFront(Boolean v) { climateDefrostFront  = v; return this; }
        public Builder climateDefrostRear(Boolean v)  { climateDefrostRear   = v; return this; }
        public Builder climateFanLevel(Integer v)     { climateFanLevel      = v; return this; }
        public Builder climateFanMax(Integer v)       { climateFanMax        = v; return this; }
        public Builder climateTempDriver(Float v)     { climateTempDriver    = v; return this; }
        public Builder climateTempPassenger(Float v)  { climateTempPassenger = v; return this; }
        public Builder doorFrontLeft(Boolean v)       { doorFrontLeft        = v; return this; }
        public Builder doorFrontRight(Boolean v)      { doorFrontRight       = v; return this; }
        public Builder doorRearLeft(Boolean v)        { doorRearLeft         = v; return this; }
        public Builder doorRearRight(Boolean v)       { doorRearRight        = v; return this; }
        public Builder trunkOpen(Boolean v)           { trunkOpen            = v; return this; }
        public Builder steeringAngle(Integer v)       { steeringAngle        = v; return this; }
        public VehicleCanData build()             { return new VehicleCanData(this); }
    }
}
