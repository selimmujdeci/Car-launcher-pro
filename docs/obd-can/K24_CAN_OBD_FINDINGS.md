# K24 / NWD CAN-OBD Saha Teşhisi ve Entegrasyon Spesifikasyonu

> Tarih: 2026-06-14 · Cihaz: K2401 (ceres_b3), NWD ROM `K2401_NWD_S212802.20250214.180507`
> Ortam: ADB ağ üzerinden `10.185.22.216:5555` · Araç içinde, kontak açık (ACC), motor kapalı, CAN bağlı.

## 1. Sorun: OBD/araç verisi neden gelmiyor?

CarOS Pro'daki `K24CanBridge` + `McuEventSniffer` **kör probe** mantığıyla çalışıyor: content
provider, system property, ServiceManager binder, /dev dosyaları ve broadcast'leri tek tek
deniyor. Cihazda hepsi tek tek test edildi ve **hiçbiri araç verisi vermiyor:**

| Kanal | Sonuç |
|-------|-------|
| Eşli Bluetooth / ELM327 | OBD dongle yok (eşli cihaz "BC8-Android" = telefon). Bu ünite OBD'yi BT'den okumaz. |
| `com.nwd.mycar.provider` | **exported=false** + sadece `androidx...FileProvider` → kalıcı SecurityException, veri yok |
| `nwdaudio` binder | `INwdAudioService` (ses), araç verisi yok |
| `nwdmanager` binder | Activity manager, `MANAGE_ACTIVITY_STACKS` ister |
| `serial` (UART) | `getSerialPorts → boş` — MCU UART portu app'e kapalı |
| system property | Canlı hız/devir/vites yok (sadece nwd config) |
| MCU broadcast | Tüm tur boyunca tek event düşmedi |
| `CanService` kör transact | Bind oldu ama descriptor boş, kör transact veri döndürmedi |

**Kök neden:** Bu ROM'da araç verisi, OEM'in **`com.nwd.can.service.CanService`** servisinin
**özel/gizli AIDL arayüzü** üzerinden dağıtılır. Kör binder transact ile okunamaz; doğru AIDL
arayüzü + metod sırası + callback şart.

## 2. Çözüm: NWD resmi DIŞ (outer) CAN SDK'sı APK içinde gömülü

`CanAllInOne.apk` (= `com.nwd.can.setting`, yol: `/data/nwdappconfig/app/.app/CanAllInOne.apk`)
decompile edildi. İçinde üçüncü-taraf uygulamalar için tasarlanmış **resmi SDK** var:
`com.nwd.can.sdk.outer.*`. Kör probe'a gerek yok — desteklenen API mevcut.

### Bind bilgileri
- **Servis:** `com.nwd.can.setting / com.nwd.can.service.CanService` (exported=true)
- **Bind action:** `com.nwd.can.service.ACTION_CAN_SERVICE`
  (alternatif: `com.nwd.can.service.impl.carcase.ACTION_CAN_SERVICE`)
- **Paket:** `com.nwd.can.setting`

### ⚠️ ERİŞİM KİMLİĞİ (gate) — DOĞRULANDI
Servis tarafı `CanRemote4AppFeature.initSdkCfg` çağrıyı doğruluyor (`initSucess`
bayrağı). Hardcoded kimlikler decompile'dan çıkarıldı — **üçüncü-taraf yolu var:**
- **appName** = `"nwdthirdapp"`  ·  **appSecrets** = `"d39df3d908cf7136227987e37d5b2c7d"`  ·  **appParamJoin** = `0`
- (OEM kendi uygulamaları: `"nwdapp"` / `"d6049e9ae396480cbd8358ed3d07df21"` / 0)
- `nwdthirdapp` = "NWD third-party app" → resmî desteklenen yol. `initSdkCfg(appName, appSecrets, (byte)0, appDesc)` çağrılmalı; appDesc serbest.
- Üst-seviye helper: `CanAppRemoteManager(Context, CanSdkCfg)` → `CanSdkCfg(appName, appSecrets, appDesc, (byte)appParamJoin)`. Bind/connect `AbsServiceControllerHelper` ile.

```java
Intent it = new Intent("com.nwd.can.service.ACTION_CAN_SERVICE");
it.setPackage("com.nwd.can.setting");
bindService(it, conn, BIND_AUTO_CREATE);
// onServiceConnected: ICanRemote4OuterFeature.Stub.asInterface(binder)
```

### AIDL arayüzü
**`com.nwd.can.sdk.outer.adil.ICanRemote4OuterFeature`** (descriptor birebir bu string olmalı).
İlgili metodlar (tam liste decompile çıktısında):
- `initSdkCfg(String, String, byte, String)` — **önce çağrılmalı** (SDK init)
- `addCanCarInfoCallBack(ICanRemoteModelCallback)` — araç bilgisi (hız/devir/yakıt...)
- `addCarInfoCallBack(...)`, `addCanDataCallBack(...)` (ham CAN [B]),
  `addDoorCallBack`, `addRadarCallBack`, `addTpmsInfoCallBack`, `addSWCAngleCallBack`
- `addCallBack4Outerface(ICanRemote4OuterCallback)` — ham/işlenmemiş veri
- `removeXxxCallBack(...)` (cleanup), `sendCanData([B])` (YAZMA — kullanılmayacak, read-only)

### Callback arayüzleri
**`com.nwd.can.sdk.outer.adil.ICanRemoteModelCallback`:**
- `onDistributeCarInfo(com.nwd.can.sdk.data.CarInfo)` ← **ana telemetri callback'i**
- `onDistributeTpmsInfo(TPMSInfo)`, `onDistributeCanData([B])`, `onDistributeAmpState(AmpState)`

**`ICanRemote4OuterCallback`:** `onDistributeCanData([B])`, `onDistributeRawData([B])`

### Veri modeli: `com.nwd.can.sdk.data.CarInfo` (Parcelable)
CarOS için kritik alanlar:
| Alan | Tip | Anlam |
|------|-----|-------|
| `mInstantanSpeed` | int | Anlık hız |
| `mEngineSpeed` | int | Motor devri (RPM) |
| `mOilSurplus` | float | Yakıt kalan (%) |
| `mCoolantTemp` / `mWaterTemp` | float | Soğutma suyu sıcaklığı |
| `mInstantanOil` / `mAverageOil` | float | Anlık/ortalama tüketim |
| `mGear` | byte | Vites |
| `mHandbrake` | byte | El freni |
| `mDoorOpen` | byte | Kapı açık |
| `mAccStatus` | byte | ACC (kontak) |
| `mBatteryVoltage` | float | Akü voltajı |
| `mLeftTurnSignal`/`mRightTurnSignal` | byte | Sinyaller |
| `mDippedheadlight`/`mHighbeam`/`mSmallLamps` | byte | Farlar |
| `mDrivingMile`/`mSingleMileage`/`mTRIPAMile` | int/float | Kilometre/trip |
| `mTyrePulseData_*` (4 lastik) | float | TPMS lastik basınçları |
| EV: `mElectric`,`mChargingPower`,`mRemainingChargingTime*` | — | Elektrikli araç |

(Tam alan listesi: ~150 alan — `tools/can-re/` çıktısında.)

## 3. Uygulama planı (öneri)

1. **AIDL reimplementasyonu** (lisans-güvenli yol): `.aidl` dosyalarını birebir aynı paket/ad ile
   yaz (`ICanRemote4OuterFeature`, `ICanRemote4OuterCallback`, `ICanRemoteModelCallback`) + `CarInfo`
   ve `TPMSInfo` Parcelable'larını **birebir aynı parcel sırasıyla** yeniden yaz. Böylece NWD'nin
   derlenmiş kodu APK'ya kopyalanmaz (ticari satış için kritik — bkz. CLAUDE.md lisans kuralı).
   - Transaction kodları AIDL declaration sırasından gelir; orijinal sırayı `tools/can-re` dex
     analizinden doğrula (Proxy/Stub clinit).
   - Parcel alan sırası: `CarInfo.writeToParcel` disassembly'sinden birebir çıkarılmalı.
2. **Yeni native köprü:** `NwdCanClient.java` — bind → `initSdkCfg` → `addCanCarInfoCallBack` →
   `onDistributeCarInfo` → `VehicleCanData`'ya map → mevcut JS köprüsüne (OBD store) ilet.
3. **Eski kör probe'u emekliye ayır:** `K24CanBridge`/`McuEventSniffer` polling'ini kapat
   (CPU/ısınma kazancı); yalnızca SDK yoksa fallback olarak tut.
4. **Doğrulama (cihazda):** kontak açıkken `onDistributeCarInfo` düşüyor mu, `mAccStatus`/`mDoorOpen`
   gerçek durumla değişiyor mu (kapı aç/kapa testi).

## 4. Açık ön-koşul (kullanıcı doğrulaması gerek)
- `com.nwd.can.setting` (CAN ayarları) ekranında **araç tipi/protokolü seçili mi** ve ünitenin
  kendi ekranı canlı veri (hız/kapı) gösteriyor mu? Göstermiyorsa decoder kutusu/araç tipi sorunu
  vardır ve hiçbir entegrasyon veri üretemez. (Motor kapalı + ACC açıkken gövde-CAN sinyalleri —
  kapı/far/ACC/yakıt — yine de gelmeli.)

## 5. Artefaktlar
- `tools/can-re/CanAllInOne.apk` — çekilen OEM CAN uygulaması
- `tools/can-re/classes*.dex`, `classes_l.txt` (plain listing), `classes_d.txt` (disasm), `manifest.txt`
- Lisans notu: bu dosyalar OEM'e ait; **APK'ya gömülmez**, yalnızca arayüz reimplementasyonu için referans.
