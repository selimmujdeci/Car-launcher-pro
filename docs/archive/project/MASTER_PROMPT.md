# CarOS Pro — MASTER PROMPT (Proje Anayasası)

> **Bu dosya projenin TEK GERÇEK KAYNAĞIDIR.** Her yeni oturum buradan başlar.
> Çelişki durumunda öncelik sırası: **`AI.md` > `CLAUDE.md` > `GEMINI.md` > bu dosya**.
> Bu dosya o üç kaynaktaki bağlayıcı kuralları tek yerde toplar; onları ezmez, uygular.
>
> **Dil kuralı:** Kod dışındaki her şey Türkçe. İstisna yok.

---

## 0. KUZEY YILDIZI (VİZYON ANAYASASI)

CarOS Pro bir launcher değildir; **aracın ikinci beynidir** — evrensel, aftermarket
bir **Vehicle Intelligence OS**. Referans Tesla DEĞİL: biz yüzlerce **bilinmeyen**
marka/modeli **öğreniriz** → güvenilmez aftermarket telemetri → **zero-trust telemetry**.

**Sinyal Karar Sözleşmesi — "8 Kapı":** Hiçbir veri yalnızca ekranda gösterilmek için
okunmaz; her sinyal bir kararın parçasıdır.
1. Doğru mu? → **Confidence**
2. Önemli mi? → **Rule**
3. Kullanıcı bilmeli mi? → **Action**
4. Sadece sistem mi bilmeli? → **Digital Twin**
5. Neyle birleşince anlam kazanır? → **Fusion/Context**
6. 5 dk sonra ne olacak? → **Prediction**
7. Yerine ne karar alabiliriz? → **Intent/Vehicle Brain**
8. En doğru aksiyon? → **Vehicle Brain → Action**

**Tasarım testi (her PR):** *"Bu özellik Tesla'dan daha akıllı mı? Sadece gösteriyor
mu, yoksa doğruluyor + yorumluyor + öngörüyor + karar veriyor mu?"* Değilse yeniden tasarla.

Tam mimari: `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md`.

---

## 1. TEMEL PRENSİPLER (PAZARLIKSIZ)

- **Zero Trust** — kanıtlanamayan sinyal doğru varsayılmaz.
- **Fail Closed** — kanıt yoksa güvenli/kapalı tarafa düş (ör. ignition kaynağı yok → `ignitionConfirmed = null`, çıkarsama YAPMA).
- **Fail Soft** — bir sensör (OBD/GPS) düşse bile UI çalışır kalır.
- **Immutable** — durum nesneleri dondurulmuş, dışarı sızan mutable referans yok.
- **Backward Compatible** — mevcut davranış korunur; additive değişiklik tercih edilir.
- **Atomic PR** — bir PR yalnız bir problemi çözer.
- **Small Diff / No Big Bang** — minimal, izole yama; çoklu-sistem refactor YASAK.
- **Never Fake Completion** — build/test yeşil olması "başarı" değildir; gerçek davranış kanıt ister.
- **No Hallucination** — kodda olmayan davranış uydurulmaz.
- **No Scope Creep** — istenmeyen temizlik / isim değişimi / format değişimi YAPILMAZ.

---

## 2. GELİŞTİRME AKIŞI (ADIM ATLANMAZ)

1. **Salt-okunur analiz** (önce oku, sonra düşün)
2. **Risk analizi**
3. **Plan**
4. **Kod** (atomik, minimal)
5. **Test** (yeni davranış = yeni test)
6. **CI** (kırmızıysa görev bitmiş sayılmaz)
7. **PR**
8. **Final rapor**

Her yeni oturumda ÖNCE oku: `MASTER_PROMPT.md` → `PROJECT_STATUS.md` → `ROADMAP.md`
→ `SESSION.md` → `PROJECT_MEMORY.md`. Geçmiş sohbeti yeniden analiz etme.

---

## 3. ATOMİK PR KURALLARI

- Bir PR = bir problem. Scope dışına çıkma.
- Refactor / temizlik / rename / format değişikliği YOK (istenmedikçe).
- Yarım mantık bırakma; kısmi kırık akış bırakma.
- Yeni davranış → yeni test. Bug fix → regresyon testi (`src/__tests__/regression.guards.test.ts`).

---

## 4. MERGE & ONAY MODELİ

- **Merge yalnız KULLANICI onayıyla yapılır.** Hiçbir ajan/oturum kendi kendine merge etmez.
- Dosya/işlem düzeyinde onay istenmez (CLAUDE.md gereği doğrudan yapılır); ama **merge kararı kullanıcınındır**.
- Dışa dönük / geri alınması zor işlemlerde (push, release, silme) önce durumu bildir.

---

## 5. LEDGER SİSTEMİ (SAHA DOĞRULAMA — ZORUNLU)

Kaynak: `docs/DEVICE_VALIDATION_LEDGER.md`. Ayna/özet: `docs/project/DEVICE_VALIDATION.md`.

- Her yeni özellik önce **🔴 CİHAZDA TEST EDİLMEDİ** bölümüne, **ölçülebilir kabul ölçütüyle** girer.
- Gerçek araçta/cihazda ölçüt gözlemlenince **🟢 CİHAZDA DOĞRULANDI**'ya taşınır.
- Cihazda düşerse **❌ TEST EDİLDİ / DÜŞTÜ**'ye geçer.
- **🔴 bekleyen özelliği "çalışıyor / tamam" diye SUNMA.** Test yeşil + tsc temiz ≠ başarı.

---

## 6. PERFORMANS BÜTÇELERİ (PERFORMANS-UYARLANABİLİR HİBRİT)

- Tüm zekâ katmanları hibrit/açık, ama her biri **DeviceTier** bütçesine abone (AdaptiveRuntimeManager).
- **Güvenlik-kritik katmanlar** (overheat, düşük yağ basıncı, reverse) HER tier'da garanti açık — ucuzdurlar.
- **Ağır analiz** (Digital Twin, Prediction, Driver DNA) soğuk-yolda / düşük frekansta / idle'da; **hot-path'e (3Hz hız/RPM) ASLA girmez.**
- **Süslü görsel** düşük-uçta feda edilir — feda edilen zekâ değil, yalnız gösterim.
- **Altın kural:** bütçesiz/kanıtsız özellik ekleme YASAK; bütçeli + kanıtlı + hibrit özellik görevdir.
- **I/O:** yüksek-frekans veri için `localStorage`/disk yazımı 5–10 sn'de birden sık DEĞİL; `safeStorage` kullan.
- **Render:** RPM/hız gibi yüksek-frekans state 10–20Hz'e throttle.

---

## 7. HOT-PATH & V8/JIT KURALLARI

- **Hidden Class stability:** boş `{}` + dinamik prop YOK; tüm anahtarlı template literal kullan, sabit prop sırası.
- **`delete` YASAK** — `null`/`undefined` ata.
- **Monomorphic call sites:** yüksek-frekans fonksiyonlar aynı Hidden Class alsın; megamorfik switch'ten kaçın.
- **Zero-allocation hot-path:** modül-seviye önceden ayrılmış envelope'lar; scratch primitive'ler.
- **SAB/Seqlock:** GEN sayacı (tek=yazılıyor, çift=bitti), double-check guard, 64-byte cache-line padding, `Atomics.add` fence.

---

## 8. OWNERSHIP MODELİ

- Her runtime kaynağının **tek sahibi** vardır; sahip yaşam döngüsünü yönetir.
- **Paylaşılan singleton'lar** (runtime/persistence/ignition/EventBus) sahiplenilmez, yalnız REFERANS alınır → **dispose edilmez**.
- Wiring dosyaları (`src/platform/system/platformCore*Wiring.ts`) foundation'ı boot'a bağlar; bağladığını sahiplenir, paylaşılanı sahiplenmez.
- Tip düzeyinde garanti tercih et (ör. `OwnedOrchestrator` tipi `start()`/`run()` göstermez → compile-time "tarama başlatmaz").

---

## 9. SINGLETON KURALLARI

- Merkezi omurga bileşenleri **tek instance** (EventBus, Vehicle HAL, Capability Registry).
- **İkinci bus/registry oluşturmak YASAK** — sessiz veri kaybına yol açar (publish null'a düşer).
- Tek-instance guard ile koru; DI ile tüket (owner ≠ consumer ayrımı).

---

## 10. CLEANUP KURALLARI (ZERO-LEAK)

- Her `useEffect`/`setInterval`/`eventListener` için karşılık gelen cleanup ZORUNLU.
- MapLibre instance + WebGL context unmount'ta explicit destroy.
- Global değişken sızıntısı YOK; kalıcı state için React ref / Zustand.
- SystemBoot cleanup **LIFO** (Wave 4 → Wave 1); her `_reg(fn)` bir dispose garantisidir.

---

## 11. WORKTREE POLİTİKASI

- Paralel dosya mutasyonu gereken izole işlerde worktree kullan; aksi halde maliyet işten pahalı.
- Worktree değişmezse otomatik temizlenir.
- Windows worktree'de `ANDROID_HOME` ayrıca verilmeli (bkz. memory: windows-apk-build-env).

---

## 12. ÇOKLU AGENT SİSTEMİ

Kullanıcı ajan/model adı VERMEZ; ana oturum görevi sınıflandırır ve uygun ajana devreder
(kullanıcı-onaylı maliyet politikası). Ajan tanımları: `docs/project/AGENT_GUIDE.md`.

| Görev tipi | Ajan |
|------------|------|
| Kod / bug fix / refactor / test | caros-coder |
| Test / regresyon / review | caros-tester |
| Navigasyon / GPS / harita | caros-navigation |
| OBD / CAN / BLE / native | caros-obd-canbus |
| Performans / bellek / termal / FPS | caros-performance |
| Mimari / kök neden / plan | caros-architect |
| Güvenlik / auth / RLS / secret | caros-security |

**Delege ETME (inline yap):** tek-dosya küçük düzeltme, hızlı Q&A, 5 dk'lık iş, aktif saha/acil debug.
**Delege edilen iş ana oturumda DOĞRULANIR** (test/tsc) — ajan çıktısına körlemesine güvenilmez.
**Hiçbir ajan başka ajanın alanında kod değiştirmez.** Coordinator (ana oturum) tek karar vericidir.

---

## 13. LİSANS / TİCARİ UYGUNLUK

Uygulama ticari satılacak. İzinli: **MIT, Apache-2.0, BSD, ISC, Zlib, CC0, OFL**.
**YASAK:** GPL/AGPL/LGPL/SSPL (copyleft), CC-BY-NC (non-commercial), belirsiz/lisanssız,
3. taraf marka logosu gömme. OSM verisi → `© OpenStreetMap katkıcıları` atıfı zorunlu.
Ücretli AI API → **BYOK** (gömülü merkezi anahtar YASAK).

---

## 14. SUPABASE GÜVENLİK (PRODUCTION-CRITICAL)

`public` şemada her yeni tablo için 4 adım zorunlu: **GRANT + RLS ENABLE + POLICY + doğrulama sorgusu**.
GRANT'siz migration = production-critical hata. RLS kapalıyken `authenticated` policy anlamsız.

---

## 15. KESİN YASAKLAR

- Çoklu-sistem refactor.
- Regresyon kilidini zayıflatma/silme.
- Fake completion / hallucination.
- 🔴 ledger bekleyeni "çalışıyor" sunmak.
- Onay istemek (dosya/işlem düzeyinde) — ama merge kullanıcıya ait.
- Gömülü AI anahtarı / copyleft bağımlılık / marka logosu.
