# 🏛️ Caros Pro — SİSTEM MANİFESTOSU (ARCHITECTURE)

## 1. MİMARİ VİZYON (THE NORTH STAR)
"Caros Pro", otomotiv sınıfı (Automotive-Grade) güvenilirlik, siber güvenlik ve kullanıcı deneyimini tek bir hibrit ekosistemde (Cihaz + Bulut + Mobil) birleştirmeyi hedefler.

---

## 2. ÜÇLÜ EKOSİSTEM TOPOLOJİSİ (THE TRIAD)

### A. In-Car OS (The Edge)
- **Teknoloji:** React 19 + Capacitor 8 + Zustand 5 + Web Workers.
- **Data Path:** SharedArrayBuffer (Zero-Copy) üzerinden UI ve Worker arası iletişim.
- **Runtime:** Adaptive Runtime Engine (Donanım bazlı performans skalası).

### B. Supabase Cloud (The Backbone)
- **Teknoloji:** PostgreSQL + Realtime + Edge Functions + RPC.
- **Güvenlik:** E2E Şifrelenmiş komut zinciri + Private Key doğrulama.

---

## 3. OTOMOTİV MÜHENDİSLİK STANDARTLARI (CRITICAL)

### I. Zero-Leak Memory Management
- Her manager ve servis `destroy()` ve `subscribe()` cleanup garantisi verir.

### II. Sensor Resiliency (Self-Healing)
- **Odometer Guard:** GPS ve OBD tutarsızlıklarına karşı startup ve jump koruması.
- **Adaptive Engine:** Sensör kaybında dürüst "Sinyal Yok" durumuna geçiş.

### III. Write Throttling & Persistence
- **Atomic Persistence:** Ayarların yazımı 4s debounce ve eMMC ömür korumalı.

### IV. Thermal Management (Shield)
- **Thermal Watchdog:** Cihaz sıcaklığına göre FPS, parlaklık ve polling kısıtlaması (Throttling).

---

## 4. MULTİMEDYA VE DENEYİM
- **Web Audio DSP:** 10-bant EQ + Hıza Duyarlı Ses (SVC) + Audio Ducking.
- **Theater Mode:** Park halinde ambient light destekli tam ekran medya deneyimi.
- **Vision AR:** Three.js tabanlı şerit takip ve sanal navigasyon okları.

---

*Bu belge, Caros Pro projesinin anayasasıdır. Herhangi bir kod değişikliği bu belgedeki prensiplerle çelişemez.*
