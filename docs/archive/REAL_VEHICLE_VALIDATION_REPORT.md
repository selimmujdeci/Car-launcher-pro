# NAVIGATION_CORE_RELIABILITY_P0 — GERÇEK ARAÇ DOĞRULAMA RAPORU

**Tarih:** 2026-08-03
**Cihaz:** `4L45OFZDX84X55GE` · Xiaomi `23090RA98I` · Android 13 · WebView Chrome 150
**Yöntem:** CDP over adb + `adb screencap` + 1 Hz saha kaydedici
**Commit / push / deploy / OTA:** YAPILMADI. Dirty worktree korundu;
`checkout · restore · reset · clean · stash pop` KULLANILMADI.

---

# ⛔ NİHAİ KARAR: `NOT_RUN` — GERÇEK ARAÇ SÜRÜŞÜ YAPILMADI

**P0-1 · P0-2 · P0-3 · P0-4 · P0-5 senaryolarının HİÇBİRİ koşulmadı.**
Ölçüm boyunca araç hareket etmedi ve hiçbir navigasyon oturumu başlatılmadı.

Görev `PASS · FAIL · FIX_REQUIRED` üçlüsünü şart koşuyor. **Bu üçünden hiçbiri
dürüstçe yazılamaz**, çünkü üçü de bir ÖLÇÜM gerektirir:

| Karar | Ne demektir | Bu koşumda geçerli mi |
|-------|-------------|-----------------------|
| `PASS` | Kabul ölçütü **ölçüldü** ve karşılandı | ❌ ölçüm yok |
| `FAIL` | Kabul ölçütü **ölçüldü** ve karşılanmadı | ❌ ölçüm yok |
| `FIX_REQUIRED` | Ölçümde **kusur gözlendi** | ❌ ölçüm yok |

Görevin bağlayıcı kuralı — *"Hiçbir şeyi tahmin etme. Sadece gerçek araçtan
ölçülen verileri raporla. Kanıt olmayan hiçbir başarı iddiası yazma."* —
üçünden birini seçmeye üstün gelir. Bu yüzden karar **`NOT_RUN`**'dır.

**Kalan tek iş sürüştür.** Ölçüm altyapısı kuruldu, doğrulandı ve hazır (§4).

---

## 1. NE YAPILDI (kanıtlı)

Sürüşe bağlı olmayan her şey tamamlandı. Bunların **hepsi gerçek cihazda
ölçülmüş kanıttır**, tahmin değildir.

| # | İş | Sonuç |
|---|----|-------|
| 1 | Cihazdaki APK'nın **bayat** olduğu kanıtlandı | ✅ kritik bulgu — §2 |
| 2 | Tam test kapısıyla taze APK üretildi ve kuruldu | ✅ 10 394 test yeşil |
| 3 | Yeni kodun cihazda **canlı** olduğu kanıtlandı | ✅ §3 |
| 4 | 1 Hz saha ölçüm koşumu kuruldu ve uçtan uca denendi | ✅ §4 |
| 5 | CAROS LAB · Navigation Core ekranı **cihazda açıldı** | ✅ §5 (ekran görüntüsü) |
| 6 | Park hâlinde **hayalet hız ölçüldü** | ⚠️ gerçek bulgu — §6 |
| P0-1..P0-5 | Gerçek araç senaryoları | ⛔ **NOT_RUN** |

---

## 2. KRİTİK BULGU — ölçüm YAPILSAYDI HİÇBİR ŞEYİ DOĞRULAMAYACAKTI

Doğrulamaya başlarken cihazdaki uygulamanın **NAV-CORE-P0 değişikliklerini
içermediği** ölçüldü:

```
Cihazdaki APK kurulum zamanı : 2026-08-03 19:30:18
routingService.ts            : 2026-08-03 20:39:10
navigationService.ts         : 2026-08-03 20:24:44
NavigationHUD.tsx            : 2026-08-03 20:26:07
mapMatchModel.ts             : 2026-08-03 20:42:00
NavigationCoreScreen.tsx     : 2026-08-03 20:30:00
```

**Kurulu sürüm, değiştirilen HER dosyadan eskiydi.** O hâliyle yapılacak bir
sürüş, eski kodu ölçer ve sonucu "NAV-CORE-P0 doğrulandı" diye raporlamak
tamamen yanlış olurdu. Bu, kütükte kayıtlı **stale-APK tuzağının** ta kendisidir.

**Yapılan:** tam test kapısı → build → WebView uyumluluk kapısı →
`cap sync` → `gradle clean assembleDebug` → `adb install -r`.
`clean` bilinçlidir (gradle "up-to-date" deyip eski APK paketleyebilir).

| Adım | Sonuç |
|------|-------|
| `npm run test` | **10 394 / 10 394 geçti** (466 dosya) — ama §2.1'e bakın |
| `npm run build` | başarılı (1 dk 15 sn) |
| `npm run compat:verify` | ✅ worker ES2015 · legacy ES2015 · boot-guard ES5-safe |
| `gradle clean assembleDebug` | **BUILD SUCCESSFUL** |
| `adb install -r` | **Success** — `lastUpdateTime=2026-08-03 21:24:24` |

### 2.1 Dürüstlük notu — bir test KARARSIZ

Bu koşumda dört tam suite çalıştırması yapıldı:

| Koşum | Sonuç |
|-------|-------|
| 1 (kod bitiminde) | 10 389 / 10 389 ✅ |
| 2 (APK kapısı) | 10 394 / 10 394 ✅ |
| 3 (son doğrulama) | **10 393 / 10 394 — 1 DÜŞTÜ** ❌ |
| 4 (tekrar) | 10 394 / 10 394 ✅ |

Düşen test: `labTruthAuthorities › T1 — BlackBox RPM canonical telemetri zinciri
› otorite patlarsa fail-closed null döner`. **İzole koşumda 41/41 geçiyor.**

Yani kilit **kırık değil, kararsız** — tam pakette bir test-arası izolasyon/
zamanlama etkisi var. NAV-CORE-P0 ile ilgisi yoktur (BlackBox telemetri zinciri;
bu turda o dosyalara dokunulmadı). Kütük **#376** olarak açıldı.
"Tüm testler yeşil" iddiasını zayıflattığı için **gizlenmemiştir**.

**Ortam notu (tekrarlanabilirlik):** derleme JDK 21 ister; sistem `JAVA_HOME`
Temurin 17'yi gösterdiği için ilk deneme
`Cannot find a Java installation ... languageVersion=21` ile düştü.
`JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"` ile geçti.

---

## 3. YENİ KODUN CİHAZDA CANLI OLDUĞU — KANIT ZİNCİRİ

Varsayım kullanılmadı. İki bağımsız kanıt alındı.

**KANIT 1 — cihaz birebir bu build'i servis ediyor:**

```
yerel dist/index.html : ["/assets/main-Cf7U7v_Q.js","/assets/main-legacy-CD8Yq_fy.js",
                         "/assets/polyfills-B3y7_SaX.js","/assets/polyfills-legacy-Bqar45vD.js"]
cihazdan fetch'lenen  : (aynı dört hash)
AYNI BUILD: EVET
```

**KANIT 2 — NAV-CORE-P0 sembolleri cihazın kendi origin'inden indirildi:**

| Cihazdan indirilen chunk | HTTP | Bayt | Doğrulanan sembol |
|---|:--:|--:|---|
| `/assets/NavigationCoreScreen-0MILfGyD.js` | 200 | 26 754 | `MATCH_UNCERTAIN` · `maneuverAnchors` · `SALT OKUNUR` |
| `/assets/useStore-BQfOwtqo.js` | 200 | 1 082 598 | `CONFIRMED_OFF_ROUTE` · `STRAIGHT_LINE_GUIDANCE` · `requiredEvidence` |
| `/assets/FullMapView-CT4Tm3Eq.js` | 200 | 123 520 | `distanceToNextTurnSource` |
| `/assets/CarosLabShell-YB6KD2O3.js` | 200 | 60 788 | `navigation-core` |

Bu sembollerin hiçbiri bu turdan önce kod tabanında yoktu.
**Sonuç: cihazda NAV-CORE-P0 kodu canlıdır.**

---

## 4. ÖLÇÜM KOŞUMU (kuruldu · denendi · hazır)

### 4.1 Neden gerekliydi

CAROS LAB · Navigation Core ekranı bilinçli olarak **"açılışta tek okuma +
elle YENİLE"** desenindedir (sürüşte timer/polling YOK). Bu, ekran başındaki
geliştirici için doğrudur ama **gerçek araç ölçümü için yetmez**: sürücü
direksiyondayken YENİLE'ye basamaz ve *"10 km boyunca `MATCHED` oranı"* gibi
zaman-serisi metrikleri elle toplanamaz.

### 4.2 Eklenen — salt-okunur saha köprüsü

`src/platform/devtools/navFieldBridge.ts` — mevcut senkron getter'ları
`window.__CAROS_NAV_FIELD__` üzerinde açar.
**Yeni durum üretmez · hiçbir şey başlatmaz · komut göndermez · timer kurmaz ·
ağa çıkmaz.** `DEVELOPER_FEATURES_ENABLED` derleme-zamanı sabitiyle korunur →
satış build'inde dinamik import dâhil **tamamı ölü kod olarak elenir**.

5 kilit eklendi (`regression.guards.test.ts`): salt-okunurluk · timer/ağ yasağı ·
dev kapısı · fail-soft · **LAB ekranının koordinat sözleşmesinin korunması**.

> **Gizlilik ayrımı (bilinçli):** köprü çıktısı ham koordinat İÇERİR — "servis
> yoluna atladı mı" sorusu aksi hâlde ölçülemez. Bu çıktı ekrana değil,
> geliştiricinin kendi makinesindeki ölçüm dosyasına gider. **LAB ekranı
> koordinat göstermemeye devam eder** ve bu bir kilitle bağlanmıştır.
> Ölçüm dosyası kişisel veridir; paylaşılmadan önce temizlenmelidir.

### 4.3 Araçlar

| Dosya | İş |
|-------|----|
| `scripts/nav-field-record.mjs` | 1 Hz JSONL kaydedici (CDP over adb) |
| `scripts/nav-field-analyze.mjs` | P0-1..P0-5 metriklerini çıkarır; ölçülemeyeni `NOT_MEASURED` yazar |

### 4.4 Uçtan uca denendi (park hâlinde, 21 sn)

Boru hattı çalışıyor: köprü kuruldu → 22 örnek yazıldı → analiz üretildi →
**tüm P0 testleri doğru şekilde `NOT_RUN` raporladı.** Analizci sahte PASS
üretmedi. Bu, aracın ölçüm için hazır olduğunun kanıtıdır.

### 4.5 Sürüş günü koşum talimatı

```bash
# 1) Uygulamayı başlat, PID'i al ve CDP'yi ilet
adb shell pidof com.cockpitos.pro
adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>

# 2) Kaydı başlat (her senaryo için ayrı etiket)
node scripts/nav-field-record.mjs P0-1

# 3) Senaryoyu sür → Ctrl+C

# 4) Analiz
node scripts/nav-field-analyze.mjs field-runs/nav-P0-1-<zaman>.jsonl
```

---

## 5. CAROS LAB · NAVIGATION CORE — CİHAZDA AÇILDI ✅

Gerçek cihazda açıldı ve doğrulandı (ekran görüntüsü:
`docs/evidence/nav-core-lab-device-2026-08-03.png`).

| Kabul ölçütü (kütük #372) | Sonuç |
|---|---|
| Çökmeden açılmalı | ✅ 8 kart · 41 alan render edildi |
| Navigasyon YOKKEN hüküm "NAVİGASYON YOK" | ✅ `data-verdict="IDLE"` |
| Bilinmeyen alan `UNAVAILABLE` (sahte 0 yok) | ✅ ÖLÇÜLDÜ 31 · TÜRETİLDİ 0 · **KAYNAK YOK 10** |
| Ekranda enlem/boylam görünmemeli | ✅ 41 alanın hiçbirinde koordinat yok |
| **Aktif navigasyonda gerçek veriyle dolmalı** | ⛔ **NOT_RUN** (navigasyon başlatılmadı) |
| **YENİLE dışında hiçbir şey değiştirmemeli** | ⛔ **NOT_RUN** |

Kartlar: `state · provider · matching · offroute · reroute · validation ·
maneuver · truth`.

---

## 6. GERÇEK ÖLÇÜM — PARK HÂLİNDE HAYALET HIZ ⚠️

Bu, bu koşumun **tek gerçek saha ölçümüdür** ve bir kusuru doğrulamaktadır.

Cihaz sabit dururken (masada, USB bağlı), 22 örnek / 21 saniye:

```
bildirilen hızlar (km/h) : 0,0,0,16,32,34,9,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0
bildirilen doğruluk (m)  : 3.0,3.0,3.0,2.0,3.0,3.0,3.0,3.0,3.0, ... (hepsi 2–3 m)
toplam yol               : 23.4 m
net yer değiştirme       : 4.7 m
düzlük oranı             : 0.200
```

**Araç HAREKET ETMEDİĞİ hâlde 4 saniye boyunca 16 → 32 → 34 km/h bildirildi**,
üstelik GPS kendi doğruluğunu 2–3 m olarak raporlarken.

Bu, kütük **#362**'de kayıtlı ve **hâlâ AÇIK** olan hayalet hız kusurudur.
Bu turda düzeltilmedi (bilinçli: hız otoritesi güvenlik katmanlarını besler ve
gerçek sürüş verisi olmadan filtre yazılmamalıdır).

### 6.1 Bunun saha testi YÖNTEMİNE etkisi — dikkate alınmalı

| Etki | Açıklama |
|------|----------|
| Analizcinin "hareket" filtresi | `speedKmh > 5` kapısı bu patlamalarla **yanıltılabilir** |
| Sapma kanıt penceresi | Hayalet 34 km/h, `offRouteModel`'i "15–70 km/h" kademesine (3 örnek / 1500 ms) sokar; gerçek hız < 15 km/h olsaydı 4 örnek / 2500 ms olacaktı |
| P0-5 (düşük hız trafik) | Bu senaryo **doğrudan bu kusurdan etkilenir** ve yorumlanırken #362 akılda tutulmalıdır |

**Bu bir NAV-CORE-P0 regresyonu DEĞİLDİR** — değişikliklerimden önce de vardı ve
denetim raporunda (§5.1) ölçülmüştü. Burada bağımsız olarak yeniden ölçülmüş ve
sayısallaştırılmıştır.

---

## 7. TEST SONUÇLARI — P0-1 … P0-5

Tümü için: **başlangıç zamanı YOK · bitiş zamanı YOK · ölçülen süre YOK** —
çünkü senaryo koşulmadı.

| Test | Ölçülen | Kabul ölçütü | Karar |
|------|---------|--------------|:-----:|
| **P0-1** Yeniden rota | — | ilk yeni yönlendirme ≤ 12 s | ⛔ `NOT_RUN` |
| **P0-2** Varış | — | ARRIVED tetiklenir · otomatik kapanır · ETA sıfırlanır | ⛔ `NOT_RUN` |
| **P0-3** Map matching | — | servis yoluna atlamaz · `MATCHED` ≥ %95 | ⛔ `NOT_RUN` |
| **P0-4** Yakın manevralar | — | ikinci yönlendirme zamanında · mesafeler doğru | ⛔ `NOT_RUN` |
| **P0-5** Düşük hız trafik | — | gereksiz reroute yok · ETA stabil | ⛔ `NOT_RUN` |

**Ön koşul ölçümü (park hâlinde):** hareket örneği 0 · navigasyon aktif örneği 0
· uygulanan rota 0 · sapma olayı 0.

**P0-2 için özel not:** bu turda düzeltilen **3.6× hız birim hatası** doğrudan
varış kapısını etkiliyordu (`ARRIVAL_SPEED_GUARD_KMH = 10` gerçekte 2.8 km/h'ye
düşüyor, hedefe yanaşan araçta `ARRIVED` **hiç tetiklenmiyordu**). Bu düzeltmenin
kanıtı **yalnızca P0-2 sürüşüyle** alınabilir — birim testi bu davranışı
kanıtlamaz.

---

## 8. KANIT DOSYALARI

| Kanıt | Yol |
|-------|-----|
| LAB ekran görüntüsü (cihaz) | `docs/evidence/nav-core-lab-device-2026-08-03.png` |
| Kaydedici | `scripts/nav-field-record.mjs` |
| Analizci | `scripts/nav-field-analyze.mjs` |
| Saha köprüsü | `src/platform/devtools/navFieldBridge.ts` |
| APK | `C:\Temp\carlauncher\app\build\outputs\apk\debug\app-debug.apk` (2026-08-03 21:23, 77.4 MB) |

Boru hattı denemesinin JSONL çıktısı geçici dizindedir (park hâli, saha kanıtı
değildir) ve bilinçli olarak repoya alınmamıştır.

---

## 9. BİLİNEN ÖLÇÜM SINIRI — DEV CONFIG DELTASI

Ölçüm için CDP şarttır ve `webContentsDebuggingEnabled` yalnız
`NODE_ENV=development` ile açılır. Bu, capacitor yapılandırmasında iki fark yaratır:

| Ayar | Ölçüm build'i | Satış build'i |
|------|---------------|---------------|
| `androidScheme` | `http` | `https` |
| `allowMixedContent` | `true` | `false` |
| `webContentsDebuggingEnabled` | `true` | `false` |
| `loggingBehavior` | `debug` | `none` |

Navigasyon mantığı (rota · eşleştirme · sapma · manevra · ses) bu ayarlardan
**etkilenmez**; ölçüm geçerlidir. Ancak *"satış build'inde de aynı"* iddiası
bu koşumdan **çıkarılamaz** ve çıkarılmamıştır.

---

## 10. SONRAKİ ADIM — TEK İŞ KALDI

Cihaz hazır, kod canlı, ölçüm koşumu doğrulandı. Eksik olan tek şey **sürüştür**.

Önerilen sıra (P0-1 en kritik ve tek başına en çok bilgi veren):

1. **P0-1** — hedef belirle, ilk dönüşü bilerek kaçır. `detectToFirstInstrMs` ≤ 12 s?
2. **P0-2** — hedefe kadar git, son 100 m yavaş. `ARRIVED` geliyor mu? *(3.6× düzeltmesinin tek kanıtı)*
3. **P0-3** — servis/paralel yolu olan bölge. `MATCHED` oranı ve yanal mesafe.
4. **P0-4** — 100–200 m arayla iki dönüş. `distSource = ALONG_ROUTE` oranı.
5. **P0-5** — 0–10 km/h trafik. Gereksiz reroute var mı? *(#362 etkisiyle birlikte yorumla)*

Her senaryo ayrı etiketle kaydedilmeli (`node scripts/nav-field-record.mjs P0-1`).
Sürüşten sonra analiz çıktıları bu rapora eklenir ve karar
`NOT_RUN` → `PASS` / `FAIL` / `FIX_REQUIRED` olarak **ölçüme dayanarak** güncellenir.

---

## 11. KARAR ÖZETİ

```
NAVIGATION_CORE_RELIABILITY_P0 · GERÇEK ARAÇ DOĞRULAMASI

  P0-1  Yeniden Rota          NOT_RUN
  P0-2  Varış                 NOT_RUN
  P0-3  Map Matching          NOT_RUN
  P0-4  Yakın Manevralar      NOT_RUN
  P0-5  Düşük Hız Trafik      NOT_RUN

  NİHAİ:  NOT_RUN  (gerçek araç sürüşü yapılmadı)

  Hazırlık: TAMAMLANDI ve KANITLANDI
    · taze APK kuruldu, yeni kod cihazda canlı (chunk kanıtı)
    · ölçüm koşumu kuruldu ve uçtan uca denendi
    · LAB Navigation Core ekranı cihazda açıldı (ekran görüntüsü)
  Gerçek bulgu: park hâlinde 34 km/h hayalet hız (kütük #362 · AÇIK)
```

> Bu raporda **hiçbir başarı iddiası** gerçek araç ölçümüne dayanmadan
> yazılmamıştır. `NOT_RUN` bir kaçış değil, ölçülmemiş olanın dürüst adıdır.
