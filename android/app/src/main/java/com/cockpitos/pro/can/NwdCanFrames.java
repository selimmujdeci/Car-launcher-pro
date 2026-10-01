package com.cockpitos.pro.can;

/**
 * NwdCanFrames — NWD dış CAN SDK'sının (com.nwd.can.setting) wire formatları. SAF: Android'e
 * bağımlılık YOK (yalnız byte/String) → JUnit ile kilitlenir.
 *
 * Kaynak: CanAllInOne v.26.07.30A dexdump (2026-10-01, Megane 4 / Raise kutusu K2401).
 * NWD kodu KOPYALANMAZ; yalnız alan SIRASI ve bit yerleşimi (wire sözleşmesi) kullanılır.
 *
 * 1) Parcel tabloları — AirConditionState / TPMSInfo.writeToParcel sırası BİREBİR. Her giriş
 *    "<tip><ad>": b=byte (boolean'lar da writeByte ile yazılır), f=float, i=int, s=String.
 *    SIRA DEĞİŞTİRİLEMEZ: Parcel sıralıdır, bir alan kayarsa sonrası bozulur.
 *    AC tablosu 134. alanda (sağ koltuk sırt ısıtma) BİTER: sonraki writeTypedList'in eleman
 *    yerleşimi bilinmiyor; ondan sonraki 4 alan okunmaz (Parcel'in kalanı yok sayılır).
 *
 * 2) Ham çerçeve (onDistributeCanData): [0]=0x6E · [1]=tip · [2]=veri uzunluğu ·
 *    [3..3+len-1]=veri · [3+len]=0xFF. Tipler (RemoteConstant): 1=klima 2=araç bilgisi
 *    3=kapı 4=radar 5=direksiyon tuşu 6=direksiyon açısı 11=CAN ayarı.
 */
final class NwdCanFrames {

    private NwdCanFrames() {}

    static final int HEAD = 0x6E;
    static final int TYPE_AC = 1, TYPE_CAR_INFO = 2, TYPE_DOOR = 3, TYPE_RADAR = 4,
                     TYPE_SWC_KEY = 5, TYPE_SWC_ANGLE = 6, TYPE_CAN_SETTING = 11;

    /** AirConditionState.writeToParcel sırası (1..134). */
    static final String[] AC_FIELDS = {
        "bACSwitch", "bACMode", "bPTCMode", "bECONMode", "bAuto",
        "bFrontWindowDefog", "bBackWindowDefog", "bDual", "bInsideOrOutSideRoot", "bMaxAc",
        "bAirMode_FrontWindow", "bAirMode_Parallel", "bAirMode_Down", "bAirSpeedLevel", "bLeftSeatHeat",
        "bRightSeatHeat", "fLeftSideTemperature", "fRightSideTemperature", "sStrLeftSideTemperature", "sStrRightSideTemperature",
        "bACAuto", "bInsideOrOutSideAutoControl", "bSync", "bMaxFront", "bAirSpeedAuto",
        "bAirMode_Up", "bAirMode_Auto", "bLeftSeatCold", "bRightSeatCold", "bAQSInsideOrOutSideRoot",
        "bRearLock", "bRearCtrl", "bFrontRowWind", "bHandstate", "bDegreeTemp",
        "bOutDegree", "bBackSideTemperature", "sStrBackSideTemperature", "bBackAirMode_Auto", "bBackAuto",
        "bBackAirSpeedAuto", "bBackAirMode_Up", "bBackAirMode_Parallel", "bBackAirMode_Down", "bBackShowAir",
        "bBackAirSpeedLevel", "bBackAirState", "bBackLeftSeatHot", "bBackRightSeatHot", "bBackLeftSeatCold",
        "bBackRightSeatCold", "bWindMode", "bACAreaDegree", "bWindStrongLv", "bSettingType",
        "bAirSpeedLevelMax", "bNegativeIon", "bBackAirLock", "bFrontWindowHeat", "bFxpHeat",
        "bClimate", "bIsClimate", "bAirfiltration", "b3Zone", "bClean",
        "bCleanValue", "bSwing", "bSyncSeatFxp", "bFxpSeatHeatStrongLv", "bAirMode_RightAuto",
        "bAirMode_RightUp", "bAirMode_RightParallel", "bAirMode_RightDown", "bAirQuality", "bAutoDefog",
        "bSoft", "bNormal", "bFast", "bAirMode_UpDown", "bAirMode_ParallelDown",
        "bAirMode_ParallelUp", "bAirMode_ParallelUpDown", "bIon", "bBackAirMode_UpDown", "bBackAirMode_ParallelDown",
        "bBackAirMode_ParallelUp", "bBackAirMode_ParallelUpDown", "bBackAir_Sync", "bBackRightSideTemperature", "sStrBackRightSideTemperature",
        "bColdHotBox", "bForest", "bAirMode_Ceiling", "bLeftSeatMassage", "bRightSeatMassage",
        "bLeftSeatLumbar", "bRightSeatLumbar", "bWindModePrevious", "bWindModeNext", "bBackAirManual",
        "bBackAirBlowing", "bDefaultMode", "bSmartAC", "bRapidHot", "bComfortable",
        "bRapidCold", "bSunroof", "bACComfort", "bHeat", "bBackAirSpeedLevelMax",
        "bBlowing", "bCurtain", "bRear", "bFullAuto", "bRightAirSpeedAuto",
        "bBackAirMode_RightUp", "bBackAirMode_RightParallel", "bBackAirMode_RightDown", "bBackAirMode_RightAuto", "bAirSpeedLevelPoint",
        "bRest", "bFrontWindowWashing", "bFullAutoRight", "bMaxCool", "bReset",
        "bBackAcMax", "bRegen", "bSFlow", "bRightWindModePrevious", "bRightWindModeNext",
        "bBackAc", "bBackRightAirSpeedLevel", "bLeftSeatBackHeat", "bRightSeatBackHeat",
    };

    /** TPMSInfo.writeToParcel sırası (1..43). */
    static final String[] TPMS_FIELDS = {
        "bSettingType",
        "fFrontLeftWheelPressure", "fFrontRightWheelPressure", "fBackLeftWheelPressure", "fBackRightWheelPressure", "fPrepareWheelPressure",
        "fFrontLeftWheelTemp", "fFrontRightWheelTemp", "fBackLeftWheelTemp", "fBackRightWheelTemp", "fPrepareWheelTemp",
        "iFrontLeftWheelBattery", "iFrontRightWheelBattery", "iBackLeftWheelBattery", "iBackRightWheelBattery",
        "bFrontLeftWheelPressureAlarm", "bFrontRightWheelPressureAlarm", "bBackLeftWheelPressureAlarm", "bBackRightWheelPressureAlarm", "bPrepareWheelPressureAlarm",
        "bFrontLeftWheelTempAlarm", "bFrontRightWheelTempAlarm", "bBackLeftWheelTempAlarm", "bBackRightWheelTempAlarm", "bPrepareWheelTempAlarm",
        "fFrontLeftReferPressure", "fFrontRightReferPressure", "fBackLeftReferPressure", "fBackRightReferPressure",
        "sFrontLeftWheelAlarmStr", "sFrontRightWheelAlarmStr", "sBackLeftWheelAlarmStr", "sBackRightWheelAlarmStr",
        "bUnit", "bResetButton", "bShowPrepareWheel", "bDirectTpms", "bReferPressure",
        "bWheelPressure", "bWheelTemp", "bWheelPressureAlarm", "bWheelTempAlarm", "bWheelBattery",
    };

    static char typeOf(String field) { return field.charAt(0); }
    static String nameOf(String field) { return field.substring(1); }

    /**
     * Önceki ve yeni alan değerlerini karşılaştırır. prev == null (ilk anlık görüntü) ise
     * yalnız varsayılan-dışı alanlar yazılır. Değişiklik yoksa boş string.
     */
    static String diff(String[] table, String[] prev, String[] cur) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < table.length && i < cur.length; i++) {
            String now = cur[i];
            if (prev == null) {
                if (isDefault(now)) continue;
                sb.append(nameOf(table[i])).append('=').append(now).append(' ');
            } else if (!now.equals(prev[i])) {
                sb.append(nameOf(table[i])).append(' ').append(prev[i]).append("→").append(now).append(' ');
            }
        }
        return sb.toString().trim();
    }

    /**
     * CarInfo Parcel'inin TÜM 4-baytlık sözcüklerini karşılaştırır (142 alan; Parcel'de
     * int/float/byte hepsi 4 bayt → sözcük i ≈ alan i+1). Değişen sözcük: "#i a→b".
     * Değer float olarak anlamlıysa (sonlu, 1e-3..1e6) "(f=x)" eklenir — tip kanıtsız.
     * {@code skip[i]} true olan sözcükler atlanır (hız sınırı çağıranda).
     */
    static String diffWords(int[] prev, int[] cur, boolean[] skip) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cur.length; i++) {
            if (skip != null && i < skip.length && skip[i]) continue;
            int now = cur[i];
            if (prev == null) {
                if (now == 0) continue;
                sb.append('#').append(i).append('=').append(word(now)).append(' ');
            } else if (i >= prev.length || prev[i] != now) {
                sb.append('#').append(i).append(' ')
                  .append(i < prev.length ? word(prev[i]) : "?").append("→").append(word(now)).append(' ');
            }
        }
        return sb.toString().trim();
    }

    static String word(int w) {
        float f = Float.intBitsToFloat(w);
        float a = Math.abs(f);
        if (w != 0 && !Float.isNaN(f) && !Float.isInfinite(f) && a >= 1e-3f && a <= 1e6f) {
            return w + "(f=" + f + ")";
        }
        return Integer.toString(w);
    }

    static boolean isDefault(String v) {
        return v == null || v.isEmpty() || "0".equals(v) || "0.0".equals(v) || "null".equals(v);
    }

    /** Çerçeve 0x6E başlıklı ve bildirdiği uzunluğu taşıyorsa tipini, değilse -1 döner. */
    static int frameType(byte[] f) {
        if (f == null || f.length < 4 || (f[0] & 0xFF) != HEAD) return -1;
        int len = f[2] & 0xFF;
        if (f.length < 3 + len) return -1;
        return f[1] & 0xFF;
    }

    /** Kapı çerçevesi (tip 3, 1 bayt): bit7 ön sol · 6 ön sağ · 5 arka sol · 4 arka sağ · 3 bagaj · 2 kaput. */
    static String decodeDoor(byte[] f) {
        if (frameType(f) != TYPE_DOOR || (f[2] & 0xFF) < 1) return null;
        int b = f[3] & 0xFF;
        return "önSol=" + bit(b, 7) + " önSağ=" + bit(b, 6) + " arkaSol=" + bit(b, 5)
             + " arkaSağ=" + bit(b, 4) + " bagaj=" + bit(b, 3) + " kaput=" + bit(b, 2);
    }

    /**
     * Radar çerçevesi (tip 4, 20 bayt): [3..10] seviye (arka sol, arka sol-orta, arka sağ-orta,
     * arka sağ, ön sol, ön sol-orta, ön sağ-orta, ön sağ) · [11..18] aynı sırada mesafe ·
     * [19..22] arka sol / arka sağ / ön sol / ön sağ önceki seviye (yazılmaz).
     */
    static String decodeRadar(byte[] f) {
        if (frameType(f) != TYPE_RADAR || (f[2] & 0xFF) < 16) return null;
        StringBuilder sb = new StringBuilder("seviye[arka ");
        for (int i = 3; i <= 6; i++) sb.append(f[i] & 0xFF).append(i < 6 ? "," : "");
        sb.append(" | ön ");
        for (int i = 7; i <= 10; i++) sb.append(f[i] & 0xFF).append(i < 10 ? "," : "");
        sb.append("] mesafe[arka ");
        for (int i = 11; i <= 14; i++) sb.append(f[i] & 0xFF).append(i < 14 ? "," : "");
        sb.append(" | ön ");
        for (int i = 15; i <= 18; i++) sb.append(f[i] & 0xFF).append(i < 18 ? "," : "");
        return sb.append(']').toString();
    }

    /**
     * Direksiyon açısı (tip 6, 6 bayt): [3]=|açı| düşük bayt · [4]=yüksek bayt, negatifse
     * +0x80 · [5..6] ve [7..8] iki ek 16-bit değer (anlamı sahada doğrulanacak). null: çerçeve değil.
     */
    static int[] decodeSwcAngle(byte[] f) {
        if (frameType(f) != TYPE_SWC_ANGLE || (f[2] & 0xFF) < 6) return null;
        int hi = f[4] & 0xFF;
        int mag = (f[3] & 0xFF) | ((hi & 0x7F) << 8);
        int angle = (hi & 0x80) != 0 ? -mag : mag;
        int a2 = (f[5] & 0xFF) | ((f[6] & 0xFF) << 8);
        int a3 = (f[7] & 0xFF) | ((f[8] & 0xFF) << 8);
        return new int[]{ angle, a2, a3 };
    }

    /**
     * CAN ayarı (tip 11, RemoteProtocalPack.packCanSettingInfo): [3]=ayar tipi, sonrası tek
     * değer baytı ya da veri dizisi. Renault/Raise'de masaj · koltuk hafızası gibi merkezi
     * ayarların (CentralState) bu yoldan gelmesi beklenir; tip → anlam sahada çıkarılacak.
     * Ayar tipi döner; tip 11 çerçevesi değilse -1.
     */
    static int canSettingType(byte[] f) {
        if (frameType(f) != TYPE_CAN_SETTING || (f[2] & 0xFF) < 1) return -1;
        return f[3] & 0xFF;
    }

    /** Çerçevenin veri bölümü ("0A FF 01" biçiminde); geçerli çerçeve değilse null. */
    static String payloadHex(byte[] f) {
        if (frameType(f) < 0) return null;
        int end = 3 + (f[2] & 0xFF);
        StringBuilder sb = new StringBuilder();
        for (int i = 3; i < end; i++) {
            if (i > 3) sb.append(' ');
            sb.append(HEX[(f[i] >> 4) & 0xF]).append(HEX[f[i] & 0xF]);
        }
        return sb.toString();
    }

    private static final char[] HEX = "0123456789ABCDEF".toCharArray();

    private static int bit(int b, int n) { return (b >> n) & 1; }
}
