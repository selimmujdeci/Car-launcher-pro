# MAPDATA — YEREL SOKAK ADI EŞİK/ARALIK TARAMASI · Tarsus · 7 Eylül 2026

**Tek cümlelik hüküm:** Aralığı 460→240 düşürmenin kazancı **duran/tarama
kompozisyonuna (pitch 0) özgüdür** — orada z16'da **10 → 14 ayrık ad, sıfır
kayıp**; sürüş kompozisyonuna yakın pitch 45'te kazanç **+2'ye düşüyor ve bir ad
KAYBOLUYOR** (`0478. Sokak`). Ana arter adı 144 varyantın **hiçbirinde**
elenmedi. Eşiği z15'e indirmek ise ekrana **29–41 ayrık ad** basıyor — mevcut
z16 eşiği ölçümle doğrulandı. **Üretim kodu DEĞİŞMEDİ.**

---

## 1. Hangi boşluğu kapatıyor

Önceki denetim (`../map-data-coverage-20260907/REPORT.md` §5) `symbol-spacing`
460→100 ile z16'da 10→16 ad gösterdi ama kendi sınırını da yazdı:

> "Aralık değişimi anchor adaylarını da etkiler; daha küçük spacing önerisini
> production'a uygulamadık." · "bu deneyde ek collision kaybı kanıtlanmadı"

Yani **kaybolan ad ÖLÇÜLMEMİŞTİ**. Kütük **#1319** tam olarak bu boşluk için
açıldı. Bu tarama onu kapatır: her varyantta görünen ad KÜMESİ kaydedilip taban
(spacing 460) kümesiyle karşılaştırıldı → **kazanılan** ve **KAYBOLAN** adlar
ayrı ayrı çıkarıldı.

## 2. Yöntem ve önceki deneyden farkları

| | Önceki (audit §5) | Bu tarama |
|---|---|---|
| Stil | kaydedilmiş `style-day.json` | **kaynaktan derlendi** → F4'ün `housenumber` katmanı da çakışmaya katılıyor |
| Viewport | 904×406 | **904×406 + 800×480** (head unit hedefi) |
| Pitch | 0 | **0 ve 45** (sürüş kompozisyonuna yakın) |
| Zoom | 14 · 15 · 16 · 16.4 | **15 · 16 · 17** |
| Aralık | 460 ve 100 | **460 · 380 · 340 · 280 · 240 · 180** |
| Eşik | sabit 16 | **16 ve 15** (ayrı eksen) |
| Kayıp ölçümü | **YOK** | **VAR** (küme farkı) |
| Arter etkisi | ölçülmedi | **ölçüldü** (`road-label-major` kaybı) |

144 varyant · 0 harita hatası · kaydedilmiş gerçek z14 PBF'ler (üretimdeki gibi
z15–17'ye overzoom edilir).

Tekrar üretim: `node sweep.mjs` → `sweep-results.json`.

## 3. Aralık taraması (üretim eşiği minzoom 16)

Hücrelerde **ayrık yerel sokak adı sayısı**:

| viewport | pitch | z | 460 | 380 | 340 | 280 | 240 | 180 | En iyi **kayıpsız** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 904×406 | 0 | 16 | 10 | 10 | 11 | 12 | **14** | 14 | **240 → 14** |
| 904×406 | 0 | 17 | 2 | 2 | 3 | 4 | **5** | 5 | **240 → 5** |
| 904×406 | 45 | 16 | 15 | 14 | 15 | 17 | 17 | 18 | **460 → 15** |
| 904×406 | 45 | 17 | 5 | 4 | 4 | 6 | 5 | 5 | **460 → 5** |
| 800×480 | 0 | 16 | 10 | 10 | 11 | 11 | **13** | 14 | **240 → 13** |
| 800×480 | 0 | 17 | 4 | 2 | 3 | 4 | **5** | 4 | **240 → 5** |
| 800×480 | 45 | 16 | 16 | 17 | 16 | 17 | 18 | 19 | **380 → 17** |
| 800×480 | 45 | 17 | 5 | 4 | 4 | 5 | 5 | 4 | **460 → 5** |

**Kayıp GERÇEKTİR ve ölçüldü.** Örnekler:
- 800×480 · pitch 0 · z17: 460→**380** yapınca net **−2** (0 kazanç, **2 kayıp**).
- 904×406 · pitch 45 · z16: 460→240 net +2 ama `0478. Sokak` **kayboluyor**.

Aday değer **240**'ta isimleriyle fark:

| Sahne | Kazanılan | Kaybolan |
|---|---|---|
| 904×406 · p0 · z16 | 1951. · 1965. · 1971. Sokak · **Şamil Basayev Caddesi** | — |
| 904×406 · p0 · z17 | 0451. · 1965. · 1971. Sokak | — |
| 904×406 · p45 · z16 | 0403. · 1965. · 1971. Sokak | **0478. Sokak** |
| 800×480 · p0 · z16 | 1965. · 1971. Sokak · **Şamil Basayev Caddesi** | — |
| 800×480 · p45 · z16 | 0403. · 1965. · 1971. Sokak | **0478. Sokak** |

## 4. Üç yan bulgu

1. **Arter adı hiçbir varyantta elenmedi.** `road-label-major` kaybı
   **0/144**. Yerel aralığı düşürmek bu sahnede arter bağlamını yemiyor.
2. **Tekrar pratikte YOK.** 144 satırın yalnız **2**'sinde `instances >
   distinct`. Yani 460'ın asıl gerekçesi olan "aynı ad yol boyunca
   tekrarlıyor" bu sahnede, bu zoom'larda **bağlayıcı değil** — aralığın
   etkisi neredeyse tamamen anchor adayları üzerinden.
3. **Pitch, ad sayısını aralıktan daha çok değiştiriyor.** z16'da pitch 0 →
   10 ad, pitch 45 → 15–16 ad (aynı aralıkta). Önceki deneyin pitch 0'da
   yapılmış olması, sürüşteki gerçeği **sistematik olarak eksik** gösteriyordu.

## 5. Eşik ekseni (minzoom 16 → 15)

| viewport | pitch | z15 @ minzoom 16 | z15 @ minzoom 15 |
|---|---:|---:|---:|
| 904×406 | 0 | 0 | **29** |
| 904×406 | 45 | 0 | **41** |
| 800×480 | 0 | 0 | **29** |
| 800×480 | 45 | 0 | **41** |

Stil yorumundaki *"z15'te bile ekranı dolduruyordu"* gerekçesi **sayıyla
doğrulandı**. Eşiği düşürmek için gerekçe YOK; **z16 korunur**.

## 6. Hüküm — üretim NEDEN değiştirilmedi

Aday **240** her sahnede tabana eşit veya üstün (en kötü: pitch 45 z16'da
+2 kazanç / 1 kayıp). Yine de bu turda **uygulanmadı**, çünkü:

1. **Kazanç pitch 0'a özgü, kayıp pitch 45'te.** Sürüşte (pitch 45) 460 zaten
   kayıpsız en iyi değer. Kazancı güvenle almak **pitch'e duyarlı** bir aralık
   ister; `symbol-spacing` bir LAYOUT özelliğidir ve zoom ifadesi alabilir ama
   **pitch ifadesi alamaz**.
2. **Çalışma zamanında layout yazmak mimari invaryantı kırar.**
   `mapStyleBuilders` açıkça şunu kayda geçirmiş: `road-label` LAYOUT
   alanlarının runtime yazarı YOKTUR ve yol adı kısaltma ifadesi tam bu yüzden
   oraya güvenle konulabilmiştir. Aralığı moda göre yazmak o invaryantı
   bozar ve `text-field` ifadesini de riske atar.
3. **Bu bir HOST ölçümüdür.** Gerçek GPU, gerçek DPR, gerçek NAV runtime ve
   gerçek kamera yok. `cartographyAuthority` kilidi `symbol-spacing >= 420`
   ile bağlıdır ve o kilit **başka bir sahnede ölçülmüş** tekrar davranışını
   koruyor; tek karo/tek mahalle ölçümüyle gevşetilmez.

**Sonuç:** #1319 **🔴 kalır** ama artık kör değildir — cihaz deneyinin
hipotezi keskinleşti (§7).

## 7. Cihaz deneyi için keskin hipotez (#1319)

Cihazda **yalnız iki değer** karşılaştırılsın: **460 (bugün)** ve **240**.

Beklenen (host ölçümü):
- **Duran araç / BROWSE, pitch ~0, z16:** 240 ile **+3…+4 ayrık ad**, kayıp
  YOK. Kazanılan adlar isimleriyle biliniyor (`1951.` · `1965.` · `1971. Sokak`
  · `Şamil Basayev Caddesi`) → cihazda **bu adlar aranır**.
- **Sürüş / NAV, pitch ~45, z16:** 240 ile **+2 ad ama `0478. Sokak` KAYBOLUR**
  → cihazda bu adın kaybı **doğrudan kontrol edilir**.
- **Arter adı:** her iki değerde de AYNI kalmalı (host'ta 0/144 kayıp).

Kabul ölçütü: 240 ancak **(a)** BROWSE'da kazanç GÖZLE görülür, **(b)** NAV'da
kaybolan ad sürücü için kritik değil, **(c)** arter adı elenmiyorsa uygulanır —
ve uygulanırsa `cartographyAuthority` kilidi yeni ölçülmüş değere
**GÜNCELLENİR (kaldırılmaz)**.

## 8. Ölçüm sınırları

1. **CİHAZ KANITI DEĞİLDİR.** Headless Chromium + SwiftShader, DPR 1.
2. `queryRenderedFeatures` **yerleşim** çıktısıdır; piksel/okunabilirlik
   doğrulaması değildir. Yerleşen etiket, güneş altında okunur demek değildir.
3. **Tek sahne**: Tarsus merkez, kaydedilmiş 9 z14 karosu. Farklı dokuda
   (ızgara plan, kırsal, otoyol koridoru) sonuçlar değişebilir — özellikle
   "tekrar pratikte yok" bulgusu sahneye bağlıdır.
4. `symbol-spacing` CSS px cinsindendir; DPR yerleşimi CSS px uzayında
   değiştirmemelidir — ama bu **cihazda doğrulanmadı**, varsayım olarak
   işaretlenmiştir.
5. Pitch 45 sürüş kamerasının **yaklaşık** karşılığıdır; gerçek kamera eğrisi
   hıza bağlıdır (`cameraPolicyModel`) ve bu taramada modellenmedi.

---

Veri atfı: © OpenStreetMap katkıcıları / OpenMapTiles / OpenFreeMap (ODbL).
Ölçüm verisi üretime gömülmedi.

---

# EK — #1318 KAPI NUMARASI: ÇAKIŞMA VE VERİ KALİTESİ (aynı harness)

**Hüküm:** Kapı numarası katmanı **48/48 sahnede hiçbir etiketi elemedi**;
numaralar veri olan yerde gerçekten çiziliyor (z17'de 2, z18'de 4); kanonik
noktada 0 çıkması **doğru davranıştır**. Ayrıca ölçüm gerçek bir veri kusuru
ortaya çıkardı — upstream'de kapı numarası alanına yazılmış **telefon numarası**
— ve buna karşı uzunluk filtresi eklendi.

## E1. Çakışma ölçütü (#1318 kabul ölçütü 3)

Kütükteki ölçüt cihaz GEREKTİRMEZ: aynı stil/karo/viewport'ta katman
AÇIK/KAPALI iki koşu yeterlidir. 48 sahne (2 tema × 2 viewport × 2 merkez ×
2 pitch × 3 zoom):

| merkez | pitch | z | yerel ad KAPALI→AÇIK | major KAPALI→AÇIK | yerleşen numara | kayıp |
|---|---:|---:|---|---|---:|---|
| kanonik | 0 | 16 | 10 → 10 | 0 → 0 | 0 | YOK |
| kanonik | 0 | 17 | 2 → 2 · 4 → 4 | 0 → 0 | 0 | YOK |
| kanonik | 45 | 16 | 15 → 15 · 16 → 16 | 1 → 1 | 0 | YOK |
| numara kümesi | 0 | 17 | 2 → 2 | 1 → 1 | **2** | YOK |
| numara kümesi | 0 | 18 | 2 → 2 | 1 → 1 | **4** | YOK |
| numara kümesi | 45 | 17 | 2 → 2 | 1 → 1 | **2** | YOK |
| numara kümesi | 45 | 18 | 2 → 2 | 1 → 1 | **4** | YOK |

**KAYIP GÖZLENEN SAHNE: 0 / 48** (gündüz ve gece). Katman sırasının en altta
olması işe yarıyor: numara hiçbir sokak adını ve hiçbir arter adını elemiyor.

**z16'da yerleşen numara 0** → `minzoom 17` sözleşmesi host'ta doğrulandı.

## E2. Kanonik noktada numara ÇIKMAMASI doğru davranıştır

İlk koşu kanonik nokta (36.9175/34.8621) çevresinde **24/24 sahnede 0 numara**
verdi. Bu bir kusur değildir: audit §6 zaten *"yakın 400×400 m çevrede numara 0"*
diyordu. Kaydedilmiş karolardaki numaraların gerçek konumları çıkarıldı; en
yoğun küme **34,87115 / 36,92690** çevresinde (`4` · `6` · `8` · `10`).

> **Cihaz testi için kritik uyarı:** #1318'i kanonik noktada denemek
> **YANILTIR** — orada hiç numara yoktur. Test **34,87115 / 36,92690**
> noktasında yapılmalıdır.

## E3. VERİ KALİTESİ KUSURU — telefon numarası kapı numarası olarak

Dokuz üretim karosundaki **32** `housenumber` kaydı tarandı. Biri:

```
14-9779-6381.pbf  "03246245701"  34.886345, 36.923162
```

Bu bir **telefon numarasıdır** ve upstream'de `addr:housenumber` alanına
yazılmıştır. Filtresiz katman onu kapı numarası gibi basardı.

**Eklenen filtre:** `["<=", ["length", ["to-string", ["get","housenumber"]]], 8]`

Doğrulama (`housenumber-filter-check.mjs`, gerçek karolar):

| | |
|---|---:|
| Toplam kayıt | 32 |
| Filtreden **geçen** | **31** |
| **Reddedilen** | **1** (`03246245701`) |
| En uzun kabul edilen değer | `22/D` (4 karakter) |

Eşik neden 8: ölçülen meşru değerlerin tamamı ≤ 4 karakter; 8 iki kat pay
bırakır ve `12/A-3` gibi bileşik numaraları kesmez. **İçerik kalıbına
BAKILMAZ** — Türkçe adreste `22/D` gibi harfli numaralar meşrudur.

Bu **uydurma değil, çekimserliktir**: filtre değer ÜRETMEZ, yalnız makul
olmayanı çizmez.

**Kilitler (ikisi de mutasyonla kanıtlandı):** `cartographyAuthority` ve
`regression.guards` filtrenin varlığını denetler; filtre kaldırıldığında
ikisi de düşer, geri konunca geçer.

## E4. #1318'de cihazda kalan ne?

Host bu ölçütleri KAPATTI: numara veri olan yerde çiziliyor · z16'da
çizilmiyor · hiçbir sokak/arter adını elemiyor · veri olmayan yerde uydurma
numara basmıyor.

**Cihazda kalan (🔴):** gerçek DPR'de metin boyutu ve okunabilirliği · güneş
altında kontrast · mini haritada gerçekten görünmemesi · rehberlik sırasında
opaklık hiyerarşisinin gözle doğrulanması · 800×480 gerçek panelde taşma.
