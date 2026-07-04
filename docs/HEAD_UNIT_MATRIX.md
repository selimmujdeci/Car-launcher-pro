# HEAD UNIT MATRİSİ — CarOS Pro Cihaz Uyumluluk Haritası

> **Amaç:** CarOS Pro tek bir ünitede değil, Çin aftermarket Android head unit
> ekosisteminin TAMAMINDA çalışmalı. Bu doküman ekosistemin donanım/yazılım
> haritasını ve uygulamanın buna göre verdiği mühendislik kararlarını tutar.
> Yeni bir cihaz sınıfı öğrenildiğinde BURASI güncellenir.
>
> Kaynak türleri: 🔬 = kendi sahamızda doğrulandı · 📚 = dış araştırma (rapor)
> Son güncelleme: 2026-07-04

---

## 1. SAHADA DOĞRULANMIŞ CİHAZLARIMIZ 🔬

| Cihaz | SoC/Platform | GPU | Android | WebView | RAM | Ekran | CAN | Notlar |
|-------|--------------|-----|---------|---------|-----|-------|-----|--------|
| **K24** (Selim'in aracı) | NWD platformu | Mali-400 | 9 | **Chrome 101** | düşük | yatay | NWD outer CAN SDK (`com.nwd.can.service.ACTION_CAN_SERVICE`) | BT OEM-kilitli (USER_TURN_OFF); network adb ROOT var; termal hassas; SMIL/blur kasması |
| **Duster T507** (Sabri Abi) | Allwinner T507 "Simple Soft" | PowerVR/Mali sınıfı | ~10 | **Chrome 64-79 bandı** (parse kanıtı: `?.` yok) | ? | yatay | Simple Soft / SystemCanBroadcastAdapter | PC-adb İMKANSIZ (USB host yok, root yok, wireless debug yok); module worker YOK (<80) |
| **Xiaomi zircon** (test telefonu) | Snapdragon (modern) | Adreno | 14+ | güncel | 8GB+ | 2712×1220 | — | GPS Doppler-0 saplanması BURADA görüldü → hız verisine güven yok |

### Saha derslerimiz (tekrarlanabilir desenler)
- **WebView bandı çok geniş:** aynı ürün ailesinde Chrome 64'ten 101+'a kadar
  her şey var. `?.`/`??` Chrome <80'de satır-1 SyntaxError = boot ölümü
  (fix `6934645`: plugin-legacy `modernTargets: chrome>=64`).
- **Inline CSS sessizce düşer:** `clamp()/inset/aspect-ratio/dvh` <79-88 →
  `cssCompat.ts` fallback zorunlu. `.css` dosyaları `cssTarget: chrome61` ile
  transpile olur ama React inline style'lar OLMAZ.
- **GPS hız verisi güvenilmez:** bazı cihazlar hareket halinde `coords.speed=0`
  bildirir (Doppler saplanması) → hız VEYA yer-değiştirme (`pickRawSpeed`).
- **BT stack OEM'ce kilitlenebilir** (K24): 3. taraf OBD-BT imkânsız olabilir →
  WiFi ELM327 TCP transport alternatifi şart.
- **adb erişimi garanti değil** (T507: hiç yok) → uzak teşhis için uygulama-içi
  telemetri/`window.__MAP_STORE__`/support snapshot şart.
- **CAN erişimi platforma özgü:** NWD SDK (K24) vs Simple Soft broadcast (T507)
  vs Hiworld/Raise dekoderleri → `VehicleDataLayer` adaptör deseni doğru mimari.
- **Sahte donanım algısı:** gradle "up-to-date" stale APK, OEM manifest rotasyon
  yoksayma, sahte Android sürümü iddiaları — cihaz beyanına körü körüne güvenme.

---

## 2. SoC / PLATFORM AİLELERİ 📚
> Kaynaklar: android-headunits.com, XDA Forums, smarty-trend.com, gadgetversus.com,
> allwinnertech.com, notebookcheck.net (2026-07-04 taraması).

Çin aftermarket ünitesi = **referans anakart + marka kabuğu**. Aynı SoC onlarca
markada satılır. Bu yüzden donanım tespiti MARKA'ya değil **SoC/GPU/WebView**'a bakar.

| Aile | SoC (gerçek çip) | CPU | GPU | RAM tipik | Android | Donmuş WebView (~Chrome) | Konum |
|------|------------------|-----|-----|-----------|---------|--------------------------|-------|
| **Ultra-bütçe 8227L** | "8227L_demo" / AC8227L / MTK8227 türevi | 4× Cortex-A7 **32-bit** ~1.3GHz | **Mali-400/450 MP** | 1–2GB (çoğu SAHTE: 2GB yazar 1GB'tır) | 8.1 / 9 / 10 (çoğu yamalı "go", sahte sürüm etiketi) | **52–74** (çok eski, donuk) | En YAYGIN ucuz sınıf. En zayıf donanım. <$200 |
| **Allwinner T** | T3 (A7×4), T8 (A7×8), **T507** (A53×4) | 32-bit (T3) → 64-bit A53 (T507) | Mali-400 (T3) → **Mali-G31 MP2** (T507) | 1–4GB | 9 / **10** | **64–83** (T507 bandı: `?.` yok, ~64-79) | Otomotiv-grade. **Duster'ımız T507**. OEM montaj yaygın |
| **Rockchip PX** | PX3/PX30 (rk3326 A35×4), **PX5** (rk3368 A53×8), **PX6** (rk3399 A72×2+A53×4) | 8-bit→64-bit | Mali-T760/T864 (PX5), **Mali-T860 MP4** (PX6), Mali-G31 (PX30) | 2–4GB | 8 / 9 / 10 | **66–83** | MTCD/MTCE/HCT firmware galaksisi. Modcu topluluğu (Hal9k) burada |
| **Unisoc UIS7862 / 7862A** | ums512, 12nm | **A75×2 + A55×6** 1.8–2.0GHz | **Mali-G52** | 4 / 6 / **8GB** LPDDR4 | **10 / 11 / 12 / 13** | **83–104+** | 2022+ **ANA AKIM KRAL**. Teyes CC3, çoğu orta-üst ünite |
| **Qualcomm Snapdragon** | SD625, **SDM665/SM6125** (SD662 8-çekirdek) | A73×4+A53×4 ~2.0GHz | **Adreno 610/612** | 4–8GB | 10 / 11 / 12 | **90–104+** | Premium azınlık. En iyi sürücü/BT desteği. Dasaita üst seri, bazı Joying |
| **MediaTek MT** | MT6737 (A53×4), MT8321, MT6763 | 64-bit A53 | **Mali-T720/G71** | 2–4GB | 8 / 9 / 10 | **60–83** | Azalan pay; bazı OEM CarPlay dongle/ünite |

### 8227L tuzağı (en kritik uyumluluk hedefi)
- Pazarın en büyük hacmi ama en zayıf donanımı. **Mali-400, 1GB gerçek RAM,
  32-bit A7.** Blur/SMIL/çoklu WebGL harita bunu dizüstüne çevirir → `perf-low`
  zorunlu yol. `deviceCapabilities` bunu BASIC_JS'e indirmeli.
- **Sürüm sahtekârlığı:** "Android 11/12" etiketi çoğu zaman yamalı 8.1/9 üstüne
  boyanır — WebView motoru etikete değil, gerçek build'e bağlıdır. Cihaz beyanına
  güvenme; `navigator.userAgent` Chrome sürümünü doğrula.

## 3. MARKALAR VE YAZILIM PLATFORMLARI 📚

Marka ≠ üretici. Çoğu marka referans anakartı alıp firmware'i markalar (reseller/entegratör).

**Firmware / ROM platformları (donanımı belirler):**
- **MTCD / MTCE / MTCB / MTCP / MTCH** — Microntek/Rockchip PX firmware ailesi.
  MCU string formatı `[MTCE_XXX_sürüm]`; `XXX` üreticiyi kodlar (HA=HotAudio,
  GS=GESHI…). MTCE, MTCD'nin yazılım üst-sürümü (donanım aynı). MTCH = yeni PX6.
- **HCT / HCTG** — MTC ile uyumlu paralel firmware soyu.
- **Hal9k Mod** — PX5/PX6/PX30 için topluluk custom ROM (MTCx/HCTx tabanı).
- **8227L_demo / ALPS** — ucuz MTK türevi firmware; ayrı MCU güncelleme kanalı.

**Markalar (reseller kabukları — aynı SoC'yi paylaşırlar):**
Dasaita · Joying · **Teyes** (CC3/SPRO) · ATOTO · Xtrons · Isudar · Eonon ·
Pumpkin · Seicane · Junsun · Navifly · Erisin · Podofo · Ownice · Hizpo ·
MEKEDE · Zhnlink · SMARTY Trend · Roadwise. → **Marka bazlı özel-durum YAZMA;**
SoC/GPU/WebView tespitine dayan.

## 3.5 DAĞITICI / ENTEGRATÖR MÜDAHALE KATMANI 📚
> Kaynak: XDA (XY Auto, Erisin, YT9216BJ, MTK825x threadleri), joyingauto.com,
> dasaita.com, android-headunits.com PIN listeleri, securityaffairs.com,
> Privacy Guides (2026-07-04). **Cihaz fabrikadan çıktığı hâliyle bize gelmez —
> dağıtıcı/entegratör ARADA firmware'e dokunur. Bu katmanı hesaba katmamak
> "bir cihazda açıldı, diğerinde açılmadı" hatasının ta kendisidir.**

Dağıtıcı **3 AYRI firmware katmanına** bağımsız müdahale edebilir:

| Katman | Ne | Nasıl flash'lanır | Bizi nasıl etkiler |
|--------|-----|-------------------|--------------------|
| **MCU firmware** (`dmcu.img`) | Donanım/CAN/direksiyon kumandası çekirdeği | USB kök → Settings→System→Update MCU | Seri CAN sinyalleri buradan gelir; MCU sürümü farklıysa protokol/veri değişir |
| **Android ROM/OS** | Sistem imajı (`ota` USB veya PC SP Flash Tools) | USB (dosyada "ota") veya SPFlash | WebView, Play Services, launcher, izin yöneticisi hep burada değişir |
| **CANbus config** | Araç protokol seçimi (Raise/Hiworld…) | Fabrika menüsü / ROM'la beraber | Yanlış seçilirse hız/devir/kapı gelmez |

### Dağıtıcının yaptığı tipik değişiklikler
- **Jenerik firmware'i markalar:** çoğu ROM aslında **XY AUTO / FYT / Topway (TS10/TS18)**
  jenerik firmware'idir, dağıtıcı marka logosu/launcher geçirir. Aynı bug'lar
  onlarca "farklı" markada aynen çıkar.
- **Sürümü sahte etiketler:** eski Android'i (8.1/9) "Android 12/13" diye rebadge —
  yalnız paket adı/grafik değişir, motor eski kalır. **`navigator.userAgent`
  gerçeği söyler, ayarlar ekranı yalan söyler.**
- **Fabrika/kurulum şifresini DEĞİŞTİRİR:** şifre platforma (MCU) bağlı, markaya
  değil; **factory reset onu SIFIRLAMAZ.** Tipik kodlar: `1617` `2014` `8888`
  `3368` `126` `168` `7890` `123456`. Fabrika menüsü = CANbus protokolü + varsayılan
  launcher + ekran/çözünürlük ayarının yeri. (Kurulum kılavuzumuz buraya atıf yapmalı.)
- **Bloatware/telemetri ekler:** ağır izinli önyüklü uygulamalar, "phone-home"
  telemetri; bazı ROM'larda **Play Services / GApps HİÇ YOK.** Play Protect kapalı.
- **Custom launcher kilitler:** kendi launcher'ını varsayılan yapar; Android 12'de
  3. taraf launcher ataması ekstra adım/engelli olabilir. (Bizim launcher-ready
  hedefimizi doğrudan ilgilendirir.)
- **Autostart / pil / bellek "öldürücü" yöneticisi:** custom ROM arka plan
  servislerini agresif kapatabilir → boot preload / servisimiz öldürülebilir.
- **Config-başına firmware parçalanması:** her ekran çözünürlüğü + RAM + araç için
  AYRI firmware SKU'su → yanlış eşleşme brick veya boot hatası.

### Ders (CarOS Pro için)
**Temiz AOSP VARSAYMA.** Cihaz = fabrika donanımı **+ dağıtıcı ROM müdahalesi**.
Uygulama şunlara dayanıklı olmalı: (1) Play Services YOKLUĞU (FCM push, Play
Integrity, fused konum, Maps SDK olmayabilir → **offline-first + BYOK bunu zaten
karşılıyor**), (2) sürüm string'i yalanı, (3) launcher kilidi, (4) autostart
öldürme, (5) MCU sürüm çeşitliliği (seri adaptör varyant tolere etmeli).

## 4. EKRANLAR 📚
> Kaynak: MCX Carplayer, Dasaita, SMARTY Trend, XDA (2026-07-04).

| Çözünürlük | Tip | Boyut | Sınıf | Not |
|------------|-----|-------|-------|-----|
| **1024×600** | LCD/IPS | 9" / 10.1" | Bütçe (en yaygın) | 8227L standardı. Düşük DPI |
| **1280×720** | IPS / **QLED** | 9" / 10.1" | Orta | Teyes CC3, UIS7862 tipik |
| **1920×720** | IPS ultra-geniş | 8.8"–12.3" | Orta-üst | "Tesla-şerit" ultrawide — **16:9 DEĞİL** |
| **1920×1080** | QLED / IPS | 10"–13.3" | Premium (2K) | Dasaita/Qualcomm üst seri |
| **Dikey 9.7"/10.4"** | IPS | Tesla-stili | Portre | **Portre yerleşim** — yatay varsayma |

**Ders:** en-boy oranı standart değil (ultra-geniş, portre, kare-ye-yakın). Responsive
yerleşim 16:9 varsaymamalı; `dvh`/`clamp` eski WebView'da düşer → `cssCompat` şart.
Xiaomi zircon (2712×1220) ≠ tipik ünite — geliştirme telefonu, hedef değil.

## 5. CAN DEKODER EKOSİSTEMİ 📚
> Kaynak: android-headunits.com, github.com/smartgauges/canbox, XDA (2026-07-04).

**Mimari:** Head unit, aracın CAN'ine DOĞRUDAN bağlanmaz. Araya **ayrı bir CANBUS
dekoder kutusu** girer; kutu araç CAN'ini okur → head unit'in anladığı **seri
(UART) protokolüne** çevirir. Protokol markaya özgü ve tersine-mühendislikle
üretilmiştir → aynı araç için farklı markalar farklı kodlar kullanır.

**Dekoder markaları / protokolleri:**
- **Raise (RZC)** — VW **PQ** / VW **MQB** varyantları (en yaygın soylardan)
- **Hiworld** — VW MQB + geniş araç yelpazesi
- **Oudi** — BMW (NBT Evo) gibi CAN üstü ayrı protokol
- **Nuoweida / NWD** — **bizim K24'ün SDK'sı** (`com.nwd.can.service`)
- **Ownice, BNR, XBS, XINPU, Daojun, Ruishengwei, HCY, Hechi, Adayo, Foryou, Hangsheng** — diğer soylar
- **Açık firmware:** `smartgauges/canbox` — Raise(PQ/MQB), Hiworld(MQB), Oudi(BMW)
  protokollerini EMÜLE eder; çözdüğü sinyaller: **kapı durumu, park sensörü,
  kontak (ignition), geri vites/kamera, aydınlatma (illumination), hız/devir**.

**Ders:** CAN erişimi platforma özgü → **adaptör deseni zorunlu**
(NWD SDK / SimpleSoft broadcast / seri protokol). `VehicleDataLayer` her soy için
ayrı dekoder ile beslenmeli; tek protokole gömülü kod yanlış mimari.

## 6. PAZAR DAĞILIMI VE HEDEFLEME 📚

**Hacim piramidi (kabaca):**
- **Taban (en çok satan):** 8227L ultra-bütçe — devasa hacim, en zayıf donanım (Mali-400, 1GB, Chrome 52-74).
- **Orta (2022+ baskın):** **UIS7862** — yeni ana akım; çoğu satılan orta-üst ünite.
- **Tepe (azınlık):** PX6 / Qualcomm Snapdragon — premium, en iyi sürücü desteği.

**Android sürüm bandı 8.1 → 13**, AMA kritik gerçek: **WebView DONMUŞ gelir.**
Çoğu head unit'te Play Store yok / WebView güncellenmiyor → gerçek Chrome motoru
üretim anındaki stock sürümde takılı. Bu yüzden "Android 12" etiketli bir ünite
pekâlâ Chrome 64 render edebilir.

| Android (stock) | Donmuş WebView tabanı (~Chrome) | Sonuç |
|-----------------|-------------------------------|-------|
| 6 (M) | ~44–52 | En eski; agresif fallback |
| 8.1 (O) | ~58–66 | 8227L tipik; `?.`/`??` PARSE ETMEZ |
| 9 (P) | ~66–74 | PX5, eski 8227L |
| 10 (Q) | ~74–83 (sahada 64-79 donuk görüldü) | Duster T507 · en kritik hedef bandı |
| 11–12 (R/S) | ~83–98 | UIS7862 tipik |
| 13 (T) | ~104+ | Yeni Qualcomm/UIS |

**Hedefleme kararı (bundan türer):** en aşağıda **Chrome ~52 / Android 8.1**, GPU
**Mali-400**, gerçek RAM **1GB** desteklenmeli. Modern chunk tabanı Chrome 64 (bkz.
§7) bu bandın çoğunu kapsar; 64 altı legacy ES5/SystemJS yoluna düşer.

---

## 7. CarOS Pro MÜHENDİSLİK KARARLARI (bu matristen türetilir)

| Karar | Değer | Gerekçe |
|-------|-------|---------|
| JS derleme tabanı (modern chunk) | **Chrome 64** | Tespit eşiğiyle aynı; Duster bandının tabanı |
| Legacy fallback | Chrome 50+ / Android 6+ (ES5+SystemJS) | 64 altı ve module desteksiz üniteler |
| CSS tabanı | chrome61 + cssCompat runtime fallback | inline style transpile edilemez |
| GPU katmanları | low (Mali-400/PowerVR eski) / mid / high | deviceCapabilities + DeviceTier |
| SAB/worker | `type:module` worker Chrome 80+ → BASIC_JS fallback | <80 cihazlar için zorunlu yol |
| Hız kaynağı | CAN → OBD → GPS füzyon + yer-değiştirme | Doppler-0 cihazlar |
| CAN erişim | adaptör deseni (NWD/SimpleSoft/Hiworld/...) | platform çeşitliliği |
| Sürüm tespiti | `navigator.userAgent` gerçek Chrome; ayar ekranı/OS etiketine GÜVENME | dağıtıcı sahte Android sürümü basar (§3.5) |
| Google bağımlılığı | Play Services YOK varsay → offline-first + BYOK; FCM/Play Integrity/fused konum opsiyonel yol | bazı dağıtıcı ROM'larında GApps yok (§3.5) |
| Launcher | varsayılan-launcher kilidi/Android 12 engeline dayanıklı; kurulum fabrika menüsüne atıf | dağıtıcı custom launcher kilitler (§3.5) |
| Diriliş | boot preload + servis autostart-killer'a dayanıklı (kendini toparlama) | custom ROM arka planı öldürür (§3.5) |
