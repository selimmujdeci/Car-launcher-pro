package com.cockpitos.pro.can;

import java.util.List;

/**
 * CAN sinyallerini araç domain alanlarına dönüştürür.
 *
 * CAN ID değerleri stub'dur — gerçek araç DBC dosyasıyla değiştirilecek.
 * Her OEM/model için bu ID'ler farklıdır.
 */
public final class VehicleSignalMapper {

    // ── CAN ID tablosu (stub — araç DBC dosyasından gelecek) ─────────────────
    private static final int CAN_ID_SPEED      = 0x0C9; // Hız (km/h × 0.01)
    private static final int CAN_ID_GEAR       = 0x0E8; // Vites / P/R/N/D
    private static final int CAN_ID_FUEL       = 0x145; // Yakıt seviyesi (0–255 → %)
    private static final int CAN_ID_DOORS      = 0x3B0; // Kapı açık/kapalı bitmask
    private static final int CAN_ID_LIGHTS     = 0x1A0; // Far durumu bitmask
    private static final int CAN_ID_TPMS       = 0x385; // Lastik basınçları (kPa × 0.25)

    // Bit maskeleri
    private static final int GEAR_REVERSE_VAL  = 0x02;
    private static final int DOOR_ANY_OPEN_BIT = 0x0F; // bit[0-3]: FL,FR,RL,RR
    private static final int HEADLIGHT_BIT     = 0x04;

    private final VehicleCanData.Builder _builder = new VehicleCanData.Builder();

    // Partial state — farklı CAN ID'lerden gelen veriler birleştirilir
    private Float   _speed; private Boolean _reverse;
    private Float   _fuel;  private Boolean _doorOpen;
    private Boolean _headlights;

    /** Yeni signal listesini işler, tam snapshot oluştuğunda döner (aksi hâlde null). */
    public VehicleCanData process(List<CanFrameDecoder.CanSignal> signals) {
        for (CanFrameDecoder.CanSignal s : signals) {
            switch (s.canId) {
                case CAN_ID_SPEED:
                    if (s.data.length >= 2) {
                        // Örnek: D0D1 big-endian × 0.01 = km/h
                        _speed = CanFrameDecoder.u16be(s.data, 0) * 0.01f;
                    }
                    break;
                case CAN_ID_GEAR:
                    if (s.data.length >= 1) {
                        _reverse = (CanFrameDecoder.u8(s.data, 0) == GEAR_REVERSE_VAL);
                    }
                    break;
                case CAN_ID_FUEL:
                    if (s.data.length >= 1) {
                        _fuel = CanFrameDecoder.u8(s.data, 0) * 100.0f / 255.0f;
                    }
                    break;
                case CAN_ID_DOORS:
                    if (s.data.length >= 1) {
                        _doorOpen = (CanFrameDecoder.u8(s.data, 0) & DOOR_ANY_OPEN_BIT) != 0;
                    }
                    break;
                case CAN_ID_LIGHTS:
                    if (s.data.length >= 1) {
                        _headlights = (CanFrameDecoder.u8(s.data, 0) & HEADLIGHT_BIT) != 0;
                    }
                    break;
                case CAN_ID_TPMS:
                    if (s.data.length >= 4) {
                        float[] p = new float[4];
                        for (int i = 0; i < 4; i++) {
                            p[i] = CanFrameDecoder.u8(s.data, i) * 0.25f;
                        }
                        _builder.tpms(p);
                    }
                    break;
            }
        }

        if (_speed == null && _reverse == null) return null; // henüz yeterli veri yok

        if (_speed    != null) _builder.speed(_speed);
        if (_reverse  != null) _builder.reverse(_reverse);
        if (_fuel     != null) _builder.fuel(_fuel);
        if (_doorOpen != null) _builder.doorOpen(_doorOpen);
        if (_headlights != null) _builder.headlights(_headlights);

        return _builder.build();
    }
}
