# CAROS PRODUCT MASTER PLAN
### Tek Platform · Üç Ürün · Satışa Giden Yol

**Tarih:** 2026-08-22 · **Mod:** salt-okunur analiz (kod değiştirilmedi, migration çalıştırılmadı, deploy yapılmadı)
**Kanıt tabanı:** üretim veritabanı ölçümü + kaynak kod okuması. README esas alınmadı; UI varlığı "tamamlandı" sayılmadı.

---

## 0. TEK CÜMLELİK TEŞHİS

> **Araç konuşuyor, kimse dinlemiyor.**

Üretimde 838 araç kayıtlı ve `vehicle_events` tablosunda **87.072 satır** var — yani araç
tarafı gerçekten veri üretiyor. Buna karşılık **`vehicle_pairings` tablosunda 1 satır**,
`profiles` tablosunda **2 satır** var. 57 üretim tablosunun **40'ı (%70) tamamen boş**.

CarOS Pro'nun sorunu "özellik eksikliği" değil. Sorun şu: **araç zekâsı ile insan arasındaki
köprü kurulmamış.** Araç ölçüyor, yorumluyor, tahmin ediyor — ama bu bilginin telefona,
buluta ve kullanıcıya ulaştığı zincir üretimde neredeyse hiç kullanılmamış durumda.

Bu doküman o köprüyü tarif eder.

---

## 1. MEVCUT DURUM — ÖZELLİK MATRİSİ

Durum kodları: **TAM** (uçtan uca çalışıyor, üretim kanıtı var) · **KISMİ** (bir uç eksik) ·
**PLACEHOLDER** (arayüz var, besleyen yok) · **BROKEN** (kod var, kanıtlanmış hatayla ölü) ·
**YOK** · **DOĞRULANAMADI** (gerçek araç/cihaz gerekiyor).

### 1.1 Araç-içi CarOS

| Alan | Durum | Kanıt |
|---|---|---|
| OBD/ELM327 bağlantı yaşam döngüsü | KISMİ | `obdService` + KWP/UDS katmanı mevcut; kütükte 🔴 bekleyen maddeler var |
| PID okuma + standart kayıt | TAM | 16 PID standart kayıtta (commit `184166b3`) |
| Klon adaptör tespiti | TAM | ürün yoluna bağlandı (`d907425b`) |
| Provenance (`MEASURED/DERIVED/ESTIMATED/UNAVAILABLE`) | TAM | `vehicleDataLayer/vehicleProvenance.ts` + LAB ekranı |
| Adaptif çalışma zamanı (5 mod, 3 Hz tek tick) | TAM | `AdaptiveRuntimeManager` + `MODE_GATES` izleme |
| Navigasyon / offline harita | KISMİ | çok sayıda saha düzeltmesi kapandı; kütükte 🔴 kalemler sürüyor |
| Guardian AI / denetim noktası uyarısı | KISMİ | OSM kapsamı ölçüldü: TR 730 nokta, yön bilgisi yalnız %32 |
| Mavi (araç-içi asistan) | KISMİ | STT/TTS/hibrit yönlendirme var; taşıma sorunu çözüldü (`#697–#699`) |
| Bakım beyni (`maintenanceBrain`) | KISMİ | 398 satır; **buluttaki yakıt/servis kayıtlarını OKUMUYOR** |
| Yolculuk yükleme | TAM | `tripUploadRuntime` — defter `safeStorage` ile kalıcı, 6/6 halka yeşil |
| Uzak komut alma | TAM | 14 komut tipinin **14'ü** `commandListener.ts` içinde işleniyor |
| Fiziksel komut (kilit/korna/far) | KISMİ | `CarLauncherPlugin.sendMcuCommand` gerçek CAN'a gidiyor, dürüst hata döndürüyor; **gerçek araçta DOĞRULANAMADI** |
| CAROS LAB gözlem yüzeyi | TAM | katalog + ekran haritası + kilit testleri |

### 1.2 Arabam Cebimde (telefon / PWA)

| Alan | Durum | Kanıt |
|---|---|---|
| Toplam yüzey | — | **2 sayfa** (`kumanda`, `key-beam`) + **6 bileşen** |
| Eşleştirme (`PairingScreen`) | KISMİ | 695 satır; üretimde **1 eşleştirme kaydı** |
| Uzak kumanda (`kumanda`) | KISMİ | komut yazma ucu çalışıyor; teslimat ÇEKME modeli |
| Tanılama paneli (`DiagnosticsPanel`) | KISMİ | 721 satır; DTC okuma/temizleme komutu var |
| Kayıt defteri (`RecordsPanel` — yakıt/servis) | **PLACEHOLDER** | 1049 satır UI; üretimde `vehicle_fuel_logs` = **0**, `vehicle_service_records` = **0**; RPC yok, doğrudan PostgREST |
| Tema stüdyosu (`ThemeStudio`) | KISMİ | 1020 satır |
| Araç haritası (`VehicleMapView`) | KISMİ | 553 satır; `vehicle_locations` = 1905 satır (veri akıyor) |
| **Mavi sohbeti** | **YOK** | telefonda asistan yok — Mavi yalnız araçta |
| **Çoklu araç** | KISMİ | `vehicleStore` sözlük tutuyor, telefon UI'ı tek araca göre |
| **Push bildirimi** | **BROKEN** | abonelik iki tarafta da var, **gönderen hiçbir yerde yok** |

### 1.3 Web / Panel

| Alan | Durum | Kanıt |
|---|---|---|
| Toplam yüzey | — | **34 sayfa** — açık ara en olgun ürün |
| Kimlik doğrulama (login/register/reset) | TAM | 5 sayfa |
| Filo yönetimi | TAM | 15 sayfa (vehicles, drivers, members, transfer, conflicts, pending…) |
| Filo raporları + PDF | TAM | `fleetReportPdf.ts` + düzen kilitleri |
| Sürücü skoru / vardiya görünümü | TAM | `driverScore.ts`, `shiftView.ts` |
| Yakıt maliyet modeli | TAM | `fuelCostModel.ts` |
| Public API v1 | TAM | `/api/v1/vehicles`, `/api/v1/trips` + `publicApiAuth` |
| Bildirimler sayfası | **PLACEHOLDER** | sayfa var; `notifications` tablosu üretimde **0 satır** |
| `/admin` | **BROKEN (güvenlik)** | middleware kapsamı DIŞINDA (RISK-03) |
| **Abonelik / ödeme** | **YOK** | `get_my_plan` her çağrıda sabit `trial · is_pro:true · 30 gün` döndürüyor — taslak |
| **Veri dışa aktarma (KVKK/GDPR)** | **YOK** | kod tabanında hiçbir iz yok |

### 1.4 Üretim veri gerçeği (57 tablo, 17'si dolu)

| Tablo | Satır | Ne anlama geliyor |
|---|---:|---|
| `vehicle_events` | 87.072 | araç bol bol olay üretiyor |
| `vehicle_locations` | 1.905 | konum akışı çalışıyor |
| `vehicles` | 838 | cihazlar kendini kaydediyor |
| `mavi_reasoning_scheduler_run` | 500 | zamanlayıcı dönüyor |
| `audit_logs` | 235 | denetim izi tutuluyor |
| `vehicle_telemetry` | 64 | telemetri **çok az** |
| `vehicle_trips` | 34 | yolculuk **çok az** |
| `vehicle_commands` | 17 | uzak komut neredeyse hiç kullanılmamış |
| `profiles` | 2 | **gerçek kullanıcı yok** |
| `vehicle_pairings` | 1 | **köprü kurulmamış** |
| `notifications` | 0 | **bildirim hiç üretilmemiş** |
| `vehicle_fuel_logs` / `vehicle_service_records` | 0 / 0 | **kayıt defteri hiç kullanılmamış** |
| diğer 40 tablo | 0 | şema hazır, ürün değil |

> **Okuma:** 838 : 1 oranı. Cihaz tarafı ölçek üretiyor, kullanıcı tarafı yok.
> Bu bir "büyüme" sorunu değil; **onboarding zinciri kopuk** sorunudur.

---

## 2. ÜÇ ÜRÜN ARASI KOPUKLUKLAR

### K-1 · Kayıt defteri tek yönlü (telefon → bulut → hiçbir yer)
Kullanıcı telefonda yakıt aldığını ve servise gittiğini yazıyor; bu veri buluta yazılıyor
(doğrudan PostgREST ile, RPC yok). **Araç bu veriyi hiç okumuyor.**
`maintenanceBrain.ts` içinde `fuel_log`, `service_record`, `supabase` veya `rpc`
kelimelerinin **hiçbiri geçmiyor**. Yani araç, kullanıcının dün yağ değiştirdiğini bilmeden
"yağ değişimi zamanı" diyebilir. Bu, ürün vaadini doğrudan çürütür.

### K-2 · Bildirim üretici yok
`notifications` tablosuna yazan **tek bir fonksiyon** var: `run_report_schedules`.
DTC oluşması, geofence ihlali, düşük yağ basıncı, aşırı ısınma — **hiçbiri bildirim üretmiyor**.
Panelde bildirim sayfası var, besleyeni yok.

### K-3 · Push zincirinin gönderen ucu yok
`pushEngine.ts` (web) ve `pushService.ts` (araç) abonelik kaydediyor.
Kod tabanının hiçbir yerinde `web-push` ya da FCM gönderimi yok.
**Abonelik toplanıyor, mesaj gönderilmiyor.** Kullanıcı uygulamayı açmadan hiçbir şey öğrenemez.

### K-4 · Mavi telefonda yok
Mavi yalnız araç-içi. Kullanıcı araçtan indiğinde asistanını kaybediyor.
Web'deki "mavi" referansları filo zekâsı okumaları; `run_mavi_reasoning_queue` fonksiyonunun
**hiçbir UI çağıranı yok**.

### K-5 · Taşıma kuyruğu yeniden başlatmayı atlatmıyor
`connectivityService` gerçek bir kuyruk (öncelik sınıfı, üstel backoff 30 sn tavan, dedup
anahtarı, izlenen raporlarda sınırlı retry + TTL) — **ama tamamen bellekte.**
Araç kontağı kapanınca kuyruktaki telemetri ve komut durumu **kaybolur**.
Yalnız `tripUploadRuntime` kendi defterini `safeStorage`'a yazdığı için yolculuklar korunur.
Yani: **yolculuk dayanıklı, geri kalan her şey uçucu.**

### K-6 · İki komut yolu, biri ölü
`website/src/lib/commandService.ts` içindeki `sendCommandWithApiKey` → `/api/pwa/command`
rotasının **hiçbir çağıranı yok**. Ayrıca bu rota `verifyApiKey(rawKey, api_key_hash)` yapıyor;
kolon düz metin tuttuğu için karşılaştırma **asla eşleşmiyor** (BUG-001). İki ayrı otorite,
biri sessizce ölü — "tek otorite" kuralının ihlali.

### K-7 · Cihaz kimliği düz metin
`vehicles.api_key_hash` kolonu adına rağmen hash tutmuyor: 838/838 satır UUID biçiminde,
SHA-256 biçiminde **0**. Veritabanı sızarsa 838 aracın kimliği doğrudan kullanılabilir (RISK-01).

---

## 3. İDEAL KULLANICI YAŞAM DÖNGÜSÜ

Bugün bu döngünün **4. adımından sonrası üretimde neredeyse hiç gerçekleşmemiş**.

| # | Aşama | Bugün | Olması gereken |
|---|---|---|---|
| 1 | Cihaz kutudan çıkar, açılır | ✅ çalışıyor | aynı |
| 2 | Araç kendini buluta kaydeder | ✅ 838 kayıt | aynı |
| 3 | Kullanıcı telefonda hesap açar | ❌ 2 profil | tek ekran, telefon numarası ile |
| 4 | Telefon ↔ araç eşleşir | ❌ 1 kayıt | araç ekranındaki 6 haneli kod, kısa ömürlü |
| 5 | Araç kullanıcıyı tanır (tema, dil, ev/iş) | ❌ yok | profil buluttan araca iner |
| 6 | İlk yolculuk kaydedilir | ⚠️ 34 kayıt | otomatik, kullanıcı hiçbir şey yapmaz |
| 7 | **İlk anlamlı bildirim gelir** | ❌ 0 bildirim | döngüyü kapatan "aha" anı |
| 8 | Kullanıcı yakıt alır, telefona yazar | ❌ 0 kayıt | tek dokunuş; **araç bunu öğrenir** |
| 9 | Araç bakım öngörüsü üretir | ⚠️ üretir ama kayıtlardan habersiz | kayıt + telemetri birleşir |
| 10 | Kullanıcı araçtan iner, Mavi'yi telefonda sürdürür | ❌ yok | bağlam devri |
| 11 | İkinci araç eklenir | ⚠️ şema hazır, UI tek araç | araç değiştirici |
| 12 | Filo/şirket moduna geçer | ✅ web hazır | aynı |
| 13 | Abonelik başlar | ❌ taslak RPC | gerçek plan + limit |
| 14 | Kullanıcı verisini indirir / hesabını siler | ❌ yok | KVKK zorunluluğu |

> **Kritik kırılma: 4 → 7 arası.** Ürünün "aha" anı 7. adımdır — *araç bir şey fark etti ve
> bana söyledi*. Bugün oraya giden yol fiziksel olarak yok (bildirim üretici + gönderici yok).

---

## 4. ARAÇ-İÇİ CAROS — BOŞLUK ANALİZİ

Araç-içi katmanların tamamı kod olarak **mevcut**: `sensors/`(2), `vehicleHal/`(5),
`vehicleDataLayer/`(19), `telemetry/`(5), `reasoning/`(8), `obd/predictionRuntime.ts`,
`aiMechanic/`(2), `safety/`(12), `companion/`(22 dosya). Boşluk **derinlikte değil, bağlantıda**.

| # | Alt sistem | Durum | Eksik olan |
|---|---|---|---|
| 1 | OBD taşıma (BLE/SPP/KWP) | KISMİ | saha kütüğünde 🔴 kalemler |
| 2 | Protokol keşfi / klon tespiti | TAM | — |
| 3 | PID kaydı ve yetenek öğrenme | TAM | — |
| 4 | DTC okuma / temizleme | KISMİ | **DTC → bildirim yolu yok** |
| 5 | Freeze frame | DOĞRULANAMADI | gerçek araç gerekiyor |
| 6 | UDS/KWP genişletilmiş tanı | KISMİ | araç-marka kapsamı ölçülmemiş |
| 7 | Provenance katmanı | TAM | — |
| 8 | Sensör füzyonu (GPS + OBD + IMU) | TAM | hız kaynağı önceliklendirme çözüldü |
| 9 | Dead reckoning / tünel | KISMİ | saha doğrulaması eksik |
| 10 | Navigasyon rota motoru | KISMİ | 🔴 kalemler |
| 11 | Offline harita karoları | TAM | — |
| 12 | Gece/gündüz harita | TAM | mutlak parlaklık kilidi |
| 13 | Hız limiti (yol + araç sınıfı) | TAM | — |
| 14 | Guardian denetim noktaları | KISMİ | OSM yön verisi %32 |
| 15 | Radar/kamera HUD | KISMİ | kapsam sınırlı |
| 16 | Geri vites kaplaması | TAM | z-index kilidi var |
| 17 | Güvenlik beyni (fault → özellik kapatma) | TAM | — |
| 18 | Aşırı ısınma / yağ basıncı uyarısı | KISMİ | **buluta ve telefona gitmiyor** |
| 19 | Yakıt hesabı + kalibrasyon | KISMİ | kalibrasyon uzun süre ölü özellikti |
| 20 | Yolculuk kaydı | TAM | — |
| 21 | Yolculuk yükleme (dayanıklı) | TAM | — |
| 22 | Sürücü DNA / skorlama | KISMİ | 6/6 halka yeşil, saha kanıtı yok |
| 23 | Tahmin motoru (`predictionRuntime`) | KISMİ | çıktısı kullanıcıya ulaşmıyor |
| 24 | Digital Twin | KISMİ | gözlem yüzeyi kısıtlı |
| 25 | AI Mekanik | KISMİ | bulut kayıtlarını okumuyor |
| 26 | Bakım beyni | KISMİ | **K-1 kopukluğu** |
| 27 | Mavi STT (Vosk offline) | TAM | 🟢 head unit doğrulandı |
| 28 | Mavi TTS (hibrit) | TAM | — |
| 29 | Mavi niyet/eylem kapısı | TAM | P0 korunan eylem kapısı |
| 30 | Mavi bulut yönlendirme | TAM | `#697–#699` çözüldü |
| 31 | Companion bellek / kimlik | KISMİ | buluta senkron değil |
| 32 | Tema motoru + stüdyo | TAM | — |
| 33 | Adaptif çalışma zamanı / DeviceTier | TAM | ADR 0005 |
| 34 | CAROS LAB | TAM | — |
| 35 | Uzak komut alıcı | TAM | 14/14 |
| 36 | MCU/CAN fiziksel komut | DOĞRULANAMADI | gerçek araç |
| 37 | Push alıcı | BROKEN | gönderen yok (K-3) |

> **Sonuç:** araç-içi zekâ *derin*. Kayıp değer, bu zekânın araç dışına çıkamamasında.

---

## 5. ARABAM CEBİMDE — VİZYON

Bugün 2 sayfa. Hedef: **aracın araç dışındaki yüzü**. Aşağıdaki 30 yetenek, ürünün
"telefon" ayağının tam tanımıdır.

| # | Yetenek | Bugün |
|---|---|---|
| 1 | Hesap açma / telefonla giriş | KISMİ |
| 2 | 6 haneli kodla eşleştirme | KISMİ |
| 3 | Çoklu araç değiştirici | YOK |
| 4 | Araç sağlık kartı (tek bakışta) | YOK |
| 5 | Canlı konum + son park yeri | KISMİ |
| 6 | "Aracımı bul" (yürüme rotası) | YOK |
| 7 | Uzak kilit / kilit açma | KISMİ |
| 8 | Korna / far (aracı bulma) | KISMİ |
| 9 | Alarm aç/kapa | KISMİ |
| 10 | DTC okuma + sade açıklama | KISMİ |
| 11 | DTC temizleme (onaylı) | KISMİ |
| 12 | Akü voltajı + zayıflama uyarısı | KISMİ |
| 13 | Yakıt kaydı (fiş fotoğrafı + OCR) | PLACEHOLDER |
| 14 | Servis kaydı defteri | PLACEHOLDER |
| 15 | Bakım takvimi + hatırlatma | YOK |
| 16 | Muayene / sigorta / kasko son tarihi | YOK |
| 17 | Yakıt maliyeti / km başı maliyet | YOK (web'de var) |
| 18 | Yolculuk geçmişi + harita | KISMİ |
| 19 | Sürüş skoru + gelişim | YOK |
| 20 | Rota gönder (telefondan araca) | KISMİ |
| 21 | Tema/düzen gönder | KISMİ |
| 22 | Hız alarmı (genç sürücü / emanet) | KISMİ |
| 23 | Geofence (ev/iş/okul) | KISMİ |
| 24 | **Mavi sohbeti (telefonda)** | YOK |
| 25 | Push bildirim | BROKEN |
| 26 | Acil durum / kaza tespiti | YOK |
| 27 | Araç paylaşımı (aile üyesi) | YOK |
| 28 | Servis randevusu / yetkili servis | YOK |
| 29 | Belge cüzdanı (ruhsat, poliçe) | YOK |
| 30 | Veri indir / hesabı sil | YOK |

**Telefon ürününün tek cümlelik konumlandırması:**
> *Arabam Cebimde, aracın hafızası ve sesidir — araçtan indiğinde bile.*

---

## 6. WEB / PANEL — ÜÇ ROL

Web 34 sayfayla en olgun ürün, ama üç rolün ikisi eksik.

### Rol 1 — Bireysel araç sahibi
**Durum: ZAYIF.** Web, filo için tasarlanmış. Bireysel kullanıcı için `dashboard`,
`dashboard/vehicles`, `dashboard/map`, `dashboard/settings` var; kayıt defteri, bakım takvimi
ve maliyet analizi **yok** (bunlar telefonda placeholder).
*Karar önerisi:* bireysel kullanıcının ana yüzeyi **telefon** olsun; web yalnız "geniş ekran
görünümü" olarak konumlansın. İkisini de tam yapmaya çalışmak kaynağı böler.

### Rol 2 — Filo yöneticisi
**Durum: GÜÇLÜ.** 15 sayfa, rapor, PDF, sürücü skoru, vardiya, çakışma çözümü, devir.
Eksik: bildirim (K-2), abonelik/limit (§15), gerçek müşteri (1 şirket kaydı).

### Rol 3 — Servis / bayi / üretici (OEM entegratör)
**Durum: YOK.** Public API v1 var (`/api/v1/vehicles`, `/api/v1/trips`) ama bayi paneli,
araç teslim akışı, garanti/servis kaydı ve toplu cihaz sağlama (provisioning) yüzeyi yok.
**Ticari açıdan en yüksek kaldıraç burada:** ürün head unit üreticilerine satılacaksa,
üreticinin 500 cihazı tek seferde kaydedip müşteriye devredebileceği bir akış gerekir.
838 sahipsiz araç kaydı zaten bu ihtiyacın kanıtıdır.

---

## 7. MAVİ — DÖRT BAĞLAM VİZYONU

Mavi bugün tek bağlamda yaşıyor (araç-içi, sürüş). Hedef dört bağlam:

| Bağlam | Nerede | Ne yapar | Bugün |
|---|---|---|---|
| **Sürüş** | araç, ekran kapalı olabilir | eller serbest; navigasyon, çağrı, müzik, uyarı yanıtı | KISMİ (çalışıyor) |
| **Park/duruş** | araç, motor kapalı | tanı anlatımı, ayar, "bugün ne oldu" özeti | YOK |
| **Cepte** | telefon | "aracım nasıl?", "yağ ne zaman?", "nerede park ettim?" | YOK |
| **Masada** | web/panel | filo sorusu, doğal dilde rapor: "bu ay en pahalı 3 araç" | YOK (`run_mavi_reasoning_queue` çağıransız) |

**Bağlam devri kuralı:** araçtan inildiğinde konuşma telefonda **kaldığı yerden** sürer.
Bu, "ikinci beyin" iddiasının en somut kanıtıdır ve rakiplerde yoktur.

**Zorunlu sınır:** Mavi hiçbir bağlamda **kanıtsız konuşmaz**. Provenance zinciri
`UNAVAILABLE` diyorsa Mavi de "bilmiyorum" der. Bu, ürünün ayırt edici güven vaadidir.

---

## 8. VEHICLE INTELLIGENCE ZİNCİRİ

```
SENSÖR → HAM SİNYAL → PROVENANCE → GÜVEN → KURAL → FÜZYON → TAHMİN
       → KARAR → BİLDİRİM → KULLANICI EYLEMİ → GERİ BESLEME → ÖĞRENME
```

| Halka | Sahibi (kod) | Durum |
|---|---|---|
| SENSÖR | `sensors/`, `obd/`, `gpsService` | ✅ |
| HAM SİNYAL | `vehicleHal/` | ✅ |
| PROVENANCE | `vehicleDataLayer/vehicleProvenance.ts` | ✅ |
| GÜVEN (confidence) | `vehicleDataLayer/` | ✅ |
| KURAL | `reasoning/` | ✅ |
| FÜZYON / BAĞLAM | `reasoning/`, `telemetry/` | ✅ |
| TAHMİN | `obd/predictionRuntime.ts` | ✅ |
| KARAR | `safety/`, `aiMechanic/`, `maintenanceBrain` | ⚠️ bulut kayıtlarından habersiz |
| **BİLDİRİM** | — | ❌ **ZİNCİR BURADA KOPUYOR** |
| KULLANICI EYLEMİ | telefon/web | ❌ ulaşamıyor |
| GERİ BESLEME | — | ❌ yok |
| ÖĞRENME | `companion/companionMemory.ts` | ⚠️ yerel, buluta gitmiyor |

> **En değerli tek düzeltme:** 8. halkadan 9. halkaya köprü.
> İlk yedi halka yıllarca emek almış ve çalışıyor; sekizinci halka olmadan hepsi görünmez.

---

## 9. "ARABAM BENİ TANIYOR" — ÖĞRENME KATMANI

`companion/` altında 22 dosyalık gerçek bir altyapı var (`companionMemory`,
`companionIdentity`, `companionContext`, `companionProactiveWiring`…). Eksik olan:
**bellek araçta hapis.** Kullanıcı ikinci araca geçtiğinde ya da telefonu değiştirdiğinde
her şey sıfırlanır.

**Öğrenilecek şeyler ve nerede saklanacağı:**

| Öğrenilen | Örnek | Nerede saklanmalı |
|---|---|---|
| Rutin rotalar | 08:15 ev→iş | bulut (profil) |
| Tercih edilen tema/parlaklık | gece koyu, gündüz açık | bulut (profil) |
| Yakıt alma alışkanlığı | %25 altına düşünce | bulut (profil) |
| Sürüş karakteri | sert fren sıklığı | bulut (sürücü DNA) |
| Konuşma bağlamı | "her zamanki yer" | bulut (companion memory) |
| Tolerans eşikleri | uyarıyı 3 kez reddetti | bulut, **geri besleme** |
| Araç kişiliği | bu araç yokuşta ısınır | **araçta** (araca özgü) |

**Kural:** kişiye ait olan buluta, araca ait olan araçta kalır. Bu ayrım
KVKK açısından da doğru bölünmedir (araç devredilince kişisel bellek gitmez).

**Geri besleme halkası (bugün tamamen yok):** kullanıcı bir uyarıyı üç kez kapattıysa
sistem o uyarının eşiğini yükseltmeli. Bu olmadan ürün "akıllı" değil "ısrarcı" olur.

---

## 10. GÜVENLİK / GİZLİLİK HEDEF MİMARİSİ

| # | Konu | Bugün | Hedef |
|---|---|---|---|
| G-1 | Cihaz anahtarı | **düz metin** (838/838) | SHA-256; üç aşamalı geçiş (aşama 1 hazır, uygulanmadı) |
| G-2 | `/admin` koruması | **middleware dışında** | middleware kapsamına alın + rol kontrolü |
| G-3 | Kritik komut PIN'i | tanımlı ama **hiç kullanılmıyor** | `unlock`/`alarm_off` için zorunlu, sunucu tarafında doğrulanır |
| G-4 | Harita sağlayıcı anahtarları | istemciye gömülü | sunucu proxy veya BYOK |
| G-5 | Sahipsiz araç | 838 kayıt sahipsiz | sağlama (provisioning) akışı + sahipsiz kayda TTL |
| G-6 | RLS matrisi | boş tablolar "geçti" sanılıyordu | boş tablo = **UNPROVEN**, fixture ile doldurup kanıtla |
| G-7 | Prod GRANT sapması | yerelden farklı (17 vs 12) | tek kaynak: prod baseline zinciri |
| G-8 | Konum verisi saklama | `retention_policy` 6 satır | politikayı ürüne bağla, kullanıcıya göster |
| G-9 | Veri dışa aktarma / silme | **yok** | KVKK: indir + sil, 30 gün içinde |
| G-10 | Ses/transkript | LAB'a taşınmıyor (doğru) | aynı kural korunsun |
| G-11 | Denetim izi | `audit_logs` 235 satır | kritik komutlar zorunlu loglansın |
| G-12 | AI anahtarları | BYOK politikası var | merkezi anahtar **asla** gömülmesin |

**Fail-closed felsefesi korunmalı:** okunamadı ≠ veri yok ≠ ölçülemedi.
Güvenlik açığını özellikle maskeleme — G-1 kapanmadan "araç güvenliği" pazarlaması yapılamaz.

---

## 11. VERİ MODELİ BOŞLUKLARI

Kanonik varlıklar ve durumları:

| Varlık | Var mı | Boşluk |
|---|---|---|
| `vehicle` | ✅ | sahipsizlik (`owner_id NULL`) normalleşmiş durumda |
| `profile` (kullanıcı) | ✅ | 2 satır; rol modeli `individual/admin` ile sınırlı |
| `vehicle_pairing` | ✅ | 1 satır; **yaşam döngüsü (devir, iptal) ürüne bağlı değil** |
| `company` / filo | ✅ | 1 satır |
| `trip` (`vehicle_trips`) | ✅ | 34 satır |
| `telemetry` | ✅ | 64 satır — örnekleme politikası tanımsız |
| `event` | ✅ | 87k satır — **sınıflandırma/önem derecesi yok** |
| `notification` | ✅ şema | **üretici yok** |
| `fuel_log` / `service_record` | ✅ şema | **kullanılmıyor; RPC yok** |
| `maintenance_plan` (bakım planı) | ❌ | yok — bakım takvimi için zorunlu |
| `document` (ruhsat/poliçe) | ❌ | yok |
| `subscription` / `plan` | ❌ | `get_my_plan` taslak |
| `device_provision` (bayi sağlama) | ❌ | yok — Rol 3 için zorunlu |
| `feedback` (uyarı reddi) | ❌ | yok — öğrenme halkası için zorunlu |
| `driver_profile` (kişisel bellek) | ⚠️ | araçta yerel, buluta senkron değil |

**En kritik üç eksik varlık:** `notification` üreticisi, `maintenance_plan`, `subscription`.

---

## 12. SENKRON MİMARİSİ

**Mevcut:** `connectivityService` — öncelik sınıfları (`critical/high/normal`),
üstel backoff (temel × 2^deneme, 30 sn tavan), tip bazlı dedup anahtarı
(ör. `cmd_status_${commandId}`), izlenen raporlarda sınırlı retry + TTL,
jenerik öğelerde en-az-bir-kez sözleşmesi.

**Üç yapısal eksik:**

1. **Kalıcılık.** Kuyruk bellekte. Kontak kapanınca telemetri ve komut durumu kaybolur.
   *Öneri:* `safeStorage` destekli kuyruk — `tripUploadRuntime` deseni zaten kanıtlı.
2. **Çakışma çözümü.** Aynı kaydı hem telefon hem araç güncellerse kural tanımsız.
   *Öneri:* varlık başına tek yazar (§14 sahiplik matrisi) + sunucu zaman damgası otoritesi.
3. **Saat kayması.** Araç saati güvenilmez (akü sökülünce sıfırlanır). Süre hesapları
   monotonik delta kullanıyor (doğru), ama **buluta giden kayıtlarda mutlak zaman** var.
   *Öneri:* istemci `client_ts` + `client_monotonic_ms` gönderir, sunucu `server_ts` damgalar;
   otorite **sunucudur**, istemci zamanı yalnız sıralama ipucu olarak saklanır.

---

## 13. BİLDİRİM MİMARİSİ

```
OLAY → ÖNEM → POLİTİKA → KANAL → TESLİMAT → GERİ BESLEME
```

| Önem | Örnek | Kanal | Sürüşte |
|---|---|---|---|
| **KRİTİK** | yağ basıncı düşük, aşırı ısınma, kaza | araç sesli + ekran + push + SMS | **kesintiye uğratır** |
| **YÜKSEK** | DTC oluştu, akü zayıf, geofence ihlali | araç ekran + push | sürüş sonrası özet |
| **ORTA** | bakım zamanı, muayene yaklaşıyor | push + telefon rozeti | sessiz |
| **DÜŞÜK** | haftalık özet, sürüş skoru | telefon/e-posta | sessiz |

**Zorunlu kurallar:**
- Bildirim **kanıtla** gelir: hangi sinyal, ne zaman ölçüldü, provenance ne.
- Aynı olay tekrar tekrar bildirilmez — **olay kimliği + susturma penceresi**.
- Kullanıcı bir bildirimi kapattıysa bu **geri besleme olarak kaydedilir** (§9).
- Sürüş sırasında yalnız KRİTİK kesintiye uğratır — güvenlik kuralı, pazarlanabilir bir sınır.

**Bugünkü durum:** bu zincirin **tamamı yok**. `notifications` tablosu 0 satır,
üretici tek (rapor zamanlayıcı), gönderici hiç.

---

## 14. ÖZELLİK SAHİPLİK MATRİSİ

"Tek otorite" kuralı: **aynı gerçek iki yerde hesaplanmaz.**

| Gerçek | Otorite | Diğerleri |
|---|---|---|
| Anlık hız, RPM, motor durumu | **ARAÇ** | okur |
| Provenance / güven derecesi | **ARAÇ** | okur |
| Güvenlik kararı (uyarı, özellik kapatma) | **ARAÇ** | okur |
| Yolculuk kaydı | **ARAÇ** üretir | bulut saklar |
| Konum akışı | **ARAÇ** | bulut saklar, telefon/web gösterir |
| Yakıt/servis kaydı | **TELEFON** girer | **araç OKUMALI** (bugün okumuyor) |
| Bakım planı | **BULUT** (araç + kayıt birleşimi) | araç ve telefon okur |
| Bildirim üretimi | **BULUT** | telefon/araç gösterir |
| Kullanıcı profili / tercih | **BULUT** | araç indirir |
| Araç kişiliği (bu araç yokuşta ısınır) | **ARAÇ** | — |
| Filo kuralları, sürücü ataması | **BULUT/WEB** | araç uygular |
| Sürücü skoru | **BULUT** (ham veri araçtan) | web/telefon gösterir |
| Abonelik / limit | **BULUT** | hepsi uyar |
| Komut yetkisi (PIN dahil) | **BULUT** | araç yalnız doğrulanmışı uygular |

---

## 15. SATILABİLİR ÜRÜN PAKETLERİ

Fiyat **kasıtlı olarak yazılmadı** — fiyatlandırma pazar araştırması gerektirir.

### P1 · CarOS Free (cihazla gelir)
Araç-içi OS, offline harita, OBD göstergeler, temel tanı, Mavi (offline STT/TTS),
tema. **Bulut yok, telefon yok.** Amaç: donanım satışını desteklemek.

### P2 · CarOS Connected (bireysel abonelik)
+ Telefon eşleştirme, canlı konum, uzak komut, kayıt defteri, bakım takvimi,
bildirimler, Mavi bulut modu, yolculuk geçmişi, veri dışa aktarma.
**Ürünün asıl gelir motoru budur ve bugün altyapısı en eksik olan bu.**

### P3 · CarOS Fleet (şirket, araç başı)
+ Filo paneli, sürücü ataması, vardiya, sürücü skoru, geofence, raporlar + PDF,
maliyet analizi, çakışma çözümü, devir. **Bugün en hazır paket.**

### P4 · CarOS OEM / Bayi (lisans)
+ Toplu cihaz sağlama, beyaz etiket tema, Public API v1, garanti/servis entegrasyonu,
teslim akışı. **En yüksek kaldıraç, en az hazır.**

**Paketleme kararı:** P3 bugün satılabilir durumda; P2 ürünün kalbi ama eksik;
P4 ticari olarak en değerli. **P1'i ücretsiz tutmak stratejiktir** — donanım satılır,
bulut abonelikle gelir.

---

## 16. ON "WOW" ÖZELLİĞİ

Her biri mevcut altyapıdan türer — hayal değil, bağlantı meselesi.

1. **"Araç senden önce fark etti."** Yola çıkmadan telefona: *"Sağ ön lastik basıncı üç
   gündür düşüyor, bugün servise uğra."* — tahmin motoru + bildirim köprüsü.
2. **Bağlam devri.** Araçtan inerken Mavi konuşmayı telefonda sürdürür.
3. **Kanıtlı tanı.** Her uyarı "neden" düğmesiyle gelir: hangi PID, ne zaman, hangi güvenle.
4. **Fiş fotoğrafı → yakıt kaydı → gerçek tüketim.** OCR ile tek dokunuş; araç bunu öğrenir.
5. **"Nerede park ettim" + yürüme rotası.** Konum akışı zaten var (1905 kayıt).
6. **Sessiz kalibrasyon.** Depo dolduğunda araç yakıt eğrisini kendi düzeltir.
7. **Emanet modu.** Aracı birine verirken hız/geofence sınırı; ihlalde bildirim.
8. **Sürüş sonrası 15 saniyelik özet.** "Bugün 42 km, 5,8 L/100, iki sert fren, yakıt 12 gün yeter."
9. **Filo için doğal dil raporu.** *"Bu ay en pahalı üç araç hangisi?"* → `run_mavi_reasoning_queue`
   zaten var, çağıranı yok.
10. **Araç devri.** Aracı sattığında kişisel bellek gider, araç kişiliği kalır — tek dokunuş.

---

## 17. YAPILMAMASI GEREKEN ON ŞEY

1. **Yeni özellik eklemek** — 8. halka (bildirim) kapanmadan hiçbir yeni zekâ katmanı görünmez.
2. **Bireysel web panelini filo paneliyle eşit derinlikte yapmak** — kaynağı böler; bireysel = telefon.
3. **Sahte veriyle demo yapmak** — 40 boş tablo zaten "şema ≠ ürün" dersini veriyor.
4. **G-1 (düz metin cihaz anahtarı) kapanmadan güvenlik pazarlaması** yapmak.
5. **İki komut yolunu birden yaşatmak** — ölü olan (`/api/pwa/command`) kaldırılmalı.
6. **Push'u "abonelik var" diye tamamlanmış saymak** — gönderen yoksa özellik yoktur.
7. **Geriye uyumluluk için ölü şema taşımak** — gerçek kullanıcı yok, şimdi temizlemenin tam zamanı.
8. **Bildirimleri kanıtsız göndermek** — provenance `UNAVAILABLE` iken uyarı üretmek güveni öldürür.
9. **Sürüş sırasında KRİTİK olmayan bildirimle kesmek** — hem güvenlik hem marka riski.
10. **Saha doğrulaması olmadan "çalışıyor" demek** — kütükte 🔴 bekleyen madde varken paket satılamaz.

---

## 18. MASTER BOŞLUK LİSTESİ (P0 → P3)

### P0 — satış öncesi zorunlu, ürün bunlarsız çalışmaz

| ID | Boşluk | Neden P0 |
|---|---|---|
| P0-1 | Cihaz anahtarı düz metin (G-1) | 838 aracın kimliği sızmaya açık; aşama 1 hazır, uygulanmadı |
| P0-2 | `/admin` middleware dışında (G-2) | yetkisiz erişim yüzeyi |
| P0-3 | **Bildirim üretici yok** (K-2) | zeka zincirinin 8. halkası; ürün bunsuz görünmez |
| P0-4 | **Push gönderici yok** (K-3) | bildirim üretilse bile ulaşmaz |
| P0-5 | Kritik komut PIN'i kullanılmıyor (G-3) | uzaktan kilit açma korumasız |
| P0-6 | Kuyruk kalıcı değil (K-5) | kontak kapanınca veri kaybı |
| P0-7 | Eşleştirme akışı üretimde çalışmıyor | 838:1 oranı; onboarding kopuk |
| P0-8 | BUG-001 (`verifyApiKey` asla eşleşmiyor) | PWA rotaları ölü |

### P1 — ilk gerçek kullanıcı için gerekli

| ID | Boşluk |
|---|---|
| P1-1 | Araç bulut kayıtlarını okumuyor (K-1) — bakım beyni kör |
| P1-2 | Bakım planı varlığı yok (`maintenance_plan`) |
| P1-3 | Telefonda çoklu araç değiştirici |
| P1-4 | Araç sağlık kartı (tek bakışta özet) |
| P1-5 | Sürüş sonrası özet |
| P1-6 | Veri dışa aktarma + hesap silme (KVKK) |
| P1-7 | Çakışma çözümü + saat kayması politikası (§12) |
| P1-8 | Olay sınıflandırma (87k satır, önem derecesi yok) |
| P1-9 | Sahipsiz araç sağlama akışı (G-5) |
| P1-10 | Crash/hata raporlama (devir raporunda BULUNAMADI) |

### P2 — satılabilir ürün için gerekli

| ID | Boşluk |
|---|---|
| P2-1 | Abonelik / plan / limit (gerçek `get_my_plan`) |
| P2-2 | Mavi telefonda (K-4) + bağlam devri |
| P2-3 | Geri besleme halkası (uyarı reddi öğrenilsin) |
| P2-4 | Companion belleğin buluta senkronu |
| P2-5 | Bayi/OEM sağlama paneli (Rol 3) |
| P2-6 | Belge cüzdanı + muayene/sigorta hatırlatma |
| P2-7 | Harita sağlayıcı anahtarları sunucuya (G-4) |
| P2-8 | Ölü komut yolunun kaldırılması (K-6) |

### P3 — farklılaştırıcı

| ID | Boşluk |
|---|---|
| P3-1 | Fiş OCR ile yakıt kaydı |
| P3-2 | Emanet modu |
| P3-3 | Kaza tespiti / acil çağrı |
| P3-4 | Filo için doğal dil raporu (UI çağıranı) |
| P3-5 | Araç paylaşımı (aile) |
| P3-6 | Servis randevusu entegrasyonu |
| P3-7 | Araç devri akışı (kişisel bellek temizliği) |

---

## 19. ÜÇ AŞAMALI YOL HARİTASI

### AŞAMA 1 — "Zincir Kapansın" (P0)
**Hedef:** araçtan çıkan bir gerçek, kullanıcının telefonuna ulaşsın.
**Bitiş ölçütü (tek cümle):** *Gerçek bir araçta oluşan bir DTC, 60 saniye içinde
eşleşmiş bir telefona kanıtıyla birlikte push olarak düşer.*
Kapsam: P0-1…P0-8. Bu aşama bitmeden yeni özellik yazılmaz.

### AŞAMA 2 — "İlk Gerçek Kullanıcı" (P1)
**Hedef:** bir kullanıcı 30 gün boyunca ürünü doğal biçimde kullanabilsin.
**Bitiş ölçütü:** *Bir kullanıcı 30 gün boyunca hiçbir manuel müdahale olmadan
yolculuk geçmişi, yakıt kaydı, bakım uyarısı ve sürüş özeti alır; verisini indirebilir.*
Kapsam: P1-1…P1-10 + saha doğrulama kütüğündeki 🔴 kalemlerin kritik olanları.

### AŞAMA 3 — "Satılabilir Ürün" (P2)
**Hedef:** para karşılığı teslim edilebilir paket.
**Bitiş ölçütü:** *P3 (Fleet) ve P2 (Connected) paketleri abonelikle sınırlanır,
bayi 100 cihazı toplu sağlayıp müşteriye devredebilir, Mavi dört bağlamda çalışır.*
Kapsam: P2-1…P2-8, ardından P3 farklılaştırıcıları.

---

## 20. CAROS PRODUCT MASTER PLAN

### 20.1 Ürün tanımı
CarOS Pro **tek bir platformdur**, üç yüzeyle: araç (CarOS), telefon (Arabam Cebimde),
bulut/web (Panel). Ürün, aracın ikinci beynidir: ölçer, doğrular, yorumlar, öngörür,
karar verir ve **insana ulaşır**.

### 20.2 Konumlandırma
> *Tesla kendi aracını tanır. CarOS, tanımadığı her aracı öğrenir — ve öğrendiğini kanıtıyla söyler.*

### 20.3 Ayırt edici üç iddia
1. **Kanıtlı zekâ** — her çıktı provenance taşır; bilinmeyen `UNKNOWN` der.
2. **Evrensellik** — OEM verisi olmadan, aftermarket telemetriyle öğrenir.
3. **Süreklilik** — araçta başlayan bağlam telefonda ve panelde sürer.

### 20.4 Üç ürünün rolü
- **CarOS (araç):** ölçüm, karar, güvenlik. Otorite burada.
- **Arabam Cebimde (telefon):** hafıza, ses, erişim. Kullanıcının ana yüzeyi.
- **Panel (web):** filo, rapor, yönetim, entegrasyon. Kurumsal yüzey.

### 20.5 Mimari ilke
Tek otorite · fail-closed · zero-trust telemetri · zero-leak bellek ·
gözlemlenebilirlik zorunluluğu (CAROS LAB) · performans-uyarlanabilir hibrit.
**Bu ilkeler pazarlıksızdır ve ürün kararlarını ezer.**

### 20.6 En kritik tek boşluk
**Bildirim köprüsü (P0-3 + P0-4).** Zekâ zincirinin 8. halkası.
İlk yedi halka yıllarca emek almış ve çalışıyor; sekizinci halka olmadan hepsi görünmez.

### 20.7 En yüksek ticari kaldıraç
**OEM/Bayi sağlama akışı (Rol 3).** 838 sahipsiz araç kaydı bu ihtiyacın kendiliğinden
oluşmuş kanıtıdır. Cihaz üreticisi toplu kaydedip devredemezse ölçek mümkün değil.

### 20.8 Gelir modeli
Donanım (P1 ücretsiz OS ile) → bireysel abonelik (P2 Connected) →
kurumsal araç başı (P3 Fleet) → lisans (P4 OEM).

### 20.9 Veri sahipliği ilkesi
Kişiye ait veri buluta, araca ait veri araçta. Araç devrinde kişisel bellek gider.
Kullanıcı verisini her an indirebilir ve sildirebilir.

### 20.10 Güvenlik taahhüdü
Cihaz kimliği hash'li · kritik komut PIN'li ve loglu · konum verisi saklama politikalı ·
merkezi AI anahtarı yok (BYOK) · `/admin` korumalı.
**Bunlar tamamlanmadan güvenlik pazarlaması yapılmaz.**

### 20.11 Kalite kapısı
Test yeşil + tsc temiz **yeterli değildir**. Bir özellik ancak
(a) CAROS LAB'da gözlemlenebilirse, (b) saha doğrulama kütüğünde 🟢 ise
"tamamlandı" sayılır.

### 20.12 Ölçülecek üç sayı
1. **Eşleştirme oranı** = `vehicle_pairings` / `vehicles` — bugün **1/838 (%0,1)**.
2. **Bildirim teslim oranı** = teslim edilen / üretilen — bugün **tanımsız (0 üretim)**.
3. **30 günlük aktif kullanıcı** — bugün **0**.

### 20.13 Kaynak tahsis kararı
Aşama 1 bitene kadar **yeni zekâ katmanı yazılmaz**. Var olan zekâyı görünür kılmak,
yeni zekâ eklemekten daha değerlidir.

### 20.14 Terk edilecekler
Ölü komut yolu (`/api/pwa/command` + çağıransız `sendCommandWithApiKey`) ·
bireysel kullanıcı için derin web paneli hedefi · gerçek kullanıcı olmadığı için
geriye uyumluluk taşıma yükü.

### 20.15 İlk gerçek kullanıcı için hazır olma tanımı
Aşağıdakilerin **tamamı** doğru olmalı:
1. Bir telefon bir araçla eşleşebiliyor ve bu üretimde tekrar tekrar kanıtlanmış.
2. Gerçek bir araçta oluşan bir olay, kanıtıyla birlikte telefona push olarak ulaşıyor.
3. Uygulama kapalıyken bile bildirim geliyor.
4. Yolculuklar kayıp olmadan kaydediliyor (kontak kesintisi dahil).
5. Kullanıcı yakıt/servis kaydı girebiliyor ve **araç bunu dikkate alıyor**.
6. Cihaz anahtarı hash'li; kritik komut PIN istiyor.
7. Kullanıcı verisini indirebiliyor.
8. Saha doğrulama kütüğünde kritik 🔴 madde kalmamış.
9. Crash raporlama çalışıyor.
10. Tüm bunlar **gerçek araçta**, emülatörde değil, gözlenmiş.

### 20.16 Satışa hazır olma tanımı
20.15'in tamamı **artı**:
1. Abonelik planı gerçek (limitler uygulanıyor, `get_my_plan` taslak değil).
2. Bayi 100 cihazı toplu sağlayıp müşteriye devredebiliyor.
3. Fatura/ödeme akışı çalışıyor.
4. KVKK: veri indirme, silme, saklama politikası yayınlanmış.
5. Lisans denetimi temiz (`license-checker` — kopyaleft yok).
6. Destek/olay müdahale süreci tanımlı.
7. En az 3 farklı araç markasında saha doğrulaması yapılmış.
8. Geri alma (rollback) planı ve sürüm kanalı var.

### 20.17 Sonraki tek atomik adım
**P0-3 (bildirim üretici) + P0-4 (push gönderici) birlikte** — çünkü ikisi ayrı ayrı
hiçbir kullanıcı değeri üretmez. Kabul ölçütü: *gerçek araçta oluşan bir DTC,
60 saniye içinde eşleşmiş telefona provenance kanıtıyla düşer.*

---

## EK — BU ANALİZİN SINIRLARI

- **Gerçek araç gerektiren doğrulamalar** açıkça `DOĞRULANAMADI` işaretlendi:
  MCU/CAN fiziksel komut, freeze frame, marka bazlı UDS kapsamı, dead reckoning.
- Üretim sayıları **2026-08-22** tarihli tek ölçümdür; trend değildir.
- Bu turda **hiçbir kod değiştirilmedi, migration çalıştırılmadı, deploy yapılmadı.**
- Beklemede duran ve bu turda **ilerletilmeyen** iş: RISK-01 Aşama 1
  (`20260822000071_device_key_dual_read_p1.sql` yalnız yerelde uygulandı, commit edilmedi;
  `068_device_key_dual_read_matrix.sql` henüz koşulmadı; üretime dokunulmadı).
