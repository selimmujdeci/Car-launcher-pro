# DEVİR — "Arabam Cebimde" ölü uçlarının kapatılması (2026-08-14)

> **Bu belge bir sonraki oturumun giriş noktasıdır.** Önce bunu oku, sonra
> `docs/DEVICE_VALIDATION_LEDGER.md` **#573–#577** maddelerini oku. Kütük
> mutlak otoritedir; bu belgeyle çelişirse **kütük** geçerlidir.

| Alan | Değer |
|---|---|
| Tarih | 2026-08-14 |
| Branch | `feat/fleet-offline-final-local-completion` |
| Commit durumu | **HİÇBİR ŞEY COMMIT EDİLMEDİ** — 135 değişiklik çalışma ağacında |
| Kütük maddeleri | #573 · #574 · #575 · #576 · #577 (hepsi 🔴) |
| Genel durum | `COMPLETE_LOCAL` — **saha kanıtı YOK**, migration'lar **hiçbir ortama uygulanmadı** |

---

## 1. Bu oturum nasıl başladı

Kullanıcı telefonundaki **"Arabam Cebimde" PWA**'nın altı ekran görüntüsünü
paylaşıp sordu: *"bu özelliklerin altı dolu mu ve vizyonda burada neler
yapılacağı yazıyor mu?"*

Kod denetimi yapıldı. Sonuç: **bir kısmı gerçekten uçtan uca çalışıyordu**
(kilit/korna/far → MCU/CAN zinciri, navigasyon gönderme, tema stüdyo),
**bir kısmı tamamen ölü uçtu** ve ekranda çalışıyor görünüyordu. Kullanıcı
"sırayla başla yapmaya" dedi; ardından "yapalım" diyerek kalan borçların da
kapatılmasını istedi.

---

## 2. Kapatılan beş iş (kütük #573–#577)

### #573 — Teşhis sekmesi ölü uçtu (ÜÇ KATMANLI)

| Katman | Kusur |
|---|---|
| DB | `vehicle_commands_type_check` 2026-04-24'ten beri **9 tipte donmuş**; `read_dtc`·`clear_dtc`·`read_voltage`·`set_speed_alert`·`layout_change` **hiçbiri yok** → INSERT `23514` ile reddediliyor, **komut hiç oluşmuyor** |
| DB | `result` kolonu **hiç yaratılmamış**; `/api/pwa/dtc-result` `SELECT ... result` yapıyor → `42703` |
| Araç | `commandListener.CommandType` union'ında bu tipler yok → `default: rejected`; native `CommandService.java` switch'inde de yok |

**Yapılan:** migration **063** + yeni `remoteDiagnosticCommands.ts` yürütücü
katmanı + `commandListener` sözleşmesi `{outcome, result?, reason?}`'a genişletildi
(sonuç DB'ye yazılır, ret gerekçesi artık **aracın gerçek gerekçesi**).

**Aynı turda kapatılan dört dürüstlük kusuru:**
1. `readAllDTCs()` web/demo modda bilinçli **boş liste** döner → uzak kullanıcıya
   *"Arıza Kodu Yok / Sistemler normal"* diye sunulacaktı. Artık native olmayan
   platformda komut `failed`, okuma **hiç denenmez**.
2. **Kısmi tarama gizleniyordu**: Mode 03/07/0A'dan biri düşerse `dtcService`
   bunu `completeness.failed` ile bildiriyor ama API bu bilgiyi **düşürüyordu**.
   Artık `partial` taşınır; boş liste + kısmi tarama **"Sonuç Belirsiz"** gösterir.
   `unsupported` **kasten** kısmi sayılmaz (araç Mode 0A'yı hiç bilmiyorsa bu
   okuma kaybı değildir).
3. **Sahte voltaj iki yerdeydi**: demo modda `11.8 + Math.random()*1.6`;
   gerçek modda `vehicle.batteryVoltage ?? 12.4` — üstelik komutun kendi sonucu
   hiç okunmuyordu. Artık tek kaynak aracın yazdığı `result.voltage`.
4. **Yalancı temizleme**: `clearDtc` 2 sn sonra listeyi körlemesine boşaltıyordu;
   write-gate reddetse bile kullanıcı silindi sanıyordu. Artık terminal durum
   beklenir + **silme sonrası doğrulama okuması** yapılır.

`clear_dtc` yıkıcı olduğu için `E2E_REQUIRED_COMMANDS`'a alındı (MCU listesi
native ile birebir kalsın diye **ayrı sabit**).

### #574 — Hız uyarısı + **kör güvenlik kapısı**

Telefon `set_speed_alert` gönderiyordu ama sonucu **hiç okumadan**
(`catch {}` + koşulsuz) *"Kaydedildi ✓"* diyordu; komut DB CHECK'inde
olmadığı için zaten hiç oluşmuyordu.

> **Bu maddenin asıl bulgusu hız uyarısı DEĞİLDİR:**
> `commandListener.updateCurrentSpeed()` ürün yolunda **sıfır çağırana** sahipti
> → `currentSpeedKmh` daima **0** → uzaktan lock/unlock'un *"sürüş sırasında
> reddet (>5 km/h)"* kapısı **hiç tetiklenemiyordu**. Araç 100 km/h giderken
> telefondan verilen **"Aç" komutu geçerdi.**

**Yapılan:** yeni `speedAlertRuntime.ts` — kendi timer'ı YOK, mevcut `onOBDData`
akışına biner ve **tek okumadan iki tüketici** besler: hız kapısı (`onSpeed`, DI
ile enjekte — `commandListener` bu modülü import ettiği için dairesel bağımlılık
kurulmadı) ve uyarı kararı. Karar **saf**: histerezis 8 km/h + 5 dk cooldown →
eşiğin iki yanında 40 salınımda bildirim sayısı **1**. Hız ölçülmemişse hüküm
üretilmez ve kapıya **0 yazılmaz**; ölçülmüş 0 geçerli veridir.

Eşik **zero-trust** (30–250 km/h dışı reddedilir, **mevcut ayar korunur**),
`safeStorage`'a yazılır. Bildirim tek otoriteden gider (`notifyVehicleEvent` →
mevcut `triggerPushNotify`); edge function'a `speed_alert` olayı eklendi.

Telefon ucu üç ayrı gerçeği gösterir: **Sırada** · **Araçta ✓** (yalnız araç
`completed` yazınca) · **Gönderilemedi/Reddedildi**.

### #575 — Kumanda telemetri şeridi

Ekran görüntüsünde: araç OFFLINE, *"Araç bağlantısı kesildi"* bandı var ve
altında **HIZ 22 yeşil · YAKIT 0 · MOTOR 0**. 22 bayattı, iki sıfır **sahte 0**.

Kök: `vehicleStore` gerçeği zaten `telemetry` katmanında (`Measurement`:
değer + hüküm + yaş + kaynak) taşıyordu; **tüketici o etiketi hiç okumuyordu**.
`TelemetryTile` ile bağlandı: bilinmeyen → em-dash, bayat → `· çevrimdışı`
etiketli, ölçümsüz/bayat sinyale **sağlık rengi verilmez**.

### #576 — CAROS LAB · Uzak Komut Zinciri ekranı

Zorunlu gözlemlenebilirlik borcu. Ekranın tek işi **"komut çalışmadı"nın dört
sebebini ayırmak**: dinleyici yok · E2E şifre kapısı · güvenlik kapısı ·
tanımsız tip. Hükümler: `NOT_LISTENING · NEVER_RECEIVED · CRYPTO_BLOCKED ·
TYPE_UNKNOWN · SAFETY_BLOCKED · HEALTHY · UNKNOWN`.

Kanıt defteri iki modüle eklendi (`getCommandEvidence`, `getSpeedAlertEvidence`),
sayaçlar **doyar** ve **oturumludur** (diske yazılmaz).

**Dürüstlük:** `HEALTHY` yalnız gerçekten tamamlanan komut varsa verilir —
*"hata yok" tek başına sağlık kanıtı değildir*. "Tamamlandı" sayacı komutun
**yürütüldüğünü** gösterir, kapının fiziksel olarak kilitlendiğini **kanıtlamaz**.
Ekranda `kapıya verilen ölçüm = 0` iken **hız kapısı körlüğü uyarısı** çıkar.

### #577 — Kayıtlar sekmesi sunucuya bağlandı

Yakıt + servis kayıtları **tamamen `localStorage`**tı: telefon değişince yok
oluyordu, kullanıcıya söylenmiyordu, ve depo anahtarı **sabitti** →
**iki araçta kayıtlar karışıyordu**.

Migration **064**: `vehicle_fuel_logs` + `vehicle_service_records`
(RLS açık · `anon` REVOKE · politika `user_can_access_vehicle()` üzerinden ·
`client_ref` benzersiz indeksiyle **çift-gönderim koruması** · `odometer_km`
**NULLABLE** · `source` kolonu).

Yeni `recordsService.ts`: oturum varsa sunucuya yazar, **yoksa yerelde tutar ve
bunu açıkça söyler** (`SERVER` / `LOCAL_ONLY` / `SERVER_ERROR` rozeti). Eski
sabit anahtardaki veri **bir kez göç ettirilir** (kaynak silinmez — hangi araca
ait olduğu bilinemez, veri kaybı riski alınmaz).

**Üç kusur daha kapandı:** servis hükmü `vehicle?.odometer ?? 0` kullanıyordu →
kilometresi bilinmeyen araçta `kmSince` negatif çıkıp her kalemi sahte **"İyi"**
yapıyordu (artık `unknown`); "Yapıldı" düğmesi **0 km** yazıyordu (artık `null`);
tüketim/harcama hesapları ölçülemeyen kayıtları artık hesaba katmıyor.

---

## 3. Kanıt (ölçülen, iddia edilmeyen)

| Katman | Sonuç |
|---|---|
| Kök kasası | **12104 / 12104** yeşil |
| website | **1017 / 1017** yeşil |
| tsc | kök (`npx tsc -b`) + website (`npx tsc --noEmit`) temiz |
| Gerçek PostgreSQL — 063 | **7/7 PASS** + idempotent + fail-closed |
| Gerçek PostgreSQL — 064 | **8/8 PASS** (cross-tenant reddi dâhil) |
| Yeni kilit | 61 (13 + 15 + 5 + 13 + 15) |

**Migration kusurları ölçümle kanıtlandı** (teori değil): 063 öncesi
`INSERT read_dtc` → `23514`; `SELECT ... result` → `42703`.
064 doğrulaması **gerçek rol** (`SET LOCAL ROLE authenticated`) ve **gerçek
`auth.uid()`** ile koştu — politika metnini okumak kanıt sayılmadı (#203–#208 dersi).

**Flaky not:** kök kasasında bir turda `labTruthAuthorities.test.ts >
sampleRpm` düştü; ertesi koşumda 12091/12091 yeşil geldi ve tek başına 41/41
geçiyor. Dinamik `vi.doUnmock` + `resetModules` kullanan bir test — yük altında
modül yarışı. **Bu oturumun değişiklikleriyle ilişkisi ÖLÇÜLMEDİ**, sadece iki
koşumdan biri; kesin denmedi.

---

## 4. 🔴 KALAN AÇIK BORÇ — öncelik sırasıyla

### B1. Migration 063 ve 064 hiçbir ortama uygulanmadı ⚠️ EN KRİTİK
Uygulanana kadar **Teşhis sekmesi, Hız Uyarısı ve sunucu-kayıtları ÜRÜNDE HÂLÂ
ÖLÜDÜR.** Yerel doğrulama saha kanıtı değildir. Kütük #573/#577'deki kabul
ölçütleri ancak migration sonrası ölçülebilir.

### B2. Kayıtlar için çevrimdışı kuyruk entegrasyonu yok
Ağ yokken kayıt yalnız yerelde kalır ve **otomatik senkron edilmez**.
`client_ref` altyapısı hazır (`unique_violation` ile çift gönderim korumalı);
`website/src/lib/offline/fleetOffline.ts` kuyruğuna bağlanması gerekiyor.
**Not:** `offlineClassification.ts` sınıflandırması var — yakıt/servis kaydı
`OFFLINE_DEFERRED` olmalı (güvenlik işlemi değil).

### B3. Araç içindeki SÜRÜCÜYE hız uyarısı yok
Bu tur yalnız telefona bildirim üretir. In-car uyarı **Guardian'ın eylem
otoritesine** girer ve vizyon belgesi *"Guardian'a kalp atışı verildi, SES
verilmedi; ürün otoritesi VehicleCompute.worker → SystemOrchestrator
DEĞİŞMEDİ"* diyor. **İkinci eylem otoritesi kurma riski var** — bu bir ürün
kararıdır, sessizce yapılmadı.

### B4. Sunucudaki kaydı silme/düzenleme UI'da yok
Tablolarda DELETE/UPDATE ayrıcalığı ve politikası **var**; yalnız arayüz yok.

### B5. OBD kilometresiyle otomatik bakım eşleştirmesi yok
Bakım hükmü hâlâ elle girilen km'ye bağlı. `vehicle.odometer` akıyorsa
servis kaydı otomatik km alabilir (şu an `markDone` anındaki değeri alıyor).

### B6. Eşleştir ekranı — telefondaki sürüm ESKİ
Kodda QR sekmesi kaldırılmış (`(['pin'] as Mode[])`, kütük #199) çünkü QR akışı
ölü `/api/pwa/pair`'e bağlıydı. **Kullanıcının telefonunda QR Tara sekmesi hâlâ
görünüyor** → telefon eski deploy'a bakıyor. Bu bir deploy meselesi, kod
meselesi değil.

---

## 5. Dosya haritası (bu oturum)

**Yeni — araç tarafı (`src/`)**
```
src/platform/remoteDiagnosticCommands.ts     read_dtc/clear_dtc/read_voltage yürütücüsü
src/platform/speedAlertRuntime.ts            hız uyarısı + hız kapısı besleyicisi
src/platform/devtools/remoteCommandSources.ts  LAB tek okuma katmanı
src/platform/devtools/remoteCommandModel.ts    LAB saf modeli (nowMs dışarıdan)
src/components/devtools/screens/RemoteCommandScreen.tsx
```

**Değişen — araç tarafı**
```
src/platform/commandListener.ts   +3 komut tipi · ExecResult sözleşmesi · kanıt defteri
                                  · notifyVehicleEvent · E2E_REQUIRED_COMMANDS
src/platform/system/SystemBoot.ts  SpeedAlertRuntime kaydı (updateCurrentSpeed DI)
src/platform/devtools/carosLabCatalog.ts     'remote-command' girdisi
src/components/devtools/carosLabScreenMap.tsx lazy import + case
```

**Yeni — telefon tarafı (`website/`)**
```
website/src/lib/recordsService.ts   yakıt/servis veri otoritesi + göç + saf hesaplar
```

**Değişen — telefon tarafı**
```
website/src/app/api/pwa/dtc-result/route.ts      partial/errorReason/demo taşır
website/src/components/pwa/DiagnosticsPanel.tsx  gerçek voltaj · kısmi tarama · doğrulanmış silme
website/src/components/pwa/RecordsPanel.tsx      servise bağlandı · judgeService (export, saf)
website/src/components/dashboard/MobileCarControl.tsx  TelemetryTile · SpeedAlertPanel durumları
```

**SQL**
```
supabase/migrations/20260814000063_command_diagnostic_types_and_result.sql
supabase/migrations/20260814000064_vehicle_maintenance_records.sql
supabase/verification/local_063_{fixture,verify}.sql
supabase/verification/local_064_{fixture,verify}.sql
supabase/functions/push-notify/index.ts   'speed_alert' olayı
```

**Testler**
```
src/__tests__/remoteDiagnosticCommands.test.ts   13 kilit
src/__tests__/speedAlertRuntime.test.ts          15 kilit
src/__tests__/remoteCommandLab.test.ts           13 kilit
website/src/__tests__/mobileTelemetryHonesty.test.tsx  5 kilit
website/src/__tests__/recordsService.test.ts     15 kilit
```

> ⚠️ `src/platform/devtools/carosLabRefresh*.ts` ve
> `src/__tests__/carosLabRefreshAll.test.tsx` **bu oturuma ait DEĞİLDİR** —
> önceki turdan (kütük #556/#557) gelen commit edilmemiş dosyalardır.

---

## 6. Doğrulama komutları

```bash
# Kök
npx tsc -b
npx vitest run src/__tests__/remoteDiagnosticCommands.test.ts \
               src/__tests__/speedAlertRuntime.test.ts \
               src/__tests__/remoteCommandLab.test.ts \
               src/__tests__/regression.guards.test.ts
npx vitest run                      # tam kasa ~5 dk

# website
cd website && npx tsc --noEmit && npx vitest run

# Migration doğrulaması (Docker Desktop açık olmalı)
docker desktop start
MSYS_NO_PATHCONV=1 docker run -d --name caros_verify \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=carosverify postgres:16-alpine
until MSYS_NO_PATHCONV=1 docker exec caros_verify pg_isready -U postgres; do sleep 1; done
MSYS_NO_PATHCONV=1 docker exec -i caros_verify psql -U postgres -d carosverify -v ON_ERROR_STOP=1 \
  < supabase/verification/local_064_fixture.sql
MSYS_NO_PATHCONV=1 docker exec -i caros_verify psql -U postgres -d carosverify -v ON_ERROR_STOP=1 \
  < supabase/migrations/20260814000064_vehicle_maintenance_records.sql
MSYS_NO_PATHCONV=1 docker exec -i caros_verify psql -U postgres -d carosverify -v ON_ERROR_STOP=1 \
  < supabase/verification/local_064_verify.sql
MSYS_NO_PATHCONV=1 docker rm -f caros_verify
```

**Windows/Git Bash notu:** `MSYS_NO_PATHCONV=1` olmadan Docker yol çevirisi
komutu bozar. Kullanıcının **kendi `fleetval` Supabase stack'i** ayrıdır —
doğrulama için geçici konteyner kullanıldı, ona **dokunulmadı**.

---

## 7. Bu oturumda öğrenilen tuzaklar (tekrar etme)

1. **Gizlilik kilidi kendi açıklama metnine takılır.** `remoteCommandLab`
   kilidi tüm görünüm JSON'unda `payload` arıyordu ve *"payload defterlere
   GİRMEZ"* notuna takıldı (#467–#479'daki alt-dize tuzağının aynısı).
   Çözüm: yasak-kelime taraması **değer alanlarında**, UUID/token taraması
   **tüm blobda**. Kilit zayıflatılmadı, doğru yere bakıldı.

2. **Renk kilidi tüm kartta arama yapmamalı.** `mobileTelemetryHonesty`
   ilk yazımda `#34d399` arıyordu ve "Aç" düğmesinin yeşiline takıldı.
   Ürün doğruydu, test kurgusu yanlıştı → şerit izole edildi.

3. **Dairesel import riski.** `speedAlertRuntime` ile `commandListener`
   birbirini import edecekti; hız kapısı besleyicisi **DI'ya** çevrildi
   (`startSpeedAlertRuntime({ onSpeed })`), bağlama noktası `SystemBoot`.

4. **`tail -N` ile pipe edilen arka plan komutunda test özeti kaybolur.**
   Vitest çıktısını `grep -E "Test Files|Tests |×"` ile süz.

5. **Yanlışlama koşuldu ve işe yaradı:** voltaj kapısı bilerek gevşetildi
   (`v > 0` → `Number.isFinite(v)`), ilgili kilit **anında düştü**, geri alındı.
   Yeni kilit yazınca bunu yap — yoksa kilit boşluğa atılır.

---

## 8. Sonraki oturum için önerilen ilk adım

1. `docs/DEVICE_VALIDATION_LEDGER.md` **#573–#577** oku (kabul ölçütleri orada).
2. `docs/CAROS_PRO_VIZYONU.md` → "Arabam Cebimde" satırını oku.
3. Kullanıcıya sor / karar iste: **B2 (çevrimdışı kuyruk)** mı, **B3 (araç-içi
   hız uyarısı — mimari karar)** mı?
4. Migration 063/064 **uygulanmadan** hiçbir #573/#574/#577 maddesi 🟢 yapılamaz.

**Asla yapma:** kütükte 🔴 bekleyen bir maddeyi "çalışıyor/tamam" diye sunma.
Test yeşil + tsc temiz olması bir özelliği başarılı YAPMAZ.
