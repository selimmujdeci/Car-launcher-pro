# CarOS Pro — R-Link 2 Derin Reverse-Engineering Araştırması

> **Faz durumu:** READ-ONLY masaüstü araştırması. Fiziksel R-Link 2'ye **hiçbir yazma /
> flash / update / ADB / DDT4All yazma işlemi yapılmadı.**
> **Tarih:** 2026-09-16 · **Araç:** Renault Megane 4 (2017), R-Link 2 yatay 7", SW 3.3.16.946, boot 5276

---

## 1. Executive Summary (Yönetici Özeti)

Bu araştırmanın amacı istenen cevabı üretmek değil, **gerçeği bulmaktı**. Sonuç net değil,
ama kanıtların gösterdiği yön nettir.

**Ana bulgu:** R-Link 2, standart Android uygulama kurulumuna **açık bir platform değildir**.
LG tarafından geliştirilmiş, **kapalı, imza-doğrulamalı (signed) bir automotive platformudur**.
Uygulamalar standart `.apk` değil, Renault'ya özel **`.wlpk`** (R-Link Update Package) formatında
dağıtılır ve yalnız yetkili USB/SD + R-Link Toolbox üzerinden kurulur. Firmware güncellemeleri
**`chain.pem` + `mm2014_upgrade.lgu` + `mm2014_upgrade.lgu.sig`** üçlüsüyle gelir — yani
**sertifika zinciri + dijital imza doğrulaması** vardır.

**CarOS Pro tarafı:** CarOS Pro, tam bir Android runtime gerektiren standart bir
**Capacitor (Android) APK'sıdır**: `minSdk 24` (Android 7.0), `targetSdk 36`, native ARM
kütüphaneler (Vosk, Media3/ExoPlayer, usb-serial), WebGL zorunlu WebView (MapLibre GL) ve
native Java plugin'ler (CarLauncher, OBD). Bu APK'nın olduğu gibi R-Link 2'ye kurulması için
gereken hiçbir koşul (açık PackageManager, imzasız/whitelist-dışı APK kabulü, güncel WebView,
Android 7+ ART) R-Link 2'de kanıtlanamadı.

**Nihai teknik hüküm (kanıta dayalı):**
- **A (CarOS Pro doğrudan çalışır)** → **DISPROVEN** (kanıt aksini gösteriyor).
- **B (Hafif CarOS R-Link Client + harici compute)** → **UNKNOWN / teknik engel ağır**
  (kod çalıştırma kapısının kendisi açık değil; client bile üçüncü taraf kod çalıştırmayı gerektirir).
- **C (Güvenilir üçüncü taraf kod pratik değil; farklı display/compute gerekir)** → **SUPPORTED**
  (mevcut kanıtların en çok desteklediği sonuç).

**Kritik dürüstlük notu:** Bu araştırmada **firmware paketi indirilemedi** (VIN-kapılı,
resmi Renault portalı, >600 MB–1 GB imzalı ZIP). Dolayısıyla FAZ 3–9'un *firmware içinden
kanıt çıkarma* kısımları **YAPILMADI**. Aşağıda bunlar açıkça `UNKNOWN` / `YAPILMADI` olarak
işaretlidir. Hiçbir yerde yapılmamış bir işi "yapıldı" diye sunmadım.

---

## 2. Exact Vehicle / R-Link Baseline

| Alan | Değer | Kaynak |
|---|---|---|
| Araç | Renault Megane 4, 2017 | Kullanıcı beyanı |
| Sistem | R-Link 2, yatay 7" | Kullanıcı beyanı |
| Software version | **3.3.16.946** | Kullanıcı beyanı (araçtan) |
| Bootloader version | **5276** | Kullanıcı beyanı (araçtan) |
| Platform kod adı | Muhtemelen LANR14/LANR16 ailesi | Forum/eBay servis ilanları (UNVERIFIED) |

**GÜVENLİK:** Bu sisteme bu faz boyunca dokunulmadı.

---

## 3. Araştırılan Kaynaklar (URL'lerle)

**GitHub / kod tarafı (doğrudan `gh` CLI ile tarandı):**
- `gh search repos "r-link2 / R-Link 2 / renault navigation"` → **R-Link 2 için ciddi bir
  reverse-engineering / firmware-unpack reposu YOK.** (VERIFIED — kendi aramam)
- MediaNav ekosistemi (R-Link 2 DEĞİL) canlı: `yosicovich/MediaNavMods`,
  `m-a-x-s-e-e-l-i-g/MediaNav-to-Evolution-Upgrade`, `goncalomb/mn4-tools`,
  `m-a-x-s-e-e-l-i-g/LGU-file-tools`.
- `cedricp/ddt4all` (1847★) — Renault ECU/RadNav diagnostic aracı.
- GitHub code search (`"R-Link 2" android`, `rlink2 apk`, `RadNav`) → anlamlı sonuç yok.

**Firmware / format:**
- LGU-file-tools: https://github.com/m-a-x-s-e-e-l-i-g/LGU-file-tools
- WLPK format: https://www.file-extensions.org/wlpk-file-extension ,
  http://en.filedict.com/wlpk-renault-r-link-update-package-23636/
- R-Link 2 update rehberi (paket içeriği): https://www.gps-rlink.com/r-link-2/update-software/ ,
  https://www.gps-rlink.com/r-link-2/r-link-2-install-an-update-yourself/
- 3.3.16.96x sürüm duyurusu: https://www.gps-rlink.com/2018/11/15/r-link-2-the-3-3-16-960-update-is-avalaible-for-download/
- Resmi güncelleme portalı: https://renault-connect.renault.com/renault-easy-connect/mise-a-jour-rlink.html ,
  www.renault-multimedia.com (VIN gerekli)

**Topluluk / developer mode / DDT4All:**
- XDA "How to install app on Rlink2": https://xdaforums.com/t/how-to-install-application-on-the-rlink2.3747529/
- XDA "R-Link Renault infotainment": https://xdaforums.com/t/r-link-renault-infotainment.3913458/
- XDA "R-Link 2 Android Auto": https://xdaforums.com/t/renault-r-link-2-android-auto.3844125/
- Megane4-Forum "R-Link 2 Developer Mode & ddt4all" (120+ sayfa):
  https://www.megane4-forum.de/forum/thread/2132-aktivierung-r-link-2-developer-mode-ddt4all/
- Lisandru DDT4All hacks: https://lisandru.eu/automotive/ddt4all-hacks/r-link-functionalities-activated-by-ddt4all.html
- Bootloader upgrade: https://mhhauto.com/Thread-Renault-R-LINK-2-Bootloader-upgrade
- NetFront HTML5 automotive (ACCESS): https://eu.access-company.com/netfront-html5-platforms-for-automotive.html

> **Kaynak güvenilirlik notu:** XDA/MHH/forum içerikleri WebFetch tarafından 403 ile
> engellendi ve Wayback'te arşivli değildi; bunlardan gelen bilgiler yalnız arama-motoru
> özetleri üzerinden alındı → **UNVERIFIED/UNSUPPORTED** sınıfındadır. GitHub sonuçları
> ve resmi paket-yapısı bilgileri doğrudan doğrulandı.

---

## 4. İndirilen Firmware / Paketler + SHA-256

| Dosya | Boyut | SHA-256 | Kaynak | Sürüm | Durum |
|---|---|---|---|---|---|
| — | — | — | — | — | **İNDİRİLMEDİ** |

**Neden indirilemedi (kanıt):** R-Link 2 firmware'i yalnız Renault EasyConnect /
renault-multimedia.com üzerinden **VIN girilerek**, araca özel, imzalı >600 MB–1 GB ZIP
olarak sunuluyor. Açık, doğrudan indirilebilir 3.3.16.946 paketi bulunamadı. Üçüncü taraf
"free download" bağlantıları (scribd/forum) güvenilir/temiz kaynak sayılmaz ve doğrulanamadı.

- **EXACT MATCH (3.3.16.946):** elde yok.
- **SAME FAMILY (3.3.16.96x/98x):** duyuruları var, dosyası VIN-kapılı.
- **DIFFERENT VERSION:** başka sürüm 3.3.16.946 ile aynı sayılmadı.

---

## 5. Firmware Extraction Sonucu

**YAPILMADI.** Paket indirilemediği için açılamadı.

**Ancak paket YAPISI hakkında doğrulanmış bilgi (birden çok kaynak):** R-Link 2 update USB'sinin
`R-LINK/` klasöründe **üç dosya** bulunur:
- `chain.pem` — sertifika zinciri
- `mm2014_upgrade.lgu` — asıl firmware paketi (`mm2014` = multimedia 2014, LG platform ailesi)
- `mm2014_upgrade.lgu.sig` — **dijital imza dosyası**

> Bu yapı, **imzalı-ve-doğrulanan bir güncelleme zinciri** olduğunun somut kanıtıdır. (SUPPORTED)

**Kritik ayrım:** `m-a-x-s-e-e-l-i-g/LGU-file-tools` aracı **MediaNav (Windows CE 6.0)** LGU'ları
içindir; README R-Link 2'yi kapsamıyor. R-Link 2'nin `.lgu`'su aynı isimli olsa da aynı format
olduğu **doğrulanmadı** (UNKNOWN). Sıfırdan parser yazılmadı (CLAUDE.md minimum-patch + görev
READ-ONLY).

---

## 6. OS / API / ABI

**KANIT DÜZEYİ DÜŞÜK — firmware açılmadığı için build.prop'tan doğrulama YAPILMADI.**

| Alan | İnternet iddiası | Gerçek kanıt |
|---|---|---|
| İşletim sistemi | "Android tabanlı, LG geliştirmesi" | **UNVERIFIED** — forum iddiası |
| Uygulama katmanı | HTML5/WebKit (NetFront/WebLink) sinyalleri | **SUPPORTED** (`.wlpk`=WebLink Package, ACCESS NetFront automotive) |
| Android sürümü | Belirtilmemiş / eski | **UNKNOWN** |
| API level | — | **UNKNOWN** |
| Kernel | Linux (LG platform) muhtemel | **UNKNOWN** |
| CPU/ABI | ARM (automotive SoC) muhtemel | **UNKNOWN** (teardown doğrulanmadı) |
| GPU / OpenGL ES | — | **UNKNOWN** |
| RAM / storage | — | **UNKNOWN** |

> **Önemli:** "Android 4.x" gibi bir ifade **yazılmadı** çünkü firmware'den kanıtlanmadı.
> `.wlpk` (WebLink Package) + `.lge` (LG debug tetikleyici) + NetFront HTML5 automotive
> sinyalleri, R-Link 2'nin **standart açık Android değil, LG'nin kapalı HTML5/WebKit tabanlı
> automotive platformu** olma ihtimalini güçlendiriyor — ama bu **SUPPORTED**, VERIFIED değil.

---

## 7. Android Application Architecture (PackageManager, ActivityManager, SurfaceFlinger …)

**YAPILMADI / UNKNOWN.** `/system/app` listesi, servis envanteri (PackageManagerService,
ActivityManager, WindowManager, SurfaceFlinger, AudioFlinger, MediaServer, LocationManager,
Bluetooth/USB servisleri) **firmware açılmadan çıkarılamaz.** Firmware açılmadığı için bunların
hiçbiri doğrulanmadı. İnternette "Android tabanlı" denmesi bu servislerin standart/erişilebilir
olduğunu kanıtlamaz.

---

## 8. PackageManager / APK Durumu

**Soru: R-Link 2 neden normal APK kurdurmuyor?**

Kanıtların gösterdiği (SUPPORTED):
- Uygulamalar **`.wlpk`** (Renault R-Link Update Package) formatında; standart `.apk` **değil**.
- Kurulum yalnız **yetkili USB/SD + R-Link Toolbox** üzerinden; kullanıcının rastgele APK
  yüklemesine açık bir yol yok.
- Uygulama/firmware **imzalı** (`.sig` + `chain.pem`) → imzasız/whitelist-dışı paket beklenmiyor.

| Kontrol | Sonuç |
|---|---|
| PackageInstaller açık mı? | **UNKNOWN** (firmware yok) |
| `pm` binary var mı? | **UNKNOWN** |
| `adb install` mümkün mü? | **UNVERIFIED** |
| Unknown sources mekanizması | **UNKNOWN** |
| Renault imza zorunluluğu | **SUPPORTED** (`.wlpk`/`.lgu.sig`/`chain.pem`) |
| Whitelist / system-app zorunluluğu | **UNKNOWN** ama muhtemel |

> "İnternette APK yükleniyor yazması" PASS değildir. Gerçek firmware/kod kanıtı olmadan
> APK kurulumu **UNVERIFIED** kalır.

---

## 9. ADB Durumu

- Firmware'de `adbd` aranması **YAPILMADI** (firmware yok).
- Forumlarda "developer mode" ve DDT4All ile bazı menülerin açıldığı iddiaları var
  (UNVERIFIED — WebFetch engelli, yalnız özet).
- Engineering/debug mode'un **`DEBUG/DbgEnable.lge`** dosyasıyla tetiklendiği birden çok
  kaynakta geçiyor (`.lge` = LG Electronics) — ama bu **teşhis menüsü** açar, genel ADB/root
  kabuğu vermez. (SUPPORTED — sınırlı)

> **ADB BINARY EXISTS ≠ ADB ACCESS VERIFIED.** Gerçek cihazda doğrulanmadığı için **VERIFIED
> YAZILMADI.** Bu faz READ-ONLY olduğu ve araca dokunulmadığı için doğrulanamaz.

---

## 10. Security / Signature Mekanizması

**En güçlü doğrulanmış bulgu bloğu (SUPPORTED):**
- Firmware güncellemesi: `chain.pem` (sertifika zinciri) + `.lgu` + `.lgu.sig` (imza).
- Uygulama paketi: `.wlpk` (imzalı Renault paketi).
- Bootloader (5276) için forumlarda **token tabanlı** upgrade süreçlerinden söz ediliyor
  (UNVERIFIED — kanıt zayıf).

| Mekanizma | Durum |
|---|---|
| Update signature verification | **SUPPORTED** (`.sig`+`chain.pem`) |
| Certificate chain | **SUPPORTED** (`chain.pem`) |
| Secure boot zinciri | **UNKNOWN** (kanıt yetersiz) |
| Filesystem writable / repack kabulü | **UNKNOWN** |
| İntegrity/hash kontrolü | **SUPPORTED** (imza dolaylı olarak bütünlük demek) |

> Kanıt yoksa `UNKNOWN` yazıldı; hiçbir güvenlik kontrolü "yok/bypass edilebilir" diye
> **iddia edilmedi.**

---

## 11. Launcher / OEM UI

**UNKNOWN (kod düzeyinde doğrulanmadı).** R-Link launcher'ın üçüncü taraf Activity başlatıp
başlatmadığı, Renault menüsüne kayıt mekanizması firmware olmadan çıkarılamadı.

**OEM fonksiyon kısıtı (mimari gereklilik):** Multi-Sense, klima, PDC/park sensörü, geri görüş
kamerası, direksiyon kumandaları, radyo, araç ayarları R-Link 2'nin **kendi kapalı yazılımına
gömülü** OEM fonksiyonlarıdır. Üçüncü taraf bir uygulama bunları "değiştirmeden yanında
çalışamaz" — çünkü zaten üçüncü taraf tam-ekran uygulama çalıştırma kapısı doğrulanmış değil.
Bu OEM fonksiyonlarının kaybolmaması **kesin bir kısıttır** ve mevcut kanıtlar bu kısıtı
sağlayacak bir entegrasyon noktası göstermiyor.

---

## 12. Display / Touch / GPU

**UNKNOWN.** Ekran ~7" (fiziksel), tam çözünürlük/touch input yolu/OpenGL ES sürümü/hardware
acceleration firmware olmadan doğrulanamadı. MapLibre GL'in gerektirdiği **WebGL** desteğinin
R-Link 2 WebView'ında olup olmadığı **UNKNOWN** — ve CarOS için bu kritik bir belirsizliktir.

---

## 13. Audio / Microphone

**UNKNOWN.** Standart Android `AudioTrack`/`MediaPlayer`/`AudioRecord`/`AudioManager`'ın
erişilebilir olup olmadığı doğrulanamadı. Renault audio routing'in özel servis üzerinden
olması muhtemel (OEM radio/focus). **Mavi için mikrofon erişimi kritik ve şu an UNKNOWN.**

---

## 14. GPS

**UNKNOWN.** R-Link 2 GPS'ine üçüncü tarafın `LocationManager` ile mi yoksa Renault
proprietary servis ile mi erişildiği doğrulanamadı. **CarOS Navigation açısından: GPS erişimi
kanıtlanmamıştır (UNKNOWN).**

---

## 15. USB / Network / Ethernet

**UNKNOWN (fiziksel/servis düzeyinde).** R-Link 2'de USB portu (update/medya için) fiziksel
olarak var; ancak USB üzerinden **veri/soket köprüsü** (USB Ethernet, ADB, localhost socket)
üçüncü taraf koda açık mı — doğrulanamadı. Wi-Fi/BT var (telefon eşleştirme) ama üçüncü taraf
uygulamanın soket açması **UNKNOWN**. Dolayısıyla "R-Link Client ↔ USB/Ethernet ↔ CarOS Compute"
transport'unun mümkünlüğü **UNKNOWN**.

---

## 16. Renault / CAN Interfaces (READ-ONLY)

**Bu faz WRITE yapmadı.** R-Link 2'nin araç CAN'ine erişimi Renault proprietary servis + CAN
gateway üzerindendir (DDT4All'un OBD üzerinden konuştuğu XFB/RadNav ECU'ları bunun kanıtı,
UNVERIFIED-özet). Üçüncü taraf uygulamaya READ-ONLY vehicle property arayüzü sunulup sunulmadığı
**UNKNOWN**. CarOS'un gelecekte R-Link üzerinden READ-ONLY araç verisi alması **kanıtlanmamış**;
bugünkü CarOS OBD yolu (`OBDManager` + usb-serial ELM327) R-Link'ten bağımsızdır.

---

## 17. Mevcut CarOS Pro Compatibility Matrix

CarOS Pro gereksinimleri (repodan **VERIFIED** — doğrudan okundu):

| Gereksinim | CarOS Pro değeri | Kaynak | R-Link 2 karşılığı |
|---|---|---|---|
| Paket tipi | Standart Android **APK** (Capacitor 8) | `android/app/build.gradle` | `.wlpk` bekleniyor → **UYUMSUZ** |
| minSdk | **24** (Android 7.0) | `variables.gradle` | Android sürümü UNKNOWN, muhtemel < 7 → **RİSK** |
| targetSdk / compileSdk | 36 | `variables.gradle` | — |
| ABI | armeabi-v7a, arm64-v8a | `build.gradle` | ARM muhtemel ama UNKNOWN |
| Native libs | Vosk (0.3.47), Media3/ExoPlayer 1.4.1, usb-serial 3.8.0, security-crypto, Firebase msg | `build.gradle` | Tam Android runtime + ART gerekir → **RİSK** |
| WebView | Chrome 52–79 legacy hedefli | `verify-webview-compat.mjs` | R-Link WebView sürümü UNKNOWN |
| Harita | MapLibre GL → **WebGL zorunlu** | `FullMapView.tsx` | R-Link WebGL desteği UNKNOWN → **RİSK** |
| Native plugin | CarLauncherPlugin (launcher/TTS/MediaSession), OBDManager | `android/.../*.java` | Sistem-app yetkileri gerekir → **RİSK** |
| JS runtime | React 19 + Vite | `package.json` | WebView motoruna bağlı |

**Sonuç:** CarOS Pro, açık PackageManager + Android 7+ ART + güncel/WebGL'li WebView + native
`.so` yükleme + sistem-seviyesi launcher yetkisi gerektiren **tam bir Android uygulamasıdır**.
R-Link 2 bunların **hiçbirini üçüncü tarafa açtığı doğrulanmamış**, üstelik `.wlpk` imzalı
paket + imzalı firmware ile ters yöndedir.

---

## 18. CarOS R-Link Client Feasibility

Fikir: R-Link'te yalnız **hafif client** (UI render + touch + audio + mikrofon + OEM UI switch +
network transport), ağır servisler (Nav v3, CEH, Mavi, Music, VDK, Phone Link) harici
**CarOS Compute** cihazında.

**Değerlendirme:** Client "hafif" olsa da hâlâ **R-Link 2 üzerinde üçüncü taraf yerel kod
çalıştırmayı** gerektirir. O kapı (imzasız/whitelist-dışı uygulama kurma + çalıştırma) **açık
olduğu doğrulanmadı**. Kapı açık değilse client'ın ağır/hafif olması fark etmez — hiçbiri
kurulamaz. Ek olarak client'ın ihtiyaç duyduğu WebGL/audio/mikrofon/GPS/socket erişimlerinin
tümü şu an **UNKNOWN**. → **B seçeneği UNKNOWN, teknik engel ağır.**

---

## 19. VERIFIED / SUPPORTED / UNVERIFIED / UNKNOWN / DISPROVEN Tablosu

| # | Bulgu | Etiket |
|---|---|---|
| 1 | GitHub'da R-Link 2 için ciddi firmware-unpack/RE ekosistemi yok (MediaNav'ın aksine) | **VERIFIED** |
| 2 | LGU-file-tools MediaNav/WinCE 6.0 içindir, R-Link 2 değil | **VERIFIED** |
| 3 | CarOS Pro = standart Android APK, minSdk 24, native ARM libs, WebGL zorunlu | **VERIFIED** (repo) |
| 4 | R-Link 2 uygulama formatı `.wlpk`, standart APK değil | **SUPPORTED** |
| 5 | Firmware `.lgu` + `.lgu.sig` + `chain.pem` ile imza/sertifika doğrulamalı | **SUPPORTED** |
| 6 | Kurulum yalnız yetkili USB/SD + R-Link Toolbox, VIN-kapılı portal | **SUPPORTED** |
| 7 | Engineering/debug tetikleyici `.lge` (LG) dosyası, sınırlı teşhis menüsü | **SUPPORTED** |
| 8 | Platform LG geliştirmesi, HTML5/WebKit (NetFront/WebLink) sinyalleri | **SUPPORTED** |
| 9 | R-Link 2 = "Android tabanlı" (kesin sürüm) | **UNVERIFIED** |
| 10 | Bootloader token auth, ADB/root ile APK kurma | **UNVERIFIED** |
| 11 | Android sürümü / API / ABI / GPU / WebGL / GPS / mikrofon erişimi | **UNKNOWN** |
| 12 | Secure boot / repack kabulü / filesystem writable | **UNKNOWN** |
| 13 | Mevcut CarOS Pro APK'nın R-Link 2'de olduğu gibi çalışması | **DISPROVEN** |

---

## 20. Nihai A / B / C Teknik Hükmü

- **A) Mevcut CarOS Pro doğrudan R-Link 2'de çalışır → DISPROVEN.**
  Kanıt: CarOS tam Android APK (minSdk 24, native `.so`, WebGL, sistem launcher) ister;
  R-Link 2 `.wlpk` imzalı paket + imzalı firmware ile kapalıdır ve standart APK kurulumuna
  açık olduğu doğrulanmadı — aksine, formatı ve imza zinciri bunun kapalı olduğunu gösteriyor.

- **B) Hafif CarOS R-Link Client + harici compute → UNKNOWN (teknik engel ağır).**
  Client bile R-Link'te üçüncü taraf yerel kod çalıştırmayı gerektirir; o kapının açıklığı
  kanıtlanmadı. WebGL/audio/mikrofon/GPS/socket erişimleri UNKNOWN.

- **C) Güvenilir üçüncü taraf kod pratik değil; farklı display/compute gerekir → SUPPORTED.**
  Mevcut kanıtların en çok desteklediği sonuç. Renault/LG kapalı, imza-doğrulamalı platform;
  açık kaynak RE ekosistemi yok; kod çalıştırma kapısı doğrulanamadı.

> **Yüzde uydurulmadı.** Kesin kanıt olmayan yerde **UNKNOWN** denildi.

---

## 21. Bir Sonraki EN DÜŞÜK RİSKLİ Deney

**Deney A — Salt-gözlem, araca sıfır yazma (ÖNERİLEN):**
R-Link 2 ekranında **Menu > System > System information** ile görünen tam sürüm/donanım
bilgisini ve (varsa) ekranda görünen üretici/derleme dizesini **fotoğrafla kaydet.** Araca
hiçbir dosya/USB yazılmaz. Amaç: platform/OS ipuçlarını cihazın kendi UI'ından teyit etmek.
Risk: **sıfır** (yalnız okuma-görüntüleme).

**Deney B — Masaüstü, araçtan bağımsız (opsiyonel, orta hazırlık):**
Renault EasyConnect'ten **kendi VIN'inle** 3.3.16.x paketini **PC'ye** indir (araca takma),
`chain.pem`/`.lgu`/`.sig` yapısını ve `.lgu`'nun sihirli baytlarını (`binwalk`, `file`, hexdump)
**salt-oku analiz et.** Bu, FAZ 3–9'u gerçek kanıtla dolduracak tek güvenli yoldur. Araca
**hiçbir şey yazılmaz.** Risk: düşük (yalnız PC'de statik analiz).

> **B'ye geçmeden önce:** bu, CarOS'un ana risk/geri-dönüş oranı düşük bir yatırımdır —
> çünkü sonuç muhtemelen "C" hükmünü pekiştirecek. Karar kullanıcıya aittir.

---

### KANIT DİSİPLİNİ ÖZETİ (bu raporda ne YAPILMADI)

- Firmware **indirilmedi** → extraction, build.prop analizi, `/system/app`, ODEX/DEX
  decompile, `adbd` arama **YAPILMADI** (FAZ 3–9'un kanıt kısmı boş, dürüstçe işaretli).
- Gerçek cihazda **hiçbir test yapılmadı** → hiçbir yere "DEVICE VERIFIED" yazılmadı.
- Fiziksel R-Link 2'ye **hiçbir yazma işlemi yapılmadı.**
- Elde kesin kanıt olmayan her yerde **UNKNOWN** kullanıldı; UNKNOWN hiçbir yerde VERIFIED'a
  yükseltilmedi.
