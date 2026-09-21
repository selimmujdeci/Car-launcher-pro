# CarOS Pro — R-Link 2 Yeni Execution Path Araştırması (Tur 3)

> **Devam belgesi.** Baseline: `CAROS_RLINK2_REVERSE_ENGINEERING_REPORT.md` (Tur 1) ve
> `CAROS_RLINK2_CUSTOM_RESEARCH_REPORT.md` (Tur 2). Önceki doğrulanmış bulgular **korunmuştur**,
> tekrar sıfırdan araştırılmamıştır.
> **Faz durumu:** READ-ONLY masaüstü OSINT. Fiziksel R-Link 2'ye **hiçbir flash / update /
> ADB / DDT4All-write / engineering-setting değişikliği / USB exploit yapılmadı.**
> **Tarih:** 2026-09-16 · **Araç:** Renault Megane 4 (2017), R-Link 2 yatay 7", SW 3.3.16.946,
> boot/micom 5276.
>
> **Soru değişti:** Tur 1–2 "başkası kırdı mı?" sorusunu cevapladı (HAYIR). Bu tur "biz güvenli
> yeni bir execution path bulabilir miyiz?" sorusuna, sistemin **zaten sahip olduğu** debug /
> engineering / plugin / scripting / store / servis mekanizmalarını tarayarak cevap arıyor.

---

## 1. Önceki Turların Baseline'ı (değişmeyen, teyit edilen)

- CarOS Pro = tam Android APK (Capacitor 8, minSdk 24, native ARM `.so`, WebGL zorunlu). **VERIFIED** (repo).
- R-Link 2 uygulama formatı `.wlpk` (imzalı, kapalı dağıtım); firmware `chain.pem`+`.lgu`+`.lgu.sig`. **SUPPORTED**.
- DbgEnable.lge → sınırlı engineering/debug menü; kalıcı root/shell **kanıtlanmadı**. **SUPPORTED**.
- iGO partition unlock patch + SKU Creator → **veri** (harita/POI/lisans/skin) enjeksiyonu **VERIFIED**;
  arbitrary code execution **DISPROVEN/UNKNOWN**.
- GitHub'da R-Link 2 firmware/root/custom-code reposu yok (repo + code search). **VERIFIED**.
- `.wlpk` public web'de yok (rlinkstore.com tam Wayback CDX: 3445 snapshot, 0 `.wlpk`). **SUPPORTED (güçlü)**.
- Arbitrary/user-supplied code execution → şu ana kadar **hiçbir turda bulunamadı**.

Bu tur bu tabloyu **çürütmedi**; birkaç noktada **nüans/yeni kaynak** ekledi (aşağıda).

---

## 2. TRACK 1 — DbgEnable.lge Derin Analiz

**Yeni kaynaklar (bu tur):** renaultforum.nl ("Engineer modus activeren r-link2 (hacking)"),
YouTube ("Entering the R-LINK2 multimedia engineering menu", "R Link 2 Developer Mode Activation
Tutorial"). Önceki turların RU/DE kaynaklarına ek, bağımsız bir NL kaynağı.

**Aktivasyon (4. kez, bağımsız kaynakla teyit — VERIFIED, çok kaynaklı):** FAT32 USB → `DEBUG/`
klasörü → 0 byte `DbgEnable.lge` → Menu > Multimedia > Settings > Photo settings, USB'yi tak,
30–45 sn bekle → ekrandaki siyah karede belirli sırayla dokunma (sol üst 1–2×, sağ alt 12–14×,
her dokunuş arası ≥1 sn).

**Açılan menüler (renaultforum.nl, VERIFIED — doğrudan alıntı):**
- **DiagRw** menüsü (HMI sekmesi altında video/fotoğraf kısıtlama yönetimi)
- **Afas** menüsü (safe-distance-warning radar/kamera seçimi)
- Medya ayarlarında **Android Auto aktivasyon** anahtarı (yalnız 3.3.x'te; 2.2.x'te yok)
- GEN tespiti, dil, sistem bilgisi (önceki turlardan teyitli)

**Bulunmayan (3 turda, 4+ dilde tutarlı olarak — DISPROVEN/negatif kanıt):**
Bu tur da dahil, **hiçbir kaynakta** (RU/DE/NL/EN) şu ifadeler geçmiyor: telnet, SSH, ADB,
network debug servisi, dosya sistemi tarayıcısı, browser debugging, developer application
loading. renaultforum.nl thread'i özellikle tarandı — **shell/kod çalıştırma iddiası sıfır**.

**Hangi process okuyor?** UNKNOWN — hiçbir kaynak binary/init-script seviyesinde
`DbgEnable.lge`'yi hangi process'in `stat()`/`open()` ettiğini göstermiyor (firmware
binary'si hiçbir turda elde edilemedi). Sadece **davranışsal** kanıt var (dosya + jest →
menü açılıyor); **kod seviyesinde** kanıt yok.

**Magic value/token var mı?** UNKNOWN. Dosyanın 0 byte olduğu tutarlı biçimde bildiriliyor
(yalnız *varlığı* kontrol ediliyor gibi görünüyor) ama bu **davranışsal çıkarım**, ikili
kanıt değil.

> **Sonuç (değişmedi, güçlendi):** DbgEnable.lge = **engineering/diagnostic UI unlock**.
> "Debug var" ≠ "root var" — 3 bağımsız araştırma turu ve 4 dil boyunca **hiçbir** kaynak
> tersini göstermedi. **STATUS: SUPPORTED (sınırlı menü) / DISPROVEN (shell/kod çalıştırma).**

---

## 3. TRACK 2 — iGO Application Binary / Runtime Mimarisi

**Yeni bulgu (bu tur):** iGO'nun ait olduğu motor ailesi **NNG iGO Primo NextGen**'dir.
Bu ailenin genel (Android/PND) sürümlerinde **`libigo_jni.so`** (ana runtime, `sys.txt`
okuyor) ve **`libigo_ini.so`** (Luna UI motoru) gibi native shared library'ler; ayrıca
**Lua tabanlı bir UI/skin scripting motoru ("Luna")** olduğu gpspower.net (NNG topluluk
forumu) üzerinden doğrulandı. NNG bu Lua dosyalarını genellikle **şifreliyor/derliyor**
(`.lua` → bytecode, bazı topluluk araçlarıyla `.luad` olarak geri çevrilebiliyor).

**Kritik ayrım (CLAUDE.md gereği, generic ≠ R-Link 2):**
- Bu bilgi **standalone Android/PND iGO kurulumları** (telefon/navigasyon cihazı üzerinde
  çalışan iGO APK/EXE) hakkındaki topluluk kaynaklarından geliyor.
- **R-Link 2'nin gömülü iGO build'inin bu Luna/Lua motorunu kullandığına dair sıfır kanıt**
  bulundu (3 turda, hiçbir RU/DE/FR/EN kaynakta "R-Link 2" + "Luna" veya "R-Link 2" + "Lua
  script" birlikte geçmiyor).
- Luna/Lua scripting'in **yetkisi** dahi (generic ailede) yalnız **UI/skin render**
  (buton, ekran, animasyon, string) ile sınırlı görünüyor; hiçbir kaynakta Lua scriptinin
  `os.execute`/`io`/soket/native-bridge çağırdığına dair kanıt yok.

**dlopen/exec/system/popen/fork/sh string arama:** **YAPILAMADI** — hiçbir turda gerçek
R-Link 2 iGO binary'si (native `.so`/executable) elde edilemedi; bu nedenle statik
string/import analizi mümkün değil.

> **Sonuç:** "iGO motoru genel olarak Lua script çalıştırabilir" → **SUPPORTED** (generic NNG
> özelliği, R-Link 2 DIŞINDA doğrulandı).
> "R-Link 2 build'i bunu kullanıcıya açıyor" → **UNKNOWN** (R-Link 2 kanıtı yok).
> "Açık olsa bile CarOS için yeterli yetkiye sahip" → **UNKNOWN/muhtemel DISPROVEN**
> (yalnız UI-scope kanıtı var, filesystem/network/process erişimi hiçbir kaynakta yok).

---

## 4. TRACK 3 — iGO UX / Skin / Scripting (R-Link 2 spesifik)

Yukarıdaki Track 2 bulgusunun devamı: R-Link 2 build'inin `*.ux`/`*.lua`/`plugin.ini`/
`sys.txt`/`data.zip` gibi dosyaları **kabul ettiğine dair R-Link 2'ye özel kanıt yok**.
Doğrulanan tek R-Link 2 içerik kanalı, Tur 2'de bulunan **iGO partition unlock + SKU
Creator** zinciridir — ve o zincir **açıkça veri** (harita/POI/bina/speedcam/lisans/skin
**görseli**) üretiyor, script/plugin/kod değil (Tur 2 §19.3, VERIFIED).

> **STATUS: UNKNOWN** (R-Link 2 build'inin generic Luna/Lua desteğini miras alıp almadığı
> belirsiz) → veri yoksa dürüstçe **UNKNOWN**, iddia edilmedi.

---

## 5. TRACK 4 — WLPK / HTML5 Execution

**Yeni arama (bu tur):** ACCESS NetFront HTML5 Automotive SDK'nın kendisi **gerçek ve
doğrulanabilir bir üründür** (access-company.com, eu.access-company.com — VERIFIED, ACCESS'in
kendi sitesi). NetFront Browser BE (Chromium/Blink) ve NX (WebKit) "HTML5 application stores
ve HTML5 based applications" sunduğunu **kendi ürün sayfasında iddia ediyor** — ama bu **genel
ürün pazarlaması**, R-Link 2'ye özgü değil.

**R-Link 2 ↔ NetFront bağlantısı:** Hiçbir kaynakta (3 tur, ACCESS'in kendi basın
bültenleri/case-study sayfaları dahil taranmadı çünkü bulunamadı) **doğrudan "R-Link 2" +
"NetFront" birlikte geçen bir cümle yok**. Bağlantı yalnızca `.wlpk` = "WebLink Package"
isimlendirme benzerliğinden **çıkarım** yapılıyor — bu bir **isim benzerliği**, teknik kanıt
değil.

> **STATUS: UNKNOWN (inference-only).** "NetFront R-Link 2'de kullanılıyor" **iddia
> edilmedi**; yalnız isimlendirme paraleli not edildi.

**R-Link Store uygulama teknolojisi — yeni, ZAYIF sinyal:** Bir arama motoru özet yanıtı
"Renault R-Link applications were Java Apps" ifadesini üretti, ancak bu ifadenin **doğrudan
alıntılandığı birincil kaynak tespit edilemedi** (arama motoru sentezi, atıf yok).
→ **UNVERIFIED, VERIFIED'a yükseltilmedi.**

**R-Link Toolbox:** Resmi masaüstü aracı — R-Link Store'dan satın alınan uygulama/harita
güncellemelerini SD/USB'ye indirip aktarıyor (gps-rlink.com, Renault resmi
user-manual.renault.com — VERIFIED, doğrudan doğrulandı). Format/manifest/imza detayına
**hiç girmiyor** — kullanıcı seviyesinde "indir → karta yaz → araca tak" akışı.

**Resmi Renault kullanıcı kılavuzu (`user-manual.renault.com`, doğrudan WebFetch ile
okundu):** Uygulama kurulumu SD kart + R-Link Toolbox ile anlatılıyor; **dosya
formatı/uzantı/imza doğrulama prosedürü belgelenmemiş**, **SDK/manifest/geliştirici kaynağı
sıfır**. → **VERIFIED (negatif sonuç):** resmi son-kullanıcı dokümantasyonu geliştirici bilgisi
içermiyor.

---

## 6. TRACK 5 — Application Storage / Registration

**Bu turda da bulunamadı.** Filesystem layout, application registry/catalog, launcher
discovery mekanizması hakkında **hiçbir kaynak** (3 tur toplamda) teknik detay vermiyor.

> **STATUS: UNKNOWN** (değişmedi).

---

## 7. TRACK 6 — Engineering / Service Application Loader

**Bu turda özel arama:** "LG automotive engineering tool", "Renault developer portal",
"R-Link SDK", "factory provisioning", "service USB test application" — **hiçbir sonuç**
R-Link 2'ye özel bir üretim/servis uygulama-yükleme aracını göstermedi. LG'nin R-Link 2'yi
geliştirdiği genel olarak biliniyor (Renault basın kaynakları) ama **public bir LG/Renault
"developer kit" veya "engineering application loader" belgesi yok.**

> **STATUS: UNKNOWN** (negatif sonuç, kanıt yokluğu kanıtlanmış aramaların ardından).

---

## 8. TRACK 7 — Network Services

**Bu turda da:** telnetd/sshd/adbd/ftpd/httpd/debug-server için firmware string araması
**yapılamadı** çünkü **hiçbir turda gerçek R-Link 2 firmware binary'si elde edilemedi.**
Bu tamamen **eksik-artefact** kısıtlaması, mimari bir sonuç değil.

> **STATUS: UNKNOWN — TEK eksik artefact: gerçek `.lgu`/firmware dump.**

---

## 9. TRACK 8 — Update Mekanizmasının Sınırları

Teyit edilen yapı (Tur 1–2): `chain.pem` (sertifika zinciri) + `mm2014_upgrade.lgu`
(firmware) + `mm2014_upgrade.lgu.sig` (imza) — **sistem/executable güncelleme kanalı**.

**Neden iGO partition değiştirilebiliyor ama executable değiştirilemiyor? (Teknik sınır
sorusu — bu tur netleştirildi, ama tam kanıtla DEĞİL):**

RU topluluğunun kendi ifadesiyle (Tur 2 §19.3, alıntı): teknolojileri **"yalnız `igo`
partition'ı için"** geçerli ("готов передать всю технологию перепаковки lgu для раздела
igo") — yani community'nin kendisi bile bu tekniği **sistem/executable partition'a**
genellemiyor. Bu, iki olası açıklamayı destekliyor (ikisi de **UNKNOWN**, hangisi doğru
belirsiz):
1. `.lgu` konteyneri **partition-bazlı ayrı imza/hash** taşıyor olabilir (yalnız `igo`
   partition'ının bütünlüğü zayıf/MD5-seviyeli, sistem partition'ları daha sıkı
   imzalanmış) — **UNKNOWN, teknik olarak doğrulanamadı** (gerçek `.lgu` hiç açılmadı).
2. Community basitçe **sistem partition'ı hiç denememiş/kırmamış** olabilir (motivasyon
   eksikliği, risk), imza mekanizması aslında tekdüze/eşit sıkı olabilir.

**Dürüstlük:** Bu ayrımı **gerçek `.lgu` yapısıyla kanıtlamak bu turda da mümkün olmadı**
— hiçbir round'da örnek `.lgu` indirilemedi (VIN-kapılı). → **STATUS: UNKNOWN**, iddia
şişirilmedi.

---

## 10. TRACK 9 — Public Artefact Avlama (bu tur)

| Aday | Sonuç |
|---|---|
| `github.com/egonalter/R-Link-RE` (arama motoru snippet başlığı) | **`gh api` ile 404 — repo MEVCUT DEĞİL.** Arama motoru özetinin ürettiği sahte/yanıltıcı başlık. **DISPROVEN.** |
| `gh search code "R-Link"` (genişletilmiş) | Tamamen ilgisiz sonuçlar (React Router, i18n `.po` dosyaları). **VERIFIED (NOT FOUND, ek tur).** |
| `lisandru.eu` (Tur 1'de kaynak gösterilen site) | **Bu turda domain süresi dolmuş / parking sayfasına yönlendiriyor** (`dropcatch.ai`). Kaynak artık **canlı değil** — Tur 1'deki alıntı arşivlenmiş özet üzerinden kalıyor, yeniden doğrulanamadı. |
| ACCESS NetFront ürün sayfaları | **İndirildi/okundu (WebFetch)** — gerçek ürün, ama R-Link 2 bağlantısı kanıtsız (yukarı bkz). |
| Renault resmi `user-manual.renault.com` sayfası | **Okundu (WebFetch)** — gerçek, resmi, ama teknik format detayı yok. |

Yeni indirilebilir firmware/`.wlpk`/SDK/engineering-package **bulunamadı**. Hiçbir yeni
binary indirilmedi bu turda (yalnız HTML sayfa okuma). SHA-256 kaydı gerektiren yeni bir
binary **yok**.

---

## 11. TRACK 10 — Yeni Execution Path Adayları Tablosu

| # | Path | Entry Point | User Control | Execution Type | Persistence | Privilege | Display | Touch | Audio | Network | OEM UI Return | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PATH-1 | DbgEnable engineering loader | USB `DEBUG/DbgEnable.lge` + jest | Dosya varlığı (içerik yok) | Yok (menü/config toggle) | Menü ayarı kalıcı, kod değil | Diagnostic UI | Native OEM menü | N/A | Kanıt yok | Kanıt yok | N/A (OEM'in kendisi) | 3 tur × 4 dil, tutarlı | **SUPPORTED (menü) / DISPROVEN (execution)** |
| PATH-2 | iGO content/data partition (unlock+SKU Creator) | Official update USB akışı + community patch | Tam (harita/POI/lisans/skin verisi) | Yok (veri, iGO motoru yorumluyor) | Kalıcı (kurulu içerik) | Data-plane | iGO'nun kendi UI'ı | iGO'nun kendi UI'ı | Yok | Yok | N/A | VERIFIED (gerçek artefact: iGOLicenseViewer) | **VERIFIED (data) / DISPROVEN (code)** |
| PATH-3 | iGO Luna/Lua scripting motoru | (generic NNG) skin/script dosyası | Generic ailede tam; R-Link 2'de UNKNOWN | Lua bytecode, UI-scope | UNKNOWN (R-Link 2'de test edilmedi) | UI/skin render (kanıtlanan üst sınır) | Teorik: iGO ekranı | UNKNOWN | Kanıt yok | Kanıt yok | UNKNOWN | Generic: gpspower.net; R-Link 2: yok | **SUPPORTED (generic) / UNKNOWN (R-Link 2) / muhtemel DISPROVEN (yetki genişliği)** |
| PATH-4 | WLPK / R-Link Store HTML5-JS app | R-Link Store → Toolbox → imzalı `.wlpk` | Yok (imzalı/curated store, unsigned yol yok) | UNKNOWN (örnek hiç elde edilmedi) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | rlinkstore CDX: 3445 snapshot, 0 `.wlpk` | **UNKNOWN (mimari) / DISPROVEN (açık/unsigned kurulum yolu)** |
| PATH-5 | Engineering/service/factory app loader (LG/Renault) | Bilinmiyor (varsayımsal OEM-internal) | Yok (public erişim kanıtı yok) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | 3 tur negatif arama | **UNKNOWN (public kanıt yok)** |
| PATH-6 | Writable data/content partition (genel) | Official update USB, community re-pack (yalnız `igo`) | Data-plane tam | Yok | Kalıcı | Data-plane | — | — | — | — | — | RU topluluğu doğrudan alıntı | **SUPPORTED (data) / DISPROVEN (executable partition)** |
| PATH-7 | Debug network service (telnetd/adbd/…) | Firmware içi (varsayımsal) | Yok | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **Hiçbir turda firmware binary elde edilemedi** | **UNKNOWN — bloke, eksik artefact** |
| PATH-8 | Android Auto "developer mode" (10× "About Android Auto") | Android Auto oturumu (telefon tarafı) | Yalnız AA'nın kendi debug toggle'ları | Yok (R-Link native execution değil) | AA oturumuyla sınırlı | AA session-scope | AA'nın kendi arayüzü | AA'nın kendi arayüzü | AA'nın kendisi | AA'nın kendisi | N/A | YouTube/forum, VERIFIED (genel AA özelliği) | **NOT APPLICABLE — R-Link native execution değil, R-Link Client'a yaramaz** |

---

## 12. CarOS R-Link Client Feasibility (bu tur)

Minimum hedef (fullscreen UI + touch + network soket + tercihen audio/mikrofon/GPS) hâlâ
**PATH-1..8'in hiçbirinde doğrulanmış bir kapı bulmuyor:**

- PATH-1 (DbgEnable) → yalnız OEM menüsü, kullanıcı ekranı/kodu render etmiyor.
- PATH-2 (iGO data) → yalnız navigasyon içeriği, arbitrary UI/network kodu değil.
- PATH-3 (Luna/Lua) → **en umut verici teorik aday** ama R-Link 2'de varlığı **UNKNOWN**;
  varsa bile kanıtlanan yetki UI-scope, network/socket/audio/mikrofon erişimi **hiçbir
  kaynakta yok**.
- PATH-4 (WLPK/HTML5) → mimari **UNKNOWN** (örnek yok), açık/unsigned kurulum yolu **DISPROVEN**.
- PATH-5..7 → kanıt yok veya bloke (eksik artefact).
- PATH-8 → konu dışı (R-Link native execution değil).

> **Hiçbiri "HTML5/JS bulundu ama Android değil diye değersiz sayıldı" durumu değil** —
> tam tersi: HTML5/JS **mimarisinin kendisi bile** R-Link 2'de kanıtlanamadı (örnek `.wlpk`
> hiç elde edilemedi). Bu nedenle "değersiz sayma" sorunu bu turda **hiç doğmadı** — önce
> mimari kanıtlanmalı, sonra "Android değil" diye değersiz sayılmama ilkesi devreye girer.

---

## 13. Bilinmeyenler (dürüst UNKNOWN listesi, güncel)

- iGO Luna/Lua scripting motorunun R-Link 2 build'inde **var olup olmadığı** — **UNKNOWN**.
- `.wlpk` gerçek iç yapısı (HTML5/JS mi, native mi, Java mı) — **UNKNOWN** (örnek yok).
- R-Link 2 firmware'inde network servisi (telnetd/adbd/…) — **UNKNOWN** (firmware yok).
- `.lgu` konteynerinin partition-bazlı imza/hash granülaritesi — **UNKNOWN** (örnek yok).
- LG/Renault internal engineering/factory application loader — **UNKNOWN** (public kanıt yok).
- DbgEnable.lge'yi okuyan process/binary kimliği — **UNKNOWN** (firmware yok).

---

## 14. En Düşük Riskli Sonraki Deney

**Değişmedi (Tur 1–2 ile aynı, en güvenli sıralama):**

1. **Sıfır risk:** R-Link ekranında System Information'ı fotoğrafla (GEN/HW/SW teyidi).
2. **Düşük risk, araca sıfır yazma:** Kendi VIN'inle resmi `.lgu`'yu **yalnız PC'ye** indir,
   `binwalk`/`file`/`unzip`/hexdump ile **salt-oku** aç. Bu, PATH-4 (WLPK/HTML5), PATH-7
   (network servisi) ve TRACK 8'deki (partition-bazlı imza) **tek gerçek kanıt kapısıdır**
   — üç turda da bu tek artefact eksik kaldığı için bu üç track hâlâ UNKNOWN.
3. **Düşük risk, login-gated:** gpspower.net/navitotal/SKU Creator ekibiyle iletişime geçip
   varsa bir **R-Link 2'ye özel** Luna/Lua örneği sorulabilir (PATH-3'ü netleştirir). Araca
   hiçbir şey yazılmaz.

> Karar kullanıcıya aittir; bu faz hiçbirini uygulamadı (READ-ONLY sınırı).

---

## 15. NİHAİ CEVAP

**Soru:** "Başkalarının hazır hack'lerinden bağımsız olarak, R-Link 2 mimarisinin içinde
CarOS R-Link Client çalıştırmak için kullanılabilecek yeni bir execution path bulduk mu?"

**Cevap: NO — bu turda da yeni, kanıtlanmış bir execution path bulunamadı.**

**Kesin kapanan kapılar:**
- Unsigned/whitelist-dışı APK kurulumu (installer yokluğu, 2018'den beri 7+ yıl doğrulanmış
  tek çalışan örnek yok) → **DISPROVEN**.
- Sistem/firmware imza bypassı (kimse etmiyor, community sadece resmi imzalı paket
  kullanıyor) → **DISPROVEN**.
- Açık ADB/shell/telnet üzerinden root erişimi (3 tur × 4+ dil × çoklu bağımsız kaynak,
  sıfır kanıt) → **DISPROVEN** (mevcut kanıt tabanında).
- Public GitHub/forum'da gerçek bir R-Link 2 firmware-unpack/RE ekosistemi → **DISPROVEN
  (NOT FOUND, tekrar doğrulandı bu turda)**.

**UNKNOWN kalan, cevabı kesinleştirecek TEK eksik artefact:**

Gerçek bir R-Link 2 **`.lgu` firmware dump'ı** (VIN-gated resmi portaldan, veya iGO-unlock
patch'inin dağıttığı `mm2014_upgrade.lgu`). Bu tek dosya, salt-oku statik analizle:
(a) network servisi var mı (PATH-7), (b) partition-bazlı imza granülaritesi nedir (Track 8),
(c) `.wlpk`/uygulama runtime'ı `.lgu` içinde referanslanıyor mu (PATH-4) — üçünü de
**tek seferde** kanıtlar veya kesin olarak kapatırdı. Üç araştırma turu boyunca bu dosya
**hiçbir zaman** elde edilemedi (VIN-kapılı / login-gated / Wayback'te yok).

---

### Dürüstlük Disiplini Özeti (bu turda ne YAPILMADI)

- Hiçbir firmware/`.wlpk`/native binary **indirilmedi** → strings/readelf/objdump/statik
  binary analizi **YAPILMADI** (yapacak binary yok).
- Fiziksel R-Link 2'ye **hiçbir yazma/flash/ADB/DDT4All-write/engineering-değişiklik
  yapılmadı.**
- "R-Link-RE" GitHub reposu **doğrulandı — mevcut değil**, iddia edilmedi.
- Generic iGO/NNG Luna-Lua özelliği R-Link 2 özelliği **sayılmadı**; ayrı ayrı etiketlendi.
- Arama motoru sentez-yanıtları (ör. "Java Apps" iddiası) birincil kaynak olmadan
  **VERIFIED'a yükseltilmedi.**
