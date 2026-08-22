# DEVİR — 2026-08-22 · Vizyon Kapatma Turu (V-05 → V-18)

> **Bu belge bir sonraki oturuma yazılmıştır.** Amaç: nerede kalındığını, neyin
> **kanıtlandığını**, neyin hâlâ **borç** olduğunu ve *hangi tuzağa düşülmemesi*
> gerektiğini devretmek.
>
> Otorite sırası değişmedi: saha durumunda **`docs/DEVICE_VALIDATION_LEDGER.md`
> mutlak otoritedir**. Bu belge onunla çelişirse kütük geçerlidir.

---

## 1. Bir cümlede

`docs/VIZYON_KAPATMA_PLANI_2026-08-21.md` maddeleri sırayla kapatıldı; kalanların
tamamı ya **donanıma** ya **sahibinin kararına** bağlı. Plan durumu: **5 🟢 · 9 🟨 ·
3 ⬜ · 1 ⏸️**.

**🟨 = kod bitti, kilitler yeşil, ama gerçek araçta/head unit'te ÖLÇÜLMEDİ.**
🟨 bir madde "çalışıyor" diye sunulmaz.

---

## 2. Bu turda kapatılanlar

| Madde | Ne yapıldı | Durum |
|---|---|---|
| **V-12** Digital Twin provenance | Her sinyalin kaynak izi; yan kanal defteri, hot-path'te tahsis yok | 🟨 kütük #708 |
| **V-15** RLS maruziyet matrisi | 4 kapı · yerel + **üretim** ölçümü · mutasyonla kanıt | 🟢 kütük #709 |
| **V-17** Çalışma zamanı mod tavanı | Planın nedenselliği **çürütüldü**; ADR 0005 | 🟨 kütük #710 |
| **V-18** Eskimiş dokümanlar | Hayalî mimari rehberi baştan yazıldı + kalıcı kapı | 🟢 kütük #711 |
| **V-11** Driver DNA zinciri | 6 halka uçtan uca **kanıtlandı** (varsayım değil artık) | 🟨 kütük #712 |

Commit'ler: `99737e80` · `ee560134` · `08a18cc6` · `58241145` · `a84464c8`
(dal: `feat/fleet-offline-final-local-completion`).

---

## 3. Bu turun EN ÖNEMLİ üç dersi

### 3.1 "Sahte 0" — bir sayının yokluğu kanıt değildir

`anon` olarak `SELECT count(*)` çekip **0** görmek **korumanın kanıtı DEĞİLDİR**:
tablo boş da olabilir. Ölçüm anında yerelde **47 tablonun 20'si boştu** — naif bir
matris *"47/47 GEÇTİ"* derdi ve bunun **20'si yalan** olurdu.

**Kural:** ölçümden önce *ölçülebilirliği* ölç. Boş tablo → **UNPROVEN**, "geçti"
DEĞİL. Aynı disiplin V-12'de de var: hiç yazılmamış sinyalin yaşı **hesaplanmaz**
(`nowMs - 0` **56 yıllık** sahte bir yaş üretirdi).

### 3.2 Planın gerekçesi de bir iddiadır — ölç, kabul etme

V-17: plan *"mod hep BASIC_JS çünkü COEP kapalı"* diyordu ve pahalı bir çözüm
öneriyordu. Ölçüm: tespit **dört sıralı kapıdır**, SAB **sonuncudur**, ve hedef
donanımda (**K24 · Mali-400**) 2. kapı çok daha önce tetikliyor.
→ **COEP açılsaydı bile mod değişmezdi.** Yanlış kapıyı suçlamak, haftalarca sürecek
yanlış bir işi doğuracaktı.

V-11: plan *"köprü zaten çalışıyor, yalnız veri eksik"* diyordu — bu da **ölçülmemişti**.
Ölçüldü ve **doğru çıktı**; ama yönetici üretimde sürücü oluşturup zincir yine
kopsaydı teşhis baştan yanlış olurdu.

### 3.3 Yeşil bir test, sandığın şeyi sınadığını KANITLAMAZ

V-11'de idempotans halkası **yanlış sebeple** geçiyordu: metrik anahtarı snake_case
olduğu için yükleme sessizce reddediliyor, sayaç *"idempotans sayesinde" değil
"yükleme hiç olmadığı için"* sabit kalıyordu. Kendi kilidim yakaladı.
**Ara adımın gerçekten gerçekleştiğini ayrıca doğrula.**

---

## 4. Yeni araçlar (nasıl koşulur)

```bash
npm run test:rls        # 063 · RLS maruziyet matrisi   (yerel Docker)
npm run test:rls:prod   # 063b · ÜRETİMDE anon maruziyeti (salt-okunur)
npm run test:dna        # 064 · Driver DNA zinciri, 6 halka (yerel Docker)
```

Üçü de **fail-closed**: Docker yoksa, konteyner ayakta değilse ya da başarı imzası
çıktıda yoksa **sıfır dönmezler**. *"Koşamadım" ile "geçti" ayrı şeylerdir.*
Matrisler `ROLLBACK` ile biter; prod probe'u **başarıyı bile `RAISE EXCEPTION` ile**
bildirir, böylece üretimde iz bırakamaz.

**Yeni CAROS LAB ekranları:** Araç → **Sinyal Kaynak İzi** · Çalışma Zamanı →
**Mod Kapıları**.

---

## 5. AÇIK BORÇLAR — devralan bunlara bakmalı

### 5.1 Sahibinde (kod işi DEĞİL)

1. **Driver DNA'yı canlandır (V-11):** üretimde bir sürücü oluştur + araca ata
   (`create_fleet_driver` → `create_vehicle_driver_assignment`). Zincirin geri
   kalanı **kanıtlı**. Sonra ölç: statü `UNKNOWN` olmamalı, `trip_count` artmalı.
   *Not: test sahte sürücü YAZMADI — filo verisini kirletmemek için bilinçli.*
2. **PROD RLS'i tekrar koş** (V-15): 9 tablo üretimde **boş** olduğu için koruması
   **kanıtlanamadı**. İlk gerçek satır girince `npm run test:rls:prod` tekrar
   koşulmalı; `kanitlanamadi` sayısı düşmeli.

### 5.2 Donanıma bağlı

3. **V-13 saha sprint'i** — gerçek araç gerekiyor. Kütükte **639** madde 🔴 bekliyor;
   doğrulama oranı **%2,85**. Doğrulama hızı üretim hızını yakalamadan yeni özellik
   açmak, borcu büyütmektir.
4. **V-14 APK'ya karşı E2E** — bu turda **yazılmadı**, bilinçli: cihaz bağlı değil ve
   AVD/sistem imajı yok. Koşulamayan bir E2E hattı yazmak, bu repoda defalarca
   bulduğum *"motor var, besleyen yok"* desenini bir kez daha üretirdi.

### 5.3 Ürün kararı

5. **V-16 Enterprise** — PDF · zamanlanmış rapor · 90 gün saklama · driver scoring ·
   yakıt maliyeti · vardiya · dış REST API. Haftalar süren gerçek ürün inşası.
6. **V-03** — kullanıcı kararıyla **ERTELENDİ**; ilk müşteri/demo öncesi **zorunlu**.
7. **ADR 0005 koşulludur:** güçlü bir head unit (tier≠low **ve** weakGpu=false)
   ölçülürse SAB/COEP kararı **yeniden açılmalıdır**. Cihazda Mod Kapıları ekranı
   **YAZILIM SINIRI** derse, ADR'nin dayandığı ölçüm yanlıştır.

### 5.4 Küçük borçlar

8. **V-18 kapısı** yalnız `OFFLINE_MAP_GUIDE.md`'yi izliyor — yeni mimari rehber
   yazılırsa `docsReferenceIntegrity.test.ts` içindeki `GUIDES` listesine eklenmeli.
9. CAROS LAB'da **7 ekranın testi yok**; `trip-engine` ve `ai-mechanic` katalog
   metinleri hâlâ ASCII (cihazda bozuk görünür); LAB kabuğunda **59 kart** için
   arama/filtre yok.

---

## 6. Devralana uyarılar

- **`git add -A` KULLANMA.** Bu depoda başka bir Claude oturumu çalışabiliyor; bu
  turda bir kez başkasının işi yanlışlıkla commit'e girdi ve ayrılması gerekti.
  Her zaman **açık dosya yolları** ile stage'le.
- **`tsc --noEmit` YETMEZ** — build `tsc -b` kullanır ve `--noEmit`in kaçırdığı
  hataları yakalar. Doğrulamada **`tsc -b`** koş.
- **Boru hattından sonra `echo $?`** son komutun değil, borunun son halkasının
  durumunu verir. Çıktıyı dosyaya yönlendir, `$?`yi hemen oku.
- **Bash heredoc'ları** bu ortamda tırnak ve ters bölü kaçışlarını bozuyor; Türkçe
  kesme işareti içeren metinleri **Write/Edit** ile yaz.
- **Filo RPC'leri hata FIRLATMAZ**, `REJECTED` **döner**. Dönüş değerini **oku** —
  yoksa veri sessizce hiç yazılmaz. Sözleşme baştan sona **camelCase**
  (`driverId` · `distanceKm` · `harshBrakeCount`), atama tipi **BÜYÜK HARF**.

---

## 7. Doğrulama durumu (bu devir yazılırken)

```
tsc -b            temiz
lint              0 error
vitest            601 dosya / 13.119 test yeşil
test:rls          4/4 kapı (yerel)
test:rls:prod     üretimde anon maruziyeti = 0
test:dna          6/6 halka
```

**Hiçbiri gerçek araç kanıtı değildir.** 🟨 maddeler kütükte 🔴 olarak bekliyor.
