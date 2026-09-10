# CAROS PRO — FLEET VEHICLE CONNECTIVITY P0 RAPORU

**Tarih:** 2026-07-30
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Fleet araç bağlantı + telemetri zincirinin production-quality hale getirilmesi
**Commit/push/deploy/db push/production migration:** YAPILMADI (kural gereği)

---

## 1. NİHAİ KARAR

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`FLEET_VEHICLE_CONNECTIVITY_P0_PARTIAL`** |
| `phoneValidationVerdict` | **`PRESERVED`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |
| `externalGpsVerdict` | **`NOT_IMPLEMENTED_BY_SCOPE`** |
| `engineOffLiveLocationVerdict` | **`NOT_IMPLEMENTED_BY_SCOPE`** |

### Neden `PARTIAL`, `COMPLETE_LOCAL` değil

Talimat açıktı: *"Kanıtsız PASS verme. Kod ve test sonucu arasında fark varsa düşük kararı seç."*
İki kanıt eksiği var:

1. **`website` production build kapısı GEÇMİYOR** — ancak sebep bu paket DEĞİL: paralel
   AccountCleanup çalışmasının **izlenmeyen** `src/hooks/useSessionUser.ts` dosyası
   `accountCleanup/authSessionGenerationGuard`'ı çekiyor, o da `getAccountCleanupRuntime()`
   içindeki `if (typeof window === 'undefined') throw new Error('ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY')`
   muhafızına takılıyor. Her dashboard sayfası `useSessionUser` kullandığı için **13 sayfanın
   tamamının** prerender'ı düşüyor. "Paralel çalışmayı bozma / başka ajanın değişikliğini
   resetleme" kuralı gereği o dosyaya DOKUNULMADI. Ayrıntı: §14.
2. **Hiçbir madde gerçek araçta/telefonda doğrulanmadı** — kütükte #197–#202 🔴 bekliyor (§15).

Yerel kanıt tamdır (§10, §11): 9 613 birim/entegrasyon testi yeşil, iki tsc temiz,
26 gerçek-PostgreSQL sözleşme doğrulaması yeşil, migration 042 idempotent.

---

## 2. ÖN DOĞRULAMA (§1 yeniden doğrulama)

| Soru | Koddan doğrulanan gerçek |
|------|--------------------------|
| **A. Araç nasıl bağlanıyor?** | TEK kanonik yol: head unit `register_vehicle` RPC'si ile araç kaydını ve `api_key`'i alır → `refresh_linking_code` ile **6 haneli kısa ömürlü kod** üretir → kullanıcı kodu Filo panosuna girer → `POST /api/vehicle/link` → `pair_vehicle_to_user(p_code, p_user_id)` RPC'si sahipliği bağlar. Kod doğrulaması **istemcide tablo okunarak yapılmıyor** (RLS atlanmıyor). |
| **B. Bağlandıktan sonra hangi veriler geliyor?** | `push_vehicle_event(p_api_key, p_type, p_payload)` → `vehicle_events` + `vehicle_telemetry` + `vehicle_locations`. Okunan alanlar: `speed · fuel · temp · rpm · lat · lng · heading` (+ 042 ile `accuracyM · observedAt · gpsObservedAt · obdObservedAt · source · locationSource`). Kadans: sürüşte 5 s · park 10 dk · derin uyku 1 sa (<11.8 V). |
| **C. Verilerin kaynağı?** | `speed` füzyonlanmış (OBD + GPS Doppler, `speedFusion`); `rpm/temp/fuel` yalnız OBD (`getOBDDataSnapshot`); `lat/lng/heading/accuracy` yalnız head unit GPS. **Harici GPS kaynağı YOK.** |
| **D. Harici GPS?** | Kodda hiçbir harici GPS/tracker girişi yok. Kapsam dışı → `NOT_IMPLEMENTED_BY_SCOPE`. 042 yalnız `EXTERNAL_GPS` enum değerini **ileriye dönük** olarak CHECK kısıtına ekledi; onu üreten hiçbir yol yok. |
| **E. Araç kapalıyken?** | Head unit kapanır → hiçbir şey gönderilmez. PWA `updated_at` 11 dk'yı geçince araç "offline" sayılır. **Kontak kapalıyken canlı takip YOK** → `NOT_IMPLEMENTED_BY_SCOPE`. |

---

## 3. BULUNAN KUSURLAR (ölçülmüş, varsayım değil)

| # | Kusur | Kanıt | Etki |
|---|-------|-------|------|
| **K1** | `rpm` ve `engineTempC` telemetri payload'ına **HİÇ konmuyordu** | `telemetryService._push()` eski gövdesi | Fleet'te motor devri ve motor sıcaklığı **kalıcı 0** |
| **K2** | Bilinmeyen hız `speed: this._state.speed ?? 0` ile **0 olarak gönderiliyordu** | aynı yer | "Araç duruyor" yalanı |
| **K3** | RPC `coalesce(NULLIF(payload->>'speed',''),0)` ile bilinmeyeni **DB'de 0'a çeviriyordu** | 039 öncesi `push_vehicle_event` gövdesi | Yalan kalıcılaştı |
| **K4** | Bayat OBD/GPS verisi **canlı gibi** gönderiliyordu | tazelik kapısı yoktu | Kontak kapalı araç "çalışıyor" görünüyordu |
| **K5** | İstemci saati **otorite** kabul ediliyordu | `observed_at` yoktu | Saati ileri cihaz gelecekten veri yazabilirdi |
| **K6** | `/api/pwa/pair` **var olmayan** `pair_vehicle(text)` RPC'sini çağırıyordu | Hiçbir migration'da tanımlı değil (035:613 yalnız REVOKE/GRANT) | Sessiz 500 |
| **K7** | Aynı rota **kimlik doğrulamasız** çalışıyor ve **HAM `api_key` döndürüyordu** | rota eski gövdesi | Kritik güvenlik açığı |
| **K8** | `vehicles.pairing_code` kolonu **hiç oluşturulmamıştı** | migration taraması | Rota yapısal olarak ölüydü |
| **K9** | PWA ekranı **QR eşleştirmesini destekleniyormuş gibi** gösteriyordu | `PairingScreen` mod sekmeleri | Ürün yalanı |
| **K10** | `tel?.fuel ?? 0` → yakıt bilinmeyen araçta **kırmızı boş çubuk + "⚠ Yakıt ikmali gerekiyor"** | `vehicles.service.ts` + `VehicleCard/Modal` | **Sahte kritik alarm** |
| **K11** | Bekçi, araç çevrimdışına düşünce **`speed: 0, rpm: 0` YAZIYORDU** | `vehicleStore.startWatchdog` | 90 km/h'te kopan bağlantı "0 km/h" oluyordu |
| **K12** | `initializeFromLocal` aracı `lat:0, lng:0` ile kuruyordu | aynı dosya | Gine Körfezi'nde hayalet araç |
| **K13** | Sinyal başına tazelik YOKTU (tek `updated_at < 11dk` ölçütü) | `vehicleOfflineStatus` | "Cihaz ayakta" ile "konum güncel" karışıyordu |
| **K14** | Araç kimliği (VIN/parmak izi/protokol) **sunucuya hiç taşınmıyordu** | şema taraması | Araç değişimi tespit edilemiyordu |

---

## 4. TEK EŞLEŞTİRME OTORİTESİ (§2)

**Kanonik akış (değiştirilmedi, korundu):**
`head unit register_vehicle` → `6 haneli kod` → `Filo panosu → Araç Ekle` → `POST /api/vehicle/link` → `pair_vehicle_to_user`

Tek kaynak: `website/src/lib/deprecatedPairingRoutes.ts` (`CANONICAL_PAIRING_FLOW` + gerekçeli kayıt).

---

## 5. KAPATILAN ÖLÜ YOLLAR (§3)

| Yol | Neden kapatıldı | Yeni davranış |
|-----|-----------------|---------------|
| `/api/pwa/pair` | K6 + K7 + K8 | **410** `PAIRING_FLOW_UNAVAILABLE` |
| `/api/vehicle/register` | Head unit bu rotayı hiç çağırmıyor; ikinci kayıt otoritesi | **410** `ROUTE_DEPRECATED` |
| `/api/vehicle/code` | `vehicle_linking_codes`'a **ikinci yazma yolu**; head unit doğrudan `refresh_linking_code` kullanıyor | **410** `ROUTE_DEPRECATED` |

Üç rota da artık: Supabase istemcisi **kurmuyor**, tablo/RPC **çağırmıyor**, istek gövdesi
**okumuyor**, `api_key` **döndürmüyor** (13 kilit testi ile sabitlendi).

`PairingScreen`: QR sekmesi kaldırıldı, kullanıcı kanonik akışa yönlendiriliyor
(*"Bu ekrandan eşleştirme şu an kullanılamıyor… Filo panosu → Araç Ekle… 6 haneli kodu girin"*).

---

## 6. TELEMETRİ SÖZLEŞMESİ (§4)

**Yeni saf katman:** `src/platform/telemetry/telemetryContract.ts`

| Kural | Uygulama |
|-------|----------|
| Değer yoksa alan **KONMAZ** | `undefined` → anahtar payload'da **hiç yok** (null/0 gönderilmiyor) |
| `0` yalnız **ölçülen** 0 | `sanitizeMetric(0) === 0`; `-1` (OBD "desteklenmiyor") → `null` |
| NaN/Infinity/aralık dışı **REDDEDİLİR** | `TELEMETRY_RANGES`: rpm 0–20 000 · temp −50…250 · hız 0–400 · yakıt 0–100 · lat ±90 · lng ±180 · heading 0–360 · accuracy 0–10 000 |
| Eski değer **EZİLMEZ** | RPC'de her alan `COALESCE(EXCLUDED.x, t.x)` |
| `received_at` / `observed_at` **AYRI** | `v_obs := LEAST(now(), to_timestamp(observedAt/1000))` → istemci saati otorite DEĞİL; `received_at = now()` |
| Bayat OBD/GPS **EKLENMEZ** | `not_connected` · `not_fresh` · `stale_window` · `no_data` / `no_fix` · `invalid_coords` gerekçeleriyle atlanır |
| `accuracy` **kalıcı ve sorgulanabilir** | `vehicle_telemetry.accuracy_m` + `vehicle_locations.accuracy_m` |

`speed` hâlâ füzyonlanmış; OBD hızı yoksa füzyon yedeğe geçer, `speedConfidence` 0–1'e kırpılır.

---

## 7. ARAÇ KİMLİĞİ VE ÇAKIŞMA (§5)

**Yeni tablo:** `public.vehicle_identity` (vin · vin_source · make · model · model_year ·
fingerprint_hash/version · active_obd_protocol · identity_confidence · identity_conflict_count ·
last_conflict_at · last_conflict_reason)

**Yeni RPC:** `record_vehicle_identity(...)` — `api_key` ile kimlik doğrular, **yalnız**
`{state, conflict, identityConfidence, reason?}` döner (ham `api_key`/VIN **DÖNMEZ**).

| Davranış | Değer |
|----------|-------|
| İlk kayıt | güven **0.50** (VIN varsa **0.70**) |
| Aynı kimlik tekrar | **+0.10**, üst sınır **0.95** |
| VIN/parmak izi değişti | `IDENTITY_CONFLICT` · sayaç +1 · güven **0.30** · **eski değer KORUNUR** · gerekçe `VIN_MISMATCH`/`FINGERPRINT_MISMATCH` |
| Geçersiz VIN şekli | `null` (kısaltılmaz, tamamlanmaz) |
| Bilinmeyen `vin_source` | `UNVERIFIED` |

**Güven puanı istemcide ÜRETİLMEZ** — gövdede güven alanı yok (kilit testi #7).
Okuma RPC'si `list_company_vehicle_identity()` VIN'i **maskeli** döndürür (`•••` + son 6),
parmak izini ilk 12 karakterle sınırlar, `anon` erişimi REVOKE.

---

## 8. TAZELİK MODELİ (§6)

**Yeni saf katman:** `website/src/lib/fleet/vehicleTelemetryFreshness.ts`
Mevcut `Connectivity` enum'ı (telefon doğrulamasının dayandığı yüzey) **DEĞİŞTİRİLMEDİ** — bu
katman EKLEMELİ.

Durumlar: `LIVE · STALE · OFFLINE · NEVER_SEEN · UNKNOWN`
Pencereler: cihaz **11 dk** (mevcut `OFFLINE_TIMEOUT_MS` ile aynı) · konum **5 dk** ·
motor **2 dk** · sağlık **30 dk**

| Senaryo | Sonuç |
|---------|-------|
| Heartbeat taze, GPS eski | cihaz `LIVE`, konum `STALE` → **"Son bilinen konum"** |
| GPS taze, OBD yok | konum `LIVE`, motor `NEVER_SEEN` → **"Veri yok"** (0 değil) |
| Cihaz çevrimdışı | alt sinyaller `STALE` değil **`OFFLINE`** → "Araç çevrimdışı" |
| Satır okunamadı | `UNKNOWN` (≠ `NEVER_SEEN`) → **"Okunamadı"** |
| 042 öncesi satır (damga yok, koordinat var) | `STALE` — **canlı İDDİA EDİLMEZ** |

---

## 9. FLEET UI DÜRÜSTLÜĞÜ (§7)

| Onarım | Önce | Sonra |
|--------|------|-------|
| Hız/RPM/motor °C | `0 km/h`, `0`, `0°` | **"Veri yok"** (nötr renk) |
| Bayat ölçüm | canlı gibi | **"62 km/h · eski veri"** (soluk) |
| Yakıt bilinmiyor | kırmızı boş çubuk + **"⚠ Yakıt ikmali gerekiyor"** | çubuk **çizilmez** + "Yakıt verisi araçtan okunamadı" |
| Uyarı rengi | bilinmeyene de veriliyordu | **yalnız ölçülmüş + `LIVE`** veriye |
| Çevrimdışı araç | `speed:0, rpm:0` **yazılıyordu** | son ölçüm **korunur**, `OFFLINE` etiketlenir |
| Konum | `v.location` (`—`) | `locationLabel()` → canlı / son bilinen / yok |
| Kilometre 0 | `0 km` | **"Veri yok"** |
| Modal | tazelik/kaynak yok | **Araç ünitesi · Konum + kaynak · Motor verisi · ±doğruluk** satırları |

Ham hata metni UI'a sızmıyor; teknik detay (RPC/kolon adı) kullanıcı mesajlarında yok (kilit #3).

---

## 10. CAROS LAB (§8)

**Yeni araç:** `fleet-connectivity` (kategori `vehicle`, durum `AVAILABLE`)
Dosyalar: `src/platform/devtools/fleetConnectivitySources.ts` (tek okuma katmanı, senkron,
her getter `try/catch`) + `src/components/devtools/screens/FleetConnectivityScreen.tsx`
(OEM token · açılışta TEK okuma + elle YENİLE · timer/abonelik YOK · `mountedRef` + cleanup).

Gösterilen bölümler: Eşleştirme Otoritesi · Kapatılan Yollar (410) · Telemetri Sözleşmesi
(bulunan/reddedilen alanlar, OBD/GPS atlama gerekçesi, gözlem yaşları) · Sözleşme Kapısı
("bilinmeyen ASLA 0 değil") · Araç Kimliği (maskeli).

**Redaction (kilit testleriyle sabit):** `api_key` **değeri**, ham 6 haneli kod, JWT,
TAM VIN, TAM UUID, GPS koordinatı **YOK** — yalnız VAR/YOK · ADET · DURUM · ZAMAN FARKI.
**Aktif komut YOK:** `fetch` · `.rpc(` · `pushVehicleEvent` · `reportVehicleIdentity` ·
`setInterval/setTimeout` · `localStorage.setItem` çağrısı yok.

---

## 11. MIGRATION (§9)

`supabase/migrations/20260730000042_fleet_vehicle_connectivity_p0.sql` — **yalnız ileri**;
033–041 geçmişi **değiştirilmedi**.

- `vehicle_telemetry` + `vehicle_locations`: **NULLABLE** tazelik/kaynak kolonları + CHECK kısıtları
- `public.vehicle_identity` tablosu + CHECK kısıtları (güven 0–1, VIN 11–17 hane)
- `push_vehicle_event` **yeniden yazıldı** (speed-coalesce yalanı kaldırıldı)
- `record_vehicle_identity` + `list_company_vehicle_identity` (`#variable_conflict use_column`)
- RLS açık, `anon` REVOKE, `SECURITY DEFINER` + sabitlenmiş `search_path`
- Sonda **fail-closed DO bloğu**: kolon varlığı · speed-coalesce deseninin YOKLUĞU · anon kilidi · DEFINER+search_path · RLS

**İdempotency:** ikinci uygulama da `NOTICE: 042 OK` + `COMMIT` (doğrulandı).

---

## 12. TESTLER (§10)

| Paket | Sonuç |
|-------|-------|
| Kök `vitest` | **8 885 / 8 885 PASS** (427 dosya) |
| `website` `vitest` | **685 / 685 PASS** (33 dosya) |
| Kök `tsc --noEmit` | **TEMİZ** |
| `website` `tsc --noEmit` | **TEMİZ** |
| Kök `eslint` (yeni dosyalar) | **0 hata** |

**Yeni kilit dosyaları:**

| Dosya | Adet |
|-------|------|
| `src/__tests__/telemetryContract.test.ts` | 20 |
| `src/__tests__/vehicleIdentityReport.test.ts` | 19 |
| `src/__tests__/carosLabFleetConnectivity.test.ts` | 14 |
| `website/src/__tests__/vehicleTelemetryFreshness.test.ts` | 17 |
| `website/src/__tests__/deprecatedPairingRoutes.test.ts` | 13 |

### Gerçek PostgreSQL sözleşme doğrulaması (mock DEĞİL)

Kural: *"Unit testte mock ile geçen RPC'yi gerçek PostgreSQL sözleşmesi doğrulanmadan hazır sayma."*
Yerel Supabase (`supabase_db_fleetval`) üzerinde **26 doğrulama**:

```
T1  tüm alanlar doğru yazıldı (rpm/temp/speed/fuel/accuracy/source)   PASS
T2  bilinmeyen alan BİLİNEN değeri EZMİYOR                            PASS
T3  ölçülen 0 KORUNUYOR                                               PASS
T4  bilinmeyen artık 0 DEĞİL → NULL kalıyor                           PASS
T5  observed_at ≤ now · received_at dolu (istemci saati otorite değil) PASS
T6  tanınmayan kaynak UNKNOWN (uydurulmuyor)                          PASS
T7  accuracy_m kalıcı                                                 PASS
T8  health_observed_at damgalanıyor                                   PASS
T9–T11  güven 0.50 → 0.70 → 0.80 (sınırlı artış)                      PASS
T12 VIN çakışması: eski VIN KORUNUYOR, sayaç +1, güven 0.30           PASS
T14 kısa VIN reddediliyor (null/null)                                 PASS
T15 bilinmeyen vin_source → UNVERIFIED                                PASS
T16 geçersiz api_key reddediliyor                                     PASS
T17 anon SELECT ve anon RPC kapalı                                    PASS
T18a dönen anahtarlar = [conflict, identityConfidence, state]          PASS
T18b/c okuma RPC'sinde api_key parametresi/gövde referansı = 0         PASS
T18d VIN maskeli dönüyor                                              PASS
T19 ikinci eşleştirme otoritesi (pair_vehicle) OLUŞTURULMADI          PASS
T20 pair_vehicle_to_user: anon=f · auth=f · service_role=t            PASS
```

> **Dürüstlük notu:** `pg_042_verify.sql` içindeki eski `T18` satırı **kendi test kusurumdu**
> (`pg_get_functiondef ILIKE '%RETURN%api_key%'` deseni `RETURNS jsonb` + `p_api_key`
> parametresini yakalıyordu). Davranışsal `t18.sql` ile değiştirildi; eski satır yerinde
> kaldığı için yeniden koşumda hâlâ `FAIL` yazıyor — **geçerli hüküm T18a–T18d'dir.**

---

## 13. 14 KABUL KRİTERİ (§11)

| # | Kriter | Durum |
|---|--------|-------|
| 1 | Tek eşleştirme otoritesi | ✅ yerel kanıt |
| 2 | Kırık/ölü yollar fail-closed | ✅ 410 + 13 kilit |
| 3 | QR "destekleniyor" yalanı kaldırıldı | ✅ |
| 4 | Bilinmeyen telemetri asla 0/false/"normal" | ✅ kod + DB (T4) |
| 5 | Ölçülen 0 korunuyor | ✅ (T3) |
| 6 | NaN/Infinity/aralık dışı reddediliyor | ✅ 20 kilit |
| 7 | Eski değer ezilmiyor | ✅ (T2) |
| 8 | `received_at` / `observed_at` ayrı, istemci saati otorite değil | ✅ (T5) |
| 9 | Bayat OBD/GPS eklenmiyor | ✅ kod kilidi · 🔴 cihazda #198 |
| 10 | Accuracy kalıcı ve sorgulanabilir | ✅ (T7) |
| 11 | Kimlik özeti + IDENTITY_CONFLICT + sınırlı güven | ✅ (T9–T12) |
| 12 | LIVE/STALE/OFFLINE/NEVER_SEEN/UNKNOWN ayrımı | ✅ 17 kilit |
| 13 | Fleet UI dürüstlüğü (null/0/stale/offline/son bilinen) | ✅ · 🔴 cihazda #200 |
| 14 | LAB Fleet Connectivity + redaction | ✅ 14 kilit · 🔴 cihazda #202 |

**14/14 yerel olarak karşılandı; 4 madde saha doğrulaması bekliyor.**

---

## 14. BOZULMAYAN / DOKUNULMAYAN ALANLAR

| Alan | Durum |
|------|-------|
| Sahiplik · offline kuyruk · realtime otoritesi · devir mimarisi | **Değiştirilmedi** |
| `Connectivity` enum'ı (telefon doğrulaması yüzeyi) | **Değiştirilmedi** (eklemeli katman) |
| Paralel **AccountCleanup** çalışması | **Dokunulmadı** |
| Paralel **Music Hub** çalışması | **Dokunulmadı** — `localMusicService` · `carosMediaLayer` · `mediaService` · `streamMusicService` · `android/.../media/*` benim değişiklik listemde YOK |
| Migration 033–041 | **Değiştirilmedi** |
| Production / staging | **Yazma YOK** |

### Bu paketten KAYNAKLANMAYAN, kapatılamayan iki kapı

1. **`website` build (prerender)** — `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY`.
   Zincir: her dashboard sayfası → `useSessionUser` (**izlenmeyen**, paralel ajanın yeni dosyası)
   → `accountCleanup/authSessionGenerationGuard` → `getAccountCleanupRuntime()` → SSR muhafızı
   `throw`. TypeScript/bundle aşaması **"✓ Compiled successfully"** diyor; yalnız statik
   prerender düşüyor. Benim değiştirdiğim dosyalar modül seviyesinde **hiçbir yan etki
   eklemiyor** (yalnız saf modül importu + fonksiyon gövdesi değişiklikleri).
2. **`test-parser.ts` lint hatası** (`'processTextCommand' is defined but never used`) —
   depo kökünde **izlenmeyen**, bu pakete ait olmayan dosya. Dokunulmadı.

---

## 15. İKİ BİLİNÇLİ KİLİT GÜNCELLEMESİ (kaldırma DEĞİL)

CLAUDE.md: *"Bir kilit bilinçli değişiyorsa, kilidi yeni doğru davranışa GÜNCELLE — kaldırma."*

1. **`realtimeVehiclePairingLifecycle.test.ts #20`** — eski hali `speed === 0 && rpm === 0`
   bekliyordu, yani **bekçinin uydurma 0 yazmasını sabitliyordu**. Yeni hali son ölçümün
   **korunduğunu** ve gerçek katmanının `OFFLINE` + `locationIsLive === false` dediğini
   doğruluyor. Konumun silinmediği asıl niyet korundu, üzerine iki iddia EKLENDİ.
2. **`supabaseNameDrift.test.ts`** — `/api/vehicle/code` artık kapalı olduğu için
   `vehicle_linking_codes` sorgusu beklemek anlamsızlaştı. Kilit üç yönde güçlendirildi:
   eski ad hâlâ yok · rota **hiçbir** tabloya/RPC'ye dokunmuyor (ikinci otorite geri gelmesin) ·
   kanonik otorite `pair_vehicle_to_user` RPC'sinde **duruyor** (yeni test eklendi).

---

## 16. KÜTÜK MADDELERİ (§7 şartı — hepsi 🔴)

`docs/DEVICE_VALIDATION_LEDGER.md`:

| # | Konu | Ölçülebilir kabul ölçütü |
|---|------|--------------------------|
| **197** | Telemetri sözleşmesi | OBD bağlıyken `rpm/temp` gerçek; **OBD yoksa `NULL` kalmalı (0 OLMAMALI)** |
| **198** | Bayat veri gönderilmiyor | Kontak kapalı + 10 dk → `obd_observed_at` ilerlemiyor; LAB "ATLANDI — not_connected" |
| **199** | Tek eşleştirme otoritesi | Eski ekranda **410 + kanonik yönlendirme**; QR sekmesi yok; kanonik akış çalışıyor |
| **200** | Fleet UI dürüstlüğü | OBD'siz araçta **"Veri yok"**; yakıt çubuğu boş-kırmızı DEĞİL; ikmal uyarısı YOK; 11 dk sonra "Araç çevrimdışı" + "Son bilinen konum" |
| **201** | Kimlik + çakışma | Mode 09 sonrası güven ≥ 0.70; başka araçta `identity_conflict_count` +1 ve **eski VIN silinmiyor**; LAB'da VIN maskeli |
| **202** | LAB ekranı | Sahte 0 yok (`UNAVAILABLE`); `api_key`/ham kod/TAM VIN/TAM UUID görünmüyor; ekran hiçbir push/OBD/ağ etkinliği tetiklemiyor |

---

## 17. SONRAKİ ATOMİK ADIMLAR

1. **Head unit kimlik çağrısını bağla** — `telemetryService.reportVehicleIdentity()` yazıldı ve
   test edildi, ancak VIN/parmak izi/protokol üreten kaynaklara (`VehicleHandshake`,
   `vehicleHal.getVehicleIdentity()`) **henüz çağrı noktası bağlanmadı**. Kimlik hâlâ
   sunucuya gitmiyor → §7 kodda hazır, akışta pasif. **Bu paketin en büyük açık borcu.**
2. **`website` build kapısını aç** — paralel AccountCleanup ajanı `useSessionUser`'ı SSR-güvenli
   yapmalı (`getAccountCleanupRuntime()` çağrısını `useEffect`e alma veya `typeof window` kapısı).
   Bu paket o dosyaya dokunmuyor.
3. **Gerçek araç doğrulaması** — kütük #197–#202. Özellikle #197: OBD'siz araçta
   `rpm/temp` gerçekten `NULL` kalıyor mu?
4. **Production migration** — 040 · 041 · 042 hiçbir ortama uygulanmadı; RLS matrisi
   ayrı temiz DB'de yeniden koşulmalı.
5. **`vehicleOfflineStatus` ile birleştirme** — iki katman şimdilik yan yana duruyor;
   telefon doğrulaması yeniden koşulduktan sonra tek sözleşmeye indirilebilir.

---

### Dürüstlük beyanı

Bu rapordaki hiçbir 🟢/PASS gerçek araç veya gerçek telefon gözlemine dayanmıyor —
tamamı **yerel** kanıttır (birim/entegrasyon testi, tsc, gerçek yerel PostgreSQL sözleşmesi).
Kütükte 🔴 bekleyen altı madde **"çalışıyor" olarak sunulmuyor**. `website` build kapısı
kapalıdır ve bu, ana kararın `COMPLETE_LOCAL` yerine **`PARTIAL`** olmasının sebebidir.
