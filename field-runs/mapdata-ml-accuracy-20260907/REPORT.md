# MAPDATA — ML FOOTPRINT DOĞRULUK ÖRNEKLEMİ · Tarsus · 7 Eylül 2026

**Tek cümlelik hüküm:** Kör örneklemde Microsoft ML footprint'lerinin **açık
yanlış pozitif oranı %5 (1/20)** çıktı — ama n=20'de %95 güven aralığı
**[%0,9 – %23,6]**, yani "sabah kapısı" olarak konan **%10 eşiği bu örneklemle
GEÇİLEMEDİ, ELENEMEDİ de: sonuç KARARSIZ.** Buna karşılık örneklem gerektirmeyen
nesnel ölçüm net: ML footprint'lerinin **medyan alanı 73 m²**, aynı alandaki
insan çizimi OSM footprint'lerinin medyanı **162 m²** — ML kümesi bina alanını
**sistematik olarak ~2,2 kat küçük** temsil ediyor.

---

## 1. Neden bu ölçüm yapıldı

`../mapdata-shootout-20260907/REPORT.md` Tarsus'ta Overture'ın OSM'e göre
**+2290 bina** (yakın 400×400 m alanda 11 → 123) getirdiğini ölçtü. Bu kazancın
**2290'ının tamamı Microsoft ML Buildings** kökenli, yani **algoritma
çıktısıdır, yer gerçeği değildir.** Devir belgesindeki sabah kapısı şuydu:

> "Yanlış pozitif oranı %10'un üstündeyse renderer entegrasyonu **askıya alınır**
> — bu ölçüm olmadan bina kazancı ürün kararına giremez."

Bu tur o kapıyı ölçmek için yapıldı. **Üretim kodu değişmedi.**

## 2. Yöntem

| | |
|---|---|
| Görüntü | Esri World Imagery (ArcGIS Online), **z18** · 20 karo mozaik · 1024×1280 px |
| Çözünürlük | ~**0,48 m/px** (bu enlemde z18 karo ≈ 122 m) |
| Zoom tavanı | z19 ve z20 bu konumda **2521 B yer tutucu** döndürdü → gerçek görüntü tavanı z18 |
| Footprint kaynağı | `src/__tests__/fixtures/mapdataTarsusNear.json` (F1 ölçümünden türetilmiş GERÇEK Overture kayıtları) |
| Havuz | Mozaik içine tamamen düşen **119 bina** (ML 109 · OSM kökenli 10) |
| Örneklem | **20 ML + 5 OSM kontrol** · deterministik tohum **20260907** · sıra karıştırıldı |
| Körlük | Hücreler yalnız 1..25 numaralı; köken eşlemesi `sample-key.json`'a yazıldı ve **hüküm verilene kadar okunmadı** (`blind-verdicts.json` önce yazıldı) |
| Geçişler | 1. geçiş 25 hücre @ ~0,24 m/px görsel; düşük güvenli 9 + belirsiz 5 hücre için 2. geçiş @ ~0,10 m/px görsel (yukarı örnekleme) |

**Neden kontrol grubu:** ML'in hata oranı tek başına anlamsızdır. Aynı sayfada,
ayırt edilemez biçimde duran insan çizimi OSM footprint'leri değerlendiricinin
katılığını kalibre eder.

**Görüntü artefaktları repoya GİRMEDİ** (`.gitignore`): Esri karoları ve
onlardan üretilen `contact-sheet.png` / `zoom-sheet*.png` üçüncü taraf
içeriktir ve yeniden dağıtım hakkı kanıtlanmamıştır — `mapDataLicense`
kapısının fail-closed kuralı burada da uygulandı. Betikler ve
`mosaic-provenance.json` (URL + SHA-256) ile birebir yeniden üretilebilirler.

Tekrar üretim: `node build-sheet.mjs` → `node render-sheet.mjs` →
(gerekirse `node build-zoom.mjs "4,5,11"` → `node render-zoom.mjs`) →
`node score.mjs` → `node stats.mjs`.

## 3. Hüküm sözlüğü

| Hüküm | Anlamı |
|---|---|
| **VAR** | Çerçeve görüntüde bir bina/çatı yapısının ÜZERİNDE |
| **KAYIK** | Yakında bina var ama çerçeve belirgin kaymış / şekli tutmuyor / çatıdan çok bahçeyi kapsıyor |
| **BELİRSİZ** | Altındaki yüzeyin bina mı (teras · müştemilat · avlu · düz dam) olduğu **0,48 m/px'te ayırt edilemiyor** |
| **YOK** | Boş zemin / bitki örtüsü / yol; görünür yapı yok |

## 4. Sonuç

| Grup | n | VAR | KAYIK | BELİRSİZ | YOK | VAR % | Açık kusur % | En kötü % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **ML (Microsoft)** | 20 | 14 | 0 | 5 | **1** | 70,0 | **5,0** | 30,0 |
| **OSM (kontrol)** | 5 | 4 | **1** | 0 | 0 | 80,0 | 20,0 | 20,0 |

"Açık kusur" = YOK + KAYIK. "En kötü" = belirsizlerin tamamı da kusur sayılırsa.

**%95 Wilson güven aralıkları** (küçük n'de normal yaklaşımdan doğru):

| Ölçüt | Nokta | %95 GA |
|---|---:|---|
| ML yanlış pozitif (YOK) | %5,0 | **%0,9 – %23,6** |
| ML açık kusur | %5,0 | %0,9 – %23,6 |
| ML en kötü (belirsizler dâhil) | %30,0 | %14,5 – %51,9 |
| OSM açık kusur | %20,0 | %3,6 – %62,4 (n=5, bilgi taşımaz) |

Tek yanlış pozitif **hücre 5**: çerçevenin içi çevredeki toprak zeminle aynı
tonda, görünür çatı yok. Tek KAYIK ise **hücre 15** ve o bir **OSM** kaydı —
insan çizimi de kusursuz değil.

## 5. Örneklem gerektirmeyen nesnel ölçüm — ALAN DAĞILIMI

Aynı 400×400 m alandaki TÜM footprint'ler (göz kararı yok, saf hesap):

| Küme | n | min | p25 | **medyan** | p75 | max | ortalama |
|---|---:|---:|---:|---:|---:|---:|---:|
| Overture **ML** | 112 | 12 | 37 | **73 m²** | 113 | 480 | 92 |
| Overture **OSM kökenli** | 11 | 122 | 162 | **162 m²** | 320 | 531 | 245 |
| **OSM upstream** (aynı 11) | 11 | 122 | 162 | **162 m²** | 320 | 531 | 245 |

İki gözlem:

1. **Overture'ın OSM kopyaları upstream ile BİREBİR aynı** (medyan 162 m²
   her ikisinde) → Overture OSM geometrisini bozmuyor.
2. **ML footprint'leri sistematik olarak küçük.** Medyan 73 m² vs 162 m²
   (~2,2 kat). Görsel değerlendirmede de aynı örüntü görüldü: çerçeveler
   sık sık büyük bir çatının yalnız BİR BÖLÜMÜNÜ kapsıyordu (hücre 1 · 9 ·
   13 · 20 · 22). ML kümesi binayı **uydurmuyor, EKSİK ÇİZİYOR.**

Bu, ürün açısından yanlış pozitiften farklı bir risktir: harita "olmayan bina"
göstermez ama binaları **gerçekte olduğundan küçük ve parçalı** gösterir.

## 6. Kapı hükmü

**Sabah kapısı (yanlış pozitif > %10 → askıya al) BU ÖLÇÜMLE KAPANMADI.**

- Nokta tahmini %5 eşiğin altında, ama **GA üst sınırı %23,6 eşiği aşıyor.**
  n=20 bu kararı vermeye yetmiyor.
- Eşiğe güvenle karar vermek için gereken örneklem: gerçek oran ~%5 ise
  GA üst sınırını %10'un altına indirmek **n ≈ 150–200** ister.
- Ayrıca **%25 BELİRSİZ** oranı bir veri kusuru değil, **görüntü çözünürlüğü
  kusurudur**: 0,48 m/px'te teras/müştemilat/düz dam ayrımı yapılamıyor.
  Daha yüksek çözünürlüklü görüntü olmadan bu belirsizlik kapanmaz ve
  Esri bu konumda z18'in üstünü vermiyor.

**Öneri (karar kullanıcınındır):** renderer entegrasyonu **askıda kalsın**;
ama gerekçe artık "bilmiyoruz" değil, **iki somut ölçüm**: (a) yanlış pozitif
kararsız, (b) alan temsili sistematik olarak küçük.

## 7. Ölçüm sınırları (uydurma yok)

1. **Görüntü tarihi BİLİNMİYOR.** Footprint ile görüntü uyuşmazlığı "footprint
   yanlış" DEĞİL, "görüntü daha eski/yeni" de olabilir. Microsoft ML kaydının
   `update_time` alanı **2015-02-06**'dır; Esri görüntüsünün tarihi ilan
   edilmiyor.
2. **Değerlendirme görseldir**, yer gerçeği değildir. Sokakta ölçüm yapılmadı.
3. **n=20** küçüktür; tüm oranlar geniş güven aralığı taşır.
4. 2. geçişteki büyütme **yukarı örneklemedir** — kaynak çözünürlük (0,48 m/px)
   değişmedi, yalnız okunabilirlik arttı.
5. Örneklem **tek mahalledir** (Tarsus, yoğun konut dokusu). Kırsal, sanayi
   veya yeni gelişen alanlarda oranlar farklı olabilir.
6. Kontrol grubu n=5'tir ve **hiçbir şey kanıtlamaz**; yalnız değerlendirici
   katılığını kalibre etmek için vardır.

## 8. Yan bulgu — ÖLÇÜM ARACINDA HATA (üretim ETKİLENMEDİ)

İlk kontak sayfası **ATILDI**: ölçüm betiğinin kendi centroid hesabı lon/lat
koordinatları üzerinde doğrudan shoelace uyguluyordu ve **katastrofik kayan
nokta iptali** üretiyordu (çarpım terimleri ~1287, toplamları ~1e-9). Ölçülen
sapma 25 hücrenin **24'ünde >3 px**, en kötüsünde **11 px'lik bir bina için
302 px**. Çerçeveler yanlış yerlerde çiziliyordu.

**Üretim kodu bu hatadan ETKİLENMEZ:** `mapdata/resolvers/buildingGeometry`
`polygonCentroid` hesabı önce `makeLocalFrame`/`toLocalXY` ile metre uzayına
geçer. Repoda başka bir `polygonCentroid` tanımı YOKTUR (tarandı).

Bulgu kalıcı kilide çevrildi: `mapDataBuildingFusionF3.test.ts` →
*"🔒 ağırlık merkezi YEREL ÇERÇEVEDE hesaplanır (lon/lat shoelace YASAK)"*.
**Kilit kör değildir:** yerel çerçeve kaldırıldığında 8 test düştü (yeni kilit
dâhil), geri alınınca 22/22 geçti.

---

Veri atfı: © Overture Maps Foundation · Microsoft ML Buildings (ODbL-1.0) ·
© OpenStreetMap katkıcıları (ODbL) · uydu görüntüsü © Esri World Imagery
(yalnız ölçüm amaçlı görüntülendi; ürüne gömülmedi, yeniden dağıtılmadı).

---

# EK — GENİŞLETİLMİŞ ÖRNEKLEM: n=20 → n=215, İKİ BÖLGE (2026-09-07 sabah)

**Tek cümlelik hüküm:** n=189 ML (iki farklı urban morphology, iki bölge)
ile yanlış pozitif **%95 Wilson GA [%0,83 – %5,31]** — **sabah kapısı (>%10 →
askıya al) artık GEÇİLDİ, kapı ELENDİ: COVERAGE PASS.** Ama alan bias'ı HER
İKİ bölgede de doğrulandı ve ikinci bölgede (yoğun apartman) DAHA KÖTÜ
(2,19× → 3,16× küçültme) — **GEOMETRY FAIL.** Ayrık hüküm: **COVERAGE PASS /
GEOMETRY FAIL.** Renderer entegrasyonu (Building Fusion → Shadow Tile)
**bu turda başlatılmadı.**

## Neden n=20 yetersizdi, n=189 nasıl elde edildi

Önceki turun kendi hükmü: *"gerçek oran ~%5 ise GA üst sınırını %10'un
altına indirmek n≈150-200 ister."* Bu tur o hedefi karşıladı:

| Bölge | Doku | ML havuzu | ML örneklem | OSM örneklem |
|---|---|---:|---:|---:|
| **Region 1 — Tarsus** | Düşük yoğunluklu, bahçeli/müstakil parsel | 109 (mozaik içi) | **109 — HAVUZUN TAMAMI** | 11 — TAMAMI |
| **Region 2 — Mersin merkez** | Yoğun apartman bloğu, düzenli sokak ağı | 381 (mozaik içi) | **80 — hedefli kör örneklem** | 15 — hedefli |
| **Toplam** | 2 farklı morfoloji | — | **189** | **26** |

Region 1'de HAVUZUN TAMAMI örneklendi (109/109 — seçim yanlılığı YOK, örneklem
=populasyon). Region 2 merkez koordinatı (34.6339, 36.8121) bina aranarak
DEĞİL, bilinen bir kentsel merkez referansı olarak seçildi; bbox içindeki
TÜM 402 mozaik-içi binadan kör/tohum'lu örneklem (80 ML + 15 OSM) alındı.

Aynı yöntem: deterministik tohum 20260907, körlük (`sample-key-*.json` hüküm
verilene kadar okunmadı), aynı hüküm sözlüğü (VAR/KAYIK/BELİRSİZ/YOK), aynı
kontrol grubu mantığı (OSM-kökenli Overture kayıtları). Görüntü Esri World
Imagery z18 (~0,48 m/px kaynak, 2× görsel büyütme) — REPORT §2'deki sınırlar
AYNEN geçerli (görüntü tarihi bilinmiyor, değerlendirme görseldir).

## Sonuç — kapsam (coverage)

| Grup | n | VAR | KAYIK | BELİRSİZ | YOK | VAR% | Wilson %95 GA (YOK) |
|---|---:|---:|---:|---:|---:|---:|---|
| **ML — Region1** | 109 | 78 | 0 | 30 | 1 | 71,6 | — |
| **ML — Region2** | 80 | 66 | 0 | 11 | 3 | 82,5 | — |
| **ML — TOPLAM** | **189** | 144 | 0 | 41 | 4 | 76,2 | **[0,83 – 5,31]** |
| OSM — Region1 | 11 | 11 | 0 | 0 | 0 | 100 | — |
| OSM — Region2 | 15 | 14 | 0 | 1 | 0 | 93,3 | — |
| **OSM — TOPLAM** | **26** | 25 | 0 | 1 | 0 | 96,2 | [0 – 12,87] (açık kusur) |

**Nokta tahmini %2,12 (4/189), GA üst sınırı %5,31 — %10 eşiğinin KESİN
ALTINDA.** n=20 turunda GA üst sınırı %23,6 idi; 9,4×'lük örneklem büyümesi
GA'yı ~4,4× daraltı. Bu istatistiksel olarak beklenen sonuçtur, şans eseri
değil.

**"En kötü durum" (belirsizler de kusur sayılırsa): %95 GA [%18,3 – %30,4].**
Bu hâlâ yüksek ama devir belgesinin zaten teşhis ettiği **görüntü çözünürlüğü
kusurudur** (0,48 m/px'te teras/müştemilat/düz dam ayrımı yapılamıyor), veri
kusuru değil — daha yüksek çözünürlüklü referans olmadan kapanmaz.

**Region 2'de açık kusur oranı (%3,8) Region 1'den (%0,9) yüksek** ama hâlâ
%10 eşiğinin altında; tek KAYIK/YOK örneği yoğun apartman dokusunda daha sık
çıktı (park/açık alan üzerine düşen 2 net YOK: bir spor sahası, bir boş
meydan — REPORT ekinde hücre 5, 13, 42 olarak işaretli).

## Sonuç — geometry (footprint kalitesi) — GENELLENDİ, KÖTÜLEŞTİ

Örneklem gerektirmeyen, TÜM havuz üzerinden hesap (`area-bias.mjs`):

| Bölge | ML medyan | OSM medyan | **Oran (OSM/ML)** | ML n | OSM n |
|---|---:|---:|---:|---:|---:|
| Region 1 — Tarsus | 74 m² | 162 m² | **2,19×** | 112 | 11 |
| Region 2 — Mersin | 135 m² | 426 m² | **3,16×** | 407 | 28 |

**Sistematik küçültme İKİ FARKLI dokuda da doğrulandı — bu "genelleniyor mu"
sorusunun kesin YANITIDIR: evet.** Yoğun apartman dokusunda (Region 2) oran
DAHA KÖTÜ — muhtemelen büyük apartman bloklarının ML modeli tarafından
parçalara bölünmesi/eksik yakalanmasıyla tutarlı (Region 2 kontak sayfasında
görsel olarak da gözlemlendi: büyük bir çatının yalnız bir bölümünü kapsayan
çerçeveler Region 1'den daha sık).

## OSM-origin vs ML-origin — ayrık güven

Overture'ın **OSM-kökenli** kayıtları (upstream OSM ile birebir, `record_id`
taşıyan) HER İKİ bölgede de neredeyse kusursuz: Region1 %100 VAR (11/11),
Region2 %93,3 VAR (14/15, kalan 1 BELİRSİZ — hiç YOK/KAYIK yok). **ML-kökenli
kayıtlar için durum belirgin biçimde farklı** (VAR %71,6–%82,5, sistematik
alan küçültmesi). Bu iki köken **AYNI güven seviyesinde değerlendirilmemeli**
— öneri BUILDING GATE hükmünde.

## BUILDING ACCEPTANCE POLICY değerlendirmesi

| Politika şartı | Sonuç |
|---|---|
| False-positive oranı düşük + GA kabul edilebilir | ✅ **PASS** — %2,12 nokta, GA üst sınırı %5,31 < %10 |
| Büyük sistematik geometry shrink/bias kabul edilebilir seviyeye insin | ❌ **FAIL** — 2,19×–3,16× küçültme, İKİ bölgede de, düzelmedi |
| İkinci bölgede sonuç tamamen bozulmasın | ✅ **KISMİ** — coverage bozulmadı (%82,5 VAR), geometry DAHA KÖTÜLEŞTİ |
| Provenance ayrımı korunsun | ✅ **PASS** — ML/OSM ayrımı her ölçümde korundu |
| ODbL/lisans kapısı geçerli olsun | ✅ **PASS** — `mapDataLicense` fail-closed, kod okunarak doğrulandı (değiştirilmedi) |

**OVERALL: COVERAGE PASS / GEOMETRY FAIL → Building Fusion → Shadow Tile
Pipeline'a GEÇİLMEDİ.** Politika VE koşuludur: coverage tek başına yeterli
değildir.

## Öneri (karar kullanıcının) — test kanıtıyla desteklenmiş

1. **Renderer entegrasyonu bu turda da askıda kalmalı** — artık gerekçe
   "belirsiz" değil, **iki ayrı ölçülmüş neden**: (a) coverage yeterli AMA
   (b) geometry sistematik ve genellenmiş biçimde bozuk.
2. **Kaynak-kalite ayrımı düşünülmeli:** OSM-kökenli Overture gözlemleri
   ML-kökenlilerle AYNI güven puanıyla değerlendirilmemeli — ölçülen kanıt
   bunu net destekliyor (OSM-kökenli VAR %93-100, ML-kökenli VAR %72-83 +
   sistematik alan bias'ı). **Somut bir puan/katsayı burada ÖNERİLMİYOR** —
   test kanıtı ayrımın YÖNÜNÜ gösteriyor, büyüklüğünü değil.
3. **ML footprint kullanılacaksa** (renderer DIŞINDA, ör. LAB gözlem amaçlı)
   alan bilgisi "gerçek ayak izi" gibi SUNULMAMALI — sistematik küçültme
   kullanıcıyı yanıltır.

## Ölçüm sınırları (uydurma yok)

REPORT §7'deki tüm sınırlar (görüntü tarihi bilinmiyor, değerlendirme
görseldir, n hâlâ sonsuz değildir) AYNEN geçerli. Ek sınırlar:
- Region 2 merkezi TEK bir kentsel morfoloji örneğidir (yoğun apartman);
  "kırsal/yeni gelişen" üçüncü doku bu turda ÖLÇÜLMEDİ.
- Region 2'nin görüntü mozaiği ayrı indirildi (aynı Esri kaynağı, aynı z18);
  provenance `mosaic-provenance-r2.json`'da ayrı kayıtlı.
- Değerlendirici (Claude) HER İKİ turda da AYNI kişi/model — değerlendirici
  içi tutarlılık var ama ikinci bağımsız değerlendirici YOK (inter-rater
  güvenilirliği ölçülmedi).

Veri atfı: © Overture Maps Foundation · Microsoft ML Buildings (ODbL-1.0) ·
© OpenStreetMap katkıcıları (ODbL) · uydu görüntüsü © Esri World Imagery
(yalnız ölçüm amaçlı görüntülendi; ürüne gömülmedi, yeniden dağıtılmadı,
repoya girmedi).
