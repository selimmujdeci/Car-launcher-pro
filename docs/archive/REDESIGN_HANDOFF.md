# 🪙 DEVİR / HANDOFF — Sonraki Agent İçin Miras

> Bu dosya, önceki oturumun bir sonraki agente bıraktığı tam devir notudur.
> Kullanıcı hesap değiştirdiği için hafıza taşınmayabilir → kritik bağlam buraya yazıldı.
> **Tüm yanıtlar Türkçe** (CLAUDE.md kuralı). Onay isteme yok, doğrudan yap (CLAUDE.md).

## 🎯 ANA HEDEF (devam eden iş)
Kullanıcı **tüm temaları + sayfaları "amatör" görünümden gerçek PROFESYONEL (OEM kalite) görünüme** taşımak istiyor.

> 📋 **KALAN GÖREVLER artık `REDESIGN_REMAINING_TASKS.md`'de** — kilitli kararlar, pattern, screenshot workflow ve öncelikli iş listesi orada. Sonraki agentler oradan devam etsin.

**Kilitli yön (kullanıcı onayladı):** best-of OEM, **monokrom + tek amber aksan (#E0A23C)**, "ikisi de mükemmel" (gece koyu / gündüz açık, `data-day-night` ile tek anahtar — ÇÖZÜLDÜ). Ana ekran/dock/Ayarlar/drawer'lar büyük ölçüde dönüştürüldü; kalan: FullMapView+NavHUD, tema layout'ları, RpmBar.

## 👁️ EN ÖNEMLİ: Tasarımı KENDİN görebilirsin
Cihaz (head unit) test edilemez AMA web'de görülebilir. Playwright + Chromium kurulu.
- Dev server: `npm run dev` (port 5173; zaten açık olabilir).
- Screenshot almak için proje köküne geçici `.mjs` yaz, çalıştır, sonra sil:
```js
// _shot.mjs (proje KÖKÜNDE olmalı ki node_modules/playwright bulunsun)
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); // head-unit oranı
await p.goto('http://localhost:5173/', { waitUntil:'networkidle', timeout:30000 }).catch(()=>{});
await p.waitForTimeout(3500);
for (const t of ['Anladım','Kabul','Tamam','Başla']) { try { const e=p.getByText(t).first(); if(await e.count()) await e.click({timeout:1500}); } catch{} }
await p.waitForTimeout(2500);
await p.screenshot({ path: 'C:/Users/selim/Desktop/app-home.png' });
await b.close();
```
`node _shot.mjs` → sonra `Read` ile PNG'yi gör. **İşin bittiğinde geçici .mjs'leri sil.**
- Web modu: layout/renk/tipografi/boşluk **birebir görünür** (redesign için yeterli). Native (OBD/GPS/video/mic) çalışmaz → mock/boş. İlk açılışta bir **onay modalı** çıkar ("Anladım"), kapat.

## 🧱 TEMA MİMARİSİ — KRİTİK TUZAKLAR (zaman kazandırır)
1. **İki tema sistemi var:** `useCarTheme` (`data-theme`: tesla/audi/mercedes/cockpit/pro/oled — index.css'te koyu paletler) + `settings.theme` ('light'|'dark'|'oled') + `data-day-night` + `.sunlight-mode`. Dağınık.
2. **"Gündüz modu" GERÇEKTEN açık değil** — `day-mode.css` koyu mavi-gri (kendi yorumu: "hâlâ koyu"). Gerçek light tema yoktu.
3. ~~**`--oem-*` token'ları HİÇBİR YERDE tanımlı değil**~~ → ✅ ÇÖZÜLDÜ. `src/styles/design-system.css` artık `--oem-*`'ı TEK KANONİK semantik katman olarak tanımlıyor: `:root` koyu fallback + `html.light-ui` aydınlık-pro. Renk/durum (good/warn/danger/info + soft)/elevation/motion/focus/radius hepsi burada. **Yeni token namespace AÇMA** — scale'ler `--lp-*`/`--car-*`/`--z-*`'te zaten var; renk/durum/hareket `--oem-*`'te. index.css'te light-theme.css'ten ÖNCE import edilir.
4. **Aktif ana ekran = `NewHomeLayout` fallback bloğu** (src/components/layout/NewHomeLayout.tsx) — renkleri **INLINE HARDCODE** ediyor (zemin `BG` const + `GLASS_CARD` + `color:'#ffffff'` her yerde). CSS değişkeni ile DÖNMEZ. Light yapmak için bu dosyayı (ve diğer layout'ları: ProLayout, Tesla/Audi/Mercedes/Cockpit) elle token'a çekmek gerek. Beyaz inline yazılar light zeminde kaybolur → dikkat.
5. Eklenen: `src/styles/light-theme.css` (`html.light-ui`, index.css'te EN SON @import) + `main.tsx` boot'ta `settings.theme==='light'` ise `light-ui` ekliyor. Değişken-tabanlı ekranları (Medya/Ayarlar/Navigasyon) aydınlatır; inline layout'lara dokunmaz.

## 🎨 ÖNERİLEN YOL (redesign)
1. **Tasarım sistemi (önce bu):** tek token seti — spacing 4/8px ölçeği, tip ölçeği (12/14/16/20/28/40), renk+elevation+radius. Amatörlükten en büyük sıçrama.
2. **Önce onay modalı + ana ekran** (NewHomeLayout): inline renkleri token'a çek, hizala, kontrast/boşluk düzelt, ortadaki "mor dağ/yol" kilometre saatini sadeleştir (gamey duruyor), dock'u sadeleştir.
3. Sonra: Medya → Navigasyon HUD → Ayarlar → diğer temalar.
4. Her ekran: web screenshot al → düzelt → tekrar screenshot ile doğrula.
- `frontend-design` skill'i tek-ekran odaklı pass'ler için kullanılabilir.

## 🛠️ BUILD / APK
- `npm run build` = `tsc -b && vite build`. **DİKKAT:** `tsc -b` PRE-EXISTING hatalar veriyor (DrawerPanel.tsx, MainLayout.tsx lazy-import tipleri + radioBrowserProvider/youtubeService unused — BENİM dokunmadığım, oturum başından beri var). Bu yüzden APK'lar `npx vite build` (tsc atlanır, esbuild transpile) ile üretildi.
- APK pipeline (PowerShell):
  ```
  $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
  npx vite build ; npx cap sync android
  cd android ; .\gradlew.bat assembleDebug
  ```
- APK çıktısı: `C:\Temp\carlauncher\app\build\outputs\apk\debug\app-debug.apk` (build dir C:\Temp'e yönlü). Masaüstüne kopyalanıp `SendUserFile` ile gönderiliyor.
- APK ~65MB. Vosk TR modeli `android/app/src/main/assets/vosk-model-tr/` (~56MB) gömülü. `ndk abiFilters 'armeabi-v7a','arm64-v8a'` (x86 atıldı). Hepsi 64-bit ise armeabi-v7a da atılıp ~8MB düşer.

## ✅ BU OTURUMDA YAPILANLAR
- **Vosk offline STT** (Katman 1): `CarLauncherPlugin.java startSpeechRecognition` → önce Vosk (Google'sız, internetsiz), olmazsa Google fallback. Model assets'te. `build.gradle`'a `com.alphacephei:vosk-android:0.3.47`. → **head unit'te test edilmeli.**
- **3 katmanlı asistan mimarisi:** Katman 2 (Gemini/Claude — `aiVoiceService.ts`, BYOK key `sensitiveKeyStore`) + Katman 3 (intentEngine/commandParser) ZATEN vardı. Sadece Vosk eksikti, eklendi. Router: `voiceService.processTextCommand` (yerel parser → offline sohbet → online LLM → fallback).
- **Video düzeltmesi:** VideoView (SurfaceView) → **TextureView + MediaPlayer** (CarLauncherPlugin.java `playVideoNative`) — "ses var görüntü yok" sorunu için. **Head unit'te test edilmeli** (hâlâ görüntü yoksa codec/H.265 → ExoPlayer gerekebilir).
- **Müzik:** "son parçadan devam" (carosMediaLayer `playByQuery`/`resumeLastMedia`), cihaz **Video sekmesi** (MediaScreen), MediaHub/NewHomeLayout/ProLayout `next/previous` → caros kuyruğuna bağlandı (mediaService native yerine).
- **Mikrofon:** NewHomeLayout Header'a belirgin mic butonu; sesli asistan kaynak-agnostik in-app çalma.
- **Navigasyon:** HUD kartları küçültüldü (TurnPanel/LaneGuidance/SpeedPanel/NavInfoBar). FullMapView'a **rota deadlock-kırıcı failsafe** + **geçici teşhis rozeti "RTDBG b4"** (sol alt, navigasyonda). → **Rota hâlâ çizmiyorsa** kullanıcı diyor; rozetteki `pts/map/sc/lyr/c0` ile teşhis et. Teşhis bitince ROZETİ KALDIR (FullMapView.tsx, "TEMP DEBUG" yorumlu bloklar + `dbgLayer` state).
- **Açık tema v1** (yukarıda).
- **Ayarlar → Hakkında sekmesi** + **Açık Kaynak Lisansları** ekranı (SettingsPage.tsx `AboutTabContent`) — CLAUDE.md ticari-lisans kuralının atıf yükümlülüğü.
- **CLAUDE.md'ye** "⚖️ Ticari Lisans / Satışa Uygunluk" kuralı eklendi (GPL/AGPL/NC yasak; MIT/Apache/BSD serbest; BYOK; OSM atıfı).

## 🟡 AYARLAR REDESIGN — DEVAM EDEN (pilot başladı)
Kullanıcı onaylı yön: **tek sütun OEM liste, ortalanmış ~760px** (sol ray kalır).
- ✅ YAPILDI: Genel sekmesi `grid grid-cols-1 lg:grid-cols-2` → `flex flex-col gap-4 mx-auto maxWidth:760` (SettingsPage.tsx ~1388). Düzen pro oldu.
- ✅ YAPILDI: **Kart stili birleştirildi** — eski `PremiumToggle` (gökkuşağı accent, TÜMÜ-BÜYÜK başlık, full-row buton) artık premium `SettingTile`+`BigToggle`'a delege ediyor (SettingsPage.tsx ~98). Tüm toggle kartları "Ses" bölümüyle birebir aynı: graphite/beyaz kart, ikon çipi, karışık-harf başlık, gri açıklama, amber ETKİN/KAPALI toggle. Tek noktadan değişti → tüm kullanımlar (Genel/Layout-lock vb.) otomatik döndü. Not: SectionTitle ikon renkleri (mor/mavi vb.) ve özel paneller (Map/Offline/AI) hâlâ kendi stilinde — istenirse birleştirilir.
- ❌ KALAN (öncelik): **Başlık/satır kontrastı soluk** — SectionTitle title (`var(--text-primary)`) ve toggle satır başlıkları light-ui'de bile washed görünüyor (web screenshot ile doğrulandı). Kök neden araştır: muhtemelen başlıklar `--text-secondary`/muted veya düşük opaklık + aşırı `uppercase tracking`. Düzelt: başlıkları koyu (#14171C) + minimal caps yap. Sonra diğer sekme grid'lerini (SoundTabContent 1012/1041 repeat(2), 1067 repeat(3); 1724/1739) tek kolona çek.
- Doğrulama: `npm run dev` açık → Playwright screenshot (dock "AYARLAR" → drawer state ile açılır; web'de text-click bazen tetiklenir).

## ⏳ AÇIK İŞLER / TODO
- [x] **Tasarım sistemi temeli** — `design-system.css` kanonik `--oem-*` katmanı (aydınlık-pro birincil). light-theme.css'teki duplike token bloğu kaldırıldı (tek kaynak). Var-tabanlı ekranlarda (Ayarlar/Medya) regresyon yok — screenshot ile doğrulandı.
- [x] **Alt dock premium** — `dock-premium.css` + `DockBar.tsx` refactor. Koyu graphite chrome (light-ui'de bile koyu = bilinçli kontrast), monokrom ikon çipleri, hover'da amber halka+parıltı, sakin etiketler, üst hairline + elevation. Gökkuşağı ikon renkleri kaldırıldı. Token'lar: `--oem-dock-*` (design-system.css, tema-bağımsız). DÜZELTİLDİ: base.css `height:80px` vs iç satır 88px → etiket kesiliyordu; container `height:auto` yapıldı (ResizeObserver --lp-dock-h'ı senkronlar). Not: ilk 2 dinamik uygulama (YouTube/Maps) marka renklerini korur — kasıtlı.
- [x] **Ana ekran kilometre saati (ProLayout SpeedCard)** — gamey mor-dağ/yol/araba/gökkuşağı SVG'leri KALDIRILDI. Yerine best-of OEM küme: sakin tabular hız sayısı, kırmızı limit halkası (gerçek-dünya konvansiyonu), tek amber gauge + tip dot + alt hairline. `--bg-card`/`--text` paleti (kardeş kartlarla tutarlı) + sabit marka amber (#E0A23C). Tesla/MB tarzı.
- [x] **TEMA BİRLEŞTİRME (kritik — ÇÖZÜLDÜ):** İki palet (`--bg-*` vs `--oem-*`) zıt durumdaydı (gece koyu --bg + takılı light-ui açık --oem = beyaz kart koyu panoda). Kök neden: main.tsx boot'ta light-ui ekliyordu ama gece manager theme'i dark yapsa bile kaldırmıyordu. **Çözüm:** `light-ui` artık `data-day-night` ile SENKRON (useDayNightManager.ts `applyDayNightDOM` toggle + main.tsx boot saat-bazlı). Gece=her şey koyu, gündüz=her şey açık. Tek anahtar. Ayarlar/Medya/Telefon artık panoyla tutarlı (koyu) — Görsel-1 hedefiyle birebir. "İkisi de mükemmel" yapısal olarak sağlandı.
- [x] **ProLayout MusicCard/mini kartlar/topbar** — vinil→albüm hero, kırmızı progress→amber, gökkuşağı güneş çubuğu→amber, günbatımı hava & yeşil telefon glow→sakin. Tek amber aksan.
- [x] **DrawerShell premium** — tüm drawer'ların ortak kabuğu: token-driven yüzey (`--bg-primary`), rafine 48×5 tutamak, üst amber hairline, kenar + elevation. Tek noktadan tüm drawer'lar (Telefon/Klima/Hava/Trafik/Bildirim/Seyir…).
- [x] **ClimateScreen amber-birleştirme** — fan/A/C/AUTO/SYNC/YÜZ mavi-yeşil-mor → tek amber (#E0A23C). Sıcaklık sayıları sakin beyaz (cool/warm ipucu ince Arc'ta `tc()` kalır). Power yeşil bırakıldı (semantik aç/kapa). Trafik/Hava drawer'ları unification sonrası zaten koyu-tutarlı (Hava web'de GPS yok → boş durum).
- [x] **MediaScreen + NotificationCenter** — Media: turuncu oklch albüm placeholder → sakin graphite+amber, alt tab (ÇALIYOR/ARA…) mavi→amber. Notif: "Öncelikli" mod butonu mavi→amber, **"Demo mod: 8 saniye sonra örnek bildirim gelecek" metni kaldırıldı** (simülasyon zaten silinmişti — eski/yanlış metin). Kullanılmayan ChevronRight import + AlbumArt hue param temizlendi.
- [x] **DTC/Seyir/Sport drawer'ları** — DTC: "Taramayı Başlat" mavi→amber (Hafızayı Temizle kırmızı=yıkıcı kalır). Seyir: stat kartları mavi+mor→amber (COLOR_MAP'te blue/purple→amber yönlendirildi, tek edit). Sport: g-metre dot escalation nötr→amber→kırmızı, running/test/peak mavileri→amber.
- [ ] **Profesyonel redesign** (ana hedef) — devam: **FullMapView + NavigationHUD** (sürüşte en kritik); Tesla/Audi/Mercedes/Cockpit layout'ları; RpmBar yan şerit; EntertainmentPortal/SecuritySuite/AppGrid. Pattern: gökkuşağı aksanları → tek amber (#E0A23C), sıcaklık/aç-kapa/yıkıcı gibi semantik renkler korunur. NOT: `perf-low` class'ı sık aktif → gölge/blur/animasyon `!important` ile stripleniyor (web FPS<20; gerçek cihazda farklı olabilir).
- [ ] Açık temayı inline-styled layout'lara taşı (NewHomeLayout vb.) — şu an yarım (var-tabanlı ekranlar açık, ana ekran koyu).
- [ ] Onay modalı dark-on-dark okunmuyor → düzelt.
- [ ] Rota teşhis rozeti (b4) — sorun çözülünce kaldır.
- [ ] Head unit testleri bekleyen: Vosk mikrofon, video (TextureView), rota çizimi.
- [ ] İstersen APK arm64-only (~8MB tasarruf).
- [ ] (Opsiyonel) pre-existing tsc hatalarını temizleyip `npm run build`'i yeşile çek.

## 📌 KULLANICI TERCİHLERİ (hafızadan)
- Aydınlık/okunabilir OEM HMI ister (Mali-400 safe ≠ karanlık UI).
- Görsel polish öncesi screenshot/önizleme ile göster.
- Ürün **ticari satılacak** (Çin head unit'leri dahil) → lisans temiz tutulacak, BYOK.
- Müzik içeride çalınır (harici uygulamaya gidilmez).
