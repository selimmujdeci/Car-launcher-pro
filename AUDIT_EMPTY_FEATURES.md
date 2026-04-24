# QA Audit Report: Empty & Placeholder Features
**Project:** Caros Pro
**Role:** Quality Control (QA) Engineer
**Date:** {CURRENT_DATE}

## 1. Native Capabilities (`src/platform/nativePlugin.ts`)
*   **Status:** **REAL (Interface Defined)**
*   **Audit Findings:**
    *   Parlaklık (`setBrightness`), Ses (`setVolume`) ve Telefon (`callNumber`) fonksiyonları Capacitor plugin interface seviyesinde tanımlı.
    *   Ancak bu dosya sadece bir *sözleşme* (interface). Gerçek yetenek Android tarafındaki Java koduna (`CarLauncherPlugin.java`) bağlı.
*   **Hardening Önerisi:** 
    *   Native tarafta `WRITE_SETTINGS` izninin (parlaklık için) çalışma anında kontrol edildiğinden ve kullanıcıya açıklama yapıldığından emin olunmalı.
    *   Unit testlerde `CarLauncher` plugin'i için mock'lar oluşturularak hata durumları (örn: plugin bulunamadı) simüle edilmeli.

## 2. Hava Durumu ve Yakıt Servisi (`src/platform/weatherService.ts`)
*   **Status:** **KISMİ MOCK (Hava Durumu Gerçek, Yakıt Simüle)**
*   **Audit Findings:**
    *   **Hava Durumu:** Gerçek. `Open-Meteo API` ve `Nominatim` (OSM) kullanılarak GPS koordinatlarına göre anlık veri çekiliyor.
    *   **Yakıt Fiyatları:** **MAKYAJ (MOCK).** `AVG_GASOLINE_TL`, `AVG_DIESEL_TL` gibi sabit değerler üzerinden ±%5 varyasyonla rastgele istasyonlar üretiliyor. `isSimulated: true` flag'i açıkça set edilmiş.
*   **Hardening Önerisi:** 
    *   Yakıt fiyatları için EPDK veya benzeri bir gerçek zamanlı API entegrasyonu yapılmalı. 
    *   API maliyeti veya limitleri nedeniyle gerçek veri çekilemiyorsa, "ortalama fiyatlar" bir admin panelinden veya Supabase üzerinden dinamik olarak güncellenebilir hale getirilmeli.

## 3. Donanım Kontrolleri (`src/platform/systemSettingsService.ts`)
*   **Status:** **KISMİ SİMÜLASYON (Web tarafı placeholder)**
*   **Audit Findings:**
    *   **Parlaklık:** Native platformda gerçek (`CarLauncher.setBrightness`), web platformunda ise `<body>` üzerine uygulanan bir CSS `brightness` filtresi ile simüle ediliyor.
    *   **Ses:** Native platformda gerçek (`CarLauncher.setVolume`), web platformunda ise tamamen **BOŞ**. Hiçbir işlem yapılmadan sessizce geçiliyor.
*   **Hardening Önerisi:**
    *   Web tarafında ses kontrolü tetiklendiğinde bir `Toast` veya `Notification` ile "Sistem ses kontrolü tarayıcıda desteklenmiyor" uyarısı verilmeli.
    *   Android tarafında ses seviyesi 0-15 (Standard Android Stream Index) aralığına map ediliyor; farklı head unit'lerdeki max ses index'i (örn: 30 veya 40) için dinamik tespit mekanizması eklenmeli.

## 4. Uzaktan Komut Paneli (`website/src/components/dashboard/RemoteCommandPanel.tsx`)
*   **Status:** **INCOMPLETE STATE LOGIC (Onay mekanizması eksik)**
*   **Audit Findings:**
    *   UI, komutun Supabase'e başarıyla *yazıldığını* (queued) onaylıyor ancak aracın komutu *gerçekten yürüttüğünü* takip etmiyor.
    *   Kilit durumu (`lockStatus`) optimistik olarak güncelleniyor. Yani komut veritabanına girdiği an araç kilitlendi varsayılıyor.
*   **Hardening Önerisi:**
    *   Supabase **Realtime** aboneliği kullanılarak, aracın `status` alanını 'completed' veya 'failed' olarak güncellediği an UI'da gerçek bir feedback (Success/Error toast) gösterilmeli.
    *   Optimistik update yerine, araçtan 'ack' (acknowledgement) gelene kadar butonda bir 'processing' spinner'ı tutulmalı.

## 5. Uygulama Listesi ve Senkronizasyon (`src/data/apps.ts` & `src/platform/appDiscovery.ts`)
*   **Status:** **HİBRİT (Hardcoded + Discovery)**
*   **Audit Findings:**
    *   `src/data/apps.ts` içindeki liste tamamen hardcoded.
    *   `appDiscovery.ts` bu listeyi cihazdaki uygulamalarla (`getApps`) birleştiriyor. 
    *   Ancak `SYSTEM_APP_BLOCKLIST` ile birçok sistem uygulaması (rehber, dialer vb.) "bizim listemizdeki daha güzel" mantığıyla gizleniyor. Eğer o paket adı cihazda yoksa, kullanıcı o özelliğe erişemeyebilir.
    *   Keşfedilen uygulamalar için `guessIcon` fonksiyonu emoji bazlı placeholder ikonlar atıyor.
*   **Hardening Önerisi:**
    *   Kullanıcıya hardcoded gelen (curated) uygulamaları gizleme opsiyonu verilmeli.
    *   `guessIcon` yerine, native taraftan (`CarLauncher.getApps`) uygulama ikonlarının Base64 string olarak çekilmesi ve gerçek ikonların gösterilmesi sağlanmalı (Automotive Grade standartlarında estetik için kritik).

---
*QA Raporu Sonudur.*
