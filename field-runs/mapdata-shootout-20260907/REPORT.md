# MAPDATA-F1 — Tarsus çok kaynaklı ölçüm (shootout) · 7 Eylül 2026

**Tek cümlelik hüküm:** Aynı Tarsus karosunda Overture, OSM'in **7.7 katı** bina
footprint'i taşıyor (yakın 400×400 m alanda **11 → 123**, yani cihazda boş görünen
alanın gerçek doldurucusu bu) — ama **yol adı kazancı sıfıra yakın (3 ad)**,
**adres kazancı negatif (0 kayıt)**, ve **bina kayıtlarının %100'ü kayıt düzeyinde
ODbL-1.0**, yani Overture'ın CDLA-Permissive dağıtım lisansı bina temasında
share-alike yükümlülüğünü KALDIRMIYOR.

## 1. Ölçüm sınırı ve tekrar üretim

Alan: z14 karo **14/9778/6381**, bbox
`[34.8486328125, 36.91476428895592, 34.87060546875, 36.93233006150314]` —
önceki denetimle (`../map-data-coverage-20260907/`) **birebir aynı**.
Yakın çevre ~400×400 m: `[34.85985, 36.9157, 34.86435, 36.9193]`.
Canonical nokta 36.9175 / 34.8621.

| Kaynak | Sürüm | Nasıl alındı |
|---|---|---|
| OSM | 6 Eyl 2026 çekimi | `../map-data-coverage-20260907/osm-api-map.json` (yeniden çekilmedi) |
| OpenFreeMap | paket `20260830_080001_pt` | `../map-data-coverage-20260907/summary.json` |
| Overture | **2026-08-19.0** | `s3://overturemaps-us-west-2/release/2026-08-19.0` · DuckDB httpfs+spatial |

Sıra: `python overture_extract.py` → `node analyze.mjs` → `shootout.json`.
Ham çekimler: `overture-buildings.json` (2627) · `overture-segments.json` (1559) ·
`overture-addresses.json` (0) · `overture-places.json` (337) · `overture-roof-probe.json`.

**Üretim kodu DEĞİŞMEDİ.** Bu faz yalnız ölçümdür.

## 2. Sonuç tablosu

| Kaynak | Buildings | Roads | Named Roads (ayrık ad) | Addresses | POI/Place | Incremental Gain | License Status |
|---|---:|---:|---:|---:|---:|---|---|
| OpenFreeMap (üretim tile) | 11 feature / **351 polygon** | 64 feature / 517 parça | 117 ad feature | **7** housenumber | 120 poi | taban | ODbL · offline paketleme hakkı **UNKNOWN** |
| OSM (upstream) | **340 way** | 564 way (138 adlı / 426 adsız) | 138 | 3 `addr:housenumber` | — | taban | ODbL-1.0 · share-alike |
| Overture 2026-08-19.0 | **2627** | 1559 segment | 527 segment / **3 yeni ayrık ad** | **0** | 337 place | **+2290 bina · +3 yol adı · −7 adres · +217 place** | **kayıt bazında karışık** (aşağıda) |

Bina/yol/adres sayıları **farklı sayım kurallarındadır** ve birebir çıkarılamaz
(§5 sınırlar). Karşılaştırılabilir olan **kaynak-içi dedup edilmiş artıştır**.

## 3. Gerçek artış (dedup edilmiş)

### 3.1 Bina — asıl kazanç burada

Overture'ın 2627 bina kaydı `sources[].dataset` alanıyla ayrıştırıldı:

| Alt kaynak | Kayıt | Kayıt lisansı |
|---|---:|---|
| Microsoft ML Buildings | **2290** | ODbL-1.0 |
| OpenStreetMap | 337 | ODbL-1.0 |
| **Toplam** | **2627** | **%100 ODbL-1.0** |

337 OSM kökenli kaydın tamamı bizim OSM kümemizle eşleşti → **çift sayım yok**.
**Gerçek incremental gain = 2290 bina** (hepsi ML türevi footprint).

**Yakın 400×400 m alan** (cihazda boş görünen yer):

| | OSM | OpenFreeMap üretim | Overture |
|---|---:|---:|---:|
| Bina | 11 | 11 polygon | **123** (112'si OSM dışı) |

### 3.2 Uydu çatı örnekleri — önceki denetimin açık sorusu

Önceki denetimde uydu z17 görüntüsünde seçilen üç çatının **hiçbiri** OSM veya
production polygon'una düşmüyordu; en yakın OSM bina köşesi 111–128 m uzaktaydı.

| Çatı | En yakın OSM köşesi (önceki) | En yakın Overture köşesi | 30 m yarıçapta Overture binası |
|---|---:|---:|---:|
| roof[0] (34.86148, 36.91838) | 111.2 m | **6.3 m** | 9 |
| roof[1] (34.86133, 36.91793) | 111.1 m | **14.7 m** | 4 |
| roof[2] (34.86164, 36.91821) | 128.3 m | **8.0 m** | 4 |

Üç noktanın hiçbiri bir Overture poligonunun **tam içine** düşmedi (nokta uydu
üzerinde ELLE, piksel hassasiyetiyle seçilmişti; ±10 m sapma beklenir). Ama
"en yakın bina 111–128 m ötede" durumu **6–15 m**'ye indi ve her noktanın 30 m
çevresinde 4–9 bina var. **Bu alanda bina verisi artık VAR** demek için yeterli;
"tam bu çatı şu poligondur" demek için yeterli DEĞİL.

### 3.3 Yol — kazanç yok denecek kadar az

Segment alt kaynakları: OpenStreetMap 1579 · TomTom 48.
Ayrık yol adı karşılaştırması:

- Yalnız Overture'da olan ad: **3** — `Mersin-Adana-Gaziantep yüksek standartlı
  demiryolu`, `Tarsus Batı 2 Kavşağı`, `Tarsus Üniversitesi - Tarsus Adliyesi
  Tramvay Hattı`. **Üçü de yerel sokak değil** (demiryolu · kavşak · tramvay).
- Yalnız OSM'de olan ad: **1** — `Kocatepe Caddesi`.

`Kocatepe Caddesi` yönü ayrıca öğreticidir: adı OSM'e **4 Eylül 2026**'da
eklendi; Overture'ın OSM anlık görüntüsü **2026-08-02**. Yani Overture da
OpenFreeMap gibi güncellik gecikmesi taşıyor — **Overture bu sorunu çözmüyor.**

Sonuç: **adsız yerel sokak problemi Overture ile ÇÖZÜLMÜYOR.** 426 adsız OSM
way'i Overture'da da adsız.

### 3.4 Adres — Overture bu bbox'ta DAHA KÖTÜ

| | OSM | OpenFreeMap tile | Overture |
|---|---:|---:|---:|
| Adres/kapı numarası | 3 `addr:housenumber` | 7 `housenumber` feature | **0** |

Overture `addresses` teması bu bbox için **sıfır kayıt** döndürdü (hata değil,
ölçülmüş sıfır). Türkiye için ulusal adres dataset'i Overture'a girmemiş.
**Adres kazancı için Overture doğru kaynak değildir.**

### 3.5 Place/POI — permissive ve gerçek artış var

337 place kaydı; alt kaynaklar: meta 309 · AllThePlaces 18 · Foursquare 6 ·
Microsoft 4. **OSM kökenli kayıt yok.** Üretim tile'ında 120 `poi` feature var
(ve stil bunların yalnız birkaç ailesini çiziyor).

Kayıt lisansları: **CDLA-Permissive-2.0 (650) · CC0-1.0 (18) · Apache-2.0 (6)** —
hepsi permissive, share-alike YOK.

## 4. Lisans bulgusu (F0 kaydını DÜZELTİR)

F0'da `OVERTURE` için tek bir kayıt yazılmıştı: `CDLA-Permissive-2.0`,
`shareAlike: false`. **Ölçüm bunu yanlışlıyor:**

| Tema | Kayıt düzeyi lisansı | share-alike |
|---|---|---|
| buildings | **ODbL-1.0 · 2627/2627** | **EVET** |
| transportation | **ODbL-1.0 · 1627/1627** | **EVET** |
| places | CDLA-Permissive-2.0 / CC0-1.0 / Apache-2.0 | HAYIR |

Overture'ın **dağıtım** lisansı permissive olabilir; **kayıtların taşıdığı** hak
temaya göre değişir ve bina/yol tarafında ODbL'dir. Bu yüzden lisans kapısı
kaynak kimliğine değil, **kayıt düzeyindeki `sources[].license` alanına**
bakmalıdır. F2 adapter'ı bu alanı taşıyacak ve `mapDataLicense` kaydı
tema/kayıt farkındalığıyla düzeltilecektir.

Pratik sonuç: bina footprint'lerini kullanmak **satışı engellemez** (ODbL ticari
kullanıma izinlidir) ama **türev veri kümesini ODbL ile yayımlama ve atıf
yükümlülüğü doğurur** — CarOS'un uygulama kodu etkilenmez, dağıtılan **veri
paketi** etkilenir.

## 5. Ölçüm sınırları (uydurma yok)

1. OSM tabanı `map.json?bbox` yanıtıdır: bbox içinde **en az bir düğümü** olan
   way'leri döndürür. Overture sorgusu feature-bbox kesişimidir. İkisi aynı
   sayım kuralı DEĞİLDİR; bu yüzden "2627 − 340" ham farkı değil, **dedup
   edilmiş 2290** rakamı kullanılmıştır.
2. OpenFreeMap sayıları **tile feature** sayısıdır; sağlayıcı geometrileri
   birleştirir (11 feature = 351 polygon). Feature ≠ bina.
3. **Microsoft ML Buildings gerçek bina KANITI değil, algoritma çıktısıdır.**
   Doğruluğu (false positive / geometri kalitesi) bu turda yer gerçeğiyle
   ölçülmedi. "2290 bina var" demek "2290 bina doğrudur" demek DEĞİLDİR.
   `height` alanı 2627 kaydın **0**'ında dolu (`num_floors` 22, `name` 13) —
   yani 3B yükseklik bu kaynaktan GELMEZ.
4. Üç çatı örneği uydu üzerinde elle seçilmiştir; alan geneli kapsam yüzdesi
   değildir ve piksel→koordinat dönüşümü ±10 m hata taşır.
5. Overture'ın OSM anlık görüntüsü 2026-08-02'dir; 4 Eylül OSM eklemeleri
   Overture'da da YOKTUR.
6. Cihaz/araç ölçümü YAPILMADI. Bu bir veri kümesi karşılaştırmasıdır;
   **CODE PASS ≠ DEVICE PASS ≠ FIELD PASS.**

## 6. Kararlar (F2 girdisi)

1. **İkinci kaynak = Overture, yalnız BUILDING teması.** Ölçülen kazanç
   bina tarafında 11→123 (yakın alan); yol ve adreste kazanç yok/negatif.
2. **Yol adı ve adres için Overture ingestion yapılmayacak** — kanıt yok.
   Yerel yol adı ve kapı numarası ayrı bir kaynak sorunudur (kamu/belediye
   verisi veya kendi saha toplamamız).
3. **Place teması ayrı bir fırsattır** (permissive lisans + 337 kayıt) ama
   POI/arama zinciri ayrı domaindir; F5 seam'i için not edildi.
4. **Lisans kapısı kayıt düzeyine inmelidir** (§4).
5. Overture bina yüksekliği YOKTUR → 3B extrusion için mevcut `render_height`
   davranışı korunur; Overture'dan yükseklik beklenmez.

---

Veri atfı: © OpenStreetMap katkıcıları (ODbL) · © Overture Maps Foundation ·
Microsoft ML Buildings (ODbL-1.0) · OpenMapTiles / OpenFreeMap · uydu © Esri.
Ölçüm verisi üretime gömülmedi.
