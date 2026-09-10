# GUARDIAN — KALAN ÜÇ KURALIN VERİ/SAĞLAYICI ÖLÇÜMÜ (2026-08-14)

> **Görev (SIRA 2):** hava · viraj geometrisi · yorgunluk — *"önce veri/sağlayıcı
> durumunu ölç, hangisi gerçekten bağlanabilir hangisi lisans bekliyor ayır."*
>
> Bu belge **ölçümdür, uygulama değildir.** Hiçbir ürün davranışı değişmedi;
> kod yazılmadı. G1/G3'e dokunulmadı.

---

## 0. SONUÇ TABLOSU (üç cümlelik özet)

| Kural | Veri var mı? | Bağlanabilir mi? | Gerçek engel |
|---|---|---|---|
| **Yorgunluk** (`driver-fatigue`) | ✅ VAR, üründe akıyor | 🟢 **BUGÜN** | Yok — yalnız wiring işi |
| **Hava** (`weather`) | ✅ VAR, üründe akıyor | 🟡 **Teknik olarak bugün** | 🔴 **LİSANS** — sağlayıcı ticari kullanıma kapalı |
| **Viraj** (`curve-risk`) | ❌ YOK | 🔴 **HAYIR** | Kuralın ZORUNLU girdisi Türkiye'de **%0 kapsamlı** |

**Sürpriz bulgu:** üçünden ikisinin verisi zaten vardı; engel sanılan yerde
değildi. Buna karşılık "geometriden hesaplarız" sanılan viraj kuralı, kendi
sözleşmesi gereği **hesaplamayı yasaklıyor**.

---

## 1. YORGUNLUK — 🟢 BUGÜN BAĞLANABİLİR

### Kuralın istediği (`driverFatigueRule.ts`)

| Alan | Zorunlu mu | Üründe var mı |
|---|---|---|
| `continuousDrivingMinutes` | hayır (tek başına olay üretir) | ✅ `breakReminder` native olayı (`drivingMinutes`) |
| `tripDurationMinutes` | hayır (tek başına olay üretir) | ✅ `tripLogService.durationMin` |
| `localHour` | hayır (gece penceresi olayı) | ✅ trivial (DI ile verilir) |
| `lowAttentionSignal` · `repeatedLaneCorrectionSignal` · `microsleepSuspectedSignal` | **hayır** | ❌ sürücü izleme kamerası gerekir |

**Kritik nokta:** kural üç süre/saat sinyalinin **her birinden BAĞIMSIZ olarak**
olay üretir (`>=critical / >=high / >=elevated` kademeleri). Boolean sinyaller
ayrı ve opsiyoneldir → **kamera olmadan da kural çalışır.**

### Kanıt: veri gerçekten akıyor

- `nativePlugin.ts` → `addListener('breakReminder', { drivingMinutes })`
  — **ölü değil**, `useLayoutServices.ts:207`'de dinleniyor.
- `tripLogService.ts` → `durationMin`, kaynağı **monotonik saat**
  (`performance.now()`, `durationSource: 'MEASURED'`) → saat sıçramasına bağışık.
- `companionEngine` zaten *"Mola önerisi — sürüş > breakReminderIntervalMin
  (vars. 2 saat)"* yapıyor; yani sinyal ürün seviyesinde **kullanılıyor bile**.

### Dolayısıyla

Yorgunluk kuralı için gereken **tek şey `DriverSource` implementasyonudur** —
yeni veri, yeni sağlayıcı, yeni lisans, yeni donanım **GEREKMEZ**.

> ⚠️ **Dikkat — ikinci otorite riski:** `companionEngine` mola önerisini ZATEN
> veriyor. Guardian da verirse sürücü **aynı şey için iki kez** uyarılır. Bu
> kuralı bağlamak bir wiring işi değil, **otorite kararıdır**: mola uyarısının
> sahibi kim? Bu karar alınmadan bağlanmamalı.

---

## 2. HAVA — 🟡 VERİ VAR, LİSANS YOK

### Sürpriz: sağlayıcı zaten üründe

İlk taramada "hava veri sağlayıcısı yok" sanılmıştı; **yanlıştı**.
`src/platform/weatherService.ts` **canlı** ve şunları sağlıyor:

- **Open-Meteo API** (anahtarsız), 15 dk önbellek
- `code` (**WMO hava kodu**) · `temperature` · `humidity` · `windSpeed` · `isDay`

Kuralın istediği `surfaceCondition` (enum) bu alanlardan **türetilebilir**
(WMO kodu + sıcaklık → kuru/ıslak/kar/buz). Yani teknik engel yok.

### 🔴 GERÇEK ENGEL: TİCARİ LİSANS

Open-Meteo'nun ücretsiz katmanı **yalnız ticari OLMAYAN kullanım içindir**;
ticari kullanım **ücretli abonelik gerektirir** (Standard/Professional/Enterprise).
Veri CC-BY 4.0'dır (atıf yeterli) ama **servis kullanımı** ayrı bir sözleşmedir.

CarOS Pro **ticari olarak satılacak** bir üründür (CLAUDE.md ticari lisans
kuralı: *"Non-Commercial (NC) varlıklar … EKLENMEZ"*).

> **⚠️ BU YENİ BİR RİSK DEĞİL — MEVCUT BİR RİSKTİR.** Ürün Open-Meteo'yu
> **bugün zaten kullanıyor** (hava kartı + `getWeatherNarrative` + çevrimdışı
> sohbet motoru). Yani Guardian hava kuralını bağlamak riski *yaratmaz*,
> yalnız **büyütür** (kullanım hacmi ve kritiklik artar).
>
> Bu bir **iş/hukuk kararıdır**, teknik karar değildir. Seçenekler:
> 1. Open-Meteo **ticari plan** satın al (aylık ücret) → engel kalkar.
> 2. Ticari kullanıma açık başka sağlayıcıya geç (BYOK deseni — her müşteri
>    kendi anahtarı, CLAUDE.md'nin AI sağlayıcıları için zaten koyduğu kural).
> 3. Hava kuralını **bağlama** ve mevcut hava kartını da gözden geçir.

**Karar alınmadan Guardian hava kuralı bağlanmamalıdır** — çünkü bağlamak,
lisanssız bir kaynağı *güvenlik kararına* sokmak olur.

---

## 3. VİRAJ GEOMETRİSİ — 🔴 BAĞLANAMAZ

### Kuralın kendi sözleşmesi hesaplamayı YASAKLIYOR

`curveRiskRule.ts` girdi sözleşmesi birebir şöyle diyor:

- `advisorySpeedKph` → *"G2'de risk üretmenin **TEK** kaynağı — yoksa risk
  ÜRETİLMEZ."*
- `radiusMeters` → *"Sözleşmede TAŞINIR … G2'de **HİÇ OKUNMAZ** (radius'tan hız
  türetme **YASAK**)."*

Yani *"rota geometrisinden viraj yarıçapı hesaplarız"* yolu **kapalıdır** ve
bu bilinçli bir karardır (yarıçaptan sahte hassas bir "güvenli hız" türetmemek).
Kural, yolun **ilan edilmiş tavsiye hızını** ister.

### Ölçüm: o veri Türkiye'de yok

Overpass, O-4 Anadolu Otoyolu koridoru (bbox 40.5,30.5 → 41.0,32.5, ~170 km):

| Ölçüm | Sonuç |
|---|---:|
| `maxspeed:advisory` taşıyan yol | **0** |
| Karşılaştırma: `highway=motorway` parçası | **236** |
| **Kapsam** | **%0,00** |

*(Ayna: `overpass.kumi.systems`, veri tarihi 2026-07-17. `overpass-api.de`
tekrarlanan sorgularda hız sınırladı — ölçüm aynadan alındı.)*

### Sonuç

Viraj kuralı **veri bekliyor, lisans değil**. Açılmasının üç yolu var, üçü de
bu turun kapsamı dışında:

1. **Ticari harita sağlayıcısı** (HERE/TomTom/Başarsoft) — tavsiye hızı ve viraj
   geometrisi ticari veri setlerinde vardır; radar ADR'sindeki aynı pazarlık.
2. **Kural sözleşmesini değiştirmek** — yarıçaptan hız türetmeyi serbest bırakmak.
   Bu, kuralın bilinçli olarak reddettiği şeydir; değiştirilecekse ayrı ve
   gerekçeli bir karar olmalı (sahte hassasiyet riski).
3. **OSM'e katkı** — gerçekçi değil (ülke ölçeğinde etiketleme işi).

---

## 4. ÖNERİLEN SIRA (karar vericiye)

| Sıra | İş | Neden |
|---|---|---|
| **1** | **Yorgunluk** — ama önce **otorite kararı** (`companionEngine` mi Guardian mı?) | Tek gerçekten hazır kural; engeli teknik değil, tasarımsal |
| **2** | **Hava** — önce **lisans kararı** (plan al / sağlayıcı değiştir / bağlama) | Veri hazır, engel tamamen hukuki; karar 3 seçenekten biri |
| **3** | **Viraj** — ticari sağlayıcı görüşmesine **ekle** (radar ile aynı masa) | Bugün yapılabilecek bir şey yok |

---

## 5. BU TURDA YAPILMAYANLAR (bilinçli sınır)

- Kod yazılmadı, hiçbir kural bağlanmadı, hiçbir ürün davranışı değişmedi.
- `DriverSource` / `WeatherSource` implementasyonu **yazılmadı** — ikisi de
  önce bir karar bekliyor (otorite / lisans).
- G1/G3 dosyalarına **dokunulmadı**.
- Open-Meteo'nun mevcut kullanımı **değiştirilmedi** — yalnız risk RAPORLANDI.

---

*Ölçüm: 2026-08-14 · Kaynak sorguları `overpass.kumi.systems` · İlgili:
`docs/ADR_RADAR_DATA_SOURCE.md` (aynı ticari sağlayıcı masası)*
