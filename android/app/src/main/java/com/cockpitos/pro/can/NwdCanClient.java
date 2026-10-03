package com.cockpitos.pro.can;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.os.Parcel;
import android.os.RemoteException;
import android.util.Log;

/**
 * NwdCanClient — K24 / NWD head unit RESMÎ üçüncü-taraf CAN SDK istemcisi.
 *
 * Kör probe (K24CanBridge) yerine OEM'in CanAllInOne (com.nwd.can.setting) içine
 * gömdüğü DIŞ (outer) CAN SDK'sını kullanır. Saha + decompile analizi (2026-06-14):
 *   - Servis : com.nwd.can.setting / com.nwd.can.service.CanService (exported)
 *   - Action : com.nwd.can.service.ACTION_CAN_SERVICE
 *   - AIDL   : com.nwd.can.sdk.outer.adil.ICanRemote4OuterFeature
 *   - Erişim : initSdkCfg(appName, appSecrets, appParamJoin, appDesc) — servis doğruluyor;
 *              üçüncü-taraf kimliği "nwdthirdapp" / "d39df3d908cf7136227987e37d5b2c7d" / 0
 *   - Veri   : addCanCarInfoCallBack(cb) → cb.onDistributeCarInfo(CarInfo)
 *   - Ek (2026-10-01): klima (onDistributeAcState) · lastik (onDistributeTpmsInfo) ·
 *              kapı/radar/direksiyon açısı/CAN ayarı (ham çerçeve) — biçimler NwdCanFrames'te.
 *
 * LİSANS: NWD'nin derlenmiş kodu KOPYALANMAZ. Yalnızca açık binder "wire" protokolü
 * (transaction kodları + Parcel alan sırası) kullanılır — kendi Binder/Parcel kodumuz.
 * Bu, sistem servisleriyle konuşmanın standart yoludur ve ticari satışa uygundur.
 *
 * READ-ONLY: araç sistemlerine yazma/kontrol komutu gönderilmez (sendCanData kullanılmaz).
 */
public final class NwdCanClient {

    public interface DecodedListener { void onData(VehicleCanData data); }
    public interface DiagListener    { void onDiag(String msg); }

    private static final String TAG = "NwdCanClient";

    private static final String SVC_PKG    = "com.nwd.can.setting";
    private static final String SVC_ACTION = "com.nwd.can.service.ACTION_CAN_SERVICE";

    private static final String DESC_FEATURE  = "com.nwd.can.sdk.outer.adil.ICanRemote4OuterFeature";
    private static final String DESC_CALLBACK = "com.nwd.can.sdk.outer.adil.ICanRemoteModelCallback";
    private static final String DESC_OUTERCB  = "com.nwd.can.sdk.outer.adil.ICanRemote4OuterCallback";

    // Transaction kodları (decompile, deklarasyon sırası)
    private static final int TX_INIT_SDK_CFG          = 2;   // initSdkCfg(String,String,byte,String)
    // CarInfo dağıtımı (distribution(CarInfo)) servis tarafında mCallbackCarInfoList'i gezer;
    // o listeye ekleyen metod addCarInfoCallBack (kod 17). addCanCarInfoCallBack (27) AYRI
    // listeye ekler → distribution onu kullanmaz. İkisini de kaydet (güvenli).
    private static final int TX_ADD_CARINFO_CB        = 17;  // addCarInfoCallBack — GERÇEK dağıtım yolu
    private static final int TX_ADD_CAN_CARINFO_CB    = 27;  // addCanCarInfoCallBack (yedek)
    private static final int TX_ADD_CANDATA_CB        = 23;  // addCanDataCallBack(ICanRemoteModelCallback) — HAM CAN [B] akışı
    private static final int TX_ADD_CALLBACK4OUTER    = 3;   // addCallBack4Outerface(ICanRemote4OuterCallback) — ham veri
    // Ek dinleme kanalları (2026-10-01 dexdump, Stub.TRANSACTION_* değerleri). Hepsi aynı
    // ICanRemoteModelCallback'i alır; veri ya tipli Parcel ya da tip baytlı ham çerçeve gelir.
    private static final int TX_ADD_AIR_CB            = 9;   // addAirCallBack
    private static final int TX_ADD_DOOR_CB           = 11;  // addDoorCallBack      → ham çerçeve tip 3
    private static final int TX_ADD_SWC_ANGLE_CB      = 13;  // addSWCAngleCallBack  → ham çerçeve tip 6
    private static final int TX_ADD_RADAR_CB          = 15;  // addRadarCallBack     → ham çerçeve tip 4
    private static final int TX_ADD_CAN_SETTING_CB    = 25;  // addCanSettingCallBack → ham çerçeve tip 11 (masaj vb.)
    private static final int TX_ADD_TPMS_CB           = 33;  // addTpmsInfoCallBack  → onDistributeTpmsInfo
    private static final int TX_ADD_CAN_AC_CB         = 35;  // addCanAcCallBack     → onDistributeAcState
    private static final int TX_GET_AC_STATE          = 37;  // getAcState() → AirConditionState (anlık sorgu)
    /** doCheckSumAndWriteData2Uart4CanBox([B]) — ham Raise çerçevesini kutuya yazar (sağlamayı servis ekler). */
    private static final int TX_WRITE_CANBOX          = 5;
    // ICanRemoteModelCallback kodları: 1=onDistributeCanData([B]), 2=onDistributeCarInfo, 3=AmpState, 4=Tpms, 5=AcState
    private static final int TX_ON_DISTRIBUTE_CANDATA = 1;   // callback: onDistributeCanData(byte[])
    private static final int TX_ON_DISTRIBUTE_CARINFO = 2;   // callback: onDistributeCarInfo(CarInfo)
    private static final int TX_ON_DISTRIBUTE_AMP     = 3;   // callback: onDistributeAmpState(AmpState) — kullanılmaz
    private static final int TX_ON_DISTRIBUTE_TPMS    = 4;   // callback: onDistributeTpmsInfo(TPMSInfo)
    private static final int TX_ON_DISTRIBUTE_AC      = 5;   // callback: onDistributeAcState(AirConditionState)
    // ICanRemote4OuterCallback kodları: 1=onDistributeRawData, 2=onDistributeCanData

    // Üçüncü-taraf erişim kimliği (servis doğruluyor → initSucess)
    // NOT (2026-06-14 saha): nwdapp (OEM) kimliği de denendi — sonuç AYNI (sporadik stub
    // snapshot, canlı akış yok). Yani sorun kimlik değil; ROM outer SDK'ya canlı telemetri vermiyor.
    private static final String APP_NAME    = "nwdthirdapp";
    private static final String APP_SECRETS = "d39df3d908cf7136227987e37d5b2c7d";
    private static final byte   APP_PARAM_JOIN = 0;
    private static final String APP_DESC    = "CarOS Pro";

    // Sanity sınırları
    private static final float SPEED_MAX = 300f, RPM_MAX = 12_000f;
    private static final float TEMP_MIN = -40f, TEMP_MAX = 200f;
    // OEM "veri yok / desteklenmiyor" sentinel'i: byte 0xFF (-1). Bu aracın CAN'i
    // taşımadığı alanları 0xFF olarak verir; "!= 0" testi bunu yanlışlıkla "açık"
    // sanıp tell-tale'i kalıcı yakar (saha bug'ı: Fiat Doblo el freni hep kırmızı).
    private static final byte SENTINEL = (byte) 0xFF;

    private volatile boolean   _started  = false;
    private DecodedListener    _listener = null;
    private DiagListener       _diag     = null;
    private Context            _ctx      = null;
    private IBinder            _feature  = null;
    private boolean            _bound    = false;

    // ── Callback binder: servis onDistributeCarInfo'yu buraya transact eder ──
    private final IBinder _callback = new android.os.Binder() {
        @Override
        protected boolean onTransact(int code, Parcel data, Parcel reply, int flags)
                throws RemoteException {
            // GEÇİCİ: servis callback'i hangi kodla çağırıyor (akış teşhisi)
            if (code != INTERFACE_TRANSACTION) {
                long now = android.os.SystemClock.elapsedRealtime();
                _lastCallbackAt = now;   // canlılık: tekrar süzgecinden ÖNCE
                if (now - _lastCbLogMs > 1500L) { _lastCbLogMs = now; diag("callback onTransact code=" + code); }
            }
            if (code == INTERFACE_TRANSACTION) {
                if (reply != null) reply.writeString(DESC_CALLBACK);
                return true;
            }
            if (code == TX_ON_DISTRIBUTE_CARINFO) {
                try {
                    data.enforceInterface(DESC_CALLBACK);
                    int present = data.readInt();          // AIDL parcelable null-flag
                    if (present != 0) {
                        int pos = data.dataPosition();
                        parseCarInfo(data);
                        data.setDataPosition(pos);
                        onCarInfoWords(data, pos);
                    }
                } catch (Throwable t) {
                    diag("onDistributeCarInfo parse hatası: " + t.getMessage());
                }
                if (reply != null) reply.writeNoException();
                return true;
            }
            if (code == TX_ON_DISTRIBUTE_CANDATA) {
                // GEÇİCİ TEŞHİS: ham CAN frame akışı — Hiworld bu yoldan veri veriyor mu?
                try {
                    data.enforceInterface(DESC_CALLBACK);
                    byte[] frame = data.createByteArray();   // [B] doğrudan (null=boş)
                    logRawFrame(frame);
                    onFrame(frame);
                } catch (Throwable t) {
                    diag("onDistributeCanData parse hatası: " + t.getMessage());
                }
                if (reply != null) reply.writeNoException();
                return true;
            }
            if (code == TX_ON_DISTRIBUTE_AC || code == TX_ON_DISTRIBUTE_TPMS) {
                try {
                    data.enforceInterface(DESC_CALLBACK);
                    if (data.readInt() != 0) {             // AIDL parcelable null-flag
                        if (code == TX_ON_DISTRIBUTE_AC) onAcState(data, "push");
                        else                             onTpms(data);
                    }
                } catch (Throwable t) {
                    diag((code == TX_ON_DISTRIBUTE_AC ? "onDistributeAcState" : "onDistributeTpmsInfo")
                        + " parse hatası: " + t.getMessage());
                }
                if (reply != null) reply.writeNoException();
                return true;
            }
            if (code == TX_ON_DISTRIBUTE_AMP) {
                if (reply != null) reply.writeNoException();
                return true;
            }
            return super.onTransact(code, data, reply, flags);
        }
    };

    // GEÇİCİ TEŞHİS: ham dış callback — distribution([B]) bu feature'ı besliyor mu?
    private final IBinder _outerCb = new android.os.Binder() {
        @Override
        protected boolean onTransact(int code, Parcel data, Parcel reply, int flags)
                throws RemoteException {
            if (code == INTERFACE_TRANSACTION) {
                if (reply != null) reply.writeString(DESC_OUTERCB);
                return true;
            }
            if (code == 1 || code == 2) {  // onDistributeRawData / onDistributeCanData
                try {
                    data.enforceInterface(DESC_OUTERCB);
                    int present = data.readInt();
                    int len = (present != 0) ? data.createByteArray().length : -1;
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (now - _lastRawLogMs > 1500L) { _lastRawLogMs = now; diag("HAM veri geldi (kod " + code + ", " + len + " byte) — distribution([B]) AKTİF"); }
                } catch (Throwable t) { diag("ham callback parse: " + t.getMessage()); }
                if (reply != null) reply.writeNoException();
                return true;
            }
            return super.onTransact(code, data, reply, flags);
        }
    };
    private long _lastRawLogMs = 0;

    private final ServiceConnection _conn = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder service) {
            _feature = service;
            diag("CanService bağlandı: " + name.flattenToShortString());
            if (initSdkCfg()) {
                boolean a = registerCallback(TX_ADD_CARINFO_CB, "addCarInfoCallBack");
                boolean b = registerCallback(TX_ADD_CAN_CARINFO_CB, "addCanCarInfoCallBack");
                boolean c = registerCallback(TX_ADD_CANDATA_CB, "addCanDataCallBack");  // ham [B] akışı
                registerOuterCallback();
                if (a || b || c) diag("NWD CAN SDK init+callback OK — CarInfo/HAM akışı bekleniyor");
                // Klima · lastik · kapı · radar · direksiyon açısı (yalnız dinleme kaydı).
                registerCallback(TX_ADD_CAN_AC_CB,    "addCanAcCallBack");
                registerCallback(TX_ADD_AIR_CB,       "addAirCallBack");
                registerCallback(TX_ADD_TPMS_CB,      "addTpmsInfoCallBack");
                registerCallback(TX_ADD_DOOR_CB,      "addDoorCallBack");
                registerCallback(TX_ADD_RADAR_CB,     "addRadarCallBack");
                registerCallback(TX_ADD_SWC_ANGLE_CB, "addSWCAngleCallBack");
                registerCallback(TX_ADD_CAN_SETTING_CB, "addCanSettingCallBack");
                queryAcState();
            }
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            _feature = null;
            diag("CanService bağlantısı kesildi");
        }
    };

    // ── Public API ──────────────────────────────────────────────────────────

    public synchronized void start(DecodedListener listener, DiagListener diag, Context context) {
        if (_started) return;
        _listener = listener;
        _diag     = diag;
        _ctx      = context.getApplicationContext();
        _started  = true;
        diag("NwdCanClient başlatıldı — CanService bind ediliyor");
        try {
            Intent it = new Intent(SVC_ACTION);
            it.setPackage(SVC_PKG);
            _bound = _ctx.bindService(it, _conn, Context.BIND_AUTO_CREATE);
            diag("bindService(" + SVC_ACTION + ") → " + (_bound ? "OK" : "BAŞARISIZ (servis yok/izin?)"));
            if (!_bound) {
                // Action ile bağlanamazsa komponent ile dene (bazı ROM varyantları)
                Intent it2 = new Intent();
                it2.setComponent(new ComponentName(SVC_PKG, "com.nwd.can.service.CanService"));
                _bound = _ctx.bindService(it2, _conn, Context.BIND_AUTO_CREATE);
                diag("bindService(component) → " + (_bound ? "OK" : "BAŞARISIZ"));
            }
        } catch (Throwable t) {
            diag("bindService hatası: " + t.getMessage());
        }
    }

    public synchronized void stop() {
        if (!_started) return;
        _started = false;
        if (_bound && _ctx != null) {
            try { _ctx.unbindService(_conn); } catch (Throwable ignored) {}
        }
        _bound   = false;
        _feature = null;
        diag("NwdCanClient durduruldu");
    }

    // ── SDK init (erişim kapısı) ──────────────────────────────────────────────

    private boolean initSdkCfg() {
        IBinder f = _feature;
        if (f == null) return false;
        Parcel data  = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(DESC_FEATURE);
            data.writeString(APP_NAME);
            data.writeString(APP_SECRETS);
            data.writeByte(APP_PARAM_JOIN);
            data.writeString(APP_DESC);
            f.transact(TX_INIT_SDK_CFG, data, reply, 0);
            reply.readException();
            diag("initSdkCfg gönderildi (nwdthirdapp)");
            return true;
        } catch (Throwable t) {
            diag("initSdkCfg hatası: " + t.getMessage());
            return false;
        } finally {
            reply.recycle();
            data.recycle();
        }
    }

    private void registerOuterCallback() {
        IBinder f = _feature;
        if (f == null) return;
        Parcel data  = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(DESC_FEATURE);
            data.writeStrongBinder(_outerCb);
            f.transact(TX_ADD_CALLBACK4OUTER, data, reply, 0);
            reply.readException();
            diag("addCallBack4Outerface kaydedildi (kod 3, ham veri teşhisi)");
        } catch (Throwable t) {
            diag("addCallBack4Outerface hatası: " + t.getMessage());
        } finally {
            reply.recycle();
            data.recycle();
        }
    }

    private boolean registerCallback(int txCode, String label) {
        IBinder f = _feature;
        if (f == null) return false;
        Parcel data  = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(DESC_FEATURE);
            data.writeStrongBinder(_callback);
            f.transact(txCode, data, reply, 0);
            reply.readException();
            diag(label + " kaydedildi (kod " + txCode + ")");
            return true;
        } catch (Throwable t) {
            diag(label + " hatası: " + t.getMessage());
            return false;
        } finally {
            reply.recycle();
            data.recycle();
        }
    }

    /**
     * Ham Raise çerçevesini kutuya yazar — SDK `doCheckSumAndWriteData2Uart4CanBox`
     * (işlem 5); NWD son baytı sağlama YERİ sayıp yeniden hesaplar → çerçeve sağlama
     * baytıyla gelmeli (CanComfortCommands). NWD'nin kendi uygulaması da
     * aynı yolu kullanır. Çerçeveyi YALNIZ {@link CanComfortCommands} üretir
     * (beyaz liste). Dönüş: istek servise ULAŞTI mı — aracın uyguladığının kanıtı
     * DEĞİLDİR; kanıt kutunun durum yankısıdır (ham çerçeve 0x71/0x72).
     */
    public boolean writeRaiseFrame(byte[] frame) {
        IBinder f = _feature;
        if (f == null || frame == null) return false;
        Parcel data  = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(DESC_FEATURE);
            data.writeByteArray(frame);
            f.transact(TX_WRITE_CANBOX, data, reply, 0);
            reply.readException();
            diag("Kutuya yazıldı: " + NwdCanFrames.hex(frame));
            return true;
        } catch (Throwable t) {
            diag("Kutuya yazma hatası: " + t.getMessage());
            return false;
        } finally {
            reply.recycle();
            data.recycle();
        }
    }

    /** getAcState() — bağlanınca klimanın ANLIK durumunu bir kez okur (push beklemeden). */
    private void queryAcState() {
        IBinder f = _feature;
        if (f == null) return;
        Parcel data  = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(DESC_FEATURE);
            f.transact(TX_GET_AC_STATE, data, reply, 0);
            reply.readException();
            if (reply.readInt() != 0) onAcState(reply, "getAcState");
            else diag("getAcState → null (klima verisi yok)");
        } catch (Throwable t) {
            diag("getAcState hatası: " + t.getMessage());
        } finally {
            reply.recycle();
            data.recycle();
        }
    }

    // ── Klima / lastik / ham çerçeve kanalları ───────────────────────────────
    // SAHA KEŞİF AŞAMASI: değerler henüz VehicleCanData'ya/JS'e AKTARILMAZ. Hangi alanın
    // bu araçta (Megane 4 · Raise) gerçekten dolduğu ve neyi ifade ettiği cihazda
    // doğrulanana dek yalnız DEĞİŞEN alanlar tanı günlüğüne yazılır (kanıtsız anlam yok).

    private String[] _lastAc   = null;
    private String[] _lastTpms = null;
    private String   _lastDoor = null, _lastRadar = null;
    private int      _lastAngle = Integer.MIN_VALUE;
    private long     _lastAngleLogMs = 0;
    private final boolean[] _seenFrameType = new boolean[256];
    private final String[]  _lastSetting   = new String[256];  // ayar tipi → son veri (tip 11)
    private final String[]  _lastPayload   = new String[256];  // çözülmemiş tipler → son veri

    // CarInfo KEŞİF: parseCarInfo 142 alandan ~10'unu okur; kalanı (tüketim, süre, kemer…)
    // hiç görülmüyordu. Parcel'in tamamı sözcük sözcük karşılaştırılır, değişen her alan
    // yazılır. Sürekli değişenler (hız, devir) sözcük başına 1 sn'de en fazla bir kez.
    private int[]  _lastCarWords = null;
    private long[] _carWordLogMs = new long[0];

    private synchronized void onCarInfoWords(Parcel p, int pos) {
        int n = Math.max(0, (p.dataSize() - pos) / 4);
        int[] cur = new int[n];
        for (int i = 0; i < n; i++) cur[i] = p.readInt();
        if (_carWordLogMs.length != n) _carWordLogMs = new long[n];
        long now = android.os.SystemClock.elapsedRealtime();
        boolean[] skip = new boolean[n];
        int[] prev = _lastCarWords;
        for (int i = 0; i < n; i++) {
            boolean changed = prev != null && (i >= prev.length || prev[i] != cur[i]);
            if (changed && now - _carWordLogMs[i] < 1000L) skip[i] = true;
        }
        String d = NwdCanFrames.diffWords(prev, cur, skip);
        // Atlanan sözcüklerin eski değeri korunur → bir sonraki farkta kaçmaz.
        int[] keep = cur.clone();
        for (int i = 0; i < n; i++) {
            if (skip[i] && prev != null && i < prev.length) keep[i] = prev[i];
            else if (prev == null || i >= prev.length || prev[i] != cur[i]) _carWordLogMs[i] = now;
        }
        _lastCarWords = keep;
        if (prev == null) diag("CarInfo ilk durum (" + n + " sözcük): " + (d.isEmpty() ? "tümü 0" : d));
        else if (!d.isEmpty()) diag("CarInfo değişti: " + d);
    }

    /** Tablo-güdümlü Parcel okuyucu — sıra NwdCanFrames tablolarındadır. */
    private static String[] readFields(Parcel p, String[] table) {
        String[] out = new String[table.length];
        for (int i = 0; i < table.length; i++) {
            switch (NwdCanFrames.typeOf(table[i])) {
                case 'b': out[i] = Integer.toString(p.readByte());  break;
                case 'f': out[i] = Float.toString(p.readFloat());   break;
                case 'i': out[i] = Integer.toString(p.readInt());   break;
                default:  out[i] = String.valueOf(p.readString());  break;
            }
        }
        return out;
    }

    private synchronized void onAcState(Parcel p, String src) {
        String[] cur = readFields(p, NwdCanFrames.AC_FIELDS);
        String d = NwdCanFrames.diff(NwdCanFrames.AC_FIELDS, _lastAc, cur);
        boolean first = _lastAc == null;
        _lastAc = cur;
        if (first) diag("Klima ilk durum (" + src + "): " + (d.isEmpty() ? "tüm alanlar 0" : d));
        else if (!d.isEmpty()) diag("Klima değişti: " + d);
        if (first || !d.isEmpty()) {
            /* Saha 2026-10-02 (Megane 4 · Raise): alan anlamları kullanıcı adım adım
               doğruladı. Sıcaklık FLOAT alanı bu araçta −1 kalır; değer METİNDEDİR
               ("17.0℃", kapalıyken "--"). −1 / "--" = bilinmiyor (sahte 0 yok). */
            Boolean power = acBool(cur, AC_SWITCH);
            VehicleCanData.Builder x = VehicleCanData.Builder.from(_lastExtras)
                .climatePower(power)
                .climateAc(acBool(cur, AC_MODE))
                .climateAuto(acBool(cur, AC_AUTO))
                .climateDual(acBool(cur, AC_DUAL))
                .climateRecirc(acBool(cur, AC_RECIRC))
                .climateDefrostFront(acBool(cur, AC_DEFROST_F))
                .climateDefrostRear(acBool(cur, AC_DEFROST_R))
                .climateFanLevel(acInt(cur, AC_FAN))
                .climateFanMax(acInt(cur, AC_FAN_MAX))
                .climateTempDriver(Boolean.FALSE.equals(power) ? null : leadingNumber(at(cur, AC_STR_L)))
                .climateTempPassenger(Boolean.FALSE.equals(power) ? null : leadingNumber(at(cur, AC_STR_R)));
            _lastExtras = x.build();
            emitMerged();
        }
    }

    // ── Birleşik anlık görüntü (saha 2026-10-02) ─────────────────────────────
    // Klima (AC geri çağrısı), kapı (tip 3) ve direksiyon açısı (tip 6) CarInfo'dan
    // AYRI anlarda gelir; JS her `canData` mesajında alanları üzerine yazar. Her
    // emisyon son CarInfo temelini + son ek alanları BİRLİKTE taşır → kısmi mesaj
    // diğer alanları silmez. Yeni otorite değil: aynı tek emisyon yolu.
    private VehicleCanData _lastBase   = null;
    private VehicleCanData _lastExtras = null;

    private synchronized void emitMerged() {
        DecodedListener cb = _listener;
        if (cb == null || !_started) return;
        VehicleCanData x = _lastExtras;
        VehicleCanData.Builder b = VehicleCanData.Builder.from(_lastBase);
        if (x != null) {
            b.climatePower(x.climatePower).climateAc(x.climateAc).climateAuto(x.climateAuto)
             .climateDual(x.climateDual).climateRecirc(x.climateRecirc)
             .climateDefrostFront(x.climateDefrostFront).climateDefrostRear(x.climateDefrostRear)
             .climateFanLevel(x.climateFanLevel).climateFanMax(x.climateFanMax)
             .climateTempDriver(x.climateTempDriver).climateTempPassenger(x.climateTempPassenger)
             .doorFrontLeft(x.doorFrontLeft).doorFrontRight(x.doorFrontRight)
             .doorRearLeft(x.doorRearLeft).doorRearRight(x.doorRearRight)
             .trunkOpen(x.trunkOpen).steeringAngle(x.steeringAngle);
            if (x.climateAc != null) b.airCondition(x.climateAc);
            if (x.doorFrontLeft != null) {
                b.doorOpen(Boolean.TRUE.equals(x.doorFrontLeft) || Boolean.TRUE.equals(x.doorFrontRight)
                        || Boolean.TRUE.equals(x.doorRearLeft) || Boolean.TRUE.equals(x.doorRearRight)
                        || Boolean.TRUE.equals(x.trunkOpen));
            }
        }
        cb.onData(b.build());
    }

    private static final int AC_SWITCH    = acIndex("ACSwitch");
    private static final int AC_MODE      = acIndex("ACMode");
    private static final int AC_AUTO      = acIndex("Auto");
    private static final int AC_DUAL      = acIndex("Dual");
    private static final int AC_RECIRC    = acIndex("InsideOrOutSideRoot");
    private static final int AC_DEFROST_F = acIndex("FrontWindowDefog");
    private static final int AC_DEFROST_R = acIndex("BackWindowDefog");
    private static final int AC_FAN       = acIndex("AirSpeedLevel");
    private static final int AC_FAN_MAX   = acIndex("AirSpeedLevelMax");
    private static final int AC_STR_L     = acIndex("StrLeftSideTemperature");
    private static final int AC_STR_R     = acIndex("StrRightSideTemperature");

    private static int acIndex(String name) {
        for (int i = 0; i < NwdCanFrames.AC_FIELDS.length; i++) {
            if (NwdCanFrames.nameOf(NwdCanFrames.AC_FIELDS[i]).equals(name)) return i;
        }
        return -1;
    }
    private static String at(String[] v, int i) { return (i < 0 || v == null || i >= v.length) ? null : v[i]; }
    /** Bayt alanı: −1 = desteklenmiyor → null; 0 → false; diğer → true. */
    private static Boolean acBool(String[] v, int i) {
        Integer n = acInt(v, i);
        return n == null ? null : n != 0;
    }
    private static Integer acInt(String[] v, int i) {
        String s = at(v, i);
        if (s == null) return null;
        try { int n = Integer.parseInt(s.trim()); return n < 0 ? null : n; } catch (NumberFormatException e) { return null; }
    }
    /** "17.0℃" / "19℃" / "-3℃" → sayı; "--", boş, null → null. */
    static Float leadingNumber(String s) {
        if (s == null) return null;
        java.util.regex.Matcher m = LEADING_NUM.matcher(s.trim());
        if (!m.find()) return null;
        try { return Float.parseFloat(m.group(1).replace(',', '.')); } catch (NumberFormatException e) { return null; }
    }
    private static final java.util.regex.Pattern LEADING_NUM =
        java.util.regex.Pattern.compile("^(-?\\d+(?:[.,]\\d+)?)");

    private synchronized void onTpms(Parcel p) {
        String[] cur = readFields(p, NwdCanFrames.TPMS_FIELDS);
        String d = NwdCanFrames.diff(NwdCanFrames.TPMS_FIELDS, _lastTpms, cur);
        boolean first = _lastTpms == null;
        _lastTpms = cur;
        if (first) diag("Lastik ilk durum: " + (d.isEmpty() ? "tüm alanlar 0" : d));
        else if (!d.isEmpty()) diag("Lastik değişti: " + d);
    }

    private synchronized void onFrame(byte[] frame) {
        int type = NwdCanFrames.frameType(frame);
        if (type < 0) return;
        if (!_seenFrameType[type]) {
            _seenFrameType[type] = true;
            diag("Ham çerçeve tipi ilk kez görüldü: " + type + " (uzunluk " + frame.length + ")");
        }
        if (type == NwdCanFrames.TYPE_DOOR) {
            String s = NwdCanFrames.decodeDoor(frame);
            if (s != null && !s.equals(_lastDoor)) {
                _lastDoor = s;
                diag("Kapı: " + s);
                // Bit eşlemesi sahada tek tek doğrulandı (2026-10-02): 7 ön sol · 6 ön sağ ·
                // 5 arka sol · 4 arka sağ · 3 bagaj. Kaput (bit 2) sahada denenmedi → taşınmaz.
                int b = frame[3] & 0xFF;
                _lastExtras = VehicleCanData.Builder.from(_lastExtras)
                    .doorFrontLeft((b & 0x80) != 0).doorFrontRight((b & 0x40) != 0)
                    .doorRearLeft((b & 0x20) != 0).doorRearRight((b & 0x10) != 0)
                    .trunkOpen((b & 0x08) != 0)
                    .build();
                emitMerged();
            }
        } else if (type == NwdCanFrames.TYPE_RADAR) {
            String s = NwdCanFrames.decodeRadar(frame);
            if (s != null && !s.equals(_lastRadar)) { _lastRadar = s; diag("Radar: " + s); }
        } else if (type == NwdCanFrames.TYPE_SWC_ANGLE) {
            int[] a = NwdCanFrames.decodeSwcAngle(frame);
            long now = android.os.SystemClock.elapsedRealtime();
            // Direksiyon dönerken sürekli değişir → 500 ms'de en fazla bir satır.
            if (a != null && a[0] != _lastAngle && now - _lastAngleLogMs > 500L) {
                _lastAngle = a[0];
                _lastAngleLogMs = now;
                diag("Direksiyon açısı: " + a[0] + " (ek " + a[1] + ", " + a[2] + ")");
                _lastExtras = VehicleCanData.Builder.from(_lastExtras).steeringAngle(a[0]).build();
                emitMerged();
            }
        } else if (type == NwdCanFrames.TYPE_CAN_SETTING) {
            int st = NwdCanFrames.canSettingType(frame);
            String hex = NwdCanFrames.payloadHex(frame);
            if (st >= 0 && hex != null && !hex.equals(_lastSetting[st])) {
                _lastSetting[st] = hex;
                diag("CAN ayarı (tip " + st + "): " + hex);
            }
        } else if (type != NwdCanFrames.TYPE_CAR_INFO) {
            // Çözücüsü olmayan tipler (klima çerçevesi 1, direksiyon tuşu 5 …): içerik
            // değiştikçe ham veri yazılır. Araç bilgisi (2) Parcel'den çözülür ve sürekli
            // değişir → yazılmaz.
            String hex = NwdCanFrames.payloadHex(frame);
            if (hex != null && !hex.equals(_lastPayload[type])) {
                _lastPayload[type] = hex;
                diag("Ham çerçeve tip " + type + ": " + hex);
            }
        }
    }

    // ── CarInfo Parcel çözücü (alan sırası decompile'dan birebir — 142 alan) ──
    // SIRA DEĞİŞTİRİLEMEZ: Parcel sıralıdır, bir alan kayarsa sonrası bozulur.

    private void parseCarInfo(Parcel p) {
        // 1-15: mileage/elec (kullanılmıyor — sıra için okunur)
        p.readInt(); p.readInt(); p.readInt(); p.readInt();        // mDrivingMile, 1,2,3
        p.readInt(); p.readInt(); p.readInt();                     // mCanDriverMileage 1,2,3
        p.readFloat(); p.readFloat(); p.readFloat();               // mElecPow 1,2,3
        p.readInt(); p.readInt(); p.readInt();                     // mElecCanDriver 1,2,3
        p.readFloat(); p.readFloat();                              // mTRIPAMile, mTRIPBMile
        int   mInstantanSpeed = p.readInt();                       // 16
        p.readInt(); p.readInt(); p.readInt();                     // mEquallySpeed 1,2,3
        p.readByte();                                              // mSpeedUnit
        p.readInt(); p.readInt(); p.readInt();                     // mDriverTime 1,2,3
        int   mEngineSpeed    = p.readInt();                       // 24
        float mCoolantTemp    = p.readFloat();                     // 25
        p.readFloat(); p.readFloat(); p.readFloat(); p.readFloat();// mInstantanOil, mAverageOil 1..3
        p.readByte();                                              // mOilConsumptionUnit
        float mOilSurplus     = p.readFloat();                     // 31
        p.readByte();                                              // mOilLowWarning
        float mBatteryVoltage = p.readFloat();                     // 33
        p.readFloat();                                             // mElectric
        p.readByte();                                              // mBatteryVoltageStatus
        p.readInt();                                               // mBatteryCapacity
        byte  mSafetyBelt     = p.readByte();                      // 37
        p.readByte();                                              // mFrontRightSafetyBelt
        byte  mHandbrake      = p.readByte();                      // 39
        p.readByte();                                              // mCleaningLiquid
        p.readInt(); p.readInt(); p.readInt(); p.readInt(); p.readInt(); // door locks 41..45
        byte  mHighbeam       = p.readByte();                      // 46
        byte  mDippedheadlight= p.readByte();                      // 47
        p.readByte(); p.readByte();                                // before/after fog
        p.readByte(); p.readByte();                                // right/left turn signal
        p.readByte();                                              // mHazardWarningSignal
        p.readByte(); p.readByte(); p.readByte();                  // big/small/width lamps
        p.readByte(); p.readByte();                                // back light, brake light
        p.readByte();                                              // caution light
        p.readByte();                                              // mComfurtableUnit
        p.readInt();                                               // mComfurtableValue
        p.readByte();                                              // mComfurtableMax
        p.readByte();                                              // mCurrentMachineOil
        p.readByte();                                              // mMileageUnit
        p.readByte(); p.readInt(); p.readByte(); p.readInt(); p.readByte(); // machineOilCheck*
        p.readByte(); p.readInt(); p.readByte(); p.readInt(); p.readByte(); // tireCheck*
        p.readByte(); p.readByte(); p.readInt(); p.readByte(); p.readInt(); p.readByte(); // carCheck*
        p.readByte();                                              // mTempUnit
        String strOutTemp   = p.readString();                     // mstrOuttemp ("19℃")
        String strWaterTemp = p.readString();                     // mstrWaterTemp
        p.readInt(); p.readInt();                                  // mCarInPm, mCarOutPm
        byte  mRainWipwerLevel= p.readByte();                      // 85
        byte  mAccStatus      = p.readByte();                      // 86
        float mWaterTemp      = p.readFloat();                     // 87
        p.readFloat();                                             // mTyrePulseData (genel)
        float tpmsLF = p.readFloat();                              // 89
        float tpmsRF = p.readFloat();                              // 90
        float tpmsLB = p.readFloat();                              // 91
        float tpmsRB = p.readFloat();                              // 92
        p.readByte();                                              // mCarKeyStatus
        p.readByte();                                              // mRoadStatus
        p.readByte();                                              // mTireStatus
        byte  mDoorOpen       = p.readByte();                      // 96
        p.readByte();                                              // mCheckEngine
        p.readByte();                                              // mTransmission
        p.readByte(); p.readByte();                                // airbag 1,2
        p.readByte();                                              // mCoolantTempStatus
        p.readByte();                                              // mEpsStatus
        byte  mEspStatus      = p.readByte();                      // 103
        p.readByte();                                              // mParkingIndicator
        byte  mGear           = p.readByte();                      // 105
        p.readByte(); p.readByte(); p.readByte(); p.readByte();    // 106..109 indicators
        byte  mABSIndicator   = p.readByte();                      // 110
        p.readByte(); p.readByte(); p.readByte();                  // driveMode, drivingMode, instrumentTheme
        p.readFloat(); p.readFloat();                             // charging voltage/current
        p.readInt(); p.readInt(); p.readInt(); p.readInt(); p.readInt(); // chargingPower..remainingM
        // 121..138 fault/indicator byte'ları
        for (int i = 0; i < 18; i++) p.readByte();
        p.readFloat();                                             // mBatteryTemp
        p.readString();                                           // mBatteryTempStr
        p.readString();                                           // mRecoveryLevelStr
        p.readByte();                                              // mRecoveryLevel (142)

        // ── VehicleCanData'ya map (yalnız makul değerler) ──
        VehicleCanData.Builder b = new VehicleCanData.Builder();
        if (mInstantanSpeed >= 0 && mInstantanSpeed <= SPEED_MAX) b.speed(mInstantanSpeed);
        if (mEngineSpeed   >= 0 && mEngineSpeed   <= RPM_MAX)     b.rpm(mEngineSpeed);
        if (mOilSurplus    >= 0 && mOilSurplus    <= 100f)        b.fuel(mOilSurplus);
        float coolant = (mCoolantTemp > TEMP_MIN && mCoolantTemp < TEMP_MAX) ? mCoolantTemp
                      : (mWaterTemp  > TEMP_MIN && mWaterTemp  < TEMP_MAX) ? mWaterTemp : Float.NaN;
        /* SAHA 2026-10-02 (Megane 4 · Raise): kutu soğutma suyunu DOLDURMUYOR —
           desteklenmeyen diğer alanlar −1 iken bu iki float 0,0 kalıyor ve metni
           null. Motor rölantideyken "0 °C" sahte değerdir → bilinmiyor (sahte 0 yok). */
        if (mCoolantTemp == 0f && mWaterTemp == 0f && strWaterTemp == null) coolant = Float.NaN;
        Float outTemp = leadingNumber(strOutTemp);   // "19℃" → 19; "--"/null → bilinmiyor
        if (!Float.isNaN(coolant)) b.coolantTemp(coolant);
        if (mBatteryVoltage > 0 && mBatteryVoltage < 32) b.batteryVolt(mBatteryVoltage);
        b.gearPos(mGear);
        if (outTemp != null && outTemp > -60f && outTemp < 70f) b.ambientTemp(outTemp);
        // 0xFF (-1) sentinel → alan desteklenmiyor: göstergeyi HİÇ yazma (default kapalı
        // kalsın + system-settings yolunu ezme). Araç gerçekten taşıyorsa (0/1) yazılır.
        if (mDoorOpen   != SENTINEL) b.doorOpen(mDoorOpen != 0);
        if (mHandbrake  != SENTINEL) b.parkingBrake(mHandbrake != 0);
        if (mSafetyBelt != SENTINEL) b.seatbelt(mSafetyBelt != 0);
        boolean hbKnown = mHighbeam        != SENTINEL;
        boolean dlKnown = mDippedheadlight != SENTINEL;
        if (hbKnown || dlKnown) b.headlights((hbKnown && mHighbeam != 0) || (dlKnown && mDippedheadlight != 0));
        if (mRainWipwerLevel != SENTINEL) b.wipers(mRainWipwerLevel > 0);
        if (mEspStatus    != SENTINEL) b.stabilityControl(mEspStatus != 0);
        if (mABSIndicator != SENTINEL) b.abs(mABSIndicator != 0);
        b.tpms(new float[]{ tpmsLF, tpmsRF, tpmsLB, tpmsRB });

        VehicleCanData out = b.build();

        // ── GEÇİCİ DOĞRULAMA TANISI (2s throttle) — cihazda CarInfo akışını teyit ──
        // TODO: cihaz doğrulamasından sonra kaldır.
        long now = android.os.SystemClock.elapsedRealtime();
        if (now - _lastDiagMs > 2000L) {
            _lastDiagMs = now;
            diag(String.format("CarInfo: hız=%d devir=%d yakıt=%.0f soğutma=%.0f vites=%d kapı=%d acc=%d elFreni=%d far=%d",
                mInstantanSpeed, mEngineSpeed, mOilSurplus, coolant, mGear, mDoorOpen, mAccStatus, mHandbrake,
                (mHighbeam > 0 || mDippedheadlight > 0) ? 1 : 0));
        }

        synchronized (this) { _lastBase = out; }
        emitMerged();
    }

    // GEÇİCİ TEŞHİS: ham CAN frame sayacı + hex log (her ~800ms, ilk 24 byte)
    private long _lastRawFrameLogMs = 0;
    private int  _rawFrameCount = 0;
    private void logRawFrame(byte[] frame) {
        _rawFrameCount++;
        long now = android.os.SystemClock.elapsedRealtime();
        if (now - _lastRawFrameLogMs < 800L) return;
        _lastRawFrameLogMs = now;
        int len = (frame == null) ? -1 : frame.length;
        StringBuilder hex = new StringBuilder();
        if (frame != null) {
            int n = Math.min(frame.length, 24);
            for (int i = 0; i < n; i++) hex.append(String.format("%02X ", frame[i]));
            if (frame.length > 24) hex.append("…");
        }
        diag("HAM CAN frame #" + _rawFrameCount + " len=" + len + " hex=[" + hex.toString().trim() + "]");
    }

    private long _lastDiagMs = 0;
    private long _lastCbLogMs = 0;
    /** Son SDK geri çağrısı (elapsedRealtime, 0 = hiç) — değer değişmese de güncellenir. */
    private volatile long _lastCallbackAt = 0;

    /** Son SDK geri çağrısının yaşı (ms); hiç gelmediyse -1. */
    public long lastCallbackAgeMs() {
        long t = _lastCallbackAt;
        return t == 0 ? -1 : android.os.SystemClock.elapsedRealtime() - t;
    }

    private void diag(String msg) {
        Log.d(TAG, msg);
        DiagListener cb = _diag;
        if (cb != null) cb.onDiag(msg);
    }
}
