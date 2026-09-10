# DEVİR — OBD extended-poll + NAVİGASYON G1/G3 (2026-08-11)

> **Bu belge bir DEVİRDİR.** Yeni oturum bunu okuyup kesintisiz devam edebilir.
> Branch: `feat/fleet-offline-final-local-completion` · Son commit: `ad2ac94`
> Önce oku: `CLAUDE.md` · `AI.md` · `docs/CAROS_PRO_VIZYONU.md` ·
> `docs/DEVICE_VALIDATION_LEDGER.md` (mutlak otorite)

---

## 0. TEK CÜMLEYLE NEREDE KALDIK

OBD extended-poll hattı (eleme çağlayanı · ATST · görünürlük) **kod tarafında
kapandı ve sahada kısmen doğrulandı**; navigasyon tarafında **G1 (konum kanıt
otoritesi)** kuruldu ve **G3'ün kökü ilk kez ÖLÇÜLEREK bulundu**. Sırada üç iş
var; üçü de bu belgenin §5'inde, kanıtlarıyla.

---

## 1. BU OTURUMDA KAPANANLAR (kütük #523–#535)

| # | Konu | Durum |
|---|---|---|
| #523 | H-A deneyi raporlaması: hüküm kapısı iki yollu (`RATIO`/`ABSOLUTE`), ekran kaydırma, sonuç kopyaya | 🔴 araçta doğrulanmadı |
| #524 | **Eleme çağlayanı kırıldı** — ATST CAN'de (`CAN_ST_HEX="64"` ≈400 ms) · eleme kalıcı değil (merdiven 20→60→180→600 tur) · rotasyon kademelendi | 🟢 **sahada çalıştı** (bkz. §3) |
| #525 | TS tarafındaki ikinci eleme otoritesi (`_unavailable` hiç silinmiyordu) | 🟢 sahada tutarlı |
| #526 | "Bayat veri" aslında **bayat snapshot**tı → önbelleklere `refreshedAt` damgası | 🟢 **sahada çalıştı** |
| #527 | **G1 tek konum kanıt otoritesi** — `getLocationEvidence()`, fix yaşı üç hesaptan tek monotonik otoriteye | 🔴 #508 hâlâ ölçülemedi |
| #528 | DR canlılık sinyali gerçek sahibe (`navigationSessionRuntime`) bağlandı | 🔴 |
| #529 | Harita eşiği otoriteye bağlandı (aynı 5 sn **dört** yerdeydi) + **konum bayat rozeti** | 🔴 |
| #530 | **G3 ETA salınımı ayrıldı** + `etaJumpLedger` (kanıt aracı) | 🟢 **kök ölçüldü** (bkz. §3) |
| #531 | #526'nın ölçüm penceresi yanlıştı (araç kapalı 1 sa 53 dk'yı sayıyordu) → iki ayrı ölçüm | 🟢 sahada 11,6 sn |
| #532 | Hat olayında native eleme sıfırlanıyor ama TS kaydı kalıyordu → `bulk_reset` bildirimi | 🔴 |
| #533 | VIN maskesi yanlış pozitifi (ondalık sayı maskeleniyordu) | 🟢 sahada okunabilir |
| #535 | **Saha koşumu ölçüm üretemedi** — `fixAgeMs` ve ETA defteri kopyada YOKTU | 🟢 sahada iki bölüm de geldi |

**Belge işleri:** `CAROS_PRO_VIZYONU.md` **§7.9 Navigasyon Vizyonu** (7 katman ·
sesli-öncelikli 4 kova · 20 fikir 5 grupta · ürün sözü G1'e bağlı · LLM sınırı) ve
`docs/ADR_OFFLINE_ROUTING.md` (ön-ADR: lisans elemesi · PID Pack deseni · kabul kapısı).

**Araç dışı:** `tools/apk-serve.cjs` Range/resume desteği (#534 — kopan indirme
kaldığı yerden devam eder).

---

## 2. AKTİF SÖZLEŞMELER (bozulmaması gerekenler)

- **Tek otorite:** fix yaşı YALNIZ `gpsService.getLocationEvidence()`ten, monotonik
  saatten. Tüketici kendi hesabını YAPMAZ (kasa KİLİT 27).
- **Eşik tek yerde:** `LOCATION_STALE_MS` (5 sn). Harita/DR/nav kendi eşiğini taşımaz.
- **Eleme:** bir kez `OK` dönen PID KALICI elenemez; stabilizasyon 10 tur; toplu eleme
  = hat olayı → sıfırla + say + **TS'e bildir**.
- **ATST:** CAN'de `CAN_ST_HEX="64"` (tek sabit); KWP/ISO9141 `FF`te kalır.
- **Defterler karar üretmez:** `etaJumpLedger` eşzamanlılık kaydeder, nedensellik
  iddia etmez; baskın tetikleyici yalnız **pay ≥%50 VE ikinciden açık fark** varken.
- **Sahte 0 yasak:** ölçülemeyen alan `null`; "okunmadı" ≠ "yok".

---

## 3. SAHA KANITI — 2026-08-11 son koşum (en değerli veri)

Cihaz: Xiaomi 23090RA98I · APK `c0a49bad…` · commit `ad2ac94`

### 3.1 G3'ÜN KÖKÜ BULUNDU — `SPEED_GATE_CHANGED` baskın

```
byTrigger: SPEED_GATE_CHANGED 4 · ROUTE_REVISION 1 · BASE_DURATION_ONLY 1
           DISTANCE_SOURCE_CHANGED 0     ← hiç tetiklenmedi
dominant : SPEED_GATE_CHANGED (4/6 = %67)
```

Dört geçişin **hepsi** `factor 1 ↔ 1.5`:

| ETA | factor | aritmetik beklenti | ölçülen | fark |
|---|---|---|---|---|
| 167→246 | 1→1.5 | 250 | 246 | 4 s |
| 224→150 | 1.5→1 | 149 | 150 | 1 s |
| 143→207 | 1→1.5 | 214 | 207 | 8 s |
| 183→122 | 1.5→1 | 122 | 122 | 0 s |

**Mekanizma kanıtlandı:** dur-kalk trafiğinde araç `ETA_MIN_CORRECTION_KMH` (8 km/h)
eşiğini her geçtiğinde düzeltme çarpanı **ani** olarak 1 ↔ 1.5 atlıyor ve ETA %50
zıplıyor. **Mesafe kaynağı SUÇSUZ** (`distanceSource: ALONG_ROUTE` sabit; #441 çalışıyor).

⚠️ Önceki tahminim "mesafe kaynağı daha şüpheli" idi — **ölçüm çürüttü**.

### 3.2 `fixAgeMs` — #508 HÂLÂ HESAPLANAMIYOR

```
fixAgeMs: 5237   (tek ANLIK örnek)
```

#508 ölçütü **dağılım** ister (`p50<3s ∧ p95<10s`). Kopyada tek örnek var, dağılım yok.
Eski taban p50 **19,5 s**; 5,2 s daha iyi görünüyor ama **tek örnekten p50 çıkmaz**.

### 3.3 Bağlantı kararsızlığı (bu koşumun en sert bulgusu)

```
reconnectHistoryCount : 8 (8 timeout)
connectionQuality     : 57      (önceki koşum: 100)
reconnectPressure     : 1.71    (önceki: 0.0019)
trail: OBD:LinkLost — 47 s boyunca HİÇBİR paket (ATRV dahil)
trail: HealthMonitor — No heartbeat for 19-20 s  ×3
trail: real → none → real geçişleri
```

Kullanıcının baştan beri söylediği **"veri kesiliyor, geri geliyor"** ilk kez sayılarla kayıtlı.

### 3.4 Çalıştığı doğrulananlar

| Ölçüm | Değer | Anlam |
|---|---|---|
| `firstDataAfterConnectMs` | **11 632 ms** | #531+#535 tuttu (önceki saçma değer: 1 sa 58 dk) |
| `permanentCount/pausedCount` | 0 / 0 · `everOk 11/11` | eleme çağlayanı kırık (#524) |
| `timeline.demoted` | 0 | TS↔native ayrışması yok (#525/#532) |
| `reconnectPressure` | `1.7147…` okunabilir | VIN maskesi yanlış pozitifi düzeldi (#533) |
| `pollKanitiYasMs` | 273 142 (4,5 dk) | snapshot yaşı görünüyor (#526) |
| `noData` (önceki koşum) | 3/20 = %15 | #524 ölçüt 3 için umut verici, **örnek yetersiz** |

---

## 4. AÇIK KÜTÜK BORÇLARI (bu oturumdan)

- **#508** — G1 kabul ölçütü: `p50<3s ∧ p95<10s ∧ iz/gerçek yol>0,9`. **Dağılım defteri olmadan kapanamaz.**
- **#530** — G3: kök bulundu, **düzeltme yapılmadı**.
- **#524 ölçüt 3** — NO_DATA oranı tabanın (%43-80) altına indi mi? 20 denemelik ölçüm yetersiz.
- **#513** — `supportedCount 19` vs `watchedCount 11`: 8 PID hâlâ izlenmiyor.
- **#533 kalan** — aynı VIN deseni **5 dosyada daha** kopyalanmış, tek otoriteye indirilmeli.
- **#527 kalan** — `hal.updatedAt` monotonik; LAB uyarıyor ama duvar saatine çevrilmedi.

---

## 5. SIRADAKİ ÜÇ İŞ (öncelik sırası + gerekçe)

### GÖREV A — Bağlantı kararsızlığı (ÖNCE BU)
**Neden önce:** 8 timeout · LinkLost 47 s · quality %57 varken hem `fixAgeMs`
dağılımı hem ETA ölçümü **gürültülü** kalır; diğer iki görevin ölçümünü kirletir.

**Kök NEDEN BİLİNMİYOR — önce ölçüm.** Adaylar: adaptör · RFCOMM soketi · ELM init ·
araç ECU uyku. Elde `3.3`teki trail seti var, oradan başlanmalı. **Kör düzeltme YASAK.**

### GÖREV B — `fixAgeMs` dağılım defteri
`etaJumpLedger`in ikizi: `gpsService`te bounded halka, p50/p95 hesabı **saf modelde**,
kopyaya bölüm. #508 ancak bununla kapanır. Tahmini pay ~%30.

### GÖREV C — G3 düzeltmesi (kök kanıtlı, en kolay)
`etaModel`de hız kapısı geçişinde `factor`ü **ani değil kademeli** uygula (histerezis
ya da rampalama). Kanıt §3.1'de. Doğrulaması aynı defterle: `SPEED_GATE_CHANGED`
sayısı **düşmeli**. Tahmini pay ~%15.

> Alternatif sıra: C'yi hemen yapıp aynı defterle ölçmek de savunulabilir (kanıt
> döngüsü kapanır). A'nın önceliği ölçüm kalitesi gerekçesiyledir, aciliyet değil.

---

## 6. TEKRARLANMAMASI GEREKEN HATALAR (bu oturumda BEN yaptım)

1. **Ölçüm yazıp kopyaya bağlamamak — İKİ KEZ yaptım** (#523 H-A deneyi, #535 ETA
   defteri + `fixAgeMs`). Kullanıcı sahaya çıktı, sürdü, **ölçüm alınamadı**.
   → **Kural:** yeni bir ölçüm/defter yazıldığında AYNI PR'da `carosLabCopySources`
   + `carosLabCopyModel`e bölüm eklenir ve bölüm sayısı kilidi güncellenir.
2. **`npx tsc --noEmit` YETMEZ.** `npm run build` (tsc -b, proje referanslı) ayrı
   hatalar yakalıyor — plugin sözleşmesi eksikleri sadece orada çıktı.
3. **Damga sıfırlarken yeniden set yolunu düşünmemek** (#531→#535): tur sıfırlaması
   `firstDataAt`ı öldürdü çünkü damga yalnız data gate ilk açılışında yazılıyordu.
4. **Kilitleri gevşetmek yerine taşımak.** `_drState` → `_setDrState` değişiminde 4
   kilit düştü; kaldırılmadı, yeni biçime taşındı. `getPidStatus` sırasını
   "düzeltmeye" kalktığımda iki kilit haklı çıktı ve **geri aldım**.
5. **Ham saha verisi scratchpad'de kalıcı değil.** `navrun.jsonl` silinmişti; 43
   sıçramayı zaman ekseninde işaretleyemedim. Kalıcı kanıt gerekiyorsa `docs/` altına.

---

## 7. ORTAM NOTLARI (zaman kazandırır)

```
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"     # Java 21 ZORUNLU
APK       : C:/Temp/carlauncher/app/build/outputs/apk/debug/app-debug.apk
adb       : C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe
cihaz     : 4L45OFZDX84X55GE (Xiaomi 23090RA98I)
build     : npx cap sync android && node scripts/gradle-build.mjs clean assembleDebug
tünel     : node tools/apk-serve.cjs <apk> 8787 + cloudflared tunnel --protocol http2 --url http://localhost:8787
```

- Tam test ~3 dk (`npx vitest run`), guard ~6 sn (`npm run guard`), build ~3-5 dk.
- Yüksek sistem yükünde 2 zaman-duyarlı test **flaky** (254-350 sn koşumlarda düşüyor,
  175-178 sn koşumlarda temiz). Kod kaynaklı değil — kütük #312 sınıfı.
- APK ~77 MB; **%70'i Vosk STT** (56 MB model + 16 MB lib). Test APK'sı için Vosk
  çıkarılırsa ~30 MB olur (sesli asistan çalışmaz).

## 8. SAHA KOŞUMU TALİMATI (kullanıcıya verilecek)

1. OBD bağla, veri aksın · **2. ROTA KUR** (navigasyon ACTIVE olmadan ETA defteri boş kalır)
3. 20+ dk, dur-kalk + viraj karışık · tünel varsa gir (`KONUM N sn` rozeti)
4. Dönüşte **uygulamayı kapatma** → CAROS LAB → **Runtime → "Sorgu Zamanlayıcı"** aç
   (native sayaç önbelleği yalnız orada tazelenir) → **TÜMÜNÜ KOPYALA**

> Ekran adı **"Sorgu Zamanlayıcı"**dır (dosya adı `RuntimeSchedulingScreen` — LAB'da
> öyle yazmaz). "Kuyruk İzleyici" de aynı ekranı açar.
