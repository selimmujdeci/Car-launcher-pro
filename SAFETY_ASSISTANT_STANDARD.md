# CarOS Safety Assistant — Ürün & Mimari Standardı

> Amaç: CAN/MCU ham sinyallerini sürücü için **anlık, yorumlanmış güvenlik
> uyarılarına** çevirmek. Ham veri ekrana basılmaz; yalnızca sürüşe faydası olan,
> doğru zamanda, gereksiz tekrar etmeden sunulur.
>
> Bu doküman **standarttır** (kod değil). Uygulayan kod buradaki sözleşmeye uyar.
> Sinyal adları `src/platform/vehicleDataLayer/types.ts › CanAdapterData` ile hizalıdır.

---

## 0. Temel İlkeler (Tasarım Yasası)

1. **Her CAN verisi ekrana basılmaz.** Sadece sürüşe faydası olan gösterilir.
2. **Sürücü gereksiz konuşturulmaz.** Asistan yorumlar, ham veri okumaz.
3. **Aynı uyarı sürekli tekrar etmez.** Her kuralın bir tekrar/sustur politikası vardır.
4. **Araç duruyorsa kritik olmayanlar sessiz ikona düşer** (ses yok).
5. **Fail-soft:** sinyal yoksa/bayatsa uyarı üretme (sessiz), asla yanlış alarm verme.
6. **Critical her zaman önceliklidir** ve normal bildirimi bastırır.

---

## 1. Safety Rule Matrix

Seviye tanımı:
- **info** — bilgilendirme, ses yok / yumuşak; ikon yeşil-mavi.
- **warning** — dikkat; tek sesli anons + sarı/amber ikon/banner.
- **critical** — anında müdahale gerekli; kırmızı tam-genişlik banner + ısrarlı (sınırlı) sesli anons.

Hız eşiği notu: `speed` km/h. `MOVING = speed > 5 km/h` (GPS jitter + CAN gürültüsüne karşı histerezis; durma için `speed < 3 km/h`).

| # | rule id | Gerekli sinyaller | Koşul | Hız eşiği | Seviye | Ekran | Asistan ne der | Tekrar | Ne zaman susar | False-positive önlemi | Veri stale ise |
|---|---------|-------------------|-------|-----------|--------|-------|----------------|--------|----------------|------------------------|-----------------|
| 1 | `door.open.moving` | `doorOpen`, `speed` | doorOpen=true & MOVING | >5 km/h | **critical** | Kırmızı tam-genişlik kapı banner + hangi kapı ikonu | "Kapı açık, lütfen kapıyı hemen kapatın." | 20 sn’de 1, max 3 kez | doorOpen=false **veya** araç durdu (<3 km/h) | doorOpen true ≥800 ms sürmeli (debounce) | Kural pasif (uyarma) |
| 2 | `parkbrake.engaged.moving` | `parkingBrake`, `speed` | parkingBrake=true & MOVING | >7 km/h | **critical** | Kırmızı el freni banner | "El freni çekili, lütfen el frenini indirin." | 15 sn’de 1, max 3 | parkingBrake=false veya durdu | ≥1 sn sürmeli + hız 2 örnekte teyit | Pasif |
| 3 | `seatbelt.unbuckled.moving` | `seatbelt`, `speed` | seatbelt=false & MOVING | >10 km/h | **warning** | Sarı kemer ikonu + ince banner | "Emniyet kemeri takılı değil." | 30 sn’de 1, max 2 sonra sessiz ikon | seatbelt=true veya durdu | seatbelt=false ≥2 sn | Pasif |
| 4 | `reverse.camera` | `reverse` (veya `gearPos=-1`) | reverse=true | hız bağımsız | **info/action** | **Geri görüş overlay** (en üst z-index) | (ses yok) — ilk girişte tek "tık" | tekrar yok (mod) | reverse=false | reverse ≥300 ms (anlık parazit filtresi) | Overlay açma; mevcut overlay’i kapat |
| 5 | `lights.off.dark` | `headlightsOn`, gün/gece algısı, `speed` | headlightsOn=false & (gece **veya** karanlık) & MOVING | >20 km/h | **warning** | Amber far ikonu | "Farlar kapalı görünüyor." | 60 sn’de 1, max 2 | headlightsOn=true veya gündüz | Karanlık = saat **ve** ortam ışık ipucu (tek başına saat yetmez); 5 sn pencere | Pasif |
| 6 | `bonnet.trunk.open.moving` | `doorOpen` türevli kaput/bagaj bayrağı, `speed` | kaput/bagaj açık & MOVING | >5 km/h | **critical** | Kırmızı kaput/bagaj banner | "Kaput/bagaj açık, lütfen durup kontrol edin." | 20 sn’de 1, max 3 | kapalı veya durdu | ≥1 sn debounce | Pasif |
| 7 | `engine.overheat` | `coolantTemp` (yoksa MCU hararet bayrağı) | coolantTemp ≥ 118 °C **veya** hararet bayrağı | hız bağımsız | **critical** | Kırmızı termometre banner | "Motor sıcaklığı yüksek, lütfen güvenli yerde durun." | 30 sn’de 1, kalıcı ikon | sıcaklık < 110 °C (histerezis) | 2 ardışık örnek + makul aralık (40–130 °C) | Son geçerli değeri 10 sn tut, sonra pasif |
| 8 | `oilpressure.battery.fault` | `batteryVolt`, yağ basınç bayrağı | batteryVolt < 11.8 V (motor çalışırken) veya yağ bayrağı | hız bağımsız | **critical** | Kırmızı akü/yağ ikonu + banner | "Araçta bir arıza göstergesi var, kontrol önerilir." | 60 sn’de 1, kalıcı ikon | bayrak temiz / volt normal | rpm>0 iken ölç (marş anını ele) | Pasif |
| 9 | `door.open.parked` | `doorOpen`, `speed` | doorOpen=true & DURUYOR | <3 km/h | **info** | **Sessiz** turuncu kapı ikonu (ses yok) | (ses yok) | yok | doorOpen=false | 800 ms debounce | Pasif |
| 10 | `lowfuel` | `fuel` | fuel ≤ %8 | hız bağımsız | **warning** | Amber yakıt ikonu | "Yakıt seviyesi düşük." | yalnızca eşiğe ilk inişte 1 kez (oturum başına) | fuel > %12 (histerezis) | 3 örnek ortalaması | Pasif |
| 11 | `hazard.implicit` | `hazard`, `speed` | dörtlü açık & MOVING uzun süre | >5 km/h | **info** | Mavi dörtlü ikonu | (ses yok) | yok | hazard=false | 3 sn | Pasif |
| 12 | `tpms.low` | `tpms[]` | herhangi lastik eşik altı | hız bağımsız | **warning** | Amber lastik ikonu + hangi köşe | "Lastik basıncı düşük." | oturum başına 1, sonra ikon | normale dönünce | geçerli aralık kontrolü | Pasif |
| 13 | `abs.esp.fault` | `abs`, `stabilityControl`, `tractionControl` | arıza bayrağı aktif & MOVING | >5 km/h | **warning** | Amber ESP/ABS ikonu | "Sürüş güvenlik sistemi uyarısı var." | 60 sn’de 1, max 2 | bayrak temiz | ≥2 sn (yol bozukluğu anlık tetiği ele) | Pasif |

> **Stale tanımı:** İlgili sinyalin son güncellenmesi üzerinden **> 2000 ms** geçtiyse
> o sinyal `stale` sayılır. Stale sinyale dayanan kural **tetiklenmez** (yanlış alarm
> > yanlış sessizlikten kötüdür — ama burada güvenlik için "emin değilsen susma" değil,
> "emin değilsen yanlış alarm verme" tercih edilir; kritik sıcaklık gibi durumlarda son
> geçerli değer kısa süre korunur, satır bazında yukarıda belirtildi).

---

## 2. Öncelik Sistemi

### 2.1 Seviye baskılama
- **critical**, aynı anda kuyruktaki tüm `warning`/`info` **sesli** anonslarını bastırır
  (onlar ikon olarak görünmeye devam eder, ama konuşulmaz).
- Aynı anda **iki critical** varsa: **Safety Priority Score** ile sıralanır (aşağıda).
- `info` asla sesli anons üretmez; yalnızca ikon/overlay’dir.

### 2.2 Safety Priority Score (yüksek → önce söylenir)
Sıra (statik öncelik tablosu):
1. `engine.overheat` / hareket halinde kaput-bagaj açık (yangın/mekanik hasar riski)
2. `door.open.moving` (düşme/yaralanma riski)
3. `parkbrake.engaged.moving` (fren/şanzıman hasarı + kontrol kaybı)
4. `oilpressure.battery.fault`
5. `seatbelt.unbuckled.moving`
6. `lights.off.dark`
7. `abs.esp.fault` / `tpms.low`
8. `lowfuel`
9. `info` seviyesi (geri kamera overlay’i ayrı kanal — anons kuyruğuna girmez)

Eşit seviyede: **daha yeni tetiklenen** değil, **tablo sırası** kazanır (deterministik;
çakışmada kullanıcı her zaman aynı davranışı görür).

### 2.3 Tekrar aralığı
- Her kuralın kendi `repeatEverySec` ve `maxRepeats` değeri vardır (Bölüm 1 tablosu).
- Genel kural: critical 15–30 sn, warning 30–60 sn, info hiç tekrar etmez.
- Tetik koşulu kalksa da, **tekrar sayacı sıfırlanır** (sorun düzelip tekrar oluşursa
  yeniden uyarılır — ama "düzeldi" en az 3 sn stabil olmalı, yoksa flicker).

### 2.4 Kullanıcı susturma (mute)
- **Tek uyarı susturma:** anons çalarken/banner görünürken "Sustur" → bu **olay
  örneği** (event instance) susar; koşul kalkıp tekrar oluşursa yeni olay yine uyarır.
- **Kural susturma (oturumluk):** kullanıcı bir kuralı oturum boyunca susturabilir
  (örn. tek başına yola çıkan biri kemer uyarısını). **Critical kurallar oturumluk
  susturulamaz** — sadece tek olay susturulur, bir sonraki tetikte geri gelir.
- Susturma **sesi** keser, **görsel ikonu** kesmez (durum görünür kalır).

---

## 3. UI Standardı

### 3.1 Üç görsel katman
| Katman | Ne zaman | Görünüm |
|--------|----------|---------|
| **Durum ikon şeridi** | her zaman, kalıcı | Küçük tek renk ikonlar (kapı, kemer, far, yakıt…); normalde sönük/yarı saydam, tetikte renklenir |
| **Uyarı banner** | warning/critical aktif | Üst kenarda ince (warning) / tam-genişlik (critical) bant; ikon + tek satır metin + "Sustur" |
| **Tam-ekran overlay** | yalnızca geri vites (kamera) | En üst z-index (100000), diğer her şeyi kapatır |

### 3.2 Renk standardı
- **Kırmızı** (`critical`) — yalnızca anında müdahale (kapı/el freni/hararet/kaput).
- **Amber/Sarı** (`warning`) — dikkat ama sürüş sürebilir (kemer/far/yakıt/TPMS).
- **Mavi/Yeşil** (`info`) — bilgilendirme (dörtlü, geri kamera "tık").
- Renkler OEM adaptif palet ile uyumlu; gece modunda parlaklık düşürülür ama
  **kırmızı kritik daima okunur kalır** (kontrast garanti).

### 3.3 Sürüşte dikkat dağıtmama
- Banner **tek satır**, animasyonsuz görünür (yanıp sönme yok; sadece ilk girişte tek fade).
- Aynı anda **en fazla 1 banner** (en yüksek öncelikli olan). Diğerleri ikon şeridinde.
- Overlay yalnızca geri viteste; başka hiçbir uyarı tam ekranı kapatmaz.
- Metin büyük, yüksek kontrast, ikon + kelime (sadece ikon değil — tanınırlık).
- Araç **dururken** kritik-olmayanlar sessiz ikon; sürücü park halinde rahatsız edilmez.

### 3.4 Ses standardı
- Her seviye için **tek, kısa, ayırt edici chime** (critical alçak-acil tonu, warning
  yumuşak, info "tık"). Chime → ardından sesli cümle.
- Sesli cümle **kısa ve emir kipinde** ("Kapıyı kapatın"), ham veri yok.
- Aynı anda iki anons çalmaz — kuyruk sırayla (öncelik sıralı) okur.
- Müzik/navigasyon sesi anons sırasında **kısılır (ducking)**, sonra eski seviyeye döner.

---

## 4. Voice Assistant Standardı

**İlke:** Asistan ham veri okumaz, **yorumlar**. Sürücü doğal dille sorar, asistan
durumu insan cümlesiyle özetler.

| Sürücü sorusu | Asistan davranışı (yorumlanmış) |
|---------------|----------------------------------|
| "Kapılar kapalı mı?" | Tümü kapalıysa: "Tüm kapılar kapalı." Açık varsa: "Sürücü kapısı açık." |
| "El freni çekili mi?" | "El freni inik." / "El freni çekili." |
| "Arabada sorun var mı?" | Aktif kritik/warning yoksa: "Şu an bir sorun görünmüyor." Varsa öncelik sırasıyla en fazla 2 madde özetler. |
| "Farlar açık mı?" | "Farlar açık." / "Farlar kapalı." (+ gece ise öneri) |
| "Emniyet kemeri takılı mı?" | "Kemeriniz takılı." / "Kemeriniz takılı değil." |

Kurallar:
- Cevap **tek-iki cümle**, sayı/birim okumadan ("yüzde 12 yakıt" yerine "yakıt düşük",
  istenirse detay). İstenirse ("kaç derece?") ham değeri verir.
- Veri **stale/yoksa**: "Bu bilgiye şu an ulaşamıyorum" — uydurmaz.
- "Sorun var mı?" sorgusu **SafetyRuleEngine'in aktif uyarı listesini** okur (ayrı mantık
  değil — tek doğru kaynak).
- Asistan cevabı **proaktif anonslarla çakışmaz**: kritik anons çalıyorsa önce o biter.

---

## 5. Mimari (Katmanlar & Sözleşmeler)

Tek yönlü veri akışı; her katman saf ve test edilebilir:

```
CAN/MCU ham  ──▶  RawCanSignal
                     │  (normalize + birim + debounce + stale damgası)
                     ▼
            NormalizedVehicleState   ◀── tek doğru kaynak (UnifiedVehicleStore)
                     │
                     ▼
              SafetyRuleEngine        (saf fonksiyon: state → SafetyAlert[])
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  SafetyAlertQueue          SafetyOverlay UI   (durum ikonları + banner + overlay)
        │
        ▼
 VoiceSafetyAnnouncer        (kuyruktan öncelik sırasıyla okur + ducking)
```

### 5.1 Katman sorumlulukları

**`RawCanSignal`**
- Tek bir ham sinyalin temsili: `{ key, value, unit, ts }`.
- Birim normalize (ör. ham fren biti → boolean), aralık doğrulama, **debounce**
  (anlık parazit filtresi), **stale damgası** (`ts`).
- `CanAdapter`/`CanAdapterData` ile aynı sinyal isim uzayını kullanır.

**`NormalizedVehicleState`** (= mevcut `UnifiedVehicleStore` üzerine genişletme)
- Tüm sinyallerin son geçerli + zaman damgalı hali. Çoklu kaynak (CAN/OBD/GPS)
  füzyonu burada (mevcut mimaride hız füzyonu zaten var).
- Her alan için `value` + `lastUpdateTs` → engine `stale` kararını buradan verir.
- **Saf veri, karar yok.**

**`SafetyRuleEngine`**
- **Saf fonksiyon:** `(state, now) → SafetyAlert[]`. Yan etkisi yok, IO yok → birim
  test kolay (regresyon kasasına kilitlenir).
- Bölüm 1 matrisini uygular: koşul + hız eşiği + debounce + stale + histerezis.
- Her tetik için `{ ruleId, level, message, icon, screen, ts }` üretir.
- Tekrar/sustur durumunu **tutmaz** (stateless) — onu Queue yönetir.

**`SafetyAlertQueue`**
- Engine çıktısını alır; **önceliklendirir** (Bölüm 2), **deduplike** eder,
  `repeatEverySec`/`maxRepeats` ve **mute** durumunu yönetir.
- "Şu an gösterilecek banner" ve "şu an okunacak anons" tek kararı buradan çıkar.
- Aktif uyarı listesini Voice Assistant "sorun var mı?" sorgusuna verir.

**`VoiceSafetyAnnouncer`**
- Kuyruktan **en yüksek öncelikli okunmamış** anonsu alır; chime + TTS; **ducking**.
- Aynı anda tek anons; critical, çalan warning/info'yu keser.
- Mevcut `voiceService`/Vosk-TTS hattını kullanır (offline head unit uyumlu).

**`SafetyOverlay UI`**
- Üç katmanı render eder (Bölüm 3): ikon şeridi (kalıcı), banner (queue'dan tek),
  overlay (yalnız reverse). "Sustur" etkileşimini Queue'ya iletir.

### 5.2 Tasarım kararları (neden böyle)
- **Engine saf** → güvenlik mantığı deterministik + test edilebilir; regresyon kasasına
  (`regression.guards.test.ts`) kilitlenir, sessizce bozulamaz.
- **Tekrar/mute Queue'da** → engine'i durumsuz tutmak yanlış-alarm hata yüzeyini küçültür.
- **Tek doğru kaynak** (`NormalizedVehicleState`) → hem UI hem Voice hem Engine aynı
  state'i okur; "asistan başka, ekran başka söylüyor" tutarsızlığı imkânsız.
- **Performans:** Engine high-frequency değil, **olay-tetikli + ~5–10 Hz** değerlendirilir
  (RPM/speed throttle ilkesiyle uyumlu); zero-allocation: önceden ayrılmış alert
  envelope'ları, hot-path'te `{}` üretme yok (V8 hidden-class stabilitesi).

---

## 6. İlk Uygulanacak 10 Kural (güvenlik etkisine göre sıralı)

> "En çok can/araç koruyan" → "konfor" sırası. İlk faz bu 10 ile sınırlı; gerisi sonra.

1. **`reverse.camera`** — geri viteste kamera/overlay. (En sık kullanılan, çarpma önler.)
2. **`door.open.moving`** — hareket halinde kapı açık → critical.
3. **`parkbrake.engaged.moving`** — hareket halinde el freni çekili → critical.
4. **`engine.overheat`** — hararet → critical (motor hasarı/yangın).
5. **`seatbelt.unbuckled.moving`** — hareket halinde kemer takılı değil → warning.
6. **`bonnet.trunk.open.moving`** — hareket halinde kaput/bagaj açık → critical.
7. **`lights.off.dark`** — karanlıkta farlar kapalı → warning.
8. **`oilpressure.battery.fault`** — yağ/akü arıza göstergesi → critical.
9. **`lowfuel`** — yakıt düşük → warning (oturumda 1 kez).
10. **`door.open.parked`** — park halinde kapı açık → sessiz info ikon (ses yok).

(11+ sonraki faz: `tpms.low`, `abs.esp.fault`, `hazard.implicit` …)

---

## Uygulama Sözleşmesi (özet — kod yazarken bağlayıcı)

- Engine **saf fonksiyon**, IO yok; tüm eşik/histerezis/stale sabitleri tek config'te.
- Yeni kural eklemek = matrise satır + engine'e saf koşul + regresyon kilidi. UI/Queue
  değişmez (veri-odaklı).
- Stale (>2 sn) sinyale dayanan kural tetiklenmez (overheat istisnası satırda).
- Critical oturumluk susturulamaz; yalnız tek olay susar.
- Ham CAN değeri ekrana basılmaz; yalnız yorumlanmış uyarı/ikon.
- Tüm metinler Türkçe, emir kipi, kısa.
```
