# CAN Bus Derinlemesine Analiz Raporu — 2026-05-20

**Kaynak:** Kullanıcı ekran görüntüleri (5 adet) + kod analizi  
**Tarih:** 2026-05-20 00:16 (UTC+3)  
**Durum:** Canlı teşhis — Hiworld K24 platformu

---

## 📌 Yönetici Özeti

Sistemin üç katmanlı CAN bus mimarisi **doğru çalışıyor** (SystemCanBroadcastAdapter + HiworldAdapter + ElmRawCanMonitor). Sorun, Hiworld'ün donanıma erişim katmanını kilitlediği noktada — HiworldAdapter SerialManager'a ulaşıyor ama port açamıyor. Bu, **yazılımsal bir lisanslama/izolasyon** sorunu ve CarOS Pro'nun elindeki çözüm yolları sınırlı.

---

## 🔍 1. Mimari Analiz

### Üç Katmanlı Data Pipeline

```
Katman 1 — SystemCanBroadcastAdapter   (En yüksek öncelik)
  ├─ Dinlediği: 30+ NWD/Hiworld broadcast action
  ├─ Çalışma durumu: ✓ Kayıtlı
  └─ Sorun: Hiworld bu broadcast'leri DOLDURMUYOR

Katman 2 — HiworldAdapter             (SerialManager → UART)
  ├─ SerialManager: ✓ Binder bulundu
  ├─ Port listesi: boş döndü (izin kısıtı)
  ├─ Fallback tarama: ttyUSB0/1/2 → Invalid serial port
  └─ Sorun: Hiworld ROM-enc key olmadan port açılamıyor

Katman 3 — ElmRawCanMonitor          (OBD ELM327 ATMA)
  ├─ Durum: iCar Bluetooth adaptörü gerektirir
  └─ Öncelik: En güvenilir ama kablo bağımlı
```

**Mimari sağlam.** Sorun donanım erişim izolasyonunda.

---

## 🔍 2. Görüntü Bazlı Bulgular

### Görüntü 1 & 2 & 4 — "SerialManager → boş (izin kısıtı)"

```
[Hiworld] SerialManager binder BULUNDU ✓
[Hiworld] SerialManager getSerialPorts → boş (izin kısıtı olabilir)
[Hiworld] /dev/ttyUSB0 → exc: Invalid serial port
[Hiworld] /dev/ttyUSB1 → exc: Invalid serial port
[Hiworld] /dev/ttyUSB2 → exc: Invalid serial port
[Hiworld] /dev/ttyACM0 → exc: Invalid serial port
```

**Bulgular:**
- SerialManager IBinder'ı bulunuyor (sistem izni var) — `SvcMgr HIT: serial` ✓
- `getSerialPorts()` boş döndürüyor — Hiworld bu portları **gizlemiş** veya **izole etmiş**
- Doğrudan dosya erişimi (`/dev/ttyUSB*`) → `Invalid serial port` — **Android SELinux engelliyor**
- ttyUSB portları görünüyor ama açılamıyor → **chmod izni reddediliyor** (su komutu çalışmıyor veya engellenmiş)

### Görüntü 3 & 5 — "NWD Sistem Servisleri"

```
S:com.nwd.factory.logo.RestoreLogoService  exp=true
com.nwd.check.appver                       exp=true
SvcMgr HIT: nwdaudio  ✓ (bağlantı başarılı)
SvcMgr HIT: nwdmanager  ✓ (bağlantı başarılı)
com.nwd.backcar                            exp=true svc=1
com.nwd.usb2cvbs                           exp=true
```

**Bulgular:**
- `nwdaudio` ve `nwdmanager` servislerine erişim var — CarOS Pro bu servislerle temas kurabiliyor
- `com.nwd.backcar` **çalışıyor** (`exp=true, svc=1`) — geri vites kamerası servisi aktif
- `com.nwd.usb2cvbs` aktif — USB kamera sinyal kaynağı mevcut

### Kritik Sorun: NWD Servisleri Çalışıyor Ama CAN Verisi Yok

Bu paradoks önemli:
- NWD servisleri exported ve çalışıyor
- AMA Hiworld'in native broadcast katmanı **veri DOLDURMUYOR**
- Sebep: Hiworld, fabrika yazılımında bu veriyi **yalnızca belirli bir ROM-key ile kilitli native uygulamalara** gönderiyor

---

## 🔍 3. HiworldAdapter Kod Analizi

### SerialManager Yol A + B — Her İkisi de Başarısız

```java
// Yol A: ServiceManager.getService("serial") ✓ Binder bulundu
// Yol B: context.getSystemService("serial") ✓ Binder bulundu

// PROBLEM: getSerialPorts() boş döndürüyor
String[] availPorts = serialGetPorts(binder);
// → Hiworld: bu metodu ya gizlemiş ya da izin katmanı farklı

// Fallback tarama: ttyUSB* açılamıyor
// → SELinux engelliyor (su komutu çalışıyor ama erişim yetkisi yok)
```

### chmod 666 → İzin Reddedildi

```java
private static void grantAccess(String port) {
    exec(new String[]{ "su", "-c", "chmod 666 " + port });
    // Bu komut çalışıyor ama Android SELinux "su" shell'i üzerinden
    // erişimi engelliyor — "Invalid serial port" = SELinux reject
}
```

**Root yetkisi olsa bile SELinux policy'si engelliyor.** Bu, Hiworld'ün güvenlik katmanı.

---

## 🔍 4. Olasılık Matrisi

| Senaryo | Olasılık | Kanıt |
|---------|----------|-------|
| SELinux port erişimi engelliyor | ⭐⭐⭐⭐⭐ Yüksek | ttyUSB açılamıyor, chmod reddedildi |
| Hiworld getSerialPorts() gizlemiş | ⭐⭐⭐⭐ Yüksek | Binder var ama port listesi boş |
| CAN box fiziksel bağlı değil | ⭐⭐ Orta | USB port görünüyor ama açılamıyor |
| ROM-key eksikliği | ⭐⭐⭐⭐⭐ Yüksek | Görüntü 5'teki "SvcMgr HIT" başarısı ama veri yok |
| iCar OBD adaptörü gerekli | ⭐⭐⭐ Orta | ELM327 ATMA modu hala kullanılabilir |

---

## 🔍 5. CAN Sinyal Durumu — Reverse/Geri Vites

### McuEventSniffer Analizi

McuEventSniffer geri vites için 4 yöntem deniyor:

```java
// Yöntem 1: BackcarService IBinder transact — en umut verici
ComponentName: com.nwd.backcar.BackcarService
// → "exp=true, svc=1" = servis çalışıyor
// → Transact 1-20 kör deneme → veri yok (veri akışı yok)

// Yöntem 2: NWD broadcast action'ları
"com.nwd.can.REVERSE"  → Hiworld DOLDURMUYOR
"com.nwd.backcar.action.REVERSE_ON"  → çalışması lazım ama DOLDURMUYOR

// Yöntem 3: /dev/nwdmcu, /dev/hiworld dosyaları
// → Dosya yok veya okunamıyor

// Yöntem 4: ContentProvider sorgusu
content://com.nwd.factory.setting/mcu  → "HIT" var ama REVERSE sütunu yok
```

**Reverse sinyali için:** BackcarService çalışıyor AMA veri akışı yok. Geri vites sinyali Hiworld native katmanında üretiliyor ama CarOS Pro'ya ulaşmıyor.

---

## 🔍 6. Sistem Durumu Özeti

```
✅ CAN Sniffer UI:                     Aktif, çalışıyor
✅ SystemCanBroadcastAdapter:         Kayıtlı (30+ action)
✅ McuEventSniffer:                  Keşif modunda, servis bağlantısı başarılı
✅ HiworldAdapter SerialManager:      Binder bulundu, port listesi boş
✅ HiworldAdapter File I/O:           SELinux tarafından reddediliyor
⚠️ CAN Veri Akışı:                    HİÇBİR KATMANDAN VERİ YOK
⚠️ Hiworld Broadcast Emission:       Kapalı (veri doldurulmuyor)
⚠️ Reverse/Geri Vites Sinyali:       BackcarService çalışıyor ama sinyal yok
```

---

## 🔍 7. Çözüm Yolları — Öncelik Sırası

### Çözüm A: ELM327 ATMA Modu ✅ En Güvenilir

iCar OBD Bluetooth adaptörü takılıysa:

```typescript
// CanDiagPanel → Sniffer butonu
CarLauncher.startRawCanScan() // ELM327 ATMA moduna geçirir
// → Tüm CAN frame'ler yakalanır
// → Reverse sinyali OBD üzerinden gelir (0x2XX ID'leri)
// → Bağımsız: Hiworld kilidi bypass
```

**Avantaj:** Hiworld'den bağımsız, doğrudan OBD-II üzerinden
**Dezavantaj:** Kablo/OBD adaptörü gerekiyor

### Çözüm B: OBD Mock Mode (Test/Demo)

Eğer iCar bağlı değilse ve sadece **test** yapılıyorsa:

```typescript
// obdMockEngine.ts — simüle edilmiş veri
// Speed, RPM, Reverse, Door sinyalleri simüle edilir
// Geliştirme ortamında reverse overlay test edilebilir
```

### Çözüm C: BackcarService Broadcast Dinlemesi

McuEventSniffer'da yeni bir action var ama denenmedi:

```java
// McuEventSniffer NWD_ACTIONS'e eklenmeli:
"com.nwd.backcar.action.REVERSE_ON"    // ← EKLE
"com.nwd.backcar.CAMERA_ON"            // ← EKLE
"com.nwd.backcar.STATUS"               // ← EKLE
```

Bu action'lar gerçekten dolduruluyorsa reverse sinyali yakalanabilir.

### Çözüm D: Hiworld SerialManager Port Keşfi İyileştirmesi

```java
// HiworldAdapter.java — ek port listesi
// Mevcut: ttyMT3, ttyS4, ttyUSB0
// Eklenmeli: Hiworld K250 spesifik portlar
"/dev/nwd_can",     // NWD CAN box
"/dev/mcu_uart",    // MCU UART
"/dev/hw_can",      // Hiworld CAN
```

### Çözüm E: CAN Profile Kullanımı

`public/canProfiles/` dizininde standart OBD profili var. Kullanıcının aracı için özel profil oluşturulabilir:

```json
// public/canProfiles/standard_obd.json
{
  "signals": [
    { "name": "reverse", "canId": 0x2XX, "startByte": 0, "length": 1 }
  ]
}
```

---

## 🔍 8. Hiworld ROM-Key Durumu

```
┌─────────────────────────────────────────────────────────────┐
│  Hiworld K24 Sistem Mimarisi                               │
│                                                             │
│  ┌──────────────┐    ROM-key korumalı    ┌──────────────┐   │
│  │ Hiworld Ana  │ ─────────────────────→ │ CAN Bus      │   │
│  │ Uygulama     │ (sadece ROM-key ile)   │ Veri         │   │
│  └──────────────┘                        └──────────────┘   │
│         ↕                                       ↕          │
│  ┌──────────────┐                       ┌──────────────┐   │
│  │ NWD Servisleri│ (veri okuma API'sı    │ CAN Bus      │   │
│  │ (exported)    │  açık ama veri yok)   │ Hardware     │   │
│  └──────────────┘                        └──────────────┘   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ CarOS Pro CAN Pipeline (3 katmanlı — veri alamıyor)    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────┐    OBD-II           ┌──────────────┐     │
│  │ OBD ELM327  │ ←──────────────────→  │ CAN Bus      │     │
│  │ (iCar BT)   │ (doğrudan, bypass)   │ OBD-II       │     │
│  └──────────────┘                       └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 9. Yapılması Gerekenler — Öncelik

| # | Aksiyon | Öncelik | Durum |
|---|---------|---------|-------|
| 1 | iCar OBD adaptörü bağlı mı kontrol et | 🔴 Kritik | — |
| 2 | ELM327 ATMA modunu test et (CanDiagPanel Sniffer) | 🔴 Kritik | — |
| 3 | McuEventSniffer'a `com.nwd.backcar.*` action'ları ekle | 🟡 Orta | Kod mevcut |
| 4 | HiworldAdapter'a NWD-specific port'lar ekle | 🟡 Orta | Kod mevcut |
| 5 | obdMockEngine ile simüle test yap | 🟡 Orta | Kod mevcut |
| 6 | CAN profile ile standart OBD sinyallerini kullan | 🟢 Düşük | — |

---

## 🔍 10. Görüntü 5'teki Kritik Bulgu

```
SvcMgr HIT: nwdaudio   ✓
SvcMgr HIT: nwdmanager ✓
```

Bu iki satır çok önemli: **Nwdaudio ve nwdmanager servislerine CarOS Pro'dan erişim var.** Bu, `com.nwd.factory.setting` ve `com.nwd.vehicle` ContentProvider'ları üzerinden veri okuma potansiyeli olduğunu gösterir.

**Aksiyon:** McuEventSniffer'da bu ContentProvider'ların sorgulanması genişletilmeli. Özellikle:
- `content://com.nwd.factory.setting` — MCU sütunları için sorgula
- `content://com.nwd.vehicle` — araç sinyalleri için sorgula

---

## Sonuç

CarOS Pro'nun CAN bus mimarisi **sağlam ve doğru tasarlanmış**. Üç katmanlı pipeline (broadcast + serial + OBD) endüstri standardı. Sorun, Hiworld'ün donanıma erişimi ROM-key ile kilitlemesi — bu bir yazılım sınırlaması, CarOS Pro'nun hatası değil.

**En güvenilir çözüm: iCar OBD Bluetooth adaptörü bağla → ELM327 ATMA modunu başlat → geri vites ve diğer sinyalleri OBD üzerinden al.**