# CarOS Pro — CLAUDE.md

## 1. TEMEL ÇALIŞMA KURALI

CarOS Pro profesyonel, gerçek araçlarda çalışan bir Vehicle Intelligence OS projesidir.

Ana geliştirme ilkesi:

> **En küçük güvenli değişikliği yap. Değişikliğin riski kadar doğrula.**

Kalite; çok dosya değiştirmek, çok test çalıştırmak veya uzun rapor yazmak değildir.
Kalite, doğru problemi minimum kapsamda çözüp gerçek riski doğru kanıtla kapatmaktır.

Normal çalışma modu **FAST DEV**'dir.

Süreç uğruna iş üretmek yasaktır.

Bir işlem aşağıdakilerden hiçbirini sağlamıyorsa FAST DEV'de zorunlu değildir:

1. Gerçek bir bug yakalama ihtimalini anlamlı artırıyor mu?
2. Mimari/güvenlik ihlalini önlüyor mu?
3. Kullanıcıya veya gerçek cihaza yansıyan sonucu doğrulamak için gerekli mi?

Üçü de HAYIR ise yapma.

---

# 2. DİL VE ÇIKTI

- Kullanıcıya her zaman Türkçe cevap ver.
- Teknik isimler, kod sembolleri ve standart terimler gerektiğinde İngilizce kalabilir.
- FAST DEV sonunda kısa rapor ver.
- Kullanıcı istemedikçe uzun denetim/kapanış raporu üretme.
- Taşınması gereken rapor/plan/komutları kopyalanabilir markdown bloklarında ver.
- Basit cevapları gereksiz kod bloğuna alma.

FAST DEV varsayılan raporu:

ROOT CAUSE:
CHANGED:
VALIDATION:
OPEN RISK:
COMMIT:

---

# 3. GÖREV KAPSAMI — ÖNCE DAR BAK

Göreve bütün repoyu okuyarak başlama.

Önce yalnız:

1. problemi doğrudan sahiplenen dosya/component/module,
2. doğrudan dependency,
3. ilgili test,
4. gerekiyorsa kanonik authority

incelenir.

Kanıt yetersizse kapsam kademeli genişletilir.

Küçük bir bug için geniş architecture audit yapma.

Kullanıcı istemedikçe bütün repo taraması yapma.

Görevle ilgisiz domainleri inceleme.

---

# 4. REPO GERÇEĞİ ÜSTÜNDÜR

Prompt, eski rapor, doküman veya önceki konuşma repo ile çelişirse mevcut repo gerçeği üstündür.

Tahmin ederek mimari değiştirme.

Önce mevcut owner/authority/pattern'i bul.

Var olan çözüm genişletilebiliyorsa paralel sistem kurma.

---

# 5. MINIMUM PATCH

Task için gereken en küçük güvenli patch'i yap.

Görev dışı:

- refactor,
- cleanup,
- rename,
- abstraction,
- framework,
- manager,
- service,
- store,
- event bus,
- scheduler,
- authority

ekleme.

"İleride lazım olabilir" gerekçesi yeterli değildir.

Yeni abstraction yalnız gerçek tekrar, authority boşluğu veya kanıtlanmış mimari ihtiyaç varsa eklenir.

---

# 6. TEK OTORİTE KURALI

Her gerçek kavramın tek writable/kanonik sahibi vardır.

Yeni ikinci:

- truth store,
- mirror authority,
- hidden fallback authority,
- scheduler,
- recovery engine,
- freshness sistemi,
- global state authority

kurma.

Bir domain başka domainin truth'unu sahiplenemez.

Örnek:

- UI → domain truth sahibi değildir.
- Mavi → Navigation/Media/Vehicle truth sahibi değildir.
- Security → yalnız izin kararı verir, domain truth üretmez.
- Performance → cadence/budget yönetebilir, truth değiştiremez.
- LAB → gözlemler, üretim truth'u üretmez.

---

# 7. DOMAIN SINIRLARI

Domainler birbirinin private mutable state'ine doğrudan bağlanmaz.

Tercih sırası:

1. mevcut kanonik command/request/result sözleşmesi,
2. read-only projection,
3. mevcut capability/admission interface,
4. mevcut port/adapter.

Başka domainin mutable store'una doğrudan import yapma.

Gereksiz hard dependency kurma.

Cross-domain failure gereksiz yere yayılmamalıdır.

Örnek:

- Media failure Navigation'ı kapatmaz.
- Mavi failure driving core'u kapatmaz.
- Phone Link failure yerel araç fonksiyonlarını kapatmaz.
- Network failure mevcut offline capability'leri gereksiz yere kapatmaz.

---

# 8. UI BİR PROJEKSİYONDUR

UI:

- domain state okuyabilir,
- presentation state tutabilir,
- animation/layout state tutabilir.

UI doğrudan:

- navigation truth,
- vehicle truth,
- diagnostic truth,
- playback truth,
- connectivity truth

üretmez veya yazmaz.

Routing/ETA/vehicle karar mantığını component içine taşıma.

---

# 9. EVIDENCE / PROVENANCE / UNKNOWN

Kanıtlanmamış bilgi üretme.

Unknown veri için sahte:

- 0,
- tarih,
- success,
- healthy,
- current,
- available

üretme.

Gerektiğinde:

UNKNOWN
UNAVAILABLE
STALE

gibi açık durum kullan.

Persisted/cache/replay verisi otomatik olarak CURRENT live truth değildir.

Kanıt/provenance gerektiren mevcut sözleşmeleri koru.

---

# 10. ASYNC / SESSION GÜVENLİĞİ

Async sonuçlar ilgili:

- session,
- generation,
- epoch,
- correlation

sınırlarını korumalıdır.

Eski session sonucu yeni session truth'unu değiştiremez.

Stale callback ile current state overwrite etme.

---

# 11. FAIL-CLOSED / FAIL-SOFT

Güvenlik, authority veya doğruluk açısından belirsizlik varsa kanıt uydurma.

Riskli durumda mevcut fail-closed/fail-soft davranışı koru.

Bir fallback:

- yeni authority oluşturmamalı,
- hatayı success gibi göstermemeli,
- missing veriyi gerçek veri gibi sunmamalıdır.

---

# 12. PERFORMANCE KURALI

Performans optimizasyonu truth'u değiştiremez.

İzin verilenler:

- sampling,
- throttling,
- coalescing,
- defer,
- cache trim,
- render degradation.

Yasak örnekler:

- stale → current,
- missing → zero,
- dropped → success,
- low FPS → domain failure,
- memory pressure → sahte service failure.

Mevcut AdaptiveRuntimeManager/resource authority korunur.

Domain kendi protocol cadence sahipliğini korur.

Yeni global scheduler/performance manager kurma.

---

# 13. AUDIO / VEHICLE / PHONE SINIRLARI

Audio interaction mevcut ortak arbitration/focus mekanizması üzerinden çözülür.

Navigation → Music direct mute authority kurma.
Mavi → Media volume truth sahibi yapma.

Vehicle truth genel olarak mevcut kanonik yol üzerinden akar:

OBD / CAN / GPS / HAL
→ mevcut domain adapter/owner
→ kanonik vehicle/signal truth
→ consumer projection.

UI/Mavi/Navigation raw transport truth sahibi olmaz.

Phone Link transport/control/data-plane sınırlarını korur.
High-bandwidth data plane control authority üretmez.

---

# 14. RECOVERY

Domain failure evidence üretebilir.

Mevcut recovery authority/policy/execution zincirini kullan.

Domain içine gizli ikinci restart/backoff/recovery motoru kurma.

---

# 15. FAST DEV — VARSAYILAN MOD

Normal günlük geliştirme FAST DEV'dir.

Akış:

1. Sorunu minimum kapsamda bul.
2. Root cause'u kanıtla.
3. Minimum güvenli patch'i yap.
4. İlgili targeted testleri çalıştır.
5. Değişiklik authority/safety contract etkiliyorsa yalnız ilgili guard'ları çalıştır.
6. TypeScript kontrolü yap.
7. Yalnız değişen dosyalarda lint yap.
8. Gerekliyse kısa runtime/device smoke yap.
9. Kısa rapor ver.
10. Mantıklı atomik commit oluştur.

FAST DEV sırasında varsayılan olarak YAPMA:

- full repository scan,
- bütün mimari belgeleri okuma,
- vizyon belgesi okuma,
- vizyon belgesi güncelleme,
- otomatik agent spawn/delegasyon,
- gereksiz CAROS LAB entegrasyonu,
- full test suite,
- production build,
- `npm run apk:safe`,
- geniş compatibility gate,
- release provenance/hash,
- alakasız subsystem testleri,
- uzun kapanış raporu,
- sırf sayı artırmak için test/guard üretmek.

## KRİTİK

> **FAST DEV sırasında `npm run apk:safe` çalıştırma.**

Küçük UI/CSS/bugfix/refactor değişikliğinin APK SAFE çalıştırması için tek başına gerekçe olması yasaktır.

---

# 16. TEST STRATEJİSİ

Test kapsamı değişikliğin riskine göre seçilir.

### Küçük local patch

Targeted unit/regression test.

### Authority veya cross-domain değişikliği

Targeted test + ilgili authority/safety guard.

### Native/device davranışı

Targeted test + gerekiyorsa gerçek cihaz smoke.

### Büyük feature/faz kapanışı

PHASE GATE.

### Gerçek release/sevkiyat

RELEASE GATE.

Test sayısı kalite metriği değildir.

Değişikliğin gerçek riskini yakalayan test değerlidir.

Mevcut testleri sırf prosedür için tekrar tekrar çalıştırma.

Aynı production state üzerinde daha önce geçmiş ağır gate'i yeni risk yoksa tekrarlama.

---

# 17. PHASE GATE

PHASE GATE yalnız gerçek bir feature/faz tamamlandığında çalışır.

Her commit PHASE GATE değildir.

Her FAST DEV turu PHASE GATE değildir.

Phase Gate'te:

- geniş ilgili regression,
- authority/safety guards,
- full suite,
- production build,
- `git diff --check`

bir kez çalıştırılır.

Gerekliyse device validation yapılır.

## KRİTİK

> **`npm run apk:safe` PHASE GATE'in parçası değildir.**

PHASE GATE otomatik olarak RELEASE GATE'e dönüşmez.

Verdict:

QA PASS — PHASE CLOSURE ELIGIBLE

veya

QA FAIL

QA PASS gerçek cihaz kanıtı yerine geçmez.

---

# 18. RELEASE GATE

RELEASE GATE yalnız gerçek:

- release,
- satış,
- sevkiyat,
- dağıtılacak APK,
- compatibility kapanışı

için kullanılır.

Burada gerektiğinde:

- full suite,
- production build,
- `npm run apk:safe`,
- compatibility verification,
- APK provenance/hash,
- gerekli cihaz/saha doğrulaması,
- security/release kontrolleri,
- gerekli lisans kontrolleri

çalıştırılır.

## KRİTİK

> **`apk:safe` normal geliştirme komutu değildir.**

Varsayılan kullanım yeri RELEASE GATE'tir.

Kullanıcı açıkça release/sevkiyat/uyumluluk doğrulaması istiyorsa da çalıştırılabilir.

---

# 19. CODE / DEVICE / FIELD AYRIMI

Şunlar farklı kanıt seviyeleridir:

CODE PASS
DEVICE PASS
FIELD PASS
PRODUCT READY

Biri diğerini otomatik üretmez.

Testlerin geçmesi DEVICE PASS değildir.

Telefon testi head-unit PASS değildir.

Head-unit smoke gerçek araç FIELD PASS değildir.

Gerçek saha kanıtı yoksa varmış gibi raporlama.

---

# 20. DEVICE VALIDATION LEDGER

`docs/DEVICE_VALIDATION_LEDGER.md` gerçek cihaz/saha kanıtı gereken işler için kullanılır.

Ledger kaydı ZORUNLU olabilir:

- GPS,
- OBD,
- CAN,
- BLE,
- microphone/audio,
- native Android,
- head-unit/WebView,
- camera/render behavior,
- thermal/memory/performance,
- driving behavior,
- platform compatibility,
- gerçek cihazda görülmeden doğrulanamayacak kritik davranış.

Her kod değişikliği için ledger maddesi açma.

Varsayılan olarak ledger gerektirmeyen örnekler:

- küçük CSS,
- typography,
- spacing,
- label/text,
- salt unit-level bugfix,
- test düzeltmesi,
- type-only değişiklik,
- platform bağımsız küçük refactor,
- doküman değişikliği.

Ancak bir UI/render değişikliğinin gerçek cihaz sonucu kritikse cihaz doğrulaması istenebilir.

Ledger'da 🔴 olan bir şeyi DEVICE/FIELD PASS diye sunma.

---

# 21. CAROS LAB

CAROS LAB her özellik için zorunlu değildir.

LAB yalnız gerçekten gözlemlenmesi gereken önemli sistemlerde düşünülür.

LAB gerektirebilecek örnekler:

- yeni önemli subsystem/service,
- kendi lifecycle/state/health bilgisi olan sistem,
- native/runtime teşhisi gereken mekanizma,
- kritik Navigation/Vehicle/Audio/Security authority,
- saha debugging'inde gerçek gözlem değeri olan sistem.

LAB gerektirmeyen tipik işler:

- UI/CSS,
- renk/token,
- typography,
- spacing/layout,
- küçük component değişikliği,
- küçük bugfix,
- label/metin,
- test/guard düzeltmesi,
- basit refactor,
- kozmetik iyileştirme,
- bağımsız runtime state/health/lifecycle taşımayan küçük özellik.

> **Her yeni özellik = LAB entegrasyonu DEĞİLDİR.**

LAB gerekiyorsa önce mevcut ilgili ekranı genişlet.

Sırf prosedür için yeni:

Sources
→ Model
→ Screen
→ Catalog

zinciri üretme.

LAB salt-okunur gözlem yüzeyidir ve ikinci authority olamaz.

---

# 22. DOKÜMANTASYON

Her görev öncesi vizyon belgesi okumak zorunlu değildir.

Her PR sonrası vizyon belgesi güncellemek zorunlu değildir.

Doküman yalnız değişiklik gerçekten gerektiriyorsa güncellenir.

Örnek:

- public contract değişti,
- önemli architecture/authority değişti,
- operasyon/release prosedürü değişti,
- kullanıcı davranışı anlamlı değişti,
- kullanıcı özellikle istedi.

Küçük:

- bugfix,
- CSS,
- UI polish,
- refactor,
- test değişikliği

için otomatik dokümantasyon üretme.

Domain mimarisi gerekiyorsa ilgili domain belgesini o zaman oku.

---

# 23. AJAN / MODEL KULLANIMI

Otomatik agent/model yönlendirme YOK.

Varsayılan çalışma mevcut oturumda INLINE'dır.

Görevin Navigation/OBD/Mavi vb. olması tek başına agent spawn gerekçesi değildir.

Kullanıcı açıkça istemedikçe veya mevcut çalışma ortamı açıkça gerektirmedikçe gereksiz delegasyon yapma.

---

# 24. UI / KARTOGRAFİ GELİŞTİRME

Görsel işlerde test tek başına başarı değildir.

Temel soru:

> **Gerçek kullanıcı gözle görülür iyileşme görüyor mu?**

Küçük görsel tur:

1. tek görünür problem,
2. gerçek render owner,
3. minimum patch,
4. targeted validation,
5. mümkünse hızlı gerçek render/device kontrolü.

Cihazda/render'da görünür fark yoksa ikinci polish turuna geçme.

Önce değişikliğin gerçek render path'e ulaştığını doğrula.

Yanlış component'i tekrar tekrar güzelleştirme.

UI değişikliği routing/navigation/vehicle truth üretmemelidir.

---

# 25. ROOT CAUSE ÖNCE

Semptomu gizleyerek bug kapatma.

Örneğin iki değer çelişiyorsa yalnız label değiştirip gerçek data-flow hatasını gizleme.

Önce:

- değer nereden geliyor,
- owner kim,
- input nedir,
- stale/cache/fallback var mı,
- aynı entity/session korunuyor mu

kanıtla.

Semantik fark gerçek ve kasıtlıysa UX bunu doğru anlatmalıdır.

---

# 26. GIT ÇALIŞMA GÜVENLİĞİ

Başka oturumun kirli dosyalarına dokunma.

Kullanıcının mevcut değişikliklerini geri alma.

İlgisiz dosyaları staging'e alma.

Destructive işlemler:

- reset,
- force push,
- branch silme,
- dosya toplu silme,
- kullanıcı değişikliğini overwrite etme

onaysız yapılmaz.

Küçük ve anlamlı commit tercih et.

`git diff` ile kendi değişikliğinin kapsamını kontrol et.

---

# 27. PARALEL OTURUM GÜVENLİĞİ

Worktree kirliyse bunun kendi değişikliğin olduğunu varsayma.

Görev dışı dirty dosyalara dokunma.

Commit/staging yalnız kendi task kapsamını içermelidir.

Başka oturumun değişikliklerini cleanup etme.

---

# 28. GÜVENLİK KRİTİK DAVRANIŞ

Araç güvenliği, authorization, secret, kullanıcı verisi veya production access etkileniyorsa minimum patch ilkesi devam eder fakat doğrulama riske göre genişletilir.

Secret/API key/token loglama.

Kanıtsız authorization fallback oluşturma.

Security failure'ı success gibi gösterme.

Güvenlik kontrolünü performans/UX gerekçesiyle bypass etme.

---

# 29. LİSANS / HARİTA VERİSİ

Development/evaluation ile commercial release uygunluğunu birbirine karıştırma.

Veri kaynağının:

- erişimi,
- lisansı,
- attribution şartı,
- redistribution hakkı

kanıtsızsa release için uygun varsayma.

Erişim kontrolünü aşma.

Private/prohibited endpoint kullanma.

Release eligibility belirsizse fail-closed davran.

Lisans denetimini her küçük geliştirmede tekrar etme; gerçek veri kaynağı veya release durumu değiştiğinde ele al.

---

# 30. BÜYÜK MİMARİ DEĞİŞİKLİKLER

Aşağıdakiler değişiyorsa kapsamlı mimari inceleme gerekebilir:

- canonical authority,
- cross-domain contract,
- scheduler,
- recovery ownership,
- persistence/live truth ilişkisi,
- security boundary,
- vehicle truth path,
- navigation truth,
- audio arbitration,
- native/HAL boundary.

Bu inceleme küçük UI/bugfix görevlerine uygulanmaz.

Büyük domain/faz kapanışında kontrol et:

- duplicate authority?
- hidden hard dependency?
- circular dependency?
- private mutable store import?
- duplicate scheduler?
- duplicate recovery?
- stale write?
- security bypass?
- performance truth corruption?

---

# 31. GERÇEK SONUÇ > SÜREÇ

Claude'un görevi süreç tamamlamak değil, çalışan ürünü geliştirmektir.

Şunlar tek başına başarı değildir:

- çok test çalıştırmak,
- çok guard eklemek,
- çok doküman yazmak,
- LAB ekranı eklemek,
- uzun rapor üretmek,
- büyük diff yapmak.

Başarı:

> **Doğru root cause + minimum güvenli çözüm + riskle orantılı kanıt + gerçek kullanıcı/cihaz sonucu.**

---

# 32. SON KONTROL

Her FAST DEV görevinin sonunda kendine sor:

- Gereğinden fazla dosya okudum mu?
- Görev dışı refactor yaptım mı?
- Gereksiz agent kullandım mı?
- Gereksiz LAB işi çıkardım mı?
- Gereksiz ledger kaydı açtım mı?
- Gereksiz doküman güncelledim mi?
- Full suite/build çalıştırmaya gerçekten gerek var mıydı?
- `apk:safe` çalıştırmaya mı hazırlanıyorum?

FAST DEV'de son sorunun cevabı normalde:

**HAYIR.**

Ayrıca:

- Root cause gerçekten kanıtlandı mı?
- Patch minimum mu?
- Mevcut authority korundu mu?
- Targeted doğrulama geçti mi?
- Cihaz/saha kanıtı olmayan şeye DEVICE/FIELD PASS dedim mi?

Bu kurallar sağlanıyorsa işi kapat ve gereksiz ek çalışma üretme.
