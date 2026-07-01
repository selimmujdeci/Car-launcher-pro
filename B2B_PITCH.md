# CarOS Pro — B2B Lisanslama Sunumu
### Head Unit Üreticileri & Distribütörler İçin

---

## 1. Sorun
Aftermarket head unit'lerin (K24, Hiworld, NWD, MediaTek tabanlı) **donanımı iyi,
yazılımı kötü.** Stock ROM'lar:
- Yavaş, çirkin, kararsız launcher'lar
- İnternet bağımlı, yerelleştirme zayıf
- Araç verisi (OBD/CAN) kullanılmıyor
- Güvenlik/güncelleme altyapısı yok

→ Son kullanıcı memnuniyetsizliği, iade, düşük marka değeri.

## 2. Çözüm: CarOS Pro
Cihazınıza **anahtar teslim premium yazılım katmanı.** Aynı donanım, 10× deneyim.

## 3. Neden Biz? (Farklılaştırıcılar)
| Yetenek | Değer |
|---------|-------|
| **Offline-first mimari** | Head unit'ler genelde internetsiz — navigasyon/asistan/POI çevrimdışı çalışır |
| **OBD + CAN derinliği** | K24/Hiworld/NWD protokolleri tersine-mühendislikle çözülmüş (kopyalanması zor hendek) |
| **Düşük donanım optimizasyonu** | Mali-400 sınıfı GPU'da bile akıcı (adaptif runtime, termal/akü koruma) |
| **Türkçe + yerelleştirme** | Türkiye/MENA pazarına hazır (Vosk Türkçe STT, yerel radar/POI) |
| **Güvenlik mimarisi** | E2E şifreli uzaktan komut, RLS backend, Android Keystore |
| **Filo yönetimi** | Uzaktan yapılandırma, feature flags, telemetri, kademeli güncelleme |

## 4. Entegrasyon Modeli
- Capacitor/Android tabanlı → mevcut Android head unit'lere kurulabilir.
- Cihaza özel CAN/MCU profili (per-vehicle yapılandırma) → fragmentasyon yönetilir.
- OTA güncelleme + uzaktan yapılandırma altyapısı hazır.

## 5. Lisanslama
- **Ticari satışa uygun:** kopyaleft lisans yok, gömülü 3. taraf API anahtarı yok (BYOK).
- Cihaz-başı lisans / OEM toplu lisans / white-label seçenekleri.

## 6. Olgunluk & Yol Haritası (şeffaf)
- **Çekirdek:** üretim-kalitesi (eşzamanlılık, kripto, persistence — kanıtlanmış).
- **Tamamlanan:** OBD/BLE, CAN bridge, offline harita/asistan, uzaktan komut, güvenlik sertleştirme.
- **Sertleştirme aşaması:** cihaz-bazlı QA, performans aktivasyonu, BYOK ayar UI, RLS deploy teyidi.
- Bağımsız güvenlik denetiminden geçti; baş-kritik bulgular giderildi.

## 7. Hedef Pazar
Türkiye + MENA + Doğu Avrupa aftermarket head unit pazarı — büyük, büyüyen,
yazılım kalitesi düşük → premium katmana net talep. EV ve filo ikincil büyüme.

---

> **Aynı donanım. Premium deneyim. Anahtar teslim.**
> İletişim & demo için: [proje sahibi]
