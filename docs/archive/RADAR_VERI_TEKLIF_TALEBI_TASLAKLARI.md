# RADAR / EDS VERİSİ — TEKLİF TALEBİ TASLAKLARI (2026-08-13)

> Bu belge `docs/ADR_RADAR_DATA_SOURCE.md` EK C'nin uygulama tarafıdır.
> Köşeli parantezli alanlar (`[…]`) gönderilmeden önce doldurulmalıdır.
> Taslaklar **aynı dört soruyu** sorar — gelen cevaplar birebir karşılaştırılabilir.

**Doldurulacak alanlar (üç taslakta ortak):**
`[FİRMA ADI]` · `[AD SOYAD]` · `[UNVAN]` · `[TELEFON]` · `[E-POSTA]` ·
`[YILLIK CİHAZ ADEDİ TAHMİNİ]` · `[HEDEF PAZAR: Türkiye / Türkiye + …]`

---

## 1. BAŞARSOFT — Türkçe (iletişim formu veya e-posta)

**Kanal:** https://www.basarsoft.com.tr/iletisim/ → Konu: **"İş Geliştirme ve Satış"**
**Alternatif:** +90 312 473 70 80 (Ankara) · +90 216 324 70 80 (İstanbul)

**Konu:** Araç içi navigasyon ürünü için sabit radar / EDS veri lisansı talebi

---

Merhabalar,

`[FİRMA ADI]` olarak, araçlara satış sonrası (aftermarket) ve OEM kanalıyla
takılan **araç içi bilgi-eğlence ve sürüş asistanı platformu** geliştiriyoruz.
Ürün, head unit üzerinde **internet bağlantısı olmadan da çalışacak** şekilde
tasarlanmıştır.

Ürüne **sabit radar / EDS uyarısı** özelliğini eklemek istiyoruz ve bunun için
veri sağlayıcı değerlendirmesi yapıyoruz. Başarsoft'un Türkiye'deki harita ve
POI verisi ile EDS / seyyar radar katmanları bizim için birincil aday
konumunda.

Teklifinizi değerlendirebilmemiz için aşağıdaki dört başlıkta **yazılı** bilgi
rica ediyoruz:

**1) Kapsam (nokta sayısı)**
Aşağıdaki dört bölge için veritabanınızda kaç sabit radar / EDS noktası
bulunuyor?
- Mersin merkez – Tarsus arası D-400 koridoru
- Mersin ili geneli
- Adana ili geneli
- İstanbul ili geneli

*(Not: Bu dört bölgeyi kendi ölçümlerimizde referans olarak kullanıyoruz.)*

**2) Kayıt içeriği**
- Kayıtların yüzde kaçında **yön (istikamet)** bilgisi var?
- Yüzde kaçında **hız limiti** var?
- **Araç sınıfına göre** limit (kamyon / otobüs / minibüs) veriliyor mu?
- Kamera **tipi** ayrıştırılıyor mu (sabit hız · kırmızı ışık · ortalama hız
  koridoru · şerit ihlali)?
- Ortalama hız koridorlarında **başlangıç ve bitiş** noktaları eşleştirilmiş
  olarak veriliyor mu?

**3) Güncellik**
- Veri hangi sıklıkla güncelleniyor?
- **Kaldırılan** bir kamera veritabanınızdan ortalama ne kadar sürede düşüyor?
- Güncelleme cihaza nasıl ulaştırılıyor (paket indirme / çevrimiçi servis)?

**4) Lisans ve ticari model**
- Verinin **cihaza önceden yüklenmiş (gömülü) ve çevrimdışı** kullanımı lisans
  kapsamında mı?
- Ürünümüz **kapalı kaynak ve ticari olarak satılmaktadır**; bu dağıtım modeli
  kapsam içinde mi?
- Ücretlendirme **cihaz başı** mı, **yıllık sabit** mi, yoksa hacme bağlı mı?
  `[YILLIK CİHAZ ADEDİ TAHMİNİ]` adet/yıl büyüklüğü için gösterge fiyat
  paylaşabilir misiniz?
- Veriyi **başka bir kaynakla birlikte** kullanmamıza (aynı üründe ikinci bir
  veri katmanı bulunması) izin veriliyor mu?

Ayrıca mümkünse, değerlendirme amacıyla **yukarıdaki dört bölgeden birine ait
örnek veri** (birkaç düzine kayıt, tüm alanlarıyla) paylaşabilir misiniz?

Görüşme için uygun olduğunuz bir zaman aralığı belirtirseniz memnun oluruz.

Saygılarımızla,

`[AD SOYAD]`
`[UNVAN]` — `[FİRMA ADI]`
`[TELEFON]` · `[E-POSTA]`

---

## 2. SCDB.info (Eifrig Media GmbH) — İngilizce

**Kanal:** http://clients.scdb.info/ ("Apply for B2B License")
**E-posta:** info@scdb.info

**Subject:** B2B licence enquiry — fixed speed camera data for an embedded automotive product (Türkiye)

---

Dear SCDB team,

We are `[FİRMA ADI]`, developing an **in-car infotainment and driver assistance
platform** that ships pre-installed on aftermarket and OEM head units. The
product is designed to work **fully offline**, without a mobile data connection.

We are evaluating data providers for a **fixed speed camera / enforcement
warning** feature, with **Türkiye as our primary market** `[HEDEF PAZAR]`. Your
database appears to have the widest publicly visible coverage for Türkiye, which
is why we are approaching you.

To compare offers on equal terms, we would appreciate **written answers** to the
following four points:

**1) Coverage (number of points)**
How many fixed camera / enforcement records does your database contain for:
- the D-400 corridor between Mersin city centre and Tarsus,
- Mersin province,
- Adana province,
- Istanbul province?

*(We use these four areas as our internal benchmark.)*

**2) Record content**
- What percentage of records include a **direction / bearing**?
- What percentage include a **speed limit**?
- Are **vehicle-class-specific limits** provided (truck / bus / minibus)?
- Is the **camera type** distinguished (fixed speed · red light · average speed
  section · lane enforcement)?
- For average-speed sections, are **start and end points paired** in the data?

**3) Freshness**
- How frequently is the database updated?
- How long does it typically take for a **decommissioned** camera to be removed?
- How is the update delivered (bulk file download, server-to-server feed,
  online service)?

**4) Licence and commercial model**
- Does your licence cover **embedded, pre-installed, offline** use on a device
  (no online lookup at runtime)?
- Our product is **closed-source and sold commercially**, including through
  third-party head unit manufacturers. Is this distribution model covered?
- Is pricing **per device**, **annual flat fee**, or volume-based? Could you
  share an indicative price for approximately `[YILLIK CİHAZ ADEDİ TAHMİNİ]`
  devices per year?
- Are we permitted to **combine your data with another data source** within the
  same product (e.g. a second layer for cross-checking)?

If possible, we would also appreciate a **sample dataset** for one of the four
areas above (a few dozen records with all fields) for evaluation purposes.

We would be glad to arrange a call at your convenience.

Kind regards,

`[AD SOYAD]`
`[UNVAN]` — `[FİRMA ADI]`
`[TELEFON]` · `[E-POSTA]`

---

## 3. EGM / CİMER — resmî yazılı talep (bonus)

> ⚠️ `trafik.gov.tr/veri-talebi` sayfasındaki süreç **yalnız akademik
> çalışmalar** için tarif edilmiştir (üniversite rektörlüğü aracılığıyla).
> Ticari şirket için tanımlı bir kanal görünmüyor. Bu yüzden aşağıdaki metin
> **bilgi edinme / dilekçe hakkı** kapsamında, verinin **kullanım koşulunu
> öğrenmeye** yöneliktir — veri dosyası talebi değildir. Yasal yanıt süresi
> en geç **30 gün**dür.

**Kanal:** https://www.cimer.gov.tr (veya https://www.egm.gov.tr/bilgi-edinme)

**Konu:** EDS / sabit radar noktaları verisinin kullanım koşulları hakkında bilgi talebi

---

İlgili Makama,

Emniyet Genel Müdürlüğü tarafından kamuya açık olarak yayımlanan
**"EDS Harita"** uygulamasında
(https://onlineislemler.egm.gov.tr/trafik/Sayfalar/EDSHarita.aspx) sabit
denetim noktalarının konum bilgileri herkesin erişimine sunulmaktadır.

`[FİRMA ADI]` olarak, sürücü güvenliğini artırmayı amaçlayan **araç içi
sürüş asistanı** yazılımı geliştirmekteyiz. Yazılımın amacı, sürücüyü
yaklaşmakta olduğu denetim noktası ve o kesimdeki hız sınırı konusunda önceden
uyararak **hız ihlalini oluşmadan önlemektir**.

Bu kapsamda aşağıdaki hususlarda bilgi talep ediyoruz:

1. Anılan uygulamada yayımlanan konum verilerinin, **ticari bir yazılım ürünü
   içerisinde sürücü uyarısı amacıyla** kullanılması mümkün müdür? Kullanım
   için gereken izin veya protokol süreci nedir?
2. Söz konusu verinin **düzenli ve makine tarafından okunabilir** bir biçimde
   (örneğin veri seti veya servis) paylaşımı öngörülmekte midir?
3. Verinin kullanımı hâlinde uyulması gereken **atıf, güncelleme ve
   sorumluluk** koşulları nelerdir?
4. Ticari kuruluşların veri talebi için izlemesi gereken usul, `trafik.gov.tr`
   üzerinde tanımlı **akademik veri talebi** sürecinden farklı mıdır? Farklı ise
   hangi birime başvurulmalıdır?

Bilgilerinizi ve gereğini arz ederiz.

`[AD SOYAD]`
`[UNVAN]` — `[FİRMA ADI]`
`[TELEFON]` · `[E-POSTA]`

---

## GELEN CEVAPLARI KARŞILAŞTIRMA TABLOSU (doldur)

| Ölçüt | Referans (ölçülmüş) | Başarsoft | SCDB | Diğer |
|---|---|---|---|---|
| Mersin–Tarsus koridoru | OSM 0 · EGM 0 · SCDB 0 | | | |
| Mersin ili | OSM 4 · EGM 0 | | | |
| Adana ili | OSM 0 · **EGM ~85** | | | |
| İstanbul ili | OSM 182 · **EGM 473** | | | |
| Yön oranı | OSM %32 | | | |
| Hız limiti oranı | OSM %48 · EGM %0,5 | | | |
| Güncelleme sıklığı | OSM medyan 2,7 yıl · EGM 30 dk (iddia) | | | |
| Çevrimdışı gömülü lisans | OSM: serbest (ODbL) | | | |
| Fiyat modeli | OSM: 0 ₺ | | | |

**Kabul eşiği (ADR §6):** dört bölgede kamuya açık referansla aynı büyüklük
sınıfı **ve** kayıtların ≥%90'ında yön + hız limiti.
