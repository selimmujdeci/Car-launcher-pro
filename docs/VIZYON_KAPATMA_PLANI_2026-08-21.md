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

## 🔵 V-04 — Ölü kodu ya bağla ya sil  **[DEVAM — 5/6 kapandı]**

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
| 6 | `manufacturerProfileBuilder` | 234 | ⬜ keşif çıktısına bağlı |

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

## ⬜ V-05 — Çevrimdışı rota grafiğini üret ve paketle ⭐ EN YÜKSEK GETİRİ

**BULGU:** A* motoru (486 satır, binary min-heap, testli) **yazılı ama verisi hiç var olmamış**.

**KANIT:**

```
NavigationCompute.worker.ts:29   const GRAPH_URL = '/maps/routing-graph.bin'
NavigationCompute.worker.ts:58   if (!res.ok) { _graphFailed = true; return null; }  ← KALICI
$ ls public/maps/    → DİZİN YOK
$ ls dist/maps       → YOK
$ find android/app/src/main/assets → maps/ YOK
```

Sonuç: ağ yoksa `computeOfflineRoute()` **her zaman null** → `straightLineRoute()`
(kuş uçuşu). Kod bunu dürüstçe `STRAIGHT_LINE_GUIDANCE` diye etiketliyor ve
"çevrimdışı rota" DEMİYOR — **dürüstlük ✅, yetenek ❌**.

**YAPILACAK:** Türkiye OSM → `routing-graph.bin` üretim script'i (format zaten tanımlı:
`GRAPH_MAGIC_V2 = 0x32475452` yani `'RTG2'`; node/adjacency/costM/oneway) → build adımı →
`public/maps/` → APK'ya gömme. Boyut bütçesi belirlenmeli (bölge bazlı bölme gerekebilir).

**KABUL ÖLÇÜTÜ (cihazda):** Uçak modunda, daha önce hiç açılmamış bir hedefe rota istenir;
`recordRouteSource()` **`OFFLINE_GRAPH`** yazar (`STRAIGHT_LINE_GUIDANCE` DEĞİL) ve
ekranda gerçek yol geometrisi çizilir. CAROS LAB · Navigation Core'da kaynak adıyla görünür.

---

## ⬜ V-06 — Çevrimdışı POI veritabanını üret ve paketle

**BULGU:** FTS5 arama + SharedArrayBuffer zero-copy protokolü yazılı; `poi.db` pakette yok.

**KANIT:** `NavigationCompute.worker.ts:264` `const POI_DB_URL = '/maps/poi.db'` ·
`:305` fetch · `:376` `'poi.db yüklenemedi'` · `public/maps/` yok.

**YAPILACAK:** OSM POI → SQLite FTS5 `poi.db` üretimi + paketleme (V-05 ile aynı pipeline).

**KABUL ÖLÇÜTÜ (cihazda):** Uçak modunda "en yakın benzinlik" araması gerçek sonuç döndürür;
`searchPOI()` `dbError:false` + `count > 0`.

---

## ⬜ V-07 — Vektör karo bölge paketi (indirme yanlış formatı indiriyor)

**BULGU:** "Çevrimdışı harita indir" düğmesi **ürünün çizdiği karoyu indirmiyor**.

**KANIT:**

```
offlineTileDownloader.ts:65   https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png   ← RASTER
.env:31                       VITE_VECTOR_TILE_URL=https://tiles.openfreemap.org/planet ← VEKTÖR
serviceWorker.js:27,31        yalnız /tiles/z/x/y.png ve tile.openstreetmap.org yakalıyor
                              → .pbf HİÇ yakalanmıyor
```

Vektör karoların tek önbelleği `CacheLRUManager` — **fırsatçı**, yalnız gezilen bölgeyi tutar.
Sonuç: "Türkiye / İstanbul / Ankara / İzmir indir" düğmeleri işe yaramıyor.
Bu, depoda tekrar eden **"motor var, besleyen yok"** deseninin **7. örneği**.

**YAPILACAK:** İki seçenekten biri —
(a) `offlineTileDownloader`'ı `.pbf` indirecek şekilde çevir ve `CacheLRUManager`'a yaz, veya
(b) `CacheLRUManager`'a bbox+zoom toplu ısıtma API'si ekle, panel onu çağırsın.

**KABUL ÖLÇÜTÜ (cihazda):** "Ankara indir" → WiFi kapat → **hiç açılmamış** bir Ankara
mahallesine pan → sokaklar + etiketler çizilir. `adb screencap` kanıtı.

---

## ⬜ V-08 — KWP hattını kapat (`kwpDtc.ts` bağlanmamış + Trafic doğrulanmadı)

**BULGU:** KWP protokolü Türkiye'de çok yaygın (Renault sınıfı) ama **DTC ayrıştırma
kodu hiçbir yerden çağrılmıyor**; kütükte KWP/Trafic doğrulaması da açık borç.

**KANIT:** `grep -rn kwpDtc src` (test hariç) → yalnız kendi dosyası ve `udsDtc` importu.
Üretim yolundaki tek DTC tarayıcı `multiEcuScan.ts` → `DTCPanel.tsx` (UDS/CAN).

**YAPILACAK:** `kwpDtc.ts`'i `dtcService`/`multiEcuScan` yoluna bağla + CAROS LAB'a
KWP DTC gözlem satırı ekle.

**KABUL ÖLÇÜTÜ (cihazda):** Renault Trafic'te (KWP) arıza paneli DTC listesi döndürür veya
**fail-closed** olarak "kapsam dışı" der — sessiz "temiz" DEMEZ.
`docs/DEVICE_VALIDATION_PLAN_RENAULT_TRAFIC.md` koşulur.

---

# 🧠 P2 — ZEKÂ KATMANININ GERÇEKLEŞMESİ

## ⬜ V-09 — Prediction Engine'i bağla (anayasanın 6. kapısı kapalı)

**BULGU:** *"5 dk sonra ne olacak?"* kapısı fiilen kapalı. 164 satır trend/öngörü motoru
(`fitTrend`, `predict`, `DEFAULT_PREDICTION_RULES`: overheat · battery_drain · oil_pressure_drop)
**tek tüketicisi kendi testi**.

**KANIT:** `grep -rn predictionEngine src` → `src/platform/obd/predictionEngine.ts` +
`src/__tests__/predictionEngine.test.ts`. Üretimde **0 çağrı**.

**YAPILACAK:** `maintenanceBrain` / `signalHub` üzerinden **cold-path**'te besle
(3 Hz hot-path'e ASLA girmez). Güvenlik-kritik tahminler (overheat, yağ basıncı)
**her tier'da açık** (CLAUDE.md). CAROS LAB'a salt-okunur gözlem ekranı **zorunlu**.

**KABUL ÖLÇÜTÜ:** Motor sıcaklığı 5 örnekte yükselirken LAB'da `overheat` tahmini
`fitQuality ≥ 0.6` ile görünür; kanıt yetersizken `UNAVAILABLE` yazar (sahte tahmin YOK).

---

## ⬜ V-10 — Deep Scan aktif taramayı ya bağla ya emekli et (İKİNCİ OTORİTE)

**BULGU:** Roadmap'in merkezindeki motor **üretimde hiç çalışmıyor**; sahadaki tarama
başka bir motordan geliyor. Anayasanın "ikinci otorite" yasağının ihlali.

**KANIT:**
- `platformCoreDeepScanWiring.ts:129` — *"HANDLER YOK (W5-3c) → tüm fazlar `skipped` → **GERÇEK İŞ YAPILMAZ**"*
- `:316` — `hasHandlers: false`
- `DeepScanOrchestrator.run()` (1.103 satır) → üretimden **0 çağrı**
- Sahada çalışan: `PidDidDeepScanPanel.tsx:15` → `discoveryLive.getLiveDiscoveryCoordinator()`

**W5 aşama durumu (denetlendi):**

| Aşama | Kod | Wiring | Aktif iş | Verdi |
|---|---|---|---|---|
| W5-1 ownership | ✅ | ✅ `SystemBoot.ts:813` | `hasHandlers:false` | 🟡 |
| W5-2 Event Bridge | ❌ | ❌ | ❌ | 🔴 |
| W5-3a Offline Surface + Guard Band | ✅ `deepScanOrchestrator.ts:208,314,655` | ✅ | guard band gerçek | 🟡 **tasarımdan ileri, tam değil** |
| W5-3b offline trigger | ✅ `:327-395` | ✅ `SystemBoot.ts:967` | ✅ | ✅ |
| W5-3c-3 change_detection | ✅ | ✅ | ✅ **tek gerçek handler** | ✅ |

**YAPILACAK:** İki otoriteden biri seçilecek. `discoveryLive` kazanırsa W5 roadmap dili
güncellenir ve orchestrator emekli edilir; orchestrator kazanırsa üretim yoluna bağlanır.

**KABUL ÖLÇÜTÜ:** Depoda "derin tarama" için **tek** üretim otoritesi kalır; vizyon
belgesindeki Deep Scan bölümü gerçeği anlatır.

---

## ⬜ V-11 — Driver DNA besleme köprüsünü kur

**BULGU:** 689 satır motor + SQL tablosu + LAB ekranı hazır — **veri hiç akmıyor**.

**KANIT:** `grep -rn 'accumulateTrip\|driverDnaStore\|buildDna(' src` (test hariç) →
yalnız `fleet/driverDnaEngine.ts`'in kendisi. Tek okuyucu `FleetDriverDnaScreen.tsx` (LAB).
Migration `20260731000053_driver_dna_p1.sql` mevcut.

**YAPILACAK:** `tripLogService` → `accumulateTrip()` köprüsü (cold-path, yolculuk bitiminde).
`TripSignal` kaynak etiketleri (`MEASURED · DERIVED · ESTIMATED · UNAVAILABLE`) korunur —
ölçülmemiş sinyal **ESTIMATED diye sunulmaz**.

**KABUL ÖLÇÜTÜ:** 3 gerçek yolculuk sonrası LAB · Driver DNA ekranında `dnaAgeMs` güncel,
`computeDnaConfidence` > 0, metrikler kaynak etiketleriyle görünür.

---

## ⬜ V-12 — Digital Twin'in ilk gerçek katmanı: provenance (P2-5)

**BULGU:** Vizyon belgesi kendi beyanıyla **İSKELET** diyor, kod bunu doğruluyor:
*"`UnifiedVehicleStore` gerçek Digital Twin değildir — yalnız anlık sinyal aynasıdır.
Kimlik, history, prediction, provenance ve lifecycle eksiktir."*

**KANIT:** `docs/CAROS_PRO_VIZYONU.md:3307-3326` · `grep -il 'digital twin' src` →
yalnız `platform/trip/tripCanonicalModel.ts` (bir yorum).

**YAPILACAK:** Vizyonun kendi belirlediği sonraki atomik PR: **her sinyalin kaynak izi**.
`Measurement` katmanı (`LIVE · STALE · OFFLINE · NEVER_SEEN · UNKNOWN`) zaten var — üzerine provenance.

**KABUL ÖLÇÜTÜ:** (kod) her sinyal kaynağıyla birlikte okunur; (cihaz) gerçek araçta
provenance zinciri kanıtla doğrulanır.

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

## ⬜ V-15 — RLS matris testi

**BULGU:** Kütükte kayıtlı: migration 038'de **member kendini admin yapabiliyordu**.
Kapatıldı ama bu sınıfın **sistematik kapısı yok**.

**YAPILACAK:** Her rol × her tablo × her işlem matrisi (`supabase/tests/` altında).
84 policy · 54 RLS tablosu · 194 SECURITY DEFINER kapsanacak.

**KABUL ÖLÇÜTÜ:** Bir policy bilinçli gevşetildiğinde matris testi **düşer**.

---

# 🏢 P4 — ENTERPRISE

## ⬜ V-16 — Enterprise özelliklerini gerçekten yap

V-03 sayfayı gerçeğe hizalar; bu madde **özelliği inşa eder**.

- [ ] **PDF rapor üretimi** — permissive lisans şart (`pdf-lib` MIT ✅; GPL/AGPL/NC **YASAK**)
- [ ] **Zamanlanmış rapor gönderimi** (günlük/haftalık)
- [ ] **90 günlük geçmiş** + saklama politikası (pg_cron; şu an max 30 gün)
- [ ] **Driver scoring** (Driver DNA metrikleri üzerine — V-11'e bağımlı)
- [ ] **Yakıt maliyet analizi**
- [ ] **Vardiya yönetimi** modeli
- [ ] **Dış müşteri REST API'si** — anahtar + doküman + rate-limit

**KABUL ÖLÇÜTÜ:** Her alt madde için `enterprise/page.tsx`'teki vaat, koda giden
bir `dosya:satır` referansıyla desteklenir.

---

# 🏛️ P5 — MİMARİ KARAR GEREKTİRENLER

## ⬜ V-17 — Adaptive Runtime: üst modlar cihazda erişilemez (KARAR + ADR)

**BULGU:** APK'da otomatik tespit **her zaman BASIC_JS** döner. SAB zero-copy yolları
(`sabChannel`, POI SAB) cihazda **hiç koşmuyor**; JSON fallback kalıcı.

**KANIT:**

```
AdaptiveRuntimeManager.ts:353-360
  const hasSAB = typeof SharedArrayBuffer !== 'undefined'
              && self.crossOriginIsolated === true;
  if (!hasWorker || !hasSAB) return RuntimeMode.BASIC_JS;

vite.config.ts:232   const _coopCoepHeaders = {};   ← BOŞ
capacitor.config.ts                                 ← COEP başlığı YOK
```

Bu **kaza değil, belgelenmiş takas**: COEP açılırsa YouTube iframe'i ve çapraz-köken
kaynaklar kırılıyor (`vite.config.ts:222-230`). BALANCED'a yalnız
`CognitivePriorityEngine.ts:100` (bilişsel toparlanma) veya `useLayoutServices.ts:64`
(kullanıcı override) ile çıkılabiliyor.

**KARAR SEÇENEKLERİ:**
1. **Kabul et** → ADR yaz, SAB yollarını sil (bakım maliyeti sıfırlansın), CLAUDE.md'deki
   SAB/Seqlock disiplinini kapsam dışına al.
2. **Çöz** → medya iframe'lerini ayrı bir WebView/origin'e taşı, ana origin'de COEP aç.

**KABUL ÖLÇÜTÜ:** `docs/adr/` altında karar kayıtlı; seçilen yol koda yansımış;
CAROS LAB · Runtime ekranında gerçek mod ve **nedeni** görünüyor.

---

## ⬜ V-18 — Eskimiş dokümanları temizle

**BULGU:** `src/platform/OFFLINE_MAP_GUIDE.md` mimari çekirdek olarak iki dosya anlatıyor:
`offlineMapService.ts` ve `tileLoader.ts` — **ikisi de mevcut değil**.
→ `DOCUMENTATION ≠ IMPLEMENTATION`

**KANIT:** `ls src/platform/offlineMapService.ts src/platform/tileLoader.ts` → *No such file*

**YAPILACAK:** Rehberi gerçek mimariye (`mapSourceManager` · `mapProtocols` ·
`CacheLRUManager` · `serviceWorker`) göre yeniden yaz veya sil. Kökteki 47 markdown +
`docs/` altındaki 100 dosya için aynı taramayı yap.

**KABUL ÖLÇÜTÜ:** Hiçbir belge var olmayan bir dosyayı "çekirdek bileşen" diye anlatmıyor.

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
