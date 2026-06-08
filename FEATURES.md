# 🚗 CarOS Pro — Ürün & Özellik Dökümanı

> **Ne:** Aftermarket araç ekranları (head unit — K24 / Hiworld / NWD / MediaTek) için
> bağımsız, **offline-first**, premium araç-içi işletim sistemi / launcher.
> Stock head unit yazılımının yerine geçer; açılışta gelen ana arayüz odur.
>
> **Ne değil:** Android Auto / CarPlay değil (onlar telefon yansıtır). CarOS Pro
> ekranın kendisini ele geçirir ve internetsiz tam çalışır.
>
> **Stack:** React 19 + TypeScript + Capacitor (Android) + native Java/Kotlin + C++ (NDK) · `com.cockpitos.pro`

---

## 🗺️ Navigasyon & Harita (Offline-First)
- MapLibre çevrimdışı harita (tile cache + service worker) — internetsiz çalışır.
- 3 katmanlı rota: yerel OSRM daemon → uzak OSRM → cihaz-içi **A\*** (tamamen offline).
- Turn-by-turn + NavigationHUD (manevra/şerit), offline POI arama (SQLite FTS5).
- Dead reckoning (tünel/GPS kaybında hız×Δt konum tahmini), Rover top-down marker.
- Crash-recovery: çökme/yeniden başlatmada rota kaldığı yerden devam (Zero-Touch).

## 🚙 Araç Verisi & Teşhis (OBD + CAN)
- OBD-II: BLE + klasik ELM327 — hız, RPM, yakıt, motor sıcaklığı.
- CAN bus (K24/Hiworld) — geri vites, kapı, vites, korna dahil doğrudan araç sinyali.
- DTC arıza kodları (Türkçe açıklamalı, olası nedenlerle) okuma/temizleme.
- Predictive maintenance: motor aşınma skoru, yağ ömrü, bakım/muayene/sigorta hatırlatıcı.
- TPMS (lastik basıncı), dijital cluster, bit-flip korumalı kilometre sayacı.

## 🛡️ Güvenlik Yardımcısı (Safety Co-Pilot)
- Radar uyarısı (Türkiye statik DB + topluluk), geri vites kamera overlay (mutlak öncelik).
- Kaza kara kutusu: 6G darbe algılar, son 30s'yi adli kayıt olarak mühürler (gizlilik: konum yok).
- Viraj hız önerisi, güvenli takip mesafesi, sürücü dikkat bütçesi.
- Geofence + vale modu (bölge ihlali alarmı).
- Sürüş güvenliği kilitleri (hareket halindeyken tehlikeli işlem engeli).

## 🎙️ Sesli Asistan (İnternetsiz)
- **Vosk** ile çevrimdışı Türkçe konuşma tanıma (Google'sız).
- İsteğe bağlı AI semantik motor (Gemini/Claude — BYOK, kullanıcı kendi anahtarı): bağlamsal komut ("acıktım"→restoran).
- Sesle navigasyon / müzik / ayar / araç durumu / donanım komutu.

## 🎵 Medya & Eğlence
- Spotify, YouTube (Piped, anahtarsız), Audius, Jamendo, internet radyosu, yerel dosyalar.
- Web Audio DSP: 10-bant EQ, hıza göre ses (SVC), TTS ducking, 3D ses.
- Theater (sinema) modu — park halinde tam ekran video, harekette otomatik kapanır.

## 📱 "Arabam Cebimde" — Uzaktan Kontrol
- Telefon PWA → araca uzaktan: kapı kilitle/aç, korna, rota gönder, aracı bul.
- Uçtan uca şifreli (ECDH-P256 + AES-GCM + Perfect Forward Secrecy).
- Push-to-Wake (FCM ile uyandırma), Supabase backend (RLS korumalı).

## 🎨 Kişiselleştirme & Temalar
- Premium temalar: Expedition (offroad), Horizon (harita-odaklı), Tesla, Mercedes, Sunlight, Pro.
- Gündüz/gece otomatik palet + otomatik parlaklık.
- Theme Studio (token-bazlı tema üret/kaydet), Edit Mode (her widget düzenlenebilir, undo/redo).

## 🔭 Filo & Yönetim (Admin)
- SuperAdmin web paneli: filo sağlık skoru, telemetri, olay kayıtları, feature flags, kademeli rollout, remote config.
- Araç telemetrisi Supabase'e akar (RLS: sahip/eşleşmiş kullanıcı erişimi).

## ⚙️ Görünmez Altyapı (Automotive-Grade)
- Adaptive Runtime Engine (zayıf GPU/Mali-400'de blur/animasyon kapatma, termal/batarya koruma).
- Termal watchdog (45/55/65°C kademeli; kritikte LIMP_HOME).
- Atomic storage (eMMC koruma, bozulma kurtarma), native foreground service (arka plan GPS/komut).
- Zero-leak bellek, clock-jump koruması, sensör resiliency, SharedArrayBuffer + worker (zero-copy veri hattı).

---

## 👤 Sürücü Açısından Tek Cümle
Ucuz Android araç ekranını; **internetsiz navigasyon + gerçek araç teşhisi (OBD/CAN) +
sesli Türkçe asistan + güvenlik uyarıları + müzik + telefondan uzaktan kontrol** sunan,
premium ve tamamen kişiselleştirilebilir bir "araç beynine" dönüştürür.

## 🎯 Konum & Pazar
- **Hedef:** aftermarket head unit'ler (Türkiye + MENA + Doğu Avrupa) — kötü stock ROM'lara premium alternatif.
- **Farklılaştırıcılar:** offline-first mimari · OBD/CAN derinliği (K24/Hiworld reverse-eng) · Türkçe yerelleştirme · E2E güvenlik · BYOK.
- **Ticari yol:** B2B (head unit üreticisine OS lisanslama) > B2C.
- **Lisans:** kopyaleft yok — ticari satışa uygun.
