# CAROS PRO — FLEET DRIVER IDENTITY & ASSIGNMENT P0 RAPORU

**Tarih:** 2026-07-30
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Sürücü kimliği ve araç/trip atama **temeli**.
**Commit / push / deploy / db push:** YAPILMADI (kural gereği)

> **Bu paket Driver DNA DEĞİLDİR.** Sürüş puanı, davranış profili, AI
> yorumlama, risk tahmini, ceza/ödül ve vardiya optimizasyonu **üretilmedi**.

---

## 1. EXECUTIVE SUMMARY

Bu paket tek bir soruyu güvenilir biçimde cevaplanabilir hâle getirdi:

> **"Bu aracı, bu zaman aralığında ve bu yolculuk sırasında kim kullanıyordu?"**

Cevap kanıtlanamıyorsa **`UNKNOWN`**'dır — ve bu bilinçli bir üründür,
eksiklik değil. Araç sahibi, Fleet kullanıcısı, observer, fleet admin veya
son giriş yapan kişi **hiçbir koşulda otomatik sürücü sayılmaz**. Bu kural
hem sunucuda (`_resolve_trip_driver` yalnız atama tablosuna bakar) hem
istemcide (görünüm katmanı `driver_id` yoksa `ATTRIBUTED` iddia edemez)
zorlanır ve **54 gerçek PostgreSQL kontrolü + 70 kilit** ile korunur.

### Devraldığımız gerçek: "sürücü" bir METİNDİ

Preflight'ta bulunan en önemli şey: mevcut sistemde sürücü kavramı
`vehicles.driver_name` adlı **serbest bir TEXT kolonuydu** ve Fleet UI onu
`driver_name ?? '—'` diye gösteriyordu. Bu alanın:

- kimliğe bağı **yok** (herhangi bir yazı girilebilir),
- zaman aralığı **yok** ("geçen salı kim kullandı?" cevaplanamaz),
- denetimi **yok** (kim değiştirdi bilinmez),
- tenant güvenliği **yok**,
- trip'e bağı **yok**.

O kolon **değiştirilmedi** (geriye uyum), ama sürücü otoritesi artık
`fleet_drivers` + `vehicle_driver_assignments` + trip attribution
zinciridir.

---

## 2. NİHAİ KARAR

### **`FLEET_DRIVER_IDENTITY_ASSIGNMENT_P0_COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`FLEET_DRIVER_IDENTITY_ASSIGNMENT_P0_COMPLETE_LOCAL`** |
| `fleetFoundationRegressionVerdict` | **`PRESERVED`** |
| `tripMetricsP2RegressionVerdict` | **`PRESERVED`** |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `headUnitDriverValidationVerdict` | **`BLOCKED_REAL_DEVICE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

En düşük kanıt seviyesi saha doğrulamasıdır; ana karar bu yüzden
`COMPLETE_LOCAL`'dir — **`VALIDATED` DEĞİL**.

---

## 3. PREFLIGHT — koddan çıkarılan gerçek

| Alan | Bulgu | Sınıf |
|------|-------|-------|
| Supabase auth + `profiles` | `id → auth.users`, `company_id → companies`, `role` | **MEVCUT** |
| `profiles.role` CHECK | `individual · member · observer · admin · super_admin` | **MEVCUT** |
| **driver rolü** | Yok — ve **eklenmedi** (sürücü bir ROL değil, bir KAYITTIR) | **YOK** |
| Capability matrisi | `roles.ts`, 4 rol × 14 yetki, bilinmeyen rol fail-closed | **MEVCUT** |
| `companies` · `current_membership()` | Şirket kimliği ve üyelik okuma | **MEVCUT** |
| `vehicles` | `owner_id` **XOR** `company_id` (CHECK), `api_key_hash`, `revision` | **MEVCUT** |
| **`vehicles.driver_name`** | Serbest TEXT; UI'da gösteriliyor; kimlik/zaman/denetim yok | **KISMEN VAR** |
| `vehicle_pairings` | `vehicle_id + user_id + role + company_id` | **MEVCUT** |
| Transfer (`accept_vehicle_transfer`) | Sahiplik değişir, **pairings SİLİNİR**, komutlar expire | **MEVCUT** |
| `vehicle_trips` | `trip_key` UNIQUE + `revision`; **sürücü alanı yok** | **KISMEN VAR** |
| Head unit auth | `p_api_key` gövdede, **anon** rolüyle PostgREST | **MEVCUT** |
| Head unit sürücü seçim yüzeyi | Yok | **YOK** |
| Phone Hub / NFC / BLE kimlik | Bağlı değil (Phone Hub cihazda hiç çalışmadı) | **KAPSAM DIŞI** |
| Fleet UI sürücü yönetimi | Yok (`members` var, driver yok) | **YOK** |
| Driver profile / assignment / attribution | Hiç yok | **YOK** |

---

## 4. MEVCUT KULLANICI / ROL MODELİ

```
auth.users ──1:1──> profiles ──N:1──> companies
                      │ role: individual · member · observer · admin · super_admin
                      │ company_id
                      ▼
                  vehicles (owner_id XOR company_id)
```

| Rol | Sürücü/atama yetkisi (bu paket) |
|-----|--------------------------------|
| `admin` | Sürücü ve atama **yönetimi**; trip sürücüsü düzeltme |
| `member` | Yalnız **okuma** (araç komutu gönderebilir ama kimlik yönetemez) |
| `observer` | Yalnız **okuma** — hiçbir yazma |
| `individual` | Şirketi yok → **kapsam dışı** |
| `anon` (head unit) | Yalnız **kendi aracının** minimum atama özeti |

**Yeni bir auth sistemi kurulmadı; `profiles` modeli değiştirilmedi.**

---

## 5. AUTH USER ↔ DRIVER AYRIMI

Yedi kavram ayrı tutuldu ve **tek bir `user_id` alanına indirgenmedi**:

| # | Kavram | Karşılığı |
|---|--------|-----------|
| 1 | Auth User | `auth.users` / `profiles` |
| 2 | Company Member | `profiles.company_id` + `role` |
| 3 | Vehicle Owner | `vehicles.owner_id` / `company_id` |
| 4 | Vehicle Observer | `profiles.role = 'observer'` |
| 5 | **Driver Profile** | `public.fleet_drivers` |
| 6 | **Driver Assignment** | `public.vehicle_driver_assignments` |
| 7 | **Trip Attribution** | `vehicle_trips.driver_*` |

Kilitlenen üç önerme (PG D3, D20, D21 + kilit A1–A3, D1–D5):

- Bir kişinin Fleet hesabı olması onu **sürücü yapmaz**.
- Bir aracın sahibi olmak her trip'in **sürücüsü olmak demek değildir**.
- Araca erişebilmek onu **sürmek demek değildir**.

---

## 6. CANONICAL DRIVER MODELİ

`public.fleet_drivers`

| Alan | Not |
|------|-----|
| `id` · `company_id` | Company-scoped; `company_id` **NOT NULL** |
| **`linked_user_id`** | **NULLABLE** — sürücünün CAROS hesabı olmak zorunda değil |
| `display_name` · `employee_code` | Boş ad reddedilir |
| `phone` · `license_number` · `license_class` · `license_expires_at` | **Hassas** — okuma RPC'si maskeler |
| `status` | `ACTIVE · INACTIVE · SUSPENDED · ARCHIVED` |
| `created_by` · `revision` · zaman damgaları | Denetim |

**Neden `linked_user_id` nullable:** şoförlerin çoğunun uygulamada hesabı
yoktur. Hesap zorunlu kılınsaydı gerçek sürücü kaydı **hiç
oluşturulamazdı** ve sistem kullanılmazdı.

| Kural | Uygulama |
|-------|----------|
| Aynı kullanıcı, aynı şirkette **tek** aktif profil | Kısmi UNIQUE index + RPC kontrolü (PG D4) |
| Aynı kişi **farklı şirketlerde** bağımsız profil | İzinli (index `company_id` kapsamlı) |
| **Hard delete YOK** | `ARCHIVED` — geçmiş trip attribution'ı kopmaz (PG D30, kilit G11) |
| Cross-company hesap bağı | **Reddedilir** + audit (PG D5) |
| `UNKNOWN_DRIVER` | Bir satır **değil**, sistem durumu |

---

## 7. ASSIGNMENT MODELİ

`public.vehicle_driver_assignments` — atama **anlık bir alan değil, zaman
aralığıdır**. `vehicles.driver_id` gibi tek alan kullanılsaydı "geçen salı
bu aracı kim kullandı?" sorusu cevaplanamazdı.

| Alan | Not |
|------|-----|
| `starts_at` · `ends_at` | UTC; `ends_at IS NULL` = açık uçlu aktif |
| `assignment_type` | `PRIMARY · TEMPORARY · MANUAL` — **P0'da üretilenler yalnız bunlar** |
| `source` | Sözleşmede 7 kaynak; **P0'da yalnız `FLEET_ADMIN` ÜRETİLİR** |
| `confidence` · `status` | `SCHEDULED · ACTIVE · COMPLETED · CANCELLED · CONFLICTED` |
| `created_by` · `revision` · `note` | Denetim |

**Enum şişirmesi yapılmadı:** `SHIFT` ve `AUTOMATIC_FUTURE` gerçek
üreticisi olmadığı için **eklenmedi**. `HEAD_UNIT_SELECT` / `NFC` /
`PHONE_HUB` sözleşmede geleceğe hazır durur ama **sahte üretilmez**.

---

## 8. ZAMAN ARALIĞI KURALLARI

- `ends_at < starts_at` **reddedilir** (CHECK + RPC, PG D7)
- Aralık mantığı **yarı-açık** `[starts_at, ends_at)`: bir atamanın bitişi
  diğerinin başlangıcına eşitse **çakışma değildir** (vardiya devri, PG D12)
- Vardiya devri **atomik**: `p_end_existing` ile eski atama kapanmadan yeni
  atama açılmaz
- Tüm hesap **UTC**; UI yerel saat gösterebilir
- Gelecekteki (`SCHEDULED`) veya bitmiş atama **"şu anki sürücü" değildir**
  (kilit C2, C3)

### Aynı sürücü iki araçta — ürün politikası

**Yasaklandı.** Bir kişi fiziksel olarak aynı anda iki araç süremez; izin
verilseydi trip attribution'ı belirsizleşirdi. İki katmanda zorlanır:
RPC'de aralık sorgusu + DB'de kısmi UNIQUE index (PG D13).

---

## 9. CONFLICT MODELİ

| Senaryo | Sonuç | Kanıt |
|---------|-------|-------|
| A. Aynı araçta iki sürücü | `CONFLICTED` + audit | PG D11 |
| B. Aynı sürücü iki araçta | `CONFLICTED` / index reddi | PG D13 |
| C. Trip sonrası geçmişe atama | Trip attribution **yeniden hesaplanmaz** (manuel yol var) | PG D34 |
| D. Araç şirket değiştirdi | Açık atamalar **kapanır** | PG D46 |
| E. Sürücü inactive oldu | Açık atamaları **kapanır**; yeni atama reddedilir | PG D14, D15 |
| F. Atama başka tenant'a ait | **Reddedilir** + audit | PG D8, D37, D38 |
| G. Atama trip'i kısmen kapsıyor | `MANUAL_REVIEW` / `CONFLICTED` — **kesin sürücü yazılmaz** | PG D22 |
| H. Offline çelişkili atama replay | Advisory lock + index; **son yazan kazanmaz** | PG D13, D31 |

**Sessiz "son yazan kazanır" yok.** Her çakışma `fleet_driver_audit`'e
yazılır ve RPC `CONFLICTED` döndürür.

### Yarış koruması

`btree_gist` + `EXCLUDE ... WITH &&` **kullanılmadı** — bu uzantı hedef
Supabase projesinde kurulu değil ve migration'ı uzantı kurma iznine bağlamak,
izin yoksa **tüm migration'ı düşürür**. Bunun yerine iki katman:

1. **Kısmi UNIQUE index** — açık uçlu ikinci atamayı kökten engeller
2. **`pg_advisory_xact_lock`** — kapalı aralık örtüşmesini serileştirir

---

## 10. TRIP ATTRIBUTION

`_resolve_trip_driver(vehicle, company, started_at, ended_at)`:

1. Trip'in `[started_at, ended_at]` aralığını al
2. **Aynı şirket + aynı araç** için kapsayan atamaları bul (tenant çift kontrolü)
3. Tek ve **tam kapsayan** atama → `ATTRIBUTED` · `ACTIVE_ASSIGNMENT` · `HIGH`
4. **Kısmi** kapsama → `MANUAL_REVIEW` (kesin sürücü **yazılmaz**)
5. Birden fazla → `CONFLICTED`
6. Hiç yok → `UNKNOWN`

### `VERY_HIGH` neden verilmiyor

Bir **yöneticinin ataması**, sürücünün gerçekten direksiyonda olduğunu
**kanıtlamaz** — yalnız planı gösterir. `VERY_HIGH` fiziksel kimlik kanıtı
(NFC kart, doğrulanmış head unit seçimi, telefon eşleşmesi) geldiğinde
verilebilir. Otomatik karar `HIGH`, manuel düzeltme `MEDIUM` ile sınırlı
(PG D19, D25 + kilit D8, D9).

### Neden trigger, neden `upload_vehicle_trip` içinde değil

Trip Metrics P2 az önce tamamlandı ve `upload_vehicle_trip`'in dedupe /
revizyon davranışı kilitli. O fonksiyonu değiştirmek P2 regresyon riski
taşırdı. `BEFORE INSERT OR UPDATE` trigger'ı ise:

- yükleme yolundan **bağımsız** çalışır (offline replay dahil),
- **trip zamanını** kullanır (replay zamanını değil),
- `DUPLICATE`'te UPDATE olmadığı için **tetiklenmez** → tekrar attribution yok.

**Asla yapılmayanlar** (PG D20, D21 + kilit G1): son giriş yapan kullanıcı,
vehicle owner ve fleet admin **fallback sürücü yapılmaz**. `_resolve_trip_driver`
gövdesinde `auth.uid()`, `owner_id` ve `profiles` **hiç geçmez** — kilit G1
bunu yapısal olarak doğrular.

---

## 11. TRIP BAŞLANGIÇ SNAPSHOT'I

`src/platform/fleet/driverAssignmentSnapshot.ts` (§16 sözleşmesi):

| Kural | Uygulama |
|-------|----------|
| Snapshot **immutable** | Trip boyunca sessizce değişmez |
| Hassas veri **yok** | Sunucu zaten ehliyet/telefon/e-posta göndermez |
| **Süresiz cache YOK** | `SNAPSHOT_MAX_AGE_MS = 12 sa` → aşılırsa `STALE` |
| Bayat snapshot | Sürücü **kanıtı değildir** → sunucuda `UNKNOWN` |
| Snapshot yoksa | `UNKNOWN` (uydurma yok) |
| Nihai hüküm | **Sunucuda** — kapanışta backend yeniden hesaplar |

**12 saat neden:** bir vardiyayı kapsayacak kadar uzun, atama değişikliğini
kaçırmayacak kadar kısa. Sınırsız cache, üç gün önce görevden alınmış bir
sürücünün bugünkü yolculuğa bağlanmasına yol açardı.

> **Bu zincir gerçek head unit'te HİÇ ÇALIŞTIRILMADI** →
> `headUnitDriverValidationVerdict: BLOCKED_REAL_DEVICE`.

---

## 12. MANUEL TRIP ATAMASI

`manually_assign_trip_driver(vehicle, trip_key, driver, reason)`

| Kural | Kanıt |
|-------|-------|
| Yalnız aynı şirketin **aktif** sürücüsü | PG D29 |
| **`trip_key` ve metrikler DEĞİŞMEZ** | PG D26 + kilit G12 (SET listesindeki her kolon `driver_` önekli) |
| Trip'in kendi `revision`'ı **değişmez** | PG D26 |
| Attribution revizyonu **artar** | PG D24 |
| Önceki sonuç **korunur** | `trip_driver_attribution_revisions` (PG D27) |
| Aynı atama tekrarı revizyon **artırmaz** | PG D28 |
| Güven otomatik `VERY_HIGH` **değil** → `MEDIUM` | PG D25 |
| Atamayı **yapan** ≠ **sürücü** | `driver_attributed_by` ile `driver_id` ayrı (PG D24) |
| Observer/member **yapamaz** | PG D36 |
| Cross-tenant **reddedilir** | PG D38 |
| Manuel sonuç replay ile **ezilmez** | PG D33 + kilit G3 |

---

## 13. YETKİLENDİRME

| İşlem | Yetki | Kanıt |
|-------|-------|-------|
| Sürücü oluştur/güncelle/arşivle | `admin` | PG D35 |
| Atama oluştur/bitir/iptal | `admin` | — |
| Trip sürücüsü düzelt | `admin` | PG D36 |
| Sürücü/atama **okuma** | Şirket üyeliği (observer dahil) | PG D48 |
| Tablolara **doğrudan yazma** | **Hiç kimse** — yalnız RPC | PG D52 |
| `anon` | **Hiçbir sürücü verisi** | PG D53 |
| Head unit (`anon` + api_key) | Yalnız kendi aracının **minimum özeti** | PG D43–D45, D54 |

Tüm RPC'ler `SECURITY DEFINER` + sabit `search_path`; yetki yardımcısı
bulunamazsa **NULL döner ve işlem reddedilir** (fail-closed).

---

## 14. GİZLİLİK

| Yüzey | Görünen |
|-------|---------|
| **Head unit** | `driverId` · `displayName` · durum · kaynak · güven · geçerlilik. **Ehliyet, telefon, e-posta, `employee_code`, kullanıcı kimliği YOK** (PG D44) |
| **Fleet admin** | Yönetim alanları; ehliyet **maskeli** (`•••1234`), telefon yalnız admin'e |
| **Observer / member** | Sürücü listesi, telefon **yok** |
| **CAROS LAB** | **Sürücü adı bile YOK** — yalnız `drv:a1b2c3d4` bounded referans |
| **Audit / loglar** | Tam ehliyet, telefon, e-posta, token, api_key **yazılmaz**; `reason` ≤ 280 karakter CHECK |

Head unit özeti iki kez denetlenir: fonksiyon gövdesinde hassas kolon
araması **(yorumlar temizlenerek)** + **canlı çağrı** ile dönen anahtar
kontrolü.

---

## 15. ARAÇ TRANSFERİ

**Mevcut transfer semantiği DEĞİŞTİRİLMEDİ.** `accept_vehicle_transfer`
RPC'sine dokunulmadı; bunun yerine `vehicles` üzerinde
`AFTER UPDATE OF company_id, owner_id` trigger'ı kuruldu — transfer hangi
yoldan yapılırsa yapılsın çalışır.

| Kural | Kanıt |
|-------|-------|
| Devirde açık atamalar **kapanır** | PG D46 |
| Eski şirketin sürücüsü yeni tenant'a **sızmaz** | PG D47 |
| Eski şirket sürücüsü yeni şirkette **otomatik sürücü olmaz** | Tasarım: atama company-scoped |
| Açık atama sessizce **taşınmaz** | Trigger + audit (`TRANSFER_ASSIGNMENTS_CLOSED`) |
| Trip geçmişi **korunur** | Devir öncesi trip'ler silinmez |
| Sürücü adı okuma RPC'sinde **tenant kontrollü** | `list_vehicle_trips` sürücü adını yalnız aynı şirketse döndürür |

---

## 16. OFFLINE / REPLAY

**Yeni offline mekanizma EKLENMEDİ.** Fleet Web çevrimdışı yazma yapmıyor;
atama işlemleri çevrimiçi RPC'dir (P0'da offline atama zorunlu değil).

Head unit trip upload replay'i için:

| Kural | Kanıt |
|-------|-------|
| **Trip zamanı** kullanılır, replay zamanı değil | Kilit G2 |
| 10× replay → **tek trip** | PG D32 |
| 10× replay → attribution revizyonu **şişmez** | PG D31 + kilit G4 |
| Atama sonradan değişse **eski trip yeni sürücüye bağlanmaz** | PG D34 |
| Manuel sonuç replay ile **ezilmez** | PG D33 |

---

## 17. BACKEND VE MIGRATION

`supabase/migrations/20260730000048_fleet_driver_identity_assignment_p0.sql`
— yalnız ileri; 033–047 **değiştirilmedi**.

**Tablolar:** `fleet_drivers` · `vehicle_driver_assignments` ·
`trip_driver_attribution_revisions` · `fleet_driver_audit`
**`vehicle_trips`**'e 8 attribution kolonu (hepsi **NULLABLE** — sürücüsü
bilinmeyen trip yazılabilmeli).

**RPC'ler:** `create_fleet_driver` · `update_fleet_driver` ·
`create_vehicle_driver_assignment` · `end_vehicle_driver_assignment` ·
`manually_assign_trip_driver` · `list_fleet_drivers` ·
`list_vehicle_driver_assignments` · `get_active_driver_assignment` (head unit)
+ yardımcılar `_fleet_driver_admin_company` · `_fleet_member_company` ·
`_resolve_trip_driver`

**Trigger'lar:** `trg_trip_attribution` · `trg_vehicle_transfer_assignments`

**`list_vehicle_trips` genişletildi:** sürücü alanları **sona** eklendi;
mevcut tüm P2 kolonları aynı sırada korundu → P2 tüketicileri bozulmadı.

### Fail-closed doğrulama — 047 dersinin uygulanması

047'de `public._trip_source()` **çağrılıyor ama tanımlı değildi**; plpgsql
geç bağlandığı için migration geçmiş, hata sahada ortaya çıkacaktı. Bu
yüzden 048'in doğrulama bloğu fonksiyonları **çağırır**:

```sql
PERFORM public._fleet_driver_admin_company();
SELECT * INTO r FROM public._resolve_trip_driver(...);
IF r.status <> 'UNKNOWN' THEN RAISE EXCEPTION ... END IF;
```

Ayrıca head unit RPC'si **gerçekten çağrılarak** kimlik doğrulaması sınanır.

> **Bu turda kendi denetimim bir yanlış alarm verdi:** `pg_get_functiondef`
> **yorumları da döndürür**; "employee_code ALAMAZ" açıklaması sızıntı
> sanıldı ve migration düştü. Denetim önce yorumları temizleyecek, sonra
> **davranışa** bakacak şekilde güçlendirildi. (P2'deki
> `speedVio·lat·ions` tuzağının aynısı — metin araması niyet kanıtı değildir.)

**İdempotency:** ikinci ve üçüncü uygulamada da `048 OK` + `048E OK`.

---

## 18. FLEET UI

**Yeni sayfa:** `/dashboard/fleet/drivers` — sürücü listesi, oluştur,
aktifleştir/pasifleştir/arşivle, ehliyet geçerliliği, aktif araç, son
yolculuk. Yönetim düğmeleri yalnız yetkili rolde görünür (sunucu ayrıca
zorlar).

**Araç detayı → Yolculuklar:** her yolculuk kartına **Sürücü** satırı +
`Sürücü kaynağı` (kaynak · güven · revizyon) eklendi; elle düzeltme
`elle` rozetiyle **gizlenmez**.

| Asla | Uygulama |
|------|----------|
| `null` → araç sahibi | Kilit D1, E2 |
| `null` → son kullanıcı | Kilit G1 (sunucu tarafında yapısal) |
| `UNKNOWN` → "Sürücü yok" | "Sürücü **bilinmiyor**" (kilit D2) |
| `CONFLICTED` → rastgele ilk sürücü | "Çakışma — birden fazla sürücü atanmış" (kilit D4) |
| Okunamadı → "sürücü yok" | Ayrı gösterilir (kilit A4) |
| Tam ehliyet numarası | **Hiç gelmez** (kilit B1, B3) |

---

## 19. HEAD UNIT

**Sürücü seçimi bilinçli olarak AÇILMADI.** Head unit `anon` rolünde
çalışır ve kullanıcı oturumu yoktur; güvenli kimlik doğrulama olmadan
serbest sürücü seçimi *"kim olduğunu iddia eden herkes o kişi sayılır"*
demektir ve attribution'ı **kanıt olmaktan çıkarır**.

Bunun yerine: Fleet tarafından oluşturulan aktif atamanın **salt-okunur
minimum özeti** (`get_active_driver_assignment`). Tüm sürücü listesi
`api_key` ile **çekilemez**; ehliyet/telefon **alınamaz**.

---

## 20. CAROS LAB

**Yeni araç:** `fleet-driver-identity` (kategori `vehicle`, `AVAILABLE`).

Gösterilenler: `activeAssignmentStatus` · `activeDriverRef` ·
`activeAssignmentRef` · `assignmentSource` · `assignmentConfidence` ·
`assignmentRevision` · `assignmentAge` · `snapshotFreshness` ·
`maxSnapshotAge` · `unknownReason` · `captureCount` · `lastCaptureAge` ·
`lastCaptureFailure` · `validFromAge` · `validUntil` + zincir durumu
(head unit seçimi **KAPALI**, phone hub/NFC **BAĞLI DEĞİL**,
`realDeviceValidation: BLOCKED_REAL_DEVICE`).

**Kişisel veri export edilmez:** sürücü **adı bile gösterilmez** — yalnız
`drv:a1b2c3d4`. Aktif komut yok, timer yok, ağ çağrısı yok (kilit D1–D4).

---

## 21. AUDIT

`public.fleet_driver_audit` — 12 eylem türü: sürücü oluşturma/güncelleme/
pasifleştirme/arşivleme · atama oluşturma/bitirme/iptal · çakışma · trip
sürücüsü manuel atama/düzeltme · **cross-tenant reddi** · transfer kaynaklı
atama kapanışı.

Kayıt: `actor_user_id` · `company_id` · `action` · `entity_type/id` ·
`previous_revision` → `new_revision` · `created_at` · **sınırlı** `reason`
(≤ 280 karakter CHECK). Hassas alanların tam değerleri **yazılmaz**.

Attribution değişiklikleri ayrıca `trip_driver_attribution_revisions`
tablosunda tam geçmişle korunur (önceki ve yeni sürücü, önceki ve yeni
durum, kaynak, güven, aktör, gerekçe).

---

## 22. GERÇEK POSTGRESQL KANITI — **54 kontrol**

Yerel Supabase `supabase_db_fleetval`; gerçek RLS, gerçek `auth.uid()`
oturumları, RPC'ler **çağrılarak**.
Script: `supabase/verification/local_048_driver_identity_assignment.sql`

```
A. DRIVER PROFILE          D1–D6    (6/6 PASS)
B. ASSIGNMENT              D7–D17  (11/11 PASS)
C. TRIP ATTRIBUTION        D18–D30 (13/13 PASS)
D. REPLAY                  D31–D34  (4/4 PASS)
E. YETKİ / CROSS-TENANT    D35–D39  (5/5 PASS)
F. HEAD UNIT               D41–D45  (5/5 PASS)
G. ARAÇ DEVRİ              D46–D47  (2/2 PASS)
H. RLS / İZİN / REGRESYON  D48–D55  (8/8 PASS)
```

Öne çıkanlar:

```
D3   AUTH USER otomatik SURUCU DEGIL                     PASS
D13  ikinci ACIK UCLU atama DB kisitiyla REDDEDILDI      PASS
D20  ATAMASIZ trip -> UNKNOWN (surucu UYDURULMADI)       PASS
D21  owner/admin/son-kullanici FALLBACK YAPILMADI        PASS
D22  KISMI kapsama -> kesin surucu YAZILMADI             PASS
D26  manuel atama trip_key/metrik/revision BOZMADI       PASS
D31  10x REPLAY attribution revizyonunu SISIRMEDI        PASS
D34  atama kapansa da ESKI trip d1 de kaldi              PASS
D44  head unit ozetinde HASSAS ALAN YOK                  PASS
D47  devir sonrasi ESKI atamalar yeni tenant a SIZMADI   PASS
D55  TRIP METRICS P2 regresyonu KORUNDU                  PASS
```

**Migration idempotence:** 2. ve 3. uygulamada da `048 OK` + `048E OK`.

---

## 23. TEST SONUÇLARI

| Dosya | Adet | Kapsam |
|-------|------|--------|
| `website/src/__tests__/driverIdentityAssignment.test.ts` | **50** | Kimlik ayrımı · gizlilik · zaman aralığı · attribution fallback yasağı · trip zinciri · ehliyet · **15 migration sözleşme kilidi** · hata mesajları |
| `src/__tests__/driverAssignmentSnapshot.test.ts` | **20** | Snapshot ayrıştırma · tazelik/yaş sınırı · sözleşme sınırları · LAB yüzeyi |

**Toplam 70 yeni kilit.**

### İki test kusurumu ayırdım (ürün kusuru olarak raporlamadım)

- `G12`: `UPDATE`'ten sonrasının tamamı alınınca `WHERE … trip_key = …`
  koşulu "trip_key yazılıyor" sanıldı. Kilit **SET listesiyle** sınırlandı
  ve güçlendirildi (artık yazılan her kolonun `driver_` önekli olduğunu
  doğruluyor).
- `D2` (snapshot): serbest `phone` araması **`phoneHubDriverSource`** durum
  etiketini yakaladı. Kilit alan **erişimini** hedefleyecek şekilde daraltıldı.

Her ikisi de aynı sınıf hata: **metin araması niyet kanıtı değildir.**

---

## 24. REGRESYON SONUÇLARI

| Kapı | Sonuç |
|------|-------|
| Kök `vitest` | **9 211 / 9 212** — 1 test **timeout** (aşağıda) |
| `website` `vitest` | **842 / 842 PASS** (40 dosya) |
| Kök `tsc -b` | **TEMİZ** |
| `website` `tsc --noEmit` | **TEMİZ** |
| `npm run build` | **GEÇTİ** (4 dk 12 sn) |
| Migration 048 idempotency | `048 OK` + `048E OK` (3. uygulamada da) |
| **Trip Metrics P2** | **PRESERVED** — dedupe · `_trip_source` · metrik kolonları (PG D55) |
| Fleet Connectivity P0 · Vehicle Identity P1 · Location Engine P1 · Trip Engine P1 | **PRESERVED** |
| Offline Queue · Transfer · Realtime | **PRESERVED** — dokunulmadı |
| Secret scan (bu paketin dosyaları) | **TEMİZ** |
| Music Hub changed-file scan | **DOKUNULMADI** (değişiklikler paralel iş akışından) |
| AccountCleanup attribution | **DOKUNULMADI** |

### 🟡 Düşen tek test — bu paketin kusuru DEĞİL

```
regression.guards.test.ts > K24 CAN-flood perf düzeltmesi
  × DAVRANIŞ: _hasAnyField boş objede false döner
    Error: Test timed out in 5000ms.
```

**Assertion hatası değil, `await import('../platform/vehicleDataLayer')`
çağrısının 5 sn'lik test zaman aşımını geçmesi.** Üç bağımsız kanıt bunun
bu paketten kaynaklanmadığını gösteriyor:

1. **Test dosyası değişmedi** — `git status src/__tests__/regression.guards.test.ts`
   boş; dosya HEAD'deki hâlinde.
2. **Bağımlılık eklenmedi** — `src/platform/vehicleDataLayer/` altında bu
   paketin hiçbir dosyasına (`carosLabCatalog`, `carosLabScreenMap`,
   `driverAssignmentSnapshot`, `FleetDriverIdentityScreen`) referans yok.
3. **Mantık doğru** — `--testTimeout=20000` ile aynı test **159/159 PASS**;
   yalnız modül yükleme süresi sınırı aşılıyor (transform ~6,5 sn).

**Düzeltme (Presence P1 turunda netleşti):** bu satır ilk yazıldığında
"kalıcı" denmişti; sonraki ölçümler durumu netleştirdi — test **makine
yüküne duyarlı**. Tek başına koşulduğunda **159/159 PASS** (5,1 sn);
yalnız tam paketle veya build ile paralel koşarken 5 sn sınırını aşıyor.
Yani kalıcı bir bozulma değil, **yük altında ortaya çıkan** bir zaman aşımı.

**Regresyon kasasına DOKUNULMADI.** `CLAUDE.md` bu dosyadaki kilitlerin
zayıflatılmasını yasaklıyor; timeout değeri davranışı değiştirmese de bu
paketin kapsamı dışında ve başka bir iş akışını etkileyebilir. Karar
kullanıcıya bırakıldı — açık borç **E10**.

---

## 25. GERÇEK CİHAZ DURUMU

### `realVehicleValidationVerdict: BLOCKED_REAL_VEHICLE`
### `headUnitDriverValidationVerdict: BLOCKED_REAL_DEVICE`

§22'deki 12 adımın **hiçbiri** gerçek araç/head unit'te koşulmadı:
sürücü oluşturup atama yapıldıktan sonra head unit'in aktif atamayı
alması, gerçek trip'in sürücüye bağlanması, internetsiz trip + reconnect
sonrası tek attribution, atama değişiminin yeni trip'e yansıması, eski
trip'in sessizce değişmemesi ve observer'ın gerçek oturumla
değiştirememesi — **ölçülmedi**.

**Simülasyon saha kanıtı olarak sunulmuyor.** Kütüğe 🔴 **#226–#232**
olarak, ölçülebilir kabul ölçütleriyle eklendi.

---

## 26. DEĞİŞEN DOSYALAR

**Yeni:**
`supabase/migrations/20260730000048_fleet_driver_identity_assignment_p0.sql` ·
`supabase/verification/local_048_driver_identity_assignment.sql` ·
`website/src/lib/fleet/driverIdentity.ts` ·
`website/src/lib/fleet/drivers.service.ts` ·
`website/src/app/dashboard/fleet/drivers/page.tsx` ·
`src/platform/fleet/driverAssignmentSnapshot.ts` ·
`src/components/devtools/screens/FleetDriverIdentityScreen.tsx` ·
`website/src/__tests__/driverIdentityAssignment.test.ts` ·
`src/__tests__/driverAssignmentSnapshot.test.ts` ·
`docs/FLEET_DRIVER_IDENTITY_ASSIGNMENT_P0_REPORT.md`

**Değiştirilen:**
`website/src/lib/fleet/vehicleTripsView.ts` (sürücü alanları) ·
`website/src/components/dashboard/VehicleModal.tsx` (sürücü satırı) ·
`src/platform/devtools/carosLabCatalog.ts` (yeni araç) ·
`src/components/devtools/carosLabScreenMap.tsx` (lazy kayıt) ·
`docs/DEVICE_VALIDATION_LEDGER.md` · `docs/CAROS_PRO_VIZYONU.md`

---

## 27. DOKUNULMAYAN ALANLAR

- **Supabase auth ve `profiles`** — yeni auth sistemi kurulmadı, rol
  CHECK'i değiştirilmedi (**driver rolü eklenmedi** — sürücü bir rol değil,
  bir kayıttır)
- **`vehicles.driver_name`** — eski etiket kolonu **değiştirilmedi**
- **Transfer semantiği** — `accept_vehicle_transfer` gövdesine dokunulmadı
- **`upload_vehicle_trip`** — P2 dedupe/revizyon davranışı korunmak için
  değiştirilmedi (attribution trigger ile çözüldü)
- **Vehicle Registration · Pairing · Ownership · Realtime · Offline Queue ·
  Vehicle Identity · Location Engine · Trip Engine · Trip Metrics P2**
- **Music Hub** ve **AccountCleanup** — dosyalarına dokunulmadı

---

## 28. AÇIK BORÇLAR

| # | Borç | Neden |
|---|------|-------|
| **E1** | **Gerçek araç + head unit doğrulaması** (#226–#232 🔴) | Cihazda koşulmadı |
| **E2** | **Head unit sürücü seçimi** | Güvenli kimlik doğrulama yok; açmak attribution'ı kanıt olmaktan çıkarırdı. NFC/BLE/telefon kimliği ayrı paket |
| **E3** | **`VERY_HIGH` attribution** | Fiziksel kimlik kanıtı kaynağı yok (E2'ye bağlı) |
| **E4** | **Bireysel araçlar kapsam dışı** | `owner_id` XOR `company_id`; sürücü modeli company-scoped. Bireysel sahip için attribution `UNKNOWN` kalır |
| **E5** | **Fleet UI'da araca atama yapma ekranı** | Sürücü CRUD + trip gösterimi yapıldı; araç detayındaki "ata / atamayı bitir" düğmeleri sonraki tur |
| **E6** | **Offline atama** | Fleet Web çevrimdışı yazma yapmıyor; yeni mekanizma eklenmedi (P0'da zorunlu değil) |
| **E7** | **`vehicles.driver_name` göçü** | Eski etiket hâlâ UI'da; sürücü kayıtlarına göç ayrı ve dikkatli bir tur |
| **E8** | **Migration 040–048 hiçbir ortama uygulanmadı** | `db push` yasak |
| **E9** | **`website` production build'i düşüyor** | Kütük F5 — paralel iş akışının sahipliğinde |
| **E10** | **`regression.guards` içindeki bir kilit 5 sn timeout'una takılıyor** | Bu paketin kusuru değil (§24'te üç kanıtla gösterildi); regresyon kasasına izinsiz dokunulmadı. Öneri: o testin `await import` çağrısına yerel `testTimeout` verilmesi — kilit davranışı değişmez |

---

## 29. SONRAKİ ÖNERİLEN PAKET

**FLEET DRIVER ASSIGNMENT UI + HEAD UNIT IDENTITY P1**

1. Araç detayında **atama yönetimi** (ata · vardiya devri · bitir · çakışma
   çözümü) — backend hazır, yalnız yüzey eksik (E5)
2. **Fiziksel sürücü kimliği**: NFC kart veya doğrulanmış telefon eşleşmesi
   → `VERY_HIGH` attribution mümkün hâle gelir (E2, E3)
3. **Gerçek araç doğrulaması** — §22'nin 12 adımı

Driver DNA'ya geçmeden önce **E1 kapanmalıdır**: sürücü verisi sahada
doğrulanmadan üzerine davranış profili kurmak, yanlış kişiye yanlış profil
çıkarma riski taşır.

---

## DÜRÜSTLÜK BEYANI

Bu rapordaki her PASS **yerel** kanıttır: 70 kilit, iki `tsc`, gerçek build
ve **54 gerçek-PostgreSQL** doğrulaması (owner · member · observer ·
cross-tenant · anon deny · devir · replay · çakışma · RLS dahil).

**Gerçek araçta ve gerçek head unit'te hiçbir şey doğrulanmadı** →
`BLOCKED_REAL_VEHICLE` + `BLOCKED_REAL_DEVICE`. Kütükte 🔴 bekleyen yedi
madde "çalışıyor" olarak sunulmuyor.

Bu paketin ürettiği en önemli şey bir özellik değil, bir **sınır**:
sürücü kanıtlanamadığında sistem **susmayı ve `UNKNOWN` demeyi** seçer.
Araç sahibini, yöneticiyi veya son giriş yapan kişiyi sürücü saymak
kolay olurdu ve tablo "dolu" görünürdü — ama Driver DNA o veriyle
eğitilseydi **yanlış kişiyi yanlış davranışla** kalıcı olarak
ilişkilendirirdi.
