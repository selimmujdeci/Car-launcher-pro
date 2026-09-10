# DORMANT CAPABILITY ACTIVATION P0 — RAPOR

**Tarih:** 2026-08-01 · **Branch:** `feat/fleet-offline-final-local-completion` · **HEAD:** `f89540c`
**Karar:** `DORMANT_CAPABILITY_ACTIVATION_P0_PARTIAL`
**Yapılmadı:** commit · push · deploy · production/staging DB · AccountCleanup · Music Hub

---

## 1 · EXECUTIVE SUMMARY

Bu turda **yeni özellik yazılmadı**. Kodda zaten tam yazılmış ama kullanıcıya kapalı
dört yetenek ürüne bağlandı, bir tanesi de dürüstçe "kullanılamaz" ilan edildi.

En önemli bulgu ve en önemli karar aynı yerden çıktı: **AI Gateway'i mevcut global
bayraktan açmak güvensizdi.** `public.feature_flags` tablosunun **şirket kapsamı
yoktur** ve `anon` için `USING(true)` okunur — oradan `mavi_ai_gateway = true` yazmak
AI zincirini **dünyadaki her cihazda aynı anda** açardı. Bu, görevin "yanlışlıkla
global açılmamalı" şartının doğrudan ihlali olurdu. Bu yüzden global bayrak
**ana şaltere** indirgendi ve üstüne şirket/araç kapsamlı, denetimli, yalnız
yöneticinin verebildiği bir izin katmanı kuruldu:

```
ETKİN = ana şalter  VE  (şirket izni VEYA araç izni)
```

Gerçek PostgreSQL'de **16/16** güvenlik kilidi geçti; en kritik kanıt **C3**:
ana şalter açıkken bile izinsiz şirket **açılmıyor**.

Driver DNA · Fleet Intelligence · Evidence zincirlerinde eksik olan tek halka
**okuma ucuydu** — SQL, saf görünüm katmanı ve kartlar zaten yazılmıştı ama hiçbir
yer RPC'leri çağırmıyordu. O halka tamamlandı ve kartlar gerçek sayfalara mount edildi.

Çevrimdışı rota için **Seçenek B** uygulandı: graph artefaktı bu görevde üretilemez,
bu yüzden yetenek açıkça `GRAPH_MISSING` ilan edildi ve kalıcı hatada boşuna WASM
worker açan sessiz tekrar kaldırıldı. **Sahte çevrimdışı başarı üretilmedi.**

---

## 2 · DOĞRULANAN ANALİZ BULGULARI

Rapordaki her bulgu koddan **yeniden** doğrulandı:

| Bulgu | Doğrulama | Sonuç |
|---|---|---|
| AI gateway varsayılan kapalı | `aiGatewayFlag.ts:49` · `DEFAULT_FLAGS` içinde `mavi_ai_gateway` **yok** | ✅ DOĞRU |
| 11 alt sistem bu kapıya bağlı | `isAiGatewayEnabled` · `…Orchestrator/Context/Memory/Tools/Planner/Mechanic/MechanicHistory/MechanicKnowledge/Operator/OperatorChat` | ✅ DOĞRU (11) |
| `feature_flags` global, kapsamsız | Tabloda `company_id` **yok**; `anon_read_flags USING(true)` | ✅ DOĞRU — **yeni risk tespit edildi** |
| `get_driver_dna` çağıran yok | Yalnız yorum + görünüm katmanı | ✅ DOĞRU |
| `get_fleet_intelligence` çağıran yok | Aynı | ✅ DOĞRU |
| `get_evidence_coverage` / `get_subject_evidence` çağıran yok | Aynı | ✅ DOĞRU |
| 4 kart hiç mount edilmemiş | 0 import | ✅ DOĞRU |
| `routing-graph.bin` yok | `public/maps/` dizini **hiç yok** | ✅ DOĞRU |
| Düz-hat yedeği "offline rota" diye sunuluyor | **YANLIŞ** — `routingService.ts:733` zaten `serverUsed:'straight-line'` diyor ve kullanıcıya "düz hat navigasyon" mesajı veriyor | ❌ **ÇÜRÜTÜLDÜ** |

> **Çürütülen varsayım:** düz-hat yedeği zaten dürüsttü. Gerçek boşluk, bu durumun
> hiçbir yerde **gözlemlenebilir olmaması** ve kalıcı hatada worker'ın her istekte
> boşuna ayağa kaldırılmasıydı.

**Ek düzeltme:** `profiles.role` alanı ölçüldü — yalnız `admin · member · individual`
değerlerini alır; **`owner` rolü YOKTUR**. İlk yazdığım RPC'de `('owner','admin')`
kontrolü ölü bir dal olacaktı; gerçeğe uyduruldu (`role = 'admin'`).

---

## 3 · AI GATEWAY — ÖNCE / SONRA

| | ÖNCE | SONRA |
|---|---|---|
| Koşul | `remoteFlag OR localOverride` | `localOverride` **veya** (`remoteFlag` **AND** kapsam izni) |
| Kapsam | **YOK** (global) | Şirket veya araç |
| Kim açabilir | DB operatörü (herkese) | Yalnız şirket `admin`i (kendi şirketine) |
| Denetim | **YOK** | `ai_gateway_audit` — GRANT/REVOKE/**DENIED** |
| "Açık" vs "hazır" | Ayrım **yok** | `accessGranted` · `provider` · `ready` ayrı |
| Görünürlük | **Hiçbir yerde** | CAROS LAB → *Yetenek Kapıları* |
| Geri alma | Bayrağı kapat (global) | İzni kaldır — **anında** kapanır |

**Yeni yüzeyler:**
- `supabase/migrations/…061_ai_gateway_scoped_access_p0.sql` — `ai_gateway_access` +
  `ai_gateway_audit` + 3 RPC. **Yeni karar/kanıt/güven motoru YOK** — yalnız izin.
- `src/platform/ai/gateway/aiGatewayAccess.ts` — saf durum türetimi.
- `src/platform/ai/gateway/aiGatewayAccessRuntime.ts` — sunucu okuması → kapıya besleme.
- `website/src/components/dashboard/AiGatewayAccessCard.tsx` — yönetim yüzeyi.
- `src/components/devtools/screens/CapabilityGatesScreen.tsx` — LAB gözlemi.

**Fail-closed kanıtları:** okunmadıysa kapalı · şalter kapalıysa kapalı · izin yoksa
kapalı · anahtar yoksa `ready=false` · `anon` tamamen kapalı · doğrudan tablo erişimi yok.

---

## 4 · DRIVER DNA READBACK

**Zincir:** `/dashboard/fleet/drivers` → sürücü kartında **"Sürücü DNA ve kanıt"**
butonu → `readDriverDna()` → `get_driver_dna(p_driver_id)` → `DriverDnaCard` mount.

- **Sürücü seçimi açık** — açılışta toplu okuma yok, yalnız seçilen sürücü okunur.
- **Veri yoksa:** "Bu sürücü için henüz yeterli yolculuk yok — DNA oluşmadı."
- **Okunamadıysa:** ayrı mesaj — "veri yok" ile karıştırılmaz.
- **Ad değil referans:** karta `drv:xxxxxxxx` geçilir (kart paylaşılabilir olmalı).
- **Cross-tenant:** sunucu `company_id` ile filtreler; başka şirketin sürücüsü **boş** döner.
- Yanında **sürücü kanıtı** listesi (`get_subject_evidence(DRIVER, …)`).

---

## 5 · FLEET INTELLIGENCE READBACK

**Zincir:** `/dashboard/fleet/lab` → `readIntelligenceLab()` → `get_fleet_intelligence`
→ `FleetIntelligenceCards` mount.

- İçgörü yoksa **sahte içgörü üretilmez** (kart kendi boş-durum gerekçesini gösterir).
- `SINGLE_VEHICLE_ONLY` ve `UNKNOWN` boyutları görünüm katmanında zaten korunuyordu.
- **Overall score üretilmedi** — böyle bir alan eklenmedi.
- Okuma bağımsız: düşerse karar panosu ve filo paneli çalışmaya devam eder.

---

## 6 · EVIDENCE READBACK

| Yüzey | RPC | Durum |
|---|---|---|
| Filo geneli kapsam | `get_evidence_coverage` | ✅ `/dashboard/fleet/lab` |
| **Araç** detayı | `get_subject_evidence(VEHICLE, id)` | ✅ `VehicleModal` |
| **Sürücü** detayı | `get_subject_evidence(DRIVER, id)` | ✅ sürücü paneli |
| **Trip** detayı | `get_subject_evidence(TRIP, id)` | ❌ **YAPILMADI** (§13) |
| Fleet insight detayı → chain | `get_evidence_chain` | ❌ **YAPILMADI** (§13) |

- **Ham tanımlayıcı sızmaz** — test tam UUID'nin ekrana basılmadığını kilitler.
- `EXPIRED` / `REJECTED` / `ACTIVE` ayrımı gizlenmez (test kilidi var).
- **Teknik SQL hata metni kullanıcıya gösterilmez** — test bunu ayrıca kilitler.

---

## 7 · OFFLINE ROUTING GERÇEĞİ — **SEÇENEK B**

Graph artefaktı (`/maps/routing-graph.bin`) depoda yok, üretim hattı bu görevde
mevcut değil → **gerçek graph üretilemedi**, dolayısıyla B uygulandı.

- Yeni `offlineRoutingStatus.ts`: `UNKNOWN · AVAILABLE · GRAPH_MISSING ·
  GRAPH_CORRUPT · WORKER_UNSUPPORTED`. **`UNKNOWN` ile `MISSING` ayrı** — biri
  ölçülmedi, diğeri ölçüldü.
- `offlineRoutingService` artık worker cevabını **sınıflandırıyor**: "graph yok"
  kalıcı yetenek eksikliği, "rota bulunamadı" geçici sorgu sonucu.
- **Sessiz tekrar kaldırıldı:** kalıcı hatada `computeOfflineRoute` kısa devre yapar —
  her rota isteğinde boşuna WASM/sql.js worker'ı ayağa kaldırılmaz.
- **LAB'da `GRAPH_MISSING` görünür** (*Yetenek Kapıları* ekranı).
- Düz-hat yedeği **zaten** `serverUsed:'straight-line'` diye etiketliydi ve
  kullanıcıya "düz hat navigasyon" diyordu — **değiştirilmedi**, çünkü zaten dürüsttü.
- **Sahte offline başarı üretilmedi.**

---

## 8 · KULLANICI ERİŞİM YOLLARI

| Yetenek | Yol | Rol |
|---|---|---|
| AI erişim yönetimi | `/dashboard/fleet/lab` → *AI Erişimi* | Buton yalnız yöneticide; **güvenlik sunucuda** |
| AI kapı durumu | Araç → CAROS LAB → *Yetenek Kapıları* | Geliştirici build |
| Driver DNA + sürücü kanıtı | `/dashboard/fleet/drivers` → sürücü → buton | Tüm roller (salt-okunur) |
| Fleet Intelligence | `/dashboard/fleet/lab` → *Fleet Intelligence* | Tüm roller |
| Kanıt kapsamı | `/dashboard/fleet/lab` → *Kanıt Kapsamı* | Tüm roller |
| Araç kanıtı | `/dashboard/vehicles` → araç → modal | Tüm roller |
| Çevrimdışı rota durumu | CAROS LAB → *Yetenek Kapıları* | Geliştirici build |

Her yüzeyde **yükleniyor · okunamadı · boş** durumları **ayrı** gösterilir.

---

## 9 · GÜVENLİK

- **Çift kapı:** ana şalter + kapsam izni. Biri kapalıysa erişim yok (PG C1/C3).
- **Rol kapısı sunucuda:** `member` denerse `DENIED_ROLE` ve **denetim kaydı** (PG B1/B2).
  Reddedilen deneme izin **oluşturmaz** (B3).
- **Tenant izolasyonu:** A yöneticisi B'nin aracına izin **veremez** (D1); B, A'nın
  denetim kaydını **göremez** (D3).
- **Anon tamamen kapalı:** RPC EXECUTE 0, doğrudan tablo izni 0 (F1/F2).
- **RLS açık + policy yok** → tablolar yalnız SECURITY DEFINER RPC üzerinden.
- **Denetim append-only**; `actor_id` dışarı verilmez (rol yeterli, kimlik gizli).
- **Ham SQL hatası kullanıcıya sızmaz** — bounded kod → Türkçe mesaj.

---

## 10 · TESTLER

| Kapı | Sonuç |
|---|---|
| PG · AI gateway güvenlik matrisi (061) | ✅ **16/16** |
| PG · AI Mechanic matrisi (060, regresyon) | ✅ 25/25 |
| Root unit | ✅ **453 dosya · 9.837 test** |
| Root integration | ✅ 4/4 · 30/30 |
| Regresyon kasası | ✅ 163/163 |
| Website unit | ✅ **46 dosya · 978 test** |
| Root TypeScript | ✅ temiz |
| Website TypeScript | ✅ temiz |
| Root build | ✅ başarılı |
| Website build | ⚠️ **derleme başarılı, prerender düşüyor** (§13) |
| Root ESLint (değişen dosyalar) | ✅ 0 hata |

**Güncellenen kilit:** `aiGatewayFlag.test.ts` → *"uzak bayrak açarsa açılır"* artık
**yanlış** bir davranışı kilitliyordu. Kilit kaldırılmadı, **yeni doğru davranışa
güncellendi** ve iki kilit eklendi (şalter+izin açar · izin tek başına açmaz).

---

## 11 · DEĞİŞEN DOSYALAR

| Dosya | Tür |
|---|---|
| `supabase/migrations/…061_ai_gateway_scoped_access_p0.sql` | YENİ |
| `supabase/tests/061_ai_gateway_access_matrix.sql` | YENİ · 16 kilit |
| `src/platform/ai/gateway/aiGatewayAccess.ts` | YENİ · saf |
| `src/platform/ai/gateway/aiGatewayAccessRuntime.ts` | YENİ |
| `src/platform/navigation/offlineRoutingStatus.ts` | YENİ · saf |
| `src/components/devtools/screens/CapabilityGatesScreen.tsx` | YENİ · LAB |
| `src/__tests__/dormantCapabilityActivation.test.ts` | YENİ · 19 kilit |
| `website/src/lib/lab/intelligenceLabSource.ts` | YENİ · okuma ucu |
| `website/src/lib/fleet/aiGatewayAdmin.ts` | YENİ |
| `website/src/components/dashboard/AiGatewayAccessCard.tsx` | YENİ |
| `website/src/__tests__/dormantReadbackWiring.test.tsx` | YENİ · 13 kilit |
| `src/platform/ai/gateway/aiGatewayFlag.ts` | DÜZENLENDİ · kapsam kapısı |
| `src/platform/offlineRoutingService.ts` | DÜZENLENDİ · sınıflandırma + kısa devre |
| `src/platform/devtools/carosLabCatalog.ts` | DÜZENLENDİ · katalog |
| `src/components/devtools/carosLabScreenMap.tsx` | DÜZENLENDİ · lazy ekran |
| `src/__tests__/aiGatewayFlag.test.ts` | DÜZENLENDİ · kilit güncellemesi |
| `website/src/app/dashboard/fleet/lab/page.tsx` | DÜZENLENDİ · 3 panel |
| `website/src/app/dashboard/fleet/drivers/page.tsx` | DÜZENLENDİ · DNA paneli |
| `website/src/components/dashboard/VehicleModal.tsx` | DÜZENLENDİ · araç kanıtı |

---

## 12 · DOKUNULMAYAN ALANLAR

**AccountCleanup** ve **Music Hub** dosyalarına **dokunulmadı** — kanıt: değişiklik
zamanları **2026-07-29**, benim turum **2026-08-01 22:00+**.

Ayrıca dokunulmadı: MAVI Reasoning · AI Evidence motorları (tek otorite olarak kaldı) ·
Trip · Vehicle Identity · production/staging.

---

## 13 · AÇIK BORÇLAR

1. **Website prerender kırık — BENİM DEĞİL.** 14 dashboard sayfasının **tamamı**
   `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY` ile düşüyor. Kaynak
   `website/src/security/accountCleanup/accountCleanupRuntime.ts:291`, tetikleyici
   `dashboard/layout.tsx` içindeki `AccountCleanupBootGate` (2026-07-29). Dokunmam
   yasak olan alanda **mevcut** bir kırık; **düzeltilmedi**. Dokunmadığım sayfalar da
   (`/dashboard/notifications`, `/dashboard/settings`, `/dashboard/map`…) aynı hatayı
   verdiği için benim değişikliklerimden bağımsız olduğu kesindir.
2. **Trip detayında kanıt** bağlanmadı — ayrı bir trip-detay yüzeyi gerekiyor.
3. **Fleet insight detayı → `get_evidence_chain`** bağlanmadı — insight detay ekranı yok.
4. **Araç-kapsamlı izin için UI yok** — SQL/RPC destekliyor (PG D2 geçti), yönetim
   kartı şimdilik yalnız şirket geneli izni yönetiyor.
5. **Migration 061 üretime uygulanmadı** — yalnız yerel `supabase_db_fleetval`.
6. **`mavi_ai_gateway` ana şalteri hiçbir ortamda açık değil** — bu bilinçli:
   açılış operatör kararıdır.
7. **Sağlayıcı hazırlığı henüz beslenmiyor** — `setProviderReadiness()` yazıldı ama
   boot'ta çağıran yok; LAB şimdilik `BİLİNMİYOR` gösterir (sahte "hazır" göstermez).

---

## 14 · NİHAİ KARAR

```
DORMANT_CAPABILITY_ACTIVATION_P0_PARTIAL
```

**Neden PARTIAL, COMPLETE değil:** dört ana açığın hepsi ürüne bağlandı ve gerçek
PostgreSQL'de doğrulandı; ancak trip-detay kanıtı ve insight-chain bağlanmadı,
sağlayıcı hazırlık beslemesi boot'a takılmadı ve website prerender'ı (benim
sorumluluğumda olmayan bir nedenle) kırık. Kanıtsız PASS verilmedi.

| Kapı | Karar |
|---|---|
| `aiGatewayVerdict` | **COMPLETE_LOCAL** — kapsamlı, denetimli, geri alınabilir; 16/16 PG |
| `driverDnaReadbackVerdict` | **COMPLETE_LOCAL** — RPC + mount + seçim + durumlar |
| `fleetIntelligenceReadbackVerdict` | **COMPLETE_LOCAL** — RPC + mount |
| `evidenceReadbackVerdict` | **PARTIAL** — araç + sürücü + filo kapsamı bağlandı; **trip ve insight-chain YOK** |
| `offlineRoutingVerdict` | **COMPLETE_LOCAL (Seçenek B)** — açıkça unavailable, sahte başarı yok, LAB'da görünür |
| `productionValidationVerdict` | **BLOCKED** — 061 üretime uygulanmadı; ana şalter kapalı; website prerender kırık |
| `realVehicleValidationVerdict` | **BLOCKED_REAL_VEHICLE** — hiçbir yüzey gerçek araç verisiyle gözlenmedi |

---

*Bu turda yeni özellik yazılmadı. Yazılmış ama erişilemeyen hiçbir modül
"tamamlanmış" sayılmadı; erişim yolu olmayanlar §13'te açık borç olarak kaldı.*
