# 🎯 VİZYON KAPATMA PLANI — CANLI ÇALIŞMA DOSYASI

> **Bu dosya CANLIDIR.** Her iş bittikçe burada güncellenir. Denetim raporu değil,
> **iş takip otoritesidir**. Kaynak: 2026-08-21 tam vizyon gerçekleşme denetimi
> (forensic; 12.584 test koşuldu, `tsc` temiz, tüm iddialar koddan sayıldı).
>
> **Kaynak hiyerarşisi (çelişkide kim kazanır):**
> `docs/DEVICE_VALIDATION_LEDGER.md` (saha gerçeği) > `docs/CAROS_PRO_VIZYONU.md` (ürün gerçeği)
> > **bu dosya** (iş sırası) > diğer tüm belgeler.
>
> Bu dosya bir maddeyi ✅ yaptığında **kütükte 🔴 satır açılmadan** o madde
> "tamamlandı" SAYILMAZ (CLAUDE.md — saha doğrulama invaryantı).

---

## 📋 DURUM ANAHTARI

| İşaret | Anlamı |
|---|---|
| ⬜ | Başlanmadı |
| 🔵 | Devam ediyor |
| 🟨 | Kod bitti · test yeşil · **kütükte 🔴 saha borcu açık** |
| 🟢 | Cihazda/prod'da doğrulandı (kütükte 🟢'ya taşındı) |
| ⛔ | Bloke (sebep yazılacak) |
| 🚫 | İptal / kapsam dışı (gerekçe yazılacak) |

---

## 📊 İLERLEME ÖZETİ (her turda güncellenir)

**Son güncelleme:** 2026-08-21 — **V-01 🟢 KAPANDI** (CI'da uçtan uca kanıtlandı: yeşil ·
mutasyonda kırmızı · düzeltmede tekrar yeşil — kütük 🟢 #677) ·
**V-02 🟢 KAPANDI** (066 prod'da UYGULANMIŞ; dongle'sız yazma yolu **4 günlük gerçek üretim
trafiğiyle** kanıtlandı — kütük 🟢 #676. Kalan tek uç PWA sunum rozeti, ayrı 🔴 olarak kütükte).

| Faz | Toplam | ⬜ | 🔵 | 🟨 | 🟢 | ⛔ | 🚫 |
|---|---|---|---|---|---|---|---|
| P0 — Yanlış güven / güvenlik | 4 | 2 | 0 | 0 | **2** | 0 | 0 |
| P1 — Vizyonun can damarı | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| P2 — Zekâ katmanı | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| P3 — Doğrulama borcu | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| P4 — Enterprise | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| P5 — Mimari karar | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| **TOPLAM** | **18** | **16** | **0** | **0** | **2** | **0** | **0** |

**Vizyon skoru:** `%58` → hedef `%75` (P0+P1+P2 tamamlanınca)
**Cihaz doğrulama oranı:** `19 / 666 = %2,85` → hedef `%15`

---

## 🧊 DENETİM TABANI (2026-08-21 — DONDURULMUŞ ÖLÇÜM)

Sonraki denetimler bununla karşılaştırılacak. **Bu bölüm değiştirilmez**; yeni ölçüm
alınırsa ALTINA yeni bir taban bloğu eklenir.

| Ölçüm | 2026-08-21 |
|---|---|
| Ürün kodu (src, test hariç) | 299.670 satır / 1.101 dosya |
| Test kodu (src/`__tests__`) | 164.527 satır / 578 dosya |
| Website (filo/PWA) ürün kodu | 48.723 satır |
| Android native Java | 27.820 satır / 111 dosya |
| Birim test koşumu | **574 dosya · 12.584 test · 12.584 PASS · 0 FAIL** (206 s) |
| TypeScript derleme | **TEMİZ** (`tsc -b` exit 0) |
| TODO/FIXME (ürün kodu) | 5 |
| Supabase | 42 migration · 84 POLICY · 54 tabloda RLS · 194 SECURITY DEFINER |
| Kütük 🔴 / 🟢 / ❌ | **639 / 19 / 8** |
| Vizyon belgesi ÜRÜN HAZIR | EVET **1** · HAYIR **48** |
| CAROS LAB ekranları | 45 AVAILABLE · 7 PLACEHOLDER · 2 DISABLED |
| DTC katalog (sayıldı) | **210 benzersiz** (P=175 · U=17 · C=11 · B=7) |
| Bağlanmamış ürün kodu | ~2.900 satır (bkz. V-04) |

---

# ⚡ P0 — YANLIŞ GÜVEN VE GÜVENLİK (HEMEN)

## 🟢 V-01 — Native Java'yı CI'ya al  **[KAPANDI 2026-08-21]**

**BULGU:** **25 Java test sınıfı / 335 test** yazılı ama CI'da hiç koşmuyordu.
27.820 satır native Java (CAN bus, MCU komut whitelist'i, ELM327 parser) —
**fiziksel araç komutlarını gönderen katman** — otomatik kapı olmadan sürüm alıyordu.

**KANIT:**
- `android/app/src/test/java/...` → 20 dosya · `android/phonehub-protocol/src/test/...` → 6 dosya
  (5 test sınıfı + 1 yardımcı). Koşumda üretilen JUnit XML: **25 sınıf / 335 test**.
- `.github/workflows/*.yml` → `gradle` **0 sonuç**, `./gradlew` **0 sonuç**, `assembleDebug` **0 sonuç**
- `codeql.yml:38` → `languages: javascript-typescript` (Java **yok**)
- `main.yml:131` `reporter: java-junit` → bu **vitest JUnit XML formatı**, Java testi DEĞİL

**YAPILACAK:** `main.yml`'e Java unit test job'ı + JUnit raporu yayınlama.

**KABUL ÖLÇÜTÜ:** Bir PR'da `McuCommandWhitelistTest` bilinçli kırıldığında CI **KIRMIZI** olur;
düzeltilince yeşile döner. CI çıktısında Java test sınıflarının adı görünür.

**RİSK:** 🔴 YÜKSEK — kilit/korna/alarm güvenlik whitelist'i sessizce bozulabilir.

### KOŞUM KAYDI — 2026-08-21

**Yapıldı:**
- `.github/workflows/main.yml` → **JOB 4 `android_unit_tests`** (12 adım, `needs:` YOK →
  lint/test zincirine PARALEL; Java doğruluğu TypeScript lint'ine bağlı değildir ve seri
  zincire eklemek bir ESLint uyarısının native regresyonu gizlemesi demekti).
  Koşulan görevler: `:app:testDebugUnitTest` + `:phonehub-protocol:test`.
- `android/build.gradle:23-45` → `buildDir` OS-koşullu yapıldı. Eskiden **koşulsuz**
  `C:/Temp/carlauncher/...` idi; Linux'ta bu, proje dizini altında `C:` adlı bir klasöre
  dönüşüp rapor/cache yollarını anlamsızlaştırırdı.
- `android/gradlew` → git dosya modu **100644 → 100755**. Linux runner'da `./gradlew`
  "permission denied" veriyordu. Workflow'da ayrıca savunma amaçlı `chmod +x` var.

**CI'da kırılacak ÜÇ gizli bağımlılık ölçülerek bulundu ve karşılandı:**
1. `capacitor-cordova-android-plugins/` **.gitignore'lu** (`android/.gitignore:93`) ama
   `settings.gradle` onu `include` ediyor → taze checkout'ta **konfigürasyon düşer**.
   Çözüm: `npx cap update android`. `sync` DEĞİL — `update`'in `dist/` istemediği ölçüldü
   (koşuldu: "Updating Android plugins in 9.00ms … 6 Capacitor plugins").
2. `gradlew` exec biti yok (yukarıda).
3. `buildDir` Windows mutlak yolu (yukarıda).

**NDK KURULMUYOR — ölçüme dayalı karar:** yerel koşumun görev grafiği **49 görev** ve
içinde `cmake|ndk|externalNative|jniLib` eşleşen **TEK görev yok**. `testDebugUnitTest`
native derlemeye dokunmuyor → ~1 GB indirme ve dakikalar tasarruf. Varsayım yanlışsa
job kırmızı olur ve nedenini adıyla söyler; o durumda `packages:` satırına
`ndk;26.3.11579264` eklenir.

**KANIT — testler gerçekten geçiyor:**
```
:app:testDebugUnitTest + :phonehub-protocol:test  →  BUILD SUCCESSFUL (34 s)
JUnit XML sayımı: 25 sınıf · 335 test · 0 başarısız · 0 hata · 0 atlanan
```

**KANIT — kapı GERÇEKTEN ISIRIYOR (ürün mutasyonu, testi değil):**
`McuCommandFactory.java:39`'daki `CMD_HONK_HORN` whitelist'ten geçici olarak çıkarıldı →
```
java.lang.AssertionError at McuCommandWhitelistTest.java:57
251 tests completed, 2 failed → Task :app:testDebugUnitTest FAILED → BUILD FAILED (exit 1)
```
Mutasyon geri alındı (`git diff` boş) → tekrar `BUILD SUCCESSFUL` (exit 0).

**KANIT — doğrulama adımı 1 pozitif + 3 negatif senaryoda koşuldu** (CI dizin düzeni
simüle edilerek):
| Senaryo | Beklenen | Sonuç |
|---|---|---|
| Tam rapor | geç | ✓ `25 sınıf · 335 test`, exit 0 |
| `McuCommandWhitelistTest` raporu yok | blokla | ✓ `::error::… not found`, exit 1 |
| Hiç XML yok | blokla | ✓ `::error::Java JUnit XML üretilmedi`, exit 1 |
| XML var ama `tests="0"` | blokla | ✓ `::error::0 test var`, exit 1 |

**Süreçte düzeltilen iki kendi hatam:**
- Doğrulama adımı `bc` kullanıyordu; Git Bash'te `bc` YOK → sayaç **sessizce boş** kalıp
  adım yeşil geçiyordu. `awk`'a çevrildi **ve** `total <= 0` artık bloke ediyor
  ("suite dosyası var, içi boş" deliği kapandı).
- `android/build.gradle` yorumunda "tr-TR'de `Windows`.toLowerCase() → `wındows`" yazmıştım.
  **Ölçtüm, yanlıştı:** JVM varsayılan locale `tr_TR` ama `os.name` = "Windows 11" ve içinde
  büyük `I` yok → parametresiz çağrı da doğru sonuç veriyor. Yorum gerçeğe göre düzeltildi;
  `Locale.ROOT` bir hatayı onarmıyor, bir **kazaya güvenmeyi** bırakıyor.

**AÇIK BORÇ (bu yüzden 🟢 DEĞİL 🟨):** iş akışı **GitHub Actions'ta hiç koşmadı**. Kabul
ölçütünün "CI kırmızı olur" yarısı yalnız gerçek bir runner'da kanıtlanabilir.
Kütük: **🔴 #675**.  → **KAPANDI, kütük 🟢 #677.**

### ✅ KAPANIŞ — 2026-08-21 (gerçek GitHub Actions koşumu)

Kapı `ci/v01-verify` dalında koşturuldu. Trigger'a `ci/**` deseni eklendi: bir
workflow'un push tetikleyicisi **push edilen daldaki** dosyadan okunur, yani kapı main'e
girmeden kendi dalında kanıtlanabildi. (`pull_request` kapsamı bilinçli olarak main/dev'de
bırakıldı.) 390 commit'lik bir PR açmaya veya `dev` dalı uydurmaya gerek kalmadı.

| Ölçüt | Koşum | Sonuç |
|---|---|---|
| (a) job yeşil biter, 25 sınıf / 335 test | 32473905876 | ✅ `BUILD SUCCESSFUL in 2m 27s` · `✓ Java test sınıfı: 25 · toplam test: 335` · 14/14 adım yeşil |
| (b) ürün kırılınca KIRMIZI, düşen test adıyla | 32475771551 | ✅ `McuCommandWhitelistTest > allSixHardwareCommandsProducePackets FAILED` + `> whitelistGateIsEffective FAILED` · `251 tests completed, 2 failed` |
| (c) düzeltme sonrası tekrar yeşil | 32476143408 | ✅ `BUILD SUCCESSFUL in 2m 47s` · yine 25 sınıf / 335 test |

Mutasyon **testi değil ürünü** bozdu (`CMD_HONK_HORN` whitelist'ten çıkarıldı) ve mutasyon
commit'leri `ci/v01-verify` dalında kaldı — ana dala **girmedi**.

**Yolda çıkan üç gerçek kusur — üçü de yalnız gerçek runner'da görünürdü:**

1. **`@capacitor/cli` Node≥22 istiyor, CI'da 20 vardı.** Yerelde görünmezdi (bu makinede
   Node 24). Dikkat çekici olan: **hata mesajı doğruydu ama kök değildi** — `cap update`
   fatal verince sonraki dört adım atlandı ve doğrulama adımı `if: always()` ile koşup
   *"Java JUnit XML üretilmedi"* dedi. Gerçek kök dört adım yukarıdaydı.
2. **`cap update` `dist/` istiyor** — gerekçesi bu turdan önce **iki kez yanlış** kurulmuştu
   (*"istemez"*: ana ağaçta ölçülmüş artefakt; *"koşulsuz copy çalıştırır"*: kaynak
   desteklemiyor). Doğrusu koşullu ve kaynaktan okundu — `update.js:31`.
3. **gradle fail-fast kritik suite'i görünmez kılıyordu** → `--continue` eklendi (kütük #678).

**Yan bulgular (V-01 kapsamı dışı, ayrı kütük maddeleri):**
- **#678 🔴** `LinkSessionTest` **flaky** — aynı kod, iki koşum, farklı sonuç. Gerçek
  iş parçacıkları + `Thread.sleep(900L)`. Bu flaky, gradle fail-fast ile birleşince
  kilit/korna/alarm whitelist kapısını **görünmez** kılıyordu.
- **#679 🔴** **E2E workflow'u 10 Temmuz'dan beri bir kez bile yeşil olmamış** (42/43
  koşum failure). Kapı her gece koşuyor ama **hükmü kimse okumuyor** — #675'in kardeşi.
- **CI lint'inde 12 hata** (hepsi `src/__tests__/`, ürün kodunda sıfır) — **aynı turda
  kapatıldı**. İkisi kozmetik değildi: bir **ölü kilit** (regex'e `\b` yerine gerçek 0x08
  baytı girmiş → kilit her zaman geçiyordu) ve bir **eksik kilit** (`clearPendingAction`
  import edilmiş ama hiç çağrılmamış → iptal davranışının kilidi yoktu; import silmek
  boşluğu gizlerdi, kilit yazıldı). İkisi de yanlışlamayla sınandı.

**Kanıt:** kök suite 574 dosya / **12 590 test** yeşil · `tsc -b` temiz · `npm run lint` **0 error**.

### 🏁 TAM CI YEŞİL — run 32478181204

Son koşumda **dört job da yeşil**: `Lint & Type-Check` · `Unit Tests` · `Production Build` ·
`Android Unit Tests (JVM)` → **TUM CI: success**. `Production Build` bu koşumda **ilk kez**
çalıştı (önceki koşumlarda lint/test düştüğü için hep `skipped`ti).

Buraya gelmek **ikinci bir Node kökü** daha ortaya çıkardı (kütük 🟢 #680): `node:fs.globSync`
Node 22'de geldi, 20'de yoktur → `developerAccessGate.test.tsx` KİLİT 1
`TypeError: globSync is not a function` ile düşüyordu. Bu kilit CI'da **her zaman** düşerdi;
görünmemesinin tek sebebi Unit Tests job'ının bu dalda **hiç koşmamış** olmasıydı.

> ⚠️ Bu, bu turda düzeltilen **kendi hatamdı**: android job 22'ye alınırken global `NODE_VERSION`
> *"diğer üç job 20'de yeşil koşuyor"* denerek 20'de bırakılmıştı — bu bir **ölçüm değil
> varsayımdı** ve o joblar bu dalda hiç koşmamıştı. Kapsamı daraltma gerekçesi bile ölçülmüş
> olmalı; daraltmanın kendisi bir iddiadır. Global `NODE_VERSION` 22 yapıldı, ayrım kaldırıldı.

### ✅ İKİ AÇIK BORÇ DA KAPATILDI (aynı gün)

**#678 — "flaky" bir hipotezdi, doğru çıkmadı.** JUnit XML artefaktları indirilip stack
trace okununca düşen assertion'ın her koşumda **aynı satır** olduğu görüldü
(`client.confirmPairing(true)`). Kök zamanlama değil **ürün kusuruydu**:
`LinkHandshake.onConfirm()` `AWAITING_USER_CONFIRM` aşamasını kabul etmiyordu, dolayısıyla
iki uçta da onay isteniyorken **önce basanın CONFIRM'ü diğerini öldürüyordu**. Sahada da
olur; CI yalnız görünür kıldı. Onay atlanmadan düzeltildi (yalnız `peerConfirmVerified`
işaretlenir, `stage` değişmez) ve kilit **yarışa bırakılmadan** yazıldı (`framesReceived`
sayacıyla ölçülür). Yanlışlama: düzeltme geri alınınca 85 testin yalnız yenisi düştü.

**#679 — kırmızılığın kökü tek değil DÖRTTÜ**, üçü ürün dışıydı: (1) CI yalnız chromium
kuruyordu ama beş proje koşuluyordu (222 hata "browser not installed") · (2) config'deki
`isLandscape: true` viewport'u **döndürmüyor** — mobil projeler ürünün desteklemediği
PORTRE yönünde koşuyordu · (3) Supabase DNS (route + routeWebSocket ile kesildi; filtreye
istisna **eklenmedi**) · (4) testler eski varsayılan temaya yazılmıştı ve aradıkları
`Sistem`/`Arayüz` başlıkları üründe **hiç yok**. Sonuç: yerel E2E **185/185 yeşil, beş
tarayıcıda**. Stub'ın kusur yaratmadığı ayrıca ölçüldü (stub geri alınınca aynı 3 test
yine düştü — yani zaten kırıktılar, E2E hiç yeşil olmadığı için görünmüyorlardı).

**Kalan açık uç:** kapı henüz `main`/`dev` üzerinde koşmadı — bu dal main'e girene kadar
korumadaki PR'lar bu job'ı **görmez**. #678'in **saha ucu da açık**: düzeltilen eşleştirme
senaryosu gerçek telefon + head unit ile bir kez bile denenmedi (kabul ölçütü kütükte).


---

## 🟢 V-02 — Migration 066'nın prod durumunu doğrula  **[KAPANDI 2026-08-21]**

**BULGU:** `20260816000066_telemetry_honest_null_columns.sql` cihazda ölçülmüş bir kusuru
belgeliyor: 042 sahte 0'ları kaldırdı ama tablo kolonları `NOT NULL` kaldı →
`push_vehicle_event` **HTTP 400 / 23502**, 40 saniyede 9 başarısız çağrı,
*"Araç bulut tarafında HİÇ görünmüyor"*. **066'nın prod'a uygulandığı depodan doğrulanamıyor.**

**KANIT:** `supabase/migrations/20260816000066_telemetry_honest_null_columns.sql` başlığı
(Xiaomi 23090RA98I, CDP ağ yakalaması, 2026-08-16).

**YAPILACAK:** Prod'da doğrulama sorgusu:

```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='vehicle_telemetry'
  AND column_name IN ('speed','fuel','rpm','temp');
```

`is_nullable='YES'` değilse 066 (ve varsa 067–071) uygulanacak.

**KABUL ÖLÇÜTÜ:** Dört kolon da `YES`; ardından **dongle'sız** bir araçtan gelen
`heartbeat` olayı prod `vehicle_telemetry`'de satır oluşturur (HTTP 200 + satır sayısı +1).

**RİSK:** ⛔ BLOKE EDİCİ — uygulanmadıysa dongle'sız her araç bulutta görünmez, filo kördür.

### KOŞUM KAYDI — 2026-08-21

**⛔ BLOKE: bu makinede prod'a okuma yolu YOK.** Sebep tahmin değil, ölçüm:

| Erişim yolu | Durum | Ölçüm |
|---|---|---|
| Supabase CLI oturumu | ❌ | `~/.supabase/` içinde yalnız `telemetry.json` + `traces` — **access token yok** |
| DB parolası / service_role | ❌ | `.env*` dosyalarında yalnız `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |
| anon anahtarıyla PostgREST | ❌ | OpenAPI kökü **0 açık uç** döndürdü; `vehicle_telemetry` **açık değil** |
| Yerel Postgres (docker) | ❌ | Docker CLI 29.4.3 kurulu ama **daemon çalışmıyor** (`npipe … cannot find`) |

Not: anon'un **hiçbir** uca sahip olmaması bir kusur değil, R4 politikasının canlıda
tuttuğunun **olumlu kanıtıdır** (araç tabloları istemci rollerine kapalı).

**Yapıldı — cevap geldiği anda tek adımda alınacak hâle getirildi:**
`supabase/verification/prod_066_telemetry_nullability_readonly.sql` yazıldı.
**Hiçbir şey yazmaz** (ne DDL, ne DML, ne GRANT) — yalnız katalog okur, 5 adımda hüküm basar:
kolon nullability + default · `push_vehicle_event` gövdesi 042 sonrası mı ·
`service_role` INSERT ayrıcalığı · tek satırlık `verdict` · satır/NULL sayaçları.

**Script'te kapatılan üç tuzak (hepsi yazarken bulundu):**
1. `\pset` gibi psql meta-komutu **konmadı** — Supabase Dashboard SQL Editor backslash
   komutlarını anlamaz ve script'i reddederdi. Aynı dosya hem psql'de hem tarayıcıda çalışır.
2. Hüküm sorgusu tabloya **hiç dokunmuyor**. `CASE` dalları koşullu çalışsa da alt sorgular
   **planlanır**: aynı ifadede `count(*) FROM vehicle_telemetry` olsaydı, tablo yokken
   `'TABLO YOK'` dalı **basılmadan** sorgu hata verirdi — teşhis, teşhis edeceği arızada ölürdü.
3. `has_table_privilege`in **OID aşırı yüklemesi** kullanıldı (`to_regclass` ile). Metin
   aşırı yüklemesi tablo yoksa **hata fırlatır**; OID biçimi NULL girdide NULL döner → script ölmez.
   Ayrıca `information_schema.role_table_grants` **bilinçli kullanılmadı**: 2026-08-16'da
   ölçüldüğü gibi o görünüm salt-okunur oturumda ayrıcalık relacl'de MEVCUTKEN 0 satır döndürüyor.

**Script HİÇBİR VERİTABANINDA KOŞULMADI** (yukarıdaki dört yol da kapalı) — syntax'i
gözden geçirildi ama **çalıştığı kanıtlanmadı**. Bu dürüstçe böyle raporlanıyor.

**KULLANICIDAN GEREKEN (herhangi biri yeter, en kolayı A):**
- **A)** Supabase Dashboard → SQL Editor → dosyanın içeriğini yapıştır → Run → `verdict` sütununu bildir.
- **B)** DB parolası ver → `psql "$PROD_DB_URL" -f supabase/verification/prod_066_telemetry_nullability_readonly.sql`
- **C)** `supabase login` yap → `supabase link --project-ref vdpcdhrdmsacftrietzq` → (B)
- **D)** Docker Desktop'ı başlat → yerel Postgres'te script'in kendisini kuru koşumla doğrulayayım
  (bu prod sorusunu YANITLAMAZ, yalnız script'i doğrular).

`verdict = 'UYGULANMAMIŞ'` çıkarsa sıradaki iş 066'yı uygulamak; `'UYGULANMIŞ'` çıkarsa
V-02'nin (a) yarısı kapanır ve geriye yalnız (b) — gerçek cihazla dongle'sız heartbeat — kalır.

### ✅ KAPANIŞ — 2026-08-21 (aynı gün, kullanıcı erişimi açıldıktan sonra)

> ⚠️ Yukarıdaki "⛔ BLOKE" kaydı **iki denetim kusuru** içeriyordu. İkisi de burada
> düzeltiliyor; kayıt silinmiyor çünkü hatanın kendisi derstir.

**KUSUR 1 — kütük okunmadan "bilinmiyor" dendi.** V-02 *"066'nın prod'a uygulandığı
depodan doğrulanamıyor"* diyor. Oysa **kütük #603 (2026-08-16)** zaten
*"MIGRATION 066 PROD'A UYGULANDI"* kaydını taşıyordu — uygulama öncesi/sonrası katalog
ölçümü, idempotans koşumu ve gerçek INSERT senaryosuyla. **Kütük saha durumunda mutlak
otoritedir**; depo taranmadan önce oraya bakılmalıydı.

**KUSUR 2 — beşinci erişim yolu denenmedi.** Dört yol ölçülüp "hepsi kapalı" dendi, ama
`supabase db query --linked` **denenmemişti**. Bu komut **access token** ile Management API
üzerinden çalışır; **DB parolası veya service_role GEREKTİRMEZ**. Aynı oturum
`projects list` ve `migration list --linked` için de yeterliydi. *"Erişim yok" hükmü,
denenmemiş bir yol varken verilemez.*

**ÖLÇÜM (prod `Carospro`, `supabase db query --linked`, 2026-08-21):**

| Adım | Sonuç |
|---|---|
| Kolon nullability | `speed·fuel·rpm·temp` → dördü de `is_nullable=YES`, `column_default` **NULL** |
| `push_vehicle_event` gövdesi | **OK** — 042 dürüst yazma biçimi canlıda |
| `service_role` INSERT | **OK** (`has_table_privilege`, `role_table_grants` değil) |
| **verdict** | **`UYGULANMIŞ`** |

**(b) YARISI DA KAPANDI — tek cihaz testiyle değil, 4 günlük ÜRETİM TRAFİĞİYLE:**

Telemetri **42 → 63 satır**. `fuel IS NULL` olan **22 satır** var; en eski
**2026-08-16 16:23** (066'nın uygulandığı gün), en yeni **2026-08-20 14:19**;
**22'sinin 22'si `is_online=true`**. 066 **öncesi hiçbir günde NULL satır yok**.

Bu kanıtın kusursuz olmasının sebebi RPC'nin kendi gövdesinde: `ON CONFLICT` dalı prod'dan
okundu → `fuel = COALESCE(EXCLUDED.fuel, t.fuel)`. **UPDATE dalı NULL yazamaz.** Dolayısıyla
`fuel IS NULL` olan satır **yalnızca INSERT dalından** gelebilir — o da `NOT NULL` kısıtı
**yokken**. `23502` alsaydı satır **hiç oluşmazdı**.

066 sonrası 23 satırın **18'i** `telemetry_source=HEAD_UNIT_GPS` **ve** `fuel+rpm+temp`
üçü birden NULL — tam olarak *"dongle takılı değil, yalnız GPS"* senaryosu.

**KABUL ÖLÇÜTÜ TAM KARŞILANDI:** dört kolon `YES` ✓ · dongle'sız araçtan gelen olay
satır oluşturuyor (+21) ✓ → **V-02 🟢**. Kütük **🟢 #676**.

**AÇIK KALAN (V-02'nin dışında, ayrı 🔴 olarak kütükte):**
1. **Sunum ucu** — `is_online=true` *veride* doğru; PWA filo ekranında aracın gerçekten
   **ÇEVRİMİÇİ** rozetiyle göründüğü **gözlemlenmedi**. #575 tam bu sınıftı: katman
   doğruydu, tüketici ona bakmıyordu.
2. **Benimseme** — prod'da **786 aracın 723'ünde** (%92) hâlâ hiç telemetri satırı yok
   (#603'te 555/597 = %93). Kısıt kalktı, yazma yolu kanıtlandı, ama **filo genelinde
   akış başlamadı**. Bu 066'nın kusuru değil, ayrı bir sorudur — iyimserlik yapılmıyor.


---

## ⏸️ V-03 — Enterprise sayfasını gerçeğe hizala (ticari risk)  **[ERTELENDİ 2026-08-21]**

> **ERTELEME GEREKÇESİ (kullanıcı kararı):** ürünün henüz **son kullanıcısı/müşterisi yok**;
> satış sayfasındaki uyumsuzluk bugün **teorik** bir risk. Madde SİLİNMEDİ, sırası değişti —
> ilk müşteri/demo öncesi kapatılması ZORUNLUDUR (yanıltıcı reklam + CLAUDE.md dürüstlük kuralı).

**BULGU:** `website/src/app/(public)/enterprise/page.tsx` müşteriye var olmayan özellikler vaat ediyor.

**KANIT (satır bazında):**

| Vaat | Gerçek |
|---|---|
| `:51` "Otomatik Raporlar — Günlük/haftalık **PDF** rapor gönderimi" | PDF üretimi **YOK**. `reports/page.tsx:128` → *"Tarayıcının yazdır diyaloğunda 'PDF olarak kaydet'"*. Zamanlama **yok** (`jsPDF` → 0 sonuç) |
| `:52` "Araç Geçmişi — **90 günlük** rota ve sürüş geçmişi" | En uzun saklama `interval '30 days'`; telemetri temizliği `7 days` |
| `:54` "**REST API** ile mevcut sistemlere entegrasyon" | 20 Next.js rotası var ama hepsi **iç UI ucu** (cookie oturumu). Müşteri anahtarı / doküman / rate-limit **yok** |
| `:33` "**Vardiya yönetimi**" | `grep -i "shift\|vardiya" website/src` → **0 sonuç** |
| — | **Driver scoring: 0 sonuç** · **Yakıt maliyet analizi: 0 sonuç** |

**YAPILACAK:** Yapılmamış her maddeyi ya sil ya **"Yol haritası"** rozetiyle ayır.
Var olanı doğru anlat: "CSV dışa aktarma + tarayıcı yazdırma".

**KABUL ÖLÇÜTÜ:** Sayfada kalan her vaat için koda giden bir `dosya:satır` referansı
gösterilebilir. Kalan "yol haritası" maddeleri görsel olarak ayrışır.

**RİSK:** 🔴 Ticari/hukuki — satılan ürünle sayfa uyuşmuyor.

---

## 🟨 V-04 — Ölü kodu ya bağla ya sil  **[6/6 BAĞLANDI — kütükte 🔴 saha borcu açık]**

**BULGU:** Üretimde **hiç import edilmeyen** modüller. Her biri "yapıldı" yanılsaması üretiyor.
Doğrulama: `grep -rl "/<modül>'" src` (test ve kendisi hariç) → **0 sonuç**.

| Modül | Satır | Karar |
|---|---|---|
| `platform/obd/predictionEngine.ts` | 164 | → **V-09'da bağlanacak** |
| `platform/obd/kwpDtc.ts` | 64 | → **V-08'de bağlanacak** |
| `platform/obd/serviceFunctions.ts` | 161 | ⬜ karar bekliyor |
| `platform/obd/signalHub.ts` | 122 | ⬜ karar bekliyor |
| `platform/obd/fleetKb.ts` | 141 | ⬜ karar bekliyor |
| `platform/obd/adapterCapability.ts` | 91 | ⬜ karar bekliyor |
| `platform/fleet/driverDnaEngine.ts` | 689 | → **V-11'de beslenecek** |
| `platform/deepScan/deepScanOrchestrator.run()` | 1.103 | → **V-10'da karar** |
| `platform/manufacturerProfileBuilder.ts` | 234 | ⬜ karar bekliyor |
| `platform/nativeCoreService.ts` | 122 | ⬜ karar bekliyor |

**YAPILACAK:** Her modül için TEK karar: **BAĞLA** (üretim yolu + LAB gözlem ekranı) veya
**SİL** (`docs/OLU_KOD_ENVANTERI_*.md`'ye gerekçeyle işle). Ara durum yok.

**KABUL ÖLÇÜTÜ:** Tablo boşalır; tarama sıfır bağlanmamış üretim modülü döner.
Silinen her modül envanterde gerekçesiyle kayıtlıdır.

### 🔵 KOŞUM KAYDI — 2026-08-21

**KULLANICI KARARI: SİLME YOK.** *"Kurtarılabilir ise kesinlikle silme, çalışır hale getir."*
Bu yüzden her modül **BAĞLA** yolundan gidiyor.

**ÖNCE TABLO DÜZELTİLDİ — plan bir modülü YANLIŞ listelemiş:**
`nativeCoreService` **CANLI** (`main.tsx:8` import, `main.tsx:82` çağırıyor). Hem plandaki
`grep -rl "/<modül>'"` deseni hem benim ilk ölçümüm aynı tuzağa düştü: gerçek import
**uzantılı** yazılmış (`nativeCoreService.ts'`) → desen eşleşmedi. *grep, aradığın adı
bilmene bağlıdır.* Gerçek ölü: **10 → 5 modül**, **~2.900 → ~749 satır**.

> ⚠️ Ama o modülde **ayrı bir eksik** bulundu: `initNativeCore()` native'den **gerçek ekran
> pikselini** okuyor, yalnız bir CSS değişkenine yazıyor — cihaz sınıflandırmasına
> (`deviceCapabilities._lowEndScreen`) **beslemiyor**; orası hâlâ `innerWidth × dpr` ile
> **tahmin** yürütüyor. #599'un kökü (CSS px ↔ fiziksel px) için gerçek veri elde ama
> kullanılmıyor. Ayrıca `initFromDeviceProfile` otorite şüphesi taşıyor (`performanceMode`
> kendini *"tek kaynak: deviceCapabilities"* ilan etmiş). **Sıradaki iş.**

| # | Modül | Satır | Durum |
|---|---|---|---|
| 1 | `adapterCapability` | 91 | ✅ **BAĞLANDI** — kütük 🔴 #682 (cihazda ölçülmedi) |
| 2 | `nativeCoreService` eksiği | — | ✅ **KAPATILDI** — kütük 🔴 #683 (#599'un kökü + otorite tekilleştirildi) |
| 3 | `signalHub` | 122 | ✅ **BAĞLANDI** — kütük 🔴 #684 (CAROS LAB · Sinyal Otoritesi; cihazda ölçülmedi) |
| 4 | `fleetKb` | 141 | ✅ **BAĞLANDI** — kütük 🔴 #686 (tarama turunun iki ucuna; cihazda ölçülmedi) |
| 5 | `serviceFunctions` | 161 | ✅ **BAĞLANDI (gözlem)** — kütük 🔴 #687; native yazma bilinçli olarak AÇILMADI |
| 6 | `manufacturerProfileBuilder` | 234 | ✅ **BAĞLANDI** — kütük 🔴 #688 (inceleme yüzeyi; cihazda ölçülmedi) |

### ✅ V-04 KAPANIŞ NOTU (2026-08-21)

Altı modülün **altısı da BAĞLANDI**, hiçbiri silinmedi (kullanıcı kararı: *"kurtarılabilir
ise kesinlikle silme"*). Kütükte 🔴 altı yeni saha borcu açıldı (#682 · #683 · #684 · #686 ·
#687 · #688) — bu yüzden madde 🟢 değil **🟨**: kod bitti, cihaz kanıtı YOK.

**Dürüst kalan uçlar (borç değil, başka maddelerin kapsamı):**
`predictionEngine` → V-09 · `kwpDtc` → V-08 · `driverDnaEngine` → V-11 ·
`deepScanOrchestrator.run()` → V-10. Bunlar V-04'ün ilk tablosunda "karar bekliyor"
DEĞİL, en baştan ilgili maddelere devredilmiş modüllerdi.

**Bu turda öğrenilen desen:** "ölü modül"lerin çoğu yanlış yazılmış değil, **tüketicisi
hiç doğmamış** modüllerdi. Üçünde (`signalHub` · `serviceFunctions` ·
`manufacturerProfileBuilder`) eksik olan şey koddaki bir kusur değil, **gözlem/inceleme
yüzeyiydi** — yani modülün var oluş sebebini karşılayan yer. Bir sonraki denetimde
"bağlanmamış üretim kodu" ölçümü alınırken `grep` deseninin **uzantılı import**
(`'./x.ts'`) yazımını da kapsadığından emin olunmalı (V-04/1'de plan bu tuzağa düşmüştü).

**3. SIRA — `signalHub` (2026-08-21):** modül "tek otoriter sinyal okuma yüzeyi" diye
yazılmış ama **tüketicisi hiç doğmamıştı**. Bağlanma yolu LAB deseninin aynısı:
`signalAuthoritySources` → `signalAuthorityModel` (saf) → `SignalAuthorityScreen` →
katalog + screen-map + 39 kilit. Ekranın asıl işi zarfın **dürüstlük sözleşmesini
cihazda gözlemlenebilir kılmak**: `0` ile "veri yok" ayrımı, damgasız alanda yaş
hesaplanmaması, `unsupported`ın arıza gibi sunulmaması ve **mock kaynağın ASLA CANLI
sayılmaması**. Ham `SignalState` ekranda ayrıca gösterilir — dört değerli
gözlemlenebilirlik sınıfına eşleme bilgi kaybettiği için ham hakikat gizlenmez.

> ✅ **Yan borç KAPANDI (aynı gün):** kütük #667'nin "CAROS LAB ekranı yok" borcu
> kapatıldı — **Arka Plan Gücü** ekranı eklendi (kütük 🔴 #685). Ekran kapının
> KARARINI servislerin GERÇEK hâliyle karşılaştırır: ayrıştıklarında hüküm `DRIFT`
> olur ve çelişki `KISMA AKTİF`i EZER — uygulanmamış kararı "aktif" saymak, bu
> depoda tekrar eden "motor var, besleyen yok" yalanının güç katmanındaki hâli olurdu.

---

# 🔥 P1 — VİZYONUN CAN DAMARI

## 🟨 V-05 — Çevrimdışı rota grafiği  **[ÜRETİLDİ VE PAKETLENDİ 2026-08-22 — kütükte 🔴 saha borcu açık]**

**BULGU (doğrulandı):** A* motoru (486 satır, binary min-heap, testli) yazılıydı ama
verisi HİÇ VAR OLMAMIŞTI — `/maps/routing-graph.bin` 404, worker `_graphFailed = true`
ile kalıcı pes ediyor, her çevrimdışı rota kuş uçuşuna düşüyordu.

**YAPILDI:** `scripts/build-routing-graph.mjs` (OSM `.osm.pbf` → RTG2) +
`scripts/verify-routing-graph.mjs`. Türkiye (Geofabrik 613 MB) işlendi:

| | |
|---|---|
| Taranan / seçilen yol | 9.681.702 / **162.742** |
| Düğüm koordinatı çözümü | 2.121.987 / 2.121.987 (**%100**) |
| Grafik | **238.252 düğüm · 295.346 kenar** |
| Dosya | **7,30 MB** (+ ODbL lisans dosyası) |

**ÜÇ KARAR — HEPSİ ÖLÇÜMLE, TAHMİNLE DEĞİL:**

**① Uydurma ETA düzeltildi.** Format yol sınıfı taşımıyordu, ETA sabit 30 km/h idi;
350 km otoyol rotası **11,7 saat** görünürdü. V2 bayrak baytının bit 1-3'ü boştu →
sınıf oraya yazıldı, süre kenar başına sınıf hızıyla toplanıyor. Eski grafikler
`UNKNOWN` → eski sabit korunur (geriye uyum).

**② A* düşük-uçta rota BULAMIYORDU.** Ölçüm: saf A* (W=1.0) Ankara→İstanbul için
**33.592 düğüm** kapatıyor, `MAX_CLOSED=30.000` yüzünden başarısız.
W=1.10→28.477 · **W=1.20→15.095 (seçildi)** · W=1.50→4.194. W=1.20 aramayı yarıya
indirir, rota **%2,5** uzar.

**③ Mesafe artık kenardan okunuyor.** Üretici ara düğümleri seyreltir (Douglas-Peucker
100 m; kavşaklar ASLA atılmaz), `costM` seyreltmeden ÖNCEKİ poliline üzerinden toplanır.
Worker eskiden düğümler arası haversine ile türetiyordu → kıvrımlı yolu sistematik
KISA gösterirdi.

**KAPSAM DÜRÜSTÇE SINIRLI:** yalnız `motorway · trunk · primary · secondary` (+`_link`).
Şehirlerarası ve ana arter yönlendirmesi VAR; **kapı önüne kadar son kilometre YOK**.
Ürün bunu böyle sunmalıdır — "çevrimdışı navigasyon çalışıyor" demek yanıltıcı olur.

**HOST DOĞRULAMASI (veri, cihaz değil) — düşük-uç bütçesiyle 5/5:**
Konya→Tarsus 310 km/4,0 sa · Ankara→İstanbul 446 km/6,0 sa · İzmir→Aydın 109 km/1,2 sa ·
Adana→Gaziantep 210 km/2,7 sa · Bursa→Balıkesir 145 km/2,2 sa.

**AÇIK BORÇ (bu yüzden 🟢 DEĞİL 🟨):** **cihazda hiç ölçülmedi.** Kütük **🔴 #703** —
kabul ölçütü uçak modunda `OFFLINE_GRAPH` kaynağı, gerçek yol geometrisi, şehirlerarası
rotanın düşük-uçta bulunabilmesi ve ETA'nın 5–7 saat aralığında çıkması.

**SONRAKİ AÇIK SORU (V-06 ile birlikte düşünülmeli):** son kilometre kapsanacaksa
`tertiary`/`residential` eklemek gerekir; bu düğüm sayısını ~10× büyütür ve
`MAX_CLOSED` bütçesini yeniden ölçmeyi zorunlu kılar. Kapsam genişletmeden ÖNCE ölç.

---

## 🟨 V-06 — Çevrimdışı POI veritabanı  **[ÜRETİLDİ 2026-08-22 — kütükte 🔴 saha borcu açık]**

> ⚠️ **PLANIN SAYDIĞI 1 KOPUK ASLINDA 3'TÜ.** Eski metin yalnız *"`poi.db` pakette yok"*
> diyordu; ölçüm iki kopuk daha buldu ve ikisi de tek başına zinciri öldürüyordu.

| # | Kopuk | Durum |
|---|---|---|
| a | `public/maps/poi.db` yok | ✅ üretildi (84.911 POI · 15,70 MB) |
| b | `public/wasm/` dizini **HİÇ YOK** — worker WASM'i oradan ister | ✅ build zincirine kopyalama eklendi |
| c | sql.js yapısında **FTS5 MODÜLÜ YOK** (4 varyantın 4'ünde de) | ✅ şema FTS5'siz kuruldu |

**(c) EN ÖNEMLİSİYDİ:** worker'ın `poi_fts` + `bm25()` tasarımı sevk edilen WASM'de
`no such module: fts5` verir — yani **hiçbir zaman çalışamazdı**. Üç seçenek tartıldı:
① `sql.js-fts5` (MIT ama donmuş çatal) · ② `@sqlite.org/sqlite-wasm` (resmî ama farklı
API → worker baştan yazılırdı) · ③ **FTS5'siz düz tablo — seçildi**: yeni bağımlılık YOK,
zaten sevk edilen güncel MIT sql.js ile çalışır.

**EK KAZANÇ:** eski sorgu `ORDER BY bm25(...)` yani METİN BENZERLİĞİNE göre sıralıyordu —
*"en yakın benzinlik"* için yanlış. Artık sıralama gerçek mesafeye göre (`cos²` ölçekli).

**SESSİZ SIFIR TUZAĞI:** `lat`/`lon` REAL yazılır; metin olsalardı SQLite'ta metin > her
sayı olduğu için `BETWEEN` filtresi sessizce boş dönerdi.

**TÜRKÇE ARAMA:** veritabanını yazan ve sorguyu katlayan kural İKİZDİR ve kilitle
bağlıdır. `toLowerCase()` yetmez — `'İ'.toLowerCase()` görünmez U+0307 bırakır.

**KAPSAM SINIRLI:** yalnız NODE olarak haritalanmış POI'ler; alan olarak çizilmiş yerler
DIŞARIDA. Ürün "her yer bulunur" DEMEMELİ.

**AÇIK BORÇ (🟢 DEĞİL 🟨):** cihazda hiç ölçülmedi — kütük **🔴 #704**.

---

## 🟨 V-07 — Vektör karo bölge paketi  **[BAĞLANDI 2026-08-22 — kütükte 🔴 saha borcu açık]**

**BULGU (doğrulandı):** indirici RASTER `.png` çekip Service Worker'a güveniyordu; ürün
VEKTÖR `.pbf` çiziyor, SW `.pbf` yakalamıyor ve vektör karoların tek deposu
`CacheLRUManager`e hiçbir şey yazılmıyordu. Düğme bayt indiriyor, indirdiğini **hiç
kimse okumuyordu**.

**PLANIN GÖRMEDİĞİ İKİ EK SESSİZ YALAN:**

| # | Yalan | Sonuç |
|---|---|---|
| ① | Sayaç SW'nin ölü `offline-tiles` deposunu sayıyordu | Panel başarılı paketten sonra bile **sonsuza dek 0** |
| ② | "Sil" de o ölü depoyu siliyordu | Kullanıcı silince **gerçek önbellek duruyordu** |
| ③ | Boyut `karo × 14 KB` (raster ortalaması) | Kapladığı yer **olduğundan küçük** görünüyordu |

**YAPILDI — plandaki (b) seçeneği:** `CacheLRUManager.warmUrls()` toplu ısıtma; canlı
karo isteğiyle **AYNI `_putToCache` yolu** (aynı manifest · LRU · 0-bayt koruması).
**İkinci önbellek KURULMADI.** Ölü raster yolu (27 satır) silindi.

**KARO ADRESİ SABİT YAZILAMAZ:** sağlayıcı yola veri sürümü damgası koyar
(`/planet/20260802_080001_pt/...`). `vectorTileTemplate` şablonu **canlı TileJSON'dan**
çözer; çözemezse indirme **hiç başlamaz**.

**KAÇINILMAZ SONUÇ, GİZLENMEDİ:** sağlayıcı veriyi tazeleyince indirilmiş paket **ölür**.
`packVersion` panelde kullanıcıya söylenir.

**AÇIK BORÇ (🟢 DEĞİL 🟨):** cihazda hiç ölçülmedi — kütük **🔴 #700**. Kabul ölçütü
V-07'nin kendi testidir: "Ankara indir → WiFi kapat → hiç açılmamış mahalleye pan →
sokaklar çizilir" + `adb screencap`.

**AÇIK SORU:** Service Worker hâlâ `.png` yakalıyor ama artık kimse `.png` istemiyor —
ölü kural. Zararsız, ama V-18 (doküman/kod temizliği) kapsamında ele alınmalı.

---

## 🟨 V-08 — KWP hattı  **[ÜÇ KATMAN BAĞLANDI 2026-08-22 — kütükte 🔴 saha borcu açık]**

**BULGU (doğrulandı ve DERİNLEŞTİ):** plan "`kwpDtc.ts` bağlanmamış" diyordu; ölçüm
zincirin **üç katmanda birden** kopuk olduğunu gösterdi:

| # | Katman | Durum |
|---|---|---|
| ① | `ElmProtocol.readKwpDtcsRaw()` | Yazılmış, **Java'da bile çağıranı yok** |
| ② | Capacitor köprüsü | **Hiç yok** |
| ③ | `kwpDtc.ts` ayrıştırıcı | Tüketicisi yok |

Sonuç: KWP araçlarda (Renault sınıfı) yalnız emisyon kodları görünüyor, üretici arızası
"yok" sanılıyor ve panel bunu **sessizce "temiz"** diye sunuyordu.

**YAPILDI:** üçü de bağlandı (`readUdsDtcs` deseniyle birebir: USER önceliği + atomik
header set/restore) ve TS tarafında `readKwpForEcu()` eklendi.

**AYRI ÇÖZÜCÜ ŞART:** KWP DTC **2 bayttır** (UDS'te 3) — aynı çözücü kayıt boyunu yanlış
sayar ve **tüm liste kayar**. Kodlar `fromKwp` ile etiketlenir; `fromUds` ile
birleştirilmez.

**PROTOKOL KAPISI:** yalnız yavaş seri hatta denenir; protokol tarama başında **bir kez**
okunur (tur ortasında değişirse rapor kendi içinde çelişirdi). Okunamazsa denenmez ve
`kwp: null` kalır — **`null` (sorulmadı) ≠ `unsupported` (soruldu, yok)**.

**ASIL KAZANIM — HÜKÜM FAIL-CLOSED:** `computeDtcVerdict`e `manufacturerScope` eklendi.
Üretici kod tabanına bakılmadıysa veya sorgu düştüyse, standart modlar temiz olsa bile
hüküm **`inconclusive`**tir. Alan **additive**: bildirmeyen çağıranın davranışı birebir
aynı kalır.

**AÇIK BORÇ (🟢 DEĞİL 🟨):** gerçek araçta ölçülmedi — kütük **🔴 #705**. Kabul ölçütünün
çekirdeği: Trafic'te `1800FF00` isteği logcat'te görülmeli; ECU desteklemiyorsa panel
**"kapsam dışı"** demeli, sessiz "temiz" DEMEMELİ. CAN aracında o istek **hiç
görülmemeli**.

---

# 🧠 P2 — ZEKÂ KATMANININ GERÇEKLEŞMESİ

## 🟨 V-09 — Prediction Engine  **[BAĞLANDI 2026-08-22 — kütükte 🔴 saha borcu açık]**

**BULGU (doğrulandı):** 164 satırlık motor yazılı, **tek tüketicisi kendi testi** —
üretimde 0 çağrı. Anayasanın 6. kapısı fiilen kapalıydı.

**YAPILDI:** `predictionRuntime` — motorun eksik KOŞUCUSU. Motora dokunulmadı; eşikler
yeniden tanımlanmadı (ikinci otorite yok). LAB ekranı açıldı (V-09 bunu **zorunlu**
kılıyordu).

**BÜTÇE — İKİ KURAL AYNI ANDA:** koşucu **soğuk yolda** çalışır (15 sn; 3 Hz hot-path'e
hiç dokunmaz) **ama** görev `SAFETY` kritikliğindedir — düşük-uçta **yavaşlatılmaz**.
Aşırı ısınma uyarısını "cihaz zayıf" diye geciktirmek, korumak için var olduğu şeyi
kaybetmektir.

**ÖRNEKLEM DÜRÜSTLÜĞÜ:** bayat veri örneklenmez (duran sayı sahte "trend yok" üretip
gerçek yükselişi maskeler) · sensör yoksa örnek alınmaz (sahte 0 ölçüm değildir) ·
araç değişince tampon sıfırlanır. Atlanan her örnek sayılır.

**ÖLÇÜLEN GERÇEK — BİR KURAL ÇALIŞAMAZ:** `oil_pressure_drop`'un sinyal kaynağı üründe
**yok** (`OBDData` böyle bir alan taşımıyor; araca özel DID gerekir). LAB üç durumu AYRI
gösterir: **TAHMİN VAR · KANIT YETERSİZ · SİNYAL KAYNAĞI YOK** — sessizce boş bırakmak
"kural çalışıyor ama arıza yok" izlenimi verirdi.

**AÇIK BORÇ (🟢 DEĞİL 🟨):** gerçek araçta ölçülmedi — kütük **🔴 #706**. Çekirdek
ölçüt: sıcaklık 5 örnekte yükselirken `overheat` tahmini `fitQuality ≥ 0,6` ile
görünmeli; kanıt yetersizken **KANIT YETERSİZ** yazmalı (sahte tahmin YOK).

---

## 🟢 V-10 — Deep Scan otorite sınırı  **[KAPANDI 2026-08-22 — kütük 🟢 #707]**

> ⚠️ **ŞÜPHE HAKLIYDI AMA TEŞHİS EKSİKTİ.** Plan "iki otorite var, birini seç" diyordu.
> Ölçüm üçüncü ve doğru seçeneği gösterdi.

**ÖLÇÜM (2026-08-22):** üretimde `deepScanOrchestrator`a enjekte edilen **tek** handler
`change_detection`tir (`platformCoreDeepScanWiring:374`); **hiçbir aktif faz handler'ı
YOKTUR** — identity/protocol/ECU/PID/DID/firmware hepsi `handler_unavailable` döner.

**İKİ MOTOR AYNI İŞİ YAPMIYOR — İŞ BÖLÜŞÜLMÜŞ:**

| Alan | Sahibi | Not |
|---|---|---|
| **Aktif tarama** (araca sorgu) | `discoveryLive` | Sahada çalışıyor; Mavi eylemleri + LAB paneli aynı tekil örneği kullanıyor |
| **Çevrimdışı değişim tespiti** | `deepScanOrchestrator` | Kapsam kütüğü + tamamlanma hükmü; `discoveryLive` bunu YAPMAZ |

**RİSK GERÇEK AMA GİZİLDİ:** orchestrator'a bir gün aktif faz handler'ı bağlanırsa iki
motor araca ayrı ayrı sorgu göndermeye başlar. Alarmı yaratan da orchestrator'ın kendini
*"Deep Scan'in TÜM katmanlarını yöneten TEK koordinatör"* ilan eden başlığıydı.

**YAPILDI — SİLME DEĞİL, SINIR ÇİZME:**
1. `deepScanAuthority.ts` — hangi işi kimin sahiplendiğinin **tek beyanı** (saf).
2. Orchestrator başlığı gerçeğe hizalandı; **OTORİTE SINIRI** açıkça yazıldı.
3. **KİLİT:** üretimdeki `handlers: { … }` blokları taranır; beyan edilmemiş bir faz
   bağlanmışsa test **düşer**. İkinci otorite kazara değil, ancak beyan bilinçli
   güncellenerek doğabilir. İzin listesinin aktif faz içermediği ayrıca kilitli.
4. CAROS LAB · Derin Tarama ekranına **OTORİTE BÖLÜMÜ** eklendi — ayrım sahada görünür.

**ORCHESTRATOR EMEKLİ EDİLMEDİ (bilinçli):** 1.103 satırı silmek, gerçekten çalışan
çevrimdışı yarıyı kaybetmek olurdu.

**NEDEN 🟢 (saha borcu YOK):** bu bir mimari sınır ve kaynak-kodu kilididir; çalışma
zamanı davranışı **değişmedi** (hiçbir handler eklenmedi/çıkarılmadı). Kabul ölçütünün
iki yarısı da host'ta karşılandı: tek üretim otoritesi kaldı **ve** belge gerçeği anlatıyor.

---

## 🟨 V-11 — Driver DNA: **ZİNCİR KANITLANDI (2026-08-22) — kalan iş SAHİBİNDE (veri)**

> ⚠️ **BU MADDENİN ESKİ HÂLİ YANLIŞTI.** Eski metin *"689 satır motor hazır, veri hiç
> akmıyor → `tripLogService` → `accumulateTrip()` köprüsü kur"* diyordu. Prod ölçümü
> bunu ÇÜRÜTTÜ. Eski öneri uygulansaydı **İKİNCİ OTORİTE** doğardı: aynı DNA hem
> cihazda hem sunucuda hesaplanır, ikisi kaçınılmaz olarak ayrışırdı.

**ÖLÇÜLEN GERÇEK (prod `Carospro`, `supabase db query --linked`, 2026-08-21):**

| Sorgu | Sonuç |
|---|---|
| `vehicle_trips` satırı | **31** (18–21 Ağustos) |
| `distance_km` dolu | **31/31** |
| `driver_id` dolu | **0** |
| `driver_attribution_status` | **31/31 `UNKNOWN`** |
| `vehicle_driver_assignments` satırı | **0** |
| `driver_dna` satırı | **0** |

**BESLEME KÖPRÜSÜ ZATEN VAR VE ÇALIŞIYOR — SUNUCUDA.** Zincir şudur:

```
head unit  →  upload_vehicle_trip        (distance_km · harsh_brake_count · harsh_accel_count)
           →  vehicle_trips satırı
           →  _trip_attribution_trigger  (sürücüyü belirler)
           →  trg_driver_dna → _dna_apply_trip   (DNA birikir)
```

`upload_vehicle_trip` (migration 047, satır 274/323) tetikleyicinin İZLEDİĞİ kolonları
zaten yazıyor ve `startTripUpload()` SystemBoot'ta bağlı. Yani "veri hiç akmıyor"
iddiası yanlıştı: **veri akıyor, 31 satır var.**

**ZİNCİR İLK HALKADA KOPUYOR — SÜRÜCÜ HİÇ ATANMAMIŞ.** `vehicle_driver_assignments`
boş olduğu için: `get_active_driver_assignment` "atama yok" döner → her yolculuk
`UNKNOWN` olarak damgalanır → DNA tetikleyicisinin bağlayacağı sürücü yoktur → 0 DNA.

**BU BİR KOD KUSURU DEĞİL, EKSİK VERİ:** üretimde hiç filo sürücüsü oluşturulmamış
(`create_fleet_driver`) ve hiçbir araca atanmamış (`create_vehicle_driver_assignment`).
İkisi de **yönetici paneli** eylemidir; head unit bunları BİLİNÇLİ olarak yapamaz
(güvenli kimlik doğrulama yok → "kim olduğunu iddia eden herkes o kişi sayılır").

**HEAD UNIT YARISI BU TURDA BAĞLANDI:** `fleetReadbackService` (kütük #691) trip
başlangıcında `get_active_driver_assignment` çağırıyor. Atama oluşturulana kadar
dürüstçe `NO_ASSIGNMENT` raporlayacaktır — bu doğru davranıştır.

**OKUMA UCU AYRI BİR SORU (yetki):** `get_driver_dna` GRANT'i **`authenticated`**tır;
head unit'in kullanıcı oturumu yoktur. `anon`'a açmak bir sürücünün sürüş karakterini
araçtaki herkese verirdi — **açılmadı** (bkz. `fleetScopeModel`, kütük #691).

**YAPILACAK (yeni sıra):**
1. Yönetici panelinden **bir sürücü oluştur + araca ata** (`create_fleet_driver` →
   `create_vehicle_driver_assignment`). Kod işi DEĞİL, veri işi.
2. Bir yolculuk yap; `vehicle_trips.driver_id` doluyor mu ÖLÇ.
3. `driver_dna` satırı oluştu mu ÖLÇ (`trip_count` > 0).
4. **Ancak bundan sonra** "head unit DNA'yı görmeli mi" kararını ver — görmeliyse
   cihaz-yetkili bir okuma RPC'si + RLS incelemesi gerekir; görmeyecekse LAB ekranı
   zaten kapsamı dürüstçe beyan ediyor.

**KABUL ÖLÇÜTÜ (güncellendi):** Adım 1'den sonra 3 gerçek yolculukta
`driver_attribution_status` artık `UNKNOWN` DEĞİL; `driver_dna.trip_count = 3` ve
güven > 0. LAB · Driver DNA ekranı ancak okuma ucu kararı verilirse dolar.

**YAPILMAYACAK:** `accumulateTrip()` / `buildDna()` head unit'te ÇAĞRILMAYACAK —
sunucu zaten hesaplıyor; ikinci hesap ikinci otoritedir.

### ✅ ZİNCİR ARTIK VARSAYIM DEĞİL — ÖLÇÜLDÜ (2026-08-22, kütük #712)

Yukarıdaki *"besleme köprüsü zaten var ve çalışıyor"* cümlesi bir **VARSAYIMDI**: üretimde
statü bir kez bile `UNKNOWN` dışında olmadı, `driver_dna`ya bir kez bile satır düşmedi.
`supabase/tests/064_driver_dna_chain_matrix.sql` bunu sınadı — **6 halka, 6'sı da geçti**
(`npm run test:dna`):

| Halka | Sınanan | Sonuç |
|---|---|---|
| 0 | Atama yokken dürüst cevap | `NO_ACTIVE_ASSIGNMENT` |
| 1 | Sürücü oluştur + araca ata | ✅ |
| 2 | Cihaz atamayı görüyor mu | ✅ |
| 3 | Atıf tetikleyicisi bağlıyor mu | **`ATTRIBUTED`** (UNKNOWN DEĞİL) |
| 4 | DNA birikiyor mu | `trip_count = 3` |
| 5 | Tekrar yükleme şişiriyor mu | **hayır** |

**Teşhis DOĞRULANDI:** kalan iş gerçekten yalnız veri — ama artık ölçüme dayanıyor.

**ÜÇ SESSİZ SÖZLEŞME KUSURU çıktı** (fonksiyon hata FIRLATMAZ; dönüş okunmazsa "başarılı"
sanılır): `driverId` (camelCase) · atama tipi **BÜYÜK HARF** (`PRIMARY`) · metrik
**`distanceKm`** (`distance_km` → `REJECTED/NO_DISTANCE`, yolculuk tabloya HİÇ düşmez).

**Kendi kilidim kendi testimin yalancı geçtiğini yakaladı:** Halka 5 önce snake_case
gönderiyordu → yükleme reddediliyor → sayaç *idempotans sayesinde değil, yükleme hiç
olmadığı için* 3 kalıyordu.

**Üretime dokunulmadı:** matris yerelde koşar ve `ROLLBACK` ile biter. Üretimde sahte
sürücü oluşturmak filo verisini kirletirdi — o adım **sahibinin kararıdır**.

---

## 🟨 V-12 — Digital Twin provenance  **[BAĞLANDI 2026-08-22 — kütükte 🔴 saha borcu açık]**

**BULGU (doğrulandı):** `UnifiedVehicleState` çıplak skalerler taşıyor; **`gpsSource`
dışında hiçbir sinyalde** "bu değer nereden geldi, ne zaman ölçüldü" bilgisi yoktu.
`speed` "fused" diye yazılı ama kaynağı okunamıyordu.

**MİMARİ KARAR — YAN KANAL:** her alanı `{value, source, at}` yapmak mağazayı okuyan
onlarca bileşeni kırardı (anayasa: çok-sistemli refactor yasak). Provenance **paralel bir
defterdir**: değer alanları değişmedi, umursamayan okuyucu hiç etkilenmedi.

**HOT-PATH GÜVENLİĞİ:** defter başlangıçta dolu (sonradan anahtar eklenmez → hidden-class
geçişi yok) · yazma yolunda **tahsis yok** (kayıt yerinde değişir) · damga **yama başına
bir kez** (`stampProvenance(..., Date.now())` deseni kilitle yasaklandı).

**SAHTE YAŞ YASAĞI:** hiç yazılmamışta yaş **hesaplanmaz** — `nowMs - 0` yapılsaydı
**56 yıllık** sahte yaş çıkar ve "çok bayat" diye okunurdu.

**ÜÇ DURUM AYRI:** AKIYOR · BAYAT · **HİÇ YAZILMADI**. Sonuncusunu "bayat" saymak, hiç
gelmemiş sinyali "gelmiş ama eskimiş" göstermek olurdu.

**KAYNAK DÜRÜSTLÜĞÜ:** `speed` = **fused** (tek üreticiye indirgemek yalan olurdu,
kilitli) · `odometer` = **derived** (ölçüm değil) · CAN/GPS kendi kaynakları · bildirilmemişse
**unknown** (uydurulmaz).

**LAB:** CAROS LAB · Araç · **Sinyal Kaynak İzi** açıldı.

**AÇIK BORÇ (🟢 DEĞİL 🟨):** gerçek araçta ölçülmedi — kütük **🔴 #708**. Çekirdek ölçüt:
`speed` **fused** görünmeli; CAN'siz araçta `canRpm` **HİÇ YAZILMADI** demeli (bayat DEĞİL).

---

# 🔬 P3 — DOĞRULAMA BORCUNUN KAPATILMASI

## ⬜ V-13 — Saha doğrulama sprint'i (639 madde)

**BULGU:** Doğrulama hızı üretim hızının çok gerisinde. **639 madde gerçek araçta hiç
denenmedi**; her turda büyüyor. Cihaz doğrulama oranı **%2,85**.

**YAPILACAK:** 639 maddeyi risk sırasına diz (güvenlik-kritik → veri bütünlüğü → UX).
Haftada 1 sürüş × ~20 madde. **Doğrulama hızı üretim hızını yakalamadan yeni özellik açılmaz.**

**KABUL ÖLÇÜTÜ:** 🟢 sayısı 19 → **100+**; 🔴 sayısı azalan trend gösterir (iki ardışık turda).

---

## ⬜ V-14 — APK'ya karşı E2E

**BULGU:** E2E yalnız **tarayıcı demo modunu** test ediyor — native köprünün olmadığı
bir dünyayı doğruluyor.

**KANIT:** `playwright.config.ts:37` → `command: 'npm run dev'` · `baseURL: http://localhost:5173`.
8 spec / 572 satır. APK'ya karşı E2E **yok**.

**YAPILACAK:** ADB + CDP-over-adb üzerinden en az 5 kritik akış: boot · OBD bağlantı ·
navigasyon başlat · sesli komut · uzak komut.

**KABUL ÖLÇÜTÜ:** Tek komutla koşan, gerçek APK'da 5/5 geçen bir paket.
Görsel doğrulama **YALNIZ `adb screencap`** (CDP ekran görüntüsü WebGL'i yakalamaz).

---

## 🟢 V-15 — RLS maruziyet matrisi  **[TAMAM 2026-08-22 — ÜRETİMDE ÖLÇÜLDÜ]**

**BULGU:** 038 döneminde `member` kendini admin yapabiliyordu; kapatıldı ama bu SINIFIN
sistematik kapısı yoktu. Ayrıca ölçüm: **prod'da 17 tabloda `anon` GRANT'i var** (yerelde 12) —
`vehicles · vehicle_locations · vehicle_telemetry · vehicle_commands · vehicle_events ·
vehicle_pairings` dahil. Tek savunma RLS policy'si.

**"SAHTE 0" TUZAĞI:** `anon` 0 satır görmesi koruma KANITI DEĞİLDİR — tablo boş da olabilir.
Ölçümde yerelde 47 tablonun **20 tanesi boştu**; naif bir matris "47/47 GEÇTİ" derdi. Boş tablo
**UNPROVEN** sayılır, GEÇTİ SAYILMAZ.

**DÖRT KAPI:** ① anon izinsiz OKUYAMAZ · ② anon doğrudan YAZAMAZ · ③ her tabloda RLS AÇIK ·
④ **kimliksiz `authenticated` görürse policy sabite bağlıdır** (038 sınıfı).

**KAPI 4 İLK KOŞUŞTA GERÇEK BULGU YAKALADI:** `ai_evidence_adapter_state` = `USING (true)`.
İncelendi, **meşru** (şirket-bağımsız sayaç, PII yok, anon REVOKE) → gerekçesiyle imzalandı.

**İZİN LİSTESİ KİLİTLİ:** matrisin zayıf noktası listedir; vitest kilidi listeyi imzalı kümeyle
birebir karşılaştırır ve kiracıya-özgü 27 tablonun girmesini yasaklar (Docker'sız CI'da koşar).

**MUTASYONLA KANITLANDI:** `vehicles`→`USING(true)` KAPI 1 · `vehicle_telemetry` anon INSERT
KAPI 2 · `vehicle_trips` RLS off KAPI 3 · listeye `vehicles` eklemek vitest kilidini düşürdü.

**ÜRETİM ÖLÇÜMÜ:** gerçek `anon` rolüyle koşuldu → **izinsiz maruziyet = 0**; satırı olan
**8 kritik tablo kanıtlanmış şekilde kapalı**. 9 tablo boş olduğu için kanıtlanamadı.

**AÇIK BORÇ:** o 9 tabloya gerçek satır girdiğinde `npm run test:rls:prod` tekrar koşulmalı
(kütük **#709**).

---

# 🏢 P4 — ENTERPRISE

## 🟨 V-16 — Enterprise özelliklerini gerçekten yap  **[2/7 KAPANDI 2026-08-22]**

V-03 sayfayı gerçeğe hizalar; bu madde **özelliği inşa eder**.

- [x] **PDF rapor üretimi** — ✅ **YAPILDI (kütük #714)**. `pdf-lib` KULLANILMADI: base-14 fontlar
      WinAnsi ile sınırlı ve Türkçe `ğ Ğ ı İ ş Ş` orada YOK (`pdf-lib` bu harflerde HATA FIRLATIR).
      Seçenekler ~300 KB TTF gömmek ya da `/Differences` ile glifleri adlarıyla eşlemekti →
      **sıfır bağımlılık** seçildi (lisans yüzeyi büyümedi, çıktı 3,6 KB).
- [ ] **Zamanlanmış rapor gönderimi** (günlük/haftalık)
- [x] **90 günlük geçmiş** + saklama politikası — ✅ **YAPILDI (kütük #715)**. Ölçüm:
      `vehicle_trips` için politika **HİÇ YOKTU** (sonsuz büyüme); `vehicle_locations` 7 gündü.
      Artık `retention_policy` tablosu tek otorite: trips **90** · locations **30** · events **90**.
      **90 günlük HAM ROTA sunulmuyor** — ölçülen maliyet 100 araçta ~2,4 GB (ürün kararı).
- [ ] **Driver scoring** (Driver DNA metrikleri üzerine — V-11'e bağımlı)
- [ ] **Yakıt maliyet analizi**
- [ ] **Vardiya yönetimi** modeli
- [ ] **Dış müşteri REST API'si** — anahtar + doküman + rate-limit

**KABUL ÖLÇÜTÜ:** Her alt madde için `enterprise/page.tsx`'teki vaat, koda giden
bir `dosya:satır` referansıyla desteklenir.

---

### ✅ V-16/1 — PDF rapor üretimi **[KAPANDI 2026-08-22 · kütük #714]**

**Vaat vardı, üretici YOKTU:** düğmenin ipucu bile *"Tarayıcının yazdır diyaloğunda 'PDF olarak
kaydet'"* diyordu — iş kullanıcıya devrediliyordu.

**Kod referansı (kabul ölçütü gereği):** `website/src/lib/reports/pdfWriter.ts` ·
`website/src/lib/reports/fleetReportPdf.ts` ·
`website/src/components/console/DownloadPdfButton.tsx` ·
`website/src/app/dashboard/fleet/reports/page.tsx`

**GÖRSEL DOĞRULAMA, YAPISAL TESTLERİN GÖREMEDİĞİNİ YAKALADI (bu turun dersi):** 21 yapısal kilit
YEŞİLKEN sayfa görsel olarak BOZUKTU. PDF `pypdfium2` (Chrome'un PDF motoru) ile PNG'ye çevrilip
**gözle** bakılınca iki kusur çıktı: başlıklar sola/değerler sağa yaslıydı → sayılar bir sonraki
sütunun altına düşüyordu; ve sağa yaslı sayı komşu sütuna değiyordu (`11,4` + `2 dk önce` =
**`11,42 dk once`**). Kök neden: "0,5 em ortalama" tahmini rakamları (0,556 em) dar sayıyordu.

**Bağımsız kanıt:** `pypdf` metni kayıpsız çıkardı (`Oluşturma` · `yoğunluğu` · `—` birebir doğru),
`pdftotext` belgeyi açtı, `pypdfium2` sayfayı doğru çizdi.

**Açık borç:** vaat *"günlük/haftalık **gönderim**"*di; bu tur yalnız **üretimi** kapattı.
Teslimat (pg_cron + e-posta) **V-16/2** olarak açık.

---

### ✅ V-16/3 — 90 günlük geçmiş + saklama politikası **[KAPANDI 2026-08-22 · kütük #715]**

**Vaat 90 gündü; `vehicle_trips` için politika HİÇ YOKTU** — tablo sonsuz büyüyordu.
`vehicle_locations` ise 7 gün sonra siliniyordu. Süreler ayrıca fonksiyon gövdesine gömülüydü.

**Olumlu bulgu:** `cleanup_old_telemetry()` pg_cron ile **gerçekten zamanlanmış ve aktif**
(her gün 03:00) — bu sefer motorun besleyeni vardı.

**Ölçülen maliyet (varsayılmadı):** prod'da araç başına ~0,27 MB/gün →
ham konum 30 gün ≈ 8 MB/araç · 90 gün ≈ 24 MB/araç (**100 araçta 2,4 GB**).
`vehicle_trips` yolculuk başına ~4 kB → 90 gün ihmal edilebilir.

**Karar — kademeli saklama:** trips **90** · locations **7→30** · events **90** · komut/log 14.
**Açıkça söylendi:** 90 günlük *ham rota noktası* sunulmuyor; 90 gün geriye giden **yolculuk özetleri**.

**Silme güvenli mi — ÖNCE ölçüldü:** `vehicle_trips`'in dört tetikleyicisi de
`AFTER INSERT OR UPDATE`; hiçbiri DELETE'te tetiklenmiyor → **Driver DNA geri alınmaz**.
Bu doğrulanmadan saklama eklenseydi DNA sessizce erirdi.

**İki migration zinciri ayrışması ortaya çıktı:** `telemetry_events` · `command_logs` prod'da VAR
yerelde YOK; `vehicle_commands.updated_at` yerelde YOK. Tek bir `DELETE` fonksiyonun tamamını
düşürür. Çözüm: eksik **tablo** ve eksik **kolon** ayrı tespit edilip `skipped_missing` /
`skipped_schema_mismatch` olarak **raporlanır** — sessizce atlamak bir tablonun yıllarca
büyümesine yol açardı.

**Matris sınırın İKİ TARAFINI ölçer:** naif test yalnız "eski silindi mi" bakar; asıl tehlike
**yeni verinin silinmesidir**. Ayrıca politika 7 güne çekilip aynı satırın gittiği doğrulanır
("tablo TİYATRO mu" kilidi).

**Üretim kanıtı:** migration prod'a uygulandı, temizlik çalıştırıldı → politika yürürlükte,
**silinen yolculuk/konum/olay = 0**, yalnız 6 süresi dolmuş bağlama kodu; `skipped_*` prod'da BOŞ.

**Açık borç:** 90 günlük **ham rota** için ya maliyet kabul edilecek ya **seyrekleştirme** katmanı
yazılacak — ürün kararı.

---

# 🏛️ P5 — MİMARİ KARAR GEREKTİRENLER

## 🟨 V-17 — Çalışma zamanı mod tavanı: KARAR + ADR  **[KARAR VERİLDİ 2026-08-22 — ADR 0005]**

**PLANIN NEDENSELLİĞİ ÖLÇÜMLE ÇÜRÜTÜLDÜ.** Bu maddenin ilk hâli *"COEP kapalı → SAB yok →
BASIC_JS"* diyordu. Ölçüm: `_detectCapabilities()` **dört sıralı kapıdır** ve plan yalnız son
ikisini saymıştı: ① `deviceTier` ② `weakGpu` ③ `worker` ④ `sab`. Üretim **ilk engelleyende
durur**; referans donanımda (K24 · Mali-400) **2. kapı tetikliyor, 4. kapıya sıra gelmiyor**.

> **COEP açılsaydı bile mod DEĞİŞMEZDİ.** Planın önerdiği pahalı çözüm hedef donanımda hiçbir
> şey açmayacak, üstelik YouTube iframe'ini kırma bedelini ödeyecekti.

**KARAR (`docs/adr/0005-sab-crossoriginisolation-runtime-ceiling.md`):** tavan kabul edilir ·
**COEP AÇILMAZ** (koşullu: güçlü head unit ölçülünce yeniden açılır) · **SAB yolları SİLİNMEZ**
(16 dosya = çok-sistemli refactor, ölçülmüş fayda yok, yollar ölü değil UYKUDA) · SAB/Seqlock
disiplini kapsamda kalır.

**TEK OTORİTE:** kapılar `MODE_GATES` tablosunda; `_detectCapabilities()` artık koşul içermez.
Üretim kısa devre, LAB tümünü değerlendirir — *"tek suçlu"* yanılsaması modelde ve testte kilitli:
`softwareFixWouldUnlock()` ancak **donanım engeli kalmadıysa** true.

**LAB:** CAROS LAB · Çalışma Zamanı · **Mod Kapıları** (ham gözlem · kararı veren kapı ·
yürürlük↔tespit farkı · son değişimin nedeni).

**AÇIK BORÇ (🟨):** gerçek head unit'te ölçülmedi — kütük **🔴 #710**. Çekirdek ölçüt: hüküm
**KARMA ENGEL/DONANIM SINIRI** çıkmalı; **YAZILIM SINIRI çıkarsa ADR 0005 yeniden açılır**.

---

## 🟢 V-18 — Eskimiş dokümanlar  **[TAMAM 2026-08-22 — kalıcı kapı kuruldu]**

**TARAMA YÖNTEMİ ÖNCE KENDİ KUSURUNU GÖSTERDİ:** ilk tarayıcı yalnız `backtick` referansları
arıyordu ve **asıl kanıtı kaçırdı** — `OFFLINE_MAP_GUIDE` dosyaları `**kalın**` yazmıştı.
Düzeltilmiş yöntemle: **123 belge tarandı · 13 sorunlu · 33 kırık referans.**

**AYRIM:** tarihsel kayıt kusur DEĞİLDİR. `ARCHITECTURE_DATAFLOW` · `PROJECT_STATE` ·
`CAROS_PRO_VIZYONU` silinmiş dosyaları *"SİLİNDİ/SÖKÜLDÜ/ÖLÜ"* bağlamında anıyor; bunları
"düzeltmek" tarihi yeniden yazmak olurdu. ROADMAP/BACKLOG ise **gelecek** dosyaları anar.

**DÜZELTİLENLER:** ① `OFFLINE_MAP_GUIDE.md` **baştan yazıldı** (gerçek dört katman ölçüldü;
her fonksiyon adı repodan doğrulandı; #614 ve V-07 tuzakları eklendi) · ② `TECHNICAL_SPEC_STYLE_ENGINE`
*"Ready for Implementation"* diyordu ama o tasarım **uygulanıp geri alınmıştı** (1416 satır söküldü) ·
③ `TECHNICAL_SPEC_REMOTE_COMMAND` *"Draft"* diyordu ama özellik **başka yolda uygulanmıştı**
(`src/platform/remoteCommandService.ts`) · ④ `COMPANION_AI_ARCHITECTURE`'a tarih notu.

**BELGELER SİLİNMEDİ:** kusur belgenin varlığı değil, *"bugünün mimarisi"* sanılmasıdır →
başa **durum bandı** (kilit, bandın ilk 2000 karakterde olmasını şart koşar).

**KALICI KAPI:** `docsReferenceIntegrity.test.ts`. Muafiyet listesi **kalkan olamaz** — ayrı
bir kilit muafiyetteki adların gerçekten var olmadığını sınar. **Mutasyonla kanıtlandı.**

**AÇIK BORÇ:** kapı şu an yalnız `OFFLINE_MAP_GUIDE.md`'yi izliyor; yeni mimari rehber
`GUIDES` listesine eklenmelidir (kütük **#711**).

---

# 🧾 EK — "BİZİM SANDIĞIMIZ AMA ASLINDA OLMAYANLAR"

Denetimin en değerli çıktısı. Her satır bir iş maddesine bağlı.

| # | Sandığımız | Gerçek | Madde |
|---|---|---|---|
| 1 | "Çevrimdışı navigasyonumuz var" | **Yok** — graf dosyası hiç var olmamış; ağsız kalınca kuş uçuşu | V-05 |
| 2 | "Çevrimdışı POI aramamız var" | **Yok** — `poi.db` pakette yok | V-06 |
| 3 | "Harita bölgesi indirebiliyoruz" | İndiriyor ama **raster**; ürün **vektör** çiziyor | V-07 |
| 4 | "Prediction Engine (6. kapı) yapıldı" | **Hiç bağlanmadı** — tek tüketicisi kendi testi | V-09 |
| 5 | "Deep Scan çalışıyor" | Aktif tarama üretimde **hiç koşmuyor**; sahadaki başka motor | V-10 |
| 6 | "Driver DNA var" | Motor + tablo + ekran var, **veri hiç akmıyor** | V-11 |
| 7 | "Adaptive runtime cihazda tam güçte" | Cihazda **hep BASIC_JS**; SAB yolları hiç koşmuyor | V-17 |
| 8 | "Java testlerimiz var, güvendeyiz" | **DÜZELDİ (2026-08-21):** CI kapısı kuruldu ve gerçek runner'da uçtan uca kanıtlandı — yeşil · mutasyonda kırmızı · düzeltmede yeşil (kütük 🟢 #677). Kalan: kapı henüz main/dev üzerinde koşmadı | ~~V-01~~ ✅ |
| 9 | "Enterprise özelliklerimiz var" | PDF ❌ · 90 gün ❌ · vardiya ❌ · scoring ❌ · yakıt ❌ | V-03 / V-16 |
| 10 | "OFFLINE_MAP_GUIDE mimarimizi anlatıyor" | Anlattığı **iki dosya mevcut değil** | V-18 |
| 11 | "KWP araçlarda DTC okuyabiliyoruz" | `kwpDtc.ts` **hiçbir yerden çağrılmıyor** | V-08 |
| 12 | "Filo telemetrisi buluta akıyor" | **DÜZELDİ (2026-08-21):** 066 prod'da `UYGULANMIŞ`; dongle'sız yazma 4 günlük üretim trafiğiyle kanıtlandı (kütük 🟢 #676). Kalan: PWA sunum rozeti + filonun %92'sinde akış hiç başlamamış | ~~V-02~~ ✅ |

---

# ✅ DENETİMDE DOĞRULANANLAR (bu maddeler İŞ DEĞİL — korunacak kazanımlar)

Regresyon olursa buraya bakılır.

1. **OBD-II çekirdeği (CAN)** — 3.280 satır + native ELM327; Doblo'da 92 s kesintisiz akış (kütük #70 🟢)
2. **Öğrenilmiş protokol kalıcılığı** — timeout'ta silinmiyor (#67 🟢)
3. **Vektör harita render + çevrimdışı önbellek** — WiFi kapalı, sokak ağı + adlar çizildi (#614 🟢)
4. **Navigasyon oturum sahipliği** — tam ekran kapalıyken ilerleme sürüyor (#377/#379 🟢)
5. **AI sağlayıcı fallback zinciri** — CDP canlı izi: 402 → Gemini, kota dolu modeli atladı (#97/#98/#99a 🟢)
6. **Vosk Türkçe offline STT** — 57 MB model APK'da, hibrit yönlendirme, native köprü
7. **Filo telefon doğrulaması** — 14 senaryo gerçek cihazda PASS (#190 🟢)
8. **P11 araç sahiplik devri** — 3 bağımsız koşumda uçtan uca (#192 🟢)
9. **Çevrimdışı kuyruk dürüstlüğü** (#194 🟢)
10. **Debug kancası sızıntısı yok** — 55 production chunk tarandı (#191 🟢)
11. **Tanı Gönder uçtan uca** (#3/#4/#5 🟢) · **Cloud geofence uçtan uca** (#14 🟢)
12. **DTC kataloğu — 210 benzersiz kod**, lazy yükleme üretim yolunda bağlı, uydurma açıklama yok
13. **Mock politikası temiz** — `_getMockCodes()` yalnız `!isNativePlatform()`; native'de mock'a düşüş yok
14. **Persistence** — safeStorage + IndexedDB + LRU + saat sıçraması koruması + crash recovery
15. **Sunucu tarafı RBAC/RLS** — migration kendi doğrulama sorgusuyla güvenlik ihlalinde düşüyor
16. **Komut E2E şifreleme — her iki uç** (`commandService.ts:142,228` ↔ `remoteCommandService.ts:326`)
17. **Regresyon kasası** — 7.177 satır, depodaki en büyük test dosyası
18. **Adaptive Runtime disiplini** — SAFETY görevler her tier'da kısılmıyor (`:783`), termal tavan, histerezis

---

# 📐 GÜNCELLEME PROTOKOLÜ (BAĞLAYICI)

Bir madde üzerinde çalışıldığında **aynı turda**:

1. Maddenin durum işaretini güncelle (⬜ → 🔵 → 🟨 → 🟢).
2. **İlerleme Özeti** tablosundaki sayıları ve "Son güncelleme" tarihini yenile.
3. Maddenin altına **`### KOŞUM KAYDI`** bloğu ekle: ne yapıldı · hangi `dosya:satır` ·
   test sonucu · `tsc` durumu.
4. 🟨'ya geçiyorsa `docs/DEVICE_VALIDATION_LEDGER.md`'ye **🔴 satır aç**
   (ölçülebilir kabul ölçütüyle) ve numarasını buraya yaz.
5. 🟢'ya geçiyorsa kütükte satırı 🟢'ya taşı ve **cihaz kanıtını** (log/ekran/ses) yaz.
6. Cihazda düşerse ❌'ye taşı, gözlemlenen hatayı yaz, buradaki madde ⛔ olur.
7. Etkilenen özelliğin durumunu `docs/CAROS_PRO_VIZYONU.md`'de güncelle.

**YASAK:**
- Kütükte 🔴 bekleyen bir maddeyi burada 🟢 göstermek.
- "Test yeşil + tsc temiz" gerekçesiyle 🟢'ya geçmek (bu 🟨'dir).
- Bir maddeyi kabul ölçütü **ölçülmeden** kapatmak.
- Kapsamı sessizce daraltmak — daraltma kararı kullanıcınındır, gerekçe buraya yazılır.
