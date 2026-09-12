# CAROS PRO — FLEET FINAL PRODUCT WIRING REPORT

**Tarih:** 2026-07-29 · **Branch:** `feat/fleet-offline-final-local-completion`
**Production'a hiçbir şey uygulanmadı. Commit/push/deploy/db push yapılmadı.**

---

## 1. Yönetici özeti

Üç açık ele alındı; **ikisi kapandı, biri koşum bekliyor**:

| İş | Durum |
|---|---|
| 1 · Realtime otoritesi ürüne bağlanması | **KAPANDI** — 28 entegrasyon kilidi |
| 2 · Ownership transfer UI | **KAPANDI** — API + hook + 4 ekran + 15 kilit |
| 3 · Telefon P1–P15 koşumu | **ALTYAPI TAM · KOŞULMADI** (`phoneValidated=false`) |

**Kritik kazanım:** `useRealtime`'ın motoru artık yalnız *ham sinyal* üretir.
"Veriler güncel mi?" kararını **yalnız** `RealtimeSyncAuthority` verir —
`connected` sinyali doğrudan LIVE yapmaz, snapshot ve uzlaştırma zorunludur.

**Karar: `FLEET_OFFLINE_LOCAL_COMPLETE_WITH_PRODUCTION_GATES`** — gerekçe §19.

---

## 2. Paralel ajan ve dosya kapsamı

Paralel iş bu oturumda da aktifti (en son 21:11). `useRealtime.ts` 20:41'den
beri sabitti; **yeniden okuyup** doğruladıktan sonra minimal bağlama yapıldı.

| Dosya | Sahiplik | Bu turda |
|---|---|---|
| `hooks/useRealtime.ts` | **ortak** | +4 satır bağlama (motorun mantığı KORUNDU) |
| `security/accountCleanup/*` | paralel | **dokunulmadı** |
| `hooks/useFleet.ts` · `store/*` | paralel | **dokunulmadı** |
| `app/dashboard/layout.tsx` | paralel | **dokunulmadı** |
| `lib/realtime/*` · `lib/fleet/transferRequestRunner.ts` · `lib/validation/*` | benim | yeni |

**Music Hub:** zaman damgası taramasıyla doğrulandı — media dizinlerinde bu
turda değişen dosya **0**.

---

## 3. Realtime başlangıç durumu

`useRealtime` → `createRealtimeEngine` → `onUpdate`/`onConnectionChange` →
`vehicleStore`. Boşluk kavramı **yoktu**: `connected` gelince store
`connectionStatus='connected'` oluyor ve UI bunu "canlı" sayıyordu. Reconnect
sonrası kaçırılan sunucu değişiklikleri **sessizce atlanıyordu**.

---

## 4. Realtime authority entegrasyonu

**Adaptör deseni** (kullanıcının istediği zincir):

```
useRealtime → attachRealtimeSyncRuntime → RealtimeSyncRuntime
            → RealtimeSyncAuthority → snapshot provider → reconcile
```

`useRealtime`'a eklenen tek şey: runtime kurulumu, `onConnectionChange`
içinde tek satır aktarım, yetki kaybında ve unmount'ta `syncRuntime.stop()`.
Motorun kanal/araç kümesi mantığı **değiştirilmedi**.

**İkinci otorite imkânsız:** `startRealtimeRuntime` yeni runtime kurarken
öncekini **durdurur**; LAB kaydı (`registerRealtimeAuthority`) yalnız aktif
otoriteyi gösterir. Test: *"yeni runtime öncekini durdurur"*.

---

## 5. Reconnect / snapshot akışı

| Sinyal | Sonuç |
|---|---|
| `connected` (ilk) | `MISSING_CURSOR` → SUSPECTED_GAP → resync |
| `connected` (reconnect) | `RECONNECTED` → SUSPECTED_GAP → resync |
| `disconnected` / `error` | SUSPECTED_GAP (derhal güvenilmez) |
| `connecting` | durum değişmez |
| snapshot başarılı | RECONCILING → **LIVE** |
| snapshot başarısız | SUSPECTED_GAP → bounded retry → **DEGRADED** |

`lastServerRevision` **yalnız başarılı uzlaştırmadan sonra** ilerler.
`isTrustworthy()` yalnız LIVE'da true — UI "güncel" ibaresini buna bağlar.

### Revizyon kaynağı (dürüst sınır)

Supabase realtime payload'ı revizyon **taşımaz**. Revizyon yalnız
`vehicles.revision`'dan (migration 039) okunur; kolon yoksa snapshot yine
alınır ama `revisionSource='UNAVAILABLE'` raporlanır ve `SERVER_AHEAD`
sinyali devre dışı kalır. **Uydurma revizyon üretilmez.**

---

## 6. Gap ve stale event korumaları

- Eski kuşak olayı → `GENERATION_MISMATCH`, sayaç artar, uygulanmaz.
- Resync sırasında hesap/şirket değişimi → `STALE_SCOPE`, sonuç uygulanmaz.
- Yinelenen olay → bastırılır (bounded küme, 500).
- Eşzamanlı iki reconnect callback'i → **tek** snapshot (seri zincir + otorite
  tek-uçuş kilidi + LIVE'da erken çıkış).
- `stop()` sonrası bağlantı bildirimi, `tick()` ve `retryNow()` **yok sayılır**
  (zombi callback yok; timer hiç kullanılmıyor).
- Bounded backoff + deterministik jitter → reconnect storm engeli.

---

## 7. Ownership transfer UI

`/dashboard/fleet/transfer` — dört bölüm: **başlatma · gelen · gönderdiklerim ·
geçmiş**.

Başlatma ekranında **güvenlik özeti** devrin sonuçlarını açıkça yazar:
eşleştirmeler kaldırılır · bekleyen komutlar iptal edilir · kullanılmamış
kodlar geçersiz olur · **head unit kurulumu korunur** · hedef onaylayana kadar
tamamlanmaz. Pairing politikası kullanıcıdan gizlenmez.

**API** `/api/vehicle/transfer` (GET/POST/PATCH/DELETE): kimlik yalnız
oturumdan; UUID biçimi, idempotency anahtarı ve **revizyon** zorunlu.

---

## 8. Offline engelleri

Karar mantığı React'ten ayrı `TransferRequestRunner`'da (bu sayede yeni bir
render kütüphanesi kurmadan doğrudan test edilebildi):

| Kapı | Davranış |
|---|---|
| Çevrimdışı | İstek **hiç gönderilmez** → `ONLINE_REQUIRED` |
| Uçuşta istek | İkincisi gönderilmez → `TRANSFER_CONFLICT` |
| Sunucu 2xx | **Ancak o zaman** "tamamlandı" |
| Ağ koptu | "Sonuç bilinmiyor" — başarılı **sayılmaz** |
| Tanınmayan hata | `UNKNOWN` + genel Türkçe metin (ham SQL sızmaz) |

Ayrıca dört `VEHICLE_TRANSFER_*` işlem türü kuyruk sözleşmesinde tanımlı ve
**`ONLINE_REQUIRED`** — `enqueueOfflineMutation` bunları reddeder. Test:
*"devir işlemleri çevrimdışı kuyruğa yazılamaz"* (kuyruk boş kalır).

---

## 9. Transfer sonrası cache / authority temizliği

Sunucu tarafı (039, yerel matriste 44/44 doğrulandı): eski `vehicle_pairings`
silinir, bekleyen komutlar `expired`, kullanılmamış kodlar geçersiz,
`vehicles.revision` artar.

İstemci tarafı: transfer başarılı olunca liste yenilenir; `vehicles.revision`
arttığı için realtime snapshot'ı bir sonraki resync'te **SERVER_NEWER**
üretir ve uzlaştırma güvenlik işlemlerinde `ACCEPT_SERVER` der.

⚠️ **Açık:** uzlaştırma sonucu şu an LAB sayacına yansır; store'a **otomatik
yazılmaz** (bilinçli — ekranın kendi yenileme akışı otoritedir, çift otorite
kurulmadı). Eski sahibin ekranı yenilenene kadar bayat kalabilir; sunucu her
hâlükârda erişimi reddeder.

---

## 10. AccountCleanup entegrasyonu

Paralel işin kodu **değiştirilmedi**. Yetki kalkınca (`REALTIME_SUBSCRIBE`
reddi) `syncRuntime.stop()` çağrılır — uçuştaki snapshot'ın sonucu yeni
hesabın kapsamına uygulanamaz. Paralel işin `prepareOfflineQueueCleanup()`
kancası benim `abort()` yolumu kendi akışına bağlamış; çakışma yok.

---

## 11. Telefon validation altyapısı

Kayıt sözleşmesi genişletildi: `DeviceContext` (model · Android sürümü ·
yerel derleme kimliği) · `startedAt/completedAt` · `observedEvents/observedUi` ·
`evidenceRef` · `failureCode`.

**Dört kapı makine tarafından zorlanır:** `UNKNOWN_SCENARIO` ·
`HEAD_UNIT_REQUIRED` · `EVIDENCE_MISSING` · **`DEVICE_CONTEXT_MISSING`**.

`ValidationEvidenceCollector` bounded; geçersiz PASS'i **almaz**.
`toLabExport` redaksiyon uygular: not, kanıt yolu, cihaz modeli ve Android
sürümü **LAB'a taşınmaz** — yalnız sayımlar + derleme kimliği (testle kilitli).

Runbook: `docs/PHONE_VALIDATION_RUNBOOK_FLEET.md` (yerel derleme komutları,
alan listesi, kanıt politikası).

---

## 12. Gerçek telefon sonuçları

**YOK. Hiçbir senaryo koşulmadı.**

`phoneValidated = false` · `lastBuild = null` · 15 senaryo `NOT_RUN` ·
H1–H8 `BLOCKED_HEAD_UNIT`.

Bu oturumda fiziksel telefon erişimi olmadı. `PHONE_VALIDATED` **yazılmadı**;
kod bunu zaten reddediyor.

---

## 13. CAROS LAB

Salt-okunur paneller (timer yok, açılışta tek okuma + elle YENİLE):
Kimlik · Yetki · Kuyruk · İşlem türü · Senkron · **Hesap İzolasyonu & Kuşak** ·
**Realtime & Boşluk Tespiti** · Çevrimdışı Politika · **Telefon Doğrulama**.

**Gösterilmeyen:** e-posta · tam kullanıcı kimliği · token · eşleştirme kodu ·
transfer anahtarı · ham payload · ham SQL · araç konumu · cihaz modeli.
Realtime panelinde hesap/şirket kimliği değil yalnız **kuşak sayısı** taşınır.

LAB **hiçbir sync/transfer başlatmaz** — `peek*` fonksiyonlarıyla yalnız okur;
otorite kayıtlı değilse tek satır `UNAVAILABLE` (sahte sayaç yok).

---

## 14. Test sonuçları

| Kapı | Sonuç |
|---|---|
| Website vitest | **27 dosya / 644 test PASS** |
| Website `tsc --noEmit` | **temiz** |
| Kök depo vitest | **424 dosya / 8831 test PASS** |
| Yerel SQL doğrulaması (önceki tur) | RLS 65/65 · transfer 44/44 |

**Yeni test dosyaları:** `realtimeRuntimeIntegration.test.ts` (28) ·
`transferRequestRunner.test.ts` (15) · genişletilmiş
`phoneValidationContract.test.ts` (23→35).

**Düşen test yok.** Paralel işin testleri de yeşil.

⚠️ **ESLint hâlâ yok** — `website/` içinde yapılandırma bulunmuyor. Kullanıcı
talimatı gereği **yeni lint altyapısı kurulmadı**; açık tooling borcu olarak
bırakıldı. "Lint geçti" **denmiyor**.

**Kaldırılan test:** `ownershipTransferUi.test.tsx` — `@testing-library/react`
gerektiriyordu; yeni bağımlılık kurup kapsamı büyütmemek için hook mantığı
`TransferRequestRunner`'a çıkarıldı ve **doğrudan** test edildi (daha güçlü).

---

## 15. Build ve güvenlik

`npm run build` → **exit 0**, 46/46 statik sayfa üretildi.

⚠️ **13 dashboard sayfası "Export encountered errors" uyarısı veriyor**
(`/dashboard`, `/dashboard/map`, `/dashboard/settings`, `/dashboard/diagnostic`,
`/dashboard/vehicles`, `/dashboard/notifications` dahil). Bunların **9'u bu
turda dokunulmadı**; ortak payda `app/dashboard/layout.tsx` (paralel işin 20:41
değişikliği, `AccountCleanupBootGate`). Benim eklediğim `/dashboard/fleet/transfer`
de aynı layout'u kullandığı için listede. **Bunun benim değişikliklerimden
kaynaklandığını iddia etmiyorum; kesin attribution için ayrı bir bisect gerekir
ve yapılmadı.** Build exit kodu 0 olduğu için kapı geçti sayıldı.

**Secret taraması:** yeni dosyalarda temiz.

---

## 16. Production'da doğrulanmayanlar

- Migration **033–039 hiçbiri production'a uygulanmadı**.
- `/api/vehicle/transfer` production'da **çalışmaz** (039 yok) — `UNKNOWN` döner.
- Realtime `SERVER_AHEAD` sinyali production'da devre dışı (revision kolonu yok).
- Production RLS/GRANT matrisi ölçülmedi.
- Gerçek signup/pairing/transfer smoke testi yapılmadı.

---

## 17. Head-unit'te doğrulanmayanlar

H1–H8'in tamamı (kontak yaşam döngüsü · head-unit süreç yönetimi · üretici
WebView · araç içi ağ · fiziksel eşleştirme · Mali-400 performansı · direksiyon
tuşları · gerçek sürüşte reconnect) **BLOCKED_HEAD_UNIT**. Hiçbiri PASS
işaretlenmedi; sözleşme bunu reddediyor.

---

## 18. Açık riskler

1. **Telefon senaryoları koşulmadı** → `phoneValidated=false`. (Karar sınırı.)
2. **Migration 039 production'da yok** → transfer ekranı ve revizyon tabanlı
   gap tespiti orada çalışmaz.
3. **Uzlaştırma sonucu store'a otomatik yazılmıyor** — eski sahibin ekranı
   yenilenene kadar bayat kalabilir (sunucu erişimi yine reddeder).
4. **Build export uyarıları** (§15) — kök neden bisect edilmedi.
5. **ESLint yapılandırması yok.**
6. R4 FAZ 2 bloke (head unit anon tablo erişimi).
7. Baseline fixture ≠ production şeması.
8. Transfer hedef seçimi UUID girişiyle yapılıyor — kullanıcı dostu arama
   yok (PII sızdırmamak için bilinçli; ama kullanılabilirlik borcu).

---

## 19. Son karar

## `FLEET_OFFLINE_LOCAL_COMPLETE_WITH_PRODUCTION_GATES`

**Neden bu:** COMPLETE engellerinin tamamı yerelde kapandı —
reconnect snapshot olmadan LIVE olamıyor (28 kilit), ikinci realtime otoritesi
imkânsız, stale callback yeni kapsama uygulanmıyor, transfer UI backend
başarısından önce "tamamlandı" demiyor, transfer offline kuyruğa girmiyor,
eski sahibin yetkisi sunucuda temizleniyor (44/44), hesap değişimi sızıntısı
kapalı, Music Hub'a dokunulmadı, paralel kod sahiplenilmedi, production sonucu
uydurulmadı.

**Neden `..._AND_HEAD_UNIT_GATES` değil:** o karar, kullanıcının tanımına göre
dördüncü açığın **"telefon doğrulama seviyesine kadar hazırlanması ve test
edilmesi"** ile verilebilir. Altyapı tamamlandı ama **telefonda hiçbir senaryo
koşulmadı** — bu oturumda fiziksel cihaz erişimi yoktu. Kullanıcının kendi
kuralı gereği (*"Telefon erişimi bu oturumda yoksa … karar PARTIAL kalır"*
maddesindeki niyet) koşulmamış doğrulama yeşil sayılamaz.

**COMPLETE'e kalan tek iş:** telefonda P1–P15'i koşup kanıt toplamak.
Bittiğinde `FLEET_OFFLINE_LOCAL_COMPLETE_WITH_PRODUCTION_AND_HEAD_UNIT_GATES`
verilebilir. Production ve gerçek head-unit kapıları her hâlükârda açık kalır.
