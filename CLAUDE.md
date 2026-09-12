# CarOS Pro — CLAUDE.md

Bu dosya **tek global AI çalışma kuralıdır**. Başka bir belge (AI.md, GEMINI.md,
MEMORY.md, AGENT_GUIDE, HANDOFF, PROJECT_STATE, workspace notları) global otorite değildir.

---

## 1. ANA KURAL

> **En küçük güvenli değişikliği yap. Değişikliğin riski kadar doğrula.**

Kalite = çok dosya değiştirmek, çok test çalıştırmak veya uzun rapor yazmak **değildir**.
Kalite = doğru problemi minimum kapsamda çözüp gerçek riski doğru kanıtla kapatmaktır.

Varsayılan çalışma modu **FAST DEV**'dir. Süreç uğruna iş üretmek yasaktır.

Bir işlem şu üçünden hiçbirini sağlamıyorsa FAST DEV'de yapma:
1. Gerçek bir bug yakalama ihtimalini anlamlı artırıyor mu?
2. Mimari/güvenlik ihlalini önlüyor mu?
3. Kullanıcıya veya gerçek cihaza yansıyan sonucu doğrulamak için gerekli mi?

---

## 2. DİL VE ÇIKTI

- Kullanıcıya her zaman **Türkçe** cevap ver; teknik semboller İngilizce kalabilir.
- FAST DEV sonunda kısa rapor: `ROOT CAUSE / CHANGED / VALIDATION / OPEN RISK / COMMIT`.
- Kullanıcı istemedikçe uzun denetim/kapanış raporu üretme.

---

## 3. DOCUMENTATION GOVERNANCE

- **Yeni Markdown oluşturma varsayılan olarak yasaktır.**
- Task/report/handoff/checkpoint için MD oluşturma.
- Önce mevcut canonical belgeyi güncelle.
- Yeni belge ancak kalıcı contract/ADR/security/operations/public API veya explicit
  user request için açılabilir.
- Tarihli raporlar canonical authority değildir.
- `docs/archive/` ve field evidence (`field-runs/`, `docs/field/`) normal geliştirme
  bağlamında **okunmaz**.
- Global AI instruction yalnız `CLAUDE.md`'dir.
- Domain belgeleri yalnız ilgili görevde okunur.
- Doküman değişikliği kod değişikliğinin otomatik şartı değildir.
- Her PR sonrası vision/handoff/progress güncellemesi **yoktur**.
- Otomatik Gemini/Claude/agent routing **yoktur**.
- Küçük görev için LAB/ledger/docs üretme zorunluluğu yoktur.

### Canonical belgeler

| Alan | Belge |
|---|---|
| AI çalışma kuralı | `CLAUDE.md` |
| Ürün vizyonu | `docs/CAROS_PRO_VIZYONU.md` |
| Saha doğrulama kütüğü (mutlak otorite) | `docs/DEVICE_VALIDATION_LEDGER.md` |
| Araç zekâsı mimarisi | `docs/architecture/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` |
| Veri akışı | `docs/architecture/ARCHITECTURE_DATAFLOW.md` |
| Public API | `docs/architecture/PUBLIC_API_V1.md` |
| Navigasyon | `docs/navigation/NAVIGATION_ARCHITECTURE_SPEC_v3.md` |
| Mavi (asistan) | `docs/mavi/CAROS_MAVI_ULTIMATE_OEM_ARCHITECTURE_SPEC_v1.md` |
| Asistan güvenlik standardı | `docs/mavi/SAFETY_ASSISTANT_STANDARD.md` |
| Müzik/medya | `docs/music/CAROS_MUSIC_ARCHITECTURE_SPEC_v1.md` |
| OBD/CAN saha kanıtı | `docs/obd-can/K24_CAN_OBD_FINDINGS.md` |
| Mimari kararlar | `docs/adr/` |
| Güvenlik sözleşmeleri | `docs/security/` |
| Operasyon/release | `docs/operations/` |
| Tarihsel kanıt (okuma zorunlu değil) | `docs/archive/`, `docs/field/`, `field-runs/` |

Tabloda olmayan belge otorite değildir; ona dayanarak durum ilan etme.

---

## 4. GÖREV KAPSAMI

Göreve bütün repoyu okuyarak başlama. Önce yalnız problemi sahiplenen dosya, doğrudan
dependency, ilgili test ve gerekiyorsa kanonik authority incelenir. Kanıt yetersizse
kapsam kademeli genişletilir. Küçük bug için geniş architecture audit yapma.

**Repo gerçeği üstündür.** Prompt, eski rapor veya doküman repo ile çelişirse mevcut
kod/test sonucu esastır. Tahmin ederek mimari değiştirme.

---

## 5. MINIMUM PATCH

Task için gereken en küçük güvenli patch'i yap. Görev dışı refactor, cleanup, rename,
abstraction, framework, manager, service, store, event bus, scheduler, authority ekleme.
"İleride lazım olabilir" gerekçe değildir.

---

## 6. TEK OTORİTE

Her gerçek kavramın tek writable/kanonik sahibi vardır. Yeni ikinci truth store, mirror
authority, hidden fallback authority, scheduler, recovery engine, freshness sistemi veya
global state authority kurma.

- UI → domain truth sahibi değildir; projeksiyondur.
- Mavi → Navigation/Media/Vehicle truth sahibi değildir.
- Security → yalnız izin kararı verir, domain truth üretmez.
- Performance → cadence/budget yönetir, truth değiştiremez.
- LAB → gözlemler, üretim truth'u üretmez.

---

## 7. DOMAIN SINIRLARI

Domainler birbirinin private mutable state'ine bağlanmaz. Tercih sırası:
kanonik command/request/result sözleşmesi → read-only projection →
mevcut capability/admission interface → mevcut port/adapter.

Cross-domain failure gereksiz yayılmaz: Media failure Navigation'ı, Mavi failure driving
core'u, Phone Link failure yerel araç fonksiyonlarını kapatmaz.

Vehicle truth kanonik yoldan akar:
`OBD / CAN / GPS / HAL → domain adapter/owner → kanonik vehicle truth → consumer projection`.

Audio çakışması mevcut ortak arbitration/focus mekanizması üzerinden çözülür.

---

## 8. EVIDENCE / UNKNOWN

Kanıtlanmamış bilgi üretme. Unknown veri için sahte `0`, tarih, `success`, `healthy`,
`current`, `available` üretme; `UNKNOWN / UNAVAILABLE / STALE` kullan.
Persisted/cache/replay verisi otomatik olarak current live truth değildir.

Async sonuçlar session/generation/epoch/correlation sınırını korur; eski session sonucu
yeni session truth'unu değiştiremez.

Belirsizlikte mevcut fail-closed/fail-soft davranışı koru. Fallback yeni authority
oluşturmaz, hatayı success göstermez, missing veriyi gerçek veri gibi sunmaz.

Performans optimizasyonu truth'u değiştiremez. İzinli: sampling, throttling, coalescing,
defer, cache trim, render degradation. Yasak: stale→current, missing→zero, dropped→success.

---

## 9. FAST DEV — VARSAYILAN MOD

1. Sorunu minimum kapsamda bul → 2. root cause'u kanıtla → 3. minimum güvenli patch →
4. targeted testler → 5. authority/safety etkilendiyse ilgili guard'lar → 6. `tsc` →
7. yalnız değişen dosyalarda lint → 8. gerekliyse kısa cihaz smoke → 9. kısa rapor →
10. atomik commit.

FAST DEV'de varsayılan olarak YAPMA: full repository scan, vizyon belgesi okuma/güncelleme,
otomatik agent spawn, zorunlu LAB entegrasyonu, full test suite, production build,
`npm run apk:safe`, geniş compatibility gate, uzun kapanış raporu, sayı artırmak için test.

> **KRİTİK: FAST DEV sırasında `npm run apk:safe` çalıştırma.**

---

## 10. TEST STRATEJİSİ

| Değişiklik | Doğrulama |
|---|---|
| Küçük local patch | targeted unit/regression test |
| Authority / cross-domain | targeted test + ilgili authority/safety guard |
| Native/device davranışı | targeted test + gerekirse gerçek cihaz smoke |
| Feature/faz kapanışı | PHASE GATE |
| Gerçek release/sevkiyat | RELEASE GATE |

Test sayısı kalite metriği değildir. Aynı state üzerinde geçmiş ağır gate'i yeni risk
yoksa tekrarlama.

**PHASE GATE:** geniş ilgili regression + authority/safety guards + full suite +
production build + `git diff --check`, bir kez. `apk:safe` PHASE GATE'in parçası değildir.
Verdict: `QA PASS — PHASE CLOSURE ELIGIBLE` veya `QA FAIL`.

**RELEASE GATE:** yalnız gerçek release/sevkiyat/compatibility kapanışında — full suite,
production build, `npm run apk:safe`, compatibility verification, APK provenance/hash,
gerekli cihaz doğrulaması, security/lisans kontrolleri.

---

## 11. CODE / DEVICE / FIELD AYRIMI

`CODE PASS` → `DEVICE PASS` → `FIELD PASS` → `PRODUCT READY` farklı kanıt seviyeleridir;
biri diğerini üretmez. Testlerin geçmesi DEVICE PASS değildir. Telefon testi head-unit
PASS değildir. Head-unit smoke gerçek araç FIELD PASS değildir.

`docs/DEVICE_VALIDATION_LEDGER.md` gerçek cihaz/saha kanıtı gereken işler için kullanılır
(GPS, OBD, CAN, BLE, mikrofon, native Android, head-unit/WebView, render, thermal, sürüş
davranışı). Her kod değişikliği için ledger maddesi açma; küçük CSS/typography/label/
type-only/test değişikliği ledger gerektirmez. Ledger'da 🔴 olanı DEVICE/FIELD PASS diye
sunma.

---

## 12. GÜVENLİK

Araç güvenliği, authorization, secret veya production access etkileniyorsa minimum patch
ilkesi sürer, doğrulama riske göre genişler.

- Secret/API key/token/keystore şifresi **loglama ve dokümana yazma**.
- Kanıtsız authorization fallback oluşturma; security failure'ı success gösterme.
- Güvenlik kontrolünü performans/UX gerekçesiyle bypass etme.
- Lisans/harita verisi: development ile commercial release uygunluğunu karıştırma; erişim,
  lisans, attribution ve redistribution kanıtsızsa release için uygun sayma (fail-closed).

---

## 13. UI / KARTOGRAFİ

Görsel işte tek soru: **gerçek kullanıcı gözle görülür iyileşme görüyor mu?**
Tur: tek görünür problem → gerçek render owner → minimum patch → targeted doğrulama →
mümkünse hızlı gerçek render/cihaz kontrolü. Değişikliğin gerçek render path'e ulaştığını
önce doğrula; yanlış component'i tekrar tekrar güzelleştirme. UI değişikliği
routing/navigation/vehicle truth üretmez.

---

## 14. ROOT CAUSE ÖNCE

Semptomu gizleyerek bug kapatma. Önce kanıtla: değer nereden geliyor, owner kim, input ne,
stale/cache/fallback var mı, aynı entity/session korunuyor mu. Semantik fark gerçek ve
kasıtlıysa UX bunu doğru anlatır.

---

## 15. GIT VE PARALEL OTURUM GÜVENLİĞİ

- Başka oturumun kirli dosyalarına dokunma; kullanıcının değişikliklerini geri alma.
- İlgisiz dosyaları staging'e alma; commit yalnız kendi task kapsamını içerir.
- Destructive işlem (reset, force push, branch silme, toplu silme, overwrite) onaysız yapılmaz.
- Küçük ve anlamlı atomik commit tercih et; kapsamı `git diff` ile kontrol et.

---

## 16. SON KONTROL

- Root cause gerçekten kanıtlandı mı?
- Patch minimum mu, mevcut authority korundu mu?
- Targeted doğrulama geçti mi?
- Yeni gereksiz MD/LAB/ledger/agent işi ürettim mi?
- Cihaz/saha kanıtı olmayan şeye DEVICE/FIELD PASS dedim mi?
- `apk:safe` çalıştırmaya mı hazırlanıyorum? (FAST DEV'de cevap: **HAYIR**.)
