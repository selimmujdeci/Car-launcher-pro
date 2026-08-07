# DEVİR NOTU — 2026-08-05 · Saha eksik kapatma turu + K24 head unit BT/OBD kazısı

> **Kime:** bu işi devralacak sonraki oturuma.
> **Branch:** `feat/fleet-offline-final-local-completion` · **HİÇBİR ŞEY COMMİT EDİLMEDİ.**
> Oturum iki ayrı işi kapsadı: (A) saha eksiklerinin kod tarafı kapatılması, (B) head
> unit'te Bluetooth/OBD'nin neden çalışmadığının canlı cihazda kazılması.

---

## A) SAHA EKSİK KAPATMA TURU — TAMAMLANDI

**Kaynak:** `docs/NAV_FIELD_GAPS_2026-08-05.md` (Konya→Tarsus, 399 örnek/420 s gerçek sürüş)
**Sonuç:** 17 madde kapatıldı → kütük **#432–#448**, vizyon belgesi güncellendi.
**Doğrulama:** iki ardışık tam koşu **477 dosya / 10 831 test YEŞİL**, `tsc -b` temiz.

Kapatılanlar özet: #399 (0xFF→255 km/h) · #417 (tek hız otoritesi) · #427 (akü CAN→OBD) ·
#420 (sahte "bakımlar güncel") · #382/#431 (sahte ETA şeridi) · #401/#406/#423 (GPS alım
sağlığı ölçülebilir) · #402 (karar↔aksiyon aynı eşik) · #429 (hedef sahipliği kapısı) ·
#416/#418 (`isGuidanceActive`) · #403/#404 (ETA tek otorite + mesafe kaynağı) ·
#405/#408 (yön güveni, sahte 0 kalktı) · #407/#413 (doğrulama sebebi + doğruluk kaynağı) ·
#411 (cihaz türü ≠ performans sınıfı) · #412-d/#425 (OEM token) · #421 (402≠401) ·
#422 (şema hatası devre kesici) · #400 (CAN snapshot native yazımı).

**Bilinçli YAPILMAYANLAR** (kütükte açık): #412-a/b/c · #419 · #426 · #430 (ekran görüntüsü
gerektiren yerleşim kusurları) · #410 (offline routing) · #409 (şerit/trafik — veri boşluğu) ·
#414 · #424 · #401'in KÖK NEDENİ (yalnız ölçülebilir yapıldı).

**Not:** `labTruthAuthorities.test.ts` tam suite paralel koşuda nadiren düşüyor (izole ve
ikinci koşuda geçiyor) — ürün koduyla ilgisi yok, iki kez gözlendi.

---

## B) K24 HEAD UNIT — BLUETOOTH/OBD KAZISI (YARIM KALDI)

### Cihaz künyesi
| Alan | Değer |
|------|-------|
| IP / ADB | `10.189.61.75:5555` — **`persist.adb.tcp.port=5555` ayarlandı, reboot'ta kalıcı** |
| Model | `K2401/K2401P/k2401M` · Allwinner `ceres-b3` · `sun50iw10p1` |
| Android | **10 (SDK 29)** — ⚠️ ekranda "15" yazıyor, OEM sahte sürüm gösteriyor |
| Root | `uid=0`, `ro.secure=0`, `ro.debuggable=1`, SELinux **permissive**, `su` binary YOK |
| Serial | `3c000c6d65c0c8e1ddd` |

Cihaza bu oturumda **tam factory reset** atıldı (kullanıcı isteği, `--wipe_data`).
Ardından taze APK derlenip kuruldu ve açılışı ekran görüntüsüyle doğrulandı.

### UART haritası (ÖLÇÜLDÜ — bu cihazın gerçeği)
| Port | Sahibi |
|------|--------|
| `ttyS0` | kernel konsolu (`console=ttyS0,115200`) |
| **`ttyS1`** | **OEM Bluetooth** — `service gocsdk_8800 /system/bin/gocsdk_8800 /dev/ttyS1 1500000` |
| `ttyS2` | `kernel.setting` |
| `ttyS3` | GNSS/GPS HAL |
| `ttyS4` | `nwd.can.setting` ← **CAN burada** |
| `ttyS8` | **YOK** — ama `persist.vendor.bluetooth_port` onu gösteriyor (hayalet) |

### Kesinleşen teşhisler (canlı log kanıtıyla)

1. **BT'yi kapatan:** `gocsdk_8800` (CarPlay/ZLink native daemon, log etiketi `nwdbt`).
   Init edemeyince watchdog süreci öldürüyor, yeniden başlarken **`svc bluetooth disable`**
   çağırıyor → 13 saniyelik açılıp-kapanma döngüsü. Durdurunca `bluetooth_on` 1'de kaldı.
   ⚠️ Haziranda `pm disable-user com.zjinnova.zlink` denenmişti ve işe yaramamıştı —
   çünkü suçlu APK değil, **native init servisi**.

2. **Android BT yığını bu ROM'da ölü:** `AdapterState` tek kayıt (`BLE_TURN_ON`) alıp
   `TurningBleOnState`'de donuyor; `/sys/class/bluetooth/` boş (hci0 hiç doğmuyor);
   HAL kayıt oluyor ama `BluetoothHci::initialize()` **hiç çağrılmıyor**.
   `svc bluetooth enable` / `settings put` state machine'i tetiklemiyor.
   `am start -a android.bluetooth.adapter.action.REQUEST_ENABLE` "Turning Bluetooth on…"
   gösterdi (akış bir kez tetiklendi) ama HCI yine doğmadı.

3. **`libbt-vendor.so` ROM'da YOK.** HAL impl'inden okundu: `dlopen("libbt-vendor.so")` +
   `BLUETOOTH_VENDOR_LIB_INTERFACE`. Cihazda yalnız `libbt-broadcom/realtek/sprd/xradio.so`
   var. Dördü de sırayla `libbt-vendor.so` olarak symlink'lenip denendi → **hiçbiri HCI
   doğurmadı** ve `vendor library` logu hiç çıkmadı ⇒ sorun kütüphane seçiminde değil,
   framework'ün HAL'ı hiç çağırmamasında. **Symlink en son SİLİNDİ (ROM orijinal hâlde).**

4. **🔴 EN DEĞERLİ BULGU — kendi uygulamamız BT'yi bozuyor:**
   ```
   CarOS Pro KAPALI:  ttyS1 → gocsdk_8800
   CarOS Pro AÇIK:    ttyS1 → m.cockpitos.pro + gocsdk_8800   ← ÇAKIŞMA
   ```
   Uygulama CAN portu ararken `/dev/ttyS0..ttyS4` listesini tarayıp **BT'nin UART'ını
   açıyor**. İki okuyucu HCI çerçevelerini bölünce OEM daemon'ı `Cur BT Init Failed`
   verip kendini öldürüyor. Launcher olarak boot'ta önce açıldığımız için head unit'in
   Bluetooth'u hiç ayağa kalkamıyor olabilir. **Kullanıcının "OBD'yi bulamıyor"
   şikâyetinin en güçlü adayı bu.**

### Yapılan kod değişikliği (COMMİT EDİLMEDİ, İŞ YARIM)
- `SerialPortHandler.java`: `isPortOwnedBySystem()` eklendi — iki kanıt kullanır:
  (a) `/proc/cmdline` içindeki `console=<port>`, (b) init.rc dosyalarındaki
  `service <ad> <binary> /dev/ttyX` satırı. Sonuç `_ownedCache`'te tutulur.
  İlk sürüm `/proc/<pid>/fd` taramasıyla yazılmıştı — **çalışmadı** (normal uygulama
  başka sürecin fd'lerini okuyamaz), init.rc kanıtına çevrildi.
- `HiworldAdapter.java`: iki port tarama döngüsüne aynı kapı eklendi.

### ⛔ NEREDE KALDIM — İLK İŞ BU
Koruma eklendi, APK derlendi ve kuruldu **ama `ttyS1` hâlâ uygulamamızda** ve
`Port ATLANDI` logu hiç çıkmıyor ⇒ **portu açan yer `SerialPortHandler`/`HiworldAdapter`
DEĞİL.** Süreç thread'leri: `CanBusReader`, **`K24CanPoller`**, `McuEventSniffer`,
`SerialFillThrea`. Log ipucu: `K24CanBridge: SerialManager getSerialPorts → boş`.

**Sıradaki adım:** `android/app/src/main/java/com/cockpitos/pro/can/K24CanBridge.java`
(ve gerekiyorsa `NwdCanClient.java`, `CanBusManager.java`) içindeki port açma yolunu bul,
aynı `SerialPortHandler.isPortOwnedBySystem(port)` kapısından geçir. Doğrulama komutu:
```bash
adb -s 10.189.61.75:5555 shell "for pid in \$(ls /proc | grep -E '^[0-9]+\$'); do \
  ls -l /proc/\$pid/fd 2>/dev/null | grep -q 'ttyS1\$' && cat /proc/\$pid/comm; done"
# Beklenen: yalnız gocsdk_8800 — cockpitos GÖRÜNMEMELİ
```
Sonra `am force-stop`/başlat döngüsüyle `nwdbt: Cur BT Init Failed` sayısının **0**
kaldığını ve BT'nin ayakta kaldığını ölç.

### Cihazda bırakılan durum (geri alınması gerekenler)
| Değişiklik | Durum | Not |
|---|---|---|
| `persist.adb.tcp.port=5555` | **bırakıldı** | kasıtlı — ADB reboot'ta kalıcı olsun |
| `development_settings_enabled=1`, `adb_enabled=1`, `stay_on_while_plugged_in=7` | bırakıldı | geliştirme kolaylığı |
| `libbt-vendor.so` symlink | **SİLİNDİ** | ROM orijinal hâlinde |
| `gocsdk_8800` | **çalışıyor** | OEM BT geri açıldı |
| `persist.sys.bt.xr829` | `false` (orijinal) | bir ara `true` yapıldı, geri döndü |
| `rfkill0` unblock, `nPOEN` toggle | runtime | reboot'ta sıfırlanır |
| `/vendor` remount rw | reboot'ta ro'ya döner | `/vendor` **%100 dolu** (412K boş) |

### OBD için gerçek seçenekler (öncelik sırası)
1. **`ttyS1` çakışmasını bitir** (yukarıdaki yarım iş) → OEM BT sağlıklı ayağa kalkarsa
   Android tarafının da düzelip düzelmediğini YENİDEN ölç. En ucuz ve en olası yol.
2. **WiFi ELM327 + TCP transport** — uygulamada **HAZIR** (`ObdTransport = 'classic'|'ble'|'tcp'`,
   `obdStorage.isValidTcpAddress`, `ip:port`). Donanım alınırsa bugün çalışır, BT'ye hiç
   ihtiyaç yok. **En kesin sonuç veren yol.**
3. **USB ELM327** — `/proc/devices`'te `188 ttyUSB` var ama `usb-serial/drivers/` yalnız
   `option1`; CH340/CP210x/FTDI sürücüsü YOK. Uygulamaya USB-serial transport + sürücü
   riski. Araştırılmadı.
4. **OEM BT API'si** (`com.bt.bc03` / `libzbt` / `/dev/zj_bt_serial`, `/dev/ble_serial`,
   `/dev/goc_serial` pty'leri). Kullanıcı "Tool Box'tan OBD'ye bir kez bağlandım" diyor —
   yani bu kapıdan geçen çalışan bir yol var. Tool Box paketi kesin tespit edilmedi
   (`com.nwd.vodka.factory` / `com.nwd.kernel` adayları). **Araştırılmadı.**

### Kullanıcı bağlamı
- Cihaz ve iş kullanıcıya ait; formatlama/root/sistem değişikliği için **açık izin verdi**
  ("cihaz benim, ne istersen yap").
- Kullanıcı olumsuz/pes eden ton istemiyor. Bulguları çözüm odaklı ver, ama **kanıtsız
  "oldu" deme** — bu turda "BT imkânsız" dedim, kullanıcının Tool Box bilgisi onu çürüttü;
  ders: cihaz sahibinin saha gözlemi, kod/analiz çıkarımından önce gelir.

### Build ortamı (önemli)
- **`JAVA_HOME` Java 21 olmalı** — sistemde `temurin17` ayarlı ve `apk:safe` testleri +
  web build'i (~4 dk) koşup son adımda düşüyor. Doğrusu:
  `C:\Program Files\Android\Android Studio\jbr` (21.0.10).
- **APK yolu:** `C:\Temp\carlauncher\app\build\outputs\apk\debug\app-debug.apk`
  (`gradle-build.mjs` build dizinini oraya taşıyor — proje ağacında değil).
- `npm run apk:safe | tail -N` **kullanma** — boru hattı exit kodunu maskeler.
- Git Bash'te adb yolları için **`export MSYS_NO_PATHCONV=1`** şart, ama Windows dosya
  yolları (`C:/Temp/...`) o modda da doğrudan yazılmalı.
