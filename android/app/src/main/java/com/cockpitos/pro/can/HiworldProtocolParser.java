package com.cockpitos.pro.can;

import android.util.Log;

/**
 * HiworldProtocolParser — Hiworld H1W0 MCU seri protokol çözümleyici.
 *
 * Frame format:  [0x5A][0xA5][LEN][CMD][D0..DN][XOR]
 *   HDR1 = 0x5A, HDR2 = 0xA5
 *   LEN  = CMD + veri + XOR bayt sayısı (toplam payload)
 *   XOR  = CMD ^ D0 ^ D1 ^ ... ^ DN
 *
 * Kapsam: Hiworld H1W0 serisi head unit'ler (H1W0FT Fiat, H1W0VW VW/Seat/Skoda,
 *         H1W0TO Toyota/Lexus, H1W0NI Nissan, H1W0HY Hyundai/Kia, H1W0GM Opel/Chevy
 *         ve aynı protokol tabanını kullanan genel aftermarket MCU'lar).
 *
 * Veri zaten MCU tarafından decode edilmiş gelir — ham CAN frame değil.
 * Sinyal birimleri komut açıklamalarında belirtilmiştir.
 *
 * READ-ONLY: Araç sistemlerine hiçbir yazma komutu göndermez.
 */
public final class HiworldProtocolParser {

    private static final String TAG  = "HiworldParser";
    private static final byte   HDR1 = 0x5A;
    private static final byte   HDR2 = (byte) 0xA5;
    private static final int    MAX_PAYLOAD = 32;

    // ── Command IDs ──────────────────────────────────────────────────────────
    private static final int CMD_DOOR      = 0x01; // D0: bit0=FL,1=FR,2=RL,3=RR,4=Trunk
    private static final int CMD_AC        = 0x05; // D0: bit0=AC, bit1=Cruise
    private static final int CMD_SPEED     = 0x06; // D0-D1: km/h * 100 big-endian
    private static final int CMD_RPM       = 0x07; // D0-D1: RPM big-endian
    private static final int CMD_TEMPS     = 0x08; // D0=coolant°C+40, D1=oil°C+40
    private static final int CMD_FUEL      = 0x09; // D0: 0-255 → 0-100%
    private static final int CMD_GEAR      = 0x0A; // D0: 0=P/N,1=R,2=N,3+=1,2...
    private static final int CMD_LIGHTS    = 0x0B; // D0: bit2=headlights, bit4=wipers
    private static final int CMD_SAFETY    = 0x0C; // D0: bit0=ABS,1=TCS,2=ESC,3=Park,4=Belt
    private static final int CMD_REVERSE   = 0x11; // D0: 0=no,1=yes
    private static final int CMD_THROTTLE  = 0x15; // D0: 0-100%
    private static final int CMD_BATT_VOLT = 0x16; // D0: volt * 10 (e.g., 138 = 13.8V)
    private static final int CMD_TYRE      = 0x20; // D0-D3: FL,FR,RL,RR kPa * 0.25

    // ── Bit masks ───────────────────────────────────────────────────────────
    private static final int DOOR_ANY     = 0x1F;
    private static final int BIT_HEADLIGHTS = 0x04;
    private static final int BIT_WIPERS     = 0x10;
    private static final int BIT_AC         = 0x01;
    private static final int BIT_CRUISE     = 0x02;
    private static final int BIT_ABS        = 0x01;
    private static final int BIT_TCS        = 0x02;
    private static final int BIT_ESC        = 0x04;
    private static final int BIT_PARK       = 0x08;
    private static final int BIT_BELT       = 0x10;

    // ── Sanity limits ────────────────────────────────────────────────────────
    private static final float SPEED_MAX = 300f;
    private static final float RPM_MAX   = 12_000f;
    private static final float TEMP_MIN  = -40f;
    private static final float TEMP_MAX  = 150f;

    // ── Circular byte buffer (256 bytes, power-of-2 for fast mask) ──────────
    private final byte[] _buf  = new byte[256];
    private       int    _head = 0;
    private       int    _tail = 0;

    // ── Partial state accumulator ────────────────────────────────────────────
    private Float   _speed;    private Boolean _reverse;
    private Float   _fuel;     private Float   _rpm;
    private Float   _coolant;  private Float   _oilTemp;
    private Float   _throttle; private Float   _battVolt;
    private Integer _gearPos;
    private Boolean _doorOpen; private Boolean _headlights;
    private Boolean _abs;      private Boolean _tcs;
    private Boolean _esc;      private Boolean _parkBrake;
    private Boolean _seatbelt; private Boolean _wipers;
    private Boolean _ac;       private Boolean _cruise;
    private float[] _tpms;

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Ham byte chunk'ını besler.
     * Tam ve geçerli frame parse edilirse VehicleCanData döner, aksi hâlde null.
     * Birden fazla frame içeriyorsa en sonuncuyu döner.
     */
    public VehicleCanData feed(byte[] chunk, int len) {
        for (int i = 0; i < len; i++) {
            _buf[_head] = chunk[i];
            _head = (_head + 1) & 0xFF;
            if (_head == _tail) _tail = (_head + 1) & 0xFF; // overflow: eski byte at
        }
        VehicleCanData last = null;
        VehicleCanData r;
        while ((r = tryParse()) != null) last = r;
        return last;
    }

    /** Buffer + partial state sıfırla (transport koptuğunda çağrılır). */
    public void reset() {
        _head = 0; _tail = 0;
        _speed = null; _reverse = null; _fuel = null; _rpm = null;
        _coolant = null; _oilTemp = null; _throttle = null; _battVolt = null;
        _gearPos = null; _doorOpen = null; _headlights = null;
        _abs = null; _tcs = null; _esc = null; _parkBrake = null;
        _seatbelt = null; _wipers = null; _ac = null; _cruise = null;
        _tpms = null;
        Log.i(TAG, "Parser sıfırlandı");
    }

    // ── Frame extraction ─────────────────────────────────────────────────────

    private VehicleCanData tryParse() {
        // HDR1 ara
        while (_tail != _head && _buf[_tail] != HDR1) _tail = (_tail + 1) & 0xFF;

        int avail = (_head - _tail + 256) & 0xFF;
        if (avail < 4) return null; // minimum: HDR1 + HDR2 + LEN + CMD

        int p = _tail;
        if (_buf[(p + 1) & 0xFF] != HDR2) { _tail = (p + 1) & 0xFF; return null; }

        int payloadLen = _buf[(p + 2) & 0xFF] & 0xFF; // CMD + data + XOR
        if (payloadLen < 2 || payloadLen > MAX_PAYLOAD) { _tail = (p + 1) & 0xFF; return null; }

        int total = 3 + payloadLen; // HDR1 + HDR2 + LEN + payload
        if (avail < total) return null; // frame henüz tamamlanmadı

        int  cmd     = _buf[(p + 3) & 0xFF] & 0xFF;
        int  dataLen = payloadLen - 2; // payload = CMD(1) + data(N) + XOR(1)
        byte[] data  = new byte[dataLen];
        for (int i = 0; i < dataLen; i++) data[i] = _buf[(p + 4 + i) & 0xFF];
        int xorRcv   = _buf[(p + 3 + payloadLen - 1) & 0xFF] & 0xFF;

        // XOR kontrolü
        int xorCalc = cmd;
        for (byte b : data) xorCalc ^= (b & 0xFF);
        if ((xorCalc & 0xFF) != xorRcv) {
            Log.v(TAG, "XOR mismatch cmd=0x" + Integer.toHexString(cmd));
            _tail = (p + 1) & 0xFF;
            return null;
        }

        _tail = (p + total) & 0xFF;
        return decodeCmd(cmd, data);
    }

    // ── Signal decoding ──────────────────────────────────────────────────────

    private VehicleCanData decodeCmd(int cmd, byte[] d) {
        boolean updated = false;

        switch (cmd) {

            case CMD_SPEED:
                if (d.length >= 2) {
                    // Bazı Hiworld firmware'ler km/h*100 gönderir, bazıları raw km/h.
                    // Raw firmware ham km/h yollar → SPEED_MAX'ı (300) ASLA aşamaz; ham değer
                    // SPEED_MAX'ı aşıyorsa kesinlikle *100 ölçekli (scaled). Eski 3000 eşiği
                    // scaled firmware'de ≤30 km/h'i (raw 300–3000) reddedip kaybediyordu (#6).
                    int raw = ((d[0] & 0xFF) << 8) | (d[1] & 0xFF);
                    float v = (raw > SPEED_MAX) ? raw * 0.01f : (float) raw;
                    if (v >= 0 && v <= SPEED_MAX) { _speed = v; updated = true; }
                    else Log.d(TAG, "Hız sanity reject: " + v);
                }
                break;

            case CMD_RPM:
                if (d.length >= 2) {
                    float v = ((d[0] & 0xFF) << 8) | (d[1] & 0xFF);
                    if (v >= 0 && v <= RPM_MAX) { _rpm = v; updated = true; }
                    else Log.d(TAG, "RPM sanity reject: " + v);
                }
                break;

            case CMD_FUEL:
                if (d.length >= 1) {
                    _fuel   = (d[0] & 0xFF) * 100.0f / 255.0f;
                    updated = true;
                }
                break;

            case CMD_TEMPS:
                if (d.length >= 1) {
                    float c = (d[0] & 0xFF) - 40f;
                    if (c >= TEMP_MIN && c <= TEMP_MAX) { _coolant = c; updated = true; }
                }
                if (d.length >= 2) {
                    float o = (d[1] & 0xFF) - 40f;
                    if (o >= TEMP_MIN && o <= TEMP_MAX) { _oilTemp = o; updated = true; }
                }
                break;

            case CMD_GEAR:
                if (d.length >= 1) {
                    int raw = d[0] & 0xFF;
                    switch (raw) {
                        case 0x01: _gearPos = -1; _reverse = true;  break; // R
                        case 0x00:
                        case 0x02: _gearPos =  0; _reverse = false; break; // P / N
                        default:
                            if (raw >= 0x03 && raw <= 0x0B) {
                                _gearPos = raw - 2; _reverse = false;
                            } else {
                                _gearPos = 0; _reverse = false;
                            }
                    }
                    updated = true;
                }
                break;

            case CMD_REVERSE:
                if (d.length >= 1) {
                    _reverse = (d[0] & 0xFF) != 0;
                    updated  = true;
                }
                break;

            case CMD_DOOR:
                if (d.length >= 1) {
                    _doorOpen = (d[0] & DOOR_ANY) != 0;
                    updated   = true;
                }
                break;

            case CMD_LIGHTS:
                if (d.length >= 1) {
                    int f = d[0] & 0xFF;
                    _headlights = (f & BIT_HEADLIGHTS) != 0;
                    _wipers     = (f & BIT_WIPERS)     != 0;
                    updated     = true;
                }
                break;

            case CMD_SAFETY:
                if (d.length >= 1) {
                    int f  = d[0] & 0xFF;
                    _abs      = (f & BIT_ABS)  != 0;
                    _tcs      = (f & BIT_TCS)  != 0;
                    _esc      = (f & BIT_ESC)  != 0;
                    _parkBrake= (f & BIT_PARK) != 0;
                    _seatbelt = (f & BIT_BELT) != 0;
                    updated   = true;
                }
                break;

            case CMD_AC:
                if (d.length >= 1) {
                    int f = d[0] & 0xFF;
                    _ac     = (f & BIT_AC)     != 0;
                    _cruise = (f & BIT_CRUISE) != 0;
                    updated = true;
                }
                break;

            case CMD_THROTTLE:
                if (d.length >= 1) {
                    float v = d[0] & 0xFF;
                    if (v >= 0 && v <= 100) { _throttle = v; updated = true; }
                }
                break;

            case CMD_BATT_VOLT:
                if (d.length >= 1) {
                    float v = (d[0] & 0xFF) * 0.1f;
                    if (v >= 8f && v <= 20f) { _battVolt = v; updated = true; }
                }
                break;

            case CMD_TYRE:
                if (d.length >= 4) {
                    float[] p = new float[4];
                    for (int i = 0; i < 4; i++) p[i] = (d[i] & 0xFF) * 0.25f;
                    _tpms   = p;
                    updated = true;
                }
                break;

            default:
                Log.v(TAG, "Bilinmeyen komut: 0x" + Integer.toHexString(cmd));
                break;
        }

        if (!updated) return null;

        VehicleCanData.Builder b = new VehicleCanData.Builder();
        if (_speed      != null) b.speed(_speed);
        if (_reverse    != null) b.reverse(_reverse);
        if (_fuel       != null) b.fuel(_fuel);
        if (_rpm        != null) b.rpm(_rpm);
        if (_coolant    != null) b.coolantTemp(_coolant);
        if (_oilTemp    != null) b.oilTemp(_oilTemp);
        if (_throttle   != null) b.throttle(_throttle);
        if (_battVolt   != null) b.batteryVolt(_battVolt);
        if (_gearPos    != null) b.gearPos(_gearPos);
        if (_doorOpen   != null) b.doorOpen(_doorOpen);
        if (_headlights != null) b.headlights(_headlights);
        if (_abs        != null) b.abs(_abs);
        if (_tcs        != null) b.tractionControl(_tcs);
        if (_esc        != null) b.stabilityControl(_esc);
        if (_parkBrake  != null) b.parkingBrake(_parkBrake);
        if (_seatbelt   != null) b.seatbelt(_seatbelt);
        if (_wipers     != null) b.wipers(_wipers);
        if (_ac         != null) b.airCondition(_ac);
        if (_cruise     != null) b.cruiseControl(_cruise);
        if (_tpms       != null) b.tpms(_tpms.clone());
        return b.build();
    }
}
