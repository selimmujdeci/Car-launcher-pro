# 🎨 REDESIGN — KALAN GÖREVLER (sonraki agentler için)

> Premium OEM redesign'ın kalan iş listesi. Tamamlananlar için `REDESIGN_HANDOFF.md`.
> **Tüm yanıtlar Türkçe** (CLAUDE.md). Onay isteme, doğrudan yap.

## 🔒 KİLİTLİ KARARLAR (kullanıcı onayladı — değiştirme)
- **Yön:** "Her şey premium — Tesla/Mercedes/Audi/Volvo seviyesi, hatta üstü."
- **Estetik:** **best-of OEM** — ferah boşluk, **monokrom + TEK amber aksan**, gerçek derinlik, sakin tipografi. Gökkuşağı renkler (mavi/yeşil/mor/cyan aktif durumlar) = amatör işareti, kaldırılıyor.
- **Tema:** "ikisi de mükemmel" — token-driven. Gece=her şey koyu, gündüz=her şey açık. Tek anahtar `data-day-night` (ÇÖZÜLDÜ, aşağıda).
- **Tek aksan rengi:** `#E0A23C` (amber). Koyu kart için sabit kullan; light/var-tabanlı ekranlarda `--oem-accent`.

## 🧱 KURALLAR / PATTERN (her görevde uygula)
1. **Gökkuşağı aksan → tek amber** (`#E0A23C`). Aktif/seçili/vurgu durumları amber olur.
2. **Semantik renkler KORUNUR:** kırmızı=yıkıcı/uyarı, yeşil=tamam/bağlı/aç-kapa, sıcaklık gradyanı (mavi soğuk→kırmızı sıcak), hız-limiti kırmızı halka. Bunlar gamey değil, gerçek OEM konvansiyonu.
3. **Yüzey/metin koyu panoyla tutarlı:** ProLayout kartları `--bg-card`/`--text` paleti; var-tabanlı ekranlar `--oem-*`. Karıştırma.
4. **DRY:** ortak bileşeni (map/shell/component) tek noktadan değiştir, tüm kullanımlar dönsün (örn: PremiumToggle→SettingTile, COLOR_MAP blue→amber).
5. **Sakin tipografi:** Orbitron yerine Inter/tabular-nums tercih; sert text-shadow yok; aşırı uppercase/tracking azalt.
6. **Kullanılmayan import/param temizle** (tsc strict; `npm run build` tsc-pre-existing hatalar verir → APK için `npx vite build` kullan).

## 👁️ NASIL GÖRÜRSÜN (screenshot workflow — ZORUNLU)
Dev server çalışıyor (`npm run dev`, port 5173). Proje kökünde hazır helper'lar:
- `node _shot.mjs <url> <out.png>` → ana ekran.
- `node _shot_nav.mjs "<DockEtiketi>" <out.png>` → dock'tan drawer aç + çek (örn `"Klima"`, `"Sport"`, `"Müzik"`). Dock öğesini görünüme kaydırıp butona basar.
- `node _shot_dock.mjs <out.png>` → dock'u kırpıp büyütür (hover dahil).
Çek → `Read` ile PNG'yi gör → düzelt → tekrar çek. **Bitince geçici `_*.png`'leri sil** (`.mjs` helper'ları KALSIN).
- Not: web'de `perf-low` sık aktif → gölge/blur/animasyon stripleniyor; native'de farklı. GPS/native yok → boş durumlar normal.

## 🎯 TASARIM SİSTEMİ (kaynak)
- `src/styles/design-system.css` — kanonik `--oem-*` token (renk/durum/elevation/motion/radius). YENİ namespace AÇMA.
- `src/styles/dock-premium.css` — dock chrome.
- Tema birleştirme ÇÖZÜLDÜ: `light-ui` artık `data-day-night` ile senkron (`useDayNightManager.ts applyDayNightDOM` + `main.tsx` boot). Gece koyu / gündüz açık, tutarlı.

---

## ✅ TAMAMLANANLAR (referans)
Tasarım sistemi + dock premium + tema birleştirme · Ayarlar kartları (SettingTile birleşik) · ProLayout SpeedCard (gamey mor-dağ→sakin amber küme) + MusicCard + TopBar + mini kartlar · DrawerShell premium · ClimateScreen · MediaScreen · NotificationCenter (+sim metni temizliği) · DTCPanel · TripLogView · SportModePanel · simülasyon bildirimleri kaldırıldı.

## 📋 KALAN GÖREVLER (öncelik sırasına göre)

### 1. FullMapView + NavigationHUD ⭐ (sürüşte EN kritik ekran)
- Dosyalar: `src/components/map/FullMapView.tsx`, `src/components/map/NavigationHUD.tsx`, `MapHudControls.tsx`, `OEMMapVignette.tsx`.
- Yap: HUD kartlarını (TurnPanel/LaneGuidance/SpeedPanel/NavInfoBar) sakin best-of dile çek, aksanları amber'e indir, harita overlay kontrastını netleştir.
- ⚠ **`FullMapView`'de geçici teşhis rozeti var: "RTDBG b4" (sol alt).** Rota çizimi sorunu çözülünce KALDIR ("TEMP DEBUG" yorumlu bloklar + `dbgLayer` state). Rota hâlâ çizmiyorsa kullanıcı bildirir; rozetteki `pts/map/sc/lyr/c0` ile teşhis et.

### 2. Tema layout'ları (kullanıcı tema değiştirince görünür)
- `src/components/themes/TeslaLayout.tsx`, `AudiLayout.tsx`, `MercedesLayout.tsx`, `CockpitLayout.tsx`.
- Varsayılan `pro` (ProLayout) zaten yapıldı; bunlar aynı best-of dile çekilmeli. Her birinin kendi gauge/kart/aksan'ı var → gökkuşağı→amber, sakin tipografi.
- Not: `src/components/layout/layouts/` altında da BalancedLayout/CockpitLayout/Luxury/Racing/Sport/Immersive/MapFocus var — kullanımda olanları kontrol et.

### 3. RpmBar yan şeridi (ProLayout, geniş head-unit'te görünür)
- `src/components/themes/ProLayout.tsx` içinde `RpmBar`. Sıvı-tüp cyan/turuncu/kırmızı RPM göstergesi. Monokrom + amber'e çek (redline kırmızı semantik kalabilir). Web COMPACT'ta gizli — geniş viewport'ta test et (1920×720).

### 4. Kalan drawer/panel içerikleri
- `EntertainmentPortal` (`src/components/entertainment/`), `SecuritySuite` (`src/components/security/`), `AppGrid` (`src/components/apps/`), `WeatherWidget` (boş-durum dışında dolu hali), `TrafficPanel` detayları, `DashcamView`, `RearViewCamera`, `SplitScreen`.
- Her birinde gökkuşağı aksan → amber, koyu-tutarlı yüzey.

### 5. İnce işler
- ProLayout MusicCard'da play butonu zaten amber; NavMiniCard harita placeholder'ında üzgün-yüz emoji var → sakin ikon yap.
- SettingsPage `SectionTitle` ikon renkleri hâlâ renkli (mor/mavi vb.) — istenirse nötr/amber.
- Sport header "Sport Mod Pro" lightning ikonu maroon daire → amber.
- Climate“HAVA YÖNÜ” emoji ikonları (🦶 vb.) çok renkli — istenirse lucide monokrom ikonlara çevir.

## ✔️ KABUL KRİTERİ (her ekran için)
Screenshot'ta: (a) koyu panoyla tutarlı, (b) tek amber aksan (gökkuşağı yok), (c) metinler okunur (kontrast), (d) sakin tipografi, (e) build kırılmadı (`npx vite build`). Semantik renkler (kırmızı/yeşil/sıcaklık) korunmuş olmalı.
