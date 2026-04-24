# 🏛️ Caros Pro — SİSTEM MANİFESTOSU (ARCHITECTURE)

## 1. MİMARİ VİZYON (THE NORTH STAR)
"Caros Pro", otomotiv sınıfı (Automotive-Grade) güvenilirlik, siber güvenlik ve kullanıcı deneyimini tek bir hibrit ekosistemde (Cihaz + Bulut + Mobil) birleştirmeyi hedefler.

---

## 2. ÜÇLÜ EKOSİSTEM TOPOLOJİSİ (THE TRIAD)

### A. In-Car OS (The Edge)
- **Teknoloji:** React 19 + Capacitor 8 + Zustand 5.
- **Görev:** Sensör verilerini (OBD/GPS/CAN) işlemek, AI asistanı (Gemini/Haiku) ile sürücüye eşlik etmek ve yerel navigasyonu yönetmek.
- **Kritik Kural:** "Offline-First". İnternet kopsa dahi temel sürüş ve güvenlik (Geofence) özellikleri çalışmaya devam etmelidir.

### B. Supabase Cloud (The Backbone)
- **Teknoloji:** PostgreSQL + Realtime + Edge Functions + RPC.
- **Görev:** Telemetri verilerini (`vehicles`) saklamak, uzaktan komutları (`vehicle_commands`) iletmek ve olayları (`vehicle_events`) PWA'ya push etmek.
- **Güvenlik:** API Key tabanlı cihaz doğrulama + AES-256 şifreli veri saklama.

### C. Mobile Companion PWA (The Remote)
- **Teknoloji:** Next.js (React 19) + Tailwind 4 + Supabase Realtime.
- **Görev:** Aracın "Dijital İkizi" (Digital Twin) olarak çalışmak. Uzaktan kilit, navigasyon gönderme ve güvenlik takibi.

---

## 3. OTOMOTİV MÜHENDİSLİK STANDARTLARI (CRITICAL)

### I. Zero-Leak Memory Management
- Hiçbir listener, timer veya subscription açıkta kalamaz. 
- Her `useEffect` ve `setInterval` mutlaka bir `cleanup` fonksiyonuna sahip olmalıdır.
- Bellek sızıntısı: **SIFIR TOLERANS.**

### II. Sensor Resiliency (Self-Healing)
- Sensörlerden (OBD/GPS) gelen "imkansız" veriler (Örn: 500 km/h hız) süzülmelidir.
- Bir kaynak (OBD) koptuğunda, sistem otomatik olarak yedek kaynağa (GPS Odometer) geçmelidir.

### III. Write Throttling & I/O Optimization
- Yüksek frekanslı veriler (Hız/RPM) diske saniyede en fazla 1 kez yazılabilir.
- Ayar ve konfigürasyon değişiklikleri en az 4 saniye `debounce` edilmelidir.

### IV. Data Integrity & Clock Jump Protection
- Süre ve mesafe hesaplamalarında asla sistem saatine (`Date.now()`) güvenilmez.
- Monotonik zaman damgaları (performance.now Δ) ve delta bazlı hesaplamalar (Monotonic Delta) zorunludur.

---

## 4. İLETİŞİM PROTOKOLLERİ

### Araç -> Bulut (Telemetry)
- **Metot:** `pushVehicleEvent` (RPC).
- **Strateji:** Delta-based (Değişim olduğunda) veya Heartbeat (10s'de bir tam paket).

### Bulut -> Araç (Remote Commands)
- **Metot:** Supabase Realtime (Listen to `vehicle_commands`).
- **Flow:** PWA (Insert) -> Supabase (Broadcast) -> Araç (Execute & Update Status).

### Kullanıcı -> Araç (AI Voice)
- **Metot:** Hybrid AI (Gemini + Local Context).
- **Kural:** NHTSA §3.4 uyumlu 8-kelime TTS sınırı.

---

## 5. GELECEK GARANTİSİ (FUTURE PROOFING)
- **Modular Services:** Her özellik (GPS, Media, OBD) bağımsız birer servis dosyası (`.ts`) olmalıdır.
- **Provider Agnostic:** AI sağlayıcısı (Gemini/Haiku) veya Harita sağlayıcısı (MapLibre/Google) tek bir `interface` değişikliği ile değiştirilebilmelidir.
- **Test-Driven:** Her kritik mantık (Haversine, Odometer, Command Parser) için unit test bulunmalıdır.

---

*Bu belge, Caros Pro projesinin anayasasıdır. Herhangi bir kod değişikliği bu belgedeki prensiplerle çelişemez.*
