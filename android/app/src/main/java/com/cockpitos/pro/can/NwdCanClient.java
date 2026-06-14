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

    // Transaction kodları (decompile, deklarasyon sırası)
    private static final int TX_INIT_SDK_CFG          = 2;   // initSdkCfg(String,String,byte,String)
    private static final int TX_ADD_CAN_CARINFO_CB    = 27;  // addCanCarInfoCallBack(ICanRemoteModelCallback)
    private static final int TX_ON_DISTRIBUTE_CARINFO = 2;   // callback: onDistributeCarInfo(CarInfo)

    // Üçüncü-taraf erişim kimliği (servis doğruluyor → initSucess)
    private static final String APP_NAME    = "nwdthirdapp";
    private static final String APP_SECRETS = "d39df3d908cf7136227987e37d5b2c7d";
    private static final byte   APP_PARAM_JOIN = 0;
    private static final String APP_DESC    = "CarOS Pro";

    // Sanity sınırları
    private static final float SPEED_MAX = 300f, RPM_MAX = 12_000f;
    private static final float TEMP_MIN = -40f, TEMP_MAX = 200f;

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
            if (code == INTERFACE_TRANSACTION) {
                if (reply != null) reply.writeString(DESC_CALLBACK);
                return true;
            }
            if (code == TX_ON_DISTRIBUTE_CARINFO) {
                try {
                    data.enforceInterface(DESC_CALLBACK);
                    int present = data.readInt();          // AIDL parcelable null-flag
                    if (present != 0) parseCarInfo(data);
                } catch (Throwable t) {
                    diag("onDistributeCarInfo parse hatası: " + t.getMessage());
                }
                if (reply != null) reply.writeNoException();
                return true;
            }
            return super.onTransact(code, data, reply, flags);
        }
    };

    private final ServiceConnection _conn = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder service) {
            _feature = service;
            diag("CanService bağlandı: " + name.flattenToShortString());
            if (initSdkCfg() && registerCarInfoCallback()) {
                diag("NWD CAN SDK init+callback OK — CarInfo akışı bekleniyor");
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

    private boolean registerCarInfoCallback() {
        IBinder f = _feature;
        if (f == null) return false;
        Parcel data  = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(DESC_FEATURE);
            data.writeStrongBinder(_callback);
            f.transact(TX_ADD_CAN_CARINFO_CB, data, reply, 0);
            reply.readException();
            diag("addCanCarInfoCallBack kaydedildi (kod 27)");
            return true;
        } catch (Throwable t) {
            diag("addCanCarInfoCallBack hatası: " + t.getMessage());
            return false;
        } finally {
            reply.recycle();
            data.recycle();
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
        p.readString();                                           // mstrOuttemp
        p.readString();                                           // mstrWaterTemp
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
        if (!Float.isNaN(coolant)) b.coolantTemp(coolant);
        if (mBatteryVoltage > 0 && mBatteryVoltage < 32) b.batteryVolt(mBatteryVoltage);
        b.gearPos(mGear);
        b.doorOpen(mDoorOpen != 0);
        b.parkingBrake(mHandbrake != 0);
        b.seatbelt(mSafetyBelt != 0);
        b.headlights(mHighbeam != 0 || mDippedheadlight != 0);
        b.wipers(mRainWipwerLevel > 0);
        b.stabilityControl(mEspStatus != 0);
        b.abs(mABSIndicator != 0);
        b.tpms(new float[]{ tpmsLF, tpmsRF, tpmsLB, tpmsRB });

        VehicleCanData out = b.build();
        DecodedListener cb = _listener;
        if (cb != null && _started) cb.onData(out);
    }

    private void diag(String msg) {
        Log.d(TAG, msg);
        DiagListener cb = _diag;
        if (cb != null) cb.onDiag(msg);
    }
}
