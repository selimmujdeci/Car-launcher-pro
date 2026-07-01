# OBD Motor Telemetry Entegrasyon Planı

> Amaç: CAN'de gelmeyen motor verilerini OBD'den alıp **Safety Assistant** ve UI'a
> akıtmak (RPM, control module voltage, hararet, motor yükü, yakıt, DTC, yağ uyarısı).
> Bu doküman **plan**dır (kod yok). Kaynaklar kod tabanından doğrulandı.
> Kurallar: CAN parser DEĞİŞMEZ, SafetyRuleEngine DEĞİŞMEZ.

---

## 1. Mevcut OBD Akışı (kod tabanından)

```
ELM327 (BT classic / BLE GATT)
   │  ElmCommandChannel.send("010C"…)
   ▼
ElmProtocol.java  ── readPID_speed(010D) · readPID_rpm(010C) · readPID_temp(0105)
   │                 readPID_fuel(012F) · readDTCs(Mode 03) · clearDTCs(04)
   ▼
OBDManager.java / BleObdManager.java  (poll döngüsü; pidList'e göre)
   │  plugin event → JS
   ▼
obdService.ts  ── onOBDData / _merge  →  OBDData (zengin: rpm, engineTemp,
   │                                      fuelLevel, throttle, batteryVoltage?…)
   ├──────────────▶ OBD store (useOBDState / useOBDField)  →  UI gauge'ları ✅
   │                 (son commit: RPM/ısı/yakıt UI'da gösteriliyor)
   │
   └──────────────▶ ObdAdapter (vehicleDataLayer)
                       │  ⚠️ YALNIZ speed / fuel / rpm / reverse map'ler
                       │  ⚠️ engineTemp, batteryVoltage DROP edilir
                       ▼
                 VehicleSignalResolver → VehicleCompute.worker → SAB
                       ▼
                 UnifiedVehicleStore  (speed, rpm, fuel, odometer)
                       │
                       │  canCoolantTemp / canBatteryVolt  ◀── updateCanExtras
                       │                                       (CAN-only; OBD DEĞİL)
                       ▼
                 SafetyStateMapper → SafetyRuleEngine
```

**KÖK BULGU:** OBD `engineTemp` (0105) ve `batteryVoltage` (0142) **native'de okunur/okunabilir
ama `ObdAdapter` bunları araç katmanına geçirmez** → Safety'nin okuduğu `canCoolantTemp` /
`canBatteryVolt` yalnız CAN'den beslenir. K24'te CAN bu alanları `-1/0` veriyor (HANDOFF) →
**hararet ve voltaj güvenlik kuralları gerçek araçta sönük.** RPM ise SAB üzerinden store'a
ulaşıyor (ama Safety'de RPM kuralı yok — RPM UI içindir).

---

## 2. Hangi PID zaten okunuyor? (`obdPidConfig.ts` + `ElmProtocol.java`)

| PID | Anlam | Native reader | pidList'te mi? |
|-----|-------|---------------|----------------|
| `010D` | Hız | `readPID_speed` | ✅ UNIVERSAL |
| `010C` | RPM | `readPID_rpm` | ✅ ICE |
| `0105` | Hararet (ECT) | `readPID_temp` | ✅ ICE |
| `0111` | Gaz kelebeği | (OBDData.throttle) | ✅ ICE |
| `010F` | Emme havası (IAT) | (OBDData.intakeTemp) | ✅ ICE |
| `010B` | Manifold basınç (boost) | — | ✅ DIESEL |
| `Mode 03` | DTC oku | `readDTCs` | ⚠️ var ama **periyodik poll'da DEĞİL** (on-demand) |
| `Mode 04` | DTC sil | `clearDTCs` | (manuel) |

## 3. Hangi PID eksik?

| PID | Anlam | Durum |
|-----|-------|-------|
| `0142` | **Control module voltage** | ❌ Okunmuyor (OBDData.batteryVoltage alanı VAR ama beslenmiyor) |
| `0104` | **Motor yükü** (engine load) | ❌ Okunmuyor |
| `012F` | Yakıt seviyesi | ⚠️ Native reader VAR ama pidList'ten ÇIKARILDI (Fiat/PSA/Renault NO-DATA + 200ms gecikme) |
| `0101` | **MIL durumu + DTC sayısı** | ❌ Okunmuyor (ucuz "arıza var mı" sinyali) |
| `015C` | Motor yağ sıcaklığı | ❌ Okunmuyor (yağ *basıncı* değil) |
| `Mode 03` periyodik | DTC tarama | ❌ Poll döngüsünde yok |

---

## 4. Standart PID Tablosu (SAE J1979 Mode 01/03)

| Sinyal | PID / Mode | Formül | Safety hedefi |
|--------|-----------|--------|---------------|
| RPM | `01 0C` | `((A*256)+B)/4` | (UI; Safety'de kural yok) |
| Coolant | `01 05` | `A-40` °C | `engine.overheat` |
| Fuel | `01 2F` | `A*100/255` % | `low_fuel` |
| **Control module voltage** | `01 42` | `((A*256)+B)/1000` V | `battery_or_oil.warning` |
| **Engine load** | `01 04` | `A*100/255` % | (UI / gelecek termal) |
| **MIL + DTC sayısı** | `01 01` | `A bit7`=MIL, `A&0x7F`=DTC sayısı | `battery_or_oil.warning` (genel arıza) |
| DTC kodları | `Mode 03` | P/B/C/U decode (mevcut `parseDtcResponse`) | yağ/genel arıza fallback |
| DTC sil | `Mode 04` | `44` onayı | (kullanıcı aksiyonu) |

---

## 5. Yağ Verisi Stratejisi (öncelik sırası)

OBD'de **yağ basıncı için evrensel standart Mode 01 PID YOKTUR** (yağ lambası genelde
basınç switch'i — OBD'ye çıkmaz). Üç katmanlı fallback:

1. **Standart PID yok** → `015C` yalnız yağ *sıcaklığı* (basınç/uyarı değil). Düşük öncelik.
2. **DTC fallback (BİRİNCİL yol):** `Mode 03` taraması → yağ-ilişkili kodlar `oilWarning=true`:
   - `P0520`–`P0523` (yağ basınç sensör/switch devresi), `P0524` (yağ basıncı çok düşük),
     `P0White…` üretici varyantları. Eşleşme → `oilWarning=true` (latched).
3. **Genel arıza (MIL):** `0101` MIL=on VEYA DTC sayısı>0 → `battery_or_oil.warning`
   genel "araçta arıza göstergesi var" (yağa özel değil ama güvenli kapsayıcı).
4. **Üretici özel PID** (gerekirse): `Mode 22` (manufacturer-specific) → PID tablosunda
   `mode: '22', manufacturer: true, requiresProfile: true` ile **işaretlenir**; yalnız
   handshake profili o aracı tanıyıp PID'i doğruladığında etkinleşir (yanlış-veri önlemi).
   MVP'de KAPSAM DIŞI.

---

## 6. SafetyVehicleState'e Akış (entegrasyon noktası)

Hedef store alanları (SafetyStateMapper bunları okur):
`coolantTemp ← canCoolantTemp`, `batteryVolt ← canBatteryVolt`, `fuel ← fuel`, `oilWarning ← (yok)`.

**İki entegrasyon seçeneği:**

**Seçenek A — Ayrı OBD store alanları + mapper CAN-first fallback (ÖNERİLEN):**
- `UnifiedVehicleStore`'a yeni alanlar: `obdCoolantTemp`, `obdBatteryVolt`, `obdEngineLoad`,
  `obdOilWarning`, `obdMil` (OBD kaynaklı; CAN'den ayrı).
- `ObdAdapter` (veya yeni `updateObdExtras`): `obd.engineTemp→obdCoolantTemp`,
  `obd.batteryVoltage→obdBatteryVolt`, DTC tarama→`obdOilWarning`/`obdMil`.
- `SafetyStateMapper`: `coolantTemp = canCoolantTemp ?? obdCoolantTemp`,
  `batteryVolt = canBatteryVolt ?? obdBatteryVolt`, `oilWarning = can* ?? obdOilWarning`.
- Avantaj: CAN/OBD ayrışık (reset-safe), kaynak öncelik mapper'da açık, füzyon worker'a dokunmaz.

**Seçenek B — OBD değerlerini canCoolantTemp/canBatteryVolt'a yaz (guard'lı):**
- Tek alan; OBD yazımı "CAN taze ise üzerine yazma" guard'ı ister. Daha kırılgan. ÖNERİLMEZ.

> Not: Mapper değişikliği bu görevde İZİNLİ (yalnız CAN parser + SafetyRuleEngine kilitli).
> RPM Safety'de kullanılmaz; OBD RPM yalnız UI/store içindir (mevcut yol korunur).

---

## 7. OBD ↔ CAN Çakışma Önceliği

| Sinyal | Öncelik | Gerekçe |
|--------|---------|---------|
| Hız | (mevcut) OBD→GPS füzyonu korunur | worker zaten yönetiyor |
| RPM | CAN > OBD (varsa) | CAN daha hızlı; ama K24'te CAN yok → OBD fiilen tek kaynak |
| **Coolant / Voltage / Fuel** | **CAN varsa CAN, yoksa OBD** (`canX ?? obdX`) | CAN direkt/taze; OBD polled fallback |
| oilWarning / MIL | OBD (CAN bu kodları vermez) | yalnız OBD DTC kaynaklı |

Genel kural: **CAN birincil, OBD fallback** (numerik alanlarda `?? ` zinciri). Çift kaynak
aynı anda gelirse CAN kazanır (daha düşük gecikme). K24 gerçeğinde CAN bu alanları vermediği
için OBD devreye girer.

---

## 8. Stale Süreleri

| Sinyal | Önerilen stale | Not |
|--------|----------------|-----|
| coolant (OBD) | **10 s** | Engine'de `STALE_COOLANT=10000` ZATEN var → OBD poll (~1-3s) ile uyumlu ✅ |
| batteryVolt (OBD) | engine `STALE_GENERAL=2 s` | ⚠️ OBD poll yavaşsa dar kalır. SafetyRuleEngine KİLİTLİ → değiştirilemez. Çözüm: mapper OBD batteryVolt için `updatedAt` YAZMASIN → "taze" sayılır, yokluk `null` ile yönetilir (reset-safe). |
| RPM (OBD) | — | Safety'de kural yok; UI throttle yeterli |
| oilWarning / MIL | latched, stale yok | Arıza sticky; bağlantı kopunca (disconnect) `undefined`'a reset |
| DTC tarama | 30–60 s periyot | Mode 03 pahalı (ISO-TP çok-çerçeve); yavaş tarama yeterli |

---

## 9. İlk Uygulanacak MVP

| # | İş | Dosyalar (tahmini) |
|---|----|--------------------|
| 1 | **PID 0142 (voltage) oku** | `ElmProtocol.java` `readPID_voltage`, `obdPidConfig.ts` (+0x42), `OBDData.batteryVoltage` besle |
| 2 | **OBD coolant + voltage → store köprüsü** | `ObdAdapter.ts` (engineTemp/voltage map), `UnifiedVehicleStore` (`obdCoolantTemp`/`obdBatteryVolt`), `SafetyStateMapper` (`canX ?? obdX`) |
| 3 | **coolantTemp Safety'ye akar** | (2 ile gelir) → `engine.overheat` gerçek veriyle çalışır |
| 4 | **DTC warning (periyodik)** | `0101` MIL + opsiyonel `Mode 03` yağ kodları → `obdOilWarning`/`obdMil` → `battery_or_oil.warning` |

RPM zaten store'da (UI). MVP odağı: **hararet + voltaj + DTC** Safety'ye bağlamak.

---

## 10. Riskler

- **ELM327 NO-DATA gecikmesi:** her desteklenmeyen PID +200ms/cycle. 0142/0104 bazı araçlarda
  yok → poll yavaşlar/RFCOMM bozulur (0x2F'in çıkarılma nedeni). **Önlem:** handshake
  `supportedPids`'e göre PID listesi filtrele (mevcut `parseSupportedPIDs` altyapısı var).
- **batteryVolt 2s stale darlığı** (engine kilitli) → mapper `updatedAt` yazmama stratejisi şart.
- **DTC parse karmaşıklığı:** `parseDtcResponse` CAN/K-line/ISO-TP varyantlarını ele alıyor;
  yağ kodu eşleme tablosu üretici-bağımlı → ilk sürüm sadece MIL (0101) ile genel arıza, yağ
  kodları faz 2.
- **OBD-CAN çift kaynak titremesi:** `canX ?? obdX` ani kaynak değişiminde değer sıçraması →
  ProfileSignalGate spike guard yalnız CAN tarafında; OBD tarafına da aralık kontrolü gerekir.
- **K24 bağlantı kararsızlığı:** HANDOFF — BT OEM-kilitli, OBD-BT imkânsız olabilir; OBD telemetri
  ancak WiFi ELM327 / TCP transport ile gelir (ayrı açık iş). Plan kod-hazır olur ama saha
  doğrulaması bu transport'a bağlı.
- **Mock/prod ayrımı:** yeni PID'ler `MOCK_ENABLED` yolunda da makul değer üretmeli (test).

---

## 11. Commit Önerileri (atomik sıra)

1. `feat(obd): read control module voltage (PID 0142)` — native reader + pidList + OBDData besleme + parse testi.
2. `feat(obd): read engine load (PID 0104)` — (opsiyonel, UI/termal) native + OBDData.
3. `feat(obd): bridge OBD coolant/voltage to vehicle store` — `ObdAdapter` + `UnifiedVehicleStore` obd-alanları + birim test (drop edilen alanlar artık akıyor).
4. `feat(safety): consume OBD coolant/voltage in mapper (CAN-first fallback)` — `SafetyStateMapper` `canX ?? obdX` + uçtan uca test (CAN yok + OBD var → overheat/battery alert).
5. `feat(obd): periodic MIL/DTC scan → fault signal` — `0101` + periyodik tarama + `obdOilWarning/obdMil` + `battery_or_oil.warning` testi.
6. `feat(obd): supported-PID gating to avoid NO-DATA stalls` — handshake supportedPids ile pidList filtreleme.

Her commit: `npm run test` + `npm run guard` + `npm run build` yeşil; CAN parser ve
SafetyRuleEngine'e dokunmadan.
```
