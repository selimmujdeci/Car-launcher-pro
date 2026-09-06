# HANDOFF — NAVİGASYON GÖRSEL / KARTOGRAFYA OTURUMU

**Tarih:** 2026-09-06
**Branch:** `feat/fleet-offline-final-local-completion`
**HEAD:** `8f79d649` — *fix(thermal): otomasyon kullanıcı API'sini çağırıyordu*
**Kirli dosya:** 52 (aşağıda tam liste ve kaybolma riski)
**Mod:** CONTROLLED EVOLUTION · Faz A (Developer First)
**Bu rapor:** yeni hesap eski konuşmayı GÖREMEZ. Devam için gereken her şey burada.

> ⚠️ Bu oturumda **hiçbir commit atılmadı** (HEAD oturum başındaki yerinde).
> Tüm kartografya, chrome ve tasarım işi **çalışma ağacında duruyor.**
> Depoda başka oturumların da kirli işi var (media/music, native) — **seçici**
> davranın. `git reset --hard` · `git clean` · `git add .` · toplu revert YASAK.

---

## 0 · BİR SAYFADA DURUM

| Alan | Durum |
|------|-------|
| P0-A (stil yaşam döngüsü / raster flaş) | ✅ **CİHAZDA KAPANDI** — kök neden FPS termal mandalıydı |
| P0-B (çift kamera komutu / sahte user-pan) | ✅ **CİHAZDA KAPANDI** — tek üretici, `originalEvent` kapısı |
| Soluk rota (`#b0ccf1`) | ✅ **CİHAZDA KAPANDI** — sebep `terrain` draping'iydi |
| Termal toast seli | ✅ **CİHAZDA KAPANDI** — commit `8f79d649` (tek commit) |
| Gündüz amber cast | ✅ Üretimde uygulandı · 🔴 kullanıcı görsel onayı bekliyor (#1304) |
| Yol hiyerarşisi 2→5 kademe | ✅ Üretimde + cihazda ölçüldü · 🔴 görsel onay (#1308) |
| Gece yerel yol geri çekilmesi | ✅ Üretimde + cihazda ölçüldü (genişlikle, tonla DEĞİL) |
| Chrome tek ray + güneş modu muafiyeti | ✅ Üretimde + cihazda ölçüldü · 🔴 görsel onay (#1309) |
| Etiket bütçesi (`road-label` z16) | ✅ Üretimde · 🔴 z16–17 görsel onayı yok (#1310) |
| **Ticari navigasyon görsel sistemi** | ⚠️ **KAVRAM TAMAM (%80) — ÜRETİME AKTARILMADI** |
| 800×480 head unit | ❌ TEST EDİLMEDİ |
| REAL VEHICLE FIELD | ❌ YAPILMADI |

---

## 1 · YAPILAN İŞLER VE ALINAN KARARLAR

### 1.1 Cihazda kapatılan P0'lar (kanıtlı)

Hepsi Xiaomi 23090RA98I üzerinde, `adb` + CDP ile ölçüldü. Kanıtlar
`field-runs/nav-device-20260906-after/` altında (Astra'nın ÖNCE kanıtları
`field-runs/nav-device-20260906/` — **üzerine yazılmadı**).

**P0-A — MINI→FULL raster/vektör flaşı.** Astra'nın teşhisi eksikti: sebep
ısı değil, FULL haritanın açılıştaki tek düşük-FPS örneğiydi. Mandal tek
örnekle kapanıp raster'a düşüyordu. Yeni saf model
`src/platform/map/core/fpsThermalLatchModel.ts` — **simetrik kanıt** (3 ardışık
örnek) + yüzey oturma kapısı. Ölçüm: `setStyle` 4→2 · `style.load` 3→1 ·
raster gözlemi 0 · `tileRender-intent` 0.

**P0-B — çift kamera komutu + programatik olayın USER_PANNING sayılması.**
Dört ayrı `enterNavigationView` üreticisi teke indirildi
(`if (drivingMode) requestFollow('NAV_START')`), `style.load` artık kamerayı
sürmüyor, `_onInteractStart/End` yalnız `e.originalEvent` taşıyan olayı kabul
ediyor (yeni ortak kapı `src/platform/map/bindMapUserInteraction.ts`), HUD zoom
kendini `{originalEvent:true}` ile bildiriyor. Ölçüm: 1 giriş komutu · 0 çift ·
0 programatik→USER_PANNING · gerçek pan + recenter + otomatik dönüş doğru.

**Soluk rota — hipotezim YANLIŞTI, deney doğruyu buldu.** Önce `car-route-flow`
katmanını suçladım; cihazda opaklığını 0'a çekmek **hiçbir şeyi değiştirmedi**.
Tek değişkenli deney (`line-color:#FF0000` + `setTerrain(null)`) gerçek sebebi
gösterdi: **`terrain` bildirildiğinde MapLibre tüm vektör katmanlarını ayrı
framebuffer'a çiziyor ve bu cihazda efektif alfa ~0,27'ye düşüyordu** — rota
değil haritanın tamamı yıkanıyordu. `terrain` + `terrain-rgb` kaldırıldı.
Sonuç: boya ↔ render birebir (`#e9eef3→#e9eef3`, rota `#006bfe`). Kütük #1305.

> **DERS (yeni oturum için):** Bu oturumda üç kez aynı kusur sınıfı çıktı —
> *bir koruma mekanizması kanıt yerine VEKİL sinyalle (saat, tek FPS örneği)
> tetikleniyor ve giriş/çıkış ölçütleri asimetrik.* Ayrıca
> `MapLayerManager.ts` içinde **`isStyleLoaded()` kapısının ÜÇÜNCÜ kopyası**
> bulundu (#1306): navigasyon sırasında o bayrak neredeyse hep `false`'tur,
> `map.once('idle')` kurtarması ise sürüşte HİÇ çalışmaz. Bu dosyada yeni kapı
> eklerken bunu hatırlayın.

### 1.2 Kartografya kararları (üretimde uygulandı)

- **YAPI NÖTR, ANLAM KROMATİK.** Zemin · bina · kasa · yol gövdesi nötr
  (215°, ≤%4 kroma). Su mavi · doğa yeşil · rota mavi. Amber `#E0A23C`
  YALNIZ chrome ve aktif durumda — yolda ASLA.
- **Hiyerarşiyi KASA + GENİŞLİK taşır, gövde beyaz kalır.** Bu, kullanıcının
  2026-09-05 cihaz kararıdır ve `routeNightContrast` (≥1,9) ile bağlıdır.
- **Gecede geri çekilme TONLA DEĞİL GENİŞLİKLE.** `GECE_YEREL = 0.72`
  (minor·service) · `GECE_UCUNCUL = 0.84` (tertiary) —
  `mapStyleBuilders.ts:830-831`. Kasa genişliği aynen bırakıldı → koyu kılıf
  oransal kalınlaşır, parlak çekirdek incelir. Cihazda ölçüldü (gece z16):
  otoyol 14,5 · ikincil 7,35 · üçüncül 4,96 · tali 2,88 px.
- **5 kademeli yol merdiveni.** `tertiary` kendi kasasını
  (`road-tertiary-casing`), kendi gövde tonunu ve dar rampasını aldı.
  Ölçülen kasa/zemin merdiveni: **2,61 · 2,30 · 2,00 · 1,72 · 1,51**.
- **Etiket bütçesi.** `road-label` minzoom 15→**16**, `symbol-spacing`
  340→**460**. Katman SIRASI DEĞİŞTİRİLMEDİ — ters çevirme denendi,
  `cartographyAuthority` kilidi yakaladı (`pauseable_placement` listeyi
  **SONDAN** tarar; sonra gelen katman ÜSTÜNDÜR).
- **Tek zemin token'ı.** Gündüz zemini için iki çatışan token vardı
  (`MAP_BG_DAY` vs vektör `#f2efe6`) → `MAP_BG_DAY_VECTOR = MAP_BG_DAY`.
- **Canlı palet + tek stil adı.** `applyMapDayNight` artık `setStyle`
  çağırmadan paleti diff'leyerek uyguluyor; ad tek kaynaktan
  (`vectorStyleName()`) yazılıyor. Ölçüm: 27/27 satırda UI ↔ ad sapması **0**.

### 1.3 Chrome kararları (üretimde uygulandı)

- Sağ kontroller **beş ayrı kutudan TEK RAYA** alındı: tek yüzey + tek kenar +
  tek gölge; iç düğmeler saydam, çerçevesiz, gölgesiz. Dokunma hedefi 52 px
  KORUNDU (cihazda 142×52 ve 52×52 ölçüldü).
- Sol hızlı-hedef kartlarının SABİT koyu dolgusu (`rgba(10,14,26,0.28)`) OEM
  yüzey token'ına bağlandı.
- **`sunlight-mode` suçlusu bulundu:** `index.css`'teki
  `.sunlight-mode button { border: 2px solid #000; font-weight: 700 }`.
  Harita yüzeyi (`[data-theme-surface="nav"]`) muaf tutuldu; dashboard/dock
  güneş okunabilirliği AYNEN korundu. Ara turda bir kusur daha yakalandı:
  muafiyet kenarı SABİT siyah yazıyordu, gece kartının koyu yüzeyinde
  görünmüyordu → `var(--oem-line-strong)`.

---

## 2 · TİCARİ NAVİGASYON GÖRSEL SİSTEMİ — KAVRAM

Kullanıcı önce sentetik ızgaralı bir tasarımı **reddetti**
(*"gerçek dünyaya uygun olması lazım... sen harita mühendisisin"*). Sistem
sıfırdan **gerçek vektör karo verisi** üzerine kuruldu.

### 2.1 Canonical 6 artboard

| # | Artboard | Boyut | İçerik |
|---|----------|-------|--------|
| 1 | `Main.dc.html` | 904×406 | Sürüş — gündüz · 6 etiket |
| 2 | `NavNight.dc.html` | 904×406 | Sürüş — gece · 6 etiket |
| 3 | `Maneuver.dc.html` | 904×406 | Manevra 120 m kala + şerit rehberi · 4 etiket |
| 4 | `Browse.dc.html` | 904×406 | Keşif gündüz (rota yok) · 8 etiket |
| 5 | `BrowseNight.dc.html` | 904×406 | Keşif gece · 8 etiket |
| 6 | `MiniMap.dc.html` | 440×210 | Mini harita widget · 2 etiket |

**PNG karşılıkları (2x, 1808×812):**
`field-runs/carto-2026-09-06/f-{Main,NavNight,Maneuver,Browse,BrowseNight,MiniMap}.png`

**Yayımlanmış bağlantılar:**
- Tasarım tuvali (6 artboard + 7 mühendislik notu):
  `https://claude.ai/code/artifact/0818c589-1e09-4f5e-85a1-ca2f9b9ce70e`
  (contract `0.1.31` · favicon 🧭 · **yetenekler temizlendi** — salt görüntüleme)
- Sade paylaşım sayfası:
  `https://claude.ai/code/artifact/48905d85-8119-47a0-9a47-a2ff6d03de37`
- ⚠️ İkisi de **`sharing: owner`** (özel). Dışarı açma yalnız sayfanın kendi
  Paylaş menüsünden yapılır; yayımlama arayüzünde erişim parametresi YOK.
  Kullanıcı bunu denedi, açılmadı → muhtemelen kurum politikası. PNG'ler
  yedek çözümdür.

### 2.2 Üretici dosyalar — `field-runs/carto-2026-09-06/`

| Dosya | Görev |
|-------|-------|
| `gen.mjs` | Karo indirme · `tileToLL` · yerel metre çerçevesi · kamera · tampon · palet |
| `scene.mjs` | Rota zincirleme/temizleme · perspektif sahne · oklüzyon maskesi · kuş bakışı |
| `labels.mjs` | Bütçeli etiket motoru (çapalı yerleştirme, 4 eleme kuralı) |
| `manevra.mjs` | Rota geometrisinden manevra/ETA çıkarımı |
| `frame.mjs` | CarOS chrome bileşenleri + `.dc.html` sarmalayıcı |
| `build.mjs` | 6 kareyi üretir · `TUVAL=<dizin>` ile artboard yazar |
| `olc.mjs` / `olcall.mjs` | Bant bant parlaklık + yapı kontrastı ölçümü |
| `galeri.mjs` | Paylaşım için sade statik sayfa |
| `preview.mjs` | Eski 3 kareli önizleme (build.mjs onun yerini aldı) |
| `schema.mjs` · `schema-inventory.{json,md}` | Gerçek vektör şema envanteri |

**Komutlar:**
```bash
cd "field-runs/carto-2026-09-06"
node build.mjs                          # 6 PNG üretir
TUVAL=<dizin> node build.mjs            # ayrıca .dc.html artboard yazar
node olcall.mjs f-Main.png              # sis/kontrast ölçümü
```

### 2.3 Gerçek veri katmanı

- **Kaynak:** OpenFreeMap planet (`https://tiles.openfreemap.org/planet`),
  OpenMapTiles şeması. **`maxzoom = 14`** — daha derin geometri BU KAYNAKTA YOK.
- **Çözücü:** `@mapbox/vector-tile` + `pbf` (ikisi de BSD-3, satışa uygun).
- **Dönüşüm:** tile px → lon/lat → Web Mercator → yerel metre
  (`/ (1/cos(lat0))`), sonra rota yönüne döndürme (ego merkezli, rota yukarı).
- **Sahne:** Kadıköy — **29.0300 E, 40.9900 K**. Yol/ad/su/yeşil 3×3 karo,
  bina 5×5 karo.
- **Ölçülen içerik:** 2363 yol · 1617 ad · 380 bina · 156 su · 783 yeşil.
  Yol sınıf dağılımı: minor 741 · primary 326 · service 318 · path 251 ·
  trunk 248 · secondary 179 · tertiary 160 · busway 48.
- **Bina ayak izi (ölçüldü):** medyan uzun kenar **26 m** · p90 **47 m** ·
  maks 250 m. Yani z14 verisi GERÇEK bina geometrisidir — ilk turdaki
  "dev levha" izlenimi **kamera hatasıydı**, veri hatası değil.

### 2.4 Kamera — tahmin değil, geri çözüm

Perspektif gerçek bir pinhole kamera (nadir'den pitch `P`, odak `F` px):

```
y_cam = (Y+d)·cosP + (Z−h)·sinP
z_cam = (Y+d)·sinP + (h−Z)·cosP
sx = CX + F·x/z_cam        sy = CY − F·y_cam/z_cam
ufuk: sy → CY − F/tanP     ⇒     CY = ufuk + F/tanP
```

Parametreler **görsel ölçütlerden analitik çözüldü** (`calib.mjs` + elde
türetme), elle seçilmedi:

| Görünüm | pitch | h | d | F | ufuk | Sonuç |
|---------|-------|---|---|---|------|-------|
| Sürüş | 60° | 60 m | 150 m | 692 | y=52 | ego y=352 · 100 m y=247 · 200 m y=196 · 600 m y=123 · FOV 66° |
| Manevra | 57° | 58,1 m | 90,7 m | 700 | y=−110,4 (kadraj dışı) | ego y=340 · 160 m y=90 · gök yok |
| Mini | 55° | 31,7 m | 63,5 m | 224,4 | y=26 | ego y=150 · 150 m y=71 |

> **İki kez elle kamera seçtim, iki kez ego kadraj dışına düştü** (y=518 ve
> y=267). Ölçüt yazıp çözünce bir daha olmadı. Yeni kamera gerekirse
> `calib.mjs` desenini kullanın.

**Kritik ayrıntı:** `cam.z0` = ego'nun kamera derinliği (`d·sinP + h·cosP`).
Etiket menzili `z_cam − z0` ile hesaplanır — ham `z_cam` kullanmak menzilleri
`z0` kadar kaydırır (bu hata yaşandı, etiket 9→2'ye düştü).

### 2.5 Rota

- **Zincirleme (`chain`)**: OMT geometrisi karo sınırında kesilir; tek parça
  rota DEĞİLDİR. Uç noktaları ≤12 m yakın parçalar, düzlük (`cos ≥ 0,55`) ve
  ad eşleşmesi puanlanarak zincirlenir (her uçta ≤24 adım).
- **Temizleme (`temizle`)**: zincir açgözlüdür, paralel/geri parçayı
  yakalayabilir. Baş açısı **>130°** dönen ya da 8+ adım öncesine **<25 m**
  yaklaşan tepe noktasında zincir KESİLİR.
- **Yön seçimi:** ego'nun ÖNÜNDE kalan yol arkadakinden kısaysa dizi çevrilir.
- **Mevcut sahne rotası:** Kuşdili Cd. üzerinde, **830 m sonra sola
  Kurbağalıdere Cd.**, kalan 1116 m / 2 dk. Bunların hepsi geometriden
  hesaplandı — `manevra.mjs`.
- **Manevra eşiği:** birikimli baş açısı ≥32°, menzil 1200 m, gürültü sönümü
  ×0,72. Dönülecek yolun adı 90 m içindeki `transportation_name`'den;
  yoksa **`UNKNOWN`** (sahte ad ÜRETİLMEZ).

### 2.6 3B bina

- Gerçek ayak izi + `render_height` / `render_min_height`. Duvarlar uzaktan
  yakına sıralanır, ön/arka yüz ayrı tonlanır, çatı ayrı.
- **`BINA_MENZIL = 900 m`** (`scene.mjs`). Menzilin **son %15**'inde
  saydamlıkla silinir — sert kesim çizgisi yok.
- Görünmeyen geometri elenir: `alan(roof) < 9` · duvar `alan < 6` · yol
  `alan(pb) < 3`. Bina cephesi tam sayı koordinatla yazılır (`ptsI`) — dosya
  boyutu yarı yarıya düştü (1,67 MB → 0,51 MB).

### 2.7 Etiket motoru

- **Bütçe:** sürüş 6 · keşif 8 · mini 2. Sıra: sınıf → yakınlık → ekrandaki
  uzunluk.
- **Menzil (ego'dan metre):** arter 700 · cadde 600 · üçüncül 430 ·
  yerel sokak 300.
- **Çapalı yerleştirme:** ekran içi parçanın **5 konumu** denenir
  (%50 · %35 · %65 · %22 · %78); ilk temiz olan kazanır. Sabit orta noktayla
  bütçe dolmuyordu (4/6).
- **Dört eleme kuralı** (dördü de gerçek bir hatadan doğdu):
  1. **Kütlenin arkasındaki ad yazılmaz** — bina siluetlerinin dışbükey
     kabuğundan 8 px ızgaraya derinlik maskesi. *(Önce bbox denendi:
     9 etiketten 1'i kaldı — yanlıştı.)*
  2. **Rotanın üzerine ad yazılmaz** (±34×22 px itme).
  3. **Chrome panelinin altına ad yazılmaz** — yasak dikdörtgenler panel
     kutularının GERÇEK piksellerinden hesaplandı.
  4. **Döndürülmüş metnin kutusu kadraja TAM sığmalı.**
- **Kısaltma:** Caddesi→Cd. · Sokağı→Sk. · Bulvarı→Bul. · Mahallesi→Mah. ·
  Meydanı→Mey. · Köprüsü→Köp. · Otoyolu→Oto. Özel ada dokunulmaz.
  *(Not: JS `\b` sınırı Türkçe `ğ/ı` sonrası tutmaz — regex yerine
  son-token eşlemesi kullanıldı.)*

### 2.8 Çizim sırası ve BİLİNÇLİ TEK OKLÜZYON İHLALİ

```
zemin → alan (yeşil/su) → yol kasası → yol gövdesi → ROTA → 3B binalar
```

Bina uzaktaki YOLU kapatır — bu doğru oklüzyondur. Ama **ROTA binadan ÖNCE**
çizilmez; rota yer düzleminde yaşar ve binadan **SONRA** basılır: ticari
navigasyonda rota kaybolmaz, hiçbir kütle onu gizleyemez. **Sistemdeki tek
kasıtlı geometri ihlali budur ve tek gerekçesi görev kritikliğidir.**

### 2.9 Gündüz sisi — ölçüldü ve kesildi

Kullanıcı: *"gündüz modu sisli gibi."* Bant bant ölçüldü
(ortalama parlaklık + yapı kontrastı = std sapma):

| Bant (px) | Gündüz ÖNCE | Gece (referans) | Gündüz SONRA |
|-----------|-------------|-----------------|--------------|
| ufuk 52–90 | 174,7 / 92,3 | 48,2 / 42,8 | 173,3 / 91,7 |
| uzak 90–160 | 194,5 / 71,6 | 72,5 / 62,3 | 174,8 / 67,7 |
| orta 160–260 | 198,0 / **30,2** | 57,0 / 34,9 | 184,8 / 33,3 |
| yakın 260–400 | 205,2 / 40,7 | 58,2 / 39,7 | 196,1 / **44,1** |

**Teşhis:** sis bir "görünüş" değil, **dar dinamik aralık**. Tüm gündüz
sahnesi 184–255 arası 71 basamağa sıkışmıştı; gece aynı sahne 44–255'e
yayılıyor.

**Üç sebep, üç kesim:**
1. Bina saydamlığı menzilin %42'si boyunca sönüyordu → **%15**.
2. Sis bandı %92 opaklık × 54 px → **%55 × 38 px**.
3. **Asıl sebep:** 520 m ötesinde HİÇ bina yoktu ve gündüzde zemin 237 ile
   yol 255 arasında kontrast yok. Gece aynı yer 44/255 olduğu için
   parlıyordu. → **Menzil 900 m.** (520/900/1400 denendi; 900'de PNG bile
   küçüldü, 1400 ek fayda vermedi.)

Ayrıca gündüz **bina** tonları açıldı: çatı `#dcdee1`→`#ced3d8`, duvarlar
`#c6cace`/`#b4b8bd`→`#b6bcc3`/`#a0a7af`.
⚠️ **Zemin ve yol tonlarına DOKUNULMADI** — onlar 2026-09-05 cihaz kararı ve
`mapDayPaletteContrast` kilidine bağlı.

---

## 3 · ÜRETİM MapLibre'A HENÜZ AKTARILMAYAN İŞLER

Bunların hepsi **yalnız `field-runs/carto-2026-09-06/` içinde kavram olarak
var**; `src/` altında karşılığı YOK:

| Kavram | Üretimdeki durum | Aktarma zorluğu |
|--------|------------------|-----------------|
| Çözülmüş kamera parametreleri (pitch 60 · zoom/uzaklık ilişkisi) | Üretimde kamera `MapInteractionManager` + `cameraCompositionModel`'de; pitch tek sayı olarak orada değil | ORTA — MapLibre `pitch`/`zoom` ikilisine dönüştürme gerekir |
| 3B bina görsel dili (menzil, solma, duvar/çatı ayrımı) | `building-3d` katmanı **VAR** (`mapStyleBuilders.ts:1018`, minzoom 16, `fill-extrusion-vertical-gradient: true`) ama menzil/solma yok | KOLAY — paint ifadesiyle |
| Etiket oklüzyon maskesi | MapLibre kendi collision motorunu kullanır; 3B bina oklüzyonunu HESABA KATMAZ | ZOR — MapLibre'de doğrudan karşılığı yok; `symbol-z-elevate` / bütçe ile yaklaşılabilir |
| Etiket çapalı kaydırma | MapLibre `symbol-placement: line` zaten kaydırır | KOLAY — mevcut davranış yeterli olabilir |
| Ad kısaltma (Caddesi→Cd.) | YOK | ORTA — `text-field` ifadesinde `let/case` ya da veri ön-işleme |
| Manevra kartı / şerit rehberi / ETA / hız tasarımı | `NavigationHUD` var ama bu tasarım uygulanmadı | ORTA — React/CSS |
| Gök + sis bandı | Üretimde `sky` katmanı yok | KOLAY — MapLibre `sky` katmanı |
| Rota zincirleme/temizleme | Üretimde rota provider'dan gelir (zincirleme GEREKMEZ) | GEREKSİZ |
| Manevra çıkarımı | Üretimde `navigationService` sağlar | GEREKSİZ |

> **Not:** Tasarımdaki `bufferPx` (ekran-piksel kasa) MapLibre'de zaten
> doğaldır — `line-width` px cinsindendir. Bu kavramın aktarılmasına
> GEREK YOK; tasarım tarafındaki bir modelleme düzeltmesiydi.

---

## 4 · MEVCUT P0 STYLE / CAMERA DURUMU

**STYLE — ✅ STABİL.** Cihazda ölçüldü:
- `setStyle` 4→2 · `style.load` 3→1 · raster gözlemi **0** · `tileRender-intent` **0**
- Gün/gece geçişi artık `setStyle` çağırmadan **canlı palet diff**'iyle
  (`applyMapDayNight`), ad `vectorStyleName()` ile senkron (27/27 sapma 0)
- `terrain` ve `raster-dem` KALDIRILDI — boya ↔ render birebir
- `_moodApplied` WeakMap harita örneğine bağlı (zombi örnek yok)

**CAMERA — ✅ STABİL.** Cihazda ölçüldü:
- Tek üretici: `if (drivingMode) requestFollow('NAV_START')`
- 1 giriş komutu · 0 çift `easeTo` · 0 programatik→USER_PANNING
- `style.load` kamerayı SÜRMÜYOR
- `bindMapUserInteraction` tek kapı; yalnız `e.originalEvent` taşıyan olay
  kullanıcı sayılır
- #1276 manevra kaynağı kapısı · #1277 `maxZoomHint` · F0-B8 temizliği KORUNDU

**Korunması gereken otoriteler (yeni oturum BUNLARA DOKUNMASIN):**
`MapStore` · `mapSourceManager` · `cameraFollowAuthority` · `cameraPolicyModel`
· `cameraEngine` · `MapInteractionManager` · `navMarkerMotionRuntime` ·
`navigationSessionRuntime` · CEH sınırları.
**Yeni kamera FSM · yeni GPS aboneliği · yeni scheduler · yeni rota otoritesi ·
bağımsız stil otoritesi KURULMAZ.**

---

## 5 · AÇIK LEDGER MADDELERİ (`docs/DEVICE_VALIDATION_LEDGER.md`)

| # | Konu | Ne bekliyor |
|---|------|-------------|
| **1302** | 🔴 Sesli komut yolu termal parlaklık kapını BYPASS ediyor (`useVoiceCommandHandler.ts:188` doğrudan `CarLauncher.setBrightness`) — ONE DOMAIN = ONE AUTHORITY ihlali | Ayrı atomik yama + kendi kilitleri |
| **1303** | 🔴 Kullanıcı yolunun termal uyarısı cihazda doğrulanmadı (CDP ayarlar yüzeyine gezinemedi) | Elle cihaz testi |
| **1304** | 🔴 Gündüz amber cast kaldırıldı — APK `f0474510…` kuruldu | **Kullanıcı görsel onayı** |
| **1307** | 🔴 LAB `flow-masks-core` kuralının `!hasGradient` kör noktası | Ayrı yama: ölçülen opaklığı KARAR EDİLEN opaklıkla karşılaştır |
| **1308** | 🔴 Yol merdiveni 5 kademe — ölçüm ve kilitler tamam | **Kullanıcı görsel onayı** (gündüz+gece) |
| **1309** | 🔴 Chrome tek ray + güneş modu muafiyeti — cihazda ölçüldü. **AÇIK BORÇ:** `sunlight-mode` hâlâ SAATLE tetikleniyor, kanıta (ALS/kullanıcı tercihi) bağlanmalı | Görsel onay + ayrı yama |
| **1310** | 🔴 Etiket bütçesi — z15 karesi temiz, **z16–17 görsel onayı YOK** | Cihazda z16–17 |
| **1297** | 🟡 **AÇIK BORÇ:** `base.css`'teki ölü `none` kurallarının build'de neden silindiği (Lightning CSS / Tailwind 4) araştırılmadı — aynı tuzak başka bildirimleri de sessizce silmiş olabilir | Ayrı denetim |

---

## 6 · TEST / CİHAZ / EKRAN / ARAÇ DURUMU

### 6.1 Testler

**Bu oturumda EKLENEN kilit dosyaları (yeni, izlenmiyor):**
- `src/__tests__/cartographyAuthority.test.ts` (34,7 KB) — yol merdiveni
  (gündüz **ve gece**, gece oran eşiği ≥3,5) · tertiary kendi tonu/kasası ·
  yerel etiket bütçesi · katman sırası
- `src/__tests__/mapDeviceLifecycleCampaign.test.ts` (5,6 KB) — 6 kilit,
  stil yaşam döngüsü
- `src/__tests__/thermalBrightnessToastSpam.test.ts` — 5 kilit
- `src/__tests__/mapTwoInstanceFieldBugs.test.ts` ·
  `pipedCorsAndVideoIdFieldBug.test.ts` · `thermalStatusSourceFieldBug.test.ts` ·
  `musicYoutubeStartAndHomeSurface.test.ts` (bu sonuncular başka oturumların işi)

**GÜNCELLENEN kilitler:** `regression.guards.test.ts` (+P0-A, P0-B, ROTA/FLOW,
NAV-CHROME, NAV-CHROME/2 blokları) · `mapDayPaletteContrast.test.ts`
(amber bandı yasağı · 5 kademeli eşik tablosu · terrain yasağı)

> **Her yeni kilidin KÖR OLMADIĞI kanıtlandı:** kusur geri konulunca test
> DÜŞTÜ, geri alınınca geçti. (terrain geri konunca 2 kilit düştü · flow 0.85'e
> döndürülünce 3 kilit düştü · `setBrightnessAuto`→`setBrightness` yapılınca
> düştü · gece daralma kapatılınca merdiven kilidi düştü.)

**⚠️ ÇALIŞTIRILMAYAN:** Bu oturumda **full suite · production build · native
build KOŞULMADI.** Hüküm: **`IMPLEMENTATION COMPLETE — QA REQUIRED`.**
`npm run guard` ve `tsc -b` oturum boyunca kullanıldı ama son kartografya
turundan sonra tekrar koşulmadı.

> **TUZAK:** `tsc --noEmit` ≠ `tsc -b`. Emphasis kapısı kaldırılınca
> `_scheduleEmphasisRetry` ölü kaldı ve **yalnız `tsc -b` yakaladı** (TS6133).
> Hızlı APK betiği (`field-runs/nav-device-20260906-after/fast-apk.sh`) bu
> yüzden `tsc -b` kullanır.

### 6.2 Cihaz

- **Xiaomi 23090RA98I** — telefon. Ölçülen görüntü alanı **904×406 CSS px**
  (dpr 3).
- Kanıt dizinleri: `field-runs/nav-device-20260906/` (ÖNCE — Astra, DOKUNMAYIN)
  · `field-runs/nav-device-20260906-after/` (SONRA — bu oturum)
- Araçlar: `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` +
  CDP `Runtime.evaluate`.
  ⚠️ **`Page.captureScreenshot` WebGL haritayı YAKALAMAZ** (gri dikdörtgen) —
  `adb exec-out screencap -p` kullanın.

### 6.3 800×480 head unit

❌ **TEST EDİLMEDİ.** Tüm tasarım 904×406'ya göre yapıldı. 800×480'de:
- Chrome panelleri (290 px manevra kartı + 54 px ray) yatayda %43 yer kaplar
- Etiket bütçesi ve yasak bölgeler YENİDEN hesaplanmalı
- Kamera `CX` ve ufuk konumu yeniden çözülmeli (`calib.mjs`)

### 6.4 Gerçek araç

❌ **REAL VEHICLE FIELD = YAPILMADI.** Hiçbir kartografya/chrome maddesi
gerçek araçta sürüşle doğrulanmadı. Kütükteki 🔴 maddeler bu yüzden 🔴.

---

## 7 · SIRADAKİ İŞ

### **Commercial Navigation Visual Final %20 → Concept-to-Production MapLibre**

**Kalan %20 (kavram tarafı):**
1. Kullanıcının referans sayfasında olup tuvalde OLMAYAN durumlar:
   **karmaşık kavşak 3B görünümü + yol kalkanları (shield)** ·
   **otoyol uzak görünümü** · **navigasyon sırasında mini harita**
2. 800×480 için kamera ve chrome yeniden çözümü
3. Gündüz bina tonlarının kullanıcı onayı

**Concept-to-Production MapLibre (asıl iş):**

Sıra ve gerekçe:

| Adım | İş | Neden bu sırada |
|------|-----|-----------------|
| 1 | `building-3d`'ye **menzil + solma** ekle (`fill-extrusion-opacity` zoom/mesafe ifadesi) | Katman ZATEN var, en düşük risk, gündüz sisinin asıl çözümü buydu |
| 2 | **Gök katmanı** (`sky`) + ufuk bandı | Kolay, derinlik algısını hemen verir |
| 3 | Kamera: tasarımın pitch 60° / FOV 66° karşılığını MapLibre `pitch`+`zoom` ikilisine çöz, `cameraPolicyModel`'e **bütçeli** olarak bağla | Otorite değişimi — dikkat |
| 4 | **Ad kısaltma** `text-field` ifadesinde | Etiket yoğunluğunu doğrudan düşürür |
| 5 | Manevra kartı / şerit rehberi / ETA / hız tasarımını `NavigationHUD`'a taşı | En görünür ama en az riskli |
| 6 | Etiket oklüzyon maskesi — **son**, çünkü MapLibre'de doğrudan karşılığı yok | Gerekirse bütçe artırımıyla yetin |

**Her adım için ZORUNLU:** atomik patch · `npm run guard` + `tsc -b` ·
`docs/DEVICE_VALIDATION_LEDGER.md`'ye **🔴 ölçülebilir kabul ölçütüyle** madde ·
`docs/CAROS_PRO_VIZYONU.md` güncellemesi · CAROS LAB gözlem yüzeyi
(yeni ekran AÇMA — mevcut harita/stil ekranını GENİŞLET).

---

## 8 · DEĞİŞEN / COMMIT EDİLMEMİŞ DOSYALAR VE KAYBOLMA RİSKİ

**HEAD `8f79d649` · 52 kirli dosya.** Bu oturumda **tek commit** atıldı
(termal toast düzeltmesi). Kartografya/chrome/tasarım işinin **TAMAMI
commit edilmemiştir.**

### 8.1 Bu oturuma ait — YÜKSEK DEĞER, YÜKSEK RİSK

**Değişen (M):**
```
src/platform/mapStyleBuilders.ts          +1382/-  (palet · merdiven · terrain · etiket)
src/platform/map/MapLayerManager.ts       + 417/-  (canlı palet · emphasis kapısı · stil adı)
src/components/map/FullMapView.tsx        + 129/-  (P0-A · P0-B · FPS mandalı)
src/components/map/MapHudControls.tsx     + 107/-  (tek ray)
src/platform/map/MapInteractionManager.ts +  93/-
src/platform/map/core/mapDeclutterModel.ts+  90/-
src/index.css                             +  53    (güneş modu harita muafiyeti)
src/components/map/NavigationHUD.tsx      +  19    (kart tema token'ı)
src/components/map/MiniMapWidget.tsx      +  18
src/platform/map/core/routeColorModel.ts  +  17
src/platform/map/MapCore.ts               +   3
docs/DEVICE_VALIDATION_LEDGER.md                   (#1298–#1310)
docs/CAROS_PRO_VIZYONU.md                          (NAV-RUNTIME bölümü)
android/.../CarLauncherPlugin.java                 (thermalStatus)
src/platform/thermalWatchdog.ts · nativePlugin.ts · AdaptiveRuntimeManager.ts
+ 13 test dosyası (M)
```

**Yeni, İZLENMİYOR (??) — `git clean` bunları SİLER:**
```
src/platform/map/bindMapUserInteraction.ts          ← P0-B'nin tek kapısı
src/platform/map/core/fpsThermalLatchModel.ts       ← P0-A'nın kök çözümü
src/__tests__/cartographyAuthority.test.ts          ← 34,7 KB kilit
src/__tests__/mapDeviceLifecycleCampaign.test.ts
src/__tests__/mapTwoInstanceFieldBugs.test.ts
src/__tests__/thermalStatusSourceFieldBug.test.ts
field-runs/                                         ← TÜM cihaz kanıtı + tasarım üreticisi
```

### 8.2 En büyük kaybolma riski

> 🔴 **`field-runs/` KOMPLE İZLENMİYOR.** İçinde:
> - Astra'nın ÖNCE kanıtı (`nav-device-20260906/`) — **üzerine yazılmamalı**
> - Bu oturumun SONRA kanıtı (`nav-device-20260906-after/`)
> - **Tasarım üreticisinin TAMAMI** (`carto-2026-09-06/`) — 9 `.mjs` +
>   6 PNG + şema envanteri
>
> Tek bir `git clean -fd` bunların hepsini siler ve **yeniden üretilemez**
> (cihaz kanıtı geri gelmez; tasarım üreticisi ~800 satır ölçülmüş kod).

### 8.3 Yeni oturum için önerilen ilk hamle (SEÇİCİ)

```bash
# 1) ÖNCE kanıtı ve tasarımı güvene al (ayrı commit)
git add field-runs/
git commit -m "chore(evidence): 2026-09-06 nav cihaz kanıtı + kartografya tasarım üreticisi"

# 2) P0 düzeltmelerini ayrı commit
git add src/platform/map/bindMapUserInteraction.ts \
        src/platform/map/core/fpsThermalLatchModel.ts \
        src/components/map/FullMapView.tsx \
        src/__tests__/mapDeviceLifecycleCampaign.test.ts
git commit -m "fix(nav-style,nav-camera): P0-A FPS mandalı + P0-B tek kamera üreticisi"

# 3) Kartografya ayrı commit
git add src/platform/mapStyleBuilders.ts src/platform/map/MapLayerManager.ts \
        src/__tests__/cartographyAuthority.test.ts \
        src/__tests__/mapDayPaletteContrast.test.ts
git commit -m "fix(nav-carto): terrain kaldırıldı · amber cast · 5 kademeli merdiven"

# 4) Chrome ayrı commit
git add src/index.css src/components/map/MapHudControls.tsx \
        src/components/map/NavigationHUD.tsx src/__tests__/regression.guards.test.ts
git commit -m "fix(nav-chrome): tek ray + güneş modu harita muafiyeti"
```

⚠️ **`git add .` KULLANMAYIN** — depoda media/music/native alanlarında başka
oturumların kirli işi var (`MiniPlayer.tsx` ve `musicSurfaceVisibilityModel.ts`
**silinmiş** görünüyor, `?? 6` diye adı `6` olan bir dosya var). Onlara
dokunmayın, silmeyin, geri almayın.

---

## 9 · YENİ HESABIN İLK 30 DAKİKASI

1. `docs/CAROS_PRO_VIZYONU.md` ve `docs/DEVICE_VALIDATION_LEDGER.md` oku.
2. Bu raporun **§8.3**'ünü uygula — kanıt ve tasarım üreticisi commit'lensin.
   Kaybolma riski en yüksek şey bu.
3. `npm run guard` + `npx tsc -b` koş. Yeşilse hüküm:
   `IMPLEMENTATION COMPLETE — QA REQUIRED`.
4. `node field-runs/carto-2026-09-06/build.mjs` çalıştırıp 6 kareyi kendi
   gözünle gör — hedef görsel dil budur.
5. §7'deki **Adım 1**'e başla: `building-3d` menzil + solma.

---

## EK · KRİTİK BAĞLAM ÖZETİ (konuşma kaybolduğu için)

- **Kullanıcı Türkçe konuşur, TÜM yanıtlar Türkçe olacak.** Kopyalanabilir
  çıktı tek markdown bloğunda verilir. Onay İSTENMEZ, doğrudan yapılır.
- Kullanıcı **oyuncak görünümlü tasarımı reddeder**; "Google'ı ve Yandex'i
  kıskandıracak" ticari kalite ister ve **gerçek dünya verisi** şart koşar.
  Sentetik ızgaralı ilk tasarım bu yüzden reddedildi.
- Kullanıcı **ölçülmüş kanıt** ister; "test yeşil" bir şeyi tamamlanmış
  yapmaz. Cihazda gözlemlenmeyen madde kütükte 🔴 kalır.
- Kullanıcı düzeltmeleri **tek tek doğrular** ve yanlış hipotezi hemen
  yakalar (soluk rota olayında benim flow hipotezim yanlıştı, tek değişkenli
  deney doğruyu buldu). **Makul akıl yürütme yerine cihazda tek değişkenli
  deney yapın.**
- Lisans: yalnız permissive (MIT/Apache-2.0/BSD/ISC/Zlib/CC0/OFL).
  Tasarımda kullanılanlar: `@mapbox/vector-tile` + `pbf` (BSD-3) ·
  Archivo (OFL) · OpenFreeMap karo · **© OpenStreetMap katkıcıları (ODbL)
  atıfı ZORUNLU** (tuvalde ve galeri sayfasında yazılı).
