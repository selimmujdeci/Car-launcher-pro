# NIGHT_ERGONOMICS_REPORT — Gece Okunabilirlik Analizi (4 Tema)

> **Durum:** Yalnızca ANALİZ. **Hiçbir token/kod değiştirilmedi.** Onaydan sonra
> token katmanına uygulanacak. Layout / spacing / ikon yeri / bileşen yapısı
> KESİNLİKLE değişmeyecek — yalnızca renk, kontrast, opaklık, harita stili.
> Tarih: 2026-06-25. Yöntem: dev server + Playwright, 1280×720 HD head unit, saat 23:00
> (`data-day-night=night` doğrulandı). Görüntüler: `tools/night-shots/`.

---

## 0. Yöntem ve güvenilirlik notu

- **UI (panel/kart/yazı/dock/aksan/derinlik):** app-render DOM/CSS → cihazla **birebir aynı**, güvenilir.
- **HARİTA:** Headless ortamda offline vektör tile yok → harita **online raster**'a düşüyor (parlak
  gündüz tile). Cihazda offline vektör gece paleti (grafit) aktif olabilir. Bu yüzden harita
  bulguları ekran görüntüsü + gece-stil KODU (`mapStyleBuilders.ts` raster paint) birlikte
  değerlendirildi; **cihazda hangi yolun (raster/vektör) aktif olduğu doğrulanmalı.**

---

## 1. Okunabilirlik Puanları (1–10, gece sürüş 0.5–1 sn bakış)

Boyutlar = kullanıcı maddeleriyle: Harita(2) · Panel ayrışma(3) · Yazı hiyerarşi(4) · Aksan disiplini(5) · Siyah-derinlik(6) · Bakış-anı okunurluk(8).

| Tema | Harita | Panel | Yazı | Aksan | Derinlik | Bakış | **Ort.** |
|------|:------:|:-----:|:----:|:-----:|:--------:|:-----:|:--------:|
| **Expedition** (amber) | 4 | 6 | 5 | 7 | 6 | 5 | **5.5** |
| **Horizon** (turuncu) | 5 | 7 | 6 | 8 | 7 | 6 | **6.5** |
| **Tesla** (gümüş) | 5 | 5 | 5 | 6 | 5 | 5 | **5.2** |
| **Pro** (mavi) | 3 | 6 | 5 | 3 | 6 | 4 | **4.5** |

> Horizon gece en güçlü; Pro en zayıf (parlak harita + renkli dock). Tesla "düz/flat"
> kontrastla "tek blok" riskine en yakın.

---

## 2. Ortak (tüm temalar) — kök kontrast eksikleri

| # | Bulgu (kanıt) | Madde | Önem |
|---|---------------|-------|------|
| **O1** | **Kritik sayı (hız "0") SÖNÜK render ediliyor** — en parlak olması gereken değer, etiketlerle benzer grilikte. Bakış-anı hiyerarşisi yok. | 4, 8 | **Yüksek** |
| **O2** | **Gece haritası fazla parlak** — online/raster yolunda `RASTER_PAINT_NIGHT` yalnız `brightness-max 0.62 / contrast 0.42` (mapStyleBuilders.ts:397,406) → harita ekranın **en parlak bloğu**, gece glare. Vektör gece paleti grafit (doğru) ama raster yolu yetersiz koyulaşıyor. | 2, 7 | **Yüksek** |
| **O3** | **Panel-içi kart ayrışması zayıf** — araç-durumu satırları / mini kartlar panelle aynı luminansta; ayrışma beyaz kenara (`--panel-border .12`, `--pack-border .13`) ve gölgeye dayalı (sen "gölge değil kontrast" istedin). | 3 | Orta |
| **O4** | **Yazı 3 kademe ve hepsi parlak** (`--text-primary #F4F1EA / secondary #D2D6DE / muted #A6ADB9`); açıklama/pasif için 4. (sönük) kademe yok → hiyerarşi dar. | 4 | Orta |
| **O5** | **Panel rengi soğuk-mavi, zemin ılık-grafit** — `--panel-bg rgba(14,22,42)` (mavi) vs `--app-bg #16181D` (ılık). Katmanlar aynı aileden değil → derinlik bulanık. | 6 | Orta |
| **O6** | **Ambient blob/glow gece de gündüzle aynı** (`--blob-* amber 0.18/0.10`, pulse'lar) → gece sakinleşmiyor. | 9 | Düşük |

---

## 3. Tema-bazlı bulgular

### Expedition (amber/kum) — 5.5
- **İyi:** Sıcak grafit paneller, amber yalnız üst nav + nav-chip'te (disiplinli). Dock ikonları nötr.
- **Eksik:** Hız "0" sönük (O1). Sağ "ARAÇ DURUMU" satırları düşük ayrışma (O3). Harita parlak (O2).
- **Ergonomi:** Hız bakışta zayıf; navigasyon chip ("2.4 km") okunur. Orta.

### Horizon (turuncu, harita-odaklı) — 6.5
- **İyi:** En temiz. Harita baskın + marker; turuncu **yalnız aktif medya play** butonunda (mükemmel aksan disiplini, madde 5). Sıcak katmanlı derinlik.
- **Eksik:** Hız "0" + sol panel etiketleri sönük (O1/O4). Harita parlak (O2) — ama tema odağı olduğundan en çok burada rahatsız eder.
- **Ergonomi:** En iyi aday; harita parladığında gece glare riski en yüksek burada.

### Tesla (gümüş/minimalist) — 5.2
- **İyi:** Neredeyse renksiz, nötr dock, pusula. Sakin.
- **Eksik:** **Kontrast fazla "düz"** — panel↔zemin luminans farkı az → "tek blok" riski (madde 6). Yazı hiyerarşisi neredeyse yok (her şey benzer gri). Kritik değer vurgusuz.
- **Ergonomi:** Minimalizm doğru ama bakış-anı için kritik sayı + kademe ayrımı şart.

### Pro (mavi/cam) — 4.5
- **İyi:** Soğuk grafit paneller, mavi aktif-medya butonu doğru.
- **Eksik:** **Alt dock "gökkuşağı"** — mavi/yeşil/kırmızı/turuncu/mor doygun ikonlar (madde 5 ihlali, dikkat dağıtıcı). **Harita en parlak** (O2, en kötü). Bu ikisi birlikte gece dikkat dağınıklığını maksimuma çıkarıyor.
- **Ergonomi:** En zayıf; harita glare + dock renk gürültüsü.

---

## 4. En Düşük Riskli İyileştirme Planı (token/stil katmanı — onay bekliyor)

> Sıralama: en düşük risk + en yüksek değer önce. Hepsi renk/opaklık/paint değeri; layout yok.

**P1 — En yüksek değer, en düşük risk (tema-bağımsız):**
1. **O2 Harita gece koyulaştırma:** `RASTER_PAINT_NIGHT` `brightness-max 0.62→~0.45`, `contrast 0.42→~0.50`; rota katmanı parlaklığı/doygunluğu artır (rota "pop" etsin), bina fill bir kademe koyu. Tek dosya: `mapStyleBuilders.ts`. Tema kimliğine dokunmaz.
2. **O1 Kritik değer en parlak:** hız/RPM/nav sayısal token'ı en parlak seviyeye (`#FFFFFF`/near). Token: `theme.css` gece bloğu (`--text-primary` zaten parlak; kritik için ayrı `--text-critical` eklenip yalnız speedo/RPM/nav tüketir → diğer yazılar değişmez).

**P2 — Orta (token):**
3. **O4 Yazı hiyerarşisi:** 4. (pasif) kademe ekle, spread genişlet (`--text-muted` daha sönük + açıklama ara kademesi). `theme.css`.
4. **O5 Derinlik merdiveni:** `--panel-bg` mavi tonu ılık-grafite çevir (zeminle uyum); kart luminansını panelden +1 kademe ayır; `--panel-border .12→~.06` (kenar bağırmaz, ayrışma luminanstan). `theme.css` + `design-system.css`.
5. **O3 Kart ayrışması:** gölge yerine yüzey luminans farkı + 1px üst inset highlight. `design-system.css` (`--oem-surface-*`, `--oem-shadow-card`).

**P3 — İnce (token + 1 değerlendirme):**
6. **O6 Animasyon:** `[data-day-night="night"]` altında ambient blob opaklığı ~yarı, süreler kısalır. `theme.css` / `design-system.css`.
7. **Pro dock renk yoğunluğu:** ikon renkleri muhtemelen `apps.ts`/SVG'de (token DIŞI) → saf token değişmez. Gece için dock ikonlarına hafif desature opsiyonu AYRI değerlendirilmeli (filter = düşük risk ama token değil) — onayına bağlı.

**Tema deltaları (kimlik korunur):** Expedition sıcak amber; Tesla monokrom-kontrast artışı (flat'lik giderilir); Horizon rota turuncu-glow + panel chrome geri çekme; Pro soğuk grafit + mavi rota + dock sakinleştirme.

---

## 5. Sonraki adım
- Bu rapor + 4 görüntü onayına sunuldu. **Hiçbir token değişmedi.**
- Onayında: P1'den başlayıp atomik token patch'leri, her adımda gece screenshot ile önce/sonra.
- Kural: layout/spacing/ikon/bileşen yapısı sabit; yalnız renk/kontrast/opaklık/harita stili.
