# CarOS Pro — R-Link 2 Custom / Patched Firmware Derin Araştırması

> **Devam belgesi.** Baseline: `CAROS_RLINK2_REVERSE_ENGINEERING_REPORT.md`.
> **Faz durumu:** READ-ONLY masaüstü OSINT + statik analiz. Fiziksel araca/R-Link'e
> **hiçbir flash / update / ADB / DDT4All-write / developer-mode değişikliği yapılmadı.**
> **Tarih:** 2026-09-16 · **Araç:** Renault Megane 4 (2017), R-Link 2 7", SW 3.3.16.946, boot 5276
>
> **⤷ TUR 2 EKİ (aynı gün):** Archive.org 503'ünden sonra alternatif kaynaklarla derin
> artefact araştırması yapıldı. Yeni bulgular **§19'da** ("TUR 2 — Derin Artefact Araştırması").
> Aşağıdaki Tur-1 bulguları **korunmuştur**; yalnız nüans gereken yerler §19'da güncellenmiştir.
> Tur-2'nin NİHAİ cevabı **değişmedi** (aşağıdaki §0 geçerli), ama artık **gerçek indirilen +
> READ-ONLY açılan bir R-Link 2 ekosistem artefact'ı** ile de destekleniyor.

---

## 0. Cevaplanacak TEK soru (en başta net cevap)

**"Bugün elimizdeki kanıtlara göre, Renault Megane 4'ün orijinal R-Link 2 ekranında Android
Auto kullanmadan kendi CarOS yazılımımızı çalıştırmak için GERÇEK bir teknik yol bulundu mu?"**

> **HAYIR — bulunamadı.** (Bu fazdaki kanıt düzeyi: **SUPPORTED**, çoklu bağımsız kaynak +
> statik doğrulama.)
>
> Dünya çapında (İngilizce, Rusça, Almanca kaynaklar dâhil) R-Link 2 üzerinde bugüne kadar
> ulaşılan **en ileri çalışan modifikasyon**, resmi imzalı firmware sürümleri arası geçiş +
> DDT4All/engineering-menü ile **hazır özellik açma** (video-in-motion, klima göstergesi,
> Android Auto aktivasyonu, geri görüş kamerası) ile **sınırlıdır**. Bu, **arbitrary /
> user-supplied code execution DEĞİLDİR**.
>
> **Eksik olan teknik kapı:** R-Link 2'de imzasız/whitelist-dışı bir uygulamayı **kuracak ve
> çalıştıracak** bir yol (installer/PackageInstaller, kalıcı shell veya unsigned uygulama
> yükleyici) **açık değildir**. En somut kanıt: bir kullanıcı APK'yı cihaza **kopyalayabildi**
> ama **"fehlenden Installer" (kurulum programı yok)** olduğu için **kuramadı** (Almanca forum,
> Haziran 2018 — aşağıda). O günden beri (7+ yıl) "kurabildik/çalıştırdık" diyen doğrulanmış
> tek kanıt bile çıkmadı.

---

## 1. Önceki Araştırmanın Baseline'ı

Önceki rapordan taşınan ve bu fazda **değişmeyen** sonuçlar:
- CarOS Pro = tam Android APK (Capacitor 8, minSdk 24, native ARM libs, WebGL zorunlu). → **VERIFIED**
- Doğrudan çalışma (Seçenek A) → **DISPROVEN**. (Bu fazda tekrar araştırılmadı; teyit edildi.)
- R-Link 2 uygulama formatı `.wlpk`, firmware `.lgu`+`.lgu.sig`+`chain.pem` (imzalı). → **SUPPORTED**
- Engineering/debug tetikleyici `.lge` (LG). → **SUPPORTED**

Bu faz **B seçeneğine** (herhangi bir execution environment açılmış mı?) odaklandı.

---

## 2. Çok Dilli Araştırma Kapsamı

| Dil | Ana kaynaklar | Erişim |
|---|---|---|
| İngilizce | XDA, Renault/Kadjar forumları, GitHub, b4x, e-guide.renault.com | Kısmi (XDA 403; GitHub tam) |
| **Rusça** | **DRIVE2** (Talisman "Всё о R-Link2 и прошивках"), **Club-Renault** (83495, "Неофициальные доработки", 43 abone, 2017→2023, 69. sayfa), **4PDA** (769531) | **Tam (curl ile indirildi)** |
| **Almanca** | **megane4-forum.de** (thread 2132, developer mode), **kadjar-forum.de** (2421), scenic4-forum.de | **Tam (curl ile indirildi)** |
| Fransızca | gps-rlink.com, renault-forum | Kısmi |
| İtalyanca/Lehçe/Romence/Ukraynaca | Menaco (İT), forum kırıntıları | Sınırlı sonuç |

**Doğrudan indirilen ve statik olarak parse edilen sayfalar (VERIFIED — dosya elde):**
`drive2_all.html` (222 KB), `clubrenault69.html` (771 KB), `4pda340.html` (272 KB),
`de_dev1.html` (megane4, 107 KB), `de_kadjar.html` (122 KB). Metin çıkarımı yapıldı.

> **Not:** XDA WebFetch'te 403; Wayback bu fazda **503 (Internet Archive geçici offline)** —
> `.wlpk` örneği ve XDA arşivi bu nedenle alınamadı. Dürüstçe: **UNKNOWN/erişilemedi.**

---

## 3. Bulunan Tüm Ciddi R-Link 2 Modları (Aday Envanteri)

| Mod / yaklaşım | Kaynak/dil | R-Link nesli | Ne sağlıyor? | Arbitrary code? |
|---|---|---|---|---|
| Resmi firmware sürüm geçişi (2→3→7→8→9, `mm2014_upgrade_*_original`) | RU (Club-Renault, DRIVE2) | R-Link 2 | Sürüm/özellik yükseltme, **imzalı resmi paket** | **HAYIR** |
| DDT4All / RadNav config (XFB Megane IV) | EN/DE/RU | R-Link 2 | Video-in-motion, klima göstergesi, AA aktivasyonu, VR | **HAYIR** (config) |
| DbgEnable.lge engineering/debug menü | EN/DE/RU | R-Link 2 | Dil, sistem bilgisi (GEN), sınırlı debug menü | **HAYIR** |
| APK'yı cihaz belleğine kopyalama (BT/USB) | DE (megane4 #6/#10) | R-Link 2 | Dosya transferi olur, **kurulum OLMAZ** (installer yok) | **HAYIR (DISPROVEN)** |
| Gen2/Gen3 blok + USB portu takma | RU (DRIVE2) | R-Link 2 | CarPlay/AA — **donanım değişimi**, yazılım hack'i değil | Konu dışı |

**Sonuç:** Adayların **hiçbiri** kullanıcının kendi yazdığı programı çalıştırmıyor.

---

## 4. MediaNav / R-Link 1 False-Positive'leri (elenler)

| Aday | Gerçekte ne? | Etiket |
|---|---|---|
| **Menaco / Men@co / Menavrus** | MediaNav (WinCE) yazılım paketi | **NOT APPLICABLE — MEDIANAV** |
| **Supermod (Favre/Fredy)** | MediaNav skin/foto-video modu | **NOT APPLICABLE — MEDIANAV** |
| **LGU-file-tools, MediaNavMods, mn4-tools** | MediaNav/WinCE 6.0 | **NOT APPLICABLE — MEDIANAV** |
| **"Open R-Link" / R-Link Store SDK** | R-Link **1** (TomTom/Android nesli) çevresi | **NOT APPLICABLE — R-LINK 1** |
| XDA "developer mode (android, tomtom)" | "R-Link multimedia works on Android interface **by TomTom**" = R-Link 1 | **NOT APPLICABLE — R-LINK 1** |

> **Kritik:** R-Link 1 (TomTom, gerçek Android, ADB denemeleri) ile R-Link 2 (LG platformu,
> `.wlpk`/`.lgu`) sık karıştırılıyor. R-Link 1'e ait hiçbir bulgu R-Link 2 için PASS sayılmadı.

---

## 5. En Gelişmiş Gerçek R-Link 2 Modifikasyonları

**En ileri doğrulanmış nokta:** Resmi imzalı `mm2014_upgrade_*_original` paketleriyle sürüm
yükseltme + `content`/`igo`/`lang` partition dosyalarıyla oynama (harita/dil) + DDT4All ile
feature-unlock. Bunların tümü **Renault'nun kendi imzalı paketleri ve config arayüzleri**
içinde kalıyor.

**Bootloader (bizim: 5276):** Rusça toplulukta net — bootloader güncellemek **"дилерский
прибор с доступом к серверу Рено"** (Renault sunucusuna erişimli **bayi cihazı**) gerektiriyor
(ör. 5446→5615). Yani bootloader zinciri kapalı/token-korumalı. (SUPPORTED)

---

## 6. İndirilen Paketler + SHA-256

| Dosya | Tür | Durum |
|---|---|---|
| — (firmware `.lgu`) | R-Link 2 firmware | **İNDİRİLMEDİ** (VIN-kapılı resmi portal) |
| — (`.wlpk` örneği) | R-Link Store app | **İNDİRİLMEDİ** (mağaza kapalı/imzalı; Archive.org bu fazda 503 offline) |
| drive2_all.html / clubrenault69.html / 4pda340.html / de_dev1.html / de_kadjar.html | HTML kanıt | **İNDİRİLDİ + parse edildi** (statik metin analizi) |

> **Dürüstlük:** Bu fazda hiçbir firmware/`.wlpk` binary'si indirilmedi → binary/static
> firmware analizi **YAPILMADI**. Yalnız HTML kaynaklar indirilip parse edildi.

---

## 7. Paket İçi Analiz

**YAPILMADI** (firmware/`.wlpk` binary elde yok). Baseline'dan doğrulanan paket-yapısı bilgisi
(`chain.pem`+`.lgu`+`.lgu.sig`) geçerliliğini koruyor. Rusça forumdan ek partition kanıtı:
`content` (harita/dil), `igo` (navigasyon + 8/9'da sözlükler), `lang` klasörü — bunlar
**resmi imzalı paketlerle** yazılıyor.

---

## 8. WLPK / WebLink Araştırması

- `.wlpk` = "Renault R-Link Update Package"; R-Link **Store** üzerinden satın alınıp yetkili
  USB/SD + R-Link Toolbox ile kuruluyor (imzalı, kapalı dağıtım). (SUPPORTED)
- **Gerçek `.wlpk` örneği indirilemedi** (mağaza kapalı; Archive.org 503). → manifest/HTML/JS/
  imza/native-bridge içeriği **UNKNOWN**.
- "Kendi CarOS R-Link Client'ımızı aynı application modelinde yapabilir miyiz?" sorusu **şu an
  cevaplanamıyor** çünkü: (a) `.wlpk` gerçekten HTML5/JS mı yoksa imzalı native mi UNKNOWN,
  (b) üçüncü tarafın imzalı `.wlpk` üretip mağaza-dışı kurabileceği bir yol **kanıtlanmadı**.
  Kanıt olmadan bu **UNKNOWN**, iyimser varsayım yapılmadı.

---

## 9. SDK / Developer Documentation

- **R-Link 2 için açık bir SDK / developer portal / sample app bulunamadı** (Wayback bu fazda
  offline; canlı web'de yok). → **UNKNOWN/negatif**.
- "Open R-Link" (R-Link 1 dönemi) tartışmalarında bile geliştiriciler net söylüyor: *"Don't
  think that will give you SDK... or an api to get values of sensors"* — yani **sensör/araç
  API'si yok**, yalnız müzik/mesajlaşma tarzı kısıtlı uygulamalar. (b4x forum, SUPPORTED)
- **GitHub taraması (doğrudan `gh`):** `rlink2 firmware`, `renault rlink root`, `wlpk`,
  `r-link store app`, `mm2014 lgu`, `rlinkstore` → **R-Link 2'ye ait anlamlı hiçbir repo YOK.**
  (VERIFIED — kendi aramam)

---

## 10. DbgEnable.lge

**Aktivasyon (çoklu kaynak, SUPPORTED):** FAT32 USB → `DEBUG/` klasörü → **0 byte**
`DbgEnable.lge` → Menu>Multimedia>Settings>Photos, 30-45 sn bekle → dokunmatik jest.

**Gerçekte ne açıyor (kanıt):**
- Engineering/debug **menü**: GEN tespiti, dil, sistem bilgisi, bazı ayarlar. (SUPPORTED)
- Almanca forumda **"der Zugriff funktioniert"** + APK'yı cihaza gönderebilme, **ama**
  **"wegen fehlenden Installer aktuell noch nichts bringt"** (kurulum programı olmadığı için
  işe yaramıyor). → dosya erişimi kısmen var, **execution/install yok**. (SUPPORTED)

**Açmadığı (kanıt bulunamadı → iddia edilmedi):** kalıcı root shell, genel ADB erişimi,
imzasız uygulama installer'ı, tam filesystem yazma. "debug" kelimesine bakılıp root
**varsayılmadı**. → **UNKNOWN/negatif**.

---

## 11. Firmware Security — Mod'lar imzayı nasıl aşıyor?

Kanıtların cevabı **net**: **aşmıyorlar.**

- En aktif topluluk (RU) yalnız **Renault'nun kendi imzalı `_original` `.lgu` paketlerini**
  kullanıyor. Custom/unsigned firmware, imza-bypass, bootloader-exploit **kanıtı yok**.
- Bootloader güncellemesi **bayi + Renault sunucusu** gerektiriyor (token/imza kapısı).
- Yapılan "mod"lar aslında: (a) resmi imzalı sürüm geçişi, (b) DDT4All ile **config/parametre**
  değişikliği (firmware'in kendisi değişmiyor), (c) imzalı paketler içinde `content`/`lang`
  dosya oynaması.

Liste üzerinden hüküm:
- imza hiç bypass edilmiyor → **DOĞRU (SUPPORTED)**
- yalnız config/parametre değişiyor (DDT4All) → **DOĞRU (SUPPORTED)**
- resmi signed firmware kullanılıyor → **DOĞRU (SUPPORTED)**
- bootloader exploit / unsigned partition / imza-bypass → **kanıt YOK (DISPROVEN/UNKNOWN)**

---

## 12. Arbitrary Code Execution Kanıtları

| Yol | Durum | Kanıt |
|---|---|---|
| APK kurma | **DISPROVEN** | "fehlenden Installer" — kopyalanıyor, kurulmuyor (DE 2018) |
| Native ARM binary çalıştırma | **UNKNOWN/negatif** | Kalıcı shell kanıtı yok |
| HTML5/JS custom app (WLPK modeli) | **UNKNOWN** | `.wlpk` içi ve mağaza-dışı kurulum kanıtlanmadı |
| Java / custom service / daemon / launcher | **UNKNOWN/negatif** | Hiçbir kaynakta çalışan örnek yok |
| Custom process persistence | **UNKNOWN/negatif** | Yok |

> **Toplu hüküm:** R-Link 2'de kullanıcı-kaynaklı kod çalıştıran **doğrulanmış bir yol yok.**

---

## 13. Kullanıcı Deneyimleri (tarihli, birincil-yakın)

- **DE, megane4-forum #6 (Haz 2018):** "der Zugriff funktioniert" — erişim çalıştı; APK cihaza
  gönderildi. #? : **"wegen fehlenden Installer ... nichts bringt"** — installer yok, kurulmadı.
- **DE, kadjar-forum:** çalışan değişiklikler = sürüşte video/foto oynatma (#20), klima ayar
  göstergesi (#614), Android Auto aktivasyonu (v3+, #470), geri görüş kamerası (#104, **ek
  parça montajı** gerektiriyor). Hepsi feature-unlock.
- **RU, Club-Renault (Eyl 2023):** sürüm geçişlerinde `content` partition bozulması, kurtarma
  için yine **resmi `_original` paketler** deneniyor; bootloader için **bayi cihazı** şart.
- **RU, DRIVE2:** yüksek sürümler (7/8/9) ve CarPlay/AA çoğu zaman **Gen2/Gen3 donanım +
  USB portu** gerektiriyor → küçük 7" ekranda üst sürümün anlamı sınırlı.

> Tek kullanıcı iddiası genel gerçek sayılmadı; hepsi feature-unlock/sürüm-geçişi temasında
> **tutarlı**. "Kendi kodumu çalıştırdım" diyen doğrulanmış kullanıcı **yok**.

---

## 14. CarOS Compatibility (bu fazın kattığı)

Değişmedi: CarOS Pro tam Android runtime + APK installer + WebGL + native `.so` istiyor.
R-Link 2 bunların hiçbirini üçüncü tarafa açmıyor; üstelik **installer yokluğu** APK yolunu
doğrudan kapatıyor. → **A: DISPROVEN** (teyit).

---

## 15. CarOS R-Link Client Feasibility

Client (UI+touch+audio+network transport) fikri hâlâ **R-Link 2'de üçüncü taraf kod çalıştırmayı**
gerektiriyor. Bu fazın kanıtı: o kapı (installer/shell/unsigned-app) **açık değil**. Dolayısıyla
client'ın "hafif" olması durumu değiştirmiyor. → **B: UNKNOWN, teknik engel doğrulanmış biçimde
ağır** (yalnız `.wlpk` HTML5-modeli teorik bir umut ama kanıtsız → UNKNOWN).

---

## 16. Exact 3.3.16.946 / boot 5276 Uyumluluğu

- 3.3.16.946, **3.3.16.9xx (Gen1/küçük ekran)** ailesinde. Rusça topluluk verisiyle: bu aile
  düşük-sürüm, üst sürümler (7/8/9) çoğunlukla Gen2/Gen3 donanım ister. (SUPPORTED)
- Boot 5276: bootloader güncellemesi bayi+sunucu kapılı; bizim faz zaten **hiçbir şey
  yazmıyor**. Bu sürüme özel bir custom-code açığı **bulunamadı** (UNKNOWN/negatif).

---

## 17. Bilinmeyenler (dürüst UNKNOWN listesi)

- `.wlpk` gerçek iç yapısı (HTML5/JS mi, imzalı native mi) — **UNKNOWN** (örnek indirilemedi).
- R-Link 2 tam OS/kernel/Android-sürümü — **UNKNOWN** (firmware açılmadı).
- DbgEnable sonrası filesystem yazma sınırı / gizli installer yolu — **UNKNOWN**.
- Mağaza-dışı imzalı `.wlpk` üretip kurma imkânı — **UNKNOWN** (muhtemelen imza kapılı).
- Wayback offline olduğu için XDA/eski SDK arşivleri — **erişilemedi**.

---

## 18. En Düşük Riskli Sonraki Deney

**Deney 1 — Sıfır-yazma gözlem (ÖNERİLEN, risk: yok):**
R-Link ekranında **System information** ekranını fotoğrafla; GEN (Gen1/2/3), tam SW/HW
sürümünü teyit et. Gen1 ise üst-sürüm/CarPlay yolunun zaten donanım-kapılı olduğu doğrulanır.

**Deney 2 — Masaüstü, araçtan bağımsız (risk: düşük):**
Internet Archive tekrar çevrimiçi olunca **eski bir ücretsiz `.wlpk`** (ör. R-Link Store örnek
app) **PC'ye** indirip `binwalk`/`unzip`/`file` ile **salt-oku** aç. `.wlpk` HTML5/JS mi diye
bak. Bu, tek "umut" olan WebLink-modeli sorusunu kanıtla cevaplar. Araca **hiçbir şey yazılmaz**.

**Deney 3 — (yalnız kullanıcı isterse, bu faz kapsamı dışı):** kendi VIN'inle resmi 3.3.16.x
`.lgu`'yu PC'ye indirip statik analiz. Yine araca yazma yok.

> Uyarı: 2 ve 3 muhtemelen "kod çalıştırma kapısı kapalı" hükmünü **pekiştirecektir**;
> düşük maliyetli oldukları için yine de değerlidir. Karar kullanıcıya aittir.

---

## VERIFIED / SUPPORTED / UNVERIFIED / UNKNOWN / DISPROVEN — Özet

| # | İddia | Etiket |
|---|---|---|
| 1 | GitHub'da R-Link 2 firmware/root/custom-code reposu yok | **VERIFIED** |
| 2 | RU topluluğu yalnız resmi imzalı `_original` firmware kullanıyor | **SUPPORTED** |
| 3 | Bootloader güncelleme bayi+Renault sunucusu gerektiriyor | **SUPPORTED** |
| 4 | DbgEnable.lge = engineering/debug menü + feature toggle | **SUPPORTED** |
| 5 | APK cihaza kopyalanıyor ama installer yok → kurulmuyor | **SUPPORTED** |
| 6 | Menaco/Menavrus/Supermod = MediaNav (R-Link 2 değil) | **VERIFIED** (repo/README) |
| 7 | "Open R-Link"/R-Link 1 = TomTom/Android, ayrı sistem | **SUPPORTED** |
| 8 | R-Link 2 için açık SDK / sensör API yok | **SUPPORTED** |
| 9 | Firmware imzası bypass ediliyor | **DISPROVEN** (kimse etmiyor) |
| 10 | Arbitrary/user-supplied code execution mevcut | **DISPROVEN / UNKNOWN** |
| 11 | Mevcut CarOS Pro APK doğrudan çalışır | **DISPROVEN** (baseline teyit) |
| 12 | `.wlpk` HTML5/JS modeliyle client yapılabilir | **UNKNOWN** |
| 13 | R-Link 2 OS/kernel/`.wlpk` iç yapısı | **UNKNOWN** |

---

### Dürüstlük Disiplini — bu raporda ne YAPILMADI

- Hiçbir firmware/`.wlpk` binary'si **indirilmedi** → binary/static firmware analizi **YAPILMADI**.
- Wayback offline (503) → XDA arşivi ve gerçek `.wlpk` **alınamadı** (erişilemedi denildi).
- Fiziksel R-Link 2'ye **hiçbir yazma/flash/ADB/DDT4All-write yapılmadı.**
- Forum iddiaları **UNVERIFIED/SUPPORTED** kaldı; hiçbiri VERIFIED'a yükseltilmedi.
- MediaNav ve R-Link 1 bulguları R-Link 2 için PASS **sayılmadı**.
- Kanıt olmayan yerde **UNKNOWN** yazıldı; istenen cevaba göre şişirme yapılmadı.

---

## 19. TUR 2 — Derin Artefact Araştırması (Archive.org 503 sonrası, alternatif kaynaklar)

Archive.org tek başına 503 verdi diye durulmadı. Alternatif kaynaklara geçildi; **Wayback CDX
API sonradan erişilebilir hale geldi** ve kullanıldı. Bu turda önceki bulgular değişmedi;
**bir kısmı VERIFIED'a yükseldi ve bir kısmı nüanslandı.**

### 19.1 GitHub — genişletilmiş CODE + REPO search (repo adı değil, içerik string'i)

Doğrudan `gh search code` ile aranan string'ler → **hepsi 0 sonuç:**
`DbgEnable.lge`, `mm2014_upgrade`, `chain.pem RLink`, `R-Link wlpk`, `NetFront WebLink`,
`LANR renault`, `.lgu.sig`. Ayrıca repo aramaları (`SKU Creator rlink`, `rlink igo sku`,
`renault rlink lgu tool`, `rlink2 tool`) → **0.**
> **Hüküm:** GitHub/GitLab'da R-Link 2 firmware/root/custom-code/`.wlpk`/`.lgu`-imza artefact'ı
> **kapsamlı içerik-aramasıyla da bulunamadı.** → **VERIFIED (NOT FOUND AFTER SEARCH).**
> (SKU Creator gibi araçlar GitHub'da değil; kapalı, login-gated forumlarda dağıtılıyor.)

### 19.2 R-Link Store (`rlinkstore.com`) — tam Wayback CDX envanteri

`rlinkstore.com` domain'inin **3445 arşiv snapshot'ı** çekildi ve mimetype dağılımı çıkarıldı:
2671 HTML, JS/CSS/resim/font, **yalnız 6 PDF (EULA/GTC yasal metinler), 2 octet-stream (web
font)** — **sıfır `.wlpk`, sıfır `.lgu`.** Güncellemeler VIN-hash'li URL'lerle korunuyor
(`/vehicle/<64-hex-hash>/manage/updates/devices`).
> **Hüküm:** `.wlpk` uygulama paketleri **public web'de yayınlanmıyor**; R-Link Store yalnız
> vitrin, paketler **authenticated/VIN-kapılı backend'den araca** teslim ediliyor. → **SUPPORTED
> (güçlü).** Gerçek `.wlpk` bu nedenle indirilemedi → **`.wlpk` = NOT FOUND AFTER SEARCH.**

### 19.3 EN ÖNEMLİ YENİ BULGU — iGO partition unlock + SKU Creator (custom content zinciri)

Rusça (Club-Renault forum ilk sayfası, curl ile indirildi) + Fransızca/İngilizce (navitotal,
autohacking, motorcarsoft, gpspower) kaynaklardan **tutarlı ve teknik** bir zincir doğrulandı:

1. **iGO partition "unlock patch"** mevcut. Her firmware sürümü için ayrı: dosya adları
   `partition_igo_patch_radars_remove_message-N`, `mm2014_upgrade_igo_XXXXXXX_patched`,
   `mm2014_upgrade_igo_XXXXXXX_original` (geri dönüş). USB kökündeki `R-LINK/` klasörüyle,
   **"like any official update of the R-Link 2"** ifadesiyle — yani **resmi update mekanizması
   üzerinden** kuruluyor. (VERIFIED — çoklu kaynak + araç mevcut)
2. **SKU Creator** (v0.1→v0.5.2, 2019-2020): iGO dosyalarından (harita, POI, bina, speedcam)
   **kendi "content" paketinizi** oluşturan bir **PC aracı**. "content" klasörünü uyumlu hale
   getirip **kurulmaya hazır SKU arşivi (iGO formatı)** üretiyor. Ayrıca **"R-Link 2 fingerprint
   decryption"** modülüyle cihaz içeriğini görüntüleyip silebiliyor.
3. **Ön koşul (aynen alıntı):** *"to be able to install your own content, it's mandatory to
   **patch the iGO partition** of your R-LINK 2 in order to **unlock** it."*
4. Rus topluluğu **`.lgu` yeniden paketleme (перепаковка lgu)** teknolojisine sahip — ama
   **yalnız `igo` partition'ı için** ("готов передать всю технологию перепаковки lgu для раздела
   igo"). MD5 ile bütünlük kontrol ediliyor (`mm2014_upgrade.lgu`).

**Bunun CarOS için anlamı — kritik ayrım:**
- Bu, **custom içerik enjeksiyonunun VERIFIED olduğu** ilk somut kanıt. AMA enjekte edilen şey
  **yalnız iGO navigasyon VERİSİ** (harita/POI/bina/speedcam/skin/lisans). iGO uygulaması bunu
  **veri olarak okur**; kullanıcının koyduğu bir **executable/HTML5/native kod DEĞİLDİR**.
- Yani "iGO partition unlock" ≠ "arbitrary code execution". Kendi CarOS kodumuzu bu partition'a
  koyup **çalıştıramayız**; oraya konulan dosyalar iGO'nun kapalı motorunca yorumlanan
  navigasyon içeriğidir. → **arbitrary code execution hâlâ DISPROVEN/UNKNOWN.**

### 19.4 Gerçek artefact — İNDİRİLDİ + READ-ONLY AÇILDI

| Alan | Değer |
|---|---|
| Dosya | `iGOLicenseViewer-native.zip` |
| Boyut | 37.401.427 bayt (37.4 MB) |
| SHA-256 | `c79992ab0b7442b842184bb88b34426e1e12ea107ee6e4399449f6a3b3d43e61` |
| Kaynak | Google Drive (Club-Renault forumunda paylaşılan mirror) |
| Tarih | 2018-05-21 (iç dosya damgaları) |
| Aidiyet | R-Link 2 iGO **lisans/fingerprint görüntüleyici** (SKU Creator ekosistemi yardımcı aracı) |

**READ-ONLY analiz (unzip -l + strings, çalıştırılmadı):** İçerik = `iGOLicenseViewer.exe`
(2.6 MB) + bir **Excelsior JET ile native'e derlenmiş Java runtime** (`rt/` altında JRE
DLL/jar'ları). Uygulama mantığı JET ile `.exe`/`X*.dll`'lere gömülü (bytecode şifreli →
düz string çıkmadı, bu beklenen).
> **Kanıtladığı:** R-Link 2 topluluk **araç ekosistemi tamamen iGO navigasyon
> lisansı/haritası/POI'si etrafında dönüyor** — kod-çalıştırma aracı değil. Bu, §19.3 hükmünü
> bağımsız olarak destekliyor. → **VERIFIED (indirilen + açılan artefact).**
> **Dürüstlük:** `.exe` JET-şifreli olduğundan iç mantığı decompile **edilmedi**; yalnız paket
> yapısı ve amacı doğrulandı. Araç **çalıştırılmadı**.

### 19.5 Bootloader (bizim: 5276) — ek teknik kaynak

CarMasters (Rus oto-usta forumu, Oca 2024): *"возможно ли поднять версию загрузчика **(micom)**
магнитолы R-Link 2 в домашних условиях?"* — bootloader burada **micom** olarak adlandırılıyor;
evde yükseltilip yükseltilemeyeceği **açık soru** olarak kalmış (cevap doğrulanamadı). Club-Renault:
bootloader güncellemesi **bayi cihazı + Renault sunucusu** gerektiriyor (5446→5615 örneği).
→ bootloader zinciri **kapalı/token-korumalı (SUPPORTED)**; ev-tipi yükseltme **UNKNOWN**.

### 19.6 Elenen / doğrulanan false-positive'ler (Tur 2)

- **Menaco / Menavrus / Supermod** = MediaNav → **NOT APPLICABLE — MEDIANAV** (teyit).
- **LGU-file-tools (GitHub)** = MediaNav/**WinCE 6.0** → R-Link 2 `.lgu`'suyla aynı olduğu
  **doğrulanmadı** (R-Link 2 tarafı Rus topluluğunun ayrı "igo repack" teknolojisi).
- **"Open R-Link" / R-Link Store SDK** = R-Link 1 (TomTom/Android) çevresi; **sensör/araç API
  yok** → **NOT APPLICABLE — R-LINK 1** (teyit).

### 19.7 Tur 2 — Etiket güncellemeleri (Tur 1 tablosuna ek/nüans)

| İddia | Tur 1 | Tur 2 (güncel) |
|---|---|---|
| GitHub'da R-Link 2 custom-code/`.wlpk` artefact'ı yok | VERIFIED (repo) | **VERIFIED** (repo **+ code search**) |
| `.wlpk` public web'de bulunur | — | **DISPROVEN / NOT FOUND** (rlinkstore CDX: 3445 snapshot, 0 `.wlpk`) |
| iGO partition'a custom **içerik** kurulabilir | (data patch olasılığı) | **VERIFIED** (unlock patch + SKU Creator) |
| iGO partition'a custom **kod** çalıştırılabilir | UNKNOWN | **UNKNOWN/DISPROVEN** (içerik = veri, kod değil) |
| Firmware imzası bypass ediliyor | DISPROVEN | **Nüans:** system/executable için **kanıt yok (DISPROVEN)**; iGO **data** partition'ı için topluluk-yapımı patch resmi update yoluyla kuruluyor, kesin imza mekanizması **UNKNOWN** |
| Gerçek R-Link 2 ekosistem artefact'ı elde edildi | — | **VERIFIED** (`iGOLicenseViewer`, SHA-256, açıldı) |

### 19.8 Tur 2 — Çıkış kriteri değerlendirmesi

- **A (gerçek artefact bulundu + READ-ONLY analiz):** **KISMEN karşılandı** — gerçek bir R-Link 2
  iGO ekosistem aracı indirildi + açıldı (§19.4). Ancak bu bir **`.wlpk`/custom-firmware/kod
  artefact'ı değil**, iGO lisans aracı.
- **B (kapsamlı çok-dilli aramaya rağmen artefact yok → NOT FOUND):** **`.wlpk` ve
  arbitrary-code artefact'ı için karşılandı.** Aranan kaynaklar: GitHub code+repo search (11
  sorgu), rlinkstore.com tam CDX (3445 snapshot), RU (Club-Renault, DRIVE2, 4PDA, CarMasters),
  DE (megane4/kadjar/scenic4-forum), FR/EN (navitotal, autohacking, motorcarsoft, gpspower,
  b4x), file-extension veritabanları. → **`.wlpk` = NOT FOUND AFTER SEARCH; custom-code
  environment = NOT FOUND AFTER SEARCH.**

### 19.9 Tur 2 — NİHAİ CEVAP (değişmedi, güçlendi)

R-Link 2'de bugüne kadar ulaşılan **en ileri gerçek modifikasyon**, **iGO navigasyon partition'ının
kilidini açıp SKU Creator ile özel harita/POI içeriği kurmak** + DDT4All ile feature-unlock'tur.
Bunların **hiçbiri kullanıcı-kaynaklı kod (native/HTML5/JS/APK/servis) çalıştırmaz.** CarOS'un
(ya da hafif bir "R-Link Client"ın) ihtiyaç duyduğu **execution environment R-Link 2'de hâlâ
açık değildir.** → **Android Auto'suz, R-Link 2 üzerinde kendi CarOS kodumuzu çalıştırmanın
gerçek bir teknik yolu bu turda da BULUNAMADI.**

### 19.10 Tur 2 — En düşük riskli sonraki deney (güncel)

Araca **sıfır yazma**: Internet Archive tamamen stabilize olunca (Wayback CDX çalışıyor,
snapshot indirme henüz kısmen 503) bir **iGO unlock patch'inin `mm2014_upgrade.lgu`'sunu** PC'ye
indirip `binwalk`/`unzip`/`file`/`hexdump` ile **salt-oku** açmak → `.lgu` container formatını
ve (varsa) imza/şifre başlığını **VERIFIED** belgeler. Alternatif: login-gated forumlara (gpspower/
navitotal) kayıtla SKU Creator aracının kendisini indirip **statik** (çalıştırmadan) incelemek.
Her iki yol da **araca hiçbir şey yazmaz.**

> **Tur 2 dürüstlük:** `.wlpk` **indirilmedi** (public'te yok). iGO unlock patch `.lgu`'su bu
> turda **indirilmedi** (login-gated / büyük harita + Wayback snapshot indirme kısmen 503). Elde
> edilip açılan **tek gerçek binary** `iGOLicenseViewer-native.zip`'tir; o da **çalıştırılmadı**,
> JET-şifreli olduğu için decompile **edilmedi**. Fiziksel R-Link 2'ye **hiçbir şey yazılmadı.**
