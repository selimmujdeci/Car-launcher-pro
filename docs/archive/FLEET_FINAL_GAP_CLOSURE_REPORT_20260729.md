# CAROS PRO — FLEET FINAL GAP CLOSURE REPORT

**Tarih:** 2026-07-29 · **Branch:** `feat/fleet-offline-final-local-completion`
**Kapsam:** yerel kod + geçici PostgreSQL + dokümantasyon.
**Production'a hiçbir şey uygulanmadı. Commit/push/deploy/db push yapılmadı.**

---

## 1. Yönetici özeti

Dört açık ele alındı. Üçünün **yerel işi kanıtlı olarak tamamlandı**,
dördüncüsü **hazırlandı ama koşulmadı**:

| Açık | Durum | Kanıt |
|---|---|---|
| 1 · RLS/privilege matrisi | **KAPANDI (yerel)** | Gerçek SQL, **65/65 PASS**, beklenmeyen ALLOW **0** |
| 2 · Realtime gap detection | **KOD+TEST TAMAM · ÜRÜNE BAĞLANMADI** | 40 kilit testi yeşil |
| 3 · Sahiplik devri | **KAPANDI (yerel)** | SQL **44/44 PASS** + 33 istemci kilidi |
| 4 · Telefon doğrulama | **ALTYAPI HAZIR · KOŞULMADI** | 23 kilit testi; `phoneValidated=false` |

**Matris gerçek bir güvenlik açığı buldu ve kapatıldı:** `member` rolündeki bir
kullanıcı `UPDATE profiles SET role='admin' WHERE id=auth.uid()` ile **kendini
admin yapabiliyordu** (ölçüldü: ALLOW, 1 satır). 035/036'nın tüm RPC'leri admin
kontrolünü bu kolondan okuduğu için **tüm filo rol otoritesi çökebilirdi**.
Migration 038 iki bağımsız katmanla kapattı.

**Karar: `FLEET_OFFLINE_PARTIAL`** — gerekçesi §21'de.

---

## 2. Branch / worktree ve paralel ajan durumu

- Branch: `feat/fleet-offline-final-local-completion` (değişmedi), **296 kirli yol**.
- Commit/push/stash/reset **yok**.

### Paralel iş — AKTİF ve artık aynı dosyalarda

Zaman damgası taraması, paralel bir sürecin bu oturum boyunca çalıştığını
gösterdi. **Önemli fark:** bu tur paralel iş **benim dosyalarıma da yazdı**.

| Dosya | Sahibi | Not |
|---|---|---|
| `security/accountCleanup/{vehicleAuthorityRuntime,vehicleCleanupParticipants,createAccountCleanupRuntime,index}.ts` | paralel | Dokunulmadı |
| `hooks/useCommandTracker.ts` · `useRealtime.ts` | paralel | Dokunulmadı |
| `store/{vehicleStore,pinDialogStore}.ts` | paralel | Dokunulmadı |
| `hooks/useFleet.ts` | **ortak** | Paralel iş `evaluateAccountScopedCapability` kapıları ekledi; **benim `enqueueOfflineMutation`/`offlineClass` değişikliklerim korunmuş** |
| `lib/fleet/errors.ts` | **ortak** | Paralel iş `account_cleanup_in_progress` ekledi; benim `requires_online`/`offline_queue_full` kodlarım korunmuş |
| `lib/offline/fleetOffline.ts` | **ortak** | Paralel iş `prepareOfflineQueueCleanup()` ekledi; benim tek kapı/abort/reset kodum korunmuş |

**Sahiplenme kararı:** paralel işin kodu **yeniden yazılmadı, düzeltilmedi**.
Ortak dosyalarda yalnız kendi eklemelerim korundu; çakışma gözlenmedi.
`useFleet.ts` paralel iş aktif olduğu için bu turda **hiç düzenlenmedi** —
sahiplik devri UI'si bu yüzden ayrı modüle yazıldı.

---

## 3. Başlangıç açıkları

Önceki karar `FLEET_OFFLINE_PARTIAL`; dört doğrulanmış açık §1 tablosundaki gibi.

---

## 4. RLS / privilege matrisi

### Yöntem — policy metni DEĞİL, gerçek SQL

`supabase/verification/local_rls_matrix.sql`: her kombinasyon için
`SET LOCAL ROLE` + `request.jwt.claims` (auth.uid() bunu okur) ile **gerçek**
SELECT/INSERT/UPDATE/DELETE/EXECUTE denenir; SQLSTATE ve satır sayısı
sınıflandırılır: `ALLOW · DENY_GRANT · DENY_RLS · DENY_FUNCTION ·
DENY_VALIDATION · DENY_OWNERSHIP · DENY_LAST_ADMIN · DENY_CROSS_TENANT · ERROR`.
Tanınmayan hata `ERROR` olur — belirsizlik gizlenmez.

**Kapsam:** 9 aktör × 9 tablo × 4 DML + 14 RPC EXECUTE = **65 deneme**.

### Sonuç

```
RLS matrisi — 65/65 PASS · beklenmeyen ALLOW: 0
SECURITY DEFINER hijyeni — 13/13 sabit search_path
anon/PUBLIC EXECUTE sızıntısı — 0
```

### 🔴 Matrisin bulduğu iki gerçek kusur

**(a) Yetki yükseltme (ÜRÜN KUSURU).** `member` kendi `profiles.role`'ünü
`admin` yapabiliyordu. "Kendi satırını güncelleyebilir" politikası **hangi
kolonların** değişebileceğini kısıtlamıyordu. → **Migration 038**:
kolon-düzeyi UPDATE grant'i (`role`/`company_id` hariç) + BEFORE UPDATE trigger.
İki katman bağımsızdır: biri yanlışlıkla geri alınsa diğeri tutar.

**(b) Harness kendini kirletiyordu (TEST KUSURU).** İlk sürümde başarılı
yazmalar kalıcıydı; `member` kendini admin yapınca sonraki testler onu admin
sanıp **yanlış ALLOW** üretiyordu. Postgres'te plpgsql savepoint desteklemediği
için her deneme artık bilerek bir istisnayla sonlandırılıp geri alınıyor, ölçüm
istisna mesajıyla dışarı taşınıyor. Ayrıca `UPDATE`/`DELETE`'te **0 satır =
DENY_RLS** (izin verildi sayılmaz).

---

## 5. Anon grant hardening (R4)

Migration 037 (önceki tur) korunuyor: `profiles` + `companies` için anon
ayrıcalığı **0**; `SET ROLE anon; SELECT` → **permission denied**;
`authenticated` **8/8 korundu**.

**FAZ 2 hâlâ bilinçli olarak açık:** head unit `commandListener.ts` anon key ile
`vehicles` UPSERT ve `vehicle_commands` SELECT yapıyor. Bu tablolarda GRANT geri
alınırsa **araç komut almayı bırakır**. Ön koşul: bu erişimin SECURITY DEFINER
RPC'ye göçü.

---

## 6. Realtime gap detection mimarisi

`website/src/lib/realtime/realtimeSyncAuthority.ts` — **tek otorite**, saf
(I/O yok, `Date.now()` yok; saat ve snapshot getirici enjekte).

**Durum makinesi:** `IDLE · CONNECTING · LIVE · SUSPECTED_GAP · RESYNCING ·
RECONCILING · DEGRADED · STOPPED`. `isTrustworthy()` **yalnız LIVE** için true.

**Anayasa:** reconnect **DAİMA** `SUSPECTED_GAP`'e düşürür — snapshot alınmadan
LIVE olunmaz. İlk kurulumda güvenilir imleç olmadığı için (`MISSING_CURSOR`)
doğrudan LIVE'a da geçilmez.

**8 boşluk sinyali:** `REVISION_JUMP · NON_MONOTONIC · RECONNECTED ·
SUBSCRIPTION_REBUILT · SERVER_AHEAD · MISSING_CURSOR · UNKNOWN_ENTITY_EVENT ·
GENERATION_MISMATCH`.

**Kuşak kapısı:** farklı hesap/şirket/kuşaktan gelen olay reddedilir; resync
sırasında kapsam değişirse sonuç uygulanmaz (`STALE_SCOPE`).

**Bounded:** tek resync · deterministik jitter'lı üstel backoff (reconnect storm
engeli) · `MAX_RESYNC_ATTEMPTS=5` sonrası `DEGRADED` (sonsuz retry yok) ·
sayaçlar `COUNTER_CAP=9999` ile doygun · duplicate kümesi 500 ile sınırlı.

**`lastServerRevision` YALNIZ başarılı uzlaştırmadan sonra ilerler** — başarısız
resync onu ilerletmez, dolayısıyla boşluk "kapanmış" görünmez.

---

## 7. Snapshot reconciliation

7 sınıf: `SERVER_ONLY_ENTITY · LOCAL_PENDING_ENTITY · MATCHED · SERVER_NEWER ·
LOCAL_PENDING_NEWER · SERVER_DELETED_LOCAL_PENDING · UNKNOWN_REVISION`.

| Durum | Sonuç |
|---|---|
| Sunucu daha yeni + **güvenlik** işlemi | `ACCEPT_SERVER` (server-wins) |
| Sunucu daha yeni + sıradan metadata | `USER_ACTION` |
| Sunucuda silinmiş + güvenlik işlemi | `USER_ACTION` |
| Sunucuda silinmiş + sıradan | `DROP_STALE_LOCAL` |
| Yerel taban sunucudan ileri | `FAIL_CLOSED` |
| Revizyon bilinmiyor | `FAIL_CLOSED` |
| Snapshot'ta yok (yeni yaratma) | `KEEP_LOCAL_PENDING` |

Bekleyen yerel mutation **sessizce ezilmez**; güvenlik alanında local-wins yok.

---

## 8. Araç sahipliği transfer modeli

**Migration 039.** Sahiplik tek otorite: `INDIVIDUAL (owner_id)` |
`COMPANY (company_id)`; ikisi aynı anda olamaz (CHECK kısıtı — mevcut veri ihlal
ediyorsa kısıt eklenmez, **uyarı verilir**; migration veri yazmaz).
`vehicle_pairings` ve cihaz kimliği (`api_key`) **sahiplik değildir**.

`vehicle_ownership_transfers` + `vehicles.revision` (trigger yalnız
sahiplik/isim/plaka değişiminde artırır — telemetri revizyon şişirmez).

**Pairing politikası: SEÇENEK A (açıkça seçildi).** Devirde eski kullanıcı
eşleştirmeleri **iptal edilir**; head-unit cihaz kimliği **korunur**. Gerekçe:
eski sahibin telefonunda konum ve komut yetkisi kalmamalıdır; cihazı yeniden
kurmak iş çıkarır ama erişimi taşımak güvenlik açığıdır.

Devir tamamlanınca ayrıca: bekleyen komutlar `expired`, kullanılmamış
eşleştirme kodları geçersiz.

---

## 9. Transfer güvenliği ve yarış korumaları

| Koruma | Nasıl | Kanıt |
|---|---|---|
| Tek aktif transfer | partial unique index (`WHERE status='PENDING'`) | B2 |
| Idempotency | `idempotency_key` unique + aynı anahtar aynı transferi döndürür | B3, B3b |
| Optimistic concurrency | `expected_vehicle_revision`, kabulde yeniden doğrulanır | A8, D2 |
| Atomiklik | kabul tek transaction (sahiplik+pairing+komut+durum) | B6–B12 |
| Yetki | başlatma: sahip/şirket admini · kabul: hedef (şirkette admin) | A1–A4, B4, B5, E2–E4 |
| Sahipsiz araç | devredilemez | A5 |
| Kendine devir | reddedilir | A7 |
| Süre dolumu | kabul reddedilir; bakım fonksiyonu EXPIRED yapar | C2, C5 |
| anon | RPC EXECUTE ve tablo SELECT kapalı | F1–F3 |

### 🔴 Bulunan kusur

`RAISE EXCEPTION` **kendi transaction'ını geri aldığı için** aynı blokta yazılan
`status='EXPIRED'/'FAILED'` de geri alınıyordu. Sonuç: süresi dolmuş transfer
`PENDING` kalıyor ve **aktif-transfer tekillik indeksini süresiz bloke ediyordu**
— araç bir daha devredilemezdi. Temizlik, commit olan yollara taşındı
(`start_vehicle_transfer` başlangıcı + `expire_vehicle_transfers()` bakımı).
Revizyon uyuşmazlığında kayıt bilinçli olarak `PENDING` kalır: devir kalıcı
ölmez, gönderen iptal edip güncel revizyonla yeniden başlatabilir (D3b/D3c).

**Transfer matrisi: 44/44 PASS.**

---

## 10. Offline / realtime / transfer bütünleşmesi

- Dört devir işlemi (`VEHICLE_TRANSFER_*`) kuyruk sözleşmesinde **tanımlı** ve
  hepsi **`ONLINE_REQUIRED`** — çevrimdışı kuyruğa **giremez**.
- Bilinmeyen işlem türü fail-closed `ONLINE_REQUIRED`.
- Bounded hata sözleşmesi (`TRANSFER_RESULT_CODES`): ham backend metni UI'ye
  **asla** gitmez; tanınmayan kod `UNKNOWN` + genel Türkçe metin.
- Kalan süre LAB'a **kova** olarak taşınır (tam zaman damgası değil).

---

## 11. AccountCleanup entegrasyonu

Paralel işin kodu **değiştirilmedi**. Kendi tarafımda: `resetOfflineState()`
doğrulama döndürür, `peekOrchestrator()`/`peekRealtimeAuthority()` salt-okuma.
Paralel iş `prepareOfflineQueueCleanup()` ekleyerek benim `abort()` yolumu
kendi akışına bağlamış — çakışma yok.

---

## 12. Telefon doğrulama altyapısı

15 makine-okur senaryo (P1–P15) + 8 head-unit BLOCKED alanı (H1–H8).
Her senaryo: ön koşul · adım · beklenen olay/UI/sunucu durumu · **yasaklı
olaylar** · zorunlu kanıt türleri.

**İki kural kodla zorlanır:**
1. Head-unit gerektiren senaryoya `PASS` yazmak **reddedilir**
   (`HEAD_UNIT_REQUIRED`).
2. Kanıtsız `PASS` **reddedilir** (`EVIDENCE_MISSING`).

`summarize()` yalnız **15/15 kanıtlı PASS** ile `phoneValidated:true` döner —
tek `NOT_RUN` bile varsa false.

**Şu an: hiçbir senaryo koşulmadı → `phoneValidated = false`.**
Runbook: `docs/PHONE_VALIDATION_RUNBOOK_FLEET.md`.

---

## 13. CAROS LAB değişiklikleri

Yeni paneller (salt-okunur, timer yok, açılışta tek okuma + elle YENİLE):

- **Hesap İzolasyonu & Kuşak** — kuyruk hesap bağı · yabancı hesap reddi ·
  bilinmeyen şema reddi · senkron kuşağı · bayat sonuç reddi · tur çalışıyor mu
- **Realtime & Boşluk Tespiti** — durum · güvenilir mi · kapsam kuşağı ·
  revizyonlar · son boşluk sebebi · 10 sayaç · son eşitleme süresi
- **Çevrimdışı Politika** — hangi işlem hangi sınıfta

**Gizlilik:** hesap/şirket kimliği taşınmaz (yalnız kuşak **sayısı**);
e-posta, kod, token, konum, ham payload yok. LAB **hiçbir işlem tetiklemez** ve
**yeni otorite kurmaz** (`peek*` kullanır). Realtime otoritesi kayıtlı değilse
tek satır `UNAVAILABLE` — sahte sayaç üretilmez. `accountScopeBound === false`
veya realtime güvenilir değilse panel **DEGRADED**.

---

## 14. Migration değişiklikleri

| Migration | İçerik | Yerel durum |
|---|---|---|
| 033–036 | değiştirilmedi | uygulandı ✅ |
| 037 | anon GRANT FAZ 1 | uygulandı ✅ idempotent |
| **038 (yeni)** | profil yetki yükseltme kapısı | uygulandı ✅ idempotent |
| **039 (yeni)** | sahiplik devri + revision | uygulandı ✅ idempotent |

- **035 R2 hardening korundu** — dosyaya dokunulmadı.
- Numara çakışması yok; yalnız kök zincire eklendi.
- Hepsi transaction-safe (`BEGIN/COMMIT`) ve fail-closed ön kontrollü.
- 038/039 için **forward-fix** stratejisi belgelendi (039'da rollback yerine
  EXECUTE yetkisini geri almak önerilir — denetim izi korunur).
- ⚠️ 035 `--single-transaction` (-1) **zorunludur** (DROP CONSTRAINT içerir);
  runner bunu uygular.

---

## 15. Test sonuçları

| Kapı | Sonuç |
|---|---|
| Migration zinciri 033→039 (temiz DB) | **7/7 uygulandı** |
| RLS/privilege matrisi (izole DB) | **65/65 PASS** · beklenmeyen ALLOW **0** |
| Transfer matrisi (izole DB) | **44/44 PASS** |
| Website vitest | **23 dosya / 557 test PASS** |
| Website `tsc --noEmit` | **temiz** |
| Kök depo vitest | **424 dosya / 8831 test PASS** |
| Secret taraması (yeni dosyalar) | temiz |
| Geçici konteyner temizliği | benim 3 konteynerim silindi; `sentinel_*` ve paralel işin `caros-pg-val`'i **dokunulmadı** |

**Yeni test dosyaları:** `realtimeGapDetection.test.ts` (40) ·
`ownershipTransfer.test.ts` (33) · `phoneValidationContract.test.ts` (23).

**Tek runner:** `bash supabase/verification/run_local_verification.sh` —
her matrisi **kendi temiz DB'sinde** koşar ve konteyneri sonunda kaldırır.

> Bu izolasyon zorunlu çıktı: transfer matrisi sahipliği kalıcı değiştirdiği
> için aynı DB'de ardından RLS matrisi koşulunca "bireysel kullanıcı kendi
> aracını göremiyor" diye **sahte bir düşüş** üretiyordu.

⚠️ **Lint koşulamadı:** `website/` içinde ESLint yapılandırması yok
(`next lint` interaktif kuruluma giriyor). Açık borç; "temiz geçti" denmiyor.

---

## 16. Performans sonuçları

**Bounded olan her şey:** kuyruk (500) · realtime sayaçları (9999 doygun) ·
duplicate kümesi (500) · resync denemesi (5) · transfer listesi (100) ·
conflict geçmişi kuyruk içinde.

**İndeksler (039):** `vehicle_transfers_one_active` (partial unique) ·
`vehicle_transfers_idempotency` · `vehicle_transfers_to_owner` ·
`vehicle_transfers_expiry` (partial). Baseline'da RLS politikalarının kullandığı
`profiles.company_id`, `vehicles.company_id/owner_id` indeksleri mevcut.

**Ölçülmedi:** `EXPLAIN` ile policy sorgu planları, büyük filo (100+ araç)
sayfalama, gerçek N+1 analizi. Uydurma performans rakamı verilmiyor.

---

## 17. Paralel iş ve dosya kapsamı

**Music Hub çakışması YOK.** `src/platform/media*`, `android/.../media/`,
Audio Focus, Mavi media port, LAB media ekranlarına dokunulmadı.

Bu turda dokunulan dosyalar: `website/src/lib/{offline,realtime,fleet,lab,validation}/`,
`website/src/app/dashboard/fleet/{lab,conflicts,pending}/`,
`website/src/__tests__/`, `supabase/{migrations,verification}/`, `docs/`.

Paralel iş dosyaları §2'de; **hiçbiri düzenlenmedi**.

---

## 18. Production'da doğrulanmayanlar

- Migration **033–039 hiçbiri production'a uygulanmadı**.
- Production RLS/GRANT matrisi **ölçülmedi** — yerel baseline production
  şemasının birebir kopyası **değildir**.
- Gerçek signup → profile üretimi, gerçek pairing, gerçek transfer smoke testi
  yapılmadı.
- Production migration history bilinmiyor; tahmin edilmedi.

---

## 19. Head-unit'te doğrulanmayanlar

H1–H8'in tamamı (kontak yaşam döngüsü · head-unit süreç yönetimi · üretici
WebView · araç içi ağ · fiziksel eşleştirme · Mali-400 performansı · direksiyon
tuşları · gerçek sürüşte reconnect) **BLOCKED_HEAD_UNIT**.
Hiçbiri PASS olarak işaretlenmedi; kod bunu zaten reddediyor.

---

## 20. Açık riskler

1. **🔴 Realtime otoritesi ürün akışına BAĞLANMADI.** Modül yazıldı, test edildi,
   LAB'a bağlandı — ama `useRealtime.ts` paralel işin aktif alanı olduğu için
   uygulamanın gerçek realtime akışına takılmadı. **Üründe reconnect davranışı
   hâlâ eski.** Bu, COMPLETE'i engelleyen birincil sebeptir.
2. **Sahiplik devri UI ekranı yok.** Saf model + RPC hazır; `/dashboard/fleet`
   altında devir başlat/kabul/ret ekranı yazılmadı.
3. **Telefon senaryoları koşulmadı** → `phoneValidated=false`.
4. **R4 FAZ 2 bloke** — head unit anon tablo erişimi RPC'ye taşınmadan araç
   tablolarında GRANT daraltılamaz.
5. **Baseline fixture ≠ production şeması.** Matris sonuçları yerel şemaya
   göredir; production'da farklı politikalar olabilir.
6. **Website ESLint yapılandırması yok.**
7. **`vehicles_single_owner_type` kısıtı yerel veride eklenemedi** (hem owner_id
   hem company_id dolu satırlar var) — production'da veri uzlaştırması gerekir.
8. İki migration zinciri sorunu duruyor (büyütülmedi).

---

## 21. Son karar

## `FLEET_OFFLINE_PARTIAL`

**Neden COMPLETE değil:** Kabul engelleri listesinde açıkça yer alan
*"realtime reconnect snapshot almadan LIVE oluyor"* maddesi **üründe hâlâ
geçerlidir**. Otorite modülü doğru davranıyor ve testli, ama uygulamanın
realtime akışına bağlanmadı (§20.1) — dolayısıyla kullanıcı hâlâ eski davranışı
görüyor. Buna ek olarak telefon doğrulaması **koşulmadı**, yani kullanıcının
tanımladığı `..._WITH_PRODUCTION_AND_HEAD_UNIT_GATES` kararının "test edilirse"
şartı sağlanmıyor.

**Neden BLOCKED/REJECTED değil:** Üç açığın yerel işi **kanıtlı** tamamlandı —
gerçek SQL matrisi 65/65 (beklenmeyen ALLOW 0), transfer 44/44, 96 yeni istemci
kilidi, 557 website testi ve tsc temiz. Ayrıca matris **gerçek bir yetki
yükseltme açığı** buldu ve kapattı.

**COMPLETE'e kalan dar iş:**
1. `RealtimeSyncAuthority`'yi uygulama realtime akışına bağlamak
   (paralel iş `useRealtime.ts`'ten çekildiğinde).
2. Sahiplik devri UI ekranı.
3. Telefonda P1–P15 koşup kanıt toplamak.

Bunlar bittiğinde `FLEET_OFFLINE_LOCAL_COMPLETE_WITH_PRODUCTION_AND_HEAD_UNIT_GATES`
verilebilir. Production ve gerçek head-unit kapıları her hâlükârda açık kalır.
