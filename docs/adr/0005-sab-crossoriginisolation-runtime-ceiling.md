# ADR 0005 — SAB / Cross-Origin Isolation ve Çalışma Zamanı Mod Tavanı

## Status

**Kabul edildi** (2026-08-22). Vizyon kapatma planı **V-17**'nin karar kaydı.
Karar: **mevcut tavan kabul edilir; COEP AÇILMAZ; SAB kod yolları SİLİNMEZ.**
Kısıt artık **gözlemlenebilirdir** (CAROS LAB · Çalışma Zamanı · Mod Kapıları).

İlgili: [ADR 0002](0002-low-end-head-unit-performance-mode.md) (Adaptive Runtime),
[ADR 0004](0004-youtube-iframe-video-strategy.md) (YouTube iframe stratejisi).

## Context

Vizyon kapatma planı V-17 şu bulguyu kaydetmişti:

> APK'da otomatik tespit **her zaman BASIC_JS** döner. SAB zero-copy yolları cihazda
> hiç koşmuyor; JSON fallback kalıcı. **Kanıt:** `vite.config.ts:232` COOP/COEP başlık
> nesnesi BOŞ, `capacitor.config.ts`'te COEP başlığı YOK.

Plan bu bulgudan iki seçenek türetmişti: **(1)** kabul et ve SAB yollarını sil,
**(2)** çöz — medya iframe'lerini ayrı bir WebView/origin'e taşı, ana origin'de COEP aç.

### Ölçüm planın nedenselliğini ÇÜRÜTTÜ

`_detectCapabilities()` okunduğunda görüldü ki mod tespiti **tek bir koşul değil, DÖRT
SIRALI KAPIDIR** ve plan yalnız son ikisini saymıştı:

| # | Kapı | Ne ölçer | Yazılımla açılabilir mi |
|---|------|----------|--------------------------|
| 1 | `deviceTier` | ekran · çekirdek · RAM · WebView · Android sürümü birleşik sınıfı | **HAYIR** (donanım) |
| 2 | `weakGpu` | Mali-400 sınıfı (Utgard) / yazılım render | **HAYIR** (donanım) |
| 3 | `worker` | `typeof Worker` | evet |
| 4 | `sab` | `SharedArrayBuffer` + `crossOriginIsolated` | evet (COEP ile) |

Üretim yolu **ilk engelleyen kapıda durur**. Referans donanımımız
**K24 SMART SERIES · Mali-400** (ADR 0002) — yani **2. kapı (`weakGpu`) tetikleniyor ve
4. kapıya (`sab`) hiç sıra gelmiyor.**

**Sonuç: COEP açılsaydı bile mod DEĞİŞMEZDİ.** Planın önerdiği pahalı çözüm (2), hedef
donanımda **hiçbir şeyi açmayacaktı** — üstelik YouTube iframe'ini ve çapraz-köken
kaynakları kırma bedelini ödeyerek.

Bu, "statik sinyalden niyet çıkarma" hatasının bir örneğidir: `vite.config.ts:232`'nin boş
olduğunu görmek doğruydu, ondan **nedensellik** çıkarmak yanlıştı.

## Decision

### 1. Mevcut tavan KABUL EDİLİR; COEP AÇILMAZ

Gerekçe: referans donanımda **ölçülen fayda sıfırdır** (2. kapı zaten engelliyor),
maliyet ise gerçektir — COEP tüm çapraz-köken alt kaynakları CORP/CORS başlığı
istemeye zorlar; YouTube iframe'i ve harici medya kırılır (ADR 0004).

Kararın **koşullu** olduğu kayda geçer: yeterince güçlü bir head unit'te (`deviceTier`
`low` değil **ve** `weakGpu` false) 4. kapı gerçekten sınırlayıcı hâle gelir. O donanım
elde ölçüldüğünde bu ADR yeniden değerlendirilir — **tahminle değil, ölçümle**.

### 2. SAB kod yolları SİLİNMEZ

Plan (1) seçeneği "bakım maliyeti sıfırlansın" diye silmeyi öneriyordu. Ölçüm:
`SharedArrayBuffer` **16 dosyada** geçiyor; bunların arasında worker'lar, sinyal
çözücü ve çevrimdışı rota/arama servisleri var. Silmek **çok-sistemli bir refactor**
olurdu — anayasanın *"çok-sistemli refactor YASAK · atomik patch"* kuralına doğrudan
aykırı ve **ölçülmüş bir faydası yok**.

Ayrıca bu yollar **ölü değil, uykuda**: her biri `crossOriginIsolated=false` durumunda
`postMessage` yedeğine düşer (`VehicleSignalResolver.ts` — Zero-Crash yolu). Yani kod
bugün de doğru davranıyor; yalnız hızlı yolu kullanılmıyor.

**Kod silme ayrı ve bağımsız bir karardır**; bu ADR onu kapsamaz ve kendiliğinden
yapılmaz.

### 3. `CLAUDE.md`'deki SAB/Seqlock disiplini KAPSAMDA KALIR

Plan (1) seçeneği bu disiplini kapsam dışına almayı öneriyordu. Alınmaz: kod duruyor,
kısıt koşullu ve geri alınabilir. Yazılı disiplini kaldırmak, kod hâlâ oradayken
gelecekteki bir yazarın Seqlock protokolünü bozmasına kapı açardı.

### 4. Kısıt GÖZLEMLENEBİLİR yapılır (bu turda uygulandı)

Kapı tablosu **tek otorite** hâline getirildi; üretim yolu kısa devre kalır, LAB tüm
kapıları değerlendirir. **CAROS LAB · Çalışma Zamanı · Mod Kapıları** ekranı her kapının
ham gözlemini, hangisinin kararı verdiğini ve **"yazılımla açılır mı"** sorusunun dürüst
cevabını gösterir — bu cevap ancak **donanım engeli kalmadıysa** EVET olur.

Ekran ayrıca **yürürlükteki mod** ile **tespit edilen mod**u ayırır: farklıysa sebep
kapılarda değil, devralan bir otoritededir (termal · kullanıcı · güç tavanı · arıza
merdiveni). Eskiden `reason` yalnız loga yazılıp atılıyordu; artık saklanıyor.

## Consequences

**Olumlu**
- Yanlış bir nedensellik üzerine kurulmuş pahalı bir mimari iş **yapılmadan** elendi.
- Cihazda "mod neden BASIC_JS?" sorusunun cevabı artık **ekranda**; tahmine gerek yok.
- "Bir kapıyı düzeltirsek açılır" yanılsaması modelde ve testte kilitlendi.

**Olumsuz / kabul edilen**
- SAB zero-copy yolları referans donanımda **uykuda kalmaya devam eder**; bakım yükü
  (16 dosya) sürer. Bilinçli takas: silmenin riski, ölçülmüş faydasından büyük.
- Güçlü bir head unit hedeflenirse karar yeniden açılmalıdır.

**Riskler**
- Kapı tablosu tek otoritedir; birisi `_detectCapabilities()` içine yeniden koşul
  yazarsa LAB ile üretim sessizce ayrışır. Bu, `runtimeModeGates.test.ts` ile kilitlendi.

## Kanıt

- `src/core/runtime/AdaptiveRuntimeManager.ts` — `MODE_GATES` · `firstBlockingModeGate()`
  (üretim, kısa devre) · `traceModeGates()` (LAB, tümü) · `getLastModeChange()`
- `src/platform/devtools/runtimeModeSources.ts` · `runtimeModeModel.ts`
- `src/components/devtools/screens/RuntimeModeScreen.tsx`
- `src/__tests__/runtimeModeGates.test.ts` — 22 kilit
- Saha doğrulama kütüğü **#710** (🔴 — gerçek head unit'te ölçülmedi)
