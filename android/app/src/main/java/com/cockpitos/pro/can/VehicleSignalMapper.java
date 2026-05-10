package com.cockpitos.pro.can;

import android.util.Log;

import java.util.List;

/**
 * CAN frame'lerini araç sinyallerine dönüştürür.
 *
 * Tüm CAN ID'leri araç başına yapılandırılabilir — configure() ile güncellenir.
 * Değerlerin sanity sınırları Java katmanında kontrol edilir (ilk güvenlik katmanı).
 * JS katmanında ek sınır kontrolü mevcuttur (savunma derinliği).
 */
public final class VehicleSignalMapper {

    private static final String TAG = "VehicleSignalMapper";

    // ── CAN ID tablosu (volatile — configure() ile runtime güncellenebilir) ──

    private volatile int CAN_ID_SPEED    = 0x0C9;
    private volatile int CAN_ID_GEAR     = 0x0E8;
    private volatile int CAN_ID_FUEL     = 0x145;
    private volatile int CAN_ID_RPM      = 0x316;
    private volatile int CAN_ID_COOLANT  = 0x294;
    private volatile int CAN_ID_OIL_TEMP = 0x280;
    private volatile int CAN_ID_THROTTLE = 0x201;
    private volatile int CAN_ID_BATT_VOLT= 0x3A0;
    private volatile int CAN_ID_GEAR_POS = 0x1D0;
    private volatile int CAN_ID_AMBIENT  = 0x350;
    private volatile int CAN_ID_DOORS    = 0x3B0;
    private volatile int CAN_ID_LIGHTS   = 0x1A0;
    private volatile int CAN_ID_TPMS     = 0x385;
    private volatile int CAN_ID_CHASSIS  = 0x0C0;
    private volatile int CAN_ID_BODY     = 0x3D0;

    // ── Bit maskeleri ────────────────────────────────────────────────────────
    private static final int GEAR_REVERSE_VAL  = 0x02;
    private static final int DOOR_ANY_OPEN_BIT = 0x0F;
    private static final int HEADLIGHT_BIT     = 0x04;
    private static final int ABS_BIT           = 0x01;
    private static final int TCS_BIT           = 0x02;
    private static final int ESC_BIT           = 0x04;
    private static final int PARK_BRAKE_BIT    = 0x01;
    private static final int SEATBELT_BIT      = 0x02;
    private static final int WIPERS_BIT        = 0x04;
    private static final int AC_BIT            = 0x08;
    private static final int CRUISE_BIT        = 0x10;

    // ── Sanity sınırları (ilk güvenlik katmanı) ──────────────────────────────
    private static final float RPM_MAX       = 10_000f;
    private static final float SPEED_MAX_KMH = 300f;
    private static final float TEMP_MIN      = -40f;
    private static final float TEMP_MAX      =  150f;
    private static final float BATT_MIN      =   8f;
    private static final float BATT_MAX      =  20f;
    private static final float THROTTLE_MIN  =   0f;
    private static final float THROTTLE_MAX  = 100f;

    // ── Partial state — farklı CAN ID'lerden gelen veriler birikir ───────────
    // Tüm alanlar yalnızca read thread'inden erişilir (process + reset).
    private Float   _speed;    private Boolean _reverse;
    private Float   _fuel;     private Float   _rpm;
    private Float   _coolant;  private Float   _oilTemp;
    private Float   _throttle; private Float   _battVolt;
    private Integer _gearPos;  private Float   _ambient;
    private Boolean _doorOpen; private Boolean _headlights;
    private Boolean _abs;      private Boolean _tcs;
    private Boolean _esc;      private Boolean _parkBrake;
    private Boolean _seatbelt; private Boolean _wipers;
    private Boolean _ac;       private Boolean _cruise;
    private float[] _tpms;     // ayrı class field (partial state tutulur)

    // ── API ──────────────────────────────────────────────────────────────────

    /** Araç başına CAN ID yapılandırması. */
    public void configure(
            int speed, int gear, int fuel,
            int rpm, int coolant, int oilTemp, int throttle,
            int battVolt, int gearPos, int ambient,
            int doors, int lights, int tpms,
            int chassis, int body) {
        CAN_ID_SPEED    = speed;
        CAN_ID_GEAR     = gear;
        CAN_ID_FUEL     = fuel;
        CAN_ID_RPM      = rpm;
        CAN_ID_COOLANT  = coolant;
        CAN_ID_OIL_TEMP = oilTemp;
        CAN_ID_THROTTLE = throttle;
        CAN_ID_BATT_VOLT= battVolt;
        CAN_ID_GEAR_POS = gearPos;
        CAN_ID_AMBIENT  = ambient;
        CAN_ID_DOORS    = doors;
        CAN_ID_LIGHTS   = lights;
        CAN_ID_TPMS     = tpms;
        CAN_ID_CHASSIS  = chassis;
        CAN_ID_BODY     = body;
    }

    /**
     * Transport koptuğunda partial state'i temizler.
     * Yalnızca read thread'inden çağrılır (CanBusManager.onTransportLost).
     */
    public void reset() {
        _speed = null;  _reverse = null; _fuel   = null;
        _rpm   = null;  _coolant = null; _oilTemp= null;
        _throttle = null; _battVolt = null; _gearPos= null;
        _ambient  = null; _doorOpen = null; _headlights = null;
        _abs  = null;  _tcs = null;  _esc      = null;
        _parkBrake = null; _seatbelt = null; _wipers = null;
        _ac   = null;  _cruise = null; _tpms   = null;
        Log.i(TAG, "Partial state sıfırlandı (transport kayboldu)");
    }

    /**
     * Frame listesini işler.
     * Herhangi bir alan güncellenirse güncel partial state'ten snapshot döner, aksi hâlde null.
     * Builder her çağrıda yeniden oluşturulur — stale referans riski yok.
     */
    public VehicleCanData process(List<CanFrameDecoder.CanSignal> signals) {
        // volatile alanları yerel kopyaya al — tutarlı tek-frame okuma
        final int idSpeed    = CAN_ID_SPEED;
        final int idGear     = CAN_ID_GEAR;
        final int idFuel     = CAN_ID_FUEL;
        final int idRpm      = CAN_ID_RPM;
        final int idCoolant  = CAN_ID_COOLANT;
        final int idOilTemp  = CAN_ID_OIL_TEMP;
        final int idThrottle = CAN_ID_THROTTLE;
        final int idBattVolt = CAN_ID_BATT_VOLT;
        final int idGearPos  = CAN_ID_GEAR_POS;
        final int idAmbient  = CAN_ID_AMBIENT;
        final int idDoors    = CAN_ID_DOORS;
        final int idLights   = CAN_ID_LIGHTS;
        final int idTpms     = CAN_ID_TPMS;
        final int idChassis  = CAN_ID_CHASSIS;
        final int idBody     = CAN_ID_BODY;

        boolean updated = false;

        for (CanFrameDecoder.CanSignal s : signals) {
            final int    id = s.canId;
            final byte[] d  = s.data;

            if (id == idSpeed && d.length >= 2) {
                float v = CanFrameDecoder.u16be(d, 0) * 0.01f;
                if (v >= 0 && v <= SPEED_MAX_KMH) { _speed = v; }
                else Log.d(TAG, "Hız sanity reject: " + v + " km/h");
                updated = true;

            } else if (id == idGear && d.length >= 1) {
                _reverse = (CanFrameDecoder.u8(d, 0) == GEAR_REVERSE_VAL);
                updated  = true;

            } else if (id == idFuel && d.length >= 1) {
                _fuel   = CanFrameDecoder.u8(d, 0) * 100.0f / 255.0f;
                updated = true;

            } else if (id == idRpm && d.length >= 2) {
                float v = CanFrameDecoder.u16be(d, 0) * 0.25f;
                if (v >= 0 && v <= RPM_MAX) { _rpm = v; }
                else Log.d(TAG, "RPM sanity reject: " + v);
                updated = true;

            } else if (id == idCoolant && d.length >= 1) {
                float v = CanFrameDecoder.u8(d, 0) - 40f;
                if (v >= TEMP_MIN && v <= TEMP_MAX) { _coolant = v; }
                else Log.d(TAG, "Coolant sanity reject: " + v + " C");
                updated = true;

            } else if (id == idOilTemp && d.length >= 1) {
                float v = CanFrameDecoder.u8(d, 0) - 40f;
                if (v >= TEMP_MIN && v <= TEMP_MAX) { _oilTemp = v; }
                else Log.d(TAG, "OilTemp sanity reject: " + v + " C");
                updated = true;

            } else if (id == idThrottle && d.length >= 1) {
                float v = CanFrameDecoder.u8(d, 0) * 100.0f / 255.0f;
                if (v >= THROTTLE_MIN && v <= THROTTLE_MAX) { _throttle = v; }
                else Log.d(TAG, "Throttle sanity reject: " + v);
                updated = true;

            } else if (id == idBattVolt && d.length >= 1) {
                float v = CanFrameDecoder.u8(d, 0) * 0.1f;
                if (v >= BATT_MIN && v <= BATT_MAX) { _battVolt = v; }
                else Log.d(TAG, "BattVolt sanity reject: " + v + " V");
                updated = true;

            } else if (id == idGearPos && d.length >= 1) {
                int raw = CanFrameDecoder.u8(d, 0);
                if      (raw == 0x01)                    _gearPos = -1;
                else if (raw == 0x00 || raw == 0x02)     _gearPos =  0;
                else if (raw >= 0x03 && raw <= 0x0B)     _gearPos = raw - 2;
                else                                     _gearPos =  0;
                updated = true;

            } else if (id == idAmbient && d.length >= 1) {
                float v = CanFrameDecoder.u8(d, 0) * 0.5f - 40f;
                if (v >= TEMP_MIN && v <= TEMP_MAX) { _ambient = v; }
                else Log.d(TAG, "Ambient sanity reject: " + v + " C");
                updated = true;

            } else if (id == idDoors && d.length >= 1) {
                _doorOpen = (CanFrameDecoder.u8(d, 0) & DOOR_ANY_OPEN_BIT) != 0;
                updated   = true;

            } else if (id == idLights && d.length >= 1) {
                _headlights = (CanFrameDecoder.u8(d, 0) & HEADLIGHT_BIT) != 0;
                updated     = true;

            } else if (id == idTpms && d.length >= 4) {
                float[] p = new float[4];
                for (int i = 0; i < 4; i++) p[i] = CanFrameDecoder.u8(d, i) * 0.25f;
                _tpms   = p;
                updated = true;

            } else if (id == idChassis && d.length >= 1) {
                int f = CanFrameDecoder.u8(d, 0);
                _abs  = (f & ABS_BIT) != 0;
                _tcs  = (f & TCS_BIT) != 0;
                _esc  = (f & ESC_BIT) != 0;
                updated = true;

            } else if (id == idBody && d.length >= 1) {
                int f      = CanFrameDecoder.u8(d, 0);
                _parkBrake = (f & PARK_BRAKE_BIT) != 0;
                _seatbelt  = (f & SEATBELT_BIT)   != 0;
                _wipers    = (f & WIPERS_BIT)      != 0;
                _ac        = (f & AC_BIT)           != 0;
                _cruise    = (f & CRUISE_BIT)       != 0;
                updated    = true;
            }
        }

        if (!updated) return null;

        // Builder her process() çağrısında yeni oluşturulur — stale referans yok
        VehicleCanData.Builder b = new VehicleCanData.Builder();
        if (_speed     != null) b.speed(_speed);
        if (_reverse   != null) b.reverse(_reverse);
        if (_fuel      != null) b.fuel(_fuel);
        if (_rpm       != null) b.rpm(_rpm);
        if (_coolant   != null) b.coolantTemp(_coolant);
        if (_oilTemp   != null) b.oilTemp(_oilTemp);
        if (_throttle  != null) b.throttle(_throttle);
        if (_battVolt  != null) b.batteryVolt(_battVolt);
        if (_gearPos   != null) b.gearPos(_gearPos);
        if (_ambient   != null) b.ambientTemp(_ambient);
        if (_doorOpen  != null) b.doorOpen(_doorOpen);
        if (_headlights!= null) b.headlights(_headlights);
        if (_abs       != null) b.abs(_abs);
        if (_tcs       != null) b.tractionControl(_tcs);
        if (_esc       != null) b.stabilityControl(_esc);
        if (_parkBrake != null) b.parkingBrake(_parkBrake);
        if (_seatbelt  != null) b.seatbelt(_seatbelt);
        if (_wipers    != null) b.wipers(_wipers);
        if (_ac        != null) b.airCondition(_ac);
        if (_cruise    != null) b.cruiseControl(_cruise);
        // TPMS: clone() ile paylaşılan referans riski ortadan kalkar
        if (_tpms      != null) b.tpms(_tpms.clone());

        return b.build();
    }
}
