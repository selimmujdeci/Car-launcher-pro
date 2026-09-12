# CAROS PRO — DRIVER AUTHENTICATION P1 RAPORU

**Tarih:** 2026-07-31
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Gerçek sürücü doğrulama altyapısının **sözleşmesi ve tek otoritesi**.
**NFC / PHONE / BLUETOOTH / PIN entegrasyonu:** **YAPILMADI** (görev gereği)
**Presence resolver:** **DEĞİŞTİRİLMEDİ**
**P0 atama modeli:** **DEĞİŞTİRİLMEDİ**
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `driverPresenceRegressionVerdict` | **`PRESERVED`** |
| `driverHistoryRegressionVerdict` | **`PRESERVED`** |
| `driverAuthenticationRegressionVerdict` | **`ESTABLISHED`** (yeni katman — 30/30 PG + 42 TS kilidi) |
| `realDeviceValidationVerdict` | **`BLOCKED_REAL_DEVICE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

Doğrulama ÜRETEN gerçek bir kaynak (NFC/PIN/BT/telefon) yok; tablo ve depo
gerçek veriyle **hiç dolmadı**, gerçek head unit'te **hiç koşmadı**.
Kanıtsız `PASS` verilmedi.

---

## 2. ⚠️ POLİTİKA DEĞİŞİKLİĞİ — AÇIKÇA BİLDİRİLİR

Görevin 5. maddesi (*"Presence tek başına VERY_HIGH üretemeyecek"*), **049'da
kilitlenmiş bir davranışla doğrudan çelişiyordu**:

| | Önce (049 P6) | Sonra (052) |
|---|---|---|
| NFC presence + uyumlu atama | `VERY_HIGH` | **`HIGH`** |
| NFC presence + atama + **doğrulama** | (mümkün değildi) | **`VERY_HIGH`** |

**Neden doğru olan yeni davranış:** bir NFC kartın okunması **kartı** kanıtlar,
**kişiyi** değil — kart ödünç verilebilir, kopyalanabilir, çalınabilir.
"Kart = kişi" varsayımı bir kimlik doğrulaması değildi.

**Kilit KALDIRILMADI, taşındı** (`AI.md` / regresyon kasası kuralı):

- `local_049_driver_presence.sql` **P6** yeni doğru davranışı kilitler
  (`ATTRIBUTED` + kimliksiz tavan `HIGH`, presence kararı hâlâ
  `PRESENCE_CONFIRMED`).
- **P6b** yeni bir kilittir: *"kimlik doğrulanmadan `VERY_HIGH` VERİLMEZ"*.
- Pozitif `VERY_HIGH` senaryosu `local_052_…` **T5**'te kilitlidir.

Bu değişiklik **yalnız kompozisyon katmanındadır** (`_trip_attribution_trigger`);
`_resolve_driver_presence` ve `_resolve_trip_driver` tek satır değişmedi ve
presence otoritesinin kendi çıktısı (`PRESENCE_CONFIRMED` + kendi güveni)
**bit bit aynıdır** (TS `C1` ve PG `R2` kilitleri).

---

## 3. YAPILAN İŞLER (istenen 11 madde)

### 3.1–3.3 Kanonik model · kaynaklar · seviyeler

`src/platform/fleet/driverAuthentication.ts` (yeni, **saf**):

```ts
interface DriverAuthentication {
  driverId · vehicleId · authenticationSource · authenticationLevel
  verifiedAt · expiresAt · sessionId
}
```

| Kaynak | Seviye tavanı | Gerekçe |
|---|---|---|
| `NFC` | `VERIFIED` | fiziksel kart teması |
| `PIN` | `VERIFIED` | sunucuda sürücü kaydına karşı doğrulanan bilgi faktörü |
| `BLUETOOTH` | `PARTIAL` | cihaz **yakınlığı** kişiyi kanıtlamaz |
| `PHONE` | `PARTIAL` | aynı gerekçe |
| `UNKNOWN` | `UNKNOWN` | — |

- **`HEAD_UNIT` bilinçli olarak YOK:** head unit `anon` rolünde çalışır;
  ekranda kimlik iddia eden herkes o kişi sayılırdı (P0'da kapatılan kapı).
- **İstemci kendi seviyesini yükseltemez:** bildirilen seviye kaynağın
  tavanını aşamaz — hem TS'te (`normalizeDriverAuthentication`) hem
  **sunucuda** (`_authentication_write_guard` seviyeyi DÜŞÜRÜR).
- **`sessionId` ZORUNLUDUR:** oturumsuz kayıt doğrulama sayılmaz — replay
  kilidinin dayanağıdır.
- **Ömür sınırlı:** varsayılan 4 sa, tavan 12 sa (presence'ın 8 saatinden
  kısa: daha güçlü sonuç doğuran kanıt daha kısa yaşamalıdır).

### 3.4 Authentication Authority (tek otorite)

`resolveDriverAuthentication()` — TS · `_resolve_driver_authentication()` — PG.
Karar sırası: kayıt yok → araç bağı → süre → sürücü uygunluğu → çoklu kimlik
(PG: `AUTHENTICATION_CONFLICT`) → seviye → `AUTHENTICATED`.

**Presence doğrudan kimlik doğrulaması SAYILMAZ:** iki katman ayrı otoritedir,
ayrı tablolarda yaşar ve doğrulama modülü presence resolver'ını **çağırmaz**
(TS `E1`/`E2`: bağımlılık tek yönlü, yalnız TİP).

### 3.5 Presence × Authentication ilişkisi

`resolveDriverTrust()` — beş karar:

| Durum | Karar | Güven |
|---|---|---|
| kimlik `VERIFIED` + varlık, **aynı** sürücü | `VERIFIED_PRESENCE` | **`VERY_HIGH` mümkün** |
| yalnız varlık | `PRESENCE_ONLY` | tavan **`HIGH`** |
| yalnız kimlik | `AUTHENTICATION_ONLY` | tavan **`HIGH`** |
| iki katman **farklı** kişi | `TRUST_CONFLICT` | `UNKNOWN`, sürücü **yazılmaz** |
| hiçbiri | `NO_TRUST` | → **P0 atama modeli** |

Ek kural (TS `C7`): doğrulama, **zayıf bir gözlemi güçlendirmez** — yalnız
`VERY_HIGH` kapısını açar. Atamasız presence yine `HIGH` kalır.

### 3.6 CAROS LAB — Driver Authentication ekranı

Yeni ekran (`fleet-driver-authentication`, kategori **Araç**). Gösterdikleri:

| İstenen | Ekrandaki karşılığı |
|---|---|
| active authentication | `driverRef` · `validity` · `sessionRef` |
| source | `source` (etiketli çip) |
| level | `level` (`VERIFIED`/`PARTIAL`/`UNKNOWN`) |
| expires | `expiresIn` (geçmişse **"doldu"**, negatif süre YOK) |
| session age | `sessionAge` |
| authority state | `authorityState` (`UNBOUND·IDLE·ACTIVE·EXPIRED·DEGRADED`) + `decision` + `reason` |

Ek: araç bağı, kabul/ret sayaçları, son ret gerekçesi (bounded KOD), bilinen
oturum sayısı (replay kilidinin hafızası).

Kurallara uyum: **aktif komut YOK** (yalnız YENİLE) · timer YOK · sabit veri
YOK · bilinmeyen `UNAVAILABLE` · **PII YOK** — sürücü adı, PIN, kart numarası,
token ve **tam oturum kimliği** taşınmaz (`drv:` / `veh:` / `ses:` + 8 hane).

### 3.7 PostgreSQL

`supabase/migrations/20260731000052_driver_authentication_p1.sql`:

- `vehicle_driver_authentication` tablosu + `vda_session_unique`
  (şirket başına oturum **tekil** → duplicate ve replay'in sert kilidi)
  + TTL/aralık/oturum CHECK'leri.
- `_authentication_write_guard`: araç yok · şirketsiz araç · şirket
  uyuşmazlığı · sürücü yok · cross-tenant sürücü · **24 saatten eski mesaj**
  (replay) · **gelecek tarih** (saat oynatma) → hepsi fail-closed;
  seviye tavanı sunucuda uygulanır.
- `_resolve_driver_authentication`: tek otorite (çoklu kimlikte `CONFLICT`).
- `vehicle_trips` + 4 kolon (`driver_auth_id/source/level/decision`) →
  "bu güven nereden geldi" sorusu cevaplanabilir.
- `_trip_attribution_trigger`: **VERY_HIGH kapısı** + kimlik/varlık çelişkisi
  → `CONFLICTED` + kanıtsız durumda **P0 AYNEN**.
- RLS + grants: `anon` hiçbir şey, `authenticated` yalnız SELECT
  (elle doğrulama eklenemez), `service_role` tam yetki.

---

## 4. TEST SONUÇLARI (tamamı bu turda koşuldu)

| Kapı | Komut | Sonuç |
|---|---|---|
| PG — 052 matrisi | `psql -f local_052_driver_authentication_p1.sql` | **30/30 PASS** |
| PG — 049 presence regresyonu | `psql -f local_049_driver_presence.sql` | **20/20 PASS** |
| PG — 050 defter regresyonu | `psql -f local_050_driver_presence_history.sql` | **27/27 PASS** |
| PG — 051 dayanıklılık regresyonu | `psql -f local_051_presence_durability_p2.sql` | **22/22 PASS** |
| PG — 048 kimlik/atama (P0) regresyonu | `psql -f local_048_driver_identity_assignment.sql` | **54/54 PASS** |
| PG — migration idempotens | 052 iki kez uygulandı | **temiz** |
| Vitest (kök) | `npx vitest run` | **9408/9408 · 442 dosya** |
| Vitest (website) | website dizininde `npx vitest run` | **866/866 · 41 dosya** |
| TypeScript | `npx tsc -b` | **temiz** |
| Build | `npm run build` | **başarılı (1 dk 12 sn)** |
| ESLint (değişen dosyalar) | `npx eslint …` | **temiz** |

**052 matrisi (30 kontrol):**

```
A1-A7  yazma kapıları: yanlış araç · cross-tenant sürücü · sahte company_id ·
       bireysel araç · 20 sa oturum · gelecek tarih · oturumsuz    7/7 PASS
B1-B2  seviye tavanı: BLUETOOTH VERIFIED iddiası PARTIAL'a düştü ·
       PARTIAL kimlik kanıtı sayılmadı                             2/2 PASS
C1-C4  duplicate oturum · replay (aynı oturum yeni zaman) ·
       çok eski mesaj · tekrarlara rağmen tek kayıt                4/4 PASS
D1-D4  otorite: AUTHENTICATED · süresi geçmiş · pasif sürücü ·
       iki farklı kimlik → CONFLICT                                4/4 PASS
T1-T7  presence+atama ATANDI · PRESENCE TEK BAŞINA VERY_HIGH ÜRETMEDİ ·
       dürüst NO_AUTHENTICATION izi · doğrulama trip'e işlendi ·
       KİMLİK+VARLIK → VERY_HIGH · çelişki → CONFLICTED ·
       yalnız kimlik → HIGH                                        7/7 PASS
R1-R4  kanıtsız P0 AYNEN · presence resolver DEĞİŞMEDİ ·
       manuel sonuç ezilmedi · 10× replay revizyon şişirmedi        4/4 PASS
S1-S2  cross-tenant okuma engeli · doğrudan yazma kapalı           2/2 PASS
```

Yeni TS kilitleri: `driverAuthentication.test.ts` — **42 test**
(A sözleşme 9 · B otorite 9 · C nihai güven 8 · D depo kapıları 8 ·
E regresyon/saflık 8).

---

## 5. "RESOLVER DEĞİŞMEYECEK" — NASIL GARANTİ EDİLDİ

| # | Kapı | Nerede |
|---|------|--------|
| 1 | 052 `_resolve_driver_presence` ve `_resolve_trip_driver`'ı **yeniden tanımlamaz** | Migration gövdesi |
| 2 | Migration doğrulaması presence resolver'ını **ÇAĞIRIR**; `NO_PRESENCE` dönmezse migration **DÜŞER** | 052 doğrulama (d) |
| 3 | Attribution gövdesi hâlâ **üç modeli de** çağırmalı, aksi hâlde migration DÜŞER | 052 doğrulama (e) |
| 4 | Geçmiş defteri hâlâ karara giremez (051 kuralı sürüyor) | 052 doğrulama (e) |
| 5 | PG kilidi: presence resolver'ı gözlemsiz aralıkta hâlâ `NO_PRESENCE` | 052 `R2` |
| 6 | TS kilidi: `resolveDriverPresence` çıktısı **VERY_HIGH demeye devam ediyor** — tavan yalnız trust katmanında | TS `C1` |
| 7 | TS kilidi: presence modülü doğrulamayı **bilmez** (tek yönlü bağımlılık) | TS `E2` |
| 8 | 048 (54/54) · 049 (20/20) · 050 (27/27) · 051 (22/22) 052 sonrası **yeniden koştu** | §4 |

---

## 6. BİLİNÇLİ OLARAK YAPILMAYANLAR

| Yapılmadı | Gerekçe |
|---|---|
| NFC / PIN / Bluetooth / telefon üreticisi | **Görev gereği kapsam dışı.** Kaynak yokken doğrulama üretilmez → `VERY_HIGH` kapısı kapalı kalır. |
| Doğrulama yazan RPC (`anon` erişimi) | Head unit `anon` rolündedir; doğrulama yazma yüzeyi **çok dikkatli** tasarlanmalıdır (aksi hâlde herkes kendini doğrular). Kaynak gelmeden açılmaz. |
| Doğrulama oturumunun kalıcılığı | Bir kimlik oturumunun yeniden başlatmadan sonra "hâlâ geçerli" sayılması kanıtı zayıflatır — **yeniden doğrulama istenir** (presence P2'den bilinçli fark). |
| Fleet UI'da doğrulama rozeti | Head unit LAB'ı hedeflendi; website sözleşmesi değişmedi. |
| `resolveDriverTrust`'ın head unit'te tüketilmesi | Attribution kararı **sunucudadır**; head unit'te ikinci bir otorite kurmak paralel gerçek üretirdi. |

---

## 7. AÇIK BORÇLAR (kütüğe yazıldı)

| # | Borç | Kütük |
|---|------|-------|
| 1 | Gerçek doğrulama kaynağı yok → tablo/depo gerçek veriyle hiç dolmadı | #247 |
| 2 | `VERY_HIGH` gerçek araçta hiç üretilmedi (yeni kapı sahada sınanmadı) | #248 |
| 3 | Doğrulama yazan yüzey (RPC/native) yok — üretimde kimse `record()` çağırmıyor | #249 |
| 4 | Replay/duplicate kilitleri gerçek saldırı trafiğinde değil, kontrollü testte ölçüldü | #250 |
| 5 | Politika değişikliğinin filo raporlarına etkisi (mevcut `VERY_HIGH` kayıtları) gözden geçirilmedi | #251 |

---

## 8. DEĞİŞEN DOSYALAR

**Yeni**
- `supabase/migrations/20260731000052_driver_authentication_p1.sql`
- `supabase/verification/local_052_driver_authentication_p1.sql`
- `src/platform/fleet/driverAuthentication.ts`
- `src/components/devtools/screens/FleetDriverAuthenticationScreen.tsx`
- `src/__tests__/driverAuthentication.test.ts`
- `docs/DRIVER_AUTHENTICATION_P1_REPORT.md`

**Değişen**
- `src/platform/fleet/presenceVehicleBinding.ts` (aynı doğrulanmış araç bağı
  kimlik otoritesine de uygulanır)
- `src/platform/devtools/carosLabCatalog.ts` · `carosLabScreenMap.tsx` (yeni ekran)
- `supabase/verification/local_049_driver_presence.sql`
  (**P6 yeni politikaya taşındı + P6b eklendi** — kilit kaldırılmadı)

---

## 9. SAHA DOĞRULAMA — NE GÖZLENMELİ

Gerçek doğrulama kaynağı bağlandığında ve gerçek head unit'te:

1. Kart okutulup kimlik doğrulandığında LAB'da `authorityState = ACTIVE`,
   `level = VERIFIED`, `expiresIn` **azalarak** görünmeli.
2. Aynı oturum ikinci kez gelirse `rejectedCount` artmalı,
   `lastRejectReason = DUPLICATE_SESSION` olmalı.
3. Yalnız presence varken trip güveni **`HIGH`** olmalı; doğrulama eklenince
   **`VERY_HIGH`**'a çıkmalı.
4. Kartı A, PIN'i B girdiğinde trip **`CONFLICTED`** olmalı ve sürücü
   **yazılmamalı**.
5. Doğrulama süresi dolduğunda `authorityState = EXPIRED` olmalı ve o andan
   sonraki yolculuklar `VERY_HIGH` **almamalı**.
6. Araç değişince aktif doğrulama **düşmeli** (`IDLE`).

Bu ölçütler gözlenene kadar `realDeviceValidationVerdict` = **`BLOCKED_REAL_DEVICE`**.
