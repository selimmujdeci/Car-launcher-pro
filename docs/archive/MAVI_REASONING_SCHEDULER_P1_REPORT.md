# CAROS PRO — MAVI REASONING SCHEDULER P1 RAPORU

**Tarih:** 2026-08-01
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** 058'in açık borcunu (kütük #280) kapatmak — kuyruk koşucusunu
zamanlamak · örtüşen koşumu engellemek · koşumu ölçülebilir ve gözlemlenebilir
kılmak · CAROS LAB ve Fleet Dashboard yüzeyleri.
**LLM çağrısı yapıldı mı:** **HAYIR**
**Reasoning Engine (057) · Evidence Engine (055/056) · Wiring (058) gövdeleri:**
**DEĞİŞTİRİLMEDİ**
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `schedulerVerdict` | **`ESTABLISHED`** (34/34 PG · pg_cron dakikada bir gerçekten koştu · örtüşme iki oturumla kanıtlandı) |
| `queueDrainVerdict` | **`PROVEN_LOCAL`** (kuyrukta `PENDING` bekleyen gerçek olay, elle dispatch olmadan işlendi) |
| `wiringRegressionVerdict` | **`PRESERVED`** (058 matrisi 47/47 · üç kez arka arkaya · yarış yok) |
| `reasoningEngineRegressionVerdict` | **`PRESERVED`** (057 matrisi 56/56 · karar mantığı değişmedi) |
| `secondAuthorityVerdict` | **`NONE_CREATED`** (koşucu yalnız çağırır; gövde taraması migration ve testlerde kilitli) |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** (üretim Supabase'inde pg_cron açılmadı, dokunulmadı) |

Zamanlayıcı **yalnız yerel PostgreSQL'de** kanıtlandı. Üretim veritabanında
`pg_cron` açılmadı ve gerçek araç olayıyla hiç çalışmadı. Kanıtsız `PASS`
verilmedi.

---

## 2. NEDEN BU PAKET — VE NEDEN §9'DAKİ İLK MADDE DEĞİL

058 raporunun §9'u sıradaki işi **`PR-REASON-3 · VEHICLE VERDICT MIGRATION`**
olarak öneriyordu: `obd/verdictEngine.buildVehicleVerdict` kararını
`mavi_reason(VEHICLE_HEALTH)`dan alsın, kendi `level`/`confidence` hesabı
silinsin.

**Bu iş bugün yapılamaz ve nedeni mimaridir:**

1. Kanıt ve karar omurgası **sunucuda yaşar**. Cihaz tarafındaki iki depo
   bilinçli olarak boştur ve kaynak yorumları bunu açıkça yazar:
   *"head unit'te kanıt/karar ÜRETEN bir yol YOKTUR"*
   (`aiEvidenceEngine.ts` · `maviReasoningEngine.ts`).
2. `recordEvidence` **ürün kodunda hiçbir yerden çağrılmıyor** (yalnız
   testler): derin taramadan kanıt üreten bir adaptör yok. 056'nın adaptör
   listesi Deep Scan'i açıkça **kapsam dışı** ilan ediyor.
3. `buildVehicleVerdict` **çevrimdışı çalışmak zorundadır** — kapalı otoparkta,
   aftermarket dongle ile, ağsız. Kararı sunucudan almak, aracın tanı ekranını
   ağ olmadan **kör** bırakırdı.

Yani PR-REASON-3'ün gerçek ön koşulu vardır ve 058 raporunda adı geçmiyordu:
**derin tarama → kanıt adaptörü**, ardından cihazın kararı nasıl okuyacağı
(köprü) sorusu. Bu, tek başına bir pakettir ve bir **mimari çatal** içerir
(kararı cihazda mı üretelim, sunucudan mı okuyalım) — §7'de ayrıntılı.

Buna karşılık **`PR-REASON-5 · QUEUE SCHEDULER`** hem engelsiz hem de
058'in *şu anda yarım kalan* iddiasını tamamlıyor: 058 "karar üretimi artık
otomatiktir" dedi, ama kuyruğa alınan olaylar için bu **doğru değildi** —
onları işleyecek kimse yoktu. Bu yüzden sıra değiştirildi ve gerekçesi budur.

---

## 3. HEDEF GERÇEKLEŞTİ Mİ — TEK CÜMLELİK CEVAP

**Evet, yerel PostgreSQL'de kanıtlandı:** hot-path olayları artık kuyrukta
beklemiyor. 059 öncesi aşağıdaki olay **sonsuza kadar `PENDING`** kalırdı:

```sql
-- Sessizlikten dönen araç (hot-path → p_dispatch_now = false):
UPDATE public.vehicles SET last_seen = now() WHERE id = <va>;
```

| Aşama | Ölçüm |
|---|---|
| Olay üretildi (aynı işlem içinde ölçüldü) | `state=PENDING` · `started_at=NULL` (PG `B1`) |
| Zamanlanmış koşum çalıştı | `outcome=COMPLETED` · `processed=1` (PG `B2`/`B3`) |
| Olayın son hâli | `state=COMPLETED` · `started_at` dolu |

Ve zamanlama gerçekten canlıdır — koşum kaydı uydurulmuş değil:

```
 cron.job_run_details:  succeeded | 08:16:00 | 08:15:00 | 08:14:00 | 08:13:00 | 08:12:00
 mavi_reasoning_scheduler_run:  trigger_source=CRON · outcome=COMPLETED
```

---

## 4. ÖRTÜŞEN KOŞUM — İKİ OTURUMLA GERÇEK KANIT

Advisory lock **aynı oturumda yeniden girişlidir**; örtüşme tek bir psql
dosyasından sınanamaz (dblink bu kurulumda parolasız bağlanamıyor — rol
superuser değil). Bu yüzden D1 iki eşzamanlı oturumla koşuldu:

```bash
# OTURUM A — kilidi tut
docker exec -e PGPASSWORD=postgres supabase_db_fleetval psql -U postgres -d postgres \
  -tAc "SELECT pg_advisory_lock(590059001); SELECT pg_sleep(8);" &
sleep 2
# OTURUM B — koşumu dene
docker exec -e PGPASSWORD=postgres supabase_db_fleetval psql -U postgres -d postgres \
  -c "SELECT outcome, processed FROM public.run_mavi_reasoning_scheduler(50,'MANUAL');"
```

Ölçülen:

| Durum | `outcome` | `processed` |
|---|---|---|
| Kilit başkasındayken | **`SKIPPED_LOCKED`** | **`NULL`** (sahte `0` DEĞİL) |
| Kilit bırakıldıktan sonra | `COMPLETED` | `0` (gerçekten 0 iş vardı) |

Bu iki satırın farkı paketin özüdür: **"iş yapmadım" ile "iş yoktu" ayrı
gerçeklerdir** ve kütükte ayrı görünürler. Şema bunu zorlar:
`mrsr_counts_only_when_completed` kısıtı, tamamlanmamış bir koşuma sayaç
yazılmasını **reddeder** (PG `C1`).

---

## 5. NE YAPILDI (migration 059)

| # | Parça | Ne yapar | Ne YAPMAZ |
|---|---|---|---|
| 1 | `mavi_reasoning_scheduler_run` | Bounded koşum kütüğü (son 500) | Şirket verisi taşımaz; istemciye HİÇ açılmaz (RLS + policy YOK = varsayılan RED) |
| 2 | `run_mavi_reasoning_scheduler(limit, source)` | `run_mavi_reasoning_queue()` + `expire_mavi_reasoning()` **çağırır**, sonucu kütüğe yazar | Niyet çözmez · kanıt okumaz · güven hesaplamaz · `mavi_reason`ı DOĞRUDAN çağırmaz |
| 3 | pg_cron işi `mavi-reasoning-scheduler` | Dakikada bir tetikler | Kurulamazsa migration DÜŞMEZ ama **sessizce başarılı da GÖRÜNMEZ** |
| 4 | `get_reasoning_scheduler_health()` | LAB + Dashboard için salt-okunur sağlık | Oturumsuz BOŞ döner (fail-closed); araç/sürücü/şirket alanı YOKTUR |

### 5.1 Üç fail-closed kuralı ve kanıtları

**(1) Örtüşen koşum yoktur.** `pg_try_advisory_lock` + sabit anahtar
(`_reasoning_scheduler_lock_key() = 590059001`, çağıran gevşetemez). Atlanan
koşum sessizce dönmez, kütüğe `SKIPPED_LOCKED` yazılır (PG `D2`–`D4` · §4).

**(2) Ölçülmeyen sayaç `0` değil `NULL`dır.** Dört CHECK kısıtı bunu şemada
zorlar; uydurma `outcome`, bilinmeyen tetikleyici kaynağı ve ölçümsüz
"tamamlandı" **reddedilir** (PG `C1`–`C4`).

**(3) Koşum satırı ÖNCE `FAILED` açılır.** Oturum koşum ortasında ölürse
kütükte yarım iş `FAILED` görünür — sessiz kayıp yoktur.

### 5.2 Sağlık kapısı ÜÇ DEĞERLİDİR

`healthy` bilinçli olarak `boolean | null`dır ve sıra rastgele değildir:

| Sıra | Koşul | Cevap | Neden |
|---|---|---|---|
| 1 | Zamanlanmamış | `false` | Gerçek arıza: kuyruk hiç boşalmayacak |
| 2 | Hiç koşmamış | **`null`** | Kurulu ama tetiklenmemiş — bu "iyi" değil, **bilinmiyor** |
| 3 | Art arda hata | `false` | Düşen koşum hiçbir koşulda belirsizliğe gömülmez |
| 4 | Aralık bilinmiyor | **`null`** | Tanınmayan cron ifadesi → gecikme **ölçülemez** → "sağlıklı" DENMEZ |
| 5 | Gecikmiş (>3 aralık) | `false` | Tek kaçan tik arıza değildir; üçü arızadır |
| 6 | Aksi hâlde | `true` | Ölçüldü ve zamanında |

3. sıranın 4'ten önce gelmesi bir kilittir (TS `C4` · PG `F7` sıra taraması):
kapılar ters olsaydı **düşen bir koşum "bilinmiyor" diye yumuşatılırdı**.

⚠️ Bu, ilk yazımda SQL'de yanlıştı (aralık bilinmiyorken `true` dönüyordu) ve
TS aynasını yazarken fark edildi; SQL düzeltildi, `H6` kontrolü eklendi.

---

## 6. TEST SONUÇLARI (tamamı bu turda koşuldu)

| Kapı | Sonuç |
|---|---|
| **PG — 059 zamanlayıcı matrisi** | **34/34 PASS** (`supabase/tests/059_reasoning_scheduler_matrix.sql` — depoda kalıcı) |
| **PG — örtüşme (iki oturum)** | **PASS** (§4 · `SKIPPED_LOCKED` + `NULL` sayaç) |
| PG — 059 migration doğrulaması | **OK** · **üç kez** uygulandı, **idempotent** (tek cron işi kaldı) |
| **PG — 058 wiring matrisi (059 sonrası)** | **47/47 PASS · üç ayrı koşumda** (canlı cron ile yarış YOK) |
| **PG — 057 karar matrisi (059 sonrası)** | **56/56 PASS** |
| Vitest — `maviReasoningScheduler.test.ts` | **36/36 PASS** (yeni) |
| Vitest — `maviReasoning` · `maviReasoningWiring` · `aiEvidence*` | **199/199 PASS** |
| Vitest — `reasoningView.test.ts` (website) | **51/51 PASS** (41 → +10) |
| TypeScript (kök · website) | **temiz** |
| ESLint (kök · değişen dosyalar) | **temiz** |
| **Vitest (kök tam paket)** | **9725/9725 · 449/449 dosya** (9689 → +36) |
| **Vitest (website tam paket)** | **965/965 · 45/45 dosya** (955 → +10) |

**059 matrisi (34 kontrol):** zamanlama gerçekliği (A1–A3) · kuyruğun
boşalması (B1–B4) · ölçüm dürüstlüğü kısıtları (C1–C4) · örtüşme mekanizması
(D2–D4) · ikinci otorite yasağı (E1–E3) · yetki/RLS/sızıntı (F1–F3) · bounded
kütük (G1) · sağlık RPC'si gerçek veri (H1–H6) · 053–058 regresyonu (I1–I7).

### 6.1 Doğrulama sırasında bulunan iki test kusuru (ürün hatası değil)

1. **`profiles` fixture'ı** — `auth.users` INSERT'i bir trigger ile profili
   KENDİ açıyor; testimin ikinci INSERT'i `profiles_pkey` çakışması verdi.
   `ON CONFLICT DO UPDATE`ye çevrildi.
2. **`H6` sıralaması** — kontrol, `H3`'ün bilerek yazdığı `FAILED` satırının
   ardından koşuyordu; sağlık haklı olarak `false` döndü. `H6` artık kendi
   ölçümünden önce temiz bir koşum yapıyor (hata kapısı zaten `H3`'te kilitli).

### 6.2 ESLint notu (kapsam dışı, gizlenmiyor)

`website` ESLint yapılandırması `src/**` dosyalarını **ignore ediyor**
(`File ignored because of a matching ignore pattern`) — bu paketin dosyaları
dâhil. Kök projede lint temiz. Bu, bu turda oluşmuş bir kusur DEĞİLDİR ama
"website lint temiz" cümlesi kurulamaz; kütüğe yazıldı.

---

## 7. AÇIK MİMARİ ÇATAL — PR-REASON-3 İÇİN KARAR GEREKİYOR

Analiz (§2) `buildVehicleVerdict`in taşınmasının önünde iki yol bıraktı ve
ikisi de **mimari bir seçimdir**, teknik bir ayrıntı değil:

**A. Sunucu tek üretici kalır (mevcut tasarımın devamı).**
Cihaz derin tarama sonucunu sunucuya iter → yeni bir `DEEP_SCAN` kanıt
adaptörü kanıt yazar → 058 zinciri kararı üretir → cihaz kararı **okur**.
*Artı:* tek üretici, drift yok, 055–059'un yazılı tasarımıyla birebir.
*Eksi:* **ağsız araçta tanı verdisi üretilemez** — bugün üretilebiliyor.

**B. Aynı motor cihazda da koşar (paritesi kilitli).**
`maviReasoningEngine.reason()` zaten SAF ve I/O'suz; cihaz kendi kanıt
defterini kurup **aynı** fonksiyonu çağırır. İkinci otorite değildir — aynı
otoritenin yerel koşumudur.
*Artı:* çevrimdışı çalışır, gecikme yok.
*Eksi:* TS↔SQL **ayrışma riski** (parite testiyle bağlanmalı) ve 055/057'nin
"cihazda üretim YOKTUR" yazılı kararının bilinçli olarak değişmesi.

⚠️ Bu çatal **bu turda çözülmedi ve hiçbir dosya bu yönde değiştirilmedi.**
Yanlış seçim, haftalarca yanlış yönde iş demektir.

---

## 8. GÖZLEMLENEBİLİRLİK (yedi şart)

| # | Şart | Durum |
|---|------|-------|
| 1 | Özellik uygulandı | ✅ migration 059 · `maviReasoningSchedule.ts` |
| 2 | CAROS LAB salt-okunur ekran | ✅ `MaviReasoningEngineScreen` → **Queue Scheduler** bölümü |
| 3 | Gerçek veri kaynağı | ✅ `get_reasoning_scheduler_health()` (sabit/örnek veri YOK) |
| 4 | LAB aktif komut göndermiyor | ✅ TS `F9` · website `G8`/`G10` (koşum tetikleyen çağrı yok) |
| 5 | Kanıtsız bilgi üretilmiyor | ✅ ölçülmeyen alan `UNAVAILABLE`/`—`; üç değerli sağlık |
| 6 | Gizli veri taşınmıyor | ✅ RPC imzasında araç/sürücü/şirket/VIN/plaka alanı YOK (PG `H4` · TS `F8`) |
| 7 | Unit test + kütük maddesi | ✅ 36 + 10 test · kütük #280 güncellendi, #285 açıldı |

**Fleet Dashboard:** `ReasoningCards` → **Kuyruk Koşucusu** bölümü (durum ·
son koşum yaşı · işlenen iş · koşum süresi · aralık). Bölüm **karar yokken
bile** gösterilir (website `G9`): koşucu yoksa "0 bekleyen iş" ile "işleri
işleyecek kimse yok" ekranda aynı görünürdü.

---

## 9. BİLİNÇLİ OLARAK YAPILMAYANLAR

| # | Yapılmadı | Neden |
|---|---|---|
| 1 | Üretim Supabase'inde pg_cron açılması | Deploy/production DB yasağı. Yönetilen ortamda eklenti panelden açılır; migration bunu DENER, başarısız olursa sağlık RPC'si `job_scheduled=false`/`healthy=false` döndürür — **gizlenmez** |
| 2 | `expire_ai_evidence()` zamanlaması | 055 kapsamı; bu paket karar kuyruğuna odaklandı. Kanıt süre dolumu hâlâ zamanlayıcısız (kütük #285) |
| 3 | Kuyruk gecikmesi için alarm/bildirim | Gözlem yüzeyi kuruldu; alarm ayrı bir karardır ve kimin uyarılacağı ürün sorusudur |
| 4 | 8 paralel karar otoritesinin taşınması | Görev gereği dokunulmadı (kütük #284); §7'deki çatal çözülmeden ilki başlatılamaz |
| 5 | Head unit'te koşum tetikleme | Kuyruk sunucuda yaşar; cihaz yalnız OKUR — bu paket o sınırı korudu |
| 6 | Gerçek araç doğrulaması | Cihaz/araç yok — `BLOCKED_REAL_VEHICLE` |

---

## 10. SONRAKİ ATOMİK PR ÖNERİSİ

1. **`PR-REASON-6 · CONNECTIVITY/LOCATION EVIDENCE ADAPTERS`** — engelsiz ve
   sıradaki en yüksek değer: kuyruk artık boşalıyor ama bu iki olayın
   kanıt kaynağı yok, dolayısıyla kararlar `INSUFFICIENT_EVIDENCE` çıkıyor
   (kütük #281). Adaptörler eklendiğinde 059 gerçek karar üretmeye başlar.
2. **`PR-REASON-3 · VEHICLE VERDICT MIGRATION`** — §7'deki çatal
   karara bağlandıktan **sonra**; ön koşulu derin tarama kanıt adaptörüdür.
3. **`PR-REASON-4 · CONFIDENCE AUTHORITY UNIFICATION`** —
   `diagnosticKnowledgeEngine.combineConfidence` kaldırılır (aynı çatala tabi).
4. Üretim Supabase'inde pg_cron açılıp **gerçek bir araç olayının** kendi
   kendine karara bağlandığının gözlenmesi → kütük #279 ve #285'in 🟢'ye
   taşınması.
