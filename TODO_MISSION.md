# 📋 MİSYON: SİSTEM ENTEGRASYONU (Mission Tracker)

Bu liste, projenin "Uygulama" (App) aşamasından "Sistem" (System) aşamasına geçişindeki tüm teknik adımları içerir. Tamamlanan maddeler işaretlenecek ve temizlenecektir.

## 🛠️ BÖLÜM 1: GÜVENLİK VE VERİ (ZIRHLAMA)
- [ ] **T-1: Komut Şifreleme (E2E):** Komutların PWA'dan çıkmadan önce AES-256 ile şifrelenmesi.
- [ ] **T-2: Veri Saklama Politikası (Retention):** Eski telemetri verilerini temizleyecek Edge Function.
- [ ] **T-3: PIN Hardening:** Kritik komutlar için sunucu taraflı doğrulama.

## 🔋 BÖLÜM 2: ENERJİ VE HABERLEŞME (SİSTEMLEŞME)
- [ ] **T-4: FCM Entegrasyonu:** WebSocket yerine Firebase Cloud Messaging (Push) ile komut iletimi.
- [ ] **T-5: Background Service:** Uygulama kapalıyken çalışan Native Android Servisi.
- [ ] **T-6: Connectivity Manager:** Sistem seviyesinde "Retry" ve "Offline Queue" yönetimi.

## 🏗️ BÖLÜM 3: DONANIM KÖPRÜSÜ (METALE İNİŞ)
- [ ] **T-7: Serial Port API:** Android üzerinden fiziksel seri port/CAN-BUS iletişimi.
- [ ] **T-8: Hardware Bridge:** Komutların fiziksel donanım tetikleyicisine (MCU) iletilmesi.
- [ ] **T-9: Fail-Safe Logic:** Yazılım çökerse donanımın "Safe Mode"a geçmesi (Watchdog).

## 🎨 BÖLÜM 4: UX VE FİNAL DOKUNUŞ (MAKYAJ)
- [ ] **T-10: Sunlight UI:** Güneş altında okunabilir yüksek kontrastlı tema.
- [ ] **T-11: Pairing QR:** Araç ekranında dinamik QR kod ve hızlı eşleşme.
- [ ] **T-12: Voice Command Engine:** Araç içi sesli asistan katmanı.

---
**Durum:** Başlangıç (Task 0)
**Hedef:** 12/12 Tamamlanma
