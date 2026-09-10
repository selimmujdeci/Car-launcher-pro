# DEVİR — RADAR / DENETİM NOKTASI VERİSİ (2026-08-13)

> ## ✅ DEVRALINDI — 5. BÖLÜMDEKİ 4 ADIM TAMAMLANDI (2026-08-13, aynı gün)
>
> Adım 1–4 uygulandı; kütüğe **#568** (ürün davranışı) ve **#569** (LAB ekranı)
> 🔴 maddeleri eklendi. Ayrıntı için 8. bölüme bak. Bu belgenin 1–4 ve 6. bölümü
> hâlâ geçerli referanstır; **5. bölüm artık yapılacak iş değil, yapılanın
> planıdır**.
>
> **Bekleyen karar, varsayımla ilerletildi:** paket tazeleme politikası (§6-D.3)
> hâlâ KARARSIZ. Belgenin kendi verdiği varsayılan uygulandı — paket **statiktir**
> ve `fetchedAt` hem LAB'da hem kaynak notunda gösterilir. Karar verilince
> değişecek tek yer yükleme katmanıdır.

> **Gelen oturuma:** bu iş yarıda kesilmedi, **temiz bir noktada durduruldu**.
> Aşağıdaki 1. bölümü oku, 5. bölümdeki sıradaki adımdan devam et.
> Araştırmayı **TEKRARLAMA** — her sayı ölçüldü ve `docs/ADR_RADAR_DATA_SOURCE.md`
> içinde duruyor.

---

## 1. TEK PARAGRAFTA DURUM

Guardian'ın `SPEED_CAMERA_WARNING` kuralı kodda vardı ama **verisi yoktu** (boş
yuva). Bu turda önce ücretsiz tek aday **OSM ölçüldü** (yetersiz çıktı), sonra
**kaynak avı** yapıldı (SCDB 2 266 · EGM 1 503 · OSM 730 nokta — hepsi gerçek
sorguyla sayıldı). Sahibi iki karar verdi: **(a)** gelir olmadığı için ticari
veri lisansına **bugün para harcanmayacak**, **(b)** EGM'nin kamuya açık verisi
**izin beklenmeden kullanılacak**, veri ne kadar sağlıklıysa kullanıcı o kadar
bilgilendirilecek. Bu karar üzerine **veri paketi üretim hattı kuruldu ve
çalıştırıldı**. Ürün kodu **henüz yazılmadı** — sıradaki iş o.

---

## 2. VERİLEN KARARLAR (bağlayıcı — yeniden tartışma)

| # | Karar | Nerede yazılı |
|---|---|---|
| K1 | Radar verisine **bugün para harcanmayacak**; ticari lisans **ilk ticari head unit siparişi / ilk ödemeli filo müşterisinde** alınacak | ADR §6-C |
| K2 | **EGM verisi kullanılacak**, izin beklenmeyecek (sahibinin **iş riski** kararı; teknik ekip uygular, tekrar sorgulamaz) | ADR §6-D |
| K3 | Sürücüye **"radar" DENMEYECEK** → **"denetim noktası"**. Kayıtların %93'ünde tür bilinmiyor | ADR §6-D.1 |
| K4 | Uyarı **hız eşiği iddia etmeyecek** — pakette hız limiti **hiç yok**. Limit gerekiyorsa **yolun kendi limitinden** gelir | ADR §6-D.1 |
| K5 | **Cihaz EGM'ye doğrudan gitmez** — paket geliştirici/CI tarafında üretilir, cihaza gömülür | ADR §6-D.2 |
| K6 | **Kaynak atfı zorunlu**: "Denetim noktası verisi: EGM kamuya açık EDS haritası" | ADR §6-D.4 |
| K7 | *"Radara yakalanmaz"* vaadi **satış/pazarlama malzemesinde kullanılmaz** | ADR §6-C |

---

## 3. BU TURDA ÜRETİLENLER

| Dosya | Ne |
|---|---|
| `docs/ADR_RADAR_DATA_SOURCE.md` | **Ana belge.** Ölçümler · lisans · kaynak karşılaştırması · iletişim uçları · kararlar |
| `docs/RADAR_VERI_TEKLIF_TALEBI_TASLAKLARI.md` | Üç hazır teklif metni (Başarsoft TR · SCDB EN · EGM/CİMER) — **gelir gelince gönderilecek**, şimdi kullanılmıyor |
| `scripts/fetch-enforcement-points.mjs` | **YENİ.** EGM verisini çeker → paket üretir. Çalıştı, doğrulandı |
| `public/data/enforcement-points.tr.json` | **YENİ.** 1 503 nokta · 287 KB · üretildi |
| `docs/CAROS_PRO_VIZYONU.md` | Üç yerde güncellendi (boş yuva kararı · ÜRÜN SÖZÜ · Guardian satırı · bütçe kararı) |

**Not:** hiçbir şey commit edilmedi (istenmedi). `git status` bu dosyaları
değişiklik olarak gösterir.

---

## 4. ÖLÇÜLEN SAYILAR (tekrar ölçme — referans bunlar)

**Kaynak karşılaştırması (TR geneli):**
SCDB.info **2 266** · EGM **1 503** · OSM **730** · TomTom: **Türkiye kapsam
listesinde yok** · Başarsoft & Lufop: ölçülemedi (teklif/form işi).

**EGM paketinin içeriği (ürün dilini belirleyen):**

| | |
|---|---:|
| Toplam nokta | 1 503 |
| Tipi **bilinmeyen** | **1 400 (%93)** |
| Ortalama hız koridoru (OHTS) | 81 |
| Kırmızı ışık | 14 |
| Park ihlali | 8 |
| **Hız limiti taşıyan** | **0** |
| Yön ipucu (serbest metin) | 469 (%31) |

**Kapsam boşlukları:** Mersin ili → EGM'de **0** kayıt (OSM'de 4).
Mersin merkez–Tarsus koridoru → **üç kaynak da 0**. Adana → EGM 85, OSM 0.
İstanbul → EGM 473, OSM 182.

**🔴 Kaynaklar birbirini doğrulamıyor:** EGM ile OSM 200 m eşiğinde yalnız
**%10 / %18,6** örtüşüyor. İleride ikinci kaynak eklenirse **tekilleştirme
(dedupe) başlı başına bir iştir** — yoksa aynı noktaya iki uyarı çalar.

---

## 5. SIRADAKİ ADIMLAR (buradan devam et)

> Sıra önemli. Her adım atomik; biri bitmeden diğerine geçme.

### Adım 1 — Veri katmanı (`enforcementPointsSource`)
- Paketi okuyan **salt-okunur, senkron** kaynak katmanı; her getter `try/catch`.
- Paket yoksa/bozuksa **`UNAVAILABLE`** döner. **Boş liste ≠ "denetim yok"** —
  bu ayrım sessiz sahte güvenin tam merkezidir.
- `fetchedAt` ve `count` dışarıya açılır (LAB ve ürün yüzeyi gösterecek).
- Desen: mevcut `<x>Sources.ts` → `<x>Model.ts` ayrımı (CLAUDE.md gözlemlenebilirlik
  bölümü). Model **saf** olacak: I/O · timer · `Date.now` · React importu YOK.

### Adım 2 — `speedCameraWarningRule` bağlanması
- Uyarı metni **K3/K4'e uyacak**: "denetim noktası", tür yalnız biliniyorsa,
  **hız eşiği iddia edilmeyecek**.
- Yön ipucu serbest metin — **dereceye çevirme**. Yön bilinmiyorsa uyarı
  "yön bilinmiyor" varsayımıyla verilir veya yalnız mesafe bildirilir.
- ⚠️ **G1 bağımlılığı:** vizyon §"ÜRÜN SÖZÜ" — konum p50 19,5 s bayatken 94 km/h'te
  ~509 m hata var. Şartlı kilit **#508** bunu korur. Uyarı mesafesi bu gerçeğe
  göre seçilmeli, yoksa uyarı radarın üstünde çalar.

### Adım 3 — CAROS LAB gözlem ekranı (ZORUNLU — CLAUDE.md)
Salt-okunur: paket sürümü · `fetchedAt` (yaş) · nokta sayısı · tip dağılımı ·
en yakın noktaya mesafe · kaynak durumu (`OBSERVED/DERIVED/UNAVAILABLE/STALE`).
Komut göndermez. `carosLabCatalog` PLACEHOLDER→AVAILABLE + `carosLabScreenMap` lazy.

### Adım 4 — Testler + kütük
- Kilit testleri: boş paket → `UNAVAILABLE` · sahte hız limiti üretmeme ·
  tip `UNKNOWN` iken "radar" kelimesi geçmemesi.
- `docs/DEVICE_VALIDATION_LEDGER.md`'ye **🔴 maddeler** (gerçek araçta ölçülecek
  kabul ölçütüyle). **Bu tur kütüğe madde eklenmedi** — ürün davranışı henüz
  değişmediği için; Adım 2 biter bitmez eklenmeli.

### Karar bekleyen (Adım 1'den önce netleşmeli)
**Paket tazeliği:** ne sıklıkla yenilenecek, cihaza nasıl inecek (uygulama
güncellemesi mi, ayrı indirme mi)? ADR §6-D.3. Karar verilene kadar paket
statiktir ve `fetchedAt` ürün yüzeyinde gösterilmelidir.

---

## 6. TUZAKLAR (yaşandı — tekrarlama)

1. **Overpass aynaları farklı tarihli veri servis eder.** `overpass.kumi.systems`
   bu oturumda **2,5 ay eski** veri döndürdü (Ankara 38 vs 47). **Her sonuçta
   `timestamp_osm_base` oku.**
2. **bbox ile ülke ölçülmez.** TR bbox'ı 1 361 nokta döndürdü, poligon 730 —
   yarısı komşu ülkelerden. `area[...]["admin_level"]` kullan.
3. **Türkçe `İ`/`I` tuzağı.** `"İhlal"` metnini `/ihlal/i` regexi **yakalamaz**;
   JS `toLowerCase()` Türkçe'yi bozar. Script'te `trLower()` bu yüzden var.
   Sayım yaparken bu yüzden bir kez yanlış 0 okundu.
4. **EGM sayfası veriyi HTML'e gömüyor**, ayrı API yok. Sayfa yapısı değişirse
   ayrıştırma 0 döner → script **bilerek hata verip durur**, boş paket yazmaz.
5. **`robots.txt` yok = izin var demek değil.** Teknik engelin olmaması hukuki
   izin değildir; karar K2 ile sahibine aittir.

---

## 7. AÇIK BORÇLAR

- Ürün kodu yok (Adım 1–4).
- Kütükte 🔴 madde yok (Adım 2 sonrası eklenecek).
- Paket tazeleme politikası kararsız (§6-D.3).
- Mersin–Tarsus koridoru **üç kaynakta da boş** → sahada tek gözlem gerekiyor:
  o yolda **sabit kamera kutusu** mu var, **mobil radar** mı? Cevap kapsam
  boşluğunun gerçek mi yoksa veri eksikliği mi olduğunu söyler.
- Mobil radar: **hiçbir statik kaynakta yok**, topluluk bildirimi gerektirir →
  kullanıcı kitlesi olmadan çalışmaz (soğuk başlangıç). Kapsam dışı bırakıldı.

---

---

## 8. DEVRALAN OTURUMUN YAPTIKLARI (2026-08-13)

### Üretilen kod

| Dosya | Rol |
|---|---|
| `src/platform/navigation/enforcement/enforcementPointsPackage.ts` | **SAF.** Paket doğrulama · sürüş ilgisi süzgeci · hücre indeksi · haversine/kerteriz/açı farkı · en yakın nokta sorgusu |
| `src/platform/navigation/enforcement/enforcementPointsSource.ts` | Tek yükleme (single-flight, import-time yan etki YOK) + **senkron** getter'lar + durum/sayaçlar |
| `guardian/runtime/guardianEnforcementPolicy.ts` | **SAF.** Eşikler ve severity haritası — kuralda gömülü sihirli sayı YOK |
| `guardian/providers/concrete/enforcementMapSource.ts` | `MapSource`in **İLK** gerçek implementasyonu (yalnız `speedCamera` dilimi) + 7 kapı sayacı |
| `devtools/enforcementPointsSources.ts` · `enforcementPointsModel.ts` · `screens/EnforcementPointsScreen.tsx` | CAROS LAB → Araç → **Denetim Noktası Verisi** (5 kart) |
| `src/__tests__/enforcementPoints.test.ts` | **37 kilit** |

### Kuralda yapılan tek sözleşme değişikliği

`SpeedCameraType`e **`'unspecified'`** eklendi. Gerekçe: paketin **%93'ünde tür
yok**; bu kayıtları `'unknown'` saymak (mevcut davranış) özelliğin %93'ünü
sessizce yutardı, tür atfetmek ise yalan olurdu. Ayrım şudur —
`'unknown'` = *noktanın var olduğu bile bilinmiyor* (olay YOK, **eski kilit
korundu**), `'unspecified'` = *varlık yetkili kaynakça yayımlandı, yalnız türü
belirtilmemiş* (uyarı VAR, tür ve hız iddiası YOK).

### #508'in koda yazılması

Kapı fix **yaşına** değil **konum belirsizliğine** kuruldu:
`belirsizlik = doğruluk + hız × fix yaşı`, tavan **150 m**, uyarı yarıçapı
**700 m**. Sahadaki p50 19,5 s bayat fix 94 km/h'te ~509 m hata demektir ve bu
kapı olmasa uyarı **noktanın üstünde çalardı**. Sonuç: özellik şehir içinde
çalışır, otoyolda **sessiz kalır** — ve sessizlik LAB'da `Düştü: KONUM BELİRSİZ`
sayacında GÖRÜNÜR. Hiçbir eşik gevşetilmedi; G1 düzeldikçe özellik kendiliğinden
açılır.

### Bilinçli tasarım kararları (yeni)

- **Park ihlali noktaları sorgu dışı** — seyir hâlinde risk değildir; pakette
  kalır, LAB "paketteki" ile "sorguya giren" sayısını **ayrı** gösterir.
- **Yön kapısı fail-closed** — heading yoksa veya hız < 5 m/s ise uyarı YOK
  (durağan araçta GPS heading gürültüdür). Arkadaki noktaya uyarı verilmez.
- **Güven konum belirsizliğinden türetilir** — noktanın *varlığı* yetkili
  kaynaktan gelir; belirsiz olan **bizim nerede olduğumuzdur**.
- **Kimlikte koordinat YOK** (`p-<sıra>`) — kimlik Guardian olayına ve oradan
  LAB'a taşınır; gözlemlenebilirlik kuralı 6 gereği koordinat taşınamaz.
- **Mesafe kuş uçuşudur**, rota boyunca değil — LAB'da `DERIVED` ve notunda yazılı.

### Değiştirilen kilit (zayıflatılmadı, güncellendi)

`guardianRuntime.test.ts` → `map.wired` artık `true`, `wiredSourceCount` 3.
Gerekçe metninin **kısmiliği açıkça yazması** da kilitlendi (sahte "map tamam"
yasak). Ayrıca `selfTestEngine` ekran-defteri probunun zaman tavanı 5 s → 20 s
(iddia değişmedi; tarama maliyeti LAB kataloğu büyüdükçe artıyor ve test 5 s'in
%83'üne dayanmıştı → kasada rastgele düşüyordu).

### Kapanmayan borçlar

- Paket tazeleme politikası (§6-D.3) **hâlâ kararsız** → paket statik.
- Mersin–Tarsus koridoru için **saha gözlemi** hâlâ gerekli (kutu mu var, mobil
  radar mı) — kapsam boşluğunun gerçek mi veri eksikliği mi olduğunu o söyler.
- Guardian çıktısı hâlâ **sürücüye SUNULMUYOR** (ses/HMI yok) — bu tur kurala
  veri verdi, sunum katmanı ayrı iştir.
- Cihazda **hiç** çalıştırılmadı: kütük #568/#569 🔴 bekliyor.

---

*Devir yazan oturum: 2026-08-13 · Devralan oturum: 2026-08-13 ·
Ana belge: `docs/ADR_RADAR_DATA_SOURCE.md`*
