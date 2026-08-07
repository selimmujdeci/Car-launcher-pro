# CAROS PRO — DRIVER PRESENCE P1 RAPORU

**Tarih:** 2026-07-30
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Driver Identity P0 üzerine **Presence katmanı** — yalnız güvenli
mimari ve sözleşme.
**NFC / Bluetooth implementasyonu:** **YAPILMADI** (kapsam gereği)
**Commit / push / deploy / db push:** YAPILMADI

---

## 1. NİHAİ KARAR

### **`COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `driverIdentityP0RegressionVerdict` | **`PRESERVED`** |
| `realDeviceValidationVerdict` | **`BLOCKED_REAL_DEVICE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

Gerçek NFC/Bluetooth donanımı yok, gerçek head unit'te hiçbir gözlem
üretilmedi → saha doğrulaması **`BLOCKED_REAL_DEVICE`**.

---

## 2. PRESENCE NEDİR — ASSIGNMENT'TAN FARKI

| | Assignment (P0) | **Presence (P1)** |
|---|---|---|
| Doğası | **PLAN** — "bu araca bu sürücü atandı" | **GÖZLEM** — "şu anda bu kişinin araçta olduğuna dair fiziksel işaret var" |
| Kaynağı | Filo yöneticisi | NFC kart, eşleştirilmiş cihaz |
| Kanıtladığı | Kimin sürmesi *planlandığı* | Kimin *gerçekten* orada olduğu |
| En yüksek güven | `HIGH` | **`VERY_HIGH`** |

P0'ın bilinçli sınırı şuydu: *bir yöneticinin ataması, sürücünün gerçekten
direksiyonda olduğunu **kanıtlamaz*** — bu yüzden `VERY_HIGH` verilmiyordu.
Presence tam bu boşluğu doldurur ve `VERY_HIGH`'ı ilk kez mümkün kılar.

---

## 3. CANONICAL MODEL

`src/platform/fleet/driverPresence.ts` (saf: I/O · timer · `Date.now()` yok)

```ts
interface DriverPresence {
  source:       PresenceSource;      // UNKNOWN·HEAD_UNIT·PHONE·BLUETOOTH·NFC
  confidence:   PresenceConfidence;  // VERY_HIGH·HIGH·MEDIUM·LOW·UNKNOWN
  detectedAt:   number | null;
  expiresAt:    number | null;
  driverId:     string | null;
  assignmentId: string | null;
}
```

**Kişisel veri taşımaz** — ad, ehliyet, telefon, e-posta yok (kilit A4).
Sürücüsüz veya kaynağı tanınmayan gözlem **presence sayılmaz** (kilit A5).
Süre verilmezse varsayılan TTL uygulanır — **süresiz presence yok** (A6).

---

## 4. KAYNAK GÜVENİLİRLİĞİ — en kritik güvenlik kararı

| Kaynak | Kimlik doğrular mı | Güven tavanı |
|--------|--------------------|--------------|
| `NFC` | ✅ | `VERY_HIGH` |
| `BLUETOOTH` | ✅ | `HIGH` |
| `PHONE` | ❌ | `MEDIUM` |
| **`HEAD_UNIT`** | ❌ | `LOW` |
| `UNKNOWN` | ❌ | `UNKNOWN` |

### `HEAD_UNIT` neden kanıt sayılmıyor

Head unit `anon` rolünde çalışır ve **kullanıcı oturumu yoktur**. P0'da
head unit'te serbest sürücü seçimi bilinçli olarak kapatıldı — çünkü
*"kim olduğunu iddia eden herkes o kişi sayılır"* demek, attribution'ı
kanıt olmaktan çıkarır.

**Presence katmanı o kararı arkadan dolanmamalıdır.** Head unit'ten gelen
bir gözlem taşınabilir ve LAB'da görünür, ama **sürücü kanıtı sayılmaz**;
attribution onu yok sayıp P0 atama modeline döner (PG P4, kilit B1, D2).

`PHONE` de listede değil: telefon eşleşmesi bu pakette doğrulanmış değil
(Phone Hub cihazda hiç çalışmadı). Gerçek doğrulama geldiğinde listeye
eklenir — **sözleşme değişmez**.

### İstemci kendi güvenini yükseltemez

Bildirilen güven, kaynağın tavanını **aşamaz**. Head unit `VERY_HIGH`
iddia etse bile sonuç `LOW`'a düşer (kilit B4, PG P5). Bu, P0'daki
"güven sunucuda üretilir" ilkesinin devamıdır.

---

## 5. PRESENCE RESOLVER — TEK OTORİTE

Karar sırası (hem TS hem PostgreSQL'de **aynı**):

| # | Koşul | Karar | Kullanılır mı |
|---|-------|-------|---------------|
| 1 | Gözlem yok | `NO_PRESENCE` | ❌ → **P0 modeli çalışır** |
| 2 | Kaynak kimlik doğrulamıyor | `PRESENCE_UNUSABLE` | ❌ → P0 modeli |
| 3 | Süresi geçmiş / gelecek tarihli | `PRESENCE_UNUSABLE` | ❌ → P0 modeli |
| 4 | Sürücü uygun değil (pasif/tenant) | `PRESENCE_UNUSABLE` | ❌ → P0 modeli |
| 5 | Presence ≠ atama | **`PRESENCE_CONFLICT`** | ❌ → `CONFLICTED` |
| 6 | Presence = atama | **`PRESENCE_CONFIRMED`** | ✅ `VERY_HIGH` mümkün |
| 7 | Atama yok, kanıt var | `PRESENCE_ONLY` | ✅ güven `HIGH` ile sınırlı |

### Çelişki neden kullanılmıyor

NFC kartı Ahmet okutmuş ama araca Mehmet atanmışsa hangisinin doğru
olduğunu **bilemeyiz**: kart ödünç verilmiş de olabilir, atama
güncellenmemiş de. Birini seçmek **uydurma** olurdu → `CONFLICTED`,
sürücü yazılmaz, insan incelemesi gerekir (PG P7, P12 · kilit D5).

### `PRESENCE_ONLY` neden `VERY_HIGH` almıyor

Fiziksel kanıt var ama **plan desteği yok**. İki bağımsız kaynağın
(plan + gözlem) aynı kişiyi göstermesi, tek kaynaktan güçlüdür — bu
yüzden atamasız kanıt `HIGH` ile sınırlanır (PG P13, P14 · kilit D7).

---

## 6. ATTRIBUTION ENTEGRASYONU — P0 BOZULMADI

Presence, P0'ı **değiştirmez; üstüne biner**:

```
trip kapanışı
   ├─ (a) P0: _resolve_trip_driver(...)      ← DEĞİŞMEDİ
   ├─ (b) P1: _resolve_driver_presence(...)  ← YENİ
   └─ karar:
        presence kullanılabilir  → presence sonucu (güven yükselebilir)
        presence çelişkili       → CONFLICTED (fail-closed)
        presence yok/kullanılamaz→ **P0 sonucu AYNEN**
```

**En kritik kanıt:** presence yokken P0 attribution'ı bit bit aynı çalışır
— `ATTRIBUTED` · `ACTIVE_ASSIGNMENT` · `HIGH` (PG P1). Atamasız trip yine
`UNKNOWN` kalır; fallback sürücü üretilmez (PG P3).

Manuel/kilitli sonuç presence tarafından da **ezilmez** (PG P15).
10× replay attribution revizyonunu **şişirmez** (PG P16).

---

## 7. BACKEND — MIGRATION 049

`supabase/migrations/20260730000049_driver_presence_p1.sql` — yalnız ileri;
033–048 değiştirilmedi.

- **`vehicle_driver_presence`** — append-only gözlem kaydı; trip attribution
  trip **zamanını** kapsayan gözlemi arar (replay zamanını değil)
- **`vehicle_trips`** + 3 kolon: `driver_presence_id` ·
  `driver_presence_source` · `driver_presence_decision` (hepsi nullable)
- Yardımcılar: `_presence_is_identity_verifying` ·
  `_presence_source_ceiling` · `_presence_weakest`
- **`_resolve_driver_presence`** — sunucu tarafı tek otorite
- `_trip_attribution_trigger` genişletildi (P0 çağrısı **korundu**)

**Kısıtlar:** `expires_at > detected_at` · **en fazla 24 saat TTL**
(sınırsız presence yok) · kaynak ve güven enum'ları · RLS + `anon` deny +
`authenticated` **doğrudan yazamaz**.

**Doğrulama fonksiyonları ÇAĞRILARAK sınanır** (047 dersi): gözlem yokken
`NO_PRESENCE` dönmediği anda migration düşer.

**İdempotency:** ikinci uygulamada da `049 OK`.

### Üretimde presence yazan yol YOK

Bilinçli: `record_driver_presence` gibi bir RPC **oluşturulmadı** (PG P19).
Gözlem üretilmediği sürece attribution P0'daki gibi davranır — bu, katmanın
güvenlik tasarımının parçasıdır, eksiklik değil.

---

## 8. CAROS LAB

`FleetDriverIdentityScreen` → **Driver Presence (P1)** bölümü:

`activeSource` · `confidence` · `age` · `expired` · `lastUpdate` ·
`presenceDriverRef` · `observationCount` · `rejectedObservations` ·
`identityVerifyingSource` + zincir durumunda `presenceContract: HAZIR
(üretici yok)`.

**Kişisel veri yok** — sürücü adı bile gösterilmez, yalnız
`drv:a1b2c3d4`. LAB gözlem **üretmez**, yalnız okur (kilit F1–F3).

---

## 9. GERÇEK POSTGRESQL KANITI

### 049 — Presence: **19/19 PASS**

```
P1   PRESENCE YOKKEN P0 attribution AYNEN calisti          PASS
P2   presence karari NO_PRESENCE olarak kaydedildi         PASS
P3   UNKNOWN fail-closed KORUNDU (fallback yok)            PASS
P4   HEAD_UNIT gozlemi KANIT SAYILMADI                     PASS
P5   HEAD_UNIT guven tavani LOW (istemci yukseltemez)      PASS
P6   NFC + atama uyumlu -> VERY_HIGH (P0 da imkansizdi)    PASS
P7   presence != atama -> CONFLICTED, surucu YAZILMADI     PASS
P8   SURESI GECMIS gozlem kanit degil -> P0 modeline dondu PASS
P9   SINIRSIZ TTL reddedildi (en fazla 24 sa)              PASS
P10  ters aralik (expires < detected) REDDEDILDI           PASS
P11  PASIF surucunun karti kanit sayilmadi                 PASS
P12  IKI FARKLI surucu gozlemi -> CONFLICTED               PASS
P13  ATAMASIZ fiziksel kanit -> PRESENCE_ONLY, guven HIGH  PASS
P14  plan destegi yokken VERY_HIGH VERILMEDI               PASS
P15  MANUEL sonuc presence tarafindan EZILMEDI             PASS
P16  10x REPLAY presence revizyonunu SISIRMEDI             PASS
P17  ANON okuyamaz · authenticated DOGRUDAN yazamaz        PASS
P18  B admini A presence kayitlarini GOREMIYOR (RLS)       PASS
P19  presence YAZAN RPC YOK                                PASS
```

### 048 — Driver Identity P0 regresyonu: **54/54 PASS**

049 uygulandıktan **sonra** P0'ın tüm doğrulaması yeniden koşuldu ve
tamamı geçti → `driverIdentityP0RegressionVerdict: PRESERVED`.

---

## 10. TEST SONUÇLARI

| Dosya | Adet |
|-------|------|
| `src/__tests__/driverPresence.test.ts` | **45** (yeni) |

Kapsam: sözleşme · kaynak güvenilirliği · geçerlilik/TTL · resolver'ın
yedi kararı · depo · LAB yüzeyi · **9 migration sözleşme kilidi** · etiketler.

### Regresyon

| Kapı | Sonuç |
|------|-------|
| Kök `vitest` | **9 256 / 9 257** — 1 test yük altında timeout (aşağıda) |
| `website` `vitest` | **842 / 842 PASS** |
| Kök `tsc -b` | **TEMİZ** |
| `website` `tsc --noEmit` | **TEMİZ** |
| `npm run build` | **GEÇTİ** (1 dk 16 sn) |
| Migration 049 idempotency | `049 OK` (2. uygulamada da) |
| **Driver Identity P0** | **PRESERVED** (54/54 PG) |
| Trip Metrics P2 · Fleet P0/P1 · Location · Realtime · Offline Queue | **PRESERVED** |
| Music Hub · AccountCleanup | **DOKUNULMADI** |

### 🟡 Düşen tek test — bu paketin kusuru değil (P0 raporu §24 · borç E10)

`regression.guards.test.ts` içindeki `_hasAnyField` kilidi
`await import('../platform/vehicleDataLayer')` çağrısında 5 sn'lik test
zaman aşımını aşıyor. **Assertion hatası değil.**

Bu turda durum netleşti: test **makine yüküne duyarlıdır** —
- tek başına: **159 / 159 PASS** (5,1 sn)
- tam paketle paralel: timeout

Test dosyası bu iki pakette de **değiştirilmedi** ve `vehicleDataLayer`
grafiği bu paketlerin hiçbir dosyasını çekmiyor. Regresyon kasasına
izinsiz dokunulmadı (`CLAUDE.md` kilitlerin zayıflatılmasını yasaklıyor);
öneri, o testin `await import` çağrısına yerel bir `testTimeout` verilmesi
— kilit davranışı değişmez.

### Üç test kusurumu ayırdım (ürün kusuru olarak raporlamadım)

1. **PG P16** — replay ölçümü, önceki senaryoların meşru geçişinden hemen
   sonra yapıldığı için ilk döngüdeki gerçek değişimi "şişme" sandı.
   Ölçüm, sonuç **sabitlendikten sonra** yapılacak şekilde düzeltildi.
2. **Kilit E6** — `Date.now()` araması dosyanın kendi başlığındaki
   *"SAF: `Date.now()` YOK"* yorumunu yakaladı. Kilit yorumları eleyip
   **kodu** inceleyecek şekilde düzeltildi.
3. **`website` tsc** — P0 testine eklediğim `matchAll` yayılımı website'in
   derleme hedefiyle uyumsuzdu. **Vitest yeşil geçmişti** (transpile ediyor),
   hatayı yalnız `tsc` yakaladı → satır taramasına çevrildi.

Üçü de aynı sınıf: **metin araması niyet kanıtı değildir** ve **tek bir
yeşil kapı yeterli değildir**.

---

## 11. GERÇEK CİHAZ DURUMU

### `realDeviceValidationVerdict: BLOCKED_REAL_DEVICE`

Ölçülmedi: gerçek NFC kart okuması, gerçek Bluetooth eşleşmesi, head
unit'te gözlem üretimi, gerçek araçta presence'lı yolculuk, çevrimdışı
gözlem replay'i.

**Bu paket zaten gerçek kaynak uygulamıyor** — sözleşme ve karar zinciri
kuruldu, üretici bağlanmadı. Simülasyon saha kanıtı olarak sunulmuyor.

Kütüğe 🔴 **#233–#235** eklendi.

---

## 12. DEĞİŞEN DOSYALAR

**Yeni:** `src/platform/fleet/driverPresence.ts` ·
`supabase/migrations/20260730000049_driver_presence_p1.sql` ·
`supabase/verification/local_049_driver_presence.sql` ·
`src/__tests__/driverPresence.test.ts` · bu rapor

**Değiştirilen:** `src/components/devtools/screens/FleetDriverIdentityScreen.tsx`
(Presence bölümü) · `website/src/__tests__/driverIdentityAssignment.test.ts`
(tsc uyumu) · kütük · vizyon

**Dokunulmayan:** P0'ın `_resolve_trip_driver`'ı · `fleet_drivers` ·
`vehicle_driver_assignments` · `upload_vehicle_trip` · Trip Metrics P2 ·
Music Hub · AccountCleanup

---

## 13. AÇIK BORÇLAR

| # | Borç |
|---|------|
| **F1** | **NFC okuyucu implementasyonu** — donanım + native köprü + `record()` çağrısı |
| **F2** | **Bluetooth eşleşme doğrulaması** — hangi cihazın hangi sürücüye ait olduğunun güvenli kaydı |
| **F3** | **Presence yazma RPC'si** — gerçek kaynak gelince (`anon` erişimi çok dikkatli tasarlanmalı: head unit'in gözlem yazması, kaynağın *cihaz tarafından doğrulandığını* kanıtlamasını gerektirir) |
| **F4** | **Gerçek cihaz doğrulaması** (#233–#235 🔴) |
| **F5** | **Fleet UI'da presence gösterimi** — trip detayında "NFC ile doğrulandı" rozeti; bu turda yalnız LAB yüzeyi yapıldı |
| **F6** | 040–049 hiçbir ortama uygulanmadı |

---

## 14. DÜRÜSTLÜK BEYANI

Bu paketin ürettiği şey bir özellik değil, bir **hazırlık ve sınır**:

- Presence sözleşmesi ve tek otoriteli resolver **hazır**.
- Gözlem üreten **hiçbir yol yok** — ve bu bilinçli.
- Bu yüzden bugün attribution davranışı **P0'daki gibi**, bit bit aynı
  (PG P1 ile kanıtlı).

En önemli tasarım kararı, katmanın **ne yapmadığıdır**: head unit'ten
gelen bir "ben Ahmet'im" beyanı, NFC kartın fiziksel okunmasıyla aynı
ağırlıkta sayılmadı. Bunu yapmak kolay olurdu ve `VERY_HIGH` sonuçlar
hemen görünürdü — ama o an sürücü ataması bir **kanıt** olmaktan çıkıp
bir **iddia** hâline gelirdi.
