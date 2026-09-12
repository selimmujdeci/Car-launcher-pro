# CAROS PRO — DRIVER PRESENCE HISTORY P1 RAPORU

**Tarih:** 2026-07-30
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Driver Presence P1 üzerine **varlık geçmişi (segment defteri)**.
**Mevcut resolver:** **DEĞİŞTİRİLMEDİ** (tek satır bile)
**NFC / Bluetooth implementasyonu:** **YAPILMADI** (kapsam dışı)
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `presenceResolverP1RegressionVerdict` | **`PRESERVED`** (değiştirilmedi + 19/19 yeniden geçti) |
| `driverIdentityP0RegressionVerdict` | **`PRESERVED`** (54/54 yeniden geçti) |
| `realDeviceValidationVerdict` | **`BLOCKED_REAL_DEVICE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

Gözlem üreten gerçek bir kaynak (NFC/Bluetooth) hâlâ yok; defter gerçek
veriyle **hiç dolmadı** → saha doğrulaması **`BLOCKED_REAL_DEVICE`**.

---

## 2. HANGİ SORUYU CEVAPLIYOR — P1'DEN FARKI

| | Presence (P1) | **Presence History (bu tur)** |
|---|---|---|
| Soru | "ŞU AN kim araçta?" | **"Varlık ZAMAN İÇİNDE nasıl değişti?"** |
| Tuttuğu | TEK gözlem | **Segment defteri** |
| Doğası | Karar girdisi | **Defter — karar DEĞİL** |
| Cevapladığı | kim | kim · ne zaman geldi · ne kadar kaldı · yerine kim geçti · kaç kez el değiştirdi |

---

## 3. "MEVCUT RESOLVER DEĞİŞMEYECEK" — NASIL GARANTİ EDİLDİ

Bu, paketin **en sıkı kısıtıydı** ve dört ayrı kapıyla kilitlendi:

| # | Kapı | Nerede |
|---|------|--------|
| 1 | `resolveDriverPresence` gövdesi **düzenlenmedi**; geçmiş ayrı dosyada (`driverPresenceHistory.ts`). `driverPresence.ts`'te yalnız **depo** (`record`/`clear`/`readHistory`) + import + `readVehicleId` değişti | Fonksiyon gövdesi **65 satır**, P1'deki hâliyle birebir aynı. ⚠️ `git diff` bu dosya için **kanıt olarak kullanılamaz**: dosya P1 turunda oluşturuldu ve hiç commit edilmedi (`?? untracked`) — kanıt aşağıdaki üç kilittir |
| 2 | Kilit: resolver gövdesinde `history` / `segment` geçmesi **YASAK** | Test I1 |
| 3 | Kilit: defter dolarken resolver çıktısı **bit bit aynı** | Test I3 |
| 4 | Migration 050 `_resolve_driver_presence`, `_trip_attribution_trigger`, `_resolve_trip_driver` fonksiyonlarını **yeniden tanımlamaz**; attribution trigger gövdesinde `presence_history` geçerse migration **DÜŞER** | Test L1/L3 + 050 doğrulama (d) |

Ayrıca 049'un tam matrisi (19/19) ve P0'ın tam matrisi (54/54) **050
uygulandıktan sonra** yeniden koşuldu ve tamamı geçti.

---

## 4. SEGMENT MODELİ VE DEDUPE

Defter gözlem **yığını** değil, **segment** defteridir:

```
segment kimliği = (vehicleId, driverId, source)
```

Aynı sürücü kartını 10 kez okutursa bu **10 satır değil, süresi uzayan TEK
satırdır** (`refreshCount` artar). Yeni segment ancak **sürücü veya kaynak
değişince** açılır. İstenen "aynı presence tekrar history üretmesin"
davranışı budur.

Üç savunma katmanı:

1. **TS**: `recordPresenceHistory` aynı kimlikte tazeler, satır açmaz.
2. **PG trigger**: aynı `(driver_id, source)` açık segmenti `UPDATE` eder.
3. **PG kısıt**: `vdph_observation_unique (vehicle_id, driver_id, source, detected_at)` —
   mantık bozulsa bile veritabanı ikinci satırı **reddeder** (fail-closed).

Ek kilit: `vdph_single_open_per_vehicle` kısmi unique index — bir araçta
**aynı anda tek açık segment**. İki açık segment "iki kişi aynı anda
sürüyor" demektir ve bir veri hatasıdır.

---

## 5. SÜRESİ DOLAN PRESENCE NASIL KAPATILIYOR

Üç kapanış gerekçesi vardır ve **gerekçesiz kapanış yoktur**:

| Gerekçe | Ne zaman | Kapanış anı |
|---------|----------|-------------|
| `SUPERSEDED` | yerine başka presence geçti | `min(yeni gözlem anı, eski TTL)` |
| `TTL_EXPIRED` | gözlemin süresi doldu | **gözlemin kendi TTL'i** |
| `CLEARED` | oturum/araç değişimi | verilen an; **verilmezse `NULL`** |

### Neden kapanış anı "okuma anı" değil

Sabah 09:00'da okutulan, TTL'i 17:00 olan bir kart, ertesi gün 11:00'de
okunduğunda **17:00'de** kapanır — 11:00'de değil. Aksi halde sürücü
26 saat araçta görünürdü. Kilit: PG `H10`, TS `E2`.

### Sahte süre yasak

- **Açık segmentte `expiredAt = NULL`, `durationMs = NULL`** — `0` DEĞİL.
- DB'de `vdph_close_consistent` CHECK'i **yarım kapanışı reddeder**:
  üçü (`expired_at`, `duration_ms`, `close_reason`) birlikte dolar veya
  birlikte boş kalır. "Kapandı ama süresi yok" bir defteri sessizce
  yalancı yapar.
- Kapanış anı bilinmiyorsa **uydurulmaz**: gerekçe yazılır, süre `NULL`
  kalır (TS `F2`).

### Kapanış TEMBELDİR (açık borç, gizlenmiyor)

PostgreSQL'de timer yoktur. Bir segment, **yeni gözlem gelene** veya
`settle_expired_presence_history()` çağrılana kadar tabloda açık kalır.
İki savunma:

- **Okuma yüzeyi gerçeği söyler:** `list_vehicle_presence_history`
  süresi geçmiş segmenti `status='TTL_EXPIRED'` ve gerçek `expired_at`
  ile döndürür — asla `OPEN` demez (PG `H24`).
- **Bakım fonksiyonu** kapanışı kalıcılaştırır; yalnız `service_role`
  çağırabilir (kullanıcı defteri kapatamaz — PG doğrulama (f)).

Bu gecikme **kütüğe #237 olarak 🔴 yazıldı**.

---

## 6. ÇEVRİMDIŞI REPLAY — GEÇ GELEN ESKİ GÖZLEM

Üç gün sonra gelen eski bir gözlem, **daha yeni segmenti bozmaz**:
geçmişteki dönem olduğu gibi **KAPALI** kaydedilir
(`close_reason='SUPERSEDED'`, bitişi yeni segmentin başlangıcı). Kilit:
PG `H13`/`H14`.

---

## 7. FLEET UI — "SON GÖRÜLEN SÜRÜCÜ"

Araç detayına (`VehicleModal`) eklendi. **En kritik karar burada**:

> Doğrulanmamış kaynak **isim göstermez.**

Head unit `anon` rolünde çalışır; "ben Ahmet'im" beyanı kimlik kanıtı
değildir. 049'da bu kapı kapatılmıştı — geçmiş ekranından **arkadan
dolanılamaz**. İki kapı:

1. **Sunucu (050):** `list_vehicle_presence_history`, `HEAD_UNIT`/`PHONE`
   kayıtlarında `driver_id` ve `driver_name` alanlarını **NULL** döndürür.
   Kaynak ve süre görünür, **kimi iddia ettiği görünmez**.
2. **İstemci:** `buildPresenceHistoryEntry` aynı düşürmeyi tekrarlar;
   bayrak eksikse "doğrulandı" **varsaymaz** (fail-closed).

Kullanıcıya dönük dört ayrı durum — hiçbiri diğerine karışmaz:

| Durum | Metin |
|-------|-------|
| RPC okunamadı | **"Okunamadı"** |
| Okundu, kayıt yok | **"Kayıt yok"** |
| Kayıt var ama hepsi doğrulanmamış | **"Doğrulanmamış gözlem — sürücü belirlenemedi"** + gerekçe |
| Doğrulanmış gözlem | sürücü adı + kaynak · durum · süre |

Ayrıca alanın altında açıkça yazar: *"Bu bir gözlemdir, yolculuk sürücüsü
kararı değildir."* Trip attribution gösterimi **silinmedi** — ikisi ayrı
kalır.

---

## 8. CAROS LAB — YENİ EKRAN

`fleet-presence-history` (kategori `vehicle`, `AVAILABLE`) — **ayrı**
ekran. `Fleet Driver Identity` ekranı **silinmedi**: ikisi ayrı soruya
cevap verir.

Gösterilenler: `switchCount` · `segmentCount` ·
`deduplicatedObservations` · `droppedSegments` · `maxLedgerEntries` ·
`latestSegmentStatus` · **Current Presence** (`currentDuration` + segment
alanları) · **Previous Presence** (`previousDuration` + segment alanları) ·
defter listesi (yeniden eskiye).

Gözlemlenebilirlik şartları:

| # | Şart | Durum |
|---|------|-------|
| 1 | Özellik uygulandı | ✅ |
| 2 | Salt-okunur LAB ekranı | ✅ |
| 3 | Gerçek veri kaynağı (sabit veri yok) | ✅ `readDriverPresenceHistory` |
| 4 | Aktif komut göndermiyor | ✅ (kilit K3/K4) |
| 5 | Kanıtsız bilgi yok | ✅ `UNAVAILABLE`, sahte 0 yok |
| 6 | Gizli veri taşınmıyor | ✅ `drv:` / `veh:` · mutlak zaman damgası yok |
| 7 | Unit test + kütük maddesi | ✅ 77 kilit (53 + 24) · #236–#238 |

---

## 9. BACKEND — MIGRATION 050

`supabase/migrations/20260730000050_driver_presence_history_p1.sql` —
yalnız ileri; 033–049 değiştirilmedi.

**Yeni:** `vehicle_driver_presence_history` ·
`_presence_duration_ms` · `_presence_history_trigger`
(`AFTER INSERT ON vehicle_driver_presence`) ·
`settle_expired_presence_history` (yalnız `service_role`) ·
`list_vehicle_presence_history` (RPC).

**Değiştirilmeyen:** `_resolve_driver_presence` · `_trip_attribution_trigger` ·
`_resolve_trip_driver` · `vehicle_driver_presence` · `vehicle_trips` ·
`fleet_drivers` · `vehicle_driver_assignments`.

**Kısıtlar:** `expires_at > detected_at` · `expired_at >= detected_at` ·
**yarım kapanış yasak** · kaynak/güven/gerekçe enum'ları ·
`refresh_count >= 0` · tek açık segment · gözlem tekilliği.

**RLS/izinler:** `anon` **hiç okuyamaz** · `authenticated` yalnız
**SELECT** (INSERT/UPDATE/DELETE **yok** — defteri elle "düzeltebilmek"
onu kanıt olmaktan çıkarırdı) · şirket bazlı policy ·
`settle_*` yalnız `service_role`.

**İdempotency:** ikinci uygulamada da `050 OK`.

---

## 10. GERÇEK POSTGRESQL KANITI

Canlı yerel Supabase (`supabase_db_fleetval`, PostgreSQL 17.6) üzerinde,
migration **gerçekten uygulanarak** koşuldu.

### 050 — Presence History: **27/27 PASS**

```
H1   presence degisimi HISTORY uretti                       PASS
H2   ACIK segment sahte sure/kapanis URETMEDI               PASS
H3   istenen alanlar (driver/source/conf/detected/vehicle)  PASS
H4   5x AYNI presence YENI segment URETMEDI (dedupe)        PASS
H5   tekrar gozlemler SAYILDI (sessiz yutma yok)            PASS
H6   birebir ayni gozlem DB seviyesinde REDDEDILDI          PASS
H7   onceki segment DEVREDILDI, sure OLCULDU (2 sa)         PASS
H8   ayni anda TEK acik segment (iki surucu birden YOK)     PASS
H9   SURESI DOLAN segment TTL ile kapandi (8 sa)            PASS
H10  kapanis ani UYDURULMADI (TTL kullanildi)               PASS
H11  YARIM kapanis REDDEDILDI (sure+gerekce zorunlu)        PASS
H12  baslangictan ONCE kapanis REDDEDILDI                   PASS
H13  GEC GELEN eski gozlem KAPALI kaydedildi (replay)       PASS
H14  gec gozlem YENI segmenti BOZMADI                       PASS
H15  HEAD_UNIT gecmiste de LOW (istemci yukseltemez)        PASS
H16  049 RESOLVER kararlari AYNEN calisiyor (PRESENCE_ONLY) PASS
H17  gozlemsiz aralikta NO_PRESENCE KORUNDU                 PASS
H18  P0 fail-closed KORUNDU (gecmis fallback URETMEDI)      PASS
H19  attribution kararini HALA RESOLVER veriyor (defter degil) PASS
H20  suresi gecmis ACIK segmentler KAPATILDI (1 adet)       PASS
H21  kapanan her segmentin SURESI var (yarim kapanis yok)   PASS
H22  HEAD_UNIT kaydi gecmiste KIMLIK SIZDIRMADI             PASS
H23  NFC/BT kaydinda kimlik OKUNABILIYOR                    PASS
H24  suresi gecmis segment OPEN GOSTERILMEDI                PASS
H25  ANON okuyamaz · authenticated defteri DEGISTIREMEZ     PASS
H26  B admini A gecmisini GOREMIYOR (RLS)                   PASS
H27  gecmisi ELLE yazan/silen RPC YOK                       PASS
```

### 049 — Presence P1 regresyonu: **19/19 PASS · 0 FAIL**

050 uygulandıktan **sonra** yeniden koşuldu → `PRESERVED`.

### 048 — Driver Identity P0 regresyonu: **54/54 PASS · 0 FAIL**

050 uygulandıktan **sonra** yeniden koşuldu → `PRESERVED`.

---

## 11. TEST SONUÇLARI

| Dosya | Adet |
|-------|------|
| `src/__tests__/driverPresenceHistory.test.ts` | **53** (yeni) |
| `website/src/__tests__/driverPresenceHistoryView.test.ts` | **24** (yeni) |

Kapsam: sözleşme · açık segmentte sahte süre yasağı · dedupe · devir ve el
değiştirme · TTL kapanışı ve idempotency · elle kapatma · özet (current ·
previous · duration · switch) · bellek sınırı · **resolver değişmedi
kilitleri** · depo entegrasyonu · LAB yüzeyi · **8 migration sözleşme
kilidi** · Fleet UI kilitleri · etiketler.

### Regresyon kapıları

| Kapı | Sonuç |
|------|-------|
| Kök `vitest` | **9 310 / 9 310 PASS** (439 dosya) |
| `website` `vitest` | **866 / 866 PASS** (41 dosya) |
| Kök `tsc -b` | **TEMİZ** |
| `website` `tsc --noEmit` | **TEMİZ** |
| `eslint` (yeni/değişen dosyalar) | **TEMİZ** |
| `npm run build` | **GEÇTİ** (1 dk 13 sn) |
| Migration 050 idempotency | `050 OK` (2. uygulamada da) |
| **Presence P1 resolver** | **PRESERVED** (19/19 PG) |
| **Driver Identity P0** | **PRESERVED** (54/54 PG) |
| Trip Metrics P2 · Fleet P0/P1 · Location · Realtime · Offline Queue | **PRESERVED** |
| Music Hub · AccountCleanup | **DOKUNULMADI** |

> Not: P1 raporunda "yük altında timeout" olarak işaretlenen
> `regression.guards.test.ts` kilidi **bu koşumda tam paketle birlikte
> geçti** — o testin makine yüküne duyarlı olduğu teşhisi doğrulanmış
> oldu. Dosyaya dokunulmadı.

### İki test kusurumu ayırdım (ürün kusuru olarak raporlamadım)

1. **`J1`/`J2`** — `clear()` sonrası defterin boşalacağını varsaymıştım.
   Yanlış olan varsayımdı: **bir oturumun bitmesi geçmişi yok etmez**,
   yalnız açık segmenti kapatır. Testler göreli sayıma çevrildi ve bu
   davranış `J5` ile ayrıca **kilitlendi**.
2. **`F5`** — `indexOf('fetchVehiclePresenceHistory')` import satırını
   yakalıyordu, çağrı yerini değil. Kilit `await …(` çağrısına
   çıpalandı. (P1 raporu §10'daki *"metin araması niyet kanıtı
   değildir"* dersinin aynısı.)

---

## 12. GERÇEK CİHAZ DURUMU

### `realDeviceValidationVerdict: BLOCKED_REAL_DEVICE`

Ölçülmedi: gerçek NFC kart okuması, gerçek Bluetooth eşleşmesi, gerçek
vardiya devri, 8 saat bekleyip TTL kapanışının gözlenmesi, Fleet UI'da
gerçek "son görülen sürücü" verisi, çevrimdışı replay'in gerçek cihazdan
gelmesi.

**Bu paket gözlem üreten bir kaynak uygulamıyor** — defter kuruldu,
üreticisi bağlanmadı. Simülasyon saha kanıtı olarak sunulmuyor.

Kütüğe 🔴 **#236–#238** eklendi.

---

## 13. DEĞİŞEN DOSYALAR

**Yeni:** `src/platform/fleet/driverPresenceHistory.ts` ·
`src/components/devtools/screens/FleetPresenceHistoryScreen.tsx` ·
`supabase/migrations/20260730000050_driver_presence_history_p1.sql` ·
`supabase/verification/local_050_driver_presence_history.sql` ·
`website/src/lib/fleet/driverPresenceHistoryView.ts` ·
`src/__tests__/driverPresenceHistory.test.ts` ·
`website/src/__tests__/driverPresenceHistoryView.test.ts` · bu rapor

**Değiştirilen:** `src/platform/fleet/driverPresence.ts` (**yalnız depo** —
resolver'a dokunulmadı) · `src/platform/devtools/carosLabCatalog.ts` ·
`src/components/devtools/carosLabScreenMap.tsx` ·
`website/src/lib/vehicles.service.ts` ·
`website/src/components/dashboard/VehicleModal.tsx` · kütük · vizyon

**Dokunulmayan:** `resolveDriverPresence` · `_resolve_driver_presence` ·
`_trip_attribution_trigger` · `_resolve_trip_driver` ·
`FleetDriverIdentityScreen` · `vehicle_driver_presence` · `vehicle_trips` ·
Trip Metrics P2 · Music Hub · AccountCleanup

---

## 14. AÇIK BORÇLAR

| # | Borç |
|---|------|
| **G1** | **Gözlem üreten kaynak yok** (NFC okuyucu · BT eşleşme doğrulaması) — defter gerçek veriyle hiç dolmadı (P1'in F1/F2 borçları devam ediyor) |
| **G2** | **TTL kapanışı TEMBEL** — okuma gerçeği söyler ama tablo satırı gecikmeli kapanır; `settle_expired_presence_history()` çağıran bir zamanlayıcı/cron **YOK** (kütük #237) |
| **G3** | **Head unit'te araç kimliği bağlı değil** — `vehicleId` gözlemin kendisinden okunur, üretici olmadığı için pratikte `null`; segmentler araca göre ayrışamaz |
| **G4** | **Defter yalnız cihaz belleğinde** — head unit tarafında kalıcılık yok; yeniden başlatmada TS defteri sıfırlanır (sunucu defteri kalıcıdır) |
| **G5** | **Gerçek cihaz doğrulaması** (#236–#238 🔴) |
| **G6** | 040–050 hiçbir ortama uygulanmadı (yalnız yerel doğrulama DB'si) |

---

## 15. DÜRÜSTLÜK BEYANI

Bu paketin ürettiği şey **çalışan bir özellik değil, doğru kurulmuş bir
defterdir**:

- Segment modeli, dedupe, TTL kapanışı ve okuma yüzeyi **hazır ve testli**.
- Defteri dolduran **hiçbir gerçek kaynak yok** — ve bu bilinçli.
- Bu yüzden bugün Fleet UI'da "Son görülen sürücü" **"Kayıt yok"** der,
  LAB defteri **boştur**, attribution davranışı **P1'deki gibi bit bit
  aynıdır**.

En önemli tasarım kararı yine katmanın **ne yapmadığıdır**: geçmiş defteri
attribution kararına **girmedi**. Girmesi kolay ve cazip olurdu ("son
görülen sürücüyü trip'e yaz") — ama o an bir gözlem sessizce bir kanıta
dönüşür ve `resolveDriverPresence`'ın tek otorite olması biterdi.
Migration doğrulaması bu yüzden trigger gövdesinde `presence_history`
kelimesinin geçmesini bile **yasaklıyor**.

İkinci en önemli karar: **doğrulanmamış kaynak isim göstermiyor.** Head
unit beyanını "son görülen sürücü" olarak yazmak tek satırlık bir iş
olurdu ve ekran hemen dolardı — ama o an 049'da bilinçle kapatılan kapı,
bir UI alanı üzerinden arkadan dolanılmış olurdu.
