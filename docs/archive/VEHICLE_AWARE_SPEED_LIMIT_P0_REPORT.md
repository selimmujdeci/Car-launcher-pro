# VEHICLE_AWARE_SPEED_LIMIT_P0 — Araç Farkında Hız Sınırı

**Tarih:** 2026-08-04 · **Dal:** `feat/fleet-offline-final-local-completion`
**Commit / push / deploy:** YAPILMADI (görev gereği).

---

## 1. Yönetici Özeti

CAROS'un hız limiti kartı bugüne kadar **yalnız yolu** okuyordu: Overpass'ten
gelen `maxspeed` etiketi doğrulanıyor, bayat/çelişkili değerler eleniyor ve
sayı ekrana basılıyordu. Doğruluk zincirinin tamamı **yol tarafındaydı**.

Eksik olan taraf araçtı. Türkiye'de aynı yolun hız sınırı araca göre değişir:

| Aynı otoyol (levha 130) | Yasal sınır |
|---|---|
| Otomobil (M1) | **130** km/sa |
| Panelvan (N1) | **110** km/sa |
| Kamyonet (N1) | **95** km/sa |

Ruhsatında **kamyonet** yazan bir Fiat Doblo sürücüsüne 130 göstermek, onu
35 km/sa'lik bir yasal ihlale doğru yönlendirmektir. Bu tur o boşluğu kapatır.

**Yapılanlar:**

1. **Kanonik yasal araç sınıfı modeli** — M1/M1G/M2/M3/N1/N1G/N2/N3 kategorileri,
   ruhsat gövde cinsleri (otomobil/kamyonet/panelvan/minibüs/…), kaynak sırası
   ve altı çözümleme durumu (`VERIFIED · PROBABLE · AMBIGUOUS · UNAVAILABLE ·
   CONFLICTED · STALE`). Marka/model adından **sessiz sınıf üretilmez**.
2. **Versiyonlu Türkiye politika tablosu** (`TR-2022.07.01`) — sayılar UI'a
   gömülmez; her satır ülke, sürüm, yürürlük tarihi, otorite ve kaynak künyesi
   taşır. Değerler bu tur içinde **iki bağımsız kaynakla** doğrulandı.
3. **Yol sınıfı çözümleyici** — OSM `highway` etiketi + okunan levhadan
   politika yol sınıfı türetir; kanıt yetmezse `UNKNOWN` der.
4. **Tek otorite `computeEffectiveSpeedLimit`** — `min(yol sınırı, araç tavanı)`.
   Araç sınıfı tablosu levhayı **asla yükseltmez**.
5. **Tek kart, iki ekran** — mini harita ve tam ekran artık aynı hook'u ve aynı
   `SpeedLimitCard` bileşenini kullanır. (Bu sırada tam ekran levhasının
   **sessizce ölü** olduğu bulundu ve düzeltildi — bkz. §2.)
6. **Kullanıcı doğrulaması** — araç **dururken** çıkan, modal olmayan tek soru
   + Ayarlar'da kalıcı düzeltme yüzeyi.
7. **CAROS LAB** — Navigation Core ekranına salt-okunur 11. kart (28 alan).

**Nihai karar: `VEHICLE_AWARE_SPEED_LIMIT_P0_COMPLETE_LOCAL`**
(gerçek cihaz doğrulaması **bekliyor** — §17/§18).

---

## 2. Mevcut Hız Limiti Zinciri (turdan ÖNCE — gerçek wiring)

| Katman | Dosya | Rol |
|---|---|---|
| Sorgu döngüsü | `speedLimitService.ts` | Overpass `way[highway](around:30)`; modül düzeyinde **tek sahip**; 3 uç nokta rotasyonu; backoff |
| Ham gözlem | `speedLimitService.ts` | `kmh · source · resolvedAt(Ms/Lat/Lon) · conflicting · highway` yayınlar |
| Dürüstlük hükmü | `navigation/core/speedLimitTruthModel.ts` | `AVAILABLE·STALE·UNAVAILABLE·CONFLICTED·UNKNOWN`; yarıçap yol sınıfından türer |
| Mini harita | `MiniMapWidget.tsx` | Paylaşılan gözlem + `classifySpeedLimit(..., false)` |
| Tam ekran | `NavigationHUD.tsx` → `SpeedPanel` | `useSpeedLimitByLocation()` **dönüş değeri** |
| LAB | `devtools/navigationCoreSources.ts` kart 10 | Aynı saf modelden geçirilmiş hüküm |

### 🔴 Denetimde bulunan kusur: tam ekran levhası ölüydü

`useSpeedLimitByLocation` iki iş yapar: (a) sorgu döngüsünü çalıştırır,
(b) kendi **yerel** `limit` state'ini döndürür. Sorgu sahipliği modül düzeyinde
kilitlidir (`_resolverOwned`) ve **sahip olmayan örneğin state'i hiç yazılmaz**.

Sonuç, mount sırasına bağlı iki ayrı arıza:

* Mini harita önce mount olursa → tam ekran hook'u **kalıcı `null`** döner,
  **HUD levhası hiç çıkmaz**.
* Tam ekran önce mount olursa → HUD, `speedLimitTruthModel` sınıflandırmasından
  **geçmemiş** ham değeri gösterir: bayat, çelişkili veya çıkarım değeri ekrana
  basılabilir.

Yani ürün fiilen **iki ayrı hız limiti motoru** çalıştırıyordu ve ikisi farklı
sonuç veriyordu. Görev §0 bunu açıkça yasakladığı için tek motora indirildi.

### Araç kimliği tarafı (turdan önce mevcut)

| Kaynak | Ne veriyor |
|---|---|
| `useVidStore.vehicle` | `vin · make · model · modelYear · vehicleType` |
| `vehicleProfileService._mirrorVehicleToVid()` | Aktif profilden VID'ye tek-yönlü aynalama; `make`/`modelYear` **VIN'den** (`decodeWmi`/`decodeVinYear`) |
| `vehicleFingerprintBuilder` | VIN + protokol + ECU adreslerinden kimlik hash'i, `profileHint` (WMI→marka) |
| OBD Mode 09 / UDS F190 | VIN okuma denemesi (`persistHandshakeVin`) |

**Kritik bulgu:** hiçbir katmanda **yasal sınıf** (M1/N1) veya **ruhsat gövde
cinsi** alanı yoktu. `VidVehicleInfo.vehicleType` yalnız tahrik tipidir
(`ice/diesel/ev/hybrid/phev`) — hız sınırıyla ilgisi yoktur.

**Türkiye araç sınıfı veya hız politikası kodda YOKTU.** Var olan tek şey
`speedLimitService._CLASS_LIMIT` idi ve o bir *yol sınıfı → M1 limiti* çıkarım
tablosudur, araç sınıfı tablosu değil.

**Backend/proxy:** `website/src/app/api/**` altında Next.js rotaları mevcut
(`/api/vehicle/link`, `/api/vehicle/register`, …) — yeni proxy aynı desende
eklendi. Bundle'da gömülü sağlayıcı anahtarı **yok** ve eklenmedi.

---

## 3. OBD / VIN Sınırı

VIN yardımcı bir **başlangıç girdisidir**, ruhsat sınıfı kanıtı değildir:

* VIN yoksa sınıf **uydurulmaz** → `UNKNOWN`.
* VIN parse edilemezse fail-closed (`isValidVin` 17 hane, I/O/Q hariç).
* Aynı modelin M1 ve N1 varyantları varsa sonuç `AMBIGUOUS`.
* `legalVehicleCategory` **doğrudan OBD'den `VERIFIED` olamaz**: `resolveVehicleClass`
  yalnız `REGISTRATION_CONFIRMED · USER_CONFIRMED · OFFICIAL_VIN_LOOKUP`
  kaynaklarını otoriter sayar (`_AUTHORITATIVE`).

### VIN gizliliği — üç ayrı gösterim

| Kullanım | Değer | Neden |
|---|---|---|
| Ekran / LAB / export | `maskVin()` → `ZFA…56` | Tam VIN aracı tekilleştirir |
| Depo anahtarı ve araştırma | `vinResearchPrefix()` → ilk **9** hane | 10–17. haneler model yılı + **seri no** |
| Log | — | Sınıf katmanında `console.*` **yok** (test kilitli) |

---

## 4. İnternet Araştırma Kaynakları

Bu turda **iki tür araştırma** vardır ve karıştırılmamalıdır.

### (a) Geliştirme-zamanı araştırma — Türkiye politika tablosu

Tablodaki her sayı bu tur içinde araştırıldı ve **iki bağımsız kaynakla**
karşılaştırıldı:

| # | Kaynak | Otorite | Ne doğruladı |
|---|---|---|---|
| A | [KGM · Hız Sınırları](https://www.kgm.gov.tr/sayfalar/kgm/sitetr/trafik/hizsinirlari.aspx) | Resmî kamu | Tam tablo; **panelvan ve kamyonet AYRI satır** |
| B | [KTY md.100 tablosu](https://www.trafiksozluk.com/karayollari-trafik-yonetmeligi-100-madde/) | Mevzuat metni | Kamyonet 50/80/85/95; asgari hızlar; römork kuralı |
| C | [Dünya · panelvan limitleri artırıldı](https://www.dunya.com/gundem/panelvanlarin-hiz-limitleri-artti-haberi-168880) | Haber (RG 21/3/2012) | Panelvanın kamyonetten **ayrıldığı tarih** ve 85/100/110 |
| D | [İçişleri Bakanlığı · 1/7/2022](https://www.icisleri.gov.tr/otoyollarda-otomobiller-icin-yeni-hiz-siniri-uygulamasi-1-temmuzda-basliyor) | Resmî kamu | Otomobil otoyol 130 (KGM) / 140 (YİD), adı geçen otoyollar |

**⚠️ Kaynak çelişkisi kaydı:** [B]'nin 2010 metninde **panelvan satırı yoktur**
(panelvan = kamyonet: 80/85/95). [A] ve [C] panelvanı ayrı gösterir
(85/100/110). Daha güncel ve daha otoriter olan **[A]+[C]** esas alındı; çelişki
`turkeySpeedPolicy.ts` başlığında ve burada kayıtlıdır.

### (b) Çalışma-zamanı araştırma — aracın kendi sınıfı

`vehicleClassResearch.ts` + `/api/vehicle/class-lookup` proxy'si.

Kaynak önceliği kodda güven olarak ifade edilir (`confidenceFromAgreement`):

| Kaynak | 1 kaynak | ≥2 uyumlu kaynak |
|---|---|---|
| `OFFICIAL_VIN_LOOKUP` | 0.85 | 0.95 |
| `MANUFACTURER_DATA` | 0.65 | 0.80 |
| `TRUSTED_DATABASE` | 0.50 | 0.70 |

`VERIFIED` eşiği **0.80** olduğu için **tek bir veri tabanı sonucu asla
doğrulanmış sayılmaz** — yalnız aday üretir ve kullanıcıya sorulur.

Kurallar (hepsi test kilitli):

* Künyesiz (`sourceRefs` boş) kanıt **reddedilir**.
* Künye URL'si `https:` değilse reddedilir (`javascript:` / `data:` dahil).
* Bilinmeyen kategori/kaynak değerleri reddedilir; yanıt 4 kanıt / 4 künye ile budanır.
* Farklı gövde → `AMBIGUOUS`; farklı **kategori** → `CONFLICTED`.
* 8 sn zaman aşımı, oturum başına anahtar başına **en fazla 2 deneme**, kalıcı
  engelde (backend yok / kimlik yok) yeniden deneme **yok**.
* Sorgu **yalnız araç kimliği değişince**; navigasyon tick'inde ağ çağrısı yok.
* Ham sayfa içeriği cihaza yazılmaz; yanıt yalnız veri olarak daraltılır.

---

## 5. Araç Sınıfı Resolver

`resolveVehicleClass(claims, nowMs, …)` — saf hakem.

```
1. Süresi dolmuş kanıtlar elenir. Hepsi dolduysa → STALE (sınıf uygulanmaz).
2. Kullanıcı/ruhsat beyanı varsa ÖNCELİKLİDİR.
   · Dış kaynak farklı diyorsa → uygulanan değer KULLANICININ, durum CONFLICTED.
   · Uyumluysa → VERIFIED.
3. Kullanıcı yoksa, kalan kanıtlar tek sınıfta birleşiyorsa:
   · otoriter kaynak + güven ≥ 0.80 → VERIFIED
   · aksi hâlde                     → PROBABLE
4. Kanıtlar farklı sınıflar gösteriyorsa → AMBIGUOUS (hiçbiri seçilmez, adaylar taşınır)
5. Hiç kanıt yoksa → UNAVAILABLE
```

`isVehicleClassApplicable()` yalnız `VERIFIED · PROBABLE · CONFLICTED` için
`true` döner — `AMBIGUOUS · STALE · UNAVAILABLE`'da araç tavanı **uygulanmaz**.

**Kapsam (anahtar):** `vin9:<ilk 9 hane>` varsa o, yoksa `mmy:MARKA|MODEL|YIL`,
o da yoksa **anahtar yok** → kanıt saklanmaz ve araştırma yapılmaz. Araç
değişince anahtar değişir; **eski aracın kanıtı taşınmaz**. Depo 8 araçla
sınırlı (LRU, `safeStorage`).

---

## 6. Kullanıcı Doğrulaması

**Soru kapısı (`shouldPromptVehicleClass`) — fail-closed:**

| Koşul | Sonuç |
|---|---|
| Hız `null` (bilinmiyor) | **sorulmaz** |
| Hız > 3 km/sa | **sorulmaz** |
| Araç kimliği yok | sorulmaz |
| Daha önce cevaplandı/kapatıldı | sorulmaz |
| Sınıf zaten `VERIFIED` (kullanıcı veya resmî VIN) | sorulmaz |
| Araç duruyor + sınıf belirsiz/yok | **sorulur** |

Soru `VehicleClassPrompt` ile **modal olmayan** bir şerittir (test: `fixed inset-0`
ve `backdrop` **yok**). Araç hareket ederse şerit anında kaybolur. Seçenekler:
Otomobil M1 · Kamyonet N1 · Panelvan N1 · Minibüs M2 · **Diğer/Bilmiyorum**.

* "Bilmiyorum" bir sınıf beyanı **değildir**: kanıt üretmez, sınıf `UNKNOWN`
  kalır, yalnız soru kapanır.
* Kalıcı düzeltme: **Ayarlar → Bakım → Ruhsat Sınıfı** (`VehicleClassSettings`)
  — seçim, kanıt künyesi, çelişki uyarısı ve "Beyanı sıfırla".
* Kullanıcı ↔ internet çelişkisi **sessizce ezilmez**: kullanıcı uygulanır,
  durum `CONFLICTED` olarak hem ayarlarda hem LAB'da ilan edilir.

Ruhsat fotoğrafı/OCR bu turun kapsamı dışındadır (`REGISTRATION_CONFIRMED`
kaynağı tanımlıdır ama üretilmez).

---

## 7. Türkiye Politika Tablosu

`POLICY_VERSION = TR-2022.07.01` · `POLICY_EFFECTIVE_FROM = 2022-07-01`

| Kategori / gövde | Yerleşim içi | Şehirlerarası çift yönlü | Bölünmüş yol | Otoyol KGM | Otoyol YİD |
|---|---|---|---|---|---|
| M1 · M1G otomobil | 50 | 90 | 110 | **130** | **140** |
| M2 minibüs | 50 | 80 | 90 | 100 | 100 |
| M3 otobüs | 50 | 80 | 90 | 100 | 100 |
| **N1 · N1G kamyonet** | 50 | 80 | **85** | **95** | **95** |
| **N1 panelvan** | 50 | **85** | **100** | **110** | **110** |
| N2 · N3 kamyon/çekici | 50 | 80 | 85 | 90 | 90 |
| Lastik tekerlekli traktör | 20 | 30 | 40 | giremez | giremez |

**Otoyol satırları hakkında:** yönetmeliğin 2010 metninde M1 için otoyol sınırı
120'dir; 1/7/2022 kararı adı geçen otoyollarda bunu 130/140 yapmıştır. Tabloya
130/140 yazılır çünkü bu satırlar bir **üst sınır** olarak kullanılır: tavan
levhayı yükseltemez, yalnız gerekiyorsa düşürür. Böylece 120'lik bir otoyolda
levha 120 kalır, 140'lık YİD otoyolunda 140 kalır ve N1 araçlar **her ikisinde
de** kendi tavanına (95/110) çekilir.

**KGM/YİD ayrımı OSM'de yoktur.** `resolveRoadClass` bunu `motorwayOperatorKnown:
false` ile bildirir; `vehicleClassCap` o durumda iki otoyol satırının **büyüğünü**
alır (üst sınır gevşetilmez, M1 için levha bozulmaz, N1/N2 için iki satır zaten
aynıdır).

**Yol sınıfı çözümleme önceliği:**
1. `highway=motorway|motorway_link` → otoyol (işletmeci bilinmez), güven 0.90
2. **Okunan** levha (`postedSource === 'osm'`) → ≤50 URBAN · ≤90 INTERURBAN ·
   ≤110 DIVIDED · >110 MOTORWAY (Türkiye levha değerleri zaten M1 yasal değerleridir)
3. `residential/living_street/service/pedestrian/unclassified` → URBAN
4. `trunk` → DIVIDED_HIGHWAY (0.55)
5. Aksi hâlde **UNKNOWN** — `primary`/`secondary` levhasız iken şehir içi mi
   dışı mı olduğu ayırt edilemez, uydurulmaz.

**Çıkarım levhası (`postedSource === 'inferred'`) sınıf belirlemede kullanılmaz**
— kendi çıkarımımızdan sınıf türetmek döngüsel olurdu.

---

## 8. Effective Limit Authority

`computeEffectiveSpeedLimit({ road, roadClass, vehicleClass })` — saf.

**Altın kural:** `effectiveLimitKmh = min(roadLimitKmh, vehicleClassCapKmh)`

| Girdi durumu | Çıktı `state` | Sayı | Kart etiketi |
|---|---|---|---|
| Yol AVAILABLE + sınıf uygulanabilir | `AVAILABLE` | min | tavan bağlıyorsa **ARAÇ SINIRI**, değilse **YOL SINIRI** |
| Yol AVAILABLE + sınıf yok/UNKNOWN | `ROAD_ONLY` | yol sınırı | **YOL SINIRI** |
| Yol AVAILABLE + yol sınıfı UNKNOWN | `ROAD_ONLY` | yol sınırı | **YOL SINIRI** |
| Yol AVAILABLE + N1 gövdesi belirsiz | `AMBIGUOUS` | min(yol, **en düşük aday**) | ARAÇ/YOL SINIRI |
| Yol AVAILABLE + kullanıcı↔kaynak çelişkisi | `CONFLICTED` | min (muhafazakâr) | ARAÇ/YOL SINIRI |
| Yol yok + tavan var | `VEHICLE_ONLY` | **yok** | — |
| Yol STALE | `STALE` | **yok** | — |
| Yol CONFLICTED | `CONFLICTED` | **yok** | — |
| Yol UNAVAILABLE / UNKNOWN | aynısı | **yok** | — |

`isEffectiveLimitDefinitive()` yalnız `AVAILABLE` için `true` — diğer tüm
gösterilen sayılar kartta **kesikli çerçeveyle** ayrılır.

**Kilitlenen invaryantlar:**
* Kaba kuvvet taraması (9 levha değeri × 5 kategori × 5 gövde): üretilen sayı
  **hiçbir durumda yol sınırını aşmaz**.
* Otoyolda şantiye levhası 50 iken M1 tavanı 140 olsa da sonuç **50** kalır.
* Bilinmeyen değer **hiçbir zaman 0** olarak gösterilmez.
* Araç sınıfı bilinmiyorken **otomobil tavanı varsayılmaz** (`capKmh = null`).

---

## 9. Doblo Varyantları

Doblo bu görevin doğru örneğidir: **tek bir sınıfı yoktur.** Araştırma
(Fiat Doblo Cargo/Combi) hem M1 (binek) hem N1 (hafif ticari) varyantlarının
satıldığını, N1 içinde de Türkiye ruhsatında **kamyonet ↔ panelvan** ayrımının
bulunduğunu gösterdi.

Test edilen ve kilitlenen senaryolar (aynı yol: otoyol, levha 130):

| Senaryo | Sonuç |
|---|---|
| Doblo **M1 otomobil** | **130** km/sa |
| Doblo **N1 kamyonet** | **95** km/sa |
| Doblo **N1 panelvan** | **110** km/sa |
| Üç varyant birlikte | **üç farklı sayı** (kilit testi) |
| Model/yıl belirsiz, kaynak yok | `ROAD_ONLY` · 130 · "YOL SINIRI" |
| İnternet kaynakları çelişkili (M1 vs N1) | `AMBIGUOUS` → tavan **uygulanmaz** |
| VIN bulunamadı | `mmy:` anahtarı; sınıf `UNKNOWN`, uydurma yok |
| Kullanıcı "bilmiyorum" | sınıf `UNKNOWN` kalır |
| **N1 biliniyor, gövde bilinmiyor** | **95** (panelvan **varsayılmaz**) |
| Kullanıcı ruhsat sınıfını doğruladı | `VERIFIED`, o değer uygulanır |

---

## 10. Mini / Tam Ekran UI

* Tek hook: `useEffectiveSpeedLimit()` — konum çıpası (rota aktifken snapped,
  değilse GPS), sınıflandırma (`allowInferred = false`), yol sınıfı ve araç
  tavanı burada birleşir.
* Tek bileşen: `SpeedLimitCard` (`size="mini" | "full"`) — büyük sayı + küçük
  kaynak etiketi (**YOL SINIRI · ARAÇ SINIRI · YEREL LEVHA · DOĞRULANMADI**).
* Gösterilemiyorsa kart **hiç çizilmez** — "—" veya sahte 0 yazılmaz.
* Kesin olmayan sayı **kesikli çerçeve** ile ayrılır.
* Kart değişiminde animasyon/geçiş **yok**; tek istisna hız aşımı nabzıdır ve
  yalnız tam ekranda (`overSpeed` prop'u mini haritaya verilmez).
* Harita pan edilince değer değişmez (çıpa araçtır, kamera merkezi değil).
* Rota aktif olmasa da çalışır.

**Bilinçli davranış değişikliği:** tam ekrandaki `≈` (yol sınıfından çıkarım)
levhası kaldırıldı. Gerekçe: çıkarım tablosu M1 değerleridir; onu bir N1 araca
"yol limiti" diye sunmak bu turun kapattığı hatanın ta kendisidir. Mini harita
zaten `allowInferred=false` sözleşmesiyle kilitliydi; iki ekran o sözleşmede
birleştirildi. Bu, `maxspeed` etiketi olmayan yollarda kart görünürlüğünü
düşürür — açık borç olarak §16'da kayıtlıdır.

**Park hâlinde ayrıntı:** Ayarlar → Ruhsat Sınıfı paneli yol sınırı, araç sınıfı,
tavan, uygulanan sınır, kaynak ve son güncellemeyi gösterir; CAROS LAB kart 11
aynı bilgiyi tam künyeyle verir.

---

## 11. Offline Davranış

| Durum | Davranış |
|---|---|
| Kullanıcı beyanı | `safeStorage`'da kalıcı → internet olmadan da geçerli |
| Araştırma önbelleği | 180 gün TTL, anahtar bazlı, çevrimdışı okunur |
| Politika tablosu | Kodda versiyonlu ve yerel — ağ gerektirmez |
| Yol hız verisi yok | Kesin limit **üretilmez** (mevcut Overpass davranışı) |
| Eski yolun limiti | Yeni yolda gösterilmez (`speedLimitTruthModel` mesafe/yaş kapısı) |
| İnternet yokken araştırma | `BLOCKED_NETWORK` — hata değil, durum |
| Backend yapılandırılmamışsa | `BLOCKED_NO_BACKEND` — sessizce başka uca düşülmez |
| Navigasyon | Etkilenmez; gerekirse yalnız hız kartı gizlenir |

İnternet yokluğu **araç/navigasyon arızası sayılmaz**; LAB'da `Çevrimdışı
önbellek: CACHED/EMPTY` alanıyla ayrıca gösterilir.

---

## 12. Güvenlik ve Gizlilik

| Kural | Uygulama | Kilit |
|---|---|---|
| Tam VIN loglanmaz | Sınıf katmanında `console.*` yok | test |
| Tam VIN LAB/export'a çıkmaz | Yalnız `maskVin()` → `ZFA…56` | test |
| Tekilleştirici VIN backend'e gitmez | Yalnız ilk **9** hane; proxy 17 haneyi **reddeder** (HTTP 400) | test + rota |
| Anahtar bundle'a gömülmez | Sağlayıcı anahtarı yalnız sunucu env'inde | rota |
| Doğrudan sağlayıcıya çıkılmaz | Backend yoksa `BLOCKED_NO_BACKEND` | test |
| Kanıt araç kapsamındadır | Anahtar `vin9:`/`mmy:`; araç değişince taşınmaz | test |
| Kullanıcı seçimi izlenebilir | `source · verifiedAt` kaydı, LAB'da görünür | LAB |
| Politika değişimi izlenebilir | `policyVersion · effectiveFrom · sourceAuthority` | LAB |
| Web sonucu kod/HTML çalıştıramaz | `dangerouslySetInnerHTML`/`innerHTML`/`eval` yok; künye `https:` şart | test |
| Harici metin yalnız veri | Şema daraltması + uzunluk budaması | test |
| Koordinat LAB'a taşınmaz | Mevcut `navigationCoreSources` sözleşmesi korundu | mevcut |

---

## 13. CAROS LAB

**Navigation Core → Kart 11 · "Araç Sınıfı · Uygulanabilir Hız Sınırı"** (28 alan,
salt-okunur; buradan sınıf/politika/limit **değiştirilemez**):

`activeVehicleIdMasked` · `make/model/year` · `vinState` · `vinMasked` ·
`classResolutionState` · `legalVehicleCategory` · `registrationBodyType` ·
`vehicleClassSource` · `vehicleClassConfidence` · `vehicleClassVerifiedAt` ·
`sourceRefs` · çözümleme gerekçesi · `researchLastAttemptAt` · `researchResult` ·
`researchFailureReason` · `offlineCacheState` · `policyCountry` · `policyVersion` ·
`policyEffectiveFrom` · `policySource` · `roadClass` (+güven) · `postedRoadLimitKmh` ·
`vehicleClassCapKmh` · `effectiveLimitKmh` · `speedLimitState` ·
`effectiveLimitReason` · kart kaynak etiketi · `speedLimitAgeMs` · `conflictState`

Alanların tamamı `navigationCoreFieldAudit` kaydına eklendi: kaynağı, dayandığı
anlık-görüntü alanı ve tazelik damgası sözleşmesi kilitli. Bilinmeyen alanlar
`UNAVAILABLE` olarak gösterilir; sahte 0 / sahte tarih üretilmez.

---

## 14. Testler

**Yeni:** `src/__tests__/vehicleAwareSpeedLimit.test.ts` — **78 kilit testi**
(A sınıf çözümleme · B politika · B2 yol sınıfı · C otorite · C2 Doblo ·
C3 araştırma yanıtı · D soru kapısı + UI · E saflık/gizlilik).

**Güncellenen kilitler** (kaldırılmadı, yeni doğru davranışa taşındı):
* `miniMapNightCameraSpeedLimit.test.ts` C2 — mini haritanın **ikinci motor
  kurmadığı**, çıkarım yasağının paylaşılan motorda olduğu.
* `regression.guards.test.ts` — levha kaynağı ayrımı ve aşım rengi artık
  `SpeedLimitCard`ta; **yeni kilit:** `min(yol, tavan)` ve "otomobil tavanı
  varsayılmaz".
* `carosLabNavigationCore.test.tsx` · `navigationCoreFieldAudit.test.ts` —
  yeni alanlar fixture ve kayda eklendi.
* `navigationHud.turnStep.test.tsx` — yeni hook mock'landı.

**Sonuç:**

| Kapı | Sonuç |
|---|---|
| `npx tsc -b --force` (app) | ✅ temiz |
| `npx tsc --noEmit` (website) | ✅ temiz |
| `npm run lint` | ✅ yeni dosyalarda 0 hata/uyarı (4 hata **önceden vardı**, dokunulmayan dosyalarda) |
| `npx vitest run` | ✅ **474 dosya / 10621 test — hepsi geçti** |

---

## 15. Değişen Dosyalar

**Yeni (uygulama):**
* `src/platform/vehicle/legalVehicleClass.ts` — kanonik sınıf modeli + resolver
* `src/platform/vehicle/vehicleClassResearch.ts` — proxy araştırma + yanıt doğrulama
* `src/platform/vehicle/vehicleClassRuntime.ts` — kimlik izleme, depo, soru kapısı
* `src/platform/navigation/policy/turkeySpeedPolicy.ts` — versiyonlu tablo
* `src/platform/navigation/policy/roadClassResolver.ts` — yol sınıfı çözümleyici
* `src/platform/navigation/core/vehicleAwareSpeedLimitAuthority.ts` — tek otorite
* `src/platform/navigation/useEffectiveSpeedLimit.ts` — tek UI girişi
* `src/components/map/SpeedLimitCard.tsx` — paylaşılan kart
* `src/components/map/VehicleClassPrompt.tsx` — modal olmayan soru
* `src/components/settings/VehicleClassSettings.tsx` — kalıcı düzeltme
* `website/src/app/api/vehicle/class-lookup/route.ts` — backend proxy

**Değişen:**
* `src/components/map/MiniMapWidget.tsx` — paylaşılan motora bağlandı
* `src/components/map/NavigationHUD.tsx` — ölü levha yolu düzeltildi
* `src/components/map/FullMapView.tsx` — soru şeridi mount
* `src/components/settings/SettingsPage.tsx` — Ruhsat Sınıfı paneli
* `src/platform/system/SystemBoot.ts` — `startVehicleClassRuntime` (Wave-3)
* `src/platform/devtools/navigationCoreSources.ts` · `navigationCoreModel.ts` — kart 11

**Yeni/güncellenen testler:** `vehicleAwareSpeedLimit.test.ts` (yeni) ·
`miniMapNightCameraSpeedLimit` · `regression.guards` · `carosLabNavigationCore` ·
`navigationCoreFieldAudit` · `navigationHud.turnStep`

**Belgeler:** bu rapor · `DEVICE_VALIDATION_LEDGER.md` #388-390 · `CAROS_PRO_VIZYONU.md`

---

## 16. Açık Borçlar

1. **Sağlayıcı yapılandırılmamış.** `VITE_VEHICLE_API_BASE` ve sunucu tarafı
   `VEHICLE_CLASS_LOOKUP_URL/KEY` boş → çalışma-zamanı araştırması bugün
   fiilen **kapalı**; sınıfın tek gerçek kaynağı kullanıcı beyanıdır. (Kütük #390)
2. **Çıkarım levhası kaybı.** Türkiye'de OSM yollarının çoğunda `maxspeed`
   yoktur; tam ekranda `≈` tahmini kaldırıldığı için kart görünürlüğü düşecek.
   Doğru çözüm tahmini geri getirmek değil, **araç sınıfına duyarlı** bir
   çıkarım katmanı (yol sınıfı → o aracın tablo satırı) tasarlamaktır.
3. **`VAN` gövde cinsi tablosuz.** Enum'da var, politika satırı yok → tavan
   üretmez (fail-closed). UI seçenekleri arasında olmadığı için bugün erişilemez.
4. **KGM/YİD ayrımı veri kaynağı yok.** Otoyol işletmecisi OSM'de yoktur;
   üst sınır muhafazakâr biçimde çözülüyor. Kesin ayrım için otoyol adı/ref
   eşlemesi gerekir.
5. **Ruhsat OCR yok** (kapsam dışı) — `REGISTRATION_CONFIRMED` üretilmiyor.
6. **Hız aşımı uyarısı yok.** Kart doğru sayıyı gösteriyor ama araç sınıfı
   tavanı aşıldığında sesli/görsel uyarı bu turda **eklenmedi**.
7. **`speedLimitService` yüksek hız kusuru sürüyor** (kütük #385): 95 km/sa'te
   `attemptRef` sürekli sıfırlandığı için uç nokta rotasyonu fiilen ölü. Bu tur
   o dosyanın sorgu döngüsüne **dokunmadı**.

---

## 17. Gerçek Cihaz Sonucu

**Gerçek Doblo ile hiçbir ölçüm yapılmadı.** Bu turun tamamı kod, saf model ve
test düzeyindedir. Kütüğe üç madde **🔴 cihazda test edilmedi** olarak eklendi:

* **#388** — sınıfa göre 95/110/130 ayrımı gerçek araçta gözlemlenmeli.
* **#389** — mini/tam ekran aynı sayıyı göstermeli; tam ekran levhası artık
  ölü olmamalı.
* **#390** — araştırma zinciri sağlayıcı yapılandırıldıktan sonra ölçülmeli.

---

## 18. Nihai Karar

### `VEHICLE_AWARE_SPEED_LIMIT_P0_COMPLETE_LOCAL`

| Kapı | Hüküm | Gerekçe |
|---|---|---|
| `vehicleClassResolutionVerdict` | **PASS** | Kanonik model + hakem + 6 durum; sınıf uydurulmuyor, kaynak sırası açık, 30+ test |
| `internetResearchVerdict` | **PARTIAL** | Zincir, doğrulama ve proxy tam; **sağlayıcı yapılandırılmadı** → uçtan uca hiç çalışmadı |
| `policyVerdict` | **PASS** | Versiyonlu, künyeli, iki bağımsız kaynakla doğrulanmış tablo; çelişki kaydı yazıldı |
| `effectiveLimitVerdict` | **PASS** | `min()` altın kuralı + 8 durum; kaba kuvvet taraması levhanın aşılamayacağını kanıtlıyor |
| `miniMapCardVerdict` | **PASS** | Paylaşılan hook + paylaşılan kart; ikinci motor yok (kilitli) |
| `fullMapCardVerdict` | **PASS** | Ölü levha yolu düzeltildi; mini ile aynı hüküm |
| `offlineVerdict` | **PASS** | Beyan + önbellek + yerel politika; çevrimdışı ürün-yalanı yok |
| `privacyVerdict` | **PASS** | Tam VIN hiçbir yere gitmiyor; anahtar gömülü değil; künye `https:` şartı |
| `realDeviceValidationVerdict` | **PENDING_REAL_DEVICE** | Gerçek Doblo ölçümü yapılmadı |

**Başarı ölçütüne göre durum:** CAROS artık aracın sınıfını *çözümleyebilir* ve
mini/tam ekranda yolun ve aracın birlikte belirlediği sınırı *dürüstçe*
gösterir — ama bugün o sınıfın **tek güvenilir kaynağı kullanıcı beyanıdır**.
İnternet ayağı kanıtsız PASS almadı; sağlayıcı bağlanana ve gerçek araçta
ölçülene kadar bu tur **"cihazda doğrulanmadı"** olarak kalır.
