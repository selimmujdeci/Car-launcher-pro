# CAROS PRO — KARAR GÜNLÜĞÜ

> Burada **verilmiş ve sebepsiz yere yeniden tartışılmaması gereken** kararlar durur.
> Resmî ve büyük mimari kararların **asıl otoritesi `docs/adr/`** klasörüdür; bu belge
> onların indeksini + ADR açmayı gerektirmeyen kalıcı ara kararları tutar.
> Append-only: kimlikler **yeniden numaralandırılmaz**. Durum: `ACTIVE` · `PROVISIONAL` ·
> `SUPERSEDED`. Aktif görev, test çıktısı, roadmap ve teknik borç **buraya yazılmaz**.

## ADR indeksi (asıl otorite: `docs/adr/`)

| ADR | Konu | ADR'deki durum |
|---|---|---|
| 0001 | Tek kanonik hız kaynağı (`useUnifiedVehicleStore`) | Kabul edildi (`99abf60`) |
| 0002 | Low-end head unit performans modu (`AdaptiveRuntimeManager` + `DeviceTier`) | Faz 1 kabul (`2fbbd57`), Faz 2 PENDING |
| 0003 | BLE + Classic çift OBD transport mimarisi | Kabul edildi (`04d0ef2`), saha testi bekliyor |
| 0004 | YouTube/video stratejisi — gömülü video REVERT, audio/stream odaklı | Kabul edildi |

---

## DEC-001 — Repository, oturumlar arası tek kalıcı bağlam kaynağıdır

- Tarih: 2026-07-27 (Workspace'e kayıt; ilke bundan önce yürürlükteydi)
- Durum: ACTIVE
- Karar: Bir bilgi repository'de kayıtlı değilse **kayıtlı sayılmaz**. Sohbet geçmişi,
  önceki oturum özetleri ve model hafızası doğrulanmış durumun yerine geçmez.
- Gerekçe: Oturumlar sıfırdan başlar; bağlamın tek dayanıklı taşıyıcısı depodur.
- Alternatif/reddedilen: Bağlamı sohbet geçmişinde veya `.claude/` altında tutmak.
- Sonuç/sınır: `.claude/` araç konfigürasyonudur; proje hafızası oraya konmaz.
- Kanıt/otorite: `docs/workspace/00_START_HERE.md` §A · `docs/project/PROJECT_MEMORY.md` başlığı
- İlgili dosyalar: `docs/workspace/00_START_HERE.md`, `docs/workspace/01_STATE.md`

## DEC-002 — Kod yazan tek ajan Claude Code'dur; diğer modeller analiz rolündedir

- Tarih: 2026-07-27 (kayıt; `GEMINI.md` 2026-07-15'ten beri yürürlükte)
- Durum: ACTIVE
- Karar: Kod, test ve dosya değişikliğini yalnız Claude Code üretir. Gemini/ChatGPT
  repo analisti, risk tespitçisi ve prompt hazırlayıcı olarak kalır.
- Gerekçe: Tek yazar = tek sorumluluk zinciri; analiz rolü limit tüketimini düşürür.
- Alternatif/reddedilen: Birden fazla modelin doğrudan dosya değiştirmesi.
- Sonuç/sınır: Dış modelden gelen denetim raporu **iddiadır, kanıt değildir**; kodla
  doğrulanır, çelişirse uygulanmaz ve sapma raporlanır.
- Kanıt/otorite: `GEMINI.md` (kesin yasak 1-2) · `CLAUDE.md` → ajan yönlendirme tablosu
- İlgili dosyalar: `GEMINI.md`, `CLAUDE.md`

## DEC-003 — Otomatik commit atılmaz; yabancı çalışma ağacı değişiklikleri korunur

- Tarih: 2026-07-27
- Durum: ACTIVE
- Karar: Oturum kendiliğinden commit/push atmaz. Çalışma ağacındaki, o oturuma ait
  **olmayan** değişiklikler sahiplenilmez, revert edilmez, bozulmaz.
- Gerekçe: İç içe geçmiş tamamlanmamış kümeler varken izole olmayan commit derlenmez.
- Alternatif/reddedilen: Her görev sonunda otomatik commit.
- Sonuç/sınır: `CLAUDE.md` git komutları için **onay sorulmamasını** söyler; bu,
  "kendiliğinden commit at" anlamına GELMEZ — commit kullanıcı istediğinde atılır.
- Kanıt/otorite: `docs/workspace/00_START_HERE.md` §D · `docs/workspace/01_STATE.md` §5, §7
- İlgili dosyalar: `docs/workspace/00_START_HERE.md`

## DEC-004 — Oturum giriş sırasının tek sahibi `00_START_HERE.md` dosyasıdır

- Tarih: 2026-07-26
- Durum: ACTIVE
- Karar: Güncel Claude Code oturum giriş sırasının tek sahibi
  `docs/workspace/00_START_HERE.md` dosyasıdır.
- Gerekçe: Dört ayrı "önce şunu oku" talimatı (`CONTRIBUTING.md §0`, `HANDOFF.md §1`,
  `CLAUDE.md`, `docs/project/MASTER_PROMPT.md`) birbirini tutmuyordu.
- Alternatif/reddedilen: `CONTRIBUTING.md §0`'ı kanonik sıra yapmak — o dosya artık
  var olmayan/eskimiş durum belgelerine yönlendiriyor.
- Sonuç/sınır: **AÇIK BORÇ** — eski giriş ifadeleri bu görevde değiştirilmedi.
  Onların yönlendiriciye dönüştürülmesi **ayrı bir atomik görevdir**.
- Kanıt/otorite: `docs/workspace/00_START_HERE.md` §A · `src/__tests__/workspaceGuards.test.ts`
- İlgili dosyalar: `CONTRIBUTING.md`, `HANDOFF.md`, `docs/project/MASTER_PROMPT.md`

## DEC-005 — Workspace altı belgeyle sınırlıdır, işaretçi kullanır, tavanları vardır

- Tarih: 2026-07-26
- Durum: ACTIVE
- Karar: `docs/workspace/` yalnız altı belge tutar (`00`–`05`). Güncel durumun tek
  hedef sahibi `01_STATE.md`'dir. Workspace **içerik kopyalamaz, işaret eder**.
  Satır tavanları test ile kilitlidir.
- Gerekçe: Değeri küçük ve tek-kaynak kalmasındadır; kopya içerik sessizce eskir.
- Alternatif/reddedilen: Serbest büyüyen bir "notlar" klasörü; kütük içeriğini kopyalamak.
- Sonuç/sınır: Somut hata örneği — `docs/project/DEVICE_VALIDATION.md` kütük içeriğini
  kopyaladığı için asıl kütük büyürken geride kaldı. Bu desen test ile yasaklandı.
- Kanıt/otorite: `src/__tests__/workspaceGuards.test.ts` (satır tavanı + kopyalama kilitleri)
- İlgili dosyalar: `docs/workspace/*`, `src/__tests__/workspaceGuards.test.ts`

## DEC-006 — Saha doğrulamasında mutlak otorite `DEVICE_VALIDATION_LEDGER.md`'dir

- Tarih: 2026-07-27 (kayıt; kütük ilkesi çok daha eski)
- Durum: ACTIVE
- Karar: Bir özellik gerçek araçta ölçülene kadar "başarılı" sunulmaz. Test yeşili +
  `tsc` temiz **cihaz doğrulaması DEĞİLDİR**. Vizyonla çelişirse durum yükseltilmez.
- Gerekçe: Aftermarket telemetri güvenilmezdir; yalnız gerçek araç kanıttır.
- Alternatif/reddedilen: CI yeşilini "ürün hazır" saymak.
- Sonuç/sınır: Simülasyon araçları (ör. Mavi Senaryo Koşucusu) 14/14 PASS verse bile
  **hiçbir 🔴 maddeyi 🟢 yapmaz**.
- Kanıt/otorite: `docs/DEVICE_VALIDATION_LEDGER.md` başlığı · `AI.md` → REAL DEVICE REQUIRED · `CLAUDE.md`
- İlgili dosyalar: `docs/DEVICE_VALIDATION_LEDGER.md`

## DEC-007 — Otorite sınırı: ADR resmî mimari, bu belge ara kararlar

- Tarih: 2026-07-27
- Durum: ACTIVE
- Karar: Sistem sınırını, veri akışını veya transport'u değiştiren karar `docs/adr/`
  altında ADR açar. Bu belge ADR indeksi + kalıcı etkili ara kararları tutar.
- Gerekçe: İki paralel karar otoritesi = çelişkili mimari beyan riski.
- Alternatif/reddedilen: ADR'leri Workspace'e taşımak / ADR'leri terk etmek.
- Sonuç/sınır: Çelişki hâlinde **ADR kazanır**; bu belgedeki kayıt `SUPERSEDED` olur.
- Kanıt/otorite: `docs/adr/0001`–`0004`
- İlgili dosyalar: `docs/adr/`

## DEC-008 — Zero-Trust Telemetry

- Tarih: 2026-07-27 (kayıt; `PROJECT_MEMORY.md`'de kayıtlı)
- Durum: ACTIVE
- Karar: Hiçbir aftermarket sinyal doğru varsayılmaz; her sinyal confidence + kanıt ister.
- Gerekçe: Tesla yalnız kendi aracını tanır; CAROS PRO yüzlerce bilinmeyen modeli öğrenir.
  Yanlış sinyalle karar vermek, karar vermemekten kötüdür.
- Alternatif/reddedilen: Okunan her PID'i doğru kabul edip doğrudan göstermek.
- Sonuç/sınır: Daha çok `UNKNOWN`; tradeoff **eksik ama doğru > dolu ama yanlış**.
- Kanıt/otorite: `docs/project/PROJECT_MEMORY.md` → "Neden Zero-Trust Telemetry" · `CLAUDE.md`
- İlgili dosyalar: `src/core/val/`, `src/platform/aiCore/`

## DEC-009 — Fail-Closed Truth: bilinmeyen ≠ yanlış, kanıtsız aktifleşme yok

- Tarih: 2026-07-27 (kayıt; `PROJECT_MEMORY.md`'de kayıtlı)
- Durum: ACTIVE
- Karar: Kanıt yoksa değer `null`/`UNKNOWN` kalır ve **`false`'a projekte edilmez**.
  Kontak kaynağı yoksa `ignitionConfirmed = null` ve aktif tarama başlamaz.
- Gerekçe: Yanlış "kontak açık" varsayımı ECU'yu rahatsız eder, batarya çeker, güvenlik
  riski doğurur. Sahte "sağlıklı"/sahte 0 üretmek zero-trust'ı bozar.
- Alternatif/reddedilen: `null` değerini `false` gibi ele alıp akışı sürdürmek.
- Sonuç/sınır: Kaynak bağlanana dek aktif fazlar `waiting_for_ignition`'da bloke.
  Kabul: aktivasyon gecikmesi < yanlış aktivasyon riski.
- Kanıt/otorite: `docs/project/PROJECT_MEMORY.md` → "Neden Fail-Closed Ignition"
- İlgili dosyalar: `src/platform/deepScan/deepScanIgnitionSource.ts`, `ignitionEvidenceAdapter.ts`

## DEC-010 — CONTROLLED EVOLUTION + Performans-Uyarlanabilir Hibrit

- Tarih: 2026-07-27 (kayıt; `AI.md` MODE bölümünde yürürlükte)
- Durum: ACTIVE
- Karar: Yeni katmanlar serbest ama her biri `DeviceTier` bütçesine abone. Güvenlik-kritik
  katman her tier'da açık; ağır analiz idle'da; hot-path'e (3 Hz) yeni katman **girmez**.
  Bir kök neden = bir atomik yama.
- Gerekçe: Mali-400 sınıfı head unit'te hot-path'i şişirmek FPS düşürür, termal artırır.
- Alternatif/reddedilen: Big-bang refactor; düşük-uçta zekâ katmanını tamamen kapatmak.
- Sonuç/sınır: Düşük-uçta feda edilen **gösterimdir, zekâ değil**. Bütçesiz özellik yasak.
- Kanıt/otorite: `AI.md` → MODE · `CLAUDE.md` · `docs/adr/0002-low-end-head-unit-performance-mode.md`
- İlgili dosyalar: `src/core/runtime/AdaptiveRuntimeManager.ts`, `src/platform/deviceCapabilities.ts`

## DEC-011 — FAZ A: Developer First; UX şu an öncelik değil

- Tarih: 2026-07-27 (kayıt; `CLAUDE.md` FAZ A bölümünde yürürlükte)
- Durum: ACTIVE
- Karar: Öncelik: mimari → doğruluk → güvenlik → gözlemlenebilirlik → geliştirici araçları
  → performans → son kullanıcı deneyimi. Teknik isim (PID/DID/NRC/KWP/UDS) ve **ham
  hex/log gösterimi serbesttir**.
- Gerekçe: CAROS PRO bugün son kullanıcı ürünü değil, geliştirilen bir Vehicle OS'tur.
- Alternatif/reddedilen: "Kullanıcı bunu anlamaz" gerekçesiyle özelliği kısıtlamak.
- Sonuç/sınır: Bu politika **öncelik sırasını** değiştirir; stabilite invaryantlarını
  (fail-soft, zero-leak, atomik yama, performans bütçesi, saha kütüğü) **ezmez**.
- Kanıt/otorite: `CLAUDE.md` → FAZ A · `docs/CAROS_LAB_DEVELOPER_PLATFORM_STRATEGY.md`
- İlgili dosyalar: `src/platform/devtools/`, `src/components/devtools/`

## DEC-012 — Zorunlu gözlemlenebilirlik: LAB ekranı olmayan özellik tamamlanmamıştır

- Tarih: 2026-07-27 (kayıt; `CLAUDE.md`'de yürürlükte)
- Durum: ACTIVE
- Karar: Her önemli özellik **aynı fazda** CAROS LAB salt-okunur gözlem ekranıyla biter.
  LAB ekranı komut göndermez, kanıtsız bilgi üretmez (`UNKNOWN`/`UNAVAILABLE`) ve gizli
  veri taşımaz (yalnız VAR/YOK + ADET).
- Gerekçe: "Gözlemlenemeyen özellik tamamlanmış değildir."
- Alternatif/reddedilen: Özelliği önce yayınlayıp gözlem yüzeyini sonraya bırakmak.
- Sonuç/sınır: Gözlem yüzeyi yoksa özellik "tamamlandı" sunulmaz. Sınıflandırma
  `sessionInspectorModel` sözleşmesini kullanır — paralel sistem kurulmaz.
- Kanıt/otorite: `CLAUDE.md` → ZORUNLU GÖZLEMLENEBİLİRLİK KURALI
- İlgili dosyalar: `src/platform/devtools/carosLabCatalog.ts`, `sessionInspectorModel.ts`

## DEC-013 — Mavi shadow-first; takeover tek eylemle sınırlı

- Tarih: 2026-07-27 (kayıt; kod `takeoverPolicy.ts`'te)
- Durum: PROVISIONAL
- Karar: Mavi üretimde varsayılan olarak **gölge (shadow)** modda çalışır; gerçek
  yürütme devralması yalnız `TAKEOVER_ELIGIBLE` kümesindeki eylemler için mümkündür.
  Bugün bu küme tek elemanlıdır: `media.next`.
- Gerekçe: Çifte yürütme ve geri alınamaz eylem riski.
- Alternatif/reddedilen: Navigasyon/telefon eylemlerini de devralma kümesine almak.
- Sonuç/sınır: Kapsam genişletmesi **ayrı atomik görevdir**, saha doğrulaması ister.
  "Mavi tek karar otoritesidir" bugün **doğru değildir**; uzun vadeli hedeftir.
- Kanıt/otorite: `src/platform/maviCore/wiring/takeoverPolicy.ts:22` · `docs/MAVI_NEXT_VISION.md`
- İlgili dosyalar: `src/platform/maviCore/wiring/`

## DEC-014 — SAB / crossOriginIsolated üretimde KAPALI

- Tarih: 2026-07-27 (kayıt; `PROJECT_MEMORY.md`'de kayıtlı)
- Durum: ACTIVE
- Karar: `crossOriginIsolated = false`; COEP başlığı `vite.config.ts`'ten **bilinçli**
  kaldırıldı. `SharedArrayBuffer` hot-path'i üretimde pasiftir, fallback fail-soft.
- Gerekçe: COEP, gönderilen YouTube iframe'ini ve çapraz-köken müzik/radyo akışlarını bozar.
- Alternatif/reddedilen: COOP/COEP başlıklarını geri eklemek (medyayı kırar).
- Sonuç/sınır: **Kör COOP/COEP yaması YASAK.** SAB kazancı < medya çalışması.
- Kanıt/otorite: `docs/project/PROJECT_MEMORY.md` → "Neden SAB/COI prod'da KAPALI"
- İlgili dosyalar: `vite.config.ts`, `src/platform/deviceCapabilities.ts`

## DEC-015 — Ticari satılabilirlik: yalnız permissive lisans + BYOK

- Tarih: 2026-07-27 (kayıt; `CLAUDE.md` lisans bölümünde yürürlükte)
- Durum: ACTIVE
- Karar: Yalnız permissive lisans (MIT, Apache-2.0, BSD, ISC, Zlib, CC0, OFL) eklenir;
  GPL/AGPL/LGPL/SSPL ve "non-commercial" varlıklar **yasaktır**. AI erişimi **BYOK**;
  gömülü API anahtarı konmaz.
- Gerekçe: Copyleft kaynak açma zorunluluğu ve gömülü anahtar satış blocker'ıdır.
- Alternatif/reddedilen: Merkezî paylaşılan AI anahtarı ile "kurulumsuz" deneyim.
- Sonuç/sınır: Gömülü anahtar `dist` + APK'ya literal sızar. OSM verisi için
  `© OpenStreetMap katkıcıları` atıfı zorunludur (ODbL).
- Kanıt/otorite: `CLAUDE.md` → TİCARİ LİSANS bölümü · `PROJECT_MEMORY.md` → "Neden BYOK"
- İlgili dosyalar: `LICENSE-PROPRIETARY.md`, `package.json`

## DEC-016 — İki confidence ölçeği birleştirilmez

- Tarih: 2026-07-26
- Durum: ACTIVE
- Karar: İki güven ölçeği vardır ve **normalize edilmez**: `percent_0_100`
  (`RootCauseHypothesis`, `AiPossibleCause`) ve `unit_0_1` (`AiEvidenceItem`, VAL,
  kontak kanıtı). Değer daima ölçeğiyle taşınır.
- Gerekçe: Sessiz normalizasyon eşik kapılarını yanlış tarafa düşürür.
- Alternatif/reddedilen: Tek ölçeğe geçiş için toplu dönüşüm (çok noktalı, riskli).
- Sonuç/sınır: Ölçek bilinmiyorsa alan **yazılmaz** (sahte 0 yok); LAB'da `UNAVAILABLE`.
- Kanıt/otorite: `docs/DEVICE_VALIDATION_LEDGER.md` #134 · `src/platform/ai/aiOfflineReason.ts`
- İlgili dosyalar: `src/platform/ai/aiOfflineReason.ts`, `src/platform/aiCore/`

## DEC-017 — SharedArrayBuffer üretim için ZORUNLU DEĞİLDİR

- Tarih: 2026-07-27
- Durum: ACTIVE
- Karar: SAB varsayılan olarak **etkinleştirilmeyecektir**. Üretim çalışma yollarının
  tamamı SAB olmadan çalışır; SAB yalnız varsa kullanılan bir hızlandırmadır.
  **`hasSAB === false` tek başına hata veya teknik borç DEĞİLDİR.**
- Gerekçe: Daha önce yapılan değerlendirmede SAB'ın mevcut iş yükünde anlamlı bir
  kazanç sağlamadığı görüldü; COOP/COEP ve cross-origin isolation ek karmaşıklık
  getiriyor. Düşük donanımlı WebView hedeflerinde basitlik ve uyumluluk önceliklidir.
  (Ayrıca DEC-014: COEP shipped medya akışlarını bozuyor.)
- Alternatif/reddedilen: COOP/COEP'i geri açıp SAB'ı zorunlu kılmak; SAB kodunu silmek.
- Sonuç/sınır: SAB kodu **KALDIRILMAZ** — `NavigationCompute.worker`, `offlineRouting`
  ve `offlineSearch` SAB varsa zero-copy, yoksa JSON fallback ile çalışır. Bu karar,
  güçlü cihazların düşük runtime bütçesine mahkûm olması anlamına **GELMEZ** (bkz.
  `03_DEBT.md` DEBT-002). WebView/tarayıcı altyapısı veya iş yükü değişirse karar
  yeniden değerlendirilebilir. ⚠️ Repoda ölçüm raporu yok; bu bir **değerlendirmedir**,
  ölçülmüş yüzdelik sonuç değildir.
- Kanıt/otorite: Kullanıcı/ürün sahibi kararı · `AdaptiveRuntimeManager.ts:271-281` ·
  `offlineRoutingService.ts:333` (JSON fallback) · DEC-014
- İlgili dosyalar: `src/core/runtime/AdaptiveRuntimeManager.ts`, `src/platform/deviceCapabilities.ts`
