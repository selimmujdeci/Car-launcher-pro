package com.cockpitos.pro.can;

/** Immutable snapshot of resolved CAN signals sent to JS. */
public final class VehicleCanData {
    public final Float   speed;        // km/h
    public final Boolean reverse;
    public final Float   fuel;         // 0–100 %
    public final Boolean doorOpen;
    public final Boolean headlightsOn;
    public final float[] tpms;         // [fl, fr, rl, rr] kPa — null if unavailable

    private VehicleCanData(Builder b) {
        this.speed        = b.speed;
        this.reverse      = b.reverse;
        this.fuel         = b.fuel;
        this.doorOpen     = b.doorOpen;
        this.headlightsOn = b.headlightsOn;
        this.tpms         = b.tpms;
    }

    public static final class Builder {
        Float   speed; Boolean reverse; Float fuel;
        Boolean doorOpen; Boolean headlightsOn; float[] tpms;

        public Builder speed(float v)        { speed        = v;    return this; }
        public Builder reverse(boolean v)    { reverse      = v;    return this; }
        public Builder fuel(float v)         { fuel         = v;    return this; }
        public Builder doorOpen(boolean v)   { doorOpen     = v;    return this; }
        public Builder headlights(boolean v) { headlightsOn = v;    return this; }
        public Builder tpms(float[] v)       { tpms         = v;    return this; }
        public VehicleCanData build()        { return new VehicleCanData(this); }
    }
}
