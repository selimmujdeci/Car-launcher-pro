# PARKING_BRAKE_FIELD_TEST — El Freni Ham Değer Saha Testi

> **Amaç:** Kod yazmadan, ham CAN değeriyle el freni mapping'inin doğru/ters/encoding
> hatalı/offset kaymış olup olmadığını KANITLAMAK. Sonuç gelmeden invert/patch YOK.
> **Cihaz:** K24 / NWD (model K2401, ceres_b3). Araç içinde, kontak/ACC açık olmalı.
> Hazırlık tarihi: 2026-06-25.

---

## 0. Neden bu test (kök neden özeti)

K24'te el freni **NWD outer CAN SDK → CarInfo** Parcel'inden geliyor (ELM327/raw CAN değil):

```
NwdCanClient.parseCarInfo()
  byte mHandbrake = p.readByte()          // alan 39   NwdCanClient.java:290
  b.parkingBrake(mHandbrake != 0)         //           NwdCanClient.java:356
        → VehicleCanData → UnifiedVehicleStore.canParkingBrake
        → safetyStateMapper.ts:124 (invert YOK)
        → VehicleTellTales.tsx:52 ekran (invert YOK)
```

- Hiçbir katmanda **profil-bazlı invert YOK**.
- Ekran/mapper tarafı ham `canParkingBrake`'i aynen gösteriyor → terslik varsa
  kaynağı **decode noktası (NwdCanClient.java:356)** veya **NWD ham byte'ı**.
- `parseCarInfo` zaten 2sn throttle'lı diag log basıyor (NwdCanClient.java:368-374),
  ham `mHandbrake` ve `mDoorOpen` değerlerini `%d` olarak gösteriyor → **yeni kod
  gerekmez**, sadece logu okuyacağız.

Diag log satırı formatı (NwdCanClient.java:371):
```
CarInfo: hız=<int> devir=<int> yakıt=<f> soğutma=<f> vites=<int> kapı=<int> acc=<int> elFreni=<int> far=<int>
```
- **elFreni = mHandbrake ham byte** (int olarak).
- **kapı = mDoorOpen ham byte** (int olarak).

---

## 1. Ön koşullar

- [ ] Araç içinde, **kontak/ACC açık** (CarInfo akışı için motor/ACC gerekli).
- [ ] PC ve K24 **aynı WiFi**'de.
- [ ] K24 IP: Ayarlar → Cihaz hakkında → IP (DHCP, değişebilir). Önceki seanslarda
      `10.185.22.216` / `10.228.8.216` görüldü — **her seansda yeniden bak**.
- [ ] adb yolu: `C:\Users\selim\AppData\Local\Android\Sdk\platform-tools\adb.exe`
- [ ] **ÖNEMLİ:** OEM CanSetting'de (`com.nwd.can.setting`) doğru araç seçili olmalı,
      yoksa CarInfo boş/bayat gelir (bkz. HANDOFF açık iş #1). OEM kendi ekranında
      el freni durumu canlı değişiyor mu — önce onu teyit et.

---

## 2. Bağlanma + log akışını başlatma

```powershell
$adb = "C:\Users\selim\AppData\Local\Android\Sdk\platform-tools\adb.exe"

# IP'yi cihazdan al, sonra:
& $adb connect <K24_IP>:5555
& $adb devices -l                      # "device" görünmeli

# Logcat'i temizle ve ilgili tag'leri canlı izle:
& $adb -s <K24_IP>:5555 logcat -c
& $adb -s <K24_IP>:5555 logcat -s NwdCanClient:* K24CanBridge:* CarLauncherPlugin:* OBD:* Safety:* TTS:* AndroidRuntime:*
```

> İpucu: ham değerleri ayrı bir dosyaya da yaz:
> ```powershell
> & $adb -s <K24_IP>:5555 logcat -s NwdCanClient:* > parkbrake_test.log
> ```

---

## 3. Test adımları (sırayla, her adımda elFreni & kapı değerini not al)

| Adım | Eylem | Beklenen log alanı | Kaydet |
|------|-------|--------------------|--------|
| 1 | El freni **inik** (bırakılmış), 5sn bekle | `elFreni=` | **A = ____** |
| 2 | El freni **çekili**, 5sn bekle | `elFreni=` | **B = ____** |
| 3 | El frenini tekrar **inik** yap | `elFreni=` | (A'ya dönmeli) |
| 4 | Sürücü kapısı **kapalı**, 5sn bekle | `kapı=` | **C = ____** |
| 5 | Sürücü kapısı **açık**, 5sn bekle | `kapı=` | **D = ____** |

> Not: diag 2sn throttle'lı → her durumda en az 3-4sn bekle ki taze satır gelsin.
> Aynı anda hem el freni hem kapı denemek yerine **teker teker** değiştir
> (çapraz karışmasın).

---

## 4. KARAR TABLOSU — el freni (A=inik, B=çekili)

| A (inik) | B (çekili) | Teşhis | Aksiyon (sonraki, ayrı patch) |
|----------|-----------|--------|-------------------------------|
| `0` | `1` | **Mapping DOĞRU** | Sorun decode'da değil; tell-tale/rule tarafına bak |
| `1` | `2` | **Encoding hatası** | `mHandbrake != 0` → `mHandbrake == 2` (NwdCanClient.java:356) |
| `1` | `0` | **Gerçek invert** | Polariteyi çevir (K24 CarInfo path'ine izole) |
| A == B (değişmiyor) | | **Offset / source sorunu** | Parcel hizalaması; daha riskli, ayrı ele al |
| `0` | `2` (veya başka) | **Tri-state**, 1 ara değer atlanmış | Gerçek değerlere göre `== <çekili değeri>` |

> **Saha kuralı:** B (çekili) değeri **ne ise** "çekili" odur; A (inik) değeri
> "inik"tir. `!= 0` mevcut testi A≠0 olduğu her durumda yanlış pozitif üretir —
> semptom ("hep çekili gösteriyor") tam da A=1, B=2 ya da A=1,B=0 işaretidir.

## 4b. KARAR TABLOSU — kapı (C=kapalı, D=açık) — ÇAPRAZ DOĞRULAMA

| C (kapalı) | D (açık) | Anlamı |
|-----------|----------|--------|
| `0` | `1` (veya `2`) | Kapı offset'i **doğru** → mHandbrake offset'i de büyük ihtimalle doğru (alan 39, kapıdan önce) → terslik **encoding/polarite**, offset değil |
| C == D | | Kapı da sabit → **genel Parcel hizası kaymış / CarInfo bayat** → tüm boolean'lar şüpheli, decode'a güvenme |

> Kapı (alan 96) el freninden (alan 39) SONRA okunuyor. Kapı doğru flip ediyorsa,
> ondan önceki el freni alanının offset'i de neredeyse kesin doğrudur → terslik
> kaynağı **byte'ın anlamı (encoding/polarite)**, hiza değil.

---

## 5. Raporlanacak sonuç (bu dosyanın altına doldur)

```
TARİH:
K24 IP:
OEM CanSetting'de araç seçili/canlı mı:

El freni İNİK   → elFreni = A = ___
El freni ÇEKİLİ → elFreni = B = ___
Kapı KAPALI     → kapı    = C = ___
Kapı AÇIK       → kapı    = D = ___

KARAR (tablo §4):
KARAR (tablo §4b):
```

---

## 6. Kurallar (ZORUNLU)

- **Ham log (A & B) olmadan parkingBrake'i invert ETME.**
- CAN parser'ı rastgele çevirme; karar tablosu ne diyorsa o.
- SafetyRuleEngine / Queue / Overlay'e **dokunma** — bu bir decode değeri testi.
- Düzeltme çıkarsa: tek satır, **NwdCanClient.java:356**'ya izole; başka aracın
  yolunu (VehicleSignalMapper / SystemCanBroadcastAdapter) kırma.
- Düzeltme sonrası `canScenarios.test.ts`'e karşılık gelen regresyon kilidi ekle.
