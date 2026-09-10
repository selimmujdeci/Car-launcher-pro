# NAVIGATION_CAMERA_SHADOW — Kamera Politikası Gölge Doğrulaması

**Tarih:** 2026-08-05 · **Dal:** `feat/fleet-offline-final-local-completion`
**Commit / push / deploy:** YAPILMADI · dirty worktree korundu ·
`git checkout/restore/reset/clean/stash` KULLANILMADI ·
`cameraEngine` eğrilerine **DOKUNULMADI** · Android/orientation kodu
**DEĞİŞTİRİLMEDİ**.

---

## 1. Yönetici Özeti

`NAVIGATION_MOTION_CAMERA_P0` turu `CAM-2026.08.05` politikasını kurmuş ama
kamerayı sürmediği için **PARTIAL** kalmıştı. Bu tur devralmanın ön koşulunu
kurar: iki sonucu **aynı navigasyon oturumunda yan yana ölçmek.**

**Ürün davranışı değişmedi.** Politika yalnız gölgede çalışır; hiçbir kamera
değeri uygulamaz, hiçbir Map API çağrısı yapmaz. Önceki turun en somut açık
borcu — `suppressedCameraUpdates` alanının **sabit 0** raporlanması — kapatıldı:
sayaç artık gerçek `setDrivingView` çağrılarından geliyor.

**Karar: `NAVIGATION_CAMERA_SHADOW_COMPLETE_LOCAL`**
(`realVehicleValidationVerdict = PENDING_REAL_VEHICLE`).

---

## 2. Değişen Dosyalar

**Yeni:**
* `src/platform/navigation/core/cameraShadowModel.ts` — SAF karşılaştırma
* `src/platform/navigation/cameraShadowRuntime.ts` — sayaçlar + gölge değerlendirme
* `src/__tests__/navigationCameraShadow.test.ts` — 37 kilit

**Değişen:**
* `src/platform/map/MapInteractionManager.ts` — **yalnız iki raporlama çağrısı
  + bir yardımcı fonksiyon**. Kamera matematiği, eşikler ve akış DEĞİŞMEDİ.
* `src/platform/devtools/navigationCoreSources.ts` — `cameraShadow` alanı,
  `suppressedCameraUpdates` gerçek sayaca bağlandı
* `src/platform/devtools/navigationCoreModel.ts` — kart 13 gölge bölümü (13 alan)
* `src/__tests__/regression.guards.test.ts` — 3 durakta-kamera kilidi **biçim**
  güncellemesi (davranış aynı; gerekçe kilidin içine yazıldı)
* `src/__tests__/navigationCoreFieldAudit.test.ts` ·
  `carosLabNavigationCore.test.tsx` — fixture + kayıt

---

## 3. Shadow Mimarisi

```
setDrivingView (LEGACY — değişmedi)
   │  uyguladı  → _reportShadow(applied=true, zoom, pitch, bearing, anchorY, …)
   │  erken döndü → _reportShadow(applied=false, …)
   ▼
cameraShadowRuntime.noteLegacyCameraOutcome()
   ├─ decideCameraPolicy(...)        ← CAM-2026.08.05 (saf)
   ├─ shouldApplyCameraUpdate(...)   ← kabul/bastırma SAYILIR, uygulanmaz
   └─ compareCameraOutcome(...)      ← saf karşılaştırma
   ▼
CAROS LAB kart 13 (salt-okunur)
```

**Pazarlıksız sınırlar (hepsi test kilitli):**

| Kural | Kanıt |
|---|---|
| Gölge `cameraEngine`'i import ETMEZ | `cameraEngine`/`CAMERA_CFG` dizgesi yok |
| Gölge Map API çağırmaz | `maplibre`/`jumpTo`/`easeTo`/`.project(`/`getZoom` yok |
| Gölge koordinat kabul etmez | Tip düzeyinde `lat/lon/lng` alanı yok |
| Ek `project()` eklenmedi | Dosyadaki çağrı sayısı **3'e sabitlendi** (üçü de bu turdan önce vardı) |
| Raporlama fail-soft | `_reportShadow` gövdesi try/catch |
| `cameraEngine` sabitleri değişmedi | 10 sabit birebir kilitli (`ZOOM_AT_0: 18.5` … `TOP_PAD_MAX: 0.70`) |

**`anchorY` nasıl karşılaştırılıyor:** legacy'nin çapası **türetilmedi,
ÖLÇÜLDÜ**. `setDrivingView` çerçeve denetimi için `map.project([lng,lat]).y`
değerini **zaten** hesaplıyordu; gölge o değeri `y / H` olarak yeniden kullanır.
Bu yüzden gölge katmanı için ek harita işi YOKTUR.

---

## 4. Legacy ↔ Policy Karşılaştırma Tablosu

| Boyut | Legacy (cameraEngine) | Policy (CAM-2026.08.05) | Bu turda karşılaştırılıyor mu |
|---|---|---|---|
| zoom | `computeCameraTarget` eğrisi + hazard kilidi | **önermiyor** | ❌ `null` — sahte 0 YAZILMAZ |
| pitch | piecewise eğri, kavşakta düşürülür | **önermiyor** | ❌ `null` |
| bearing | `dampCameraToward` + anticipation | **önermiyor** | ❌ `null` |
| **anchorY** | `map.project(...).y / H` (ÖLÇÜM) | bant tablosundan | ✅ **delta ölçülüyor** |
| **kamera sürüldü mü** | `applied` (erken dönüş dahil) | `cameraDriveAllowed` | ✅ **ayrışma MAJOR** |
| speedBand | örtük (eğri sürekli) | açık, histerezisli | ✅ raporlanıyor |
| maneuverBand | örtük (`turnApproachM`) | açık, yol-boyu kapılı | ✅ raporlanıyor |
| bastırma nedeni | yok | `updateReason` | ✅ raporlanıyor |

**Ayrışma sınıfları:** `IDENTICAL · MINOR (<0.05) · MODERATE (<0.15) ·
MAJOR (≥0.15 veya karar ayrışması) · UNCOMPARABLE`.

En anlamlı sinyal bu turda sayı değil **karardır**: legacy kamerayı sürdü mü,
politika sürmesine izin verir miydi? Ayrışma tam olarak ürünün farklı
davranacağı yeri işaret eder.

---

## 5. Sayaçların Veri Kaynağı

| Sayaç | Nereden artar |
|---|---|
| `policyEvaluationCount` | Her `setDrivingView` çağrısı (uygulasa da atlasa da) |
| `policyAcceptedCount` | `shouldApplyCameraUpdate` → `true` |
| `policySuppressedCount` | `shouldApplyCameraUpdate` → `false` — **`suppressedCameraUpdates` artık BU** |
| `legacyCameraApplyCount` | `applied === true` raporu |
| `legacyCameraSkipCount` | `applied === false` (erken dönüş) |
| `duplicateEquivalentUpdateCount` | `isEquivalentUpdate(prev, next)` |
| `maxAnchorYDelta/Zoom/Pitch` | Oturum boyunca gözlenen azami mutlak fark |

**İki değişmez testle kilitli:**
`accepted + suppressed === evaluation` ve `legacyApply + legacySkip === evaluation`
→ hiçbir çağrı sayaçtan kaçmaz.

**Sabit 0 kalmadı:** test önce sayacın 0 olduğunu, sonra gerçek çağrılarla
arttığını doğrular.

---

## 6. Gizlilik ve Maskeleme Kanıtı

* `LegacyCameraOutcome` tipinde **lat/lon/lng alanı YOKTUR** — koordinat gölge
  katmanına tip düzeyinde giremez (kilit: `readonly (lat|lon|lng|…)` regex'i eşleşmemeli).
* Rota geometrisi geçmez; yalnız **skaler** yol-boyu mesafe (m).
* `JSON.stringify(getCameraShadowSnapshot())` içinde `"lat"/"lon"/"latitude"/
  "longitude"/"coordinate"` bulunmadığı testle doğrulanır.
* Kullanıcı adresi/hedef adı zincire hiç girmez.
* Gölge katmanında `console.*` yoktur — hiçbir şey loglanmaz.

---

## 7. Test Sonuçları

**Yeni:** `navigationCameraShadow.test.ts` — **37 kilit**
(A saf karşılaştırma · B runtime sayaçları · C ürün-değişmedi yapısal kilitleri ·
D LAB veri kaynağı).

Görevde istenen senaryoların tamamı kapsandı: sabit hızda cruise · 90/82
histerezis · yaklaşan dönüş · durakta yön dondurma · bayat GPS · düşük heading
güveni · art arda eşdeğer güncellemeler · güncelleme fırtınası bastırma ·
legacy=policy aynı karar · legacy≠policy büyük fark.

| Kapı | Sonuç |
|---|---|
| `npx tsc -b --force` | ✅ temiz |
| `npm run lint` | ✅ yeni/değişen dosyalarda **0 sorun** (4 hata **önceden vardı**, dokunulmayan dosyalarda) |
| `npx vitest run` | ✅ **477 dosya / 10769 test** — **iki ardışık tam koşumda da temiz** |

### Taşınan kilitler (kaldırılmadı)
`regression.guards` içindeki üç durakta-kamera kilidi erken dönüşün **tek satır**
biçimini metin olarak şart koşuyordu. Erken dönüş bloğa alındı (çıkmadan önce
gölge bildiriliyor) — **davranış birebir aynı**: çerçeve VE yön doğruyken hiç iş
yapmadan `return`. Kilitler yeni biçime taşındı, gerekçe kilidin içine yazıldı ve
**yeni bir kilit eklendi**: erken dönüş yolu da gölgeye bildirilmeli (aksi hâlde
"legacy hiç atlamıyor" yanılgısı doğardı).

### LAB alan denetiminde yapısal istisna
`sh-zoom-d` / `sh-pitch-d` dolu anlık görüntüde bile `UNAVAILABLE`'dır ve bu
**doğrudur**: politika bu turda zoom/pitch önermiyor. Sahte 0 delta yazmak
"fark yok" yanılgısı üretirdi. İstisna denetim testinde **açıkça listelendi** ve
gerekçesinin ekranda yazdığı ayrıca kilitlendi — eğri devralındığında istisna
kalkmalıdır.

---

## 8. Mevcut Test Paketindeki Bağımsız Flaky Durum

Önceki turda `selfTestEngine.test.ts > "ekran-defteri probu opsiyonel olarak
dahil edilir"` 5 tam koşumun 2'sinde **5011 ms'de timeout**'a düşmüştü.

**Bu tur sahiplenilmedi ve sahiplenilmesi için gereken kanıt aranıp
BULUNAMADI:**
* Bu turdaki iki tam koşumda da **geçti**.
* İzole koşumda geçiyor (6/6).
* `selfTestEngine` zincirinde `cameraShadow*` / `cameraPolicy*` /
  `navMarkerMotion*` **import bağı yok** (grep ile doğrulandı).
* Gölge katmanı timer/RAF/ağ kullanmaz → zamanlama bağı kurulamaz.

Sonuç: **bağımsız, önceden var olan zamanlama hassasiyeti.** Yeni kodla bağı
kanıtlanmadığı için bu turun kapılarına dahil edilmedi ama gizlenmedi de.

---

## 9. CAROS LAB (kart 13 genişletmesi)

Gölge bölümü — 13 salt-okunur alan: gölge modu AÇIK/KAPALI · son karşılaştırma
sınıfı · **legacy/politika kararı** (`UYGULADI/ATLADI` ↔ `İZİN/BASTIR`) · çapa
farkı · zoom farkı (gerekçeli boş) · pitch farkı (gerekçeli boş) · **azami
gözlenen fark** (çapa/zoom/pitch) · değerlendirme · kabul · **bastırma (gerçek
sayaç)** · legacy uygula/atla · eşdeğer güncelleme · son bastırma nedeni ·
bağlam (hız · yol-boyu manevra · konum yaşı · heading güveni).

LAB hiçbir kamera veya hareket davranışını değiştiremez.

---

## 10. Gerçek Araçta Doğrulanması Gereken Ölçümler

1. **Çapa farkı gerçekte ne kadar?** LAB `Azami gözlenen fark` — 90–110 km/sa
   otoyol kesiminde ve şehir içinde ayrı ayrı okunmalı. Eğri devralma kararı
   bu sayıya bağlıdır.
2. **Karar ayrışması var mı?** `legacy/politika kararı` alanında `MAJOR`
   görülüyor mu — özellikle kullanıcı pan sonrası ve GPS bozukken.
3. **Bastırma oranı:** `policySuppressedCount / policyEvaluationCount`. Yüksekse
   (ör. >%50) eğri devralındığında ciddi kamera işi elenecek demektir (ısı/FPS
   kazancı).
4. **Eşdeğer güncelleme oranı** — aynı kararın kaç kez tekrarlandığı.
5. **Erken dönüş oranı:** `legacyCameraSkipCount` — durakta filtrenin gerçekte
   ne sıklıkta devreye girdiği.
6. **Gölge maliyeti:** gölge AÇIK/KAPALI arasında FPS ve sıcaklık farkı
   ölçülmeli (beklenen: ölçülemez düzeyde; saf karşılaştırma, Map çağrısı yok).

---

## 11. Açık Borçlar

1. **`viewport` her zaman `FULL` raporlanıyor.** `setDrivingView` hem mini hem
   tam ekrandan çağrılıyor ve çağıranı ayırt edecek bir parametresi yok. Mini/
   tam ekran ayrımı için imzaya alan eklemek gerekirdi — bu, "legacy'ye dokunma"
   sınırının dışına çıkardı. Bugün politika `viewport`u zaten yalnız ileride
   kullanacak; karar üzerinde etkisi yok.
2. **Politika hâlâ zoom/pitch/bearing önermiyor** — devralma bir sonraki turun
   işi ve §10'daki ölçümlere bağlı.
3. **Gölge sayaçları oturumlar arası kalıcı değil** (bilinçli): süreç yeniden
   başlarsa sıfırlanır. Saha ölçümü tek sürüş oturumunda yapılmalı.
4. **Gerçek araçta hiçbir ölçüm yapılmadı.**

---

## 12. Nihai Karar

### `NAVIGATION_CAMERA_SHADOW_COMPLETE_LOCAL`

| Kapı | Hüküm |
|---|---|
| TypeScript | ✅ temiz |
| Lint (yeni/değişen dosyalar) | ✅ 0 sorun |
| İlgili testler | ✅ 37/37 |
| Tüm test paketi | ✅ 10769/10769 (iki ardışık koşum) |
| Flaky sahiplenme disiplini | ✅ import/zamanlama bağı arandı, bulunamadı, sahiplenilmedi |
| Ürün kamerası değişmedi | ✅ eğri sabitleri + Map çağrı sayısı + akış kilitli |
| LAB sayaçları gerçek runtime'dan | ✅ değişmez toplam testleriyle kanıtlı |
| `realVehicleValidationVerdict` | **PENDING_REAL_VEHICLE** |

Görev tanımının tamamı yerel olarak karşılandı: iki sonuç aynı oturumda yan yana
üretiliyor, farklar ölçülüyor, sayaçlar gerçek veriden geliyor, koordinat
maskeli ve **ürün davranışı değişmedi**. Eğri devralma bilinçli olarak
yapılmadı — o kararın girdisi §10'daki saha ölçümleridir.
