# CarOS Pro — R-Link 2 Uygulama Platformu ve Client Uygunluk Raporu

> **Devam belgesi.** Baseline: `CAROS_RLINK2_REVERSE_ENGINEERING_REPORT.md`,
> `CAROS_RLINK2_CUSTOM_RESEARCH_REPORT.md`. Detaylı track kanıtları (DbgEnable, iGO mimarisi,
> WLPK/HTML5, network servisleri, update sınırları) için **kanonik kaynak:**
> `CAROS_RLINK2_EXECUTION_PATH_RESEARCH.md`. Bu rapor onu **tekrarlamaz**; aynı kanıt tabanı
> üzerinden **uygunluk matrisi ve nihai teknik hükmü** üretir (CLAUDE.md §6 — tek otorite).
> **Faz durumu:** READ-ONLY. Fiziksel R-Link 2'ye hiçbir yazma/flash/update/config değişikliği
> yapılmadı. **Tarih:** 2026-09-16 · **Araç:** Renault Megane 4 (2017), R-Link 2 7" yatay,
> SW 3.3.16.946, boot/micom 5276.

---

## 1. Previous Research Baseline

Bkz. `CAROS_RLINK2_EXECUTION_PATH_RESEARCH.md` §1. Özet: CarOS Pro tam Android APK'dır;
R-Link 2 kapalı, imzalı (`.wlpk`+`.lgu`+`.lgu.sig`) bir platformdur; arbitrary code execution
3 araştırma turunda da **bulunamadı**.

## 2. DbgEnable.lge Findings

Bkz. `CAROS_RLINK2_EXECUTION_PATH_RESEARCH.md` §2. Özet: 4 dilde (RU/DE/NL/EN) bağımsız
doğrulanmış — **yalnız engineering/diagnostic menü** (DiagRw, Afas, Android Auto toggle,
sistem bilgisi). Shell/telnet/ADB/network servisi/developer app loading için **sıfır kanıt**.
**Forum iddiası ile teknik kanıt ayrımı:** hiçbir kullanıcı "kendi kodumu çalıştırdım" demiyor;
tek somut iddia (DE, 2018) APK'nın kopyalanabildiği ama **installer olmadığı için
kurulamadığıdır** — bu execution DEĞİL, dosya transferidir.

## 3. R-Link Application Architecture

- Uygulamalar `.wlpk` ("Renault R-Link Update Package") formatında; R-Link Store → R-Link
  Toolbox → yetkili USB/SD ile kuruluyor (SUPPORTED, çok kaynaklı: gps-rlink.com,
  file-extensions.org, Renault resmi `user-manual.renault.com`).
- Resmi Renault kullanıcı kılavuzu (WebFetch ile doğrudan okundu) **format/manifest/imza
  prosedürünü belgelemiyor**; SDK/geliştirici kaynağı **sıfır**. → **VERIFIED (negatif)**.
- rlinkstore.com'un tam Wayback CDX envanteri (3445 snapshot) → **0 `.wlpk` dosyası**;
  paketler **VIN-hash'li authenticated backend'den** araca teslim ediliyor, public web'de
  yok. → **SUPPORTED (güçlü)**.

## 4. WLPK / WebLink İlişkisi

`.wlpk` = "WebLink Package" isimlendirmesi ile ACCESS'in **NetFront HTML5 Automotive**
ürünleri arasında **isim benzerliği** var, ama hiçbir kaynakta "R-Link 2" + "NetFront"
birlikte doğrulanmadı. → **UNKNOWN (inference-only, VERIFIED değil).**

"R-Link Store uygulamaları Java'dır" iddiası bir arama motoru sentezinden geldi, birincil
kaynak bulunamadı. → **UNVERIFIED.**

## 5. NetFront/HTML5 Runtime

ACCESS NetFront Browser BE (Blink) / NX (WebKit) automotive SDK'ları **gerçek, doğrulanmış
ürünlerdir** (ACCESS'in kendi sitesi) ve genel olarak "HTML5 application store + HTML5
based applications" iddia ediyorlar. **R-Link 2'ye özgü kullanım kanıtı yok.** Fullscreen
render / touch / network / audio / GPS / microphone / persistent storage — hepsi **R-Link 2
bağlamında UNKNOWN** (yalnız genel ürün kapasitesi VERIFIED, R-Link 2 entegrasyonu değil).

## 6. Real Application/Sample Artefacts

Hiçbir `.wlpk` örneği veya R-Link Store geliştirici paketi **hiçbir turda indirilemedi**.
Elde edilen tek gerçek, açılan artefact: `iGOLicenseViewer-native.zip` (37.4 MB,
SHA-256 `c79992ab0b7442b842184bb88b34426e1e12ea107ee6e4399449f6a3b3d43e61`,
bkz. `CAROS_RLINK2_CUSTOM_RESEARCH_REPORT.md` §19.4) — bu bir **iGO lisans/fingerprint
aracıdır**, uygulama platformu örneği değildir.

## 7. iGO Extension Architecture

R-Link 2 iGO build'i resmi olarak **UX/skin/plugin/script mekanizması ilan etmiyor.**
Doğrulanan tek genişletme kanalı: **iGO partition unlock + SKU Creator** → yalnız
**veri** (harita/POI/bina/speedcam/lisans/skin görseli). Generic NNG iGO ailesinde (R-Link 2
DIŞINDA, standalone Android/PND) bir **Lua tabanlı "Luna" skin scripting motoru** doğrulandı
— ama **R-Link 2 build'inde varlığı kanıtlanmadı** (UNKNOWN), ve doğrulanan yerlerde bile
yetkisi UI/skin render ile sınırlı (filesystem/network/native-bridge kanıtı yok). Detay:
`CAROS_RLINK2_EXECUTION_PATH_RESEARCH.md` §3–4.

## 8. Official Engineering/Developer Workflow

Renault developer portal, R-Link SDK, LG automotive development kit, ACCESS automotive
development, R-Link Store developer documentation — **hiçbiri public olarak bulunamadı**
(3 turda tekrarlanan, negatif sonuçlu arama). → **UNKNOWN (public kanıt yok)**; OEM-internal
bir süreç var olabilir ama bunun public izi yok.

## 9. Application Storage/Registration

R-Link Store uygulamalarının nerede saklandığı, launcher'ın uygulamayı nasıl keşfettiği,
manifest/registry/catalog mekanizması — **hiçbir turda bulunamadı.** → **UNKNOWN.**

## 10. CarOS R-Link Client Requirements

Minimum hedef: fullscreen UI + touch + network soket (tercihen audio/mikrofon/GPS). Bu
gereksinimlerin karşılanabileceği **doğrulanmış bir uygulama ortamı yok.** En yakın teorik
aday (iGO Luna/Lua) bile R-Link 2'de **varlığı kanıtlanmamış** ve **yetkisi UI-scope ile
sınırlı** görünüyor — network/audio/mikrofon/GPS erişimi hiçbir kaynakta yok.

## 11. Uygunluk Matrisi

| Teknoloji | R-Link 2 evidence | 3.3.x evidence | Custom app mümkün mü? | Fullscreen | Touch | Network | Audio | Mic | GPS | OEM UI return | CarOS Client faydası |
|---|---|---|---|---|---|---|---|---|---|---|---|
| HTML5 (NetFront) | **UNKNOWN** (isim benzerliği dışında yok) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN — potansiyel yüksek ama kanıtsız** |
| JavaScript (WLPK içi) | UNKNOWN (örnek yok) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| WLPK (genel) | SUPPORTED (format adı, dağıtım modeli) | SUPPORTED | **DISPROVEN** (curated/signed store, unsigned yol yok) | — | — | — | — | — | — | — | **Düşük (kapalı kanal)** |
| WebLink | UNKNOWN (yalnız isim benzerliği) | UNKNOWN | UNKNOWN | — | — | — | — | — | — | — | UNKNOWN |
| NetFront (ACCESS) | UNKNOWN (yalnız ürün var, entegrasyon kanıtsız) | UNKNOWN | UNKNOWN | — | — | — | — | — | — | — | UNKNOWN |
| iGO extension (Luna/Lua) | **UNKNOWN** (generic ailede VAR, R-Link 2'de yok) | UNKNOWN | UNKNOWN (varsa bile UI-scope) | Teorik: EVET (iGO ekranı) | UNKNOWN | **Kanıt yok** | **Kanıt yok** | **Kanıt yok** | **Kanıt yok** | UNKNOWN | **Düşük–orta (UI-scope kanıtlı üst sınır)** |
| Resmi developer app mechanism | **DISPROVEN (public'te yok)** | DISPROVEN | DISPROVEN | — | — | — | — | — | — | — | Yok |

## 12. Remaining Unknowns

- `.wlpk` gerçek iç yapısı — **UNKNOWN**.
- iGO Luna/Lua'nın R-Link 2 build'inde varlığı — **UNKNOWN**.
- R-Link Store uygulama teknolojisi (HTML5/JS/Java) — **UNVERIFIED/UNKNOWN**.
- LG/Renault internal engineering/developer workflow — **UNKNOWN**.
- Application storage/registration — **UNKNOWN**.

## 13. Lowest-Risk Next Research Step

Aynı: kendi VIN'inle resmi `.lgu`'yu **yalnız PC'ye** indirip salt-oku statik analiz (bkz.
`CAROS_RLINK2_EXECUTION_PATH_RESEARCH.md` §14). Bu, matristeki **tüm UNKNOWN satırları**
için tek gerçek çözücü artefact'tır. Araca hiçbir şey yazılmaz.

---

## NİHAİ TEKNİK CEVAP

**Soru:** "R-Link 2'nin mevcut uygulama/developer mimarisi içinde, güvenlik mekanizmalarını
aşmadan Android Auto'suz bir CarOS R-Link Client geliştirebileceğimiz kanıtlanmış bir
uygulama ortamı var mı?"

## **NO.**

Kanıtlanmış (VERIFIED/SUPPORTED, güvenlik bypass'ı olmadan) hiçbir uygulama ortamı — HTML5,
JavaScript, WLPK, WebLink, NetFront, iGO extension, resmi developer mechanism — **fullscreen
UI + touch + network** üçlüsünü bile birlikte sağladığını **kanıtlamıyor**. En yakın teorik
aday (iGO Luna/Lua) R-Link 2 build'inde **var olup olmadığı bile bilinmiyor**, varsa bile
kanıtlanan yetkisi UI-render ile sınırlı.

Bu **"kesin kapalı"** değil — **"kanıtlanmamış"** demektir. Kesinleştirmek için eksik olan
**tek şey:** gerçek bir R-Link 2 `.lgu` firmware dump'ı (VIN-gated) veya gerçek bir `.wlpk`
örneği. İkisi de public/read-only yollarla 3 araştırma turunda da elde edilemedi.
